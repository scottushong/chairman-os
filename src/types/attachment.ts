/**
 * Phase 10 — 파일 첨부 + AI 요약 (0045).
 *
 * 값은 0045의 check 제약과 같은 목록이다. 한쪽만 늘면 화면이 받는 파일을 DB가 거부한다.
 */

/** 첨부가 붙는 대상 넷. 표 이름 그대로 — 0045 attachments_entity_check. */
export const ATTACHMENT_ENTITY = ['initiatives', 'businesses', 'documents', 'decisions'] as const
export type AttachmentEntity = (typeof ATTACHMENT_ENTITY)[number]

export const ATTACHMENT_STATUS = ['uploaded', 'extracting', 'summarized', 'skipped_vault', 'failed'] as const
export type AttachmentStatus = (typeof ATTACHMENT_STATUS)[number]

/** 첨부 등급은 셋이다. 'Public'(0025)은 공지의 등급이라 여기 없다. */
export const ATTACHMENT_CLASS = ['Normal', 'Restricted', 'Vault'] as const
export type AttachmentClass = (typeof ATTACHMENT_CLASS)[number]

export const ATTACHMENT_STATUS_LABEL_KO: Record<AttachmentStatus, string> = {
  uploaded: '요약 대기',
  extracting: '요약 중',
  summarized: '요약됨',
  skipped_vault: 'Vault — AI 전송 안 함',
  failed: '요약 실패',
}

/** 0045 attachment_summary_ok와 같은 모양. 추출 본문 칸은 없다 — 저장하지 않는다. */
export interface AttachmentSummary {
  /** 1~3줄. 문서의 언어 그대로. */
  summary: string[]
  /** 문서가 한국어가 아닐 때만 — 한국어 3줄. */
  summary_ko?: string[]
  /** 단위를 붙인 문자열(«매출 12.3억 원»). */
  key_numbers: string[]
  decisions_needed: string[]
  next_actions: string[]
  confidence: 'high' | 'medium' | 'low'
  /** 'ko' | 'en' … 모델이 판정한 문서 언어. */
  language?: string
  /** dummy 모드에서 키 없이 만든 가짜 요약. 화면이 «DUMMY 요약»으로 표시한다. */
  dummy?: boolean
  /** 긴 문서를 몇 구간으로 나눠 요약했나(50쪽+). */
  sections?: number
}

export interface Attachment {
  attachment_id: string
  entity_table: AttachmentEntity
  entity_id: string
  business_id: string | null
  file_name: string
  mime: string
  size_bytes: number
  /** <entity_table>/<entity_id>/<attachment_id>. DB가 만든다. */
  storage_path: string
  security_class: AttachmentClass
  uploaded_by: string
  status: AttachmentStatus
  ai_summary: AttachmentSummary | null
  ai_model: string | null
  ai_error: string | null
  summarized_at: string | null
  created_at: string
}

/** 올리기 한 건의 메타. 경로 · 상태 · 올린 사람은 DB가 정한다. */
export interface NewAttachment {
  entity_table: AttachmentEntity
  entity_id: string
  file_name: string
  mime: string
  size_bytes: number
  security_class: AttachmentClass
}

/** 요약 칸 다섯 중 앱이 쓰는 것(summarized_at은 트리거가 적는다). */
export interface AttachmentSummaryPatch {
  status: AttachmentStatus
  ai_summary?: AttachmentSummary | null
  ai_model?: string | null
  ai_error?: string | null
}

/** Vault 첨부의 지정자 한 사람. */
export interface AttachmentViewer {
  user_id: string
  display_name: string
}

/** 0045 ai_usage_log 한 줄. user_id · created_at은 DB가 적는다. */
export interface AiUsageInput {
  /** attachment_summary · memo_structure … (소문자 · 숫자 · _.-) */
  feature: string
  model: string
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
  entity_table?: string | null
  entity_id?: string | null
}
