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
    /** 0072 다섯째 조건 — 다른 자료와 «같은 거래 의심» 묶음 수(null = 세지 못함) · 한 줄 설명(금액 없음) */
    dup_suspects?: number | null
    dup_notes?: string[]
    /** C단계 — 파일 형식(글 PDF · 스캔 PDF · 사진; 엑셀은 없음) · 사진 고친 것 */
    source_format?: 'pdf_text' | 'pdf_scan' | 'image'
    fixes?: string[]
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
  /**
   * 0072 다섯째 조건 — 앱이 순수 함수(dedupe.ts)로 센 «자료 간 중복 의심» 묶음 수. 자동(auto)이면 늘 수(0 이상)를 보낸다
   * (null이면 DB가 자동을 거부한다). 손으로 넣기는 null이어도 된다.
   */
  dup_suspects?: number | null
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

/* ───────────────────────── 0072 회계 · 재무 v2.1 차이분 ───────────────────────── */

/** 값 상태 — 빈칸(missing, 값 null) · 0 확인(confirmed_zero) · 값(value). 빈칸은 0이 되지 않는다. */
export type ValueState = 'missing' | 'confirmed_zero' | 'value'

export type ValuationCategory = 'wip' | 'finished'
export type CostScope = 'material_only' | 'material_labor_overhead'

/** 0072 fin_inventory_valuations 한 줄(이름은 앱이 붙인다). */
export interface FinValuation {
  valuation_id: string
  business_id: string
  period: string
  category: ValuationCategory
  amount: number | null
  value_state: ValueState
  valuation_date: string | null
  method: string | null
  cost_scope: CostScope
  source: 'manual' | 'excel' | 'pdf'
  source_upload_id: string | null
  source_ref: string | null
  note: string | null
  status: 'entering' | 'provisional' | 'final'
  entered_by: string
  entered_by_name: string | null
  entered_at: string
  confirmed_by: string | null
  confirmed_by_name: string | null
  confirmed_at: string | null
  voided_at: string | null
  void_reason: string | null
}

export interface FinValuationSaveInput {
  business_id: string
  period: string
  category: ValuationCategory
  amount: number | null
  state: ValueState
  valuation_date: string | null
  method: string | null
  cost_scope: CostScope
  source: 'manual' | 'excel' | 'pdf'
  upload_id: string | null
  source_ref: string | null
  note: string | null
  status: 'entering' | 'provisional'
  reason: string | null
}

/** 0072 fin_valuation_warnings — 보여 주기만(고치지 않는다). */
export interface FinValuationWarning {
  kind: 'scope_mismatch' | 'wip_finished_duplicate'
  category: string
  message: string
  detail: Record<string, unknown> | null
}

export type RollCategory = 'raw' | 'wip' | 'finished'

/** 0072 fin_inventory_roll 한 줄 — 기초 · 기말 · 명세서 기초와 차이(고치지 않는다). */
export interface FinInventoryRollRow {
  category: RollCategory
  opening_amount: number | null
  /** 0076: 'partial'(«일부 미입력») = 앞 달 명세서에 빈칸 줄이 섞여 아는 줄만 더한 기초(원재료). */
  opening_state: ValueState | 'partial' | null
  /** prev_close(전월 확정 기말) · manual(직접 입력) · statement(재고금액명세서) · unlinked(미연결) */
  opening_source: 'prev_close' | 'manual' | 'statement' | 'unlinked'
  closing_amount: number | null
  closing_state: ValueState
  closing_status: 'entering' | 'provisional' | 'final' | null
  missing_lines: number
  statement_opening: number | null
  diff_vs_prev_close: number | null
  /** 0076: 기초가 첫 달 직접 입력이면 그 줄(확인 단추) · 확인 여부. 0076 전 DB는 null. */
  opening_id: string | null
  opening_confirmed: boolean | null
  /** 0076: 원재료 기초가 앞 달 기말일 때 앞 달 빈칸 줄 수. */
  prev_missing_lines: number
}

export interface FinOpeningSaveInput {
  business_id: string
  period: string
  category: RollCategory
  amount: number | null
  state: ValueState
  source: 'manual' | 'statement'
  upload_id: string | null
  note: string
}

/** 0072 fin_issue_summary — 이것만 온다(원료별 kg 없음). */
export interface FinIssueSummary {
  production_input_kg: number | null
  input_withheld: 'needs_review_open' | 'too_few_materials' | null
  input_missing_lines: number
  production_qty_kg: number | null
  lines: { production: number; non_production: number; needs_review: number }
  needs_review: { material: string; lines: number }[]
}

export type IssueClass = 'production' | 'non_production' | 'needs_review'
export type NonProductionKind = 'sample' | 'scrap' | 'return' | 'transfer' | 'adjust'

export interface FinIssueBulkInput {
  business_id: string
  period: string
  material: string
  class: Exclude<IssueClass, 'needs_review'>
  non_production_kind: NonProductionKind | null
  reason: string
}

export type TxSourceTable = 'fin_sales_lines' | 'fin_purchase_in_lines' | 'fin_tax_invoice_lines' | 'fin_ledger_lines'
export type TxSourceSystem = 'r2' | 'ecount' | 'ledger' | 'tax_invoice' | 'other'

/** 같은 거래 맞추기의 줄 하나(살아 있는 줄 — 원천 줄은 고치지 않는다). */
export interface FinTxLine {
  /** 'fin_purchase_in_lines:12' — 아직 안 넣은 줄은 'new:<row_no>' */
  ref: string
  upload_id: string | null
  source: TxSourceSystem
  direction: 'sales' | 'purchase'
  date: string | null
  counterparty: string | null
  item: string | null
  account: string | null
  /** 공급가(세전). 빈칸은 null. */
  amount: number | null
  vat: number | null
  /** 합계(세후)가 따로 있으면 */
  total: number | null
  qty: number | null
  row_no: number
  /** 이미 살아 있는 묶음에 든 줄이면 그 묶음 */
  group_id: string | null
}

export interface FinTxGroup {
  group_id: string
  business_id: string
  period: string
  status: 'same' | 'suspect' | 'rejected'
  evidence: Record<string, unknown> | null
  amount_base_ref: string | null
  qty_base_ref: string | null
  saved_at: string
  decided_at: string | null
  reason: string | null
  members: { source_table: TxSourceTable; line_id: number; released: boolean }[]
}

export interface FinTxGroupSaveInput {
  business_id: string
  period: string
  status: 'same' | 'suspect'
  members: { source_table: TxSourceTable; line_id: number }[]
  evidence: Record<string, unknown> | null
  amount_base_ref: string | null
  qty_base_ref: string | null
  reason: string | null
}

export interface FinDedupeSetting {
  amount_base: 'ledger' | 'tax_invoice' | 'r2_ecount'
  qty_base: 'r2_ecount' | 'ledger'
}

export interface FinRecloseFlag {
  flag_id: string
  business_id: string
  period: string
  upload_id: string | null
  cause: 'upload' | 'revert' | 'valuation' | 'opening' | 'pl_reopen'
  reason: string | null
  created_at: string
}
