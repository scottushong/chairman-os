import { kstToday } from '@/lib/chairman-project'
import type { Initiative, IsoDate } from '@/types'

/**
 * 이니셔티브의 시계. 0014 projectClock과 같은 원칙이다 — 저장하지 않고 늘 오늘로부터 계산한다.
 * today는 KST 날짜 문자열이다. 서버는 UTC라 new Date()의 로컬 날짜를 쓰면 09:00 KST 전에 하루 밀린다.
 */

const DAY = 86_400_000

function days(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
}

export interface ActionClock {
  /** 남은 날. 지났으면 음수. */
  days: number
  /** 'D-3' / 'D-DAY' / 'D+2' */
  label: string
  overdue: boolean
}

/** next_action_date가 없으면 null. 기한 없는 행동에 D-day를 붙이면 없는 약속이 생긴다. */
export function initiativeClock(
  i: Pick<Initiative, 'next_action_date'>,
  today: IsoDate = kstToday(),
): ActionClock | null {
  if (!i.next_action_date) return null
  const d = days(today, i.next_action_date)
  return {
    days: d,
    label: d === 0 ? 'D-DAY' : d > 0 ? `D-${d}` : `D+${-d}`,
    overdue: d < 0,
  }
}

/**
 * 마지막으로 손댄 뒤 지난 날.
 *
 * updated_at은 UTC timestamptz다. 여기서 문자열을 그냥 slice(0,10)하면 UTC 날짜가 나오는데
 * 비교 대상인 today는 KST 날짜다 — UTC 15:00~23:59(KST 자정~오전 9시)에 저장된 건이
 * 하루 더 오래된 것으로 잡힌다. 하루 차이가 isStale의 14일 경계를 넘긴다.
 * kstToday는 Date를 받아 Asia/Seoul 날짜로 찍어 주므로 그것을 그대로 쓴다 —
 * +9시간을 손으로 더하는 네 번째 방식을 만들지 않는다.
 */
export function stalenessDays(i: Pick<Initiative, 'updated_at'>, today: IsoDate = kstToday()): number {
  return days(kstToday(new Date(i.updated_at)), today)
}

/** 14일. 2주 넘게 아무도 손대지 않은 건은 굴러가고 있는 게 아니다. */
export const STALE_DAYS = 14

export function isStale(i: Pick<Initiative, 'updated_at' | 'status'>, today: IsoDate = kstToday()): boolean {
  return i.status === 'Active' && stalenessDays(i, today) >= STALE_DAYS
}

/**
 * 화면 순서: 진행 중이 위. 그 안에서 다음 행동이 급한 것부터.
 * 기한 없는 행동은 기한 있는 것들 뒤에 둔다 — 날짜가 있는 쪽이 먼저 답을 요구한다.
 */
export function orderInitiatives(list: Initiative[]): Initiative[] {
  const rank = { Active: 0, Done: 1, Dropped: 2 } as const
  return [...list].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      Number(a.next_action_date === null) - Number(b.next_action_date === null) ||
      (a.next_action_date ?? '').localeCompare(b.next_action_date ?? '') ||
      a.title.localeCompare(b.title, 'ko'),
  )
}
