import { CostingWatchCard } from '@/components/cost/costing-watch-card'
import { PageHeader } from '@/components/layout/page-header'
import { SalesCostBoard } from '@/components/sales/sales-cost-board'
import { recordScreenRead } from '@/lib/activity-record'
import { asOfLabel, salesCostError } from '@/lib/sales/cost'
import { openSales } from '@/lib/sales/page'
import type { CostingWatchRow, SalesCostRow } from '@/types'

/**
 * 영업 원가(회장 결정 2026-10-09 «영업은 제품 총액만, 원료별 가격은 모른다» · 설계서 3.2 · 13절).
 *
 * 제품마다 Market 원가 · DY 원가(Current) · 원가 우위(Market − Current) · 총원가 · 원료비 영향, 펼치면 제시가 확인 · 목표 마진별 제시가.
 * 숫자는 한 번에 0062 cost_sales_list로 받는다(하루 200건 한도에 한 번만 센다). 영업 = 오늘 0시까지 저장된 값(회장 결정 2026-10-10 (가)) · 1원/kg
 * (회장 결정 2026-10-09 밤 — 대표 외는 DB가 1원으로, 대표는 원래 값을 받아 화면이 1원으로 그린다).
 * **이 화면은 원료 표(원료 · 시세 · LOT)를 부르지 않는다** — check:sales-cost가 정적으로 본다.
 * 대표에게만 «원가 관리 권한자» 감시 카드(0061 cost_costing_watch).
 */
export default async function SalesCostPage(props: PageProps<'/sales/[business_id]'>) {
  const { business_id } = await props.params
  const { repo, user, business } = await openSales(business_id)
  // 404 뒤에 둔다(볼 수 없는 회사의 id를 찍어 본 것은 조회가 아니다).
  await recordScreenRead({ path: `/sales/${business_id}`, kind: 'page', business_id })
  const chairman = user.role === 'Chairman'

  let rows: SalesCostRow[] = []
  let error: string | null = null
  try {
    rows = await repo.costSalesList(business_id)
  } catch (e) {
    console.error('[sales] cost_sales_list', e instanceof Error ? e.message : String(e))
    error = salesCostError(e)
  }

  let watch: CostingWatchRow[] = []
  let watchError: string | null = null
  if (chairman) {
    try {
      watch = await repo.costingWatch(business_id)
    } catch (e) {
      console.error('[sales] cost_costing_watch', e instanceof Error ? e.message : String(e))
      watchError = '원가 관리 권한자를 불러오지 못했습니다.'
    }
  }

  const asOf = rows[0]?.as_of ?? null
  // (가) 원가 관리 줄이 있거나 대표면 즉시, 영업은 오늘 0시 기준(문은 DB 0062 cost_gate_biz).
  const immediate = chairman || !!user.cost?.costing?.[business_id]
  const overheadPending = rows.some((r) => !r.overhead_ready)
  const overheadReady = rows.some((r) => r.overhead_ready)

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="target"
        title={`${business.name} 영업 원가`}
        code="COST-S1"
        description={asOf ? `${asOfLabel(asOf, immediate)} · 금액은 원/kg · 1원 단위` : '제품 총원가 · 원가 우위 · 제시가 — 금액은 원/kg'}
      />

      <div className="mt-4 space-y-3">
        {error ? (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-t12 text-critical">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <section className="rounded-xl border border-line-soft bg-panel px-4 py-10 text-center text-t13 text-ink-dim">
            아직 원가를 볼 제품이 없습니다.
          </section>
        ) : (
          <>
            <SalesCostBoard rows={rows} />
            <ul className="space-y-0.5 text-t10h text-ink-dim">
              <li>Market 원가 = 오늘 시장가로 샀다면의 원료비 · DY 원가(Current) = 실제로 산 값 기준 원료비 · 원가 우위 = Market − DY 원가(초록이면 시장보다 싸게 샀다).</li>
              {overheadReady ? <li>비용(제조 · 포장 · 물류 · 간접비)은 원가 관리에서 정한 배부 기준 — 총원가 = 원료비 + 비용.</li> : null}
              {overheadPending ? <li>비용(물류 · 인건비 등)은 비용 마스터가 생기면 더해집니다 — 비용이 없는 제품의 총원가는 원료비입니다.</li> : null}
              <li>원료비 영향 = 7일 전 대비 원료비 변화(0.1%p). 구매 기록 · 시세가 바뀌면 바로 반영됩니다.</li>
              <li>원가 우위 · 총원가 · 제시가는 원 단위 아래까지 계산한 뒤 1원으로 보여 줍니다 — 보이는 숫자끼리 빼면 1원 다를 수 있습니다.</li>
            </ul>
          </>
        )}

        {chairman ? <CostingWatchCard rows={watch} error={watchError} /> : null}
      </div>
    </div>
  )
}
