import { DECISION_STATUS_LABEL_KO, type Decision } from '@/types'

/**
 * 결재 상태 한 낱말. 규칙이 바로 종결한 양식 결재(0042 — 팀장 · 직속 상위가 없고 대표 기준 미만)는
 * «승인»이 아니라 «기록 완료»다 — 아무도 승인하지 않았고, 기록으로 저장됐을 뿐이다(2026-10-06 회장 지시).
 */
export function decisionStatusLabel(d: Pick<Decision, 'status' | 'decided_by_kind'>): string {
  if (d.status === 'Approved' && d.decided_by_kind === 'rule') return '기록 완료'
  return DECISION_STATUS_LABEL_KO[d.status]
}
