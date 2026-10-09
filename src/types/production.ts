import type { IsoDate } from './primitives'

/**
 * 원가 엔진 — 생산(0064 · 설계서 2.5 · 2.8 · 9.3절). 대표가 오더를 발행하면 DB가 그 날 BOM × 계획 kg로 작업지시 수량(원료 · kg)을 만든다.
 *
 * **비율 · 수율 · kg/kg가 없다** — 작업지시는 «원료 X를 몇 kg»뿐이다(회장 결정 «X(작업지시 수량만)»). 투입(어느 LOT 몇 kg)은 대표 · 생산만 읽는다.
 * Actual 원가(원/kg)는 대표 · 원가 관리만(대표 외 1원). 분해(원료 · LOT별)는 대표만.
 */

export type ProductionOrderStatus = 'open' | 'done' | 'cancelled'

export const ORDER_STATUS_LABEL_KO: Record<ProductionOrderStatus, string> = {
  open: '진행 중',
  done: '완료',
  cancelled: '취소',
}

/** 0064 cost_production_orders — 머리(제품 · 계획일 · 계획 kg). 생산 · 원가 관리 · 대표가 읽는다. */
export interface ProductionOrder {
  order_id: string
  business_id: string
  product_id: string
  planned_on: IsoDate
  planned_kg: number
  status: ProductionOrderStatus
  note: string
  created_at: string
  closed_at: string | null
}

/** 0064 cost_production_order_lines — 작업지시 수량(원료 · kg). 대표 · 생산만. */
export interface ProductionOrderLine {
  order_id: string
  material_id: string
  planned_kg: number
}

/** 0064 cost_prod_lots — 생산 LOT(산출 kg). 고치지 않는다(무효 + 새 줄). */
export interface ProdLot {
  prod_lot_id: string
  business_id: string
  order_id: string
  product_id: string
  produced_on: IsoDate
  output_kg: number
  note: string
  created_at: string
  voided_at: string | null
  void_reason: string | null
}

export interface ProdLotInput {
  order_id: string
  produced_on: IsoDate
  output_kg: number
  note: string
}

/** 0064 cost_prod_inputs — 생산 LOT에 실제로 쓴 구매 LOT와 kg. 대표 · 생산만. */
export interface ProdInput {
  input_id: number
  business_id: string
  prod_lot_id: string
  lot_id: string
  material_id: string
  qty_kg: number
  created_at: string
  voided_at: string | null
  void_reason: string | null
}

export interface ProdInputInput {
  prod_lot_id: string
  lot_id: string
  qty_kg: number
}

/** 0064 cost_lot_adjustments — 구매 LOT 잔량 조정(폐기 · 실사 차이). 이유 필수. */
export interface LotAdjustment {
  adj_id: number
  business_id: string
  lot_id: string
  adjusted_on: IsoDate
  qty_kg: number
  reason: string
  created_at: string
  voided_at: string | null
  void_reason: string | null
}

export interface LotAdjustmentInput {
  lot_id: string
  adjusted_on: IsoDate
  qty_kg: number
  reason: string
}

/** 0064 cost_lot_balances — 구매 LOT 잔량(지금). 입고 오래된 순. landed는 1원(생산에게는 0061 «제한»과 같은 칸). */
export interface LotBalance {
  lot_id: string
  material_id: string
  material_name: string
  supplier_name: string
  supplier_lot_no: string
  received_on: IsoDate
  qty_kg: number
  used_kg: number
  adjusted_kg: number
  remaining_kg: number
  landed_krw_per_kg: number | null
}

/** 0064 cost_prod_actual — 생산 LOT마다 Actual 원가(원/kg). 대표 = 원래 값, 원가 관리 = 1원. 투입이 없으면 computed = false. */
export interface ProdActualRow {
  prod_lot_id: string
  order_id: string
  product_id: string
  product_name: string
  produced_on: IsoDate
  output_kg: number
  input_kg: number | null
  actual_krw_per_kg: number | null
  computed: boolean
}

/** 0064 cost_prod_actual_breakdown — 대표만. 원료 · 구매 LOT · 투입 kg · landed · 금액 + 그 원료의 작업지시 수량. */
export interface ProdActualBreakdownRow {
  material_id: string
  material_name: string
  lot_id: string
  qty_kg: number
  landed_krw_per_kg: number
  amount_krw: number
  planned_kg: number | null
}
