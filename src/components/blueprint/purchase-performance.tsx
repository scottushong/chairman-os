import { costEngineError } from '@/lib/costs/errors'
import { BLUEPRINT_OFF, blueprintErrorKey, kgText, PERF_BY_KO, won } from '@/lib/blueprint/format'
import { ALERT, TABLE_BOX, TD, TH } from '@/lib/blueprint/ui'
import type { ChairmanRepository } from '@/lib/repository/types'
import type { PerfBy, PurchasePerfRow } from '@/types'

/**
 * ② 구매 성과(0081 purchase_performance) — /purchasing/<회사>?tab=performance. KPI 셋 · 월별 표 · 원료별 표(구매 · 원가 관리 · 대표).
 * 금액은 DB가 원래 값끼리 더한 뒤 1원(구매 성과는 원가가 아니다). 시장가 · 기준 환율이 없으면 그 값은 «—»(0이 아니다).
 * 구매가 = 물건값(단가 × 환율, 부대비 제외) — 시장가도 물건값이라 같은 기준끼리 뺀다.
 */
export async function PurchasePerformance({
  repo,
  businessId,
  from,
  to,
  showMaterial,
  chairman,
}: {
  repo: ChairmanRepository
  businessId: string
  from: string
  to: string
  showMaterial: boolean
  chairman: boolean
}) {
  const load = async (by: PerfBy) => {
    try {
      return { rows: await repo.purchasePerformance(businessId, from, to, by), error: null as string | null }
    } catch (e) {
      console.error('[purchasing] purchase_performance', by, e instanceof Error ? e.message : String(e))
      const k = blueprintErrorKey(e)
      return { rows: [] as PurchasePerfRow[], error: k === 'off' ? BLUEPRINT_OFF : k === 'unavailable' ? '구매 성과는 준비 중입니다.' : costEngineError(e, chairman, '구매 성과를 불러오지 못했습니다.') }
    }
  }
  const [month, material] = await Promise.all([load('month'), showMaterial ? load('material') : Promise.resolve(null)])
  const sum = (f: (r: PurchasePerfRow) => number | null) => {
    const xs = month.rows.map(f).filter((x): x is number => x !== null)
    return xs.length ? xs.reduce((a, b) => a + b, 0) : null
  }
  const savings = sum((r) => r.savings_krw)
  const fx = sum((r) => r.fx_effect_krw)
  const noMarket = month.rows.reduce((t, r) => t + r.n_no_market, 0)
  const tone = (n: number | null) => (n === null ? 'text-ink-muted' : n > 0 ? 'text-ok' : n < 0 ? 'text-critical' : 'text-ink')

  return (
    <div className="mt-4 space-y-3">
      <p className="rounded-md border border-line-soft bg-raised px-3 py-2 text-t12 text-ink-dim">월별 손익에 구매이익을 따로 더하지 않습니다 — 이 화면은 구매가 시장가보다 얼마나 싸게 샀는지 보는 성적표입니다.</p>
      {month.error ? (
        <p role="alert" className={ALERT}>
          {month.error}
        </p>
      ) : null}
      <section className="grid gap-2 sm:grid-cols-3" aria-label="구매 성과 요약">
        {[
          { k: '절감액 합', v: savings === null ? '—' : `${won(savings)}원`, c: tone(savings), n: '(그날 시장가 − 구매가) × kg' },
          { k: '환율 효과 합', v: fx === null ? '—' : `${won(fx)}원`, c: tone(fx === null ? null : -fx), n: '(LOT 환율 − 입고월 평균 환율) × 외화 물건값 · + = 비싸게 바꿈' },
          { k: '시장가 없는 LOT', v: `${noMarket}건`, c: noMarket ? 'text-warning' : 'text-ink', n: '입고일 이전 시장가가 없어 절감액에서 빠짐' },
        ].map((x) => (
          <div key={x.k} className="rounded-xl border border-line-soft bg-panel p-3">
            <p className="text-t11 text-ink-muted">{x.k}</p>
            <p className={`text-t16 font-semibold tnum ${x.c}`}>{x.v}</p>
            <p className="text-t10h text-ink-muted">{x.n}</p>
          </div>
        ))}
      </section>
      <PerfTable title={`${PERF_BY_KO.month}별`} rows={month.rows} />
      {material ? (
        material.error ? (
          <p role="alert" className={ALERT}>
            {material.error}
          </p>
        ) : (
          <PerfTable title={`${PERF_BY_KO.material}별`} rows={material.rows} />
        )
      ) : null}
      <p className="text-t10h text-ink-muted">
        {from} ~ {to} 입고 · 무효 LOT 제외 · 금액은 원 단위(원래 값끼리 더한 뒤 반올림).
      </p>
    </div>
  )
}

function PerfTable({ title, rows }: { title: string; rows: PurchasePerfRow[] }) {
  return (
    <section className={TABLE_BOX} aria-label={`구매 성과 ${title}`}>
      <h2 className="px-3 pt-2 text-t13 font-semibold max-sm:px-0">{title}</h2>
      <table className="m-cards w-full text-t12 sm:min-w-[860px]">
        <thead>
          <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
            <th className={TH}>묶음</th>
            <th className={`${TH} text-right`}>LOT · kg</th>
            <th className={`${TH} text-right`}>구매가 합</th>
            <th className={`${TH} text-right`}>시장가 합</th>
            <th className={`${TH} text-right`}>절감액</th>
            <th className={`${TH} text-right`}>환율 효과</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                이 기간에 입고된 LOT가 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className="border-t border-line-soft">
                <td className={`${TD} font-semibold`} data-label="묶음">
                  {r.label}
                </td>
                <td className={`${TD} text-right tnum`} data-label="LOT · kg">
                  {r.n_lots}건 · {kgText(r.qty_kg)}
                  {r.n_no_market ? <span className="block text-t10h text-warning">시장가 없음 {r.n_no_market}건</span> : null}
                  {r.n_no_fx ? <span className="block text-t10h text-warning">기준 환율 없음 {r.n_no_fx}건</span> : null}
                  {r.suppressed ? <span className="block text-t10h text-ink-muted">LOT 3건 미만 — 금액 가림</span> : null}
                </td>
                <td className={`${TD} text-right tnum`} data-label="구매가 합">
                  {won(r.purchase_krw)}
                </td>
                <td className={`${TD} text-right tnum`} data-label="시장가 합">
                  {won(r.market_krw)}
                </td>
                <td className={`${TD} text-right tnum font-semibold`} data-label="절감액">
                  {won(r.savings_krw)}
                </td>
                <td className={`${TD} text-right tnum`} data-label="환율 효과">
                  {won(r.fx_effect_krw)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  )
}
