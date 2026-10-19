import 'server-only'

import type { AiUsageInput } from '@/types/attachment'

import { extractAttachment } from '@/lib/attachments/extract'
import { ATTACHMENT_MIME } from '@/lib/attachments/rules'
import { detectMixRatio } from '@/lib/intake/mix-ratio'

import { flattenKakaoExport } from './adapters'
import { MEMORY_PROMPT_VERSION, type MemoryExtractor } from './ai'
import { buildPayload, PROMPT_VERSION_RULE } from './build'
import { findMentions } from './match'
import { ruleExtract, type ExtractResult } from './rules'
import type { MemoryMethods } from './store'
import type { ApplyResult, LinkTargetType, MemoryAsset } from './types'

/**
 * 기억 엔진 처리 한 번(지시문 4절 Step 1~7) — 저장 직후 서버 액션이 부르고, 실패 · 남은 일은 대표 세션이 다시 부른다(processDue).
 *
 *   1 큐 잡기(이미 돌면 건너뜀) → 2 원본 + 파일 글(문서만 · 배합비로 보이면 건너뜀 · 음성은 전사 대기) →
 *   3 뽑기: AI(하루 한도 안 · 키 있음) 또는 규칙 → 4 이름 맞추기 · 앞 정보 찾기 · 바뀜 찾기 → 5 한 트랜잭션으로 넣기(memory_apply).
 *   어느 단계든 실패하면 memory_fail — 원본은 그대로, 상태 «실패», 다음 시도는 1 · 4 · 16 · 60분 뒤.
 *   AI가 세 번 연속 실패하면 네 번째부터는 규칙으로 처리한다(원본이 영영 «실패»에 머물지 않게 — 처리 이력에 남는다).
 */

export interface ProcessOptions {
  /** AI를 써도 되나(하루 한도 · 스위치 — 부르는 쪽이 정한다) */
  allowAi: boolean
  extractor: MemoryExtractor | null
  logAiUsage?: (u: AiUsageInput) => Promise<void>
}

export type ProcessOutcome =
  | { kind: 'done'; result: ApplyResult; engine: 'ai' | 'rule' | 'mock' }
  | { kind: 'skipped'; reason: 'running' | 'missing' }
  | { kind: 'failed'; error: string }

type Repo = MemoryMethods

const AI_FAILS_BEFORE_RULES = 3
const FILE_TEXT_MAX = 60000

function mimeOf(a: MemoryAsset): string | null {
  const n = a.file_name.toLowerCase()
  if (n.endsWith('.pdf')) return ATTACHMENT_MIME.pdf
  if (n.endsWith('.docx')) return ATTACHMENT_MIME.docx
  if (n.endsWith('.xlsx')) return ATTACHMENT_MIME.xlsx
  if (n.endsWith('.pptx')) return ATTACHMENT_MIME.pptx
  if (/\.(txt|md|csv|eml)$/.test(n)) return 'text/plain'
  return null
}

/** 문서 파일 → 글. 배합비 · BOM으로 보이면 넣지 않는다(원가 숫자는 기억 경로에 넣지 않음). */
async function assetText(repo: Repo, a: MemoryAsset): Promise<{ text: string | null; status: 'extracted' | 'skipped' | 'failed' | 'waiting_transcript' }> {
  if (a.kind === 'audio') return { text: null, status: 'waiting_transcript' }
  const mime = mimeOf(a)
  if (!mime) return { text: null, status: 'skipped' }
  try {
    const bytes = await repo.readMemoryFile(a.storage_path)
    let units: string[]
    if (mime === 'text/plain') {
      const t = new TextDecoder('utf-8').decode(bytes)
      units = [/카카오톡|KakaoTalk/.test(t.slice(0, 400)) ? flattenKakaoExport(t) : t]
    } else {
      const ex = await extractAttachment(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, mime)
      if (ex.kind !== 'text') return { text: null, status: 'skipped' } // 스캔 PDF · 사진은 Phase 2(읽기 AI)
      units = ex.units
    }
    if (detectMixRatio(units).hit) return { text: null, status: 'skipped' }
    return { text: units.join('\n\n').slice(0, FILE_TEXT_MAX), status: 'extracted' }
  } catch {
    return { text: null, status: 'failed' }
  }
}

export async function processCapture(repo: Repo, captureId: string, opts: ProcessOptions): Promise<ProcessOutcome> {
  const attempt = await repo.claimMemoryJob(captureId)
  if (attempt === null) return { kind: 'skipped', reason: 'running' }
  let engine: 'ai' | 'rule' | 'mock' = 'rule'
  let model: string | null = null
  try {
    const detail = await repo.getMemoryCapture(captureId)
    if (!detail) return { kind: 'skipped', reason: 'missing' }
    const { capture, assets } = detail

    // 2 — 원본 + 파일 글
    const parts: string[] = [capture.raw_text]
    let audioOnly = false
    for (const a of assets) {
      if (a.processing_status === 'skipped') continue
      const r = await assetText(repo, a)
      if (r.status !== a.processing_status) await repo.setMemoryAssetStatus(a.asset_id, r.status, r.text?.length ?? null)
      if (r.text) parts.push(`[파일: ${a.file_name}]\n${r.text}`)
    }
    const text = parts.filter((p) => p.trim()).join('\n\n').trim()
    if (!text && assets.some((a) => a.kind === 'audio')) audioOnly = true

    // 3 — 뽑기
    let extract: ExtractResult
    const useAi = !!opts.extractor && opts.allowAi && !!text && attempt <= AI_FAILS_BEFORE_RULES
    if (useAi) {
      engine = opts.extractor!.engine
      model = opts.extractor!.model
      extract = await opts.extractor!.extract(text, { capturedAt: capture.captured_at, type: capture.capture_type }, async (u) => {
        await opts.logAiUsage?.({ feature: 'memory_extract', ...u, entity_table: 'memory_captures', entity_id: captureId })
      })
    } else {
      engine = 'rule'
      model = null
      extract = text ? ruleExtract(text) : { summary: null, categories: ['other'], entities: [], items: [] }
    }

    // 4 — 이름 맞추기 · 앞 정보
    const directory = await repo.memoryDirectory()
    const mentions = text ? findMentions(text, directory) : []
    const targets: { target_type: LinkTargetType; target_id: string }[] = []
    for (const m of mentions) {
      if (m.target) targets.push({ target_type: m.target.target_type, target_id: m.target.target_id })
      if (m.entityName) targets.push({ target_type: 'entity', target_id: `name:${m.entityName}` })
    }
    const prior = targets.length > 0 ? await repo.memoryPriorItems(captureId, targets) : []

    // 5 — 넣기
    const payload = buildPayload({
      captureId,
      rawText: text,
      capturedAt: capture.captured_at,
      extract,
      engine,
      model,
      promptVersion: engine === 'rule' ? PROMPT_VERSION_RULE : MEMORY_PROMPT_VERSION,
      directory,
      prior,
      waitingTranscript: audioOnly,
      stats: { attempt, files: assets.length, ...(useAi ? {} : { ai: opts.allowAi ? (attempt > AI_FAILS_BEFORE_RULES ? 'ai_failed_3x' : 'no_key') : 'off_or_limit' }) },
    })
    const result = await repo.applyMemory(captureId, payload)
    return { kind: 'done', result, engine }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await repo.failMemory(captureId, msg.slice(0, 500), engine, model).catch(() => {})
    return { kind: 'failed', error: msg }
  }
}

/** 남은 일 — 대기 · 실패(다음 시도 시각이 지난 것)를 몇 개 처리한다. 대표 세션에서만 돈다(AI Agent는 기억을 못 읽는다). */
export async function processDue(repo: Repo, opts: ProcessOptions & { max?: number; deadlineMs?: number }): Promise<ProcessOutcome[]> {
  const started = Date.now()
  const ids = await repo.dueMemoryJobs(opts.max ?? 3)
  const out: ProcessOutcome[] = []
  for (const id of ids) {
    if (opts.deadlineMs && Date.now() - started > opts.deadlineMs) break
    out.push(await processCapture(repo, id, opts))
  }
  return out
}
