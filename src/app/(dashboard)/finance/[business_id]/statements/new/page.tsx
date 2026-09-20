import { notFound } from 'next/navigation'

import { BooksNav } from '@/components/finance/books-nav'
import { StatementEditor } from '@/components/finance/statement-editor'
import { PageHeader } from '@/components/layout/page-header'
import { canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 공식 재무제표 입력 (Phase 2-C 블록 1, 0020).
 *
 * 회계법인이 낸 연·분기 결산을 그대로 받는다. 월별 간이 손익(블록 2)과 층이 다르다 —
 * 이 결산이 덮은 달은 그쪽 입력이 잠긴다. 두 층이 같은 달을 두 번 말하면 KPI가 두 배가 된다.
 *
 * 권한은 화면에서도 보고 DB에서도 본다. 여기서 막는 것은 **없는 버튼을 보여 주지 않으려는 것**이고,
 * 실제 판정은 0020의 can_keep_books()가 한다.
 */
export default async function NewStatementPage(
  props: PageProps<'/finance/[business_id]/statements/new'>,
) {
  const { business_id } = await props.params
  const repo = await getRepository()
  const [businesses, ledger, user, officials] = await Promise.all([
    repo.listBusinesses(),
    repo.loadFinanceLedger(),
    currentUser(),
    repo.listOfficialStatements(business_id),
  ])

  const business = businesses.find((b) => b.business_id === business_id)
  if (!business) notFound()

  const accounts = ledger.accounts.filter((a) => a.business_id === business_id && a.active)

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-5">
      <PageHeader
        icon="file-text"
        title={`${business.name} — 공식 재무제표 입력`}
        code="CH-025"
        description="회계법인 결산을 연 또는 분기 단위로 넣습니다. 저장하면 확정으로 기록되고 그 기간의 월별 입력이 잠깁니다."
      >
        <BooksNav businessId={business_id} current="official" />
      </PageHeader>

      {canKeepBooks(user) ? (
        accounts.length === 0 ? (
          <p className="mt-4 rounded-md bg-warning/10 px-3 py-2 text-[12px] text-warning">
            이 회사에 계정과목이 없습니다. 계정과목 화면에서 표준 계정과목표를 먼저 받으세요.
          </p>
        ) : (
          <div className="mt-4">
            <StatementEditor
              businessId={business_id}
              businessName={business.name}
              accounts={accounts}
              existingPeriods={officials.map((o) => ({
                kind: o.period_kind,
                key: o.period_key,
                memo: o.memo,
              }))}
            />
          </div>
        )
      ) : (
        <p className="mt-4 rounded-md bg-panel px-3 py-2 text-[12px] text-ink-dim">
          이 회사의 결산을 넣을 권한이 없습니다. (Chairman · Group CFO · 해당 회사 Business CEO)
        </p>
      )}
    </div>
  )
}
