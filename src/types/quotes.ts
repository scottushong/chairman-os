import type { IsoDate } from './primitives'
import type { CostGrade } from './sales-cost'

/**
 * 0066 견적. 고치지 않는다 — 바꾸려면 새 판(root_id 같고 version +1). 상태만 DB 함수가 바꾼다.
 * 스냅숏(cost_total · margin · grade)은 저장 순간 영업이 본 값(영업 = 오늘 0시 기준 · 1원, 대표 = 원래 값). 원료 칸 없음.
 */
export const QUOTE_STATUS = ['draft', 'pending_approval', 'confirmed', 'rejected', 'cancelled'] as const
export type QuoteStatus = (typeof QUOTE_STATUS)[number]
/** 화면 상태 — 초안 · 승인 대기가 유효기간을 지나면 «만료»(DB는 확정을 거부한다). */
export type QuoteShownStatus = QuoteStatus | 'expired'

export const QUOTE_STATUS_LABEL_KO: Record<QuoteShownStatus, string> = {
  draft: '초안',
  pending_approval: '승인 대기',
  confirmed: '확정',
  rejected: '반려',
  cancelled: '취소',
  expired: '만료',
}

export const QUOTE_CURRENCIES = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'] as const

export interface Quote {
  quote_id: string
  business_id: string
  root_id: string
  version: number
  parent_id: string | null
  customer_name: string
  customer_company: string
  product_id: string
  product_name: string
  kg: number
  price_krw_per_kg: number
  currency: string
  fx_rate: number
  valid_until: IsoDate
  status: QuoteStatus
  cost_as_of: IsoDate
  /** midnight = 오늘 0시까지 저장된 값(영업) · now = 즉시(대표 · 원가 관리 겸직). */
  cost_basis: 'midnight' | 'now'
  cost_total_krw_per_kg: number
  margin_krw_per_kg: number
  margin_pct: number
  grade: CostGrade
  decision_id: string | null
  created_by: string
  created_at: string
  confirmed_at: string | null
  cancelled_at: string | null
}

export interface QuoteInput {
  product_id: string
  customer_name: string
  customer_company: string
  kg: number
  price_krw_per_kg: number
  currency: string
  valid_until: IsoDate
  /** 새 판이면 원본. */
  parent_id: string | null
}

export function shownQuoteStatus(q: Pick<Quote, 'status' | 'valid_until'>, today: IsoDate): QuoteShownStatus {
  return (q.status === 'draft' || q.status === 'pending_approval') && q.valid_until < today ? 'expired' : q.status
}
