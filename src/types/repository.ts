import type { BusinessId } from './primitives'

/**
 * 05_Architecture 3. Repository 구조 권장안.
 * Mono-repo 안에서 core / chairman / business-각사 / integrations / vault 로 나누고,
 * 인증·권한·AI Adapter·공통 Component는 core에서만 산다.
 */

export const CORE_MODULES = [
  '/core/auth',
  '/core/permissions',
  '/core/ai',
  '/core/notifications',
  '/core/search',
] as const

export const CHAIRMAN_MODULES = ['/chairman/dashboard', '/chairman/decisions'] as const

export const BUSINESS_MODULES = [
  '/business-dy',
  '/business-vana',
  '/business-sticky',
  '/business-hof',
  '/business-boram',
] as const

export const INTEGRATION_MODULES = ['/integrations/ecount', '/integrations/mes'] as const

export const VAULT_MODULE = '/vault' as const

export type CoreModulePath = (typeof CORE_MODULES)[number]
export type ChairmanModulePath = (typeof CHAIRMAN_MODULES)[number]
export type BusinessModulePath = (typeof BUSINESS_MODULES)[number]
export type IntegrationModulePath = (typeof INTEGRATION_MODULES)[number]
export type ModulePath =
  | CoreModulePath
  | ChairmanModulePath
  | BusinessModulePath
  | IntegrationModulePath
  | typeof VAULT_MODULE

/** 1. Target Architecture의 4개 Layer. */
export const ARCHITECTURE_LAYER = ['Layer0', 'Layer1', 'Layer2', 'Layer3', 'AI'] as const
export type ArchitectureLayer = (typeof ARCHITECTURE_LAYER)[number]

export interface ModuleDescriptor {
  path: ModulePath
  layer: ArchitectureLayer
  /** 한글 설명. 05 문서의 '역할' 칸. */
  role: string
  /** Business 전용 모듈만 소유 회사를 가진다. */
  owner_business?: BusinessId
}

/** 전용 OS 경로 ↔ Business ID. 카드 클릭 시 어디로 보낼지 여기서 결정한다. */
export const BUSINESS_MODULE_BY_ID: Record<BusinessId, BusinessModulePath> = {
  biz_dy: '/business-dy',
  biz_vana: '/business-vana',
  biz_sticky: '/business-sticky',
  biz_hof: '/business-hof',
  biz_boram: '/business-boram',
}

/** 05_Architecture 4. Git Flow. main 직접 push 금지. */
export const BRANCH_POLICY = {
  main: 'Production. 직접 push 금지',
  staging: '통합검증',
  'feature/*': '외주/내부 기능개발',
  'hotfix/*': '긴급 수정. 사후 문서화 필수',
} as const

/** 05_Architecture 5. Environment. Local은 항상 Dummy만 본다. */
export const ENVIRONMENTS = ['Local', 'Dev', 'Staging', 'Production', 'Vault'] as const
export type Environment = (typeof ENVIRONMENTS)[number]
