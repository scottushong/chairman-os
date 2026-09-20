import { monthsCovered, type OfficialPeriod } from '@/lib/statements/period'

/**
 * "기준: 2025 결산(확정) + 2026 1~8월(잠정)" 한 줄 (Phase 2-C 블록 3).
 *
 * **하드코딩하지 않는다.** 두 층(공식 재무제표 / 월별 전표)을 실제로 조회해 만든다.
 * 문장을 고정해 두면 결산이 하나 더 들어온 날부터 화면이 거짓말을 시작하고,
 * 그 거짓말은 '확정'이라는 낱말을 달고 있어서 가장 믿기 쉬운 자리에 앉는다.
 *
 * 연속한 달은 범위로 접는다 — '1,2,3,4,5,6,7,8월'은 읽는 문장이 아니다.
 */

/** [1,2,3,5,6,9] → '1~3, 5~6, 9월' */
export function compactMonths(monthNumbers: number[]): string {
  const sorted = [...new Set(monthNumbers)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''

  const ranges: string[] = []
  let start = sorted[0]
  let prev = sorted[0]

  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n
      continue
    }
    ranges.push(start === prev ? `${start}` : `${start}~${prev}`)
    start = n
    prev = n
  }
  ranges.push(start === prev ? `${start}` : `${start}~${prev}`)
  return `${ranges.join(', ')}월`
}

export interface BasisLineInput {
  /** 활성 공식 재무제표의 기간. */
  officials: OfficialPeriod[]
  /** 전표가 실제로 있는 달('YYYY-MM'). finance_kpis가 값을 내는 달과 같다. */
  ledgerMonths: string[]
}

/**
 * 한 줄을 만든다. 둘 다 없으면 빈 문자열이고, 그때 화면은 이 줄을 아예 그리지 않는다 —
 * "기준: 없음"은 회장에게 아무것도 말해 주지 않는다.
 */
export function basisLine({ officials, ledgerMonths }: BasisLineInput): string {
  const parts: string[] = []

  // 공식 결산은 기간 키 순서대로. 2025, 2026-Q1 …
  for (const period of [...officials].sort((a, b) => a.key.localeCompare(b.key))) {
    parts.push(`${period.key} 결산(확정)`)
  }

  // 공식이 덮은 달은 빼고 남은 달만 '잠정'으로 센다. 두 층이 같은 달을 두 번 말하면 안 된다.
  const covered = new Set(officials.flatMap(monthsCovered))
  const open = ledgerMonths.filter((m) => !covered.has(m))

  const byYear = new Map<string, number[]>()
  for (const month of open) {
    const year = month.slice(0, 4)
    byYear.set(year, [...(byYear.get(year) ?? []), Number(month.slice(5, 7))])
  }

  for (const year of [...byYear.keys()].sort()) {
    parts.push(`${year} ${compactMonths(byYear.get(year) ?? [])}(잠정)`)
  }

  return parts.length === 0 ? '' : `기준: ${parts.join(' + ')}`
}
