import type { IsoDate } from './primitives'

/**
 * 원가 엔진 — 영업 화면(회장 결정 2026-10-09 «영업은 제품 총액만, 원료별 가격은 모른다»)과 대표의 «원가 관리 권한자» 감시.
 *
 * **원료 이름 · 원료별 값을 담는 칸이 없다.** 0062 cost_sales_view · cost_price_check가 돌려주는 칸 그대로다 — 칸을 더하지 않는다.
 * 금액은 전부 원/kg · 10원 반올림(DB가 한다).
 */

/** 0061 cost_products — 이름만. 원료 구성은 여기 없다(0062 비공개 장부). */
export interface CostProduct {
  product_id: string
  business_id: string
  name: string
  sku: string
  pack_kg: number | null
  active: boolean
}

/** GM 20% 이상 green · 15~20% yellow · 15% 미만 red(0062 cost_grade). */
export type CostGrade = 'green' | 'yellow' | 'red'

export interface SalesOffer {
  margin_pct: number
  price_krw_per_kg: number
  grade: CostGrade
}

/** 0062 cost_sales_view 한 줄. */
export interface SalesCostView {
  product_id: string
  /** 대표 외 = 이번 주 월요일(KST). 대표 = 오늘. */
  as_of: IsoDate
  market_krw_per_kg: number | null
  current_krw_per_kg: number | null
  /** 원가 우위 = Market − Current. 양수면 시장가보다 싸게 산 것. */
  advantage_krw_per_kg: number | null
  /** 비용 마스터(0065) 전에는 null. */
  overhead_krw_per_kg: number | null
  total_krw_per_kg: number | null
  overhead_ready: boolean
  /** 원료비 영향(지난 주 → 이번 주, 0.1%p). */
  material_impact_pct: number | null
  computed: boolean
  offers: SalesOffer[]
}

/** 0062 cost_sales_list 한 줄 — cost_sales_view에 제품 이름만 더한 것. */
export interface SalesCostRow extends SalesCostView {
  product_name: string
}

/** 0062 cost_price_check. 원가를 계산하지 못한 주에는 칸이 다 null. */
export interface PriceCheck {
  total_krw_per_kg: number | null
  margin_krw_per_kg: number | null
  margin_pct: number | null
  grade: CostGrade | null
}

/** 0061 cost_costing_watch — 대표만. */
export interface CostingWatchRow {
  user_id: string
  display_name: string
  granted_at: string | null
  cost_reads_7d: number
  screen_reads_7d: number
  last_read_at: string | null
}
