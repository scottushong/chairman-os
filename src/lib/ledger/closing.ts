import type { BusinessId, Closing, FinanceLedger, IsoDate, PeriodKey } from '@/types'

import { periodOfDate } from './basis'
import { buildCells } from './cells'
import { lastClosedPeriod } from './journal'

/**
 * 월 마감 규칙 (Phase 2-B 블록 3). 0016의 close_period()와 같은 순서로 본다.
 * 화면은 '어느 달을 마감할 차례인가'를, dummy 어댑터는 마감 자체를 여기서 가져간다.
 */

/** DB가 던지는 낱말 → 사람 말. dummy도 같은 낱말로 던진다. */
export const CLOSE_PROBLEM_KO = {
  close_forbidden: '월 마감은 Chairman · Group CFO만 할 수 있습니다.',
  invalid_period: '마감할 달이 올바르지 않습니다.',
  period_not_ended: '아직 끝나지 않은 달은 마감할 수 없습니다.',
  already_closed: '이미 마감된 달입니다. 마감 해제는 없습니다 — 당월에 정정 전표를 넣고 당월을 마감하세요.',
  earlier_period_open: '앞선 달부터 순서대로 마감하세요.',
  nothing_to_close: '마감할 전표가 없습니다.',
} as const
export type CloseProblem = keyof typeof CLOSE_PROBLEM_KO

/** 마감 차례인 달 — 마지막 마감 뒤, 전표가 있는, 이미 끝난 달 중 가장 앞. 없으면 null. */
export function closablePeriod(ledger: FinanceLedger, businessId: BusinessId, today: IsoDate): PeriodKey | null {
  const last = lastClosedPeriod(ledger, businessId)
  const current = periodOfDate(today)
  const open = ledger.journal
    .filter((j) => j.business_id === businessId)
    .map((j) => periodOfDate(j.entry_date))
    .filter((p) => (last === null || p > last) && p < current)
    .sort()
  return open[0] ?? null
}

/** 0016 close_period()의 검사 순서(권한 제외 — 권한은 DB만 본다). 문제가 없으면 null. */
export function closeProblem(
  ledger: FinanceLedger,
  businessId: BusinessId,
  period: PeriodKey,
  today: IsoDate,
): CloseProblem | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return 'invalid_period'
  if (period >= periodOfDate(today)) return 'period_not_ended'
  const last = lastClosedPeriod(ledger, businessId)
  if (last !== null && last >= period) return 'already_closed'
  const earlier = ledger.journal.some((j) => {
    if (j.business_id !== businessId) return false
    const p = periodOfDate(j.entry_date)
    return p < period && (last === null || p > last)
  })
  if (earlier) return 'earlier_period_open'
  if (!buildCells(ledger, businessId).get(period)?.cells.size) return 'nothing_to_close'
  return null
}

/**
 * 마감으로 찍을 결산 칸들. finance_ledger_cells(전표 기준)의 그 달 — lib/ledger/cells.ts buildCells와 같은 규칙.
 * provisional_amount = amount: 마감 순간 보이던 잠정치를 그대로 남긴다.
 */
export function closingRows(
  ledger: FinanceLedger,
  businessId: BusinessId,
  period: PeriodKey,
  today: IsoDate,
  fetchedAt: string,
): Closing[] {
  const cells = buildCells(ledger, businessId).get(period)?.cells ?? new Map()
  return [...cells.values()].map((c) => ({
    business_id: businessId,
    period,
    account_code: c.account_code,
    amount: c.amount.value,
    closed_on: today,
    provisional_amount: c.amount.value,
    source: 'manual',
    fetched_at: fetchedAt,
    closed: true,
  }))
}
