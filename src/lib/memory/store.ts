/**
 * 기억 엔진 저장소 손잡이(0086) — ChairmanRepository가 펼쳐 넣는다(live: supabase-memory.ts · dummy: dummy-memory.ts).
 * 판정 · 중복 막기 · 이력은 전부 DB(memory_me · dedupe_key · memory_revisions)다. 0086 전 DB면 'memory_unavailable'.
 */
import type {
  ApplyPayload,
  ApplyResult,
  LinkTargetType,
  MemoryCaptureDetail,
  MemoryCaptureRow,
  MemoryDirectory,
  MemoryItemFilter,
  MemoryItemWithCapture,
  MemoryReview,
  MemorySearchHit,
  MemorySearchParams,
  MemoryTargetName,
  PriorItem,
  ProcessingStatus,
  ReviewAction,
  SaveCaptureInput,
} from './types'

export interface MemoryAssetInput {
  path: string
  name: string
  type: string
  size: number
  kind: 'audio' | 'document' | 'image' | 'other'
}

export interface MemoryCaptureListOptions {
  limit?: number
  status?: ProcessingStatus[]
  from?: string | null
  to?: string | null
  targetType?: LinkTargetType | null
  targetId?: string | null
  /** 이 시각 이후(서울 하루 요약용) */
  since?: string | null
}

export interface MemoryMethods {
  saveMemoryCapture(input: SaveCaptureInput): Promise<string>
  addMemoryAsset(captureId: string, file: MemoryAssetInput): Promise<string>
  setMemoryAssetStatus(assetId: string, status: 'extracted' | 'failed' | 'skipped' | 'waiting_transcript', chars?: number | null): Promise<void>
  /** 비공개 버킷 memory-assets에 올린다(경로 «<본인>/<기록>/<이름>»). */
  putMemoryFile(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  readMemoryFile(path: string): Promise<Uint8Array>
  /** 내려받기 서명 주소(60초) — dummy는 null */
  memoryFileUrl(path: string): Promise<string | null>
  getMemoryCapture(captureId: string): Promise<MemoryCaptureDetail | null>
  listMemoryCaptures(opts?: MemoryCaptureListOptions): Promise<MemoryCaptureRow[]>
  claimMemoryJob(captureId: string): Promise<number | null>
  applyMemory(captureId: string, payload: ApplyPayload): Promise<ApplyResult>
  failMemory(captureId: string, error: string, engine: 'ai' | 'rule' | 'mock', model: string | null): Promise<void>
  requeueMemory(captureId: string): Promise<void>
  /** 처리할 차례인 기록(대기 · 실패 중 next_at이 지난 것) */
  dueMemoryJobs(limit: number): Promise<string[]>
  memoryDirectory(): Promise<MemoryDirectory>
  /** 같은 대상(회사 · 프로젝트 · 바깥 인물 — id 또는 «name:<이름>»)에 이어진 다른 기록의 열린 정보 */
  memoryPriorItems(captureId: string, targets: { target_type: LinkTargetType; target_id: string }[]): Promise<PriorItem[]>
  searchMemory(params: MemorySearchParams): Promise<MemorySearchHit[]>
  listMemoryReviews(opts?: { status?: 'open' | 'closed'; limit?: number; captureId?: string }): Promise<MemoryReview[]>
  resolveMemoryReview(reviewId: string, action: ReviewAction, data: Record<string, unknown>): Promise<Record<string, unknown>>
  setMemoryItem(itemId: string, patch: Record<string, unknown>, reason: string): Promise<void>
  listMemoryItems(filter?: MemoryItemFilter): Promise<MemoryItemWithCapture[]>
  memoryTargetNames(targets: { target_type: LinkTargetType; target_id: string }[]): Promise<MemoryTargetName[]>
  /** 오늘(서울) 기억 AI 호출 수(ai_usage_log feature 'memory_extract') */
  memoryAiUsedToday(): Promise<number>
}
