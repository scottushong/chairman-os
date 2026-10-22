/**
 * 기억 엔진(0088) — 화면 · 저장소 · 처리가 주고받는 모양. 판정(누가 보나)은 DB(memory_me — 주인 본인 · 대표 · 스위치)다.
 * 원본(raw_text)과 AI · 규칙이 만든 것(summary · items)은 다른 칸 · 다른 표다.
 */

export const CAPTURE_TYPES = ['note', 'voice', 'meeting', 'online_meeting', 'file', 'conversation', 'email', 'phone_call'] as const
export type CaptureType = (typeof CAPTURE_TYPES)[number]

export const CAPTURE_TYPE_LABEL: Record<CaptureType, string> = {
  note: '메모',
  voice: '음성',
  meeting: '회의',
  online_meeting: '화상회의',
  file: '파일',
  conversation: '대화',
  email: '이메일',
  phone_call: '통화',
}

export const PROCESSING_STATUSES = ['saved', 'processing', 'ready', 'needs_review', 'failed', 'waiting_transcript'] as const
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number]

export const STATUS_LABEL: Record<ProcessingStatus, string> = {
  saved: '저장됨',
  processing: '분석 중',
  ready: '준비됨',
  needs_review: '검토 필요',
  failed: '실패',
  waiting_transcript: '전사 대기',
}

export const CATEGORIES = [
  'business_meeting', 'investment_ma', 'operations', 'sales', 'finance', 'rnd', 'hr', 'personal_note', 'idea', 'strategy', 'other',
] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  business_meeting: '사업 미팅',
  investment_ma: '투자 · M&A',
  operations: '운영',
  sales: '영업',
  finance: '재무',
  rnd: 'R&D',
  hr: '인사',
  personal_note: '개인 메모',
  idea: '아이디어',
  strategy: '전략',
  other: '기타',
}

export const MEMORY_TYPES = ['fact', 'claim', 'decision', 'proposal', 'commitment', 'task', 'risk', 'opportunity', 'question'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  fact: '사실',
  claim: '주장',
  decision: '결정',
  proposal: '제안',
  commitment: '약속',
  task: '업무',
  risk: '위험',
  opportunity: '기회',
  question: '질문',
}

export type Direction = 'mine' | 'others' | 'unknown'
export type Lifecycle = 'open' | 'done' | 'superseded' | 'cancelled' | 'on_hold'
export type Verification = 'draft' | 'confirmed' | 'rejected'
export type LinkTargetType = 'business' | 'project' | 'person' | 'entity' | 'decision' | 'task'
export type LinkVerification = 'suggested' | 'confirmed' | 'rejected'
export type Relationship = 'mentions' | 'about' | 'speaker' | 'promised_by' | 'promised_to' | 'created_task'

export const REVIEW_TYPES = [
  'entity_identity', 'link_suggestion', 'change_detected', 'conflict', 'financial', 'task_candidate', 'date_ambiguous', 'decision_check',
] as const
export type ReviewType = (typeof REVIEW_TYPES)[number]

export const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  entity_identity: '누구인지 확인',
  link_suggestion: '연결 확인',
  change_detected: '바뀐 것 같음',
  conflict: '앞 기록과 다름',
  financial: '금액 확인',
  task_candidate: '업무로 만들까',
  date_ambiguous: '날짜가 모호함',
  decision_check: '결정 확인',
}

export type Priority = 'critical' | 'high' | 'medium' | 'low'
export type ReviewStatus = 'open' | 'confirmed' | 'edited' | 'rejected' | 'linked' | 'created'
export type ReviewAction = 'confirm' | 'edit' | 'reject' | 'link' | 'create_entity'

export interface MemoryCaptureRow {
  capture_id: string
  capture_type: CaptureType
  title: string | null
  raw_text: string
  captured_at: string
  created_at: string
  processing_status: ProcessingStatus
  summary: string | null
  categories: Category[]
  metadata: Record<string, unknown>
}

export interface MemoryAsset {
  asset_id: string
  capture_id: string
  storage_path: string
  file_name: string
  file_type: string
  file_size: number
  kind: 'audio' | 'document' | 'image' | 'other'
  processing_status: 'stored' | 'waiting_transcript' | 'extracted' | 'failed' | 'skipped'
  extracted_chars: number | null
  created_at: string
}

export interface MemoryItem {
  item_id: string
  capture_id: string
  memory_type: MemoryType
  content: string
  source_quote: string | null
  speaker_label: string | null
  direction: Direction
  who_text: string | null
  to_text: string | null
  due_date: string | null
  due_text: string | null
  amount_text: string | null
  event_time: string | null
  confidence: number
  verification_status: Verification
  lifecycle_status: Lifecycle
  origin: 'ai' | 'rule' | 'manual'
  created_at: string
  updated_at: string
}

export interface MemoryLink {
  link_id: string
  capture_id: string
  item_id: string | null
  target_type: LinkTargetType
  target_id: string
  relationship: Relationship
  verification_status: LinkVerification
  confidence: number
  mention_text: string | null
}

export interface MemoryReview {
  review_id: string
  review_type: ReviewType
  title: string
  proposed_change: Record<string, unknown>
  capture_id: string
  item_id: string | null
  related_item_id: string | null
  link_id: string | null
  priority: Priority
  status: ReviewStatus
  resolution: Record<string, unknown> | null
  created_at: string
  resolved_at: string | null
}

export interface MemoryRun {
  run_id: string
  processing_stage: string
  status: 'done' | 'failed' | 'skipped'
  engine: 'ai' | 'rule' | 'mock'
  model: string | null
  prompt_version: string | null
  attempt_count: number
  error_details: string | null
  stats: Record<string, unknown>
  created_at: string
}

export interface MemoryRevision {
  revision_id: number
  item_id: string | null
  link_id: string | null
  previous_version: Record<string, unknown> | null
  new_version: Record<string, unknown> | null
  change_reason: string
  changed_at: string
}

export interface MemoryEntity {
  entity_id: string
  entity_type: 'person' | 'company' | 'project' | 'other'
  display_name: string
  status: 'pending' | 'confirmed' | 'merged' | 'rejected'
}

export interface MemoryCaptureDetail {
  capture: MemoryCaptureRow
  assets: MemoryAsset[]
  items: MemoryItem[]
  links: MemoryLink[]
  reviews: MemoryReview[]
  runs: MemoryRun[]
  revisions: MemoryRevision[]
  job: { status: string; attempts: number; next_at: string; last_error: string | null } | null
}

/** 연결 대상 이름표(회사 · 프로젝트 · 사람 · 바깥 인물) — 화면이 링크를 그린다. */
export interface MemoryTargetName {
  target_type: LinkTargetType
  target_id: string
  name: string
  href: string | null
}

/** 처리할 때 이름을 맞춰 보는 사전(기존 DB + 별칭 + 바깥 인물). */
export interface MemoryDirectory {
  businesses: { business_id: string; name: string }[]
  projects: { project_id: string; name: string; business_id: string }[]
  people: { user_id: string; display_name: string; display_name_en: string | null; title_ko: string | null }[]
  aliases: { entity_type: 'business' | 'project' | 'person' | 'entity'; entity_id: string; alias: string; verification_status: LinkVerification }[]
  entities: MemoryEntity[]
}

/** 바뀜 찾기에 쓰는 앞 정보(같은 대상에 이어진 열린 약속 · 결정 · 업무). */
export interface PriorItem extends MemoryItem {
  targets: { target_type: LinkTargetType; target_id: string }[]
  captured_at: string
}

export interface MemorySearchHit {
  kind: 'capture' | 'item'
  capture_id: string
  item_id: string | null
  memory_type: MemoryType | null
  capture_type: CaptureType
  title: string
  snippet: string
  captured_at: string
  due_date: string | null
  lifecycle_status: Lifecycle | null
  verification_status: Verification | null
  score: number
}

export interface MemorySearchParams {
  query: string
  from?: string | null
  to?: string | null
  type?: MemoryType | null
  targetType?: LinkTargetType | null
  targetId?: string | null
  limit?: number
}

export interface MemoryItemFilter {
  types?: MemoryType[]
  lifecycle?: Lifecycle[]
  targetType?: LinkTargetType
  targetId?: string
  direction?: Direction
  limit?: number
}

export interface MemoryItemWithCapture extends MemoryItem {
  captured_at: string
  capture_title: string | null
}

/** memory_apply 입력(앱이 스키마 검사 · 규칙을 거친 뒤 보낸다). */
export interface ApplyPayload {
  summary: string | null
  categories: Category[]
  status_hint?: 'waiting_transcript' | null
  runs: {
    stage: 'extract' | 'link' | 'detect' | 'embed' | 'transcribe'
    status: 'done' | 'failed' | 'skipped'
    engine: 'ai' | 'rule' | 'mock'
    model?: string | null
    model_version?: string | null
    prompt_version?: string | null
    input_hash?: string | null
    stats?: Record<string, unknown>
    error?: string | null
  }[]
  items: {
    ref: string
    memory_type: MemoryType
    content: string
    source_quote: string | null
    speaker_label: string | null
    direction: Direction
    who_text: string | null
    to_text: string | null
    due_date: string | null
    due_text: string | null
    amount_text: string | null
    event_time: string | null
    confidence: number
    origin: 'ai' | 'rule'
  }[]
  links: {
    item_ref: string | null
    target_type: LinkTargetType
    target_id?: string | null
    entity_type?: 'person' | 'company' | 'project' | 'other'
    display_name?: string
    relationship: Relationship
    verification_status: LinkVerification
    confidence: number
    mention_text: string | null
  }[]
  reviews: {
    review_type: ReviewType
    title: string
    proposed_change: Record<string, unknown>
    item_ref: string | null
    related_item_id: string | null
    link_ref: string | null
    priority: Priority
    key: string
  }[]
}

export interface ApplyResult {
  status: ProcessingStatus
  new_items: number
  new_links: number
  new_reviews: number
}

export interface SaveCaptureInput {
  clientKey: string
  type: CaptureType
  title?: string | null
  rawText: string
  capturedAt?: string | null
  source?: string
  metadata?: Record<string, unknown>
}
