/**
 * Investment Intelligence(0094~) 도메인 타입. 표 모양은 supabase/migrations/0094_investment_radar.sql 그대로다.
 * 숫자 칸(numeric)은 PostgREST가 문자열로 줄 수 있어 저장소 어댑터가 number로 바꿔 넘긴다.
 */

/** 칸마다 다는 데이터 상태(머리말 «데이터마다 상태를 보인다»). */
export type DataStatus = 'LIVE' | 'PARTIAL' | 'DEMO' | 'UNAVAILABLE' | 'DISABLED'

/** 공시 사이 순보유 변화(원문 4.2). */
export type ChangeStatus = 'NEW' | 'ADD' | 'TRIM' | 'EXIT' | 'HOLD' | 'UNKNOWN'

export type ManagerId = 'nbim' | 'berkshire' | 'fundsmith' | 'pershing'

export interface InvManager {
  manager_id: ManagerId
  name: string
  operator: string
  official_url: string
  sec_cik: string | null
  sec_filer_name: string | null
  style: 'index' | 'concentrated'
  signal_weight: number
  coverage_note: string
  sort_order: number
}

export type SourceKind = 'sec_13f' | 'nbim_holdings' | 'factsheet' | 'site' | 'sec_xbrl' | 'openfigi' | 'prices' | 'fx' | 'manual'

export interface InvSource {
  source_id: string
  manager_id: ManagerId | null
  label: string
  kind: SourceKind
  url: string
  cadence: string
  key_env: string | null
  status: DataStatus
  status_note: string | null
  last_attempt_at: string | null
  last_success_at: string | null
  last_error: string | null
  calls_day: string | null
  calls_today: number
}

export interface InvSettings {
  /** 0095 가중치 · AI 한도(0094 DB면 없음 — 기본값을 쓴다) */
  weights?: import('./scores').Weights
  ai_daily_calls?: number
  ai_monthly_usd?: number
  /** 0096 월 적립 계획 ETF */
  plan_equity_security?: string | null
  plan_bond_security?: string | null
  collect_daily_limit: number
  data_quality_min: number
  monthly_budget_krw: number
  alloc_equity_pct: number
  alloc_bond_pct: number
  alloc_cash_pct: number
  updated_at: string
}

export type DisclosureSourceType = 'sec_13f' | 'nbim_holdings' | 'factsheet' | 'site' | 'manual'

export interface InvDisclosure {
  disclosure_id: string
  manager_id: ManagerId
  source_id: string
  source_type: DisclosureSourceType
  doc_key: string
  form: string | null
  /** 공시 기준일(분기말 · 반기말 · 월말) */
  data_as_of: string
  /** 공개일(제출일) — 기준일과 따로 */
  source_published_at: string | null
  source_url: string
  is_amendment: boolean
  amendment_type: 'RESTATEMENT' | 'NEW HOLDINGS' | null
  amends_key: string | null
  coverage: string
  position_count: number | null
  total_value: number | null
  currency: string
  data_quality: number | null
  status: 'complete' | 'partial'
  is_demo: boolean
  ingested_at: string
}

export interface InvPosition {
  position_id?: number
  disclosure_id: string
  line_no: number
  holding_key: string
  issuer_name: string
  title_of_class: string | null
  cusip: string | null
  isin: string | null
  ticker: string | null
  security_id: string | null
  shares: number | null
  share_type: 'SH' | 'PRN' | null
  put_call: 'Put' | 'Call' | null
  value: number | null
  value_currency: string
  ownership_pct: number | null
  weight_pct: number | null
  country: string | null
  sector: string | null
  discretion: string | null
}

export interface InvChange {
  change_id?: number
  manager_id: ManagerId
  source_id: string
  from_disclosure: string | null
  to_disclosure: string
  holding_key: string
  security_id: string | null
  issuer_name: string
  cusip: string | null
  prev_shares: number | null
  split_factor: number
  prev_shares_adj: number | null
  cur_shares: number | null
  net_change: number | null
  change_pct: number | null
  prev_value: number | null
  cur_value: number | null
  prev_ownership_pct: number | null
  cur_ownership_pct: number | null
  status: ChangeStatus
  basis: 'shares' | 'presence'
  note: string | null
  calculation_version: string
  computed_at?: string
}

export type SecurityKind = 'stock' | 'etf' | 'fund' | 'fx' | 'index' | 'other'

export interface InvSecurity {
  security_id: string
  kind: SecurityKind
  name: string
  ticker: string | null
  exchange: string | null
  cusip: string | null
  isin: string | null
  figi: string | null
  cik: string | null
  currency: string
  country: string | null
  sector: string | null
  industry: string | null
  etf_issuer: string | null
  etf_index: string | null
  hedged: boolean | null
  benchmark_ticker: string | null
  watch: boolean
  watch_reason: string | null
  /** 0095 — 속한 산업(Market Score 출처). 0094 DB면 없음. */
  market_id?: string | null
  facts_checked_at: string | null
  prices_checked_at: string | null
  source: string
  source_url: string | null
  data_as_of: string | null
  is_demo: boolean
  updated_at: string
}

export type PriceSource = 'twelvedata' | 'sec13f_implied' | 'frankfurter' | 'manual'

export interface InvPrice {
  d: string
  close: number
  adj_close: number | null
  volume: number | null
  source: PriceSource
  source_url: string | null
}

export interface InvCorporateAction {
  action_id?: number
  security_id: string
  ex_date: string
  kind: 'split' | 'dividend'
  ratio: number | null
  amount: number | null
  currency: string | null
  source: 'twelvedata' | 'sec_xbrl' | 'manual'
  source_url: string
}

export interface InvFact {
  security_id: string
  cik: string
  taxonomy: 'us-gaap' | 'ifrs-full' | 'dei'
  concept: string
  unit: string
  period_start: string | null
  period_end: string
  period_key: string
  fy: number | null
  fp: string | null
  form: string | null
  filed: string | null
  accession: string
  frame: string | null
  value: number
  source_url: string
}

export interface InvMetric {
  security_id: string
  metric: string
  value: number | null
  text_value: string | null
  unit: string | null
  as_of: string
  source_type: 'sec_xbrl' | 'manual_official' | 'factsheet' | 'api' | 'derived'
  source_url: string
  note: string | null
}

export interface InvEtfHolding {
  security_id: string
  as_of: string
  line_no: number
  holding_name: string
  holding_ticker: string | null
  holding_cusip: string | null
  weight_pct: number | null
  shares: number | null
  source_type: 'issuer_file' | 'manual_official'
  source_url: string
}

export interface InvRun {
  run_id: number
  started_at: string
  finished_at: string | null
  trigger: 'cron' | 'manual' | 'test'
  calls: number
  ok: boolean | null
  steps: { step: string; ok: boolean; calls: number; note: string }[]
  note: string | null
}

/** 종목 한 줄의 기관 보유 — 4분기 추이 · 최신 판정. */
export interface InstitutionalRow {
  manager_id: ManagerId
  points: { as_of: string; shares: number | null; value: number | null; disclosure_id: string }[]
  latest: InvChange | null
}

// ── 0095 Future Markets · AI Investment Engine · Recommendations ──

export type MarketId = string
export type Classification = 'CONFIRMED' | 'INFERRED' | 'HYPOTHESIS' | 'UNKNOWN'
export type CreatedKind = 'human' | 'ai' | 'system'

export interface InvMarket {
  market_id: MarketId
  name: string
  name_ko: string | null
  description: string | null
  sort_order: number
}

export interface InvMarketSource {
  source_id: string
  market_id: MarketId
  publisher: string
  title: string
  url: string
  published_date: string | null
  verified: 'page' | 'snippet' | 'manual'
  note: string | null
}

export interface InvForecast {
  forecast_id?: number
  market_id: MarketId
  metric: 'market_size' | 'cagr' | 'historical_growth' | 'adoption' | 'penetration' | 'unit_cost' | 'profit_pool' | 'other'
  label: string
  year: number | null
  value: number | null
  unit: string | null
  text_value: string | null
  kind: 'actual' | 'forecast' | 'ai_assumption'
  source_id: string | null
  note: string | null
}

export interface InvValueChain {
  chain_id?: number
  market_id: MarketId
  segment: string
  size_value: number | null
  size_unit: string | null
  profitability: string | null
  barrier: string | null
  leaders: string[]
  source_id: string | null
  sort_order: number
}

export interface InvScoreRow {
  score_id?: number
  subject_type: 'market' | 'company'
  subject_id: string
  factor: string
  score: number
  method: 'formula' | 'judgment' | 'ai_estimate'
  raw_value: number | null
  raw_unit: string | null
  evidence: string
  source_url: string | null
  as_of: string | null
  data_quality: number | null
  model_version: string | null
  created_kind: CreatedKind
  created_at?: string
}

export interface InvPhilosophy {
  manager_id: ManagerId
  principle: string
  source_url: string
  document_date: string | null
  verified: boolean
  sort_order: number
}

export interface InvThesis {
  thesis_id?: string
  security_id: string | null
  manager_id: ManagerId | null
  kind: 'company' | 'manager_reason' | 'invalidation'
  statement: string
  classification: Classification
  state: 'active' | 'broken'
  source_url: string | null
  document_date: string | null
  model_version: string | null
  created_kind: CreatedKind
  created_at?: string
}

export interface InvEvidence {
  evidence_id?: number
  thesis_id: string
  label: string
  value_text: string
  source_url: string | null
  as_of: string | null
  created_kind: CreatedKind
}

export interface AssumptionValue {
  value: number | null
  source_url: string | null
  as_of: string | null
  quality: number | null
}

export type ScenarioInputs = Record<'fcf_per_share' | 'fcf_cagr' | 'exit_multiple' | 'required_return' | 'margin_of_safety', AssumptionValue>

export interface InvScenario {
  scenario_row_id?: number
  security_id: string
  scenario: 'bear' | 'base' | 'bull'
  inputs: ScenarioInputs
  years: number
  probability: number | null
  probability_is_ai: boolean
  premise: string | null
  risk: string | null
  created_kind: CreatedKind
  created_at?: string
}

export interface InvValuationRow {
  valuation_id?: number
  security_id: string
  scenario: 'bear' | 'base' | 'bull'
  scenario_row_id: number | null
  calculation_version: string
  inputs: Record<string, unknown>
  future_fcf_ps: number
  future_price: number
  present_value: number
  buy_price: number
  current_price: number | null
  price_as_of: string | null
  price_source: string | null
  upside_pct: number | null
  expected_cagr_pct: number | null
  created_kind: CreatedKind
  created_at?: string
}

export type RecStatusT = 'BUY ZONE' | 'WATCH' | 'OVERVALUED' | 'THESIS BROKEN' | 'NEED DATA'

export interface RecExplanation {
  why_company?: string
  why_market?: string
  why_now?: string
  buy_price?: string
  what_could_go_wrong?: string
  invalidation?: string
  source?: 'ai' | 'template'
}

export interface InvRecommendation {
  rec_id?: string
  security_id: string
  version: number
  status: RecStatusT
  market_id: MarketId | null
  market_score: number | null
  leader_score: number | null
  valuation_score: number | null
  institutional_signal: number | null
  opportunity_score: number | null
  data_quality: number | null
  current_price: number | null
  price_as_of: string | null
  buy_price: number | null
  gap_pct: number | null
  expected_return_5y: number | null
  checks: { key: string; label: string; pass: boolean; detail: string; required: boolean }[]
  inputs: Record<string, unknown>
  explanation: RecExplanation
  calculation_version: string
  model_version: string | null
  data_as_of: string | null
  created_kind: CreatedKind
  created_at?: string
}

export interface InvAlert {
  alert_id?: number
  kind: string
  severity: 'info' | 'warn' | 'critical'
  title: string
  body: string | null
  security_id: string | null
  manager_id: ManagerId | null
  link: string | null
  dedupe_key: string | null
  created_at?: string
  read_at?: string | null
}

export interface InvBrief {
  brief_id?: number
  brief_date: string
  content: Record<string, unknown>
  ai_summary: string | null
  data_as_of: string | null
  model_version: string | null
  created_kind: CreatedKind
  created_at?: string
}

export interface InvAiUsage {
  today_calls: number
  month_usd: number
  daily_limit: number
  monthly_limit: number
}

// ── 0096 DY Portfolio · Performance & Learning ──

export interface InvAccount {
  account_id: string
  name: string
  broker: string
  account_last4: string | null
  owner_entity: string
  currency: string
  opened_at: string | null
  note: string | null
}

export interface InvApproval {
  approval_id: string
  kind: 'monthly_plan' | 'trade' | 'plan_change'
  title: string
  amount_krw: number
  security_id: string | null
  side: 'buy' | 'sell' | null
  ea_doc_id: string
  rec_id: string | null
  created_at: string
  /** 결재 상태(investment_approval_states) */
  status?: 'draft' | 'in_progress' | 'rejected' | 'approved' | 'withdrawn' | null
  decided_at?: string | null
  doc_no?: string | null
  approver_name?: string | null
}

export type CorpTxKind = 'deposit' | 'withdraw' | 'buy' | 'sell' | 'dividend' | 'fee' | 'tax' | 'fx' | 'adjust'

export interface InvCorpTx {
  tx_id?: number
  account_id: string
  trade_date: string
  kind: CorpTxKind
  security_id: string | null
  shares: number | null
  price: number | null
  currency: string
  fx_rate: number | null
  amount: number
  amount_krw: number
  fees_krw: number
  tax_krw: number
  approval_id: string | null
  approved_by_name?: string | null
  approved_at?: string | null
  note: string | null
  entered_at?: string
}

export interface InvPaperPortfolio {
  portfolio_id: string
  name: string
  rule: string
  base_currency: string
  notional: number
  started_at: string
}

export interface InvPaperTx {
  tx_id?: number
  portfolio_id: string
  security_id: string
  side: 'buy' | 'sell'
  signal_at: string
  trade_date: string
  shares: number
  price: number
  price_source: string
  rec_id: string | null
  note: string | null
  created_kind: CreatedKind
  created_at?: string
}

export type FailureCause = 'market_forecast' | 'competitiveness' | 'earnings_cashflow' | 'buy_price_overestimated' | 'multiple_contraction' | 'macro' | 'fx' | 'data_error' | 'thesis_broken'

export interface InvOutcome {
  outcome_id?: number
  rec_id: string
  security_id: string
  horizon_months: 1 | 3 | 6 | 12 | 24 | 36 | 60
  entry_date: string | null
  entry_price: number | null
  exit_date: string | null
  exit_price: number | null
  return_pct: number | null
  benchmark_return_pct: number | null
  excess_pct: number | null
  delisted: boolean
  failure_cause: FailureCause | null
  cause_basis: 'human' | 'ai_inferred' | null
  note: string | null
  calculation_version: string
  created_kind: CreatedKind
  created_at?: string
}
