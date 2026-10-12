import { NextResponse, type NextRequest } from 'next/server'

import { isCronAuthorized } from '@/lib/cron-auth'
import { sheetsConnected, syncAllCharts } from '@/lib/process-sync/service'

/**
 * /api/cron/process-sync — 프로세스 차트 새벽 동기화 (0071). vercel.json의 cron이 하루 한 번(03:00 KST = 18:00 UTC) 부른다.
 *
 * 입구 판정은 다른 cron과 같은 lib/cron-auth.ts(Authorization: Bearer ${CRON_SECRET}) — Vercel Cron이 그 헤더를 싣는다.
 * 값은 env에만 있다(CRON_SECRET). 없으면 누구도 통과하지 못한다.
 * Job은 AI Agent 계정으로 로그인해서 돈다(야간 브리핑과 같은 길 — service_role 아님). 시트 내용은 응답에 싣지 않는다 —
 * 탭마다 성공 여부와 사람 말 오류만. proxy matcher가 /api/cron을 이미 뺀다(로그인 쿠키 없음).
 *
 * 서비스 계정 키(GOOGLE_SHEETS_SA_JSON)가 없으면 204 — «연결 전»은 고장이 아니다.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!sheetsConnected()) {
    return new NextResponse(null, { status: 204, headers: { 'x-process-sync': 'not-connected' } })
  }
  try {
    const results = await syncAllCharts()
    const failed = results.filter((r) => !r.ok).length
    return NextResponse.json({ charts: results.length, failed, results }, { status: 200 })
  } catch (e) {
    // 로그인 · 목록 읽기 실패. 비밀값을 싣지 않는 문장만 남긴다.
    console.error('[cron process-sync]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: '동기화를 시작하지 못했습니다.' }, { status: 500 })
  }
}
