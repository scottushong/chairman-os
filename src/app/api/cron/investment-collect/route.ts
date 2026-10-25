import { NextResponse, type NextRequest } from 'next/server'

import { isCronAuthorized } from '@/lib/cron-auth'
import { DATA_MODE } from '@/lib/env'
import { kstToday } from '@/lib/chairman-project'
import { analyzeAsAgent, collectAsIntegration } from '@/lib/investment/collect/service'

/**
 * /api/cron/investment-collect — Investment Intelligence 원천 수집(0094). vercel.json crons가 하루 한 번(06:30 KST) 부른다.
 * 입구 판정은 lib/cron-auth.ts(Authorization: Bearer ${CRON_SECRET}) · 수집은 Integration 계정, 그 뒤 분석은 AIAgent 계정(0095 — 계정 · 권한 분리).
 * 기존 아침 루틴(night-brief)과 별개다 — 그 경로를 건드리지 않는다. 응답에는 단계 · 호출 수만(숫자 · 비밀값 없음). dummy는 204.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (DATA_MODE === 'dummy') return new NextResponse(null, { status: 204, headers: { 'x-investment-collect': 'dummy' } })
  try {
    // 1) 수집(Integration 계정) — 시간 한도 200초. 2) AI 분석(AIAgent 계정 — 따로 로그인) — 남은 시간. 한쪽이 실패해도 다른 쪽 결과를 돌려준다.
    const out = await collectAsIntegration('cron', 200_000)
    const analysis = await analyzeAsAgent(kstToday()).catch((e: unknown) => ({ error: e instanceof Error ? e.message.slice(0, 200) : '분석 실패' }))
    return NextResponse.json(
      { ok: out.ok, run: out.runId, calls: out.calls, new_disclosures: out.newDisclosures, steps: out.steps.map((s) => ({ step: s.step, ok: s.ok, calls: s.calls, note: s.note })), analysis },
      { status: 200 },
    )
  } catch (e) {
    console.error('[cron investment-collect]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: '수집을 시작하지 못했습니다.' }, { status: 500 })
  }
}
