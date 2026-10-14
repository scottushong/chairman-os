import Link from 'next/link'

import { PurchasePerformance } from '@/components/blueprint/purchase-performance'
import { CostingWatchCard } from '@/components/cost/costing-watch-card'
import { PageHeader } from '@/components/layout/page-header'
import { PriceTrend, type MaterialSeries } from '@/components/purchasing/price-trend'
import { PurchasingNav } from '@/components/purchasing/purchasing-nav'
import { kstToday } from '@/lib/chairman-project'
import { dailyMarket, dailyPurchase, materialOverview, pctText, won, type MaterialOverview } from '@/lib/purchasing/calc'
import { recordScreenRead } from '@/lib/activity-record'
import { lastDays, pickRange } from '@/lib/blueprint/period'
import { CHIP, FIELD, LABEL } from '@/lib/blueprint/ui'
import { featureOn } from '@/lib/features-server'
import { openPurchasing } from '@/lib/purchasing/page'
import { MATERIAL_CATEGORY_LABEL_KO } from '@/types'

/**
 * 구매 개요(설계서 13절) — 원료별: 최근 시장가 · 최근 구매가(landed) · 시장가 대비 % · 공급처별 평균단가 · 추이(일 / 주 / 월).
 *
 * 숫자는 전부 일 단위 원자료(시장가 · LOT)에서 여기서 계산한다 — 주 · 월은 저장하지 않는다(설계서 9).
 * «시장가 대비 %» 둘: ① 최근 LOT landed vs 그 LOT 입고일의 시장가 ② 30일 수량 가중 landed vs 최신 시장가.
 * 0081 ② «구매 성과»(?tab=performance · 스위치 purchase_performance)는 같은 문 안의 다른 보기 — 꺼지면 탭이 없고 개요로 돌아간다.
 */
export default async function PurchasingOverviewPage(props: PageProps<'/purchasing/[business_id]'>) {
  const { business_id } = await props.params
  const { repo, user, business } = await openPurchasing(business_id)
  // 구매 화면 열람은 0031 열람 기록으로 남는다 — 대표의 «원가 관리 권한자» 감시(0061 cost_costing_watch)가 센다. 404 뒤에 둔다.
  await recordScreenRead({ path: `/purchasing/${business_id}`, kind: 'page', business_id })
  const today = kstToday()
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const perfOn = await featureOn(user, 'purchase_performance', business_id)
  const tabs = perfOn ? (
    <nav className="mt-3 flex flex-wrap gap-1.5 text-t12" aria-label="구매 보기">
      <Link href={`/purchasing/${encodeURIComponent(business_id)}`} className={CHIP(one(sp.tab) !== 'performance')}>
        개요
      </Link>
      <Link href={`/purchasing/${encodeURIComponent(business_id)}?tab=performance`} className={CHIP(one(sp.tab) === 'performance')}>
        구매 성과
      </Link>
    </nav>
  ) : null
  if (perfOn && one(sp.tab) === 'performance') {
    const { from, to } = pickRange(one(sp.from), one(sp.to), lastDays(today, 180))
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
        <PageHeader icon="cart" title={`${business.name} 구매 성과`} code="COST-P6" description="구매가(물건값) vs 그날 시장가 · 절감액 · 환율 효과">
          <PurchasingNav businessId={business_id} current="overview" />
        </PageHeader>
        {tabs}
        <form className="mt-3 flex flex-wrap items-end gap-2 text-t12" method="get">
          <input type="hidden" name="tab" value="performance" />
          <label className={LABEL}>
            입고일 시작
            <input type="date" name="from" defaultValue={from} className={FIELD} />
          </label>
          <label className={LABEL}>
            끝
            <input type="date" name="to" defaultValue={to} className={FIELD} />
          </label>
          <button type="submit" className="min-h-11 rounded-md border border-line bg-panel px-3 hover:border-accent lg:min-h-0 lg:py-1">
            보기
          </button>
        </form>
        <PurchasePerformance repo={repo} businessId={business_id} from={from} to={to} showMaterial chairman={user.role === 'Chairman'} />
      </div>
    )
  }
  const [materials, suppliers, prices, lots] = await Promise.all([
    repo.listCostMaterials(business_id),
    repo.listCostSuppliers(business_id),
    repo.listMarketPrices(business_id, 400),
    repo.listPurchaseLots(business_id),
  ])
  // 대표에게만 — 원가 관리 권한자 감시(0061 cost_costing_watch). 대표 외는 부르지도 않는다(DB도 cost_not_found).
  const watch =
    user.role === 'Chairman'
      ? await repo.costingWatch(business_id).then(
          (rows) => ({ rows, error: null }),
          (e: unknown) => {
            console.error('[purchasing] cost_costing_watch', e instanceof Error ? e.message : String(e))
            return { rows: [], error: '원가 관리 권한자를 불러오지 못했습니다.' }
          },
        )
      : null
  const sName = new Map(suppliers.map((s) => [s.supplier_id, s.name]))
  const active = materials.filter((m) => m.active)
  const overview = new Map<string, MaterialOverview>(active.map((m) => [m.material_id, materialOverview(m.material_id, prices, lots, today)]))
  const series: MaterialSeries[] = active.map((m) => ({
    material_id: m.material_id,
    name: m.name,
    market: dailyMarket(prices, m.material_id),
    purchase: dailyPurchase(lots, m.material_id),
  }))

  const pctClass = (p: number | null) => (p === null ? 'text-ink-muted' : p > 5 ? 'text-critical' : p < -5 ? 'text-ok' : 'text-ink')

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="cart"
        title={`${business.name} 구매`}
        code="COST-P1"
        description={`원료 ${active.length}개 · 오늘 ${today} 기준 · 금액은 원/kg(Landed = 물품가 + 운송 · 관세 · 부대비)`}
      >
        <PurchasingNav businessId={business_id} current="overview" />
      </PageHeader>
      {tabs}

      {active.length === 0 ? (
        <section className="mt-4 rounded-xl border border-line-soft bg-panel px-4 py-10 text-center">
          <p className="text-t13 text-ink-dim">원료가 아직 없습니다.</p>
          <Link href={`/purchasing/${encodeURIComponent(business_id)}/materials`} className="mt-2 inline-block text-t12 text-ink-dim underline underline-offset-2">
            원료 넣으러 가기
          </Link>
        </section>
      ) : (
        <div className="mt-4 space-y-3">
          <section className="overflow-x-auto rounded-xl border border-line-soft bg-panel max-sm:border-0 max-sm:bg-transparent" aria-label="원료별 가격">
            <table className="m-cards w-full text-t12 sm:min-w-[1080px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                  <th className="px-3 py-2 font-normal">원료</th>
                  <th className="px-3 py-2 text-right font-normal">최근 시장가</th>
                  <th className="px-3 py-2 text-right font-normal">최근 구매가 (Landed)</th>
                  <th className="px-3 py-2 text-right font-normal">시장가 대비 · 최근 LOT</th>
                  <th className="px-3 py-2 text-right font-normal">30일 가중평균</th>
                  <th className="px-3 py-2 text-right font-normal">시장가 대비 · 30일</th>
                  <th className="px-3 py-2 font-normal">공급처별 평균단가 (수량 가중)</th>
                </tr>
              </thead>
              <tbody>
                {active.map((m) => {
                  const o = overview.get(m.material_id)!
                  return (
                    <tr key={m.material_id} className="border-t border-line-soft align-top">
                      <td className="px-3 py-2 max-sm:font-semibold">
                        <span>
                          {m.name}
                          <span className="block text-t10h font-normal text-ink-muted">{MATERIAL_CATEGORY_LABEL_KO[m.category]}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tnum" data-label="최근 시장가">
                        <span>
                          {o.latestMarket ? `${won(o.latestMarket.value)}원` : '—'}
                          {o.latestMarket ? <span className="block text-t10h text-ink-muted">{o.latestMarket.date}</span> : null}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tnum" data-label="최근 구매가">
                        <span>
                          {o.latestLot ? `${won(o.latestLot.landed)}원` : '—'}
                          {o.latestLot ? (
                            <span className="block text-t10h text-ink-muted">
                              {o.latestLot.date} · {sName.get(o.latestLot.supplier_id) ?? ''}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right tnum font-semibold ${pctClass(o.latestLotVsMarketPct)}`} data-label="대비 · 최근 LOT">
                        {pctText(o.latestLotVsMarketPct)}
                      </td>
                      <td className="px-3 py-2 text-right tnum" data-label="30일 가중평균">
                        <span>
                          {o.avg30 ? `${won(o.avg30.value)}원` : '—'}
                          {o.avg30 ? (
                            <span className="block text-t10h text-ink-muted">
                              {o.avg30.lots}건 · {Math.round(o.avg30.kg).toLocaleString('ko-KR')}kg
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right tnum font-semibold ${pctClass(o.avg30VsMarketPct)}`} data-label="대비 · 30일">
                        {pctText(o.avg30VsMarketPct)}
                      </td>
                      <td className="px-3 py-2" data-label="공급처별">
                        {o.bySupplier.length === 0 ? (
                          <span className="text-ink-muted">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {o.bySupplier.map((s) => (
                              <li key={s.supplier_id} className="flex justify-between gap-3 text-t11">
                                <span className="text-ink-dim">{sName.get(s.supplier_id) ?? s.supplier_id}</span>
                                <span className="tnum">
                                  {won(s.value)}원 <span className="text-ink-muted">· {s.lots}건</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
          <p className="text-t10h text-ink-dim">
            시장가 대비 % = (구매가 ÷ 시장가 − 1). 최근 LOT는 그 LOT 입고일의 시장가와, 30일 평균은 최신 시장가와 견줍니다. +5% 넘으면 빨강, −5% 밑이면 초록.
          </p>
          <PriceTrend series={series} />
        </div>
      )}
      {watch ? (
        <div className="mt-3">
          <CostingWatchCard rows={watch.rows} error={watch.error} />
        </div>
      ) : null}
    </div>
  )
}
