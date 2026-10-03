import { NextResponse, type NextRequest } from 'next/server'

import type { AiAdapter } from '@/lib/ai/adapter'
import { createAnthropicAdapter } from '@/lib/ai/anthropic'
import { decideBriefTickNow } from '@/lib/ai/brief-tick'
import { runNightBrief, type NightBriefTrigger } from '@/lib/ai/night-brief'
import { currentUser } from '@/lib/auth/session'
import { isCronAuthorized } from '@/lib/cron-auth'
import type { IsoDate } from '@/types'

/**
 * /api/cron/night-brief — 야간 브리핑 Job의 입구 (Phase 3-A 블록 3).
 *
 *   GET ?tick=1  GitHub Actions 틱. .github/workflows/chairman-tick.yml이 매시 정각 UTC에 부른다.
 *                Authorization: Bearer ${CRON_SECRET} 을 실어 보낸다. 그 외에는 401.
 *                (헤더 판정은 lib/cron-auth.ts 하나다 — Vercel Cron 때 쓰던 것 그대로다.)
 *   GET (tick 없음)  **400이다.** 아래 머리 주석 ②를 본다.
 *   POST         /ai 화면의 '수동 실행'(테스트용). 요청자의 세션이 Chairman일 때만 돈다.
 *
 * 누가 부르든 Job은 AI Agent 계정으로 로그인해서 돈다(lib/ai/night-brief.ts ①).
 * 여기서 확인하는 것은 '이 Job을 시작해도 되는가'까지다.
 *
 * proxy matcher에서 이 경로를 뺐다. Cron 요청에는 로그인 쿠키가 없어 /login으로 튕기기 때문이다.
 *
 * ---------------------------------------------------------------------------
 * Phase 3-C 현지 시간 (2026-09-21) — 무엇이 바뀌었나
 *
 * ① **시각이 고정에서 판정으로 바뀌었다.** 예전에는 vercel.json의 cron이 하루 한 번
 *    22:00 UTC(=07:00 KST)에 불렀고, 불렸다는 사실 자체가 곧 '지금이 그때다'였다.
 *    이제는 매시 틱이 오고, **회장 현지 06:00~09:59 창 안이고 오늘 것을 아직 안 했을 때만**
 *    돈다. 나머지 틱은 204로 조용히 끝난다 — 하루 스물네 번 중 스물세 번이 그쪽이다.
 *
 *    창이 한 시간이 아니라 네 시간인 이유는 GitHub Actions의 schedule이 정시에 오지 않기
 *    때문이다(몇 분에서 수십 분). `hour === 6`만 보면 07:04에 도착한 틱이 그날을 통째로
 *    건너뛴다. 정책 전체는 lib/chairman-timezone.ts에 적혀 있고 npm run check:schedule이 잰다.
 *
 * ② **tick이 없는 GET은 400이다.** 하위 호환으로 열어 두고 싶은 모양이지만, 그렇게 두면
 *    Vercel cron을 지운 뒤 누군가(옛 문서, 옛 모니터링, 손버릇) 옛 방식으로 부를 때
 *    그것이 **조용한 중복 발송**이 된다. 같은 날 아침에 카톡이 두 번 가고, 브리핑 행도
 *    두 벌 생기고, 아무 데도 오류가 안 남는다. 문을 열어 두는 대신 문패를 단다.
 *
 * ③ **204는 성공이다.** 워크플로의 curl이 그것을 실패로 읽지 않게 되어 있다. 판정 근거는
 *    응답 헤더(x-brief-*)로 같이 내보낸다 — 본문이 없는 상태 코드라 거기 말고는 적을 자리가
 *    없고, "왜 오늘은 안 왔지"를 `curl -i` 한 번으로 답할 수 있어야 한다.
 * ---------------------------------------------------------------------------
 */

export const dynamic = 'force-dynamic'
// 회사 다섯 곳 + 그룹 1회 모델 호출. 동시에 부르지만 모델 응답이 길면 수십 초가 걸린다.
export const maxDuration = 300

async function run(
  trigger: NightBriefTrigger,
  requestedBy?: string,
  local?: { timezone: string; localDate: IsoDate },
) {
  let adapter: AiAdapter | null = null
  let adapterError: string | undefined
  try {
    adapter = createAnthropicAdapter()
  } catch (e) {
    // 키가 없어도 Job은 돈다 — 회사마다 Failed가 남아야 아침에 '왜 비었나'가 보인다.
    adapterError = e instanceof Error ? e.message : String(e)
  }

  const report = await runNightBrief({ adapter, adapterError, trigger, requestedBy, local })
  // 기록 자체를 못 남긴 경우만 실패 코드로 돌려준다. 회사별 실패는 이미 행으로 남았다.
  const status = report.inserted === 0 ? 500 : 200
  return NextResponse.json(report, { status })
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('tick') !== '1') {
    // 머리 주석 ②. 400의 본문이 다음 사람에게 고칠 방법을 말한다.
    return NextResponse.json(
      {
        error: '이 경로는 이제 틱으로 부릅니다.',
        hint: 'GET /api/cron/night-brief?tick=1 로 매시 정각 부르세요 (.github/workflows/chairman-tick.yml).',
      },
      { status: 400 },
    )
  }

  const decision = await decideBriefTickNow()

  if (decision.error) {
    // 재료를 못 읽었다. 시간대를 모르는 채로 보내면 엉뚱한 시각에 간다 — 아무것도 하지 않고
    // 틱을 빨갛게 끝낸다. 다음 시간에 다시 온다(워크플로에 재시도를 넣지 않은 이유다).
    return NextResponse.json({ error: decision.error, outcome: decision.outcome }, { status: 500 })
  }

  if (!decision.send) {
    return new NextResponse(null, { status: 204, headers: tickHeaders(decision) })
  }

  return run('cron', undefined, { timezone: decision.timezone, localDate: decision.localDate })
}

/** 본문 없는 204에 판정 근거를 싣는다. `curl -i` 한 번으로 "왜 오늘은 안 왔지"에 답한다. */
function tickHeaders(decision: Awaited<ReturnType<typeof decideBriefTickNow>>): HeadersInit {
  return {
    'x-brief-outcome': decision.outcome,
    'x-brief-timezone': decision.timezone,
    'x-brief-timezone-source': decision.source,
    'x-brief-local-date': decision.localDate,
    'x-brief-local-hour': String(decision.localHour),
  }
}

export async function POST() {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  // local을 넘기지 않는다. 수동 실행은 카톡을 보내지 않고(night-brief.ts ④) 장부도 건드리지
  // 않는다 — 회장이 낮에 버튼을 눌렀다고 다음 날 아침이 조용히 사라지면 안 된다.
  return run('manual', user.name)
}
