import type { PriceRef } from './metrics'
import type { ValuationResult } from './valuation'

/**
 * 추천 상태(원문 9 · 10 + 머리말 «BUY 금지 조건») — 결정론. Opportunity Score가 높다고 BUY를 주지 않는다.
 *
 *   THESIS BROKEN  가설 훼손 기록이 최신이면(대표 · AI가 «훼손» 줄을 넣음)
 *   NEED DATA      필수 입력이 하나라도 LIVE · 출처 · 기준일 · 품질 기준을 못 넘으면
 *   OVERVALUED     현재가 > 현재가치(PV)
 *   BUY ZONE       아래 조건 전부 통과(검증된 주가 · 재무 · 가정 · 품질 · 근거 · 재무위험 없음 · 기대수익 ≥ 요구수익 · 현재가 ≤ 매수 기준가 · 가설 훼손 없음)
 *   WATCH          그 밖
 * 기관 보유는 보조 지표 — 없다고 BUY를 막지 않는다. AI는 이 판정을 바꾸지 못한다(DB 트리거가 BUY ZONE을 system 행 + 조건 전부 통과로만 받는다).
 */
export const RECOMMEND_VERSION = 'rec-1.0'

export type RecStatus = 'BUY ZONE' | 'WATCH' | 'OVERVALUED' | 'THESIS BROKEN' | 'NEED DATA'

export interface Assumption {
  value: number | null
  source_url: string | null
  as_of: string | null
  quality: number | null
}

export interface Check {
  key: string
  label: string
  pass: boolean
  detail: string
  /** 필수 입력(빠지면 NEED DATA) */
  required: boolean
}

export interface StockGateInput {
  kind: 'stock'
  price: PriceRef | null
  today: string
  financialsAsOf: string | null
  assumptions: Record<'fcfPerShare' | 'fcfCagr' | 'exitMultiple' | 'requiredReturn' | 'marginOfSafety', Assumption>
  minQuality: number
  dataQuality: number | null
  evidenceCount: number
  thesisBroken: boolean
  netDebtToEbitda: number | null
  fcf: number | null
  valuation: ValuationResult | null
  requiredReturnPct: number | null
}

export interface EtfGateInput {
  kind: 'etf'
  price: PriceRef | null
  today: string
  items: Record<'index' | 'expenseRatio' | 'holdings' | 'trackingError', { ok: boolean; detail: string }>
  minQuality: number
  dataQuality: number | null
  thesisBroken: boolean
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400_000

function assumptionOk(a: Assumption, min: number, today: string): boolean {
  return a.value !== null && Number.isFinite(a.value) && !!a.source_url && /^https:\/\//.test(a.source_url) && !!a.as_of && days(a.as_of, today) <= 400 && (a.quality ?? 0) >= min
}

/** 가격이 «검증된 주가»인가 — 일별 경로(Twelve Data · 대표 손 입력)이고 7일 안. 13F 분기말 파생은 PARTIAL이라 아니다. */
export function priceVerified(p: PriceRef | null, today: string): boolean {
  return !!p && (p.source === 'twelvedata' || p.source === 'manual') && days(p.as_of, today) <= 7
}

export function stockChecks(g: StockGateInput): Check[] {
  const a = g.assumptions
  const labels: Record<keyof StockGateInput['assumptions'], string> = { fcfPerShare: 'FCF/주', fcfCagr: '성장률', exitMultiple: '미래 배수', requiredReturn: '요구수익률', marginOfSafety: '안전마진' }
  const v = g.valuation
  return [
    { key: 'price', label: '검증된 주가(LIVE · 7일 안)', pass: priceVerified(g.price, g.today), detail: g.price ? `${g.price.as_of} · ${g.price.source}` : '가격 없음', required: true },
    { key: 'financials', label: '기업 재무(XBRL · 18개월 안)', pass: !!g.financialsAsOf && days(g.financialsAsOf, g.today) <= 550, detail: g.financialsAsOf ?? '재무 없음', required: true },
    ...(Object.keys(labels) as (keyof typeof labels)[]).map((k) => ({
      key: `assumption_${k}`,
      label: `가정 — ${labels[k]}(출처 · 기준일 · 품질 ${g.minQuality}+)`,
      pass: assumptionOk(a[k], g.minQuality, g.today),
      detail: a[k].value === null ? '값 없음' : `${a[k].value} · ${a[k].source_url ? '출처 있음' : '출처 없음'} · ${a[k].as_of ?? '기준일 없음'} · 품질 ${a[k].quality ?? '—'}`,
      required: true,
    })),
    { key: 'quality', label: `데이터 품질 ${g.minQuality} 이상`, pass: (g.dataQuality ?? 0) >= g.minQuality, detail: String(g.dataQuality ?? '—'), required: true },
    { key: 'evidence', label: '투자 가설 근거(출처 있는 근거 2개 이상)', pass: g.evidenceCount >= 2, detail: `${g.evidenceCount}개`, required: false },
    { key: 'risk', label: '심각한 재무 · 유동성 위험 없음(순차입금/EBITDA ≤ 4 · FCF > 0)', pass: g.fcf !== null && g.fcf > 0 && (g.netDebtToEbitda === null || g.netDebtToEbitda <= 4), detail: `FCF ${g.fcf ?? '—'} · ND/EBITDA ${g.netDebtToEbitda?.toFixed(2) ?? '—'}`, required: false },
    { key: 'return', label: '예상 수익률 ≥ 요구 수익률', pass: !!v && g.requiredReturnPct !== null && v.expectedCagrPct >= g.requiredReturnPct, detail: v ? `${v.expectedCagrPct.toFixed(1)}% vs ${g.requiredReturnPct ?? '—'}%` : '계산 없음', required: false },
    { key: 'margin', label: '안전마진(현재가 ≤ 매수 기준가)', pass: !!v && v.priceZone === 'BELOW_BUY', detail: v ? `기준가 대비 ${v.gapToBuyPct >= 0 ? '+' : ''}${v.gapToBuyPct.toFixed(1)}%` : '계산 없음', required: false },
    { key: 'thesis', label: '기업 전망을 무너뜨리는 사건 없음', pass: !g.thesisBroken, detail: g.thesisBroken ? '가설 훼손 기록' : '없음', required: false },
  ]
}

export function etfChecks(g: EtfGateInput): Check[] {
  return [
    { key: 'price', label: '검증된 가격(LIVE · 7일 안)', pass: priceVerified(g.price, g.today), detail: g.price ? `${g.price.as_of} · ${g.price.source}` : '가격 없음', required: true },
    { key: 'index', label: '기초지수', pass: g.items.index.ok, detail: g.items.index.detail, required: true },
    { key: 'expense', label: '총보수', pass: g.items.expenseRatio.ok, detail: g.items.expenseRatio.detail, required: true },
    { key: 'holdings', label: '구성 종목', pass: g.items.holdings.ok, detail: g.items.holdings.detail, required: true },
    { key: 'tracking', label: '추적오차', pass: g.items.trackingError.ok, detail: g.items.trackingError.detail, required: true },
    { key: 'quality', label: `데이터 품질 ${g.minQuality} 이상`, pass: (g.dataQuality ?? 0) >= g.minQuality, detail: String(g.dataQuality ?? '—'), required: true },
    { key: 'thesis', label: '가설 훼손 없음', pass: !g.thesisBroken, detail: g.thesisBroken ? '훼손 기록' : '없음', required: false },
  ]
}

export function decide(checks: readonly Check[], opts: { thesisBroken: boolean; valuation: ValuationResult | null; etf?: boolean }): RecStatus {
  if (opts.thesisBroken) return 'THESIS BROKEN'
  if (checks.some((c) => c.required && !c.pass)) return 'NEED DATA'
  if (!opts.etf && opts.valuation && opts.valuation.priceZone === 'ABOVE_VALUE') return 'OVERVALUED'
  if (checks.every((c) => c.pass)) return 'BUY ZONE'
  return 'WATCH'
}
