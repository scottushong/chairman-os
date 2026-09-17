'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Icon } from '@/components/ui/icon'

/**
 * 야간 브리핑 '수동 실행' (Phase 3-A, 테스트용). Chairman에게만 그려진다.
 *
 * Cron과 같은 route(/api/cron/night-brief)를 POST로 부른다. 같은 입구를 지나야
 * 수동 실행이 통과했다는 사실이 Cron도 통과한다는 뜻이 된다.
 * 권한은 버튼을 숨기는 것으로 끝나지 않는다 — route가 세션 역할을 다시 본다.
 */

interface RunResult {
  inserted?: number
  done?: number
  failed?: number
  error?: string
}

export function RunNightBrief() {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(
    null,
  )

  async function run() {
    setRunning(true)
    setMessage(null)
    try {
      const res = await fetch('/api/cron/night-brief', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as RunResult
      if (!res.ok && !body.inserted) {
        setMessage({ tone: 'error', text: body.error ?? `실행 실패 (HTTP ${res.status})` })
      } else {
        const failed = body.failed ?? 0
        setMessage({
          tone: failed ? 'warn' : 'ok',
          text: `기록 ${body.inserted ?? 0}건 · 완료 ${body.done ?? 0} · 실패 ${failed}${
            body.error ? ` · ${body.error}` : ''
          }`,
        })
      }
      startTransition(() => router.refresh())
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : '실행 요청 실패' })
    } finally {
      setRunning(false)
    }
  }

  const busy = running || refreshing
  const tone =
    message?.tone === 'ok' ? 'text-ok' : message?.tone === 'warn' ? 'text-warning' : 'text-critical'

  return (
    <div className="flex items-center gap-2">
      {message ? (
        <span role="status" className={`text-[11px] tnum ${tone}`}>
          {message.text}
        </span>
      ) : null}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="테스트용. 매일 23:00 KST Cron과 같은 Job을 지금 한 번 돌립니다."
        className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:cursor-wait disabled:opacity-60"
      >
        <Icon name="sparkles" className={`size-3.5 text-gold ${busy ? 'animate-pulse' : ''}`} />
        {running ? '실행 중… (1분 안팎)' : refreshing ? '불러오는 중…' : '수동 실행'}
      </button>
    </div>
  )
}
