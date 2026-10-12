import { notFound } from 'next/navigation'

import { BooksNav } from '@/components/finance/books-nav'
import { MonthlyGrid } from '@/components/finance/monthly-grid'
import { MonthlyPlPanel } from '@/components/finance/monthly-pl-panel'
import { PageHeader } from '@/components/layout/page-header'
import { canCloseBooks, canImportEcount, canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { featureOn } from '@/lib/features-server'
import { plError } from '@/lib/monthly-pl/text'
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

  // 0075 «월별 손익 재고 반영»(기능 스위치 monthly_pl — 기본 대표만). 꺼져 있으면 이 화면은 예전 그대로다(아래 패널 없음).
  const plOn = await featureOn(user, 'monthly_pl', business_id)
  const pl = plOn ? await monthlyPl(repo, business_id, year, search.pl) : null

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="grid"
        title={`${business.name} — 월별 간이 손익`}
        code="CH-026"
        description={`${year}년 열두 달을 채우면 달마다 요약 전표가 잠정으로 들어갑니다. 공식 결산이 있는 달은 잠깁니다.`}
      >
        <BooksNav businessId={business_id} current="monthly" canImport={canImportEcount(user, business_id)} />
      </PageHeader>

      <div className="mt-4">
        <MonthlyGrid
          businessId={business_id}
          months={months}
          officials={periods}
          officialMemos={memos}
          preset={preset}
          canEdit={canKeepBooks(user, business_id)}
        />
      </div>

      {pl ? (
        <MonthlyPlPanel
          businessId={business_id}
          period={pl.period}
          year={year}
          view={pl.view}
          error={pl.error}
          years={pl.years}
          settings={pl.settings}
          canKeep={canKeepBooks(user, business_id)}
          canClose={canCloseBooks(user, business_id)}
          isTop={user?.role === 'Chairman' || user?.role === 'GroupCFO'}
        />
      ) : null}
    </div>
  )
}

/** 0075 패널이 읽는 것 — 고른 달(?pl=YYYY-MM, 없으면 그해의 지난달) · 열두 달 띠 · 설정. 읽기 실패는 문장으로(화면 전체를 깨지 않는다). */
async function monthlyPl(repo: Awaited<ReturnType<typeof getRepository>>, businessId: string, year: string, raw: string | string[] | undefined) {
  const asked = Array.isArray(raw) ? raw[0] : raw
  const today = kstToday().slice(0, 7)
  const last = today.startsWith(year) ? (today.endsWith('-01') ? `${year}-01` : `${year}-${String(Number(today.slice(5)) - 1).padStart(2, '0')}`) : `${year}-12`
  const period = typeof asked === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked.startsWith(year) ? asked : last
  try {
    const [view, years, settings] = await Promise.all([repo.finPlMonth(businessId, period), repo.finPlYear(businessId, year), repo.finPlSettings(businessId)])
    return { period, view, years, settings, error: view ? null : '이 기능의 DB가 아직 준비되지 않았습니다(0075 반영 전).' }
  } catch (e) {
    return { period, view: null, years: [], settings: null, error: plError(e) }
  }
}
