'use client'

import { useState } from 'react'

import { approveInvitation } from '@/app/actions/users'
import { Icon } from '@/components/ui/icon'

/**
 * Phase 6-1 블록 B-4 — 회장 결재 큐의 도장 하나.
 *
 * 누르면 chairman_approved_at이 찬다. 그 update 하나로 0026의 트리거가 이행까지 돌린다 —
 * 계정이 이미 있으면 권한이 그 자리에서 붙고, 없으면 계정이 생길 때 붙는다.
 *
 * 되돌리는 버튼은 없다. 승인을 물리는 일은 '권한 회수'이지 '승인 취소'가 아니고,
 * 그 버튼은 이미 사용자 목록에 있다(RevokeButton).
 */
export function ApproveInvitation({ invitationId, label }: { invitationId: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    setBusy(true)
    setError(null)
    const result = await approveInvitation({ invitationId })
    setBusy(false)
    if (result.error) setError(result.error)
  }

  if (error) {
    return (
      <span role="alert" className="text-[10.5px] text-critical">
        {error}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={approve}
      disabled={busy}
      aria-label={`${label} 초대 승인`}
      className="flex items-center gap-1 rounded-md border border-accent/50 bg-accent/10 px-2 py-1 text-[10.5px] font-semibold text-ink transition-opacity hover:bg-accent/20 disabled:opacity-40"
    >
      <Icon name="stamp" className="size-3" />
      {busy ? '승인 중…' : '결재 승인'}
    </button>
  )
}
