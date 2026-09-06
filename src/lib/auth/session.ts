import { supabaseConfig } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Role, SessionUser } from '@/types'

/**
 * 지금 요청을 보낸 사람이 누구인가. 서버에서만 부른다.
 *
 * 두 곳을 본다.
 *   auth.users        로그인했는가 (Supabase Auth)
 *   user_profiles     그래서 무엇을 할 수 있는가 (0002_rls.sql)
 *
 * 둘 다 있어야 사용자다. 로그인은 됐는데 user_profiles에 행이 없으면
 * RLS는 그 사람에게 아무것도 주지 않는다 — 화면은 빈 대시보드로 뜨고
 * 본인은 이유를 알 수 없다. 그래서 여기서 null로 잘라 로그인 단계에서 걸러 낸다.
 */

interface ProfileRow {
  user_id: string
  role: Role
  display_name: string
  title_ko: string | null
}

export async function currentUser(): Promise<SessionUser | null> {
  if (!supabaseConfig()) return null

  const sb = await createSupabaseServerClient()

  // getUser()는 Auth 서버에 서명을 검증시킨다. 쿠키를 그대로 믿는 getSession()과 다르다.
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return null

  // revoked_at이 찍힌 계정은 auth_profile()이 걸러 낸다. 여기서도 같은 조건을 쓴다(원칙 8).
  const { data } = await sb
    .from('user_profiles')
    .select('user_id,role,display_name,title_ko')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .maybeSingle<ProfileRow>()

  if (!data) return null

  return {
    user_id: data.user_id,
    name: data.display_name,
    role: data.role,
    title_ko: data.title_ko ?? '',
  }
}
