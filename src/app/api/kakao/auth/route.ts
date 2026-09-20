import { randomBytes } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

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

export async function GET(request: NextRequest) {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    // 여기서만 JSON 403이고 아래(config)부터는 리다이렉트다 — 이 분기는 회장의 '카카오 연결'
    // 버튼을 거치지 않은 흐름 밖 직접 호출에서만 뜬다. 그 아래는 전부 회장이 방금 그 버튼을
    // 눌러 자기 브라우저에서 도는 흐름이라, 결과가 /settings/chairman 화면에 문장으로 그려져야 한다.
    return NextResponse.json({ error: '카카오 연결은 Chairman만 할 수 있습니다.' }, { status: 403 })
  }

  let url: string
  const state = randomBytes(16).toString('hex')
  try {
    url = authorizeUrl(state)
  } catch (e) {
    // 환경변수가 빠진 채로 카카오에 가면 KOE006이 뜬다. 우리 화면에서 우리 말로 말한다.
    // 원인 문자열은 서버 로그에만 남긴다 — kakao-connect.tsx의 NOTICE['config']는 고정 문구라
    // 쿼리스트링에 실어 봐야 아무도 읽지 않고, 회장의 주소창에 내부 메시지만 남는다.
    console.error('[kakao] authorizeUrl', e instanceof Error ? e.message : String(e))
    // fallback이 localhost:3000이면 이 분기가 실제로 뜨는 유일한 배포(Preview — OPERATIONS가
    // 카카오 환경변수를 넣지 말라고 정한 곳)에서 회장을 남의 기계로 보낸다. 요청이 들어온
    // 호스트로 되돌리면 Preview에서도 같은 화면으로 돌아온다. production은 APP_BASE_URL이
    // 늘 있으므로 동작이 바뀌지 않는다.
    return NextResponse.redirect(
      new URL('/settings/chairman?kakao=config', process.env.APP_BASE_URL ?? request.nextUrl.origin),
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
