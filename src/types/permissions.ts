import type { SecurityClass } from './enums'
import type { BusinessId } from './primitives'

/** 02_기능명세 04_권한 시트. Default Deny / Least Privilege / Business Isolation. */

export const ROLE = [
  'Chairman',
  'GroupCFO',
  'BusinessCEO',
  'Executive',
  'TeamLead',
  'Member',
  'ExternalExpert',
  'Vendor',
  'AIAgent',
  // 0015가 DB의 app_role에 더한 값인데 이 목록에는 없었다. 그래서 조직도(Phase 6-1 블록 B)가
  // 시스템 계정 탭을 그리는 순간 그 행의 역할 이름이 undefined로 떨어졌다 — 타입이 실제
  // enum보다 좁았던 것이다. 초대할 수 있는 역할은 아니다(아래 INVITABLE_ROLE).
  'Integration',
] as const
export type Role = (typeof ROLE)[number]

export const ROLE_LABEL_KO: Record<Role, string> = {
  Chairman: 'Chairman',
  GroupCFO: 'Group CFO',
  BusinessCEO: 'Business CEO',
  Executive: '임원',
  TeamLead: '팀장',
  Member: '직원',
  ExternalExpert: '외부전문가',
  Vendor: '외주 개발자',
  AIAgent: 'AI Agent',
  // 회장 지시 블록 B-6: 'ECOUNT Sync'가 아니라 'Integration'이다. 그 계정이 하는 일은
  // ECOUNT만이 아니다(0015의 Integration 역할은 원장 다섯 표를 쓴다).
  Integration: 'Integration',
}

/**
 * 사람이 아닌 계정. 조직도(블록 B)는 이 둘을 사람과 섞지 않고 '시스템 계정' 탭으로 뺀다.
 *
 * 둘 다 로그인해서 RLS 안에서 도는 진짜 계정이다(이 프로젝트에 service_role은 없다).
 * 사람 트리에 섞이면 '누가 누구 밑인가'가 흐려지고, 0026의 백필이 이 계정들도
 * 회장 아래로 붙여 두었기 때문에 실제로 트리에 나타난다.
 */
export const SYSTEM_ROLE: readonly Role[] = ['AIAgent', 'Integration']

/**
 * 초대로 만들 수 있는 역할.
 *
 * 시스템 계정은 여기 없다. 그 둘은 Supabase Dashboard에서 계정을 만들고
 * supabase/bootstrap/0005·0006을 손으로 실행해 붙이는 것이지, 사람을 부르는 초대장으로
 * 만드는 것이 아니다 — 초대로 만들면 회사 범위·등급이 사람 규칙으로 정해진다.
 */
export const INVITABLE_ROLE: readonly Role[] = ROLE.filter((r) => !SYSTEM_ROLE.includes(r))

/**
 * 0026 role_rank()와 같은 순서. 초대 폼이 "회장 결재가 필요합니다"를 **미리** 말할 때 쓴다.
 * 실제 강제는 0026의 user_invitations_set_approval 트리거가 한다 — 화면은 그 트리거와
 * 같은 기준을 쓸 뿐이고, 두 곳이 갈라지면 화면이 거짓말을 한다.
 */
const ROLE_RANK: Record<Role, number> = {
  Chairman: 5,
  GroupCFO: 4,
  BusinessCEO: 3,
  Executive: 2,
  TeamLead: 1,
  Member: 0,
  ExternalExpert: -1,
  Vendor: -1,
  AIAgent: -1,
  Integration: -1,
}

export function roleRank(role: Role): number {
  return ROLE_RANK[role] ?? -1
}

/** Executive 이상인가(role_rank >= 2). 이 초대는 회장 결재 큐로 간다. */
export function needsChairmanApproval(role: Role): boolean {
  return roleRank(role) >= 2
}

export type PermissionAction = 'read' | 'write' | 'approve' | 'comment'

export interface RolePolicy {
  role: Role
  /** 'all'이면 전사. 아니면 명시된 Business만 본다. */
  business_scope: 'all' | BusinessId[]
  module_scope: 'all' | string[]
  actions: PermissionAction[]
  /** 접근 가능한 최고 보안등급. 여기 없는 등급은 값 자체를 내려보내지 않는다. */
  max_security_class: SecurityClass
}

export interface SessionUser {
  user_id: string
  name: string
  role: Role
  title_ko: string
  /**
   * 영문 표기(0017이 만든 user_profiles.display_name_en).
   * 없으면 null이다 — 코드가 음차하지 않는다는 것이 0017의 명시적 판단이라,
   * 읽는 쪽은 '없으면 영문 줄을 아예 안 그린다'로 떨어진다. 한글을 로마자로 지어내지 않는다.
   */
  display_name_en: string | null
  /**
   * 화면 언어(0028 user_profiles.language). Phase 9부터 새 화면이 이 값으로 ko/en을 고른다
   * (lib/i18n.ts). 값이 없거나 읽지 못하면 'ko'다.
   */
  language: 'ko' | 'en'
  /**
   * 0047. 본인의 재무 모듈 권한, 회사별(business_id → 칸 둘). user_module_access '/finance/<business_id>' 줄을
   * 0002 module_access_self_read로 자기 것만 읽는다. 역할로 이미 되는 사람(Chairman · GroupCFO · BusinessCEO)은
   * 줄이 없어 비어 있을 수 있다 — 화면 판정은 lib/auth/roles.ts가 역할과 이 값을 합쳐서 한다.
   * 줄이 없거나 못 읽으면 그 회사는 키가 없다(= 둘 다 false).
   */
  finance: Record<string, { write: boolean; close: boolean }>
  /**
   * 0048. 본인의 문서 등록 권한, 회사별(business_id → 칸 하나). user_module_access '/documents/<business_id>'의 can_write.
   * 회장은 역할로 이미 되므로 비어 있을 수 있다. 화면 판정은 lib/auth/roles.ts canWriteDocuments가 한다.
   * 없으면(옛 세션 객체 · 카카오 질문자) 빈 값으로 본다.
   */
  documents?: Record<string, { write: boolean }>
  /** 0048. 옛 전역 키 '/core/search'의 쓰기 칸 — can_write_documents()가 남긴 분기. 회사 범위 안 전부를 연다. */
  documents_legacy_write?: boolean
  /**
   * «결재 올리기» — user_module_access '/chairman/decisions'의 can_write(0002 decisions_create가 보는 줄).
   * 안내용이다(판정은 DB). AI 어시스턴트가 결재 카드를 만들기 전에 «권한이 없습니다»를 먼저 말하는 데 쓴다.
   * 없으면(옛 세션 객체 · 카카오 질문자) 모르는 것으로 보고 DB 판정에 맡긴다.
   */
  approvals_write?: boolean
}
