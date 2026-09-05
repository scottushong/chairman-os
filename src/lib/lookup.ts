import type { Business, BusinessId, Project, ProjectId } from '@/types'

/**
 * id → 이름 같은 참조. 화면 여러 곳이 같은 규칙을 써야 해서 한 자리에 모은다.
 *
 * 인자로 받는 이유는 lib/finance.ts와 같다 — 시드를 직접 읽으면
 * live 모드 화면에 시드 회사명이 섞여 나온다.
 */

/** 못 찾으면 id를 그대로 보여 준다. 빈칸으로 두면 어느 회사 건인지 추적할 수 없다. */
export function businessName(businesses: Business[], businessId: BusinessId): string {
  return businesses.find((b) => b.business_id === businessId)?.name ?? businessId
}

/** Task는 회사를 직접 들고 있지 않다. project를 거쳐야 회사가 나온다(CH-017 그룹핑). */
export function businessOfProject(projects: Project[], projectId: ProjectId): BusinessId {
  return projects.find((p) => p.project_id === projectId)?.business_id ?? 'unknown'
}
