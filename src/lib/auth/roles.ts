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
