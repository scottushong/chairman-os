import type { DecisionAuditRecord, DecisionAction } from '@/lib/decision-log'
import type {
  AiNightOutput,
  Alert,
  Business,
  CriticalRisk,
  Decision,
  FinanceKpi,
  MonthlyPriority,
  NextMilestone,
  Project,
  Task,
  TopGoal,
} from '@/types'

/**
 * 화면과 데이터 사이의 유일한 계약(Port).
 *
 * 화면 컴포넌트는 이 인터페이스만 본다. 뒤에 JSON 시드가 있는지 Supabase가 있는지
 * 알 수 없어야 하고, 알 필요도 없어야 한다 — 그래야 Phase 2에서 실데이터가 붙을 때
 * 컴포넌트를 한 줄도 고치지 않는다.
 *
 * 전부 async다. dummy 어댑터는 동기로 끝나지만 시그니처까지 동기로 두면
 * live로 바꾸는 날 호출부를 전부 다시 써야 한다.
 */
export interface ChairmanRepository {
  /** 어느 쪽을 보고 있는지. 화면이 아니라 DUMMY DATA 뱃지와 로그가 쓴다. */
  readonly mode: 'dummy' | 'live'

  listBusinesses(): Promise<Business[]>
  listFinanceKpis(): Promise<FinanceKpi[]>
  listProjects(): Promise<Project[]>
  listTasks(): Promise<Task[]>
  listDecisions(): Promise<Decision[]>
  listAlerts(): Promise<Alert[]>
  listAiNightOutputs(): Promise<AiNightOutput[]>

  listTopGoals(): Promise<TopGoal[]>
  listMonthlyPriorities(): Promise<MonthlyPriority[]>
  listCriticalRisks(): Promise<CriticalRisk[]>
  listNextMilestones(): Promise<NextMilestone[]>

  /** CH-016/CH-051. 이미 처리된 결정들. '오늘 몇 건 털었나'와 처리 이력이 여기서 나온다. */
  listDecisionAudit(): Promise<DecisionAuditRecord[]>

  /** CH-016. 결정 처리를 감사 기록으로 남기고 결정 상태를 옮긴다. */
  recordDecisionAction(entry: DecisionAuditEntry): Promise<void>

  /** CH-003/004/056. 지금 로그인한 사람의 개인 설정. 남의 것은 어떤 역할도 못 읽는다(0002). */
  getUserSettings(): Promise<UserSettings>
  saveUserSettings(patch: Partial<UserSettings>): Promise<void>
}

/**
 * 개인 화면 설정(user_settings). 업무 데이터가 아니라 '이 사람의 화면'이다.
 *
 * pinned_businesses가 null을 갖는 이유는 0005_user_settings_pins.sql에 적어 두었다 —
 * '아직 정한 적 없음'과 '전부 해제했다'는 다른 상태고, 둘을 빈 배열 하나로 뭉치면
 * 마지막 핀을 뗄 때 기본 핀이 되살아난다.
 */
export interface UserSettings {
  /** CH-003. 대시보드에서 숨긴 회사. 데이터 삭제가 아니라 표시 플래그다. */
  hidden_businesses: string[]
  /** CH-004. null이면 businesses.pinned를 기본값으로 쓴다. */
  pinned_businesses: string[] | null
}

/**
 * 결정 한 건을 처리한다는 요청.
 *
 * action은 화면의 어휘('Approved')다. DB의 두 벌 어휘(decisions.status='Approved',
 * audit_log.action='approve')로 옮기는 일은 어댑터가 한다 — 그게 DB 모양을 아는 유일한 자리다.
 */
export interface DecisionAuditEntry {
  decision_id: string
  action: DecisionAction
  actor_user_id?: string
  /** 그 시점의 역할. 나중에 역할이 바뀌어도 기록은 남는다(0001 audit_log.actor_role). */
  actor_role?: string
  business_id?: string
  note?: string
}

/**
 * 메인 대시보드 한 판에 필요한 전부.
 * 화면마다 따로 부르면 live 모드에서 왕복이 열 번 넘게 생긴다.
 */
export interface DashboardSnapshot {
  businesses: Business[]
  financeKpis: FinanceKpi[]
  projects: Project[]
  tasks: Task[]
  decisions: Decision[]
  alerts: Alert[]
  aiNightOutputs: AiNightOutput[]
  decisionAudit: DecisionAuditRecord[]
  userSettings: UserSettings
  topGoals: TopGoal[]
  monthlyPriorities: MonthlyPriority[]
  criticalRisks: CriticalRisk[]
  nextMilestones: NextMilestone[]
}

export async function loadDashboard(repo: ChairmanRepository): Promise<DashboardSnapshot> {
  const [
    businesses,
    financeKpis,
    projects,
    tasks,
    decisions,
    alerts,
    aiNightOutputs,
    decisionAudit,
    userSettings,
    topGoals,
    monthlyPriorities,
    criticalRisks,
    nextMilestones,
  ] = await Promise.all([
    repo.listBusinesses(),
    repo.listFinanceKpis(),
    repo.listProjects(),
    repo.listTasks(),
    repo.listDecisions(),
    repo.listAlerts(),
    repo.listAiNightOutputs(),
    repo.listDecisionAudit(),
    repo.getUserSettings(),
    repo.listTopGoals(),
    repo.listMonthlyPriorities(),
    repo.listCriticalRisks(),
    repo.listNextMilestones(),
  ])

  return {
    businesses,
    financeKpis,
    projects,
    tasks,
    decisions,
    alerts,
    aiNightOutputs,
    decisionAudit,
    userSettings,
    topGoals,
    monthlyPriorities,
    criticalRisks,
    nextMilestones,
  }
}
