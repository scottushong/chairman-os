'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { closePeriod } from '@/app/actions/books'

/**
 * "N월 마감" (Phase 2-B 블록 3). Chairman · Group CFO에게만 보인다 — 안내다. 실제 문은 0016 close_period().
 *
 * 마감 해제가 없어서 한 번 더 묻는다. 브라우저 confirm()을 쓰지 않는다 — 화면 안에서 두 번째 버튼으로 묻는다.
 * 마감이 끝나면 서버가 다시 그린 재무 화면의 꼬리표가 잠정 → 확정으로 바뀐다.
 */
export function CloseMonth({ businessId, period }: { businessId: string; period: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const [y, m] = period.split('-')
  const label = `${Number(m)}월`

  async function close() {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await closePeriod({ businessId, period })
    setBusy(false)
    setConfirming(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setDone(`${y}년 ${label} 마감 완료 — 결산 ${result.cells ?? 0}칸, 꼬리표가 확정으로 바뀝니다.`)
    router.refresh()
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-[11.5px] text-warning">
          <span>
            {y}년 {label}을 마감합니다. 해제할 수 없고, 이후엔 정정 전표로만 바로잡습니다.
          </span>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded bg-warning px-2 py-0.5 text-[11px] font-semibold text-ink disabled:opacity-40"
          >
            {busy ? '마감 중…' : '마감 확정'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded px-1.5 py-0.5 text-[11px] text-ink-dim hover:text-ink disabled:opacity-40"
          >
            취소
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setDone(null)
            setConfirming(true)
          }}
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] font-semibold text-ink transition-colors hover:border-accent"
        >
          {label} 마감
        </button>
      )}
      {error ? (
        <p role="alert" className="text-[11px] text-critical">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-[11px] text-ink-dim">
          {done}
        </p>
      ) : null}
    </div>
  )
}
