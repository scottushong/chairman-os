import type { SecurityClass } from './enums'
import type { Role } from './permissions'

/**
 * CH-049 RBAC 화면(설정 → 사용자·권한)이 다루는 두 가지.
 *
 *   UserAccount     이미 들어와 있는 사람. user_profiles 한 행.
 *   UserInvitation  아직 계정이 없는 사람에게 준 약속. 0011 user_invitations 한 행.
 *
 * 둘을 한 타입으로 합치지 않는다. 하나는 '지금 무엇을 할 수 있나'고
 * 다른 하나는 '계정이 생기면 무엇을 줄 것인가'다 — 자를 때 채우는 칸도 서로 다르다.
 */

/** user_profiles 한 행. 이메일이 없다 — auth.users는 PostgREST로 읽히지 않는다. */
export interface UserAccount {
  user_id: string
  role: Role
  display_name: string
  title_ko: string
  max_security_class: SecurityClass
  /** 채워져 있으면 회수된 계정이다. 0002의 auth_profile()이 이 값으로 전 테이블을 동시에 닫는다. */
  revoked_at: string | null
  /** 이 사람이 보는 회사들. 전사 역할(Chairman/GroupCFO)은 빈 배열이고 그래도 전부 본다. */
  business_ids: string[]
  created_at: string
}

export interface UserInvitation {
  invitation_id: string
  email: string
  role: Role
  max_security_class: SecurityClass
  business_ids: string[]
  display_name: string
  title_ko: string
  invited_at: string
  /** 계정이 생겨 권한이 실제로 붙은 시각. null이면 아직 기다리는 중이다. */
  accepted_at: string | null
  /** 수락 전에 취소한 시각. 이미 들어온 사람을 자르는 건 UserAccount.revoked_at이다. */
  revoked_at: string | null
}

/** CH-049로 새 사람에게 줄 것. 이메일과 권한 한 벌. */
export interface NewInvitation {
  email: string
  role: Role
  max_security_class: SecurityClass
  business_ids: string[]
  display_name: string
  title_ko: string
}
