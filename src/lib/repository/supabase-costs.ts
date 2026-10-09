import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  AllocBasis,
  AllocSettings,
  BomCurrent,
  BomVersionRow,
  CostingRow,
  CostProduct,
  Overhead,
  OverheadBasis,
  OverheadCategory,
  OverheadGroup,
  OverheadSummaryRow,
  ProductBreakdownRow,
} from '@/types'

import type { CostsMethods } from './types'

/**
 * 원가 엔진 — 원가 관리(0065 비용 마스터 · 배부 · 제품 원가 목록)와 대표 BOM(0063)의 live 어댑터 조각(supabase.ts가 펼쳐 넣는다).
 *
 * 판정은 DB다 — 비용 표는 RLS(cost_can costing), 원가 목록은 0062 cost_gate_biz(하루 20번 · 감사 · 겸직 거부), BOM 함수는
 * cost_secret.bom_reader(대표). 여기서는 칸을 옮기고 오류를 그대로 던진다(액션이 lib/costs/errors.ts로 사람 말로 바꾼다).
 * **0063 · 0065가 없는 DB를 견딘다**(master push = production 배포가 먼저 나간 순간): 표 · 함수가 없다는 오류만 빈 값으로 삼킨다.
 * BOM 값(원료 · kg/kg)은 로그에 싣지 않는다 — 오류는 DB 이유 코드만 담는다(0063이 값 없는 오류만 던진다).
 */

const MISSING = new Set(['PGRST205', '42P01', 'PGRST202', '42883'])

type Err = { code?: string; message: string; details?: string | null } | null

function missing(where: string, error: Err): boolean {
  if (error && MISSING.has(error.code ?? '')) {
    console.warn(`[${where}] 0063 · 0065 원가 표 · 함수가 없다(${error.code}) — 적용 전. 빈 값으로 그린다.`)
    return true
  }
  return false
}

function fail(where: string, error: NonNullable<Err>): never {
  throw new Error(`Supabase ${where} ${error.code ?? '?'}: ${error.message}${error.details ? ` (${error.details})` : ''}`)
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const basisOf = (v: unknown): AllocBasis | null => (v === 'trailing' || v === 'plan' ? v : null)

const OVERHEAD_COLUMNS = 'overhead_id,business_id,category,basis,amount,product_id,effective_from,note,created_at,voided_at,void_reason'

const toOverhead = (r: Record<string, unknown>): Overhead => ({
  ...(r as unknown as Overhead),
  overhead_id: n(r.overhead_id),
  amount: n(r.amount),
  product_id: (r.product_id as string | null) ?? null,
})

export function costsMethods(sb: SupabaseClient): CostsMethods {
  return {
    async listCostProducts(businessId) {
      const { data, error } = await sb
        .from('cost_products')
        .select('product_id,business_id,name,sku,pack_kg,active')
        .eq('business_id', businessId)
        .order('name')
        .limit(500)
      if (error) {
        if (missing('listCostProducts', error)) return []
        fail('cost_products', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): CostProduct => ({
          product_id: String(r.product_id),
          business_id: String(r.business_id),
          name: String(r.name ?? ''),
          sku: String(r.sku ?? ''),
          pack_kg: nn(r.pack_kg),
          active: r.active === true,
        }),
      )
    },

    async costingList(businessId) {
      const { data, error } = await sb.rpc('cost_costing_list', { p_business: businessId })
      if (error) {
        if (missing('costingList', error)) return []
        fail('cost_costing_list', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): CostingRow => ({
          product_id: String(r.product_id),
          product_name: String(r.product_name ?? ''),
          as_of: String(r.as_of),
          market_krw_per_kg: nn(r.market_krw_per_kg),
          current_krw_per_kg: nn(r.current_krw_per_kg),
          mfg_krw_per_kg: nn(r.mfg_krw_per_kg),
          pack_krw_per_kg: nn(r.pack_krw_per_kg),
          logi_krw_per_kg: nn(r.logi_krw_per_kg),
          indirect_krw_per_kg: nn(r.indirect_krw_per_kg),
          overhead_krw_per_kg: nn(r.overhead_krw_per_kg),
          total_krw_per_kg: nn(r.total_krw_per_kg),
          overhead_ready: r.overhead_ready === true,
          overhead_basis: basisOf(r.overhead_basis),
          computed: r.computed === true,
        }),
      )
    },

    async listOverheads(businessId) {
      const { data, error } = await sb
        .from('cost_overheads')
        .select(OVERHEAD_COLUMNS)
        .eq('business_id', businessId)
        .order('effective_from', { ascending: false })
        .limit(1000)
      if (error) {
        if (missing('listOverheads', error)) return []
        fail('cost_overheads', error)
      }
      return (data ?? []).map((r) => toOverhead(r as Record<string, unknown>))
    },

    async addOverhead(businessId, input) {
      const { data, error } = await sb
        .from('cost_overheads')
        .insert({ business_id: businessId, ...input, product_id: input.basis === 'per_kg' ? input.product_id : null })
        .select(OVERHEAD_COLUMNS)
      if (error) fail('cost_overheads', error)
      if (!data || data.length === 0) throw new Error('cost_not_found')
      return toOverhead(data[0] as Record<string, unknown>)
    },

    async voidOverhead(businessId, overheadId, reason) {
      const { data, error } = await sb
        .from('cost_overheads')
        .update({ void_reason: reason })
        .eq('overhead_id', overheadId)
        .eq('business_id', businessId)
        .select('overhead_id')
      if (error) fail('cost_overheads', error)
      if (!data || data.length === 0) throw new Error('cost_not_found')
    },

    async overheadSummary(businessId) {
      const { data, error } = await sb.rpc('cost_overhead_summary', { p_business: businessId })
      if (error) {
        if (missing('overheadSummary', error)) return []
        fail('cost_overhead_summary', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): OverheadSummaryRow => ({
          category: r.category as OverheadCategory,
          grp: r.grp as OverheadGroup,
          basis: r.basis as OverheadBasis,
          amount: n(r.amount),
          product_id: (r.product_id as string | null) ?? null,
          effective_from: String(r.effective_from),
          per_kg: nn(r.per_kg),
          divisor_kg: nn(r.divisor_kg),
          basis_used: basisOf(r.basis_used),
          window_days: nn(r.window_days),
        }),
      )
    },

    async allocSettings(businessId) {
      const { data, error } = await sb
        .from('cost_alloc_settings')
        .select('business_id,basis,window_days,planned_kg_month,updated_at')
        .eq('business_id', businessId)
        .maybeSingle()
      if (error) {
        if (missing('allocSettings', error)) return null
        fail('cost_alloc_settings', error)
      }
      if (!data) return null
      const r = data as Record<string, unknown>
      return {
        business_id: String(r.business_id),
        basis: basisOf(r.basis) ?? 'trailing',
        window_days: n(r.window_days),
        planned_kg_month: nn(r.planned_kg_month),
        updated_at: (r.updated_at as string | null) ?? null,
      } satisfies AllocSettings
    },

    async setAllocSettings(businessId, basis, windowDays, plannedKgMonth) {
      const { error } = await sb.rpc('cost_alloc_set', {
        p_business: businessId,
        p_basis: basis,
        p_window_days: windowDays,
        p_planned_kg_month: plannedKgMonth,
      })
      if (error) fail('cost_alloc_set', error)
    },

    // ── 대표 BOM(0063) ──────────────────────────────────────────────

    async bomStatus() {
      const { data, error } = await sb.rpc('cost_bom_status')
      if (error) {
        if (missing('bomStatus', error)) return null
        fail('cost_bom_status', error)
      }
      const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
      return r ? { key_ready: r.key_ready === true, real_allowed: r.real_allowed === true, changed_at: (r.changed_at as string | null) ?? null } : null
    },

    async bomVersions(businessId) {
      const { data, error } = await sb.rpc('cost_bom_versions', { p_business: businessId })
      if (error) {
        if (missing('bomVersions', error)) return []
        fail('cost_bom_versions', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): BomVersionRow => ({
          version_id: n(r.version_id),
          product_id: String(r.product_id),
          valid_from: String(r.valid_from),
          yield_pct: n(r.yield_pct),
          is_fake: r.is_fake === true,
          note: String(r.note ?? ''),
          created_at: String(r.created_at),
          voided_at: (r.voided_at as string | null) ?? null,
          void_reason: (r.void_reason as string | null) ?? null,
        }),
      )
    },

    async bomGet(productId, asOf = null) {
      const { data, error } = await sb.rpc('cost_bom_get', { p_product: productId, p_as_of: asOf })
      if (error) {
        if (missing('bomGet', error)) return null
        fail('cost_bom_get', error)
      }
      const rows = (data ?? []) as Record<string, unknown>[]
      if (rows.length === 0) return null
      return {
        version_id: n(rows[0].version_id),
        valid_from: String(rows[0].valid_from),
        yield_pct: n(rows[0].yield_pct),
        is_fake: rows[0].is_fake === true,
        lines: rows.map((r) => ({ material_id: String(r.material_id), material_name: String(r.material_name ?? ''), kg_per_kg: n(r.kg_per_kg) })),
      } satisfies BomCurrent
    },

    async bomSave(productId, validFrom, yieldPct, lines, note, isFake) {
      const { data, error } = await sb.rpc('cost_bom_save', {
        p_product: productId,
        p_valid_from: validFrom,
        p_yield_pct: yieldPct,
        p_lines: lines,
        p_note: note,
        p_is_fake: isFake,
      })
      if (error) fail('cost_bom_save', error)
      return n(data)
    },

    async bomVoid(versionId, reason) {
      const { error } = await sb.rpc('cost_bom_void', { p_version: versionId, p_reason: reason })
      if (error) fail('cost_bom_void', error)
    },

    async bomRealAllow(on) {
      const { data, error } = await sb.rpc('cost_bom_real_allow', { p_on: on })
      if (error) fail('cost_bom_real_allow', error)
      return data === true
    },

    async productBreakdown(productId, kind) {
      const { data, error } = await sb.rpc('cost_product_breakdown', { p_product: productId, p_kind: kind })
      if (error) {
        if (missing('productBreakdown', error)) return []
        fail('cost_product_breakdown', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): ProductBreakdownRow => ({
          material_id: String(r.material_id),
          material_name: String(r.material_name ?? ''),
          kg_per_kg: n(r.kg_per_kg),
          qty_kg_per_kg: n(r.qty_kg_per_kg),
          unit_krw_per_kg: nn(r.unit_krw_per_kg),
          contribution_krw_per_kg: nn(r.contribution_krw_per_kg),
        }),
      )
    },
  }
}
