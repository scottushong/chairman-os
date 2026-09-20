/**
 * 공식 재무제표의 기간과, 그것이 덮는 달 (Phase 2-C 블록 1·2).
 *
 * 공식 재무제표는 연 또는 분기 단위다. 월별 간이 손익(블록 2)은 월 단위다.
 * 둘이 같은 달을 두 번 말하면 KPI가 두 배가 되므로, **공식이 덮은 달은 월별 입력을 잠근다.**
 * 그 판정이 이 파일이다.
 */

export type OfficialPeriodKind = 'year' | 'quarter'

export interface OfficialPeriod {
  kind: OfficialPeriodKind
  /** kind='year'면 'YYYY', kind='quarter'면 'YYYY-Q1'..'YYYY-Q4'. */
  key: string
}

export const YEAR_KEY_PATTERN = /^\d{4}$/
export const QUARTER_KEY_PATTERN = /^\d{4}-Q[1-4]$/

export function isValidPeriodKey(period: OfficialPeriod): boolean {
  return period.kind === 'year'
    ? YEAR_KEY_PATTERN.test(period.key)
    : QUARTER_KEY_PATTERN.test(period.key)
}

const pad = (month: number) => String(month).padStart(2, '0')

/** 그 기간이 덮는 'YYYY-MM' 목록. 연간은 12개, 분기는 3개다. */
export function monthsCovered(period: OfficialPeriod): string[] {
  if (!isValidPeriodKey(period)) return []

  if (period.kind === 'year') {
    return Array.from({ length: 12 }, (_, i) => `${period.key}-${pad(i + 1)}`)
  }

  const year = period.key.slice(0, 4)
  const quarter = Number(period.key.slice(6))
  const first = (quarter - 1) * 3 + 1
  return [0, 1, 2].map((offset) => `${year}-${pad(first + offset)}`)
}

/**
 * 이 달이 공식 재무제표에 덮여 있는가.
 *
 * 덮여 있으면 월별 화면의 그 칸은 입력이 막히고 '확정'으로 표시된다.
 * 잠그는 이유는 화면 정리가 아니라 **이중 계상을 막는 것**이다.
 */
export function isLocked(month: string, officials: OfficialPeriod[]): boolean {
  return officials.some((period) => monthsCovered(period).includes(month))
}

/** 잠근 근거. 화면이 hover로 "2025 결산"처럼 보여 준다. */
export function lockingPeriod(
  month: string,
  officials: OfficialPeriod[],
): OfficialPeriod | null {
  return officials.find((period) => monthsCovered(period).includes(month)) ?? null
}
