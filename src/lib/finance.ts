import { sumFigures } from '@/lib/ledger/basis'
import { kpiFigure } from '@/lib/ledger/cells'
import type { BusinessId, Figure, FinanceKpi, FinanceMetric, PeriodKey } from '@/types'

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
 * 회사 카드의 진행률은 **여기서 계산하지 않는다** (Phase 6-1, 컨트롤러 판정 2026-09-21).
 *
 * 2026-09-21까지 이 자리에 businessProgress(projects, businessId)가 있었다. 화면이 받은
 * 프로젝트 목록의 평균이었고, 0027이 projects에 다섯 번째 겹(subtree)을 얹은 그날부터
 * 그 목록은 **보는 사람마다 잘린다**. 같은 회사 카드를 회장은 41%로, 영업 직원은 80%로
 * 보게 된다는 뜻이다. 새는 것은 없지만 '같은 숫자를 서로 다르게 보는 상태'이고,
 * 그런 숫자는 회의에서 둘 중 하나가 틀렸다는 것조차 모른 채 인용된다.
 *
 * 진행률은 회사의 사실이지 개인의 시야가 아니다. 그래서 0028의 company_progress()
 * (security definer 집계, 평균 하나만 내주는 keyhole)가 낸 값을 repository가 받아
 * 화면으로 내려준다 — 재무 KPI가 이미 회사·역할 단위로 보이는 것과 같은 등급이다.
 *
 * 프로젝트 배열에서 평균을 다시 내는 함수를 이 파일에 되살리지 마라. 되살리는 순간
 * 회사 카드가 다시 사람마다 다른 숫자를 말한다.
 */

/** 재무 행이 하나도 없는 회사(CH-002로 방금 추가된 회사)는 숫자를 0으로 쓰면 안 된다. */
export function hasFinanceData(kpis: FinanceKpi[], businessId: BusinessId): boolean {
  return kpis.some((k) => k.business_id === businessId)
}

/**
 * 그룹 합계의 출처 꼬리표까지 같이 (Phase 2-A). groupValue와 같은 칸을 더하되 Figure로 낸다 —
 * 대시보드 숫자도 출처 없이 서지 못한다. 원천 칸이 하나도 없으면 null이다.
 */
export function groupFigure(
  kpis: FinanceKpi[],
  metric: FinanceMetric,
  period: PeriodKey,
  businessIds?: BusinessId[],
): Figure | null {
  return sumFigures(
    kpis
      .filter(
        (k) =>
          k.metric === metric &&
          k.period === period &&
          (!businessIds || businessIds.includes(k.business_id)),
      )
      .map(kpiFigure),
  )
}

/**
 * 최근 n개월만. 0015부터 원장이 24개월을 들고 온다(전년동월비·TTM용).
 * 대시보드 스파크라인과 추이 차트는 여전히 12개월을 그린다 — 두 배로 늘어나면 눈금이 붙는다.
 */
export function recentKpis(kpis: FinanceKpi[], months: number): FinanceKpi[] {
  const keep = new Set(periodsOf(kpis).slice(-months))
  return kpis.filter((k) => keep.has(k.period))
}
