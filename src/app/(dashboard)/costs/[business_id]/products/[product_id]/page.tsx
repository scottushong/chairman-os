import Link from 'next/link'
import { notFound } from 'next/navigation'

import { TrendChart } from '@/components/blueprint/trend-chart'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { BLUEPRINT_OFF, blueprintErrorKey, CARD_TITLE, cardText, kgText, pct1, won } from '@/lib/blueprint/format'
import { openBlueprint } from '@/lib/blueprint/page'
import { TREND_GRAIN_KO, TREND_GRAINS, trendRange } from '@/lib/blueprint/period'
import { ALERT, CHIP, TABLE_BOX, TD, TH } from '@/lib/blueprint/ui'
import { kstToday } from '@/lib/chairman-project'
import { costEngineError } from '@/lib/costs/errors'
import { featureOn } from '@/lib/features-server'
import type { ProductDiagnosis, ProductTrendGrain, ProductTrendPoint } from '@/types'

/**
 * ⑧ 제품 진단(0081 product_diagnosis · product_trend). 스위치 'product_diagnosis'(기본 대표만)가 꺼지면 404.
 * 문: 대표 · 원가 관리 줄 · 영업 줄(openBlueprint) — 카드는 DB가 역할마다 고른 것만 온다(대표 11 · 원가 관리 10 · 영업 4). 받은 카드만 그린다.
 * 자료가 없는 카드는 «자료 없음 · 필요한 것: …»(0을 쓰지 않는다). 추이 차트는 대표 · 원가 관리만(원가 관리의 Market은 오늘이 든 기간 하나).
 * 열 때마다 문 한 번(진단) + 차트 한 번(추이) — 영업 0시 · 하루 200건.
 */
export default async function ProductDiagnosisPage(props: PageProps<'/costs/[business_id]/products/[product_id]'>) {
  const { business_id, product_id } = await props.params
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const { repo, user, business } = await openBlueprint(business_id, ['costing', 'sales'])
  if (!(await featureOn(user, 'product_diagnosis', business_id))) notFound()
  const chairman = user.role === 'Chairman'
  const fail = (e: unknown, msg: string) => {
    const k = blueprintErrorKey(e)
    return k === 'off' ? BLUEPRINT_OFF : k === 'unavailable' ? '제품 진단은 준비 중입니다.' : costEngineError(e, chairman, msg)
  }

  let diag: ProductDiagnosis | null = null
  let error: string | null = null
  try {
    diag = await repo.productDiagnosis(product_id)
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (/cost_not_found/.test(m)) notFound()
    console.error('[product] product_diagnosis', m)
    error = fail(e, '제품 진단을 불러오지 못했습니다.')
  }
  const products = await repo.listCostProducts(business_id).catch(() => [])
  if (products.length && !products.some((p) => p.product_id === product_id)) notFound()
  await recordScreenRead({ path: `/costs/${business_id}/products/${product_id}`, kind: 'page', business_id })

  const showTrend = diag ? diag.role !== 'sales' : false
  const grain: ProductTrendGrain = (TREND_GRAINS as readonly string[]).includes(one(sp.grain) ?? '') ? (one(sp.grain) as ProductTrendGrain) : 'month'
  let trend: ProductTrendPoint[] = []
  let trendError: string | null = null
  if (showTrend) {
    const { from, to } = trendRange(grain, kstToday())
    try {
      trend = await repo.productTrend(product_id, grain, from, to)
    } catch (e) {
      console.error('[product] product_trend', e instanceof Error ? e.message : String(e))
      trendError = fail(e, '추이를 불러오지 못했습니다.')
    }
  }
  const name = diag?.product_name ?? products.find((p) => p.product_id === product_id)?.name ?? product_id
  const back = diag?.role === 'sales' ? `/sales/${business_id}` : `/costs/${business_id}`

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader
        icon="layers"
        title={`${name} 진단`}
        code="COST-D1"
        description={`${business.name} · ${diag ? `${diag.as_of} 기준` : ''} · 원/kg${chairman ? ' · 원래 값' : ' · 1원 단위'}`}
      />
      <p className="text-t12">
        <Link href={back} className="text-accent hover:underline">
          ← {diag?.role === 'sales' ? '영업 원가' : '원가 관리'}
        </Link>
      </p>
      {error ? (
        <p role="alert" className={ALERT}>
          {error}
        </p>
      ) : null}

      {diag ? (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="진단 카드">
          {diag.cards.map((c) => {
            const t = c.state === 'ok' ? cardText(c) : null
            return (
              <article key={c.id} className="rounded-xl border border-line-soft bg-panel p-3" data-card={c.key}>
                <h2 className="text-t12 font-semibold text-ink-dim">{CARD_TITLE[c.id] ?? c.key}</h2>
                {t ? (
                  <>
                    <p className="mt-1 text-t16 font-semibold tnum">{t.main}</p>
                    <ul className="mt-1 space-y-0.5 text-t11 text-ink-muted">
                      {t.sub.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-1 text-t13 text-ink-muted">자료 없음 · 필요한 것: {c.need ?? '—'}</p>
                )}
              </article>
            )
          })}
        </section>
      ) : null}

      {showTrend ? (
        <section className="space-y-3 rounded-xl border border-line-soft bg-panel p-3" aria-label="추이">
          <div className="flex flex-wrap items-center gap-1.5 text-t12">
            <h2 className="mr-2 text-t13 font-semibold">추이</h2>
            {TREND_GRAINS.map((g) => (
              <Link key={g} href={`/costs/${business_id}/products/${product_id}?grain=${g}`} className={CHIP(grain === g)} aria-current={grain === g ? 'page' : undefined}>
                {TREND_GRAIN_KO[g]}
              </Link>
            ))}
          </div>
          {trendError ? (
            <p role="alert" className={ALERT}>
              {trendError}
            </p>
          ) : (
            <>
              <TrendChart points={trend} />
              <div className={TABLE_BOX}>
                <table className="m-cards w-full text-t12 sm:min-w-[640px]">
                  <thead>
                    <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                      <th className={TH}>기간 시작</th>
                      <th className={`${TH} text-right`}>kg</th>
                      <th className={`${TH} text-right`}>판매가</th>
                      <th className={`${TH} text-right`}>Actual</th>
                      <th className={`${TH} text-right`}>Market 원료비</th>
                      <th className={`${TH} text-right`}>GM%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((p) => (
                      <tr key={p.period_start} className="border-t border-line-soft">
                        <td className={`${TD} tnum`} data-label="기간">
                          {p.period_start}
                        </td>
                        <td className={`${TD} text-right tnum`} data-label="kg">
                          {kgText(p.kg)}
                        </td>
                        <td className={`${TD} text-right tnum`} data-label="판매가">
                          {won(p.price_krw_per_kg)}
                        </td>
                        <td className={`${TD} text-right tnum`} data-label="Actual">
                          {won(p.actual_krw_per_kg)}
                        </td>
                        <td className={`${TD} text-right tnum`} data-label="Market">
                          {won(p.market_material_krw_per_kg)}
                        </td>
                        <td className={`${TD} text-right tnum`} data-label="GM%">
                          {pct1(p.gm_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-t10h text-ink-muted">
                판매가 = 그 기간 판매 kg 가중 · Actual = 그 기간 생산 LOT(투입 원료 LOT) · Market 원료비 = 기간 끝 날 시장가
                {chairman ? '' : '(원가 관리는 오늘이 든 기간만)'} · GM% = 원가를 계산한 판매만.
              </p>
            </>
          )}
        </section>
      ) : null}
    </div>
  )
}
