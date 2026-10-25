import type { SupabaseClient } from '@supabase/supabase-js'

import type { InvChange, InvDisclosure, InvPosition, InvSecurity } from '../types'
import type { CollectorSink } from './sink'

/**
 * 수집 싱크(live) — Integration 계정 세션으로 원천 표에 쓴다. 0094 RLS가 원천 표 insert/update만 열어 둔다
 * (추천 · 승인 · 포트폴리오 · 거래 표는 이 계정에 0행 · 쓰기 거부). service_role 없음.
 * PostgREST는 한 번에 1000줄까지라 읽기는 쪽마다 나눠 읽는다.
 */

type Err = { code?: string; message: string } | null
function check(what: string, error: Err) {
  if (error) throw new Error(`${what}: ${error.code ?? '?'} ${error.message}`)
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: Err }>, what: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999)
    check(what, error)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

export const DISCLOSURE_COLS =
  'disclosure_id, manager_id, source_id, source_type, doc_key, form, data_as_of, source_published_at, source_url, is_amendment, amendment_type, amends_key, coverage, position_count, total_value, currency, data_quality, status, is_demo, ingested_at'
export const POSITION_COLS =
  'position_id, disclosure_id, line_no, holding_key, issuer_name, title_of_class, cusip, isin, ticker, security_id, shares, share_type, put_call, value, value_currency, ownership_pct, weight_pct, country, sector, discretion'
export const CHANGE_COLS =
  'change_id, manager_id, source_id, from_disclosure, to_disclosure, holding_key, security_id, issuer_name, cusip, prev_shares, split_factor, prev_shares_adj, cur_shares, net_change, change_pct, prev_value, cur_value, prev_ownership_pct, cur_ownership_pct, status, basis, note, calculation_version, computed_at'
export const SECURITY_COLS =
  'security_id, kind, name, ticker, exchange, cusip, isin, figi, cik, currency, country, sector, industry, etf_issuer, etf_index, hedged, benchmark_ticker, watch, watch_reason, facts_checked_at, prices_checked_at, source, source_url, data_as_of, is_demo, updated_at'

export const toDisclosure = (r: Record<string, unknown>): InvDisclosure =>
  ({ ...r, position_count: n(r.position_count), total_value: n(r.total_value), data_quality: n(r.data_quality) }) as InvDisclosure
export const toPosition = (r: Record<string, unknown>): InvPosition =>
  ({ ...r, shares: n(r.shares), value: n(r.value), ownership_pct: n(r.ownership_pct), weight_pct: n(r.weight_pct) }) as InvPosition
export const toChange = (r: Record<string, unknown>): InvChange =>
  ({
    ...r,
    prev_shares: n(r.prev_shares),
    split_factor: Number(r.split_factor ?? 1),
    prev_shares_adj: n(r.prev_shares_adj),
    cur_shares: n(r.cur_shares),
    net_change: n(r.net_change),
    change_pct: n(r.change_pct),
    prev_value: n(r.prev_value),
    cur_value: n(r.cur_value),
    prev_ownership_pct: n(r.prev_ownership_pct),
    cur_ownership_pct: n(r.cur_ownership_pct),
  }) as InvChange

export function supabaseSink(sb: SupabaseClient): CollectorSink {
  return {
    async settings() {
      const { data, error } = await sb.from('investment_settings').select('*').eq('id', 1).single()
      check('investment_settings', error)
      const r = data as Record<string, unknown>
      return {
        collect_daily_limit: Number(r.collect_daily_limit),
        data_quality_min: Number(r.data_quality_min),
        monthly_budget_krw: Number(r.monthly_budget_krw),
        alloc_equity_pct: Number(r.alloc_equity_pct),
        alloc_bond_pct: Number(r.alloc_bond_pct),
        alloc_cash_pct: Number(r.alloc_cash_pct),
        updated_at: String(r.updated_at),
      }
    },
    async managers() {
      const { data, error } = await sb.from('investment_managers').select('*').order('sort_order')
      check('investment_managers', error)
      return (data ?? []).map((r) => ({ ...r, signal_weight: Number(r.signal_weight) }))
    },
    async sources() {
      const { data, error } = await sb.from('investment_sources').select('*').order('source_id')
      check('investment_sources', error)
      return data ?? []
    },
    async markSource(id, patch) {
      const { error } = await sb.from('investment_sources').update({ ...patch, updated_at: new Date().toISOString() }).eq('source_id', id)
      check('investment_sources update', error)
    },
    async addCalls(id, add, day) {
      const { data, error } = await sb.from('investment_sources').select('calls_day, calls_today').eq('source_id', id).maybeSingle()
      check('investment_sources calls', error)
      const today = data?.calls_day === day ? Number(data.calls_today) : 0
      const { error: e2 } = await sb.from('investment_sources').update({ calls_day: day, calls_today: today + add }).eq('source_id', id)
      check('investment_sources calls update', e2)
    },
    async startRun(trigger) {
      const { data, error } = await sb.from('investment_collect_runs').insert({ trigger }).select('run_id').single()
      check('investment_collect_runs', error)
      return Number(data!.run_id)
    },
    async finishRun(runId, out) {
      const { error } = await sb
        .from('investment_collect_runs')
        .update({ ok: out.ok, calls: out.calls, steps: out.steps, note: out.note, finished_at: new Date().toISOString() })
        .eq('run_id', runId)
      check('investment_collect_runs update', error)
    },
    async disclosures(sourceId) {
      const rows = await pageAll<Record<string, unknown>>((a, b) => {
        let q = sb.from('investment_disclosures').select(DISCLOSURE_COLS).order('data_as_of').order('disclosure_id')
        if (sourceId) q = q.eq('source_id', sourceId)
        return q.range(a, b)
      }, 'investment_disclosures')
      return rows.map(toDisclosure)
    },
    async insertDisclosure(d, positions) {
      const { data, error } = await sb.from('investment_disclosures').insert(d).select('disclosure_id').single()
      check('investment_disclosures insert', error)
      const id = String(data!.disclosure_id)
      for (let i = 0; i < positions.length; i += 1000) {
        const { error: e2 } = await sb.from('investment_positions').insert(positions.slice(i, i + 1000).map((p) => ({ ...p, disclosure_id: id })))
        check('investment_positions insert', e2)
      }
      return id
    },
    async positions(ids) {
      const out: InvPosition[] = []
      for (const id of ids) {
        const rows = await pageAll<Record<string, unknown>>(
          (a, b) => sb.from('investment_positions').select(POSITION_COLS).eq('disclosure_id', id).order('line_no').range(a, b),
          'investment_positions',
        )
        out.push(...rows.map(toPosition))
      }
      return out
    },
    async changedDisclosures(version) {
      const rows = await pageAll<{ to_disclosure: string }>(
        (a, b) => sb.from('investment_position_changes').select('to_disclosure').eq('calculation_version', version).order('change_id').range(a, b),
        'investment_position_changes',
      )
      return new Set(rows.map((r) => r.to_disclosure))
    },
    async upsertChanges(rows) {
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000).map((r) => {
          const { change_id: _id, computed_at: _at, ...rest } = r
          void _id
          void _at
          return { ...rest, computed_at: new Date().toISOString() }
        })
        const { error } = await sb.from('investment_position_changes').upsert(chunk, { onConflict: 'to_disclosure,holding_key,calculation_version' })
        check('investment_position_changes upsert', error)
      }
    },
    async securities() {
      const rows = await pageAll<Record<string, unknown>>((a, b) => sb.from('securities').select(SECURITY_COLS).order('name').range(a, b), 'securities')
      return rows as unknown as InvSecurity[]
    },
    async insertSecurities(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from('securities').insert(rows.slice(i, i + 500))
        check('securities insert', error)
      }
    },
    async updateSecurity(id, patch) {
      const { error } = await sb.from('securities').update({ ...patch, updated_at: new Date().toISOString() }).eq('security_id', id)
      check('securities update', error)
    },
    async linkPositions(cusip, securityId) {
      const { error } = await sb.from('investment_positions').update({ security_id: securityId }).eq('cusip', cusip).is('security_id', null)
      check('investment_positions link', error)
      const { error: e2 } = await sb.from('investment_position_changes').update({ security_id: securityId }).eq('cusip', cusip).is('security_id', null)
      check('investment_position_changes link', e2)
    },
    async lastPriceDate(securityId, source) {
      const { data, error } = await sb.from('security_prices').select('d').eq('security_id', securityId).eq('source', source).order('d', { ascending: false }).limit(1)
      check('security_prices', error)
      return data?.[0]?.d ?? null
    },
    async upsertPrices(securityId, rows) {
      for (let i = 0; i < rows.length; i += 1000) {
        const { error } = await sb.from('security_prices').upsert(
          rows.slice(i, i + 1000).map((r) => ({ ...r, security_id: securityId })),
          { onConflict: 'security_id,source,d' },
        )
        check('security_prices upsert', error)
      }
    },
    async corporateActions() {
      const rows = await pageAll<Record<string, unknown>>(
        (a, b) => sb.from('security_corporate_actions').select('action_id, security_id, ex_date, kind, ratio, amount, currency, source, source_url').order('action_id').range(a, b),
        'security_corporate_actions',
      )
      return rows.map((r) => ({ ...r, ratio: n(r.ratio), amount: n(r.amount) })) as never
    },
    async upsertActions(rows) {
      if (rows.length === 0) return
      const { error } = await sb.from('security_corporate_actions').upsert(rows as never[], { onConflict: 'security_id,kind,ex_date,source' })
      check('security_corporate_actions upsert', error)
    },
    async lastFactFiled(securityId) {
      const { data, error } = await sb.from('company_financials').select('filed').eq('security_id', securityId).order('filed', { ascending: false, nullsFirst: false }).limit(1)
      check('company_financials', error)
      return data?.[0]?.filed ?? null
    },
    async insertFacts(rows) {
      for (let i = 0; i < rows.length; i += 1000) {
        const { error } = await sb
          .from('company_financials')
          .upsert(rows.slice(i, i + 1000) as never[], { onConflict: 'security_id,taxonomy,concept,unit,period_key,accession', ignoreDuplicates: true })
        check('company_financials upsert', error)
      }
    },
  }
}
