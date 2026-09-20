import { timingSafeEqual } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { KAKAO_STATE_COOKIE, requireKakaoConfig } from '@/lib/kakao/config'
import { canSendMessage, exchangeCode } from '@/lib/kakao/token'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * /api/kakao/callback — 카카오가 인가코드를 들고 돌려보내는 자리 (Phase 3-C).
 *
 * 항상 /settings/chairman으로 되돌린다. JSON을 보여 주는 화면이 아니라 회장이 버튼을
 * 누르고 돌아오는 자리라서, 결과는 ?kakao=... 한 낱말로 싣고 화면이 문장을 고른다.
 *
 * 토큰은 이 함수 안에서만 산다. 0023 kakao_token_save()로 넘기고 나면 변수도 응답도
 * 그 값을 들고 있지 않다 — 리다이렉트 URL에도, 로그에도 싣지 않는다.
 */
export const dynamic = 'force-dynamic'

/**
 * 결과 한 낱말을 달고 /settings/chairman으로 되돌린다.
 *
 * APP_BASE_URL이 없으면 요청이 들어온 호스트로 돌아간다. 상수 localhost:3000이면 그 fallback이
 * 실제로 쓰이는 유일한 배포(Preview — OPERATIONS가 카카오 환경변수를 넣지 말라고 정한 곳)에서
 * 회장을 남의 기계로 보낸다. production은 APP_BASE_URL이 늘 있으므로 동작이 바뀌지 않는다.
 */
function back(request: NextRequest, reason: string): NextResponse {
  const base = process.env.APP_BASE_URL ?? request.nextUrl.origin
  const res = NextResponse.redirect(new URL(`/settings/chairman?kakao=${reason}`, base))
  // 한 번 쓴 state는 결과가 무엇이든 버린다.
  res.cookies.set(KAKAO_STATE_COOKIE, '', { path: '/api/kakao', maxAge: 0 })
  return res
}

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function GET(request: NextRequest) {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    // JSON 403은 여기뿐이고 아래 실패들은 전부 back()으로 리다이렉트한다 — 일부러 다르다.
    // 이 분기는 카카오가 아니라 남이 이 콜백 URL을 직접 두드릴 때만 뜬다(회장 흐름 밖).
    // 아래(state/save/forbidden/failed)는 회장이 방금 카카오 화면에서 돌아온 자기 브라우저 안이라
    // JSON이 아니라 /settings/chairman 화면의 문장으로 보여야 한다.
    return NextResponse.json({ error: '카카오 연결은 Chairman만 할 수 있습니다.' }, { status: 403 })
  }

  const params = request.nextUrl.searchParams
  // 회장이 카카오 화면에서 '취소'를 눌렀을 때도 여기로 온다(error=access_denied).
  if (params.get('error')) return back(request, 'cancelled')

  const code = params.get('code')
  const state = params.get('state')
  const cookie = request.cookies.get(KAKAO_STATE_COOKIE)?.value
  if (!code || !state || !cookie || !sameState(state, cookie)) return back(request, 'state')

  try {
    requireKakaoConfig()
    const tokens = await exchangeCode(code)

    const sb = await createSupabaseServerClient()
    const { data, error } = await sb.rpc('kakao_token_save', {
      p_access: tokens.accessToken,
      p_refresh: tokens.refreshToken,
      p_expires: tokens.expiresAt,
      p_refresh_expires: tokens.refreshExpiresAt,
      p_scopes: tokens.scopes,
    })
    if (error) {
      console.error('[kakao] save', error.code, error.message)
      return back(request, 'save')
    }
    // 0023의 함수는 권한이 없으면 예외 대신 false를 준다.
    if (data !== true) return back(request, 'forbidden')

    // 저장은 했다. 다만 '카카오톡 메시지 전송'이 선택 동의라 회장이 체크를 풀고 넘어갈 수 있다 —
    // 그 상태로 두면 아침 07:00에 -402로 조용히 실패한다. 지금 화면에서 말한다.
    return back(request, canSendMessage(tokens.scopes) ? 'connected' : 'noscope')
  } catch (e) {
    console.error('[kakao] callback', e instanceof Error ? e.message : String(e))
    return back(request, 'failed')
  }
}
