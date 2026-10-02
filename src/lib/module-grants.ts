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
