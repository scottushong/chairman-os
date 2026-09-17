import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { requireSupabaseConfig } from './config'

/**
 * 사람이 아닌 계정(야간 AI Agent · ECOUNT 동기화)으로 로그인한 클라이언트.
 *
 * service_role 대신 이 길을 쓴다(CLAUDE.md). 계정도 RLS 안에서 돌고, 무엇을 읽고 쓸지는
 * 그 계정의 user_profiles.role이 정한다.
 *
 * 로그인 뒤 역할을 한 번 확인한다. 비밀번호 칸에 회장 계정이 잘못 들어가면 Job이 회장 권한으로 돈다 —
 * 그 사고를 여기서 멈춘다. 쿠키를 쓰지 않고 세션을 저장하지 않는다. 요청 하나 동안만 산다.
 */
export async function signInServiceAccount(opts: {
  emailEnv: string
  passwordEnv: string
  role: 'AIAgent' | 'Integration'
}): Promise<{ sb: SupabaseClient; userId: string }> {
  const email = process.env[opts.emailEnv]
  const password = process.env[opts.passwordEnv]
  if (!email || !password) throw new Error(`${opts.emailEnv} / ${opts.passwordEnv} 가 없다.`)

  const { url, publishableKey } = requireSupabaseConfig()
  const sb = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    throw new Error(`${opts.role} 로그인 실패: ${error?.message ?? 'user 없음'}`)
  }

  const { data: profile, error: pErr } = await sb
    .from('user_profiles')
    .select('role')
    .eq('user_id', data.user.id)
    .is('revoked_at', null)
    .maybeSingle<{ role: string }>()
  if (pErr || profile?.role !== opts.role) {
    await sb.auth.signOut()
    throw new Error(
      `${opts.emailEnv} 계정의 역할이 ${opts.role}가 아니다(${profile?.role ?? pErr?.message ?? '프로필 없음'}).`,
    )
  }

  return { sb, userId: data.user.id }
}
