import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  LotAdjustment,
  LotBalance,
  ProdActualBreakdownRow,
  ProdActualRow,
  ProdInput,
  ProdLot,
  ProductionOrder,
  ProductionOrderLine,
  ProductionOrderStatus,
} from '@/types'

import type { ProductionMethods } from './types'

/**
 * 원가 엔진 — 생산(0064)의 live 어댑터 조각(supabase.ts가 펼쳐 넣는다).
 *
 * 판정은 DB다 — RLS(cost_can production · costing)와 트리거(오더 상태 · 잔량 잠금 · 무효 한 번 · 감사)가 문이고, 여기서는 칸을 옮기고
 * 오류를 그대로 던진다(서버 액션이 lib/costs/errors.ts costEngineError로 사람 말로 바꾼다).
 * **0064가 없는 DB를 견딘다**(master push = production 배포가 먼저 나간 순간): 표 · 함수가 없다는 오류만 빈 값으로 삼킨다.
 * 비율 · 수율은 여기 없다 — 작업지시 수량(원료 · kg)만 읽는다.
 */

const MISSING = new Set(['PGRST205', '42P01', 'PGRST202', '42883'])

type Err = { code?: string; message: string; details?: string | null } | null

function missing(where: string, error: Err): boolean {
  if (error && MISSING.has(error.code ?? '')) {
    console.warn(`[${where}] 0064 생산 표 · 함수가 없다(${error.code}) — 적용 전. 빈 값으로 그린다.`)
    return true
  }
  return false
}

function fail(where: string, error: NonNullable<Err>): never {
  throw new Error(`Supabase ${where} ${error.code ?? '?'}: ${error.message}${error.details ? ` (${error.details})` : ''}`)
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))

const ORDER_COLUMNS = 'order_id,business_id,product_id,planned_on,planned_kg,status,note,created_at,closed_at'
const PROD_LOT_COLUMNS = 'prod_lot_id,business_id,order_id,product_id,produced_on,output_kg,note,created_at,voided_at,void_reason'
const INPUT_COLUMNS = 'input_id,business_id,prod_lot_id,lot_id,material_id,qty_kg,created_at,voided_at,void_reason'
const ADJ_COLUMNS = 'adj_id,business_id,lot_id,adjusted_on,qty_kg,reason,created_at,voided_at,void_reason'

const toOrder = (r: Record<string, unknown>): ProductionOrder => ({
  ...(r as unknown as ProductionOrder),
  planned_kg: n(r.planned_kg),
  status: r.status as ProductionOrderStatus,
})
const toProdLot = (r: Record<string, unknown>): ProdLot => ({ ...(r as unknown as ProdLot), output_kg: n(r.output_kg) })
const toInput = (r: Record<string, unknown>): ProdInput => ({ ...(r as unknown as ProdInput), input_id: n(r.input_id), qty_kg: n(r.qty_kg) })
const toAdj = (r: Record<string, unknown>): LotAdjustment => ({ ...(r as unknown as LotAdjustment), adj_id: n(r.adj_id), qty_kg: n(r.qty_kg) })

/** 무효 — 0행이면(없거나 못 고치는 줄) 있는지 없는지 말하지 않고 cost_not_found. */
async function voidRow(sb: SupabaseClient, table: string, key: string, id: string | number, businessId: string, reason: string) {
  const { data, error } = await sb.from(table).update({ void_reason: reason }).eq(key, id).eq('business_id', businessId).select(key)
  if (error) fail(table, error)
  if (!data || data.length === 0) throw new Error('cost_not_found')
}

export function productionMethods(sb: SupabaseClient): ProductionMethods {
  return {
    async listProductionOrders(businessId) {
      const { data, error } = await sb
        .from('cost_production_orders')
        .select(ORDER_COLUMNS)
        .eq('business_id', businessId)
        .order('planned_on', { ascending: false })
        .limit(500)
      if (error) {
        if (missing('listProductionOrders', error)) return []
        fail('cost_production_orders', error)
      }
      return (data ?? []).map((r) => toOrder(r as Record<string, unknown>))
    },

    async listProductionOrderLines(orderIds) {
      if (orderIds.length === 0) return []
      const { data, error } = await sb.from('cost_production_order_lines').select('order_id,material_id,planned_kg').in('order_id', orderIds.slice(0, 500))
      if (error) {
        if (missing('listProductionOrderLines', error)) return []
        fail('cost_production_order_lines', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): ProductionOrderLine => ({ order_id: String(r.order_id), material_id: String(r.material_id), planned_kg: n(r.planned_kg) }),
      )
    },

    async issueProductionOrder(productId, plannedOn, plannedKg, note) {
      const { data, error } = await sb.rpc('cost_production_issue', { p_product: productId, p_planned_on: plannedOn, p_planned_kg: plannedKg, p_note: note })
      if (error) fail('cost_production_issue', error)
      return String(data)
    },

    async closeProductionOrder(businessId, orderId, status) {
      const { data, error } = await sb.from('cost_production_orders').update({ status }).eq('order_id', orderId).eq('business_id', businessId).select('order_id')
      if (error) fail('cost_production_orders', error)
      if (!data || data.length === 0) throw new Error('cost_not_found')
    },

    async listProdLots(businessId) {
      const { data, error } = await sb
        .from('cost_prod_lots')
        .select(PROD_LOT_COLUMNS)
        .eq('business_id', businessId)
        .order('produced_on', { ascending: false })
        .limit(1000)
      if (error) {
        if (missing('listProdLots', error)) return []
        fail('cost_prod_lots', error)
      }
      return (data ?? []).map((r) => toProdLot(r as Record<string, unknown>))
    },

    async addProdLot(businessId, input) {
      // product_id는 트리거가 오더에서 채운다(NOT NULL이라 빈 값을 보낸다).
      const { data, error } = await sb
        .from('cost_prod_lots')
        .insert({ business_id: businessId, order_id: input.order_id, product_id: '', produced_on: input.produced_on, output_kg: input.output_kg, note: input.note })
        .select(PROD_LOT_COLUMNS)
      if (error) fail('cost_prod_lots', error)
      if (!data || data.length === 0) throw new Error('cost_not_found')
      return toProdLot(data[0] as Record<string, unknown>)
    },

    async voidProdLot(businessId, prodLotId, reason) {
      await voidRow(sb, 'cost_prod_lots', 'prod_lot_id', prodLotId, businessId, reason)
    },

    async listProdInputs(businessId) {
      const { data, error } = await sb
        .from('cost_prod_inputs')
        .select(INPUT_COLUMNS)
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(2000)
      if (error) {
        if (missing('listProdInputs', error)) return []
        fail('cost_prod_inputs', error)
      }
      return (data ?? []).map((r) => toInput(r as Record<string, unknown>))
    },

    async addProdInput(businessId, input) {
      // material_id는 트리거가 구매 LOT에서 채운다.
      const { data, error } = await sb
        .from('cost_prod_inputs')
        .insert({ business_id: businessId, prod_lot_id: input.prod_lot_id, lot_id: input.lot_id, material_id: '', qty_kg: input.qty_kg })
        .select(INPUT_COLUMNS)
      if (error) fail('cost_prod_inputs', error)
      if (!data || data.length === 0) throw new Error('cost_not_found')
      return toInput(data[0] as Record<string, unknown>)
    },

    async voidProdInput(businessId, inputId, reason) {
      await voidRow(sb, 'cost_prod_inputs', 'input_id', inputId, businessId, reason)
    },

    async listLotAdjustments(businessId) {
      const { data, error } = await sb
        .from('cost_lot_adjustments')
        .select(ADJ_COLUMNS)
        .eq('business_id', businessId)
        .order('adjusted_on', { ascending: false })
        .limit(1000)
      if (error) {
        if (missing('listLotAdjustments', error)) return []
        fail('cost_lot_adjustments', error)
      }
      return (data ?? []).map((r) => toAdj(r as Record<string, unknown>))
    },

    async addLotAdjustment(businessId, input) {
      const { data, error } = await sb
        .from('cost_lot_adjustments')
        .insert({ business_id: businessId, lot_id: input.lot_id, adjusted_on: input.adjusted_on, qty_kg: input.qty_kg, reason: input.reason })
        .select(ADJ_COLUMNS)
      if (error) fail('cost_lot_adjustments', error)
      if (!data || data.length === 0) throw new Error('cost_not_found')
      return toAdj(data[0] as Record<string, unknown>)
    },

    async voidLotAdjustment(businessId, adjId, reason) {
      await voidRow(sb, 'cost_lot_adjustments', 'adj_id', adjId, businessId, reason)
    },

    async lotBalances(businessId, all = false) {
      const { data, error } = await sb.rpc('cost_lot_balances', { p_business: businessId, p_all: all })
      if (error) {
        if (missing('lotBalances', error)) return []
        fail('cost_lot_balances', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): LotBalance => ({
          lot_id: String(r.lot_id),
          material_id: String(r.material_id),
          material_name: String(r.material_name ?? ''),
          supplier_name: String(r.supplier_name ?? ''),
          supplier_lot_no: String(r.supplier_lot_no ?? ''),
          received_on: String(r.received_on),
          qty_kg: n(r.qty_kg),
          used_kg: n(r.used_kg),
          adjusted_kg: n(r.adjusted_kg),
          remaining_kg: n(r.remaining_kg),
          landed_krw_per_kg: nn(r.landed_krw_per_kg),
        }),
      )
    },

    async prodActual(businessId, from = null, to = null) {
      const { data, error } = await sb.rpc('cost_prod_actual', { p_business: businessId, p_from: from, p_to: to })
      if (error) {
        if (missing('prodActual', error)) return []
        fail('cost_prod_actual', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): ProdActualRow => ({
          prod_lot_id: String(r.prod_lot_id),
          order_id: String(r.order_id),
          product_id: String(r.product_id),
          product_name: String(r.product_name ?? ''),
          produced_on: String(r.produced_on),
          output_kg: n(r.output_kg),
          input_kg: nn(r.input_kg),
          actual_krw_per_kg: nn(r.actual_krw_per_kg),
          computed: r.computed === true,
        }),
      )
    },

    async prodActualBreakdown(prodLotId) {
      const { data, error } = await sb.rpc('cost_prod_actual_breakdown', { p_prod_lot: prodLotId })
      if (error) {
        if (missing('prodActualBreakdown', error)) return []
        fail('cost_prod_actual_breakdown', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): ProdActualBreakdownRow => ({
          material_id: String(r.material_id),
          material_name: String(r.material_name ?? ''),
          lot_id: String(r.lot_id),
          qty_kg: n(r.qty_kg),
          landed_krw_per_kg: n(r.landed_krw_per_kg),
          amount_krw: n(r.amount_krw),
          planned_kg: nn(r.planned_kg),
        }),
      )
    },
  }
}
