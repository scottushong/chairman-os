import 'server-only'

import { buildCityItems, type CityItem } from '@/lib/city'
import { summarizeDependency } from '@/lib/dependency'
import type { ChairmanRepository } from '@/lib/repository'
import type { Business, CityLayout, Initiative } from '@/types'

/**
 * /group과 /group/edit가 읽는 것을 한 번에. HOME은 이미 같은 원천을 읽고 있어서
 * 이것을 부르지 않고 buildCityItems()에 바로 넘긴다(왕복을 두 번 하지 않는다).
 *
 * 의존 요약은 대시보드와 **같은 summarizeDependency()**로 접는다 — 두 화면이 각자 접으면
 * 같은 회사의 L이 화면마다 달라진다.
 */
export async function loadCity(repo: ChairmanRepository): Promise<{
  items: CityItem[]
  layout: CityLayout[]
  businesses: Business[]
  initiatives: Initiative[]
}> {
  const [layout, businesses, initiatives, kpis, dependency, interventions, areas, autonomy, tests] =
    await Promise.all([
      repo.listCityLayout(),
      repo.listBusinesses(),
      repo.listInitiatives(),
      repo.listFinanceKpis(),
      repo.listFounderDependency(),
      repo.listInterventions(),
      repo.listDependencyAreas(),
      repo.listAutonomyAssessments(),
      repo.listAbsenceTests(),
    ])
  const summary = summarizeDependency({
    businessIds: businesses.map((b) => b.business_id),
    dependency,
    interventions,
    areas,
    autonomy,
    tests,
  })
  return {
    items: buildCityItems({ layout, businesses, initiatives, dependency: summary, kpis }),
    layout,
    businesses,
    initiatives,
  }
}
