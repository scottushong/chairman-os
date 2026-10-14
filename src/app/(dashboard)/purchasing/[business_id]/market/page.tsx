import { outlookAction } from '@/app/actions/blueprint'
import { ActionForm } from '@/components/blueprint/action-form'
import { CostImportPanel } from '@/components/cost-import/cost-import-panel'
import { PageHeader } from '@/components/layout/page-header'
import { MarketManager } from '@/components/purchasing/market-manager'
import { PurchasingNav } from '@/components/purchasing/purchasing-nav'
import { kstToday } from '@/lib/chairman-project'
import { recordScreenRead } from '@/lib/activity-record'
import { addMonthsIso } from '@/lib/blueprint/period'
import { FIELD, LABEL } from '@/lib/blueprint/ui'
import { featureOn } from '@/lib/features-server'
import { openPurchasing } from '@/lib/purchasing/page'
import type { OutlookRow } from '@/types'

/** 시장가 입력 · 이력(0061 cost_market_prices — 일 단위). 고치지 않는다 — 틀리면 무효(이유) + 새 줄. */
export default async function PurchasingMarketPage(props: PageProps<'/purchasing/[business_id]/market'>) {
  const { business_id } = await props.params
  const { repo, user, business, canWrite } = await openPurchasing(business_id)
  // 구매 화면 열람은 0031 열람 기록으로 남는다 — 대표의 «원가 관리 권한자» 감시(0061 cost_costing_watch)가 센다. 404 뒤에 둔다.
  await recordScreenRead({ path: `/purchasing/${business_id}/market`, kind: 'page', business_id })
  const [materials, prices] = await Promise.all([repo.listCostMaterials(business_id), repo.listMarketPrices(business_id, 90)])
  // 0081 ① 다음 달 시장 전망(스위치 cost_forecast) — 쓰기 = 구매 쓰기 · 대표, 읽기 = 구매 · 원가 관리 · 대표. Forecast 원가가 이 값을 쓴다.
  const outlookOn = await featureOn(user, 'cost_forecast', business_id)
  let outlooks: OutlookRow[] = []
  if (outlookOn) {
    outlooks = await repo.costOutlookList(business_id).catch((e: unknown) => {
      console.error('[purchasing] cost_outlook_list', e instanceof Error ? e.message : String(e))
      return []
    })
  }
  const nextMonth = addMonthsIso(`${kstToday().slice(0, 7)}-01`, 1).slice(0, 7)

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
      {canWrite ? (
        <div className="mt-4">
          <CostImportPanel businessId={business_id} target="market_prices" />
        </div>
      ) : null}
      {outlookOn ? (
        <section className="mt-4 rounded-xl border border-line-soft bg-panel p-3" aria-label="다음 달 예상">
          <h2 className="mb-2 text-t13 font-semibold">다음 달 예상(시장 전망)</h2>
          {canWrite ? (
            <ActionForm action={outlookAction} submit="전망 저장" label="다음 달 예상 넣기">
              <input type="hidden" name="businessId" value={business_id} />
              <label className={LABEL}>
                원료
                <select name="materialId" className={FIELD} required>
                  {materials
                    .filter((m) => m.active)
                    .map((m) => (
                      <option key={m.material_id} value={m.material_id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className={LABEL}>
                달
                <input name="month" type="month" defaultValue={nextMonth} className={FIELD} required />
              </label>
              <label className={LABEL}>
                가격(kg당)
                <input name="price" inputMode="decimal" className={`${FIELD} w-28`} required />
              </label>
              <label className={LABEL}>
                통화
                <input name="currency" defaultValue="KRW" maxLength={3} className={`${FIELD} w-20`} />
              </label>
              <label className={LABEL}>
                환율(비우면 그 달 환율)
                <input name="fx" inputMode="decimal" className={`${FIELD} w-28`} />
              </label>
              <label className={LABEL}>
                메모
                <input name="note" maxLength={300} className={`${FIELD} w-48`} />
              </label>
            </ActionForm>
          ) : null}
          {outlooks.length ? (
            <ul className="mt-2 space-y-0.5 text-t12">
              {outlooks.slice(0, 20).map((o) => (
                <li key={o.outlook_id} className="flex flex-wrap gap-x-3">
                  <span className="tnum text-ink-muted">{o.month.slice(0, 7)}</span>
                  <span>{o.material_name}</span>
                  <span className="tnum">
                    {o.price.toLocaleString('ko-KR')} {o.currency} → {Math.round(o.price_krw_per_kg).toLocaleString('ko-KR')}원/kg
                  </span>
                  {o.note ? <span className="text-ink-muted">{o.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-t11 text-ink-muted">아직 넣은 전망이 없습니다 — 없으면 Forecast는 오늘 시장가를 씁니다.</p>
          )}
        </section>
      ) : null}
      <MarketManager key={prices.length} businessId={business_id} materials={materials} prices={prices} canEdit={canWrite} today={kstToday()} />
    </div>
  )
}
