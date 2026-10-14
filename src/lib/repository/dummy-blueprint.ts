import { createHash } from 'node:crypto'

import { addMonthsIso, nextPeriod, periodEnd, periodStarts } from '@/lib/blueprint/period'
import { costGrade, pgRound, shown } from '@/lib/sales/cost'
import type {
  BridgeKey,
  CompetitorAssumption,
  CostMaterial,
  CostProduct,
  CostSupplier,
  CustomerProfitRow,
  DiagnosisCard,
  ForecastRow,
  ForecastSetting,
  MarginBridge,
  MarketPrice,
  OutlookRow,
  ProdInput,
  ProdLot,
  ProductionOrder,
  ProductionOrderLine,
  ProductTrendPoint,
  ProfitWatchRow,
  PurchaseLot,
  PurchasePerfRow,
  WorkOrderListRow,
} from '@/types'

import { DUMMY_PEOPLE, DUMMY_UID, dummyHasBusiness, dummyViewer } from './dummy-org'
import { dummyCostCan } from './dummy-purchasing'
import { dummySaleRows } from './dummy-sales-margins'
import type { BlueprintMethods } from './types'

/**
 * 0081 청사진 뼈대의 dummy 자리(live에서는 돌지 않는다). **DB(0081)가 막는 것을 여기서도 막는다**:
 *   · 모든 함수 첫 줄 = 스위치(feature_off) · 그다음 역할(cost_not_found) — 대표 · 원가 관리 · 영업 · 구매 · 생산을 dummy 사람의 모듈 줄로 가른다.
 *   · 원가 값은 dummy 원가 엔진의 문(gate — 하루 한도 · 감사 · 겸직 거부 · 영업 0시)을 지난 뒤에만. 대표 = 원래 값 · 대표 외 = 1원(shown).
 *   · 원료 이름 · 원료별 값은 대표 외에게 없다(② 구매 성과의 구매 · 원가 관리 · CFO 예외 · ⑥ 작업지시는 원료 코드만).
 * 숫자는 **가짜**다 — dummy 원가 엔진(가짜 제품 X · Y · Z · 가짜 원료 A~D)과 dummy 판매(dummy-sales-margins)를 그대로 쓴다.
 * dummy 원가 엔진 손잡이는 dummy.ts가 deps로 넘긴다(이 파일은 가짜 BOM 저장소를 import하지 않는다 — check:sales-cost).
 * 환율 «fx_rates»는 dummy에 표가 없어 가짜 시세 · LOT에 붙은 환율로 대신한다(그 통화 · 그 날 이하 최신 · 입고월 평균).
 */

interface Gate {
  as_of: string
  chairman: boolean
}

interface OverheadCalc {
  mfg: number | null
  pack: number | null
  logi: number | null
  indirect: number | null
  total: number | null
  ready: boolean
  has_lines: boolean
}

/** dummy 원가 엔진 손잡이(dummy-sales-cost.ts dummyBlueprintEngine과 같은 모양). */
export interface DummyBlueprintEngineLike {
  gate(businessId: string, target: string, kind: string): Gate
  product(productId: string): CostProduct | null
  products(businessId: string): CostProduct[]
  materialCost(productId: string, kind: 'market' | 'current', on: string): number | null
  unitPrice(materialId: string, kind: 'market' | 'current', on: string): number | null
  businessComplete(businessId: string, kind: 'market' | 'current', on: string): boolean
  overhead(businessId: string, productId: string | null, on: string): OverheadCalc
  totalRaw(productId: string, businessId: string, on: string): number | null
  bomOn(productId: string, on: string): { yield_pct: number; lines: { material_id: string; kg_per_kg: number }[] } | null
  order(orderId: string): ProductionOrder | null
  orders(businessId: string): ProductionOrder[]
  orderLines(orderId: string): ProductionOrderLine[]
  prodLots(businessId: string): ProdLot[]
  inputs(businessId: string): ProdInput[]
}

export interface DummyBlueprintDeps {
  featureOn(key: 'cost_forecast' | 'purchase_performance' | 'customer_profit' | 'margin_bridge' | 'competitor_price' | 'work_orders' | 'product_diagnosis', businessId: string | null): Promise<boolean>
  engine: DummyBlueprintEngineLike
  /** dummy 구매 원장(가짜 원료 · 공급처 · 시세 · LOT) — 복사본. */
  ledger(): { materials: CostMaterial[]; suppliers: CostSupplier[]; prices: MarketPrice[]; lots: PurchaseLot[] }
}

interface Outlook extends OutlookRow {
  business_id: string
  voided_at: string | null
}

interface WorkOrderMeta {
  tank: string | null
  seq: number | null
  assignee: string | null
  hide_names: boolean
}

interface Store {
  settings: Map<string, ForecastSetting>
  outlooks: Outlook[]
  nextOutlook: number
  assumptions: (CompetitorAssumption & { business_id: string })[]
  work: Map<string, WorkOrderMeta>
  workSeeded: boolean
}

const g = globalThis as unknown as { __chairmanDummyBlueprint?: Store }
const store: Store = (g.__chairmanDummyBlueprint ??= {
  settings: new Map(),
  outlooks: [],
  nextOutlook: 1,
  assumptions: [],
  work: new Map(),
  workSeeded: false,
})

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`)
const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10)

function range(from: string, to: string) {
  if (!ISO.test(from) || !ISO.test(to) || from > to || ms(to) - ms(from) > 1100 * DAY) throw new Error('cost_invalid')
}

const code = (materialId: string) => `R-${createHash('md5').update(materialId).digest('hex').slice(0, 6).toUpperCase()}`

/** 대표인가(회사 범위 안 · 회수 안 됨). */
function isChair(businessId: string | null): boolean {
  const v = dummyViewer()
  return !v.revoked_at && v.role === 'Chairman' && !!businessId && dummyHasBusiness(v, businessId)
}

const sumOrNull = (xs: (number | null)[]) => {
  const ys = xs.filter((x): x is number => x !== null)
  return ys.length ? ys.reduce((a, b) => a + b, 0) : null
}

export function dummyBlueprint(d: DummyBlueprintDeps): BlueprintMethods {
  const e = d.engine

  async function need(key: Parameters<DummyBlueprintDeps['featureOn']>[0], businessId: string | null) {
    if (!(await d.featureOn(key, businessId))) throw new Error('feature_off')
  }

  // ── 환율 · Forecast 단가(0081 cost_secret.forecast_unit 거울) ──────────
  function fxOn(currency: string, on: string): number | null {
    if (currency === 'KRW') return 1
    const l = d.ledger()
    const xs = [
      ...l.prices.filter((p) => p.currency === currency && p.observed_on <= on).map((p) => ({ on: p.observed_on, fx: p.fx_rate })),
      ...l.lots.filter((x) => x.currency === currency && x.received_on <= on).map((x) => ({ on: x.received_on, fx: x.fx_rate })),
    ].sort((a, b) => b.on.localeCompare(a.on))
    return xs[0]?.fx ?? null
  }

  function fxMonthAvg(currency: string, month: string): number | null {
    const xs = d.ledger().prices.filter((p) => p.currency === currency && p.observed_on.slice(0, 7) === month).map((p) => p.fx_rate)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  }

  function marketOn(materialId: string, on: string): number | null {
    const rows = d.ledger().prices.filter((p) => p.material_id === materialId && p.observed_on <= on && !p.voided_at)
    if (!rows.length) return null
    const latest = rows.reduce((m, p) => (p.observed_on > m ? p.observed_on : m), rows[0].observed_on)
    const same = rows.filter((p) => p.observed_on === latest)
    return same.reduce((s, p) => s + p.price_krw_per_kg, 0) / same.length
  }

  function setting(businessId: string): ForecastSetting {
    return store.settings.get(businessId) ?? { business_id: businessId, blend_purchase_pct: 50, fx_mode: 'today', fx_manual: {}, updated_at: null, is_default: true }
  }

  function forecastUnit(materialId: string, on: string, businessId: string): number | null {
    const s = setting(businessId)
    const lot = d
      .ledger()
      .lots.filter((l) => l.material_id === materialId && !l.voided_at)
      .sort((a, b) => b.received_on.localeCompare(a.received_on) || b.created_at.localeCompare(a.created_at))[0]
    let p: number | null = null
    if (lot) {
      const fx = lot.currency === 'KRW' ? 1 : s.fx_mode === 'manual' && s.fx_manual[lot.currency] ? s.fx_manual[lot.currency] : fxOn(lot.currency, on)
      if (fx !== null) p = lot.unit_price * fx + (lot.freight_krw + lot.duty_krw + lot.other_krw) / lot.qty_kg
    }
    const next = addMonthsIso(`${on.slice(0, 7)}-01`, 1)
    const out = store.outlooks.find((o) => o.material_id === materialId && o.month === next && !o.voided_at)
    const m = out ? out.price_krw_per_kg : e.unitPrice(materialId, 'market', on)
    const w = s.blend_purchase_pct / 100
    if (p !== null && m !== null) return w * p + (1 - w) * m
    return p ?? m
  }

  function forecastMaterial(productId: string, on: string, businessId: string): { total: number | null; missing: number } {
    const bom = e.bomOn(productId, on)
    if (!bom) return { total: null, missing: -1 }
    let total = 0
    let missing = 0
    for (const l of bom.lines) {
      const u = forecastUnit(l.material_id, on, businessId)
      if (u === null) missing++
      else total += (l.kg_per_kg / (bom.yield_pct / 100)) * u
    }
    return { total: missing ? null : total, missing }
  }

  const forecastComplete = (businessId: string, on: string) =>
    d
      .ledger()
      .materials.filter((m) => m.business_id === businessId && m.active)
      .every((m) => forecastUnit(m.material_id, on, businessId) !== null)

  // ── 판매 한 줄 원가(0081 cost_secret.sale_costs 거울) ──────────────────
  function saleCosts(businessId: string, from: string, to: string, productId: string | null) {
    return dummySaleRows()
      .filter((s) => s.business_id === businessId && s.shipped_on >= from && s.shipped_on <= to && (!productId || s.product_id === productId))
      .map((s) => {
        const o = e.overhead(businessId, s.product_id, s.shipped_on)
        const total = s.act_raw
        const oh = o.ready ? o : null
        return {
          ...s,
          total_raw: total,
          mat_raw: total === null ? null : total - (oh?.total ?? 0),
          mfg: oh?.mfg ?? 0,
          logi: oh?.logi ?? 0,
          other: (oh?.pack ?? 0) + (oh?.indirect ?? 0),
        }
      })
  }

  // ── 마진 분해(0081 cost_secret.bridge_calc 거울) ───────────────────────
  function bridgeCalc(businessId: string, fa: string, ta: string, fb: string, tb: string, productId: string | null, chairman: boolean): MarginBridge {
    const agg = (from: string, to: string) => {
      const xs = saleCosts(businessId, from, to, productId)
      const ok = xs.filter((x) => x.total_raw !== null)
      const kg = ok.reduce((t, x) => t + x.kg, 0)
      const w = (f: (x: (typeof ok)[number]) => number) => (kg > 0 ? ok.reduce((t, x) => t + x.kg * f(x), 0) / kg : 0)
      return { n: ok.length, excl: xs.length - ok.length, kg, price: w((x) => x.price_krw_per_kg), mat: w((x) => x.mat_raw!), mfg: w((x) => x.mfg), logi: w((x) => x.logi), oth: w((x) => x.other) }
    }
    const a = agg(fa, ta)
    const b = agg(fb, tb)
    if (a.n === 0 || b.n === 0) {
      return { a: null, b: null, effects: null, total: null, material_pct: null, n_excluded: a.excl + b.excl, reason: '자료 없음 · 필요한 것: 두 기간 판매 · 원가', materials: null, as_of: null, product_id: productId }
    }
    const ga = a.price - a.mat - a.mfg - a.logi - a.oth
    const gb = b.price - b.mat - b.mfg - b.logi - b.oth
    const raw: Record<BridgeKey, number> = { price: b.price - a.price, material: -(b.mat - a.mat), mfg: -(b.mfg - a.mfg), logi: -(b.logi - a.logi), other: -(b.oth - a.oth) }
    const total = gb - ga
    let effects = raw
    if (!chairman) {
      const keys: BridgeKey[] = ['price', 'material', 'mfg', 'logi', 'other']
      const r = Object.fromEntries(keys.map((k) => [k, pgRound(raw[k], 0)])) as Record<BridgeKey, number>
      let big: BridgeKey = 'price'
      for (const k of keys.slice(1)) if (Math.abs(raw[k]) > Math.abs(raw[big])) big = k
      r[big] += pgRound(total, 0) - keys.reduce((t, k) => t + r[k], 0)
      effects = r
    }
    let materials: MarginBridge['materials'] = null
    if (chairman && productId) {
      const bom = e.bomOn(productId, tb)
      const names = new Map(d.ledger().materials.map((m) => [m.material_id, m.name]))
      materials = (bom?.lines ?? [])
        .map((l) => {
          const pb = e.unitPrice(l.material_id, 'current', tb)
          const pa = e.unitPrice(l.material_id, 'current', ta)
          return { material_id: l.material_id, material_name: names.get(l.material_id) ?? l.material_id, delta_krw_per_kg: pb === null || pa === null ? NaN : (l.kg_per_kg / (bom!.yield_pct / 100)) * (pb - pa) }
        })
        .filter((x) => Number.isFinite(x.delta_krw_per_kg))
        .sort((x, y) => Math.abs(y.delta_krw_per_kg) - Math.abs(x.delta_krw_per_kg))
        .slice(0, 10)
    }
    const side = (s: typeof a, gm: number) => ({
      price: shown(s.price, chairman)!,
      material: shown(s.mat, chairman)!,
      mfg: shown(s.mfg, chairman)!,
      logi: shown(s.logi, chairman)!,
      other: shown(s.oth, chairman)!,
      gm: shown(gm, chairman)!,
      gm_pct: s.price > 0 ? pgRound((gm / s.price) * 100, 1) : null,
      kg: s.kg,
      n: s.n,
    })
    return {
      a: side(a, ga),
      b: side(b, gb),
      effects,
      total: shown(total, chairman),
      material_pct: a.mat > 0 ? pgRound((b.mat / a.mat - 1) * 100, 1) : null,
      n_excluded: a.excl + b.excl,
      reason: null,
      materials,
      as_of: null,
      product_id: productId,
    }
  }

  // ── 경쟁사(0081 cost_secret.competitor_calc 거울) ──────────────────────
  function competitorCalc(productId: string, businessId: string, on: string, chairman: boolean, ok: boolean) {
    const has = store.assumptions.some((x) => x.business_id === businessId && (x.product_id === null || x.product_id === productId))
    if (!(chairman || ok)) return { comp_min: null, our_total: null, margin_at: null, has }
    const mk = e.materialCost(productId, 'market', on)
    const o = e.overhead(businessId, productId, on)
    const pa = store.assumptions.find((x) => x.business_id === businessId && x.product_id === productId)
    const da = store.assumptions.find((x) => x.business_id === businessId && x.product_id === null)
    const ours = (v: number | null) => (o.ready ? v : !o.has_lines ? 0 : null)
    const mfg = pa?.mfg_krw_per_kg ?? da?.mfg_krw_per_kg ?? ours(o.mfg)
    const logi = pa?.logi_krw_per_kg ?? da?.logi_krw_per_kg ?? ours(o.logi)
    const margin = pa?.margin_pct ?? da?.margin_pct ?? 15
    const compMin = mk === null || mfg === null || logi === null ? null : (mk + mfg + logi) / (1 - margin / 100)
    const ourTotal = e.totalRaw(productId, businessId, on)
    const marginAt = compMin !== null && compMin > 0 && ourTotal !== null ? ((compMin - ourTotal) / compMin) * 100 : null
    return { comp_min: compMin, our_total: ourTotal, margin_at: marginAt, has }
  }

  // ── 작업지시 시드(가짜) — 진행 중 오더 하나를 생산 직원(prod_staff)에게 ──
  function seedWork() {
    if (store.workSeeded) return
    store.workSeeded = true
    const open = e.orders('biz_dy').filter((o) => o.status === 'open').sort((a, b) => a.planned_on.localeCompare(b.planned_on))
    if (open[0]) store.work.set(open[0].order_id, { tank: 'T-1', seq: 1, assignee: DUMMY_UID.prodStaff, hide_names: true })
    if (open[1]) store.work.set(open[1].order_id, { tank: 'T-2', seq: 2, assignee: null, hide_names: true })
  }

  const canRole = (area: 'costing' | 'sales' | 'purchasing' | 'production', businessId: string, write = false) => dummyCostCan(area, businessId, write)

  return {
    // ① Forecast
    async costForecastList(businessId) {
      await need('cost_forecast', businessId)
      if (!(isChair(businessId) || canRole('costing', businessId))) throw new Error('cost_not_found')
      const gt = e.gate(businessId, `forecast:${businessId}`, 'costing_list')
      const ok = gt.chairman || forecastComplete(businessId, gt.as_of)
      return e
        .products(businessId)
        .filter((p) => p.active)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
        .map((p): ForecastRow => {
          const f = forecastMaterial(p.product_id, gt.as_of, businessId)
          const o = e.overhead(businessId, p.product_id, gt.as_of)
          const t = f.total === null ? null : o.ready ? f.total + o.total! : o.has_lines ? null : f.total
          const computed = ok && t !== null
          return {
            product_id: p.product_id,
            product_name: p.name,
            as_of: gt.as_of,
            forecast_material_krw_per_kg: ok ? shown(f.total, gt.chairman) : null,
            forecast_total_krw_per_kg: ok ? shown(t, gt.chairman) : null,
            computed,
            reason: computed ? null : !gt.chairman ? 'not_computed' : f.missing === -1 ? 'no_bom' : f.total === null ? 'price_missing' : 'overhead_not_ready',
          }
        })
    },
    async costForecastSetting(businessId) {
      await need('cost_forecast', businessId)
      if (!(isChair(businessId) || canRole('costing', businessId))) throw new Error('cost_not_found')
      return { ...setting(businessId) }
    },
    async setCostForecastSetting(businessId, blendPct, fxMode, fxManual) {
      await need('cost_forecast', businessId)
      if (!isChair(businessId)) throw new Error('cost_not_found')
      if (!Number.isFinite(blendPct) || blendPct < 0 || blendPct > 100 || !['today', 'manual'].includes(fxMode)) throw new Error('cost_invalid')
      for (const [k, v] of Object.entries(fxManual)) if (!/^[A-Z]{3}$/.test(k) || !(v >= 0.000001 && v <= 1e6)) throw new Error('cost_invalid')
      store.settings.set(businessId, { business_id: businessId, blend_purchase_pct: blendPct, fx_mode: fxMode, fx_manual: { ...fxManual }, updated_at: new Date().toISOString(), is_default: false })
      console.info('[dummy audit] Forecast 설정(0081)', businessId)
    },
    async costOutlookList(businessId) {
      await need('cost_forecast', businessId)
      if (!(canRole('purchasing', businessId) || canRole('costing', businessId))) throw new Error('cost_not_found')
      return store.outlooks
        .filter((o) => o.business_id === businessId && !o.voided_at)
        .sort((a, b) => b.month.localeCompare(a.month) || a.material_name.localeCompare(b.material_name, 'ko'))
        .map((o): OutlookRow => ({
          outlook_id: o.outlook_id,
          material_id: o.material_id,
          material_name: o.material_name,
          month: o.month,
          price: o.price,
          currency: o.currency,
          fx_rate: o.fx_rate,
          price_krw_per_kg: o.price_krw_per_kg,
          note: o.note,
          created_at: o.created_at,
        }))
    },
    async setCostOutlook(input) {
      const m = d.ledger().materials.find((x) => x.material_id === input.material_id)
      await need('cost_forecast', m?.business_id ?? null)
      if (!m || !canRole('purchasing', m.business_id, true)) throw new Error('cost_not_found')
      const cur = (input.currency || 'KRW').trim().toUpperCase()
      if (!/^\d{4}-\d{2}-01$/.test(input.month) || !(input.price > 0 && input.price <= 1e9) || !/^[A-Z]{3}$/.test(cur)) throw new Error('cost_invalid')
      if (input.fx_rate !== null && !(input.fx_rate > 0 && input.fx_rate <= 1e6)) throw new Error('cost_invalid')
      const fx = cur === 'KRW' ? 1 : (input.fx_rate ?? fxOn(cur, input.month))
      if (fx === null || input.note.length > 300) throw new Error('cost_invalid')
      for (const o of store.outlooks) if (o.material_id === m.material_id && o.month === input.month && !o.voided_at) o.voided_at = new Date().toISOString()
      const id = store.nextOutlook++
      store.outlooks.push({
        outlook_id: id,
        business_id: m.business_id,
        material_id: m.material_id,
        material_name: m.name,
        month: input.month,
        price: input.price,
        currency: cur,
        fx_rate: fx,
        price_krw_per_kg: input.price * fx,
        note: input.note,
        created_at: new Date().toISOString(),
        voided_at: null,
      })
      console.info('[dummy audit] 시장 전망 입력(0081)', id)
      return id
    },

    // ② 구매 성과
    async purchasePerformance(businessId, from, to, by) {
      await need('purchase_performance', businessId)
      range(from, to)
      if (!['lot', 'material', 'supplier', 'month'].includes(by)) throw new Error('cost_invalid')
      const v = dummyViewer()
      const inBiz = !v.revoked_at && dummyHasBusiness(v, businessId) && !['AIAgent', 'Integration'].includes(v.role)
      const full = inBiz && (['Chairman', 'GroupCFO'].includes(v.role) || canRole('purchasing', businessId) || canRole('costing', businessId))
      const exec = inBiz && ['BusinessCEO', 'Executive'].includes(v.role)
      if (!(full || (exec && by === 'month'))) throw new Error('cost_not_found')
      if (v.role !== 'Chairman') console.info('[dummy audit] 구매 성과 조회(0081)', businessId, by)
      const l = d.ledger()
      const mName = new Map(l.materials.map((m) => [m.material_id, m.name]))
      const sName = new Map(l.suppliers.map((s) => [s.supplier_id, s.name]))
      const groups = new Map<string, { label: string; xs: { q: number; buy: number; mkt: number | null; fxe: number | null }[] }>()
      for (const x of l.lots.filter((x) => x.business_id === businessId && !x.voided_at && x.received_on >= from && x.received_on <= to)) {
        const base = x.currency === 'KRW' ? null : fxMonthAvg(x.currency, x.received_on.slice(0, 7))
        const row = {
          q: x.qty_kg,
          buy: x.unit_price * x.fx_rate,
          mkt: marketOn(x.material_id, x.received_on),
          fxe: x.currency === 'KRW' ? 0 : base === null ? null : (x.fx_rate - base) * x.unit_price * x.qty_kg,
        }
        const k = by === 'lot' ? x.lot_id : by === 'material' ? x.material_id : by === 'supplier' ? x.supplier_id : x.received_on.slice(0, 7)
        const label =
          by === 'lot' ? `${x.lot_id} · ${mName.get(x.material_id) ?? ''} · ${x.received_on}` : by === 'material' ? (mName.get(x.material_id) ?? k) : by === 'supplier' ? (sName.get(x.supplier_id) ?? k) : k
        const gr = groups.get(k) ?? { label, xs: [] }
        gr.xs.push(row)
        groups.set(k, gr)
      }
      const r = (n: number | null) => (n === null ? null : pgRound(n, 0))
      return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([key, gr]): PurchasePerfRow => ({
            key,
            label: gr.label,
            n_lots: gr.xs.length,
            qty_kg: gr.xs.reduce((t, x) => t + x.q, 0),
            purchase_krw: pgRound(gr.xs.reduce((t, x) => t + x.buy * x.q, 0), 0),
            market_krw: r(sumOrNull(gr.xs.map((x) => (x.mkt === null ? null : x.mkt * x.q)))),
            savings_krw: r(sumOrNull(gr.xs.map((x) => (x.mkt === null ? null : (x.mkt - x.buy) * x.q)))),
            fx_effect_krw: r(sumOrNull(gr.xs.map((x) => x.fxe))),
            n_no_market: gr.xs.filter((x) => x.mkt === null).length,
          }),
        )
    },

    // ③ 고객별 수익성
    async customerProfit(businessId, from, to) {
      await need('customer_profit', businessId)
      range(from, to)
      if (isChair(businessId) || canRole('costing', businessId)) {
        const gt = e.gate(businessId, `customers:${businessId}`, 'costing_list')
        const by = new Map<string, ReturnType<typeof saleCosts>>()
        for (const c of saleCosts(businessId, from, to, null)) by.set(c.customer_company, [...(by.get(c.customer_company) ?? []), c])
        return [...by.entries()]
          .map(([customer, xs]): CustomerProfitRow & { _rev: number } => {
            const rev = xs.reduce((t, x) => t + x.kg * x.price_krw_per_kg, 0)
            const ok = xs.filter((x) => x.total_raw !== null)
            const revOk = ok.reduce((t, x) => t + x.kg * x.price_krw_per_kg, 0)
            const cogs = ok.length ? ok.reduce((t, x) => t + x.kg * x.total_raw!, 0) : null
            const gm = ok.length ? ok.reduce((t, x) => t + x.kg * (x.price_krw_per_kg - x.total_raw!), 0) : null
            const pct = gm !== null && revOk > 0 ? (gm / revOk) * 100 : null
            const nA = ok.filter((x) => x.source === 'actual').length
            const nE = ok.filter((x) => x.source === 'current').length
            return {
              _rev: rev,
              customer,
              n_sales: xs.length,
              kg: xs.reduce((t, x) => t + x.kg, 0),
              revenue_krw: shown(rev, gt.chairman)!,
              cogs_krw: shown(cogs, gt.chairman),
              gm_krw: shown(gm, gt.chairman),
              gm_pct: pct === null ? null : pgRound(pct, 1),
              grade: costGrade(pct),
              n_actual: nA,
              n_estimated: nE,
              n_uncomputed: xs.length - ok.length,
              basis: ok.length === 0 ? 'uncomputed' : ok.length === xs.length && nE === 0 ? 'actual' : ok.length === xs.length && nA === 0 ? 'estimated' : 'mixed',
            }
          })
          .sort((a, b) => b._rev - a._rev || a.customer.localeCompare(b.customer))
          .map((r): CustomerProfitRow => {
            const out: Partial<typeof r> = { ...r }
            delete out._rev
            return out as CustomerProfitRow
          })
      }
      if (canRole('sales', businessId)) {
        const me = dummyViewer().user_id
        const by = new Map<string, ReturnType<typeof dummySaleRows>[number][]>()
        for (const s of dummySaleRows().filter((s) => s.business_id === businessId && s.shipped_on >= from && s.shipped_on <= to && s.created_by === me)) {
          by.set(s.customer_company, [...(by.get(s.customer_company) ?? []), s])
        }
        return [...by.entries()]
          .map(([customer, xs]) => {
            const latest = [...xs].sort((a, b) => b.shipped_on.localeCompare(a.shipped_on))[0]
            return {
              customer,
              n_sales: xs.length,
              kg: xs.reduce((t, x) => t + x.kg, 0),
              revenue_krw: pgRound(xs.reduce((t, x) => t + x.kg * x.price_krw_per_kg, 0), 0),
              cogs_krw: null,
              gm_krw: null,
              gm_pct: null,
              grade: latest.grade,
              n_actual: null,
              n_estimated: null,
              n_uncomputed: null,
              basis: null,
            } satisfies CustomerProfitRow
          })
          .sort((a, b) => b.revenue_krw - a.revenue_krw || a.customer.localeCompare(b.customer))
      }
      throw new Error('cost_not_found')
    },
    async customerProfitWatch(businessId, from, to) {
      await need('customer_profit', businessId)
      range(from, to)
      if (!(isChair(businessId) || canRole('costing', businessId))) throw new Error('cost_not_found')
      const gt = e.gate(businessId, `customers:${businessId}`, 'costing_list')
      const xs = saleCosts(businessId, from, to, null)
      const out: ProfitWatchRow[] = []
      for (const kind of ['customer', 'product'] as const) {
        const by = new Map<string, { label: string; xs: typeof xs }>()
        for (const x of xs) {
          const k = kind === 'customer' ? x.customer_company : x.product_id
          const gr = by.get(k) ?? { label: kind === 'customer' ? x.customer_company : x.product_name, xs: [] }
          gr.xs.push(x)
          by.set(k, gr)
        }
        const rows = [...by.entries()].map(([k, gr]) => {
          const rev = gr.xs.reduce((t, x) => t + x.kg * x.price_krw_per_kg, 0)
          const ok = gr.xs.filter((x) => x.total_raw !== null)
          const revOk = ok.reduce((t, x) => t + x.kg * x.price_krw_per_kg, 0)
          const pct = ok.length && revOk > 0 ? (ok.reduce((t, x) => t + x.kg * (x.price_krw_per_kg - x.total_raw!), 0) / revOk) * 100 : null
          return { k, label: gr.label, rev, pct }
        })
        const top = [...rows].sort((a, b) => b.rev - a.rev || a.k.localeCompare(b.k)).slice(0, Math.ceil(rows.length / 2))
        top
          .filter((r) => r.pct !== null)
          .sort((a, b) => a.pct! - b.pct! || b.rev - a.rev || a.k.localeCompare(b.k))
          .slice(0, 10)
          .forEach((r) => out.push({ kind, key: r.k, label: r.label, revenue_krw: shown(r.rev, gt.chairman)!, gm_pct: pgRound(r.pct!, 1), grade: costGrade(r.pct) }))
      }
      return out
    },

    // ④ 마진 변동 분해
    async marginBridge(businessId, fromA, toA, fromB, toB, productId = null) {
      await need('margin_bridge', businessId)
      range(fromA, toA)
      range(fromB, toB)
      if (!(isChair(businessId) || canRole('costing', businessId))) throw new Error('cost_not_found')
      if (productId && e.product(productId)?.business_id !== businessId) throw new Error('cost_not_found')
      const gt = e.gate(businessId, `bridge:${businessId}`, 'costing_list')
      return { ...bridgeCalc(businessId, fromA, toA, fromB, toB, productId, gt.chairman), as_of: gt.as_of, product_id: productId }
    },

    // ⑤ 경쟁사 가정
    async competitorAssumptionList(businessId) {
      await need('competitor_price', businessId)
      if (!canRole('costing', businessId)) throw new Error('cost_not_found')
      return store.assumptions
        .filter((a) => a.business_id === businessId)
        .sort((a, b) => (a.product_id === null ? -1 : b.product_id === null ? 1 : a.product_id.localeCompare(b.product_id)))
        .map(
          (r): CompetitorAssumption => ({
            product_id: r.product_id,
            product_name: r.product_id ? (e.product(r.product_id)?.name ?? null) : null,
            mfg_krw_per_kg: r.mfg_krw_per_kg,
            logi_krw_per_kg: r.logi_krw_per_kg,
            margin_pct: r.margin_pct,
            note: r.note,
            updated_at: r.updated_at,
          }),
        )
    },
    async setCompetitorAssumption(businessId, input) {
      await need('competitor_price', businessId)
      if (!canRole('costing', businessId, true)) throw new Error('cost_not_found')
      if (input.product_id && e.product(input.product_id)?.business_id !== businessId) throw new Error('cost_not_found')
      const bad = (v: number | null, max: number) => v !== null && !(v >= 0 && v <= max)
      if (bad(input.mfg_krw_per_kg, 1e9) || bad(input.logi_krw_per_kg, 1e9) || bad(input.margin_pct, 60) || input.note.length > 300) throw new Error('cost_invalid')
      const i = store.assumptions.findIndex((a) => a.business_id === businessId && a.product_id === input.product_id)
      const row = { ...input, business_id: businessId, product_name: null, updated_at: new Date().toISOString() }
      if (i >= 0) store.assumptions[i] = row
      else store.assumptions.push(row)
      console.info('[dummy audit] 경쟁사 가정(0081)', businessId, input.product_id ?? '*')
    },
    async competitorPrice(productId) {
      const p = e.product(productId)
      await need('competitor_price', p?.business_id ?? null)
      if (!p) throw new Error('cost_not_found')
      const gt = e.gate(p.business_id, productId, 'competitor')
      const ok = gt.chairman || (e.businessComplete(p.business_id, 'market', gt.as_of) && e.businessComplete(p.business_id, 'current', gt.as_of))
      const c = competitorCalc(productId, p.business_id, gt.as_of, gt.chairman, ok)
      return {
        product_id: productId,
        competitor_min_krw_per_kg: shown(c.comp_min, gt.chairman),
        our_target_krw_per_kg: shown(c.our_total === null ? null : c.our_total / 0.8, gt.chairman),
        our_margin_at_competitor_pct: c.margin_at === null ? null : pgRound(c.margin_at, 1),
        grade_at_competitor: costGrade(c.margin_at),
        computed: c.comp_min !== null && c.our_total !== null,
      }
    },

    // ⑥ 작업지시
    async workOrderGet(orderId) {
      const o = e.order(orderId)
      await need('work_orders', o?.business_id ?? null)
      seedWork()
      const w = store.work.get(orderId)
      const chair = !!o && isChair(o.business_id)
      if (!o || !(chair || (canRole('production', o.business_id) && !!w?.assignee && w.assignee === dummyViewer().user_id))) throw new Error('cost_not_found')
      const show = chair || w?.hide_names === false
      const names = new Map(d.ledger().materials.map((m) => [m.material_id, m.name]))
      const lots = new Set(e.prodLots(o.business_id).filter((p) => p.order_id === orderId).map((p) => p.prod_lot_id))
      return {
        order_id: o.order_id,
        product_name: e.product(o.product_id)?.name ?? null,
        planned_on: o.planned_on,
        planned_kg: o.planned_kg,
        status: o.status,
        tank: w?.tank ?? null,
        seq: w?.seq ?? null,
        hide_names: w?.hide_names ?? true,
        lines: e
          .orderLines(orderId)
          .map((l) => ({ code: code(l.material_id), material_name: show ? (names.get(l.material_id) ?? null) : null, batch_kg: l.planned_kg }))
          .sort((a, b) => a.code.localeCompare(b.code)),
        inputs: e
          .inputs(o.business_id)
          .filter((i) => lots.has(i.prod_lot_id))
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.input_id - b.input_id)
          .map((i) => ({ prod_lot_id: i.prod_lot_id, code: code(i.material_id), qty_kg: i.qty_kg, created_at: i.created_at })),
      }
    },
    async workOrderMine(businessId) {
      await need('work_orders', businessId)
      seedWork()
      const chair = isChair(businessId)
      if (!(chair || canRole('production', businessId))) throw new Error('cost_not_found')
      const me = dummyViewer().user_id
      return e
        .orders(businessId)
        .filter((o) => chair || store.work.get(o.order_id)?.assignee === me)
        .sort((a, b) => b.planned_on.localeCompare(a.planned_on) || (store.work.get(a.order_id)?.seq ?? 1e9) - (store.work.get(b.order_id)?.seq ?? 1e9) || a.order_id.localeCompare(b.order_id))
        .map((o): WorkOrderListRow => {
          const w = store.work.get(o.order_id)
          return { order_id: o.order_id, product_name: e.product(o.product_id)?.name ?? '', planned_on: o.planned_on, planned_kg: o.planned_kg, status: o.status, tank: w?.tank ?? null, seq: w?.seq ?? null }
        })
    },
    async setWorkOrder(input) {
      const o = e.order(input.order_id)
      await need('work_orders', o?.business_id ?? null)
      seedWork()
      if (!o || !isChair(o.business_id)) throw new Error('cost_not_found')
      if ((input.tank && input.tank.length > 40) || (input.seq !== null && !(Number.isInteger(input.seq) && input.seq >= 0 && input.seq <= 1e6))) throw new Error('cost_invalid')
      if (input.assignee && !DUMMY_PEOPLE.some((p) => p.user_id === input.assignee)) throw new Error('cost_invalid')
      store.work.set(input.order_id, { tank: input.tank?.trim() || null, seq: input.seq, assignee: input.assignee, hide_names: input.hide_names })
      console.info('[dummy audit] 작업지시(0081)', input.order_id)
    },

    // ⑧ 제품 진단
    async productDiagnosis(productId) {
      const p = e.product(productId)
      await need('product_diagnosis', p?.business_id ?? null)
      if (!p) throw new Error('cost_not_found')
      const biz = p.business_id
      const gt = e.gate(biz, productId, 'diagnosis')
      const role: 'chairman' | 'costing' | 'sales' = gt.chairman ? 'chairman' : canRole('costing', biz) ? 'costing' : 'sales'
      const ok = gt.chairman || (e.businessComplete(biz, 'market', gt.as_of) && e.businessComplete(biz, 'current', gt.as_of))
      const totalRaw = ok ? e.totalRaw(productId, biz, gt.as_of) : null
      const mk = ok ? e.materialCost(productId, 'market', gt.as_of) : null
      const cards: DiagnosisCard[] = []
      const card = (id: number, key: string, value: Record<string, unknown> | null, needText: string) =>
        cards.push({ id, key, state: value ? 'ok' : 'no_data', value, need: value ? null : needText })
      const lots = d.ledger().lots
      const actualOf = (pl: ProdLot) => {
        const ins = e.inputs(biz).filter((i) => i.prod_lot_id === pl.prod_lot_id)
        if (!ins.length) return null
        const amt = ins.reduce((t, i) => t + i.qty_kg * (lots.find((l) => l.lot_id === i.lot_id)?.landed_krw_per_kg ?? 0), 0)
        return amt / pl.output_kg
      }

      if (role !== 'sales') {
        const pl = e
          .prodLots(biz)
          .filter((x) => x.product_id === productId && actualOf(x) !== null)
          .sort((a, b) => b.produced_on.localeCompare(a.produced_on) || b.created_at.localeCompare(a.created_at))[0]
        card(1, 'actual', pl ? { krw_per_kg: shown(actualOf(pl), gt.chairman), prod_lot_id: pl.prod_lot_id, produced_on: pl.produced_on } : null, '생산 LOT 기록(투입 원료 LOT 포함)')
        card(2, 'current_total', totalRaw !== null ? { krw_per_kg: shown(totalRaw, gt.chairman) } : null, '원료 단가(구매 LOT) · 비용 마스터')
        card(3, 'market_material', mk !== null ? { krw_per_kg: shown(mk, gt.chairman) } : null, '원료 시장가')
      }
      if (role === 'chairman') {
        const mats = new Set((e.bomOn(productId, gt.as_of)?.lines ?? []).map((l) => l.material_id))
        const sav = sumOrNull(
          lots
            .filter((x) => x.business_id === biz && !x.voided_at && x.received_on > addDays(gt.as_of, -90) && x.received_on <= gt.as_of && mats.has(x.material_id))
            .map((x) => {
              const m = marketOn(x.material_id, x.received_on)
              return m === null ? null : (m - x.unit_price * x.fx_rate) * x.qty_kg
            }),
        )
        card(4, 'purchase_savings', sav !== null ? { krw: sav, days: 90 } : null, '최근 90일 구매 LOT · 그날 시장가')
      }
      const c = competitorCalc(productId, biz, gt.as_of, gt.chairman, ok)
      card(
        5,
        'competitor',
        c.comp_min !== null && c.our_total !== null
          ? {
              competitor_min_krw_per_kg: shown(c.comp_min, gt.chairman),
              our_target_krw_per_kg: shown(c.our_total / 0.8, gt.chairman),
              our_margin_at_competitor_pct: c.margin_at === null ? null : pgRound(c.margin_at, 1),
              grade: costGrade(c.margin_at),
              assumed_defaults: !c.has,
            }
          : null,
        '경쟁사 가정 · 원가',
      )
      card(6, 'min_price', totalRaw !== null ? { krw_per_kg: shown(totalRaw / 0.85, gt.chairman), margin_pct: 15 } : null, '원료 단가 · 비용 마스터')
      card(7, 'target_price', totalRaw !== null ? { krw_per_kg: shown(totalRaw / 0.8, gt.chairman), margin_pct: 20 } : null, '원료 단가 · 비용 마스터')
      const me = dummyViewer().user_id
      const recent = dummySaleRows().filter((s) => s.product_id === productId && s.shipped_on > addDays(gt.as_of, -90) && s.shipped_on <= gt.as_of && (role !== 'sales' || s.created_by === me))
      const byCust = new Map<string, { rev: number; kg: number }>()
      for (const s of recent) {
        const x = byCust.get(s.customer_company) ?? { rev: 0, kg: 0 }
        x.rev += s.kg * s.price_krw_per_kg
        x.kg += s.kg
        byCust.set(s.customer_company, x)
      }
      const top = [...byCust.entries()].sort((a, b) => b[1].rev - a[1].rev || a[0].localeCompare(b[0])).slice(0, 5)
      card(8, 'top_customers', top.length ? { customers: top.map(([customer, x]) => ({ customer, revenue_krw: shown(x.rev, gt.chairman), kg: x.kg })), days: 90 } : null, '최근 90일 판매 기록')

      if (role !== 'sales') {
        const xs = saleCosts(biz, addDays(gt.as_of, -89), gt.as_of, null)
        const byP = new Map<string, { rev: number; gm: number; revOk: number; ok: number }>()
        for (const x of xs) {
          const q = byP.get(x.product_id) ?? { rev: 0, gm: 0, revOk: 0, ok: 0 }
          q.rev += x.kg * x.price_krw_per_kg
          if (x.total_raw !== null) {
            q.gm += x.kg * (x.price_krw_per_kg - x.total_raw)
            q.revOk += x.kg * x.price_krw_per_kg
            q.ok++
          }
          byP.set(x.product_id, q)
        }
        const list = [...byP.entries()].map(([k, q]) => ({ k, rev: q.rev, pct: q.ok && q.revOk > 0 ? q.gm / q.revOk : null }))
        const mine = list.find((x) => x.k === productId)
        card(
          9,
          'rank',
          mine
            ? {
                revenue_rank: 1 + list.filter((x) => x.rev > mine.rev).length,
                gm_rank: mine.pct === null ? list.filter((x) => x.pct !== null).length + 1 : 1 + list.filter((x) => x.pct !== null && x.pct > mine.pct!).length,
                n_products: list.length,
                days: 90,
              }
            : null,
          '최근 90일 판매 기록',
        )
        const thisM = `${gt.as_of.slice(0, 7)}-01`
        const br = bridgeCalc(biz, addMonthsIso(thisM, -1), addDays(thisM, -1), thisM, gt.as_of, productId, gt.chairman)
        if (br.effects) {
          const keys: BridgeKey[] = ['price', 'material', 'mfg', 'logi', 'other']
          const big = [...keys].sort((a, b) => Math.abs(br.effects![b]) - Math.abs(br.effects![a]) || a.localeCompare(b))[0]
          card(
            10,
            'margin_drop',
            { total_krw_per_kg: br.total, biggest: big, biggest_krw_per_kg: br.effects[big], material_pct: br.material_pct, ...(gt.chairman ? { top_material: br.materials?.[0] ?? null } : {}) },
            '판매 기록 2개월(지난달 · 이번 달)',
          )
        } else card(10, 'margin_drop', null, '판매 기록 2개월(지난달 · 이번 달)')

        if (gt.chairman) {
          const bom = e.bomOn(productId, gt.as_of)
          const names = new Map(d.ledger().materials.map((m) => [m.material_id, m.name]))
          const best = (bom?.lines ?? [])
            .map((l) => {
              const now = e.unitPrice(l.material_id, 'current', gt.as_of)
              const prev = e.unitPrice(l.material_id, 'current', addDays(gt.as_of, -7))
              return { name: names.get(l.material_id) ?? l.material_id, d: now === null || prev === null ? null : (l.kg_per_kg / (bom!.yield_pct / 100)) * (now - prev) }
            })
            .filter((x) => x.d !== null)
            .sort((a, b) => Math.abs(b.d!) - Math.abs(a.d!) || a.name.localeCompare(b.name))[0]
          card(11, 'cost_rise', best ? { material_name: best.name, delta_krw_per_kg: best.d, days: 7 } : null, 'BOM · 7일 전 · 오늘 원료 단가')
        } else {
          const prevDay = addDays(gt.as_of, -7)
          const okPrev = ok && e.businessComplete(biz, 'current', prevDay)
          const now = okPrev ? e.materialCost(productId, 'current', gt.as_of) : null
          const prev = okPrev ? e.materialCost(productId, 'current', prevDay) : null
          const on = e.overhead(biz, productId, gt.as_of)
          const op = e.overhead(biz, productId, prevDay)
          card(
            11,
            'cost_rise',
            now !== null && prev !== null && prev > 0
              ? { material_pct: pgRound((now / prev - 1) * 100, 1), overhead_delta_krw_per_kg: on.ready && op.ready ? shown(on.total! - op.total!, false) : null, days: 7 }
              : null,
            '7일 전 · 오늘 원가(회사 원료 단가 전부)',
          )
        }
      }
      return { product_id: productId, product_name: p.name, role, as_of: gt.as_of, cards: cards.sort((a, b) => a.id - b.id) }
    },
    async productTrend(productId, grain, from, to) {
      const p = e.product(productId)
      await need('product_diagnosis', p?.business_id ?? null)
      if (!['day', 'week', 'month', 'quarter', 'year'].includes(grain) || !ISO.test(from) || !ISO.test(to) || from > to) throw new Error('cost_invalid')
      if (!p || !(isChair(p.business_id) || canRole('costing', p.business_id))) throw new Error('cost_not_found')
      const starts = periodStarts(grain, from, to)
      if (!starts) throw new Error('cost_invalid')
      const biz = p.business_id
      const gt = e.gate(biz, productId, 'trend')
      const ok = gt.chairman || e.businessComplete(biz, 'market', gt.as_of)
      const lots = d.ledger().lots
      const sc = saleCosts(biz, starts[0], periodEnd(starts[starts.length - 1], grain), productId)
      const pls = e.prodLots(biz).filter((x) => x.product_id === productId)
      const ins = e.inputs(biz)
      return starts.map((ps): ProductTrendPoint => {
        const pe = addDays(nextPeriod(ps, grain), -1)
        const xs = sc.filter((x) => x.shipped_on >= ps && x.shipped_on <= pe)
        const kg = xs.reduce((t, x) => t + x.kg, 0)
        const okx = xs.filter((x) => x.total_raw !== null)
        const revOk = okx.reduce((t, x) => t + x.kg * x.price_krw_per_kg, 0)
        const gm = okx.length && revOk > 0 ? (okx.reduce((t, x) => t + x.kg * (x.price_krw_per_kg - x.total_raw!), 0) / revOk) * 100 : null
        const made = pls
          .filter((x) => x.produced_on >= ps && x.produced_on <= pe)
          .map((x) => {
            const mine = ins.filter((i) => i.prod_lot_id === x.prod_lot_id)
            return mine.length ? { out: x.output_kg, amt: mine.reduce((t, i) => t + i.qty_kg * (lots.find((l) => l.lot_id === i.lot_id)?.landed_krw_per_kg ?? 0), 0) } : null
          })
          .filter((x): x is { out: number; amt: number } => x !== null)
        const outKg = made.reduce((t, x) => t + x.out, 0)
        const market = gt.chairman ? e.materialCost(productId, 'market', pe) : ok && gt.as_of >= ps && gt.as_of <= pe ? shown(e.materialCost(productId, 'market', gt.as_of), false) : null
        return {
          period_start: ps,
          kg: xs.length ? kg : null,
          price_krw_per_kg: xs.length ? shown(xs.reduce((t, x) => t + x.kg * x.price_krw_per_kg, 0) / kg, gt.chairman) : null,
          actual_krw_per_kg: outKg > 0 ? shown(made.reduce((t, x) => t + x.amt, 0) / outKg, gt.chairman) : null,
          market_material_krw_per_kg: market,
          gm_pct: gm === null ? null : pgRound(gm, 1),
        }
      })
    },
  }
}
