-- =====================================================================
-- Chairman OS — 0096_investment_portfolio (Investment Intelligence 3단계 — DY Portfolio · Performance & Learning)
-- 작성: 2026-10-25 · 지시 docs/specs/2026-10-24-investment-intelligence.txt PART 12 · 13 · 설계 docs/specs/investment-design.md
--
-- ■ 더하는 것 ■ (Expand-only — 새 표 · 새 칸(기본값/null) · 새 함수 · 전자결재 양식 줄 하나)
--   1절 Real Portfolio — corporate_investment_accounts(법인 계좌 · 번호 끝 4자리만) · corporate_investment_approvals(투자 승인 ↔ 전자결재 문서) ·
--        corporate_transactions(손 입력 · 덧붙이기만 — 매수 · 매도는 «승인 완료»된 투자 승인이 있어야 하고 승인자 · 승인 시각을 결재에서 옮겨 적는다)
--   2절 Research / Paper Portfolio — paper_portfolios · paper_transactions(추천 신호 시각 ≠ 매매 가능 시각) — 실제 돈 없음, Real과 섞지 않음
--   3절 Performance — recommendation_outcomes(기간별 성과 · 상장폐지 표시 · 실패 원인 9분류) — 덧붙이기만
--   4절 전자결재(0087) 양식 «투자 승인»(investment) 하나 — 0093(«대표» 이름)은 읽기 함수가 하므로 새 양식도 그대로 적용된다
--   5절 RLS — Real · 승인 · 거래: 대표(쓰기) · 지정자(읽기 · 승인 올리기)만. 수집 · AI 계정은 읽기도 0행.
--        Paper · 성과: 읽기 대표 · 지정자 · AI / INSERT만(AI · 대표). 모두 UPDATE · DELETE 없음(정정은 새 줄).
-- 실거래 · 증권사 연동 · 자동 주문 없음 — 거래는 사람이 증권사에서 하고 여기 손으로 적는다.
-- =====================================================================

begin;

-- =====================================================================
-- 0절. 설정 칸 — 월 적립 계획의 ETF(대표가 고른다)
-- =====================================================================
alter table investment_settings
  add column plan_equity_security uuid references securities(security_id) on delete restrict,
  add column plan_bond_security   uuid references securities(security_id) on delete restrict;

-- =====================================================================
-- 1절. Real Portfolio
-- =====================================================================
create table corporate_investment_accounts (
  account_id    uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 2 and 60),
  broker        text not null check (length(btrim(broker)) between 2 and 60),
  account_last4 text check (account_last4 ~ '^[0-9]{4}$'),        -- 계좌번호 전체는 저장하지 않는다
  owner_entity  text not null default 'DAE YANG Industry',         -- 법인 명의(개인 계좌와 섞지 않는다)
  currency      text not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  opened_at     date,
  note          text,
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now()
);

create table corporate_investment_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('monthly_plan', 'trade', 'plan_change')),
  title       text not null check (length(btrim(title)) between 2 and 120),
  amount_krw  bigint not null check (amount_krw >= 0),
  security_id uuid references securities(security_id) on delete restrict,
  side        text check (side in ('buy', 'sell')),
  ea_doc_id   uuid not null unique references ea_docs(doc_id) on delete restrict,
  rec_id      uuid references investment_recommendations(rec_id) on delete restrict,
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint corporate_investment_approvals_trade check (kind <> 'trade' or (security_id is not null and side is not null))
);

create table corporate_transactions (
  tx_id           bigint generated always as identity primary key,
  account_id      uuid not null references corporate_investment_accounts(account_id) on delete restrict,
  trade_date      date not null,
  kind            text not null check (kind in ('deposit', 'withdraw', 'buy', 'sell', 'dividend', 'fee', 'tax', 'fx', 'adjust')),
  security_id     uuid references securities(security_id) on delete restrict,
  shares          numeric check (shares > 0),
  price           numeric check (price > 0),
  currency        text not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  fx_rate         numeric check (fx_rate > 0),                    -- 그 통화 1단위 = 원(KRW면 1)
  amount          numeric not null check (amount >= 0),           -- 그 통화 금액(부호 없음 — 종류가 방향)
  amount_krw      numeric not null check (amount_krw >= 0),
  fees_krw        numeric not null default 0 check (fees_krw >= 0),
  tax_krw         numeric not null default 0 check (tax_krw >= 0),
  approval_id     uuid references corporate_investment_approvals(approval_id) on delete restrict,
  approved_by_name text,                                            -- 결재에서 옮겨 적음(트리거)
  approved_at     timestamptz,                                      -- 결재 승인 시각(트리거)
  note            text,
  entered_by      uuid not null default auth.uid(),
  entered_at      timestamptz not null default now(),
  constraint corporate_transactions_trade check (kind not in ('buy', 'sell') or (security_id is not null and shares is not null and price is not null and approval_id is not null)),
  constraint corporate_transactions_adjust check (kind <> 'adjust' or length(btrim(coalesce(note, ''))) >= 4)
);
create index corporate_transactions_by_account on corporate_transactions (account_id, trade_date);

/**
 * 매수 · 매도는 «승인 완료»된 투자 승인(전자결재 문서 status = approved)이 있어야 들어간다.
 * 승인자(마지막 승인 단계 처리자 이름 — 0093 규칙대로 대표 단계는 «대표») · 승인 시각(decided_at)을 결재에서 옮겨 적는다.
 */
create or replace function corporate_transaction_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_doc  ea_docs;
  v_name text;
begin
  new.entered_by := auth.uid();
  new.entered_at := now();
  if new.kind in ('buy', 'sell') then
    select d.* into v_doc from corporate_investment_approvals a join ea_docs d on d.doc_id = a.ea_doc_id where a.approval_id = new.approval_id;
    if v_doc.doc_id is null or v_doc.status <> 'approved' then
      raise exception 'investment_trade_not_approved' using errcode = '42501';
    end if;
    select s.approver_name into v_name from ea_steps s where s.doc_id = v_doc.doc_id and s.status = 'approved' and s.kind = 'approve' order by s.seq desc limit 1;
    new.approved_by_name := coalesce(v_name, '승인자 미상');
    new.approved_at := v_doc.decided_at;
  else
    new.approved_by_name := null;
    new.approved_at := null;
  end if;
  return new;
end
$fn$;
create trigger corporate_transactions_guard before insert on corporate_transactions for each row execute function corporate_transaction_guard();

/** 투자 승인의 결재 상태(읽기 — 대표 · 지정자). ea_docs를 직접 열지 않고 이 함수로만. */
create or replace function investment_approval_states()
returns table (approval_id uuid, status text, decided_at timestamptz, doc_no text, approver_name text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select a.approval_id, d.status, d.decided_at, d.doc_no,
         (select s.approver_name from ea_steps s where s.doc_id = d.doc_id and s.status = 'approved' and s.kind = 'approve' order by s.seq desc limit 1)
    from corporate_investment_approvals a join ea_docs d on d.doc_id = a.ea_doc_id
   where inv_reader();
$fn$;

-- =====================================================================
-- 2절. Research / Paper Portfolio
-- =====================================================================
create table paper_portfolios (
  portfolio_id   uuid primary key default gen_random_uuid(),
  name           text not null,
  rule           text not null,
  base_currency  text not null default 'USD' check (base_currency ~ '^[A-Z]{3}$'),
  notional       numeric not null default 10000 check (notional > 0),   -- 종목당 가상 금액
  started_at     date not null default (now() at time zone 'Asia/Seoul')::date,
  created_by     uuid default auth.uid(),
  created_kind   text not null default 'system' check (created_kind in ('human', 'ai', 'system')),
  created_at     timestamptz not null default now()
);
insert into paper_portfolios (name, rule) values
  ('AI 추천 검증(Research)', '추천이 처음 WATCH · BUY ZONE이 된 다음 거래일에 종목당 USD 10,000 가상 매수, OVERVALUED · THESIS BROKEN이 되면 다음 거래일 가상 매도. 실제 돈 · 주문 없음.');

create table paper_transactions (
  tx_id         bigint generated always as identity primary key,
  portfolio_id  uuid not null references paper_portfolios(portfolio_id) on delete restrict,
  security_id   uuid not null references securities(security_id) on delete restrict,
  side          text not null check (side in ('buy', 'sell')),
  signal_at     timestamptz not null,                 -- 추천(신호)이 만들어진 시각
  trade_date    date not null,                        -- 실제 매매 가능 날(신호 다음 거래일)
  shares        numeric not null check (shares > 0),
  price         numeric not null check (price > 0),
  price_source  text not null,
  rec_id        uuid references investment_recommendations(rec_id) on delete restrict,
  note          text,
  created_by    uuid default auth.uid(),
  created_kind  text not null check (created_kind in ('human', 'ai', 'system')),
  created_at    timestamptz not null default now(),
  constraint paper_transactions_after_signal check (trade_date > (signal_at at time zone 'Asia/Seoul')::date)
);

-- =====================================================================
-- 3절. 추천 성과(덧붙이기만)
-- =====================================================================
create table recommendation_outcomes (
  outcome_id          bigint generated always as identity primary key,
  rec_id              uuid not null references investment_recommendations(rec_id) on delete restrict,
  security_id         uuid not null references securities(security_id) on delete restrict,
  horizon_months      integer not null check (horizon_months in (1, 3, 6, 12, 24, 36, 60)),
  entry_date          date,
  entry_price         numeric,
  exit_date           date,
  exit_price          numeric,
  return_pct          numeric,
  benchmark_return_pct numeric,
  excess_pct          numeric,
  delisted            boolean not null default false,
  failure_cause       text check (failure_cause in ('market_forecast', 'competitiveness', 'earnings_cashflow', 'buy_price_overestimated', 'multiple_contraction', 'macro', 'fx', 'data_error', 'thesis_broken')),
  cause_basis         text check (cause_basis in ('human', 'ai_inferred')),
  note                text,
  calculation_version text not null,
  created_by          uuid default auth.uid(),
  created_kind        text not null check (created_kind in ('human', 'ai', 'system')),
  created_at          timestamptz not null default now(),
  constraint recommendation_outcomes_cause check (failure_cause is null or cause_basis is not null)
);
create index recommendation_outcomes_by_rec on recommendation_outcomes (rec_id, horizon_months);

-- =====================================================================
-- 4절. 전자결재 양식 «투자 승인» — 대표(또는 지정자)가 올리고 결재로 승인. 금액은 total(원)
-- =====================================================================
insert into ea_forms (form_key, name_ko, fields, attachment_required, followup_kind, followup_required, note, sort_order) values
  ('investment', '투자 승인', '[
     {"key":"kind","label":"구분","type":"select","required":true,"options":["월 정기 적립","개별 매수","개별 매도","계획 변경"]},
     {"key":"target","label":"종목 · ETF · 계좌","type":"text","required":true},
     {"key":"total","label":"금액(원)","type":"money","required":true},
     {"key":"rationale","label":"근거(추천 버전 · 매수 기준가 · 출처)","type":"textarea","required":true},
     {"key":"rec_ref","label":"추천 링크","type":"text","required":false}
   ]'::jsonb, false, '투자 집행(손 입력)', false, '실거래는 사람이 증권사에서 합니다 — 이 시스템은 주문하지 않습니다. 승인 뒤 DY Portfolio에 거래를 손으로 적습니다.', 60)
on conflict (form_key) do nothing;

-- 덧붙이기만 트리거(0095 investment_append_only 재사용)
create trigger corporate_investment_approvals_append_only before update or delete on corporate_investment_approvals for each row execute function investment_append_only();
create trigger corporate_transactions_append_only before update or delete on corporate_transactions for each row execute function investment_append_only();
create trigger paper_transactions_append_only before update or delete on paper_transactions for each row execute function investment_append_only();
create trigger recommendation_outcomes_append_only before update or delete on recommendation_outcomes for each row execute function investment_append_only();

-- =====================================================================
-- 5절. RLS · grant
-- =====================================================================
alter table corporate_investment_accounts enable row level security;
alter table corporate_investment_approvals enable row level security;
alter table corporate_transactions enable row level security;
alter table paper_portfolios enable row level security;
alter table paper_transactions enable row level security;
alter table recommendation_outcomes enable row level security;
revoke all on table corporate_investment_accounts, corporate_investment_approvals, corporate_transactions, paper_portfolios, paper_transactions, recommendation_outcomes from public, anon, authenticated;

-- Real · 승인 · 거래 — 읽기 대표 · 지정자 / 계좌 · 거래 쓰기 대표만 / 승인 올리기 대표 · 지정자(본인 이름)
grant select, insert, update on table corporate_investment_accounts to authenticated;
grant select, insert on table corporate_investment_approvals to authenticated;
grant select, insert on table corporate_transactions to authenticated;
create policy corporate_accounts_read on corporate_investment_accounts for select to authenticated using (inv_reader());
create policy corporate_accounts_insert on corporate_investment_accounts for insert to authenticated with check (inv_admin() and created_by = auth.uid());
create policy corporate_accounts_update on corporate_investment_accounts for update to authenticated using (inv_admin()) with check (inv_admin());
create policy corporate_approvals_read on corporate_investment_approvals for select to authenticated using (inv_reader());
create policy corporate_approvals_insert on corporate_investment_approvals for insert to authenticated with check (inv_reader() and created_by = auth.uid());
create policy corporate_transactions_read on corporate_transactions for select to authenticated using (inv_reader());
create policy corporate_transactions_insert on corporate_transactions for insert to authenticated with check (inv_admin());

-- Paper · 성과 — 읽기 대표 · 지정자 · AI / INSERT만(AI · 대표)
grant select on table paper_portfolios to authenticated;
grant select, insert on table paper_transactions to authenticated;
grant select, insert on table recommendation_outcomes to authenticated;
create policy paper_portfolios_read on paper_portfolios for select to authenticated using (inv_analysis_reader());
create policy paper_transactions_read on paper_transactions for select to authenticated using (inv_analysis_reader());
create policy paper_transactions_insert on paper_transactions for insert to authenticated with check ((inv_admin() or inv_analyst()) and created_by = auth.uid());
create policy recommendation_outcomes_read on recommendation_outcomes for select to authenticated using (inv_analysis_reader());
create policy recommendation_outcomes_insert on recommendation_outcomes for insert to authenticated with check ((inv_admin() or inv_analyst()) and created_by = auth.uid());

-- 시스템 계정 — Real · 승인 · 거래는 읽기도 0행(restrictive). 수집 계정은 Paper · 성과도 0행 · 쓰기 거부.
do $$
declare
  t text;
begin
  foreach t in array array['corporate_investment_accounts', 'corporate_investment_approvals', 'corporate_transactions'] loop
    execute format('create policy system_no_read on public.%I as restrictive for select to authenticated using (coalesce(auth_role()::text, '''') not in (''AIAgent'', ''Integration''))', t);
    execute format('create policy system_no_insert on public.%I as restrictive for insert to authenticated with check (coalesce(auth_role()::text, '''') not in (''AIAgent'', ''Integration''))', t);
  end loop;
  foreach t in array array['paper_portfolios', 'paper_transactions', 'recommendation_outcomes'] loop
    execute format('create policy integration_no_read on public.%I as restrictive for select to authenticated using (not coalesce(is_integration(), false))', t);
    execute format('create policy integration_no_insert on public.%I as restrictive for insert to authenticated with check (not coalesce(is_integration(), false))', t);
  end loop;
end
$$;

do $$
declare
  s text;
begin
  foreach s in array array['corporate_transactions_tx_id_seq', 'paper_transactions_tx_id_seq', 'recommendation_outcomes_outcome_id_seq'] loop
    execute format('revoke all on sequence public.%I from public, anon', s);
    execute format('grant usage, select on sequence public.%I to authenticated', s);
  end loop;
end
$$;
revoke all on function corporate_transaction_guard() from public, anon, authenticated;
revoke all on function investment_approval_states() from public, anon;
grant execute on function investment_approval_states() to authenticated;

commit;
