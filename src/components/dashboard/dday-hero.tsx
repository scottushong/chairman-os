import Link from 'next/link'

import { GlassCard } from '@/components/ui/glass-card'
import { Icon } from '@/components/ui/icon'
import { kstToday, orderProjects, projectClock } from '@/lib/chairman-project'
import type { ChairmanProject } from '@/types'

/**
 * 대시보드 히어로 좌측 400px (P5-2 Step 2).
 *
 * ChairmanDdayCard(인사말 옆 알약 한 줄)와 같은 데이터 — 진행 중인 장기 프로젝트 중
 * 목표일이 가장 가까운 한 건, projectClock()로 계산한 D-day·경과율 — 를 훨씬 크게 보여 준다.
 * 데이터를 새로 읽지 않는다(요구사항: 데이터 흐름 불변). ChairmanDdayCard는 손대지 않는다 —
 * '인사말 옆 알약'과 '히어로 큰 카드'는 같은 데이터의 다른 크기일 뿐, 서로 대체하지 않는다.
 *
 * 배경은 --color-dday-from/via/to 골드 그라데이션(밝다)이라 글자는 전부 어두운 text-ink만
 * 쓴다. text-ink-dim(#4a3f34)은 가장 어두운 정지점(#cf6d3d)에서 2.88:1로 AA 미달이라
 * 여기서는 쓰지 않는다(P5-2 보고서 항목 C, 다섯 자리 전부 text-ink로 통일).
 *
 * GlassCard의 배경(.glass)은 레이어 밖 규칙이라 className의 bg-*로는 못 덮는다.
 * 인라인 style로 그라데이션을 얹는다 — 인라인 스타일은 무조건 이긴다.
 */
export function DdayHero({ projects }: { projects: ChairmanProject[] }) {
  const project = orderProjects(projects).find((p) => p.status === 'Active')

  if (!project) {
    return (
      <GlassCard
        as="article"
        className="flex h-full min-h-[220px] flex-col items-center justify-center text-center"
      >
        <Icon name="target" className="size-6 text-ink-muted" />
        <p className="mt-2 text-[13px] text-ink-muted">진행 중인 장기 프로젝트가 없습니다.</p>
      </GlassCard>
    )
  }

  const clock = projectClock(project, kstToday())

  return (
    <GlassCard
      as="article"
      tone="accent"
      className="flex h-full min-h-[220px] flex-col justify-between overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, var(--color-dday-from), var(--color-dday-via), var(--color-dday-to))',
      }}
    >
      <Link href="/ai" className="group block">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <Icon name="target" className="size-3.5" />
          장기 프로젝트
          <Icon
            name="chevron-right"
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
          />
        </p>
        <p className="mt-1 truncate text-[15px] font-semibold text-ink" title={project.title}>
          {project.title}
        </p>

        {/* 큰 D-day 숫자. 명조는 전역 기본 폰트(--font-sans)라 별도 클래스가 필요 없다. */}
        <p className="mt-2 text-[56px] leading-none font-bold text-ink tnum">{clock.label}</p>
        <p className="mt-1.5 text-[12px] text-ink tnum">
          {clock.elapsed}/{clock.total}일 경과 · {clock.pct}%
        </p>
      </Link>

      <div className="mt-4">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clock.pct}
          aria-label={`${project.title} 경과율`}
          className="h-2 overflow-hidden rounded-full bg-ink/15"
        >
          <div className="h-full rounded-full bg-ink/70" style={{ width: `${clock.pct}%` }} />
        </div>

        {project.this_month_action ? (
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink">
            <span className="font-semibold">이번 달 행동 · </span>
            {project.this_month_action}
          </p>
        ) : null}
      </div>
    </GlassCard>
  )
}
