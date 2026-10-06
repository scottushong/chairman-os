/**
 * Phase 9 그룹웨어(0038)의 어휘 — 공지 · 결재 양식 · 문서 폴더.
 *
 * **양식 키 다섯은 0038 approval_templates의 check와 글자 하나까지 같아야 한다.**
 */
import type { BusinessId, IsoDate, IsoDateTime, UserId } from './primitives'

/* ------------------------------------------------------------------ 공지 */

export interface Notice {
  notice_id: number
  /** null = 그룹 전체 공지 */
  business_id: BusinessId | null
  title: string
  body: string
  title_en: string | null
  body_en: string | null
  pinned: boolean
  expires_on: IsoDate | null
  created_by: UserId
  /** 작성자 표시 이름. 프로필을 못 읽으면 '미지정'. */
  created_by_name: string
  created_at: IsoDateTime
  /** 이 세션이 읽었나(notice_reads의 자기 줄). */
  read_by_me: boolean
}

export interface NoticeInput {
  business_id: BusinessId | null
  title: string
  body: string
  title_en: string | null
  body_en: string | null
  pinned: boolean
  expires_on: IsoDate | null
}

/** 읽음 확인 한 줄. 작성자와 회장만 남의 줄을 받는다(0038 notice_reads_read). */
export interface NoticeRead {
  user_id: UserId
  name: string
  read_at: IsoDateTime
}

/* ------------------------------------------------------------------ 결재 양식 */

export const APPROVAL_TEMPLATE_KEY = ['expense', 'purchase', 'leave', 'contract', 'hiring'] as const
export type ApprovalTemplateKey = (typeof APPROVAL_TEMPLATE_KEY)[number]

export const TEMPLATE_FIELD_TYPES = ['text', 'number', 'money', 'date', 'textarea', 'url'] as const
/** 'url'은 2026-10-06 추가(구매·지출의 «링크»). DB는 fields를 jsonb로만 본다 — 형식 검사는 앱(actions/approval-form.ts)이 한다. */
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number]

export interface TemplateField {
  key: string
  label_ko: string
  label_en: string
  type: TemplateFieldType
  required: boolean
}

export interface ApprovalTemplate {
  template_key: ApprovalTemplateKey
  name_ko: string
  name_en: string
  fields: TemplateField[]
  attachment_required: boolean
  chairman_always: boolean
  /** fields.amount가 이 값 이상이면 회장까지. null = 금액 규칙 없음. */
  chairman_over: number | null
  sort_order: number
}

/** 결재선 한 칸. decisions.approval_line에 제출 순간의 값이 얼려 들어간다. */
export interface ApprovalStep {
  step: 'lead' | 'rule' | 'chairman'
  user_id: UserId | null
  name: string
  /** 왜 이 칸이 섰는가(또는 비었는가) — 사람이 읽는 한 줄. */
  why: string
}

/** my_approval_lead()의 한 줄. */
export interface ApprovalLead {
  user_id: UserId
  display_name: string
  via: 'team_lead' | 'reports_to'
}

/* ------------------------------------------------------------------ 문서 폴더 */

export interface DocFolder {
  folder_id: number
  business_id: BusinessId
  team_id: string | null
  parent_id: number | null
  name: string
}
