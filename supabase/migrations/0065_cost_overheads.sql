-- =====================================================================
-- Chairman OS — 0065_cost_overheads (비용 마스터 · 배부 · 총원가 Fully Loaded)
-- 작성: 2026-10-09 · 설계서 docs/superpowers/specs/cost-engine.md 2.9 · 5절
--
-- ■ 무엇 ■
--   경영지원(원가 관리 줄 can_write)이 비용 항목을 «적용 시작일»과 함께 넣는다. 한 줄 = (항목, 방식, 금액, 시작일[, 제품]).
--   같은 항목(같은 범위)의 새 줄이 앞 줄을 그 날부터 대신한다(앞 줄을 고치지 않는다 — 무효 + 새 줄). 금액 0 = 그 날부터 없음.
--     방식 monthly  월 금액(원) — 회사 전체를 kg당으로 배부. 하루치 = 월 금액 × 12 ÷ 365(그 날 적용 중인 줄).
--     방식 per_kg   원/kg 직접 단가 — 제품을 비우면 모든 제품, 고르면 그 제품에 더한다(포장재 · 전용 팔레트 · 물류 단가 등).
--   배부(회사 설정 cost_alloc_settings, 기본 = 권장안):
--     trailing(기본)  기준일 d 포함 직전 N일(기본 28) 동안 하루치 비용 합 ÷ 같은 N일 생산 kg 합(0064 생산 LOT 산출).
--                     그 N일 생산이 0이면 «계획 생산량(월 kg)»으로 — 화면에 «계획 기준» 꼬리표. 둘 다 없으면 배부 안 됨(0으로 메우지 않는다).
--     plan            늘 계획 생산량(월 kg × 12 ÷ 365 × N일)으로 나눈다.
--   묶음: 제조(인건비 · 전기 · 가스 · 감가상각 · QC · 폐기 Loss) · 포장(포장 · 팔레트) · 물류(물류 · 창고) · 간접비(임대 · 보험 · 금융비용 · 커미션 · 기타).
--   총원가(Fully Loaded) = 원료비(Current) + 제조 + 포장 + 물류 + 간접비. 영업 총원가 · 제시가가 이 값(0062 sales_row 교체).
--   정밀도: 전부 원래 값(numeric)으로 계산 — 대표 외 나가는 칸만 1원(0062 cost_secret.shown). 표시값끼리 더하지 않는다.
--
-- ■ 권한 ■ 비용 마스터 표 · 배부 설정: 원가 관리 · 대표(읽기 · 쓰기는 원가 관리 can_write · 대표). 구매 · 생산 · 영업 X.
--   영업은 제품별 «비용 합계(원/kg)»와 총원가만(cost_sales_view) — 항목 · 금액은 모른다.
--   비용은 BOM과 무관하다(배부는 kg당이라 제품 구성이 들어가지 않는다).
--   커미션을 가격식 분모에 넣는 안(설계서 5.1)은 0066에서 정한다 — 지금은 원가 항목(per_kg 또는 monthly)으로만 받는다.
-- =====================================================================

begin;

create table cost_overheads (
  overhead_id    bigint generated always as identity primary key,
  business_id    text not null references businesses(business_id),
  category       text not null check (category in ('labor', 'power', 'gas', 'depreciation', 'qc', 'waste', 'packaging', 'pallet',
                                                   'logistics', 'warehouse', 'rent', 'insurance', 'finance', 'commission', 'other')),
  basis          text not null check (basis in ('monthly', 'per_kg')),
  amount         numeric not null check (amount >= 0 and amount <= 1e13),   -- monthly = 원/월 · per_kg = 원/kg. 0 = 그 날부터 없음
  product_id     text,                                                       -- per_kg만 · 비우면 모든 제품
  effective_from date not null,
  note           text not null default '' check (length(note) <= 300),
  created_by     uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid,
  void_reason    text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  foreign key (product_id, business_id) references cost_products (product_id, business_id),
  constraint cost_overheads_scope check (basis = 'per_kg' or product_id is null),
  constraint cost_overheads_void_shape check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create index cost_overheads_by_biz on cost_overheads (business_id, category, effective_from desc) where voided_at is null;
comment on table cost_overheads is '0065. 비용 마스터 — 항목 · 방식(월 금액 / 원/kg) · 적용 시작일. 고치지 않는다(무효 + 새 줄). 원가 관리 · 대표만.';

create table cost_alloc_settings (
  business_id      text primary key references businesses(business_id),
  basis            text not null default 'trailing' check (basis in ('trailing', 'plan')),
  window_days      int not null default 28 check (window_days between 7 and 365),
  planned_kg_month numeric check (planned_kg_month is null or (planned_kg_month > 0 and planned_kg_month <= 1e12)),
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  -- (가) 2026-10-10 — 영업은 오늘 0시 기준. 오늘 바꾼 줄이면 영업은 «오늘 0시의 값»(prev_*)을 쓴다. 0시에 줄이 없었으면 prev_set = false(기본값).
  prev_set              boolean not null default false,
  prev_basis            text,
  prev_window_days      int,
  prev_planned_kg_month numeric
);
comment on table cost_alloc_settings is '0065. 배부 기준(회사마다 한 줄, 없으면 기본 trailing · 28일). cost_alloc_set으로만 바꾼다.';

-- =====================================================================
-- 트리거 · RLS
-- =====================================================================

/** 비용 줄: 만든 사람 · 시각은 DB가. per_kg 제품은 같은 회사(복합 FK). 미래 시작일은 받는다(예정 인상) — 그 날부터 적용. */
create or replace function cost_overhead_stamp() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end;
$fn$;

create trigger cost_overheads_stamp before insert on cost_overheads for each row execute function cost_overhead_stamp();
create trigger cost_overheads_void before update on cost_overheads for each row execute function cost_void_update();
create trigger cost_overheads_audit after insert or update on cost_overheads for each row execute function cost_audit_0064('overhead_id');

alter table cost_overheads enable row level security;
alter table cost_alloc_settings enable row level security;
revoke all on table cost_overheads, cost_alloc_settings from anon, public;
revoke insert, update, delete, truncate, references, trigger on table cost_overheads, cost_alloc_settings from authenticated;
create policy cost_overheads_no_system on cost_overheads as restrictive for all to authenticated
  using (coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration'));
create policy cost_alloc_settings_no_system on cost_alloc_settings as restrictive for all to authenticated
  using (coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration'));
grant select, insert on cost_overheads to authenticated;
grant update (voided_at, voided_by, void_reason) on cost_overheads to authenticated;
grant select on cost_alloc_settings to authenticated;
revoke all on sequence cost_overheads_overhead_id_seq from anon, public;
revoke update on sequence cost_overheads_overhead_id_seq from authenticated;
grant usage, select on sequence cost_overheads_overhead_id_seq to authenticated;

create policy cost_overheads_read on cost_overheads for select to authenticated using (cost_can('costing', business_id));
create policy cost_overheads_insert on cost_overheads for insert to authenticated with check (cost_can('costing', business_id, true));
create policy cost_overheads_void on cost_overheads for update to authenticated
  using (cost_can('costing', business_id, true)) with check (cost_can('costing', business_id, true));
create policy cost_alloc_settings_read on cost_alloc_settings for select to authenticated using (cost_can('costing', business_id));

-- 감사 줄: 비용 표 · 배부 설정도 본인 · 대표 · 원가 관리만(0064 정책에 두 표 더 — 0065 리뷰 I5: 계획 생산량 + 영업이 보는 비용 합 = 월 비용 총액).
drop policy audit_log_cost_private on audit_log;
create policy audit_log_cost_private on audit_log as restrictive for select
  using (entity_table not in ('cost_materials', 'cost_suppliers', 'cost_market_prices', 'cost_purchase_lots', 'cost_purchase_docs', 'cost_bom',
                              'cost_production_orders', 'cost_prod_lots', 'cost_prod_inputs', 'cost_lot_adjustments', 'cost_overheads', 'cost_alloc_settings')
         or actor_user_id = auth.uid() or coalesce(auth_role()::text, '') = 'Chairman'
         or (entity_table in ('cost_materials', 'cost_suppliers', 'cost_market_prices', 'cost_purchase_lots', 'cost_purchase_docs')
             and (cost_can('purchasing', business_id) or cost_can('costing', business_id)))
         or (entity_table in ('cost_overheads', 'cost_alloc_settings') and cost_can('costing', business_id))
         or (entity_table in ('cost_production_orders', 'cost_prod_lots', 'cost_prod_inputs', 'cost_lot_adjustments') and cost_can('production', business_id)));

-- =====================================================================
-- 계산(cost_secret — execute 없음)
-- =====================================================================

/** 항목 → 묶음. */
create or replace function cost_secret.overhead_group(p_category text) returns text
language sql immutable set search_path = pg_temp as $fn$
  select case
    when p_category in ('labor', 'power', 'gas', 'depreciation', 'qc', 'waste') then 'mfg'
    when p_category in ('packaging', 'pallet') then 'pack'
    when p_category in ('logistics', 'warehouse') then 'logi'
    else 'indirect' end;
$fn$;

/**
 * 제품 p · 기준일 d의 kg당 비용(원래 값). 비용 줄이 하나도 없으면 ready = false · 모두 null(«비용 마스터 없음»).
 * 월 금액 줄이 창 안에 있는데 나눌 kg(생산 · 계획)이 없으면 ready = false(0으로 메우지 않는다 — 영업 총원가는 원료비만, 화면이 그렇게 적는다).
 */
create or replace function cost_secret.overhead(p_business text, p_product text, p_on date,
  out mfg numeric, out pack numeric, out logi numeric, out indirect numeric, out total numeric,
  out ready boolean, out basis_used text, out divisor_kg numeric, out window_days int, out has_lines boolean)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  s record;
  v_monthly boolean;
begin
  ready := false;
  has_lines := exists (select 1 from public.cost_overheads o where o.business_id = p_business and cost_secret.known(o.created_at, o.voided_at) and o.effective_from <= p_on);
  if not has_lines then
    return;
  end if;
  select * into s from public.cost_alloc_settings a where a.business_id = p_business;
  -- (가) 영업: 오늘 바꾼 배부 기준은 내일부터. 오늘 0시의 값(없었으면 기본값)을 쓴다.
  if s.business_id is not null and not cost_secret.known(s.updated_at, null) then
    if s.prev_set then
      s.basis := s.prev_basis; s.window_days := s.prev_window_days; s.planned_kg_month := s.prev_planned_kg_month;
    else
      s.basis := null; s.window_days := null; s.planned_kg_month := null;
    end if;
  end if;
  window_days := coalesce(s.window_days, 28);
  basis_used := coalesce(s.basis, 'trailing');
  if basis_used = 'trailing' then
    select sum(pl.output_kg) into divisor_kg from public.cost_prod_lots pl
     where pl.business_id = p_business and cost_secret.known(pl.created_at, pl.voided_at) and pl.produced_on > p_on - window_days and pl.produced_on <= p_on;
  end if;
  if coalesce(divisor_kg, 0) = 0 then
    divisor_kg := case when s.planned_kg_month > 0 then s.planned_kg_month * 12 * window_days / 365 end;
    basis_used := case when divisor_kg is null then basis_used else 'plan' end;
  end if;

  -- 월 금액: 창의 날마다 그 날 적용 중인 회사 전체 줄(항목마다 가장 늦은 시작일 — 방식과 상관없이, 0065 리뷰 I2: 월 금액 → 원/kg로
  -- 바꾸면 앞 줄을 대신한다) 중 월 금액인 것 × 12 ÷ 365 를 더한다.
  with days as (select (p_on - g)::date as d from generate_series(0, window_days - 1) g),
       cur as (
         select x.category, x.amount
           from days dd
           cross join lateral (
             select distinct on (o.category) o.category, o.amount, o.basis
               from public.cost_overheads o
              where o.business_id = p_business and o.product_id is null and cost_secret.known(o.created_at, o.voided_at) and o.effective_from <= dd.d
              order by o.category, o.effective_from desc, o.overhead_id desc) x
          where x.basis = 'monthly'),
       m as (select cost_secret.overhead_group(c.category) as grp, sum(c.amount) * 12 / 365 as amt from cur c group by 1)
  select exists (select 1 from m where m.amt > 0),
         coalesce((select m.amt from m where m.grp = 'mfg'), 0),
         coalesce((select m.amt from m where m.grp = 'pack'), 0),
         coalesce((select m.amt from m where m.grp = 'logi'), 0),
         coalesce((select m.amt from m where m.grp = 'indirect'), 0)
    into v_monthly, mfg, pack, logi, indirect;
  if v_monthly and divisor_kg is null then
    mfg := null; pack := null; logi := null; indirect := null; total := null;
    return;
  end if;
  ready := true;
  if v_monthly then
    -- 창 동안 하루치 합 ÷ 같은 창의 kg(원래 값).
    mfg := mfg / divisor_kg; pack := pack / divisor_kg; logi := logi / divisor_kg; indirect := indirect / divisor_kg;
  else
    mfg := 0; pack := 0; logi := 0; indirect := 0;
  end if;
  -- 원/kg 직접 단가(항목 × 범위마다 기준일에 적용 중인 줄)를 묶음별로 더한다.
  select mfg + coalesce(sum(y.amount) filter (where y.grp = 'mfg'), 0),
         pack + coalesce(sum(y.amount) filter (where y.grp = 'pack'), 0),
         logi + coalesce(sum(y.amount) filter (where y.grp = 'logi'), 0),
         indirect + coalesce(sum(y.amount) filter (where y.grp = 'indirect'), 0)
    into mfg, pack, logi, indirect
    from cost_secret.overhead_per_kg(p_business, p_product, p_on) y;
  total := mfg + pack + logi + indirect;
end;
$fn$;

/** 원/kg 직접 단가 줄(기준일에 적용 중 · 항목 × 범위마다 하나). 회사 전체 범위는 방식과 상관없이 가장 늦은 줄이 원/kg일 때만(리뷰 I2). */
create or replace function cost_secret.overhead_per_kg(p_business text, p_product text, p_on date)
returns table (category text, grp text, amount numeric, product_id text)
language sql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
  select y.category, cost_secret.overhead_group(y.category), y.amount, y.product_id
    from (select distinct on (o.category, coalesce(o.product_id, '')) o.category, o.amount, o.product_id, o.basis
            from public.cost_overheads o
           where o.business_id = p_business and cost_secret.known(o.created_at, o.voided_at) and o.effective_from <= p_on
             and (o.product_id is null or o.product_id = p_product)
           order by o.category, coalesce(o.product_id, ''), o.effective_from desc, o.overhead_id desc) y
   where y.basis = 'per_kg';
$fn$;

-- =====================================================================
-- 0062 교체 — 영업 한 줄 · 원가 한 값에 비용을 더한다(칸 · 문은 그대로)
-- =====================================================================

create or replace function cost_secret.sales_row(p_product text, p_business text, p_as_of date, p_chairman boolean,
  p_ok boolean, p_prev_ok boolean,
  out market_krw_per_kg numeric, out current_krw_per_kg numeric, out advantage_krw_per_kg numeric,
  out overhead_krw_per_kg numeric, out total_krw_per_kg numeric, out overhead_ready boolean,
  out material_impact_pct numeric, out computed boolean, out offers jsonb, out total_raw numeric)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_ok boolean;
  v_prev_ok boolean;
  v_mk numeric;
  v_cu numeric;
  v_pr numeric;
  o record;
begin
  v_ok := p_chairman or p_ok;
  v_prev_ok := p_chairman or p_prev_ok;
  if v_ok then
    select x.total into v_mk from cost_secret.material_cost(p_product, 'market', p_as_of) x;
    select x.total into v_cu from cost_secret.material_cost(p_product, 'current', p_as_of) x;
    if v_prev_ok then
      select x.total into v_pr from cost_secret.material_cost(p_product, 'current', p_as_of - 7) x;
    end if;
  end if;
  select * into o from cost_secret.overhead(p_business, p_product, p_as_of);
  overhead_ready := coalesce(o.ready, false);
  -- 총원가(Fully Loaded) = 원료비 + 비용 — 원래 값끼리 더한 뒤 1원(대표 외). 비용 마스터가 아예 없으면 원료비만(화면이 «비용 마스터 없음»),
  -- 비용 줄은 있는데 배부를 못 하면(생산 · 계획 kg 없음) 계산 안 함 — 원료비만으로 제시가 · 등급을 내면 손해 보는 값이 Green으로 보인다(0065 리뷰 I1).
  total_raw := case when v_cu is null then null when overhead_ready then v_cu + o.total when coalesce(o.has_lines, false) then null else v_cu end;
  overhead_krw_per_kg := case when v_cu is not null and overhead_ready then cost_secret.shown(o.total, p_chairman) end;
  market_krw_per_kg := cost_secret.shown(v_mk, p_chairman);
  current_krw_per_kg := cost_secret.shown(v_cu, p_chairman);
  advantage_krw_per_kg := cost_secret.shown(v_mk - v_cu, p_chairman);
  total_krw_per_kg := cost_secret.shown(total_raw, p_chairman);
  material_impact_pct := case when v_pr > 0 then round((v_cu / v_pr - 1) * 100, 1) end;
  computed := total_raw is not null;
  offers := case when total_raw is null then '[]'::jsonb else (
    select jsonb_agg(jsonb_build_object('margin_pct', m, 'price_krw_per_kg', cost_secret.shown(total_raw / (1 - m / 100.0), p_chairman),
                                        'grade', cost_grade(m)) order by m)
      from unnest(array[15, 20, 25, 30]) m) end;
end;
$fn$;

/**
 * 원가 관리 화면 목록(한 번의 조회 — 제품 수만큼 한도 · 호출마다 감사): 제품마다 Market · Current · 제조 · 포장 · 물류 · 간접비 · 총원가.
 * 대표 = 원래 값, 원가 관리 = 1원(합계도 원래 값끼리 더한 뒤 1원). 영업 · 구매 · 생산 = cost_not_found(영업은 cost_sales_list).
 */
create or replace function cost_costing_list(p_business text)
returns table (product_id text, product_name text, as_of date, market_krw_per_kg numeric, current_krw_per_kg numeric,
               mfg_krw_per_kg numeric, pack_krw_per_kg numeric, logi_krw_per_kg numeric, indirect_krw_per_kg numeric,
               overhead_krw_per_kg numeric, total_krw_per_kg numeric, overhead_ready boolean, overhead_basis text, computed boolean)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  g record;
  v_ok boolean;
begin
  if not (coalesce(auth_role()::text, '') = 'Chairman' or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select * into g from cost_secret.cost_gate_biz(p_business, 'costing:' || coalesce(p_business, ''), 'costing_list', null);
  v_ok := g.chairman or (cost_secret.business_complete(p_business, 'market', g.as_of)
                         and cost_secret.business_complete(p_business, 'current', g.as_of));
  return query
  select p.product_id, p.name, g.as_of,
         cost_secret.shown(mc.mk, g.chairman), cost_secret.shown(mc.cu, g.chairman),
         case when o.ready then cost_secret.shown(o.mfg, g.chairman) end,
         case when o.ready then cost_secret.shown(o.pack, g.chairman) end,
         case when o.ready then cost_secret.shown(o.logi, g.chairman) end,
         case when o.ready then cost_secret.shown(o.indirect, g.chairman) end,
         case when o.ready then cost_secret.shown(o.total, g.chairman) end,
         cost_secret.shown(case when mc.cu is null then null when o.ready then mc.cu + o.total when o.has_lines then null else mc.cu end, g.chairman),
         coalesce(o.ready, false), o.basis_used, mc.cu is not null and (o.ready or not o.has_lines)
    from cost_products p
    cross join lateral (select (case when v_ok then (select x.total from cost_secret.material_cost(p.product_id, 'market', g.as_of) x) end) as mk,
                               (case when v_ok then (select x.total from cost_secret.material_cost(p.product_id, 'current', g.as_of) x) end) as cu) mc
    cross join lateral cost_secret.overhead(p_business, p.product_id, g.as_of) o
   where p.business_id = p_business and p.active
   order by p.name
   limit 500;
end;
$fn$;

/** 원가 관리 · 대표: 비용 항목별 오늘(또는 날짜) 적용 값 — 월 금액 · kg당 배부 · 시작일 · 나눈 kg. 제품 직접 단가는 제품 id와 함께. */
create or replace function cost_overhead_summary(p_business text, p_as_of date default null)
returns table (category text, grp text, basis text, amount numeric, product_id text, effective_from date, per_kg numeric,
               divisor_kg numeric, basis_used text, window_days int)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_on date := coalesce(p_as_of, cost_today());
  o record;
begin
  if not cost_can('costing', p_business) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select * into o from cost_secret.overhead(p_business, null, v_on);
  return query
  select x.category, cost_secret.overhead_group(x.category), x.basis, x.amount, x.product_id, x.effective_from,
         case when x.basis = 'per_kg' then x.amount
              when o.divisor_kg > 0 then (select sum(c.amount) * 12 / 365 from (
                 select (select case when oo.basis = 'monthly' then oo.amount end from cost_overheads oo
                          where oo.business_id = p_business and oo.product_id is null and oo.category = x.category and oo.voided_at is null
                            and oo.effective_from <= (v_on - g)::date
                          order by oo.effective_from desc, oo.overhead_id desc limit 1) as amount
                   from generate_series(0, o.window_days - 1) g) c) / o.divisor_kg end,
         o.divisor_kg, o.basis_used, o.window_days
    from (select distinct on (c.category, coalesce(c.product_id, '')) c.category, c.basis, c.amount, c.product_id, c.effective_from
            from cost_overheads c
           where c.business_id = p_business and c.voided_at is null and c.effective_from <= v_on
           order by c.category, coalesce(c.product_id, ''), c.effective_from desc, c.overhead_id desc) x
   order by cost_secret.overhead_group(x.category), x.category, x.basis, x.product_id nulls first;
end;
$fn$;

/** 원가 관리(쓰기) · 대표: 배부 기준 바꾸기. 감사 한 줄(값 그대로 — 비용 설정은 BOM이 아니다). */
create or replace function cost_alloc_set(p_business text, p_basis text, p_window_days int, p_planned_kg_month numeric)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
begin
  if not cost_can('costing', p_business, true) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_basis not in ('trailing', 'plan') or p_window_days is null or p_window_days not between 7 and 365
     or (p_planned_kg_month is not null and (p_planned_kg_month <= 0 or p_planned_kg_month > 1e12))
     or (p_basis = 'plan' and p_planned_kg_month is null) then
    raise exception 'cost_alloc_invalid' using errcode = '22023';
  end if;
  insert into cost_alloc_settings (business_id, basis, window_days, planned_kg_month, updated_by, updated_at)
  values (p_business, p_basis, p_window_days, p_planned_kg_month, auth.uid(), now())
  on conflict (business_id) do update set basis = excluded.basis, window_days = excluded.window_days,
    planned_kg_month = excluded.planned_kg_month, updated_by = excluded.updated_by, updated_at = excluded.updated_at,
    -- (가) 앞 줄이 오늘 0시 전에 저장된 것이면 그것이 «오늘 0시의 값»이다. 오늘 이미 바꾼 줄이면 prev_*는 그대로(0시 값 유지).
    prev_set = case when cost_alloc_settings.updated_at <= cost_secret.sales_cutoff() then true else cost_alloc_settings.prev_set end,
    prev_basis = case when cost_alloc_settings.updated_at <= cost_secret.sales_cutoff() then cost_alloc_settings.basis else cost_alloc_settings.prev_basis end,
    prev_window_days = case when cost_alloc_settings.updated_at <= cost_secret.sales_cutoff() then cost_alloc_settings.window_days else cost_alloc_settings.prev_window_days end,
    prev_planned_kg_month = case when cost_alloc_settings.updated_at <= cost_secret.sales_cutoff() then cost_alloc_settings.planned_kg_month else cost_alloc_settings.prev_planned_kg_month end;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'cost_alloc_settings', p_business, p_business, auth.uid(), auth_role()::text, null,
          jsonb_build_object('basis', p_basis, 'window_days', p_window_days, 'planned_kg_month', p_planned_kg_month), '배부 기준(0065)');
end;
$fn$;

/** 0062 cost_product_cost — 종류 'total'(원료비 Current + 비용, Fully Loaded)을 더한다. 비용 준비 전이면 대표 = overhead_not_ready, 대표 외 = not_computed. */
create or replace function cost_product_cost(p_product text, p_kind text default 'current', p_as_of date default null)
returns table (product_id text, kind text, as_of date, material_krw_per_kg numeric, computed boolean, reason text)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  g record;
  c record;
  o record;
  v_kind text := case when p_kind = 'total' then 'current' else p_kind end;
begin
  if p_kind is null or p_kind not in ('market', 'current', 'total') then
    raise exception 'cost_kind_unsupported' using errcode = '22023';
  end if;
  select * into g from cost_secret.cost_gate(p_product, p_kind, p_as_of);
  if not g.chairman and not cost_secret.business_complete(g.business_id, v_kind, g.as_of) then
    return query select p_product, p_kind, g.as_of, null::numeric, false, 'not_computed'::text;
    return;
  end if;
  select * into c from cost_secret.material_cost(p_product, v_kind, g.as_of);
  if p_kind = 'total' and c.total is not null then
    select * into o from cost_secret.overhead(g.business_id, p_product, g.as_of);
    if not coalesce(o.ready, false) then
      return query select p_product, p_kind, g.as_of, null::numeric, false,
        case when g.chairman then 'overhead_not_ready' else 'not_computed' end;
      return;
    end if;
    c.total := c.total + o.total;
  end if;
  return query select p_product, p_kind, g.as_of,
    cost_secret.shown(c.total, g.chairman),
    c.total is not null,
    case when c.total is not null then null
         when not g.chairman then 'not_computed'
         when c.missing = -1 then 'no_bom' else 'price_missing' end;
end;
$fn$;

revoke all on all functions in schema cost_secret from public, anon, authenticated;
revoke all on function cost_overhead_stamp() from public, anon, authenticated;
revoke all on function cost_costing_list(text) from public, anon;
revoke all on function cost_overhead_summary(text, date) from public, anon;
revoke all on function cost_alloc_set(text, text, int, numeric) from public, anon;
grant execute on function cost_costing_list(text) to authenticated;
grant execute on function cost_overhead_summary(text, date) to authenticated;
grant execute on function cost_alloc_set(text, text, int, numeric) to authenticated;

commit;
