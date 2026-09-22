import type { ActivityEvent, ActivityKind } from '@/lib/activity'
import type { EntityAuditRecord } from '@/lib/audit-log'
import type { AccountFields } from '@/lib/ledger/accounts'
import type { CorrectionResult, NewCorrection, NewJournalEntry } from '@/lib/ledger/journal'
import type { DecisionAuditRecord, DecisionAction } from '@/lib/decision-log'
import type { SearchHit } from '@/lib/search'
import type {
  AbsenceDays,
  AbsenceResult,
  AbsenceTest,
  Account,
  AiNightOutput,
  Alert,
  AttentionScore,
  AutonomyAssessment,
  AutonomyLevel,
  ChairmanDirection,
  DependencyArea,
  DependencyLevel,
  FounderDependencyRow,
  InterventionRow,
  TransferStatus,
  Business,
  BusinessStatus,
  BusinessKeyman,
  BusinessStrategy,
  CalendarItem,
  ChairmanCheckin,
  ChairmanCondition,
  ChairmanEvent,
  ChairmanManifesto,
  ChairmanProject,
  CriticalRisk,
  Decision,
  DocumentRecord,
  ExceptionRecord,
  ExceptionRule,
  FinanceKpi,
  FinanceLedger,
  Initiative,
  InitiativeDoc,
  InitiativeKeyman,
  IsoDate,
  KakaoConnection,
  SecurityClass,
  MonthlyPriority,
  MyProfile,
  MyProfilePatch,
  NotificationInbox,
  NewOfficialStatement,
  OfficialStatement,
  ProcessChart,
  ProcessChartInput,
  NextMilestone,
  Project,
  NewInvitation,
  NewShare,
  ProfilePatch,
  ShareEntityTable,
  ShareRecord,
  SharePerson,
  Task,
  Team,
  TeamInput,
  TaskStatus,
  TopGoal,
  UserAccount,
  UserInvitation,
  WorkPriority,
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
  /** CH-006~010. live에서는 0015의 finance_kpis 뷰다 — 원장에서 계산되고 출처 세 칸이 붙어 나온다. */
  listFinanceKpis(): Promise<FinanceKpi[]>

  /**
   * Phase 2-A 재무 화면. 계정·전표·결산·환율·지수를 한 번에 읽는다.
   * 화면이 다섯 번 따로 부르지 않게 한 벌로 묶었다. 재무제표·원가 구조·Runway는 전부 이 한 벌에서
   * lib/ledger가 계산한다 — 어댑터는 읽기만 한다.
   * 권한은 여기서 보지 않는다. 0015의 원장 read 정책이 회사 범위와 [제한] 열람 역할을 같이 본다.
   */
  loadFinanceLedger(): Promise<FinanceLedger>

  /**
   * Phase 2-B 블록 1 — 계정과목 (0016). 권한은 여기서 보지 않는다 — can_keep_books()가 본다.
   * 코드는 만들 때 한 번 정해지고 바뀌지 않는다. 그래서 update의 patch에는 코드가 없다.
   * 계정은 지우지 않는다 — 전표·결산이 코드를 문다. active=false로 비활성화한다.
   */
  createAccount(input: NewAccount, actor: AuditActor): Promise<Account>
  updateAccount(businessId: string, accountCode: string, patch: AccountPatch, actor: AuditActor): Promise<Account>
  /** 표준 계정과목표(lib/ledger/standard-chart.ts)에서 이 회사에 없는 코드만 넣는다. 넣은 수를 돌려준다. */
  applyStandardChart(businessId: string, actor: AuditActor): Promise<number>

  /**
   * 블록 2 — 전표 한 장(헤더 + 라인 + 감사 기록)을 한 트랜잭션으로 넣는다. 전표번호를 돌려준다.
   * live는 0016의 post_journal_entry(). 차대·마감 달·비활성 계정은 DB가 거부한다.
   */
  postJournalEntry(input: NewJournalEntry, actor: AuditActor): Promise<string>

  /**
   * 블록 3 — 한 회사 한 달을 마감한다(0016 close_period). 찍은 결산 칸 수를 돌려준다.
   * 해제는 없다. 거부 사유는 lib/ledger/closing.ts CLOSE_PROBLEM_KO의 낱말로 온다.
   */
  closePeriod(businessId: string, period: string, actor: AuditActor): Promise<number>

  /**
   * 블록 4 — 정정 전표. 원 전표를 당월에 역분개하고, lines가 있으면 정정분개를 넣는다(0016 post_correction).
   * 원 전표는 그대로 남는다. 거부 사유는 lib/ledger/journal.ts CORRECTION_PROBLEM_KO의 낱말로 온다.
   */
  postCorrection(input: NewCorrection, actor: AuditActor): Promise<CorrectionResult>

  /**
   * Phase 2-C 블록 1 — 공식 재무제표(연·분기 결산) 한 벌. 새 행의 id를 돌려준다.
   * live는 0020의 official_statement_save(). 같은 기간의 이전 결산은 덮지 않고 supersede 된다.
   * 재무상태표가 닫히지 않으면 DB가 거부한다 — 화면이 먼저 보지만 판정은 DB가 한 번 더 한다.
   */
  saveOfficialStatement(input: NewOfficialStatement, actor: AuditActor): Promise<number>

  /** 그 회사의 **활성** 공식 재무제표 목록(정정으로 밀려난 것은 뺀다). 월별 화면의 잠금 판정이 쓴다. */
  listOfficialStatements(businessId: string): Promise<OfficialStatement[]>

  /**
   * Phase 5-D — 프로세스차트(0021). 읽기는 Executive 이상 + 자기 회사(DB가 판정).
   * 권한 밖 회사의 행은 아예 오지 않으므로 화면에서 다시 거르지 않는다.
   */
  listProcessCharts(): Promise<ProcessChart[]>

  /** 등록·수정. id가 있으면 수정이다. 게시 링크가 아니면 DB가 거부한다. */
  saveProcessChart(input: ProcessChartInput, actor: AuditActor): Promise<number>

  /** 삭제. 시트 자체는 그대로 남는다 — 여기서 지우는 것은 링크뿐이다. */
  deleteProcessChart(id: number, actor: AuditActor): Promise<void>
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

  /**
   * CH-017/CH-020. 행 하나에 무슨 일이 있었나 (DEFERRED D-12).
   *
   * listDecisionAudit과 합치지 않는다. 저쪽은 '결정 네 가지 행동'만 전건 훑어서
   * 대시보드가 개수를 세는 용도고, 이쪽은 행 하나를 지목해 그 줄만 시간 역순으로 읽는다.
   * 전건을 읽어 화면에서 거르면 업무가 늘어난 만큼 매 요청이 무거워진다.
   *
   * 권한은 여기서 보지 않는다. 0002의 audit_log read 정책이 회사 범위를 이미 건다.
   */
  listEntityAudit(entityTable: AuditEntityTable, entityId: string): Promise<EntityAuditRecord[]>

  /** CH-016. 결정 처리를 감사 기록으로 남기고 결정 상태를 옮긴다. */
  recordDecisionAction(entry: DecisionAuditEntry): Promise<void>

  /** CH-002. 회사를 하나 만든다. 0002에서 Chairman만 통과한다(DEFERRED D-08). */
  createBusiness(input: NewBusiness, actor: AuditActor): Promise<Business>

  /** CH-040. 업무의 상태·회장확인 플래그를 옮긴다. 0002의 tasks_write가 담당자와 승인권자만 통과시킨다. */
  updateTask(taskId: string, patch: TaskPatch, actor: AuditActor): Promise<void>

  /** CH-042. 사내 스토리지 링크 한 줄을 등록한다. 파일은 올리지 않는다. */
  createDocument(input: NewDocument, actor: AuditActor): Promise<DocumentRecord>

  /** CH-024 확장(0015). 키맨. 읽기는 [제한] 열람 역할만, 쓰기는 승인권자만이다. */
  listKeymen(): Promise<BusinessKeyman[]>
  /** keyman_id가 있으면 고치고 없으면 만든다. audit_log(create|update)에 바뀐 칸만 남는다. */
  saveKeyman(input: KeymanInput, actor: AuditActor): Promise<BusinessKeyman>
  /** 지운다. audit_log(update)에 지운 행 전체를 before로 남긴다 — 지운 사람이 누군지는 기록에 있어야 한다. */
  removeKeyman(keymanId: string, actor: AuditActor): Promise<void>

  /** CH-024. 전략 좌표의 칸을 고친다. 0008의 business_strategy_write가 승인권자만 통과시킨다. */
  updateBusinessStrategy(
    businessId: string,
    patch: StrategyPatch,
    actor: AuditActor,
  ): Promise<void>

  /** CH-041 기안. 결재를 하나 올린다. 0002의 decisions_create가 회사 범위와 모듈 쓰기를 같이 본다. */
  createDecision(input: NewDecision, actor: AuditActor): Promise<Decision>

  /**
   * CH-049 RBAC. 설정 화면이 쓰는 셋.
   * 전부 Chairman만 통과한다 — 0002의 user_profiles_admin_write / 0011의 user_invitations_admin.
   */
  listUserAccounts(): Promise<UserAccount[]>
  listUserInvitations(): Promise<UserInvitation[]>
  inviteUser(input: NewInvitation, actor: AuditActor): Promise<UserInvitation>
  /** 이미 들어온 사람은 user_profiles.revoked_at, 아직 안 온 사람은 초대를 취소한다. */
  revokeUser(target: RevokeTarget, actor: AuditActor): Promise<void>

  /**
   * Phase 6-1 블록 B — 조직도(회사 > 팀 > 사람).
   *
   * 권한은 여기서 보지 않는다. 0025의 teams_read가 회사 격리를, 0026의
   * user_profiles_self_read가 subtree를 이미 건다. **화면에서 다시 거르지 않는다** —
   * 두 곳에 규칙이 있으면 갈라지고, 갈라지는 순간 둘 중 하나는 틀린 것이 된다.
   */
  listTeams(): Promise<Team[]>
  /** 팀 추가·이름 변경·팀장 지정·회사 간 이동. 0025의 teams_write가 Chairman만 통과시킨다. */
  saveTeam(input: TeamInput, actor: AuditActor): Promise<Team>

  /**
   * 사람 한 명의 역할·팀·상사를 옮긴다. audit_log에 permission_change로 남는다
   * (새 enum 값을 만들지 않는다 — 0025 5절).
   * 0002의 user_profiles_admin_write가 Chairman만 통과시킨다.
   */
  updateUserProfile(userId: string, patch: ProfilePatch, actor: AuditActor): Promise<void>

  /**
   * 회장 결재 큐의 도장. chairman_approved_at을 채우는 update 하나다 —
   * 0026의 user_invitations_approved 트리거가 그 순간 이행까지 한다.
   */
  approveInvitation(invitationId: string, actor: AuditActor): Promise<void>

  /**
   * 회사 카드의 진행률(0028 company_progress).
   *
   * 프로젝트 목록에서 앱이 평균을 내지 않는다. 0027 이후 그 목록은 보는 사람마다 잘려서
   * 같은 회사 카드가 사람마다 다른 숫자를 보이기 때문이다. 진행률은 회사의 사실이라
   * definer 집계가 평균 하나만 내준다. 못 보는 회사와 프로젝트가 없는 회사는 둘 다 null이다.
   */
  listCompanyProgress(businessIds: string[]): Promise<Record<string, number | null>>

  /**
   * Phase 6-1 블록 C — 공유.
   *
   * 가시성을 앱이 다시 검사하지 않는다. 0026의 shares_insert_visible이 "볼 수 있는 것만
   * 공유할 수 있다"를 판정하고, 거부되면 그 사유를 한국어로 옮겨 보여 주는 것까지가 화면의 몫이다.
   */
  listShares(entityTable: ShareEntityTable, entityId: string): Promise<ShareRecord[]>
  /**
   * **나에게** 공유된 것 전부. 만료된 것은 오지 않는다 — shared_with_me()가 이미 거른다.
   *
   * viewerId를 받는다. 0025의 shares_read는 '받은 것 + 내가 한 공유'를 같이 내주는데
   * (그 둘 다 그 사람의 일이다), 이 목록이 답하는 질문은 "나에게 지금 무엇이 열려 있나"
   * 하나뿐이라 받은 것만 남겨야 한다. 정책을 좁히는 것이 아니라 **질문이 다르다** —
   * 내가 연 공유는 그 항목의 상세 화면(SharePanel)이 보여 준다.
   */
  listSharesWithMe(viewerId: string): Promise<ShareRecord[]>
  createShare(input: NewShare, actor: AuditActor): Promise<ShareRecord>
  /** 회수. 연 사람만 지울 수 있다(0025 shares_revoke). 기간 연장은 회수 후 재공유다. */
  revokeShare(shareId: string, actor: AuditActor): Promise<void>
  /** 공유 대상 후보(0028 company_people). 이름 두 칸과 id뿐이고, 질의가 비면 0행이다. */
  searchSharePeople(query: string): Promise<SharePerson[]>

  /**
   * Phase 3-B 회장 루틴(0014). Chairman은 읽고 쓰고, AIAgent는 읽기만, 나머지는 빈 결과다.
   * 권한은 여기서 보지 않는다 — 0014의 RLS가 판정한다.
   */
  listChairmanProjects(): Promise<ChairmanProject[]>
  /** 행이 아직 없으면 body '' / updated_at null. */
  getChairmanManifesto(): Promise<ChairmanManifesto>
  /** project_id가 있으면 고치고 없으면 만든다. audit_log(create|update)를 같이 남긴다. */
  saveChairmanProject(input: ChairmanProjectInput, actor: AuditActor): Promise<ChairmanProject>
  /** 전문을 통째로 바꾼다. audit_log(update)에 before/after 전문이 남는다. */
  saveChairmanManifesto(body: string, actor: AuditActor): Promise<void>

  /**
   * Phase 5 회장 체크인(0019). Chairman만 읽고 쓴다 — 0014/0017과 달리 AIAgent에게도
   * 읽기를 주지 않는다(0019 마이그레이션 주석 참고). Chairman이 아니면 null이다 — 없는 것과
   * 못 읽는 것을 구분하지 않는다.
   */
  getCheckin(date: IsoDate): Promise<ChairmanCheckin | null>
  /** checkin_date가 있으면 고치고(그날 값 갱신) 없으면 만든다. audit_log(create|update)를 같이 남긴다. */
  saveCheckin(input: ChairmanCheckinInput, actor: AuditActor): Promise<ChairmanCheckin>
  /**
   * P5-5d에서 만든 keyhole을 Phase 3-C에서 하루 넓힌 것(0023 chairman_recent_condition()).
   * 표를 직접 읽지 않고 RPC를 부른다 — Chairman·AIAgent 세션 양쪽에서 통과한다(RLS가 아니라
   * 함수 안의 역할 판정이라서다).
   *
   * '오늘'이 아니라 '오늘 아니면 어제'인 이유: 야간 Job이 23:00 KST에서 07:00 KST로 옮겨 가,
   * 회장의 아침 체크인보다 **먼저** 도는 것이 기본이 됐다. 오늘 것만 보면 거의 매일 null이라
   * 브리핑에서 컨디션 문장이 통째로 사라진다. 대신 어느 날 값인지(checkin_date) 같이 주고,
   * 모델이 "어제 컨디션 기준"이라고 말하게 한다.
   *
   * 다른 역할이거나 이틀 안에 기록이 없으면 null — 없는 것과 못 읽는 것을 여기서도
   * 구분하지 않는다. 화면의 '오늘 체크인' 칸은 Chairman 세션으로 표를 그대로 읽는
   * getCheckin을 쓴다(src/app/(morning)/ai/page.tsx).
   */
  getRecentCondition(): Promise<{ condition: ChairmanCondition; checkin_date: IsoDate } | null>

  /**
   * Phase 3-C 카카오 연결 상태(0023 kakao_token_status()). Chairman이 아니면 null이다.
   *
   * 토큰 값은 이 경로로 오지 않는다 — 0023의 함수가 반환 목록에서 아예 뺐다.
   * 화면이 필요한 것은 '연결됐나 · 언제까지 · 메시지 동의가 있나' 셋뿐이고,
   * 그 셋만 오면 access_token이 실수로 HTML에 실리는 경로 자체가 없다.
   */
  getKakaoConnection(): Promise<KakaoConnection | null>

  /**
   * Phase 4-A 이니셔티브(0017). Chairman·GroupCFO는 읽고 쓰고, AIAgent는 읽기만,
   * 나머지 역할에게는 전부 빈 결과다. 권한은 여기서 보지 않는다 — 0017의 RLS가 판정한다.
   *
   * 목록은 필터 없이 통째로 준다. 회장의 건은 수십 건이지 수천 건이 아니다 —
   * 필터를 계약에 넣으면 dummy와 live가 필터를 각자 구현하게 되고 둘이 갈라진다.
   */
  listInitiatives(): Promise<Initiative[]>
  getInitiative(initiativeId: string): Promise<Initiative | null>
  /** initiative_id가 있으면 고치고 없으면 만든다. audit_log(create|update)를 같이 남긴다. */
  saveInitiative(input: InitiativeInput, actor: AuditActor): Promise<Initiative>

  /** 회장 메모. Chairman이 아니면 늘 null이다 — 없는 것과 못 읽는 것을 구분하지 않는다. */
  getInitiativeNote(initiativeId: string): Promise<string | null>
  saveInitiativeNote(initiativeId: string, note: string, actor: AuditActor): Promise<void>

  listInitiativeKeymen(): Promise<InitiativeKeyman[]>
  saveInitiativeKeyman(input: InitiativeKeymanInput, actor: AuditActor): Promise<InitiativeKeyman>
  removeInitiativeKeyman(keymanId: string, actor: AuditActor): Promise<void>

  listInitiativeDocs(): Promise<InitiativeDoc[]>
  saveInitiativeDoc(input: InitiativeDocInput, actor: AuditActor): Promise<InitiativeDoc>
  removeInitiativeDoc(docId: string, actor: AuditActor): Promise<void>

  /**
   * 로고를 올린다(0018 initiative-logos). 저장된 **경로**를 돌려준다 — URL이 아니다.
   * 어댑터가 initiatives.logo_url까지 같이 쓴다. 두 번 부르지 않게 한 메서드로 묶었다 —
   * 객체만 올라가고 칸이 안 바뀌면 화면에서 영영 안 보이는 고아 객체가 된다.
   */
  saveInitiativeLogo(initiativeId: string, file: LogoUpload, actor: AuditActor): Promise<string>
  /** 객체와 logo_url을 같이 비운다. */
  removeInitiativeLogo(initiativeId: string, actor: AuditActor): Promise<void>
  /**
   * 경로 → 화면에 걸 수 있는 URL. 목록 전체를 한 번에 넘긴다 — 카드마다 부르면
   * 14장짜리 그리드가 서명 요청 14번이 된다. 발급하지 못한 경로는 맵에 없다(없는 파일 등).
   */
  signInitiativeLogos(paths: string[]): Promise<Record<string, string>>

  listEvents(): Promise<ChairmanEvent[]>
  saveEvent(input: EventInput, actor: AuditActor): Promise<ChairmanEvent>
  removeEvent(eventId: string, actor: AuditActor): Promise<void>

  /** 0017 calendar_items 뷰. from·to는 'YYYY-MM-DD' 포함 구간이다. */
  listCalendarItems(from: IsoDate, to: IsoDate): Promise<CalendarItem[]>

  /** CH-003/004/056. 지금 로그인한 사람의 개인 설정. 남의 것은 어떤 역할도 못 읽는다(0002). */
  getUserSettings(): Promise<UserSettings>
  saveUserSettings(patch: Partial<UserSettings>): Promise<void>

  /**
   * Phase 5-E 1-2절 (0030 notifications). 헤더 알림 종이 세는 것.
   *
   * **지금은 늘 0건이 온다.** 알림을 만드는 코드가 아직 없고 0030이 insert를 아무에게도
   * 주지 않았다 — 0이 뜨는 것이 맞고, 그것이 예전의 하드코딩 12/5보다 정직하다.
   *
   * limit은 드롭다운이 그릴 줄 수다. 안 읽은 건수(unread)는 그 잘림과 무관하게 전부를 센다.
   */
  listNotifications(limit: number): Promise<NotificationInbox>

  /** 읽음 표시. 지우지 않는다 — 0030은 read_at **한 칸만** update를 허용한다. */
  markNotificationsRead(ids: string[]): Promise<void>

  /**
   * Phase 5-E 2절. 지금 로그인한 사람의 프로필 한 벌(/settings/profile).
   * 세션(currentUser)이 아니라 여기서 읽는 이유는 생년월일·언어가 세션에 없기 때문이다 —
   * 헤더가 매 화면마다 쓰지 않는 칸을 세션에 싣지 않는다.
   */
  getMyProfile(): Promise<MyProfile | null>

  /**
   * 본인 프로필의 다섯 칸. 0030 update_own_profile()이 문이다.
   * false면 DB가 거절한 것이다(이름이 비었거나 회수된 계정). 예외가 아니라 값으로 온다.
   */
  saveMyProfile(patch: MyProfilePatch): Promise<boolean>

  /**
   * Phase 3-C 현지 시간(0029). 아침 알림 시간대의 입력 두 칸.
   *
   * 표가 아니라 keyhole(chairman_brief_timezone())로 읽는다. user_settings는 남의 행을
   * 어떤 역할도 못 읽는 표라, 야간 Job(AIAgent)이 회장의 설정을 볼 길이 그것뿐이고 —
   * 화면과 Job이 **같은 문**을 지나야 둘이 다른 값을 보는 날이 안 온다.
   */
  getBriefTimezone(): Promise<BriefTimezoneSettings>
  /** ③ 수동 시간대. null이면 자동(② 출장 → ① 접속 → Asia/Seoul)으로 되돌린다. */
  saveBriefTimezone(tz: string | null): Promise<void>
  /** ① 마지막 접속 기기의 시간대. 클라이언트가 Intl로 보낸 값을 그대로 적는다. */
  saveCurrentTimezone(tz: string): Promise<void>

  /**
   * 0032 프로필 사진. 본인 것만이다 — 어댑터가 user_id를 받지 않는 것이 그 표현이다.
   * 경로는 auth.uid()로 정해지고(lib/profile-photo.ts photoPath), 0032의 쓰기 정책 셋이
   * 그 경로의 주인과 세션을 비교한다. 올린 경로를 돌려준다.
   */
  saveMyPhoto(file: PhotoUpload): Promise<string>

  /** 사진을 내린다. 포인터를 먼저 비우고 객체를 지운다(0018 removeInitiativeLogo와 같은 순서). */
  removeMyPhoto(): Promise<void>

  /**
   * 경로 목록을 한 번에 서명한다. 요청자 세션으로 발급하므로 **0032의 읽기 정책이
   * 그대로 걸린다** — 이름이 안 보이는 사람의 사진은 서명 자체가 실패하고 맵에서 빠진다.
   * 가시성을 화면이 다시 판정하지 않는 이유가 그것이다.
   */
  signProfilePhotos(paths: string[]): Promise<Record<string, string>>

  /**
   * 블록 7. 열람 기록 한 줄(audit_log action='read', 0031 record_read()).
   *
   * **5분 중복 억제는 여기가 아니라 DB 안에 있다.** 어댑터가 억제를 판정하면 그것은
   * 앱이 "이번엔 안 보낼게"를 정하는 것이고, 그러면 기록이 아니다. 돌려주는 값은
   * '이번에 한 줄 남았는가'이고, 화면은 그 값을 쓰지 않는다 — 검사와 dummy 확인이 쓴다.
   *
   * ip 칸이 없다. 도시까지다.
   */
  recordRead(input: ReadEventInput): Promise<boolean>

  /**
   * 블록 7. /settings/activity가 읽는 유일한 문(0031 activity_events()).
   *
   * **회장이 아니면 0건이다.** 그 판정은 DB 함수 안에 있다 — 화면이 역할을 보고 안
   * 부르는 것이 아니라, 불러도 0건이 온다. 두 겹이 같은 답을 해야 한 겹이 느슨해진
   * 날 드러난다.
   *
   * days는 180(보관 기간)에서 잘린다. 그것도 DB 쪽에서 한다.
   */
  listActivityEvents(days: number): Promise<ActivityEvent[]>

  /**
   * 블록 7. 브리핑 한 줄이 읽는 주간 집계(0031 activity_digest).
   *
   * **숫자만이다 — 사람도 경로도 도시도 없다.** 야간 Job(AIAgent)은 audit_log의 FORCE
   * RLS 때문에 남의 열람 기록을 한 줄도 못 읽고, 읽게 해 주는 것이 이 기능이 막으려는
   * 일이다. 그래서 요약이 표로 따로 산다. 없으면(그 주에 기록이 없으면) null.
   */
  getActivityWeek(): Promise<ActivityWeek | null>

  /* ---------------------------------------------------------------- 블록 A 승계 */

  /**
   * §7+§11 의존 영역. 0033 dependency_areas.
   * level·transfer_status는 **null일 수 있다** — 'LOW'도 'not_started'도 아닌 '아직 없음'이다.
   */
  listDependencyAreas(): Promise<DependencyArea[]>

  /** §9 분기 자율성 평가. 평가가 없는 회사는 행이 아예 없다 — 화면이 추정하지 않는다. */
  listAutonomyAssessments(): Promise<AutonomyAssessment[]>

  /** §12 부재 테스트. pending(예정)도 같은 표에 있다. */
  listAbsenceTests(): Promise<AbsenceTest[]>

  /** §20+§21 Direction·Letter. 회사당 한 줄, 없으면 목록에 없다. */
  listChairmanDirections(): Promise<ChairmanDirection[]>

  /**
   * §7 지표. 뷰 founder_dependency(회사 × 월 · KST). 0034가 문을 바꿨다.
   *
   * **회사의 값은 보는 사람과 무관하게 같다.** 집계는 `founder_dependency_rows()`가
   * 소유자의 눈으로 하고(0034 2절이 `decisions`의 force를 내렸다), 계정에 따라 달라지는
   * 것은 «어느 회사가 목록에 오는가»뿐이다 — 판정은 `can_read_succession()` 하나다.
   * 0033에서는 0026의 다섯째 겹이 분모를 계정마다 다르게 만들었다.
   */
  listFounderDependency(): Promise<FounderDependencyRow[]>

  /**
   * §7·§34 회장 개입. 뷰 interventions. 0034부터 `audit_log`가 아니라 집계 전용 표
   * `intervention_counts`를 읽는다.
   *
   * **Chairman·GroupCFO는 전부, BusinessCEO는 자기 회사.** 그 밖의 역할에는 0행이다.
   * `audit_log_read`는 한 글자도 넓히지 않았다 — 그 표에는 열람 기록(read·login)이 있어
   * 넓히면 블록 7이 지킨 것이 무너진다(0031 2절이 같은 자리에서 같은 판단을 했다).
   * 0행인 역할에게 화면은 0건이라고 말하지 않고 '권한 밖이라 집계되지 않습니다'라고 말한다.
   */
  listInterventions(): Promise<InterventionRow[]>

  /** 의존 영역 한 줄 저장(신규·수정). Chairman·GroupCFO만. */
  saveDependencyArea(input: DependencyAreaInput, actor: AuditActor): Promise<DependencyArea>

  /** 분기 자율성 평가 저장. 같은 분기에 두 번 넣으면 덮어쓴다. */
  saveAutonomyAssessment(
    input: AutonomyAssessmentInput,
    actor: AuditActor,
  ): Promise<AutonomyAssessment>

  /** 부재 테스트 저장(예정 등록 · 결과 기록). */
  saveAbsenceTest(input: AbsenceTestInput, actor: AuditActor): Promise<AbsenceTest>

  /** Direction·Letter 저장. 보낸 칸만 바꾼다 — 안 보낸 칸은 그대로 둔다. */
  saveChairmanDirection(
    input: ChairmanDirectionInput,
    actor: AuditActor,
  ): Promise<ChairmanDirection>

  /* ---------------------------------------------------------------- 블록 B 주의 */

  /**
   * §18 규칙 사전. 0035 `exception_rules`의 13종.
   * **읽기는 활성 사용자 전부다** — 임계값은 회사 데이터가 아니라 그룹의 정책 상수이고,
   * "왜 DY가 yellow인가"를 설명하려면 그 회사 사람도 규칙을 봐야 한다.
   */
  listExceptionRules(): Promise<ExceptionRule[]>

  /**
   * §18 감지된 예외. 0035 `exceptions`.
   *
   * **독자는 그 회사의 [제한] 등급 독자(+ 그 표에 쓰는 사람)뿐이다** — `exceptions.value`에
   * 들어오는 숫자가 `finance_kpis`가 잠가 둔 바로 그 숫자라서다(0035 7절).
   * TeamLead·Member에게는 **0행**이고, 화면은 그들에게 "0건"이나 "정상입니다"라고 말하면
   * 안 된다 — 없는 것과 못 보는 것은 다른 사실이다.
   */
  listExceptions(): Promise<ExceptionRecord[]>

  /**
   * §19 점수. 0035 `attention_scores`. 예외 하나에 한 줄이고, **없을 수 있다**.
   * **화면이 색을 고를 때 읽는 칸이 아니다** — 그것은 `exceptions.severity` 하나다.
   * 이 표는 «왜 그 색인가»와 «여섯 축 중 몇 개가 비었나»를 설명할 때 읽는다.
   */
  listAttentionScores(): Promise<AttentionScore[]>
}

/** 0033 dependency_areas 한 줄의 입력. id가 없으면 신규다(business_id+area로 덮어쓴다). */
export interface DependencyAreaInput {
  business_id: string
  area: string
  area_en?: string | null
  level: DependencyLevel | null
  transfer_status: TransferStatus | null
  target_date: string | null
  note: string | null
  sort_order?: number
}

export interface AutonomyAssessmentInput {
  business_id: string
  /** YYYY-Qn */
  quarter: string
  level: AutonomyLevel
  note: string | null
}

export interface AbsenceTestInput {
  business_id: string
  days: AbsenceDays
  scheduled_on: string
  result: AbsenceResult
  note: string | null
}

/**
 * Direction 저장. **보낸 칸만 바꾼다.** 전부 덮으면 편집 화면 한 곳에서 저장할 때마다
 * 다른 화면이 채운 칸이 지워진다(§21의 일곱 칸은 한 번에 다 쓰는 것이 아니다).
 */
export interface ChairmanDirectionInput {
  business_id: string
  five_year?: string | null
  priorities?: string[]
  do_not?: string[]
  contact_when?: string[]
  why_own?: string | null
  capital_philosophy?: string | null
  cares_about?: string[]
  not_managed?: string[]
  red_lines?: string[]
  letter?: string | null
}

/** 사진 바이트 한 장. LogoUpload와 같은 모양이다(파일은 Server Action 직렬화를 못 탄다). */
export interface PhotoUpload {
  bytes: ArrayBuffer
  contentType: string
}

/** record_read()가 받는 것. **ip가 없다** — 0031의 함수 시그니처와 같은 모양이다. */
export interface ReadEventInput {
  path: string
  kind: ActivityKind
  entity_id: string | null
  entity_table: string | null
  business_id: string | null
  /** 'Chrome · Windows'. 원문 User-Agent가 아니다. */
  device: string | null
  /** 'Seoul, KR'. IP가 아니다. */
  city: string | null
}

/** 0031 activity_digest 한 행. 사람 이름이 한 칸도 없다. */
export interface ActivityWeek {
  week_start: IsoDate
  events: number
  doc_reads: number
  people: number
}

/** 0029 chairman_brief_timezone()이 주는 두 칸. 우선순위 판정은 lib/chairman-timezone.ts가 한다. */
export interface BriefTimezoneSettings {
  /** ③ 회장이 손으로 고른 값. null = 자동. */
  brief_tz: string | null
  /** ① 마지막 접속 기기가 보낸 값. */
  current_tz: string | null
}

/** CH-024 키맨 폼이 보내는 한 행. keyman_id가 없으면 새 사람이다. */
export type NewAccount = { business_id: string; account_code: string } & AccountFields
export type AccountPatch = Partial<AccountFields & { active: boolean }>

/** 같은 회사에 같은 계정코드가 이미 있을 때. 사용자가 코드를 고쳐야 풀린다(DUPLICATE_BUSINESS_ID와 같은 이유). */
export const DUPLICATE_ACCOUNT_CODE = 'DUPLICATE_ACCOUNT_CODE'

export type KeymanInput = Omit<BusinessKeyman, 'keyman_id'> & { keyman_id?: string }

/** /settings/chairman 폼이 보내는 한 행. project_id가 없으면 새 프로젝트다. */
export type ChairmanProjectInput = Omit<ChairmanProject, 'project_id'> & { project_id?: string }

/** 체크인 패널이 보내는 한 행. checkin_date가 그날의 키다 — saveInitiativeNote와 같은 upsert 모양. */
export type ChairmanCheckinInput = Omit<ChairmanCheckin, 'updated_at'>

export type InitiativeInput = Omit<Initiative, 'initiative_id' | 'updated_at'> & { initiative_id?: string }
export type InitiativeKeymanInput = Omit<InitiativeKeyman, 'keyman_id'> & { keyman_id?: string }
export type InitiativeDocInput = Omit<InitiativeDoc, 'doc_id'> & { doc_id?: string }
export type EventInput = Omit<ChairmanEvent, 'event_id'> & { event_id?: string }

/** 로고 업로드 한 건. File을 그대로 넘기지 않는다 — 어댑터가 브라우저 타입을 알 이유가 없다. */
export interface LogoUpload {
  bytes: ArrayBuffer
  contentType: string
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
  /**
   * Phase 5-E 3절 (0030). 사이드바 접힘·숨김의 **키 주머니**. 타입이 unknown인 것이 요점이다 —
   * 이 계층은 주머니 안의 모양을 모르고, 읽는 규칙은 lib/ui-prefs.ts 한 곳에만 있다.
   * 그래야 Phase 7이 사이드바 항목을 통째로 갈아 끼워도 어댑터가 따라 바뀌지 않는다.
   */
  sidebar_prefs: unknown
  /** Phase 5-E 4절 (0030). 테마·알림 종류별 on/off. 같은 이유로 unknown이다. */
  app_prefs: unknown
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
 * CH-049에서 이미 살아 있는 초대가 있는 이메일로 또 초대하려 했을 때.
 *
 * 0011의 user_invitations_pending 부분 유니크가 막는다. 이것도 사용자가 고쳐야 풀리는
 * 입력 오류라 다른 실패와 다르게 말해야 한다 — DUPLICATE_BUSINESS_ID와 같은 이유다.
 */
export const DUPLICATE_INVITATION = 'DUPLICATE_INVITATION'

/**
 * 같은 사람에게 같은 것을 두 번 공유하려 했을 때(0025 shares의 unique 제약).
 *
 * 이것도 사용자가 고쳐야 풀리는 입력이라 다른 실패와 다르게 말해야 한다 —
 * "이미 열려 있습니다. 기간을 바꾸려면 회수하고 다시 공유하세요"가 그 문장이다
 * (기간 연장 경로가 따로 없는 이유는 0025가 shares에 update 정책을 두지 않았기 때문이다).
 */
export const DUPLICATE_SHARE = 'DUPLICATE_SHARE'

/**
 * 무엇을 한 사람인가. audit_log의 actor_user_id / actor_role로 들어간다(CH-051).
 *
 * 어댑터가 세션에서 직접 꺼내지 않고 인자로 받는다. 역할(Chairman/TeamLead…)은
 * auth.users가 아니라 user_profiles에 있고, 그건 이미 currentUser()가 한 번 읽은 값이다.
 * 어댑터가 또 읽으면 같은 요청 안에서 같은 질문을 두 번 하게 된다.
 */
/**
 * 이력을 되짚을 수 있는 테이블.
 *
 * 문자열을 그대로 받지 않는 이유는 이 값이 PostgREST 필터로 그대로 들어가기 때문이다.
 * 지금은 호출부가 전부 리터럴이라 위험이 없지만, 목록을 좁혀 두면 나중에 URL에서 온 값을
 * 그대로 흘려보내는 실수를 타입이 먼저 잡는다.
 *
 * 이 목록은 'audit_log에 남는 테이블 전부'가 아니라 '단건 화면이 실제로 되짚어 읽는 테이블'이다
 * (아래 각주 참고). accounts/business_keymen/business_strategy/user_invitations/
 * chairman_projects/chairman_manifesto/initiative_keymen/initiative_docs/initiative_notes/events는
 * 전부 supabase.ts 어댑터가 entity_table로 남기지만, 그 행 하나만 지목해 이력을 보여 주는
 * 단건 화면이 없다 — keymen/문서/이벤트는 이니셔티브·회사 상세 화면에 인라인으로 얹혀 있고,
 * '이 키맨 한 명의 변경 이력'을 따로 보여 주는 자리가 없다. 그래서 여기 없다고 놓친 게
 * 아니라 아직 읽는 화면이 없어서 없는 것이다 — 그런 화면이 생기면 그때 한 줄 추가한다
 * (Phase 4-A Task 7 리뷰).
 */
export type AuditEntityTable =
  | 'tasks'
  | 'projects'
  | 'decisions'
  | 'documents'
  | 'businesses'
  // Phase 4-A. /initiatives/[id]가 이 건 자체의 변경 이력을 되짚는다(supabase.ts가 이미
  // entity_table: 'initiatives'로 남기고 있었다 — 이 타입만 갱신을 놓쳤었다).
  | 'initiatives'

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
 * CH-024로 고칠 수 있는 칸들 (DEFERRED D-13 결정 A).
 *
 * business_id가 없다. 그건 이 행이 어느 회사인가지 고쳐 쓰는 문장이 아니다 —
 * 좌표를 다른 회사로 옮기는 동작은 존재하지 않는다.
 *
 * 전부 선택이라 한 칸만 담아 보낼 수 있다. 화면이 칸 하나씩 저장하기 때문이고(인라인 편집),
 * 그래야 audit_log의 before/after가 '무엇이 바뀌었나'만 담는다.
 */
export type StrategyPatch = Partial<Omit<BusinessStrategy, 'business_id'>>

/**
 * CH-041로 올릴 결재 한 건 (DEFERRED D-10 선택지 A).
 *
 * decision_id가 없다. 0010의 시퀀스 default가 dec_005 형태로 발급한다 —
 * documents와 같은 이유다. 앱이 max+1을 계산하면 동시에 둘이 올릴 때 번호가 겹친다.
 *
 * status도 없다. 올린 결재는 항상 Open이다. 다른 값으로 시작하는 기안은
 * '올리자마자 이미 처리된 결재'라 감사 기록에 구멍을 낸다.
 *
 * ai_recommendation / ai_confidence도 없다. 그 둘은 야간 AI Job이 채우는 칸이고
 * 사람이 기안하면서 스스로 'AI가 이걸 추천했다'고 쓰는 자리가 아니다.
 */
export interface NewDecision {
  business_id: string
  title: string
  /** 02_데이터필드에서 필수다. 결재는 '무엇을 고를 것인가'라서 선택안이 없으면 결재가 아니다. */
  options: string[]
  impact: WorkPriority
  deadline: string
  /** 사내 스토리지 링크. 없으면 넣지 않는다(0006). */
  attachment_url?: string
}

/**
 * 누구의 권한을 회수하는가 (05_Architecture 원칙 8).
 *
 * 두 경우가 다르다. 이미 들어온 사람은 user_profiles.revoked_at 한 줄로 전 테이블이 닫히고,
 * 아직 계정이 없는 사람은 자를 권한이 없다 — 취소할 것은 초대장뿐이다.
 * 한 함수에 합친 이유는 화면에서 둘이 같은 버튼(권한 회수)이기 때문이다.
 *
 * user_business_access는 지우지 않는다. revoked_at이 채워지면 0002의 is_active()가
 * 거짓이 되어 has_business()가 어차피 false다. 지우면 되돌릴 때 누가 어느 회사를
 * 보고 있었는지가 사라진다.
 */
export type RevokeTarget =
  | { kind: 'account'; user_id: string }
  | { kind: 'invitation'; invitation_id: string }

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
