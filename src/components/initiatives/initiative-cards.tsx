import Link from 'next/link'

import { InitiativeLogo } from '@/components/initiatives/initiative-logo'
import { GlassCard } from '@/components/ui/glass-card'
import { initiativeClock, isStale, stalenessDays } from '@/lib/initiative'
import {
  INITIATIVE_KIND_LABEL_KO, INITIATIVE_STAGE_LABEL_KO,
  type Business, type Initiative, type IsoDate,
} from '@/types'

/**
 * 카드 그리드 (Step 3). `InitiativeTable`을 대신한다 — 표에는 로고가 앉을 행 높이가 없다.
 * 대시보드 좌측 요약(item B)과 `/initiatives` 전체 그리드가 이 컴포넌트 하나를 같이 쓴다.
 *
 * 색 규칙은 InitiativeTable과 같다: 지난 다음 행동만 빨강, 14일 넘게 손 안 댄 건은 흐리게.
 * 다만 흐리는 범위는 표보다 좁다 — **제목·메타·goal만**(Step 3 명세). D-day 칩과 갱신 일수
 * 자체는 늘 100% 밝기다. 카드 전체에 opacity를 걸면 하필 가장 급한 카드에서 빨간 D-day가
 * 꺼진다 — 이 프로젝트가 세 번 반복한 실수(InitiativeTable 주석 참고).
 *
 * 단계 뱃지는 색이 없다(요구사항서 2번) — 단계는 위험이 아니다.
 */
export function InitiativeCards({
  initiatives, businesses, logoUrls, today, hasAny,
}: {
  initiatives: Initiative[]
  businesses: Business[]
  /** signInitiativeLogos(paths)가 보이는 카드 전부를 한 번에 서명해 준 맵. 카드마다 부르지 않는다. */
  logoUrls: Record<string, string>
  today: IsoDate
  /** 필터 없이도 이니셔티브가 하나도 없는가. 빈 화면이 '조건에 안 맞음'인지 '아직 없음'인지 갈라야 한다. */
  hasAny: boolean
}) {
  if (initiatives.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-line bg-panel p-6 text-center text-[12px] text-ink-muted">
        {hasAny ? '이 조건에 맞는 건이 없습니다.' : '아직 등록된 이니셔티브가 없습니다. 위에서 새 건을 만들어 보세요.'}
      </p>
    )
  }

  const nameOf = new Map(businesses.map((b) => [b.business_id, b.name]))

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {initiatives.map((i) => {
        const clock = initiativeClock(i, today)
        const stale = isStale(i, today)
        const dim = stale ? 'opacity-55' : ''
        return (
          <GlassCard key={i.initiative_id} as="article" padding="p-4">
            <Link href={`/initiatives/${i.initiative_id}`} className="flex h-full flex-col gap-2.5">
              <div className="flex items-center gap-2.5">
                <InitiativeLogo
                  title={i.title}
                  path={i.logo_url}
                  url={i.logo_url ? logoUrls[i.logo_url] : undefined}
                />
                <div className="min-w-0">
                  <p className={`truncate text-[13px] font-semibold text-ink ${dim}`}>{i.title}</p>
                  <p className={`truncate text-[11px] text-ink-muted ${dim}`}>
                    {INITIATIVE_KIND_LABEL_KO[i.kind]} · {INITIATIVE_STAGE_LABEL_KO[i.stage]}
                    {i.business_id ? ` · ${nameOf.get(i.business_id) ?? i.business_id}` : ''}
                  </p>
                </div>
              </div>

              <p className={`line-clamp-2 min-h-[2.75em] flex-1 text-[12px] leading-snug text-ink-dim ${dim}`}>
                {i.goal || '목표 없음'}
              </p>

              <div className="flex items-center justify-between gap-2 text-[11px]">
                {i.next_action ? (
                  <span className="truncate text-ink-dim">{i.next_action}</span>
                ) : (
                  <span className="text-ink-muted">다음 행동 없음</span>
                )}
                {clock ? (
                  <span className={`tnum shrink-0 font-semibold ${clock.overdue ? 'text-critical' : 'text-ink'}`}>
                    {clock.label}
                  </span>
                ) : null}
              </div>

              {stale ? (
                <span className="text-[10px] text-ink-muted tnum">{stalenessDays(i, today)}일째 갱신 없음</span>
              ) : null}
            </Link>
          </GlassCard>
        )
      })}
    </div>
  )
}
