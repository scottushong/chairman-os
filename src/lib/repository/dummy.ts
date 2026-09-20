import {
  aiNightOutputs,
  alerts,
  businessCoordinates,
  businesses,
  criticalRisks,
  decisions,
  monthlyPriorities,
  nextMilestones,
  projects,
  tasks,
  topGoals,
} from '@/data'
import type { EntityAuditRecord } from '@/lib/audit-log'
import { kstToday } from '@/lib/chairman-project'
import { AUDIT_ACTION, DECISION_STATUS, type DecisionAuditRecord } from '@/lib/decision-log'
import { dayKey } from '@/lib/format'
import { logoPath } from '@/lib/initiative-logo'
import { kpisFromLedger } from '@/lib/ledger/cells'

import * as books from './dummy-books'
import { dummyLedger } from './dummy-books'
import {
  DUMMY_DOCUMENTS,
  DUMMY_INVITATION_SEED,
  DUMMY_PEOPLE,
  DUMMY_PROJECTS,
  DUMMY_SHARE_SEED,
  DUMMY_TASKS,
  DUMMY_TEAMS,
  dummyHasBusiness,
  dummyOwnerUnknown,
  dummyPerson,
  dummySharedWithMe,
  dummyViewer,
} from './dummy-org'
import { emptyStrategy } from '@/lib/strategy-fields'
import type { SearchHit } from '@/lib/search'
import { needsChairmanApproval } from '@/types'
import type {
  AppNotification,
  Business,
  BusinessKeyman,
  MyProfile,
  MyProfilePatch,
  NotificationInbox,
  NewShare,
  ProfilePatch,
  SecurityClass,
  ShareEntityTable,
  ShareRecord,
  SharePerson,
  Team,
  TeamInput,
  BusinessStrategy,
  CalendarItem,
  ChairmanCheckin,
  ChairmanEvent,
  ChairmanManifesto,
  ChairmanProject,
  Decision,
  DecisionStatus,
  DocumentRecord,
  Initiative,
  InitiativeDoc,
  InitiativeKeyman,
  IsoDate,
  KakaoConnection,
  NewInvitation,
  Task,
  UserAccount,
  UserInvitation,
} from '@/types'

import {
  DUPLICATE_BUSINESS_ID,
  DUPLICATE_INVITATION,
  DUPLICATE_SHARE,
  type AuditActor,
  type AuditEntityTable,
  type ChairmanCheckinInput,
  type ChairmanProjectInput,
  type ChairmanRepository,
  type DecisionAuditEntry,
  type EventInput,
  type InitiativeDocInput,
  type InitiativeInput,
  type InitiativeKeymanInput,
  type KeymanInput,
  type LogoUpload,
  type NewBusiness,
  type NewDecision,
  type NewDocument,
  type RevokeTarget,
  type StrategyPatch,
  type TaskPatch,
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
const memoryDecisionStatuses = new Map<string, DecisionStatus>()

/**
 * DEFERRED D-12. 단건 화면이 읽는 이력.
 *
 * live의 audit_log를 흉내 낸 것이라 여기도 append only다 — 지우는 경로를 두지 않는다.
 * 다만 서버가 살아 있는 동안만이다. 영구 기록은 live 모드의 Supabase뿐이다(CH-051).
 */
type StoredAudit = EntityAuditRecord & { entity_table: AuditEntityTable; entity_id: string }
const memoryEntityAudit: StoredAudit[] = []

/**
 * Phase 3-B 회장 루틴. 시드가 없다 — 회장 개인의 문장이라 git에 넣지 않는다(0014).
 * dummy에서는 화면에서 넣은 값이 서버가 살아 있는 동안만 남는다.
 */
const memoryChairmanProjects: ChairmanProject[] = []
const memoryManifesto: ChairmanManifesto = { body: '', updated_at: null }

/**
 * Phase 5 체크인(0019). 시드가 없다 — 회장의 몸 상태가 git에 들어가면 안 된다
 * (chairman_manifesto와 같은 이유). 키는 checkin_date다 — 하루 한 행.
 */
const memoryCheckins = new Map<IsoDate, ChairmanCheckin>()

/**
 * Phase 4-A 이니셔티브(0017). 시드가 없다 — 회장이 지금 누구와 무엇을 협상 중인지가
 * git에 들어가면 안 된다(0014 회장 루틴과 같은 이유). 서버가 살아 있는 동안만 남는다.
 */
const memoryInitiatives: Initiative[] = []
const memoryInitiativeNotes = new Map<string, string>()
const memoryInitiativeKeymen: InitiativeKeyman[] = []
const memoryInitiativeDocs: InitiativeDoc[] = []

/**
 * P5-A. dummy에는 Storage가 없다. 올라온 바이트를 data URL로 들고 있는다 —
 * 그래야 업로드→표시 전 흐름을 원격 Supabase 없이 검증할 수 있다(회장 확인 방식).
 * 키는 supabase 어댑터가 쓰는 것과 같은 경로다. 두 어댑터의 logo_url 값이 같은 모양이어야
 * 화면이 분기를 모른 채 돌아간다.
 */
const memoryLogos = new Map<string, string>()
const memoryEvents: ChairmanEvent[] = []
let initiativeSeq = 0

/**
 * CH-024 키맨(0015). 시드가 없다 — 실제 사람 이름이 git에 들어가면 안 된다(0014 회장 루틴과 같은 이유).
 * dummy에서는 화면에서 넣은 사람이 서버가 살아 있는 동안만 남는다.
 */
const memoryKeymen: BusinessKeyman[] = []

/** CH-002로 추가한 회사도 마찬가지다. 서버가 살아 있는 동안만 남는다. */
const memoryBusinesses: Business[] = []

/**
 * CH-040으로 바꾼 업무 상태. 시드 배열(src/data)은 읽기 전용이라 덮어쓸 수 없어
 * 바뀐 칸만 따로 들고 있다가 listTasks에서 덮는다. 이것도 서버가 살아 있는 동안만이다.
 */
const memoryTaskPatches = new Map<string, TaskPatch & { blocked_since?: string }>()

/**
 * CH-042로 등록한 문서. 시드 JSON이 없는 표라(0003의 '넣지 않는 테이블') 처음에는 비어 있다.
 * 여기도 서버가 살아 있는 동안만이다.
 */
const memoryDocuments: DocumentRecord[] = []

/**
 * CH-024로 고친 좌표. businessCoordinates(시드)는 읽기 전용이라 바뀐 칸만 따로 들고 있다가
 * listBusinessStrategy에서 덮는다. memoryTaskPatches와 같은 방식이고, 같은 한계다 —
 * 서버를 재시작하면 사라진다.
 */
const memoryStrategyPatches = new Map<string, StrategyPatch>()

/** CH-041로 올린 기안. 여기도 서버가 살아 있는 동안만이다. */
const memoryDecisions: Decision[] = []

/**
 * CH-049로 만든 초대장. 여기도 서버가 살아 있는 동안만이다.
 *
 * 계정 목록(listUserAccounts)은 늘 비어 있다. dummy에는 auth.users도 user_profiles도
 * 없어서 흉내 낼 사람이 없다 — 시드로 가짜 계정을 만들어 두면 '누가 이 시스템을 쓰나'의
 * 답이 두 곳(가짜 시드 / 진짜 DB)으로 갈라진다. 화면은 그때 빈 목록을 그리고 이유를 말한다.
 */
const memoryInvitations: UserInvitation[] = DUMMY_INVITATION_SEED.map((i) => ({ ...i }))

/**
 * Phase 6-1. 조직도·공유의 dummy 저장소.
 *
 * 사람과 팀은 시드가 있다(dummy-org.ts). 0026 이후로 '계정 목록은 늘 비어 있다'가
 * 더는 정답이 아니기 때문이다 — 조직도 화면과 검증 a~f를 눈으로 볼 방법이 없어진다.
 * 화면에서 옮긴 자리(역할·팀·상사)와 회수는 서버가 살아 있는 동안만 남는다.
 */
const memoryPeople: UserAccount[] = DUMMY_PEOPLE.map((p) => ({ ...p }))
const memoryTeams: Team[] = DUMMY_TEAMS.map((t) => ({ ...t }))
const memoryShares: ShareRecord[] = DUMMY_SHARE_SEED.map((s) => ({ ...s }))

/** 0025 class_rank(). 배열 순서가 곧 등급 순서다(SECURITY_CLASS). */
const CLASS_RANK: Record<SecurityClass, number> = { Public: 0, Normal: 1, Restricted: 2, Vault: 3 }

/**
 * dummy의 다섯 번째 겹. **DB 정책을 옮겨 적은 것이지 화면의 규칙이 아니다** —
 * live에서는 이 함수가 한 번도 돌지 않고 RLS가 같은 판정을 한다(dummy-org.ts 머리 주석).
 *
 * 0026이 tasks/projects/documents에 쓴 식과 같은 모양이다:
 *   회사 격리 AND (본인 | 내 subtree | 공유받음 | 주인 없음 [| 문서는 공개 등급])
 */
function canSeeRow(businessId: string | null, ownerId: string | null): boolean {
  const viewer = memoryPerson(dummyViewer().user_id)
  if (!dummyHasBusiness(viewer, businessId)) return false
  return (
    ownerId === viewer.user_id ||
    inMemorySubtree(viewer.user_id, ownerId) ||
    dummyOwnerUnknown(ownerId)
  )
}

/** 화면에서 상사를 옮기면 그 순간부터 subtree도 달라져야 한다 — 시드가 아니라 현재 상태를 본다. */
function inMemorySubtree(viewerId: string, targetId: string | null): boolean {
  if (!targetId) return false
  let cur = memoryPeople.find((p) => p.user_id === targetId)
  for (let depth = 0; cur && depth < 20; depth += 1) {
    if (cur.user_id === viewerId) return true
    const next: string | null = cur.reports_to
    cur = next ? memoryPeople.find((p) => p.user_id === next) : undefined
  }
  return false
}

function memoryPerson(userId: string): UserAccount {
  return memoryPeople.find((p) => p.user_id === userId) ?? dummyViewer()
}

/**
 * 업무가 매달린 프로젝트의 회사. live에서는 0027의 project_business_id()가 같은 답을 준다 —
 * 그쪽도 회사 칸 하나만 내주는 문이고, 업무의 회사 판정이 '프로젝트가 보이는가'로
 * 바뀌지 않게 하는 것이 요점이다.
 */
function businessOfDummyProject(projectId: string): string | null {
  const owned = DUMMY_PROJECTS.find((p) => p.project.project_id === projectId)
  if (owned) return owned.project.business_id
  return projects.find((p) => p.project_id === projectId)?.business_id ?? null
}

/** 담당자 uuid → 표시 이름. live의 createOwnerNames()와 같은 자리다(못 찾으면 원값 그대로). */
function ownerLabel(ownerId: string): string {
  return dummyPerson(ownerId)?.display_name ?? ownerId
}

/** 개인 설정도 마찬가지다. 서버가 살아 있는 동안만 남는다. */
const memorySettings: UserSettings = {
  hidden_businesses: [],
  pinned_businesses: null,
  // 0030의 두 주머니. dummy에서도 실제로 저장돼야 사이드바 숨김·테마를 화면에서 눌러 볼 수 있다.
  // 프로세스 메모리에만 산다 — 서버를 재시작하면 사라지는 것이 이 어댑터의 계약이다.
  sidebar_prefs: {},
  app_prefs: {},
}

/**
 * Phase 5-E 1-2절. dummy의 알림함은 **비어 있다.**
 *
 * 시드로 서너 줄 넣어 두고 싶은 유혹이 있는데, 그러면 dummy에서 종에 '3'이 뜨고
 * live에서 '0'이 뜬다 — 하드코딩 12/5를 지운 이유가 정확히 그 어긋남이다.
 * 알림을 **만드는** 코드가 생기는 날 이 배열도 같이 채운다.
 */
const memoryNotifications: AppNotification[] = []

/**
 * dummy의 본인 프로필. 시드 사람(dummy-org.ts)에서 시작하고, 설정 화면에서 고친 값이
 * 여기 얹힌다. user_id별로 둔다 — DUMMY_USER를 바꿔 다른 사람으로 들어오면 그 사람의 값이다.
 */
const memoryProfilePatch = new Map<string, MyProfilePatch>()

/**
 * Phase 3-C 현지 시간. dummy에도 두 칸을 둔다 — /settings/chairman의 '수동 시간대'와
 * '지금 어느 시간대로 판정되나' 한 줄이 dummy 모드에서 실제로 움직여야 화면을 볼 수 있다.
 * 프로세스 메모리에만 산다(이 파일의 다른 쓰기와 같다).
 */
const memoryBriefTimezone: { brief_tz: string | null; current_tz: string | null } = {
  brief_tz: null,
  current_tz: null,
}

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
  /**
   * live의 0015 finance_kpis 뷰를 흉내 낸다. 시트 JSON을 그대로 돌려주지 않고 mock 원장에서 계산한다 —
   * 그래야 출처 꼬리표(확정/잠정)가 붙고, 시트와 원장이 같은 숫자를 낸다는 검증
   * (scripts/check-finance-ledger.ts)이 dummy 화면에도 그대로 적용된다.
   */
  async listFinanceKpis() {
    const ledger = await dummyLedger()
    return kpisFromLedger(ledger, [...new Set(ledger.accounts.map((a) => a.business_id))])
  },

  /** mock 원장 + 화면에서 한 장부 쓰기(dummy-books.ts). */
  loadFinanceLedger: dummyLedger,
  createAccount: books.createAccount,
  updateAccount: books.updateAccount,
  applyStandardChart: books.applyStandardChart,
  postJournalEntry: books.postJournalEntry,
  closePeriod: books.closePeriod,
  postCorrection: books.postCorrection,
  saveOfficialStatement: books.saveOfficialStatement,
  listOfficialStatements: books.listOfficialStatements,
  listProcessCharts: books.listProcessCharts,
  saveProcessChart: books.saveProcessChart,
  deleteProcessChart: books.deleteProcessChart,

  async listKeymen() {
    return memoryKeymen.map((k) => ({ ...k }))
  },

  /** live에서는 0015의 business_keymen_write가 승인권자만 통과시킨다. dummy는 판정을 흉내 내지 않는다. */
  async saveKeyman(input: KeymanInput, actor: AuditActor) {
    const { keyman_id, ...fields } = input
    const existing = keyman_id ? memoryKeymen.find((k) => k.keyman_id === keyman_id) : undefined
    if (keyman_id && !existing) throw new Error('business_keymen: 고칠 키맨이 없다.')
    const saved: BusinessKeyman = existing
      ? Object.assign(existing, fields)
      : { keyman_id: crypto.randomUUID(), ...fields }
    if (!existing) memoryKeymen.push(saved)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] save keyman by ${actor.role} — 메모리에만 남는다.`)
    }
    return { ...saved }
  },

  async removeKeyman(keymanId: string, actor: AuditActor) {
    const i = memoryKeymen.findIndex((k) => k.keyman_id === keymanId)
    if (i < 0) throw new Error('business_keymen: 지울 키맨이 없다.')
    memoryKeymen.splice(i, 1)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] remove keyman by ${actor.role} — 메모리에만 남는다.`)
    }
  },
  /**
   * 시드 다섯 + 담당자가 분명한 DY 행 둘. 뒤엣것에만 다섯 번째 겹이 실제로 걸린다 —
   * 시드의 담당자('user_001')는 이 조직도에 없는 사람이라 '주인 없는 행'이고,
   * 그건 live에서 0003 시드의 가상 uuid가 읽히는 방식 그대로다(0026 owner_unknown).
   */
  async listProjects() {
    const viewer = dummyViewer()
    return [
      ...projects.filter((p) => canSeeRow(p.business_id, null)),
      ...DUMMY_PROJECTS.filter(
        (p) =>
          canSeeRow(p.project.business_id, p.owner_user_id) ||
          dummySharedWithMe(memoryShares, viewer.user_id, 'projects', p.project.project_id),
      ).map((p) => ({ ...p.project, owner: ownerLabel(p.owner_user_id) })),
    ]
  },
  async listTasks(): Promise<Task[]> {
    const viewer = dummyViewer()
    const seeded = tasks
      .filter((t) => canSeeRow(businessOfDummyProject(t.project_id), null))
      .map((t) => ({ ...t, ...memoryTaskPatches.get(t.task_id) }))
    const owned = DUMMY_TASKS.filter(
      (t) =>
        canSeeRow(businessOfDummyProject(t.task.project_id), t.owner_user_id) ||
        dummySharedWithMe(memoryShares, viewer.user_id, 'tasks', t.task.task_id),
    ).map((t) => ({
      ...t.task,
      owner: ownerLabel(t.owner_user_id),
      ...memoryTaskPatches.get(t.task.task_id),
    }))
    return [...seeded, ...owned]
  },
  async listDecisions() {
    return [...decisions, ...memoryDecisions].map((decision) => ({
      ...decision,
      status: memoryDecisionStatuses.get(decision.decision_id) ?? decision.status,
    }))
  },
  async listAlerts() {
    return [...alerts]
  },
  async listAiNightOutputs() {
    return [...aiNightOutputs]
  },

  /**
   * CH-042. live에서는 documents_read(0002+0026)가 판정한다. 여기서는 그 식을 옮겨 적는다:
   * 회사 AND 등급 AND (본인 | subtree | 공유 | 공개 | 주인 없음).
   * '공개'(Public) 분기가 검증 e다 — 공지는 위계와 무관하게 전 직원이 본다.
   */
  async listDocuments(): Promise<DocumentRecord[]> {
    const viewer = memoryPerson(dummyViewer().user_id)
    const seeded = DUMMY_DOCUMENTS.filter(
      (d) =>
        dummyHasBusiness(viewer, d.document.business_id) &&
        CLASS_RANK[d.document.security_class] <= CLASS_RANK[viewer.max_security_class] &&
        (d.document.security_class === 'Public' ||
          d.owner_user_id === viewer.user_id ||
          inMemorySubtree(viewer.user_id, d.owner_user_id) ||
          dummySharedWithMe(memoryShares, viewer.user_id, 'documents', d.document.document_id) ||
          dummyOwnerUnknown(d.owner_user_id)),
    ).map((d) => ({ ...d.document, uploaded_by: ownerLabel(d.owner_user_id) }))
    return [...seeded, ...memoryDocuments]
  },

  /**
   * CH-043. live에서는 두 길(full-text / ILIKE)이 갈리지만 여기서는 하나다.
   * dummy에는 색인도 사전도 없고, 부분 일치 하나면 시드 500행을 훑는 데 충분하다.
   * 그래서 검색 결과가 dummy와 live에서 미묘하게 다를 수 있다 — 영문 질의에서 그렇다.
   */
  async search(query: string, limitPerKind: number): Promise<SearchHit[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []

    const hit = (...fields: (string | undefined)[]) =>
      fields.some((f) => f?.toLowerCase().includes(q))

    const all = [...businesses, ...memoryBusinesses]
    const scopeName = (id: string | null) =>
      id === null ? '그룹 공통' : (all.find((b) => b.business_id === id)?.name ?? id)

    return [
      ...all
        .filter((b) => hit(b.name, b.industry))
        .slice(0, limitPerKind)
        .map((b): SearchHit => ({
          kind: 'business',
          id: b.business_id,
          title: b.name,
          subtitle: b.industry,
          business_id: b.business_id,
        })),
      ...projects
        .filter((p) => hit(p.name))
        .slice(0, limitPerKind)
        .map((p): SearchHit => ({
          kind: 'project',
          id: p.project_id,
          title: p.name,
          subtitle: scopeName(p.business_id),
          business_id: p.business_id,
        })),
      ...tasks
        .filter((t) => hit(t.title))
        .slice(0, limitPerKind)
        .map((t): SearchHit => {
          const project = projects.find((p) => p.project_id === t.project_id)
          return {
            kind: 'task',
            id: t.task_id,
            title: t.title,
            subtitle: project
              ? `${scopeName(project.business_id)} · ${project.name}`
              : '연결된 프로젝트 없음',
            business_id: project?.business_id ?? null,
          }
        }),
      ...[...decisions, ...memoryDecisions]
        .filter((d) => hit(d.title, d.ai_recommendation))
        .slice(0, limitPerKind)
        .map((d): SearchHit => ({
          kind: 'decision',
          id: d.decision_id,
          title: d.title,
          subtitle: scopeName(d.business_id),
          business_id: d.business_id,
        })),
      ...memoryDocuments
        .filter((d) => hit(d.title, d.doc_type))
        .slice(0, limitPerKind)
        .map((d): SearchHit => ({
          kind: 'document',
          id: d.document_id,
          title: d.title,
          subtitle: `${scopeName(d.business_id === 'group' ? null : d.business_id)} · ${d.doc_type}`,
          business_id: d.business_id === 'group' ? null : d.business_id,
        })),
    ]
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
   * CH-024. live에서는 0008 business_strategy가 같은 값을 갖는다.
   * 시드에 없는 회사(CH-002로 방금 추가한 곳)도 좌표를 쓴 적이 있으면 여기서 같이 나온다 —
   * live의 upsert와 같은 동작이어야 화면이 두 모드에서 다르게 굴지 않는다.
   */
  async listBusinessStrategy(): Promise<BusinessStrategy[]> {
    const seeded = businessCoordinates.map((c) => ({
      // 시드 JSON에는 0015의 current_issue가 없다. 빈 칸에서 출발한다.
      ...emptyStrategy(c.business_id),
      ...c,
      ...memoryStrategyPatches.get(c.business_id),
    }))
    const seededIds = new Set(seeded.map((c) => c.business_id))
    const added = [...memoryStrategyPatches.entries()]
      .filter(([id]) => !seededIds.has(id))
      .map(([id, patch]) => ({ ...emptyStrategy(id), ...patch }))
    return [...seeded, ...added]
  },

  async listDecisionAudit() {
    return [...memoryAudit]
  },

  /**
   * DEFERRED D-12. live의 audit_log 역조회와 같은 모양으로 답한다.
   *
   * 시드가 없어서 이 서버가 뜬 뒤 실제로 고친 것만 나온다. 가짜 이력을 심지 않는다 —
   * 없는 기록을 채워 두면 dummy에서만 이력이 있고 live 첫 화면은 비어, 어느 쪽이
   * 맞는지 화면만 보고는 알 수 없게 된다.
   */
  async listEntityAudit(
    entityTable: AuditEntityTable,
    entityId: string,
  ): Promise<EntityAuditRecord[]> {
    // 저장할 때만 어느 행인지 같이 들고 있다가, 내줄 때는 계약(EntityAuditRecord)만 남긴다.
    return memoryEntityAudit
      .filter((r) => r.entity_table === entityTable && r.entity_id === entityId)
      .sort((a, b) => b.id - a.id)
      .map((r) => ({
        id: r.id,
        occurred_at: r.occurred_at,
        action: r.action,
        actor_user_id: r.actor_user_id,
        actor_name: r.actor_name,
        actor_role: r.actor_role,
        before: r.before,
        after: r.after,
        note: r.note,
      }))
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

  /** CH-040. live에서는 0002의 tasks_write가 거를 일이지만, dummy에는 RLS가 없다. */
  async updateTask(taskId: string, patch: TaskPatch, actor: AuditActor): Promise<void> {
    const seeded = tasks.find((t) => t.task_id === taskId)
    if (!seeded) throw new Error('Dummy tasks: mutation affected 0 rows.')

    const current = memoryTaskPatches.get(taskId) ?? {}
    /** 바뀌기 직전의 값. 시드 위에 지금까지의 메모리 패치를 얹은 것이 '현재'다. */
    const before = { ...seeded, ...current }

    const next = { ...current, ...patch }
    // 상태가 바뀌면 대기일수 기준선도 같이 옮긴다. live 어댑터와 같은 규칙이어야 한다.
    if (patch.status !== undefined) next.blocked_since = dayKey()
    memoryTaskPatches.set(taskId, next)

    // live 어댑터와 같은 diff를 남긴다 — 바뀌는 칸만이다(supabase.ts updateTask).
    const after: Record<string, unknown> = {}
    if (patch.status !== undefined) {
      after.status = patch.status
      after.blocked_since = next.blocked_since
    }
    if (patch.chairman_needed !== undefined) after.chairman_needed = patch.chairman_needed

    memoryEntityAudit.push({
      id: memoryEntityAudit.length + 1,
      entity_table: 'tasks',
      entity_id: taskId,
      occurred_at: new Date().toISOString(),
      action: 'update',
      actor_user_id: actor.user_id,
      actor_name: actor.user_id,
      actor_role: actor.role,
      before: Object.fromEntries(
        Object.keys(after).map((k) => [k, before[k as keyof typeof before] ?? null]),
      ),
      after,
      note: null,
    })

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] update ${taskId} by ${actor.role} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
  },

  /** CH-042. id는 live에서 DB 시퀀스가 준다. 여기서는 같은 모양(doc_001)을 흉내 낸다. */
  async createDocument(input: NewDocument, actor: AuditActor): Promise<DocumentRecord> {
    const created: DocumentRecord = {
      document_id: `doc_${String(memoryDocuments.length + 1).padStart(3, '0')}`,
      business_id: input.business_id,
      title: input.title,
      doc_type: input.doc_type,
      security_class: input.security_class,
      storage_url: input.storage_url,
      version: 1,
      uploaded_by: '미지정',
      created_at: new Date().toISOString(),
    }
    memoryDocuments.push(created)

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] create ${created.document_id} by ${actor.role} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
    return created
  },

  /**
   * CH-024. live에서는 0008의 business_strategy_write가 승인권자만 통과시키지만
   * dummy에는 역할도 RLS도 없다. 여기서 역할을 흉내 내면 dummy에서만 도는 두 번째 판정이 생긴다.
   */
  async updateBusinessStrategy(businessId: string, patch: StrategyPatch, actor: AuditActor) {
    memoryStrategyPatches.set(businessId, {
      ...(memoryStrategyPatches.get(businessId) ?? {}),
      ...patch,
    })

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] update strategy ${businessId} by ${actor.role} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
  },

  /** CH-041 기안. id는 live에서 0010의 시퀀스가 준다. 여기서는 같은 모양(dec_005)을 흉내 낸다. */
  async createDecision(input: NewDecision, actor: AuditActor): Promise<Decision> {
    const created: Decision = {
      decision_id: `dec_${String(decisions.length + memoryDecisions.length + 1).padStart(3, '0')}`,
      business_id: input.business_id,
      title: input.title,
      options: input.options,
      // 야간 AI Job이 채우는 칸이다. 사람이 올린 기안에는 아직 없다.
      ai_recommendation: '',
      impact: input.impact,
      deadline: input.deadline,
      status: 'Open',
      attachment_url: input.attachment_url,
    }
    memoryDecisions.push(created)

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] create ${created.decision_id} by ${actor.role} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
    return created
  },

  /**
   * CH-049 + Phase 6-1 블록 B.
   *
   * 2026-09-21까지 이 함수는 빈 배열이었다("dummy에는 사용자 표가 없다"). 0026이 사람 목록을
   * subtree로 자른 뒤로 그 답은 더는 맞지 않는다 — 조직도 화면과 회장 지시의 검증 a~f를
   * **화면에서** 확인할 방법이 사라진다. 그래서 시드 트리를 넣고(dummy-org.ts),
   * 0026의 user_profiles_self_read와 같은 식으로 자른다.
   *
   * 자르는 자리는 여기다. 화면은 받은 것을 그대로 그린다.
   */
  async listUserAccounts(): Promise<UserAccount[]> {
    const viewer = memoryPerson(dummyViewer().user_id)
    if (viewer.role === 'Chairman') return memoryPeople.map((p) => ({ ...p }))
    return memoryPeople
      .filter((p) => p.user_id === viewer.user_id || inMemorySubtree(viewer.user_id, p.user_id))
      .map((p) => ({ ...p }))
  },

  /** 0025 teams_read = 회사 격리. subtree로 자르지 않는다 — 팀 이름은 뼈대이지 비밀이 아니다. */
  async listTeams(): Promise<Team[]> {
    const viewer = memoryPerson(dummyViewer().user_id)
    return memoryTeams.filter((t) => dummyHasBusiness(viewer, t.business_id)).map((t) => ({ ...t }))
  },

  /** live에서는 0025의 teams_write가 Chairman만 통과시킨다. dummy는 판정을 흉내 내지 않는다. */
  async saveTeam(input: TeamInput, actor: AuditActor): Promise<Team> {
    const existing = memoryTeams.find((t) => t.team_id === input.team_id)
    const saved: Team = existing ? Object.assign(existing, input) : { ...input }
    if (!existing) memoryTeams.push(saved)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] save team ${input.team_id} by ${actor.role} — 메모리에만 남는다.`)
    }
    return { ...saved }
  },

  /**
   * 역할·팀·상사를 옮긴다. live에서는 0002 user_profiles_admin_write가 Chairman만 통과시키고,
   * 순환은 0025의 트리거가 막는다. 여기서는 순환만 흉내 낸다 — 그것이 막히지 않으면
   * 조직도가 무한히 접히는 화면 버그로 나타나서, dummy에서도 같은 거부 문구가 필요하다.
   */
  async updateUserProfile(userId: string, patch: ProfilePatch, actor: AuditActor): Promise<void> {
    const target = memoryPeople.find((p) => p.user_id === userId)
    if (!target) throw new Error('Dummy user_profiles: mutation affected 0 rows.')

    if (patch.reports_to !== undefined && patch.reports_to !== null) {
      if (patch.reports_to === userId) throw new Error('자기 자신을 직속 상사로 지정할 수 없습니다')
      if (inMemorySubtree(userId, patch.reports_to)) {
        throw new Error('보고 체계에 순환이 생깁니다')
      }
    }
    Object.assign(target, patch)

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] profile ${userId} ${JSON.stringify(patch)} by ${actor.role} — 메모리에만 남는다.`,
      )
    }
  },

  /**
   * 0026 user_invitations_subtree_read를 옮겨 적은 것: 초대자 본인 + 그 위 subtree
   * (회장은 0011의 정책으로 전부 본다). 아래와 옆은 남의 초대를 보지 못한다.
   */
  async listUserInvitations(): Promise<UserInvitation[]> {
    const viewer = memoryPerson(dummyViewer().user_id)
    if (viewer.role === 'Chairman') return memoryInvitations.map((i) => ({ ...i }))
    return memoryInvitations
      .filter((i) => i.invited_by === viewer.user_id || inMemorySubtree(viewer.user_id, i.invited_by))
      .map((i) => ({ ...i }))
  },

  /**
   * 회장 결재 큐의 도장. live에서는 이 update 하나가 0026의 트리거로 이행까지 간다.
   * dummy에는 계정이 생기는 순간이 없으므로 도장까지만 찍는다.
   */
  async approveInvitation(invitationId: string, actor: AuditActor): Promise<void> {
    const found = memoryInvitations.find((i) => i.invitation_id === invitationId)
    if (!found || found.accepted_at || found.revoked_at || found.chairman_approved_at) {
      throw new Error('Dummy user_invitations: mutation affected 0 rows.')
    }
    found.chairman_approved_at = new Date().toISOString()
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] approve invitation ${invitationId} by ${actor.role} — 메모리에만 남는다.`)
    }
  },

  /**
   * 회사 진행률(live는 0028 company_progress). **보는 사람에 따라 달라지지 않는다** —
   * 위에서 listProjects()가 자른 목록이 아니라 시드 전체에서 낸다. 그것이 definer 집계의
   * 뜻이고, 그래서 영업 직원과 회장이 같은 회사 카드에서 같은 숫자를 본다.
   */
  async listCompanyProgress(businessIds: string[]): Promise<Record<string, number | null>> {
    const viewer = memoryPerson(dummyViewer().user_id)
    const all = [...projects, ...DUMMY_PROJECTS.map((p) => p.project)]
    return Object.fromEntries(
      businessIds.map((id) => {
        if (!dummyHasBusiness(viewer, id)) return [id, null]
        const own = all.filter((p) => p.business_id === id)
        if (own.length === 0) return [id, null]
        return [id, Math.round(own.reduce((sum, p) => sum + p.progress_pct, 0) / own.length)]
      }),
    )
  },

  /** 0025 shares_read = 내가 받은 것 + 내가 한 공유. 남이 남에게 한 공유는 존재도 보이지 않는다. */
  async listShares(entityTable: ShareEntityTable, entityId: string): Promise<ShareRecord[]> {
    const me = dummyViewer().user_id
    return memoryShares
      .filter(
        (s) =>
          s.entity_table === entityTable &&
          s.entity_id === entityId &&
          (s.shared_with === me || s.shared_by === me),
      )
      .map((s) => ({ ...s }))
  },

  /** 나에게 공유된 것. 만료된 것은 오지 않는다 — live의 shared_with_me()와 같은 판정이다. */
  async listSharesWithMe(viewerId: string): Promise<ShareRecord[]> {
    return memoryShares
      .filter((s) => s.shared_with === viewerId)
      .filter((s) => s.expires_at === null || Date.parse(s.expires_at) > Date.now())
      .map((s) => ({ ...s }))
  },

  /**
   * 공유를 연다. live에서는 0026의 shares_insert_visible이 "볼 수 있는 것만"을 판정한다.
   * dummy는 그 판정을 흉내 내지 않는다 — 여기서 다시 구현하면 규칙이 갈라진다.
   * 같은 사람에게 같은 것을 두 번 열지 않는 것만 지킨다(0025의 unique 제약).
   */
  async createShare(input: NewShare, actor: AuditActor): Promise<ShareRecord> {
    const dup = memoryShares.some(
      (s) =>
        s.entity_table === input.entity_table &&
        s.entity_id === input.entity_id &&
        s.shared_with === input.shared_with,
    )
    if (dup) throw new Error(DUPLICATE_SHARE)

    const created: ShareRecord = {
      share_id: `shr_${memoryShares.length + 1}_${Date.now()}`,
      entity_table: input.entity_table,
      entity_id: input.entity_id,
      shared_with: input.shared_with,
      shared_with_name: dummyPerson(input.shared_with)?.display_name ?? null,
      shared_by: actor.user_id,
      shared_by_name: dummyPerson(actor.user_id)?.display_name ?? null,
      expires_at: input.expires_at,
      created_at: new Date().toISOString(),
    }
    memoryShares.push(created)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] share ${input.entity_table}/${input.entity_id} by ${actor.role} — 메모리에만 남는다.`,
      )
    }
    return { ...created }
  },

  async revokeShare(shareId: string, actor: AuditActor): Promise<void> {
    const i = memoryShares.findIndex((s) => s.share_id === shareId)
    if (i < 0) throw new Error('Dummy shares: mutation affected 0 rows.')
    memoryShares.splice(i, 1)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] revoke share ${shareId} by ${actor.role} — 메모리에만 남는다.`)
    }
  },

  /**
   * 공유 대상 후보. live는 0028 company_people() — 같은 회사 사람의 이름 두 칸만 내준다.
   * **subtree로 자르지 않는다**(구매팀장이 영업팀장에게 공유하는 것이 검증 c다).
   */
  async searchSharePeople(query: string): Promise<SharePerson[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const viewer = memoryPerson(dummyViewer().user_id)
    return memoryPeople
      .filter(
        (p) =>
          p.user_id !== viewer.user_id &&
          !p.revoked_at &&
          p.status === 'active' &&
          p.role !== 'AIAgent' &&
          p.role !== 'Integration' &&
          (p.role === 'Chairman' ||
            p.role === 'GroupCFO' ||
            p.business_ids.some((b) => dummyHasBusiness(viewer, b))) &&
          (p.display_name.toLowerCase().includes(q) ||
            (p.display_name_en ?? '').toLowerCase().includes(q)),
      )
      .slice(0, 20)
      .map((p) => ({
        user_id: p.user_id,
        display_name: p.display_name,
        display_name_en: p.display_name_en,
      }))
  },

  /** CH-049. live에서는 0011의 user_invitations_admin이 Chairman만 통과시킨다. */
  async inviteUser(input: NewInvitation, actor: AuditActor): Promise<UserInvitation> {
    const email = input.email.trim().toLowerCase()
    const pending = memoryInvitations.some(
      (i) => i.email === email && !i.accepted_at && !i.revoked_at,
    )
    if (pending) throw new Error(DUPLICATE_INVITATION)

    const created: UserInvitation = {
      invitation_id: `inv_${String(memoryInvitations.length + 1).padStart(3, '0')}`,
      email,
      role: input.role,
      max_security_class: input.max_security_class,
      business_ids: input.business_ids,
      display_name: input.display_name,
      display_name_en: input.display_name_en,
      title_ko: input.title_ko,
      invited_by: actor.user_id,
      invited_at: new Date().toISOString(),
      reports_to: input.reports_to,
      team_id: input.team_id,
      joined_on: input.joined_on,
      language: input.language,
      // **서버가 정한다.** 0026의 user_invitations_set_approval 트리거가 role_rank로
      // 덮어쓰는 값이라, dummy도 폼이 보낸 값을 쓰지 않고 같은 기준으로 여기서 정한다 —
      // 두 곳이 다르면 화면이 dummy에서만 다른 말을 하게 된다.
      chairman_approval_required: needsChairmanApproval(input.role),
      // 회장이 직접 넣은 초대는 그 자리에서 결재된 것으로 남는다(0026 4-2절).
      chairman_approved_at: actor.role === 'Chairman' ? new Date().toISOString() : null,
      // live에서는 0011의 트리거가 계정 생성 시점에 채운다. dummy에는 그 순간이 없다.
      accepted_at: null,
      revoked_at: null,
    }
    memoryInvitations.push(created)

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] invite ${email} by ${actor.role} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
    return created
  },

  /**
   * CH-049 권한 회수. 0026이 승계 트리거를 붙인 뒤로 dummy에서도 계정 쪽이 실제로 움직인다 —
   * 회장 지시의 검증 f("영업팀장 회수 → 임원이 영업팀 자동 승계")를 화면에서 보려면
   * 그 트리거가 하는 일을 여기서도 해야 한다(0026 5절을 옮겨 적은 것이다).
   */
  async revokeUser(target: RevokeTarget, actor: AuditActor): Promise<void> {
    if (target.kind === 'invitation') {
      const found = memoryInvitations.find((i) => i.invitation_id === target.invitation_id)
      if (!found || found.accepted_at || found.revoked_at) {
        throw new Error('Dummy user_invitations: mutation affected 0 rows.')
      }
      found.revoked_at = new Date().toISOString()
    } else {
      const found = memoryPeople.find((p) => p.user_id === target.user_id)
      if (!found || found.revoked_at) {
        throw new Error('Dummy user_profiles: mutation affected 0 rows.')
      }
      found.revoked_at = new Date().toISOString()
      found.status = 'left'
      found.left_on = kstToday()

      // 승계(0026 5절). 올릴 상사가 없으면 아무것도 하지 않는다 —
      // 트리를 끊는 것보다 조직도에 경고로 남는 편이 낫다.
      const successor = found.reports_to
      if (successor) {
        for (const p of memoryPeople) {
          if (p.reports_to === found.user_id && p.user_id !== found.user_id) p.reports_to = successor
        }
        for (const t of memoryTeams) {
          if (t.lead_user_id === found.user_id) t.lead_user_id = successor
        }
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] revoke ${target.kind} by ${actor.role} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
  },

  async listChairmanProjects() {
    return memoryChairmanProjects.map((p) => ({ ...p }))
  },

  async getChairmanManifesto() {
    return { ...memoryManifesto }
  },

  async saveChairmanProject(input: ChairmanProjectInput, actor: AuditActor) {
    const { project_id, ...fields } = input
    const existing = project_id
      ? memoryChairmanProjects.find((p) => p.project_id === project_id)
      : undefined
    if (project_id && !existing) throw new Error('chairman_projects: 고칠 프로젝트가 없다.')
    const saved: ChairmanProject = existing
      ? Object.assign(existing, fields)
      : { project_id: crypto.randomUUID(), ...fields }
    if (!existing) memoryChairmanProjects.push(saved)

    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] save chairman project by ${actor.role} — 메모리에만 남는다.`)
    }
    return { ...saved }
  },

  async saveChairmanManifesto(body: string, actor: AuditActor) {
    memoryManifesto.body = body
    memoryManifesto.updated_at = new Date().toISOString()
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] save manifesto by ${actor.role} — 메모리에만 남는다.`)
    }
  },

  async getCheckin(date: IsoDate) {
    const found = memoryCheckins.get(date)
    return found ? { ...found } : null
  },

  /** saveInitiativeNote와 같은 upsert 모양이다 — checkin_date가 키고, 첫 저장은 'create'다. */
  async saveCheckin(input: ChairmanCheckinInput, actor: AuditActor) {
    const before = memoryCheckins.get(input.checkin_date)
    const saved: ChairmanCheckin = { ...input, updated_at: new Date().toISOString() }
    memoryCheckins.set(input.checkin_date, saved)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] save checkin(${before ? 'update' : 'create'}) by ${actor.role} — 메모리에만 남는다.`,
      )
    }
    return { ...saved }
  },

  /** Phase 3-C. dummy는 역할별 RLS를 흉내 내지 않는다 — 오늘 것이 있으면 오늘, 없으면 어제. */
  async getRecentCondition() {
    const today = kstToday()
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    for (const d of [today, yesterday]) {
      const found = memoryCheckins.get(d)
      if (found) return { condition: found.condition, checkin_date: d }
    }
    return null
  },

  /**
   * dummy에는 카카오 연결이 없다. '아직 연결 안 됨'이 dummy에서 볼 수 있는 유일한 상태이고,
   * 그 상태의 화면(= "카카오 연결" 버튼 하나)이 실제로 맞는지가 dummy에서 잴 수 있는 전부다.
   * 연결과 발송은 카카오 계정이 있어야 하므로 여기서 흉내 내지 않는다 — 흉내 낸 성공은
   * 검증이 아니라 위안이다.
   */
  async getKakaoConnection(): Promise<KakaoConnection | null> {
    return null
  },

  async listInitiatives() {
    return memoryInitiatives.map((i) => ({ ...i }))
  },

  async getInitiative(initiativeId: string) {
    const found = memoryInitiatives.find((i) => i.initiative_id === initiativeId)
    return found ? { ...found } : null
  },

  async saveInitiative(input: InitiativeInput, actor: AuditActor) {
    const { initiative_id, ...fields } = input
    const existing = initiative_id
      ? memoryInitiatives.find((i) => i.initiative_id === initiative_id)
      : undefined
    if (initiative_id && !existing) throw new Error('initiatives: 고칠 건이 없다.')

    // live(supabase.ts)와 같은 가드다. 바뀐 칸이 없으면 아무것도 안 한다 — 그냥 두면
    // updated_at이 실제 변경 없이 찍혀 staleness 계산이 방금 손댄 것처럼 리셋된다.
    if (existing && (Object.keys(fields) as (keyof typeof fields)[]).every((k) => existing[k] === fields[k])) {
      return { ...existing }
    }

    const now = new Date().toISOString()
    const saved: Initiative = existing
      ? Object.assign(existing, fields, { updated_at: now })
      : {
          initiative_id: `ini_${String(++initiativeSeq).padStart(3, '0')}`,
          ...fields,
          updated_at: now,
        }
    if (!existing) memoryInitiatives.push(saved)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] save initiative by ${actor.role} — 메모리에만 남는다.`)
    }
    return { ...saved }
  },

  async getInitiativeNote(initiativeId: string) {
    return memoryInitiativeNotes.get(initiativeId) ?? null
  },

  async saveInitiativeNote(initiativeId: string, note: string, actor: AuditActor) {
    memoryInitiativeNotes.set(initiativeId, note)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] save initiative note by ${actor.role} — 메모리에만 남는다.`)
    }
  },

  async listInitiativeKeymen() {
    return memoryInitiativeKeymen.map((k) => ({ ...k }))
  },

  async saveInitiativeKeyman(input: InitiativeKeymanInput, actor: AuditActor) {
    const { keyman_id, ...fields } = input
    const existing = keyman_id
      ? memoryInitiativeKeymen.find((k) => k.keyman_id === keyman_id)
      : undefined
    if (keyman_id && !existing) throw new Error('initiative_keymen: 고칠 키맨이 없다.')
    const saved: InitiativeKeyman = existing
      ? Object.assign(existing, fields)
      : { keyman_id: crypto.randomUUID(), ...fields }
    if (!existing) memoryInitiativeKeymen.push(saved)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] save initiative keyman by ${actor.role} — 메모리에만 남는다.`)
    }
    return { ...saved }
  },

  async removeInitiativeKeyman(keymanId: string, actor: AuditActor) {
    const idx = memoryInitiativeKeymen.findIndex((k) => k.keyman_id === keymanId)
    if (idx === -1) throw new Error('Dummy initiative_keymen: mutation affected 0 rows.')
    memoryInitiativeKeymen.splice(idx, 1)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] remove initiative keyman by ${actor.role} — 메모리에만 남는다.`)
    }
  },

  async listInitiativeDocs() {
    return memoryInitiativeDocs.map((d) => ({ ...d }))
  },

  async saveInitiativeDoc(input: InitiativeDocInput, actor: AuditActor) {
    const { doc_id, ...fields } = input
    const existing = doc_id
      ? memoryInitiativeDocs.find((d) => d.doc_id === doc_id)
      : undefined
    if (doc_id && !existing) throw new Error('initiative_docs: 고칠 문서가 없다.')
    const saved: InitiativeDoc = existing
      ? Object.assign(existing, fields)
      : { doc_id: crypto.randomUUID(), ...fields }
    if (!existing) memoryInitiativeDocs.push(saved)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] save initiative doc by ${actor.role} — 메모리에만 남는다.`)
    }
    return { ...saved }
  },

  async removeInitiativeDoc(docId: string, actor: AuditActor) {
    const idx = memoryInitiativeDocs.findIndex((d) => d.doc_id === docId)
    if (idx === -1) throw new Error('Dummy initiative_docs: mutation affected 0 rows.')
    memoryInitiativeDocs.splice(idx, 1)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] remove initiative doc by ${actor.role} — 메모리에만 남는다.`)
    }
  },

  async saveInitiativeLogo(initiativeId: string, file: LogoUpload, actor: AuditActor) {
    const target = memoryInitiatives.find((i) => i.initiative_id === initiativeId)
    if (!target) throw new Error('initiatives: 고칠 건이 없다.')
    const path = logoPath(initiativeId)
    const base64 = Buffer.from(file.bytes).toString('base64')
    memoryLogos.set(path, `data:${file.contentType};base64,${base64}`)
    target.logo_url = path
    target.updated_at = new Date().toISOString()
    // 이 파일의 다른 mutator처럼 NODE_ENV로 가둔다(운영 로그에 안 남게). 그 안에서 역할까지
    // 다시 본다 — dummy는 RLS가 없어 아무 역할이나 통과하는데, 0018에서는 Chairman·GroupCFO만
    // 통과한다. 역할 구분 없이 같은 문구만 찍으면 '이 조합은 실제로는 거부된다'는 신호가
    // 사라져 dummy로 권한을 검증하려는 사람(회장 확인 방식)이 속아 넘어간다.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        actor.role !== 'Chairman' && actor.role !== 'GroupCFO'
          ? `[dummy] save initiative logo by ${actor.role} — 실제로는 0018 정책이 막는다.`
          : `[dummy] save initiative logo by ${actor.role} — 메모리에만 남는다.`,
      )
    }
    return path
  },

  async removeInitiativeLogo(initiativeId: string, actor: AuditActor) {
    const target = memoryInitiatives.find((i) => i.initiative_id === initiativeId)
    if (!target) throw new Error('Dummy initiatives: mutation affected 0 rows.')
    memoryLogos.delete(logoPath(initiativeId))
    target.logo_url = null
    target.updated_at = new Date().toISOString()
    // saveInitiativeLogo와 같은 이유로 NODE_ENV와 역할 검사를 같이 둔다.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        actor.role !== 'Chairman' && actor.role !== 'GroupCFO'
          ? `[dummy] remove initiative logo by ${actor.role} — 실제로는 0018 정책이 막는다.`
          : `[dummy] remove initiative logo by ${actor.role} — 메모리에만 남는다.`,
      )
    }
  },

  async signInitiativeLogos(paths: string[]) {
    // dummy의 '서명 URL'은 data URL 그 자체다. 만료가 없다.
    const out: Record<string, string> = {}
    for (const p of paths) {
      const url = memoryLogos.get(p)
      if (url) out[p] = url
    }
    return out
  },

  async listEvents() {
    return memoryEvents.map((e) => ({ ...e }))
  },

  async saveEvent(input: EventInput, actor: AuditActor) {
    const { event_id, ...fields } = input
    const existing = event_id ? memoryEvents.find((e) => e.event_id === event_id) : undefined
    if (event_id && !existing) throw new Error('events: 고칠 일정이 없다.')
    const saved: ChairmanEvent = existing
      ? Object.assign(existing, fields)
      : { event_id: crypto.randomUUID(), ...fields }
    if (!existing) memoryEvents.push(saved)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] save event by ${actor.role} — 메모리에만 남는다.`)
    }
    return { ...saved }
  },

  async removeEvent(eventId: string, actor: AuditActor) {
    const idx = memoryEvents.findIndex((e) => e.event_id === eventId)
    if (idx === -1) throw new Error('Dummy events: mutation affected 0 rows.')
    memoryEvents.splice(idx, 1)
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[dummy] remove event by ${actor.role} — 메모리에만 남는다.`)
    }
  },

  /**
   * 0017 calendar_items 뷰를 메모리 넷을 합쳐 흉내 낸다.
   *
   * nextMilestones(strategy.ts)에는 done_at이 없다 — 0017 milestones 표의 실제 DB 칸이지
   * 이 파일이 이미 쓰는 시드 타입에는 완료 여부라는 개념 자체가 없다. 그래서 여기서는
   * 완료를 거르지 않는다(listNextMilestones도 마찬가지다). business_id의 'group' 센티널은
   * DB의 NULL과 같은 뜻이라 href·business_id 둘 다에서 null로 되돌린다.
   */
  async listCalendarItems(from: IsoDate, to: IsoDate) {
    // 겹침으로 거른다 — on_date <= to AND (ends_on ?? on_date) >= from. on_date만 보면
    // 9/25~10/02 출장이 10월 캘린더에서 사라진다(supabase.ts의 listCalendarItems와 같은 판정).
    // endsOn은 이벤트에만 있다 — 나머지 세 원천은 하루짜리라 생략하면 기존 판정과 같다.
    const within = (d: string | null, endsOn: string | null = null) =>
      d !== null && d <= to && (endsOn ?? d) >= from
    const items: CalendarItem[] = []

    for (const e of memoryEvents) {
      if (!within(e.starts_on, e.ends_on)) continue
      items.push({
        kind: 'event',
        source_id: e.event_id,
        title: e.title,
        on_date: e.starts_on,
        ends_on: e.ends_on,
        business_id: e.business_id,
        initiative_id: e.initiative_id,
        href: e.initiative_id ? `/initiatives/${e.initiative_id}` : '/calendar',
      })
    }
    for (const i of memoryInitiatives) {
      if (i.status !== 'Active' || !within(i.next_action_date) || !i.next_action.trim()) continue
      items.push({
        kind: 'next_action',
        source_id: i.initiative_id,
        title: `${i.title} — ${i.next_action}`,
        on_date: i.next_action_date!,
        ends_on: null,
        business_id: i.business_id,
        initiative_id: i.initiative_id,
        href: `/initiatives/${i.initiative_id}`,
      })
    }
    for (const m of nextMilestones) {
      if (!within(m.deadline)) continue
      const businessId = m.business_id === 'group' ? null : m.business_id
      items.push({
        kind: 'milestone',
        source_id: m.milestone_id,
        title: m.title,
        on_date: m.deadline,
        ends_on: null,
        business_id: businessId,
        initiative_id: null,
        href: businessId ? `/business/${businessId}` : '/calendar',
      })
    }
    for (const d of [...decisions, ...memoryDecisions]) {
      const status = memoryDecisionStatuses.get(d.decision_id) ?? d.status
      if (status !== 'Open' || !within(d.deadline)) continue
      items.push({
        kind: 'decision',
        source_id: d.decision_id,
        title: d.title,
        on_date: d.deadline,
        ends_on: null,
        business_id: d.business_id,
        initiative_id: null,
        href: '/approvals',
      })
    }
    // live(supabase.ts)의 listCalendarItems와 같은 순서다 — on_date, kind, source_id.
    // 월 그리드가 3개에서 접어 '+N'을 붙이므로, 정렬이 다르면 dummy와 live에서 보이는
    // 세 줄 자체가 달라진다.
    return items.sort(
      (a, b) =>
        a.on_date.localeCompare(b.on_date) ||
        a.kind.localeCompare(b.kind) ||
        a.source_id.localeCompare(b.source_id),
    )
  },

  async getUserSettings() {
    return { ...memorySettings }
  },

  async saveUserSettings(patch: Partial<UserSettings>) {
    Object.assign(memorySettings, patch)
  },

  /**
   * 알림함. 늘 0건이다 — 위 memoryNotifications의 주석이 그 이유다.
   * limit은 그대로 지킨다. 화면이 "20줄만 달라"고 했는데 전부 주면 그 계약이 dummy에서만
   * 다르게 동작하고, live에서 목록이 길어지는 날 처음 드러난다.
   */
  async listNotifications(limit: number): Promise<NotificationInbox> {
    const items = [...memoryNotifications]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, Math.max(0, limit))
    return { unread: memoryNotifications.filter((n) => n.read_at === null).length, items }
  },

  async markNotificationsRead(ids: string[]) {
    const now = new Date().toISOString()
    for (const n of memoryNotifications) {
      if (ids.includes(n.notification_id) && n.read_at === null) n.read_at = now
    }
  },

  async getMyProfile(): Promise<MyProfile | null> {
    const me = dummyViewer()
    const patch = memoryProfilePatch.get(me.user_id)
    return {
      user_id: me.user_id,
      role: me.role,
      display_name: patch?.display_name ?? me.display_name,
      display_name_en: patch ? patch.display_name_en : me.display_name_en,
      title_ko: (patch ? (patch.title_ko ?? '') : me.title_ko) || '',
      // 시드에는 생년월일이 없다. 회장 행만 0030이 넣는 값과 같은 날짜로 시작한다 —
      // 화면에서 '비어 있음'과 '값이 있음' 두 모양을 다 볼 수 있어야 한다.
      birth_date: patch ? patch.birth_date : me.role === 'Chairman' ? '1988-01-01' : null,
      language: patch?.language ?? me.language,
      max_security_class: me.max_security_class,
      created_at: me.created_at,
    }
  },

  async saveMyProfile(patch: MyProfilePatch): Promise<boolean> {
    // 0030 update_own_profile()과 같은 판정이다. 예외가 아니라 false를 돌려준다 —
    // 두 어댑터가 같은 실패를 다른 모양으로 말하면 화면이 한쪽만 다루게 된다.
    if (patch.display_name.trim() === '') return false
    memoryProfilePatch.set(dummyViewer().user_id, {
      ...patch,
      display_name: patch.display_name.trim(),
      display_name_en: patch.display_name_en?.trim() || null,
      title_ko: patch.title_ko?.trim() || null,
    })
    return true
  },

  async getBriefTimezone() {
    return { ...memoryBriefTimezone }
  },

  async saveBriefTimezone(tz: string | null) {
    memoryBriefTimezone.brief_tz = tz
  },

  async saveCurrentTimezone(tz: string) {
    memoryBriefTimezone.current_tz = tz
  },

  /**
   * 프로세스 메모리에만 쌓는다. 서버를 재시작하면 사라진다.
   * 조용히 '저장됐다'고 넘어가면 그 사실이 가려지므로 개발 중에는 매번 경고를 남긴다.
   */
  async recordDecisionAction(entry: DecisionAuditEntry) {
    const decision = [...decisions, ...memoryDecisions].find(
      (item) => item.decision_id === entry.decision_id,
    )
    const status = decision
      ? memoryDecisionStatuses.get(decision.decision_id) ?? decision.status
      : undefined

    memoryAudit.push({
      decision_id: entry.decision_id,
      action: AUDIT_ACTION[entry.action],
      occurred_at: new Date().toISOString(),
      actor_user_id: entry.actor_user_id ?? null,
      // dummy에는 user_profiles가 없다. live 어댑터가 프로필을 못 찾았을 때와 같은 말을 쓴다.
      actor_name: '미지정',
    })

    if (!decision || status !== 'Open') {
      throw new Error('Dummy decisions: mutation affected 0 rows.')
    }
    memoryDecisionStatuses.set(entry.decision_id, DECISION_STATUS[AUDIT_ACTION[entry.action]])

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] ${entry.action} ${entry.decision_id} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
  },
}
