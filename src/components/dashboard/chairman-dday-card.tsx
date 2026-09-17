import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { kstToday, orderProjects, projectClock } from '@/lib/chairman-project'
import type { ChairmanProject } from '@/types'

/**
 * 대시보드 인사말 옆의 D-day 한 장 (Phase 3-B). 누르면 /ai 아침 루틴으로 간다.
 *
 * 진행 중인 장기 프로젝트 중 목표일이 가장 가까운 한 건만 보인다. 여러 장을 여기 늘어놓으면
 * 인사말 줄이 카드 줄이 된다 — 전부 보는 자리는 /ai다.
 * 0014 RLS가 Chairman 외에는 0행을 주므로 다른 역할에게는 이 카드가 없다.
 */
export function ChairmanDdayCard({ projects }: { projects: ChairmanProject[] }) {
  const project = orderProjects(projects).find((p) => p.status === 'Active')
  if (!project) return null
  const clock = projectClock(project, kstToday())

  return (
    <Link
      href="/ai"
      title={`${clock.elapsed}/${clock.total}일 (${clock.pct}%) — 아침 루틴 열기`}
      className="group flex items-center gap-2 rounded-lg border border-accent/40 bg-panel px-3 py-1.5 text-[13px] transition-colors hover:border-accent"
    >
      <Icon name="target" className="size-4 text-accent" />
      <span className="font-bold text-accent tnum">{clock.label}</span>
      <span className="text-ink-muted">·</span>
      <span className="font-semibold text-ink">{project.title}</span>
      <Icon name="chevron-right" className="size-3.5 text-ink-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
