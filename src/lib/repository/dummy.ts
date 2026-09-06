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
import type { Business } from '@/types'

import {
  DUPLICATE_BUSINESS_ID,
  type AuditActor,
  type ChairmanRepository,
  type DecisionAuditEntry,
  type NewBusiness,
  type UserSettings,
} from './types'

/**
 * dummy 모드의 감사 기록. 서버 프로세스가 살아 있는 동안만 남는다.
 *
 * 이걸 두는 이유는 화면을 돌려 보기 위해서지, 감사 요건을 만족하기 위해서가 아니다.
 * CH-051의 '삭제 불가'는 서버를 한 번 재시작하면 그냥 사라지는 배열로는 만족되지 않는다.
 * 진짜 기록은 live 모드에서 Supabase audit_log에만 남는다(DEFERRED D-05).
 */
const memoryAudit: DecisionAuditRecord[] = []

/** CH-002로 추가한 회사도 마찬가지다. 서버가 살아 있는 동안만 남는다. */
const memoryBusinesses: Business[] = []

/** 개인 설정도 마찬가지다. 서버가 살아 있는 동안만 남는다. */
const memorySettings: UserSettings = { hidden_businesses: [], pinned_businesses: null }

/**
 * JSON 시드 어댑터.
 * src/data는 읽기 전용이라 여기서도 원본을 그대로 내보내지 않고 복사본을 준다 —
 * 화면에서 sort()를 한 번만 잘못 불러도 시드 배열 순서가 영구히 바뀐다.
 */
export const dummyRepository: ChairmanRepository = {
  mode: 'dummy',

  async listBusinesses() {
    return [...businesses, ...memoryBusinesses]
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
   * CH-002. live 모드에서는 Chairman만 통과하는 일이지만(0002 businesses_write),
   * dummy에는 역할도 RLS도 없다. 여기서 역할을 흉내 내면 dummy에서만 통과/거부되는
   * 두 번째 권한 판정이 생긴다 — 판정은 DB 한 곳에서만 한다.
   */
  async createBusiness(input: NewBusiness, actor: AuditActor): Promise<Business> {
    const taken = [...businesses, ...memoryBusinesses].some(
      (b) => b.business_id === input.business_id,
    )
    if (taken) throw new Error(DUPLICATE_BUSINESS_ID)

    const created: Business = {
      business_id: input.business_id,
      name: input.name,
      status: input.status,
      industry: input.industry,
      owner_user_id: '',
      visible: true,
      sort_order:
        Math.max(0, ...[...businesses, ...memoryBusinesses].map((b) => b.sort_order)) + 1,
      pinned: false,
    }
    memoryBusinesses.push(created)

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] create ${created.business_id} by ${actor.role} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
    return created
  },

  async getUserSettings() {
    return { ...memorySettings }
  },

  async saveUserSettings(patch: Partial<UserSettings>) {
    Object.assign(memorySettings, patch)
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
