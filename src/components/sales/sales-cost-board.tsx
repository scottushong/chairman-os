'use client'

import { Fragment, useState, useTransition } from 'react'

import { checkPriceAction } from '@/app/actions/sales'
import { Alert, BTN, BTN_PRIMARY } from '@/components/purchasing/shared'
import { NumberInput } from '@/components/ui/number-input'
import { GRADE_CLASS, GRADE_LABEL, impactText, krw, RED_NOTICE } from '@/lib/sales/cost'
import type { CostGrade, PriceCheck, SalesCostRow } from '@/types'

/**
 * 영업 원가 표(회장 결정 2026-10-09 «영업은 제품 총액만»). 제품마다 Market · DY 원가 · 원가 우위 · 총원가 · 원료비 영향,
 * 펼치면 제시가 확인(0062 cost_price_check)과 목표 마진별 제시가. **원료는 이 화면 어디에도 없다** — 받는 값이 제품 총액뿐이다.
 */

export function GradeBadge({ grade }: { grade: CostGrade }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-t11h font-semibold ${GRADE_CLASS[grade]}`}>
      {GRADE_LABEL[grade]}
    </span>
  )
}

const advClass = (v: number | null) => (v === null ? 'text-ink-muted' : v > 0 ? 'text-ok' : v < 0 ? 'text-critical' : 'text-ink')

export function SalesCostBoard({ rows }: { rows: SalesCostRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="overflow-x-auto rounded-xl border border-line-soft bg-panel max-sm:border-0 max-sm:bg-transparent" aria-label="제품별 원가">
      <table className="m-cards w-full text-t12 sm:min-w-[900px]">
        <thead>
          <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
            <th className="px-3 py-2 font-normal">제품</th>
            <th className="px-3 py-2 text-right font-normal">Market 원가</th>
            <th className="px-3 py-2 text-right font-normal">DY 원가 (Current)</th>
            <th className="px-3 py-2 text-right font-normal">원가 우위</th>
            <th className="px-3 py-2 text-right font-normal">총원가</th>
            <th className="px-3 py-2 text-right font-normal">원료비 영향 (지난 주 대비)</th>
            <th className="px-3 py-2 font-normal">
              <span className="sr-only">제시가</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.product_id}>
              <tr className="border-t border-line-soft align-top">
                <td className="px-3 py-2 font-semibold">{r.product_name}</td>
                {r.computed ? (
                  <>
                    <td className="px-3 py-2 text-right tnum" data-label="Market 원가">
                      {krw(r.market_krw_per_kg)}원/kg
                    </td>
                    <td className="px-3 py-2 text-right tnum" data-label="DY 원가(Current)">
                      {krw(r.current_krw_per_kg)}원/kg
                    </td>
                    <td className={`px-3 py-2 text-right tnum font-semibold ${advClass(r.advantage_krw_per_kg)}`} data-label="원가 우위">
                      {r.advantage_krw_per_kg !== null && r.advantage_krw_per_kg > 0 ? '+' : ''}
                      {krw(r.advantage_krw_per_kg)}원/kg
                    </td>
                    <td className="px-3 py-2 text-right tnum font-semibold" data-label="총원가">
                      {krw(r.total_krw_per_kg)}원/kg
                    </td>
                    <td className="px-3 py-2 text-right tnum" data-label="원료비 영향">
                      {impactText(r.material_impact_pct) ?? <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className={BTN}
                        aria-expanded={open === r.product_id}
                        onClick={() => setOpen(open === r.product_id ? null : r.product_id)}
                      >
                        {open === r.product_id ? '접기' : '제시가 · 마진'}
                      </button>
                    </td>
                  </>
                ) : (
                  <td colSpan={6} className="px-3 py-2 text-ink-muted" data-label="원가">
                    이번 주 원가 계산 전입니다 — 구매 기록이 모이면 계산됩니다.
                  </td>
                )}
              </tr>
              {open === r.product_id && r.computed ? (
                <tr className="border-t border-line-soft bg-raised/40">
                  <td colSpan={7} className="px-3 py-3">
                    <PriceDetail row={r} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function PriceDetail({ row }: { row: SalesCostRow }) {
  const [price, setPrice] = useState('')
  const [result, setResult] = useState<PriceCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function check() {
    setError(null)
    start(async () => {
      const r = await checkPriceAction({ productId: row.product_id, price })
      if (r.error) {
        setResult(null)
        setError(r.error)
      } else setResult(r.result ?? null)
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          check()
        }}
      >
        <label className="block text-t11h text-ink-dim" htmlFor={`price-${row.product_id}`}>
          제시가(원/kg) — 넣으면 총원가 {krw(row.total_krw_per_kg)}원/kg 대비 마진과 등급
        </label>
        <div className="flex items-start gap-2">
          <div className="w-48 max-sm:flex-1">
            <NumberInput
              id={`price-${row.product_id}`}
              kind="money"
              unit="원"
              reading={false}
              value={price}
              onChange={(v) => {
                setPrice(v)
                setResult(null)
              }}
              className="w-full rounded border border-line bg-panel px-2 py-1 text-t13 text-ink outline-none focus:border-accent max-lg:min-h-11"
              placeholder="예: 3,500"
            />
          </div>
          <button type="submit" className={BTN_PRIMARY} disabled={pending || !price}>
            {pending ? '확인 중…' : '확인'}
          </button>
        </div>
        <Alert text={error} />
        {result && result.grade && result.margin_krw_per_kg !== null && result.margin_pct !== null ? (
          <div className="space-y-2 rounded-lg border border-line-soft bg-panel px-3 py-2">
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-t13">
              <span>
                마진 <b className="tnum">{krw(result.margin_krw_per_kg)}원/kg</b>
              </span>
              <span>
                <b className="tnum">{result.margin_pct.toFixed(1)}%</b>
              </span>
              <GradeBadge grade={result.grade} />
            </p>
            {result.grade === 'red' ? <p className="text-t12 font-semibold text-critical">{RED_NOTICE}</p> : null}
          </div>
        ) : result ? (
          <p className="text-t12 text-ink-muted">이번 주 원가 계산 전이라 마진을 낼 수 없습니다.</p>
        ) : null}
        <p className="text-t10h text-ink-muted">마진 % = (제시가 − 총원가) ÷ 제시가. 20% 이상 Green · 15~20% Yellow · 15% 미만 Red.</p>
      </form>

      <div>
        <p className="mb-1 text-t11h text-ink-dim">목표 마진별 제시가</p>
        <table className="w-full text-t12">
          <thead>
            <tr className="text-left text-t10h text-ink-muted">
              <th className="py-1 font-normal">목표 마진</th>
              <th className="py-1 text-right font-normal">제시가(원/kg)</th>
              <th className="py-1 text-right font-normal">등급</th>
            </tr>
          </thead>
          <tbody>
            {row.offers.map((o) => (
              <tr key={o.margin_pct} className="border-t border-line-soft">
                <td className="py-1.5 tnum">{o.margin_pct}%</td>
                <td className="py-1.5 text-right tnum font-semibold">{krw(o.price_krw_per_kg)}</td>
                <td className="py-1.5 text-right">
                  <GradeBadge grade={o.grade} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
