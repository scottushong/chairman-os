/**
 * 주의(ATTENTION)의 어휘 — Phase 7 블록 B (0035).
 *
 * 문서 §18(EXCEPTION MANAGEMENT ENGINE) · §19(ATTENTION SCORE)가 쓰는 값들을 한곳에 둔다.
 *
 * **값의 목록은 0035의 check 제약·enum과 글자 하나까지 같아야 한다.** 갈라지면 화면이
 * DB가 받아 주지 않는 값을 그리고, 저장하는 순간에야 23514/22P02로 터진다.
 * 승계(succession.ts)가 같은 자리에서 같은 규율을 쓴다.
 *
 * **RED/YELLOW/GREEN은 «얼마나 나쁜가»가 아니라 «누가 손대는가»다**(§19).
 * 0001의 `Severity`(Info/Warning/Critical)와 다른 축이고, 그래서 이름도 타입도 따로다 —
 * 한 낱말이 두 뜻을 갖는 순간 어느 화면이 어느 뜻으로 쓰는지 읽는 사람이 매번 추측하게 된다.
 *
 * **null이 이 파일에서도 주인공이다.** 축 여섯 · `score` · `level` · `value` · `threshold` ·
 * `period`가 전부 null이 될 수 있고, 그 null들은 전부 «재지 못했다»이지 0이 아니다.
 */
import type { FinanceMetric } from './domain'
import type { BusinessId, IsoDate } from './primitives'

/* ------------------------------------------------------------------ §19 등급 */

/** 0035 1절의 `attention_level` enum과 같은 셋. */
export const ATTENTION_LEVEL = ['RED', 'YELLOW', 'GREEN'] as const
export type AttentionLevel = (typeof ATTENTION_LEVEL)[number]

/**
 * §19의 OUTPUT 세 줄을 그대로 옮긴 것. **'긴급/경고/정보'로 번역하지 않는다** —
 * 그것은 severity의 낱말이고, 이 셋이 답하는 것은 '누가 손대는가'다.
 */
export const ATTENTION_LEVEL_LABEL_KO: Record<AttentionLevel, string> = {
  RED: '회장 결정',
  YELLOW: '회장 인지',
  GREEN: 'CEO 처리',
}

/** 낮은 것부터. 정렬은 이 순서의 **반대**로 간다(급한 것이 위). */
const LEVEL_RANK: Record<AttentionLevel, number> = { GREEN: 0, YELLOW: 1, RED: 2 }

/** RED가 가장 크다. 목록을 «급한 것부터»로 세울 때 쓴다. */
export function levelRank(level: AttentionLevel): number {
  return LEVEL_RANK[level]
}

/* ------------------------------------------------------------------ §18 규칙 */

/** 0035 2절 `exception_rules_kind_check`와 같은 둘. */
export const RULE_KIND = ['metric', 'manual'] as const
export type RuleKind = (typeof RULE_KIND)[number]

/**
 * 0035 2절 `exception_rules_comparator_check`와 같은 다섯.
 * **모르는 비교자를 만나면 건너뛴다 — 추측해서 `>`로 읽지 않는다**(lib/attention/rules.ts).
 */
export const RULE_COMPARATOR = ['>', '<', '>=', '<=', 'abs>'] as const
export type RuleComparator = (typeof RULE_COMPARATOR)[number]

export const RULE_SCOPE = ['company', 'group'] as const
export type RuleScope = (typeof RULE_SCOPE)[number]

/**
 * 0035 2절의 한 줄. **네 칸이 nullable인 것이 이 표의 요점이다** —
 * `manual` 규칙에는 그 칸들이 «없는 것»이지 0인 것이 아니다.
 */
export interface ExceptionRule {
  rule_key: string
  name: string
  scope: RuleScope
  kind: RuleKind
  /** manual이면 null. finance_kpis의 어휘 여덟(FINANCE_METRIC). */
  metric: FinanceMetric | null
  /** manual이면 null. 모르는 글자가 오면 평가하지 않는다. */
  comparator: RuleComparator | string | null
  /** manual이면 null. **단위는 규칙마다 다르다**(%·%p·개월) — 0035 2절 주석. */
  threshold: number | null
  window_days: number | null
  severity_base: AttentionLevel
  enabled: boolean
  sort_order: number
}

/* ------------------------------------------------------------------ §18 예외 */

/** 0035 4절 `exceptions_status_check`와 같은 셋. */
export const EXCEPTION_STATUS = ['open', 'monitoring', 'closed'] as const
export type ExceptionStatus = (typeof EXCEPTION_STATUS)[number]

export const EXCEPTION_STATUS_LABEL_KO: Record<ExceptionStatus, string> = {
  open: '열림',
  monitoring: '관찰 중',
  closed: '종료',
}

/**
 * 0035 4절의 한 줄. 감지된 예외 하나.
 *
 * `severity`가 **이 예외의 «지금» 등급이고 화면이 색을 고를 때 읽는 유일한 칸**이다
 * (0035의 `comment on column exceptions.severity`가 그 순서를 못 박았다).
 */
export interface ExceptionRecord {
  id: number
  business_id: BusinessId
  rule_key: string
  detected_at: string
  /** 잰 기간(YYYY-MM). manual 규칙에서는 null. 중복 방지의 키다. */
  period: string | null
  /** 잰 값. **manual 규칙에서는 null — 0이 아니라 없다.** */
  value: number | null
  /** 걸린 순간의 임계. 규칙이 나중에 바뀌어도 그때의 값이 남는다. */
  threshold: number | null
  severity: AttentionLevel
  /** **분석이지 결정이 아니다.** 못 받았으면 null — 분석이 없다고 감지를 버리지 않는다. */
  ai_analysis: string | null
  ceo_handling: boolean
  chairman_action_required: boolean
  status: ExceptionStatus
  monitor_until: string | null
}

/* ------------------------------------------------------------------ §19 점수 */

/**
 * §19의 축 여섯. **배열 순서가 화면·보고의 순서다**(문서가 적은 그 순서).
 * `ceo_ability`는 **역방향**이다 — 높으면 회장이 볼 이유가 줄어든다(0035 5절).
 */
export const ATTENTION_AXES = [
  'financial_impact',
  'strategic_impact',
  'urgency',
  'probability',
  'ceo_ability',
  'capital_requirement',
] as const
export type AttentionAxis = (typeof ATTENTION_AXES)[number]

export const ATTENTION_AXIS_LABEL_KO: Record<AttentionAxis, string> = {
  financial_impact: '재무 영향',
  strategic_impact: '전략 영향',
  urgency: '긴급도',
  probability: '확률',
  ceo_ability: 'CEO 해결 능력',
  capital_requirement: '자본 필요',
}

/**
 * 0035 5절의 한 줄. **축 여섯이 전부 nullable이고 축마다 출처 칸이 있다.**
 * 출처가 없는 축은 null이고(0이 아니다), 몇 개가 비었는지는 `unknown_axes`가 센다.
 */
export interface AttentionScore {
  exception_id: number
  business_id: BusinessId
  financial_impact: number | null
  financial_impact_source: string | null
  strategic_impact: number | null
  strategic_impact_source: string | null
  urgency: number | null
  urgency_source: string | null
  probability: number | null
  probability_source: string | null
  ceo_ability: number | null
  ceo_ability_source: string | null
  capital_requirement: number | null
  capital_requirement_source: string | null
  /** 0~100. **등급을 못 낼 만큼 축이 모자라면 null이다**(lib/attention/score.ts). */
  score: number | null
  /** 그 점수가 낸 등급. score와 «둘 다 있거나 둘 다 없다»(0035 제약). */
  level: AttentionLevel | null
  unknown_axes: number
  scored_at: string
}

/**
 * 빈 칸이 말하는 것. **'재지 못했다'와 '영향 없음'은 다른 사실이다.**
 * 화면이 이 문장을 그대로 적는다(B-3).
 */
export const AXIS_EMPTY_KO = '출처가 없어 재지 못함'
export const LEVEL_EMPTY_KO = '축이 모자라 등급을 내지 않음'

/** 브리핑 맨 위에 서는 한 줄(§18 원문: "기존 브리핑은 attention 3~5건을 맨 위에"). */
export interface AttentionHeadline {
  business_id: BusinessId
  business_name: string
  rule_key: string
  rule_name: string
  severity: AttentionLevel
  chairman_action_required: boolean
  /** 잰 값과 임계. manual 규칙이면 둘 다 null이다. */
  value: number | null
  threshold: number | null
  period: string | null
  detected_on: IsoDate
}
