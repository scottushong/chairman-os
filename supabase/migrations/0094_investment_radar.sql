-- =====================================================================
-- Chairman OS — 0094_investment_radar (Investment Intelligence 1단계 — Investor Radar · Stock & ETF 360 원천)
-- 작성: 2026-10-25 · 지시 docs/specs/2026-10-24-investment-intelligence.txt · 설계 docs/specs/investment-design.md
--
-- ■ 왜 ■ (대표 지시 2026-10-24 «Investment Intelligence» PART 4 · 5 · 14 · 15)
--   글로벌 기관 네 곳(NBIM · Berkshire · Fundsmith · Pershing)의 공개 보유를 공시 단위로 쌓고, 공시 사이 순보유 변화를
--   NEW · ADD · TRIM · EXIT · HOLD · UNKNOWN으로 판정해 둔다. 종목 마스터 · 가격 · 기업행위(분할) · ETF 구성 · XBRL 재무 원천도 같이.
--   판정은 앱의 결정론 코드(lib/investment/changes.ts)가 하고, 이 표에는 결과와 판정 버전(calculation_version)을 남긴다.
--
-- ■ 권한 ■ (머리말 «권한 — 화면 숨김 · 서버 API · RLS 셋 다»)
--   inv_reader()    사람 · 활성 · 대표 또는 user_module_access '/investment' 지정자. 직원 · anon = 0행.
--   inv_collector() 활성 Integration 계정 = 수집 프로세스. 원천 표에만 insert/update.
--   inv_analyst()   활성 AIAgent 계정 = AI 분석 프로세스. 원천 표는 읽기만(restrictive로 쓰기 막음). 추천 표는 0095.
--   inv_admin()     대표. 손 입력(출처 · 기준일 필수) · 설정.
--   지우기(delete) grant는 없다 — 공시 · 판정 이력은 덧붙이기만. 수정공시는 새 줄(is_amendment).
--
-- ■ Expand-only ■ 새 표 · 새 함수 · 스위치 시드 줄만 더한다. 앞 번호 파일 · 표 · 칸은 건드리지 않는다(직전 코드가 이 DB 위에서 그대로 돈다).
-- 0035 규칙: force를 새로 걸지 않는다 · 새 정책 · grant는 늘 to authenticated.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 권한 손잡이
-- =====================================================================
create or replace function inv_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(is_active(), false) and coalesce(auth_role()::text, '') = 'Chairman';
$fn$;

create or replace function inv_reader() returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(is_active(), false)
     and coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration', '')
     and (
       auth_role()::text = 'Chairman'
       or exists (select 1 from user_module_access m where m.user_id = auth.uid() and m.module = '/investment')
     );
$fn$;

create or replace function inv_collector() returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(is_active(), false) and coalesce(auth_role()::text, '') = 'Integration';
$fn$;

create or replace function inv_analyst() returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(is_active(), false) and coalesce(auth_role()::text, '') = 'AIAgent';
$fn$;

revoke all on function inv_admin() from public, anon;
revoke all on function inv_reader() from public, anon;
revoke all on function inv_collector() from public, anon;
revoke all on function inv_analyst() from public, anon;
grant execute on function inv_admin() to authenticated;
grant execute on function inv_reader() to authenticated;
grant execute on function inv_collector() to authenticated;
grant execute on function inv_analyst() to authenticated;

-- =====================================================================
-- 2절. 설정 · 기관 · 수집 경로
-- =====================================================================
create table investment_settings (
  id                  smallint primary key default 1 check (id = 1),
  collect_daily_limit integer not null default 600 check (collect_daily_limit between 50 and 5000),  -- 외부 호출 하루 한도(전 경로 합)
  data_quality_min    integer not null default 70 check (data_quality_min between 0 and 100),       -- BUY ZONE 최소 데이터 품질
  monthly_budget_krw  bigint  not null default 1000000 check (monthly_budget_krw >= 0),             -- 월 투자 예정액(설정값 · 실측 아님)
  alloc_equity_pct    numeric(5, 2) not null default 60 check (alloc_equity_pct between 0 and 100),
  alloc_bond_pct      numeric(5, 2) not null default 30 check (alloc_bond_pct between 0 and 100),
  alloc_cash_pct      numeric(5, 2) not null default 10 check (alloc_cash_pct between 0 and 100),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  constraint investment_settings_alloc_sum check (alloc_equity_pct + alloc_bond_pct + alloc_cash_pct = 100)
);
insert into investment_settings (id) values (1);

create table investment_managers (
  manager_id     text primary key check (manager_id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name           text not null,
  operator       text not null,
  official_url   text not null,
  sec_cik        text check (sec_cik ~ '^[0-9]{10}$'),
  sec_filer_name text,
  style          text not null check (style in ('index', 'concentrated')),
  signal_weight  numeric(4, 2) not null default 1 check (signal_weight between 0 and 1),   -- 지수형(NBIM)은 낮은 확신 0.5
  coverage_note  text not null,
  sort_order     integer not null default 0
);
insert into investment_managers (manager_id, name, operator, official_url, sec_cik, sec_filer_name, style, signal_weight, coverage_note, sort_order) values
  ('nbim', 'Norway Government Pension Fund Global', 'Norges Bank Investment Management (NBIM)', 'https://www.nbim.no/en/investments', '0001374170', 'NORGES BANK', 'index', 0.5,
   '전체 보유 목록은 반기 공개(평가액 · 지분율 · 국가 · 업종, 주식 수 없음). 미국 상장분 주식 수는 SEC 13F(분기). 지수 기반 분산 투자 — 집중투자 기관보다 낮은 확신 신호.', 1),
  ('berkshire', 'Berkshire Hathaway', 'Berkshire Hathaway Inc.', 'https://www.berkshirehathaway.com', '0001067983', 'BERKSHIRE HATHAWAY INC', 'concentrated', 1,
   'SEC 13F 대상 미국 증권만(분기말 기준 · 통상 분기 종료 후 45일 안 공개). 현금 · 비상장 · 해외 직접 투자 · 공매도 · 일부 파생은 보이지 않는다 — Berkshire 전체 포트폴리오가 아니다.', 2),
  ('fundsmith', 'Fundsmith', 'Fundsmith LLP', 'https://www.fundsmith.co.uk', '0001569205', 'Fundsmith LLP', 'concentrated', 1,
   'SEC 13F(Fundsmith LLP, 미국 상장분 · 분기)와 공식 월간 Factsheet(상위 보유). 공개하지 않은 포지션은 추정하지 않는다.', 3),
  ('pershing', 'Pershing Square Holdings', 'Pershing Square Capital Management, L.P.', 'https://pershingsquareholdings.com', '0001336528', 'Pershing Square Capital Management, L.P.', 'concentrated', 1,
   'SEC 13F는 운용사(Pershing Square Capital Management) 전체의 미국 상장분이다 — PSH 펀드의 전체 포지션과 같지 않다. 공식 사이트 공개 포지션은 따로 적는다.', 4);

create table investment_sources (
  source_id       text primary key check (source_id ~ '^[a-z][a-z0-9_:.-]{2,60}$'),
  manager_id      text references investment_managers(manager_id) on delete restrict,
  label           text not null,
  kind            text not null check (kind in ('sec_13f', 'nbim_holdings', 'factsheet', 'site', 'sec_xbrl', 'openfigi', 'prices', 'fx', 'manual')),
  url             text not null,
  cadence         text not null,
  key_env         text,                                            -- 키가 필요한 경로의 환경변수 이름(값 아님)
  status          text not null default 'UNAVAILABLE' check (status in ('LIVE', 'PARTIAL', 'DEMO', 'UNAVAILABLE', 'DISABLED')),
  status_note     text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error      text,
  calls_day       date,
  calls_today     integer not null default 0 check (calls_today >= 0),
  updated_at      timestamptz not null default now()
);
insert into investment_sources (source_id, manager_id, label, kind, url, cadence, key_env, status, status_note) values
  ('sec13f:nbim', 'nbim', 'SEC 13F — Norges Bank', 'sec_13f', 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001374170&type=13F-HR', '분기', null, 'UNAVAILABLE', '첫 수집 전'),
  ('sec13f:berkshire', 'berkshire', 'SEC 13F — Berkshire Hathaway', 'sec_13f', 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001067983&type=13F-HR', '분기', null, 'UNAVAILABLE', '첫 수집 전'),
  ('sec13f:fundsmith', 'fundsmith', 'SEC 13F — Fundsmith LLP', 'sec_13f', 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001569205&type=13F-HR', '분기', null, 'UNAVAILABLE', '첫 수집 전'),
  ('sec13f:pershing', 'pershing', 'SEC 13F — Pershing Square Capital Management', 'sec_13f', 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001336528&type=13F-HR', '분기', null, 'UNAVAILABLE', '첫 수집 전'),
  ('nbim:holdings', 'nbim', 'NBIM 전체 보유 목록', 'nbim_holdings', 'https://www.nbim.no/en/investments/all-investments/', '반기', null, 'UNAVAILABLE', '첫 수집 전'),
  ('fundsmith:factsheet', 'fundsmith', 'Fundsmith Equity Fund 월간 Factsheet', 'factsheet', 'https://www.fundsmith.co.uk', '월', null, 'UNAVAILABLE', '공식 사이트가 자동 수집을 막는다(Cloudflare 확인 화면) — 대표 손 입력(출처 · 기준일 필수)'),
  ('pershing:site', 'pershing', 'Pershing Square Holdings 공식 사이트 공개 포지션', 'site', 'https://pershingsquareholdings.com', '수시', null, 'UNAVAILABLE', '공식 사이트가 자동 수집을 막는다(403) — 대표 손 입력(출처 · 기준일 필수)'),
  ('sec:xbrl', null, 'SEC XBRL companyfacts(기업 재무)', 'sec_xbrl', 'https://www.sec.gov/edgar/sec-api-documentation', '공시', null, 'UNAVAILABLE', '첫 수집 전'),
  ('openfigi', null, 'OpenFIGI — CUSIP → 티커', 'openfigi', 'https://www.openfigi.com/api', '필요할 때', 'OPENFIGI_API_KEY', 'UNAVAILABLE', '첫 수집 전(키 없이도 분당 25회)'),
  ('prices:twelvedata', null, 'Twelve Data — 주가 · ETF · 분할', 'prices', 'https://twelvedata.com/pricing', '일', 'TWELVEDATA_API_KEY', 'UNAVAILABLE', '키 필요: twelvedata.com 무료 Basic(하루 800 크레딧 · 분당 8회)'),
  ('prices:sec13f', null, '13F 평가액 ÷ 주식 수 = 분기말 파생 가격', 'prices', 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets', '분기', null, 'UNAVAILABLE', '첫 수집 전'),
  ('fx:frankfurter', null, 'ECB 기준환율(frankfurter)', 'fx', 'https://frankfurter.dev', '영업일', null, 'UNAVAILABLE', '첫 수집 전'),
  ('manual', null, '대표 손 입력(공식 자료 · 출처 필수)', 'manual', 'https://chairman-os-eosin.vercel.app/investment/sources', '수시', null, 'LIVE', null);

create table investment_collect_runs (
  run_id      bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  trigger     text not null check (trigger in ('cron', 'manual', 'test')),
  actor       uuid default auth.uid(),
  calls       integer not null default 0 check (calls >= 0),
  ok          boolean,
  steps       jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  note        text
);
create index investment_collect_runs_by_start on investment_collect_runs (started_at desc);

-- =====================================================================
-- 3절. 종목 마스터 · 가격 · 기업행위 · ETF · 재무
-- =====================================================================
create table securities (
  security_id      uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('stock', 'etf', 'fund', 'fx', 'index', 'other')),
  name             text not null check (length(btrim(name)) > 0),
  ticker           text check (ticker ~ '^[A-Z0-9.\-/:^=]{1,20}$'),
  exchange         text,
  cusip            text check (cusip ~ '^[0-9A-Z]{9}$'),
  isin             text check (isin ~ '^[A-Z]{2}[0-9A-Z]{9}[0-9]$'),
  figi             text check (figi ~ '^BBG[0-9A-Z]{9}$'),
  cik              text check (cik ~ '^[0-9]{10}$'),
  currency         text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  country          text,
  sector           text,
  industry         text,
  etf_issuer       text,
  etf_index        text,
  hedged           boolean,
  benchmark_ticker text,
  watch            boolean not null default false,
  watch_reason     text,
  facts_checked_at timestamptz,                 -- XBRL 재무를 마지막으로 확인한 때(하루 한도 안에서 돌려가며)
  prices_checked_at timestamptz,                -- 주가를 마지막으로 확인한 때
  source           text not null,
  source_url       text,
  data_as_of       date,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index securities_cusip_key on securities (cusip) where cusip is not null;
create unique index securities_fx_key on securities (ticker) where kind in ('fx', 'index');
create index securities_by_ticker on securities (ticker);

create table security_prices (
  security_id uuid not null references securities(security_id) on delete restrict,
  d           date not null,
  close       numeric not null check (close > 0),
  adj_close   numeric check (adj_close > 0),
  volume      numeric check (volume >= 0),
  source      text not null check (source in ('twelvedata', 'sec13f_implied', 'frankfurter', 'manual')),
  source_url  text,
  ingested_at timestamptz not null default now(),
  primary key (security_id, source, d)
);

create table security_corporate_actions (
  action_id   bigint generated always as identity primary key,
  security_id uuid not null references securities(security_id) on delete restrict,
  ex_date     date not null,
  kind        text not null check (kind in ('split', 'dividend')),
  ratio       numeric check (ratio > 0),                 -- 분할: 새 주식 수 / 옛 주식 수 (2:1 → 2)
  amount      numeric check (amount >= 0),               -- 배당: 주당 금액
  currency    text check (currency ~ '^[A-Z]{3}$'),
  source      text not null check (source in ('twelvedata', 'sec_xbrl', 'manual')),
  source_url  text not null,
  entered_by  uuid default auth.uid(),
  ingested_at timestamptz not null default now(),
  constraint security_corporate_actions_shape check ((kind = 'split' and ratio is not null) or (kind = 'dividend' and amount is not null)),
  unique (security_id, kind, ex_date, source)
);

create table etf_holdings (
  security_id    uuid not null references securities(security_id) on delete restrict,
  as_of          date not null,
  line_no        integer not null check (line_no > 0),
  holding_name   text not null,
  holding_ticker text,
  holding_cusip  text,
  holding_isin   text,
  weight_pct     numeric check (weight_pct between -100 and 100),
  shares         numeric,
  source_type    text not null check (source_type in ('issuer_file', 'manual_official')),
  source_url     text not null,
  ingested_at    timestamptz not null default now(),
  primary key (security_id, as_of, line_no)
);

create table company_financials (
  fact_id      bigint generated always as identity primary key,
  security_id  uuid not null references securities(security_id) on delete restrict,
  cik          text not null check (cik ~ '^[0-9]{10}$'),
  taxonomy     text not null check (taxonomy in ('us-gaap', 'ifrs-full', 'dei')),
  concept      text not null,
  unit         text not null,
  period_start date,
  period_end   date not null,
  period_key   text not null,          -- «시작|끝» (시작 없으면 «|끝») — 같은 기간의 공시번호별 이력을 겹치지 않게
  fy           integer,
  fp           text,
  form         text,
  filed        date,
  accession    text not null,
  frame        text,
  value        numeric not null,
  source_url   text not null,
  ingested_at  timestamptz not null default now(),
  unique (security_id, taxonomy, concept, unit, period_key, accession)
);
create index company_financials_by_concept on company_financials (security_id, concept, period_end desc);

create table company_metrics (
  metric_id   bigint generated always as identity primary key,
  security_id uuid not null references securities(security_id) on delete restrict,
  metric      text not null check (metric ~ '^[a-z][a-z0-9_]{1,40}$'),
  value       numeric,
  text_value  text,
  unit        text,
  as_of       date not null,
  source_type text not null check (source_type in ('sec_xbrl', 'manual_official', 'factsheet', 'api', 'derived')),
  source_url  text not null,
  note        text,
  entered_by  uuid default auth.uid(),
  ingested_at timestamptz not null default now(),
  constraint company_metrics_value check (value is not null or text_value is not null),
  unique (security_id, metric, as_of, source_type)
);

-- =====================================================================
-- 4절. 공시 · 보유 · 변화
-- =====================================================================
create table investment_disclosures (
  disclosure_id       uuid primary key default gen_random_uuid(),
  manager_id          text not null references investment_managers(manager_id) on delete restrict,
  source_id           text not null references investment_sources(source_id) on delete restrict,
  source_type         text not null check (source_type in ('sec_13f', 'nbim_holdings', 'factsheet', 'site', 'manual')),
  doc_key             text not null check (length(doc_key) between 3 and 120),   -- 13F 접수번호 · NBIM 기준일 등
  form                text,
  data_as_of          date not null,             -- 공시 기준일(분기말 · 반기말 · 월말)
  source_published_at date,                      -- 공개일(제출일) — 기준일과 따로
  source_url          text not null,
  is_amendment        boolean not null default false,
  amendment_type      text check (amendment_type in ('RESTATEMENT', 'NEW HOLDINGS')),
  amends_key          text,
  coverage            text not null,
  position_count      integer check (position_count >= 0),
  total_value         numeric,
  currency            text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  data_quality        integer check (data_quality between 0 and 100),
  status              text not null default 'complete' check (status in ('complete', 'partial')),
  is_demo             boolean not null default false,
  entered_by          uuid default auth.uid(),
  ingested_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (source_id, doc_key)
);
create index investment_disclosures_by_manager on investment_disclosures (manager_id, data_as_of desc);

create table investment_positions (
  position_id   bigint generated always as identity primary key,
  disclosure_id uuid not null references investment_disclosures(disclosure_id) on delete restrict,
  line_no       integer not null check (line_no > 0),
  holding_key   text not null,               -- CUSIP(13F) · NBIM id · 손 입력은 티커/이름
  issuer_name   text not null,
  title_of_class text,
  cusip         text check (cusip ~ '^[0-9A-Z]{9}$'),
  isin          text,
  ticker        text,
  security_id   uuid references securities(security_id) on delete restrict,
  shares        numeric check (shares >= 0),
  share_type    text check (share_type in ('SH', 'PRN')),
  put_call      text check (put_call in ('Put', 'Call')),
  value         numeric,
  value_currency text not null default 'USD' check (value_currency ~ '^[A-Z]{3}$'),
  ownership_pct numeric,
  weight_pct    numeric,
  country       text,
  sector        text,
  discretion    text,
  unique (disclosure_id, line_no)
);
create index investment_positions_by_key on investment_positions (holding_key);
create index investment_positions_by_security on investment_positions (security_id);

create table investment_position_changes (
  change_id           bigint generated always as identity primary key,
  manager_id          text not null references investment_managers(manager_id) on delete restrict,
  source_id           text not null references investment_sources(source_id) on delete restrict,
  from_disclosure     uuid references investment_disclosures(disclosure_id) on delete restrict,
  to_disclosure       uuid not null references investment_disclosures(disclosure_id) on delete restrict,
  holding_key         text not null,
  security_id         uuid references securities(security_id) on delete restrict,
  issuer_name         text not null,
  cusip               text,
  prev_shares         numeric,
  split_factor        numeric not null default 1 check (split_factor > 0),
  prev_shares_adj     numeric,
  cur_shares          numeric,
  net_change          numeric,
  change_pct          numeric,
  prev_value          numeric,
  cur_value           numeric,
  prev_ownership_pct  numeric,
  cur_ownership_pct   numeric,
  status              text not null check (status in ('NEW', 'ADD', 'TRIM', 'EXIT', 'HOLD', 'UNKNOWN')),
  basis               text not null check (basis in ('shares', 'presence')),
  note                text,
  calculation_version text not null,
  computed_at         timestamptz not null default now(),
  unique (to_disclosure, holding_key, calculation_version)
);
create index investment_position_changes_by_manager on investment_position_changes (manager_id, computed_at desc);
create index investment_position_changes_by_security on investment_position_changes (security_id);

-- =====================================================================
-- 5절. 감사(덧붙이기만)
-- =====================================================================
create table investment_audit_logs (
  log_id     bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_role text,
  action     text not null check (action ~ '^[a-z][a-z0-9_.]{2,60}$'),
  entity     text not null,
  entity_id  text,
  detail     jsonb not null default '{}'::jsonb
);
create index investment_audit_logs_by_at on investment_audit_logs (at desc);

create or replace function investment_audit_stamp() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  new.at := now();
  new.actor := auth.uid();
  new.actor_role := auth_role()::text;
  return new;
end
$fn$;
create trigger investment_audit_logs_stamp before insert on investment_audit_logs
  for each row execute function investment_audit_stamp();
revoke all on function investment_audit_stamp() from public, anon, authenticated;

-- =====================================================================
-- 6절. RLS · grant
-- =====================================================================
do $$
declare
  t text;
begin
  -- 원천 표: 읽기 = 대표 · 지정자 · 수집 · AI 분석 / 쓰기(insert · update) = 수집 · 대표 / 지우기 없음
  foreach t in array array[
    'investment_sources', 'investment_collect_runs', 'securities', 'security_prices', 'security_corporate_actions',
    'etf_holdings', 'company_financials', 'company_metrics', 'investment_disclosures', 'investment_positions',
    'investment_position_changes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (inv_reader() or inv_collector() or inv_analyst())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (inv_collector() or inv_admin())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (inv_collector() or inv_admin()) with check (inv_collector() or inv_admin())', t || '_update', t);
    -- AI 분석 계정은 원천을 못 쓴다(0013 restrictive — 뒤에 permissive가 늘어도 AND로 막힌다)
    execute format('create policy ai_agent_no_insert on public.%I as restrictive for insert to authenticated with check (auth_role() is distinct from %L)', t, 'AIAgent');
    execute format('create policy ai_agent_no_update on public.%I as restrictive for update to authenticated using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)', t, 'AIAgent', 'AIAgent');
  end loop;
end
$$;

-- 설정 · 기관: 읽기 = 대표 · 지정자 · 수집 · AI / 고치기 = 대표만(행은 시드)
alter table investment_settings enable row level security;
alter table investment_managers enable row level security;
revoke all on table investment_settings from public, anon, authenticated;
revoke all on table investment_managers from public, anon, authenticated;
grant select, update on table investment_settings to authenticated;
grant select, update on table investment_managers to authenticated;
create policy investment_settings_read on investment_settings for select to authenticated using (inv_reader() or inv_collector() or inv_analyst());
create policy investment_settings_update on investment_settings for update to authenticated using (inv_admin()) with check (inv_admin());
create policy investment_managers_read on investment_managers for select to authenticated using (inv_reader() or inv_collector() or inv_analyst());
create policy investment_managers_update on investment_managers for update to authenticated using (inv_admin()) with check (inv_admin());

-- 감사: 누구나 자기 이름으로 덧붙이기(대표 · 지정자 · 수집 · AI) / 읽기 = 대표 · 지정자
alter table investment_audit_logs enable row level security;
revoke all on table investment_audit_logs from public, anon, authenticated;
grant select, insert on table investment_audit_logs to authenticated;
create policy investment_audit_logs_read on investment_audit_logs for select to authenticated using (inv_reader());
create policy investment_audit_logs_insert on investment_audit_logs for insert to authenticated
  with check (inv_reader() or inv_collector() or inv_analyst());

-- 이 블록의 시퀀스만(기존 표의 시퀀스 권한은 건드리지 않는다)
do $$
declare
  s text;
begin
  foreach s in array array[
    'investment_collect_runs_run_id_seq', 'security_corporate_actions_action_id_seq', 'company_financials_fact_id_seq',
    'company_metrics_metric_id_seq', 'investment_positions_position_id_seq', 'investment_position_changes_change_id_seq',
    'investment_audit_logs_log_id_seq'
  ] loop
    execute format('revoke all on sequence public.%I from public, anon', s);
    execute format('grant usage, select on sequence public.%I to authenticated', s);
  end loop;
end
$$;

-- =====================================================================
-- 7절. 기능 스위치 investment(기본 대표만 — 화면 노출만. 판정은 위 RLS)
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'investment', true, 'chairman', '기본값(0094)')
on conflict do nothing;

commit;
