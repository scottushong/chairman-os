/**
 * Phase 11 — AI 어시스턴트(0046)의 어휘.
 */
import type { IsoDateTime } from './primitives'

/** 0046 ai_actions.kind — 어시스턴트가 제안할 수 있는 쓰기 여섯. */
export const AI_ACTION_KIND = [
  'initiative_update',
  'event_create',
  'approval_draft',
  'checkin',
  'memo_tidy',
  'attachment_summary',
] as const
export type AiActionKind = (typeof AI_ACTION_KIND)[number]

export const AI_ACTION_LABEL_KO: Record<AiActionKind, string> = {
  initiative_update: '이니셔티브 고치기',
  event_create: '일정 추가',
  approval_draft: '결재 기안',
  checkin: '체크인',
  memo_tidy: '메모 정리',
  attachment_summary: '첨부 요약',
}

export type AiActionStatus = 'pending' | 'confirmed' | 'cancelled' | 'done' | 'failed'

/** 사람이 확인 전에 보는 것. 칸마다 전 → 후. */
export interface AiActionPreview {
  title: string
  lines: { label: string; before: string | null; after: string }[]
  /** 확인 전에 알아야 할 것(예: «외부 AI로 파일이 나갑니다»). */
  warning?: string | null
  /** 실행 뒤 볼 화면. */
  href?: string | null
}

export interface AiAction {
  action_id: string
  chat_id: string | null
  kind: AiActionKind
  /** 실행할 값. 서버만 읽는다 — 화면으로 내려보내지 않는다. */
  payload: Record<string, unknown>
  preview: AiActionPreview
  target_table: string | null
  target_id: string | null
  business_id: string | null
  status: AiActionStatus
  result: string | null
  expires_at: IsoDateTime
  created_at: IsoDateTime
}

/** 화면으로 내려가는 모양 — payload가 없다. */
export type AiActionView = Omit<AiAction, 'payload'>

export interface NewAiAction {
  chat_id: string | null
  kind: AiActionKind
  payload: Record<string, unknown>
  preview: AiActionPreview
  target_table?: string | null
  target_id?: string | null
  business_id?: string | null
}

/** /settings의 일별 AI 비용 한 줄(0045 ai_usage_log를 날짜 × 기능으로 묶은 것). */
export interface AiUsageDay {
  /** KST 날짜 */
  day: string
  feature: string
  calls: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
}
