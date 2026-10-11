/**
 * 자료 받는 입구(0058 intake_items) — 설계서 docs/superpowers/specs/2026-10-06-intake-and-purchasing.md A · B③④.
 *
 * 값은 0058 check 제약과 같은 목록이다. 한쪽만 늘면 화면이 보낸 값을 DB가 거부한다.
 */
import type { AttachmentClass } from './attachment'

export const INTAKE_STATUS = ['uploaded', 'reading', 'proposed', 'no_ai', 'failed', 'loaded', 'kept', 'discarded'] as const
export type IntakeStatus = (typeof INTAKE_STATUS)[number]

/** 사람이 확인하는 종류 다섯. AI는 여기에 'mix_ratio'를 더 말할 수 있다 — 서버가 그 제안을 버린다(설계서 A5). */
export const INTAKE_KIND = ['statement', 'price_list', 'contract', 'official_letter', 'other'] as const
export type IntakeKind = (typeof INTAKE_KIND)[number]

export const INTAKE_NO_AI_REASON = ['mix_ratio', 'excluded_entity', 'not_attested'] as const
export type IntakeNoAiReason = (typeof INTAKE_NO_AI_REASON)[number]

export const INTAKE_STATUS_LABEL_KO: Record<IntakeStatus, string> = {
  uploaded: '읽기 전',
  reading: '읽는 중',
  proposed: '제안',
  no_ai: 'AI 안 보냄',
  failed: '읽기 실패',
  loaded: '적재됨',
  kept: '보관',
  discarded: '버림',
}

export const INTAKE_KIND_LABEL_KO: Record<IntakeKind, string> = {
  statement: '재무제표 · 결산서',
  price_list: '원료 · 단가표 · 견적서',
  contract: '계약서',
  official_letter: '공문',
  other: '그 외 문서',
}

/** 문서로 넣을 때의 doc_type(0001 documents.doc_type은 자유 문자열 — 문서 화면이 쓰는 낱말). */
export const INTAKE_KIND_DOC_TYPE: Record<IntakeKind, string> = {
  statement: '재무제표',
  price_list: '단가표',
  contract: 'Contract',
  official_letter: 'Letter',
  other: '기타',
}

/** 이 블록에서 «이 메뉴에 초안 만들기»(= 문서)가 서는 종류. 재무제표는 0060, 구매는 취소(원가 엔진으로 따로). */
export const INTAKE_DOCUMENT_KINDS: readonly IntakeKind[] = ['contract', 'official_letter', 'other']

export type IntakeConfidence = 'high' | 'medium' | 'low'

/** AI가 뽑은 문서 칸(설계서 B③④) — 문서에 적힌 그대로. 없으면 null. */
export interface IntakeDocFields {
  title: string | null
  counterparty: string | null
  date: string | null
  period: string | null
  expiry: string | null
  /** 본문 숫자 그대로(«금 일억 원정», «USD 12,000») — 계산하지 않는다. */
  amount: string | null
  doc_type: string | null
}

/** intake_items.proposal — AI 제안(결정 아님). 원문은 저장하지 않는다(0045). */
export interface IntakeProposal {
  kind: IntakeKind
  confidence: IntakeConfidence
  /** 한 줄 이유(«표지에 ‘재무상태표’, 세무법인 직인»). */
  reason: string
  fields: IntakeDocFields
  model: string
  /** dummy 모드에서 키 없이 만든 가짜 제안. 화면이 «DUMMY 제안»으로 밝힌다. */
  dummy?: boolean
  at: string
}

export interface IntakeItem {
  item_id: string
  business_id: string
  attachment_id: string
  security_class: Exclude<AttachmentClass, 'Vault'>
  status: IntakeStatus
  no_ai_reason: IntakeNoAiReason | null
  /** 끈적한 AI 차단(0058 리뷰 I1) — 대표만 풀고, not_attested는 올린 사람의 확인이 푼다. */
  ai_blocked_reason: IntakeNoAiReason | null
  mix_attested_by: string | null
  mix_attested_at: string | null
  proposal: IntakeProposal | null
  proposal_history: unknown[]
  kind: IntakeKind | null
  kind_confirmed_by: string | null
  kind_confirmed_at: string | null
  loaded_table: 'documents' | null
  loaded_id: string | null
  loaded_by: string | null
  loaded_at: string | null
  file_sha256: string | null
  created_by: string
  created_at: string
  updated_at: string
}

/** 목록 한 줄 = 입구 줄 + (보이면) 원본 첨부의 이름 · 형식 · 크기. 적재된 줄의 원본은 문서가 보이는 사람에게만 보인다. */
export interface IntakeRow extends IntakeItem {
  file: { file_name: string; mime: string; size_bytes: number } | null
}

/** 앱이 고치는 칸(0058 grant 다섯). 도장 · 이력 · 적재 칸은 DB가 적는다. */
export interface IntakePatch {
  status?: IntakeStatus
  no_ai_reason?: IntakeNoAiReason | null
  proposal?: IntakeProposal | null
  kind?: IntakeKind | null
  /** true = 지금 «배합비 아님» 확인(도장은 DB가 — 올린 사람만). */
  mix_attested?: boolean
}

export interface NewIntake {
  business_id: string
  security_class: Exclude<AttachmentClass, 'Vault'>
  file_name: string
  mime: string
  size_bytes: number
  file_sha256: string | null
  mix_attested: boolean
}

export interface IntakeSameFile {
  item_id: string
  status: IntakeStatus
  loaded_table: string | null
  loaded_id: string | null
  loaded_at: string | null
  created_at: string
}
