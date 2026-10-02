'use server'

import { redirect } from 'next/navigation'

import { readActivityOrigin } from '@/lib/activity-record'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * CH-049 로그인 / 로그아웃.
 *
 * Server Action이라 비밀번호가 브라우저 JS를 거치지 않고 바로 서버로 간다.
 * 세션 쿠키를 심는 것도 여기서 한다 — 서버 컴포넌트는 쿠키를 못 쓴다(server.ts 주석).
 *
 * CH-051이 login을 기록 대상으로 못박아 두었다. 그래서 성공한 로그인은
 * 반드시 audit_log에 한 줄을 남기고, 그 INSERT는 방금 로그인한 본인의 세션으로 들어간다.
 */

export interface SignInState {
  error?: string
}

/** Supabase가 주는 영문 메시지를 그대로 화면에 걸지 않는다. 로그인 실패는 이유를 좁게 말한다. */
function messageKo(code: string | undefined, message: string): string {
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return '이메일 또는 비밀번호가 맞지 않습니다.'
  }
  if (code === 'email_not_confirmed') return '아직 확인되지 않은 계정입니다. 관리자에게 문의하세요.'
  if (code === 'over_request_rate_limit' || /rate limit/i.test(message)) {
    return '시도가 너무 잦습니다. 잠시 후 다시 시도하세요.'
  }
  return '로그인에 실패했습니다. 잠시 후 다시 시도하세요.'
}

/** 열린 리다이렉트를 막는다. 우리 앱 안의 경로만 통과시킨다. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = safeNext(formData.get('next'))

  if (!email || !password) return { error: '이메일과 비밀번호를 모두 입력하세요.' }

  const sb = await createSupabaseServerClient()

  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    /**
     * 블록 7. 실패한 로그인 한 줄 (0031 record_login_failure()).
     *
     * **자격 증명이 실제로 틀렸을 때만 남긴다.** 요청 제한(over_request_rate_limit)이나
     * 네트워크 오류로 돌아온 것은 '누가 남의 계정에 들어가려 했다'가 아니고, 그것까지
     * 세면 실패 기록이 잡음으로 가득 차 ④ 이상 징후가 아무 뜻도 없게 된다.
     * 이 좁힘이 동시에 그 문의 부풀리기 방어이기도 하다(0031 5절의 '남은 구멍').
     *
     * DB 함수는 **실재하는 활성 계정**에 대해서만 한 줄을 남긴다. 모르는 이메일로는
     * 아무 일도 없다. 화면 문구는 어느 쪽이든 같아서 계정 존재 여부가 새지 않는다.
     *
     * 기록이 실패해도 로그인 흐름은 그대로다 — 감사 기록 장애가 곧 로그인 장애가
     * 되면 안 된다(아래 성공 경로와 같은 판단).
     */
    const invalidCredentials =
      error?.code === 'invalid_credentials' || /invalid login credentials/i.test(error?.message ?? '')
    if (invalidCredentials) {
      try {
        const { device, city } = await readActivityOrigin()
        await sb.rpc('record_login_failure', { p_email: email, p_device: device, p_city: city })
      } catch (e) {
        console.error('[audit] login 실패 기록 실패', e instanceof Error ? e.message : String(e))
      }
    }
    return { error: messageKo(error?.code, error?.message ?? '') }
  }

  // 로그인은 됐지만 권한 표에 없는 계정. RLS가 아무것도 주지 않으므로 빈 화면이 뜬다.
  // 그걸 '고장'으로 오해하게 두지 않고 여기서 세션을 되돌린다(0002 Default Deny).
  const { data: profile } = await sb
    .from('user_profiles')
    .select('user_id,role')
    .eq('user_id', data.user.id)
    .is('revoked_at', null)
    .maybeSingle<{ user_id: string; role: string }>()

  if (!profile) {
    await sb.auth.signOut()
    return { error: '이 계정에는 아직 접근 권한이 없습니다. 관리자에게 문의하세요.' }
  }

  // CH-051. 기록이 실패해도 로그인 자체는 되돌리지 않는다 —
  // 여기서 막으면 audit_log 장애가 곧 전면 로그인 장애가 된다. 대신 서버 로그에 남긴다.
  //
  // 블록 7이 after 세 칸을 더했다. 성공한 로그인에도 기기·도시가 있어야
  // 접속 현황의 '오늘 로그인'이 성공과 실패를 같은 모양으로 늘어놓을 수 있고,
  // ② 새 기기·새 도시 판정이 로그인 줄에서도 선다. **IP는 넣지 않는다** —
  // readActivityOrigin()은 x-forwarded-for를 읽지 않는다. 도시까지다.
  const { device, city } = await readActivityOrigin()
  // Phase 6-2 블록 3. 새 기기면 본인 알림 + 회장 카톡 큐(0042 report_login_device). 로그인 줄을 적기
  // **전에** 부른다 — 적은 뒤에 부르면 방금 그 줄 때문에 늘 «본 적 있는 기기»가 된다. 실패해도 로그인은 간다.
  const { error: deviceError } = await sb.rpc('report_login_device', { p_device: device ?? '', p_city: city ?? '' })
  if (deviceError) console.error(`[security] report_login_device ${deviceError.code ?? '?'}: ${deviceError.message}`)
  const { error: auditError } = await sb.from('audit_log').insert({
    actor_user_id: profile.user_id,
    actor_role: profile.role,
    action: 'login',
    entity_table: 'auth.users',
    entity_id: profile.user_id,
    after: { ok: 'true', path: '/login', device, city },
  })
  if (auditError) {
    console.error(`[audit] login 기록 실패 ${auditError.code ?? '?'}: ${auditError.message}`)
  }

  // Phase 6-2 블록 1 → 회장 메모(2026-10). 회장이 아니면 기본은 직원 홈(/me) — /는 회장 대시보드라 어차피 /me로 돌아간다.
  // 다른 곳을 보려던 참이면(next) 그리로.
  const landing = next === '/' && profile.role !== 'Chairman' ? '/me' : next

  // redirect()는 예외를 던져 흐름을 끊는다. try 안에 두면 안 된다.
  redirect(landing)
}

export async function signOut(): Promise<void> {
  const sb = await createSupabaseServerClient()
  await sb.auth.signOut()
  redirect('/login')
}
