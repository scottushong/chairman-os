import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { DEFAULT_AI_MODEL } from '@/lib/ai/anthropic'
import { estimateCostUsd } from '@/lib/ai/pricing'
import type { ChairmanRepository } from '@/lib/repository'

import { mockDocReader, type AiDocReader, type DocTable } from './doc-read'
import { AI_KIND_SPECS } from './kinds'

/**
 * C단계 2. 읽기(AI) — PDF · 사진의 표를 JSON으로만 받는다(종류 · 회사 · 기간 · 머리글 · 줄 · 합계 · 믿음 · 이유).
 * **AI는 DB에 쓰지 못한다** — 받은 표는 앱 코드가 검증하고, 넣기는 사람 세션의 0070 RPC다.
 *
 *   글 PDF  버리기(카드번호 가림)를 거친 **글만** 보낸다(그림을 보내지 않아 싸다).
 *   스캔 PDF PDF 그대로 document 블록(쪽 그림으로 바꾸는 라이브러리가 없어서 — 새 의존성 없이). 10쪽까지.
 *   사진   바로 세우고 · 편 JPEG(긴 변 1,568px) image 블록.
 *
 * 한도는 0070과 같은 env(FINANCE_UPLOAD_AI_PER_FILE · FINANCE_UPLOAD_AI_PER_DAY) — 한 파일 = 한 번 호출. 호출마다
 * ai_usage_log(feature finance_upload_read). FINANCE_UPLOAD_AI_MOCK=1이면 진짜 호출 없이 가짜(doc-read.ts mockDocReader).
 */

const CELL = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] } as const

/** check:ai-schemas가 구조 강제 규칙(모든 object에 additionalProperties: false)을 본다. */
export const DOC_SCHEMA = {
  type: 'object',
  properties: {
    doc_kind: { type: 'string', enum: [...new Set([...AI_KIND_SPECS.map((k) => k.kind), 'payroll', 'production', 'material_issue', 'official_statement', 'unknown'])] },
    company: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    period: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: CELL } },
    totals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          level: { type: 'string', enum: ['total', 'subtotal'] },
          after_row: { type: 'integer' },
          values: { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'null' }] } },
        },
        required: ['label', 'level', 'after_row', 'values'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string' },
  },
  required: ['doc_kind', 'company', 'period', 'title', 'columns', 'rows', 'totals', 'confidence', 'reason'],
  additionalProperties: false,
} as const

let promptCache: Promise<string> | null = null

/** 진짜 읽기 도구(키 없으면 null — 미리보기로). MOCK이면 가짜. */
export function realDocReader(repo: ChairmanRepository, businessId: string): AiDocReader | null {
  if (process.env.FINANCE_UPLOAD_AI_MOCK === '1') return mockDocReader
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  return async (input) => {
    promptCache ??= readFile(join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'finance-upload-read.md'), 'utf8')
    const model = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL
    const client = new Anthropic({ apiKey: key, timeout: 90_000, maxRetries: 1 })
    const kinds = AI_KIND_SPECS.map((k) => `${k.kind}: ${k.label} — 칸 ${k.fields.map((f) => f.label).join(', ')}`).join('\n')
    const hint = input.expect === 'official' ? '이 파일은 결산서(재무상태표 · 손익계산서)로 보인다 — 계정 · 금액 표로 읽어라.' : '이 파일은 월 재무 자료의 표 하나로 보인다.'
    const content: Anthropic.ContentBlockParam[] =
      input.media.kind === 'text'
        ? [{ type: 'text', text: `${hint}\n<document>\n${input.text.slice(0, 60_000)}\n</document>` }]
        : input.media.kind === 'pdf'
          ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(input.media.data).toString('base64') } }, { type: 'text', text: hint }]
          : [{ type: 'image', source: { type: 'base64', media_type: input.media.mediaType, data: Buffer.from(input.media.data).toString('base64') } }, { type: 'text', text: hint }]
    const res = await client.messages.create({
      model,
      max_tokens: 8000,
      system: [{ type: 'text', text: `${await promptCache}\n\n종류와 칸:\n${kinds}`, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: DOC_SCHEMA } },
      messages: [{ role: 'user', content }],
    } as Anthropic.MessageCreateParamsNonStreaming)
    const read = res.usage.cache_read_input_tokens ?? 0
    const written = res.usage.cache_creation_input_tokens ?? 0
    const inputTokens = res.usage.input_tokens + read + written
    const cost = estimateCostUsd(model, inputTokens, res.usage.output_tokens, { read, write: written })
    await repo
      .logAiUsage({ feature: 'finance_upload_read', model, input_tokens: inputTokens, output_tokens: res.usage.output_tokens, estimated_cost_usd: cost, entity_table: 'fin_uploads', entity_id: businessId })
      .catch((e) => console.error('[finance-upload] ai_usage_log', e))
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as DocTable
    return { ...o, cost_usd: cost }
  }
}
