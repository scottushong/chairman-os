'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { currentExtractor, memoryAiPerDay } from '@/lib/memory/ai'
import { processCapture, processDue, type ProcessOutcome } from '@/lib/memory/pipeline'
import { CAPTURE_TYPES, type CaptureType, type ReviewAction } from '@/lib/memory/types'
import { getRepository, type ChairmanRepository } from '@/lib/repository'

/**
 * 기억 엔진(0086) 서버 액션. 문은 둘: 여기(대표 · 스위치 — 사람이 읽을 말) + DB(memory_me — 최종 판정).
 * 직원이 이 액션을 직접 불러도 'denied'와 DB 거부로 끝난다(존재를 알리는 문구 없이 «권한이 없습니다»).
 *
 * 처리 흐름(머리말 기술 결정): 저장은 즉시(원본 먼저) → 응답을 보낸 뒤 after()로 1차 처리 → 실패 · 남은 일은 대표가 기억 화면을
 * 열 때 processPendingMemory가 다시 처리(대표 세션 안에서만 — AI Agent는 기억을 못 읽는다).
 */

const DENIED = '권한이 없습니다.'
const MAX_TEXT = 200_000
const MAX_FILE = 25 * 1024 * 1024
const DUMMY_FILE_MAX = 4 * 1024 * 1024

async function gate(): Promise<{ repo: ChairmanRepository; userId: string } | null> {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman' || !(await featureOn(user, 'memory_engine'))) return null
  return { repo: await getRepository(), userId: user.user_id }
}

/** 오늘 AI를 써도 되나 — env MEMORY_AI_PER_DAY(기본 0 = 안 씀)와 오늘 쓴 수. */
async function aiAllowed(repo: ChairmanRepository): Promise<boolean> {
  const cap = memoryAiPerDay()
  if (cap <= 0) return false
  return (await repo.memoryAiUsedToday().catch(() => cap)) < cap
}

async function runOne(repo: ChairmanRepository, captureId: string): Promise<ProcessOutcome> {
  return processCapture(repo, captureId, { allowAi: await aiAllowed(repo), extractor: currentExtractor(), logAiUsage: (u) => repo.logAiUsage(u) })
}

function message(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m === 'memory_denied') return DENIED
  if (m === 'memory_empty') return '내용이 비어 있습니다.'
  if (m === 'memory_unavailable') return '기억 기능이 아직 준비되지 않았습니다(DB 반영 전).'
  if (m === 'memory_project_required') return '업무를 넣을 프로젝트를 골라 주세요.'
  if (m === 'memory_review_closed') return '이미 처리된 검토입니다.'
  if (m === 'memory_name_required') return '이름을 넣어 주세요.'
  if (m === 'memory_bad_target') return '연결할 대상을 찾지 못했습니다.'
  if (m === 'memory_reason_required') return '이유를 적어 주세요.'
  if (m === 'memory_item_superseded') return '뒤 처리로 바뀐 정보입니다 — 새 검토를 확인해 주세요.'
  if (m === 'memory_bad_action') return '이 검토에서는 할 수 없는 처리입니다.'
  return '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
}

export interface SaveMemoryResult {
  ok: boolean
  captureId?: string
  error?: string
  /** 처리를 뒤에서 시작했나 */
  queued?: boolean
}

/**
 * 빠른 기록 저장 — 원본을 바로 남긴다. 파일: live는 브라우저가 비공개 버킷에 먼저 올리고 경로만(paths), dummy는 바이트(files, 4MB).
 * 같은 client_key면 처음 줄을 돌려준다(두 번 눌러도 한 줄).
 */
export async function saveMemoryAction(form: FormData): Promise<SaveMemoryResult> {
  const g = await gate()
  if (!g) return { ok: false, error: DENIED }
  const text = String(form.get('text') ?? '').slice(0, MAX_TEXT)
  const type = String(form.get('type') ?? 'note') as CaptureType
  const clientKey = String(form.get('client_key') ?? '')
  if (!(CAPTURE_TYPES as readonly string[]).includes(type) || !/^[A-Za-z0-9_-]{8,80}$/.test(clientKey)) return { ok: false, error: '요청 모양이 틀렸습니다.' }
  const participants = String(form.get('participants') ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30)
  const consent = form.get('consent') === 'on'
  try {
    const captureId = await g.repo.saveMemoryCapture({
      clientKey,
      type,
      title: String(form.get('title') ?? '').slice(0, 200) || null,
      rawText: text,
      capturedAt: String(form.get('captured_at') ?? '') || null,
      source: 'quick_capture',
      metadata: { ...(participants.length ? { participants } : {}), ...(type === 'meeting' || type === 'voice' ? { consent_noted: consent } : {}) },
    })
    // live — 브라우저가 이미 올린 파일(경로 · 이름 · 크기 · 종류)
    for (const raw of form.getAll('asset')) {
      const a = JSON.parse(String(raw)) as { path: string; name: string; type: string; size: number }
      if (!a.path?.startsWith(`${g.userId}/${captureId}/`) || !(a.size > 0 && a.size <= MAX_FILE)) continue
      await g.repo.addMemoryAsset(captureId, { path: a.path, name: a.name.slice(0, 200), type: a.type || 'application/octet-stream', size: a.size, kind: kindOf(a.name, a.type) })
    }
    // dummy — 바이트
    for (const f of form.getAll('file')) {
      if (!(f instanceof File) || f.size < 1 || f.size > DUMMY_FILE_MAX) continue
      const path = `${g.userId}/${captureId}/${safeName(f.name)}`
      await g.repo.putMemoryFile(path, new Uint8Array(await f.arrayBuffer()), f.type || 'application/octet-stream').catch((e) => {
        if (!(e instanceof Error && e.message === 'memory_file_exists')) throw e
      })
      await g.repo.addMemoryAsset(captureId, { path, name: f.name.slice(0, 200), type: f.type || 'application/octet-stream', size: f.size, kind: kindOf(f.name, f.type) })
    }
    after(async () => {
      await runOne(g.repo, captureId).catch(() => {})
    })
    revalidatePath('/memory')
    return { ok: true, captureId, queued: true }
  } catch (e) {
    return { ok: false, error: message(e) }
  }
}

/** live 파일 경로 — 화면이 기록 id를 먼저 받아야 해서 «빈 기록 저장 → 파일 올리기 → 파일 등록» 순서다. */
export async function registerMemoryAssetAction(captureId: string, asset: { path: string; name: string; type: string; size: number }): Promise<{ ok: boolean; error?: string }> {
  const g = await gate()
  if (!g) return { ok: false, error: DENIED }
  if (!asset.path.startsWith(`${g.userId}/${captureId}/`) || !(asset.size > 0 && asset.size <= MAX_FILE)) return { ok: false, error: '파일 경로가 틀렸습니다.' }
  try {
    await g.repo.addMemoryAsset(captureId, { path: asset.path, name: asset.name.slice(0, 200), type: asset.type || 'application/octet-stream', size: asset.size, kind: kindOf(asset.name, asset.type) })
    after(async () => {
      await runOne(g.repo, captureId).catch(() => {})
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: message(e) }
  }
}

/** 상태 한 줄(빠른 기록 창이 «분석 중 → 준비됨»을 보인다). */
export async function memoryStatusAction(captureId: string): Promise<{ status: string; reviews: number } | null> {
  const g = await gate()
  if (!g) return null
  const d = await g.repo.getMemoryCapture(captureId).catch(() => null)
  if (!d) return null
  return { status: d.capture.processing_status, reviews: d.reviews.filter((r) => r.status === 'open').length }
}

/** 남은 일 처리 — 기억 화면을 열 때 화면이 한 번 부른다(대기 · 실패 중 다음 시도 시각이 지난 것, 최대 3개 · 40초). */
export async function processPendingMemory(): Promise<{ processed: number }> {
  const g = await gate()
  if (!g) return { processed: 0 }
  const out = await processDue(g.repo, { allowAi: await aiAllowed(g.repo), extractor: currentExtractor(), logAiUsage: (u) => g.repo.logAiUsage(u), max: 3, deadlineMs: 40_000 }).catch(() => [])
  if (out.length) revalidatePath('/memory')
  return { processed: out.filter((o) => o.kind === 'done').length }
}

/** «다시 처리» — 원본 · 앞 결과는 그대로 두고 다시 돌린다(같은 결과는 겹치지 않는다). */
export async function reprocessMemoryAction(captureId: string): Promise<{ ok: boolean; error?: string; status?: string }> {
  const g = await gate()
  if (!g) return { ok: false, error: DENIED }
  try {
    await g.repo.requeueMemory(captureId)
    const out = await runOne(g.repo, captureId)
    revalidatePath(`/memory/${captureId}`)
    revalidatePath('/memory')
    if (out.kind === 'failed') return { ok: false, error: `처리 실패 — 원본은 그대로입니다. (${out.error.slice(0, 120)})` }
    return { ok: true, status: out.kind === 'done' ? out.result.status : 'processing' }
  } catch (e) {
    return { ok: false, error: message(e) }
  }
}

export async function resolveMemoryReviewAction(reviewId: string, action: ReviewAction, data: Record<string, unknown> = {}): Promise<{ ok: boolean; error?: string; result?: Record<string, unknown> }> {
  const g = await gate()
  if (!g) return { ok: false, error: DENIED }
  if (!['confirm', 'edit', 'reject', 'link', 'create_entity'].includes(action)) return { ok: false, error: '요청 모양이 틀렸습니다.' }
  const clean: Record<string, unknown> = {}
  for (const k of ['target_type', 'target_id', 'display_name', 'entity_type', 'content', 'due_date', 'project_id', 'owner_user_id', 'title', 'alias']) {
    const v = data[k]
    if (typeof v === 'string' && v.trim()) clean[k] = v.trim().slice(0, k === 'content' || k === 'title' ? 2000 : 120)
  }
  if (clean.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(clean.due_date))) return { ok: false, error: '날짜 모양이 틀렸습니다(YYYY-MM-DD).' }
  try {
    const result = await g.repo.resolveMemoryReview(reviewId, action, clean)
    revalidatePath('/memory')
    revalidatePath('/memory/review')
    return { ok: true, result }
  } catch (e) {
    return { ok: false, error: message(e) }
  }
}

/** 정보 상태(끝남 · 취소 · 보류 · 다시 열기 · 확정) — 이력 한 줄. */
export async function setMemoryItemAction(itemId: string, patch: { lifecycle_status?: string; verification_status?: string }, reason: string): Promise<{ ok: boolean; error?: string }> {
  const g = await gate()
  if (!g) return { ok: false, error: DENIED }
  const p: Record<string, unknown> = {}
  if (patch.lifecycle_status && ['open', 'done', 'cancelled', 'on_hold'].includes(patch.lifecycle_status)) p.lifecycle_status = patch.lifecycle_status
  if (patch.verification_status && ['confirmed', 'rejected', 'draft'].includes(patch.verification_status)) p.verification_status = patch.verification_status
  if (!Object.keys(p).length) return { ok: false, error: '바꿀 것이 없습니다.' }
  try {
    await g.repo.setMemoryItem(itemId, p, reason.slice(0, 300) || '대표가 상태를 바꿈')
    revalidatePath('/memory')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: message(e) }
  }
}

function safeName(name: string): string {
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0]?.toLowerCase() ?? ''
  const base = name.slice(0, name.length - ext.length).replace(/[^A-Za-z0-9가-힣_-]+/g, '_').replace(/^\.+/, '').slice(0, 60) || 'file'
  return `${Date.now().toString(36)}_${base}${ext}`
}

function kindOf(name: string, type: string): 'audio' | 'document' | 'image' | 'other' {
  if (/^audio\//.test(type) || /\.(m4a|mp3|wav|aac|ogg|webm|amr|3gp)$/i.test(name)) return 'audio'
  if (/^image\//.test(type) || /\.(png|jpe?g|heic|webp|gif)$/i.test(name)) return 'image'
  if (/\.(pdf|docx|xlsx|pptx|txt|md|csv|eml)$/i.test(name)) return 'document'
  return 'other'
}
