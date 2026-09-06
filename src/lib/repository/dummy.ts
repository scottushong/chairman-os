import {
  aiNightOutputs,
  alerts,
  businessCoordinates,
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
import { dayKey } from '@/lib/format'
import { emptyStrategy } from '@/lib/strategy-fields'
import type { SearchHit } from '@/lib/search'
import type {
  Business,
  BusinessStrategy,
  Decision,
  DocumentRecord,
  NewInvitation,
  Task,
  UserAccount,
  UserInvitation,
} from '@/types'

import {
  DUPLICATE_BUSINESS_ID,
  DUPLICATE_INVITATION,
  type AuditActor,
  type ChairmanRepository,
  type DecisionAuditEntry,
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
const memoryInvitations: UserInvitation[] = []

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
  async listTasks(): Promise<Task[]> {
    return tasks.map((t) => ({ ...t, ...memoryTaskPatches.get(t.task_id) }))
  },
  async listDecisions() {
    return [...decisions, ...memoryDecisions]
  },
  async listAlerts() {
    return [...alerts]
  },
  async listAiNightOutputs() {
    return [...aiNightOutputs]
  },

  /** CH-042. live에서는 보안등급 판정이 documents_read(0002)에 있다. dummy에는 등급도 사람도 없다. */
  async listDocuments(): Promise<DocumentRecord[]> {
    return [...memoryDocuments]
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
    const current = memoryTaskPatches.get(taskId) ?? {}
    const next = { ...current, ...patch }
    // 상태가 바뀌면 대기일수 기준선도 같이 옮긴다. live 어댑터와 같은 규칙이어야 한다.
    if (patch.status !== undefined) next.blocked_since = dayKey()
    memoryTaskPatches.set(taskId, next)

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
   * CH-049. dummy에는 사용자 표가 없다. 빈 배열이 정답이다 —
   * 가짜 계정을 넣어 두면 화면이 dummy에서만 사람 목록을 보여 주고,
   * 그걸 보고 '권한이 이렇게 되어 있구나'로 읽는 사고가 난다.
   */
  async listUserAccounts(): Promise<UserAccount[]> {
    return []
  },

  async listUserInvitations(): Promise<UserInvitation[]> {
    return [...memoryInvitations]
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
      title_ko: input.title_ko,
      invited_at: new Date().toISOString(),
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

  /** CH-049. dummy에는 계정이 없으므로 초대 취소만 실제로 뭔가 한다. */
  async revokeUser(target: RevokeTarget, actor: AuditActor): Promise<void> {
    if (target.kind === 'invitation') {
      const found = memoryInvitations.find((i) => i.invitation_id === target.invitation_id)
      if (found && !found.accepted_at) found.revoked_at = new Date().toISOString()
    }

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] revoke ${target.kind} by ${actor.role} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
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
      // dummy에는 user_profiles가 없다. live 어댑터가 프로필을 못 찾았을 때와 같은 말을 쓴다.
      actor_name: '미지정',
    })
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dummy] ${entry.action} ${entry.decision_id} — 메모리에만 남는다. ` +
          '영구 기록은 live 모드의 Supabase audit_log뿐이다(CH-051).',
      )
    }
  },
}
