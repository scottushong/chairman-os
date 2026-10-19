-- =====================================================================
-- Chairman OS — 0085_finance_overview («넣으면 쌓이고 · 알아서 계산하고 · 한 화면에 보인다»)
-- 작성: 2026-10-19 · 원문 docs/specs/2026-10-19-finance-overview.txt · 결정 docs/decisions/2026-10-19-finance-overview.md
--
-- ■ 왜 ■ 자료 올리기가 «미리보기 → 넣기 → 승인 → 매칭 → 화면마다 따로»라 너무 복잡하다(대표 결정 2026-10-19).
--   놓으면 저장되고(같은 달은 새 값으로 바꾸고 옛 값은 이력 · 7일 되돌리기), 사람이 볼 것은 «경고» 꼬리표로만 남고,
--   저장이 끝나면 그 회사 · 그 달(과 이후 달)을 자동으로 다시 계산해 «재무 현황» 한 화면에 보인다.
--   막는 것은 둘뿐이다 — 급여 개인 줄(대표 · CFO만) · 마감 확정된 달(대표 · CFO가 이유를 적고 풀 때까지 보류).
--   (0074 재고 · 원료 출고 «바꾸기»는 대표 · CFO만 · 0080 원료 숫자 보호는 그대로 — 그 경우도 보류로 남는다.)
--
-- ■ 더하는 것 ■ (0070 · 0072 함수 본문은 고치지 않는다 — 감싸기만 한다)
--   1절 fin_uploads.warnings(저장 뒤 경고 꼬리표) · 종류 '⑲ 출하집계표(shipment)' · fin_shipment_lines.
--   2절 fin_upload_save — 저장 한 번: 같은 달이 있으면 바꾸기(replace)를 스스로 고르고 fin_upload_apply(0072)를 부른 뒤
--        auto = true · warnings를 적는다(한 트랜잭션). 출하집계표는 같은 문(권한 · 마감 · 겹침 · 같은 파일)으로 직접 넣는다.
--        출하 줄의 되돌리기 · 바꾸기는 fin_uploads 상태 트리거가 맡는다(0072 fin_upload_void를 다시 만들지 않는다).
--   3절 급여 개인 줄 보류 — fin_payroll_held(grant 없음) · fin_payroll_hold(올린 사람) · fin_payroll_held_list · fin_payroll_release(대표 · CFO).
--   4절 accounts.auto_created — 계정과목표 없이 원장 · 손익 코드로 만든 계정의 «자동 생성» 표시(계정과목표 파일이 오면 덮어쓴다).
--   5절 다시 계산 큐 — fin_recalc_jobs · fin_recalc_request · fin_recalc_claim · fin_recalc_finish(사람 세션 또는 AI Agent — service_role 없음).
--        넣기 · 되돌리기 · 공식 결산 · ECOUNT 손익 전표 · 수기 전표 · 평가금액이 바뀌면 트리거가 큐에 넣는다(앱이 잊어도 빠지지 않게).
--   6절 재무 현황 저장본 — fin_overview_months(회사 합계만 — 원료별 · 개인 줄 없음) · fin_overview_save.
--   7절 공식 결산 되돌리기 — official_statement_withdraw(7일 · 앞 결산이 있으면 그 줄로 새 결산을 세워 되살린다 · 고치지 않는다).
--   8절 기능 스위치 finance_overview(기본 전원).
--
-- 0035 규칙: force를 새로 걸지 않는다 · FORCE를 내리지 않는다 · 0001~0084를 고치지 않는다. 새 정책 · grant는 늘 to authenticated.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 경고 칸 · 출하집계표
-- =====================================================================
alter table fin_uploads
  add column warnings jsonb check (warnings is null or (jsonb_typeof(warnings) = 'array' and jsonb_array_length(warnings) <= 40));  -- [일반] 저장 뒤 경고 문구(숫자 원문 없음)
comment on column fin_uploads.warnings is
  '0085. 저장 뒤 사람이 볼 경고(합계 안 맞음 · 날짜 모름 · 중복 의심 …). 저장을 막지 않는다. 쓰기는 fin_upload_save만.';
grant select (warnings) on table fin_uploads to authenticated;

alter table fin_uploads drop constraint fin_uploads_kind_known;
alter table fin_uploads add constraint fin_uploads_kind_known check (kind in ('sales', 'purchase_in', 'inventory', 'production', 'ledger', 'payroll',
  'import', 'cashflow', 'card', 'overseas', 'promo', 'loans', 'borrowings', 'savings',
  'valuation', 'material_issue', 'tax_invoice', 'ledger_lines', 'shipment', 'unknown'));
alter table fin_upload_shapes drop constraint fin_upload_shapes_kind_known;
alter table fin_upload_shapes add constraint fin_upload_shapes_kind_known check (kind in ('sales', 'purchase_in', 'inventory', 'production', 'ledger',
  'payroll', 'import', 'cashflow', 'card', 'overseas', 'promo', 'loans', 'borrowings', 'savings',
  'valuation', 'material_issue', 'tax_invoice', 'ledger_lines', 'shipment'));

create table fin_shipment_lines (
  line_id     bigint generated always as identity primary key,
  upload_id   uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id text not null references businesses(business_id) on delete restrict,  -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no      int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  ship_date   date,           -- [일반] 출하일
  customer    text,           -- [일반] 거래처
  product     text,           -- [일반] 제품
  qty         numeric(20,3),  -- [일반] 출하량(kg)
  amount      numeric(20,2),  -- [제한] 금액
  voided_at   timestamptz,                                                             -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at  timestamptz not null default now()
);
create index fin_shipment_lines_by_period on fin_shipment_lines (business_id, period) where voided_at is null;
comment on table fin_shipment_lines is '0085. ⑲ 출하집계표(거래처 · 제품 · 출하 kg · 금액). fin_upload_save만 넣는다. 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_shipment_lines enable row level security;
revoke all on table fin_shipment_lines from public, anon, authenticated;
grant select on table fin_shipment_lines to authenticated;
create policy fin_shipment_lines_read on fin_shipment_lines for select to authenticated using (can_read_books(business_id));

/** 출하 줄의 무효 · 되살림 — 0072 fin_upload_void · unvoid가 모르는 표라 상태 바뀜을 따라간다. */
create or replace function fin_shipment_follow() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.kind <> 'shipment' or new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'applied' and new.status in ('reverted', 'replaced') then
    update fin_shipment_lines set voided_at = now() where upload_id = new.upload_id and voided_at is null;
  elsif old.status = 'replaced' and new.status = 'applied' then
    update fin_shipment_lines set voided_at = null where upload_id = new.upload_id;
  end if;
  return new;
end;
$fn$;
drop trigger if exists fin_shipment_follow_trigger on fin_uploads;
create trigger fin_shipment_follow_trigger after update of status on fin_uploads
  for each row execute function fin_shipment_follow();

-- =====================================================================
-- 5절(먼저 — 2절 · 트리거가 부른다). 다시 계산 큐
-- =====================================================================
create table fin_recalc_jobs (
  job_id       uuid primary key default gen_random_uuid(),
  business_id  text not null references businesses(business_id) on delete restrict,   -- [일반]
  from_period  text not null check (from_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),       -- [일반] 이 달부터 뒤 달까지
  status       text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),  -- [일반]
  attempts     int not null default 0 check (attempts between 0 and 20),               -- [일반]
  last_error   text check (last_error is null or length(last_error) <= 500),          -- [일반] 사람 말 오류(숫자 없음)
  cause        text not null default 'upload' check (cause in ('upload', 'revert', 'official', 'books', 'valuation', 'manual', 'accounts')),  -- [일반]
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
-- 회사마다 기다리는 일은 하나(같은 회사에 또 오면 시작 달만 앞으로). 도는 일과 다음 일은 함께 설 수 있다.
create unique index fin_recalc_jobs_one_pending on fin_recalc_jobs (business_id) where status = 'pending';
create index fin_recalc_jobs_open on fin_recalc_jobs (status, requested_at) where status in ('pending', 'running');
comment on table fin_recalc_jobs is
  '0085. 재무 현황 다시 계산 큐. 저장 · 되돌리기 · 결산 · 전표가 바뀌면 트리거가 넣는다. 돌리는 쪽은 사람 세션(그 회사 장부 쓰기) 또는 AI Agent(cron) — service_role 없음.';
alter table fin_recalc_jobs enable row level security;
revoke all on table fin_recalc_jobs from public, anon, authenticated;
grant select on table fin_recalc_jobs to authenticated;
create policy fin_recalc_jobs_read on fin_recalc_jobs for select to authenticated using (can_read_books(business_id));

/** 큐에 넣기(내부 — 트리거 · 정의자 함수만). 기다리는 일이 있으면 시작 달을 더 앞으로만. */
create or replace function fin_recalc_enqueue(p_business text, p_period text, p_cause text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if p_business is null or p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return;
  end if;
  insert into fin_recalc_jobs (business_id, from_period, cause)
  values (p_business, p_period, coalesce(p_cause, 'upload'))
  on conflict (business_id) where status = 'pending'
  do update set from_period = least(fin_recalc_jobs.from_period, excluded.from_period), requested_at = now();
end;
$fn$;

/** 사람이 «다시 계산»(계정과목표 덮어쓰기 · 손으로 고침 뒤) — 그 회사 장부를 쓰는 사람. */
create or replace function fin_recalc_request(p_business text, p_period text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_recalc_denied' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fin_recalc_period' using errcode = '22023';
  end if;
  perform fin_recalc_enqueue(p_business, p_period, 'manual');
end;
$fn$;

/**
 * 일 가져가기. 사람 세션은 그 회사(장부 쓰기)만 · AI Agent는 모든 회사(cron). 15분 넘게 «도는 중»인 일(끊긴 요청)도 다시 가져간다.
 * 다섯 번 실패하면 failed로 멈춘다(사람이 다시 올리거나 «다시 계산»).
 */
create or replace function fin_recalc_claim(p_business text, p_limit int) returns setof fin_recalc_jobs
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_agent boolean := coalesce(auth_role()::text, '') = 'AIAgent' and coalesce(is_active(), false);
begin
  if p_business is null and not v_agent then
    raise exception 'fin_recalc_denied' using errcode = '42501';
  end if;
  if p_business is not null and not (coalesce(can_keep_books(p_business), false) or (v_agent and coalesce(can_read_books(p_business), false))) then
    raise exception 'fin_recalc_denied' using errcode = '42501';
  end if;
  return query
  update fin_recalc_jobs j
     set status = 'running', started_at = now(), attempts = j.attempts + 1
   where j.job_id in (
     select x.job_id from fin_recalc_jobs x
      where (p_business is null or x.business_id = p_business)
        -- AI Agent는 읽을 수 있는 회사(회사 범위 · [제한] 등급)의 일만 — 못 읽는 회사를 «계산 끝»으로 만들지 않는다.
        and (p_business is not null or coalesce(can_read_books(x.business_id), false))
        and x.attempts < 5
        and (x.status = 'pending' or (x.status = 'running' and x.started_at < now() - interval '15 minutes'))
        -- 같은 회사의 도는 일이 살아 있으면 다음 일은 기다린다(두 계산이 엇갈려 쓰지 않게).
        and not (x.status = 'pending' and exists (select 1 from fin_recalc_jobs r where r.business_id = x.business_id and r.status = 'running'
                                                    and r.started_at >= now() - interval '15 minutes'))
      order by x.requested_at
      limit greatest(1, least(coalesce(p_limit, 1), 20))
      for update skip locked)
  returning j.*;
end;
$fn$;

/** 일 끝내기. 실패는 다섯 번까지 다시 기다림으로. */
create or replace function fin_recalc_finish(p_job uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_job   fin_recalc_jobs;
  v_agent boolean := coalesce(auth_role()::text, '') = 'AIAgent' and coalesce(is_active(), false);
begin
  select * into v_job from fin_recalc_jobs where job_id = p_job for update;
  if v_job.job_id is null then
    return;
  end if;
  if not (coalesce(can_keep_books(v_job.business_id), false) or (v_agent and coalesce(can_read_books(v_job.business_id), false))) then
    raise exception 'fin_recalc_denied' using errcode = '42501';
  end if;
  if v_job.status <> 'running' then
    return;
  end if;
  if coalesce(p_ok, false) then
    update fin_recalc_jobs set status = 'done', finished_at = now(), last_error = null where job_id = p_job;
  else
    update fin_recalc_jobs
       set status = case when v_job.attempts >= 5 then 'failed' else 'pending' end,
           finished_at = case when v_job.attempts >= 5 then now() end,
           last_error = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
     where job_id = p_job
       -- 그 사이 같은 회사에 새 기다림이 섰으면 이 일은 실패로 접는다(새 일이 더 앞 달부터 다시 한다).
       and not exists (select 1 from fin_recalc_jobs o where o.business_id = v_job.business_id and o.status = 'pending' and o.job_id <> p_job);
    if not found then
      update fin_recalc_jobs set status = 'failed', finished_at = now(), last_error = left(coalesce(p_error, ''), 500) where job_id = p_job;
      update fin_recalc_jobs set from_period = least(from_period, v_job.from_period) where business_id = v_job.business_id and status = 'pending';
    end if;
  end if;
end;
$fn$;

-- 트리거 — 앱이 잊어도 큐에 들어간다.
create or replace function fin_recalc_on_upload() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.period is not null and new.status in ('applied', 'reverted', 'replaced')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    perform fin_recalc_enqueue(new.business_id, new.period, case when new.status = 'reverted' then 'revert' else 'upload' end);
  end if;
  return new;
end;
$fn$;
drop trigger if exists fin_recalc_on_upload_trigger on fin_uploads;
create trigger fin_recalc_on_upload_trigger after insert or update of status on fin_uploads
  for each row execute function fin_recalc_on_upload();

create or replace function fin_recalc_on_official() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform fin_recalc_enqueue(new.business_id, left(new.period_key, 4) || '-01', 'official');
  return new;
end;
$fn$;
drop trigger if exists fin_recalc_on_official_trigger on official_statements;
create trigger fin_recalc_on_official_trigger after insert on official_statements
  for each row execute function fin_recalc_on_official();

create or replace function fin_recalc_on_journal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform fin_recalc_enqueue(new.business_id, to_char(new.entry_date, 'YYYY-MM'), 'books');
  return new;
end;
$fn$;
drop trigger if exists fin_recalc_on_journal_trigger on journal_entries;
create trigger fin_recalc_on_journal_trigger after insert on journal_entries
  for each row execute function fin_recalc_on_journal();

create or replace function fin_recalc_on_valuation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform fin_recalc_enqueue(new.business_id, new.period, 'valuation');
  return new;
end;
$fn$;
drop trigger if exists fin_recalc_on_valuation_trigger on fin_inventory_valuations;
create trigger fin_recalc_on_valuation_trigger after insert or update on fin_inventory_valuations
  for each row execute function fin_recalc_on_valuation();

-- =====================================================================
-- 2절. 저장 한 번 — fin_upload_save
-- =====================================================================
/**
 * 저장. 같은 회사 · 종류 · 달에 살아 있는 올리기가 있으면 바꾸기(replace — 옛 줄은 무효 · 이력 · 7일 되돌리기),
 * 없으면 처음 넣기. 판정(장부 쓰기 · 마감 달은 대표 · CFO + 이유 · 같은 파일 · 0074 바꾸기 문 · 0080 원료 문)은 fin_upload_apply(0072)가
 * 그대로 한다 — 거부되면 앱이 «보류(이유)»로 기록한다. 통과하면 auto = true · warnings를 적는다.
 * 출하집계표(shipment)는 0072 넣기가 모르는 종류라 같은 문을 여기서 직접 세운다.
 */
create or replace function fin_upload_save(
  p_business text, p_kind text, p_period text, p_file_name text, p_sha text, p_sheet text,
  p_confidence text, p_ai_used int, p_rows jsonb, p_people jsonb, p_reason text, p_upload uuid, p_warnings jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id     uuid;
  v_old    uuid[];
  v_closed boolean;
  v_row    fin_uploads;
  v_warn   jsonb := case when jsonb_typeof(p_warnings) = 'array' then
                       (select coalesce(jsonb_agg(left(e #>> '{}', 300)), '[]'::jsonb)
                          from (select e from jsonb_array_elements(p_warnings) e limit 40) w)
                     else '[]'::jsonb end;
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fin_upload_period' using errcode = '22023';
  end if;
  -- 넣기와 같은 자문 잠금(같은 거래 안에서 다시 잡아도 된다) — 겹침을 보고 고르는 사이에 다른 사람이 끼지 않게.
  perform pg_advisory_xact_lock(hashtext('fin_upload:' || p_business || ':' || coalesce(p_kind, '') || ':' || p_period));
  select array_agg(u.upload_id) into v_old
    from fin_uploads u
   where u.business_id = p_business and u.kind = p_kind and u.period = p_period and u.status = 'applied'
     and u.upload_id is distinct from p_upload;

  if p_kind is distinct from 'shipment' then
    v_id := fin_upload_apply(p_business, p_kind, p_period, p_file_name, p_sha, p_sheet, p_confidence, p_ai_used, false,
                             p_rows, p_people, case when v_old is null then 'none' else 'replace' end, p_reason, p_upload, null);
    update fin_uploads set auto = true, warnings = v_warn where upload_id = v_id;
    return v_id;
  end if;

  -- ── ⑲ 출하집계표 — 0072 넣기와 같은 문 ──
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 20000 then
    raise exception 'fin_upload_rows' using errcode = '22023';
  end if;
  v_closed := fin_month_closed(p_business, p_period);
  if v_closed and not (coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO') and length(btrim(coalesce(p_reason, ''))) >= 2) then
    raise exception 'fin_upload_closed' using errcode = '42501';
  end if;
  if p_upload is not null then
    select * into v_row from fin_uploads where upload_id = p_upload and business_id = p_business for update;
    if v_row.upload_id is null or v_row.status <> 'needs_review' then
      raise exception 'fin_upload_not_pending' using errcode = '22023';
    end if;
    if exists (select 1 from fin_uploads u where u.business_id = p_business and u.kind = 'shipment' and u.period = p_period
                  and u.file_sha256 = v_row.file_sha256 and u.status in ('needs_review', 'applied') and u.upload_id <> p_upload) then
      raise exception 'fin_upload_duplicate' using errcode = '23505';
    end if;
    update fin_uploads
       set kind = 'shipment', period = p_period, sheet_name = coalesce(p_sheet, sheet_name), status = 'applied', auto = true,
           overlap = case when v_old is null then 'none' else 'replace' end, reason = nullif(btrim(coalesce(p_reason, '')), ''),
           pending = null, warnings = v_warn, row_count = jsonb_array_length(p_rows), applied_at = now(), applied_by = auth.uid()
     where upload_id = p_upload;
    v_id := p_upload;
  else
    if exists (select 1 from fin_uploads u where u.business_id = p_business and u.kind = 'shipment' and u.period = p_period
                  and u.file_sha256 = p_sha and u.status in ('needs_review', 'applied')) then
      raise exception 'fin_upload_duplicate' using errcode = '23505';
    end if;
    insert into fin_uploads (business_id, kind, period, file_name, file_sha256, sheet_name, ai_confidence, ai_used, auto, status,
                             row_count, overlap, reason, warnings, applied_at, applied_by)
    values (p_business, 'shipment', p_period, p_file_name, p_sha, p_sheet, coalesce(p_confidence, 'none'), coalesce(p_ai_used, 0), true, 'applied',
            jsonb_array_length(p_rows), case when v_old is null then 'none' else 'replace' end, nullif(btrim(coalesce(p_reason, '')), ''), v_warn,
            now(), auth.uid())
    returning upload_id into v_id;
  end if;
  if v_old is not null then
    update fin_uploads set status = 'replaced', replaced_by = v_id where upload_id = any (v_old) and status = 'applied';
  end if;
  insert into fin_shipment_lines (upload_id, business_id, period, row_no, ship_date, customer, product, qty, amount)
  select v_id, p_business, p_period, coalesce(x.row_no, 0), x.ship_date, nullif(btrim(coalesce(x.customer, '')), ''), nullif(btrim(coalesce(x.product, '')), ''), x.qty, x.amount
    from jsonb_to_recordset(p_rows) as x(row_no int, ship_date date, customer text, product text, qty numeric, amount numeric);
  if v_closed then
    perform fin_reclose_mark(p_business, p_period, v_id, 'upload', p_reason);
  end if;
  perform fin_upload_audit('create', v_id, p_business, case when v_old is null then null else jsonb_build_object('replaced', to_jsonb(v_old)) end,
    jsonb_build_object('kind', 'shipment', 'period', p_period, 'rows', jsonb_array_length(p_rows)), '회계 · 재무 자료 저장(0085 출하집계표)');
  return v_id;
end;
$fn$;

comment on function fin_upload_save(text, text, text, text, text, text, text, int, jsonb, jsonb, text, uuid, jsonb) is
  '0085. 저장 한 번 — 같은 달은 바꾸기(옛 줄 무효 · 7일 되돌리기) · 판정은 fin_upload_apply(0072) 그대로 · 경고 꼬리표. 출하집계표는 같은 문을 직접.';

-- =====================================================================
-- 3절. 급여 개인 줄 보류(대표 · CFO만 저장)
-- =====================================================================
create table fin_payroll_held (
  hold_id      uuid primary key default gen_random_uuid(),
  upload_id    uuid not null references fin_uploads(upload_id) on delete restrict,  -- [일반] 부서 합계로 저장된 올리기
  business_id  text not null references businesses(business_id) on delete restrict, -- [일반]
  period       text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),          -- [일반]
  rows         jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) between 1 and 5000),  -- [제한] 개인 줄(부서 · 사번 · 금액 — 이름 · 주민 · 계좌 없음)
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid,
  decision     text check (decision is null or decision in ('saved', 'discarded')),
  constraint fin_payroll_held_decided check ((decided_at is null) = (decision is null))
);
create unique index fin_payroll_held_one_open on fin_payroll_held (upload_id) where decided_at is null;
comment on table fin_payroll_held is
  '0085. 대표 · CFO가 아닌 사람이 올린 급여대장의 개인 줄 — 부서 합계는 바로 저장되고 개인 줄은 여기서 대표 · CFO의 «저장»을 기다린다. grant 없음(함수로만).';
alter table fin_payroll_held enable row level security;
revoke all on table fin_payroll_held from public, anon, authenticated;

/** 보류 넣기 — 그 올리기를 저장한 본인(장부 쓰기)만. */
create or replace function fin_payroll_hold(p_upload uuid, p_rows jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_up fin_uploads;
  v_id uuid;
begin
  select * into v_up from fin_uploads where upload_id = p_upload;
  if v_up.upload_id is null or not coalesce(can_keep_books(v_up.business_id), false) or v_up.applied_by is distinct from auth.uid() then
    raise exception 'fin_payroll_hold_denied' using errcode = '42501';
  end if;
  if v_up.kind <> 'payroll' or v_up.status <> 'applied' then
    raise exception 'fin_payroll_hold_state' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'fin_upload_rows' using errcode = '22023';
  end if;
  insert into fin_payroll_held (upload_id, business_id, period, rows)
  values (p_upload, v_up.business_id, v_up.period,
          (select jsonb_agg(jsonb_build_object('row_no', x.row_no, 'dept', x.dept, 'person_ref', x.person_ref, 'salary', x.salary, 'bonus', x.bonus, 'severance', x.severance))
             from jsonb_to_recordset(p_rows) as x(row_no int, dept text, person_ref text, salary numeric, bonus numeric, severance numeric)))
  on conflict (upload_id) where decided_at is null do update set rows = excluded.rows, created_at = now()
  returning hold_id into v_id;
  return v_id;
end;
$fn$;

/** 그 회사의 열린 보류(장부 쓰기). 줄 내용(rows)은 대표 · CFO에게만. */
create or replace function fin_payroll_held_list(p_business text)
returns table (hold_id uuid, upload_id uuid, period text, people int, created_at timestamptz, rows jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not coalesce(can_keep_books(p_business), false) then
    return;
  end if;
  return query
  select h.hold_id, h.upload_id, h.period, jsonb_array_length(h.rows), h.created_at,
         case when coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO') then h.rows end
    from fin_payroll_held h
    join fin_uploads u on u.upload_id = h.upload_id and u.status = 'applied'
   where h.business_id = p_business and h.decided_at is null
   order by h.created_at desc;
end;
$fn$;

/** 대표 · CFO의 결정 — 저장(그 올리기의 개인 줄로) · 버리기. 올리기가 되돌려졌으면 저장하지 않는다. */
create or replace function fin_payroll_release(p_hold uuid, p_save boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_h  fin_payroll_held;
  v_up fin_uploads;
begin
  if coalesce(auth_role()::text, '') not in ('Chairman', 'GroupCFO') or not coalesce(is_active(), false) then
    raise exception 'fin_payroll_release_denied' using errcode = '42501';
  end if;
  select * into v_h from fin_payroll_held where hold_id = p_hold for update;
  if v_h.hold_id is null or v_h.decided_at is not null then
    return false;
  end if;
  select * into v_up from fin_uploads where upload_id = v_h.upload_id;
  if coalesce(p_save, false) then
    if v_up.status <> 'applied' then
      raise exception 'fin_payroll_hold_state' using errcode = '22023';
    end if;
    insert into fin_payroll_people (upload_id, business_id, period, row_no, dept, person_ref, salary, bonus, severance)
    select v_h.upload_id, v_h.business_id, v_h.period, coalesce(x.row_no, 0), x.dept, x.person_ref, x.salary, x.bonus, x.severance
      from jsonb_to_recordset(v_h.rows) as x(row_no int, dept text, person_ref text, salary numeric, bonus numeric, severance numeric);
  end if;
  update fin_payroll_held set decided_at = now(), decided_by = auth.uid(), decision = case when coalesce(p_save, false) then 'saved' else 'discarded' end
   where hold_id = p_hold;
  perform fin_upload_audit('update', v_h.upload_id, v_h.business_id, null,
    jsonb_build_object('payroll_people', case when coalesce(p_save, false) then 'saved' else 'discarded' end, 'people', jsonb_array_length(v_h.rows)),
    '급여 개인 줄 보류 결정(0085)');
  return true;
end;
$fn$;

-- =====================================================================
-- 4절. 계정 «자동 생성» 표시
-- =====================================================================
alter table accounts add column if not exists auto_created boolean not null default false;  -- [일반]
comment on column accounts.auto_created is
  '0085. 계정과목표 없이 ECOUNT 원장 · 손익 · 결산 줄의 코드 · 이름으로 앱이 만든 계정(«자동 생성»). 계정과목표 파일이 오면 이름 · 구분을 덮어쓰고 false로.';

-- =====================================================================
-- 6절. 재무 현황 저장본
-- =====================================================================
create table fin_overview_months (
  business_id  text not null references businesses(business_id) on delete restrict,  -- [일반]
  period       text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  totals       jsonb not null check (jsonb_typeof(totals) = 'object' and octet_length(totals::text) <= 65536),  -- [제한] 회사 합계(원료별 · 개인 줄 없음)
  missing      jsonb not null default '[]'::jsonb check (jsonb_typeof(missing) = 'array'),                     -- [일반] 빠진 자료(잠정의 까닭)
  provisional  boolean not null default true,                                                                   -- [일반]
  computed_at  timestamptz not null default now(),
  computed_by  uuid not null default auth.uid(),
  primary key (business_id, period)
);
comment on table fin_overview_months is
  '0085. 재무 현황(손익 · 현금 · 차입 합계)의 계산 저장본 — 대표 홈 · 전월 · 전년 비교가 읽는다. 원료별 숫자 · 급여 개인 줄은 담지 않는다. 쓰기는 fin_overview_save만.';
alter table fin_overview_months enable row level security;
revoke all on table fin_overview_months from public, anon, authenticated;
grant select on table fin_overview_months to authenticated;
create policy fin_overview_months_read on fin_overview_months for select to authenticated using (can_read_books(business_id));

create or replace function fin_overview_save(p_business text, p_period text, p_totals jsonb, p_missing jsonb, p_provisional boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_agent boolean := coalesce(auth_role()::text, '') = 'AIAgent' and coalesce(is_active(), false);
begin
  if not (coalesce(can_keep_books(p_business), false) or (v_agent and coalesce(can_read_books(p_business), false))) then
    raise exception 'fin_overview_denied' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(p_totals) is distinct from 'object' then
    raise exception 'fin_overview_shape' using errcode = '22023';
  end if;
  -- 원료별 · 개인 줄 칸 이름이 실리면 거부(앱 실수의 닫힌 쪽).
  if p_totals::text ~* '"(materials?|people|person_ref|unit_price|qty_kg|bom)"' then
    raise exception 'fin_overview_shape' using errcode = '22023';
  end if;
  insert into fin_overview_months as m (business_id, period, totals, missing, provisional, computed_at, computed_by)
  values (p_business, p_period, p_totals, case when jsonb_typeof(p_missing) = 'array' then p_missing else '[]'::jsonb end,
          coalesce(p_provisional, true), now(), auth.uid())
  on conflict (business_id, period) do update
    set totals = excluded.totals, missing = excluded.missing, provisional = excluded.provisional,
        computed_at = now(), computed_by = auth.uid();
end;
$fn$;

-- =====================================================================
-- 7절. 공식 결산 되돌리기(고치지 않는다 — 앞 결산의 줄로 새 결산을 세우거나, 앞이 없으면 supersede만)
-- =====================================================================
create or replace function official_statement_withdraw(p_id bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_cur  official_statements%rowtype;
  v_prev official_statements%rowtype;
  v_new  bigint;
begin
  select * into v_cur from official_statements where id = p_id for update;
  if v_cur.id is null or auth.uid() is null or not coalesce(can_keep_books(v_cur.business_id), false)
     or auth_role()::text in ('AIAgent', 'Integration') then
    raise exception using errcode = '42501', message = 'books_forbidden';
  end if;
  if v_cur.superseded_at is not null or v_cur.basis <> 'accountant' then
    raise exception using errcode = 'P0001', message = 'official_withdraw_state';
  end if;
  if v_cur.created_at < now() - interval '7 days' then
    raise exception using errcode = 'P0001', message = 'official_withdraw_expired';
  end if;
  if v_cur.created_by is distinct from auth.uid() and not coalesce(can_close_books(v_cur.business_id), false) then
    raise exception using errcode = '42501', message = 'books_forbidden';
  end if;
  update official_statements set superseded_at = now() where id = v_cur.id;
  if v_cur.supersedes_id is not null then
    select * into v_prev from official_statements where id = v_cur.supersedes_id;
    insert into official_statements (business_id, period_kind, period_key, evidence_url, evidence_file, unbalanced_reason, memo, supersedes_id)
    values (v_prev.business_id, v_prev.period_kind, v_prev.period_key, v_prev.evidence_url, v_prev.evidence_file, v_prev.unbalanced_reason,
            left('되돌림 — ' || v_prev.memo, 500), v_cur.id)
    returning id into v_new;
    insert into official_statement_lines (statement_id, business_id, account_code, amount)
    select v_new, l.business_id, l.account_code, l.amount from official_statement_lines l where l.statement_id = v_prev.id;
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update'::audit_action, 'official_statements', v_cur.id::text, v_cur.business_id, auth.uid(), auth_role()::text,
          jsonb_build_object('id', v_cur.id), jsonb_build_object('restored', v_new, 'reason', left(coalesce(p_reason, ''), 500)),
          format('공식 재무제표 되돌리기 %s %s(0085)', v_cur.period_kind, v_cur.period_key));
  if v_new is null then
    perform fin_recalc_enqueue(v_cur.business_id, left(v_cur.period_key, 4) || '-01', 'official');
  end if;
  return v_new;
end;
$fn$;

-- =====================================================================
-- 8절. 기능 스위치 — src/lib/features.ts와 같은 키 · 같은 기본값(check:features가 대조한다)
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'finance_overview', true, 'all', '기본값(0085)')
on conflict do nothing;

-- =====================================================================
-- 함수 권한 — public · anon에게서 이름으로 걷는다. 부르는 것만 authenticated.
-- =====================================================================
revoke all on function fin_shipment_follow() from public, anon, authenticated;
revoke all on function fin_recalc_enqueue(text, text, text) from public, anon, authenticated;
revoke all on function fin_recalc_on_upload() from public, anon, authenticated;
revoke all on function fin_recalc_on_official() from public, anon, authenticated;
revoke all on function fin_recalc_on_journal() from public, anon, authenticated;
revoke all on function fin_recalc_on_valuation() from public, anon, authenticated;
revoke all on function fin_recalc_request(text, text) from public, anon;
revoke all on function fin_recalc_claim(text, int) from public, anon;
revoke all on function fin_recalc_finish(uuid, boolean, text) from public, anon;
revoke all on function fin_upload_save(text, text, text, text, text, text, text, int, jsonb, jsonb, text, uuid, jsonb) from public, anon;
revoke all on function fin_payroll_hold(uuid, jsonb) from public, anon;
revoke all on function fin_payroll_held_list(text) from public, anon;
revoke all on function fin_payroll_release(uuid, boolean) from public, anon;
revoke all on function fin_overview_save(text, text, jsonb, jsonb, boolean) from public, anon;
revoke all on function official_statement_withdraw(bigint, text) from public, anon;

grant execute on function fin_recalc_request(text, text) to authenticated;
grant execute on function fin_recalc_claim(text, int) to authenticated;
grant execute on function fin_recalc_finish(uuid, boolean, text) to authenticated;
grant execute on function fin_upload_save(text, text, text, text, text, text, text, int, jsonb, jsonb, text, uuid, jsonb) to authenticated;
grant execute on function fin_payroll_hold(uuid, jsonb) to authenticated;
grant execute on function fin_payroll_held_list(text) to authenticated;
grant execute on function fin_payroll_release(uuid, boolean) to authenticated;
grant execute on function fin_overview_save(text, text, jsonb, jsonb, boolean) to authenticated;
grant execute on function official_statement_withdraw(bigint, text) to authenticated;

commit;
