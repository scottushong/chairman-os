import { countChanges } from '@/lib/investment/changes'
import { SEED_MANAGERS, SEED_SETTINGS, SEED_SOURCES } from '@/lib/investment/seed'
import type { InvestmentMethods } from '@/lib/investment/store'
import type {
  InvAlert,
  InvBrief,
  InvEvidence,
  InvForecast,
  InvMarket,
  InvMarketSource,
  InvPhilosophy,
  InvRecommendation,
  InvScenario,
  InvScoreRow,
  InvThesis,
  InvValuationRow,
  InvValueChain,
  InvChange,
  InvCorporateAction,
  InvDisclosure,
  InvEtfHolding,
  InvFact,
  InvMetric,
  InvPosition,
  InvPrice,
  InvRun,
  InvSecurity,
  InvSettings,
  InvSource,
} from '@/lib/investment/types'

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * dummy 모드의 Investment Intelligence — 실제 공개 자료를 한 번 받아 줄인 스냅숏(fixtures/snapshot.json,
 * scripts/gen-investment-fixture.ts가 만든다)을 메모리에 올린다. 화면 머리의 DUMMY DATA 띠가 그대로 뜬다.
 * 손 입력은 이 프로세스 메모리에만 남는다.
 */

interface Snapshot {
  generated_at: string
  sources: InvSource[]
  runs: InvRun[]
  disclosures: InvDisclosure[]
  positions: InvPosition[]
  changes: InvChange[]
  securities: InvSecurity[]
  prices: [string, InvPrice[]][]
  actions: InvCorporateAction[]
  facts: InvFact[]
  seed95?: Record<string, Record<string, unknown>[]>
}

const DATE_KEYS = new Set(['published_date', 'as_of', 'document_date', 'created_at'])
const NUM_KEYS = new Set(['value', 'size_value', 'score', 'raw_value', 'data_quality', 'sort_order', 'year', 'forecast_id', 'chain_id', 'score_id'])
/** PGlite가 떠 준 줄 — 날짜는 YYYY-MM-DD(created_at은 ISO), 숫자는 number로 */
function norm<T>(rows: Record<string, unknown>[] | undefined): T[] {
  return (rows ?? []).map((r) => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) o[k] = null
      else if (DATE_KEYS.has(k)) o[k] = k === 'created_at' ? new Date(String(v)).toISOString() : String(v).slice(0, 10)
      else if (NUM_KEYS.has(k)) o[k] = Number(v)
      else o[k] = v
    }
    return o as T
  })
}

/** 스냅숏은 처음 부를 때 한 번 읽는다(import하면 2MB JSON을 타입 검사가 끌어안는다). 없으면 시드만. */
function load() {
  const path = join(process.cwd(), 'src', 'lib', 'investment', 'fixtures', 'snapshot.json')
  const snap: Partial<Snapshot> = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Snapshot) : {}
  return {
    settings: { ...SEED_SETTINGS } as InvSettings,
    sources: (snap.sources?.length ? snap.sources : SEED_SOURCES).map((s) => ({ ...s })),
    runs: [...(snap.runs ?? [])],
    disclosures: [...(snap.disclosures ?? [])],
    positions: [...(snap.positions ?? [])],
    changes: [...(snap.changes ?? [])],
    securities: (snap.securities ?? []).map((s) => ({ ...s })),
    prices: new Map<string, InvPrice[]>(snap.prices ?? []),
    actions: [...(snap.actions ?? [])],
    facts: (snap.facts ?? []).map((f) => ({ ...f, source_url: f.source_url || `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.cik}&type=10-K` })),
    metrics: [] as InvMetric[],
    etf: [] as InvEtfHolding[],
    audit: [] as { action: string; entity: string; entity_id: string | null; detail: Record<string, unknown>; at: string }[],
    s95: {
      markets: norm<InvMarket>(snap.seed95?.markets),
      market_sources: norm<InvMarketSource>(snap.seed95?.market_sources),
      forecasts: norm<InvForecast>(snap.seed95?.forecasts),
      value_chains: norm<InvValueChain>(snap.seed95?.value_chains),
      scores: norm<InvScoreRow>(snap.seed95?.scores),
      philosophy: norm<InvPhilosophy>(snap.seed95?.philosophy),
    },
    theses: [] as InvThesis[],
    evidence: [] as InvEvidence[],
    scenarios: [] as InvScenario[],
    valuations: [] as InvValuationRow[],
    recs: [] as InvRecommendation[],
    alerts: [] as InvAlert[],
    briefs: [] as InvBrief[],
  }
}
let cached: ReturnType<typeof load> | null = null
const S = () => (cached ??= load())

export const dummyInvestmentMethods: InvestmentMethods = {
  async invManagers() {
    return SEED_MANAGERS
  },
  async invSources() {
    return S().sources
  },
  async invSettings() {
    return S().settings
  },
  async invRuns(limit) {
    return [...S().runs].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, limit)
  },
  async invDisclosures() {
    return [...S().disclosures].sort((a, b) => a.data_as_of.localeCompare(b.data_as_of))
  },
  async invChanges(q) {
    let xs = S().changes
    if (q.toDisclosures) {
      const set = new Set(q.toDisclosures)
      xs = xs.filter((c) => set.has(c.to_disclosure))
    }
    if (q.securityId) xs = xs.filter((c) => c.security_id === q.securityId)
    if (q.statuses) xs = xs.filter((c) => q.statuses!.includes(c.status))
    return q.limit ? xs.slice(0, q.limit) : xs
  },
  async invChangeCounts(toDisclosure) {
    return countChanges(S().changes.filter((c) => c.to_disclosure === toDisclosure))
  },
  async invPositions(q) {
    const set = new Set(q.disclosureIds)
    const xs = S().positions.filter((p) => set.has(p.disclosure_id))
    return q.limit ? [...xs].sort((a, b) => (b.value ?? -1) - (a.value ?? -1)).slice(0, q.limit) : xs
  },
  async invSecurityPositions(securityId) {
    return S().positions.filter((p) => p.security_id === securityId)
  },
  async invSecurities(opts = {}) {
    return S().securities
      .filter((s) => opts.watch === undefined || s.watch === opts.watch)
      .filter((s) => !opts.ids || opts.ids.includes(s.security_id))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
  async invSecurity(id) {
    return S().securities.find((s) => s.security_id === id) ?? null
  },
  async invPrices(securityId) {
    return S().prices.get(securityId) ?? []
  },
  async invActions(securityId) {
    return S().actions.filter((a) => a.security_id === securityId)
  },
  async invFacts(securityId) {
    return S().facts.filter((f) => f.security_id === securityId)
  },
  async invMetrics(securityId) {
    return S().metrics.filter((m) => m.security_id === securityId)
  },
  async invEtfHoldings(securityId) {
    return S().etf.filter((e) => e.security_id === securityId)
  },
  async invSaveSettings(patch) {
    Object.assign(S().settings, patch, { updated_at: new Date().toISOString() })
  },
  async invManualDisclosure(input) {
    const id = crypto.randomUUID()
    S().disclosures.push({
      disclosure_id: id,
      manager_id: input.manager_id,
      source_id: input.source_id,
      source_type: input.source_id === 'fundsmith:factsheet' ? 'factsheet' : input.source_id === 'pershing:site' ? 'site' : 'manual',
      doc_key: `manual:${input.data_as_of}:${Date.now().toString(36)}`,
      form: '손 입력',
      data_as_of: input.data_as_of,
      source_published_at: input.source_published_at,
      source_url: input.source_url,
      is_amendment: false,
      amendment_type: null,
      amends_key: null,
      coverage: input.coverage,
      position_count: input.rows.length,
      total_value: null,
      currency: 'USD',
      data_quality: 80,
      status: 'partial',
      is_demo: false,
      ingested_at: new Date().toISOString(),
    })
    input.rows.forEach((r, i) =>
      S().positions.push({
        disclosure_id: id,
        line_no: i + 1,
        holding_key: (r.ticker ?? r.issuer_name).toUpperCase(),
        issuer_name: r.issuer_name,
        title_of_class: null,
        cusip: null,
        isin: null,
        ticker: r.ticker,
        security_id: null,
        shares: r.shares,
        share_type: r.shares === null ? null : 'SH',
        put_call: null,
        value: r.value,
        value_currency: 'USD',
        ownership_pct: null,
        weight_pct: r.weight_pct,
        country: null,
        sector: null,
        discretion: null,
      }),
    )
    return id
  },
  async invAddAction(a) {
    S().actions.push({ ...a, source: 'manual' })
  },
  async invAddMetric(m) {
    S().metrics.push(m)
  },
  async invSetWatch(securityId, watch, reason) {
    const s = S().securities.find((x) => x.security_id === securityId)
    if (s) Object.assign(s, { watch, watch_reason: reason })
  },
  async invAudit(action, entity, entityId, detail) {
    S().audit.push({ action, entity, entity_id: entityId, detail, at: new Date().toISOString() })
  },
  // ── 0095 ──
  async invMarkets() {
    return S().s95.markets
  },
  async invMarketSources() {
    return S().s95.market_sources
  },
  async invForecasts() {
    return S().s95.forecasts
  },
  async invValueChains() {
    return S().s95.value_chains
  },
  async invScores(subjectType, subjectId) {
    return S().s95.scores.filter((r) => (!subjectType || r.subject_type === subjectType) && (!subjectId || r.subject_id === subjectId))
  },
  async invPhilosophy() {
    return S().s95.philosophy
  },
  async invTheses(securityId) {
    return S().theses.filter((t) => !securityId || t.security_id === securityId)
  },
  async invEvidence(ids) {
    return S().evidence.filter((e) => ids.includes(e.thesis_id))
  },
  async invScenarios(securityId) {
    return S().scenarios.filter((x) => !securityId || x.security_id === securityId)
  },
  async invValuations(securityId) {
    return S().valuations.filter((v) => v.security_id === securityId).reverse()
  },
  async invRecommendations(opts = {}) {
    const xs = S().recs.filter((r) => !opts.securityId || r.security_id === opts.securityId).sort((a, b) => a.security_id.localeCompare(b.security_id) || b.version - a.version)
    if (!opts.latestOnly) return xs
    const seen = new Set<string>()
    return xs.filter((r) => {
      if (seen.has(r.security_id)) return false
      seen.add(r.security_id)
      return true
    })
  },
  async invAlerts(limit) {
    return [...S().alerts].reverse().slice(0, limit)
  },
  async invBriefs(limit) {
    return [...S().briefs].reverse().slice(0, limit)
  },
  async invAiUsage() {
    return { today_calls: 0, month_usd: 0, daily_limit: S().settings.ai_daily_calls ?? 20, monthly_limit: S().settings.ai_monthly_usd ?? 30 }
  },
  async invAddMarketSource(src) {
    const id = crypto.randomUUID()
    S().s95.market_sources.push({ ...src, source_id: id })
    return id
  },
  async invAddForecast(f) {
    S().s95.forecasts.push({ ...f, forecast_id: S().s95.forecasts.length + 1 })
  },
  async invAddValueChain(c) {
    S().s95.value_chains.push({ ...c, chain_id: S().s95.value_chains.length + 1 })
  },
  async invSetSecurityMarket(securityId, marketId) {
    const s = S().securities.find((x) => x.security_id === securityId)
    if (s) s.market_id = marketId
  },
  async invMarkAlertRead(alertId) {
    const a = S().alerts.find((x) => x.alert_id === alertId)
    if (a) a.read_at = new Date().toISOString()
  },
  async invSaveWeights(w) {
    S().settings.weights = { ...w }
  },
  async invAddScore(r) {
    S().s95.scores.push({ ...r, score_id: S().s95.scores.length + 1, created_at: new Date().toISOString() })
  },
  async invAddThesis(t, evidence) {
    const id = crypto.randomUUID()
    S().theses.push({ ...t, thesis_id: id, created_at: new Date().toISOString() })
    for (const e of evidence) S().evidence.push({ ...e, thesis_id: id, evidence_id: S().evidence.length + 1 })
    return id
  },
  async invAddScenario(x) {
    const id = S().scenarios.length + 1
    S().scenarios.push({ ...x, scenario_row_id: id, created_at: new Date().toISOString() })
    return id
  },
  async invAddValuation(v) {
    S().valuations.push({ ...v, valuation_id: S().valuations.length + 1, created_at: new Date().toISOString() })
  },
  async invAddRecommendation(r) {
    if (r.status === 'BUY ZONE' && (r.created_kind !== 'system' || r.checks.some((c) => !c.pass))) throw new Error('investment_buy_only_system')
    const id = crypto.randomUUID()
    S().recs.push({ ...r, rec_id: id, created_at: new Date().toISOString() })
    return id
  },
  async invAddAlerts(rows) {
    let n = 0
    for (const a of rows) {
      if (a.dedupe_key && S().alerts.some((x) => x.dedupe_key === a.dedupe_key)) continue
      S().alerts.push({ ...a, alert_id: S().alerts.length + 1, created_at: new Date().toISOString(), read_at: null })
      n += 1
    }
    return n
  },
  async invAddBrief(b) {
    S().briefs.push({ ...b, brief_id: S().briefs.length + 1, created_at: new Date().toISOString() })
  },
}
