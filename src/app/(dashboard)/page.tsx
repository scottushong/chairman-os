import { AiNightPanel } from '@/components/dashboard/ai-night-panel'
import { AlertPanel } from '@/components/dashboard/alert-panel'
import { ChairmanDdayCard } from '@/components/dashboard/chairman-dday-card'
import { CriticalBanner } from '@/components/dashboard/critical-banner'
import { DashboardBoard } from '@/components/dashboard/dashboard-board'
import { DecisionPanel } from '@/components/dashboard/decision-panel'
import { InitiativeStat } from '@/components/dashboard/initiative-stat'
import { StrategicCoordinates } from '@/components/dashboard/strategic-coordinates'
import { WaitingOnMe } from '@/components/dashboard/waiting-on-me'
import { Icon } from '@/components/ui/icon'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
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
            <p className="mt-1 text-[12px] text-ink-muted">오늘도 성공적인 하루 되세요.</p>
          </div>
          {/* Phase 3-B. 회장이 대시보드를 열 때마다 남은 날을 먼저 본다. 누르면 /ai 아침 루틴. */}
          <ChairmanDdayCard projects={chairmanProjects} />
          {/* Task 9. ChairmanDdayCard는 '가장 가까운 장기 프로젝트 한 건', 이건 '이니셔티브 센 수' — 형제로 둔다. */}
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

      {/* CH-018 Acceptance는 'Critical rule 즉시 상단 노출'이다. 아래 4열 그리드의
          AlertPanel은 KPI 8타일과 12개월 차트 뒤에 있어 스크롤해야 보인다 —
          Critical이 있는 날에만 이 한 줄이 맨 위에 선다. */}
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
        />
        <StrategicCoordinates
          topGoals={data.topGoals}
          monthlyPriorities={data.monthlyPriorities}
          criticalRisks={data.criticalRisks}
          nextMilestones={data.nextMilestones}
          businesses={data.businesses}
        />
      </div>

      <div className="mt-5 grid grid-cols-12 gap-3.5 pb-6">
        {/* 결정 → 대기 → 알림 → 야간 AI. 아침에 훑는 순서 그대로 왼쪽에서 오른쪽으로 놓는다. */}
        <div className="col-span-12 h-[268px] lg:col-span-6 xl:col-span-3">
          <DecisionPanel
            decisions={data.decisions}
            businesses={data.businesses}
            audit={data.decisionAudit}
          />
        </div>

        <div className="col-span-12 h-[268px] lg:col-span-6 xl:col-span-3">
          <WaitingOnMe
            tasks={data.tasks}
            projects={data.projects}
            businesses={data.businesses}
          />
        </div>

        <div className="col-span-12 h-[268px] lg:col-span-6 xl:col-span-3">
          <AlertPanel
            alerts={data.alerts}
            decisions={data.decisions}
            businesses={data.businesses}
          />
        </div>

        <div className="col-span-12 h-[268px] lg:col-span-6 xl:col-span-3">
          <AiNightPanel outputs={data.aiNightOutputs} businesses={data.businesses} />
        </div>
      </div>
    </div>
  )
}
