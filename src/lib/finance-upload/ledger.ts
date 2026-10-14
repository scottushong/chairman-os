import { cellText, type EcountCell } from '@/lib/ecount/excel/cells'
import type { EcountSheet } from '@/lib/ecount/excel/workbook'

/**
 * ⑤ 계정별 원장의 **구조**(2026-10-14 운영 첫 사용 고침). 순수 함수 — check:finance-upload가 잰다.
 *
 * 운영에서 본 것: ECOUNT 원장의 요약 줄(일계 · 월계 · 누계 · 합계 · 이월)을 거래로 더해 계정 합이 합계 줄의 정확히 2배가 됐다.
 * 그래서 줄마다 «무슨 줄인지»(거래 · 이월 · 일계 · 월계 · 누계 · 합계 · 소계 · 계정 머리)를 먼저 정하고 **거래 줄만** 더한 뒤
 * 요약 줄과 대조한다. 줄 종류는 세 곳에서 온다:
 *   1. 기본 규칙(낱말) — AI가 없어도 2배가 나지 않게. «[ 월 계 ]» · «1월 계» · «< 누계 >»처럼 괄호 · 띄어쓰기가 달라도 알아본다.
 *   2. AI 해석(ai.ts) — 시트에서 본 요약 줄 낱말 · 칸 대응. 숫자는 보내지 않는다(«<숫자>»).
 *   3. 학습(fin_upload_shapes) — 맞게 해석된 모양. 같은 양식은 다음부터 AI 없이.
 * 잔액 칸이 있으면 «앞 잔액 ± (차변 − 대변) = 이 줄 잔액»으로 차변 · 대변 · 잔액 칸 대응을 확인한다(잔액을 대변으로 읽지 않게).
 */

export type RowRole = 'carry' | 'day' | 'month' | 'cumulative' | 'total' | 'subtotal' | 'skip'
export const ROW_ROLES: readonly RowRole[] = ['carry', 'day', 'month', 'cumulative', 'total', 'subtotal', 'skip']
export const ROLE_KO: Record<RowRole | 'tx' | 'account_head' | 'header', string> = {
  tx: '거래',
  carry: '이월',
  day: '일계',
  month: '월계',
  cumulative: '누계',
  total: '합계',
  subtotal: '소계',
  skip: '버림',
  account_head: '계정 머리',
  header: '머리글',
}

export const LEDGER_COLS = ['date', 'account_code', 'account_name', 'memo', 'counterparty', 'debit', 'credit', 'balance'] as const
export type LedgerCol = (typeof LEDGER_COLS)[number]

export interface RowLabel {
  text: string
  role: RowRole
}

export interface LedgerLayout {
  headerRow: number
  cols: Partial<Record<LedgerCol, number>>
  /** AI · 학습이 본 요약 줄 낱말(핵심 글 — labelCore) */
  labels: RowLabel[]
  /** 계정 머리 줄에서 계정 코드가 있는 열(AI가 본 것). 없으면 기본 규칙(«1509(제품)» · «[1509] 제품» …) */
  headCol?: number | null
  /** 잔액 흐름으로 칸을 바로잡았으면 그 문구 */
  note?: string
}

/* ───────────────────────── 칸 읽기 ───────────────────────── */

export function cellNum(c: EcountCell | undefined): number | null | 'bad' {
  if (!c || c.t === 'empty') return null
  if (c.t === 'number') return c.v
  if (c.t === 'text') {
    const t = c.v.replace(/[,\s원₩$]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/^△/, '-').replace(/^▲/, '-')
    if (t === '' || t === '-') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : 'bad'
  }
  return 'bad'
}

export function cellDate(c: EcountCell | undefined): string | null | 'bad' {
  if (!c || c.t === 'empty') return null
  if (c.t === 'date') return c.v
  const t = cellText(c).trim()
  const m = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/.exec(t)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const m2 = /^(\d{1,2})[./-](\d{1,2})(?:\s*-\s*\d+)?$/.exec(t)
  if (m2) return `0000-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`
  if (c.t === 'number' && c.v > 20000 && c.v < 80000) return new Date(Date.UTC(1899, 11, 30) + c.v * 86_400_000).toISOString().slice(0, 10)
  return 'bad'
}

/* ───────────────────────── 줄 종류(기본 규칙) ───────────────────────── */

/** 낱말의 핵심 글 — 띄어쓰기 · 괄호 · 별표 · 쌍점 · 줄표를 걷는다(«[ 월   계 ]» → «월계»). */
export function labelCore(t: string): string {
  return t
    .normalize('NFKC')
    .replace(/[\s[\](){}<>【】〔〕「」『』《》*·•:：\-_=~.,'"]/g, '')
    .toLowerCase()
}

const BUILTIN: { role: RowRole; re: RegExp }[] = [
  { role: 'carry', re: /^(전기|전월|전년|차기|차월|전기말|기초|월초)?이월(잔액|금액|액)?$|^기초잔액$/ },
  { role: 'day', re: /^(일계|일합계|일소계|일자계|일별계|일별합계)$/ },
  { role: 'month', re: /^(월계|월합계|월소계|당월계|당월합계|월별계|월별합계|\d{1,2}월(계|합계|소계))$/ },
  { role: 'cumulative', re: /^(누계|누적|누적계|누적합계|당기누계|누계합계|누적액)$/ },
  { role: 'subtotal', re: /^(소계|subtotal)$/ },
  { role: 'total', re: /^(합계|총계|총합계|계|합|총액|total|grandtotal|sum)$/ },
]

/** 기본 규칙만으로 낱말 하나의 줄 종류. 거래 낱말이면 null. */
export function builtinRole(text: string): RowRole | null {
  const core = labelCore(text)
  if (!core || core.length > 12) return null
  return BUILTIN.find((b) => b.re.test(core))?.role ?? null
}

/** 줄의 글 칸들에서 줄 종류(학습 · AI 낱말이 먼저, 그다음 기본 규칙). 거래 · 머리 줄이면 null. */
export function rowRole(row: EcountCell[], labels: readonly RowLabel[] = []): RowRole | null {
  const wanted = labels.map((l) => ({ core: labelCore(l.text), role: l.role })).filter((l) => l.core)
  for (const c of row) {
    if (c.t !== 'text') continue
    const core = labelCore(c.v)
    if (!core || core.length > 16) continue
    const hit = wanted.find((w) => w.core === core)
    if (hit) return hit.role
    const b = builtinRole(c.v)
    if (b) return b
  }
  return null
}

const HEAD_IN_TITLE = /계정별\s*원장[^\d]*?(\d{3,6})\s*\(([^)]+)\)/
const HEAD_CELL = [
  /^\s*(?:계정(?:과목)?\s*[:：]?\s*)?\[?\s*(\d{3,6})\s*\]?\s*\(\s*([^()]{1,40}?)\s*\)\s*$/, // 1509(제품) · 계정: 1509(제품)
  /^\s*(?:계정(?:과목)?\s*[:：]?\s*)?\[\s*(\d{3,6})\s*\]\s*([^\d[\]()][^[\]()]{0,39}?)\s*$/, // [1509] 제품
  /^\s*(?:계정(?:과목)?\s*[:：]\s*)(\d{3,6})\s+([^\d\s][^()]{0,39}?)\s*$/, // 계정: 1509 제품
]

/** 계정 머리 줄이면 {코드, 이름}. 차변 · 대변 칸에 숫자가 있으면 머리 줄이 아니다. */
export function accountHead(row: EcountCell[], layout: Pick<LedgerLayout, 'cols' | 'headCol'>): { code: string; name: string } | null {
  const { debit, credit } = layout.cols
  const hasAmt = [debit, credit].some((i) => i !== undefined && typeof cellNum(row[i]) === 'number')
  if (hasAmt) return null
  const line = row.map(cellText).join(' ')
  const t = HEAD_IN_TITLE.exec(line)
  if (t) return { code: t[1], name: t[2].trim() }
  for (const c of row) {
    if (c.t !== 'text') continue
    for (const re of HEAD_CELL) {
      const m = re.exec(c.v)
      if (m) return { code: m[1], name: m[2].trim() }
    }
  }
  // AI가 본 머리 열: 코드 칸(3~6자리) + 다음 글 칸 = 이름
  if (layout.headCol !== null && layout.headCol !== undefined) {
    const c = row[layout.headCol]
    const code = c ? (c.t === 'number' ? String(c.v) : c.t === 'text' ? c.v.trim() : '') : ''
    const m = /^\[?(\d{3,6})\]?\s*(.*)$/.exec(code)
    if (m) {
      const rest = m[2].replace(/^[()\s]+|[()\s]+$/g, '')
      const name = rest || row.slice(layout.headCol + 1).map(cellText).find((x) => x.trim() && !/^\d+$/.test(x.trim()))?.trim() || ''
      if (name) return { code: m[1], name: name.slice(0, 40) }
    }
  }
  return null
}

/* ───────────────────────── 칸 대응(코드) ───────────────────────── */

const COL_WORDS: { col: LedgerCol; re: RegExp }[] = [
  { col: 'debit', re: /^차변(금액)?$/ },
  { col: 'credit', re: /^대변(금액)?$/ },
  { col: 'balance', re: /^(잔액|잔고|잔액금액|누계잔액)$/ },
  { col: 'date', re: /^(일자|날짜|전표일자|거래일자|거래일|월일|일자no\.?|일자no|일자번호)/ },
  { col: 'memo', re: /^(적요|내용|적요내용|摘要)$/ },
  { col: 'counterparty', re: /^(거래처|거래처명|상호)$/ },
  { col: 'account_code', re: /^(계정코드|코드)$/ },
  { col: 'account_name', re: /^(계정명|계정과목)$/ },
]

function headLabel(c: EcountCell | undefined): string {
  return labelCore(cellText(c ?? { t: 'empty' }))
}

/** 차변 · 대변이 함께 있는 첫 줄을 머리글로 — 없으면 null. 잔액은 그 줄 또는 위 두 줄(두 줄 머리글)에서. */
export function ledgerLayoutByCode(sheet: EcountSheet): LedgerLayout | null {
  for (let r = 0; r < Math.min(60, sheet.rows.length); r += 1) {
    const labels = sheet.rows[r].map(headLabel)
    if (!labels.some((l) => /^차변(금액)?$/.test(l)) || !labels.some((l) => /^대변(금액)?$/.test(l))) continue
    const cols: Partial<Record<LedgerCol, number>> = {}
    for (const w of COL_WORDS) {
      const i = labels.findIndex((l, idx) => w.re.test(l) && !Object.values(cols).includes(idx))
      if (i >= 0) cols[w.col] = i
    }
    for (let up = 1; up <= 2 && r - up >= 0; up += 1) {
      const above = sheet.rows[r - up].map(headLabel)
      for (const w of COL_WORDS) {
        if (cols[w.col] !== undefined) continue
        const i = above.findIndex((l, idx) => w.re.test(l) && !Object.values(cols).includes(idx))
        if (i >= 0) cols[w.col] = i
      }
    }
    return fixByBalance(sheet, { headerRow: r, cols, labels: [] })
  }
  return null
}

/** 잔액 흐름 맞음 비율(0~1) — 거래 줄마다 «앞 잔액 ± (차변 − 대변) = 잔액». 비교할 줄이 셋 미만이면 null. */
export function balanceFit(sheet: EcountSheet, layout: LedgerLayout): number | null {
  const { debit, credit, balance } = layout.cols
  if (debit === undefined || credit === undefined || balance === undefined) return null
  let prev: number | null = null
  let ok = 0
  let seen = 0
  for (let r = layout.headerRow + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r]
    if (isHeaderRow(row) || accountHead(row, layout)) {
      prev = null
      continue
    }
    const role = rowRole(row, layout.labels)
    const b = cellNum(row[balance])
    if (role === 'carry') {
      prev = typeof b === 'number' ? b : prev
      continue
    }
    if (role) continue
    const d = cellNum(row[debit])
    const c = cellNum(row[credit])
    if (typeof b !== 'number' || d === 'bad' || c === 'bad' || (d === null && c === null)) continue
    if (prev !== null) {
      seen += 1
      const mv = (d ?? 0) - (c ?? 0)
      if (Math.abs(prev + mv - b) <= 1 || Math.abs(prev - mv - b) <= 1) ok += 1
    }
    prev = b
  }
  return seen >= 3 ? ok / seen : null
}

/**
 * 차변 · 대변 · 잔액 칸 셋을 바꿔 끼워 잔액 흐름이 가장 잘 맞는 대응을 고른다. 지금 대응이 반도 안 맞고 다른 대응이 90% 이상 맞을 때만 바꾼다.
 * (운영: 대변 합계가 음수로 읽혔다 — 잔액 칸을 대변으로 읽은 것으로 보였다.)
 */
export function fixByBalance(sheet: EcountSheet, layout: LedgerLayout): LedgerLayout {
  const { debit, credit, balance } = layout.cols
  if (debit === undefined || credit === undefined || balance === undefined) return layout
  // 지금 대응으로 잔액을 거의 못 읽으면(null — 잔액 칸이 비어 있는 줄이 많다 = 잔액이 아닌 칸일 수 있다) 다른 대응도 본다.
  const base = balanceFit(sheet, layout)
  if (base !== null && base >= 0.5) return layout
  const three = [debit, credit, balance]
  const perms = [
    [0, 2, 1],
    [1, 0, 2],
    [2, 1, 0],
    [1, 2, 0],
    [2, 0, 1],
  ]
  let best: { fit: number; l: LedgerLayout } | null = null
  for (const p of perms) {
    const l = { ...layout, cols: { ...layout.cols, debit: three[p[0]], credit: three[p[1]], balance: three[p[2]] } }
    const fit = balanceFit(sheet, l)
    if (fit !== null && fit >= 0.9 && (!best || fit > best.fit)) best = { fit, l }
  }
  if (!best) return layout
  return { ...best.l, note: `잔액 흐름이 맞지 않아 차변 · 대변 · 잔액 칸을 바로잡았습니다(맞음 ${base === null ? '셀 수 없음' : `${Math.round(base * 100)}%`} → ${Math.round(best.fit * 100)}%)` }
}

function isHeaderRow(row: EcountCell[]): boolean {
  const l = row.map(headLabel)
  return l.some((x) => /^차변(금액)?$/.test(x)) && l.some((x) => /^대변(금액)?$/.test(x))
}

/* ───────────────────────── 읽기 · 대조 ───────────────────────── */

export interface LedgerMismatch {
  code: string
  name: string
  side: 'debit' | 'credit'
  /** 대조한 요약 줄 */
  against: 'month' | 'total' | 'cumulative'
  calc: number
  file: number
  /** 계산 합이 파일 합계의 몇 배인가(정수 배일 때만 · 2 이상) */
  times: number | null
  /** 이 계정에서 거래로 더한 줄(1부터) — 재해석 때 AI에 준다(숫자 없음) */
  txRows: number[]
}

export interface LedgerRead {
  rows: (Record<string, string | number | null> & { row_no: number })[]
  problems: string[]
  dates: string[]
  mismatches: LedgerMismatch[]
  /** 대조한 계정 수(요약 줄이 있던 계정) */
  compared: number
  /** 줄 종류별 수 */
  roles: Record<string, number>
  /** 거래인지 요약인지 모르는 줄(1부터) — 더하지 않았다 */
  unknownRows: number[]
}

const won = (n: number) => Math.round(n).toLocaleString('ko-KR')

function times(calc: number, file: number): number | null {
  if (Math.abs(file) < 1 || Math.abs(calc) < 1 || Math.sign(calc) !== Math.sign(file)) return null
  const k = calc / file
  const r = Math.round(k)
  return r >= 2 && Math.abs(k - r) < 1e-6 ? r : null
}

export function mismatchText(m: LedgerMismatch): string {
  const side = m.side === 'debit' ? '차변' : '대변'
  const against = m.against === 'month' ? '월계' : m.against === 'total' ? '합계' : '누계'
  const note = m.times ? ` (정확히 ${m.times}배 — 요약 줄을 거래로 더한 것으로 보입니다)` : Math.sign(m.file) !== Math.sign(m.calc) && m.file !== 0 && m.calc !== 0 ? ' (부호가 반대 — 잔액 칸을 읽은 것으로 보입니다)' : ''
  return `계정 ${m.code}(${m.name}) ${side}: 거래 줄 합 ${won(m.calc)} ≠ ${against} 줄 ${won(m.file)} · 차이 ${won(m.calc - m.file)}${note}`
}

/** 해석(layout)대로 거래 줄만 더하고 요약 줄과 대조한다. 숫자를 맞추려고 고치지 않는다 — 안 맞으면 그대로 차이를 적는다. */
export function readLedgerWith(sheet: EcountSheet, layout: LedgerLayout): LedgerRead {
  const { debit, credit, date, account_code: codeCol, account_name: nameCol } = layout.cols
  const out: LedgerRead = { rows: [], problems: [], dates: [], mismatches: [], compared: 0, roles: {}, unknownRows: [] }
  if (debit === undefined || credit === undefined) {
    out.problems.push('차변 · 대변 칸을 찾지 못했습니다.')
    return out
  }
  const bump = (k: string) => (out.roles[k] = (out.roles[k] ?? 0) + 1)
  // 날짜 칸이 있고 금액 줄 대부분(60%)에 날짜가 있으면 날짜 없는 금액 줄은 «모르는 줄»(더하지 않는다).
  let amtRows = 0
  let datedRows = 0
  for (let r = layout.headerRow + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r]
    if (rowRole(row, layout.labels) || isHeaderRow(row)) continue
    if (typeof cellNum(row[debit]) !== 'number' && typeof cellNum(row[credit]) !== 'number') continue
    amtRows += 1
    if (date !== undefined && typeof cellDate(row[date]) === 'string') datedRows += 1
  }
  const needDate = date !== undefined && amtRows > 0 && datedRows / amtRows >= 0.6

  type Block = { code: string; name: string; row: number; d: number; c: number; month: { d: number; c: number } | null; total: { d: number; c: number } | null; cum: { d: number; c: number } | null; tx: number[] }
  const blocks = new Map<string, Block>()
  const order: string[] = []
  let cur: Block | null = null
  const open = (code: string, name: string, row: number) => {
    let b = blocks.get(code)
    if (!b) {
      b = { code, name, row, d: 0, c: 0, month: null, total: null, cum: null, tx: [] }
      blocks.set(code, b)
      order.push(code)
    }
    cur = b
  }
  for (let r = 0; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r]
    if (row.every((c) => c.t === 'empty')) continue
    if (codeCol === undefined) {
      const head = accountHead(row, layout)
      if (head) {
        open(head.code, head.name, r + 1)
        bump('account_head')
        continue
      }
    }
    if (r <= layout.headerRow || isHeaderRow(row)) continue
    const role = rowRole(row, layout.labels)
    const d = cellNum(row[debit])
    const c = cellNum(row[credit])
    if (codeCol !== undefined && !role) {
      const code = cellText(row[codeCol]).trim()
      if (/^\d{3,6}$/.test(code)) open(code, nameCol !== undefined ? cellText(row[nameCol]).trim().slice(0, 40) || code : code, r + 1)
    }
    if (role) {
      bump(role)
      const b = cur as Block | null
      if (!b) continue
      const v = { d: typeof d === 'number' ? d : 0, c: typeof c === 'number' ? c : 0 }
      if (role === 'month') b.month = b.month ? { d: b.month.d + v.d, c: b.month.c + v.c } : v
      else if (role === 'total') b.total = v
      else if (role === 'cumulative') b.cum = v
      continue
    }
    if (d === null && c === null) continue // 제목 · 출력 시각 · 빈 금액 줄
    if (d === 'bad' || c === 'bad') {
      // 글이 든 금액 칸 — 거래가 아니면(머리 · 제목) 넘어간다. 숫자처럼 보이는데 못 읽으면 문제.
      if ([row[debit], row[credit]].some((x) => x?.t === 'text' && /\d/.test(x.v))) out.problems.push(`${r + 1}행 차변 · 대변이 숫자가 아닙니다.`)
      continue
    }
    const dt = date !== undefined ? cellDate(row[date]) : null
    if (needDate && typeof dt !== 'string') {
      out.unknownRows.push(r + 1)
      continue
    }
    const b = cur as Block | null
    if (!b) {
      out.unknownRows.push(r + 1)
      continue
    }
    bump('tx')
    b.d += d ?? 0
    b.c += c ?? 0
    b.tx.push(r + 1)
    if (typeof dt === 'string') out.dates.push(dt)
  }
  for (const code of order) {
    const b = blocks.get(code)!
    const ref = b.month ? { v: b.month, k: 'month' as const } : b.total ? { v: b.total, k: 'total' as const } : null
    if (ref) {
      out.compared += 1
      for (const side of ['debit', 'credit'] as const) {
        const calc = side === 'debit' ? b.d : b.c
        const file = side === 'debit' ? ref.v.d : ref.v.c
        if (Math.abs(calc - file) > 1) out.mismatches.push({ code: b.code, name: b.name, side, against: ref.k, calc, file, times: times(calc, file), txRows: b.tx.slice(0, 30) })
      }
    }
    out.rows.push({ row_no: b.row, account_code: b.code, account_name: b.name, debit: b.d, credit: b.c })
  }
  if (out.unknownRows.length) out.problems.push(`거래인지 요약인지 모르는 줄 ${out.unknownRows.length}개(${out.unknownRows.slice(0, 8).join(' · ')}행)는 더하지 않았습니다.`)
  out.problems.push(...out.mismatches.slice(0, 25).map(mismatchText))
  return out
}

/**
 * 재해석 때 AI에 주는 차이(숫자 없음 — 0080 원료 금액 가림과 같은 원칙). 어느 계정 · 어느 쪽이 몇 배인지 · 부호 반대인지 ·
 * 거래로 더한 줄 번호만.
 */
export function ledgerFeedback(read: LedgerRead): string[] {
  const out = read.mismatches.slice(0, 10).map((m) => {
    const how = m.times ? `계산 합이 요약 줄의 정확히 ${m.times}배` : Math.sign(m.calc) !== Math.sign(m.file) && m.calc !== 0 && m.file !== 0 ? '계산 합과 요약 줄의 부호가 반대' : '계산 합과 요약 줄이 다름'
    return `계정 ${m.code} ${m.side === 'debit' ? '차변' : '대변'}: ${how}(${m.against === 'month' ? '월계' : '합계'} 줄과 대조). 거래로 더한 줄: ${m.txRows.slice(0, 15).join(',')}`
  })
  if (read.unknownRows.length) out.push(`거래인지 요약인지 모르는 금액 줄: ${read.unknownRows.slice(0, 15).join(',')}`)
  const roles = Object.entries(read.roles).map(([k, v]) => `${ROLE_KO[k as keyof typeof ROLE_KO] ?? k} ${v}`).join(' · ')
  if (roles) out.push(`지금 해석의 줄 종류 수: ${roles}`)
  return out
}

/* ───────────────────────── 학습 표에 담기(숫자 없음) ───────────────────────── */

/**
 * 0070 fin_upload_shape_save는 «이름(40자) → 0~200 정수»만 받는다(마이그레이션 없이 담으려고 이 모양을 쓴다):
 *   보통 칸       field → 열
 *   원장 칸       @date · @memo · @counterparty · @balance → 열 · @head → 머리 열 · @hdr → 머리글 줄
 *   요약 줄 낱말  #<role>:<핵심 글> → 1
 */
export function encodeShape(columns: Record<string, number>, layout: LedgerLayout | null): Record<string, number> {
  const out: Record<string, number> = { ...columns }
  if (!layout) return out
  for (const [k, v] of Object.entries(layout.cols)) if (v !== undefined && !(k in out)) out[`@${k}`] = v
  if (layout.headCol !== null && layout.headCol !== undefined) out['@head'] = layout.headCol
  if (layout.headerRow <= 200) out['@hdr'] = layout.headerRow
  for (const l of layout.labels.slice(0, 20)) {
    const key = `#${l.role}:${labelCore(l.text)}`.slice(0, 40)
    out[key] = 1
  }
  return out
}

export function decodeShape(map: Record<string, number>): { columns: Record<string, number>; cols: Partial<Record<LedgerCol, number>>; labels: RowLabel[]; headCol: number | null; headerRow: number | null } {
  const columns: Record<string, number> = {}
  const cols: Partial<Record<LedgerCol, number>> = {}
  const labels: RowLabel[] = []
  let headCol: number | null = null
  let headerRow: number | null = null
  for (const [k, v] of Object.entries(map ?? {})) {
    if (k === '@head') headCol = v
    else if (k === '@hdr') headerRow = v
    else if (k.startsWith('@') && (LEDGER_COLS as readonly string[]).includes(k.slice(1))) cols[k.slice(1) as LedgerCol] = v
    else if (k.startsWith('#')) {
      const i = k.indexOf(':')
      const role = k.slice(1, i) as RowRole
      if (i > 1 && ROW_ROLES.includes(role)) labels.push({ text: k.slice(i + 1), role })
    } else columns[k] = v
  }
  for (const k of ['account_code', 'account_name', 'debit', 'credit'] as const) if (columns[k] !== undefined && cols[k] === undefined) cols[k] = columns[k]
  return { columns, cols, labels, headCol, headerRow }
}
