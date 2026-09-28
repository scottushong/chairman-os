'use server'

import { passwordProblem } from '@/lib/password'
import { supabaseConfig } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * 계정·보안 (Phase 5-E 4절) — 비밀번호 변경과 '다른 기기 모두 로그아웃'.
 *
 * 둘 다 Supabase Auth가 하는 일이라 DB(0030)와 무관하다. 그래서 repository를 거치지 않고
 * 여기서 직접 auth 클라이언트를 쓴다 — repository는 업무 데이터의 문이고, 세션은 그게 아니다.
 *
 * **dummy 개발(키 없음)에서는 둘 다 할 수 없다.** 조용히 '성공'이라고 답하지 않는다 —
 * 그러면 비밀번호가 바뀐 줄 알고 넘어가는 날이 온다.
 */

export interface AccountState {
  error?: string
  done?: string
}

const NO_AUTH: AccountState = {
  error: 'dummy 모드에는 로그인이라는 개념이 없어 계정을 바꿀 수 없습니다.',
}

export async function changePassword(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  if (!supabaseConfig()) return NO_AUTH

  const next = String(form.get('password') ?? '')
  const again = String(form.get('password_confirm') ?? '')

  // 길이만 여기서 본다. 나머지 규칙(유출된 비밀번호 차단 등)은 Supabase 프로젝트 설정이 갖고,
  // 그 판정을 화면이 흉내 내면 두 곳이 갈라진다 — lib/auth/roles.ts가 적어 둔 것과 같은 원칙이다.
  // Phase 6-2 블록 3 — 12자 이상 + 유출 목록(HIBP k-익명성) 검사. lib/password.ts 한 곳.
  const problem = await passwordProblem(next)
  if (problem) return { error: problem }
  if (next !== again) return { error: '새 비밀번호와 확인이 다릅니다.' }

  const sb = await createSupabaseServerClient()
  const { error } = await sb.auth.updateUser({ password: next })
  if (error) {
    console.error('[account] password', error)
    // Supabase의 영문 메시지를 그대로 걸지 않는다(actions/auth.ts messageKo와 같은 이유).
    if (/should be different|same as the old/i.test(error.message)) {
      return { error: '지금 쓰는 비밀번호와 같습니다.' }
    }
    if (/weak|pwned|compromis/i.test(error.message)) {
      return { error: '너무 쉬운 비밀번호입니다. 다른 것으로 정해 주세요.' }
    }
    return { error: '비밀번호를 바꾸지 못했습니다. 잠시 후 다시 시도하세요.' }
  }
  return { done: '비밀번호를 바꿨습니다.' }
}

/**
 * 다른 기기의 세션만 끊는다(`scope: 'others'`). 지금 이 창은 그대로 남는다 —
 * 여기서 전체 로그아웃을 하면 "다른 기기"를 누른 사람이 자기 화면에서 튕겨 나간다.
 *
 * 목록을 보여 주지 못하면서 이 버튼은 되는 것이 이상해 보일 수 있는데, 그것이 GoTrue의
 * 생김새다 — 세션 목록을 주는 API는 admin(service_role)뿐이고 이 프로젝트에 그 키는 없다.
 * 끊는 것은 본인 토큰으로 할 수 있다.
 */
export async function signOutOtherDevices(): Promise<AccountState> {
  if (!supabaseConfig()) return NO_AUTH

  const sb = await createSupabaseServerClient()
  const { error } = await sb.auth.signOut({ scope: 'others' })
  if (error) {
    console.error('[account] signOut others', error)
    return { error: '다른 기기를 로그아웃하지 못했습니다.' }
  }
  return { done: '이 기기를 제외한 모든 기기에서 로그아웃했습니다.' }
}
