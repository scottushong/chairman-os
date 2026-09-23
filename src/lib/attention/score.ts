/**
 * ATTENTION SCORE — Phase 7 블록 B-2. §19의 축 여섯을 하나의 점수와 등급으로.
 *
 * **눈금·가중치·경계는 0035 5절이 정했다. 여기서 다시 정하지 않는다** — 그 파일이
 * 「눈금 0~10 · 가중치 합 100 · 경계 70/40 · `ceo_ability`는 역방향 · 없는 축을 0으로
 * 채우지 않고 있는 축의 가중치 합으로 나눈다」를 이미 못 박았고, 이 파일은 그 문장을
 * 코드로 옮긴 것뿐이다. 두 벌이 되면 언젠가 한쪽만 고쳐진다(0033의 §7 식이 SQL과 TS
 * 두 벌이 되었을 때 검사가 같은 고정 입력으로 둘을 맞춘 것이 그 선례다).
 *
 * ■ 이 파일의 핵심은 점수가 아니라 **«언제 등급을 내지 않는가»**다 ■
 *   오늘 이 저장소가 실제로 잴 수 있는 축은 **여섯 중 하나**(`financial_impact`)뿐이다.
 *   나머지 다섯에는 출처가 없다 — `ceo_ability`는 블록 D의 `ceo_scores`가,
 *   `capital_requirement`는 블록 C의 `capital_requests`가 들고 온다. `strategic_impact` ·
 *   `urgency` · `probability`는 오늘 어느 표도 답하지 않는다.
 *   **AI에게 물어서 채우지 않는다** — 지어낸 축이 RED를 만들면 회장이 없는 근거로 회사를
 *   흔들게 된다(0035 머리 주석).
 *   축 하나로 낸 점수를 여섯 축을 다 잰 점수인 양 내놓지 않으려고, 축이 모자라면
 *   **`score`와 `level`을 둘 다 null로 둔다.** 그때 `exceptions.severity`는 규칙의
 *   `severity_base`에 머문다 — 그것이 0035가 그 칸을 «출발점»이라 부른 이유다.
 */
import {
  ATTENTION_AXES,
  type AttentionAxis,
  type AttentionLevel,
  type RuleComparator,
} from '@/types'

/* ------------------------------------------------------------------ 0035 5절의 값들 */

/** 합 100. 재무가 가장 무거운 이유는 0035 5절에 있다(§18의 13개 중 넷이 돈이다). */
export const AXIS_WEIGHT: Record<AttentionAxis, number> = {
  financial_impact: 25,
  strategic_impact: 20,
  urgency: 20,
  probability: 15,
  ceo_ability: 10,
  capital_requirement: 10,
}

/** 축의 눈금. 0~10 정수다. */
export const AXIS_MAX = 10

/** 경계. `>= 70` RED · `>= 40` YELLOW · 나머지 GREEN. */
export const LEVEL_BOUNDARY = { red: 70, yellow: 40 } as const

/**
 * **등급을 내려면 축이 최소 몇 개 있어야 하는가 — 이것이 B-2의 판단이다.**
 *
 * **셋이다. 근거는 로드맵이고, 그 로드맵이 이 숫자의 천장을 정한다.**
 * 출처가 약속된 축은 셋뿐이다 — `financial_impact`(오늘) · `ceo_ability`(블록 D의
 * `ceo_scores`) · `capital_requirement`(블록 C의 `capital_requests`). 나머지 셋
 * (`strategic_impact` · `urgency` · `probability`)에는 그것을 들고 올 블록이 **오늘 계획에
 * 아예 없다**(`AXIS_MISSING_SOURCE_KO`가 축마다 그 사실을 적고 있다).
 * 그러므로 **계획이 전부 이행돼도 닿을 수 있는 축 수는 셋**이고, 바닥이 셋보다 크면
 * `attentionScore()`는 **영원히** null을 돌려준다 — 그것이 아래 버린 선택지 ②의 결과와
 * 같고, 그 결과를 피하려고 ②를 버려 놓고 같은 곳에 도착하는 것이 이 자리에서 실제로
 * 한 번 일어난 실수다(리뷰가 잡았다).
 *
 * **0035:413의 "넷 남짓" 문장을 근거로 쓰지 않는다.** 그 문장은 *"70은 여섯 축 중 넷
 * 남짓이 높을 때 닿는 값이다"* — **여섯 축이 다 있을 때 70이 무슨 뜻인가**를 말하는
 * 문장이지 최소 축 수를 말하는 문장이 아니다. 아래의 «있는 축 가중치로 나누기» 아래에서는
 * 축 넷이 7점이면 나머지 둘이 있든 없든 70에 닿는다. 처음에 그 문장으로 4를 정당화했고,
 * 그것은 문장이 하지 않은 말을 빌려 쓴 것이었다.
 *
 * ■ 셋이 지는 빚 — **이 등급은 여섯 축을 다 잰 등급이 아니다** ■
 *   축 셋이 닿는 가중치는 100 중 **45**다(재무 25 + CEO 능력 10 + 자본 10). 나머지 55는
 *   재지 못한 것이고, 식은 그 55를 **없는 것으로 치고 45를 100으로 환산한다.**
 *   그래서 이 등급은 `unknown_axes` 없이 내보이면 45의 근거가 100의 근거인 척한다.
 *   `unknown_axes`는 행에 항상 같이 들어가고(0035의 check가 실제 null 개수에 묶는다),
 *   **화면은 등급 옆에 그 숫자를 반드시 적는다**(B-3). 그 둘을 떼는 것이 이 파일이 막는
 *   마지막 거짓이다.
 *
 * 버린 선택지 ①: 축이 하나라도 있으면 등급을 낸다 — 오늘 모든 예외가 축 하나(가중치
 * 100 중 25)로 등급을 받게 되고, 재무 영향이 낮은 현금 위기가 GREEN으로 내려간다
 * (**가리는 방향**).
 * 버린 선택지 ②: 여섯이 다 있어야 한다 — 계획이 다 와도 셋뿐이라 영원히 등급이 없다.
 * 버린 선택지 ③: 가중치 합으로 바닥을 건다(예: Σw ≥ 50) — 더 정확한 축이지만 오늘
 * 로드맵이 닿는 최대가 45라 ②와 같아진다. 축이 늘어나는 날 이 숫자 대신 그쪽으로 옮기는
 * 것이 맞고, 그때 옮길 자리가 이 상수 하나다.
 */
export const MIN_AXES_FOR_LEVEL = 3

/**
 * 오늘 계획이 «출처를 들고 오겠다»고 약속한 축의 수. `MIN_AXES_FOR_LEVEL`이 이보다 크면
 * 등급이 영원히 나오지 않는다 — 그 관계를 글이 아니라 값으로 남겨 둔다.
 */
export const AXES_WITH_PLANNED_SOURCE = 3

/* ------------------------------------------------------------------ 축 한 벌 */

/** 축 하나. 값과 출처는 **같이 있거나 같이 없다**(0035의 check 제약이 그것을 묶는다). */
export interface Axis {
  value: number
  /** 이 축이 어디서 나왔나. 비어 있으면 DB가 받지 않는다. */
  source: string
}

/** 축 여섯. 출처가 없는 축은 null이다 — 0이 아니다. */
export type AxisSet = Partial<Record<AttentionAxis, Axis | null>>

export interface ScoreResult {
  /** 0~100. 축이 모자라면 null. */
  score: number | null
  /** score와 «둘 다 있거나 둘 다 없다». */
  level: AttentionLevel | null
  /** 여섯 중 빈 칸 수. 0035의 check가 이 숫자를 실제 null 개수에 묶는다. */
  unknown_axes: number
  /** 등급을 내지 않았으면 그 이유. 화면과 보고가 그대로 쓴다. */
  no_level_reason: string | null
}

/** 0~10 정수로 자른다. 축 범위를 벗어난 값은 DB가 23514로 거절하므로 여기서 먼저 막는다. */
export function clampAxis(v: number): number {
  return Math.min(AXIS_MAX, Math.max(0, Math.round(v)))
}

/**
 * §19의 식. **0035 5절의 문장 그대로다.**
 *
 *   score = round( Σ(w_i × v_i) / Σ(w_i) × 10 , 1 )   — i는 «값이 있는» 축만
 *
 * `ceo_ability`만 `10 - v`로 들어간다(역방향 — 그 축이 높으면 회장이 볼 이유가 줄어든다).
 * 없는 축을 0으로 채우지 않는다: 채우면 축이 빈 행이 조용히 낮은 점수를 받아 GREEN으로
 * 내려가고, 회장은 그것을 "정상"으로 읽는다.
 */
export function attentionScore(axes: AxisSet): ScoreResult {
  const present = ATTENTION_AXES.filter((a) => (axes[a] ?? null) !== null)
  const unknown_axes = ATTENTION_AXES.length - present.length

  if (present.length < MIN_AXES_FOR_LEVEL) {
    return {
      score: null,
      level: null,
      unknown_axes,
      no_level_reason: `여섯 축 중 ${present.length}개만 재어 등급을 내지 않는다(최소 ${MIN_AXES_FOR_LEVEL}개)`,
    }
  }

  let weighted = 0
  let weights = 0
  for (const axis of present) {
    const raw = (axes[axis] as Axis).value
    const v = axis === 'ceo_ability' ? AXIS_MAX - raw : raw
    weighted += AXIS_WEIGHT[axis] * v
    weights += AXIS_WEIGHT[axis]
  }

  const score = Math.round((weighted / weights) * 10 * 10) / 10
  return { score, level: levelOf(score), unknown_axes, no_level_reason: null }
}

/** 경계 둘. 0035가 check 제약으로 묶지 **않은** 자리라, 고치는 곳이 이 한 줄이다. */
export function levelOf(score: number): AttentionLevel {
  if (score >= LEVEL_BOUNDARY.red) return 'RED'
  if (score >= LEVEL_BOUNDARY.yellow) return 'YELLOW'
  return 'GREEN'
}

/* ------------------------------------------------------------------ 오늘 출처가 있는 축 하나 */

/**
 * `financial_impact` — **오늘 출처가 있는 유일한 축이다.**
 *
 * 출처는 «잰 값이 임계를 얼마나 넘어섰는가»다. 규칙이 걸렸다는 사실만으로는 1과 10을
 * 가를 수 없고, 그 사이를 메울 다른 수치가 이 저장소에 없다.
 *
 * **눈금 잡는 방법은 판단이다:** 임계를 넘어선 정도를 임계 자신으로 나눠 비율로 보고,
 * 0%(임계에 막 올라섬)를 **1**, 100%(임계의 두 배만큼 벗어남)를 **10**에 놓는다.
 *   · 임계에 막 올라선 것을 **0이 아니라 1**로 두는 것이 이 함수에서 가장 중요한 줄이다.
 *     0이면 걸린 예외가 «재무 영향 없음»이 되고, 그 방향의 거짓이 이 저장소가 가장
 *     나쁘다고 거듭 못 박은 «적게 세는 쪽»이다.
 *   · 임계가 0인 규칙에서는 비율이 서지 않는다 → **null**(출처 없음)이다. 0으로 채우지 않는다.
 *
 * 값과 임계가 만드는 비율은 **비교자의 방향을 따른다** — `<`·`<=`는 아래로 벗어난 만큼,
 * `>`·`>=`는 위로, `abs>`는 절댓값으로. 방향을 무시하면 런웨이 2개월이 «임계보다 4 작다»가
 * 아니라 «임계를 4 넘었다»로 읽힌다.
 */
export function financialImpactAxis(input: {
  rule_key: string
  rule_name: string
  comparator: RuleComparator | string
  value: number
  threshold: number
}): Axis | null {
  const { comparator, value, threshold } = input
  if (!Number.isFinite(threshold) || Math.abs(threshold) < 1e-9) return null
  if (!Number.isFinite(value)) return null

  let excess: number
  switch (comparator) {
    case '<':
    case '<=':
      excess = (threshold - value) / Math.abs(threshold)
      break
    case '>':
    case '>=':
      excess = (value - threshold) / Math.abs(threshold)
      break
    case 'abs>':
      excess = (Math.abs(value) - Math.abs(threshold)) / Math.abs(threshold)
      break
    default:
      // 모르는 비교자는 여기까지 오지 않는다(rules.ts가 먼저 건너뛴다). 그래도 추측하지 않는다.
      return null
  }

  const ratio = Math.max(0, excess)
  return {
    value: clampAxis(1 + ratio * 9),
    source: `규칙 ${input.rule_key}(${input.rule_name}) — 잰 값 ${value}가 임계 ${threshold}를 넘어선 정도(0035 5절 눈금 0~10)`,
  }
}

/**
 * 오늘 «출처가 없다»고 말해야 하는 축 다섯과 그 출처가 **어느 블록에서 오는가.**
 * 화면(B-3)이 빈 칸마다 다른 문장을 적을 수 있게 여기 한 벌로 둔다 —
 * 다섯이 전부 같은 이유로 빈 것이 아니다.
 */
export const AXIS_MISSING_SOURCE_KO: Record<Exclude<AttentionAxis, 'financial_impact'>, string> = {
  strategic_impact: '오늘 이 저장소에 전략 영향을 재는 표가 없다. AI에게 물어 채우지 않는다.',
  urgency: '오늘 긴급도를 재는 표가 없다. 규칙의 창(window_days)은 «언제 쟀나»이지 «얼마나 급한가»가 아니다.',
  probability: '오늘 확률을 재는 표가 없다. 규칙은 이미 일어난 것을 잡는다.',
  ceo_ability: '블록 D의 ceo_scores가 들고 온다.',
  capital_requirement: '블록 C의 capital_requests가 들고 온다.',
}
