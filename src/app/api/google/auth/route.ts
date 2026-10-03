import { randomBytes } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { DATA_MODE } from '@/lib/env'
import { GOOGLE_STATE_COOKIE } from '@/lib/google/config'
import { authorizeUrl } from '@/lib/google/token'

/**
 * /api/google/auth — 회장 Gmail 읽기 전용 연결의 입구 (Phase 9 블록 4).
 * /api/kakao/auth와 같은 모양: state를 쿠키와 Google 양쪽에 실어 보내고, 돌아왔을 때 맞춘다
 * (남이 회장 브라우저로 자기 Google 계정을 연결시키는 로그인 CSRF를 막는다).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // dummy 모드의 가상 회장으로 실제 Google 교환과 Supabase 저장을 돌리지 않는다.
  if (DATA_MODE === 'dummy') {
    return NextResponse.redirect(new URL('/mail?google=config', process.env.APP_BASE_URL ?? request.nextUrl.origin))
  }
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const base = process.env.APP_BASE_URL ?? request.nextUrl.origin
  const state = randomBytes(16).toString('hex')
  let url: string
  try {
    url = authorizeUrl(state)
  } catch (e) {
    console.error('[google] authorizeUrl', e instanceof Error ? e.message : String(e))
    return NextResponse.redirect(new URL('/mail?google=config', base))
  }

  const res = NextResponse.redirect(url)
  res.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/google',
    maxAge: 600,
  })
  return res
}
