import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BooksNav } from '@/components/finance/books-nav'
import { JournalForm } from '@/components/finance/journal-form'
import { MonthSelect } from '@/components/finance/month-select'
import { SlipList } from '@/components/finance/slip-list'
import { PageHeader } from '@/components/layout/page-header'
import { canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { periodOfDate } from '@/lib/ledger/basis'
import {
  correctionProblem,
  isPeriodLocked,
  journalPeriods,
  lastClosedPeriod,
  slipsOf,
  todayKst,
} from '@/lib/ledger/journal'
import { firstParam, withParams } from '@/lib/query'
import { getRepository } from '@/lib/repository'

/**
 * 전표 (Phase 2-B 블록 2, 0016). 월별 전표 목록 + 입력 폼.
 *
 * 조회 월은 URL에 있다(?month=). 기본은 오늘이 속한 달이다 — 전표를 넣는 달이 대개 이번 달이다.
 * 입력 폼의 기본 일자는 조회 월이 열려 있으면 그 달(이번 달이면 오늘, 지난달이면 말일), 잠겼으면 오늘이다.
 *
 * 정정(블록 4): 자체 장부 전표 옆 '정정'을 누르면 ?correct=전표번호로 같은 화면이 정정 모드 폼을 연다.
 * 정정 일자 기본값은 오늘 — 당월에 역분개·정정분개가 들어간다.
 */
export default async function JournalPage(props: PageProps<'/finance/[business_id]/journal'>) {
  const { business_id } = await props.params
  const params = await props.searchParams
  const repo = await getRepository()
  const [businesses, ledger, user] = await Promise.all([repo.listBusinesses(), repo.loadFinanceLedger(), currentUser()])

  const business = businesses.find((b) => b.business_id === business_id)
  if (!business) notFound()

  const today = todayKst()
  const periods = journalPeriods(ledger, business_id, today)
  const requested = firstParam(params.month)
  const period = requested && periods.includes(requested) ? requested : today.slice(0, 7)
  const locked = isPeriodLocked(ledger, business_id, period)
  const slips = slipsOf(ledger, business_id, period)
  const bookkeeper = canKeepBooks(user)

  // 정정 모드. 정정할 수 없는 전표(역분개·이미 정정됨·ECOUNT)면 폼을 열지 않는다 — 목록에 버튼도 없다.
  const correctId = firstParam(params.correct)
  const correctEntry =
    bookkeeper && correctId && correctionProblem(ledger, business_id, correctId, today) === null
      ? ledger.entries.find((e) => e.business_id === business_id && e.slip_no === correctId)
      : undefined

  const basePath = `/finance/${encodeURIComponent(business_id)}/journal`
  const accounts = ledger.accounts.filter((a) => a.business_id === business_id)
  const lastDay = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10)
  const defaultDate = locked || period === today.slice(0, 7) ? today : lastDay
  const monthHref = (p: string) => withParams(basePath, { month: p === today.slice(0, 7) ? undefined : p })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="clipboard"
        title={`${business.name} 전표`}
        code="CH-052"
        description="차변 합과 대변 합이 같아야 저장됩니다. 마감된 달은 고치지 않고 당월에 정정 전표로 바로잡습니다."
      >
        <BooksNav businessId={business_id} current="journal" />
        <Link
          href="/finance"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          그룹 재무
        </Link>
      </PageHeader>

      <div className="mt-4 space-y-3.5">
        {bookkeeper ? (
          <JournalForm
            key={correctEntry?.slip_no ?? 'new'}
            correcting={
              correctEntry
                ? {
                    slip_no: correctEntry.slip_no,
                    entry_date: correctEntry.entry_date,
                    memo: correctEntry.memo,
                    evidence_url: correctEntry.evidence_url,
                    lines: ledger.journal
                      .filter((j) => j.business_id === business_id && j.slip_no === correctEntry.slip_no)
                      .sort((a, b) => a.line_no - b.line_no)
                      .map((j) => ({ account_code: j.account_code, side: j.side, amount: j.amount })),
                    doneHref: monthHref(periodOfDate(today)),
                  }
                : undefined
            }
            businessId={business_id}
            accounts={accounts
              .filter((a) => a.active)
              .sort((a, b) => a.account_code.localeCompare(b.account_code))
              .map((a) => ({ account_code: a.account_code, name: a.name, section: a.section }))}
            lockedThrough={lastClosedPeriod(ledger, business_id)}
            defaultDate={correctEntry ? today : defaultDate}
          />
        ) : null}

        <section className="rounded-xl border border-line-soft bg-panel p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft pb-2">
            <p className="text-[12px]">
              <span className="font-semibold">{period.replace('-', '년 ')}월</span>{' '}
              <span className="text-ink-muted">
                · 전표 <span className="tnum">{slips.length}</span>장 · {locked ? '마감됨 (확정)' : '마감 전 (잠정)'}
              </span>
            </p>
            <MonthSelect
              value={period}
              periods={periods.map((p) => ({ period: p, label: `${p.replace('-', '년 ')}월${p === today.slice(0, 7) ? ' (이번 달)' : ''}` }))}
              hrefFor={Object.fromEntries(periods.map((p) => [p, monthHref(p)]))}
            />
          </div>
          <SlipList
            slips={slips}
            accounts={new Map(accounts.map((a) => [a.account_code, a]))}
            actions={(s) =>
              bookkeeper && s.own && s.correction?.kind !== 'reversal' && s.corrected_by.length === 0 ? (
                <Link
                  href={withParams(basePath, { month: period === today.slice(0, 7) ? undefined : period, correct: s.slip_no })}
                  className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
                >
                  정정
                </Link>
              ) : null
            }
          />
        </section>
      </div>
    </div>
  )
}
