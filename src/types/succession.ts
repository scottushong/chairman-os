/**
 * 승계(SUCCESSION)의 어휘 — Phase 7 블록 A (0033).
 *
 * 문서 §7(Founder Dependency) · §9(Autonomy Level) · §11(Succession System) ·
 * §12(Absence Test) · §20(Direction) · §21(Chairman Letter)가 쓰는 값들을 한곳에 둔다.
 *
 * **값의 목록은 0033의 check 제약과 글자 하나까지 같아야 한다.** 갈라지면 화면이
 * DB가 받아 주지 않는 값을 그리고, 저장 버튼을 누르는 순간에야 23514로 터진다.
 * 검사(scripts/check-dependency.ts)가 두 목록을 실제로 맞춰 본다.
 *
 * **null이 이 파일의 주인공이다.** level·transfer_status·autonomy·dependency_pct는
 * 전부 null이 될 수 있고, 그 null은 전부 다른 사실을 말한다 — '아직 평가 안 함',
 * '이양 계획 없음', '역산이 닿지 않음', '셀 결정이 없음'. 그래서 화면이 빈 칸마다
 * 다른 문장을 적는다. 그 문장들도 여기 있다(…_EMPTY_KO).
 */
import type { BusinessId, IsoDate, UserId } from './primitives'

/* ------------------------------------------------------------------ §7 의존 영역 */

/** 0033 dependency_areas_level_check와 같은 셋. */
export const DEPENDENCY_LEVEL = ['HIGH', 'MEDIUM', 'LOW'] as const
export type DependencyLevel = (typeof DEPENDENCY_LEVEL)[number]

export const DEPENDENCY_LEVEL_LABEL_KO: Record<DependencyLevel, string> = {
  HIGH: '높음',
  MEDIUM: '보통',
  LOW: '낮음',
}

/** 0033 dependency_areas_transfer_check와 같은 셋. */
export const TRANSFER_STATUS = ['done', 'in_progress', 'not_started'] as const
export type TransferStatus = (typeof TRANSFER_STATUS)[number]

export const TRANSFER_STATUS_LABEL_KO: Record<TransferStatus, string> = {
  done: '이양 완료',
  in_progress: '이양 중',
  not_started: '미이양',
}

/**
 * 빈 칸이 말하는 것. **'미평가'와 '낮음'은 다른 사실이고, '계획 없음'과 '미이양'도 다르다.**
 * 그 둘을 같은 글자로 그리면 이 화면은 정확히 반대의 것이 된다.
 */
export const DEPENDENCY_LEVEL_EMPTY_KO = '아직 평가하지 않음'
export const TRANSFER_STATUS_EMPTY_KO = '이양 계획 없음'

export interface DependencyArea {
  id: number
  business_id: BusinessId
  area: string
  /** 문서 §7의 영문 영역명(Pricing 등). 기존 방식(name/name_en)을 따른다. */
  area_en: string | null
  /** null = 아직 평가하지 않았다. LOW가 아니다. */
  level: DependencyLevel | null
  /** null = 이양 계획이 아직 없다. not_started가 아니다. */
  transfer_status: TransferStatus | null
  target_date: IsoDate | null
  note: string | null
  sort_order: number
}

/* ------------------------------------------------------------------ §9 자율성 */

export const AUTONOMY_LEVEL = ['L1', 'L2', 'L3', 'L4', 'L5'] as const
export type AutonomyLevel = (typeof AUTONOMY_LEVEL)[number]

/**
 * §9의 다섯 줄을 **그대로** 옮긴 것. 문구를 고치지 않는다 —
 * 이 표는 /dependency/settings에서 "무엇이 L4인가"의 유일한 답이고, 요약하면
 * 회장과 CEO가 서로 다른 기준으로 같은 글자를 쓰게 된다.
 */
export const AUTONOMY_CRITERIA_KO: Record<AutonomyLevel, string> = {
  L1: '주요 의사결정에 회장 승인이 필요하다.',
  L2: '일상 운영은 독립적이다. 주요 전략 결정은 승인이 필요하다.',
  L3: 'P&L을 전적으로 책임진다. 임계 미만의 투자는 스스로 승인한다.',
  L4: '전략·사람·운영이 독립적이다. 회장은 주요 자본 결정만 승인한다.',
  L5: 'BERKSHIRE MODE — CEO가 회사를 독립적으로 운영한다. 회장은 자본 · CEO 선임과 해임 · 주요 방향 · 예외적 위험만 본다.',
}

/** §9 원문의 영문 라벨. L5만 이름이 따로 있다. */
export const AUTONOMY_TAG_EN: Record<AutonomyLevel, string> = {
  L1: 'Chairman approval required',
  L2: 'Independent daily operations',
  L3: 'Full P&L responsibility',
  L4: 'Independent strategy / people / operations',
  L5: 'BERKSHIRE MODE',
}

export const AUTONOMY_EMPTY_KO = '아직 평가 없음'

export interface AutonomyAssessment {
  id: number
  business_id: BusinessId
  /** YYYY-Qn. 0033의 autonomy_quarter_format와 같은 모양. */
  quarter: string
  level: AutonomyLevel
  assessed_by: UserId | null
  note: string | null
}

/* ------------------------------------------------------------------ §12 부재 테스트 */

/**
 * **넷이다.** 원문 지시는 30/90/365 셋을 적었지만 문서 §12가 7/30/90/365 넷을 말하고,
 * 둘이 어긋나면 문서가 이긴다. 0033 absence_tests_days_check와 같은 넷.
 */
export const ABSENCE_DAYS = [7, 30, 90, 365] as const
export type AbsenceDays = (typeof ABSENCE_DAYS)[number]

export const ABSENCE_RESULT = ['pass', 'fail', 'pending'] as const
export type AbsenceResult = (typeof ABSENCE_RESULT)[number]

export const ABSENCE_RESULT_LABEL_KO: Record<AbsenceResult, string> = {
  pass: '통과',
  fail: '실패',
  pending: '예정 / 미실시',
}

export interface AbsenceTest {
  id: number
  business_id: BusinessId
  days: AbsenceDays
  scheduled_on: IsoDate
  result: AbsenceResult
  note: string | null
}

/* ------------------------------------------------------------------ §20 · §21 */

/**
 * Direction(§20) + Chairman Letter(§21). 칸 이름은 0033과 같다.
 *
 * §20의 do_not(회사가 하지 말 것)과 §21의 not_managed(회장이 관리하지 않을 것)는
 * 다른 사실이다. 접지 않는다 — 승계 문서에서 그 둘은 반대말에 가깝다.
 */
export interface ChairmanDirection {
  business_id: BusinessId
  five_year: string | null
  priorities: string[]
  do_not: string[]
  contact_when: string[]
  why_own: string | null
  capital_philosophy: string | null
  cares_about: string[]
  not_managed: string[]
  red_lines: string[]
  letter: string | null
  updated_at: string | null
}

/** §21이 요구하는 일곱 필드. /dependency/settings와 편집 화면이 같은 목록을 쓴다. */
export const LETTER_FIELDS = [
  { key: 'why_own', label: '이 회사를 왜 보유하는가', doc: 'Why we own this company' },
  { key: 'five_year', label: '5년 목표', doc: '5-year objective' },
  { key: 'capital_philosophy', label: '자본 철학', doc: 'Capital philosophy' },
  { key: 'cares_about', label: '회장이 신경 쓰는 것', doc: 'Things Chairman cares about' },
  { key: 'not_managed', label: '회장이 관리하지 않는 것', doc: 'Things Chairman does NOT want to manage' },
  { key: 'red_lines', label: '넘으면 안 되는 선', doc: 'Red lines' },
  { key: 'contact_when', label: '회장에게 연락할 때', doc: 'When to contact Chairman' },
] as const

/* ------------------------------------------------------------------ §7 지표 */

/** 0033의 decisions_decided_by_kind_check와 같은 셋. null은 값이 아니다. */
export const DECIDED_BY_KIND = ['chairman', 'ceo', 'rule'] as const
export type DecidedByKind = (typeof DECIDED_BY_KIND)[number]

export const DECIDED_BY_KIND_LABEL_KO: Record<DecidedByKind, string> = {
  chairman: '회장이 정함',
  ceo: 'CEO · 팀장 선에서 종결',
  rule: '규칙 자동 종결',
}

export const DECIDED_BY_KIND_HINT_KO: Record<DecidedByKind, string> = {
  chairman: '회장 결재 큐에서 회장이 승인·반려·수정요청·위임한 건입니다.',
  ceo: '회사 안에서 CEO·임원·팀장이 닫은 건입니다. 회장은 관여하지 않았습니다.',
  rule: '사람이 아니라 규칙이 닫은 건입니다. 오늘 이 시스템에는 이 경로가 아직 없습니다 — 야간 Job은 결정을 쓰지 못합니다(0013).',
}

/**
 * 뷰 founder_dependency 한 줄. 회사 × 월(KST).
 *
 * **unknown_count가 이 타입에서 제일 중요한 칸이다.** 역산이 닿지 않아 분자에서도
 * 분모에서도 빠진 건수다. 화면이 이 숫자를 지우면 백분율만 남고, 그 백분율은
 * 몇 건에서 나왔는지 알 수 없는 숫자가 된다.
 */
export interface FounderDependencyRow {
  business_id: BusinessId
  /** YYYY-MM (KST) */
  period: string
  chairman_count: number
  ceo_count: number
  rule_count: number
  /** 분모. decided_by_kind가 있는 행만. */
  total_count: number
  /** 역산이 닿지 않아 뺀 행의 수. */
  unknown_count: number
  /** total_count가 0이면 null. 0%가 아니다. */
  dependency_pct: number | null
}

/** 뷰 interventions 한 줄. 회사 × 월(KST) × 유형. */
export interface InterventionRow {
  business_id: BusinessId
  period: string
  /**
   * `audit_log.action` — approve/reject/modify/delegate/**monitor**.
   * 앞의 넷은 0001의 값이고, `monitor`(관찰 N일)는 0035가 더했다.
   *
   * **이 목록에 값을 더하면 `INTERVENTION_LABEL_KO`에도 같이 더한다.** 화면의 유형별
   * 막대가 그 표에서 나오므로(하드코딩한 배열이 아니다), 라벨이 빠진 유형은 월 합계에는
   * 들어가는데 막대에서는 사라진다 — 0035가 `monitor`를 더했을 때 실제로 그랬다.
   */
  kind: 'approve' | 'reject' | 'modify' | 'delegate' | 'monitor'
  count: number
}

export const INTERVENTION_LABEL_KO: Record<InterventionRow['kind'], string> = {
  approve: '승인',
  reject: '반려',
  modify: '수정요청',
  delegate: '위임',
  monitor: '관찰',
}

/**
 * 화면이 유형별 막대를 그릴 순서. **라벨 표에서 뽑는다** — 배열을 따로 적어 두면
 * 새 유형이 들어온 날 한쪽만 고쳐지고, 빠진 유형은 월 합계에만 남아 막대의 합이
 * 합계와 달라진다(0035의 `monitor`가 그 자리였다).
 */
export const INTERVENTION_KINDS = Object.keys(INTERVENTION_LABEL_KO) as InterventionRow['kind'][]
