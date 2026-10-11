'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { costEngineError } from '@/lib/costs/errors'
import { getRepository } from '@/lib/repository'
import type { LotAdjustment, ProdActualBreakdownRow, ProdInput, ProdLot } from '@/types'

/**
 * 원가 엔진 · 생산(0064) Server Action.
 *
 * 권한의 문은 DB다(RLS cost_can · 트리거 · 함수). 여기서는 입력의 모양을 거르고 DB의 거부를 사람의 말로 바꾼다(lib/costs/errors.ts).
 * 오더 발행 · Actual 분해는 대표만 — 세션 역할로 한 번 거르고(대표 외에게 그 길의 존재를 말하지 않는다) DB도 cost_not_found로 막는다.
 */

export interface ProductionState {
  error?: string
}

const BIZ = /^[a-z0-9_]{1,60}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ORDER = /^PO-[0-9]{8}-[0-9A-F]{6}$/
const PROD_LOT = /^ML-[0-9]{8}-[0-9A-F]{6}$/
const LOT = /^[A-Za-z0-9_-]{1,80}$/

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** «1,234.5» 같은 화면 값 → number. 비었거나 숫자가 아니면 null. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** kg — 0보다 크고 10억 이하, 소수 셋째 자리까지(화면 표기와 같다). */
function kgOf(v: unknown): number | null {
  const n = num(v)
  if (n === null || !(n > 0) || n > 1e9) return null
  return Math.round(n * 1000) / 1000 === n ? n : null
}

function done(businessId: string) {
  revalidatePath(`/production/${businessId}`)
  revalidatePath(`/costs/${businessId}`)
}

const EXPIRED = { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
const NO_BIZ = { error: '어느 회사인지 알 수 없습니다.' }
const KG_RULE = 'kg은 0보다 크게, 소수 셋째 자리까지 적으세요.'

// ── 대표: 작업지시 발행 · 취소 ────────────────────────────────────────

export async function issueOrderAction(input: Record<string, unknown>): Promise<ProductionState & { orderId?: string }> {
  const businessId = str(input.businessId, 60)
  if (!BIZ.test(businessId)) return NO_BIZ
  const productId = str(input.productId, 70)
  if (!/^prd_[a-z0-9_]{4,60}$/.test(productId)) return { error: '제품을 고르세요.' }
  const plannedOn = str(input.plannedOn, 10)
  if (!DATE.test(plannedOn)) return { error: '계획일을 고르세요.' }
  const plannedKg = kgOf(input.plannedKg)
  if (plannedKg === null) return { error: KG_RULE }
  const user = await currentUser()
  if (!user) return EXPIRED
  if (user.role !== 'Chairman') return { error: '찾을 수 없거나 권한이 없습니다.' }
  try {
    const orderId = await (await getRepository()).issueProductionOrder(productId, plannedOn, plannedKg, str(input.note, 500))
    done(businessId)
    return { orderId }
  } catch (e) {
    console.error('[production] issue', e instanceof Error ? e.message : String(e))
    return { error: costEngineError(e, true) }
  }
}

/** done = 생산 입력 · 대표, cancelled = 대표(DB cost_order_update). */
export async function closeOrderAction(businessId: string, orderId: string, status: string): Promise<ProductionState> {
  if (!BIZ.test(businessId)) return NO_BIZ
  if (!ORDER.test(orderId)) return { error: '어느 작업지시인지 알 수 없습니다.' }
  if (status !== 'done' && status !== 'cancelled') return { error: '상태를 고르세요.' }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    await (await getRepository()).closeProductionOrder(businessId, orderId, status)
    done(businessId)
    return {}
  } catch (e) {
    console.error('[production] close', e instanceof Error ? e.message : String(e))
    return { error: costEngineError(e, user.role === 'Chairman') }
  }
}

// ── 생산 LOT · 투입 · 조정 ───────────────────────────────────────────

export async function addProdLotAction(input: Record<string, unknown>): Promise<ProductionState & { prodLot?: ProdLot }> {
  const businessId = str(input.businessId, 60)
  if (!BIZ.test(businessId)) return NO_BIZ
  const orderId = str(input.orderId, 30)
  if (!ORDER.test(orderId)) return { error: '작업지시를 고르세요.' }
  const producedOn = str(input.producedOn, 10)
  if (!DATE.test(producedOn)) return { error: '생산일을 고르세요.' }
  const outputKg = kgOf(input.outputKg)
  if (outputKg === null) return { error: KG_RULE }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    const prodLot = await (await getRepository()).addProdLot(businessId, { order_id: orderId, produced_on: producedOn, output_kg: outputKg, note: str(input.note, 500) })
    done(businessId)
    return { prodLot }
  } catch (e) {
    console.error('[production] prod lot', e instanceof Error ? e.message : String(e))
    return { error: costEngineError(e, user.role === 'Chairman') }
  }
}

export async function addInputAction(input: Record<string, unknown>): Promise<ProductionState & { input?: ProdInput }> {
  const businessId = str(input.businessId, 60)
  if (!BIZ.test(businessId)) return NO_BIZ
  const prodLotId = str(input.prodLotId, 30)
  if (!PROD_LOT.test(prodLotId)) return { error: '생산 LOT를 고르세요.' }
  const lotId = str(input.lotId, 80)
  if (!LOT.test(lotId)) return { error: '구매 LOT를 고르세요.' }
  const qtyKg = kgOf(input.qtyKg)
  if (qtyKg === null) return { error: KG_RULE }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    const row = await (await getRepository()).addProdInput(businessId, { prod_lot_id: prodLotId, lot_id: lotId, qty_kg: qtyKg })
    done(businessId)
    return { input: row }
  } catch (e) {
    console.error('[production] input', e instanceof Error ? e.message : String(e))
    return { error: costEngineError(e, user.role === 'Chairman') }
  }
}

export async function addAdjustmentAction(input: Record<string, unknown>): Promise<ProductionState & { adjustment?: LotAdjustment }> {
  const businessId = str(input.businessId, 60)
  if (!BIZ.test(businessId)) return NO_BIZ
  const lotId = str(input.lotId, 80)
  if (!LOT.test(lotId)) return { error: '구매 LOT를 고르세요.' }
  const adjustedOn = str(input.adjustedOn, 10)
  if (!DATE.test(adjustedOn)) return { error: '조정일을 고르세요.' }
  const qtyKg = kgOf(input.qtyKg)
  if (qtyKg === null) return { error: KG_RULE }
  const reason = str(input.reason, 300)
  if (!reason) return { error: '조정 이유를 적으세요(폐기 · 실사 차이 등).' }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    const adjustment = await (await getRepository()).addLotAdjustment(businessId, { lot_id: lotId, adjusted_on: adjustedOn, qty_kg: qtyKg, reason })
    done(businessId)
    return { adjustment }
  } catch (e) {
    console.error('[production] adjustment', e instanceof Error ? e.message : String(e))
    return { error: costEngineError(e, user.role === 'Chairman') }
  }
}

/** 무효 — 생산 LOT · 투입 · 조정. 이유 필수 · 한 번(DB cost_void_update). */
export async function voidProductionRowAction(
  businessId: string,
  kind: 'prod_lot' | 'input' | 'adjustment',
  id: string | number,
  reason: string,
): Promise<ProductionState> {
  if (!BIZ.test(businessId)) return NO_BIZ
  const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : ''
  if (!why) return { error: '무효 이유를 적으세요.' }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    const repo = await getRepository()
    if (kind === 'prod_lot' && typeof id === 'string' && PROD_LOT.test(id)) await repo.voidProdLot(businessId, id, why)
    else if (kind === 'input' && Number.isSafeInteger(id)) await repo.voidProdInput(businessId, id as number, why)
    else if (kind === 'adjustment' && Number.isSafeInteger(id)) await repo.voidLotAdjustment(businessId, id as number, why)
    else return { error: '어느 줄인지 알 수 없습니다.' }
    done(businessId)
    return {}
  } catch (e) {
    console.error('[production] void', e instanceof Error ? e.message : String(e))
    return { error: costEngineError(e, user.role === 'Chairman') }
  }
}

// ── 대표: Actual 분해 ────────────────────────────────────────────────

/** 0064 cost_prod_actual_breakdown — 대표만(원료 · LOT · 실제 kg · 작업지시 kg · 금액). */
export async function actualBreakdownAction(prodLotId: string): Promise<ProductionState & { rows?: ProdActualBreakdownRow[] }> {
  if (!PROD_LOT.test(prodLotId)) return { error: '어느 생산 LOT인지 알 수 없습니다.' }
  const user = await currentUser()
  if (!user) return EXPIRED
  if (user.role !== 'Chairman') return { error: '찾을 수 없거나 권한이 없습니다.' }
  try {
    return { rows: await (await getRepository()).prodActualBreakdown(prodLotId) }
  } catch (e) {
    console.error('[production] breakdown', e instanceof Error ? e.message : String(e))
    return { error: costEngineError(e, true, '분해를 불러오지 못했습니다.') }
  }
}
