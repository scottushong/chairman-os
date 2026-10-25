-- =====================================================================
-- Chairman OS — 0095_investment_engine (Investment Intelligence 2단계 — Future Markets · AI Investment Engine · Recommendations)
-- 작성: 2026-10-25 · 지시 docs/specs/2026-10-24-investment-intelligence.txt PART 6~11 · 설계 docs/specs/investment-design.md
--
-- ■ 더하는 것 ■ (Expand-only — 새 표 · 새 칸(기본값 있음) · 새 함수 · 스위치 줄. 앞 번호는 건드리지 않는다)
--   1절 설정 칸 — 점수 가중치(관리자 설정) · AI 한도(하루 20회 · 월 $30)
--   2절 산업(future_markets · market_research_sources · market_forecasts · market_value_chains) — 숫자는 출처 · 발표일과 함께, 실측/전망/AI 가정 구분
--   3절 점수 입력(investment_scores) · 기관 철학(investment_manager_philosophy) · 가설/근거(investment_theses · investment_thesis_evidence)
--   4절 시나리오(investment_scenarios) · 가치평가 스냅숏(investment_valuations) · 추천(investment_recommendations) · 알림 · 브리핑
--   5절 AI 예약(investment_ai_reservations · investment_ai_reserve · investment_ai_finish) — 서버에서 원자적으로, 동시 호출 · 재시도 포함
--   6절 RLS — 분석 표: 읽기 대표 · 지정자 · AI / 쓰기 AI(INSERT만) · 대표. 수집 계정(Integration)은 0행 · 쓰기 거부.
--        추천 · 가치평가 · 가설 · 근거 · 점수 · 시나리오 · 브리핑은 UPDATE · DELETE가 없다(grant 없음 + 트리거) — 재분석은 새 버전 줄.
--   7절 스위치 investment_ai(기본 대표 켬 — check:investment-ai-cap 통과 뒤에만 배포)
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 설정 칸(새 칸 · 기본값 — 옛 코드는 이 칸을 모른다)
-- =====================================================================
alter table investment_settings
  add column w_market_demand     numeric(5, 2) not null default 25,
  add column w_market_profit     numeric(5, 2) not null default 20,
  add column w_market_adoption   numeric(5, 2) not null default 20,
  add column w_market_bottleneck numeric(5, 2) not null default 20,
  add column w_market_durability numeric(5, 2) not null default 15,
  add column w_leader_share      numeric(5, 2) not null default 25,
  add column w_leader_moat       numeric(5, 2) not null default 25,
  add column w_leader_cash       numeric(5, 2) not null default 20,
  add column w_leader_balance    numeric(5, 2) not null default 15,
  add column w_leader_mgmt       numeric(5, 2) not null default 15,
  add column w_opp_market        numeric(5, 2) not null default 30,
  add column w_opp_leader        numeric(5, 2) not null default 35,
  add column w_opp_valuation     numeric(5, 2) not null default 30,
  add column w_opp_inst          numeric(5, 2) not null default 5,
  add column ai_daily_calls      integer not null default 20 check (ai_daily_calls between 0 and 200),
  add column ai_monthly_usd      numeric(8, 2) not null default 30 check (ai_monthly_usd between 0 and 500);
alter table investment_settings
  add constraint investment_settings_w_market check (w_market_demand + w_market_profit + w_market_adoption + w_market_bottleneck + w_market_durability = 100),
  add constraint investment_settings_w_leader check (w_leader_share + w_leader_moat + w_leader_cash + w_leader_balance + w_leader_mgmt = 100),
  add constraint investment_settings_w_opp check (w_opp_market + w_opp_leader + w_opp_valuation + w_opp_inst = 100);

-- 분석 손잡이 — 사람(대표 · 지정자) 또는 AI 분석 계정. 수집 계정은 아니다.
create or replace function inv_analysis_reader() returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select inv_reader() or inv_analyst();
$fn$;
revoke all on function inv_analysis_reader() from public, anon;
grant execute on function inv_analysis_reader() to authenticated;

-- =====================================================================
-- 2절. 산업
-- =====================================================================
create table future_markets (
  market_id   text primary key check (market_id ~ '^[a-z][a-z0-9_]{1,40}$'),
  name        text not null,
  name_ko     text,
  description text,
  sort_order  integer not null default 0,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
insert into future_markets (market_id, name, name_ko, sort_order) values
  ('ai_infra', 'AI Infrastructure', 'AI 인프라', 1),
  ('robotics', 'Robotics & Humanoid', '로보틱스 · 휴머노이드', 2),
  ('healthcare', 'Healthcare & Longevity', '헬스케어 · 장수', 3),
  ('energy', 'Energy & Power Infrastructure', '에너지 · 전력 인프라', 4),
  ('materials', 'Advanced Materials & Manufacturing', '첨단 소재 · 제조', 5);

-- 종목이 속한 산업(Opportunity의 Market Score를 어느 산업에서 가져오나). 새 칸 — 옛 코드는 모른다.
alter table securities add column market_id text references future_markets(market_id) on delete restrict;

create table market_research_sources (
  source_id      uuid primary key default gen_random_uuid(),
  market_id      text not null references future_markets(market_id) on delete restrict,
  publisher      text not null,
  title          text not null,
  url            text not null check (url ~ '^https://'),
  published_date date,                         -- 발표일(모르면 null — 화면이 «발표일 미상»)
  verified       text not null default 'page' check (verified in ('page', 'snippet', 'manual')),
  note           text,
  entered_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (market_id, url)
);

create table market_forecasts (
  forecast_id bigint generated always as identity primary key,
  market_id   text not null references future_markets(market_id) on delete restrict,
  metric      text not null check (metric in ('market_size', 'cagr', 'historical_growth', 'adoption', 'penetration', 'unit_cost', 'profit_pool', 'other')),
  label       text not null,
  year        integer check (year between 2000 and 2100),
  value       numeric,
  unit        text,
  text_value  text,
  kind        text not null check (kind in ('actual', 'forecast', 'ai_assumption')),
  source_id   uuid references market_research_sources(source_id) on delete restrict,
  note        text,
  entered_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  -- 실측 · 전망은 출처가 있어야 한다(출처 없는 숫자를 실측으로 표시하지 않는다 — 원문 6.1). AI 가정만 출처 없이 둘 수 있다.
  constraint market_forecasts_source check (kind = 'ai_assumption' or source_id is not null),
  constraint market_forecasts_value check (value is not null or text_value is not null)
);
create index market_forecasts_by_market on market_forecasts (market_id, metric);

create table market_value_chains (
  chain_id    bigint generated always as identity primary key,
  market_id   text not null references future_markets(market_id) on delete restrict,
  segment     text not null,
  size_value  numeric,
  size_unit   text,
  profitability text,
  barrier     text,
  leaders     text[] not null default '{}',
  source_id   uuid references market_research_sources(source_id) on delete restrict,
  sort_order  integer not null default 0,
  entered_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- 3절. 점수 입력 · 기관 철학 · 가설/근거 (덧붙이기만)
-- =====================================================================
create table investment_scores (
  score_id     bigint generated always as identity primary key,
  subject_type text not null check (subject_type in ('market', 'company')),
  subject_id   text not null,                       -- market_id 또는 security_id
  factor       text not null check (factor in ('demand_growth', 'profit_pool', 'adoption', 'bottleneck', 'durability', 'market_share', 'moat', 'cash_flow', 'balance_sheet', 'management')),
  score        numeric(6, 2) not null check (score between 0 and 100),
  method       text not null check (method in ('formula', 'judgment', 'ai_estimate')),
  raw_value    numeric,
  raw_unit     text,
  evidence     text not null check (length(btrim(evidence)) >= 4),
  source_url   text check (source_url ~ '^https://'),
  as_of        date,
  data_quality integer check (data_quality between 0 and 100),
  model_version text,
  created_by   uuid default auth.uid(),
  created_kind text not null default 'human' check (created_kind in ('human', 'ai', 'system')),
  created_at   timestamptz not null default now(),
  constraint investment_scores_ai check (created_kind <> 'ai' or method = 'ai_estimate')
);
create index investment_scores_by_subject on investment_scores (subject_type, subject_id, factor, created_at desc);

create table investment_manager_philosophy (
  philosophy_id bigint generated always as identity primary key,
  manager_id    text not null references investment_managers(manager_id) on delete restrict,
  principle     text not null,
  source_url    text not null check (source_url ~ '^https://'),
  document_date date,
  verified      boolean not null default false,      -- 공식 문서 문장을 대조했나(대표가 확인하면 새 줄)
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
insert into investment_manager_philosophy (manager_id, principle, source_url, sort_order) values
  ('nbim', '장기 투자', 'https://www.nbim.no/en/the-fund/', 1),
  ('nbim', '분산투자', 'https://www.nbim.no/en/the-fund/', 2),
  ('nbim', '자산배분', 'https://www.nbim.no/en/the-fund/', 3),
  ('nbim', '리스크 관리', 'https://www.nbim.no/en/the-fund/', 4),
  ('nbim', '투자 대상의 지속가능성', 'https://www.nbim.no/en/responsible-investment/', 5),
  ('berkshire', '기업 내재가치', 'https://www.berkshirehathaway.com/ownman.pdf', 1),
  ('berkshire', '장기 현금창출력', 'https://www.berkshirehathaway.com/ownman.pdf', 2),
  ('berkshire', '경쟁우위', 'https://www.berkshirehathaway.com/letters/letters.html', 3),
  ('berkshire', '자본배분', 'https://www.berkshirehathaway.com/ownman.pdf', 4),
  ('berkshire', '합리적인 매수가', 'https://www.berkshirehathaway.com/letters/letters.html', 5),
  ('fundsmith', '고품질 기업', 'https://www.fundsmith.co.uk', 1),
  ('fundsmith', '높은 자본수익률', 'https://www.fundsmith.co.uk', 2),
  ('fundsmith', '복제하기 어려운 경쟁력', 'https://www.fundsmith.co.uk', 3),
  ('fundsmith', '적정 가격', 'https://www.fundsmith.co.uk', 4),
  ('fundsmith', '장기 보유', 'https://www.fundsmith.co.uk', 5),
  ('pershing', '높은 품질의 기업', 'https://pershingsquareholdings.com', 1),
  ('pershing', '예측 가능한 현금흐름', 'https://pershingsquareholdings.com', 2),
  ('pershing', '강한 진입장벽', 'https://pershingsquareholdings.com', 3),
  ('pershing', '경영 및 사업구조 개선', 'https://pershingsquareholdings.com', 4),
  ('pershing', '집중투자', 'https://pershingsquareholdings.com', 5);

create table investment_theses (
  thesis_id      uuid primary key default gen_random_uuid(),
  security_id    uuid references securities(security_id) on delete restrict,
  manager_id     text references investment_managers(manager_id) on delete restrict,
  kind           text not null check (kind in ('company', 'manager_reason', 'invalidation')),
  statement      text not null check (length(btrim(statement)) >= 4),
  classification text not null check (classification in ('CONFIRMED', 'INFERRED', 'HYPOTHESIS', 'UNKNOWN')),
  state          text not null default 'active' check (state in ('active', 'broken')),
  source_url     text check (source_url ~ '^https://'),
  document_date  date,
  supersedes     uuid references investment_theses(thesis_id) on delete restrict,
  model_version  text,
  created_by     uuid default auth.uid(),
  created_kind   text not null default 'human' check (created_kind in ('human', 'ai', 'system')),
  created_at     timestamptz not null default now(),
  -- CONFIRMED는 공식 문서(출처 · 문서 기준일)가 있어야 하고, AI는 CONFIRMED를 붙이지 못한다(원문 11).
  constraint investment_theses_confirmed check (classification <> 'CONFIRMED' or (source_url is not null and document_date is not null and created_kind = 'human')),
  constraint investment_theses_subject check (security_id is not null or manager_id is not null)
);
create index investment_theses_by_security on investment_theses (security_id, created_at desc);

create table investment_thesis_evidence (
  evidence_id  bigint generated always as identity primary key,
  thesis_id    uuid not null references investment_theses(thesis_id) on delete restrict,
  label        text not null,
  value_text   text not null,
  source_url   text check (source_url ~ '^https://'),
  as_of        date,
  created_by   uuid default auth.uid(),
  created_kind text not null default 'human' check (created_kind in ('human', 'ai', 'system')),
  created_at   timestamptz not null default now()
);

-- =====================================================================
-- 4절. 시나리오 · 가치평가 · 추천 · 알림 · 브리핑 (덧붙이기만 — 알림의 «읽음»만 고친다)
-- =====================================================================
create table investment_scenarios (
  scenario_row_id bigint generated always as identity primary key,
  security_id   uuid not null references securities(security_id) on delete restrict,
  scenario      text not null check (scenario in ('bear', 'base', 'bull')),
  -- 가정 다섯 + 기간. inputs = { fcf_per_share | fcf_cagr | exit_multiple | required_return | margin_of_safety : { value, source_url, as_of, quality } }
  inputs        jsonb not null check (jsonb_typeof(inputs) = 'object'),
  years         integer not null default 5 check (years between 1 and 20),
  probability   numeric(5, 2) check (probability between 0 and 100),
  probability_is_ai boolean not null default false,
  premise       text,
  risk          text,
  created_by    uuid default auth.uid(),
  created_kind  text not null default 'human' check (created_kind in ('human', 'ai', 'system')),
  created_at    timestamptz not null default now(),
  constraint investment_scenarios_prob check (probability is null or created_kind = 'human' or probability_is_ai)
);
create index investment_scenarios_by_security on investment_scenarios (security_id, scenario, created_at desc);

create table investment_valuations (
  valuation_id        bigint generated always as identity primary key,
  security_id         uuid not null references securities(security_id) on delete restrict,
  scenario            text not null check (scenario in ('bear', 'base', 'bull')),
  scenario_row_id     bigint references investment_scenarios(scenario_row_id) on delete restrict,
  calculation_version text not null,
  inputs              jsonb not null check (jsonb_typeof(inputs) = 'object'),
  future_fcf_ps       numeric not null,
  future_price        numeric not null,
  present_value       numeric not null,
  buy_price           numeric not null,
  current_price       numeric,
  price_as_of         date,
  price_source        text,
  upside_pct          numeric,
  expected_cagr_pct   numeric,
  created_by          uuid default auth.uid(),
  created_kind        text not null default 'system' check (created_kind in ('human', 'ai', 'system')),
  created_at          timestamptz not null default now()
);
create index investment_valuations_by_security on investment_valuations (security_id, created_at desc);

create table investment_recommendations (
  rec_id              uuid primary key default gen_random_uuid(),
  security_id         uuid not null references securities(security_id) on delete restrict,
  version             integer not null check (version >= 1),
  status              text not null check (status in ('BUY ZONE', 'WATCH', 'OVERVALUED', 'THESIS BROKEN', 'NEED DATA')),
  market_id           text references future_markets(market_id) on delete restrict,
  market_score        numeric(6, 2),
  leader_score        numeric(6, 2),
  valuation_score     numeric(6, 2),
  institutional_signal numeric(6, 2),                 -- null = UNKNOWN
  opportunity_score   numeric(6, 2),
  data_quality        integer check (data_quality between 0 and 100),
  current_price       numeric,
  price_as_of         date,
  buy_price           numeric,
  gap_pct             numeric,
  expected_return_5y  numeric,
  checks              jsonb not null check (jsonb_typeof(checks) = 'array'),
  inputs              jsonb not null check (jsonb_typeof(inputs) = 'object'),   -- 추천 시점 입력 전부(불변 이력)
  explanation         jsonb not null default '{}'::jsonb check (jsonb_typeof(explanation) = 'object'),
  calculation_version text not null,
  model_version       text,
  data_as_of          date,
  created_by          uuid default auth.uid(),
  created_kind        text not null check (created_kind in ('human', 'ai', 'system')),
  created_at          timestamptz not null default now(),
  unique (security_id, version)
);
create index investment_recommendations_by_security on investment_recommendations (security_id, version desc);

/** BUY ZONE은 system 판정 줄이 조건을 전부 통과했을 때만(머리말 «AI는 BUY를 붙일 수 없다»). */
create or replace function investment_recommendation_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $fn$
begin
  if new.status = 'BUY ZONE' then
    if new.created_kind <> 'system' then
      raise exception 'investment_buy_only_system' using errcode = '42501';
    end if;
    if exists (select 1 from jsonb_array_elements(new.checks) c where coalesce((c ->> 'pass')::boolean, false) = false) or jsonb_array_length(new.checks) = 0 then
      raise exception 'investment_buy_checks_failed' using errcode = '23514';
    end if;
  end if;
  return new;
end
$fn$;
create trigger investment_recommendations_guard before insert on investment_recommendations
  for each row execute function investment_recommendation_guard();

create table investment_alerts (
  alert_id    bigint generated always as identity primary key,
  kind        text not null check (kind ~ '^[a-z][a-z0-9_.]{2,60}$'),
  severity    text not null default 'info' check (severity in ('info', 'warn', 'critical')),
  title       text not null,
  body        text,
  security_id uuid references securities(security_id) on delete restrict,
  manager_id  text references investment_managers(manager_id) on delete restrict,
  link        text check (link ~ '^/investment'),
  dedupe_key  text unique,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index investment_alerts_by_created on investment_alerts (created_at desc);

create table investment_briefs (
  brief_id      bigint generated always as identity primary key,
  brief_date    date not null,
  content       jsonb not null check (jsonb_typeof(content) = 'object'),   -- 결정론 항목(1~10)
  ai_summary    text,
  data_as_of    date,
  model_version text,
  created_by    uuid default auth.uid(),
  created_kind  text not null check (created_kind in ('human', 'ai', 'system')),
  created_at    timestamptz not null default now()
);
create index investment_briefs_by_date on investment_briefs (brief_date desc, created_at desc);

/** 덧붙이기만 — 소유자(마이그레이션)도 UPDATE · DELETE를 못 하게 트리거로 한 번 더(grant가 없어도). */
create or replace function investment_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $fn$
begin
  raise exception 'investment_append_only: % 는 고치거나 지울 수 없다 — 새 버전 줄을 넣는다', tg_table_name using errcode = '42501';
end
$fn$;

-- =====================================================================
-- 5절. AI 예약 — 하루 호출 수 · 월 비용을 서버에서 원자적으로
-- =====================================================================
create table investment_ai_reservations (
  res_id        bigint generated always as identity primary key,
  kind          text not null check (kind ~ '^[a-z][a-z0-9_.]{2,40}$'),
  est_usd       numeric(10, 6) not null check (est_usd > 0),
  actual_usd    numeric(10, 6) check (actual_usd >= 0),
  model         text,
  input_tokens  integer,
  output_tokens integer,
  status        text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  actor         uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index investment_ai_reservations_by_created on investment_ai_reservations (created_at desc);

/**
 * 예약 — 하루(서울) 호출 수 < ai_daily_calls 이고 이번 달(서울) 비용(끝난 것은 실제 · 진행 중은 예상) + 이번 예상 ≤ ai_monthly_usd일 때만.
 * advisory lock으로 동시 호출 · 재시도가 한도를 같이 넘지 못한다. 한도면 'investment_ai_limit_day' · 'investment_ai_limit_month'(55P03).
 */
create or replace function investment_ai_reserve(p_kind text, p_est_usd numeric) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_calls int;
  v_month numeric;
  v_s     investment_settings;
  v_id    bigint;
begin
  if not (inv_admin() or inv_analyst()) then
    raise exception 'investment_ai_denied' using errcode = '42501';
  end if;
  if p_est_usd is null or p_est_usd <= 0 or p_est_usd > 5 then
    raise exception 'investment_ai_bad_estimate' using errcode = '22023';
  end if;
  if not feature_on('investment_ai') and not inv_analyst() then
    raise exception 'investment_ai_off' using errcode = '55P03';
  end if;
  if not exists (select 1 from feature_switches where feature_key = 'investment_ai' and business_id is null and enabled) then
    raise exception 'investment_ai_off' using errcode = '55P03';
  end if;
  perform pg_advisory_xact_lock(hashtext('investment_ai_reservations'));
  select * into v_s from investment_settings where id = 1;
  select count(*) into v_calls from investment_ai_reservations
   where (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;
  if v_calls >= v_s.ai_daily_calls then
    raise exception 'investment_ai_limit_day' using errcode = '55P03';
  end if;
  select coalesce(sum(case when status = 'done' then actual_usd when status = 'reserved' then est_usd else coalesce(actual_usd, est_usd) end), 0) into v_month
    from investment_ai_reservations
   where date_trunc('month', created_at at time zone 'Asia/Seoul') = date_trunc('month', now() at time zone 'Asia/Seoul');
  if v_month + p_est_usd > v_s.ai_monthly_usd then
    raise exception 'investment_ai_limit_month' using errcode = '55P03';
  end if;
  insert into investment_ai_reservations (kind, est_usd) values (p_kind, p_est_usd) returning res_id into v_id;
  return v_id;
end
$fn$;

/** 끝 — 실제 사용량을 적는다(예약한 사람만). 실패도 호출 한 번으로 남는다(비용은 실제 값 · 모르면 예상 값으로 센다). */
create or replace function investment_ai_finish(p_res bigint, p_status text, p_actual_usd numeric, p_model text, p_in integer, p_out integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if p_status not in ('done', 'failed') then
    raise exception 'investment_ai_bad_status' using errcode = '22023';
  end if;
  update investment_ai_reservations
     set status = p_status, actual_usd = p_actual_usd, model = p_model, input_tokens = p_in, output_tokens = p_out, finished_at = now()
   where res_id = p_res and actor = auth.uid() and status = 'reserved';
  if not found then
    raise exception 'investment_ai_unknown_reservation' using errcode = '42501';
  end if;
end
$fn$;

revoke all on function investment_ai_reserve(text, numeric) from public, anon;
revoke all on function investment_ai_finish(bigint, text, numeric, text, integer, integer) from public, anon;
grant execute on function investment_ai_reserve(text, numeric) to authenticated;
grant execute on function investment_ai_finish(bigint, text, numeric, text, integer, integer) to authenticated;

-- =====================================================================
-- 6절. RLS · grant
-- =====================================================================
-- 산업 표 — 읽기 대표 · 지정자 · AI / 쓰기(insert · update) 대표만. 수집 계정 0행.
do $$
declare
  t text;
begin
  foreach t in array array['future_markets', 'market_research_sources', 'market_forecasts', 'market_value_chains', 'investment_manager_philosophy'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (inv_analysis_reader())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (inv_admin())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (inv_admin()) with check (inv_admin())', t || '_update', t);
  end loop;

  -- 분석 이력 표 — 읽기 대표 · 지정자 · AI / INSERT만(AI · 대표) / UPDATE · DELETE 없음(+ 트리거)
  foreach t in array array['investment_scores', 'investment_theses', 'investment_thesis_evidence', 'investment_scenarios', 'investment_valuations', 'investment_recommendations', 'investment_briefs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (inv_analysis_reader())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((inv_admin() or inv_analyst()) and created_by = auth.uid())', t || '_insert', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function investment_append_only()', t || '_append_only', t);
  end loop;

  -- 수집 계정은 분석 · 산업 표 전부 0행 · 쓰기 거부(restrictive — 뒤에 permissive가 늘어도 AND)
  foreach t in array array['future_markets', 'market_research_sources', 'market_forecasts', 'market_value_chains', 'investment_manager_philosophy',
                           'investment_scores', 'investment_theses', 'investment_thesis_evidence', 'investment_scenarios', 'investment_valuations',
                           'investment_recommendations', 'investment_briefs', 'investment_alerts', 'investment_ai_reservations'] loop
    execute format('create policy integration_no_read on public.%I as restrictive for select to authenticated using (not coalesce(is_integration(), false))', t);
    execute format('create policy integration_no_insert on public.%I as restrictive for insert to authenticated with check (not coalesce(is_integration(), false))', t);
  end loop;
end
$$;

-- 알림 — 읽기 대표 · 지정자 · AI / 넣기 AI · 대표 / «읽음»은 대표만(read_at 칸만)
alter table investment_alerts enable row level security;
revoke all on table investment_alerts from public, anon, authenticated;
grant select, insert on table investment_alerts to authenticated;
grant update (read_at) on table investment_alerts to authenticated;
create policy investment_alerts_read on investment_alerts for select to authenticated using (inv_analysis_reader());
create policy investment_alerts_insert on investment_alerts for insert to authenticated with check ((inv_admin() or inv_analyst()) and created_by = auth.uid());
create policy investment_alerts_update on investment_alerts for update to authenticated using (inv_admin()) with check (inv_admin());

-- AI 예약 — 읽기 대표만(지정자 · AI는 함수로만) · 쓰기는 함수로만
alter table investment_ai_reservations enable row level security;
revoke all on table investment_ai_reservations from public, anon, authenticated;
grant select on table investment_ai_reservations to authenticated;
create policy investment_ai_reservations_read on investment_ai_reservations for select to authenticated using (inv_admin());

do $$
declare
  s text;
begin
  foreach s in array array[
    'market_forecasts_forecast_id_seq', 'market_value_chains_chain_id_seq', 'investment_scores_score_id_seq', 'investment_manager_philosophy_philosophy_id_seq',
    'investment_thesis_evidence_evidence_id_seq', 'investment_scenarios_scenario_row_id_seq', 'investment_valuations_valuation_id_seq',
    'investment_alerts_alert_id_seq', 'investment_briefs_brief_id_seq', 'investment_ai_reservations_res_id_seq'
  ] loop
    execute format('revoke all on sequence public.%I from public, anon', s);
    execute format('grant usage, select on sequence public.%I to authenticated', s);
  end loop;
end
$$;
revoke all on function investment_append_only() from public, anon, authenticated;
revoke all on function investment_recommendation_guard() from public, anon, authenticated;

-- =====================================================================
-- 7절. 스위치 investment_ai(기본 대표 켬) — 끄면 LLM 호출만 멈춘다(계산기 · 공시 · 주가 · 점수는 그대로)
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'investment_ai', true, 'chairman', '기본값(0095) — check:investment-ai-cap 통과 뒤 배포')
on conflict do nothing;

-- =====================================================================
-- 8절. 산업 시드 — 출처 · 발표일이 있는 공개 자료만(docs/specs/investment-markets-research.md, 2026-10-25 조사).
--   verified: page(페이지 확인) · snippet(사이트가 자동 열람을 막아 검색 문장만 확인). 확인 못 한 칸은 넣지 않는다.
--   Market Score 입력: Demand Growth는 공식(CAGR ÷ 30 × 100), 나머지 넷은 «AI 추정»(Claude Code 2026-10-25, 근거 문장 · 출처) —
--   화면은 «AI 추정»을 단다. 대표가 판단 줄을 넣으면 그 줄이 이긴다(가장 늦은 줄).
-- =====================================================================
insert into market_research_sources (market_id, publisher, title, url, published_date, verified, note) values
  ('ai_infra', 'Gartner (M Report 재게재)', 'Worldwide semiconductor revenue grew 21% in 2025', 'https://mreport.co.th/en/news/industry-movement/541-global-semiconductor-market-growth-2025', '2026-01-12', 'page', '원문 https://www.gartner.com/en/newsroom/press-releases/2026-01-12-gartner-says-worldwide-semiconductor-revenue-grew-21-percent-in-2025'),
  ('ai_infra', 'NVIDIA (SEC 8-K)', 'NVIDIA Q4 FY2026 results', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000019/q4fy26pr.htm', '2026-02-25', 'page', null),
  ('ai_infra', 'McKinsey & Company', 'The cost of compute: a $7 trillion race to scale data centers', 'https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/the-cost-of-compute-a-7-trillion-dollar-race-to-scale-data-centers', '2025-04-28', 'snippet', '발표 월 2025-04(일자 미확인 — 월말로 둠)'),
  ('ai_infra', 'TVBS News (TSMC Q1 2026 실적 콜 보도)', 'TSMC raises AI accelerator revenue CAGR outlook', 'https://t.media/3180099', '2026-04-16', 'page', null),
  ('robotics', 'IDC (Jiemian 보도)', 'Global humanoid robot shipments 2025', 'https://en.jiemian.com/article/13925066.html', '2026-01-15', 'page', '발표 월 2026-01(일자 미확인 — 중순으로 둠)'),
  ('robotics', 'International Federation of Robotics', 'Global robot demand in factories doubles over 10 years', 'https://ifr.org/ifr-press-releases/news/global-robot-demand-in-factories-doubles-over-10-years', '2025-09-25', 'page', null),
  ('robotics', 'Goldman Sachs Research', 'The global market for robots could reach $38 billion by 2035', 'https://www.goldmansachs.com/insights/articles/the-global-market-for-robots-could-reach-38-billion-by-2035', '2024-02-27', 'snippet', '발표 월 2024-02(일자 미확인)'),
  ('healthcare', 'IQVIA (Reuters 보도)', 'Weight-loss drug forecasts jump', 'https://www.tbsnews.net/world/global-economy/weight-loss-drug-forecasts-jump-150-billion-supply-grows-878826', '2024-05-31', 'snippet', '발표 월 2024-05(일자 미확인)'),
  ('healthcare', 'Eli Lilly (SEC 8-K)', 'Lilly Q4 2025 sales and earnings', 'https://www.sec.gov/Archives/edgar/data/59478/000005947826000008/q425lillysalesandearningsp.htm', '2026-02-04', 'page', null),
  ('healthcare', 'Goldman Sachs Research', 'The anti-obesity drug market may prove smaller than expected', 'https://www.goldmansachs.com/insights/articles/the-anti-obesity-drug-market-may-prove-smaller-than-expected', null, 'snippet', '발표 2025(일자 미확인 — 발표일 미상)'),
  ('energy', 'IEA (World Energy Investment 2025)', 'Global energy investment set to rise to $3.3 trillion in 2025', 'https://www.iea.org/news/global-energy-investment-set-to-rise-to-33-trillion-in-2025-amid-economic-uncertainty-and-energy-security-concerns', '2025-06-05', 'page', null),
  ('energy', 'IEA (Energy and AI)', 'Energy and AI — Executive summary', 'https://www.iea.org/reports/energy-and-ai/executive-summary', '2025-04-10', 'page', null),
  ('energy', 'Wood Mackenzie', 'Power and distribution transformers will face supply deficits of 30% and 10% in 2025', 'https://www.woodmac.com/press-releases/power-transformers-and-distribution-transformers-will-face-supply-deficits-of-30-and-10-in-2025/', '2025-08-14', 'page', null),
  ('materials', 'Yole Group (Microwave Journal 재게재)', 'Advanced packaging market set to reach $79.4B by 2030', 'https://www.microwavejournal.com/articles/44658-advanced-packaging-market-set-to-reach-794b-by-2030', '2025-09-02', 'page', null),
  ('materials', 'Yole Group (SEMI)', 'Advanced packaging — technology trends', 'https://www.semi.org/en/technology-trends/topic/advanced-packaging', null, 'snippet', '발표 2025(일자 미확인)'),
  ('materials', 'BloombergNEF', 'Lithium-ion battery pack prices fall to $108 per kilowatt-hour', 'https://about.bnef.com/insights/commodities/lithium-ion-battery-pack-prices-fall-to-108-per-kilowatt-hour-despite-rising-metal-prices/', '2025-12-09', 'page', null);

insert into market_forecasts (market_id, metric, label, year, value, unit, text_value, kind, source_id, note)
select v.market_id, v.metric, v.label, v.year, v.value, v.unit, v.text_value, v.kind, s.source_id, v.note
from (values
  ('ai_infra', 'market_size', 'AI 프로세서 매출(현재 시장 규모)', 2025, 200::numeric, 'USD bn(초과)', null, 'actual', 'https://mreport.co.th/en/news/industry-movement/541-global-semiconductor-market-growth-2025', 'Gartner 잠정치 «200B 초과»'),
  ('ai_infra', 'adoption', 'AI 반도체 비중(전체 반도체 매출 중)', 2025, null, null, '약 1/3', 'actual', 'https://mreport.co.th/en/news/industry-movement/541-global-semiconductor-market-growth-2025', null),
  ('ai_infra', 'profit_pool', 'NVIDIA Data Center 매출 FY2026', 2025, 193.7, 'USD bn', null, 'actual', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000019/q4fy26pr.htm', '전년 대비 +68% · 총이익률 71.1% · 영업이익 130.4bn / 매출 215.9bn'),
  ('ai_infra', 'market_size', 'AI 데이터센터 누적 투자 필요액(2030까지)', 2030, 5200, 'USD bn(누적)', null, 'forecast', 'https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/the-cost-of-compute-a-7-trillion-dollar-race-to-scale-data-centers', '전체 6.7T · 시나리오 3.7T~7.9T'),
  ('ai_infra', 'cagr', 'TSMC AI 가속기 매출 CAGR', 2029, 55, '% (2024-2029, 54~56%)', null, 'forecast', 'https://t.media/3180099', '45%에서 상향'),
  ('robotics', 'market_size', '휴머노이드 출하(현재)', 2025, 18000, '대', null, 'actual', 'https://en.jiemian.com/article/13925066.html', '+508% · Omdia는 13,318대로 집계(출처마다 다름)'),
  ('robotics', 'historical_growth', '산업용 로봇 설치', 2024, 542000, '대', null, 'actual', 'https://ifr.org/ifr-press-releases/news/global-robot-demand-in-factories-doubles-over-10-years', '10년 사이 2배 · 가동 4,664,000대 · 2025 +6% 575k 전망'),
  ('robotics', 'market_size', '휴머노이드 출하(2030)', 2030, 250000, '대/년(초과)', null, 'forecast', 'https://www.goldmansachs.com/insights/articles/the-global-market-for-robots-could-reach-38-billion-by-2035', '기본 시나리오'),
  ('robotics', 'market_size', '휴머노이드 시장(2035)', 2035, 38, 'USD bn', null, 'forecast', 'https://www.goldmansachs.com/insights/articles/the-global-market-for-robots-could-reach-38-billion-by-2035', '140만 대'),
  ('robotics', 'unit_cost', '휴머노이드 대당 제조원가', 2024, null, null, 'USD 50k~250k → 30k~150k(약 40% 하락)', 'actual', 'https://www.goldmansachs.com/insights/articles/the-global-market-for-robots-could-reach-38-billion-by-2035', null),
  ('healthcare', 'market_size', '비만 치료제 지출(현재)', 2023, 24, 'USD bn', null, 'actual', 'https://www.tbsnews.net/world/global-economy/weight-loss-drug-forecasts-jump-150-billion-supply-grows-878826', null),
  ('healthcare', 'profit_pool', 'Lilly Mounjaro + Zepbound 매출', 2025, 36.5, 'USD bn', null, 'actual', 'https://www.sec.gov/Archives/edgar/data/59478/000005947826000008/q425lillysalesandearningsp.htm', 'Lilly 영업이익 26.3bn / 매출 65.2bn(약 40% — 계산)'),
  ('healthcare', 'market_size', '비만 치료제 시장(2030)', 2030, 95, 'USD bn', null, 'forecast', 'https://www.goldmansachs.com/insights/articles/the-anti-obesity-drug-market-may-prove-smaller-than-expected', '130bn에서 하향'),
  ('healthcare', 'unit_cost', '순가격 하락 가정', null, 7, '%/년', null, 'forecast', 'https://www.goldmansachs.com/insights/articles/the-anti-obesity-drug-market-may-prove-smaller-than-expected', '종전 약 2%'),
  ('energy', 'market_size', '전력망 투자(현재)', 2025, 400, 'USD bn/년', null, 'actual', 'https://www.iea.org/news/global-energy-investment-set-to-rise-to-33-trillion-in-2025-amid-economic-uncertainty-and-energy-security-concerns', null),
  ('energy', 'adoption', '데이터센터 전력 소비', 2024, 415, 'TWh', null, 'actual', 'https://www.iea.org/reports/energy-and-ai/executive-summary', '세계 전력의 약 1.5% · 미국 45%'),
  ('energy', 'market_size', '데이터센터 전력 소비(2030)', 2030, 945, 'TWh', null, 'forecast', 'https://www.iea.org/reports/energy-and-ai/executive-summary', null),
  ('energy', 'market_size', '데이터센터 전력 소비(2035)', 2035, 1200, 'TWh', null, 'forecast', 'https://www.iea.org/reports/energy-and-ai/executive-summary', '기본 시나리오 · 범위 700~1,700'),
  ('energy', 'cagr', '데이터센터 전력 CAGR(계산)', 2030, 14.7, '% (2024-2030, IEA 415→945 계산)', null, 'forecast', 'https://www.iea.org/reports/energy-and-ai/executive-summary', 'IEA가 직접 낸 값이 아니라 두 숫자로 계산'),
  ('energy', 'historical_growth', '미국 전력 변압기 수요', 2025, 116, '% (2019 이후 증가)', null, 'actual', 'https://www.woodmac.com/press-releases/power-transformers-and-distribution-transformers-will-face-supply-deficits-of-30-and-10-in-2025/', '배전 변압기 +41%'),
  ('materials', 'market_size', '첨단 패키징 시장(현재)', 2024, 46.1, 'USD bn', null, 'actual', 'https://www.semi.org/en/technology-trends/topic/advanced-packaging', null),
  ('materials', 'market_size', '첨단 패키징 시장(2030)', 2030, 79.4, 'USD bn', null, 'forecast', 'https://www.microwavejournal.com/articles/44658-advanced-packaging-market-set-to-reach-794b-by-2030', null),
  ('materials', 'cagr', '첨단 패키징 CAGR', 2030, 9.5, '% (2024-2030)', null, 'forecast', 'https://www.semi.org/en/technology-trends/topic/advanced-packaging', '다른 정리는 9.4%'),
  ('materials', 'unit_cost', '리튬이온 배터리 팩 가격', 2025, 108, 'USD/kWh', null, 'actual', 'https://about.bnef.com/insights/commodities/lithium-ion-battery-pack-prices-fall-to-108-per-kilowatt-hour-despite-rising-metal-prices/', '전년 대비 −8% · ESS 70')
) as v(market_id, metric, label, year, value, unit, text_value, kind, url, note)
join market_research_sources s on s.url = v.url and s.market_id = v.market_id;

insert into market_value_chains (market_id, segment, leaders, sort_order) values
  ('ai_infra', 'GPU · 가속기', array['NVIDIA (NVDA)', 'AMD (AMD)'], 1),
  ('ai_infra', '맞춤 ASIC · 네트워킹', array['Broadcom (AVGO)', 'Marvell (MRVL)'], 2),
  ('ai_infra', '파운드리 · 첨단 패키징', array['TSMC (TSM)', 'ASE (ASX)', 'Amkor (AMKR)'], 3),
  ('ai_infra', 'HBM 메모리', array['SK hynix (000660.KS)', 'Samsung (005930.KS)', 'Micron (MU)'], 4),
  ('ai_infra', '서버 · 시스템', array['Dell (DELL)', 'Supermicro (SMCI)', 'Foxconn (2317.TW)'], 5),
  ('robotics', '완성 로봇', array['Tesla (TSLA)', 'UBTech (9880.HK)', 'Unitree', 'AgiBot', 'Figure'], 1),
  ('robotics', 'AI · 제어 소프트웨어 · 연산', array['NVIDIA (NVDA)'], 2),
  ('robotics', '액추에이터 · 감속기', array['Harmonic Drive Systems (6324.T)', 'Nabtesco (6268.T)', 'Leaderdrive (688017.SS)'], 3),
  ('robotics', '센서 · 비전', array['Sony (SONY)', 'Hesai (HSAI)'], 4),
  ('robotics', '배터리 · 전력', array['CATL (300750.SZ)', 'LG Energy Solution (373220.KS)'], 5),
  ('healthcare', '오리지널 제약', array['Eli Lilly (LLY)', 'Novo Nordisk (NVO)'], 1),
  ('healthcare', '차세대 · 경구 파이프라인', array['Amgen (AMGN)', 'Roche (ROG.SW)', 'AstraZeneca (AZN)', 'Viking Therapeutics (VKTX)'], 2),
  ('healthcare', 'CDMO · 충전', array['Lonza (LONN.SW)', 'Samsung Biologics (207940.KS)'], 3),
  ('healthcare', '주사 펜 · 기기', array['Ypsomed (YPSN.SW)', 'West Pharmaceutical (WST)'], 4),
  ('energy', '가스터빈 · 발전', array['GE Vernova (GEV)', 'Siemens Energy (ENR.DE)', 'Mitsubishi Heavy (7011.T)'], 1),
  ('energy', '변압기 · 개폐기', array['Hitachi (6501.T)', 'Siemens Energy (ENR.DE)', 'HD Hyundai Electric (267260.KS)', 'LS Electric (010120.KS)'], 2),
  ('energy', '고압 케이블', array['Prysmian (PRY.MI)', 'Nexans (NEX.PA)', 'NKT (NKT.CO)'], 3),
  ('energy', '데이터센터 전기 · 냉각', array['Schneider Electric (SU.PA)', 'Eaton (ETN)', 'Vertiv (VRT)'], 4),
  ('energy', '계통 저장 배터리', array['CATL (300750.SZ)', 'Tesla (TSLA)', 'BYD (1211.HK)'], 5),
  ('materials', '2.5D/3D 패키징(CoWoS · SoIC)', array['TSMC (TSM)', 'Intel (INTC)', 'Samsung (005930.KS)'], 1),
  ('materials', 'OSAT', array['ASE (ASX)', 'Amkor (AMKR)', 'JCET (600584.SS)'], 2),
  ('materials', 'HBM 적층', array['SK hynix (000660.KS)', 'Samsung (005930.KS)', 'Micron (MU)'], 3),
  ('materials', '하이브리드 본딩 · 장비', array['BESI (BESI.AS)', 'ASMPT (0522.HK)', 'Hanmi Semiconductor (042700.KS)', 'Disco (6146.T)'], 4),
  ('materials', '기판', array['Ibiden (4062.T)', 'Unimicron (3037.TW)'], 5);

insert into investment_scores (subject_type, subject_id, factor, score, method, raw_value, raw_unit, evidence, source_url, as_of, data_quality, model_version, created_kind) values
  -- Demand Growth — 공식: min(100, CAGR ÷ 30 × 100)
  ('market', 'ai_infra', 'demand_growth', 100, 'formula', 55, 'CAGR %', 'TSMC AI 가속기 매출 CAGR 54~56%(2024-2029)', 'https://t.media/3180099', '2026-04-16', 85, null, 'system'),
  ('market', 'robotics', 'demand_growth', 100, 'formula', 69.2, 'CAGR % (계산)', '휴머노이드 출하 2025 약 1.8만 대(IDC) → 2030 25만 대 초과(GS) — 계산 CAGR 69.2%', 'https://www.goldmansachs.com/insights/articles/the-global-market-for-robots-could-reach-38-billion-by-2035', '2026-01-15', 65, null, 'system'),
  ('market', 'healthcare', 'demand_growth', 72.33, 'formula', 21.7, 'CAGR % (계산)', '비만 치료제 2023 USD 24bn(IQVIA) → 2030 USD 95bn(GS) — 계산 CAGR 21.7%', 'https://www.goldmansachs.com/insights/articles/the-anti-obesity-drug-market-may-prove-smaller-than-expected', null, 65, null, 'system'),
  ('market', 'energy', 'demand_growth', 49, 'formula', 14.7, 'CAGR % (계산)', '데이터센터 전력 415 → 945 TWh(2024-2030, IEA) — 계산 CAGR 14.7%', 'https://www.iea.org/reports/energy-and-ai/executive-summary', '2025-04-10', 85, null, 'system'),
  ('market', 'materials', 'demand_growth', 31.67, 'formula', 9.5, 'CAGR %', '첨단 패키징 46.1 → 79.4 USD bn(2024-2030, Yole) CAGR 9.5%', 'https://www.microwavejournal.com/articles/44658-advanced-packaging-market-set-to-reach-794b-by-2030', '2025-09-02', 80, null, 'system'),
  -- 나머지 넷 — AI 추정(근거 · 출처). 대표 판단 줄이 들어오면 그 줄이 이긴다.
  ('market', 'ai_infra', 'profit_pool', 90, 'ai_estimate', null, null, 'NVIDIA 총이익률 71.1% · 영업이익 130.4bn(FY2026) — 이익이 칩 설계에 크게 쌓인다', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000019/q4fy26pr.htm', '2026-02-25', 55, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'ai_infra', 'adoption', 80, 'ai_estimate', null, null, 'AI 반도체가 2025년 전체 반도체 매출의 약 1/3', 'https://mreport.co.th/en/news/industry-movement/541-global-semiconductor-market-growth-2025', '2026-01-12', 55, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'ai_infra', 'bottleneck', 90, 'ai_estimate', null, null, 'CoWoS 수요 연 ~80% 증가 · TSMC 생산능력 3배 추진 · HBM 공급', 'https://t.media/3180099', '2026-04-16', 55, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'ai_infra', 'durability', 65, 'ai_estimate', null, null, '투자 지속은 AI 실매출에 달림 — McKinsey 시나리오 3.7T~7.9T로 폭이 넓다', 'https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/the-cost-of-compute-a-7-trillion-dollar-race-to-scale-data-centers', '2025-04-28', 50, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'robotics', 'profit_pool', 30, 'ai_estimate', null, null, '확인된 이익 규모 자료 없음 — 초기 시장(대당 원가 USD 30k~150k)', 'https://www.goldmansachs.com/insights/articles/the-global-market-for-robots-could-reach-38-billion-by-2035', '2024-02-27', 40, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'robotics', 'adoption', 35, 'ai_estimate', null, null, '휴머노이드 약 1.8만 대 vs 산업용 로봇 연 54.2만 대 설치 — 채택 초기', 'https://ifr.org/ifr-press-releases/news/global-robot-demand-in-factories-doubles-over-10-years', '2025-09-25', 50, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'robotics', 'bottleneck', 50, 'ai_estimate', null, null, '공급 병목 출처 자료 없음 — 중립값(감속기 · 액추에이터 공급망 집중은 가설)', 'https://ifr.org/ifr-press-releases/news/global-robot-demand-in-factories-doubles-over-10-years', '2025-09-25', 35, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'robotics', 'durability', 55, 'ai_estimate', null, null, '전망 폭이 매우 넓다(GS 2035 USD 38bn vs MS 2050 USD 5T) · 생산성 · 안전성 미입증', 'https://www.goldmansachs.com/insights/articles/the-global-market-for-robots-could-reach-38-billion-by-2035', '2024-02-27', 40, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'healthcare', 'profit_pool', 80, 'ai_estimate', null, null, 'Lilly 영업이익 26.3bn / 매출 65.2bn(약 40%) · Mounjaro + Zepbound 36.5bn', 'https://www.sec.gov/Archives/edgar/data/59478/000005947826000008/q425lillysalesandearningsp.htm', '2026-02-04', 55, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'healthcare', 'adoption', 55, 'ai_estimate', null, null, '채택률 자료 없음 — 경구 제형 승인(2025-12) · 미국 밖 보급 확대가 근거', 'https://www.sec.gov/Archives/edgar/data/59478/000005947826000008/q425lillysalesandearningsp.htm', '2026-02-04', 40, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'healthcare', 'bottleneck', 40, 'ai_estimate', null, null, '연 ~7% 순가격 하락 가정 — 공급 병목보다 가격 압력이 크다', 'https://www.goldmansachs.com/insights/articles/the-anti-obesity-drug-market-may-prove-smaller-than-expected', null, 45, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'healthcare', 'durability', 65, 'ai_estimate', null, null, '만성 질환 수요 · 다만 가격 정책 · 지속 복용률 위험', 'https://www.goldmansachs.com/insights/articles/the-anti-obesity-drug-market-may-prove-smaller-than-expected', null, 45, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'energy', 'profit_pool', 55, 'ai_estimate', null, null, '이익 규모 자료 없음 — 변압기 가격 2019 이후 약 75% 상승(공급자 가격 결정력)', 'https://www.woodmac.com/press-releases/power-transformers-and-distribution-transformers-will-face-supply-deficits-of-30-and-10-in-2025/', '2025-08-14', 45, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'energy', 'adoption', 70, 'ai_estimate', null, null, '데이터센터가 미국 전력 수요 증가의 절반 가까이(2030까지) · 2024 415 TWh', 'https://www.iea.org/reports/energy-and-ai/executive-summary', '2025-04-10', 60, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'energy', 'bottleneck', 90, 'ai_estimate', null, null, '미국 전력 변압기 2025 공급 부족 30% · 대형 변압기 조달 최대 4년', 'https://www.woodmac.com/press-releases/power-transformers-and-distribution-transformers-will-face-supply-deficits-of-30-and-10-in-2025/', '2025-08-14', 60, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'energy', 'durability', 85, 'ai_estimate', null, null, '전력망 투자가 발전 투자 수준까지 늘어야 함(IEA) · 전력 수요는 구조적', 'https://www.iea.org/news/global-energy-investment-set-to-rise-to-33-trillion-in-2025-amid-economic-uncertainty-and-energy-security-concerns', '2025-06-05', 55, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'materials', 'profit_pool', 50, 'ai_estimate', null, null, '이익 규모 자료 없음 — 중국 OSAT 대규모 증설로 과잉 위험', 'https://www.microwavejournal.com/articles/44658-advanced-packaging-market-set-to-reach-794b-by-2030', '2025-09-02', 40, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'materials', 'adoption', 60, 'ai_estimate', null, null, '2024 매출의 약 70%가 모바일 · 소비자 — AI · HPC로 옮겨 가는 중', 'https://www.semi.org/en/technology-trends/topic/advanced-packaging', null, 45, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'materials', 'bottleneck', 80, 'ai_estimate', null, null, 'CoWoS 2.5D 생산능력 부족 — TSMC 3배 증설 추진', 'https://t.media/3180099', '2026-04-16', 55, 'claude-opus-5-5 (2026-10-25 조사)', 'system'),
  ('market', 'materials', 'durability', 70, 'ai_estimate', null, null, 'AI · 자동차 수요 · 다만 연구기관마다 시장 정의가 달라 규모 편차', 'https://www.microwavejournal.com/articles/44658-advanced-packaging-market-set-to-reach-794b-by-2030', '2025-09-02', 45, 'claude-opus-5-5 (2026-10-25 조사)', 'system');


commit;
