import type { IsoDate } from '@/types'

/**
 * 월 격자와 2주 범위. 달력은 늘 월요일에 시작한다(한국 업무 달력).
 * 날짜는 문자열로만 다룬다 — Date 객체를 돌리면 서버(UTC)와 화면(KST)이 다른 날을 가리킨다.
 */

const DAY = 86_400_000

function shift(date: IsoDate, by: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + by * DAY).toISOString().slice(0, 10) as IsoDate
}

/** 0=월 … 6=일 */
function weekdayMon(date: IsoDate): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

/** 'YYYY-MM' → 6주 × 7일. 앞뒤 달이 섞여 들어온다(회색으로 그린다). */
export function monthGrid(month: string): IsoDate[][] {
  const first = `${month}-01` as IsoDate
  const start = shift(first, -weekdayMon(first))
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => shift(start, w * 7 + d)),
  )
}

/** 오늘부터 14일. 달력 옆의 목록이 쓰는 범위다. */
export function twoWeekRange(today: IsoDate): { from: IsoDate; to: IsoDate } {
  return { from: today, to: shift(today, 13) }
}

/** 'YYYY-MM' 이 아니면 null. 주소창에서 오는 값이라 믿지 않는다. */
export function parseMonth(raw: unknown): string | null {
  return typeof raw === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : null
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}
