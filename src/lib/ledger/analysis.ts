import type {
  Account,
  Closing,
  CostCategory,
  CostIndexCode,
  Figure,
  FinanceLedger,
  FinanceMetric,
  PeriodKey,
  Provenance,
} from '@/types'
import { COST_CATEGORIES, COST_INDEX_LABEL_KO } from '@/types'

import { addMonths, combine2, figureOf, ledgerFigureOf, mapFigure, periodOfDate, sumFigures } from './basis'
import { metricsOf } from './cells'
import type { LedgerScope } from './scope'
import { cashFlowTotals } from './statements'

/**
 * 재무 화면과 야간 브리핑이 같이 쓰는 해석. 화면에서 따로 계산하지 않는다 —
 * 같은 Runway가 화면과 브리핑에서 다르게 나오는 순간 둘 다 못 믿는다.
 *
 * 비율(%)도 Figure다. 분모와 분자의 꼬리표 중 약한 쪽을 받는다.
 * '잠정 매출 대비 원재료 비중'은 확정이 아니다.
 */

export const FLOW_METRICS = ['Revenue', 'Cost', 'EBITDA', 'OperatingProfit', 'NetIncome'] as const
export type FlowMetric = (typeof FLOW_METRICS)[number]

export interface KpiCardData {
  metric: FlowMetric
  month: Figure | null
  ytd: Figure | null
  ttm: Figure | null
  /** 전년동월비(%). 직전 값이 0이거나 부호가 뒤집히면 null — lib/finance.ts deltaPct와 같은 규칙 */
  yoyPct: Figure | null
}

function pct(now: Figure | null, before: Figure | null): Figure | null {
  if (!now || !before || before.value === 0 || Math.sign(before.value) !== Math.sign(now.value)) return null
  return combine2(now, before, (a, b) => ((a - b) / Math.abs(b)) * 100)
}

function sumOver(scope: LedgerScope, metric: FinanceMetric, from: PeriodKey, to: PeriodKey): Figure | null {
  const parts: (Figure | null)[] = []
  for (let p = from; p <= to; p = addMonths(p, 1)) {
    const f = scope.periods.includes(p) ? scope.metricsAt(p)[metric] : undefined
    if (!f) return null // 빠진 달이 있으면 누계를 내지 않는다
    parts.push(f)
  }
  return sumFigures(parts)
}

export function kpiCards(scope: LedgerScope, period: PeriodKey): KpiCardData[] {
  const ly = addMonths(period, -12)
  return FLOW_METRICS.map((metric) => {
    const month = scope.metricsAt(period)[metric] ?? null
    return {
      metric,
      month,
      ytd: sumOver(scope, metric, `${period.slice(0, 4)}-01`, period),
      ttm: sumOver(scope, metric, addMonths(period, -11), period),
      yoyPct: pct(month, scope.periods.includes(ly) ? (scope.metricsAt(ly)[metric] ?? null) : null),
    }
  })
}

// ---------------------------------------------------------------------------
// 현금 · Runway
// ---------------------------------------------------------------------------

export interface RunwayData {
  cash: Figure | null
  /** 최근 3개월 평균 월 순소진(영업 + 투자 현금흐름의 반대). 양수 = 소진 */
  burn: Figure | null
  /** 개월. 소진이 없으면 null이고 status가 이유를 말한다 */
  months: Figure | null
  status: 'burning' | 'not_burning' | 'unknown'
  /** 평균에 들어간 달 */
  window: PeriodKey[]
}

/**
 * Runway = 현금 / 최근 3개월 평균 순소진.
 * 재무활동(차입)은 뺀다. 빌려서 늘어난 현금으로 소진이 없어 보이면 그게 가장 위험한 착시다.
 */
export function runway(scope: LedgerScope, period: PeriodKey): RunwayData {
  const cash = scope.metricsAt(period).Cash ?? null
  const window = [addMonths(period, -2), addMonths(period, -1), period]
  const burns: Figure[] = []
  for (const p of window) {
    const t = scope.periods.includes(p) ? cashFlowTotals(scope, p) : null
    const net = t ? sumFigures([t.operating, t.investing]) : null
    if (!net) return { cash, burn: null, months: null, status: 'unknown', window }
    burns.push(mapFigure(net, (v) => -v))
  }
  const total = sumFigures(burns)!
  const burn = mapFigure(total, (v) => v / burns.length)
  if (burn.value <= 0 || !cash) {
    return { cash, burn, months: null, status: cash ? 'not_burning' : 'unknown', window }
  }
  return { cash, burn, months: combine2(cash, burn, (c, b) => c / b), status: 'burning', window }
}

// ---------------------------------------------------------------------------
// 원가 구조
// ---------------------------------------------------------------------------

/** 원가 대분류 옆에 세울 드라이버. 라이센스는 달러 결제라 환율을 본다. 기타는 드라이버가 없다. */
export const COST_DRIVER: Record<CostCategory, { kind: 'index'; code: CostIndexCode } | { kind: 'fx'; base: string; quote: string } | null> = {
  raw_material: { kind: 'index', code: 'raw_material' },
  labor: { kind: 'index', code: 'cpi' },
  electricity: { kind: 'index', code: 'electricity' },
  freight: { kind: 'index', code: 'freight' },
  license: { kind: 'fx', base: 'USD', quote: 'KRW' },
  other: null,
}

export interface CostStructureRow {
  category: CostCategory
  amount: Figure | null
  /** 매출 100 기준 */
  share: Figure | null
  yoyPct: Figure | null
  driver: { label: string; now: Figure | null; yoyPct: Figure | null } | null
}

export interface CostStructure {
  period: PeriodKey
  revenue: Figure | null
  rows: CostStructureRow[]
}

/** 그 달 말일 이전의 가장 최근 관측치. 월말 하루 전에 발표된 값도 그 달 값이다. */
function latestIn(points: (Provenance & { date: string; value: number })[], period: PeriodKey): Figure | null {
  const hit = points
    .filter((p) => periodOfDate(p.date) === period)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1)
  return hit ? figureOf(hit.value, hit) : null
}

export function costStructure(scope: LedgerScope, ledger: FinanceLedger, period: PeriodKey): CostStructure {
  const ly = addMonths(period, -12)
  const revenue = scope.metricsAt(period).Revenue ?? null

  const categoryAt = (category: CostCategory, p: PeriodKey): Figure | null => {
    if (!scope.periods.includes(p)) return null
    const cells = scope.cellsAt(p)
    return sumFigures(
      [...scope.accounts.values()]
        .filter((a) => a.category === category && ['cogs', 'sga'].includes(a.section))
        .map((a) => cells.get(a.account_code) ?? null),
    )
  }

  const driverSeries = (category: CostCategory) => {
    const d = COST_DRIVER[category]
    if (!d) return null
    if (d.kind === 'index') {
      const pts = ledger.costIndices
        .filter((x) => x.index_code === d.code)
        .map((x) => ({ ...x, date: x.index_date, value: x.value }))
      return { label: COST_INDEX_LABEL_KO[d.code], at: (p: PeriodKey) => latestIn(pts, p) }
    }
    const pts = ledger.fxRates
      .filter((x) => x.base === d.base && x.quote === d.quote)
      .map((x) => ({ ...x, date: x.rate_date, value: x.rate }))
    return { label: `${d.base}/${d.quote}`, at: (p: PeriodKey) => latestIn(pts, p) }
  }

  return {
    period,
    revenue,
    rows: COST_CATEGORIES.map((category) => {
      const amount = categoryAt(category, period)
      const series = driverSeries(category)
      const now = series?.at(period) ?? null
      return {
        category,
        amount,
        share:
          amount && revenue && revenue.value !== 0
            ? combine2(amount, revenue, (a, r) => (a / r) * 100)
            : null,
        yoyPct: pct(amount, categoryAt(category, ly)),
        driver: series ? { label: series.label, now, yoyPct: pct(now, series.at(ly)) } : null,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// 잠정-확정 차이
// ---------------------------------------------------------------------------

export interface ClosingDiff {
  period: PeriodKey
  metrics: { metric: FinanceMetric; provisional: Figure; confirmed: Figure; diff: Figure }[]
  /** 차이가 큰 계정 순 */
  accounts: { account_code: string; name: string; provisional: Figure; confirmed: Figure; diff: Figure }[]
}

/**
 * 가장 최근에 확정 마감된 달에서, 마감 전 전표로 보이던 값과 확정값이 얼마나 달랐나.
 * 결산조정이 크면 그 회사의 잠정 숫자를 얼마나 믿을지가 달라진다 — 이번 달 잠정치를 읽는 눈금이다.
 *
 * provisional_amount가 null인 계정(마감 때 전표가 없던 계정)은 양쪽에서 같이 뺀다.
 * 한쪽에만 넣으면 그 계정 전체가 차이로 잡힌다.
 */
export function closingDiff(ledger: FinanceLedger, scope: LedgerScope): ClosingDiff | null {
  const rows = ledger.closings.filter(
    (c) => scope.businessIds.includes(c.business_id) && c.closed && c.provisional_amount !== null,
  )
  const period = rows.map((c) => c.period).sort().at(-1)
  if (!period) return null
  const inPeriod = rows.filter((c) => c.period === period)

  const cellsFrom = (pick: (c: Closing) => Figure) => {
    const parts = new Map<string, Figure[]>()
    for (const c of inPeriod) {
      const list = parts.get(c.account_code) ?? []
      list.push(pick(c))
      parts.set(c.account_code, list)
    }
    return new Map([...parts].map(([code, figs]) => [code, { account_code: code, amount: sumFigures(figs)! }]))
  }
  const confirmedCells = cellsFrom((c) => ledgerFigureOf(c.amount, c))
  // 마감 전 값은 같은 원천의 '마감되지 않은' 상태다. 꼬리표를 손으로 붙이지 않고 provenance에서 낸다.
  const provisionalCells = cellsFrom((c) => ledgerFigureOf(c.provisional_amount!, { ...c, closed: false }))

  const accounts: Map<string, Account> = scope.accounts
  const confirmed = metricsOf(confirmedCells, accounts)
  const provisional = metricsOf(provisionalCells, accounts)

  return {
    period,
    metrics: (Object.keys(confirmed) as FinanceMetric[])
      .filter((m) => provisional[m])
      .map((metric) => ({
        metric,
        provisional: provisional[metric]!,
        confirmed: confirmed[metric]!,
        diff: combine2(confirmed[metric]!, provisional[metric]!, (a, b) => a - b),
      })),
    accounts: [...confirmedCells.keys()]
      .map((code) => {
        const c = confirmedCells.get(code)!.amount
        const p = provisionalCells.get(code)!.amount
        return {
          account_code: code,
          name: accounts.get(code)?.name ?? code,
          provisional: p,
          confirmed: c,
          diff: combine2(c, p, (a, b) => a - b),
        }
      })
      .filter((r) => Math.round(r.diff.value) !== 0)
      .sort((a, b) => Math.abs(b.diff.value) - Math.abs(a.diff.value)),
  }
}
