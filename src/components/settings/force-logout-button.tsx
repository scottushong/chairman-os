'use client'

import { useState } from 'react'

import { forceLogoutUser } from '@/app/actions/users'
import { Icon } from '@/components/ui/icon'

/**
 * Phase 6-2 블록 3 — «모든 기기 로그아웃». 권한 회수 버튼(revoke-button.tsx)과 같이 두 번 눌러야 나간다.
 * 권한은 그대로 두고 지금 열린 세션만 끊는다 — 폰을 잃어버렸을 때의 버튼이다.
 */
export function ForceLogoutButton({ userId, label }: { userId: string; label: string }) {
  const [state, setState] = useState<'idle' | 'armed' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setState('busy')
    setError(null)
    const result = await forceLogoutUser({ userId })
    if (result.error) {
      setError(result.error)
      setState('idle')
      return
    }
    setState('done')
  }

  if (error) {
    return (
      <span role="alert" className="text-[10.5px] text-critical">
        {error}
      </span>
    )
  }
  if (state === 'done') return <span className="text-[10.5px] text-ok">모든 기기에서 로그아웃했습니다</span>
  if (state === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setState('armed')}
        aria-label={`${label} 모든 기기 로그아웃`}
        className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10.5px] text-ink-muted transition-colors hover:border-warning/50 hover:text-warning"
      >
        <Icon name="log-out" className="size-3" />
        모든 기기 로그아웃
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={confirm}
        disabled={state === 'busy'}
        aria-label={`${label} 모든 기기 로그아웃 확인`}
        className="rounded-md bg-warning/20 px-2 py-1 text-[10.5px] font-semibold text-warning transition-opacity disabled:opacity-40"
      >
        {state === 'busy' ? '처리 중…' : '정말로 로그아웃'}
      </button>
      <button
        type="button"
        onClick={() => setState('idle')}
        disabled={state === 'busy'}
        className="rounded-md px-1.5 py-1 text-[10.5px] text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
      >
        취소
      </button>
    </span>
  )
}
