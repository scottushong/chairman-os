import { buildCells } from '@/lib/ledger/cells'
import { addMonths } from '@/lib/ledger/basis'
import type { Account, Closing, IsoDateTime, JournalLine, PeriodKey } from '@/types'

import type { AccountChart } from './account-map'
import { mapAccounts, mapClosings, mapSlipLines, toYyyymmdd, type MapContext } from './map'
import type { EcountCompany, EcountLedgerSource } from './types'

/**
 * 회사 하나의 원장을 ECOUNT에서 가져와 Chairman OS 모양으로 바꾼다. DB에는 쓰지 않는다.
 *
 * 쓰기를 떼어 둔 이유: dummy 모드는 이 결과를 메모리에서 그대로 쓰고(repository/dummy.ts),
 * live 동기화는 같은 결과를 DB에 넣는다(sync.ts). 가져오는 길이 하나여야 dummy 화면이 보여 주는 숫자와
 * 동기화가 넣을 숫자가 같은 변환을 거친다.
 */

export interface IngestWindow {
  from: PeriodKey
  to: PeriodKey
}

export interface IngestedLedger {
  business_id: string
  accounts: Account[]
  journal: JournalLine[]
  closings: Closing[]
  last_closed_period: PeriodKey | null
}

export async function ingestCompany(
  source: EcountLedgerSource,
  company: EcountCompany,
  window: IngestWindow,
  fetchedAt: IsoDateTime,
  /** 이 회사의 계정과목표. 분류는 ECOUNT가 주지 않는다(account-map.ts) */
  chart: AccountChart,
): Promise<IngestedLedger> {
  const fromYymm = window.from.replace('-', '')
  const toYymm = window.to.replace('-', '')
  const [accountRows, closingRows] = await Promise.all([
    source.listAccounts(company),
    source.listClosings(company, fromYymm, toYymm),
  ])
  const lastClosed =
    closingRows
      .filter((r) => r.CLOSE_YN === 'Y')
      .map((r) => `${r.YYMM.slice(0, 4)}-${r.YYMM.slice(4)}`)
      .sort()
      .at(-1) ?? null

  const ctx: MapContext = {
    chart,
    business_id: company.business_id,
    fetched_at: fetchedAt,
    last_closed_period: lastClosed,
  }

  const accounts = mapAccounts(accountRows, ctx)
  const lastDay = new Date(Date.UTC(Number(window.to.slice(0, 4)), Number(window.to.slice(5, 7)), 0))
  const slipRows = await source.listSlipLines(
    company,
    toYyyymmdd(`${window.from}-01`),
    toYyyymmdd(lastDay.toISOString().slice(0, 10)),
  )
  const journal = mapSlipLines(slipRows, ctx)

  // 마감 시점의 잠정치 = 결산을 빼고 전표만으로 만든 그 달의 칸(lib/ledger/cells.ts 규칙 ②).
  const journalOnly = buildCells(
    { accounts, journal, closings: [], fxRates: [], costIndices: [] },
    company.business_id,
  )
  const closings = mapClosings(
    closingRows,
    ctx,
    (period, code) => journalOnly.get(period)?.cells.get(code)?.amount.value ?? null,
  )

  return { business_id: company.business_id, accounts, journal, closings, last_closed_period: lastClosed }
}

/** 동기화 창. 전년동월비·TTM이 서려면 24개월이 필요하다. */
export function defaultWindow(today: PeriodKey): IngestWindow {
  return { from: addMonths(today, -24), to: today }
}
