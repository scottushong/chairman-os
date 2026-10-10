import type { CostGrade, IsoDate, PriceCheck, SalesOffer } from '@/types'

/**
 * 영업 원가 화면의 순수 함수(브라우저 · 서버 · dummy · 검사가 같이 쓴다). 식은 0062 그대로 옮겨 적은 것이다 —
 *   회장 결정(2026-10-09 밤) «반올림 없이 1원까지»: 계산은 원래 값(소수)으로 끝까지 하고, 나가는 칸만 1원
 *   (Postgres round(x, 0) = 0.5는 0에서 먼 쪽). 대표에게는 DB가 원래 값을 주고 화면(krw)이 1원으로 그린다.
 *   **1원으로 만든 값끼리 더하거나 빼지 않는다** — 원가 우위 · 총원가 · 제시가 · 마진은 모두 원래 값에서.
 *   마진 % = (판매가 − 원래 총원가) ÷ 판매가 × 100, 표시는 0.1%p. 등급은 반올림 전 %로(14.96%는 Red).
 *   등급 = 20% 이상 green · 15% 이상 yellow · 그 밑 red(cost_grade)
 *   목표 마진별 제시가 = 원래 총원가 ÷ (1 − 마진) → 1원, 15 · 20 · 25 · 30%
 * 원료는 여기 없다 — 받는 것도 돌려주는 것도 제품 총액뿐이다.
 */

/** Postgres round(numeric, digits)와 같은 반올림 — 0.5는 0에서 먼 쪽으로. digits = 0이면 1원 단위. */
export function pgRound(x: number, digits: number): number {
  const f = 10 ** digits
  // 부동소수 오차(1.005 × 100 = 100.49999…)를 먼저 걷는다.
  const scaled = Number((Math.abs(x) * f).toPrecision(12))
  return (Math.sign(x) * Math.round(scaled)) / f || 0
}

/** 1원(회장 결정 2026-10-09 밤 — 10원 반올림은 없앴다). */
export const round1 = (x: number) => pgRound(x, 0)

/** 나가는 값: 대표(raw) = 원래 값, 대표 외 = 1원. 0062 cost_secret.shown. */
export const shown = (x: number | null, raw: boolean): number | null => (x === null ? null : raw ? x : round1(x))

export function costGrade(marginPct: number | null): CostGrade | null {
  if (marginPct === null || !Number.isFinite(marginPct)) return null
  return marginPct >= 20 ? 'green' : marginPct >= 15 ? 'yellow' : 'red'
}

export const TARGET_MARGINS = [15, 20, 25, 30] as const

/** 목표 마진별 제시가 — 원래 총원가로 나눈 뒤 1원(raw면 원래 값 그대로). */
export function salesOffers(totalRaw: number | null, raw = false): SalesOffer[] {
  if (totalRaw === null) return []
  return TARGET_MARGINS.map((m) => ({ margin_pct: m, price_krw_per_kg: shown(totalRaw / (1 - m / 100), raw)!, grade: costGrade(m)! }))
}

/** 0062 cost_price_check와 같은 답(원래 총원가로 계산). 값이 0 이하 · 10억 초과면 null(DB는 cost_price_invalid). */
export function priceCheck(totalRaw: number | null, price: number | null, raw = false): PriceCheck | null {
  if (price === null || !Number.isFinite(price) || price <= 0 || price > 1e9) return null
  if (totalRaw === null) return { total_krw_per_kg: null, margin_krw_per_kg: null, margin_pct: null, grade: null }
  const pct = ((price - totalRaw) / price) * 100
  return { total_krw_per_kg: shown(totalRaw, raw), margin_krw_per_kg: shown(price - totalRaw, raw), margin_pct: pgRound(pct, 1), grade: costGrade(pct) }
}

/** 원료비 영향(7일 전 → 오늘) — 원래 원료비 둘로(표시값끼리가 아니다). 7일 전이 없거나 0이면 null. */
export function materialImpactPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !(previous > 0)) return null
  return pgRound((current / previous - 1) * 100, 1)
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토']

export function weekdayKo(d: IsoDate): string {
  return WEEKDAY_KO[new Date(`${d}T00:00:00Z`).getUTCDay()]
}

/**
 * 기준 문구 — «2026-10-09(금) 기준 · 지금 저장된 값(매일 최신)». 회장 결정(2026-10-09 밤)으로 대표 외도 오늘 · 지금 저장된 값을 본다
 * (주 1회 월요일 0시 스냅샷은 없앴다). 원료 · 시세 · BOM 변경이 바로 비친다.
 */
export function asOfLabel(asOf: IsoDate, immediate = true): string {
  // 회장 결정(2026-10-10) (가) — 영업은 오늘 0시(KST)까지 저장된 값, 원가 관리 · 대표는 즉시.
  return immediate
    ? `${asOf}(${weekdayKo(asOf)}) 기준 · 지금 저장된 값`
    : `${asOf}(${weekdayKo(asOf)}) · 오늘 0시 기준 원가(오늘 저장한 값은 내일 반영)`
}

/** «원료비 영향 +4.2%» · 값이 없으면 null(화면이 줄을 그리지 않는다). */
export function impactText(pct: number | null): string | null {
  if (pct === null) return null
  return `원료비 영향 ${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct).toFixed(1)}%`
}

/** 원/kg 표기 — 1원 · 쉼표(대표가 받는 원래 값도 여기서 1원으로). 음수는 «−». 표시값을 다시 계산에 쓰지 않는다. */
export function krw(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  const r = round1(n)
  const s = Math.abs(r).toLocaleString('ko-KR')
  return r < 0 ? `−${s}` : s
}

export const GRADE_LABEL: Record<CostGrade, string> = { green: 'Green', yellow: 'Yellow', red: 'Red' }

/** 등급 뱃지 색(Green/Yellow/Red). 토큰 이름은 globals.css(ok · warning · critical). */
export const GRADE_CLASS: Record<CostGrade, string> = {
  green: 'border-ok/40 bg-ok/15 text-ok',
  yellow: 'border-warning/40 bg-warning/15 text-warning',
  red: 'border-critical/40 bg-critical/15 text-critical',
}

/** Red일 때 화면 문구(승인 요청 연결은 견적 블록). 호칭은 «대표». */
export const RED_NOTICE = 'Red — 대표 승인이 필요합니다. 승인 요청(결재)은 가격 엔진(견적) 블록에서 열립니다.'

/**
 * 영업 원가 함수의 DB 거부 → 사람의 말(0062 이유 코드). 호칭은 «대표»(직원 화면).
 */
export function salesCostError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (/cost_role_conflict/.test(m)) return '구매 · 생산 권한과 영업 원가는 같이 볼 수 없습니다 — 대표에게 권한 정리를 요청하세요.'
  if (/cost_rate_limited/.test(m)) return '오늘 조회 한도에 걸렸습니다 — 대표에게 문의하세요.'
  if (/cost_price_invalid/.test(m)) return '제시가를 1원 단위(원/kg)로 0보다 크게 적으세요.'
  if (/cost_not_found|P0002/.test(m)) return '찾을 수 없거나 권한이 없습니다.'
  return '원가를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
}
