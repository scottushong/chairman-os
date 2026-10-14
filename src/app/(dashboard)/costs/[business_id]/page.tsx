import Link from 'next/link'

import { forecastSettingAction } from '@/app/actions/blueprint'
import { ActionForm } from '@/components/blueprint/action-form'
import { CostingWatchCard } from '@/components/cost/costing-watch-card'
import { CostingTable } from '@/components/costs/costing-table'
import { OverheadManager } from '@/components/costs/overhead-manager'
import { CostImportPanel } from '@/components/cost-import/cost-import-panel'
import { PageHeader } from '@/components/layout/page-header'
import { ActualTable } from '@/components/production/actual-table'
import { recordScreenRead } from '@/lib/activity-record'
import { BLUEPRINT_OFF, blueprintErrorKey } from '@/lib/blueprint/format'
import { FIELD, LABEL, LINK_PILL } from '@/lib/blueprint/ui'
import { featureOn } from '@/lib/features-server'
import { kstToday } from '@/lib/chairman-project'
import { costEngineError } from '@/lib/costs/errors'
import { ROUNDING_NOTE } from '@/lib/costs/format'
import { openCosts } from '@/lib/costs/page'
import { asOfLabel } from '@/lib/sales/cost'
import type { CostingRow, CostingWatchRow, ForecastRow, ForecastSetting, OverheadSummaryRow, ProdActualRow } from '@/types'

/**
 * 원가 관리(0065 · 설계서 2.9 · 5절) — 제품 원가(Market · Current · 제조 · 포장 · 물류 · 간접비 · 총원가) · 비용 마스터 · 배부 기준 · Actual 원가.
 *
 * 볼 수 있음 = 대표 또는 '/costing/<biz>' 줄. 쓰기(비용 · 배부) = '/costing/<biz>' can_write · 대표.
 * 원가 목록은 0065 cost_costing_list 한 번(하루 20번 · 호출마다 감사). **이 화면은 BOM · 원료별 분해 · 구매 LOT 잔량을 부르지 않는다**
 * (check:sales-cost 정적 검사 — 잔량은 0064 리뷰 C1로 원가 관리에서 빠졌다). 대표에게만 «원가 관리 권한자» 감시 카드와 BOM 화면 링크.
 */
export default async function CostsPage(props: PageProps<'/costs/[business_id]'>) {
  const { business_id } = await props.params
  const { repo, user, business, canWrite } = await openCosts(business_id)
  // 404 뒤에 둔다(볼 수 없는 회사의 id를 찍어 본 것은 조회가 아니다).
  await recordScreenRead({ path: `/costs/${business_id}`, kind: 'page', business_id })
  const chairman = user.role === 'Chairman'
  const marginsOn = await featureOn(user, 'sales_margins', business_id)
  const candidatesOn = canWrite && (await featureOn(user, 'cost_candidates', business_id))
  // 0081 — 스위치마다(기본 대표만). 꺼지면 칸 · 링크가 없다.
  const [forecastOn, diagnosisOn, competitorOn, customersOn] = await Promise.all([
    featureOn(user, 'cost_forecast', business_id),
    featureOn(user, 'product_diagnosis', business_id),
    featureOn(user, 'competitor_price', business_id),
    featureOn(user, 'customer_profit', business_id),
  ])
  const today = kstToday()

  const settle = <T,>(p: Promise<T>, fallback: T, where: string, msg: string) =>
    p.then(
      (value) => ({ value, error: null as string | null }),
      (e: unknown) => {
        console.error(`[costs] ${where}`, e instanceof Error ? e.message : String(e))
        return { value: fallback, error: costEngineError(e, chairman, msg) }
      },
    )

  const [costing, summary, actual, watch, products, overheads, alloc] = await Promise.all([
    settle<CostingRow[]>(repo.costingList(business_id), [], 'cost_costing_list', '제품 원가를 불러오지 못했습니다.'),
    settle<OverheadSummaryRow[]>(repo.overheadSummary(business_id), [], 'cost_overhead_summary', '비용 마스터를 불러오지 못했습니다.'),
    settle<ProdActualRow[]>(repo.prodActual(business_id), [], 'cost_prod_actual', 'Actual 원가를 불러오지 못했습니다.'),
    chairman
      ? settle<CostingWatchRow[]>(repo.costingWatch(business_id), [], 'cost_costing_watch', '원가 관리 권한자를 불러오지 못했습니다.')
      : Promise.resolve(null),
    repo.listCostProducts(business_id),
    repo.listOverheads(business_id),
    repo.allocSettings(business_id),
  ])

  // ① Forecast(0081 cost_forecast_list — 문 한 번 · 하루 20번). 대표 원래 값 · 원가 관리 1원. 설정은 대표만 고친다.
  let forecast: Map<string, ForecastRow> | null = null
  let forecastError: string | null = null
  let forecastSetting: ForecastSetting | null = null
  if (forecastOn) {
    try {
      forecast = new Map((await repo.costForecastList(business_id)).map((r) => [r.product_id, r]))
      if (chairman) forecastSetting = await repo.costForecastSetting(business_id)
    } catch (e) {
      console.error('[costs] cost_forecast_list', e instanceof Error ? e.message : String(e))
      const k = blueprintErrorKey(e)
      forecastError = k === 'off' ? BLUEPRINT_OFF : k === 'unavailable' ? null : costEngineError(e, chairman, 'Forecast 원가를 불러오지 못했습니다.')
    }
  }

  const asOf = costing.value[0]?.as_of ?? null
  const pending = costing.value.some((r) => !r.overhead_ready)

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="layers"
        title={`${business.name} 원가 관리`}
        code="COST-C1"
        description={asOf ? `${asOfLabel(asOf)} · 금액은 원/kg · 1원 단위` : '제품 원가 · 비용 마스터 · 배부 기준 · Actual — 금액은 원/kg'}
      >
        {marginsOn ? (
          <Link
            href={`/costs/${encodeURIComponent(business_id)}/margins`}
            className="inline-flex min-h-11 items-center rounded-md border border-line bg-panel px-2.5 text-t11h text-ink-dim hover:border-accent hover:text-ink lg:min-h-0 lg:py-1.5"
          >
            견적 마진 vs 실제 마진
          </Link>
        ) : null}
        {candidatesOn ? (
          <Link
            href={`/costs/${encodeURIComponent(business_id)}/candidates`}
            className="inline-flex min-h-11 items-center rounded-md border border-line bg-panel px-2.5 text-t11h text-ink-dim hover:border-accent hover:text-ink lg:min-h-0 lg:py-1.5"
          >
            원가 후보 승인
          </Link>
        ) : null}
        {competitorOn ? (
          <Link href={`/costs/${encodeURIComponent(business_id)}/competitor`} className={LINK_PILL}>
            경쟁사 가정
          </Link>
        ) : null}
        {customersOn ? (
          <Link href={`/finance/${encodeURIComponent(business_id)}/customers`} className={LINK_PILL}>
            고객별 수익성
          </Link>
        ) : null}
        {chairman ? (
          <Link href={`/costs/${encodeURIComponent(business_id)}/bom/import`} className={LINK_PILL}>
            진짜 BOM 넣기
          </Link>
        ) : null}
        {chairman ? (
          <Link
            href={`/costs/${encodeURIComponent(business_id)}/bom`}
            className="inline-flex min-h-11 items-center rounded-md border border-line bg-panel px-2.5 text-t11h text-ink-dim hover:border-accent hover:text-ink lg:min-h-0 lg:py-1.5"
          >
            BOM 보기 · 넣기
          </Link>
        ) : null}
      </PageHeader>

      <div className="mt-4 space-y-3">
        {costing.error ? (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-t12 text-critical">
            {costing.error}
          </p>
        ) : costing.value.length === 0 ? (
          <section className="rounded-xl border border-line-soft bg-panel px-4 py-10 text-center text-t13 text-ink-dim">아직 원가를 볼 제품이 없습니다.</section>
        ) : (
          <>
            <CostingTable
              rows={costing.value}
              forecast={forecast}
              productHref={diagnosisOn ? (id) => `/costs/${encodeURIComponent(business_id)}/products/${encodeURIComponent(id)}` : null}
            />
            <ul className="space-y-0.5 text-t10h text-ink-dim">
              <li>총원가(Fully Loaded) = DY 원가(Current, 원료비) + 제조 + 포장 + 물류 + 간접비. 영업 화면의 총원가 · 제시가가 이 값입니다.</li>
              <li>«계획 기준» = 직전 기간 생산이 없어 월 계획 생산량으로 나눈 값. «비용 준비 전» = 비용 마스터가 없어 총원가가 원료비만입니다.</li>
              {pending ? <li>비용이 비어 있는 제품은 아래 «비용 넣기»와 «배부 기준»을 정하면 계산됩니다.</li> : null}
              <li>{ROUNDING_NOTE}</li>
              {forecast ? <li>Forecast = 최근 구매가(오늘 환율) × 구매 비중 + 다음 달 시장 전망(없으면 오늘 시장가) × 나머지 — 월별 손익에는 들어가지 않습니다.</li> : null}
            </ul>
          </>
        )}
        {forecastError ? (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-t12 text-critical">
            {forecastError}
          </p>
        ) : null}
        {forecastSetting ? (
          <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="Forecast 설정">
            <h2 className="mb-2 text-t13 font-semibold">Forecast 설정</h2>
            <ActionForm action={forecastSettingAction} submit="설정 저장" label="Forecast 설정">
              <input type="hidden" name="businessId" value={business_id} />
              <label className={LABEL}>
                구매가 비중(%)
                <input name="blend" type="number" min={0} max={100} step="1" defaultValue={forecastSetting.blend_purchase_pct} className={`${FIELD} w-24`} />
              </label>
              <label className={LABEL}>
                환율
                <select name="fxMode" defaultValue={forecastSetting.fx_mode} className={FIELD}>
                  <option value="today">오늘 환율</option>
                  <option value="manual">수동 환율</option>
                </select>
              </label>
              <label className={LABEL}>
                수동 환율(통화=원)
                <input
                  name="fxManual"
                  defaultValue={Object.entries(forecastSetting.fx_manual)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')}
                  placeholder="USD=1380"
                  className={`${FIELD} w-48`}
                />
              </label>
            </ActionForm>
            <p className="mt-1 text-t10h text-ink-muted">
              {forecastSetting.is_default ? '아직 저장한 설정이 없습니다 — 기본값(50% · 오늘 환율)으로 계산합니다.' : `마지막 저장 ${forecastSetting.updated_at?.slice(0, 10) ?? ''}`}
            </p>
          </section>
        ) : null}

        {summary.error ? (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-t12 text-critical">
            {summary.error}
          </p>
        ) : (
          <>
            {canWrite ? <CostImportPanel businessId={business_id} target="overheads" title="비용 줄 엑셀로 넣기" /> : null}
            <OverheadManager
              businessId={business_id}
              today={today}
              canWrite={canWrite}
              products={products}
              summary={summary.value}
              overheads={overheads}
              alloc={alloc}
            />
          </>
        )}

        <ActualTable rows={actual.value} chairman={chairman} error={actual.error} />

        {watch ? <CostingWatchCard rows={watch.value} error={watch.error} /> : null}
      </div>
    </div>
  )
}
