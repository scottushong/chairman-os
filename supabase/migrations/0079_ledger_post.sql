-- =====================================================================
-- Chairman OS — 0079_ledger_post (PHASE 7 «장부 반영 — 계정별 원장(⑤) → 회계 장부»)
-- 작성: 2026-10-13 · 자율 블록 PHASE 7 · 원문 docs/specs/2026-10-12-autonomous-block-phases.txt · 결정 docs/decisions/2026-10-12-autonomous.md
--
-- ■ 왜 ■ 0070 · 0072가 받아 둔 ⑤ 계정별 원장 줄(fin_ledger_lines)은 장부(journal_entries · journal_lines, 0015 · 0016)에 들어가지 않는다.
--   «반영 대기 → 반영» 2단계로 장부 전표를 만든다. 장부 쓰기 길은 0016 post_journal_entry · post_correction 그대로다(새로 쓰지 않는다).
--
-- ■ 무엇 ■
--   1. fin_ledger_posts — 반영 한 건(대기 pending → 반영 posted → 무효 voided). 원장 줄 묶음 · 상대 계정(차대가 안 맞을 때) · 전표 날짜 ·
--      전표번호 · 역분개 번호 · 이유. fin_ledger_post_lines — 한 원장 줄은 살아 있는(대기 · 반영) 건 하나에만(유일 색인). 지우지 않는다.
--   2. ledger_post_stage(회사, 줄들, 상대 계정, 날짜, 이유) — 반영 대기.
--        · 같은 거래(0072 fin_tx_groups): 'same' 묶음에 든 원장 줄은 그 묶음의 다른 원장 줄까지 함께 들어간다(한 번만 반영) ·
--          'suspect' 묶음 줄은 거부(사람이 0072 fin_tx_group_decide로 정한 뒤) · 'rejected'(풀린) 묶음은 따로.
--        · 같은 달 줄만 · 장부에 ECOUNT 전표(source 'ecount')가 이미 있는 달은 거부(이중 반영 막기 — ECOUNT 업로드가 장부 원천).
--        · 마감 달(0016 closings 확정 · 0075 fin_pl_closes 내부 마감 확정)은 대표 · 그룹 CFO만 + 이유. 0016 마감 달은 전표 날짜를
--          열린 달로 줘야 한다(0016 트리거 closed_period — 당월 정정 원칙).
--   3. ledger_post_apply(건, 이유) — 반영. 0016 post_journal_entry(헤더 + 라인 + 차대 + 마감 · 비활성 계정 검사 + 감사)를 부른다.
--      원장 차변 줄 → debit · 대변 줄 → credit · 차대 차이는 상대 계정 한 줄. 반영 순간에 마감 · ECOUNT 검사를 다시 본다.
--   4. ledger_post_void(건, 이유) — 대기는 무효(줄 풀림) · 반영은 0016 post_correction(역분개만)으로 무효 처리. 지우지 않는다.
--   5. ledger_post_queue(회사, 달) — 원장 줄 + 상태(대기 전 · 대기 · 반영) + 같은 거래 묶음 표시.
--
-- ■ 0075와 이중 반영 없음(4510 원재료비) ■ 0075 월별 손익은 장부 원재료비(cogs 구역 · 대분류 raw_material · 4610 제외)를
--   재고 반영 매출원가로 **교체**한다(더하지 않는다). 그래서 원장의 4510 줄을 장부에 넣어도 0075 매출원가는 입고명세서 · 재고에서만 나온다 —
--   장부 4510은 0075에서 검산(«purchase_vs_books_diff» 경고) · 기존 장부 영업이익 칸에만 쓰인다. 이 파일은 4510을 바꾸거나 다른 계정으로
--   돌리지 않는다(0075 설정 그대로). 0075 확정 달에 반영하면 그 달 입력 해시가 바뀌어 0075가 «자료 바뀜»으로 보인다(덮어쓰지 않는다).
--
-- 판정: 모든 RPC 첫 줄 feature_on('ledger_post', 회사)(0073 · 기본 대표만) · 그다음 can_keep_books(회사)(0016 — 대표 · CFO · 회사 대표).
-- 0035 규칙: 0001~0078을 고치지 않는다 · FORCE를 새로 걸거나 끄지 않는다(journal_* FORCE 그대로 — 0016 정책이 auth.uid()로 판정).
-- 새 표는 RLS 켬 · grant 없음(RPC만). 함수는 public · anon 회수 · authenticated에만.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 표
-- =====================================================================
create table fin_ledger_posts (
  post_id         uuid primary key default gen_random_uuid(),
  business_id     text not null references businesses(business_id) on delete restrict,
  period          text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status          text not null default 'pending' check (status in ('pending', 'posted', 'voided')),
  entry_date      date not null,
  counter_account text check (counter_account is null or length(counter_account) <= 40),
  memo            text not null check (length(btrim(memo)) between 1 and 200),
  reason          text check (reason is null or length(reason) <= 300),
  closed_month    boolean not null default false,          -- 대기 때 마감 달이었나(대표 · CFO만)
  slip_no         text,                                    -- 반영 전표
  reversal_slip   text,                                    -- 무효 역분개 전표
  staged_by       uuid not null default auth.uid(),
  staged_at       timestamptz not null default now(),
  posted_by       uuid,
  posted_at       timestamptz,
  voided_by       uuid,
  voided_at       timestamptz,
  void_reason     text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  constraint fin_ledger_posts_shape check (
    (status = 'pending' and slip_no is null) or (status = 'posted' and slip_no is not null and posted_at is not null)
    or (status = 'voided' and voided_at is not null and void_reason is not null))
);
create index fin_ledger_posts_by_period on fin_ledger_posts (business_id, period, status);
comment on table fin_ledger_posts is
  '0079. ⑤ 계정별 원장 → 장부 반영 건(대기 → 반영 → 무효). 전표는 0016 post_journal_entry · 무효는 0016 post_correction(역분개). 지우지 않는다. RPC만.';
alter table fin_ledger_posts enable row level security;
revoke all on table fin_ledger_posts from public, anon, authenticated;

create table fin_ledger_post_lines (
  post_id     uuid not null references fin_ledger_posts(post_id) on delete restrict,
  line_id     bigint not null references fin_ledger_lines(line_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,
  released_at timestamptz,                                  -- 무효로 풀린 뒤(기록은 남긴다)
  primary key (post_id, line_id)
);
create unique index fin_ledger_post_lines_live on fin_ledger_post_lines (line_id) where released_at is null;
comment on table fin_ledger_post_lines is '0079. 반영 건의 원장 줄. 한 줄은 살아 있는(대기 · 반영) 건 하나에만 — 두 번 반영 막기. RPC만.';
alter table fin_ledger_post_lines enable row level security;
revoke all on table fin_ledger_post_lines from public, anon, authenticated;

-- =====================================================================
-- 2절. 내부 판정
-- =====================================================================
/** 0016 장부 규칙 그대로(journal_lines_manual_guard): 그 달 또는 그 뒤 달에 closings 줄(가마감 포함)이 있으면 손 전표가 못 들어간다(다시 리뷰 I-A). */
create or replace function ledger_post_blocked(p_business text, p_month text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from closings c where c.business_id = p_business and c.period >= p_month);
$fn$;

/** 그 회사 그 달이 마감인가 — 0016 closings(그 달 · 뒤 달 · 가마감 포함 — 장부가 막는 달) 또는 0075 fin_pl_closes 내부 마감 확정(살아 있는 것). */
create or replace function ledger_post_closed(p_business text, p_period text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select fin_month_closed(p_business, p_period) or ledger_post_blocked(p_business, p_period)
      or exists (select 1 from fin_pl_closes c where c.business_id = p_business and c.period = p_period
                    and c.status = 'final' and c.superseded_at is null);
$fn$;

/** 공통 문. 스위치 → 장부 쓰기. 이유가 다른 오류를 쓴다(스위치 꺼짐 · 권한 없음). */
create or replace function ledger_post_gate(p_business text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not coalesce(feature_on('ledger_post', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if not (coalesce(can_keep_books(p_business), false) and has_business(p_business)) then
    raise exception 'ledger_forbidden' using errcode = '42501';
  end if;
end;
$fn$;

/** 장부 쪽 검사(리뷰 고침 C1 · I1) — 대기 · 반영 때 그 달(원장 달 · 전표 날짜 달 모두)에 부른다.
 *   · ECOUNT 원천: 장부 줄 source 'ecount' 또는 0050/0052 월별 업로드 전표(finance_import_slips 살아 있는 줄)가 있으면 거부.
 *   · 다른 전표(0079가 만든 전표 · 그 역분개가 아닌 것 — 예: 손으로 넣은 매입 4510)가 있으면 대표 · 그룹 CFO + 이유만. */
create or replace function ledger_post_books_check(p_business text, p_month text, p_top boolean, p_reason text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if exists (select 1 from journal_lines j where j.business_id = p_business and to_char(j.entry_date, 'YYYY-MM') = p_month and j.source = 'ecount')
     or exists (select 1 from finance_import_slips f where f.business_id = p_business and f.month = p_month and f.superseded_at is null) then
    raise exception 'ledger_books_has_ecount' using errcode = '23514';
  end if;
  if exists (select 1 from journal_entries e where e.business_id = p_business and to_char(e.entry_date, 'YYYY-MM') = p_month
                and not exists (select 1 from fin_ledger_posts fp where fp.business_id = p_business
                                   and e.slip_no in (fp.slip_no, fp.reversal_slip)))
     and (not p_top or p_reason is null) then
    raise exception 'ledger_books_has_entries' using errcode = '42501';
  end if;
end;
$fn$;

/** 전표 날짜 규칙(리뷰 고침 I2 · 다시 리뷰 I-A) — 전표 날짜의 달 = 원장 달(장부가 막지 않을 때).
 *   원장 달을 장부가 막으면(0016: 그 달 · 뒤 달 closings) 뒤의 막히지 않은 달 — 단 이번 달(KST)까지만. */
create or replace function ledger_post_date_ok(p_business text, p_period text, p_date date) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_m   text := to_char(p_date, 'YYYY-MM');
  v_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
begin
  if v_m = p_period and not ledger_post_blocked(p_business, p_period) then return; end if;
  if ledger_post_blocked(p_business, p_period) and v_m > p_period and v_m <= v_now
     and not ledger_post_blocked(p_business, v_m) then return; end if;
  raise exception 'ledger_entry_date' using errcode = '22023';
end;
$fn$;

-- =====================================================================
-- 3절. 반영 대기
-- =====================================================================
create or replace function ledger_post_stage(p_business text, p_lines bigint[], p_counter_account text default null,
                                             p_entry_date date default null, p_reason text default null)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  v_lines   bigint[];
  v_period  text;
  v_n       int;
  v_closed  boolean;
  v_top     boolean := coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO');
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_dr      numeric;
  v_cr      numeric;
  v_date    date;
  v_id      uuid;
begin
  if not coalesce(feature_on('ledger_post', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  perform ledger_post_gate(p_business);
  if p_lines is null or cardinality(p_lines) = 0 or cardinality(p_lines) > 200 then
    raise exception 'ledger_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ledger_post:' || p_business));
  -- 0072 같은 거래: 'suspect' 묶음 줄은 거부 · 'same' 묶음 줄은 그 묶음의 원장 줄을 모두 함께.
  if exists (select 1 from fin_tx_group_members m join fin_tx_groups g on g.group_id = m.group_id
              where m.source_table = 'fin_ledger_lines' and m.line_id = any(p_lines) and m.released_at is null and g.status = 'suspect') then
    raise exception 'ledger_dedupe_suspect' using errcode = '23514';
  end if;
  select array_agg(distinct x order by x) into v_lines from (
    select unnest(p_lines) as x
    union
    select m2.line_id from fin_tx_group_members m join fin_tx_groups g on g.group_id = m.group_id and g.status = 'same'
      join fin_tx_group_members m2 on m2.group_id = m.group_id and m2.source_table = 'fin_ledger_lines' and m2.released_at is null
     where m.source_table = 'fin_ledger_lines' and m.line_id = any(p_lines) and m.released_at is null
  ) s;
  select count(*), min(l.period), coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0), max(l.tx_date)
    into v_n, v_period, v_dr, v_cr, v_date
    from fin_ledger_lines l where l.line_id = any(v_lines) and l.business_id = p_business and l.voided_at is null;
  if v_n <> cardinality(v_lines) then
    raise exception 'ledger_not_found' using errcode = 'P0002';
  end if;
  if (select count(distinct l.period) from fin_ledger_lines l where l.line_id = any(v_lines)) <> 1 then
    raise exception 'ledger_one_period' using errcode = '22023';
  end if;
  if exists (select 1 from fin_ledger_lines l where l.line_id = any(v_lines)
              and (l.account_code is null or (coalesce(l.debit, 0) > 0) = (coalesce(l.credit, 0) > 0)
                   or coalesce(l.debit, 0) < 0 or coalesce(l.credit, 0) < 0)) then
    raise exception 'ledger_line_shape' using errcode = '22023';   -- 계정 없음 · 차변 · 대변 둘 다(또는 0) · 음수(리뷰 고침 M1)
  end if;
  if exists (select 1 from fin_ledger_post_lines pl where pl.line_id = any(v_lines) and pl.released_at is null) then
    raise exception 'ledger_already_staged' using errcode = '23505';
  end if;
  v_date := coalesce(p_entry_date, v_date, (to_date(v_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date);
  if v_dr <> v_cr and nullif(btrim(coalesce(p_counter_account, '')), '') is null then
    raise exception 'ledger_unbalanced' using errcode = '22023';
  end if;
  v_closed := ledger_post_closed(p_business, v_period);
  if v_closed and (not v_top or v_reason is null) then
    raise exception 'ledger_closed_month' using errcode = '42501';
  end if;
  -- 날짜 규칙은 마감 · 권한 문 뒤(다시 리뷰 Minor 3 — 회사 대표에게 «마감 달»을 먼저 알린다).
  perform ledger_post_date_ok(p_business, v_period, v_date);
  perform ledger_post_books_check(p_business, v_period, v_top, v_reason);
  if to_char(v_date, 'YYYY-MM') <> v_period then
    perform ledger_post_books_check(p_business, to_char(v_date, 'YYYY-MM'), v_top, v_reason);
  end if;
  insert into fin_ledger_posts (business_id, period, entry_date, counter_account, memo, reason, closed_month)
  values (p_business, v_period, v_date,
          case when v_dr <> v_cr then btrim(p_counter_account) end,
          left('계정별 원장 반영 ' || v_period || ' · ' || cardinality(v_lines) || '줄', 200), left(v_reason, 300), v_closed)
  returning post_id into v_id;
  insert into fin_ledger_post_lines (post_id, line_id, business_id) select v_id, x, p_business from unnest(v_lines) x;
  perform fin_audit('create', 'fin_ledger_posts', v_id::text, p_business, null,
                    jsonb_build_object('period', v_period, 'lines', cardinality(v_lines), 'closed_month', v_closed, 'step', 'pending'), coalesce(v_reason, '원장 반영 대기(0079)'));
  return v_id;
end;
$fn$;

-- =====================================================================
-- 4절. 반영 — 0016 post_journal_entry
-- =====================================================================
create or replace function ledger_post_apply(p_post uuid, p_reason text default null) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  p fin_ledger_posts%rowtype;
  v_top boolean := coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_lines jsonb;
  v_dr numeric;
  v_cr numeric;
  v_slip text;
begin
  select * into p from fin_ledger_posts where post_id = p_post for update;
  if not found then raise exception 'ledger_not_found' using errcode = 'P0002'; end if;
  if not coalesce(feature_on('ledger_post', p.business_id), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  perform ledger_post_gate(p.business_id);
  if p.status <> 'pending' then raise exception 'ledger_not_pending' using errcode = '23514'; end if;
  if (p.closed_month or ledger_post_closed(p.business_id, p.period) or ledger_post_closed(p.business_id, to_char(p.entry_date, 'YYYY-MM')))
     and (not v_top or v_reason is null) then   -- 반영하는 사람이 제 이유를 적는다(대기 이유로 대신하지 않음 — 리뷰 고침 M4)
    raise exception 'ledger_closed_month' using errcode = '42501';
  end if;
  perform ledger_post_date_ok(p.business_id, p.period, p.entry_date);
  perform ledger_post_books_check(p.business_id, p.period, v_top, v_reason);
  if to_char(p.entry_date, 'YYYY-MM') <> p.period then
    perform ledger_post_books_check(p.business_id, to_char(p.entry_date, 'YYYY-MM'), v_top, v_reason);
  end if;
  select jsonb_agg(jsonb_build_object('account_code', l.account_code,
                                      'side', case when coalesce(l.debit, 0) > 0 then 'debit' else 'credit' end,
                                      'amount', coalesce(nullif(l.debit, 0), l.credit),
                                      'memo', left(coalesce(nullif(btrim(l.memo), ''), p.memo), 200)) order by l.line_id),
         coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
    into v_lines, v_dr, v_cr
    from fin_ledger_post_lines pl join fin_ledger_lines l on l.line_id = pl.line_id
   where pl.post_id = p.post_id and pl.released_at is null and l.voided_at is null;
  if v_lines is null or jsonb_array_length(v_lines) <> (select count(*) from fin_ledger_post_lines where post_id = p.post_id and released_at is null) then
    raise exception 'ledger_source_changed' using errcode = '23514';   -- 대기 뒤 원장 줄이 되돌려졌다 — 무효 처리 후 다시
  end if;
  if v_dr <> v_cr then
    if p.counter_account is null then raise exception 'ledger_unbalanced' using errcode = '22023'; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', p.counter_account,
                 'side', case when v_dr > v_cr then 'credit' else 'debit' end, 'amount', abs(v_dr - v_cr), 'memo', p.memo || ' · 상대 계정'));
  end if;
  -- 0016 길 그대로: 헤더 + 라인 + 차대 일치 + 마감 달 · 비활성 계정 검사 + 감사 한 줄.
  v_slip := post_journal_entry(p.business_id, p.entry_date, p.memo, null, v_lines);
  update fin_ledger_posts set status = 'posted', slip_no = v_slip, posted_by = auth.uid(), posted_at = now(),
                              reason = coalesce(left(v_reason, 300), reason)
   where post_id = p.post_id;
  perform fin_audit('update', 'fin_ledger_posts', p.post_id::text, p.business_id, jsonb_build_object('status', 'pending'),
                    jsonb_build_object('status', 'posted', 'slip', v_slip), coalesce(v_reason, '원장 장부 반영(0079)'));
  return v_slip;
end;
$fn$;

-- =====================================================================
-- 5절. 무효 처리 — 대기는 풀기 · 반영은 0016 post_correction(역분개)
-- =====================================================================
create or replace function ledger_post_void(p_post uuid, p_reason text) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  p fin_ledger_posts%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_top boolean := coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO');
  v_rev jsonb;
  v_slip text;
begin
  select * into p from fin_ledger_posts where post_id = p_post for update;
  if not found then raise exception 'ledger_not_found' using errcode = 'P0002'; end if;
  if not coalesce(feature_on('ledger_post', p.business_id), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  perform ledger_post_gate(p.business_id);
  if length(v_reason) not between 1 and 300 then raise exception 'ledger_void_reason' using errcode = '22023'; end if;
  if p.status = 'voided' then raise exception 'ledger_not_pending' using errcode = '23514'; end if;
  if p.status = 'posted' then
    if (p.closed_month or ledger_post_closed(p.business_id, p.period)) and not v_top then
      raise exception 'ledger_closed_month' using errcode = '42501';
    end if;
    -- 역분개 날짜 = 원 전표 날짜와 오늘(KST) 중 늦은 날 — 그 달이 0016 마감이면 0016 트리거가 거부한다(당월 정정).
    v_rev := post_correction(p.business_id, p.slip_no, greatest(p.entry_date, (now() at time zone 'Asia/Seoul')::date),
                             left('원장 반영 무효 — ' || v_reason, 200), null, '[]'::jsonb);
    v_slip := v_rev ->> 'reversal';
  end if;
  update fin_ledger_posts set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = v_reason, reversal_slip = v_slip
   where post_id = p.post_id;
  update fin_ledger_post_lines set released_at = now() where post_id = p.post_id and released_at is null;
  perform fin_audit('update', 'fin_ledger_posts', p.post_id::text, p.business_id, jsonb_build_object('status', p.status),
                    jsonb_build_object('status', 'voided', 'reversal', v_slip), v_reason);
  return coalesce(v_slip, p.post_id::text);
end;
$fn$;

-- =====================================================================
-- 6절. 목록 — 원장 줄 + 상태
-- =====================================================================
create or replace function ledger_post_queue(p_business text, p_period text)
returns table (line_id bigint, tx_date date, account_code text, account_name text, counterparty text, memo text,
               debit numeric, credit numeric, group_status text, post_id uuid, post_status text, slip_no text, closed_month boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
begin
  if not coalesce(feature_on('ledger_post', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  perform ledger_post_gate(p_business);
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'ledger_invalid' using errcode = '22023';
  end if;
  return query
  select l.line_id, l.tx_date, l.account_code, l.account_name, l.counterparty, l.memo, l.debit, l.credit,
         (select g.status from fin_tx_group_members m join fin_tx_groups g on g.group_id = m.group_id
           where m.source_table = 'fin_ledger_lines' and m.line_id = l.line_id and m.released_at is null limit 1),
         lp.post_id, lp.status, lp.slip_no, ledger_post_closed(p_business, p_period)
    from fin_ledger_lines l
    left join lateral (
      select fp.post_id, fp.status, fp.slip_no from fin_ledger_post_lines pl join fin_ledger_posts fp on fp.post_id = pl.post_id
       where pl.line_id = l.line_id and pl.released_at is null limit 1
    ) lp on true
   -- 되돌려진 원장 줄도 살아 있는 반영 건에 묶여 있으면 보인다(건이 목록에서 사라지지 않게 — 리뷰 고침 C2).
   where l.business_id = p_business and l.period = p_period and (l.voided_at is null or lp.post_id is not null)
   order by l.tx_date nulls last, l.row_no
   limit 2000;
end;
$fn$;

-- =====================================================================
-- 6-2절. 지킴 트리거(리뷰 고침 C1 · C2) — 0050 · 0072 · 0074를 고치지 않고 이 파일에서 더한다.
-- =====================================================================
/** ⑤ 원장 올리기의 바꾸기 · 되돌리기는 그 원장 줄이 살아 있는 반영 건(대기 · 반영)에 있으면 거부 — 장부 반영을 먼저 무효로. */
create or replace function ledger_post_upload_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if old.status = 'applied' and new.status in ('replaced', 'reverted')
     and exists (select 1 from fin_ledger_lines l join fin_ledger_post_lines pl on pl.line_id = l.line_id and pl.released_at is null
                  where l.upload_id = old.upload_id) then
    raise exception 'ledger_post_live' using errcode = '23514', hint = '장부 반영을 먼저 무효로 하세요(장부 반영 화면).';
  end if;
  return new;
end;
$fn$;
drop trigger if exists ledger_post_upload_guard_trigger on fin_uploads;
create trigger ledger_post_upload_guard_trigger before update of status on fin_uploads
  for each row execute function ledger_post_upload_guard();

/** 반대 방향(C1): 월별 ECOUNT 업로드(0050/0052)가 전표를 세우려는 달에 이미 반영된(posted) 원장 건이 있으면 거부. */
create or replace function ledger_post_import_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if exists (select 1 from fin_ledger_posts fp where fp.business_id = new.business_id and fp.status = 'posted'
                and (fp.period = new.month or to_char(fp.entry_date, 'YYYY-MM') = new.month)) then
    raise exception 'ledger_post_month_posted' using errcode = '23514', hint = '이 달은 계정별 원장이 장부에 반영돼 있습니다 — 반영을 무효로 한 뒤 올리세요.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists ledger_post_import_guard_trigger on finance_import_slips;
create trigger ledger_post_import_guard_trigger before insert on finance_import_slips
  for each row execute function ledger_post_import_guard();

-- =====================================================================
-- 7절. 함수 권한
-- =====================================================================
revoke all on function ledger_post_blocked(text, text) from public, anon, authenticated;
revoke all on function ledger_post_closed(text, text) from public, anon, authenticated;
revoke all on function ledger_post_gate(text) from public, anon, authenticated;
revoke all on function ledger_post_books_check(text, text, boolean, text) from public, anon, authenticated;
revoke all on function ledger_post_date_ok(text, text, date) from public, anon, authenticated;
revoke all on function ledger_post_upload_guard() from public, anon, authenticated;
revoke all on function ledger_post_import_guard() from public, anon, authenticated;
revoke all on function ledger_post_stage(text, bigint[], text, date, text) from public, anon;
revoke all on function ledger_post_apply(uuid, text) from public, anon;
revoke all on function ledger_post_void(uuid, text) from public, anon;
revoke all on function ledger_post_queue(text, text) from public, anon;
grant execute on function ledger_post_stage(text, bigint[], text, date, text) to authenticated;
grant execute on function ledger_post_apply(uuid, text) to authenticated;
grant execute on function ledger_post_void(uuid, text) to authenticated;
grant execute on function ledger_post_queue(text, text) to authenticated;

commit;
