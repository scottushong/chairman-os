import type { SupabaseClient } from '@supabase/supabase-js'

import type { IntakePatch, IntakeRow, IntakeSameFile } from '@/types'

import type { AuditActor, ChairmanRepository } from './types'

/**
 * 자료 받는 입구(0058)의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 *
 * **읽기는 0058이 없는 DB를 견딘다**(supabase-attachments.ts와 같은 이유 — master push가 앱을 DB보다 먼저 내보낼 수 있다).
 * 쓰기는 견디지 않는다. 권한은 여기서 판정하지 않는다 — RLS · stamp · RPC가 하고, 서버 액션이 거부를 사람의 말로 바꾼다.
 */

const COLUMNS =
  'item_id,business_id,attachment_id,security_class,status,no_ai_reason,ai_blocked_reason,mix_attested_by,mix_attested_at,proposal,proposal_history,kind,kind_confirmed_by,kind_confirmed_at,loaded_table,loaded_id,loaded_by,loaded_at,file_sha256,created_by,created_at,updated_at'

const MISSING = new Set(['PGRST205', '42P01'])
type Err = { code?: string; message: string } | null

function missing(where: string, error: Err): boolean {
  if (error && MISSING.has(error.code ?? '')) {
    console.warn(`[${where}] intake_items가 없다(${error.code}) — 0058 적용 전. 빈 입구로 그린다.`)
    return true
  }
  return false
}

function fail(table: string, error: NonNullable<Err>): never {
  throw new Error(`Supabase ${table} ${error.code ?? '?'}: ${error.message}`)
}

type Methods = Pick<
  ChairmanRepository,
  | 'listIntakeItems'
  | 'getIntakeItem'
  | 'getIntakeByAttachment'
  | 'beginIntake'
  | 'updateIntakeItem'
  | 'moveIntakeToDocument'
  | 'intakeSameFile'
  | 'deleteDocument'
>

export function intakeMethods(sb: SupabaseClient): Methods {
  /** 원본 첨부의 이름 · 형식 · 크기 — 보이는 것만(적재된 원본은 문서가 보이는 사람에게만). */
  async function withFiles(rows: Record<string, unknown>[]): Promise<IntakeRow[]> {
    const ids = rows.map((r) => String(r.attachment_id))
    const files = new Map<string, IntakeRow['file']>()
    if (ids.length) {
      const { data, error } = await sb.from('attachments').select('attachment_id,file_name,mime,size_bytes').in('attachment_id', ids)
      if (error && !missing('intake attachments', error)) fail('attachments', error)
      for (const f of data ?? []) {
        files.set(String(f.attachment_id), { file_name: String(f.file_name), mime: String(f.mime), size_bytes: Number(f.size_bytes) })
      }
    }
    return rows.map((r) => ({ ...(r as unknown as IntakeRow), proposal_history: (r.proposal_history as unknown[]) ?? [], file: files.get(String(r.attachment_id)) ?? null }))
  }

  async function one(column: 'item_id' | 'attachment_id', value: string): Promise<IntakeRow | null> {
    const { data, error } = await sb.from('intake_items').select(COLUMNS).eq(column, value).maybeSingle()
    if (error) {
      if (missing('getIntakeItem', error)) return null
      fail('intake_items', error)
    }
    return data ? (await withFiles([data as Record<string, unknown>]))[0] : null
  }

  return {
    async listIntakeItems(businessId) {
      const { data, error } = await sb
        .from('intake_items')
        .select(COLUMNS)
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) {
        if (missing('listIntakeItems', error)) return []
        fail('intake_items', error)
      }
      return withFiles((data ?? []) as Record<string, unknown>[])
    },

    getIntakeItem: (itemId) => one('item_id', itemId),
    getIntakeByAttachment: (attachmentId) => one('attachment_id', attachmentId),

    async beginIntake(input, actor: AuditActor) {
      void actor
      const { data, error } = await sb.rpc('intake_begin', {
        p_business: input.business_id,
        p_class: input.security_class,
        p_file_name: input.file_name,
        p_mime: input.mime,
        p_size: input.size_bytes,
        p_sha256: input.file_sha256,
        p_mix_attested: input.mix_attested,
      })
      if (error) fail('intake_begin', error)
      const row = (Array.isArray(data) ? data[0] : data) as { item_id: string; attachment_id: string; storage_path: string } | undefined
      if (!row) throw new Error('intake_begin: 줄이 돌아오지 않았다')
      return { item_id: String(row.item_id), attachment_id: String(row.attachment_id), storage_path: String(row.storage_path) }
    },

    async updateIntakeItem(itemId, patch: IntakePatch, actor: AuditActor) {
      void actor
      const body: Record<string, unknown> = {}
      if (patch.status !== undefined) body.status = patch.status
      if (patch.no_ai_reason !== undefined) body.no_ai_reason = patch.no_ai_reason
      if (patch.proposal !== undefined) body.proposal = patch.proposal
      if (patch.kind !== undefined) body.kind = patch.kind
      // 도장(누가 · 언제)은 DB가 찍는다 — 시각만 보내면 stamp가 now()와 올린 사람으로 덮는다(0058).
      if (patch.mix_attested !== undefined) body.mix_attested_at = patch.mix_attested ? new Date().toISOString() : null
      const { error, count } = await sb.from('intake_items').update(body, { count: 'exact' }).eq('item_id', itemId)
      if (error) fail('intake_items', error)
      if (count === 0) throw new Error('row-level security: intake_items를 고칠 권한이 없다(올린 사람 · 확인 권한자 · 대표만)')
    },

    async moveIntakeToDocument(itemId, input, actor: AuditActor) {
      void actor
      const { data, error } = await sb.rpc('intake_move_to_document', {
        p_item: itemId,
        p_title: input.title,
        p_doc_type: input.doc_type,
        p_folder_id: input.folder_id ?? null,
        p_tags: input.tags ?? [],
      })
      if (error) fail('intake_move_to_document', error)
      return String(data)
    },

    async intakeSameFile(itemId): Promise<IntakeSameFile[]> {
      const { data, error } = await sb.rpc('intake_same_file', { p_item: itemId })
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') return [] // 0058 적용 전
        fail('intake_same_file', error)
      }
      return (data ?? []) as IntakeSameFile[]
    },

    async deleteDocument(documentId, actor: AuditActor) {
      void actor
      const { data, error } = await sb.rpc('soft_delete', { p_table: 'documents', p_key: documentId })
      if (error) fail('soft_delete documents', error)
      if (data !== true) throw new Error('row-level security: 문서를 지울 권한이 없다(등록한 사람 · 대표만) 또는 이미 지운 문서')
    },
  }
}
