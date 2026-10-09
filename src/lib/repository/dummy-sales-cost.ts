import { kstToday } from '@/lib/chairman-project'
import { isoMonday } from '@/lib/purchasing/calc'
import { costGrade, materialImpactPct, pgRound, round10, salesOffers } from '@/lib/sales/cost'
import type { CostProduct, IsoDate, PriceCheck, SalesCostView } from '@/types'

import { dummyHasBusiness, dummyModuleGrants, dummyViewer } from './dummy-org'
import { dummyCostCan, dummyCostLedger } from './dummy-purchasing'
import type { SalesCostMethods } from './types'

/**
 * 원가 엔진 — 영업 원가의 dummy 자리. **DB(0062)가 막는 것을 여기서도 막는다**:
 *   · 대표 외는 이번 주 월요일 0시(KST) 스냅샷 하나 — 기준일 = 그 주 월요일, 그 시각까지 들어와 있던(무효 아닌) 시세 · LOT만
 *   · 총액 · 제시가 10원/kg 반올림 · 등급 20 / 15 · 원료비 영향 0.1%p
 *   · 원가 관리 또는 영업 줄이 있어야(아니면 cost_not_found) · 구매 입력 줄을 같이 가지면 cost_role_conflict · 하루 200건(cost_rate_limited)
 *   · 사용 중 원료 하나라도 단가가 없으면 대표 외에게는 계산하지 않는다(business_complete)
 *
 * **가짜 BOM은 이 파일 안(globalThis 저장소)에만 있다.** 이 파일 밖으로 원료 · 비율을 내보내는 함수가 없다 — 영업 화면이 받는 것은
 * SalesCostView(제품 총액)뿐이다. 진짜 BOM이 아니다(제품 이름에 «(가짜)»). dummy 모드가 아니면 이 파일은 불리지 않는다
 * (lib/repository/index.ts — live는 supabase-sales-cost.ts).
 */

interface BomVersion {
  product_id: string
  valid_from: IsoDate
  yield_pct: number
  lines: { material_id: string; kg_per_kg: number }[]
}

interface Store {
  products: CostProduct[]
  boms: BomVersion[]
  /** 'uid|read_on|product|kind|as_of' → 호출 수(0062 cost_secret.cost_reads). */
  reads: Map<string, number>
  /** 감사 한 줄(0062 cost_gate가 audit_log에 적는 것) — 대표 감시 카드가 센다. */
  audit: { user_id: string; business_id: string; at: string }[]
  /** 'uid|module' → 줄이 생긴 시각(0002 user_module_access.granted_at 흉내). */
  grantedAt: Map<string, string>
}

const DY = 'biz_dy'
const DAY = 86_400_000

function day(n: number): IsoDate {
  return kstToday(new Date(Date.now() + n * DAY))
}

function seed(): Store {
  const product = (product_id: string, name: string, sku: string): CostProduct => ({ product_id, business_id: DY, name, sku, pack_kg: 20, active: true })
  return {
    products: [
      product('prd_fake_x', '제품 X(가짜)', 'FX-20'),
      product('prd_fake_y', '제품 Y(가짜)', 'FY-20'),
      product('prd_fake_z', '제품 Z(가짜)', 'FZ-20'),
    ],
    boms: [
      {
        product_id: 'prd_fake_x',
        valid_from: day(-120),
        yield_pct: 95,
        lines: [
          { material_id: 'mat_fake_a', kg_per_kg: 0.6 },
          { material_id: 'mat_fake_b', kg_per_kg: 0.35 },
          { material_id: 'mat_fake_d', kg_per_kg: 0.05 },
        ],
      },
      {
        product_id: 'prd_fake_y',
        valid_from: day(-120),
        yield_pct: 98,
        lines: [
          { material_id: 'mat_fake_a', kg_per_kg: 0.3 },
          { material_id: 'mat_fake_c', kg_per_kg: 0.65 },
          { material_id: 'mat_fake_d', kg_per_kg: 0.05 },
        ],
      },
      // Z는 BOM이 다음 달부터 — «이번 주 원가 계산 전» 줄을 보여 주는 자리.
      { product_id: 'prd_fake_z', valid_from: day(30), yield_pct: 100, lines: [{ material_id: 'mat_fake_a', kg_per_kg: 1 }] },
    ],
    reads: new Map(),
    audit: [],
    grantedAt: new Map([[`dummy|/costing/${DY}`, new Date(Date.now() - 30 * DAY).toISOString()]]),
  }
}

// globalThis — webpack dev는 서버 액션 층과 화면 층이 이 모듈을 따로 읽는다(dummy-purchasing.ts와 같은 이유).
const g = globalThis as unknown as { __chairmanDummySalesCost?: Store }
const store: Store = (g.__chairmanDummySalesCost ??= seed())

/** 월요일 0시(KST)의 시각(ms). */
function kstMidnight(d: IsoDate): number {
  return Date.parse(`${d}T00:00:00+09:00`)
}

/** 0062 cost_secret.unit_price — 그 시각에 이미 들어와 있었고 아직 무효가 아니던 줄만. */
function unitPrice(materialId: string, kind: 'market' | 'current', on: IsoDate, known: number): number | null {
  const ledger = dummyCostLedger()
  const seen = (r: { created_at: string; voided_at: string | null }) =>
    Date.parse(r.created_at) <= known && (r.voided_at === null || Date.parse(r.voided_at) > known)
  if (kind === 'market') {
    const rows = ledger.prices.filter((p) => p.material_id === materialId && p.observed_on <= on && seen(p))
    if (rows.length === 0) return null
    const latest = rows.reduce((m, p) => (p.observed_on > m ? p.observed_on : m), rows[0].observed_on)
    const same = rows.filter((p) => p.observed_on === latest)
    return same.reduce((s, p) => s + p.price_krw_per_kg, 0) / same.length
  }
  const lots = ledger.lots.filter((l) => l.material_id === materialId && l.received_on <= on && seen(l))
  const from = new Date(Date.parse(`${on}T00:00:00Z`) - 180 * DAY).toISOString().slice(0, 10)
  const window = lots.filter((l) => l.received_on > from)
  const kg = window.reduce((s, l) => s + l.qty_kg, 0)
  if (kg > 0) return window.reduce((s, l) => s + l.landed_krw_per_kg * l.qty_kg, 0) / kg
  const last = [...lots].sort((a, b) => b.received_on.localeCompare(a.received_on) || b.created_at.localeCompare(a.created_at))[0]
  return last ? last.landed_krw_per_kg : null
}

function versionOn(productId: string, on: IsoDate): BomVersion | null {
  return store.boms.filter((b) => b.product_id === productId && b.valid_from <= on).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0] ?? null
}

/** 0062 cost_secret.material_cost — 반올림 전 원료비. 단가 하나라도 없으면 null. */
function materialCost(productId: string, kind: 'market' | 'current', on: IsoDate, known: number): number | null {
  const v = versionOn(productId, on)
  if (!v) return null
  let total = 0
  for (const l of v.lines) {
    const up = unitPrice(l.material_id, kind, on, known)
    if (up === null) return null
    total += (l.kg_per_kg / (v.yield_pct / 100)) * up
  }
  return total
}

/** 0062 cost_secret.business_complete — 그 회사 사용 중 원료(+그 날 BOM에 든 원료) 전부에 단가가 있는가. */
function businessComplete(businessId: string, kind: 'market' | 'current', on: IsoDate, known: number): boolean {
  const inBom = new Set(store.boms.filter((b) => versionOn(b.product_id, on) === b).flatMap((b) => b.lines.map((l) => l.material_id)))
  return dummyCostLedger()
    .materials.filter((m) => m.business_id === businessId && (m.active || inBom.has(m.material_id)))
    .every((m) => unitPrice(m.material_id, kind, on, known) !== null)
}

/**
 * 0062 cost_secret.cost_gate. 제품 하나(cost_sales_view) 또는 회사 전체 목록(cost_sales_list — 한도에 한 번만 센다).
 * 겸직: 원가 관리 = 구매 입력 줄이 있으면 거부. 영업(원가 관리 아님) = 구매 줄(보기만이라도) · 생산 줄이 하나라도 있으면 거부.
 */
function gateFor(businessId: string, target: string, kind: string): { as_of: IsoDate; known: number; chairman: boolean } {
  const v = dummyViewer()
  if (v.revoked_at || v.role === 'AIAgent' || v.role === 'Integration') throw new Error('cost_not_found')
  const today = kstToday()
  if (v.role === 'Chairman') {
    if (!dummyHasBusiness(v, businessId)) throw new Error('cost_not_found')
    return { as_of: today, known: Infinity, chairman: true }
  }
  const costing = dummyCostCan('costing', businessId)
  if (!(costing || dummyCostCan('sales', businessId))) throw new Error('cost_not_found')
  const rows = dummyModuleGrants(v.user_id)
  const conflict = costing
    ? rows.some((m) => m.module === `/purchasing/${businessId}` && m.can_write)
    : rows.some((m) => m.module === `/purchasing/${businessId}` || m.module === `/production/${businessId}`)
  if (conflict) throw new Error('cost_role_conflict')
  const asOf = isoMonday(today)
  const prefix = `${v.user_id}|${today}|`
  const used = [...store.reads].filter(([k]) => k.startsWith(prefix)).reduce((s, [, n]) => s + n, 0)
  if (used >= 200) throw new Error('cost_rate_limited')
  const key = `${prefix}${target}|${kind}|${asOf}`
  const fresh = !store.reads.has(key)
  store.reads.set(key, (store.reads.get(key) ?? 0) + 1)
  // 원가 관리는 호출마다, 영업은 하루 · 대상 · 종류 · 기준일마다 한 줄.
  if (fresh || costing) store.audit.push({ user_id: v.user_id, business_id: businessId, at: new Date().toISOString() })
  return { as_of: asOf, known: kstMidnight(asOf), chairman: false }
}

/** 문을 지난 뒤 제품 하나의 영업 원가(0062 cost_sales_view 본문). */
function viewAfterGate(productId: string, businessId: string, gt: { as_of: IsoDate; known: number; chairman: boolean }): SalesCostView {
  const ok = gt.chairman || (businessComplete(businessId, 'market', gt.as_of, gt.known) && businessComplete(businessId, 'current', gt.as_of, gt.known))
  const prev = new Date(Date.parse(`${gt.as_of}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10)
  const mkRaw = ok ? materialCost(productId, 'market', gt.as_of, gt.known) : null
  const cuRaw = ok ? materialCost(productId, 'current', gt.as_of, gt.known) : null
  // 지난 주 값도 회사 단위로 완전할 때만(0062 sales_row v_prev_ok — 아니면 «새 원료가 든 제품만 영향 없음»이 소속을 알려 준다).
  const prevOk = gt.chairman || businessComplete(businessId, 'current', prev, gt.known)
  const prRaw = ok && prevOk ? materialCost(productId, 'current', prev, gt.known) : null
  const mk = mkRaw === null ? null : round10(mkRaw)
  const cu = cuRaw === null ? null : round10(cuRaw)
  const total = cu // 0065 비용 마스터가 오면 + 배부 비용
  return {
    product_id: productId,
    as_of: gt.as_of,
    market_krw_per_kg: mk,
    current_krw_per_kg: cu,
    advantage_krw_per_kg: mk === null || cu === null ? null : mk - cu,
    overhead_krw_per_kg: null,
    total_krw_per_kg: total,
    overhead_ready: false,
    material_impact_pct: materialImpactPct(cuRaw, prRaw),
    computed: cu !== null,
    offers: salesOffers(total),
  }
}

function salesView(productId: string): SalesCostView {
  const p = store.products.find((x) => x.product_id === productId)
  if (!p) throw new Error('cost_not_found')
  return viewAfterGate(productId, p.business_id, gateFor(p.business_id, productId, 'sales_view'))
}

/** dummy 대표 감시(dummy.ts costingWatch)가 세는 원가 조회 감사 줄. */
export function dummyCostReadAudit(): { user_id: string; business_id: string; at: string }[] {
  return store.audit.map((a) => ({ ...a }))
}

/** '/costing/<biz>' 줄이 생긴 시각 — 시드의 줄은 30일 전, 사용자 화면에서 켜면 그때. */
export function dummyGrantedAt(userId: string, module: string): string | null {
  return store.grantedAt.get(`${userId}|${module}`) ?? store.grantedAt.get(`dummy|${module}`) ?? null
}

export function noteDummyGrant(userId: string, module: string, on: boolean): void {
  if (on) {
    if (!store.grantedAt.has(`${userId}|${module}`)) store.grantedAt.set(`${userId}|${module}`, new Date().toISOString())
  } else store.grantedAt.delete(`${userId}|${module}`)
}

export function dummySalesCost(): Omit<SalesCostMethods, 'costingWatch'> {
  return {
    async costSalesList(businessId) {
      if (!/^[a-z0-9_]+$/.test(businessId)) throw new Error('cost_not_found')
      const gt = gateFor(businessId, `biz:${businessId}`, 'sales_list')
      return store.products
        .filter((p) => p.business_id === businessId && p.active)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
        .map((p) => ({ ...viewAfterGate(p.product_id, businessId, gt), product_name: p.name }))
    },

    async costSalesView(productId) {
      return salesView(productId)
    },

    async costPriceCheck(productId, price): Promise<PriceCheck> {
      if (!Number.isFinite(price) || price <= 0 || price > 1e9) throw new Error('cost_price_invalid')
      const v = salesView(productId)
      if (v.total_krw_per_kg === null) return { total_krw_per_kg: null, margin_krw_per_kg: null, margin_pct: null, grade: null }
      const pct = pgRound(((price - v.total_krw_per_kg) / price) * 100, 1)
      return { total_krw_per_kg: v.total_krw_per_kg, margin_krw_per_kg: price - v.total_krw_per_kg, margin_pct: pct, grade: costGrade(pct) }
    },
  }
}
