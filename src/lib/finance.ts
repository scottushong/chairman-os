import { LATEST_PERIOD, financeKpis, projects } from '@/data'
import type { BusinessId, FinanceMetric, PeriodKey } from '@/types'

/**
 * 집계는 전부 여기 한 곳에서만 한다.
 * CH-006~008 Acceptance가 '원천 데이터 합계와 일치'라, 화면마다 따로 더하면 곧 어긋난다.
 */

/** 시드에 들어 있는 기간을 오래된 순으로. 스파크라인의 x축이다. */
export const PERIODS: PeriodKey[] = [...new Set(financeKpis.map((k) => k.period))].sort()

/** 특정 회사·지표의 한 달 값. 없으면 0. */
export function valueOf(
  businessId: BusinessId,
  metric: FinanceMetric,
  period: PeriodKey = LATEST_PERIOD,
): number {
  return (
    financeKpis.find(
      (k) => k.business_id === businessId && k.metric === metric && k.period === period,
    )?.value ?? 0
  )
}

/** 그룹 합계. businessIds를 주면 '표시 중인 회사'만 더한다(CH-006 기간·표시 필터). */
export function groupValue(
  metric: FinanceMetric,
  period: PeriodKey = LATEST_PERIOD,
  businessIds?: BusinessId[],
): number {
  return financeKpis
    .filter(
      (k) =>
        k.metric === metric &&
        k.period === period &&
        (!businessIds || businessIds.includes(k.business_id)),
    )
    .reduce((sum, k) => sum + k.value, 0)
}

/** 그룹 합계의 월별 시계열. 스파크라인이 이걸 그린다. */
export function groupSeries(metric: FinanceMetric, businessIds?: BusinessId[]): number[] {
  return PERIODS.map((p) => groupValue(metric, p, businessIds))
}

/**
 * 전월 대비 증감률(%).
 * 직전 값이 0이거나 부호가 뒤집히면 배율이 의미를 잃어서 표시하지 않는다.
 */
export function deltaPct(series: number[]): number | null {
  if (series.length < 2) return null
  const prev = series[series.length - 2]
  const curr = series[series.length - 1]
  if (prev === 0 || Math.sign(prev) !== Math.sign(curr)) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

/**
 * 회사 카드의 진행률.
 * 시트에 회사별 목표 진행률 칸이 없어, 그 회사가 굴리는 프로젝트 진행률의 평균으로 낸다.
 * Goal DB가 붙으면(CH-011) 이 함수만 갈아 끼우면 된다.
 */
export function businessProgress(businessId: BusinessId): number {
  const own = projects.filter((p) => p.business_id === businessId)
  if (own.length === 0) return 0
  return Math.round(own.reduce((sum, p) => sum + p.progress_pct, 0) / own.length)
}
