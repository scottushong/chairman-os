-- =====================================================================
-- Chairman OS — 0067_cost_sales (판매 실적 · 실제 원가 · 견적 마진 vs 실제 마진)
-- 작성: 2026-10-10 · 설계서 docs/superpowers/specs/cost-engine.md 10절 · 11절 · 20절
--
-- ■ 회장 지시 ■
--   · 판매 실적 = 출고일 · 고객 · 제품 · kg · 실제 판매가(원/kg, 1원 단위) · 통화 · 확정 견적 연결(선택) · 생산 LOT 연결(선택).
--     고치지 않는다 — 무효 + 새 줄(대체). 모든 쓰기 감사.
--   · 실제 원가 = 생산 LOT가 이어져 있으면 그 LOT의 Actual(투입 landed ÷ 산출 kg) + 출고일 비용, 없으면 출고일 Current 총원가.
--     원래 값으로 끝까지 계산하고 나가는 칸만 1원(대표 외 — cost_secret.shown). 합산(일 → 주 → 월 → 분기 → 년)도 원래 값끼리 더한 뒤 1원.
--   · 견적 마진 vs 실제 마진은 대표 · 원가 관리(cost_margins). 호출마다 문(cost_gate_biz — 한도 · 감사 · 겸직 거부) · 하루 20번.
--   · 영업은 본인 · 팀 실적의 판매가 · kg · 등급만. 원가는 기록 순간 «오늘 0시 기준» 총원가(영업 화면 값 그대로 — 새로 아는 것 없음)뿐,
--     실제 원가 금액 · 실제 마진은 보이지 않는다(역산 위험 — 설계서 16절과 같은 원리: 실제 원가는 실제 배합 · LOT 가격의 함수).
--
-- ■ 막는 길 ■
--   · 위조: cost_sales 표에 insert · update · delete 권한 없음 — sale_record · sale_void(정의자)만. 스냅숏은 함수가 원가 엔진 문을 지나 계산.
--     얼림 트리거 — 무효 칸 셋이 비어 있다가 한 번 채워지는 것만.
--   · 다른 회사: 제품 · 견적 · 생산 LOT의 회사 = 판매의 회사(복합 FK + 함수 확인).
--   · 영업 오라클: 판매 기록 한 줄 = 문 한 건(200건 · 감사). 대표 외 판매가가 0시 총원가 절반 미만이면 등급 'too_low' · 마진 null(0066 I3 · N1 —
--     문 뒤에서 raise하지 않는다, 기록은 남는다 — 실제 출고는 거부하지 않는다).
--   · 원가 관리: 고객 · 판매가는 보지만 만든 사람은 이름 없이. 원료 · BOM · 투입 kg 없음(Actual은 1원 한 값 — 0064 cost_prod_actual과 같은 노출).
--   · 정책은 늘 `to authenticated`(0060 — Supabase는 함수 execute도 anon에 이름으로 준다).
--
-- 0035 규칙: force를 걸지 않는다. 0001~0066을 고치지 않는다.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 판매 실적 표
-- =====================================================================
create table cost_sales (
  sale_id          text primary key default ('sl_' || replace(gen_random_uuid()::text, '-', '')),
  business_id      text not null references businesses(business_id),
  shipped_on       date not null,
  customer_name    text not null check (length(btrim(customer_name)) between 1 and 100),
  customer_company text not null check (length(btrim(customer_company)) between 1 and 200),
  product_id       text not null,
  product_name     text not null,
  kg               numeric not null check (kg > 0 and kg <= 1e9),
  price_krw_per_kg numeric not null check (price_krw_per_kg > 0 and price_krw_per_kg <= 1e9 and price_krw_per_kg = trunc(price_krw_per_kg)),
  currency         text not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  fx_rate          numeric not null default 1 check (fx_rate > 0),   -- 출고일 통화 → 원(KRW = 1). 판매가는 늘 원/kg
  quote_id         text references quotes(quote_id),
  prod_lot_id      text references cost_prod_lots(prod_lot_id),
  replaces_id      text references cost_sales(sale_id),            -- 무효로 만든 앞 줄(대체)
  -- 기록 순간 영업 스냅숏(영업 = 오늘 0시 기준 · 1원, 대표 = 즉시 원래 값). 실제 원가가 아니다.
  snap_as_of       date not null,
  snap_basis       text not null check (snap_basis in ('midnight', 'now')),
  snap_total_krw_per_kg numeric,                                   -- 계산 안 됨 · too_low면 null
  snap_margin_pct  numeric,
  snap_grade       text not null check (snap_grade in ('green', 'yellow', 'red', 'too_low', 'unknown')),
  created_by       uuid not null,                                  -- 실적 주인(대표가 대체해도 앞 줄 주인 그대로 — 리뷰 I3)
  entered_by       uuid not null,                                  -- 실제로 넣은 사람
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid,
  void_reason      text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  foreign key (product_id, business_id) references cost_products (product_id, business_id),
  constraint cost_sales_void_shape check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)),
  -- 등급이 green · yellow · red면 총원가 · 마진 % 둘 다 있고, too_low(0066 I3 하한) · unknown(계산 안 됨)이면 둘 다 없다.
  constraint cost_sales_snap_shape check ((snap_grade in ('too_low', 'unknown')) = (snap_total_krw_per_kg is null)
                                          and (snap_total_krw_per_kg is null) = (snap_margin_pct is null))
);
create index cost_sales_by_biz on cost_sales (business_id, shipped_on desc) where voided_at is null;
create index cost_sales_by_creator on cost_sales (created_by, shipped_on desc);
create unique index cost_sales_one_replace on cost_sales (replaces_id) where replaces_id is not null;
comment on table cost_sales is '0067. 판매 실적(출고). 고치지 않는다 — 무효 + 새 줄. 쓰기는 sale_* 정의자 함수만. 스냅숏은 기록 순간 영업 화면 값(실제 원가 아님).';

alter table cost_sales enable row level security;
revoke all on table cost_sales from public, anon, authenticated;
grant select on table cost_sales to authenticated;

-- 본인 · 같은 회사 영업 팀장(subtree) · 대표. 0066 quotes_read와 같은 겸직 거부 · 지금 영업 줄.
-- 원가 관리는 표가 아니라 cost_margins(문 · 감사)로만.
create policy cost_sales_read on cost_sales for select to authenticated
  using (is_active() and has_business(business_id) and (
           auth_role()::text = 'Chairman'
           or (cost_grant('sales', business_id)
               and not cost_grant('purchasing', business_id, true)
               and (cost_grant('costing', business_id) or not (cost_grant('purchasing', business_id) or cost_grant('production', business_id)))
               and (created_by = auth.uid()
                    or (auth_role()::text = 'TeamLead' and in_my_subtree(created_by))))));

-- 얼림 — 무효 칸 셋이 비어 있다가 한 번 채워지는 것만. 소유자 경로(함수)도 이 트리거를 지난다. delete는 권한이 없고 트리거로도 막는다.
create or replace function cost_sales_frozen() returns trigger
language plpgsql set search_path = public, pg_temp as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'sale_frozen' using errcode = '42501';
  end if;
  if old.voided_at is not null
     or (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason') is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'sale_frozen' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke all on function cost_sales_frozen() from public, anon, authenticated;
create trigger cost_sales_frozen before update or delete on cost_sales for each row execute function cost_sales_frozen();

-- =====================================================================
-- 2절. 함수 — 쓰기
-- =====================================================================

/** 보이는 판매(정책과 같은 조건). */
create or replace function sale_visible(p_sale text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from cost_sales s
                  where s.sale_id = p_sale and is_active() and has_business(s.business_id)
                    and (auth_role()::text = 'Chairman'
                         or (cost_grant('sales', s.business_id)
                             and not cost_grant('purchasing', s.business_id, true)
                             and (cost_grant('costing', s.business_id) or not (cost_grant('purchasing', s.business_id) or cost_grant('production', s.business_id)))
                             and (s.created_by = auth.uid()
                                  or (auth_role()::text = 'TeamLead' and in_my_subtree(s.created_by))))));
$fn$;

/**
 * 판매 기록(또는 대체). 영업 쓰기 줄(그 회사) · 대표. 원가 엔진 문(cost_gate)을 지난다 — 한 줄 = 200건 중 한 건 · 감사 · 겸직 거부 · 영업 0시 기준.
 * p_quote: 확정 견적(같은 회사 · 같은 제품 · 내가 읽을 수 있는 견적). p_prod_lot: 같은 회사 · 같은 제품 · 무효 아닌 생산 LOT.
 * p_replaces: 대체할 앞 줄(내가 만든 · 무효 아닌 줄 — 대표는 아무 줄) — 같은 트랜잭션에서 무효(p_reason).
 */
create or replace function sale_record(p_product text, p_shipped_on date, p_customer_name text, p_customer_company text, p_kg numeric,
                                       p_price_krw_per_kg numeric, p_currency text, p_quote text default null, p_prod_lot text default null,
                                       p_replaces text default null, p_reason text default null)
returns text
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  g record;
  r record;
  v_biz text;
  v_name text;
  v_fx numeric;
  v_pct numeric;
  v_grade text;
  v_total numeric;
  v_basis text;
  v_today date := cost_today();
  v_id text := 'sl_' || replace(gen_random_uuid()::text, '-', '');
  v_old cost_sales%rowtype;
begin
  select p.business_id, p.name into v_biz, v_name from cost_products p where p.product_id = p_product;
  if v_biz is null or not cost_can('sales', v_biz, true) then
    raise exception 'sale_not_found' using errcode = 'P0002';
  end if;
  if p_kg is null or p_kg <= 0 or p_kg > 1e9
     or p_price_krw_per_kg is null or p_price_krw_per_kg <= 0 or p_price_krw_per_kg > 1e9 or p_price_krw_per_kg <> trunc(p_price_krw_per_kg)
     or p_shipped_on is null or p_shipped_on > v_today or p_shipped_on < v_today - 400
     or length(btrim(coalesce(p_customer_name, ''))) not between 1 and 100
     or length(btrim(coalesce(p_customer_company, ''))) not between 1 and 200
     or coalesce(p_currency, '') !~ '^[A-Z]{3}$' then
    raise exception 'sale_invalid' using errcode = '22023';
  end if;
  if p_quote is not null and not exists (
       select 1 from quotes q where q.quote_id = p_quote and q.business_id = v_biz and q.product_id = p_product and q.status = 'confirmed')
     or (p_quote is not null and not quote_visible(p_quote)) then
    raise exception 'sale_quote_invalid' using errcode = '22023';
  end if;
  if p_prod_lot is not null and not exists (
       select 1 from cost_prod_lots pl where pl.prod_lot_id = p_prod_lot and pl.business_id = v_biz and pl.product_id = p_product
                                         and pl.voided_at is null and pl.produced_on <= p_shipped_on) then
    raise exception 'sale_lot_invalid' using errcode = '22023';
  end if;
  if p_replaces is not null then
    select * into v_old from cost_sales s where s.sale_id = p_replaces for update;
    if not found or v_old.business_id <> v_biz or v_old.voided_at is not null or not sale_visible(p_replaces)
       or not (auth_role()::text = 'Chairman' or v_old.created_by = auth.uid()) then
      raise exception 'sale_not_found' using errcode = 'P0002';
    end if;
    if length(btrim(coalesce(p_reason, ''))) not between 1 and 300 then
      raise exception 'sale_invalid' using errcode = '22023';
    end if;
  end if;
  v_fx := case when p_currency = 'KRW' then 1 else cost_fx(p_currency, p_shipped_on, null) end;

  -- 영업 스냅숏 — 견적 · 제시가 확인과 같은 문 · 같은 계산(영업 = 오늘 0시 기준). 실제 원가는 여기서 만들지 않는다.
  select * into g from cost_secret.cost_gate(p_product, 'sale', null);
  v_basis := case when coalesce(current_setting('cost.known_at', true), '') = '' then 'now' else 'midnight' end;
  select * into r from cost_secret.sales_row(p_product, g.business_id, g.as_of, g.chairman,
    cost_secret.business_complete(g.business_id, 'market', g.as_of) and cost_secret.business_complete(g.business_id, 'current', g.as_of),
    false);
  if r.total_raw is null then
    v_grade := 'unknown';
  elsif not g.chairman and p_price_krw_per_kg * 2 < r.total_krw_per_kg then
    v_grade := 'too_low';   -- 0066 I3 하한 — 마진을 주지 않는다(기록은 남긴다)
  else
    v_pct := (p_price_krw_per_kg - r.total_raw) / p_price_krw_per_kg * 100;
    v_grade := cost_grade(v_pct);
    v_total := r.total_krw_per_kg;
  end if;

  -- 리뷰 I3: 대표가 남의 줄을 대체하면 주인은 앞 줄 주인 그대로, 스냅숏은 'unknown' — 대표의 즉시 원래 값이 영업 화면으로 새지 않게.
  if v_old.sale_id is not null and v_old.created_by <> auth.uid() then
    v_grade := 'unknown';
    v_total := null;
  end if;

  if v_old.sale_id is not null then
    update cost_sales set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where sale_id = v_old.sale_id;
    insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
    values ('update', 'cost_sales', v_old.sale_id, v_biz, auth.uid(), auth_role()::text, null,
            jsonb_build_object('replaced_by', v_id, 'reason', btrim(p_reason)), '판매 대체 — 무효(0067)');
  end if;
  insert into cost_sales (sale_id, business_id, shipped_on, customer_name, customer_company, product_id, product_name, kg, price_krw_per_kg,
                          currency, fx_rate, quote_id, prod_lot_id, replaces_id, snap_as_of, snap_basis, snap_total_krw_per_kg,
                          snap_margin_pct, snap_grade, created_by, entered_by)
  values (v_id, v_biz, p_shipped_on, btrim(p_customer_name), btrim(p_customer_company), p_product, v_name, p_kg, p_price_krw_per_kg,
          p_currency, v_fx, p_quote, p_prod_lot, p_replaces, g.as_of, v_basis, v_total,
          case when v_total is null then null else round(v_pct, 1) end, v_grade, coalesce(v_old.created_by, auth.uid()), auth.uid());
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('create', 'cost_sales', v_id, v_biz, auth.uid(), auth_role()::text, null,
          jsonb_build_object('shipped_on', p_shipped_on, 'kg', p_kg, 'price', p_price_krw_per_kg, 'quote', p_quote, 'lot', p_prod_lot,
                             'replaces', p_replaces, 'grade', v_grade),
          '판매 기록(0067)');
  return v_id;
end;
$fn$;

/** 판매 무효(대체 없이 — 잘못 넣은 줄). 만든 사람(영업 쓰기 줄이 아직 있을 때) · 대표. */
create or replace function sale_void(p_sale text, p_reason text)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  s cost_sales%rowtype;
begin
  select * into s from cost_sales where sale_id = p_sale for update;
  if not found or not sale_visible(p_sale)
     or not (auth_role()::text = 'Chairman' or (s.created_by = auth.uid() and cost_can('sales', s.business_id, true))) then
    raise exception 'sale_not_found' using errcode = 'P0002';
  end if;
  if s.voided_at is not null then
    raise exception 'sale_frozen' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 1 and 300 then
    raise exception 'sale_invalid' using errcode = '22023';
  end if;
  update cost_sales set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where sale_id = p_sale;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'cost_sales', p_sale, s.business_id, auth.uid(), auth_role()::text, null,
          jsonb_build_object('reason', btrim(p_reason)), '판매 무효(0067)');
end;
$fn$;

/** 판매 기록 화면의 생산 LOT 고르기 — 그 제품의 무효 아닌 생산 LOT 번호 · 생산일만(kg · 원가 · 투입 없음). 영업 쓰기 줄 · 대표. */
create or replace function sale_lot_options(p_product text)
returns table (prod_lot_id text, produced_on date)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_biz text;
begin
  select p.business_id into v_biz from cost_products p where p.product_id = p_product;
  if v_biz is null or not cost_can('sales', v_biz, true) then
    raise exception 'sale_not_found' using errcode = 'P0002';
  end if;
  return query select pl.prod_lot_id, pl.produced_on from cost_prod_lots pl
   where pl.product_id = p_product and pl.business_id = v_biz and pl.voided_at is null
   order by pl.produced_on desc, pl.prod_lot_id limit 100;
end;
$fn$;

-- =====================================================================
-- 3절. 실제 원가 · 견적 마진 vs 실제 마진(대표 · 원가 관리)
-- =====================================================================

/**
 * 판매 한 줄의 실제 원가 원래 값(원/kg) — 내부용(문 통과 뒤에만). 생산 LOT가 있으면 Actual(투입 금액 ÷ 산출 kg) + 출고일 비용,
 * 없으면 출고일 Current 원료비 + 출고일 비용. 비용 줄은 있는데 배부를 못 하면 null(0065 리뷰 I1 — 원료비만으로 마진을 내지 않는다).
 * p_complete: 대표 외 Current는 그 회사 원료가 다 계산될 때만(0062 리뷰 2회차 I1). 즉시 값(원가 관리 · 대표의 문은 known_at을 비운다).
 */
create or replace function cost_secret.sale_actual(p_business text, p_product text, p_on date, p_prod_lot text, p_complete boolean,
                                                   out source text, out total_raw numeric)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_mat numeric;
  o record;
begin
  if p_prod_lot is not null then
    source := 'actual';
    select sum(i.qty_kg * l.landed_krw_per_kg) / max(pl.output_kg) into v_mat
      from cost_prod_lots pl
      join cost_prod_inputs i on i.prod_lot_id = pl.prod_lot_id and i.voided_at is null
      join cost_purchase_lots l on l.lot_id = i.lot_id
     where pl.prod_lot_id = p_prod_lot and pl.voided_at is null;
  else
    source := 'current';
    if p_complete then
      select x.total into v_mat from cost_secret.material_cost(p_product, 'current', p_on) x;
    end if;
  end if;
  select * into o from cost_secret.overhead(p_business, p_product, p_on);
  total_raw := case when v_mat is null then null when coalesce(o.ready, false) then v_mat + o.total
                    when coalesce(o.has_lines, false) then null else v_mat end;
end;
$fn$;
revoke all on function cost_secret.sale_actual(text, text, date, text, boolean) from public, anon, authenticated;

/**
 * 대표 · 원가 관리: 견적 마진 vs 실제 마진. p_by = 'deal'(판매 한 줄씩) · 'product' · 'customer' · 'total'.
 * p_grain = 'day' · 'week'(ISO 주 월요일) · 'month' · 'quarter' · 'year' — 'deal'이면 무시. 기간은 출고일 [p_from, p_to](최대 3년).
 * 합산은 원래 값끼리(매출 = Σ kg × 판매가, 원가 = Σ kg × 실제 원가 원래 값) 더한 뒤 1원(대표 외). 마진 % = 원래 값 비율(소수 1자리).
 * 실제 원가가 계산 안 된 판매는 합산의 원가 · 마진에서 빠지고 n_uncomputed로 센다(매출에는 들어간다 — 화면이 «원가 없음 n건»).
 * 견적 마진은 견적이 이어진 판매만(그 판매 kg × (견적 제시가 − 견적 순간 총원가 원래 값)).
 * 호출마다 문 한 건(cost_gate_biz — 'margins:<회사>' 하루 20번 · 감사 · 겸직 거부). 영업 · 구매 · 생산 = cost_not_found.
 */
create or replace function cost_margins(p_business text, p_from date, p_to date, p_grain text default 'month', p_by text default 'product')
returns table (period_start date, key text, label text, n_sales int, n_uncomputed int, kg numeric, revenue_krw numeric,
               cost_krw numeric, margin_krw numeric, margin_pct numeric, grade text,
               quote_kg numeric, quote_margin_krw numeric, quote_margin_pct numeric,
               sale_id text, shipped_on date, customer text, product_name text, price_krw_per_kg numeric, currency text,
               cost_source text, cost_krw_per_kg numeric, quote_id text, quote_price_krw_per_kg numeric, quote_cost_krw_per_kg numeric)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  g record;
  v_complete boolean;
begin
  if not (coalesce(auth_role()::text, '') = 'Chairman' or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 1100
     or coalesce(p_grain, '') not in ('day', 'week', 'month', 'quarter', 'year')
     or coalesce(p_by, '') not in ('deal', 'product', 'customer', 'total') then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  -- 문 — 대표는 즉시 원래 값, 원가 관리는 즉시 · 1원 · 하루 20번(목록과 같은 셈 — 키가 달라 따로 센다) · 호출마다 감사.
  select * into g from cost_secret.cost_gate_biz(p_business, 'margins:' || p_business, 'costing_list', null);
  v_complete := g.chairman or cost_secret.business_complete(p_business, 'current', g.as_of);

  return query
  with s as (
    select x.*, a.source, a.total_raw as act_raw, qr.total_raw_basis as q_raw, q.price_krw_per_kg as q_price
      from cost_sales x
      left join quotes q on q.quote_id = x.quote_id
      left join cost_secret.quote_raw qr on qr.quote_id = x.quote_id
      cross join lateral cost_secret.sale_actual(x.business_id, x.product_id, x.shipped_on, x.prod_lot_id,
                                                 g.chairman or (v_complete and cost_secret.business_complete(x.business_id, 'current', x.shipped_on))) a
     where x.business_id = p_business and x.voided_at is null and x.shipped_on between p_from and p_to
  ),
  b as (
    -- date → timestamp(시간대 없음)로 자른다 — timestamptz로 가면 세션 TimeZone에 따라 날이 밀린다. week = ISO 주 월요일.
    select case when p_by = 'deal' then s.shipped_on else date_trunc(p_grain, s.shipped_on::timestamp)::date end as ps,
           case p_by when 'deal' then s.sale_id when 'product' then s.product_id when 'customer' then s.customer_company else 'total' end as k,
           case p_by when 'deal' then s.customer_company || ' · ' || s.product_name when 'product' then s.product_name
                     when 'customer' then s.customer_company else '전체' end as lb,
           s.*
      from s
  )
  select b.ps, b.k, max(b.lb), count(*)::int, count(*) filter (where b.act_raw is null)::int, sum(b.kg),
         sum(b.kg * b.price_krw_per_kg),
         cost_secret.shown(sum(b.kg * b.act_raw), g.chairman),
         cost_secret.shown(sum(b.kg * (b.price_krw_per_kg - b.act_raw)), g.chairman),
         round(sum(b.kg * (b.price_krw_per_kg - b.act_raw)) / nullif(sum(b.kg * b.price_krw_per_kg) filter (where b.act_raw is not null), 0) * 100, 1),
         cost_grade(sum(b.kg * (b.price_krw_per_kg - b.act_raw)) / nullif(sum(b.kg * b.price_krw_per_kg) filter (where b.act_raw is not null), 0) * 100),
         sum(b.kg) filter (where b.q_raw is not null),
         cost_secret.shown(sum(b.kg * (b.q_price - b.q_raw)), g.chairman),
         round(sum(b.kg * (b.q_price - b.q_raw)) / nullif(sum(b.kg * b.q_price) filter (where b.q_raw is not null), 0) * 100, 1),
         case when p_by = 'deal' then max(b.sale_id) end,
         case when p_by = 'deal' then max(b.shipped_on) end,
         case when p_by = 'deal' then max(b.customer_company) end,
         case when p_by = 'deal' then max(b.product_name) end,
         case when p_by = 'deal' then max(b.price_krw_per_kg) end,
         case when p_by = 'deal' then max(b.currency) end,
         case when p_by = 'deal' then max(b.source) end,
         case when p_by = 'deal' then cost_secret.shown(max(b.act_raw), g.chairman) end,
         case when p_by = 'deal' then max(b.quote_id) end,
         case when p_by = 'deal' then max(b.q_price) end,
         case when p_by = 'deal' then cost_secret.shown(max(b.q_raw), g.chairman) end
    from b
   group by b.ps, b.k
   order by b.ps desc, max(b.lb)
   limit 5000;
end;
$fn$;

/** 대표만: 마진 엑셀 내려받기 전 감사 한 줄(어느 기간 · 어느 묶음). 회장 결정 2026-10-11 «원가 엔진 빼기 금지 — 대표 예외만(감사)». */
create or replace function cost_margins_download_log(p_business text, p_from date, p_to date, p_grain text, p_by text)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
begin
  if not (is_active() and coalesce(auth_role()::text, '') = 'Chairman' and has_business(p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('export', 'cost_sales', 'margins:' || p_business, p_business, auth.uid(), auth_role()::text, null,
          jsonb_build_object('from', p_from, 'to', p_to, 'grain', p_grain, 'by', p_by), '마진 엑셀 내려받기(0067)');
end;
$fn$;

-- 감사 줄: 판매 · 견적 줄도 표와 같은 읽기 범위(리뷰 I1 — 0031 audit_log_read는 상사 사슬 전부라, 겸직 거부된 임원 · 회사 대표가
-- 감사 after의 판매가 · 등급으로 0시 원가 띠를 읽었다. 0066 견적 줄도 같은 구멍). 표 정책이 걸린 exists로 — 표에서 못 보면 감사도 못 본다.
-- 대표 · 본인은 그대로. 원가 관리의 cost_margins 내려받기 줄(entity_id 'margins:<회사>')은 본인 · 대표만.
drop policy audit_log_cost_private on audit_log;
create policy audit_log_cost_private on audit_log as restrictive for select to authenticated
  using (entity_table not in ('cost_materials', 'cost_suppliers', 'cost_market_prices', 'cost_purchase_lots', 'cost_purchase_docs', 'cost_bom',
                              'cost_production_orders', 'cost_prod_lots', 'cost_prod_inputs', 'cost_lot_adjustments', 'cost_overheads', 'cost_alloc_settings',
                              'cost_sales', 'quotes')
         or actor_user_id = auth.uid() or coalesce(auth_role()::text, '') = 'Chairman'
         or (entity_table in ('cost_materials', 'cost_suppliers', 'cost_market_prices', 'cost_purchase_lots', 'cost_purchase_docs')
             and (cost_can('purchasing', business_id) or cost_can('costing', business_id)))
         or (entity_table in ('cost_overheads', 'cost_alloc_settings') and cost_can('costing', business_id))
         or (entity_table in ('cost_production_orders', 'cost_prod_lots', 'cost_prod_inputs', 'cost_lot_adjustments') and cost_can('production', business_id))
         or (entity_table = 'cost_sales' and exists (select 1 from cost_sales s where s.sale_id = audit_log.entity_id))
         or (entity_table = 'quotes' and exists (select 1 from quotes q where q.quote_id = audit_log.entity_id)));

revoke all on function sale_visible(text) from public, anon, authenticated;
revoke all on function sale_record(text, date, text, text, numeric, numeric, text, text, text, text, text) from public, anon;
revoke all on function sale_void(text, text) from public, anon;
revoke all on function sale_lot_options(text) from public, anon;
revoke all on function cost_margins(text, date, date, text, text) from public, anon;
revoke all on function cost_margins_download_log(text, date, date, text, text) from public, anon;
grant execute on function sale_record(text, date, text, text, numeric, numeric, text, text, text, text, text) to authenticated;
grant execute on function sale_void(text, text) to authenticated;
grant execute on function sale_lot_options(text) to authenticated;
grant execute on function cost_margins(text, date, date, text, text) to authenticated;
grant execute on function cost_margins_download_log(text, date, date, text, text) to authenticated;

commit;
