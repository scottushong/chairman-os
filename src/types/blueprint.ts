/**
 * 0081 청사진 뼈대 — Forecast 원가 · 구매 성과 · 고객별 수익성 · 마진 변동 분해 · 경쟁사 가정 · 작업지시 · 제품 진단.
 * 칸 이름은 0081 RPC 반환 칸 그대로(supabase/migrations/0081_blueprint_skeleton.sql). 대표 외 원/kg 값은 DB가 1원으로 준다.
 * null은 «계산 안 됨 · 자료 없음»이다 — 0이 아니다(화면은 «—» · «자료 없음»으로 그린다).
 */

/** ① cost_forecast_list 한 줄. 대표 외 이유는 'not_computed' 하나. */
export interface ForecastRow {
  product_id: string
  product_name: string
  as_of: string
  forecast_material_krw_per_kg: number | null
  forecast_total_krw_per_kg: number | null
  computed: boolean
  reason: 'no_bom' | 'price_missing' | 'overhead_not_ready' | 'not_computed' | null
}

/** ① cost_forecast_setting — 줄이 없으면 기본값(50% · 오늘 환율 · is_default). */
export interface ForecastSetting {
  business_id: string
  blend_purchase_pct: number
  fx_mode: 'today' | 'manual'
  /** 통화(3자) → 원. */
  fx_manual: Record<string, number>
  updated_at: string | null
  is_default: boolean
}

/** ① cost_outlook_list 한 줄(구매 · 원가 관리 · 대표 — 원료 표를 이미 읽는 사람). */
export interface OutlookRow {
  outlook_id: number
  material_id: string
  material_name: string
  month: string
  price: number
  currency: string
  fx_rate: number
  price_krw_per_kg: number
  note: string
  created_at: string
}

export interface OutlookInput {
  material_id: string
  /** 그 달 1일(YYYY-MM-01). */
  month: string
  price: number
  currency: string
  fx_rate: number | null
  note: string
}

/** ② purchase_performance 묶음. */
export type PerfBy = 'lot' | 'material' | 'supplier' | 'month'

export interface PurchasePerfRow {
  key: string
  label: string
  n_lots: number
  /** suppressed면 null(임원 이상 · LOT 3개 미만 묶음). */
  qty_kg: number | null
  purchase_krw: number | null
  market_krw: number | null
  savings_krw: number | null
  fx_effect_krw: number | null
  n_no_market: number
  /** 제한 보기(임원 이상 · 영업 줄 있는 CFO)에서 LOT 3개 미만이라 값을 가린 묶음. */
  suppressed: boolean
  /** 외화 LOT 중 입고월 기준 환율이 없는 수. */
  n_no_fx: number
}

/** ③ 원가 근거 — 생산 LOT Actual · 출고일 Current 추정 · 섞임 · 계산 불가. */
export type ProfitBasis = 'actual' | 'estimated' | 'mixed' | 'uncomputed'

/** ③ customer_profit 한 줄. 영업 = 본인 판매 n_sales · kg · revenue_krw · grade만(나머지 null). */
export interface CustomerProfitRow {
  customer: string
  n_sales: number
  kg: number
  revenue_krw: number
  cogs_krw: number | null
  gm_krw: number | null
  gm_pct: number | null
  grade: string | null
  n_actual: number | null
  n_estimated: number | null
  n_uncomputed: number | null
  basis: ProfitBasis | null
}

/** ③ customer_profit_watch — «매출 큰데 마진 낮은» 상위 10(고객 · 제품 각각). */
export interface ProfitWatchRow {
  kind: 'customer' | 'product'
  key: string
  label: string
  revenue_krw: number
  gm_pct: number | null
  grade: string | null
}

/** ④ margin_bridge 한 기간(kg 가중 원/kg). */
export interface BridgeSide {
  price: number
  material: number
  mfg: number
  logi: number
  other: number
  gm: number
  gm_pct: number | null
  kg: number
  n: number
}

export type BridgeKey = 'price' | 'material' | 'mfg' | 'logi' | 'other'

export const BRIDGE_KEYS: readonly BridgeKey[] = ['price', 'material', 'mfg', 'logi', 'other']

/** ④ margin_bridge 결과. effects 합 = total(대표 정확히 · 대표 외 1원으로 맞춰). materials는 대표 · 제품 지정 때만. */
export interface MarginBridge {
  a: BridgeSide | null
  b: BridgeSide | null
  effects: Record<BridgeKey, number> | null
  total: number | null
  material_pct: number | null
  n_excluded: number
  reason: string | null
  materials: { material_id: string; material_name: string; delta_krw_per_kg: number }[] | null
  as_of: string | null
  product_id: string | null
}

/** ⑤ competitor_assumption_list 한 줄(product_id null = 회사 기본). null 칸 = 우리 값. */
export interface CompetitorAssumption {
  product_id: string | null
  product_name: string | null
  mfg_krw_per_kg: number | null
  logi_krw_per_kg: number | null
  margin_pct: number | null
  note: string
  updated_at: string
}

export interface CompetitorAssumptionInput {
  product_id: string | null
  mfg_krw_per_kg: number | null
  logi_krw_per_kg: number | null
  margin_pct: number | null
  note: string
}

/** ⑤ competitor_price — 결과만(가정 · 원가 값 없음). */
export interface CompetitorPrice {
  product_id: string
  competitor_min_krw_per_kg: number | null
  our_target_krw_per_kg: number | null
  our_margin_at_competitor_pct: number | null
  grade_at_competitor: string | null
  computed: boolean
}

/** ⑥ work_order_get. 원료는 코드(R-xxxxxx)뿐 — 이름은 가림이 꺼졌거나 대표일 때만. 비율 · 수율 · 단가 · 원료 id 없음. */
export interface WorkOrder {
  order_id: string
  product_name: string | null
  planned_on: string
  planned_kg: number
  status: string
  tank: string | null
  seq: number | null
  hide_names: boolean
  /** 지금 담당(uuid) — 대표에게만(생산 직원에게는 null). */
  assignee: string | null
  lines: { code: string; material_name: string | null; batch_kg: number }[]
  inputs: { prod_lot_id: string; code: string; qty_kg: number; created_at: string }[]
}

/** ⑥ work_order_mine 한 줄. */
export interface WorkOrderListRow {
  order_id: string
  product_name: string
  planned_on: string
  planned_kg: number
  status: string
  tank: string | null
  seq: number | null
}

export interface WorkOrderSetInput {
  order_id: string
  tank: string | null
  seq: number | null
  assignee: string | null
  hide_names: boolean
}

/** ⑧ 진단 카드 한 장 — state 'no_data'면 value null · need(필요한 것). */
export interface DiagnosisCard {
  id: number
  key: string
  state: 'ok' | 'no_data'
  value: Record<string, unknown> | null
  need: string | null
}

export interface ProductDiagnosis {
  product_id: string
  product_name: string
  role: 'chairman' | 'costing' | 'sales'
  as_of: string
  cards: DiagnosisCard[]
}

export type ProductTrendGrain = 'day' | 'week' | 'month' | 'quarter' | 'year'

/** ⑧ product_trend 한 점. 원가 관리의 Market 원료비는 오늘이 든 기간 하나만(그 밖 null). */
export interface ProductTrendPoint {
  period_start: string
  kg: number | null
  price_krw_per_kg: number | null
  actual_krw_per_kg: number | null
  market_material_krw_per_kg: number | null
  gm_pct: number | null
}
