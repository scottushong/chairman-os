/**
 * 기억 엔진 — AI 뽑기 출력 스키마(구조 강제 output_config) + 서버 검사(parseExtraction). 검사를 통과한 것만 build.ts로 간다.
 * check:ai-schemas가 이 스키마를 검사한다(모든 object additionalProperties: false · 길이 키 없음).
 */
import { CATEGORIES, MEMORY_TYPES, type Category, type Direction, type MemoryType } from './types'
import type { ExtractResult, ExtractedEntity, ExtractedItem } from './rules'

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }

export const MEMORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'categories', 'entities', 'items'],
  properties: {
    summary: { type: 'string', description: '두세 문장 요약. 원문에 없는 사실을 더하지 않는다.' },
    categories: { type: 'array', items: { type: 'string', enum: [...CATEGORIES] } },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'type'],
        properties: {
          text: { type: 'string', description: '원문에 나온 말 그대로' },
          type: { type: 'string', enum: ['person', 'company', 'project', 'product', 'location', 'other'] },
        },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['memory_type', 'content', 'source_quote', 'speaker_label', 'direction', 'who_text', 'to_text', 'due_text', 'amount_text', 'confidence'],
        properties: {
          memory_type: { type: 'string', enum: [...MEMORY_TYPES] },
          content: { type: 'string', description: '한 문장. 원문의 뜻 그대로.' },
          source_quote: { ...nullableString, description: '근거가 된 원문 구절을 글자 그대로. 없으면 null.' },
          speaker_label: { ...nullableString, description: '말한 사람이 원문에 분명할 때만. 아니면 null.' },
          direction: { type: 'string', enum: ['mine', 'others', 'unknown'], description: '약속 · 업무: 내가(기록한 사람) 한 것 mine · 남이 나에게 한 것 others · 모르면 unknown' },
          who_text: { ...nullableString, description: '하는 사람 — 원문에 있을 때만' },
          to_text: { ...nullableString, description: '받는 사람 — 원문에 있을 때만' },
          due_text: { ...nullableString, description: '원문의 기한 말 그대로(«다음 주 금요일» · «11월»). 날짜로 바꾸지 않는다. 없으면 null.' },
          amount_text: { ...nullableString, description: '원문의 금액 말 그대로. 없으면 null.' },
          confidence: { type: 'number', description: '0~1' },
        },
      },
    },
  },
} as const

const ENTITY_TYPES = ['person', 'company', 'project', 'product', 'location', 'other'] as const

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

export class MemoryShapeError extends Error {}

/** AI 답 → ExtractResult. 모양이 틀리면 MemoryShapeError(처리 실패 → 원본은 그대로 · 다시 처리). 모르는 값은 버린다. */
export function parseExtraction(json: unknown): ExtractResult {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new MemoryShapeError('AI 답이 객체가 아닙니다')
  const o = json as Record<string, unknown>
  if (!Array.isArray(o.items) || !Array.isArray(o.categories) || !Array.isArray(o.entities)) throw new MemoryShapeError('AI 답에 items · categories · entities가 없습니다')
  const categories = o.categories.filter((c): c is Category => typeof c === 'string' && (CATEGORIES as readonly string[]).includes(c))
  const entities: ExtractedEntity[] = []
  for (const e of o.entities.slice(0, 60)) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    const text = str(r.text, 120)
    const type = typeof r.type === 'string' && (ENTITY_TYPES as readonly string[]).includes(r.type) ? (r.type as ExtractedEntity['type']) : null
    if (text && type) entities.push({ text, type })
  }
  const items: ExtractedItem[] = []
  for (const it of o.items.slice(0, 60)) {
    if (!it || typeof it !== 'object') continue
    const r = it as Record<string, unknown>
    const memory_type = typeof r.memory_type === 'string' && (MEMORY_TYPES as readonly string[]).includes(r.memory_type) ? (r.memory_type as MemoryType) : null
    const content = str(r.content, 2000)
    if (!memory_type || !content) continue
    const direction: Direction = r.direction === 'mine' || r.direction === 'others' ? r.direction : 'unknown'
    const conf = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.max(0, Math.min(1, r.confidence)) : 0.5
    items.push({
      memory_type,
      content,
      source_quote: str(r.source_quote, 1000),
      speaker_label: str(r.speaker_label, 80),
      direction,
      who_text: str(r.who_text, 120),
      to_text: str(r.to_text, 120),
      due_text: str(r.due_text, 80),
      amount_text: str(r.amount_text, 80),
      confidence: conf,
    })
  }
  return { summary: str(o.summary, 4000), categories: categories.length > 0 ? categories : ['other'], entities, items }
}
