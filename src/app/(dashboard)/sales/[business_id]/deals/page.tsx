import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { kstToday } from '@/lib/chairman-project'
import { featureOn } from '@/lib/features-server'
import { krw } from '@/lib/sales/cost'
import { marginRange, SALE_GRADE_KO } from '@/lib/sales/margins'
import { openSales } from '@/lib/sales/page'
import type { SaleDeal, SaleGrade } from '@/types'

const GRADE_CLASS: Record<SaleGrade, string> = {
  green: 'border-ok/40 bg-ok/10 text-ok',
  yellow: 'border-warn/40 bg-warn/10 text-warn',
  red: 'border-critical/40 bg-critical/10 text-critical',
  too_low: 'border-critical/40 bg-critical/10 text-critical',
  unknown: 'border-line-soft text-ink-muted',
}

/**
 * PHASE 5 판매 실적(0077 sales_deals) — 영업 본인 · 영업 팀장(팀) · 대표. 보이는 줄은 DB(0067 sale_visible)가 고른다.
 * **판매가 · kg · 매출(kg × 판매가) · 등급(기록 순간 0시 기준)만** — 실제 원가 · 실제 마진은 이 화면 · 이 RPC에 없다(check:sales-cost ⑤ 정적 검사).
 * 스위치 'sales_margins'(기본 대표만)가 꺼지면 404(존재를 숨긴다). RPC도 같은 스위치를 본다(feature_off).
 */
export default async function SaleDealsPage(props: PageProps<'/sales/[business_id]/deals'>) {
  const { business_id } = await props.params
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const { repo, user, business } = await openSales(business_id)
  if (!(await featureOn(user, 'sales_margins', business_id))) notFound()
  await recordScreenRead({ path: `/sales/${business_id}/deals`, kind: 'page', business_id })
  const { from, to } = marginRange(one(sp.from), one(sp.to), kstToday())

  let deals: SaleDeal[] = []
  let error: string | null = null
  try {
    deals = await repo.listSaleDeals(business_id, from, to)
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    console.error('[sales deals]', m)
    error = /feature_off/.test(m) ? '지금은 쓸 수 없는 화면입니다.' : /sales_margins_unavailable/.test(m) ? '판매 실적은 준비 중입니다.' : '판매 실적을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
  }
  const totalKg = deals.reduce((t, d) => t + d.kg, 0)
  const totalRevenue = deals.reduce((t, d) => t + d.revenue_krw, 0)

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader
        icon="target"
        title={`${business.name} 판매 실적`}
        code="COST-S2"
        description="출고 · 고객 · 제품 · kg · 판매가(원/kg) · 등급(기록한 날 0시 기준). 본인 실적 · 팀장은 팀 실적."
      />
      <p className="text-t12">
        <Link href={`/sales/${business_id}`} className="text-accent hover:underline">
          ← 영업 원가
        </Link>
      </p>
      <form className="flex flex-wrap items-end gap-2 text-t12" method="get">
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">출고일 시작</span>
          <input type="date" name="from" defaultValue={from} className="rounded-md border border-line bg-panel px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">끝</span>
          <input type="date" name="to" defaultValue={to} className="rounded-md border border-line bg-panel px-2 py-1" />
        </label>
        <button type="submit" className="min-h-11 rounded-md border border-line bg-panel px-3 hover:border-accent lg:min-h-0 lg:py-1">
          보기
        </button>
        <span className="ml-auto text-ink-muted tnum">
          {deals.length}건 · {totalKg.toLocaleString('ko-KR')}kg · 매출 {krw(totalRevenue)}원
        </span>
      </form>
      {error ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-t12 text-critical">
          {error}
        </p>
      ) : null}
      <section className="overflow-x-auto rounded-xl border border-line-soft bg-panel max-sm:border-0 max-sm:bg-transparent" aria-label="판매 실적 목록">
        <table className="m-cards w-full text-t12 sm:min-w-[900px]">
          <thead>
            <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
              <th className="px-3 py-2 font-normal">출고일</th>
              <th className="px-3 py-2 font-normal">고객</th>
              <th className="px-3 py-2 font-normal">제품</th>
              <th className="px-3 py-2 text-right font-normal">kg</th>
              <th className="px-3 py-2 text-right font-normal">판매가(원/kg)</th>
              <th className="px-3 py-2 text-right font-normal">매출(원)</th>
              <th className="px-3 py-2 font-normal">등급(0시 기준)</th>
              <th className="px-3 py-2 font-normal">구분</th>
            </tr>
          </thead>
          <tbody>
            {deals.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-ink-muted">
                  이 기간에 보이는 판매 실적이 없습니다.
                </td>
              </tr>
            ) : (
              deals.map((d) => (
                <tr key={d.sale_id} className="border-t border-line-soft">
                  <td className="px-3 py-2 tnum" data-label="출고일">
                    {d.shipped_on}
                  </td>
                  <td className="px-3 py-2" data-label="고객">
                    <span className="font-semibold">{d.customer_company}</span>
                    <span className="ml-1 text-ink-muted">{d.customer_name}</span>
                  </td>
                  <td className="px-3 py-2" data-label="제품">
                    {d.product_name}
                    {d.quote_id ? <span className="ml-1 text-ink-muted">· 견적 연결</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tnum" data-label="kg">
                    {d.kg.toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-2 text-right tnum" data-label="판매가">
                    {krw(d.price_krw_per_kg)}
                    {d.currency !== 'KRW' ? <span className="ml-1 text-ink-muted">({d.currency})</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tnum" data-label="매출">
                    {krw(d.revenue_krw)}
                  </td>
                  <td className="px-3 py-2" data-label="등급">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-t11h font-semibold ${GRADE_CLASS[d.grade]}`}>{SALE_GRADE_KO[d.grade]}</span>
                    <span className="ml-1 text-ink-muted tnum">{d.grade_as_of}</span>
                  </td>
                  <td className="px-3 py-2" data-label="구분">
                    {d.mine ? '본인' : '팀'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
      <p className="text-t11 text-ink-muted">등급은 판매를 기록한 날 0시 기준 원가로 정한 값이고 실제 원가가 아닙니다. 실제 원가 · 실제 마진은 이 화면에 없습니다.</p>
    </div>
  )
}
