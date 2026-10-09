-- =====================================================================
-- Chairman OS — 0064_cost_production (생산 오더 · 작업지시 수량 · 생산 LOT · 투입 원료 LOT · 잔량 · 조정 · Actual 원가)
-- 작성: 2026-10-09 · 설계서 docs/superpowers/specs/cost-engine.md 2.5 · 2.8 · 4 · 9.3절
--
-- ■ 흐름 ■
--   대표가 오더를 «발행»(cost_production_issue) → 함수가 그 날 BOM × 계획 kg로 **작업지시 수량**(원료 · kg)을 한 번 만든다
--   → 생산이 생산 LOT(산출 kg)를 적고, 실제로 쓴 구매 LOT와 kg를 투입으로 적는다(FIFO 자동 차감 없음 — 화면이 오래된 순으로 제안만)
--   → 구매 LOT 잔량 = 입고 kg − 투입 − 조정(뷰 · 함수, 저장하지 않는다) · 잔량보다 많이 쓰면 거부(cost_lot_short)
--   → Actual 원가(생산 LOT) = Σ(투입 kg × 그 LOT landed) ÷ 산출 kg — 원래 값, 대표 외 1원(0062 규칙). 분해(원료 · LOT별)는 대표만.
--   → Current 단가(0062)를 «d 시점 남은 LOT 잔량 가중 landed»로 바꾼다(재고 이동평균, 설계서 4절). 남은 게 없으면 마지막 LOT 단가.
--
-- ■ 권한(설계서 3.2) ■
--   표                         대표  생산(줄)  원가 관리  구매  영업
--   오더 머리(제품 · 계획 kg)    O     O        O          X     X
--   작업지시 수량(원료 · kg)     O     O        X          X     X   ← «무엇을 몇 kg»만. 비율 · 수율 · 제품 전체 비율표는 없다
--   생산 LOT(산출 kg)            O     O        O          X     X
--   투입(어느 LOT 몇 kg)         O     O        X          X     X   ← 투입 kg ÷ 산출 kg = 실제 배합이라 원가 관리에도 주지 않는다
--   조정(폐기 · 실사)            O     O        O          O     X
--   잔량(함수)                   O     O        O          O     X
--   Actual 총액(함수)            O     X        O(감사)    X     X
--   Actual 분해(함수)            O     X        X          X     X
--   발행은 대표만. 생산 LOT · 투입은 «생산 입력»(/production/<biz> can_write). 조정은 구매 입력 · 생산 입력.
--   ※ 작업지시 수량 ÷ 계획 kg = BOM 비율이다 — 회장 결정 «X(작업지시 수량만)»이 허용한 잔여 위험(설계서 9.3). 이 표는 평문이다
--     (생산이 읽어야 한다) — 0063 암호화는 BOM 판을 지키고, 발행된 오더의 수량은 지키지 않는다(운영 문서에 적는다).
--
-- ■ 고치지 않는 기록 ■ 생산 LOT · 투입 · 조정은 insert + 무효만(0061과 같은 결). 오더는 상태만(open → done · cancelled).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 표
-- =====================================================================

create table cost_production_orders (
  order_id    text primary key default ('PO-' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD') || '-' ||
                                        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)))
              check (order_id ~ '^PO-[0-9]{8}-[0-9A-F]{6}$'),
  business_id text not null references businesses(business_id),
  product_id  text not null,
  planned_on  date not null,
  planned_kg  numeric not null check (planned_kg > 0 and planned_kg <= 1e9),
  status      text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  note        text not null default '' check (length(note) <= 500),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  closed_by   uuid,
  closed_at   timestamptz,
  foreign key (product_id, business_id) references cost_products (product_id, business_id)
);
create index cost_production_orders_by_biz on cost_production_orders (business_id, planned_on desc);
comment on table cost_production_orders is '0064. 생산 오더 — 대표가 cost_production_issue로만 만든다. 머리(제품 · 계획 kg)는 생산 · 원가 관리도 읽는다.';

create table cost_production_order_lines (
  order_id    text not null references cost_production_orders(order_id),
  material_id text not null references cost_materials(material_id),
  planned_kg  numeric not null check (planned_kg > 0),
  primary key (order_id, material_id)
);
comment on table cost_production_order_lines is
  '0064. 작업지시 수량 — 발행 순간 BOM × 계획 kg로 한 번 만든 «원료 X를 몇 kg». 비율 · 수율이 아니다. 대표 · 생산만 읽는다(설계서 9.3 잔여 위험).';

create table cost_prod_lots (
  prod_lot_id text primary key default ('ML-' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD') || '-' ||
                                        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)))
              check (prod_lot_id ~ '^ML-[0-9]{8}-[0-9A-F]{6}$'),
  business_id text not null references businesses(business_id),
  order_id    text not null references cost_production_orders(order_id),
  product_id  text not null,                                    -- 트리거가 오더에서 채운다
  produced_on date not null,
  output_kg   numeric not null check (output_kg > 0 and output_kg <= 1e9),
  note        text not null default '' check (length(note) <= 500),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid,
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  foreign key (product_id, business_id) references cost_products (product_id, business_id),
  constraint cost_prod_lots_void_shape check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create index cost_prod_lots_by_biz on cost_prod_lots (business_id, produced_on desc) where voided_at is null;
comment on table cost_prod_lots is '0064. 생산 LOT(산출 kg). 고치지 않는다 — 무효 + 새 줄. 이름은 cost_prod_lots(0061의 함수 cost_production_lots = 생산이 보는 구매 LOT 목록과 헷갈리지 않게).';

create table cost_prod_inputs (
  input_id    bigint generated always as identity primary key,
  business_id text not null references businesses(business_id),
  prod_lot_id text not null references cost_prod_lots(prod_lot_id),
  lot_id      text not null references cost_purchase_lots(lot_id),
  material_id text not null,                                    -- 트리거가 구매 LOT에서 채운다
  qty_kg      numeric not null check (qty_kg > 0 and qty_kg <= 1e9),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid,
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  constraint cost_prod_inputs_void_shape check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create index cost_prod_inputs_by_lot on cost_prod_inputs (lot_id) where voided_at is null;
create index cost_prod_inputs_by_prod on cost_prod_inputs (prod_lot_id) where voided_at is null;
comment on table cost_prod_inputs is '0064. 투입 — 생산 LOT에 실제로 쓴 구매 LOT와 kg. Actual 원가의 원천. 대표 · 생산만 읽는다(투입 ÷ 산출 = 실제 배합).';

create table cost_lot_adjustments (
  adj_id      bigint generated always as identity primary key,
  business_id text not null references businesses(business_id),
  lot_id      text not null references cost_purchase_lots(lot_id),
  adjusted_on date not null,
  qty_kg      numeric not null check (qty_kg > 0 and qty_kg <= 1e9),   -- 잔량에서 빼는 kg(폐기 · 실사 부족)
  reason      text not null check (length(btrim(reason)) between 1 and 300),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid,
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  constraint cost_lot_adjustments_void_shape check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create index cost_lot_adjustments_by_lot on cost_lot_adjustments (lot_id) where voided_at is null;
comment on table cost_lot_adjustments is '0064. 구매 LOT 잔량 조정(폐기 · 실사 차이) — 이유 필수 · 일 단위 · 무효만.';

-- =====================================================================
-- 2절. 트리거 — 도장 · 채움 · 잔량 · 무효 · 감사
-- =====================================================================

/** 구매 LOT의 d 시점(포함) 잔량 — 입고 kg − 투입(생산일 ≤ d) − 조정(조정일 ≤ d). d = null이면 지금까지 전부. 내부용. */
create or replace function cost_lot_remaining(p_lot text, p_on date default null) returns numeric
language sql stable security definer set search_path = public, pg_temp as $fn$
  select l.qty_kg
         - coalesce((select sum(i.qty_kg) from cost_prod_inputs i join cost_prod_lots pl on pl.prod_lot_id = i.prod_lot_id
                      where i.lot_id = l.lot_id and i.voided_at is null and pl.voided_at is null
                        and (p_on is null or pl.produced_on <= p_on)), 0)
         - coalesce((select sum(a.qty_kg) from cost_lot_adjustments a
                      where a.lot_id = l.lot_id and a.voided_at is null and (p_on is null or a.adjusted_on <= p_on)), 0)
    from cost_purchase_lots l where l.lot_id = p_lot;
$fn$;

/** 생산 LOT: 오더에서 회사 · 제품을 채운다. 오더가 열려 있어야(open) 한다. */
create or replace function cost_prod_lot_fill() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  o record;
begin
  new.created_by := auth.uid();
  new.created_at := now();
  select * into o from cost_production_orders where order_id = new.order_id;
  -- RLS(생산 입력 · 그 회사)는 이 트리거 뒤에 with check로 본다. 여기서는 오더 상태만 — 없는 오더와 닫힌 오더를 같은 말로.
  if o.order_id is null or o.status <> 'open' or o.business_id <> new.business_id then
    raise exception 'cost_order_closed' using errcode = '23514';
  end if;
  new.product_id := o.product_id;
  if new.produced_on > cost_today() + 1 then
    raise exception 'cost_date_future' using errcode = '22023';
  end if;
  return new;
end;
$fn$;

/**
 * 투입 · 조정: 구매 LOT를 잠그고(같은 LOT에 동시에 둘이 써서 잔량을 넘지 않게) 잔량 안인지 본다. 투입은 원료를 LOT에서 채우고,
 * 생산 LOT가 같은 회사 · 살아 있는지 본다. 권한 없는 사람에게는 아무 말 없이 넘긴다(RLS가 거부 — 잔량 값을 오류로 알려 주지 않게).
 */
create or replace function cost_lot_draw_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  l record;
  v_left numeric;
begin
  new.created_by := auth.uid();
  new.created_at := now();
  select * into l from cost_purchase_lots where lot_id = new.lot_id for update;
  if tg_table_name = 'cost_prod_inputs' then
    if not cost_can('production', new.business_id, true) then return new; end if;
    if not exists (select 1 from cost_prod_lots p where p.prod_lot_id = new.prod_lot_id and p.business_id = new.business_id and p.voided_at is null) then
      raise exception 'cost_prod_lot_invalid' using errcode = '23514';
    end if;
  elsif not (cost_can('production', new.business_id, true) or cost_can('purchasing', new.business_id, true)) then
    return new;
  end if;
  if l.lot_id is null or l.business_id <> new.business_id or l.voided_at is not null then
    raise exception 'cost_lot_invalid' using errcode = '23514';
  end if;
  if tg_table_name = 'cost_prod_inputs' then
    new.material_id := l.material_id;
  elsif new.adjusted_on > cost_today() + 1 then
    raise exception 'cost_date_future' using errcode = '22023';
  end if;
  v_left := cost_lot_remaining(new.lot_id);
  if new.qty_kg > v_left then
    raise exception 'cost_lot_short' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

/** 감사 — 값 없이 id만(0061 cost_audit와 같은 결). 키 칸 이름은 트리거 인자. */
create or replace function cost_audit_0064() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id text := to_jsonb(new) ->> tg_argv[0];
begin
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (case when tg_op = 'INSERT' then 'create'::audit_action else 'update'::audit_action end, tg_table_name, v_id, new.business_id,
          auth.uid(), auth_role()::text, null, jsonb_build_object('id', v_id),
          case when tg_op = 'INSERT' then '생산 기록(0064)' else '생산 기록 무효 · 상태(0064)' end);
  return null;
end;
$fn$;

/** 오더 상태: open → done(생산 입력 · 대표) · cancelled(대표). 다른 칸은 못 바꾼다. */
create or replace function cost_order_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if old.status <> 'open' or new.status not in ('done', 'cancelled') then
    raise exception 'cost_order_closed' using errcode = '23514';
  end if;
  if new.status = 'cancelled' and coalesce(auth_role()::text, '') <> 'Chairman' then
    raise exception 'cost_order_closed' using errcode = '23514';
  end if;
  new.order_id := old.order_id; new.business_id := old.business_id; new.product_id := old.product_id;
  new.planned_on := old.planned_on; new.planned_kg := old.planned_kg; new.note := old.note;
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.closed_by := auth.uid(); new.closed_at := now();
  return new;
end;
$fn$;

create trigger cost_prod_lots_fill before insert on cost_prod_lots for each row execute function cost_prod_lot_fill();
create trigger cost_prod_inputs_check before insert on cost_prod_inputs for each row execute function cost_lot_draw_check();
create trigger cost_lot_adjustments_check before insert on cost_lot_adjustments for each row execute function cost_lot_draw_check();
create trigger cost_prod_lots_void before update on cost_prod_lots for each row execute function cost_void_update();
create trigger cost_prod_inputs_void before update on cost_prod_inputs for each row execute function cost_void_update();
create trigger cost_lot_adjustments_void before update on cost_lot_adjustments for each row execute function cost_void_update();
create trigger cost_production_orders_status before update on cost_production_orders for each row execute function cost_order_update();
create trigger cost_production_orders_audit after insert or update on cost_production_orders for each row execute function cost_audit_0064('order_id');
create trigger cost_prod_lots_audit after insert or update on cost_prod_lots for each row execute function cost_audit_0064('prod_lot_id');
create trigger cost_prod_inputs_audit after insert or update on cost_prod_inputs for each row execute function cost_audit_0064('input_id');
create trigger cost_lot_adjustments_audit after insert or update on cost_lot_adjustments for each row execute function cost_audit_0064('adj_id');

-- =====================================================================
-- 3절. RLS · 권한(FORCE 없음 — 0061 리뷰 C1)
-- =====================================================================

do $do$
declare
  t text;
begin
  foreach t in array array['cost_production_orders', 'cost_production_order_lines', 'cost_prod_lots', 'cost_prod_inputs', 'cost_lot_adjustments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, public', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on table %I from authenticated', t);
    execute format('create policy %I on %I as restrictive for all to authenticated using (coalesce(auth_role()::text, %L) not in (%L, %L))',
                   t || '_no_system', t, '', 'AIAgent', 'Integration');
  end loop;
end;
$do$;

grant select on cost_production_orders, cost_production_order_lines to authenticated;
grant select, insert on cost_prod_lots, cost_prod_inputs, cost_lot_adjustments to authenticated;
grant update (status) on cost_production_orders to authenticated;
grant update (voided_at, voided_by, void_reason) on cost_prod_lots, cost_prod_inputs, cost_lot_adjustments to authenticated;
revoke all on sequence cost_prod_inputs_input_id_seq, cost_lot_adjustments_adj_id_seq from anon, public;
revoke update on sequence cost_prod_inputs_input_id_seq, cost_lot_adjustments_adj_id_seq from authenticated;
grant usage, select on sequence cost_prod_inputs_input_id_seq, cost_lot_adjustments_adj_id_seq to authenticated;

create policy cost_production_orders_read on cost_production_orders for select to authenticated using (
  cost_can('production', business_id) or cost_can('costing', business_id));
create policy cost_production_orders_close on cost_production_orders for update to authenticated
  using (cost_can('production', business_id, true)) with check (cost_can('production', business_id, true));

-- 작업지시 수량: 대표 · 생산만(원가 관리 · 구매 · 영업 X).
create policy cost_production_order_lines_read on cost_production_order_lines for select to authenticated using (
  exists (select 1 from cost_production_orders o where o.order_id = cost_production_order_lines.order_id and cost_can('production', o.business_id)));

create policy cost_prod_lots_read on cost_prod_lots for select to authenticated using (
  cost_can('production', business_id) or cost_can('costing', business_id));
create policy cost_prod_lots_insert on cost_prod_lots for insert to authenticated with check (cost_can('production', business_id, true));
create policy cost_prod_lots_void on cost_prod_lots for update to authenticated
  using (cost_can('production', business_id, true)) with check (cost_can('production', business_id, true));

create policy cost_prod_inputs_read on cost_prod_inputs for select to authenticated using (cost_can('production', business_id));
create policy cost_prod_inputs_insert on cost_prod_inputs for insert to authenticated with check (cost_can('production', business_id, true));
create policy cost_prod_inputs_void on cost_prod_inputs for update to authenticated
  using (cost_can('production', business_id, true)) with check (cost_can('production', business_id, true));

create policy cost_lot_adjustments_read on cost_lot_adjustments for select to authenticated using (
  cost_can('production', business_id) or cost_can('purchasing', business_id) or cost_can('costing', business_id));
create policy cost_lot_adjustments_insert on cost_lot_adjustments for insert to authenticated with check (
  cost_can('production', business_id, true) or cost_can('purchasing', business_id, true));
create policy cost_lot_adjustments_void on cost_lot_adjustments for update to authenticated
  using (cost_can('production', business_id, true) or cost_can('purchasing', business_id, true))
  with check (cost_can('production', business_id, true) or cost_can('purchasing', business_id, true));

-- 감사 줄: 생산 표의 줄도 본인 · 대표 · 그 회사 구매 · 원가 관리 · 생산만(0061 audit_log_cost_private를 넓혀 다시 만든다).
drop policy audit_log_cost_private on audit_log;
create policy audit_log_cost_private on audit_log as restrictive for select
  using (entity_table not in ('cost_materials', 'cost_suppliers', 'cost_market_prices', 'cost_purchase_lots', 'cost_purchase_docs', 'cost_bom',
                              'cost_production_orders', 'cost_prod_lots', 'cost_prod_inputs', 'cost_lot_adjustments')
         or actor_user_id = auth.uid() or coalesce(auth_role()::text, '') = 'Chairman'
         or cost_can('purchasing', business_id) or cost_can('costing', business_id)
         or (entity_table in ('cost_production_orders', 'cost_prod_lots', 'cost_prod_inputs', 'cost_lot_adjustments') and cost_can('production', business_id)));

-- =====================================================================
-- 4절. 함수 — 발행 · 잔량 · Actual · Current 교체
-- =====================================================================

/**
 * 대표: 오더 발행 — 그 날(planned_on) 쓰는 BOM 판 × 계획 kg로 작업지시 수량을 만든다(해독은 0063 bom_lines_of).
 * 판이 없으면 cost_bom_missing. 감사는 값 없이(오더 id · 원료 수).
 */
create or replace function cost_production_issue(p_product text, p_planned_on date, p_planned_kg numeric, p_note text default '')
returns text
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_biz text;
  v_ver bigint;
  v_yield numeric;
  v_order text;
  v_n int;
begin
  if not cost_secret.bom_reader(true) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select p.business_id into v_biz from cost_products p where p.product_id = p_product and p.active;
  if v_biz is null or not has_business(v_biz) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_planned_on is null or p_planned_kg is null or p_planned_kg <= 0 or p_planned_kg > 1e9 then
    raise exception 'cost_order_invalid' using errcode = '22023';
  end if;
  v_ver := cost_secret.version_on(p_product, p_planned_on);
  if v_ver is null then
    raise exception 'cost_bom_missing' using errcode = '23514';
  end if;
  select yield_pct into v_yield from cost_secret.bom_versions where version_id = v_ver;
  insert into cost_production_orders (business_id, product_id, planned_on, planned_kg, note, created_by)
  values (v_biz, p_product, p_planned_on, p_planned_kg, left(coalesce(p_note, ''), 500), auth.uid())
  returning order_id into v_order;
  insert into cost_production_order_lines (order_id, material_id, planned_kg)
  select v_order, l.material_id, l.kg_per_kg / (v_yield / 100) * p_planned_kg from cost_secret.bom_lines_of(v_ver) l;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'cost_bom_missing' using errcode = '23514';
  end if;
  return v_order;
end;
$fn$;

/**
 * 구매 LOT 잔량(지금) — 생산 · 구매 · 원가 관리 · 대표. 생산에게는 0061 «제한»과 같은 칸만(landed 원/kg 1원 · 공급처 이름 · LOT 번호).
 * 남은 것만(p_all = false) 또는 전부. 화면은 입고 오래된 순으로 제안한다(FIFO 자동 차감 없음).
 */
create or replace function cost_lot_balances(p_business text, p_all boolean default false)
returns table (lot_id text, material_id text, material_name text, supplier_name text, supplier_lot_no text, received_on date,
               qty_kg numeric, used_kg numeric, adjusted_kg numeric, remaining_kg numeric, landed_krw_per_kg numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not (cost_can('production', p_business) or cost_can('purchasing', p_business) or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select x.lot_id, x.material_id, x.mname, x.sname, x.supplier_lot_no, x.received_on, x.qty_kg, x.used, x.adj,
         x.qty_kg - x.used - x.adj, round(x.landed_krw_per_kg, 0)
    from (select l.lot_id, l.material_id, m.name as mname, s.name as sname, l.supplier_lot_no, l.received_on, l.qty_kg, l.landed_krw_per_kg,
                 coalesce((select sum(i.qty_kg) from cost_prod_inputs i join cost_prod_lots pl on pl.prod_lot_id = i.prod_lot_id
                            where i.lot_id = l.lot_id and i.voided_at is null and pl.voided_at is null), 0) as used,
                 coalesce((select sum(a.qty_kg) from cost_lot_adjustments a where a.lot_id = l.lot_id and a.voided_at is null), 0) as adj
            from cost_purchase_lots l
            join cost_materials m on m.material_id = l.material_id
            join cost_suppliers s on s.supplier_id = l.supplier_id
           where l.business_id = p_business and l.voided_at is null) x
   where p_all or x.qty_kg - x.used - x.adj > 0
   order by x.received_on, x.lot_id
   limit 2000;
end;
$fn$;

/**
 * Actual 원가 — 생산 LOT마다 Σ(투입 kg × LOT landed) ÷ 산출 kg(원래 값으로 계산). 대표 = 원래 값, 원가 관리 = 1원 + 호출마다 감사.
 * 투입이 없는 생산 LOT는 actual = null(0으로 메우지 않는다). 생산 · 구매 · 영업 = cost_not_found.
 */
create or replace function cost_prod_actual(p_business text, p_from date default null, p_to date default null)
returns table (prod_lot_id text, order_id text, product_id text, product_name text, produced_on date, output_kg numeric,
               input_kg numeric, actual_krw_per_kg numeric, computed boolean)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_chair boolean := coalesce(auth_role()::text, '') = 'Chairman';
begin
  if not is_active() or p_business is null or not has_business(p_business)
     or not (v_chair or cost_can('costing', p_business)) or coalesce(auth_role()::text, '') in ('AIAgent', 'Integration') then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if not v_chair then
    if cost_grant('purchasing', p_business, true) then
      raise exception 'cost_role_conflict' using errcode = '42501';
    end if;
    insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
    values ('read', 'cost_products', 'actual:' || p_business, p_business, auth.uid(), auth_role()::text, null,
            jsonb_build_object('kind', 'actual', 'from', p_from, 'to', p_to), '원가 조회(0064) — Actual · 원가 관리 · 호출마다');
  end if;
  return query
  select pl.prod_lot_id, pl.order_id, pl.product_id, p.name, pl.produced_on, pl.output_kg, s.kg,
         cost_secret.shown(s.amt / pl.output_kg, v_chair), s.kg is not null
    from cost_prod_lots pl
    join cost_products p on p.product_id = pl.product_id
    left join lateral (select sum(i.qty_kg) as kg, sum(i.qty_kg * l.landed_krw_per_kg) as amt
                         from cost_prod_inputs i join cost_purchase_lots l on l.lot_id = i.lot_id
                        where i.prod_lot_id = pl.prod_lot_id and i.voided_at is null) s on true
   where pl.business_id = p_business and pl.voided_at is null
     and (p_from is null or pl.produced_on >= p_from) and (p_to is null or pl.produced_on <= p_to)
   order by pl.produced_on desc, pl.prod_lot_id
   limit 1000;
end;
$fn$;

/** 대표: 생산 LOT 하나의 Actual 분해 — 원료 · 구매 LOT · kg · landed · 금액 + 그 원료의 작업지시 수량(배합 이탈 보기). 읽음 감사(값 없이). */
create or replace function cost_prod_actual_breakdown(p_prod_lot text)
returns table (material_id text, material_name text, lot_id text, qty_kg numeric, landed_krw_per_kg numeric, amount_krw numeric,
               planned_kg numeric)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_biz text;
  v_order text;
begin
  if not cost_secret.bom_reader() then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select pl.business_id, pl.order_id into v_biz, v_order from cost_prod_lots pl where pl.prod_lot_id = p_prod_lot;
  if v_biz is null or not has_business(v_biz) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('read', 'cost_bom', 'actual:' || p_prod_lot, v_biz, auth.uid(), auth_role()::text, null, null, 'Actual 분해 열람(0064)');
  return query
  select i.material_id, m.name, i.lot_id, i.qty_kg, l.landed_krw_per_kg, i.qty_kg * l.landed_krw_per_kg, ol.planned_kg
    from cost_prod_inputs i
    join cost_purchase_lots l on l.lot_id = i.lot_id
    join cost_materials m on m.material_id = i.material_id
    left join cost_production_order_lines ol on ol.order_id = v_order and ol.material_id = i.material_id
   where i.prod_lot_id = p_prod_lot and i.voided_at is null
   order by m.name, i.lot_id;
end;
$fn$;

/**
 * 0062 Current 단가 교체 — d 시점 남은 LOT 잔량 가중 landed(재고 이동평균, 설계서 4절). 남은 게 없으면 d 이하 마지막 LOT 단가.
 * Market은 그대로. 지금 저장된 값(매일 최신).
 */
create or replace function cost_secret.unit_price(p_material text, p_kind text, p_on date)
returns numeric
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v numeric;
begin
  if p_kind = 'market' then
    select avg(m.price_krw_per_kg) into v from public.cost_market_prices m
     where m.material_id = p_material and m.voided_at is null
       and m.observed_on = (select max(x.observed_on) from public.cost_market_prices x
                             where x.material_id = p_material and x.observed_on <= p_on and x.voided_at is null);
    return v;
  elsif p_kind = 'current' then
    select sum(r.landed * r.left_kg) / nullif(sum(r.left_kg), 0) into v
      from (select l.landed_krw_per_kg as landed, public.cost_lot_remaining(l.lot_id, p_on) as left_kg
              from public.cost_purchase_lots l
             where l.material_id = p_material and l.voided_at is null and l.received_on <= p_on) r
     where r.left_kg > 0;
    if v is null then
      select l.landed_krw_per_kg into v from public.cost_purchase_lots l
       where l.material_id = p_material and l.voided_at is null and l.received_on <= p_on
       order by l.received_on desc, l.created_at desc limit 1;
    end if;
    return v;
  end if;
  return null;
end;
$fn$;

/** 0061 생산 «제한» LOT 목록에 잔량을 더한다(칸 하나 추가 — 외화 · 부대비 · 연락처는 여전히 없다). */
drop function cost_production_lots(text);
create or replace function cost_production_lots(p_business text)
returns table (lot_id text, material_id text, material_name text, supplier_name text, supplier_lot_no text,
               received_on date, qty_kg numeric, landed_krw_per_kg numeric, remaining_kg numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not (cost_can('production', p_business) or cost_can('purchasing', p_business) or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select l.lot_id, l.material_id, m.name, s.name, l.supplier_lot_no, l.received_on, l.qty_kg, round(l.landed_krw_per_kg, 0),
         cost_lot_remaining(l.lot_id)
    from cost_purchase_lots l
    join cost_materials m on m.material_id = l.material_id
    join cost_suppliers s on s.supplier_id = l.supplier_id
   where l.business_id = p_business and l.voided_at is null
   order by l.received_on desc, l.lot_id
   limit 1000;
end;
$fn$;

revoke all on all functions in schema cost_secret from public, anon, authenticated;
revoke all on function cost_lot_remaining(text, date) from public, anon, authenticated;
revoke all on function cost_prod_lot_fill() from public, anon, authenticated;
revoke all on function cost_lot_draw_check() from public, anon, authenticated;
revoke all on function cost_audit_0064() from public, anon, authenticated;
revoke all on function cost_order_update() from public, anon, authenticated;
revoke all on function cost_production_issue(text, date, numeric, text) from public, anon;
revoke all on function cost_lot_balances(text, boolean) from public, anon;
revoke all on function cost_prod_actual(text, date, date) from public, anon;
revoke all on function cost_prod_actual_breakdown(text) from public, anon;
revoke all on function cost_production_lots(text) from public, anon;
grant execute on function cost_production_issue(text, date, numeric, text) to authenticated;
grant execute on function cost_lot_balances(text, boolean) to authenticated;
grant execute on function cost_prod_actual(text, date, date) to authenticated;
grant execute on function cost_prod_actual_breakdown(text) to authenticated;
grant execute on function cost_production_lots(text) to authenticated;

commit;
