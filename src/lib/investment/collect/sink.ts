import type {
  DataStatus,
  InvChange,
  InvCorporateAction,
  InvDisclosure,
  InvFact,
  InvManager,
  InvPosition,
  InvPrice,
  InvSecurity,
  InvSettings,
  InvSource,
  PriceSource,
} from '../types'

/**
 * 수집 프로세스가 쓰는 자리. live = Integration 계정 세션(sink-supabase.ts — RLS가 원천 표 insert/update만 허락),
 * 시험 · dummy = 메모리(memorySink). 판정 · 계산은 이 위(run.ts · changes.ts)에서 끝내고 여기서는 읽고 쓰기만 한다.
 */

export type NewDisclosure = Omit<InvDisclosure, 'disclosure_id' | 'ingested_at'>
export type NewPosition = Omit<InvPosition, 'disclosure_id' | 'position_id'>
export type NewSecurity = Omit<InvSecurity, 'security_id' | 'updated_at'>

export interface SourcePatch {
  status?: DataStatus
  status_note?: string | null
  last_attempt_at?: string
  last_success_at?: string
  last_error?: string | null
}

export interface RunStep {
  step: string
  ok: boolean
  calls: number
  note: string
}

export interface CollectorSink {
  settings(): Promise<InvSettings>
  managers(): Promise<InvManager[]>
  sources(): Promise<InvSource[]>
  markSource(id: string, patch: SourcePatch): Promise<void>
  /** 오늘(서울) 호출 수를 더한다 — 날이 바뀌었으면 0부터. */
  addCalls(id: string, n: number, day: string): Promise<void>
  startRun(trigger: 'cron' | 'manual' | 'test'): Promise<number>
  finishRun(runId: number, out: { ok: boolean; calls: number; steps: RunStep[]; note: string | null }): Promise<void>
  disclosures(sourceId?: string): Promise<InvDisclosure[]>
  insertDisclosure(d: NewDisclosure, positions: NewPosition[]): Promise<string>
  positions(disclosureIds: readonly string[]): Promise<InvPosition[]>
  /** 이 판정 버전으로 이미 판정한 to_disclosure들 */
  changedDisclosures(version: string): Promise<Set<string>>
  upsertChanges(rows: readonly InvChange[]): Promise<void>
  securities(): Promise<InvSecurity[]>
  insertSecurities(rows: readonly NewSecurity[]): Promise<void>
  updateSecurity(id: string, patch: Partial<NewSecurity>): Promise<void>
  /** 이 CUSIP의 보유 줄에 종목을 잇는다(비어 있는 줄만). */
  linkPositions(cusip: string, securityId: string): Promise<void>
  lastPriceDate(securityId: string, source: PriceSource): Promise<string | null>
  upsertPrices(securityId: string, rows: readonly InvPrice[]): Promise<void>
  corporateActions(): Promise<InvCorporateAction[]>
  upsertActions(rows: readonly InvCorporateAction[]): Promise<void>
  lastFactFiled(securityId: string): Promise<string | null>
  insertFacts(rows: readonly InvFact[]): Promise<void>
}

const uid = () => crypto.randomUUID()

/** 메모리 싱크 — check:investment · dummy 모드 «지금 수집». 시드는 0094 시드와 같다(managers · sources · settings). */
export function memorySink(seed: { managers: InvManager[]; sources: InvSource[]; settings: InvSettings }) {
  const st = {
    managers: seed.managers,
    sources: seed.sources.map((s) => ({ ...s })),
    settings: seed.settings,
    runs: [] as { run_id: number; trigger: string; ok: boolean | null; calls: number; steps: RunStep[]; note: string | null; started_at: string; finished_at: string | null }[],
    disclosures: [] as InvDisclosure[],
    positions: [] as InvPosition[],
    changes: [] as InvChange[],
    securities: [] as InvSecurity[],
    prices: new Map<string, InvPrice[]>(),
    actions: [] as InvCorporateAction[],
    facts: [] as InvFact[],
  }
  let pos = 0
  const sink: CollectorSink = {
    async settings() {
      return st.settings
    },
    async managers() {
      return st.managers
    },
    async sources() {
      return st.sources
    },
    async markSource(id, patch) {
      const s = st.sources.find((x) => x.source_id === id)
      if (s) Object.assign(s, patch)
    },
    async addCalls(id, n, day) {
      const s = st.sources.find((x) => x.source_id === id)
      if (!s) return
      s.calls_today = s.calls_day === day ? s.calls_today + n : n
      s.calls_day = day
    },
    async startRun(trigger) {
      const run_id = st.runs.length + 1
      st.runs.push({ run_id, trigger, ok: null, calls: 0, steps: [], note: null, started_at: new Date().toISOString(), finished_at: null })
      return run_id
    },
    async finishRun(runId, out) {
      const r = st.runs.find((x) => x.run_id === runId)
      if (r) Object.assign(r, out, { finished_at: new Date().toISOString() })
    },
    async disclosures(sourceId) {
      return st.disclosures.filter((d) => !sourceId || d.source_id === sourceId)
    },
    async insertDisclosure(d, positions) {
      if (st.disclosures.some((x) => x.source_id === d.source_id && x.doc_key === d.doc_key)) throw new Error('duplicate key value violates unique constraint')
      const disclosure_id = uid()
      st.disclosures.push({ ...d, disclosure_id, ingested_at: new Date().toISOString() })
      for (const p of positions) st.positions.push({ ...p, disclosure_id, position_id: ++pos })
      return disclosure_id
    },
    async positions(ids) {
      const set = new Set(ids)
      return st.positions.filter((p) => set.has(p.disclosure_id))
    },
    async changedDisclosures(version) {
      return new Set(st.changes.filter((c) => c.calculation_version === version).map((c) => c.to_disclosure))
    },
    async upsertChanges(rows) {
      for (const r of rows) {
        const i = st.changes.findIndex((c) => c.to_disclosure === r.to_disclosure && c.holding_key === r.holding_key && c.calculation_version === r.calculation_version)
        if (i >= 0) st.changes[i] = { ...r }
        else st.changes.push({ ...r, change_id: st.changes.length + 1 })
      }
    },
    async securities() {
      return st.securities
    },
    async insertSecurities(rows) {
      for (const r of rows) {
        if (r.cusip && st.securities.some((s) => s.cusip === r.cusip)) throw new Error('duplicate cusip')
        st.securities.push({ ...r, security_id: uid(), updated_at: new Date().toISOString() })
      }
    },
    async updateSecurity(id, patch) {
      const s = st.securities.find((x) => x.security_id === id)
      if (s) Object.assign(s, patch, { updated_at: new Date().toISOString() })
    },
    async linkPositions(cusip, securityId) {
      for (const p of st.positions) if (p.cusip === cusip && !p.security_id) p.security_id = securityId
    },
    async lastPriceDate(securityId, source) {
      const xs = (st.prices.get(securityId) ?? []).filter((p) => p.source === source).map((p) => p.d).sort()
      return xs.at(-1) ?? null
    },
    async upsertPrices(securityId, rows) {
      const cur = st.prices.get(securityId) ?? []
      const key = (p: InvPrice) => `${p.source}|${p.d}`
      const m = new Map(cur.map((p) => [key(p), p]))
      for (const r of rows) m.set(key(r), r)
      st.prices.set(securityId, [...m.values()].sort((a, b) => a.d.localeCompare(b.d)))
    },
    async corporateActions() {
      return st.actions
    },
    async upsertActions(rows) {
      for (const r of rows) {
        const i = st.actions.findIndex((a) => a.security_id === r.security_id && a.kind === r.kind && a.ex_date === r.ex_date && a.source === r.source)
        if (i >= 0) st.actions[i] = r
        else st.actions.push(r)
      }
    },
    async lastFactFiled(securityId) {
      const xs = st.facts.filter((f) => f.security_id === securityId).map((f) => f.filed ?? '').sort()
      return xs.at(-1) || null
    },
    async insertFacts(rows) {
      const k = (f: InvFact) => `${f.security_id}|${f.taxonomy}|${f.concept}|${f.unit}|${f.period_key}|${f.accession}`
      const have = new Set(st.facts.map(k))
      for (const r of rows) if (!have.has(k(r))) st.facts.push(r)
    },
  }
  return { sink, state: st }
}
