-- =====================================================================
-- Chairman OS — 0072_finance_v21 («회계 · 재무 자료 올리기 v2.1 차이분» DB 쪽 · 시드 정리 A안)
-- 작성: 2026-10-12 (대표 결정 «v2.1 차이분» · 시드 정리 A안 2026-10-12)
--
-- ■ 무엇을 더하나 ■
--   1절 빈칸 ≠ 0: 값마다 상태('confirmed_zero' 0 확인 | 'value' 값 | 'missing' 빈칸). 빈칸은 null로만, 0은 «0 확인»일 때만.
--        새 입력(0072 칸)은 상태 없는 0을 거부한다. 0070 시절 칸(재고 기말 금액)은 지금 앱이 상태 없이 보내므로 상태 없는 0 = 0 확인
--        (앱이 0이 적힌 칸을 읽은 것 — 빈칸은 null로 온다).
--        재고금액명세서 줄에 기초 금액(opening_amount)과 상태 칸. 0070 줄은 그대로 두고 상태만 채운다(null → missing · 0 → 0 확인).
--   2절 재공품 · 완제품 월말 평가금액(fin_inventory_valuations) — 입력 중 · 잠정 · 확정. 확정은 입력한 사람이 아닌 사람만.
--        지우지 않는다: 바꾸기 = 무효(voided_at) + 새 줄. 회사 · 달 · 구분마다 살아 있는 줄은 하나.
--        경고 fin_valuation_warnings: «기초 · 기말 포함 범위가 다름» · «재공품 · 완제품 중복 의심».
--   3절 기초재고 연결(fin_inventory_roll) — 기초 = 앞 달 확정 기말. 앞 달이 없으면 첫 달 직접 입력(fin_inventory_openings) ·
--        그것도 없으면 «미연결». 명세서 기초 합과 앞 달 기말이 다르면 차이만 보여 준다(고치지 않는다).
--   4절 원료 출고명세(fin_material_issues) — 생산 투입 · 비생산 · 확인 필요. 앱이 구분을 안 보내면 늘 «확인 필요»(생산 투입이 기본값이 아니다).
--        일괄 결정은 이유 필수 · 그 원료 · 그 달의 «확인 필요» 줄만 · 감사 한 줄.
--        구성표 노출 금지: authenticated는 줄의 kg 칸을 못 읽는다. 요약(fin_issue_summary)은 합계 kg 둘과 줄 수 · 원료별 «확인 필요» 줄 수뿐.
--   5절 자료 간 같은 거래 한 번만 — 판매 · 입고 줄에 거래일 · 거래처 · 출처 · 세액 · 품목/계정 칸, 세금계산서 목록 · 원장 거래 줄 표,
--        같은 거래 묶음(fin_tx_groups) · 기준 설정(fin_dedupe_settings). 맞추기는 앱 코드(순수 함수)가 하고 RPC로 저장만 한다.
--        원천 줄은 고치지 않는다.
--   6절 넣기와 손익 확정 분리 — 마감 달에 넣거나 되돌리면 «재마감 대상»(fin_reclose_flags) 한 줄. closings · 전표 · finance_kpis는 건드리지 않는다.
--   7절 자동 넣기 다섯째 조건 — 앱이 센 «중복 의심» 수(p_dup_suspects)가 1 이상이거나 안 보냈으면(null) 자동 넣기 거부.
--   8절 시드 정리 A안 — 시드 표 아홉에 is_example. 0003이 넣은 id 목록(seed-check.sql)만 true. 직원 세션에서는 안 보인다(restrictive).
--
-- ■ fin_upload_apply를 다시 만든다 ■ 인자 하나(p_dup_suspects int default null)가 늘어 옛 판(14개 인자)을 drop하고 새로 만든다.
--   본문은 0070과 한 줄씩 대조했다 — 권한 · 종류 · 기간 · 줄 수 · 겹침 선택 · 자문 잠금 · 옛 올리기 잠금 · 자동 거부(겹침 · 마감) ·
--   마감 달은 대표 · CFO + 이유 · 같은 파일 거부 · replace/keep_old · 감사 · 자동 알림을 그대로 지킨다.
--   더한 것: 새 종류 넷(valuation · material_issue · tax_invoice · ledger_lines) · 판매 · 입고 · 재고의 새 칸 · 자동 다섯째 조건 · 재마감 대상.
--   fin_upload_void · fin_upload_unvoid · fin_upload_revert도 새 표를 알도록 다시 만든다(되돌리기는 마감 달이면 재마감 대상도 남긴다).
--
-- ■ 판정 ■ 쓰기 = can_keep_books(회사)(대표 · CFO · 회사 대표 · 재무 입력 줄 보유 경영지원 팀장). 읽기 = can_read_books(회사).
--   새 정책 · grant는 늘 to authenticated(0060 교훈). 함수는 public · anon에게서 이름으로 걷는다.
-- 0035 규칙: force를 새로 걸지 않는다(잠금은 revoke + 정책 · 쓰기는 정의자 함수) · 0001~0071을 고치지 않는다 · FORCE를 내리지 않는다.
-- =====================================================================

begin;

-- =====================================================================
-- 0절. 도우미 — 값 상태 · 감사
-- =====================================================================

/** 상태와 값이 맞는가: 빈칸 = null · 0 확인 = 0 · 값 = 0 아닌 수. 검사 제약이 부른다. */
create or replace function fin_value_state_ok(p_state text, p_value numeric) returns boolean
language sql immutable set search_path = public, pg_temp as $fn$
  select case p_state
    when 'missing' then p_value is null
    when 'confirmed_zero' then p_value is not null and p_value = 0
    when 'value' then p_value is not null and p_value <> 0
    else false
  end;
$fn$;

/**
 * 앱이 보낸 상태가 없을 때의 상태. 빈칸(null) → missing · 0이 아닌 수 → value.
 * 0인데 상태가 없으면: 0072 새 입력(p_zero_ok = false)은 거부(fin_value_state) — 새 앱은 늘 상태를 보낸다.
 * 0070 시절 칸(재고 기말 금액 — 지금 앱이 상태 없이 보낸다)은 p_zero_ok = true: 앱이 읽은 «0이 적힌 칸»이므로 0 확인
 * (빈칸은 앱이 null로 보낸다 → missing).
 */
create or replace function fin_value_state_of(p_state text, p_value numeric, p_zero_ok boolean default false) returns text
language plpgsql immutable set search_path = public, pg_temp as $fn$
begin
  if p_state is not null then
    if not fin_value_state_ok(p_state, p_value) then
      raise exception 'fin_value_state' using errcode = '22023';
    end if;
    return p_state;
  end if;
  if p_value is null then
    return 'missing';
  end if;
  if p_value = 0 then
    if p_zero_ok then
      return 'confirmed_zero';
    end if;
    raise exception 'fin_value_state' using errcode = '22023';
  end if;
  return 'value';
end;
$fn$;

create or replace function fin_audit(p_action audit_action, p_table text, p_id text, p_biz text, p_before jsonb, p_after jsonb, p_note text)
returns void
language sql security definer set search_path = public, pg_temp as $fn$
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (p_action, p_table, p_id, p_biz, auth.uid(), auth_role()::text, p_before, p_after, p_note);
$fn$;

/** 'YYYY-MM'의 앞 달. */
create or replace function fin_prev_period(p_period text) returns text
language sql immutable set search_path = public, pg_temp as $fn$
  select to_char(to_date(p_period || '-01', 'YYYY-MM-DD') - interval '1 month', 'YYYY-MM');
$fn$;

-- =====================================================================
-- 1절. 종류 넷 더하기 · 빈칸 ≠ 0 (재고금액명세서 기초 · 기말)
-- =====================================================================
alter table fin_uploads drop constraint fin_uploads_kind_known;
alter table fin_uploads add constraint fin_uploads_kind_known check (kind in ('sales', 'purchase_in', 'inventory', 'production', 'ledger', 'payroll',
  'import', 'cashflow', 'card', 'overseas', 'promo', 'loans', 'borrowings', 'savings',
  'valuation', 'material_issue', 'tax_invoice', 'ledger_lines', 'unknown'));
alter table fin_upload_shapes drop constraint fin_upload_shapes_kind_known;
alter table fin_upload_shapes add constraint fin_upload_shapes_kind_known check (kind in ('sales', 'purchase_in', 'inventory', 'production', 'ledger',
  'payroll', 'import', 'cashflow', 'card', 'overseas', 'promo', 'loans', 'borrowings', 'savings',
  'valuation', 'material_issue', 'tax_invoice', 'ledger_lines'));

-- 재고금액명세서: 기말(amount) 상태 · 기초 금액과 상태. 0070 줄: null → missing · 0 → 0 확인(파일에 0이 적혀 있었다) · 그 밖 → value.
alter table fin_inventory_lines add column amount_state text;
alter table fin_inventory_lines add column opening_amount numeric(20,2);                                        -- [제한] 기초 재고금액
alter table fin_inventory_lines add column opening_state text not null default 'missing';                       -- [일반]
update fin_inventory_lines
   set amount_state = case when amount is null then 'missing' when amount = 0 then 'confirmed_zero' else 'value' end;
alter table fin_inventory_lines alter column amount_state set not null;
alter table fin_inventory_lines add constraint fin_inventory_lines_amount_state check (fin_value_state_ok(amount_state, amount));
alter table fin_inventory_lines add constraint fin_inventory_lines_opening_state check (fin_value_state_ok(opening_state, opening_amount));
-- 0072 리뷰 I2: 사용수량(used_qty — 품목별 한 달 사용 kg)은 생산수량과 겹치면 배합비가 드러난다. 앱은 이 표를 읽지 않는다
-- (src 확인 2026-10-12 — kinds.ts가 넣을 칸으로만 쓴다). 열 grant로 바꾸고 used_qty를 뺀다.
revoke select on table fin_inventory_lines from authenticated;
grant select (line_id, upload_id, business_id, period, row_no, item, stock_qty, amount, amount_state, opening_amount, opening_state, voided_at, created_at)
  on table fin_inventory_lines to authenticated;
comment on column fin_inventory_lines.amount_state is '0072. 기말 재고금액의 상태 — missing(빈칸, 값 null) · confirmed_zero(0 확인) · value.';
comment on column fin_inventory_lines.opening_amount is '0072. 재고금액명세서의 기초 재고금액(표시 · 대조용 — 기초재고 연결은 앞 달 확정 기말이 먼저다).';

-- =====================================================================
-- 6절(먼저 — 2절 · 3절 RPC가 쓴다). 재마감 대상
-- =====================================================================
create table fin_reclose_flags (
  flag_id     uuid primary key default gen_random_uuid(),
  business_id text not null references businesses(business_id) on delete restrict,           -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),                     -- [일반]
  upload_id   uuid references fin_uploads(upload_id) on delete restrict,                       -- [일반] 올리기 · 되돌리기에서 왔으면
  cause       text not null check (cause in ('upload', 'revert', 'valuation', 'opening')),    -- [일반]
  reason      text check (reason is null or length(reason) <= 500),                           -- [일반]
  created_by  uuid not null default auth.uid(),                                               -- [제한]
  created_at  timestamptz not null default now(),
  cleared_at  timestamptz,                                                                    -- [일반] 다시 마감하면
  cleared_by  uuid
);
create index fin_reclose_flags_open on fin_reclose_flags (business_id, period) where cleared_at is null;
comment on table fin_reclose_flags is
  '0072. «재마감 대상» — 마감된 달에 자료가 들어오거나 빠졌다. 넣기는 손익(closings · 전표 · finance_kpis)을 건드리지 않는다 — 다시 마감할 때 반영한다.';
alter table fin_reclose_flags enable row level security;
revoke all on table fin_reclose_flags from public, anon, authenticated;
grant select on table fin_reclose_flags to authenticated;
create policy fin_reclose_flags_read on fin_reclose_flags for select to authenticated using (can_read_books(business_id));

/** 마감 달이면 재마감 대상 한 줄(같은 회사 · 달 · 올리기 · 까닭의 열린 줄이 있으면 늘리지 않는다). 이 파일의 RPC만 부른다. */
create or replace function fin_reclose_mark(p_business text, p_period text, p_upload uuid, p_cause text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not fin_month_closed(p_business, p_period) then
    return;
  end if;
  if exists (select 1 from fin_reclose_flags f where f.business_id = p_business and f.period = p_period and f.cleared_at is null
               and f.cause = p_cause and f.upload_id is not distinct from p_upload) then
    return;
  end if;
  insert into fin_reclose_flags (business_id, period, upload_id, cause, reason)
  values (p_business, p_period, p_upload, p_cause, left(nullif(btrim(coalesce(p_reason, '')), ''), 500));
end;
$fn$;

/** 재마감 대상 풀기 — 그 달을 마감할 수 있는 사람(can_close_books)이 다시 마감한 뒤. 지우지 않는다. */
create or replace function fin_reclose_clear(p_flag uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_row fin_reclose_flags;
begin
  select * into v_row from fin_reclose_flags where flag_id = p_flag for update;
  if v_row.flag_id is null or not coalesce(can_close_books(v_row.business_id), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if v_row.cleared_at is not null then
    return false;
  end if;
  update fin_reclose_flags set cleared_at = now(), cleared_by = auth.uid() where flag_id = p_flag;
  perform fin_audit('update', 'fin_reclose_flags', p_flag::text, v_row.business_id, null,
    jsonb_build_object('period', v_row.period, 'cleared', true, 'note', p_note), '재마감 대상 풀기(0072)');
  return true;
end;
$fn$;

-- =====================================================================
-- 2절. 재공품 · 완제품 월말 평가금액
-- =====================================================================
create table fin_inventory_valuations (
  valuation_id     uuid primary key default gen_random_uuid(),
  business_id      text not null references businesses(business_id) on delete restrict,                 -- [일반]
  period           text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),                           -- [일반]
  category         text not null check (category in ('wip', 'finished')),                                 -- [일반] 재공품 · 완제품
  amount           numeric(20,2),                                                                          -- [제한] 평가금액(빈칸은 null)
  value_state      text not null,                                                                          -- [일반]
  valuation_date   date,                                                                                   -- [일반] 평가 기준일
  method           text check (method is null or length(method) <= 60),                                   -- [일반] 예: 월 가중평균
  cost_scope       text not null check (cost_scope in ('material_only', 'material_labor_overhead')),      -- [일반] 포함 범위
  source           text not null check (source in ('manual', 'excel', 'pdf')),                            -- [일반]
  source_upload_id uuid references fin_uploads(upload_id) on delete restrict,                             -- [일반]
  source_ref       text check (source_ref is null or length(source_ref) <= 120),                          -- [일반] 출처 줄(예: 시트 12줄 · PDF 3쪽)
  note             text check (note is null or length(note) <= 500),                                      -- [일반]
  status           text not null check (status in ('entering', 'provisional', 'final')),                  -- [일반] 입력 중 · 잠정 · 확정
  entered_by       uuid not null default auth.uid(),                                                       -- [제한]
  entered_at       timestamptz not null default now(),
  confirmed_by     uuid,                                                                                   -- [제한]
  confirmed_at     timestamptz,
  voided_at        timestamptz,                                                                            -- [일반] 바꾸기 · 무효(지우지 않는다)
  void_reason      text check (void_reason is null or length(void_reason) <= 500),
  constraint fin_inventory_valuations_state check (fin_value_state_ok(value_state, amount)),
  constraint fin_inventory_valuations_final check (status <> 'final' or (confirmed_by is not null and confirmed_at is not null
                                                                         and confirmed_by <> entered_by and value_state <> 'missing')),
  constraint fin_inventory_valuations_void check ((voided_at is null) = (void_reason is null))
);
create unique index fin_inventory_valuations_live on fin_inventory_valuations (business_id, period, category) where voided_at is null;
comment on table fin_inventory_valuations is
  '0072. 재공품 · 완제품 월말 평가금액. 회사 · 달 · 구분마다 살아 있는 줄 하나. 확정은 입력한 사람이 아닌 장부 담당만. 쓰기는 fin_valuation_* · fin_upload_apply만.';
alter table fin_inventory_valuations enable row level security;
revoke all on table fin_inventory_valuations from public, anon, authenticated;
grant select on table fin_inventory_valuations to authenticated;
create policy fin_inventory_valuations_read on fin_inventory_valuations for select to authenticated using (can_read_books(business_id));

/** 마감 달 쓰기 문: 마감이면 대표 · 그룹 CFO + 이유(2자 이상)만. 0070 fin_upload_apply와 같은 문. */
create or replace function fin_closed_gate(p_business text, p_period text, p_reason text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if fin_month_closed(p_business, p_period)
     and not (coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO') and length(btrim(coalesce(p_reason, ''))) >= 2) then
    raise exception 'fin_upload_closed' using errcode = '42501';
  end if;
end;
$fn$;

/**
 * 평가금액 저장 — 입력 중(entering) 또는 잠정(provisional). 살아 있는 줄이 있으면 무효 + 새 줄.
 * 확정된 줄을 바꾸려면 이유(2자 이상)가 있어야 한다. 마감 달은 대표 · CFO + 이유 · 재마감 대상.
 */
create or replace function fin_valuation_save(
  p_business text, p_period text, p_category text, p_amount numeric, p_state text, p_valuation_date date,
  p_method text, p_cost_scope text, p_source text, p_upload uuid, p_source_ref text, p_note text, p_status text, p_reason text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_old   fin_inventory_valuations;
  v_id    uuid;
  v_state text;
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fin_upload_period' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('entering', 'provisional') then
    raise exception 'fin_valuation_status' using errcode = '22023';
  end if;
  if p_upload is not null and not exists (select 1 from fin_uploads u where u.upload_id = p_upload and u.business_id = p_business) then
    raise exception 'fin_valuation_upload' using errcode = '22023';
  end if;
  v_state := fin_value_state_of(p_state, p_amount);
  perform fin_closed_gate(p_business, p_period, p_reason);
  perform pg_advisory_xact_lock(hashtext('fin_valuation:' || p_business || ':' || p_period || ':' || coalesce(p_category, '')));
  select * into v_old from fin_inventory_valuations
   where business_id = p_business and period = p_period and category = p_category and voided_at is null for update;
  if v_old.valuation_id is not null then
    if v_old.status = 'final' and length(btrim(coalesce(p_reason, ''))) < 2 then
      raise exception 'fin_valuation_reason' using errcode = '22023';
    end if;
    update fin_inventory_valuations set voided_at = now(), void_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), '새 값으로 바꿈')
     where valuation_id = v_old.valuation_id;
  end if;
  insert into fin_inventory_valuations (business_id, period, category, amount, value_state, valuation_date, method, cost_scope, source,
                                        source_upload_id, source_ref, note, status)
  values (p_business, p_period, p_category, p_amount, v_state, p_valuation_date, nullif(btrim(coalesce(p_method, '')), ''),
          p_cost_scope, coalesce(p_source, 'manual'), p_upload, p_source_ref, nullif(btrim(coalesce(p_note, '')), ''), p_status)
  returning valuation_id into v_id;
  perform fin_reclose_mark(p_business, p_period, null, 'valuation', p_reason);
  perform fin_audit('create', 'fin_inventory_valuations', v_id::text, p_business,
    case when v_old.valuation_id is null then null else jsonb_build_object('replaced', v_old.valuation_id, 'status', v_old.status) end,
    jsonb_build_object('period', p_period, 'category', p_category, 'status', p_status, 'cost_scope', p_cost_scope,
                       'source', coalesce(p_source, 'manual'), 'state', v_state, 'reason', p_reason),
    '재공품 · 완제품 평가금액 저장(0072)');
  return v_id;
end;
$fn$;

/** 확정 — 입력한 사람이 아닌 장부 담당만(fin_valuation_self_confirm). 빈칸(missing)은 확정하지 못한다. */
create or replace function fin_valuation_confirm(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_row fin_inventory_valuations;
begin
  select * into v_row from fin_inventory_valuations where valuation_id = p_id for update;
  if v_row.valuation_id is null or not coalesce(can_keep_books(v_row.business_id), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if v_row.voided_at is not null or v_row.status = 'final' then
    return false;
  end if;
  if v_row.entered_by = auth.uid() then
    raise exception 'fin_valuation_self_confirm' using errcode = '42501';
  end if;
  if v_row.value_state = 'missing' then
    raise exception 'fin_valuation_missing' using errcode = '22023';
  end if;
  perform fin_closed_gate(v_row.business_id, v_row.period, p_reason);
  update fin_inventory_valuations set status = 'final', confirmed_by = auth.uid(), confirmed_at = now() where valuation_id = p_id;
  perform fin_reclose_mark(v_row.business_id, v_row.period, null, 'valuation', p_reason);
  perform fin_audit('approve', 'fin_inventory_valuations', p_id::text, v_row.business_id, jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', 'final', 'period', v_row.period, 'category', v_row.category, 'entered_by', v_row.entered_by),
    '재공품 · 완제품 평가금액 확정(0072)');
  return true;
end;
$fn$;

/** 무효 — 이유 필수(2자 이상). 지우지 않는다. */
create or replace function fin_valuation_void(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_row fin_inventory_valuations;
begin
  select * into v_row from fin_inventory_valuations where valuation_id = p_id for update;
  if v_row.valuation_id is null or not coalesce(can_keep_books(v_row.business_id), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 then
    raise exception 'fin_valuation_reason' using errcode = '22023';
  end if;
  if v_row.voided_at is not null then
    return false;
  end if;
  perform fin_closed_gate(v_row.business_id, v_row.period, p_reason);
  update fin_inventory_valuations set voided_at = now(), void_reason = left(btrim(p_reason), 500) where valuation_id = p_id;
  perform fin_reclose_mark(v_row.business_id, v_row.period, null, 'valuation', p_reason);
  perform fin_audit('update', 'fin_inventory_valuations', p_id::text, v_row.business_id, jsonb_build_object('status', v_row.status),
    jsonb_build_object('voided', true, 'reason', p_reason), '재공품 · 완제품 평가금액 무효(0072)');
  return true;
end;
$fn$;

/**
 * 경고(보여 주기만 — 고치지 않는다).
 *   scope_mismatch: 이 달 기말과 앞 달 확정 기말의 포함 범위(cost_scope)가 다르다 → «기초 · 기말 포함 범위가 다름».
 *   wip_finished_duplicate: 같은 달 재공품 · 완제품이 같은 금액이고 같은 올리기 또는 같은 출처 줄 → «재공품 · 완제품 중복 의심».
 */
create or replace function fin_valuation_warnings(p_business text, p_period text)
returns table (kind text, category text, message text, detail jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
begin
  if not coalesce(can_read_books(p_business), false) then
    return;
  end if;
  return query
    select 'scope_mismatch'::text, c.category, '기초 · 기말 포함 범위가 다름'::text,
           jsonb_build_object('closing_scope', c.cost_scope, 'opening_scope', p.cost_scope, 'prev_period', p.period)
      from fin_inventory_valuations c
      join fin_inventory_valuations p on p.business_id = c.business_id and p.period = fin_prev_period(c.period) and p.category = c.category
                                     and p.voided_at is null and p.status = 'final'
     where c.business_id = p_business and c.period = p_period and c.voided_at is null and c.cost_scope <> p.cost_scope;
  return query
    select 'wip_finished_duplicate'::text, 'wip,finished'::text, '재공품 · 완제품 중복 의심'::text,
           jsonb_build_object('amount', w.amount, 'upload_id', w.source_upload_id, 'source_ref', w.source_ref)
      from fin_inventory_valuations w
      join fin_inventory_valuations f on f.business_id = w.business_id and f.period = w.period and f.category = 'finished' and f.voided_at is null
     where w.business_id = p_business and w.period = p_period and w.category = 'wip' and w.voided_at is null
       and w.amount is not null and w.amount = f.amount
       and ((w.source_upload_id is not null and w.source_upload_id = f.source_upload_id)
            or (w.source_ref is not null and w.source_ref = f.source_ref));
end;
$fn$;

-- =====================================================================
-- 3절. 기초재고 연결 — 첫 달 직접 입력(fin_inventory_openings) · fin_inventory_roll
-- =====================================================================
create table fin_inventory_openings (
  opening_id       uuid primary key default gen_random_uuid(),
  business_id      text not null references businesses(business_id) on delete restrict,                 -- [일반]
  period           text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),                           -- [일반] 이 달의 기초
  category         text not null check (category in ('raw', 'wip', 'finished')),                          -- [일반] 원재료 · 재공품 · 완제품
  amount           numeric(20,2),                                                                          -- [제한]
  value_state      text not null,                                                                          -- [일반]
  source           text not null check (source in ('manual', 'statement')),                               -- [일반] 손 입력 · 재고금액명세서
  source_upload_id uuid references fin_uploads(upload_id) on delete restrict,                             -- [일반]
  note             text not null check (length(btrim(note)) between 2 and 500),                           -- [일반] 이유 · 출처 설명(필수)
  entered_by       uuid not null default auth.uid(),                                                       -- [제한]
  entered_at       timestamptz not null default now(),
  confirmed_by     uuid,                                                                                   -- [제한] (B2 화면에서 쓸 칸 — 이 파일은 확정 RPC를 두지 않는다)
  confirmed_at     timestamptz,
  voided_at        timestamptz,
  void_reason      text check (void_reason is null or length(void_reason) <= 500),
  constraint fin_inventory_openings_state check (fin_value_state_ok(value_state, amount)),
  constraint fin_inventory_openings_void check ((voided_at is null) = (void_reason is null))
);
create unique index fin_inventory_openings_live on fin_inventory_openings (business_id, period, category) where voided_at is null;
comment on table fin_inventory_openings is
  '0072. 첫 달 기초재고 직접 입력(앞 달 확정 기말이 없을 때만 쓰인다). 회사 · 달 · 구분마다 살아 있는 줄 하나. 쓰기는 fin_opening_save만.';
alter table fin_inventory_openings enable row level security;
revoke all on table fin_inventory_openings from public, anon, authenticated;
grant select on table fin_inventory_openings to authenticated;
create policy fin_inventory_openings_read on fin_inventory_openings for select to authenticated using (can_read_books(business_id));

/** 첫 달 기초 저장 — 출처(manual · statement)와 이유(2자 이상) 필수. 살아 있는 줄이 있으면 무효 + 새 줄. 감사. */
create or replace function fin_opening_save(
  p_business text, p_period text, p_category text, p_amount numeric, p_state text, p_source text, p_upload uuid, p_note text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_old   uuid;
  v_id    uuid;
  v_state text;
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fin_upload_period' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('manual', 'statement') or length(btrim(coalesce(p_note, ''))) < 2 then
    raise exception 'fin_opening_reason' using errcode = '22023';
  end if;
  if p_upload is not null and not exists (select 1 from fin_uploads u where u.upload_id = p_upload and u.business_id = p_business) then
    raise exception 'fin_valuation_upload' using errcode = '22023';
  end if;
  v_state := fin_value_state_of(p_state, p_amount);
  perform fin_closed_gate(p_business, p_period, p_note);
  perform pg_advisory_xact_lock(hashtext('fin_opening:' || p_business || ':' || p_period || ':' || coalesce(p_category, '')));
  update fin_inventory_openings set voided_at = now(), void_reason = '새 값으로 바꿈'
   where business_id = p_business and period = p_period and category = p_category and voided_at is null
  returning opening_id into v_old;
  insert into fin_inventory_openings (business_id, period, category, amount, value_state, source, source_upload_id, note)
  values (p_business, p_period, p_category, p_amount, v_state, p_source, p_upload, left(btrim(p_note), 500))
  returning opening_id into v_id;
  perform fin_reclose_mark(p_business, p_period, null, 'opening', p_note);
  perform fin_audit('create', 'fin_inventory_openings', v_id::text, p_business,
    case when v_old is null then null else jsonb_build_object('replaced', v_old) end,
    jsonb_build_object('period', p_period, 'category', p_category, 'source', p_source, 'state', v_state, 'note', p_note),
    '첫 달 기초재고 입력(0072)');
  return v_id;
end;
$fn$;

/**
 * 기초재고 연결(보여 주기만). 구분마다 한 줄:
 *   raw(원재료)      — 기말 = 이 달 재고금액명세서 줄의 기말 합. 앞 달 기말 = 앞 달 명세서 기말 합(줄이 있을 때).
 *                      statement_opening = 이 달 명세서 기초 합. 둘 다 있으면 diff = 명세서 기초 − 앞 달 기말(고치지 않는다).
 *   wip · finished   — 기말 = 이 달 살아 있는 평가금액(상태 함께). 앞 달 기말 = 앞 달 «확정» 평가금액만.
 *   기초: 앞 달 기말이 있으면 prev_close → 없으면 첫 달 직접 입력(manual · statement) → 없으면 unlinked(«미연결»).
 *   빈칸은 0으로 더하지 않는다: 줄이 없거나 전부 빈칸이면 missing(null), 일부 빈칸이면 합과 함께 빈칸 줄 수(missing_lines).
 */
create or replace function fin_inventory_roll(p_business text, p_period text)
returns table (category text, opening_amount numeric, opening_state text, opening_source text,
               closing_amount numeric, closing_state text, closing_status text, missing_lines int,
               statement_opening numeric, diff_vs_prev_close numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
declare
  v_prev text := fin_prev_period(p_period);
  c      text;
  v_pa   numeric; v_ps text;     -- 앞 달 기말
  v_oa   numeric; v_os text; v_osrc text;
  v_ca   numeric; v_cs text; v_cst text; v_miss int;
  v_st   numeric;
  v_n    int; v_known int;
begin
  if not coalesce(can_read_books(p_business), false) or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return;
  end if;
  foreach c in array array['raw', 'wip', 'finished'] loop
    v_pa := null; v_ps := null; v_ca := null; v_cs := 'missing'; v_cst := null; v_miss := 0; v_st := null;
    if c = 'raw' then
      -- 앞 달 기말
      select count(*), count(*) filter (where l.amount_state <> 'missing'), sum(l.amount) filter (where l.amount_state <> 'missing')
        into v_n, v_known, v_pa
        from fin_inventory_lines l where l.business_id = p_business and l.period = v_prev and l.voided_at is null;
      if v_known = 0 then v_pa := null; v_ps := null; else v_ps := case when v_pa = 0 then 'confirmed_zero' else 'value' end; end if;
      -- 이 달 기말 · 명세서 기초
      select count(*), count(*) filter (where l.amount_state <> 'missing'), sum(l.amount) filter (where l.amount_state <> 'missing'),
             count(*) filter (where l.amount_state = 'missing'),
             sum(l.opening_amount) filter (where l.opening_state <> 'missing')
        into v_n, v_known, v_ca, v_miss, v_st
        from fin_inventory_lines l where l.business_id = p_business and l.period = p_period and l.voided_at is null;
      if v_known = 0 then v_ca := null; v_cs := 'missing'; else v_cs := case when v_ca = 0 then 'confirmed_zero' else 'value' end; end if;
    else
      select v.amount, v.value_state into v_pa, v_ps
        from fin_inventory_valuations v
       where v.business_id = p_business and v.period = v_prev and v.category = c and v.voided_at is null and v.status = 'final';
      if v_ps = 'missing' then v_pa := null; v_ps := null; end if;
      select v.amount, v.value_state, v.status into v_ca, v_cs, v_cst
        from fin_inventory_valuations v
       where v.business_id = p_business and v.period = p_period and v.category = c and v.voided_at is null;
      v_cs := coalesce(v_cs, 'missing');
    end if;

    if v_ps is not null then
      v_oa := v_pa; v_os := v_ps; v_osrc := 'prev_close';
    else
      select o.amount, o.value_state, o.source into v_oa, v_os, v_osrc
        from fin_inventory_openings o
       where o.business_id = p_business and o.period = p_period and o.category = c and o.voided_at is null;
      if v_osrc is null then
        v_oa := null; v_os := 'missing'; v_osrc := 'unlinked';
      end if;
    end if;

    category := c; opening_amount := v_oa; opening_state := v_os; opening_source := v_osrc;
    closing_amount := v_ca; closing_state := v_cs; closing_status := v_cst; missing_lines := v_miss;
    statement_opening := v_st;
    diff_vs_prev_close := case when v_st is not null and v_ps is not null then v_st - v_pa end;
    return next;
    v_oa := null; v_os := null; v_osrc := null;
  end loop;
end;
$fn$;

-- =====================================================================
-- 4절. 원료 출고명세 — 생산 투입 · 비생산 · 확인 필요
-- =====================================================================
create table fin_material_issues (
  line_id             bigint generated always as identity primary key,
  upload_id           uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id         text not null references businesses(business_id) on delete restrict,             -- [일반]
  period              text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),                       -- [일반]
  row_no              int not null check (row_no >= 0),                                                  -- [일반] 원본 시트의 줄
  issued_on           date,                                                                              -- [일반] 출고일
  material            text,                                                                              -- [일반] 원료
  qty_kg              numeric(20,4),                                                                     -- [제한] 출고 kg — authenticated grant 없음(구성표 노출 금지)
  qty_state           text not null,                                                                     -- [일반]
  issue_type          text,                                                                              -- [일반] 출고 유형
  memo                text,                                                                              -- [일반] 적요
  warehouse           text,                                                                              -- [일반] 창고
  class               text not null default 'needs_review'
                      check (class in ('production', 'non_production', 'needs_review')),                -- [일반] 생산 투입 · 비생산 · 확인 필요
  non_production_kind text check (non_production_kind in ('sample', 'scrap', 'return', 'transfer', 'adjust')),  -- [일반]
  class_source        text not null default 'none' check (class_source in ('rule', 'bulk', 'none')),    -- [일반]
  class_reason        text check (class_reason is null or length(class_reason) <= 200),                 -- [일반] 규칙 이름 · 일괄 결정 이유
  decided_by          uuid,                                                                              -- [제한]
  decided_at          timestamptz,
  voided_at           timestamptz,                                                                       -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at          timestamptz not null default now(),
  constraint fin_material_issues_qty check (fin_value_state_ok(qty_state, qty_kg)),
  constraint fin_material_issues_class check (
    (class = 'needs_review' and class_source = 'none' and non_production_kind is null)
    or (class = 'production' and class_source in ('rule', 'bulk') and non_production_kind is null and length(btrim(coalesce(class_reason, ''))) >= 2)
    or (class = 'non_production' and class_source in ('rule', 'bulk') and length(btrim(coalesce(class_reason, ''))) >= 2))
);
create index fin_material_issues_by_period on fin_material_issues (business_id, period) where voided_at is null;
comment on table fin_material_issues is
  '0072. 원료 출고명세. 구분이 없으면 늘 «확인 필요»(생산 투입은 기본값이 아니다). kg 칸은 authenticated가 읽지 못한다 — 합계는 fin_issue_summary만.';
alter table fin_material_issues enable row level security;
revoke all on table fin_material_issues from public, anon, authenticated;
-- 구성표 노출 금지: qty_kg · qty_state는 열 grant에서 뺀다(원료별 kg + 제품 생산수량 = 배합비).
grant select (line_id, upload_id, business_id, period, row_no, issued_on, material, issue_type, memo, warehouse, class, non_production_kind,
              class_source, class_reason, decided_by, decided_at, voided_at, created_at)
  on table fin_material_issues to authenticated;
create policy fin_material_issues_read on fin_material_issues for select to authenticated using (can_read_books(business_id));

/**
 * 일괄 결정 — 그 회사 · 그 달 · 그 원료의 «확인 필요» 줄만. 이유 필수(2자 이상). 감사 한 줄(줄 수와 함께).
 * 이미 사람이 · 규칙이 정한 줄은 건드리지 않는다. 출고 원천 칸(원료 · kg · 적요 …)은 고치지 않는다 — 구분 칸만.
 */
create or replace function fin_issue_bulk_decide(
  p_business text, p_period text, p_material text, p_class text, p_non_production_kind text, p_reason text
) returns int
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_n int;
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 then
    raise exception 'fin_issue_reason' using errcode = '22023';
  end if;
  if p_class is null or p_class not in ('production', 'non_production')
     or (p_class = 'production' and p_non_production_kind is not null)
     or (p_non_production_kind is not null and p_non_production_kind not in ('sample', 'scrap', 'return', 'transfer', 'adjust')) then
    raise exception 'fin_issue_class' using errcode = '22023';
  end if;
  if p_material is null or p_period is null then
    raise exception 'fin_issue_class' using errcode = '22023';
  end if;
  perform fin_closed_gate(p_business, p_period, p_reason);
  update fin_material_issues
     set class = p_class, non_production_kind = p_non_production_kind, class_source = 'bulk', class_reason = left(btrim(p_reason), 200),
         decided_by = auth.uid(), decided_at = now()
   where business_id = p_business and period = p_period and material = p_material and class = 'needs_review' and voided_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform fin_reclose_mark(p_business, p_period, null, 'upload', p_reason);
  end if;
  perform fin_audit('update', 'fin_material_issues', p_business || ':' || p_period, p_business, null,
    jsonb_build_object('period', p_period, 'material', p_material, 'class', p_class, 'non_production_kind', p_non_production_kind,
                       'lines', v_n, 'reason', p_reason),
    '원료 출고 일괄 결정(0072)');
  return v_n;
end;
$fn$;

/**
 * 원료 출고 요약 — 이것만 돌려준다(구성표 노출 금지):
 *   production_input_kg  생산 투입 줄 kg 합을 100kg 단위로 반올림. 다음 둘이 모두일 때만 — 아니면 null과 까닭(input_withheld):
 *                          · 그 달 «확인 필요» 줄이 0(needs_review_open) — 줄 하나를 정할 때마다 합계가 그 줄 kg만큼 움직여
 *                            시간 차로 한 원료의 kg가 드러난다(리뷰 I2).
 *                          · 생산 투입 원료가 3가지 이상(too_few_materials) — 하나 · 둘이면 합계에서 원료 kg가 바로 나온다.
 *                        빈칸 kg는 더하지 않는다(빈칸 줄 수는 input_missing_lines).
 *   production_qty_kg    이 달 제조지시명세서 생산수량 합(kg로 본다).
 *   lines                구분별 줄 수.
 *   needs_review         원료별 «확인 필요» 줄 수(kg 없음).
 * 원료별 · 제품별 kg는 어디에도 없다. 남은 위험(바꾸기 올리기 전후 합계 차이)은 DEFERRED.md.
 */
create or replace function fin_issue_summary(p_business text, p_period text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_in    numeric;
  v_miss  int;
  v_mats  int;
  v_open  int;
  v_qty   numeric;
  v_lines jsonb;
  v_need  jsonb;
  v_why   text;
begin
  if not coalesce(can_read_books(p_business), false) then
    return null;
  end if;
  select sum(i.qty_kg) filter (where i.qty_state <> 'missing'), count(*) filter (where i.qty_state = 'missing'),
         count(distinct i.material)
    into v_in, v_miss, v_mats
    from fin_material_issues i
   where i.business_id = p_business and i.period = p_period and i.voided_at is null and i.class = 'production';
  select count(*) into v_open from fin_material_issues i
   where i.business_id = p_business and i.period = p_period and i.voided_at is null and i.class = 'needs_review';
  select sum(p.qty) into v_qty from fin_production_lines p where p.business_id = p_business and p.period = p_period and p.voided_at is null;
  select jsonb_build_object(
           'production', count(*) filter (where i.class = 'production'),
           'non_production', count(*) filter (where i.class = 'non_production'),
           'needs_review', count(*) filter (where i.class = 'needs_review'))
    into v_lines
    from fin_material_issues i where i.business_id = p_business and i.period = p_period and i.voided_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('material', m.material, 'lines', m.n) order by m.material), '[]'::jsonb)
    into v_need
    from (select i.material, count(*) as n from fin_material_issues i
           where i.business_id = p_business and i.period = p_period and i.voided_at is null and i.class = 'needs_review'
           group by i.material) m;
  v_why := case when v_open > 0 then 'needs_review_open' when v_mats < 3 then 'too_few_materials' end;
  return jsonb_build_object(
    'production_input_kg', case when v_why is null then round(v_in, -2) end,
    'input_withheld', v_why,
    'input_missing_lines', v_miss,
    'production_qty_kg', v_qty,
    'lines', v_lines,
    'needs_review', v_need);
end;
$fn$;

-- =====================================================================
-- 5절. 자료 간 같은 거래 한 번만 — 칸 · 세금계산서 · 원장 거래 줄 · 묶음 · 기준 설정
-- =====================================================================
alter table fin_sales_lines add column tx_date date;                                                      -- [일반] 거래일
alter table fin_sales_lines add column counterparty text;                                                 -- [일반] 거래처(customer와 같은 값일 수 있다)
alter table fin_sales_lines add column source_system text check (source_system in ('r2', 'ecount', 'ledger', 'tax_invoice', 'other'));  -- [일반]
alter table fin_sales_lines add column amount_vat numeric(20,2);                                          -- [제한] 세액(빈칸 null)
alter table fin_sales_lines add column vat_state text not null default 'missing';                        -- [일반]
alter table fin_sales_lines add column item_or_account text;                                              -- [일반] 품목 또는 계정
alter table fin_sales_lines add constraint fin_sales_lines_vat_state check (fin_value_state_ok(vat_state, amount_vat));

alter table fin_purchase_in_lines add column tx_date date;
alter table fin_purchase_in_lines add column counterparty text;
alter table fin_purchase_in_lines add column source_system text check (source_system in ('r2', 'ecount', 'ledger', 'tax_invoice', 'other'));
alter table fin_purchase_in_lines add column amount_vat numeric(20,2);
alter table fin_purchase_in_lines add column vat_state text not null default 'missing';
alter table fin_purchase_in_lines add column item_or_account text;
alter table fin_purchase_in_lines add constraint fin_purchase_in_lines_vat_state check (fin_value_state_ok(vat_state, amount_vat));

create table fin_tax_invoice_lines (
  line_id       bigint generated always as identity primary key,
  upload_id     uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id   text not null references businesses(business_id) on delete restrict,  -- [일반]
  period        text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no        int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  issued_on     date,                                                                     -- [일반] 작성일
  counterparty  text,                                                                     -- [일반] 거래처
  item          text,                                                                     -- [일반] 품목
  supply_amount numeric(20,2),                                                            -- [제한] 공급가액
  supply_state  text not null,                                                            -- [일반]
  vat           numeric(20,2),                                                            -- [제한] 세액(영세율 0은 «0 확인»)
  vat_state     text not null,                                                            -- [일반]
  total         numeric(20,2),                                                            -- [제한] 합계(빈칸 null)
  direction     text not null check (direction in ('sales', 'purchase')),                -- [일반] 매출 · 매입
  voided_at     timestamptz,                                                              -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at    timestamptz not null default now(),
  constraint fin_tax_invoice_lines_supply check (fin_value_state_ok(supply_state, supply_amount)),
  constraint fin_tax_invoice_lines_vat check (fin_value_state_ok(vat_state, vat))
);
create index fin_tax_invoice_lines_by_period on fin_tax_invoice_lines (business_id, period) where voided_at is null;
comment on table fin_tax_invoice_lines is '0072. 세금계산서 목록. 회계 · 재무 자료 올리기가 넣는다(fin_upload_apply만). 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_tax_invoice_lines enable row level security;
revoke all on table fin_tax_invoice_lines from public, anon, authenticated;
grant select on table fin_tax_invoice_lines to authenticated;
create policy fin_tax_invoice_lines_read on fin_tax_invoice_lines for select to authenticated using (can_read_books(business_id));

create table fin_ledger_lines (
  line_id      bigint generated always as identity primary key,
  upload_id    uuid not null references fin_uploads(upload_id) on delete restrict,
  business_id  text not null references businesses(business_id) on delete restrict,  -- [일반]
  period       text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),            -- [일반]
  row_no       int not null check (row_no >= 0),                                         -- [일반] 원본 시트의 줄
  tx_date      date,                                                                     -- [일반] 일자
  account_code text,                                                                     -- [일반] 계정코드
  account_name text,                                                                     -- [일반] 계정명
  counterparty text,                                                                     -- [일반] 거래처
  memo         text,                                                                     -- [일반] 적요
  debit        numeric(20,2),                                                            -- [제한] 차변(빈칸 null — 한쪽만 있는 것이 보통이다)
  credit       numeric(20,2),                                                            -- [제한] 대변
  voided_at    timestamptz,                                                              -- [일반] 되돌리기 · 바꾸기(지우지 않는다)
  created_at   timestamptz not null default now()
);
create index fin_ledger_lines_by_period on fin_ledger_lines (business_id, period) where voided_at is null;
comment on table fin_ledger_lines is '0072. 계정별 원장 거래 줄(0070 fin_ledger_sums 월 합계 옆). fin_upload_apply만 넣는다. 수정 · 삭제 없음 — 되돌리기는 voided_at.';
alter table fin_ledger_lines enable row level security;
revoke all on table fin_ledger_lines from public, anon, authenticated;
grant select on table fin_ledger_lines to authenticated;
create policy fin_ledger_lines_read on fin_ledger_lines for select to authenticated using (can_read_books(business_id));

-- 같은 거래 묶음. 맞추기는 앱 코드(순수 함수) — 이 표는 그 결과와 사람의 결정만 둔다. 원천 줄은 고치지 않는다.
create table fin_tx_groups (
  group_id        uuid primary key default gen_random_uuid(),
  business_id     text not null references businesses(business_id) on delete restrict,                 -- [일반]
  period          text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),                           -- [일반]
  status          text not null check (status in ('same', 'suspect', 'rejected')),                       -- [일반] 같은 거래 · 중복 의심 · 다른 거래
  evidence        jsonb check (evidence is null or jsonb_typeof(evidence) = 'object'),                   -- [일반] 맞은 열쇠(거래일 · 거래처 · 금액 …)
  amount_base_ref text check (amount_base_ref is null or amount_base_ref ~ '^fin_[a-z_]+:[0-9]+$'),      -- [일반] 금액 기준 줄(표:줄)
  qty_base_ref    text check (qty_base_ref is null or qty_base_ref ~ '^fin_[a-z_]+:[0-9]+$'),            -- [일반] 수량 기준 줄
  saved_by        uuid not null default auth.uid(),                                                       -- [제한]
  saved_at        timestamptz not null default now(),
  decided_by      uuid,                                                                                   -- [제한] 사람이 정했으면
  decided_at      timestamptz,
  reason          text check (reason is null or length(reason) <= 500),                                  -- [일반]
  constraint fin_tx_groups_same_evidence check (status <> 'same' or decided_by is not null
                                                or (evidence is not null and evidence <> '{}'::jsonb))
);
create index fin_tx_groups_by_period on fin_tx_groups (business_id, period);
comment on table fin_tx_groups is
  '0072. 자료 간 같은 거래 묶음. same(열쇠가 맞음 · 또는 사람이 정함) · suspect(중복 의심 — 자동으로 same이 되지 않는다) · rejected(다른 거래). 쓰기는 fin_tx_group_*만.';
alter table fin_tx_groups enable row level security;
revoke all on table fin_tx_groups from public, anon, authenticated;
grant select on table fin_tx_groups to authenticated;
create policy fin_tx_groups_read on fin_tx_groups for select to authenticated using (can_read_books(business_id));

create table fin_tx_group_members (
  group_id     uuid not null references fin_tx_groups(group_id) on delete restrict,
  source_table text not null check (source_table in ('fin_sales_lines', 'fin_purchase_in_lines', 'fin_tax_invoice_lines', 'fin_ledger_lines')),
  line_id      bigint not null,
  business_id  text not null references businesses(business_id) on delete restrict,   -- [일반] 읽기 정책용(묶음과 같다)
  released_at  timestamptz,                                                             -- [일반] «다른 거래»로 풀린 뒤(기록은 남긴다)
  primary key (group_id, source_table, line_id)
);
-- 한 줄은 살아 있는(풀리지 않은) 묶음 하나에만.
create unique index fin_tx_group_members_live on fin_tx_group_members (source_table, line_id) where released_at is null;
comment on table fin_tx_group_members is '0072. 같은 거래 묶음의 줄. 한 줄은 살아 있는 묶음 하나에만 든다. 쓰기는 fin_tx_group_*만.';
alter table fin_tx_group_members enable row level security;
revoke all on table fin_tx_group_members from public, anon, authenticated;
grant select on table fin_tx_group_members to authenticated;
create policy fin_tx_group_members_read on fin_tx_group_members for select to authenticated using (can_read_books(business_id));

create table fin_dedupe_settings (
  business_id text primary key references businesses(business_id) on delete restrict,                     -- [일반]
  amount_base text not null default 'ledger' check (amount_base in ('ledger', 'tax_invoice', 'r2_ecount')),  -- [일반] 금액은 무엇을 기준으로
  qty_base    text not null default 'r2_ecount' check (qty_base in ('r2_ecount', 'ledger')),               -- [일반] 수량은 무엇을 기준으로
  updated_by  uuid not null default auth.uid(),
  updated_at  timestamptz not null default now()
);
comment on table fin_dedupe_settings is '0072. 같은 거래의 기준 출처(금액 기본 = 원장 · 수량 기본 = R2/ECOUNT). 줄이 없으면 기본값. 쓰기는 fin_dedupe_setting_save만.';
alter table fin_dedupe_settings enable row level security;
revoke all on table fin_dedupe_settings from public, anon, authenticated;
grant select on table fin_dedupe_settings to authenticated;
create policy fin_dedupe_settings_read on fin_dedupe_settings for select to authenticated using (can_read_books(business_id));

/** 그 줄이 그 회사 · 달의 살아 있는 줄인가. */
create or replace function fin_tx_line_ok(p_table text, p_line bigint, p_business text, p_period text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_ok boolean;
begin
  if p_table not in ('fin_sales_lines', 'fin_purchase_in_lines', 'fin_tax_invoice_lines', 'fin_ledger_lines') then
    return false;
  end if;
  execute format('select exists (select 1 from %I where line_id = $1 and business_id = $2 and period = $3 and voided_at is null)', p_table)
    into v_ok using p_line, p_business, p_period;
  return v_ok;
end;
$fn$;

/**
 * 앱의 맞추기 결과 저장. p_members = [{source_table, line_id}, …] 둘 이상.
 *   same    — 열쇠가 맞은 증거(p_evidence, 빈 객체 아님)가 있어야 한다.
 *   suspect — 그대로 suspect로만 둔다(자동으로 same이 되지 않는다 — 사람이 fin_tx_group_decide로).
 * 줄은 살아 있는 묶음 하나에만(이미 묶인 줄이면 fin_tx_member_taken).
 */
create or replace function fin_tx_group_save(
  p_business text, p_period text, p_status text, p_members jsonb, p_evidence jsonb, p_amount_base_ref text, p_qty_base_ref text,
  p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id uuid;
  m    record;
  v_n  int := 0;
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('same', 'suspect') then
    raise exception 'fin_tx_status' using errcode = '22023';
  end if;
  if p_status = 'same' and (p_evidence is null or jsonb_typeof(p_evidence) <> 'object' or p_evidence = '{}'::jsonb) then
    raise exception 'fin_tx_evidence' using errcode = '22023';
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) < 2 or jsonb_array_length(p_members) > 50 then
    raise exception 'fin_tx_members' using errcode = '22023';
  end if;
  perform fin_closed_gate(p_business, p_period, p_reason);
  perform pg_advisory_xact_lock(hashtext('fin_tx:' || p_business || ':' || coalesce(p_period, '')));
  insert into fin_tx_groups (business_id, period, status, evidence, amount_base_ref, qty_base_ref)
  values (p_business, p_period, p_status, p_evidence, p_amount_base_ref, p_qty_base_ref)
  returning group_id into v_id;
  for m in select x.source_table, x.line_id from jsonb_to_recordset(p_members) as x(source_table text, line_id bigint) loop
    if not fin_tx_line_ok(m.source_table, m.line_id, p_business, p_period) then
      raise exception 'fin_tx_members' using errcode = '22023';
    end if;
    if exists (select 1 from fin_tx_group_members g where g.source_table = m.source_table and g.line_id = m.line_id and g.released_at is null) then
      raise exception 'fin_tx_member_taken' using errcode = '23505';
    end if;
    insert into fin_tx_group_members (group_id, source_table, line_id, business_id) values (v_id, m.source_table, m.line_id, p_business);
    v_n := v_n + 1;
  end loop;
  -- 기준 줄은 이 묶음의 줄이어야 한다.
  if (p_amount_base_ref is not null and not exists (select 1 from fin_tx_group_members g where g.group_id = v_id and g.source_table || ':' || g.line_id = p_amount_base_ref))
     or (p_qty_base_ref is not null and not exists (select 1 from fin_tx_group_members g where g.group_id = v_id and g.source_table || ':' || g.line_id = p_qty_base_ref)) then
    raise exception 'fin_tx_base_ref' using errcode = '22023';
  end if;
  perform fin_reclose_mark(p_business, p_period, null, 'upload', p_reason);
  perform fin_audit('create', 'fin_tx_groups', v_id::text, p_business, null,
    jsonb_build_object('period', p_period, 'status', p_status, 'members', v_n, 'evidence', p_evidence), '같은 거래 묶음 저장(0072)');
  return v_id;
end;
$fn$;

/** 사람의 결정 — same(같은 거래) · rejected(다른 거래 — 줄을 묶음에서 풀고 기록은 남긴다). 이유 필수. */
create or replace function fin_tx_group_decide(p_group uuid, p_status text, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_row fin_tx_groups;
begin
  select * into v_row from fin_tx_groups where group_id = p_group for update;
  if v_row.group_id is null or not coalesce(can_keep_books(v_row.business_id), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('same', 'rejected') then
    raise exception 'fin_tx_status' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 then
    raise exception 'fin_tx_reason' using errcode = '22023';
  end if;
  if v_row.status = 'rejected' or v_row.status = p_status and v_row.decided_by is not null then
    return false;
  end if;
  perform fin_closed_gate(v_row.business_id, v_row.period, p_reason);
  update fin_tx_groups set status = p_status, decided_by = auth.uid(), decided_at = now(), reason = left(btrim(p_reason), 500)
   where group_id = p_group;
  if p_status = 'rejected' then
    update fin_tx_group_members set released_at = now() where group_id = p_group and released_at is null;
  end if;
  perform fin_reclose_mark(v_row.business_id, v_row.period, null, 'upload', p_reason);
  perform fin_audit('update', 'fin_tx_groups', p_group::text, v_row.business_id, jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', p_status, 'reason', p_reason), '같은 거래 결정(0072)');
  return true;
end;
$fn$;

/** 기준 출처 바꾸기 — 이유 필수 · 감사. */
create or replace function fin_dedupe_setting_save(p_business text, p_amount_base text, p_qty_base text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_old fin_dedupe_settings;
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 then
    raise exception 'fin_tx_reason' using errcode = '22023';
  end if;
  select * into v_old from fin_dedupe_settings where business_id = p_business;
  insert into fin_dedupe_settings (business_id, amount_base, qty_base) values (p_business, p_amount_base, p_qty_base)
  on conflict (business_id) do update set amount_base = excluded.amount_base, qty_base = excluded.qty_base,
                                          updated_by = auth.uid(), updated_at = now();
  perform fin_audit('update', 'fin_dedupe_settings', p_business, p_business,
    case when v_old.business_id is null then jsonb_build_object('amount_base', 'ledger', 'qty_base', 'r2_ecount')
         else jsonb_build_object('amount_base', v_old.amount_base, 'qty_base', v_old.qty_base) end,
    jsonb_build_object('amount_base', p_amount_base, 'qty_base', p_qty_base, 'reason', p_reason), '같은 거래 기준 출처 바꾸기(0072)');
end;
$fn$;

-- =====================================================================
-- 6 · 7절. fin_upload_apply 다시 만들기(0070 본문 + 새 종류 · 새 칸 · 다섯째 조건 · 재마감 대상)
-- =====================================================================
drop function fin_upload_apply(text, text, text, text, text, text, text, int, boolean, jsonb, jsonb, text, text, uuid);

/**
 * 넣기. 0070과 같다(아래 «0072»만 더했다).
 * 0072 다섯째 조건: p_dup_suspects = 앱이 이 파일의 줄로 센 «중복 의심» 묶음 수. 자동(p_auto)인데 1 이상이면 fin_upload_auto_blocked.
 *   (넣기 전에는 이 올리기의 줄이 아직 없어 DB가 fin_tx_groups로 셀 수 없다 — 앱이 순수 함수로 센 값을 받는다.
 *    자동인데 이 값을 안 보내면(null) 거부 — 잊은 호출은 닫힌 쪽으로 실패한다. 손으로 넣기(p_auto = false)는 상관없다.
 *    0070 시절 앱의 자동 넣기는 B2가 이 값을 보낼 때까지 미리보기로 돈다.)
 * 0072 재마감 대상: 마감 달에 넣으면(대표 · CFO + 이유) fin_reclose_flags 한 줄. closings · 전표 · finance_kpis는 건드리지 않는다.
 * 0072 새 종류: valuation(평가금액 → fin_inventory_valuations 잠정 · 출처 excel/pdf · 입력자 = 부른 사람; 그 구분의 살아 있는
 *   «확정» 줄이 있으면 fin_valuation_final_exists — 확정은 화면에서 이유와 함께 바꾼다) · material_issue · tax_invoice · ledger_lines.
 * 0072 빈칸 ≠ 0: 재고 기말 · 기초, 세액, 세금계산서 공급가액 · 세액, 원료 kg, 평가금액은 상태 칸(…_state)을 함께 받는다.
 *   상태가 없으면 null → missing · 0이 아닌 수 → value · 0 → 거부(fin_value_state). 단 재고 기말 금액(0070 칸)의 상태 없는 0은 0 확인.
 */
create or replace function fin_upload_apply(
  p_business text, p_kind text, p_period text, p_file_name text, p_sha text, p_sheet text,
  p_confidence text, p_ai_used int, p_auto boolean, p_rows jsonb, p_people jsonb,
  p_overlap text, p_reason text, p_upload uuid, p_dup_suspects int default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id      uuid;
  v_old     uuid[];
  v_closed  boolean;
  v_n       int;
  v_status  text := 'applied';
  v_row     fin_uploads;
begin
  if not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('sales', 'purchase_in', 'inventory', 'production', 'ledger', 'payroll', 'import', 'cashflow', 'card', 'overseas', 'promo', 'loans', 'borrowings', 'savings',
                                      'valuation', 'material_issue', 'tax_invoice', 'ledger_lines') then
    raise exception 'fin_upload_kind' using errcode = '22023';
  end if;
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fin_upload_period' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 20000 then
    raise exception 'fin_upload_rows' using errcode = '22023';
  end if;
  if p_overlap is null or p_overlap not in ('none', 'replace', 'keep_old') then
    raise exception 'fin_upload_overlap_choice' using errcode = '22023';
  end if;
  if coalesce(p_dup_suspects, 0) < 0 then
    raise exception 'fin_upload_dup_count' using errcode = '22023';
  end if;
  -- 같은 회사 · 종류 · 기간의 살아 있는 올리기 — 동시에 두 사람이 넣지 못하게 잠근다.
  perform pg_advisory_xact_lock(hashtext('fin_upload:' || p_business || ':' || p_kind || ':' || p_period));
  -- 리뷰 I-2: 옛 올리기를 잠그고 읽는다(되돌리기와 엇갈리지 않게 — 되돌리기도 같은 자문 잠금을 잡는다).
  select array_agg(x.upload_id) into v_old
    from (select u.upload_id from fin_uploads u
           where u.business_id = p_business and u.kind = p_kind and u.period = p_period and u.status = 'applied'
             and u.upload_id is distinct from p_upload
           for update) x;
  v_closed := fin_month_closed(p_business, p_period);

  -- 0072: 다섯째 조건(중복 의심) — 자동이면 미리보기로 돌린다.
  if coalesce(p_auto, false) and (v_old is not null or v_closed or p_dup_suspects is null or p_dup_suspects > 0) then
    raise exception 'fin_upload_auto_blocked' using errcode = '22023';
  end if;
  if v_closed and not (coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO') and length(btrim(coalesce(p_reason, ''))) >= 2) then
    raise exception 'fin_upload_closed' using errcode = '42501';
  end if;
  if v_old is not null and p_overlap = 'none' then
    raise exception 'fin_upload_overlap' using errcode = '23505';
  end if;
  if v_old is null and p_overlap <> 'none' then
    -- 겹침이 없는데 고른 값이 오면 그냥 넣는다(기록은 none으로).
    p_overlap := 'none';
  end if;
  if p_overlap = 'keep_old' then
    v_status := 'skipped';
  end if;

  if p_upload is not null then
    select * into v_row from fin_uploads where upload_id = p_upload and business_id = p_business for update;
    if v_row.upload_id is null or v_row.status <> 'needs_review' then
      raise exception 'fin_upload_not_pending' using errcode = '22023';
    end if;
    if exists (select 1 from fin_uploads u where u.business_id = p_business and u.kind = p_kind and u.period = p_period
                  and u.file_sha256 = v_row.file_sha256 and u.status in ('needs_review', 'applied') and u.upload_id <> p_upload) then
      raise exception 'fin_upload_duplicate' using errcode = '23505';
    end if;
    -- 0072 리뷰 C1: 원료 출고 kg는 미리보기 읽기(fin_upload_pending)로 나가지 않는다 — 앱이 돌려보내는 줄에는 kg가 없으므로
    -- 저장해 둔 대기 줄(pending.rows)의 kg를 줄 번호로 붙인다. 대기 줄에 그 줄이 없으면 앱이 보낸 값을 쓴다.
    if p_kind = 'material_issue' and jsonb_typeof(v_row.pending -> 'rows') = 'array' then
      select jsonb_agg(case when pr.r is null then r.v
                            else (r.v - 'qty_kg' - 'qty_state') || jsonb_strip_nulls(jsonb_build_object('qty_kg', pr.r -> 'qty_kg', 'qty_state', pr.r -> 'qty_state')) end
                       order by r.o)
        into p_rows
        from jsonb_array_elements(p_rows) with ordinality as r(v, o)
        left join lateral (select e as r from jsonb_array_elements(v_row.pending -> 'rows') e
                            where e ->> 'row_no' = r.v ->> 'row_no' limit 1) pr on true;
    end if;
    update fin_uploads
       set kind = p_kind, period = p_period, sheet_name = coalesce(p_sheet, sheet_name), status = v_status,
           auto = coalesce(p_auto, false), overlap = p_overlap, reason = nullif(btrim(coalesce(p_reason, '')), ''), pending = null,
           row_count = jsonb_array_length(p_rows), applied_at = now(), applied_by = auth.uid()
     where upload_id = p_upload;
    v_id := p_upload;
  else
    if exists (select 1 from fin_uploads u where u.business_id = p_business and u.kind = p_kind and u.period = p_period
                  and u.file_sha256 = p_sha and u.status in ('needs_review', 'applied')) then
      raise exception 'fin_upload_duplicate' using errcode = '23505';
    end if;
    insert into fin_uploads (business_id, kind, period, file_name, file_sha256, sheet_name, ai_confidence, ai_used, auto, status,
                             row_count, overlap, reason, applied_at, applied_by)
    values (p_business, p_kind, p_period, p_file_name, p_sha, p_sheet, coalesce(p_confidence, 'none'), coalesce(p_ai_used, 0),
            coalesce(p_auto, false), v_status, jsonb_array_length(p_rows), p_overlap, nullif(btrim(coalesce(p_reason, '')), ''),
            now(), auth.uid())
    returning upload_id into v_id;
  end if;

  if v_status = 'applied' then
    if p_overlap = 'replace' then
      perform fin_upload_void(v_old);
      update fin_uploads set status = 'replaced', replaced_by = v_id where upload_id = any (v_old) and status = 'applied';
    end if;
  if false then null;
  elsif p_kind = 'sales' then
    insert into fin_sales_lines (upload_id, business_id, period, row_no, customer, product, qty, unit_price, amount,
                                 tx_date, counterparty, source_system, amount_vat, vat_state, item_or_account)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.customer, x.product, x.qty, x.unit_price, x.amount,
           x.tx_date, x.counterparty, x.source_system, x.amount_vat, fin_value_state_of(x.vat_state, x.amount_vat), x.item_or_account
      from jsonb_to_recordset(p_rows) as x(row_no int, customer text, product text, qty numeric, unit_price numeric, amount numeric,
                                            tx_date date, counterparty text, source_system text, amount_vat numeric, vat_state text, item_or_account text);
  elsif p_kind = 'purchase_in' then
    insert into fin_purchase_in_lines (upload_id, business_id, period, row_no, material, supplier, material_kind, qty, amount,
                                       tx_date, counterparty, source_system, amount_vat, vat_state, item_or_account)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.material, x.supplier, x.material_kind, x.qty, x.amount,
           x.tx_date, x.counterparty, x.source_system, x.amount_vat, fin_value_state_of(x.vat_state, x.amount_vat), x.item_or_account
      from jsonb_to_recordset(p_rows) as x(row_no int, material text, supplier text, material_kind text, qty numeric, amount numeric,
                                            tx_date date, counterparty text, source_system text, amount_vat numeric, vat_state text, item_or_account text);
  elsif p_kind = 'inventory' then
    insert into fin_inventory_lines (upload_id, business_id, period, row_no, item, used_qty, stock_qty, amount, amount_state, opening_amount, opening_state)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.item, x.used_qty, x.stock_qty, x.amount, fin_value_state_of(x.amount_state, x.amount, true),
           x.opening_amount, fin_value_state_of(x.opening_state, x.opening_amount)
      from jsonb_to_recordset(p_rows) as x(row_no int, item text, used_qty numeric, stock_qty numeric, amount numeric, amount_state text,
                                            opening_amount numeric, opening_state text);
  elsif p_kind = 'production' then
    insert into fin_production_lines (upload_id, business_id, period, row_no, product, qty)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.product, x.qty
      from jsonb_to_recordset(p_rows) as x(row_no int, product text, qty numeric);
  elsif p_kind = 'ledger' then
    insert into fin_ledger_sums (upload_id, business_id, period, row_no, account_code, account_name, debit, credit)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.account_code, x.account_name, x.debit, x.credit
      from jsonb_to_recordset(p_rows) as x(row_no int, account_code text, account_name text, debit numeric, credit numeric);
  elsif p_kind = 'payroll' then
    insert into fin_payroll_depts (upload_id, business_id, period, row_no, dept, salary, bonus, severance)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.dept, x.salary, x.bonus, x.severance
      from jsonb_to_recordset(p_rows) as x(row_no int, dept text, salary numeric, bonus numeric, severance numeric);
    insert into fin_payroll_people (upload_id, business_id, period, row_no, dept, person_ref, salary, bonus, severance)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.dept, x.person_ref, x.salary, x.bonus, x.severance
      from jsonb_to_recordset(coalesce(p_people, '[]'::jsonb)) as x(row_no int, dept text, person_ref text, salary numeric, bonus numeric, severance numeric);
  elsif p_kind = 'import' then
    insert into fin_import_lines (upload_id, business_id, period, row_no, ref_no, material, supplier, currency, amount, fx_rate, amount_krw, extra_cost)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.ref_no, x.material, x.supplier, x.currency, x.amount, x.fx_rate, x.amount_krw, x.extra_cost
      from jsonb_to_recordset(p_rows) as x(row_no int, ref_no text, material text, supplier text, currency text, amount numeric, fx_rate numeric, amount_krw numeric, extra_cost numeric);
  elsif p_kind = 'cashflow' then
    insert into fin_cash_flows (upload_id, business_id, period, row_no, flow_date, category, inflow, outflow)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.flow_date, x.category, x.inflow, x.outflow
      from jsonb_to_recordset(p_rows) as x(row_no int, flow_date date, category text, inflow numeric, outflow numeric);
  elsif p_kind = 'card' then
    insert into fin_card_lines (upload_id, business_id, period, row_no, used_on, merchant, dept, card_last4, amount)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.used_on, x.merchant, x.dept, x.card_last4, x.amount
      from jsonb_to_recordset(p_rows) as x(row_no int, used_on date, merchant text, dept text, card_last4 text, amount numeric);
  elsif p_kind = 'overseas' then
    insert into fin_overseas_costs (upload_id, business_id, period, row_no, entity, item, currency, amount, fx_rate, amount_krw)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.entity, x.item, x.currency, x.amount, x.fx_rate, x.amount_krw
      from jsonb_to_recordset(p_rows) as x(row_no int, entity text, item text, currency text, amount numeric, fx_rate numeric, amount_krw numeric);
  elsif p_kind = 'promo' then
    insert into fin_promo_costs (upload_id, business_id, period, row_no, person, item, currency, amount)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.person, x.item, x.currency, x.amount
      from jsonb_to_recordset(p_rows) as x(row_no int, person text, item text, currency text, amount numeric);
  elsif p_kind = 'loans' then
    insert into fin_loans (upload_id, business_id, period, row_no, lender, principal, rate, maturity, terms, principal_paid, interest_paid)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.lender, x.principal, x.rate, x.maturity, x.terms, x.principal_paid, x.interest_paid
      from jsonb_to_recordset(p_rows) as x(row_no int, lender text, principal numeric, rate numeric, maturity date, terms text, principal_paid numeric, interest_paid numeric);
  elsif p_kind = 'borrowings' then
    insert into fin_borrowings (upload_id, business_id, period, row_no, tx_date, lender, direction, amount, method)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.tx_date, x.lender, x.direction, x.amount, x.method
      from jsonb_to_recordset(p_rows) as x(row_no int, tx_date date, lender text, direction text, amount numeric, method text);
  elsif p_kind = 'savings' then
    insert into fin_savings_lines (upload_id, business_id, period, row_no, item, labor_cost, target, actual)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.item, x.labor_cost, x.target, x.actual
      from jsonb_to_recordset(p_rows) as x(row_no int, item text, labor_cost numeric, target numeric, actual numeric);
  elsif p_kind = 'valuation' then
    -- 0072: 그 구분의 살아 있는 확정 줄이 있으면 멈춘다. 확정 아닌 줄은 무효 + 새 줄(잠정).
    if exists (select 1 from fin_inventory_valuations v
                where v.business_id = p_business and v.period = p_period and v.voided_at is null and v.status = 'final'
                  and v.category in (select x.category from jsonb_to_recordset(p_rows) as x(category text))) then
      raise exception 'fin_valuation_final_exists' using errcode = '23505';
    end if;
    update fin_inventory_valuations v set voided_at = now(), void_reason = '새 올리기로 바뀜'
     where v.business_id = p_business and v.period = p_period and v.voided_at is null
       and v.category in (select x.category from jsonb_to_recordset(p_rows) as x(category text));
    insert into fin_inventory_valuations (business_id, period, category, amount, value_state, valuation_date, method, cost_scope, source,
                                          source_upload_id, source_ref, note, status)
    select p_business, p_period, x.category, x.amount, fin_value_state_of(x.value_state, x.amount), x.valuation_date,
           nullif(btrim(coalesce(x.method, '')), ''), x.cost_scope,
           case when lower(coalesce(p_file_name, v_row.file_name, '')) like '%.pdf' then 'pdf' else 'excel' end,
           v_id, coalesce(x.source_ref, '줄 ' || coalesce(x.row_no, 0)), nullif(btrim(coalesce(x.note, '')), ''), 'provisional'
      from jsonb_to_recordset(p_rows) as x(row_no int, category text, amount numeric, value_state text, valuation_date date, method text,
                                            cost_scope text, source_ref text, note text);
  elsif p_kind = 'material_issue' then
    -- 0072: 앱이 구분을 안 보내면 «확인 필요» — 생산 투입이 기본값이 아니다.
    insert into fin_material_issues (upload_id, business_id, period, row_no, issued_on, material, qty_kg, qty_state, issue_type, memo, warehouse,
                                     class, non_production_kind, class_source, class_reason)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.issued_on, x.material, x.qty_kg, fin_value_state_of(x.qty_state, x.qty_kg),
           x.issue_type, x.memo, x.warehouse,
           coalesce(x.class, 'needs_review'),
           case when coalesce(x.class, 'needs_review') = 'needs_review' then null else x.non_production_kind end,
           case when coalesce(x.class, 'needs_review') = 'needs_review' then 'none' else 'rule' end,
           case when coalesce(x.class, 'needs_review') = 'needs_review' then null else left(x.class_reason, 200) end
      from jsonb_to_recordset(p_rows) as x(row_no int, issued_on date, material text, qty_kg numeric, qty_state text, issue_type text, memo text,
                                            warehouse text, class text, non_production_kind text, class_reason text);
  elsif p_kind = 'tax_invoice' then
    insert into fin_tax_invoice_lines (upload_id, business_id, period, row_no, issued_on, counterparty, item, supply_amount, supply_state,
                                       vat, vat_state, total, direction)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.issued_on, x.counterparty, x.item, x.supply_amount,
           fin_value_state_of(x.supply_state, x.supply_amount), x.vat, fin_value_state_of(x.vat_state, x.vat), x.total, x.direction
      from jsonb_to_recordset(p_rows) as x(row_no int, issued_on date, counterparty text, item text, supply_amount numeric, supply_state text,
                                            vat numeric, vat_state text, total numeric, direction text);
  elsif p_kind = 'ledger_lines' then
    insert into fin_ledger_lines (upload_id, business_id, period, row_no, tx_date, account_code, account_name, counterparty, memo, debit, credit)
    select v_id, p_business, p_period, coalesce(x.row_no, 0), x.tx_date, x.account_code, x.account_name, x.counterparty, x.memo, x.debit, x.credit
      from jsonb_to_recordset(p_rows) as x(row_no int, tx_date date, account_code text, account_name text, counterparty text, memo text,
                                            debit numeric, credit numeric);
  else
    raise exception 'fin_upload_kind' using errcode = '22023';
  end if;
    get diagnostics v_n = row_count;
    -- 0072: 마감 달에 넣었으면 «재마감 대상». 손익(closings · 전표 · finance_kpis)은 건드리지 않는다.
    if v_closed then
      perform fin_reclose_mark(p_business, p_period, v_id, 'upload', p_reason);
    end if;
  end if;

  perform fin_upload_audit('create', v_id, p_business, null,
    jsonb_build_object('kind', p_kind, 'period', p_period, 'rows', jsonb_array_length(p_rows), 'auto', coalesce(p_auto, false),
                       'overlap', p_overlap, 'replaced', to_jsonb(v_old), 'closed_month', v_closed, 'status', v_status,
                       'dup_suspects', coalesce(p_dup_suspects, 0)),
    case when coalesce(p_auto, false) then '회계 · 재무 자료 자동 넣기(0070)' else '회계 · 재무 자료 넣기(0070)' end);

  if coalesce(p_auto, false) then
    insert into notifications (user_id, kind, title, body, link)
    values (auth.uid(), 'system', '자료를 자동으로 넣었습니다', p_kind || ' · ' || p_period || ' · ' || jsonb_array_length(p_rows) || '줄 — 7일 안에 되돌릴 수 있습니다.',
            '/finance/' || p_business || '/upload');
  end if;
  return v_id;
end;
$fn$;

/** 그 올리기들의 줄 전부 무효(voided_at). 지우지 않는다. 0072: 새 표 넷도. 이 파일의 RPC만 부른다. */
create or replace function fin_upload_void(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if p_ids is null then
    return;
  end if;
  update fin_sales_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_purchase_in_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_inventory_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_production_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_ledger_sums set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_payroll_depts set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_import_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_cash_flows set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_card_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_overseas_costs set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_promo_costs set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_loans set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_borrowings set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_savings_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_payroll_people set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_material_issues set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_tax_invoice_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_ledger_lines set voided_at = now() where upload_id = any (p_ids) and voided_at is null;
  update fin_inventory_valuations set voided_at = now(), void_reason = '올리기 되돌림 · 바뀜'
   where source_upload_id = any (p_ids) and voided_at is null and status <> 'final';
end;
$fn$;

/**
 * 그 올리기들의 줄을 되살린다(바꾸기를 되돌릴 때 옛 줄). 0072: 새 표 넷도.
 * 평가금액은 같은 회사 · 달 · 구분에 살아 있는 줄이 없을 때만(한 줄 원칙), 올리기가 무효로 만든 줄만.
 */
create or replace function fin_upload_unvoid(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if p_ids is null then
    return;
  end if;
  update fin_sales_lines set voided_at = null where upload_id = any (p_ids);
  update fin_purchase_in_lines set voided_at = null where upload_id = any (p_ids);
  update fin_inventory_lines set voided_at = null where upload_id = any (p_ids);
  update fin_production_lines set voided_at = null where upload_id = any (p_ids);
  update fin_ledger_sums set voided_at = null where upload_id = any (p_ids);
  update fin_payroll_depts set voided_at = null where upload_id = any (p_ids);
  update fin_import_lines set voided_at = null where upload_id = any (p_ids);
  update fin_cash_flows set voided_at = null where upload_id = any (p_ids);
  update fin_card_lines set voided_at = null where upload_id = any (p_ids);
  update fin_overseas_costs set voided_at = null where upload_id = any (p_ids);
  update fin_promo_costs set voided_at = null where upload_id = any (p_ids);
  update fin_loans set voided_at = null where upload_id = any (p_ids);
  update fin_borrowings set voided_at = null where upload_id = any (p_ids);
  update fin_savings_lines set voided_at = null where upload_id = any (p_ids);
  update fin_payroll_people set voided_at = null where upload_id = any (p_ids);
  update fin_material_issues set voided_at = null where upload_id = any (p_ids);
  update fin_tax_invoice_lines set voided_at = null where upload_id = any (p_ids);
  update fin_ledger_lines set voided_at = null where upload_id = any (p_ids);
  update fin_inventory_valuations v set voided_at = null, void_reason = null
   where v.source_upload_id = any (p_ids) and v.void_reason = '올리기 되돌림 · 바뀜'
     and not exists (select 1 from fin_inventory_valuations o where o.business_id = v.business_id and o.period = v.period
                        and o.category = v.category and o.voided_at is null);
end;
$fn$;

/**
 * 미리보기 대기 줄 읽기 — 0070과 같다. 0072 리뷰 C1: 원료 출고(material_issue)는 누구에게도 kg를 싣지 않는다
 * (줄의 qty_kg · qty_state를 빼고 칸 격자(grid)는 통째로 뺀다 — 대표 · CFO도. 표의 kg 칸 grant가 없는 것과 같은 선).
 * 넣을 때 kg는 fin_upload_apply가 DB에 둔 대기 줄에서 붙인다.
 */
create or replace function fin_upload_pending(p_upload uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_row fin_uploads;
begin
  select * into v_row from fin_uploads where upload_id = p_upload;
  if v_row.upload_id is null or not coalesce(can_keep_books(v_row.business_id), false) or v_row.status <> 'needs_review' then
    return null;
  end if;
  if v_row.kind = 'material_issue' then
    return (v_row.pending - 'people' - 'grid')
           || jsonb_build_object('rows', coalesce((select jsonb_agg(e - 'qty_kg' - 'qty_state')
                                                     from jsonb_array_elements(case when jsonb_typeof(v_row.pending -> 'rows') = 'array'
                                                                                    then v_row.pending -> 'rows' else '[]'::jsonb end) e), '[]'::jsonb));
  end if;
  if coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO') then
    return v_row.pending;
  end if;
  -- 급여는 칸 격자(grid)에도 사람별 줄이 있다 — 대표 · CFO 밖에는 둘 다 뺀다.
  return case when v_row.kind = 'payroll' then v_row.pending - 'people' - 'grid' else v_row.pending - 'people' end;
end;
$fn$;

/**
 * 되돌리기 — 0070과 같다. 0072: 마감 달이면 «재마감 대상»(까닭 revert) 한 줄.
 */
create or replace function fin_upload_revert(p_upload uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_row  fin_uploads;
  v_prev uuid[];
begin
  select * into v_row from fin_uploads where upload_id = p_upload for update;
  if v_row.upload_id is null or not coalesce(can_keep_books(v_row.business_id), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if v_row.status <> 'applied' then
    return false;
  end if;
  if v_row.applied_at < now() - interval '7 days' then
    raise exception 'fin_upload_revert_expired' using errcode = '22023';
  end if;
  if fin_month_closed(v_row.business_id, v_row.period) and coalesce(auth_role()::text, '') not in ('Chairman', 'GroupCFO') then
    raise exception 'fin_upload_closed' using errcode = '42501';
  end if;
  -- 리뷰 I-2: 넣기와 같은 자문 잠금.
  perform pg_advisory_xact_lock(hashtext('fin_upload:' || v_row.business_id || ':' || v_row.kind || ':' || v_row.period));
  perform fin_upload_void(array[p_upload]);
  select array_agg(u.upload_id) into v_prev from fin_uploads u where u.replaced_by = p_upload and u.status = 'replaced';
  if v_prev is not null then
    perform fin_upload_unvoid(v_prev);
    update fin_uploads set status = 'applied', replaced_by = null where upload_id = any (v_prev);
  end if;
  update fin_uploads set status = 'reverted', reverted_at = now(), reverted_by = auth.uid(),
         reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), reason)
   where upload_id = p_upload;
  perform fin_reclose_mark(v_row.business_id, v_row.period, p_upload, 'revert', p_reason);
  perform fin_upload_audit('update', p_upload, v_row.business_id, jsonb_build_object('status', 'applied'),
    jsonb_build_object('status', 'reverted', 'reason', p_reason, 'restored', to_jsonb(v_prev)), '회계 · 재무 자료 되돌리기(0070)');
  return true;
end;
$fn$;

-- =====================================================================
-- 8절. 시드 정리 A안 — «예시» 표시 · 직원 세션에서 숨김(지우지 않는다 · 상태를 바꾸지 않는다)
--   id 목록은 docs/onboarding/seed-check.sql과 같다(0003이 넣은 줄만). 결정은 dec_001~004 중 기안자가 빈 줄(시드)만 —
--   앱이 만든 결재(dec_017 …)는 모양이 같아도 건드리지 않는다. finance_kpis · businesses는 예시가 아니라 원천이다.
--   표시하는 동안 그 표의 사용자 트리거(updated_at · 결재선 등)를 끈다 — 표시 칸 하나 때문에 «사람이 손댄 시드»로 보이지 않게(0049와 같은 방식).
--   되돌리기 = is_example = false.
-- =====================================================================
alter table tasks              add column is_example boolean not null default false;
alter table projects           add column is_example boolean not null default false;
alter table decisions          add column is_example boolean not null default false;
alter table alerts             add column is_example boolean not null default false;
alter table goals              add column is_example boolean not null default false;
alter table milestones         add column is_example boolean not null default false;
alter table monthly_priorities add column is_example boolean not null default false;
alter table critical_risks     add column is_example boolean not null default false;
alter table ai_night_outputs   add column is_example boolean not null default false;

alter table tasks disable trigger user;
alter table projects disable trigger user;
alter table decisions disable trigger user;
alter table alerts disable trigger user;
alter table goals disable trigger user;
alter table milestones disable trigger user;
alter table monthly_priorities disable trigger user;
alter table critical_risks disable trigger user;
alter table ai_night_outputs disable trigger user;

update tasks set is_example = true where task_id in ('tsk_001', 'tsk_002', 'tsk_003', 'tsk_004', 'tsk_005');
update projects set is_example = true where project_id in ('prj_001', 'prj_002', 'prj_003', 'prj_004', 'prj_005', 'prj_006', 'prj_007', 'prj_008');
update decisions set is_example = true where decision_id in ('dec_001', 'dec_002', 'dec_003', 'dec_004') and created_by is null;
update alerts set is_example = true where alert_id in ('alt_001', 'alt_002', 'alt_003', 'alt_004');
update goals set is_example = true where goal_id in ('goal_group_2026', 'goal_dy_2026', 'goal_vana_2026');
update milestones set is_example = true where milestone_id in ('ms_001', 'ms_002', 'ms_003', 'ms_004', 'ms_005', 'ms_006');
update monthly_priorities set is_example = true where priority_id in ('prio_2026_09', 'prio_2026_09_dy');
update critical_risks set is_example = true where risk_id in ('risk_001', 'risk_002', 'risk_003');
update ai_night_outputs set is_example = true where output_id in ('ain_001', 'ain_002', 'ain_003', 'ain_004', 'ain_005');

alter table tasks enable trigger user;
alter table projects enable trigger user;
alter table decisions enable trigger user;
alter table alerts enable trigger user;
alter table goals enable trigger user;
alter table milestones enable trigger user;
alter table monthly_priorities enable trigger user;
alter table critical_risks enable trigger user;
alter table ai_night_outputs enable trigger user;

insert into audit_log (action, entity_table, entity_id, actor_user_id, actor_role, after, note)
select 'update', 'seed_examples', '0072', null, null,
       jsonb_build_object(
         'tasks', (select coalesce(jsonb_agg(task_id order by task_id), '[]') from tasks where is_example),
         'projects', (select coalesce(jsonb_agg(project_id order by project_id), '[]') from projects where is_example),
         'decisions', (select coalesce(jsonb_agg(decision_id order by decision_id), '[]') from decisions where is_example),
         'alerts', (select coalesce(jsonb_agg(alert_id order by alert_id), '[]') from alerts where is_example),
         'goals', (select coalesce(jsonb_agg(goal_id order by goal_id), '[]') from goals where is_example),
         'milestones', (select coalesce(jsonb_agg(milestone_id order by milestone_id), '[]') from milestones where is_example),
         'monthly_priorities', (select coalesce(jsonb_agg(priority_id order by priority_id), '[]') from monthly_priorities where is_example),
         'critical_risks', (select coalesce(jsonb_agg(risk_id order by risk_id), '[]') from critical_risks where is_example),
         'ai_night_outputs', (select coalesce(jsonb_agg(output_id order by output_id), '[]') from ai_night_outputs where is_example)),
       '시드 정리 A안 — 0003 예시 줄에 «예시» 표시(지우지 않음 · 직원 세션에서 숨김)(0072)';

-- 직원 세션에서 숨김: restrictive — 다른 읽기 정책을 통과해도 예시 줄은 대표 세션에서만 보인다.
-- 정의자 함수 · 뷰: FORCE가 걸린 표(tasks 등)는 소유자도 이 정책을 받는다 — 판정은 부른 사람(auth_role())이라 대표 경로는 그대로 보인다.
-- anon은 대상이 아니다(to authenticated) — anon은 이 표들에 읽기 정책이 없어 처음부터 0행이다.
create policy tasks_not_example on tasks as restrictive for select to authenticated
  using (not is_example or coalesce(auth_role()::text, '') = 'Chairman');
create policy projects_not_example on projects as restrictive for select to authenticated
  using (not is_example or coalesce(auth_role()::text, '') = 'Chairman');
create policy decisions_not_example on decisions as restrictive for select to authenticated
  using (not is_example or coalesce(auth_role()::text, '') = 'Chairman');
create policy alerts_not_example on alerts as restrictive for select to authenticated
  using (not is_example or coalesce(auth_role()::text, '') = 'Chairman');
create policy goals_not_example on goals as restrictive for select to authenticated
  using (not is_example or coalesce(auth_role()::text, '') = 'Chairman');
create policy milestones_not_example on milestones as restrictive for select to authenticated
  using (not is_example or coalesce(auth_role()::text, '') = 'Chairman');
create policy monthly_priorities_not_example on monthly_priorities as restrictive for select to authenticated
  using (not is_example or coalesce(auth_role()::text, '') = 'Chairman');
create policy critical_risks_not_example on critical_risks as restrictive for select to authenticated
  using (not is_example or coalesce(auth_role()::text, '') = 'Chairman');
create policy ai_night_outputs_not_example on ai_night_outputs as restrictive for select to authenticated
  using (not is_example or coalesce(auth_role()::text, '') = 'Chairman');

-- 0072 리뷰: staging · 운영의 postgres는 BYPASSRLS라 정의자 함수는 위 restrictive를 타지 않는다. 시드 표 아홉을 읽고
-- 대표 아닌 세션이 부를 수 있는 정의자 함수 중 **예시 내용을 돌려주는 것** 둘을 같은 거름으로 다시 만든다(본문은 원본 그대로 + 거름 한 줄).
--   company_progress(0028)        — 직원 회사 카드의 진행률 평균(예시 프로젝트가 섞였다).
--   founder_dependency_rows(0034) — 회사 대표에게도 열리는 의존도 집계(예시 결정이 섞였다).
-- 나머지(결재 · 견적 · 시트 동기화 · 트리거 · project_business_id 열쇠)는 앱이 만든 줄의 id로만 움직이거나 내용을 돌려주지 않는다 — DEFERRED.md.
create or replace function company_progress(p_business_id text) returns int
language sql stable security definer set search_path = public as $fn$
  select case when has_business(p_business_id) then (
    select round(avg(progress_pct))::int from projects where business_id = p_business_id
       and (not is_example or coalesce(auth_role()::text, '') = 'Chairman')
  ) end;
$fn$;
revoke all on function company_progress(text) from public, anon;
grant execute on function company_progress(text) to authenticated;

create or replace function founder_dependency_rows()
returns table (
  business_id     text,
  period          text,
  chairman_count  bigint,
  ceo_count       bigint,
  rule_count      bigint,
  total_count     bigint,
  unknown_count   bigint,
  dependency_pct  numeric
)
language sql stable security definer set search_path = public as $fn$
  select
    d.business_id,
    to_char(
      coalesce(d.decided_at, d.created_at) at time zone 'Asia/Seoul', 'YYYY-MM'
    ),
    count(*) filter (where d.decided_by_kind = 'chairman'),
    count(*) filter (where d.decided_by_kind = 'ceo'),
    count(*) filter (where d.decided_by_kind = 'rule'),
    count(*) filter (where d.decided_by_kind is not null),
    count(*) filter (where d.decided_by_kind is null),
    case
      when count(*) filter (where d.decided_by_kind is not null) = 0 then null
      else round(
        count(*) filter (where d.decided_by_kind = 'chairman')::numeric * 100
        / count(*) filter (where d.decided_by_kind is not null), 1)
    end
  from decisions d
 where d.status <> 'Open'
   and can_read_succession(d.business_id)
   and (not d.is_example or coalesce(auth_role()::text, '') = 'Chairman')
 group by 1, 2;
$fn$;
revoke all on function founder_dependency_rows() from public, anon;
grant execute on function founder_dependency_rows() to authenticated;

-- =====================================================================
-- 9절. 함수 권한 — public · anon에게서 이름으로 걷는다. 부르는 RPC만 authenticated.
-- =====================================================================
revoke all on function fin_value_state_ok(text, numeric) from public, anon, authenticated;
revoke all on function fin_value_state_of(text, numeric, boolean) from public, anon, authenticated;
revoke all on function fin_audit(audit_action, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function fin_prev_period(text) from public, anon, authenticated;
revoke all on function fin_reclose_mark(text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function fin_closed_gate(text, text, text) from public, anon, authenticated;
revoke all on function fin_tx_line_ok(text, bigint, text, text) from public, anon, authenticated;
revoke all on function fin_upload_void(uuid[]) from public, anon, authenticated;
revoke all on function fin_upload_unvoid(uuid[]) from public, anon, authenticated;

revoke all on function fin_reclose_clear(uuid, text) from public, anon;
revoke all on function fin_valuation_save(text, text, text, numeric, text, date, text, text, text, uuid, text, text, text, text) from public, anon;
revoke all on function fin_valuation_confirm(uuid, text) from public, anon;
revoke all on function fin_valuation_void(uuid, text) from public, anon;
revoke all on function fin_valuation_warnings(text, text) from public, anon;
revoke all on function fin_opening_save(text, text, text, numeric, text, text, uuid, text) from public, anon;
revoke all on function fin_inventory_roll(text, text) from public, anon;
revoke all on function fin_issue_bulk_decide(text, text, text, text, text, text) from public, anon;
revoke all on function fin_issue_summary(text, text) from public, anon;
revoke all on function fin_tx_group_save(text, text, text, jsonb, jsonb, text, text, text) from public, anon;
revoke all on function fin_tx_group_decide(uuid, text, text) from public, anon;
revoke all on function fin_dedupe_setting_save(text, text, text, text) from public, anon;
revoke all on function fin_upload_apply(text, text, text, text, text, text, text, int, boolean, jsonb, jsonb, text, text, uuid, int) from public, anon;
revoke all on function fin_upload_revert(uuid, text) from public, anon;
revoke all on function fin_upload_pending(uuid) from public, anon;

grant execute on function fin_reclose_clear(uuid, text) to authenticated;
grant execute on function fin_valuation_save(text, text, text, numeric, text, date, text, text, text, uuid, text, text, text, text) to authenticated;
grant execute on function fin_valuation_confirm(uuid, text) to authenticated;
grant execute on function fin_valuation_void(uuid, text) to authenticated;
grant execute on function fin_valuation_warnings(text, text) to authenticated;
grant execute on function fin_opening_save(text, text, text, numeric, text, text, uuid, text) to authenticated;
grant execute on function fin_inventory_roll(text, text) to authenticated;
grant execute on function fin_issue_bulk_decide(text, text, text, text, text, text) to authenticated;
grant execute on function fin_issue_summary(text, text) to authenticated;
grant execute on function fin_tx_group_save(text, text, text, jsonb, jsonb, text, text, text) to authenticated;
grant execute on function fin_tx_group_decide(uuid, text, text) to authenticated;
grant execute on function fin_dedupe_setting_save(text, text, text, text) to authenticated;
grant execute on function fin_upload_apply(text, text, text, text, text, text, text, int, boolean, jsonb, jsonb, text, text, uuid, int) to authenticated;
grant execute on function fin_upload_revert(uuid, text) to authenticated;
grant execute on function fin_upload_pending(uuid) to authenticated;

commit;
