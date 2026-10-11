import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  CostMaterial,
  CostSupplier,
  MarketPrice,
  PurchaseCandidate,
  PurchaseDoc,
  PurchaseLot,
} from '@/types'

import type { PurchasingMethods } from './types'

/**
 * 0061 원가 엔진 · 구매의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다(supabase-attachments.ts와 같은 결).
 *
 * 판정은 DB다 — RLS(cost_can)와 트리거(만든 사람 · Landed · 환율 · 무효 한 번)가 문이고, 여기서는 칸을 고르고 오류를 그대로 던진다
 * (서버 액션이 lib/purchasing/errors.ts로 사람 말로 바꾼다). **읽기는 0061이 없는 DB를 견딘다**(master push = production 배포가
 * 먼저 나간 순간 — 0045 첨부와 같은 이유): 표가 없다는 오류(PGRST205 · 42P01)만 빈 목록으로 삼킨다.
 *
 * 구매 첨부는 별도 버킷 'purchasing'. 줄이 먼저, 파일이 뒤(0061 5절) — 버킷 insert 정책이 «한 시간 안에 내가 만든 줄»을 본다.
 * 올린 파일은 지울 수 없다(정책 없음) — 무효 줄로 가린다.
 */

export const PURCHASING_BUCKET = 'purchasing'

const MISSING = new Set(['PGRST205', '42P01', 'PGRST202', '42883'])

type Err = { code?: string; message: string; details?: string | null } | null

function missing(where: string, error: Err): boolean {
  if (error && MISSING.has(error.code ?? '')) {
    console.warn(`[${where}] 0061 원가 엔진 표 · 함수가 없다(${error.code}) — 적용 전. 빈 목록으로 그린다.`)
    return true
  }
  return false
}

function fail(where: string, error: NonNullable<Err>): never {
  throw new Error(`Supabase ${where} ${error.code ?? '?'}: ${error.message}${error.details ? ` (${error.details})` : ''}`)
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))

const MATERIAL_COLUMNS = 'material_id,business_id,name,spec,category,active,note,updated_at'
const SUPPLIER_COLUMNS = 'supplier_id,business_id,name,country,currency_default,contact,terms,active,note,updated_at'
const PRICE_COLUMNS =
  'price_id,business_id,material_id,observed_on,price,currency,fx_rate,price_krw_per_kg,source_name,source_url,note,created_at,voided_at,void_reason'
const LOT_COLUMNS =
  'lot_id,business_id,material_id,supplier_id,received_on,ordered_on,supplier_lot_no,qty_kg,unit_price,currency,fx_rate,freight_krw,duty_krw,other_krw,goods_krw,landed_krw_per_kg,source,source_ref,note,created_at,voided_at,void_reason'
const DOC_COLUMNS =
  'doc_id,business_id,lot_id,supplier_id,kind,file_name,mime,size_bytes,storage_path,mix_checked,mix_attested,created_at,voided_at,void_reason'

function toPrice(r: Record<string, unknown>): MarketPrice {
  return {
    ...(r as unknown as MarketPrice),
    price_id: n(r.price_id),
    price: n(r.price),
    fx_rate: n(r.fx_rate),
    price_krw_per_kg: n(r.price_krw_per_kg),
    currency: String(r.currency).trim(),
  }
}

function toLot(r: Record<string, unknown>): PurchaseLot {
  return {
    ...(r as unknown as PurchaseLot),
    qty_kg: n(r.qty_kg),
    unit_price: n(r.unit_price),
    fx_rate: n(r.fx_rate),
    freight_krw: n(r.freight_krw),
    duty_krw: n(r.duty_krw),
    other_krw: n(r.other_krw),
    goods_krw: n(r.goods_krw),
    landed_krw_per_kg: n(r.landed_krw_per_kg),
    currency: String(r.currency).trim(),
  }
}

function toSupplier(r: Record<string, unknown>): CostSupplier {
  return { ...(r as unknown as CostSupplier), currency_default: String(r.currency_default).trim() }
}

/** 무효 — 0행이면(없거나 못 고치는 줄) 있는지 없는지 말하지 않고 cost_not_found. */
async function voidRow(sb: SupabaseClient, table: string, key: string, id: string | number, businessId: string, reason: string) {
  const { data, error } = await sb
    .from(table)
    .update({ void_reason: reason })
    .eq(key, id)
    .eq('business_id', businessId)
    .select(key)
  if (error) fail(table, error)
  if (!data || data.length === 0) throw new Error('cost_not_found')
}

export function purchasingMethods(sb: SupabaseClient): PurchasingMethods {
  return {
    async listCostMaterials(businessId) {
      const { data, error } = await sb.from('cost_materials').select(MATERIAL_COLUMNS).eq('business_id', businessId).order('name').limit(1000)
      if (error) {
        if (missing('listCostMaterials', error)) return []
        fail('cost_materials', error)
      }
      return (data ?? []) as unknown as CostMaterial[]
    },

    async saveCostMaterial(businessId, input, materialId) {
      const row = { name: input.name, spec: input.spec, category: input.category, active: input.active, note: input.note }
      const q = materialId
        ? sb.from('cost_materials').update(row).eq('material_id', materialId).eq('business_id', businessId)
        : sb.from('cost_materials').insert({ ...row, business_id: businessId })
      const { data, error } = await q.select(MATERIAL_COLUMNS)
      if (error) fail('cost_materials', error)
      if (!data || data.length === 0) throw new Error('cost_not_found')
      return data[0] as unknown as CostMaterial
    },

    async listCostSuppliers(businessId) {
      const { data, error } = await sb.from('cost_suppliers').select(SUPPLIER_COLUMNS).eq('business_id', businessId).order('name').limit(1000)
      if (error) {
        if (missing('listCostSuppliers', error)) return []
        fail('cost_suppliers', error)
      }
      return (data ?? []).map((r) => toSupplier(r as Record<string, unknown>))
    },

    async saveCostSupplier(businessId, input, supplierId) {
      const row = {
        name: input.name,
        country: input.country,
        currency_default: input.currency_default,
        contact: input.contact,
        terms: input.terms,
        active: input.active,
        note: input.note,
      }
      const q = supplierId
        ? sb.from('cost_suppliers').update(row).eq('supplier_id', supplierId).eq('business_id', businessId)
        : sb.from('cost_suppliers').insert({ ...row, business_id: businessId })
      const { data, error } = await q.select(SUPPLIER_COLUMNS)
      if (error) fail('cost_suppliers', error)
      if (!data || data.length === 0) throw new Error('cost_not_found')
      return toSupplier(data[0] as Record<string, unknown>)
    },

    async listMarketPrices(businessId, sinceDays) {
      const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await sb
        .from('cost_market_prices')
        .select(PRICE_COLUMNS)
        .eq('business_id', businessId)
        .gte('observed_on', since)
        .order('observed_on', { ascending: false })
        .order('price_id', { ascending: false })
        .limit(5000)
      if (error) {
        if (missing('listMarketPrices', error)) return []
        fail('cost_market_prices', error)
      }
      return (data ?? []).map((r) => toPrice(r as Record<string, unknown>))
    },

    async addMarketPrice(businessId, input) {
      const { data, error } = await sb
        .from('cost_market_prices')
        .insert({
          business_id: businessId,
          material_id: input.material_id,
          observed_on: input.observed_on,
          price: input.price,
          currency: input.currency,
          fx_rate: input.currency === 'KRW' ? null : input.fx_rate,
          source_name: input.source_name,
          source_url: input.source_url,
          note: input.note,
        })
        .select(PRICE_COLUMNS)
        .single()
      if (error) fail('cost_market_prices', error)
      return toPrice(data as Record<string, unknown>)
    },

    voidMarketPrice: (businessId, priceId, reason) => voidRow(sb, 'cost_market_prices', 'price_id', priceId, businessId, reason),

    async listPurchaseLots(businessId) {
      const { data, error } = await sb
        .from('cost_purchase_lots')
        .select(LOT_COLUMNS)
        .eq('business_id', businessId)
        .order('received_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(2000)
      if (error) {
        if (missing('listPurchaseLots', error)) return []
        fail('cost_purchase_lots', error)
      }
      return (data ?? []).map((r) => toLot(r as Record<string, unknown>))
    },

    async addPurchaseLot(businessId, input) {
      const { data, error } = await sb
        .from('cost_purchase_lots')
        .insert({
          business_id: businessId,
          material_id: input.material_id,
          supplier_id: input.supplier_id,
          received_on: input.received_on,
          ordered_on: input.ordered_on,
          supplier_lot_no: input.supplier_lot_no,
          qty_kg: input.qty_kg,
          unit_price: input.unit_price,
          currency: input.currency,
          fx_rate: input.currency === 'KRW' ? null : input.fx_rate,
          freight_krw: input.freight_krw,
          duty_krw: input.duty_krw,
          other_krw: input.other_krw,
          source: input.source,
          source_ref: input.source === 'approval' ? input.source_ref : null,
          note: input.note,
        })
        .select(LOT_COLUMNS)
        .single()
      if (error) fail('cost_purchase_lots', error)
      return toLot(data as Record<string, unknown>)
    },

    voidPurchaseLot: (businessId, lotId, reason) => voidRow(sb, 'cost_purchase_lots', 'lot_id', lotId, businessId, reason),

    async lookupCostFx(currency, onDate) {
      if (currency === 'KRW') return 1
      const { data, error } = await sb.rpc('cost_fx', { p_currency: currency, p_on: onDate, p_given: null })
      if (error) {
        if (/cost_fx_missing/.test(error.message) || missing('lookupCostFx', error)) return null
        fail('cost_fx', error)
      }
      return nn(data)
    },

    async listPurchaseCandidates(businessId) {
      const { data, error } = await sb.rpc('cost_purchase_candidates', { p_business: businessId })
      if (error) {
        if (missing('listPurchaseCandidates', error)) return []
        fail('cost_purchase_candidates', error)
      }
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        ...(r as unknown as PurchaseCandidate),
        quantity: nn(r.quantity),
        amount_krw: nn(r.amount_krw),
      }))
    },

    async dismissPurchaseCandidate(businessId, decisionId) {
      const { error } = await sb.from('cost_candidate_dismissals').insert({ decision_id: decisionId, business_id: businessId })
      if (error) fail('cost_candidate_dismissals', error)
    },

    async listPurchaseDocs(businessId) {
      const { data, error } = await sb
        .from('cost_purchase_docs')
        .select(DOC_COLUMNS)
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) {
        if (missing('listPurchaseDocs', error)) return []
        fail('cost_purchase_docs', error)
      }
      return (data ?? []).map((r) => ({ ...(r as unknown as PurchaseDoc), size_bytes: n((r as Record<string, unknown>).size_bytes) }))
    },

    async createPurchaseDoc(businessId, input) {
      const { data, error } = await sb
        .from('cost_purchase_docs')
        .insert({ ...input, business_id: businessId })
        .select(DOC_COLUMNS)
        .single()
      if (error) fail('cost_purchase_docs', error)
      const r = data as Record<string, unknown>
      return { ...(r as unknown as PurchaseDoc), size_bytes: n(r.size_bytes) }
    },

    async putPurchaseDocObject(path, bytes, contentType) {
      // 호출자 세션으로 올린다 — 버킷 정책(cost_doc_object_uploadable)이 «내가 한 시간 안에 만든 줄»을 본다.
      const { error } = await sb.storage.from(PURCHASING_BUCKET).upload(path, bytes, { contentType, upsert: false })
      if (error) throw new Error(`Supabase storage purchasing: ${error.message}`)
    },

    voidPurchaseDoc: (businessId, docId, reason) => voidRow(sb, 'cost_purchase_docs', 'doc_id', docId, businessId, reason),

    async downloadPurchaseDoc(businessId, docId) {
      const { data, error } = await sb
        .from('cost_purchase_docs')
        .select('storage_path,file_name,voided_at')
        .eq('doc_id', docId)
        .eq('business_id', businessId)
        .maybeSingle<{ storage_path: string; file_name: string; voided_at: string | null }>()
      if (error) fail('cost_purchase_docs', error)
      if (!data || data.voided_at) return null
      const signed = await sb.storage.from(PURCHASING_BUCKET).createSignedUrl(data.storage_path, 600, { download: data.file_name })
      if (signed.error || !signed.data) return null
      return { url: signed.data.signedUrl }
    },
  }
}
