import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BooksNav } from '@/components/finance/books-nav'
import { CloseMonth } from '@/components/finance/close-month'
import { FinanceView } from '@/components/finance/finance-view'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { canCloseBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { closablePeriod } from '@/lib/ledger/closing'
import { todayKst } from '@/lib/ledger/journal'
import { firstParam, oneOf } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import { STATUS_LABEL_KO } from '@/types'

/**
 * 회사 재무 (Phase 2-A). 손익계산서 · 재무상태표 · 현금흐름표 3탭, 계정별 원본, 월 선택, 확정/잠정 표시.
 * Phase 2-B: 머리글에 'N월 마감'(블록 3)과 전표·계정과목 화면으로 가는 길.
 *
 * 없는 회사와 볼 수 없는 회사를 구분하지 않는다 — 둘 다 404다(HANDOVER ⑤).
 * 회사는 보이는데 원장이 비어 있으면(권한이 [제한]에 못 미치거나 동기화 전) FinanceView가 그 사실을 말한다.
 */
export default async function BusinessFinancePage(props: PageProps<'/finance/[business_id]'>) {
  const { business_id } = await props.params
  const params = await props.searchParams
  const repo = await getRepository()
  const [businesses, ledger, user] = await Promise.all([repo.listBusinesses(), repo.loadFinanceLedger(), currentUser()])

  const business = businesses.find((b) => b.business_id === business_id)
  if (!business) notFound()

  /**
   * 블록 7. **재무 화면 조회**를 기록한다. 원문이 페이지 진입·문서 열람과 나란히 지목한
   * 셋 중 하나다 — 금액이 뜨는 화면은 누가 언제 봤는지가 감사의 대상이다.
   * 404 뒤에 둔다(볼 수 없는 회사의 id를 찍어 본 것은 조회가 아니다).
   * 월·탭을 바꿔 가며 보는 화면이라 경로에 쿼리를 싣지 않는다 — 그러면 5분 억제가
   * 탭마다 따로 걸려 한 번 앉은 자리가 여러 줄이 된다.
   */
  await recordScreenRead({
    path: `/finance/${business_id}`,
    kind: 'finance',
    business_id,
  })

  // 마감 차례인 달. 마감 담당(Chairman · GroupCFO · 0047 월 마감 권한을 받은 사람)에게만 버튼이 선다 — 안내다, 문은 0016 close_period().
  const closable = canCloseBooks(user, business_id) ? closablePeriod(ledger, business_id, todayKst()) : null

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="coin"
        title={`${business.name} 재무`}
        code="CH-023 · CH-052"
        description={`${business.industry} · ${STATUS_LABEL_KO[business.status]} · ${business.business_id}`}
      >
        {/* PageHeader의 오른쪽 칸은 줄을 접지 않는다. 폰에서는 버튼들이 한 줄에 못 들어가 탭이 한 글자씩 눌렸다 —
            여기서 한 번 감싸 좁을 때만 다음 줄로 넘긴다(넓은 화면은 한 줄 그대로). */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {closable ? <CloseMonth businessId={business_id} period={closable} /> : null}
          <BooksNav businessId={business_id} current="statements" />
          <Link
            href="/finance"
            className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            그룹 재무
          </Link>
          <Link
            href={`/business/${encodeURIComponent(business_id)}`}
            className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            회사 상세
          </Link>
        </div>
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
