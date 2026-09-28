import Link from 'next/link'

import { CityEditor } from '@/components/city/city-editor'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { currentUser } from '@/lib/auth/session'
import { cityPhase } from '@/lib/city-phase'
import { loadCity } from '@/lib/city-load'
import { getRepository } from '@/lib/repository'

/**
 * `/group/edit` — 회장이 도시 위 자리를 드래그로 배치한다 (Phase 8 G-1).
 *
 * 쓰기는 Chairman뿐이다(0037 can_write_city_layout). 다른 역할에게는 편집기를 **아예 그리지
 * 않는다** — 끌어 놓고 저장을 누른 순간에야 거부당하는 화면을 두지 않는다.
 *
 * 편집기에 key를 준다: 저장 뒤 router.refresh()로 서버 값이 새로 오면 그 값으로 다시 선다.
 * key가 없으면 편집기가 저장 전의 임시 id(음수)를 계속 들고 있어 다음 저장이 같은 줄을
 * 한 번 더 넣으려 한다.
 */
export default async function GroupEditPage() {
  await recordScreenRead({ path: '/group/edit', kind: 'page' })

  const user = await currentUser()
  if (user?.role !== 'Chairman') {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-10">
        <PageHeader icon="layers" title="그룹 · 배치 편집" code="Phase 8 · Group City" description="도시 배치는 회장님만 고칩니다." />
        <Link href="/group" className="mt-4 inline-block text-[12.5px] text-ink-dim underline underline-offset-2 hover:text-ink">
          그룹 보기로
        </Link>
      </div>
    )
  }

  const repo = await getRepository()
  const [phase, city] = await Promise.all([cityPhase(), loadCity(repo)])
  const businesses = city.businesses.filter((b) => b.visible).map((b) => ({ id: b.business_id, name: b.name }))
  // 터를 새로 여는 것은 진행 중인 이니셔티브만. 이미 터가 있는 끝난 건은 편집기에 이름이 남아야
  // 하므로 목록에서 빼지 않고, «자리 없는» 후보에서만 뺀다(편집기가 layout과 맞춰 본다).
  const initiatives = city.initiatives
    .filter((i) => i.status === 'Active' || city.layout.some((l) => l.initiative_id === i.initiative_id))
    .map((i) => ({ id: i.initiative_id, name: i.title }))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="layers"
        title="그룹 · 배치 편집"
        code="Phase 8 · Group City"
        description="상자를 끌어 건물 위에 올리고, 오른쪽 아래 모서리로 크기를 맞춥니다. 저장을 눌러야 반영됩니다."
      />
      <CityEditor
        key={city.layout.map((l) => `${l.id}:${l.business_id ?? l.initiative_id}:${l.x}:${l.y}:${l.w}:${l.h}:${l.stage_image}`).join('|')}
        phase={phase}
        layout={city.layout}
        businesses={businesses}
        initiatives={initiatives}
      />
    </div>
  )
}
