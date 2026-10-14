-- =====================================================================
-- Chairman OS — 0081_blueprint_skeleton (청사진 뼈대: Forecast 원가 · 구매 성과 · 고객별 수익성 · 마진 변동 분해 · 경쟁사 가정 · 작업지시 · 제품 진단)
-- 작성: 2026-10-14 · 설계서 docs/superpowers/specs/2026-10-13-blueprint-skeleton.md · 결정 docs/decisions/2026-10-13-blueprint.md
--
-- ■ 왜 ■ 대표 결정(2026-10-13) «허락 없이 뼈대를 다 만든다. 대표가 나중에 뺀다.» — 원가 엔진(0061~0067) 위에 읽기 · 분석 기능 일곱을
--   한 파일로 더한다. 기능마다 0073 스위치 한 줄(기본 enabled · audience 'chairman') — 모든 새 공개 RPC 첫 줄이 feature_on을 본다.
--
-- ■ 무엇 ■
--   ① Forecast 원가   표 cost_market_outlook(다음 달 시장 전망) · cost_forecast_settings(구매 · 시장 섞는 비율 · 환율 방식)
--                      cost_outlook_set · cost_outlook_list · cost_forecast_setting_set · cost_forecast_setting · cost_forecast_list
--                      단가 = w × 최근 LOT(오늘 환율) + (1 − w) × 다음 달 전망(없으면 오늘 시장가). 대표 원래 값 · 원가 관리 1원.
--   ② 구매 성과        purchase_performance — LOT · 원료 · 공급처 · 월 묶음: 구매가(물건값) · 그날 시장가 · 절감액 · 환율 효과.
--   ③ 고객별 수익성    customer_profit · customer_profit_watch — 0067 판매 × 판매 한 줄 실제 원가(0067과 같은 식). 영업은 본인 판매 매출 · 등급만.
--   ④ 마진 변동 분해   margin_bridge — 두 기간 GM 원/kg 차이 = 판매가 · 원료 · 제조 · 물류 · 기타 효과의 합(정확히).
--   ⑤ 경쟁사 가정      표 cost_competitor_assumptions · competitor_assumption_set · competitor_assumption_list · competitor_price.
--   ⑥ 작업지시         표 cost_work_orders(탱크 · 순서 · 담당 · 이름 가림) · work_order_set · work_order_get · work_order_mine.
--   ⑧ 제품 진단        product_diagnosis(역할별 카드) · product_trend(기간별 추이).
--   (⑦ 진짜 BOM 넣기는 DB가 없다 — 0063 · 0068 그대로.)
--
-- ■ 지키는 것 ■
--   · 0001~0080을 고치지 않는다 — 기존 함수를 다시 만들지 않고(create function만) 표 · 정책도 그대로다.
--     (예외 하나: cost_materials에 AFTER INSERT 트리거를 더한다 — 새 원료에 무작위 코드를 붙이는 것뿐, 표 모양 · 정책은 그대로.)
--   · 새 표 넷: RLS enable · FORCE 없음(0061~0067 원가 표와 같은 결 — 정의자 소유자가 읽는다) · authenticated grant 없음(정의자 함수로만).
--   · 원가 값은 0062 문(cost_secret.cost_gate_biz · cost_gate — 한도 · 감사 · 겸직 거부 · 영업 0시)을 지난 뒤에만. 대표 외 값은 원래 값으로 끝까지
--     계산한 뒤 cost_secret.shown(x, false)(1원). 원료 이름 · 원료별 값 · BOM 비율은 대표 외 출력에 없다(② 구매 성과의 구매 · 원가 관리 · CFO 예외).
--   · 오류: 없는 것 · 권한 없는 것 = cost_not_found(P0002) · 잘못된 인자 = cost_invalid(22023) · 스위치 꺼짐 = feature_off(42501).
--     오류 · 감사 줄에 원료 이름 · 값 · 비율을 넣지 않는다. 이 파일에 raise notice/warning/info는 없다.
--   · 감사 줄의 entity_table은 0067 audit_log_cost_private가 이미 좁히는 이름을 쓴다(전망 = cost_market_prices · 경쟁사 가정 = cost_overheads ·
--     작업지시 = cost_production_orders · 구매 성과 = cost_purchase_lots) — 그 정책을 다시 만들지 않고도 상사 사슬에 새지 않게.
--   · Forecast · 구매 절감 · 경쟁사 가정은 월별 손익(0075)에 들어가지 않는다 — 그 함수들을 부르지도 바꾸지도 않는다(check:blueprint가 잰다).
--
-- ■ 리뷰 고침(2026-10-14) ■ I1 임원 이상 구매 성과 = 달 단위로 넓힘 + LOT 3개 미만 묶음 값 가림(suppressed) · I2 GroupCFO + 영업 줄 = 임원과 같은 제한 ·
--   I3 원료 코드 = 원료마다 무작위 코드(표 cost_secret.material_codes — md5(원료 id) 역산 막기) · I4 Forecast · 고객 · 분해 목록 한도 키를
--   0065 원가 관리 목록('costing:<회사>')과 같이(회사 전체 스냅숏 하루 20번 합계) · M1 없는 id = 스위치보다 먼저 cost_not_found · M2 n_no_fx ·
--   M3 대표 외 분해 b.gm = a.gm + 전체(1원) · M4 수동 환율 모양 먼저 · M5 담당 = 사용 중 · 그 회사 · 생산 줄.
-- ■ 알려진 한계 ■ 작업지시 «원료 이름 가림»(hide_names)은 0064 cost_production_order_lines 직접 select 정책(생산 전원)을 좁힌 뒤에야
--   진짜로 가린다 — 지금은 생산 직원이 그 표에서 material_id를 직접 읽고 0061 원료 표에서 이름을 찾을 수 있다(DEFERRED에 있음).
--   원료 코드는 그래도 material_id에서 다시 계산되지 않는다(I3).
--
-- 0035 규칙: force를 새로 걸지 않는다 · 정책은 늘 to authenticated(이 파일은 정책을 만들지 않는다) · 함수는 public · anon에서 이름으로 회수 ·
--   공개 RPC만 authenticated에 · 내부 함수는 cost_secret(execute 없음).
-- =====================================================================

begin;

-- =====================================================================
-- 0절. 기능 스위치 — 그룹 기본 줄(src/lib/features.ts FEATURES와 같은 키 · 같은 기본값 — check:features가 대조한다)
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'cost_forecast',        true, 'chairman', '기본값(0081)'),
  (null, 'purchase_performance', true, 'chairman', '기본값(0081)'),
  (null, 'customer_profit',      true, 'chairman', '기본값(0081)'),
  (null, 'margin_bridge',        true, 'chairman', '기본값(0081)'),
  (null, 'competitor_price',     true, 'chairman', '기본값(0081)'),
  (null, 'work_orders',          true, 'chairman', '기본값(0081)'),
  (null, 'product_diagnosis',    true, 'chairman', '기본값(0081)')
on conflict do nothing;

-- =====================================================================
-- 1절. 표
-- =====================================================================

create table cost_market_outlook (
  outlook_id       bigint generated always as identity primary key,
  business_id      text not null references businesses(business_id),
  material_id      text not null,
  month            date not null check (extract(day from month) = 1),     -- 그 달 1일
  price            numeric(20, 4) not null check (price > 0),             -- 통화 · kg당
  currency         char(3) not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  fx_rate          numeric(18, 6) check (fx_rate > 0),                    -- 비우면 fx_rates(그 달 1일 이하 최신) — 트리거
  price_krw_per_kg numeric not null default 0,                            -- 트리거가 계산한다(입력값 무시)
  note             text not null default '' check (length(note) <= 300),
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid,
  void_reason      text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  foreign key (material_id, business_id) references cost_materials (material_id, business_id),
  constraint cost_market_outlook_void_shape check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create unique index cost_market_outlook_one_live on cost_market_outlook (material_id, month) where voided_at is null;
comment on table cost_market_outlook is '0081. 원료 다음 달 시장 전망(구매 입력). 고치지 않는다 — 같은 원료 · 달은 무효 + 새 줄. 쓰기 · 읽기는 정의자 함수만.';

create table cost_forecast_settings (
  business_id        text primary key references businesses(business_id),
  blend_purchase_pct numeric not null default 50 check (blend_purchase_pct between 0 and 100),
  fx_mode            text not null default 'today' check (fx_mode in ('today', 'manual')),
  fx_manual          jsonb not null default '{}'::jsonb check (jsonb_typeof(fx_manual) = 'object'),   -- 통화 → 원
  updated_by         uuid,
  updated_at         timestamptz not null default now()
);
comment on table cost_forecast_settings is '0081. Forecast 원가 설정(회사마다 한 줄, 없으면 50% · 오늘 환율). cost_forecast_setting_set(대표)으로만 바꾼다.';

create table cost_competitor_assumptions (
  assumption_id   bigint generated always as identity primary key,
  business_id     text not null references businesses(business_id),
  product_id      text,                                                   -- null = 회사 기본
  mfg_krw_per_kg  numeric check (mfg_krw_per_kg is null or (mfg_krw_per_kg >= 0 and mfg_krw_per_kg <= 1e9)),
  logi_krw_per_kg numeric check (logi_krw_per_kg is null or (logi_krw_per_kg >= 0 and logi_krw_per_kg <= 1e9)),
  margin_pct      numeric check (margin_pct is null or (margin_pct >= 0 and margin_pct <= 60)),
  note            text not null default '' check (length(note) <= 300),
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  foreign key (product_id, business_id) references cost_products (product_id, business_id)
);
create unique index cost_competitor_assumptions_one on cost_competitor_assumptions (business_id, (coalesce(product_id, '')));
comment on table cost_competitor_assumptions is '0081. 경쟁사 가정(제조 · 물류 원/kg · 마진 %). 빈 칸 = 우리 값(제조 · 물류 = 우리 비용 묶음, 마진 = 15). 원가 관리 · 대표.';

create table cost_work_orders (
  order_id   text primary key references cost_production_orders(order_id),
  tank       text check (tank is null or length(tank) <= 40),
  seq        int check (seq is null or seq between 0 and 1000000),
  assignee   uuid,                                                        -- 담당 생산 직원(FK 없이 — 퇴사해도 기록은 남는다)
  hide_names boolean not null default true,                               -- 원료 이름 가림(대표는 늘 보인다)
  updated_by uuid,
  updated_at timestamptz not null default now()
);
comment on table cost_work_orders is '0081. 작업지시(오더마다 탱크 · 순서 · 담당 · 이름 가림). 대표가 work_order_set으로만. 생산은 본인 담당 오더만 work_order_get.';

do $do$
declare
  t text;
begin
  foreach t in array array['cost_market_outlook', 'cost_forecast_settings', 'cost_competitor_assumptions', 'cost_work_orders'] loop
    execute format('alter table %I enable row level security', t);
    -- FORCE는 걸지 않는다(0061 리뷰 C1 · 결정 2). 정책도 grant도 없다 — 정의자 함수만 읽고 쓴다.
    execute format('revoke all on table %I from public, anon, authenticated', t);
  end loop;
end;
$do$;
revoke all on sequence cost_market_outlook_outlook_id_seq, cost_competitor_assumptions_assumption_id_seq from public, anon, authenticated;

-- 리뷰 I3 — 작업지시 원료 코드. 원료마다 무작위(원료 id에서 다시 계산할 수 없다). cost_secret 안 · 정의자 함수만 읽는다(0066 quote_raw와 같은 결).
create table cost_secret.material_codes (
  material_id text primary key references public.cost_materials(material_id),
  code        text not null unique check (code ~ '^R-[0-9A-F]{6}$')
);
alter table cost_secret.material_codes enable row level security;
revoke all on table cost_secret.material_codes from public, anon, authenticated;

-- =====================================================================
-- 2절. 내부 함수(cost_secret — execute 없음)
-- =====================================================================

/** 전망 줄: 넣을 때 원화 환산(0061 cost_fx 재사용). 고칠 때는 무효 칸 셋만. */
create function cost_secret.outlook_calc() returns trigger
language plpgsql set search_path = public, cost_secret, pg_temp as $fn$
begin
  if tg_op = 'INSERT' then
    new.fx_rate := cost_fx(new.currency, new.month, new.fx_rate);
    new.price_krw_per_kg := new.price * new.fx_rate;
    return new;
  end if;
  if old.voided_at is not null
     or (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason') is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  return new;
end;
$fn$;
create trigger cost_market_outlook_calc before insert or update on cost_market_outlook
  for each row execute function cost_secret.outlook_calc();

/**
 * 원료 하나에 무작위 코드를 붙인다(이미 있으면 그대로). 코드가 겹치면 다시 뽑는다(최대 50번 — 16⁶ 칸이라 사실상 한 번).
 * 리뷰 I3 — 예전 'R-' + md5(원료 id)는 생산이 0061 cost_production_materials로 원료 id를 알면 다시 계산할 수 있었다.
 */
create function cost_secret.material_code_ensure(p_material text) returns void
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  i int;
begin
  for i in 1 .. 50 loop
    if exists (select 1 from cost_secret.material_codes c where c.material_id = p_material) then
      return;
    end if;
    insert into cost_secret.material_codes (material_id, code)
    values (p_material, 'R-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)))
    on conflict do nothing;
  end loop;
  raise exception 'cost_invalid' using errcode = '22023';
end;
$fn$;

/** 새 원료 → 코드(AFTER INSERT). */
create function cost_secret.material_code_new() returns trigger
language plpgsql security definer set search_path = public, cost_secret, pg_temp as $fn$
begin
  perform cost_secret.material_code_ensure(new.material_id);
  return null;
end;
$fn$;

do $do$
declare
  m text;
begin
  for m in select x.material_id from public.cost_materials x order by x.material_id loop
    perform cost_secret.material_code_ensure(m);
  end loop;
end;
$do$;

create trigger cost_materials_code after insert on cost_materials
  for each row execute function cost_secret.material_code_new();

/** 원료 코드 — 표에서 읽는다(없으면 'R-??????'). 결정 12 → 리뷰 I3(무작위). */
create function cost_secret.mat_code(p_material text) returns text
language sql stable set search_path = pg_temp as $fn$
  select coalesce((select c.code from cost_secret.material_codes c where c.material_id = p_material), 'R-??????');
$fn$;

/** 제품 진단 카드 한 장. 값이 없으면 state 'no_data' + 필요한 것(0을 넣지 않는다). */
create function cost_secret.diag_card(p_id int, p_key text, p_value jsonb, p_need text) returns jsonb
language sql immutable set search_path = pg_temp as $fn$
  select jsonb_build_object('id', p_id, 'key', p_key,
                            'state', case when p_value is null then 'no_data' else 'ok' end,
                            'value', p_value,
                            'need', case when p_value is null then p_need end);
$fn$;

/**
 * Forecast 단가(원/kg, 원래 값). 구매 쪽 P = 가장 최근 살아 있는 LOT의 unit_price × 지금 환율 + 부대비 ÷ kg.
 * 지금 환율 = KRW 1 · 설정 manual이고 그 통화가 있으면 그 값 · 아니면 p_on 이하 최신 fx_rates(없으면 P 없음 — 0061 cost_fx와 같은 찾기, 오류 대신 null).
 * 시장 쪽 M = 다음 달 살아 있는 전망, 없으면 p_on 시장가(0062 unit_price market). 둘 다 = w × P + (1 − w) × M · 하나 = 그 값 · 없음 = null.
 */
create function cost_secret.forecast_unit(p_material text, p_on date, p_business text) returns numeric
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  s record;
  l record;
  v_fx numeric;
  v_p numeric;
  v_m numeric;
  v_w numeric;
begin
  select f.blend_purchase_pct, f.fx_mode, f.fx_manual into s from public.cost_forecast_settings f where f.business_id = p_business;
  v_w := coalesce(s.blend_purchase_pct, 50) / 100.0;
  select x.unit_price, x.currency::text as currency, x.qty_kg, x.freight_krw, x.duty_krw, x.other_krw into l
    from public.cost_purchase_lots x
   where x.material_id = p_material and cost_secret.known(x.created_at, x.voided_at)
   order by x.received_on desc, x.created_at desc
   limit 1;
  if l.unit_price is not null then
    if l.currency = 'KRW' then
      v_fx := 1;
    elsif s.fx_mode = 'manual' and s.fx_manual ? l.currency and jsonb_typeof(s.fx_manual -> l.currency) = 'number' then
      v_fx := (s.fx_manual ->> l.currency)::numeric;
    else
      select r.rate into v_fx from public.fx_rates r
       where r.base = l.currency and r.quote = 'KRW' and r.rate_date <= p_on
       order by r.rate_date desc limit 1;
    end if;
    if v_fx is not null then
      v_p := l.unit_price * v_fx + (l.freight_krw + l.duty_krw + l.other_krw) / l.qty_kg;
    end if;
  end if;
  select o.price_krw_per_kg into v_m from public.cost_market_outlook o
   where o.material_id = p_material and o.voided_at is null
     and o.month = (date_trunc('month', p_on::timestamp) + interval '1 month')::date;
  if v_m is null then
    v_m := cost_secret.unit_price(p_material, 'market', p_on);
  end if;
  if v_p is not null and v_m is not null then
    return v_w * v_p + (1 - v_w) * v_m;
  end if;
  return coalesce(v_p, v_m);
end;
$fn$;

/** 제품 Forecast 원료비(원/kg, 원래 값) · 단가 없는 원료 수(-1 = BOM 없음). 하나라도 없으면 null(0으로 메우지 않는다). */
create function cost_secret.forecast_material(p_product text, p_on date, p_business text, out total numeric, out missing int)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_ver bigint := cost_secret.version_on(p_product, p_on);
  v_yield numeric;
  v_n int;
begin
  if v_ver is null then
    total := null; missing := -1; return;
  end if;
  select b.yield_pct into v_yield from cost_secret.bom_versions b where b.version_id = v_ver;
  select sum(x.q * x.f), count(*) filter (where x.f is null)::int, count(*)::int into total, missing, v_n
    from (select l.kg_per_kg / (v_yield / 100) as q, cost_secret.forecast_unit(l.material_id, p_on, p_business) as f
            from cost_secret.bom_lines_of(v_ver) l) x;
  if v_n = 0 then
    total := null; missing := -1; return;
  end if;
  if missing > 0 then total := null; end if;
end;
$fn$;

/** 회사의 사용 중 원료(+ 그 날 BOM에 든 단종 원료) 전부에 Forecast 단가가 있는가 — 대표 외 «계산됨»의 문(0063 business_complete와 같은 결). */
create function cost_secret.forecast_complete(p_business text, p_on date) returns boolean
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_gap text[];
begin
  if exists (select 1 from public.cost_materials m
              where m.business_id = p_business and m.active
                and cost_secret.forecast_unit(m.material_id, p_on, p_business) is null) then
    return false;
  end if;
  select array_agg(m.material_id) into v_gap from public.cost_materials m
   where m.business_id = p_business and not m.active
     and cost_secret.forecast_unit(m.material_id, p_on, p_business) is null;
  if v_gap is null then
    return true;
  end if;
  return not exists (
    select 1
      from (select cost_secret.version_on(p.product_id, p_on) as v from public.cost_products p where p.business_id = p_business) cur
      cross join lateral cost_secret.bom_lines_of(cur.v) l
     where cur.v is not null and l.material_id = any (v_gap));
end;
$fn$;

/**
 * 판매 한 줄씩 실제 원가(원래 값) — 문 통과 뒤에만. 0067 cost_margins와 같은 식(cost_secret.sale_actual · 같은 완전성 판정)에
 * 원료비 · 비용 묶음(제조 · 물류 · 기타 = 포장 + 간접비)을 따로 더해 준다(④ 분해용). total_raw = mat_raw + mfg + logi + other(계산된 줄).
 */
create function cost_secret.sale_costs(p_business text, p_from date, p_to date, p_product text, p_chairman boolean)
returns table (sale_id text, shipped_on date, created_by uuid, customer text, product_id text, product_name text, kg numeric, price numeric,
               source text, total_raw numeric, mat_raw numeric, mfg numeric, logi numeric, other numeric)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
declare
  v_complete boolean;
begin
  v_complete := p_chairman or cost_secret.business_complete(p_business, 'current', cost_today());
  return query
  select s.sale_id, s.shipped_on, s.created_by, s.customer_company, s.product_id, s.product_name, s.kg, s.price_krw_per_kg,
         a.source, a.total_raw,
         case when a.total_raw is not null then mt.v end,
         case when a.total_raw is null then null when o.ready then o.mfg else 0 end,
         case when a.total_raw is null then null when o.ready then o.logi else 0 end,
         case when a.total_raw is null then null when o.ready then o.pack + o.indirect else 0 end
    from public.cost_sales s
    cross join lateral (select (p_chairman or (v_complete and cost_secret.business_complete(s.business_id, 'current', s.shipped_on))) as ok) c
    cross join lateral cost_secret.sale_actual(s.business_id, s.product_id, s.shipped_on, s.prod_lot_id, c.ok) a
    cross join lateral (
      select case
               when s.prod_lot_id is not null then (
                 select sum(i.qty_kg * l.landed_krw_per_kg) / max(pl.output_kg)
                   from public.cost_prod_lots pl
                   join public.cost_prod_inputs i on i.prod_lot_id = pl.prod_lot_id and i.voided_at is null
                   join public.cost_purchase_lots l on l.lot_id = i.lot_id
                  where pl.prod_lot_id = s.prod_lot_id and pl.voided_at is null)
               when c.ok then (select x.total from cost_secret.material_cost(s.product_id, 'current', s.shipped_on) x)
             end as v) mt
    cross join lateral cost_secret.overhead(s.business_id, s.product_id, s.shipped_on) o
   where s.business_id = p_business and s.voided_at is null and s.shipped_on between p_from and p_to
     and (p_product is null or s.product_id = p_product);
end;
$fn$;

/**
 * 마진 변동 분해(④) — 두 기간 kg 가중 평균(원/kg). 대표 = 원래 값 + 원료별(제품 지정 시), 대표 외 = 1원 · 효과 다섯을 반올림한 뒤
 * 가장 큰 절댓값 하나에 차이를 몰아 합 = 반올림한 전체. 원가가 계산 안 된 판매는 두 기간 모두 빼고 n_excluded로 센다.
 */
create function cost_secret.bridge_calc(p_business text, p_from_a date, p_to_a date, p_from_b date, p_to_b date, p_product text, p_chairman boolean)
returns jsonb
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  a record;
  b record;
  v_ga numeric;
  v_gb numeric;
  e_price numeric;
  e_mat numeric;
  e_mfg numeric;
  e_logi numeric;
  e_other numeric;
  v_total numeric;
  v_eff jsonb;
  v_keys text[] := array['price', 'material', 'mfg', 'logi', 'other'];
  v_vals numeric[];
  v_big int := 1;
  v_diff numeric;
  i int;
  v_ver bigint;
  v_yield numeric;
  v_mats jsonb;
begin
  select (count(*) filter (where c.total_raw is not null))::int as n, (count(*) filter (where c.total_raw is null))::int as excl,
         sum(c.kg) filter (where c.total_raw is not null) as kg,
         sum(c.kg * c.price) filter (where c.total_raw is not null) / nullif(sum(c.kg) filter (where c.total_raw is not null), 0) as price,
         sum(c.kg * c.mat_raw) filter (where c.total_raw is not null) / nullif(sum(c.kg) filter (where c.total_raw is not null), 0) as mat,
         sum(c.kg * c.mfg) filter (where c.total_raw is not null) / nullif(sum(c.kg) filter (where c.total_raw is not null), 0) as mfg,
         sum(c.kg * c.logi) filter (where c.total_raw is not null) / nullif(sum(c.kg) filter (where c.total_raw is not null), 0) as logi,
         sum(c.kg * c.other) filter (where c.total_raw is not null) / nullif(sum(c.kg) filter (where c.total_raw is not null), 0) as oth
    into a from cost_secret.sale_costs(p_business, p_from_a, p_to_a, p_product, p_chairman) c;
  select (count(*) filter (where c.total_raw is not null))::int as n, (count(*) filter (where c.total_raw is null))::int as excl,
         sum(c.kg) filter (where c.total_raw is not null) as kg,
         sum(c.kg * c.price) filter (where c.total_raw is not null) / nullif(sum(c.kg) filter (where c.total_raw is not null), 0) as price,
         sum(c.kg * c.mat_raw) filter (where c.total_raw is not null) / nullif(sum(c.kg) filter (where c.total_raw is not null), 0) as mat,
         sum(c.kg * c.mfg) filter (where c.total_raw is not null) / nullif(sum(c.kg) filter (where c.total_raw is not null), 0) as mfg,
         sum(c.kg * c.logi) filter (where c.total_raw is not null) / nullif(sum(c.kg) filter (where c.total_raw is not null), 0) as logi,
         sum(c.kg * c.other) filter (where c.total_raw is not null) / nullif(sum(c.kg) filter (where c.total_raw is not null), 0) as oth
    into b from cost_secret.sale_costs(p_business, p_from_b, p_to_b, p_product, p_chairman) c;

  if a.n = 0 or b.n = 0 then
    return jsonb_build_object('a', null, 'b', null, 'effects', null, 'total', null, 'material_pct', null,
                              'n_excluded', a.excl + b.excl, 'reason', '자료 없음 · 필요한 것: 두 기간 판매 · 원가', 'materials', null);
  end if;

  v_ga := a.price - a.mat - a.mfg - a.logi - a.oth;
  v_gb := b.price - b.mat - b.mfg - b.logi - b.oth;
  e_price := b.price - a.price;
  e_mat := -(b.mat - a.mat);
  e_mfg := -(b.mfg - a.mfg);
  e_logi := -(b.logi - a.logi);
  e_other := -(b.oth - a.oth);
  v_total := v_gb - v_ga;   -- = 효과 다섯의 합(numeric 덧셈 · 뺄셈은 정확하다)

  if p_chairman then
    v_eff := jsonb_build_object('price', e_price, 'material', e_mat, 'mfg', e_mfg, 'logi', e_logi, 'other', e_other);
  else
    v_vals := array[round(e_price), round(e_mat), round(e_mfg), round(e_logi), round(e_other)];
    for i in 2 .. 5 loop
      if abs((array[e_price, e_mat, e_mfg, e_logi, e_other])[i]) > abs((array[e_price, e_mat, e_mfg, e_logi, e_other])[v_big]) then
        v_big := i;
      end if;
    end loop;
    v_diff := round(v_total) - (v_vals[1] + v_vals[2] + v_vals[3] + v_vals[4] + v_vals[5]);
    v_vals[v_big] := v_vals[v_big] + v_diff;
    v_eff := jsonb_build_object(v_keys[1], v_vals[1], v_keys[2], v_vals[2], v_keys[3], v_vals[3], v_keys[4], v_vals[4], v_keys[5], v_vals[5]);
  end if;

  -- 대표만: 제품 지정 시 그 제품 BOM(기간 B 끝 날 판)의 원료별 q × Δ단가(Current, 기간 A 끝 → B 끝) 상위 10. 결정 14.
  if p_chairman and p_product is not null then
    v_ver := cost_secret.version_on(p_product, p_to_b);
    if v_ver is not null then
      select bv.yield_pct into v_yield from cost_secret.bom_versions bv where bv.version_id = v_ver;
      select jsonb_agg(jsonb_build_object('material_id', z.material_id, 'material_name', z.name, 'delta_krw_per_kg', z.d) order by abs(z.d) desc)
        into v_mats
        from (select y.material_id, y.name, y.d from (
                select l.material_id, m.name,
                       (l.kg_per_kg / (v_yield / 100)) * (cost_secret.unit_price(l.material_id, 'current', p_to_b)
                                                          - cost_secret.unit_price(l.material_id, 'current', p_to_a)) as d
                  from cost_secret.bom_lines_of(v_ver) l
                  join public.cost_materials m on m.material_id = l.material_id) y
               where y.d is not null
               order by abs(y.d) desc
               limit 10) z;
    end if;
  end if;

  return jsonb_build_object(
    'a', jsonb_build_object('price', cost_secret.shown(a.price, p_chairman), 'material', cost_secret.shown(a.mat, p_chairman),
                            'mfg', cost_secret.shown(a.mfg, p_chairman), 'logi', cost_secret.shown(a.logi, p_chairman),
                            'other', cost_secret.shown(a.oth, p_chairman), 'gm', cost_secret.shown(v_ga, p_chairman),
                            'gm_pct', case when a.price > 0 then round(v_ga / a.price * 100, 1) end, 'kg', a.kg, 'n', a.n),
    'b', jsonb_build_object('price', cost_secret.shown(b.price, p_chairman), 'material', cost_secret.shown(b.mat, p_chairman),
                            'mfg', cost_secret.shown(b.mfg, p_chairman), 'logi', cost_secret.shown(b.logi, p_chairman),
                            'other', cost_secret.shown(b.oth, p_chairman),
                            -- 리뷰 M3 — 대표 외는 b.gm = a.gm(1원) + 전체(1원)로 표가 맞아떨어지게.
                            'gm', case when p_chairman then v_gb else cost_secret.shown(v_ga, false) + cost_secret.shown(v_total, false) end,
                            'gm_pct', case when b.price > 0 then round(v_gb / b.price * 100, 1) end, 'kg', b.kg, 'n', b.n),
    'effects', v_eff,
    'total', cost_secret.shown(v_total, p_chairman),
    'material_pct', case when a.mat > 0 then round((b.mat / a.mat - 1) * 100, 1) end,
    'n_excluded', a.excl + b.excl,
    'reason', null,
    'materials', case when p_chairman and p_product is not null then coalesce(v_mats, '[]'::jsonb) end);
end;
$fn$;

/**
 * 경쟁사(⑤) — 원래 값. 경쟁사 원가 = Market 원료비 + 경쟁사 제조 + 경쟁사 물류, 최소가 = 원가 ÷ (1 − 마진/100).
 * 빈 칸: 제품 줄 → 회사 기본 줄 → 우리 값(제조 · 물류 = 우리 비용 묶음 · 비용 줄이 아예 없으면 0, 마진 = 15).
 * our_total = 0065 sales_row total_raw(우리 총원가). 대표 외는 회사 완전성(p_ok)이 없으면 계산하지 않는다.
 */
create function cost_secret.competitor_calc(p_product text, p_business text, p_on date, p_chairman boolean, p_ok boolean,
  out comp_min numeric, out our_total numeric, out margin_at numeric, out has_assumption boolean)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_mk numeric;
  o record;
  pa record;
  da record;
  v_mfg numeric;
  v_logi numeric;
  v_margin numeric;
begin
  has_assumption := exists (select 1 from public.cost_competitor_assumptions x
                             where x.business_id = p_business and (x.product_id is null or x.product_id = p_product));
  if not (p_chairman or p_ok) then
    return;
  end if;
  select x.total into v_mk from cost_secret.material_cost(p_product, 'market', p_on) x;
  select * into o from cost_secret.overhead(p_business, p_product, p_on);
  select x.mfg_krw_per_kg, x.logi_krw_per_kg, x.margin_pct into pa from public.cost_competitor_assumptions x
   where x.business_id = p_business and x.product_id = p_product;
  select x.mfg_krw_per_kg, x.logi_krw_per_kg, x.margin_pct into da from public.cost_competitor_assumptions x
   where x.business_id = p_business and x.product_id is null;
  v_mfg := coalesce(pa.mfg_krw_per_kg, da.mfg_krw_per_kg, case when o.ready then o.mfg when not coalesce(o.has_lines, false) then 0 end);
  v_logi := coalesce(pa.logi_krw_per_kg, da.logi_krw_per_kg, case when o.ready then o.logi when not coalesce(o.has_lines, false) then 0 end);
  v_margin := coalesce(pa.margin_pct, da.margin_pct, 15);
  comp_min := (v_mk + v_mfg + v_logi) / (1 - v_margin / 100);
  select x.total_raw into our_total from cost_secret.sales_row(p_product, p_business, p_on, p_chairman, p_ok, false) x;
  if comp_min > 0 and our_total is not null then
    margin_at := (comp_min - our_total) / comp_min * 100;
  end if;
end;
$fn$;

-- =====================================================================
-- 3절. ① Forecast 원가
-- =====================================================================

/** 구매(쓰기) · 대표: 원료 다음 달 전망 넣기. 같은 원료 · 달 살아 있는 줄은 무효 + 새 줄. 감사(값 없이 — 전망 id · 달 · 통화). */
create function cost_outlook_set(p_material text, p_month date, p_price numeric, p_currency text, p_fx numeric, p_note text default '')
returns bigint
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_biz text;
  v_id bigint;
  v_cur text := upper(btrim(coalesce(p_currency, 'KRW')));
begin
  select m.business_id into v_biz from cost_materials m where m.material_id = p_material;
  -- 리뷰 M1 — 없는 id · 남의 회사 id는 스위치보다 먼저 cost_not_found(feature_off로 다른 회사 id를 떠보지 못하게).
  if v_biz is null or not coalesce(has_business(v_biz), false) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(feature_on('cost_forecast', v_biz), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if v_biz is null or not cost_can('purchasing', v_biz, true) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_month is null or p_month <> date_trunc('month', p_month::timestamp)::date
     or p_price is null or p_price <= 0 or p_price > 1e9
     or v_cur !~ '^[A-Z]{3}$'
     or (p_fx is not null and (p_fx <= 0 or p_fx > 1e6))
     or length(coalesce(p_note, '')) > 300
     or (v_cur <> 'KRW' and p_fx is null
         and not exists (select 1 from fx_rates r where r.base = v_cur and r.quote = 'KRW' and r.rate_date <= p_month)) then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  update cost_market_outlook set voided_at = now(), voided_by = auth.uid(), void_reason = '새 전망으로 교체'
   where material_id = p_material and month = p_month and voided_at is null;
  insert into cost_market_outlook (business_id, material_id, month, price, currency, fx_rate, note, created_by)
  values (v_biz, p_material, p_month, p_price, v_cur, p_fx, coalesce(p_note, ''), auth.uid())
  returning outlook_id into v_id;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('create', 'cost_market_prices', 'outlook:' || v_id, v_biz, auth.uid(), auth_role()::text, null,
          jsonb_build_object('outlook_id', v_id, 'month', p_month, 'currency', v_cur), '시장 전망 입력(0081)');
  return v_id;
end;
$fn$;

/** 구매 · 원가 관리 · 대표: 회사의 살아 있는 전망(원료 이름 포함 — 원료 표를 이미 읽는 사람). */
create function cost_outlook_list(p_business text)
returns table (outlook_id bigint, material_id text, material_name text, month date, price numeric, currency text, fx_rate numeric,
               price_krw_per_kg numeric, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
begin
  if not coalesce(feature_on('cost_forecast', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_business is null or not (cost_can('purchasing', p_business) or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select o.outlook_id, o.material_id, m.name, o.month, o.price, o.currency::text, o.fx_rate, o.price_krw_per_kg, o.note, o.created_at
    from cost_market_outlook o
    join cost_materials m on m.material_id = o.material_id
   where o.business_id = p_business and o.voided_at is null
   order by o.month desc, m.name
   limit 2000;
end;
$fn$;

/** 대표만: Forecast 설정(섞는 비율 · 환율 방식 · 수동 환율). 감사(값 그대로 — 원가 · 원료 값이 아니다). */
create function cost_forecast_setting_set(p_business text, p_blend_pct numeric, p_fx_mode text, p_fx_manual jsonb)
returns void
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_manual jsonb := coalesce(p_fx_manual, '{}'::jsonb);
begin
  if not coalesce(feature_on('cost_forecast', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if not coalesce(is_active(), false) or coalesce(auth_role()::text, '') <> 'Chairman' or p_business is null or not coalesce(has_business(p_business), false)
     or not exists (select 1 from businesses where business_id = p_business) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  -- 리뷰 M4 — 모양을 먼저 따로 본다(배열 · 글자에 jsonb_each를 부르지 않게).
  if jsonb_typeof(v_manual) <> 'object' then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  if p_blend_pct is null or p_blend_pct < 0 or p_blend_pct > 100 or coalesce(p_fx_mode, '') not in ('today', 'manual')
     or exists (select 1 from jsonb_each(v_manual) e
                 where e.key !~ '^[A-Z]{3}$'
                    or coalesce(case when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric end, 0) not between 0.000001 and 1000000) then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  insert into cost_forecast_settings (business_id, blend_purchase_pct, fx_mode, fx_manual, updated_by, updated_at)
  values (p_business, p_blend_pct, p_fx_mode, v_manual, auth.uid(), now())
  on conflict (business_id) do update set blend_purchase_pct = excluded.blend_purchase_pct, fx_mode = excluded.fx_mode,
    fx_manual = excluded.fx_manual, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'cost_forecast_settings', p_business, p_business, auth.uid(), auth_role()::text, null,
          jsonb_build_object('blend_purchase_pct', p_blend_pct, 'fx_mode', p_fx_mode, 'fx_manual', v_manual), 'Forecast 설정(0081)');
end;
$fn$;

/** 대표 · 원가 관리: Forecast 설정(줄이 없으면 기본값 · is_default). */
create function cost_forecast_setting(p_business text)
returns table (business_id text, blend_purchase_pct numeric, fx_mode text, fx_manual jsonb, updated_at timestamptz, is_default boolean)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
begin
  if not coalesce(feature_on('cost_forecast', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_business is null or not (coalesce(auth_role()::text, '') = 'Chairman' and coalesce(is_active(), false) and coalesce(has_business(p_business), false)
                                or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select p_business, coalesce(s.blend_purchase_pct, 50::numeric), coalesce(s.fx_mode, 'today'), coalesce(s.fx_manual, '{}'::jsonb), s.updated_at, s.business_id is null
    from (select 1) one
    left join cost_forecast_settings s on s.business_id = p_business;
end;
$fn$;

/**
 * 대표 · 원가 관리: 제품마다 Forecast 원료비 · 총원가(원/kg). 문 = cost_gate_biz('costing:<회사>' — 0065 원가 관리 목록과 같은 키 · 하루 20번 합계 · 호출마다 감사 · 겸직 거부).
 * 대표 = 원래 값 · 이유(no_bom · price_missing · overhead_not_ready). 원가 관리 = 1원 · 이유 not_computed 하나 ·
 * 회사 원료 전부에 Forecast 단가가 있을 때만 계산(하나라도 없으면 그 회사 전 제품 not_computed — 0062 business_complete와 같은 결).
 */
create function cost_forecast_list(p_business text)
returns table (product_id text, product_name text, as_of date, forecast_material_krw_per_kg numeric, forecast_total_krw_per_kg numeric,
               computed boolean, reason text)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
declare
  g record;
  v_ok boolean;
begin
  if not coalesce(feature_on('cost_forecast', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_business is null or not (coalesce(auth_role()::text, '') = 'Chairman' or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  -- 리뷰 I4 — 0065 cost_costing_list와 같은 키 · 종류(회사 전체 스냅숏은 화면이 몇 개든 하루 20번 합계).
  select * into g from cost_secret.cost_gate_biz(p_business, 'costing:' || p_business, 'costing_list', null);
  v_ok := g.chairman or cost_secret.forecast_complete(p_business, g.as_of);
  return query
  select p.product_id, p.name, g.as_of,
         case when v_ok then cost_secret.shown(f.total, g.chairman) end,
         case when v_ok then cost_secret.shown(t.total, g.chairman) end,
         v_ok and t.total is not null,
         case when v_ok and t.total is not null then null
              when not g.chairman then 'not_computed'
              when f.missing = -1 then 'no_bom'
              when f.total is null then 'price_missing'
              else 'overhead_not_ready' end
    from cost_products p
    cross join lateral cost_secret.forecast_material(p.product_id, g.as_of, p_business) f
    cross join lateral cost_secret.overhead(p_business, p.product_id, g.as_of) o
    cross join lateral (select case when f.total is null then null
                                    when o.ready then f.total + o.total
                                    when coalesce(o.has_lines, false) then null
                                    else f.total end as total) t
   where p.business_id = p_business and p.active
   order by p.name
   limit 500;
end;
$fn$;

-- =====================================================================
-- 4절. ② 구매 성과
-- =====================================================================

/**
 * LOT(입고일이 기간 안 · 살아 있는 LOT)마다: 구매가 = unit_price × LOT 환율(물건값 — 결정 5) · 그날 시장가(0061 cost_market_on — 입고일 이하 최신 ·
 * 같은 날 여러 출처 평균) · 절감액 = (시장가 − 구매가) × kg · 환율 효과 = 외화 LOT만 (LOT 환율 − 입고월 fx_rates 평균) × 물건값(통화)(결정 6).
 * 묶음 합계는 원래 값끼리 더한 뒤 1원(round — 원가가 아니다). 시장가 · 기준 환율이 없으면 그 LOT의 그 값은 null(0이 아니다).
 * 보는 사람(리뷰 I1 · I2):
 *   전부 보기 = 대표 · 구매 줄 · 원가 관리 줄 · 영업 줄 없는 GroupCFO — 모든 묶음.
 *   제한 보기 = BusinessCEO · Executive · 영업 줄 있는 GroupCFO — 'month'만 · 기간은 앞뒤 달 전체로 넓힘(하루 창으로 LOT 하나를 떼지 못하게) ·
 *              LOT 3개 미만 묶음은 금액 · kg 칸 null + suppressed = true(n_lots는 남긴다).
 *   (영업 줄 + 구매 줄은 전부 보기 그대로 — 0062 문이 그 사람에게 영업 원가를 이미 거부하고, 원료 표는 원래 읽는다.)
 *   그 밖 = cost_not_found.
 * n_no_fx = 외화 LOT 중 입고월 기준 환율(fx_rates 평균)이 없는 수(리뷰 M2). 새 칸은 맨 끝.
 * 감사: 대표 외 호출마다 한 줄(값 없이).
 */
create function purchase_performance(p_business text, p_from date, p_to date, p_by text)
returns table (key text, label text, n_lots int, qty_kg numeric, purchase_krw numeric, market_krw numeric, savings_krw numeric,
               fx_effect_krw numeric, n_no_market int, suppressed boolean, n_no_fx int)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
declare
  v_role text := coalesce(auth_role()::text, '');
  v_in boolean;
  v_full boolean;
  v_limited boolean;
  v_from date := p_from;
  v_to date := p_to;
begin
  if not coalesce(feature_on('purchase_performance', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_business is null or p_from is null or p_to is null or p_from > p_to or p_to - p_from > 1100
     or coalesce(p_by, '') not in ('lot', 'material', 'supplier', 'month') then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  v_in := coalesce(is_active(), false) and coalesce(has_business(p_business), false) and v_role not in ('AIAgent', 'Integration', '');
  v_full := v_in and (v_role = 'Chairman' or cost_can('purchasing', p_business) or cost_can('costing', p_business)
                      or (v_role = 'GroupCFO' and not coalesce(cost_grant('sales', p_business), false)));
  v_limited := v_in and not v_full and v_role in ('BusinessCEO', 'Executive', 'GroupCFO');
  if not (v_full or (v_limited and p_by = 'month')) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if not v_full then
    v_from := date_trunc('month', p_from::timestamp)::date;
    v_to := (date_trunc('month', p_to::timestamp) + interval '1 month' - interval '1 day')::date;
  end if;
  if v_role <> 'Chairman' then
    insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
    values ('read', 'cost_purchase_lots', 'performance:' || p_business, p_business, auth.uid(), v_role, null,
            jsonb_build_object('by', p_by, 'from', v_from, 'to', v_to), '구매 성과 조회(0081)');
  end if;
  return query
  with l as (
    select x.lot_id, x.material_id, x.supplier_id, x.received_on, x.qty_kg as q,
           x.unit_price * x.fx_rate as buy,
           cost_market_on(x.material_id, x.received_on) as mkt,
           case when x.currency = 'KRW' then 0::numeric else (x.fx_rate - fb.v) * x.unit_price * x.qty_kg end as fxe,
           (x.currency <> 'KRW' and fb.v is null) as no_fx
      from cost_purchase_lots x
      left join lateral (
        select avg(r.rate) as v from fx_rates r
         where r.base = x.currency::text and r.quote = 'KRW'
           and r.rate_date >= date_trunc('month', x.received_on::timestamp)::date
           and r.rate_date < (date_trunc('month', x.received_on::timestamp) + interval '1 month')::date) fb on true
     where x.business_id = p_business and x.voided_at is null and x.received_on between v_from and v_to
  ), b as (
    select case p_by when 'lot' then l.lot_id when 'material' then l.material_id when 'supplier' then l.supplier_id
                     else to_char(l.received_on, 'YYYY-MM') end as k,
           case p_by when 'lot' then l.lot_id || ' · ' || mt.name || ' · ' || to_char(l.received_on, 'YYYY-MM-DD')
                     when 'material' then mt.name when 'supplier' then sp.name
                     else to_char(l.received_on, 'YYYY-MM') end as lb,
           l.q, l.buy, l.mkt, l.fxe, l.no_fx
      from l
      join cost_materials mt on mt.material_id = l.material_id
      join cost_suppliers sp on sp.supplier_id = l.supplier_id
  ), g as (
    select b.k, max(b.lb) as lb, count(*)::int as n, sum(b.q) as q, round(sum(b.buy * b.q)) as buy, round(sum(b.mkt * b.q)) as mkt,
           round(sum((b.mkt - b.buy) * b.q)) as sav, round(sum(b.fxe)) as fxe, (count(*) filter (where b.mkt is null))::int as nm,
           (count(*) filter (where b.no_fx))::int as nf
      from b
     group by b.k
  )
  select g.k, g.lb, g.n,
         case when v_full or g.n >= 3 then g.q end,
         case when v_full or g.n >= 3 then g.buy end,
         case when v_full or g.n >= 3 then g.mkt end,
         case when v_full or g.n >= 3 then g.sav end,
         case when v_full or g.n >= 3 then g.fxe end,
         g.nm,
         not (v_full or g.n >= 3),
         g.nf
    from g
   order by g.k
   limit 5000;
end;
$fn$;

-- =====================================================================
-- 5절. ③ 고객별 수익성
-- =====================================================================

/**
 * 대표 · 원가 관리(GroupCFO도 원가 관리 줄이 있어야 — 결정 8): 고객(customer_company)별 판매 · kg · 매출 · 매출원가 · GM · GM% · 등급 ·
 * 원가 근거(생산 LOT Actual · Current 추정 · 계산 안 됨). 문 = cost_gate_biz('costing:<회사>' — 0065와 같은 키). 대표 외 금액 1원.
 * 영업(원가 관리 줄 없음): 본인 판매만(0067 sale_visible · 만든 사람 = 나) 고객별 판매 수 · kg · 매출 · 가장 최근 판매의 기록 등급 — 원가 칸은 null.
 * 0075 월 매출원가와 섞지 않는다(결정 7).
 */
create function customer_profit(p_business text, p_from date, p_to date)
returns table (customer text, n_sales int, kg numeric, revenue_krw numeric, cogs_krw numeric, gm_krw numeric, gm_pct numeric, grade text,
               n_actual int, n_estimated int, n_uncomputed int, basis text)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
declare
  g record;
begin
  if not coalesce(feature_on('customer_profit', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_business is null or p_from is null or p_to is null or p_from > p_to or p_to - p_from > 1100 then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  if coalesce(auth_role()::text, '') = 'Chairman' or cost_can('costing', p_business) then
    select * into g from cost_secret.cost_gate_biz(p_business, 'costing:' || p_business, 'costing_list', null);   -- 리뷰 I4
    return query
    select c.customer, count(*)::int, sum(c.kg),
           cost_secret.shown(sum(c.kg * c.price), g.chairman),
           cost_secret.shown(sum(c.kg * c.total_raw), g.chairman),
           cost_secret.shown(sum(c.kg * (c.price - c.total_raw)), g.chairman),
           round(sum(c.kg * (c.price - c.total_raw)) / nullif(sum(c.kg * c.price) filter (where c.total_raw is not null), 0) * 100, 1),
           cost_grade(sum(c.kg * (c.price - c.total_raw)) / nullif(sum(c.kg * c.price) filter (where c.total_raw is not null), 0) * 100),
           (count(*) filter (where c.total_raw is not null and c.source = 'actual'))::int,
           (count(*) filter (where c.total_raw is not null and c.source = 'current'))::int,
           (count(*) filter (where c.total_raw is null))::int,
           case when count(c.total_raw) = 0 then 'uncomputed'
                when count(c.total_raw) = count(*) and count(*) filter (where c.source = 'current') = 0 then 'actual'
                when count(c.total_raw) = count(*) and count(*) filter (where c.source = 'actual') = 0 then 'estimated'
                else 'mixed' end
      from cost_secret.sale_costs(p_business, p_from, p_to, null, g.chairman) c
     group by c.customer
     order by sum(c.kg * c.price) desc, c.customer
     limit 2000;
    return;
  end if;
  if cost_can('sales', p_business) then
    return query
    select s.customer_company, count(*)::int, sum(s.kg), round(sum(s.kg * s.price_krw_per_kg)),
           null::numeric, null::numeric, null::numeric,
           (array_agg(s.snap_grade order by s.shipped_on desc, s.created_at desc))[1],
           null::int, null::int, null::int, null::text
      from cost_sales s
     where s.business_id = p_business and s.voided_at is null and s.shipped_on between p_from and p_to
       and s.created_by = auth.uid() and sale_visible(s.sale_id)
     group by s.customer_company
     order by sum(s.kg * s.price_krw_per_kg) desc, s.customer_company
     limit 2000;
    return;
  end if;
  raise exception 'cost_not_found' using errcode = 'P0002';
end;
$fn$;

/**
 * 대표 · 원가 관리: «매출 큰데 마진 낮은» 상위 10 — 고객 · 제품 각각. 매출 상위 절반 중 GM%(계산된 것만) 낮은 순.
 * 문은 0065 원가 관리 목록 · customer_profit과 같은 키('costing:<회사>' — 하루 20번 합계).
 */
create function customer_profit_watch(p_business text, p_from date, p_to date)
returns table (kind text, key text, label text, revenue_krw numeric, gm_pct numeric, grade text)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
declare
  g record;
begin
  if not coalesce(feature_on('customer_profit', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_business is null or p_from is null or p_to is null or p_from > p_to or p_to - p_from > 1100 then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  if not (coalesce(auth_role()::text, '') = 'Chairman' or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select * into g from cost_secret.cost_gate_biz(p_business, 'costing:' || p_business, 'costing_list', null);   -- 리뷰 I4
  return query
  with c as (select * from cost_secret.sale_costs(p_business, p_from, p_to, null, g.chairman)),
  grp as (
    select 'customer'::text as kd, c.customer as k, c.customer as lb, sum(c.kg * c.price) as rev,
           sum(c.kg * (c.price - c.total_raw)) / nullif(sum(c.kg * c.price) filter (where c.total_raw is not null), 0) * 100 as pct
      from c group by c.customer
    union all
    select 'product'::text, c.product_id, max(c.product_name), sum(c.kg * c.price),
           sum(c.kg * (c.price - c.total_raw)) / nullif(sum(c.kg * c.price) filter (where c.total_raw is not null), 0) * 100
      from c group by c.product_id
  ),
  ranked as (
    select grp.*, row_number() over (partition by grp.kd order by grp.rev desc, grp.k) as rn, count(*) over (partition by grp.kd) as n
      from grp
  ),
  pick as (
    select r.*, row_number() over (partition by r.kd order by r.pct asc, r.rev desc, r.k) as rk
      from ranked r where r.rn <= ceil(r.n / 2.0) and r.pct is not null
  )
  select p.kd, p.k, p.lb, cost_secret.shown(p.rev, g.chairman), round(p.pct, 1), cost_grade(p.pct)
    from pick p where p.rk <= 10
   order by p.kd, p.rk;
end;
$fn$;

-- =====================================================================
-- 6절. ④ 마진 변동 분해
-- =====================================================================

/**
 * 대표 · 원가 관리: 기간 A(앞) → B(뒤) GM 원/kg 변화를 판매가 · 원료 · 제조 · 물류 · 기타 효과로(합 = 전체 — 대표 정확히, 대표 외 1원으로 맞춰).
 * 문 = cost_gate_biz('costing:<회사>' — 0065와 같은 키). 제품 지정 가능(그 회사 제품이 아니면 cost_not_found). 대시보드 문장은 앱이 이 결과로 만든다(AI 없음).
 */
create function margin_bridge(p_business text, p_from_a date, p_to_a date, p_from_b date, p_to_b date, p_product text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  g record;
begin
  if not coalesce(feature_on('margin_bridge', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_business is null or p_from_a is null or p_to_a is null or p_from_b is null or p_to_b is null
     or p_from_a > p_to_a or p_from_b > p_to_b or p_to_a - p_from_a > 1100 or p_to_b - p_from_b > 1100 then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  if not (coalesce(auth_role()::text, '') = 'Chairman' or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_product is not null and not exists (select 1 from cost_products p where p.product_id = p_product and p.business_id = p_business) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select * into g from cost_secret.cost_gate_biz(p_business, 'costing:' || p_business, 'costing_list', null);   -- 리뷰 I4
  return cost_secret.bridge_calc(p_business, p_from_a, p_to_a, p_from_b, p_to_b, p_product, g.chairman)
         || jsonb_build_object('as_of', g.as_of, 'product_id', p_product);
end;
$fn$;

-- =====================================================================
-- 7절. ⑤ 경쟁사 가정
-- =====================================================================

/** 원가 관리(쓰기) · 대표: 경쟁사 가정 넣기 · 바꾸기(제품 null = 회사 기본). 감사(가정 값 — 원가가 아니다 · 원가 관리만 읽는 감사 이름). */
create function competitor_assumption_set(p_business text, p_product text, p_mfg numeric, p_logi numeric, p_margin numeric, p_note text default '')
returns void
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
begin
  if not coalesce(feature_on('competitor_price', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_business is null or not cost_can('costing', p_business, true) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_product is not null and not exists (select 1 from cost_products p where p.product_id = p_product and p.business_id = p_business) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if (p_mfg is not null and (p_mfg < 0 or p_mfg > 1e9)) or (p_logi is not null and (p_logi < 0 or p_logi > 1e9))
     or (p_margin is not null and (p_margin < 0 or p_margin > 60)) or length(coalesce(p_note, '')) > 300 then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  insert into cost_competitor_assumptions (business_id, product_id, mfg_krw_per_kg, logi_krw_per_kg, margin_pct, note, updated_by, updated_at)
  values (p_business, p_product, p_mfg, p_logi, p_margin, coalesce(p_note, ''), auth.uid(), now())
  on conflict (business_id, (coalesce(product_id, ''))) do update set mfg_krw_per_kg = excluded.mfg_krw_per_kg,
    logi_krw_per_kg = excluded.logi_krw_per_kg, margin_pct = excluded.margin_pct, note = excluded.note,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'cost_overheads', 'competitor:' || p_business || ':' || coalesce(p_product, '*'), p_business, auth.uid(), auth_role()::text, null,
          jsonb_build_object('product_id', p_product, 'mfg', p_mfg, 'logi', p_logi, 'margin_pct', p_margin), '경쟁사 가정(0081)');
end;
$fn$;

/** 원가 관리 · 대표: 회사의 경쟁사 가정(회사 기본 줄 먼저). */
create function competitor_assumption_list(p_business text)
returns table (product_id text, product_name text, mfg_krw_per_kg numeric, logi_krw_per_kg numeric, margin_pct numeric, note text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
begin
  if not coalesce(feature_on('competitor_price', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_business is null or not cost_can('costing', p_business) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select a.product_id, p.name, a.mfg_krw_per_kg, a.logi_krw_per_kg, a.margin_pct, a.note, a.updated_at
    from cost_competitor_assumptions a
    left join cost_products p on p.product_id = a.product_id
   where a.business_id = p_business
   order by a.product_id nulls first, p.name
   limit 1000;
end;
$fn$;

/**
 * 대표 · 원가 관리 · 영업: 경쟁사 예상 최소가 · 우리 목표가(20% 제시가) · 경쟁사 최소가로 팔 때 우리 마진 % · 등급 — **결과만**
 * (가정 값 · 원가 값을 돌려주지 않는다). 문 = cost_gate(제품, 'competitor')(영업 0시 · 200건 · 감사 · 겸직 거부). 대표 외 1원 · 회사 완전성.
 */
create function competitor_price(p_product text)
returns table (product_id text, competitor_min_krw_per_kg numeric, our_target_krw_per_kg numeric, our_margin_at_competitor_pct numeric,
               grade_at_competitor text, computed boolean)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
declare
  v_biz text;
  g record;
  v_ok boolean;
  c record;
begin
  select p.business_id into v_biz from cost_products p where p.product_id = p_product;
  if v_biz is null or not coalesce(has_business(v_biz), false) then   -- 리뷰 M1
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(feature_on('competitor_price', v_biz), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  select * into g from cost_secret.cost_gate(p_product, 'competitor', null);
  v_ok := g.chairman or (cost_secret.business_complete(g.business_id, 'market', g.as_of)
                         and cost_secret.business_complete(g.business_id, 'current', g.as_of));
  select * into c from cost_secret.competitor_calc(p_product, g.business_id, g.as_of, g.chairman, v_ok);
  return query
  select p_product,
         cost_secret.shown(c.comp_min, g.chairman),
         cost_secret.shown(c.our_total / 0.8, g.chairman),
         round(c.margin_at, 1),
         cost_grade(c.margin_at),
         c.comp_min is not null and c.our_total is not null;
end;
$fn$;

-- =====================================================================
-- 8절. ⑥ 작업지시
-- =====================================================================

/** 대표만: 오더의 탱크 · 순서 · 담당 · 원료 이름 가림. 감사(생산 표 감사 이름 — 대표 · 생산 · 본인만 읽는다). */
create function work_order_set(p_order text, p_tank text, p_seq int, p_assignee uuid, p_hide_names boolean default true)
returns void
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_biz text;
begin
  select o.business_id into v_biz from cost_production_orders o where o.order_id = p_order;
  if v_biz is null or not coalesce(has_business(v_biz), false) then   -- 리뷰 M1
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(feature_on('work_orders', v_biz), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if not coalesce(is_active(), false) or coalesce(auth_role()::text, '') <> 'Chairman' then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  -- 리뷰 M5 — 담당 = 사용 중(회수 안 됨) · 사람 역할 · 그 회사 접근 · 그 회사 생산 줄.
  if (p_tank is not null and length(p_tank) > 40) or (p_seq is not null and (p_seq < 0 or p_seq > 1000000))
     or (p_assignee is not null and not (
           exists (select 1 from user_profiles u where u.user_id = p_assignee and u.revoked_at is null
                                                   and u.role::text not in ('AIAgent', 'Integration'))
           and exists (select 1 from user_business_access a where a.user_id = p_assignee and a.business_id = v_biz)
           and exists (select 1 from user_module_access m where m.user_id = p_assignee and m.module = '/production/' || v_biz))) then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  insert into cost_work_orders (order_id, tank, seq, assignee, hide_names, updated_by, updated_at)
  values (p_order, nullif(btrim(coalesce(p_tank, '')), ''), p_seq, p_assignee, coalesce(p_hide_names, true), auth.uid(), now())
  on conflict (order_id) do update set tank = excluded.tank, seq = excluded.seq, assignee = excluded.assignee,
    hide_names = excluded.hide_names, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'cost_production_orders', p_order, v_biz, auth.uid(), auth_role()::text, null,
          jsonb_build_object('tank', p_tank, 'seq', p_seq, 'assignee', p_assignee, 'hide_names', coalesce(p_hide_names, true)), '작업지시(0081)');
end;
$fn$;

/**
 * 작업지시 한 장: 머리(제품 · 계획일 · 계획 kg · 상태 · 탱크 · 순서 · 이름 가림) + 줄(원료 코드 · 이름(가림이면 null — 대표는 늘 보임) · 배치 kg)
 * + 투입(생산 LOT · 원료 코드 · kg · 시각) + assignee(대표에게만 — 생산 직원에게는 null).
 * 대표 · 그 오더 담당 생산 직원만(남의 오더 · 담당 없는 오더 = cost_not_found).
 * BOM 비율 · 수율 · 원료 단가 · 원료 id는 없다.
 */
create function work_order_get(p_order text)
returns jsonb
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  o record;
  w record;
  v_chair boolean;
  v_show boolean;
begin
  select x.order_id, x.business_id, x.product_id, x.planned_on, x.planned_kg, x.status into o
    from cost_production_orders x where x.order_id = p_order;
  if o.order_id is null or not coalesce(has_business(o.business_id), false) then   -- 리뷰 M1
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(feature_on('work_orders', o.business_id), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  select x.tank, x.seq, x.assignee, x.hide_names into w from cost_work_orders x where x.order_id = p_order;
  v_chair := o.order_id is not null and coalesce(is_active(), false) and coalesce(auth_role()::text, '') = 'Chairman'
             and coalesce(has_business(o.business_id), false);
  if o.order_id is null
     or not (v_chair or (cost_can('production', o.business_id) and w.assignee is not null and w.assignee = auth.uid())) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  v_show := v_chair or not coalesce(w.hide_names, true);
  return jsonb_build_object(
    'order_id', o.order_id,
    'product_name', (select p.name from cost_products p where p.product_id = o.product_id),
    'planned_on', o.planned_on, 'planned_kg', o.planned_kg, 'status', o.status,
    'tank', w.tank, 'seq', w.seq, 'hide_names', coalesce(w.hide_names, true),
    'assignee', case when v_chair then w.assignee end,   -- 대표 폼이 지금 담당을 채운다(생산 직원에게는 null)
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('code', cost_secret.mat_code(l.material_id),
                                          'material_name', case when v_show then m.name end,
                                          'batch_kg', l.planned_kg) order by cost_secret.mat_code(l.material_id))
        from cost_production_order_lines l join cost_materials m on m.material_id = l.material_id
       where l.order_id = o.order_id), '[]'::jsonb),
    'inputs', coalesce((
      select jsonb_agg(jsonb_build_object('prod_lot_id', i.prod_lot_id, 'code', cost_secret.mat_code(i.material_id),
                                          'qty_kg', i.qty_kg, 'created_at', i.created_at) order by i.created_at, i.input_id)
        from cost_prod_inputs i join cost_prod_lots pl on pl.prod_lot_id = i.prod_lot_id
       where pl.order_id = o.order_id and i.voided_at is null and pl.voided_at is null), '[]'::jsonb));
end;
$fn$;

/** 본인 담당 오더 목록(생산) · 대표는 그 회사 전부. 그 밖 = cost_not_found. */
create function work_order_mine(p_business text)
returns table (order_id text, product_name text, planned_on date, planned_kg numeric, status text, tank text, seq int)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
declare
  v_chair boolean;
begin
  if not coalesce(feature_on('work_orders', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  v_chair := p_business is not null and coalesce(is_active(), false) and coalesce(auth_role()::text, '') = 'Chairman'
             and coalesce(has_business(p_business), false);
  if not (v_chair or (p_business is not null and cost_can('production', p_business))) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select o.order_id, p.name, o.planned_on, o.planned_kg, o.status, w.tank, w.seq
    from cost_production_orders o
    join cost_products p on p.product_id = o.product_id
    left join cost_work_orders w on w.order_id = o.order_id
   where o.business_id = p_business and (v_chair or w.assignee = auth.uid())
   order by o.planned_on desc, w.seq nulls last, o.order_id
   limit 500;
end;
$fn$;

-- =====================================================================
-- 9절. ⑧ 제품 진단
-- =====================================================================

/**
 * 제품 한 장의 진단 카드(역할별 — 목록에 없는 카드는 배열에 넣지 않는다). 문 = cost_gate(제품, 'diagnosis') 한 번.
 *   대표 1~11 · 원가 관리 1~3 · 5~11(4 구매 절감은 BOM 소속이 샌다 — 결정 13) · 영업 5 · 6 · 7 · 8(본인 판매만). 구매 · 생산 = cost_not_found.
 * 자료가 없으면 state 'no_data' + need(필요한 것). 대표 외 원/kg 값은 1원.
 */
create function product_diagnosis(p_product text)
returns jsonb
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_biz text;
  v_name text;
  g record;
  v_role text;
  v_ok boolean;
  v_cards jsonb := '[]'::jsonb;
  r record;
  c record;
  v_act record;
  v_sav numeric;
  v_top jsonb;
  v_rank record;
  v_br jsonb;
  v_big text;
  v_ver bigint;
  v_yield numeric;
  v_mt_name text;
  v_mt_d numeric;
  v_cu_now numeric;
  v_cu_prev numeric;
  o_now record;
  o_prev record;
  v_this date;
  v_last date;
begin
  select p.business_id, p.name into v_biz, v_name from cost_products p where p.product_id = p_product;
  if v_biz is null or not coalesce(has_business(v_biz), false) then   -- 리뷰 M1
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(feature_on('product_diagnosis', v_biz), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  select * into g from cost_secret.cost_gate(p_product, 'diagnosis', null);
  v_role := case when g.chairman then 'chairman' when cost_can('costing', v_biz) then 'costing' else 'sales' end;
  v_ok := g.chairman or (cost_secret.business_complete(v_biz, 'market', g.as_of) and cost_secret.business_complete(v_biz, 'current', g.as_of));
  select * into r from cost_secret.sales_row(p_product, v_biz, g.as_of, g.chairman, v_ok, false);

  -- 1 Actual(최근 생산 LOT — 0064 식: 투입 금액 ÷ 산출 kg)
  if v_role <> 'sales' then
    select pl.prod_lot_id, pl.produced_on, s.amt / pl.output_kg as v into v_act
      from cost_prod_lots pl
      cross join lateral (select sum(i.qty_kg * l.landed_krw_per_kg) as amt
                            from cost_prod_inputs i join cost_purchase_lots l on l.lot_id = i.lot_id
                           where i.prod_lot_id = pl.prod_lot_id and i.voided_at is null) s
     where pl.product_id = p_product and pl.voided_at is null and s.amt is not null
     order by pl.produced_on desc, pl.created_at desc
     limit 1;
    v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(1, 'actual',
      case when v_act.v is not null then jsonb_build_object('krw_per_kg', cost_secret.shown(v_act.v, g.chairman),
                                                            'prod_lot_id', v_act.prod_lot_id, 'produced_on', v_act.produced_on) end,
      '생산 LOT 기록(투입 원료 LOT 포함)'));
    -- 2 Current 총원가 · 3 Market 원료비
    v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(2, 'current_total',
      case when r.total_raw is not null then jsonb_build_object('krw_per_kg', r.total_krw_per_kg) end, '원료 단가(구매 LOT) · 비용 마스터'));
    v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(3, 'market_material',
      case when r.market_krw_per_kg is not null then jsonb_build_object('krw_per_kg', r.market_krw_per_kg) end, '원료 시장가'));
  end if;

  -- 4 구매 절감(대표만 — 최근 90일 · 이 제품 BOM 원료의 LOT 절감 합)
  if v_role = 'chairman' then
    select sum((cost_market_on(x.material_id, x.received_on) - x.unit_price * x.fx_rate) * x.qty_kg) into v_sav
      from cost_purchase_lots x
     where x.business_id = v_biz and x.voided_at is null and x.received_on > g.as_of - 90 and x.received_on <= g.as_of
       and x.material_id in (select l.material_id from cost_secret.bom_lines_of(cost_secret.version_on(p_product, g.as_of)) l);
    v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(4, 'purchase_savings',
      case when v_sav is not null then jsonb_build_object('krw', v_sav, 'days', 90) end, '최근 90일 구매 LOT · 그날 시장가'));
  end if;

  -- 5 경쟁사 · 6 최소 판매가(총원가 ÷ 0.85) · 7 20% 마진 가격(총원가 ÷ 0.8)
  select * into c from cost_secret.competitor_calc(p_product, v_biz, g.as_of, g.chairman, v_ok);
  v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(5, 'competitor',
    case when c.comp_min is not null and c.our_total is not null then
      jsonb_build_object('competitor_min_krw_per_kg', cost_secret.shown(c.comp_min, g.chairman),
                         'our_target_krw_per_kg', cost_secret.shown(c.our_total / 0.8, g.chairman),
                         'our_margin_at_competitor_pct', round(c.margin_at, 1), 'grade', cost_grade(c.margin_at),
                         'assumed_defaults', not c.has_assumption) end,
    '경쟁사 가정 · 원가'));
  v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(6, 'min_price',
    case when r.total_raw is not null then jsonb_build_object('krw_per_kg', cost_secret.shown(r.total_raw / 0.85, g.chairman), 'margin_pct', 15) end,
    '원료 단가 · 비용 마스터'));
  v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(7, 'target_price',
    case when r.total_raw is not null then jsonb_build_object('krw_per_kg', cost_secret.shown(r.total_raw / 0.8, g.chairman), 'margin_pct', 20) end,
    '원료 단가 · 비용 마스터'));

  -- 8 상위 고객(최근 90일 매출 상위 5) — 영업은 본인 판매만
  select jsonb_agg(jsonb_build_object('customer', t.customer, 'revenue_krw', cost_secret.shown(t.rev, g.chairman), 'kg', t.kg) order by t.rev desc)
    into v_top
    from (select s.customer_company as customer, sum(s.kg * s.price_krw_per_kg) as rev, sum(s.kg) as kg
            from cost_sales s
           where s.product_id = p_product and s.voided_at is null and s.shipped_on > g.as_of - 90 and s.shipped_on <= g.as_of
             and (v_role <> 'sales' or (s.created_by = auth.uid() and sale_visible(s.sale_id)))
           group by s.customer_company
           order by sum(s.kg * s.price_krw_per_kg) desc, s.customer_company
           limit 5) t;
  v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(8, 'top_customers',
    case when v_top is not null then jsonb_build_object('customers', v_top, 'days', 90) end, '최근 90일 판매 기록'));

  if v_role <> 'sales' then
    -- 9 매출 대비 마진 순위(최근 90일 · 회사 제품 중)
    select x.rev_rank, x.gm_rank, x.n into v_rank
      from (select q.product_id, rank() over (order by q.rev desc) as rev_rank, rank() over (order by q.pct desc nulls last) as gm_rank,
                   count(*) over () as n
              from (select sc.product_id, sum(sc.kg * sc.price) as rev,
                           sum(sc.kg * (sc.price - sc.total_raw)) / nullif(sum(sc.kg * sc.price) filter (where sc.total_raw is not null), 0) as pct
                      from cost_secret.sale_costs(v_biz, g.as_of - 89, g.as_of, null, g.chairman) sc
                     group by sc.product_id) q) x
     where x.product_id = p_product;
    v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(9, 'rank',
      case when v_rank.n is not null then jsonb_build_object('revenue_rank', v_rank.rev_rank, 'gm_rank', v_rank.gm_rank, 'n_products', v_rank.n, 'days', 90) end,
      '최근 90일 판매 기록'));

    -- 10 마진 하락 이유(지난달 → 이번 달, 이 제품)
    v_this := date_trunc('month', g.as_of::timestamp)::date;
    v_last := (v_this - interval '1 month')::date;
    v_br := cost_secret.bridge_calc(v_biz, v_last, v_this - 1, v_this, g.as_of, p_product, g.chairman);
    if v_br -> 'effects' is not null and jsonb_typeof(v_br -> 'effects') = 'object' then
      select e.key into v_big from jsonb_each(v_br -> 'effects') e order by abs((e.value #>> '{}')::numeric) desc, e.key limit 1;
      v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(10, 'margin_drop',
        jsonb_build_object('total_krw_per_kg', v_br -> 'total', 'biggest', v_big, 'biggest_krw_per_kg', v_br -> 'effects' -> v_big,
                           'material_pct', v_br -> 'material_pct')
        || case when g.chairman then jsonb_build_object('top_material', v_br -> 'materials' -> 0) else '{}'::jsonb end,
        '판매 기록 2개월(지난달 · 이번 달)'));
    else
      v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(10, 'margin_drop', null, '판매 기록 2개월(지난달 · 이번 달)'));
    end if;

    -- 11 원가 상승 최대 영향(7일 전 → 오늘). 대표 = 원료 이름 · Δ원/kg 1위, 원가 관리 = 원료 합계 % · 비용 묶음 Δ(1원).
    if g.chairman then
      v_ver := cost_secret.version_on(p_product, g.as_of);
      if v_ver is not null then
        select bv.yield_pct into v_yield from cost_secret.bom_versions bv where bv.version_id = v_ver;
        select y.name, y.d into v_mt_name, v_mt_d from (
          select m.name, (l.kg_per_kg / (v_yield / 100)) * (cost_secret.unit_price(l.material_id, 'current', g.as_of)
                                                           - cost_secret.unit_price(l.material_id, 'current', g.as_of - 7)) as d
            from cost_secret.bom_lines_of(v_ver) l join cost_materials m on m.material_id = l.material_id) y
         where y.d is not null
         order by abs(y.d) desc, y.name
         limit 1;
      end if;
      v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(11, 'cost_rise',
        case when v_mt_d is not null then jsonb_build_object('material_name', v_mt_name, 'delta_krw_per_kg', v_mt_d, 'days', 7) end,
        'BOM · 7일 전 · 오늘 원료 단가'));
    else
      if v_ok and cost_secret.business_complete(v_biz, 'current', g.as_of - 7) then
        select x.total into v_cu_now from cost_secret.material_cost(p_product, 'current', g.as_of) x;
        select x.total into v_cu_prev from cost_secret.material_cost(p_product, 'current', g.as_of - 7) x;
      end if;
      select * into o_now from cost_secret.overhead(v_biz, p_product, g.as_of);
      select * into o_prev from cost_secret.overhead(v_biz, p_product, g.as_of - 7);
      v_cards := v_cards || jsonb_build_array(cost_secret.diag_card(11, 'cost_rise',
        case when v_cu_now is not null and v_cu_prev > 0 then
          jsonb_build_object('material_pct', round((v_cu_now / v_cu_prev - 1) * 100, 1),
                             'overhead_delta_krw_per_kg', case when o_now.ready and o_prev.ready then cost_secret.shown(o_now.total - o_prev.total, false) end,
                             'days', 7) end,
        '7일 전 · 오늘 원가(회사 원료 단가 전부)'));
    end if;
  end if;

  return jsonb_build_object('product_id', p_product, 'product_name', v_name, 'role', v_role, 'as_of', g.as_of,
    'cards', (select coalesce(jsonb_agg(x.card order by (x.card ->> 'id')::int), '[]'::jsonb) from jsonb_array_elements(v_cards) x(card)));
end;
$fn$;

/**
 * 대표 · 원가 관리: 기간마다(일 · 주 · 월 · 분기 · 년, 최대 400점) 판매가(kg 가중) · Actual(그 기간 생산 LOT 산출 가중) · Market 원료비(기간 끝 날) · GM%.
 * 문 한 번(cost_gate(제품, 'trend')). Market 원료비는 대표만 기간마다 — 원가 관리는 오늘이 든 기간 하나만(지난 날짜 합계 여러 개 = BOM 역산 — 결정 15).
 */
create function product_trend(p_product text, p_grain text, p_from date, p_to date)
returns table (period_start date, kg numeric, price_krw_per_kg numeric, actual_krw_per_kg numeric, market_material_krw_per_kg numeric, gm_pct numeric)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
#variable_conflict use_column
declare
  v_biz text;
  g record;
  v_step interval;
  v_n int;
  v_ok boolean;
begin
  select p.business_id into v_biz from cost_products p where p.product_id = p_product;
  if v_biz is null or not coalesce(has_business(v_biz), false) then   -- 리뷰 M1
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(feature_on('product_diagnosis', v_biz), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if coalesce(p_grain, '') not in ('day', 'week', 'month', 'quarter', 'year') or p_from is null or p_to is null or p_from > p_to then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  if v_biz is null or not (coalesce(auth_role()::text, '') = 'Chairman' or cost_can('costing', v_biz)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  v_step := case p_grain when 'day' then interval '1 day' when 'week' then interval '7 days' when 'month' then interval '1 month'
                         when 'quarter' then interval '3 months' else interval '1 year' end;
  if (p_to - p_from) > 400 * 366 then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  select count(*)::int into v_n from generate_series(date_trunc(p_grain, p_from::timestamp), date_trunc(p_grain, p_to::timestamp), v_step) gs;
  if v_n > 400 then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  select * into g from cost_secret.cost_gate(p_product, 'trend', null);
  v_ok := g.chairman or cost_secret.business_complete(v_biz, 'market', g.as_of);
  return query
  with per as (
    select gs::date as ps, (gs + v_step - interval '1 day')::date as pe
      from generate_series(date_trunc(p_grain, p_from::timestamp), date_trunc(p_grain, p_to::timestamp), v_step) gs
  ),
  sc as (select * from cost_secret.sale_costs(v_biz, (select min(per.ps) from per), (select max(per.pe) from per), p_product, g.chairman))
  select per.ps,
         s.kg,
         cost_secret.shown(s.price, g.chairman),
         cost_secret.shown(a.v, g.chairman),
         case when g.chairman then (select x.total from cost_secret.material_cost(p_product, 'market', per.pe) x)
              when v_ok and g.as_of between per.ps and per.pe then cost_secret.shown((select x.total from cost_secret.material_cost(p_product, 'market', g.as_of) x), false)
         end,
         round(s.gm, 1)
    from per
    left join lateral (
      select sum(sc.kg) as kg, sum(sc.kg * sc.price) / nullif(sum(sc.kg), 0) as price,
             sum(sc.kg * (sc.price - sc.total_raw)) / nullif(sum(sc.kg * sc.price) filter (where sc.total_raw is not null), 0) * 100 as gm
        from sc where sc.shipped_on between per.ps and per.pe) s on true
    left join lateral (
      select sum(z.amt) / nullif(sum(z.out_kg), 0) as v
        from (select pl.output_kg as out_kg,
                     (select sum(i.qty_kg * l.landed_krw_per_kg) from cost_prod_inputs i join cost_purchase_lots l on l.lot_id = i.lot_id
                       where i.prod_lot_id = pl.prod_lot_id and i.voided_at is null) as amt
                from cost_prod_lots pl
               where pl.product_id = p_product and pl.voided_at is null and pl.produced_on between per.ps and per.pe) z
       where z.amt is not null) a on true
   order by per.ps;
end;
$fn$;

-- =====================================================================
-- 10절. 함수 권한 — public · anon에게서 이름으로 걷는다. 공개 RPC만 authenticated. 내부(cost_secret)는 전부 걷는다.
-- =====================================================================
revoke all on function cost_outlook_set(text, date, numeric, text, numeric, text) from public, anon;
revoke all on function cost_outlook_list(text) from public, anon;
revoke all on function cost_forecast_setting_set(text, numeric, text, jsonb) from public, anon;
revoke all on function cost_forecast_setting(text) from public, anon;
revoke all on function cost_forecast_list(text) from public, anon;
revoke all on function purchase_performance(text, date, date, text) from public, anon;
revoke all on function customer_profit(text, date, date) from public, anon;
revoke all on function customer_profit_watch(text, date, date) from public, anon;
revoke all on function margin_bridge(text, date, date, date, date, text) from public, anon;
revoke all on function competitor_assumption_set(text, text, numeric, numeric, numeric, text) from public, anon;
revoke all on function competitor_assumption_list(text) from public, anon;
revoke all on function competitor_price(text) from public, anon;
revoke all on function work_order_set(text, text, int, uuid, boolean) from public, anon;
revoke all on function work_order_get(text) from public, anon;
revoke all on function work_order_mine(text) from public, anon;
revoke all on function product_diagnosis(text) from public, anon;
revoke all on function product_trend(text, text, date, date) from public, anon;
grant execute on function cost_outlook_set(text, date, numeric, text, numeric, text) to authenticated;
grant execute on function cost_outlook_list(text) to authenticated;
grant execute on function cost_forecast_setting_set(text, numeric, text, jsonb) to authenticated;
grant execute on function cost_forecast_setting(text) to authenticated;
grant execute on function cost_forecast_list(text) to authenticated;
grant execute on function purchase_performance(text, date, date, text) to authenticated;
grant execute on function customer_profit(text, date, date) to authenticated;
grant execute on function customer_profit_watch(text, date, date) to authenticated;
grant execute on function margin_bridge(text, date, date, date, date, text) to authenticated;
grant execute on function competitor_assumption_set(text, text, numeric, numeric, numeric, text) to authenticated;
grant execute on function competitor_assumption_list(text) to authenticated;
grant execute on function competitor_price(text) to authenticated;
grant execute on function work_order_set(text, text, int, uuid, boolean) to authenticated;
grant execute on function work_order_get(text) to authenticated;
grant execute on function work_order_mine(text) to authenticated;
grant execute on function product_diagnosis(text) to authenticated;
grant execute on function product_trend(text, text, date, date) to authenticated;
revoke all on all functions in schema cost_secret from public, anon, authenticated;

commit;
