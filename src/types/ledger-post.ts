/** PHASE 7 장부 반영(0079) — ⑤ 계정별 원장 줄 + 반영 상태. */
export type LedgerPostStatus = 'pending' | 'posted' | 'voided'

export interface LedgerQueueRow {
  line_id: number
  tx_date: string | null
  account_code: string | null
  account_name: string | null
  counterparty: string | null
  memo: string | null
  debit: number | null
  credit: number | null
  /** 0072 같은 거래 묶음(same · suspect · rejected) — 없으면 null. */
  group_status: 'same' | 'suspect' | 'rejected' | null
  post_id: string | null
  post_status: LedgerPostStatus | null
  slip_no: string | null
  closed_month: boolean
}
