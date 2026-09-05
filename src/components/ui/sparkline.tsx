/**
 * KPI 타일의 12개월 추세선.
 * 축도 눈금도 없다. 값을 읽는 자리는 옆의 큰 숫자고, 이 선은 모양만 보여 준다.
 * 선은 죽인 색(ink-muted)으로 깔고 마지막 달만 accent 틱으로 세워 '지금'을 표시한다.
 */
interface SparklineProps {
  data: number[]
  className?: string
}

const W = 120
const H = 30
const PAD = 3

export function Sparkline({ data, className = 'h-[30px] w-full' }: SparklineProps) {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1

  const x = (i: number) => (i / (data.length - 1)) * W
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)

  const points = data.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const lastX = x(data.length - 1)
  const lastY = y(data[data.length - 1])

  // 0을 지나는 계열(적자 전환 등)은 기준선이 없으면 부호가 안 보인다.
  const crossesZero = min < 0 && max > 0

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      {crossesZero ? (
        <line
          x1={0}
          x2={W}
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          className="text-line"
          strokeWidth={1}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        className="text-ink-muted"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* 마지막 값 표시. 원을 쓰면 가로로 늘어나서 세로 틱으로 세운다. */}
      <line
        x1={lastX}
        x2={lastX}
        y1={lastY - 3}
        y2={lastY + 3}
        stroke="currentColor"
        className="text-accent"
        strokeWidth={2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
