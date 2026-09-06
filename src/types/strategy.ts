import type { Severity, WorkPriority } from './enums'
import type { BusinessId, IsoDate, Percent, UserId } from './primitives'

/**
 * 05_Strategic Coordinates. 메인의 4카드(CH-011~014)와
 * Business 상세의 전체 좌표(CH-024)가 같은 객체를 본다.
 */

/** CH-011. 그룹/회사 최상위 목표와 진행률. */
export interface TopGoal {
  goal_id: string
  business_id: BusinessId | 'group'
  title: string
  target_value: string
  current_value: string
  progress_pct: Percent
  due: IsoDate
}

/** CH-012. 이번 달 최우선 과제. Chairman이 직접 고쳐 쓰는 칸이다. */
export interface MonthlyPriority {
  priority_id: string
  business_id: BusinessId | 'group'
  title: string
  detail: string
  owner: UserId
  weight: WorkPriority
}

/** CH-013. Impact/Urgency 순으로 정렬해 상위 1~3개만 노출한다. */
export interface CriticalRisk {
  risk_id: string
  business_id: BusinessId | 'group'
  title: string
  impact: Severity
  urgency: Severity
  detail: string
}

/** CH-014. D-Day는 저장하지 않고 deadline에서 계산한다. */
export interface NextMilestone {
  milestone_id: string
  business_id: BusinessId | 'group'
  title: string
  owner: UserId
  deadline: IsoDate
}

/**
 * CH-024. 회사 상세의 전략 좌표. 회사당 하나다(0008 business_strategy).
 *
 * CH-011~014와 축이 다르다. 저쪽은 측정되는 목표(progress_pct, deadline)고
 * 여기는 방향과 판단이다 — 전부 사람이 쓴 문장이라 계산되는 칸이 없다.
 * gap도 current/target에서 계산하지 않는다. 무엇이 차이인지는 숫자가 아니라 판단이다.
 *
 * next_milestone을 들고 있지 않다. 그 값의 원천은 milestones 표(CH-014)고,
 * 상세 화면은 그 표를 이미 따로 읽는다. 여기에 사본을 두면 두 값이 갈라진다.
 */
export interface BusinessStrategy {
  business_id: BusinessId
  mission: string
  goal_1y: string
  goal_3y: string
  top_kpi: string
  current_position: string
  target_position: string
  gap: string
  current_priority: string
  bottleneck: string
  chairman_comment: string
}
