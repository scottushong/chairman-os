import { NextResponse } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { kstToday, orderProjects, projectClock } from '@/lib/chairman-project'
import { sendKakaoBrief } from '@/lib/kakao/send-brief'
import { getRepository } from '@/lib/repository'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * /api/kakao/test — '테스트 발송' (Phase 3-C).
 *
 * 야간 Job과 **같은 sendKakaoBrief()**를 부른다. 다른 경로로 보내면 여기서 성공해도
 * 아침에 성공한다는 보장이 없다 — 수동 실행이 Cron과 같은 route를 지나게 한 것과 같은 이유다.
 *
 * 다른 것은 세 가지다. 회장 세션으로 돌고(야간 Job은 AIAgent), summary가 오늘 브리핑이 아니라
 * 고정 문장이며, 감사 기록의 trigger가 'test'다.
 */
export const dynamic = 'force-dynamic'

const SAMPLE =
  '테스트 발송입니다. 실제 아침 알림은 이 자리에 야간 브리핑의 앞 두세 문장이 들어갑니다. ' +
  '버튼을 눌러 전문이 열리는지 확인하세요.'

export async function POST() {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    return NextResponse.json({ error: '테스트 발송은 Chairman만 할 수 있습니다.' }, { status: 403 })
  }

  const today = kstToday()
  // 머리글이 실제와 같아야 테스트가 의미가 있다 — 야간 Job과 같은 고르기를 쓴다.
  const repo = await getRepository()
  const active = orderProjects(await repo.listChairmanProjects()).filter((p) => p.status === 'Active')
  const lead = active[0] ?? null

  const sb = await createSupabaseServerClient()
  const result = await sendKakaoBrief({
    sb,
    actorUserId: user.user_id,
    actorRole: 'Chairman',
    runDate: today,
    summary: SAMPLE,
    dDay: lead ? projectClock(lead, today).label : null,
    projectTitle: lead?.title ?? null,
    trigger: 'test',
  })

  return NextResponse.json(result, { status: result.sent ? 200 : 502 })
}
