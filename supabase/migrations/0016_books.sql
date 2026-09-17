-- =====================================================================
-- Chairman OS — 0016_books
-- 출처: Phase 2-B 자체 장부 입력 경로 / CH-052 / DEFERRED D-19 해소
-- 작성: Phase 2-B (2026-09-17)
--
-- 회계 원천은 자체 장부다. ECOUNT 공개 OAPI에 원장 조회가 없다(D-19) — 기다리지 않고 장부를 여기서 쓴다.
-- ECOUNT는 DY 엑셀 업로드로만 들어온다(별도 블록).
--
-- 원칙 셋
--   ① 모든 쓰기는 audit_log에 남는다.
--   ② 마감된 달은 고치지 않는다. 바꿀 것이 있으면 당월에 정정 전표를 넣는다.
--   ③ 차변 합 = 대변 합이 아니면 전표가 저장되지 않는다.
--
-- 권한 (04_권한 확장)
--   계정과목·전표 입력  Chairman · GroupCFO · BusinessCEO(자기 회사만)   can_keep_books(business_id)
--   월 마감             Chairman · GroupCFO                              can_close_books()
--
-- 이 파일이 만드는 것
--   1. 계정과목 관리    accounts.active, 코드 불변, 표준 계정과목표 시드
--   2. 전표 입력        journal_entries(헤더), 차대 일치·마감 달·비활성 계정 검사, post_journal_entry()
--                       꼬리표: 자체 장부 전표도 원장이다 — 마감 전 잠정, 마감 후 확정
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 판정 함수 — 0002의 판정 함수들과 같은 모양(security definer, 활성 사용자 먼저)
-- ---------------------------------------------------------------------

/** 이 회사의 장부(계정과목·전표)를 쓸 수 있는가. BusinessCEO는 자기 회사만. */
create or replace function can_keep_books(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and target is not null and case
    when auth_role() in ('Chairman', 'GroupCFO') then true
    when auth_role() = 'BusinessCEO' then has_business(target)
    else false
  end;
$fn$;

/** 월 마감을 할 수 있는가. 회사 범위는 부르는 쪽이 has_business()로 같이 본다. */
create or replace function can_close_books() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and auth_role() in ('Chairman', 'GroupCFO');
$fn$;

-- ---------------------------------------------------------------------
-- 1. 계정과목 관리
--    계정은 지우지 않는다(전표·결산이 FK로 문다). 대신 비활성화한다.
--    코드는 바뀌지 않는다 — 코드가 바뀌면 과거 전표가 다른 계정을 가리킨다. 이름·분류만 고친다.
--    화면에서 만든 계정은 source='manual'. 분류를 고친 ECOUNT 계정은 source를 그대로 둔다.
-- ---------------------------------------------------------------------
alter table accounts add column if not exists active boolean not null default true; -- [일반]
comment on column accounts.active is '0016. false = 비활성. 새 전표를 받지 않는다. 과거 숫자는 그대로 선다.';

create or replace function accounts_guard() returns trigger
language plpgsql as $fn$
begin
  if new.business_id is distinct from old.business_id or new.account_code is distinct from old.account_code then
    raise exception using errcode = 'P0001', message = 'account_code_immutable',
      detail = '계정코드는 바꿀 수 없다. 새 계정을 만들고 옛 계정을 비활성화한다.';
  end if;
  if new.source is distinct from old.source then
    raise exception using errcode = 'P0001', message = 'account_source_immutable';
  end if;
  return new;
end;
$fn$;

create trigger accounts_guard before update on accounts
  for each row execute function accounts_guard();

-- 0015의 Integration 정책과 나란히 선다(permissive끼리는 OR).
create policy accounts_books_insert on accounts
  for insert with check (can_keep_books(business_id) and source = 'manual');
create policy accounts_books_update on accounts
  for update using (can_keep_books(business_id))
  with check (can_keep_books(business_id));

-- 표준 계정과목표 — 한국 중소기업. 스타트업 네 곳에 같은 표.
-- src/lib/ledger/standard-chart.ts와 같다(scripts/check-migrations.ts가 한 줄씩 비교한다).
-- DY는 받지 않는다 — ECOUNT 코드 체계를 업로드 때 그대로 싣는다.
-- 없는 회사는 건너뛴다. 이미 있는 코드는 건드리지 않는다.
insert into accounts (business_id, account_code, name, category, section, cash_flow, source, fetched_at)
select b.business_id, v.code, v.name, v.category::account_category, v.section::account_section,
       v.cash_flow::cash_flow_class, 'manual', now()
  from businesses b
 cross join (values
    ('1010', '현금및현금성자산', 'asset', 'cash', null),
    ('1030', '보통예금', 'asset', 'cash', null),
    ('1080', '외상매출금', 'asset', 'receivable', 'operating'),
    ('1100', '받을어음', 'asset', 'receivable', 'operating'),
    ('1200', '미수금', 'asset', 'other_asset', 'operating'),
    ('1310', '선급금', 'asset', 'other_asset', 'operating'),
    ('1330', '선급비용', 'asset', 'other_asset', 'operating'),
    ('1350', '부가세대급금', 'asset', 'other_asset', 'operating'),
    ('1360', '가지급금', 'asset', 'other_asset', 'operating'),
    ('1400', '유형자산', 'asset', 'other_asset', 'investing'),
    ('1410', '감가상각누계액', 'asset', 'other_asset', null),
    ('1460', '상품', 'asset', 'other_asset', 'operating'),
    ('1500', '제품', 'asset', 'other_asset', 'operating'),
    ('1530', '원재료', 'asset', 'other_asset', 'operating'),
    ('1700', '무형자산', 'asset', 'other_asset', 'investing'),
    ('1960', '임차보증금', 'asset', 'other_asset', 'investing'),
    ('2010', '외상매입금', 'liability', 'payable', 'operating'),
    ('2520', '지급어음', 'liability', 'payable', 'operating'),
    ('2530', '미지급금', 'liability', 'other_liability', 'operating'),
    ('2540', '예수금', 'liability', 'other_liability', 'operating'),
    ('2550', '부가세예수금', 'liability', 'other_liability', 'operating'),
    ('2590', '선수금', 'liability', 'other_liability', 'operating'),
    ('2600', '차입금', 'liability', 'other_liability', 'financing'),
    ('2620', '미지급비용', 'liability', 'other_liability', 'operating'),
    ('2930', '장기차입금', 'liability', 'other_liability', 'financing'),
    ('2950', '퇴직급여충당부채', 'liability', 'other_liability', 'operating'),
    ('3310', '자본금', 'equity', 'equity', 'financing'),
    ('3410', '주식발행초과금', 'equity', 'equity', 'financing'),
    ('3750', '이월이익잉여금', 'equity', 'equity', 'financing'),
    ('4010', '제품매출', 'revenue', 'revenue', null),
    ('4020', '상품매출', 'revenue', 'revenue', null),
    ('4030', '용역매출', 'revenue', 'revenue', null),
    ('4510', '원재료비', 'raw_material', 'cogs', null),
    ('4520', '제조인건비', 'labor', 'cogs', null),
    ('4530', '전력비', 'electricity', 'cogs', null),
    ('4540', '운반비', 'freight', 'cogs', null),
    ('4550', '라이선스료', 'license', 'cogs', null),
    ('4590', '기타제조경비', 'other', 'cogs', null),
    ('4600', '외주가공비', 'other', 'cogs', null),
    ('4610', '상품매출원가', 'raw_material', 'cogs', null),
    ('8010', '급여(판관)', 'labor', 'sga', null),
    ('8030', '상여금', 'labor', 'sga', null),
    ('8050', '퇴직급여', 'labor', 'sga', null),
    ('8110', '복리후생비', 'labor', 'sga', null),
    ('8120', '여비교통비', 'other', 'sga', null),
    ('8130', '접대비', 'other', 'sga', null),
    ('8140', '통신비', 'other', 'sga', null),
    ('8150', '수도광열비', 'electricity', 'sga', null),
    ('8170', '세금과공과', 'other', 'sga', null),
    ('8190', '지급수수료', 'other', 'sga', null),
    ('8220', '지급임차료', 'other', 'sga', null),
    ('8230', '보험료', 'other', 'sga', null),
    ('8240', '차량유지비', 'other', 'sga', null),
    ('8250', '운반비(판관)', 'freight', 'sga', null),
    ('8260', '도서인쇄비', 'other', 'sga', null),
    ('8300', '소모품비', 'other', 'sga', null),
    ('8330', '광고선전비', 'other', 'sga', null),
    ('8340', '소프트웨어사용료', 'license', 'sga', null),
    ('8350', '연구개발비', 'other', 'sga', null),
    ('8210', '감가상각비', 'other', 'd_and_a', null),
    ('8280', '무형자산상각비', 'other', 'd_and_a', null),
    ('9010', '영업외수익', 'other', 'non_operating', null),
    ('9020', '이자수익', 'other', 'non_operating', null),
    ('9310', '이자비용', 'other', 'non_operating', null),
    ('9320', '외환차손', 'other', 'non_operating', null),
    ('9330', '잡손실', 'other', 'non_operating', null),
    ('9980', '법인세비용', 'other', 'tax', null)
 ) as v(code, name, category, section, cash_flow)
 where b.business_id in ('biz_vana', 'biz_sticky', 'biz_hof', 'biz_boram')
on conflict (business_id, account_code) do nothing;

-- ---------------------------------------------------------------------
-- 2. 전표 입력
--
--   전표 = 헤더(journal_entries: 일자·적요·증빙링크) + 라인 N개(journal_lines: 계정·차대·금액).
--   ECOUNT·mock 라인에는 헤더가 없다(전표번호로만 묶인다). 자체 장부 라인(source='manual')은 헤더가 있어야 한다.
--
--   DB가 지키는 것 — 앱이 무엇을 보내든
--     ③ 차변 합 = 대변 합, 라인 두 줄 이상     journal_slip_balanced (트랜잭션 끝에 잰다 — deferred)
--     ② 마감된 달(과 그 이전)에는 넣지 못한다   journal_lines_manual_guard → closed_period
--        비활성 계정에는 넣지 못한다           journal_lines_manual_guard → inactive_account
--     ① 감사 기록                              post_journal_entry()가 같은 트랜잭션에서 남긴다
--
--   헤더와 라인을 두 번의 HTTP로 넣으면 중간에 끊겼을 때 반쪽 전표가 남는다. 그래서 입력은
--   post_journal_entry() 한 번의 호출이다(PostgREST RPC = 한 트랜잭션). security invoker라 RLS가 그대로 걸린다.
-- ---------------------------------------------------------------------

create sequence if not exists journal_slip_seq;
grant usage on sequence journal_slip_seq to authenticated;

create table journal_entries (
  business_id  text not null references businesses(business_id) on delete restrict, -- [일반]
  slip_no      text not null,                                                      -- [일반] M{YYMM}-{일련번호}
  entry_date   date not null,                                                      -- [일반]
  memo         text not null check (length(trim(memo)) > 0),                       -- [제한] 적요. 거래처 이름이 들어온다
  evidence_url text check (evidence_url is null or evidence_url ~* '^https?://'),  -- [제한] 증빙 링크. 파일은 사내 스토리지(CLAUDE.md)
  created_by   uuid not null default auth.uid(),                                   -- [제한]
  created_at   timestamptz not null default now(),
  primary key (business_id, slip_no)
);
comment on table journal_entries is
  '0016. 자체 장부 전표의 헤더. 라인은 journal_lines(source=manual). 고치지 않는다 — 정정 전표로 바로잡는다.';

alter table journal_entries enable row level security;
alter table journal_entries force row level security;

create policy journal_entries_read on journal_entries
  for select using (has_business(business_id) and can_read_restricted());
create policy journal_entries_insert on journal_entries
  for insert with check (can_keep_books(business_id) and created_by = auth.uid());
-- update / delete 정책 없음(Default Deny). 전표는 고치지 않는다.

create policy ai_agent_no_insert on journal_entries as restrictive for insert
  with check (auth_role() is distinct from 'AIAgent');
create policy integration_no_insert on journal_entries as restrictive for insert
  with check (not is_integration());

-- 자체 장부 라인. 0015의 Integration 정책(source='ecount')과 나란히 선다.
create policy journal_lines_books_insert on journal_lines
  for insert with check (can_keep_books(business_id) and source = 'manual' and not closed);

create or replace function journal_lines_manual_guard() returns trigger
language plpgsql as $fn$
declare
  v_period text := to_char(new.entry_date, 'YYYY-MM');
begin
  if not exists (
    select 1 from journal_entries e
     where e.business_id = new.business_id and e.slip_no = new.slip_no and e.entry_date = new.entry_date
  ) then
    raise exception using errcode = 'P0001', message = 'missing_entry_header',
      detail = '자체 장부 라인은 같은 날짜의 전표 헤더가 있어야 한다.';
  end if;
  -- 마감된 달이거나, 그보다 앞선 달. 마감 스냅샷 뒤에 과거 전표가 끼어들면 상태표 잔액이 어긋난다.
  if exists (select 1 from closings c where c.business_id = new.business_id and c.period >= v_period) then
    raise exception using errcode = 'P0001', message = 'closed_period',
      detail = format('%s는 마감됐다(또는 그 뒤 달이 마감됐다). 당월에 정정 전표로 입력한다.', v_period);
  end if;
  if not exists (
    select 1 from accounts a
     where a.business_id = new.business_id and a.account_code = new.account_code and a.active
  ) then
    raise exception using errcode = 'P0001', message = 'inactive_account',
      detail = format('계정 %s는 비활성이거나 없다.', new.account_code);
  end if;
  return new;
end;
$fn$;

create trigger journal_lines_manual_guard before insert on journal_lines
  for each row when (new.source = 'manual') execute function journal_lines_manual_guard();

/** 전표 한 장의 차대. 헤더와 라인 어느 쪽에 걸어도 같은 전표를 잰다(둘 다 business_id · slip_no가 있다). */
create or replace function journal_slip_balanced() returns trigger
language plpgsql as $fn$
declare
  v_dr numeric;
  v_cr numeric;
  v_n  int;
begin
  select coalesce(sum(amount) filter (where side = 'debit'), 0),
         coalesce(sum(amount) filter (where side = 'credit'), 0),
         count(*)
    into v_dr, v_cr, v_n
    from journal_lines
   where business_id = new.business_id and slip_no = new.slip_no;
  if v_n < 2 or v_dr <> v_cr then
    raise exception using errcode = 'P0001', message = 'unbalanced_slip',
      detail = format('전표 %s: 라인 %s줄, 차변 %s / 대변 %s', new.slip_no, v_n, v_dr, v_cr);
  end if;
  return null;
end;
$fn$;

create constraint trigger journal_lines_balanced after insert on journal_lines
  deferrable initially deferred
  for each row when (new.source = 'manual') execute function journal_slip_balanced();
create constraint trigger journal_entries_balanced after insert on journal_entries
  deferrable initially deferred
  for each row execute function journal_slip_balanced();

/**
 * 전표 한 장을 넣는다. 감사 기록 + 헤더 + 라인이 한 트랜잭션이다.
 * p_lines: [{"account_code":"1030","side":"debit","amount":1000000,"memo":"선택"}, ...]
 * 전표번호를 돌려준다.
 */
create or replace function post_journal_entry(
  p_business_id  text,
  p_entry_date   date,
  p_memo         text,
  p_evidence_url text,
  p_lines        jsonb
) returns text
language plpgsql security invoker set search_path = public as $fn$
declare
  v_slip text;
  v_line jsonb;
  v_no   int := 0;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'unbalanced_slip', detail = '라인이 배열이 아니다.';
  end if;
  v_slip := 'M' || to_char(p_entry_date, 'YYMM') || '-' || lpad(nextval('journal_slip_seq')::text, 6, '0');

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
  values ('create', 'journal_entries', v_slip, p_business_id, auth.uid(), auth_role()::text,
          jsonb_build_object('entry_date', p_entry_date, 'memo', p_memo, 'evidence_url', p_evidence_url, 'lines', p_lines),
          '전표 입력');

  insert into journal_entries (business_id, slip_no, entry_date, memo, evidence_url)
  values (p_business_id, v_slip, p_entry_date, trim(p_memo), nullif(trim(coalesce(p_evidence_url, '')), ''));

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_no := v_no + 1;
    insert into journal_lines (business_id, entry_date, account_code, amount, side, slip_no, line_no, memo, source, fetched_at)
    values (p_business_id, p_entry_date, v_line->>'account_code', (v_line->>'amount')::numeric,
            (v_line->>'side')::dr_cr, v_slip, v_no, coalesce(nullif(trim(v_line->>'memo'), ''), trim(p_memo)),
            'manual', now());
  end loop;
  return v_slip;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 2-1. 꼬리표 규칙 — 자체 장부 전표·결산도 원장이다
--
--   0015는 source='manual'을 늘 '수기'(rank 2)로 봤다. 그때 manual은 '사람이 손으로 친 숫자'(시트값)였다.
--   이제 원장 표(전표·결산)의 manual은 복식부기 장부 — 차대가 맞고 마감으로 확정된다. 그래서
--     원장 표   estimate → 추정(3) / 마감 → 확정(0) / 마감 전 → 잠정(1)     ← ECOUNT와 같은 규칙
--     시트 행   수기(2) — 뷰의 ③ 절이 따로 붙인다(바뀌지 않음)
--     환율·지수 lib/ledger/basis.ts basisOf — manual은 여전히 수기(원장이 아니다)
--   lib/ledger/basis.ts의 ledgerBasisOf와 같은 규칙이다.
--
--   finance_kpis에 basis 칸을 더한다. source 한 칸으로는 '자체 장부 잠정'과 '시트 수기'를 가를 수 없다.
--   source는 정직하게 — 자체 장부 칸이 하나라도 섞인 지표는 manual, ECOUNT만이면 ecount.
--   뷰는 칸을 끝에만 더한다(create or replace view의 규칙). 0015의 칸 순서는 그대로다.
-- ---------------------------------------------------------------------
create or replace function figure_rank(src data_source, is_closed boolean) returns int
language sql immutable as $fn$
  select case
    when src = 'estimate' then 3
    when is_closed then 0
    else 1
  end;
$fn$;

create or replace view finance_ledger_cells
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
closing_cells as (
  select c.business_id, c.period, c.account_code, c.amount,
         figure_rank(c.source, c.closed) as basis_rank, c.fetched_at, c.source = 'manual' as has_manual
    from closings c
),
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
         min(j.fetched_at) as fetched_at,
         bool_or(j.source = 'manual') as has_manual
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
         figure_rank(c.source, c.closed) as basis_rank, c.fetched_at, c.source = 'manual' as has_manual
    from open_periods o
    join closings c
      on c.business_id = o.business_id and c.period = o.prior_close
    join accounts a
      on a.business_id = c.business_id and a.account_code = c.account_code
   where a.section in ('cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity')
  union all
  select o.business_id, o.period, j.account_code,
         case when j.side = 'debit' then j.amount else -j.amount end,
         figure_rank(j.source, j.closed), j.fetched_at, j.source = 'manual'
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
         max(basis_rank) as basis_rank, min(fetched_at) as fetched_at, bool_or(has_manual) as has_manual
    from open_bs_parts
   group by business_id, period, account_code
),
cells as (
  select business_id, period, account_code, amount, basis_rank, fetched_at, has_manual from closing_cells
  union all
  select business_id, period, account_code, amount, basis_rank, fetched_at, has_manual from open_pl
  union all
  select business_id, period, account_code, amount, basis_rank, fetched_at, has_manual from open_bs
)
select c.business_id, c.period, c.account_code, a.section, a.category,
       c.amount, c.basis_rank, c.fetched_at, c.has_manual
  from cells c
  join accounts a on a.business_id = c.business_id and a.account_code = c.account_code;

create or replace view finance_kpis
with (security_invoker = true) as
with m as (
  select business_id, period,
    -sum(amount) filter (where section = 'revenue')                                                     as revenue,
     max(basis_rank) filter (where section = 'revenue')                                                 as revenue_rank,
     min(fetched_at) filter (where section = 'revenue')                                                 as revenue_at,
     bool_or(has_manual) filter (where section = 'revenue')                                             as revenue_manual,
     sum(amount) filter (where section = 'cogs')                                                        as cost,
     max(basis_rank) filter (where section = 'cogs')                                                    as cost_rank,
     min(fetched_at) filter (where section = 'cogs')                                                    as cost_at,
     bool_or(has_manual) filter (where section = 'cogs')                                                as cost_manual,
    -sum(amount) filter (where section in ('revenue', 'cogs', 'sga'))                                   as ebitda,
     max(basis_rank) filter (where section in ('revenue', 'cogs', 'sga'))                               as ebitda_rank,
     min(fetched_at) filter (where section in ('revenue', 'cogs', 'sga'))                               as ebitda_at,
     bool_or(has_manual) filter (where section in ('revenue', 'cogs', 'sga'))                           as ebitda_manual,
    -sum(amount) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a'))                        as op,
     max(basis_rank) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a'))                    as op_rank,
     min(fetched_at) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a'))                    as op_at,
     bool_or(has_manual) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a'))                as op_manual,
    -sum(amount) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax')) as ni,
     max(basis_rank) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax')) as ni_rank,
     min(fetched_at) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax')) as ni_at,
     bool_or(has_manual) filter (where section in ('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax')) as ni_manual,
     sum(amount) filter (where section = 'cash')                                                        as cash,
     max(basis_rank) filter (where section = 'cash')                                                    as cash_rank,
     min(fetched_at) filter (where section = 'cash')                                                    as cash_at,
     bool_or(has_manual) filter (where section = 'cash')                                                as cash_manual,
     sum(amount) filter (where section = 'receivable')                                                  as ar,
     max(basis_rank) filter (where section = 'receivable')                                              as ar_rank,
     min(fetched_at) filter (where section = 'receivable')                                              as ar_at,
     bool_or(has_manual) filter (where section = 'receivable')                                          as ar_manual,
    -sum(amount) filter (where section = 'payable')                                                     as ap,
     max(basis_rank) filter (where section = 'payable')                                                 as ap_rank,
     min(fetched_at) filter (where section = 'payable')                                                 as ap_at,
     bool_or(has_manual) filter (where section = 'payable')                                             as ap_manual
  from finance_ledger_cells
  group by business_id, period
),
ledger as (
  select m.period, m.business_id, x.metric, x.value, x.basis_rank, x.fetched_at, x.has_manual
    from m
    cross join lateral (values
      ('Revenue'::finance_metric,         m.revenue, m.revenue_rank, m.revenue_at, m.revenue_manual),
      ('Cost'::finance_metric,            m.cost,    m.cost_rank,    m.cost_at,    m.cost_manual),
      ('EBITDA'::finance_metric,          m.ebitda,  m.ebitda_rank,  m.ebitda_at,  m.ebitda_manual),
      ('OperatingProfit'::finance_metric, m.op,      m.op_rank,      m.op_at,      m.op_manual),
      ('NetIncome'::finance_metric,       m.ni,      m.ni_rank,      m.ni_at,      m.ni_manual),
      ('Cash'::finance_metric,            m.cash,    m.cash_rank,    m.cash_at,    m.cash_manual),
      ('AR'::finance_metric,              m.ar,      m.ar_rank,      m.ar_at,      m.ar_manual),
      ('AP'::finance_metric,              m.ap,      m.ap_rank,      m.ap_at,      m.ap_manual)
    ) as x(metric, value, basis_rank, fetched_at, has_manual)
   where x.value is not null
)
select l.period,
       l.business_id,
       l.metric,
       l.value::numeric(20, 2)          as value,
       null::numeric(20, 2)             as target,
       'KRW'::currency_code             as currency,
       (case when l.basis_rank = 3 then 'estimate' when l.has_manual then 'manual' else 'ecount' end)::data_source as source,
       l.basis_rank = 0                 as closed,
       l.fetched_at,
       case l.basis_rank when 0 then 'confirmed' when 1 then 'provisional' else 'estimate' end as basis
  from ledger l
union all
select s.period, s.business_id, s.metric, s.value, s.target, s.currency,
       'manual'::data_source, false, s.updated_at, 'manual'
  from finance_kpis_sheet s
 where not exists (
   select 1 from finance_ledger_cells c where c.business_id = s.business_id and c.period = s.period
 );

comment on view finance_kpis is
  'CH-006~010. 원장에서 계산되는 지표. 결산(확정) > 전표(잠정) > 시트(수기). 꼬리표는 basis 칸이다(0016).';
