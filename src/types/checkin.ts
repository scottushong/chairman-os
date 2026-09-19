import type { IsoDate, IsoDateTime } from './primitives'

/**
 * Phase 5 회장 체크인 (0019_chairman_checkins).
 *
 * chairman.ts의 ChairmanManifesto/ChairmanProject와 같은 성격이다 — 회사에 속하지 않는
 * 회장 개인의 기록. condition은 DB에서도 1~5로 가둔다(0019 chairman_checkins_condition) —
 * 여기 리터럴 유니온만 믿지 않는다. 야간 브리핑(P5-5d)의 "2 이하" 판정이 이 값에 걸린다.
 */
export type ChairmanCondition = 1 | 2 | 3 | 4 | 5

export interface ChairmanCheckin {
  checkin_date: IsoDate
  condition: ChairmanCondition
  /** numeric(3,1). 기록이 없으면 null. */
  sleep_hours: number | null
  /** numeric(4,1). 기록이 없으면 null — 회장 개인 건강 기록이다(0019). */
  weight_kg: number | null
  meal_note: string
  updated_at: IsoDateTime
}
