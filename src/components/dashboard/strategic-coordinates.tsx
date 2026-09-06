import { Icon, type IconName } from '@/components/ui/icon'
import { formatDDay } from '@/lib/format'
import { businessName } from '@/lib/lookup'
import {
  SEVERITY_LABEL_KO,
  WORK_PRIORITY_LABEL_KO,
  type Business,
  type CriticalRisk,
  type MonthlyPriority,
  type NextMilestone,
  type Severity,
  type TopGoal,
} from '@/types'

/**
 * CH-011~014 Strategic Coordinates.
 * 목표 / 이번 달 최우선 / 최대 위험 / 다음 좌표를 한 줄에 세워 둔다.
 * 네 장이 나란히 있어야 "어디로 가는데, 지금 뭘 하고, 뭐가 막고, 다음이 언제냐"가 한 눈에 읽힌다.
 */

/** Severity enum → 색. 상태색은 여기 말고 어디서도 만들지 않는다. */
const SEVERITY_TONE: Record<Severity, string> = {
  Critical: 'bg-critical/15 text-critical',
  Warning: 'bg-warning/15 text-warning',
  Info: 'bg-info/15 text-info',
}

/** Impact/Urgency 정렬 기준(CH-013). 높은 쪽이 먼저 올라온다. */
const SEVERITY_RANK: Record<Severity, number> = { Critical: 3, Warning: 2, Info: 1 }

function riskScore(r: CriticalRisk): number {
  return SEVERITY_RANK[r.impact] * 10 + SEVERITY_RANK[r.urgency]
}

interface StrategicCoordinatesProps {
  topGoals: TopGoal[]
  monthlyPriorities: MonthlyPriority[]
  criticalRisks: CriticalRisk[]
  nextMilestones: NextMilestone[]
  businesses: Business[]
}

export function StrategicCoordinates({
  topGoals,
  monthlyPriorities,
  criticalRisks,
  nextMilestones,
  businesses,
}: StrategicCoordinatesProps) {
  // 'group'은 DB의 business_id IS NULL을 앱 쪽에서 부르는 이름이다(repository/supabase.ts).
  const goal = topGoals.find((g) => g.business_id === 'group') ?? topGoals[0]
  const priority = monthlyPriorities.find((p) => p.business_id === 'group') ?? monthlyPriorities[0]
  const risk = [...criticalRisks].sort((a, b) => riskScore(b) - riskScore(a))[0]
  // D-Day가 가장 가까운 좌표 하나. 남은 일수는 저장하지 않고 deadline에서 계산한다.
  const milestone = [...nextMilestones].sort((a, b) => a.deadline.localeCompare(b.deadline))[0]

  return (
    <section aria-label="Strategic Coordinates">
      <h2 className="mb-2 text-[13px] font-semibold">Strategic Coordinates</h2>

      {/* 시드일 때는 네 칸이 늘 차 있었다. live에서는 RLS가 가려 빈 칸이 나올 수 있어
          카드를 지우지 않고 문구로 말한다 — 카드가 사라지면 남은 카드가 자리를 옮겨 앉는다. */}
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        <Card spec="CH-011" label="Top Goal" icon="target">
          {goal ? (
            <>
              <p className="text-[14px] leading-snug font-semibold">{goal.title}</p>
              <p className="mt-1 text-[11px] text-ink-muted tnum">
                현재 {goal.current_value} / 목표 {goal.target_value} · {goal.due}
              </p>
              {/* 진행바 폭은 progress_pct 그대로다. 다른 값에서 다시 계산하지 않는다. */}
              <div className="mt-auto pt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-ink-muted">진행률</span>
                  <span className="text-[13px] font-semibold tnum">{goal.progress_pct}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-accent/15">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${goal.progress_pct}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <Empty />
          )}
        </Card>

        <Card spec="CH-012" label="Monthly Priority" icon="check-circle">
          {priority ? (
            <>
              <div className="flex items-start gap-2">
                <p className="flex-1 text-[14px] leading-snug font-semibold">{priority.title}</p>
                <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-dim">
                  {WORK_PRIORITY_LABEL_KO[priority.weight]}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">{priority.detail}</p>
              <p className="mt-auto pt-3 text-[10px] text-ink-muted">담당 {priority.owner}</p>
            </>
          ) : (
            <Empty />
          )}
        </Card>

        <Card spec="CH-013" label="Critical Risk" icon="shield">
          {risk ? (
            <>
              <p className="text-[14px] leading-snug font-semibold">{risk.title}</p>
              <p className="mt-1 text-[11px] text-ink-muted">
                {businessName(businesses, risk.business_id)}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">{risk.detail}</p>
              <div className="mt-auto flex gap-1.5 pt-3">
                <SeverityChip label="영향도" value={risk.impact} />
                <SeverityChip label="긴급도" value={risk.urgency} />
              </div>
            </>
          ) : (
            <Empty />
          )}
        </Card>

        <Card spec="CH-014" label="Next Milestone" icon="calendar">
          {milestone ? (
            <>
              <p className="text-[14px] leading-snug font-semibold">{milestone.title}</p>
              <p className="mt-1 text-[11px] text-ink-muted">
                {businessName(businesses, milestone.business_id)} · 담당 {milestone.owner}
              </p>
              <div className="mt-auto flex items-baseline justify-between pt-3">
                <span className="text-[11px] text-ink-muted tnum">{milestone.deadline}</span>
                <span className="text-[17px] font-semibold text-gold tnum">
                  {formatDDay(milestone.deadline)}
                </span>
              </div>
            </>
          ) : (
            <Empty />
          )}
        </Card>
      </div>
    </section>
  )
}

/** 네 장의 키를 맞춘다. 마지막 줄(진행바·칩·D-Day)이 같은 높이에 서야 줄로 읽힌다. */
function Card({
  spec,
  label,
  icon,
  children,
}: {
  spec: string
  label: string
  icon: IconName
  children: React.ReactNode
}) {
  return (
    <article className="flex min-h-[148px] flex-col rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-ink-dim">
          <Icon name={icon} className="size-3.5" />
          {label}
        </span>
        <span className="text-[9px] text-ink-muted tnum">{spec}</span>
      </div>
      {children}
    </article>
  )
}

/** 값이 없을 때. 카드를 통째로 지우면 네 칸의 줄이 무너져 다른 카드가 옮겨 앉는다. */
function Empty() {
  return (
    <p className="flex flex-1 items-center justify-center text-[12px] text-ink-muted">
      표시할 항목이 없습니다.
    </p>
  )
}

/** 색만으로 읽히지 않게 한글 등급명을 항상 같이 쓴다. */
function SeverityChip({ label, value }: { label: string; value: Severity }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-ink-muted">
      {label}
      <span className={`rounded px-1.5 py-0.5 font-semibold ${SEVERITY_TONE[value]}`}>
        {SEVERITY_LABEL_KO[value]}
      </span>
    </span>
  )
}
