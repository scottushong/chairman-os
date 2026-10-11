import type { IsoDate } from './primitives'

/**
 * 원가 엔진 1차 — 구매(Purchase Intelligence) 화면의 모양(0061 · 설계서 2 · 13절).
 *
 * BOM은 여기 없다. 원료 · 제품 어디에도 «어느 제품에 무엇이 얼마나»(배합 · 투입 비율)가 없다 — 그것은 대표만 다루는 비공개 장부(0062)다.
 * 금액 · 수량은 DB에서 numeric으로 오고 화면에서는 number로 다룬다(원 · kg). Landed Cost와 원화 환산은 DB가 계산한 값이 원천이다.
 */

/** 0061 cost_can의 네 영역. 모듈 키 '/<area>/<business_id>'. */
export const COST_AREAS = ['purchasing', 'production', 'sales', 'costing'] as const
export type CostArea = (typeof COST_AREAS)[number]

/** 영역 → 회사 → 쓰기 칸. 줄이 없는 회사는 키가 없다. */
export type CostGrants = Record<CostArea, Record<string, { write: boolean }>>

export const MATERIAL_CATEGORIES = ['main', 'sub', 'additive', 'packaging', 'other'] as const
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

export const MATERIAL_CATEGORY_LABEL_KO: Record<MaterialCategory, string> = {
  main: '주원료',
  sub: '부원료',
  additive: '첨가제',
  packaging: '포장재',
  other: '기타',
}

export interface CostMaterial {
  material_id: string
  business_id: string
  name: string
  spec: string
  category: MaterialCategory
  active: boolean
  note: string
  updated_at: string
}

export interface CostMaterialInput {
  name: string
  spec: string
  category: MaterialCategory
  active: boolean
  note: string
}

export interface CostSupplier {
  supplier_id: string
  business_id: string
  name: string
  country: string
  currency_default: string
  contact: string
  terms: string
  active: boolean
  note: string
  updated_at: string
}

export interface CostSupplierInput {
  name: string
  country: string
  currency_default: string
  contact: string
  terms: string
  active: boolean
  note: string
}

export interface VoidInfo {
  voided_at: string | null
  void_reason: string | null
}

export interface MarketPrice extends VoidInfo {
  price_id: number
  business_id: string
  material_id: string
  observed_on: IsoDate
  price: number
  currency: string
  fx_rate: number
  /** DB 트리거가 계산한 값(입력값 무시). */
  price_krw_per_kg: number
  source_name: string
  source_url: string | null
  note: string
  created_at: string
}

export interface MarketPriceInput {
  material_id: string
  observed_on: IsoDate
  price: number
  currency: string
  /** null이면 DB가 fx_rates(그 날짜 이하 최신)에서 찾는다. */
  fx_rate: number | null
  source_name: string
  source_url: string | null
  note: string
}

export type LotSource = 'manual' | 'approval' | 'import'

export interface PurchaseLot extends VoidInfo {
  lot_id: string
  business_id: string
  material_id: string
  supplier_id: string
  received_on: IsoDate
  ordered_on: IsoDate | null
  supplier_lot_no: string
  qty_kg: number
  unit_price: number
  currency: string
  fx_rate: number
  freight_krw: number
  duty_krw: number
  other_krw: number
  /** DB 트리거: unit_price × qty × fx. */
  goods_krw: number
  /** DB 트리거: (goods + freight + duty + other) ÷ qty. */
  landed_krw_per_kg: number
  source: LotSource
  source_ref: string | null
  note: string
  created_at: string
}

export interface PurchaseLotInput {
  material_id: string
  supplier_id: string
  received_on: IsoDate
  ordered_on: IsoDate | null
  supplier_lot_no: string
  qty_kg: number
  unit_price: number
  currency: string
  fx_rate: number | null
  freight_krw: number
  duty_krw: number
  other_krw: number
  source: 'manual' | 'approval'
  /** source = 'approval'이면 결재 id. */
  source_ref: string | null
  note: string
}

/** 0061 cost_purchase_candidates — 승인된 «구매» 결재 중 LOT가 아직 안 된 것. 금액 ÷ 수량은 후보일 뿐이다. */
export interface PurchaseCandidate {
  decision_id: string
  title: string
  item: string | null
  vendor: string | null
  quantity: number | null
  amount_krw: number | null
  link: string | null
  decided_at: string | null
}

export const PURCHASE_DOC_KINDS = ['quote', 'price_list', 'invoice', 'other'] as const
export type PurchaseDocKind = (typeof PURCHASE_DOC_KINDS)[number]

export const PURCHASE_DOC_KIND_LABEL_KO: Record<PurchaseDocKind, string> = {
  quote: '견적서',
  price_list: '단가표',
  invoice: '송장',
  other: '기타',
}

export interface PurchaseDoc extends VoidInfo {
  doc_id: string
  business_id: string
  lot_id: string | null
  supplier_id: string | null
  kind: PurchaseDocKind
  file_name: string
  mime: string
  size_bytes: number
  storage_path: string
  mix_checked: boolean
  mix_attested: boolean
  created_at: string
}

export interface NewPurchaseDoc {
  doc_id: string
  kind: PurchaseDocKind
  file_name: string
  mime: string
  size_bytes: number
  sha256: string
  storage_path: string
  supplier_id: string | null
  lot_id: string | null
  mix_checked: boolean
  mix_attested: boolean
}

/** 내려받기 — live는 서명 URL, dummy는 바이트(서버 메모리). */
export type PurchaseDocDownload = { url: string } | { file_name: string; mime: string; base64: string }
