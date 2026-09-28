import type {
  AiChat,
  AiChatMessage,
  AiSource,
  ChatChannel,
  ChatMessage,
  ChatMessageInput,
  ChatRead,
  UserAccount,
} from '@/types'

import { DUMMY_PEOPLE, DUMMY_TEAMS, DUMMY_UID, dummyHasBusiness, dummyPerson, dummyViewer } from './dummy-org'
import type { AuditActor } from './types'

/**
 * 0041 메신저 · AI 대화의 dummy 자리. can_read_channel()과 같은 판정을 한다 —
 * 회사 = 그 회사 사람 · 팀 = 팀장 또는 팀원이 내 subtree(자기 포함) · 1:1 = 두 사람.
 * dummy에는 Realtime이 없다 — 보내면 화면이 다시 그린다(router.refresh).
 */

interface ChannelRow {
  channel_id: string
  kind: ChatChannel['kind']
  business_id: string | null
  team_id: string | null
  dm_a: string | null
  dm_b: string | null
}

const channels: ChannelRow[] = []
const messages: Omit<ChatMessage, 'sender_name' | 'document_title'>[] = []
const reads: { channel_id: string; user_id: string; last_read_at: string }[] = []
let nextMessage = 1

function subtreeOf(rootId: string): Set<string> {
  const out = new Set<string>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const p of DUMMY_PEOPLE) {
      if (p.reports_to && out.has(p.reports_to) && !out.has(p.user_id)) {
        out.add(p.user_id)
        grew = true
      }
    }
  }
  return out
}

function canRead(c: ChannelRow, viewer: UserAccount): boolean {
  if (c.kind === 'company') return dummyHasBusiness(viewer, c.business_id)
  if (c.kind === 'team') {
    if (!dummyHasBusiness(viewer, c.business_id)) return false
    const team = DUMMY_TEAMS.find((t) => t.team_id === c.team_id)
    if (team?.lead_user_id === viewer.user_id) return true
    const mine = subtreeOf(viewer.user_id)
    return DUMMY_PEOPLE.some((p) => p.team_id === c.team_id && !p.revoked_at && mine.has(p.user_id))
  }
  return viewer.user_id === c.dm_a || viewer.user_id === c.dm_b
}

/** ensure_chat_channels()의 거울. */
function ensure(viewer: UserAccount) {
  const bizIds = new Set<string>([
    ...DUMMY_TEAMS.map((t) => t.business_id),
    ...DUMMY_PEOPLE.flatMap((p) => p.business_ids),
  ])
  for (const b of bizIds) {
    if (dummyHasBusiness(viewer, b) && !channels.some((c) => c.kind === 'company' && c.business_id === b)) {
      channels.push({ channel_id: crypto.randomUUID(), kind: 'company', business_id: b, team_id: null, dm_a: null, dm_b: null })
    }
  }
  for (const t of DUMMY_TEAMS) {
    const row: ChannelRow = { channel_id: '', kind: 'team', business_id: t.business_id, team_id: t.team_id, dm_a: null, dm_b: null }
    if (canRead(row, viewer) && !channels.some((c) => c.kind === 'team' && c.team_id === t.team_id)) {
      channels.push({ ...row, channel_id: crypto.randomUUID() })
    }
  }
}

const nameOf = (id: string) => dummyPerson(id)?.display_name ?? '미지정'

export async function listChatChannels(businessNames: Map<string, string>): Promise<ChatChannel[]> {
  const viewer = dummyViewer()
  ensure(viewer)
  // 처음 여는 dummy에 대화가 하나도 없으면 화면이 빈다 — 회사 방에 인사 한 줄을 심는다.
  if (messages.length === 0) {
    const first = channels.find((c) => c.kind === 'company' && c.business_id === 'biz_dy')
    if (first) {
      messages.push({
        message_id: nextMessage++,
        channel_id: first.channel_id,
        sender_id: DUMMY_UID.dyCeo,
        body: '4분기 안전 점검 일정 공유합니다. 10/14 오전입니다.',
        link: '/groupware',
        document_id: null,
        created_at: '2026-09-27T09:10:00+09:00',
      })
    }
  }
  return channels
    .filter((c) => canRead(c, viewer))
    .map((c) => {
      const other = c.kind === 'dm' ? (c.dm_a === viewer.user_id ? c.dm_b : c.dm_a) : null
      const team = c.team_id ? DUMMY_TEAMS.find((t) => t.team_id === c.team_id) : undefined
      const last = messages.filter((m) => m.channel_id === c.channel_id).at(-1)
      return {
        channel_id: c.channel_id,
        kind: c.kind,
        business_id: c.business_id,
        team_id: c.team_id,
        other_user_id: other,
        title:
          c.kind === 'company'
            ? `${businessNames.get(c.business_id ?? '') ?? c.business_id} 전체`
            : c.kind === 'team'
              ? `${businessNames.get(c.business_id ?? '') ?? ''} · ${team?.name ?? c.team_id}`
              : nameOf(other ?? ''),
        my_last_read_at: reads.find((r) => r.channel_id === c.channel_id && r.user_id === viewer.user_id)?.last_read_at ?? null,
        last_message_at: last?.created_at ?? null,
      }
    })
}

export async function listChatMessages(
  channelId: string,
  documentTitle: (id: string) => string | null,
): Promise<ChatMessage[]> {
  const c = channels.find((x) => x.channel_id === channelId)
  if (!c || !canRead(c, dummyViewer())) return []
  return messages
    .filter((m) => m.channel_id === channelId)
    .slice(-200)
    .map((m) => ({
      ...m,
      sender_name: nameOf(m.sender_id),
      document_title: m.document_id ? documentTitle(m.document_id) : null,
    }))
}

export async function sendChatMessage(
  input: ChatMessageInput,
  actor: AuditActor,
  canSeeDocument: (id: string) => boolean,
): Promise<void> {
  const c = channels.find((x) => x.channel_id === input.channel_id)
  if (!c || !canRead(c, dummyViewer())) throw new Error('row-level security: chat_messages')
  if (input.document_id && !canSeeDocument(input.document_id)) throw new Error('row-level security: chat_messages')
  messages.push({
    message_id: nextMessage++,
    channel_id: input.channel_id,
    sender_id: actor.user_id,
    body: input.body,
    link: input.link,
    document_id: input.document_id,
    created_at: new Date().toISOString(),
  })
}

export async function markChannelRead(channelId: string, actor: AuditActor): Promise<void> {
  const row = reads.find((r) => r.channel_id === channelId && r.user_id === actor.user_id)
  const now = new Date().toISOString()
  if (row) row.last_read_at = now
  else reads.push({ channel_id: channelId, user_id: actor.user_id, last_read_at: now })
}

export async function listChannelReads(channelId: string): Promise<ChatRead[]> {
  return reads.filter((r) => r.channel_id === channelId).map((r) => ({ user_id: r.user_id, last_read_at: r.last_read_at }))
}

/** open_dm()의 거울 — 같은 회사를 하나라도 함께 가질 때만(그룹 범위 역할은 전원과). */
export async function openDm(otherId: string): Promise<string> {
  const me = dummyViewer()
  const other = DUMMY_PEOPLE.find((p) => p.user_id === otherId && !p.revoked_at && p.status === 'active')
  const groupScope = (r: string) => r === 'Chairman' || r === 'GroupCFO'
  if (
    !other ||
    other.user_id === me.user_id ||
    !(groupScope(me.role) || groupScope(other.role) || other.business_ids.some((b) => me.business_ids.includes(b)))
  ) {
    throw new Error('dm_forbidden')
  }
  const [a, b] = [me.user_id, other.user_id].sort()
  const found = channels.find((c) => c.kind === 'dm' && c.dm_a === a && c.dm_b === b)
  if (found) return found.channel_id
  const id = crypto.randomUUID()
  channels.push({ channel_id: id, kind: 'dm', business_id: null, team_id: null, dm_a: a, dm_b: b })
  return id
}

/* ------------------------------------------------------------------ AI 대화 — 본인만 */

const aiChats: (AiChat & { user_id: string })[] = []
const aiMessages: (AiChatMessage & { user_id: string })[] = []
let nextAi = 1

export async function listAiChats(): Promise<AiChat[]> {
  const me = dummyViewer().user_id
  return aiChats.filter((c) => c.user_id === me).map(({ user_id: _u, ...c }) => (void _u, c)).reverse()
}

export async function listAiChatMessages(chatId: string): Promise<AiChatMessage[]> {
  const me = dummyViewer().user_id
  return aiMessages.filter((m) => m.chat_id === chatId && m.user_id === me).map(({ user_id: _u, ...m }) => (void _u, m))
}

export async function createAiChat(title: string, actor: AuditActor): Promise<string> {
  const id = crypto.randomUUID()
  aiChats.push({ chat_id: id, title, created_at: new Date().toISOString(), user_id: actor.user_id })
  return id
}

export async function appendAiMessage(
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  sources: AiSource[],
  actor: AuditActor,
): Promise<void> {
  if (!aiChats.some((c) => c.chat_id === chatId && c.user_id === actor.user_id)) {
    throw new Error('row-level security: ai_chat_messages')
  }
  aiMessages.push({ id: nextAi++, chat_id: chatId, role, content, sources, created_at: new Date().toISOString(), user_id: actor.user_id })
}
