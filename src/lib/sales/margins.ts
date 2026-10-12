import type { MarginBy, MarginCostBasis, MarginGrain, SaleGrade, SalesMarginRow } from '@/types'

import { costGrade, pgRound } from './cost'

/**
 * PHASE 5 «판매 실적 · 마진» 순수 도우미(서버 · DB를 모른다). live 계산은 0067 cost_margins · 0077 sales_margins(SQL)이고,
 * 여기는 dummy 거울 · 화면 문구 · 시험(check:sales-cost ⑤)이 쓴다. 규칙:
 *   · 합산은 원래 값끼리(매출 = Σ kg × 판매가 · 원가 = Σ kg × 실제 원가 원래 값) 더한 뒤 대표 외 1원(0.5는 0에서 먼 쪽).
 *   · 마진 % = 원래 값 비율(소수 1자리) — 실제 원가가 있는 판매의 매출로 나눈다. 원가 없는 판매는 n_uncomputed.
 *   · 견적 마진은 견적이 이어진 판매만.
 *   · 월 마감 표시: 묶음이 걸치는 모든 달이 0075 내부 마감 확정이면 «확정 매출원가 기준», 아니면 «잠정 대체원가».
 */

export const MARGIN_GRAINS: readonly MarginGrain[] = ['day', 'week', 'month', 'quarter', 'year']
export const MARGIN_BYS: readonly MarginBy[] = ['product', 'customer', 'total', 'deal']
export const GRAIN_KO: Record<MarginGrain, string> = { day: '일', week: '주', month: '월', quarter: '분기', year: '년' }
export const BY_KO: Record<MarginBy, string> = { product: '제품별', customer: '고객별', total: '전체', deal: '판매 한 줄씩' }
/** 0067 cost_margins limit — 이만큼 오면 잘렸을 수 있다(리뷰 M3 — 화면이 알린다). */
export const MARGIN_ROW_LIMIT = 5000

export const COST_BASIS_KO: Record<MarginCostBasis, string> = {
  closed_month: '확정 매출원가 기준',
  provisional: '잠정 대체원가',
}
export const COST_BASIS_NOTE: Record<MarginCostBasis, string> = {
  closed_month: '이 묶음의 달은 월별 손익이 내부 마감 확정됨(월 매출원가 확정). 판매 한 줄 원가는 생산 LOT Actual · 출고일 Current 그대로 — 월 매출원가와 섞지 않음',
  provisional: '월별 손익이 아직 마감 전 — 판매 한 줄 원가(생산 LOT가 없으면 출고일 Current)는 조회할 때 계산하는 값이고 저장하지 않음',
}

export const SALE_GRADE_KO: Record<SaleGrade, string> = { green: 'Green', yellow: 'Yellow', red: 'Red', too_low: '하한 미만', unknown: '계산 안 됨' }

/** 판매 한 줄 원가 출처(리뷰 M9 — LOT가 무효가 되면 'actual'인데 원가가 없다: «계산 안 됨»으로 따로 말한다). */
export function costSourceKo(source: 'actual' | 'current' | null, cost: number | null): string {
  if (cost === null) return source === 'actual' ? '계산 안 됨 — 생산 LOT 무효 또는 비용 배부 불가' : '계산 안 됨 — 원가 자료 부족'
  return source === 'actual' ? '생산 LOT Actual' : '출고일 Current(잠정 대체원가)'
}

/** 'YYYY-MM-DD'(시간대 없음) → 묶음 첫날. week = ISO 주 월요일(Postgres date_trunc('week')와 같다). */
export function periodStart(d: string, grain: MarginGrain): string {
  const [y, m, day] = d.split('-').map(Number)
  if (grain === 'day') return d
  if (grain === 'month') return `${y}-${String(m).padStart(2, '0')}-01`
  if (grain === 'quarter') return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
  if (grain === 'year') return `${y}-01-01`
  const t = Date.UTC(y, m - 1, day)
  const dow = (new Date(t).getUTCDay() + 6) % 7 // 월 = 0
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10)
}

/** 묶음이 걸치는 달(YYYY-MM) — 0077 sales_margins의 generate_series와 같다. */
export function monthsCovered(start: string, grain: MarginGrain, by: MarginBy): string[] {
  const [y, m, d] = start.split('-').map(Number)
  let end = new Date(Date.UTC(y, m - 1, d))
  if (by !== 'deal') {
    if (grain === 'week') end = new Date(end.getTime() + 6 * 86_400_000)
    else if (grain === 'quarter') end = new Date(Date.UTC(y, m - 1 + 2, 1))
    else if (grain === 'year') end = new Date(Date.UTC(y, m - 1 + 11, 1))
  }
  const out: string[] = []
  for (let cy = y, cm = m; cy < end.getUTCFullYear() || (cy === end.getUTCFullYear() && cm <= end.getUTCMonth() + 1); cm === 12 ? ((cy += 1), (cm = 1)) : (cm += 1)) {
    out.push(`${cy}-${String(cm).padStart(2, '0')}`)
  }
  return out
}

export function costBasisFor(start: string, grain: MarginGrain, by: MarginBy, closedMonths: ReadonlySet<string>): MarginCostBasis {
  return monthsCovered(start, grain, by).every((p) => closedMonths.has(p)) ? 'closed_month' : 'provisional'
}

/** 대표 = 원래 값 · 그 밖 = 1원(Postgres round와 같다 — cost_secret.shown). */
export const shownKrw = (x: number | null, chairman: boolean): number | null => (x === null ? null : chairman ? x : pgRound(x, 0))

/** 판매 한 줄 원래 값(dummy · 시험 입력). act_raw · q_raw는 원/kg 원래 값(null = 계산 안 됨 · 견적 없음). */
export interface MarginSaleInput {
  sale_id: string
  shipped_on: string
  product_id: string
  product_name: string
  customer_company: string
  kg: number
  price_krw_per_kg: number
  currency: string
  source: 'actual' | 'current'
  act_raw: number | null
  quote_id: string | null
  q_price: number | null
  q_raw: number | null
}

/** 0067 cost_margins + 0077 sales_margins 거울. 정렬 = 묶음 첫날 내림 · 이름. */
export function aggregateMargins(sales: readonly MarginSaleInput[], grain: MarginGrain, by: MarginBy, chairman: boolean, closedMonths: ReadonlySet<string>): SalesMarginRow[] {
  const groups = new Map<string, { ps: string; k: string; lb: string; xs: MarginSaleInput[] }>()
  for (const s of sales) {
    const ps = by === 'deal' ? s.shipped_on : periodStart(s.shipped_on, grain)
    const k = by === 'deal' ? s.sale_id : by === 'product' ? s.product_id : by === 'customer' ? s.customer_company : 'total'
    const lb = by === 'deal' ? `${s.customer_company} · ${s.product_name}` : by === 'product' ? s.product_name : by === 'customer' ? s.customer_company : '전체'
    const g = groups.get(`${ps}|${k}`) ?? { ps, k, lb, xs: [] }
    g.xs.push(s)
    if (lb > g.lb) g.lb = lb
    groups.set(`${ps}|${k}`, g)
  }
  const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0)
  const rows = [...groups.values()].map((g): SalesMarginRow => {
    const xs = g.xs
    const withCost = xs.filter((s) => s.act_raw !== null)
    const withQuote = xs.filter((s) => s.q_raw !== null && s.q_price !== null)
    const revenue = sum(xs.map((s) => s.kg * s.price_krw_per_kg))
    const costRaw = withCost.length ? sum(withCost.map((s) => s.kg * s.act_raw!)) : null
    const marginRaw = withCost.length ? sum(withCost.map((s) => s.kg * (s.price_krw_per_kg - s.act_raw!))) : null
    const revWithCost = sum(withCost.map((s) => s.kg * s.price_krw_per_kg))
    const pct = marginRaw === null || revWithCost === 0 ? null : (marginRaw / revWithCost) * 100
    const qMarginRaw = withQuote.length ? sum(withQuote.map((s) => s.kg * (s.q_price! - s.q_raw!))) : null
    const qRev = sum(withQuote.map((s) => s.kg * s.q_price!))
    const one = by === 'deal' ? xs[0] : null
    return {
      period_start: g.ps,
      key: g.k,
      label: g.lb,
      n_sales: xs.length,
      n_uncomputed: xs.length - withCost.length,
      kg: sum(xs.map((s) => s.kg)),
      revenue_krw: shownKrw(revenue, chairman)!,
      cost_krw: shownKrw(costRaw, chairman),
      margin_krw: shownKrw(marginRaw, chairman),
      margin_pct: pct === null ? null : pgRound(pct, 1),
      grade: costGrade(pct),
      quote_kg: withQuote.length ? sum(withQuote.map((s) => s.kg)) : null,
      quote_margin_krw: shownKrw(qMarginRaw, chairman),
      quote_margin_pct: qMarginRaw === null || qRev === 0 ? null : pgRound((qMarginRaw / qRev) * 100, 1),
      sale_id: one?.sale_id ?? null,
      shipped_on: one?.shipped_on ?? null,
      customer: one?.customer_company ?? null,
      product_name: one?.product_name ?? null,
      price_krw_per_kg: one?.price_krw_per_kg ?? null,
      currency: one?.currency ?? null,
      cost_source: one?.source ?? null,
      cost_krw_per_kg: one ? shownKrw(one.act_raw, chairman) : null,
      quote_id: one?.quote_id ?? null,
      quote_price_krw_per_kg: one?.q_price ?? null,
      quote_cost_krw_per_kg: one ? shownKrw(one.q_raw, chairman) : null,
      pl_closed: false,
      cost_basis: 'provisional',
    }
  })
  for (const r of rows) {
    r.cost_basis = costBasisFor(r.period_start, grain, by, closedMonths)
    r.pl_closed = r.cost_basis === 'closed_month'
  }
  return rows.sort((a, b) => (a.period_start < b.period_start ? 1 : a.period_start > b.period_start ? -1 : a.label < b.label ? -1 : a.label > b.label ? 1 : 0)).slice(0, MARGIN_ROW_LIMIT)
}

/** 화면 기간 — 기본은 오늘에서 1년 전 ~ 오늘(최대 3년 = 0067 1100일). 틀린 값은 기본으로. */
export function marginRange(from: string | undefined, to: string | undefined, today: string): { from: string; to: string } {
  const ok = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  const t = ok(to) && to! <= today ? to! : today
  const yearAgo = new Date(Date.parse(`${t}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10)
  const f = ok(from) && from! <= t && Date.parse(`${t}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) <= 1100 * 86_400_000 ? from! : yearAgo
  return { from: f, to: t }
}
