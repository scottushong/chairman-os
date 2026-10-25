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
