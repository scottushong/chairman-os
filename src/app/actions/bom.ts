'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { costEngineError } from '@/lib/costs/errors'
import { getRepository } from '@/lib/repository'
import type { ProductBreakdownRow } from '@/types'

/**
 * 대표 BOM(0063 암호문 판) Server Action — 대표 BOM 화면(/costs/<biz>/bom)만 부른다.
 *
 * 세션 역할이 대표가 아니면 그 길의 존재를 말하지 않고 거부한다(DB도 cost_secret.bom_reader로 cost_not_found).
 * **BOM 값은 로그 · AI 어디에도 보내지 않는다** — 오류 로그에는 DB 이유 코드만 남는다(0063 오류에는 값이 없다).
 */

export interface BomState {
  error?: string
}

const BIZ = /^[a-z0-9_]{1,60}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const PRODUCT = /^prd_[a-z0-9_]{4,60}$/
const MATERIAL = /^mat_[a-z0-9_]{4,60}$/

const NOT_FOUND = { error: '찾을 수 없거나 권한이 없습니다.' }
const EXPIRED = { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

async function chairman() {
  const user = await currentUser()
  if (!user) return EXPIRED
  if (user.role !== 'Chairman') return NOT_FOUND
  return null
}

/** 오류 로그 — 이유 코드만(값 · 원료 id를 싣지 않는다). */
function logCode(where: string, e: unknown) {
  const m = e instanceof Error ? e.message : String(e)
  console.error(`[bom] ${where}`, m.match(/cost_[a-z_]+|P0002|42501|23514|22023/)?.[0] ?? 'error')
}

export async function bomSaveAction(input: Record<string, unknown>): Promise<BomState & { versionId?: number }> {
  const businessId = typeof input.businessId === 'string' ? input.businessId : ''
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  const productId = typeof input.productId === 'string' ? input.productId : ''
  if (!PRODUCT.test(productId)) return { error: '제품을 고르세요.' }
  const validFrom = typeof input.validFrom === 'string' ? input.validFrom : ''
  if (!DATE.test(validFrom)) return { error: '적용 시작일을 고르세요.' }
  const yieldPct = num(input.yieldPct)
  if (yieldPct === null || yieldPct <= 0 || yieldPct > 100) return { error: '수율은 0 초과 100 이하(%)로 적으세요.' }
  const raw = Array.isArray(input.lines) ? (input.lines as Record<string, unknown>[]) : []
  const lines = raw
    .map((l) => ({ material_id: typeof l?.material_id === 'string' ? l.material_id : '', kg_per_kg: num(l?.kg_per_kg) }))
    .filter((l) => l.material_id || l.kg_per_kg !== null)
  if (lines.length < 1 || lines.length > 200) return { error: '원료를 1~200줄 넣으세요.' }
  if (lines.some((l) => !MATERIAL.test(l.material_id) || l.kg_per_kg === null || l.kg_per_kg <= 0 || l.kg_per_kg > 100)) {
    return { error: '줄마다 원료와 kg/kg(0 초과 100 이하)를 넣으세요.' }
  }
  if (lines.some((l) => Number(l.kg_per_kg!.toFixed(8)) !== l.kg_per_kg)) return { error: 'kg/kg는 소수 8자리까지입니다.' }
  if (new Set(lines.map((l) => l.material_id)).size !== lines.length) return { error: '같은 원료가 두 줄입니다.' }
  const gate = await chairman()
  if (gate) return gate
  try {
    const versionId = await (await getRepository()).bomSave(
      productId,
      validFrom,
      yieldPct,
      lines.map((l) => ({ material_id: l.material_id, kg_per_kg: l.kg_per_kg! })),
      typeof input.note === 'string' ? input.note.trim().slice(0, 300) : '',
      input.isFake !== false,
    )
    revalidatePath(`/costs/${businessId}`, 'layout')
    revalidatePath(`/sales/${businessId}`)
    return { versionId }
  } catch (e) {
    logCode('save', e)
    return { error: costEngineError(e, true) }
  }
}

export async function bomVoidAction(businessId: string, versionId: number, reason: string): Promise<BomState> {
  if (!BIZ.test(businessId) || !Number.isSafeInteger(versionId)) return { error: '어느 판인지 알 수 없습니다.' }
  const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : ''
  if (!why) return { error: '무효 이유를 적으세요.' }
  const gate = await chairman()
  if (gate) return gate
  try {
    await (await getRepository()).bomVoid(versionId, why)
    revalidatePath(`/costs/${businessId}`, 'layout')
    revalidatePath(`/sales/${businessId}`)
    return {}
  } catch (e) {
    logCode('void', e)
    return { error: costEngineError(e, true) }
  }
}

export async function bomRealAllowAction(businessId: string, on: boolean): Promise<BomState> {
  if (!BIZ.test(businessId) || typeof on !== 'boolean') return { error: '값을 알 수 없습니다.' }
  const gate = await chairman()
  if (gate) return gate
  try {
    await (await getRepository()).bomRealAllow(on)
    revalidatePath(`/costs/${businessId}/bom`)
    return {}
  } catch (e) {
    logCode('real', e)
    return { error: costEngineError(e, true) }
  }
}

/** 대표: 원료별 분해(Market · Current, 원래 값 — 화면이 1원으로 그린다). */
export async function bomBreakdownAction(productId: string, kind: string): Promise<BomState & { rows?: ProductBreakdownRow[] }> {
  if (!PRODUCT.test(productId) || (kind !== 'market' && kind !== 'current')) return { error: '값을 알 수 없습니다.' }
  const gate = await chairman()
  if (gate) return gate
  try {
    return { rows: await (await getRepository()).productBreakdown(productId, kind) }
  } catch (e) {
    logCode('breakdown', e)
    return { error: costEngineError(e, true, '분해를 불러오지 못했습니다.') }
  }
}
