import { NextResponse, type NextRequest } from 'next/server'

import { isCronAuthorized } from '@/lib/cron-auth'
import { DATA_MODE } from '@/lib/env'
import { processRecalc } from '@/lib/finance-overview/recalc'
import { createSupabaseRepository } from '@/lib/repository/supabase'
import { signInServiceAccount } from '@/lib/supabase/service-account'

/**
 * /api/cron/fin-recalc — 재무 현황 다시 계산 큐(0085)의 재시도 입구. .github/workflows/fin-recalc.yml이 매시 20분에 부른다.
 * 입구 판정은 lib/cron-auth.ts(Authorization: Bearer ${CRON_SECRET}) · Job은 AI Agent 계정으로 로그인해서 돈다(야간 브리핑과 같은 길 —
 * service_role 아님). 응답에는 숫자를 싣지 않는다 — 일 수 · 달 수 · 실패 수만. dummy는 204(큐는 사람 세션이 돌린다).
 * 저장 직후 · 화면을 열 때도 같은 함수(processRecalc)가 돈다 — 여기는 그 둘이 놓친 일(끊긴 요청 · 실패)의 그물이다.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (DATA_MODE === 'dummy') return new NextResponse(null, { status: 204, headers: { 'x-fin-recalc': 'dummy' } })
  try {
    const { sb } = await signInServiceAccount({ emailEnv: 'AI_AGENT_EMAIL', passwordEnv: 'AI_AGENT_PASSWORD', role: 'AIAgent' })
    const out = await processRecalc(createSupabaseRepository(sb), { businessId: null, limit: 10, plRecord: false })
    return NextResponse.json(out, { status: 200 })
  } catch (e) {
    console.error('[cron fin-recalc]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: '다시 계산을 시작하지 못했습니다.' }, { status: 500 })
  }
}
