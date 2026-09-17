import { NextResponse, type NextRequest } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { isCronAuthorized } from '@/lib/cron-auth'
import { runEcountSync } from '@/lib/ecount/sync'

/**
 * /api/cron/ecount-sync — ECOUNT 동기화의 단독 입구 (Phase 2-A).
 *
 *   GET   CRON_SECRET을 실은 스케줄러. vercel.json에는 **등록하지 않았다** — Hobby는 Cron이 하루 1개이고
 *         그 자리는 야간 브리핑이 쓴다. 매일 동기화는 /api/cron/night-brief가 먼저 이 Job을 돌려서 한다.
 *         1시간 주기가 필요하면 Pro 전환 또는 외부 스케줄러가 이 GET을 부른다(DEFERRED D-20).
 *   POST  수동 실행. 요청자의 세션이 Chairman일 때만.
 *
 * 누가 부르든 쓰기는 Integration 계정으로 한다(lib/ecount/sync.ts).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function run(trigger: 'cron' | 'manual', requestedBy?: string) {
  const report = await runEcountSync({ trigger, requestedBy })
  // mock의 검증 실행은 실패가 아니다. real에서 한 회사도 못 쓴 경우만 실패 코드다.
  const status = report.mode === 'real' && !report.wrote ? 500 : 200
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
    return NextResponse.json({ error: '수동 동기화는 Chairman만 할 수 있습니다.' }, { status: 403 })
  }
  return run('manual', user.name)
}
