import type { ImportTarget } from './types'

export type { ImportTarget } from './types'

/**
 * cost_import_apply(0068)에 넘기는 줄 — 이름은 서버가 id로 바꿔 둔 뒤다(DB가 다시 회사 · 권한을 본다).
 * 숫자는 **문자열**로 넘긴다(numeric 원값 — JS 부동소수로 한 번 거치지 않게. «0.1 + 0.2» 같은 꼬리가 DB에 들어가지 않는다).
 *
 * replace_id가 있으면 «엑셀 값으로 바꾸기»: 원료 · 공급처는 그 줄의 칸을 고치고(마스터 — 지우지 않는다),
 * 시장가 · 구매 LOT · 비용 줄 · BOM은 그 줄을 무효(이유 = reason)로 한 뒤 새 줄을 넣는다. 이유는 필수.
 */
interface Replace {
  replace_id?: string
  reason?: string
}

export interface MaterialPayload extends Replace {
  name: string
  category: string
  spec: string
  note: string
}

export interface SupplierPayload extends Replace {
  name: string
  country: string
  currency_default: string
  contact: string
  terms: string
  note: string
}

export interface MarketPricePayload extends Replace {
  material_id: string
  observed_on: string
  price: string
  currency: string
  fx_rate: string | null
  source_name: string
  source_url: string | null
  note: string
}

export interface PurchaseLotPayload extends Replace {
  material_id: string
  supplier_id: string
  received_on: string
  ordered_on: string | null
  supplier_lot_no: string
  qty_kg: string
  unit_price: string
  currency: string
  fx_rate: string | null
  freight_krw: string
  duty_krw: string
  other_krw: string
  note: string
}

export interface OverheadPayload extends Replace {
  category: string
  basis: string
  amount: string
  product_id: string | null
  effective_from: string
  note: string
}

export interface ProductionPayload {
  order_id: string
  produced_on: string
  output_kg: string
  note: string
  inputs: { lot_id: string; qty_kg: string }[]
}

export interface BomPayload extends Replace {
  product_id: string
  valid_from: string
  yield_pct: string
  is_fake: boolean
  note: string
  lines: { material_id: string; kg_per_kg: string }[]
}

export type ImportPayload =
  | MaterialPayload
  | SupplierPayload
  | MarketPricePayload
  | PurchaseLotPayload
  | OverheadPayload
  | ProductionPayload
  | BomPayload

/** 고친 칸 — 감사에 «파일 값 → 고친 값»(BOM은 값 없이 «고침»). */
export interface ImportEdit {
  row: number
  field: string
  from: string
  to: string
}

export interface CostImportApply {
  businessId: string
  target: ImportTarget
  fileName: string
  sha256: string
  stamp: string
  rows: ImportPayload[]
  edits: ImportEdit[]
  /** 건너뛴 줄 수(같은 줄 · 기존 유지) — 감사 문구에만. */
  skipped: number
}
