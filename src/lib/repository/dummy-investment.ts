import { countChanges } from '@/lib/investment/changes'
import { SEED_MANAGERS, SEED_SETTINGS, SEED_SOURCES } from '@/lib/investment/seed'
import type { InvestmentMethods } from '@/lib/investment/store'
import type {
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
}
