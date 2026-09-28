import type { CityLayout, CityLayoutInput } from '@/types'

import type { AuditActor } from './types'

/**
 * 0037 city_layout의 dummy 자리. 0037 시드의 다섯 자리 + DEBUT PHOTO.
 *
 * DB가 막는 것(주인 하나 · 상자가 그림 안 · 한 회사 한 줄 · 쓰기는 Chairman)을 **여기서도**
 * 막는다 — dummy에서 통과한 저장이 live에서 막히면 dummy로 본 화면의 뜻이 없다.
 */
const layout: CityLayout[] = [
  { id: 1, business_id: 'biz_dy', initiative_id: null, x: 8, y: 40, w: 13, h: 42, stage_image: null },
  { id: 2, business_id: 'biz_vana', initiative_id: null, x: 31, y: 14, w: 6, h: 31, stage_image: null },
  { id: 3, business_id: 'biz_sticky', initiative_id: null, x: 59, y: 7, w: 15, h: 42, stage_image: null },
  { id: 4, business_id: 'biz_hof', initiative_id: null, x: 70, y: 60, w: 13, h: 24, stage_image: null },
  { id: 5, business_id: 'biz_boram', initiative_id: null, x: 83, y: 50, w: 16, h: 50, stage_image: null },
  // 시트에 없는 여섯 번째 회사(src/data/README.md 5번). 0037 시드에는 없다 — dummy에만.
  { id: 6, business_id: 'biz_debutphoto', initiative_id: null, x: 17, y: 25, w: 9, h: 36, stage_image: null },
]
let nextId = 7

function onlyChairman(actor: AuditActor) {
  if (actor.role !== 'Chairman') throw new Error('row-level security: city_layout은 Chairman만 고친다')
}

function check(row: CityLayoutInput) {
  if ((row.business_id === null) === (row.initiative_id === null)) {
    throw new Error('city_layout_target_check')
  }
  const { x, y, w, h } = row
  if (!(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 100 && y + h <= 100)) {
    throw new Error('city_layout_box_check')
  }
}

export async function listCityLayout(): Promise<CityLayout[]> {
  return layout.map((r) => ({ ...r }))
}

export async function saveCityLayout(
  input: { upserts: CityLayoutInput[]; deletes: number[] },
  actor: AuditActor,
): Promise<void> {
  onlyChairman(actor)
  input.upserts.forEach(check)

  // 한 번에 성공하거나 한 번에 실패한다(live는 RPC 없이 줄마다 가지만, 검사는 먼저 다 한다).
  const next = layout.filter((r) => !input.deletes.includes(r.id)).map((r) => ({ ...r }))
  for (const row of input.upserts) {
    const at = row.id ? next.findIndex((r) => r.id === row.id) : -1
    const value: CityLayout = {
      id: at >= 0 ? next[at].id : nextId++,
      business_id: row.business_id,
      initiative_id: row.initiative_id,
      x: row.x,
      y: row.y,
      w: row.w,
      h: row.h,
      stage_image: row.stage_image,
      anchors: row.anchors !== undefined ? row.anchors : at >= 0 ? next[at].anchors ?? null : null,
    }
    if (at >= 0) next[at] = value
    else next.push(value)
  }
  const owners = next.map((r) => r.business_id ?? `ini:${r.initiative_id}`)
  if (new Set(owners).size !== owners.length) throw new Error('city_layout_business_unique')

  layout.splice(0, layout.length, ...next)
}

export async function promoteCityLot(id: number, businessId: string, actor: AuditActor): Promise<void> {
  onlyChairman(actor)
  const row = layout.find((r) => r.id === id)
  if (!row || row.initiative_id === null) throw new Error('city_layout: 승격할 터가 없다')
  if (layout.some((r) => r.business_id === businessId)) throw new Error('city_layout_business_unique')
  row.initiative_id = null
  row.business_id = businessId
  row.stage_image = 'foundation'
}
