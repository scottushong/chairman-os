import { notFound } from 'next/navigation'

import { BooksNav } from '@/components/finance/books-nav'
import { MonthlyGrid } from '@/components/finance/monthly-grid'
import { PageHeader } from '@/components/layout/page-header'
import { canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { ECOUNT_CODE_BUSINESSES } from '@/lib/ledger/standard-chart'
import { getRepository } from '@/lib/repository'
import type { OfficialPeriod } from '@/lib/statements/period'

/**
 * 월별 간이 손익 (Phase 2-C 블록 2).
 *
 * 한 해 열두 달을 스프레드시트처럼 채우고, 달마다 요약 전표를 장부에 넣는다.
 * 원천은 여전히 장부다 — 이 화면은 편한 입구지 다른 원천이 아니다.
 */
export default async function MonthlyPage(props: PageProps<'/finance/[business_id]/monthly'>) {
  const { business_id } = await props.params
  const search = await props.searchParams
  const repo = await getRepository()
  const [businesses, user, officials] = await Promise.all([
    repo.listBusinesses(),
    currentUser(),
    repo.listOfficialStatements(business_id),
  ])

  const business = businesses.find((b) => b.business_id === business_id)
  if (!business) notFound()

  // 연도는 ?year=로 받는다. 없으면 올해다 — 회장이 가장 자주 채우는 해가 올해다.
  const raw = Array.isArray(search.year) ? search.year[0] : search.year
  const year = typeof raw === 'string' && /^\d{4}$/.test(raw) ? raw : kstToday().slice(0, 4)
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

  const periods: OfficialPeriod[] = officials.map((o) => ({ kind: o.period_kind, key: o.period_key }))
  const memos = Object.fromEntries(officials.map((o) => [`${o.period_kind}:${o.period_key}`, o.memo]))

  // DY는 ECOUNT 코드 체계라 간이 항목의 표준 계정이 없다. 제조 기본 항목을 그대로 쓰되
  // 계정이 없으면 저장이 DB에서 막힌다 — 그 전에 화면이 먼저 말해 준다.
  const preset = ECOUNT_CODE_BUSINESSES.includes(business_id) ? 'manufacturing' : 'startup'

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-5">
      <PageHeader
        icon="grid"
        title={`${business.name} — 월별 간이 손익`}
        code="CH-026"
        description={`${year}년 열두 달을 채우면 달마다 요약 전표가 잠정으로 들어갑니다. 공식 결산이 있는 달은 잠깁니다.`}
      >
        <BooksNav businessId={business_id} current="monthly" />
      </PageHeader>

      <div className="mt-4">
        <MonthlyGrid
          businessId={business_id}
          months={months}
          officials={periods}
          officialMemos={memos}
          preset={preset}
          canEdit={canKeepBooks(user)}
        />
      </div>
    </div>
  )
}
