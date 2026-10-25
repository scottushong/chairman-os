/**
 * 5년 가치평가 모델(원문 8.2) — 독립 계산 모듈. 결정론, AI 없음. 배당 · 증자/희석 · 세금 · 환율은 생략한 단순 모델(원문 8.3).
 *
 *   Future FCF per Share = Current FCF per Share × (1 + FCF CAGR)^N
 *   Future Share Price   = Future FCF per Share × Exit P/FCF
 *   Present Value        = Future Share Price / (1 + Required Return)^N
 *   Buy Price            = Present Value × (1 − Margin of Safety)
 *
 * 8.3 예시(가격 $100 · FCF/주 $5 · 15% · 20배 · 12% · 20% · 5년) → $201.14 · $114.13 · $91.30 · WATCH(check:investment가 못 박는다).
 * 나중에 정교한 DCF를 붙일 때는 같은 입력/출력 모양으로 함수를 하나 더 두고 calculation_version을 올린다.
 */
export const VALUATION_VERSION = 'val-1.0'

export interface ValuationInput {
  price: number
  fcfPerShare: number
  /** 소수(0.15 = 15%) */
  fcfCagr: number
  exitMultiple: number
  requiredReturn: number
  marginOfSafety: number
  years: number
}

export interface ValuationResult {
  futureFcfPerShare: number
  futurePrice: number
  presentValue: number
  buyPrice: number
  /** 현재가 대비 5년 뒤 주가 상승률(%) */
  upsidePct: number
  /** 현재가에 사서 N년 뒤 미래 주가에 판다면 연복리(%) */
  expectedCagrPct: number
  /** 매수 기준가 대비 현재가 차이(%) — 양수면 현재가가 비싸다 */
  gapToBuyPct: number
  /** 가격만으로 본 상태 — BUY ZONE 판정은 이것과 별개 조건(recommend.ts)이 더 붙는다 */
  priceZone: 'BELOW_BUY' | 'WATCH' | 'ABOVE_VALUE'
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function validateInput(v: ValuationInput): string | null {
  if (!(v.price > 0)) return '현재 주가는 0보다 커야 합니다.'
  if (!(v.fcfPerShare > 0)) return 'FCF/주가 0 이하이면 이 모델로 계산하지 않습니다.'
  if (!(v.fcfCagr > -0.5 && v.fcfCagr < 1)) return 'FCF 성장률은 −50% ~ 100% 사이.'
  if (!(v.exitMultiple > 0 && v.exitMultiple <= 100)) return '미래 P/FCF 배수는 0 ~ 100 사이.'
  if (!(v.requiredReturn > 0 && v.requiredReturn < 1)) return '요구 수익률은 0 ~ 100% 사이.'
  if (!(v.marginOfSafety >= 0 && v.marginOfSafety < 1)) return '안전마진은 0 ~ 100% 사이.'
  if (!(Number.isInteger(v.years) && v.years >= 1 && v.years <= 20)) return '투자 기간은 1 ~ 20년.'
  return null
}

export function valuate(v: ValuationInput): ValuationResult {
  const futureFcfPerShare = v.fcfPerShare * Math.pow(1 + v.fcfCagr, v.years)
  const futurePrice = futureFcfPerShare * v.exitMultiple
  const presentValue = futurePrice / Math.pow(1 + v.requiredReturn, v.years)
  const buyPrice = presentValue * (1 - v.marginOfSafety)
  const upsidePct = (futurePrice / v.price - 1) * 100
  const expectedCagrPct = (Math.pow(futurePrice / v.price, 1 / v.years) - 1) * 100
  const gapToBuyPct = (v.price / buyPrice - 1) * 100
  const priceZone = v.price <= buyPrice ? 'BELOW_BUY' : v.price <= presentValue ? 'WATCH' : 'ABOVE_VALUE'
  return { futureFcfPerShare, futurePrice, presentValue, buyPrice, upsidePct, expectedCagrPct, gapToBuyPct, priceZone }
}

export type ScenarioKey = 'bear' | 'base' | 'bull'

/**
 * Valuation Score(0~100) — 현재가가 현재가치(PV) 대비 얼마나 싼가. 50 = PV와 같음, PV의 절반 가격이면 100, PV의 2배 가격이면 0.
 *   score = clamp(50 + (PV / price − 1) × 100, 0, 100)
 * 원문 9의 점수 칸에 들어가는 «가치평가» 축 — 공식과 근거를 화면에 같이 적는다.
 */
export function valuationScore(presentValue: number, price: number): number {
  return Math.max(0, Math.min(100, 50 + (presentValue / price - 1) * 100))
}
