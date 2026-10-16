import { normalizeLabel, detectPeriod } from '@/lib/ecount/excel/detect'
import type { EcountSheet } from '@/lib/ecount/excel/workbook'
import { balanceCheck, type BalanceCheck } from '@/lib/statements/balance'
import type { Account, AccountSection } from '@/types'

import type { DocFormat, LayoutCell, OpenedDoc } from './doc-open'
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
  const rows: DocCell[][] = []
  const totals: DocTotal[] = []
  for (const line of layout) {
    const label = line.find((c) => !isNumCell(c.t))?.t
    const nums = line.map((c) => parseNumber(c.t)).filter((n): n is number => n !== null)
    if (!label || !nums.length || /^\d/.test(label)) continue
    const l = normalizeLabel(label)
    if (STMT_SUBTOTAL.test(l)) totals.push({ label: l, level: 'subtotal', after_row: rows.length - 1, values: [null, nums[nums.length - 1]] })
    else rows.push([label, nums[nums.length - 1]])
  }
  return { doc_kind: 'official_statement', company: null, period: year, title: layout[0]?.map((c) => c.t).join(' ') ?? null, columns: ['계정과목', '금액'], rows, totals, confidence: rows.length ? 'medium' : 'low', reason: '글 PDF의 줄에서 계정 · 금액을 읽음(AI 아님)' }
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
  label: string
  /** 문서에 찍힌 값(사람이 읽는 양수) */
  printed: number
  account_code: string | null
  account_name: string | null
  section: AccountSection | null
  /** 원장 규약(차변 − 대변)으로 바꾼 값. 계정을 못 맞추면 null */
  amount: number | null
}

export interface OfficialDraft {
  period_key: string | null
  company: string | null
  title: string | null
  lines: OfficialDraftLine[]
  unmatched: number
  balance: BalanceCheck | null
  errors: string[]
  warnings: string[]
  reason: string
}

const plain = (s: string) => normalizeLabel(s).replace(/\(.*?\)|[·.\s]/g, '').toLowerCase()

export function matchAccount(label: string, accounts: Pick<Account, 'account_code' | 'name' | 'section'>[]): Pick<Account, 'account_code' | 'name' | 'section'> | null {
  const l = plain(label)
  if (!l) return null
  const exact = accounts.filter((a) => plain(a.name) === l)
  if (exact.length === 1) return exact[0]
  const near = accounts.filter((a) => {
    const n = plain(a.name)
    return n.length >= 2 && (n.startsWith(l) || l.startsWith(n))
  })
  return near.length === 1 ? near[0] : null
}

export function buildOfficialDraft(t: DocTable, accounts: Pick<Account, 'account_code' | 'name' | 'section'>[], fileName: string): OfficialDraft {
  const lines: OfficialDraftLine[] = []
  for (const r of t.rows) {
    const label = r.find((v): v is string => typeof v === 'string' && !!v.trim())
    const nums = r.filter((v): v is number => typeof v === 'number')
    if (!label || !nums.length) continue
    const printed = nums[nums.length - 1]
    const acc = matchAccount(label, accounts)
    lines.push({ label: label.slice(0, 80), printed, account_code: acc?.account_code ?? null, account_name: acc?.name ?? null, section: acc?.section ?? null, amount: acc ? signedAmount(acc.section, acc.name, printed) : null })
  }
  const year = (t.period && /^(20\d{2})/.exec(t.period)?.[1]) ?? /(20\d{2})/.exec(fileName.normalize('NFKC'))?.[1] ?? null
  const matched = lines.filter((l) => l.account_code && l.section && l.amount !== null)
  const balance = matched.length ? balanceCheck(matched.map((l) => ({ account_code: l.account_code!, section: l.section!, amount: l.amount! }))) : null
  const errors: string[] = []
  const warnings: string[] = []
  const unmatched = lines.length - matched.length
  if (!lines.length) errors.push('계정 · 금액 줄을 읽지 못했습니다 — «공식 결산» 화면에서 손으로 넣어 주세요.')
  if (unmatched) warnings.push(`계정과목을 못 맞춘 줄 ${unmatched}개 — 줄마다 계정을 골라 주세요.`)
  if (!year) errors.push('결산 연도를 찾지 못했습니다 — 연도를 적어 주세요.')
  if (balance && !balance.balanced) warnings.push(`재무상태표가 닫히지 않습니다 — 자산 − (부채 + 자본) = ${balance.difference.toLocaleString('ko-KR')}원(계정 · 부호를 확인하세요).`)
  return { period_key: year, company: t.company, title: t.title, lines, unmatched, balance, errors, warnings, reason: t.reason }
}
