import 'server-only'

import type { ChairmanRepository } from '@/lib/repository'
import type { PriceRun } from '@/types'

import { dispatchPriceReport, dispatchReady } from './dispatch'
import { REQUEST_ERROR_KO } from './rules'

/**
 * «지금 업데이트» 한 번: ① DB RPC(권한 · 수집 중 잠김 · 10분 · 하루 n번 → 실행 기록 «대기» + 감사) → ② GitHub workflow_dispatch(run_id) →
 * 호출이 실패하면 그 기록을 «실패»(오류 한 줄)로 — 직전 리포트는 그대로. 서버 액션과 check:price-report가 같은 함수를 부른다.
 */
export async function requestPriceReport(repo: ChairmanRepository, businessId: string, perDay: number, fetchImpl?: typeof fetch): Promise<{ runId?: string; error?: string }> {
  if (!dispatchReady()) return { error: '설정 전 — 자동 업데이트(08 · 18시)만 됩니다.' }
  let runId: string
  try {
    runId = await repo.priceReportRequest(businessId, perDay)
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    const k = Object.keys(REQUEST_ERROR_KO).find((x) => m.includes(x))
    return { error: k ? REQUEST_ERROR_KO[k] : '업데이트를 시작하지 못했습니다.' }
  }
  const sent = await dispatchPriceReport(runId, fetchImpl)
  if (!sent.ok) {
    await repo.priceReportDispatchFailed(runId, sent.error).catch((e) => console.error('[price-report] dispatch_failed', e))
    return { runId, error: `${sent.error} — 직전 리포트를 그대로 둡니다.` }
  }
  return { runId }
}

export interface PollResult {
  status: PriceRun['status'] | 'unknown'
  error: string | null
  reportId: string | null
  newEvents: number | null
  points: number | null
}

/** 15초마다 화면이 부르는 상태 확인 — 실행 기록 하나(읽기 RLS 안). */
export async function pollPriceReport(repo: ChairmanRepository, businessId: string, runId: string): Promise<PollResult> {
  const run = (await repo.listPriceRuns(businessId, 20)).find((r) => r.run_id === runId)
  if (!run) return { status: 'unknown', error: null, reportId: null, newEvents: null, points: null }
  return { status: run.status, error: run.error, reportId: run.report_id, newEvents: run.new_events, points: run.points }
}
