import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { BASIS_KO, BASIS_NOTE, BLUEPRINT_OFF, blueprintErrorKey, kgText, pct1, won } from '@/lib/blueprint/format'
import { openBlueprint } from '@/lib/blueprint/page'
import { lastDays, pickRange } from '@/lib/blueprint/period'
import { ALERT, FIELD, LABEL, TABLE_BOX, TD, TH } from '@/lib/blueprint/ui'
import { kstToday } from '@/lib/chairman-project'
import { costEngineError } from '@/lib/costs/errors'
import { featureOn } from '@/lib/features-server'
import type { CustomerProfitRow, ProfitWatchRow } from '@/types'

/**
 * ③ 고객별 수익성(0081 customer_profit · customer_profit_watch). 스위치 'customer_profit'(기본 대표만)가 꺼지면 404.
 * 문: 대표 · 원가 관리 줄 · 영업 줄(재무 화면 문은 장부 권한이라 원가 관리 · 영업을 막는다 — openBlueprint). 진짜 판정은 DB.
 *   대표 · 원가 관리 = 고객별 매출 · 매출원가 · GM · 등급 · 원가 근거 + «매출 큰데 마진 낮은» 상위 10(문 두 번 — 하루 20번 안).
 *   영업 = 본인 판매의 고객별 매출 · kg · 등급만(원가 칸은 DB가 비워 준다).
 * 판매 한 줄 원가는 0067 그대로(실제 = 생산 LOT Actual, 추정 = 출고일 Current) — 0075 월 매출원가와 섞지 않는다.
 */
export default async function CustomersPage(props: PageProps<'/finance/[business_id]/customers'>) {
  const { business_id } = await props.params
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const { repo, user, business } = await openBlueprint(business_id, ['costing', 'sales'])
  if (!(await featureOn(user, 'customer_profit', business_id))) notFound()
  await recordScreenRead({ path: `/finance/${business_id}/customers`, kind: 'page', business_id })
  const chairman = user.role === 'Chairman'
  const full = chairman || !!user.cost?.costing?.[business_id]
  const { from, to } = pickRange(one(sp.from), one(sp.to), lastDays(kstToday(), 90))

  const fail = (e: unknown, msg: string) => {
    const k = blueprintErrorKey(e)
    return k === 'off' ? BLUEPRINT_OFF : k === 'unavailable' ? '고객별 수익성은 준비 중입니다.' : costEngineError(e, chairman, msg)
  }
  let rows: CustomerProfitRow[] = []
  let watch: ProfitWatchRow[] = []
  let error: string | null = null
  try {
    rows = await repo.customerProfit(business_id, from, to)
    if (full) watch = await repo.customerProfitWatch(business_id, from, to)
  } catch (e) {
    console.error('[customers] customer_profit', e instanceof Error ? e.message : String(e))
    error = fail(e, '고객별 수익성을 불러오지 못했습니다.')
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader
        icon="layers"
        title={`${business.name} 고객별 수익성`}
        code="FIN-C1"
        description={full ? `${chairman ? '원래 값' : '1원 단위'} · 판매 한 줄 실제 원가 · 화면을 열 때마다 기록` : '내 판매의 고객별 매출 · kg · 등급'}
      />
      <form className="flex flex-wrap items-end gap-2 text-t12" method="get">
        <label className={LABEL}>
          출고일 시작
          <input type="date" name="from" defaultValue={from} className={FIELD} />
        </label>
        <label className={LABEL}>
          끝
          <input type="date" name="to" defaultValue={to} className={FIELD} />
        </label>
        <button type="submit" className="min-h-11 rounded-md border border-line bg-panel px-3 hover:border-accent lg:min-h-0 lg:py-1">
          보기
        </button>
      </form>
      {error ? (
        <p role="alert" className={ALERT}>
          {error}
        </p>
      ) : null}

      <section className={TABLE_BOX} aria-label="고객별 표">
        <table className="m-cards w-full text-t12 sm:min-w-[960px]">
          <thead>
            <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
              <th className={TH}>고객</th>
              <th className={`${TH} text-right`}>건 · kg</th>
              <th className={`${TH} text-right`}>매출(원)</th>
              {full ? <th className={`${TH} text-right`}>매출원가(원)</th> : null}
              {full ? <th className={`${TH} text-right`}>GM</th> : null}
              <th className={TH}>등급</th>
              {full ? <th className={TH}>원가 근거</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={full ? 7 : 4} className="px-3 py-6 text-center text-ink-muted">
                  이 기간에 판매가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.customer} className="border-t border-line-soft">
                  <td className={`${TD} font-semibold`} data-label="고객">
                    {r.customer}
                  </td>
                  <td className={`${TD} text-right tnum`} data-label="건 · kg">
                    {r.n_sales}건 · {kgText(r.kg)}
                  </td>
                  <td className={`${TD} text-right tnum`} data-label="매출">
                    {won(r.revenue_krw)}
                  </td>
                  {full ? (
                    <td className={`${TD} text-right tnum`} data-label="매출원가">
                      {won(r.cogs_krw)}
                    </td>
                  ) : null}
                  {full ? (
                    <td className={`${TD} text-right tnum`} data-label="GM">
                      {won(r.gm_krw)} <span className="text-ink-muted">({pct1(r.gm_pct)})</span>
                    </td>
                  ) : null}
                  <td className={TD} data-label="등급">
                    {r.grade ?? '—'}
                  </td>
                  {full ? (
                    <td className={TD} data-label="원가 근거" title={r.basis ? BASIS_NOTE[r.basis] : undefined}>
                      {r.basis ? BASIS_KO[r.basis] : '—'}
                      {r.n_uncomputed ? <span className="block text-t10h text-ink-muted">계산 불가 {r.n_uncomputed}건</span> : null}
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {full ? (
        <>
          <ul className="list-disc space-y-1 pl-5 text-t11 text-ink-muted">
            {(['actual', 'estimated', 'mixed', 'uncomputed'] as const).map((b) => (
              <li key={b}>
                {BASIS_KO[b]}: {BASIS_NOTE[b]}.
              </li>
            ))}
            <li>매출원가 · GM은 원가를 계산한 판매만 더합니다. 월별 손익(재고 반영)의 매출원가와는 다른 값입니다.</li>
          </ul>
          <section className={TABLE_BOX} aria-label="매출 큰데 마진 낮은 고객 · 제품">
            <h2 className="px-3 pt-2 text-t13 font-semibold max-sm:px-0">매출 큰데 마진 낮은 고객 · 제품 (상위 10)</h2>
            <table className="m-cards w-full text-t12 sm:min-w-[640px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                  <th className={TH}>구분</th>
                  <th className={TH}>이름</th>
                  <th className={`${TH} text-right`}>매출(원)</th>
                  <th className={`${TH} text-right`}>GM%</th>
                  <th className={TH}>등급</th>
                </tr>
              </thead>
              <tbody>
                {watch.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-ink-muted">
                      해당 없음 — 매출 상위 절반 중 마진을 계산한 것이 없습니다.
                    </td>
                  </tr>
                ) : (
                  watch.map((w) => (
                    <tr key={`${w.kind}|${w.key}`} className="border-t border-line-soft">
                      <td className={TD} data-label="구분">
                        {w.kind === 'customer' ? '고객' : '제품'}
                      </td>
                      <td className={`${TD} font-semibold`} data-label="이름">
                        {w.kind === 'product' ? (
                          <Link href={`/costs/${encodeURIComponent(business_id)}/products/${encodeURIComponent(w.key)}`} className="text-accent hover:underline">
                            {w.label}
                          </Link>
                        ) : (
                          w.label
                        )}
                      </td>
                      <td className={`${TD} text-right tnum`} data-label="매출">
                        {won(w.revenue_krw)}
                      </td>
                      <td className={`${TD} text-right tnum`} data-label="GM%">
                        {pct1(w.gm_pct)}
                      </td>
                      <td className={TD} data-label="등급">
                        {w.grade ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <p className="text-t11 text-ink-muted">내가 기록한 판매만 보입니다. 등급은 가장 최근 판매를 기록한 순간의 등급입니다.</p>
      )}
    </div>
  )
}
