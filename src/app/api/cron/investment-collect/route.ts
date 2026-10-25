import { NextResponse, type NextRequest } from 'next/server'

import { isCronAuthorized } from '@/lib/cron-auth'
import { DATA_MODE } from '@/lib/env'
import { collectAsIntegration } from '@/lib/investment/collect/service'

/**
 * /api/cron/investment-collect — Investment Intelligence 원천 수집(0094). vercel.json crons가 하루 한 번(06:30 KST) 부른다.
 * 입구 판정은 lib/cron-auth.ts(Authorization: Bearer ${CRON_SECRET}) · 수집은 Integration 계정(수집 전용 — AI 분석 계정과 따로).
 * 기존 아침 루틴(night-brief)과 별개다 — 그 경로를 건드리지 않는다. 응답에는 단계 · 호출 수만(숫자 · 비밀값 없음). dummy는 204.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (DATA_MODE === 'dummy') return new NextResponse(null, { status: 204, headers: { 'x-investment-collect': 'dummy' } })
  try {
    const out = await collectAsIntegration('cron')
    return NextResponse.json({ ok: out.ok, run: out.runId, calls: out.calls, new_disclosures: out.newDisclosures, steps: out.steps.map((s) => ({ step: s.step, ok: s.ok, calls: s.calls, note: s.note })) }, { status: 200 })
  } catch (e) {
    console.error('[cron investment-collect]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: '수집을 시작하지 못했습니다.' }, { status: 500 })
  }
}
