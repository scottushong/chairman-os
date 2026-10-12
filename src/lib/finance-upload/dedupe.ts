import { normalizeLabel } from '@/lib/ecount/excel/detect'
import type { FinDedupeSetting, FinRow, FinTxGroup, FinTxLine, TxSourceTable } from '@/types'

import type { UploadKind } from './kinds'

/**
 * 0072 «자료 간 같은 거래 한 번만» — 순수 함수(check:finance-upload가 잰다). DB는 결과를 저장만 한다(fin_tx_group_save).
 *
 * 맞추는 줄: 판매(fin_sales_lines) · 입고(fin_purchase_in_lines) · 세금계산서(fin_tax_invoice_lines) · 원장 거래 줄(fin_ledger_lines).
 * 같은 표의 줄끼리는 맞추지 않는다(같은 자료를 두 번 올린 것은 «겹침» 선택이 다룬다). 한 회사 · 한 달 안에서만(±3일이 달을 넘는 것은 DEFERRED).
 *
 * 열쇠: 회사 · 매출/매입 방향 · 거래처 · 날짜 ±3일 · 품목 또는 계정 · 금액(세전 또는 세후 둘 다) · 수량.
 *   - 금액이 맞지 않으면 짝이 아니다.
 *   - 둘 다 날짜가 있는데 3일 넘게 다르면 · 둘 다 거래처가 있는데 다르면 짝이 아니다.
 *   - 거래처가 같고 · 날짜가 둘 다 있고 ±3일 · 양쪽에 다 있는 칸(품목 · 계정 · 수량)이 모두 맞으면 → same(같은 거래).
 *   - 그 밖(거래처나 날짜가 한쪽에 없음 · 품목/수량이 다름 — 예: 금액만 맞음) → suspect(중복 의심). suspect는 자동으로 same이 되지 않는다.
 *   - 한 줄이 같은 다른 표의 줄 둘 이상과 same이면 그 짝들은 모두 suspect로 내린다(어느 쪽인지 모른다).
 * 원천 줄은 고치지 않는다 — R2 · ECOUNT 오류는 차이로만 보인다.
 */

export const TX_TABLE: Record<'sales' | 'purchase_in' | 'tax_invoice' | 'ledger_lines', TxSourceTable> = {
  sales: 'fin_sales_lines',
  purchase_in: 'fin_purchase_in_lines',
  tax_invoice: 'fin_tax_invoice_lines',
  ledger_lines: 'fin_ledger_lines',
}

export const TX_SOURCE_KO: Record<TxSourceTable, string> = {
  fin_sales_lines: '판매(R2 · ECOUNT)',
  fin_purchase_in_lines: '입고(R2 · ECOUNT)',
  fin_tax_invoice_lines: '세금계산서',
  fin_ledger_lines: '회계 원장',
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** 읽은 줄(아직 안 넣은 줄 — ref 'new:<row_no>')을 맞추기 줄로. */
export function txLinesFromRows(kind: UploadKind, rows: FinRow[]): FinTxLine[] {
  const out: FinTxLine[] = []
  for (const r of rows) {
    const base = { ref: `new:${r.row_no}`, upload_id: null, row_no: r.row_no, group_id: null }
    if (kind === 'sales' || kind === 'purchase_in') {
      const amount = num(r.amount)
      const vat = num(r.amount_vat)
      out.push({
        ...base,
        source: (str(r.source_system) as FinTxLine['source']) ?? 'other',
        direction: kind === 'sales' ? 'sales' : 'purchase',
        date: str(r.tx_date),
        counterparty: str(kind === 'sales' ? r.customer : r.supplier),
        item: str(kind === 'sales' ? r.product : r.material),
        account: null,
        amount,
        vat,
        total: amount !== null && vat !== null ? amount + vat : null,
        qty: num(r.qty),
      })
    } else if (kind === 'tax_invoice') {
      const dir = str(r.direction)
      if (dir !== 'sales' && dir !== 'purchase') continue
      out.push({ ...base, source: 'tax_invoice', direction: dir, date: str(r.issued_on), counterparty: str(r.counterparty), item: str(r.item), account: null, amount: num(r.supply_amount), vat: num(r.vat), total: num(r.total), qty: null })
    } else if (kind === 'ledger_lines') {
      const d = num(r.debit)
      const c = num(r.credit)
      // 차변 줄은 매입 쪽 · 대변 줄은 매출 쪽(원재료 차변 · 제품매출 대변). 둘 다 있거나 둘 다 없으면 맞추지 않는다.
      if ((d !== null && d !== 0) === (c !== null && c !== 0)) continue
      out.push({ ...base, source: 'ledger', direction: d ? 'purchase' : 'sales', date: str(r.tx_date), counterparty: str(r.counterparty), item: null, account: str(r.account_name), amount: d || c, vat: null, total: null, qty: null })
    }
  }
  return out
}

const table = (l: FinTxLine): string => (l.ref.startsWith('new:') ? 'new' : l.ref.slice(0, l.ref.indexOf(':')))
const norm = (s: string | null) => (s ? normalizeLabel(s).toLowerCase().replace(/[()（）㈜]|주식회사|\(주\)/g, '') : null)
const close = (a: number, b: number) => Math.abs(a - b) <= 1

function days(a: string, b: string): number | null {
  const x = Date.parse(a)
  const y = Date.parse(b)
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86_400_000 : null
}

/** 세전 · 세후 어느 쪽으로든 금액이 맞는가. 세액이 빈칸이면 10%를 더한 값도 본다. */
function amountMatch(a: FinTxLine, b: FinTxLine): 'excl' | 'incl' | null {
  if (a.amount === null || b.amount === null) return null
  if (close(a.amount, b.amount)) return 'excl'
  const inc = (l: FinTxLine) => [l.total, l.vat !== null ? l.amount! + l.vat : Math.round(l.amount! * 1.1)].filter((x): x is number => x !== null)
  if (inc(a).some((x) => close(x, b.amount!)) || inc(b).some((x) => close(x, a.amount!))) return 'incl'
  return null
}

export type Relation = { kind: 'same' | 'suspect'; evidence: Record<string, string> } | null

/** 두 줄의 관계(다른 표 · 같은 방향일 때만). */
export function relate(a: FinTxLine, b: FinTxLine): Relation {
  if (a.direction !== b.direction) return null
  const amt = amountMatch(a, b)
  if (!amt) return null
  const ev: Record<string, string> = { amount: amt === 'excl' ? '금액(세전) 같음' : '금액(세전 · 세후) 같음' }
  const ca = norm(a.counterparty)
  const cb = norm(b.counterparty)
  if (ca && cb && ca !== cb) return null
  const dd = a.date && b.date ? days(a.date, b.date) : null
  if (dd !== null && dd > 3) return null
  let mismatch = false
  if (ca && cb) ev.counterparty = '거래처 같음'
  if (dd !== null) ev.date = dd === 0 ? '날짜 같음' : `날짜 ${dd}일 차이`
  const ia = norm(a.item)
  const ib = norm(b.item)
  if (ia && ib) {
    if (ia === ib || ia.includes(ib) || ib.includes(ia)) ev.item = '품목 같음'
    else mismatch = true
  }
  const aa = norm(a.account)
  const ab = norm(b.account)
  if (aa && ab) {
    if (aa === ab) ev.account = '계정 같음'
    else mismatch = true
  }
  if (a.qty !== null && b.qty !== null) {
    if (close(a.qty, b.qty)) ev.qty = '수량 같음'
    else mismatch = true
  }
  const same = !!(ca && cb) && dd !== null && !mismatch
  return { kind: same ? 'same' : 'suspect', evidence: ev }
}

export interface TxGroupDraft {
  status: 'same' | 'suspect'
  refs: string[]
  evidence: Record<string, string>
  amount_base_ref: string | null
  qty_base_ref: string | null
}

const AMOUNT_ORDER: Record<FinDedupeSetting['amount_base'], string[]> = {
  ledger: ['fin_ledger_lines', 'fin_tax_invoice_lines', 'r2'],
  tax_invoice: ['fin_tax_invoice_lines', 'fin_ledger_lines', 'r2'],
  r2_ecount: ['r2', 'fin_ledger_lines', 'fin_tax_invoice_lines'],
}
const famOf = (l: FinTxLine) => (l.source === 'ledger' ? 'fin_ledger_lines' : l.source === 'tax_invoice' ? 'fin_tax_invoice_lines' : 'r2')

/** 기준 줄 — 금액 기본 = 원장 · 수량 기본 = R2 · ECOUNT(설정으로 바꾼다). 수량이 없는 줄은 수량 기준이 되지 않는다. */
export function baseRefs(lines: FinTxLine[], setting: FinDedupeSetting): { amount: string | null; qty: string | null } {
  const pick = (order: string[], ok: (l: FinTxLine) => boolean) => {
    for (const fam of order) {
      const l = lines.find((x) => famOf(x) === fam && ok(x))
      if (l) return l.ref
    }
    return null
  }
  return {
    amount: pick(AMOUNT_ORDER[setting.amount_base], (l) => l.amount !== null),
    qty: pick(setting.qty_base === 'r2_ecount' ? ['r2', 'fin_ledger_lines'] : ['fin_ledger_lines', 'r2'], (l) => l.qty !== null),
  }
}

/**
 * 줄 묶기. 이미 살아 있는 묶음에 든 줄(group_id)은 다시 묶지 않는다. 한 줄은 묶음 하나에만.
 *   same 짝 → 이어진 줄끼리 한 묶음(한 묶음에 같은 표 줄이 둘이면 suspect로 내린다).
 *   suspect 짝 → same 묶음에 안 든 줄끼리 둘씩.
 */
export function matchTx(lines: FinTxLine[], setting: FinDedupeSetting = { amount_base: 'ledger', qty_base: 'r2_ecount' }, rejected: ReadonlySet<string> = new Set()): TxGroupDraft[] {
  const free = lines.filter((l) => !l.group_id)
  const edges: { a: number; b: number; rel: NonNullable<Relation> }[] = []
  for (let i = 0; i < free.length; i += 1) {
    for (let j = i + 1; j < free.length; j += 1) {
      const ti = table(free[i])
      const tj = table(free[j])
      if (ti === tj && ti !== 'new') continue
      if (ti === 'new' && tj === 'new') continue
      if (famOf(free[i]) === famOf(free[j])) continue
      // 사람이 «다른 거래»로 푼 짝은 다시 묶지 않는다.
      if (rejected.has(pairKey(free[i].ref, free[j].ref))) continue
      const rel = relate(free[i], free[j])
      if (rel) edges.push({ a: i, b: j, rel })
    }
  }
  // 한 줄이 같은 다른 표 줄 둘 이상과 same이면 그 짝들을 suspect로.
  for (const e of edges) {
    if (e.rel.kind !== 'same') continue
    for (const end of [e.a, e.b]) {
      const other = end === e.a ? e.b : e.a
      const rivals = edges.filter((x) => x.rel.kind === 'same' && x !== e && (x.a === end || x.b === end) && famOf(free[x.a === end ? x.b : x.a]) === famOf(free[other]))
      if (rivals.length) {
        e.rel = { kind: 'suspect', evidence: { ...e.rel.evidence, ambiguous: '같은 자료에 맞는 줄이 둘 이상' } }
        for (const r of rivals) r.rel = { kind: 'suspect', evidence: { ...r.rel.evidence, ambiguous: '같은 자료에 맞는 줄이 둘 이상' } }
      }
    }
  }
  // same 묶음(이어진 줄)
  const parent = free.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (const e of edges) if (e.rel.kind === 'same') parent[find(e.a)] = find(e.b)
  const comps = new Map<number, number[]>()
  edges.filter((e) => e.rel.kind === 'same').forEach((e) => {
    for (const i of [e.a, e.b]) {
      const root = find(i)
      const c = comps.get(root) ?? []
      if (!c.includes(i)) c.push(i)
      comps.set(root, c)
    }
  })
  const out: TxGroupDraft[] = []
  const used = new Set<number>()
  for (const idx of comps.values()) {
    const fams = idx.map((i) => famOf(free[i]))
    const ok = new Set(fams).size === fams.length
    const ev = Object.assign({}, ...edges.filter((e) => idx.includes(e.a) && idx.includes(e.b)).map((e) => e.rel.evidence)) as Record<string, string>
    const ls = idx.map((i) => free[i])
    const base = baseRefs(ls, setting)
    out.push({ status: ok ? 'same' : 'suspect', refs: ls.map((l) => l.ref), evidence: ok ? ev : { ...ev, ambiguous: '같은 자료 줄이 둘 이상 묶임' }, amount_base_ref: base.amount, qty_base_ref: base.qty })
    idx.forEach((i) => used.add(i))
  }
  for (const e of edges) {
    if (e.rel.kind !== 'suspect' || used.has(e.a) || used.has(e.b)) continue
    const ls = [free[e.a], free[e.b]]
    const base = baseRefs(ls, setting)
    out.push({ status: 'suspect', refs: ls.map((l) => l.ref), evidence: e.rel.evidence, amount_base_ref: base.amount, qty_base_ref: base.qty })
    used.add(e.a)
    used.add(e.b)
  }
  return out
}

/** 짝 열쇠(순서 없음). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** «다른 거래»로 정한 묶음의 줄 짝들 — 다시 묶지 않는다. */
export function rejectedPairs(groups: FinTxGroup[]): Set<string> {
  const out = new Set<string>()
  for (const g of groups) {
    if (g.status !== 'rejected') continue
    const refs = g.members.map((m) => `${m.source_table}:${m.line_id}`)
    for (let i = 0; i < refs.length; i += 1) for (let j = i + 1; j < refs.length; j += 1) out.add(pairKey(refs[i], refs[j]))
  }
  return out
}

/** 새 올리기의 줄이 든 «중복 의심» 묶음 수 — 자동 넣기 다섯째 조건(p_dup_suspects). */
export function countNewSuspects(groups: TxGroupDraft[]): number {
  return groups.filter((g) => g.status === 'suspect' && g.refs.some((r) => r.startsWith('new:'))).length
}

/** 묶음 한 줄 설명(화면 · 미리보기 — 금액은 보이지 않는다, 열쇠 이름만). */
export function describeGroup(g: { evidence: Record<string, unknown> | null }): string {
  return Object.values(g.evidence ?? {}).map(String).join(' · ')
}
