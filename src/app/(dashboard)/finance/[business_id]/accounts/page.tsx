import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AccountsManager } from '@/components/finance/accounts-manager'
import { BooksNav } from '@/components/finance/books-nav'
import { PageHeader } from '@/components/layout/page-header'
import { canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { ECOUNT_CODE_BUSINESSES } from '@/lib/ledger/standard-chart'
import { getRepository } from '@/lib/repository'

/**
 * 계정과목 관리 (Phase 2-B 블록 1, 0016).
 *
 * 목록·추가·비활성화. 코드는 만들 때 정하고 바꾸지 않는다 — 이름과 분류만 고친다.
 * 계정은 지우지 않는다. 전표·결산이 코드를 물고 있어서다.
 *
 * 스타트업 네 곳은 0016이 표준 계정과목표를 시드했다. 계정이 하나도 없는 회사(새로 추가한 회사)는
 * 여기서 표준표를 받는다. DY는 ECOUNT 코드 체계를 업로드 때 그대로 싣는다.
 */
export default async function AccountsPage(props: PageProps<'/finance/[business_id]/accounts'>) {
  const { business_id } = await props.params
  const repo = await getRepository()
  const [businesses, ledger, user] = await Promise.all([repo.listBusinesses(), repo.loadFinanceLedger(), currentUser()])

  const business = businesses.find((b) => b.business_id === business_id)
  if (!business) notFound()

  const accounts = ledger.accounts
    .filter((a) => a.business_id === business_id)
    .sort((a, b) => a.account_code.localeCompare(b.account_code))
  // 전표가 문 계정. 비활성화는 되지만 '쓰인 적 있음'을 보여 준다 — 지울 수 없는 이유가 여기 있다.
  const used = [...new Set(ledger.journal.filter((j) => j.business_id === business_id).map((j) => j.account_code))]

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="book"
        title={`${business.name} 계정과목`}
        code="CH-052"
        description="코드는 바꾸지 않습니다. 이름·분류만 고치고, 안 쓰는 계정은 비활성화합니다."
      >
        <BooksNav businessId={business_id} current="accounts" />
        <Link
          href="/finance"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          그룹 재무
        </Link>
      </PageHeader>
      <AccountsManager
        businessId={business_id}
        accounts={accounts}
        usedCodes={used}
        canEdit={canKeepBooks(user)}
        usesEcountCodes={ECOUNT_CODE_BUSINESSES.includes(business_id)}
      />
    </div>
  )
}
