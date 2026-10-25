import type { SupabaseClient } from '@supabase/supabase-js'

import {
  CHANGE_COLS,
  DISCLOSURE_COLS,
  POSITION_COLS,
  SECURITY_COLS,
  pageAll,
  toChange,
  toDisclosure,
  toPosition,
} from '@/lib/investment/collect/sink-supabase'
import type { InvestmentMethods } from '@/lib/investment/store'
import type { ChangeStatus, InvRun, InvSecurity, InvSettings } from '@/lib/investment/types'

/**
 * 0094 Investment Intelligence의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다. 사람 세션(쿠키) 그대로 — service_role 없음.
 * 판정은 RLS(inv_reader · inv_admin)가 한다. 직원 세션이면 전부 0행이다. 0094가 없는 DB면 'investment_unavailable'.
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type Err = { code?: string; message: string } | null

function check(what: string, error: Err) {
  if (!error) return
  if (MISSING.has(error.code ?? '')) throw new Error('investment_unavailable')
  if (error.code === '42501') throw new Error('investment_denied')
  throw new Error(`Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export function investmentMethods(sb: SupabaseClient): InvestmentMethods {
  const self: InvestmentMethods = {
    async invManagers() {
      const { data, error } = await sb.from('investment_managers').select('*').order('sort_order')
      check('investment_managers', error)
      return (data ?? []).map((r) => ({ ...r, signal_weight: Number(r.signal_weight) }))
    },
    async invSources() {
      const { data, error } = await sb.from('investment_sources').select('*').order('source_id')
      check('investment_sources', error)
      return data ?? []
    },
    async invSettings(): Promise<InvSettings> {
      const { data, error } = await sb.from('investment_settings').select('*').eq('id', 1).maybeSingle()
      check('investment_settings', error)
      if (!data) throw new Error('investment_denied')
      return {
        collect_daily_limit: Number(data.collect_daily_limit),
        data_quality_min: Number(data.data_quality_min),
        monthly_budget_krw: Number(data.monthly_budget_krw),
        alloc_equity_pct: Number(data.alloc_equity_pct),
        alloc_bond_pct: Number(data.alloc_bond_pct),
        alloc_cash_pct: Number(data.alloc_cash_pct),
        updated_at: String(data.updated_at),
      }
    },
    async invRuns(limit) {
      const { data, error } = await sb.from('investment_collect_runs').select('*').order('started_at', { ascending: false }).limit(limit)
      check('investment_collect_runs', error)
      return (data ?? []) as InvRun[]
    },
    async invDisclosures() {
      const rows = await pageAll<Record<string, unknown>>(
        (a, b) => sb.from('investment_disclosures').select(DISCLOSURE_COLS).order('data_as_of').order('disclosure_id').range(a, b),
        'investment_disclosures',
      ).catch((e: Error) => {
        if (/PGRST205|42P01/.test(e.message)) throw new Error('investment_unavailable')
        throw e
      })
      return rows.map(toDisclosure)
    },
    async invChanges(q) {
      const run = (a: number, b: number) => {
        let x = sb.from('investment_position_changes').select(CHANGE_COLS).order('change_id')
        if (q.toDisclosures) x = x.in('to_disclosure', [...q.toDisclosures])
        if (q.securityId) x = x.eq('security_id', q.securityId)
        if (q.statuses) x = x.in('status', [...q.statuses])
        return x.range(a, b)
      }
      if (q.toDisclosures && q.toDisclosures.length === 0) return []
      const rows = q.limit ? ((await run(0, q.limit - 1)).data ?? []) : await pageAll<Record<string, unknown>>(run, 'investment_position_changes')
      return rows.map(toChange)
    },
    async invChangeCounts(toDisclosure) {
      const out: Record<ChangeStatus, number> = { NEW: 0, ADD: 0, TRIM: 0, EXIT: 0, HOLD: 0, UNKNOWN: 0 }
      for (const s of Object.keys(out) as ChangeStatus[]) {
        const { count, error } = await sb.from('investment_position_changes').select('change_id', { count: 'exact', head: true }).eq('to_disclosure', toDisclosure).eq('status', s)
        check('investment_position_changes count', error)
        out[s] = count ?? 0
      }
      return out
    },
    async invPositions(q) {
      if (q.disclosureIds.length === 0) return []
      if (q.limit) {
        const { data, error } = await sb
          .from('investment_positions')
          .select(POSITION_COLS)
          .in('disclosure_id', [...q.disclosureIds])
          .order('value', { ascending: false, nullsFirst: false })
          .limit(q.limit)
        check('investment_positions', error)
        return (data ?? []).map(toPosition)
      }
      const rows = await pageAll<Record<string, unknown>>(
        (a, b) => sb.from('investment_positions').select(POSITION_COLS).in('disclosure_id', [...q.disclosureIds]).order('position_id').range(a, b),
        'investment_positions',
      )
      return rows.map(toPosition)
    },
    async invSecurityPositions(securityId) {
      const { data, error } = await sb.from('investment_positions').select(POSITION_COLS).eq('security_id', securityId).order('position_id')
      check('investment_positions', error)
      return (data ?? []).map(toPosition)
    },
    async invSecurities(opts = {}) {
      const rows = await pageAll<Record<string, unknown>>((a, b) => {
        let x = sb.from('securities').select(SECURITY_COLS).order('name')
        if (opts.watch !== undefined) x = x.eq('watch', opts.watch)
        if (opts.ids) x = x.in('security_id', [...opts.ids])
        return x.range(a, b)
      }, 'securities')
      return rows as unknown as InvSecurity[]
    },
    async invSecurity(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null
      const { data, error } = await sb.from('securities').select(SECURITY_COLS).eq('security_id', id).maybeSingle()
      check('securities', error)
      return (data as unknown as InvSecurity) ?? null
    },
    async invPrices(securityId) {
      const rows = await pageAll<Record<string, unknown>>(
        (a, b) => sb.from('security_prices').select('d, close, adj_close, volume, source, source_url').eq('security_id', securityId).order('d').range(a, b),
        'security_prices',
      )
      return rows.map((r) => ({ ...r, close: Number(r.close), adj_close: num(r.adj_close), volume: num(r.volume) })) as never
    },
    async invActions(securityId) {
      const { data, error } = await sb
        .from('security_corporate_actions')
        .select('action_id, security_id, ex_date, kind, ratio, amount, currency, source, source_url')
        .eq('security_id', securityId)
        .order('ex_date')
      check('security_corporate_actions', error)
      return (data ?? []).map((r) => ({ ...r, ratio: num(r.ratio), amount: num(r.amount) }))
    },
    async invFacts(securityId) {
      const rows = await pageAll<Record<string, unknown>>(
        (a, b) =>
          sb
            .from('company_financials')
            .select('security_id, cik, taxonomy, concept, unit, period_start, period_end, period_key, fy, fp, form, filed, accession, frame, value, source_url')
            .eq('security_id', securityId)
            .order('fact_id')
            .range(a, b),
        'company_financials',
      )
      return rows.map((r) => ({ ...r, value: Number(r.value) })) as never
    },
    async invMetrics(securityId) {
      const { data, error } = await sb
        .from('company_metrics')
        .select('security_id, metric, value, text_value, unit, as_of, source_type, source_url, note')
        .eq('security_id', securityId)
        .order('as_of')
      check('company_metrics', error)
      return (data ?? []).map((r) => ({ ...r, value: num(r.value) }))
    },
    async invEtfHoldings(securityId) {
      const { data, error } = await sb
        .from('etf_holdings')
        .select('security_id, as_of, line_no, holding_name, holding_ticker, holding_cusip, weight_pct, shares, source_type, source_url')
        .eq('security_id', securityId)
        .order('as_of', { ascending: false })
        .order('line_no')
        .limit(200)
      check('etf_holdings', error)
      return (data ?? []).map((r) => ({ ...r, weight_pct: num(r.weight_pct), shares: num(r.shares) }))
    },

    async invSaveSettings(patch) {
      const { error } = await sb.from('investment_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1)
      check('investment_settings update', error)
      await self.invAudit('settings.update', 'investment_settings', '1', patch)
    },
    async invManualDisclosure(input) {
      const total = input.rows.reduce((s, r) => s + (r.value ?? 0), 0)
      const { data, error } = await sb
        .from('investment_disclosures')
        .insert({
          manager_id: input.manager_id,
          source_id: input.source_id,
          source_type: input.source_id === 'fundsmith:factsheet' ? 'factsheet' : input.source_id === 'pershing:site' ? 'site' : 'manual',
          doc_key: `manual:${input.data_as_of}:${Date.now().toString(36)}`,
          form: '손 입력',
          data_as_of: input.data_as_of,
          source_published_at: input.source_published_at,
          source_url: input.source_url,
          coverage: input.coverage,
          position_count: input.rows.length,
          total_value: total > 0 ? total : null,
          data_quality: 80,
          status: 'partial',
        })
        .select('disclosure_id')
        .single()
      check('investment_disclosures insert', error)
      const id = String(data!.disclosure_id)
      const { error: e2 } = await sb.from('investment_positions').insert(
        input.rows.map((r, i) => ({
          disclosure_id: id,
          line_no: i + 1,
          holding_key: (r.ticker ?? r.issuer_name).toUpperCase().slice(0, 80),
          issuer_name: r.issuer_name,
          ticker: r.ticker,
          shares: r.shares,
          share_type: r.shares === null ? null : 'SH',
          value: r.value,
          weight_pct: r.weight_pct,
        })),
      )
      check('investment_positions insert', e2)
      await self.invAudit('disclosure.manual', 'investment_disclosures', id, { source_id: input.source_id, as_of: input.data_as_of, rows: input.rows.length, url: input.source_url })
      return id
    },
    async invAddAction(a) {
      const { error } = await sb.from('security_corporate_actions').insert({ ...a, source: 'manual' })
      check('security_corporate_actions insert', error)
      await self.invAudit('action.manual', 'security_corporate_actions', a.security_id, { ...a })
    },
    async invAddMetric(m) {
      const { error } = await sb.from('company_metrics').upsert(m, { onConflict: 'security_id,metric,as_of,source_type' })
      check('company_metrics upsert', error)
      await self.invAudit('metric.manual', 'company_metrics', m.security_id, { ...m })
    },
    async invSetWatch(securityId, watch, reason) {
      const { error } = await sb.from('securities').update({ watch, watch_reason: reason, updated_at: new Date().toISOString() }).eq('security_id', securityId)
      check('securities update', error)
      await self.invAudit('security.watch', 'securities', securityId, { watch, reason })
    },
    async invAudit(action, entity, entityId, detail) {
      const { error } = await sb.from('investment_audit_logs').insert({ action, entity, entity_id: entityId, detail })
      check('investment_audit_logs insert', error)
    },
  }
  return self
}
