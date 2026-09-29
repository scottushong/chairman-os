import { kstToday } from '@/lib/chairman-project'
import {
  ROLE,
  type DocumentRecord,
  type ModuleGrant,
  type Project,
  type Role,
  type ShareRecord,
  type Task,
  type Team,
  type UserAccount,
  type UserInvitation,
} from '@/types'

/**
 * dummy 모드의 조직도 시드 — 사람 · 팀 · 일감 · 공유.
 *
 * **왜 있는가.** 0026이 사람·업무·문서의 읽기를 subtree로 잘랐고, 회장 지시의 검증 a~f는
 * 그 결과를 **화면에서** 네 세션(Chairman / DY 대표 / 영업팀장 / 영업 직원)으로 확인하라고
 * 한다. dummy에는 auth.users도 user_profiles도 없어 그때까지 계정 목록이 늘 비어 있었고,
 * 그래서 조직도 화면을 한 번도 눈으로 볼 수 없었다. 이 파일이 그 빈자리를 채운다.
 *
 * **여기 있는 것은 DB 흉내다. 화면의 규칙이 아니다.**
 * 이 파일의 subtree·공유·공개등급 판정은 0025/0026/0027의 **정책을 옮겨 적은 것**이고,
 * live 모드에서는 한 줄도 돌지 않는다(그쪽은 RLS가 판정한다). 화면 코드는 어느 쪽에서도
 * 가시성을 다시 검사하지 않는다 — 검사하면 규칙이 세 곳(정책·이 파일·화면)으로 갈라진다.
 *
 * 이 트리는 scripts/check-migrations.ts의 H(그리고 subtreeRls의 일감)와 **같은 모양**이다.
 * 두 벌을 다르게 만들면 "DB에서는 되는데 화면에서는 안 된다"를 매번 새로 조사하게 된다.
 *
 *   회장 ─ DY 대표 ─┬─ 경영지원팀장 (0047 — 재무 입력 권한, 첫 실사용자의 자리)
 *                   └─ 영업본부장 ─┬─ 영업팀장 ─┬─ 영업 직원
 *                                  │            ├─ 영업 직원 2
 *                                  │            └─ 영업 직원 3
 *                                  ├─ 구매팀장 ─── 구매 직원
 *                                  └─ (퇴사자)
 *   회장 ─ 시스템 계정 둘(Integration · AI Agent)
 *   (배치 전 신입 한 명은 트리에 매달려 있지 않다 — 조직도가 경고로 보여 준다)
 */

/** 사람 id. uuid 모양을 유지한다 — live와 같은 자리에 같은 종류의 값이 들어가야 한다. */
export const DUMMY_UID = {
  chair: '00000000-0000-0000-0000-0000000d0001',
  dyCeo: '00000000-0000-0000-0000-0000000d0002',
  exec: '00000000-0000-0000-0000-0000000d0003',
  salesLead: '00000000-0000-0000-0000-0000000d0004',
  salesStaff: '00000000-0000-0000-0000-0000000d0005',
  salesStaff2: '00000000-0000-0000-0000-0000000d0006',
  salesStaff3: '00000000-0000-0000-0000-0000000d0007',
  buyLead: '00000000-0000-0000-0000-0000000d0008',
  buyStaff: '00000000-0000-0000-0000-0000000d0009',
  newbie: '00000000-0000-0000-0000-0000000d000a',
  leaver: '00000000-0000-0000-0000-0000000d000b',
  integration: '00000000-0000-0000-0000-0000000d000c',
  aiAgent: '00000000-0000-0000-0000-0000000d000d',
  supportLead: '00000000-0000-0000-0000-0000000d000e',
} as const

const DAY = 86_400_000

/** 오늘(KST)에서 n일 전/후. 30일 입퇴사 이력이 시드 날짜에 상관없이 늘 서게 한다. */
function shift(n: number): string {
  return kstToday(new Date(Date.now() + n * DAY))
}

function iso(n: number): string {
  return new Date(Date.now() + n * DAY).toISOString()
}

const DY = 'biz_dy'

/**
 * 팀 다섯. 0025:141의 시드와 같은 team_id·이름이다.
 * 경영지원은 0047부터 팀장이 있다(첫 실사용자의 자리 — 재무 입력 권한을 dummy에서 눈으로 보기 위해).
 * 팀장이 없는 팀 둘(생산·연구소)은 일부러 비워 둔다 — 블록 B-2의 경고 세 종 중
 * 하나가 그것이고, 경고가 한 번도 뜨지 않는 시드로는 '고치는 곳으로 데려가는' 동선을 볼 수 없다.
 */
export const DUMMY_TEAMS: Team[] = [
  { team_id: 'team_dy_sales', business_id: DY, name: '영업', name_en: 'Sales', lead_user_id: DUMMY_UID.salesLead },
  { team_id: 'team_dy_production', business_id: DY, name: '생산', name_en: 'Production', lead_user_id: null },
  { team_id: 'team_dy_support', business_id: DY, name: '경영지원', name_en: 'Management Support', lead_user_id: DUMMY_UID.supportLead },
  { team_id: 'team_dy_purchasing', business_id: DY, name: '구매', name_en: 'Purchasing', lead_user_id: DUMMY_UID.buyLead },
  { team_id: 'team_dy_rnd', business_id: DY, name: '연구소', name_en: 'R&D', lead_user_id: null },
]

function person(
  user_id: string,
  role: Role,
  display_name: string,
  display_name_en: string | null,
  title_ko: string,
  reports_to: string | null,
  team_id: string | null,
  extra: Partial<UserAccount> = {},
): UserAccount {
  return {
    user_id,
    role,
    display_name,
    display_name_en,
    title_ko,
    max_security_class: 'Normal',
    revoked_at: null,
    // 전사 역할(Chairman/GroupCFO)은 빈 배열이고 그래도 전부 본다 — 0002 has_group_scope().
    business_ids: role === 'Chairman' || role === 'GroupCFO' ? [] : [DY],
    created_at: iso(-400),
    reports_to,
    team_id,
    status: 'active',
    joined_on: shift(-400),
    left_on: null,
    language: 'ko',
    // 0032. 시드에는 사진이 없다 — 화면 곳곳의 동그라미가 이름 첫 글자로 떨어지는 것이
    // 기본 모양이고, 그 모양을 먼저 볼 수 있어야 한다. dummy에서 올리면 메모리에 붙는다.
    photo_path: null,
    // 0047. 사람 단위 모듈 권한. 기본은 없다 — 역할로 이미 되는 사람(회장 · CFO · 대표)은 줄이 필요 없다.
    modules: [],
    ...extra,
  }
}

export const DUMMY_PEOPLE: UserAccount[] = [
  // Phase 5-E 2절. 시드의 회장이 '회장'이라는 역할명으로 서 있었다 — 그래서 dummy에서
  // 헤더도 인사말도 "안녕하세요, 회장님"이 아니라 "회장 님"으로 읽혔다.
  // 실제 이름을 둔다(0030 3절이 DB 쪽 값을 같은 값으로 고친다).
  person(DUMMY_UID.chair, 'Chairman', '홍석현', 'Edison S. Hong', '회장', null, null, {
    max_security_class: 'Vault',
  }),
  person(DUMMY_UID.dyCeo, 'BusinessCEO', 'DY 대표', 'DY CEO', '대표이사', DUMMY_UID.chair, null, {
    max_security_class: 'Restricted',
  }),
  // 0047. DY 경영지원 팀장 — 첫 실사용자의 자리. 가입 트리거(finance_default_grant)가 주는 기본값과 같다:
  // 재무 입력 O · 월 마감 X. biz_dy만 가진다(다른 회사 재무는 존재하지 않는 것처럼 보인다).
  person(DUMMY_UID.supportLead, 'TeamLead', '경영지원팀장', 'Management Support Team Lead', '팀장', DUMMY_UID.dyCeo, 'team_dy_support', {
    modules: [{ module: '/finance', can_write: true, can_approve: false }],
  }),
  person(DUMMY_UID.exec, 'Executive', '영업본부장', 'Sales Executive', '본부장', DUMMY_UID.dyCeo, 'team_dy_sales', {
    max_security_class: 'Restricted',
  }),
  person(DUMMY_UID.salesLead, 'TeamLead', '영업팀장', 'Sales Team Lead', '팀장', DUMMY_UID.exec, 'team_dy_sales'),
  person(DUMMY_UID.salesStaff, 'Member', '영업 직원', 'Sales Staff', '사원', DUMMY_UID.salesLead, 'team_dy_sales'),
  person(DUMMY_UID.salesStaff2, 'Member', '영업 직원 2', null, '사원', DUMMY_UID.salesLead, 'team_dy_sales'),
  // 입사 5일째. 블록 B-5의 '30일 입퇴사 이력'이 이 사람을 잡는다.
  person(DUMMY_UID.salesStaff3, 'Member', '영업 직원 3', null, '사원', DUMMY_UID.salesLead, 'team_dy_sales', {
    joined_on: shift(-5),
    created_at: iso(-5),
  }),
  person(DUMMY_UID.buyLead, 'TeamLead', '구매팀장', 'Purchasing Team Lead', '팀장', DUMMY_UID.exec, 'team_dy_purchasing'),
  person(DUMMY_UID.buyStaff, 'Member', '구매 직원', null, '사원', DUMMY_UID.buyLead, 'team_dy_purchasing'),
  // 경고 두 종을 한 사람이 같이 진다: 팀 미배정 + 상사 없음. 트리에 매달려 있지 않아
  // 회장 말고는 아무에게도 보이지 않는다 — 그것이 0026의 정책이 하는 일 그대로다.
  person(DUMMY_UID.newbie, 'Member', '신입 (배치 전)', null, '사원', null, null, {
    joined_on: shift(-2),
    created_at: iso(-2),
  }),
  // 12일 전에 나간 사람. 회수는 삭제가 아니라 상태다 — 목록에 남아 있어야 되돌릴 수도 있다.
  person(DUMMY_UID.leaver, 'Member', '퇴사자', null, '사원', DUMMY_UID.exec, 'team_dy_production', {
    status: 'left',
    left_on: shift(-12),
    revoked_at: iso(-12),
  }),
  // 시스템 계정 둘. 조직도는 이들을 사람과 섞지 않고 따로 탭으로 뺀다(블록 B-6).
  // 이름이 'ECOUNT Sync'가 아니라 'Integration'인 이유는 0028 5절에 적었다.
  person(DUMMY_UID.integration, 'Integration', 'Integration', null, 'ECOUNT 동기화', DUMMY_UID.chair, null, {
    max_security_class: 'Restricted',
  }),
  person(DUMMY_UID.aiAgent, 'AIAgent', 'AI Agent', null, '야간 Job', DUMMY_UID.chair, null),
]

const BY_ID = new Map(DUMMY_PEOPLE.map((p) => [p.user_id, p]))

export function dummyPerson(userId: string | null): UserAccount | undefined {
  return userId ? BY_ID.get(userId) : undefined
}

/**
 * 지금 화면을 보고 있는 사람(dummy).
 *
 *   DUMMY_USER=sales_lead   이 시드의 키로 직접 고른다(검증 4세션이 이것을 쓴다).
 *   DUMMY_ROLE=TeamLead     역할로 고른다. 그 역할의 첫 사람이다 — 예전 개발 습관을 그대로 둔다.
 *   둘 다 없으면 회장이다.
 *
 * 서버 전용 환경변수다(NEXT_PUBLIC_ 접두사가 없다). 브라우저에서는 바꿀 수 없다.
 */
export const DUMMY_SESSION_KEY: Record<string, string> = {
  chairman: DUMMY_UID.chair,
  dy_ceo: DUMMY_UID.dyCeo,
  exec: DUMMY_UID.exec,
  sales_lead: DUMMY_UID.salesLead,
  sales_staff: DUMMY_UID.salesStaff,
  buy_lead: DUMMY_UID.buyLead,
  buy_staff: DUMMY_UID.buyStaff,
  support_lead: DUMMY_UID.supportLead,
}

export function dummyViewer(): UserAccount {
  const key = process.env.DUMMY_USER?.trim().toLowerCase()
  const byKey = key ? BY_ID.get(DUMMY_SESSION_KEY[key] ?? '') : undefined
  if (byKey) return byKey

  const role = ROLE.find((r) => r === process.env.DUMMY_ROLE)
  const byRole = role ? DUMMY_PEOPLE.find((p) => p.role === role && !p.revoked_at) : undefined
  return byRole ?? BY_ID.get(DUMMY_UID.chair)!
}

/**
 * 0047. dummy의 user_module_access. 사용자 화면에서 켜고 끈 것이 서버가 살아 있는 동안 남는다.
 * 세션(lib/auth/session.ts)과 조직도(dummy.ts listUserAccounts)가 **같은 저장소**를 본다 — 두 벌이면
 * 회장이 켠 권한이 조직도에는 보이는데 그 사람의 화면에는 안 붙는다.
 */
const moduleGrants = new Map<string, ModuleGrant[]>(DUMMY_PEOPLE.map((p) => [p.user_id, p.modules.map((m) => ({ ...m }))]))

export function dummyModuleGrants(userId: string): ModuleGrant[] {
  return (moduleGrants.get(userId) ?? []).map((m) => ({ ...m }))
}

/** 두 칸이 다 false면 줄을 지운다 — live의 setModuleGrant와 같다. */
export function setDummyModuleGrant(userId: string, grant: ModuleGrant): void {
  const rest = (moduleGrants.get(userId) ?? []).filter((m) => m.module !== grant.module)
  moduleGrants.set(userId, grant.can_write || grant.can_approve ? [...rest, { ...grant }] : rest)
}

/** 0047 finance_grant()를 옮겨 적은 것. 사람 역할만 — 시스템 계정은 줄이 있어도 false. */
export function dummyFinanceGrant(viewer: UserAccount, need: 'read' | 'write' | 'approve'): boolean {
  if (viewer.revoked_at || viewer.role === 'AIAgent' || viewer.role === 'Integration') return false
  const row = dummyModuleGrants(viewer.user_id).find((m) => m.module === '/finance')
  if (!row) return false
  return need === 'read' || (need === 'write' ? row.can_write : row.can_approve)
}

export function dummyViewerId(): string {
  return dummyViewer().user_id
}

/**
 * 0025 in_my_subtree()는 여기 없다 — dummy.ts가 **지금 상태**(화면에서 상사를 옮긴 결과까지
 * 반영된 memoryPeople) 위에서 같은 재귀를 돈다. 시드 배열을 보는 두 번째 구현을 여기 두면
 * 상사를 옮긴 순간 두 답이 갈라진다.
 */

/** 0002 has_business()를 옮겨 적은 것. 전사 역할은 무조건 통과한다. */
export function dummyHasBusiness(viewer: UserAccount, businessId: string | null): boolean {
  if (viewer.role === 'Chairman' || viewer.role === 'GroupCFO') return true
  if (!businessId) return false
  return viewer.business_ids.includes(businessId)
}

/**
 * 0026 owner_unknown()을 옮겨 적은 것.
 * 시드(src/data)의 담당자 'user_001'은 이 조직도에 없는 사람이라 '주인 없는 행'이 된다 —
 * live에서 0003 시드의 가상 uuid가 그렇게 읽히는 것과 같은 상태다. 회사 규칙으로만 걸린다.
 */
export function dummyOwnerUnknown(ownerId: string | null): boolean {
  return !ownerId || !BY_ID.has(ownerId)
}

// ── 일감 ────────────────────────────────────────────────────────────────
//   시드(src/data)의 다섯 프로젝트·다섯 업무는 그대로 둔다. 거기에 **담당자가 분명한**
//   DY 행들을 얹는다 — 검증 b("영업 직원 = 본인 + 팀 공유분, 팀장 업무 0건")는 주인이
//   분명한 행이 있어야만 재어진다.

export interface OwnedProject {
  project: Project
  owner_user_id: string
}

export interface OwnedTask {
  task: Task
  owner_user_id: string
}

export interface OwnedDocument {
  document: Omit<DocumentRecord, 'uploaded_by'>
  owner_user_id: string
}

export const DUMMY_PROJECTS: OwnedProject[] = [
  {
    owner_user_id: DUMMY_UID.salesLead,
    project: {
      project_id: 'prj_dy_sales',
      business_id: DY,
      name: 'DY 영업 확대',
      owner: DUMMY_UID.salesLead,
      priority: 'High',
      status: 'Doing',
      progress_pct: 40,
      deadline: shift(45),
    },
  },
  {
    owner_user_id: DUMMY_UID.buyLead,
    project: {
      project_id: 'prj_dy_buy',
      business_id: DY,
      name: 'DY 구매 단가 재협상',
      owner: DUMMY_UID.buyLead,
      priority: 'Medium',
      status: 'Doing',
      progress_pct: 80,
      deadline: shift(20),
    },
  },
]

export const DUMMY_TASKS: OwnedTask[] = [
  {
    owner_user_id: DUMMY_UID.salesLead,
    task: {
      task_id: 'tsk_dy_lead',
      project_id: 'prj_dy_sales',
      title: '대리점 계약 조건 확정',
      owner: DUMMY_UID.salesLead,
      priority: 'High',
      status: 'Doing',
      blocked_since: shift(-6),
      deadline: shift(10),
      chairman_needed: false,
    },
  },
  {
    owner_user_id: DUMMY_UID.salesStaff,
    task: {
      task_id: 'tsk_dy_staff',
      project_id: 'prj_dy_sales',
      title: '9월 거래처 방문 정리',
      owner: DUMMY_UID.salesStaff,
      priority: 'Medium',
      status: 'Doing',
      blocked_since: shift(-3),
      deadline: shift(7),
      chairman_needed: false,
    },
  },
  {
    owner_user_id: DUMMY_UID.buyStaff,
    task: {
      task_id: 'tsk_dy_buy',
      project_id: 'prj_dy_buy',
      title: '원자재 견적 비교',
      owner: DUMMY_UID.buyStaff,
      priority: 'Medium',
      status: 'Todo',
      blocked_since: shift(-2),
      deadline: shift(12),
      chairman_needed: false,
    },
  },
]

export const DUMMY_DOCUMENTS: OwnedDocument[] = [
  {
    owner_user_id: DUMMY_UID.salesLead,
    document: {
      document_id: 'doc_dy_sales',
      business_id: DY,
      title: 'DY 대리점 표준계약서',
      doc_type: 'Contract',
      security_class: 'Normal',
      storage_url: 'https://intranet.example.co.kr/docs/dy-standard-contract',
      version: 1,
      created_at: iso(-20),
    },
  },
  {
    owner_user_id: DUMMY_UID.buyLead,
    document: {
      document_id: 'doc_dy_buy',
      business_id: DY,
      title: 'DY 원자재 단가표 (구매팀)',
      doc_type: 'Price',
      security_class: 'Normal',
      storage_url: 'https://intranet.example.co.kr/docs/dy-raw-price',
      version: 3,
      created_at: iso(-9),
    },
  },
  {
    owner_user_id: DUMMY_UID.buyLead,
    document: {
      document_id: 'doc_dy_old',
      business_id: DY,
      title: 'DY 8월 견적 비교 (지난 자료)',
      doc_type: 'Price',
      security_class: 'Normal',
      storage_url: 'https://intranet.example.co.kr/docs/dy-aug-quotes',
      version: 1,
      created_at: iso(-40),
    },
  },
  {
    owner_user_id: DUMMY_UID.dyCeo,
    document: {
      document_id: 'doc_dy_notice',
      business_id: DY,
      title: '[공지] 추석 연휴 근무 안내',
      doc_type: 'Notice',
      // 공개 등급. 같은 회사면 위계와 무관하게 전 직원에게 보인다(0026 2-5절, 검증 e).
      security_class: 'Public',
      storage_url: 'https://intranet.example.co.kr/docs/holiday-notice',
      version: 1,
      created_at: iso(-4),
    },
  },
]

/**
 * 공유 시드 둘 — 검증 c를 화면에서 **기다리지 않고** 보게 한다.
 *
 * 살아 있는 것 하나(7일 남음)와 이미 만료된 것 하나. 만료된 쪽이 '공유받은 목록'에서
 * 사라지는 것이 이 표의 요점이다 — 사람이 회수를 잊어도 닫힌다(0025 shares.expires_at).
 */
export const DUMMY_SHARE_SEED: ShareRecord[] = [
  {
    share_id: 'shr_dummy_live',
    entity_table: 'documents',
    entity_id: 'doc_dy_buy',
    shared_with: DUMMY_UID.salesLead,
    shared_with_name: '영업팀장',
    shared_by: DUMMY_UID.buyLead,
    shared_by_name: '구매팀장',
    expires_at: iso(7),
    created_at: iso(-1),
  },
  {
    share_id: 'shr_dummy_expired',
    entity_table: 'documents',
    entity_id: 'doc_dy_old',
    shared_with: DUMMY_UID.salesLead,
    shared_with_name: '영업팀장',
    shared_by: DUMMY_UID.buyLead,
    shared_by_name: '구매팀장',
    expires_at: iso(-1),
    created_at: iso(-30),
  },
]

/**
 * 대기 초대 시드 둘 — 블록 B-5와 검증 d를 화면에서 보게 한다.
 *
 * 둘 다 **영업팀장이** 부른 사람이다(위임 초대). 하나는 직원이라 결재가 없고, 하나는
 * 임원이라 회장 결재 큐에 걸려 있다 — 그 둘이 같은 목록에서 어떻게 다르게 보이는지가
 * 검증 d가 화면에서 확인해야 하는 것이다. 시드가 없으면 이 절은 늘 '대기 중인 초대가
 * 없습니다'로만 보이고, '결재 승인' 버튼을 한 번도 볼 수 없다.
 *
 * chairman_approval_required는 시드에서도 지어내지 않고 needsChairmanApproval()로 낸다 —
 * 0026의 트리거와 같은 기준이어야 한다.
 */
export const DUMMY_INVITATION_SEED: UserInvitation[] = [
  {
    invitation_id: 'inv_dummy_member',
    email: 'newsales@example.co.kr',
    role: 'Member',
    max_security_class: 'Normal',
    business_ids: [DY],
    display_name: '박신입',
    display_name_en: null,
    title_ko: '사원',
    invited_by: DUMMY_UID.salesLead,
    invited_at: iso(-3),
    reports_to: DUMMY_UID.salesLead,
    team_id: 'team_dy_sales',
    joined_on: shift(3),
    language: 'ko',
    chairman_approval_required: false,
    chairman_approved_at: null,
    accepted_at: null,
    revoked_at: null,
  },
  {
    invitation_id: 'inv_dummy_exec',
    email: 'newexec@example.co.kr',
    role: 'Executive',
    max_security_class: 'Restricted',
    business_ids: [DY],
    display_name: '최임원',
    display_name_en: 'Choi Executive',
    title_ko: '본부장',
    invited_by: DUMMY_UID.salesLead,
    invited_at: iso(-1),
    reports_to: DUMMY_UID.salesLead,
    team_id: 'team_dy_sales',
    joined_on: null,
    language: 'ko',
    chairman_approval_required: true,
    chairman_approved_at: null,
    accepted_at: null,
    revoked_at: null,
  },
]

/** 0025 shared_with_me()를 옮겨 적은 것: 받는 사람이 나이고, 만료되지 않았는가. */
export function dummySharedWithMe(shares: ShareRecord[], viewerId: string, table: string, id: string): boolean {
  return shares.some(
    (s) =>
      s.entity_table === table &&
      s.entity_id === id &&
      s.shared_with === viewerId &&
      (s.expires_at === null || Date.parse(s.expires_at) > Date.now()),
  )
}
