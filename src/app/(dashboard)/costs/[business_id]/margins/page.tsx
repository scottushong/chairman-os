import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { kstToday } from '@/lib/chairman-project'
import { costEngineError } from '@/lib/costs/errors'
import { openCosts } from '@/lib/costs/page'
import { featureOn } from '@/lib/features-server'
import { krw } from '@/lib/sales/cost'
import { BY_KO, COST_BASIS_KO, COST_BASIS_NOTE, costSourceKo, GRAIN_KO, MARGIN_BYS, MARGIN_GRAINS, MARGIN_ROW_LIMIT, marginRange } from '@/lib/sales/margins'
import type { MarginBy, MarginGrain, SalesMarginRow } from '@/types'

/**
 * PHASE 5 견적 마진 vs 실제 마진(0077 sales_margins → 0067 cost_margins). 대표(원래 값) · 원가 관리(1원)만 — openCosts가 404로 거른다.
 * 화면을 열 때마다 RPC 한 번 = 문 한 건(하루 20번 · 호출마다 감사 · 겸직 거부 — 0067 cost_gate_biz). 합산은 원래 값끼리 더한 뒤 1원.
 * 줄마다 그 묶음의 달이 «월 마감 확정 달»(0075 내부 마감 확정 · 열린 재마감 표시 없음)인지 «월 마감 전»인지 적는다(원가 기준이 아니라 월 마감 상태).
 * 판매 한 줄 원가가 출고일 Current면 «잠정 대체원가»(costSourceKo).
 * 내려받기는 없다(원가 엔진 빼기 금지 — 대표 예외는 0067 cost_margins_download_log, 이 화면은 붙이지 않음).
 * 스위치 'sales_margins'(기본 대표만)가 꺼지면 404. RPC도 같은 스위치를 본다.
 */
export default async function MarginsPage(props: PageProps<'/costs/[business_id]/margins'>) {
  const { business_id } = await props.params
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const { repo, user, business } = await openCosts(business_id)
  if (!(await featureOn(user, 'sales_margins', business_id))) notFound()
  await recordScreenRead({ path: `/costs/${business_id}/margins`, kind: 'page', business_id })
  const chairman = user.role === 'Chairman'
  const { from, to } = marginRange(one(sp.from), one(sp.to), kstToday())
  const grain: MarginGrain = (MARGIN_GRAINS as readonly string[]).includes(one(sp.grain) ?? '') ? (one(sp.grain) as MarginGrain) : 'month'
  const by: MarginBy = (MARGIN_BYS as readonly string[]).includes(one(sp.by) ?? '') ? (one(sp.by) as MarginBy) : 'product'

  let rows: SalesMarginRow[] = []
  let error: string | null = null
  try {
    rows = await repo.salesMargins(business_id, from, to, grain, by)
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    console.error('[margins] sales_margins', m)
    error = /feature_off/.test(m) ? '지금은 쓸 수 없는 화면입니다.' : /sales_margins_unavailable/.test(m) ? '마진 화면은 준비 중입니다.' : costEngineError(e, chairman, '마진을 불러오지 못했습니다.')
  }
  const truncated = rows.length >= MARGIN_ROW_LIMIT
  const uncomputed = rows.reduce((t, r) => t + r.n_uncomputed, 0)
  const href = (g: MarginGrain, b: MarginBy) => `/costs/${business_id}/margins?${new URLSearchParams({ from, to, grain: g, by: b }).toString()}`
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 ${on ? 'border-accent bg-accent/10 font-semibold text-ink' : 'border-line-soft text-ink-dim hover:border-accent'}`
  const won = (n: number | null) => (n === null ? '—' : krw(n))
  const pct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}%`)

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader
        icon="layers"
        title={`${business.name} 견적 마진 vs 실제 마진`}
        code="COST-M1"
        description={`${chairman ? '원래 값' : '1원 단위'} · 원래 값끼리 더한 뒤 반올림 · 화면을 열 때마다 기록(원가 관리는 하루 20번)`}
      />
      <p className="text-t12">
        <Link href={`/costs/${business_id}`} className="text-accent hover:underline">
          ← 원가 관리
        </Link>
      </p>
      <form className="flex flex-wrap items-end gap-2 text-t12" method="get">
        <input type="hidden" name="grain" value={grain} />
        <input type="hidden" name="by" value={by} />
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
      </form>
      <nav className="flex flex-wrap items-center gap-1.5 text-t12" aria-label="묶음">
        <span className="text-ink-muted">기간</span>
        {MARGIN_GRAINS.map((g) => (
          <Link key={g} href={href(g, by)} className={chip(grain === g && by !== 'deal')}>
            {GRAIN_KO[g]}
          </Link>
        ))}
        <span className="ml-2 text-ink-muted">묶음</span>
        {MARGIN_BYS.map((b) => (
          <Link key={b} href={href(grain, b)} className={chip(by === b)}>
            {BY_KO[b]}
          </Link>
        ))}
      </nav>
      {error ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-t12 text-critical">
          {error}
        </p>
      ) : null}
      {truncated ? (
        <p role="status" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-t12">
          {MARGIN_ROW_LIMIT.toLocaleString('ko-KR')}줄에서 잘렸을 수 있습니다 — 기간을 줄이거나 더 큰 묶음으로 보세요.
        </p>
      ) : null}
      {uncomputed > 0 ? (
        <p role="status" className="text-t12 text-ink-muted">
          실제 원가를 계산하지 못한 판매 {uncomputed}건 — 매출에는 들어가고 원가 · 마진 합계에서는 빠집니다.
        </p>
      ) : null}
      <section className="overflow-x-auto rounded-xl border border-line-soft bg-panel max-sm:border-0 max-sm:bg-transparent" aria-label="마진 표">
        <table className="m-cards w-full text-t12 sm:min-w-[1100px]">
          <thead>
            <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
              <th className="px-3 py-2 font-normal">{by === 'deal' ? '출고일' : '기간 시작'}</th>
              <th className="px-3 py-2 font-normal">{BY_KO[by]}</th>
              <th className="px-3 py-2 text-right font-normal">건 · kg</th>
              <th className="px-3 py-2 text-right font-normal">매출(원)</th>
              <th className="px-3 py-2 text-right font-normal">실제 원가(원)</th>
              <th className="px-3 py-2 text-right font-normal">실제 마진</th>
              <th className="px-3 py-2 text-right font-normal">견적 마진</th>
              <th className="px-3 py-2 font-normal">월 마감</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-ink-muted">
                  이 기간에 판매 실적이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.period_start}|${r.key}`} className="border-t border-line-soft">
                  <td className="px-3 py-2 tnum" data-label="기간">
                    {r.period_start}
                  </td>
                  <td className="px-3 py-2" data-label="이름">
                    {r.label}
                    {by === 'deal' ? <span className="block text-t11 text-ink-muted">{costSourceKo(r.cost_source, r.cost_krw_per_kg)}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tnum" data-label="건 · kg">
                    {r.n_sales}건 · {r.kg.toLocaleString('ko-KR')}kg
                    {r.n_uncomputed > 0 ? <span className="block text-t11 text-ink-muted">원가 없음 {r.n_uncomputed}건</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tnum" data-label="매출">
                    {won(r.revenue_krw)}
                  </td>
                  <td className="px-3 py-2 text-right tnum" data-label="실제 원가">
                    {won(r.cost_krw)}
                  </td>
                  <td className="px-3 py-2 text-right tnum" data-label="실제 마진">
                    {won(r.margin_krw)} <span className="text-ink-muted">({pct(r.margin_pct)})</span>
                  </td>
                  <td className="px-3 py-2 text-right tnum" data-label="견적 마진">
                    {r.quote_kg === null ? '견적 없음' : (
                      <>
                        {won(r.quote_margin_krw)} <span className="text-ink-muted">({pct(r.quote_margin_pct)})</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2" data-label="월 마감" title={COST_BASIS_NOTE[r.cost_basis]}>
                    <span className={r.cost_basis === 'closed_month' ? 'font-semibold text-ok' : 'text-warn'}>{COST_BASIS_KO[r.cost_basis]}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
      <ul className="list-disc space-y-1 pl-5 text-t11 text-ink-muted">
        <li>
          {COST_BASIS_KO.provisional}: {COST_BASIS_NOTE.provisional}.
        </li>
        <li>
          {COST_BASIS_KO.closed_month}: {COST_BASIS_NOTE.closed_month}.
        </li>
        <li>견적 마진은 견적이 이어진 판매만(그 판매 kg × (견적 제시가 − 견적 순간 총원가)).</li>
      </ul>
    </div>
  )
}
