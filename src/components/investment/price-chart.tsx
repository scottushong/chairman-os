'use client'

import { useMemo, useState } from 'react'

/**
 * Stock & ETF 360 가격 그래프(원문 5.1) — 손으로 그린 SVG(앱에 차트 라이브러리 없음 · metric-trend-chart.tsx와 같은 방식).
 * 글자(축 · 범례 · 툴팁)는 SVG 밖 HTML이다 — 폰에서 SVG 글자가 작아지지 않게(check:mobile 13px).
 *
 * 가격 출처가 둘이다: 일별(Twelve Data — 키가 있을 때) · 13F 분기말 파생(평가액 ÷ 주식 수). 일별이 없으면 분기말 점만 잇고
 * 그 사실을 범례에 적는다 — 없는 날을 꾸며 채우지 않는다. 겹쳐 보기 중 자료가 없는 것은 단추를 끄고 이유를 붙인다.
 */

export interface ChartPoint {
  d: string
  close: number
  adj: number | null
  volume: number | null
}

export interface ChartEvent {
  d: string
  kind: 'earnings' | 'split' | 'dividend'
  label: string
}

export interface PriceChartProps {
  daily: ChartPoint[]
  quarterly: ChartPoint[]
  benchmark: { ticker: string; points: ChartPoint[] } | null
  /** USD→KRW(ECB) 날짜순 */
  fx: { d: string; v: number }[]
  /** 기관 보유 주식 수 합(13F 네 곳) — 기준일별 */
  institutional: { d: string; shares: number }[]
  events: ChartEvent[]
  /** 가치평가(2단계) — 없으면 null */
  fairValue: { low: number; high: number } | null
  buyBelow: number | null
  currency: string
}

const PERIODS = [
  { key: '1D', days: 1 },
  { key: '1W', days: 7 },
  { key: '1M', days: 31 },
  { key: '3M', days: 92 },
  { key: '6M', days: 183 },
  { key: '1Y', days: 366 },
  { key: '3Y', days: 366 * 3 },
  { key: '5Y', days: 366 * 5 },
  { key: 'ALL', days: 0 },
] as const
type PeriodKey = (typeof PERIODS)[number]['key']

const W = 800
const H = 300
const PLOT_H = 230 // 아래 70은 거래량 · 기관 보유 막대

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`)

function movingAverage(points: ChartPoint[], n: number) {
  const out: { d: string; v: number }[] = []
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    sum += points[i].close
    if (i >= n) sum -= points[i - n].close
    if (i >= n - 1) out.push({ d: points[i].d, v: sum / n })
  }
  return out
}

export function PriceChart(props: PriceChartProps) {
  const hasDaily = props.daily.length > 1
  const base = hasDaily ? props.daily : props.quarterly
  const [period, setPeriod] = useState<PeriodKey>(hasDaily ? '1Y' : 'ALL')
  const [ccy, setCcy] = useState<'USD' | 'KRW'>('USD')
  const [show, setShow] = useState({ volume: true, ma: true, bench: false, inst: true, events: true, value: true, total: false })
  const [hover, setHover] = useState<number | null>(null)

  const fxAt = useMemo(() => {
    const xs = props.fx
    return (d: string) => {
      let lo = 0
      let hi = xs.length - 1
      let best: number | null = null
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (xs[mid].d <= d) {
          best = xs[mid].v
          lo = mid + 1
        } else hi = mid - 1
      }
      return best
    }
  }, [props.fx])

  const view = useMemo(() => {
    if (base.length === 0) return null
    const last = base[base.length - 1].d
    const p = PERIODS.find((x) => x.key === period)!
    const from = p.days === 0 ? base[0].d : new Date(ms(last) - p.days * 86400_000).toISOString().slice(0, 10)
    let pts = base.filter((x) => x.d >= from)
    if (pts.length < 2) pts = base.slice(-2)
    const conv = (v: number, d: string) => (ccy === 'KRW' ? (fxAt(d) ?? NaN) * v : v)
    const price = pts.map((x) => ({ d: x.d, v: conv(show.total && x.adj ? x.adj : x.close, x.d), vol: x.volume })).filter((x) => Number.isFinite(x.v))
    if (price.length < 2) return null
    const ma50 = hasDaily && show.ma ? movingAverage(props.daily, 50).filter((x) => x.d >= price[0].d).map((x) => ({ d: x.d, v: conv(x.v, x.d) })) : []
    const ma200 = hasDaily && show.ma ? movingAverage(props.daily, 200).filter((x) => x.d >= price[0].d).map((x) => ({ d: x.d, v: conv(x.v, x.d) })) : []
    const bench = (() => {
      if (!show.bench || !props.benchmark) return []
      const b = props.benchmark.points.filter((x) => x.d >= price[0].d)
      if (b.length < 2) return []
      const k = price[0].v / conv(b[0].close, b[0].d)
      return b.map((x) => ({ d: x.d, v: conv(x.close, x.d) * k })).filter((x) => Number.isFinite(x.v))
    })()
    const fair = show.value && props.fairValue ? props.fairValue : null
    const buy = show.value && props.buyBelow !== null ? props.buyBelow : null
    const values = [...price.map((x) => x.v), ...ma50.map((x) => x.v), ...ma200.map((x) => x.v), ...bench.map((x) => x.v), ...(fair && ccy === 'USD' ? [fair.low, fair.high] : []), ...(buy !== null && ccy === 'USD' ? [buy] : [])]
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const pad = (hi - lo) * 0.08 || hi * 0.05 || 1
    const yMin = lo - pad
    const yMax = hi + pad
    const t0 = ms(price[0].d)
    const t1 = ms(price[price.length - 1].d)
    const x = (d: string) => ((ms(d) - t0) / Math.max(1, t1 - t0)) * W
    const y = (v: number) => PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H
    const line = (xs: { d: string; v: number }[]) => xs.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
    const vmax = Math.max(1, ...price.map((p) => p.vol ?? 0))
    const inst = show.inst ? props.institutional.filter((p) => p.d >= price[0].d && p.d <= price[price.length - 1].d) : []
    const imax = Math.max(1, ...inst.map((p) => p.shares))
    const events = show.events ? props.events.filter((e) => e.d >= price[0].d && e.d <= price[price.length - 1].d) : []
    return { price, ma50, ma200, bench, fair, buy, yMin, yMax, x, y, line, vmax, inst, imax, events }
  }, [base, period, ccy, show, fxAt, hasDaily, props.daily, props.benchmark, props.institutional, props.events, props.fairValue, props.buyBelow])

  const unit = ccy === 'KRW' ? '원' : props.currency === 'USD' ? '$' : props.currency
  const fmt = (v: number) => (ccy === 'KRW' ? `${Math.round(v).toLocaleString('ko-KR')}원` : `${unit}${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
  const toggle = (k: keyof typeof show) => setShow((s) => ({ ...s, [k]: !s[k] }))

  if (!view) {
    return <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[13px] text-ink-muted">DATA NOT AVAILABLE — 가격 자료가 없습니다(일별 주가는 TWELVEDATA_API_KEY, 분기말 파생 가격은 13F 보유 종목만).</div>
  }

  const h = hover !== null ? view.price[hover] : null
  const ticks = [view.yMax, (view.yMax + view.yMin) / 2, view.yMin]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PERIODS.map((p) => (
          <Btn key={p.key} on={period === p.key} onClick={() => setPeriod(p.key)} disabled={!hasDaily && p.days > 0 && p.days < 366} title={!hasDaily && p.days > 0 && p.days < 366 ? '일별 주가 없음 — 분기말 점만' : undefined}>
            {p.key}
          </Btn>
        ))}
        <span className="mx-1 w-px self-stretch bg-line-soft" />
        <Btn on={ccy === 'USD'} onClick={() => setCcy('USD')}>{props.currency}</Btn>
        <Btn on={ccy === 'KRW'} onClick={() => setCcy('KRW')} disabled={props.fx.length === 0}>KRW</Btn>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Btn on onClick={() => undefined}>주가{hasDaily ? '' : '(13F 분기말 파생)'}</Btn>
        <Btn on={show.total} onClick={() => toggle('total')} disabled={!props.daily.some((p) => p.adj !== null)} title="배당까지 보정한 총수익 기준">총수익 기준</Btn>
        <Btn on={show.volume && hasDaily} onClick={() => toggle('volume')} disabled={!hasDaily}>거래량</Btn>
        <Btn on={show.ma && hasDaily} onClick={() => toggle('ma')} disabled={!hasDaily}>이동평균 50·200</Btn>
        <Btn on={show.bench} onClick={() => toggle('bench')} disabled={!props.benchmark || props.benchmark.points.length < 2} title={props.benchmark ? undefined : '벤치마크 일별 가격 없음'}>
          벤치마크 {props.benchmark?.ticker ?? ''}
        </Btn>
        <Btn on={show.inst} onClick={() => toggle('inst')} disabled={props.institutional.length === 0}>기관 보유 수량</Btn>
        <Btn on={show.value} onClick={() => toggle('value')} disabled={!props.fairValue && props.buyBelow === null} title={!props.fairValue && props.buyBelow === null ? '가치평가 입력 전' : undefined}>
          추정가치 · 매수 기준가
        </Btn>
        <Btn on={show.events} onClick={() => toggle('events')} disabled={props.events.length === 0}>실적 · 배당 · 분할</Btn>
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div className="flex flex-col justify-between py-0.5 text-right text-[13px] text-ink-muted tnum" style={{ height: `${(PLOT_H / H) * 100}%` }}>
          {ticks.map((t, i) => (
            <span key={i}>{fmt(t)}</span>
          ))}
        </div>
        <div className="relative min-w-0">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-[240px] w-full sm:h-[300px]"
            role="img"
            aria-label="가격 그래프"
            onPointerLeave={() => setHover(null)}
            onPointerMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
              const fx = ((e.clientX - r.left) / r.width) * W
              let best = 0
              let bd = Infinity
              view.price.forEach((p, i) => {
                const dd = Math.abs(view.x(p.d) - fx)
                if (dd < bd) {
                  bd = dd
                  best = i
                }
              })
              setHover(best)
            }}
          >
            {ticks.map((t, i) => (
              <line key={i} x1={0} x2={W} y1={view.y(t)} y2={view.y(t)} stroke="currentColor" className="text-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {view.fair && ccy === 'USD' ? <rect x={0} width={W} y={view.y(view.fair.high)} height={Math.max(1, view.y(view.fair.low) - view.y(view.fair.high))} className="fill-chart-3" opacity={0.12} /> : null}
            {view.buy !== null && ccy === 'USD' ? <line x1={0} x2={W} y1={view.y(view.buy)} y2={view.y(view.buy)} className="stroke-positive" strokeDasharray="6 5" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
            {show.volume && hasDaily
              ? view.price.map((p) => (p.vol ? <rect key={`v${p.d}`} x={view.x(p.d)} width={Math.max(1, W / view.price.length - 0.5)} y={H - (p.vol / view.vmax) * 60} height={(p.vol / view.vmax) * 60} fill="currentColor" className="text-ink-muted" opacity={0.25} /> : null))
              : null}
            {view.inst.map((p) => (
              <rect key={`i${p.d}`} x={view.x(p.d) - 6} width={12} y={H - (p.shares / view.imax) * 60} height={(p.shares / view.imax) * 60} className="fill-chart-2" opacity={0.55} />
            ))}
            {view.events.map((e) => (
              <line key={`e${e.d}${e.kind}`} x1={view.x(e.d)} x2={view.x(e.d)} y1={0} y2={PLOT_H} className={e.kind === 'split' ? 'stroke-critical' : e.kind === 'dividend' ? 'stroke-ok' : 'stroke-ink-muted'} strokeDasharray="3 4" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.7} />
            ))}
            {view.bench.length ? <path d={view.line(view.bench)} fill="none" className="stroke-chart-6" strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={0.8} /> : null}
            {view.ma200.length ? <path d={view.line(view.ma200)} fill="none" className="stroke-chart-4" strokeWidth={1.2} vectorEffect="non-scaling-stroke" /> : null}
            {view.ma50.length ? <path d={view.line(view.ma50)} fill="none" className="stroke-chart-5" strokeWidth={1.2} vectorEffect="non-scaling-stroke" /> : null}
            <path d={view.line(view.price)} fill="none" className="stroke-chart-3" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {!hasDaily ? view.price.map((p) => <circle key={`q${p.d}`} cx={view.x(p.d)} cy={view.y(p.v)} r={4} className="fill-chart-3" />) : null}
            {h ? <line x1={view.x(h.d)} x2={view.x(h.d)} y1={0} y2={H} stroke="currentColor" className="text-ink-muted" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {h ? (
            <div className="pointer-events-none absolute top-1 left-1 rounded-md border border-line-soft bg-panel px-2 py-1 text-[13px] text-ink shadow-sm tnum">
              {h.d} · {fmt(h.v)}
              {h.vol ? ` · 거래량 ${Math.round(h.vol).toLocaleString('en-US')}` : ''}
            </div>
          ) : null}
          <div className="mt-1 flex justify-between text-[13px] text-ink-muted tnum">
            <span>{view.price[0].d}</span>
            <span>{view.price[view.price.length - 1].d}</span>
          </div>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-muted">
        <li><span className="mr-1 inline-block h-0.5 w-4 bg-chart-3 align-middle" />주가 {hasDaily ? '(일봉 · 분할 보정)' : '(13F 평가액 ÷ 주식 수 · 분기말만)'}</li>
        {view.ma50.length ? <li><span className="mr-1 inline-block h-0.5 w-4 bg-chart-5 align-middle" />50일 · <span className="inline-block h-0.5 w-4 bg-chart-4 align-middle" /> 200일</li> : null}
        {view.bench.length ? <li><span className="mr-1 inline-block h-0.5 w-4 bg-chart-6 align-middle" />{props.benchmark?.ticker}(시작점 맞춤)</li> : null}
        {view.inst.length ? <li><span className="mr-1 inline-block h-2 w-3 bg-chart-2/60 align-middle" />기관 보유 주식 수 합(13F 기준일)</li> : null}
        {view.events.length ? <li>점선: 실적 공시 · 배당(초록) · 분할(빨강)</li> : null}
        {ccy === 'KRW' ? <li>KRW = 그날 ECB USD/KRW 기준환율 적용</li> : null}
      </ul>
    </div>
  )
}

function Btn({ on, onClick, children, disabled, title }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      className={`inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] lg:min-h-8 ${disabled ? 'cursor-not-allowed border-line-soft text-ink-muted/60' : on ? 'border-accent bg-accent/15 font-semibold text-ink' : 'border-line-soft text-ink-muted hover:text-ink'}`}
    >
      {children}
    </button>
  )
}
