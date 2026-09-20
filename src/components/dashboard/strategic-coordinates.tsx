'use client'

import { useRef, useState, useSyncExternalStore } from 'react'

import { GlassCard } from '@/components/ui/glass-card'
import { Icon, type IconName } from '@/components/ui/icon'
import { dDay, formatDDay } from '@/lib/format'
import { businessName } from '@/lib/lookup'
import {
  SEVERITY_LABEL_KO,
  WORK_PRIORITY_LABEL_KO,
  type Business,
  type CriticalRisk,
  type IsoDate,
  type MonthlyPriority,
  type NextMilestone,
  type Severity,
  type TopGoal,
} from '@/types'

/**
 * CH-011~014 Strategic Coordinates.
 * 목표 / 이번 달 최우선 / 최대 위험 / 다음 좌표.
 *
 * 네 장을 나란히 세우던 것을 **버튼 스텝퍼 한 장으로 바꿨다.** 네 칸을 동시에 펼치면
 * 한 칸에 들어가는 글자가 카드 폭에 맞춰 깎여 나가고(detail이 두 줄에서 끊긴다),
 * 위험이 두 건 이상일 때 둘째 건을 놓을 자리가 아예 없었다 — CH-013은 상위 1~3개를
 * 보이라고 되어 있는데 카드 한 장에 한 건밖에 못 실었다.
 * 한 번에 한 단계만 크게 보여 주면 그 칸이 카드 전폭을 쓰므로 목록이 들어간다.
 *
 * '어디로 가는데, 지금 뭘 하고, 뭐가 막고, 다음이 언제냐'는 상단 알약 네 개가 유지한다.
 * 네 개가 → 로 이어져 늘 같은 자리에 서 있고, 각 알약이 짧은 상태(72% / 긴급 / D-3)를
 * 달고 있어 고르지 않아도 네 축의 현재값은 읽힌다.
 *
 * 카드는 다크다(AI 브리핑과 같은 처리). 이 카드는 '오늘의 방향'이고 그 아래가 실무 목록이라,
 * 면 색이 한 번 바뀌어야 두 덩어리가 갈라져 읽힌다.
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

/** CH-013은 상위 1~3개까지다. 넷째 건부터는 Business 상세(CH-024)에서 본다. */
const RISK_LIMIT = 3
/** 다음 좌표도 셋까지. 그 뒤는 달력의 일이지 '다음'이 아니다. */
const MILESTONE_LIMIT = 3

/** 기본 선택이 Milestone으로 넘어가는 기준. 이 안쪽이면 '다음'이 아니라 '지금'이다. */
const IMMINENT_DAYS = 7

type StepKey = 'goal' | 'priority' | 'risk' | 'milestone'

const STEPS: { key: StepKey; spec: string; label: string; icon: IconName }[] = [
  { key: 'goal', spec: 'CH-011', label: 'Top Goal', icon: 'target' },
  { key: 'priority', spec: 'CH-012', label: 'Monthly Priority', icon: 'check-circle' },
  { key: 'risk', spec: 'CH-013', label: 'Critical Risk', icon: 'shield' },
  { key: 'milestone', spec: 'CH-014', label: 'Next Milestone', icon: 'calendar' },
]

/**
 * 고른 단계는 세션 안에서만 기억한다(sessionStorage).
 * localStorage로 두면 어제 열어 본 단계가 오늘 아침 화면의 첫 칸이 된다 —
 * 이 카드의 기본값은 '오늘 가장 급한 것'이어야 하므로 날을 넘겨 살아남으면 안 된다.
 */
const STORAGE_KEY = 'chairman:strategic-coordinates:step'

function isStepKey(value: string | null): value is StepKey {
  return value !== null && STEPS.some((s) => s.key === value)
}

/**
 * sessionStorage를 외부 저장소로 읽는다.
 *
 * useEffect에서 setState로 얹던 것을 바꿨다 — 그건 첫 페인트 뒤 한 번 더 렌더를 돌려
 * 고른 단계가 눈에 띄게 한 번 튀고, lint(react-hooks/set-state-in-effect)도 막는다.
 * 서버 스냅샷을 null로 두면 서버 HTML은 기본 선택으로 그려지고, 클라이언트는 첫 렌더부터
 * 저장값을 보므로 하이드레이션 이후 한 번에 맞는 칸이 선다.
 */
const subscribeToSession = () => () => {}
const readSession = () => {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    // 사생활 보호 모드 등에서 접근이 막힌다. 기억이 없는 것과 같게 다룬다.
    return null
  }
}
const noSession = () => null

interface StrategicCoordinatesProps {
  topGoals: TopGoal[]
  monthlyPriorities: MonthlyPriority[]
  criticalRisks: CriticalRisk[]
  nextMilestones: NextMilestone[]
  businesses: Business[]
  /** 서버가 정한 오늘(kstToday). D-Day를 서버·클라이언트가 같은 날로 계산해야 한다. */
  today: IsoDate
}

export function StrategicCoordinates({
  topGoals,
  monthlyPriorities,
  criticalRisks,
  nextMilestones,
  businesses,
  today,
}: StrategicCoordinatesProps) {
  // 'group'은 DB의 business_id IS NULL을 앱 쪽에서 부르는 이름이다(repository/supabase.ts).
  const goal = topGoals.find((g) => g.business_id === 'group') ?? topGoals[0]
  const priority = monthlyPriorities.find((p) => p.business_id === 'group') ?? monthlyPriorities[0]
  const risks = [...criticalRisks].sort((a, b) => riskScore(b) - riskScore(a)).slice(0, RISK_LIMIT)
  // D-Day는 저장하지 않고 deadline에서 계산한다(CH-014).
  const milestones = [...nextMilestones]
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, MILESTONE_LIMIT)

  const todayDate = new Date(`${today}T00:00:00`)
  const risk = risks[0]
  const milestone = milestones[0]
  const remaining = milestone ? dDay(milestone.deadline, todayDate) : null

  /**
   * 기본 선택: 오늘 기준 가장 급한 것. 마감이 코앞인 좌표 > 긴급한 위험 > 이번 달 과제 > 목표.
   * 목표가 꼴찌인 것은 목표가 덜 중요해서가 아니라 오늘 움직일 수 있는 칸이 아니어서다.
   * 값이 없는 단계는 건너뛴다 — 빈 칸을 펴 놓고 시작하면 카드가 처음부터 비어 보인다.
   */
  const fallback: StepKey =
    remaining !== null && remaining <= IMMINENT_DAYS
      ? 'milestone'
      : risk && (risk.impact === 'Critical' || risk.urgency === 'Critical')
        ? 'risk'
        : priority
          ? 'priority'
          : goal
            ? 'goal'
            : milestone
              ? 'milestone'
              : 'risk'

  /**
   * 세 값이 겹친다: 이번에 누른 것 > 세션에 남은 것 > 오늘 기준 기본 선택.
   * 누른 값을 따로 들고 있는 것은 sessionStorage.setItem이 구독자에게 알리지 않아서다 —
   * 저장만 하고 읽기를 기다리면 클릭이 화면에 반영되지 않는다.
   */
  const [picked, setPicked] = useState<StepKey | null>(null)
  const saved = useSyncExternalStore(subscribeToSession, readSession, noSession)
  const step: StepKey = picked ?? (isStepKey(saved) ? saved : fallback)

  function select(next: StepKey) {
    setPicked(next)
    try {
      sessionStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 저장에 실패해도 화면은 바뀐다. 기억만 못 할 뿐이다.
    }
  }

  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  /** ←→ 로도 단계를 옮긴다(탭 패턴). 양 끝에서 감아 돈다. */
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    const i = STEPS.findIndex((s) => s.key === step)
    const next = STEPS[(i + delta + STEPS.length) % STEPS.length]
    select(next.key)
    tabs.current[STEPS.indexOf(next)]?.focus()
  }

  const status: Record<StepKey, string> = {
    goal: goal ? `${goal.progress_pct}%` : '—',
    priority: priority ? WORK_PRIORITY_LABEL_KO[priority.weight] : '—',
    risk: risk ? `영향 ${SEVERITY_LABEL_KO[risk.impact]}` : '—',
    milestone: milestone ? formatDDay(milestone.deadline, todayDate) : '—',
  }

  return (
    /* 브리핑 카드와 같은 처리다: 이 div가 다크 그라데이션을 칠하므로 카드와 같은 곡률로 잘라 낸다.
       radius가 없으면 그 칠이 네 모서리를 직각으로 채워 밝은 화면에 어두운 사각이 남는다. */
    <div data-theme="dark" className="overflow-hidden rounded-glass">
      <GlassCard as="section" padding="p-4" aria-label="Strategic Coordinates">
        <h2 className="mb-3 text-[13px] font-semibold">Strategic Coordinates</h2>

        {/*
         * 1024px 이하는 2×2다 — 알약 넷을 한 줄에 세우면 한 칸이 140px 밑으로 내려가
         * 'Monthly Priority'가 두 줄로 접힌다. 그 폭에서는 → 연결도 의미가 없어 같이 숨긴다.
         * lg(1024px)는 '1024를 포함'하므로 쓸 수 없다. 전부 min-[1025px]로 맞춘다.
         */}
        <div
          role="tablist"
          aria-label="전략 좌표 단계"
          onKeyDown={onKeyDown}
          className="grid grid-cols-2 gap-2 min-[1025px]:flex min-[1025px]:items-stretch min-[1025px]:gap-0"
        >
          {STEPS.map((s, i) => (
            <div key={s.key} className="contents min-[1025px]:flex min-[1025px]:flex-1 min-[1025px]:items-stretch">
              <button
                ref={(el) => {
                  tabs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`sc-tab-${s.key}`}
                aria-selected={step === s.key}
                aria-controls="sc-panel"
                tabIndex={step === s.key ? 0 : -1}
                onClick={() => select(s.key)}
                className={[
                  'flex min-w-0 flex-1 items-center gap-1.5 rounded-full px-3 py-2 text-left transition-colors',
                  step === s.key
                    ? 'bg-accent font-semibold text-app'
                    : 'border border-line-soft text-ink-dim hover:bg-raised hover:text-ink',
                ].join(' ')}
              >
                <Icon name={s.icon} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[11.5px]">{s.label}</span>
                <span
                  className={`shrink-0 text-[11px] font-semibold tnum ${
                    step === s.key ? 'text-app' : 'text-ink-muted'
                  }`}
                >
                  {status[s.key]}
                </span>
              </button>

              {/* 연결 화살표. 네 알약이 '순서'로 읽히게 하는 유일한 장치라 마지막 뒤에는 없다. */}
              {i < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className="hidden shrink-0 items-center px-1.5 text-ink-muted min-[1025px]:flex"
                >
                  <Icon name="chevron-right" className="size-3.5" />
                </span>
              ) : null}
            </div>
          ))}
        </div>

        {/*
         * 고른 단계 하나만 크게.
         *
         * min-h는 **가장 큰 칸(위험·좌표 3줄)에 맞춘다.** 내용에 맡기면 목표(110px)와
         * 위험(186px) 사이를 오갈 때마다 카드 키가 76px씩 달라지고, 이 카드는 이니셔티브
         * 줄 바로 위라 그 차이만큼 아래 화면 전체가 위아래로 튄다 — 알약을 눌러 비교하는
         * 카드에서 누를 때마다 눈이 따라가야 할 위치가 바뀐다.
         * 한 건짜리 위험에서 아래가 비는 것은 그 값을 치르고 산 것이다.
         */}
        <div
          role="tabpanel"
          id="sc-panel"
          aria-labelledby={`sc-tab-${step}`}
          tabIndex={0}
          className="mt-3.5 min-h-[196px] border-t border-line-soft pt-3.5"
        >
          {step === 'goal' ? <GoalPanel goal={goal} /> : null}
          {step === 'priority' ? <PriorityPanel priority={priority} /> : null}
          {step === 'risk' ? <RiskPanel risks={risks} businesses={businesses} /> : null}
          {step === 'milestone' ? (
            <MilestonePanel
              milestones={milestones}
              businesses={businesses}
              todayDate={todayDate}
            />
          ) : null}
        </div>
      </GlassCard>
    </div>
  )
}

function GoalPanel({ goal }: { goal: TopGoal | undefined }) {
  if (!goal) return <Empty />
  return (
    <div>
      <p className="text-[17px] leading-snug font-semibold">{goal.title}</p>
      <p className="mt-1.5 text-[12px] text-ink-dim tnum">
        현재 {goal.current_value} / 목표 {goal.target_value} · 기한 {goal.due}
      </p>
      {/* 진행바 폭은 progress_pct 그대로다. 다른 값에서 다시 계산하지 않는다. */}
      <div className="mt-4 max-w-xl">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-ink-muted">진행률</span>
          <span className="text-[15px] font-semibold tnum">{goal.progress_pct}%</span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-accent/15">
          <div className="h-full rounded-full bg-accent" style={{ width: `${goal.progress_pct}%` }} />
        </div>
      </div>
    </div>
  )
}

function PriorityPanel({ priority }: { priority: MonthlyPriority | undefined }) {
  if (!priority) return <Empty />
  return (
    <div>
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[17px] leading-snug font-semibold">{priority.title}</p>
        <span className="mt-0.5 shrink-0 rounded bg-raised px-2 py-0.5 text-[11px] text-ink-dim">
          {WORK_PRIORITY_LABEL_KO[priority.weight]}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-ink-dim">{priority.detail}</p>
      <p className="mt-3 text-[11px] text-ink-muted">담당 {priority.owner}</p>
    </div>
  )
}

/** 위험은 한 건이 아닐 수 있다. 상위 셋을 줄로 세운다 — 카드 시절엔 첫 건만 보였다. */
function RiskPanel({ risks, businesses }: { risks: CriticalRisk[]; businesses: Business[] }) {
  if (risks.length === 0) return <Empty />
  return (
    <ul className="space-y-2.5">
      {risks.map((r, i) => (
        <li key={r.risk_id} className={i > 0 ? 'border-t border-line-soft pt-2.5' : undefined}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className={`${i === 0 ? 'text-[17px]' : 'text-[14px]'} leading-snug font-semibold`}>
              {r.title}
            </p>
            <span className="text-[11px] text-ink-muted">{businessName(businesses, r.business_id)}</span>
            <span className="ml-auto flex shrink-0 gap-1.5">
              <SeverityChip label="영향도" value={r.impact} />
              <SeverityChip label="긴급도" value={r.urgency} />
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-dim">{r.detail}</p>
        </li>
      ))}
    </ul>
  )
}

function MilestonePanel({
  milestones,
  businesses,
  todayDate,
}: {
  milestones: NextMilestone[]
  businesses: Business[]
  todayDate: Date
}) {
  if (milestones.length === 0) return <Empty />
  return (
    <ul className="space-y-2.5">
      {milestones.map((m, i) => (
        <li
          key={m.milestone_id}
          className={`flex items-baseline gap-3 ${i > 0 ? 'border-t border-line-soft pt-2.5' : ''}`}
        >
          <div className="min-w-0 flex-1">
            <p className={`${i === 0 ? 'text-[17px]' : 'text-[14px]'} leading-snug font-semibold`}>
              {m.title}
            </p>
            <p className="mt-1 text-[11px] text-ink-muted tnum">
              {businessName(businesses, m.business_id)} · 담당 {m.owner} · {m.deadline}
            </p>
          </div>
          <span
            className={`shrink-0 font-semibold text-gold tnum ${i === 0 ? 'text-[22px]' : 'text-[15px]'}`}
          >
            {formatDDay(m.deadline, todayDate)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 값이 없을 때. 알약은 남는다 — 네 축이 사라지면 '그 축이 없다'가 아니라 '안 봤다'가 된다. */
function Empty() {
  return (
    <p className="flex h-[164px] items-center justify-center text-[12px] text-ink-muted">
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
