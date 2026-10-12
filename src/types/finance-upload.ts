import type { IsoDateTime } from './primitives'

/** 0070 fin_uploads 한 줄(pending 칸은 열 grant 밖 — fin_upload_pending()으로만 읽는다). */
export interface FinUpload {
  upload_id: string
  business_id: string
  kind: string
  period: string | null
  file_name: string
  file_sha256: string
  sheet_name: string | null
  ai_confidence: 'high' | 'medium' | 'low' | 'none'
  ai_used: number
  auto: boolean
  status: 'needs_review' | 'applied' | 'failed' | 'reverted' | 'cancelled' | 'replaced' | 'skipped'
  row_count: number
  overlap: 'none' | 'replace' | 'keep_old'
  reason: string | null
  error: string | null
  created_by: string
  created_at: IsoDateTime
  applied_at: IsoDateTime | null
  reverted_at: IsoDateTime | null
  replaced_by: string | null
}

export const FIN_UPLOAD_COLUMNS =
  'upload_id,business_id,kind,period,file_name,file_sha256,sheet_name,ai_confidence,ai_used,auto,status,row_count,overlap,reason,error,created_by,created_at,applied_at,reverted_at,replaced_by'

export type FinRow = Record<string, string | number | null> & { row_no: number }

export interface FinUploadPending {
  rows: FinRow[]
  /** 급여 개인 줄 — 대표 · CFO에게만 온다(0070 fin_upload_pending). */
  people?: FinRow[]
  /** 버리기 뒤의 시트 칸(글 · 숫자) — 사람이 종류 · 칸을 고르면 서버가 이것으로 다시 읽는다(원본 파일은 두지 않는다). 3,000줄 · 40칸까지. */
  grid?: (string | number | null)[][]
  /** 분류 · 검증 결과(화면이 다시 그린다) */
  meta?: {
    reason?: string
    period_how?: string
    errors?: string[]
    warnings?: string[]
    why_not_auto?: string[]
    columns?: Record<string, number>
    header_row?: number
    header?: string[]
    sig?: string
    dropped?: { materialRows: number; personCols: number; cardNumbers: number }
  }
}

export interface FinUploadApplyInput {
  business_id: string
  kind: string
  period: string
  file_name: string
  file_sha256: string
  sheet_name: string | null
  ai_confidence: FinUpload['ai_confidence']
  ai_used: number
  auto: boolean
  rows: FinRow[]
  people: FinRow[] | null
  overlap: FinUpload['overlap']
  reason: string | null
  upload_id: string | null
}

export interface FinUploadRecordInput {
  business_id: string
  kind: string
  period: string | null
  file_name: string
  file_sha256: string
  sheet_name: string | null
  ai_confidence: FinUpload['ai_confidence']
  ai_used: number
  status: 'needs_review' | 'failed'
  pending: FinUploadPending | null
  error: string | null
}

export interface FinUploadShape {
  business_id: string
  header_sig: string
  sheet_name: string | null
  kind: string
  column_map: Record<string, number>
}
