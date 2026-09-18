import Link from 'next/link'

import { initiativeClock, isStale, stalenessDays } from '@/lib/initiative'
import {
  INITIATIVE_KIND_LABEL_KO, INITIATIVE_STAGE, INITIATIVE_STAGE_LABEL_KO,
  type Business, type Initiative, type IsoDate,
} from '@/types'

/**
 * 단계별로 묶은 표. 한 줄에 '무엇을 / 어느 단계 / 다음에 뭘 언제 / 마지막으로 언제 손댔나'.
 *
 * 색은 둘뿐이다. 지난 다음 행동은 빨강, 14일 넘게 손 안 댄 건은 흐리게.
 * 나머지를 칠하면 어디가 급한지 안 보인다(요구사항서 2번).
 */
export function InitiativeTable({
  initiatives, businesses, today,
}: {
  initiatives: Initiative[]
  businesses: Business[]
  today: IsoDate
}) {
  if (initiatives.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-line bg-panel/60 p-6 text-center text-[12px] text-ink-muted">
        이 조건에 맞는 건이 없습니다.
      </p>
    )
  }
  const nameOf = new Map(businesses.map((b) => [b.business_id, b.name]))

  return (
    <div className="mt-4 space-y-6">
      {INITIATIVE_STAGE.filter((s) => initiatives.some((i) => i.stage === s)).map((stage) => (
        <section key={stage}>
          <h2 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
            {INITIATIVE_STAGE_LABEL_KO[stage]}
            <span className="text-[11px] font-normal text-ink-muted tnum">
              {initiatives.filter((i) => i.stage === stage).length}건
            </span>
          </h2>
          <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line-soft bg-panel">
            {initiatives.filter((i) => i.stage === stage).map((i) => {
              const clock = initiativeClock(i, today)
              const stale = isStale(i, today)
              return (
                <li key={i.initiative_id}>
                  <Link
                    href={`/initiatives/${i.initiative_id}`}
                    className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-[13px] transition-colors hover:bg-raised ${
                      stale ? 'opacity-55' : ''
                    }`}
                  >
                    <span className="font-semibold text-ink">{i.title}</span>
                    <span className="text-[11px] text-ink-muted">
                      {INITIATIVE_KIND_LABEL_KO[i.kind]}
                      {i.business_id ? ` · ${nameOf.get(i.business_id) ?? i.business_id}` : ''}
                    </span>
                    {i.next_action ? (
                      <span className="ml-auto flex items-baseline gap-2">
                        <span className="text-ink-dim">{i.next_action}</span>
                        {clock ? (
                          <span className={`tnum font-semibold ${clock.overdue ? 'text-critical' : 'text-ink'}`}>
                            {clock.label}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="ml-auto text-[11px] text-ink-muted">다음 행동 없음</span>
                    )}
                    {stale ? (
                      <span className="text-[11px] text-ink-muted tnum">{stalenessDays(i, today)}일째</span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
