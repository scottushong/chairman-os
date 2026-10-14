import Link from 'next/link'
import { notFound } from 'next/navigation'

import { workOrderAction } from '@/app/actions/blueprint'
import { ActionForm } from '@/components/blueprint/action-form'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { BLUEPRINT_OFF, blueprintErrorKey, kgText } from '@/lib/blueprint/format'
import { ALERT, FIELD, LABEL, TABLE_BOX, TD, TH } from '@/lib/blueprint/ui'
import { costEngineError } from '@/lib/costs/errors'
import { featureOn } from '@/lib/features-server'
import { openProduction } from '@/lib/production/page'
import type { UserAccount, WorkOrder } from '@/types'

const STATUS_KO: Record<string, string> = { open: '진행 중', done: '완료', cancelled: '취소' }

/**
 * ⑥ 작업지시 한 장(0081 work_order_get). 스위치 'work_orders'(기본 대표만)가 꺼지면 404.
 * 볼 수 있음 = 대표 · 그 오더 담당 생산 직원(DB가 가른다 — 남의 오더 · 담당 없는 오더는 404).
 * 원료는 코드(R-xxxxxx)와 이번 배치 kg만 — 이름은 «이름 가림»을 끈 오더에서만. 비율 · 수율 · 단가는 없다.
 * 대표에게만 탱크 · 순서 · 담당 · 이름 가림 폼(work_order_set).
 */
export default async function WorkOrderPage(props: PageProps<'/production/[business_id]/orders/[order_id]'>) {
  const { business_id, order_id } = await props.params
  const { repo, user, business } = await openProduction(business_id)
  if (!(await featureOn(user, 'work_orders', business_id))) notFound()
  const chairman = user.role === 'Chairman'

  let wo: WorkOrder | null = null
  let error: string | null = null
  try {
    wo = await repo.workOrderGet(order_id)
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (/cost_not_found/.test(m)) notFound()
    console.error('[work-order] work_order_get', m)
    const k = blueprintErrorKey(e)
    error = k === 'off' ? BLUEPRINT_OFF : k === 'unavailable' ? '작업지시는 준비 중입니다.' : costEngineError(e, chairman, '작업지시를 불러오지 못했습니다.')
  }
  await recordScreenRead({ path: `/production/${business_id}/orders/${order_id}`, kind: 'page', business_id })

  // 대표만 — 담당자 고르기(이 회사 생산 줄이 있는 사람).
  // 0081 work_order_get은 지금 담당(assignee)을 돌려주지 않는다 — 폼은 늘 «없음»에서 시작(DEFERRED «0081 화면»).
  let staff: UserAccount[] = []
  if (chairman && wo) {
    staff = (await repo.listUserAccounts().catch(() => [])).filter((p) => !p.revoked_at && p.modules.some((m) => m.module === `/production/${business_id}`))
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader icon="factory" title={`작업지시 ${order_id}`} code="COST-W1" description={`${business.name} · 원료는 코드로만 · kg는 0.001까지`} />
      <p className="text-t12">
        <Link href={`/production/${business_id}`} className="text-accent hover:underline">
          ← 생산
        </Link>
      </p>
      {error ? (
        <p role="alert" className={ALERT}>
          {error}
        </p>
      ) : null}
      {wo ? (
        <>
          <section className="grid gap-2 rounded-xl border border-line-soft bg-panel p-4 text-t13 sm:grid-cols-5" aria-label="작업지시 머리">
            {[
              ['제품', wo.product_name ?? '—'],
              ['계획일', wo.planned_on],
              ['계획 kg', kgText(wo.planned_kg)],
              ['탱크', wo.tank ?? '—'],
              ['순서', wo.seq === null ? '—' : String(wo.seq)],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-t11 text-ink-muted">{k}</p>
                <p className="font-semibold tnum">{v}</p>
              </div>
            ))}
            <p className="text-t11 text-ink-muted sm:col-span-5">
              상태 {STATUS_KO[wo.status] ?? wo.status} · 원료 이름 {wo.hide_names ? '가림' : '보임'}
            </p>
          </section>

          <section className={TABLE_BOX} aria-label="원료 줄">
            <h2 className="px-3 pt-2 text-t13 font-semibold max-sm:px-0">원료 줄</h2>
            <table className="m-cards w-full text-t12 sm:min-w-[480px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                  <th className={TH}>원료 코드</th>
                  {wo.lines.some((l) => l.material_name) ? <th className={TH}>이름</th> : null}
                  <th className={`${TH} text-right`}>이번 배치 kg</th>
                </tr>
              </thead>
              <tbody>
                {wo.lines.map((l) => (
                  <tr key={l.code} className="border-t border-line-soft">
                    <td className={`${TD} font-semibold tnum`} data-label="원료 코드">
                      {l.code}
                    </td>
                    {wo!.lines.some((x) => x.material_name) ? (
                      <td className={TD} data-label="이름">
                        {l.material_name ?? '—'}
                      </td>
                    ) : null}
                    <td className={`${TD} text-right tnum`} data-label="배치 kg">
                      {kgText(l.batch_kg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={TABLE_BOX} aria-label="투입">
            <h2 className="px-3 pt-2 text-t13 font-semibold max-sm:px-0">투입</h2>
            <table className="m-cards w-full text-t12 sm:min-w-[560px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                  <th className={TH}>생산 LOT</th>
                  <th className={TH}>원료 코드</th>
                  <th className={`${TH} text-right`}>kg</th>
                  <th className={TH}>시각</th>
                </tr>
              </thead>
              <tbody>
                {wo.inputs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-ink-muted">
                      아직 투입이 없습니다.
                    </td>
                  </tr>
                ) : (
                  wo.inputs.map((i, n) => (
                    <tr key={`${i.prod_lot_id}|${n}`} className="border-t border-line-soft">
                      <td className={`${TD} tnum`} data-label="생산 LOT">
                        {i.prod_lot_id}
                      </td>
                      <td className={`${TD} tnum`} data-label="원료 코드">
                        {i.code}
                      </td>
                      <td className={`${TD} text-right tnum`} data-label="kg">
                        {kgText(i.qty_kg)}
                      </td>
                      <td className={`${TD} tnum`} data-label="시각">
                        {i.created_at.slice(0, 16).replace('T', ' ')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          {chairman ? (
            <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="작업지시 정하기">
              <h2 className="mb-2 text-t13 font-semibold">탱크 · 순서 · 담당</h2>
              <ActionForm action={workOrderAction} submit="저장" label="작업지시 정하기">
                <input type="hidden" name="businessId" value={business_id} />
                <input type="hidden" name="orderId" value={wo.order_id} />
                <label className={LABEL}>
                  탱크
                  <input name="tank" defaultValue={wo.tank ?? ''} maxLength={40} className={`${FIELD} w-28`} />
                </label>
                <label className={LABEL}>
                  순서
                  <input name="seq" inputMode="numeric" defaultValue={wo.seq ?? ''} className={`${FIELD} w-20`} />
                </label>
                <label className={LABEL}>
                  담당
                  <select name="assignee" defaultValue="" className={FIELD}>
                    <option value="">없음</option>
                    {staff.map((p) => (
                      <option key={p.user_id} value={p.user_id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-1.5 text-t12 lg:min-h-0">
                  <input type="checkbox" name="hideNames" defaultChecked={wo.hide_names} className="size-4 accent-[var(--color-accent)]" />
                  원료 이름 가림
                </label>
              </ActionForm>
              <p className="mt-1 text-t10h text-ink-muted">담당은 저장할 때마다 다시 고릅니다(지금 담당은 화면에 따로 보이지 않습니다). 담당 직원은 자기 오더만 봅니다.</p>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
