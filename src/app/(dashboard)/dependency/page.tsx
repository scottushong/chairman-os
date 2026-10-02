import Link from 'next/link'

import { AutonomyGauge, CompanyLink, Missing, Percent, Section } from '@/components/dependency/pieces'
import { Icon } from '@/components/ui/icon'
import { Sparkline } from '@/components/ui/sparkline'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import {
  averageAutonomy,
  BACKFILL_UNREACHED_KO,
  DEPENDENCY_TARGET,
  recentPeriods,
  summarizeDependency,
} from '@/lib/dependency'
import { getRepository } from '@/lib/repository'
import { PageHeader } from '@/components/layout/page-header'
import { TRANSFER_STATUS_LABEL_KO, type AutonomyLevel } from '@/types'

/**
 * /dependency — 그룹 요약 (Phase 7 블록 A · §7 · §11 · §12).
 *
 * ■ 이 화면이 답하는 질문 ■ "내가 없으면 이 회사들이 얼마나 돌아가는가."
 * 그래서 회사마다 다섯 칸이다: 의존도 · 자율성 · 이번 달 개입 · 다음 이양 · 다음 부재 테스트.
 *
 * ■ 이 화면이 하지 않는 것 ■ **빈 칸을 그럴듯한 숫자로 채우지 않는다.**
 * 처리된 결정이 없으면 0%가 아니라 '아직 계산할 수 없습니다'다. 평가가 없으면 L1이
 * 아니라 '아직 평가 없음'이다. 개입 기록이 안 보이면 0건이 아니라 '권한 밖이라
 * 집계되지 않습니다'다 — **없는 것과 못 보는 것은 다른 사실이다.**
 * 0034가 개입을 Chairman·GroupCFO·자기 회사 CEO에게 열었지만, 그 밖의 역할에게는
 * 여전히 0행이고 그들에게 '0건'이라고 말하지 않는 규율은 그대로다.
 *
 * ■ 색(문서 §32) ■ 색이 붙는 자리는 목표(10%)를 넘은 수치뿐이다. 스파크라인도 죽인 색이다.
 * 그래프는 회사당 한 줄, 축도 눈금도 없다 — "Too many graphs"가 §32의 금지 목록에 있다.
 */
export default async function DependencyPage() {
  await recordScreenRead({ path: '/dependency', kind: 'page' })

  const [user, repo] = await Promise.all([currentUser(), getRepository()])
  const [businesses, dependency, interventions, areas, autonomy, tests] = await Promise.all([
    repo.listBusinesses(),
    repo.listFounderDependency(),
    repo.listInterventions(),
    repo.listDependencyAreas(),
    repo.listAutonomyAssessments(),
    repo.listAbsenceTests(),
  ])

  const visible = businesses.filter((b) => b.visible)
  const rows = summarizeDependency({
    businessIds: visible.map((b) => b.business_id),
    dependency,
    interventions,
    areas,
    autonomy,
    tests,
  })
  const nameOf = new Map(visible.map((b) => [b.business_id, b.name]))
  const months = recentPeriods(12)
  const thisMonth = months[months.length - 1]

  /**
   * 개입 기록은 **Chairman·GroupCFO와 그 회사의 CEO**에게 나온다(0034 4절의
   * `intervention_counts_read` = `can_read_succession()`). 0033에서는 회장 전용이었는데,
   * 그것은 `audit_log`의 FORCE RLS가 만든 제약이지 원문이 아니었다 — 0034가 감사 기록을
   * 넓히는 대신 집계 전용 표를 두어 원문의 가시성을 준다.
   *
   * 그래도 **Executive·TeamLead·Member에게는 여전히 0행**이다. 그들에게 0건을 '0'으로
   * 그리면 안 되고, 그 판정을 화면이 역할로 한다 — DB가 0행을 주는 이유를 화면이 알아야
   * 그 자리에 다른 문장을 쓸 수 있다. (CEO는 자기 회사만 보지만, 그 사람의 목록에는
   * 애초에 자기 회사만 들어 있다 — 승계 표 넷이 같은 판정으로 걸러져 온다.)
   */
  // 세는 규칙(/dependency/settings)은 회장 화면이다 — 다른 역할에게는 링크를 그리지 않는다.
  const canSeeRules = user?.role === 'Chairman'

  const canSeeInterventions =
    user?.role === 'Chairman' || user?.role === 'GroupCFO' || user?.role === 'BusinessCEO'

  // §9 GROUP KPI. 평가가 있는 회사만으로 낸다 — 없는 회사를 L1로 세면 평균이 내려간다.
  const levels = rows.map((r) => r.autonomy?.level).filter((l): l is AutonomyLevel => Boolean(l))
  const avg = averageAutonomy(levels)
  const assessed = levels.length
  const measured = rows.filter((r) => r.current !== null)
  const unknownTotal = rows.reduce((a, r) => a + r.unknown, 0)

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="shield"
        title="의존"
        code="§7 Founder Dependency"
        description="회장님 없이 각 회사가 얼마나 돌아가는지를 셉니다. 회사를 누르면 그 회사의 이양 계획과 Direction이 열립니다."
      >
        {canSeeRules ? (
          <Link
            href="/dependency/settings"
            className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            세는 규칙
          </Link>
        ) : null}
      </PageHeader>

      {/* ───────── 그룹 한 줄 ───────── */}
      <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="측정된 회사"
          value={`${measured.length} / ${rows.length}`}
          note={
            measured.length === rows.length
              ? '모든 회사에 처리된 결정이 있습니다.'
              : '나머지 회사는 처리된 결정이 아직 없어 계산할 수 없습니다.'
          }
        />
        <Tile
          label="평균 자율성 (§9)"
          value={avg === null ? '—' : `L${avg}`}
          note={
            assessed === 0
              ? '아직 평가된 회사가 없습니다.'
              : `평가된 ${assessed}개사만으로 낸 값입니다. 평가가 없는 회사는 세지 않았습니다.`
          }
        />
        <Tile
          label="역산 미도달"
          value={`${unknownTotal}건`}
          note={
            unknownTotal === 0
              ? '최근 12개월에는 역산이 닿지 않은 결정이 없습니다.'
              : '이 건수는 분자에도 분모에도 들어가지 않았습니다.'
          }
        />
      </section>

      {unknownTotal > 0 ? (
        <p className="mt-2 rounded-lg bg-raised px-3 py-2 text-t11 leading-relaxed text-ink-dim">
          {BACKFILL_UNREACHED_KO}
          {canSeeRules ? (
            <>
              {' '}
              <Link href="/dependency/settings" className="underline underline-offset-2">
                역산 규칙 보기
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {/* ───────── 회사별 ───────── */}
      <Section icon="building" title="회사별" note={`최근 12개월 · 목표 ${DEPENDENCY_TARGET}% 미만`}>
        {rows.length === 0 ? (
          <Missing>볼 수 있는 회사가 없습니다.</Missing>
        ) : (
          <div className="overflow-x-auto">
            {/* 폰(640px 이하): 일곱 칸을 옆으로 미는 대신 회사 하나를 카드 하나로 세운다(m-cards).
                여러 줄짜리 칸은 div로 한 덩어리로 묶었다 — 카드의 칸은 가로 flex라 안 묶으면 옆으로 흩어진다. */}
            <table className="m-cards w-full border-collapse text-t11h sm:min-w-[880px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-t10h text-ink-dim">
                  <th className="py-1.5 pr-3 font-normal">회사</th>
                  <th className="py-1.5 pr-3 font-normal">의존도</th>
                  <th className="py-1.5 pr-3 font-normal">12개월</th>
                  <th className="py-1.5 pr-3 font-normal">자율성</th>
                  <th className="py-1.5 pr-3 font-normal">이번 달 개입</th>
                  <th className="py-1.5 pr-3 font-normal">다음 이양</th>
                  <th className="py-1.5 font-normal">다음 부재 테스트</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const spark = r.spark.filter((v): v is number => v !== null)
                  return (
                    <tr key={r.business_id} className="border-b border-line-soft last:border-0 align-top">
                      <td className="py-2 pr-3">
                        <CompanyLink id={r.business_id} name={nameOf.get(r.business_id) ?? r.business_id} />
                      </td>
                      <td className="py-2 pr-3" data-label="의존도">
                        <div>
                          {r.current === null ? (
                            <span className="text-t10h text-ink-muted">
                              아직 계산할 수 없습니다
                              <br />
                              (처리된 결정 0건)
                            </span>
                          ) : (
                            <>
                              <Percent value={r.current} />
                              <span className="ml-1 text-t10 text-ink-muted tnum">{r.currentPeriod}</span>
                              {r.unknown > 0 ? (
                                <span className="block text-t10 text-ink-muted">
                                  역산 미도달 {r.unknown}건 제외
                                </span>
                              ) : null}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="w-[140px] py-2 pr-3" data-label="12개월">
                        {/* §32: 그래프를 많이 넣지 않는다. 회사당 한 줄, 축도 눈금도 없다. */}
                        {spark.length >= 2 ? (
                          <Sparkline data={spark} className="h-[22px] w-[120px]" />
                        ) : (
                          <span className="text-t10 text-ink-muted">
                            표시할 달이 부족합니다 ({spark.length}개월)
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3" data-label="자율성">
                        <AutonomyGauge level={r.autonomy?.level ?? null} />
                      </td>
                      <td className="py-2 pr-3 tnum" data-label="이번 달 개입">
                        <div>
                          {canSeeInterventions ? (
                            <>
                              {r.interventions}건
                              <span className="ml-1 text-t10 text-ink-muted">{thisMonth}</span>
                            </>
                          ) : (
                            <span className="text-t10h text-ink-muted">권한 밖이라 집계되지 않습니다</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3" data-label="다음 이양">
                        <div>
                          {r.nextTransfer ? (
                            <>
                              <span className="text-ink">{r.nextTransfer.area}</span>
                              <span className="block text-t10 text-ink-muted">
                                {TRANSFER_STATUS_LABEL_KO[r.nextTransfer.transfer_status ?? 'not_started']}
                                {r.nextTransfer.target_date ? ` · ${r.nextTransfer.target_date}` : ' · 목표일 없음'}
                              </span>
                            </>
                          ) : (
                            <span className="text-t10h text-ink-muted">이양 계획 없음</span>
                          )}
                          {r.transfer ? (
                            <span className="block text-t10 text-ink-muted tnum">
                              이양 {r.transfer.done}/{r.transfer.planned}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2" data-label="다음 부재 테스트">
                        <div>
                          {r.nextAbsence ? (
                            <>
                              <span className="text-ink tnum">{r.nextAbsence.days}일</span>
                              <span className="block text-t10 text-ink-muted tnum">
                                {r.nextAbsence.scheduled_on} 시작 예정
                              </span>
                            </>
                          ) : (
                            <span className="text-t10h text-ink-muted">예정된 테스트 없음</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p className="mt-3 text-t10 leading-relaxed text-ink-muted">
        이 값은 회사의 값입니다. 같은 회사·같은 달이면 어느 계정에서 보아도 같은 수치입니다 —
        집계는 회사 전체의 결정으로 하고, 계정에 따라 달라지는 것은 «어느 회사가 목록에
        보이는가»뿐입니다.
      </p>

      <div className="pb-6" />
    </div>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-line-soft bg-panel p-3.5">
      <p className="flex items-center gap-1.5 text-t11 text-ink-dim">
        <Icon name="target" className="size-3.5" />
        {label}
      </p>
      <p className="mt-1 text-t22 font-bold leading-none text-ink tnum">{value}</p>
      <p className="mt-1.5 text-t10h leading-relaxed text-ink-muted">{note}</p>
    </div>
  )
}
