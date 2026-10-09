import { PageHeader } from '@/components/layout/page-header'
import { MaterialsManager } from '@/components/purchasing/materials-manager'
import { PurchasingNav } from '@/components/purchasing/purchasing-nav'
import { boss } from '@/lib/boss'
import { openPurchasing } from '@/lib/purchasing/page'

/** 원료 마스터(0061 cost_materials) — 이름 · 규격 · 분류 · 사용 · 메모. 배합 · 투입 비율은 없다(비공개 원가 장부). */
export default async function PurchasingMaterialsPage(props: PageProps<'/purchasing/[business_id]/materials'>) {
  const { business_id } = await props.params
  const { repo, user, business, canWrite } = await openPurchasing(business_id)
  const materials = await repo.listCostMaterials(business_id)

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader icon="cart" title={`${business.name} 원료`} code="COST-P2" description="원료 이름 · 규격 · 분류. 고친 내용은 감사에 남습니다.">
        <PurchasingNav businessId={business_id} current="materials" />
      </PageHeader>
      <MaterialsManager businessId={business_id} materials={materials} canEdit={canWrite} bossWord={boss(user.role)} />
    </div>
  )
}
