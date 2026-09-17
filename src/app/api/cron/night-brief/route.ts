import { NextResponse, type NextRequest } from 'next/server'

import type { AiAdapter } from '@/lib/ai/adapter'
import { createAnthropicAdapter } from '@/lib/ai/anthropic'
import { runNightBrief, type NightBriefTrigger } from '@/lib/ai/night-brief'
import { currentUser } from '@/lib/auth/session'
import { isCronAuthorized } from '@/lib/cron-auth'

/**
 * /api/cron/night-brief — 야간 브리핑 Job의 입구 (Phase 3-A 블록 3).
 *
 *   GET   Vercel Cron. vercel.json이 매일 14:00 UTC(23:00 KST)에 부른다.
 *         Vercel이 Authorization: Bearer ${CRON_SECRET} 을 실어 보낸다. 그 외에는 401.
 *         (Phase 2-A에서 이 앞에 ECOUNT 동기화를 붙였다가 2-B에서 걷어냈다 — 회계 원천은 자체 장부다.)
 *   POST  /ai 화면의 '수동 실행'(테스트용). 요청자의 세션이 Chairman일 때만 돈다.
 *
 * 누가 부르든 Job은 AI Agent 계정으로 로그인해서 돈다(lib/ai/night-brief.ts ①).
 * 여기서 확인하는 것은 '이 Job을 시작해도 되는가'까지다.
 *
 * proxy matcher에서 이 경로를 뺐다. Cron 요청에는 로그인 쿠키가 없어 /login으로 튕기기 때문이다.
 */

export const dynamic = 'force-dynamic'
// 회사 다섯 곳 + 그룹 1회 모델 호출. 동시에 부르지만 모델 응답이 길면 수십 초가 걸린다.
export const maxDuration = 300

async function run(trigger: NightBriefTrigger, requestedBy?: string) {
  let adapter: AiAdapter | null = null
  let adapterError: string | undefined
  try {
    adapter = createAnthropicAdapter()
  } catch (e) {
    // 키가 없어도 Job은 돈다 — 회사마다 Failed가 남아야 아침에 '왜 비었나'가 보인다.
    adapterError = e instanceof Error ? e.message : String(e)
  }

  const report = await runNightBrief({ adapter, adapterError, trigger, requestedBy })
  // 기록 자체를 못 남긴 경우만 실패 코드로 돌려준다. 회사별 실패는 이미 행으로 남았다.
  const status = report.inserted === 0 ? 500 : 200
  return NextResponse.json(report, { status })
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return run('cron')
}

export async function POST() {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    return NextResponse.json({ error: '수동 실행은 Chairman만 할 수 있습니다.' }, { status: 403 })
  }
  return run('manual', user.name)
}
