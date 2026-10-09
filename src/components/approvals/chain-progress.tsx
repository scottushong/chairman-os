import { chainText } from '@/components/approvals/chain-text'
import { formatDateTime } from '@/lib/format'
import type { ApprovalStepState, ApprovalStepStatus, Role } from '@/types'

/**
 * 0059 단계 결재의 진행 — 칸마다 결재자 · 왜 이 칸인가 · 상태 · 처리 시각 · 의견. 지금 차례 칸을 강조한다.
 *
 * 값은 approval_steps(얼린 결재선에서 만든 칸)다. 결재선(decisions.approval_line)과 달리 상태가 움직인다.
 */

const STATUS_LABEL: Record<ApprovalStepStatus, string> = {
  pending: '차례',
  waiting: '대기',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
}

const STATUS_TONE: Record<ApprovalStepStatus, string> = {
  pending: 'bg-accent text-white',
  waiting: 'bg-raised text-ink-muted',
  approved: 'bg-ok/15 text-ok',
  rejected: 'bg-critical/15 text-critical',
  cancelled: 'bg-raised text-ink-muted line-through',
}

export function ChainProgress({
  steps,
  viewerId,
  viewerRole,
  ruleWhy,
}: {
  /** 이 결재의 칸들(seq 순서가 아니어도 된다). */
  steps: ApprovalStepState[]
  viewerId: string | null
  viewerRole: Role | null
  /** 얼린 결재선의 규칙 판정 문장(있으면 아래에 한 줄). */
  ruleWhy?: string | null
}) {
  const ordered = [...steps].sort((a, b) => a.seq - b.seq)
  if (ordered.length === 0) {
    return <p className="text-t12 text-ink-muted">결재 단계가 없습니다(올린 즉시 끝난 결재).</p>
  }
  return (
    <div>
      <ol className="space-y-1.5">
        {ordered.map((s) => {
          const turn = s.status === 'pending'
          const mine = turn && viewerId !== null && s.approver_user_id === viewerId
          return (
            <li
              key={s.seq}
              aria-current={turn ? 'step' : undefined}
              className={`rounded-lg border px-3 py-2 ${turn ? 'border-accent bg-accent/5' : 'border-line-soft bg-raised/40'}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-t10 text-ink-muted tnum">{s.seq}</span>
                <span className="text-t12h font-semibold">
                  {s.is_chairman ? chainText(s.approver_name, viewerRole) : s.approver_name}
                </span>
                <span className="text-t11 text-ink-dim">{chainText(s.why, viewerRole)}</span>
                {mine ? <span className="rounded bg-warning/15 px-1.5 py-0.5 text-t9 font-semibold text-warning">내 차례</span> : null}
                <span className={`ml-auto rounded px-1.5 py-0.5 text-t10 font-semibold ${STATUS_TONE[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
              </div>
              {s.decided_at ? (
                <p className="mt-0.5 text-t11 text-ink-muted tnum">{formatDateTime(s.decided_at)}</p>
              ) : null}
              {s.note ? (
                <p
                  className={`mt-1 whitespace-pre-wrap break-words rounded-md px-2 py-1 text-t11h ${
                    s.status === 'rejected' ? 'bg-critical/10 text-critical' : 'bg-raised text-ink-dim'
                  }`}
                >
                  {s.status === 'rejected' ? '반려 사유: ' : '의견: '}
                  {s.note}
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>
      {ruleWhy ? <p className="mt-1.5 text-t10h text-ink-muted">{chainText(ruleWhy, viewerRole)}</p> : null}
    </div>
  )
}
