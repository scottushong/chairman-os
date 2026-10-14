import type { ModuleGrant } from './access'
import type { Role } from './permissions'
import type { IsoDateTime } from './primitives'

/**
 * 0069 org_access_lookup 한 사람. 읽기만 — 바꾸기는 /settings/users(대표).
 * 보이는 범위: 대표 전원 · 본인 · 회사 «사용자 관리자»(0055)는 맡은 회사의 사원 · 팀장.
 * 원가 4종 줄은 대표 세션에만 오고, 그 밖에는 modules에서 빠진 채 cost_hidden=true다.
 */
export interface PersonAccess {
  user_id: string
  name: string
  title: string
  role: Role
  status: string
  revoked: boolean
  self: boolean
  /** 대표 세션 · 본인에게만. */
  max_security_class: string | null
  team: { team_id: string; name: string; business_id: string } | null
  /** 상사가 대표면 대표 세션 밖에는 { top: true }만(0069 리뷰 I2 — 앱이 «대표»로 부른다). */
  reports_to: { user_id: string; name: string; role: Role; title: string } | { top: true } | null
  /** 회사 범위. 전사 역할(대표 · 그룹 CFO)은 ['*']. */
  businesses: string[]
  modules: ModuleGrant[]
  cost_hidden: boolean
}

export const FEEDBACK_STATUS = ['new', 'triaged', 'copied', 'applied', 'held'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUS)[number]

export const FEEDBACK_STATUS_LABEL_KO: Record<FeedbackStatus, string> = {
  new: '새것',
  triaged: 'AI 정리됨',
  copied: '지시문 복사함',
  applied: '반영됨',
  held: '보류',
}

export type FeedbackExcludeReason = 'mix_ratio' | 'vault' | 'cost_number'

export const FEEDBACK_EXCLUDE_LABEL_KO: Record<FeedbackExcludeReason, string> = {
  mix_ratio: '배합비',
  vault: 'Vault 등급',
  cost_number: '원가 숫자',
}

/** AI 정리 한 번의 결과(0069 ai_feedback.triage · ai_feedback_bundles.triage). */
export interface FeedbackTriage {
  summary: string
  expected: string
  instruction: string
  model: string
  by?: string
}

/** 대표의 보완함 한 줄(0069 ai_feedback — 대표만 전부 읽는다). */
export interface AiFeedback {
  feedback_id: string
  created_at: IsoDateTime
  author_id: string
  author_name: string
  author_role: Role
  business_id: string | null
  path: string
  message_id: number
  question: string
  answer: string
  body: string
  ai_excluded: boolean
  excluded_reasons: FeedbackExcludeReason[]
  cancelled_at: IsoDateTime | null
  status: FeedbackStatus
  triage: FeedbackTriage | null
  triaged_at: IsoDateTime | null
  bundle_id: string | null
}

/** 쓴 사람 본인의 의견(0069 ai_feedback_mine — 상태 · AI 정리 · 제외 표시 없음). */
export interface AiFeedbackMine {
  feedback_id: string
  created_at: IsoDateTime
  path: string
  message_id: number
  question: string
  answer: string
  body: string
  cancelled_at: IsoDateTime | null
}

export interface AiFeedbackBundle {
  bundle_id: string
  created_at: IsoDateTime
  title: string
  screen: string
  feedback_ids: string[]
  triage: FeedbackTriage
  status: Exclude<FeedbackStatus, 'triaged'>
}

export interface NewAiFeedback {
  message_id: number
  body: string
  path: string
  business_id: string | null
  ai_excluded: boolean
  excluded_reasons: FeedbackExcludeReason[]
}
