/**
 * 다계열 라인차트. 차트 라이브러리를 넣지 않고 sparkline.tsx와 같은 방식으로 SVG만 그린다.
 *
 * 눈금 글자는 SVG 밖 HTML로 뺐다. 플롯은 preserveAspectRatio="none"으로 늘려야
 * 폭이 변해도 12개월이 균등하게 서는데, 그 안에 <text>를 두면 글자까지 같이 늘어난다.
 */

export interface ChartSeries {
  key: string
  label: string
  /** 선 색. 토큰 클래스(text-accent 등)로 받아 currentColor로 그린다. */
  colorClass: string
  data: number[]
}

interface LineChartProps {
  series: ChartSeries[]
  /** x축 눈금 글자. data와 같은 길이. 전부 쓰지 않고 일정 간격으로 솎아 낸다. */
  labels: string[]
  /** y축 눈금 글자 변환. 금액이면 억 단위로 줄여 쓴다. */
  formatY: (value: number) => string
  height?: number
  xTickCount?: number
}

/** 사람이 읽는 간격(1·2·2.5·5·10 × 10ⁿ)으로 눈금을 만든다. 0은 항상 눈금에 포함한다. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min)
  const hi = Math.max(0, max)
  const rough = (hi - lo) / count || 1
  const mag = 10 ** Math.floor(Math.log10(rough))
  const step = ([1, 2, 2.5, 5, 10].find((s) => s * mag >= rough) ?? 10) * mag
  const start = Math.floor(lo / step) * step
  const end = Math.ceil(hi / step) * step

  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v))
  return ticks
}

export function LineChart({
  series,
  labels,
  formatY,
  height = 176,
  xTickCount = 5,
}: LineChartProps) {
  const all = series.flatMap((s) => s.data)
  if (all.length === 0) return null

  const ticks = niceTicks(Math.min(...all), Math.max(...all))
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const span = hi - lo || 1
  const len = Math.max(...series.map((s) => s.data.length))

  const x = (i: number) => (len < 2 ? 0 : (i / (len - 1)) * 100)
  const y = (v: number) => 100 - ((v - lo) / span) * 100

  // 눈금은 위에서 아래로 읽는다. 배열은 오름차순이라 뒤집어서 쓴다.
  const yLabels = [...ticks].reverse()

  const xStep = Math.max(1, Math.round((len - 1) / (xTickCount - 1)))
  const xTicks = labels
    .map((label, i) => ({ label, i }))
    .filter(({ i }) => i % xStep === 0 || i === len - 1)

  return (
    <div>
      <div className="flex gap-2" style={{ height }}>
        {/* y축. justify-between으로 눈금 간격을 플롯 높이에 그대로 맞춘다. */}
        <div className="flex w-11 shrink-0 flex-col justify-between py-px text-right text-[9px] text-ink-muted tnum">
          {yLabels.map((t) => (
            <span key={t}>{formatY(t)}</span>
          ))}
        </div>

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full flex-1"
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <line
              key={t}
              x1={0}
              x2={100}
              y1={y(t)}
              y2={y(t)}
              stroke="currentColor"
              className={t === 0 ? 'text-line' : 'text-line-soft'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {series.map((s) => (
            <polyline
              key={s.key}
              points={s.data.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')}
              fill="none"
              stroke="currentColor"
              className={s.colorClass}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      {/* x축은 플롯 폭 위에 절대 위치로 올린다. 균등 배치하면 마지막 달이 안쪽으로 밀린다. */}
      <div className="mt-1 flex gap-2">
        <div className="w-11 shrink-0" />
        <div className="relative h-3.5 flex-1">
          {xTicks.map(({ label, i }) => (
            <span
              key={label}
              className="absolute top-0 -translate-x-1/2 text-[9px] whitespace-nowrap text-ink-muted tnum"
              style={{ left: `${x(i)}%` }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
