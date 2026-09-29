import type { SupabaseClient } from '@supabase/supabase-js'

import type { AiAction, AiChat, AiChatMessage, AiSource, AiUsageDay } from '@/types'

import type { ChairmanRepository } from './types'

/**
 * Phase 11 AI 어시스턴트(0046)의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 *
 * **0046이 없는 DB를 견딘다** — master push가 production 앱을 마이그레이션보다 먼저 내보낸다.
 *   · 표가 없다(PGRST205 · 42P01): 제안 목록은 빈 목록, 사용량도 빈 목록.
 *   · 칸이 없다(42703 · PGRST204): 대화 · 메시지는 0046의 칸(context_path · tokens · actions)을 빼고
 *     다시 읽고 쓴다 — 어시스턴트가 «제안 없이 묻기만» 되는 상태로 물러선다.
 * 제안 만들기는 견디지 않는다: 표 없이 확인 카드를 띄우면 누를 수 없는 버튼이 된다.
 */

const MISSING_TABLE = new Set(['PGRST205', '42P01'])
const MISSING_COLUMN = new Set(['42703', 'PGRST204'])

type Err = { code?: string; message: string } | null

function fail(table: string, error: NonNullable<Err>): never {
  throw new Error(`Supabase ${table} ${error.code ?? '?'}: ${error.message}`)
}

const ACTION_COLUMNS =
  'action_id,chat_id,kind,payload,preview,target_table,target_id,business_id,status,result,expires_at,created_at'

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

function toMessage(r: Record<string, unknown>): AiChatMessage {
  return {
    id: Number(r.id),
    chat_id: String(r.chat_id),
    role: r.role as AiChatMessage['role'],
    content: String(r.content ?? ''),
    sources: (Array.isArray(r.sources) ? r.sources : []) as AiSource[],
    created_at: String(r.created_at),
    tokens: Number(r.tokens ?? 0),
    action_ids: Array.isArray(r.actions) ? (r.actions as unknown[]).map(String) : [],
  }
}

/** KST 날짜. 회장이 «오늘 비용»이라고 읽는 하루는 서울의 하루다. */
function kstDay(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10)
}

export function assistantMethods(sb: SupabaseClient): Methods {
  return {
    async listAiChats(): Promise<AiChat[]> {
      const q = (cols: string) => sb.from('ai_chats').select(cols).order('created_at', { ascending: false }).limit(50)
      let { data, error } = await q('chat_id,title,created_at,context_path')
      if (error && MISSING_COLUMN.has(error.code ?? '')) ({ data, error } = await q('chat_id,title,created_at'))
      if (error) fail('ai_chats', error)
      return (data ?? []) as unknown as AiChat[]
    },

    async listAiChatMessages(chatId: string): Promise<AiChatMessage[]> {
      const q = (cols: string) => sb.from('ai_chat_messages').select(cols).eq('chat_id', chatId).order('id')
      let { data, error } = await q('id,chat_id,role,content,sources,created_at,tokens,actions')
      if (error && MISSING_COLUMN.has(error.code ?? '')) ({ data, error } = await q('id,chat_id,role,content,sources,created_at'))
      if (error) fail('ai_chat_messages', error)
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(toMessage)
    },

    async createAiChat(title, actor, contextPath) {
      void actor
      const row: Record<string, unknown> = { title }
      if (contextPath) row.context_path = contextPath
      let { data, error } = await sb.from('ai_chats').insert(row).select('chat_id').single()
      if (error && MISSING_COLUMN.has(error.code ?? '') && contextPath) {
        ;({ data, error } = await sb.from('ai_chats').insert({ title }).select('chat_id').single())
      }
      if (error) fail('ai_chats', error)
      return String((data as { chat_id: string }).chat_id)
    },

    async appendAiMessage(chatId, role, content, sources, actor, extra) {
      void actor
      const base = { chat_id: chatId, role, content, sources }
      const withExtra = extra ? { ...base, tokens: extra.tokens ?? 0, actions: extra.action_ids ?? [] } : base
      let { error } = await sb.from('ai_chat_messages').insert(withExtra)
      if (error && extra && MISSING_COLUMN.has(error.code ?? '')) ({ error } = await sb.from('ai_chat_messages').insert(base))
      if (error) fail('ai_chat_messages', error)
    },

    async createAiAction(input, actor) {
      void actor // 주인은 DB가 auth.uid()로 적는다(0046 ai_actions_stamp).
      const { data, error } = await sb
        .from('ai_actions')
        .insert({
          chat_id: input.chat_id,
          kind: input.kind,
          payload: input.payload,
          preview: input.preview,
          target_table: input.target_table ?? null,
          target_id: input.target_id ?? null,
          business_id: input.business_id ?? null,
        })
        .select(ACTION_COLUMNS)
        .single()
      if (error) fail('ai_actions', error)
      return data as unknown as AiAction
    },

    async listAiActions(chatId) {
      const { data, error } = await sb.from('ai_actions').select(ACTION_COLUMNS).eq('chat_id', chatId).order('created_at')
      if (error) {
        if (MISSING_TABLE.has(error.code ?? '')) return []
        fail('ai_actions', error)
      }
      return (data ?? []) as unknown as AiAction[]
    },

    async decideAiAction(actionId, confirm) {
      const { data, error } = await sb.rpc('ai_action_decide', { p_action: actionId, p_confirm: confirm })
      if (error) fail('ai_action_decide', error)
      return data ? (data as AiAction) : null
    },

    async finishAiAction(actionId, ok, result) {
      const { error } = await sb.rpc('ai_action_finish', { p_action: actionId, p_ok: ok, p_result: result })
      if (error) fail('ai_action_finish', error)
    },

    async listAiUsageDays(days) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      const { data, error } = await sb
        .from('ai_usage_log')
        .select('created_at,feature,input_tokens,output_tokens,estimated_cost_usd')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000)
      if (error) {
        if (MISSING_TABLE.has(error.code ?? '')) return []
        fail('ai_usage_log', error)
      }
      return groupUsage((data ?? []) as UsageRow[])
    },
  }
}

export interface UsageRow {
  created_at: string
  feature: string
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number | string
}

/** 날짜 × 기능으로 묶는다. 합은 코드가 낸다 — dummy와 live가 같은 함수를 쓴다. */
export function groupUsage(rows: UsageRow[]): AiUsageDay[] {
  const map = new Map<string, AiUsageDay>()
  for (const r of rows) {
    const day = kstDay(r.created_at)
    const key = `${day}|${r.feature}`
    const cur = map.get(key) ?? { day, feature: r.feature, calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 }
    cur.calls += 1
    cur.input_tokens += Number(r.input_tokens) || 0
    cur.output_tokens += Number(r.output_tokens) || 0
    // 달러를 1e-6 단위 정수로 더해 부동소수 찌꺼기를 막는다(numeric(12,6)과 같은 자리).
    cur.cost_usd = Math.round((cur.cost_usd + (Number(r.estimated_cost_usd) || 0)) * 1e6) / 1e6
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => b.day.localeCompare(a.day) || b.cost_usd - a.cost_usd)
}
