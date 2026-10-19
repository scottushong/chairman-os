import { suggestAccountClass } from '@/lib/ecount/excel/accounts-import'
import type { LedgerScope } from '@/lib/ledger/scope'
import type { Account, AccountSection, FinMaterialTotals, FinRow } from '@/types'

import type { KpiSettings } from './settings'

/**
 * 0085 «재무 현황» 계산 — 순수 함수(검사 check:finance-overview가 잰다). 입력은 load.ts가 사람 세션(RLS)으로 읽은 것뿐이다.
 *
 * 원천 우선순위(달마다):
 *   손익 · 재무상태  자체 장부(전표 · ECOUNT 월별 손익 전표 · 마감)가 그 달에 있으면 장부 → 없으면 올린 «계정별 원장» 합계.
 *                    원장만 있으면 재무상태는 «전년 공식 결산 기말 + 올해 원장 증감»(전년 결산이 없으면 계산하지 않는다 — 0으로 채우지 않는다).
 *   매출원가(재고 반영) 장부 · 원장에 원재료비(사용액)가 이미 있으면 그대로. 없으면 «기초 재고 + 원재료 매입 + 노무비 + 제조경비 − 기말 재고»
 *                    (재고 = 재고금액명세서 원재료 + 재공품 · 완제품 평가금액). 그 달 평가금액이 없으면 앞 달 값을 쓰고 «잠정»에 적는다.
 *   현금흐름        월별 자금흐름표(실제 줄 — 예정 줄은 빼고) · 항목 낱말로 영업 · 투자 · 재무.
 *   대출 · 차입      대출현황(그 달 또는 그 앞 마지막 달) + 차입금(누적 차입 − 상환).
 * 원료별 숫자(입고 · 재고 · OFFER 줄)는 읽지 않는다 — 회사 · 달 합계(fin_material_totals, 원료 3가지 미만이면 감춘 값)만.
 */

export interface MonthData {
  period: string
  ledgerSums: FinRow[]
  ledgerLines: FinRow[]
  sales: FinRow[]
  shipment: FinRow[]
  payroll: FinRow[]
  cashflow: FinRow[]
  card: FinRow[]
  overseas: FinRow[]
  promo: FinRow[]
  loans: FinRow[]
  borrowings: FinRow[]
  savings: FinRow[]
  taxInvoice: FinRow[]
  production: FinRow[]
  material: FinMaterialTotals | null
  /** 재공품 · 완제품 평가금액(살아 있는 줄) */
  valuation: { wip: number | null; finished: number | null }
  /** 이 달 받은 자료 종류(18가지 체크표) */
  received: Set<string>
}

export interface OfficialYear {
  year: string
  /** 원장 규약(차변 − 대변) */
  lines: { account_code: string; amount: number }[]
}

export interface Ctx {
  businessId: string
  /** 'YYYY-MM-DD' KST */
  today: string
  scope: LedgerScope
  accounts: Map<string, Account>
  months: Map<string, MonthData>
  officials: OfficialYear[]
  settings: KpiSettings
  usdKrw: number | null
}

/* ───────────────────────── 달 · 숫자 ───────────────────────── */

export const addMonths = (p: string, n: number) => {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
export const monthsOfYear = (p: string) => Array.from({ length: Number(p.slice(5, 7)) }, (_, i) => `${p.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)
const has = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
export const sumOf = (rows: FinRow[], key: string) => rows.reduce((a, r) => a + num(r[key]), 0)
const sumOrNull = (vals: (number | null)[]) => (vals.every((v) => v === null) ? null : vals.reduce<number>((a, v) => a + (v ?? 0), 0))
export const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : (a / b) * 100)
export const growth = (cur: number | null, prev: number | null) => (cur === null || prev === null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100)

/* ───────────────────────── 계정 금액 ───────────────────────── */

const PL_SECTIONS: AccountSection[] = ['revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax']
const BS_SECTIONS: AccountSection[] = ['cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity']

export interface AcctAmount {
  code: string
  name: string
  section: AccountSection
  category: Account['category'] | null
  /** 차변 − 대변 */
  amount: number
}

function sectionOf(ctx: Ctx, code: string, name: string): { section: AccountSection; category: Account['category'] | null } | null {
  const a = ctx.accounts.get(code)
  if (a) return { section: a.section, category: a.category }
  const s = suggestAccountClass(code, name, '')
  return s.suggestion && !s.contradiction ? { section: s.suggestion.section, category: s.suggestion.category } : null
}

/** 그 달의 원천 — 장부(전표 · 마감)가 있으면 장부, 없으면 올린 계정별 원장, 둘 다 없으면 none. */
export function sourceOf(ctx: Ctx, period: string): 'books' | 'ledger' | 'none' {
  const cells = ctx.scope.periods.includes(period) ? ctx.scope.cellsAt(period) : null
  if (cells && [...cells.keys()].some((c) => { const s = ctx.accounts.get(c)?.section; return !!s && PL_SECTIONS.includes(s) && c !== 'ECOUNT-PL' })) return 'books'
  const m = ctx.months.get(period)
  if (m && m.ledgerSums.length) return 'ledger'
  return 'none'
}

/** 그 달 손익 계정 금액(차변 − 대변). */
export function plAccounts(ctx: Ctx, period: string): AcctAmount[] | null {
  const src = sourceOf(ctx, period)
  if (src === 'none') return null
  const out = new Map<string, AcctAmount>()
  if (src === 'books') {
    for (const [code, f] of ctx.scope.cellsAt(period)) {
      const a = ctx.accounts.get(code)
      if (!a || !PL_SECTIONS.includes(a.section)) continue
      out.set(code, { code, name: a.name, section: a.section, category: a.category, amount: f.value })
    }
  } else {
    for (const r of ctx.months.get(period)!.ledgerSums) {
      const code = String(r.account_code ?? '').trim()
      const name = String(r.account_name ?? ctx.accounts.get(code)?.name ?? code)
      const sc = sectionOf(ctx, code, name)
      if (!sc || !PL_SECTIONS.includes(sc.section)) continue
      const cur = out.get(code) ?? { code, name, section: sc.section, category: sc.category, amount: 0 }
      cur.amount += num(r.debit) - num(r.credit)
      out.set(code, cur)
    }
  }
  return [...out.values()]
}

/** 장부의 그 달 재무상태 잔액(없으면 null). */
function booksBs(ctx: Ctx, period: string): Map<string, AcctAmount> | null {
  if (!ctx.scope.periods.includes(period)) return null
  const out = new Map<string, AcctAmount>()
  for (const [code, f] of ctx.scope.cellsAt(period)) {
    const a = ctx.accounts.get(code)
    if (a && BS_SECTIONS.includes(a.section) && code !== 'ECOUNT-PL') out.set(code, { code, name: a.name, section: a.section, category: a.category, amount: f.value })
  }
  return out.size ? out : null
}

/**
 * 그 달 말 재무상태 계정 잔액(차변 − 대변). 계산할 수 없으면 null.
 *   ① 그 달 장부 잔액 → ② 그 앞 마지막 장부 달 잔액 + 그 뒤 달들의 올린 계정별 원장 증감 → ③ 전년 공식 결산 기말 + 올해 원장 증감.
 *   원장 증감의 손익 계정은 «당기 손익(계산)»으로 자본에 더한다(마감분개 전이라 닫히게).
 */
export function bsAccounts(ctx: Ctx, period: string): AcctAmount[] | null {
  const hasLedger = (p: string) => !!ctx.months.get(p)?.ledgerSums.length
  // 원장을 올린 달은 원장 증감이 이긴다(장부의 그 달이 월별 손익 전표뿐이면 재무상태 움직임이 없다). 거슬러 올라가 원장 없는 장부 달을 기초로.
  if (!hasLedger(period)) {
    const own = booksBs(ctx, period)
    if (own) return [...own.values()]
  }
  let base: Map<string, AcctAmount> | null = null
  let from = ''
  for (let p = addMonths(period, -1), n = 0; n < 36; p = addMonths(p, -1), n += 1) {
    if (hasLedger(p)) continue
    const b = booksBs(ctx, p)
    if (b) {
      base = b
      from = p
    }
    break
  }
  if (!base) {
    const official = ctx.officials.find((o) => o.year === String(Number(period.slice(0, 4)) - 1))
    if (!official) return null
    base = new Map()
    for (const l of official.lines) {
      const a = ctx.accounts.get(l.account_code)
      if (a && BS_SECTIONS.includes(a.section)) base.set(l.account_code, { code: l.account_code, name: a.name, section: a.section, category: a.category, amount: l.amount })
    }
    from = `${Number(period.slice(0, 4)) - 1}-12`
  }
  const bal = new Map([...base].map(([k, v]) => [k, { ...v }]))
  let moved = false
  let netIncome = 0
  for (let p = addMonths(from, 1); p <= period; p = addMonths(p, 1)) {
    const m = ctx.months.get(p)
    if (!m || !m.ledgerSums.length) continue
    moved = true
    for (const r of m.ledgerSums) {
      const code = String(r.account_code ?? '').trim()
      const name = String(r.account_name ?? code)
      const sc = sectionOf(ctx, code, name)
      if (!sc) continue
      const mv = num(r.debit) - num(r.credit)
      if (PL_SECTIONS.includes(sc.section)) {
        netIncome += mv
        continue
      }
      const cur = bal.get(code) ?? { code, name, section: sc.section, category: sc.category, amount: 0 }
      cur.amount += mv
      bal.set(code, cur)
    }
  }
  // 장부 달과 이 달 사이에 원장이 하나도 없으면 — 이 달 잔액을 모른다(앞 달 값을 이 달로 부르지 않는다).
  if (!moved && from !== period) return null
  if (netIncome !== 0) bal.set('CALC-NI', { code: 'CALC-NI', name: '당기 손익(계산)', section: 'equity', category: 'equity', amount: netIncome })
  return [...bal.values()]
}

/* ───────────────────────── ① 손익 ───────────────────────── */

export interface PlLine {
  key: string
  label: string
  level: 'sum' | 'sub' | 'note'
  amount: number | null
  /** 이 줄이 묶은 계정 코드(줄을 누르면 원장으로) */
  codes: string[]
}

export interface PlResult {
  period: string
  source: 'books' | 'ledger' | 'none'
  revenue: number | null
  cogs: number | null
  gross: number | null
  sga: number | null
  op: number | null
  nonopIncome: number | null
  nonopExpense: number | null
  nonop: number | null
  pretax: number | null
  tax: number | null
  taxEstimated: boolean
  net: number | null
  /** 재고 반영 매출원가의 재료 */
  cogsBasis: { method: 'books' | 'inventory' | 'none'; opening: number | null; purchases: number | null; labor: number | null; overhead: number | null; closing: number | null; merchandise: number | null; rawShare: number | null }
  lines: PlLine[]
  /** 잠정의 까닭(무엇이 빠짐 · 앞 달 값을 씀) */
  notes: string[]
}

const isRawMaterialAsset = (a: AcctAmount) => (a.section === 'other_asset' || a.section === 'cogs') && /원재료|부재료|원자재|원료/.test(a.name) && !/원재료비|재료비|사용/.test(a.name)
const REV_GROUP = (name: string) => (/상품/.test(name) ? 'merch' : /수출|해외|외화/.test(name) ? 'export' : 'product')
const SGA_GROUPS: { key: string; label: string; re: RegExp }[] = [
  { key: 'pay', label: '급여 · 상여 (사무 · 영업)', re: /급여|상여|임금|급료/ },
  { key: 'welfare', label: '퇴직급여 · 복리후생', re: /퇴직|복리/ },
  { key: 'freight', label: '운반비 · 물류', re: /운반|물류|운송|택배|보관/ },
  { key: 'overseas', label: '해외 판촉비 · 베트남 법인 운영비', re: /해외|판촉|수출|시장개척|베트남|법인운영/ },
  { key: 'fee', label: '지급수수료 · 보험 · 임차', re: /수수료|보험|임차|리스|용역/ },
  { key: 'card', label: '법인카드 · 접대 · 차량 · 통신', re: /카드|접대|업무추진|차량|통신|여비|교통|유류/ },
]

/** 앞 달까지 거슬러 가장 가까운 평가금액(재공품 · 완제품) — 몇 달 앞 값을 썼는지와. */
function valuationAt(ctx: Ctx, period: string, cat: 'wip' | 'finished', back = 3): { value: number | null; from: string | null } {
  for (let i = 0; i <= back; i += 1) {
    const p = addMonths(period, -i)
    const v = ctx.months.get(p)?.valuation[cat]
    if (v !== null && v !== undefined) return { value: v, from: p }
  }
  return { value: null, from: null }
}

/** 재고 합계(원재료 · 재공품 · 완제품) — 원재료는 재고금액명세서 기말 합계(감춘 값이면 null). */
export function inventoryAt(ctx: Ctx, period: string): { raw: number | null; wip: number | null; finished: number | null; total: number | null; notes: string[] } {
  const notes: string[] = []
  const raw = ctx.months.get(period)?.material?.inventory_closing ?? null
  const wip = valuationAt(ctx, period, 'wip')
  const fin = valuationAt(ctx, period, 'finished')
  const label = (p: string) => `${Number(p.slice(5, 7))}월`
  if (wip.from && wip.from !== period) notes.push(`${label(period)} 재공품 평가금액이 아직 없어 ${label(wip.from)} 값으로 계산했습니다.`)
  if (fin.from && fin.from !== period) notes.push(`${label(period)} 완제품 평가금액이 아직 없어 ${label(fin.from)} 값으로 계산했습니다.`)
  const total = raw === null && wip.value === null && fin.value === null ? null : (raw ?? 0) + (wip.value ?? 0) + (fin.value ?? 0)
  return { raw, wip: wip.value, finished: fin.value, total, notes }
}

export function computePl(ctx: Ctx, period: string): PlResult {
  const accts = plAccounts(ctx, period)
  const source = sourceOf(ctx, period)
  const notes: string[] = []
  const empty: PlResult = {
    period, source, revenue: null, cogs: null, gross: null, sga: null, op: null, nonopIncome: null, nonopExpense: null, nonop: null, pretax: null, tax: null, taxEstimated: false, net: null,
    cogsBasis: { method: 'none', opening: null, purchases: null, labor: null, overhead: null, closing: null, merchandise: null, rawShare: null }, lines: [], notes,
  }
  const m = ctx.months.get(period)
  if (!accts) {
    // 장부 · 원장이 없으면 판매현황 합계라도 매출로(나머지는 비운다 — 0으로 채우지 않는다).
    const sales = m?.sales.length ? sumOf(m.sales, 'amount') : null
    notes.push('계정별 원장(또는 월별 손익계산서)이 없어 이익을 계산하지 못했습니다.')
    return { ...empty, revenue: sales, lines: sales === null ? [] : [{ key: 'rev', label: 'Ⅰ. 매출액 (판매현황 합계)', level: 'sum', amount: sales, codes: [] }] }
  }
  const of = (sec: AccountSection[]) => accts.filter((a) => sec.includes(a.section))
  const revAccts = of(['revenue'])
  const revenue = -revAccts.reduce((s, a) => s + a.amount, 0)
  const cogsAccts = of(['cogs'])
  const rawExpense = cogsAccts.filter((a) => a.category === 'raw_material' || /원재료비|재료비/.test(a.name)).reduce((s, a) => s + a.amount, 0)
  const merchAccts = cogsAccts.filter((a) => /상품/.test(a.name))
  const merchandise = merchAccts.reduce((s, a) => s + a.amount, 0)
  const labor = cogsAccts.filter((a) => a.category === 'labor' && !merchAccts.includes(a)).reduce((s, a) => s + a.amount, 0)
  const overheadAccts = cogsAccts.filter((a) => !merchAccts.includes(a) && a.category !== 'labor' && !(a.category === 'raw_material' || /원재료비|재료비/.test(a.name)))
  const overhead = overheadAccts.reduce((s, a) => s + a.amount, 0)
  let cogs: number
  let basis: PlResult['cogsBasis']
  const inv = inventoryAt(ctx, period)
  const invPrev = inventoryAt(ctx, addMonths(period, -1))
  if (rawExpense !== 0 || (inv.total === null || invPrev.total === null)) {
    cogs = cogsAccts.reduce((s, a) => s + a.amount, 0)
    basis = { method: 'books', opening: null, purchases: rawExpense || null, labor: labor || null, overhead: overhead || null, closing: null, merchandise: merchandise || null, rawShare: null }
    if (rawExpense === 0 && (inv.total === null || invPrev.total === null)) notes.push('재고금액명세서 · 평가금액이 모자라 재고를 반영하지 못했습니다(장부 원가 그대로).')
  } else {
    // 재고 반영 — 원재료 매입(자산 계정 차변) + 노무 + 경비 + 기초 − 기말 + 상품 원가.
    const bsNow = ctx.months.get(period)?.ledgerSums ?? []
    let purchases = 0
    if (source === 'ledger') {
      for (const r of bsNow) {
        const code = String(r.account_code ?? '')
        const name = String(r.account_name ?? '')
        const sc = sectionOf(ctx, code, name)
        if (sc && isRawMaterialAsset({ code, name, section: sc.section, category: sc.category, amount: 0 })) purchases += num(r.debit)
      }
    } else {
      for (const [code, f] of ctx.scope.cellsAt(period)) {
        const a = ctx.accounts.get(code)
        if (a && isRawMaterialAsset({ code, name: a.name, section: a.section, category: a.category, amount: 0 })) {
          const prev = ctx.scope.periods.includes(addMonths(period, -1)) ? (ctx.scope.cellsAt(addMonths(period, -1)).get(code)?.value ?? 0) : 0
          purchases += Math.max(0, f.value - prev)
        }
      }
    }
    if (!purchases && m?.material?.purchase_amount) purchases = m.material.purchase_amount
    cogs = invPrev.total! + purchases + labor + overhead - inv.total! + merchandise
    basis = { method: 'inventory', opening: invPrev.total, purchases, labor, overhead, closing: inv.total, merchandise: merchandise || null, rawShare: null }
    notes.push(...inv.notes)
  }
  const gross = revenue - cogs
  const sgaAccts = of(['sga', 'd_and_a'])
  const sga = sgaAccts.reduce((s, a) => s + a.amount, 0)
  const op = gross - sga
  const nonopAccts = of(['non_operating'])
  const nonopIncome = -nonopAccts.filter((a) => a.amount < 0).reduce((s, a) => s + a.amount, 0)
  const nonopExpense = nonopAccts.filter((a) => a.amount > 0).reduce((s, a) => s + a.amount, 0)
  const nonop = nonopIncome - nonopExpense
  const pretax = op + nonop
  const taxAccts = of(['tax'])
  const taxBooks = taxAccts.reduce((s, a) => s + a.amount, 0)
  const taxEstimated = taxAccts.length === 0
  const tax = taxEstimated ? Math.round(Math.max(0, pretax) * (ctx.settings.tax_rate / 100)) : taxBooks
  const net = pretax - tax
  basis.rawShare = revenue ? pct((basis.method === 'inventory' ? cogs - (basis.labor ?? 0) - (basis.overhead ?? 0) - (basis.merchandise ?? 0) : rawExpense), revenue) : null

  const lines: PlLine[] = []
  const codes = (xs: AcctAmount[]) => xs.map((a) => a.code)
  lines.push({ key: 'rev', label: 'Ⅰ. 매출액', level: 'sum', amount: revenue, codes: codes(revAccts) })
  const revBy = (g: string) => revAccts.filter((a) => REV_GROUP(a.name) === g)
  for (const [g, label] of [['product', '제품 매출'], ['merch', '상품 매출'], ['export', '수출 매출 (외화 환산)']] as const) {
    const xs = revBy(g)
    if (xs.length) lines.push({ key: `rev-${g}`, label, level: 'sub', amount: -xs.reduce((s, a) => s + a.amount, 0), codes: codes(xs) })
  }
  lines.push({ key: 'cogs', label: 'Ⅱ. 매출원가', level: 'sum', amount: cogs, codes: codes(cogsAccts) })
  if (basis.method === 'inventory') {
    lines.push({ key: 'cogs-open', label: '기초 재고 (원재료 · 재공 · 제품)', level: 'sub', amount: basis.opening, codes: [] })
    lines.push({ key: 'cogs-buy', label: '+ 당기 원재료 매입', level: 'sub', amount: basis.purchases, codes: [] })
  } else if (rawExpense) lines.push({ key: 'cogs-raw', label: '원재료비 (장부)', level: 'sub', amount: rawExpense, codes: codes(cogsAccts.filter((a) => a.category === 'raw_material' || /원재료비|재료비/.test(a.name))) })
  if (labor) lines.push({ key: 'cogs-labor', label: '+ 노무비 (제조)', level: 'sub', amount: labor, codes: codes(cogsAccts.filter((a) => a.category === 'labor')) })
  if (overhead) lines.push({ key: 'cogs-oh', label: '+ 제조경비 (전력 · 외주 · 감가)', level: 'sub', amount: overhead, codes: codes(overheadAccts) })
  if (merchandise) lines.push({ key: 'cogs-merch', label: '+ 상품 매출원가', level: 'sub', amount: merchandise, codes: codes(merchAccts) })
  if (basis.method === 'inventory') lines.push({ key: 'cogs-close', label: '− 기말 재고 (재고금액명세서 · 평가)', level: 'sub', amount: basis.closing, codes: [] })
  lines.push({ key: 'gross', label: 'Ⅲ. 매출총이익 (Ⅰ−Ⅱ)', level: 'sum', amount: gross, codes: [] })
  lines.push({ key: 'sga', label: 'Ⅳ. 판매비와 관리비', level: 'sum', amount: sga, codes: codes(sgaAccts) })
  const used = new Set<string>()
  for (const g of SGA_GROUPS) {
    const xs = sgaAccts.filter((a) => !used.has(a.code) && g.re.test(a.name))
    xs.forEach((a) => used.add(a.code))
    if (xs.length) lines.push({ key: `sga-${g.key}`, label: g.label, level: 'sub', amount: xs.reduce((s, a) => s + a.amount, 0), codes: codes(xs) })
  }
  const rest = sgaAccts.filter((a) => !used.has(a.code))
  if (rest.length) lines.push({ key: 'sga-etc', label: '감가상각비 (비제조) · 기타', level: 'sub', amount: rest.reduce((s, a) => s + a.amount, 0), codes: codes(rest) })
  lines.push({ key: 'op', label: 'Ⅴ. 영업이익 (Ⅲ−Ⅳ)', level: 'sum', amount: op, codes: [] })
  const incomeAccts = nonopAccts.filter((a) => a.amount < 0)
  const expenseAccts = nonopAccts.filter((a) => a.amount > 0)
  lines.push({ key: 'nonop-in', label: 'Ⅵ. 영업외 수익', level: 'sum', amount: nonopIncome, codes: codes(incomeAccts) })
  if (incomeAccts.length) lines.push({ key: 'nonop-in-d', label: '이자수익 · 외환차익 · 잡이익', level: 'sub', amount: nonopIncome, codes: codes(incomeAccts) })
  lines.push({ key: 'nonop-out', label: 'Ⅶ. 영업외 비용', level: 'sum', amount: nonopExpense, codes: codes(expenseAccts) })
  const interest = expenseAccts.filter((a) => /이자/.test(a.name))
  if (interest.length) lines.push({ key: 'nonop-int', label: '이자비용 (대출현황 · 차입금)', level: 'sub', amount: interest.reduce((s, a) => s + a.amount, 0), codes: codes(interest) })
  const otherOut = expenseAccts.filter((a) => !/이자/.test(a.name))
  if (otherOut.length) lines.push({ key: 'nonop-etc', label: '외환차손 · 기타', level: 'sub', amount: otherOut.reduce((s, a) => s + a.amount, 0), codes: codes(otherOut) })
  lines.push({ key: 'pretax', label: 'Ⅷ. 법인세 차감 전 이익', level: 'sum', amount: pretax, codes: [] })
  lines.push({ key: 'tax', label: taxEstimated ? `법인세 등 (추정 ${ctx.settings.tax_rate}%)` : '법인세 등', level: 'sub', amount: tax, codes: codes(taxAccts) })
  lines.push({ key: 'net', label: 'Ⅸ. 당기순이익', level: 'sum', amount: net, codes: [] })
  if (taxEstimated) notes.push(`장부에 법인세가 없어 법인세 차감 전 이익의 ${ctx.settings.tax_rate}%로 추정했습니다.`)
  return { period, source, revenue, cogs, gross, sga, op, nonopIncome, nonopExpense, nonop, pretax, tax, taxEstimated, net, cogsBasis: basis, lines, notes }
}

/** 올해 1월 ~ 이 달 누계(빠진 달이 있으면 null — 빠진 달을 조용히 건너뛴 누계는 누계가 아니다). */
export function plYtd(ctx: Ctx, period: string): { byKey: Map<string, number | null>; months: number; missing: string[] } {
  const byKey = new Map<string, number | null>()
  const missing: string[] = []
  let months = 0
  for (const p of monthsOfYear(period)) {
    const r = computePl(ctx, p)
    if (r.source === 'none') {
      missing.push(p)
      continue
    }
    months += 1
    for (const l of r.lines) byKey.set(l.key, (byKey.get(l.key) ?? 0) + (l.amount ?? 0))
  }
  if (missing.length) for (const k of byKey.keys()) byKey.set(k, null)
  return { byKey, months, missing }
}

/* ───────────────────────── ② 재무상태 ───────────────────────── */

export interface BsRow {
  key: string
  label: string
  amount: number | null
  bold?: boolean
}
export interface BsResult {
  assets: BsRow[]
  liabilities: BsRow[]
  totalAssets: number | null
  totalLiabilities: number | null
  equity: number | null
  cash: number | null
  receivable: number | null
  payable: number | null
  shortDebt: number | null
  longDebt: number | null
  inventory: ReturnType<typeof inventoryAt>
  balanced: boolean | null
  note: string | null
}

export function computeBs(ctx: Ctx, period: string): BsResult {
  const inv = inventoryAt(ctx, period)
  const accts = bsAccounts(ctx, period)
  if (!accts) {
    return { assets: [], liabilities: [], totalAssets: null, totalLiabilities: null, equity: null, cash: null, receivable: null, payable: null, shortDebt: null, longDebt: null, inventory: inv, balanced: null, note: '장부 · 전년 공식 결산이 없어 재무상태를 계산하지 못했습니다(계정별 원장만으로는 기초 잔액을 모릅니다).' }
  }
  const pick = (re: RegExp, sections: AccountSection[]) => accts.filter((a) => sections.includes(a.section) && re.test(a.name))
  const sum = (xs: AcctAmount[], sign = 1) => (xs.length ? sign * xs.reduce((s, a) => s + a.amount, 0) : null)
  const assetsAll = accts.filter((a) => ['cash', 'receivable', 'other_asset'].includes(a.section))
  const liabAll = accts.filter((a) => ['payable', 'other_liability'].includes(a.section))
  const eqAll = accts.filter((a) => a.section === 'equity')
  const cash = sum(accts.filter((a) => a.section === 'cash'))
  const receivable = sum(accts.filter((a) => a.section === 'receivable' || /외상매출금|받을어음/.test(a.name)))
  const rawBooks = sum(pick(/원재료|부재료|원자재/, ['other_asset']))
  const wipBooks = sum(pick(/재공품/, ['other_asset']))
  const finBooks = sum(pick(/제품|상품/, ['other_asset']))
  const tangible = sum(pick(/토지|건물|기계|설비|차량|비품|공구|구축물|유형|감가상각누계/, ['other_asset']))
  const raw = inv.raw ?? rawBooks
  const wip = inv.wip ?? wipBooks
  const finished = inv.finished ?? finBooks
  const totalAssetsBooks = sum(assetsAll)
  // 재고 3종은 명세서 · 평가금액이 이긴다 — 장부 재고와의 차이만큼 자산 합계를 옮긴다(자본 쪽 «재고 평가 차이»).
  const invDiff = (raw ?? 0) - (rawBooks ?? 0) + (wip ?? 0) - (wipBooks ?? 0) + (finished ?? 0) - (finBooks ?? 0)
  const totalAssets = totalAssetsBooks === null ? null : totalAssetsBooks + invDiff
  const known = (cash ?? 0) + (receivable ?? 0) + (rawBooks ?? 0) + (wipBooks ?? 0) + (finBooks ?? 0) + (tangible ?? 0)
  const otherAssets = totalAssetsBooks === null ? null : totalAssetsBooks - known
  const payable = sum(accts.filter((a) => a.section === 'payable' || /외상매입금|지급어음/.test(a.name)), -1)
  const accrued = sum(pick(/미지급/, ['other_liability']), -1)
  const shortDebt = sum(pick(/단기차입|유동성/, ['other_liability']), -1)
  const longDebt = sum(pick(/장기차입|사채/, ['other_liability']), -1)
  const totalLiabilities = sum(liabAll, -1)
  const otherLiab = totalLiabilities === null ? null : totalLiabilities - (payable ?? 0) - (accrued ?? 0) - (shortDebt ?? 0) - (longDebt ?? 0)
  const equityBooks = sum(eqAll, -1) ?? 0
  const equity = totalAssets === null ? null : totalAssets - (totalLiabilities ?? 0)
  const assets: BsRow[] = [
    { key: 'cash', label: '현금 · 예금', amount: cash },
    { key: 'ar', label: '외상매출금', amount: receivable },
    { key: 'raw', label: '원재료', amount: raw },
    { key: 'wip', label: '재공품', amount: wip },
    { key: 'fin', label: '제품', amount: finished },
    { key: 'tangible', label: '유형자산', amount: tangible },
    ...(otherAssets ? [{ key: 'other', label: '그 밖 자산', amount: otherAssets }] : []),
    { key: 'total', label: '자산 합계', amount: totalAssets, bold: true },
  ]
  const liabilities: BsRow[] = [
    { key: 'ap', label: '외상매입금', amount: payable },
    { key: 'accrued', label: '미지급금', amount: accrued },
    { key: 'short', label: '단기차입금', amount: shortDebt },
    { key: 'long', label: '장기차입금', amount: longDebt },
    ...(otherLiab ? [{ key: 'other', label: '그 밖 부채', amount: otherLiab }] : []),
    { key: 'total-l', label: '부채 합계', amount: totalLiabilities, bold: true },
    { key: 'equity', label: '자본', amount: equity },
    { key: 'le', label: '부채 + 자본', amount: totalAssets, bold: true },
  ]
  const balanced = totalAssets === null ? null : Math.abs(totalAssets - ((totalLiabilities ?? 0) + equityBooks + invDiff)) < 1
  return { assets, liabilities, totalAssets, totalLiabilities, equity, cash, receivable, payable, shortDebt, longDebt, inventory: inv, balanced, note: null }
}

/* ───────────────────────── ③ 현금흐름 ───────────────────────── */

export type CashClass = 'operating' | 'investing' | 'financing'
export function cashClassOf(category: string): CashClass {
  const c = category.replace(/\s/g, '')
  if (/차입|대출|원금|상환|이자|배당|증자|사채|리스료/.test(c)) return 'financing'
  if (/설비|기계|건물|토지|차량구입|투자|보증금|자산취득|자산매각|공사/.test(c)) return 'investing'
  return 'operating'
}
const isOpening = (c: string) => /이월|기초잔액|전월잔액|기초현금/.test(c.replace(/\s/g, ''))
const isClosing = (c: string) => /^기말|기말잔액|월말잔액/.test(c.replace(/\s/g, ''))
export const isMaterialPayment = (c: string) => /원재료|원료|원자재|부재료|LOT/i.test(c)

const rowKrw = (ctx: Ctx, r: FinRow, key: 'inflow' | 'outflow' | 'balance') => {
  const v = num(r[key])
  const cur = typeof r.currency === 'string' && r.currency ? r.currency : null
  if (!cur || cur === 'KRW') return v
  return ctx.usdKrw && cur === 'USD' ? v * ctx.usdKrw : 0
}

export interface CashResult {
  opening: number | null
  operating: number | null
  materialPaid: number | null
  investing: number | null
  financing: number | null
  closing: number | null
  inflow: number | null
  outflow: number | null
  net: number | null
  hasFlows: boolean
}

export function computeCash(ctx: Ctx, period: string, bs?: BsResult): CashResult {
  const m = ctx.months.get(period)
  const rows = (m?.cashflow ?? []).filter((r) => !num(r.planned) && !isOpening(String(r.category ?? '')) && !isClosing(String(r.category ?? '')))
  const empty: CashResult = { opening: null, operating: null, materialPaid: null, investing: null, financing: null, closing: null, inflow: null, outflow: null, net: null, hasFlows: false }
  if (!m || !m.cashflow.length) {
    const b = bs ?? computeBs(ctx, period)
    const prev = computeBs(ctx, addMonths(period, -1))
    return { ...empty, opening: prev.cash, closing: b.cash, net: b.cash !== null && prev.cash !== null ? b.cash - prev.cash : null }
  }
  const by = (cls: CashClass) => rows.filter((r) => cashClassOf(String(r.category ?? '')) === cls).reduce((s, r) => s + rowKrw(ctx, r, 'inflow') - rowKrw(ctx, r, 'outflow'), 0)
  const inflow = rows.reduce((s, r) => s + rowKrw(ctx, r, 'inflow'), 0)
  const outflow = rows.reduce((s, r) => s + rowKrw(ctx, r, 'outflow'), 0)
  const net = inflow - outflow
  const materialPaid = -rows.filter((r) => isMaterialPayment(String(r.category ?? ''))).reduce((s, r) => s + rowKrw(ctx, r, 'outflow'), 0)
  const openRow = m.cashflow.find((r) => isOpening(String(r.category ?? '')))
  let opening: number | null = openRow ? rowKrw(ctx, openRow, 'inflow') || rowKrw(ctx, openRow, 'balance') : null
  const balances = accountBalances(ctx, m.cashflow, `${period}-31`)
  let closing: number | null = balances.length ? balances.reduce((s, b) => s + b.krw, 0) : null
  if (opening === null) {
    const prevBal = ctx.months.get(addMonths(period, -1))
    const pb = prevBal ? accountBalances(ctx, prevBal.cashflow, `${addMonths(period, -1)}-31`) : []
    if (pb.length) opening = pb.reduce((s, b) => s + b.krw, 0)
    else if (closing !== null) opening = closing - net
    else opening = computeBs(ctx, addMonths(period, -1)).cash
  }
  if (closing === null && opening !== null) closing = opening + net
  return { opening, operating: by('operating'), materialPaid, investing: by('investing'), financing: by('financing'), closing, inflow, outflow, net, hasFlows: true }
}

/** 계좌별 마지막 잔액(그 날짜까지 · 실제 줄만). 잔액 칸이 없으면 빈 목록. */
export function accountBalances(ctx: Ctx, rows: FinRow[], upTo: string): { account: string; currency: string | null; balance: number; krw: number; date: string }[] {
  const last = new Map<string, FinRow>()
  for (const r of rows) {
    if (num(r.planned) || !has(r.balance)) continue
    const d = String(r.flow_date ?? '')
    if (d && d > upTo) continue
    const k = String(r.account ?? '계좌')
    const cur = last.get(k)
    if (!cur || String(cur.flow_date ?? '') <= d) last.set(k, r)
  }
  return [...last.entries()].map(([account, r]) => ({ account, currency: (r.currency as string) || null, balance: num(r.balance), krw: rowKrw(ctx, r, 'balance'), date: String(r.flow_date ?? '') }))
}

/* ───────────────────────── ④ 대출 · 차입 ───────────────────────── */

export interface DebtRow {
  lender: string
  type: string
  total: number | null
  balance: number | null
  rate: number | null
  maturity: string | null
  monthlyPay: number | null
  monthlyInterest: number | null
  payDay: number | null
}

export function computeDebt(ctx: Ctx, period: string): { rows: DebtRow[]; total: number | null; monthlyPay: number | null; monthlyInterest: number | null; nextMaturity: DebtRow | null; asOf: string | null } {
  // 대출현황 — 그 달 또는 앞 12달 안의 마지막 한 벌.
  let loans: FinRow[] = []
  let asOf: string | null = null
  for (let i = 0; i < 12; i += 1) {
    const p = addMonths(period, -i)
    const m = ctx.months.get(p)
    if (m?.loans.length) {
      loans = m.loans
      asOf = p
      break
    }
  }
  const rows: DebtRow[] = loans.map((r) => {
    const balance = has(r.principal) ? num(r.principal) : null
    const rate = has(r.rate) ? num(r.rate) : null
    const interest = has(r.interest_paid) ? num(r.interest_paid) : balance !== null && rate !== null ? Math.round((balance * rate) / 100 / 12) : null
    return {
      lender: String(r.lender ?? '—'),
      type: String(r.loan_type ?? r.terms ?? '대출'),
      total: has(r.loan_total) ? num(r.loan_total) : balance,
      balance,
      rate,
      maturity: typeof r.maturity === 'string' && r.maturity ? r.maturity.slice(0, 10) : null,
      monthlyPay: sumOrNull([has(r.principal_paid) ? num(r.principal_paid) : null, interest]),
      monthlyInterest: interest,
      payDay: has(r.pay_day) ? num(r.pay_day) : null,
    }
  })
  // 차입금 — 차입처마다 누적(차입 − 상환) · 이 달 상환.
  const net = new Map<string, { bal: number; paid: number; first: number }>()
  for (const [p, m] of ctx.months) {
    if (p > period) continue
    for (const r of m.borrowings) {
      const k = String(r.lender ?? '차입금')
      const cur = net.get(k) ?? { bal: 0, paid: 0, first: 0 }
      const repay = /상환|변제|갚/.test(String(r.direction ?? ''))
      cur.bal += repay ? -num(r.amount) : num(r.amount)
      if (!repay) cur.first += num(r.amount)
      if (repay && p === period) cur.paid += num(r.amount)
      net.set(k, cur)
    }
  }
  for (const [lender, v] of net) {
    if (rows.some((r) => r.lender === lender)) continue
    rows.push({ lender, type: '차입금', total: v.first || null, balance: v.bal, rate: null, maturity: null, monthlyPay: v.paid || null, monthlyInterest: null, payDay: null })
  }
  const total = sumOrNull(rows.map((r) => r.balance))
  const monthlyPay = sumOrNull(rows.map((r) => r.monthlyPay))
  const monthlyInterest = sumOrNull(rows.map((r) => r.monthlyInterest))
  const nextMaturity = [...rows].filter((r) => r.maturity && r.maturity >= ctx.today.slice(0, 10)).sort((a, b) => a.maturity!.localeCompare(b.maturity!))[0] ?? null
  return { rows, total, monthlyPay, monthlyInterest, nextMaturity, asOf }
}

/* ───────────────────────── ⑤ 비용 · ⑥ 매출 ───────────────────────── */

export interface CostRow {
  label: string
  amount: number
  prev: number | null
  change: number | null
  codes: string[]
}

export function computeCosts(ctx: Ctx, period: string): CostRow[] {
  const cur = plAccounts(ctx, period) ?? []
  const prev = plAccounts(ctx, addMonths(period, -1))
  const m = ctx.months.get(period)
  const pm = ctx.months.get(addMonths(period, -1))
  const rows: CostRow[] = []
  const payTotal = (x: MonthData | undefined) => (x && x.payroll.length ? x.payroll.reduce((s, r) => s + num(r.salary) + num(r.bonus) + num(r.severance), 0) : null)
  const pay = payTotal(m)
  if (pay !== null) {
    const pp = payTotal(pm)
    rows.push({ label: '급여 (부서 합계)', amount: pay, prev: pp, change: growth(pay, pp), codes: [] })
  }
  const card = m?.card.length ? sumOf(m.card, 'amount') : null
  if (card !== null) {
    const pc = pm?.card.length ? sumOf(pm.card, 'amount') : null
    rows.push({ label: `법인카드 (${m!.card.length}건)`, amount: card, prev: pc, change: growth(card, pc), codes: [] })
  }
  const expenses = cur.filter((a) => (a.section === 'sga' || a.section === 'd_and_a' || (a.section === 'cogs' && a.category !== 'raw_material')) && a.amount > 0 && !(pay !== null && /급여|상여|임금/.test(a.name)) && !/상품매출원가/.test(a.name))
  for (const a of expenses) {
    const p = prev?.find((x) => x.code === a.code)?.amount ?? null
    rows.push({ label: a.name, amount: a.amount, prev: p, change: growth(a.amount, p), codes: [a.code] })
  }
  return rows.sort((a, b) => b.amount - a.amount)
}

export interface SalesRow {
  customer: string
  amount: number
  kg: number | null
  share: number | null
}

export function computeSales(ctx: Ctx, period: string, top = 4): { rows: SalesRow[]; total: number | null; customers: number; topProduct: { name: string; amount: number } | null } {
  const m = ctx.months.get(period)
  if (!m || (!m.sales.length && !m.taxInvoice.length)) return { rows: [], total: null, customers: 0, topProduct: null }
  const by = new Map<string, number>()
  const src = m.sales.length ? m.sales.map((r) => ({ c: String(r.customer ?? '거래처 없음'), a: num(r.amount) })) : m.taxInvoice.filter((r) => r.direction === 'sales').map((r) => ({ c: String(r.counterparty ?? '거래처 없음'), a: num(r.supply_amount) }))
  for (const x of src) by.set(x.c, (by.get(x.c) ?? 0) + x.a)
  const kg = new Map<string, number>()
  const kgRows = m.shipment.length ? m.shipment.map((r) => ({ c: String(r.customer ?? ''), q: num(r.qty) })) : m.sales.map((r) => ({ c: String(r.customer ?? ''), q: num(r.qty) }))
  for (const x of kgRows) kg.set(x.c, (kg.get(x.c) ?? 0) + x.q)
  const hasKg = kgRows.some((x) => x.q)
  const total = [...by.values()].reduce((s, v) => s + v, 0)
  const sorted = [...by.entries()].sort((a, b) => b[1] - a[1])
  const rows: SalesRow[] = sorted.slice(0, top).map(([c, a]) => ({ customer: c, amount: a, kg: hasKg ? (kg.get(c) ?? null) : null, share: pct(a, total) }))
  if (sorted.length > top) {
    const restA = sorted.slice(top).reduce((s, [, a]) => s + a, 0)
    const restK = hasKg ? sorted.slice(top).reduce((s, [c]) => s + (kg.get(c) ?? 0), 0) : null
    rows.push({ customer: `그 밖 ${sorted.length - top}곳`, amount: restA, kg: restK, share: pct(restA, total) })
  }
  const prod = new Map<string, number>()
  for (const r of m.sales) prod.set(String(r.product ?? ''), (prod.get(String(r.product ?? '')) ?? 0) + num(r.amount))
  const tp = [...prod.entries()].filter(([n]) => n).sort((a, b) => b[1] - a[1])[0]
  return { rows, total, customers: by.size, topProduct: tp ? { name: tp[0], amount: tp[1] } : null }
}
