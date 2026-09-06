import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { AUDIT_ACTION, DECISION_STATUS, type DecisionAuditRecord } from '@/lib/decision-log'

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

import type { ChairmanRepository, DecisionAuditEntry, UserSettings } from './types'

/**
 * Supabase 어댑터.
 *
 * DB와 화면은 두 군데에서 말이 다르다. 그 차이를 전부 이 파일 안에서 흡수한다.
 *   1) 그룹 행: DB는 business_id = NULL, 앱은 'group' 문자열.
 *   2) 담당자: DB는 owner_user_id(uuid), 앱은 owner(문자열).
 * 이 매핑이 컴포넌트로 새 나가면 화면이 DB 모양을 알게 되고, 그때부터 갈아 끼울 수 없다.
 *
 * 클라이언트는 밖에서 주입받는다. 서버 컴포넌트면 쿠키 세션이 실린 것이 들어오고,
 * 로그인 전이면 anon으로 나간다. RLS(0002_rls.sql)가 Default Deny라
 * 그때 빈 배열이 돌아오는 것은 고장이 아니라 정상 동작이다.
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

interface UserSettingsRow {
  hidden_businesses: string[] | null
  pinned_businesses: string[] | null
}

interface DecisionAuditRow {
  entity_id: string | null
  action: 'approve' | 'reject' | 'modify' | 'delegate'
  occurred_at: string
  actor_user_id: string | null
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

/** PostgREST 오류는 삼키지 않는다. RLS 거부(401/403)와 스키마 오류(42P01)를 구분해야 고칠 수 있다. */
function unwrap<T>(table: string, data: T[] | null, error: PostgrestError | null): T[] {
  if (error) throw new Error(`Supabase ${table} ${error.code ?? '?'}: ${error.message}`)
  return data ?? []
}

export function createSupabaseRepository(sb: SupabaseClient): ChairmanRepository {
  return {
    mode: 'live',

    async listBusinesses(): Promise<Business[]> {
      const { data, error } = await sb
        .from('businesses')
        .select('*')
        .order('sort_order')
        .returns<BusinessRow[]>()
      const rows = unwrap('businesses', data, error)
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
      const { data, error } = await sb
        .from('finance_kpis')
        // 필요한 칸만 부른다. RLS로 가려진 컬럼을 넓게 부르면 실수가 늦게 드러난다.
        .select('period,business_id,metric,value,target,currency')
        .order('period')
        .returns<FinanceKpiRow[]>()
      const rows = unwrap('finance_kpis', data, error)
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
      const { data, error } = await sb.from('projects').select('*').returns<ProjectRow[]>()
      const rows = unwrap('projects', data, error)
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
      const { data, error } = await sb.from('tasks').select('*').returns<TaskRow[]>()
      const rows = unwrap('tasks', data, error)
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
      const { data, error } = await sb
        .from('decisions')
        .select('*')
        .order('deadline')
        .returns<DecisionRow[]>()
      const rows = unwrap('decisions', data, error)
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
      const { data, error } = await sb.from('alerts').select('*').returns<AlertRow[]>()
      const rows = unwrap('alerts', data, error)
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
      const { data, error } = await sb
        .from('ai_night_outputs')
        .select('*')
        .order('completed_at', { ascending: false })
        .returns<NightOutputRow[]>()
      const rows = unwrap('ai_night_outputs', data, error)
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
      const { data, error } = await sb.from('goals').select('*').returns<GoalRow[]>()
      const rows = unwrap('goals', data, error)
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
      const { data, error } = await sb
        .from('monthly_priorities')
        .select('*')
        .returns<PriorityRow[]>()
      const rows = unwrap('monthly_priorities', data, error)
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
      const { data, error } = await sb.from('critical_risks').select('*').returns<RiskRow[]>()
      const rows = unwrap('critical_risks', data, error)
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
      const { data, error } = await sb
        .from('milestones')
        .select('*')
        .order('deadline')
        .returns<MilestoneRow[]>()
      const rows = unwrap('milestones', data, error)
      return rows.map((r) => ({
        milestone_id: r.milestone_id,
        business_id: toScope(r.business_id),
        title: r.title,
        owner: r.owner_user_id ?? '',
        deadline: r.deadline,
      }))
    },

    /**
     * CH-051. 이미 처리한 결정들. decisions 표가 아니라 audit_log에서 읽는다 —
     * '누가 언제 무엇을 했는가'의 답은 상태 칸이 아니라 기록에 있다.
     *
     * audit_log_read 정책(0002)이 Chairman 아니면 본인 것만 내준다.
     * 그래서 다른 역할로 보면 '오늘 처리 N건'이 자기 몫만 세어진다. 그게 맞다.
     */
    async listDecisionAudit(): Promise<DecisionAuditRecord[]> {
      const { data, error } = await sb
        .from('audit_log')
        .select('entity_id,action,occurred_at,actor_user_id')
        .eq('entity_table', 'decisions')
        .in('action', ['approve', 'reject', 'modify', 'delegate'])
        .order('occurred_at', { ascending: false })
        .returns<DecisionAuditRow[]>()
      const rows = unwrap('audit_log', data, error)
      return rows
        .filter((r): r is DecisionAuditRow & { entity_id: string } => r.entity_id !== null)
        .map((r) => ({
          decision_id: r.entity_id,
          action: r.action,
          occurred_at: r.occurred_at,
          actor_user_id: r.actor_user_id,
        }))
    },

    /**
     * CH-016 → CH-051.
     * decisions.status를 바꾸는 것과 audit_log를 남기는 건 다른 일이다.
     * 기록이 먼저다 — 상태만 바뀌고 기록이 없는 순간이 생기면 그게 감사 구멍이다.
     *
     * 그래서 순서가 뒤집힌 실패(기록은 남고 상태는 안 바뀜)가 가능하다. 그쪽을 택했다.
     * audit_log는 append only라 그 줄을 지울 수도 없고, 지워서도 안 된다 —
     * '승인을 시도했다'는 사실 자체가 기록 대상이다. 대신 호출자에게 그 상태를 그대로 말한다.
     */
    async recordDecisionAction(entry: DecisionAuditEntry) {
      const action = AUDIT_ACTION[entry.action]

      const { error: auditError } = await sb.from('audit_log').insert({
        action,
        entity_table: 'decisions',
        entity_id: entry.decision_id,
        business_id: entry.business_id ?? null,
        actor_user_id: entry.actor_user_id ?? null,
        actor_role: entry.actor_role ?? null,
        note: entry.note ?? null,
      })
      if (auditError) {
        throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)
      }

      const { error: updateError } = await sb
        .from('decisions')
        .update({
          status: DECISION_STATUS[action],
          decided_at: new Date().toISOString(),
          decided_by: entry.actor_user_id ?? null,
        })
        .eq('decision_id', entry.decision_id)

      if (updateError) {
        throw new Error(
          `Supabase decisions ${updateError.code ?? '?'}: ${updateError.message} ` +
            '(감사 기록은 남았고 결정 상태만 바뀌지 않았다. 0002의 decisions_decide 정책을 본다.)',
        )
      }
    },

    /**
     * CH-003/004/056.
     * where 절에 user_id를 걸지 않는다 — 0002의 user_settings_own 정책이
     * 이미 본인 행 하나만 통과시킨다. 여기서 또 거르면 판정이 두 곳으로 갈라진다.
     *
     * 행이 없으면 기본값이다. 첫 로그인에 행을 만들어 두지 않아도 화면은 떠야 한다.
     */
    async getUserSettings(): Promise<UserSettings> {
      const { data, error } = await sb
        .from('user_settings')
        .select('hidden_businesses,pinned_businesses')
        .maybeSingle<UserSettingsRow>()

      if (error) throw new Error(`Supabase user_settings ${error.code ?? '?'}: ${error.message}`)

      return {
        hidden_businesses: data?.hidden_businesses ?? [],
        // null을 그대로 넘긴다. '아직 정한 적 없음'이라는 뜻이고 []와 다르다(0005).
        pinned_businesses: data?.pinned_businesses ?? null,
      }
    },

    async saveUserSettings(patch: Partial<UserSettings>) {
      // upsert는 PK가 있어야 한다. RLS가 남의 행을 막아 주더라도 넣을 값 자체는 필요하다.
      const {
        data: { user },
      } = await sb.auth.getUser()
      if (!user) throw new Error('세션이 없다. 개인 설정은 로그인한 사람에게만 있다.')

      const { error } = await sb
        .from('user_settings')
        .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })

      if (error) throw new Error(`Supabase user_settings ${error.code ?? '?'}: ${error.message}`)
    },
  }
}
