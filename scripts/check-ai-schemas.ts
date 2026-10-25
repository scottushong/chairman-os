/**
 * AI 구조 강제(output_config.format = json_schema) 스키마 검사 — 진짜 AI 호출 0회.
 *
 *   npx tsx --conditions=react-server scripts/check-ai-schemas.ts
 *
 * 2026-10-14 운영 400: finance-upload 분류 스키마의 columns가 «자유 키 object»(additionalProperties: {type: integer})였다 —
 * API는 «For 'object' type, 'additionalProperties: object' is not supported»로 모든 호출을 400으로 거절했다.
 * 구조 강제를 쓰는 모든 스키마를 모아 API 규칙(모든 object에 additionalProperties: false · 숫자 · 글 길이 · 배열 길이 제약 없음)을 본다.
 * check:finance-upload도 이 검사를 부른다.
 */
import { BRIEF_SCHEMA as INV_BRIEF_SCHEMA, EXPLAIN_SCHEMA, REASONS_SCHEMA } from '../src/lib/investment/ai'
import assert from 'node:assert/strict'

import { BRIEF_JSON_SCHEMA, DAILY_BRIEF_JSON_SCHEMA } from '../src/lib/ai/brief-schema'
import { EXCEPTION_ANALYSIS_JSON_SCHEMA } from '../src/lib/ai/exception-schema'
import { SCHEMA as ATTACHMENT_SCHEMA } from '../src/lib/attachments/summarize'
import { SCHEMA as FEEDBACK_SCHEMA } from '../src/lib/feedback/instruction'
import { STRUCTURE_SCHEMA } from '../src/lib/finance-upload/ai'
import { DOC_SCHEMA } from '../src/lib/finance-upload/ai-doc'
import { OFFICIAL_MATCH_SCHEMA } from '../src/lib/finance-upload/official-ai'
import { INTAKE_SCHEMA } from '../src/lib/intake/proposal'
import { MEMORY_SCHEMA } from '../src/lib/memory/schema'

const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'uniqueItems', 'patternProperties', 'propertyNames', 'minProperties', 'maxProperties']
const FORMATS = ['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']

/** 규칙에 어긋난 곳 목록(경로 · 이유). */
export function schemaProblems(schema: unknown, path = '$'): string[] {
  const out: string[] = []
  const walk = (n: unknown, p: string) => {
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${p}[${i}]`))
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const isObject = o.type === 'object' || (Array.isArray(o.type) && o.type.includes('object'))
    if (isObject && o.additionalProperties !== false) out.push(`${p}: object인데 additionalProperties가 false가 아니다(${JSON.stringify(o.additionalProperties)})`)
    // properties 표 자체는 걷지 않고 값만 걷는다(아래) — 칸 이름이 «maxLength»여도 제약으로 읽지 않는다.
    for (const k of UNSUPPORTED) if (k in o) out.push(`${p}: 구조 강제가 받지 않는 제약 «${k}»`)
    if (typeof o.minItems === 'number' && o.minItems > 1) out.push(`${p}: minItems ${o.minItems}(0 · 1만 된다)`)
    if (typeof o.format === 'string' && !FORMATS.includes(o.format)) out.push(`${p}: 모르는 format «${o.format}»`)
    if (o.properties && typeof o.properties === 'object') {
      for (const [k, v] of Object.entries(o.properties)) walk(v, `${p}.properties.${k}`)
    }
    for (const k of ['items', 'anyOf', 'allOf', '$defs', 'definitions']) if (k in o) walk(o[k], `${p}.${k}`)
  }
  walk(schema, path)
  return out
}

export const AI_SCHEMAS: Record<string, unknown> = {
  'ai/brief-schema BRIEF_JSON_SCHEMA': BRIEF_JSON_SCHEMA,
  'ai/brief-schema DAILY_BRIEF_JSON_SCHEMA': DAILY_BRIEF_JSON_SCHEMA,
  'ai/exception-schema EXCEPTION_ANALYSIS_JSON_SCHEMA': EXCEPTION_ANALYSIS_JSON_SCHEMA,
  'attachments/summarize SCHEMA': ATTACHMENT_SCHEMA,
  'feedback/instruction SCHEMA': FEEDBACK_SCHEMA,
  'intake/proposal INTAKE_SCHEMA': INTAKE_SCHEMA,
  'finance-upload/ai STRUCTURE_SCHEMA': STRUCTURE_SCHEMA,
  'finance-upload/ai-doc DOC_SCHEMA': DOC_SCHEMA,
  'finance-upload/official-ai OFFICIAL_MATCH_SCHEMA': OFFICIAL_MATCH_SCHEMA,
  'memory/schema MEMORY_SCHEMA': MEMORY_SCHEMA,
  'investment/ai EXPLAIN_SCHEMA': EXPLAIN_SCHEMA,
  'investment/ai REASONS_SCHEMA': REASONS_SCHEMA,
  'investment/ai BRIEF_SCHEMA': INV_BRIEF_SCHEMA,
}

export function checkAiSchemas(): string {
  // 검사 자체가 400 모양을 잡는지 — 운영에서 거절된 옛 스키마.
  assert.ok(schemaProblems({ type: 'object', properties: { columns: { type: 'object', additionalProperties: { type: 'integer' } } }, additionalProperties: false }).length === 1, '검사가 옛 400 스키마를 잡지 못한다')
  const bad = Object.entries(AI_SCHEMAS).flatMap(([name, s]) => schemaProblems(s, name))
  assert.deepEqual(bad, [], `AI 구조 강제 스키마 규칙 위반:\n${bad.join('\n')}`)
  return `AI 스키마 ${Object.keys(AI_SCHEMAS).length}개 — 모든 object additionalProperties false · 제약 없음`
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/check-ai-schemas.ts')) {
  try {
    console.log(`PASS: ${checkAiSchemas()}`)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
}
