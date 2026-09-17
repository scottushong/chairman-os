-- =====================================================================
-- Chairman OS — 0015_finance_ledger
-- 출처: Phase 2-A 재무 메인스트림 (ECOUNT 연동 전) / CH-006~010, CH-025~027, CH-052 / DEFERRED D-01
-- 작성: Phase 2-A (2026-09-17)
--
-- 원칙 한 줄 — 모든 숫자에 출처 꼬리표(확정/잠정/수기/추정). 출처 없는 숫자는 화면에 못 올린다.
--
-- 무엇이 바뀌나
--   지금까지 finance_kpis는 사람이 넣은 시트값 480칸이었다. 누가 어디서 가져온 숫자인지,
--   마감된 숫자인지 아닌지를 표가 말하지 못했다. 이 파일부터 재무 숫자는 원천에서 계산된다.
--
--     accounts          계정과목 (회사별, ECOUNT 계정코드)
--     journal_lines     전표 라인        — 잠정 원천
--     closings          월 결산          — 확정 원천
--     fx_rates          환율
--     cost_indices      원재료지수·전기요금·CPI·운임지수
--     market_multiples  업종 멀티플 (EV/EBITDA·PSR). 승인자·승인일이 있어야 확정이다
--
--   재무 원천 표는 전부 source(ecount/manual/estimate) · fetched_at · closed 세 칸을 갖는다.
--   closed의 뜻은 표마다 같다 — "이 값은 더 바뀌지 않는다".
--     전표 = 그 달이 마감됨 / 결산 = 확정 마감(false면 가마감) / 환율·지수 = 확정 발표치 / 멀티플 = 승인됨
--
-- 꼬리표 (lib/ledger/basis.ts와 같은 규칙. 한쪽을 고치면 다른 쪽도 고친다)
--   source=ecount & closed      확정       rank 0
--   source=ecount & not closed  잠정       rank 1
--   source=manual               수기       rank 2
--   source=estimate             추정       rank 3
--   여러 칸을 더한 값은 가장 큰 rank(가장 약한 꼬리표)를 받는다.
--
-- finance_kpis는 이제 뷰다 (lib/ledger/cells.ts와 같은 규칙)
--   ① 결산이 있는 달은 결산만 본다. 결산은 시산표 한 벌이라 전표와 섞지 않는다.
--   ② 결산이 없는 달은 전표로 만든다. 손익 = 그 달 발생액, 상태표 = 직전 결산 잔액 + 그 뒤 전표.
--   ③ 둘 다 없는 회사·달만 옛 시트 행(finance_kpis_sheet)을 수기 꼬리표로 보여 준다.
--      시트 480칸이 이미 원격에 있다. 지우면 ECOUNT가 붙기 전까지 대시보드가 빈다.
--      대신 새로 넣을 길을 닫는다 — finance_kpis_sheet에는 어떤 쓰기 정책도 없다(수기 입력 금지).
--   금액은 차변 − 대변. 매출·부채·자본은 음수로 저장되고 지표 공식이 부호를 뒤집는다.
--
--   EBITDA도 계산된다. DEFERRED D-01 결정 A의 "실 Formula는 Phase 2 ECOUNT 연동 때"가 여기다.
--   VANA 2026-08 EBITDA 2.8억은 mock 원장에서 계산으로 그대로 나온다(scripts/check-finance-ledger.ts).
--
-- 누가 쓰나 — 새 역할 Integration (DEFERRED D-19)
--   service_role은 여전히 없다. ECOUNT 동기화도 야간 AI Job처럼 로그인해서 RLS 안에서 돈다.
--   AIAgent 계정을 쓰지 않는 이유: 0013이 "Agent는 ai_night_outputs 말고 못 쓴다"를 restrictive로 보장한다.
--   그걸 열면 AI가 원장을 고칠 수 있는 경로가 생긴다. 쓰는 주체가 다르면 역할도 달라야 한다.
--   Integration은 accounts / journal_lines / closings / fx_rates / cost_indices 다섯 표만 쓰고,
--   원장에 넣는 행은 source='ecount'만이다. 마감된 달(closed)은 Integration도 못 고친다.
--
-- enum 값 추가와 같은 트랜잭션에서는 새 값을 리터럴로 못 쓴다(55P04). 0013과 같이
-- Integration 판정은 auth_role()::text 비교(is_integration())로 한다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 어휘
-- ---------------------------------------------------------------------
alter type app_role add value if not exists 'Integration';
alter type audit_action add value if not exists 'ecount_sync_completed';

create type data_source as enum ('ecount', 'manual', 'estimate');

-- 사용자 지정 대분류(매출/원재료/인건비/전기/운송/라이센스/기타/자산/부채)에 '자본'을 더했다.
-- 재무상태표가 자산 = 부채 + 자본으로 닫히려면 자본 계정이 있어야 한다.
create type account_category as enum (
  'revenue', 'raw_material', 'labor', 'electricity', 'freight', 'license', 'other',
  'asset', 'liability', 'equity'
);

-- 대분류와 축이 다르다. 인건비는 제조원가에도 판관비에도 있다.
create type account_section as enum (
  'revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax',
  'cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity'
);

create type cash_flow_class as enum ('operating', 'investing', 'financing');
create type dr_cr as enum ('debit', 'credit');

/** Integration 역할인가. 새 enum 값을 리터럴로 쓰지 않으려고 text로 비교한다. */
create or replace function is_integration() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and auth_role()::text = 'Integration';
$fn$;

/** 출처 꼬리표의 순위. lib/ledger/basis.ts의 RANK와 같다. */
create or replace function figure_rank(src data_source, is_closed boolean) returns int
language sql immutable as $fn$
  select case
    when src = 'estimate' then 3
    when src = 'manual' then 2
    when is_closed then 0
    else 1
  end;
$fn$;

-- ---------------------------------------------------------------------
-- 2. accounts — 계정과목
--    분류(대분류·구분·현금흐름)는 ECOUNT가 주지 않는다. 계정과목표를 보고 사람이 정한 값을
--    동기화가 싣는다(lib/ecount/account-map.ts). 분류를 모르는 계정이 오면 동기화가 그 회사를 멈춘다.
-- ---------------------------------------------------------------------
create table accounts (
  business_id  text not null references businesses(business_id) on delete restrict, -- [일반]
  account_code text not null check (length(trim(account_code)) > 0),               -- [일반] ECOUNT 계정코드
  name         text not null,                                                      -- [일반]
  category     account_category not null,                                          -- [일반]
  section      account_section not null,                                           -- [일반]
  cash_flow    cash_flow_class,                                                    -- [일반] null = 현금 자신 / 비현금
  source       data_source not null,                                               -- [일반]
  fetched_at   timestamptz not null,                                               -- [일반]
  closed       boolean not null default false,                                     -- [일반] 계정표 확정
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (business_id, account_code),
  -- 대분류와 구분이 서로 모순되지 않게. '매출 구분인데 원재료 대분류' 같은 행은 원가 구조를 조용히 틀리게 한다.
  constraint accounts_category_section check (
    (section = 'revenue' and category = 'revenue')
    or (section in ('cogs', 'sga', 'd_and_a', 'non_operating', 'tax')
        and category in ('raw_material', 'labor', 'electricity', 'freight', 'license', 'other'))
    or (section in ('cash', 'receivable', 'other_asset') and category = 'asset')
    or (section in ('payable', 'other_liability') and category = 'liability')
    or (section = 'equity' and category = 'equity')
  )
);
comment on table accounts is 'Phase 2-A. 회사별 계정과목. 같은 코드가 회사마다 다른 계정일 수 있다(ECOUNT 회사코드 단위).';

create trigger accounts_updated_at before update on accounts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 3. journal_lines — 전표 라인 (잠정 원천)
--    금액은 늘 양수, 방향은 side. 부호로 차대를 표현하면 음수 차변과 대변이 구분되지 않는다.
-- ---------------------------------------------------------------------
create table journal_lines (
  id           bigint generated always as identity primary key,
  business_id  text not null,                                          -- [일반]
  entry_date   date not null,                                          -- [일반]
  account_code text not null,                                          -- [일반]
  amount       numeric(20, 2) not null check (amount > 0),             -- [제한]
  side         dr_cr not null,                                         -- [일반]
  slip_no      text not null,                                          -- [일반] ECOUNT 전표번호
  line_no      int not null,                                           -- [일반]
  memo         text not null default '',                               -- [제한] 적요. 거래처 이름이 들어온다
  -- 전표를 '추정'으로 넣지 않는다. 추정은 원장이 아니라 계획이다.
  source       data_source not null check (source <> 'estimate'),     -- [일반]
  fetched_at   timestamptz not null,                                   -- [일반]
  closed       boolean not null default false,                         -- [일반] 이 전표의 달이 마감됐나
  foreign key (business_id, account_code) references accounts (business_id, account_code) on delete restrict,
  unique (business_id, slip_no, line_no)
);
comment on table journal_lines is 'Phase 2-A. 전표 라인. 잠정 원천 — 결산이 없는 달의 숫자가 여기서 나온다.';

create index journal_lines_by_date on journal_lines (business_id, entry_date);

-- ---------------------------------------------------------------------
-- 4. closings — 월 결산 (확정 원천)
--    amount = 차변 − 대변. 손익 계정은 그 달 발생액, 상태표 계정은 월말 잔액.
--    provisional_amount = 마감을 처음 가져온 순간 전표로 보이던 값. '잠정-확정 차이'의 원천이다.
--    ECOUNT가 주는 값이 아니라 동기화가 찍는다. 그래서 마감 뒤에는 고치지 않는다(아래 정책).
-- ---------------------------------------------------------------------
create table closings (
  business_id        text not null,                                         -- [일반]
  period             text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),  -- [일반]
  account_code       text not null,                                         -- [일반]
  amount             numeric(20, 2) not null,                               -- [제한] 확정금액(차변 − 대변)
  closed_on          date not null,                                         -- [일반] 마감일
  provisional_amount numeric(20, 2),                                        -- [제한] 마감 시점 잠정치. 전표가 없었으면 null
  source             data_source not null check (source <> 'estimate'),    -- [일반]
  fetched_at         timestamptz not null,                                  -- [일반]
  closed             boolean not null default false,                        -- [일반] false = 가마감
  primary key (business_id, period, account_code),
  foreign key (business_id, account_code) references accounts (business_id, account_code) on delete restrict
);
comment on table closings is 'Phase 2-A. 월 결산. 확정 원천 — 결산이 있는 달은 전표를 보지 않는다.';

-- ---------------------------------------------------------------------
-- 5. fx_rates / cost_indices — 원가 드라이버
--    회사에 속하지 않는 시장 데이터다. 실 원천(ECOS 등)이 붙기 전까지는 재무 담당이 수기로 넣는다.
-- ---------------------------------------------------------------------
create table fx_rates (
  rate_date   date not null,                          -- [일반]
  base        text not null default 'USD',            -- [일반]
  quote       text not null default 'KRW',            -- [일반]
  rate        numeric(18, 6) not null check (rate > 0), -- [일반]
  source_name text not null,                          -- [일반] 예: 한국은행 ECOS 매매기준율
  source      data_source not null,                   -- [일반]
  fetched_at  timestamptz not null,                   -- [일반]
  closed      boolean not null default false,         -- [일반] 확정 고시
  primary key (rate_date, base, quote)
);

create table cost_indices (
  index_code  text not null check (index_code in ('raw_material', 'electricity', 'cpi', 'freight')), -- [일반]
  index_date  date not null,                          -- [일반]
  value       numeric(18, 4) not null,                -- [일반]
  unit        text not null default '',               -- [일반] 예: 2020=100
  source_name text not null,                          -- [일반]
  source      data_source not null,                   -- [일반]
  fetched_at  timestamptz not null,                   -- [일반]
  closed      boolean not null default false,         -- [일반] 잠정치 → 확정치
  primary key (index_code, index_date)
);

-- ---------------------------------------------------------------------
-- 6. market_multiples — 업종 멀티플
--    사람이 고르고 승인하는 숫자다. 승인 전(closed=false)은 화면에 올리지 않는다.
--    승인자와 승인일은 같이 있거나 같이 없다. 승인자는 본인만 적을 수 있다.
-- ---------------------------------------------------------------------
create table market_multiples (
  multiple_id uuid primary key default gen_random_uuid(),           -- [일반]
  industry    text not null check (length(trim(industry)) > 0),     -- [일반]
  ev_ebitda   numeric(8, 2),                                        -- [제한]
  psr         numeric(8, 2),                                        -- [제한]
  as_of       date not null,                                        -- [일반] 기준일
  source_name text not null check (length(trim(source_name)) > 0), -- [일반] 출처 없는 멀티플은 없다
  source      data_source not null,                                 -- [일반]
  fetched_at  timestamptz not null default now(),                   -- [일반]
  closed      boolean not null default false,                       -- [일반] 승인됨
  approved_by uuid references auth.users(id),                       -- [제한]
  approved_at timestamptz,                                          -- [일반]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint market_multiples_some_value check (ev_ebitda is not null or psr is not null),
  constraint market_multiples_approval_pair check ((approved_by is null) = (approved_at is null)),
  constraint market_multiples_closed_is_approved check (closed = (approved_at is not null))
);

create trigger market_multiples_updated_at before update on market_multiples
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 7. CH-024 확장 — 현재 이슈 · 키맨
--    현재 이슈는 전략 좌표의 열두 번째 칸이다(한 회사에 하나, 사람이 쓴 문장).
--    키맨은 여러 명이라 칸이 아니라 표다. 이름·관계·최근 접촉일.
-- ---------------------------------------------------------------------
alter table business_strategy
  add column if not exists current_issue text not null default ''; -- [제한] 사람·거래처 이름이 들어온다

create table business_keymen (
  keyman_id       uuid primary key default gen_random_uuid(),                          -- [일반]
  business_id     text not null references businesses(business_id) on delete cascade,  -- [일반]
  name            text not null check (length(trim(name)) > 0),                        -- [제한]
  relation        text not null default '',                                            -- [제한] 예: 대표 / 주거래처 구매팀장
  last_contact_on date,                                                                -- [제한] null = 기록 없음
  note            text not null default '',                                            -- [제한]
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table business_keymen is 'CH-024 확장. 회사별 키맨. 이름과 관계는 [제한] 등급이다.';

create index business_keymen_by_business on business_keymen (business_id, name);
create trigger business_keymen_updated_at before update on business_keymen
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
alter table accounts          enable row level security;
alter table accounts          force row level security;
alter table journal_lines     enable row level security;
alter table journal_lines     force row level security;
alter table closings          enable row level security;
alter table closings          force row level security;
alter table fx_rates          enable row level security;
alter table fx_rates          force row level security;
alter table cost_indices      enable row level security;
alter table cost_indices      force row level security;
alter table market_multiples  enable row level security;
alter table market_multiples  force row level security;
alter table business_keymen   enable row level security;
alter table business_keymen   force row level security;

-- 원장 3표: 읽기는 finance_kpis와 같은 문(회사 범위 + [제한] 열람 역할). Integration은 자기가 쓸 행을 읽는다 —
-- upsert(ON CONFLICT DO UPDATE)는 기존 행을 읽을 수 있어야 돈다.
create policy accounts_read on accounts
  for select using (has_business(business_id) and (can_read_restricted() or is_integration()));
create policy accounts_insert on accounts
  for insert with check (is_integration() and has_business(business_id) and source = 'ecount');
create policy accounts_update on accounts
  for update using (is_integration() and has_business(business_id))
  with check (is_integration() and has_business(business_id) and source = 'ecount');

create policy journal_lines_read on journal_lines
  for select using (has_business(business_id) and (can_read_restricted() or is_integration()));
create policy journal_lines_insert on journal_lines
  for insert with check (is_integration() and has_business(business_id) and source = 'ecount');
-- 마감된 달의 전표는 Integration도 못 고치고 못 지운다. 열려 있는 달만 ECOUNT와 다시 맞춘다.
create policy journal_lines_update on journal_lines
  for update using (is_integration() and has_business(business_id) and not closed)
  with check (is_integration() and has_business(business_id) and source = 'ecount');
create policy journal_lines_delete on journal_lines
  for delete using (is_integration() and has_business(business_id) and not closed);

create policy closings_read on closings
  for select using (has_business(business_id) and (can_read_restricted() or is_integration()));
create policy closings_insert on closings
  for insert with check (is_integration() and has_business(business_id) and source = 'ecount');
-- 가마감만 갱신된다. 확정 마감을 되돌리는 일은 동기화가 아니라 사람의 결정이다.
create policy closings_update on closings
  for update using (is_integration() and has_business(business_id) and not closed)
  with check (is_integration() and has_business(business_id) and source = 'ecount');

-- 시장 데이터: 회사 범위가 없는 [일반] 데이터라 활성 사용자면 읽는다.
-- 쓰기는 동기화(Integration)와, 원천이 붙기 전 수기 입력을 맡는 Chairman / GroupCFO.
create policy fx_rates_read on fx_rates for select using (is_active());
create policy fx_rates_write on fx_rates
  for all using (is_integration() or auth_role() in ('Chairman', 'GroupCFO'))
  with check (is_integration() or auth_role() in ('Chairman', 'GroupCFO'));

create policy cost_indices_read on cost_indices for select using (is_active());
create policy cost_indices_write on cost_indices
  for all using (is_integration() or auth_role() in ('Chairman', 'GroupCFO'))
  with check (is_integration() or auth_role() in ('Chairman', 'GroupCFO'));

create policy market_multiples_read on market_multiples for select using (can_read_restricted());
create policy market_multiples_write on market_multiples
  for all using (auth_role() in ('Chairman', 'GroupCFO'))
  with check (
    auth_role() in ('Chairman', 'GroupCFO')
    and (approved_by is null or approved_by = auth.uid())
  );

-- 키맨: 읽기는 [제한] 열람 역할, 쓰기는 전략 좌표와 같은 승인권자(0008 business_strategy_write).
create policy business_keymen_read on business_keymen
  for select using (has_business(business_id) and can_read_restricted());
create policy business_keymen_write on business_keymen
  for all using (can_approve() and has_business(business_id))
  with check (can_approve() and has_business(business_id));

-- ---------------------------------------------------------------------
-- 9. 쓰기 경계 (restrictive) — 0013과 같은 방식
--    AIAgent: 새 표에도 못 쓴다.
--    Integration: 원장 5표 말고는 아무 데도 못 쓴다. 나중에 누가 permissive 쓰기 정책을 더해도 열리지 않는다.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'journal_lines', 'closings', 'fx_rates', 'cost_indices', 'market_multiples', 'business_keymen'
  ] loop
    execute format(
      'create policy ai_agent_no_insert on public.%I as restrictive for insert
         with check (auth_role() is distinct from %L)', t, 'AIAgent');
    execute format(
      'create policy ai_agent_no_update on public.%I as restrictive for update
         using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
      t, 'AIAgent', 'AIAgent');
    execute format(
      'create policy ai_agent_no_delete on public.%I as restrictive for delete
         using (auth_role() is distinct from %L)', t, 'AIAgent');
  end loop;

  foreach t in array array[
    'businesses', 'finance_kpis', 'goals', 'monthly_priorities', 'critical_risks', 'milestones',
    'projects', 'tasks', 'decisions', 'alerts', 'ai_night_outputs', 'documents', 'user_settings',
    'user_profiles', 'user_business_access', 'user_module_access', 'business_strategy',
    'user_invitations', 'chairman_projects', 'chairman_manifesto', 'market_multiples', 'business_keymen'
  ] loop
    execute format(
      'create policy integration_no_insert on public.%I as restrictive for insert
         with check (not is_integration())', t);
    execute format(
      'create policy integration_no_update on public.%I as restrictive for update
         using (not is_integration()) with check (not is_integration())', t);
    execute format(
      'create policy integration_no_delete on public.%I as restrictive for delete
         using (not is_integration())', t);
  end loop;
end
$$;

-- audit_log: 0013의 정책을 넓힌다. Integration은 자기 이름의 ecount_sync_completed 한 종류만 쓴다.
drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log
  for insert with check (
    is_active()
    and case
      when auth_role() = 'AIAgent'
        then action::text = 'night_job_completed' and actor_user_id = auth.uid()
      when is_integration()
        then action::text = 'ecount_sync_completed' and actor_user_id = auth.uid()
      else true
    end
  );

-- ---------------------------------------------------------------------
-- 10. finance_kpis — 표에서 뷰로
-- ---------------------------------------------------------------------
-- 옛 마스킹 뷰는 표를 물고 있다. 표 이름이 바뀌기 전에 내리고, 새 뷰 위에 다시 세운다.
drop view if exists finance_kpis_masked;

alter table finance_kpis rename to finance_kpis_sheet;
comment on table finance_kpis_sheet is
  'Phase 1 시트값(06_Dummy_Data). 0015부터 읽기 전용 — 쓰기 정책이 없다. '
  '원장(결산·전표)이 없는 회사·달만 finance_kpis 뷰가 수기 꼬리표로 내보낸다.';
-- 수기 입력 금지. 0002의 finance_kpis_write를 내리고 대신할 정책을 만들지 않는다(Default Deny).
drop policy if exists finance_kpis_write on finance_kpis_sheet;

/**
 * 계정 × 월의 한 칸. lib/ledger/cells.ts의 buildCells와 같은 규칙이다.
 * security_invoker라 원장 3표의 RLS가 부르는 사람 기준으로 그대로 걸린다.
 */
create view finance_ledger_cells
with (security_invoker = true) as
with
periods as (
  select business_id, period from closings
  union
  select business_id, to_char(entry_date, 'YYYY-MM') from journal_lines
),
closed_periods as (
  select distinct business_id, period from closings
),
-- ① 결산 달
closing_cells as (
  select c.business_id, c.period, c.account_code, c.amount,
         figure_rank(c.source, c.closed) as basis_rank, c.fetched_at
    from closings c
),
-- ② 결산이 없는 달과 그 직전 결산
open_periods as (
  select p.business_id, p.period,
         (select max(cp.period) from closed_periods cp
           where cp.business_id = p.business_id and cp.period < p.period) as prior_close
    from periods p
   where not exists (
     select 1 from closed_periods cp where cp.business_id = p.business_id and cp.period = p.period
   )
),
open_pl as (
  select o.business_id, o.period, j.account_code,
         sum(case when j.side = 'debit' then j.amount else -j.amount end) as amount,
         max(figure_rank(j.source, j.closed)) as basis_rank,
         min(j.fetched_at) as fetched_at
    from open_periods o
    join journal_lines j
      on j.business_id = o.business_id and to_char(j.entry_date, 'YYYY-MM') = o.period
    join accounts a
      on a.business_id = j.business_id and a.account_code = j.account_code
   where a.section in ('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax')
   group by o.business_id, o.period, j.account_code
),
open_bs_parts as (
  select o.business_id, o.period, c.account_code, c.amount,
         figure_rank(c.source, c.closed) as basis_rank, c.fetched_at
    from open_periods o
    join closings c
      on c.business_id = o.business_id and c.period = o.prior_close
    join accounts a
      on a.business_id = c.business_id and a.account_code = c.account_code
   where a.section in ('cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity')
  union all
  select o.business_id, o.period, j.account_code,
         case when j.side = 'debit' then j.amount else -j.amount end,
         figure_rank(j.source, j.closed), j.fetched_at
    from open_periods o
    join journal_lines j
      on j.business_id = o.business_id
     and to_char(j.entry_date, 'YYYY-MM') <= o.period
     and (o.prior_close is null or to_char(j.entry_date, 'YYYY-MM') > o.prior_close)
    join accounts a
      on a.business_id = j.business_id and a.account_code = j.account_code
   where a.section in ('cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity')
),
open_bs as (
  select business_id, period, account_code, sum(amount) as amount,
         max(basis_rank) as basis_rank, min(fetched_at) as fetched_at
    from open_bs_parts
   group by business_id, period, account_code
),
cells as (
  select business_id, period, account_code, amount, basis_rank, fetched_at from closing_cells
  union all
  select business_id, period, account_code, amount, basis_rank, fetched_at from open_pl
  union all
  select business_id, period, account_code, amount, basis_rank, fetched_at from open_bs
)
select c.business_id, c.period, c.account_code, a.section, a.category,
       c.amount, c.basis_rank, c.fetched_at
  from cells c
  join accounts a on a.business_id = c.business_id and a.account_code = c.account_code;

comment on view finance_ledger_cells is
  'Phase 2-A. 계정 × 월. 결산 달은 결산, 아니면 직전 결산 잔액 + 전표. lib/ledger/cells.ts와 같은 규칙.';

/**
 * 8개 지표. lib/ledger/cells.ts의 metricsOf와 한 줄씩 대응한다.
 * 꼬리표는 지표마다 그 지표에 들어간 칸들 중 가장 약한 것이다.
 */
create view finance_kpis
with (security_invoker = true) as
with m as (
  select business_id, period,
    -sum(amount) filter (where section = 'revenue')                                                     as revenue,
     max(basis_rank) filter (where section = 'revenue')                                                 as revenue_rank,
     min(fetched_at) filter (where section = 'revenue')                                                 as revenue_at,
     sum(amount) filter (where section = 'cogs')                                                        as cost,
     max(basis_rank) filter (where section = 'cogs')                                                    as cost_rank,
     min(fetched_at) filter (where section = 'cogs')                                                    as cost_at,
    -sum(amount) filter (where section in ('revenue', 'cogs', 'sga'))                                   as ebitda,
     max(basis_rank) filter (where section in ('revenue', 'cogs', 'sga'))                               as ebitda_rank,
     min(fetched_at) filter (where section in ('revenue', 'cogs', 'sga'))                               as ebitda_at,
    -sum(amount) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a'))                        as op,
     max(basis_rank) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a'))                    as op_rank,
     min(fetched_at) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a'))                    as op_at,
    -sum(amount) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax')) as ni,
     max(basis_rank) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax')) as ni_rank,
     min(fetched_at) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax')) as ni_at,
     sum(amount) filter (where section = 'cash')                                                        as cash,
     max(basis_rank) filter (where section = 'cash')                                                    as cash_rank,
     min(fetched_at) filter (where section = 'cash')                                                    as cash_at,
     sum(amount) filter (where section = 'receivable')                                                  as ar,
     max(basis_rank) filter (where section = 'receivable')                                              as ar_rank,
     min(fetched_at) filter (where section = 'receivable')                                              as ar_at,
    -sum(amount) filter (where section = 'payable')                                                     as ap,
     max(basis_rank) filter (where section = 'payable')                                                 as ap_rank,
     min(fetched_at) filter (where section = 'payable')                                                 as ap_at
  from finance_ledger_cells
  group by business_id, period
),
ledger as (
  select m.period, m.business_id, x.metric, x.value, x.basis_rank, x.fetched_at
    from m
    cross join lateral (values
      ('Revenue'::finance_metric,         m.revenue, m.revenue_rank, m.revenue_at),
      ('Cost'::finance_metric,            m.cost,    m.cost_rank,    m.cost_at),
      ('EBITDA'::finance_metric,          m.ebitda,  m.ebitda_rank,  m.ebitda_at),
      ('OperatingProfit'::finance_metric, m.op,      m.op_rank,      m.op_at),
      ('NetIncome'::finance_metric,       m.ni,      m.ni_rank,      m.ni_at),
      ('Cash'::finance_metric,            m.cash,    m.cash_rank,    m.cash_at),
      ('AR'::finance_metric,              m.ar,      m.ar_rank,      m.ar_at),
      ('AP'::finance_metric,              m.ap,      m.ap_rank,      m.ap_at)
    ) as x(metric, value, basis_rank, fetched_at)
   where x.value is not null
)
select l.period,
       l.business_id,
       l.metric,
       l.value::numeric(20, 2)          as value,
       null::numeric(20, 2)             as target,
       'KRW'::currency_code             as currency,
       (case l.basis_rank when 3 then 'estimate' when 2 then 'manual' else 'ecount' end)::data_source as source,
       l.basis_rank = 0                 as closed,
       l.fetched_at
  from ledger l
union all
-- ③ 원장이 전혀 없는 회사·달만 시트 행. 수기 꼬리표다.
select s.period, s.business_id, s.metric, s.value, s.target, s.currency,
       'manual'::data_source, false, s.updated_at
  from finance_kpis_sheet s
 where not exists (
   select 1 from finance_ledger_cells c where c.business_id = s.business_id and c.period = s.period
 );

comment on view finance_kpis is
  'CH-006~010. 원장에서 계산되는 지표. 결산(확정) > 전표(잠정) > 시트(수기). 수기 입력 경로는 없다.';

-- 0002의 필드 마스킹 뷰를 새 뷰 위에 다시 세운다. 모양은 그대로다.
create view finance_kpis_masked
with (security_invoker = true) as
select
  period,
  business_id,
  metric,
  case when can_read_restricted() then value else null end as value,
  case when can_read_restricted() then target else null end as target,
  currency,
  source,
  closed
from finance_kpis;
comment on view finance_kpis_masked is
  'Row는 원장 RLS가, Field는 이 뷰가 자른다. security_invoker=true라 뷰가 RLS를 우회하지 않는다.';
