import { AiNightPanel } from '@/components/dashboard/ai-night-panel'
import { AlertPanel } from '@/components/dashboard/alert-panel'
import { CriticalBanner } from '@/components/dashboard/critical-banner'
import { DashboardBoard } from '@/components/dashboard/dashboard-board'
import { DecisionPanel } from '@/components/dashboard/decision-panel'
import { InitiativeStat } from '@/components/dashboard/initiative-stat'
import { StrategicCoordinates } from '@/components/dashboard/strategic-coordinates'
import { WaitingOnMe } from '@/components/dashboard/waiting-on-me'
import { Icon } from '@/components/ui/icon'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { orderInitiatives } from '@/lib/initiative'
import { getRepository, loadDashboard } from '@/lib/repository'

/**
 * 메인 대시보드. CH-001~019가 모두 올라와 있다.
 *
 * 데이터를 읽는 유일한 자리다. 서버에서 한 번에 다 읽어 아래 컴포넌트로 내려 준다.
 * 패널마다 각자 읽게 두면 live 모드에서 한 화면에 왕복이 열 번 넘게 생기고,
 * 화면 조각마다 다른 시점의 숫자를 보여 주게 된다.
 *
 * 어느 어댑터로 붙는지(시드냐 Supabase냐)는 getRepository()만 안다 —
 * 이 파일도, 아래 컴포넌트도 그걸 알 필요가 없다.
 */

const TABS = ['전체 요약', '중요 지표', '예산 vs 실적', '리스크', 'AI 요약'] as const

export default async function DashboardPage() {
  const repo = await getRepository()
  const [data, user, chairmanProjects, initiatives] = await Promise.all([
    loadDashboard(repo),
    currentUser(),
    repo.listChairmanProjects(),
    repo.listInitiatives(),
  ])

  const today = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date())
  const todayIso = kstToday()

  // item B: 대시보드 좌측에 올리는 이니셔티브는 요약이지 전체 그리드가 아니다. 기준은
  // '진행 중, 다음 행동이 급한 순'(orderInitiatives와 같은 정렬) 상위 6건 — 3열 그리드
  // 두 줄이다. 목록 화면(/initiatives)의 전체 카드를 그대로 복제하지 않는다.
  const activeInitiatives = initiatives.filter((i) => i.status === 'Active')
  const initiativeSummary = orderInitiatives(activeInitiatives).slice(0, 6)
  const initiativeLogoUrls = await repo.signInitiativeLogos(
    [...new Set(initiativeSummary.map((i) => i.logo_url).filter((p): p is string => p !== null))],
  )

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <div>
            <h1 className="flex items-center gap-2 text-[22px] font-bold tracking-tight">
              {/* 이름은 user_profiles.display_name. 세션이 없는 dummy 개발에서만 역할명으로 부른다. */}
              안녕하세요, {user?.name ?? 'Chairman'}님
              <Icon name="crown" className="size-5 text-gold" filled />
            </h1>
            {/* 표시 개수는 카드 줄 머리에서 말한다. 여기서 또 세면 숨김 후 두 숫자가 어긋난다. */}
            <p className="mt-1 text-[12px] text-ink-dim">오늘도 성공적인 하루 되세요.</p>
          </div>
          {/* Task 9. P5-2 리뷰 1라운드로 ChairmanDdayCard(장기 프로젝트 D-day 알약)를 이 줄에서 뺐다 —
              같은 프로젝트가 바로 아래 DdayHero에 히어로 크기로 다시 뜨는데, 인사말 두 줄 아래에
              같은 숫자가 알약으로 또 있으면 회장이 맨 처음 여는 화면에 중복만 남는다.
              InitiativeStat은 남긴다 — 이건 '이니셔티브 센 수'로 DdayHero와 다른 내용이다. */}
          <InitiativeStat initiatives={initiatives} today={todayIso} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-ink-dim tnum">{today}</span>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:text-ink"
          >
            월간
            <Icon name="chevron-down" className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex gap-1 border-b border-line-soft">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            type="button"
            className={[
              'rounded-t-md px-4 py-2 text-[13px] transition-colors',
              i === 0
                ? 'bg-panel font-semibold text-ink'
                : 'text-ink-muted hover:bg-panel/60 hover:text-ink-dim',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* CH-018 Acceptance는 'Critical rule 즉시 상단 노출'이다. 아래 결정·대기·알림 3장은
          히어로·KPI 8타일·12개월 차트를 지나야 나와 스크롤해야 보인다 —
          Critical이 있는 날에만 이 한 줄이 맨 위에 선다(P5-2에서 순서가 바뀌어도 그대로 유효). */}
      <CriticalBanner
        alerts={data.alerts}
        decisions={data.decisions}
        businesses={data.businesses}
      />

      <div className="mt-4 space-y-5">
        <DashboardBoard
          businesses={data.businesses}
          financeKpis={data.financeKpis}
          projects={data.projects}
          settings={data.userSettings}
          chairmanProjects={chairmanProjects}
          initiativeSummary={initiativeSummary}
          initiativeLogoUrls={initiativeLogoUrls}
          initiativeCount={activeInitiatives.length}
          today={todayIso}
        />
        <StrategicCoordinates
          topGoals={data.topGoals}
          monthlyPriorities={data.monthlyPriorities}
          criticalRisks={data.criticalRisks}
          nextMilestones={data.nextMilestones}
          businesses={data.businesses}
        />
      </div>

      {/* 재배치(P5-2 Step 3). 좌: 결정·대기·알림(오늘 훑는 순서 그대로) / 우 400px: 야간 AI 브리핑.
          브리핑 카드에만 data-theme="dark"를 건다 — 안쪽(AiNightPanel)은 한 줄도 고치지 않는다.
          토큰이 하위 트리에서 뒤집히는지 여기서 실물로 확인한다(P5-1 토큰 설계 검증, 항목 D). */}
      <div className="mt-5 grid grid-cols-1 gap-3.5 pb-6 lg:grid-cols-[1fr_400px]">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <div className="h-[268px]">
            <DecisionPanel
              decisions={data.decisions}
              businesses={data.businesses}
              audit={data.decisionAudit}
            />
          </div>

          <div className="h-[268px]">
            <WaitingOnMe
              tasks={data.tasks}
              projects={data.projects}
              businesses={data.businesses}
            />
          </div>

          <div className="h-[268px]">
            <AlertPanel
              alerts={data.alerts}
              decisions={data.decisions}
              businesses={data.businesses}
            />
          </div>
        </div>

        <div data-theme="dark" className="h-[268px]">
          <AiNightPanel outputs={data.aiNightOutputs} businesses={data.businesses} />
        </div>
      </div>
    </div>
  )
}
