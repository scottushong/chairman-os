import type { FailureCause, InvOutcome, InvPrice, InvRecommendation } from './types'

/**
 * Performance & Learning(원문 13) — 결정론.
 *   · 추천 성과: 신호 시각(추천 생성) 다음 날 이후 첫 가격에 들어가고(매매 가능 시각 — 같은 날 가격을 쓰지 않는다),
 *     1 · 3 · 6 · 12 · 24 · 36 · 60개월 뒤 가격으로 나온다. 그 날짜가 아직 안 왔으면 계산하지 않는다(미래 가격 없음).
 *     가격이 끊긴 종목(상장폐지 · 거래정지 가능)은 빼지 않고 마지막 가격으로 끝내고 delisted 표시(생존자 편향 방지).
 *   · 지표: Hit Rate · Excess Return · Annualized · MDD · Volatility · Sharpe(무위험 0, 연환산) · Benchmark 대비.
 *   · 백테스트: 13F 공시의 «공개일»이 지난 뒤에만 신호를 쓴다(기준일이 아니라) — 미래 정보 금지.
 *   · 표본이 적으면(30 미만) 적중률로 모델 우수성을 단정하지 않는다 — 화면이 그 문장을 단다.
 */
export const PERFORMANCE_VERSION = 'perf-1.0'
export const HORIZONS = [1, 3, 6, 12, 24, 36, 60] as const
export type Horizon = (typeof HORIZONS)[number]

export const FAILURE_LABEL: Record<FailureCause, string> = {
  market_forecast: '1. 산업 성장 전망 오류',
  competitiveness: '2. 기업 경쟁력 전망 오류',
  earnings_cashflow: '3. 실적 · 현금흐름 전망 오류',
  buy_price_overestimated: '4. 매수가 과대평가',
  multiple_contraction: '5. 밸류에이션 배수 축소',
  macro: '6. 거시경제 변화',
  fx: '7. 환율 변동',
  data_error: '8. 데이터 오류',
  thesis_broken: '9. 투자 가설 훼손',
}

const addMonths = (day: string, m: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + m)
  return d.toISOString().slice(0, 10)
}

export interface OutcomeCalc {
  horizon: Horizon
  entry: InvPrice
  exit: InvPrice
  returnPct: number
  delisted: boolean
  benchmarkPct: number | null
}

/**
 * 한 추천의 기간별 성과. prices = 그 종목 가격(날짜순), bench = 벤치마크 가격(없으면 null).
 * 진입 = 신호 다음 날 이후 첫 가격(같은 날 가격은 신호를 만들 때 알 수 있었던 값일 수 있어 쓰지 않는다).
 */
export function outcomesFor(signalAt: string, prices: readonly InvPrice[], bench: readonly InvPrice[] | null, today: string, lastGlobalPriceDay: string | null): OutcomeCalc[] {
  const signalDay = signalAt.slice(0, 10)
  const ps = [...prices].sort((a, b) => a.d.localeCompare(b.d))
  const entry = ps.find((p) => p.d > signalDay)
  if (!entry) return []
  const out: OutcomeCalc[] = []
  for (const h of HORIZONS) {
    const target = addMonths(entry.d, h)
    if (target > today) break // 아직 오지 않은 날 — 미래 가격 없음
    const exitIdx = ps.findIndex((p) => p.d >= target)
    let exit: InvPrice
    let delisted = false
    if (exitIdx >= 0) exit = ps[exitIdx]
    else {
      // 그 날 이후 가격이 없다 — 다른 종목 가격은 그 뒤에도 있으면 이 종목은 끊긴 것(상장폐지 · 정지 가능)
      if (!lastGlobalPriceDay || lastGlobalPriceDay < target) break
      exit = ps[ps.length - 1]
      delisted = true
    }
    const b0 = bench?.find((p) => p.d >= entry.d)
    const b1 = bench ? [...bench].reverse().find((p) => p.d <= exit.d) : undefined
    out.push({
      horizon: h,
      entry,
      exit,
      returnPct: (exit.close / entry.close - 1) * 100,
      delisted,
      benchmarkPct: b0 && b1 && b1.d >= b0.d ? (b1.close / b0.close - 1) * 100 : null,
    })
  }
  return out
}

export interface Metrics {
  n: number
  hitRate: number | null
  avgReturn: number | null
  avgExcess: number | null
  annualized: number | null
  volatility: number | null
  sharpe: number | null
  maxDrawdown: number | null
  enoughData: boolean
}

/** 같은 기간(horizon)의 성과 줄들 → 지표. 적중 = 수익률 > 0(벤치마크가 있으면 초과수익 > 0). */
export function metricsFor(rows: readonly { return_pct: number | null; excess_pct: number | null; horizon_months: number }[]): Metrics {
  const xs = rows.filter((r) => r.return_pct !== null)
  const n = xs.length
  if (n === 0) return { n, hitRate: null, avgReturn: null, avgExcess: null, annualized: null, volatility: null, sharpe: null, maxDrawdown: null, enoughData: false }
  const h = xs[0].horizon_months
  const rets = xs.map((r) => r.return_pct! / 100)
  const hits = xs.filter((r) => (r.excess_pct ?? r.return_pct!) > 0).length
  const mean = rets.reduce((a, b) => a + b, 0) / n
  const sd = n > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null
  const perYear = 12 / h
  const exc = xs.filter((r) => r.excess_pct !== null).map((r) => r.excess_pct!)
  return {
    n,
    hitRate: (hits / n) * 100,
    avgReturn: mean * 100,
    avgExcess: exc.length ? exc.reduce((a, b) => a + b, 0) / exc.length : null,
    annualized: (Math.pow(1 + mean, perYear) - 1) * 100,
    volatility: sd === null ? null : sd * Math.sqrt(perYear) * 100,
    sharpe: sd ? (mean * perYear) / (sd * Math.sqrt(perYear)) : null,
    maxDrawdown: maxDrawdown(rets),
    enoughData: n >= 30,
  }
}

/** 수익률 줄을 순서대로 이어 붙인 자산 곡선의 최대 낙폭(%). */
export function maxDrawdown(rets: readonly number[]): number | null {
  if (rets.length === 0) return null
  let v = 1
  let peak = 1
  let mdd = 0
  for (const r of rets) {
    v *= 1 + r
    peak = Math.max(peak, v)
    mdd = Math.min(mdd, v / peak - 1)
  }
  return mdd * 100
}

/**
 * 실패 원인 규칙 추정(사람이 고르기 전의 제안 — «규칙 추정»으로 표시). 하나만 고른다.
 *   가설 훼손 기록 → 9 · 데이터 품질 50 미만 → 8 · 원화 수익 < 0 이지만 현지 통화 수익 ≥ 0 → 7 ·
 *   FCF/주가 시나리오보다 낮게 나옴 → 3 · FCF는 맞는데 배수가 줄었음 → 5 · 진입가가 매수 기준가보다 높았음 → 4 · 그 밖 → null(사람 판단)
 */
export function suggestCause(o: { returnPct: number; krwReturnPct?: number | null; thesisBroken: boolean; dataQuality: number | null; fcfForecastErrPct?: number | null; multipleChangePct?: number | null; entryAboveBuy?: boolean }): FailureCause | null {
  if (o.returnPct >= 0 && (o.krwReturnPct ?? 0) >= 0) return null
  if (o.thesisBroken) return 'thesis_broken'
  if (o.dataQuality !== null && o.dataQuality < 50) return 'data_error'
  if (o.krwReturnPct !== undefined && o.krwReturnPct !== null && o.krwReturnPct < 0 && o.returnPct >= 0) return 'fx'
  if (o.fcfForecastErrPct !== undefined && o.fcfForecastErrPct !== null && o.fcfForecastErrPct < -10) return 'earnings_cashflow'
  if (o.multipleChangePct !== undefined && o.multipleChangePct !== null && o.multipleChangePct < -10) return 'multiple_contraction'
  if (o.entryAboveBuy) return 'buy_price_overestimated'
  return null
}

export interface BacktestSignal {
  security_id: string
  /** 공시 기준일(분기말) — 신호로 쓰면 안 되는 날 */
  data_as_of: string
  /** 공시 공개일 — 이 날 뒤에만 신호를 안다 */
  published_at: string
  kind: 'NEW' | 'ADD'
}

export interface BacktestResult {
  trades: { security_id: string; signal: string; entry: string; exit: string; returnPct: number; delisted: boolean }[]
  skippedNoPrice: number
  avgReturn: number | null
  hitRate: number | null
  benchmarkAvg: number | null
}

/**
 * 13F 신호 백테스트 — «공개일 다음 가격»에 사서 holdMonths 뒤 가격에 판다. 기준일(분기말) 가격으로 사지 않는다(미래 정보).
 * 가격이 끊긴 종목은 마지막 가격으로 끝내고 포함한다(상장폐지 포함). 벤치마크 = 같은 기간 universe 평균(같은 가격 원천).
 */
export function backtest(signals: readonly BacktestSignal[], pricesOf: (id: string) => readonly InvPrice[], holdMonths: number, today: string, universe: readonly string[]): BacktestResult {
  const trades: BacktestResult['trades'] = []
  let skipped = 0
  const lastDay = universe.flatMap((id) => pricesOf(id).map((p) => p.d)).sort().at(-1) ?? null
  for (const s of signals) {
    const known = s.published_at
    const ps = [...pricesOf(s.security_id)].sort((a, b) => a.d.localeCompare(b.d))
    const entry = ps.find((p) => p.d > known)
    if (!entry) {
      skipped += 1
      continue
    }
    const target = addMonths(entry.d, holdMonths)
    if (target > today) {
      skipped += 1
      continue
    }
    let exit = ps.find((p) => p.d >= target)
    let delisted = false
    if (!exit) {
      if (!lastDay || lastDay < target) {
        skipped += 1
        continue
      }
      exit = ps[ps.length - 1]
      delisted = true
    }
    trades.push({ security_id: s.security_id, signal: known, entry: entry.d, exit: exit.d, returnPct: (exit.close / entry.close - 1) * 100, delisted })
  }
  const benchRets: number[] = []
  for (const t of trades) {
    const rs: number[] = []
    for (const id of universe) {
      const ps = pricesOf(id)
      const a = ps.find((p) => p.d === t.entry)
      const b = ps.find((p) => p.d === t.exit)
      if (a && b) rs.push((b.close / a.close - 1) * 100)
    }
    if (rs.length) benchRets.push(rs.reduce((x, y) => x + y, 0) / rs.length)
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  return {
    trades,
    skippedNoPrice: skipped,
    avgReturn: avg(trades.map((t) => t.returnPct)),
    hitRate: trades.length ? (trades.filter((t) => t.returnPct > 0).length / trades.length) * 100 : null,
    benchmarkAvg: avg(benchRets),
  }
}

/** 추천 → 성과 줄(아직 없는 기간만). 실행기(analyze.ts)가 쓴다. */
export function newOutcomeRows(rec: InvRecommendation, calcs: readonly OutcomeCalc[], existing: readonly InvOutcome[]): Omit<InvOutcome, 'outcome_id' | 'created_at'>[] {
  const have = new Set(existing.filter((o) => o.rec_id === rec.rec_id).map((o) => o.horizon_months))
  return calcs
    .filter((c) => !have.has(c.horizon))
    .map((c) => ({
      rec_id: rec.rec_id!,
      security_id: rec.security_id,
      horizon_months: c.horizon,
      entry_date: c.entry.d,
      entry_price: c.entry.close,
      exit_date: c.exit.d,
      exit_price: c.exit.close,
      return_pct: c.returnPct,
      benchmark_return_pct: c.benchmarkPct,
      excess_pct: c.benchmarkPct === null ? null : c.returnPct - c.benchmarkPct,
      delisted: c.delisted,
      failure_cause: null,
      cause_basis: null,
      note: c.entry.source === 'sec13f_implied' ? '가격 = 13F 분기말 파생' : null,
      calculation_version: PERFORMANCE_VERSION,
      created_kind: 'system' as const,
    }))
}
