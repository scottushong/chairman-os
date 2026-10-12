import { kstToday } from '@/lib/chairman-project'
import { materialImpactPct, priceCheck, round1, salesOffers, shown } from '@/lib/sales/cost'
import {
  OVERHEAD_CATEGORIES,
  OVERHEAD_GROUPS,
  overheadGroupOf,
  type AllocBasis,
  type AllocSettings,
  type BomCurrent,
  type BomVersionRow,
  type CostingRow,
  type CostProduct,
  type IsoDate,
  type LotAdjustment,
  type LotBalance,
  type Overhead,
  type OverheadGroup,
  type OverheadSummaryRow,
  type PriceCheck,
  type ProdActualRow,
  type ProdInput,
  type ProdLot,
  type ProductionOrder,
  type ProductionOrderLine,
  type PurchaseLot,
  type SalesCostView,
} from '@/types'

import { dummyHasBusiness, dummyModuleGrants, dummyViewer } from './dummy-org'
import { dummyCostCan, dummyCostLedger, setDummyLotInUseCheck } from './dummy-purchasing'
import type { CostsMethods, ProductionMethods, SalesCostMethods } from './types'

/**
 * 원가 엔진 — 영업 원가 · 생산 · 원가 관리 · 대표 BOM의 dummy 자리(«DB 안»의 흉내). **DB(0062~0065)가 막는 것을 여기서도 막는다**:
 *   · 매일 최신(회장 결정 2026-10-09 밤) — 대표 외 기준일 = 오늘(KST), 지금 저장된(무효 아닌) 시세 · LOT · BOM · 생산 그대로
 *   · 원래 값으로 끝까지 계산 → 대표 외는 나가는 칸만 1원(대표는 원래 값) · 등급은 반올림 전 %로 20 / 15 · 원료비 영향 0.1%p
 *   · 원가 관리 또는 영업 줄이 있어야(아니면 cost_not_found) · 구매 입력 줄을 같이 가지면 cost_role_conflict · 하루 200건 · 목록 하루 20번
 *   · 사용 중 원료 하나라도 단가가 없으면 대표 외에게는 계산하지 않는다(business_complete)
 *   · 0064 Current = 기준일 남은 LOT 잔량 가중 landed · 잔량 초과 투입 · 조정 거부 · 오더 상태 · 투입 kg 합은 대표만 · 분해는 대표만
 *   · 0065 비용 = 월 금액 ÷ 배부 kg(직전 N일 생산 또는 계획) + 원/kg · 같은 항목 새 줄이 방식과 상관없이 앞 줄을 대신 ·
 *     비용 줄이 있는데 배부를 못 하면 총원가 계산 안 함(0065 리뷰 I1)
 *
 * **가짜 BOM은 이 파일 안(globalThis 저장소)에만 있다.** 원료 · 비율을 내보내는 것은 대표 BOM 메서드(bom* · productBreakdown)와
 * 대표 Actual 분해뿐이고 모두 대표 문을 지난다. 작업지시 수량은 BOM × 계획 kg로 발행 때 한 번 만든다(0064 cost_production_issue).
 * 진짜 BOM이 아니다(제품 · 원료 이름에 «(가짜)»). dummy 모드가 아니면 이 파일은 불리지 않는다(lib/repository/index.ts).
 * 키 없음 흉내: DUMMY_BOM_KEY=missing이면 BOM을 읽는 모든 길이 cost_bom_key_missing으로 멈춘다(0063).
 */

interface BomVersion {
  version_id: number
  product_id: string
  valid_from: IsoDate
  yield_pct: number
  is_fake: boolean
  note: string
  created_at: string
  voided_at: string | null
  void_reason: string | null
  lines: { material_id: string; kg_per_kg: number }[]
}

interface Store {
  products: CostProduct[]
  boms: BomVersion[]
  nextBomId: number
  realAllowed: boolean
  realChangedAt: string | null
  /** 'uid|read_on|product|kind|as_of' → 호출 수(0062 cost_secret.cost_reads). */
  reads: Map<string, number>
  /** 감사 한 줄(0062 cost_gate가 audit_log에 적는 것) — 대표 감시 카드가 센다. */
  audit: { user_id: string; business_id: string; at: string }[]
  /** 'uid|module' → 줄이 생긴 시각(0002 user_module_access.granted_at 흉내). */
  grantedAt: Map<string, string>
  // 0064 생산
  orders: ProductionOrder[]
  orderLines: ProductionOrderLine[]
  prodLots: ProdLot[]
  inputs: ProdInput[]
  adjustments: LotAdjustment[]
  nextInputId: number
  nextAdjId: number
  // 0065 비용
  overheads: Overhead[]
  nextOverheadId: number
  alloc: Map<string, AllocSettings>
}

const DY = 'biz_dy'
const DAY = 86_400_000
const RLS = 'new row violates row-level security policy'

function day(n: number): IsoDate {
  return kstToday(new Date(Date.now() + n * DAY))
}

function at(n: number, hh = 9): string {
  return new Date(`${day(n)}T${String(hh).padStart(2, '0')}:00:00+09:00`).toISOString()
}

/** 날짜 + n일(달력). */
function shiftDate(d: IsoDate, n: number): IsoDate {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
}

function hex6(): string {
  return Array.from({ length: 6 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')
}

const copy = <T extends object>(rows: T[]): T[] => rows.map((r) => ({ ...r }))

function seed(): Store {
  const product = (product_id: string, name: string, sku: string): CostProduct => ({ product_id, business_id: DY, name, sku, pack_kg: 20, active: true })
  const bom = (version_id: number, product_id: string, valid_from: IsoDate, yield_pct: number, lines: BomVersion['lines']): BomVersion => ({
    version_id,
    product_id,
    valid_from,
    yield_pct,
    is_fake: true,
    note: '시험용 가짜 판',
    created_at: at(-120),
    voided_at: null,
    void_reason: null,
    lines,
  })
  const s: Store = {
    products: [
      product('prd_fake_x', '제품 X(가짜)', 'FX-20'),
      product('prd_fake_y', '제품 Y(가짜)', 'FY-20'),
      product('prd_fake_z', '제품 Z(가짜)', 'FZ-20'),
    ],
    boms: [
      bom(1, 'prd_fake_x', day(-120), 95, [
        { material_id: 'mat_fake_a', kg_per_kg: 0.6 },
        { material_id: 'mat_fake_b', kg_per_kg: 0.35 },
        { material_id: 'mat_fake_d', kg_per_kg: 0.05 },
      ]),
      bom(2, 'prd_fake_y', day(-120), 98, [
        { material_id: 'mat_fake_a', kg_per_kg: 0.3 },
        { material_id: 'mat_fake_c', kg_per_kg: 0.65 },
        { material_id: 'mat_fake_d', kg_per_kg: 0.05 },
      ]),
      // Z는 BOM이 다음 달부터 — «이번 주 원가 계산 전» 줄을 보여 주는 자리.
      bom(3, 'prd_fake_z', day(30), 100, [{ material_id: 'mat_fake_a', kg_per_kg: 1 }]),
    ],
    nextBomId: 4,
    realAllowed: false,
    realChangedAt: null,
    reads: new Map(),
    audit: [],
    grantedAt: new Map([[`dummy|/costing/${DY}`, new Date(Date.now() - 30 * DAY).toISOString()]]),
    orders: [],
    orderLines: [],
    prodLots: [],
    inputs: [],
    adjustments: [],
    nextInputId: 1,
    nextAdjId: 1,
    overheads: [],
    nextOverheadId: 1,
    alloc: new Map(),
  }
  seedProduction(s)
  seedOverheads(s)
  return s
}

/** 생산 시드(가짜) — 끝난 오더 하나 · 진행 중 둘, 생산 LOT 둘과 투입, 조정 하나. 구매 LOT는 dummy-purchasing 시드에서 원료 · 입고일로 찾는다. */
function seedProduction(s: Store) {
  const lots = dummyCostLedger().lots
  const lotOf = (material: string, n: number) => lots.find((l) => l.material_id === material && l.received_on === day(n))?.lot_id
  const order = (product_id: string, n: number, kg: number, status: ProductionOrder['status'], note: string): ProductionOrder => {
    const o: ProductionOrder = {
      order_id: `PO-${day(n - 2).replace(/-/g, '')}-${hex6()}`,
      business_id: DY,
      product_id,
      planned_on: day(n),
      planned_kg: kg,
      status,
      note,
      created_at: at(n - 2),
      closed_at: status === 'open' ? null : at(n + 2),
    }
    s.orders.push(o)
    const v = versionIn(s, product_id, o.planned_on)!
    for (const l of v.lines) s.orderLines.push({ order_id: o.order_id, material_id: l.material_id, planned_kg: (l.kg_per_kg / (v.yield_pct / 100)) * kg })
    return o
  }
  const prodLot = (o: ProductionOrder, n: number, output: number, uses: [string, number, number][]) => {
    const pl: ProdLot = {
      prod_lot_id: `ML-${day(n).replace(/-/g, '')}-${hex6()}`,
      business_id: DY,
      order_id: o.order_id,
      product_id: o.product_id,
      produced_on: day(n),
      output_kg: output,
      note: '',
      created_at: at(n, 17),
      voided_at: null,
      void_reason: null,
    }
    s.prodLots.push(pl)
    for (const [material, lotDay, kg] of uses) {
      const lot_id = lotOf(material, lotDay)
      if (!lot_id) continue
      s.inputs.push({ input_id: s.nextInputId++, business_id: DY, prod_lot_id: pl.prod_lot_id, lot_id, material_id: material, qty_kg: kg, created_at: at(n, 18), voided_at: null, void_reason: null })
    }
  }
  const o1 = order('prd_fake_x', -10, 1000, 'done', '정기 생산(가짜)')
  prodLot(o1, -9, 985, [
    ['mat_fake_a', -26, 640],
    ['mat_fake_b', -20, 372],
    ['mat_fake_d', -40, 53],
  ])
  const o2 = order('prd_fake_y', -3, 800, 'open', '거래처 납품분(가짜)')
  prodLot(o2, -2, 790, [
    ['mat_fake_a', -26, 250],
    ['mat_fake_c', -15, 535],
    ['mat_fake_d', -40, 41],
  ])
  order('prd_fake_x', 1, 1200, 'open', '')
  const c = lotOf('mat_fake_c', -15)
  if (c) {
    s.adjustments.push({ adj_id: s.nextAdjId++, business_id: DY, lot_id: c, adjusted_on: day(-1), qty_kg: 4.5, reason: '드럼 바닥 잔량 폐기(가짜)', created_at: at(-1, 16), voided_at: null, void_reason: null })
  }
}

/** 비용 시드(가짜) — 월 금액 · 원/kg · 제품 하나 전용 단가 · 앞 줄을 대신한 줄 · 무효 줄. 배부는 계획 기준(월 12만 kg). */
function seedOverheads(s: Store) {
  const row = (category: Overhead['category'], basis: Overhead['basis'], amount: number, n: number, extra: Partial<Overhead> = {}) =>
    s.overheads.push({
      overhead_id: s.nextOverheadId++,
      business_id: DY,
      category,
      basis,
      amount,
      product_id: null,
      effective_from: day(n),
      note: '',
      created_at: at(n, 11),
      voided_at: null,
      void_reason: null,
      ...extra,
    })
  row('labor', 'monthly', 16_000_000, -90, { note: '가짜 — 작년 인건비' })
  row('labor', 'monthly', 18_000_000, -60, { note: '가짜 — 인상 반영' })
  row('power', 'monthly', 42_000_000, -60, { voided_at: at(-59), void_reason: '자릿수 오타(가짜)' })
  row('power', 'monthly', 4_200_000, -60)
  row('gas', 'monthly', 1_300_000, -60)
  row('depreciation', 'monthly', 2_500_000, -60)
  row('warehouse', 'monthly', 1_100_000, -60)
  row('rent', 'monthly', 3_000_000, -60)
  row('insurance', 'monthly', 400_000, -60)
  row('packaging', 'per_kg', 85, -60, { note: '20kg 봉투 · 라벨(가짜)' })
  row('pallet', 'per_kg', 12, -60)
  row('logistics', 'per_kg', 140, -60)
  row('commission', 'per_kg', 30, -30, { product_id: 'prd_fake_y', note: '대리점 커미션(가짜)' })
  s.alloc.set(DY, { business_id: DY, basis: 'plan', window_days: 28, planned_kg_month: 120_000, updated_at: at(-30) })
}

function versionIn(s: Store, productId: string, on: IsoDate): BomVersion | null {
  return (
    s.boms
      .filter((b) => b.product_id === productId && b.valid_from <= on && known(b))
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.version_id - a.version_id)[0] ?? null
  )
}

/**
 * 회장 결정(2026-10-10) (가) 거울 — 0062 cost_secret.known · cost.known_at. 문(gateFor)이 정한다: 영업 = 오늘 0시(KST, ms), 원가 관리 · 대표 = null(즉시).
 * dummy는 한 요청 안에서 문 → 계산이 이어서(await 없이) 돈다.
 */
let knownAt: number | null = null
const salesCutoffMs = () =>
  // 검사 전용(dummy만) — DUMMY_SALES_CUTOFF=now면 영업도 즉시(check:sales-cost 앞 절이 1원 · 정밀도를 대표 값과 맞춰 본다). live에는 이 길이 없다.
  process.env.DUMMY_SALES_CUTOFF === 'now' ? Date.now() + 2 * 86_400_000 : Date.parse(`${kstToday()}T00:00:00+09:00`)
const known = (r: { created_at: string; voided_at: string | null }) =>
  knownAt === null ? !r.voided_at : Date.parse(r.created_at) <= knownAt && (!r.voided_at || Date.parse(r.voided_at) > knownAt)
/** 0065 cost_alloc_settings.prev_* 거울 — 오늘 0시의 배부 기준(없었으면 null). */
const g2 = globalThis as unknown as { __chairmanDummyAllocPrev?: Map<string, AllocSettings | null> }
const allocPrev: Map<string, AllocSettings | null> = (g2.__chairmanDummyAllocPrev ??= new Map())

// globalThis — webpack dev는 서버 액션 층과 화면 층이 이 모듈을 따로 읽는다(dummy-purchasing.ts와 같은 이유).
// 키 이름에 생산 · 비용을 넣었다 — 0062 시절 저장소(생산 칸 없음)가 dev 서버에 남아 있어도 새로 만든다.
const g = globalThis as unknown as { __chairmanDummyCostEngine?: Store }
const store: Store = (g.__chairmanDummyCostEngine ??= seed())

// 0064 cost_lot_void_guard — 구매 LOT 무효 전에 살아 있는 투입 · 조정을 본다(dummy-purchasing.ts가 부른다).
setDummyLotInUseCheck(
  (lotId) =>
    store.inputs.some((i) => i.lot_id === lotId && !i.voided_at && store.prodLots.some((p) => p.prod_lot_id === i.prod_lot_id && !p.voided_at)) ||
    store.adjustments.some((a) => a.lot_id === lotId && !a.voided_at),
)

// ── BOM 해독 · 키(0063) ──────────────────────────────────────────────

/** 0063 cost_secret.bom_key — DUMMY_BOM_KEY=missing이면 키가 없는 DB. */
function bomKey() {
  if (process.env.DUMMY_BOM_KEY?.trim().toLowerCase() === 'missing') throw new Error('cost_bom_key_missing')
}

/** 0063 cost_secret.bom_lines_of — 해독은 여기 한 곳. */
function linesOf(v: BomVersion) {
  bomKey()
  return v.lines.map((l) => ({ ...l }))
}

function versionOn(productId: string, on: IsoDate): BomVersion | null {
  return versionIn(store, productId, on)
}

/** 0062 cost_secret.bom_reader — 대표(dummy에는 bom_access 줄이 없다). */
function bomReader(): boolean {
  const v = dummyViewer()
  return !v.revoked_at && v.role === 'Chairman'
}

// ── 잔량 · 단가(0064) ────────────────────────────────────────────────

/** 0064 cost_lot_remaining — 입고 kg − 투입(생산일 ≤ d) − 조정(조정일 ≤ d). d = null이면 전부. */
function lotRemaining(lot: PurchaseLot, on: IsoDate | null = null): number {
  const used = store.inputs
    .filter((i) => i.lot_id === lot.lot_id && known(i))
    .filter((i) => {
      const pl = store.prodLots.find((p) => p.prod_lot_id === i.prod_lot_id)
      return !!pl && known(pl) && (on === null || pl.produced_on <= on)
    })
    .reduce((t, i) => t + i.qty_kg, 0)
  const adj = store.adjustments.filter((a) => a.lot_id === lot.lot_id && known(a) && (on === null || a.adjusted_on <= on)).reduce((t, a) => t + a.qty_kg, 0)
  return lot.qty_kg - used - adj
}

/** 0064 cost_secret.unit_price — Market = 그 날 이하 최신 날의 평균, Current = 기준일 남은 LOT 잔량 가중 landed(없으면 마지막 LOT). */
function unitPrice(materialId: string, kind: 'market' | 'current', on: IsoDate): number | null {
  const ledger = dummyCostLedger()
  const seen = known
  if (kind === 'market') {
    const rows = ledger.prices.filter((p) => p.material_id === materialId && p.observed_on <= on && seen(p))
    if (rows.length === 0) return null
    const latest = rows.reduce((m, p) => (p.observed_on > m ? p.observed_on : m), rows[0].observed_on)
    const same = rows.filter((p) => p.observed_on === latest)
    return same.reduce((s, p) => s + p.price_krw_per_kg, 0) / same.length
  }
  const lots = ledger.lots.filter((l) => l.material_id === materialId && l.received_on <= on && seen(l))
  const left = lots.map((l) => ({ l, kg: lotRemaining(l, on) })).filter((x) => x.kg > 0)
  const kg = left.reduce((s, x) => s + x.kg, 0)
  if (kg > 0) return left.reduce((s, x) => s + x.l.landed_krw_per_kg * x.kg, 0) / kg
  const last = [...lots].sort((a, b) => b.received_on.localeCompare(a.received_on) || b.created_at.localeCompare(a.created_at))[0]
  return last ? last.landed_krw_per_kg : null
}

/** 0063 cost_secret.material_cost — 원래 값 원료비. 단가 하나라도 없으면 null. */
function materialCost(productId: string, kind: 'market' | 'current', on: IsoDate): number | null {
  const v = versionOn(productId, on)
  if (!v) return null
  let total = 0
  for (const l of linesOf(v)) {
    const up = unitPrice(l.material_id, kind, on)
    if (up === null) return null
    total += (l.kg_per_kg / (v.yield_pct / 100)) * up
  }
  return total
}

/** 0063 cost_secret.business_complete — 사용 중 원료 + 그 날 BOM에 든 단종 원료 전부에 단가가 있는가(해독은 단종 원료에 빈칸이 있을 때만). */
function businessComplete(businessId: string, kind: 'market' | 'current', on: IsoDate): boolean {
  const mats = dummyCostLedger().materials.filter((m) => m.business_id === businessId)
  if (mats.some((m) => m.active && unitPrice(m.material_id, kind, on) === null)) return false
  const gap = new Set(mats.filter((m) => !m.active && unitPrice(m.material_id, kind, on) === null).map((m) => m.material_id))
  if (gap.size === 0) return true
  return !store.products
    .filter((p) => p.business_id === businessId)
    .some((p) => {
      const v = versionOn(p.product_id, on)
      return !!v && linesOf(v).some((l) => gap.has(l.material_id))
    })
}

// ── 비용 배부(0065) ──────────────────────────────────────────────────

interface OverheadCalc {
  mfg: number | null
  pack: number | null
  logi: number | null
  indirect: number | null
  total: number | null
  ready: boolean
  has_lines: boolean
  basis_used: AllocBasis | null
  divisor_kg: number | null
  window_days: number | null
}

const liveOverheads = (businessId: string) => store.overheads.filter((o) => o.business_id === businessId && known(o))
const latestFirst = (a: Overhead, b: Overhead) => b.effective_from.localeCompare(a.effective_from) || b.overhead_id - a.overhead_id

/** 그 날 적용 중인 회사 전체 줄(항목마다 가장 늦은 줄 — 방식과 상관없이, 0065 리뷰 I2). */
function companyLineOn(businessId: string, category: string, on: IsoDate): Overhead | null {
  return liveOverheads(businessId)
    .filter((o) => o.category === category && o.product_id === null && o.effective_from <= on)
    .sort(latestFirst)[0] ?? null
}

/** 0065 cost_secret.overhead — 제품 p · 기준일 d의 kg당 비용(원래 값). */
function overhead(businessId: string, productId: string | null, on: IsoDate): OverheadCalc {
  const out: OverheadCalc = { mfg: null, pack: null, logi: null, indirect: null, total: null, ready: false, has_lines: false, basis_used: null, divisor_kg: null, window_days: null }
  out.has_lines = liveOverheads(businessId).some((o) => o.effective_from <= on)
  if (!out.has_lines) return out
  let s = store.alloc.get(businessId)
  // (가) 영업: 오늘 바꾼 배부 기준은 내일부터(0065 prev_*).
  if (s && knownAt !== null && s.updated_at && Date.parse(s.updated_at) > knownAt) s = allocPrev.get(businessId) ?? undefined
  const win = s?.window_days ?? 28
  out.window_days = win
  let basis: AllocBasis = s?.basis ?? 'trailing'
  let divisor: number | null = null
  if (basis === 'trailing') {
    const from = shiftDate(on, -win)
    const kg = store.prodLots.filter((p) => p.business_id === businessId && known(p) && p.produced_on > from && p.produced_on <= on).reduce((t, p) => t + p.output_kg, 0)
    divisor = kg > 0 ? kg : null
  }
  if (!divisor) {
    divisor = s?.planned_kg_month && s.planned_kg_month > 0 ? (s.planned_kg_month * 12 * win) / 365 : null
    if (divisor !== null) basis = 'plan'
  }
  out.basis_used = basis
  out.divisor_kg = divisor
  // 월 금액: 창의 날마다 그 날 적용 중인 회사 전체 줄 중 월 금액인 것 × 12 ÷ 365.
  const monthly: Record<OverheadGroup, number> = { mfg: 0, pack: 0, logi: 0, indirect: 0 }
  for (let k = 0; k < win; k++) {
    const d = shiftDate(on, -k)
    for (const c of OVERHEAD_CATEGORIES) {
      const line = companyLineOn(businessId, c, d)
      if (line && line.basis === 'monthly') monthly[overheadGroupOf(c)] += (line.amount * 12) / 365
    }
  }
  const anyMonthly = OVERHEAD_GROUPS.some((gr) => monthly[gr] > 0)
  if (anyMonthly && divisor === null) return out
  out.ready = true
  const per: Record<OverheadGroup, number> = { mfg: 0, pack: 0, logi: 0, indirect: 0 }
  for (const gr of OVERHEAD_GROUPS) per[gr] = anyMonthly ? monthly[gr] / divisor! : 0
  // 원/kg: 항목 × 범위(회사 전체 · 그 제품)마다 가장 늦은 줄이 원/kg일 때만.
  for (const c of OVERHEAD_CATEGORIES) {
    const scopes = productId === null ? [null] : [null, productId]
    for (const scope of scopes) {
      const line = liveOverheads(businessId).filter((o) => o.category === c && o.product_id === scope && o.effective_from <= on).sort(latestFirst)[0]
      if (line && line.basis === 'per_kg') per[overheadGroupOf(c)] += line.amount
    }
  }
  out.mfg = per.mfg
  out.pack = per.pack
  out.logi = per.logi
  out.indirect = per.indirect
  out.total = per.mfg + per.pack + per.logi + per.indirect
  return out
}

/** 총원가(Fully Loaded) 원래 값 — 0065 리뷰 I1: 비용 줄이 있는데 배부를 못 하면 null. */
function totalRaw(cu: number | null, o: OverheadCalc): number | null {
  if (cu === null) return null
  if (o.ready) return cu + o.total!
  return o.has_lines ? null : cu
}

// ── 문(0062 cost_gate) ───────────────────────────────────────────────

/**
 * 0062 cost_secret.cost_gate. 제품 하나(cost_sales_view) 또는 회사 전체 목록(cost_sales_list · cost_costing_list — 한도에 한 번만 센다).
 * 겸직: 원가 관리 = 구매 입력 줄이 있으면 거부. 영업(원가 관리 아님) = 구매 줄(보기만이라도) · 생산 줄이 하나라도 있으면 거부.
 */
function gateFor(businessId: string, target: string, kind: string, calls = 1): { as_of: IsoDate; chairman: boolean } {
  const v = dummyViewer()
  knownAt = null
  if (v.revoked_at || v.role === 'AIAgent' || v.role === 'Integration') throw new Error('cost_not_found')
  const today = kstToday()
  if (v.role === 'Chairman') {
    if (!dummyHasBusiness(v, businessId)) throw new Error('cost_not_found')
    return { as_of: today, chairman: true }
  }
  const costing = dummyCostCan('costing', businessId)
  if (!(costing || dummyCostCan('sales', businessId))) throw new Error('cost_not_found')
  const rows = dummyModuleGrants(v.user_id)
  const conflict = costing
    ? rows.some((m) => m.module === `/purchasing/${businessId}` && m.can_write)
    : rows.some((m) => m.module === `/purchasing/${businessId}` || m.module === `/production/${businessId}`)
  if (conflict) throw new Error('cost_role_conflict')
  const asOf = today
  // (가) 영업(원가 관리 줄 없음)은 오늘 0시까지 저장된 값.
  if (!costing) knownAt = salesCutoffMs()
  const prefix = `${v.user_id}|${today}|`
  const used = [...store.reads].filter(([k]) => k.startsWith(prefix)).reduce((s, [, n]) => s + n, 0)
  if (used + Math.max(calls, 1) > 200) throw new Error('cost_rate_limited')
  // 회사 전체 목록은 하루 20번까지(0062 리뷰 10-09 밤 C1 — 시세 입력 하나하나를 떼어 보려고 자주 찍는 길).
  if ((kind === 'sales_list' || kind === 'costing_list') && (store.reads.get(`${prefix}${target}|${kind}|${today}`) ?? 0) >= 20) {
    throw new Error('cost_rate_limited')
  }
  const key = `${prefix}${target}|${kind}|${asOf}`
  const fresh = !store.reads.has(key)
  store.reads.set(key, (store.reads.get(key) ?? 0) + Math.max(calls, 1))
  // 원가 관리는 호출마다, 영업은 하루 · 대상 · 종류마다 한 줄.
  if (fresh || costing || kind === 'sales_list') store.audit.push({ user_id: v.user_id, business_id: businessId, at: new Date().toISOString() })
  return { as_of: asOf, chairman: false }
}

interface Gate {
  as_of: IsoDate
  chairman: boolean
}

/** 문을 지난 뒤 제품 하나의 원래 값(0065 cost_secret.sales_row 앞부분). */
function rawAfterGate(productId: string, businessId: string, gt: Gate, withPrev = true) {
  const ok = gt.chairman || (businessComplete(businessId, 'market', gt.as_of) && businessComplete(businessId, 'current', gt.as_of))
  const prev = shiftDate(gt.as_of, -7)
  const mk = ok ? materialCost(productId, 'market', gt.as_of) : null
  const cu = ok ? materialCost(productId, 'current', gt.as_of) : null
  // 7일 전 값도 회사 단위로 완전할 때만(0062 sales_row v_prev_ok — 아니면 «새 원료가 든 제품만 영향 없음»이 소속을 알려 준다).
  const prevOk = withPrev && (gt.chairman || businessComplete(businessId, 'current', prev))
  const pr = ok && prevOk ? materialCost(productId, 'current', prev) : null
  const o = overhead(businessId, productId, gt.as_of)
  return { mk, cu, pr, o, total: totalRaw(cu, o) }
}

/** 0065 cost_sales_view 본문 — 원래 값으로 끝까지 계산하고 나가는 칸만 1원(대표 외). */
function viewAfterGate(productId: string, businessId: string, gt: Gate): SalesCostView {
  const { mk, cu, pr, o, total } = rawAfterGate(productId, businessId, gt)
  return {
    product_id: productId,
    as_of: gt.as_of,
    market_krw_per_kg: shown(mk, gt.chairman),
    current_krw_per_kg: shown(cu, gt.chairman),
    advantage_krw_per_kg: mk === null || cu === null ? null : shown(mk - cu, gt.chairman),
    overhead_krw_per_kg: cu !== null && o.ready ? shown(o.total, gt.chairman) : null,
    total_krw_per_kg: shown(total, gt.chairman),
    overhead_ready: o.ready,
    material_impact_pct: materialImpactPct(cu, pr),
    computed: total !== null,
    offers: salesOffers(total, gt.chairman),
  }
}

function salesView(productId: string): SalesCostView {
  const p = store.products.find((x) => x.product_id === productId)
  if (!p) throw new Error('cost_not_found')
  return viewAfterGate(productId, p.business_id, gateFor(p.business_id, productId, 'sales_view'))
}

/** dummy 대표 감시(dummy.ts costingWatch)가 세는 원가 조회 감사 줄. */
/** 0066 dummy 견적 — 제품의 회사 · 이름(권한 판정 없음 — 견적 함수가 한다). */
/** 0067 cost_margins의 문(cost_gate_biz 'margins:<회사>' · 'costing_list' — 하루 20번 · 호출마다 감사 · 겸직 거부). dummy-sales-margins.ts가 부른다. */
export function dummyMarginsGate(businessId: string): { as_of: IsoDate; chairman: boolean } {
  return gateFor(businessId, `margins:${businessId}`, 'costing_list')
}

export function dummyCostProduct(productId: string): { business_id: string; name: string } | null {
  const p = store.products.find((x) => x.product_id === productId)
  return p ? { business_id: p.business_id, name: p.name } : null
}

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
      const active = store.products.filter((p) => p.business_id === businessId && p.active)
      const gt = gateFor(businessId, `biz:${businessId}`, 'sales_list')
      return active
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
        .map((p) => ({ ...viewAfterGate(p.product_id, businessId, gt), product_name: p.name }))
    },

    async costSalesView(productId) {
      return salesView(productId)
    },

    async costPriceCheck(productId, price): Promise<PriceCheck> {
      if (!Number.isFinite(price) || price <= 0 || price > 1e9) throw new Error('cost_price_invalid')
      const p = store.products.find((x) => x.product_id === productId)
      if (!p) throw new Error('cost_not_found')
      const gt = gateFor(p.business_id, productId, 'price_check')
      // 대표 외 제시가는 1원 단위만(0062 리뷰 C2 — 소수 제시가로 원래 총원가를 이분 탐색하지 못하게).
      if (!gt.chairman && !Number.isInteger(price)) throw new Error('cost_price_invalid')
      // 마진은 원래 총원가로(0062 cost_price_check) — 1원 총원가로 빼지 않는다.
      const out = priceCheck(rawAfterGate(productId, p.business_id, gt, false).total, price, gt.chairman)!
      // 0066 리뷰 I3 — 대표 외 제시가 하한(1원 총원가의 절반).
      if (!gt.chairman && out.total_krw_per_kg !== null && price * 2 < out.total_krw_per_kg) throw new Error('cost_price_too_low')
      return out
    },
  }
}

// ── 생산(0064) ───────────────────────────────────────────────────────

/** 0064 무효(cost_void_update) — 한 번 · 이유 필수. 권한 · 회사가 맞지 않으면 0행(cost_not_found). */
function voidIn<T extends { business_id: string; voided_at: string | null; void_reason: string | null }>(row: T | undefined, businessId: string, reason: string, allowed: boolean) {
  if (!row || row.business_id !== businessId || !allowed) throw new Error('cost_not_found')
  if (row.voided_at) throw new Error('cost_already_voided')
  if (!reason.trim()) throw new Error('cost_void_reason')
  row.voided_at = new Date().toISOString()
  row.void_reason = reason.trim()
}

const canProd = (biz: string, write = false) => dummyCostCan('production', biz, write)

function purchaseLot(lotId: string): PurchaseLot | undefined {
  return dummyCostLedger().lots.find((l) => l.lot_id === lotId)
}

export function dummyProduction(): ProductionMethods {
  return {
    async listProductionOrders(businessId) {
      if (!(canProd(businessId) || dummyCostCan('costing', businessId))) return []
      return copy(store.orders.filter((o) => o.business_id === businessId)).sort((a, b) => b.planned_on.localeCompare(a.planned_on))
    },

    async listProductionOrderLines(orderIds) {
      // 대표 · 생산만(원가 관리 · 구매 · 영업은 RLS로 0행).
      return copy(
        store.orderLines.filter((l) => {
          const o = store.orders.find((x) => x.order_id === l.order_id)
          return orderIds.includes(l.order_id) && !!o && canProd(o.business_id)
        }),
      )
    },

    async issueProductionOrder(productId, plannedOn, plannedKg, note) {
      if (!bomReader()) throw new Error('cost_not_found')
      const p = store.products.find((x) => x.product_id === productId && x.active)
      if (!p || !dummyHasBusiness(dummyViewer(), p.business_id)) throw new Error('cost_not_found')
      if (!plannedOn || !Number.isFinite(plannedKg) || plannedKg <= 0 || plannedKg > 1e9) throw new Error('cost_order_invalid')
      const v = versionOn(productId, plannedOn)
      if (!v) throw new Error('cost_bom_missing')
      const lines = linesOf(v)
      if (lines.length === 0) throw new Error('cost_bom_missing')
      const o: ProductionOrder = {
        order_id: `PO-${kstToday().replace(/-/g, '')}-${hex6()}`,
        business_id: p.business_id,
        product_id: productId,
        planned_on: plannedOn,
        planned_kg: plannedKg,
        status: 'open',
        note: note.slice(0, 500),
        created_at: new Date().toISOString(),
        closed_at: null,
      }
      store.orders.push(o)
      for (const l of lines) store.orderLines.push({ order_id: o.order_id, material_id: l.material_id, planned_kg: (l.kg_per_kg / (v.yield_pct / 100)) * plannedKg })
      return o.order_id
    },

    async closeProductionOrder(businessId, orderId, status) {
      const o = store.orders.find((x) => x.order_id === orderId && x.business_id === businessId)
      if (!o || !canProd(businessId, true)) throw new Error('cost_not_found')
      // 0064 cost_order_update — open에서만, 취소는 대표만.
      if (o.status !== 'open' || !['done', 'cancelled'].includes(status)) throw new Error('cost_order_closed')
      if (status === 'cancelled' && dummyViewer().role !== 'Chairman') throw new Error('cost_order_closed')
      o.status = status
      o.closed_at = new Date().toISOString()
    },

    async listProdLots(businessId) {
      if (!(canProd(businessId) || dummyCostCan('costing', businessId))) return []
      return copy(store.prodLots.filter((p) => p.business_id === businessId)).sort((a, b) => b.produced_on.localeCompare(a.produced_on) || b.created_at.localeCompare(a.created_at))
    },

    async addProdLot(businessId, input) {
      // 0064 cost_prod_lot_fill — 권한 없는 사람에게는 아무 말 없이 RLS(리뷰 M1).
      if (!canProd(businessId, true)) throw new Error(RLS)
      const o = store.orders.find((x) => x.order_id === input.order_id)
      if (!o || o.status !== 'open' || o.business_id !== businessId) throw new Error('cost_order_closed')
      if (input.produced_on > day(1)) throw new Error('cost_date_future')
      if (!(input.output_kg > 0 && input.output_kg <= 1e9)) throw new Error('violates check constraint "cost_prod_lots_output_kg_check" (23514)')
      const row: ProdLot = {
        prod_lot_id: `ML-${kstToday().replace(/-/g, '')}-${hex6()}`,
        business_id: businessId,
        order_id: o.order_id,
        product_id: o.product_id,
        produced_on: input.produced_on,
        output_kg: input.output_kg,
        note: input.note.slice(0, 500),
        created_at: new Date().toISOString(),
        voided_at: null,
        void_reason: null,
      }
      store.prodLots.push(row)
      return { ...row }
    },

    async voidProdLot(businessId, prodLotId, reason) {
      voidIn(
        store.prodLots.find((p) => p.prod_lot_id === prodLotId),
        businessId,
        reason,
        canProd(businessId, true),
      )
    },

    async listProdInputs(businessId) {
      if (!canProd(businessId)) return []
      return copy(store.inputs.filter((i) => i.business_id === businessId)).sort((a, b) => b.input_id - a.input_id)
    },

    async addProdInput(businessId, input) {
      // 0064 cost_lot_draw_check — 권한 먼저(리뷰 M1) · LOT · 생산 LOT(입고일 이후 · 리뷰 M3) · 잔량.
      if (!canProd(businessId, true)) throw new Error(RLS)
      const l = purchaseLot(input.lot_id)
      if (!l || l.business_id !== businessId || l.voided_at) throw new Error('cost_lot_invalid')
      const pl = store.prodLots.find((p) => p.prod_lot_id === input.prod_lot_id && p.business_id === businessId && !p.voided_at && p.produced_on >= l.received_on)
      if (!pl) throw new Error('cost_prod_lot_invalid')
      if (!(input.qty_kg > 0 && input.qty_kg <= 1e9)) throw new Error('violates check constraint "cost_prod_inputs_qty_kg_check" (23514)')
      if (input.qty_kg > lotRemaining(l)) throw new Error('cost_lot_short')
      const row: ProdInput = {
        input_id: store.nextInputId++,
        business_id: businessId,
        prod_lot_id: pl.prod_lot_id,
        lot_id: l.lot_id,
        material_id: l.material_id,
        qty_kg: input.qty_kg,
        created_at: new Date().toISOString(),
        voided_at: null,
        void_reason: null,
      }
      store.inputs.push(row)
      return { ...row }
    },

    async voidProdInput(businessId, inputId, reason) {
      voidIn(
        store.inputs.find((i) => i.input_id === inputId),
        businessId,
        reason,
        canProd(businessId, true),
      )
    },

    async listLotAdjustments(businessId) {
      if (!(canProd(businessId) || dummyCostCan('purchasing', businessId) || dummyCostCan('costing', businessId))) return []
      return copy(store.adjustments.filter((a) => a.business_id === businessId)).sort((a, b) => b.adjusted_on.localeCompare(a.adjusted_on) || b.adj_id - a.adj_id)
    },

    async addLotAdjustment(businessId, input) {
      if (!(canProd(businessId, true) || dummyCostCan('purchasing', businessId, true))) throw new Error(RLS)
      const l = purchaseLot(input.lot_id)
      if (!l || l.business_id !== businessId || l.voided_at) throw new Error('cost_lot_invalid')
      if (input.adjusted_on > day(1)) throw new Error('cost_date_future')
      if (input.adjusted_on < l.received_on) throw new Error('cost_lot_invalid')
      if (!input.reason.trim()) throw new Error('violates check constraint "cost_lot_adjustments_reason_check" (23514)')
      if (!(input.qty_kg > 0 && input.qty_kg <= 1e9)) throw new Error('violates check constraint "cost_lot_adjustments_qty_kg_check" (23514)')
      if (input.qty_kg > lotRemaining(l)) throw new Error('cost_lot_short')
      const row: LotAdjustment = {
        adj_id: store.nextAdjId++,
        business_id: businessId,
        lot_id: l.lot_id,
        adjusted_on: input.adjusted_on,
        qty_kg: input.qty_kg,
        reason: input.reason.trim().slice(0, 300),
        created_at: new Date().toISOString(),
        voided_at: null,
        void_reason: null,
      }
      store.adjustments.push(row)
      return { ...row }
    },

    async voidLotAdjustment(businessId, adjId, reason) {
      voidIn(
        store.adjustments.find((a) => a.adj_id === adjId),
        businessId,
        reason,
        canProd(businessId, true) || dummyCostCan('purchasing', businessId, true),
      )
    },

    async lotBalances(businessId, all = false) {
      // 0064 리뷰 C1 — 생산 · 구매 · 대표만(원가 관리는 빠졌다).
      if (!(canProd(businessId) || dummyCostCan('purchasing', businessId))) throw new Error('cost_not_found')
      const chairman = dummyViewer().role === 'Chairman'
      const { lots, materials, suppliers } = dummyCostLedger()
      const mName = new Map(materials.map((m) => [m.material_id, m.name]))
      const sName = new Map(suppliers.map((s) => [s.supplier_id, s.name]))
      return lots
        .filter((l) => l.business_id === businessId && !l.voided_at)
        .map((l): LotBalance => {
          const used = store.inputs
            .filter((i) => i.lot_id === l.lot_id && !i.voided_at && store.prodLots.some((p) => p.prod_lot_id === i.prod_lot_id && !p.voided_at))
            .reduce((t, i) => t + i.qty_kg, 0)
          const adj = store.adjustments.filter((a) => a.lot_id === l.lot_id && !a.voided_at).reduce((t, a) => t + a.qty_kg, 0)
          return {
            lot_id: l.lot_id,
            material_id: l.material_id,
            material_name: mName.get(l.material_id) ?? '',
            supplier_name: sName.get(l.supplier_id) ?? '',
            supplier_lot_no: l.supplier_lot_no,
            received_on: l.received_on,
            qty_kg: l.qty_kg,
            used_kg: used,
            adjusted_kg: adj,
            remaining_kg: l.qty_kg - used - adj,
            // 대표 원래 값 · 그 밖 1원(리뷰 M7).
            landed_krw_per_kg: chairman ? l.landed_krw_per_kg : round1(l.landed_krw_per_kg),
          }
        })
        .filter((b) => all || b.remaining_kg > 0)
        .sort((a, b) => a.received_on.localeCompare(b.received_on) || a.lot_id.localeCompare(b.lot_id))
    },

    async prodActual(businessId, from = null, to = null) {
      const v = dummyViewer()
      const chair = v.role === 'Chairman'
      if (v.revoked_at || v.role === 'AIAgent' || v.role === 'Integration' || !dummyHasBusiness(v, businessId) || !(chair || dummyCostCan('costing', businessId))) {
        throw new Error('cost_not_found')
      }
      if (!chair) {
        if (dummyModuleGrants(v.user_id).some((m) => m.module === `/purchasing/${businessId}` && m.can_write)) throw new Error('cost_role_conflict')
        store.audit.push({ user_id: v.user_id, business_id: businessId, at: new Date().toISOString() })
      }
      const lots = dummyCostLedger().lots
      const pName = new Map(store.products.map((p) => [p.product_id, p.name]))
      return store.prodLots
        .filter((pl) => pl.business_id === businessId && !pl.voided_at && (!from || pl.produced_on >= from) && (!to || pl.produced_on <= to))
        .sort((a, b) => b.produced_on.localeCompare(a.produced_on) || a.prod_lot_id.localeCompare(b.prod_lot_id))
        .map((pl): ProdActualRow => {
          const ins = store.inputs.filter((i) => i.prod_lot_id === pl.prod_lot_id && !i.voided_at)
          const kg = ins.length ? ins.reduce((t, i) => t + i.qty_kg, 0) : null
          const amt = ins.reduce((t, i) => t + i.qty_kg * (lots.find((l) => l.lot_id === i.lot_id)?.landed_krw_per_kg ?? 0), 0)
          return {
            prod_lot_id: pl.prod_lot_id,
            order_id: pl.order_id,
            product_id: pl.product_id,
            product_name: pName.get(pl.product_id) ?? '',
            produced_on: pl.produced_on,
            output_kg: pl.output_kg,
            // 투입 kg 합(÷ 산출 = 수율)은 대표에게만(0064 리뷰 C1).
            input_kg: chair ? kg : null,
            actual_krw_per_kg: kg === null ? null : shown(amt / pl.output_kg, chair),
            computed: kg !== null,
          }
        })
    },

    async prodActualBreakdown(prodLotId) {
      if (!bomReader()) throw new Error('cost_not_found')
      const pl = store.prodLots.find((p) => p.prod_lot_id === prodLotId)
      if (!pl || !dummyHasBusiness(dummyViewer(), pl.business_id)) throw new Error('cost_not_found')
      const { lots, materials } = dummyCostLedger()
      const mName = new Map(materials.map((m) => [m.material_id, m.name]))
      return store.inputs
        .filter((i) => i.prod_lot_id === prodLotId && !i.voided_at)
        .map((i) => {
          const landed = lots.find((l) => l.lot_id === i.lot_id)?.landed_krw_per_kg ?? 0
          return {
            material_id: i.material_id,
            material_name: mName.get(i.material_id) ?? '',
            lot_id: i.lot_id,
            qty_kg: i.qty_kg,
            landed_krw_per_kg: landed,
            amount_krw: i.qty_kg * landed,
            planned_kg: store.orderLines.find((ol) => ol.order_id === pl.order_id && ol.material_id === i.material_id)?.planned_kg ?? null,
          }
        })
        .sort((a, b) => a.material_name.localeCompare(b.material_name, 'ko') || a.lot_id.localeCompare(b.lot_id))
    },
  }
}

// ── 원가 관리 · 대표 BOM(0063 · 0065) ─────────────────────────────────

const canCosting = (biz: string, write = false) => dummyCostCan('costing', biz, write)

export function dummyCosts(): CostsMethods {
  return {
    async listCostProducts(businessId) {
      if (!(['purchasing', 'production', 'sales', 'costing'] as const).some((a) => dummyCostCan(a, businessId))) return []
      return copy(store.products.filter((p) => p.business_id === businessId)).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    },

    async costingList(businessId) {
      if (!(dummyViewer().role === 'Chairman' || canCosting(businessId))) throw new Error('cost_not_found')
      const gt = gateFor(businessId, `costing:${businessId}`, 'costing_list')
      const ok = gt.chairman || (businessComplete(businessId, 'market', gt.as_of) && businessComplete(businessId, 'current', gt.as_of))
      return store.products
        .filter((p) => p.business_id === businessId && p.active)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
        .map((p): CostingRow => {
          const mk = ok ? materialCost(p.product_id, 'market', gt.as_of) : null
          const cu = ok ? materialCost(p.product_id, 'current', gt.as_of) : null
          const o = overhead(businessId, p.product_id, gt.as_of)
          const sh = (x: number | null) => (o.ready ? shown(x, gt.chairman) : null)
          return {
            product_id: p.product_id,
            product_name: p.name,
            as_of: gt.as_of,
            market_krw_per_kg: shown(mk, gt.chairman),
            current_krw_per_kg: shown(cu, gt.chairman),
            mfg_krw_per_kg: sh(o.mfg),
            pack_krw_per_kg: sh(o.pack),
            logi_krw_per_kg: sh(o.logi),
            indirect_krw_per_kg: sh(o.indirect),
            overhead_krw_per_kg: sh(o.total),
            total_krw_per_kg: shown(totalRaw(cu, o), gt.chairman),
            overhead_ready: o.ready,
            overhead_basis: o.basis_used,
            computed: cu !== null && (o.ready || !o.has_lines),
          }
        })
    },

    async listOverheads(businessId) {
      if (!canCosting(businessId)) return []
      return copy(store.overheads.filter((o) => o.business_id === businessId)).sort(latestFirst)
    },

    async addOverhead(businessId, input) {
      if (!canCosting(businessId, true)) throw new Error(RLS)
      if (input.basis === 'monthly' && input.product_id) throw new Error('violates check constraint "cost_overheads_scope" (23514)')
      if (input.product_id && !store.products.some((p) => p.product_id === input.product_id && p.business_id === businessId)) {
        throw new Error('insert violates foreign key constraint (23503)')
      }
      if (!(input.amount >= 0 && input.amount <= 1e13) || !OVERHEAD_CATEGORIES.includes(input.category)) {
        throw new Error('violates check constraint "cost_overheads_amount_check" (23514)')
      }
      const row: Overhead = {
        overhead_id: store.nextOverheadId++,
        business_id: businessId,
        ...input,
        product_id: input.basis === 'per_kg' ? input.product_id : null,
        note: input.note.slice(0, 300),
        created_at: new Date().toISOString(),
        voided_at: null,
        void_reason: null,
      }
      store.overheads.push(row)
      return { ...row }
    },

    async voidOverhead(businessId, overheadId, reason) {
      voidIn(
        store.overheads.find((o) => o.overhead_id === overheadId),
        businessId,
        reason,
        canCosting(businessId, true),
      )
    },

    async overheadSummary(businessId) {
      if (!canCosting(businessId)) throw new Error('cost_not_found')
      const on = kstToday()
      const o = overhead(businessId, null, on)
      const cur = new Map<string, Overhead>()
      for (const r of liveOverheads(businessId).filter((x) => x.effective_from <= on).sort(latestFirst)) {
        const k = `${r.category}|${r.product_id ?? ''}`
        if (!cur.has(k)) cur.set(k, r)
      }
      const order = (g: OverheadGroup) => OVERHEAD_GROUPS.indexOf(g)
      return [...cur.values()]
        .map((x): OverheadSummaryRow => {
          let perKg: number | null = null
          if (x.basis === 'per_kg') perKg = x.amount
          else if (o.divisor_kg && o.divisor_kg > 0 && o.window_days) {
            let sum = 0
            for (let k = 0; k < o.window_days; k++) {
              const line = companyLineOn(businessId, x.category, shiftDate(on, -k))
              if (line && line.basis === 'monthly') sum += line.amount
            }
            perKg = (sum * 12) / 365 / o.divisor_kg
          }
          return {
            category: x.category,
            grp: overheadGroupOf(x.category),
            basis: x.basis,
            amount: x.amount,
            product_id: x.product_id,
            effective_from: x.effective_from,
            per_kg: perKg,
            divisor_kg: o.divisor_kg,
            basis_used: o.basis_used,
            window_days: o.window_days,
          }
        })
        .sort(
          (a, b) =>
            order(a.grp) - order(b.grp) ||
            a.category.localeCompare(b.category) ||
            a.basis.localeCompare(b.basis) ||
            (a.product_id === null ? -1 : b.product_id === null ? 1 : a.product_id.localeCompare(b.product_id)),
        )
    },

    async allocSettings(businessId) {
      if (!canCosting(businessId)) return null
      const s = store.alloc.get(businessId)
      return s ? { ...s } : null
    },

    async setAllocSettings(businessId, basis, windowDays, plannedKgMonth) {
      if (!canCosting(businessId, true)) throw new Error('cost_not_found')
      if (
        !['trailing', 'plan'].includes(basis) ||
        !Number.isInteger(windowDays) ||
        windowDays < 7 ||
        windowDays > 365 ||
        (plannedKgMonth !== null && (plannedKgMonth <= 0 || plannedKgMonth > 1e12)) ||
        (basis === 'plan' && plannedKgMonth === null)
      ) {
        throw new Error('cost_alloc_invalid')
      }
      const old = store.alloc.get(businessId) ?? null
      if (!old || !old.updated_at || Date.parse(old.updated_at) <= salesCutoffMs()) allocPrev.set(businessId, old ? { ...old } : null)
      store.alloc.set(businessId, { business_id: businessId, basis, window_days: windowDays, planned_kg_month: plannedKgMonth, updated_at: new Date().toISOString() })
    },

    async bomStatus() {
      if (!bomReader()) throw new Error('cost_not_found')
      let ready = true
      try {
        bomKey()
      } catch {
        ready = false
      }
      return { key_ready: ready, real_allowed: store.realAllowed, changed_at: store.realChangedAt }
    },

    async bomVersions(businessId) {
      if (!bomReader() || !dummyHasBusiness(dummyViewer(), businessId)) throw new Error('cost_not_found')
      const pName = new Map(store.products.map((p) => [p.product_id, p.name]))
      return store.boms
        .filter((b) => store.products.some((p) => p.product_id === b.product_id && p.business_id === businessId))
        .sort((a, b) => (pName.get(a.product_id) ?? '').localeCompare(pName.get(b.product_id) ?? '', 'ko') || b.valid_from.localeCompare(a.valid_from) || b.version_id - a.version_id)
        .map(
          (b): BomVersionRow => ({
            version_id: b.version_id,
            product_id: b.product_id,
            valid_from: b.valid_from,
            yield_pct: b.yield_pct,
            is_fake: b.is_fake,
            note: b.note,
            created_at: b.created_at,
            voided_at: b.voided_at,
            void_reason: b.void_reason,
          }),
        )
    },

    async bomGet(productId, asOf = null) {
      if (!bomReader()) throw new Error('cost_not_found')
      const p = store.products.find((x) => x.product_id === productId)
      if (!p || !dummyHasBusiness(dummyViewer(), p.business_id)) throw new Error('cost_not_found')
      const v = versionOn(productId, asOf ?? kstToday())
      if (!v) return null
      const mName = new Map(dummyCostLedger().materials.map((m) => [m.material_id, m.name]))
      return {
        version_id: v.version_id,
        valid_from: v.valid_from,
        yield_pct: v.yield_pct,
        is_fake: v.is_fake,
        lines: linesOf(v)
          .map((l) => ({ material_id: l.material_id, material_name: mName.get(l.material_id) ?? '', kg_per_kg: l.kg_per_kg }))
          .sort((a, b) => a.material_name.localeCompare(b.material_name, 'ko')),
      } satisfies BomCurrent
    },

    async bomSave(productId, validFrom, yieldPct, lines, note, isFake) {
      if (!bomReader()) throw new Error('cost_not_found')
      const p = store.products.find((x) => x.product_id === productId)
      if (!p || !dummyHasBusiness(dummyViewer(), p.business_id)) throw new Error('cost_not_found')
      if (!isFake && !store.realAllowed) throw new Error('cost_bom_real_locked')
      if (!validFrom || !Number.isFinite(yieldPct) || yieldPct <= 0 || yieldPct > 100) throw new Error('cost_bom_invalid')
      if (!Array.isArray(lines) || lines.length < 1 || lines.length > 200) throw new Error('cost_bom_invalid')
      const mats = dummyCostLedger().materials
      const bad = lines.some(
        (l) =>
          typeof l.material_id !== 'string' ||
          !Number.isFinite(l.kg_per_kg) ||
          l.kg_per_kg < 0.00000001 ||
          l.kg_per_kg > 100 ||
          Number(l.kg_per_kg.toFixed(8)) !== l.kg_per_kg ||
          !mats.some((m) => m.material_id === l.material_id && m.business_id === p.business_id),
      )
      if (bad || new Set(lines.map((l) => l.material_id)).size !== lines.length) throw new Error('cost_bom_invalid')
      bomKey() // 키가 없으면 판을 무효로 하기 전에 멈춘다
      const now = new Date().toISOString()
      for (const b of store.boms) {
        if (b.product_id === productId && b.valid_from === validFrom && !b.voided_at) {
          b.voided_at = now
          b.void_reason = '같은 날 새 판으로 교체'
        }
      }
      const v: BomVersion = {
        version_id: store.nextBomId++,
        product_id: productId,
        valid_from: validFrom,
        yield_pct: yieldPct,
        is_fake: isFake,
        note: note.slice(0, 300),
        created_at: now,
        voided_at: null,
        void_reason: null,
        lines: lines.map((l) => ({ material_id: l.material_id, kg_per_kg: l.kg_per_kg })),
      }
      store.boms.push(v)
      return v.version_id
    },

    async bomVoid(versionId, reason) {
      if (!bomReader()) throw new Error('cost_not_found')
      const b = store.boms.find((x) => x.version_id === versionId && !x.voided_at)
      if (!b) throw new Error('cost_not_found')
      if (!reason.trim() || reason.length > 300) throw new Error('cost_void_reason')
      b.voided_at = new Date().toISOString()
      b.void_reason = reason.trim()
    },

    async bomRealAllow(on) {
      if (!bomReader()) throw new Error('cost_not_found')
      if (on) bomKey()
      store.realAllowed = on
      store.realChangedAt = new Date().toISOString()
      return on
    },

    async productBreakdown(productId, kind) {
      if (!bomReader() || (kind !== 'market' && kind !== 'current')) throw new Error('cost_not_found')
      const p = store.products.find((x) => x.product_id === productId)
      if (!p || !dummyHasBusiness(dummyViewer(), p.business_id)) throw new Error('cost_not_found')
      const on = kstToday()
      const v = versionOn(productId, on)
      if (!v) return []
      const mName = new Map(dummyCostLedger().materials.map((m) => [m.material_id, m.name]))
      return linesOf(v)
        .map((l) => {
          const q = l.kg_per_kg / (v.yield_pct / 100)
          const up = unitPrice(l.material_id, kind, on)
          return {
            material_id: l.material_id,
            material_name: mName.get(l.material_id) ?? '',
            kg_per_kg: l.kg_per_kg,
            qty_kg_per_kg: q,
            unit_krw_per_kg: up,
            contribution_krw_per_kg: up === null ? null : q * up,
          }
        })
        .sort((a, b) => a.material_name.localeCompare(b.material_name, 'ko'))
    },
  }
}
