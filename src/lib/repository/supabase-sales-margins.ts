import type { SupabaseClient } from '@supabase/supabase-js'

import type { SaleDeal, SalesMarginRow } from '@/types'

import type { ChairmanRepository } from './types'

/**
 * PHASE 5 판매 실적 · 마진(0077)의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 * 판정 · 가리기 · 한도 · 감사는 전부 DB(sales_deals · sales_margins → 0067 cost_margins)다. 여기서는 모양만 옮긴다.
 * 0077이 없는 DB면 'sales_margins_unavailable'(앱이 DB보다 먼저 나갈 수 있다 — 화면이 «준비 중»).
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type Err = { code?: string; message: string }

function fail(what: string, error: Err): never {
  if (MISSING.has(error.code ?? '')) throw new Error('sales_margins_unavailable')
  const key = /feature_off|cost_[a-z_]+/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function salesMarginsMethods(sb: SupabaseClient): Pick<ChairmanRepository, 'listSaleDeals' | 'salesMargins'> {
  return {
    async listSaleDeals(businessId, from, to) {
      const { data, error } = await sb.rpc('sales_deals', { p_business: businessId, p_from: from, p_to: to })
      if (error) fail('sales_deals', error)
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): SaleDeal => ({
          sale_id: String(r.sale_id),
          shipped_on: String(r.shipped_on),
          customer_company: String(r.customer_company),
          customer_name: String(r.customer_name),
          product_name: String(r.product_name),
          kg: Number(r.kg),
          price_krw_per_kg: Number(r.price_krw_per_kg),
          currency: String(r.currency),
          revenue_krw: Number(r.revenue_krw),
          grade: r.grade as SaleDeal['grade'],
          grade_as_of: String(r.grade_as_of),
          quote_id: (r.quote_id as string | null) ?? null,
          mine: r.mine === true,
        }),
      )
    },
    async salesMargins(businessId, from, to, grain, by) {
      const { data, error } = await sb.rpc('sales_margins', { p_business: businessId, p_from: from, p_to: to, p_grain: grain, p_by: by })
      if (error) fail('sales_margins', error)
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): SalesMarginRow => ({
          period_start: String(r.period_start),
          key: String(r.key),
          label: String(r.label),
          n_sales: Number(r.n_sales),
          n_uncomputed: Number(r.n_uncomputed),
          kg: Number(r.kg),
          revenue_krw: Number(r.revenue_krw),
          cost_krw: num(r.cost_krw),
          margin_krw: num(r.margin_krw),
          margin_pct: num(r.margin_pct),
          grade: (r.grade as SalesMarginRow['grade']) ?? null,
          quote_kg: num(r.quote_kg),
          quote_margin_krw: num(r.quote_margin_krw),
          quote_margin_pct: num(r.quote_margin_pct),
          sale_id: (r.sale_id as string | null) ?? null,
          shipped_on: (r.shipped_on as string | null) ?? null,
          customer: (r.customer as string | null) ?? null,
          product_name: (r.product_name as string | null) ?? null,
          price_krw_per_kg: num(r.price_krw_per_kg),
          currency: (r.currency as string | null) ?? null,
          cost_source: (r.cost_source as SalesMarginRow['cost_source']) ?? null,
          cost_krw_per_kg: num(r.cost_krw_per_kg),
          quote_id: (r.quote_id as string | null) ?? null,
          quote_price_krw_per_kg: num(r.quote_price_krw_per_kg),
          quote_cost_krw_per_kg: num(r.quote_cost_krw_per_kg),
          pl_closed: r.pl_closed === true,
          cost_basis: r.cost_basis === 'closed_month' ? 'closed_month' : 'provisional',
        }),
      )
    },
  }
}
