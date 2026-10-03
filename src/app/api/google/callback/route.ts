import { timingSafeEqual } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { DATA_MODE } from '@/lib/env'
import { GOOGLE_STATE_COOKIE, requireGoogleConfig } from '@/lib/google/config'
import { exchangeCode } from '@/lib/google/token'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * /api/google/callback — 코드 교환 → 연결 계정 주소 확인 → 0039 google_token_save (Phase 9 블록 4).
 * 결과는 /mail?google=<reason>으로 돌려보내고 화면이 사람 말로 그린다. 토큰은 로그에 찍지 않는다.
 */
export const dynamic = 'force-dynamic'

function back(request: NextRequest, reason: string): NextResponse {
  const base = process.env.APP_BASE_URL ?? request.nextUrl.origin
  const res = NextResponse.redirect(new URL(`/mail?google=${reason}`, base))
  res.cookies.set(GOOGLE_STATE_COOKIE, '', { path: '/api/google', maxAge: 0 })
  return res
}

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function GET(request: NextRequest) {
  // dummy 모드의 가상 회장으로 실제 Google 교환과 Supabase 저장을 돌리지 않는다.
  if (DATA_MODE === 'dummy') {
    return NextResponse.redirect(new URL('/mail?google=config', process.env.APP_BASE_URL ?? request.nextUrl.origin))
  }
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const params = request.nextUrl.searchParams
  if (params.get('error')) return back(request, 'cancelled')
  const code = params.get('code')
  const state = params.get('state')
  const cookie = request.cookies.get(GOOGLE_STATE_COOKIE)?.value
  if (!code || !state || !cookie || !sameState(state, cookie)) return back(request, 'state')

  try {
    requireGoogleConfig()
    const tokens = await exchangeCode(code)
    if (!tokens.accessToken) return back(request, 'exchange')

    // 어느 계정을 연결했는지 — readonly 범위로 읽을 수 있는 profile에서.
    const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      cache: 'no-store',
    })
    const email = profile.ok ? String(((await profile.json()) as { emailAddress?: string }).emailAddress ?? '') : ''

    const sb = await createSupabaseServerClient()
    const { data, error } = await sb.rpc('google_token_save', {
      p_access: tokens.accessToken,
      p_refresh: tokens.refreshToken,
      p_expires: tokens.expiresAt,
      p_scopes: tokens.scopes,
      p_email: email,
    })
    if (error) {
      console.error('[google] save', error.code, error.message)
      return back(request, 'save')
    }
    // false = Chairman이 아니거나, 보내기 범위가 섞여 들어왔다(0039).
    if (data !== true) return back(request, 'forbidden')
    return back(request, 'connected')
  } catch (e) {
    console.error('[google] callback', e instanceof Error ? e.message : String(e))
    return back(request, 'exchange')
  }
}
