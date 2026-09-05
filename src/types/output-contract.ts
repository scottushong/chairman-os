import type { BusinessStatus } from './enums'
import type { BusinessId, IsoDate, IsoDateTime, Percent, UserId } from './primitives'

/**
 * 04_Data_API 02_Output_Contract 시트 = Business OS → Chairman OS 공통 계약.
 * 각 전용 OS(DY/VANA/Sticky/HOF/Boram)는 내부 구조가 달라도 이 모양으로 내보낸다.
 * 여기서 벗어나면 Chairman OS는 그 회사를 읽지 못한다.
 */

export interface ContractKpi {
  metric_code: string
  label: string
  actual: number
  target?: number
  unit: string
  /** 전기 대비 증감률(%). 없으면 화면에서 추세를 그리지 않는다. */
  delta_pct?: number
}

export interface ContractGoal {
  title: string
  target: string
  current: string
  progress_pct: Percent
}

export interface ContractRisk {
  title: string
  impact: 'Info' | 'Warning' | 'Critical'
  detail: string
}

export interface ContractOpportunity {
  title: string
  detail: string
  expected_value?: number
}

/** 승인/결정 대기. Chairman 화면의 Waiting on Me(CH-017)로 그대로 올라온다. */
export interface ContractWaitingItem {
  ref_id: string
  title: string
  requested_by: UserId
  requested_at: IsoDateTime
  deadline?: IsoDate
}

export interface ContractMilestone {
  title: string
  owner: UserId
  deadline: IsoDate
}

/** 필수 필드는 optional로 두지 않는다. 계약 위반을 타입에서 먼저 잡기 위해서다. */
export interface BusinessOutputContract {
  business_id: BusinessId
  status: BusinessStatus
  top_kpis: ContractKpi[]
  top_goals: ContractGoal[]
  risks: ContractRisk[]
  /** 선택 항목. 04 시트에서 유일하게 '선택'으로 표시된 필드다. */
  opportunities?: ContractOpportunity[]
  waiting_on_chairman: ContractWaitingItem[]
  next_milestones: ContractMilestone[]
  ai_summary: string
  updated_at: IsoDateTime
}

/** Chairman Agent가 회사별 Output을 다시 압축한 결과(Layer 0). */
export interface ChairmanBrief {
  generated_at: IsoDateTime
  today_decisions: string[]
  red_alerts: string[]
  waiting_on_me: string[]
  opportunities: string[]
  summary: string
}
