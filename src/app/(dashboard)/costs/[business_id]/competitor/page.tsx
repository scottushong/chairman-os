import Link from 'next/link'
import { notFound } from 'next/navigation'

import { competitorAssumptionAction } from '@/app/actions/blueprint'
import { ActionForm } from '@/components/blueprint/action-form'
import { PageHeader } from '@/components/layout/page-header'
import { CompetitorLine } from '@/components/sales/competitor-line'
import { recordScreenRead } from '@/lib/activity-record'
import { BLUEPRINT_OFF, blueprintErrorKey, pct1, won } from '@/lib/blueprint/format'
import { ALERT, FIELD, LABEL, TABLE_BOX, TD, TH } from '@/lib/blueprint/ui'
import { costEngineError } from '@/lib/costs/errors'
import { openCosts } from '@/lib/costs/page'
import { featureOn } from '@/lib/features-server'
import type { CompetitorAssumption } from '@/types'

/**
 * ⑤ 경쟁사 가정(0081 competitor_assumption_list · competitor_assumption_set · competitor_price). 대표 · 원가 관리만 — openCosts가 404로 거른다.
 * 스위치 'competitor_price'(기본 대표만)가 꺼지면 404. 빈 칸 = 우리 값(제조 · 물류 = 우리 비용 묶음, 마진 = 15%).
 * 칸마다 제품 줄 → 회사 기본 줄 → 우리 값. 결과(경쟁사 예상 최소가 · 우리 목표가 · 그 값에서 우리 마진)는 제품마다 한 줄.
 */
export default async function CompetitorPage(props: PageProps<'/costs/[business_id]/competitor'>) {
  const { business_id } = await props.params
  const { repo, user, business, canWrite } = await openCosts(business_id)
  if (!(await featureOn(user, 'competitor_price', business_id))) notFound()
  await recordScreenRead({ path: `/costs/${business_id}/competitor`, kind: 'page', business_id })
  const chairman = user.role === 'Chairman'

  let rows: CompetitorAssumption[] = []
  let error: string | null = null
  try {
    rows = await repo.competitorAssumptionList(business_id)
  } catch (e) {
    console.error('[competitor] competitor_assumption_list', e instanceof Error ? e.message : String(e))
    const k = blueprintErrorKey(e)
    error = k === 'off' ? BLUEPRINT_OFF : k === 'unavailable' ? '경쟁사 가정은 준비 중입니다.' : costEngineError(e, chairman, '경쟁사 가정을 불러오지 못했습니다.')
  }
  const products = (await repo.listCostProducts(business_id)).filter((p) => p.active)
  const ours = (v: number | null, unit: string, fallback: string) => (v === null ? <span className="text-ink-muted">{fallback}</span> : `${won(v)}${unit}`)

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader icon="target" title={`${business.name} 경쟁사 가정`} code="COST-K1" description="경쟁사 제조 · 물류 원/kg · 마진 % — 빈 칸은 우리 값으로 셉니다" />
      <p className="text-t12">
        <Link href={`/costs/${business_id}`} className="text-accent hover:underline">
          ← 원가 관리
        </Link>
      </p>
      {error ? (
        <p role="alert" className={ALERT}>
          {error}
        </p>
      ) : null}
      <section className={TABLE_BOX} aria-label="경쟁사 가정 표">
        <table className="m-cards w-full text-t12 sm:min-w-[760px]">
          <thead>
            <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
              <th className={TH}>범위</th>
              <th className={`${TH} text-right`}>제조(원/kg)</th>
              <th className={`${TH} text-right`}>물류(원/kg)</th>
              <th className={`${TH} text-right`}>경쟁사 마진</th>
              <th className={TH}>메모 · 고친 날</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink-muted">
                  아직 가정이 없습니다 — 모든 칸을 우리 값(마진 15%)으로 셉니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.product_id ?? '*'} className="border-t border-line-soft">
                  <td className={`${TD} font-semibold`} data-label="범위">
                    {r.product_id ? (r.product_name ?? r.product_id) : '회사 기본'}
                  </td>
                  <td className={`${TD} text-right tnum`} data-label="제조">
                    {ours(r.mfg_krw_per_kg, '', '우리 값')}
                  </td>
                  <td className={`${TD} text-right tnum`} data-label="물류">
                    {ours(r.logi_krw_per_kg, '', '우리 값')}
                  </td>
                  <td className={`${TD} text-right tnum`} data-label="마진">
                    {r.margin_pct === null ? <span className="text-ink-muted">15%(기본)</span> : pct1(r.margin_pct)}
                  </td>
                  <td className={TD} data-label="메모">
                    {r.note || '—'} <span className="text-ink-muted">· {r.updated_at.slice(0, 10)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {canWrite ? (
        <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="경쟁사 가정 넣기">
          <h2 className="mb-2 text-t13 font-semibold">가정 넣기 · 바꾸기</h2>
          <ActionForm action={competitorAssumptionAction} submit="저장" label="경쟁사 가정 넣기">
            <input type="hidden" name="businessId" value={business_id} />
            <label className={LABEL}>
              범위
              <select name="productId" className={FIELD} defaultValue="*">
                <option value="*">회사 기본</option>
                {products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              제조(원/kg)
              <input name="mfg" inputMode="decimal" placeholder="우리 값" className={`${FIELD} w-28`} />
            </label>
            <label className={LABEL}>
              물류(원/kg)
              <input name="logi" inputMode="decimal" placeholder="우리 값" className={`${FIELD} w-28`} />
            </label>
            <label className={LABEL}>
              마진(%)
              <input name="margin" inputMode="decimal" placeholder="15" className={`${FIELD} w-20`} />
            </label>
            <label className={LABEL}>
              메모
              <input name="note" maxLength={300} className={`${FIELD} w-48`} />
            </label>
          </ActionForm>
          <p className="mt-1 text-t10h text-ink-muted">같은 범위에 다시 저장하면 그 줄을 바꿉니다(기록은 감사에 남습니다).</p>
        </section>
      ) : null}

      <section className="space-y-1 rounded-xl border border-line-soft bg-panel p-3" aria-label="제품별 결과">
        <h2 className="text-t13 font-semibold">제품별 결과</h2>
        {products.map((p) => (
          <CompetitorLine key={p.product_id} repo={repo} productId={p.product_id} label={p.name} />
        ))}
        <p className="text-t10h text-ink-muted">경쟁사 원가 = 오늘 시장가 원료비 + 경쟁사 제조 + 경쟁사 물류 · 예상 최소가 = 원가 ÷ (1 − 마진) · 우리 목표가 = 우리 총원가 ÷ 0.8.</p>
      </section>
    </div>
  )
}
