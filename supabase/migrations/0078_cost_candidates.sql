-- =====================================================================
-- Chairman OS — 0078_cost_candidates (PHASE 6 «원가 엔진 후보 승인 화면»)
-- 작성: 2026-10-13 · 자율 블록 PHASE 6 · 원문 docs/specs/2026-10-12-autonomous-block-phases.txt · 결정 docs/decisions/2026-10-12-autonomous.md
--
-- ■ 왜 ■ 0070 머리 주석: ①판매 · ②입고 · ⑦수입은 원가 엔진의 «후보»다 — fin_* 표까지만 넣고 cost_* 표에는 쓰지 않는다.
--   원가 관리가 승인해야 LOT · 판매가 된다. 그 승인 화면의 DB 쪽이다.
--
-- ■ 무엇 ■
--   1. cost_fin_candidate_decisions — 후보 한 줄(표 · 줄 번호)에 대한 사람의 결정(lot «LOT로 넣기» · ignore «무시» · later «나중에»), 이유 필수.
--      lot · ignore는 한 줄에 살아 있는 결정 하나(유일 색인). later는 여러 번 — 다음 결정이 앞의 later를 superseded로 덮는다(지우지 않는다).
--      표에 직접 쓰기 · 읽기 grant 없음 — 아래 RPC만.
--   2. cost_candidate_gate(회사) — 스위치 'cost_candidates'(0073 · 기본 대표만) AND 회사 범위 AND (대표 OR '/costing/<회사>' 쓰기 줄).
--      원가 관리 쓰기 줄이 있는 사람이 0명이면 대표만 지난다(따로 셀 필요가 없다 — 문이 곧 그 규칙).
--   3. cost_fin_candidates(회사, 끝난 것도) — 후보 목록. ② 입고 → 구매 LOT 후보 · ⑦ OFFER SHEET → Landed 부대비 후보 · ① 판매현황 → 판매 실적 후보.
--      칸 = 출처 · 줄 · 달 · 날짜 · 이름(원료 또는 제품) · 거래처 · 수량 · 금액(원) · 단가(원/kg, 1원) · 부대비(원) · OFFER 번호 · 마지막 결정.
--      **BOM · 원료 비율 · 제품별 투입은 없다**(②는 구매 한 줄 · ①은 판매 한 줄 · ⑦은 대금 · 부대비뿐).
--   4. cost_fin_candidate_decide(…) — 결정. «LOT로 넣기»는 원가 엔진의 원래 길을 그대로 쓴다(로직을 새로 쓰지 않는다):
--        ② → cost_purchase_lots insert(0061 트리거가 Landed 계산 · 이상치 · 감사) · source 'import' · source_ref 'fin_purchase_in_lines:<줄>'.
--        ⑦ → 고른 LOT를 무효(0061 cost_void_update — 이유 필수)하고 같은 값 + 기타 부대비(other_krw)에 부대비를 더한 새 LOT(0061 트리거).
--             생산에 쓴 LOT는 0064 cost_lot_void_guard가 막는다(그대로 오류).
--        ① → 0067 sale_record(영업 입력 문 · 0시 등급 · 감사 그대로).
--      넣기는 원가 관리 문 + **원래 입력 문**(② · ⑦ 구매 쓰기 cost_can('purchasing', 회사, true) · ① sale_record 안의 영업 쓰기)을 둘 다 지나야 한다.
--      결정마다 감사(audit_log — 값 없이 출처 · 줄 · 결정 · 이유 · 만든 LOT/판매 id).
--
-- 0035 규칙: 0001~0077을 고치지 않는다 · FORCE를 새로 걸거나 끄지 않는다. 새 정책 없음(표는 RPC만). 함수는 public · anon 회수 · authenticated에만.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 결정 표
-- =====================================================================
create table cost_fin_candidate_decisions (
  decision_id   uuid primary key default gen_random_uuid(),
  business_id   text not null references businesses(business_id) on delete restrict,
  source_table  text not null check (source_table in ('fin_purchase_in_lines', 'fin_import_lines', 'fin_sales_lines')),
  line_id       bigint not null,
  action        text not null check (action in ('lot', 'ignore', 'later')),
  reason        text not null check (length(btrim(reason)) between 1 and 300),
  target_ref    text check (target_ref is null or length(target_ref) <= 80),   -- 만든 LOT id · 판매 id
  decided_by    uuid not null default auth.uid(),
  decided_at    timestamptz not null default now(),
  superseded_at timestamptz,
  constraint cost_fin_candidate_target check ((action = 'lot') = (target_ref is not null))
);
create unique index cost_fin_candidate_one_final on cost_fin_candidate_decisions (source_table, line_id)
  where action in ('lot', 'ignore') and superseded_at is null;
create index cost_fin_candidate_by_biz on cost_fin_candidate_decisions (business_id, source_table, line_id);
comment on table cost_fin_candidate_decisions is
  '0078. 자료 올리기 후보(② 입고 · ⑦ OFFER · ① 판매) → 원가 엔진 결정(LOT로 넣기 · 무시 · 나중에). 이유 필수 · 감사. 지우지 않는다. 쓰기 · 읽기는 RPC만.';
alter table cost_fin_candidate_decisions enable row level security;
revoke all on table cost_fin_candidate_decisions from public, anon, authenticated;

-- =====================================================================
-- 2절. 문
-- =====================================================================
create or replace function cost_candidate_gate(p_business text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p_business is not null
     and coalesce(feature_on('cost_candidates', p_business), false)
     and is_active()
     and has_business(p_business)
     and (coalesce(auth_role()::text, '') = 'Chairman' or cost_grant('costing', p_business, true));
$fn$;
comment on function cost_candidate_gate(text) is
  '0078. 원가 후보 승인 문 — 스위치 cost_candidates AND 회사 범위 AND (대표 OR /costing/<회사> 쓰기 줄). 원가 관리 쓰기 줄이 0명이면 대표만.';

-- =====================================================================
-- 3절. 후보 목록
-- =====================================================================
create or replace function cost_fin_candidates(p_business text, p_include_done boolean default false)
returns table (source_table text, kind text, line_id bigint, period text, tx_date date, name text, counterparty text,
               qty numeric, amount_krw numeric, unit_krw_per_kg numeric, extra_krw numeric, ref_no text,
               last_action text, last_reason text, last_at timestamptz, target_ref text)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
begin
  if not coalesce(feature_on('cost_candidates', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if not cost_candidate_gate(p_business) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  with c as (
    select 'fin_purchase_in_lines'::text as src, 'purchase_lot'::text as kind, p.line_id, p.period, p.tx_date,
           left(coalesce(p.material, p.item_or_account), 200) as name, left(coalesce(p.supplier, p.counterparty), 200) as cp,
           p.qty, p.amount as amt, case when p.qty > 0 and p.amount > 0 then round(p.amount / p.qty) end as unit,
           null::numeric as extra, null::text as ref
      from fin_purchase_in_lines p where p.business_id = p_business and p.voided_at is null
    union all
    select 'fin_import_lines', 'landed', i.line_id, i.period, null::date,
           left(i.material, 200), left(i.supplier, 200), null::numeric, i.amount_krw, null::numeric, i.extra_cost, left(i.ref_no, 80)
      from fin_import_lines i where i.business_id = p_business and i.voided_at is null and coalesce(i.extra_cost, 0) > 0
    union all
    select 'fin_sales_lines', 'sale', s.line_id, s.period, s.tx_date,
           left(s.product, 200), left(coalesce(s.customer, s.counterparty), 200),
           s.qty, s.amount, case when s.qty > 0 and coalesce(s.unit_price, s.amount / nullif(s.qty, 0)) > 0
                                 then round(coalesce(s.unit_price, s.amount / s.qty)) end, null::numeric, null::text
      from fin_sales_lines s where s.business_id = p_business and s.voided_at is null
  ),
  d as (
    select distinct on (x.source_table, x.line_id) x.source_table, x.line_id, x.action, x.reason, x.decided_at, x.target_ref
      from cost_fin_candidate_decisions x
     where x.business_id = p_business and x.superseded_at is null
     order by x.source_table, x.line_id, x.decided_at desc
  )
  select c.src, c.kind, c.line_id, c.period, c.tx_date, c.name, c.cp, c.qty, c.amt, c.unit, c.extra, c.ref,
         d.action, d.reason, d.decided_at, d.target_ref
    from c left join d on d.source_table = c.src and d.line_id = c.line_id
   where p_include_done or d.action is null or d.action = 'later'
   order by c.period desc, c.src, c.line_id
   limit 500;
end;
$fn$;

-- =====================================================================
-- 4절. 결정 — LOT로 넣기 · 무시 · 나중에
-- =====================================================================
create or replace function cost_fin_candidate_decide(
  p_business text, p_source text, p_line bigint, p_action text, p_reason text,
  p_material text default null, p_supplier text default null, p_on date default null,
  p_lot text default null, p_product text default null
) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_target text;
  v_id uuid;
  p record;
  i record;
  s record;
  o cost_purchase_lots%rowtype;
begin
  if not coalesce(feature_on('cost_candidates', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if not cost_candidate_gate(p_business) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_source not in ('fin_purchase_in_lines', 'fin_import_lines', 'fin_sales_lines') or p_line is null
     or p_action not in ('lot', 'ignore', 'later') then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  if length(v_reason) not between 1 and 300 then
    raise exception 'cost_candidate_reason' using errcode = '22023';
  end if;
  -- 살아 있는 그 회사 줄인가(없으면 «없음» — 다른 회사 줄 탐침 막기).
  perform pg_advisory_xact_lock(hashtext('cost_fin_candidate:' || p_source || ':' || p_line));
  if not exists (select 1 from cost_fin_candidates_line_ok(p_source, p_line, p_business) x where x) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from cost_fin_candidate_decisions x
              where x.source_table = p_source and x.line_id = p_line and x.action in ('lot', 'ignore') and x.superseded_at is null) then
    raise exception 'cost_candidate_done' using errcode = '23505';
  end if;

  if p_action = 'lot' then
    if p_source = 'fin_purchase_in_lines' then
      if not cost_can('purchasing', p_business, true) then raise exception 'cost_not_found' using errcode = 'P0002'; end if;
      select * into p from fin_purchase_in_lines where line_id = p_line;
      if coalesce(p.qty, 0) <= 0 or coalesce(p.amount, 0) <= 0 or p_material is null or p_supplier is null then
        raise exception 'cost_candidate_invalid' using errcode = '22023';
      end if;
      insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, currency, source, source_ref, note)
      values (p_business, p_material, p_supplier,
              coalesce(p_on, p.tx_date, (to_date(p.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date),
              p.qty, p.amount / p.qty, 'KRW', 'import', 'fin_purchase_in_lines:' || p_line, '자료 올리기 ② 입고 후보(0078)')
      returning lot_id into v_target;
    elsif p_source = 'fin_import_lines' then
      if not cost_can('purchasing', p_business, true) then raise exception 'cost_not_found' using errcode = 'P0002'; end if;
      select * into i from fin_import_lines where line_id = p_line;
      select * into o from cost_purchase_lots l where l.lot_id = p_lot and l.business_id = p_business and l.voided_at is null for update;
      if not found or coalesce(i.extra_cost, 0) <= 0 then
        raise exception 'cost_candidate_invalid' using errcode = '22023';
      end if;
      -- 0061: LOT는 고치지 않는다 — 무효 + 새 줄. 무효 이유에 후보 줄을 적는다(0064 void guard가 생산에 쓴 LOT를 막는다).
      update cost_purchase_lots set void_reason = left('Landed 부대비 후보 반영(fin_import_lines:' || p_line || ') — ' || v_reason, 300)
       where lot_id = o.lot_id;
      insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, ordered_on, supplier_lot_no, qty_kg, unit_price,
                                      currency, fx_rate, freight_krw, duty_krw, other_krw, source, source_ref, note)
      values (o.business_id, o.material_id, o.supplier_id, o.received_on, o.ordered_on, o.supplier_lot_no, o.qty_kg, o.unit_price,
              o.currency, o.fx_rate, o.freight_krw, o.duty_krw, o.other_krw + i.extra_cost,
              -- 리뷰 고침 I4: 결재에서 온 LOT는 출처(approval · 결재 id)를 그대로 두고 ⑦ 줄은 메모에 적는다.
              case when o.source = 'approval' then 'approval' else 'import' end,
              case when o.source = 'approval' then o.source_ref else 'fin_import_lines:' || p_line end,
              left('자료 올리기 ⑦ OFFER 부대비 후보(0078) · fin_import_lines:' || p_line || ' · 앞 LOT ' || o.lot_id, 500))
      returning lot_id into v_target;
    else
      select * into s from fin_sales_lines where line_id = p_line;
      if p_product is null or coalesce(s.qty, 0) <= 0
         or not exists (select 1 from cost_products cp where cp.product_id = p_product and cp.business_id = p_business) then   -- 리뷰 고침 I3
        raise exception 'cost_candidate_invalid' using errcode = '22023';
      end if;
      -- 0067 sale_record가 영업 쓰기 문 · 날짜 · 값 검사 · 0시 등급 · 감사를 한다(여기서 다시 쓰지 않는다).
      v_target := sale_record(p_product, coalesce(p_on, s.tx_date), coalesce(nullif(btrim(left(s.counterparty, 100)), ''), '자료 올리기'),
                              coalesce(nullif(btrim(left(coalesce(s.customer, s.counterparty), 200)), ''), '미기재'), s.qty,
                              round(coalesce(s.unit_price, s.amount / s.qty)), 'KRW');
    end if;
  end if;

  update cost_fin_candidate_decisions set superseded_at = now()
   where source_table = p_source and line_id = p_line and action = 'later' and superseded_at is null;
  insert into cost_fin_candidate_decisions (business_id, source_table, line_id, action, reason, target_ref)
  values (p_business, p_source, p_line, p_action, v_reason, v_target)
  returning decision_id into v_id;
  perform fin_audit('create', 'cost_fin_candidate_decisions', v_id::text, p_business, null,
                    jsonb_build_object('source', p_source, 'line', p_line, 'action', p_action, 'target', v_target, 'reason', v_reason),
                    '원가 후보 결정(0078)');
  return coalesce(v_target, v_id::text);
end;
$fn$;

/** 그 줄이 그 회사의 살아 있는 후보 줄인가(내부용). */
create or replace function cost_fin_candidates_line_ok(p_source text, p_line bigint, p_business text) returns setof boolean
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if p_source not in ('fin_purchase_in_lines', 'fin_import_lines', 'fin_sales_lines') then
    return next false; return;
  end if;
  return query execute format('select exists (select 1 from %I where line_id = $1 and business_id = $2 and voided_at is null)', p_source)
    using p_line, p_business;
end;
$fn$;

-- =====================================================================
-- 4-2절. 지킴 트리거(리뷰 고침 I5) — 0074를 고치지 않고 따로 더한다.
--   후보 줄이 살아 있는 'lot' 결정(LOT · 판매로 넣음)에 쓰인 올리기는 바꾸기 · 되돌리기 거부(원가 쪽을 먼저 무효로).
-- =====================================================================
create or replace function cost_candidate_upload_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if old.status = 'applied' and new.status in ('replaced', 'reverted')
     and exists (select 1 from cost_fin_candidate_decisions d
                  where d.action = 'lot' and d.superseded_at is null and d.business_id = old.business_id
                    -- 다시 리뷰 I-B: 만든 LOT · 판매가 아직 살아 있을 때만 막는다(원가 쪽을 무효로 하면 풀린다).
                    and ((d.source_table = 'fin_sales_lines' and exists (select 1 from cost_sales s where s.sale_id = d.target_ref and s.voided_at is null))
                      -- LOT는 ⑦ 부대비로 «무효 + 새 줄»이 될 수 있다 — 메모 «앞 LOT <id>»의 사슬을 따라 살아 있는 줄이 하나라도 있으면 막는다.
                      or (d.source_table <> 'fin_sales_lines' and exists (
                            with recursive chain(id, depth) as (
                              select d.target_ref, 0
                              union all
                              select l.lot_id, c.depth + 1 from cost_purchase_lots l join chain c
                                on l.business_id = d.business_id and l.note like '%앞 LOT ' || c.id and c.depth < 20)
                            select 1 from chain c join cost_purchase_lots l on l.lot_id = c.id where l.voided_at is null)))
                    and ((d.source_table = 'fin_purchase_in_lines' and exists (select 1 from fin_purchase_in_lines x where x.line_id = d.line_id and x.upload_id = old.upload_id))
                      or (d.source_table = 'fin_import_lines' and exists (select 1 from fin_import_lines x where x.line_id = d.line_id and x.upload_id = old.upload_id))
                      or (d.source_table = 'fin_sales_lines' and exists (select 1 from fin_sales_lines x where x.line_id = d.line_id and x.upload_id = old.upload_id)))) then
    raise exception 'cost_candidate_live' using errcode = '23514', hint = '원가 LOT · 판매로 넣은 줄이 있습니다 — 그쪽을 먼저 무효로 하세요.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists cost_candidate_upload_guard_trigger on fin_uploads;
create trigger cost_candidate_upload_guard_trigger before update of status on fin_uploads
  for each row execute function cost_candidate_upload_guard();

-- =====================================================================
-- 5절. 함수 권한
-- =====================================================================
revoke all on function cost_candidate_gate(text) from public, anon;
revoke all on function cost_fin_candidates(text, boolean) from public, anon;
revoke all on function cost_fin_candidate_decide(text, text, bigint, text, text, text, text, date, text, text) from public, anon;
revoke all on function cost_fin_candidates_line_ok(text, bigint, text) from public, anon, authenticated;
revoke all on function cost_candidate_upload_guard() from public, anon, authenticated;
grant execute on function cost_candidate_gate(text) to authenticated;
grant execute on function cost_fin_candidates(text, boolean) to authenticated;
grant execute on function cost_fin_candidate_decide(text, text, bigint, text, text, text, text, date, text, text) to authenticated;

commit;
