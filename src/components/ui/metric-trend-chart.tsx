/**
 * 한 지표의 12개월 추이. 막대(연한 면) + 부드러운 곡선(진한 선)을 겹쳐 그린다.
 * 차트 라이브러리를 넣지 않고 sparkline.tsx·line-chart.tsx와 같은 방식으로 SVG만 그린다.
 *
 * **축은 하나다.** 예전 line-chart.tsx는 매출과 손익을 한 판에 올리려고 축을 둘 뒀는데
 * (DEFERRED D-07 결정 A), 이중 축은 두 계열의 교차점을 눈금 선택이 만들어 내는 그림이라
 * 같은 데이터로 정반대 인상을 줄 수 있다. 지표를 하나씩 보는 쪽으로 바꾸면서 그 축이 사라졌다.
 *
 * 계열이 하나라 범례를 두지 않는다 — 무엇을 보고 있는지는 위의 탭과 큰 숫자가 말한다.
 * 숫자도 모든 점에 적지 않는다. 마지막 달만 말풍선으로 짚는다.
 *
 * **글자와 점은 SVG 밖 HTML이다.** 플롯은 preserveAspectRatio="none"으로 늘려야
 * 폭이 변해도 12개월이 균등하게 서는데, 그 안에 둔 <text>나 <circle>은 같이 늘어나
 * 글자가 찌그러지고 점이 타원이 된다. 선 굵기만 vectorEffect로 지킨다.
 */

export interface MetricTrendPoint {
  /** x축 눈금 글자. '26-08' 꼴. */
  label: string
  value: number
  /** 마감 전이거나 확정이 아닌 달. 막대를 점선 테두리로 그린다. */
  provisional: boolean
  /** hover로 뜨는 한 줄. */
  title: string
}

interface MetricTrendChartProps {
  points: MetricTrendPoint[]
  /** y축 눈금 글자. 금액이면 억 단위로 줄여 쓴다. */
  formatY: (value: number) => string
  /** 마지막 달 말풍선에 들어갈 문장. '8월 66.3억' 꼴. */
  lastLabel: string
  /** 차트 전체를 한 문장으로 읽는 이름. 계열이 하나라 이 문장이 범례를 대신한다. */
  ariaLabel: string
  height?: number
  /** 격자선 수. 2~3줄이면 충분하다 — 더 그으면 막대보다 격자가 먼저 읽힌다. */
  tickCount?: number
}

interface Scale {
  lo: number
  hi: number
  ticks: number[]
}

/**
 * 0을 포함하고 눈금이 정확히 count개인 축.
 * 사람이 읽는 간격(1·2·2.5·5 × 10ⁿ)부터 시작해 범위를 다 덮을 때까지 간격을 키운다.
 * line-chart.tsx에서 그대로 가져왔다 — 그쪽은 두 축을 맞추려고 썼고 여기는 한 축뿐이지만,
 * '눈금이 사람이 읽는 수로 떨어져야 한다'는 이유는 같다.
 */
function scaleFor(values: number[], count: number): Scale {
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1

  let step = 1
  let start = 0
  let power = Math.floor(Math.log10(span / (count - 1)))

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

/**
 * 점들을 지나는 부드러운 곡선.
 *
 * Catmull-Rom을 3차 베지에로 옮긴다. 장력은 0.16으로 낮게 잡았다 —
 * 기본값(0.25 언저리)이면 한 달 크게 튄 값 뒤에서 곡선이 0 아래로 내려갔다 올라와
 * '적자였다'는 없는 사실을 그린다. 낮출수록 꺾은선에 가까워지고, 거짓말은 줄어든다.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`

  const t = 0.16
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) * t
    const c1y = p1.y + (p2.y - p0.y) * t
    const c2x = p2.x - (p3.x - p1.x) * t
    const c2y = p2.y - (p3.y - p1.y) * t
    d +=
      ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}` +
      ` ${c2x.toFixed(2)} ${c2y.toFixed(2)}` +
      ` ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

export function MetricTrendChart({
  points,
  formatY,
  lastLabel,
  ariaLabel,
  height = 176,
  tickCount = 3,
}: MetricTrendChartProps) {
  if (points.length === 0) return null

  const scale = scaleFor(points.map((p) => p.value), tickCount)
  const n = points.length

  // 띠(band) 배치. 막대가 칸 가운데 서고 곡선의 점도 같은 자리에 온다 —
  // 선이 막대 사이를 지나가면 둘이 같은 달을 말하는 것으로 안 읽힌다.
  const cx = (i: number) => ((i + 0.5) / n) * 100
  const y = (v: number) => 100 - ((v - scale.lo) / (scale.hi - scale.lo || 1)) * 100

  const barWidth = (100 / n) * 0.58
  const zeroY = y(0)
  const curve = smoothPath(points.map((p, i) => ({ x: cx(i), y: y(p.value) })))

  const lastIndex = n - 1
  const lastY = y(points[lastIndex].value)
  // 말풍선은 점 위에 뜬다. 점이 플롯 위쪽 30% 안에 있으면 위로 나갈 자리가 없어 아래로 내린다.
  const bubbleBelow = lastY < 30

  // 12칸에 눈금 글자를 다 쓰면 서로 붙는다. 석 달에 한 번과 마지막 달만 남긴다.
  const xTicks = points
    .map((p, i) => ({ label: p.label, i }))
    .filter(({ i }) => i % 3 === 0 || i === lastIndex)

  return (
    <div>
      <div className="flex gap-2" style={{ height }}>
        {/* y축. justify-between으로 눈금 간격을 플롯 높이에 그대로 맞춘다. */}
        <div className="flex w-11 shrink-0 flex-col justify-between py-px text-right text-[9px] text-ink-muted tnum">
          {[...scale.ticks].reverse().map((t) => (
            <span key={t}>{formatY(t)}</span>
          ))}
        </div>

        {/* 플롯. relative인 이유는 마지막 점과 말풍선을 HTML로 겹쳐 놓기 때문이다. */}
        <div className="relative flex-1">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label={ariaLabel}
          >
            {scale.ticks.map((t) => (
              <line
                key={t}
                x1={0}
                x2={100}
                y1={y(t)}
                y2={y(t)}
                stroke="currentColor"
                // 0선만 한 단계 진하다. 손익이 음수로 내려가는 달에 그 선이 기준이 된다.
                className={t === 0 ? 'text-line' : 'text-line-soft'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {points.map((p, i) => {
              const top = Math.min(y(p.value), zeroY)
              const h = Math.abs(y(p.value) - zeroY)
              return (
                <rect
                  key={p.label}
                  x={cx(i) - barWidth / 2}
                  y={top}
                  width={barWidth}
                  // 값이 0이면 높이도 0이라 아무것도 안 보인다. 최소 굵기를 줘서 '0인 달'을 남긴다.
                  height={Math.max(h, 0.4)}
                  className="text-accent"
                  fill="currentColor"
                  fillOpacity={0.2}
                  stroke={p.provisional ? 'currentColor' : 'none'}
                  strokeOpacity={p.provisional ? 0.55 : 0}
                  strokeWidth={1}
                  strokeDasharray={p.provisional ? '3 2' : undefined}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{p.title}</title>
                </rect>
              )
            })}

            <path
              d={curve}
              fill="none"
              stroke="currentColor"
              className="text-accent"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/*
           * 마지막 점과 말풍선. SVG 밖 HTML이라 플롯이 늘어나도 동그라미가 타원이 되지 않는다.
           * 좌표는 SVG와 같은 0~100 비율이라 퍼센트로 그대로 얹힌다.
           * 점 둘레의 링은 면 색이다 — 곡선이 점 아래를 지날 때 둘이 붙어 보이지 않게 띄운다.
           */}
          <span
            className="pointer-events-none absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-panel"
            style={{ left: `${cx(lastIndex)}%`, top: `${lastY}%` }}
          />
          {/*
           * data-theme="dark"를 이 요소에만 건다 — (dashboard)/page.tsx의 브리핑 카드와 같은 수법이다.
           * --color-app은 테마를 따라 뒤집히는 토큰이라(라이트 #f6ede0 / 다크 #0c1224)
           * 그냥 bg-app을 쓰면 라이트에서 크림색 말풍선에 흰 글자가 되어 안 읽힌다.
           * 이 속성이 그 안쪽에서만 토큰을 다크 값으로 재정의하므로, 말풍선은 양쪽 테마에서 어둡다.
           */}
          <span
            data-theme="dark"
            className={`pointer-events-none absolute z-10 -translate-x-1/2 rounded-md bg-app px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-ink shadow-sm ring-1 ring-white/15 tnum ${
              bubbleBelow ? 'translate-y-2' : '-translate-y-[calc(100%+0.5rem)]'
            }`}
            style={{ left: `${cx(lastIndex)}%`, top: `${lastY}%` }}
          >
            {lastLabel}
          </span>
        </div>
      </div>

      {/* x축은 플롯 폭 위에 절대 위치로 올린다. 균등 배치하면 마지막 달이 안쪽으로 밀린다. */}
      <div className="mt-1 flex gap-2">
        <div className="w-11 shrink-0" />
        <div className="relative h-3.5 flex-1">
          {xTicks.map(({ label, i }) => (
            <span
              key={label}
              className="absolute top-0 -translate-x-1/2 text-[9px] whitespace-nowrap text-ink-muted tnum"
              style={{ left: `${cx(i)}%` }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
