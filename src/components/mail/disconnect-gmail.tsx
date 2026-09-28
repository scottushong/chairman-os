'use client'

import { useState, useTransition } from 'react'

import { disconnectGmail } from '@/app/actions/google'

/** Gmail 연결 해제. 우리가 가진 토큰만 버린다 — Google 쪽 권한 취소는 계정 설정에서. */
export function DisconnectGmail() {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-[11px] text-critical">{error}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await disconnectGmail()
            if (r.error) setError(r.error)
          })
        }
        className="rounded-md border border-line bg-raised px-2.5 py-1.5 text-[11.5px] text-ink-dim hover:text-ink disabled:opacity-50"
        title="Google 계정 › 보안 › 타사 앱에서 권한까지 거둘 수 있습니다."
      >
        연결 해제
      </button>
    </span>
  )
}
