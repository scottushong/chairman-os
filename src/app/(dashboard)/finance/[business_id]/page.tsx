import Link from 'next/link'
import { notFound } from 'next/navigation'

import { FinanceView } from '@/components/finance/finance-view'
import { PageHeader } from '@/components/layout/page-header'
import { firstParam, oneOf } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import { STATUS_LABEL_KO } from '@/types'

/**
 * 회사 재무 (Phase 2-A). 손익계산서 · 재무상태표 · 현금흐름표 3탭, 계정별 원본, 월 선택, 확정/잠정 표시.
 *
 * 없는 회사와 볼 수 없는 회사를 구분하지 않는다 — 둘 다 404다(HANDOVER ⑤).
 * 회사는 보이는데 원장이 비어 있으면(권한이 [제한]에 못 미치거나 동기화 전) FinanceView가 그 사실을 말한다.
 */
export default async function BusinessFinancePage(props: PageProps<'/finance/[business_id]'>) {
  const { business_id } = await props.params
  const params = await props.searchParams
  const repo = await getRepository()
  const [businesses, ledger] = await Promise.all([repo.listBusinesses(), repo.loadFinanceLedger()])

  const business = businesses.find((b) => b.business_id === business_id)
  if (!business) notFound()

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="coin"
        title={`${business.name} 재무`}
        code="CH-023 · CH-052"
        description={`${business.industry} · ${STATUS_LABEL_KO[business.status]} · ${business.business_id}`}
      >
        <Link
          href="/finance"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          그룹 재무
        </Link>
        <Link
          href={`/business/${encodeURIComponent(business_id)}`}
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          회사 상세
        </Link>
      </PageHeader>
      <FinanceView
        ledger={ledger}
        businessIds={[business_id]}
        basePath={`/finance/${encodeURIComponent(business_id)}`}
        month={firstParam(params.month)}
        tab={oneOf(firstParam(params.tab), ['is', 'bs', 'cf'] as const) ?? 'is'}
      />
    </div>
  )
}
