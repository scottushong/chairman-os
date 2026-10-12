-- =====================================================================
-- Chairman OS — 0075_monthly_pl (PHASE 3 «월별 손익 — 재고 반영 매출원가 · 손익과 현금 분리 · 마감»)
-- 작성: 2026-10-12 · 원문 docs/specs/2026-10-12-monthly-pl-D.txt · 결정 docs/decisions/2026-10-12-autonomous.md
--
-- ■ 왜 ■ 지금 장부 손익은 A 방식이다 — 장부 매입 전표가 4510 원재료비(매출원가 구역)로 바로 들어가 많이 산 달이 나빠진다.
--   이 파일은 장부를 고치지 않는다. 0072 재료(평가금액 · 0과 미입력 · 기초재고 · 출고 구분 · 같은 거래 묶음)를 읽어
--   «재고 반영 월별 손익»을 따로 계산하고 마감본을 남긴다. 장부의 원재료비(대분류 raw_material)는 새 매출원가로 **교체**되고
--   (더하지 않는다), 기존 장부 영업이익은 검산 칸에만 쓴다(«기존 + 기말 재고 − 기초 재고» — 일괄 보정 아님).
--
-- ■ 계산 ■ fin_pl_compute(jsonb) — src/lib/monthly-pl/calc.ts와 같은 식(scripts/check-monthly-pl.ts가 PGlite에서 대조):
--   ① 원료 사용액 = 기초 원료 + 순매입 − 기말 원료 · 제조로 간 원료비 = ① − 비생산 출고 − 승인된 조정
--   ② 제조비용 = 제조로 간 원료비 + 제조 인건비 + 제조경비 · ③ = 기초 재공품 + ② − 기말 재공품
--   ④ 매출원가 = 기초 완제품 + ③ − 기말 완제품 · ⑤ = 매출 − ④ · ⑥ = ⑤ − 판관비 − 재고 변동(비생산 · 조정, 별도 줄)
--   원료별 월 가중평균 = (기초 금액 + 순매입 금액) ÷ (기초 kg + 순매입 kg) — 원료끼리 섞지 않는다 · 수량 ≤ 0이면 단가 없음.
--   투입 기준(확인된 투입 kg × 단가)과 재고 증감 기준의 차이 = 대사 차이 — 보여 주기만(허용오차 기본 1,000원 · 설정).
--   평가방법은 «관리용 잠정 기준(원료별 월 가중평균)» — 세무사 확인 전. fin_pl_settings 한 줄로 바꾼다.
--
-- ■ 읽는 곳(만들지 않는다) ■ fin_purchase_in_lines(입고 · 같은 거래 묶음 same은 한 번만 · suspect는 막음) · fin_inventory_lines
--   (이 달 · 앞 달 명세서 — 수량 · 금액) · fin_material_issues(생산 투입 · 비생산 · 확인 필요 — kg는 이 정의자 함수 안에서만) ·
--   fin_inventory_valuations · fin_inventory_openings(0072 재공품 · 완제품 · 첫 달 기초) · finance_ledger_cells(장부 손익) ·
--   fin_sales_lines(설정이 판매현황일 때만) · fin_cash_flows(자금흐름표 — 원료대금 실제 지급) · fin_tx_groups(0072).
--   Current · Market · Forecast(원가 엔진)는 입력이 아니다 — 마감 뒤 바뀌어도 확정 손익은 그대로다(저장본).
--
-- ■ 더하는 것 ■
--   표: fin_pl_settings(회사마다 설정) · fin_pl_adjustments(보정값 · 사유 — 원본을 고치지 않는다) · fin_pl_closes(잠정 · 내부 마감 확정 저장본).
--   함수(내부 — authenticated 없음): fin_pl_n · fin_pl_norm · fin_pl_mat_msg · fin_pl_compute · fin_pl_mask · fin_pl_gather · fin_pl_closes_frozen.
--   RPC(authenticated): fin_pl_month(읽기) · fin_pl_year · fin_pl_setting · fin_pl_record(잠정 저장 · 내부 마감) · fin_pl_reopen ·
--   fin_pl_adjust_propose · fin_pl_adjust_decide · fin_pl_setting_save.
--   0072 fin_reclose_flags 까닭에 'pl_reopen'(앞 달을 다시 열었다 → 이후 확정 달은 재마감 대상 — 자동으로 덮어쓰지 않는다).
--
-- ■ 판정 ■ 모든 RPC는 첫 줄에서 feature_on('monthly_pl', 회사)(0073 · 기본 대표만). 읽기 = can_read_books · 잠정 저장 · 조정 제안 =
--   can_keep_books · 내부 마감 · 조정 승인 = can_close_books(조정 승인은 제안한 사람이 아닌 사람) · 다시 열기 · 설정 = 대표 · 그룹 CFO + 이유.
--   원료별 줄(이름 · kg · 단가)은 대표 · 원가 관리('/costing/<회사>', cost_can)만 — 나머지는 회사 합계(fin_pl_mask: 원료 3가지 미만 ·
--   출고 구분 남음이면 투입원가 합계 · 대사 차이 금액도 감춘다 — 0072 fin_issue_summary와 같은 문). 감사에는 합계 · 상태만(원료별 없음).
-- 0035 규칙: force를 새로 걸지 않는다 · FORCE를 내리지 않는다 · 0001~0074를 고치지 않는다. 새 정책 · grant는 늘 to authenticated.
-- =====================================================================

begin;

-- =====================================================================
-- 0절. 재마감 대상 까닭 하나 더(0072 표 · 제약만 — 0072 파일은 고치지 않는다)
-- =====================================================================
alter table fin_reclose_flags drop constraint fin_reclose_flags_cause_check;
alter table fin_reclose_flags add constraint fin_reclose_flags_cause_check
  check (cause in ('upload', 'revert', 'valuation', 'opening', 'pl_reopen'));

-- =====================================================================
-- 1절. 표
-- =====================================================================
create table fin_pl_settings (
  business_id        text primary key references businesses(business_id) on delete restrict,          -- [일반]
  method             text not null default 'monthly_wa' check (method in ('monthly_wa', 'statement')),  -- [일반]
  method_confirmed   boolean not null default false,                                                   -- [일반] 세무사 확인
  tolerance_krw      numeric(20,0) not null default 1000 check (tolerance_krw between 0 and 1000000), -- [일반] 대사 허용오차(원 · 100만 원까지)
  revenue_source     text not null default 'books' check (revenue_source in ('books', 'sales_upload')),  -- [일반]
  payment_categories text[] not null default array['원재료', '원료', '원자재']
                     check (cardinality(payment_categories) between 1 and 20),                         -- [일반] 자금흐름표 «항목» 규칙
  updated_by         uuid,                                                                             -- [제한]
  updated_at         timestamptz not null default now()
);
comment on table fin_pl_settings is
  '0075. 월별 손익 설정(회사마다 한 줄 — 없으면 기본값). 평가방법은 세무사 확인 전 «관리용 잠정 기준(원료별 월 가중평균)». 쓰기는 fin_pl_setting_save만.';
alter table fin_pl_settings enable row level security;
revoke all on table fin_pl_settings from public, anon, authenticated;
grant select on table fin_pl_settings to authenticated;
create policy fin_pl_settings_read on fin_pl_settings for select to authenticated using (can_read_books(business_id));

create table fin_pl_adjustments (
  adj_id      uuid primary key default gen_random_uuid(),
  business_id text not null references businesses(business_id) on delete restrict,                     -- [일반]
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),                               -- [일반]
  kind        text not null check (kind in ('shrinkage', 'scrap', 'other')),                            -- [일반] 감모 · 폐기 · 기타(평가손실은 승인 절차가 정해진 뒤)
  amount      numeric(20,0) not null check (amount <> 0),                                                -- [일반] 원(양수 = 손실). 회사 합계 한 값
  reason      text not null check (length(btrim(reason)) between 2 and 500),                           -- [일반]
  status      text not null default 'proposed' check (status in ('proposed', 'approved', 'voided')),    -- [일반]
  proposed_by uuid not null default auth.uid(),                                                         -- [제한]
  proposed_at timestamptz not null default now(),
  approved_by uuid,                                                                                      -- [제한]
  approved_at timestamptz,
  voided_by   uuid,
  voided_at   timestamptz,
  void_reason text check (void_reason is null or length(void_reason) <= 500),
  constraint fin_pl_adjustments_approved check ((approved_by is null) = (approved_at is null) and (approved_by is null or approved_by <> proposed_by)
                                                 and (status <> 'approved' or approved_by is not null)),
  constraint fin_pl_adjustments_void check ((status = 'voided') = (voided_at is not null) and (voided_at is null) = (void_reason is null))
);
create index fin_pl_adjustments_by_period on fin_pl_adjustments (business_id, period);
comment on table fin_pl_adjustments is
  '0075. 월별 손익 재고 조정(보정값 · 사유). 원천 자료는 고치지 않는다 — 원료 사용액에서 이 금액을 «재고 변동» 줄로 옮길 뿐(두 번 세지 않는다). 승인은 제안한 사람이 아닌 마감 권한자.';
alter table fin_pl_adjustments enable row level security;
revoke all on table fin_pl_adjustments from public, anon, authenticated;
grant select on table fin_pl_adjustments to authenticated;
create policy fin_pl_adjustments_read on fin_pl_adjustments for select to authenticated using (can_read_books(business_id));

create table fin_pl_closes (
  close_id      uuid primary key default gen_random_uuid(),
  business_id   text not null references businesses(business_id) on delete restrict,                   -- [일반]
  period        text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),                             -- [일반]
  status        text not null check (status in ('provisional', 'final')),                                -- [일반] 잠정 · 내부 마감 확정
  calc_version  text not null check (length(calc_version) between 1 and 40),                             -- [일반]
  method        text not null check (method in ('monthly_wa', 'statement')),                             -- [일반]
  tolerance_krw numeric(20,0) not null,                                                                  -- [일반]
  input_hash    text not null check (input_hash ~ '^[0-9a-f]{32}$'),                                     -- [일반] 같은 입력 = 같은 해시
  totals        jsonb not null check (jsonb_typeof(totals) = 'object'),                                  -- [제한] 회사 합계 결과(원료별 없음)
  detail        jsonb not null check (jsonb_typeof(detail) = 'object'),                                  -- [제한] 입력 원본 · 원료별 결과 — grant 없음
  recorded_by   uuid not null default auth.uid(),                                                        -- [제한]
  recorded_at   timestamptz not null default now(),
  closed_by     uuid,                                                                                    -- [제한]
  closed_at     timestamptz,
  reopened_by   uuid,
  reopened_at   timestamptz,
  reopen_reason text check (reopen_reason is null or length(reopen_reason) <= 500),
  superseded_at timestamptz,                                                                             -- [일반] 새 저장 · 다시 열기(지우지 않는다)
  superseded_by uuid,
  constraint fin_pl_closes_final check ((status = 'final') = (closed_by is not null and closed_at is not null)),
  constraint fin_pl_closes_reopen check (reopened_at is null or (status = 'final' and superseded_at is not null and reopen_reason is not null))
);
create unique index fin_pl_closes_live on fin_pl_closes (business_id, period) where superseded_at is null;
create index fin_pl_closes_by_period on fin_pl_closes (business_id, period, recorded_at desc);
comment on table fin_pl_closes is
  '0075. 월별 손익 저장본 — 잠정 · 내부 마감 확정. 회사 · 달마다 살아 있는 줄 하나. 같은 입력이면 새 줄을 만들지 않는다. 확정 줄은 다시 열기(대표 · CFO)로만 내려간다 — 이후 확정 달은 덮어쓰지 않고 재마감 대상. 합계 · 원본 칸은 grant 없음(fin_pl_month가 권한별로 보여 준다).';
alter table fin_pl_closes enable row level security;
revoke all on table fin_pl_closes from public, anon, authenticated;
grant select (close_id, business_id, period, status, calc_version, method, tolerance_krw, input_hash, recorded_at, closed_at, reopened_at, superseded_at)
  on table fin_pl_closes to authenticated;
create policy fin_pl_closes_read on fin_pl_closes for select to authenticated using (can_read_books(business_id));

/** 저장본 얼림 — 내려가는 칸(superseded · reopened)만 한 번. 지우기 없음. 정의자 경로도 이 트리거를 지난다. */
create or replace function fin_pl_closes_frozen() returns trigger
language plpgsql set search_path = public, pg_temp as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'fin_pl_frozen' using errcode = '42501';
  end if;
  if old.superseded_at is not null
     or (to_jsonb(new) - 'superseded_at' - 'superseded_by' - 'reopened_at' - 'reopened_by' - 'reopen_reason')
        is distinct from (to_jsonb(old) - 'superseded_at' - 'superseded_by' - 'reopened_at' - 'reopened_by' - 'reopen_reason') then
    raise exception 'fin_pl_frozen' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
create trigger fin_pl_closes_frozen before update or delete on fin_pl_closes for each row execute function fin_pl_closes_frozen();

-- =====================================================================
-- 2절. 순수 계산(내부) — src/lib/monthly-pl/calc.ts와 같은 식 · 같은 문장
-- =====================================================================

/** jsonb 칸의 수 — 수가 아니면(null · 없음) null. */
create or replace function fin_pl_n(p jsonb, k text) returns numeric
language sql immutable set search_path = public, pg_temp as $fn$
  select case when jsonb_typeof(p -> k) = 'number' then (p ->> k)::numeric end;
$fn$;

/** 원료 이름 맞추기 — 앞뒤 공백 · 겹친 공백만(calc.ts normalizeMaterial). */
create or replace function fin_pl_norm(p text) returns text
language sql immutable set search_path = public, pg_temp as $fn$
  select btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
$fn$;

create or replace function fin_pl_mat_msg(p_code text) returns text
language sql immutable set search_path = public, pg_temp as $fn$
  select case p_code
    when 'opening_missing' then '원료 기초(수량 · 금액)가 없음 — 앞 달 재고금액명세서를 올리거나 앞 달을 마감하세요(0으로 채우지 않음)'
    when 'closing_missing' then '이 달 재고금액명세서의 기말 수량이 없음'
    when 'qty_nonpositive' then '기초 + 매입 수량이 0 이하 — 평균단가를 만들 수 없음(최신 구매가로 대신하지 않음)'
    when 'amount_negative' then '기초 + 매입 금액이 음수 — 자료 확인 필요'
    when 'negative_stock' then '기말 수량이 음수 — 자료 확인 필요(고치지 않음)'
    when 'over_issue' then '출고(생산 투입 + 비생산)가 기초 + 매입보다 많음 — 음수 재고(고치지 않음)'
    when 'return_kind' then '반품 출고 — 매입 환출 처리 기준 확인 필요'
    when 'needs_review' then '원료 출고 구분 «확인 필요» 줄이 남음'
    when 'missing_qty' then '원료 출고 kg 빈칸 줄이 있음'
    when 'purchase_missing' then '입고 줄에 수량 또는 금액 빈칸이 있음 — 0으로 채우지 않음'
    when 'transfer_kind' then '이동 출고 — 처리 기준 필요(회사 안 창고 이동인지 정하기 전에는 마감하지 않음)'
    else p_code
  end;
$fn$;

/**
 * 한 달 계산(입력 jsonb → 결과 jsonb). 입력을 고치지 않는다 — 모자란 것은 null · blockers로만 말한다.
 * 반올림: 원료별 금액 = round(수량 × 금액합 ÷ 수량합)(0.5는 0에서 먼 쪽) · kg는 소수 4자리 · 감모 원가는 남은 값.
 */
create or replace function fin_pl_compute(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $fn$
declare
  v_method text := coalesce(p ->> 'method', 'monthly_wa');
  v_conf   boolean := coalesce((p ->> 'method_confirmed')::boolean, false);
  v_tol    numeric := coalesce(fin_pl_n(p, 'tolerance_krw'), 1000);
  v_issues boolean := coalesce((p ->> 'issues_uploaded')::boolean, false);
  v_label  text;
  b jsonb := '[]'::jsonb;   -- blockers
  w jsonb := '[]'::jsonb;   -- warnings
  v_mats jsonb := '[]'::jsonb;
  m jsonb;
  e text[];
  c text;
  np numeric; oq numeric; oa numeric; pq numeric; pa numeric; prq numeric; cq numeric; csa numeric;
  denq numeric; dena numeric; v_idle boolean; v_ok boolean;
  prc numeric; npc numeric; expd numeric; ca numeric; shq numeric; shc numeric;
  t_open numeric := 0; t_purch numeric := 0; t_close numeric := 0; t_prod numeric := 0; t_np numeric := 0; v_count int := 0;
  any_open_absent boolean := false;
  raw_usage numeric; production_input numeric; non_production numeric;
  adj_ok numeric; adj_kind jsonb; v_split boolean; raw_to_prod numeric; inv_other numeric; recon_diff numeric; recon_ok boolean;
  s jsonb; k text; ko text;
  v_rev numeric := fin_pl_n(p, 'revenue');
  v_lab numeric := fin_pl_n(p, 'mfg_labor');
  v_ovh numeric := fin_pl_n(p, 'mfg_overhead');
  v_sga numeric := fin_pl_n(p, 'sga');
  v_braw numeric := fin_pl_n(p, 'books_raw_material');
  v_merch numeric := fin_pl_n(p, 'books_merchandise_cogs');
  v_bop numeric := fin_pl_n(p, 'books_operating_income');
  wo numeric := fin_pl_n(p -> 'wip', 'opening_amount');
  wc numeric := fin_pl_n(p -> 'wip', 'closing_amount');
  fo numeric := fin_pl_n(p -> 'finished', 'opening_amount');
  fc numeric := fin_pl_n(p -> 'finished', 'closing_amount');
  mfg_cost numeric; cogm numeric; cogs numeric; gross numeric; op numeric;
  inv_open numeric; inv_close numeric; chk numeric;
  v_cash boolean := coalesce((p -> 'cash' ->> 'uploaded')::boolean, false);
  v_ps int := coalesce(fin_pl_n(p, 'purchase_suspects'), 0)::int;
  v_pd int := coalesce(fin_pl_n(p, 'purchase_dupes_excluded'), 0)::int;
  v_scope text;
begin
  -- ── 원료(이름 순 — calc.ts와 같은 순서) ──
  for m in select x from jsonb_array_elements(coalesce(p -> 'materials', '[]'::jsonb)) x order by x ->> 'name' collate "C" loop
    e := array[]::text[];
    np := coalesce(fin_pl_n(m -> 'non_production', 'sample'), 0) + coalesce(fin_pl_n(m -> 'non_production', 'scrap'), 0)
        + coalesce(fin_pl_n(m -> 'non_production', 'return'), 0) + coalesce(fin_pl_n(m -> 'non_production', 'adjust'), 0);
    oq := fin_pl_n(m, 'opening_qty'); oa := fin_pl_n(m, 'opening_amount');
    pq := coalesce(fin_pl_n(m, 'purchase_qty'), 0); pa := coalesce(fin_pl_n(m, 'purchase_amount'), 0);
    prq := fin_pl_n(m, 'production_qty'); cq := fin_pl_n(m, 'closing_qty'); csa := fin_pl_n(m, 'closing_statement_amount');
    if coalesce(fin_pl_n(m -> 'non_production', 'return'), 0) > 0 then e := array_append(e, 'return_kind'); end if;
    if coalesce(fin_pl_n(m, 'issue_needs_review'), 0) > 0 then e := array_append(e, 'needs_review'); end if;
    if coalesce(fin_pl_n(m, 'issue_missing_qty'), 0) > 0 then e := array_append(e, 'missing_qty'); end if;
    if coalesce(fin_pl_n(m, 'purchase_missing'), 0) > 0 then e := array_append(e, 'purchase_missing'); end if;
    if coalesce(fin_pl_n(m, 'issue_transfer'), 0) > 0 then e := array_append(e, 'transfer_kind'); end if;
    if oq is null or oa is null then e := array_append(e, 'opening_missing'); end if;
    if cq is null then e := array_append(e, 'closing_missing');
    elsif cq < 0 then e := array_append(e, 'negative_stock');
    elsif v_method = 'statement' and csa is null then e := array_append(e, 'closing_missing');
    end if;
    denq := case when oq is not null and oa is not null then oq + pq end;
    dena := case when oq is not null and oa is not null then oa + pa end;
    v_idle := coalesce(denq = 0 and dena = 0 and coalesce(prq, 0) = 0 and np = 0 and coalesce(cq, 0) = 0, false);
    v_ok := false;
    if denq is not null and dena is not null and not v_idle then
      if denq <= 0 then e := array_append(e, 'qty_nonpositive');
      elsif dena < 0 then e := array_append(e, 'amount_negative');
      else v_ok := true;
      end if;
    end if;
    prc := case when v_idle then 0 when v_ok and prq is not null then round(prq * dena / denq) end;
    npc := case when v_idle then 0 when v_ok and prq is not null then round(np * dena / denq) end;
    expd := case when denq is not null and prq is not null then round(denq - prq - np, 4) end;
    if expd is not null and expd < 0 then e := array_append(e, 'over_issue'); end if;
    ca := case when v_idle then 0
               when v_method = 'statement' then csa
               when v_ok and cq is not null and cq >= 0 then round(cq * dena / denq) end;
    shq := case when expd is not null and cq is not null then round(expd - cq, 4) end;
    shc := case when shq is not null then dena - ca - prc - npc end;

    foreach c in array e loop
      b := b || jsonb_build_array(jsonb_build_object('code', 'material_' || c, 'message', fin_pl_mat_msg(c), 'target', m ->> 'name'));
    end loop;
    if m ->> 'opening_source' = 'statement_absent' then any_open_absent := true; end if;

    v_mats := v_mats || jsonb_build_array(jsonb_build_object(
      'name', m ->> 'name', 'opening_qty', oq, 'opening_amount', oa, 'opening_source', m ->> 'opening_source',
      'purchase_qty', pq, 'purchase_amount', pa,
      'wa_unit_cost', case when v_ok then round(dena / denq, 4) end,
      'production_qty', prq, 'production_cost', prc, 'non_production_qty', np, 'non_production_cost', npc,
      'expected_closing_qty', expd, 'closing_qty', cq, 'closing_amount', ca, 'closing_statement_amount', csa,
      'shrinkage_qty', shq, 'shrinkage_cost', shc, 'errors', to_jsonb(e)));
    t_open := t_open + oa;
    t_purch := t_purch + pa;
    t_close := t_close + ca;
    t_prod := t_prod + prc;
    t_np := t_np + npc;
    if pa <> 0 or coalesce(oa, 0) <> 0 or coalesce(prq, 0) <> 0 or coalesce(cq, 0) <> 0 then v_count := v_count + 1; end if;
  end loop;

  raw_usage := t_open + t_purch - t_close;
  production_input := case when v_issues then t_prod end;
  non_production := case when v_issues then t_np end;

  -- ── 조정 ──
  select coalesce(sum(fin_pl_n(a, 'amount')), 0) into adj_ok
    from jsonb_array_elements(coalesce(p -> 'adjustments', '[]'::jsonb)) a where a ->> 'status' = 'approved';
  select coalesce(jsonb_object_agg(q.kind, q.total), '{}'::jsonb) into adj_kind
    from (select a ->> 'kind' as kind, sum(fin_pl_n(a, 'amount')) as total
            from jsonb_array_elements(coalesce(p -> 'adjustments', '[]'::jsonb)) a where a ->> 'status' = 'approved' group by a ->> 'kind') q;
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'adjustments', '[]'::jsonb)) a where a ->> 'status' = 'proposed') then
    b := b || jsonb_build_array(jsonb_build_object('code', 'adjustments_unapproved', 'message', '승인 전 재고 조정이 있음 — 다른 마감 권한자가 승인하거나 무효로 하세요'));
  end if;

  v_split := non_production is not null;
  raw_to_prod := raw_usage - coalesce(non_production, 0) - adj_ok;
  inv_other := coalesce(non_production, 0) + adj_ok;
  recon_diff := case when production_input is null or raw_to_prod is null or not v_split then null else raw_to_prod - production_input end;
  recon_ok := case when recon_diff is null then null else abs(recon_diff) <= v_tol end;

  if not v_issues then
    b := b || jsonb_build_array(jsonb_build_object('code', 'issues_not_uploaded', 'message', '이 달 원료 출고명세가 없음 — 생산 투입 · 비생산 출고를 모름'));
  end if;
  if not coalesce((p ->> 'statement_uploaded')::boolean, false) then
    b := b || jsonb_build_array(jsonb_build_object('code', 'statement_not_uploaded', 'message', '이 달 재고금액명세서가 없음 — 기말 원료 재고를 모름'));
  end if;
  if raw_usage is not null and not v_split then
    w := w || jsonb_build_array(jsonb_build_object('code', 'production_split_pending', 'message', '출고 구분 전 — 원료 사용액 전체를 제조로 넣은 잠정값'));
  end if;
  if recon_ok is false then
    b := b || jsonb_build_array(jsonb_build_object('code', 'recon_over_tolerance', 'message',
      '투입 기준과 재고 증감 기준의 대사 차이가 허용오차(' || to_char(v_tol, 'FM999,999,999,999,990') || '원)를 넘음 — 원인 확인 · 승인된 조정이 필요(자동으로 맞추지 않음)'));
  end if;
  if recon_diff is null and v_issues and raw_usage is not null then
    b := b || jsonb_build_array(jsonb_build_object('code', 'recon_unavailable', 'message', '투입 기준 원가를 계산할 수 없어 대사를 못 함'));
  end if;
  if v_ps > 0 then
    b := b || jsonb_build_array(jsonb_build_object('code', 'purchase_suspects', 'message',
      '입고 «중복 의심» 묶음 ' || v_ps || '개 — 같은 거래인지 정하세요(자동으로 같은 거래로 보지 않음)'));
  end if;
  if v_pd > 0 then
    w := w || jsonb_build_array(jsonb_build_object('code', 'purchase_dupes_excluded', 'message', '같은 거래 묶음으로 입고 줄 ' || v_pd || '개를 한 번만 셈'));
  end if;

  -- ── 재공품 · 완제품 ──
  foreach k in array array['wip', 'finished'] loop
    s := p -> k;
    ko := case k when 'wip' then '재공품' else '완제품' end;
    if fin_pl_n(s, 'opening_amount') is null then
      b := b || jsonb_build_array(jsonb_build_object('code', k || '_opening_missing', 'message', ko || ' 기초가 미연결 — 앞 달 확정 기말 또는 첫 달 직접 입력이 필요(0으로 채우지 않음)'));
    end if;
    if fin_pl_n(s, 'closing_amount') is null then
      b := b || jsonb_build_array(jsonb_build_object('code', k || '_closing_missing', 'message', ko || ' 월말 평가금액이 미입력(0으로 채우지 않음)'));
    elsif coalesce(s ->> 'closing_status', '') <> 'final' then
      b := b || jsonb_build_array(jsonb_build_object('code', k || '_closing_not_final', 'message', ko || ' 월말 평가금액이 확정 전 — 입력한 사람이 아닌 장부 담당이 확정'));
    end if;
    if s ->> 'opening_scope' is not null and s ->> 'closing_scope' is not null and s ->> 'opening_scope' <> s ->> 'closing_scope' then
      b := b || jsonb_build_array(jsonb_build_object('code', k || '_scope_mismatch', 'message', ko || ' 기초 · 기말 포함 원가 범위가 다름'));
    elsif fin_pl_n(s, 'opening_amount') is not null and fin_pl_n(s, 'closing_amount') is not null and (s ->> 'opening_scope' is null or s ->> 'closing_scope' is null) then
      w := w || jsonb_build_array(jsonb_build_object('code', k || '_scope_unknown', 'message', ko || ' 기초 또는 기말의 포함 원가 범위를 모름 — 같은 범위인지 확인'));
    end if;
  end loop;
  if coalesce((p -> 'wip' ->> 'duplicate_suspect')::boolean, false) or coalesce((p -> 'finished' ->> 'duplicate_suspect')::boolean, false) then
    b := b || jsonb_build_array(jsonb_build_object('code', 'valuation_duplicate', 'message', '재공품 · 완제품 중복 의심(같은 금액 · 같은 출처)'));
  end if;

  if v_rev is null then
    b := b || jsonb_build_array(jsonb_build_object('code', 'revenue_missing', 'message',
      case when coalesce(p ->> 'revenue_source', 'books') = 'books' then '매출 미입력 — 장부에 이 달 매출 전표가 없음' else '매출 미입력 — 이 달 판매현황이 없음' end));
  end if;
  if not coalesce((p ->> 'books_has_lines')::boolean, false) then
    b := b || jsonb_build_array(jsonb_build_object('code', 'books_missing', 'message', '장부에 이 달 손익 전표가 없음 — 제조 인건비 · 제조경비 · 판관비 미입력'));
  end if;
  if not coalesce((p -> 'link' ->> 'prev_final')::boolean, false) and coalesce((p -> 'link' ->> 'earlier_final')::boolean, false) then
    b := b || jsonb_build_array(jsonb_build_object('code', 'prev_not_closed', 'message', '앞 달이 내부 마감 전 — 앞 달부터 마감하세요(기초 = 전월 확정 기말)'));
  end if;

  mfg_cost := raw_to_prod + v_lab + v_ovh;
  cogm := wo + mfg_cost - wc;
  cogs := fo + cogm - fc + v_merch;   -- 4610 상품매출원가는 교체하지 않고 더한다(입고명세서에 없는 상품)
  gross := v_rev - cogs;
  op := gross - v_sga - inv_other;

  -- ── 경고(막지 않음) ──
  v_label := case when v_method = 'statement' then
                    case when v_conf then '재고금액명세서 금액 그대로(공식 장부 방법)' else '재고금액명세서 금액 그대로(세무사 확인 전 — 관리용 잠정)' end
                  else case when v_conf then '원료별 월 가중평균(세무사 확인)' else '관리용 잠정 기준(원료별 월 가중평균)' end end;
  if not v_conf then
    w := w || jsonb_build_array(jsonb_build_object('code', 'method_provisional', 'message',
      '평가방법: ' || case when v_method = 'statement' then '재고금액명세서 금액 그대로(세무사 확인 전 — 관리용 잠정)' else '관리용 잠정 기준(원료별 월 가중평균)' end
      || ' — 세무사 확인 뒤 설정에서 바꿀 수 있음'));
  end if;
  if inv_other <> 0 then
    w := w || jsonb_build_array(jsonb_build_object('code', 'inventory_other_policy', 'message', '재고 변동(비생산 출고 · 승인된 조정)을 별도 줄로 둠 — 매출원가 · 판관비 · 영업외 중 처리 기준 확인 전'));
  end if;
  if v_braw is not null and abs(v_braw - t_purch) > v_tol then
    w := w || jsonb_build_array(jsonb_build_object('code', 'purchase_vs_books_diff', 'message', '장부 원재료비(교체됨 — 4610 상품매출원가 제외)와 입고명세서 순매입이 다름 — 부가세 · 선급금 · 외상 · 시점 차이 확인'));
  end if;
  if fin_pl_n(p, 'raw_statement_opening') is not null and t_open is not null and abs(fin_pl_n(p, 'raw_statement_opening') - t_open) > v_tol then
    w := w || jsonb_build_array(jsonb_build_object('code', 'statement_opening_diff', 'message', '이 달 재고금액명세서의 기초와 연결한 기초(전월 기말)가 다름 — 고치지 않고 보여 주기만'));
  end if;
  if fin_pl_n(p, 'raw_opening_manual') is not null and t_open is null then
    w := w || jsonb_build_array(jsonb_build_object('code', 'raw_opening_manual_only', 'message', '첫 달 원재료 기초 합만 있고 원료별 수량이 없음 — 평균단가를 내려면 앞 달 재고금액명세서가 필요'));
  end if;
  if any_open_absent then
    w := w || jsonb_build_array(jsonb_build_object('code', 'opening_absent', 'message', '앞 달 명세서에 없는 원료는 기초 0으로 봄 — 확인'));
  end if;
  -- PHASE 11(0076 리뷰 Minor): 첫 달 기초(0072 fin_inventory_openings)가 0076 확인 전이면 경고(막지는 않음).
  if coalesce((p ->> 'openings_unconfirmed')::int, 0) > 0 then
    w := w || jsonb_build_array(jsonb_build_object('code', 'opening_unconfirmed', 'message', '이 달 기초(직접 입력) 중 아직 확인 전인 줄이 있음 — 확정 전에 재고 · 평가 화면에서 확인'));
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'materials', '[]'::jsonb)) x where coalesce((x ->> 'closing_absent')::boolean, false)) then
    w := w || jsonb_build_array(jsonb_build_object('code', 'closing_absent', 'message', '이 달 명세서에 없는 원료는 기말 0으로 봄 — 확인'));
  end if;
  if not v_cash then
    w := w || jsonb_build_array(jsonb_build_object('code', 'cash_not_uploaded', 'message', '자금흐름표 미입력 · 연결 필요 — 원료대금 실제 지급액을 모름(손익으로 추정하지 않음)'));
  end if;
  w := w || jsonb_build_array(
    jsonb_build_object('code', 'product_margin_unavailable', 'message', '제품별 실제 마진: 계산 불가 — 원료 LOT ↔ 제품 LOT 연결 근거가 없음(kg 비율 배분을 실제 원가로 쓰지 않음)'),
    jsonb_build_object('code', 'sales_cost_provisional', 'message', '판매 실적의 실제 원가(LOT가 없으면 출고일 Current)는 조회할 때 계산하는 잠정 대체원가 — 이 월 마감 매출원가와 섞지 않음'));

  inv_open := t_open + wo + fo;
  inv_close := t_close + wc + fc;
  chk := v_bop + inv_close - inv_open;
  v_scope := case when op is not null then 'full' when raw_usage is not null then 'raw_usage_only' else 'none' end;

  return jsonb_build_object(
    'calc_version', 'pl-2026-10-12.2',
    'period', p ->> 'period',
    'method', v_method,
    'method_label', v_label,
    'status', case when op is not null then 'provisional' else 'entering' end,
    'closable', op is not null and jsonb_array_length(b) = 0,
    'scope', v_scope,
    'scope_label', case v_scope when 'full' then '영업이익까지 계산' when 'raw_usage_only' then '원료 사용액(재고 증감 기준)까지만 계산 — 나머지는 자료가 필요'
                                else '계산할 수 있는 범위 없음' end,
    'pl', jsonb_build_object('revenue', v_rev, 'cogs', cogs, 'gross_profit', gross, 'sga', v_sga, 'inventory_other', inv_other, 'operating_income', op),
    'basis', jsonb_build_object(
      'raw_opening', t_open, 'raw_purchases', t_purch, 'raw_closing', t_close, 'raw_usage', raw_usage,
      'production_input', production_input, 'non_production', non_production,
      'adjustments_approved', adj_ok, 'adjustments_by_kind', adj_kind,
      'raw_to_production', raw_to_prod, 'recon_diff', recon_diff, 'recon_ok', recon_ok,
      'mfg_labor', v_lab, 'mfg_overhead', v_ovh, 'mfg_cost', mfg_cost,
      'wip_opening', wo, 'wip_closing', wc, 'cogm', cogm, 'finished_opening', fo, 'finished_closing', fc, 'merchandise_cogs', v_merch),
    'cash', jsonb_build_object(
      'state', case when v_cash then 'value' else 'not_uploaded' end,
      'material_payments', case when v_cash then fin_pl_n(p -> 'cash', 'material_payments') end,
      'inflow', case when v_cash then fin_pl_n(p -> 'cash', 'inflow') end,
      'outflow', case when v_cash then fin_pl_n(p -> 'cash', 'outflow') end,
      'net', case when v_cash then fin_pl_n(p -> 'cash', 'inflow') - fin_pl_n(p -> 'cash', 'outflow') end),
    'check', jsonb_build_object(
      'books_operating_income', v_bop, 'inventory_opening_total', inv_open, 'inventory_closing_total', inv_close,
      'check_value', chk, 'diff_vs_new', chk - op, 'books_raw_material', v_braw,
      'purchase_vs_books_diff', v_braw - t_purch),
    'blockers', b,
    'warnings', w,
    'materials', v_mats,
    'material_count', v_count);
end;
$fn$;

/**
 * 대표 · 원가 권한 밖에 보이는 모양(calc.ts maskPlResult와 같다): 원료별 줄 없음 · 원료 이름이 붙은 까닭은 «원료 n가지»로 ·
 * 원료 3가지 미만이거나 출고 구분 «확인 필요»가 남았으면 생산 투입원가 · 대사 차이 금액을 감춘다.
 */
create or replace function fin_pl_mask(r jsonb, p_cost boolean) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $fn$
declare
  v_hide boolean;
  v_b jsonb;
  v_w jsonb;
begin
  if p_cost then
    return r;
  end if;
  v_hide := coalesce((r ->> 'material_count')::int, 0) < 3
            or exists (select 1 from jsonb_array_elements(r -> 'blockers') x where x ->> 'code' = 'material_needs_review');
  select coalesce(jsonb_agg(z.v order by z.o), '[]'::jsonb) into v_b from (
    select x.v, x.o from jsonb_array_elements(r -> 'blockers') with ordinality x(v, o) where not (x.v ? 'target')
    union all
    select jsonb_build_object('code', y.code, 'message', fin_pl_mat_msg(regexp_replace(y.code, '^material_', '')) || ' (원료 ' || y.n || '가지)'), 100000 + y.first
      from (select x.v ->> 'code' as code, count(*) as n, min(x.o) as first
              from jsonb_array_elements(r -> 'blockers') with ordinality x(v, o) where x.v ? 'target' group by x.v ->> 'code') y
  ) z;
  select coalesce(jsonb_agg(x.v order by x.o), '[]'::jsonb) into v_w
    from jsonb_array_elements(r -> 'warnings') with ordinality x(v, o) where not (x.v ? 'target');
  return r || jsonb_build_object(
    'materials', '[]'::jsonb,
    'blockers', v_b,
    'warnings', v_w,
    'basis', case when v_hide then (r -> 'basis') || jsonb_build_object('production_input', null, 'recon_diff', null) else r -> 'basis' end,
    'withheld', case when v_hide then '["production_input", "recon_diff"]'::jsonb else '[]'::jsonb end);
end;
$fn$;

-- =====================================================================
-- 3절. 모으기(내부 · 정의자) — 원천 표를 읽어 fin_pl_compute 입력을 만든다. 원천은 고치지 않는다.
-- =====================================================================
create or replace function fin_pl_gather(p_business text, p_period text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_prev   text := fin_prev_period(p_period);
  v_set    fin_pl_settings;
  v_method text; v_conf boolean; v_tol numeric; v_rsrc text; v_cats text[];
  v_pc     fin_pl_closes;        -- 앞 달 살아 있는 확정
  v_earlier boolean;
  v_excl   bigint[] := array[]::bigint[];
  v_sexcl  bigint[] := array[]::bigint[];
  v_susp   int := 0;
  g record;
  v_keep   bigint;
  v_prev_stmt int; v_cur_stmt int;
  v_issues boolean;
  v_mats   jsonb;
  v_books  record;
  v_has    boolean;
  v_rev    numeric;
  v_cash   record;
  v_adj    jsonb;
  st       jsonb := '{}'::jsonb;
  c        text;
  v_oa numeric; v_os text; v_osc text; v_ca numeric; v_cst text; v_csc text;
  v_dup    boolean;
  v_rawman numeric;
  v_stmt_open numeric;
begin
  select * into v_set from fin_pl_settings where business_id = p_business;
  v_method := coalesce(v_set.method, 'monthly_wa');
  v_conf := coalesce(v_set.method_confirmed, false);
  v_tol := coalesce(v_set.tolerance_krw, 1000);
  v_rsrc := coalesce(v_set.revenue_source, 'books');
  v_cats := coalesce(v_set.payment_categories, array['원재료', '원료', '원자재']);

  select * into v_pc from fin_pl_closes where business_id = p_business and period = v_prev and status = 'final' and superseded_at is null;
  v_earlier := exists (select 1 from fin_pl_closes where business_id = p_business and period < v_prev and status = 'final' and superseded_at is null);

  -- 같은 거래 묶음 — 입고 줄 둘 이상이 든 묶음만(원장 · 세금계산서는 매입 원천이 아니다).
  for g in
    select t.status, t.amount_base_ref, array_agg(mm.line_id order by mm.line_id) as ids
      from fin_tx_groups t
      join fin_tx_group_members mm on mm.group_id = t.group_id and mm.released_at is null and mm.source_table = 'fin_purchase_in_lines'
      join fin_purchase_in_lines l on l.line_id = mm.line_id and l.business_id = p_business and l.period = p_period and l.voided_at is null
     where t.business_id = p_business
     group by t.group_id, t.status, t.amount_base_ref
    having count(*) >= 2
  loop
    if g.status = 'suspect' then
      v_susp := v_susp + 1;
    elsif g.status = 'same' then
      v_keep := case when g.amount_base_ref ~ '^fin_purchase_in_lines:[0-9]{1,18}$'
                      and substr(g.amount_base_ref, 23)::bigint = any(g.ids) then substr(g.amount_base_ref, 23)::bigint else g.ids[1] end;
      v_excl := v_excl || array_remove(g.ids, v_keep);
    end if;
  end loop;
  -- 판매(설정이 판매현황일 때) — 같은 규칙.
  for g in
    select t.status, t.amount_base_ref, array_agg(mm.line_id order by mm.line_id) as ids
      from fin_tx_groups t
      join fin_tx_group_members mm on mm.group_id = t.group_id and mm.released_at is null and mm.source_table = 'fin_sales_lines'
      join fin_sales_lines l on l.line_id = mm.line_id and l.business_id = p_business and l.period = p_period and l.voided_at is null
     where t.business_id = p_business and t.status = 'same'
     group by t.group_id, t.status, t.amount_base_ref
    having count(*) >= 2
  loop
    v_keep := case when g.amount_base_ref ~ '^fin_sales_lines:[0-9]{1,18}$' and substr(g.amount_base_ref, 17)::bigint = any(g.ids)
                   then substr(g.amount_base_ref, 17)::bigint else g.ids[1] end;
    v_sexcl := v_sexcl || array_remove(g.ids, v_keep);
  end loop;

  select count(*) into v_prev_stmt from fin_inventory_lines where business_id = p_business and period = v_prev and voided_at is null;
  select count(*) into v_cur_stmt from fin_inventory_lines where business_id = p_business and period = p_period and voided_at is null;
  v_issues := exists (select 1 from fin_material_issues where business_id = p_business and period = p_period and voided_at is null);
  select sum(opening_amount) filter (where opening_state <> 'missing') into v_stmt_open
    from fin_inventory_lines where business_id = p_business and period = p_period and voided_at is null;

  with
  pur as (
    select fin_pl_norm(material) as m, sum(qty) filter (where qty is not null and amount is not null) as q,
           sum(amount) filter (where qty is not null and amount is not null) as a,
           count(*) filter (where qty is null or amount is null) as miss
      from fin_purchase_in_lines
     where business_id = p_business and period = p_period and voided_at is null and not (line_id = any(v_excl))
     group by 1),
  cur as (
    select fin_pl_norm(item) as m,
           case when bool_and(stock_qty is not null) then sum(stock_qty) end as q,
           case when bool_and(amount_state <> 'missing') then sum(amount) end as a
      from fin_inventory_lines where business_id = p_business and period = p_period and voided_at is null group by 1),
  prv as (
    select fin_pl_norm(item) as m,
           case when bool_and(stock_qty is not null) then sum(stock_qty) end as q,
           case when bool_and(amount_state <> 'missing') then sum(amount) end as a
      from fin_inventory_lines where business_id = p_business and period = v_prev and voided_at is null group by 1),
  pcl as (
    select x ->> 'name' as m, fin_pl_n(x, 'closing_qty') as q, fin_pl_n(x, 'closing_amount') as a
      from jsonb_array_elements(case when v_pc.close_id is null then '[]'::jsonb else coalesce(v_pc.detail -> 'materials', '[]'::jsonb) end) x),
  iss as (
    select fin_pl_norm(material) as m,
           coalesce(sum(qty_kg) filter (where class = 'production' and qty_state <> 'missing'), 0) as prod,
           sum(qty_kg) filter (where class = 'non_production' and non_production_kind = 'sample' and qty_state <> 'missing') as np_sample,
           sum(qty_kg) filter (where class = 'non_production' and non_production_kind = 'scrap' and qty_state <> 'missing') as np_scrap,
           sum(qty_kg) filter (where class = 'non_production' and non_production_kind = 'return' and qty_state <> 'missing') as np_return,
           sum(qty_kg) filter (where class = 'non_production' and coalesce(non_production_kind, 'adjust') = 'adjust' and qty_state <> 'missing') as np_adjust,
           count(*) filter (where class = 'needs_review') as review,
           count(*) filter (where class <> 'needs_review' and qty_state = 'missing') as miss,
           count(*) filter (where class = 'non_production' and non_production_kind = 'transfer') as transfer
      from fin_material_issues where business_id = p_business and period = p_period and voided_at is null group by 1),
  names as (
    select m from pur union select m from cur union select m from iss
    union select m from prv where v_pc.close_id is null
    union select m from pcl)
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'name', n.m,
           'opening_qty', case when v_pc.close_id is not null then coalesce(pcl.q, 0) when v_prev_stmt > 0 then case when prv.m is null then 0 else prv.q end end,
           'opening_amount', case when v_pc.close_id is not null then coalesce(pcl.a, 0) when v_prev_stmt > 0 then case when prv.m is null then 0 else prv.a end end,
           'purchase_qty', coalesce(pur.q, 0), 'purchase_amount', coalesce(pur.a, 0), 'purchase_missing', coalesce(pur.miss, 0),
           'production_qty', case when v_issues then coalesce(iss.prod, 0) end,
           'non_production', jsonb_strip_nulls(jsonb_build_object('sample', iss.np_sample, 'scrap', iss.np_scrap, 'return', iss.np_return, 'adjust', iss.np_adjust)),
           'issue_needs_review', coalesce(iss.review, 0), 'issue_missing_qty', coalesce(iss.miss, 0), 'issue_transfer', coalesce(iss.transfer, 0),
           'closing_qty', case when v_cur_stmt > 0 then case when cur.m is null then 0 else cur.q end end,
           'closing_statement_amount', case when v_cur_stmt > 0 then case when cur.m is null then 0 else cur.a end end,
           'closing_absent', case when v_cur_stmt > 0 and cur.m is null then true end))
         || jsonb_build_object('opening_source', case when v_pc.close_id is not null then case when pcl.m is null then 'statement_absent' else 'prev_close' end
                                                      when v_prev_stmt > 0 then case when prv.m is null then 'statement_absent' else 'statement' end
                                                      else 'missing' end)
         order by n.m), '[]'::jsonb)
    into v_mats
    from names n
    left join pur on pur.m = n.m left join cur on cur.m = n.m left join prv on prv.m = n.m
    left join pcl on pcl.m = n.m left join iss on iss.m = n.m
   where n.m <> '';

  -- 재공품 · 완제품
  foreach c in array array['wip', 'finished'] loop
    v_oa := null; v_os := 'unlinked'; v_osc := null; v_ca := null; v_cst := null; v_csc := null;
    if v_pc.close_id is not null then
      v_oa := fin_pl_n(v_pc.totals -> 'basis', c || '_closing'); v_os := 'prev_pl_close';
      v_osc := v_pc.detail -> 'input' -> c ->> 'closing_scope';
    else
      select v.amount, v.cost_scope into v_oa, v_osc from fin_inventory_valuations v
       where v.business_id = p_business and v.period = v_prev and v.category = c and v.voided_at is null and v.status = 'final' and v.value_state <> 'missing';
      if found then
        v_os := 'prev_final_valuation';
      else
        select o.amount, o.source into v_oa, v_os from fin_inventory_openings o
         where o.business_id = p_business and o.period = p_period and o.category = c and o.voided_at is null and o.value_state <> 'missing';
        if not found then v_oa := null; v_os := 'unlinked'; end if;
        v_osc := null;
      end if;
    end if;
    select case when v.value_state = 'missing' then null else v.amount end, v.status, v.cost_scope into v_ca, v_cst, v_csc
      from fin_inventory_valuations v where v.business_id = p_business and v.period = p_period and v.category = c and v.voided_at is null;
    st := st || jsonb_build_object(c, jsonb_build_object('opening_amount', v_oa, 'opening_source', v_os, 'opening_scope', v_osc,
                                                         'closing_amount', v_ca, 'closing_status', v_cst, 'closing_scope', v_csc));
  end loop;
  select exists (select 1 from fin_inventory_valuations w join fin_inventory_valuations f
                   on f.business_id = w.business_id and f.period = w.period and f.category = 'finished' and f.voided_at is null
                  where w.business_id = p_business and w.period = p_period and w.category = 'wip' and w.voided_at is null
                    and w.amount is not null and w.amount = f.amount
                    and ((w.source_upload_id is not null and w.source_upload_id = f.source_upload_id) or (w.source_ref is not null and w.source_ref = f.source_ref)))
    into v_dup;
  st := jsonb_set(jsonb_set(st, '{wip,duplicate_suspect}', to_jsonb(v_dup)), '{finished,duplicate_suspect}', to_jsonb(v_dup));

  -- 장부(전표 · 결산) — 이 달 손익 줄이 하나도 없으면 전부 미입력. 줄이 있으면 없는 구역은 장부 기준 0.
  select count(*) > 0 as has,
         -coalesce(sum(c.amount) filter (where c.section = 'revenue'), 0) as revenue,
         coalesce(sum(c.amount) filter (where c.section = 'cogs' and c.category = 'raw_material' and c.account_code <> '4610'), 0) as raw,
         coalesce(sum(c.amount) filter (where c.section = 'cogs' and c.account_code = '4610'), 0) as merch,
         coalesce(sum(c.amount) filter (where c.section = 'cogs' and c.category = 'labor' and c.account_code <> '4610'), 0) as labor,
         coalesce(sum(c.amount) filter (where c.section = 'cogs' and c.category not in ('raw_material', 'labor') and c.account_code <> '4610'), 0) as overhead,
         coalesce(sum(c.amount) filter (where c.section in ('sga', 'd_and_a')), 0) as sga,
         -coalesce(sum(c.amount) filter (where c.section in ('revenue', 'cogs', 'sga', 'd_and_a')), 0) as op
    into v_books
    from finance_ledger_cells c
   where c.business_id = p_business and c.period = p_period and c.section in ('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax');
  v_has := coalesce(v_books.has, false);
  if v_rsrc = 'books' then
    v_rev := case when v_has then v_books.revenue end;
  else
    select case when count(*) > 0 and bool_and(amount is not null) then sum(amount) end into v_rev
      from fin_sales_lines where business_id = p_business and period = p_period and voided_at is null and not (line_id = any(v_sexcl));
  end if;

  -- 자금흐름표 — 실제 출금 중 «항목»이 원료 대금 규칙에 맞는 줄.
  select count(*) as n, sum(inflow) as inflow, sum(outflow) as outflow,
         coalesce(sum(outflow) filter (where category ilike any (array(select '%' || x || '%' from unnest(v_cats) x))), 0) as mat
    into v_cash
    from fin_cash_flows where business_id = p_business and period = p_period and voided_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'amount', a.amount, 'status', a.status) order by a.proposed_at, a.adj_id), '[]'::jsonb)
    into v_adj
    from fin_pl_adjustments a where a.business_id = p_business and a.period = p_period and a.status in ('proposed', 'approved');

  select o.amount into v_rawman from fin_inventory_openings o
   where o.business_id = p_business and o.period = p_period and o.category = 'raw' and o.voided_at is null and o.value_state <> 'missing';

  return jsonb_build_object(
    'period', p_period,
    'method', v_method,
    'method_confirmed', v_conf,
    'tolerance_krw', v_tol,
    'materials', v_mats,
    'issues_uploaded', v_issues,
    'statement_uploaded', v_cur_stmt > 0,
    'raw_opening_manual', v_rawman,
    'openings_unconfirmed', (select count(*) from fin_inventory_openings o
                              where o.business_id = p_business and o.period = p_period and o.voided_at is null
                                and o.value_state <> 'missing' and o.confirmed_at is null),
    'raw_statement_opening', v_stmt_open,
    'wip', st -> 'wip',
    'finished', st -> 'finished',
    'revenue', v_rev,
    'revenue_source', v_rsrc,
    'books_has_lines', v_has,
    'books_raw_material', case when v_has then v_books.raw end,
    'books_merchandise_cogs', case when v_has then v_books.merch end,
    'mfg_labor', case when v_has then v_books.labor end,
    'mfg_overhead', case when v_has then v_books.overhead end,
    'sga', case when v_has then v_books.sga end,
    'books_operating_income', case when v_has then v_books.op end,
    'adjustments', v_adj,
    'cash', jsonb_build_object('uploaded', v_cash.n > 0, 'material_payments', case when v_cash.n > 0 then v_cash.mat end,
                               'inflow', case when v_cash.n > 0 then coalesce(v_cash.inflow, 0) end,
                               'outflow', case when v_cash.n > 0 then coalesce(v_cash.outflow, 0) end),
    'purchase_dupes_excluded', cardinality(v_excl),
    'purchase_suspects', v_susp,
    'link', jsonb_build_object('prev_final', v_pc.close_id is not null, 'earlier_final', v_earlier));
end;
$fn$;

-- =====================================================================
-- 4절. RPC — 읽기
-- =====================================================================

/** 대표 또는 원가 관리('/costing/<회사>') — 원료별 줄을 볼 수 있는 사람(0061 cost_can). */
create or replace function fin_pl_cost_viewer(p_business text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(auth_role()::text = 'Chairman', false) or coalesce(cost_can('costing', p_business), false);
$fn$;

/** 기능 스위치 · 회사 · 달 모양. 읽기 문(can_read_books)은 부르는 쪽이 고른다. */
create or replace function fin_pl_gate(p_business text, p_period text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not coalesce(feature_on('monthly_pl', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_period is not null and p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fin_pl_period' using errcode = '22023';
  end if;
end;
$fn$;

/**
 * 한 달 보기. 확정 달 = 저장본 그대로(숫자는 마감 때 그대로 — 원천이 바뀌면 inputs_changed · 앞 달을 다시 마감했으면 opening_diff).
 * 그 밖 = 지금 원천으로 계산(입력 중 · 잠정). 원료별 줄은 대표 · 원가 관리만(fin_pl_mask).
 */
create or replace function fin_pl_month(p_business text, p_period text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_live fin_pl_closes;
  v_prevf fin_pl_closes;
  v_in jsonb;
  v_res jsonb;
  v_view text;
  v_diff jsonb := null;
  v_flags int;
  v_adj jsonb;
  v_rec jsonb := null;
  v_cost boolean := fin_pl_cost_viewer(p_business);
begin
  perform fin_pl_gate(p_business, p_period);
  if not coalesce(can_read_books(p_business), false) then
    raise exception 'fin_pl_denied' using errcode = '42501';
  end if;
  select * into v_live from fin_pl_closes where business_id = p_business and period = p_period and superseded_at is null;
  v_in := fin_pl_gather(p_business, p_period);
  if v_live.status = 'final' then
    v_res := v_live.totals || jsonb_build_object('materials', coalesce(v_live.detail -> 'materials', '[]'::jsonb));
    v_view := 'final';
    select * into v_prevf from fin_pl_closes where business_id = p_business and period = fin_prev_period(p_period) and status = 'final' and superseded_at is null;
    if v_prevf.close_id is not null then
      v_diff := jsonb_build_object(
        'raw', fin_pl_n(v_live.totals -> 'basis', 'raw_opening') - fin_pl_n(v_prevf.totals -> 'basis', 'raw_closing'),
        'wip', fin_pl_n(v_live.totals -> 'basis', 'wip_opening') - fin_pl_n(v_prevf.totals -> 'basis', 'wip_closing'),
        'finished', fin_pl_n(v_live.totals -> 'basis', 'finished_opening') - fin_pl_n(v_prevf.totals -> 'basis', 'finished_closing'));
      if coalesce((v_diff ->> 'raw')::numeric, 0) = 0 and coalesce((v_diff ->> 'wip')::numeric, 0) = 0 and coalesce((v_diff ->> 'finished')::numeric, 0) = 0 then
        v_diff := null;
      end if;
    end if;
  else
    v_res := fin_pl_compute(v_in);
    v_view := v_res ->> 'status';
  end if;
  select count(*) into v_flags from fin_reclose_flags f where f.business_id = p_business and f.period = p_period and f.cause = 'pl_reopen' and f.cleared_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
           'adj_id', a.adj_id, 'kind', a.kind, 'amount', a.amount, 'reason', a.reason, 'status', a.status,
           'proposed_by_name', (select u.display_name from user_profiles u where u.user_id = a.proposed_by), 'proposed_at', a.proposed_at,
           'approved_by_name', (select u.display_name from user_profiles u where u.user_id = a.approved_by)) order by a.proposed_at), '[]'::jsonb)
    into v_adj
    from fin_pl_adjustments a where a.business_id = p_business and a.period = p_period;
  if v_live.close_id is not null then
    v_rec := jsonb_build_object('close_id', v_live.close_id, 'status', v_live.status, 'calc_version', v_live.calc_version, 'input_hash', v_live.input_hash,
      'recorded_at', v_live.recorded_at, 'recorded_by_name', (select u.display_name from user_profiles u where u.user_id = v_live.recorded_by),
      'closed_at', v_live.closed_at, 'closed_by_name', (select u.display_name from user_profiles u where u.user_id = v_live.closed_by));
  end if;
  return jsonb_build_object(
    'business_id', p_business,
    'period', p_period,
    'view_status', v_view,
    'record', v_rec,
    'result', fin_pl_mask(v_res, v_cost),
    'stale', jsonb_build_object('inputs_changed', coalesce(v_live.status = 'final' and v_live.input_hash <> md5(v_in::text), false),
                                'opening_diff', v_diff, 'reclose_flags', v_flags),
    'provisional_diff', case when v_live.status = 'final' then v_live.totals -> 'provisional_diff' end,
    'changed_vs_prev_final', case when v_live.status = 'final' then v_live.totals -> 'changed_vs_prev_final' end,
    'adjustments', v_adj);
end;
$fn$;

/** 한 해의 저장본 상태(살아 있는 줄만) — 열두 달 띠. */
create or replace function fin_pl_year(p_business text, p_year text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v jsonb;
begin
  perform fin_pl_gate(p_business, null);
  if not coalesce(can_read_books(p_business), false) or p_year is null or p_year !~ '^[0-9]{4}$' then
    raise exception 'fin_pl_denied' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('period', c.period, 'status', c.status, 'closed_at', c.closed_at) order by c.period), '[]'::jsonb) into v
    from fin_pl_closes c where c.business_id = p_business and c.period like p_year || '-%' and c.superseded_at is null;
  return v;
end;
$fn$;

/** 설정(없으면 기본값). */
create or replace function fin_pl_setting(p_business text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  s fin_pl_settings;
begin
  perform fin_pl_gate(p_business, null);
  if not coalesce(can_read_books(p_business), false) then
    raise exception 'fin_pl_denied' using errcode = '42501';
  end if;
  select * into s from fin_pl_settings where business_id = p_business;
  return jsonb_build_object('method', coalesce(s.method, 'monthly_wa'), 'method_confirmed', coalesce(s.method_confirmed, false),
    'tolerance_krw', coalesce(s.tolerance_krw, 1000), 'revenue_source', coalesce(s.revenue_source, 'books'),
    'payment_categories', to_jsonb(coalesce(s.payment_categories, array['원재료', '원료', '원자재'])), 'updated_at', s.updated_at);
end;
$fn$;

-- =====================================================================
-- 5절. RPC — 쓰기(검사가 전부 쓰기보다 먼저다 — 쓴 뒤에는 raise하지 않는다)
-- =====================================================================

/**
 * 잠정 저장(p_final = false · 장부 쓰기) 또는 내부 마감 확정(p_final = true · 마감 권한). 같은 입력 · 같은 상태면 새 줄 없이 그 줄을 돌려준다.
 * 마감 문: fin_pl_compute의 closable(막는 까닭 0 — 기초 = 전월 확정 기말 · 중요 누락 없음 · 미승인 조정 없음 · 대사 허용오차 통과).
 * 확정 달은 다시 열기 전에는 저장하지 못한다(fin_pl_final). 원천 · 조정 · 이후 달은 건드리지 않는다.
 */
create or replace function fin_pl_record(p_business text, p_period text, p_final boolean, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_live fin_pl_closes;
  v_old  fin_pl_closes;
  v_in   jsonb;
  v_res  jsonb;
  v_hash text;
  v_id   uuid;
  v_status text := case when p_final then 'final' else 'provisional' end;
  v_pdiff jsonb := null;
  v_chg  jsonb := null;
  k text;
  r record;
begin
  perform fin_pl_gate(p_business, p_period);
  if p_period is null or p_final is null then
    raise exception 'fin_pl_period' using errcode = '22023';
  end if;
  if (p_final and not coalesce(can_close_books(p_business), false)) or (not p_final and not coalesce(can_keep_books(p_business), false)) then
    raise exception 'fin_pl_denied' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('fin_pl:' || p_business || ':' || p_period));
  -- 앞 달 잠금도 (공유로) 잡는다 — 순서는 늘 이 달 → 앞 달(교착 없음). 앞 달의 기록 · 다시 열기 · 조정과 줄을 선다(리뷰 고침 2 I1).
  perform pg_advisory_xact_lock_shared(hashtext('fin_pl:' || p_business || ':' || fin_prev_period(p_period)));
  select * into v_live from fin_pl_closes where business_id = p_business and period = p_period and superseded_at is null for update;
  -- 기초로 읽는 앞 달 확정본을 잠근다(같은 때 앞 달을 다시 열면 그쪽이 기다린다 — 내려간 확정본을 기초로 쓰지 않게).
  perform 1 from fin_pl_closes where business_id = p_business and period = fin_prev_period(p_period) and status = 'final' and superseded_at is null for share;
  v_in := fin_pl_gather(p_business, p_period);
  v_hash := md5(v_in::text);
  if v_live.status = 'final' then
    if p_final and v_live.input_hash = v_hash then
      return v_live.close_id;
    end if;
    raise exception 'fin_pl_final' using errcode = '42501';
  end if;
  if v_live.close_id is not null and v_live.input_hash = v_hash and v_live.status = v_status then
    return v_live.close_id;
  end if;
  v_res := fin_pl_compute(v_in);
  if v_res ->> 'status' = 'entering' then
    raise exception 'fin_pl_entering' using errcode = '22023';
  end if;
  if p_final and not coalesce((v_res ->> 'closable')::boolean, false) then
    raise exception 'fin_pl_blocked' using errcode = '22023';
  end if;
  if p_final and v_live.close_id is not null then
    select jsonb_object_agg(x.key, fin_pl_n(v_res -> 'pl', x.key) - fin_pl_n(v_live.totals -> 'pl', x.key)) into v_pdiff
      from jsonb_each(v_res -> 'pl') x;
  end if;
  if p_final then
    -- 다시 여는 바람에 내려간 앞 확정본(가장 최근) — 바뀐 값을 남긴다(이후 달 영향 추적).
    select * into v_old from fin_pl_closes where business_id = p_business and period = p_period and status = 'final' and reopened_at is not null
     order by reopened_at desc limit 1;
    if v_old.close_id is not null then
      v_chg := '{}'::jsonb;
      foreach k in array array['raw_closing', 'wip_closing', 'finished_closing'] loop
        v_chg := v_chg || jsonb_build_object(k, fin_pl_n(v_res -> 'basis', k) - fin_pl_n(v_old.totals -> 'basis', k));
      end loop;
      v_chg := v_chg || jsonb_build_object('operating_income', fin_pl_n(v_res -> 'pl', 'operating_income') - fin_pl_n(v_old.totals -> 'pl', 'operating_income'));
    end if;
  end if;
  v_id := gen_random_uuid();
  if v_live.close_id is not null then
    update fin_pl_closes set superseded_at = now(), superseded_by = v_id where close_id = v_live.close_id;
  end if;
  insert into fin_pl_closes (close_id, business_id, period, status, calc_version, method, tolerance_krw, input_hash, totals, detail, closed_by, closed_at)
  values (v_id, p_business, p_period, v_status, v_res ->> 'calc_version', v_res ->> 'method', fin_pl_n(v_in, 'tolerance_krw'), v_hash,
          (v_res - 'materials') || jsonb_build_object('provisional_diff', v_pdiff, 'changed_vs_prev_final', v_chg),
          jsonb_build_object('input', v_in, 'materials', v_res -> 'materials'),
          case when p_final then auth.uid() end, case when p_final then now() end);
  if p_final then
    update fin_reclose_flags set cleared_at = now(), cleared_by = auth.uid()
     where business_id = p_business and period = p_period and cause = 'pl_reopen' and cleared_at is null;
    -- 이 달을 확정하면 이후의 살아 있는 확정 달은 기초가 바뀌었을 수 있다 — 덮어쓰지 않고 재마감 대상으로만(다시 열기와 같은 까닭).
    for r in select c.period from fin_pl_closes c where c.business_id = p_business and c.period > p_period and c.status = 'final' and c.superseded_at is null order by c.period loop
      if not exists (select 1 from fin_reclose_flags f where f.business_id = p_business and f.period = r.period and f.cause = 'pl_reopen' and f.cleared_at is null) then
        insert into fin_reclose_flags (business_id, period, upload_id, cause, reason)
        values (p_business, r.period, null, 'pl_reopen', '앞 달(' || p_period || ') 월별 손익을 다시 확정했다 — 기초 확인 · 재마감 필요');
      end if;
    end loop;
  end if;
  perform fin_audit(case when p_final then 'approve'::audit_action else 'create'::audit_action end, 'fin_pl_closes', v_id::text, p_business,
    case when v_live.close_id is null then null else jsonb_build_object('replaced', v_live.close_id, 'status', v_live.status) end,
    jsonb_build_object('period', p_period, 'status', v_status, 'input_hash', v_hash, 'calc_version', v_res ->> 'calc_version',
                       'scope', v_res ->> 'scope', 'reason', nullif(btrim(coalesce(p_reason, '')), '')),
    case when p_final then '월별 손익 내부 마감 확정(0075)' else '월별 손익 잠정 저장(0075)' end);
  return v_id;
end;
$fn$;

/**
 * 다시 열기 — 대표 · 그룹 CFO + 이유(2자 이상). 확정본은 지우지 않고 내려간다(superseded · reopened). 이후 확정 달은 그대로 두고
 * 재마감 대상(fin_reclose_flags 'pl_reopen') 한 줄씩. 돌려주는 값 = 표시한 이후 달 수.
 */
create or replace function fin_pl_reopen(p_business text, p_period text, p_reason text) returns int
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_live fin_pl_closes;
  v_n int := 0;
  r record;
begin
  perform fin_pl_gate(p_business, p_period);
  if coalesce(auth_role()::text, '') not in ('Chairman', 'GroupCFO') or not coalesce(can_read_books(p_business), false) then
    raise exception 'fin_pl_denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 then
    raise exception 'fin_pl_reason' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('fin_pl:' || p_business || ':' || p_period));
  select * into v_live from fin_pl_closes where business_id = p_business and period = p_period and superseded_at is null for update;
  if v_live.close_id is null or v_live.status <> 'final' then
    raise exception 'fin_pl_not_final' using errcode = '22023';
  end if;
  update fin_pl_closes set superseded_at = now(), reopened_at = now(), reopened_by = auth.uid(), reopen_reason = left(btrim(p_reason), 500)
   where close_id = v_live.close_id;
  for r in select c.period from fin_pl_closes c where c.business_id = p_business and c.period > p_period and c.status = 'final' and c.superseded_at is null order by c.period loop
    if not exists (select 1 from fin_reclose_flags f where f.business_id = p_business and f.period = r.period and f.cause = 'pl_reopen' and f.cleared_at is null) then
      insert into fin_reclose_flags (business_id, period, upload_id, cause, reason)
      values (p_business, r.period, null, 'pl_reopen', left('앞 달(' || p_period || ') 월별 손익을 다시 열었다 — ' || btrim(p_reason), 500));
      v_n := v_n + 1;
    end if;
  end loop;
  perform fin_audit('update', 'fin_pl_closes', v_live.close_id::text, p_business, jsonb_build_object('status', 'final'),
    jsonb_build_object('period', p_period, 'reopened', true, 'later_flagged', v_n, 'reason', btrim(p_reason)), '월별 손익 다시 열기(0075)');
  return v_n;
end;
$fn$;

/** 재고 조정 제안 — 장부 쓰기. 금액은 원 단위 · 0 아님 · 이유 필수. 확정 달이면 거부(다시 열기 먼저). 같은 제안이 살아 있으면 그 줄. */
create or replace function fin_pl_adjust_propose(p_business text, p_period text, p_kind text, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id uuid;
begin
  perform fin_pl_gate(p_business, p_period);
  if p_period is null or not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_pl_denied' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('shrinkage', 'scrap', 'other') or p_amount is null or p_amount = 0 or p_amount <> trunc(p_amount)
     or abs(p_amount) > 1e15 then
    raise exception 'fin_pl_adjust_value' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 then
    raise exception 'fin_pl_reason' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('fin_pl:' || p_business || ':' || p_period));
  if exists (select 1 from fin_pl_closes where business_id = p_business and period = p_period and status = 'final' and superseded_at is null) then
    raise exception 'fin_pl_final' using errcode = '42501';
  end if;
  select adj_id into v_id from fin_pl_adjustments
   where business_id = p_business and period = p_period and kind = p_kind and amount = p_amount and reason = left(btrim(p_reason), 500) and status <> 'voided'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into fin_pl_adjustments (business_id, period, kind, amount, reason) values (p_business, p_period, p_kind, p_amount, left(btrim(p_reason), 500))
  returning adj_id into v_id;
  perform fin_audit('create', 'fin_pl_adjustments', v_id::text, p_business, null,
    jsonb_build_object('period', p_period, 'kind', p_kind, 'amount', p_amount, 'reason', btrim(p_reason)), '월별 손익 재고 조정 제안(0075)');
  return v_id;
end;
$fn$;

/** 조정 승인(마감 권한 · 제안한 사람이 아닌 사람) · 무효(장부 쓰기 + 이유). 확정 달이면 거부. */
create or replace function fin_pl_adjust_decide(p_id uuid, p_action text, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v fin_pl_adjustments;
begin
  select * into v from fin_pl_adjustments where adj_id = p_id;
  if v.adj_id is null then
    raise exception 'fin_pl_denied' using errcode = '42501';
  end if;
  perform fin_pl_gate(v.business_id, v.period);
  if p_action is null or p_action not in ('approve', 'void') then
    raise exception 'fin_pl_adjust_value' using errcode = '22023';
  end if;
  if (p_action = 'approve' and not coalesce(can_close_books(v.business_id), false)) or (p_action = 'void' and not coalesce(can_keep_books(v.business_id), false)) then
    raise exception 'fin_pl_denied' using errcode = '42501';
  end if;
  if p_action = 'approve' and v.proposed_by = auth.uid() then
    raise exception 'fin_pl_self_approve' using errcode = '42501';
  end if;
  if p_action = 'void' and length(btrim(coalesce(p_reason, ''))) < 2 then
    raise exception 'fin_pl_reason' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('fin_pl:' || v.business_id || ':' || v.period));
  select * into v from fin_pl_adjustments where adj_id = p_id for update;
  if exists (select 1 from fin_pl_closes where business_id = v.business_id and period = v.period and status = 'final' and superseded_at is null) then
    raise exception 'fin_pl_final' using errcode = '42501';
  end if;
  if (p_action = 'approve' and v.status <> 'proposed') or (p_action = 'void' and v.status = 'voided') then
    return false;
  end if;
  -- 승인된 조정을 무효로 하면 손익이 바뀐다 — 승인과 같은 마감 권한이 있어야 한다(승인 전 제안은 장부 쓰기로 무효 가능).
  if p_action = 'void' and v.status = 'approved' and not coalesce(can_close_books(v.business_id), false) then
    raise exception 'fin_pl_denied' using errcode = '42501';
  end if;
  if p_action = 'approve' then
    update fin_pl_adjustments set status = 'approved', approved_by = auth.uid(), approved_at = now() where adj_id = p_id;
  else
    update fin_pl_adjustments set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = left(btrim(p_reason), 500) where adj_id = p_id;
  end if;
  perform fin_audit(case when p_action = 'approve' then 'approve'::audit_action else 'update'::audit_action end, 'fin_pl_adjustments', p_id::text, v.business_id,
    jsonb_build_object('status', v.status), jsonb_build_object('period', v.period, 'action', p_action, 'reason', nullif(btrim(coalesce(p_reason, '')), '')),
    case when p_action = 'approve' then '월별 손익 재고 조정 승인(0075)' else '월별 손익 재고 조정 무효(0075)' end);
  return true;
end;
$fn$;

/** 설정 바꾸기 — 대표 · 그룹 CFO + 이유. 평가방법을 세무사 확인 뒤 바꾸는 곳. 감사 before · after. */
create or replace function fin_pl_setting_save(p_business text, p_method text, p_method_confirmed boolean, p_tolerance numeric,
                                               p_revenue_source text, p_payment_categories text[], p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_old fin_pl_settings;
begin
  perform fin_pl_gate(p_business, null);
  if coalesce(auth_role()::text, '') not in ('Chairman', 'GroupCFO') or not coalesce(can_read_books(p_business), false) then
    raise exception 'fin_pl_denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 then
    raise exception 'fin_pl_reason' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('monthly_wa', 'statement') or p_method_confirmed is null or p_tolerance is null or p_tolerance < 0
     or p_tolerance <> trunc(p_tolerance) or p_tolerance > 1000000 or p_revenue_source is null or p_revenue_source not in ('books', 'sales_upload')
     or p_payment_categories is null or cardinality(p_payment_categories) not between 1 and 20
     or exists (select 1 from unnest(p_payment_categories) x where length(btrim(coalesce(x, ''))) not between 1 and 40) then
    raise exception 'fin_pl_setting_value' using errcode = '22023';
  end if;
  select * into v_old from fin_pl_settings where business_id = p_business for update;
  insert into fin_pl_settings (business_id, method, method_confirmed, tolerance_krw, revenue_source, payment_categories, updated_by, updated_at)
  values (p_business, p_method, p_method_confirmed, p_tolerance, p_revenue_source, (select array_agg(btrim(x)) from unnest(p_payment_categories) x), auth.uid(), now())
  on conflict (business_id) do update set method = excluded.method, method_confirmed = excluded.method_confirmed, tolerance_krw = excluded.tolerance_krw,
    revenue_source = excluded.revenue_source, payment_categories = excluded.payment_categories, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform fin_audit('update', 'fin_pl_settings', p_business, p_business,
    case when v_old.business_id is null then null else jsonb_build_object('method', v_old.method, 'method_confirmed', v_old.method_confirmed,
      'tolerance_krw', v_old.tolerance_krw, 'revenue_source', v_old.revenue_source, 'payment_categories', v_old.payment_categories) end,
    jsonb_build_object('method', p_method, 'method_confirmed', p_method_confirmed, 'tolerance_krw', p_tolerance, 'revenue_source', p_revenue_source,
      'payment_categories', p_payment_categories, 'reason', btrim(p_reason)), '월별 손익 설정(0075)');
end;
$fn$;

-- =====================================================================
-- 6절. 권한 — 내부 함수는 authenticated에게도 없음. RPC는 authenticated만(public · anon에게서 이름으로 걷는다 — 0060)
-- =====================================================================
revoke all on function fin_pl_closes_frozen() from public, anon, authenticated;
revoke all on function fin_pl_n(jsonb, text) from public, anon, authenticated;
revoke all on function fin_pl_norm(text) from public, anon, authenticated;
revoke all on function fin_pl_mat_msg(text) from public, anon, authenticated;
revoke all on function fin_pl_compute(jsonb) from public, anon, authenticated;
revoke all on function fin_pl_mask(jsonb, boolean) from public, anon, authenticated;
revoke all on function fin_pl_gather(text, text) from public, anon, authenticated;
revoke all on function fin_pl_cost_viewer(text) from public, anon, authenticated;
revoke all on function fin_pl_gate(text, text) from public, anon, authenticated;

revoke all on function fin_pl_month(text, text) from public, anon;
revoke all on function fin_pl_year(text, text) from public, anon;
revoke all on function fin_pl_setting(text) from public, anon;
revoke all on function fin_pl_record(text, text, boolean, text) from public, anon;
revoke all on function fin_pl_reopen(text, text, text) from public, anon;
revoke all on function fin_pl_adjust_propose(text, text, text, numeric, text) from public, anon;
revoke all on function fin_pl_adjust_decide(uuid, text, text) from public, anon;
revoke all on function fin_pl_setting_save(text, text, boolean, numeric, text, text[], text) from public, anon;
grant execute on function fin_pl_month(text, text) to authenticated;
grant execute on function fin_pl_year(text, text) to authenticated;
grant execute on function fin_pl_setting(text) to authenticated;
grant execute on function fin_pl_record(text, text, boolean, text) to authenticated;
grant execute on function fin_pl_reopen(text, text, text) to authenticated;
grant execute on function fin_pl_adjust_propose(text, text, text, numeric, text) to authenticated;
grant execute on function fin_pl_adjust_decide(uuid, text, text) to authenticated;
grant execute on function fin_pl_setting_save(text, text, boolean, numeric, text, text[], text) to authenticated;

commit;
