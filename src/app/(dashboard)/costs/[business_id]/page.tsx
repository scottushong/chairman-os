import Link from 'next/link'

import { CostingWatchCard } from '@/components/cost/costing-watch-card'
import { CostingTable } from '@/components/costs/costing-table'
import { OverheadManager } from '@/components/costs/overhead-manager'
import { CostImportPanel } from '@/components/cost-import/cost-import-panel'
import { PageHeader } from '@/components/layout/page-header'
import { ActualTable } from '@/components/production/actual-table'
import { recordScreenRead } from '@/lib/activity-record'
import { kstToday } from '@/lib/chairman-project'
import { costEngineError } from '@/lib/costs/errors'
import { ROUNDING_NOTE } from '@/lib/costs/format'
import { openCosts } from '@/lib/costs/page'
import { asOfLabel } from '@/lib/sales/cost'
import type { CostingRow, CostingWatchRow, OverheadSummaryRow, ProdActualRow } from '@/types'

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
            <CostingTable rows={costing.value} />
            <ul className="space-y-0.5 text-t10h text-ink-dim">
              <li>총원가(Fully Loaded) = DY 원가(Current, 원료비) + 제조 + 포장 + 물류 + 간접비. 영업 화면의 총원가 · 제시가가 이 값입니다.</li>
              <li>«계획 기준» = 직전 기간 생산이 없어 월 계획 생산량으로 나눈 값. «비용 준비 전» = 비용 마스터가 없어 총원가가 원료비만입니다.</li>
              {pending ? <li>비용이 비어 있는 제품은 아래 «비용 넣기»와 «배부 기준»을 정하면 계산됩니다.</li> : null}
              <li>{ROUNDING_NOTE}</li>
            </ul>
          </>
        )}

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
