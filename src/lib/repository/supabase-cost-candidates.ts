import type { SupabaseClient } from '@supabase/supabase-js'

import type { CandidateAction, CandidateKind, CandidateSource, CostCandidate } from '@/types'

import type { ChairmanRepository } from './types'

/**
 * PHASE 6 원가 후보 승인(0078)의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 * 판정 · 넣기 · 감사는 전부 DB(cost_fin_candidates · cost_fin_candidate_decide)다. 여기서는 모양만 옮긴다.
 * 0078이 없는 DB면 'cost_candidates_unavailable'(앱이 DB보다 먼저 나갈 수 있다 — 화면이 «준비 중»).
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type Err = { code?: string; message: string }

function fail(what: string, error: Err): never {
  if (MISSING.has(error.code ?? '')) throw new Error('cost_candidates_unavailable')
  const key = /feature_off|sale_[a-z_]+|cost_[a-z_]+/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

export function costCandidatesMethods(sb: SupabaseClient): Pick<ChairmanRepository, 'listCostCandidates' | 'decideCostCandidate'> {
  return {
    async listCostCandidates(businessId, includeDone) {
      const { data, error } = await sb.rpc('cost_fin_candidates', { p_business: businessId, p_include_done: includeDone })
      if (error) fail('cost_fin_candidates', error)
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): CostCandidate => ({
          source_table: r.source_table as CandidateSource,
          kind: r.kind as CandidateKind,
          line_id: Number(r.line_id),
          period: String(r.period),
          tx_date: str(r.tx_date),
          name: str(r.name),
          counterparty: str(r.counterparty),
          qty: num(r.qty),
          amount_krw: num(r.amount_krw),
          unit_krw_per_kg: num(r.unit_krw_per_kg),
          extra_krw: num(r.extra_krw),
          ref_no: str(r.ref_no),
          last_action: (r.last_action as CandidateAction | null) ?? null,
          last_reason: str(r.last_reason),
          last_at: str(r.last_at),
          target_ref: str(r.target_ref),
        }),
      )
    },
    async decideCostCandidate(businessId, d) {
      const { data, error } = await sb.rpc('cost_fin_candidate_decide', {
        p_business: businessId,
        p_source: d.source,
        p_line: d.line_id,
        p_action: d.action,
        p_reason: d.reason,
        p_material: d.material_id ?? null,
        p_supplier: d.supplier_id ?? null,
        p_on: d.on ?? null,
        p_lot: d.lot_id ?? null,
        p_product: d.product_id ?? null,
      })
      if (error) fail('cost_fin_candidate_decide', error)
      return String(data)
    },
  }
}
