import Link from 'next/link'

import { CostImportPanel } from '@/components/cost-import/cost-import-panel'
import { PageHeader } from '@/components/layout/page-header'
import { ActualTable } from '@/components/production/actual-table'
import { LotBalances } from '@/components/production/lot-balances'
import { ProductionBoard } from '@/components/production/production-board'
import { recordScreenRead } from '@/lib/activity-record'
import { kstToday } from '@/lib/chairman-project'
import { kgText } from '@/lib/blueprint/format'
import { costEngineError } from '@/lib/costs/errors'
import { addDays } from '@/lib/costs/format'
import { featureOn } from '@/lib/features-server'
import { openProduction } from '@/lib/production/page'
import type { LotBalance, ProdActualRow, WorkOrderListRow } from '@/types'

/**
 * 생산(0064 · 설계서 2.5 · 2.8 · 9.3절) — 작업지시 · 생산 LOT · 투입 · 구매 LOT 잔량 · 조정.
 *
 * 볼 수 있음 = 대표 또는 '/production/<biz>' 줄. 쓰기(생산 LOT · 투입 · 조정 · 완료) = '/production/<biz>' can_write · 대표.
 * **작업지시는 원료 · kg만**(비율 · 수율 없음). **대표 외에게는 원가 숫자가 없다** — 발행 폼과 Actual 원가 표(분해 포함)는 대표에게만 그린다.
 * 0081 ⑥ 스위치 'work_orders'면 «내 작업지시»(work_order_mine — 대표는 전부, 생산은 본인 담당만)와 «작업지시 보기» 링크.
 */
export default async function ProductionPage(props: PageProps<'/production/[business_id]'>) {
  const { business_id } = await props.params
  const { repo, user, business, canWrite } = await openProduction(business_id)
  // 404 뒤에 둔다(볼 수 없는 회사의 id를 찍어 본 것은 조회가 아니다).
  await recordScreenRead({ path: `/production/${business_id}`, kind: 'page', business_id })
  const chairman = user.role === 'Chairman'
  const today = kstToday()
  const tomorrow = addDays(today, 1)

  const [products, materials, orders, prodLots, inputs, adjustments] = await Promise.all([
    repo.listCostProducts(business_id),
    repo.listCostMaterials(business_id),
    repo.listProductionOrders(business_id),
    repo.listProdLots(business_id),
    repo.listProdInputs(business_id),
    repo.listLotAdjustments(business_id),
  ])
  const lines = await repo.listProductionOrderLines(orders.map((o) => o.order_id))

  let balances: LotBalance[] = []
  let balanceError: string | null = null
  try {
    balances = await repo.lotBalances(business_id, true)
  } catch (e) {
    console.error('[production] cost_lot_balances', e instanceof Error ? e.message : String(e))
    balanceError = costEngineError(e, chairman, '구매 LOT 잔량을 불러오지 못했습니다.')
  }

  // 대표만 — Actual 원가(원래 값 · 화면이 1원). 대표 외는 부르지도 않는다(생산은 DB도 cost_not_found).
  let actual: ProdActualRow[] = []
  let actualError: string | null = null
  if (chairman) {
    try {
      actual = await repo.prodActual(business_id)
    } catch (e) {
      console.error('[production] cost_prod_actual', e instanceof Error ? e.message : String(e))
      actualError = costEngineError(e, true, 'Actual 원가를 불러오지 못했습니다.')
    }
  }

  let mine: WorkOrderListRow[] | null = null
  if (await featureOn(user, 'work_orders', business_id)) {
    mine = await repo.workOrderMine(business_id).catch((e: unknown) => {
      console.error('[production] work_order_mine', e instanceof Error ? e.message : String(e))
      return []
    })
  }

  const materialNames = Object.fromEntries(materials.map((m) => [m.material_id, m.name]))
  const open = orders.filter((o) => o.status === 'open').length

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="factory"
        title={`${business.name} 생산`}
        code="COST-M1"
        description={`진행 중 작업지시 ${open}건 · 오늘 ${today} · kg는 0.001까지 · 기록은 고치지 않고 무효로 하고 다시 넣습니다.`}
      />
      {canWrite ? (
        <div className="mt-4">
          <CostImportPanel businessId={business_id} target="production" title="생산 LOT · 투입 엑셀로 넣기" />
        </div>
      ) : null}
      {mine ? (
        <section className="mt-4 rounded-xl border border-line-soft bg-panel p-3" aria-label="작업지시">
          <h2 className="mb-1 text-t13 font-semibold">{chairman ? '작업지시(전체)' : '내 작업지시'}</h2>
          {mine.length === 0 ? (
            <p className="text-t12 text-ink-muted">맡은 작업지시가 없습니다.</p>
          ) : (
            <ul className="space-y-1 text-t12">
              {mine.slice(0, 30).map((o) => (
                <li key={o.order_id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="tnum text-ink-muted">{o.planned_on}</span>
                  <span className="font-semibold">{o.product_name}</span>
                  <span className="tnum">{kgText(o.planned_kg)}</span>
                  {o.tank ? <span className="text-ink-muted">탱크 {o.tank}</span> : null}
                  {o.seq !== null ? <span className="text-ink-muted">순서 {o.seq}</span> : null}
                  <Link
                    href={`/production/${encodeURIComponent(business_id)}/orders/${encodeURIComponent(o.order_id)}`}
                    className="inline-flex min-h-11 items-center text-accent hover:underline lg:min-h-0"
                  >
                    작업지시 보기
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <ProductionBoard
        businessId={business_id}
        today={today}
        tomorrow={tomorrow}
        canWrite={canWrite}
        chairman={chairman}
        products={products}
        materialNames={materialNames}
        orders={orders}
        lines={lines}
        prodLots={prodLots}
        inputs={inputs}
        balances={balances}
      />
      <div className="mt-3 space-y-3">
        {balanceError ? (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-t12 text-critical">
            {balanceError}
          </p>
        ) : (
          <LotBalances businessId={business_id} today={today} tomorrow={tomorrow} canWrite={canWrite} balances={balances} adjustments={adjustments} />
        )}
        {chairman ? <ActualTable rows={actual} chairman error={actualError} /> : null}
      </div>
    </div>
  )
}
