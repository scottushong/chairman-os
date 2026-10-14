import { periodStart } from '@/lib/sales/margins'
import type { ProductTrendGrain } from '@/types'

/**
 * 0081 기간 계산(순수). 날짜는 'YYYY-MM-DD'(시간대 없음 — UTC 자정으로 셈). 0081 product_trend의 generate_series(date_trunc …, step)와 같다.
 */

const DAY = 86_400_000

const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`)
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function addDaysIso(d: string, n: number): string {
  return toIso(toMs(d) + n * DAY)
}

/** 달을 n만큼 옮긴 같은 날(1일 기준 쓰기). */
export function addMonthsIso(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number)
  return toIso(Date.UTC(y, m - 1 + n, day))
}

export const TREND_GRAINS: readonly ProductTrendGrain[] = ['day', 'week', 'month', 'quarter', 'year']
export const TREND_GRAIN_KO: Record<ProductTrendGrain, string> = { day: '일', week: '주', month: '월', quarter: '분기', year: '년' }

/** 묶음 하나 뒤 첫날. */
export function nextPeriod(start: string, grain: ProductTrendGrain): string {
  if (grain === 'day') return addDaysIso(start, 1)
  if (grain === 'week') return addDaysIso(start, 7)
  if (grain === 'month') return addMonthsIso(start, 1)
  if (grain === 'quarter') return addMonthsIso(start, 3)
  return addMonthsIso(start, 12)
}

/** 묶음 끝 날(포함). */
export function periodEnd(start: string, grain: ProductTrendGrain): string {
  return addDaysIso(nextPeriod(start, grain), -1)
}

/** from ~ to를 덮는 묶음 첫날들(최대 limit개 — 넘으면 null). */
export function periodStarts(grain: ProductTrendGrain, from: string, to: string, limit = 400): string[] | null {
  const out: string[] = []
  for (let s = periodStart(from, grain); s <= to; s = nextPeriod(s, grain)) {
    out.push(s)
    if (out.length > limit) return null
  }
  return out
}

/** 추이 화면 기본 기간 — 묶음마다 보기 좋은 길이(일 60 · 주 26주 · 월 12달 · 분기 8 · 년 5). */
export function trendRange(grain: ProductTrendGrain, today: string): { from: string; to: string } {
  const from =
    grain === 'day' ? addDaysIso(today, -59) : grain === 'week' ? addDaysIso(today, -7 * 25) : grain === 'month' ? addMonthsIso(today, -11) : grain === 'quarter' ? addMonthsIso(today, -21) : addMonthsIso(today, -48)
  return { from: periodStart(from, grain), to: today }
}

/** 지난달 1일 ~ 말일(A) · 이번 달 1일 ~ 오늘(B) — 대시보드 · 진단 카드 10과 같은 두 기간. */
export function monthPair(today: string): { fromA: string; toA: string; fromB: string; toB: string } {
  const fromB = `${today.slice(0, 7)}-01`
  const fromA = addMonthsIso(fromB, -1)
  return { fromA, toA: addDaysIso(fromB, -1), fromB, toB: today }
}

/** 화면 기본 기간 — 오늘까지 최근 n일. */
export function lastDays(today: string, n: number): { from: string; to: string } {
  return { from: addDaysIso(today, -(n - 1)), to: today }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** 검색어의 날짜 둘을 고른다 — 틀리거나 뒤집히거나 1100일 넘으면 기본값. */
export function pickRange(from: string | undefined, to: string | undefined, fallback: { from: string; to: string }): { from: string; to: string } {
  if (!from || !to || !ISO.test(from) || !ISO.test(to) || from > to || toMs(to) - toMs(from) > 1100 * DAY) return fallback
  return { from, to }
}
