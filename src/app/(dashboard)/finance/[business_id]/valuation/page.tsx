import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BooksNav } from '@/components/finance/books-nav'
import { RecloseBadges } from '@/components/finance/reclose-badges'
import { IssueSection, RollSection, ValuationSection } from '@/components/finance/valuation-board'
import { PageHeader } from '@/components/layout/page-header'
import { canCloseBooks, canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { firstParam } from '@/lib/query'
import { getRepository } from '@/lib/repository'

/**
 * 0072 «재고 · 평가» — /finance/<회사>/valuation. 재공품 · 완제품 평가금액(입력 · 잠정 · 확정 — 확정은 입력한 사람이 아닌 사람) ·
 * 기초재고 연결(전월 확정 기말 · 직접 입력 · 재고금액명세서 · 미연결 — 차이는 보여 주기만) · 원료 출고 구분(합계만 — 원료별 kg 없음) ·
 * 재마감 대상. 판정은 0072 RPC다. 권한(장부 쓰기)이 없으면 문장으로 말한다.
 */
export default async function FinanceValuationPage(props: PageProps<'/finance/[business_id]/valuation'>) {
  const { business_id } = await props.params
  const params = await props.searchParams
  const repo = await getRepository()
  const [businesses, user] = await Promise.all([repo.listBusinesses(), currentUser()])
  const business = businesses.find((b) => b.business_id === business_id)
  if (!business) notFound()

  const canKeep = canKeepBooks(user, business_id)
  const asked = firstParam(params.month)
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : kstToday().slice(0, 7)

  const [valuations, warnings, roll, issue, reclose] = canKeep
    ? await Promise.all([
        repo.listFinValuations(business_id, month).catch(() => []),
        repo.finValuationWarnings(business_id, month).catch(() => []),
        repo.finInventoryRoll(business_id, month).catch(() => []),
        repo.finIssueSummary(business_id, month).catch(() => null),
        repo.listFinRecloseFlags(business_id).catch(() => []),
      ])
    : [[], [], [], null, []]

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="arrow-up"
        title={`${business.name} — 재고 · 평가`}
        code=""
        description="재공품 · 완제품 평가금액, 기초재고 연결, 원료 출고 구분. 차이는 보여 주기만 하고 고치지 않습니다."
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <BooksNav businessId={business_id} current="valuation" canImport={canKeep} />
        </div>
      </PageHeader>

      {canKeep && user ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-t11h">
            <form className="flex items-center gap-1" action="">
              <label className="text-ink-muted" htmlFor="month">달</label>
              <input id="month" name="month" type="month" defaultValue={month} className="rounded-md border border-line bg-panel px-2 py-1 text-t11h" />
              <button className="min-h-8 rounded-md border border-line px-2 text-ink-dim hover:border-accent">보기</button>
            </form>
            <Link href={`/finance/${business_id}/upload?month=${month}`} className="text-accent underline-offset-2 hover:underline">
              회계 · 재무 자료 올리기로
            </Link>
          </div>
          <RecloseBadges businessId={business_id} flags={reclose} canClear={canCloseBooks(user, business_id)} />
          <ValuationSection businessId={business_id} businessName={business.name} month={month} rows={valuations} warnings={warnings} viewerId={user.user_id} viewerName={user.name} />
          <RollSection businessId={business_id} month={month} rows={roll} />
          <IssueSection businessId={business_id} month={month} summary={issue} />
        </div>
      ) : (
        <p className="mt-4 rounded-md bg-panel px-3 py-2 text-t12 text-ink-dim">
          이 회사의 재무를 넣을 권한이 없습니다. (대표 · 그룹 CFO · 해당 회사 대표이사 · 대표가 재무 입력 권한을 준 사람)
        </p>
      )}
    </div>
  )
}
