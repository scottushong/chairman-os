import { keywordReasons } from '@/lib/feedback/sensitive'
import { buildInstruction } from '@/lib/feedback/triage'
import { COST_AREAS, type AiFeedback, type AiFeedbackBundle, type ModuleGrant, type PersonAccess, type Team, type UserAccount } from '@/types'

import { dummyOwnAnswer } from './dummy-assistant'
import { DUMMY_UID } from './dummy-org'
import type { ChairmanRepository } from './types'

/**
 * 0069의 dummy 자리 — org_access_lookup · ai_feedback · ai_feedback_bundles를 메모리에서 흉내 낸다.
 * **DB가 막는 것을 여기서도 막는다**(0069 정책 · RPC를 옮겨 적은 것 — live에서는 한 줄도 돌지 않는다):
 *   · 조회: 대표 전원 · 본인 · 사용자 관리자는 맡은 회사의 사원 · 팀장(회수자 제외). 원가 4종 줄은 대표에게만.
 *   · 의견: 본인 답에만 · 같은 답 한 번 · 질문 · 답은 대화에서 복사 · 낱말 규칙은 켜기만 · 표는 대표만 · 취소는 표시만.
 *   · 정리 · 묶음: 대표(또는 AIAgent) · 제외 · 취소 줄 거부 · 민감 낱말 든 정리 거부.
 */

export interface DummyFeedbackDeps {
  viewer(): UserAccount
  people(): UserAccount[]
  teams(): Team[]
  grants(userId: string): ModuleGrant[]
  /** 0055 staff_admin_holds 거울. */
  staffAdmin(viewer: UserAccount, businessId: string): boolean
  businesses(): string[]
  audit(e: { entity_table: string; entity_id: string; note: string; after: Record<string, unknown> }): void
}

type Methods = Pick<
  ChairmanRepository,
  | 'orgAccessLookup'
  | 'submitAiFeedback'
  | 'listMyAiFeedback'
  | 'cancelAiFeedback'
  | 'listAiFeedback'
  | 'listAiFeedbackBundles'
  | 'setAiFeedbackStatus'
  | 'setAiFeedbackBundleStatus'
  | 'saveAiFeedbackTriage'
  | 'saveAiFeedbackBundle'
>

interface Store {
  feedback: AiFeedback[]
  bundles: AiFeedbackBundle[]
}
const g = globalThis as unknown as { __chairmanDummyFeedback?: Store }
const store: Store = (g.__chairmanDummyFeedback ??= { feedback: seed(), bundles: [] })

/**
 * 보완함 화면을 dummy에서 눈으로 보려는 시드 셋 — 새것 · AI 정리됨(예시) · AI 정리 제외. 대화 줄은 없다(message_id는 가짜).
 * **«AI 정리됨»의 요약 · 지시문은 모델 출력이 아니라 손으로 쓴 예시다**(model 'dummy-seed') — dummy는 AI를 부르지 않는다.
 */
function seed(): AiFeedback[] {
  const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
  const base = { business_id: 'biz_dy', cancelled_at: null, bundle_id: null, triaged_at: null } as const
  const draft = {
    summary: '대표 화면의 AI 어시스턴트가 «사원의 권한은?»에 이름 · id만 답하고 끝났다 — 권한 · 팀 · 상사 칸과 바꾸는 곳이 없다.',
    expected: '«(사원) 권한은?»을 물으면 팀 · 직속 상사 · 회사 범위 · 모듈 권한 표와 «바꾸려면: 사용자 화면 → 조직도 → 그 사람» 링크가 한 번에 보인다.',
    situation: ['실사용 문제(2026-10-12, 대표 화면): «(사원) 권한은?» → «이름과 id만 조회되고 권한은 볼 수 없습니다»로 끝남', 'org_lookup 도구가 이름 · id만 돌려준다'],
    decisions: ['권한 · 조직 조회 도구(읽기만)를 더한다 — 대표 전원 · 그 밖 본인만', '답할 수 없을 때도 어디서 · 대신을 붙인다'],
    steps: ['현황 표: 지금 도구 목록 · 조직 도구가 돌려주는 칸', '조회 도구 + 프롬프트 보강 — check:ask 시나리오', '검사 하나씩(typecheck → lint → check 전부 → build) · 스크린샷'],
    final_report: '고친 AI 답 예시(대표 · 사원)를 실제 출력 그대로',
  }
  return [
    {
      ...base,
      feedback_id: '00000000-0000-4000-8000-0000000f0001',
      created_at: at(30),
      author_id: DUMMY_UID.chair,
      author_name: '홍석현',
      author_role: 'Chairman',
      path: '/settings/users',
      message_id: -1,
      question: '김병훈 사원의 권한은?',
      answer: '김병훈 사원은 이름과 id만 조회되고 권한은 볼 수 없습니다.',
      body: '권한을 못 보면 어디서 보는지라도 알려 줘야 한다. 링크가 없다.',
      ai_excluded: false,
      excluded_reasons: [],
      status: 'triaged',
      triage: { summary: draft.summary, expected: draft.expected, instruction: buildInstruction(draft, '보완 의견 · /settings/users'), model: 'dummy-seed(손으로 쓴 예시)', by: 'Chairman' },
      triaged_at: at(29),
    },
    {
      ...base,
      feedback_id: '00000000-0000-4000-8000-0000000f0002',
      created_at: at(5),
      author_id: DUMMY_UID.supportStaff,
      author_name: '경영지원 사원',
      author_role: 'Member',
      path: '/approvals',
      message_id: -2,
      question: '지난주 올린 지출 결재 어디까지 갔어?',
      answer: '지출 결재 1건이 대표 결재 대기입니다.',
      body: '누가 언제 승인했는지 순서가 보였으면 좋겠습니다.',
      ai_excluded: false,
      excluded_reasons: [],
      status: 'new',
      triage: null,
    },
    {
      ...base,
      feedback_id: '00000000-0000-4000-8000-0000000f0003',
      created_at: at(2),
      author_id: DUMMY_UID.buyStaff,
      author_name: '구매 직원',
      author_role: 'Member',
      path: '/purchasing/biz_dy',
      message_id: -3,
      question: '이 원료 단가 얼마야?',
      answer: '원가 관련 숫자는 이 대화창에서 보여 드리지 않습니다.',
      body: '단가 3,200원짜리 원료 비교가 안 됩니다.',
      ai_excluded: true,
      excluded_reasons: ['cost_number'],
      status: 'new',
      triage: null,
    },
  ]
}

const COST_PREFIX = new RegExp(`^/(${COST_AREAS.join('|')})(/|$)`)
const nospace = (s: string) => s.replace(/\s/g, '').toLowerCase()

function triageSensitive(t: unknown): boolean {
  return keywordReasons(JSON.stringify(t)).length > 0
}

export function dummyFeedback(d: DummyFeedbackDeps): Methods {
  const chairSession = () => d.viewer().role === 'Chairman'
  const agentOrChair = () => ['Chairman', 'AIAgent'].includes(d.viewer().role)

  function canView(target: UserAccount): boolean {
    const me = d.viewer()
    if (me.role === 'Chairman' || target.user_id === me.user_id) return true
    if (target.revoked_at) return false
    if (!['TeamLead', 'Member'].includes(target.role)) return false
    return target.business_ids.some((b) => d.staffAdmin(me, b))
  }

  function access(p: UserAccount): PersonAccess {
    const me = d.viewer()
    const chair = me.role === 'Chairman'
    const self = p.user_id === me.user_id
    const held = (b: string) => chair || self || d.staffAdmin(me, b)
    const bizIds = new Set(d.businesses())
    const team = d.teams().find((t) => t.team_id === p.team_id) ?? null
    const boss = d.people().find((x) => x.user_id === p.reports_to) ?? null
    return {
      user_id: p.user_id,
      name: p.display_name,
      title: p.title_ko,
      role: p.role,
      status: p.status,
      revoked: !!p.revoked_at,
      self,
      max_security_class: chair || self ? p.max_security_class : null,
      team: team ? { team_id: team.team_id, name: team.name, business_id: team.business_id } : null,
      reports_to: boss
        ? boss.role === 'Chairman' && !chair
          ? { top: true }
          : { user_id: boss.user_id, name: boss.display_name, role: boss.role, title: boss.title_ko }
        : null,
      businesses: p.role === 'Chairman' || p.role === 'GroupCFO' ? ['*'] : p.business_ids.filter(held).sort(),
      modules: d
        .grants(p.user_id)
        .filter((m) => chair || !COST_PREFIX.test(m.module))
        .filter((m) => {
          const tail = m.module.replace(/^.*\//, '')
          return !bizIds.has(tail) || held(tail)
        })
        .map((m) => ({ ...m }))
        .sort((a, b) => a.module.localeCompare(b.module)),
      cost_hidden: !chair,
    }
  }

  return {
    async orgAccessLookup(query) {
      const me = d.viewer()
      const q = query.trim()
      if (!q || q.length > 60) return []
      const uuid = /^[0-9a-f-]{36}$/i.test(q) ? q : ['me', '나', '내', '본인', '저'].includes(q.toLowerCase()) ? me.user_id : null
      const teams = d.teams()
      const hits = d.people().filter((p) => {
        if (!canView(p)) return false
        if (uuid) return p.user_id === uuid
        const team = teams.find((t) => t.team_id === p.team_id)
        const qq = nospace(q)
        return (
          nospace(p.display_name).includes(qq) ||
          (p.display_name_en ? nospace(p.display_name_en).includes(qq) : false) ||
          (team ? nospace(team.name) === nospace(q.replace(/\s*팀$/, '')) || nospace(team.name) + '팀' === qq : false)
        )
      })
      hits.sort((a, b) => Number(b.user_id === me.user_id) - Number(a.user_id === me.user_id) || a.display_name.localeCompare(b.display_name))
      return hits.slice(0, 8).map(access)
    },

    async submitAiFeedback(input) {
      const me = d.viewer()
      if (!['Chairman', 'GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member'].includes(me.role)) throw new Error('ai_feedback_denied')
      const body = input.body.trim()
      if (body.length < 2 || body.length > 2000) throw new Error('ai_feedback_body')
      if (!/^\/(?!\/)/.test(input.path) || input.path.length > 300) throw new Error('ai_feedback_path')
      const own = dummyOwnAnswer(me.user_id, input.message_id)
      if (!own) throw new Error('ai_feedback_message')
      if (store.feedback.some((f) => f.author_id === me.user_id && f.message_id === input.message_id)) throw new Error('ai_feedback_duplicate')
      const since = Date.now() - 86_400_000
      if (store.feedback.filter((f) => f.author_id === me.user_id && Date.parse(f.created_at) > since).length >= 30) throw new Error('ai_feedback_rate')
      const reasons = [...new Set([...input.excluded_reasons, ...keywordReasons(body), ...keywordReasons(own.question), ...keywordReasons(own.answer)])].sort()
      const biz = input.business_id && (me.role === 'Chairman' || me.role === 'GroupCFO' || me.business_ids.includes(input.business_id)) ? input.business_id : null
      const row: AiFeedback = {
        feedback_id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        author_id: me.user_id,
        author_name: me.display_name,
        author_role: me.role,
        business_id: biz,
        path: input.path,
        message_id: input.message_id,
        question: own.question,
        answer: own.answer,
        body,
        ai_excluded: input.ai_excluded || reasons.length > 0,
        excluded_reasons: reasons,
        cancelled_at: null,
        status: 'new',
        triage: null,
        triaged_at: null,
        bundle_id: null,
      }
      store.feedback.unshift(row)
      d.audit({ entity_table: 'ai_feedback', entity_id: row.feedback_id, note: 'AI 보완 의견 남김(0069)', after: { path: row.path, ai_excluded: row.ai_excluded } })
      return row.feedback_id
    },

    async listMyAiFeedback() {
      const me = d.viewer()
      return store.feedback
        .filter((f) => f.author_id === me.user_id)
        .map(({ feedback_id, created_at, path, message_id, question, answer, body, cancelled_at }) => ({
          feedback_id,
          created_at,
          path,
          message_id,
          question,
          answer,
          body,
          cancelled_at,
        }))
    },

    async cancelAiFeedback(id) {
      const me = d.viewer()
      const row = store.feedback.find((f) => f.feedback_id === id && f.author_id === me.user_id && !f.cancelled_at)
      if (!row) return false
      row.cancelled_at = new Date().toISOString()
      d.audit({ entity_table: 'ai_feedback', entity_id: id, note: 'AI 보완 의견 취소(0069)', after: { cancelled_at: row.cancelled_at } })
      return true
    },

    async listAiFeedback() {
      const role = d.viewer().role
      if (role === 'Chairman') return store.feedback.map((f) => structuredClone(f))
      if (role === 'AIAgent') return store.feedback.filter((f) => !f.ai_excluded && !f.cancelled_at).map((f) => structuredClone(f))
      return []
    },

    async listAiFeedbackBundles() {
      return chairSession() ? store.bundles.map((b) => structuredClone(b)) : []
    },

    async setAiFeedbackStatus(id, status) {
      if (!chairSession()) throw new Error('ai_feedback_denied')
      const row = store.feedback.find((f) => f.feedback_id === id)
      if (!row) return false
      if (row.status !== status) {
        d.audit({ entity_table: 'ai_feedback', entity_id: id, note: 'AI 보완 의견 상태(0069)', after: { status } })
        row.status = status
      }
      return true
    },

    async setAiFeedbackBundleStatus(id, status) {
      if (!chairSession()) throw new Error('ai_feedback_denied')
      const b = store.bundles.find((x) => x.bundle_id === id)
      if (!b) return false
      b.status = status
      if (status !== 'new') for (const f of store.feedback) if (f.bundle_id === id) f.status = status
      d.audit({ entity_table: 'ai_feedback_bundles', entity_id: id, note: 'AI 보완 묶음 상태(0069)', after: { status } })
      return true
    },

    async saveAiFeedbackTriage(id, triage) {
      if (!agentOrChair()) throw new Error('ai_feedback_denied')
      const row = store.feedback.find((f) => f.feedback_id === id)
      if (!row) return false
      if (row.ai_excluded || row.cancelled_at) throw new Error('ai_feedback_excluded')
      if (triageSensitive(triage)) throw new Error('ai_feedback_triage_sensitive')
      row.triage = { ...triage, by: d.viewer().role }
      row.triaged_at = new Date().toISOString()
      if (row.status === 'new') row.status = 'triaged'
      d.audit({ entity_table: 'ai_feedback', entity_id: id, note: 'AI 보완 의견 AI 정리(0069)', after: { model: triage.model } })
      return true
    },

    async saveAiFeedbackBundle(ids, title, triage) {
      if (!agentOrChair()) throw new Error('ai_feedback_denied')
      const uniq = [...new Set(ids)]
      if (uniq.length < 2 || uniq.length > 30) throw new Error('ai_feedback_bundle_size')
      if (triageSensitive({ triage, title })) throw new Error('ai_feedback_triage_sensitive')
      const rows = store.feedback.filter((f) => uniq.includes(f.feedback_id) && !f.ai_excluded && !f.cancelled_at && !f.bundle_id)
      if (rows.length !== uniq.length) throw new Error('ai_feedback_excluded')
      const screens = new Set(rows.map((f) => f.path.split('?')[0]))
      if (screens.size !== 1) throw new Error('ai_feedback_bundle_screen')
      const bundle: AiFeedbackBundle = {
        bundle_id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        title: title.trim(),
        screen: [...screens][0],
        feedback_ids: uniq,
        triage: { ...triage, by: d.viewer().role },
        status: 'new',
      }
      store.bundles.unshift(bundle)
      for (const f of rows) f.bundle_id = bundle.bundle_id
      d.audit({ entity_table: 'ai_feedback_bundles', entity_id: bundle.bundle_id, note: 'AI 보완 의견 묶음(0069)', after: { feedback_ids: uniq } })
      return bundle.bundle_id
    },
  }
}
