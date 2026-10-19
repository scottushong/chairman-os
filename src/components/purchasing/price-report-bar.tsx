'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { pollPriceReportUpdate, requestPriceReportUpdate } from '@/app/actions/price-report'

/**
 * 가격 리포트 맨 위 줄 — 마지막 업데이트 · 회차 · 상태 · 다음 자동 시각 · «지금 업데이트».
 * 누르면 ① DB가 권한 · 잠김 · 10분 · 하루 n번 판정 → ② 서버가 GitHub Actions 실행 → ③ «수집 중 — 보통 3~5분», 15초마다 상태 →
 * ④ 완료면 새 리포트로 전환 + «새 사건 n건 · 가격 갱신» ⑤ 실패면 오류 한 줄 + 직전 리포트 그대로.
 */
export function PriceReportBar(props: {
  businessId: string
  last: { label: string; slot: string; status: 'ok' | 'unconfirmed' } | null
  /** null = 자동 회차 꺼짐(2026-10-20 — 손으로만) */
  nextAuto: string | null
  /** null = 버튼 없음(권한 없음) */
  canRequest: boolean
  /** GITHUB_DISPATCH_TOKEN 있음 */
  ready: boolean
  /** 화면이 본 잠김 이유(DB가 한 번 더 판정) */
  lock: string | null
  /** 이미 «대기 · 수집 중»인 실행 */
  liveRunId: string | null
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [runId, setRunId] = useState<string | null>(props.liveRunId)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(props.liveRunId ? { tone: 'info', text: '수집 중 — 보통 3~5분' } : null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!runId) return
    const tick = async () => {
      const r = await pollPriceReportUpdate(props.businessId, runId)
      if (r.status === 'done') {
        setRunId(null)
        setMsg({ tone: 'ok', text: `새 리포트 — 새 사건 ${r.newEvents ?? 0}건 · 가격 갱신 ${r.points ?? 0}점` })
        router.push(`/purchasing/${encodeURIComponent(props.businessId)}/price-report${r.reportId ? `?r=${r.reportId}` : ''}`)
        router.refresh()
      } else if (r.status === 'failed') {
        setRunId(null)
        setMsg({ tone: 'err', text: `이번 업데이트 실패 — ${r.error ?? '이유 모름'} · 직전 리포트를 그대로 둡니다.` })
        router.refresh()
      }
    }
    timer.current = setInterval(tick, 15_000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [runId, props.businessId, router])

  const locked = !!runId || !!props.lock
  return (
    <section className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line-soft bg-panel px-3 py-2 text-t12" data-testid="price-report-bar">
      <span>
        <span className="text-ink-muted">마지막 업데이트 </span>
        <span className="font-semibold tnum">{props.last ? props.last.label : '아직 없음'}</span>
        {props.last ? (
          <>
            <span className="text-ink-muted"> · {props.last.slot} · </span>
            <span className={props.last.status === 'ok' ? 'font-semibold text-ok' : 'font-semibold text-gold'}>{props.last.status === 'ok' ? '정상' : '미확인'}</span>
          </>
        ) : null}
      </span>
      {props.nextAuto ? (
        <span>
          <span className="text-ink-muted">다음 자동 </span>
          <span className="tnum">{props.nextAuto}</span>
          <span className="text-t10 text-ink-muted"> (매일 08 · 18시)</span>
        </span>
      ) : (
        <span className="text-ink-muted" data-testid="price-report-auto-off">
          자동 업데이트 꺼짐 — «지금 업데이트»로 받습니다
        </span>
      )}
      {props.canRequest ? (
        props.ready ? (
          <button
            type="button"
            disabled={busy || locked}
            title={props.lock ?? undefined}
            onClick={() =>
              start(async () => {
                setMsg(null)
                const r = await requestPriceReportUpdate(props.businessId)
                if (r.error) {
                  setMsg({ tone: 'err', text: r.error })
                  router.refresh()
                } else if (r.runId) {
                  setRunId(r.runId)
                  setMsg({ tone: 'info', text: '수집 중 — 보통 3~5분' })
                }
              })
            }
            className="ml-auto min-h-10 rounded-md bg-accent px-4 text-t12 font-semibold text-white disabled:opacity-40"
            data-testid="price-report-update"
          >
            {runId ? '수집 중…' : busy ? '시작하는 중…' : '지금 업데이트'}
          </button>
        ) : (
          <span className="ml-auto text-t11h text-ink-muted" data-testid="price-report-not-ready">
            {props.nextAuto ? '설정 전 — 자동 업데이트만 됩니다' : '설정 전 — 업데이트 버튼 준비 중'}
          </span>
        )
      ) : null}
      {props.canRequest && props.ready && props.lock && !runId ? <span className="w-full text-right text-t10h text-ink-muted">{props.lock}</span> : null}
      {msg ? (
        <p role="status" className={`w-full text-t11h ${msg.tone === 'err' ? 'text-critical' : msg.tone === 'ok' ? 'text-ok' : 'text-ink-dim'}`}>
          {msg.text}
        </p>
      ) : null}
    </section>
  )
}
