import type { Role, SessionUser } from '@/types'

/**
 * 화면이 무엇을 보여 줄지 정하는 자리. 무엇을 허용할지 정하는 자리가 아니다.
 *
 * 이 파일의 함수들은 전부 '안내'다. 진짜 판정은 0002/0008의 RLS 정책이 한다 —
 * 여기서 false가 나온 사람이 Server Action을 직접 불러도 DB가 거부한다.
 * 그래서 이 값이 틀려도 데이터는 새지 않는다. 틀리면 보여야 할 버튼이 안 보일 뿐이다.
 *
 * 반대로 두면(화면 판정을 믿고 DB를 열어 두면) 우회 경로가 하나 더 생긴다.
 * 05_Architecture 6번 원칙이 금지하는 게 그것이다.
 */

/** 0002의 can_approve()와 같은 목록이어야 한다. 두 곳이 갈라지면 화면과 DB가 다른 말을 한다. */
const APPROVER: readonly Role[] = ['Chairman', 'BusinessCEO']

/** CH-024 전략 좌표를 고칠 수 있는가. 0008 business_strategy_write = can_approve(). */
export function canEditStrategy(user: SessionUser | null): boolean {
  return user !== null && APPROVER.includes(user.role)
}

/**
 * CH-041 기안을 올릴 수 있는가.
 *
 * 0002의 decisions_create는 can_module('/chairman/decisions', true)를 본다.
 * Chairman은 can_module이 무조건 참이고, 나머지는 user_module_access에 그 줄이 있어야 한다 —
 * 그 표는 화면이 읽지 않는다(본인 것만 읽을 수 있고, 한 번 더 왕복해야 한다).
 *
 * 그래서 여기서는 '로그인한 사람'이면 폼을 연다. 권한이 없으면 저장할 때 DB가 거부하고
 * 그 문장을 그대로 보여 준다. 눌러 보기 전에는 알 수 없다는 뜻이라 완벽하지 않지만,
 * 권한 표를 화면이 미리 읽어 판정을 흉내 내는 것보다 낫다 — 그건 판정이 두 곳으로 갈라지는 길이다.
 */
export function canDraftDecision(user: SessionUser | null): boolean {
  return user !== null
}

/** CH-049 RBAC. 사용자 초대·권한 회수는 Chairman만이다(0002 user_profiles_admin_write). */
export function canManageUsers(user: SessionUser | null): boolean {
  return user?.role === 'Chairman'
}

/** Phase 3-B 회장 루틴. 0014의 chairman_* 쓰기 정책이 Chairman만 통과시킨다. */
export function canEditChairmanRoutine(user: SessionUser | null): boolean {
  return user?.role === 'Chairman'
}

/**
 * Phase 2-B 자체 장부. 0016 · 0047의 can_keep_books(target) · can_close_books(target)와 같은 판정이어야 한다.
 *   역할   Chairman · GroupCFO · BusinessCEO(자기 회사 — 회사 범위는 화면이 흉내 내지 않는다)
 *   사람   user_module_access '/finance/<business_id>' 줄(0047) — 회장이 사용자 화면에서 사람 × 회사마다 켠다.
 *          DY 경영지원 팀장은 회장이 넣거나 승인한 초대로 가입할 때 DY 입력 권한을 기본으로 받는다.
 *
 * 위 canDraftDecision은 모듈 표를 화면이 읽지 않는 쪽을 골랐다. 재무는 다르게 간다 — 회장이 «이 사람에게
 * 재무 입력을 준다»를 사람 단위로 지시했고(2026-09-29), 입력 폼이 통째로 서느냐 마느냐가 그 값에 달려 있어서
 * «눌러 보기 전에는 모른다»로는 첫 실사용자가 화면을 못 쓴다. 그래서 세션이 **본인 줄**만 읽어 온다
 * (lib/auth/session.ts의 SessionUser.finance — 0002 module_access_self_read). 판정은 여전히 DB가 한다:
 * 이 값이 틀려도 보여야 할 버튼이 안 보이거나 눌러서 거부될 뿐 데이터는 새지 않는다.
 * 모듈 권한은 **그 회사의 키**로만 본다 — 회사 접근이 있어도 그 회사 줄이 없으면 입력 폼을 그리지 않는다(DB와 같다).
 */
const BOOKKEEPER: readonly Role[] = ['Chairman', 'GroupCFO', 'BusinessCEO']

/** 시스템 계정은 모듈 줄이 있어도 사람 권한이 아니다(0047 finance_grant()). */
const SYSTEM: readonly Role[] = ['AIAgent', 'Integration']

/** 이 회사의 계정과목 · 전표 · 월별 손익 · 공식 재무제표를 쓸 수 있는가(안내). */
export function canKeepBooks(user: SessionUser | null, businessId: string): boolean {
  if (user === null) return false
  if (BOOKKEEPER.includes(user.role)) return true
  return !SYSTEM.includes(user.role) && user.finance[businessId]?.write === true
}

/** 이 회사의 월을 마감할 수 있는가(안내). 0047 can_close_books(target)와 같다 — 역할 둘 + 그 회사의 can_approve. */
export function canCloseBooks(user: SessionUser | null, businessId: string): boolean {
  if (user === null) return false
  if (user.role === 'Chairman' || user.role === 'GroupCFO') return true
  return !SYSTEM.includes(user.role) && user.finance[businessId]?.close === true
}

/**
 * 0048 문서 등록(documents · doc_folders 쓰기) — can_write_documents(target)와 같은 판정이어야 한다(안내).
 *   역할   Chairman만(그룹 공통 문서도 회장만).
 *   사람   user_module_access '/documents/<business_id>' 쓰기 줄 — 회장이 사용자 화면에서 사람 × 회사마다 켠다.
 *   옛 줄  '/core/search' 쓰기(전역) — DB가 남긴 분기라 화면도 같이 본다. 회사 범위(has_business)는 화면이 흉내 내지 않는다
 *          — 회사 고르기 목록이 이미 그 사람에게 보이는 회사뿐이다.
 * 시스템 계정은 줄이 있어도 false(0048 document_grant()). 그룹 공통('group')은 회장 · 옛 줄만.
 */
export function canWriteDocuments(user: SessionUser | null, businessId: string): boolean {
  if (user === null || SYSTEM.includes(user.role)) return false
  if (user.role === 'Chairman') return true
  // 그룹 공통(business_id null)은 has_business(null) — 전사 역할만. 그 위에 쓰기 분기가 있어야 한다.
  if (businessId === 'group') return user.role === 'GroupCFO' && user.documents_legacy_write === true
  if (user.documents_legacy_write === true) return true
  return user.documents?.[businessId]?.write === true
}

/** 어느 회사든 문서를 등록할 수 있는가(«링크 등록» · «+ 폴더»를 그릴지). */
export function canWriteAnyDocuments(user: SessionUser | null): boolean {
  if (user === null || SYSTEM.includes(user.role)) return false
  if (user.role === 'Chairman' || user.documents_legacy_write === true) return true
  return Object.values(user.documents ?? {}).some((g) => g.write)
}

/**
 * 0026 role_rank()의 거울. Chairman 5 … Member 0, 시스템 역할 -1.
 * 화면이 «이 사람에게 이 버튼을 그릴까»만 가른다 — 판정은 DB 정책이 한다.
 */
export const ROLE_RANK: Record<string, number> = {
  Chairman: 5,
  GroupCFO: 4,
  BusinessCEO: 3,
  Executive: 2,
  TeamLead: 1,
  Member: 0,
}

export function roleRank(user: SessionUser | null): number {
  return user ? (ROLE_RANK[user.role] ?? -1) : -1
}

/** 공지 쓰기(0038 can_write_notice): Executive 이상. 그룹 전체 공지는 그룹 범위(회장 · 그룹 CFO)만. */
export function canWriteNotice(user: SessionUser | null): boolean {
  return roleRank(user) >= 2
}
export function canWriteGroupNotice(user: SessionUser | null): boolean {
  return user?.role === 'Chairman' || user?.role === 'GroupCFO'
}
