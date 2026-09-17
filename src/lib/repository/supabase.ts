import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import type { AuditAction, EntityAuditRecord } from '@/lib/audit-log'
import { AUDIT_ACTION, DECISION_STATUS, type DecisionAuditRecord } from '@/lib/decision-log'
import { dayKey } from '@/lib/format'
import { needsSubstringSearch, type SearchHit } from '@/lib/search'

import type {
  AiNightOutput,
  Alert,
  Business,
  BusinessStatus,
  BusinessKeyman,
  BusinessStrategy,
  ChairmanManifesto,
  ChairmanProject,
  CriticalRisk,
  Decision,
  DecisionStatus,
  DocumentRecord,
  FinanceKpi,
  FinanceLedger,
  Account,
  Closing,
  CostIndex,
  FxRate,
  JournalEntry,
  JournalLine,
  DataSource,
  NewInvitation,
  Role,
  UserAccount,
  UserInvitation,
  FinanceMetric,
  FigureBasis,
  MonthlyPriority,
  NextMilestone,
  Project,
  SecurityClass,
  Severity,
  Task,
  TaskStatus,
  TopGoal,
  WorkPriority,
} from '@/types'

import type { CorrectionResult, NewCorrection, NewJournalEntry } from '@/lib/ledger/journal'
import { STANDARD_CHART } from '@/lib/ledger/standard-chart'

import {
  DUPLICATE_ACCOUNT_CODE,
  DUPLICATE_BUSINESS_ID,
  DUPLICATE_INVITATION,
  type AccountPatch,
  type AuditActor,
  type AuditEntityTable,
  type ChairmanProjectInput,
  type ChairmanRepository,
  type DecisionAuditEntry,
  type KeymanInput,
  type NewAccount,
  type NewBusiness,
  type NewDecision,
  type NewDocument,
  type RevokeTarget,
  type StrategyPatch,
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
  source: DataSource
  closed: boolean
  fetched_at: string
  basis: FigureBasis
}

/** 0015 원장 표들. numeric은 문자열로 올 수 있어 num()을 거친다. */
type AccountRow = Account
type JournalLineRow = Omit<JournalLine, 'amount'> & { id: number; amount: number | string }
type ClosingRow = Omit<Closing, 'amount' | 'provisional_amount'> & {
  amount: number | string
  provisional_amount: number | string | null
}
type FxRateRow = Omit<FxRate, 'rate'> & { rate: number | string }
type CostIndexRow = Omit<CostIndex, 'value'> & { value: number | string }

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
  deadline: string | null
}

interface TaskRow {
  task_id: string
  project_id: string
  title: string
  owner_user_id: string | null
  priority: WorkPriority
  status: TaskStatus
  blocked_since: string
  deadline: string | null
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

/**
 * decisions 한 행을 화면의 Decision으로. 목록(listDecisions)과 방금 올린 기안(createDecision)이
 * 같은 함수를 쓴다 — 두 자리에서 따로 옮기면 한쪽만 고쳐지는 날이 온다.
 */
function toDecision(r: DecisionRow): Decision {
  return {
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
  }
}

interface UserProfileRow {
  user_id: string
  role: Role
  display_name: string
  title_ko: string | null
  max_security_class: SecurityClass
  revoked_at: string | null
  created_at: string
}

interface AccessRow {
  user_id: string
  business_id: string
}

interface UserInvitationRow {
  invitation_id: string
  email: string
  role: Role
  max_security_class: SecurityClass
  business_ids: string[] | null
  display_name: string
  title_ko: string | null
  invited_at: string
  accepted_at: string | null
  revoked_at: string | null
}

/** 0011 한 행을 화면의 UserInvitation으로. 목록과 방금 만든 초대가 같은 함수를 쓴다. */
function toInvitation(r: UserInvitationRow): UserInvitation {
  return {
    invitation_id: r.invitation_id,
    email: r.email,
    role: r.role,
    max_security_class: r.max_security_class,
    business_ids: r.business_ids ?? [],
    display_name: r.display_name,
    title_ko: r.title_ko ?? '',
    invited_at: r.invited_at,
    accepted_at: r.accepted_at,
    revoked_at: r.revoked_at,
  }
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

interface BusinessStrategyRow {
  business_id: string
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
  /** 0015. 그 전 DB에는 칸이 없다 */
  current_issue?: string
}

interface DocumentRow {
  document_id: string
  business_id: string | null
  title: string
  doc_type: string
  security_class: SecurityClass
  storage_url: string
  version: number
  uploaded_by: string | null
  created_at: string
}

interface UserSettingsRow {
  hidden_businesses: string[] | null
  pinned_businesses: string[] | null
}

interface DecisionAuditRow {
  id: number
  entity_id: string | null
  action: 'approve' | 'reject' | 'modify' | 'delegate'
  occurred_at: string
  actor_user_id: string | null
}

/** DEFERRED D-12. audit_log 한 줄을 그대로 받는다 — 이력 화면은 diff까지 읽는다. */
interface EntityAuditRow {
  id: number
  occurred_at: string
  action: AuditAction
  actor_user_id: string | null
  actor_role: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  note: string | null
}

interface NightOutputRow {
  output_id: string
  business_id: string | null
  job_type: AiNightOutput['job_type']
  result_summary: string
  status: AiNightOutput['status']
  artifact_link: string | null
  confidence: number | string | null
  completed_at: string
  items: AiNightOutput['items'] | null
  run_id: string | null
  run_date: string | null
  model: string | null
  project_notes: AiNightOutput['project_notes'] | null
}

/** PostgREST 오류는 삼키지 않는다. RLS 거부(401/403)와 스키마 오류(42P01)를 구분해야 고칠 수 있다. */
function unwrap<T>(table: string, data: T[] | null, error: PostgrestError | null): T[] {
  if (error) throw new Error(`Supabase ${table} ${error.code ?? '?'}: ${error.message}`)
  return data ?? []
}

/**
 * Complete RLS-visible lists. Each factory builds a fresh, uniquely ordered query
 * with count: 'exact'. Advance by rows received, since the server cap may be lower
 * than our batch size. Never treat a short page as proof that the list is complete.
 * Counts and identities detect common concurrent changes and fail instead of
 * returning a partial/duplicated list. HTTP pages do not share a DB snapshot.
 */
async function fetchAll<T>(
  table: string,
  keys: (keyof T)[],
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null
    error: PostgrestError | null
    count: number | null
  }>,
): Promise<{ data: T[]; error: null }> {
  const data: T[] = []
  const seen = new Set<string>()
  let total: number | undefined
  do {
    const result = await page(data.length, data.length + 499)
    const rows = unwrap(table, result.data, result.error)
    if (
      result.count === null || !Number.isSafeInteger(result.count) || result.count < 0 ||
      (total !== undefined && result.count !== total)
    ) {
      throw new Error(`Supabase ${table}: missing or changed pagination count; retry the read.`)
    }
    total = result.count
    for (const row of rows) {
      const identity = JSON.stringify(keys.map((key) => row[key]))
      if (seen.has(identity)) {
        throw new Error(`Supabase ${table}: repeated row across pages; retry the read.`)
      }
      seen.add(identity)
      data.push(row)
    }
    if (data.length > total || (rows.length === 0 && data.length < total)) {
      throw new Error(`Supabase ${table}: incomplete pagination; retry the read.`)
    }
  } while (data.length < total)
  return { data, error: null }
}

/** Mutation success is one returned row, not merely a null PostgREST error. */
function oneAffectedRow<T>(
  table: string,
  data: T[] | null,
  error: PostgrestError | null,
): T {
  const rows = unwrap(table, data, error)
  if (rows.length !== 1) {
    throw new Error(`Supabase ${table}: mutation affected ${rows.length} rows.`)
  }
  return rows[0]
}

/** 0015 business_keymen에서 부르는 칸. 세 함수가 같은 모양을 돌려줘야 한다. */
const KEYMAN_COLUMNS = 'keyman_id,business_id,name,relation,last_contact_on,note'

/** 0015 accounts + 0016 active. 읽기와 쓰기가 같은 모양을 돌려줘야 한다. */
const JOURNAL_ENTRY_COLUMNS = 'business_id,slip_no,entry_date,memo,evidence_url,created_by,created_at,corrects_id,correction_kind'

const ACCOUNT_COLUMNS = 'business_id,account_code,name,category,section,cash_flow,source,fetched_at,closed,active'

/** DB 오류를 그대로 싣되, 사용자가 고칠 수 있는 오류(코드 중복)는 표식으로 바꾼다. */
function accountError(error: PostgrestError): Error {
  if (error.code === '23505') return new Error(DUPLICATE_ACCOUNT_CODE)
  return new Error(`Supabase accounts ${error.code ?? '?'}: ${error.message}`)
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
      const { data, error } = await fetchAll('user_profiles', ['user_id'], (from, to) =>
        sb
          .from('user_profiles')
          .select('user_id,display_name', { count: 'exact' })
          .order('user_id')
          .range(from, to)
          .returns<ProfileNameRow[]>(),
      )
      const rows = unwrap('user_profiles', data, error)
      return new Map(rows.map((r) => [r.user_id, r.display_name]))
    })()
    return pending
  }
}

/**
 * business_id → 회사명. 검색 결과의 '어느 회사 건인가' 한 줄이 이걸 쓴다.
 * ownerNames와 같은 이유로 요청 하나 동안만 캐시한다.
 */
function createBusinessNames(sb: SupabaseClient): () => Promise<Map<string, string>> {
  let pending: Promise<Map<string, string>> | null = null

  return () => {
    pending ??= (async () => {
      const { data, error } = await fetchAll('businesses', ['business_id'], (from, to) =>
        sb
          .from('businesses')
          .select('business_id,name', { count: 'exact' })
          .order('business_id')
          .range(from, to)
          .returns<{ business_id: string; name: string }[]>(),
      )
      const rows = unwrap('businesses', data, error)
      return new Map(rows.map((r) => [r.business_id, r.name]))
    })()
    return pending
  }
}

/**
 * PostgREST의 or() 필터는 문자열을 그대로 파싱한다. 쉼표와 점이 구분자라
 * 사용자가 친 글자가 거기 섞이면 필터가 통째로 다른 뜻이 된다.
 *
 * 그래서 구조를 만드는 글자와 LIKE 와일드카드를 지운다. '%'를 남겨 두면
 * 검색창에 '%'만 쳐도 모든 행이 걸린다 — 느릴 뿐 아니라 RLS 밖으로 나가지도 않으면서
 * 목록을 통째로 훑는 질의가 된다.
 */
function likeSafe(query: string): string {
  return query.replace(/[,.()"\%_*:]/g, ' ').trim()
}

/** cols 중 하나라도 부분 일치하면. 값은 큰따옴표로 감싸 공백이 섞여도 한 덩어리로 읽히게 한다. */
function orIlike(cols: string[], query: string): string {
  const pattern = `%${likeSafe(query)}%`
  return cols.map((c) => `${c}.ilike."${pattern}"`).join(',')
}

function ownerName(names: Map<string, string>, userId: string | null): string {
  if (!userId) return UNKNOWN_OWNER
  return names.get(userId) ?? UNKNOWN_OWNER
}

export function createSupabaseRepository(sb: SupabaseClient): ChairmanRepository {
  // 이 어댑터는 요청 하나마다 새로 만들어진다. 이름표 캐시의 수명도 딱 그만큼이다.
  const ownerNames = createOwnerNames(sb)
  const businessNames = createBusinessNames(sb)

  /** 장부 쓰기(0016)의 감사 한 줄. 실패하면 던진다 — 기록 없이 장부를 바꾸지 않는다. */
  async function audit(entry: {
    action: AuditAction
    entity_table: string
    entity_id: string
    business_id: string
    actor: AuditActor
    before?: unknown
    after?: unknown
    note?: string | null
  }) {
    const { error } = await sb.from('audit_log').insert({
      action: entry.action,
      entity_table: entry.entity_table,
      entity_id: entry.entity_id,
      business_id: entry.business_id,
      actor_user_id: entry.actor.user_id,
      actor_role: entry.actor.role,
      before: entry.before ?? null,
      after: entry.after ?? null,
      note: entry.note ?? null,
    })
    if (error) throw new Error(`Supabase audit_log ${error.code ?? '?'}: ${error.message}`)
  }

  return {
    mode: 'live',

    async listBusinesses(): Promise<Business[]> {
      const { data, error } = await fetchAll('businesses', ['business_id'], (from, to) =>
        sb
          .from('businesses')
          // 필요한 칸만 부른다. 0009가 붙인 search_tsv는 검색 색인이라 화면이 쓸 일이 없고,
          // '*'로 부르면 회사 다섯 줄마다 그 벡터가 통째로 실려 온다.
          .select(
            'business_id,name,status,industry,owner_user_id,visible,sort_order,pinned',
            { count: 'exact' },
          )
          .order('business_id')
          .range(from, to)
          .returns<BusinessRow[]>(),
      )
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
      const { data, error } = await fetchAll('finance_kpis', ['period', 'business_id', 'metric'], (from, to) =>
        sb
          .from('finance_kpis')
          // 필요한 칸만 부른다. RLS로 가려진 컬럼을 넓게 부르면 실수가 늦게 드러난다.
          .select('period,business_id,metric,value,target,currency,source,closed,fetched_at,basis', {
            count: 'exact',
          })
          .order('period')
          .order('business_id')
          .order('metric')
          .range(from, to)
          .returns<FinanceKpiRow[]>(),
      )
      const rows = unwrap('finance_kpis', data, error)
      return rows.map((r) => ({
        period: r.period,
        business_id: r.business_id,
        metric: r.metric,
        value: num(r.value),
        target: r.target === null ? undefined : num(r.target),
        currency: r.currency,
        source: r.source,
        closed: r.closed,
        fetched_at: r.fetched_at,
        basis: r.basis,
      }))
    },

    /**
     * Phase 2-A. 다섯 표를 동시에 읽는다. 전표가 많아도 fetchAll이 500행씩 끊어 끝까지 읽는다.
     * 여기서 계산하지 않는다 — 재무제표는 lib/ledger가 만든다. 어댑터가 합계를 내기 시작하면
     * dummy와 live가 서로 다른 공식을 갖게 된다.
     */
    async loadFinanceLedger(): Promise<FinanceLedger> {
      const [accounts, journal, closings, entries, fxRates, costIndices] = await Promise.all([
        fetchAll<AccountRow>('accounts', ['business_id', 'account_code'], (from, to) =>
          sb
            .from('accounts')
            .select(ACCOUNT_COLUMNS, { count: 'exact' })
            .order('business_id')
            .order('account_code')
            .range(from, to)
            .returns<AccountRow[]>(),
        ),
        fetchAll<JournalLineRow>('journal_lines', ['id'], (from, to) =>
          sb
            .from('journal_lines')
            .select(
              'id,business_id,entry_date,account_code,amount,side,slip_no,line_no,memo,source,fetched_at,closed',
              { count: 'exact' },
            )
            .order('id')
            .range(from, to)
            .returns<JournalLineRow[]>(),
        ),
        fetchAll<ClosingRow>('closings', ['business_id', 'period', 'account_code'], (from, to) =>
          sb
            .from('closings')
            .select(
              'business_id,period,account_code,amount,closed_on,provisional_amount,source,fetched_at,closed',
              { count: 'exact' },
            )
            .order('business_id')
            .order('period')
            .order('account_code')
            .range(from, to)
            .returns<ClosingRow[]>(),
        ),
        fetchAll<JournalEntry>('journal_entries', ['business_id', 'slip_no'], (from, to) =>
          sb
            .from('journal_entries')
            .select(JOURNAL_ENTRY_COLUMNS, { count: 'exact' })
            .order('business_id')
            .order('slip_no')
            .range(from, to)
            .returns<JournalEntry[]>(),
        ),
        fetchAll<FxRateRow>('fx_rates', ['rate_date', 'base', 'quote'], (from, to) =>
          sb
            .from('fx_rates')
            .select('rate_date,base,quote,rate,source_name,source,fetched_at,closed', { count: 'exact' })
            .order('rate_date')
            .order('base')
            .order('quote')
            .range(from, to)
            .returns<FxRateRow[]>(),
        ),
        fetchAll<CostIndexRow>('cost_indices', ['index_code', 'index_date'], (from, to) =>
          sb
            .from('cost_indices')
            .select('index_code,index_date,value,unit,source_name,source,fetched_at,closed', {
              count: 'exact',
            })
            .order('index_code')
            .order('index_date')
            .range(from, to)
            .returns<CostIndexRow[]>(),
        ),
      ])
      return {
        accounts: accounts.data,
        // id는 페이지 경계 검사용이다. 화면 모양(JournalLine)에는 없다.
        journal: journal.data.map((r) => ({
          business_id: r.business_id,
          entry_date: r.entry_date,
          account_code: r.account_code,
          amount: num(r.amount),
          side: r.side,
          slip_no: r.slip_no,
          line_no: r.line_no,
          memo: r.memo,
          source: r.source,
          fetched_at: r.fetched_at,
          closed: r.closed,
        })),
        closings: closings.data.map((r) => ({
          ...r,
          amount: num(r.amount),
          provisional_amount: r.provisional_amount === null ? null : num(r.provisional_amount),
        })),
        entries: entries.data,
        fxRates: fxRates.data.map((r) => ({ ...r, rate: num(r.rate) })),
        costIndices: costIndices.data.map((r) => ({ ...r, value: num(r.value) })),
      }
    },

    /**
     * 블록 1. 기록이 먼저, 행이 나중(HANDOVER ③). 행 쓰기가 막혀도 '만들려고 했다'가 남는다.
     * source='manual' — 화면에서 사람이 만든 계정이다. 0016 accounts_books_insert가 이 값만 받는다.
     */
    async createAccount(input: NewAccount, actor: AuditActor): Promise<Account> {
      const row = { ...input, source: 'manual' as const, fetched_at: new Date().toISOString(), closed: false, active: true }
      await audit({
        action: 'create',
        entity_table: 'accounts',
        entity_id: `${input.business_id}:${input.account_code}`,
        business_id: input.business_id,
        actor,
        after: input,
      })
      const { data, error } = await sb.from('accounts').insert(row).select(ACCOUNT_COLUMNS).single<Account>()
      if (error) throw accountError(error)
      return data
    },

    async updateAccount(businessId: string, accountCode: string, patch: AccountPatch, actor: AuditActor): Promise<Account> {
      const { data: before, error: readError } = await sb
        .from('accounts')
        .select(ACCOUNT_COLUMNS)
        .eq('business_id', businessId)
        .eq('account_code', accountCode)
        .maybeSingle<Account>()
      if (readError) throw accountError(readError)
      if (!before) throw new Error('accounts: 고칠 계정이 없다(또는 읽을 권한이 없다).')

      const keys = (Object.keys(patch) as (keyof AccountPatch)[]).filter(
        (k) => patch[k] !== undefined && before[k] !== patch[k],
      )
      if (keys.length === 0) return before
      await audit({
        action: 'update',
        entity_table: 'accounts',
        entity_id: `${businessId}:${accountCode}`,
        business_id: businessId,
        actor,
        before: Object.fromEntries(keys.map((k) => [k, before[k]])),
        after: Object.fromEntries(keys.map((k) => [k, patch[k]])),
        note: keys.includes('active') && keys.length === 1 ? (patch.active ? '계정 다시 사용' : '계정 비활성화') : null,
      })
      const { data, error } = await sb
        .from('accounts')
        .update(Object.fromEntries(keys.map((k) => [k, patch[k]])))
        .eq('business_id', businessId)
        .eq('account_code', accountCode)
        .select(ACCOUNT_COLUMNS)
      if (error) throw accountError(error)
      return oneAffectedRow('accounts', data as Account[] | null, null)
    },

    async applyStandardChart(businessId: string, actor: AuditActor): Promise<number> {
      const { data: existing, error: readError } = await sb
        .from('accounts')
        .select('account_code')
        .eq('business_id', businessId)
        .returns<{ account_code: string }[]>()
      if (readError) throw accountError(readError)
      const have = new Set((existing ?? []).map((r) => r.account_code))
      const missing = STANDARD_CHART.filter((s) => !have.has(s.code))
      if (missing.length === 0) return 0

      await audit({
        action: 'create',
        entity_table: 'accounts',
        entity_id: `${businessId}:standard-chart`,
        business_id: businessId,
        actor,
        after: { codes: missing.map((s) => s.code) },
        note: `표준 계정과목표 적용 — ${missing.length}개`,
      })
      const fetched_at = new Date().toISOString()
      const { data, error } = await sb
        .from('accounts')
        .upsert(
          missing.map((s) => ({
            business_id: businessId,
            account_code: s.code,
            name: s.name,
            category: s.category,
            section: s.section,
            cash_flow: s.cash_flow,
            source: 'manual',
            fetched_at,
          })),
          { onConflict: 'business_id,account_code', ignoreDuplicates: true },
        )
        .select('account_code')
      if (error) throw accountError(error)
      return data?.length ?? 0
    },

    /**
     * 블록 2. 감사 기록·헤더·라인이 0016 post_journal_entry() 한 번(한 트랜잭션)이다 —
     * 여기서 audit()를 따로 부르면 전표가 거부돼도 '입력했다'가 남고, 반대로 두 HTTP 사이에서 끊기면 반쪽 전표가 남는다.
     * DB의 거부 사유(closed_period / unbalanced_slip / inactive_account)는 message에 그대로 싣는다.
     */
    async postJournalEntry(input: NewJournalEntry, actor: AuditActor): Promise<string> {
      void actor // 행위자는 DB가 auth.uid() / auth_role()로 적는다. 세션이 곧 행위자다.
      const { data, error } = await sb.rpc('post_journal_entry', {
        p_business_id: input.business_id,
        p_entry_date: input.entry_date,
        p_memo: input.memo,
        p_evidence_url: input.evidence_url,
        p_lines: input.lines,
      })
      if (error) {
        throw new Error(
          `Supabase post_journal_entry ${error.code ?? '?'}: ${error.message}${error.details ? ` — ${error.details}` : ''}`,
        )
      }
      if (typeof data !== 'string') throw new Error('post_journal_entry: 전표번호가 오지 않았다.')
      return data
    },

    /** 블록 4. 감사 기록·역분개·정정분개가 0016 post_correction() 한 트랜잭션이다. */
    async postCorrection(input: NewCorrection, actor: AuditActor): Promise<CorrectionResult> {
      void actor // 행위자는 DB가 auth.uid()로 적는다.
      const { data, error } = await sb.rpc('post_correction', {
        p_business_id: input.business_id,
        p_corrects_id: input.corrects_id,
        p_entry_date: input.entry_date,
        p_memo: input.memo,
        p_evidence_url: input.evidence_url,
        p_lines: input.lines,
      })
      if (error) {
        throw new Error(
          `Supabase post_correction ${error.code ?? '?'}: ${error.message}${error.details ? ` — ${error.details}` : ''}`,
        )
      }
      const r = (data ?? {}) as { reversal?: unknown; restatement?: unknown }
      if (typeof r.reversal !== 'string') throw new Error('post_correction: 역분개 전표번호가 오지 않았다.')
      return { reversal: r.reversal, restatement: typeof r.restatement === 'string' ? r.restatement : null }
    },

    /** 블록 3. 감사 기록·결산·라인 closed가 0016 close_period() 한 트랜잭션이다. */
    async closePeriod(businessId: string, period: string, actor: AuditActor): Promise<number> {
      void actor // 행위자는 DB가 auth.uid()로 적는다.
      const { data, error } = await sb.rpc('close_period', { p_business_id: businessId, p_period: period })
      if (error) {
        throw new Error(
          `Supabase close_period ${error.code ?? '?'}: ${error.message}${error.details ? ` — ${error.details}` : ''}`,
        )
      }
      return Number(data)
    },

    /** CH-024 확장(0015). [제한] 열람 역할이 아니면 0015의 business_keymen_read가 빈 배열을 준다. */
    async listKeymen(): Promise<BusinessKeyman[]> {
      const { data } = await fetchAll<BusinessKeyman>('business_keymen', ['keyman_id'], (from, to) =>
        sb
          .from('business_keymen')
          .select(KEYMAN_COLUMNS, { count: 'exact' })
          .order('business_id')
          .order('name')
          .order('keyman_id')
          .range(from, to)
          .returns<BusinessKeyman[]>(),
      )
      return data
    },

    /**
     * saveChairmanProject와 같은 순서다 — 기록이 먼저, 바뀐 칸만.
     * 권한은 보지 않는다. 0015의 business_keymen_write가 can_approve()와 회사 범위를 본다.
     */
    async saveKeyman(input: KeymanInput, actor: AuditActor): Promise<BusinessKeyman> {
      const { keyman_id, ...fields } = input
      let before: BusinessKeyman | null = null
      if (keyman_id) {
        const { data, error } = await sb
          .from('business_keymen')
          .select(KEYMAN_COLUMNS)
          .eq('keyman_id', keyman_id)
          .maybeSingle<BusinessKeyman>()
        if (error) throw new Error(`Supabase business_keymen ${error.code ?? '?'}: ${error.message}`)
        if (!data) throw new Error('business_keymen: 고칠 키맨이 없다(또는 읽을 권한이 없다).')
        before = data
      }

      const id = keyman_id ?? crypto.randomUUID()
      const keys = (Object.keys(fields) as (keyof typeof fields)[]).filter(
        (k) => !before || before[k] !== fields[k],
      )
      if (before && keys.length === 0) return before

      const { error: auditError } = await sb.from('audit_log').insert({
        action: before ? 'update' : 'create',
        entity_table: 'business_keymen',
        entity_id: id,
        business_id: fields.business_id,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        before: before ? Object.fromEntries(keys.map((k) => [k, before![k]])) : null,
        after: Object.fromEntries(keys.map((k) => [k, fields[k]])),
      })
      if (auditError) {
        throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)
      }

      const query = before
        ? sb.from('business_keymen').update(fields).eq('keyman_id', id)
        : sb.from('business_keymen').insert({ keyman_id: id, ...fields })
      const { data, error } = await query.select(KEYMAN_COLUMNS).single<BusinessKeyman>()
      if (error) {
        throw new Error(
          `Supabase business_keymen ${error.code ?? '?'}: ${error.message} ` +
            '(감사 기록은 남았고 키맨은 바뀌지 않았다. 0015의 business_keymen_write 정책을 본다.)',
        )
      }
      return data
    },

    async removeKeyman(keymanId: string, actor: AuditActor): Promise<void> {
      const { data: before, error: readError } = await sb
        .from('business_keymen')
        .select(KEYMAN_COLUMNS)
        .eq('keyman_id', keymanId)
        .maybeSingle<BusinessKeyman>()
      if (readError) {
        throw new Error(`Supabase business_keymen ${readError.code ?? '?'}: ${readError.message}`)
      }
      if (!before) throw new Error('business_keymen: 지울 키맨이 없다(또는 읽을 권한이 없다).')

      // audit_action에 delete가 없다(delete_request는 '지워 달라는 요청'이다).
      // 행이 사라지는 변경이라 update로 남기고 after를 null로 둔다 — 지운 행 전체가 before에 있다.
      const { error: auditError } = await sb.from('audit_log').insert({
        action: 'update',
        entity_table: 'business_keymen',
        entity_id: keymanId,
        business_id: before.business_id,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        before,
        after: null,
        note: '키맨 삭제',
      })
      if (auditError) {
        throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)
      }

      const { data, error } = await sb
        .from('business_keymen')
        .delete()
        .eq('keyman_id', keymanId)
        .select('keyman_id')
      oneAffectedRow('business_keymen', data, error)
    },

    async listProjects(): Promise<Project[]> {
      const [{ data, error }, names] = await Promise.all([
        fetchAll('projects', ['project_id'], (from, to) =>
          sb
            .from('projects')
            .select(
              'project_id,business_id,name,owner_user_id,priority,status,progress_pct,deadline',
              { count: 'exact' },
            )
            .order('project_id')
            .range(from, to)
            .returns<ProjectRow[]>(),
        ),
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
        fetchAll('tasks', ['task_id'], (from, to) =>
          sb
            .from('tasks')
            .select(
              'task_id,project_id,title,owner_user_id,priority,status,blocked_since,deadline,chairman_needed',
              { count: 'exact' },
            )
            .order('task_id')
            .range(from, to)
            .returns<TaskRow[]>(),
        ),
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
      const { data, error } = await fetchAll('decisions', ['decision_id'], (from, to) =>
        sb
          .from('decisions')
          .select(
            'decision_id,business_id,title,options,ai_recommendation,impact,deadline,status,ai_confidence,attachment_url',
            { count: 'exact' },
          )
          .order('deadline')
          .order('decision_id')
          .range(from, to)
          .returns<DecisionRow[]>(),
      )
      const rows = unwrap('decisions', data, error)
      return rows.map(toDecision)
    },

    async listAlerts(): Promise<Alert[]> {
      const { data, error } = await fetchAll('alerts', ['alert_id'], (from, to) =>
        sb
          .from('alerts')
          .select('*', { count: 'exact' })
          .order('alert_id')
          .range(from, to)
          .returns<AlertRow[]>(),
      )
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
      // Chairman-facing summaries only; no Layer 1 operational/job payload tables.
      const { data, error } = await fetchAll('ai_night_outputs', ['output_id'], (from, to) =>
        sb
          .from('ai_night_outputs')
          .select(
            'output_id,business_id,job_type,result_summary,status,artifact_link,confidence,completed_at,items,run_id,run_date,model,project_notes',
            { count: 'exact' },
          )
          .order('completed_at', { ascending: false })
          .order('output_id')
          .range(from, to)
          .returns<NightOutputRow[]>(),
      )
      const rows = unwrap('ai_night_outputs', data, error)
      return rows.map((r) => ({
        output_id: r.output_id,
        completed_at: r.completed_at,
        business_id: r.business_id,
        job_type: r.job_type,
        result_summary: r.result_summary,
        status: r.status,
        artifact_link: r.artifact_link ?? '',
        confidence: r.confidence === null ? 0 : num(r.confidence),
        items: r.items ?? [],
        run_id: r.run_id,
        run_date: r.run_date,
        model: r.model,
        project_notes: r.project_notes ?? [],
      }))
    },

    /**
     * CH-042.
     * 앱에서 등급으로 거르지 않는다. documents_read(0002)가 회사 범위와
     * class_rank(security_class) <= class_rank(max_class()) 를 같이 본다 —
     * 등급이 모자란 사람에게는 그 행이 존재하지 않는 것처럼 보인다.
     * 여기서 또 거르면 판정이 두 곳으로 갈라지고, 그중 한쪽만 고치는 날이 온다.
     */
    async listDocuments(): Promise<DocumentRecord[]> {
      const [{ data, error }, names] = await Promise.all([
        fetchAll('documents', ['document_id'], (from, to) =>
          sb
            .from('documents')
            .select(
              'document_id,business_id,title,doc_type,security_class,storage_url,version,uploaded_by,created_at',
              { count: 'exact' },
            )
            .order('created_at', { ascending: false })
            .order('document_id')
            .range(from, to)
            .returns<DocumentRow[]>(),
        ),
        ownerNames(),
      ])
      const rows = unwrap('documents', data, error)
      return rows.map((r) => ({
        document_id: r.document_id,
        business_id: toScope(r.business_id),
        title: r.title,
        doc_type: r.doc_type,
        security_class: r.security_class,
        storage_url: r.storage_url,
        version: r.version,
        uploaded_by: ownerName(names, r.uploaded_by),
        created_at: r.created_at,
      }))
    },

    async listTopGoals(): Promise<TopGoal[]> {
      const { data, error } = await fetchAll('goals', ['goal_id'], (from, to) =>
        sb
          .from('goals')
          .select('*', { count: 'exact' })
          .order('goal_id')
          .range(from, to)
          .returns<GoalRow[]>(),
      )
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
        fetchAll('monthly_priorities', ['priority_id'], (from, to) =>
          sb
            .from('monthly_priorities')
            .select('*', { count: 'exact' })
            .order('priority_id')
            .range(from, to)
            .returns<PriorityRow[]>(),
        ),
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
      const { data, error } = await fetchAll('critical_risks', ['risk_id'], (from, to) =>
        sb
          .from('critical_risks')
          .select('*', { count: 'exact' })
          .order('risk_id')
          .range(from, to)
          .returns<RiskRow[]>(),
      )
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
        fetchAll('milestones', ['milestone_id'], (from, to) =>
          sb
            .from('milestones')
            .select('*', { count: 'exact' })
            .order('deadline')
            .order('milestone_id')
            .range(from, to)
            .returns<MilestoneRow[]>(),
        ),
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
     * CH-043 통합검색.
     *
     * 앱 레벨 권한 필터가 한 줄도 없다. 일부러 없다 —
     * 아래 다섯 질의는 전부 로그인한 본인의 세션으로 나가고, 0002의 read 정책들이
     * 각 표에서 이미 행을 자른다. businesses_read / projects_read / tasks_read /
     * decisions_read / documents_read 가 그대로 걸리고, 문서는 거기에 보안등급까지 같이 본다.
     * 여기서 또 거르면 판정이 두 곳으로 갈라지고, 그중 한쪽만 고치는 날이 온다.
     *
     * 길이 둘인 이유는 0009_search.sql 머리에 적어 두었다.
     *   한글이 섞인 질의  → ILIKE '%…%'  (Postgres에 한국어 사전이 없다)
     *   영문·숫자만       → search_tsv   (단어 단위. 색인이 그대로 먹는다)
     *
     * 다섯 표를 병렬로 친다. 순서대로 기다리면 드롭다운이 다섯 번의 왕복만큼 늦게 뜬다.
     */
    async search(query: string, limitPerKind: number): Promise<SearchHit[]> {
      // Product-bounded search suggestions, intentionally not a complete list.
      const q = query.trim()
      if (!q) return []

      const substring = needsSubstringSearch(q)

      /** 두 길 중 하나를 고른다. 표마다 같은 판단을 반복해 적지 않으려고 한 자리에 둔다. */
      const match = <T extends { or: (f: string) => T; textSearch: (c: string, v: string, o: { config: string; type: 'websearch' }) => T }>(
        builder: T,
        cols: string[],
      ): T =>
        substring
          ? builder.or(orIlike(cols, q))
          : builder.textSearch('search_tsv', q, { config: 'simple', type: 'websearch' })

      const [businessRows, projectRows, taskRows, decisionRows, documentRows, names] =
        await Promise.all([
          match(
            sb.from('businesses').select('business_id,name,industry').limit(limitPerKind),
            ['name', 'industry'],
          ).returns<{ business_id: string; name: string; industry: string }[]>(),

          match(
            sb.from('projects').select('project_id,name,business_id').limit(limitPerKind),
            ['name'],
          ).returns<{ project_id: string; name: string; business_id: string }[]>(),

          match(
            sb
              .from('tasks')
              .select('task_id,title,projects(name,business_id)')
              .limit(limitPerKind),
            ['title'],
          ).returns<
            {
              task_id: string
              title: string
              projects: { name: string; business_id: string } | null
            }[]
          >(),

          match(
            sb.from('decisions').select('decision_id,title,business_id').limit(limitPerKind),
            ['title', 'ai_recommendation'],
          ).returns<{ decision_id: string; title: string; business_id: string }[]>(),

          match(
            sb
              .from('documents')
              .select('document_id,title,doc_type,business_id')
              .limit(limitPerKind),
            ['title', 'doc_type'],
          ).returns<
            {
              document_id: string
              title: string
              doc_type: string
              business_id: string | null
            }[]
          >(),

          businessNames(),
        ])

      const scopeName = (id: string | null) =>
        id === null ? '그룹 공통' : (names.get(id) ?? id)

      return [
        ...unwrap('businesses', businessRows.data, businessRows.error).map(
          (r): SearchHit => ({
            kind: 'business',
            id: r.business_id,
            title: r.name,
            subtitle: r.industry,
            business_id: r.business_id,
          }),
        ),
        ...unwrap('projects', projectRows.data, projectRows.error).map(
          (r): SearchHit => ({
            kind: 'project',
            id: r.project_id,
            title: r.name,
            subtitle: scopeName(r.business_id),
            business_id: r.business_id,
          }),
        ),
        ...unwrap('tasks', taskRows.data, taskRows.error).map(
          (r): SearchHit => ({
            kind: 'task',
            id: r.task_id,
            title: r.title,
            // 업무는 회사를 project를 거쳐야 안다. 둘 다 붙여야 어느 맥락인지 읽힌다.
            subtitle: r.projects
              ? `${scopeName(r.projects.business_id)} · ${r.projects.name}`
              : '연결된 프로젝트 없음',
            business_id: r.projects?.business_id ?? null,
          }),
        ),
        ...unwrap('decisions', decisionRows.data, decisionRows.error).map(
          (r): SearchHit => ({
            kind: 'decision',
            id: r.decision_id,
            title: r.title,
            subtitle: scopeName(r.business_id),
            business_id: r.business_id,
          }),
        ),
        ...unwrap('documents', documentRows.data, documentRows.error).map(
          (r): SearchHit => ({
            kind: 'document',
            id: r.document_id,
            title: r.title,
            subtitle: `${scopeName(r.business_id)} · ${r.doc_type}`,
            business_id: r.business_id,
          }),
        ),
      ]
    },

    /**
     * CH-024.
     * toScope를 쓰지 않는다 — 0008은 business_id를 NOT NULL PK로 두었다.
     * 그룹 행이라는 개념 자체가 없어서 'group' 센티널로 옮길 값이 나오지 않는다.
     */
    async listBusinessStrategy(): Promise<BusinessStrategy[]> {
      const { data, error } = await fetchAll('business_strategy', ['business_id'], (from, to) =>
        sb
          .from('business_strategy')
          .select('*', { count: 'exact' })
          .order('business_id')
          .range(from, to)
          .returns<BusinessStrategyRow[]>(),
      )
      const rows = unwrap('business_strategy', data, error)
      return rows.map((r) => ({
        business_id: r.business_id,
        mission: r.mission,
        goal_1y: r.goal_1y,
        goal_3y: r.goal_3y,
        top_kpi: r.top_kpi,
        current_position: r.current_position,
        target_position: r.target_position,
        gap: r.gap,
        current_priority: r.current_priority,
        bottleneck: r.bottleneck,
        chairman_comment: r.chairman_comment,
        // 0015 이전 DB에는 칸이 없다. 빈 문자열이 '아직 안 썼다'의 표현이다(0008).
        current_issue: r.current_issue ?? '',
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
        fetchAll('audit_log', ['id'], (from, to) =>
          sb
            .from('audit_log')
            .select('id,entity_id,action,occurred_at,actor_user_id', { count: 'exact' })
            .eq('entity_table', 'decisions')
            .in('action', ['approve', 'reject', 'modify', 'delegate'])
            .order('occurred_at', { ascending: false })
            .order('id')
            .range(from, to)
            .returns<DecisionAuditRow[]>(),
        ),
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
     * DEFERRED D-12. 행 하나의 이력.
     *
     * action을 좁히지 않는다. 업무에는 생성·변경만 있지만 나중에 다른 행동이 붙어도
     * 이력에서 조용히 빠지면 안 된다 — 빠진 줄은 '없었던 일'로 읽힌다.
     *
     * 개수를 자르지 않는 이유도 같다. 감사 이력은 최근 몇 건이 아니라 전부다.
     * 한 행의 기록이 화면을 넘칠 만큼 쌓이면 그때 페이지를 나눌 일이지,
     * 지금 잘라 두면 잘렸다는 사실 자체가 화면에 안 나타난다.
     */
    async listEntityAudit(
      entityTable: AuditEntityTable,
      entityId: string,
    ): Promise<EntityAuditRecord[]> {
      const [{ data, error }, names] = await Promise.all([
        fetchAll('audit_log', ['id'], (from, to) =>
          sb
            .from('audit_log')
            .select('id,occurred_at,action,actor_user_id,actor_role,before,after,note', { count: 'exact' })
            .eq('entity_table', entityTable)
            .eq('entity_id', entityId)
            .order('occurred_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to)
            .returns<EntityAuditRow[]>(),
        ),
        ownerNames(),
      ])
      const rows = unwrap('audit_log', data, error)
      return rows.map((r) => ({
        id: r.id,
        occurred_at: r.occurred_at,
        action: r.action,
        actor_user_id: r.actor_user_id,
        actor_name: ownerName(names, r.actor_user_id),
        actor_role: r.actor_role,
        before: r.before,
        after: r.after,
        note: r.note,
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

      const { data: updated, error: updateError } = await sb
        .from('decisions')
        .update({
          status: DECISION_STATUS[action],
          decided_at: new Date().toISOString(),
          decided_by: entry.actor_user_id ?? null,
        })
        .eq('decision_id', entry.decision_id)
        .eq('status', 'Open')
        .select('decision_id')
        .returns<{ decision_id: string }[]>()

      if (updateError || !updated || updated.length !== 1) {
        throw new Error(
          updateError
            ? `Supabase decisions ${updateError.code ?? '?'}: ${updateError.message} ` +
              '(감사 기록은 남았고 결정 상태만 바뀌지 않았다. 0002의 decisions_decide 정책을 본다.)'
            : `Supabase decisions: mutation affected ${updated?.length ?? 0} rows ` +
              '(감사 기록은 남았고 결정 상태만 바뀌지 않았다. 이미 처리됐거나 0002의 decisions_decide 정책을 본다.)',
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

      const { data: updated, error: updateError } = await sb
        .from('tasks')
        .update(after)
        .eq('task_id', taskId)
        .select('task_id')
        .returns<{ task_id: string }[]>()
      if (updateError || !updated || updated.length !== 1) {
        throw new Error(
          updateError
            ? `Supabase tasks ${updateError.code ?? '?'}: ${updateError.message} ` +
              '(감사 기록은 남았고 업무는 바뀌지 않았다. 0002의 tasks_write 정책을 본다.)'
            : `Supabase tasks: mutation affected ${updated?.length ?? 0} rows ` +
              '(감사 기록은 남았고 업무는 바뀌지 않았다. 0002의 tasks_write 정책을 본다.)',
        )
      }
    },

    /**
     * CH-042 링크 등록.
     *
     * document_id를 보내지 않는다. 0007의 시퀀스 default가 doc_001 형태로 발급하고,
     * 방금 만든 행을 그대로 돌려받아(.select) 화면이 쓸 값을 얻는다.
     *
     * 그래서 이 한 자리만 이 파일의 다른 쓰기와 순서가 반대다 — INSERT가 먼저다.
     * 감사 기록의 entity_id가 document_id인데, 그 값을 DB가 정하기 때문이다.
     * 기록을 먼저 남기려면 id를 앱이 정해야 하고, 그러면 동시에 두 사람이 올릴 때 번호가 겹친다.
     * 겹치는 id로 남은 감사 기록은 '기록이 없는 것'보다 나쁘다 — 두 문서의 이력이 한 줄에 섞인다.
     *
     * 그 대가로 'INSERT는 됐는데 기록이 안 남는' 창이 생긴다. 그때는 호출자에게 그대로 말하고,
     * 문서는 목록에 남는다 — 조용히 지우면 그게 감사 대상 행위가 되어 버린다.
     */
    async createDocument(input: NewDocument, actor: AuditActor): Promise<DocumentRecord> {
      const scope = input.business_id === GROUP ? null : input.business_id

      const { data, error } = await sb
        .from('documents')
        .insert({
          business_id: scope,
          title: input.title,
          doc_type: input.doc_type,
          security_class: input.security_class,
          storage_url: input.storage_url,
          uploaded_by: actor.user_id,
        })
        .select(
          'document_id,business_id,title,doc_type,security_class,storage_url,version,uploaded_by,created_at',
        )
        .single<DocumentRow>()

      if (error || !data) {
        throw new Error(
          `Supabase documents ${error?.code ?? '?'}: ${error?.message ?? '행이 돌아오지 않았다'}`,
        )
      }

      const { error: auditError } = await sb.from('audit_log').insert({
        action: 'create',
        entity_table: 'documents',
        entity_id: data.document_id,
        business_id: scope,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        // 링크 주소까지 남긴다. 어디를 가리키는 문서를 등록했는지가 이 기록의 요점이다.
        after: {
          title: data.title,
          doc_type: data.doc_type,
          security_class: data.security_class,
          storage_url: data.storage_url,
        },
      })
      if (auditError) {
        throw new Error(
          `Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message} ` +
            `(문서 ${data.document_id}는 등록됐고 감사 기록만 남지 않았다.)`,
        )
      }

      return {
        document_id: data.document_id,
        business_id: toScope(data.business_id),
        title: data.title,
        doc_type: data.doc_type,
        security_class: data.security_class,
        storage_url: data.storage_url,
        version: data.version,
        // 이 칸은 표시 이름이다. uuid를 그대로 넣으면 목록에서 읽어 온 행들과 다른 값이 섞인다.
        uploaded_by: ownerName(await ownerNames(), actor.user_id),
        created_at: data.created_at,
      }
    },

    /**
     * CH-024 전략 좌표 편집 (DEFERRED D-13 결정 A).
     *
     * upsert다. update가 아닌 이유는 CH-002로 방금 만든 회사에 좌표 행이 없기 때문이다 —
     * update로 두면 그 회사는 첫 문장을 영영 못 쓴다. 화면의 '아직 등록되지 않았습니다'가
     * 막다른 길이 되어서는 안 된다.
     *
     * 순서는 이 파일의 다른 쓰기와 같다. 기록이 먼저다.
     * before를 얻으려면 한 번 읽어야 하는데, 그 읽기가 '행이 없다'도 같이 알려 준다 —
     * 그때 before는 빈 객체가 아니라 null이다. '빈 문장이었다'와 '행이 없었다'는 다르다.
     *
     * 권한은 보지 않는다. 0008의 business_strategy_write가
     * can_approve() and has_business()로 Chairman·BusinessCEO만 통과시킨다.
     */
    async updateBusinessStrategy(
      businessId: string,
      patch: StrategyPatch,
      actor: AuditActor,
    ): Promise<void> {
      const fields = Object.keys(patch) as (keyof StrategyPatch)[]
      if (fields.length === 0) return

      const { data: before, error: readError } = await sb
        .from('business_strategy')
        .select('*')
        .eq('business_id', businessId)
        .maybeSingle<BusinessStrategyRow>()

      if (readError) {
        throw new Error(
          `Supabase business_strategy ${readError.code ?? '?'}: ${readError.message}`,
        )
      }

      const { error: auditError } = await sb.from('audit_log').insert({
        action: 'update',
        entity_table: 'business_strategy',
        entity_id: businessId,
        business_id: businessId,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        // 바뀌는 칸만. 열한 칸을 통째로 남기면 무엇이 달라졌는지 읽는 사람이 다시 비교해야 한다.
        before: before
          ? Object.fromEntries(fields.map((f) => [f, before[f] ?? null]))
          : null,
        after: patch,
      })
      if (auditError) {
        throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)
      }

      // 없는 행이면 나머지 열 칸은 0008의 default ''로 채워진다. 그게 '아직 안 썼다'의 표현이다.
      const { error: writeError } = await sb
        .from('business_strategy')
        .upsert({ business_id: businessId, ...patch }, { onConflict: 'business_id' })

      if (writeError) {
        throw new Error(
          `Supabase business_strategy ${writeError.code ?? '?'}: ${writeError.message} ` +
            '(감사 기록은 남았고 좌표는 바뀌지 않았다. 0008의 business_strategy_write 정책을 본다.)',
        )
      }
    },

    /**
     * CH-041 기안 (DEFERRED D-10 선택지 A).
     *
     * decision_id를 보내지 않는다. 0010의 시퀀스 default가 발급하고 방금 만든 행을
     * 그대로 돌려받는다(.select). 그래서 createDocument와 같은 이유로 이 자리만
     * INSERT가 감사 기록보다 먼저다 — 기록의 entity_id를 DB가 정하기 때문이다.
     *
     * 그 대가로 '결재는 올라갔는데 기록이 안 남는' 창이 생긴다. 그때는 호출자에게 그대로 말하고
     * 결재는 목록에 남긴다. 조용히 지우면 그게 감사 대상 행위가 되어 버린다.
     *
     * 권한은 보지 않는다. 0002의 decisions_create가
     * has_business(business_id) and can_module('/chairman/decisions', true)를 본다.
     */
    async createDecision(input: NewDecision, actor: AuditActor): Promise<Decision> {
      const { data, error } = await sb
        .from('decisions')
        .insert({
          business_id: input.business_id,
          title: input.title,
          options: input.options,
          impact: input.impact,
          deadline: input.deadline,
          // 올린 결재는 항상 Open이다. 이 값을 화면이 정하게 두지 않는다.
          status: 'Open',
          attachment_url: input.attachment_url ?? null,
        })
        .select(
          'decision_id,business_id,title,options,ai_recommendation,ai_confidence,impact,deadline,status,attachment_url',
        )
        .single<DecisionRow>()

      if (error || !data) {
        throw new Error(
          `Supabase decisions ${error?.code ?? '?'}: ${error?.message ?? '행이 돌아오지 않았다'}`,
        )
      }

      const { error: auditError } = await sb.from('audit_log').insert({
        action: 'create',
        entity_table: 'decisions',
        entity_id: data.decision_id,
        business_id: input.business_id,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        // 첨부 링크까지 남긴다. 무엇을 근거로 올린 결재인지가 이 기록의 요점이다.
        after: {
          title: data.title,
          options: data.options,
          impact: data.impact,
          deadline: data.deadline,
          attachment_url: data.attachment_url,
        },
      })
      if (auditError) {
        throw new Error(
          `Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message} ` +
            `(결재 ${data.decision_id}는 올라갔고 감사 기록만 남지 않았다.)`,
        )
      }

      return toDecision(data)
    },

    /**
     * CH-049. 들어와 있는 사람들.
     *
     * 이메일이 없다. auth.users는 PostgREST로 나오지 않고, service_role이 없어
     * admin API로도 못 읽는다(CLAUDE.md). 화면은 이름·직함·역할로 사람을 가린다.
     *
     * revoked_at이 채워진 사람도 같이 내려보낸다. 회수는 삭제가 아니라 상태라서
     * '누가 잘렸는지'가 화면에 남아 있어야 한다 — 안 보이면 되돌릴 방법도 없다.
     * 그래서 여기서만 revoked_at 필터를 걸지 않는다(session.ts와 다른 점).
     */
    async listUserAccounts(): Promise<UserAccount[]> {
      const [{ data, error }, access] = await Promise.all([
        fetchAll('user_profiles', ['user_id'], (from, to) =>
          sb
            .from('user_profiles')
            .select(
              'user_id,role,display_name,title_ko,max_security_class,revoked_at,created_at',
              { count: 'exact' },
            )
            .order('created_at')
            .order('user_id')
            .range(from, to)
            .returns<UserProfileRow[]>(),
        ),
        fetchAll('user_business_access', ['user_id', 'business_id'], (from, to) =>
          sb
            .from('user_business_access')
            .select('user_id,business_id', { count: 'exact' })
            .order('user_id')
            .order('business_id')
            .range(from, to)
            .returns<AccessRow[]>(),
        ),
      ])

      const rows = unwrap('user_profiles', data, error)
      // A failed access-list page must not masquerade as an empty company list.
      const byUser = new Map<string, string[]>()
      for (const a of access.data ?? []) {
        byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a.business_id])
      }

      return rows.map((r) => ({
        user_id: r.user_id,
        role: r.role,
        display_name: r.display_name,
        title_ko: r.title_ko ?? '',
        max_security_class: r.max_security_class,
        revoked_at: r.revoked_at,
        business_ids: byUser.get(r.user_id) ?? [],
        created_at: r.created_at,
      }))
    },

    /** CH-049. 0011의 초대장들. 수락·취소된 것도 같이 내려보낸다 — 그것도 기록이다. */
    async listUserInvitations(): Promise<UserInvitation[]> {
      const { data, error } = await fetchAll('user_invitations', ['invitation_id'], (from, to) =>
        sb
          .from('user_invitations')
          .select(
            'invitation_id,email,role,max_security_class,business_ids,display_name,title_ko,invited_at,accepted_at,revoked_at',
            { count: 'exact' },
          )
          .order('invited_at', { ascending: false })
          .order('invitation_id')
          .range(from, to)
          .returns<UserInvitationRow[]>(),
      )

      const rows = unwrap('user_invitations', data, error)
      return rows.map(toInvitation)
    },

    /**
     * CH-049 초대.
     *
     * 계정을 만들지 않는다 — 그건 service_role의 일이고 이 프로젝트에는 없다(0011 머리 주석).
     * 여기서 만드는 것은 "이 이메일로 계정이 생기면 이 역할을 준다"는 약속 한 줄이고,
     * 0011의 on_auth_user_created 트리거가 그때 이행한다.
     *
     * 순서는 이 파일의 다른 쓰기와 같다. 기록이 먼저다.
     * 권한을 나눠 주는 결정은 CH-051이 명시적으로 기록 대상으로 꼽은 것이라
     * '주려고 했다'까지 남는 편이 맞다.
     */
    async inviteUser(input: NewInvitation, actor: AuditActor): Promise<UserInvitation> {
      const email = input.email.trim().toLowerCase()

      const { error: auditError } = await sb.from('audit_log').insert({
        // create가 아니라 permission_change다. 0001의 audit_action에 이 값이 따로 있는 이유가
        // 여기다 — CH-051이 '권한변경'을 기록 대상으로 따로 꼽았고, 나중에 감사할 때
        // '권한이 언제 움직였나'를 한 값으로 걸러 낼 수 있어야 한다.
        action: 'permission_change',
        entity_table: 'user_invitations',
        entity_id: email,
        business_id: null,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        // 무엇을 주기로 했는지가 통째로 남는다. 나중에 '왜 이 사람이 이걸 보나'의 답이 여기 있다.
        after: {
          email,
          role: input.role,
          max_security_class: input.max_security_class,
          business_ids: input.business_ids,
          display_name: input.display_name,
        },
      })
      if (auditError) {
        throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)
      }

      const { data, error } = await sb
        .from('user_invitations')
        .insert({
          email,
          role: input.role,
          max_security_class: input.max_security_class,
          business_ids: input.business_ids,
          display_name: input.display_name,
          title_ko: input.title_ko || null,
          invited_by: actor.user_id,
        })
        .select(
          'invitation_id,email,role,max_security_class,business_ids,display_name,title_ko,invited_at,accepted_at,revoked_at',
        )
        .single<UserInvitationRow>()

      if (error || !data) {
        // 23505 = 0011의 user_invitations_pending 부분 유니크. 살아 있는 초대가 이미 있다.
        if (error?.code === '23505') throw new Error(DUPLICATE_INVITATION)
        throw new Error(
          `Supabase user_invitations ${error?.code ?? '?'}: ${error?.message ?? '행이 돌아오지 않았다'} ` +
            '(감사 기록은 남았고 초대는 만들어지지 않았다. 0011의 user_invitations_admin 정책을 본다.)',
        )
      }

      return toInvitation(data)
    },

    /**
     * CH-049 권한 회수 (05_Architecture 원칙 8).
     *
     * 이미 들어온 사람은 user_profiles.revoked_at 한 줄이면 끝난다. 0002의 auth_profile()과
     * is_active()가 그 값을 보고 전 테이블을 동시에 닫는다 — 그게 원칙 8이 한 줄인 이유다.
     * user_business_access는 지우지 않는다. 지우면 되돌릴 때 무엇을 되돌릴지 알 수 없다.
     *
     * 아직 계정이 없는 사람은 자를 권한이 없다. 취소할 것은 초대장뿐이고,
     * 취소하면 0011의 부분 유니크에서 빠져 같은 이메일로 다시 초대할 수 있게 된다.
     */
    async revokeUser(target: RevokeTarget, actor: AuditActor): Promise<void> {
      const now = new Date().toISOString()
      const table = target.kind === 'account' ? 'user_profiles' : 'user_invitations'

      const { error: auditError } = await sb.from('audit_log').insert({
        // 초대와 같은 값이다. 주는 것과 거두는 것은 같은 종류의 사건이라
        // 한 값으로 걸러 낼 수 있어야 감사가 된다.
        action: 'permission_change',
        entity_table: table,
        entity_id: target.kind === 'account' ? target.user_id : target.invitation_id,
        business_id: null,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        before: { revoked_at: null },
        after: { revoked_at: now },
      })
      if (auditError) {
        throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)
      }

      if (target.kind === 'account') {
        const { data, error } = await sb
          .from('user_profiles')
          .update({ revoked_at: now })
          .eq('user_id', target.user_id)
          .is('revoked_at', null)
          .select('user_id')
          .returns<{ user_id: string }[]>()
        oneAffectedRow(table, data, error)
      } else {
        const { data, error } = await sb
          .from('user_invitations')
          .update({ revoked_at: now })
          .eq('invitation_id', target.invitation_id)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .select('invitation_id')
          .returns<{ invitation_id: string }[]>()
        oneAffectedRow(table, data, error)
      }
    },

    /**
     * CH-003/004/056.
     * where 절에 user_id를 걸지 않는다 — 0002의 user_settings_own 정책이
     * 이미 본인 행 하나만 통과시킨다. 여기서 또 거르면 판정이 두 곳으로 갈라진다.
     *
     * 행이 없으면 기본값이다. 첫 로그인에 행을 만들어 두지 않아도 화면은 떠야 한다.
     */
    /** Phase 3-B. 0014의 chairman_projects_read가 Chairman·AIAgent만 통과시킨다. 나머지는 0행이다. */
    async listChairmanProjects(): Promise<ChairmanProject[]> {
      const { data, error } = await sb
        .from('chairman_projects')
        .select('project_id,title,start_date,target_date,note,this_month_action,status')
        .order('target_date')
        .returns<ChairmanProject[]>()
      if (error) throw new Error(`Supabase chairman_projects ${error.code ?? '?'}: ${error.message}`)
      return data ?? []
    },

    async getChairmanManifesto(): Promise<ChairmanManifesto> {
      const { data, error } = await sb
        .from('chairman_manifesto')
        .select('body,updated_at')
        .eq('id', 1)
        .maybeSingle<{ body: string; updated_at: string }>()
      if (error) throw new Error(`Supabase chairman_manifesto ${error.code ?? '?'}: ${error.message}`)
      return { body: data?.body ?? '', updated_at: data?.updated_at ?? null }
    },

    /**
     * 이 파일의 다른 쓰기와 같이 기록이 먼저다. 새 프로젝트의 id는 여기서 만든다 —
     * DB default에 맡기면 audit_log에 entity_id를 적을 수 없다.
     * before/after는 바뀐 칸만 담는다(updateBusinessStrategy와 같은 이유).
     */
    async saveChairmanProject(input: ChairmanProjectInput, actor: AuditActor): Promise<ChairmanProject> {
      const { project_id, ...fields } = input
      let before: ChairmanProject | null = null
      if (project_id) {
        const { data, error } = await sb
          .from('chairman_projects')
          .select('project_id,title,start_date,target_date,note,this_month_action,status')
          .eq('project_id', project_id)
          .maybeSingle<ChairmanProject>()
        if (error) throw new Error(`Supabase chairman_projects ${error.code ?? '?'}: ${error.message}`)
        if (!data) throw new Error('chairman_projects: 고칠 프로젝트가 없다(또는 읽을 권한이 없다).')
        before = data
      }

      const id = project_id ?? crypto.randomUUID()
      const keys = (Object.keys(fields) as (keyof typeof fields)[]).filter(
        (k) => !before || before[k] !== fields[k],
      )
      if (before && keys.length === 0) return before

      const { error: auditError } = await sb.from('audit_log').insert({
        action: before ? 'update' : 'create',
        entity_table: 'chairman_projects',
        entity_id: id,
        business_id: null,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        before: before ? Object.fromEntries(keys.map((k) => [k, before![k]])) : null,
        after: Object.fromEntries(keys.map((k) => [k, fields[k]])),
      })
      if (auditError) {
        throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)
      }

      const query = before
        ? sb.from('chairman_projects').update(fields).eq('project_id', id)
        : sb.from('chairman_projects').insert({ project_id: id, ...fields })
      const { data, error } = await query
        .select('project_id,title,start_date,target_date,note,this_month_action,status')
        .single<ChairmanProject>()
      if (error) {
        throw new Error(
          `Supabase chairman_projects ${error.code ?? '?'}: ${error.message} ` +
            '(감사 기록은 남았고 프로젝트는 바뀌지 않았다. 0014의 chairman_projects 정책을 본다.)',
        )
      }
      return data
    },

    /**
     * 선언문은 한 행(id = 1)이라 upsert다. 첫 저장에는 before가 null이다 —
     * '빈 선언문이었다'와 '행이 없었다'는 다르다.
     */
    async saveChairmanManifesto(body: string, actor: AuditActor): Promise<void> {
      const { data: before, error: readError } = await sb
        .from('chairman_manifesto')
        .select('body')
        .eq('id', 1)
        .maybeSingle<{ body: string }>()
      if (readError) {
        throw new Error(`Supabase chairman_manifesto ${readError.code ?? '?'}: ${readError.message}`)
      }
      if (before && before.body === body) return

      const { error: auditError } = await sb.from('audit_log').insert({
        action: 'update',
        entity_table: 'chairman_manifesto',
        entity_id: '1',
        business_id: null,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        before: before ? { body: before.body } : null,
        after: { body },
      })
      if (auditError) {
        throw new Error(`Supabase audit_log ${auditError.code ?? '?'}: ${auditError.message}`)
      }

      const { error: writeError } = await sb
        .from('chairman_manifesto')
        .upsert({ id: 1, body, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      if (writeError) {
        throw new Error(
          `Supabase chairman_manifesto ${writeError.code ?? '?'}: ${writeError.message} ` +
            '(감사 기록은 남았고 선언문은 바뀌지 않았다. 0014의 chairman_manifesto 정책을 본다.)',
        )
      }
    },

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
