'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { DUPLICATE_INVITATION, getRepository } from '@/lib/repository'
import {
  INVITABLE_ROLE,
  MODULE_GRANT_OPTIONS,
  SECURITY_CLASS,
  type PersonLanguage,
  type ProfilePatch,
  type Role,
  type SecurityClass,
  type UserInvitation,
} from '@/types'

/**
 * CH-049 RBAC — 사용자 초대 / 권한 회수, 그리고 Phase 6-1의 조직도 편집.
 *
 * 0004_bootstrap_chairman의 머리에 "두 번째 사람부터는 회장이 앱에서 초대한다"고
 * 적어 두었는데 그 화면이 없었다. 이 파일이 그 자리다.
 *
 * 계정을 만들지 않는다. 계정 생성(auth.admin)은 service_role을 요구하고 이 프로젝트에는
 * service_role이 없다(CLAUDE.md). 여기서 만드는 것은 "이 이메일로 계정이 생기면
 * 이 역할을 준다"는 약속이고, 0011/0026의 트리거가 이행한다.
 * 메일은 Supabase Dashboard에서 나간다 — 남는 문제라 DEFERRED D-15에 적어 두었다.
 *
 * 권한 판정은 여기서 하지 않는다. 0002의 user_profiles_admin_write, 0011의
 * user_invitations_admin, 0026의 user_invitations_delegated_insert, 0025의 teams_write가
 * 각자 판정한다. **이 파일이 하는 일은 입력을 좁히고, 거부를 한국어로 옮기는 것이다.**
 */

export interface InviteUserState {
  error?: string
  invitation?: UserInvitation
}

export interface RevokeUserState {
  error?: string
}

function isRole(value: unknown): value is Role {
  // 시스템 계정(AIAgent·Integration)은 초대로 만들지 않는다 — bootstrap SQL의 몫이다.
  return INVITABLE_ROLE.includes(value as Role)
}

/**
 * 사람의 최고 열람 등급으로 받을 수 있는 값인가.
 *
 * 'Public'(0025)은 **문서에 붙이는** 등급이다 — "이건 전 직원이 본다". 그것을 사람의
 * 최고 등급으로 주면 뜻이 뒤집혀 공지 말고는 아무것도 못 보는 계정이 된다. 폼에서도 빼
 * 두었지만(components/settings/invite-user.tsx), 폼이 유일한 입구가 아니므로 여기서도
 * 거른다 — 권한을 정하는 값은 화면이 아니라 서버가 좁힌다.
 */
function isSecurityClass(value: unknown): value is SecurityClass {
  return SECURITY_CLASS.includes(value as SecurityClass) && value !== 'Public'
}

/**
 * 이메일 모양만 본다. 도메인을 사내로 묶지 않는 이유는 외부전문가·외주 개발자가
 * 04_권한 시트의 정식 역할이기 때문이다 — 그 사람들의 주소는 사내 도메인이 아니다.
 */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
}

/** 'YYYY-MM-DD'인가. 날짜 칸은 빈 값이 정상이라(입사일 미정) 빈 문자열은 null로 떨어진다. */
function isoDateOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function textOrNull(value: unknown, max: number): string | null {
  const v = typeof value === 'string' ? value.trim() : ''
  return v ? v.slice(0, max) : null
}

/**
 * 전사 범위 역할. 0002의 has_group_scope()와 같은 목록이어야 한다.
 * 이 둘에게는 회사를 고르게 하지 않는다 — 골라 봐야 has_business()가 그 표를 보지 않는다.
 */
const GROUP_SCOPE: readonly Role[] = ['Chairman', 'GroupCFO']

/**
 * DB가 거부했을 때 한국어 한 줄.
 *
 * 화면이 판정을 흉내 내지 않는 대신, 거부를 사람 말로 옮기는 것까지는 화면의 몫이다
 * (블록 B·C 브리프). 코드를 그대로 보여 주면 회장은 '고장'으로 읽는다.
 *
 * 트리거가 던지는 한국어 문구(0025의 순환 금지, 0026의 결재 도장)는 **그대로 보여 준다** —
 * 그 문장들은 이미 사람이 읽으라고 쓴 것이고, 여기서 다시 쓰면 두 벌이 갈라진다.
 */
function denialMessage(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : ''
  if (/순환|자기 자신|회장 승인 칸/.test(message)) {
    // DB가 한국어로 말한 자리. 접두사(Supabase user_profiles 23514: …)만 걷어낸다.
    return message.replace(/^Supabase [^:]+: /, '')
  }
  if (/42501|row-level security|PGRST301|_admin|_write|delegated_insert/.test(message)) {
    return fallback
  }
  return '저장하지 못했습니다. 잠시 후 다시 시도하세요.'
}

export async function inviteUser(input: {
  email: unknown
  displayName: unknown
  displayNameEn: unknown
  titleKo: unknown
  role: unknown
  securityClass: unknown
  businessIds: unknown
  teamId: unknown
  reportsTo: unknown
  joinedOn: unknown
  language: unknown
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

  // 0026의 위임 초대는 reports_to가 필수다(없으면 회장 외에는 42501). 기본값은 초대자 자신 —
  // 회장 지시 블록 B-4가 정한 값이고, 폼이 비워 보내도 여기서 같은 값으로 떨어진다.
  const reportsTo =
    typeof input.reportsTo === 'string' && input.reportsTo.trim() ? input.reportsTo.trim() : user.user_id

  const language: PersonLanguage = input.language === 'en' ? 'en' : 'ko'

  let invitation: UserInvitation
  try {
    const repo = await getRepository()
    invitation = await repo.inviteUser(
      {
        email,
        display_name: displayName,
        display_name_en: textOrNull(input.displayNameEn, 60),
        title_ko: titleKo,
        role: input.role,
        max_security_class: input.securityClass,
        business_ids: businessIds,
        team_id: textOrNull(input.teamId, 60),
        reports_to: reportsTo,
        joined_on: isoDateOrNull(input.joinedOn),
        language,
      },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[inviteUser]', e)
    if (e instanceof Error && e.message === DUPLICATE_INVITATION) {
      return { error: `이 이메일로 아직 수락되지 않은 초대가 이미 있습니다: ${email}` }
    }
    return {
      error: denialMessage(
        e,
        '이 사람을 초대할 수 없습니다. 초대는 자기 아래(직속·그 아래)로만 할 수 있고, ' +
          '자기보다 높은 보안등급이나 자기가 못 보는 회사는 줄 수 없습니다.',
      ),
    }
  }

  revalidatePath('/settings/users')
  return { invitation }
}

/**
 * 권한 회수 (05_Architecture 원칙 8 — 퇴사·계약 종료 즉시 회수).
 *
 * 이미 들어온 사람은 user_profiles.revoked_at 한 줄로 전 테이블이 동시에 닫힌다.
 * 0026이 그 자리에 승계 트리거를 걸어 두었으므로, 이 한 줄이 그 사람 아래 사람들과
 * 그가 맡던 팀장 자리까지 상위로 올린다(검증 f).
 * 아직 계정이 없는 사람은 자를 권한이 없어 초대장을 취소한다.
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
      error: denialMessage(e, '권한을 회수할 권한이 없습니다. (Chairman만 가능합니다)'),
    }
  }

  revalidatePath('/settings/users')
  return {}
}

/**
 * Phase 6-2 블록 3 — 회장의 «모든 기기 로그아웃». 권한 판정은 DB(force_logout)가 한다.
 * 다음 요청부터 proxy가 그 사람을 로그인 화면으로 보낸다(?reason=revoked).
 */
export async function forceLogoutUser(input: { userId: unknown }): Promise<RevokeUserState> {
  const id = typeof input.userId === 'string' ? input.userId.trim() : ''
  if (!id) return { error: '대상을 알 수 없습니다.' }
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (user.role !== 'Chairman') return { error: '회장만 할 수 있습니다.' }
  try {
    const repo = await getRepository()
    if (!(await repo.forceLogout(id))) return { error: '로그아웃시키지 못했습니다(대상이 없거나 권한이 없습니다).' }
  } catch (e) {
    console.error('[forceLogoutUser]', e)
    return { error: '로그아웃시키지 못했습니다. 잠시 뒤 다시 시도하세요.' }
  }
  return {}
}

/**
 * Phase 6-1 블록 B-3 — 조직도 우측 패널의 세 가지(역할 변경 · 팀 이동 · 상사 변경).
 *
 * 셋을 한 함수로 받는다. 화면에서 셋이 같은 패널의 같은 줄들이고, audit_log에도 전부
 * permission_change로 남기 때문이다 — **새 enum 값을 만들지 않는다**(0022의 55P04).
 *
 * 판정은 DB가 한다. 지금 이 세 칸을 고칠 수 있는 사람은 회장뿐이고(0002
 * user_profiles_admin_write), 순환은 0025의 트리거가 막는다. 화면은 회장이 아니면
 * 이 패널의 버튼을 아예 그리지 않지만, 그것은 안내지 자물쇠가 아니다.
 */
export async function updateUserProfile(input: {
  userId: unknown
  role?: unknown
  teamId?: unknown
  reportsTo?: unknown
}): Promise<RevokeUserState> {
  const userId = typeof input.userId === 'string' ? input.userId.trim() : ''
  if (!userId) return { error: '대상을 알 수 없습니다.' }

  const patch: ProfilePatch = {}
  if (input.role !== undefined) {
    if (!isRole(input.role)) return { error: '알 수 없는 역할입니다.' }
    patch.role = input.role
  }
  // 팀·상사는 **빈 문자열이 곧 해제**다(팀 미배정 / 상사 없음). null과 undefined를 구분한다 —
  // undefined는 '이 칸은 건드리지 않는다'이고 null은 '비운다'다.
  if (input.teamId !== undefined) {
    patch.team_id = typeof input.teamId === 'string' && input.teamId ? input.teamId : null
  }
  if (input.reportsTo !== undefined) {
    patch.reports_to = typeof input.reportsTo === 'string' && input.reportsTo ? input.reportsTo : null
  }
  if (Object.keys(patch).length === 0) return { error: '바꿀 것이 없습니다.' }

  if (patch.reports_to === userId) {
    return { error: '자기 자신을 직속 상사로 지정할 수 없습니다.' }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.updateUserProfile(userId, patch, { user_id: user.user_id, role: user.role })
  } catch (e) {
    console.error('[updateUserProfile]', e)
    return {
      error: denialMessage(e, '조직도를 바꿀 권한이 없습니다. (Chairman만 가능합니다)'),
    }
  }

  revalidatePath('/settings/users')
  return {}
}

/**
 * 0047 — 사람 단위 모듈 권한(재무 입력 · 월 마감 등). 회장만이다(0002 module_access_admin_write).
 *
 * 모듈 키는 화면 목록(MODULE_GRANT_OPTIONS)에 있는 것만 받는다 — 아무 경로나 받으면 권한 표에 뜻 없는 줄이
 * 쌓이고, 그 줄은 나중에 누가 같은 이름의 모듈을 만드는 날 조용히 권한이 된다. 두 칸이 다 false면 줄을 지운다.
 * 판정(회장인가)은 여기서 하지 않는다 — DB가 거부하면 그 문장을 한국어로 옮긴다.
 */
export async function setModuleGrant(input: {
  userId: unknown
  module: unknown
  canWrite: unknown
  canApprove: unknown
}): Promise<RevokeUserState> {
  const userId = typeof input.userId === 'string' ? input.userId.trim() : ''
  if (!userId) return { error: '대상을 알 수 없습니다.' }
  const option = MODULE_GRANT_OPTIONS.find((o) => o.module === input.module)
  if (!option) return { error: '알 수 없는 모듈입니다.' }
  if (typeof input.canWrite !== 'boolean' || typeof input.canApprove !== 'boolean') {
    return { error: '권한 값을 읽을 수 없습니다.' }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.setModuleGrant(
      userId,
      { module: option.module, can_write: input.canWrite, can_approve: input.canApprove },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[setModuleGrant]', e)
    return { error: denialMessage(e, '모듈 권한을 바꿀 권한이 없습니다. (Chairman만 가능합니다)') }
  }

  revalidatePath('/settings/users')
  // 그 사람의 재무 화면 안내(입력 폼 · 마감 버튼)가 세션 값으로 선다 — 다음 요청에서 새로 읽는다.
  revalidatePath('/finance', 'layout')
  return {}
}

/**
 * Phase 6-1 블록 B-7 — 팀 추가 · 이름 변경 · 팀장 지정 · 회사 간 이동. 회장만이다.
 *
 * team_id는 화면이 정한다(lib/business-id.ts의 회사 id와 같은 판단) — 서버가 만들어 주면
 * 저장을 누른 뒤에야 자기 팀의 키를 알게 된다. 규칙은 'team_' + 영문 slug다.
 */
export async function saveTeam(input: {
  teamId: unknown
  businessId: unknown
  name: unknown
  nameEn: unknown
  leadUserId: unknown
}): Promise<RevokeUserState> {
  const teamId = typeof input.teamId === 'string' ? input.teamId.trim().toLowerCase() : ''
  const businessId = typeof input.businessId === 'string' ? input.businessId.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const nameEn = typeof input.nameEn === 'string' ? input.nameEn.trim() : ''

  if (!/^team_[a-z0-9_]{2,40}$/.test(teamId)) {
    return { error: "팀 키는 'team_' 다음에 영문 소문자·숫자·밑줄만 씁니다. 예: team_dy_sales" }
  }
  if (!businessId) return { error: '회사를 고르세요.' }
  // ko/en 둘 다 받는다. 0025가 teams.name_en을 not null로 둔 이유가 여기다 —
  // 팀 이름은 만드는 사람이 정하면 되는 값이라 비워 둘 이유가 없다.
  if (!name || !nameEn) return { error: '팀 이름을 한글과 영문 둘 다 입력하세요.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.saveTeam(
      {
        team_id: teamId,
        business_id: businessId,
        name,
        name_en: nameEn,
        lead_user_id:
          typeof input.leadUserId === 'string' && input.leadUserId ? input.leadUserId : null,
      },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[saveTeam]', e)
    return { error: denialMessage(e, '팀을 만들거나 고칠 권한이 없습니다. (Chairman만 가능합니다)') }
  }

  revalidatePath('/settings/users')
  return {}
}

/**
 * Phase 6-1 블록 B-4 — 회장 결재 큐의 도장.
 *
 * 승인은 chairman_approved_at을 채우는 update 하나다. 0026의 트리거가 그 순간
 * 이행까지 돌린다 — 계정이 이미 있으면 권한이 바로 붙고, 없으면 계정이 생길 때 붙는다.
 * 초대자가 자기 초대를 스스로 승인하는 길은 없다(0026 4-2절의 트리거가 막는다).
 */
export async function approveInvitation(input: { invitationId: unknown }): Promise<RevokeUserState> {
  const id = typeof input.invitationId === 'string' ? input.invitationId.trim() : ''
  if (!id) return { error: '대상을 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.approveInvitation(id, { user_id: user.user_id, role: user.role })
  } catch (e) {
    console.error('[approveInvitation]', e)
    return { error: denialMessage(e, '초대를 승인할 권한이 없습니다. (Chairman만 가능합니다)') }
  }

  revalidatePath('/settings/users')
  return {}
}
