import Link from 'next/link'

import { initiativeClock } from '@/lib/initiative'
import type { Initiative, IsoDate } from '@/types'

/**
 * 대시보드 인사말 옆의 이니셔티브 한 줄 (Task 9). `ChairmanDdayCard`(장기 프로젝트 한 건)의
 * 형제다 — 저건 '가장 가까운 것 한 건', 이건 '전체 센 수'라 성격이 다르다. 누르면 /initiatives.
 *
 * 0개면 그리지 않는다(빈 칸은 인사말 줄만 길게 만든다). 역할을 여기서 보지 않는다 —
 * RLS가 0행을 주는 역할에게는 이 경로로 자연히 사라진다.
 *
 * 색은 지난 행동(overdue)의 수에만 오른다. 종류·단계 등 나머지는 색 없음.
 */
export function InitiativeStat({ initiatives, today }: { initiatives: Initiative[]; today: IsoDate }) {
  const active = initiatives.filter((i) => i.status === 'Active')
  if (active.length === 0) return null

  const clocks = active.map((i) => initiativeClock(i, today)).filter((c) => c !== null)
  const thisWeekCount = clocks.filter((c) => c.days <= 7).length
  const overdueCount = clocks.filter((c) => c.overdue).length

  return (
    <Link
      href="/initiatives"
      className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] transition-colors hover:border-accent"
    >
      <span className="text-ink-dim">
        이니셔티브 <span className="font-semibold text-ink tnum">{active.length}</span>개 · 이번 주 행동{' '}
        <span className="font-semibold text-ink tnum">{thisWeekCount}</span>개
      </span>
      {overdueCount > 0 ? (
        <>
          <span className="text-ink-muted">·</span>
          <span className="font-semibold text-critical tnum">지난 행동 {overdueCount}개</span>
        </>
      ) : null}
    </Link>
  )
}
