import type { SupabaseClient } from '@supabase/supabase-js'

import type { CostGrade, CostingWatchRow, PriceCheck, SalesCostView, SalesOffer } from '@/types'

import type { SalesCostMethods } from './types'

/**
 * 원가 엔진 — 영업 원가 · 원가 관리 감시의 live 어댑터 조각(supabase.ts가 펼쳐 넣는다).
 *
 * 판정은 DB다 — 0062 cost_gate(회사 · 영업/원가 관리 줄 · 구매 겸직 거부 · 하루 200건 · 감사)와 0061 cost_costing_watch(대표만).
 * 여기서는 칸을 옮기고 오류를 그대로 던진다(화면이 lib/sales/cost.ts salesCostError로 사람 말로 바꾼다).
 * **0062가 없는 DB를 견딘다**(master push = production 배포가 먼저 나간 순간): 표 · 함수가 없다는 오류만 빈 값으로 삼킨다.
 * 원료 표(cost_materials · cost_market_prices · cost_purchase_lots)는 여기서 읽지 않는다.
 */

const MISSING = new Set(['PGRST205', '42P01', 'PGRST202', '42883'])

type Err = { code?: string; message: string; details?: string | null } | null

function missing(where: string, error: Err): boolean {
  if (error && MISSING.has(error.code ?? '')) {
    console.warn(`[${where}] 0061 · 0062 원가 표 · 함수가 없다(${error.code}) — 적용 전. 빈 값으로 그린다.`)
    return true
  }
  return false
}

function fail(where: string, error: NonNullable<Err>): never {
  throw new Error(`Supabase ${where} ${error.code ?? '?'}: ${error.message}${error.details ? ` (${error.details})` : ''}`)
}

const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const grade = (v: unknown): CostGrade | null => (v === 'green' || v === 'yellow' || v === 'red' ? v : null)

function toOffers(v: unknown): SalesOffer[] {
  if (!Array.isArray(v)) return []
  return v
    .map((o: Record<string, unknown>) => ({ margin_pct: Number(o.margin_pct), price_krw_per_kg: Number(o.price_krw_per_kg), grade: grade(o.grade) }))
    .filter((o): o is SalesOffer => o.grade !== null && Number.isFinite(o.price_krw_per_kg))
}

function toView(r: Record<string, unknown>): SalesCostView {
  return {
    product_id: String(r.product_id),
    as_of: String(r.as_of),
    market_krw_per_kg: nn(r.market_krw_per_kg),
    current_krw_per_kg: nn(r.current_krw_per_kg),
    advantage_krw_per_kg: nn(r.advantage_krw_per_kg),
    overhead_krw_per_kg: nn(r.overhead_krw_per_kg),
    total_krw_per_kg: nn(r.total_krw_per_kg),
    overhead_ready: r.overhead_ready === true,
    material_impact_pct: nn(r.material_impact_pct),
    computed: r.computed === true,
    offers: toOffers(r.offers),
  }
}

export function salesCostMethods(sb: SupabaseClient): SalesCostMethods {
  return {
    async costSalesList(businessId) {
      // 0062 cost_sales_list — 회사 전체 한 번(하루 200건 한도에 한 번만 센다). 제품마다 cost_sales_view를 부르면 새로고침 몇 번에 한도가 찬다.
      const { data, error } = await sb.rpc('cost_sales_list', { p_business: businessId })
      if (error) {
        if (missing('costSalesList', error)) return []
        fail('cost_sales_list', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...toView(r), product_name: String(r.product_name ?? '') }))
    },

    async costSalesView(productId) {
      const { data, error } = await sb.rpc('cost_sales_view', { p_product: productId })
      if (error) {
        if (missing('costSalesView', error)) return null
        fail('cost_sales_view', error)
      }
      const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
      return r ? toView(r) : null
    },

    async costPriceCheck(productId, priceKrwPerKg) {
      const { data, error } = await sb.rpc('cost_price_check', { p_product: productId, p_price_krw_per_kg: priceKrwPerKg })
      if (error) fail('cost_price_check', error)
      const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
      return {
        total_krw_per_kg: nn(r?.total_krw_per_kg),
        margin_krw_per_kg: nn(r?.margin_krw_per_kg),
        margin_pct: nn(r?.margin_pct),
        grade: grade(r?.grade),
      } satisfies PriceCheck
    },

    async costingWatch(businessId) {
      const { data, error } = await sb.rpc('cost_costing_watch', { p_business: businessId })
      if (error) {
        if (missing('costingWatch', error)) return []
        fail('cost_costing_watch', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): CostingWatchRow => ({
          user_id: String(r.user_id),
          display_name: String(r.display_name ?? ''),
          granted_at: (r.granted_at as string | null) ?? null,
          cost_reads_7d: Number(r.cost_reads_7d ?? 0),
          screen_reads_7d: Number(r.screen_reads_7d ?? 0),
          last_read_at: (r.last_read_at as string | null) ?? null,
        }),
      )
    },
  }
}
