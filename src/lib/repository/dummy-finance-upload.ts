import type {
  FinDedupeSetting,
  FinInventoryRollRow,
  FinIssueSummary,
  FinRecloseFlag,
  FinRow,
  FinTxGroup,
  FinTxLine,
  FinUpload,
  FinUploadApplyInput,
  FinUploadPending,
  FinUploadShape,
  FinValuation,
  FinValuationWarning,
  Role,
  TxSourceTable,
  ValueState,
} from '@/types'

import { DUMMY_UID } from './dummy-org'
import type { ChairmanRepository } from './types'

/**
 * 0070 · 0072의 dummy 자리 — fin_uploads · 자료 표 · 학습 · 평가금액 · 기초재고 · 원료 출고 · 같은 거래 · 재마감 대상을 메모리에서 흉내 낸다
 * (정책 · RPC를 옮겨 적은 것, live에서는 돌지 않는다).
 * 0070: 같은 파일 두 번 · 겹침 선택 · 자동은 겹침 · 마감 거부 · 마감 달은 대표 · CFO + 이유 · 되돌리기 7일(바꾸기 되돌리면 옛 줄 되살림) ·
 *       급여 개인 줄은 대표 · CFO에게만 · 쓰기는 장부를 쓰는 사람만.
 * 0072: 자동은 중복 의심 수가 없거나(null) 1 이상이면 거부 · 상태 없는 0 거부(재고 기말 금액만 0 확인) · 확정자 ≠ 입력자 ·
 *       출고 구분 기본값은 «확인 필요» · 출고 kg는 대기 읽기에서 빠지고 넣을 때 대기 줄에서 붙는다 · suspect는 자동으로 same이 되지 않는다 ·
 *       마감 달에 넣거나 바꾸면 «재마감 대상» 한 줄(손익 · 마감 줄은 건드리지 않는다).
 * 화면 확인용 예시(가짜 회사 값 · 2026-09 · 2026-08, biz_dy)를 처음 읽을 때 한 번 넣는다(ensureDemo) — 시험은 2099년 달을 쓴다.
 */

export interface DummyFinUploadDeps {
  viewer(): { user_id: string; role: Role }
  canKeep(businessId: string): boolean
  canRead(businessId: string): boolean
  canClose(businessId: string): boolean
  closed(businessId: string, period: string): Promise<boolean>
  notify(userId: string, title: string, body: string, link: string): void
  name(userId: string): string | null
}

type Methods = Pick<
  ChairmanRepository,
  | 'listFinUploads'
  | 'finUploadPending'
  | 'finUploadRecord'
  | 'finUploadApply'
  | 'finUploadRevert'
  | 'finUploadCancel'
  | 'finMonthClosed'
  | 'listFinUploadShapes'
  | 'saveFinUploadShape'
  | 'listFinValuations'
  | 'finValuationSave'
  | 'finValuationConfirm'
  | 'finValuationVoid'
  | 'finValuationWarnings'
  | 'finInventoryRoll'
  | 'finOpeningSave'
  | 'finOpeningConfirm'
  | 'finIssueSummary'
  | 'finIssueBulkDecide'
  | 'listFinTxLines'
  | 'listFinTxGroups'
  | 'finTxGroupSave'
  | 'finTxGroupDecide'
  | 'finDedupeSetting'
  | 'finDedupeSettingSave'
  | 'listFinRecloseFlags'
  | 'finRecloseClear'
  | 'finRowBusiness'
>

interface Line {
  line_id: number
  upload_id: string
  business_id: string
  period: string
  kind: string
  people: boolean
  row: FinRow
  voided_at: string | null
}

type Valuation = Omit<FinValuation, 'entered_by_name' | 'confirmed_by_name'>

interface Opening {
  opening_id: string
  business_id: string
  period: string
  category: 'raw' | 'wip' | 'finished'
  amount: number | null
  value_state: ValueState
  source: 'manual' | 'statement'
  source_upload_id: string | null
  note: string
  entered_by: string
  confirmed_by?: string | null
  confirmed_at?: string | null
  voided_at: string | null
  void_reason: string | null
}

interface Group extends Omit<FinTxGroup, 'members'> {
  saved_by: string
  decided_by: string | null
}
interface Member {
  group_id: string
  source_table: TxSourceTable
  line_id: number
  business_id: string
  released_at: string | null
}

interface Flag extends FinRecloseFlag {
  cleared_at: string | null
}

interface Store {
  uploads: (FinUpload & { pending: FinUploadPending | null })[]
  lines: Line[]
  shapes: FinUploadShape[]
  seq: number
  valuations: Valuation[]
  openings: Opening[]
  groups: Group[]
  members: Member[]
  dedupe: Map<string, FinDedupeSetting>
  flags: Flag[]
  demo: boolean
}
const g = globalThis as unknown as { __chairmanDummyFinUpload?: Store }
const store: Store = (g.__chairmanDummyFinUpload ??= { uploads: [], lines: [], shapes: [], seq: 0, valuations: [], openings: [], groups: [], members: [], dedupe: new Map(), flags: [], demo: false })
// 옛 모양(0070 판)의 저장소가 dev 서버에 남아 있으면 새 칸을 채운다.
store.seq ??= 0
store.valuations ??= []
store.openings ??= []
store.groups ??= []
store.members ??= []
store.dedupe ??= new Map()
store.flags ??= []

/** 0074 — 바꾸기 · 되돌리기를 대표 · CFO만 하는 종류. */
const RESTRICTED = new Set<string>(['material_issue', 'inventory'])

/** 시험이 줄을 읽는다(dummy만 — live에는 표를 직접 읽는 화면이 다음 블록이다). */
export function dummyFinLines(): readonly Line[] {
  return store.lines
}
/** 시험이 평가금액 · 재마감 대상을 읽는다(dummy만). 0075 dummy(월별 손익)도 같은 저장소를 읽는다. */
export function dummyFinStore(): Readonly<Pick<Store, 'valuations' | 'flags' | 'groups' | 'members' | 'openings'>> {
  ensureDemo()
  return store
}

/** 0075 거울 — 다시 열기가 이후 확정 달에 «재마감 대상»('pl_reopen')을 한 줄(열린 줄이 있으면 늘리지 않는다) · 다시 마감하면 푼다. */
export function dummyPlRecloseMark(business: string, period: string, reason: string): boolean {
  if (store.flags.some((f) => f.business_id === business && f.period === period && f.cause === 'pl_reopen' && !f.cleared_at)) return false
  store.flags.push({ flag_id: crypto.randomUUID(), business_id: business, period, upload_id: null, cause: 'pl_reopen', reason, created_at: new Date().toISOString(), cleared_at: null })
  return true
}
export function dummyPlRecloseClear(business: string, period: string): void {
  for (const f of store.flags) if (f.business_id === business && f.period === period && f.cause === 'pl_reopen' && !f.cleared_at) f.cleared_at = new Date().toISOString()
}
export function dummyPlOpenFlags(business: string, period: string): number {
  return store.flags.filter((f) => f.business_id === business && f.period === period && f.cause === 'pl_reopen' && !f.cleared_at).length
}

const live = (s: FinUpload['status']) => s === 'applied' || s === 'needs_review'
const chairOrCfo = (r: Role) => r === 'Chairman' || r === 'GroupCFO'
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const TABLE_OF: Record<string, TxSourceTable> = { sales: 'fin_sales_lines', purchase_in: 'fin_purchase_in_lines', tax_invoice: 'fin_tax_invoice_lines', ledger_lines: 'fin_ledger_lines' }
const KIND_OF: Record<TxSourceTable, string> = { fin_sales_lines: 'sales', fin_purchase_in_lines: 'purchase_in', fin_tax_invoice_lines: 'tax_invoice', fin_ledger_lines: 'ledger_lines' }
const reasonOk = (r: string | null | undefined) => (r ?? '').trim().length >= 2
const prevPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 0072 fin_value_state_of 거울 — 상태가 있으면 값과 맞아야 하고, 없으면 null → missing · 0 → (zeroOk면 0 확인 · 아니면 거부) · 그 밖 → value. */
function stateOf(state: unknown, value: unknown, zeroOk = false): ValueState {
  const v = numOrNull(value)
  if (state !== null && state !== undefined && state !== '') {
    const s = String(state)
    const ok = (s === 'missing' && v === null) || (s === 'confirmed_zero' && v === 0) || (s === 'value' && v !== null && v !== 0)
    if (!ok) throw new Error('fin_value_state')
    return s as ValueState
  }
  if (v === null) return 'missing'
  if (v === 0) {
    if (zeroOk) return 'confirmed_zero'
    throw new Error('fin_value_state')
  }
  return 'value'
}

/** 줄을 넣기 전에 상태 칸을 채운다(0072 칸은 상태 없는 0 거부 · 재고 기말 금액만 0 확인). */
function withStates(kind: string, row: FinRow): FinRow {
  const r: FinRow = { ...row }
  if (kind === 'sales' || kind === 'purchase_in') r.vat_state = stateOf(row.vat_state, row.amount_vat)
  if (kind === 'inventory') {
    r.amount_state = stateOf(row.amount_state, row.amount, true)
    r.opening_state = stateOf(row.opening_state, row.opening_amount)
  }
  if (kind === 'tax_invoice') {
    r.supply_state = stateOf(row.supply_state, row.supply_amount)
    r.vat_state = stateOf(row.vat_state, row.vat)
  }
  if (kind === 'material_issue') {
    r.qty_state = stateOf(row.qty_state, row.qty_kg)
    const cls = typeof row.class === 'string' && ['production', 'non_production'].includes(row.class) ? row.class : 'needs_review'
    r.class = cls
    r.non_production_kind = cls === 'needs_review' ? null : (row.non_production_kind ?? null)
    r.class_source = cls === 'needs_review' ? 'none' : 'rule'
    r.class_reason = cls === 'needs_review' ? null : String(row.class_reason ?? '').slice(0, 200)
    if (cls !== 'needs_review' && !reasonOk(r.class_reason as string)) throw new Error('fin_issue_class')
  }
  return r
}

export function dummyFinanceUpload(d: DummyFinUploadDeps): Methods {
  const strip = ({ pending: _p, ...u }: Store['uploads'][number]): FinUpload => (void _p, { ...u })
  const nextId = () => (store.seq += 1)
  function voidRows(ids: string[], on: boolean) {
    for (const l of store.lines) if (ids.includes(l.upload_id)) l.voided_at = on ? new Date().toISOString() : null
    if (on) {
      for (const v of store.valuations) if (v.source_upload_id && ids.includes(v.source_upload_id) && !v.voided_at && v.status !== 'final') Object.assign(v, { voided_at: new Date().toISOString(), void_reason: '올리기 되돌림 · 바뀜' })
    } else {
      for (const v of store.valuations) {
        if (!v.source_upload_id || !ids.includes(v.source_upload_id) || v.void_reason !== '올리기 되돌림 · 바뀜') continue
        if (store.valuations.some((o) => o !== v && o.business_id === v.business_id && o.period === v.period && o.category === v.category && !o.voided_at)) continue
        Object.assign(v, { voided_at: null, void_reason: null })
      }
    }
  }
  async function reclose(business: string, period: string, upload: string | null, cause: Flag['cause'], reason: string | null) {
    if (!(await d.closed(business, period))) return
    if (store.flags.some((f) => f.business_id === business && f.period === period && !f.cleared_at && f.cause === cause && f.upload_id === upload)) return
    store.flags.push({ flag_id: crypto.randomUUID(), business_id: business, period, upload_id: upload, cause, reason: reason?.trim() || null, created_at: new Date().toISOString(), cleared_at: null })
  }
  async function closedGate(business: string, period: string, reason: string | null) {
    if ((await d.closed(business, period)) && !(chairOrCfo(d.viewer().role) && reasonOk(reason))) throw new Error('fin_upload_closed')
  }
  const named = (v: Valuation): FinValuation => ({ ...v, entered_by_name: d.name(v.entered_by), confirmed_by_name: v.confirmed_by ? d.name(v.confirmed_by) : null })
  const liveLine = (table: TxSourceTable, lineId: number, business: string, period: string) =>
    store.lines.find((l) => l.line_id === lineId && l.kind === KIND_OF[table] && l.business_id === business && l.period === period && !l.voided_at && !l.people)

  return {
    async listFinUploads(businessId) {
      ensureDemo()
      if (!d.canKeep(businessId) && !d.canRead(businessId)) return []
      return store.uploads.filter((u) => u.business_id === businessId).map(strip)
    },
    async finUploadPending(id) {
      const u = store.uploads.find((x) => x.upload_id === id)
      if (!u || !d.canKeep(u.business_id) || u.status !== 'needs_review' || !u.pending) return null
      // 0072 리뷰 C1: 원료 출고는 누구에게도 kg를 싣지 않는다(줄의 kg · 상태 빼고 칸 격자 통째로 뺌 — 대표 · CFO도).
      if (u.kind === 'material_issue') {
        const { people: _p, grid: _g, ...rest } = u.pending
        void _p
        void _g
        return structuredClone({ ...rest, rows: rest.rows.map(({ qty_kg: _k, qty_state: _s, ...r }) => (void _k, void _s, r as FinRow)) })
      }
      if (chairOrCfo(d.viewer().role)) return structuredClone(u.pending)
      const { people: _drop, grid, ...rest } = u.pending
      void _drop
      // 급여는 칸 격자에도 사람별 줄이 있다 — 대표 · CFO 밖에는 뺀다(0070 fin_upload_pending과 같다).
      return structuredClone(u.kind === 'payroll' ? rest : { ...rest, grid })
    },
    async finUploadRecord(x) {
      if (!d.canKeep(x.business_id)) throw new Error('fin_upload_denied')
      if (x.status === 'needs_review' && store.uploads.some((u) => u.business_id === x.business_id && u.kind === x.kind && (u.period ?? '') === (x.period ?? '') && u.file_sha256 === x.file_sha256 && live(u.status))) {
        throw new Error('fin_upload_duplicate')
      }
      const row = {
        upload_id: crypto.randomUUID(),
        business_id: x.business_id,
        kind: x.kind,
        period: x.period,
        file_name: x.file_name,
        file_sha256: x.file_sha256,
        sheet_name: x.sheet_name,
        ai_confidence: x.ai_confidence,
        ai_used: x.ai_used,
        auto: false,
        status: x.status,
        row_count: x.pending?.rows.length ?? 0,
        overlap: 'none' as const,
        reason: null,
        error: x.error,
        created_by: d.viewer().user_id,
        created_at: new Date().toISOString(),
        applied_at: null,
        reverted_at: null,
        replaced_by: null,
        pending: x.status === 'failed' ? null : x.pending,
      }
      store.uploads.unshift(row)
      return row.upload_id
    },
    async finUploadApply(x: FinUploadApplyInput) {
      if (!d.canKeep(x.business_id)) throw new Error('fin_upload_denied')
      if (!PERIOD.test(x.period)) throw new Error('fin_upload_period')
      if (!x.rows.length) throw new Error('fin_upload_rows')
      if ((x.dup_suspects ?? 0) < 0) throw new Error('fin_upload_dup_count')
      const old = store.uploads.filter((u) => u.business_id === x.business_id && u.kind === x.kind && u.period === x.period && u.status === 'applied' && u.upload_id !== x.upload_id)
      const closed = await d.closed(x.business_id, x.period)
      // 0072 다섯째 조건: 중복 의심 수가 없거나(null) 1 이상이면 자동 거부.
      if (x.auto && (old.length || closed || x.dup_suspects === null || x.dup_suspects === undefined || x.dup_suspects > 0)) throw new Error('fin_upload_auto_blocked')
      if (closed && !(chairOrCfo(d.viewer().role) && reasonOk(x.reason))) throw new Error('fin_upload_closed')
      if (old.length && x.overlap === 'none') throw new Error('fin_upload_overlap')
      // 0074 거울: 원료 출고 · 재고의 바꾸기는 대표 · CFO만(전후 합계 차이로 원료 하나의 양이 드러나지 않게). 무엇을 바꾸기 전에 거부한다.
      if (old.length && x.overlap === 'replace' && old.some((u) => RESTRICTED.has(u.kind)) && !chairOrCfo(d.viewer().role)) throw new Error('fin_replace_restricted')
      const overlap = old.length ? x.overlap : 'none'
      const status: FinUpload['status'] = overlap === 'keep_old' ? 'skipped' : 'applied'
      let id = x.upload_id
      let rows = x.rows
      const now = new Date().toISOString()
      if (id) {
        const u = store.uploads.find((v) => v.upload_id === id && v.business_id === x.business_id)
        if (!u || u.status !== 'needs_review') throw new Error('fin_upload_not_pending')
        // 0072 리뷰 C1: 출고 kg는 저장해 둔 대기 줄에서 줄 번호로 붙인다(앱이 돌려보내는 줄에는 kg가 없다).
        if (x.kind === 'material_issue' && u.pending?.rows) {
          const byNo = new Map(u.pending.rows.map((r) => [r.row_no, r]))
          rows = rows.map((r) => {
            const pr = byNo.get(r.row_no)
            if (!pr) return r
            const { qty_kg: _k, qty_state: _s, ...rest } = r
            void _k
            void _s
            return { ...rest, ...(pr.qty_kg !== undefined && pr.qty_kg !== null ? { qty_kg: pr.qty_kg } : {}), ...(pr.qty_state ? { qty_state: pr.qty_state } : {}) } as FinRow
          })
        }
        Object.assign(u, { kind: x.kind, period: x.period, status, auto: x.auto, overlap, reason: x.reason, pending: null, row_count: rows.length, applied_at: now })
      } else {
        if (store.uploads.some((u) => u.business_id === x.business_id && u.kind === x.kind && u.period === x.period && u.file_sha256 === x.file_sha256 && live(u.status))) {
          throw new Error('fin_upload_duplicate')
        }
        id = crypto.randomUUID()
        store.uploads.unshift({
          upload_id: id, business_id: x.business_id, kind: x.kind, period: x.period, file_name: x.file_name, file_sha256: x.file_sha256,
          sheet_name: x.sheet_name, ai_confidence: x.ai_confidence, ai_used: x.ai_used, auto: x.auto, status, row_count: rows.length,
          overlap, reason: x.reason, error: null, created_by: d.viewer().user_id, created_at: now, applied_at: now, reverted_at: null,
          replaced_by: null, pending: null,
        })
      }
      if (status === 'applied') {
        if (overlap === 'replace') {
          voidRows(old.map((u) => u.upload_id), true)
          for (const u of old) Object.assign(u, { status: 'replaced', replaced_by: id })
        }
        if (x.kind === 'valuation') {
          const cats = new Set(rows.map((r) => String(r.category)))
          if (store.valuations.some((v) => v.business_id === x.business_id && v.period === x.period && !v.voided_at && v.status === 'final' && cats.has(v.category))) {
            throw new Error('fin_valuation_final_exists')
          }
          for (const v of store.valuations) {
            if (v.business_id === x.business_id && v.period === x.period && !v.voided_at && cats.has(v.category)) Object.assign(v, { voided_at: now, void_reason: '새 올리기로 바뀜' })
          }
          for (const r of rows) {
            store.valuations.push({
              valuation_id: crypto.randomUUID(), business_id: x.business_id, period: x.period, category: r.category as Valuation['category'], amount: numOrNull(r.amount),
              value_state: stateOf(r.value_state, r.amount), valuation_date: (r.valuation_date as string) ?? null, method: (r.method as string) || null,
              cost_scope: r.cost_scope as Valuation['cost_scope'], source: (x.file_name || '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'excel', source_upload_id: id,
              source_ref: (r.source_ref as string) ?? `줄 ${r.row_no}`, note: (r.note as string) || null, status: 'provisional', entered_by: d.viewer().user_id,
              entered_at: now, confirmed_by: null, confirmed_at: null, voided_at: null, void_reason: null,
            })
          }
        } else {
          for (const row of rows) store.lines.push({ line_id: nextId(), upload_id: id, business_id: x.business_id, period: x.period, kind: x.kind, people: false, row: withStates(x.kind, row), voided_at: null })
          for (const row of x.people ?? []) store.lines.push({ line_id: nextId(), upload_id: id, business_id: x.business_id, period: x.period, kind: x.kind, people: true, row: { ...row }, voided_at: null })
        }
        if (closed) await reclose(x.business_id, x.period, id, 'upload', x.reason)
      }
      if (x.auto) d.notify(d.viewer().user_id, '자료를 자동으로 넣었습니다', `${x.kind} · ${x.period} · ${rows.length}줄 — 7일 안에 되돌릴 수 있습니다.`, `/finance/${x.business_id}/upload`)
      return id
    },
    async finUploadRevert(id, reason) {
      const u = store.uploads.find((x) => x.upload_id === id)
      if (!u || !d.canKeep(u.business_id)) throw new Error('fin_upload_denied')
      if (u.status !== 'applied') return false
      if (u.applied_at && Date.parse(u.applied_at) < Date.now() - 7 * 86_400_000) throw new Error('fin_upload_revert_expired')
      if (u.period && (await d.closed(u.business_id, u.period)) && !chairOrCfo(d.viewer().role)) throw new Error('fin_upload_closed')
      // 0074 거울: 원료 출고 · 재고의 되돌리기도 대표 · CFO만(되돌리기 뒤 다시 넣기 = 바꾸기와 같은 차분).
      if (RESTRICTED.has(u.kind) && !chairOrCfo(d.viewer().role)) throw new Error('fin_replace_restricted')
      voidRows([id], true)
      const prev = store.uploads.filter((x) => x.replaced_by === id && x.status === 'replaced')
      voidRows(prev.map((x) => x.upload_id), false)
      for (const p of prev) Object.assign(p, { status: 'applied', replaced_by: null })
      Object.assign(u, { status: 'reverted', reverted_at: new Date().toISOString(), reason: reason ?? u.reason })
      if (u.period) await reclose(u.business_id, u.period, id, 'revert', reason)
      return true
    },
    async finUploadCancel(id) {
      const u = store.uploads.find((x) => x.upload_id === id)
      if (!u || !d.canKeep(u.business_id)) throw new Error('fin_upload_denied')
      if (u.status !== 'needs_review') return false
      Object.assign(u, { status: 'cancelled', pending: null })
      return true
    },
    finMonthClosed: (b, p) => d.closed(b, p),
    async listFinUploadShapes(businessId) {
      return d.canKeep(businessId) ? store.shapes.filter((s) => s.business_id === businessId).map((s) => ({ ...s })) : []
    },
    async saveFinUploadShape(s) {
      if (!d.canKeep(s.business_id)) throw new Error('fin_upload_denied')
      if (Object.values(s.column_map).some((v) => !Number.isInteger(v) || v < 0 || v > 200)) throw new Error('fin_upload_shape')
      const i = store.shapes.findIndex((x) => x.business_id === s.business_id && x.header_sig === s.header_sig)
      if (i >= 0) store.shapes[i] = { ...s }
      else store.shapes.push({ ...s })
    },

    /* ───── 0072 ───── */
    async finRowBusiness(kind, id) {
      ensureDemo()
      const biz = kind === 'valuation' ? store.valuations.find((x) => x.valuation_id === id)?.business_id : kind === 'tx_group' ? store.groups.find((x) => x.group_id === id)?.business_id : kind === 'opening' ? store.openings.find((x) => x.opening_id === id)?.business_id : store.flags.find((x) => x.flag_id === id)?.business_id
      return biz && d.canRead(biz) ? biz : null
    },
    async listFinValuations(businessId, period) {
      ensureDemo()
      if (!d.canRead(businessId)) return []
      return store.valuations.filter((v) => v.business_id === businessId && v.period === period).sort((a, b) => b.entered_at.localeCompare(a.entered_at)).map(named)
    },
    async finValuationSave(x) {
      if (!d.canKeep(x.business_id)) throw new Error('fin_upload_denied')
      if (!PERIOD.test(x.period)) throw new Error('fin_upload_period')
      if (!['entering', 'provisional'].includes(x.status)) throw new Error('fin_valuation_status')
      if (x.upload_id && !store.uploads.some((u) => u.upload_id === x.upload_id && u.business_id === x.business_id)) throw new Error('fin_valuation_upload')
      const state = stateOf(x.state, x.amount)
      await closedGate(x.business_id, x.period, x.reason)
      const old = store.valuations.find((v) => v.business_id === x.business_id && v.period === x.period && v.category === x.category && !v.voided_at)
      if (old?.status === 'final' && !reasonOk(x.reason)) throw new Error('fin_valuation_reason')
      const now = new Date().toISOString()
      if (old) Object.assign(old, { voided_at: now, void_reason: x.reason?.trim() || '새 값으로 바꿈' })
      const id = crypto.randomUUID()
      store.valuations.push({
        valuation_id: id, business_id: x.business_id, period: x.period, category: x.category, amount: x.amount, value_state: state, valuation_date: x.valuation_date,
        method: x.method?.trim() || null, cost_scope: x.cost_scope, source: x.source ?? 'manual', source_upload_id: x.upload_id, source_ref: x.source_ref, note: x.note?.trim() || null,
        status: x.status, entered_by: d.viewer().user_id, entered_at: now, confirmed_by: null, confirmed_at: null, voided_at: null, void_reason: null,
      })
      await reclose(x.business_id, x.period, null, 'valuation', x.reason)
      return id
    },
    async finValuationConfirm(id, reason) {
      const v = store.valuations.find((x) => x.valuation_id === id)
      if (!v || !d.canKeep(v.business_id)) throw new Error('fin_upload_denied')
      if (v.voided_at || v.status === 'final') return false
      if (v.entered_by === d.viewer().user_id) throw new Error('fin_valuation_self_confirm')
      if (v.value_state === 'missing') throw new Error('fin_valuation_missing')
      await closedGate(v.business_id, v.period, reason)
      Object.assign(v, { status: 'final', confirmed_by: d.viewer().user_id, confirmed_at: new Date().toISOString() })
      await reclose(v.business_id, v.period, null, 'valuation', reason)
      return true
    },
    async finValuationVoid(id, reason) {
      const v = store.valuations.find((x) => x.valuation_id === id)
      if (!v || !d.canKeep(v.business_id)) throw new Error('fin_upload_denied')
      if (!reasonOk(reason)) throw new Error('fin_valuation_reason')
      if (v.voided_at) return false
      await closedGate(v.business_id, v.period, reason)
      Object.assign(v, { voided_at: new Date().toISOString(), void_reason: reason.trim().slice(0, 500) })
      await reclose(v.business_id, v.period, null, 'valuation', reason)
      return true
    },
    async finValuationWarnings(businessId, period) {
      ensureDemo()
      if (!d.canRead(businessId)) return []
      const liveV = (p: string, c: string) => store.valuations.find((v) => v.business_id === businessId && v.period === p && v.category === c && !v.voided_at)
      const out: FinValuationWarning[] = []
      for (const c of ['wip', 'finished'] as const) {
        const cur = liveV(period, c)
        const prev = liveV(prevPeriod(period), c)
        if (cur && prev && prev.status === 'final' && cur.cost_scope !== prev.cost_scope) {
          out.push({ kind: 'scope_mismatch', category: c, message: '기초 · 기말 포함 범위가 다름', detail: { closing_scope: cur.cost_scope, opening_scope: prev.cost_scope, prev_period: prev.period } })
        }
      }
      const w = liveV(period, 'wip')
      const f = liveV(period, 'finished')
      if (w && f && w.amount !== null && w.amount === f.amount && ((w.source_upload_id && w.source_upload_id === f.source_upload_id) || (w.source_ref && w.source_ref === f.source_ref))) {
        out.push({ kind: 'wip_finished_duplicate', category: 'wip,finished', message: '재공품 · 완제품 중복 의심', detail: { amount: w.amount, upload_id: w.source_upload_id, source_ref: w.source_ref } })
      }
      return out
    },
    async finInventoryRoll(businessId, period) {
      ensureDemo()
      if (!d.canRead(businessId) || !PERIOD.test(period)) return []
      const prev = prevPeriod(period)
      const out: FinInventoryRollRow[] = []
      for (const c of ['raw', 'wip', 'finished'] as const) {
        let pa: number | null = null
        let ps: ValueState | null = null
        let ca: number | null = null
        let cs: ValueState = 'missing'
        let cst: FinInventoryRollRow['closing_status'] = null
        let miss = 0
        let st: number | null = null
        let pmiss = 0
        let oid: string | null = null
        let ocf: boolean | null = null
        if (c === 'raw') {
          const inv = (p: string) => store.lines.filter((l) => l.kind === 'inventory' && l.business_id === businessId && l.period === p && !l.voided_at)
          const known = (ls: Line[]) => ls.filter((l) => l.row.amount_state !== 'missing')
          const pk = known(inv(prev))
          pmiss = inv(prev).length - pk.length
          if (pk.length) {
            pa = pk.reduce((a, l) => a + Number(l.row.amount), 0)
            ps = pa === 0 ? 'confirmed_zero' : 'value'
          }
          const cur = inv(period)
          const ck = known(cur)
          miss = cur.length - ck.length
          if (ck.length) {
            ca = ck.reduce((a, l) => a + Number(l.row.amount), 0)
            cs = ca === 0 ? 'confirmed_zero' : 'value'
          }
          const so = cur.filter((l) => l.row.opening_state !== 'missing' && l.row.opening_state !== undefined && l.row.opening_amount !== null && l.row.opening_amount !== undefined)
          st = so.length ? so.reduce((a, l) => a + Number(l.row.opening_amount), 0) : null
        } else {
          const p = store.valuations.find((v) => v.business_id === businessId && v.period === prev && v.category === c && !v.voided_at && v.status === 'final')
          if (p && p.value_state !== 'missing') {
            pa = p.amount
            ps = p.value_state
          }
          const cur = store.valuations.find((v) => v.business_id === businessId && v.period === period && v.category === c && !v.voided_at)
          if (cur) {
            ca = cur.amount
            cs = cur.value_state
            cst = cur.status
          }
        }
        let oa: number | null
        let os: FinInventoryRollRow['opening_state']
        let osrc: FinInventoryRollRow['opening_source']
        if (ps) {
          oa = pa
          // 0076 거울: 앞 달 빈칸 줄이 섞이면 «일부 미입력».
          os = pmiss > 0 ? 'partial' : ps
          osrc = 'prev_close'
        } else {
          const o = store.openings.find((x) => x.business_id === businessId && x.period === period && x.category === c && !x.voided_at)
          if (o) {
            oa = o.amount
            os = o.value_state
            osrc = o.source
            oid = o.opening_id
            ocf = !!o.confirmed_at
          } else {
            oa = null
            os = 'missing'
            osrc = 'unlinked'
          }
        }
        out.push({ category: c, opening_amount: oa, opening_state: os, opening_source: osrc, closing_amount: ca, closing_state: cs, closing_status: cst, missing_lines: miss, statement_opening: st, diff_vs_prev_close: st !== null && ps !== null && pa !== null ? st - pa : null, opening_id: oid, opening_confirmed: ocf, prev_missing_lines: osrc === 'prev_close' ? pmiss : 0 })
      }
      return out
    },
    async finOpeningSave(x) {
      if (!d.canKeep(x.business_id)) throw new Error('fin_upload_denied')
      if (!PERIOD.test(x.period)) throw new Error('fin_upload_period')
      if (!['manual', 'statement'].includes(x.source) || !reasonOk(x.note)) throw new Error('fin_opening_reason')
      const state = stateOf(x.state, x.amount)
      await closedGate(x.business_id, x.period, x.note)
      for (const o of store.openings) if (o.business_id === x.business_id && o.period === x.period && o.category === x.category && !o.voided_at) Object.assign(o, { voided_at: new Date().toISOString(), void_reason: '새 값으로 바꿈' })
      const id = crypto.randomUUID()
      store.openings.push({ opening_id: id, business_id: x.business_id, period: x.period, category: x.category, amount: x.amount, value_state: state, source: x.source, source_upload_id: x.upload_id, note: x.note.trim().slice(0, 500), entered_by: d.viewer().user_id, voided_at: null, void_reason: null })
      await reclose(x.business_id, x.period, null, 'opening', x.note)
      return id
    },
    // 0076 거울 — 첫 달 기초 확인(입력자 ≠ 확인자 · 미입력 거부 · 마감 달은 대표 · CFO + 이유).
    async finOpeningConfirm(id, reason) {
      const o = store.openings.find((x) => x.opening_id === id)
      if (!o || !d.canKeep(o.business_id)) throw new Error('fin_upload_denied')
      if (o.voided_at || o.confirmed_at) return false
      if (o.entered_by === d.viewer().user_id) throw new Error('fin_opening_self_confirm')
      if (o.value_state === 'missing') throw new Error('fin_opening_missing')
      await closedGate(o.business_id, o.period, reason)
      Object.assign(o, { confirmed_by: d.viewer().user_id, confirmed_at: new Date().toISOString() })
      await reclose(o.business_id, o.period, null, 'opening', reason ?? '첫 달 기초 확인')
      return true
    },
    async finIssueSummary(businessId, period) {
      ensureDemo()
      if (!d.canRead(businessId)) return null
      const all = store.lines.filter((l) => l.kind === 'material_issue' && l.business_id === businessId && l.period === period && !l.voided_at)
      const prod = all.filter((l) => l.row.class === 'production')
      const known = prod.filter((l) => l.row.qty_state !== 'missing')
      const open = all.filter((l) => l.row.class === 'needs_review')
      const mats = new Set(prod.map((l) => l.row.material)).size
      const why: FinIssueSummary['input_withheld'] = open.length > 0 ? 'needs_review_open' : mats < 3 ? 'too_few_materials' : null
      const sum = known.length ? known.reduce((a, l) => a + Number(l.row.qty_kg), 0) : null
      const pq = store.lines.filter((l) => l.kind === 'production' && l.business_id === businessId && l.period === period && !l.voided_at)
      const need = new Map<string, number>()
      for (const l of open) need.set(String(l.row.material), (need.get(String(l.row.material)) ?? 0) + 1)
      return {
        production_input_kg: why === null && sum !== null ? Math.round(sum / 100) * 100 : null,
        input_withheld: why,
        input_missing_lines: prod.length - known.length,
        production_qty_kg: pq.length ? pq.reduce((a, l) => a + Number(l.row.qty ?? 0), 0) : null,
        lines: { production: prod.length, non_production: all.filter((l) => l.row.class === 'non_production').length, needs_review: open.length },
        needs_review: [...need.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([material, lines]) => ({ material, lines })),
      }
    },
    async finIssueBulkDecide(x) {
      if (!d.canKeep(x.business_id)) throw new Error('fin_upload_denied')
      if (!reasonOk(x.reason)) throw new Error('fin_issue_reason')
      if (!['production', 'non_production'].includes(x.class) || (x.class === 'production' && x.non_production_kind) || !x.material || !x.period) throw new Error('fin_issue_class')
      await closedGate(x.business_id, x.period, x.reason)
      let n = 0
      for (const l of store.lines) {
        if (l.kind !== 'material_issue' || l.business_id !== x.business_id || l.period !== x.period || l.voided_at || l.row.material !== x.material || l.row.class !== 'needs_review') continue
        Object.assign(l.row, { class: x.class, non_production_kind: x.non_production_kind, class_source: 'bulk', class_reason: x.reason.trim().slice(0, 200) })
        n += 1
      }
      if (n > 0) await reclose(x.business_id, x.period, null, 'upload', x.reason)
      return n
    },
    async listFinTxLines(businessId, period) {
      ensureDemo()
      if (!d.canRead(businessId)) return []
      const grouped = new Map(store.members.filter((m) => !m.released_at && m.business_id === businessId).map((m) => [`${m.source_table}:${m.line_id}`, m.group_id]))
      const out: FinTxLine[] = []
      for (const l of store.lines) {
        if (l.business_id !== businessId || l.period !== period || l.voided_at || l.people || !TABLE_OF[l.kind]) continue
        const r = l.row
        const ref = `${TABLE_OF[l.kind]}:${l.line_id}`
        const base = { ref, upload_id: l.upload_id, row_no: r.row_no, group_id: grouped.get(ref) ?? null }
        if (l.kind === 'sales' || l.kind === 'purchase_in') {
          const amount = numOrNull(r.amount)
          const vat = numOrNull(r.amount_vat)
          out.push({ ...base, source: (r.source_system as FinTxLine['source']) ?? 'other', direction: l.kind === 'sales' ? 'sales' : 'purchase', date: (r.tx_date as string) ?? null, counterparty: ((r.counterparty ?? (l.kind === 'sales' ? r.customer : r.supplier)) as string) ?? null, item: ((r.item_or_account ?? (l.kind === 'sales' ? r.product : r.material)) as string) ?? null, account: null, amount, vat, total: amount !== null && vat !== null ? amount + vat : null, qty: numOrNull(r.qty) })
        } else if (l.kind === 'tax_invoice') {
          out.push({ ...base, source: 'tax_invoice', direction: r.direction === 'sales' ? 'sales' : 'purchase', date: (r.issued_on as string) ?? null, counterparty: (r.counterparty as string) ?? null, item: (r.item as string) ?? null, account: null, amount: numOrNull(r.supply_amount), vat: numOrNull(r.vat), total: numOrNull(r.total), qty: null })
        } else {
          const dr = numOrNull(r.debit)
          const cr = numOrNull(r.credit)
          if ((dr !== null && dr !== 0) === (cr !== null && cr !== 0)) continue
          out.push({ ...base, source: 'ledger', direction: dr ? 'purchase' : 'sales', date: (r.tx_date as string) ?? null, counterparty: (r.counterparty as string) ?? null, item: null, account: (r.account_name as string) ?? null, amount: dr || cr, vat: null, total: null, qty: null })
        }
      }
      return out
    },
    async listFinTxGroups(businessId, period) {
      ensureDemo()
      if (!d.canRead(businessId)) return []
      return store.groups
        .filter((x) => x.business_id === businessId && x.period === period)
        .map(({ saved_by: _s, decided_by: _d, ...x }) => (void _s, void _d, {
          ...x,
          members: store.members.filter((m) => m.group_id === x.group_id).map((m) => ({ source_table: m.source_table, line_id: m.line_id, released: !!m.released_at })),
        }))
    },
    async finTxGroupSave(x) {
      if (!d.canKeep(x.business_id)) throw new Error('fin_upload_denied')
      if (!['same', 'suspect'].includes(x.status)) throw new Error('fin_tx_status')
      if (x.status === 'same' && (!x.evidence || !Object.keys(x.evidence).length)) throw new Error('fin_tx_evidence')
      if (x.members.length < 2 || x.members.length > 50) throw new Error('fin_tx_members')
      await closedGate(x.business_id, x.period, x.reason)
      for (const m of x.members) {
        if (!liveLine(m.source_table, m.line_id, x.business_id, x.period)) throw new Error('fin_tx_members')
        if (store.members.some((o) => o.source_table === m.source_table && o.line_id === m.line_id && !o.released_at)) throw new Error('fin_tx_member_taken')
      }
      const refs = x.members.map((m) => `${m.source_table}:${m.line_id}`)
      if ((x.amount_base_ref && !refs.includes(x.amount_base_ref)) || (x.qty_base_ref && !refs.includes(x.qty_base_ref))) throw new Error('fin_tx_base_ref')
      const id = crypto.randomUUID()
      store.groups.push({ group_id: id, business_id: x.business_id, period: x.period, status: x.status, evidence: x.evidence, amount_base_ref: x.amount_base_ref, qty_base_ref: x.qty_base_ref, saved_at: new Date().toISOString(), decided_at: null, reason: null, saved_by: d.viewer().user_id, decided_by: null })
      for (const m of x.members) store.members.push({ group_id: id, source_table: m.source_table, line_id: m.line_id, business_id: x.business_id, released_at: null })
      await reclose(x.business_id, x.period, null, 'upload', x.reason)
      return id
    },
    async finTxGroupDecide(groupId, status, reason) {
      const grp = store.groups.find((x) => x.group_id === groupId)
      if (!grp || !d.canKeep(grp.business_id)) throw new Error('fin_upload_denied')
      if (!['same', 'rejected'].includes(status)) throw new Error('fin_tx_status')
      if (!reasonOk(reason)) throw new Error('fin_tx_reason')
      if (grp.status === 'rejected' || (grp.status === status && grp.decided_by)) return false
      await closedGate(grp.business_id, grp.period, reason)
      Object.assign(grp, { status, decided_by: d.viewer().user_id, decided_at: new Date().toISOString(), reason: reason.trim().slice(0, 500) })
      if (status === 'rejected') for (const m of store.members) if (m.group_id === groupId && !m.released_at) m.released_at = new Date().toISOString()
      await reclose(grp.business_id, grp.period, null, 'upload', reason)
      return true
    },
    async finDedupeSetting(businessId) {
      return { ...(store.dedupe.get(businessId) ?? { amount_base: 'ledger', qty_base: 'r2_ecount' }) }
    },
    async finDedupeSettingSave(businessId, setting, reason) {
      if (!d.canKeep(businessId)) throw new Error('fin_upload_denied')
      if (!reasonOk(reason)) throw new Error('fin_tx_reason')
      if (!['ledger', 'tax_invoice', 'r2_ecount'].includes(setting.amount_base) || !['r2_ecount', 'ledger'].includes(setting.qty_base)) throw new Error('fin_tx_status')
      store.dedupe.set(businessId, { amount_base: setting.amount_base, qty_base: setting.qty_base })
    },
    async listFinRecloseFlags(businessId) {
      ensureDemo()
      if (!d.canRead(businessId)) return []
      return store.flags.filter((f) => f.business_id === businessId && !f.cleared_at).map(({ cleared_at: _c, ...f }) => (void _c, { ...f }))
    },
    async finRecloseClear(flagId, note) {
      const f = store.flags.find((x) => x.flag_id === flagId)
      if (!f || !d.canClose(f.business_id)) throw new Error('fin_upload_denied')
      if (f.cleared_at) return false
      f.cleared_at = new Date().toISOString()
      void note
      return true
    },
  }
}

/* ───────────────────────── 화면 확인용 예시(가짜 값) ───────────────────────── */

/** dummy 화면 확인용 — biz_dy · 2026-08 · 2026-09에 가짜 회사 값으로 한 번. 진짜 회사 파일 · 진짜 구성표가 아니다. */
export const FIN_DEMO = { business: 'biz_dy', period: '2026-09', prev: '2026-08' } as const

function ensureDemo() {
  if (store.demo) return
  store.demo = true
  const { business: B, period: D, prev: P } = FIN_DEMO
  const staff = DUMMY_UID.supportLead
  const ceo = DUMMY_UID.dyCeo
  const t = (day: string) => `${day}T01:00:00.000Z`
  const up = (kind: string, period: string, file: string, status: FinUpload['status'], rows: number, pending: FinUploadPending | null = null) => {
    const id = crypto.randomUUID()
    store.uploads.push({
      upload_id: id, business_id: B, kind, period, file_name: file, file_sha256: `demo-${kind}-${period}-${status}`, sheet_name: null, ai_confidence: 'high', ai_used: 0,
      auto: false, status, row_count: rows, overlap: 'none', reason: null, error: null, created_by: staff, created_at: t(`${period}-28`), applied_at: status === 'applied' ? t(`${period}-28`) : null,
      reverted_at: null, replaced_by: null, pending,
    })
    return id
  }
  const line = (upload: string, kind: string, period: string, row: FinRow) => {
    const id = (store.seq += 1)
    store.lines.push({ line_id: id, upload_id: upload, business_id: B, period, kind, people: false, row, voided_at: null })
    return id
  }
  // 원재료 — 앞 달 명세서 기말 2,000,000 · 이 달 명세서 기초 1,950,000(차이 −50,000) · 이 달 기말 한 줄 빈칸.
  const invP = up('inventory', P, '가짜 재고금액명세서 8월.xlsx', 'applied', 2)
  line(invP, 'inventory', P, { row_no: 4, item: '가짜 원재료 A', stock_qty: 120, amount: 1_200_000, amount_state: 'value', opening_amount: null, opening_state: 'missing' })
  line(invP, 'inventory', P, { row_no: 5, item: '가짜 원재료 B', stock_qty: 80, amount: 800_000, amount_state: 'value', opening_amount: null, opening_state: 'missing' })
  const invD = up('inventory', D, '가짜 재고금액명세서 9월.xlsx', 'applied', 2)
  line(invD, 'inventory', D, { row_no: 4, item: '가짜 원재료 A', stock_qty: 110, amount: 1_100_000, amount_state: 'value', opening_amount: 1_200_000, opening_state: 'value' })
  line(invD, 'inventory', D, { row_no: 5, item: '가짜 원재료 B', stock_qty: null, amount: null, amount_state: 'missing', opening_amount: 750_000, opening_state: 'value' })
  // 재공품 — 앞 달 확정(재료비만) · 이 달 잠정(재료비+노무비+경비) → «포함 범위가 다름». 완제품 — 앞 달 없음 · 첫 달 입력 없음 → «미연결».
  const v = (period: string, category: 'wip' | 'finished', amount: number | null, scope: 'material_only' | 'material_labor_overhead', status: Valuation['status'], confirmedBy: string | null) =>
    store.valuations.push({
      valuation_id: crypto.randomUUID(), business_id: B, period, category, amount, value_state: amount === null ? 'missing' : amount === 0 ? 'confirmed_zero' : 'value',
      valuation_date: `${period}-30`.replace('-02-30', '-02-28'), method: '월 가중평균', cost_scope: scope, source: 'manual', source_upload_id: null, source_ref: null,
      note: '가짜 예시 값', status, entered_by: staff, entered_at: t(`${period}-29`), confirmed_by: confirmedBy, confirmed_at: confirmedBy ? t(`${period}-30`) : null, voided_at: null, void_reason: null,
    })
  v(P, 'wip', 3_000_000, 'material_only', 'final', ceo)
  v(D, 'wip', 3_400_000, 'material_labor_overhead', 'provisional', null)
  v(D, 'finished', 5_000_000, 'material_labor_overhead', 'entering', null)
  // 원료 출고 — 확인 필요 줄이 남아 합계는 보류(needs_review_open). kg 값은 화면 어디에도 나가지 않는다.
  const iss = up('material_issue', D, '가짜 원료 출고명세 9월.xlsx', 'applied', 6)
  const issue = (row_no: number, material: string, kg: number, cls: string, kind: string | null, reason: string | null, memo: string) =>
    line(iss, 'material_issue', D, { row_no, issued_on: `${D}-1${row_no % 9}`, material, qty_kg: kg, qty_state: 'value', issue_type: null, memo, warehouse: null, class: cls, non_production_kind: kind, class_source: cls === 'needs_review' ? 'none' : 'rule', class_reason: reason })
  issue(3, '가짜 원료 가', 410, 'production', null, '규칙: 적요 «생산투입» → 생산 투입', '생산투입')
  issue(4, '가짜 원료 나', 120, 'needs_review', null, null, '')
  issue(5, '가짜 원료 나', 60, 'needs_review', null, null, '기타')
  issue(6, '가짜 원료 다', 15, 'non_production', 'sample', '규칙: 적요 «샘플» → 비생산(샘플)', '샘플 출고')
  issue(7, '가짜 원료 라', 230, 'needs_review', null, null, '')
  const prod = up('production', D, '가짜 제조지시명세서 9월.xlsx', 'applied', 1)
  line(prod, 'production', D, { row_no: 4, product: '가짜 제품 1', qty: 1200 })
  // 같은 거래 — R2 입고 + 원장 같은 매입 = same 묶음 하나 · 금액만 맞는 원장 줄 = suspect 묶음 하나.
  const led = up('ledger_lines', D, '가짜 전표내역 9월.xlsx', 'applied', 3)
  const l1 = line(led, 'ledger_lines', D, { row_no: 4, tx_date: `${D}-05`, account_code: '1530', account_name: '원재료', counterparty: '가짜 공급처 갑', memo: '가짜 원재료 매입', debit: 500_000, credit: null })
  line(led, 'ledger_lines', D, { row_no: 5, tx_date: `${D}-12`, account_code: '1530', account_name: '원재료', counterparty: null, memo: '가짜 매입', debit: 300_000, credit: null })
  const l3 = line(led, 'ledger_lines', D, { row_no: 6, tx_date: `${D}-21`, account_code: '1530', account_name: '원재료', counterparty: null, memo: '가짜 매입', debit: 120_000, credit: null })
  const pur = up('purchase_in', D, '가짜 R2 입고명세서 9월.xlsx', 'applied', 2)
  const p1 = line(pur, 'purchase_in', D, { row_no: 4, material: '가짜 원재료 A', supplier: '가짜 공급처 갑', material_kind: '원재료', qty: 100, amount: 500_000, tx_date: `${D}-05`, counterparty: '가짜 공급처 갑', source_system: 'r2', amount_vat: 50_000, vat_state: 'value', item_or_account: '가짜 원재료 A' })
  const p2 = line(pur, 'purchase_in', D, { row_no: 5, material: '가짜 원재료 C', supplier: '가짜 공급처 병', material_kind: '원재료', qty: 40, amount: 120_000, tx_date: `${D}-20`, counterparty: '가짜 공급처 병', source_system: 'r2', amount_vat: null, vat_state: 'missing', item_or_account: '가짜 원재료 C' })
  const grp = (status: 'same' | 'suspect', a: [TxSourceTable, number], b: [TxSourceTable, number], evidence: Record<string, string>) => {
    const id = crypto.randomUUID()
    store.groups.push({ group_id: id, business_id: B, period: D, status, evidence, amount_base_ref: `${b[0]}:${b[1]}`, qty_base_ref: status === 'same' ? `${a[0]}:${a[1]}` : null, saved_at: t(`${D}-28`), decided_at: null, reason: null, saved_by: staff, decided_by: null })
    for (const [table, lineId] of [a, b]) store.members.push({ group_id: id, source_table: table, line_id: lineId, business_id: B, released_at: null })
  }
  grp('same', ['fin_purchase_in_lines', p1], ['fin_ledger_lines', l1], { amount: '금액(세전) 같음', counterparty: '거래처 같음', date: '날짜 같음' })
  grp('suspect', ['fin_purchase_in_lines', p2], ['fin_ledger_lines', l3], { amount: '금액(세전) 같음', date: '날짜 1일 차이' })
  // 미리보기 대기 — 세금계산서 한 줄이 원장 줄(거래처 없음)과 금액만 맞음 → 중복 의심 → 자동 아님.
  up('tax_invoice', D, '가짜 매입 세금계산서 9월.xlsx', 'needs_review', 1, {
    rows: [{ row_no: 4, issued_on: `${D}-12`, counterparty: '가짜 공급처 을', item: '가짜 원재료 B', supply_amount: 300_000, supply_state: 'value', vat: 30_000, vat_state: 'value', total: 330_000, direction: 'purchase' }],
    meta: {
      reason: '시트명 · 제목에 «세금계산서» · 칸 6개(7개 중)',
      period_how: '날짜 칸에서 가장 많은 달(1개 달 중)',
      errors: [],
      warnings: [],
      why_not_auto: ['자료 간 중복 의심 1건 — 다른 자료(판매 · 입고 · 세금계산서 · 원장)에 같은 거래로 보이는 줄이 있습니다.'],
      columns: { issued_on: 0, counterparty: 1, item: 2, supply_amount: 3, vat: 4, total: 5 },
      header_row: 2,
      header: ['작성일자', '상호', '품목명', '공급가액', '세액', '합계금액'],
      dup_suspects: 1,
      dup_notes: ['4행 — 금액(세전) 같음 · 날짜 같음'],
    },
  })
  // 재마감 대상(예시) — 앞 달 평가금액 확정이 마감 뒤에 들어온 경우의 표시.
  store.flags.push({ flag_id: crypto.randomUUID(), business_id: B, period: P, upload_id: null, cause: 'valuation', reason: '가짜 예시 — 마감 뒤 재공품 평가 확정', created_at: t(`${P}-30`), cleared_at: null })
}
