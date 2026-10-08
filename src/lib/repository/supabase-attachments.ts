import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  AiUsageInput,
  Attachment,
  AttachmentEntity,
  AttachmentSummaryPatch,
  AttachmentViewer,
  NewAttachment,
} from '@/types'

import type { AuditActor, ChairmanRepository } from './types'

/**
 * Phase 10 첨부(0045)의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다 — 그 파일이 이미 4천 줄이다.
 *
 * **읽기는 0045가 없는 DB를 견딘다.** master push가 production 앱을 DB보다 먼저 내보내므로
 * (0037 listCityLayout과 같은 이유), 표가 없다는 오류(PGRST205 · 42P01)만 빈 목록으로 삼키고
 * RLS 거부 같은 다른 오류는 그대로 던진다. 쓰기는 견디지 않는다 — 표 없이 «올렸다»고 말하면 거짓말이다.
 */

export const ATTACHMENT_BUCKET = 'attachments'

const COLUMNS =
  'attachment_id,entity_table,entity_id,business_id,file_name,mime,size_bytes,storage_path,security_class,uploaded_by,status,ai_summary,ai_model,ai_error,summarized_at,created_at'

const MISSING = new Set(['PGRST205', '42P01'])

type Err = { code?: string; message: string } | null

function missing(where: string, error: Err): boolean {
  if (error && MISSING.has(error.code ?? '')) {
    console.warn(`[${where}] attachments가 없다(${error.code}) — 0045 적용 전. 빈 첨부로 그린다.`)
    return true
  }
  return false
}

function fail(table: string, error: NonNullable<Err>): never {
  throw new Error(`Supabase ${table} ${error.code ?? '?'}: ${error.message}`)
}

function toAttachment(r: Record<string, unknown>): Attachment {
  return { ...(r as unknown as Attachment), size_bytes: Number(r.size_bytes) }
}

type AttachmentMethods = Pick<
  ChairmanRepository,
  | 'listAttachments'
  | 'listRecentAttachments'
  | 'getAttachment'
  | 'createAttachment'
  | 'putAttachmentObject'
  | 'readAttachmentObject'
  | 'updateAttachmentSummary'
  | 'deleteAttachment'
  | 'downloadAttachment'
  | 'recordAttachmentAiSend'
  | 'listAttachmentViewers'
  | 'setAttachmentViewer'
  | 'logAiUsage'
>

export function attachmentMethods(sb: SupabaseClient): AttachmentMethods {
  async function getAttachment(attachmentId: string): Promise<Attachment | null> {
    const { data, error } = await sb.from('attachments').select(COLUMNS).eq('attachment_id', attachmentId).maybeSingle()
    if (error) {
      if (missing('getAttachment', error)) return null
      fail('attachments', error)
    }
    return data ? toAttachment(data as Record<string, unknown>) : null
  }

  return {
    async listAttachments(entityTable: AttachmentEntity, entityId: string): Promise<Attachment[]> {
      // 한 대상의 첨부는 수십 건이지 수천 건이 아니다 — 상한만 둔다.
      const { data, error } = await sb
        .from('attachments')
        .select(COLUMNS)
        .eq('entity_table', entityTable)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) {
        if (missing('listAttachments', error)) return []
        fail('attachments', error)
      }
      return (data ?? []).map((r) => toAttachment(r as Record<string, unknown>))
    },

    async listRecentAttachments(since: string | null, limit: number): Promise<Attachment[]> {
      let q = sb.from('attachments').select(COLUMNS).order('created_at', { ascending: false }).limit(limit)
      if (since) q = q.gte('created_at', since)
      const { data, error } = await q
      if (error) {
        if (missing('listRecentAttachments', error)) return []
        fail('attachments', error)
      }
      return (data ?? []).map((r) => toAttachment(r as Record<string, unknown>))
    },

    getAttachment,

    async createAttachment(input: NewAttachment, actor: AuditActor): Promise<Attachment> {
      // uploaded_by · status · business_id는 DB 트리거가 덮는다. 보내지 않는다.
      void actor
      const { data, error } = await sb.from('attachments').insert(input).select(COLUMNS).single()
      if (error) fail('attachments', error)
      return toAttachment(data as Record<string, unknown>)
    },

    async putAttachmentObject(path: string, bytes: ArrayBuffer, contentType: string): Promise<void> {
      // upsert를 켜지 않는다 — 0045에 update 정책이 없다(원본은 덮어쓰지 않는다).
      const { error } = await sb.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, { contentType, upsert: false })
      if (error) throw new Error(`Supabase storage ${ATTACHMENT_BUCKET}: ${error.message} (0045 attachments_objects_insert)`)
    },

    async readAttachmentObject(path: string): Promise<ArrayBuffer> {
      const { data, error } = await sb.storage.from(ATTACHMENT_BUCKET).download(path)
      if (error || !data) throw new Error(`Supabase storage ${ATTACHMENT_BUCKET}: ${error?.message ?? '파일이 없다'}`)
      return data.arrayBuffer()
    },

    async updateAttachmentSummary(attachmentId: string, patch: AttachmentSummaryPatch): Promise<void> {
      const { error, count } = await sb
        .from('attachments')
        .update(patch, { count: 'exact' })
        .eq('attachment_id', attachmentId)
      if (error) fail('attachments', error)
      if (count === 0) throw new Error('row-level security: attachments 요약을 고칠 권한이 없다(올린 사람 · 회장만)')
    },

    async deleteAttachment(attachmentId: string, actor: AuditActor): Promise<void> {
      void actor
      const a = await getAttachment(attachmentId)
      if (!a) throw new Error('attachments: 지울 첨부가 없다(없거나 볼 권한이 없다)')
      // 0059 — 끝난 양식 결재의 첨부는 줄도 파일도 못 지운다. 파일을 먼저 지우는 순서라(저장소 정책이 줄을 본다)
      // 파일만 사라지고 줄이 남는 일이 없게 먼저 묻는다.
      const { data: ok, error: okErr } = await sb.rpc('approval_attachment_ok', { p_entity_table: a.entity_table, p_entity_id: a.entity_id, p_for_delete: true })
      if (okErr) fail('approval_attachment_ok', okErr)
      if (ok === false) throw new Error('row-level security: attachments — 끝난 결재의 첨부는 지울 수 없다(0059)')
      const { error: rmErr } = await sb.storage.from(ATTACHMENT_BUCKET).remove([a.storage_path])
      if (rmErr) throw new Error(`Supabase storage ${ATTACHMENT_BUCKET}: ${rmErr.message}`)
      const { error, count } = await sb.from('attachments').delete({ count: 'exact' }).eq('attachment_id', attachmentId)
      if (error) fail('attachments', error)
      if (count === 0) throw new Error('row-level security: attachments 삭제 권한이 없다(올린 사람 · 회장만)')
    },

    async downloadAttachment(attachmentId: string): Promise<string | null> {
      const a = await getAttachment(attachmentId)
      if (!a) return null
      // 감사가 먼저다 — 경로도 이 문이 준다(못 보면 null).
      const { data: path, error } = await sb.rpc('record_attachment_download', { p_id: attachmentId })
      if (error) fail('record_attachment_download', error)
      if (!path) return null
      const { data, error: signErr } = await sb.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(String(path), 600, { download: a.file_name })
      if (signErr || !data) throw new Error(`Supabase storage ${ATTACHMENT_BUCKET}: ${signErr?.message ?? '서명 실패'}`)
      return data.signedUrl
    },

    async recordAttachmentAiSend(attachmentId: string, model: string): Promise<boolean> {
      const { data, error } = await sb.rpc('record_attachment_ai_send', { p_id: attachmentId, p_model: model })
      if (error) fail('record_attachment_ai_send', error)
      return data === true
    },

    async listAttachmentViewers(attachmentId: string): Promise<AttachmentViewer[]> {
      const { data, error } = await sb
        .from('attachment_vault_viewers')
        .select('user_id')
        .eq('attachment_id', attachmentId)
      if (error) {
        if (missing('listAttachmentViewers', error)) return []
        fail('attachment_vault_viewers', error)
      }
      const ids = (data ?? []).map((r) => String((r as { user_id: string }).user_id))
      if (ids.length === 0) return []
      const { data: people } = await sb.from('user_profiles').select('user_id,display_name').in('user_id', ids)
      const name = new Map((people ?? []).map((p) => [String(p.user_id), String(p.display_name)]))
      return ids.map((id) => ({ user_id: id, display_name: name.get(id) ?? '이름 없음' }))
    },

    async setAttachmentViewer(attachmentId: string, userId: string, on: boolean, actor: AuditActor): Promise<void> {
      void actor
      if (on) {
        const { error } = await sb.from('attachment_vault_viewers').insert({ attachment_id: attachmentId, user_id: userId })
        // 이미 지정된 사람을 다시 넣는 것은 할 일이 없다(23505).
        if (error && error.code !== '23505') fail('attachment_vault_viewers', error)
      } else {
        const { error } = await sb
          .from('attachment_vault_viewers')
          .delete()
          .eq('attachment_id', attachmentId)
          .eq('user_id', userId)
        if (error) fail('attachment_vault_viewers', error)
      }
    },

    async logAiUsage(input: AiUsageInput): Promise<void> {
      const { error } = await sb.from('ai_usage_log').insert({
        feature: input.feature,
        model: input.model,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        estimated_cost_usd: input.estimated_cost_usd,
        entity_table: input.entity_table ?? null,
        entity_id: input.entity_id ?? null,
      })
      if (error) fail('ai_usage_log', error)
    },
  }
}
