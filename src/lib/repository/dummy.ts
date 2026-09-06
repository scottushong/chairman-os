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
import { AUDIT_ACTION, type DecisionAuditRecord } from '@/lib/decision-log'

import type { ChairmanRepository, DecisionAuditEntry } from './types'

/**
 * dummy 모드의 감사 기록. 서버 프로세스가 살아 있는 동안만 남는다.
 *
 * 이걸 두는 이유는 화면을 돌려 보기 위해서지, 감사 요건을 만족하기 위해서가 아니다.
 * CH-051의 '삭제 불가'는 서버를 한 번 재시작하면 그냥 사라지는 배열로는 만족되지 않는다.
 * 진짜 기록은 live 모드에서 Supabase audit_log에만 남는다(DEFERRED D-05).
 */
const memoryAudit: DecisionAuditRecord[] = []

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

  async listDecisionAudit() {
    return [...memoryAudit]
  },

  /**
   * 프로세스 메모리에만 쌓는다. 서버를 재시작하면 사라진다.
   * 조용히 '저장됐다'고 넘어가면 그 사실이 가려지므로 개발 중에는 매번 경고를 남긴다.
   */
  async recordDecisionAction(entry: DecisionAuditEntry) {
    memoryAudit.push({
      decision_id: entry.decision_id,
      action: AUDIT_ACTION[entry.action],
      occurred_at: new Date().toISOString(),
      actor_user_id: entry.actor_user_id ?? null,
    })
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] ${entry.action} ${entry.decision_id} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
  },
}
