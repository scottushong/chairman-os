import type { Account, BusinessId, Figure, FinanceLedger, FinanceMetric, PeriodKey } from '@/types'

import { sumFigures } from './basis'
import { buildCells, metricsOf } from './cells'

/**
 * 재무 화면이 보는 범위 — 회사 하나이거나, 그룹(여러 회사의 단순 합산).
 *
 * 그룹은 계정코드로 더한다. mock은 다섯 회사가 같은 계정과목표를 쓰지만 실제 회사들은 아닐 수 있다.
 * 계열사 계정과목표를 받으면 그룹 표준 코드로 옮기는 층이 필요하다(DEFERRED D-19).
 * 내부거래 제거도 하지 않는다 — 화면이 '단순 합산'이라고 적는다.
 */
export interface LedgerScope {
  businessIds: BusinessId[]
  /** 데이터가 있는 달, 오래된 순 */
  periods: PeriodKey[]
  accounts: Map<string, Account>
  /** 그 달의 계정별 칸(차변 − 대변). 그룹이면 회사들을 더한 값 */
  cellsAt(period: PeriodKey): Map<string, Figure>
  /** 그 달에 원장이 있는 회사 수. 그룹에서 이 값이 businessIds.length보다 작으면 합계가 부분이다 */
  coverageAt(period: PeriodKey): number
  /** 그 달이 결산에서 왔나 전표에서 왔나. 섞였으면 mixed */
  originAt(period: PeriodKey): 'closing' | 'journal' | 'mixed' | null
  metricsAt(period: PeriodKey): Partial<Record<FinanceMetric, Figure>>
}

export function ledgerScope(ledger: FinanceLedger, businessIds: BusinessId[]): LedgerScope {
  const perBusiness = businessIds.map((id) => ({ id, cells: buildCells(ledger, id) }))

  const accounts = new Map<string, Account>()
  for (const a of ledger.accounts) {
    if (businessIds.includes(a.business_id) && !accounts.has(a.account_code)) {
      accounts.set(a.account_code, a)
    }
  }

  const periods = [...new Set(perBusiness.flatMap((b) => [...b.cells.keys()]))].sort()

  const cache = new Map<PeriodKey, Map<string, Figure>>()
  function cellsAt(period: PeriodKey): Map<string, Figure> {
    const hit = cache.get(period)
    if (hit) return hit
    const parts = new Map<string, Figure[]>()
    for (const b of perBusiness) {
      for (const cell of b.cells.get(period)?.cells.values() ?? []) {
        const list = parts.get(cell.account_code) ?? []
        list.push(cell.amount)
        parts.set(cell.account_code, list)
      }
    }
    const out = new Map([...parts].map(([code, figs]) => [code, sumFigures(figs)!]))
    cache.set(period, out)
    return out
  }

  return {
    businessIds,
    periods,
    accounts,
    cellsAt,
    coverageAt: (period) => perBusiness.filter((b) => b.cells.has(period)).length,
    originAt(period) {
      const origins = new Set(perBusiness.map((b) => b.cells.get(period)?.from).filter(Boolean))
      if (origins.size === 0) return null
      return origins.size > 1 ? 'mixed' : (origins.values().next().value as 'closing' | 'journal')
    },
    metricsAt(period) {
      const cells = new Map(
        [...cellsAt(period)].map(([code, amount]) => [code, { account_code: code, amount }]),
      )
      return metricsOf(cells, accounts)
    },
  }
}
