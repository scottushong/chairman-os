import type { ChairmanProject, IsoDate } from '@/types'

/**
 * 장기 프로젝트의 D-day와 경과율. 저장하지 않고 늘 today로부터 계산한다(0014 머리 주석).
 *
 * today는 KST 날짜 문자열로 받는다. 서버(Vercel)는 UTC라 new Date()의 로컬 날짜를 쓰면
 * 09:00 KST 전에 하루 밀린 D-day가 뜬다. 날짜 문자열끼리 UTC 자정으로 빼서 시간대를 없앤다.
 */

const DAY = 86_400_000

function days(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
}

/** 'YYYY-MM-DD' (KST). 화면·야간 Job이 같은 '오늘'을 쓰게 한 곳에 둔다. */
export function kstToday(now = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
}

export interface ProjectClock {
  /** 목표일까지 남은 날. 지나면 음수. */
  remaining: number
  /** 시작일부터 지난 날. 0 ~ total로 자른다. */
  elapsed: number
  total: number
  /** 0 ~ 100, 정수 */
  pct: number
  /** 'D-780' / 'D-DAY' / 'D+3' */
  label: string
}

export function projectClock(p: Pick<ChairmanProject, 'start_date' | 'target_date'>, today: IsoDate): ProjectClock {
  const total = Math.max(1, days(p.start_date, p.target_date))
  const remaining = days(today, p.target_date)
  const elapsed = Math.min(total, Math.max(0, days(p.start_date, today)))
  const pct = Math.round((elapsed / total) * 100)
  const label = remaining === 0 ? 'D-DAY' : remaining > 0 ? `D-${remaining}` : `D+${-remaining}`
  return { remaining, elapsed, total, pct, label }
}

/** 화면 순서: 진행 중이 위, 그 안에서 목표일이 가까운 것부터. */
export function orderProjects(projects: ChairmanProject[]): ChairmanProject[] {
  const rank = { Active: 0, Done: 1, Dropped: 2 } as const
  return [...projects].sort(
    (a, b) => rank[a.status] - rank[b.status] || a.target_date.localeCompare(b.target_date),
  )
}
