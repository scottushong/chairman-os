import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * /auth/confirm — 가입 인증 메일의 착지 (Phase 6-2 블록 2).
 *
 * 두 모양을 다 받는다: PKCE(?code=) — @supabase/ssr의 기본 — 와 이메일 템플릿이 token_hash를 싣는 경우
 * (?token_hash=&type=). 어느 쪽이든 세션이 서면 /auth/set-password로 보내 비밀번호를 정하게 한다.
 * 돌아갈 곳을 쿼리로 받지 않는다(열린 리다이렉트를 만들지 않는다).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const sb = await createSupabaseServerClient()
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null

  let ok = false
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code)
    ok = !error
  } else if (tokenHash && type) {
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type })
    ok = !error
  }
  const to = url.clone()
  to.search = ''
  to.pathname = ok ? '/auth/set-password' : '/login'
  if (!ok) to.search = '?reason=confirm'
  return NextResponse.redirect(to)
}
