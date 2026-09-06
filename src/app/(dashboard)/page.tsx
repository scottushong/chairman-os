import { AiNightPanel } from '@/components/dashboard/ai-night-panel'
import { AlertPanel } from '@/components/dashboard/alert-panel'
import { DashboardBoard } from '@/components/dashboard/dashboard-board'
import { DecisionPanel } from '@/components/dashboard/decision-panel'
import { StrategicCoordinates } from '@/components/dashboard/strategic-coordinates'
import { WaitingOnMe } from '@/components/dashboard/waiting-on-me'
import { Icon } from '@/components/ui/icon'
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
  const data = await loadDashboard(repo)

  const today = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date())

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-bold tracking-tight">
            안녕하세요, Chairman님
            <Icon name="crown" className="size-5 text-gold" filled />
          </h1>
          {/* 표시 개수는 카드 줄 머리에서 말한다. 여기서 또 세면 숨김 후 두 숫자가 어긋난다. */}
          <p className="mt-1 text-[12px] text-ink-muted">오늘도 성공적인 하루 되세요.</p>
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
