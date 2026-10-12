'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { sheetsConnected, syncChartFor } from '@/lib/process-sync/service'
import type { ProcessSyncResult } from '@/lib/process-sync/run'
import { getRepository } from '@/lib/repository'

/**
 * 프로세스 차트 «지금 동기화» · 화면 열 때 동기화 (0071).
 *
 * 탭은 **그 사람 세션으로** 읽는다(repo.listProcessCharts — 0071 정책이 자기 팀 탭만 준다). 못 보는 탭은 여기서 끝난다.
 * 넣기는 AI Agent 세션이 한다(lib/process-sync/service.ts) — 사람 세션은 동기화 RPC를 못 부른다.
 *   button  누를 때마다. 같은 팀 1분에 1번은 DB가 막는다(process_sync_too_soon).
 *   open    화면이 열렸고 마지막 동기화가 10분보다 오래됐을 때만. 아니면 아무것도 하지 않는다(skipped).
 */

export interface ProcessSyncState {
  error?: string
  result?: ProcessSyncResult
  skipped?: boolean
}

const OPEN_STALE_MS = 10 * 60_000

export async function syncProcessChart(chartId: unknown, trigger: unknown): Promise<ProcessSyncState> {
  const id = Number(chartId)
  const kind = trigger === 'open' ? 'open' : 'button'
  if (!Number.isSafeInteger(id) || id <= 0) return { error: '동기화할 탭을 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  // 0073 기능 스위치 «프로세스 차트» — 꺼져 있으면 동기화도 거부.
  if (!(await featureOn(user, 'process_charts'))) return { error: '지금은 쓸 수 없는 기능입니다.' }
  if (!sheetsConnected()) return { error: '구글 시트 연결 전입니다.' }

  const repo = await getRepository()
  const chart = (await repo.listProcessCharts()).find((c) => c.id === id)
  if (!chart) return { error: '이 탭을 볼 수 없습니다.' }
  if (!chart.sheet_id) return { error: '이 탭에는 아직 시트가 연결되지 않았습니다(연결 전).' }

  if (kind === 'open') {
    const last = (await repo.listProcessChartSyncs(200)).find(
      (s) => s.business_id === chart.business_id && s.team_name === chart.team_name,
    )
    if (last && Date.now() - Date.parse(last.synced_at) < OPEN_STALE_MS) return { skipped: true }
  }

  const outcome = await syncChartFor(
    { chart_id: chart.id, business_id: chart.business_id, team_name: chart.team_name, sheet_id: chart.sheet_id ?? null, sheet_tab: chart.sheet_tab ?? null },
    kind,
    user.user_id,
  )
  // 화면 열 때 동기화가 1분 제한에 걸린 것은 오류가 아니다 — 다른 사람이 방금 했다.
  if (!outcome.ok && kind === 'open' && /1분에 한 번/.test(outcome.error)) return { skipped: true }

  revalidatePath('/process-charts')
  revalidatePath('/tasks')
  revalidatePath('/calendar')
  return outcome.ok ? { result: outcome.result } : { error: outcome.error }
}
