/**
 * 원가 엔진 화면 표기 — kg는 0.001까지(작업지시 · 투입 · 잔량). 원/kg는 lib/sales/cost.ts krw()(1원)를 쓴다.
 * 표시값을 다시 계산에 쓰지 않는다(회장 결정 2026-10-09 밤 — 원래 값으로 계산, 1원으로 보여 준다).
 */
export function kg3(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const s = Math.abs(n).toLocaleString('ko-KR', { maximumFractionDigits: 3 })
  return n < 0 && s !== '0' ? `−${s}` : s
}

/** 원/월 같은 큰 금액 — 1원 · 쉼표. */
export function won0(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('ko-KR')
}

/** 원가 관리 · 영업이 같이 쓰는 한 줄(회장 결정 2026-10-09 밤). */
export const ROUNDING_NOTE = '원가는 원 단위 아래까지 계산한 뒤 1원으로 보여 줍니다 — 보이는 숫자끼리 더하면 1원 다를 수 있습니다.'

/** 비용 줄은 있는데 배부를 못 해 총원가를 계산하지 않은 줄(0065 리뷰 I1). */
export const ALLOC_PENDING_NOTE = '비용 배부 전(직전 28일 생산 · 계획 생산량 없음) — 원가 관리에서 배부 기준을 정하면 계산됩니다'

/** 'YYYY-MM-DD' + n일(달력). 화면의 «내일까지»(DB cost_date_future = 오늘 + 1) 같은 경계에 쓴다. */
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}
