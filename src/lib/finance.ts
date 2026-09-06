import type { BusinessId, FinanceKpi, FinanceMetric, PeriodKey, Project } from '@/types'

/**
 * 집계는 전부 여기 한 곳에서만 한다.
 * CH-006~008 Acceptance가 '원천 데이터 합계와 일치'라, 화면마다 따로 더하면 곧 어긋난다.
 *
 * 이 파일은 데이터를 스스로 import 하지 않는다. 전부 인자로 받는다 —
 * 여기서 시드를 직접 읽으면 live 모드에서도 화면 숫자가 시드로 계산돼 버린다.
 * 원천은 서버 컴포넌트가 repository에서 한 번 읽어 내려 준다.
 */

/** 데이터에 들어 있는 기간을 오래된 순으로. 스파크라인의 x축이다. */
export function periodsOf(kpis: FinanceKpi[]): PeriodKey[] {
  return [...new Set(kpis.map((k) => k.period))].sort()
}

/** 가장 최근 기간. 대시보드 기본 조회 월이다. 시드가 비면 빈 문자열이다. */
export function latestPeriodOf(kpis: FinanceKpi[]): PeriodKey {
  const periods = periodsOf(kpis)
  return periods[periods.length - 1] ?? ''
}

/** 특정 회사·지표의 한 달 값. 없으면 0. */
export function valueOf(
  kpis: FinanceKpi[],
  businessId: BusinessId,
  metric: FinanceMetric,
  period: PeriodKey,
): number {
  return (
    kpis.find(
      (k) => k.business_id === businessId && k.metric === metric && k.period === period,
    )?.value ?? 0
  )
}

/** 그룹 합계. businessIds를 주면 '표시 중인 회사'만 더한다(CH-006 기간·표시 필터). */
export function groupValue(
  kpis: FinanceKpi[],
  metric: FinanceMetric,
  period: PeriodKey,
  businessIds?: BusinessId[],
): number {
  return kpis
    .filter(
      (k) =>
        k.metric === metric &&
        k.period === period &&
        (!businessIds || businessIds.includes(k.business_id)),
    )
    .reduce((sum, k) => sum + k.value, 0)
}

/** 그룹 합계의 월별 시계열. 스파크라인이 이걸 그린다. */
export function groupSeries(
  kpis: FinanceKpi[],
  metric: FinanceMetric,
  businessIds?: BusinessId[],
): number[] {
  return periodsOf(kpis).map((p) => groupValue(kpis, metric, p, businessIds))
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
export function businessProgress(projects: Project[], businessId: BusinessId): number {
  const own = projects.filter((p) => p.business_id === businessId)
  if (own.length === 0) return 0
  return Math.round(own.reduce((sum, p) => sum + p.progress_pct, 0) / own.length)
}

/** 재무 행이 하나도 없는 회사(CH-002로 방금 추가된 회사)는 숫자를 0으로 쓰면 안 된다. */
export function hasFinanceData(kpis: FinanceKpi[], businessId: BusinessId): boolean {
  return kpis.some((k) => k.business_id === businessId)
}
