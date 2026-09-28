/**
 * Phase 9 블록 6(0041) — 사내 메신저 · AI 대화의 어휘.
 */
import type { BusinessId, IsoDateTime, UserId } from './primitives'

export type ChatChannelKind = 'company' | 'team' | 'dm'

export interface ChatChannel {
  channel_id: string
  kind: ChatChannelKind
  business_id: BusinessId | null
  team_id: string | null
  /** 1:1이면 상대. 회사 · 팀 방은 null. */
  other_user_id: UserId | null
  /** 화면에 그릴 이름 — 회사명 · 팀명 · 상대 이름. 어댑터가 붙인다. */
  title: string
  /** 이 사람이 마지막으로 읽은 시각. 없으면 null(한 번도 안 읽음). */
  my_last_read_at: IsoDateTime | null
  /** 가장 최근 메시지 시각. 메시지가 없으면 null. */
  last_message_at: IsoDateTime | null
}

export interface ChatMessage {
  message_id: number
  channel_id: string
  sender_id: UserId
  sender_name: string
  body: string
  link: string | null
  document_id: string | null
  /** 첨부 문서의 제목 — **이 사람이 그 문서를 볼 수 있을 때만.** 못 보면 null(존재도 말하지 않는다). */
  document_title: string | null
  created_at: IsoDateTime
}

export interface ChatMessageInput {
  channel_id: string
  body: string
  link: string | null
  document_id: string | null
}

export interface ChatRead {
  user_id: UserId
  last_read_at: IsoDateTime
}

export interface AiChat {
  chat_id: string
  title: string
  created_at: IsoDateTime
}

export interface AiSource {
  label: string
  /** 앱 안의 경로만('/…'). */
  href: string
}

export interface AiChatMessage {
  id: number
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  sources: AiSource[]
  created_at: IsoDateTime
}
