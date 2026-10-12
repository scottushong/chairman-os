import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { DEFAULT_AI_MODEL } from '@/lib/ai/anthropic'
import { estimateCostUsd } from '@/lib/ai/pricing'
import type { ChairmanRepository } from '@/lib/repository'

import { KIND_SPECS } from './kinds'
import type { AiClassify } from './process'

/**
 * 2c 분류 · 칸 맞추기(AI). 보내는 것은 aiSample(시트명 · 머리글 · 앞 20줄 · 합계 줄 — 버리기 뒤)뿐이고, 받는 것은 JSON
 * (종류 · 머리글 줄 · 칸 대응 · 믿음 · 이유)뿐이다. **AI는 숫자를 만들지 않고 DB에 쓰지 못한다** — 숫자는 코드가 칸 대응대로 읽는다.
 * 원가 엔진 함수 · 구성표(BOM)는 부르지도 싣지도 않는다(④ 원료 줄은 열 때 이미 버렸다).
 *
 * 한도(값은 대표가 env에 넣는다 — 없으면 0 = AI 안 씀, 코드 분류만): FINANCE_UPLOAD_AI_PER_FILE(파일당 호출) · FINANCE_UPLOAD_AI_PER_DAY
 * (회사 하루 호출, fin_uploads.ai_used 합). 넘으면 AI 없이 미리보기(수동)로 간다. 호출마다 ai_usage_log(feature finance_upload_classify).
 * FINANCE_UPLOAD_AI_MOCK=1이면(시험 · dummy) 진짜 호출 없이 코드 판단을 그대로 «AI 같은 판단»으로 돌려준다.
 */

export function aiLimits(): { perFile: number; perDay: number } {
  const n = (v: string | undefined) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0)
  return { perFile: n(process.env.FINANCE_UPLOAD_AI_PER_FILE), perDay: n(process.env.FINANCE_UPLOAD_AI_PER_DAY) }
}

const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: [...KIND_SPECS.map((k) => k.kind), 'unknown'] },
    header_row: { type: 'integer' },
    columns: { type: 'object', additionalProperties: { type: 'integer' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string' },
  },
  required: ['kind', 'header_row', 'columns', 'confidence', 'reason'],
  additionalProperties: false,
} as const

let promptCache: Promise<string> | null = null

export function realClassifier(repo: ChairmanRepository, businessId: string): AiClassify | null {
  if (process.env.FINANCE_UPLOAD_AI_MOCK === '1') {
    return async (_sample, code) => ({ kind: code.kind, header_row: code.headerRow, columns: code.columns, confidence: 'high', reason: '시험용 가짜 AI(코드 판단 그대로)', cost_usd: 0 })
  }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  return async (sample) => {
    promptCache ??= readFile(join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'finance-upload-classify.md'), 'utf8')
    const model = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL
    const client = new Anthropic({ apiKey: key, timeout: 45_000, maxRetries: 1 })
    const kinds = KIND_SPECS.map((k) => `${k.kind}: ${k.label} — 칸 ${k.fields.map((f) => `${f.key}(${f.label})`).join(', ')}`).join('\n')
    const res = await client.messages.create({
      model,
      max_tokens: 800,
      system: [{ type: 'text', text: `${await promptCache}\n\n종류와 칸:\n${kinds}`, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `<sheet>${JSON.stringify(sample)}</sheet>` }],
    } as Anthropic.MessageCreateParamsNonStreaming)
    const read = res.usage.cache_read_input_tokens ?? 0
    const written = res.usage.cache_creation_input_tokens ?? 0
    const input = res.usage.input_tokens + read + written
    const cost = estimateCostUsd(model, input, res.usage.output_tokens, { read, write: written })
    await repo
      .logAiUsage({ feature: 'finance_upload_classify', model, input_tokens: input, output_tokens: res.usage.output_tokens, estimated_cost_usd: cost, entity_table: 'fin_uploads', entity_id: businessId })
      .catch((e) => console.error('[finance-upload] ai_usage_log', e))
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return { ...o, cost_usd: cost }
  }
}
