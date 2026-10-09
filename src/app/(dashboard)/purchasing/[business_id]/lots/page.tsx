import { PageHeader } from '@/components/layout/page-header'
import { LotsManager } from '@/components/purchasing/lots-manager'
import { PurchasingNav } from '@/components/purchasing/purchasing-nav'
import { kstToday } from '@/lib/chairman-project'
import { openPurchasing } from '@/lib/purchasing/page'

/**
 * 구매 · 입고 LOT(0061 cost_purchase_lots) — 입력(Landed Cost 미리보기 · 환율 자동) · 결재 후보 · 첨부 · 목록.
 * 결재 후보(0061 cost_purchase_candidates)는 구매 입력 권한자만 부를 수 있다 — 원가 관리(읽기)에게는 패널을 그리지 않는다.
 */
export default async function PurchasingLotsPage(props: PageProps<'/purchasing/[business_id]/lots'>) {
  const { business_id } = await props.params
  const { repo, business, canWrite } = await openPurchasing(business_id)
  const today = kstToday()
  const [materials, suppliers, lots, docs, candidates] = await Promise.all([
    repo.listCostMaterials(business_id),
    repo.listCostSuppliers(business_id),
    repo.listPurchaseLots(business_id),
    repo.listPurchaseDocs(business_id),
    canWrite
      ? repo.listPurchaseCandidates(business_id).catch((e) => {
          // 후보를 못 읽어도 LOT 입력은 선다 — 패널만 빠진다.
          console.error('[purchasing] candidates', e)
          return null
        })
      : Promise.resolve(null),
  ])
  const firstCurrency = suppliers.find((s) => s.active)?.currency_default ?? 'KRW'
  const initialFx = await repo.lookupCostFx(firstCurrency, today).catch(() => null)

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="cart"
        title={`${business.name} 구매 LOT`}
        code="COST-P5"
        description="입고 단위 기록 — Landed Cost(원/kg)는 저장할 때 계산합니다. 고치지 않고, 틀리면 무효로 하고 다시 넣습니다."
      >
        <PurchasingNav businessId={business_id} current="lots" />
      </PageHeader>
      <LotsManager
        businessId={business_id}
        materials={materials}
        suppliers={suppliers}
        lots={lots}
        candidates={candidates}
        docs={docs}
        canEdit={canWrite}
        today={today}
        initialFx={initialFx}
      />
    </div>
  )
}
