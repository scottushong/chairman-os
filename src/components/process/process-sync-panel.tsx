'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { syncProcessChart } from '@/app/actions/process-sync'

/**
 * «지금 동기화» 버튼 + 화면 열 때 동기화 (0071).
 *
 * 화면 열 때: 마지막 동기화(성공 · 실패)가 10분보다 오래됐으면(또는 없으면) 한 번 부른다. 판정은 서버 액션이 다시 한다 —
 * 여기 판정은 «부를 필요가 있어 보인다»는 힌트일 뿐이다(시계는 effect 안에서만 읽는다 — 렌더는 순수해야 한다). 렌더 중에 DB에 쓰지 않으려고 화면이 아니라 여기서 부른다.
 * 연결 전(서비스 계정 키 없음 · 탭에 시트 없음)이면 버튼이 꺼진다.
 */
export function ProcessSyncPanel({
  chartId,
  connected,
  lastSyncedAt,
}: {
  chartId: number
  connected: boolean
  lastSyncedAt: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const opened = useRef<number | null>(null)

  const run = (trigger: 'button' | 'open') => {
    startTransition(async () => {
      const state = await syncProcessChart(chartId, trigger)
      if (state.skipped) return
      if (state.error) {
        setMessage({ tone: 'error', text: state.error })
        return
      }
      if (state.result) {
        const r = state.result
        setMessage({
          tone: 'ok',
          text: `읽은 줄 ${r.read} · 새로 ${r.new} · 바뀜 ${r.changed} · 사라짐 ${r.gone} · 건너뜀 ${r.skipped} · 경고 ${r.warnings}`,
        })
      }
      router.refresh()
    })
  }

  useEffect(() => {
    const stale = !lastSyncedAt || Date.now() - Date.parse(lastSyncedAt) > 10 * 60_000
    if (!connected || !stale || opened.current === chartId) return
    opened.current = chartId
    run('open')
    // run은 매 렌더 새로 만들어지지만 탭 하나에 한 번만 부르면 된다(opened가 막는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartId, connected, lastSyncedAt])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setMessage(null)
          run('button')
        }}
        disabled={!connected || pending}
        className="rounded-md bg-accent px-3 py-1.5 text-t12 font-semibold text-app transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? '동기화 중…' : '지금 동기화'}
      </button>
      {message ? (
        <span className={`text-t11h ${message.tone === 'error' ? 'text-critical' : 'text-ink-dim'}`}>{message.text}</span>
      ) : null}
    </div>
  )
}
