import { createHash } from 'node:crypto'

import { accountMap, buildCells } from '@/lib/ledger/cells'
import { computeMonthlyPl, dedupeLines, maskPlResult, normalizeMaterial, plDiff, stableJson } from '@/lib/monthly-pl/calc'
import type {
  FinanceLedger,
  MonthlyPlInput,
  MonthlyPlResult,
  MonthlyPlView,
  PlAdjustmentKind,
  PlMaterialInput,
  PlSettings,
  PlStockInput,
  Role,
} from '@/types'

import { dummyFinLines, dummyFinStore, dummyPlOpenFlags, dummyPlRecloseClear, dummyPlRecloseMark } from './dummy-finance-upload'
import type { ChairmanRepository } from './types'

/**
 * 0075 «월별 손익 — 재고 반영 · 마감»의 dummy 자리. 0075 fin_pl_gather · fin_pl_record · fin_pl_reopen · 조정 · 설정을 옮겨 적었다
 * (live에서는 돌지 않는다). 계산은 live와 같은 식(src/lib/monthly-pl/calc.ts — SQL fin_pl_compute와 check:monthly-pl이 대조).
 * 원천은 dummy 자료 올리기 저장소(dummy-finance-upload.ts) · dummy 장부(dummy-books.ts)다. 원천은 고치지 않는다.
 */

export interface DummyMonthlyPlDeps {
  viewer(): { user_id: string; role: Role }
  canRead(businessId: string): boolean
  canKeep(businessId: string): boolean
  canClose(businessId: string): boolean
  /** 대표 또는 '/costing/<회사>' 줄 — 원료별 줄을 볼 수 있는 사람(0075 fin_pl_cost_viewer). */
  costViewer(businessId: string): boolean
  featureOn(businessId: string): Promise<boolean>
  ledger(): Promise<FinanceLedger>
  name(userId: string): string | null
}

type Methods = Pick<
  ChairmanRepository,
  'finPlMonth' | 'finPlYear' | 'finPlSettings' | 'finPlRecord' | 'finPlReopen' | 'finPlAdjustPropose' | 'finPlAdjustDecide' | 'finPlSettingsSave' | 'finPlAdjustRow'
>

interface Close {
  close_id: string
  business_id: string
  period: string
  status: 'provisional' | 'final'
  calc_version: string
  input_hash: string
  totals: Omit<MonthlyPlResult, 'materials'> & { provisional_diff: Record<string, number | null> | null; changed_vs_prev_final: Record<string, number | null> | null }
  detail: { input: MonthlyPlInput; materials: MonthlyPlResult['materials'] }
  recorded_by: string
  recorded_at: string
  closed_by: string | null
  closed_at: string | null
  reopened_at: string | null
  superseded_at: string | null
}
interface Adj {
  adj_id: string
  business_id: string
  period: string
  kind: PlAdjustmentKind
  amount: number
  reason: string
  status: 'proposed' | 'approved' | 'voided'
  proposed_by: string
  proposed_at: string
  approved_by: string | null
}
interface Store {
  closes: Close[]
  adjustments: Adj[]
  settings: Map<string, PlSettings>
}
const g = globalThis as unknown as { __chairmanDummyMonthlyPl?: Store }
const store: Store = (g.__chairmanDummyMonthlyPl ??= { closes: [], adjustments: [], settings: new Map() })

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const DEFAULTS: PlSettings = { method: 'monthly_wa', method_confirmed: false, tolerance_krw: 1000, revenue_source: 'books', payment_categories: ['원재료', '원료', '원자재'], updated_at: null }
const prevPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const reasonOk = (r: string | null | undefined) => (r ?? '').trim().length >= 2
const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : xs.reduce<number>((t, x) => t + (x as number), 0))
const liveClose = (b: string, p: string) => store.closes.find((c) => c.business_id === b && c.period === p && !c.superseded_at)

/** 0075 fin_pl_gather 거울. */
async function gather(d: DummyMonthlyPlDeps, business: string, period: string): Promise<MonthlyPlInput> {
  const s = store.settings.get(business) ?? DEFAULTS
  const prev = prevPeriod(period)
  const pc = store.closes.find((c) => c.business_id === business && c.period === prev && c.status === 'final' && !c.superseded_at)
  const earlier = store.closes.some((c) => c.business_id === business && c.period < prev && c.status === 'final' && !c.superseded_at)
  const fin = dummyFinStore()
  const lines = dummyFinLines().filter((l) => l.business_id === business && !l.voided_at && !l.people)
  const of = (kind: string, p: string) => lines.filter((l) => l.kind === kind && l.period === p)
  const groups = fin.groups
    .filter((x) => x.business_id === business)
    .map((x) => ({ status: x.status, amount_base_ref: x.amount_base_ref, members: fin.members.filter((m) => m.group_id === x.group_id).map((m) => ({ source_table: m.source_table, line_id: m.line_id, released: !!m.released_at })) }))

  const purch = of('purchase_in', period)
  const dd = dedupeLines('fin_purchase_in_lines', purch.map((l) => l.line_id), groups)
  const cur = of('inventory', period)
  const prv = of('inventory', prev)
  const iss = of('material_issue', period)
  const byItem = (rows: typeof cur) => {
    const m = new Map<string, { q: number | null; a: number | null }>()
    for (const l of rows) {
      const k = normalizeMaterial(String(l.row.item ?? ''))
      const o = m.get(k) ?? { q: 0, a: 0 }
      const q = num(l.row.stock_qty)
      const a = l.row.amount_state === 'missing' ? null : num(l.row.amount)
      m.set(k, { q: o.q === null || q === null ? null : o.q + q, a: o.a === null || a === null ? null : o.a + a })
    }
    return m
  }
  const curM = byItem(cur)
  const prvM = byItem(prv)
  const pcl = new Map((pc?.detail.materials ?? []).map((m) => [m.name, m]))
  const names = new Set<string>()
  for (const l of purch) names.add(normalizeMaterial(String(l.row.material ?? '')))
  for (const k of curM.keys()) names.add(k)
  for (const l of iss) names.add(normalizeMaterial(String(l.row.material ?? '')))
  if (!pc) for (const k of prvM.keys()) names.add(k)
  for (const k of pcl.keys()) names.add(k)
  names.delete('')

  const materials: PlMaterialInput[] = [...names].sort().map((name) => {
    const ps = purch.filter((l) => normalizeMaterial(String(l.row.material ?? '')) === name && !dd.excluded.has(l.line_id))
    const ok = ps.filter((l) => num(l.row.qty) !== null && num(l.row.amount) !== null)
    const is = iss.filter((l) => normalizeMaterial(String(l.row.material ?? '')) === name)
    const kg = (pred: (r: (typeof is)[number]['row']) => boolean) => {
      const xs = is.filter((l) => pred(l.row) && l.row.qty_state !== 'missing').map((l) => num(l.row.qty_kg) ?? 0)
      return xs.length ? xs.reduce((t, x) => t + x, 0) : undefined
    }
    const np = (k: string) => kg((r) => r.class === 'non_production' && (k === 'adjust' ? (r.non_production_kind ?? 'adjust') === 'adjust' : r.non_production_kind === k))
    const non_production: PlMaterialInput['non_production'] = {}
    for (const k of ['sample', 'scrap', 'return', 'adjust'] as const) {
      const v = np(k)
      if (v !== undefined) non_production[k] = v
    }
    let opening_qty: number | null = null
    let opening_amount: number | null = null
    let opening_source: PlMaterialInput['opening_source'] = 'missing'
    if (pc) {
      const m = pcl.get(name)
      opening_qty = m ? (m.closing_qty ?? 0) : 0
      opening_amount = m ? (m.closing_amount ?? 0) : 0
      opening_source = m ? 'prev_close' : 'statement_absent'
    } else if (prv.length > 0) {
      const m = prvM.get(name)
      opening_qty = m ? m.q : 0
      opening_amount = m ? m.a : 0
      opening_source = m ? 'statement' : 'statement_absent'
    }
    const c = curM.get(name)
    return {
      name,
      opening_qty,
      opening_amount,
      opening_source,
      purchase_qty: ok.reduce((t, l) => t + (num(l.row.qty) ?? 0), 0),
      purchase_amount: ok.reduce((t, l) => t + (num(l.row.amount) ?? 0), 0),
      purchase_missing: ps.length - ok.length,
      production_qty: iss.length > 0 ? (kg((r) => r.class === 'production') ?? 0) : null,
      non_production,
      issue_needs_review: is.filter((l) => l.row.class === 'needs_review').length,
      issue_missing_qty: is.filter((l) => l.row.class !== 'needs_review' && l.row.qty_state === 'missing').length,
      closing_qty: cur.length > 0 ? (c ? c.q : 0) : null,
      closing_statement_amount: cur.length > 0 ? (c ? c.a : 0) : null,
      ...(cur.length > 0 && !c ? { closing_absent: true } : {}),
    }
  })

  const stock = (cat: 'wip' | 'finished'): PlStockInput => {
    const live = fin.valuations.find((v) => v.business_id === business && v.period === period && v.category === cat && !v.voided_at)
    let opening_amount: number | null = null
    let opening_source: PlStockInput['opening_source'] = 'unlinked'
    let opening_scope: PlStockInput['opening_scope'] = null
    if (pc) {
      opening_amount = cat === 'wip' ? pc.totals.basis.wip_closing : pc.totals.basis.finished_closing
      opening_source = 'prev_pl_close'
      opening_scope = pc.detail.input[cat].closing_scope
    } else {
      const pf = fin.valuations.find((v) => v.business_id === business && v.period === prev && v.category === cat && !v.voided_at && v.status === 'final' && v.value_state !== 'missing')
      if (pf) {
        opening_amount = pf.amount
        opening_source = 'prev_final_valuation'
        opening_scope = pf.cost_scope
      } else {
        const o = fin.openings.find((x) => x.business_id === business && x.period === period && x.category === cat && !x.voided_at && x.value_state !== 'missing')
        if (o) {
          opening_amount = o.amount
          opening_source = o.source
        }
      }
    }
    return {
      opening_amount,
      opening_source,
      opening_scope,
      closing_amount: live && live.value_state !== 'missing' ? live.amount : null,
      closing_status: live?.status ?? null,
      closing_scope: live?.cost_scope ?? null,
      duplicate_suspect: false,
    }
  }
  const wip = stock('wip')
  const finished = stock('finished')
  const w = fin.valuations.find((v) => v.business_id === business && v.period === period && v.category === 'wip' && !v.voided_at)
  const f = fin.valuations.find((v) => v.business_id === business && v.period === period && v.category === 'finished' && !v.voided_at)
  const dup = !!w && !!f && w.amount !== null && w.amount === f.amount && ((!!w.source_upload_id && w.source_upload_id === f.source_upload_id) || (!!w.source_ref && w.source_ref === f.source_ref))
  wip.duplicate_suspect = dup
  finished.duplicate_suspect = dup

  // 장부(전표 · 결산) — 0075와 같은 규칙: 이 달 손익 줄이 없으면 전부 미입력, 있으면 없는 구역은 0.
  const ledger = await d.ledger()
  const cells = buildCells(ledger, business).get(period)?.cells
  const accts = accountMap(ledger, business)
  let has = false
  const sums = { revenue: 0, raw: 0, labor: 0, overhead: 0, sga: 0, op: 0 }
  for (const c of cells?.values() ?? []) {
    const a = accts.get(c.account_code)
    if (!a || !['revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax'].includes(a.section)) continue
    has = true
    const v = c.amount.value
    if (a.section === 'revenue') sums.revenue -= v
    if (a.section === 'cogs' && a.category === 'raw_material') sums.raw += v
    if (a.section === 'cogs' && a.category === 'labor') sums.labor += v
    if (a.section === 'cogs' && a.category !== 'raw_material' && a.category !== 'labor') sums.overhead += v
    if (a.section === 'sga' || a.section === 'd_and_a') sums.sga += v
    if (['revenue', 'cogs', 'sga', 'd_and_a'].includes(a.section)) sums.op -= v
  }
  let revenue: number | null
  if (s.revenue_source === 'books') revenue = has ? sums.revenue : null
  else {
    const sales = of('sales', period)
    const sd = dedupeLines('fin_sales_lines', sales.map((l) => l.line_id), groups.filter((x) => x.status === 'same'))
    const kept = sales.filter((l) => !sd.excluded.has(l.line_id))
    revenue = kept.length > 0 ? sumOrNull(kept.map((l) => num(l.row.amount))) : null
  }

  const cash = of('cashflow', period)
  const pats = s.payment_categories.map((x) => x.toLowerCase())
  const matches = (c: unknown) => typeof c === 'string' && pats.some((p) => c.toLowerCase().includes(p))
  const rawOpen = fin.openings.find((o) => o.business_id === business && o.period === period && o.category === 'raw' && !o.voided_at && o.value_state !== 'missing')
  const stmtOpen = cur.filter((l) => l.row.opening_state !== 'missing' && num(l.row.opening_amount) !== null)

  return {
    period,
    method: s.method,
    method_confirmed: s.method_confirmed,
    tolerance_krw: s.tolerance_krw,
    materials,
    issues_uploaded: iss.length > 0,
    statement_uploaded: cur.length > 0,
    raw_opening_manual: rawOpen?.amount ?? null,
    raw_statement_opening: stmtOpen.length ? stmtOpen.reduce((t, l) => t + (num(l.row.opening_amount) ?? 0), 0) : null,
    wip,
    finished,
    revenue,
    revenue_source: s.revenue_source,
    books_has_lines: has,
    books_raw_material: has ? sums.raw : null,
    mfg_labor: has ? sums.labor : null,
    mfg_overhead: has ? sums.overhead : null,
    sga: has ? sums.sga : null,
    books_operating_income: has ? sums.op : null,
    adjustments: store.adjustments
      .filter((a) => a.business_id === business && a.period === period && a.status !== 'voided')
      .map((a) => ({ kind: a.kind, amount: a.amount, status: a.status as 'proposed' | 'approved' })),
    cash: {
      uploaded: cash.length > 0,
      material_payments: cash.length > 0 ? cash.filter((l) => matches(l.row.category)).reduce((t, l) => t + (num(l.row.outflow) ?? 0), 0) : null,
      inflow: cash.length > 0 ? cash.reduce((t, l) => t + (num(l.row.inflow) ?? 0), 0) : null,
      outflow: cash.length > 0 ? cash.reduce((t, l) => t + (num(l.row.outflow) ?? 0), 0) : null,
    },
    purchase_dupes_excluded: dd.excluded.size,
    purchase_suspects: dd.suspects,
    link: { prev_final: !!pc, earlier_final: earlier },
  }
}

const hashOf = (x: MonthlyPlInput) => createHash('md5').update(stableJson(x)).digest('hex')

export function dummyMonthlyPl(d: DummyMonthlyPlDeps): Methods {
  async function gate(business: string, period: string | null) {
    if (!(await d.featureOn(business))) throw new Error('feature_off')
    if (period !== null && !PERIOD.test(period)) throw new Error('fin_pl_period')
  }
  const chairOrCfo = () => ['Chairman', 'GroupCFO'].includes(d.viewer().role)
  const isFinal = (b: string, p: string) => store.closes.some((c) => c.business_id === b && c.period === p && c.status === 'final' && !c.superseded_at)

  return {
    async finPlMonth(business, period) {
      await gate(business, period)
      if (!d.canRead(business)) throw new Error('fin_pl_denied')
      const live = liveClose(business, period)
      const input = await gather(d, business, period)
      let result: MonthlyPlResult
      let view: MonthlyPlView['view_status']
      let opening_diff: MonthlyPlView['stale']['opening_diff'] = null
      if (live?.status === 'final') {
        const { provisional_diff: _p, changed_vs_prev_final: _c, ...rest } = live.totals
        void _p
        void _c
        result = { ...rest, materials: live.detail.materials }
        view = 'final'
        const pf = store.closes.find((c) => c.business_id === business && c.period === prevPeriod(period) && c.status === 'final' && !c.superseded_at)
        if (pf) {
          const sub = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b)
          const diff = {
            raw: sub(live.totals.basis.raw_opening, pf.totals.basis.raw_closing),
            wip: sub(live.totals.basis.wip_opening, pf.totals.basis.wip_closing),
            finished: sub(live.totals.basis.finished_opening, pf.totals.basis.finished_closing),
          }
          if ((diff.raw ?? 0) !== 0 || (diff.wip ?? 0) !== 0 || (diff.finished ?? 0) !== 0) opening_diff = diff
        }
      } else {
        result = computeMonthlyPl(input)
        view = result.status
      }
      return {
        business_id: business,
        period,
        view_status: view,
        record: live
          ? { close_id: live.close_id, status: live.status, calc_version: live.calc_version, input_hash: live.input_hash, recorded_at: live.recorded_at, recorded_by_name: d.name(live.recorded_by), closed_at: live.closed_at, closed_by_name: live.closed_by ? d.name(live.closed_by) : null }
          : null,
        result: maskPlResult(result, d.costViewer(business)),
        stale: { inputs_changed: live?.status === 'final' && live.input_hash !== hashOf(input), opening_diff, reclose_flags: dummyPlOpenFlags(business, period) },
        provisional_diff: live?.status === 'final' ? live.totals.provisional_diff : null,
        changed_vs_prev_final: live?.status === 'final' ? live.totals.changed_vs_prev_final : null,
        adjustments: store.adjustments
          .filter((a) => a.business_id === business && a.period === period)
          .map((a) => ({ adj_id: a.adj_id, kind: a.kind, amount: a.amount, reason: a.reason, status: a.status, proposed_by_name: d.name(a.proposed_by), proposed_at: a.proposed_at, approved_by_name: a.approved_by ? d.name(a.approved_by) : null })),
      }
    },
    async finPlYear(business, year) {
      await gate(business, null)
      if (!d.canRead(business) || !/^\d{4}$/.test(year)) throw new Error('fin_pl_denied')
      return store.closes
        .filter((c) => c.business_id === business && c.period.startsWith(`${year}-`) && !c.superseded_at)
        .sort((a, b) => (a.period < b.period ? -1 : 1))
        .map((c) => ({ period: c.period, status: c.status, closed_at: c.closed_at }))
    },
    async finPlSettings(business) {
      await gate(business, null)
      if (!d.canRead(business)) throw new Error('fin_pl_denied')
      return { ...(store.settings.get(business) ?? DEFAULTS) }
    },
    async finPlRecord(business, period, final, reason) {
      await gate(business, period)
      if (final ? !d.canClose(business) : !d.canKeep(business)) throw new Error('fin_pl_denied')
      const live = liveClose(business, period)
      const input = await gather(d, business, period)
      const hash = hashOf(input)
      const status = final ? 'final' : 'provisional'
      if (live?.status === 'final') {
        if (final && live.input_hash === hash) return live.close_id
        throw new Error('fin_pl_final')
      }
      if (live && live.input_hash === hash && live.status === status) return live.close_id
      const res = computeMonthlyPl(input)
      if (res.status === 'entering') throw new Error('fin_pl_entering')
      if (final && !res.closable) throw new Error('fin_pl_blocked')
      const { materials, ...rest } = res
      let changed: Record<string, number | null> | null = null
      if (final) {
        const old = store.closes.filter((c) => c.business_id === business && c.period === period && c.status === 'final' && c.reopened_at).sort((a, b) => (a.reopened_at! < b.reopened_at! ? 1 : -1))[0]
        if (old) {
          const sub = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b)
          changed = {
            raw_closing: sub(res.basis.raw_closing, old.totals.basis.raw_closing),
            wip_closing: sub(res.basis.wip_closing, old.totals.basis.wip_closing),
            finished_closing: sub(res.basis.finished_closing, old.totals.basis.finished_closing),
            operating_income: sub(res.pl.operating_income, old.totals.pl.operating_income),
          }
        }
      }
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      if (live) live.superseded_at = now
      store.closes.push({
        close_id: id, business_id: business, period, status, calc_version: res.calc_version, input_hash: hash,
        totals: { ...rest, provisional_diff: final && live ? plDiff(res.pl, live.totals.pl) : null, changed_vs_prev_final: changed },
        detail: { input, materials }, recorded_by: d.viewer().user_id, recorded_at: now,
        closed_by: final ? d.viewer().user_id : null, closed_at: final ? now : null, reopened_at: null, superseded_at: null,
      })
      if (final) dummyPlRecloseClear(business, period)
      void reason
      return id
    },
    async finPlReopen(business, period, reason) {
      await gate(business, period)
      if (!chairOrCfo() || !d.canRead(business)) throw new Error('fin_pl_denied')
      if (!reasonOk(reason)) throw new Error('fin_pl_reason')
      const live = liveClose(business, period)
      if (!live || live.status !== 'final') throw new Error('fin_pl_not_final')
      const now = new Date().toISOString()
      live.superseded_at = now
      live.reopened_at = now
      let n = 0
      for (const c of store.closes.filter((x) => x.business_id === business && x.period > period && x.status === 'final' && !x.superseded_at)) {
        if (dummyPlRecloseMark(business, c.period, `앞 달(${period}) 월별 손익을 다시 열었다 — ${reason.trim()}`)) n++
      }
      return n
    },
    async finPlAdjustPropose(x) {
      await gate(x.business_id, x.period)
      if (!d.canKeep(x.business_id)) throw new Error('fin_pl_denied')
      if (!['shrinkage', 'scrap', 'valuation_loss', 'other'].includes(x.kind) || !Number.isInteger(x.amount) || x.amount === 0) throw new Error('fin_pl_adjust_value')
      if (!reasonOk(x.reason)) throw new Error('fin_pl_reason')
      if (isFinal(x.business_id, x.period)) throw new Error('fin_pl_final')
      const reason = x.reason.trim().slice(0, 500)
      const same = store.adjustments.find((a) => a.business_id === x.business_id && a.period === x.period && a.kind === x.kind && a.amount === x.amount && a.reason === reason && a.status !== 'voided')
      if (same) return same.adj_id
      const id = crypto.randomUUID()
      store.adjustments.push({ adj_id: id, business_id: x.business_id, period: x.period, kind: x.kind, amount: x.amount, reason, status: 'proposed', proposed_by: d.viewer().user_id, proposed_at: new Date().toISOString(), approved_by: null })
      return id
    },
    async finPlAdjustDecide(adjId, action, reason) {
      const a = store.adjustments.find((x) => x.adj_id === adjId)
      if (!a) throw new Error('fin_pl_denied')
      await gate(a.business_id, a.period)
      if (action === 'approve' ? !d.canClose(a.business_id) : !d.canKeep(a.business_id)) throw new Error('fin_pl_denied')
      if (action === 'approve' && a.proposed_by === d.viewer().user_id) throw new Error('fin_pl_self_approve')
      if (action === 'void' && !reasonOk(reason)) throw new Error('fin_pl_reason')
      if (isFinal(a.business_id, a.period)) throw new Error('fin_pl_final')
      if ((action === 'approve' && a.status !== 'proposed') || (action === 'void' && a.status === 'voided')) return false
      if (action === 'approve') Object.assign(a, { status: 'approved', approved_by: d.viewer().user_id })
      else a.status = 'voided'
      return true
    },
    async finPlSettingsSave(business, s, reason) {
      await gate(business, null)
      if (!chairOrCfo() || !d.canRead(business)) throw new Error('fin_pl_denied')
      if (!reasonOk(reason)) throw new Error('fin_pl_reason')
      const cats = s.payment_categories.map((x) => x.trim())
      if (!['monthly_wa', 'statement'].includes(s.method) || !Number.isInteger(s.tolerance_krw) || s.tolerance_krw < 0 || !['books', 'sales_upload'].includes(s.revenue_source)
        || cats.length < 1 || cats.length > 20 || cats.some((x) => x.length < 1 || x.length > 40)) {
        throw new Error('fin_pl_setting_value')
      }
      store.settings.set(business, { ...s, payment_categories: cats, updated_at: new Date().toISOString() })
    },
    async finPlAdjustRow(adjId) {
      const a = store.adjustments.find((x) => x.adj_id === adjId)
      return a && d.canRead(a.business_id) ? { business_id: a.business_id, period: a.period } : null
    },
  }
}

/** 시험이 저장본을 읽는다(dummy만). */
export function dummyPlCloses(): readonly Readonly<Close>[] {
  return store.closes
}
