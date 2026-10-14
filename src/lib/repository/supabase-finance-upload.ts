import type { SupabaseClient } from '@supabase/supabase-js'

import {
  FIN_UPLOAD_COLUMNS,
  type FinDedupeSetting,
  type FinInventoryRollRow,
  type FinIssueSummary,
  type FinMaterialTotals,
  type FinRecloseFlag,
  type FinTxGroup,
  type FinTxLine,
  type FinUpload,
  type FinUploadPending,
  type FinUploadShape,
  type FinValuation,
  type FinValuationWarning,
  type TxSourceTable,
} from '@/types'

import type { ChairmanRepository } from './types'

/**
 * 0070 «회계 · 재무 자료 올리기»의 live 어댑터 조각(0072 v2.1 차이분 — 평가금액 · 기초재고 · 원료 출고 · 같은 거래 · 재마감 대상 포함). supabase.ts가 펼쳐 넣는다.
 * 0070이 없는 DB를 견딘다(master push = 앱 먼저 나갈 수 있다): 읽기는 빈 목록, 넣기는 'fin_upload_unavailable'.
 * 판정은 전부 DB다(0070 RPC). pending 칸은 열 grant 밖이라 목록은 FIN_UPLOAD_COLUMNS만 고른다.
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type Err = { code?: string; message: string } | null

function fail(what: string, error: NonNullable<Err>): never {
  if (MISSING.has(error.code ?? '')) throw new Error('fin_upload_unavailable')
  // 0072: 새 RPC의 오류 키(fin_valuation_* · fin_opening_* · fin_issue_* · fin_tx_* · fin_value_state)도 그대로 올린다.
  const key = /fin_(?:upload|valuation|opening|issue|tx|value)_[a-z_]+/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
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
  | 'finMaterialTotals'
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

const DEFAULT_DEDUPE: FinDedupeSetting = { amount_base: 'ledger', qty_base: 'r2_ecount' }
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function financeUploadMethods(sb: SupabaseClient): Methods {
  return {
    async listFinUploads(businessId) {
      const { data, error } = await sb.from('fin_uploads').select(FIN_UPLOAD_COLUMNS).eq('business_id', businessId).order('created_at', { ascending: false }).limit(300)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_uploads', error)
      return (data ?? []) as unknown as FinUpload[]
    },
    async finUploadPending(uploadId) {
      const { data, error } = await sb.rpc('fin_upload_pending', { p_upload: uploadId })
      if (error && MISSING.has(error.code ?? '')) return null
      if (error) fail('fin_upload_pending', error)
      return (data ?? null) as FinUploadPending | null
    },
    async finUploadRecord(x) {
      const { data, error } = await sb.rpc('fin_upload_record', {
        p_business: x.business_id,
        p_kind: x.kind,
        p_period: x.period,
        p_file_name: x.file_name,
        p_sha: x.file_sha256,
        p_sheet: x.sheet_name,
        p_confidence: x.ai_confidence,
        p_ai_used: x.ai_used,
        p_status: x.status,
        p_pending: x.pending,
        p_error: x.error,
      })
      if (error) fail('fin_upload_record', error)
      return String(data)
    },
    async finUploadApply(x) {
      const args = {
        p_business: x.business_id,
        p_kind: x.kind,
        p_period: x.period,
        p_file_name: x.file_name,
        p_sha: x.file_sha256,
        p_sheet: x.sheet_name,
        p_confidence: x.ai_confidence,
        p_ai_used: x.ai_used,
        p_auto: x.auto,
        p_rows: x.rows,
        p_people: x.people,
        p_overlap: x.overlap,
        p_reason: x.reason,
        p_upload: x.upload_id,
      }
      // 0072: 다섯째 조건(p_dup_suspects)을 보낸다. 0072 전 DB(14개 인자 판)면 함수를 못 찾으므로(PGRST202) 옛 인자로 한 번 더 —
      // master 배포가 마이그레이션보다 먼저 가도 올리기가 서게(0070 판은 다섯째 조건이 없다).
      let { data, error } = await sb.rpc('fin_upload_apply', { ...args, p_dup_suspects: x.dup_suspects ?? null })
      if (error && error.code === 'PGRST202') ({ data, error } = await sb.rpc('fin_upload_apply', args))
      if (error) fail('fin_upload_apply', error)
      return String(data)
    },
    async finUploadRevert(uploadId, reason) {
      const { data, error } = await sb.rpc('fin_upload_revert', { p_upload: uploadId, p_reason: reason })
      if (error) fail('fin_upload_revert', error)
      return data === true
    },
    async finUploadCancel(uploadId) {
      const { data, error } = await sb.rpc('fin_upload_cancel', { p_upload: uploadId })
      if (error) fail('fin_upload_cancel', error)
      return data === true
    },
    async finMonthClosed(businessId, period) {
      const { data, error } = await sb.rpc('fin_month_closed', { p_business: businessId, p_period: period })
      if (error && MISSING.has(error.code ?? '')) return false
      if (error) fail('fin_month_closed', error)
      return data === true
    },
    async listFinUploadShapes(businessId) {
      const { data, error } = await sb.from('fin_upload_shapes').select('business_id,header_sig,sheet_name,kind,column_map').eq('business_id', businessId).limit(500)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_upload_shapes', error)
      return (data ?? []) as FinUploadShape[]
    },
    async saveFinUploadShape(s) {
      const { error } = await sb.rpc('fin_upload_shape_save', { p_business: s.business_id, p_sig: s.header_sig, p_sheet: s.sheet_name, p_kind: s.kind, p_map: s.column_map })
      if (error) fail('fin_upload_shape_save', error)
    },

    /* ───── 0072 ───── */
    async finRowBusiness(kind, id) {
      const [table, col] = kind === 'valuation' ? ['fin_inventory_valuations', 'valuation_id'] : kind === 'tx_group' ? ['fin_tx_groups', 'group_id'] : kind === 'opening' ? ['fin_inventory_openings', 'opening_id'] : ['fin_reclose_flags', 'flag_id']
      const { data, error } = await sb.from(table).select('business_id').eq(col, id).maybeSingle()
      if (error && MISSING.has(error.code ?? '')) return null
      if (error) fail(table, error)
      return (data as { business_id?: string } | null)?.business_id ?? null
    },
    async listFinValuations(businessId, period) {
      const { data, error } = await sb.from('fin_inventory_valuations').select('*').eq('business_id', businessId).eq('period', period).order('entered_at', { ascending: false }).limit(50)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_inventory_valuations', error)
      const rows = (data ?? []) as Record<string, unknown>[]
      const ids = [...new Set(rows.flatMap((r) => [r.entered_by, r.confirmed_by]).filter((v): v is string => typeof v === 'string'))]
      const names = new Map<string, string>()
      if (ids.length) {
        // 이름은 보이는 사람만(user_profiles RLS) — 못 읽으면 이름 없이(화면이 «나» · «다른 사람»으로 그린다).
        const { data: ppl } = await sb.from('user_profiles').select('user_id,display_name').in('user_id', ids)
        for (const p of (ppl ?? []) as { user_id: string; display_name: string }[]) names.set(p.user_id, p.display_name)
      }
      return rows.map((r) => ({
        ...(r as unknown as FinValuation),
        amount: n(r.amount),
        entered_by_name: names.get(String(r.entered_by)) ?? null,
        confirmed_by_name: r.confirmed_by ? (names.get(String(r.confirmed_by)) ?? null) : null,
      }))
    },
    async finValuationSave(x) {
      const { data, error } = await sb.rpc('fin_valuation_save', {
        p_business: x.business_id, p_period: x.period, p_category: x.category, p_amount: x.amount, p_state: x.state, p_valuation_date: x.valuation_date,
        p_method: x.method, p_cost_scope: x.cost_scope, p_source: x.source, p_upload: x.upload_id, p_source_ref: x.source_ref, p_note: x.note,
        p_status: x.status, p_reason: x.reason,
      })
      if (error) fail('fin_valuation_save', error)
      return String(data)
    },
    async finValuationConfirm(id, reason) {
      const { data, error } = await sb.rpc('fin_valuation_confirm', { p_id: id, p_reason: reason })
      if (error) fail('fin_valuation_confirm', error)
      return data === true
    },
    async finValuationVoid(id, reason) {
      const { data, error } = await sb.rpc('fin_valuation_void', { p_id: id, p_reason: reason })
      if (error) fail('fin_valuation_void', error)
      return data === true
    },
    async finValuationWarnings(businessId, period) {
      const { data, error } = await sb.rpc('fin_valuation_warnings', { p_business: businessId, p_period: period })
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_valuation_warnings', error)
      return (data ?? []) as FinValuationWarning[]
    },
    async finInventoryRoll(businessId, period) {
      const { data, error } = await sb.rpc('fin_inventory_roll', { p_business: businessId, p_period: period })
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_inventory_roll', error)
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        ...(r as unknown as FinInventoryRollRow),
        opening_amount: n(r.opening_amount),
        closing_amount: n(r.closing_amount),
        statement_opening: n(r.statement_opening),
        diff_vs_prev_close: n(r.diff_vs_prev_close),
        missing_lines: Number(r.missing_lines ?? 0),
        // 0076 전 DB에는 칸이 없다(undefined → null · 0).
        opening_id: r.opening_id ? String(r.opening_id) : null,
        opening_confirmed: typeof r.opening_confirmed === 'boolean' ? r.opening_confirmed : null,
        prev_missing_lines: Number(r.prev_missing_lines ?? 0),
      }))
    },
    async finOpeningSave(x) {
      const { data, error } = await sb.rpc('fin_opening_save', {
        p_business: x.business_id, p_period: x.period, p_category: x.category, p_amount: x.amount, p_state: x.state, p_source: x.source, p_upload: x.upload_id, p_note: x.note,
      })
      if (error) fail('fin_opening_save', error)
      return String(data)
    },
    async finOpeningConfirm(id, reason) {
      const { data, error } = await sb.rpc('fin_opening_confirm', { p_id: id, p_reason: reason })
      if (error) fail('fin_opening_confirm', error)
      return data === true
    },
    async finMaterialTotals(businessId, period) {
      const { data, error } = await sb.rpc('fin_material_totals', { p_business: businessId, p_period: period })
      if (error && MISSING.has(error.code ?? '')) return null
      if (error) fail('fin_material_totals', error)
      if (!data || typeof data !== 'object') return null
      const d = data as Record<string, unknown>
      return {
        purchase_lines: Number(d.purchase_lines ?? 0), purchase_amount: n(d.purchase_amount),
        inventory_lines: Number(d.inventory_lines ?? 0), inventory_closing: n(d.inventory_closing), inventory_opening: n(d.inventory_opening),
        import_lines: Number(d.import_lines ?? 0), import_krw: n(d.import_krw), import_extra: n(d.import_extra),
        withheld: Array.isArray(d.withheld) ? (d.withheld as FinMaterialTotals['withheld']) : [],
      }
    },
    async finIssueSummary(businessId, period) {
      const { data, error } = await sb.rpc('fin_issue_summary', { p_business: businessId, p_period: period })
      if (error && MISSING.has(error.code ?? '')) return null
      if (error) fail('fin_issue_summary', error)
      if (!data) return null
      const d = data as Record<string, unknown>
      return { ...(d as unknown as FinIssueSummary), production_input_kg: n(d.production_input_kg), production_qty_kg: n(d.production_qty_kg), input_missing_lines: Number(d.input_missing_lines ?? 0) }
    },
    async finIssueBulkDecide(x) {
      const { data, error } = await sb.rpc('fin_issue_bulk_decide', {
        p_business: x.business_id, p_period: x.period, p_material: x.material, p_class: x.class, p_non_production_kind: x.non_production_kind, p_reason: x.reason,
      })
      if (error) fail('fin_issue_bulk_decide', error)
      return Number(data ?? 0)
    },
    async listFinTxLines(businessId, period) {
      const take = async (table: TxSourceTable, cols: string) => {
        const { data, error } = await sb.from(table).select(cols).eq('business_id', businessId).eq('period', period).is('voided_at', null).limit(5000)
        if (error && (MISSING.has(error.code ?? '') || error.code === '42703')) return [] as Record<string, unknown>[]
        if (error) fail(table, error)
        return (data ?? []) as unknown as Record<string, unknown>[]
      }
      const [sales, purchase, tax, ledger, members] = await Promise.all([
        take('fin_sales_lines', 'line_id,upload_id,row_no,customer,product,qty,amount,tx_date,counterparty,source_system,amount_vat,item_or_account'),
        // 0080: 입고 줄의 수량 · 금액은 열 grant가 없다 — fin_material_lines(줄마다 문)로 읽는다. 0080 전 DB는 표를 직접.
        (async () => {
          const { data, error } = await sb.rpc('fin_material_lines', { p_business: businessId, p_period: period, p_kind: 'purchase_in' })
          if (error && MISSING.has(error.code ?? '')) {
            return take('fin_purchase_in_lines', 'line_id,upload_id,row_no,material,supplier,qty,amount,tx_date,counterparty,source_system,amount_vat,item_or_account')
          }
          if (error) fail('fin_material_lines', error)
          return (Array.isArray(data) ? data : []) as Record<string, unknown>[]
        })(),
        take('fin_tax_invoice_lines', 'line_id,upload_id,row_no,issued_on,counterparty,item,supply_amount,vat,total,direction'),
        take('fin_ledger_lines', 'line_id,upload_id,row_no,tx_date,account_name,counterparty,debit,credit'),
        sb.from('fin_tx_group_members').select('group_id,source_table,line_id').eq('business_id', businessId).is('released_at', null).limit(10000),
      ])
      const grouped = new Map<string, string>()
      if (!members.error) for (const m of (members.data ?? []) as { group_id: string; source_table: string; line_id: number }[]) grouped.set(`${m.source_table}:${m.line_id}`, m.group_id)
      const out: FinTxLine[] = []
      const src = (v: unknown) => (['r2', 'ecount', 'ledger', 'tax_invoice', 'other'].includes(String(v)) ? (String(v) as FinTxLine['source']) : 'other')
      for (const [table, rows, dir] of [['fin_sales_lines', sales, 'sales'], ['fin_purchase_in_lines', purchase, 'purchase']] as const) {
        for (const r of rows) {
          const amount = n(r.amount)
          const vat = n(r.amount_vat)
          const ref = `${table}:${r.line_id}`
          out.push({
            ref, upload_id: String(r.upload_id), source: src(r.source_system), direction: dir, date: (r.tx_date as string) ?? null,
            counterparty: ((r.counterparty ?? (dir === 'sales' ? r.customer : r.supplier)) as string) ?? null,
            item: ((r.item_or_account ?? (dir === 'sales' ? r.product : r.material)) as string) ?? null, account: null,
            amount, vat, total: amount !== null && vat !== null ? amount + vat : null, qty: n(r.qty), row_no: Number(r.row_no), group_id: grouped.get(ref) ?? null,
            ...(r.hidden === true ? { hidden: true } : {}),
          })
        }
      }
      for (const r of tax) {
        const ref = `fin_tax_invoice_lines:${r.line_id}`
        out.push({ ref, upload_id: String(r.upload_id), source: 'tax_invoice', direction: r.direction === 'sales' ? 'sales' : 'purchase', date: (r.issued_on as string) ?? null, counterparty: (r.counterparty as string) ?? null, item: (r.item as string) ?? null, account: null, amount: n(r.supply_amount), vat: n(r.vat), total: n(r.total), qty: null, row_no: Number(r.row_no), group_id: grouped.get(ref) ?? null })
      }
      for (const r of ledger) {
        const d = n(r.debit)
        const c = n(r.credit)
        if ((d !== null && d !== 0) === (c !== null && c !== 0)) continue
        const ref = `fin_ledger_lines:${r.line_id}`
        out.push({ ref, upload_id: String(r.upload_id), source: 'ledger', direction: d ? 'purchase' : 'sales', date: (r.tx_date as string) ?? null, counterparty: (r.counterparty as string) ?? null, item: null, account: (r.account_name as string) ?? null, amount: d || c, vat: null, total: null, qty: null, row_no: Number(r.row_no), group_id: grouped.get(ref) ?? null })
      }
      return out
    },
    async listFinTxGroups(businessId, period) {
      const { data, error } = await sb.from('fin_tx_groups').select('group_id,business_id,period,status,evidence,amount_base_ref,qty_base_ref,saved_at,decided_at,reason').eq('business_id', businessId).eq('period', period).order('saved_at', { ascending: false }).limit(300)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_tx_groups', error)
      const groups = (data ?? []) as Omit<FinTxGroup, 'members'>[]
      if (!groups.length) return []
      const { data: mem, error: me } = await sb.from('fin_tx_group_members').select('group_id,source_table,line_id,released_at').in('group_id', groups.map((g) => g.group_id))
      if (me) fail('fin_tx_group_members', me)
      return groups.map((g) => ({
        ...g,
        members: ((mem ?? []) as { group_id: string; source_table: TxSourceTable; line_id: number; released_at: string | null }[])
          .filter((m) => m.group_id === g.group_id)
          .map((m) => ({ source_table: m.source_table, line_id: Number(m.line_id), released: !!m.released_at })),
      }))
    },
    async finTxGroupSave(x) {
      const { data, error } = await sb.rpc('fin_tx_group_save', {
        p_business: x.business_id, p_period: x.period, p_status: x.status, p_members: x.members, p_evidence: x.evidence, p_amount_base_ref: x.amount_base_ref, p_qty_base_ref: x.qty_base_ref, p_reason: x.reason,
      })
      if (error) fail('fin_tx_group_save', error)
      return String(data)
    },
    async finTxGroupDecide(groupId, status, reason) {
      const { data, error } = await sb.rpc('fin_tx_group_decide', { p_group: groupId, p_status: status, p_reason: reason })
      if (error) fail('fin_tx_group_decide', error)
      return data === true
    },
    async finDedupeSetting(businessId) {
      const { data, error } = await sb.from('fin_dedupe_settings').select('amount_base,qty_base').eq('business_id', businessId).maybeSingle()
      if (error && MISSING.has(error.code ?? '')) return DEFAULT_DEDUPE
      if (error) fail('fin_dedupe_settings', error)
      return (data as FinDedupeSetting | null) ?? DEFAULT_DEDUPE
    },
    async finDedupeSettingSave(businessId, setting, reason) {
      const { error } = await sb.rpc('fin_dedupe_setting_save', { p_business: businessId, p_amount_base: setting.amount_base, p_qty_base: setting.qty_base, p_reason: reason })
      if (error) fail('fin_dedupe_setting_save', error)
    },
    async listFinRecloseFlags(businessId) {
      const { data, error } = await sb.from('fin_reclose_flags').select('flag_id,business_id,period,upload_id,cause,reason,created_at').eq('business_id', businessId).is('cleared_at', null).order('period', { ascending: false }).limit(200)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_reclose_flags', error)
      return (data ?? []) as FinRecloseFlag[]
    },
    async finRecloseClear(flagId, note) {
      const { data, error } = await sb.rpc('fin_reclose_clear', { p_flag: flagId, p_note: note })
      if (error) fail('fin_reclose_clear', error)
      return data === true
    },
  }
}
