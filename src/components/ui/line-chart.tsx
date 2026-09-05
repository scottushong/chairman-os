/**
 * 다계열 라인차트. 차트 라이브러리를 넣지 않고 sparkline.tsx와 같은 방식으로 SVG만 그린다.
 *
 * 눈금 글자는 SVG 밖 HTML로 뺐다. 플롯은 preserveAspectRatio="none"으로 늘려야
 * 폭이 변해도 12개월이 균등하게 서는데, 그 안에 <text>를 두면 글자까지 같이 늘어난다.
 *
 * 축은 둘까지 쓴다(DEFERRED D-07 결정 A). 자릿수가 10배 넘게 벌어지는 계열을 한 축에 올리면
 * 작은 쪽이 0 위에 붙어 아예 안 읽힌다. 두 축은 눈금 개수를 강제로 맞춰 격자선을 공유한다.
 */

export interface ChartSeries {
  key: string
  label: string
  /** 선 색. 토큰 클래스(text-accent 등)로 받아 currentColor로 그린다. */
  colorClass: string
  data: number[]
  /** 기본은 왼쪽 축. 자릿수가 다른 계열만 오른쪽으로 보낸다. */
  axis?: 'left' | 'right'
}

interface LineChartProps {
  series: ChartSeries[]
  /** x축 눈금 글자. data와 같은 길이. 전부 쓰지 않고 일정 간격으로 솎아 낸다. */
  labels: string[]
  /** 왼쪽 축 눈금 글자 변환. 금액이면 억 단위로 줄여 쓴다. */
  formatY: (value: number) => string
  /** 오른쪽 축. 생략하면 formatY를 그대로 쓴다. */
  formatY2?: (value: number) => string
  height?: number
  xTickCount?: number
  /** 두 축이 공유하는 격자선 수. */
  tickCount?: number
}

interface Scale {
  lo: number
  hi: number
  ticks: number[]
}

/**
 * 0을 포함하고 눈금이 정확히 count개인 축을 만든다.
 * 사람이 읽는 간격(1·2·2.5·5 × 10ⁿ)부터 시작해, 범위를 다 덮을 때까지 간격을 키운다.
 * 두 축의 눈금 수가 같아야 격자선이 한 줄에서 만난다.
 */
function scaleFor(values: number[], count: number): Scale {
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1

  let step = 1
  let start = 0
  let power = Math.floor(Math.log10(span / (count - 1)))

  // 간격을 한 단계씩 키우며 min~max가 count개 눈금 안에 들어오는 첫 조합을 쓴다.
  for (let guard = 0; guard < 40; guard += 1, power += 1) {
    const fit = [1, 2, 2.5, 5].find((m) => {
      const s = m * 10 ** power
      return Math.floor(min / s) * s + s * (count - 1) >= max - 1e-9
    })
    if (fit !== undefined) {
      step = fit * 10 ** power
      start = Math.floor(min / step) * step
      break
    }
  }

  return {
    lo: start,
    hi: start + step * (count - 1),
    ticks: Array.from({ length: count }, (_, i) => start + step * i),
  }
}

export function LineChart({
  series,
  labels,
  formatY,
  formatY2,
  height = 176,
  xTickCount = 5,
  tickCount = 5,
}: LineChartProps) {
  const left = series.filter((s) => s.axis !== 'right')
  const right = series.filter((s) => s.axis === 'right')
  if (left.length === 0 && right.length === 0) return null

  const leftScale = scaleFor(left.flatMap((s) => s.data), tickCount)
  const rightScale = right.length > 0 ? scaleFor(right.flatMap((s) => s.data), tickCount) : null

  const len = Math.max(...series.map((s) => s.data.length))
  const x = (i: number) => (len < 2 ? 0 : (i / (len - 1)) * 100)
  const yOn = (scale: Scale, v: number) => 100 - ((v - scale.lo) / (scale.hi - scale.lo || 1)) * 100

  // 눈금은 위에서 아래로 읽는다. 배열은 오름차순이라 뒤집어서 쓴다.
  const leftLabels = [...leftScale.ticks].reverse()
  const rightLabels = rightScale ? [...rightScale.ticks].reverse() : []

  const xStep = Math.max(1, Math.round((len - 1) / (xTickCount - 1)))
  const xTicks = labels
    .map((label, i) => ({ label, i }))
    .filter(({ i }) => i % xStep === 0 || i === len - 1)

  return (
    <div>
      <div className="flex gap-2" style={{ height }}>
        {/* y축. justify-between으로 눈금 간격을 플롯 높이에 그대로 맞춘다. */}
        <div className="flex w-11 shrink-0 flex-col justify-between py-px text-right text-[9px] text-ink-muted tnum">
          {leftLabels.map((t) => (
            <span key={t}>{formatY(t)}</span>
          ))}
        </div>

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full flex-1"
          aria-hidden="true"
        >
          {/* 격자선은 왼쪽 축 기준으로만 긋는다. 두 축의 눈금 수가 같아 오른쪽과도 맞는다. */}
          {leftScale.ticks.map((t) => (
            <line
              key={t}
              x1={0}
              x2={100}
              y1={yOn(leftScale, t)}
              y2={yOn(leftScale, t)}
              stroke="currentColor"
              className={t === 0 ? 'text-line' : 'text-line-soft'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {series.map((s) => {
            const scale = s.axis === 'right' && rightScale ? rightScale : leftScale
            return (
              <polyline
                key={s.key}
                points={s.data
                  .map((v, i) => `${x(i).toFixed(2)},${yOn(scale, v).toFixed(2)}`)
                  .join(' ')}
                fill="none"
                stroke="currentColor"
                className={s.colorClass}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
        </svg>

        {rightScale ? (
          <div className="flex w-11 shrink-0 flex-col justify-between py-px text-left text-[9px] text-ink-muted tnum">
            {rightLabels.map((t) => (
              <span key={t}>{(formatY2 ?? formatY)(t)}</span>
            ))}
          </div>
        ) : null}
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
        {rightScale ? <div className="w-11 shrink-0" /> : null}
      </div>
    </div>
  )
}
