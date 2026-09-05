import { insertRows, selectRows, type RequestContext } from '@/lib/supabase/client'
import type {
  AiNightOutput,
  Alert,
  Business,
  BusinessStatus,
  CriticalRisk,
  Decision,
  DecisionStatus,
  FinanceKpi,
  FinanceMetric,
  MonthlyPriority,
  NextMilestone,
  Project,
  Severity,
  Task,
  TaskStatus,
  TopGoal,
  WorkPriority,
} from '@/types'

import type { ChairmanRepository, DecisionAuditEntry } from './types'

/**
 * Supabase 어댑터.
 *
 * DB와 화면은 두 군데에서 말이 다르다. 그 차이를 전부 이 파일 안에서 흡수한다.
 *   1) 그룹 행: DB는 business_id = NULL, 앱은 'group' 문자열.
 *   2) 담당자: DB는 owner_user_id(uuid), 앱은 owner(문자열).
 * 이 매핑이 컴포넌트로 새 나가면 화면이 DB 모양을 알게 되고, 그때부터 갈아 끼울 수 없다.
 *
 * 읽기는 서버에서만 부른다. ctx.accessToken이 없으면 anon으로 나가고,
 * RLS(0002_rls.sql)가 Default Deny라 빈 배열이 돌아오는 게 정상 동작이다.
 */

const GROUP = 'group'

/** DB의 NULL(그룹 전체)을 앱의 'group' 센티널로. */
function toScope(businessId: string | null): string {
  return businessId ?? GROUP
}

/** PostgREST가 numeric을 문자열로 줄 때가 있다. 숫자로 못 바꾸면 0이 아니라 실패여야 한다. */
function num(value: number | string): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) throw new Error(`숫자가 아닌 값이 왔다: ${String(value)}`)
  return n
}

interface BusinessRow {
  business_id: string
  name: string
  status: BusinessStatus
  industry: string
  owner_user_id: string | null
  visible: boolean
  sort_order: number
  pinned: boolean
}

interface FinanceKpiRow {
  period: string
  business_id: string
  metric: FinanceMetric
  value: number | string
  target: number | string | null
  currency: 'KRW' | 'USD'
}

interface GoalRow {
  goal_id: string
  business_id: string | null
  title: string
  target_value: string
  current_value: string
  progress_pct: number
  due: string
}

interface PriorityRow {
  priority_id: string
  business_id: string | null
  title: string
  detail: string
  owner_user_id: string | null
  weight: WorkPriority
}

interface RiskRow {
  risk_id: string
  business_id: string | null
  title: string
  detail: string
  impact: Severity
  urgency: Severity
}

interface MilestoneRow {
  milestone_id: string
  business_id: string | null
  title: string
  owner_user_id: string | null
  deadline: string
}

interface ProjectRow {
  project_id: string
  business_id: string
  name: string
  owner_user_id: string | null
  priority: WorkPriority
  status: TaskStatus
  progress_pct: number
  deadline: string
}

interface TaskRow {
  task_id: string
  project_id: string
  title: string
  owner_user_id: string | null
  priority: WorkPriority
  status: TaskStatus
  blocked_since: string
  deadline: string
  chairman_needed: boolean
}

interface DecisionRow {
  decision_id: string
  business_id: string
  title: string
  options: string[]
  ai_recommendation: string | null
  impact: WorkPriority
  deadline: string
  status: DecisionStatus
}

interface AlertRow {
  alert_id: string
  business_id: string
  category: Alert['category']
  message: string
  severity: Severity
  source: 'Rule' | 'AI'
  status: Alert['status']
}

interface NightOutputRow {
  business_id: string
  job_type: AiNightOutput['job_type']
  result_summary: string
  status: AiNightOutput['status']
  artifact_link: string | null
  confidence: number | string | null
  completed_at: string
}

export function createSupabaseRepository(ctx: RequestContext = {}): ChairmanRepository {
  return {
    mode: 'live',

    async listBusinesses(): Promise<Business[]> {
      const rows = await selectRows<BusinessRow>(
        'businesses',
        { order: { column: 'sort_order' } },
        ctx,
      )
      return rows.map((r) => ({
        business_id: r.business_id,
        name: r.name,
        status: r.status,
        industry: r.industry,
        owner_user_id: r.owner_user_id ?? '',
        visible: r.visible,
        sort_order: r.sort_order,
        pinned: r.pinned,
      }))
    },

    async listFinanceKpis(): Promise<FinanceKpi[]> {
      const rows = await selectRows<FinanceKpiRow>(
        'finance_kpis',
        { select: 'period,business_id,metric,value,target,currency', order: { column: 'period' } },
        ctx,
      )
      return rows.map((r) => ({
        period: r.period,
        business_id: r.business_id,
        metric: r.metric,
        value: num(r.value),
        target: r.target === null ? undefined : num(r.target),
        currency: r.currency,
      }))
    },

    async listProjects(): Promise<Project[]> {
      const rows = await selectRows<ProjectRow>('projects', {}, ctx)
      return rows.map((r) => ({
        project_id: r.project_id,
        business_id: r.business_id,
        name: r.name,
        owner: r.owner_user_id ?? '',
        priority: r.priority,
        status: r.status,
        progress_pct: r.progress_pct,
        deadline: r.deadline,
      }))
    },

    async listTasks(): Promise<Task[]> {
      const rows = await selectRows<TaskRow>('tasks', {}, ctx)
      return rows.map((r) => ({
        task_id: r.task_id,
        project_id: r.project_id,
        title: r.title,
        owner: r.owner_user_id ?? '',
        priority: r.priority,
        status: r.status,
        blocked_since: r.blocked_since,
        deadline: r.deadline,
        chairman_needed: r.chairman_needed,
      }))
    },

    async listDecisions(): Promise<Decision[]> {
      const rows = await selectRows<DecisionRow>(
        'decisions',
        { order: { column: 'deadline' } },
        ctx,
      )
      return rows.map((r) => ({
        decision_id: r.decision_id,
        business_id: r.business_id,
        title: r.title,
        options: r.options,
        ai_recommendation: r.ai_recommendation ?? '',
        impact: r.impact,
        deadline: r.deadline,
        status: r.status,
      }))
    },

    async listAlerts(): Promise<Alert[]> {
      const rows = await selectRows<AlertRow>('alerts', {}, ctx)
      return rows.map((r) => ({
        alert_id: r.alert_id,
        business_id: r.business_id,
        category: r.category,
        message: r.message,
        severity: r.severity,
        source: r.source,
        status: r.status,
      }))
    },

    async listAiNightOutputs(): Promise<AiNightOutput[]> {
      const rows = await selectRows<NightOutputRow>(
        'ai_night_outputs',
        { order: { column: 'completed_at', ascending: false } },
        ctx,
      )
      return rows.map((r) => ({
        completed_at: r.completed_at,
        business_id: r.business_id,
        job_type: r.job_type,
        result_summary: r.result_summary,
        status: r.status,
        artifact_link: r.artifact_link ?? '',
        confidence: r.confidence === null ? 0 : num(r.confidence),
      }))
    },

    async listTopGoals(): Promise<TopGoal[]> {
      const rows = await selectRows<GoalRow>('goals', {}, ctx)
      return rows.map((r) => ({
        goal_id: r.goal_id,
        business_id: toScope(r.business_id),
        title: r.title,
        target_value: r.target_value,
        current_value: r.current_value,
        progress_pct: r.progress_pct,
        due: r.due,
      }))
    },

    async listMonthlyPriorities(): Promise<MonthlyPriority[]> {
      const rows = await selectRows<PriorityRow>('monthly_priorities', {}, ctx)
      return rows.map((r) => ({
        priority_id: r.priority_id,
        business_id: toScope(r.business_id),
        title: r.title,
        detail: r.detail,
        owner: r.owner_user_id ?? '',
        weight: r.weight,
      }))
    },

    async listCriticalRisks(): Promise<CriticalRisk[]> {
      const rows = await selectRows<RiskRow>('critical_risks', {}, ctx)
      return rows.map((r) => ({
        risk_id: r.risk_id,
        business_id: toScope(r.business_id),
        title: r.title,
        impact: r.impact,
        urgency: r.urgency,
        detail: r.detail,
      }))
    },

    async listNextMilestones(): Promise<NextMilestone[]> {
      const rows = await selectRows<MilestoneRow>(
        'milestones',
        { order: { column: 'deadline' } },
        ctx,
      )
      return rows.map((r) => ({
        milestone_id: r.milestone_id,
        business_id: toScope(r.business_id),
        title: r.title,
        owner: r.owner_user_id ?? '',
        deadline: r.deadline,
      }))
    },

    /**
     * CH-016 → CH-051.
     * decisions.status를 바꾸는 것과 audit_log를 남기는 건 다른 일이다.
     * 기록이 먼저다 — 상태만 바뀌고 기록이 없는 순간이 생기면 그게 감사 구멍이다.
     */
    async recordDecisionAction(entry: DecisionAuditEntry) {
      await insertRows(
        'audit_log',
        [
          {
            action: entry.action,
            entity_table: 'decisions',
            entity_id: entry.decision_id,
            business_id: entry.business_id ?? null,
            actor_user_id: entry.actor_user_id ?? null,
            note: entry.note ?? null,
          },
        ],
        ctx,
      )
    },
  }
}
