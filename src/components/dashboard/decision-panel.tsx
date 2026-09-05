'use client'

import { useMemo, useSyncExternalStore } from 'react'

import { Icon } from '@/components/ui/icon'
import { businessName, decisions } from '@/data'
import {
  DECISION_ACTION,
  DECISION_ACTION_LABEL_KO,
  appendLog,
  countOn,
  getServerSnapshot,
  getSnapshot,
  latestByDecision,
  parseLog,
  subscribe,
  type DecisionAction,
} from '@/lib/decision-log'
import { dDay, dayKey, formatDDay } from '@/lib/format'
import { WORK_PRIORITY_LABEL_KO, type Decision, type WorkPriority } from '@/types'

/**
 * CH-015 Today Decisions + CH-016 Approve/Reject.
 * '오늘 결정할 것'만 남기는 패널이다. 처리한 건은 목록에서 빠지고 로그로 내려간다 —
 * 아침에 열었을 때 남은 줄 수가 곧 남은 일이라는 게 이 화면의 약속이다.
 */

/** Chairman이 스스로 결정하는 사람이라, 지금 단계의 actor는 하나로 고정한다. */
const ACTOR = 'user_001'

/** 중요도 색. 보통 이하는 색을 주지 않는다 — 색은 위험에만 쓴다(요구사항서 2번). */
const IMPACT_TONE: Record<WorkPriority, string> = {
  Critical: 'bg-critical/15 text-critical',
  High: 'bg-warning/15 text-warning',
  Medium: 'bg-raised text-ink-dim',
  Low: 'bg-raised text-ink-muted',
}

const IMPACT_RANK: Record<WorkPriority, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 }

export function DecisionPanel() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const log = useMemo(() => parseLog(raw), [raw])
  const handled = useMemo(() => latestByDecision(log), [log])

  const today = dayKey()

  // 중요도 → 마감일 순. 같은 중요도면 발등에 떨어진 것이 위로 온다.
  const open = decisions
    .filter((d) => d.status === 'Open' && !handled.has(d.decision_id))
    .sort(
      (a, b) =>
        IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || a.deadline.localeCompare(b.deadline),
    )

  function act(decisionId: string, action: DecisionAction) {
    appendLog({ decision_id: decisionId, action, at: new Date().toISOString(), actor: ACTOR })
  }

  return (
    <section className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="stamp" className="size-4 text-gold" />내 결정 사항
          <span className="text-[11px] font-normal text-ink-muted tnum">{open.length}건</span>
        </h2>
        <span className="text-[9px] text-ink-muted tnum">CH-015~016</span>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-muted tnum">
        오늘 처리 {countOn(log, today)}건
      </p>

      {open.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-[12px] text-ink-muted">
          오늘 결정할 항목이 없습니다.
        </p>
      ) : (
        <ul className="-mx-1.5 mt-2 flex-1 space-y-1 overflow-y-auto">
          {open.map((d) => (
            <DecisionItem key={d.decision_id} decision={d} onAct={act} />
          ))}
        </ul>
      )}
    </section>
  )
}

function DecisionItem({
  decision,
  onAct,
}: {
  decision: Decision
  onAct: (decisionId: string, action: DecisionAction) => void
}) {
  // 마감이 지난 건은 D+로 뜬다. 이건 색을 줘야 하는 상태다.
  const overdue = dDay(decision.deadline) < 0

  return (
    <li className="rounded-lg px-1.5 py-1.5 transition-colors hover:bg-raised/60">
      <div className="flex items-center gap-1.5">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${IMPACT_TONE[decision.impact]}`}
        >
          {WORK_PRIORITY_LABEL_KO[decision.impact]}
        </span>
        <span className="truncate text-[11px] text-ink-muted">
          {businessName(decision.business_id)}
        </span>
        <span
          className={`ml-auto shrink-0 text-[11px] font-semibold tnum ${
            overdue ? 'text-critical' : 'text-ink-dim'
          }`}
        >
          {formatDDay(decision.deadline)}
        </span>
      </div>

      <p className="mt-0.5 text-[12px] leading-snug font-semibold">{decision.title}</p>

      {/* 선택안과 AI 추천을 한 줄에 둔다. 추천안만 테두리를 줘서 어느 쪽인지 바로 보이게. */}
      <p className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-ink-muted">
        {decision.options.map((opt) => (
          <span
            key={opt}
            className={`rounded px-1.5 py-0.5 ${
              opt === decision.ai_recommendation
                ? 'border border-accent/50 bg-accent/10 text-ink-dim'
                : 'bg-raised'
            }`}
          >
            {opt}
          </span>
        ))}
        <span className="flex items-center gap-0.5 text-ink-muted">
          <Icon name="sparkles" className="size-3" />
          {decision.ai_recommendation}
        </span>
      </p>

      <div className="mt-1.5 flex gap-1">
        {DECISION_ACTION.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => onAct(decision.decision_id, action)}
            className={`flex-1 rounded border py-1 text-[10px] transition-colors ${
              action === 'Approved'
                ? 'border-accent/60 text-ink-dim hover:bg-accent hover:text-ink'
                : 'border-line text-ink-muted hover:border-line hover:bg-raised hover:text-ink-dim'
            }`}
          >
            {DECISION_ACTION_LABEL_KO[action]}
          </button>
        ))}
      </div>
    </li>
  )
}
