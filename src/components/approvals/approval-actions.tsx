'use client'

import { useState, useTransition } from 'react'

import { decide } from '@/app/actions/decisions'
import { DECISION_ACTION, DECISION_ACTION_LABEL_KO, type DecisionAction } from '@/lib/decision-log'

/**
 * CH-041 처리 버튼 넉 장.
 *
 * 대시보드 패널(CH-015)의 같은 버튼과 같은 Server Action을 부른다. 여기서 따로
 * 상태를 옮기지 않는다 — 승인·거절이 두 곳에서 각각 구현되면 그중 하나만 감사 기록을
 * 빠뜨리는 날이 온다.
 *
 * 성공하면 화면을 직접 고치지 않는다. Server Action이 /approvals를 다시 그리고,
 * 그때 상태 배지와 이력 타임라인이 같이 갱신된다.
 */
export function ApprovalActions({
  decisionId,
  businessId,
}: {
  decisionId: string
  businessId: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function act(action: DecisionAction) {
    setError(null)
    startTransition(async () => {
      const result = await decide(decisionId, businessId, action)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5">
        {DECISION_ACTION.map((action) => (
          <button
            key={action}
            type="button"
            disabled={pending}
            onClick={() => act(action)}
            className={`rounded-lg border py-2 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
              action === 'Approved'
                ? 'border-accent/60 text-ink-dim hover:bg-accent hover:text-ink'
                : 'border-line text-ink-muted hover:bg-raised hover:text-ink-dim'
            }`}
          >
            {DECISION_ACTION_LABEL_KO[action]}
          </button>
        ))}
      </div>

      <p className="mt-2 text-[10.5px] text-ink-muted">
        누른 결과는 되돌릴 수 없습니다. 처리 기록은 감사 로그에 남고 지워지지 않습니다(CH-051).
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
