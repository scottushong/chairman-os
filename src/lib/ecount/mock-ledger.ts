import { mockMarket } from '@/lib/market/mock'
import type { FinanceLedger } from '@/types'

import { ingestCompany } from './ingest'
import { MOCK_COMPANIES, MOCK_FETCHED_AT, mockLedgerSource } from './mock'

/**
 * dummy 모드의 원장 한 벌. 동기화(sync.ts)와 **같은 길**(ECOUNT 모양 → map.ts → ingest.ts)로 만든다.
 * dummy에서 보이는 숫자가 live 동기화가 넣을 숫자와 같은 변환을 거쳤다는 뜻이다.
 *
 * 서버 프로세스에서 한 번만 만든다. 원장은 바뀌지 않는 mock이고, 매 요청 3천 줄을 다시 만들 이유가 없다.
 */

export const MOCK_WINDOW = { from: '2024-09', to: '2026-08' } as const

let cached: Promise<FinanceLedger> | null = null

export function loadMockLedger(): Promise<FinanceLedger> {
  cached ??= (async () => {
    const parts = await Promise.all(
      MOCK_COMPANIES.map((c) => ingestCompany(mockLedgerSource, c, MOCK_WINDOW, MOCK_FETCHED_AT)),
    )
    const periods = [...new Set(parts.flatMap((p) => p.journal.map((j) => j.entry_date.slice(0, 7))))].sort()
    return {
      accounts: parts.flatMap((p) => p.accounts),
      journal: parts.flatMap((p) => p.journal),
      closings: parts.flatMap((p) => p.closings),
      ...mockMarket(periods),
    }
  })()
  return cached
}
