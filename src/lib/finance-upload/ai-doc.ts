import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { DEFAULT_AI_MODEL } from '@/lib/ai/anthropic'
import { estimateCostUsd } from '@/lib/ai/pricing'
import type { ChairmanRepository } from '@/lib/repository'

import { AiShapeError, callJson } from './ai-call'
import { mockDocReader, type AiDocReader, type DocReadInput, type DocTable } from './doc-read'
import { AI_KIND_SPECS } from './kinds'

/**
 * C단계 2. 읽기(AI) — PDF · 사진의 표를 JSON으로만 받는다(종류 · 회사 · 기간 · 머리글 · 줄 · 합계 · 믿음 · 이유).
 * **AI는 DB에 쓰지 못한다** — 받은 표는 앱 코드가 검증하고, 넣기는 사람 세션의 0070 RPC다.
 *
 *   글 PDF  버리기(카드번호 가림)를 거친 **글만** 보낸다(그림을 보내지 않아 싸다). 결산서는 재무상태표 · 손익계산서 쪽을 앞에.
 *   스캔 PDF PDF 그대로 document 블록(쪽 그림으로 바꾸는 라이브러리가 없어서 — 새 의존성 없이). 30쪽까지.
 *   사진   바로 세우고 · 편 JPEG(긴 변 1,568px) image 블록.
 *
 * 2026-10-16: 답이 max_tokens에서 잘리면(긴 결산서) 글 PDF는 쪽을 반으로 나눠 다시 읽고 합친다(호출 수는 input.maxCalls까지).
 * 스캔 · 사진은 나눌 수 없어 «AI 실패 — 쪽을 나눠 올려 주세요». 구조 강제 400이면 강제 없이 한 번 더(ai-call.ts).
 *
 * 한도는 0070과 같은 env(FINANCE_UPLOAD_AI_PER_FILE · FINANCE_UPLOAD_AI_PER_DAY) — 쪽 나눔도 호출마다 센다(table.calls). 호출마다
 * ai_usage_log(feature finance_upload_read). FINANCE_UPLOAD_AI_MOCK=1이면 진짜 호출 없이 가짜(doc-read.ts mockDocReader).
 */

const CELL = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] } as const

/** 답 하나의 출력 천장 — 30쪽 결산서의 줄 수를 담을 만큼. 넘으면 쪽을 나눈다. */
export const DOC_MAX_TOKENS = 16_000
/** 글 PDF에서 한 번에 보내는 글자 수 */
export const DOC_TEXT_LIMIT = 60_000

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

const STATEMENT_PAGE = /재무상태표|대차대조표|손익계산서|포괄손익/

/**
 * 글 PDF의 쪽 순서 — 결산서(official)면 재무상태표 · 손익계산서가 든 쪽을 먼저(부속 명세서 · 표지는 뒤로). 그다음 글자 한도까지.
 * 돌려주는 것은 쪽 묶음(원래 쪽 번호 순서를 지키지 않는다 — 앞 쪽이 먼저 읽힌다).
 */
export function orderPages(text: string, expect: DocReadInput['expect']): string[] {
  const pages = text.split('\n\f\n')
  if (expect !== 'official') return pages
  const first = pages.filter((p) => STATEMENT_PAGE.test(p.replace(/\s/g, '')))
  return [...first, ...pages.filter((p) => !first.includes(p))]
}

/** 쪽 묶음 → 글자 한도 안의 앞쪽부터(넘치는 쪽은 버리고 그 수를 돌려준다). */
export function fitPages(pages: string[], limit = DOC_TEXT_LIMIT): { pages: string[]; dropped: number } {
  const out: string[] = []
  let n = 0
  for (const p of pages) {
    if (n + p.length > limit && out.length) break
    out.push(p.slice(0, limit))
    n += p.length
  }
  return { pages: out, dropped: pages.length - out.length }
}

/** 나눠 읽은 두 표를 하나로 — 줄은 이어 붙이고 소계 after_row를 밀고, 머리글 · 종류는 앞 표. */
export function mergeTables(a: DocTable, b: DocTable): DocTable {
  const shift = a.rows.length
  // 2026-10-17: 머리글이 다르면(결산서를 나눠 읽어 앞은 2023 · 2024, 뒤는 2025) 이름으로 칸을 맞춘다 — 자리로 붙이면 해가 섞인다.
  const sameHead = a.columns.length === b.columns.length && a.columns.every((c, i) => c === b.columns[i])
  const official = a.doc_kind === 'official_statement' || b.doc_kind === 'official_statement'
  const named = official && !sameHead && a.columns.length > 0 && b.columns.length > 0 && b.columns.every((c) => c.trim())
  const columns = named ? [...a.columns, ...b.columns.filter((c) => !a.columns.includes(c))] : a.columns.length >= b.columns.length ? a.columns : b.columns
  const at = b.columns.map((c) => (named ? columns.indexOf(c) : -1))
  const moveRow = <T,>(r: T[], empty: T): T[] => {
    if (!named) return r
    const out: T[] = new Array(columns.length).fill(empty)
    r.forEach((v, i) => {
      if (at[i] >= 0) out[at[i]] = v
    })
    return out
  }
  return {
    ...a,
    company: a.company ?? b.company,
    // 결산서는 가장 늦은 해, 그 밖은 앞 표.
    period: official ? ([a.period, b.period].filter((p): p is string => !!p).sort().pop() ?? null) : (a.period ?? b.period),
    title: a.title ?? b.title,
    columns,
    rows: [...a.rows, ...b.rows.map((r) => moveRow(r, null))],
    totals: [...a.totals, ...b.totals.map((t) => ({ ...t, after_row: t.after_row + shift, values: moveRow(t.values, null) }))],
    confidence: a.confidence === 'high' && b.confidence === 'high' ? 'high' : a.confidence === 'low' || b.confidence === 'low' ? 'low' : 'medium',
    reason: `${a.reason.slice(0, 140)} · (나눠 읽음) ${b.reason.slice(0, 100)}`,
    cost_usd: (a.cost_usd ?? 0) + (b.cost_usd ?? 0),
    calls: (a.calls ?? 1) + (b.calls ?? 1),
  }
}

/**
 * 쪽 묶음을 읽는다 — 답이 잘리면('cut') 쪽을 반으로 나눠 각각 읽고 합친다. 호출(readPart) 수가 maxCalls를 넘게 되면 나누지 않고 AI 실패.
 * 한 쪽짜리가 잘리면 더 못 나눈다. 순수(호출은 readPart가 한다 — 검사가 가짜로 잰다).
 */
export async function readSplitting(pages: string[], maxCalls: number, readPart: (part: string[]) => Promise<DocTable | 'cut'>): Promise<DocTable> {
  let calls = 0
  // reserve = 아직 읽지 않은 오른쪽 형제 수 — 나눌 때 그 몫까지 남아 있어야 한다(리뷰: 형제를 빼고 세면 한도를 넘었다).
  const read = async (part: string[], reserve: number): Promise<DocTable> => {
    calls += 1
    const t = await readPart(part)
    if (t !== 'cut') return t
    if (part.length < 2 || calls + 2 + reserve > maxCalls) throw new AiShapeError(`AI 실패 — 답이 길어 잘렸습니다(쪽 나눔 ${part.length < 2 ? '불가 — 한 쪽' : '한도'})`)
    const half = Math.ceil(part.length / 2)
    const left = await read(part.slice(0, half), reserve + 1)
    return mergeTables(left, await read(part.slice(half), reserve))
  }
  return read(pages, 0)
}

let promptCache: Promise<string> | null = null

function readPrompt(): Promise<string> {
  promptCache ??= readFile(join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'finance-upload-read.md'), 'utf8').catch((e) => {
    promptCache = null
    throw e
  })
  return promptCache
}

/** 진짜 읽기 도구(키 없으면 null — 미리보기로). MOCK이면 가짜. */
export function realDocReader(repo: ChairmanRepository, businessId: string): AiDocReader | null {
  if (process.env.FINANCE_UPLOAD_AI_MOCK === '1') return mockDocReader
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  return async (input) => {
    const model = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL
    const client = new Anthropic({ apiKey: key, timeout: 150_000, maxRetries: 0 })
    const kinds = AI_KIND_SPECS.map((k) => `${k.kind}: ${k.label} — 칸 ${k.fields.map((f) => f.label).join(', ')}`).join('\n')
    const hint =
      input.expect === 'official'
        ? '이 파일은 결산서(재무상태표 · 손익계산서 · 제조원가명세서 — 국세청 표준재무제표일 수 있다)로 보인다 — «결산서일 때» 규칙대로(구분 · 계정과목 · 줄 · 해 칸) 읽어라. 여러 해가 있으면 해마다 칸 하나. 부속 명세서는 읽지 않아도 된다.'
        : '이 파일은 월 재무 자료의 표 하나로 보인다.'
    const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: `${await readPrompt()}\n\n종류와 칸:\n${kinds}`, cache_control: { type: 'ephemeral' } }]
    let calls = 0
    const maxCalls = Math.max(1, input.maxCalls ?? 1)

    const once = async (content: Anthropic.ContentBlockParam[]): Promise<DocTable | 'cut'> => {
      // 올리기 한 요청은 300초(maxDuration) — 남은 시간이 40초 안이면 새로 부르지 않는다(끊기면 기록 · 지우기가 남지 않는다).
      const left = (input.deadline ?? Date.now() + 300_000) - Date.now()
      if (left < 40_000) throw new AiShapeError('AI 실패 — 시간 한도(5분) 안에 다 읽지 못했습니다(쪽을 나눠 올려 주세요)')
      calls += 1
      let cost = 0
      const r = await callJson(client, { model, maxTokens: DOC_MAX_TOKENS, timeout: Math.min(150_000, left - 20_000), system, content, schema: DOC_SCHEMA }, async (u) => {
        const read = u.cache_read_input_tokens ?? 0
        const written = u.cache_creation_input_tokens ?? 0
        const inputTokens = u.input_tokens + read + written
        const c = estimateCostUsd(model, inputTokens, u.output_tokens, { read, write: written })
        cost += c
        await repo
          .logAiUsage({ feature: 'finance_upload_read', model, input_tokens: inputTokens, output_tokens: u.output_tokens, estimated_cost_usd: c, entity_table: 'fin_uploads', entity_id: businessId })
          .catch((e) => console.error('[finance-upload] ai_usage_log', e))
      })
      if (r.stop === 'max_tokens') return 'cut'
      const o = r.json as DocTable
      if (!o || !Array.isArray(o.rows) || !Array.isArray(o.columns) || !Array.isArray(o.totals)) throw new AiShapeError('AI 실패 — 표 모양이 아닙니다')
      return { ...o, cost_usd: cost, calls: 1 }
    }

    try {
      if (input.media.kind !== 'text') {
        const block: Anthropic.ContentBlockParam =
          input.media.kind === 'pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(input.media.data).toString('base64') } }
            : { type: 'image', source: { type: 'base64', media_type: input.media.mediaType, data: Buffer.from(input.media.data).toString('base64') } }
        const t = await once([block, { type: 'text', text: hint }])
        if (t === 'cut') throw new AiShapeError('AI 실패 — 답이 길어 잘렸습니다(스캔 · 사진은 나눠 읽지 못합니다 — 쪽을 나눠 올려 주세요)')
        return t
      }

      const { pages, dropped } = fitPages(orderPages(input.text, input.expect))
      const note = dropped ? ` · 글이 길어 뒤 ${dropped}쪽은 읽지 않음` : ''
      const t = await readSplitting(pages, maxCalls, (part) => once([{ type: 'text', text: `${hint}\n<document>\n${part.join('\n\f\n')}\n</document>` }]))
      return { ...t, reason: `${t.reason}${note}`, calls }
    } catch (e) {
      // 실패해도 쓴 호출은 한도에 센다(processDoc이 읽는다).
      if (e instanceof Error) Object.assign(e, { calls })
      throw e
    }
  }
}
