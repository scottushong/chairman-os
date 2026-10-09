'use client'

import { useState, useTransition } from 'react'

import { approvalDecideAction } from '@/app/actions/approvals'

/**
 * 0059 단계 결재 — 지금 차례인 결재자의 «승인» · «반려».
 *
 * 예전 결재의 넉 장(승인 · 거절 · 수정요청 · 위임) 대신 둘뿐이다. 반려는 사유가 있어야 누를 수 있다 —
 * 화면이 먼저 막고, DB(approval_reason_required)가 한 번 더 막는다. 차례 판정도 DB가 한다.
 * 성공하면 Server Action이 /approvals를 다시 그린다 — 진행 칸 · 상태가 같이 바뀐다.
 */
export function ChainDecide({ decisionId }: { decisionId: string }) {
  const [pending, startTransition] = useTransition()
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function act(approve: boolean) {
    setError(null)
    setMessage(null)
    if (!approve && !note.trim()) {
      setError('반려 사유를 적어 주세요.')
      return
    }
    startTransition(async () => {
      const r = await approvalDecideAction({ decisionId, approve, note: approve ? undefined : note.trim() })
      if (r.error) setError(r.error)
      else {
        setMessage(r.message ?? null)
        setRejecting(false)
        setNote('')
      }
    })
  }

  return (
    <div>
      {rejecting ? (
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-t11 text-ink-dim">
              반려 사유<span className="ml-0.5 text-critical">*</span>
            </span>
            <textarea
              rows={3}
              maxLength={2000}
              value={note}
              autoFocus
              onChange={(e) => setNote(e.target.value)}
              placeholder="무엇을 고치면 되는지 적어 주세요. 올린 사람에게 그대로 전달됩니다."
              className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-t12h"
            />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setRejecting(false)
                setError(null)
              }}
              className="rounded-lg border border-line py-2 text-t12 font-semibold text-ink-muted hover:bg-raised disabled:opacity-40"
            >
              취소
            </button>
            <button
              type="button"
              disabled={pending || !note.trim()}
              onClick={() => act(false)}
              className="rounded-lg border border-critical/60 bg-critical/10 py-2 text-t12 font-semibold text-critical hover:bg-critical/20 disabled:opacity-40"
            >
              {pending ? '처리 중…' : '반려 확정'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => act(true)}
            className="rounded-lg border border-accent bg-accent py-2 text-t12 font-semibold text-white disabled:opacity-40"
          >
            {pending ? '처리 중…' : '승인'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setRejecting(true)
              setError(null)
              setMessage(null)
            }}
            className="rounded-lg border border-line py-2 text-t12 font-semibold text-ink-dim hover:bg-raised disabled:opacity-40"
          >
            반려
          </button>
        </div>
      )}

      <p className="mt-2 text-t10h text-ink-muted">
        승인하면 다음 결재자 차례로 넘어가거나 최종 승인됩니다. 반려하면 바로 끝나고, 올린 사람이 고쳐서 다시 올릴 수 있습니다.
      </p>

      {message ? (
        <p role="status" className="mt-2 rounded-md bg-raised px-2.5 py-1.5 text-t11h text-ink-dim">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}
