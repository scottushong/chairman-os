import Link from 'next/link'

import { FinanceView } from '@/components/finance/finance-view'
import { PageHeader } from '@/components/layout/page-header'
import { firstParam, oneOf } from '@/lib/query'
import { getRepository } from '@/lib/repository'

/**
 * 그룹 재무 (Phase 2-A). 5개사 단순 합산, 회사 화면과 같은 구조.
 *
 * 보관(Archived) 회사는 뺀다. 합산 범위는 권한이 정한다 — 원장 read 정책(0015)이 볼 수 없는 회사의
 * 행을 주지 않으므로, 그룹 합계는 '내가 볼 수 있는 회사들'의 합이다. 화면이 몇 개사인지 적는다.
 */
export default async function GroupFinancePage(props: PageProps<'/finance'>) {
  const params = await props.searchParams
  const repo = await getRepository()
  const [businesses, ledger] = await Promise.all([repo.listBusinesses(), repo.loadFinanceLedger()])
  const active = businesses.filter((b) => b.status !== 'Archived').sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="coin"
        title="그룹 재무"
        code="CH-025~027"
        description={`${active.length}개사 합산 · 손익계산서 · 재무상태표 · 현금흐름표 · 모든 숫자에 출처 꼬리표`}
      >
        <div className="flex flex-wrap items-center gap-1">
          {active.map((b) => (
            <Link
              key={b.business_id}
              href={`/finance/${encodeURIComponent(b.business_id)}`}
              className="rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
            >
              {b.name}
            </Link>
          ))}
        </div>
      </PageHeader>
      <FinanceView
        ledger={ledger}
        businessIds={active.map((b) => b.business_id)}
        basePath="/finance"
        month={firstParam(params.month)}
        tab={oneOf(firstParam(params.tab), ['is', 'bs', 'cf'] as const) ?? 'is'}
      />
    </div>
  )
}
