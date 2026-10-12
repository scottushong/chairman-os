import type { SupabaseClient } from '@supabase/supabase-js'

import type { LedgerQueueRow } from '@/types'

import type { ChairmanRepository } from './types'

/**
 * PHASE 7 장부 반영(0079)의 live 어댑터 조각. 판정 · 전표 · 무효 · 감사는 전부 DB(ledger_post_*)다. 여기서는 모양만 옮긴다.
 * 0079가 없는 DB면 'ledger_post_unavailable'.
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type Err = { code?: string; message: string }

function fail(what: string, error: Err): never {
  if (MISSING.has(error.code ?? '')) throw new Error('ledger_post_unavailable')
  const key = /feature_off|ledger_[a-z_]+|closed_period|inactive_account|unbalanced_slip|already_corrected/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

export function ledgerPostMethods(sb: SupabaseClient): Pick<ChairmanRepository, 'ledgerPostQueue' | 'ledgerPostStage' | 'ledgerPostApply' | 'ledgerPostVoid'> {
  return {
    async ledgerPostQueue(businessId, period) {
      const { data, error } = await sb.rpc('ledger_post_queue', { p_business: businessId, p_period: period })
      if (error) fail('ledger_post_queue', error)
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): LedgerQueueRow => ({
          line_id: Number(r.line_id),
          tx_date: str(r.tx_date),
          account_code: str(r.account_code),
          account_name: str(r.account_name),
          counterparty: str(r.counterparty),
          memo: str(r.memo),
          debit: num(r.debit),
          credit: num(r.credit),
          group_status: (r.group_status as LedgerQueueRow['group_status']) ?? null,
          post_id: str(r.post_id),
          post_status: (r.post_status as LedgerQueueRow['post_status']) ?? null,
          slip_no: str(r.slip_no),
          closed_month: r.closed_month === true,
        }),
      )
    },
    async ledgerPostStage(businessId, lineIds, counterAccount, entryDate, reason) {
      const { data, error } = await sb.rpc('ledger_post_stage', { p_business: businessId, p_lines: lineIds, p_counter_account: counterAccount, p_entry_date: entryDate, p_reason: reason })
      if (error) fail('ledger_post_stage', error)
      return String(data)
    },
    async ledgerPostApply(postId, reason) {
      const { data, error } = await sb.rpc('ledger_post_apply', { p_post: postId, p_reason: reason })
      if (error) fail('ledger_post_apply', error)
      return String(data)
    },
    async ledgerPostVoid(postId, reason) {
      const { data, error } = await sb.rpc('ledger_post_void', { p_post: postId, p_reason: reason })
      if (error) fail('ledger_post_void', error)
      return String(data)
    },
  }
}
