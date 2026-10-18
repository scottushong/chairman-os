import { normalizeLabel, detectPeriod } from '@/lib/ecount/excel/detect'
import type { EcountSheet } from '@/lib/ecount/excel/workbook'
import { balanceCheck, type BalanceCheck } from '@/lib/statements/balance'
import type { Account, AccountSection } from '@/types'

import type { DocFormat, LayoutCell, OpenedDoc } from './doc-open'
import { cleanLabel, GROUP_SECTIONS, groupOf, isSuggestion, matchOfficial, officialLines, plain, stdKey, type MatchHow, type OfficialGroup } from './official-lines'
import { signedAmount } from './official-sign'
import { classifyByCode } from './pipeline'

/**
 * C단계 2 · 3 — AI가 읽은 표(JSON)와 그 검증(코드). **AI는 DB에 쓰지 않는다** — 여기서 표를 시트 모양으로 바꿔 0070의
 * 같은 길(버리기 → 분류 → 읽기 → 검증 → 다섯 조건 → 사람 세션의 RPC)로 보낸다.
 *
 *   DocTable          AI 답(종류 · 회사 · 기간 · 머리글 · 줄 · 합계 · 소계 줄 · 믿음 · 이유)
 *   layoutToTable     글 PDF를 AI 없이 칸 위치로 세운 표(AI 한도 넘음 · 꺼짐 → 사람이 보는 미리보기 · 시험용 가짜 AI)
 *   checkDocTotals    합계 · 소계 줄 = 줄의 합인가(칸마다). 다르면 «합계가 맞지 않습니다» → 미리보기
 *   numbersNotInText  글 PDF: AI가 적은 숫자가 PDF 글에 정말 있는가(AI가 숫자를 만들지 않게)
 *   docReviewUntil    사진 · 스캔은 처음 3개월 믿음 «높음»이어도 미리보기(시작일 상수 + env로 바꿈)
 *   buildOfficialDraft 세무사 확정 결산 → «공식 결산» 미리보기 줄(계정 맞추기 · 부호 · 균형). 넣기는 사람이 0020 RPC로.
 */

export type DocCell = string | number | null

export interface DocTotal {
  label: string
  level: 'total' | 'subtotal'
  /** 소계가 덮는 마지막 줄(rows 번호, 0부터). 합계는 무시(전체). */
  after_row: number
  values: (number | null)[]
}

export interface DocTable {
  /** AI 종류(kinds.ts AI 목록) · official_statement · unknown */
  doc_kind: string
  company: string | null
  /** 'YYYY-MM'(월 자료) · 'YYYY'(연 결산) */
  period: string | null
  title: string | null
  columns: string[]
  rows: DocCell[][]
  totals: DocTotal[]
  confidence: 'high' | 'medium' | 'low'
  reason: string
  cost_usd?: number
  /** AI 호출 수(긴 글 PDF를 쪽으로 나눠 읽으면 2 이상) — 한도에 센다 */
  calls?: number
}

export interface DocReadInput {
  fileName: string
  format: DocFormat
  text: string
  layout?: LayoutCell[][]
  media: OpenedDoc['media']
  /** official = 세무사 결산으로 보여 계정 · 금액 표로 읽기 */
  expect: 'table' | 'official'
  /** 쪽 나눔까지 쓸 수 있는 AI 호출 수(없으면 1) */
  maxCalls?: number
  /** 이 요청이 끝나야 하는 시각(ms) — 넘길 것 같으면 새 호출을 하지 않는다 */
  deadline?: number
}

export type AiDocReader = (input: DocReadInput) => Promise<DocTable>

const TOTAL_RE = /^(합계|총계|총합계|계|월계|누계|total|grandtotal)$/i
const SUBTOTAL_RE = /^(소계|subtotal)$/i

export function parseNumber(t: string): number | null {
  const s = t.replace(/[,\s원₩$]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/^[△▲]/, '-')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const isNumCell = (t: string) => parseNumber(t) !== null

/**
 * 글 PDF 줄 · 칸(x) → 표. 머리글 = 앞 15줄 중 숫자 아닌 칸이 가장 많은 줄(2칸 이상). 그 위는 제목.
 * 아래 줄의 칸은 머리글 칸 중 x가 가장 가까운 칸으로(빈칸 자리를 지킨다). 합계 · 소계 줄은 totals로.
 */
export function layoutToTable(layout: LayoutCell[][]): DocTable {
  let head = -1
  let best = 1
  layout.slice(0, 15).forEach((line, i) => {
    const words = line.filter((c) => !isNumCell(c.t)).length
    if (line.length >= 2 && words === line.length && words > best) {
      best = words
      head = i
    }
  })
  const title = layout
    .slice(0, Math.max(0, head))
    .map((l) => l.map((c) => c.t).join(' '))
    .join(' ')
  const p = detectPeriod(title)
  const period = p ? (p.from.slice(0, 7) === p.to.slice(0, 7) ? p.from.slice(0, 7) : p.to.slice(0, 7)) : null
  if (head < 0) return { doc_kind: 'unknown', company: null, period, title: title || null, columns: [], rows: [], totals: [], confidence: 'low', reason: '머리글 줄을 찾지 못했습니다', }
  const anchors = layout[head].map((c) => c.x)
  const columns = layout[head].map((c) => c.t)
  const rows: DocCell[][] = []
  const totals: DocTotal[] = []
  for (const line of layout.slice(head + 1)) {
    const out: DocCell[] = new Array(anchors.length).fill(null)
    for (const c of line) {
      let k = 0
      anchors.forEach((a, i) => {
        if (Math.abs(a - c.x) < Math.abs(anchors[k] - c.x)) k = i
      })
      const n = parseNumber(c.t)
      out[k] = out[k] === null ? (n ?? c.t) : `${out[k]} ${c.t}`
    }
    const label = normalizeLabel(String(out.find((v) => typeof v === 'string') ?? ''))
    if (TOTAL_RE.test(label) || SUBTOTAL_RE.test(label)) {
      totals.push({ label, level: SUBTOTAL_RE.test(label) ? 'subtotal' : 'total', after_row: rows.length - 1, values: out.map((v) => (typeof v === 'number' ? v : null)) })
      continue
    }
    rows.push(out)
  }
  return { doc_kind: 'unknown', company: null, period, title: title || null, columns, rows, totals, confidence: 'medium', reason: '글 PDF의 칸 위치로 세운 표(AI 아님)' }
}

const STMT_SUBTOTAL = /총계$|합계$|^(매출총|영업|법인세비용차감전|법인세차감전|당기순|경상)(이익|손실|순이익|순손실)$/

/** 결산 PDF(글) → 계정 · 금액 표(AI 없이 — 시험용 가짜 AI · 한도 넘음). 한 줄에 글 하나 + 숫자 하나(마지막 숫자)인 줄만. */
export function layoutToStatement(layout: LayoutCell[][]): DocTable {
  const text = layout.map((l) => l.map((c) => c.t).join(' ')).join(' ')
  const year = /(20\d{2})\s*[.년/-]?\s*0?1\s*[.월/-]\s*0?1/.exec(text)?.[1] ?? /(20\d{2})\s*년?\s*(귀속|결산|사업연도)/.exec(text)?.[1] ?? null
  // 해 머리글 줄(«계정과목 2024 2025» — 해 둘 이상)이 있으면 해마다 칸 하나. 없으면 마지막 숫자 하나.
  const yearHead = layout.find((l) => l.filter((c) => /^(19|20)\d{2}(년)?$/.test(c.t.trim())).length >= 2)
  const years = yearHead ? yearHead.map((c) => /^((19|20)\d{2})/.exec(c.t.trim())?.[1]).filter((y): y is string => !!y) : []
  const width = Math.max(1, years.length)
  const rows: DocCell[][] = []
  const totals: DocTotal[] = []
  for (const line of layout) {
    if (line === yearHead) continue
    const label = line.filter((c) => !isNumCell(c.t)).map((c) => c.t).join(' ').trim()
    const nums = line.map((c) => parseNumber(c.t)).filter((n): n is number => n !== null)
    if (!label) continue
    // 숫자 없는 제목 줄(«재무상태표» · «제조원가명세서»)도 넘긴다 — 묶음 단서다.
    const vals: DocCell[] = nums.length ? [...new Array(Math.max(0, width - nums.length)).fill(null), ...nums.slice(-width)] : new Array(width).fill(null)
    const l = normalizeLabel(label)
    if (STMT_SUBTOTAL.test(l)) totals.push({ label: l, level: 'subtotal', after_row: rows.length - 1, values: [null, ...vals] as (number | null)[] })
    else rows.push([label, ...vals])
  }
  return { doc_kind: 'official_statement', company: null, period: years[years.length - 1] ?? year, title: layout[0]?.map((c) => c.t).join(' ') ?? null, columns: ['계정과목', ...(years.length ? years : ['금액'])], rows, totals, confidence: rows.length ? 'medium' : 'low', reason: '글 PDF의 줄에서 계정 · 금액을 읽음(AI 아님)' }
}

/** 시험 · dummy용 가짜 AI(FINANCE_UPLOAD_AI_MOCK=1). 글 PDF는 칸 위치로 읽고 종류는 코드로, 그림(스캔 · 사진)은 읽지 않는다. */
export const mockDocReader: AiDocReader = async (input) => {
  if (!input.layout?.length) {
    return { doc_kind: 'unknown', company: null, period: null, title: null, columns: [], rows: [], totals: [], confidence: 'low', reason: '시험용 가짜 AI는 그림(스캔 · 사진)을 읽지 않습니다', cost_usd: 0 }
  }
  if (input.expect === 'official') return { ...layoutToStatement(input.layout), confidence: 'high', reason: '시험용 가짜 AI(글 PDF 줄 읽기)', cost_usd: 0 }
  const t = layoutToTable(input.layout)
  const kind = classifyByCode(docSheet(t, 'PDF').sheet).kind
  return { ...t, doc_kind: kind, confidence: 'high', reason: `시험용 가짜 AI(칸 위치 · 코드 판단 «${kind}»)`, cost_usd: 0 }
}

function periodRange(period: string | null): string {
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return ''
  const [y, m] = period.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}/${String(m).padStart(2, '0')}/01 ~ ${y}/${String(m).padStart(2, '0')}/${last}`
}

/** 표 → 시트(0070 길로). 제목 줄(문서 제목 + 기간) · 머리글 · 줄 · 합계 줄(«합계» 글을 빈 앞 칸에). */
export function docSheet(t: DocTable, name: string): { sheet: EcountSheet; headerRow: number } {
  const width = Math.min(40, Math.max(t.columns.length, ...t.rows.map((r) => r.length), 1))
  const grid: DocCell[][] = []
  const titleLine = [t.title ?? '', periodRange(t.period)].filter(Boolean).join(' / ')
  if (titleLine) grid.push([titleLine])
  const headerRow = grid.length
  grid.push(t.columns.slice(0, width))
  for (const r of t.rows) grid.push(r.slice(0, width).map((v) => (typeof v === 'string' ? v.slice(0, 200) : v)))
  for (const tot of t.totals.filter((x) => x.level === 'total')) {
    const row: DocCell[] = tot.values.slice(0, width).map((v) => v)
    const at = row.slice(0, 4).findIndex((v) => v === null)
    if (at < 0 && row.length >= 4) continue // 표시할 자리가 없다 — 대조는 checkDocTotals가 한다
    row[at < 0 ? row.length : at] = '합계'
    grid.push(row)
  }
  const colCount = Math.max(1, ...grid.map((r) => r.length))
  const rows = grid.map((r) => {
    const out = new Array(colCount).fill(null).map((_, i) => r[i] ?? null)
    return out.map((v) =>
      typeof v === 'number' && Number.isFinite(v)
        ? { t: 'number' as const, v }
        : typeof v === 'string' && v.trim()
          ? /^\d{4}-\d{2}-\d{2}$/.test(v.trim())
            ? { t: 'date' as const, v: v.trim() }
            : { t: 'text' as const, v }
          : { t: 'empty' as const },
    )
  })
  return { sheet: { name: name.slice(0, 120), rows, colCount }, headerRow }
}

/** 합계 · 소계 줄 = 줄의 합(칸마다, 1원 차이까지 허용). 다르면 문구(→ 미리보기). */
export function checkDocTotals(t: DocTable): string[] {
  const errors: string[] = []
  let from = 0
  for (const tot of t.totals) {
    const end = tot.level === 'subtotal' ? Math.min(t.rows.length - 1, tot.after_row) : t.rows.length - 1
    const start = tot.level === 'subtotal' ? from : 0
    tot.values.forEach((v, i) => {
      if (typeof v !== 'number') return
      const cells = t.rows.slice(start, end + 1).map((r) => r[i])
      if (!cells.some((c) => typeof c === 'number')) return
      const sum = cells.reduce<number>((a, c) => a + (typeof c === 'number' ? c : 0), 0)
      if (Math.abs(sum - v) > 1) errors.push(`합계가 맞지 않습니다 — «${tot.label}» ${t.columns[i] ?? `${i + 1}열`} 칸: 줄의 합 ${sum.toLocaleString('ko-KR')} · 표의 ${tot.level === 'subtotal' ? '소계' : '합계'} ${v.toLocaleString('ko-KR')}.`)
    })
    if (tot.level === 'subtotal') from = end + 1
  }
  return errors
}

/** 글 PDF: AI가 적은 숫자 중 PDF 글에 없는 것의 수(쉼표 · 괄호 음수 무시). */
export function numbersNotInText(t: DocTable, text: string): number {
  const seen = new Set((text.match(/\(?-?[\d,]+(\.\d+)?\)?/g) ?? []).map((s) => parseNumber(s)).filter((n): n is number => n !== null).map((n) => String(Math.abs(n))))
  let missing = 0
  for (const v of [...t.rows.flat(), ...t.totals.flatMap((x) => x.values)]) if (typeof v === 'number' && !seen.has(String(Math.abs(v)))) missing += 1
  return missing
}

/** 회사 이름이 이 회사와 다른가(둘 다 있을 때만 — 법인 꼬리 «(주)» · 띄어쓰기 무시). */
export function companyMismatch(read: string | null, businessName: string): boolean {
  if (!read) return false
  const n = (s: string) => normalizeLabel(s).replace(/\(주\)|㈜|주식회사|co\.?,?ltd\.?|inc\.?/gi, '').toLowerCase()
  const a = n(read)
  const b = n(businessName)
  return !!a && !!b && !a.includes(b) && !b.includes(a)
}

/* ───────────────────────── 처음 3개월 — 사진 · 스캔은 미리보기 ───────────────────────── */

/** 시작일(대표 결정 2026-10-12 C단계) — 이날부터 3개월은 사진 · 스캔 PDF를 자동으로 넣지 않는다. */
export const DOC_REVIEW_START = '2026-10-12'
export const DOC_REVIEW_MONTHS = 3

/** 끝나는 날(이날 전까지 미리보기). env FINANCE_UPLOAD_DOC_REVIEW_UNTIL(YYYY-MM-DD)이 있으면 그 값. */
export function docReviewUntil(env = process.env.FINANCE_UPLOAD_DOC_REVIEW_UNTIL): string {
  if (env && /^\d{4}-\d{2}-\d{2}$/.test(env.trim())) return env.trim()
  const d = new Date(`${DOC_REVIEW_START}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + DOC_REVIEW_MONTHS)
  return d.toISOString().slice(0, 10)
}

/** 사진 · 스캔이고 기간 안이면 이유 한 줄(→ 미리보기). 글 PDF · 엑셀은 null. */
export function forcedDocReview(format: DocFormat, today = new Date()): string | null {
  if (format === 'pdf_text') return null
  const until = docReviewUntil()
  const kst = new Date(today.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
  if (kst >= until) return null
  return `${format === 'image' ? '사진' : '스캔 PDF'}은 ${until} 전까지 믿음이 «높음»이어도 사람이 봅니다(처음 3개월).`
}

/* ───────────────────────── 공식 결산 미리보기 ───────────────────────── */

export interface OfficialDraftLine {
  /** 문서의 줄 이름(번호 그대로) */
  label: string
  /** 표의 어느 부분(자산 · 판관비 · 영업외수익 …) — 계정은 이 묶음 안에서만 맞춘다 */
  group: OfficialGroup | null
  /** 해마다 문서에 찍힌 값(사람이 읽는 양수) — 키 'YYYY' */
  values: Record<string, number>
  /** period_key 해의 값(없으면 0) */
  printed: number
  account_code: string | null
  account_name: string | null
  section: AccountSection | null
  /** 어떻게 맞췄나 — learned · exact는 확정, 나머지는 «제안»(사람 승인) */
  how: MatchHow | null
  /** 맞춤 믿음 — 화면이 low만 노란색으로 */
  confidence: 'high' | 'medium' | 'low' | null
  /** 학습 표 열쇠(«묶음:이름») — 저장할 때 이 줄의 계정을 학습한다 */
  std_key: string
  /** 처음부터 «넣지 않음»(제조원가명세서 줄 — 매출원가에 이미 들어 있다) */
  skip: boolean
  /** period_key 해를 원장 규약(차변 − 대변)으로 바꾼 값. 계정을 못 맞추거나 넣지 않으면 null */
  amount: number | null
}

export interface OfficialDraft {
  /** 가장 늦은 해(화면이 처음 여는 해) */
  period_key: string | null
  /** 문서에 든 해(오름차순) — 해마다 따로 저장한다 */
  years: string[]
  /** 해마다 문서의 당기순이익(있으면) — 화면이 맞춘 줄로 계산한 값과 대조한다 */
  net_income: Record<string, number>
  company: string | null
  title: string | null
  lines: OfficialDraftLine[]
  unmatched: number
  balance: BalanceCheck | null
  errors: string[]
  warnings: string[]
  reason: string
  /** 회사 계정과목표가 비었다 — 화면 맨 위 «먼저 계정과목표를 올려 주세요» · 저장 막음 */
  no_accounts: boolean
  /** 해를 어디서 알았나(칸 머리글 · 파일 이름 · 표지 · 모름) — 모르면 화면이 적게 한다 */
  year_from: 'columns' | 'file_name' | 'cover' | 'unknown'
  /** 0083: 올린 원본을 증빙으로 보관한 경로(fin-official-evidence) — 없으면 링크를 적어야 한다 */
  evidence_file: string | null
  /** 증빙 보관이 안 된 까닭(0083 전 DB · 권한 · 실패) */
  evidence_note: string | null
  /** AI가 계정을 제안한 줄 수(2차 맞춤) */
  ai_suggested: number
}

const MATCH_CONFIDENCE: Record<MatchHow, 'high' | 'medium' | 'low'> = { learned: 'high', exact: 'high', alias: 'medium', near: 'low', group: 'low', ai: 'low' }

/**
 * 결산 해 짐작 — 파일 이름(«2023~5 표준재무제표» → 2023 · 2024 · 2025, «2025 결산») · 표지 글(«2025년 12월 31일 현재»).
 * 해 칸이 없을 때(한 해짜리 · AI 없이 읽음)의 기본값이다. 사람이 바꿀 수 있다.
 */
export function guessYears(fileName: string, cover = ''): { years: string[]; from: OfficialDraft['year_from'] } {
  const f = fileName.normalize('NFKC')
  const range = /(20\d{2})\s*[~\-–]\s*(20)?(\d{1,2})(?!\d)/.exec(f)
  if (range) {
    const a = Number(range[1])
    const tail = range[3]
    const b = tail.length === 2 ? Number(`20${tail}`) : Math.floor(a / 10) * 10 + Number(tail)
    if (b > a && b - a <= 5) return { years: Array.from({ length: b - a + 1 }, (_, i) => String(a + i)), from: 'file_name' }
  }
  const inName = [...f.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map((m) => m[1])
  if (inName.length) return { years: [...new Set(inName)].sort(), from: 'file_name' }
  const c = cover.normalize('NFKC').slice(0, 3000)
  const dated = [...c.matchAll(/(20\d{2})\s*년\s*12\s*월\s*31\s*일/g)].map((m) => m[1])
  if (dated.length) return { years: [...new Set(dated)].sort(), from: 'cover' }
  return { years: [], from: 'unknown' }
}

type OfficialAcc = Pick<Account, 'account_code' | 'name' | 'section'>

const unmatchedWarning = (n: number) => `계정과목을 못 맞춘 줄 ${n}개 — 줄마다 계정을 고르거나 «넣지 않음»으로 두세요(묶음마다 한 번에 고를 수 있습니다).`

/** 묶음 줄(합계 · 소계 · 매출원가 계산 줄) — 저장 줄이 아니다. */
const STMT_AGGREGATE = /총계$|합계$|^(매출총|영업|법인세비용차감전|법인세차감전|당기순|경상|세전)(이익|손실|순이익|순손실|이익\(손실\)|손익)/
const BS_HEADS = /^(유동자산|당좌자산|재고자산|비유동자산|투자자산|기타비유동자산|유동부채|비유동부채|자본잉여금|자본조정|기타포괄손익누계액|이익잉여금\(결손금\)|자산|부채|자본)$/
const COGS_CALC = /^(기초|기말)(상품|제품|원재료|재공품|부재료|저장품)?재고(액)?$|^당기(상품매입액|제품제조원가|총제조비용|원재료매입액|매입액)$|타계정/
/** 줄 없이 묶음만 알려 주는 제목 낱말(구분 칸이 없을 때 — 가짜 AI · AI 없이) */
const HEAD_GROUP: [RegExp, OfficialGroup][] = [
  [/원가명세서|^재료비$|^노무비$|^제조경비$|^경비$/, 'mfg'],
  [/잉여금|자본조정|포괄손익누계/, 'equity'],
]

/** 해 칸 찾기 — 머리글의 해 · 당기/전기 · (해 칸이 없으면) 마지막 숫자 칸을 base 해로. */
function yearColumns(columns: string[], skip: Set<number>, base: string | null): Map<number, string> {
  const out = new Map<number, string>()
  columns.forEach((c, i) => {
    if (skip.has(i)) return
    const h = c.normalize('NFKC').replace(/\s/g, '')
    const y = /(19|20)\d{2}/.exec(h)?.[0]
    if (y) out.set(i, y)
    else if (base && /^당기|^당해/.test(h)) out.set(i, base)
    else if (base && /^전기/.test(h)) out.set(i, String(Number(base) - 1))
  })
  return out
}

export interface OfficialDraftOptions {
  /** 0083 학습 표 «묶음:이름» → 계정 코드 */
  learned?: ReadonlyMap<string, string>
  /** 표지 · 첫 쪽 글(해 짐작) */
  cover?: string
}

export function buildOfficialDraft(t: DocTable, accounts: OfficialAcc[], fileName: string, opts: OfficialDraftOptions = {}): OfficialDraft {
  const cols = t.columns.map((c) => String(c ?? '').normalize('NFKC').replace(/\s/g, ''))
  const find = (re: RegExp) => cols.findIndex((c) => re.test(c))
  const groupIdx = find(/^구분$|^분류$|^표$|^부분$/)
  const levelIdx = find(/^줄$|^수준$|^종류$|^level$/i)
  const labelIdx = find(/계정|과목|항목|내역/)
  const guess = guessYears(fileName, opts.cover)
  const base = (t.period && /^(20\d{2})/.exec(t.period)?.[1]) ?? guess.years[guess.years.length - 1] ?? null
  const yearCols = yearColumns(t.columns, new Set([groupIdx, levelIdx, labelIdx].filter((i) => i >= 0)), base)

  type Row = { label: string; name: string; group: OfficialGroup | null; aggregate: boolean; values: Record<string, number> }
  const rows: Row[] = []
  let current: OfficialGroup | null = null
  const read = (r: DocCell[], forcedAggregate: boolean) => {
    const label = (labelIdx >= 0 && typeof r[labelIdx] === 'string' ? (r[labelIdx] as string) : r.find((v, i): v is string => typeof v === 'string' && !!v.trim() && i !== groupIdx && i !== levelIdx))?.trim()
    if (!label) return
    const { name, mark } = cleanLabel(label)
    const values: Record<string, number> = {}
    if (yearCols.size) {
      for (const [i, y] of yearCols) if (typeof r[i] === 'number') values[y] = r[i] as number
    } else {
      // 해 칸이 없다 — 마지막 숫자를 base 해로(해도 모르면 '' — 화면이 해를 적게 한다).
      const nums = r.filter((v): v is number => typeof v === 'number')
      if (nums.length) values[base ?? ''] = nums[nums.length - 1]
    }
    const lv = levelIdx >= 0 && typeof r[levelIdx] === 'string' ? (r[levelIdx] as string) : ''
    const plainName = name.replace(/\s/g, '')
    const aggregate =
      forcedAggregate ||
      /소계|합계|묶음|총계|계산/.test(lv) ||
      mark === 'roman' ||
      (mark === 'paren' && !/항목|계정/.test(lv)) ||
      STMT_AGGREGATE.test(plainName) ||
      BS_HEADS.test(plainName) ||
      COGS_CALC.test(plainName)
    // 묶음: 구분 칸(AI)이 이기고, 없으면 제목 · 묶음 줄 이름으로 이어 간다.
    const stated = groupIdx >= 0 ? groupOf(r[groupIdx]) : null
    if (stated) current = stated
    else if (aggregate || !Object.keys(values).length) {
      const head = HEAD_GROUP.find(([re]) => re.test(plainName))?.[1] ?? (STMT_AGGREGATE.test(plainName) ? null : groupOf(plainName))
      if (head) current = head
    }
    rows.push({ label, name, group: stated ?? current, aggregate, values })
  }
  for (const r of t.rows) read(r, false)
  for (const tot of t.totals) read(tot.values.map((v, i) => (i === (labelIdx >= 0 ? labelIdx : 0) ? tot.label : v)), true)

  const hasNum = (r: Row) => Object.keys(r.values).length > 0
  // 해마다 따로 읽힌 같은 계정(쪽을 나눠 읽음 · 해마다 다른 줄)을 한 줄로 — 같은 묶음 · 같은 이름이고 해가 겹치지 않을 때만
  // (같은 해에 같은 이름이 둘이면 «건물 · 기계장치 각각의 감가상각누계액»처럼 따로 있는 줄이다).
  const leaves: Row[] = []
  for (const r of rows.filter((x) => !x.aggregate && hasNum(x))) {
    const same = leaves.find((x) => x.group === r.group && plain(x.name) === plain(r.name) && Object.keys(r.values).every((y) => !(y in x.values)))
    if (same) Object.assign(same.values, r.values)
    else leaves.push(r)
  }
  // 묶음에 낱 줄이 하나도 없으면(«Ⅱ.매출원가» 한 줄만 있고 아래는 계산 줄) 그 묶음 줄을 낱 줄로 쓴다.
  const leafGroups = new Set(leaves.map((r) => r.group))
  const promoted = new Set<OfficialGroup>()
  for (const r of rows) {
    if (!r.aggregate || !hasNum(r) || !r.group || leafGroups.has(r.group) || promoted.has(r.group)) continue
    if (STMT_AGGREGATE.test(r.name.replace(/\s/g, '')) || COGS_CALC.test(r.name.replace(/\s/g, ''))) continue
    promoted.add(r.group)
    leaves.push(r)
  }
  const ordered = rows.filter((r) => leaves.includes(r))

  const years = [...new Set(ordered.flatMap((r) => Object.keys(r.values)))].sort()
  const year = years[years.length - 1] ?? base ?? ''
  const net_income: Record<string, number> = {}
  for (const r of rows) {
    if (!/^당기순(이익|손실)/.test(r.name.replace(/\s/g, ''))) continue
    for (const [y, v] of Object.entries(r.values)) if (!(y in net_income)) net_income[y] = /^당기순손실/.test(r.name.replace(/\s/g, '')) && v > 0 ? -v : v
  }

  const lines: OfficialDraftLine[] = ordered.map((r) => {
    const m = matchOfficial(r.name, r.group, accounts, opts.learned)
    const skip = r.group === 'mfg'
    const printed = r.values[year] ?? 0
    return {
      label: r.label.slice(0, 80),
      group: r.group,
      values: r.values,
      printed,
      account_code: m?.acc.account_code ?? null,
      account_name: m?.acc.name ?? null,
      section: m?.acc.section ?? null,
      how: m?.how ?? null,
      confidence: m ? MATCH_CONFIDENCE[m.how] : null,
      std_key: stdKey(r.group, r.name),
      skip,
      amount: m && !skip ? signedAmount(m.acc.section, m.acc.name, printed, r.name) : null,
    }
  })
  const live = lines.filter((l) => !l.skip)
  const matched = live.filter((l) => l.account_code && l.section && l.amount !== null)
  const summed = officialLines(matched.map((l) => ({ label: l.label, account: { account_code: l.account_code!, name: l.account_name!, section: l.section! }, printed: l.printed })))
  const balance = summed.length ? balanceCheck(summed) : null
  const errors: string[] = []
  const warnings: string[] = []
  const unmatched = live.length - matched.length
  if (!lines.length) errors.push('계정 · 금액 줄을 읽지 못했습니다 — «공식 결산» 화면에서 손으로 넣어 주세요.')
  if (unmatched) warnings.push(unmatchedWarning(unmatched))
  const skipped = lines.length - live.length
  if (skipped) warnings.push(`제조원가명세서 줄 ${skipped}개는 처음부터 «넣지 않음» — 매출원가에 이미 들어 있습니다(넣으면 원가가 두 번 셉니다).`)
  if (!accounts.length) errors.push(NO_ACCOUNTS_MSG)
  if (!year) errors.push('결산 연도를 찾지 못했습니다 — 연도를 적어 주세요.')
  if (years.length > 1) warnings.push(`여러 해(${years.filter(Boolean).join(' · ')})가 들어 있습니다 — 해마다 따로 저장합니다(아래에서 해를 고르세요).`)
  if (balance && !balance.balanced) warnings.push(`${year || '이 해'} 재무상태표가 닫히지 않습니다 — 자산 − (부채 + 자본) = ${balance.difference.toLocaleString('ko-KR')}원(계정 · 부호를 확인하세요).`)
  const suggested = lines.filter((l) => !l.skip && isSuggestion(l.how)).length
  if (suggested) warnings.push(suggestWarning(suggested, 0))
  const yearFrom: OfficialDraft['year_from'] = yearCols.size || t.period ? 'columns' : guess.from
  return {
    period_key: year || null,
    years: years.length ? years : [year],
    net_income,
    company: t.company,
    title: t.title,
    lines,
    unmatched,
    balance,
    errors,
    warnings,
    reason: t.reason,
    no_accounts: !accounts.length,
    year_from: year ? yearFrom : 'unknown',
    evidence_file: null,
    evidence_note: null,
    ai_suggested: 0,
  }
}

export const NO_ACCOUNTS_MSG =
  '이 회사 계정과목표가 비어 있습니다 — 먼저 계정과목표(ECOUNT 기초데이터 › 계정 내려받기)를 올려 주세요. 그 전까지는 표준 계정 이름을 임시 후보로만 보이고 저장하지 않습니다.'

const suggestWarning = (n: number, ai: number) =>
  `이름이 똑같지 않아 비슷한 계정을 제안한 줄 ${n}개${ai ? `(AI ${ai}개 포함)` : ''} — 확인하고 «제안 전부 승인»을 눌러 주세요.`

/** AI 2차 맞춤 한 줄 — line은 draft.lines 번호 */
export interface OfficialAiSuggestion {
  line: number
  account_code: string | null
  confidence: 'high' | 'medium' | 'low'
}

/**
 * AI 제안을 아직 못 맞춘 줄에만 얹는다(코드가 맞춘 줄 · 넣지 않음 줄은 건드리지 않는다). 계정은 이 회사 계정과목표에 있고
 * 그 줄의 묶음(자산 · 판관비 …) 안이어야 한다 — 아니면 버린다(AI가 지어낸 코드 · 매출을 판관비로 같은 실수). 순수.
 */
export function applyOfficialSuggestions(draft: OfficialDraft, items: OfficialAiSuggestion[], accounts: OfficialAcc[]): number {
  let n = 0
  for (const it of items) {
    const l = draft.lines[it.line]
    if (!l || l.skip || l.account_code || !it.account_code) continue
    const acc = accounts.find((a) => a.account_code === it.account_code)
    if (!acc || (l.group && !GROUP_SECTIONS[l.group].includes(acc.section))) continue
    l.account_code = acc.account_code
    l.account_name = acc.name
    l.section = acc.section
    l.how = 'ai'
    l.confidence = it.confidence
    l.amount = signedAmount(acc.section, acc.name, l.printed, cleanLabel(l.label).name)
    n += 1
  }
  if (!n) return 0
  draft.ai_suggested = n
  const live = draft.lines.filter((l) => !l.skip)
  draft.unmatched = live.filter((l) => !l.account_code).length
  draft.warnings = draft.warnings.filter((w) => !/^계정과목을 못 맞춘 줄|^이름이 똑같지 않아/.test(w))
  if (draft.unmatched) draft.warnings.unshift(unmatchedWarning(draft.unmatched))
  draft.warnings.push(suggestWarning(live.filter((l) => isSuggestion(l.how)).length, n))
  return n
}
