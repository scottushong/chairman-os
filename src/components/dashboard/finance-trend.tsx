'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { BasisTag } from '@/components/finance/figure'
import { GlassCard } from '@/components/ui/glass-card'
import { Icon } from '@/components/ui/icon'
import { MetricTrendChart, type MetricTrendPoint } from '@/components/ui/metric-trend-chart'
import { deltaPct, groupFigure, groupSeries, periodsOf, recentKpis } from '@/lib/finance'
import { formatDeltaPct, formatEok } from '@/lib/format'
import type { FinanceKpi, FinanceMetric } from '@/types'

/**
 * CH-025 Revenue Trend + CH-026 Cost Breakdown(손익 축 기준).
 * ②시안의 '그룹 전체 재무 현황' 카드다.
 *
 * **한 번에 한 지표만 본다.** 예전에는 네 지표를 한 판에 겹쳐 그렸는데, 매출이 손익보다
 * 자릿수가 10배 넘게 커서 축을 둘 둬야 했다(DEFERRED D-07 결정 A). 이중 축은 두 선이
 * 어디서 만나는지를 데이터가 아니라 눈금 선택이 정하는 그림이라, 같은 숫자로 정반대
 * 인상을 만들 수 있다. 탭으로 갈라 축을 하나로 되돌렸다.
 *
 * 네 지표를 한눈에 훑는 일은 KPI 스트립의 스파크라인이 이미 한다 — 여기서 또 할 필요가 없다.
 *
 * 고른 지표는 **URL(?metric=)에 남는다.** 회장이 영업이익을 보다가 회사 상세로 들어갔다
 * 뒤로 오면 매출로 돌아가 있지 않아야 하고, 그 화면을 그대로 누구에게 보낼 수도 있어야 한다.
 *
 * 숫자는 전부 lib/finance의 합계를 다시 쓴다. 여기서 따로 더하면
 * KPI 스트립과 이 카드가 언젠가 다른 값을 말하게 된다(CH-006~008 Acceptance).
 */

const METRICS: { metric: FinanceMetric; label: string }[] = [
  { metric: 'Revenue', label: '매출' },
  { metric: 'OperatingProfit', label: '영업이익' },
  { metric: 'EBITDA', label: 'EBITDA' },
  { metric: 'NetIncome', label: '당기순이익' },
]

const DEFAULT_METRIC: FinanceMetric = 'Revenue'

/** ?metric=에 아무 값이나 들어올 수 있다. 아는 넷이 아니면 매출로 떨어진다. */
function metricFromParam(raw: string | null): FinanceMetric {
  const found = METRICS.find((m) => m.metric === raw)
  return found ? found.metric : DEFAULT_METRIC
}

/** 눈금 간격이 2.5억처럼 떨어지면 반올림해서 쓰면 안 된다. 필요할 때만 소수 한 자리. */
function axisLabel(value: number): string {
  return formatEok(value, Number.isInteger(value / 100_000_000) ? 0 : 1)
}

/** '2026-08' → '26-08'. 12칸에 연도를 다 쓰면 눈금이 서로 붙는다. */
function shortPeriod(period: string): string {
  return period.slice(2)
}

/** '2026-08' → '8월'. 말풍선은 한 달만 가리키므로 연도가 필요 없다. */
function monthLabel(period: string): string {
  return `${Number(period.slice(5, 7))}월`
}

interface FinanceTrendProps {
  kpis: FinanceKpi[]
  businessIds: string[]
  /** 회사 한 곳만 볼 때(CH-023) 쓰는 제목과 범위 설명. KpiStrip과 같은 이유로 문장만 밖에서 받는다. */
  title?: string
  scopeNote?: string
}

export function FinanceTrend({ kpis: all, businessIds, title, scopeNote }: FinanceTrendProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const metric = metricFromParam(searchParams.get('metric'))
  const active = METRICS.find((m) => m.metric === metric) ?? METRICS[0]

  const kpis = recentKpis(all, 12)
  const periods = periodsOf(kpis)
  const data = groupSeries(kpis, metric, businessIds)
  const lastPeriod = periods[periods.length - 1] ?? ''
  const current = data[data.length - 1] ?? 0
  const delta = deltaPct(data)
  const figure = groupFigure(kpis, metric, lastPeriod, businessIds)

  const points: MetricTrendPoint[] = periods.map((period, i) => {
    const basis = groupFigure(kpis, metric, period, businessIds)?.basis
    // 확정이 아닌 달은 전부 점선이다. 마감 전(잠정)이든 수기·추정이든
    // '이 숫자는 아직 움직인다'는 사실은 같고, 회장이 읽어야 하는 것도 그것이다.
    const provisional = basis !== undefined && basis !== 'confirmed'
    return {
      label: shortPeriod(period),
      value: data[i] ?? 0,
      provisional,
      title: `${period} · ${formatEok(data[i] ?? 0)}${provisional ? ' · 확정 전' : ''}`,
    }
  })

  /** 탭을 눌러도 다른 쿼리(회사 필터 등)는 건드리지 않는다. 스크롤 위치도 그대로 둔다. */
  const selectMetric = (next: FinanceMetric) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === DEFAULT_METRIC) params.delete('metric')
    else params.set('metric', next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <GlassCard as="section" padding="p-3.5" className="h-full">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex min-w-0 items-baseline gap-2 text-[13px] font-semibold">
          {title ?? '그룹 전체 재무 현황'}
          <span className="truncate text-[11px] font-normal text-ink-muted tnum">
            최근 {periods.length}개월 · {scopeNote ?? `표시 중인 ${businessIds.length}개사 합계`}
          </span>
        </h2>
        <span className="shrink-0 text-[9px] text-ink-muted tnum">CH-025~026</span>
      </div>

      {/*
       * 지표 탭. role="tablist"를 쓰지 않는 이유는 이것이 패널을 바꾸는 탭이 아니라
       * 주소를 바꾸는 링크에 가깝기 때문이다 — 뒤로 가기가 동작해야 하고,
       * 스크린 리더에는 '눌린 상태'(aria-pressed)가 더 정확하다.
       */}
      <div className="mt-3 flex flex-wrap gap-1">
        {METRICS.map((m) => {
          const on = m.metric === metric
          return (
            <button
              key={m.metric}
              type="button"
              onClick={() => selectMetric(m.metric)}
              aria-pressed={on}
              className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                on
                  ? 'bg-accent/15 font-semibold text-accent'
                  : 'text-ink-dim hover:bg-raised hover:text-ink'
              }`}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p
          className={`text-[30px] leading-none font-semibold tnum ${
            current < 0 ? 'text-critical' : 'text-ink'
          }`}
        >
          {formatEok(current)}
        </p>
        {figure ? <BasisTag basis={figure.basis} /> : null}
        {/* 네 지표 모두 오르는 게 좋은 축이라 부호와 색이 같이 간다. */}
        {delta === null ? (
          <span className="text-[11px] text-ink-muted">전월 대비 —</span>
        ) : (
          <span
            className={`flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] ${
              delta > 0 ? 'bg-ok/15 text-ok' : 'bg-critical/15 text-critical'
            }`}
          >
            <Icon name={delta > 0 ? 'arrow-up' : 'arrow-down'} className="size-3" />
            <span className="tnum">{formatDeltaPct(delta)}</span>
            <span className="opacity-70">전월</span>
          </span>
        )}
      </div>

      <div className="mt-2.5">
        <MetricTrendChart
          points={points}
          formatY={axisLabel}
          lastLabel={`${monthLabel(lastPeriod)} ${formatEok(current)}`}
          ariaLabel={`${active.label} 최근 ${periods.length}개월 추이. 마지막 ${monthLabel(lastPeriod)} ${formatEok(current)}.`}
        />
      </div>
    </GlassCard>
  )
}
