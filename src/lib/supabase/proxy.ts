import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

import { requireSupabaseConfig } from './config'

/**
 * Proxy(구 middleware) 전용 Supabase 클라이언트.
 *
 * server.ts와 나누는 이유는 쿠키를 쓰는 방향이 다르기 때문이다.
 *   server.ts  next/headers의 cookies() — 서버 컴포넌트에서는 읽기만 된다.
 *   이 파일     NextRequest/NextResponse — 여기서만 갱신된 토큰을 브라우저로 되돌려 줄 수 있다.
 *
 * 그래서 access token 갱신은 반드시 이 경로를 지난다. 여기서 안 하면
 * 토큰이 만료된 뒤 화면이 조용히 빈 데이터로 떨어진다(RLS Default Deny라 오류도 안 난다).
 */
/**
 * Phase 6-2 블록 3 — 세션 판정.
 *   expired  최초 로그인에서 7일이 지났다 → 다시 로그인.
 *   revoked  회장이 «모든 기기 로그아웃»을 한 뒤의 세션이다(0042 sessions_revoked_at) → 다시 로그인.
 *   mfa      Executive 이상인데 이 세션이 2단계 인증(aal2)을 거치지 않았다 → /mfa.
 * 최초 로그인 시각은 JWT의 amr(인증 방법별 시각)에서 읽는다 — 토큰을 갱신해도 바뀌지 않는다.
 * DB도 같은 판정을 한다(0042 is_active()) — 이 자리는 사람에게 «다시 로그인하세요»를 보여 주는 쪽이다.
 */
export type SessionGate = 'ok' | 'expired' | 'revoked' | 'mfa'

export const SESSION_MAX_DAYS = 7
const RANK: Record<string, number> = { Chairman: 5, GroupCFO: 4, BusinessCEO: 3, Executive: 2, TeamLead: 1, Member: 0 }

export async function resolveSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null; gate: SessionGate; signOut: () => Promise<void> }> {
  const { url, publishableKey } = requireSupabaseConfig()

  // setAll이 불리면 이 참조를 새 응답으로 갈아 끼운다. 갱신된 쿠키가 실린 쪽을 돌려줘야 한다.
  let response = NextResponse.next({ request })

  const sb = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(items, headers) {
        // 요청 쪽에도 먼저 심는다. 이 요청을 이어받는 서버 컴포넌트가 옛 토큰을 보면 안 된다.
        items.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        // 세션 쿠키가 실린 응답은 캐시되면 안 된다 — 남의 토큰이 다른 사람에게 나간다.
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value))
      },
    },
  })

  // getSession()이 아니라 getUser()다. getSession은 쿠키를 그대로 믿고,
  // getUser는 Auth 서버에 물어 서명을 검증한다. 접근 판정의 입력은 검증된 쪽이어야 한다.
  const {
    data: { user },
  } = await sb.auth.getUser()

  let gate: SessionGate = 'ok'
  if (user) {
    const [{ data: aal }, { data: profile }] = await Promise.all([
      sb.auth.mfa.getAuthenticatorAssuranceLevel(),
      sb.from('user_profiles').select('role,sessions_revoked_at').eq('user_id', user.id).maybeSingle<{ role: string; sessions_revoked_at: string | null }>(),
    ])
    const stamps = (aal?.currentAuthenticationMethods ?? [])
      .map((m) => (typeof m === 'string' ? 0 : Number(m.timestamp)))
      .filter((n) => n > 0)
    const loginAt = stamps.length > 0 ? Math.min(...stamps) * 1000 : Date.parse(user.last_sign_in_at ?? '') || 0
    if (loginAt && Date.now() - loginAt > SESSION_MAX_DAYS * 86_400_000) gate = 'expired'
    else if (profile?.sessions_revoked_at && loginAt < Date.parse(profile.sessions_revoked_at)) gate = 'revoked'
    else if ((RANK[profile?.role ?? ''] ?? -1) >= 2 && aal?.currentLevel !== 'aal2') gate = 'mfa'
  }

  return {
    response,
    user,
    gate,
    signOut: async () => {
      await sb.auth.signOut()
    },
  }
}
