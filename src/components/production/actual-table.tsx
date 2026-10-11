'use client'

import { Fragment, useState } from 'react'

import { actualBreakdownAction } from '@/app/actions/production'
import { BTN } from '@/components/purchasing/shared'
import { kg3 } from '@/lib/costs/format'
import { krw } from '@/lib/sales/cost'
import type { ProdActualBreakdownRow, ProdActualRow } from '@/types'

/**
 * Actual 원가(0064 cost_prod_actual) — 생산 LOT마다 Σ(투입 kg × LOT landed) ÷ 산출 kg. 대표 = 원래 값(여기서 1원으로 그린다),
 * 원가 관리 = DB가 1원으로 준다. 투입 kg 합은 대표에게만 온다(0064 리뷰 C1 — 투입 ÷ 산출 = 수율).
 * 대표만 분해(cost_prod_actual_breakdown): 원료마다 실제 투입 kg vs 작업지시 kg(오더 전체) · 금액. 금액끼리의 합은 원래 값으로 더한다.
 */
export function ActualTable({ rows, chairman, error }: { rows: ProdActualRow[]; chairman: boolean; error?: string | null }) {
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, ProdActualBreakdownRow[] | string>>({})

  async function toggle(id: string) {
    if (open === id) {
      setOpen(null)
      return
    }
    setOpen(id)
    if (!detail[id]) {
      const r = await actualBreakdownAction(id)
      setDetail((d) => ({ ...d, [id]: r.error ?? r.rows ?? [] }))
    }
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3 max-sm:border-0 max-sm:bg-transparent max-sm:p-0" aria-label="Actual 원가">
      <h2 className="text-t12h font-semibold">Actual 원가 — 생산 LOT별 실제 원료비</h2>
      <p className="mt-0.5 text-t10h text-ink-muted">실제로 쓴 구매 LOT의 Landed 단가 × 투입 kg ÷ 산출 kg. 투입이 없는 생산 LOT는 계산하지 않습니다.</p>
      {error ? (
        <p role="alert" className="mt-2 text-t12 text-critical">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-t12 text-ink-muted">생산 LOT가 없습니다.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="m-cards w-full text-t12 sm:min-w-[760px]">
            <thead>
              <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                <th className="px-2 py-2 font-normal">생산 LOT</th>
                <th className="px-2 py-2 font-normal">생산일</th>
                <th className="px-2 py-2 text-right font-normal">산출 kg</th>
                {chairman ? <th className="px-2 py-2 text-right font-normal">투입 kg</th> : null}
                <th className="px-2 py-2 text-right font-normal">Actual 원/kg</th>
                {chairman ? (
                  <th className="px-2 py-2 font-normal">
                    <span className="sr-only">분해</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = detail[r.prod_lot_id]
                return (
                  <Fragment key={r.prod_lot_id}>
                    <tr className="border-t border-line-soft">
                      <td className="px-2 py-1.5 max-sm:font-semibold">
                        <span>
                          {r.product_name}
                          <span className="block text-t10h font-normal text-ink-muted tnum">{r.prod_lot_id}</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5 tnum" data-label="생산일">
                        {r.produced_on}
                      </td>
                      <td className="px-2 py-1.5 text-right tnum" data-label="산출 kg">
                        {kg3(r.output_kg)}
                      </td>
                      {chairman ? (
                        <td className="px-2 py-1.5 text-right tnum text-ink-dim" data-label="투입 kg">
                          {kg3(r.input_kg)}
                        </td>
                      ) : null}
                      <td className="px-2 py-1.5 text-right tnum font-semibold" data-label="Actual 원/kg">
                        {r.computed ? `${krw(r.actual_krw_per_kg)}원/kg` : <span className="font-normal text-ink-muted">투입 기록 전</span>}
                      </td>
                      {chairman ? (
                        <td className="px-2 py-1.5 text-right">
                          {r.computed ? (
                            <button type="button" className={BTN} aria-expanded={open === r.prod_lot_id} onClick={() => void toggle(r.prod_lot_id)}>
                              {open === r.prod_lot_id ? '접기' : '분해'}
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                    {chairman && open === r.prod_lot_id ? (
                      <tr className="border-t border-line-soft bg-raised/40">
                        <td colSpan={6} className="px-3 py-2">
                          {d === undefined ? (
                            <p className="text-t11 text-ink-muted">불러오는 중…</p>
                          ) : typeof d === 'string' ? (
                            <p className="text-t11 text-critical">{d}</p>
                          ) : (
                            <Breakdown rows={d} />
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** 원료마다 묶는다 — 실제 kg(LOT 합) vs 작업지시 kg · 금액(원래 값 합을 1원으로). */
function Breakdown({ rows }: { rows: ProdActualBreakdownRow[] }) {
  const by = new Map<string, { name: string; kg: number; amount: number; planned: number | null; lots: string[] }>()
  for (const r of rows) {
    const cur = by.get(r.material_id) ?? { name: r.material_name, kg: 0, amount: 0, planned: r.planned_kg, lots: [] }
    cur.kg += r.qty_kg
    cur.amount += r.amount_krw
    cur.lots.push(`${r.lot_id} ${kg3(r.qty_kg)}kg × ${krw(r.landed_krw_per_kg)}원`)
    by.set(r.material_id, cur)
  }
  if (by.size === 0) return <p className="text-t11 text-ink-muted">투입이 없습니다.</p>
  return (
    <table className="w-full text-t11">
      <thead>
        <tr className="text-left text-t10h text-ink-muted">
          <th className="py-1 font-normal">원료</th>
          <th className="py-1 text-right font-normal">실제 투입 kg</th>
          <th className="py-1 text-right font-normal">작업지시 kg (오더 전체)</th>
          <th className="py-1 text-right font-normal">금액(원)</th>
        </tr>
      </thead>
      <tbody>
        {[...by.entries()].map(([id, m]) => (
          <tr key={id} className="border-t border-line-soft align-top">
            <td className="py-1">
              {m.name}
              <span className="block text-t10h text-ink-muted">{m.lots.join(' · ')}</span>
            </td>
            <td className="py-1 text-right tnum font-semibold">{kg3(m.kg)}</td>
            <td className="py-1 text-right tnum text-ink-dim">{m.planned === null ? '작업지시에 없음' : kg3(m.planned)}</td>
            <td className="py-1 text-right tnum">{krw(m.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
