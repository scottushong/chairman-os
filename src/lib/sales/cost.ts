import type { CostGrade, IsoDate, PriceCheck, SalesOffer } from '@/types'

/**
 * 영업 원가 화면의 순수 함수(브라우저 · 서버 · dummy · 검사가 같이 쓴다). 식은 0062 그대로 옮겨 적은 것이다 —
 *   총원가 · 제시가 = 10원/kg 반올림(Postgres round(x, -1) = 0.5는 0에서 먼 쪽)
 *   마진 % = (판매가 − 총원가) ÷ 판매가 × 100, 0.1%p 반올림
 *   등급 = 20% 이상 green · 15% 이상 yellow · 그 밑 red(cost_grade)
 *   목표 마진별 제시가 = 총원가 ÷ (1 − 마진), 15 · 20 · 25 · 30%
 * 원료는 여기 없다 — 받는 것도 돌려주는 것도 제품 총액뿐이다.
 */

/** Postgres round(numeric, digits)와 같은 반올림 — 0.5는 0에서 먼 쪽으로. digits = −1이면 10원 단위. */
export function pgRound(x: number, digits: number): number {
  const f = 10 ** digits
  // 부동소수 오차(1.005 × 100 = 100.49999…)를 먼저 걷는다.
  const scaled = Number((Math.abs(x) * f).toPrecision(12))
  return (Math.sign(x) * Math.round(scaled)) / f || 0
}

export const round10 = (x: number) => pgRound(x, -1)

export function costGrade(marginPct: number | null): CostGrade | null {
  if (marginPct === null || !Number.isFinite(marginPct)) return null
  return marginPct >= 20 ? 'green' : marginPct >= 15 ? 'yellow' : 'red'
}

export const TARGET_MARGINS = [15, 20, 25, 30] as const

export function salesOffers(total: number | null): SalesOffer[] {
  if (total === null) return []
  return TARGET_MARGINS.map((m) => ({ margin_pct: m, price_krw_per_kg: round10(total / (1 - m / 100)), grade: costGrade(m)! }))
}

/** 0062 cost_price_check와 같은 답. 값이 0 이하 · 10억 초과면 null(DB는 cost_price_invalid). */
export function priceCheck(total: number | null, price: number | null): PriceCheck | null {
  if (price === null || !Number.isFinite(price) || price <= 0 || price > 1e9) return null
  if (total === null) return { total_krw_per_kg: null, margin_krw_per_kg: null, margin_pct: null, grade: null }
  const pct = pgRound(((price - total) / price) * 100, 1)
  return { total_krw_per_kg: total, margin_krw_per_kg: price - total, margin_pct: pct, grade: costGrade(pct) }
}

/** 원료비 영향(지난 주 → 이번 주) — 반올림 전 원료비 둘로. 지난 주가 없거나 0이면 null. */
export function materialImpactPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !(previous > 0)) return null
  return pgRound((current / previous - 1) * 100, 1)
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토']

export function weekdayKo(d: IsoDate): string {
  return WEEKDAY_KO[new Date(`${d}T00:00:00Z`).getUTCDay()]
}

/**
 * 기준 문구. 대표 외는 «2026-10-05(월) 0시 기준, 주 1회 갱신» — 주 안에서 값이 움직이지 않는다(0062 cost_gate).
 * 대표는 오늘 값을 보므로 «2026-10-09(금) 기준 · 지금 아는 값».
 */
export function asOfLabel(asOf: IsoDate, live: boolean): string {
  return live ? `${asOf}(${weekdayKo(asOf)}) 기준 · 지금 아는 값` : `${asOf}(${weekdayKo(asOf)}) 0시 기준, 주 1회 갱신`
}

/** «원료비 영향 +4.2%» · 값이 없으면 null(화면이 줄을 그리지 않는다). */
export function impactText(pct: number | null): string | null {
  if (pct === null) return null
  return `원료비 영향 ${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct).toFixed(1)}%`
}

/** 원/kg 표기 — 정수 · 쉼표. 음수는 «−». */
export function krw(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  const s = Math.round(Math.abs(n)).toLocaleString('ko-KR')
  return n < 0 ? `−${s}` : s
}

export const GRADE_LABEL: Record<CostGrade, string> = { green: 'Green', yellow: 'Yellow', red: 'Red' }

/** 등급 뱃지 색(Green/Yellow/Red). 토큰 이름은 globals.css(ok · warning · critical). */
export const GRADE_CLASS: Record<CostGrade, string> = {
  green: 'border-ok/40 bg-ok/15 text-ok',
  yellow: 'border-warning/40 bg-warning/15 text-warning',
  red: 'border-critical/40 bg-critical/15 text-critical',
}

/** Red일 때 화면 문구(승인 요청 연결은 견적 블록). 호칭은 «대표». */
export const RED_NOTICE = 'Red — 대표 승인이 필요합니다. 승인 요청(결재)은 견적 블록에서 열립니다.'

/**
 * 영업 원가 함수의 DB 거부 → 사람의 말(0062 이유 코드). 호칭은 «대표»(직원 화면).
 */
export function salesCostError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (/cost_role_conflict/.test(m)) return '구매 · 생산 권한과 영업 원가는 같이 볼 수 없습니다 — 대표에게 권한 정리를 요청하세요.'
  if (/cost_rate_limited/.test(m)) return '오늘 원가 조회 한도(200건)를 다 썼습니다 — 내일 다시 보세요.'
  if (/cost_price_invalid/.test(m)) return '제시가를 원/kg으로 0보다 크게 적으세요.'
  if (/cost_not_found|P0002/.test(m)) return '찾을 수 없거나 권한이 없습니다.'
  return '원가를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
}
