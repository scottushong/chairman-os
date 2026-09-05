import {
  aiNightOutputs,
  alerts,
  businesses,
  criticalRisks,
  decisions,
  financeKpis,
  monthlyPriorities,
  nextMilestones,
  projects,
  tasks,
  topGoals,
} from '@/data'

import type { ChairmanRepository, DecisionAuditEntry } from './types'

/**
 * JSON 시드 어댑터.
 * src/data는 읽기 전용이라 여기서도 원본을 그대로 내보내지 않고 복사본을 준다 —
 * 화면에서 sort()를 한 번만 잘못 불러도 시드 배열 순서가 영구히 바뀐다.
 */
export const dummyRepository: ChairmanRepository = {
  mode: 'dummy',

  async listBusinesses() {
    return [...businesses]
  },
  async listFinanceKpis() {
    return [...financeKpis]
  },
  async listProjects() {
    return [...projects]
  },
  async listTasks() {
    return [...tasks]
  },
  async listDecisions() {
    return [...decisions]
  },
  async listAlerts() {
    return [...alerts]
  },
  async listAiNightOutputs() {
    return [...aiNightOutputs]
  },

  async listTopGoals() {
    return [...topGoals]
  },
  async listMonthlyPriorities() {
    return [...monthlyPriorities]
  },
  async listCriticalRisks() {
    return [...criticalRisks]
  },
  async listNextMilestones() {
    return [...nextMilestones]
  },

  /**
   * dummy 모드에는 감사 기록을 남길 서버가 없다.
   * 지금은 브라우저 localStorage(lib/decision-log.ts)가 그 자리를 대신하고 있고,
   * 그건 CH-051 '삭제 불가'를 만족하지 못한다(DEFERRED D-05).
   * 조용히 성공한 척하면 그 사실이 가려지므로 여기서는 아무것도 하지 않는다는 걸 남긴다.
   */
  async recordDecisionAction(entry: DecisionAuditEntry) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] audit_log 미기록: ${entry.action} ${entry.decision_id}. live 모드에서만 서버에 남는다.`,
      )
    }
  },
}
