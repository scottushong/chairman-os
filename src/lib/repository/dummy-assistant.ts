import type { AiAction, AiChat, AiChatMessage, AiUsageDay } from '@/types'

import { dummyUsageRows } from './dummy-attachments'
import { dummyViewer } from './dummy-org'
import { groupUsage } from './supabase-assistant'
import type { AuditActor, ChairmanRepository } from './types'

/**
 * Phase 11 AI 어시스턴트의 dummy 자리 — 0041 대화 · 0046 제안 · 0045 사용량을 메모리에서 흉내 낸다.
 *
 * **DB가 막는 것을 여기서도 막는다**(dummy-attachments.ts와 같은 원칙):
 *   · 대화 · 제안은 본인 것만 보인다(회장도 남의 것은 못 본다).
 *   · 제안은 넣으면 늘 pending · 15분. 확인은 주인 · pending · 만료 전일 때 **한 번만** 넘어간다.
 *   · 확인은 감사에 «AI 제안, <역할> 확인»으로 남는다 — 대상이 이니셔티브면 그 상세의 기록 줄에 뜬다.
 *   · 사용량은 회장만 읽는다.
 * 저장소를 globalThis에 둔다 — dev 서버가 모듈을 다시 읽어도 대화가 사라지지 않게.
 */

interface Store {
  chats: (AiChat & { user_id: string })[]
  messages: (AiChatMessage & { user_id: string })[]
  actions: (AiAction & { user_id: string })[]
  nextMessage: number
}

const g = globalThis as unknown as { __chairmanDummyAssistant?: Store }
const store: Store = (g.__chairmanDummyAssistant ??= { chats: [], messages: [], actions: [], nextMessage: 1 })

const TTL_MS = 15 * 60_000
const NO_PROPOSAL = new Set(['AIAgent', 'Integration', 'ExternalExpert', 'Vendor'])

const ROLE_KO: Record<string, string> = {
  Chairman: '회장', GroupCFO: '그룹 CFO', BusinessCEO: '대표이사', Executive: '임원', TeamLead: '팀장', Member: '직원',
}

/** 확인 감사 한 줄을 dummy.ts의 이력 저장소로 보낸다(그 저장소가 상세 화면의 기록 줄이다). */
export type AssistantAuditSink = (entry: {
  entity_table: string
  entity_id: string
  actor: AuditActor
  after: Record<string, unknown>
  note: string
}) => void

type Methods = Pick<
  ChairmanRepository,
  | 'listAiChats'
  | 'listAiChatMessages'
  | 'createAiChat'
  | 'appendAiMessage'
  | 'createAiAction'
  | 'listAiActions'
  | 'decideAiAction'
  | 'finishAiAction'
  | 'listAiUsageDays'
>

const strip = <T extends { user_id: string }>({ user_id: _u, ...rest }: T): Omit<T, 'user_id'> => (void _u, rest)

export function dummyAssistant(audit: AssistantAuditSink): Methods {
  return {
    async listAiChats() {
      const me = dummyViewer().user_id
      return store.chats.filter((c) => c.user_id === me).map(strip).reverse()
    },

    async listAiChatMessages(chatId) {
      const me = dummyViewer().user_id
      return store.messages.filter((m) => m.chat_id === chatId && m.user_id === me).map(strip)
    },

    async createAiChat(title, actor, contextPath) {
      const id = crypto.randomUUID()
      store.chats.push({ chat_id: id, title, created_at: new Date().toISOString(), context_path: contextPath ?? null, user_id: actor.user_id })
      return id
    },

    async appendAiMessage(chatId, role, content, sources, actor, extra) {
      if (!store.chats.some((c) => c.chat_id === chatId && c.user_id === actor.user_id)) {
        throw new Error('row-level security: ai_chat_messages')
      }
      if (sources.some((s) => !/^\/($|[^/\\])/.test(s.href))) throw new Error('ai_source_href')
      store.messages.push({
        id: store.nextMessage++,
        chat_id: chatId,
        role,
        content,
        sources,
        created_at: new Date().toISOString(),
        tokens: extra?.tokens ?? 0,
        action_ids: extra?.action_ids ?? [],
        user_id: actor.user_id,
      })
    },

    async createAiAction(input, actor) {
      const viewer = dummyViewer()
      if (viewer.revoked_at || NO_PROPOSAL.has(viewer.role)) throw new Error('row-level security: ai_actions')
      if (input.chat_id && !store.chats.some((c) => c.chat_id === input.chat_id && c.user_id === actor.user_id)) {
        throw new Error('row-level security: ai_actions')
      }
      const now = Date.now()
      const row: AiAction & { user_id: string } = {
        action_id: crypto.randomUUID(),
        chat_id: input.chat_id,
        kind: input.kind,
        payload: input.payload,
        preview: input.preview,
        target_table: input.target_table ?? null,
        target_id: input.target_id ?? null,
        business_id: input.business_id ?? null,
        // 0046 ai_actions_stamp와 같다 — 상태 · 만료는 넣는 쪽이 못 고른다.
        status: 'pending',
        result: null,
        expires_at: new Date(now + TTL_MS).toISOString(),
        created_at: new Date(now).toISOString(),
        user_id: viewer.user_id,
      }
      store.actions.push(row)
      return strip(row)
    },

    async listAiActions(chatId) {
      const me = dummyViewer().user_id
      return store.actions.filter((a) => a.chat_id === chatId && a.user_id === me).map(strip)
    },

    async decideAiAction(actionId, confirm) {
      const viewer = dummyViewer()
      if (viewer.revoked_at || NO_PROPOSAL.has(viewer.role)) throw new Error('ai_action_denied')
      // 0046 ai_action_decide의 update 조건 그대로: 주인 · pending · 만료 전.
      const row = store.actions.find(
        (a) => a.action_id === actionId && a.user_id === viewer.user_id && a.status === 'pending' && Date.parse(a.expires_at) > Date.now(),
      )
      if (!row) return null
      row.status = confirm ? 'confirmed' : 'cancelled'
      if (confirm) {
        audit({
          entity_table: row.target_table ?? 'ai_actions',
          entity_id: row.target_id ?? row.action_id,
          actor: { user_id: viewer.user_id, role: viewer.role },
          after: { ai_action: row.action_id, kind: row.kind, title: row.preview.title },
          note: `AI 제안, ${ROLE_KO[viewer.role] ?? viewer.role} 확인`,
        })
      }
      return strip(row)
    },

    async finishAiAction(actionId, ok, result) {
      const me = dummyViewer().user_id
      const row = store.actions.find((a) => a.action_id === actionId && a.user_id === me && a.status === 'confirmed')
      if (!row) return
      row.status = ok ? 'done' : 'failed'
      row.result = result.slice(0, 500)
    },

    async listAiUsageDays(days): Promise<AiUsageDay[]> {
      if (dummyViewer().role !== 'Chairman') return []
      const floor = Date.now() - days * 86_400_000
      return groupUsage(dummyUsageRows().filter((r) => Date.parse(r.created_at) >= floor))
    },
  }
}
