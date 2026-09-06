'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { DUPLICATE_INVITATION, getRepository } from '@/lib/repository'
import {
  ROLE,
  SECURITY_CLASS,
  type Role,
  type SecurityClass,
  type UserInvitation,
} from '@/types'

/**
 * CH-049 RBAC — 사용자 초대 / 권한 회수.
 *
 * 0004_bootstrap_chairman의 머리에 "두 번째 사람부터는 회장이 앱에서 초대한다"고
 * 적어 두었는데 그 화면이 없었다. 이 파일이 그 자리다.
 *
 * 계정을 만들지 않는다. 계정 생성(auth.admin)은 service_role을 요구하고 이 프로젝트에는
 * service_role이 없다(CLAUDE.md). 여기서 만드는 것은 "이 이메일로 계정이 생기면
 * 이 역할을 준다"는 약속이고, 0011의 on_auth_user_created 트리거가 이행한다.
 * 메일은 Supabase Dashboard에서 나간다 — 남는 문제라 DEFERRED D-15에 적어 두었다.
 *
 * 권한 판정은 여기서 하지 않는다. 0002의 user_profiles_admin_write와
 * 0011의 user_invitations_admin이 Chairman만 통과시킨다.
 */

export interface InviteUserState {
  error?: string
  invitation?: UserInvitation
}

export interface RevokeUserState {
  error?: string
}

function isRole(value: unknown): value is Role {
  return ROLE.includes(value as Role)
}

function isSecurityClass(value: unknown): value is SecurityClass {
  return SECURITY_CLASS.includes(value as SecurityClass)
}

/**
 * 이메일 모양만 본다. 도메인을 사내로 묶지 않는 이유는 외부전문가·외주 개발자가
 * 04_권한 시트의 정식 역할이기 때문이다 — 그 사람들의 주소는 사내 도메인이 아니다.
 */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
}

/**
 * 전사 범위 역할. 0002의 has_group_scope()와 같은 목록이어야 한다.
 * 이 둘에게는 회사를 고르게 하지 않는다 — 골라 봐야 has_business()가 그 표를 보지 않는다.
 */
const GROUP_SCOPE: readonly Role[] = ['Chairman', 'GroupCFO']

export async function inviteUser(input: {
  email: unknown
  displayName: unknown
  titleKo: unknown
  role: unknown
  securityClass: unknown
  businessIds: unknown
}): Promise<InviteUserState> {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : ''
  const titleKo = typeof input.titleKo === 'string' ? input.titleKo.trim() : ''

  if (!isEmail(email)) return { error: '이메일 주소를 확인하세요.' }
  if (!displayName) return { error: '이름을 입력하세요. 목록에서 사람을 가릴 유일한 값입니다.' }
  if (!isRole(input.role)) return { error: '알 수 없는 역할입니다.' }
  if (!isSecurityClass(input.securityClass)) return { error: '알 수 없는 보안등급입니다.' }

  const requested = Array.isArray(input.businessIds)
    ? input.businessIds.filter((b): b is string => typeof b === 'string' && b.length > 0)
    : []

  // 전사 역할에게는 회사 목록을 저장하지 않는다. 화면이 보냈더라도 여기서 비운다 —
  // 남겨 두면 나중에 '이 사람은 이 세 회사만 본다'로 잘못 읽힌다.
  const businessIds = GROUP_SCOPE.includes(input.role) ? [] : requested

  if (businessIds.length === 0 && !GROUP_SCOPE.includes(input.role)) {
    return {
      error:
        '이 역할은 회사를 하나 이상 지정해야 합니다. 지정하지 않으면 로그인은 되지만 아무것도 보이지 않습니다(0002 Default Deny).',
    }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  let invitation: UserInvitation
  try {
    const repo = await getRepository()
    invitation = await repo.inviteUser(
      {
        email,
        display_name: displayName,
        title_ko: titleKo,
        role: input.role,
        max_security_class: input.securityClass,
        business_ids: businessIds,
      },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[inviteUser]', e)
    if (e instanceof Error && e.message === DUPLICATE_INVITATION) {
      return { error: `이 이메일로 아직 수락되지 않은 초대가 이미 있습니다: ${email}` }
    }
    return {
      error:
        e instanceof Error && /user_invitations_admin|42501|PGRST301/.test(e.message)
          ? '사용자를 초대할 권한이 없습니다. (Chairman만 가능합니다)'
          : '초대하지 못했습니다. 잠시 후 다시 시도하세요.',
    }
  }

  revalidatePath('/settings/users')
  return { invitation }
}

/**
 * 권한 회수 (05_Architecture 원칙 8 — 퇴사·계약 종료 즉시 회수).
 *
 * 이미 들어온 사람은 user_profiles.revoked_at 한 줄로 전 테이블이 동시에 닫힌다.
 * 아직 계정이 없는 사람은 자를 권한이 없어 초대장을 취소한다.
 * 화면에서는 둘이 같은 버튼이라 한 함수로 받는다.
 */
export async function revokeUser(input: {
  kind: unknown
  id: unknown
}): Promise<RevokeUserState> {
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (!id) return { error: '대상을 알 수 없습니다.' }
  if (input.kind !== 'account' && input.kind !== 'invitation') {
    return { error: '알 수 없는 회수 대상입니다.' }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  // 자기 자신은 못 자른다. 마지막 Chairman이 스스로를 회수하면 0002의 admin 정책을
  // 통과할 사람이 남지 않아 SQL Editor 말고는 되돌릴 길이 없다.
  if (input.kind === 'account' && id === user.user_id) {
    return { error: '자기 자신의 권한은 회수할 수 없습니다.' }
  }

  try {
    const repo = await getRepository()
    await repo.revokeUser(
      input.kind === 'account'
        ? { kind: 'account', user_id: id }
        : { kind: 'invitation', invitation_id: id },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[revokeUser]', e)
    return {
      error:
        e instanceof Error && /user_profiles_admin_write|user_invitations_admin|42501|PGRST301/.test(e.message)
          ? '권한을 회수할 권한이 없습니다. (Chairman만 가능합니다)'
          : '회수하지 못했습니다. 잠시 후 다시 시도하세요.',
    }
  }

  revalidatePath('/settings/users')
  return {}
}
