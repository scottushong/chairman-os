import { PageHeader } from '@/components/layout/page-header'
import { PurchasingNav } from '@/components/purchasing/purchasing-nav'
import { SuppliersManager } from '@/components/purchasing/suppliers-manager'
import { openPurchasing } from '@/lib/purchasing/page'

/** 공급처(0061 cost_suppliers) — 연락처 · 조건은 [제한]: 구매 · 원가 관리 · 대표만 이 표를 읽는다(생산은 이름만, 영업은 없음). */
export default async function PurchasingSuppliersPage(props: PageProps<'/purchasing/[business_id]/suppliers'>) {
  const { business_id } = await props.params
  const { repo, business, canWrite } = await openPurchasing(business_id)
  const suppliers = await repo.listCostSuppliers(business_id)

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader icon="cart" title={`${business.name} 공급처`} code="COST-P3" description="이름 · 나라 · 기본 통화 · 연락처 · 결제 · 인도 조건.">
        <PurchasingNav businessId={business_id} current="suppliers" />
      </PageHeader>
      <SuppliersManager businessId={business_id} suppliers={suppliers} canEdit={canWrite} />
    </div>
  )
}
