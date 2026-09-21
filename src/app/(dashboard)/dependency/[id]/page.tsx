import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AbsenceEditor, AutonomyEditor } from '@/components/dependency/absence-editor'
import { AreaEditor } from '@/components/dependency/area-editor'
import { DirectionEditor } from '@/components/dependency/direction-editor'
import { AutonomyGauge, BigPercent, LevelChip, Missing, Section, TransferChip } from '@/components/dependency/pieces'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import {
  BACKFILL_UNREACHED_KO,
  bestAbsencePass,
  DEPENDENCY_LADDER,
  DEPENDENCY_TARGET,
  recentPeriods,
  rollUp,
  transferProgress,
} from '@/lib/dependency'
import { getRepository } from '@/lib/repository'
import {
  AUTONOMY_CRITERIA_KO,
  AUTONOMY_EMPTY_KO,
  INTERVENTION_LABEL_KO,
  type InterventionRow,
} from '@/types'

/**
 * /dependency/[id] — 회사 한 곳의 승계 화면 (§7 · §9 · §11 · §12 · §20 · §21 · §35).
 *
 * 문서 §35(DY SUCCESSION SCREEN)가 이 화면의 시안이다. 순서도 그것을 따른다:
 * 큰 숫자 → 이양된 것/진행 중/안 된 것 → 다음 90일.
 *
 * ■ 이 화면이 절대 하지 않는 것 ■
 *   · 처리된 결정이 없을 때 0%를 그리지 않는다 — '아직 계산할 수 없습니다'다.
 *   · 평가가 없을 때 L1을 칠하지 않는다 — 게이지가 비고 '아직 평가 없음'이다.
 *   · 개입이 안 보일 때 0건이라고 하지 않는다 — '권한 밖이라 집계되지 않습니다'다.
 *   · 이양 계획이 없는 영역을 '미이양'이라고 하지 않는다 — 계획이 없는 것은 다른 사실이다.
 *
 * ■ 목표 로드맵의 37 ■ 문서 §35의 **예시 화면 숫자**이지 이 저장소가 잰 값이 아니다.
 * 그래서 사다리는 '목표'로만 그리고, 현재 값 자리에 쓰지 않는다.
 */
export default async function DependencyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await recordScreenRead({ path: `/dependency/${id}`, kind: 'page', business_id: id })

  const [user, repo] = await Promise.all([currentUser(), getRepository()])
  const [businesses, dependency, interventions, areas, autonomy, tests, directions] = await Promise.all([
    repo.listBusinesses(),
    repo.listFounderDependency(),
    repo.listInterventions(),
    repo.listDependencyAreas(),
    repo.listAutonomyAssessments(),
    repo.listAbsenceTests(),
    repo.listChairmanDirections(),
  ])

  const business = businesses.find((b) => b.business_id === id)
  // 회사가 안 보이는 것은 없는 것과 같다(RLS가 판정한다). 403이 아니라 404다.
  if (!business) notFound()

  const canWrite = user?.role === 'Chairman' || user?.role === 'GroupCFO'
  /**
   * 0034 4절. 개입은 Chairman·GroupCFO와 **그 회사의 CEO**가 본다
   * (`intervention_counts_read` = `can_read_succession()`). 이 화면에 들어온 CEO는
   * 자기 회사에만 들어올 수 있으므로(위의 404 판정이 그것을 한다) 역할만 보면 된다.
   */
  const canSeeInterventions =
    user?.role === 'Chairman' || user?.role === 'GroupCFO' || user?.role === 'BusinessCEO'

  const months = recentPeriods(12)
  const rows = dependency.filter((r) => r.business_id === id && months.includes(r.period))
  const withValue = rows.filter((r) => r.dependency_pct !== null)
  const last = withValue[withValue.length - 1] ?? null
  const window = rollUp(rows)
  const myAreas = areas.filter((a) => a.business_id === id)
  const myTests = tests.filter((t) => t.business_id === id)
  const myAutonomy = autonomy
    .filter((a) => a.business_id === id)
    .sort((a, b) => b.quarter.localeCompare(a.quarter))
  const direction = directions.find((d) => d.business_id === id) ?? null
  const progress = transferProgress(myAreas)
  const passed = bestAbsencePass(myTests)

  const today = kstToday()
  const quarter = `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`

  const myInterventions = interventions.filter((r) => r.business_id === id && months.includes(r.period))
  const byMonth = months.map((m) => ({
    period: m,
    count: myInterventions.filter((r) => r.period === m).reduce((a, r) => a + Number(r.count), 0),
  }))
  const byKind = (['approve', 'reject', 'modify', 'delegate'] as InterventionRow['kind'][]).map((k) => ({
    kind: k,
    count: myInterventions.filter((r) => r.kind === k).reduce((a, r) => a + Number(r.count), 0),
  }))
  const maxBar = Math.max(1, ...byMonth.map((m) => m.count))

  const done = myAreas.filter((a) => a.transfer_status === 'done')
  const running = myAreas.filter((a) => a.transfer_status === 'in_progress')
  const notYet = myAreas.filter((a) => a.transfer_status === 'not_started')
  const unplanned = myAreas.filter((a) => a.transfer_status === null)

  // §35 NEXT 90 DAYS. 진행 중인 것 + 90일 안에 목표일이 있는 것.
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 90 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const next90 = myAreas.filter(
    (a) =>
      a.transfer_status === 'in_progress' ||
      (a.transfer_status === 'not_started' && a.target_date !== null && a.target_date <= horizon),
  )

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-5">
      <PageHeader
        icon="shield"
        title={`${business.name} · 승계`}
        code="§11 Succession"
        description="회장님이 이 회사에서 빠지는 과정을 숫자와 목록으로 봅니다."
      >
        <Link
          href="/dependency"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          전체 회사
        </Link>
      </PageHeader>

      {/* ───────── 1. Founder Dependency + 목표 사다리 ───────── */}
      <Section icon="target" title="Founder Dependency (§7)" note={last ? `${last.period} 기준` : '측정 전'}>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <BigPercent
              value={last?.dependency_pct ?? null}
              reason="아직 계산할 수 없습니다 — 이 회사에는 처리된 결정이 아직 없습니다. 0%가 아니라 셀 것이 없다는 뜻입니다."
            />
            {last ? (
              <p className="mt-1.5 text-[10.5px] text-ink-muted tnum">
                회장 {last.chairman_count} / 전체 {last.total_count}건 · CEO {last.ceo_count} · 규칙{' '}
                {last.rule_count}
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-[10.5px] text-ink-dim">목표 사다리</p>
            <p className="mt-1 flex items-baseline gap-1.5 text-[13px] font-semibold text-ink-dim tnum">
              {DEPENDENCY_LADDER.map((v, i) => (
                <span key={v}>
                  {i === DEPENDENCY_LADDER.length - 1 ? `<${v}%` : `${v}%`}
                  {i < DEPENDENCY_LADDER.length - 1 ? <span className="mx-1 text-ink-muted">→</span> : null}
                </span>
              ))}
            </p>
            <p className="mt-1 max-w-[320px] text-[10px] leading-relaxed text-ink-muted">
              첫 칸 37%는 문서 §35의 **예시 화면** 숫자입니다. 이 저장소가 잰 값이 아니라 출발점
              표기이고, 마지막 {DEPENDENCY_TARGET}%가 §7의 목표입니다.
            </p>
          </div>
          {window && window.unknown_count > 0 ? (
            <div className="max-w-[360px]">
              <p className="text-[10.5px] text-ink-dim">역산 미도달</p>
              <p className="mt-1 text-[13px] font-semibold text-ink tnum">{window.unknown_count}건</p>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-muted">{BACKFILL_UNREACHED_KO}</p>
            </div>
          ) : null}
        </div>
      </Section>

      {/* ───────── 2. Autonomy ───────── */}
      <Section icon="crown" title="CEO 자율성 (§9)" note={myAutonomy[0]?.quarter ?? AUTONOMY_EMPTY_KO}>
        <AutonomyGauge level={myAutonomy[0]?.level ?? null} />
        {myAutonomy[0] ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">
            {AUTONOMY_CRITERIA_KO[myAutonomy[0].level]}
            {myAutonomy[0].note ? (
              <span className="mt-0.5 block text-[10.5px] text-ink-muted">근거 · {myAutonomy[0].note}</span>
            ) : null}
          </p>
        ) : (
          <Missing>
            이 회사는 아직 자율성 평가가 없습니다. 등급을 추정해서 채우지 않습니다 — 지어낸 등급에서
            다음 분기 평가가 출발하게 됩니다.
          </Missing>
        )}
        {canWrite ? (
          <AutonomyEditor businessId={id} quarter={quarter} current={myAutonomy[0]?.level ?? null} />
        ) : null}
        {myAutonomy.length > 1 ? (
          <ul className="mt-2 space-y-0.5 text-[10.5px] text-ink-muted tnum">
            {myAutonomy.slice(1).map((a) => (
              <li key={a.quarter}>
                {a.quarter} · {a.level}
                {a.note ? ` · ${a.note}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {/* ───────── 3. 회장 개입 ───────── */}
      <Section icon="clock" title="회장 개입 (§7 · §34)" note="최근 12개월 · 승인 · 반려 · 수정요청 · 위임">
        {!canSeeInterventions ? (
          <Missing>
            개입 건수는 권한 밖이라 집계되지 않습니다. 이 수치는 회장님·그룹 CFO와 해당 회사
            대표에게만 열려 있습니다. 0건이 아니라 «여기서는 셀 수 없다»는 뜻입니다.
          </Missing>
        ) : myInterventions.length === 0 ? (
          <Missing>최근 12개월에 이 회사에서 회장님이 직접 처리한 건이 없습니다. 0건입니다.</Missing>
        ) : (
          <>
            {/* §32: 막대 하나. 축도 눈금도 색도 없다 — 높이만으로 읽는다. */}
            <div className="flex items-end gap-1" aria-hidden>
              {byMonth.map((m) => (
                <div key={m.period} className="flex-1">
                  <div
                    className="rounded-sm bg-ink-muted/60"
                    style={{ height: `${Math.round((m.count / maxBar) * 44) + 1}px` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1 text-[9px] text-ink-muted tnum">
              {byMonth.map((m) => (
                <span key={m.period} className="flex-1 text-center">
                  {m.period.slice(5)}
                </span>
              ))}
            </div>
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
              {byKind.map((k) => (
                <div key={k.kind} className="flex items-baseline gap-1.5">
                  <dt className="text-ink-dim">{INTERVENTION_LABEL_KO[k.kind]}</dt>
                  <dd className="font-semibold text-ink tnum">{k.count}건</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </Section>

      {/* ───────── 4. 이양 현황 (§11 · §35) ───────── */}
      <Section
        icon="layers"
        title="이양 현황 (§11)"
        note={progress ? `${progress.done} / ${progress.planned} 완료` : '이양 계획 없음'}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Bucket title="이양 완료" areas={done} />
          <Bucket title="이양 중" areas={running} />
          <Bucket title="미이양" areas={notYet} />
        </div>
        {unplanned.length > 0 ? (
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-muted">
            이양 계획이 아직 없는 영역: {unplanned.map((a) => a.area).join(' · ')} — «미이양»과 다른
            사실이라 위 세 칸에 넣지 않았습니다.
          </p>
        ) : null}
      </Section>

      {/* ───────── 5. 다음 90일 (§35 NEXT 90 DAYS) ───────── */}
      <Section icon="check-circle" title="다음 90일" note={`${today} ~ ${horizon}`}>
        {next90.length === 0 ? (
          <Missing>
            90일 안에 목표일이 잡힌 이양이 없습니다. 아래 표에서 목표일을 넣으면 여기에 올라옵니다.
          </Missing>
        ) : (
          <ul className="space-y-1">
            {next90.map((a) => (
              <li key={a.area} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-raised px-3 py-2 text-[11.5px]">
                <span className="font-semibold text-ink">{a.area}</span>
                <TransferChip status={a.transfer_status} />
                <span className="text-[10.5px] text-ink-muted tnum">
                  {a.target_date ? `목표 ${a.target_date}` : '목표일 없음'}
                </span>
                {a.note ? <span className="text-[10.5px] text-ink-muted">{a.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ───────── 6. 의존 영역 표 (편집) ───────── */}
      <Section icon="grid" title="의존 영역 (§7)" note="회장 의존도와 이양 상태를 한 줄에서 본다">
        {myAreas.length === 0 ? (
          <Missing>
            이 회사에는 아직 의존 영역이 등록되지 않았습니다.
            {canWrite ? ' 아래에서 추가할 수 있습니다.' : ''}
          </Missing>
        ) : null}
        <AreaEditor businessId={id} areas={myAreas} canWrite={canWrite} />
      </Section>

      {/* ───────── 7. 부재 테스트 (§12) ───────── */}
      <Section
        icon="shield"
        title="회장 부재 테스트 (§12)"
        note={passed ? `${passed.days}일 통과` : '통과한 테스트 없음'}
      >
        <p className="mb-2 text-[10.5px] leading-relaxed text-ink-muted">
          «회장이 내일부터 연락이 안 된다면, 이 회사는 30일 동안 정상적으로 돌아가는가.» §12는 7 ·
          30 · 90 · 365일 넷을 봅니다. 365일을 통과하기 전에는 CEO를 진짜 L5로 보지 않습니다.
        </p>
        <AbsenceEditor businessId={id} tests={myTests} canWrite={canWrite} />
      </Section>

      {/* ───────── 8. Direction · Letter (§20 · §21) ───────── */}
      <Section icon="book" title="Direction · Chairman Letter (§20 · §21)" note="CEO는 이 안에서 자유롭게 운영한다">
        <DirectionEditor businessId={id} direction={direction} canWrite={canWrite} />
      </Section>

      <div className="pb-6" />
    </div>
  )
}

function Bucket({ title, areas }: { title: string; areas: { area: string; level: string | null }[] }) {
  return (
    <div className="rounded-lg bg-raised p-2.5">
      <p className="text-[10.5px] text-ink-dim">
        {title} <span className="tnum">{areas.length}</span>
      </p>
      {areas.length === 0 ? (
        <p className="mt-1 text-[10.5px] text-ink-muted">없음</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {areas.map((a) => (
            <li key={a.area} className="flex items-baseline gap-1.5 text-[11.5px] text-ink">
              {a.area}
              <LevelChip level={a.level as never} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
