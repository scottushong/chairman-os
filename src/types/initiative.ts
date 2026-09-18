import type { BusinessId, IsoDate, IsoDateTime } from './primitives'

/**
 * Phase 4-A. 회사 밖에서 회장이 직접 굴리는 건(0017).
 *
 * 열거값은 영문으로 저장하고 화면에는 *_LABEL_KO를 거쳐 나간다 — 저장소의 다른 열거값과 같다.
 * 한글을 DB에 넣으면 라벨을 고칠 때 마이그레이션을 써야 하고 URL 필터가 인코딩된다.
 */

export const INITIATIVE_KIND = ['NewBiz', 'Deal', 'Fundraise', 'Entity', 'Internal'] as const
export type InitiativeKind = (typeof INITIATIVE_KIND)[number]
export const INITIATIVE_KIND_LABEL_KO: Record<InitiativeKind, string> = {
  NewBiz: '신사업',
  Deal: '딜',
  Fundraise: '투자유치',
  Entity: '법인',
  Internal: '내부프로젝트',
}

export const INITIATIVE_STAGE = ['Planning', 'Contact', 'Negotiation', 'Execution', 'Closing', 'Halted'] as const
export type InitiativeStage = (typeof INITIATIVE_STAGE)[number]
export const INITIATIVE_STAGE_LABEL_KO: Record<InitiativeStage, string> = {
  Planning: '기획',
  Contact: '접촉',
  Negotiation: '협상',
  Execution: '실행',
  Closing: '완료',
  Halted: '중단',
}

export const INITIATIVE_STATUS = ['Active', 'Done', 'Dropped'] as const
export type InitiativeStatus = (typeof INITIATIVE_STATUS)[number]
export const INITIATIVE_STATUS_LABEL_KO: Record<InitiativeStatus, string> = {
  Active: '진행',
  Done: '종료',
  Dropped: '접음',
}

export const KEYMAN_CHANNEL = ['KakaoTalk', 'WeChat', 'Email', 'Phone', 'Other'] as const
export type KeymanChannel = (typeof KEYMAN_CHANNEL)[number]
export const KEYMAN_CHANNEL_LABEL_KO: Record<KeymanChannel, string> = {
  KakaoTalk: '카톡',
  WeChat: '위챗',
  Email: '이메일',
  Phone: '전화',
  Other: '기타',
}

export const EVENT_KIND = ['Trip', 'Meeting', 'Deadline', 'Other'] as const
export type EventKind = (typeof EVENT_KIND)[number]
export const EVENT_KIND_LABEL_KO: Record<EventKind, string> = {
  Trip: '출장',
  Meeting: '미팅',
  Deadline: '마감',
  Other: '기타',
}

export interface Initiative {
  initiative_id: string
  title: string
  kind: InitiativeKind
  /** null = 회사에 걸리지 않은 건 */
  business_id: BusinessId | null
  stage: InitiativeStage
  goal: string
  target_date: IsoDate | null
  next_action: string
  next_action_date: IsoDate | null
  next_action_owner: string
  blocker: string
  status: InitiativeStatus
  updated_at: IsoDateTime
}

/** 회장 개인의 메모. Chairman만 읽는다 — 다른 역할에게는 늘 null이다. */
export interface InitiativeNote {
  initiative_id: string
  note: string
}

export interface InitiativeKeyman {
  keyman_id: string
  initiative_id: string
  name: string
  relation: string
  channel: KeymanChannel
  last_contact_on: IsoDate | null
  note: string
}

export interface InitiativeDoc {
  doc_id: string
  initiative_id: string
  title: string
  url: string
}

/** 이름이 Event면 DOM의 Event와 부딪힌다. */
export interface ChairmanEvent {
  event_id: string
  title: string
  starts_on: IsoDate
  /** null = 하루짜리 */
  ends_on: IsoDate | null
  kind: EventKind
  initiative_id: string | null
  business_id: BusinessId | null
  location: string
  note: string
}

export const CALENDAR_ITEM_KIND = ['event', 'next_action', 'milestone', 'decision'] as const
export type CalendarItemKind = (typeof CALENDAR_ITEM_KIND)[number]
export const CALENDAR_ITEM_LABEL_KO: Record<CalendarItemKind, string> = {
  event: '일정',
  next_action: '다음 행동',
  milestone: '마일스톤',
  decision: '결재 마감',
}

/** 0017 calendar_items 뷰 한 줄. href는 뷰가 만든다 — 화면이 kind별 분기를 다시 쓰지 않게. */
export interface CalendarItem {
  kind: CalendarItemKind
  source_id: string
  title: string
  on_date: IsoDate
  ends_on: IsoDate | null
  business_id: BusinessId | null
  initiative_id: string | null
  href: string
}
