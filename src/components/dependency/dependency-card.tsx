import Link from 'next/link'

import { AutonomyGauge, CompanyLink, Percent } from '@/components/dependency/pieces'
import { Icon } from '@/components/ui/icon'
import { Sparkline } from '@/components/ui/sparkline'
import { DEPENDENCY_TARGET, type DependencySummary } from '@/lib/dependency'
import type { Business } from '@/types'

/**
 * 대시보드 «의존도» 카드 (블록 A · §7). 이니셔티브와 프로세스차트 사이, 전폭.
 *
 * ■ 여기 있는 이유 ■ 회장이 하루에 처음 여는 화면에서 "내가 없으면 얼마나 도나"가
 * 한 줄로 보여야 한다. 그 질문이 메뉴 안쪽에만 있으면 분기에 한 번 보게 되고,
 * 분기에 한 번 보는 숫자는 바뀌지 않는다.
 *
 * ■ 여기서 재계산하지 않는다 ■ 값은 /dependency와 **같은 summarizeDependency()**에서 온다.
 * 두 화면이 각자 접으면 같은 회사가 두 숫자를 갖게 되고, 회장은 둘 다 안 믿게 된다.
 *
 * ■ 빈 칸 ■ 측정 전인 회사는 '—'와 함께 «아직 계산할 수 없습니다»가 붙는다. 0%로 그리면
 * '의존이 없다'가 되어, 이 카드가 정확히 반대의 것을 말하게 된다.
 */
export function DependencyCard({
  rows,
  businesses,
  canSeeInterventions,
}: {
  rows: DependencySummary[]
  businesses: Business[]
  /** 개입 건수를 볼 수 있는 세션인가. Chairman·GroupCFO·자기 회사 CEO다(0034 4절). */
  canSeeInterventions: boolean
}) {
  if (rows.length === 0) return null
  const nameOf = new Map(businesses.map((b) => [b.business_id, b.name]))
  const measured = rows.filter((r) => r.current !== null)
  const unknown = rows.reduce((a, r) => a + r.unknown, 0)

  return (
    <section aria-label="의존도">
      {/* 카드 밖(맨 배경) 위의 줄이라 ink-dim만 쓴다(globals.css '유리 없이 글자를 놓지 마라'). */}
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-t13 font-semibold">의존도</h2>
        <span className="text-t11 text-ink-dim tnum">
          {measured.length === 0
            ? '아직 계산할 수 없습니다'
            : `${measured.length}개사 측정 · 목표 ${DEPENDENCY_TARGET}% 미만`}
        </span>
        <Link
          href="/dependency"
          className="ml-auto text-t11h text-ink-dim underline-offset-2 hover:text-ink hover:underline"
        >
          전체 보기
        </Link>
      </div>

      <div className="glass rounded-glass border border-line-soft p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {rows.map((r) => {
            const spark = r.spark.filter((v): v is number => v !== null)
            return (
              <div key={r.business_id} className="rounded-lg bg-raised px-3 py-2.5">
                <p className="text-t11h">
                  <CompanyLink id={r.business_id} name={nameOf.get(r.business_id) ?? r.business_id} />
                </p>
                <p className="mt-1 text-t18 font-bold leading-none tnum">
                  {r.current === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    <Percent value={r.current} />
                  )}
                </p>
                {r.current === null ? (
                  <p className="mt-1 text-t10 leading-relaxed text-ink-muted">
                    아직 계산할 수 없습니다 (처리된 결정 0건)
                  </p>
                ) : (
                  <>
                    {spark.length >= 2 ? (
                      <Sparkline data={spark} className="mt-1 h-[20px] w-full" />
                    ) : (
                      <p className="mt-1 text-t10 text-ink-muted">표시할 달이 부족합니다</p>
                    )}
                    <p className="mt-1 text-t10 text-ink-muted tnum">
                      {canSeeInterventions ? (
                        <>이번 달 개입 {r.interventions}건</>
                      ) : (
                        '개입은 권한 밖이라 집계되지 않습니다'
                      )}
                    </p>
                  </>
                )}
                <div className="mt-1.5">
                  <AutonomyGauge level={r.autonomy?.level ?? null} />
                </div>
              </div>
            )
          })}
        </div>

        {unknown > 0 ? (
          <p className="mt-2 flex items-baseline gap-1.5 text-t10 leading-relaxed text-ink-muted">
            <Icon name="shield" className="size-3 shrink-0 translate-y-0.5" />
            역산이 닿지 않은 결정 {unknown}건은 분자에도 분모에도 넣지 않았습니다.{' '}
            <Link href="/dependency/settings" className="underline underline-offset-2">
              세는 규칙
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  )
}
