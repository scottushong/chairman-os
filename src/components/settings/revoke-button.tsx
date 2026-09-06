'use client'

import { useState } from 'react'

import { revokeUser } from '@/app/actions/users'
import { Icon } from '@/components/ui/icon'

/**
 * CH-049 권한 회수 버튼 (05_Architecture 원칙 8).
 *
 * 두 번 눌러야 나간다. 확인 대화상자를 쓰지 않는 이유는 이 화면이 목록이고,
 * 대화상자가 뜨면 어느 줄에 대해 묻는 것인지 사라지기 때문이다 —
 * 버튼 자리에서 '정말로?'로 바뀌면 그 줄을 보면서 확인하게 된다.
 *
 * 되돌리는 버튼은 두지 않았다. 회수는 안전한 방향의 동작이고 되돌리기는 초대와 같은
 * 무게의 결정이라, 실수로 자른 사람은 다시 초대하는 편이 기록에도 정확하다.
 */
export function RevokeButton({
  kind,
  id,
  label,
}: {
  kind: 'account' | 'invitation'
  id: string
  /** 무엇을 자르는지. 확인 단계의 aria-label에 들어간다. */
  label: string
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    const result = await revokeUser({ kind, id })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      setArmed(false)
      return
    }
    // 성공하면 목록을 서버가 다시 그린다. 이 버튼은 그때 회수된 줄의 모양으로 바뀐다.
  }

  if (error) {
    return (
      <span role="alert" className="text-[10.5px] text-critical">
        {error}
      </span>
    )
  }

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label={`${label} 권한 회수`}
        className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10.5px] text-ink-muted transition-colors hover:border-critical/50 hover:text-critical"
      >
        <Icon name="user-minus" className="size-3" />
        {kind === 'account' ? '권한 회수' : '초대 취소'}
      </button>
    )
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={confirm}
        disabled={busy}
        aria-label={`${label} 권한 회수 확인`}
        className="rounded-md bg-critical/20 px-2 py-1 text-[10.5px] font-semibold text-critical transition-opacity disabled:opacity-40"
      >
        {busy ? '회수 중…' : '정말로 회수'}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={busy}
        className="rounded-md px-1.5 py-1 text-[10.5px] text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
      >
        취소
      </button>
    </span>
  )
}
