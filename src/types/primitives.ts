/** 문서 전반에서 반복되는 기본 타입. 의미를 잃지 않도록 별칭으로 묶어 둔다. */

/** ISO 날짜(YYYY-MM-DD). */
export type IsoDate = string
/** ISO 일시. Output Contract의 updated_at 등. */
export type IsoDateTime = string
/** 기간 키(YYYY-MM). Finance KPI의 period. */
export type PeriodKey = string

/** 기준 통화는 TBD(요구사항서 20번)라 값과 함께 들고 다닌다. */
export const CURRENCY = ['KRW', 'USD'] as const
export type Currency = (typeof CURRENCY)[number]

export type BusinessId = string
export type UserId = string
export type ProjectId = string
export type TaskId = string
export type DecisionId = string
export type AlertId = string

/** 0~100 진행률. */
export type Percent = number
/** 0~1 AI 신뢰도. */
export type Confidence = number

/** 금액. currency 없이 숫자만 돌아다니면 환산 사고가 난다. */
export interface Money {
  amount: number
  currency: Currency
}
