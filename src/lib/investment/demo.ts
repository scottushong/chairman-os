/**
 * 원문이 준 Demo 값 — **코드에만 있고 DB에 넣지 않는다.** 화면은 이 값을 그릴 때 늘 DEMO 띠를 단다(원문 3.1 · 4.3 · 8.3 · 9).
 * 실제 데이터가 있으면 실측만 보이고, 없으면 0 또는 DATA NOT AVAILABLE이다. Demo를 실측처럼 보이게 하지 않는다(검증 12).
 */

export const DEMO_KPIS = {
  managers: 4,
  candidates: 28,
  newPositions: 4,
  added: 11,
  trimmed: 7,
  buyZone: 3,
  monthlyKrw: 1_000_000,
  yearlyKrw: 12_000_000,
} as const

export const DEMO_RADAR = [
  { manager: 'Berkshire', company: 'Company A', prev: 1_000_000, cur: 1_250_000, status: 'ADD', pct: 25 },
  { manager: 'Fundsmith', company: 'Company B', prev: 800_000, cur: 880_000, status: 'ADD', pct: 10 },
  { manager: 'NBIM', company: 'Company C', prev: 2_000_000, cur: 2_000_000, status: 'HOLD', pct: 0 },
  { manager: 'Pershing', company: 'Company D', prev: 400_000, cur: 320_000, status: 'TRIM', pct: -20 },
] as const

/** 원문 8.3 계산 예시. 결과 $201.14 · $114.13 · $91.30 · WATCH(check:investment가 못 박는다). */
export const DEMO_VALUATION = {
  price: 100,
  fcfPerShare: 5,
  fcfCagr: 0.15,
  exitMultiple: 20,
  requiredReturn: 0.12,
  marginOfSafety: 0.2,
  years: 5,
} as const

/** 원문 9 예시 — Opportunity 76.75 · Data Quality 88. */
export const DEMO_SCORES = { market: 80, leader: 85, valuation: 65, institutional: 70, dataQuality: 88 } as const
