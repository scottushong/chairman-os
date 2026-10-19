import type { SupabaseClient } from '@supabase/supabase-js'

import type { FinOverviewMonthRow, FinPayrollHeld, FinRecalcJob, FinRow, OverviewLineKind } from '@/types'

import type { ChairmanRepository } from './types'

/**
 * 0085 «넣으면 쌓이고 · 알아서 계산하고 · 한 화면에»의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 * 0085가 없는 DB를 견딘다(master push = 앱 먼저 나갈 수 있다): 저장은 0072 넣기로 물러서고(바꾸기를 앱이 고른다),
 * 읽기는 빈 목록 · null, 쓰기는 'fin_upload_unavailable'. 판정은 전부 DB다.
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01', '42703'])
type Err = { code?: string; message: string } | null

function fail(what: string, error: NonNullable<Err>): never {
  if (MISSING.has(error.code ?? '')) throw new Error('fin_upload_unavailable')
  const key = /(?:fin_(?:upload|valuation|opening|issue|tx|value|recalc|overview|payroll|kpi|replace|material)_[a-z_]+|official_[a-z_]+|books_forbidden)/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

type Methods = Pick<
  ChairmanRepository,
  | 'finUploadSave'
  | 'finPayrollHold'
  | 'listFinPayrollHeld'
  | 'finPayrollRelease'
  | 'finRecalcRequest'
  | 'finRecalcClaim'
  | 'finRecalcFinish'
  | 'listFinRecalcJobs'
  | 'finOverviewSave'
  | 'listFinOverviewMonths'
  | 'listFinLines'
  | 'withdrawOfficialStatement'
  | 'finKpiSettings'
  | 'saveFinKpiSettings'
  | 'listAutoAccounts'
  | 'listOfficialStatementLines'
>

/** 재무 현황이 읽는 표와 칸(원료 숫자 표는 없다). 0085 칸은 따로 — 0085 전 DB는 그 칸 없이 다시 읽는다. */
const LINE_TABLE: Record<OverviewLineKind, { table: string; cols: string; v85?: string }> = {
  sales: { table: 'fin_sales_lines', cols: 'row_no,customer,product,qty,unit_price,amount,tx_date,amount_vat' },
  production: { table: 'fin_production_lines', cols: 'row_no,product,qty' },
  ledger: { table: 'fin_ledger_sums', cols: 'row_no,account_code,account_name,debit,credit' },
  payroll: { table: 'fin_payroll_depts', cols: 'row_no,dept,salary,bonus,severance' },
  cashflow: { table: 'fin_cash_flows', cols: 'row_no,flow_date,category,inflow,outflow', v85: 'account,currency,balance,planned' },
  card: { table: 'fin_card_lines', cols: 'row_no,used_on,merchant,dept,amount' },
  overseas: { table: 'fin_overseas_costs', cols: 'row_no,entity,item,currency,amount,fx_rate,amount_krw' },
  promo: { table: 'fin_promo_costs', cols: 'row_no,person,item,currency,amount' },
  loans: { table: 'fin_loans', cols: 'row_no,lender,principal,rate,maturity,terms,principal_paid,interest_paid', v85: 'loan_type,loan_total,pay_day' },
  borrowings: { table: 'fin_borrowings', cols: 'row_no,tx_date,lender,direction,amount,method' },
  savings: { table: 'fin_savings_lines', cols: 'row_no,item,labor_cost,target,actual' },
  shipment: { table: 'fin_shipment_lines', cols: 'row_no,ship_date,customer,product,qty,amount' },
  ledger_lines: { table: 'fin_ledger_lines', cols: 'row_no,tx_date,account_code,account_name,counterparty,memo,debit,credit' },
  tax_invoice: { table: 'fin_tax_invoice_lines', cols: 'row_no,issued_on,counterparty,item,supply_amount,vat,total,direction' },
}

const NUMERIC = /^(qty|unit_price|amount|amount_vat|debit|credit|salary|bonus|severance|inflow|outflow|balance|fx_rate|amount_krw|principal|rate|principal_paid|interest_paid|loan_total|labor_cost|target|actual|supply_amount|vat|total)$/

function toRow(r: Record<string, unknown>): FinRow {
  const out: FinRow = { row_no: Number(r.row_no ?? 0) }
  for (const [k, v] of Object.entries(r)) {
    if (k === 'row_no') continue
    if (k === 'period') {
      out.period = String(v)
      continue
    }
    out[k] = v === null || v === undefined ? null : NUMERIC.test(k) ? Number(v) : typeof v === 'boolean' ? (v ? 1 : 0) : String(v)
  }
  return out
}

export function financeOverviewMethods(sb: SupabaseClient, fallback: Pick<ChairmanRepository, 'finUploadApply' | 'listFinUploads'>): Methods {
  return {
    async finUploadSave(x) {
      const { data, error } = await sb.rpc('fin_upload_save', {
        p_business: x.business_id,
        p_kind: x.kind,
        p_period: x.period,
        p_file_name: x.file_name,
        p_sha: x.file_sha256,
        p_sheet: x.sheet_name,
        p_confidence: x.ai_confidence,
        p_ai_used: x.ai_used,
        p_rows: x.rows,
        p_people: x.people,
        p_reason: x.reason,
        p_upload: x.upload_id,
        p_warnings: x.warnings.slice(0, 40),
      })
      if (error && error.code === 'PGRST202' && x.kind !== 'shipment') {
        // 0085 전 DB — 0072 넣기로(바꾸기는 앱이 살아 있는 올리기를 보고 고른다 · 경고는 남지 않는다).
        const live = (await fallback.listFinUploads(x.business_id)).some((u) => u.kind === x.kind && u.period === x.period && u.status === 'applied' && u.upload_id !== x.upload_id)
        return fallback.finUploadApply({ ...x, auto: false, overlap: live ? 'replace' : 'none', dup_suspects: null })
      }
      if (error) fail('fin_upload_save', error)
      return String(data)
    },
    async finPayrollHold(uploadId, rows) {
      const { data, error } = await sb.rpc('fin_payroll_hold', { p_upload: uploadId, p_rows: rows })
      if (error) fail('fin_payroll_hold', error)
      return String(data)
    },
    async listFinPayrollHeld(businessId) {
      const { data, error } = await sb.rpc('fin_payroll_held_list', { p_business: businessId })
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_payroll_held_list', error)
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        hold_id: String(r.hold_id),
        upload_id: String(r.upload_id),
        period: String(r.period),
        people: Number(r.people ?? 0),
        created_at: String(r.created_at),
        rows: Array.isArray(r.rows) ? (r.rows as Record<string, unknown>[]).map(toRow) : null,
      })) as FinPayrollHeld[]
    },
    async finPayrollRelease(holdId, save) {
      const { data, error } = await sb.rpc('fin_payroll_release', { p_hold: holdId, p_save: save })
      if (error) fail('fin_payroll_release', error)
      return data === true
    },
    async finRecalcRequest(businessId, period) {
      const { error } = await sb.rpc('fin_recalc_request', { p_business: businessId, p_period: period })
      if (error && MISSING.has(error.code ?? '')) return
      if (error) fail('fin_recalc_request', error)
    },
    async finRecalcClaim(businessId, limit) {
      const { data, error } = await sb.rpc('fin_recalc_claim', { p_business: businessId, p_limit: limit })
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_recalc_claim', error)
      return (data ?? []) as FinRecalcJob[]
    },
    async finRecalcFinish(jobId, ok, err) {
      const { error } = await sb.rpc('fin_recalc_finish', { p_job: jobId, p_ok: ok, p_error: err })
      if (error && MISSING.has(error.code ?? '')) return
      if (error) fail('fin_recalc_finish', error)
    },
    async listFinRecalcJobs(businessId) {
      const { data, error } = await sb.from('fin_recalc_jobs').select('*').eq('business_id', businessId).order('requested_at', { ascending: false }).limit(20)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_recalc_jobs', error)
      return (data ?? []) as FinRecalcJob[]
    },
    async finOverviewSave(businessId, period, totals, missing, provisional) {
      const { error } = await sb.rpc('fin_overview_save', { p_business: businessId, p_period: period, p_totals: totals, p_missing: missing, p_provisional: provisional })
      if (error && MISSING.has(error.code ?? '')) return
      if (error) fail('fin_overview_save', error)
    },
    async listFinOverviewMonths(businessId, periods) {
      if (!periods.length) return []
      const { data, error } = await sb.from('fin_overview_months').select('business_id,period,totals,missing,provisional,computed_at').eq('business_id', businessId).in('period', periods)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_overview_months', error)
      return (data ?? []) as FinOverviewMonthRow[]
    },
    async listFinLines(kind, businessId, periods) {
      if (!periods.length) return []
      const spec = LINE_TABLE[kind]
      const read = (cols: string) => sb.from(spec.table).select(`period,${cols}`).eq('business_id', businessId).in('period', periods).is('voided_at', null).order('period').order('row_no').limit(50000)
      let { data, error } = await read(spec.v85 ? `${spec.cols},${spec.v85}` : spec.cols)
      if (error && spec.v85 && error.code === '42703') ({ data, error } = await read(spec.cols))
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail(spec.table, error)
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(toRow)
    },
    async withdrawOfficialStatement(id, reason) {
      const { data, error } = await sb.rpc('official_statement_withdraw', { p_id: id, p_reason: reason })
      if (error) fail('official_statement_withdraw', error)
      return data === null || data === undefined ? null : Number(data)
    },
    async finKpiSettings(businessId) {
      const { data, error } = await sb.from('fin_kpi_settings').select('settings').eq('business_id', businessId).maybeSingle<{ settings: Record<string, unknown> }>()
      if (error && MISSING.has(error.code ?? '')) return null
      if (error) fail('fin_kpi_settings', error)
      return data?.settings ?? null
    },
    async listOfficialStatementLines(businessId, ids) {
      if (!ids.length) return []
      const { data, error } = await sb.from('official_statement_lines').select('statement_id,business_id,account_code,amount').eq('business_id', businessId).in('statement_id', ids)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('official_statement_lines', error)
      return ((data ?? []) as { statement_id: number; business_id: string; account_code: string; amount: number }[]).map((r) => ({ ...r, statement_id: Number(r.statement_id), amount: Number(r.amount) }))
    },
    async listAutoAccounts(businessId) {
      const { data, error } = await sb.from('accounts').select('account_code').eq('business_id', businessId).eq('auto_created', true)
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('accounts', error)
      return ((data ?? []) as { account_code: string }[]).map((r) => r.account_code)
    },
    async saveFinKpiSettings(businessId, settings, reason) {
      const { error } = await sb.rpc('fin_kpi_settings_save', { p_business: businessId, p_settings: settings, p_reason: reason })
      if (error) fail('fin_kpi_settings_save', error)
    },
  }
}
