import { Icon } from '@/components/ui/icon'
import { Sparkline } from '@/components/ui/sparkline'
import { LATEST_PERIOD } from '@/data'
import { deltaPct, groupSeries } from '@/lib/finance'
import { formatDeltaPct, formatEok } from '@/lib/format'
import type { FinanceMetric } from '@/types'

/**
 * CH-006~010 그룹 KPI 스트립.
 * 8개 지표 × (당월 합계 + 전월 대비 + 12개월 추세).
 * 합계는 lib/finance 한 곳에서만 계산해 '원천 데이터 합계와 일치' 조건을 지킨다.
 */

interface KpiSpec {
  metric: FinanceMetric
  label: string
  /** 올라가는 게 좋은 지표인지. 비용·채권·채무는 반대라 색이 뒤집힌다. */
  upIsGood: boolean
  /** CH 번호. 어떤 명세 항목인지 화면에서 추적 가능하게 둔다. */
  spec: string
}

const KPIS: KpiSpec[] = [
  { metric: 'Revenue', label: '매출', upIsGood: true, spec: 'CH-006' },
  { metric: 'Cost', label: '비용', upIsGood: false, spec: 'CH-007' },
  { metric: 'EBITDA', label: 'EBITDA', upIsGood: true, spec: 'CH-008' },
  { metric: 'OperatingProfit', label: '영업이익', upIsGood: true, spec: 'CH-008' },
  { metric: 'NetIncome', label: '당기순이익', upIsGood: true, spec: 'CH-008' },
  { metric: 'Cash', label: 'Cash', upIsGood: true, spec: 'CH-009' },
  { metric: 'AR', label: '매출채권', upIsGood: false, spec: 'CH-010' },
  { metric: 'AP', label: '매입채무', upIsGood: false, spec: 'CH-010' },
]

export function KpiStrip({ businessIds }: { businessIds: string[] }) {
  return (
    <section aria-label="그룹 재무 KPI">
      <div className="mb-2 flex items-baseline gap-2">
        {/* '그룹 전체 재무 현황'은 아래 추이 카드(CH-025~026)가 쓴다. 같은 제목을 두 번 걸지 않는다. */}
        <h2 className="text-[13px] font-semibold">그룹 KPI (당월)</h2>
        <span className="text-[11px] text-ink-muted tnum">
          {LATEST_PERIOD.replace('-', '년 ')}월 · 표시 중인 {businessIds.length}개사 합계
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-8">
        {KPIS.map((kpi) => (
          <KpiTile key={kpi.metric} kpi={kpi} businessIds={businessIds} />
        ))}
      </div>
    </section>
  )
}

function KpiTile({ kpi, businessIds }: { kpi: KpiSpec; businessIds: string[] }) {
  const series = groupSeries(kpi.metric, businessIds)
  const current = series[series.length - 1]
  const delta = deltaPct(series)

  // 색은 '방향 × 그 방향이 좋은지'로 정한다. 화살표를 같이 달아 색만으로 읽히지 않게 한다.
  const good = delta === null ? null : delta > 0 === kpi.upIsGood
  const deltaTone = good === null ? 'text-ink-muted' : good ? 'text-ok' : 'text-critical'

  return (
    <article className="rounded-xl border border-line-soft bg-panel px-3.5 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-dim">{kpi.label}</span>
        <span className="text-[9px] text-ink-muted tnum">{kpi.spec}</span>
      </div>

      <p
        className={[
          'mt-1 text-[19px] leading-tight font-semibold',
          current < 0 ? 'text-critical' : 'text-ink',
        ].join(' ')}
      >
        {formatEok(current)}
      </p>

      <div className={`mt-0.5 flex items-center gap-0.5 text-[11px] ${deltaTone}`}>
        {delta === null ? (
          <span className="text-ink-muted">전월 대비 —</span>
        ) : (
          <>
            <Icon name={delta > 0 ? 'arrow-up' : 'arrow-down'} className="size-3" />
            <span className="tnum">{formatDeltaPct(delta)}</span>
            <span className="ml-0.5 text-ink-muted">전월</span>
          </>
        )}
      </div>

      <Sparkline data={series} className="mt-2 h-[28px] w-full" />
    </article>
  )
}
