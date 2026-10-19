import type { SupabaseClient } from '@supabase/supabase-js'

import { assemblePrior, splitTargets } from '@/lib/memory/prior'
import type { MemoryMethods } from '@/lib/memory/store'
import type {
  ApplyResult,
  MemoryAsset,
  MemoryCaptureRow,
  MemoryItem,
  MemoryItemWithCapture,
  MemoryLink,
  MemoryReview,
  MemoryRevision,
  MemoryRun,
  MemorySearchHit,
  MemoryTargetName,
} from '@/lib/memory/types'

/**
 * 0086 기억 엔진의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다. 판정 · 중복 막기 · 이력은 전부 DB(memory_me · RPC)다.
 * 사람 세션(쿠키) 그대로 — service_role 없음. 0086이 없는 DB면 'memory_unavailable'(앱이 DB보다 먼저 나갈 수 있다).
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type Err = { code?: string; message: string }

function fail(what: string, error: Err): never {
  if (MISSING.has(error.code ?? '')) throw new Error('memory_unavailable')
  const key = /memory_[a-z_]+|feature_off/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

const BUCKET = 'memory-assets'
const CAPTURE_COLS = 'capture_id, capture_type, title, raw_text, captured_at, created_at, processing_status, summary, categories, metadata'
const ITEM_COLS =
  'item_id, capture_id, memory_type, content, source_quote, speaker_label, direction, who_text, to_text, due_date, due_text, amount_text, event_time, confidence, verification_status, lifecycle_status, origin, created_at, updated_at'
const LINK_COLS = 'link_id, capture_id, item_id, target_type, target_id, relationship, verification_status, confidence, mention_text'
const REVIEW_COLS = 'review_id, review_type, title, proposed_change, capture_id, item_id, related_item_id, link_id, priority, status, resolution, created_at, resolved_at'

const num = <T extends { confidence: unknown }>(r: T) => ({ ...r, confidence: Number(r.confidence) })
const seoulDayStart = () => {
  const d = new Date(Date.now() + 9 * 3600_000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 9 * 3600_000).toISOString()
}

export function memoryMethods(sb: SupabaseClient): MemoryMethods {
  const self: MemoryMethods = {
    async saveMemoryCapture(input) {
      const { data, error } = await sb.rpc('memory_capture_save', {
        p_client_key: input.clientKey,
        p_type: input.type,
        p_title: input.title ?? null,
        p_raw_text: input.rawText,
        p_captured_at: input.capturedAt ?? null,
        p_source: input.source ?? 'quick_capture',
        p_metadata: input.metadata ?? {},
      })
      if (error) fail('memory_capture_save', error)
      return String(data)
    },
    async addMemoryAsset(captureId, f) {
      const { data, error } = await sb.rpc('memory_asset_add', { p_capture: captureId, p_path: f.path, p_name: f.name, p_type: f.type, p_size: f.size, p_kind: f.kind })
      if (error) fail('memory_asset_add', error)
      return String(data)
    },
    async setMemoryAssetStatus(assetId, status, chars) {
      const { error } = await sb.rpc('memory_asset_status', { p_asset: assetId, p_status: status, p_chars: chars ?? null })
      if (error) fail('memory_asset_status', error)
    },
    async putMemoryFile(path, bytes, contentType) {
      const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false })
      if (error) throw new Error(/exists/i.test(error.message) ? 'memory_file_exists' : `memory_file_upload: ${error.message}`)
    },
    async readMemoryFile(path) {
      const { data, error } = await sb.storage.from(BUCKET).download(path)
      if (error || !data) throw new Error('memory_file_missing')
      return new Uint8Array(await data.arrayBuffer())
    },
    async memoryFileUrl(path) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 60)
      return error || !data ? null : data.signedUrl
    },
    async getMemoryCapture(captureId) {
      const { data: c, error } = await sb.from('memory_captures').select(CAPTURE_COLS).eq('capture_id', captureId).maybeSingle()
      if (error) fail('memory_captures', error)
      if (!c) return null
      const [assets, items, links, reviews, runs, job] = await Promise.all([
        sb.from('memory_capture_assets').select('asset_id, capture_id, storage_path, file_name, file_type, file_size, kind, processing_status, extracted_chars, created_at').eq('capture_id', captureId).order('created_at'),
        sb.from('memory_items').select(ITEM_COLS).eq('capture_id', captureId).order('created_at'),
        sb.from('memory_links').select(LINK_COLS).eq('capture_id', captureId),
        sb.from('memory_review_queue').select(REVIEW_COLS).eq('capture_id', captureId).order('created_at'),
        sb.from('memory_processing_runs').select('run_id, processing_stage, status, engine, model, prompt_version, attempt_count, error_details, stats, created_at').eq('capture_id', captureId).order('created_at'),
        sb.from('memory_jobs').select('status, attempts, next_at, last_error').eq('capture_id', captureId).maybeSingle(),
      ])
      for (const [n, r] of [['assets', assets], ['items', items], ['links', links], ['reviews', reviews], ['runs', runs], ['job', job]] as const) {
        if (r.error) fail(`memory ${n}`, r.error)
      }
      const itemIds = (items.data ?? []).map((i) => i.item_id as string)
      const linkIds = (links.data ?? []).map((l) => l.link_id as string)
      const revisions = itemIds.length + linkIds.length === 0
        ? { data: [], error: null }
        : await sb
            .from('memory_revisions')
            .select('revision_id, item_id, link_id, previous_version, new_version, change_reason, changed_at')
            .or([itemIds.length ? `item_id.in.(${itemIds.join(',')})` : '', linkIds.length ? `link_id.in.(${linkIds.join(',')})` : ''].filter(Boolean).join(','))
            .order('changed_at')
      if (revisions.error) fail('memory_revisions', revisions.error)
      return {
        capture: c as MemoryCaptureRow,
        assets: (assets.data ?? []).map((a) => ({ ...a, file_size: Number(a.file_size) })) as MemoryAsset[],
        items: (items.data ?? []).map(num) as MemoryItem[],
        links: (links.data ?? []).map(num) as MemoryLink[],
        reviews: (reviews.data ?? []) as MemoryReview[],
        runs: (runs.data ?? []) as MemoryRun[],
        revisions: (revisions.data ?? []) as MemoryRevision[],
        job: job.data ? { ...(job.data as { status: string; attempts: number; next_at: string; last_error: string | null }) } : null,
      }
    },
    async listMemoryCaptures(opts = {}) {
      let captureIds: string[] | null = null
      if (opts.targetType && opts.targetId) {
        const { data, error } = await sb.from('memory_links').select('capture_id').eq('target_type', opts.targetType).eq('target_id', opts.targetId).neq('verification_status', 'rejected').limit(500)
        if (error) fail('memory_links', error)
        captureIds = [...new Set((data ?? []).map((r) => r.capture_id as string))]
        if (captureIds.length === 0) return []
      }
      let q = sb.from('memory_captures').select(CAPTURE_COLS).is('archived_at', null).order('captured_at', { ascending: false }).limit(opts.limit ?? 50)
      if (captureIds) q = q.in('capture_id', captureIds)
      if (opts.status?.length) q = q.in('processing_status', opts.status)
      if (opts.from) q = q.gte('captured_at', `${opts.from}T00:00:00+09:00`)
      if (opts.to) q = q.lte('captured_at', `${opts.to}T23:59:59+09:00`)
      if (opts.since) q = q.gte('captured_at', opts.since)
      const { data, error } = await q
      if (error) fail('memory_captures', error)
      return (data ?? []) as MemoryCaptureRow[]
    },
    async claimMemoryJob(captureId) {
      const { data, error } = await sb.rpc('memory_job_claim', { p_capture: captureId })
      if (error) fail('memory_job_claim', error)
      return data === null ? null : Number(data)
    },
    async applyMemory(captureId, payload) {
      const { data, error } = await sb.rpc('memory_apply', { p_capture: captureId, p_payload: payload })
      if (error) fail('memory_apply', error)
      return data as ApplyResult
    },
    async failMemory(captureId, message, engine, model) {
      const { error } = await sb.rpc('memory_fail', { p_capture: captureId, p_error: message, p_engine: engine, p_model: model })
      if (error) fail('memory_fail', error)
    },
    async requeueMemory(captureId) {
      const { error } = await sb.rpc('memory_requeue', { p_capture: captureId })
      if (error) fail('memory_requeue', error)
    },
    async dueMemoryJobs(limit) {
      const { data, error } = await sb.from('memory_jobs').select('capture_id').in('status', ['queued', 'failed']).lte('next_at', new Date().toISOString()).order('next_at').limit(limit)
      if (error) fail('memory_jobs', error)
      return (data ?? []).map((r) => r.capture_id as string)
    },
    async memoryDirectory() {
      const [b, p, u, a, e] = await Promise.all([
        sb.from('businesses').select('business_id, name').limit(500),
        sb.from('projects').select('project_id, name, business_id').limit(2000),
        sb.from('user_profiles').select('user_id, display_name, display_name_en, title_ko, role').is('revoked_at', null).limit(2000),
        sb.from('memory_aliases').select('entity_type, entity_id, alias, verification_status').limit(5000),
        sb.from('memory_entities').select('entity_id, entity_type, display_name, status').neq('status', 'rejected').limit(5000),
      ])
      for (const r of [b, p, u, a, e]) if (r.error) fail('memory directory', r.error)
      return {
        businesses: (b.data ?? []) as { business_id: string; name: string }[],
        projects: (p.data ?? []) as { project_id: string; name: string; business_id: string }[],
        people: ((u.data ?? []) as { user_id: string; display_name: string; display_name_en: string | null; title_ko: string | null; role: string }[])
          .filter((x) => x.role !== 'AIAgent' && x.role !== 'Integration')
          .map((x) => ({ user_id: x.user_id, display_name: x.display_name, display_name_en: x.display_name_en, title_ko: x.title_ko })),
        aliases: (a.data ?? []) as never,
        entities: (e.data ?? []) as never,
      }
    },
    async memoryPriorItems(captureId, targets) {
      const { ids, names } = splitTargets(targets)
      let entityIds: string[] = []
      let entities: { entity_id: string; display_name: string }[] = []
      if (names.length) {
        const { data, error } = await sb.from('memory_entities').select('entity_id, display_name').neq('status', 'rejected').limit(5000)
        if (error) fail('memory_entities', error)
        entities = ((data ?? []) as { entity_id: string; display_name: string }[]).filter((x) => names.includes(x.display_name.trim().toLowerCase()))
        entityIds = entities.map((x) => x.entity_id)
      }
      const all = [...ids, ...entityIds.map((id) => ({ target_type: 'entity' as const, target_id: id }))]
      if (all.length === 0) return []
      const ors = all.map((t) => `and(target_type.eq.${t.target_type},target_id.eq.${t.target_id})`).join(',')
      const { data: hit, error } = await sb.from('memory_links').select('capture_id').or(ors).neq('verification_status', 'rejected').limit(500)
      if (error) fail('memory_links', error)
      const caps = [...new Set((hit ?? []).map((r) => r.capture_id as string))].filter((c) => c !== captureId).slice(0, 100)
      if (caps.length === 0) return []
      const [links, items, capRows] = await Promise.all([
        sb.from('memory_links').select('capture_id, item_id, target_type, target_id, verification_status').in('capture_id', caps),
        sb.from('memory_items').select(ITEM_COLS).in('capture_id', caps).in('lifecycle_status', ['open', 'superseded']).neq('verification_status', 'rejected'),
        sb.from('memory_captures').select('capture_id, captured_at').in('capture_id', caps),
      ])
      for (const r of [links, items, capRows]) if (r.error) fail('memory prior', r.error)
      const entIds = [...new Set((links.data ?? []).filter((l) => l.target_type === 'entity').map((l) => l.target_id as string))]
      if (entIds.length) {
        const { data } = await sb.from('memory_entities').select('entity_id, display_name').in('entity_id', entIds)
        entities = [...entities, ...((data ?? []) as { entity_id: string; display_name: string }[])]
      }
      return assemblePrior(captureId, {
        links: (links.data ?? []) as never,
        items: (items.data ?? []).map(num) as MemoryItem[],
        entities,
        capturedAt: new Map((capRows.data ?? []).map((r) => [r.capture_id as string, r.captured_at as string])),
      })
    },
    async searchMemory(params) {
      const { data, error } = await sb.rpc('memory_search', {
        p_query: params.query,
        p_from: params.from ?? null,
        p_to: params.to ?? null,
        p_type: params.type ?? null,
        p_target_type: params.targetType ?? null,
        p_target_id: params.targetId ?? null,
        p_limit: params.limit ?? 30,
      })
      if (error) fail('memory_search', error)
      return ((data ?? []) as MemorySearchHit[]).map((h) => ({ ...h, score: Number(h.score) }))
    },
    async listMemoryReviews(opts = {}) {
      let q = sb.from('memory_review_queue').select(REVIEW_COLS).order('created_at', { ascending: false }).limit(opts.limit ?? 100)
      q = opts.status === 'closed' ? q.neq('status', 'open') : q.eq('status', 'open')
      if (opts.captureId) q = q.eq('capture_id', opts.captureId)
      const { data, error } = await q
      if (error) fail('memory_review_queue', error)
      return (data ?? []) as MemoryReview[]
    },
    async resolveMemoryReview(reviewId, action, data) {
      const { data: out, error } = await sb.rpc('memory_review_resolve', { p_review: reviewId, p_action: action, p_data: data })
      if (error) fail('memory_review_resolve', error)
      return (out ?? {}) as Record<string, unknown>
    },
    async setMemoryItem(itemId, patch, reason) {
      const { error } = await sb.rpc('memory_item_set', { p_item: itemId, p_patch: patch, p_reason: reason })
      if (error) fail('memory_item_set', error)
    },
    async listMemoryItems(filter = {}) {
      let captureIds: string[] | null = null
      if (filter.targetType && filter.targetId) {
        const { data, error } = await sb.from('memory_links').select('capture_id').eq('target_type', filter.targetType).eq('target_id', filter.targetId).neq('verification_status', 'rejected').limit(500)
        if (error) fail('memory_links', error)
        captureIds = [...new Set((data ?? []).map((r) => r.capture_id as string))]
        if (captureIds.length === 0) return []
      }
      let q = sb.from('memory_items').select(`${ITEM_COLS}, memory_captures!inner(captured_at, title, archived_at)`).neq('verification_status', 'rejected').is('memory_captures.archived_at', null).order('created_at', { ascending: false }).limit(filter.limit ?? 100)
      if (captureIds) q = q.in('capture_id', captureIds)
      if (filter.types?.length) q = q.in('memory_type', filter.types)
      if (filter.lifecycle?.length) q = q.in('lifecycle_status', filter.lifecycle)
      if (filter.direction) q = q.eq('direction', filter.direction)
      const { data, error } = await q
      if (error) fail('memory_items', error)
      return (data ?? []).map((r) => {
        const { memory_captures: c, ...rest } = r as unknown as MemoryItem & { memory_captures: { captured_at: string; title: string | null } }
        return { ...num(rest), captured_at: c.captured_at, capture_title: c.title } as MemoryItemWithCapture
      })
    },
    async memoryTargetNames(targets) {
      const by = (t: string) => [...new Set(targets.filter((x) => x.target_type === t).map((x) => x.target_id))]
      const out: MemoryTargetName[] = []
      const [b, p, u, e, k] = await Promise.all([
        by('business').length ? sb.from('businesses').select('business_id, name').in('business_id', by('business')) : Promise.resolve({ data: [], error: null }),
        by('project').length ? sb.from('projects').select('project_id, name').in('project_id', by('project')) : Promise.resolve({ data: [], error: null }),
        by('person').length ? sb.from('user_profiles').select('user_id, display_name, title_ko').in('user_id', by('person')) : Promise.resolve({ data: [], error: null }),
        by('entity').length ? sb.from('memory_entities').select('entity_id, display_name, status').in('entity_id', by('entity')) : Promise.resolve({ data: [], error: null }),
        by('task').length ? sb.from('tasks').select('task_id, title').in('task_id', by('task')) : Promise.resolve({ data: [], error: null }),
      ])
      for (const r of (b.data ?? []) as { business_id: string; name: string }[]) out.push({ target_type: 'business', target_id: r.business_id, name: r.name, href: `/business/${r.business_id}` })
      for (const r of (p.data ?? []) as { project_id: string; name: string }[]) out.push({ target_type: 'project', target_id: r.project_id, name: r.name, href: `/projects/${encodeURIComponent(r.project_id)}` })
      for (const r of (u.data ?? []) as { user_id: string; display_name: string; title_ko: string | null }[]) out.push({ target_type: 'person', target_id: r.user_id, name: `${r.display_name}${r.title_ko ? ` ${r.title_ko}` : ''}`, href: null })
      for (const r of (e.data ?? []) as { entity_id: string; display_name: string; status: string }[]) out.push({ target_type: 'entity', target_id: r.entity_id, name: `${r.display_name}${r.status === 'pending' ? ' (확인 전)' : ''}`, href: null })
      for (const r of (k.data ?? []) as { task_id: string; title: string }[]) out.push({ target_type: 'task', target_id: r.task_id, name: r.title, href: `/tasks/${r.task_id}` })
      return out
    },
    async memoryAiUsedToday() {
      const { count, error } = await sb.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('feature', 'memory_extract').gte('created_at', seoulDayStart())
      if (error) return Number.MAX_SAFE_INTEGER // 못 세면 AI를 쓰지 않는다
      return count ?? 0
    },
  }
  return self
}
