import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { KAKAO_STATE_COOKIE } from '@/lib/kakao/config'
import { authorizeUrl } from '@/lib/kakao/token'

/**
 * /api/kakao/auth — 카카오 로그인으로 보내는 입구 (Phase 3-C).
 *
 * state는 여기서 만들어 쿠키에도 심고 카카오에도 실어 보낸다. 돌아왔을 때 둘이 같아야
 * 우리가 시작한 흐름이다 — 남이 회장 브라우저로 자기 카카오 계정을 연결시키는
 * (로그인 CSRF) 길을 막는다.
 *
 * 쿠키는 httpOnly다. 이 값을 읽을 이유가 있는 코드는 /api/kakao/callback뿐이다.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    return NextResponse.json({ error: '카카오 연결은 Chairman만 할 수 있습니다.' }, { status: 403 })
  }

  let url: string
  const state = randomBytes(16).toString('hex')
  try {
    url = authorizeUrl(state)
  } catch (e) {
    // 환경변수가 빠진 채로 카카오에 가면 KOE006이 뜬다. 우리 화면에서 우리 말로 말한다.
    const reason = e instanceof Error ? e.message : String(e)
    return NextResponse.redirect(
      new URL(`/settings/chairman?kakao=config&reason=${encodeURIComponent(reason)}`, process.env.APP_BASE_URL ?? 'http://localhost:3000'),
    )
  }

  const res = NextResponse.redirect(url)
  res.cookies.set(KAKAO_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax', // 카카오에서 돌아오는 top-level GET에 실려야 한다. strict면 안 실린다.
    secure: process.env.NODE_ENV === 'production',
    path: '/api/kakao',
    maxAge: 600, // 10분. 카카오 화면에 머무는 시간이면 충분하다.
  })
  return res
}
