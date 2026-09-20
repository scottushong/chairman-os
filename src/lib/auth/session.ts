import { connection } from 'next/server'
import { cache } from 'react'

import { DATA_MODE } from '@/lib/env'
import { supabaseConfig } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dummyViewer } from '@/lib/repository/dummy-org'
import { type Role, type SessionUser } from '@/types'

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
  /** 0017이 만든 칸. Chairman 행에는 이미 값이 들어 있다. 비어 있을 수 있다. */
  display_name_en: string | null
}

/**
 * 요청 하나 안에서는 한 번만 묻는다. 레이아웃(헤더 이름)과 대시보드(인사말)가 같은 답을 봐야 하고,
 * 따로 물으면 Auth 왕복이 두 번 생긴다.
 */
export const currentUser = cache(async function currentUser(): Promise<SessionUser | null> {
  // 키가 없으면 아래에서 쿠키를 읽지 않고 돌아가, 이걸 부르는 화면이 빌드 때 정적으로
  // 프리렌더된다. 그러면 /settings/users의 notFound()가 빌드를 깨뜨린다(Vercel에 env 없이 빌드).
  // 키 유무와 상관없이 늘 요청 시점에 판정하게 한다.
  await connection()
  if (!supabaseConfig()) return dummyUser()

  const sb = await createSupabaseServerClient()

  // getUser()는 Auth 서버에 서명을 검증시킨다. 쿠키를 그대로 믿는 getSession()과 다르다.
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return null

  // revoked_at이 찍힌 계정은 auth_profile()이 걸러 낸다. 여기서도 같은 조건을 쓴다(원칙 8).
  const { data } = await sb
    .from('user_profiles')
    // display_name_en은 0017이 만든 뒤로 읽는 쪽이 없었다. 사이드바 하단 프로필이 쓴다(Phase 5).
    .select('user_id,role,display_name,title_ko,display_name_en')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .maybeSingle<ProfileRow>()

  if (!data) return null

  return {
    user_id: data.user_id,
    name: data.display_name,
    role: data.role,
    title_ko: data.title_ko ?? '',
    display_name_en: data.display_name_en ?? null,
  }
})

/**
 * 순수 dummy 개발(Supabase 키 없음 + NEXT_PUBLIC_DATA_MODE=dummy)의 가상 사용자.
 *
 * 키가 없으면 로그인이라는 개념이 없고(proxy.ts), 그러면 dummy 화면에서 쓰기 흐름(장부 입력 등)을
 * 한 번도 눌러 볼 수 없다. 이 사용자는 메모리 어댑터에만 닿는다 — getRepository()가 live에서 키 없이는
 * 던지므로 실데이터에는 닿을 길이 없다.
 *
 * Phase 6-1부터 이 사람은 **조직도 시드의 한 사람**이다(lib/repository/dummy-org.ts).
 * 0026이 사람·업무·문서를 subtree로 자른 뒤로 'DUMMY'라는 이름의 떠 있는 계정으로는
 * 회장 지시의 검증 a~f(네 세션)를 화면에서 한 번도 볼 수 없기 때문이다 — 트리에 매달리지
 * 않은 사람에게는 자기 것 말고 아무것도 보이지 않는다.
 *
 *   DUMMY_USER=sales_lead   시드의 키로 직접 고른다(chairman · dy_ceo · exec · sales_lead ·
 *                           sales_staff · buy_lead · buy_staff)
 *   DUMMY_ROLE=TeamLead     역할로 고른다. 예전 개발 습관을 그대로 둔다.
 *   둘 다 없으면 회장이다.
 *
 * display_name_en은 시드가 가진 값이다. 없는 사람은 null이고, 화면은 영문 줄을 아예 그리지
 * 않는다 — 코드가 한글 이름을 로마자로 지어내지 않는다(0017의 판단).
 */
function dummyUser(): SessionUser | null {
  if (DATA_MODE !== 'dummy') return null
  const person = dummyViewer()
  return {
    user_id: person.user_id,
    name: person.display_name,
    role: person.role,
    title_ko: person.title_ko,
    display_name_en: person.display_name_en,
  }
}
