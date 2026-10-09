import Link from 'next/link'

import { PageHeader } from '@/components/layout/page-header'
import { PriceTrend, type MaterialSeries } from '@/components/purchasing/price-trend'
import { PurchasingNav } from '@/components/purchasing/purchasing-nav'
import { kstToday } from '@/lib/chairman-project'
import { dailyMarket, dailyPurchase, materialOverview, pctText, won, type MaterialOverview } from '@/lib/purchasing/calc'
import { openPurchasing } from '@/lib/purchasing/page'
import { MATERIAL_CATEGORY_LABEL_KO } from '@/types'

/**
 * 구매 개요(설계서 13절) — 원료별: 최근 시장가 · 최근 구매가(landed) · 시장가 대비 % · 공급처별 평균단가 · 추이(일 / 주 / 월).
 *
 * 숫자는 전부 일 단위 원자료(시장가 · LOT)에서 여기서 계산한다 — 주 · 월은 저장하지 않는다(설계서 9).
 * «시장가 대비 %» 둘: ① 최근 LOT landed vs 그 LOT 입고일의 시장가 ② 30일 수량 가중 landed vs 최신 시장가.
 */
export default async function PurchasingOverviewPage(props: PageProps<'/purchasing/[business_id]'>) {
  const { business_id } = await props.params
  const { repo, business } = await openPurchasing(business_id)
  const today = kstToday()
  const [materials, suppliers, prices, lots] = await Promise.all([
    repo.listCostMaterials(business_id),
    repo.listCostSuppliers(business_id),
    repo.listMarketPrices(business_id, 400),
    repo.listPurchaseLots(business_id),
  ])
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
    </div>
  )
}
