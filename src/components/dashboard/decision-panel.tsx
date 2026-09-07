'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'

import { decide } from '@/app/actions/decisions'
import { Icon } from '@/components/ui/icon'
import {
  DECISION_ACTION,
  DECISION_ACTION_LABEL_KO,
  countOn,
  type DecisionAction,
  type DecisionAuditRecord,
} from '@/lib/decision-log'
import { dDay, dayKey, formatDDay } from '@/lib/format'
import { businessName } from '@/lib/lookup'
import {
  WORK_PRIORITY_LABEL_KO,
  type Business,
  type Decision,
  type WorkPriority,
} from '@/types'

/**
 * CH-015 Today Decisions + CH-016 Approve/Reject.
 * '오늘 결정할 것'만 남기는 패널이다. 처리한 건은 목록에서 빠지고 기록으로 내려간다 —
 * 아침에 열었을 때 남은 줄 수가 곧 남은 일이라는 게 이 화면의 약속이다.
 *
 * 처리 기록은 서버(audit_log)에 있다. 이 컴포넌트는 그걸 props로 받기만 하고,
 * 버튼은 Server Action을 부른다.
 */

/** 중요도 색. 보통 이하는 색을 주지 않는다 — 색은 위험에만 쓴다(요구사항서 2번). */
const IMPACT_TONE: Record<WorkPriority, string> = {
  Critical: 'bg-critical/15 text-critical',
  High: 'bg-warning/15 text-warning',
  Medium: 'bg-raised text-ink-dim',
  Low: 'bg-raised text-ink-muted',
}

const IMPACT_RANK: Record<WorkPriority, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 }

interface DecisionPanelProps {
  decisions: Decision[]
  businesses: Business[]
  /** audit_log에서 읽어 온 처리 이력. '오늘 처리 N건'과 목록 제외가 여기서 나온다. */
  audit: DecisionAuditRecord[]
}

export function DecisionPanel({ decisions, businesses, audit }: DecisionPanelProps) {
  const [pending, startTransition] = useTransition()
  /** 서버가 다시 그리기 전까지 눌린 줄을 미리 내린다. 안 그러면 한 박자 늦게 사라진다. */
  const [acted, setActed] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const today = dayKey()

  // 중요도 → 마감일 순. 같은 중요도면 발등에 떨어진 것이 위로 온다.
  const open = decisions
    .filter(
      (d) =>
        d.status === 'Open' && !acted.includes(d.decision_id),
    )
    .sort(
      (a, b) =>
        IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || a.deadline.localeCompare(b.deadline),
    )

  function act(decision: Decision, action: DecisionAction) {
    setError(null)
    setActed((prev) => [...prev, decision.decision_id])

    startTransition(async () => {
      const result = await decide(decision.decision_id, decision.business_id, action)
      if (result.error) {
        // 실패했으면 줄을 되돌린다. 처리된 것처럼 사라진 채로 두면 그 건이 잊힌다.
        setActed((prev) => prev.filter((id) => id !== decision.decision_id))
        setError(result.error)
      }
    })
  }

  return (
    <section className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="stamp" className="size-4 text-gold" />내 결정 사항
          <span className="text-[11px] font-normal text-ink-muted tnum">{open.length}건</span>
        </h2>
        {/* CH-041로 넘긴다. 여기서는 제목과 선택안까지, 저기서는 첨부와 처리 이력까지 본다. */}
        <Link
          href="/approvals"
          className="text-[11px] text-ink-muted transition-colors hover:text-ink"
        >
          전체 보기
        </Link>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-muted tnum">오늘 처리 {countOn(audit, today)}건</p>

      {error ? (
        <p
          role="alert"
          className="mt-1.5 rounded-md border border-critical/40 bg-critical/10 px-2 py-1 text-[11px] leading-snug text-critical"
        >
          {error}
        </p>
      ) : null}

      {open.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-[12px] text-ink-muted">
          오늘 결정할 항목이 없습니다.
        </p>
      ) : (
        <ul className="-mx-1.5 mt-2 flex-1 space-y-1 overflow-y-auto">
          {open.map((d) => (
            <DecisionItem
              key={d.decision_id}
              decision={d}
              businesses={businesses}
              busy={pending}
              onAct={act}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function DecisionItem({
  decision,
  businesses,
  busy,
  onAct,
}: {
  decision: Decision
  businesses: Business[]
  busy: boolean
  onAct: (decision: Decision, action: DecisionAction) => void
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
          {businessName(businesses, decision.business_id)}
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
            disabled={busy}
            onClick={() => onAct(decision, action)}
            className={`flex-1 rounded border py-1 text-[10px] transition-colors disabled:opacity-40 ${
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
