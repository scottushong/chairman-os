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
