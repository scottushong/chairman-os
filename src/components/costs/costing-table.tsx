import Link from 'next/link'

import { ALLOC_PENDING_NOTE } from '@/lib/costs/format'
import { krw } from '@/lib/sales/cost'
import type { CostingRow, ForecastRow } from '@/types'

/**
 * 제품 원가 표(0065 cost_costing_list) — Market · DY 원가(Current) · 제조 · 포장 · 물류 · 간접비 · 총원가(Fully Loaded).
 * 전부 원/kg · 1원 표시(krw). 대표는 원래 값을 받아 여기서 1원으로 그리고, 원가 관리는 DB가 1원으로 준다 — **표시값끼리 더하지 않는다**
 * (총원가는 DB가 원래 값끼리 더한 값).
 * 0081: forecast가 오면(스위치 cost_forecast) «Forecast» 칸(총원가 · 원료비), productHref가 오면 제품 이름이 제품 진단 링크.
 */

function Tag({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'warn' }) {
  const cls = tone === 'warn' ? 'border-warning/40 bg-warning/10 text-warning' : 'border-line bg-raised text-ink-dim'
  return <span className={`ml-1.5 inline-flex rounded border px-1 text-t9h ${cls}`}>{text}</span>
}

const FORECAST_NOTE: Record<string, string> = { no_bom: 'BOM 없음', price_missing: '단가 없는 원료', overhead_not_ready: '비용 배부 전', not_computed: '계산 전' }

export function CostingTable({
  rows,
  forecast = null,
  productHref = null,
}: {
  rows: CostingRow[]
  forecast?: Map<string, ForecastRow> | null
  productHref?: ((productId: string) => string) | null
}) {
  return (
    <section className="overflow-x-auto rounded-xl border border-line-soft bg-panel max-sm:border-0 max-sm:bg-transparent" aria-label="제품 원가">
      <table className="m-cards w-full text-t12 sm:min-w-[1000px]">
        <thead>
          <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
            <th className="px-3 py-2 font-normal">제품</th>
            <th className="px-3 py-2 text-right font-normal">Market</th>
            <th className="px-3 py-2 text-right font-normal">DY 원가 (Current)</th>
            <th className="px-3 py-2 text-right font-normal">제조</th>
            <th className="px-3 py-2 text-right font-normal">포장</th>
            <th className="px-3 py-2 text-right font-normal">물류</th>
            <th className="px-3 py-2 text-right font-normal">간접비</th>
            <th className="px-3 py-2 text-right font-normal">총원가</th>
            {forecast ? <th className="px-3 py-2 text-right font-normal">Forecast</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pending = !r.computed && r.current_krw_per_kg !== null
            return (
              <tr key={r.product_id} className="border-t border-line-soft align-top">
                <td className="px-3 py-2 font-semibold">
                  <span>
                    {productHref ? (
                      <Link href={productHref(r.product_id)} className="text-accent hover:underline">
                        {r.product_name}
                      </Link>
                    ) : (
                      r.product_name
                    )}
                    {r.overhead_basis === 'plan' && r.overhead_ready ? <Tag text="계획 기준" /> : null}
                    {!r.overhead_ready && !pending ? <Tag text="비용 준비 전" /> : null}
                  </span>
                </td>
                {r.current_krw_per_kg === null ? (
                  <td colSpan={forecast ? 8 : 7} className="px-3 py-2 text-ink-muted" data-label="원가">
                    아직 원가 계산 전입니다 — BOM · 구매 기록이 모이면 계산됩니다.
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2 text-right tnum" data-label="Market">
                      {krw(r.market_krw_per_kg)}
                    </td>
                    <td className="px-3 py-2 text-right tnum" data-label="DY 원가(Current)">
                      {krw(r.current_krw_per_kg)}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-ink-dim" data-label="제조">
                      {krw(r.mfg_krw_per_kg)}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-ink-dim" data-label="포장">
                      {krw(r.pack_krw_per_kg)}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-ink-dim" data-label="물류">
                      {krw(r.logi_krw_per_kg)}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-ink-dim" data-label="간접비">
                      {krw(r.indirect_krw_per_kg)}
                    </td>
                    <td className="px-3 py-2 text-right tnum font-semibold" data-label="총원가">
                      {pending ? <span className="text-t11 font-normal text-warning">{ALLOC_PENDING_NOTE}</span> : `${krw(r.total_krw_per_kg)}원/kg`}
                    </td>
                    {forecast ? <ForecastCell f={forecast.get(r.product_id) ?? null} /> : null}
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function ForecastCell({ f }: { f: ForecastRow | null }) {
  return (
    <td className="px-3 py-2 text-right tnum" data-label="Forecast">
      {f && f.computed ? (
        <span>
          {krw(f.forecast_total_krw_per_kg)}원/kg
          <span className="block text-t10h text-ink-muted">원료 {krw(f.forecast_material_krw_per_kg)}</span>
        </span>
      ) : (
        <span className="text-t11 text-ink-muted">{f?.reason ? (FORECAST_NOTE[f.reason] ?? '계산 전') : '—'}</span>
      )}
    </td>
  )
}
