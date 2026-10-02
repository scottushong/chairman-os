import { cache } from 'react'

import { canReadExceptions } from '@/lib/attention/screen'
import { canReadInitiatives } from '@/lib/nav'
import { getRepository } from '@/lib/repository'
import type { Role } from '@/types'

/**
 * 사이드바 «회사» · «이니셔티브» 펼침 목록 (사이드바 개편 2026-10). 서버에서 요청당 한 번 읽는다(cache) —
 * 사이드바는 넓은 화면 붙박이와 폰 서랍에 두 번 그려지지만 같은 값을 받는다. 클라이언트 왕복은 없다.
 *
 * 권한은 다시 판정하지 않는다. 회사는 0002 has_business가 자른 listBusinesses 그대로,
 * 주의 점(RED/YELLOW)은 0035 exceptions_read가 주는 열린 예외 그대로다.
 * 이니셔티브만 역할을 먼저 본다 — dummy의 listInitiatives는 역할로 거르지 않아서(live는 0017이 0행),
 * 여기서 안 보면 dummy 직원 화면에 회장의 이니셔티브가 뜬다.
 *
 * GREEN 점은 그리지 않는다. «정상»은 재무 KPI · 원장까지 읽어 규칙을 돌려 봐야 말할 수 있고
 * (lib/attention/screen.ts ② — 재지 못한 회사는 GREEN이 아니다), 그걸 모든 화면의 사이드바에서 할 수는 없다.
 * 열린 RED/YELLOW가 없으면 점이 없다.
 */

export type SidebarLevel = 'RED' | 'YELLOW'

export interface SidebarCompany {
  business_id: string
  name: string
  /** 열린 예외 중 가장 무거운 등급. 없거나 못 읽는 역할이면 null(점 없음). */
  level: SidebarLevel | null
}

export interface SidebarInitiative {
  initiative_id: string
  title: string
}

export interface SidebarData {
  companies: SidebarCompany[]
  /** null = 이니셔티브를 못 읽는 역할 — 섹션을 통째로 그리지 않는다. */
  initiatives: SidebarInitiative[] | null
}

/** 사이드바에 세우는 진행 중 이니셔티브 최대 건수. 나머지는 «전체 보기»로. */
export const SIDEBAR_INITIATIVE_MAX = 8

export const loadSidebarData = cache(async function loadSidebarData(role: Role | null): Promise<SidebarData> {
  if (!role) return { companies: [], initiatives: null }
  const repo = await getRepository()
  // 사이드바 하나 때문에 화면 전체가 깨지면 안 된다 — 못 읽으면 빈 목록으로 떨어진다.
  const [businesses, exceptions, initiatives] = await Promise.all([
    repo.listBusinesses().catch(() => []),
    canReadExceptions(role) ? repo.listExceptions().catch(() => []) : Promise.resolve([]),
    canReadInitiatives(role) ? repo.listInitiatives().catch(() => []) : Promise.resolve(null),
  ])

  const level = new Map<string, SidebarLevel>()
  for (const e of exceptions) {
    if (e.status !== 'open' || e.severity === 'GREEN') continue
    if (level.get(e.business_id) !== 'RED') level.set(e.business_id, e.severity)
  }

  const companies = businesses
    .filter((b) => b.visible)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((b) => ({ business_id: b.business_id, name: b.name, level: level.get(b.business_id) ?? null }))

  return {
    companies,
    initiatives:
      initiatives === null
        ? null
        : initiatives
            .filter((i) => i.status === 'Active')
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .slice(0, SIDEBAR_INITIATIVE_MAX)
            .map((i) => ({ initiative_id: i.initiative_id, title: i.title })),
  }
})
