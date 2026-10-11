import { PageHeader } from '@/components/layout/page-header'
import { MarketManager } from '@/components/purchasing/market-manager'
import { PurchasingNav } from '@/components/purchasing/purchasing-nav'
import { kstToday } from '@/lib/chairman-project'
import { recordScreenRead } from '@/lib/activity-record'
import { openPurchasing } from '@/lib/purchasing/page'

/** 시장가 입력 · 이력(0061 cost_market_prices — 일 단위). 고치지 않는다 — 틀리면 무효(이유) + 새 줄. */
export default async function PurchasingMarketPage(props: PageProps<'/purchasing/[business_id]/market'>) {
  const { business_id } = await props.params
  const { repo, business, canWrite } = await openPurchasing(business_id)
  // 구매 화면 열람은 0031 열람 기록으로 남는다 — 대표의 «원가 관리 권한자» 감시(0061 cost_costing_watch)가 센다. 404 뒤에 둔다.
  await recordScreenRead({ path: `/purchasing/${business_id}/market`, kind: 'page', business_id })
  const [materials, prices] = await Promise.all([repo.listCostMaterials(business_id), repo.listMarketPrices(business_id, 90)])

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="cart"
        title={`${business.name} 시장가`}
        code="COST-P4"
        description="원료 시세(kg당) — 하루 한 값, 출처마다. 원화 환산은 저장할 때 계산합니다."
      >
        <PurchasingNav businessId={business_id} current="market" />
      </PageHeader>
      <MarketManager businessId={business_id} materials={materials} prices={prices} canEdit={canWrite} today={kstToday()} />
    </div>
  )
}
