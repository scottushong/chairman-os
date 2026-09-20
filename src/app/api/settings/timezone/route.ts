import { NextResponse } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { isValidTimezone } from '@/lib/chairman-timezone'
import { getRepository } from '@/lib/repository'

/**
 * /api/settings/timezone — 아침 알림의 ① '마지막 접속 기기의 시간대' (Phase 3-C 현지 시간).
 *
 * 브라우저만 아는 값이라 브라우저가 알려 주는 수밖에 없다. 클라이언트가
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` 하나를 실어 보내고, 여기서
 * user_settings.current_tz에 적는다(0029 1절). 보내는 쪽은 components/settings/timezone-beacon.tsx다.
 *
 * 자기 행에만 닿는다 — 0002 user_settings_own이 `user_id = auth.uid()`로 그것을 지킨다.
 * 회장이 아닌 사람이 보낸 값도 그대로 자기 행에 적힌다. 쓸 데는 없지만 막을 이유도 없고,
 * 역할을 여기서 따지면 "회장인지 아닌지"를 판정하는 자리가 하나 더 늘어난다.
 *
 * 실패는 조용하다. 이 요청이 실패한다고 사용자가 할 일은 없고, 시간대는 ②나 기본값으로
 * 이어진다 — 화면에 오류를 띄우면 아무도 고칠 수 없는 경고만 남는다.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { timezone?: unknown }
  const tz = typeof body.timezone === 'string' ? body.timezone.trim() : ''
  // Intl이 모르는 문자열은 받지 않는다. 0029의 check 제약은 모양만 보므로 실재 여부를
  // 아는 자리는 여기뿐이고, 여기서 새면 그 값이 매일 아침 판정의 입력이 된다.
  if (!isValidTimezone(tz)) return NextResponse.json({ error: 'invalid timezone' }, { status: 400 })

  try {
    const repo = await getRepository()
    await repo.saveCurrentTimezone(tz)
  } catch (e) {
    console.error('[settings/timezone]', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'save failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, timezone: tz })
}
