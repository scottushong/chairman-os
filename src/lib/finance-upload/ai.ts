import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { DEFAULT_AI_MODEL } from '@/lib/ai/anthropic'
import { estimateCostUsd } from '@/lib/ai/pricing'
import type { ChairmanRepository } from '@/lib/repository'

import { AI_KIND_SPECS } from './kinds'
import { LEDGER_COLS, ROW_ROLES } from './ledger'
import type { AiClassify, AiStructure } from './process'

/**
 * 2c 구조 해석(AI). 보내는 것은 aiSample(시트명 · 머리글 근처 줄 · 요약 줄로 보이는 줄 · 줄 번호 — 버리기 뒤, 숫자는 «<숫자>»)뿐이고,
 * 받는 것은 JSON(종류 · 회사 · 기간 · 머리글 줄 · 칸 대응 · 요약 줄 낱말 · 계정 머리 열 · 믿음 · 이유)뿐이다.
 * **AI는 숫자를 만들지 않고 DB에 쓰지 못한다** — 숫자는 코드가 해석대로 읽고 합계 줄과 대조한다(process.ts).
 * 대조가 틀리면 틀린 계정과 «몇 배 · 부호 반대»(숫자 없음)를 feedback으로 다시 준다(최대 2번).
 * 원가 엔진 함수 · 구성표(BOM)는 부르지도 싣지도 않는다(④ 원료 줄은 열 때 이미 버렸다).
 *
 * 한도(값은 대표가 env에 넣는다 — 없으면 0 = AI 안 씀, 코드 해석만): FINANCE_UPLOAD_AI_PER_FILE(파일당 호출 — 재해석 포함) ·
 * FINANCE_UPLOAD_AI_PER_DAY(회사 하루 호출, fin_uploads.ai_used 합). 넘으면 AI 없이 미리보기(수동)로 간다. 호출마다 ai_usage_log.
 * FINANCE_UPLOAD_AI_MOCK=1이면(시험 · dummy) 진짜 호출 없이 코드 판단을 그대로 «AI 같은 판단»으로 돌려준다.
 *
 * 2026-10-14 운영 400: 예전 스키마의 columns가 «자유 키 object»(additionalProperties: {integer})였다 — 구조 강제는 모든 object에
 * additionalProperties: false만 받는다. 이제 칸 대응은 [{field, col}] 배열이다(check:ai-schemas가 모든 AI 스키마를 본다).
 */

export function aiLimits(): { perFile: number; perDay: number } {
  const n = (v: string | undefined) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0)
  return { perFile: n(process.env.FINANCE_UPLOAD_AI_PER_FILE), perDay: n(process.env.FINANCE_UPLOAD_AI_PER_DAY) }
}

const FIELDS = [...new Set([...AI_KIND_SPECS.flatMap((k) => k.fields.map((f) => f.key)), ...LEDGER_COLS])]
const NULLABLE_INT = { anyOf: [{ type: 'integer' }, { type: 'null' }] } as const
const NULLABLE_STR = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const

export const STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: [...AI_KIND_SPECS.map((k) => k.kind), 'unknown'] },
    company: NULLABLE_STR,
    period: NULLABLE_STR,
    header_row: { type: 'integer' },
    columns: {
      type: 'array',
      items: { type: 'object', properties: { field: { type: 'string', enum: FIELDS }, col: { type: 'integer' } }, required: ['field', 'col'], additionalProperties: false },
    },
    row_labels: {
      type: 'array',
      items: { type: 'object', properties: { text: { type: 'string' }, role: { type: 'string', enum: [...ROW_ROLES] } }, required: ['text', 'role'], additionalProperties: false },
    },
    account_head_col: NULLABLE_INT,
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string' },
  },
  required: ['kind', 'company', 'period', 'header_row', 'columns', 'row_labels', 'account_head_col', 'confidence', 'reason'],
  additionalProperties: false,
} as const

interface RawStructure {
  kind: string
  company: string | null
  period: string | null
  header_row: number
  columns: { field: string; col: number }[]
  row_labels: { text: string; role: string }[]
  account_head_col: number | null
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

/** 받은 JSON → 코드가 쓰는 모양(칸 배열 → 이름 → 열). 모르는 칸 · 줄 종류는 버린다. */
export function toStructure(o: RawStructure, cost: number): AiStructure {
  const columns: Record<string, number> = {}
  for (const c of Array.isArray(o.columns) ? o.columns : []) if (typeof c?.field === 'string' && Number.isInteger(c.col) && c.col >= 0 && !(c.field in columns)) columns[c.field] = c.col
  const row_labels = (Array.isArray(o.row_labels) ? o.row_labels : [])
    .filter((l) => typeof l?.text === 'string' && l.text.trim() && (ROW_ROLES as readonly string[]).includes(l.role))
    .slice(0, 20)
    .map((l) => ({ text: l.text.slice(0, 40), role: l.role as AiStructure['row_labels'][number]['role'] }))
  return {
    kind: o.kind,
    header_row: Number.isInteger(o.header_row) ? o.header_row : 0,
    columns,
    row_labels,
    account_head_col: Number.isInteger(o.account_head_col) ? o.account_head_col : null,
    company: typeof o.company === 'string' ? o.company.slice(0, 80) : null,
    period: typeof o.period === 'string' ? o.period.slice(0, 40) : null,
    confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'low',
    reason: String(o.reason ?? '').slice(0, 300),
    cost_usd: cost,
  }
}

let promptCache: Promise<string> | null = null

export function realClassifier(repo: ChairmanRepository, businessId: string): AiClassify | null {
  if (process.env.FINANCE_UPLOAD_AI_MOCK === '1') {
    return async (_sample, code) => ({ kind: code.kind, header_row: code.headerRow, columns: code.columns, row_labels: code.labels ?? [], account_head_col: null, company: null, period: null, confidence: 'high', reason: '시험용 가짜 AI(코드 판단 그대로)', cost_usd: 0 })
  }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  return async (sample, _code, feedback) => {
    promptCache ??= readFile(join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'finance-upload-classify.md'), 'utf8')
    const model = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL
    const client = new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 })
    const kinds = AI_KIND_SPECS.map((k) => `${k.kind}: ${k.label} — 칸 ${k.fields.map((f) => `${f.key}(${f.label})`).join(', ')}`).join('\n')
    const again = feedback?.length ? `\n<previous_mismatch>\n앞 해석대로 코드가 거래 줄만 더해 요약 줄과 대조했더니 맞지 않았다. 줄 종류 · 칸 대응을 다시 보라.\n${feedback.join('\n')}\n</previous_mismatch>` : ''
    const res = await client.messages.create({
      model,
      max_tokens: 4000,
      system: [{ type: 'text', text: `${await promptCache}\n\n종류와 칸:\n${kinds}\n원장(ledger) 구조 칸: ${LEDGER_COLS.join(', ')}`, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: STRUCTURE_SCHEMA } },
      messages: [{ role: 'user', content: `<sheet>${JSON.stringify(sample)}</sheet>${again}` }],
    } as Anthropic.MessageCreateParamsNonStreaming)
    const read = res.usage.cache_read_input_tokens ?? 0
    const written = res.usage.cache_creation_input_tokens ?? 0
    const input = res.usage.input_tokens + read + written
    const cost = estimateCostUsd(model, input, res.usage.output_tokens, { read, write: written })
    await repo
      .logAiUsage({ feature: 'finance_upload_classify', model, input_tokens: input, output_tokens: res.usage.output_tokens, estimated_cost_usd: cost, entity_table: 'fin_uploads', entity_id: businessId })
      .catch((e) => console.error('[finance-upload] ai_usage_log', e))
    if (res.stop_reason === 'refusal') throw new Error('AI가 답하지 않았습니다(refusal)')
    if (res.stop_reason === 'max_tokens') throw new Error('AI 답이 잘렸습니다(max_tokens)')
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    return toStructure(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as RawStructure, cost)
  }
}
