/**
 * PHASE 5 «0067 화면 — 판매 실적 · 마진»(0077 sales_deals · sales_margins).
 * 금액은 원(KRW). 영업 칸(SaleDeal)에는 실제 원가 · 실제 마진 · 0시 총원가 · 0시 마진 %가 **없다** — 등급만.
 */

export type MarginGrain = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type MarginBy = 'deal' | 'product' | 'customer' | 'total'

/** 0067 snap_grade — 기록 순간 «오늘 0시 기준» 등급(실제 원가 아님). */
export type SaleGrade = 'green' | 'yellow' | 'red' | 'too_low' | 'unknown'

/** 영업 실적 한 줄(0077 sales_deals). */
export interface SaleDeal {
  sale_id: string
  shipped_on: string
  customer_company: string
  customer_name: string
  product_name: string
  kg: number
  price_krw_per_kg: number
  currency: string
  /** kg × 판매가, 1원. */
  revenue_krw: number
  grade: SaleGrade
  grade_as_of: string
  /** 0067 snap_basis — 'midnight' = 그날 0시 기준(영업) · 'now' = 기록 순간 값(대표 · 원가 관리). */
  grade_basis: 'midnight' | 'now'
  quote_id: string | null
  mine: boolean
}

/** 'closed_month' = 그 묶음의 달이 모두 0075 내부 마감 확정 · 'provisional' = 잠정 대체원가(조회 때 계산 · 저장 안 함). */
export type MarginCostBasis = 'closed_month' | 'provisional'

/** 견적 마진 vs 실제 마진 한 줄(0077 sales_margins = 0067 cost_margins + 매출 1원 + 월 마감 표시). */
export interface SalesMarginRow {
  period_start: string
  key: string
  label: string
  n_sales: number
  /** 실제 원가가 계산 안 된 판매 수(합산의 원가 · 마진에서 빠진다 — 매출에는 들어간다). */
  n_uncomputed: number
  kg: number
  revenue_krw: number
  cost_krw: number | null
  margin_krw: number | null
  margin_pct: number | null
  grade: 'green' | 'yellow' | 'red' | null
  quote_kg: number | null
  quote_margin_krw: number | null
  quote_margin_pct: number | null
  // p_by = 'deal'일 때만 채워진다.
  sale_id: string | null
  shipped_on: string | null
  customer: string | null
  product_name: string | null
  price_krw_per_kg: number | null
  currency: string | null
  /** 'actual' = 생산 LOT Actual · 'current' = 출고일 Current(잠정 대체원가). */
  cost_source: 'actual' | 'current' | null
  cost_krw_per_kg: number | null
  quote_id: string | null
  quote_price_krw_per_kg: number | null
  quote_cost_krw_per_kg: number | null
  pl_closed: boolean
  cost_basis: MarginCostBasis
}
