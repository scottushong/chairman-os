/**
 * 규칙 평가 — Phase 7 블록 B-2. §18 파이프라인의 첫 화살표
 * (`Raw Data → Rule Engine → AI Analysis → Severity → Chairman Attention`).
 *
 * **저장소가 아니다. 순수 함수만 있다.** 입력은 «규칙 한 줄 + 그 회사의 수치»이고
 * 출력은 «걸렸나 / 잰 값 / 못 쟀다»뿐이다. DB 없이 잴 수 있어야 하고(lib/dependency.ts ·
 * lib/ledger/*가 그 모양이다), 이 파일이 그것을 지키는 방법은 하나다 — 여기서 아무것도
 * 읽지 않고 아무것도 쓰지 않는다.
 *
 * 이 파일이 지키는 규칙은 셋이다.
 *
 * ① **`kind='metric'`인 규칙만 평가한다.** 0035의 시드 13종 중 열은 `manual`이고,
 *   그것은 사람이 세우는 플래그다. 야간 Job이 그것을 «감지»하는 척하면 안 된다 —
 *   수치가 없는데 걸렸다고 말하는 것이 이 블록에서 가장 나쁜 거짓말이다.
 *
 * ② **모르는 것은 건너뛰고, 건너뛴 사실을 돌려준다.** 모르는 비교자를 `>`로 추측해 읽지
 *   않고, 잴 식이 없는 규칙을 «안 걸렸다»로 접지 않는다. 호출자(야간 Job)가 그 사실을
 *   회사 행에 남긴다.
 *
 * ③ **수치가 없으면 «정상»이 아니라 «못 쟀다»다.** 그 회사·그 기간의 `finance_kpis` 행이
 *   없으면 그 회사는 측정되지 않은 것이다. 둘을 같은 결과로 접으면 데이터가 끊긴 회사가
 *   전부 초록으로 보이고, 그것이 이 엔진이 막으려는 바로 그 그림이다.
 */
import { addMonths } from '@/lib/ledger/basis'
import { RULE_COMPARATOR, type ExceptionRule, type FinanceMetric, type PeriodKey } from '@/types'

/** 0035가 허용한 다섯. 목록이 두 벌이 되지 않게 어휘 파일에서 가져온다. */
const KNOWN_COMPARATORS: readonly string[] = RULE_COMPARATOR

/* ------------------------------------------------------------------ 입력 */

/** `finance_kpis` 한 칸. 이 엔진이 보는 것은 이 셋뿐이다. */
export interface MetricPoint {
  metric: FinanceMetric
  period: PeriodKey
  value: number
}

/**
 * 원장이 낸 런웨이. **이 저장소의 런웨이 정의는 `lib/ledger/analysis.ts`의 `runway()`
 * 하나뿐이고**, 이 엔진은 그 결과를 받아 쓴다. 여기서 현금을 소진으로 나누는 두 번째 식을
 * 만들면 화면의 Runway와 예외의 Runway가 다른 날이 오고, 그러면 둘 다 못 믿는다
 * (lib/ledger/brief-context.ts가 같은 이유로 같은 함수를 부른다).
 *
 * `status`가 답하는 것이 셋이라는 점이 중요하다 — `burning`(잰 개월 수가 있다) ·
 * `not_burning`(**소진이 없다. 재고 나온 사실이지 못 잰 것이 아니다**) ·
 * `unknown`(원장을 못 읽었거나 현금흐름이 비었다 = 못 쟀다).
 */
export interface RunwayReading {
  months: number | null
  status: 'burning' | 'not_burning' | 'unknown'
  /** 어느 달 기준인가. 예외의 `period`가 된다. */
  period: PeriodKey | null
}

/** 한 회사치 수치. 규칙 평가가 보는 입력 전부다. */
export interface CompanyMeasurements {
  business_id: string
  kpis: MetricPoint[]
  runway: RunwayReading
}

/* ------------------------------------------------------------------ 출력 */

/** 평가 자체를 하지 않은 이유. **«안 걸렸다»와 다른 말이다.** */
export type RuleSkipReason =
  | 'manual'
  | 'disabled'
  | 'group_scope'
  | 'unknown_comparator'
  | 'incomplete_rule'
  | 'no_measurement'

/** 평가했지만 잴 수 없었던 이유. **«정상»과 다른 말이다.** */
export type UnmeasuredReason = 'no_kpi' | 'no_baseline' | 'zero_baseline' | 'ledger_unknown'

export const SKIP_REASON_KO: Record<RuleSkipReason, string> = {
  manual: '수동 규칙이라 평가하지 않는다 — 사람이 세우는 플래그다',
  disabled: '회장이 꺼 둔 규칙이다',
  group_scope: '그룹 범위 규칙이다 — 오늘 이 Job은 회사 단위로만 돈다',
  unknown_comparator: '모르는 비교자다 — 추측해서 읽지 않는다',
  incomplete_rule: '수치 규칙인데 임계가 비어 있다 — 0으로 읽지 않는다',
  no_measurement: '수치 규칙인데 이 저장소에 잴 식이 없다 — 지어내지 않는다',
}

export const UNMEASURED_REASON_KO: Record<UnmeasuredReason, string> = {
  no_kpi: '그 기간의 수치가 없다 — 정상이 아니라 못 쟀다',
  no_baseline: '직전 창의 수치가 없어 비교할 대상이 없다',
  zero_baseline: '비교 기준이 0이라 변화율을 낼 수 없다',
  ledger_unknown: '원장이 런웨이를 내지 못했다',
}

export type RuleOutcome =
  /** 걸렸다. `value`가 그 순간 잰 값이고 `threshold`가 그때의 임계다. */
  | { kind: 'triggered'; period: PeriodKey; value: number; threshold: number }
  /**
   * 쟀고 안 걸렸다. `value`가 null인 경우가 하나 있다 — 소진이 없어 런웨이가 유한하지
   * 않은 회사다(`detail`이 그것을 말한다). 그때도 «못 쟀다»가 아니다.
   */
  | { kind: 'clear'; period: PeriodKey; value: number | null; threshold: number; detail?: string }
  | { kind: 'unmeasured'; reason: UnmeasuredReason }
  | { kind: 'skipped'; reason: RuleSkipReason }

export interface RuleEvaluation {
  rule: ExceptionRule
  outcome: RuleOutcome
}

/* ------------------------------------------------------------------ 비교자 */

/**
 * 0035가 허용한 다섯뿐이다. **모르는 글자에는 null을 돌려준다 — `>`로 추측하지 않는다.**
 * `abs>`가 임계에도 절댓값을 씌우는 이유: 회장이 /attention/rules에서 `-20`을 넣어도
 * "±20%를 넘으면"이라는 뜻이 뒤집히지 않게 한다.
 */
export function compare(value: number, comparator: string, threshold: number): boolean | null {
  switch (comparator) {
    case '>':
      return value > threshold
    case '<':
      return value < threshold
    case '>=':
      return value >= threshold
    case '<=':
      return value <= threshold
    case 'abs>':
      return Math.abs(value) > Math.abs(threshold)
    default:
      return null
  }
}

/* ------------------------------------------------------------------ 창과 합 */

/**
 * `window_days`를 달 수로 옮긴다. **`finance_kpis`의 눈금이 달이기 때문이다** —
 * 30일 창은 한 달, 90일 창은 분기(세 달)다. 칸이 비어 있으면 한 달로 본다.
 *
 * **이것은 판단이다.** 규칙 표의 단위(일)와 수치 표의 눈금(달)이 다른데 그 사이를 메울
 * 일별 수치가 이 저장소에 없다. 일 단위로 재는 척하면 «30일»이 «지난 30일»이 아니라
 * «지난달»인 사실이 화면에서 사라진다 — 그 사실은 DEFERRED에 적어 두었다.
 */
export function windowMonths(windowDays: number | null): number {
  if (windowDays === null || !Number.isFinite(windowDays)) return 1
  return Math.max(1, Math.round(windowDays / 30))
}

/** `end`에서 뒤로 `count`달. 오래된 것부터. */
export function windowPeriods(end: PeriodKey, count: number): PeriodKey[] {
  const out: PeriodKey[] = []
  for (let i = count - 1; i >= 0; i -= 1) out.push(addMonths(end, -i))
  return out
}

/**
 * 그 창의 합. **한 달이라도 비면 null이다.** 있는 달만 더하면 데이터가 빠진 달이
 * «매출이 줄었다»로 읽히고, 그 거짓은 정확히 예외를 만들어 내는 방향이다.
 */
function sumIn(points: MetricPoint[], metric: FinanceMetric, periods: PeriodKey[]): number | null {
  let total = 0
  for (const p of periods) {
    const hit = points.find((k) => k.metric === metric && k.period === p)
    if (!hit) return null
    total += hit.value
  }
  return total
}

/** 그 지표의 행이 있는 가장 최근 달. 없으면 null. */
function latestPeriodOf(points: MetricPoint[], metrics: FinanceMetric[]): PeriodKey | null {
  const periods = points
    .filter((k) => metrics.includes(k.metric))
    .map((k) => k.period)
    .sort()
  if (periods.length === 0) return null
  // 지표가 둘이면 **둘 다 있는** 가장 최근 달이어야 한다. 한쪽만 있는 달을 잡으면
  // 바로 다음 줄에서 no_kpi로 떨어지고, 그 달 아래의 멀쩡한 달을 못 보게 된다.
  for (let i = periods.length - 1; i >= 0; i -= 1) {
    const p = periods[i]
    if (metrics.every((m) => points.some((k) => k.metric === m && k.period === p))) return p
  }
  return null
}

/** 소수 한 자리. **비교하기 전에 반올림한다** — 화면에 남는 값이 곧 비교한 값이어야 한다. */
function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/* ------------------------------------------------------------------ 규칙별 식 */

/**
 * 규칙 하나가 «무엇을 재는가»는 `metric` 칸만으로는 나오지 않는다. 0035 3절이 규칙마다
 * 그 뜻을 따로 적어 두었다 — 매출 규칙의 `value`는 **변동률(%)**이고, 마진 규칙의 것은
 * **직전 창 대비 변화(%p)**이며, 현금 규칙의 것은 **개월 수**다. 그래서 식을 `rule_key`에
 * 건다.
 *
 * **여기 없는 `metric` 규칙은 평가하지 않는다**(`no_measurement`). 회장이
 * /attention/rules에서 규칙을 새로 넣는 날 그것이 조용히 안 걸리는 대신 «잴 식이 없다»고
 * 말하게 하려는 것이다. 일반식(그 지표의 값을 그대로 임계와 비교)을 두는 길도 봤지만,
 * 매출(흐름)과 현금(잔액)에 같은 «창»을 적용하는 순간 그 일반식은 둘 중 하나에 거짓이 된다.
 */
type Measure = (rule: ExceptionRule, m: CompanyMeasurements) => RuleOutcome

/** 매출 변동(%). 창의 합을 직전 창의 합과 견준다. */
const measureRevenueVariance: Measure = (rule, m) => {
  const w = windowMonths(rule.window_days)
  const asOf = latestPeriodOf(m.kpis, ['Revenue'])
  if (!asOf) return { kind: 'unmeasured', reason: 'no_kpi' }
  const cur = sumIn(m.kpis, 'Revenue', windowPeriods(asOf, w))
  if (cur === null) return { kind: 'unmeasured', reason: 'no_kpi' }
  const prev = sumIn(m.kpis, 'Revenue', windowPeriods(addMonths(asOf, -w), w))
  if (prev === null) return { kind: 'unmeasured', reason: 'no_baseline' }
  if (prev === 0) return { kind: 'unmeasured', reason: 'zero_baseline' }
  return decide(rule, asOf, round1(((cur - prev) / Math.abs(prev)) * 100))
}

/** EBITDA 마진 변화(%p). 마진 자체가 아니라 **직전 창 대비 변화**다(0035 3절). */
const measureEbitdaMarginDrop: Measure = (rule, m) => {
  const w = windowMonths(rule.window_days)
  const asOf = latestPeriodOf(m.kpis, ['EBITDA', 'Revenue'])
  if (!asOf) return { kind: 'unmeasured', reason: 'no_kpi' }
  const curE = sumIn(m.kpis, 'EBITDA', windowPeriods(asOf, w))
  const curR = sumIn(m.kpis, 'Revenue', windowPeriods(asOf, w))
  if (curE === null || curR === null) return { kind: 'unmeasured', reason: 'no_kpi' }
  const prevEnd = addMonths(asOf, -w)
  const prevE = sumIn(m.kpis, 'EBITDA', windowPeriods(prevEnd, w))
  const prevR = sumIn(m.kpis, 'Revenue', windowPeriods(prevEnd, w))
  if (prevE === null || prevR === null) return { kind: 'unmeasured', reason: 'no_baseline' }
  if (curR === 0 || prevR === 0) return { kind: 'unmeasured', reason: 'zero_baseline' }
  return decide(rule, asOf, round1((curE / curR - prevE / prevR) * 100))
}

/**
 * 현금 런웨이(개월). **원장이 낸 값을 그대로 쓴다**(위 `RunwayReading` 주석).
 * `not_burning`은 «못 쟀다»가 아니다 — 소진이 없어 임계 아래로 내려갈 수가 없는 것이고,
 * 그 사실을 `clear`의 `detail`로 남긴다.
 */
const measureCashRunway: Measure = (rule, m) => {
  const threshold = rule.threshold as number
  if (m.runway.status === 'unknown' || m.runway.period === null) {
    return { kind: 'unmeasured', reason: 'ledger_unknown' }
  }
  if (m.runway.status === 'not_burning') {
    return {
      kind: 'clear',
      period: m.runway.period,
      value: null,
      threshold,
      detail: '현금 소진이 없어 런웨이가 임계 아래로 내려가지 않는다',
    }
  }
  if (m.runway.months === null) return { kind: 'unmeasured', reason: 'ledger_unknown' }
  return decide(rule, m.runway.period, round1(m.runway.months))
}

/** 잰 값을 비교자에 넣는다. 모르는 비교자면 건너뛴다. */
function decide(rule: ExceptionRule, period: PeriodKey, value: number): RuleOutcome {
  const threshold = rule.threshold as number
  const hit = compare(value, rule.comparator ?? '', threshold)
  if (hit === null) return { kind: 'skipped', reason: 'unknown_comparator' }
  return hit
    ? { kind: 'triggered', period, value, threshold }
    : { kind: 'clear', period, value, threshold }
}

/** 오늘 이 저장소가 실제로 잴 수 있는 규칙. §18의 13개 중 셋이다. */
export const MEASURES: Record<string, Measure> = {
  revenue_variance: measureRevenueVariance,
  ebitda_margin_drop: measureEbitdaMarginDrop,
  cash_runway: measureCashRunway,
}

export const MEASURABLE_RULE_KEYS = Object.keys(MEASURES)

/* ------------------------------------------------------------------ 평가 */

/**
 * 규칙 한 줄을 한 회사에 대해 평가한다.
 *
 * 순서에 뜻이 있다 — **먼저 «평가 대상인가»를 가르고**(수동·꺼짐·범위·비교자·식),
 * 그 다음에야 수치를 본다. 뒤집으면 수동 규칙에 대해 수치를 찾다가 `no_kpi`로 떨어지고,
 * 그 보고는 «수치가 없어서 못 쟀다»는 **틀린 이유**를 말하게 된다.
 */
export function evaluateRule(rule: ExceptionRule, m: CompanyMeasurements): RuleOutcome {
  if (rule.kind !== 'metric') return { kind: 'skipped', reason: 'manual' }
  if (!rule.enabled) return { kind: 'skipped', reason: 'disabled' }
  if (rule.scope !== 'company') return { kind: 'skipped', reason: 'group_scope' }
  if (rule.comparator === null || !KNOWN_COMPARATORS.includes(rule.comparator)) {
    return { kind: 'skipped', reason: 'unknown_comparator' }
  }
  if (rule.threshold === null) return { kind: 'skipped', reason: 'incomplete_rule' }
  const measure = MEASURES[rule.rule_key]
  if (!measure) return { kind: 'skipped', reason: 'no_measurement' }
  return measure(rule, m)
}

/** 규칙 전부를 한 회사에 대해. 순서는 `sort_order`(§18의 목록 순서)를 따른다. */
export function evaluateRules(rules: ExceptionRule[], m: CompanyMeasurements): RuleEvaluation[] {
  return [...rules]
    .sort((a, b) => a.sort_order - b.sort_order || a.rule_key.localeCompare(b.rule_key))
    .map((rule) => ({ rule, outcome: evaluateRule(rule, m) }))
}
