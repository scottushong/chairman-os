'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { clampBox } from '@/lib/city'
import { getRepository } from '@/lib/repository'
import { CITY_ANCHOR, CITY_STAGE, type CityAnchorsInput, type CityLayoutInput, type CityStage } from '@/types'

/**
 * 그룹 시티 배치 저장 · 승격 (Phase 8 G-1, 0037).
 *
 * 판정은 DB가 한다(쓰기는 Chairman, 상자는 그림 안, 주인은 하나). 여기서 먼저 보는 이유는
 * 거부가 'violates check constraint'로만 돌아오면 회장이 무엇을 고쳐야 하는지 모르기 때문이다.
 * 상자는 여기서 **가둔다**(clampBox) — 드래그가 1px 삐져나간 것으로 저장 전체를 거부하지 않는다.
 */

export interface CityActionState {
  error?: string
}

function stage(value: unknown): CityStage | null {
  return typeof value === 'string' && (CITY_STAGE as readonly string[]).includes(value) ? (value as CityStage) : null
}

/**
 * 0044 길목. undefined = 건드리지 않음, null = 상자에서(되돌리기), 객체 = 있는 점만.
 * 점은 그림 안(0~100)으로 가두고 소수 둘째 자리로 자른다 — 0044 city_anchors_ok와 같은 판정.
 */
function anchors(value: unknown): CityAnchorsInput | null | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return null
  const out: CityAnchorsInput = {}
  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 100) / 100
  for (const name of CITY_ANCHOR) {
    const p = (value as Record<string, unknown>)[name] as { x?: unknown; y?: unknown } | undefined
    const x = Number(p?.x)
    const y = Number(p?.y)
    if (p && Number.isFinite(x) && Number.isFinite(y)) out[name] = { x: clamp(x), y: clamp(y) }
  }
  return Object.keys(out).length > 0 ? out : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function explain(e: unknown, fallback: string): CityActionState {
  const message = e instanceof Error ? e.message : ''
  if (/42501|PGRST301|row-level security/.test(message)) {
    return { error: '도시 배치는 회장님만 고칠 수 있습니다.' }
  }
  if (/city_layout_business_unique|city_layout_initiative_unique|duplicate key/.test(message)) {
    return { error: '같은 회사(또는 이니셔티브)가 도시에 두 번 설 수 없습니다.' }
  }
  if (/city_layout_target_check/.test(message)) {
    return { error: '자리 하나에는 회사 하나 또는 이니셔티브 하나만 걸 수 있습니다.' }
  }
  if (/city_layout_anchors_check/.test(message)) {
    return { error: '길목 점을 읽지 못했습니다. 점을 그림 안에 다시 놓아 주세요.' }
  }
  if (/42703|column [^ ]*anchors/.test(message)) {
    return { error: '길목(입구·자리·길)은 DB 업데이트(0044) 뒤에 저장됩니다. 상자만 옮겼다면 길목을 «상자에서»로 되돌려 저장하세요.' }
  }
  if (/city_layout_box_check/.test(message)) {
    return { error: '상자가 그림 밖으로 나갔습니다. 안쪽으로 옮겨 주세요.' }
  }
  return { error: fallback }
}

export async function saveCityLayout(input: { upserts: unknown; deletes: unknown }): Promise<CityActionState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (user.role !== 'Chairman') return { error: '도시 배치는 회장님만 고칠 수 있습니다.' }

  const rawUpserts = Array.isArray(input.upserts) ? input.upserts : []
  const deletes = (Array.isArray(input.deletes) ? input.deletes : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)

  const upserts: CityLayoutInput[] = []
  for (const raw of rawUpserts) {
    const r = (raw ?? {}) as Record<string, unknown>
    const business_id = text(r.business_id)
    const initiative_id = text(r.initiative_id)
    if ((business_id === null) === (initiative_id === null)) {
      return { error: '자리 하나에는 회사 하나 또는 이니셔티브 하나만 걸 수 있습니다.' }
    }
    const box = [r.x, r.y, r.w, r.h].map(Number)
    if (box.some((v) => !Number.isFinite(v))) return { error: '자리 좌표를 읽지 못했습니다.' }
    const id = Number(r.id)
    upserts.push({
      id: Number.isInteger(id) && id > 0 ? id : undefined,
      business_id,
      initiative_id,
      ...clampBox({ x: box[0], y: box[1], w: box[2], h: box[3] }),
      // 이니셔티브 터는 단계를 갖지 않는다 — 늘 빈 터다(lib/city.ts effectiveStage).
      stage_image: initiative_id !== null ? null : stage(r.stage_image),
      anchors: anchors(r.anchors),
    })
  }

  try {
    const repo = await getRepository()
    await repo.saveCityLayout({ upserts, deletes }, { user_id: user.user_id, role: user.role })
    revalidatePath('/group')
    revalidatePath('/group/edit')
    revalidatePath('/')
    return {}
  } catch (e) {
    console.error('[saveCityLayout]', e)
    return explain(e, '배치를 저장하지 못했습니다.')
  }
}

export async function promoteCityLot(id: unknown, businessId: unknown): Promise<CityActionState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (user.role !== 'Chairman') return { error: '승격은 회장님만 할 수 있습니다.' }

  const layoutId = Number(id)
  const target = text(businessId)
  if (!Number.isInteger(layoutId) || layoutId <= 0) return { error: '승격할 터를 알 수 없습니다.' }
  if (!target) return { error: '이 터를 어느 회사로 올릴지 고르세요.' }

  try {
    const repo = await getRepository()
    await repo.promoteCityLot(layoutId, target, { user_id: user.user_id, role: user.role })
    revalidatePath('/group')
    revalidatePath('/group/edit')
    revalidatePath('/')
    return {}
  } catch (e) {
    console.error('[promoteCityLot]', e)
    return explain(e, '승격하지 못했습니다.')
  }
}
