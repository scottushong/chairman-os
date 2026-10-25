import type { InvFact, InvPrice } from './types'

/**
 * XBRL 원천 → 기업 재무 지표(원문 5.2). 결정론 · AI 없음. 같은 기간을 여러 공시가 낸 값은 가장 늦게 낸 값을 쓴다(이력은 표에 남아 있다).
 *   FCF = 영업현금흐름 − 설비투자(PP&E 취득)       EBITDA = 영업이익 + 감가상각
 *   ROIC = 영업이익 × (1 − 실효세율) ÷ (자본 + 차입금 − 현금)   ROE = 순이익 ÷ 평균 자본
 *   Net Debt = 차입금 − 현금        가격 지표는 가격 출처(일별 · 13F 분기말 파생)를 같이 돌려준다.
 */

type Key = 'revenue' | 'cogs' | 'gross' | 'op' | 'net' | 'ocf' | 'capex' | 'da' | 'eps' | 'dilShares' | 'cash' | 'debtTotal' | 'debtNon' | 'debtCur' | 'debtCur2' | 'stb' | 'equity' | 'tax' | 'pretax'

const CONCEPTS: Record<Key, string[]> = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'Revenue'],
  cogs: ['CostOfRevenue'],
  gross: ['GrossProfit'],
  op: ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities'],
  net: ['NetIncomeLoss', 'ProfitLoss'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'CashFlowsFromUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
  da: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization'],
  eps: ['EarningsPerShareDiluted', 'DilutedEarningsLossPerShare'],
  dilShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalents'],
  debtTotal: ['LongTermDebt'],
  debtNon: ['LongTermDebtNoncurrent'],
  debtCur: ['LongTermDebtCurrent'],
  debtCur2: ['DebtCurrent'],
  stb: ['ShortTermBorrowings'],
  equity: ['StockholdersEquity', 'Equity'],
  tax: ['IncomeTaxExpenseBenefit'],
  pretax: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest'],
}
const INSTANT: ReadonlySet<Key> = new Set(['cash', 'debtTotal', 'debtNon', 'debtCur', 'debtCur2', 'stb', 'equity'])

const days = (f: InvFact) => (f.period_start ? Math.round((Date.parse(f.period_end) - Date.parse(f.period_start)) / 86400_000) : 0)

export interface FinRow {
  label: string
  period_end: string
  kind: 'FY' | 'Q'
  currency: string
  revenue: number | null
  gross: number | null
  op: number | null
  net: number | null
  ocf: number | null
  capex: number | null
  fcf: number | null
  da: number | null
  ebitda: number | null
  eps: number | null
  dilShares: number | null
  cash: number | null
  debt: number | null
  equity: number | null
  taxRate: number | null
  /** 이 줄 값의 공시(가장 늦게 낸 것) — 출처 */
  accession: string | null
  filed: string | null
}

/** 같은 (개념, 단위, 기간)의 가장 늦은 공시 값. */
function latestByPeriod(facts: readonly InvFact[]) {
  const m = new Map<string, InvFact>()
  for (const f of facts) {
    const k = `${f.concept}|${f.unit}|${f.period_key}`
    const cur = m.get(k)
    if (!cur || (f.filed ?? '') > (cur.filed ?? '')) m.set(k, f)
  }
  return [...m.values()]
}

function currencyOf(facts: readonly InvFact[]) {
  const c = new Map<string, number>()
  for (const f of facts) if (/^[A-Z]{3}$/.test(f.unit)) c.set(f.unit, (c.get(f.unit) ?? 0) + 1)
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD'
}

function pick(facts: readonly InvFact[], key: Key, end: string, kind: 'FY' | 'Q', currency: string): InvFact | null {
  for (const concept of CONCEPTS[key]) {
    const unitOk = (f: InvFact) => (key === 'eps' ? f.unit.startsWith(currency) : key === 'dilShares' ? f.unit === 'shares' : f.unit === currency)
    const xs = facts.filter((f) => f.concept === concept && f.period_end === end && unitOk(f))
    const hit = INSTANT.has(key)
      ? xs.find((f) => !f.period_start)
      : xs.find((f) => (kind === 'FY' ? days(f) >= 330 && days(f) <= 400 : days(f) >= 80 && days(f) <= 100))
    if (hit) return hit
  }
  return null
}

function row(facts: readonly InvFact[], end: string, kind: 'FY' | 'Q', currency: string, label: string): FinRow {
  const got = Object.fromEntries((Object.keys(CONCEPTS) as Key[]).map((k) => [k, pick(facts, k, end, kind, currency)])) as Record<Key, InvFact | null>
  const v = (k: Key) => got[k]?.value ?? null
  const revenue = v('revenue')
  const gross = v('gross') ?? (revenue !== null && v('cogs') !== null ? revenue - v('cogs')! : null)
  const ocf = v('ocf')
  const capex = v('capex')
  const debt = v('debtTotal') ?? (v('debtNon') !== null || v('debtCur') !== null || v('debtCur2') !== null || v('stb') !== null ? (v('debtNon') ?? 0) + (v('debtCur') ?? v('debtCur2') ?? 0) + (v('stb') ?? 0) : null)
  const taxRate = v('tax') !== null && v('pretax') ? Math.min(0.35, Math.max(0, v('tax')! / v('pretax')!)) : null
  const newest = Object.values(got).filter(Boolean).sort((a, b) => (b!.filed ?? '').localeCompare(a!.filed ?? ''))[0] ?? null
  return {
    label,
    period_end: end,
    kind,
    currency,
    revenue,
    gross,
    op: v('op'),
    net: v('net'),
    ocf,
    capex,
    fcf: ocf !== null && capex !== null ? ocf - capex : null,
    da: v('da'),
    ebitda: v('op') !== null && v('da') !== null ? v('op')! + v('da')! : null,
    eps: v('eps'),
    dilShares: v('dilShares'),
    cash: v('cash'),
    debt,
    equity: v('equity'),
    taxRate,
    accession: newest?.accession ?? null,
    filed: newest?.filed ?? null,
  }
}

/** 연간 줄(최근 → 과거). 회계연도 끝 = 1년 기간 매출 · 영업현금흐름 사실의 끝날. */
export function annualRows(all: readonly InvFact[]): FinRow[] {
  const facts = latestByPeriod(all)
  const currency = currencyOf(facts)
  const ends = new Set(
    facts
      .filter((f) => (CONCEPTS.revenue.includes(f.concept) || CONCEPTS.ocf.includes(f.concept) || CONCEPTS.net.includes(f.concept)) && days(f) >= 330 && days(f) <= 400)
      .map((f) => f.period_end),
  )
  return [...ends]
    .sort()
    .reverse()
    .slice(0, 6)
    .map((end) => row(facts, end, 'FY', currency, `FY${end.slice(0, 4)}${end.slice(5, 7) === '12' ? '' : `(${end.slice(5, 7)}월 결산)`}`))
}

/** 분기 줄 — 3개월 기간 손익. 현금흐름은 10-Q가 누계라 같은 시작일의 누계 차이로 3개월을 만든다. */
export function quarterRows(all: readonly InvFact[]): FinRow[] {
  const facts = latestByPeriod(all)
  const currency = currencyOf(facts)
  const ends = new Set(facts.filter((f) => CONCEPTS.revenue.includes(f.concept) && days(f) >= 80 && days(f) <= 100).map((f) => f.period_end))
  const ytd = (key: 'ocf' | 'capex', end: string): number | null => {
    for (const concept of CONCEPTS[key]) {
      const xs = facts.filter((f) => f.concept === concept && f.unit === currency && f.period_start)
      const at = xs.filter((f) => f.period_end === end).sort((a, b) => days(a) - days(b))
      const q = at.find((f) => days(f) >= 80 && days(f) <= 100)
      if (q) return q.value
      const cum = at[0]
      if (!cum) continue
      const prev = xs.filter((f) => f.period_start === cum.period_start && f.period_end < end).sort((a, b) => b.period_end.localeCompare(a.period_end))[0]
      if (prev && days(cum) - days(prev) >= 80 && days(cum) - days(prev) <= 100) return cum.value - prev.value
    }
    return null
  }
  return [...ends]
    .sort()
    .reverse()
    .slice(0, 8)
    .map((end) => {
      const r = row(facts, end, 'Q', currency, `${end.slice(0, 7)} 분기`)
      const ocf = r.ocf ?? ytd('ocf', end)
      const capex = r.capex ?? ytd('capex', end)
      return { ...r, ocf, capex, fcf: ocf !== null && capex !== null ? ocf - capex : null }
    })
}

export interface PriceRef {
  value: number
  as_of: string
  source: InvPrice['source']
}

/** 가격 하나 — 일별(Twelve Data)이 있으면 그것, 없으면 13F 분기말 파생, 둘 다 없으면 null. */
export function latestPrice(prices: readonly InvPrice[]): PriceRef | null {
  const daily = prices.filter((p) => p.source === 'twelvedata' || p.source === 'manual').sort((a, b) => a.d.localeCompare(b.d)).at(-1)
  if (daily) return { value: daily.close, as_of: daily.d, source: daily.source }
  const q = prices.filter((p) => p.source === 'sec13f_implied').sort((a, b) => a.d.localeCompare(b.d)).at(-1)
  return q ? { value: q.close, as_of: q.d, source: q.source } : null
}

const cagr = (a: number | null, b: number | null, years: number) => (a && b && a > 0 && b > 0 && years > 0 ? (Math.pow(a / b, 1 / years) - 1) * 100 : null)

export interface Metrics {
  currency: string
  fy: FinRow | null
  revenue: number | null
  revenueCagr3: number | null
  revenueCagr5: number | null
  grossMargin: number | null
  opMargin: number | null
  ebitda: number | null
  eps: number | null
  fcf: number | null
  fcfPerShare: number | null
  roic: number | null
  roe: number | null
  netDebt: number | null
  netDebtToEbitda: number | null
  shareCount: number | null
  price: PriceRef | null
  marketCap: number | null
  pe: number | null
  evEbitda: number | null
  pFcf: number | null
  evFcf: number | null
  /** 지난 5개 회계연도 끝 가격 기준 P/FCF 범위 — 그 무렵 가격이 있는 해만 */
  pFcfRange: { min: number; max: number; years: number } | null
}

export function computeMetrics(facts: readonly InvFact[], prices: readonly InvPrice[], sharesOutstanding: number | null): Metrics {
  const rows = annualRows(facts)
  const fy = rows[0] ?? null
  const prevFy = rows[1] ?? null
  const price = latestPrice(prices)
  const shareCount = sharesOutstanding ?? fy?.dilShares ?? null
  const marketCap = price && shareCount ? price.value * shareCount : null
  const netDebt = fy && fy.debt !== null && fy.cash !== null ? fy.debt - fy.cash : fy && fy.cash !== null ? -fy.cash : null
  const ev = marketCap !== null && netDebt !== null ? marketCap + netDebt : null
  const taxRate = fy?.taxRate ?? 0.21
  const invested = fy && fy.equity !== null ? fy.equity + (fy.debt ?? 0) - (fy.cash ?? 0) : null
  const avgEquity = fy?.equity !== null && fy?.equity !== undefined ? (prevFy?.equity ? (fy.equity + prevFy.equity) / 2 : fy.equity) : null
  const range = (() => {
    const xs: number[] = []
    for (const r of rows.slice(0, 5)) {
      if (!r.fcf || r.fcf <= 0 || !r.dilShares) continue
      const p = prices
        .filter((x) => x.d <= r.period_end && Date.parse(r.period_end) - Date.parse(x.d) <= 100 * 86400_000)
        .sort((a, b) => b.d.localeCompare(a.d))[0]
      if (p) xs.push((p.close * r.dilShares) / r.fcf)
    }
    return xs.length ? { min: Math.min(...xs), max: Math.max(...xs), years: xs.length } : null
  })()
  return {
    currency: fy?.currency ?? 'USD',
    fy,
    revenue: fy?.revenue ?? null,
    revenueCagr3: cagr(fy?.revenue ?? null, rows[3]?.revenue ?? null, 3),
    revenueCagr5: cagr(fy?.revenue ?? null, rows[5]?.revenue ?? null, 5),
    grossMargin: fy?.revenue && fy.gross !== null ? (fy.gross / fy.revenue) * 100 : null,
    opMargin: fy?.revenue && fy.op !== null ? (fy.op / fy.revenue) * 100 : null,
    ebitda: fy?.ebitda ?? null,
    eps: fy?.eps ?? null,
    fcf: fy?.fcf ?? null,
    fcfPerShare: fy?.fcf !== null && fy?.fcf !== undefined && fy.dilShares ? fy.fcf / fy.dilShares : null,
    roic: fy?.op !== null && fy?.op !== undefined && invested && invested > 0 ? ((fy.op * (1 - taxRate)) / invested) * 100 : null,
    roe: fy?.net !== null && fy?.net !== undefined && avgEquity && avgEquity > 0 ? (fy.net / avgEquity) * 100 : null,
    netDebt,
    netDebtToEbitda: netDebt !== null && fy?.ebitda ? netDebt / fy.ebitda : null,
    shareCount,
    price,
    marketCap,
    pe: price && fy?.eps && fy.eps > 0 ? price.value / fy.eps : null,
    evEbitda: ev !== null && fy?.ebitda && fy.ebitda > 0 ? ev / fy.ebitda : null,
    pFcf: marketCap !== null && fy?.fcf && fy.fcf > 0 ? marketCap / fy.fcf : null,
    evFcf: ev !== null && fy?.fcf && fy.fcf > 0 ? ev / fy.fcf : null,
    pFcfRange: range,
  }
}

/** dei:EntityCommonStockSharesOutstanding의 가장 늦은 값. */
export function sharesOutstanding(facts: readonly InvFact[]): { value: number; as_of: string } | null {
  const xs = facts.filter((f) => f.concept === 'EntityCommonStockSharesOutstanding').sort((a, b) => a.period_end.localeCompare(b.period_end) || (a.filed ?? '').localeCompare(b.filed ?? ''))
  const last = xs.at(-1)
  if (!last) return null
  // 주식 종류가 여럿이면(BRK 등) 같은 날 값을 더한다.
  const same = latestByPeriod(xs.filter((f) => f.period_end === last.period_end))
  return { value: same.reduce((s, f) => s + f.value, 0), as_of: last.period_end }
}
