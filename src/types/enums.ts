/**
 * 06_상태코드 시트의 공통 Enum.
 * 개발팀이 임의 상태명을 만들지 않도록 여기 정의된 코드만 사용한다.
 */

/** BusinessStatus — 활성 / 육성·준비 / 보류 / 매각·Exit / 종료·보관 */
export const BUSINESS_STATUS = ['Active', 'Incubating', 'Hold', 'Exit', 'Archived'] as const
export type BusinessStatus = (typeof BUSINESS_STATUS)[number]

/** TaskStatus — 대기 / 진행 / 막힘 / 완료 */
export const TASK_STATUS = ['Todo', 'Doing', 'Blocked', 'Done'] as const
export type TaskStatus = (typeof TASK_STATUS)[number]

/** Priority — 개발 우선순위(P0/P1/P2)와 업무 중요도(Critical~Low)는 축이 다르다. */
export const DEV_PRIORITY = ['P0', 'P1', 'P2'] as const
export type DevPriority = (typeof DEV_PRIORITY)[number]

export const WORK_PRIORITY = ['Critical', 'High', 'Medium', 'Low'] as const
export type WorkPriority = (typeof WORK_PRIORITY)[number]

/** Severity — 정보 / 경고 / 긴급 */
export const SEVERITY = ['Info', 'Warning', 'Critical'] as const
export type Severity = (typeof SEVERITY)[number]

/** SecurityClass — 일반 / 제한 / 최고민감(Vault). Vault는 외주에 실제값을 주지 않는다. */
export const SECURITY_CLASS = ['Normal', 'Restricted', 'Vault'] as const
export type SecurityClass = (typeof SECURITY_CLASS)[number]

/** 한글 표기. 화면에는 코드가 아니라 이 값을 노출한다. */
export const STATUS_LABEL_KO: Record<BusinessStatus, string> = {
  Active: '활성',
  Incubating: '육성/준비',
  Hold: '보류',
  Exit: '매각/Exit 진행',
  Archived: '종료/보관',
}

export const TASK_STATUS_LABEL_KO: Record<TaskStatus, string> = {
  Todo: '대기',
  Doing: '진행',
  Blocked: '막힘',
  Done: '완료',
}

export const SEVERITY_LABEL_KO: Record<Severity, string> = {
  Info: '정보',
  Warning: '경고',
  Critical: '긴급',
}

export const WORK_PRIORITY_LABEL_KO: Record<WorkPriority, string> = {
  Critical: '긴급',
  High: '높음',
  Medium: '보통',
  Low: '낮음',
}
