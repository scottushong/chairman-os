import type { SecurityClass } from './enums'
import type { Role } from './permissions'
import type { IsoDate } from './primitives'

/**
 * CH-049 RBAC 화면(설정 → 사용자·권한)이 다루는 것들.
 *
 *   UserAccount     이미 들어와 있는 사람. user_profiles 한 행.
 *   UserInvitation  아직 계정이 없는 사람에게 준 약속. 0011 user_invitations 한 행.
 *   Team            조직도의 가운데 층(0025 teams).
 *
 * UserAccount와 UserInvitation을 한 타입으로 합치지 않는다. 하나는 '지금 무엇을 할 수 있나'고
 * 다른 하나는 '계정이 생기면 무엇을 줄 것인가'다 — 자를 때 채우는 칸도 서로 다르다.
 */

/** 재직 상태(0025 user_profiles.status). 권한 회수(revoked_at)와는 다른 사건이다. */
export type EmploymentStatus = 'active' | 'left'

/** 표기 언어(0028). 새 i18n 체계가 아니다 — 이 사람이 ko/en 중 어느 쪽을 쓰는가다. */
export type PersonLanguage = 'ko' | 'en'

export const PERSON_LANGUAGE_LABEL_KO: Record<PersonLanguage, string> = {
  ko: '한국어',
  en: 'English',
}

/** user_profiles 한 행. 이메일이 없다 — auth.users는 PostgREST로 읽히지 않는다. */
export interface UserAccount {
  user_id: string
  role: Role
  display_name: string
  /** 0017이 만든 칸. 없으면 null이고 화면은 영문 줄을 아예 그리지 않는다 — 음차하지 않는다. */
  display_name_en: string | null
  title_ko: string
  max_security_class: SecurityClass
  /** 채워져 있으면 회수된 계정이다. 0002의 auth_profile()이 이 값으로 전 테이블을 동시에 닫는다. */
  revoked_at: string | null
  /** 이 사람이 보는 회사들. 전사 역할(Chairman/GroupCFO)은 빈 배열이고 그래도 전부 본다. */
  business_ids: string[]
  created_at: string
  /** 0025. 직속 상사. Chairman은 null이다 — 뿌리 위에는 아무도 없다. */
  reports_to: string | null
  /** 0025. 소속 팀. null이면 팀 미배정이고 조직도가 경고로 보여 준다. */
  team_id: string | null
  status: EmploymentStatus
  joined_on: IsoDate | null
  left_on: IsoDate | null
  language: PersonLanguage
  /**
   * 0032. profile-photos 버킷 안의 객체 경로. URL이 아니다 — 비공개 버킷이라 볼 때마다
   * 서명 URL을 발급한다(repo.signProfilePhotos). null이면 화면이 이름 첫 글자로 떨어진다.
   * 이 칸이 보이는 범위 = 이름이 보이는 범위다(같은 표의 같은 행이라 자동으로 그렇다).
   */
  photo_path: string | null
  /**
   * 0047. 사람 단위 모듈 권한(user_module_access). 회장 세션은 전부 읽고, 나머지는 자기 줄만 읽는다
   * (0002 module_access_self_read) — 그래서 회장이 아닌 사람의 조직도에서 남의 이 칸은 빈 배열이다.
   */
  modules: ModuleGrant[]
}

/** 0002 user_module_access 한 줄. 모듈 키는 05_Architecture의 경로다('/finance'). */
export interface ModuleGrant {
  module: string
  can_write: boolean
  can_approve: boolean
}

/**
 * 사용자 화면이 켜고 끄는 모듈 권한 목록(0047). 모듈을 더할 때 여기에 한 줄 — 칸 이름은 모듈마다 다르게 읽힌다
 * (재무는 can_write = 입력, can_approve = 월 마감). DB 판정은 각 모듈의 판정 함수가 한다(재무는 0047 finance_grant).
 */
export const MODULE_GRANT_OPTIONS: readonly {
  module: string
  label: string
  write: string
  approve: string
  note: string
}[] = [
  {
    module: '/finance',
    label: '재무',
    write: '재무 입력',
    approve: '월 마감',
    note: '전표 · 월별 손익 · 공식 재무제표 · 계정과목. 회사 범위는 «회사 범위»가 정합니다. 둘 다 끄면 재무를 못 봅니다.',
  },
]

export interface UserInvitation {
  invitation_id: string
  email: string
  role: Role
  max_security_class: SecurityClass
  business_ids: string[]
  display_name: string
  display_name_en: string | null
  title_ko: string
  invited_at: string
  /** 누가 불렀는가(0011 invited_by). 대기 초대 줄이 그 이름을 보여 준다. */
  invited_by: string | null
  /** 0026. 들어갈 자리(직속 상사). 회장이 아닌 초대자는 이것이 없으면 DB가 42501로 거부한다. */
  reports_to: string | null
  team_id: string | null
  joined_on: IsoDate | null
  language: PersonLanguage
  /**
   * 0025/0026. 회장 결재가 붙는가. **폼이 보내는 값이 아니다** —
   * user_invitations_set_approval 트리거가 role_rank(role) >= 2로 덮어쓴다.
   */
  chairman_approval_required: boolean
  /** 결재가 난 시각. required가 true인데 여기가 비어 있으면 계정이 생겨도 권한이 안 붙는다. */
  chairman_approved_at: string | null
  /** 계정이 생겨 권한이 실제로 붙은 시각. null이면 아직 기다리는 중이다. */
  accepted_at: string | null
  /** 수락 전에 취소한 시각. 이미 들어온 사람을 자르는 건 UserAccount.revoked_at이다. */
  revoked_at: string | null
}

/**
 * CH-049로 새 사람에게 줄 것. 이메일과 권한 한 벌.
 *
 * chairman_approval_required가 없다. 그건 서버(0026 트리거)가 정한다 — 보내 봐야 덮어쓰고,
 * 클라이언트가 정할 수 있으면 그것은 결재가 아니다.
 */
export interface NewInvitation {
  email: string
  role: Role
  max_security_class: SecurityClass
  business_ids: string[]
  display_name: string
  display_name_en: string | null
  title_ko: string
  /** 0026. 없으면 회장 외에는 DB가 거부한다(42501). 화면의 기본값은 초대자 자신이다. */
  reports_to: string | null
  team_id: string | null
  joined_on: IsoDate | null
  language: PersonLanguage
}

/** 0025 teams 한 행. 조직도의 가운데 층. */
export interface Team {
  team_id: string
  business_id: string
  name: string
  name_en: string
  /** null은 고장이 아니라 공석이다 — 조직도가 경고로 보여 준다(블록 B-2). */
  lead_user_id: string | null
}

/** 팀을 만들거나 고칠 때. team_id가 이미 있으면 고치는 것이다(0025 teams_write = Chairman). */
export interface TeamInput {
  team_id: string
  business_id: string
  name: string
  name_en: string
  lead_user_id: string | null
}

/**
 * 조직도 우측 패널이 고치는 칸들(0002 user_profiles_admin_write = Chairman).
 * 전부 선택이라 한 칸만 담아 보낼 수 있다 — audit_log의 before/after가 바뀐 것만 담는다.
 */
export interface ProfilePatch {
  role?: Role
  team_id?: string | null
  reports_to?: string | null
}

/** 0025 shares 한 행. 대상 셋의 기본키가 전부 text라 entity_id도 text다. */
export type ShareEntityTable = 'documents' | 'tasks' | 'projects'

export const SHARE_ENTITY_LABEL_KO: Record<ShareEntityTable, string> = {
  documents: '문서',
  tasks: '업무',
  projects: '프로젝트',
}

export interface ShareRecord {
  share_id: string
  entity_table: ShareEntityTable
  entity_id: string
  shared_with: string
  /** 받는 사람의 표시 이름. 못 찾으면 null이고 화면이 id를 대신 쓰지 않는다. */
  shared_with_name: string | null
  shared_by: string
  shared_by_name: string | null
  /** null = 무기한. 기간이 끝나면 shared_with_me()가 알아서 거른다. */
  expires_at: string | null
  created_at: string
}

/** 공유를 하나 연다. 기간은 화면에서 고른 값을 ISO로 옮긴 것이다. */
export interface NewShare {
  entity_table: ShareEntityTable
  entity_id: string
  shared_with: string
  expires_at: string | null
}

/**
 * 공유 대상 후보 한 사람(0028 company_people).
 * 이름 두 칸과 id뿐이다 — 역할·등급·이메일은 이 경로로 오지 않는다.
 */
export interface SharePerson {
  user_id: string
  display_name: string
  display_name_en: string | null
}

/**
 * 본인이 보는 자기 프로필 (Phase 5-E 2절, /settings/profile).
 *
 * UserAccount와 합치지 않는다. 저쪽은 **회장이 남을 볼 때**의 모양이라 회사 권한 목록과
 * 조직 트리 칸이 붙어 있고, 이쪽은 '내 이름·직함·생일'이다. 합치면 프로필 화면 하나가
 * 조직도 질의를 같이 끌고 온다.
 *
 * birth_date는 [제한] 등급이다 — 본인과 Chairman만 읽는다(0002 user_profiles_self_read).
 */
export interface MyProfile {
  user_id: string
  role: Role
  display_name: string
  display_name_en: string | null
  title_ko: string
  birth_date: IsoDate | null
  language: PersonLanguage
  max_security_class: SecurityClass
  created_at: string
  /** 0032. 버킷 안 경로. URL이 아니다. null이면 사진이 없다. */
  photo_path: string | null
}

/**
 * 프로필 폼이 보내는 것. **role도 max_security_class도 여기 없다** —
 * 0030 update_own_profile()이 만지는 칸이 정확히 이 다섯이고, 그것이 이 문이 좁은 이유다.
 */
export interface MyProfilePatch {
  display_name: string
  display_name_en: string | null
  title_ko: string | null
  birth_date: IsoDate | null
  language: PersonLanguage
}
