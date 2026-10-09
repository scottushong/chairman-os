import type { IsoDate, MarketPrice, PurchaseLot } from '@/types'

/**
 * 구매 화면의 순수 계산 — 화면 미리보기 · 개요 · 추이. 저장되는 숫자(Landed Cost · 원화 환산)는 DB 트리거가 계산한 값이 원천이고,
 * 여기서는 «넣기 전에 보여 주기»와 «일 단위 원자료를 주 · 월로 묶기»만 한다(설계서 9 — 주 · 월은 저장하지 않는다).
 * scripts/check-purchasing.ts가 같은 함수를 잰다.
 */

export interface LandedInput {
  qty_kg: number | null
  unit_price: number | null
  fx_rate: number | null
  freight_krw: number | null
  duty_krw: number | null
  other_krw: number | null
}

export interface LandedPreview {
  goods_krw: number
  extra_krw: number
  total_krw: number
  landed_krw_per_kg: number
}

/** 0061 cost_lot_calc와 같은 식: goods = unit_price × qty × fx, landed/kg = (goods + freight + duty + other) ÷ qty. 칸이 모자라면 null. */
export function landedPreview(i: LandedInput): LandedPreview | null {
  if (!i.qty_kg || i.qty_kg <= 0 || !i.unit_price || i.unit_price <= 0 || !i.fx_rate || i.fx_rate <= 0) return null
  // 반올림하지 않는다(0061 · 회장 결정 2026-10-09 밤 — 표시만 1원).
  const goods = i.unit_price * i.qty_kg * i.fx_rate
  const extra = (i.freight_krw ?? 0) + (i.duty_krw ?? 0) + (i.other_krw ?? 0)
  return { goods_krw: goods, extra_krw: extra, total_krw: goods + extra, landed_krw_per_kg: (goods + extra) / i.qty_kg }
}

// ── 날짜 ─────────────────────────────────────────────────────────────

function utc(d: IsoDate): Date {
  return new Date(`${d}T00:00:00Z`)
}

function isoOf(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return isoOf(new Date(utc(d).getTime() + n * 86_400_000))
}

/** ISO 주의 월요일(Postgres date_trunc('week')와 같다). */
export function isoMonday(d: IsoDate): IsoDate {
  const t = utc(d)
  const dow = (t.getUTCDay() + 6) % 7 // 월 = 0
  return addDays(d, -dow)
}

export type Granularity = 'day' | 'week' | 'month'

export function bucketOf(d: IsoDate, g: Granularity): IsoDate {
  if (g === 'day') return d
  if (g === 'week') return isoMonday(d)
  return `${d.slice(0, 7)}-01`
}

// ── 시장가 ───────────────────────────────────────────────────────────

const live = <T extends { voided_at: string | null }>(rows: T[]) => rows.filter((r) => r.voided_at === null)

/** 원료 m의 일 단위 시장가(원/kg) — 같은 날 여러 출처는 평균(0061 cost_market_on과 같다). 무효 제외. 날짜 오름차순. */
export function dailyMarket(prices: MarketPrice[], materialId: string): { date: IsoDate; value: number }[] {
  const byDay = new Map<IsoDate, number[]>()
  for (const p of live(prices)) {
    if (p.material_id !== materialId) continue
    byDay.set(p.observed_on, [...(byDay.get(p.observed_on) ?? []), p.price_krw_per_kg])
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vs]) => ({ date, value: vs.reduce((s, v) => s + v, 0) / vs.length }))
}

/** d 이하 가장 최근 날의 시장가(원/kg). 없으면 null. */
export function marketOn(prices: MarketPrice[], materialId: string, d: IsoDate): { date: IsoDate; value: number } | null {
  const days = dailyMarket(prices, materialId).filter((x) => x.date <= d)
  return days.length ? days[days.length - 1] : null
}

// ── 구매 LOT ─────────────────────────────────────────────────────────

/** 일 단위 구매가 — 그날 LOT들의 수량 가중 landed(Σ landed × kg ÷ Σ kg). */
export function dailyPurchase(lots: PurchaseLot[], materialId: string): { date: IsoDate; value: number; kg: number }[] {
  const byDay = new Map<IsoDate, { amt: number; kg: number }>()
  for (const l of live(lots)) {
    if (l.material_id !== materialId) continue
    const cur = byDay.get(l.received_on) ?? { amt: 0, kg: 0 }
    byDay.set(l.received_on, { amt: cur.amt + l.landed_krw_per_kg * l.qty_kg, kg: cur.kg + l.qty_kg })
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, value: v.amt / v.kg, kg: v.kg }))
}

export interface TrendPoint {
  /** 묶음의 첫날(일 · 주 월요일 · 달 1일). */
  bucket: IsoDate
  value: number
  /** 그 묶음에 든 일 단위 줄 수(시장가) · kg(구매가). */
  weight: number
}

/**
 * 일 단위 줄을 주 · 월로 묶는다. weight가 있으면(구매가 — kg) 가중평균, 없으면(시장가 — 하루 한 값) 날의 단순 평균.
 * 구매가의 가중은 kg — 설계서 9.2 «평균 단가(주 · 월)는 수량 가중(Σ금액 ÷ Σkg)».
 */
export function aggregate(daily: { date: IsoDate; value: number; kg?: number }[], g: Granularity): TrendPoint[] {
  const by = new Map<IsoDate, { sum: number; w: number }>()
  for (const d of daily) {
    const w = d.kg ?? 1
    const k = bucketOf(d.date, g)
    const cur = by.get(k) ?? { sum: 0, w: 0 }
    by.set(k, { sum: cur.sum + d.value * w, w: cur.w + w })
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({ bucket, value: v.sum / v.w, weight: v.w }))
}

/** (구매 ÷ 시장 − 1) × 100, 소수 한 자리. 둘 중 하나가 없으면 null. */
export function vsMarketPct(purchase: number | null, market: number | null): number | null {
  if (purchase === null || market === null || market <= 0) return null
  return Math.round((purchase / market - 1) * 1000) / 10
}

export interface MaterialOverview {
  material_id: string
  latestMarket: { date: IsoDate; value: number } | null
  latestLot: { lot_id: string; date: IsoDate; landed: number; supplier_id: string } | null
  /** 최근 LOT landed vs 그 LOT 입고일의 시장가. */
  latestLotVsMarketPct: number | null
  /** 30일(오늘 포함 30일) 수량 가중 landed. */
  avg30: { value: number; kg: number; lots: number } | null
  /** 30일 가중평균 vs 최신 시장가. */
  avg30VsMarketPct: number | null
  /** 공급처별 수량 가중 landed(전 기간 · 무효 제외). */
  bySupplier: { supplier_id: string; value: number; kg: number; lots: number }[]
}

export function materialOverview(materialId: string, prices: MarketPrice[], lots: PurchaseLot[], today: IsoDate): MaterialOverview {
  const mine = live(lots).filter((l) => l.material_id === materialId && l.received_on <= today)
  const latestMarket = marketOn(prices, materialId, today)

  const latest = [...mine].sort((a, b) => b.received_on.localeCompare(a.received_on) || b.created_at.localeCompare(a.created_at))[0]
  const latestLot = latest
    ? { lot_id: latest.lot_id, date: latest.received_on, landed: latest.landed_krw_per_kg, supplier_id: latest.supplier_id }
    : null
  const marketAtLot = latest ? marketOn(prices, materialId, latest.received_on) : null

  const from = addDays(today, -30)
  const recent = mine.filter((l) => l.received_on > from)
  const kg30 = recent.reduce((s, l) => s + l.qty_kg, 0)
  const avg30 = kg30 > 0 ? { value: recent.reduce((s, l) => s + l.landed_krw_per_kg * l.qty_kg, 0) / kg30, kg: kg30, lots: recent.length } : null

  const sup = new Map<string, { amt: number; kg: number; lots: number }>()
  for (const l of mine) {
    const cur = sup.get(l.supplier_id) ?? { amt: 0, kg: 0, lots: 0 }
    sup.set(l.supplier_id, { amt: cur.amt + l.landed_krw_per_kg * l.qty_kg, kg: cur.kg + l.qty_kg, lots: cur.lots + 1 })
  }

  return {
    material_id: materialId,
    latestMarket,
    latestLot,
    latestLotVsMarketPct: latestLot ? vsMarketPct(latestLot.landed, marketAtLot?.value ?? null) : null,
    avg30,
    avg30VsMarketPct: avg30 ? vsMarketPct(avg30.value, latestMarket?.value ?? null) : null,
    bySupplier: [...sup.entries()]
      .map(([supplier_id, v]) => ({ supplier_id, value: v.amt / v.kg, kg: v.kg, lots: v.lots }))
      .sort((a, b) => a.value - b.value),
  }
}

/** 원 단위 표시(반올림 · 쉼표). */
export function won(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('ko-KR')
}

export function pctText(p: number | null): string {
  if (p === null) return '—'
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`
}

/** «12.5» · «1,234.5678» — 쉼표가 든 문자열 → number. 비면 null. */
export function parseNum(v: string): number | null {
  const s = v.replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
