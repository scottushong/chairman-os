'use client'

import { useMemo, useState } from 'react'

import { valuate, validateInput, type ValuationInput } from '@/lib/investment/valuation'

/**
 * Valuation Simulator(원문 8.4) — 현재 FCF/주 · 성장률 · 미래 배수 · 기간 · 요구수익률 · 안전마진 · 현재 주가를 바꾸면 즉시 다시 계산.
 * 계산은 lib/investment/valuation.ts 하나(서버 · 화면 · 검사가 같은 함수). 기본값은 원문 8.3 예시(DEMO) 또는 종목 값.
 * 상태 글은 «가격만 본» 구간이다 — BUY ZONE 판정은 검증 조건을 더 본다(Recommendations).
 */

export interface SimulatorProps {
  initial: ValuationInput
  /** 'demo' = 원문 8.3 예시(DEMO 띠) · 그 밖 = 종목 이름 */
  label: string
  demo: boolean
  currency?: string
}

const FIELDS: { key: keyof ValuationInput; label: string; min: number; max: number; step: number; pct?: boolean; money?: boolean; int?: boolean }[] = [
  { key: 'price', label: '현재 주가', min: 1, max: 2000, step: 0.5, money: true },
  { key: 'fcfPerShare', label: '현재 FCF per Share', min: 0.1, max: 200, step: 0.1, money: true },
  { key: 'fcfCagr', label: '예상 FCF 성장률(연)', min: -0.2, max: 0.5, step: 0.005, pct: true },
  { key: 'exitMultiple', label: '미래 P/FCF 배수', min: 5, max: 60, step: 0.5 },
  { key: 'years', label: '투자 기간(년)', min: 1, max: 15, step: 1, int: true },
  { key: 'requiredReturn', label: '요구 수익률(연)', min: 0.04, max: 0.3, step: 0.005, pct: true },
  { key: 'marginOfSafety', label: '안전마진', min: 0, max: 0.6, step: 0.01, pct: true },
]

export function ValuationSimulator({ initial, label, demo, currency = 'USD' }: SimulatorProps) {
  const [v, setV] = useState<ValuationInput>(initial)
  const err = validateInput(v)
  const r = useMemo(() => (err ? null : valuate(v)), [v, err])
  const money = (n: number) => `${currency === 'USD' ? '$' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency === 'USD' ? '' : ` ${currency}`}`
  const show = (f: (typeof FIELDS)[number], n: number) => (f.pct ? `${(n * 100).toFixed(1)}%` : f.money ? money(n) : f.int ? `${n}년` : `${n.toFixed(1)}x`)
  const zone = r ? (r.priceZone === 'BELOW_BUY' ? '매수 기준가 이하(가격 조건만 — BUY는 검증 조건 별도)' : r.priceZone === 'WATCH' ? 'WATCH — 현재가치 아래, 안전마진 밖' : 'OVERVALUED — 현재가치 위') : '—'

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-muted">{demo ? 'DEMO — 원문 8.3 예시 입력' : label}</p>
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-[14px] text-ink">
              <span>{f.label}</span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  className="min-h-11 w-28 rounded-lg border border-line-soft bg-panel px-2 text-right text-[14px] tnum lg:min-h-8"
                  step={f.pct ? 0.1 : f.step}
                  value={f.pct ? Number((v[f.key] * 100).toFixed(2)) : v[f.key]}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n)) setV((x) => ({ ...x, [f.key]: f.pct ? n / 100 : f.int ? Math.round(n) : n }))
                  }}
                  aria-label={f.label}
                />
                <span className="w-6 text-[13px] text-ink-muted">{f.pct ? '%' : ''}</span>
              </span>
            </span>
            <input
              type="range"
              min={f.min}
              max={f.max}
              step={f.step}
              value={Math.min(f.max, Math.max(f.min, v[f.key]))}
              onChange={(e) => setV((x) => ({ ...x, [f.key]: f.int ? Math.round(Number(e.target.value)) : Number(e.target.value) }))}
              className="h-11 w-full accent-[#b8862b] lg:h-6"
              aria-label={`${f.label} 슬라이더`}
            />
            <span className="text-[13px] text-ink-muted">{show(f, v[f.key])}</span>
          </label>
        ))}
        <button type="button" onClick={() => setV(initial)} className="inline-flex min-h-11 w-fit items-center rounded-lg border border-line-soft px-3 text-[13px] text-ink-dim lg:min-h-9">
          처음 값으로
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {err ? (
          <p className="rounded-lg border border-critical/40 px-3 py-2 text-[14px] text-critical">{err}</p>
        ) : r ? (
          <>
            <dl className="grid grid-cols-2 gap-2">
              {[
                ['5년 뒤 FCF/주', money(r.futureFcfPerShare)],
                [`${v.years}년 뒤 예상 주가`, money(r.futurePrice)],
                ['현재 가치(PV)', money(r.presentValue)],
                ['매수 기준가(Buy Price)', money(r.buyPrice)],
                ['현재 주가', money(v.price)],
                ['기준가 대비', `${r.gapToBuyPct >= 0 ? '+' : ''}${r.gapToBuyPct.toFixed(2)}%`],
                [`${v.years}년 예상 수익률`, `${r.upsidePct.toFixed(1)}%`],
                ['연복리 수익률', `${r.expectedCagrPct.toFixed(2)}%`],
              ].map(([k, val]) => (
                <div key={k} className="rounded-lg border border-line-soft px-3 py-2">
                  <dt className="text-[13px] text-ink-muted">{k}</dt>
                  <dd className="text-[18px] font-bold tnum">{val}</dd>
                </div>
              ))}
            </dl>
            <p className={`rounded-lg px-3 py-2 text-[14px] font-semibold ${r.priceZone === 'BELOW_BUY' ? 'bg-ok/12 text-ok' : r.priceZone === 'WATCH' ? 'bg-warning/12 text-warning' : 'bg-critical/10 text-critical'}`}>Status: {zone}</p>
            <ol className="list-decimal pl-5 text-[13px] text-ink-muted">
              <li>Future FCF/주 = {money(v.fcfPerShare)} × (1 + {(v.fcfCagr * 100).toFixed(1)}%)^{v.years} = {money(r.futureFcfPerShare)}</li>
              <li>Future Price = {money(r.futureFcfPerShare)} × {v.exitMultiple}배 = {money(r.futurePrice)}</li>
              <li>Present Value = {money(r.futurePrice)} ÷ (1 + {(v.requiredReturn * 100).toFixed(1)}%)^{v.years} = {money(r.presentValue)}</li>
              <li>Buy Price = {money(r.presentValue)} × (1 − {(v.marginOfSafety * 100).toFixed(0)}%) = {money(r.buyPrice)}</li>
            </ol>
            <p className="text-[13px] text-ink-muted">배당 · 증자/희석 · 세금 · 환율은 생략한 단순 모델입니다(원문 8.3).</p>
          </>
        ) : null}
      </div>
    </div>
  )
}
