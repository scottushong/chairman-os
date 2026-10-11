import { kstToday } from '@/lib/chairman-project'
import type {
  CostArea,
  CostMaterial,
  CostSupplier,
  IsoDate,
  MarketPrice,
  PurchaseCandidate,
  PurchaseDoc,
  PurchaseLot,
} from '@/types'

import { dummyHasBusiness, dummyModuleGrants, dummyViewer } from './dummy-org'
import type { PurchasingMethods } from './types'

/**
 * 0061 원가 엔진 · 구매의 dummy 자리. **DB가 막는 것을 여기서도 막는다**(dummy-attachments.ts와 같은 원칙) — cost_can(영역 · 회사 · 쓰기),
 * 무효는 한 번 · 이유 필수, 결재 한 건 = LOT 하나, 같은 날 같은 출처 한 값, Landed · 환율은 «DB»(여기)가 계산.
 *
 * 저장소를 처음부터 globalThis에 둔다 — webpack dev는 서버 액션 층과 화면 층이 이 모듈을 따로 읽어 저장소가 둘이 된다
 * (dummy-org.ts 모듈 권한과 같은 사고, 2026-10-07).
 *
 * 시드는 **가짜**다 — 원료 이름에 «(가짜)»를 붙인다. DY의 진짜 원료 · 공급처 · 단가가 아니다. 배합 · 투입 비율은 여기 없다(0062 비공개 장부).
 */

interface Store {
  materials: CostMaterial[]
  suppliers: CostSupplier[]
  prices: MarketPrice[]
  lots: PurchaseLot[]
  docs: PurchaseDoc[]
  bytes: Map<string, { data: ArrayBuffer; contentType: string }>
  candidates: (PurchaseCandidate & { business_id: string })[]
  dismissed: Set<string>
  /** 통화 → 날짜 → 원화 환율(0015 fx_rates 흉내 · 가짜). */
  fx: Map<string, Map<IsoDate, number>>
  nextPriceId: number
}

const DY = 'biz_dy'
const DAY = 86_400_000

function day(n: number): IsoDate {
  return kstToday(new Date(Date.now() + n * DAY))
}

function at(n: number, hh = 9): string {
  return new Date(`${day(n)}T${String(hh).padStart(2, '0')}:00:00+09:00`).toISOString()
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000

function lotId(on: IsoDate): string {
  const hex = Array.from({ length: 6 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')
  return `PL-${on.replace(/-/g, '')}-${hex}`
}

function seed(): Store {
  const created = at(-60)
  const mat = (material_id: string, name: string, spec: string, category: CostMaterial['category'], note = ''): CostMaterial => ({
    material_id,
    business_id: DY,
    name,
    spec,
    category,
    active: true,
    note,
    updated_at: created,
  })
  const materials = [
    mat('mat_fake_a', '원료 A(가짜)', '분말 · 25kg 포대', 'main', '시험용 가짜 원료'),
    mat('mat_fake_b', '원료 B(가짜)', '수입 · 1톤 백', 'main'),
    mat('mat_fake_c', '부원료 C(가짜)', '액상 · 200kg 드럼', 'sub'),
    mat('mat_fake_d', '포장재 D(가짜)', '크라프트 20kg 봉투(kg 환산)', 'packaging'),
  ]
  const suppliers: CostSupplier[] = [
    {
      supplier_id: 'sup_fake_kr',
      business_id: DY,
      name: '가짜상사(국내)',
      country: '대한민국',
      currency_default: 'KRW',
      contact: '담당 김가짜 · 010-0000-0000',
      terms: '월말 마감 · 익월 10일 현금 · 공장 도착도',
      active: true,
      note: '',
      updated_at: created,
    },
    {
      supplier_id: 'sup_fake_us',
      business_id: DY,
      name: 'Fake Supply Inc.(가짜)',
      country: '미국',
      currency_default: 'USD',
      contact: 'sales@fake-supply.example',
      terms: 'T/T 30일 · CIF 부산',
      active: true,
      note: '',
      updated_at: created,
    },
  ]

  // USD 환율 60일(가짜). 주말도 채운다 — 화면이 «그 날짜 이하 최신»을 보는지는 시험 데이터가 아니라 함수가 보장한다.
  const usd = new Map<IsoDate, number>()
  for (let i = -60; i <= 0; i++) usd.set(day(i), round4(1375 + 12 * Math.sin(i / 6) + i * -0.3))
  const fx = new Map([['USD', usd]])

  let nextPriceId = 1
  const prices: MarketPrice[] = []
  const price = (material_id: string, n: number, value: number, currency: string, source_name: string) => {
    const fxr = currency === 'KRW' ? 1 : usd.get(day(n))!
    prices.push({
      price_id: nextPriceId++,
      business_id: DY,
      material_id,
      observed_on: day(n),
      price: value,
      currency,
      fx_rate: fxr,
      price_krw_per_kg: value * fxr,
      source_name,
      source_url: null,
      note: '',
      created_at: at(n, 10),
      voided_at: null,
      void_reason: null,
    })
  }
  for (let i = -30; i <= 0; i++) {
    price('mat_fake_a', i, Math.round(2400 + 90 * Math.sin(i / 4) + i * -3), 'KRW', '거래처 시세 문자(가짜)')
    price('mat_fake_b', i, round4(1.82 + 0.05 * Math.cos(i / 5)), 'USD', 'Platts(가짜)')
    if (i % 2 === 0) price('mat_fake_c', i, Math.round(5150 + 60 * Math.sin(i / 3)), 'KRW', '구매팀 조사')
    if (i % 7 === 0) price('mat_fake_d', i, 360, 'KRW', '구매팀 조사')
  }

  const lots: PurchaseLot[] = []
  const lot = (
    n: number,
    material_id: string,
    supplier_id: string,
    qty_kg: number,
    unit_price: number,
    currency: string,
    extra: { freight?: number; duty?: number; other?: number; lotNo?: string } = {},
  ) => {
    const on = day(n)
    const fxr = currency === 'KRW' ? 1 : usd.get(on)!
    const goods = unit_price * qty_kg * fxr // 0061처럼 반올림 없음
    const f = extra.freight ?? 0
    const d = extra.duty ?? 0
    const o = extra.other ?? 0
    lots.push({
      lot_id: lotId(on),
      business_id: DY,
      material_id,
      supplier_id,
      received_on: on,
      ordered_on: day(n - 7),
      supplier_lot_no: extra.lotNo ?? '',
      qty_kg,
      unit_price,
      currency,
      fx_rate: fxr,
      freight_krw: f,
      duty_krw: d,
      other_krw: o,
      goods_krw: goods,
      landed_krw_per_kg: (goods + f + d + o) / qty_kg,
      source: 'manual',
      source_ref: null,
      note: '',
      created_at: at(n, 15),
      voided_at: null,
      void_reason: null,
    })
  }
  lot(-26, 'mat_fake_a', 'sup_fake_kr', 2000, 2350, 'KRW', { freight: 120_000, lotNo: 'KR-2409-11' })
  lot(-18, 'mat_fake_a', 'sup_fake_us', 5000, 1.62, 'USD', { freight: 1_450_000, duty: 690_000, other: 210_000, lotNo: 'FS-77120' })
  lot(-12, 'mat_fake_a', 'sup_fake_kr', 1500, 2420, 'KRW', { freight: 90_000, lotNo: 'KR-2410-02' })
  lot(-20, 'mat_fake_b', 'sup_fake_us', 8000, 1.79, 'USD', { freight: 2_100_000, duty: 1_150_000, other: 320_000, lotNo: 'FS-77031' })
  lot(-6, 'mat_fake_b', 'sup_fake_us', 6000, 1.84, 'USD', { freight: 1_700_000, duty: 920_000, other: 260_000, lotNo: 'FS-77388' })
  lot(-15, 'mat_fake_c', 'sup_fake_kr', 800, 5300, 'KRW', { freight: 60_000, lotNo: 'KR-C-0915' })
  lot(-3, 'mat_fake_a', 'sup_fake_kr', 1800, 2480, 'KRW', { freight: 110_000, lotNo: 'KR-2410-09' })
  // 포장재 D도 한 번은 산다 — 영업 원가(dummy-sales-cost.ts)는 «사용 중 원료 전부에 단가가 있어야» 계산한다(0062 business_complete).
  lot(-40, 'mat_fake_d', 'sup_fake_kr', 3000, 350, 'KRW', { freight: 30_000, lotNo: 'KR-D-0830' })

  // 승인된 «구매» 결재 한 건(dummy 결재 시드에는 구매 양식이 없다 — 이 화면 전용 후보).
  const candidates: Store['candidates'] = [
    {
      business_id: DY,
      decision_id: 'dec_fake_purchase_01',
      title: '원료 A(가짜) 추가 매입 품의',
      item: '원료 A(가짜) 25kg × 40포',
      vendor: '가짜상사(국내)',
      quantity: 1000,
      amount_krw: 2_530_000,
      link: 'https://example.com/fake-quote',
      decided_at: at(-1, 16),
    },
  ]

  return { materials, suppliers, prices, lots, docs: [], bytes: new Map(), candidates, dismissed: new Set(), fx, nextPriceId }
}

const g = globalThis as unknown as { __chairmanDummyPurchasing?: Store }
const store: Store = (g.__chairmanDummyPurchasing ??= seed())

const RLS = 'new row violates row-level security policy'

/** 0061 cost_can의 거울 — 대표 또는 '/<area>/<biz>' 줄(쓰기면 can_write), AND 회사 범위. 시스템 계정 · 회수된 사람은 거짓. */
export function dummyCostCan(area: CostArea, businessId: string, write = false): boolean {
  return can(area, businessId, write)
}

/**
 * dummy 영업 원가(dummy-sales-cost.ts)만 부르는 원장 — «DB 안»에서 원가 함수가 시세 · LOT를 읽는 자리의 흉내. 화면 코드는 부르지 않는다.
 * 권한을 보지 않으므로 dummy 저장소 밖으로 내보내지 않는다(복사본).
 */
export function dummyCostLedger(): { materials: CostMaterial[]; suppliers: CostSupplier[]; prices: MarketPrice[]; lots: PurchaseLot[] } {
  return { materials: copy(store.materials), suppliers: copy(store.suppliers), prices: copy(store.prices), lots: copy(store.lots) }
}

/**
 * 0064 cost_lot_void_guard의 거울 — 생산 저장소(투입 · 조정)는 dummy-sales-cost.ts에 있고 이 파일은 그것을 import하지 않는다
 * (가짜 BOM 옆 저장소는 dummy.ts만 import — check:sales-cost). 그쪽이 읽혀질 때 판정 함수를 여기 걸어 둔다.
 */
const lotGuard = globalThis as unknown as { __chairmanDummyLotInUse?: (lotId: string) => boolean }
const lotInUse = (lotId: string) => lotGuard.__chairmanDummyLotInUse?.(lotId) ?? false

export function setDummyLotInUseCheck(fn: (lotId: string) => boolean): void {
  lotGuard.__chairmanDummyLotInUse = fn
}

function can(area: CostArea, businessId: string, write = false): boolean {
  const v = dummyViewer()
  if (v.revoked_at || v.role === 'AIAgent' || v.role === 'Integration') return false
  if (!dummyHasBusiness(v, businessId)) return false
  if (v.role === 'Chairman') return true
  const row = dummyModuleGrants(v.user_id).find((m) => m.module === `/${area}/${businessId}`)
  return !!row && (!write || row.can_write)
}

const canAny = (areas: CostArea[], biz: string) => areas.some((a) => can(a, biz))

function mustWrite(businessId: string) {
  if (!can('purchasing', businessId, true)) throw new Error(RLS)
}

function fxOn(currency: string, on: IsoDate): number | null {
  if (currency === 'KRW') return 1
  const series = store.fx.get(currency)
  if (!series) return null
  const days = [...series.keys()].filter((d) => d <= on).sort()
  return days.length ? series.get(days[days.length - 1])! : null
}

function norm(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase()
}

function voidIn<T extends { business_id: string; voided_at: string | null; void_reason: string | null }>(row: T | undefined, businessId: string, reason: string) {
  if (!row || row.business_id !== businessId || !can('purchasing', businessId, true)) throw new Error('cost_not_found')
  if (row.voided_at) throw new Error('cost_already_voided')
  if (!reason.trim()) throw new Error('cost_void_reason')
  row.voided_at = new Date().toISOString()
  row.void_reason = reason.trim()
}


/** 0061 cost_outlier_check의 거울(98ace1d) — 대표 외의 값이 그 원료 ±90일 중앙값(무효 제외 · 3점 이상)의 0.2배 미만 · 5배 초과면 거부. */
function outlier(values: number[], v: number) {
  if (dummyViewer().role === 'Chairman' || values.length < 3) return
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length / 2
  const med = s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2
  if (med > 0 && (v > med * 5 || v < med * 0.2)) throw new Error('cost_price_outlier')
}

const within90 = (a: IsoDate, b: IsoDate) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= 90 * DAY

const copy = <T extends object>(rows: T[]): T[] => rows.map((r) => ({ ...r }))

function openCandidates(businessId: string): PurchaseCandidate[] {
  return store.candidates
    .filter(
      (c) =>
        c.business_id === businessId &&
        !store.dismissed.has(c.decision_id) &&
        !store.lots.some((l) => l.source === 'approval' && l.source_ref === c.decision_id && !l.voided_at),
    )
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ business_id, ...rest }) => ({ ...rest }))
}

export function dummyPurchasing(): PurchasingMethods {
  return {
    async listCostMaterials(businessId) {
      // 회장 결정 2026-10-09 «영업은 제품 총액만» — 영업은 원료 이름도 못 읽는다(0061 cost_materials_read).
      if (!canAny(['purchasing', 'production', 'costing'], businessId)) return []
      return copy(store.materials.filter((m) => m.business_id === businessId)).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    },

    async saveCostMaterial(businessId, input, materialId) {
      mustWrite(businessId)
      const clash = store.materials.find(
        (m) => m.business_id === businessId && norm(m.name) === norm(input.name) && m.material_id !== materialId,
      )
      if (clash) throw new Error('duplicate key value violates unique constraint "cost_materials_business_id_name_norm_key"')
      const now = new Date().toISOString()
      if (materialId) {
        const row = store.materials.find((m) => m.material_id === materialId && m.business_id === businessId)
        if (!row) throw new Error('cost_not_found')
        Object.assign(row, input, { updated_at: now })
        return { ...row }
      }
      const row: CostMaterial = {
        material_id: `mat_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        business_id: businessId,
        ...input,
        updated_at: now,
      }
      store.materials.push(row)
      return { ...row }
    },

    async listCostSuppliers(businessId) {
      if (!canAny(['purchasing', 'costing'], businessId)) return []
      return copy(store.suppliers.filter((s) => s.business_id === businessId)).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    },

    async saveCostSupplier(businessId, input, supplierId) {
      mustWrite(businessId)
      const clash = store.suppliers.find(
        (s) => s.business_id === businessId && norm(s.name) === norm(input.name) && s.supplier_id !== supplierId,
      )
      if (clash) throw new Error('duplicate key value violates unique constraint "cost_suppliers_business_id_name_norm_key"')
      const now = new Date().toISOString()
      if (supplierId) {
        const row = store.suppliers.find((s) => s.supplier_id === supplierId && s.business_id === businessId)
        if (!row) throw new Error('cost_not_found')
        Object.assign(row, input, { updated_at: now })
        return { ...row }
      }
      const row: CostSupplier = {
        supplier_id: `sup_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        business_id: businessId,
        ...input,
        updated_at: now,
      }
      store.suppliers.push(row)
      return { ...row }
    },

    async listMarketPrices(businessId, sinceDays) {
      // 영업은 원료별 시세를 보지 않는다(회장 결정 2026-10-09 · 0061 cost_market_prices_read).
      if (!canAny(['purchasing', 'costing'], businessId)) return []
      const since = day(-sinceDays)
      return copy(store.prices.filter((p) => p.business_id === businessId && p.observed_on >= since)).sort(
        (a, b) => b.observed_on.localeCompare(a.observed_on) || b.price_id - a.price_id,
      )
    },

    async addMarketPrice(businessId, input) {
      mustWrite(businessId)
      if (!store.materials.some((m) => m.material_id === input.material_id && m.business_id === businessId)) {
        throw new Error('insert violates foreign key constraint (23503)')
      }
      if (
        store.prices.some(
          (p) =>
            !p.voided_at &&
            p.material_id === input.material_id &&
            p.observed_on === input.observed_on &&
            p.source_name.toLowerCase() === input.source_name.toLowerCase(),
        )
      ) {
        throw new Error('duplicate key value violates unique constraint "cost_market_prices_one_a_day"')
      }
      // 0061(5a624af) 거울 — 내일보다 먼 날짜 · 같은 원료 같은 날 출처 넷째.
      if (input.observed_on > day(1)) throw new Error('cost_date_future')
      if (store.prices.filter((p) => !p.voided_at && p.material_id === input.material_id && p.observed_on === input.observed_on).length >= 3) {
        throw new Error('cost_price_too_many')
      }
      const fxr = input.currency === 'KRW' ? 1 : (input.fx_rate ?? fxOn(input.currency, input.observed_on))
      if (fxr === null) throw new Error('cost_fx_missing')
      outlier(
        store.prices.filter((p) => p.material_id === input.material_id && !p.voided_at && within90(p.observed_on, input.observed_on)).map((p) => p.price_krw_per_kg),
        input.price * fxr,
      )
      const row: MarketPrice = {
        price_id: store.nextPriceId++,
        business_id: businessId,
        ...input,
        fx_rate: fxr,
        price_krw_per_kg: input.price * fxr,
        created_at: new Date().toISOString(),
        voided_at: null,
        void_reason: null,
      }
      store.prices.push(row)
      return { ...row }
    },

    async voidMarketPrice(businessId, priceId, reason) {
      voidIn(
        store.prices.find((p) => p.price_id === priceId),
        businessId,
        reason,
      )
    },

    async listPurchaseLots(businessId) {
      if (!canAny(['purchasing', 'costing'], businessId)) return []
      return copy(store.lots.filter((l) => l.business_id === businessId)).sort(
        (a, b) => b.received_on.localeCompare(a.received_on) || b.created_at.localeCompare(a.created_at),
      )
    },

    async addPurchaseLot(businessId, input) {
      mustWrite(businessId)
      if (
        !store.materials.some((m) => m.material_id === input.material_id && m.business_id === businessId) ||
        !store.suppliers.some((s) => s.supplier_id === input.supplier_id && s.business_id === businessId)
      ) {
        throw new Error('insert violates foreign key constraint (23503)')
      }
      if (input.source === 'approval') {
        const ok = store.candidates.some((c) => c.decision_id === input.source_ref && c.business_id === businessId)
        if (!ok) throw new Error('cost_candidate_invalid')
        if (store.lots.some((l) => l.source === 'approval' && l.source_ref === input.source_ref && !l.voided_at)) {
          throw new Error('duplicate key value violates unique constraint "cost_purchase_lots_one_per_approval"')
        }
      }
      if (input.received_on > day(1)) throw new Error('cost_date_future')
      const fxr = input.currency === 'KRW' ? 1 : (input.fx_rate ?? fxOn(input.currency, input.received_on))
      if (fxr === null) throw new Error('cost_fx_missing')
      const goods = input.unit_price * input.qty_kg * fxr
      outlier(
        store.lots.filter((l) => l.material_id === input.material_id && !l.voided_at && within90(l.received_on, input.received_on)).map((l) => l.landed_krw_per_kg),
        (goods + input.freight_krw + input.duty_krw + input.other_krw) / input.qty_kg,
      )
      const row: PurchaseLot = {
        lot_id: lotId(kstToday()),
        business_id: businessId,
        ...input,
        source_ref: input.source === 'approval' ? input.source_ref : null,
        fx_rate: fxr,
        goods_krw: goods,
        landed_krw_per_kg: (goods + input.freight_krw + input.duty_krw + input.other_krw) / input.qty_kg,
        created_at: new Date().toISOString(),
        voided_at: null,
        void_reason: null,
      }
      store.lots.push(row)
      return { ...row }
    },

    async voidPurchaseLot(businessId, lotIdValue, reason) {
      const row = store.lots.find((l) => l.lot_id === lotIdValue)
      // 0064 리뷰 I4 cost_lot_void_guard — 살아 있는 투입 · 조정이 있으면 거부(권한 · 이유 검사 뒤에 — DB는 RLS · 무효 트리거와 같은 update 안).
      if (row && row.business_id === businessId && can('purchasing', businessId, true) && !row.voided_at && reason.trim() && lotInUse(row.lot_id)) {
        throw new Error('cost_lot_in_use')
      }
      voidIn(row, businessId, reason)
    },

    async lookupCostFx(currency, onDate) {
      return fxOn(currency, onDate)
    },

    async listPurchaseCandidates(businessId) {
      if (!can('purchasing', businessId, true)) throw new Error('cost_not_found')
      return openCandidates(businessId)
    },

    async dismissPurchaseCandidate(businessId, decisionId) {
      mustWrite(businessId)
      if (!store.candidates.some((c) => c.decision_id === decisionId && c.business_id === businessId)) {
        throw new Error('cost_candidate_invalid')
      }
      store.dismissed.add(decisionId)
    },

    async listPurchaseDocs(businessId) {
      if (!canAny(['purchasing', 'costing'], businessId)) return []
      return copy(store.docs.filter((d) => d.business_id === businessId)).sort((a, b) => b.created_at.localeCompare(a.created_at))
    },

    async createPurchaseDoc(businessId, input) {
      mustWrite(businessId)
      if (!input.mix_checked && !input.mix_attested) throw new Error('violates check constraint "cost_purchase_docs_mix" (23514)')
      if (!input.storage_path.startsWith(`${businessId}/`) || input.storage_path.includes('..')) {
        throw new Error('violates check constraint "cost_purchase_docs_path" (23514)')
      }
      const row: PurchaseDoc = {
        doc_id: input.doc_id,
        business_id: businessId,
        lot_id: input.lot_id,
        supplier_id: input.supplier_id,
        kind: input.kind,
        file_name: input.file_name,
        mime: input.mime,
        size_bytes: input.size_bytes,
        storage_path: input.storage_path,
        mix_checked: input.mix_checked,
        mix_attested: input.mix_attested,
        created_at: new Date().toISOString(),
        voided_at: null,
        void_reason: null,
      }
      store.docs.push(row)
      return { ...row }
    },

    async putPurchaseDocObject(path, bytes, contentType) {
      // 0061 버킷 정책의 거울 — 줄이 먼저 있어야 한다(내가 만든 · 무효 아닌 줄).
      const row = store.docs.find((d) => d.storage_path === path && !d.voided_at)
      if (!row || !can('purchasing', row.business_id, true)) throw new Error(RLS)
      if (store.bytes.has(path)) throw new Error('The resource already exists')
      store.bytes.set(path, { data: bytes, contentType })
    },

    async voidPurchaseDoc(businessId, docId, reason) {
      voidIn(
        store.docs.find((d) => d.doc_id === docId),
        businessId,
        reason,
      )
    },

    async logPurchaseDocDownload(docId) {
      // 0068 — 대표만. dummy는 감사 표가 없어 판정만 흉내 낸다.
      if (dummyViewer().role !== 'Chairman' || !store.docs.some((d) => d.doc_id === docId && !d.voided_at)) throw new Error('cost_not_found')
    },

    async downloadPurchaseDoc(businessId, docId) {
      if (dummyViewer().role !== 'Chairman' || !canAny(['purchasing', 'costing'], businessId)) return null
      const row = store.docs.find((d) => d.doc_id === docId && d.business_id === businessId && !d.voided_at)
      const obj = row ? store.bytes.get(row.storage_path) : undefined
      if (!row || !obj) return null
      return { file_name: row.file_name, mime: obj.contentType, base64: Buffer.from(obj.data).toString('base64') }
    },
  }
}
