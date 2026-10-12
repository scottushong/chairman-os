import type { SupabaseClient } from '@supabase/supabase-js'

import { FIN_UPLOAD_COLUMNS, type FinUpload, type FinUploadPending, type FinUploadShape } from '@/types'

import type { ChairmanRepository } from './types'

/**
 * 0070 «회계 · 재무 자료 올리기»의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 * 0070이 없는 DB를 견딘다(master push = 앱 먼저 나갈 수 있다): 읽기는 빈 목록, 넣기는 'fin_upload_unavailable'.
 * 판정은 전부 DB다(0070 RPC). pending 칸은 열 grant 밖이라 목록은 FIN_UPLOAD_COLUMNS만 고른다.
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type Err = { code?: string; message: string } | null

function fail(what: string, error: NonNullable<Err>): never {
  if (MISSING.has(error.code ?? '')) throw new Error('fin_upload_unavailable')
  const key = /fin_upload_[a-z_]+/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

type Methods = Pick<
  ChairmanRepository,
  | 'listFinUploads'
  | 'finUploadPending'
  | 'finUploadRecord'
  | 'finUploadApply'
  | 'finUploadRevert'
  | 'finUploadCancel'
  | 'finMonthClosed'
  | 'listFinUploadShapes'
  | 'saveFinUploadShape'
>

export function financeUploadMethods(sb: SupabaseClient): Methods {
  return {
    async listFinUploads(businessId) {
      const { data, error } = await sb.from('fin_uploads').select(FIN_UPLOAD_COLUMNS).eq('business_id', businessId).order('created_at', { ascending: false }).limit(300)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_uploads', error)
      return (data ?? []) as unknown as FinUpload[]
    },
    async finUploadPending(uploadId) {
      const { data, error } = await sb.rpc('fin_upload_pending', { p_upload: uploadId })
      if (error && MISSING.has(error.code ?? '')) return null
      if (error) fail('fin_upload_pending', error)
      return (data ?? null) as FinUploadPending | null
    },
    async finUploadRecord(x) {
      const { data, error } = await sb.rpc('fin_upload_record', {
        p_business: x.business_id,
        p_kind: x.kind,
        p_period: x.period,
        p_file_name: x.file_name,
        p_sha: x.file_sha256,
        p_sheet: x.sheet_name,
        p_confidence: x.ai_confidence,
        p_ai_used: x.ai_used,
        p_status: x.status,
        p_pending: x.pending,
        p_error: x.error,
      })
      if (error) fail('fin_upload_record', error)
      return String(data)
    },
    async finUploadApply(x) {
      const { data, error } = await sb.rpc('fin_upload_apply', {
        p_business: x.business_id,
        p_kind: x.kind,
        p_period: x.period,
        p_file_name: x.file_name,
        p_sha: x.file_sha256,
        p_sheet: x.sheet_name,
        p_confidence: x.ai_confidence,
        p_ai_used: x.ai_used,
        p_auto: x.auto,
        p_rows: x.rows,
        p_people: x.people,
        p_overlap: x.overlap,
        p_reason: x.reason,
        p_upload: x.upload_id,
      })
      if (error) fail('fin_upload_apply', error)
      return String(data)
    },
    async finUploadRevert(uploadId, reason) {
      const { data, error } = await sb.rpc('fin_upload_revert', { p_upload: uploadId, p_reason: reason })
      if (error) fail('fin_upload_revert', error)
      return data === true
    },
    async finUploadCancel(uploadId) {
      const { data, error } = await sb.rpc('fin_upload_cancel', { p_upload: uploadId })
      if (error) fail('fin_upload_cancel', error)
      return data === true
    },
    async finMonthClosed(businessId, period) {
      const { data, error } = await sb.rpc('fin_month_closed', { p_business: businessId, p_period: period })
      if (error && MISSING.has(error.code ?? '')) return false
      if (error) fail('fin_month_closed', error)
      return data === true
    },
    async listFinUploadShapes(businessId) {
      const { data, error } = await sb.from('fin_upload_shapes').select('business_id,header_sig,sheet_name,kind,column_map').eq('business_id', businessId).limit(500)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_upload_shapes', error)
      return (data ?? []) as FinUploadShape[]
    },
    async saveFinUploadShape(s) {
      const { error } = await sb.rpc('fin_upload_shape_save', { p_business: s.business_id, p_sig: s.header_sig, p_sheet: s.sheet_name, p_kind: s.kind, p_map: s.column_map })
      if (error) fail('fin_upload_shape_save', error)
    },
  }
}
