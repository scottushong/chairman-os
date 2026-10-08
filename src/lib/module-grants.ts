import type { ModuleGrant } from '@/types'

/**
 * 0047 모듈 권한 키. 재무는 **회사까지** 키에 넣는다 — '/finance/<business_id>'.
 * 회사 접근(user_business_access)과 재무 권한은 다른 결정이라, 회사 접근을 하나 더 준다고 그 회사 장부가 열리면 안 된다
 * (0047 머리 주석 «회사를 키에 넣은 이유»). DB 판정은 0047 finance_grant(target)가 같은 모양의 키를 본다.
 */
export function moduleKey(prefix: string, businessId: string): string {
  return `${prefix}/${businessId}`
}

/** '/finance/biz_dy' → 'biz_dy'. 접두사가 다르거나 회사가 비면 null. */
export function businessOfModule(prefix: string, module: string): string | null {
  if (!module.startsWith(`${prefix}/`)) return null
  const rest = module.slice(prefix.length + 1)
  return /^[a-z0-9_]+$/.test(rest) ? rest : null
}

/** 모듈 줄 → 회사별 재무 칸 둘(SessionUser.finance). 줄이 없는 회사는 키가 없다. */
export function financeByBusiness(grants: ModuleGrant[]): Record<string, { write: boolean; close: boolean }> {
  const out: Record<string, { write: boolean; close: boolean }> = {}
  for (const g of grants) {
    const biz = businessOfModule('/finance', g.module)
    if (biz) out[biz] = { write: g.can_write, close: g.can_approve }
  }
  return out
}

/**
 * 0048. 모듈 줄 → 회사별 문서 등록 칸(SessionUser.documents). '/documents/<business_id>'의 can_write만 본다
 * (can_approve는 문서에서 쓰지 않는다). 줄이 없는 회사는 키가 없다.
 */
export function documentsByBusiness(grants: ModuleGrant[]): Record<string, { write: boolean }> {
  const out: Record<string, { write: boolean }> = {}
  for (const g of grants) {
    const biz = businessOfModule('/documents', g.module)
    if (biz) out[biz] = { write: g.can_write }
  }
  return out
}

/** 0048 옛 전역 키. can_write_documents()가 남겨 둔 분기와 같다 — 이 줄의 쓰기 칸이면 회사 범위 안 전부. */
export const LEGACY_DOCUMENTS_MODULE = '/core/search'

export function hasLegacyDocumentWrite(grants: ModuleGrant[]): boolean {
  return grants.some((g) => g.module === LEGACY_DOCUMENTS_MODULE && g.can_write)
}

/**
 * «결재 올리기» 키 — 0002 decisions_create가 보는 can_module('/chairman/decisions', true). 회사가 키에 없는 전역 한 줄이다.
 * 2026-10-06 첫 직원이 이 줄 없이 들어와 결재 양식 다섯을 모두 못 올렸다(RLS 42501).
 */
export const DRAFT_DECISION_MODULE = '/chairman/decisions'

export function hasDraftGrant(grants: ModuleGrant[]): boolean {
  return grants.some((g) => g.module === DRAFT_DECISION_MODULE && g.can_write)
}

/**
 * 0059 «결재 대장 열람» 접두사 — 키는 '/approvals/ledger/<business_id>'. 줄이 있으면 그 회사 양식 결재 전부를 읽는다
 * (0059 approval_ledger_grant — can_write · can_approve 칸은 보지 않는다). 회장만 준다.
 */
export const LEDGER_MODULE_PREFIX = '/approvals/ledger'

/** 모듈 줄 → «결재 대장 열람» 회사 목록(SessionUser.ledger). */
export function ledgerBusinesses(grants: ModuleGrant[]): string[] {
  return grants.map((g) => businessOfModule(LEDGER_MODULE_PREFIX, g.module)).filter((b): b is string => b !== null)
}
