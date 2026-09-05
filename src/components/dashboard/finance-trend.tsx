import { Icon } from '@/components/ui/icon'
import { LineChart, type ChartSeries } from '@/components/ui/line-chart'
import { PERIODS, deltaPct, groupSeries } from '@/lib/finance'
import { formatDeltaPct, formatEok } from '@/lib/format'
import type { FinanceMetric } from '@/types'

/**
 * CH-025 Revenue Trend + CH-026 Cost Breakdown(손익 축 기준).
 * ②시안의 '그룹 전체 재무 현황' 카드다. 왼쪽에 당월 숫자 4개, 아래에 12개월 4선.
 *
 * 숫자는 전부 lib/finance의 합계를 다시 쓴다. 여기서 따로 더하면
 * KPI 스트립과 이 카드가 언젠가 다른 값을 말하게 된다(CH-006~008 Acceptance).
 */

/**
 * 축 배정(DEFERRED D-07 결정 A). 매출은 손익보다 자릿수가 10배 넘게 크다.
 * 한 축에 같이 두면 손익 세 선이 0 위에 붙어 서로 구분되지 않는다.
 */
const LINES: {
  metric: FinanceMetric
  label: string
  colorClass: string
  dotClass: string
  axis: 'left' | 'right'
}[] = [
  { metric: 'Revenue', label: '매출', colorClass: 'text-accent', dotClass: 'bg-accent', axis: 'left' },
  {
    metric: 'OperatingProfit',
    label: '영업이익',
    colorClass: 'text-ok',
    dotClass: 'bg-ok',
    axis: 'right',
  },
  { metric: 'EBITDA', label: 'EBITDA', colorClass: 'text-info', dotClass: 'bg-info', axis: 'right' },
  {
    metric: 'NetIncome',
    label: '당기순이익',
    colorClass: 'text-warning',
    dotClass: 'bg-warning',
    axis: 'right',
  },
]

/** 눈금 간격이 2.5억처럼 떨어지면 반올림해서 쓰면 안 된다. 필요할 때만 소수 한 자리. */
function axisLabel(value: number): string {
  return formatEok(value, Number.isInteger(value / 100_000_000) ? 0 : 1)
}

/** '2026-08' → '26-08'. 12칸에 연도를 다 쓰면 눈금이 서로 붙는다. */
function shortPeriod(period: string): string {
  return period.slice(2)
}

export function FinanceTrend({ businessIds }: { businessIds: string[] }) {
  const rows = LINES.map((line) => {
    const data = groupSeries(line.metric, businessIds)
    return { ...line, data, current: data[data.length - 1], delta: deltaPct(data) }
  })

  const series: ChartSeries[] = rows.map((r) => ({
    key: r.metric,
    label: r.label,
    colorClass: r.colorClass,
    data: r.data,
    axis: r.axis,
  }))

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-baseline gap-2 text-[13px] font-semibold">
          그룹 전체 재무 현황
          <span className="text-[11px] font-normal text-ink-muted tnum">
            최근 12개월 · 표시 중인 {businessIds.length}개사 합계
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-ink-muted tnum">CH-025~026</span>
          {/* TODO(CH-025): 기간 필터가 붙으면 여기에서 period range를 바꾼다. */}
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-ink-dim transition-colors hover:text-ink"
          >
            이번 달
            <Icon name="chevron-down" className="size-3" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {rows.map((r) => (
          <div key={r.metric}>
            <p className="text-[11px] text-ink-dim">{r.label}</p>
            <p
              className={`mt-0.5 text-[21px] leading-tight font-semibold tnum ${
                r.current < 0 ? 'text-critical' : 'text-ink'
              }`}
            >
              {formatEok(r.current)}
            </p>
            {/* 네 지표 모두 오르는 게 좋은 축이라 부호와 색이 같이 간다. */}
            {r.delta === null ? (
              <p className="mt-0.5 text-[11px] text-ink-muted">전월 대비 —</p>
            ) : (
              <p
                className={`mt-0.5 flex items-center gap-0.5 text-[11px] ${
                  r.delta > 0 ? 'text-ok' : 'text-critical'
                }`}
              >
                <Icon name={r.delta > 0 ? 'arrow-up' : 'arrow-down'} className="size-3" />
                <span className="tnum">{formatDeltaPct(r.delta)}</span>
                <span className="text-ink-muted">전월 대비</span>
              </p>
            )}
          </div>
        ))}
      </div>

      {/* 어느 선이 어느 축인지 범례에서 말해 준다. 축이 둘이면 이 말이 없으면 오독한다. */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {rows.map((r) => (
          <span key={r.metric} className="flex items-center gap-1.5 text-[10px] text-ink-dim">
            <span className={`h-0.5 w-3 rounded-full ${r.dotClass}`} />
            {r.label}
            <span className="text-ink-muted">{r.axis === 'left' ? '(좌)' : '(우)'}</span>
          </span>
        ))}
      </div>

      <div className="mt-1.5">
        <LineChart series={series} labels={PERIODS.map(shortPeriod)} formatY={axisLabel} />
      </div>
    </section>
  )
}
