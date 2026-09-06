import type { BusinessStatus, Severity, TaskStatus, WorkPriority, SecurityClass } from './enums'
import type {
  AlertId,
  BusinessId,
  Confidence,
  Currency,
  DecisionId,
  IsoDate,
  IsoDateTime,
  Percent,
  PeriodKey,
  ProjectId,
  TaskId,
  UserId,
} from './primitives'

/**
 * 02_데이터필드 / 06_Dummy_Data 기준의 공통 데이터 객체.
 * Business OS와 Chairman OS가 같은 언어로 말하도록 여기 정의를 공유한다.
 */

/** CH-001~005. Dashboard의 Business 카드 한 장. */
export interface Business {
  business_id: BusinessId
  name: string
  status: BusinessStatus
  industry: string
  owner_user_id: UserId
  /** CH-003 숨김/표시. 데이터 삭제가 아니라 표시 플래그다. */
  visible: boolean
  /** CH-005 Drag&Drop 순서. */
  sort_order: number
  /** CH-004 Pin. 정렬 시 항상 앞으로 나온다. */
  pinned?: boolean
}

/** Finance KPI 지표 코드. CH-006~010이 이 위에 올라간다. */
export const FINANCE_METRIC = [
  'Revenue',
  'Cost',
  'EBITDA',
  'Cash',
  'AR',
  'AP',
  'OperatingProfit',
  'NetIncome',
] as const
export type FinanceMetric = (typeof FINANCE_METRIC)[number]

/** 기간 × 회사 × 지표의 한 칸. 합계는 항상 이 원천에서 계산한다. */
export interface FinanceKpi {
  period: PeriodKey
  business_id: BusinessId
  metric: FinanceMetric
  value: number
  currency: Currency
  /** 선택. 목표 대비 비교용(02_데이터필드 KPI.target). */
  target?: number
}

/** CH-020. */
export interface Project {
  project_id: ProjectId
  business_id: BusinessId
  name: string
  owner: UserId
  priority: WorkPriority
  status: TaskStatus
  progress_pct: Percent
  deadline: IsoDate
}

/** CH-040. chairman_needed가 true면 Waiting on Me(CH-017)로 올라온다. */
export interface Task {
  task_id: TaskId
  project_id: ProjectId
  title: string
  owner: UserId
  priority: WorkPriority
  status: TaskStatus
  /**
   * 이 업무가 지금 상태(대기/진행/막힘)로 들어간 날.
   * Chairman 대기의 시작점이라 CH-017 대기일수를 여기서 잰다(DEFERRED D-02 결정 A).
   */
  blocked_since: IsoDate
  deadline: IsoDate
  chairman_needed: boolean
}

export const DECISION_STATUS = ['Open', 'Approved', 'Rejected', 'Modified', 'Delegated'] as const
export type DecisionStatus = (typeof DECISION_STATUS)[number]

/**
 * 화면 표기. 처리 '행동'의 이름(decision-log.ts의 DECISION_ACTION_LABEL_KO)과 글자가 겹치지만
 * 축이 다르다 — 저쪽은 버튼에 쓰는 동사고 이쪽은 결정이 지금 어떤 상태인가다.
 */
export const DECISION_STATUS_LABEL_KO: Record<DecisionStatus, string> = {
  Open: '대기',
  Approved: '승인됨',
  Rejected: '거절됨',
  Modified: '수정요청',
  Delegated: '위임됨',
}

/** CH-015/016. options는 시트에 'A|B|C' 형태로 들어와 배열로 정규화한다. */
export interface Decision {
  decision_id: DecisionId
  business_id: BusinessId
  title: string
  options: string[]
  ai_recommendation: string
  impact: WorkPriority
  deadline: IsoDate
  status: DecisionStatus
  /** 0~1. 시드에는 없다(gen-seed-sql.ts). 값이 없으면 화면에서 신뢰도 줄을 아예 빼는 게 맞다. */
  ai_confidence?: Confidence
  /** CH-041 첨부. 사내 스토리지 링크만이다 — 파일 실체는 Chairman OS에 없다(0006). */
  attachment_url?: string
}

export const ALERT_STATUS = ['Open', 'Acknowledged', 'Resolved'] as const
export type AlertStatus = (typeof ALERT_STATUS)[number]

/** 09번 Alert/Escalation Engine의 Trigger 분류. */
export const ALERT_CATEGORY = [
  'Cash',
  'AR',
  'Sales',
  'EBITDA',
  'Margin',
  'Inventory',
  'Production',
  'Quality',
  'Customer',
  'Project',
  'Contract',
  'HR',
  'Compliance',
  'AI Anomaly',
] as const
export type AlertCategory = (typeof ALERT_CATEGORY)[number]

/** CH-018. Rule이 잡았는지 AI가 잡았는지를 source로 구분한다. */
export interface Alert {
  alert_id: AlertId
  business_id: BusinessId
  category: AlertCategory
  message: string
  severity: Severity
  source: 'Rule' | 'AI'
  status: AlertStatus
}

/**
 * CH-042 중앙 문서.
 *
 * 이름을 Document로 두지 않는다 — DOM의 전역 Document와 겹쳐서, 화면 코드에서
 * 어느 쪽을 가리키는지가 import 줄을 봐야만 알 수 있게 된다.
 *
 * storage_url은 사내 스토리지 링크다. 파일 실체는 Chairman OS에 없다(0007).
 * business_id의 'group'은 DB의 NULL(그룹 공통 문서)에 대응한다 — goals와 같은 규약이다.
 */
export interface DocumentRecord {
  document_id: string
  business_id: BusinessId | 'group'
  title: string
  doc_type: string
  /** 이 값이 접근 판정의 입력이다. 등급이 모자란 사람에게는 행 자체가 안 보인다(0002). */
  security_class: SecurityClass
  storage_url: string
  version: number
  /** 등록자의 표시 이름. 프로필을 못 찾으면 '미지정'이다(DEFERRED D-09 결정 B). */
  uploaded_by: string
  created_at: IsoDateTime
}

/** CH-034. 생산 실적/수율/비가동. */
export interface MesRecord {
  date: IsoDate
  line: string
  batch_id: string
  product_code: string
  production_qty: number
  yield_pct: Percent
  downtime_hr: number
  utilization_pct: Percent
}

/** CH-036. security_class가 Restricted 이상이면 화면에서 값을 가린다. */
export interface RndRecord {
  rnd_id: string
  product_code: string
  project: string
  version: string
  status: string
  next_date: IsoDate
  security_class: SecurityClass
}

/**
 * CH-035. 실제 배합비는 Vault라 외주/개발 환경에는 Dummy Code만 내려온다.
 * display_name이 'DUMMY-*'인 것은 원료명이 마스킹된 상태라는 뜻이다.
 */
export interface BomRecord {
  product_code: string
  raw_material_code: string
  ratio_pct: Percent
  unit: string
  display_name: string
}

/** 09_Night Job Pipeline의 6단계 산출물 종류. */
export const NIGHT_JOB_TYPE = [
  'Research',
  'Vendor Scout',
  'Finance',
  'Risk',
  'Task Generation',
  'Decision Memo',
] as const
export type NightJobType = (typeof NIGHT_JOB_TYPE)[number]

/** CH-019 AI Did Last Night. 요약만이 아니라 artifact_link가 있어야 한다. */
export interface AiNightOutput {
  completed_at: IsoDateTime
  business_id: BusinessId
  job_type: NightJobType
  result_summary: string
  status: 'Done' | 'Running' | 'Failed'
  artifact_link: string
  confidence: Confidence
}
