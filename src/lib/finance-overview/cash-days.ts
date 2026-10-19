import type { FinRow } from '@/types'

import { accountBalances, addMonths, cashClassOf, computeBs, computeCash, computeDebt, computePl, sumOf, type CashClass, type Ctx } from './engine'

/**
 * 일별 자금보고 · 현금흐름 달력(0085 시안). 자료는 월별 자금흐름표(계좌 · 통화 · 잔액 · 예정) · 계정별 원장 · 원장 거래 줄 · 대출현황 · 차입금.
 * 지난 날 = 실제 줄, 앞날 = 예정 줄(수금예정 · 지급예정) + 대출 일정(이자 내는 날 · 만기). 예정은 실제 돈이 아니다 — 화면이 갈라 그린다.
 */

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const isPlanned = (r: FinRow) => num(r.planned) > 0
const dayOf = (r: FinRow) => String(r.flow_date ?? '').slice(0, 10)
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
const lastDay = (p: string) => {
  const [y, m] = p.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay()

function cashRows(ctx: Ctx, from: string, to: string): FinRow[] {
  const out: FinRow[] = []
  for (let p = from; p <= to; p = addMonths(p, 1)) out.push(...(ctx.months.get(p)?.cashflow ?? []))
  return out.filter((r) => !/이월|기초잔액|전월잔액|기말잔액|월말잔액/.test(String(r.category ?? '').replace(/\s/g, '')))
}

const krwOf = (ctx: Ctx, r: FinRow, v: number) => {
  const cur = typeof r.currency === 'string' && r.currency ? r.currency : null
  return !cur || cur === 'KRW' ? v : cur === 'USD' && ctx.usdKrw ? v * ctx.usdKrw : null
}

/* ───────────────────────── 일별 자금보고 ───────────────────────── */

export interface DailyReport {
  asOf: string
  balances: { account: string; krw: number | null; usd: number | null }[]
  totalKrw: number | null
  totalUsd: number | null
  totalConverted: number | null
  usdKrw: number | null
  balanceFrom: 'cashflow' | 'books' | 'none'
  vsYesterday: number | null
  vsYesterdayUsd: number | null
  biggestOutToday: string | null
  sales: { revenue: number | null; revenueFrom: 'tax_invoice' | 'sales' | null; target: number | null; collected: number | null; collectedPrevMonth: number | null; receivable: number | null; dso: number | null; overdue: { amount: number; customers: number } | null; overdueNeed: string | null; expectThisWeek: number | null; expectNextWeek: number | null }
  loans: ReturnType<typeof computeDebt>
  trend: { date: string; krw: number }[]
  today: { kind: 'in' | 'out'; label: string; krw: number | null; usd: number | null }[]
  todayNet: { krw: number; usd: number }
  missing: string[]
}

/** 외상매출금 연체(원장 거래 줄 — 거래처마다 먼저 생긴 미수부터 갚는다고 본다). 원장 거래 줄에 외상매출금이 없으면 null. */
export function receivableAging(ctx: Ctx, upTo: string, days: number): { open: number; overdue: number; customers: number; byCustomer: { customer: string; amount: number }[] } | null {
  const lines: FinRow[] = []
  for (const [, m] of ctx.months) lines.push(...m.ledgerLines.filter((r) => /외상매출금|매출채권/.test(String(r.account_name ?? '')) && String(r.tx_date ?? '') <= upTo))
  if (!lines.length) return null
  const by = new Map<string, { date: string; amt: number }[]>()
  const paid = new Map<string, number>()
  for (const r of lines.sort((a, b) => String(a.tx_date ?? '').localeCompare(String(b.tx_date ?? '')))) {
    const c = String(r.counterparty ?? '거래처 없음')
    if (num(r.debit)) by.set(c, [...(by.get(c) ?? []), { date: String(r.tx_date ?? ''), amt: num(r.debit) }])
    if (num(r.credit)) paid.set(c, (paid.get(c) ?? 0) + num(r.credit))
  }
  const cut = addDays(upTo, -days)
  let open = 0
  let overdue = 0
  const over = new Map<string, number>()
  for (const [c, items] of by) {
    let left = paid.get(c) ?? 0
    for (const it of items) {
      const take = Math.min(left, it.amt)
      left -= take
      const rest = it.amt - take
      open += rest
      if (rest > 0 && it.date < cut) {
        overdue += rest
        over.set(c, (over.get(c) ?? 0) + rest)
      }
    }
  }
  return { open, overdue, customers: over.size, byCustomer: [...over.entries()].map(([customer, amount]) => ({ customer, amount })).sort((a, b) => b.amount - a.amount) }
}

export function computeDaily(ctx: Ctx): DailyReport {
  const today = ctx.today
  const period = today.slice(0, 7)
  const prev = addMonths(period, -1)
  const rows = cashRows(ctx, addMonths(period, -2), addMonths(period, 3))
  const missing: string[] = []
  const bal = accountBalances(ctx, rows, today)
  let balances: DailyReport['balances'] = bal.map((b) => ({ account: b.account, krw: b.currency && b.currency !== 'KRW' ? null : b.balance, usd: b.currency === 'USD' ? b.balance : null }))
  let balanceFrom: DailyReport['balanceFrom'] = bal.length ? 'cashflow' : 'none'
  if (!bal.length) {
    const bs = computeBs(ctx, period).cash ?? computeBs(ctx, prev).cash
    if (bs !== null) {
      balances = [{ account: '현금 · 예금 (장부 월말)', krw: bs, usd: null }]
      balanceFrom = 'books'
    } else missing.push('월별 자금흐름표의 계좌 · 잔액 칸(또는 장부 현금 계정)')
  }
  const totalKrw = balances.some((b) => b.krw !== null) ? balances.reduce((s, b) => s + (b.krw ?? 0), 0) : null
  const totalUsd = balances.some((b) => b.usd !== null) ? balances.reduce((s, b) => s + (b.usd ?? 0), 0) : null
  const totalConverted = totalKrw === null && totalUsd === null ? null : (totalKrw ?? 0) + (totalUsd !== null ? (ctx.usdKrw ? totalUsd * ctx.usdKrw : 0) : 0)
  if (totalUsd !== null && !ctx.usdKrw) missing.push('달러 환율(기준값 «달러 환율» 또는 공개 고시)')
  const yBal = accountBalances(ctx, rows, addDays(today, -1))
  const vsYesterday = bal.length && yBal.length ? bal.filter((b) => !b.currency || b.currency === 'KRW').reduce((s, b) => s + b.balance, 0) - yBal.filter((b) => !b.currency || b.currency === 'KRW').reduce((s, b) => s + b.balance, 0) : null
  const vsYesterdayUsd = bal.length && yBal.length ? bal.filter((b) => b.currency === 'USD').reduce((s, b) => s + b.balance, 0) - yBal.filter((b) => b.currency === 'USD').reduce((s, b) => s + b.balance, 0) : null

  // 오늘 들어오고 나간 돈(실제 줄)
  const todayRows = rows.filter((r) => dayOf(r) === today && !isPlanned(r))
  const todayList: DailyReport['today'] = []
  for (const r of todayRows) {
    const usd = r.currency === 'USD'
    if (num(r.inflow)) todayList.push({ kind: 'in', label: String(r.category ?? '입금'), krw: usd ? null : num(r.inflow), usd: usd ? num(r.inflow) : null })
    if (num(r.outflow)) todayList.push({ kind: 'out', label: String(r.category ?? '출금'), krw: usd ? null : num(r.outflow), usd: usd ? num(r.outflow) : null })
  }
  const todayNet = todayList.reduce((s, t) => ({ krw: s.krw + (t.kind === 'in' ? 1 : -1) * (t.krw ?? 0), usd: s.usd + (t.kind === 'in' ? 1 : -1) * (t.usd ?? 0) }), { krw: 0, usd: 0 })
  const biggestOut = todayRows.filter((r) => num(r.outflow)).sort((a, b) => num(b.outflow) - num(a.outflow))[0]

  // 10일 잔액 추이(주말 빼고)
  const trend: DailyReport['trend'] = []
  if (bal.length) {
    for (let d = today, n = 0; n < 9 && trend.length < 9; d = addDays(d, -1), n += 0) {
      if (weekday(d) !== 0 && weekday(d) !== 6) {
        const b = accountBalances(ctx, rows, d)
        trend.unshift({ date: d, krw: b.reduce((s, x) => s + (x.currency === 'USD' ? (ctx.usdKrw ? x.balance * ctx.usdKrw : 0) : x.currency && x.currency !== 'KRW' ? 0 : x.balance), 0) })
      }
      if (d < addDays(today, -40)) break
    }
  }

  // 이달 매출 · 수금
  const m = ctx.months.get(period)
  const invoiceSales = (m?.taxInvoice ?? []).filter((r) => r.direction === 'sales' && String(r.issued_on ?? '') <= today)
  const revenue = invoiceSales.length ? sumOf(invoiceSales, 'supply_amount') : m?.sales.length ? sumOf(m.sales.filter((r) => !r.tx_date || String(r.tx_date) <= today), 'amount') : null
  const revenueFrom = invoiceSales.length ? 'tax_invoice' : m?.sales.length ? 'sales' : null
  const monthRows = rows.filter((r) => dayOf(r).startsWith(period) && dayOf(r) <= today && !isPlanned(r))
  const collectRows = monthRows.filter((r) => num(r.inflow) && cashClassOf(String(r.category ?? '')) === 'operating' && /수금|매출|판매|대금|입금|수출/.test(String(r.category ?? '')))
  const collected = monthRows.length ? collectRows.reduce((s, r) => s + (krwOf(ctx, r, num(r.inflow)) ?? 0), 0) : null
  const prevMon = Number(prev.slice(5, 7))
  const collectedPrevMonth = collectRows.length ? collectRows.filter((r) => new RegExp(`전월|${prevMon}월분`).test(String(r.category ?? ''))).reduce((s, r) => s + (krwOf(ctx, r, num(r.inflow)) ?? 0), 0) || null : null
  const bsNow = computeBs(ctx, period)
  const receivable = bsNow.receivable ?? computeBs(ctx, prev).receivable
  const rev3 = [0, 1, 2].map((i) => computePl(ctx, addMonths(prev, -i)).revenue).filter((v): v is number => v !== null)
  const dso = receivable !== null && rev3.length ? Math.round(receivable / (rev3.reduce((s, v) => s + v, 0) / (rev3.length * 30))) : null
  const aging = receivableAging(ctx, today, ctx.settings.overdue_days)
  const weekEnd = addDays(today, 6 - weekday(today) + 1)
  const planned = rows.filter((r) => isPlanned(r) && num(r.inflow) && dayOf(r) >= today)
  const expectThisWeek = planned.length ? planned.filter((r) => dayOf(r) <= weekEnd).reduce((s, r) => s + (krwOf(ctx, r, num(r.inflow)) ?? 0), 0) : null
  const expectNextWeek = planned.length ? planned.filter((r) => dayOf(r) > weekEnd && dayOf(r) <= addDays(weekEnd, 7)).reduce((s, r) => s + (krwOf(ctx, r, num(r.inflow)) ?? 0), 0) : null
  if (revenue === null) missing.push('이달 세금계산서 목록 또는 판매현황')
  if (!monthRows.length) missing.push('이달 월별 자금흐름표(수금)')

  return {
    asOf: today,
    balances,
    totalKrw,
    totalUsd,
    totalConverted,
    usdKrw: ctx.usdKrw,
    balanceFrom,
    vsYesterday,
    vsYesterdayUsd,
    biggestOutToday: biggestOut ? String(biggestOut.category ?? '') : null,
    sales: {
      revenue,
      revenueFrom,
      target: ctx.settings.annual_revenue_target ? ctx.settings.annual_revenue_target / 12 : null,
      collected,
      collectedPrevMonth,
      receivable,
      dso,
      overdue: aging ? { amount: aging.overdue, customers: aging.customers } : null,
      overdueNeed: aging ? null : '원장 거래 줄(외상매출금 · 거래처)',
      expectThisWeek,
      expectNextWeek,
    },
    loans: computeDebt(ctx, period),
    trend,
    today: todayList,
    todayNet,
    missing,
  }
}

/* ───────────────────────── 현금흐름 달력 ───────────────────────── */

export interface CalItem {
  kind: 'in' | 'out'
  label: string
  krw: number
  planned: boolean
  cls: CashClass
  source: 'cashflow' | 'loan'
}
export interface CalDay {
  date: string
  items: CalItem[]
  balance: number | null
  big: 'in' | 'out' | null
  past: boolean
}
export interface CashCalendar {
  period: string
  opening: number | null
  inflow: number
  outflow: number
  closing: number | null
  low: { date: string; balance: number } | null
  days: CalDay[]
  lead: number
  byClass: Record<CashClass, { in: number; out: number }>
  forecast: { period: string; inflow: number; outflow: number; closing: number | null; low: number | null; estimated: boolean; note: string | null }[]
  safety: { value: number | null; from: 'setting' | 'average' | null }
  missing: string[]
}

/** 대출 일정 — 이자 내는 날(없으면 25일) · 만기 원금. */
function loanItems(ctx: Ctx, period: string): { date: string; item: CalItem }[] {
  const debt = computeDebt(ctx, period)
  const out: { date: string; item: CalItem }[] = []
  const last = lastDay(period)
  for (const r of debt.rows) {
    if (r.monthlyInterest && r.payDay !== null) {
      const d = `${period}-${String(Math.min(r.payDay, last)).padStart(2, '0')}`
      out.push({ date: d, item: { kind: 'out', label: `${r.lender} 이자`, krw: r.monthlyInterest, planned: true, cls: 'financing', source: 'loan' } })
    }
    if (r.maturity && r.maturity.startsWith(period) && r.balance) out.push({ date: r.maturity.slice(0, 10), item: { kind: 'out', label: `${r.lender} 만기 원금`, krw: r.balance, planned: true, cls: 'financing', source: 'loan' } })
  }
  return out
}

function monthItems(ctx: Ctx, period: string): Map<string, CalItem[]> {
  const today = ctx.today
  const by = new Map<string, CalItem[]>()
  const push = (d: string, it: CalItem) => by.set(d, [...(by.get(d) ?? []), it])
  const rows = (ctx.months.get(period)?.cashflow ?? []).filter((r) => dayOf(r).startsWith(period))
  for (const r of rows) {
    const d = dayOf(r)
    const planned = isPlanned(r) || d > today
    if (isPlanned(r) && d <= today) continue // 지난 날의 예정 줄은 실제 줄이 대신한다
    const cat = String(r.category ?? '')
    if (/이월|기초잔액|전월잔액|기말잔액|월말잔액/.test(cat.replace(/\s/g, ''))) continue
    const cls = cashClassOf(cat)
    const vin = krwOf(ctx, r, num(r.inflow))
    const vout = krwOf(ctx, r, num(r.outflow))
    if (vin) push(d, { kind: 'in', label: cat || '입금', krw: vin, planned, cls, source: 'cashflow' })
    if (vout) push(d, { kind: 'out', label: cat || '출금', krw: vout, planned, cls, source: 'cashflow' })
  }
  // 대출 일정 — 이미 자금흐름표에 그 날 «이자» 줄이 있으면 겹치지 않게 뺀다.
  for (const { date, item } of loanItems(ctx, period)) {
    if (date <= today) continue
    const same = (by.get(date) ?? []).some((x) => x.kind === 'out' && /이자|원금/.test(x.label))
    if (!same) push(date, item)
  }
  return by
}

function startBalance(ctx: Ctx, period: string): number | null {
  const prevEnd = `${addMonths(period, -1)}-31`
  const rows = cashRows(ctx, addMonths(period, -3), period)
  const b = accountBalances(ctx, rows, prevEnd)
  if (b.length) return b.reduce((s, x) => s + x.krw, 0)
  const c = computeCash(ctx, addMonths(period, -1))
  return c.closing ?? computeBs(ctx, addMonths(period, -1)).cash
}

export function computeCalendar(ctx: Ctx, period: string): CashCalendar {
  const missing: string[] = []
  const today = ctx.today
  const actualMonthsAvg = (() => {
    const xs: { in: number; out: number }[] = []
    for (let i = 1; i <= 6 && xs.length < 3; i += 1) {
      const p = addMonths(today.slice(0, 7), -i)
      const c = computeCash(ctx, p)
      if (c.hasFlows) xs.push({ in: c.inflow ?? 0, out: c.outflow ?? 0 })
    }
    return xs.length ? { in: xs.reduce((s, x) => s + x.in, 0) / xs.length, out: xs.reduce((s, x) => s + x.out, 0) / xs.length } : null
  })()
  const safety = ctx.settings.safety_cash !== null ? { value: ctx.settings.safety_cash, from: 'setting' as const } : actualMonthsAvg ? { value: Math.round(actualMonthsAvg.out), from: 'average' as const } : { value: null, from: null }

  const build = (p: string, opening: number | null) => {
    const items = monthItems(ctx, p)
    const days: CalDay[] = []
    let run = opening
    let low: { date: string; balance: number } | null = null
    let inflow = 0
    let outflow = 0
    const byClass: CashCalendar['byClass'] = { operating: { in: 0, out: 0 }, investing: { in: 0, out: 0 }, financing: { in: 0, out: 0 } }
    for (let d = 1; d <= lastDay(p); d += 1) {
      const date = `${p}-${String(d).padStart(2, '0')}`
      const its = items.get(date) ?? []
      const vin = its.filter((x) => x.kind === 'in').reduce((s, x) => s + x.krw, 0)
      const vout = its.filter((x) => x.kind === 'out').reduce((s, x) => s + x.krw, 0)
      inflow += vin
      outflow += vout
      for (const x of its) byClass[x.cls][x.kind === 'in' ? 'in' : 'out'] += x.krw
      if (run !== null) run += vin - vout
      if (run !== null && its.length && (!low || run < low.balance)) low = { date, balance: run }
      const big = vout >= ctx.settings.big_day && vout >= vin ? 'out' : vin >= ctx.settings.big_day ? 'in' : null
      days.push({ date, items: its, balance: its.length ? run : null, big, past: date <= today })
    }
    if (run !== null && (!low || run < low.balance)) low = low ?? { date: `${p}-${String(lastDay(p)).padStart(2, '0')}`, balance: run }
    return { days, inflow, outflow, closing: run, low, byClass, scheduled: [...items.values()].flat().length }
  }

  const opening = startBalance(ctx, period)
  if (opening === null) missing.push('월초 잔액(자금흐름표 잔액 · 장부 현금)')
  const main = build(period, opening)
  if (!main.scheduled) missing.push(`${Number(period.slice(5, 7))}월 자금흐름표(실제 · 예정 줄)`)
  const lead = new Date(`${period}-01T00:00:00Z`).getUTCDay()

  // 앞으로 3개월 — 예정 줄 · 대출 일정, 예정 줄이 없는 달은 최근 3개월 평균(추정).
  const forecast: CashCalendar['forecast'] = []
  let start = startBalance(ctx, today.slice(0, 7))
  for (let i = 0; i < 3; i += 1) {
    const p = addMonths(today.slice(0, 7), i)
    const r = build(p, start)
    const plannedIn = r.days.some((d) => d.items.some((x) => x.kind === 'in' && x.source === 'cashflow'))
    if (!plannedIn && actualMonthsAvg && p > today.slice(0, 7)) {
      const closing = start === null ? null : start + actualMonthsAvg.in - (actualMonthsAvg.out > r.outflow ? actualMonthsAvg.out : r.outflow)
      const out = Math.max(actualMonthsAvg.out, r.outflow)
      forecast.push({ period: p, inflow: actualMonthsAvg.in, outflow: out, closing, low: closing === null || start === null ? null : Math.min(start, closing), estimated: true, note: '예정 줄 없음 — 최근 3개월 평균' })
      start = closing
    } else {
      forecast.push({ period: p, inflow: r.inflow, outflow: r.outflow, closing: r.closing, low: r.low?.balance ?? null, estimated: false, note: null })
      start = r.closing
    }
  }
  return { period, opening, inflow: main.inflow, outflow: main.outflow, closing: main.closing, low: main.low, days: main.days, lead, byClass: main.byClass, forecast, safety, missing }
}
