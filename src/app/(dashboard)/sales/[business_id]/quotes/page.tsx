import Link from 'next/link'

import { PageHeader } from '@/components/layout/page-header'
import { QuoteForm } from '@/components/sales/quote-form'
import { GradeBadge } from '@/components/sales/sales-cost-board'
import { recordScreenRead } from '@/lib/activity-record'
import { kstToday } from '@/lib/chairman-project'
import { krw } from '@/lib/sales/cost'
import { openSales } from '@/lib/sales/page'
import { QUOTE_STATUS_LABEL_KO, shownQuoteStatus, type Quote, type QuoteShownStatus } from '@/types'

const GRADES = ['green', 'yellow', 'red'] as const
const GRADE_LABEL: Record<(typeof GRADES)[number], string> = { green: 'Green', yellow: 'Yellow', red: 'Red' }

/**
 * 견적(0066) — 목록 · 새 견적. 보이는 견적은 DB가 고른다(본인 · 영업 팀장 subtree · 대표). 원가 스냅숏은 저장 순간 영업이 본 값.
 * Red(마진 15% 미만)는 상세에서 «대표 승인 요청» → 0059 결재(상사 사슬 → 대표) → 승인 뒤 확정.
 */
export default async function QuotesPage(props: PageProps<'/sales/[business_id]/quotes'>) {
  const { business_id } = await props.params
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const fStatus = one(sp.status) in QUOTE_STATUS_LABEL_KO ? (one(sp.status) as QuoteShownStatus) : null
  const fGrade = (GRADES as readonly string[]).includes(one(sp.grade)) ? (one(sp.grade) as (typeof GRADES)[number]) : null
  const { repo, user, business } = await openSales(business_id)
  await recordScreenRead({ path: `/sales/${business_id}/quotes`, kind: 'page', business_id })
  const today = kstToday()
  const canWrite = user.role === 'Chairman' || !!user.cost?.sales?.[business_id]?.write
  let quotes: Quote[] = []
  let products: { product_id: string; name: string }[] = []
  let error: string | null = null
  try {
    ;[quotes, products] = await Promise.all([
      repo.listQuotes(business_id),
      canWrite ? repo.listCostProducts(business_id).then((ps) => ps.filter((p) => p.active)) : Promise.resolve([]),
    ])
  } catch (e) {
    console.error('[quotes]', e instanceof Error ? e.message : String(e))
    error = '견적을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
  }

  const shownList = quotes.filter((q) => (!fStatus || shownQuoteStatus(q, today) === fStatus) && (!fGrade || q.grade === fGrade))
  const href = (s: string | null, g: string | null) => {
    const p = new URLSearchParams()
    if (s) p.set('status', s)
    if (g) p.set('grade', g)
    const qs = p.toString()
    return `/sales/${business_id}/quotes${qs ? `?${qs}` : ''}`
  }
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-1 ${on ? 'border-accent bg-accent/10 font-semibold text-ink' : 'border-line-soft text-ink-dim hover:border-accent'}`

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader
        icon="target"
        title={`${business.name} 견적`}
        code="COST-Q1"
        description="고객 · 제품 · kg · 제시가(원/kg) — 저장 순간 원가 · 마진 · 등급을 함께 남긴다. Red는 대표 승인 뒤 확정."
      />
      <p className="text-t12">
        <Link href={`/sales/${business_id}`} className="text-accent hover:underline">
          ← 영업 원가
        </Link>
      </p>
      {error ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-t12 text-critical">
          {error}
        </p>
      ) : null}
      {canWrite && products.length > 0 ? <QuoteForm businessId={business_id} products={products} today={today} /> : null}

      <nav className="flex flex-wrap items-center gap-1.5 text-t12" aria-label="견적 거르기">
        <span className="text-ink-muted">상태</span>
        <Link href={href(null, fGrade)} className={chip(!fStatus)}>
          전체
        </Link>
        {(Object.keys(QUOTE_STATUS_LABEL_KO) as QuoteShownStatus[]).map((s) => (
          <Link key={s} href={href(s, fGrade)} className={chip(fStatus === s)}>
            {QUOTE_STATUS_LABEL_KO[s]}
          </Link>
        ))}
        <span className="ml-2 text-ink-muted">등급</span>
        <Link href={href(fStatus, null)} className={chip(!fGrade)}>
          전체
        </Link>
        {GRADES.map((g) => (
          <Link key={g} href={href(fStatus, g)} className={chip(fGrade === g)}>
            {GRADE_LABEL[g]}
          </Link>
        ))}
        <span className="ml-auto text-ink-muted tnum">
          {shownList.length} / {quotes.length}건
        </span>
      </nav>
      <section className="overflow-x-auto rounded-xl border border-line-soft bg-panel max-sm:border-0 max-sm:bg-transparent" aria-label="견적 목록">
        <table className="m-cards w-full text-t12 sm:min-w-[900px]">
          <thead>
            <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
              <th className="px-3 py-2 font-normal">고객</th>
              <th className="px-3 py-2 font-normal">제품</th>
              <th className="px-3 py-2 text-right font-normal">kg</th>
              <th className="px-3 py-2 text-right font-normal">제시가(원/kg)</th>
              <th className="px-3 py-2 text-right font-normal">마진</th>
              <th className="px-3 py-2 font-normal">등급</th>
              <th className="px-3 py-2 font-normal">상태</th>
              <th className="px-3 py-2 font-normal">유효기간</th>
            </tr>
          </thead>
          <tbody>
            {shownList.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-ink-muted">
                  {quotes.length === 0 ? '아직 견적이 없습니다.' : '조건에 맞는 견적이 없습니다.'}
                </td>
              </tr>
            ) : (
              shownList.map((q) => {
                const s = shownQuoteStatus(q, today)
                return (
                  <tr key={q.quote_id} className="border-t border-line-soft">
                    <td className="px-3 py-2" data-label="고객">
                      <Link href={`/sales/${business_id}/quotes/${q.quote_id}`} className="font-semibold text-accent hover:underline">
                        {q.customer_company}
                      </Link>
                      <span className="ml-1 text-ink-muted">
                        {q.customer_name} · {q.version}판
                      </span>
                    </td>
                    <td className="px-3 py-2" data-label="제품">
                      {q.product_name}
                    </td>
                    <td className="px-3 py-2 text-right tnum" data-label="kg">
                      {q.kg.toLocaleString('ko-KR')}
                    </td>
                    <td className="px-3 py-2 text-right tnum" data-label="제시가">
                      {krw(q.price_krw_per_kg)}
                    </td>
                    <td className="px-3 py-2 text-right tnum" data-label="마진">
                      {q.margin_pct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2" data-label="등급">
                      <GradeBadge grade={q.grade} />
                    </td>
                    <td className="px-3 py-2" data-label="상태">
                      {QUOTE_STATUS_LABEL_KO[s]}
                    </td>
                    <td className="px-3 py-2 tnum" data-label="유효기간">
                      {q.valid_until}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
