import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  BridgeKey,
  BridgeSide,
  CompetitorAssumption,
  CustomerProfitRow,
  DiagnosisCard,
  ForecastRow,
  ForecastSetting,
  MarginBridge,
  OutlookRow,
  ProductDiagnosis,
  ProductTrendPoint,
  ProfitBasis,
  ProfitWatchRow,
  PurchasePerfRow,
  WorkOrder,
  WorkOrderListRow,
} from '@/types'

import type { BlueprintMethods } from './types'

/**
 * 0081 청사진 뼈대의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 * 판정 · 가리기 · 한도 · 감사는 전부 DB(0081 RPC 열일곱 — 첫 줄 feature_on · cost_can · 0062 문)다. 여기서는 모양만 옮긴다.
 * 0081이 없는 DB면 'blueprint_unavailable'(앱이 DB보다 먼저 나갈 수 있다 — 화면이 «준비 중»).
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type Err = { code?: string; message: string }

function fail(what: string, error: Err): never {
  if (MISSING.has(error.code ?? '')) throw new Error('blueprint_unavailable')
  const key = /feature_off|cost_[a-z_]+/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const rows = (data: unknown) => (Array.isArray(data) ? (data as Record<string, unknown>[]) : [])

function side(v: unknown): BridgeSide | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  return {
    price: Number(o.price),
    material: Number(o.material),
    mfg: Number(o.mfg),
    logi: Number(o.logi),
    other: Number(o.other),
    gm: Number(o.gm),
    gm_pct: num(o.gm_pct),
    kg: Number(o.kg),
    n: Number(o.n),
  }
}

/** margin_bridge jsonb → 모양. dummy도 같은 모양을 돌려준다. */
export function bridgeFrom(j: Record<string, unknown>): MarginBridge {
  const eff = j.effects && typeof j.effects === 'object' ? (j.effects as Record<string, unknown>) : null
  return {
    a: side(j.a),
    b: side(j.b),
    effects: eff
      ? ({ price: Number(eff.price), material: Number(eff.material), mfg: Number(eff.mfg), logi: Number(eff.logi), other: Number(eff.other) } as Record<BridgeKey, number>)
      : null,
    total: num(j.total),
    material_pct: num(j.material_pct),
    n_excluded: Number(j.n_excluded ?? 0),
    reason: str(j.reason),
    materials: Array.isArray(j.materials)
      ? (j.materials as Record<string, unknown>[]).map((m) => ({ material_id: String(m.material_id), material_name: String(m.material_name), delta_krw_per_kg: Number(m.delta_krw_per_kg) }))
      : null,
    as_of: str(j.as_of),
    product_id: str(j.product_id),
  }
}

export function blueprintMethods(sb: SupabaseClient): BlueprintMethods {
  return {
    async costForecastList(businessId) {
      const { data, error } = await sb.rpc('cost_forecast_list', { p_business: businessId })
      if (error) fail('cost_forecast_list', error)
      return rows(data).map(
        (r): ForecastRow => ({
          product_id: String(r.product_id),
          product_name: String(r.product_name),
          as_of: String(r.as_of),
          forecast_material_krw_per_kg: num(r.forecast_material_krw_per_kg),
          forecast_total_krw_per_kg: num(r.forecast_total_krw_per_kg),
          computed: r.computed === true,
          reason: (str(r.reason) as ForecastRow['reason']) ?? null,
        }),
      )
    },
    async costForecastSetting(businessId) {
      const { data, error } = await sb.rpc('cost_forecast_setting', { p_business: businessId })
      if (error) fail('cost_forecast_setting', error)
      const r = rows(data)[0] ?? {}
      const manual = r.fx_manual && typeof r.fx_manual === 'object' ? (r.fx_manual as Record<string, unknown>) : {}
      return {
        business_id: businessId,
        blend_purchase_pct: Number(r.blend_purchase_pct ?? 50),
        fx_mode: r.fx_mode === 'manual' ? 'manual' : 'today',
        fx_manual: Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v)])),
        updated_at: str(r.updated_at),
        is_default: r.is_default !== false,
      } satisfies ForecastSetting
    },
    async setCostForecastSetting(businessId, blendPct, fxMode, fxManual) {
      const { error } = await sb.rpc('cost_forecast_setting_set', { p_business: businessId, p_blend_pct: blendPct, p_fx_mode: fxMode, p_fx_manual: fxManual })
      if (error) fail('cost_forecast_setting_set', error)
    },
    async costOutlookList(businessId) {
      const { data, error } = await sb.rpc('cost_outlook_list', { p_business: businessId })
      if (error) fail('cost_outlook_list', error)
      return rows(data).map(
        (r): OutlookRow => ({
          outlook_id: Number(r.outlook_id),
          material_id: String(r.material_id),
          material_name: String(r.material_name),
          month: String(r.month),
          price: Number(r.price),
          currency: String(r.currency),
          fx_rate: Number(r.fx_rate),
          price_krw_per_kg: Number(r.price_krw_per_kg),
          note: String(r.note ?? ''),
          created_at: String(r.created_at),
        }),
      )
    },
    async setCostOutlook(input) {
      const { data, error } = await sb.rpc('cost_outlook_set', {
        p_material: input.material_id,
        p_month: input.month,
        p_price: input.price,
        p_currency: input.currency,
        p_fx: input.fx_rate,
        p_note: input.note,
      })
      if (error) fail('cost_outlook_set', error)
      return Number(data)
    },
    async purchasePerformance(businessId, from, to, by) {
      const { data, error } = await sb.rpc('purchase_performance', { p_business: businessId, p_from: from, p_to: to, p_by: by })
      if (error) fail('purchase_performance', error)
      return rows(data).map(
        (r): PurchasePerfRow => ({
          key: String(r.key),
          label: String(r.label ?? r.key),
          n_lots: Number(r.n_lots),
          qty_kg: Number(r.qty_kg),
          purchase_krw: Number(r.purchase_krw),
          market_krw: num(r.market_krw),
          savings_krw: num(r.savings_krw),
          fx_effect_krw: num(r.fx_effect_krw),
          n_no_market: Number(r.n_no_market),
        }),
      )
    },
    async customerProfit(businessId, from, to) {
      const { data, error } = await sb.rpc('customer_profit', { p_business: businessId, p_from: from, p_to: to })
      if (error) fail('customer_profit', error)
      return rows(data).map(
        (r): CustomerProfitRow => ({
          customer: String(r.customer),
          n_sales: Number(r.n_sales),
          kg: Number(r.kg),
          revenue_krw: Number(r.revenue_krw),
          cogs_krw: num(r.cogs_krw),
          gm_krw: num(r.gm_krw),
          gm_pct: num(r.gm_pct),
          grade: str(r.grade),
          n_actual: num(r.n_actual),
          n_estimated: num(r.n_estimated),
          n_uncomputed: num(r.n_uncomputed),
          basis: (str(r.basis) as ProfitBasis | null) ?? null,
        }),
      )
    },
    async customerProfitWatch(businessId, from, to) {
      const { data, error } = await sb.rpc('customer_profit_watch', { p_business: businessId, p_from: from, p_to: to })
      if (error) fail('customer_profit_watch', error)
      return rows(data).map(
        (r): ProfitWatchRow => ({
          kind: r.kind === 'product' ? 'product' : 'customer',
          key: String(r.key),
          label: String(r.label),
          revenue_krw: Number(r.revenue_krw),
          gm_pct: num(r.gm_pct),
          grade: str(r.grade),
        }),
      )
    },
    async marginBridge(businessId, fromA, toA, fromB, toB, productId = null) {
      const { data, error } = await sb.rpc('margin_bridge', {
        p_business: businessId,
        p_from_a: fromA,
        p_to_a: toA,
        p_from_b: fromB,
        p_to_b: toB,
        p_product: productId,
      })
      if (error) fail('margin_bridge', error)
      return bridgeFrom((data ?? {}) as Record<string, unknown>)
    },
    async competitorAssumptionList(businessId) {
      const { data, error } = await sb.rpc('competitor_assumption_list', { p_business: businessId })
      if (error) fail('competitor_assumption_list', error)
      return rows(data).map(
        (r): CompetitorAssumption => ({
          product_id: str(r.product_id),
          product_name: str(r.product_name),
          mfg_krw_per_kg: num(r.mfg_krw_per_kg),
          logi_krw_per_kg: num(r.logi_krw_per_kg),
          margin_pct: num(r.margin_pct),
          note: String(r.note ?? ''),
          updated_at: String(r.updated_at),
        }),
      )
    },
    async setCompetitorAssumption(businessId, input) {
      const { error } = await sb.rpc('competitor_assumption_set', {
        p_business: businessId,
        p_product: input.product_id,
        p_mfg: input.mfg_krw_per_kg,
        p_logi: input.logi_krw_per_kg,
        p_margin: input.margin_pct,
        p_note: input.note,
      })
      if (error) fail('competitor_assumption_set', error)
    },
    async competitorPrice(productId) {
      const { data, error } = await sb.rpc('competitor_price', { p_product: productId })
      if (error) fail('competitor_price', error)
      const r = rows(data)[0]
      if (!r) return null
      return {
        product_id: String(r.product_id),
        competitor_min_krw_per_kg: num(r.competitor_min_krw_per_kg),
        our_target_krw_per_kg: num(r.our_target_krw_per_kg),
        our_margin_at_competitor_pct: num(r.our_margin_at_competitor_pct),
        grade_at_competitor: str(r.grade_at_competitor),
        computed: r.computed === true,
      }
    },
    async workOrderGet(orderId) {
      const { data, error } = await sb.rpc('work_order_get', { p_order: orderId })
      if (error) fail('work_order_get', error)
      const j = (data ?? {}) as Record<string, unknown>
      return {
        order_id: String(j.order_id),
        product_name: str(j.product_name),
        planned_on: String(j.planned_on),
        planned_kg: Number(j.planned_kg),
        status: String(j.status),
        tank: str(j.tank),
        seq: num(j.seq),
        hide_names: j.hide_names !== false,
        lines: rows(j.lines).map((l) => ({ code: String(l.code), material_name: str(l.material_name), batch_kg: Number(l.batch_kg) })),
        inputs: rows(j.inputs).map((i) => ({ prod_lot_id: String(i.prod_lot_id), code: String(i.code), qty_kg: Number(i.qty_kg), created_at: String(i.created_at) })),
      } satisfies WorkOrder
    },
    async workOrderMine(businessId) {
      const { data, error } = await sb.rpc('work_order_mine', { p_business: businessId })
      if (error) fail('work_order_mine', error)
      return rows(data).map(
        (r): WorkOrderListRow => ({
          order_id: String(r.order_id),
          product_name: String(r.product_name),
          planned_on: String(r.planned_on),
          planned_kg: Number(r.planned_kg),
          status: String(r.status),
          tank: str(r.tank),
          seq: num(r.seq),
        }),
      )
    },
    async setWorkOrder(input) {
      const { error } = await sb.rpc('work_order_set', {
        p_order: input.order_id,
        p_tank: input.tank,
        p_seq: input.seq,
        p_assignee: input.assignee,
        p_hide_names: input.hide_names,
      })
      if (error) fail('work_order_set', error)
    },
    async productDiagnosis(productId) {
      const { data, error } = await sb.rpc('product_diagnosis', { p_product: productId })
      if (error) fail('product_diagnosis', error)
      const j = (data ?? {}) as Record<string, unknown>
      return {
        product_id: String(j.product_id),
        product_name: String(j.product_name ?? ''),
        role: j.role === 'chairman' ? 'chairman' : j.role === 'costing' ? 'costing' : 'sales',
        as_of: String(j.as_of),
        cards: rows(j.cards).map(
          (c): DiagnosisCard => ({
            id: Number(c.id),
            key: String(c.key),
            state: c.state === 'ok' ? 'ok' : 'no_data',
            value: c.value && typeof c.value === 'object' ? (c.value as Record<string, unknown>) : null,
            need: str(c.need),
          }),
        ),
      } satisfies ProductDiagnosis
    },
    async productTrend(productId, grain, from, to) {
      const { data, error } = await sb.rpc('product_trend', { p_product: productId, p_grain: grain, p_from: from, p_to: to })
      if (error) fail('product_trend', error)
      return rows(data).map(
        (r): ProductTrendPoint => ({
          period_start: String(r.period_start),
          kg: num(r.kg),
          price_krw_per_kg: num(r.price_krw_per_kg),
          actual_krw_per_kg: num(r.actual_krw_per_kg),
          market_material_krw_per_kg: num(r.market_material_krw_per_kg),
          gm_pct: num(r.gm_pct),
        }),
      )
    },
  }
}
