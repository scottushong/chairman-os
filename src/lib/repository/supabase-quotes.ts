import type { SupabaseClient } from '@supabase/supabase-js'

import type { CostGrade, Quote, QuoteStatus } from '@/types'

import type { QuoteMethods } from './types'

/**
 * 0066 견적 — live 어댑터 조각(supabase.ts가 펼쳐 넣는다). 판정은 DB다(quote_* 정의자 함수 · quotes RLS).
 * **0066이 없는 DB를 견딘다**: 표 · 함수가 없다는 오류만 빈 값으로 삼킨다(쓰기는 그대로 던진다).
 */
const MISSING = new Set(['PGRST205', '42P01', 'PGRST202', '42883'])
type Err = { code?: string; message: string; details?: string | null } | null

function fail(where: string, error: NonNullable<Err>): never {
  throw new Error(`Supabase ${where} ${error.code ?? '?'}: ${error.message}${error.details ? ` (${error.details})` : ''}`)
}

function toQuote(r: Record<string, unknown>): Quote {
  return {
    quote_id: String(r.quote_id),
    business_id: String(r.business_id),
    root_id: String(r.root_id),
    version: Number(r.version),
    parent_id: (r.parent_id as string | null) ?? null,
    customer_name: String(r.customer_name),
    customer_company: String(r.customer_company),
    product_id: String(r.product_id),
    product_name: String(r.product_name),
    kg: Number(r.kg),
    price_krw_per_kg: Number(r.price_krw_per_kg),
    currency: String(r.currency),
    fx_rate: Number(r.fx_rate),
    valid_until: String(r.valid_until),
    status: r.status as QuoteStatus,
    cost_as_of: String(r.cost_as_of),
    cost_basis: r.cost_basis === 'now' ? 'now' : 'midnight',
    cost_total_krw_per_kg: Number(r.cost_total_krw_per_kg),
    margin_krw_per_kg: Number(r.margin_krw_per_kg),
    margin_pct: Number(r.margin_pct),
    grade: r.grade as CostGrade,
    decision_id: (r.decision_id as string | null) ?? null,
    created_by: String(r.created_by),
    created_at: String(r.created_at),
    confirmed_at: (r.confirmed_at as string | null) ?? null,
    cancelled_at: (r.cancelled_at as string | null) ?? null,
  }
}

export function quoteMethods(sb: SupabaseClient): QuoteMethods {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args)
    if (error) fail(fn, error)
    return data as unknown
  }
  return {
    async listQuotes(businessId) {
      const { data, error } = await sb.from('quotes').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(500)
      if (error) {
        if (MISSING.has(error.code ?? '')) return []
        fail('quotes', error)
      }
      return (data ?? []).map((r) => toQuote(r as Record<string, unknown>))
    },
    async getQuote(quoteId) {
      const { data, error } = await sb.from('quotes').select('*').eq('quote_id', quoteId).maybeSingle()
      if (error) {
        if (MISSING.has(error.code ?? '')) return null
        fail('quotes', error)
      }
      if (!data) return null
      const quote = toQuote(data as Record<string, unknown>)
      const { data: vs, error: ve } = await sb.from('quotes').select('*').eq('root_id', quote.root_id).order('version')
      if (ve) fail('quotes', ve)
      return { quote, versions: (vs ?? []).map((r) => toQuote(r as Record<string, unknown>)) }
    },
    async createQuote(i) {
      // 0066 재검토 N1 — 대표 외 제시가가 총원가 절반 미만이면 DB는 저장 없이 null을 돌려준다(raise하면 한도 · 감사가 되돌아간다).
      const id = await rpc('quote_create', {
          p_product: i.product_id,
          p_customer_name: i.customer_name,
          p_customer_company: i.customer_company,
          p_kg: i.kg,
          p_price_krw_per_kg: i.price_krw_per_kg,
          p_currency: i.currency,
          p_valid_until: i.valid_until,
          p_parent: i.parent_id,
        })
      if (id === null || id === undefined) throw new Error('cost_price_too_low')
      return String(id)
    },
    async requestQuoteApproval(quoteId) {
      return String(await rpc('quote_request_approval', { p_quote: quoteId }))
    },
    async confirmQuote(quoteId) {
      await rpc('quote_confirm', { p_quote: quoteId })
    },
    async cancelQuote(quoteId) {
      await rpc('quote_cancel', { p_quote: quoteId })
    },
    async logQuoteDownload(quoteId, format) {
      await rpc('quote_download_log', { p_quote: quoteId, p_format: format })
    },
  }
}
