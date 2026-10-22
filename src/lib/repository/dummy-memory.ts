import { createHash, randomUUID } from 'node:crypto'

import { assemblePrior, splitTargets } from '@/lib/memory/prior'
import type { MemoryMethods } from '@/lib/memory/store'
import type {
  ApplyPayload,
  LinkTargetType,
  MemoryAsset,
  MemoryCaptureRow,
  MemoryDirectory,
  MemoryEntity,
  MemoryItem,
  MemoryLink,
  MemoryReview,
  MemoryRevision,
  MemoryRun,
  MemorySearchHit,
  MemoryTargetName,
  ProcessingStatus,
} from '@/lib/memory/types'
import type { UserAccount } from '@/types/access'

/**
 * 0088 기억 엔진의 dummy 자리. **DB(0088)가 막는 것을 여기서도 막는다**: 주인 본인 · 대표 · 스위치(memory_me 거울) —
 * 아니면 읽기 0행 · 쓰기 'memory_denied'. 중복 열쇠(dedupe_key = md5(기록:종류:정규화 내용)) · 앞 초안 superseded ·
 * 검토 처리 · 이력은 memory_apply · memory_review_resolve와 같은 규칙이다. 저장은 서버가 살아 있는 동안만(globalThis).
 */

interface Store {
  captures: (MemoryCaptureRow & { owner_id: string; client_key: string; archived_at: string | null })[]
  assets: (MemoryAsset & { owner_id: string })[]
  items: (MemoryItem & { owner_id: string; dedupe_key: string })[]
  links: (MemoryLink & { owner_id: string })[]
  entities: (MemoryEntity & { owner_id: string })[]
  aliases: { owner_id: string; entity_type: 'business' | 'project' | 'person' | 'entity'; entity_id: string; alias: string; verification_status: 'suggested' | 'confirmed' | 'rejected' }[]
  reviews: (MemoryReview & { owner_id: string; dedupe_key: string })[]
  runs: (MemoryRun & { owner_id: string; capture_id: string })[]
  revisions: (MemoryRevision & { owner_id: string })[]
  jobs: Map<string, { status: 'queued' | 'running' | 'done' | 'failed'; attempts: number; next_at: string; locked_at: string | null; last_error: string | null }>
  files: Map<string, Uint8Array>
  tasks: { task_id: string; project_id: string; title: string; deadline: string | null }[]
  seeded: boolean
}

const g = globalThis as { __dummyMemory?: Store }
function store(): Store {
  return (g.__dummyMemory ??= {
    captures: [], assets: [], items: [], links: [], entities: [], aliases: [], reviews: [], runs: [], revisions: [],
    jobs: new Map(), files: new Map(), tasks: [], seeded: false,
  })
}
export function resetDummyMemory(): void {
  delete g.__dummyMemory
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}·«»“”‘’]+/gu, '')
const now = () => new Date().toISOString()
/** 줄에서 안 보일 칸(주인 · 열쇠)을 뺀 사본 */
function omit<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const r = { ...o }
  for (const k of keys) delete r[k]
  return r
}

export interface DummyMemoryDeps {
  viewer: () => UserAccount
  featureOn: () => Promise<boolean>
  businesses: () => Promise<{ business_id: string; name: string }[]>
  projects: () => Promise<{ project_id: string; name: string; business_id: string }[]>
  people: () => UserAccount[]
}

/** dummy 시드 — 대표 화면을 처음 열면 처리 전 기록 셋이 있다(열면 규칙 엔진이 처리한다 — Case A · B · F 모양). */
function seed(st: Store, owner: string) {
  if (st.seeded) return
  st.seeded = true
  const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString()
  const add = (key: string, text: string, at: string, title: string | null = null) => {
    const id = randomUUID()
    st.captures.push({ capture_id: id, owner_id: owner, client_key: key, capture_type: 'note', title, raw_text: text, captured_at: at, created_at: at, processing_status: 'saved', summary: null, categories: [], metadata: { example: true }, archived_at: null })
    st.jobs.set(id, { status: 'queued', attempts: 0, next_at: at, locked_at: null, last_error: null })
  }
  add('seed-memory-b1', 'A회사와 미팅했다. A회사는 11월 납품을 약속했다.', day(21), '[예시] A회사 미팅')
  add('seed-memory-a', '오늘 베트남 법인 영업 상황을 점검했다. SB 고객 8개사 관리 담당자를 다시 정해야 한다.', day(2), '[예시] 베트남 법인 영업 점검')
  add('seed-memory-b2', 'A회사와 다시 미팅했다. 납기가 12월로 변경될 가능성이 있다.', day(1), '[예시] A회사 재미팅')
  add('seed-memory-f', '방 사장에게 전달했다. 이 부장이 방문한 뒤 결정하기로 했다.', day(0), '[예시] 전달')
}

export function dummyMemory(deps: DummyMemoryDeps): MemoryMethods {
  const allowed = async () => {
    const v = deps.viewer()
    return v.role === 'Chairman' && !v.revoked_at && (await deps.featureOn())
  }
  const me = async (): Promise<string | null> => {
    if (!(await allowed())) return null
    const v = deps.viewer()
    seed(store(), v.user_id)
    return v.user_id
  }
  const must = async () => {
    const id = await me()
    if (!id) throw new Error('memory_denied')
    return id
  }
  const ownCapture = async (captureId: string) => {
    const owner = await must()
    const c = store().captures.find((x) => x.capture_id === captureId && x.owner_id === owner)
    if (!c) throw new Error('memory_denied')
    return c
  }
  const strip = <T extends { owner_id: string }>(r: T) => omit(r, 'owner_id')
  const recount = (captureId: string, hint?: string | null) => {
    const st = store()
    const c = st.captures.find((x) => x.capture_id === captureId)!
    const open = st.reviews.some((r) => r.capture_id === captureId && r.status === 'open')
    c.processing_status = (hint === 'waiting_transcript' ? 'waiting_transcript' : open ? 'needs_review' : 'ready') as ProcessingStatus
  }
  const itemSet = (owner: string, itemId: string, patch: Record<string, unknown>, reason: string) => {
    const st = store()
    const it = st.items.find((i) => i.item_id === itemId && i.owner_id === owner)
    if (!it) throw new Error('memory_denied')
    if (!reason.trim()) throw new Error('memory_reason_required')
    const prev = { content: it.content, lifecycle_status: it.lifecycle_status, verification_status: it.verification_status, due_date: it.due_date, direction: it.direction }
    if (typeof patch.lifecycle_status === 'string') it.lifecycle_status = patch.lifecycle_status as MemoryItem['lifecycle_status']
    if (typeof patch.verification_status === 'string') it.verification_status = patch.verification_status as MemoryItem['verification_status']
    if (typeof patch.content === 'string' && patch.content.trim()) it.content = patch.content.trim()
    if ('due_date' in patch) it.due_date = (patch.due_date as string | null) || null
    if (typeof patch.direction === 'string') it.direction = patch.direction as MemoryItem['direction']
    it.updated_at = now()
    st.revisions.push({
      revision_id: st.revisions.length + 1, owner_id: owner, item_id: itemId, link_id: null, previous_version: prev,
      new_version: { content: it.content, lifecycle_status: it.lifecycle_status, verification_status: it.verification_status, due_date: it.due_date, direction: it.direction },
      change_reason: reason.slice(0, 300), changed_at: now(),
    })
  }
  const entityFor = (owner: string, type: MemoryEntity['entity_type'], name: string, captureId: string) => {
    const st = store()
    let e = st.entities.find((x) => x.owner_id === owner && x.entity_type === type && x.display_name.trim().toLowerCase() === name.trim().toLowerCase())
    if (!e) {
      e = { entity_id: randomUUID(), owner_id: owner, entity_type: type, display_name: name.trim(), status: 'pending' }
      st.entities.push(e)
      void captureId
    }
    return e.entity_id
  }

  return {
    async saveMemoryCapture(input) {
      const owner = await must()
      const st = store()
      const old = st.captures.find((c) => c.owner_id === owner && c.client_key === input.clientKey)
      if (old) return old.capture_id
      if (!input.rawText.trim() && !['voice', 'file', 'meeting', 'online_meeting', 'phone_call'].includes(input.type)) throw new Error('memory_empty')
      const id = randomUUID()
      const at = input.capturedAt && Math.abs(Date.parse(input.capturedAt) - Date.now()) < 30 * 86400_000 ? input.capturedAt : now()
      st.captures.unshift({ capture_id: id, owner_id: owner, client_key: input.clientKey, capture_type: input.type, title: input.title?.trim() || null, raw_text: input.rawText, captured_at: at, created_at: now(), processing_status: 'saved', summary: null, categories: [], metadata: input.metadata ?? {}, archived_at: null })
      st.jobs.set(id, { status: 'queued', attempts: 0, next_at: now(), locked_at: null, last_error: null })
      st.runs.push({ run_id: randomUUID(), owner_id: owner, capture_id: id, processing_stage: 'ingest', status: 'done', engine: 'rule', model: null, prompt_version: null, attempt_count: 1, error_details: null, stats: { chars: input.rawText.length }, created_at: now() })
      return id
    },
    async addMemoryAsset(captureId, f) {
      const c = await ownCapture(captureId)
      if (!f.path.startsWith(`${c.owner_id}/${captureId}/`) || f.path.includes('/../')) throw new Error('memory_bad_path')
      const st = store()
      const old = st.assets.find((a) => a.storage_path === f.path)
      if (old) return old.asset_id
      const id = randomUUID()
      st.assets.push({ asset_id: id, owner_id: c.owner_id, capture_id: captureId, storage_path: f.path, file_name: f.name, file_type: f.type, file_size: f.size, kind: f.kind, processing_status: f.kind === 'audio' ? 'waiting_transcript' : 'stored', extracted_chars: null, created_at: now() })
      const job = st.jobs.get(captureId)
      if (job && job.status !== 'running') Object.assign(job, { status: 'queued', next_at: now() })
      return id
    },
    async setMemoryAssetStatus(assetId, status, chars) {
      const owner = await must()
      const a = store().assets.find((x) => x.asset_id === assetId && x.owner_id === owner)
      if (!a) throw new Error('memory_denied')
      a.processing_status = status
      if (chars !== undefined && chars !== null) a.extracted_chars = chars
    },
    async putMemoryFile(path, bytes) {
      const owner = await must()
      if (!path.startsWith(`${owner}/`)) throw new Error('memory_denied')
      if (store().files.has(path)) throw new Error('memory_file_exists')
      store().files.set(path, bytes)
    },
    async readMemoryFile(path) {
      const owner = await must()
      const b = path.startsWith(`${owner}/`) ? store().files.get(path) : undefined
      if (!b) throw new Error('memory_file_missing')
      return b
    },
    async memoryFileUrl() {
      return null
    },
    async getMemoryCapture(captureId) {
      const owner = await me()
      if (!owner) return null
      const st = store()
      const c = st.captures.find((x) => x.capture_id === captureId && x.owner_id === owner)
      if (!c) return null
      const items = st.items.filter((i) => i.capture_id === captureId)
      const links = st.links.filter((l) => l.capture_id === captureId)
      const job = st.jobs.get(captureId)
      return {
        capture: omit(c, 'owner_id', 'client_key', 'archived_at'),
        assets: st.assets.filter((a) => a.capture_id === captureId).map(strip),
        items: items.map((i) => omit(i, 'owner_id', 'dedupe_key')),
        links: links.map(strip),
        reviews: st.reviews.filter((r) => r.capture_id === captureId).map((r) => omit(r, 'owner_id', 'dedupe_key')),
        runs: st.runs.filter((r) => r.capture_id === captureId).map((r) => omit(r, 'owner_id', 'capture_id')),
        revisions: st.revisions.filter((r) => items.some((i) => i.item_id === r.item_id) || links.some((l) => l.link_id === r.link_id)).map(strip),
        job: job ? { status: job.status, attempts: job.attempts, next_at: job.next_at, last_error: job.last_error } : null,
      }
    },
    async listMemoryCaptures(opts = {}) {
      const owner = await me()
      if (!owner) return []
      const st = store()
      let rows = st.captures.filter((c) => c.owner_id === owner && !c.archived_at)
      if (opts.targetType && opts.targetId) {
        const ids = new Set(st.links.filter((l) => l.owner_id === owner && l.target_type === opts.targetType && l.target_id === opts.targetId && l.verification_status !== 'rejected').map((l) => l.capture_id))
        rows = rows.filter((c) => ids.has(c.capture_id))
      }
      if (opts.status?.length) rows = rows.filter((c) => opts.status!.includes(c.processing_status))
      if (opts.from) rows = rows.filter((c) => c.captured_at >= `${opts.from}T00:00:00+09:00` || c.captured_at.slice(0, 10) >= opts.from!)
      if (opts.to) rows = rows.filter((c) => c.captured_at.slice(0, 10) <= opts.to!)
      if (opts.since) rows = rows.filter((c) => c.captured_at >= opts.since!)
      return rows
        .sort((a, b) => b.captured_at.localeCompare(a.captured_at))
        .slice(0, opts.limit ?? 50)
        .map((c) => omit(c, 'owner_id', 'client_key', 'archived_at'))
    },
    async claimMemoryJob(captureId) {
      await ownCapture(captureId)
      const st = store()
      const job = st.jobs.get(captureId) ?? { status: 'queued' as const, attempts: 0, next_at: now(), locked_at: null, last_error: null }
      st.jobs.set(captureId, job)
      if (job.status === 'running' && job.locked_at && Date.now() - Date.parse(job.locked_at) < 600_000) return null
      Object.assign(job, { status: 'running', attempts: Math.min(job.attempts + 1, 100), locked_at: now() })
      st.captures.find((c) => c.capture_id === captureId)!.processing_status = 'processing'
      return job.attempts
    },
    async applyMemory(captureId, payload: ApplyPayload) {
      const c = await ownCapture(captureId)
      const owner = c.owner_id
      const st = store()
      const job = st.jobs.get(captureId)
      for (const r of payload.runs) {
        st.runs.push({ run_id: randomUUID(), owner_id: owner, capture_id: captureId, processing_stage: r.stage, status: r.status, engine: r.engine, model: r.model ?? null, prompt_version: r.prompt_version ?? null, attempt_count: Math.max(job?.attempts ?? 1, 1), error_details: r.error ?? null, stats: r.stats ?? {}, created_at: now() })
      }
      const refs = new Map<string, string>()
      const keys: string[] = []
      let newItems = 0
      for (const it of payload.items) {
        const key = md5(`${captureId}:${it.memory_type}:${norm(it.content)}`)
        keys.push(key)
        let row = st.items.find((x) => x.owner_id === owner && x.dedupe_key === key)
        if (!row) {
          row = { item_id: randomUUID(), owner_id: owner, capture_id: captureId, dedupe_key: key, memory_type: it.memory_type, content: it.content.trim(), source_quote: it.source_quote, speaker_label: it.speaker_label, direction: it.direction, who_text: it.who_text, to_text: it.to_text, due_date: it.due_date, due_text: it.due_text, amount_text: it.amount_text, event_time: it.event_time, confidence: it.confidence, verification_status: 'draft', lifecycle_status: 'open', origin: it.origin, created_at: now(), updated_at: now() }
          st.items.push(row)
          newItems++
        } else if (row.verification_status === 'draft' && row.lifecycle_status === 'superseded' && !st.revisions.some((r) => r.item_id === row!.item_id)) {
          row.lifecycle_status = 'open'
          for (const q of st.reviews) if (q.item_id === row.item_id && q.status === 'rejected' && q.resolution?.auto === 'superseded_by_reprocess') Object.assign(q, { status: 'open', resolution: null, resolved_at: null })
        }
        refs.set(it.ref, row.item_id)
      }
      for (const i of st.items) {
        if (i.capture_id === captureId && i.verification_status === 'draft' && i.origin !== 'manual' && i.lifecycle_status === 'open' && !keys.includes(i.dedupe_key) && !st.revisions.some((r) => r.item_id === i.item_id)) i.lifecycle_status = 'superseded'
      }
      for (const q of st.reviews) {
        const it = q.item_id ? st.items.find((i) => i.item_id === q.item_id) : undefined
        if (q.capture_id === captureId && q.status === 'open' && it && it.lifecycle_status === 'superseded' && it.verification_status === 'draft') Object.assign(q, { status: 'rejected', resolution: { auto: 'superseded_by_reprocess' }, resolved_at: now() })
      }
      const linkRefs: string[] = []
      let newLinks = 0
      for (const l of payload.links) {
        const target = l.target_type === 'entity' && !l.target_id ? entityFor(owner, l.entity_type ?? 'other', l.display_name ?? '?', captureId) : l.target_id!
        const itemId = l.item_ref ? (refs.get(l.item_ref) ?? null) : null
        let row = st.links.find((x) => x.owner_id === owner && x.capture_id === captureId && x.item_id === itemId && x.target_type === l.target_type && x.target_id === target && x.relationship === l.relationship)
        if (!row) {
          row = { link_id: randomUUID(), owner_id: owner, capture_id: captureId, item_id: itemId, target_type: l.target_type, target_id: target, relationship: l.relationship, verification_status: (l.target_type === 'business' || l.target_type === 'project') && l.verification_status === 'confirmed' ? 'confirmed' : 'suggested', confidence: l.confidence, mention_text: l.mention_text }
          st.links.push(row)
          newLinks++
        }
        linkRefs.push(row.link_id)
      }
      let newReviews = 0
      for (const r of payload.reviews) {
        const key = md5(`${captureId}:${r.review_type}:${r.key}:${r.related_item_id ?? ''}`)
        if (st.reviews.some((x) => x.owner_id === owner && x.dedupe_key === key)) continue
        st.reviews.push({ review_id: randomUUID(), owner_id: owner, dedupe_key: key, review_type: r.review_type, title: r.title.slice(0, 300), proposed_change: r.proposed_change, capture_id: captureId, item_id: r.item_ref ? (refs.get(r.item_ref) ?? null) : null, related_item_id: r.related_item_id, link_id: r.link_ref !== null ? (linkRefs[Number(r.link_ref)] ?? null) : null, priority: r.priority, status: 'open', resolution: null, created_at: now(), resolved_at: null })
        newReviews++
      }
      if (payload.summary) c.summary = payload.summary
      if (payload.categories.length) c.categories = payload.categories
      recount(captureId, payload.status_hint)
      if (job) Object.assign(job, { status: 'done', attempts: 0, locked_at: null, last_error: null })
      return { status: c.processing_status, new_items: newItems, new_links: newLinks, new_reviews: newReviews }
    },
    async failMemory(captureId, message, engine, model) {
      const c = await ownCapture(captureId)
      const st = store()
      const job = st.jobs.get(captureId)
      const att = job?.attempts ?? 1
      if (job) Object.assign(job, { status: 'failed', locked_at: null, last_error: message.slice(0, 500), next_at: new Date(Date.now() + Math.min(4 ** Math.max(att - 1, 0), 60) * 60_000).toISOString() })
      c.processing_status = 'failed'
      st.runs.push({ run_id: randomUUID(), owner_id: c.owner_id, capture_id: captureId, processing_stage: 'extract', status: 'failed', engine, model, prompt_version: null, attempt_count: Math.max(att, 1), error_details: message.slice(0, 500), stats: {}, created_at: now() })
    },
    async requeueMemory(captureId) {
      await ownCapture(captureId)
      const job = store().jobs.get(captureId)
      if (!job) store().jobs.set(captureId, { status: 'queued', attempts: 0, next_at: now(), locked_at: null, last_error: null })
      else if (job.status !== 'running' || (job.locked_at && Date.now() - Date.parse(job.locked_at) > 600_000)) Object.assign(job, { status: 'queued', next_at: now() })
    },
    async dueMemoryJobs(limit) {
      const owner = await me()
      if (!owner) return []
      const st = store()
      return [...st.jobs.entries()]
        .filter(([id, j]) => (j.status === 'queued' || j.status === 'failed') && j.next_at <= now() && st.captures.some((c) => c.capture_id === id && c.owner_id === owner))
        .sort((a, b) => a[1].next_at.localeCompare(b[1].next_at))
        .slice(0, limit)
        .map(([id]) => id)
    },
    async memoryDirectory(): Promise<MemoryDirectory> {
      const owner = await must()
      const st = store()
      return {
        businesses: await deps.businesses(),
        projects: await deps.projects(),
        people: deps.people().filter((p) => !p.revoked_at && p.role !== 'AIAgent' && p.role !== 'Integration').map((p) => ({ user_id: p.user_id, display_name: p.display_name, display_name_en: p.display_name_en, title_ko: p.title_ko })),
        aliases: st.aliases.filter((a) => a.owner_id === owner).map(strip),
        entities: st.entities.filter((e) => e.owner_id === owner && e.status !== 'rejected').map(strip),
      }
    },
    async memoryPriorItems(captureId, targets) {
      const owner = await must()
      const st = store()
      const { ids, names } = splitTargets(targets)
      const entIds = st.entities.filter((e) => e.owner_id === owner && names.includes(e.display_name.trim().toLowerCase())).map((e) => e.entity_id)
      const all = [...ids, ...entIds.map((id) => ({ target_type: 'entity' as LinkTargetType, target_id: id }))]
      const caps = new Set(st.links.filter((l) => l.owner_id === owner && l.verification_status !== 'rejected' && all.some((t) => t.target_type === l.target_type && t.target_id === l.target_id)).map((l) => l.capture_id))
      caps.delete(captureId)
      return assemblePrior(captureId, {
        links: st.links.filter((l) => caps.has(l.capture_id)),
        items: st.items.filter((i) => caps.has(i.capture_id) && ['open', 'superseded'].includes(i.lifecycle_status) && i.verification_status !== 'rejected').map((i) => omit(i, 'owner_id', 'dedupe_key')),
        entities: st.entities.filter((e) => e.owner_id === owner),
        capturedAt: new Map(st.captures.map((c) => [c.capture_id, c.captured_at])),
      })
    },
    async searchMemory(params) {
      const owner = await me()
      if (!owner) return []
      const st = store()
      const words = params.query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
      const has = (s: string) => words.every((w) => s.toLowerCase().includes(w))
      let caps = st.captures.filter((c) => c.owner_id === owner && !c.archived_at)
      if (params.from) caps = caps.filter((c) => c.captured_at.slice(0, 10) >= params.from!)
      if (params.to) caps = caps.filter((c) => c.captured_at.slice(0, 10) <= params.to!)
      if (params.targetType && params.targetId) {
        const ids = new Set(st.links.filter((l) => l.target_type === params.targetType && l.target_id === params.targetId && l.verification_status !== 'rejected').map((l) => l.capture_id))
        caps = caps.filter((c) => ids.has(c.capture_id))
      }
      const out: MemorySearchHit[] = []
      if (!params.type) {
        for (const c of caps) if (has(`${c.title ?? ''} ${c.raw_text} ${c.summary ?? ''}`)) out.push({ kind: 'capture', capture_id: c.capture_id, item_id: null, memory_type: null, capture_type: c.capture_type, title: c.title ?? c.raw_text.slice(0, 60), snippet: (c.summary ?? c.raw_text).slice(0, 240), captured_at: c.captured_at, due_date: null, lifecycle_status: null, verification_status: null, score: 0.5 })
      }
      for (const i of st.items) {
        const c = caps.find((x) => x.capture_id === i.capture_id)
        if (!c || i.verification_status === 'rejected' || (params.type && i.memory_type !== params.type)) continue
        if (has(`${i.content} ${i.source_quote ?? ''} ${i.who_text ?? ''} ${i.to_text ?? ''}`)) out.push({ kind: 'item', capture_id: i.capture_id, item_id: i.item_id, memory_type: i.memory_type, capture_type: c.capture_type, title: i.content.slice(0, 120), snippet: (i.source_quote ?? i.content).slice(0, 240), captured_at: c.captured_at, due_date: i.due_date, lifecycle_status: i.lifecycle_status, verification_status: i.verification_status, score: 0.6 })
      }
      return out.sort((a, b) => b.score - a.score || b.captured_at.localeCompare(a.captured_at)).slice(0, params.limit ?? 30)
    },
    async listMemoryReviews(opts = {}) {
      const owner = await me()
      if (!owner) return []
      return store()
        .reviews.filter((r) => r.owner_id === owner && (opts.status === 'closed' ? r.status !== 'open' : r.status === 'open') && (!opts.captureId || r.capture_id === opts.captureId))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, opts.limit ?? 100)
        .map((r) => omit(r, 'owner_id', 'dedupe_key'))
    },
    async resolveMemoryReview(reviewId, action, data) {
      const owner = await must()
      const st = store()
      const rv = st.reviews.find((r) => r.review_id === reviewId && r.owner_id === owner)
      if (!rv) throw new Error('memory_denied')
      if (rv.status !== 'open') throw new Error('memory_review_closed')
      if ((action === 'link' || action === 'create_entity') && rv.review_type !== 'entity_identity' && rv.review_type !== 'link_suggestion') throw new Error('memory_bad_action')
      const item = rv.item_id ? st.items.find((i) => i.item_id === rv.item_id) : undefined
      if (action !== 'reject' && item?.lifecycle_status === 'superseded' && ['task_candidate', 'financial', 'decision_check', 'date_ambiguous'].includes(rv.review_type)) throw new Error('memory_item_superseded')
      let status: MemoryReview['status'] = 'confirmed'
      let result: Record<string, unknown> = {}
      const linkRow = rv.link_id ? st.links.find((l) => l.link_id === rv.link_id) : undefined
      const addLink = (type: LinkTargetType, id: string, rel: MemoryLink['relationship'] = 'mentions') => {
        if (!st.links.some((l) => l.capture_id === rv.capture_id && l.item_id === rv.item_id && l.target_type === type && l.target_id === id && l.relationship === rel)) {
          st.links.push({ link_id: randomUUID(), owner_id: owner, capture_id: rv.capture_id, item_id: rv.item_id, target_type: type, target_id: id, relationship: rel, verification_status: 'confirmed', confidence: 1, mention_text: String(rv.proposed_change.mention ?? '') || null })
        }
      }
      if (action === 'reject') {
        status = 'rejected'
        if (linkRow) linkRow.verification_status = 'rejected'
      } else if (rv.review_type === 'entity_identity' || rv.review_type === 'link_suggestion') {
        if (action === 'link') {
          const type = data.target_type as LinkTargetType
          const id = String(data.target_id ?? '')
          if (!['business', 'project', 'person', 'entity'].includes(type) || !id) throw new Error('memory_bad_target')
          addLink(type, id)
          if (linkRow) linkRow.verification_status = linkRow.target_type === type && linkRow.target_id === id ? 'confirmed' : 'rejected'
          const alias = String(data.alias ?? rv.proposed_change.mention ?? '').trim()
          if (alias && !st.aliases.some((a) => a.owner_id === owner && a.entity_type === type && a.entity_id === id && a.alias.toLowerCase() === alias.toLowerCase())) {
            st.aliases.push({ owner_id: owner, entity_type: type === 'entity' ? 'entity' : (type as 'business' | 'project' | 'person'), entity_id: id, alias, verification_status: 'confirmed' })
          }
          status = 'linked'
        } else if (action === 'create_entity') {
          const name = String(data.display_name ?? '').trim()
          if (!name) throw new Error('memory_name_required')
          const id = entityFor(owner, (data.entity_type as MemoryEntity['entity_type']) ?? 'person', name, rv.capture_id)
          st.entities.find((e) => e.entity_id === id)!.status = 'confirmed'
          addLink('entity', id)
          if (linkRow && linkRow.target_id !== id) linkRow.verification_status = 'rejected'
          status = 'created'
          result = { entity_id: id }
        } else {
          if (!linkRow) throw new Error('memory_nothing_to_confirm')
          linkRow.verification_status = 'confirmed'
          const e = linkRow.target_type === 'entity' ? st.entities.find((x) => x.entity_id === linkRow.target_id) : undefined
          if (e && e.status === 'pending') e.status = 'confirmed'
        }
        st.revisions.push({ revision_id: st.revisions.length + 1, owner_id: owner, item_id: null, link_id: rv.link_id, previous_version: rv.proposed_change, new_version: { ...data, action }, change_reason: '검토함 — 신원 · 연결', changed_at: now() })
      } else if (rv.review_type === 'change_detected' || rv.review_type === 'conflict') {
        if (rv.related_item_id) itemSet(owner, rv.related_item_id, { lifecycle_status: 'superseded' }, '검토함 — 새 기록으로 바뀜 확인')
        if (rv.item_id) itemSet(owner, rv.item_id, { verification_status: 'confirmed', ...(action === 'edit' ? { content: data.content, due_date: data.due_date } : {}) }, '검토함 — 바뀜 확인')
        status = action === 'edit' ? 'edited' : 'confirmed'
      } else if (rv.review_type === 'task_candidate') {
        const project = String(data.project_id ?? rv.proposed_change.project_id ?? '').trim()
        if (!project || !(await deps.projects()).some((p) => p.project_id === project)) throw new Error('memory_project_required')
        const same = st.links.find((l) => l.owner_id === owner && l.target_type === 'task' && l.relationship === 'created_task' && st.tasks.some((t) => t.task_id === l.target_id && t.project_id === project) && norm(st.items.find((i) => i.item_id === l.item_id)?.content ?? '') === norm(item?.content ?? rv.title))
        let taskId = same?.target_id
        if (!taskId) {
          taskId = `t${new Date().toISOString().slice(2, 10).replace(/-/g, '')}_${md5(reviewId).slice(0, 10)}`
          st.tasks.push({ task_id: taskId, project_id: project, title: String(data.title ?? item?.content ?? rv.title).slice(0, 300), deadline: (data.due_date as string | undefined) ?? item?.due_date ?? null })
          result = { task_id: taskId, created: true }
        } else result = { task_id: taskId, created: false }
        addLink('task', taskId, 'created_task')
        if (rv.item_id) itemSet(owner, rv.item_id, { verification_status: 'confirmed' }, '검토함 — 업무로 등록')
        status = action === 'edit' ? 'edited' : 'confirmed'
      } else {
        if (rv.item_id) itemSet(owner, rv.item_id, { verification_status: 'confirmed', ...(action === 'edit' ? { content: data.content, due_date: data.due_date } : {}) }, '검토함 — 확인')
        status = action === 'edit' ? 'edited' : 'confirmed'
      }
      Object.assign(rv, { status, resolution: { ...data, action, ...result }, resolved_at: now() })
      const c = st.captures.find((x) => x.capture_id === rv.capture_id)!
      if (c.processing_status === 'needs_review' && !st.reviews.some((r) => r.capture_id === rv.capture_id && r.status === 'open')) c.processing_status = 'ready'
      return { status, ...result }
    },
    async setMemoryItem(itemId, patch, reason) {
      itemSet(await must(), itemId, patch, reason)
    },
    async listMemoryItems(filter = {}) {
      const owner = await me()
      if (!owner) return []
      const st = store()
      let caps = st.captures.filter((c) => c.owner_id === owner && !c.archived_at)
      if (filter.targetType && filter.targetId) {
        const ids = new Set(st.links.filter((l) => l.target_type === filter.targetType && l.target_id === filter.targetId && l.verification_status !== 'rejected').map((l) => l.capture_id))
        caps = caps.filter((c) => ids.has(c.capture_id))
      }
      const capMap = new Map(caps.map((c) => [c.capture_id, c]))
      return st.items
        .filter((i) => capMap.has(i.capture_id) && i.verification_status !== 'rejected')
        .filter((i) => !filter.types?.length || filter.types.includes(i.memory_type))
        .filter((i) => !filter.lifecycle?.length || filter.lifecycle.includes(i.lifecycle_status))
        .filter((i) => !filter.direction || i.direction === filter.direction)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, filter.limit ?? 100)
        .map((i) => ({ ...omit(i, 'owner_id', 'dedupe_key'), captured_at: capMap.get(i.capture_id)!.captured_at, capture_title: capMap.get(i.capture_id)!.title }))
    },
    async memoryTargetNames(targets) {
      const owner = await me()
      if (!owner) return []
      const [bs, ps] = [await deps.businesses(), await deps.projects()]
      const st = store()
      return targets.flatMap((t): MemoryTargetName[] => {
        if (t.target_type === 'business') { const b = bs.find((x) => x.business_id === t.target_id); return b ? [{ ...t, name: b.name, href: `/business/${b.business_id}` }] : [] }
        if (t.target_type === 'project') { const p = ps.find((x) => x.project_id === t.target_id); return p ? [{ ...t, name: p.name, href: `/projects/${encodeURIComponent(p.project_id)}` }] : [] }
        if (t.target_type === 'person') { const p = deps.people().find((x) => x.user_id === t.target_id); return p ? [{ ...t, name: `${p.display_name} ${p.title_ko}`.trim(), href: null }] : [] }
        if (t.target_type === 'entity') { const e = st.entities.find((x) => x.entity_id === t.target_id && x.owner_id === owner); return e ? [{ ...t, name: `${e.display_name}${e.status === 'pending' ? ' (확인 전)' : ''}`, href: null }] : [] }
        if (t.target_type === 'task') { const k = st.tasks.find((x) => x.task_id === t.target_id); return k ? [{ ...t, name: k.title, href: null }] : [] }
        return []
      })
    },
    async memoryAiUsedToday() {
      return 0
    },
  }
}
