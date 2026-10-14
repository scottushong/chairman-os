/**
 * PHASE 6 원가 후보 승인(0078). 자료 올리기(0070 · 0072 fin_*)의 후보 한 줄과 사람의 결정.
 * 칸에 BOM · 원료 비율 · 제품별 투입은 없다 — ②는 구매 한 줄 · ①은 판매 한 줄 · ⑦은 대금 · 부대비뿐.
 */
export type CandidateSource = 'fin_purchase_in_lines' | 'fin_import_lines' | 'fin_sales_lines'
export type CandidateKind = 'purchase_lot' | 'landed' | 'sale'
export type CandidateAction = 'lot' | 'ignore' | 'later'

export interface CostCandidate {
  source_table: CandidateSource
  kind: CandidateKind
  line_id: number
  period: string
  tx_date: string | null
  name: string | null
  counterparty: string | null
  qty: number | null
  amount_krw: number | null
  unit_krw_per_kg: number | null
  extra_krw: number | null
  ref_no: string | null
  last_action: CandidateAction | null
  last_reason: string | null
  last_at: string | null
  target_ref: string | null
}

export interface CandidateDecision {
  source: CandidateSource
  line_id: number
  action: CandidateAction
  reason: string
  /** ② LOT로 넣기 — 원료 · 공급처(원가 엔진 마스터) · 입고일(비우면 거래일 · 그 달 말일). */
  material_id?: string | null
  supplier_id?: string | null
  on?: string | null
  /** ⑦ — 부대비를 더할 LOT. */
  lot_id?: string | null
  /** ① — 판매 실적의 제품(0067 sale_record). */
  product_id?: string | null
}
