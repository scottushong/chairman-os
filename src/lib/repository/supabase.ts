import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { AUDIT_ACTION, DECISION_STATUS, type DecisionAuditRecord } from '@/lib/decision-log'
import { dayKey } from '@/lib/format'

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

import {
  DUPLICATE_BUSINESS_ID,
  type AuditActor,
  type ChairmanRepository,
  type DecisionAuditEntry,
  type NewBusiness,
  type TaskPatch,
  type UserSettings,
} from './types'

/**
 * Supabase 어댑터.
 *
 * DB와 화면은 두 군데에서 말이 다르다. 그 차이를 전부 이 파일 안에서 흡수한다.
 *   1) 그룹 행: DB는 business_id = NULL, 앱은 'group' 문자열.
 *   2) 담당자: DB는 owner_user_id(uuid), 앱은 owner(사람이 읽는 이름).
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

/**
 * 업무 한 줄을 감사 기록에 남기기 위해 읽는 모양.
 * projects는 PostgREST의 임베드다 — tasks.project_id가 projects를 FK로 물고 있어
 * 한 요청으로 회사까지 같이 온다. 관계가 many-to-one이라 배열이 아니라 객체다.
 */
interface TaskAuditRow {
  task_id: string
  status: TaskStatus
  chairman_needed: boolean
  blocked_since: string
  projects: { business_id: string } | null
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
  ai_confidence: number | string | null
  attachment_url: string | null
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

/** 이름을 못 찾은 담당자. 화면에 36자 uuid를 그대로 뿌리지 않는다(DEFERRED D-09 결정 B). */
const UNKNOWN_OWNER = '미지정'

interface ProfileNameRow {
  user_id: string
  display_name: string
}

/**
 * owner_user_id(uuid) → 표시 이름.
 *
 * 이름의 유일한 출처는 user_profiles다. 앱 안에 uuid↔이름 표를 따로 두면
 * DB 밖에 두 번째 진실이 생긴다(DEFERRED D-09 선택지 C를 권하지 않은 이유).
 *
 * 찾지 못하면 '미지정'이다. 그런 경우가 두 가지 있고 둘 다 정상 동작이다.
 *   1) 시드 담당자 — gen-seed-sql.ts가 'user_001'을 접어 만든 uuid라 auth.users에 없다.
 *      user_profiles는 auth.users(id)를 FK로 물고 있어 그 행을 만들 수도 없다.
 *   2) 남의 프로필 — 0002의 user_profiles_self_read가 Chairman이 아니면 본인 것만 내준다.
 *      즉 팀장이 보면 남의 이름은 '미지정'으로 보인다. 그게 권한 설계대로다.
 *
 * 한 요청 안에서 여러 표가 같은 이름표를 쓰므로 약속을 캐시해 왕복을 한 번으로 줄인다.
 */
function createOwnerNames(sb: SupabaseClient): () => Promise<Map<string, string>> {
  let pending: Promise<Map<string, string>> | null = null

  return () => {
    pending ??= (async () => {
      const { data, error } = await sb
        .from('user_profiles')
        .select('user_id,display_name')
        .returns<ProfileNameRow[]>()
      const rows = unwrap('user_profiles', data, error)
      return new Map(rows.map((r) => [r.user_id, r.display_name]))
    })()
    return pending
  }
}

function ownerName(names: Map<string, string>, userId: string | null): string {
  if (!userId) return UNKNOWN_OWNER
  return names.get(userId) ?? UNKNOWN_OWNER
}

export function createSupabaseRepository(sb: SupabaseClient): ChairmanRepository {
  // 이 어댑터는 요청 하나마다 새로 만들어진다. 이름표 캐시의 수명도 딱 그만큼이다.
  const ownerNames = createOwnerNames(sb)

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
      const [{ data, error }, names] = await Promise.all([
        sb.from('projects').select('*').returns<ProjectRow[]>(),
        ownerNames(),
      ])
      const rows = unwrap('projects', data, error)
      return rows.map((r) => ({
        project_id: r.project_id,
        business_id: r.business_id,
        name: r.name,
        owner: ownerName(names, r.owner_user_id),
        priority: r.priority,
        status: r.status,
        progress_pct: r.progress_pct,
        deadline: r.deadline,
      }))
    },

    async listTasks(): Promise<Task[]> {
      const [{ data, error }, names] = await Promise.all([
        sb.from('tasks').select('*').returns<TaskRow[]>(),
        ownerNames(),
      ])
      const rows = unwrap('tasks', data, error)
      return rows.map((r) => ({
        task_id: r.task_id,
        project_id: r.project_id,
        title: r.title,
        owner: ownerName(names, r.owner_user_id),
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
        // null과 undefined를 구분한다. 화면은 '값이 없으면 그 줄을 뺀다'로 그리므로
        // 0으로 채우면 신뢰도 0%인 추천처럼 보인다.
        ai_confidence: r.ai_confidence === null ? undefined : num(r.ai_confidence),
        attachment_url: r.attachment_url ?? undefined,
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
      const [{ data, error }, names] = await Promise.all([
        sb.from('monthly_priorities').select('*').returns<PriorityRow[]>(),
        ownerNames(),
      ])
      const rows = unwrap('monthly_priorities', data, error)
      return rows.map((r) => ({
        priority_id: r.priority_id,
        business_id: toScope(r.business_id),
        title: r.title,
        detail: r.detail,
        owner: ownerName(names, r.owner_user_id),
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
      const [{ data, error }, names] = await Promise.all([
        sb.from('milestones').select('*').order('deadline').returns<MilestoneRow[]>(),
        ownerNames(),
      ])
      const rows = unwrap('milestones', data, error)
      return rows.map((r) => ({
        milestone_id: r.milestone_id,
        business_id: toScope(r.business_id),
        title: r.title,
        owner: ownerName(names, r.owner_user_id),
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
      const [{ data, error }, names] = await Promise.all([
        sb
          .from('audit_log')
          .select('entity_id,action,occurred_at,actor_user_id')
          .eq('entity_table', 'decisions')
          .in('action', ['approve', 'reject', 'modify', 'delegate'])
          .order('occurred_at', { ascending: false })
          .returns<DecisionAuditRow[]>(),
        ownerNames(),
      ])
      const rows = unwrap('audit_log', data, error)
      return rows
        .filter((r): r is DecisionAuditRow & { entity_id: string } => r.entity_id !== null)
        .map((r) => ({
          decision_id: r.entity_id,
          action: r.action,
          occurred_at: r.occurred_at,
          actor_user_id: r.actor_user_id,
          actor_name: ownerName(names, r.actor_user_id),
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
     * CH-002 회사 추가 (DEFERRED D-08 선택지 A).
     *
     * 0002의 businesses_write가 Chairman만 통과시킨다. 여기서 역할을 다시 보지 않는다 —
     * 판정을 애플리케이션으로 옮기면 우회 경로가 하나 더 생긴다.
     *
     * 순서는 recordDecisionAction과 같다. 기록이 먼저다.
     * 반대로 두면 '회사는 생겼는데 만든 기록이 없는' 순간이 존재하고, 그게 감사 구멍이다.
     * 이 순서에서는 반대 방향 실패(기록만 남고 회사는 안 생김)가 가능하다. 그쪽을 택했다 —
     * audit_log는 append only라 그 줄을 지울 수 없고, '만들려고 했다'도 기록 대상이다(CH-051).
     * 대신 호출자에게 그 상태를 그대로 말한다.
     *
     * 중복 검사는 이 두 줄보다 먼저다. 이미 있는 id로 실패하는 건 감사할 사건이 아니라
     * 입력 오류라서, 그것까지 기록에 남기면 기록이 잡음으로 찬다.
     */
    async createBusiness(input: NewBusiness, actor: AuditActor): Promise<Business> {
      const { data: clash, error: lookupError } = await sb
        .from('businesses')
        .select('business_id')
        .eq('business_id', input.business_id)
        .maybeSingle<{ business_id: string }>()

      if (lookupError) {
        throw new Error(`Supabase businesses ${lookupError.code ?? '?'}: ${lookupError.message}`)
      }
      if (clash) throw new Error(DUPLICATE_BUSINESS_ID)

      // 새 회사는 카드 줄 맨 뒤에 선다. 0으로 두면 시드 1~5보다 앞에 끼어든다.
      const { data: last, error: orderError } = await sb
        .from('businesses')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle<{ sort_order: number }>()
      if (orderError) {
        throw new Error(`Supabase businesses ${orderError.code ?? '?'}: ${orderError.message}`)
      }
      const sortOrder = (last?.sort_order ?? 0) + 1

      const row = {
        business_id: input.business_id,
        name: input.name,
        status: input.status,
        industry: input.industry,
        owner_user_id: null,
        visible: true,
        sort_order: sortOrder,
        pinned: false,
      }

      const { error: auditError } = await sb.from('audit_log').insert({
        action: 'create',
        entity_table: 'businesses',
        entity_id: input.business_id,
        business_id: input.business_id,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        // 무엇을 만들었는지가 after에 통째로 남는다. before는 없다 — 만들기 전에는 행이 없었다.
        after: row,
      })
      if (auditError) {
        throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)
      }

      const { error: insertError } = await sb.from('businesses').insert(row)
      if (insertError) {
        // 23505 = 중복 키. 위 검사와 INSERT 사이에 누가 같은 id를 넣었다는 뜻이다.
        if (insertError.code === '23505') throw new Error(DUPLICATE_BUSINESS_ID)
        throw new Error(
          `Supabase businesses ${insertError.code ?? '?'}: ${insertError.message} ` +
            '(감사 기록은 남았고 회사는 만들어지지 않았다. 0002의 businesses_write 정책을 본다.)',
        )
      }

      return {
        business_id: row.business_id,
        name: row.name,
        status: row.status,
        industry: row.industry,
        owner_user_id: '',
        visible: row.visible,
        sort_order: row.sort_order,
        pinned: row.pinned,
      }
    },

    /**
     * CH-040 업무 상태 변경 / 회장확인 토글.
     *
     * before/after를 남기려면 바꾸기 전 값을 알아야 하므로 한 번 읽는다. 그 읽기는
     * business_id를 얻는 일도 겸한다 — tasks는 회사를 직접 들고 있지 않고 projects를 거친다.
     * 두 번 왕복하지 않으려고 임베드로 같이 가져온다.
     *
     * 순서는 이 파일의 다른 쓰기와 같다. 기록이 먼저다.
     * 권한은 보지 않는다 — 0002의 tasks_write가 담당자 본인이거나 승인권자일 때만 통과시킨다.
     */
    async updateTask(taskId: string, patch: TaskPatch, actor: AuditActor): Promise<void> {
      if (patch.status === undefined && patch.chairman_needed === undefined) return

      const { data: before, error: readError } = await sb
        .from('tasks')
        .select('task_id,status,chairman_needed,blocked_since,projects(business_id)')
        .eq('task_id', taskId)
        .maybeSingle<TaskAuditRow>()

      if (readError) throw new Error(`Supabase tasks ${readError.code ?? '?'}: ${readError.message}`)
      // RLS가 가린 행도 여기로 온다. '없다'와 '못 본다'를 화면에서 구분할 필요는 없다 — 둘 다 못 고친다.
      if (!before) throw new Error('Supabase tasks: 그 업무가 없거나 볼 수 없다.')

      const after: Record<string, string | boolean> = {}
      if (patch.status !== undefined) {
        after.status = patch.status
        // CH-017 대기일수의 기준선을 같이 옮긴다. 안 옮기면 어제 Done된 일이 30일째 대기로 보인다.
        after.blocked_since = dayKey()
      }
      if (patch.chairman_needed !== undefined) after.chairman_needed = patch.chairman_needed

      const { error: auditError } = await sb.from('audit_log').insert({
        action: 'update',
        entity_table: 'tasks',
        entity_id: taskId,
        business_id: before.projects?.business_id ?? null,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        // 바뀌는 칸만 넣는다. 행 전체를 남기면 무엇이 달라졌는지 읽는 사람이 다시 비교해야 한다.
        before: Object.fromEntries(
          Object.keys(after).map((k) => [k, before[k as keyof TaskAuditRow] ?? null]),
        ),
        after,
      })
      if (auditError) {
        throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)
      }

      const { error: updateError } = await sb.from('tasks').update(after).eq('task_id', taskId)
      if (updateError) {
        throw new Error(
          `Supabase tasks ${updateError.code ?? '?'}: ${updateError.message} ` +
            '(감사 기록은 남았고 업무는 바뀌지 않았다. 0002의 tasks_write 정책을 본다.)',
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
