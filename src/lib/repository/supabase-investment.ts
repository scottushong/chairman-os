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
import { DEFAULT_WEIGHTS, type Weights } from '@/lib/investment/scores'
import type { ChangeStatus, InvRecommendation, InvRun, InvScenario, InvSecurity, InvSettings } from '@/lib/investment/types'

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
        ...(data.w_market_demand !== undefined
          ? {
              weights: Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, Number((data as Record<string, unknown>)[k])])) as unknown as Weights,
              ai_daily_calls: Number(data.ai_daily_calls),
              ai_monthly_usd: Number(data.ai_monthly_usd),
            }
          : {}),
        ...(data.plan_equity_security !== undefined ? { plan_equity_security: data.plan_equity_security, plan_bond_security: data.plan_bond_security } : {}),
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

    // ── 0095 ──
    async invMarkets() {
      const { data, error } = await sb.from('future_markets').select('market_id, name, name_ko, description, sort_order').order('sort_order')
      check('future_markets', error)
      return data ?? []
    },
    async invMarketSources() {
      const { data, error } = await sb
        .from('market_research_sources')
        .select('source_id, market_id, publisher, title, url, published_date, verified, note')
        .order('published_date', { ascending: false, nullsFirst: false })
      check('market_research_sources', error)
      return data ?? []
    },
    async invForecasts() {
      const { data, error } = await sb.from('market_forecasts').select('forecast_id, market_id, metric, label, year, value, unit, text_value, kind, source_id, note').order('forecast_id')
      check('market_forecasts', error)
      return (data ?? []).map((r) => ({ ...r, value: num(r.value) }))
    },
    async invValueChains() {
      const { data, error } = await sb.from('market_value_chains').select('chain_id, market_id, segment, size_value, size_unit, profitability, barrier, leaders, source_id, sort_order').order('sort_order')
      check('market_value_chains', error)
      return (data ?? []).map((r) => ({ ...r, size_value: num(r.size_value) }))
    },
    async invScores(subjectType, subjectId) {
      let q = sb
        .from('investment_scores')
        .select('score_id, subject_type, subject_id, factor, score, method, raw_value, raw_unit, evidence, source_url, as_of, data_quality, model_version, created_kind, created_at')
        .order('created_at')
      if (subjectType) q = q.eq('subject_type', subjectType)
      if (subjectId) q = q.eq('subject_id', subjectId)
      const { data, error } = await q
      check('investment_scores', error)
      return (data ?? []).map((r) => ({ ...r, score: Number(r.score), raw_value: num(r.raw_value) }))
    },
    async invPhilosophy() {
      const { data, error } = await sb.from('investment_manager_philosophy').select('manager_id, principle, source_url, document_date, verified, sort_order').order('manager_id').order('sort_order')
      check('investment_manager_philosophy', error)
      return data ?? []
    },
    async invTheses(securityId) {
      let q = sb
        .from('investment_theses')
        .select('thesis_id, security_id, manager_id, kind, statement, classification, state, source_url, document_date, model_version, created_kind, created_at')
        .order('created_at')
      if (securityId) q = q.eq('security_id', securityId)
      const { data, error } = await q
      check('investment_theses', error)
      return data ?? []
    },
    async invEvidence(ids) {
      if (ids.length === 0) return []
      const { data, error } = await sb
        .from('investment_thesis_evidence')
        .select('evidence_id, thesis_id, label, value_text, source_url, as_of, created_kind')
        .in('thesis_id', [...ids])
        .order('evidence_id')
      check('investment_thesis_evidence', error)
      return data ?? []
    },
    async invScenarios(securityId) {
      let q = sb
        .from('investment_scenarios')
        .select('scenario_row_id, security_id, scenario, inputs, years, probability, probability_is_ai, premise, risk, created_kind, created_at')
        .order('created_at')
      if (securityId) q = q.eq('security_id', securityId)
      const { data, error } = await q
      check('investment_scenarios', error)
      return (data ?? []).map((r) => ({ ...r, probability: num(r.probability) })) as InvScenario[]
    },
    async invValuations(securityId) {
      const { data, error } = await sb.from('investment_valuations').select('*').eq('security_id', securityId).order('created_at', { ascending: false }).limit(60)
      check('investment_valuations', error)
      return (data ?? []).map((r) => ({
        ...r,
        future_fcf_ps: Number(r.future_fcf_ps),
        future_price: Number(r.future_price),
        present_value: Number(r.present_value),
        buy_price: Number(r.buy_price),
        current_price: num(r.current_price),
        upside_pct: num(r.upside_pct),
        expected_cagr_pct: num(r.expected_cagr_pct),
      }))
    },
    async invRecommendations(opts = {}) {
      const rows = await pageAll<Record<string, unknown>>((a, b) => {
        let q = sb.from('investment_recommendations').select('*').order('security_id').order('version', { ascending: false })
        if (opts.securityId) q = q.eq('security_id', opts.securityId)
        return q.range(a, b)
      }, 'investment_recommendations')
      const out = rows.map(
        (r) =>
          ({
            ...r,
            market_score: num(r.market_score),
            leader_score: num(r.leader_score),
            valuation_score: num(r.valuation_score),
            institutional_signal: num(r.institutional_signal),
            opportunity_score: num(r.opportunity_score),
            current_price: num(r.current_price),
            buy_price: num(r.buy_price),
            gap_pct: num(r.gap_pct),
            expected_return_5y: num(r.expected_return_5y),
          }) as InvRecommendation,
      )
      if (!opts.latestOnly) return out
      const seen = new Set<string>()
      return out.filter((r) => {
        if (seen.has(r.security_id)) return false
        seen.add(r.security_id)
        return true
      })
    },
    async invAlerts(limit) {
      const { data, error } = await sb
        .from('investment_alerts')
        .select('alert_id, kind, severity, title, body, security_id, manager_id, link, dedupe_key, created_at, read_at')
        .order('created_at', { ascending: false })
        .limit(limit)
      check('investment_alerts', error)
      return data ?? []
    },
    async invBriefs(limit) {
      const { data, error } = await sb
        .from('investment_briefs')
        .select('brief_id, brief_date, content, ai_summary, data_as_of, model_version, created_kind, created_at')
        .order('brief_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit)
      check('investment_briefs', error)
      return data ?? []
    },
    async invAiUsage() {
      const since = new Date(Date.now() - 40 * 86400_000).toISOString()
      const { data, error } = await sb.from('investment_ai_reservations').select('est_usd, actual_usd, status, created_at').gte('created_at', since)
      check('investment_ai_reservations', error)
      if (!data) return null
      const settings = await self.invSettings()
      const kst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString()
      const nowK = kst(new Date().toISOString())
      const today = data.filter((r) => kst(r.created_at).slice(0, 10) === nowK.slice(0, 10))
      const month = data.filter((r) => kst(r.created_at).slice(0, 7) === nowK.slice(0, 7))
      return {
        today_calls: today.length,
        month_usd: month.reduce((t, r) => t + Number(r.status === 'reserved' ? r.est_usd : (r.actual_usd ?? r.est_usd)), 0),
        daily_limit: settings.ai_daily_calls ?? 20,
        monthly_limit: settings.ai_monthly_usd ?? 30,
      }
    },
    async invAddMarketSource(src) {
      const { data, error } = await sb.from('market_research_sources').insert(src).select('source_id').single()
      check('market_research_sources insert', error)
      await self.invAudit('market.source', 'market_research_sources', String(data!.source_id), { url: src.url })
      return String(data!.source_id)
    },
    async invAddForecast(f) {
      const { error } = await sb.from('market_forecasts').insert(f)
      check('market_forecasts insert', error)
      await self.invAudit('market.forecast', 'market_forecasts', f.market_id, { ...f })
    },
    async invAddValueChain(c) {
      const { error } = await sb.from('market_value_chains').insert(c)
      check('market_value_chains insert', error)
    },
    async invSetSecurityMarket(securityId, marketId) {
      const { error } = await sb.from('securities').update({ market_id: marketId, updated_at: new Date().toISOString() }).eq('security_id', securityId)
      check('securities market', error)
      await self.invAudit('security.market', 'securities', securityId, { market_id: marketId })
    },
    async invMarkAlertRead(alertId) {
      const { error } = await sb.from('investment_alerts').update({ read_at: new Date().toISOString() }).eq('alert_id', alertId)
      check('investment_alerts read', error)
    },
    async invSaveWeights(w) {
      const { error } = await sb.from('investment_settings').update({ ...w, updated_at: new Date().toISOString() }).eq('id', 1)
      check('investment_settings weights', error)
      await self.invAudit('settings.weights', 'investment_settings', '1', { ...w })
    },
    async invAddScore(r) {
      const { error } = await sb.from('investment_scores').insert(r)
      check('investment_scores insert', error)
    },
    async invAddThesis(t, evidence) {
      const { data, error } = await sb.from('investment_theses').insert(t).select('thesis_id').single()
      check('investment_theses insert', error)
      const id = String(data!.thesis_id)
      if (evidence.length) {
        const { error: e2 } = await sb.from('investment_thesis_evidence').insert(evidence.map((e) => ({ ...e, thesis_id: id })))
        check('investment_thesis_evidence insert', e2)
      }
      return id
    },
    async invAddScenario(x) {
      const { data, error } = await sb.from('investment_scenarios').insert(x).select('scenario_row_id').single()
      check('investment_scenarios insert', error)
      return Number(data!.scenario_row_id)
    },
    async invAddValuation(v) {
      const { error } = await sb.from('investment_valuations').insert(v)
      check('investment_valuations insert', error)
    },
    async invAddRecommendation(r) {
      const { data, error } = await sb.from('investment_recommendations').insert(r).select('rec_id').single()
      check('investment_recommendations insert', error)
      return String(data!.rec_id)
    },
    async invAddAlerts(rows) {
      if (rows.length === 0) return 0
      const { data, error } = await sb.from('investment_alerts').upsert(rows as never[], { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('alert_id')
      check('investment_alerts insert', error)
      return data?.length ?? 0
    },
    async invAddBrief(b) {
      const { error } = await sb.from('investment_briefs').insert(b)
      check('investment_briefs insert', error)
    },

    // ── 0096 ──
    async invAccounts() {
      const { data, error } = await sb.from('corporate_investment_accounts').select('account_id, name, broker, account_last4, owner_entity, currency, opened_at, note').order('created_at')
      check('corporate_investment_accounts', error)
      return data ?? []
    },
    async invApprovals() {
      const { data, error } = await sb.from('corporate_investment_approvals').select('approval_id, kind, title, amount_krw, security_id, side, ea_doc_id, rec_id, created_at').order('created_at', { ascending: false })
      check('corporate_investment_approvals', error)
      const { data: st, error: e2 } = await sb.rpc('investment_approval_states')
      check('investment_approval_states', e2)
      const by = new Map(((st ?? []) as { approval_id: string; status: string; decided_at: string | null; doc_no: string | null; approver_name: string | null }[]).map((x) => [x.approval_id, x]))
      return (data ?? []).map((a) => ({ ...a, amount_krw: Number(a.amount_krw), ...(by.get(a.approval_id) ?? {}) })) as never
    },
    async invCorpTxs() {
      const { data, error } = await sb.from('corporate_transactions').select('*').order('trade_date').order('tx_id')
      check('corporate_transactions', error)
      return (data ?? []).map((r) => ({ ...r, shares: num(r.shares), price: num(r.price), fx_rate: num(r.fx_rate), amount: Number(r.amount), amount_krw: Number(r.amount_krw), fees_krw: Number(r.fees_krw), tax_krw: Number(r.tax_krw) }))
    },
    async invPaperPortfolios() {
      const { data, error } = await sb.from('paper_portfolios').select('portfolio_id, name, rule, base_currency, notional, started_at').order('created_at')
      check('paper_portfolios', error)
      return (data ?? []).map((r) => ({ ...r, notional: Number(r.notional) }))
    },
    async invPaperTxs() {
      const { data, error } = await sb.from('paper_transactions').select('*').order('trade_date').order('tx_id')
      check('paper_transactions', error)
      return (data ?? []).map((r) => ({ ...r, shares: Number(r.shares), price: Number(r.price) }))
    },
    async invOutcomes() {
      const { data, error } = await sb.from('recommendation_outcomes').select('*').order('created_at')
      check('recommendation_outcomes', error)
      return (data ?? []).map((r) => ({ ...r, entry_price: num(r.entry_price), exit_price: num(r.exit_price), return_pct: num(r.return_pct), benchmark_return_pct: num(r.benchmark_return_pct), excess_pct: num(r.excess_pct) }))
    },
    async invAddAccount(a) {
      const { data, error } = await sb.from('corporate_investment_accounts').insert(a).select('account_id').single()
      check('corporate_investment_accounts insert', error)
      await self.invAudit('portfolio.account', 'corporate_investment_accounts', String(data!.account_id), { name: a.name, broker: a.broker })
      return String(data!.account_id)
    },
    async invAddApproval(a) {
      const { data, error } = await sb.from('corporate_investment_approvals').insert(a).select('approval_id').single()
      check('corporate_investment_approvals insert', error)
      await self.invAudit('portfolio.approval', 'corporate_investment_approvals', String(data!.approval_id), { kind: a.kind, amount_krw: a.amount_krw, ea_doc_id: a.ea_doc_id })
      return String(data!.approval_id)
    },
    async invAddCorpTx(t) {
      const { error } = await sb.from('corporate_transactions').insert(t)
      if (error && /investment_trade_not_approved/.test(error.message)) throw new Error('investment_trade_not_approved')
      check('corporate_transactions insert', error)
      await self.invAudit('portfolio.tx', 'corporate_transactions', t.account_id, { kind: t.kind, amount_krw: t.amount_krw, approval_id: t.approval_id })
    },
    async invAddPaperTx(t) {
      const { error } = await sb.from('paper_transactions').insert(t)
      check('paper_transactions insert', error)
    },
    async invAddOutcome(o) {
      const { error } = await sb.from('recommendation_outcomes').insert(o)
      check('recommendation_outcomes insert', error)
    },
    async invSavePlan(equity, bond) {
      const { error } = await sb.from('investment_settings').update({ plan_equity_security: equity, plan_bond_security: bond, updated_at: new Date().toISOString() }).eq('id', 1)
      check('investment_settings plan', error)
      await self.invAudit('settings.plan', 'investment_settings', '1', { equity, bond })
    },
  }
  return self
}
