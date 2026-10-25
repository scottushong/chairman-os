/**
 * 5Y Value Forecast — 기본 시나리오의 연도별 추정 가치(FCF/주 × (1+g)^t × 미래 배수)와 매수 기준가 선.
 * 손으로 그린 SVG · 글자는 HTML(폰 13px). 숫자는 lib/investment/valuation.ts와 같은 공식 — 예측이 맞다고 입증하는 그림이 아니다.
 */
export function ForecastChart({ points, buyPrice, currency = 'USD' }: { points: { year: number; value: number }[]; buyPrice: number; currency?: string }) {
  if (points.length < 2) return null
  const W = 600
  const H = 200
  const max = Math.max(buyPrice, ...points.map((p) => p.value)) * 1.08
  const x = (i: number) => (i / (points.length - 1)) * W
  const y = (v: number) => H - (v / max) * H
  const money = (v: number) => (currency === 'USD' ? `$${v.toFixed(0)}` : `${v.toFixed(0)} ${currency}`)
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div className="flex h-[180px] flex-col justify-between text-right text-[13px] text-ink-muted tnum sm:h-[200px]">
          <span>{money(max)}</span>
          <span>{money(max / 2)}</span>
          <span>0</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[180px] w-full sm:h-[200px]" role="img" aria-label="5년 가치 전망">
          <line x1={0} x2={W} y1={y(buyPrice)} y2={y(buyPrice)} stroke="#1f9d55" strokeDasharray="6 5" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <path d={points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join('')} fill="none" stroke="#3b74d6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {points.map((p, i) => <circle key={p.year} cx={x(i)} cy={y(p.value)} r={4} fill="#3b74d6" />)}
        </svg>
      </div>
      <div className="flex justify-between pl-10 text-[13px] text-ink-muted tnum">
        {points.map((p) => <span key={p.year}>{p.year}</span>)}
      </div>
      <p className="text-[13px] text-ink-muted"><span className="mr-1 inline-block h-0.5 w-4 bg-[#3b74d6] align-middle" />추정 가치(Base) · <span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-[#1f9d55] align-middle" />매수 기준가 {money(buyPrice)}</p>
    </div>
  )
}
