-- =====================================================================
-- Chairman OS — 0080_material_price_lock (원료 단가 · kg 노출 막기)
-- 작성: 2026-10-13 · 대표 결정(같은 날): 원료별 매입 단가 · 원료별 kg(입고 · 재고 · 출고 · OFFER SHEET 줄)는
--   대표 · 그룹 CFO · 원가 관리 권한자('/costing/<회사>') · 그 파일을 올린 사람 본인(올린 뒤 1시간)만 본다.
--   그 밖의 장부 권한자(can_read_books · can_keep_books — 예: 김병훈 자리, 회사 대표)는 회사 · 월 합계 금액만 본다.
--
-- ■ 무엇이 열려 있었나(0070 · 0072 · 0075 전수 확인 2026-10-13) ■
--   ① fin_purchase_in_lines(② 입고) — qty · amount · amount_vat를 can_read_books 누구나 직접 select.
--   ② fin_inventory_lines(③ 재고) — stock_qty · amount · opening_amount 직접 select(used_qty는 0072가 이미 뺐다).
--   ③ fin_import_lines(⑦ OFFER SHEET) — amount · fx_rate · amount_krw · extra_cost 직접 select.
--   ④ fin_upload_pending — 입고 · 재고 · OFFER · 모름(unknown) 미리보기 줄과 칸 격자(grid — 시트 원본 숫자)를 장부 쓰는 사람 누구에게나.
--   ⑤ fin_pl_cost_viewer(0075) — 원료별 손익 줄을 대표 · 원가 관리만 봤다(그룹 CFO가 빠져 있었다 — 결정과 맞춘다).
--   fin_material_issues(⑯ 출고)의 qty_kg는 0072부터 누구에게도 grant가 없다 — 이 파일도 열지 않는다(구성표 노출 금지가 더 좁다).
--
-- ■ 어떻게 ■
--   1절 문 둘: fin_material_viewer(회사) = 대표 · 그룹 CFO · cost_grant('costing') · 회사 범위.
--             fin_material_line_ok(회사, 올리기) = 위 또는 (그 올리기를 만든 본인 · 만든 지 1시간 안 · 아직 그 회사 장부를 쓰는 사람).
--   2절 열 grant: 세 표의 숫자 칸을 authenticated에서 뺀다(행 정책 can_read_books는 그대로 — 이름 · 공급처 · 줄 번호 · 상태는 보인다).
--   3절 fin_material_lines(회사, 달, 종류) — 정의자 · 줄마다 fin_material_line_ok면 숫자, 아니면 null + hidden=true.
--   4절 fin_material_totals(회사, 달) — 회사 · 월 합계 금액(수량 · kg 없음). 장부 읽기 문. 원료 3가지 미만인 종류는 문 밖에 null(리뷰 I1).
--   4-2절 fin_inventory_roll(0076 본문) — 원재료 품목 3가지 미만인 달의 원재료 금액을 문 밖에 비운다(리뷰 I1).
--   5절 fin_upload_pending(0072 본문 + 거름) — 입고 · 재고 · OFFER · 모름은 fin_material_line_ok 밖이면 줄 숫자 · 칸 격자를 뺀다(masked=true).
--   6절 넣기 지킴 트리거 — 그 네 종류의 미리보기 대기를 넣는 것(needs_review → applied)은 fin_material_line_ok인 사람만.
--        (가려진 줄을 받은 사람이 넣으면 앱이 숫자 없는 줄을 돌려보낸다 — 넣지 않고 «파일을 다시 올리세요».)
--   7절 fin_pl_cost_viewer = fin_material_viewer(그룹 CFO 더함). 월별 손익 계산(fin_pl_gather · fin_pl_compute)은 그대로 —
--        정의자 안에서 원천을 읽고, 밖에는 fin_pl_mask가 합계만 낸다.
--   7-2절 fin_pl_mask · fin_pl_month(0075 본문) — 원료 1~2가지 달은 원가 권한 밖에 원재료 기초 · 매입 · 기말 · 검산 · 차이 칸을 비운다(리뷰 I-A).
--
-- ■ 정의자 함수 전수(이 세 표 · 대기 줄을 읽는 것 — 0070~0079) ■
--   fin_upload_apply · void · unvoid · revert · cancel · record — 쓰기만 · 돌려주는 값은 id/참거짓 · 감사는 줄 수만.
--   fin_upload_pending — 5절에서 고침.  fin_inventory_roll — 원재료 구분 합계(4-2절 — 품목 3가지 미만이면 문 밖에 비움).
--   fin_issue_summary — 생산 투입 kg 합계(원료 3가지 미만 · 확인 필요 남으면 감춤 · 100kg 반올림) — 원료별 없음, 그대로.
--   fin_tx_line_ok — 참거짓.  fin_pl_gather · fin_pl_compute — 내부(grant 없음).  fin_pl_month — fin_pl_mask(7절).
--   fin_pl_closes.detail — 열 grant 없음(0075).  cost_fin_candidates(0078) — 대표 · 원가 관리 쓰기만(허용 범위 안).
--   ledger_post_*(0079) — 원장 줄만(이 세 표 아님).  sales_*(0077) — 제품 판매(원료 아님).
--   감사 · 알림(0070 · 0072 · 0078 · 0079) — 종류 · 달 · 줄 수 · 이유뿐(숫자 없음, 확인함).
--
-- 0035 규칙: 0001~0079를 고치지 않는다(함수는 create or replace로 이 파일에서) · force를 새로 걸지 않는다 · 새 정책 없음.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 문
-- =====================================================================
/** 원료별 단가 · kg를 늘 볼 수 있는 사람 — 대표 · 그룹 CFO · 그 회사 원가 관리 줄. 회사 범위 함께. 시스템 계정은 늘 거짓. */
create or replace function fin_material_viewer(p_business text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p_business is not null
     and coalesce(is_active(), false)
     and coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration')
     and coalesce(has_business(p_business), false)
     and (coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO') or coalesce(cost_grant('costing', p_business, false), false));
$fn$;
comment on function fin_material_viewer(text) is
  '0080. 원료별 매입 단가 · kg를 볼 수 있는 사람 — 대표 · 그룹 CFO · ''/costing/<회사>'' 줄(읽기 이상), AND 회사 범위. AIAgent · Integration 거짓.';

/** 그 올리기의 줄 숫자를 볼 수 있는가 — 위 사람, 또는 그 올리기를 만든 본인(만든 지 1시간 안 · 지금도 그 회사 장부를 쓰는 사람). */
create or replace function fin_material_line_ok(p_business text, p_upload uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select fin_material_viewer(p_business)
      or (coalesce(is_active(), false)
          and coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration')
          and coalesce(can_keep_books(p_business), false)
          and exists (select 1 from fin_uploads u
                       where u.upload_id = p_upload and u.business_id = p_business
                         and u.created_by = auth.uid()
                         and u.created_at > now() - interval '1 hour'));
$fn$;
comment on function fin_material_line_ok(text, uuid) is
  '0080. 그 올리기 줄의 원료 숫자를 보는 문 — fin_material_viewer 또는 올린 본인(fin_uploads.created_at부터 1시간 · 지금 can_keep_books).';

-- =====================================================================
-- 2절. 열 grant — 숫자 칸을 뺀다(행 정책은 그대로)
-- =====================================================================
revoke select on table fin_purchase_in_lines from authenticated;
grant select (line_id, upload_id, business_id, period, row_no, material, supplier, material_kind, voided_at, created_at,
              tx_date, counterparty, source_system, vat_state, item_or_account)
  on table fin_purchase_in_lines to authenticated;

revoke select on table fin_inventory_lines from authenticated;
grant select (line_id, upload_id, business_id, period, row_no, item, amount_state, opening_state, voided_at, created_at)
  on table fin_inventory_lines to authenticated;

revoke select on table fin_import_lines from authenticated;
grant select (line_id, upload_id, business_id, period, row_no, ref_no, material, supplier, currency, voided_at, created_at)
  on table fin_import_lines to authenticated;

comment on column fin_purchase_in_lines.qty is '0080. [제한] 매입수량 — authenticated 열 grant 없음. 읽기는 fin_material_lines(줄마다 fin_material_line_ok).';
comment on column fin_purchase_in_lines.amount is '0080. [제한] 매입금액 — authenticated 열 grant 없음. 읽기는 fin_material_lines · 합계는 fin_material_totals.';
comment on column fin_inventory_lines.stock_qty is '0080. [제한] 재고수량 — authenticated 열 grant 없음. 읽기는 fin_material_lines.';
comment on column fin_inventory_lines.amount is '0080. [제한] 기말 재고금액 — authenticated 열 grant 없음. 읽기는 fin_material_lines · 합계는 fin_material_totals · fin_inventory_roll.';
comment on column fin_import_lines.amount_krw is '0080. [제한] 원화 대금 — authenticated 열 grant 없음. 읽기는 fin_material_lines · 합계는 fin_material_totals.';

-- =====================================================================
-- 3절. 줄 읽기 — 줄마다 문
-- =====================================================================
/**
 * 한 회사 · 한 달 · 한 종류(purchase_in · inventory · import)의 살아 있는 줄(5,000줄까지).
 * 숫자 칸은 fin_material_line_ok(회사, 그 줄의 올리기)일 때만, 아니면 null이고 hidden = true. 이름 · 공급처 · 줄 번호 · 상태는 늘.
 * 문: can_read_books(회사). 돌려주는 모양 = jsonb 배열.
 */
create or replace function fin_material_lines(p_business text, p_period text, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v jsonb;
begin
  if not coalesce(can_read_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or p_kind is null or p_kind not in ('purchase_in', 'inventory', 'import') then
    raise exception 'fin_material_kind' using errcode = '22023';
  end if;
  if p_kind = 'purchase_in' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'line_id', l.line_id, 'upload_id', l.upload_id, 'row_no', l.row_no, 'material', l.material, 'supplier', l.supplier,
             'material_kind', l.material_kind, 'tx_date', l.tx_date, 'counterparty', l.counterparty, 'source_system', l.source_system,
             'item_or_account', l.item_or_account, 'vat_state', l.vat_state,
             'qty', case when x.ok then l.qty end, 'amount', case when x.ok then l.amount end, 'amount_vat', case when x.ok then l.amount_vat end,
             'hidden', not x.ok) order by l.row_no, l.line_id), '[]'::jsonb)
      into v
      from (select * from fin_purchase_in_lines where business_id = p_business and period = p_period and voided_at is null
             order by row_no, line_id limit 5000) l
      cross join lateral (select fin_material_line_ok(p_business, l.upload_id) as ok) x;
  elsif p_kind = 'inventory' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'line_id', l.line_id, 'upload_id', l.upload_id, 'row_no', l.row_no, 'item', l.item,
             'amount_state', l.amount_state, 'opening_state', l.opening_state,
             'stock_qty', case when x.ok then l.stock_qty end, 'amount', case when x.ok then l.amount end,
             'opening_amount', case when x.ok then l.opening_amount end,
             'hidden', not x.ok) order by l.row_no, l.line_id), '[]'::jsonb)
      into v
      from (select * from fin_inventory_lines where business_id = p_business and period = p_period and voided_at is null
             order by row_no, line_id limit 5000) l
      cross join lateral (select fin_material_line_ok(p_business, l.upload_id) as ok) x;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'line_id', l.line_id, 'upload_id', l.upload_id, 'row_no', l.row_no, 'ref_no', l.ref_no, 'material', l.material,
             'supplier', l.supplier, 'currency', l.currency,
             'amount', case when x.ok then l.amount end, 'fx_rate', case when x.ok then l.fx_rate end,
             'amount_krw', case when x.ok then l.amount_krw end, 'extra_cost', case when x.ok then l.extra_cost end,
             'hidden', not x.ok) order by l.row_no, l.line_id), '[]'::jsonb)
      into v
      from (select * from fin_import_lines where business_id = p_business and period = p_period and voided_at is null
             order by row_no, line_id limit 5000) l
      cross join lateral (select fin_material_line_ok(p_business, l.upload_id) as ok) x;
  end if;
  return v;
end;
$fn$;
comment on function fin_material_lines(text, text, text) is
  '0080. 입고 · 재고 · OFFER 줄 읽기(장부 읽기 문). 숫자는 줄마다 fin_material_line_ok일 때만 — 아니면 null · hidden.';

-- =====================================================================
-- 4절. 회사 · 월 합계 금액
-- =====================================================================
/**
 * 회사 · 월 합계 금액만(수량 · kg 없음 · 원료 이름 없음). 빈칸은 0으로 더하지 않는다 — 줄은 있는데 값이 하나도 없으면 null.
 *   purchase_amount(입고 금액 합) · inventory_closing · inventory_opening(재고 기말 · 기초 금액 합) · import_krw · import_extra(OFFER 원화 · 부대비 합)
 *   그리고 종류별 줄 수. 문: can_read_books(회사).
 * 리뷰 I1: 그 달 그 종류의 원료(이름)가 3가지 미만이면 합계가 곧 원료 하나의 값이다(이름 칸은 열려 있다) —
 *   fin_material_viewer 밖에는 그 종류의 금액을 null로 두고 withheld에 적는다(0072 fin_issue_summary · 0075 fin_pl_mask와 같은 문턱).
 */
create or replace function fin_material_totals(p_business text, p_period text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  p record;
  i record;
  m record;
  v_all boolean := fin_material_viewer(p_business);
  v_wh  text[] := array[]::text[];
begin
  if not coalesce(can_read_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fin_upload_period' using errcode = '22023';
  end if;
  select count(*) as n, sum(amount) as amt, count(distinct lower(btrim(coalesce(material, item_or_account)))) as mats into p
    from fin_purchase_in_lines where business_id = p_business and period = p_period and voided_at is null;
  select count(*) as n,
         sum(amount) filter (where amount_state <> 'missing') as closing,
         sum(opening_amount) filter (where opening_state <> 'missing') as opening,
         count(distinct lower(btrim(item))) as mats
    into i
    from fin_inventory_lines where business_id = p_business and period = p_period and voided_at is null;
  select count(*) as n, sum(amount_krw) as krw, sum(extra_cost) as extra, count(distinct lower(btrim(material))) as mats into m
    from fin_import_lines where business_id = p_business and period = p_period and voided_at is null;
  if not v_all then
    if p.n > 0 and p.mats < 3 then v_wh := array_append(v_wh, 'purchase'); end if;
    if i.n > 0 and i.mats < 3 then v_wh := array_append(v_wh, 'inventory'); end if;
    if m.n > 0 and m.mats < 3 then v_wh := array_append(v_wh, 'import'); end if;
  end if;
  return jsonb_build_object(
    'business_id', p_business, 'period', p_period,
    'purchase_lines', p.n, 'purchase_amount', case when 'purchase' = any(v_wh) then null else p.amt end,
    'inventory_lines', i.n, 'inventory_closing', case when 'inventory' = any(v_wh) then null else i.closing end,
    'inventory_opening', case when 'inventory' = any(v_wh) then null else i.opening end,
    'import_lines', m.n, 'import_krw', case when 'import' = any(v_wh) then null else m.krw end,
    'import_extra', case when 'import' = any(v_wh) then null else m.extra end,
    'withheld', to_jsonb(v_wh));
end;
$fn$;
comment on function fin_material_totals(text, text) is
  '0080. 입고 · 재고 · OFFER의 회사 · 월 합계 금액(장부 읽기 문). 수량 · kg · 원료별 값 없음. 원료 3가지 미만인 종류는 원료 숫자 문 밖에 null(withheld).';

-- =====================================================================
-- 4-2절. 기초재고 연결(0076 본문 그대로 + 원재료 품목 3가지 미만 거름)
-- =====================================================================
create or replace function fin_inventory_roll(p_business text, p_period text)
returns table (category text, opening_amount numeric, opening_state text, opening_source text,
               closing_amount numeric, closing_state text, closing_status text, missing_lines int,
               statement_opening numeric, diff_vs_prev_close numeric,
               opening_id uuid, opening_confirmed boolean, prev_missing_lines int)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
declare
  v_prev text := fin_prev_period(p_period);
  c      text;
  v_pa   numeric; v_ps text;     -- 앞 달 기말
  v_pmiss int;                   -- 앞 달 빈칸 줄 수(원재료)
  v_oa   numeric; v_os text; v_osrc text;
  v_oid  uuid; v_ocf boolean;
  v_ca   numeric; v_cs text; v_cst text; v_miss int;
  v_st   numeric;
  v_n    int; v_known int;
  v_all  boolean := fin_material_viewer(p_business);   -- 0080
  v_mats int; v_pmats int;                             -- 0080: 이 달 · 앞 달 재고 명세서 품목 수
begin
  if not coalesce(can_read_books(p_business), false) or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return;
  end if;
  foreach c in array array['raw', 'wip', 'finished'] loop
    v_pa := null; v_ps := null; v_pmiss := 0; v_ca := null; v_cs := 'missing'; v_cst := null; v_miss := 0; v_st := null;
    v_oid := null; v_ocf := null;
    if c = 'raw' then
      -- 앞 달 기말
      select count(*), count(*) filter (where l.amount_state <> 'missing'), sum(l.amount) filter (where l.amount_state <> 'missing'),
             count(distinct lower(btrim(l.item)))
        into v_n, v_known, v_pa, v_pmats
        from fin_inventory_lines l where l.business_id = p_business and l.period = v_prev and l.voided_at is null;
      if v_known = 0 then v_pa := null; v_ps := null; else v_ps := case when v_pa = 0 then 'confirmed_zero' else 'value' end; end if;
      v_pmiss := coalesce(v_n, 0) - coalesce(v_known, 0);
      -- 이 달 기말 · 명세서 기초
      select count(*), count(*) filter (where l.amount_state <> 'missing'), sum(l.amount) filter (where l.amount_state <> 'missing'),
             count(*) filter (where l.amount_state = 'missing'),
             sum(l.opening_amount) filter (where l.opening_state <> 'missing'),
             count(distinct lower(btrim(l.item)))
        into v_n, v_known, v_ca, v_miss, v_st, v_mats
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
      v_oa := v_pa; v_osrc := 'prev_close';
      -- 0076: 앞 달에 빈칸 줄이 섞였으면 «일부 미입력»(아는 줄의 합 — 온전한 기초로 보이지 않게).
      v_os := case when v_pmiss > 0 then 'partial' else v_ps end;
    else
      select o.amount, o.value_state, o.source, o.opening_id, (o.confirmed_at is not null)
        into v_oa, v_os, v_osrc, v_oid, v_ocf
        from fin_inventory_openings o
       where o.business_id = p_business and o.period = p_period and o.category = c and o.voided_at is null;
      if v_osrc is null then
        v_oa := null; v_os := 'missing'; v_osrc := 'unlinked'; v_oid := null; v_ocf := null;
      end if;
    end if;

    category := c; opening_amount := v_oa; opening_state := v_os; opening_source := v_osrc;
    closing_amount := v_ca; closing_state := v_cs; closing_status := v_cst; missing_lines := v_miss;
    statement_opening := v_st;
    diff_vs_prev_close := case when v_st is not null and v_ps is not null then v_st - v_pa end;
    opening_id := v_oid; opening_confirmed := v_ocf;
    -- 0080 리뷰 I1: 원재료 품목이 3가지 미만인 달의 합은 곧 원료 하나의 금액이다 — 원료 숫자 문 밖에는 금액만 비운다(상태는 그대로).
    if c = 'raw' and not v_all then
      if coalesce(v_mats, 0) < 3 then   -- 줄이 없으면 이미 null · 이름 없는 줄만이면 0 — fin_material_totals와 같은 문턱(다시 리뷰 M-a)
        closing_amount := null; statement_opening := null; diff_vs_prev_close := null;
      end if;
      if v_osrc = 'prev_close' and coalesce(v_pmats, 0) < 3 then
        opening_amount := null; diff_vs_prev_close := null;
      end if;
    end if;
    prev_missing_lines := case when v_osrc = 'prev_close' then v_pmiss else 0 end;
    return next;
    v_oa := null; v_os := null; v_osrc := null;
  end loop;
end;
$fn$;
comment on function fin_inventory_roll(text, text) is
  '0072 → 0076 → 0080. 기초재고 연결(보여 주기만). 0080: 원재료 품목이 3가지 미만인 달의 원재료 금액은 fin_material_viewer 밖에 비운다.';

-- =====================================================================
-- 5절. 미리보기 대기 읽기 — 0072 본문 + 원료 숫자 거름
-- =====================================================================
/**
 * 0072와 같다(원료 출고 kg는 누구에게도 · 급여 개인 줄은 대표 · CFO만). 0080:
 *   입고 · 재고 · OFFER · 모름(unknown — 어느 종류인지 모르는 시트도 원료 파일일 수 있다)은
 *   fin_material_line_ok(회사, 이 올리기) 밖이면 줄의 숫자 칸과 칸 격자(grid)를 빼고 masked = true.
 */
create or replace function fin_upload_pending(p_upload uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_row fin_uploads;
  v_out jsonb;
  v_keys text[];
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
    v_out := v_row.pending;
  else
    -- 급여는 칸 격자(grid)에도 사람별 줄이 있다 — 대표 · CFO 밖에는 둘 다 뺀다.
    v_out := case when v_row.kind = 'payroll' then v_row.pending - 'people' - 'grid' else v_row.pending - 'people' end;
  end if;
  -- 리뷰 M3: 종류를 잘못 알아본 원료 파일(예: 낮은 믿음의 ledger · card)도 칸 격자에는 시트 숫자가 그대로 있다 —
  -- 원료 숫자 문 밖에는 어느 종류든 칸 격자를 뺀다(종류 · 칸 다시 고르기는 올린 사람 · 대표 · CFO · 원가 관리만 — 아니면 다시 올리기).
  if not fin_material_line_ok(v_row.business_id, v_row.upload_id) then
    v_out := v_out - 'grid';
  end if;
  if v_row.kind in ('purchase_in', 'inventory', 'import', 'unknown') and not fin_material_line_ok(v_row.business_id, v_row.upload_id) then
    v_keys := case v_row.kind
                when 'purchase_in' then array['qty', 'amount', 'amount_vat']
                when 'inventory'   then array['used_qty', 'stock_qty', 'amount', 'opening_amount']
                when 'import'      then array['amount', 'fx_rate', 'amount_krw', 'extra_cost']
                else array['qty', 'amount', 'amount_vat', 'used_qty', 'stock_qty', 'opening_amount', 'fx_rate', 'amount_krw', 'extra_cost']
              end;
    -- 리뷰 M1: 검증 · 고침 문구(meta.errors · warnings · fixes · dup_notes)에는 줄 합 · 소계 숫자가 실린다 — 뺀다.
    v_out := (v_out - 'grid')
             || jsonb_build_object('meta', coalesce(v_out -> 'meta', '{}'::jsonb) - 'errors' - 'warnings' - 'fixes' - 'dup_notes')
             || jsonb_build_object('masked', true,
                  'rows', coalesce((select jsonb_agg(e - v_keys)
                                      from jsonb_array_elements(case when jsonb_typeof(v_out -> 'rows') = 'array'
                                                                     then v_out -> 'rows' else '[]'::jsonb end) e), '[]'::jsonb));
  end if;
  return v_out;
end;
$fn$;
comment on function fin_upload_pending(uuid) is
  '0072 → 0080. 미리보기 대기 읽기(장부 쓰기 문). 0080: fin_material_line_ok 밖이면 칸 격자 없음 · 입고 · 재고 · OFFER · 모름은 줄 숫자 칸 · 검증 문구도 없이(masked).';

-- =====================================================================
-- 6절. 넣기 지킴 — 가려진 미리보기는 넣지 않는다
-- =====================================================================
/**
 * 입고 · 재고 · OFFER 미리보기 대기를 넣는 것(needs_review → applied)은 fin_material_line_ok인 사람만(옛 · 새 종류 둘 다 본다).
 * 리뷰 M5: «모름»을 다른 종류(판매 · 원장 …)로 넣는 것은 막지 않는다 — 모름 대기의 줄은 비어 있고, 칸 격자는 문 밖에 가지 않으므로
 * 문 밖 사람은 어차피 다시 읽지 못한다(앱이 «다시 올려 주세요»). 모름 → 원료 세 종류는 막는다.
 */
create or replace function fin_material_apply_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if old.status = 'needs_review' and new.status = 'applied'
     and (old.kind in ('purchase_in', 'inventory', 'import') or new.kind in ('purchase_in', 'inventory', 'import'))
     and not fin_material_line_ok(old.business_id, old.upload_id) then
    raise exception 'fin_material_hidden' using errcode = '42501',
      hint = '이 미리보기의 원료 숫자는 올린 사람(1시간) · 대표 · CFO · 원가 관리만 봅니다 — 파일을 다시 올려 주세요.';
  end if;
  return new;
end;
$fn$;
comment on function fin_material_apply_guard() is
  '0080. 원료 숫자가 가려진 사람은 입고 · 재고 · OFFER 미리보기를 넣지 못한다(옛 · 새 종류 — 숫자 없는 줄이 들어가지 않게).';

drop trigger if exists fin_material_apply_guard_trigger on fin_uploads;
create trigger fin_material_apply_guard_trigger
  before update of status on fin_uploads
  for each row execute function fin_material_apply_guard();

-- =====================================================================
-- 7절. 월별 손익의 원료별 줄 — 그룹 CFO 더함(계산은 그대로)
-- =====================================================================
create or replace function fin_pl_cost_viewer(p_business text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select fin_material_viewer(p_business);
$fn$;
comment on function fin_pl_cost_viewer(text) is
  '0075 → 0080. 월별 손익 원료별 줄을 보는 사람 = fin_material_viewer(대표 · 그룹 CFO · 원가 관리, 회사 범위).';

-- =====================================================================
-- 7-2절. 월별 손익 보여 주기 — 원료 1~2가지 달의 원재료 합계 칸(리뷰 I-A · 계산은 그대로)
-- =====================================================================
/**
 * 0075 본문 그대로 + 원가 권한 밖에서, 매입 · 기초 · 기말 중 하나라도 이루는 원료가 1~2가지면 셋 다 · 검산 칸을 비운다(withheld에 적는다).
 * calc.ts maskPlResult와 같다(check:monthly-pl이 SQL = TS를 본다).
 */
create or replace function fin_pl_mask(r jsonb, p_cost boolean) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $fn$
declare
  v_hide boolean;
  v_np int;   -- 매입이 있는 원료 수
  v_no int;   -- 기초 금액이 있는 원료 수
  v_nc int;   -- 기말 금액이 있는 원료 수
  v_b jsonb;
  v_w jsonb;
  v_basis jsonb;
  v_check jsonb;
  v_wh jsonb;
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
  v_basis := case when v_hide then (r -> 'basis') || jsonb_build_object('production_input', null, 'recon_diff', null) else r -> 'basis' end;
  v_check := r -> 'check';
  v_wh := case when v_hide then '["production_input", "recon_diff"]'::jsonb else '[]'::jsonb end;
  -- 0080 리뷰 I-A · I-B: 그 칸을 이루는 원료가 1~2가지면 원재료 매입 · 기초 · 기말 합계가 곧 원료 하나의 금액이다
  -- (0080 fin_material_totals와 같은 문턱 — 칸마다 따로 센다: 매입 원료 · 기초 원료 · 기말 원료). 앞 달 기말이 이 달 기초가 되면
  -- 기초 원료도 1~2가지로 같이 걸린다(M-h). 보여 주는 칸만 비운다 — 손익 계산(매출원가 · 영업이익)은 그대로.
  -- 검산 칸은 그 셋으로 거꾸로 풀리므로 하나라도 비우면 함께 비운다.
  select count(*) filter (where coalesce((x ->> 'purchase_amount')::numeric, 0) <> 0),
         count(*) filter (where coalesce((x ->> 'opening_amount')::numeric, 0) <> 0),
         count(*) filter (where coalesce((x ->> 'closing_amount')::numeric, 0) <> 0 or coalesce((x ->> 'closing_statement_amount')::numeric, 0) <> 0)
    into v_np, v_no, v_nc
    from jsonb_array_elements(coalesce(r -> 'materials', '[]'::jsonb)) x;
  -- 다시 리뷰 I-C: 셋 중 하나만 비우면 원료 사용액(= 기초 + 매입 − 기말, 보이는 칸)으로 거꾸로 풀린다 — 하나라도 걸리면 셋 다 비운다.
  if v_np between 1 and 2 or v_no between 1 and 2 or v_nc between 1 and 2 then
    v_basis := v_basis || jsonb_build_object('raw_opening', null, 'raw_purchases', null, 'raw_closing', null);
    v_check := coalesce(v_check, '{}'::jsonb) || jsonb_build_object('inventory_opening_total', null, 'inventory_closing_total', null,
                                                                    'check_value', null, 'diff_vs_new', null, 'purchase_vs_books_diff', null);
    v_wh := v_wh || '["raw_opening", "raw_purchases", "raw_closing", "check"]'::jsonb;
  end if;
  return r || jsonb_build_object(
    'materials', '[]'::jsonb,
    'blockers', v_b,
    'warnings', v_w,
    'basis', v_basis,
    'check', v_check,
    'withheld', v_wh);
end;
$fn$;

/** 0075 본문 그대로 + 원료 1~2가지 달의 원재료 기초 차이 · 다시 마감 차이(raw_closing)를 원가 권한 밖에 비운다. */
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
  v_m    jsonb;
  v_wh   jsonb;
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
  -- 0080 리뷰 I-A · I-B: fin_pl_mask가 원재료 기초 · 기말을 감춘 달은 기초 차이 · 다시 마감 차이(raw_closing)도 비운다.
  v_m := fin_pl_mask(v_res, v_cost);
  v_wh := coalesce(v_m -> 'withheld', '[]'::jsonb);
  -- 다시 리뷰 M-j: 앞 달(확정)의 원재료 기말이 감춰지는 달이면 기초 차이로 그 값이 풀린다 — 그때도 비운다.
  if v_diff is not null and (v_wh ? 'raw_closing'
       or coalesce(fin_pl_mask(v_prevf.totals || jsonb_build_object('materials', coalesce(v_prevf.detail -> 'materials', '[]'::jsonb)), v_cost) -> 'withheld', '[]'::jsonb) ? 'raw_closing') then
    v_diff := v_diff || jsonb_build_object('raw', null);
  end if;
  return jsonb_build_object(
    'business_id', p_business,
    'period', p_period,
    'view_status', v_view,
    'record', v_rec,
    'result', v_m,
    'stale', jsonb_build_object('inputs_changed', coalesce(v_live.status = 'final' and v_live.input_hash <> md5(v_in::text), false),
                                'opening_diff', v_diff, 'reclose_flags', v_flags),
    'provisional_diff', case when v_live.status = 'final' then v_live.totals -> 'provisional_diff' end,
    'changed_vs_prev_final', case when v_live.status = 'final' then
                               case when v_wh ? 'raw_closing' and jsonb_typeof(v_live.totals -> 'changed_vs_prev_final') = 'object'
                                    then (v_live.totals -> 'changed_vs_prev_final') || jsonb_build_object('raw_closing', null)
                                    else v_live.totals -> 'changed_vs_prev_final' end end,
    'adjustments', v_adj);
end;
$fn$;
comment on function fin_pl_month(text, text) is
  '0075 → 0080. 월별 손익 한 달 보기. 원료별 줄은 fin_pl_cost_viewer(대표 · CFO · 원가 관리)만 · 원료 1~2가지 달은 원재료 합계 · 차이 칸도 그 밖에 비운다.';

-- =====================================================================
-- 8절. 함수 권한 — public · anon에게서 이름으로 걷는다. 부르는 RPC만 authenticated.
-- =====================================================================
revoke all on function fin_material_viewer(text) from public, anon, authenticated;
revoke all on function fin_material_line_ok(text, uuid) from public, anon, authenticated;
revoke all on function fin_material_apply_guard() from public, anon, authenticated;
revoke all on function fin_pl_cost_viewer(text) from public, anon, authenticated;
revoke all on function fin_pl_mask(jsonb, boolean) from public, anon, authenticated;
revoke all on function fin_pl_month(text, text) from public, anon;
grant execute on function fin_pl_month(text, text) to authenticated;
revoke all on function fin_material_lines(text, text, text) from public, anon;
revoke all on function fin_material_totals(text, text) from public, anon;
revoke all on function fin_upload_pending(uuid) from public, anon;
revoke all on function fin_inventory_roll(text, text) from public, anon;
grant execute on function fin_inventory_roll(text, text) to authenticated;
grant execute on function fin_material_lines(text, text, text) to authenticated;
grant execute on function fin_material_totals(text, text) to authenticated;
grant execute on function fin_upload_pending(uuid) to authenticated;

commit;
