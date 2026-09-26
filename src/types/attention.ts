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

/* ------------------------------------------------------------------ 화면의 낱말 (B-3) */

/**
 * **«결정 아님» — 이 낱말은 상수이고, 이것을 끄는 prop은 없다.**
 *
 * §19: *"AI가 CEO를 대신하지 않는다. AI는 Chairman에게 «어디를 볼 것인가»를 알려준다."*
 * `exceptions.ai_analysis`를 보이는 컴포넌트는 이 라벨을 **언제나** 같이 그린다
 * (`components/attention/pieces.tsx`의 `AiAnalysis`). 라벨을 prop으로 열어 두면 어느
 * 화면에서 «이 자리에는 좁아서 안 넣는다»가 한 번 일어나고, 그 화면에서 회장은 모델의
 * 문장을 판정으로 읽는다. 0035 4절이 «화면의 «결정 아님» 라벨이 이 칸에서 나온다»고
 * 적었고 컨트롤러가 plan-of-record에 그 판정을 적었다.
 *
 * 글 **안**에는 넣지 않는다 — 그것은 `brief.ts`의 `formatExceptionAnalysis`가 지키는
 * 자리다(회장이 읽는 문장 셋이 넷이 되면 그 자리가 길어진다).
 */
export const AI_NOT_A_DECISION_KO = '결정 아님'

/**
 * **«없는 것»과 «못 보는 것»을 가르는 문장.** `exceptions_read`는
 * `has_business() and (can_read_restricted() or 쓰는 사람)`이라 **TeamLead·Member에게는
 * 0행**이다(0035 7절). 그들에게 «주의 0건»·«전 회사 정상»이라고 적으면 화면이 거짓을
 * 말한다 — 블록 A가 `interventions`에서 «권한 밖이라 집계되지 않습니다»로 처리한 그 자리와
 * 같은 모양이다.
 */
export const EXCEPTION_BLIND_KO = '이 목록은 열람 권한이 있는 계정에서만 집계됩니다'

/** 분석이 없는 예외. **분석이 없다고 감지를 버리지 않는다**(stage.ts ②) — 그 사실을 적는다. */
export const AI_ANALYSIS_EMPTY_KO = 'AI 원인 분석이 없습니다 (규칙은 걸렸습니다)'

/**
 * `ceo_handling = false`가 뜻하는 것. **«CEO가 손 놓고 있다»가 아니다** —
 * 야간 Job은 CEO의 대응을 알 수 있는 표를 하나도 읽지 못한다(stage.ts의 그 칸 주석이
 * «그 차이는 화면이 적는다(B-3)»고 남겼다). 회장이 «CEO에게 위임»을 누르면 true가 된다.
 */
export const CEO_HANDLING_UNKNOWN_KO = 'CEO 대응 여부는 아직 읽을 표가 없습니다'

/* ------------------------------------------------------------------ §18 회장 액션 셋 */

/**
 * 원문의 세 버튼: **"승인 / 관찰 14일 / CEO에게 위임"**.
 * 세 값이 그대로 `audit_log.action`의 이름이 된다(`monitor`는 0035가 더했다) —
 * 0034의 트리거가 그것을 §7의 개입으로 센다.
 */
export const EXCEPTION_TRIAGE = ['approve', 'monitor', 'delegate'] as const
export type ExceptionTriage = (typeof EXCEPTION_TRIAGE)[number]

export const EXCEPTION_TRIAGE_LABEL_KO: Record<ExceptionTriage, string> = {
  approve: '승인',
  monitor: '관찰 14일',
  delegate: 'CEO에게 위임',
}

/**
 * 원문의 «관찰 **14**일». 0035의 check 제약이 `status='monitoring'`에 `monitor_until`을
 * 요구하므로 둘은 **같이** 들어간다 — 기한 없는 관찰은 관찰이 아니라 조용히 잊는 것이다.
 */
export const MONITOR_DAYS = 14

/**
 * 버튼이 무엇을 바꾸는가. **화면이 누르기 전에 이 문장을 보여 준다** — 세 버튼이 status를
 * 각각 다르게 다루므로, 이름만으로는 무엇이 남는지 알 수 없다.
 */
export const EXCEPTION_TRIAGE_EFFECT_KO: Record<ExceptionTriage, string> = {
  approve: '이 건을 보고 처리를 승인합니다 — 상태가 «종료»가 되고 감사 기록에 «승인»이 남습니다.',
  monitor: `상태가 «관찰 중»이 되고 ${MONITOR_DAYS}일 뒤가 관찰 종료 시점으로 함께 기록됩니다 — 기한 없는 관찰은 두지 않습니다.`,
  delegate:
    'CEO가 대응하는 건으로 표시합니다 — 상태는 «열림» 그대로입니다. 위임은 끝난 것이 아니라 손대는 사람이 바뀐 것입니다.',
}

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
