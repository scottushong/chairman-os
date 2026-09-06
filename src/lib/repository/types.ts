import type { DecisionAuditRecord, DecisionAction } from '@/lib/decision-log'
import type { SearchHit } from '@/lib/search'
import type {
  AiNightOutput,
  Alert,
  Business,
  BusinessStatus,
  BusinessStrategy,
  CriticalRisk,
  Decision,
  DocumentRecord,
  FinanceKpi,
  SecurityClass,
  MonthlyPriority,
  NextMilestone,
  Project,
  Task,
  TaskStatus,
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

  /** CH-042. 보이는 범위는 회사 권한과 보안등급이 같이 정한다(0002 documents_read). */
  listDocuments(): Promise<DocumentRecord[]>

  /**
   * CH-043. 5종(기업·프로젝트·업무·결정·문서)을 한 번에 찾는다.
   * 앱에서 권한으로 거르지 않는다 — 0002의 read 정책들이 이미 걸려 있다.
   */
  search(query: string, limitPerKind: number): Promise<SearchHit[]>

  listTopGoals(): Promise<TopGoal[]>
  listMonthlyPriorities(): Promise<MonthlyPriority[]>
  listCriticalRisks(): Promise<CriticalRisk[]>
  listNextMilestones(): Promise<NextMilestone[]>

  /** CH-024. 회사당 한 행. 그룹 행은 없다 — 그룹의 방향은 CH-011 goals가 갖는다(0008). */
  listBusinessStrategy(): Promise<BusinessStrategy[]>

  /** CH-016/CH-051. 이미 처리된 결정들. '오늘 몇 건 털었나'와 처리 이력이 여기서 나온다. */
  listDecisionAudit(): Promise<DecisionAuditRecord[]>

  /** CH-016. 결정 처리를 감사 기록으로 남기고 결정 상태를 옮긴다. */
  recordDecisionAction(entry: DecisionAuditEntry): Promise<void>

  /** CH-002. 회사를 하나 만든다. 0002에서 Chairman만 통과한다(DEFERRED D-08). */
  createBusiness(input: NewBusiness, actor: AuditActor): Promise<Business>

  /** CH-040. 업무의 상태·회장확인 플래그를 옮긴다. 0002의 tasks_write가 담당자와 승인권자만 통과시킨다. */
  updateTask(taskId: string, patch: TaskPatch, actor: AuditActor): Promise<void>

  /** CH-042. 사내 스토리지 링크 한 줄을 등록한다. 파일은 올리지 않는다. */
  createDocument(input: NewDocument, actor: AuditActor): Promise<DocumentRecord>

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
 * CH-002에서 이미 쓰고 있는 id로 회사를 만들려 했을 때 어댑터가 던지는 말.
 *
 * 문자열 한 개를 상수로 두는 이유는 Server Action이 이 실패만 다르게 말해야 하기 때문이다 —
 * 다른 실패는 '잠시 후 다시'지만 이건 사용자가 id를 고쳐야 풀린다.
 * 오류 코드로 구분할 수 없다. 중복이 두 자리(사전 검사 / INSERT 경합)에서 서로 다른 코드로 온다.
 */
export const DUPLICATE_BUSINESS_ID = 'DUPLICATE_BUSINESS_ID'

/**
 * 무엇을 한 사람인가. audit_log의 actor_user_id / actor_role로 들어간다(CH-051).
 *
 * 어댑터가 세션에서 직접 꺼내지 않고 인자로 받는다. 역할(Chairman/TeamLead…)은
 * auth.users가 아니라 user_profiles에 있고, 그건 이미 currentUser()가 한 번 읽은 값이다.
 * 어댑터가 또 읽으면 같은 요청 안에서 같은 질문을 두 번 하게 된다.
 */
export interface AuditActor {
  user_id: string
  role: string
}

/**
 * CH-002로 만들 회사 한 곳.
 *
 * business_id는 화면이 정한다(lib/business-id.ts). 서버가 만들어 주지 않는 이유는
 * 규칙이 'biz_ + 사람이 고른 영문 slug'라서다 — 사람이 고른 값을 서버가 되돌려 주면
 * 저장 버튼을 누른 뒤에야 자기 회사 id를 알게 된다.
 *
 * owner_user_id는 받지 않는다. 그 칸은 회사의 CEO이지 '이 회사를 만든 사람'이 아니다.
 * 화면에 담당자를 고르는 자리가 생기기 전까지는 비워 두는 편이 정확하다.
 */
export interface NewBusiness {
  business_id: string
  name: string
  industry: string
  status: BusinessStatus
}

/**
 * CH-042로 등록할 문서 한 건.
 *
 * 파일이 없다. storage_url은 사내 스토리지의 주소이고 Chairman OS는 그 주소만 안다
 * (CLAUDE.md 데이터 원칙 / vault_columns.md 선택지 B). Vault 등급이라고 예외가 아니다 —
 * 오히려 Vault일수록 실체가 이 DB에 없어야 한다.
 *
 * document_id가 없다. DB의 시퀀스가 doc_001 형태로 발급한다(0007) —
 * 앱이 max+1을 계산하면 동시에 둘이 올릴 때 같은 번호가 난다.
 *
 * version도 없다. 0001의 기본값 1로 들어간다. 개정을 올리는 경로는 아직 만들지 않았다.
 */
export interface NewDocument {
  title: string
  /** 'group'이면 그룹 공통 문서. 어댑터가 DB의 NULL로 옮긴다. */
  business_id: string
  doc_type: string
  security_class: SecurityClass
  storage_url: string
}

/**
 * CH-040에서 사람이 바꿀 수 있는 업무의 두 칸.
 *
 * 제목·담당자·마감은 없다. 이 화면은 '지금 어떻게 되고 있나'를 옮기는 자리지
 * 업무를 편집하는 자리가 아니다 — 편집은 Business OS(Layer 1)의 일이다.
 *
 * blocked_since는 여기 없지만 status와 같이 움직인다. 그건 사람이 정하는 값이 아니라
 * '지금 상태로 들어간 날'이라 어댑터가 찍는다(0001 tasks.blocked_since 주석, DEFERRED D-02).
 */
export interface TaskPatch {
  status?: TaskStatus
  chairman_needed?: boolean
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
