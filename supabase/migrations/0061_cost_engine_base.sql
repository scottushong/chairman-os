-- =====================================================================
-- Chairman OS — 0061_cost_engine_base (원가 엔진 1차 기초: 모듈 권한 · 원료 · 공급처 · 시장가 · 구매 LOT · 제품 · 구매 첨부)
-- 작성: 2026-10-09 · 설계서 docs/superpowers/specs/cost-engine.md (2 · 3 · 6 · 10절)
--
-- ■ 무엇을 만드나 ■
--   판정   cost_grant(area, biz, write) — user_module_access '/<area>/<biz>'(area = purchasing · production · sales · costing)
--          cost_can(area, biz, write)   — 대표(Chairman) 또는 그 줄, AND has_business(biz). AIAgent · Integration은 늘 거짓.
--   표     cost_materials · cost_suppliers · cost_market_prices(일) · cost_purchase_lots(Landed Cost) · cost_products(이름만)
--          · cost_purchase_docs(견적서 · 단가표, 버킷 'purchasing') · cost_candidate_dismissals(결재 후보 «무시»)
--   함수   cost_purchase_candidates(biz)           승인된 구매 결재 → LOT 후보(구매 입력 권한자)
--          cost_production_materials(biz, as_of)  생산 «제한» — 원료별 오늘 시장가 한 값
--          cost_production_lots(biz)              생산 — LOT 가격(landed 원/kg) · 공급처 이름 · LOT 번호만
--          cost_sales_purchase_summary(biz, days, as_of)  영업 «요약» — 기간 가중평균 구매단가 · 시장가 대비 %
--
-- ■ 지키는 것 ■
--   · BOM은 여기에 없다(0062 cost_secret). 원료 표 · 제품 표 어디에도 «어느 제품에 무엇이 얼마나»가 없다.
--   · 고치지 않는 기록 — 시장가 · LOT · 첨부는 insert만, update는 «무효» 칸 셋(칸 단위 grant + 트리거). delete 권한 없음.
--   · 만든 사람 · 무효 처리자는 DB가 auth.uid()로 찍는다(위조 불가). Landed Cost · 원화 환산은 DB가 계산한다(입력값을 믿지 않는다).
--   · 감사 줄에는 값(가격 · 공급처 조건)을 넣지 않는다 — audit_log는 행위자의 상사(0026 subtree)도 읽는다. id와 메모만.
--   · 표는 RLS enable · **FORCE 없음**(리뷰 C1 — 정의자 함수의 소유자가 읽어야 한다).
--   · 0050~0059에 기대지 않는다(master 위에서 쓴다). 0045 · 0058 · 0059의 첨부 함수 · 정책을 건드리지 않는다 — 구매 첨부는 별도 버킷.
--
-- 0035 규칙: 0001~0055를 고치지 않는다.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 판정 함수
-- =====================================================================

/** '/<area>/<target>' 모듈 줄이 있는가(요구한 칸까지). 사람 역할만 — 시스템 계정은 줄이 있어도 거짓(0047 finance_grant와 같은 문). */
create or replace function cost_grant(p_area text, p_target text, p_need_write boolean default false)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select is_active()
     and p_target is not null
     and p_area in ('purchasing', 'production', 'sales', 'costing')
     and coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration')
     and exists (
       select 1 from user_module_access
        where user_id = auth.uid()
          and module = '/' || p_area || '/' || p_target
          and (not p_need_write or can_write)
     );
$fn$;

/** 대표 또는 그 회사 그 영역의 줄. 회사 범위(has_business)는 늘 함께 — 줄만 있고 회사 접근이 없으면 거짓. */
create or replace function cost_can(p_area text, p_target text, p_need_write boolean default false)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select is_active()
     and p_target is not null
     and p_area in ('purchasing', 'production', 'sales', 'costing')
     and has_business(p_target)
     and (coalesce(auth_role()::text, '') = 'Chairman' or cost_grant(p_area, p_target, p_need_write));
$fn$;

comment on function cost_can(text, text, boolean) is
  '0061. 원가 엔진 영역(구매 · 생산 · 영업 · 원가 관리) 판정. 대표(Chairman) 또는 user_module_access ''/<area>/<biz>'' 줄, AND has_business.';

/** KST 달력 날짜. 원가 엔진의 «오늘»(설계서 9.1). */
create or replace function cost_today() returns date
language sql stable set search_path = public as $fn$
  select (now() at time zone 'Asia/Seoul')::date;
$fn$;

-- =====================================================================
-- 2절. 표
-- =====================================================================

create table cost_materials (
  material_id text primary key default ('mat_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
              check (material_id ~ '^mat_[a-z0-9_]{4,60}$'),
  business_id text not null references businesses(business_id),
  name        text not null check (length(btrim(name)) between 1 and 120),
  name_norm   text generated always as (lower(regexp_replace(name, '\s+', '', 'g'))) stored,
  spec        text not null default '' check (length(spec) <= 200),
  category    text not null default 'main' check (category in ('main', 'sub', 'additive', 'packaging', 'other')),
  base_unit   text not null default 'kg' check (base_unit = 'kg'),  -- 1차는 kg만(설계서 6.5)
  active      boolean not null default true,
  note        text not null default '' check (length(note) <= 500),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, name_norm),
  unique (material_id, business_id)
);
comment on table cost_materials is '0061. 원료 마스터(회사별). 배합 · 비율 · 어느 제품에 들어가는지는 없다(그것은 BOM — 0062 cost_secret).';

create table cost_suppliers (
  supplier_id      text primary key default ('sup_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
                   check (supplier_id ~ '^sup_[a-z0-9_]{4,60}$'),
  business_id      text not null references businesses(business_id),
  name             text not null check (length(btrim(name)) between 1 and 120),
  name_norm        text generated always as (lower(regexp_replace(name, '\s+', '', 'g'))) stored,
  country          text not null default '' check (length(country) <= 60),
  currency_default char(3) not null default 'KRW' check (currency_default ~ '^[A-Z]{3}$'),
  contact          text not null default '' check (length(contact) <= 500),   -- [제한]
  terms            text not null default '' check (length(terms) <= 500),     -- [제한] 결제 · 인도 조건
  active           boolean not null default true,
  note             text not null default '' check (length(note) <= 500),
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (business_id, name_norm),
  unique (supplier_id, business_id)
);
comment on table cost_suppliers is '0061. 공급처(회사별). 연락처 · 조건은 [제한] — 구매 · 원가 관리 · 대표만 표로 읽는다. 생산은 이름만(함수).';

create table cost_market_prices (
  price_id         bigint generated always as identity primary key,
  business_id      text not null references businesses(business_id),
  material_id      text not null,
  observed_on      date not null,
  price            numeric(20, 4) not null check (price > 0),       -- 통화 · kg당
  currency         char(3) not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  fx_rate          numeric(18, 6) check (fx_rate > 0),              -- 비우면 fx_rates에서 찾는다(트리거)
  price_krw_per_kg numeric(20, 4) not null default 0,               -- 트리거가 계산한다(입력값 무시)
  source_name      text not null check (length(btrim(source_name)) between 1 and 120),
  source_url       text check (source_url is null or (source_url ~* '^https?://' and length(source_url) <= 1000)),
  note             text not null default '' check (length(note) <= 500),
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid,
  void_reason      text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  foreign key (material_id, business_id) references cost_materials (material_id, business_id),
  constraint cost_market_prices_void_shape check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create unique index cost_market_prices_one_a_day on cost_market_prices (material_id, observed_on, lower(source_name)) where voided_at is null;
create index cost_market_prices_by_day on cost_market_prices (business_id, material_id, observed_on desc) where voided_at is null;
-- 리뷰 3회차 M3 — 원가 함수의 쌍시간 조건(무효 시점까지)은 위 부분 인덱스를 못 쓴다.
create index cost_market_prices_by_material on cost_market_prices (material_id, observed_on desc);
comment on table cost_market_prices is '0061. 원료 시장가격(일 단위 원자료). 고치지 않는다 — 틀리면 무효 + 새 줄. 주 · 월은 합산 뷰로만(설계서 9).';

create table cost_purchase_lots (
  lot_id            text primary key default ('PL-' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD') || '-' ||
                                              upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)))
                    check (lot_id ~ '^PL-[0-9]{8}-[0-9A-F]{6}$'),
  business_id       text not null references businesses(business_id),
  material_id       text not null,
  supplier_id       text not null,
  received_on       date not null,                                   -- 입고일 = 원가 기준일
  ordered_on        date,
  supplier_lot_no   text not null default '' check (length(supplier_lot_no) <= 80),
  qty_kg            numeric(20, 4) not null check (qty_kg > 0),
  unit_price        numeric(20, 4) not null check (unit_price > 0),  -- 통화 · kg당
  currency          char(3) not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  fx_rate           numeric(18, 6) check (fx_rate > 0),              -- 비우면 fx_rates(입고일 이하 최신)
  freight_krw       numeric(20, 4) not null default 0 check (freight_krw >= 0),
  duty_krw          numeric(20, 4) not null default 0 check (duty_krw >= 0),
  other_krw         numeric(20, 4) not null default 0 check (other_krw >= 0),
  goods_krw         numeric(20, 4) not null default 0,               -- 트리거: unit_price × qty × fx
  landed_krw_per_kg numeric(20, 4) not null default 0,               -- 트리거: (goods + freight + duty + other) ÷ qty
  source            text not null default 'manual' check (source in ('manual', 'approval', 'import')),
  source_ref        text check (source_ref is null or length(source_ref) <= 80),
  note              text not null default '' check (length(note) <= 500),
  created_by        uuid not null default auth.uid(),
  created_at        timestamptz not null default now(),
  voided_at         timestamptz,
  voided_by         uuid,
  void_reason       text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  foreign key (material_id, business_id) references cost_materials (material_id, business_id),
  foreign key (supplier_id, business_id) references cost_suppliers (supplier_id, business_id),
  constraint cost_purchase_lots_source_ref check ((source = 'approval') = (source_ref is not null) or source = 'import'),
  constraint cost_purchase_lots_void_shape check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create unique index cost_purchase_lots_one_per_approval on cost_purchase_lots (source_ref) where source = 'approval' and voided_at is null;
create index cost_purchase_lots_by_material on cost_purchase_lots (business_id, material_id, received_on desc) where voided_at is null;
create index cost_purchase_lots_by_material_all on cost_purchase_lots (material_id, received_on desc);
comment on table cost_purchase_lots is '0061. 구매 · 입고 LOT. Landed Cost(원/kg)를 DB가 계산해 저장한다. 고치지 않는다 — 무효 + 새 줄. 잔량은 저장하지 않는다(0064 뷰).';

create table cost_products (
  product_id  text primary key default ('prd_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
              check (product_id ~ '^prd_[a-z0-9_]{4,60}$'),
  business_id text not null references businesses(business_id),
  name        text not null check (length(btrim(name)) between 1 and 120),
  name_norm   text generated always as (lower(regexp_replace(name, '\s+', '', 'g'))) stored,
  sku         text not null default '' check (length(sku) <= 60),
  pack_kg     numeric(20, 4) check (pack_kg is null or pack_kg > 0),
  active      boolean not null default true,
  note        text not null default '' check (length(note) <= 500),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, name_norm)
);
comment on table cost_products is '0061. 제품 마스터 — 이름만. 원료 구성은 여기 없다(0062 cost_secret).';

create table cost_purchase_docs (
  doc_id       uuid primary key default gen_random_uuid(),
  business_id  text not null references businesses(business_id),
  lot_id       text references cost_purchase_lots(lot_id),
  supplier_id  text,
  kind         text not null default 'quote' check (kind in ('quote', 'price_list', 'invoice', 'other')),
  file_name    text not null check (length(btrim(file_name)) between 1 and 200),
  mime         text not null check (mime in (
                 'application/pdf',
                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                 'text/csv', 'image/png', 'image/jpeg')),
  size_bytes   int not null check (size_bytes between 1 and 4194304),   -- 4MB — 서버 액션으로 받는다(배합비 검사가 저장 전에 돈다)
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique,
  mix_checked  boolean not null,          -- 서버가 배합비 검사를 돌렸는가(글자층 없는 파일은 false + 올린 사람 확인).
                                          -- 리뷰 M5: DB는 파일 내용을 못 본다 — PostgREST로 직접 넣는 사람은 true라고 적을 수 있다. 감사 줄이 남는다.
  mix_attested boolean not null default false,   -- 글자층 없는 파일: 올린 사람의 «배합비 · 레시피가 아닙니다»
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid,
  void_reason  text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  foreign key (supplier_id, business_id) references cost_suppliers (supplier_id, business_id),
  constraint cost_purchase_docs_path check (left(storage_path, length(business_id) + 1) = business_id || '/' and storage_path !~ '\.\.'),
  constraint cost_purchase_docs_mix check (mix_checked or mix_attested),
  constraint cost_purchase_docs_void_shape check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
comment on table cost_purchase_docs is '0061. 구매 첨부(견적서 · 단가표 · 송장). AI에 보내지 않는다(요약 없음). 배합비로 보이면 서버가 저장하지 않는다. Vault 등급 없음.';

create table cost_candidate_dismissals (
  decision_id  text primary key references decisions(decision_id) on delete cascade,
  business_id  text not null references businesses(business_id),
  dismissed_by uuid not null default auth.uid(),
  dismissed_at timestamptz not null default now()
);
comment on table cost_candidate_dismissals is '0061. 구매 결재 → LOT 후보에서 «무시»한 결재. 지우면 후보로 돌아온다.';

-- =====================================================================
-- 3절. 트리거 — 도장 · 계산 · 무효
-- =====================================================================

/** insert: 만든 사람 = 세션. 회사가 맞는지(원료 · 공급처 · LOT가 같은 회사)는 복합 FK가 본다. */
create or replace function cost_stamp_insert() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end;
$fn$;

/** 마스터 update: 회사 · 만든 사람 · 만든 시각은 못 바꾼다(칸 grant가 1차 문 — 이것은 소유자 경로까지 덮는 2차 문). */
create or replace function cost_master_update() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.business_id := old.business_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$fn$;

/** 무효 update: 한 번만 · 이유 필수 · 처리자 = 세션 · 다른 칸은 그대로. */
create or replace function cost_void_update() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if old.voided_at is not null then
    raise exception 'cost_already_voided' using errcode = '23514';
  end if;
  if new.void_reason is null or length(btrim(new.void_reason)) = 0 then
    raise exception 'cost_void_reason' using errcode = '23514';
  end if;
  new.voided_at := now();
  new.voided_by := auth.uid();
  return new;
end;
$fn$;

/** 통화 → 원화 환율. KRW는 1. 입력 환율이 있으면 그것, 없으면 fx_rates(그 날짜 이하 최신 · base = 통화 · quote = KRW). */
create or replace function cost_fx(p_currency text, p_on date, p_given numeric) returns numeric
language plpgsql stable set search_path = public as $fn$
declare
  v numeric;
begin
  if p_currency = 'KRW' then return 1; end if;
  if p_given is not null then return p_given; end if;
  select rate into v from fx_rates where base = p_currency and quote = 'KRW' and rate_date <= p_on order by rate_date desc limit 1;
  if v is null then
    raise exception 'cost_fx_missing' using errcode = '22023', detail = p_currency;
  end if;
  return v;
end;
$fn$;

create or replace function cost_market_price_calc() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.fx_rate := cost_fx(new.currency, new.observed_on, new.fx_rate);
  new.price_krw_per_kg := round(new.price * new.fx_rate, 4);
  return new;
end;
$fn$;

create or replace function cost_lot_calc() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.fx_rate := cost_fx(new.currency, new.received_on, new.fx_rate);
  new.goods_krw := round(new.unit_price * new.qty_kg * new.fx_rate, 4);
  new.landed_krw_per_kg := round((new.goods_krw + new.freight_krw + new.duty_krw + new.other_krw) / new.qty_kg, 4);
  return new;
end;
$fn$;

/** 결재에서 온 LOT: 그 회사의 승인된 «구매» 양식 결재여야 한다. 넣는 사람이 그 결재를 RLS로 못 봐도 판정은 여기서(정의자). */
create or replace function cost_lot_source_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.source = 'approval' and not exists (
    select 1 from decisions d
     where d.decision_id = new.source_ref and d.business_id = new.business_id
       and d.template_key = 'purchase' and d.status = 'Approved'
  ) then
    raise exception 'cost_candidate_invalid' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

create or replace function cost_dismissal_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  new.dismissed_by := auth.uid();
  new.dismissed_at := now();
  if not exists (
    select 1 from decisions d
     where d.decision_id = new.decision_id and d.business_id = new.business_id
       and d.template_key = 'purchase' and d.status = 'Approved'
  ) then
    raise exception 'cost_candidate_invalid' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

/** 감사 — 값 없이 id와 메모만(머리 주석). 실패하면 쓰기도 실패한다(기록이 먼저 — 0045와 같은 결). */
create or replace function cost_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id text;
  v_action audit_action;
  v_note text;
begin
  -- 표마다 키 칸 이름이 달라 jsonb로 읽는다(plpgsql은 없는 칸을 가리키는 식을 실행 전에 거부한다).
  v_id := to_jsonb(new) ->> case tg_table_name
    when 'cost_materials' then 'material_id'
    when 'cost_suppliers' then 'supplier_id'
    when 'cost_market_prices' then 'price_id'
    when 'cost_purchase_lots' then 'lot_id'
    when 'cost_products' then 'product_id'
    when 'cost_purchase_docs' then 'doc_id'
  end;
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_note := '원가 엔진 입력(0061)';
  elsif tg_table_name in ('cost_market_prices', 'cost_purchase_lots', 'cost_purchase_docs') then
    v_action := 'update';
    v_note := '원가 엔진 무효(0061)';
  else
    v_action := 'update';
    v_note := '원가 엔진 마스터 수정(0061)';
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (v_action, tg_table_name, v_id, new.business_id, auth.uid(), auth_role()::text, null,
          jsonb_build_object('id', v_id), v_note);
  return null;
end;
$fn$;

do $do$
declare
  t text;
begin
  foreach t in array array['cost_materials', 'cost_suppliers', 'cost_market_prices', 'cost_purchase_lots', 'cost_products', 'cost_purchase_docs'] loop
    execute format('create trigger %I before insert on %I for each row execute function cost_stamp_insert()', t || '_stamp', t);
    execute format('create trigger %I after insert or update on %I for each row execute function cost_audit()', t || '_audit', t);
  end loop;
  foreach t in array array['cost_materials', 'cost_suppliers', 'cost_products'] loop
    execute format('create trigger %I before update on %I for each row execute function cost_master_update()', t || '_update', t);
  end loop;
  foreach t in array array['cost_market_prices', 'cost_purchase_lots', 'cost_purchase_docs'] loop
    execute format('create trigger %I before update on %I for each row execute function cost_void_update()', t || '_void', t);
  end loop;
end;
$do$;

/**
 * 리뷰 C2(c) — 터무니없는 값 막기. 대표 외의 입력이 그 원료의 앞선 90일 중앙값(어제까지 들어온 줄 · 무효 포함 · 3점 이상일 때)의 0.2배 미만이거나 5배 초과면 거부.
 * 3점 미만(새 원료)은 막지 않는다 — 대신 쌍시간(3일)이 그 값을 바로 원가에 비치지 않게 한다.
 * 가짜 시세 · LOT 한 줄로 원가를 크게 흔들어 BOM 비율을 읽는 길(설계서 6.3)을 좁힌다. 진짜 급등락은 대표가 넣거나, 사유와 함께 대표에게 올린다.
 */
create or replace function cost_outlier_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_new numeric;
  v_med numeric;
  v_n int;
  v_today date := cost_today();
  v_start timestamptz := (cost_today()::timestamp at time zone 'Asia/Seoul');
begin
  if coalesce(auth_role()::text, '') = 'Chairman' then return new; end if;
  -- BEFORE 트리거는 RLS 판정보다 먼저 돈다 — 구매 입력 권한이 없는 사람은 여기서 아무 말도 하지 않고 RLS가 거부하게 둔다
  -- (그렇지 않으면 «너무 다르다» · «미래» 오류가 시세를 못 보는 사람에게 시세 범위를 알려 준다).
  if not cost_can('purchasing', new.business_id, true) then return new; end if;
  -- 리뷰 2회차 M1:
  --   · 기준은 «어제까지 들어온 줄»(무효 포함) — 같은 날 여러 출처로 중앙값을 끌어올리거나, 진짜 줄을 무효로 해 기준을 없애는 길을 막는다.
  --   · 창은 [날짜 − 90, 날짜] — 먼 미래 날짜로 기준 밖에 넣는 길을 막고, 대표 외는 내일보다 먼 날짜를 받지 않는다.
  --   · 같은 원료 같은 날 시세는 출처 셋까지.
  if tg_table_name = 'cost_market_prices' then
    if new.observed_on > v_today + 1 then
      raise exception 'cost_date_future' using errcode = '22023';
    end if;
    if (select count(*) from cost_market_prices where material_id = new.material_id and observed_on = new.observed_on and voided_at is null) >= 3 then
      raise exception 'cost_price_too_many' using errcode = '22023';
    end if;
    v_new := new.price_krw_per_kg;
    select percentile_cont(0.5) within group (order by price_krw_per_kg), count(*) into v_med, v_n
      from cost_market_prices where material_id = new.material_id and created_at < v_start
       and observed_on between new.observed_on - 90 and new.observed_on;
  else
    if new.received_on > v_today + 1 then
      raise exception 'cost_date_future' using errcode = '22023';
    end if;
    v_new := new.landed_krw_per_kg;
    select percentile_cont(0.5) within group (order by landed_krw_per_kg), count(*) into v_med, v_n
      from cost_purchase_lots where material_id = new.material_id and created_at < v_start
       and received_on between new.received_on - 90 and new.received_on;
  end if;
  if v_n >= 3 and v_med > 0 and (v_new > v_med * 5 or v_new < v_med * 0.2) then
    raise exception 'cost_price_outlier' using errcode = '22023';
  end if;
  return new;
end;
$fn$;

create trigger cost_market_prices_calc before insert on cost_market_prices for each row execute function cost_market_price_calc();
create trigger cost_purchase_lots_calc before insert on cost_purchase_lots for each row execute function cost_lot_calc();
create trigger cost_market_prices_outlier before insert on cost_market_prices for each row execute function cost_outlier_check();
create trigger cost_purchase_lots_outlier before insert on cost_purchase_lots for each row execute function cost_outlier_check();
create trigger cost_purchase_lots_source before insert on cost_purchase_lots for each row execute function cost_lot_source_check();
create trigger cost_candidate_dismissals_check before insert on cost_candidate_dismissals for each row execute function cost_dismissal_check();

-- =====================================================================
-- 4절. RLS · 권한
-- =====================================================================

do $do$
declare
  t text;
begin
  foreach t in array array['cost_materials', 'cost_suppliers', 'cost_market_prices', 'cost_purchase_lots', 'cost_products',
                           'cost_purchase_docs', 'cost_candidate_dismissals'] loop
    execute format('alter table %I enable row level security', t);
    -- FORCE는 걸지 않는다(리뷰 C1): Supabase의 postgres는 BYPASSRLS가 아니라(0026 · 0027), FORCE면 정의자 함수의 소유자도
    -- 정책을 받는다 — 정책이 전부 «to authenticated»라 정의자 함수가 0행이 된다(엔진이 통째로 죽는다). 일반 역할은 그대로 RLS를 받는다.
    execute format('revoke all on table %I from anon, public', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on table %I from authenticated', t);
    -- 시스템 계정(야간 AI · 연동)은 원가 표 전부에서 막는다 — 0045와 같은 restrictive.
    execute format('create policy %I on %I as restrictive for all to authenticated using (coalesce(auth_role()::text, %L) not in (%L, %L))',
                   t || '_no_system', t, '', 'AIAgent', 'Integration');
  end loop;
end;
$do$;

grant select, insert on cost_materials, cost_suppliers, cost_market_prices, cost_purchase_lots, cost_products, cost_purchase_docs to authenticated;
grant select, insert, delete on cost_candidate_dismissals to authenticated;
grant update (name, spec, category, active, note) on cost_materials to authenticated;
grant update (name, country, currency_default, contact, terms, active, note) on cost_suppliers to authenticated;
grant update (name, sku, pack_kg, active, note) on cost_products to authenticated;
grant update (voided_at, voided_by, void_reason) on cost_market_prices, cost_purchase_lots, cost_purchase_docs to authenticated;
revoke all on sequence cost_market_prices_price_id_seq from anon, public;
revoke update on sequence cost_market_prices_price_id_seq from authenticated;
grant usage, select on sequence cost_market_prices_price_id_seq to authenticated;

-- 원료 이름: 구매 · 생산 · 원가 관리 · 대표. **영업은 원료 이름도 모른다**(회장 결정 2026-10-09 — «영업은 제품 총액만»).
create policy cost_materials_read on cost_materials for select to authenticated using (
  cost_can('purchasing', business_id) or cost_can('production', business_id) or cost_can('costing', business_id));
create policy cost_materials_insert on cost_materials for insert to authenticated with check (cost_can('purchasing', business_id, true));
create policy cost_materials_update on cost_materials for update to authenticated
  using (cost_can('purchasing', business_id, true)) with check (cost_can('purchasing', business_id, true));

create policy cost_products_read on cost_products for select to authenticated using (
  cost_can('purchasing', business_id) or cost_can('production', business_id) or cost_can('sales', business_id) or cost_can('costing', business_id));
create policy cost_products_insert on cost_products for insert to authenticated with check (cost_can('costing', business_id, true));
create policy cost_products_update on cost_products for update to authenticated
  using (cost_can('costing', business_id, true)) with check (cost_can('costing', business_id, true));

-- 공급처: 구매 · 원가 관리 · 대표(표). 생산은 이름만 — cost_production_lots. 영업은 없음.
create policy cost_suppliers_read on cost_suppliers for select to authenticated using (
  cost_can('purchasing', business_id) or cost_can('costing', business_id));
create policy cost_suppliers_insert on cost_suppliers for insert to authenticated with check (cost_can('purchasing', business_id, true));
create policy cost_suppliers_update on cost_suppliers for update to authenticated
  using (cost_can('purchasing', business_id, true)) with check (cost_can('purchasing', business_id, true));

-- 시장가: 구매 · 원가 관리 · 대표(표). 생산은 «제한» 함수. **영업은 원료별 시세를 보지 않는다**(회장 결정 2026-10-09).
create policy cost_market_prices_read on cost_market_prices for select to authenticated using (
  cost_can('purchasing', business_id) or cost_can('costing', business_id));
create policy cost_market_prices_insert on cost_market_prices for insert to authenticated with check (cost_can('purchasing', business_id, true));
create policy cost_market_prices_void on cost_market_prices for update to authenticated
  using (cost_can('purchasing', business_id, true)) with check (cost_can('purchasing', business_id, true));

-- 구매 LOT(실제 구매가 · 분해): 구매 · 원가 관리 · 대표(표). 생산은 landed만(함수), 영업은 요약(함수).
create policy cost_purchase_lots_read on cost_purchase_lots for select to authenticated using (
  cost_can('purchasing', business_id) or cost_can('costing', business_id));
create policy cost_purchase_lots_insert on cost_purchase_lots for insert to authenticated with check (cost_can('purchasing', business_id, true));
create policy cost_purchase_lots_void on cost_purchase_lots for update to authenticated
  using (cost_can('purchasing', business_id, true)) with check (cost_can('purchasing', business_id, true));

create policy cost_purchase_docs_read on cost_purchase_docs for select to authenticated using (
  cost_can('purchasing', business_id) or cost_can('costing', business_id));
create policy cost_purchase_docs_insert on cost_purchase_docs for insert to authenticated
  with check (cost_can('purchasing', business_id, true) and created_by = auth.uid());
create policy cost_purchase_docs_void on cost_purchase_docs for update to authenticated
  using (cost_can('purchasing', business_id, true)) with check (cost_can('purchasing', business_id, true));

create policy cost_candidate_dismissals_rw on cost_candidate_dismissals for all to authenticated
  using (cost_can('purchasing', business_id, true)) with check (cost_can('purchasing', business_id, true));

-- =====================================================================
-- 4-b절. 원가 관리 권한 — 회사마다 소수만 · 대표가 지켜본다(회장 결정 2026-10-09)
--   원가 관리는 원료별 시세 · 구매가 · LOT와 제품 원가를 함께 보므로 원리상 BOM을 역산할 수 있다(설계서 16절).
--   감수 조건: ① 회사마다 셋까지(user_module_access 트리거) ② 원가 조회는 호출마다 감사(0062 cost_gate) · 구매 화면 열람은 0031 열람 기록
--   ③ 대표 화면에 «원가 관리 권한자 + 최근 7일 조회 수»(cost_costing_watch).
-- =====================================================================

create or replace function cost_costing_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.module like '/costing/%' and (
       select count(*) from user_module_access m
        where m.module = new.module and m.user_id <> new.user_id) >= 3 then
    raise exception 'cost_costing_cap' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

revoke all on function cost_costing_cap() from public, anon, authenticated;
create trigger user_module_access_costing_cap before insert or update of module on user_module_access
  for each row execute function cost_costing_cap();

/** 대표: 그 회사 원가 관리 권한자 · 줄 생긴 시각 · 최근 7일 원가 조회 수 · 구매 화면 열람 수. 대표 외는 cost_not_found. */
create or replace function cost_costing_watch(p_business text)
returns table (user_id uuid, display_name text, granted_at timestamptz, cost_reads_7d int, screen_reads_7d int, last_read_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not is_active() or coalesce(auth_role()::text, '') <> 'Chairman' or not has_business(p_business) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select m.user_id, p.display_name, m.granted_at,
         (select count(*)::int from audit_log a where a.actor_user_id = m.user_id and a.action = 'read'
             and a.entity_table = 'cost_products' and a.business_id = p_business and a.occurred_at > now() - interval '7 days'),
         (select count(*)::int from audit_log a where a.actor_user_id = m.user_id and a.action = 'read'
             and a.entity_table = 'screen' and a.after ->> 'path' like '/purchasing/' || p_business || '%'
             and a.occurred_at > now() - interval '7 days'),
         (select max(a.occurred_at) from audit_log a where a.actor_user_id = m.user_id and a.action = 'read'
             and (a.entity_table = 'cost_products' or (a.entity_table = 'screen' and a.after ->> 'path' like '/purchasing/%')))
    from user_module_access m
    join user_profiles p on p.user_id = m.user_id
   where m.module = '/costing/' || p_business
   order by p.display_name;
end;
$fn$;

revoke all on function cost_costing_watch(text) from public, anon;
grant execute on function cost_costing_watch(text) to authenticated;

-- =====================================================================
-- 5절. 구매 첨부 버킷 'purchasing' — 0045 'attachments'와 따로. 0059의 restrictive 정책은 'attachments'에만 걸린다.
--      경로 = '<business_id>/<doc_id>/<파일 이름>'. 줄(cost_purchase_docs)이 먼저, 파일이 뒤(0045 순서).
--      update · delete 정책이 없다 — 올린 파일은 지울 수 없다(무효 줄로 가린다).
-- =====================================================================

insert into storage.buckets (id, name, public) values ('purchasing', 'purchasing', false) on conflict (id) do nothing;

create or replace function cost_doc_object_visible(object_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1 from cost_purchase_docs d
     where d.storage_path = object_name and d.voided_at is null
       and (cost_can('purchasing', d.business_id) or cost_can('costing', d.business_id))
  );
$fn$;

create or replace function cost_doc_object_uploadable(object_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1 from cost_purchase_docs d
     where d.storage_path = object_name and d.voided_at is null
       and d.created_by = auth.uid() and d.created_at > now() - interval '1 hour'
       and cost_can('purchasing', d.business_id, true)
  );
$fn$;

revoke all on function cost_doc_object_visible(text) from public, anon;
revoke all on function cost_doc_object_uploadable(text) from public, anon;
revoke all on function cost_today() from public, anon;
grant execute on function cost_today() to authenticated;
grant execute on function cost_doc_object_visible(text) to authenticated;
grant execute on function cost_doc_object_uploadable(text) to authenticated;

create policy cost_docs_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'purchasing' and public.cost_doc_object_visible(name));
create policy cost_docs_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'purchasing' and public.cost_doc_object_uploadable(name));

-- =====================================================================
-- 6절. 함수 — 결재 후보 · 생산 «제한» · 영업 «요약»
--      권한이 없으면 «없음»과 같은 오류(cost_not_found) — 있는지 없는지도 말하지 않는다.
-- =====================================================================

/** 승인된 «구매» 양식 결재 중 아직 LOT가 안 된 것 · 무시하지 않은 것. 금액 ÷ 수량은 후보일 뿐(부가세 · 배송비가 섞인다). */
create or replace function cost_purchase_candidates(p_business text)
returns table (decision_id text, title text, item text, vendor text, quantity numeric, amount_krw numeric, link text, decided_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not cost_can('purchasing', p_business, true) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select d.decision_id, d.title,
         left(d.form ->> 'item', 200), left(d.form ->> 'vendor', 200),
         case when (d.form ->> 'quantity') ~ '^[0-9]+(\.[0-9]+)?$' then (d.form ->> 'quantity')::numeric end,
         case when replace(d.form ->> 'amount', ',', '') ~ '^[0-9]+(\.[0-9]+)?$' then replace(d.form ->> 'amount', ',', '')::numeric end,
         case when (d.form ->> 'link') ~* '^https?://' then left(d.form ->> 'link', 1000) end,
         d.decided_at
    from decisions d
   where d.business_id = p_business and d.template_key = 'purchase' and d.status = 'Approved'
     and not exists (select 1 from cost_purchase_lots l where l.source = 'approval' and l.source_ref = d.decision_id and l.voided_at is null)
     and not exists (select 1 from cost_candidate_dismissals x where x.decision_id = d.decision_id)
   order by d.decided_at desc nulls last, d.decision_id
   limit 200;
end;
$fn$;

/** 원료 m의 d 이하 최신 시장가(원/kg). 같은 날 여러 출처는 평균. 무효 제외. 내부용(revoke). */
create or replace function cost_market_on(p_material text, p_on date) returns numeric
language sql stable security definer set search_path = public, pg_temp as $fn$
  select avg(price_krw_per_kg) from cost_market_prices
   where material_id = p_material and voided_at is null
     and observed_on = (select max(observed_on) from cost_market_prices
                         where material_id = p_material and voided_at is null and observed_on <= p_on);
$fn$;

/** 생산 «제한»: 원료별 오늘(또는 as_of) 시장가 한 값 — 출처 · 이력 · 외화 · 공급처 없음(설계서 3.3). */
create or replace function cost_production_materials(p_business text, p_as_of date default null)
returns table (material_id text, name text, category text, market_krw_per_kg numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_on date;
begin
  -- 리뷰 I7: 생산(«제한»)은 오늘 한 값만 — 이력 없음. 날짜를 고르는 것은 구매 · 원가 관리 · 대표.
  v_on := case when cost_can('purchasing', p_business) or cost_can('costing', p_business)
               then least(coalesce(p_as_of, cost_today()), cost_today())
               else cost_today() end;
  if not (cost_can('production', p_business) or cost_can('purchasing', p_business) or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select m.material_id, m.name, m.category, round(cost_market_on(m.material_id, v_on), 0)
    from cost_materials m
   where m.business_id = p_business and m.active
   order by m.name;
end;
$fn$;

/** 생산: LOT 가격(landed 원/kg) · 공급처 이름 · 공급처 LOT 번호 · 입고일 · 수량. 외화 단가 · 환율 · 부대비 분해 · 연락처 · 조건 없음. */
create or replace function cost_production_lots(p_business text)
returns table (lot_id text, material_id text, material_name text, supplier_name text, supplier_lot_no text,
               received_on date, qty_kg numeric, landed_krw_per_kg numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not (cost_can('production', p_business) or cost_can('purchasing', p_business) or cost_can('costing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select l.lot_id, l.material_id, m.name, s.name, l.supplier_lot_no, l.received_on, l.qty_kg, round(l.landed_krw_per_kg, 0)
    from cost_purchase_lots l
    join cost_materials m on m.material_id = l.material_id
    join cost_suppliers s on s.supplier_id = l.supplier_id
   where l.business_id = p_business and l.voided_at is null
   order by l.received_on desc, l.lot_id
   limit 1000;
end;
$fn$;

/**
 * 구매 · 원가 관리용 원료별 요약: 기간 수량가중 평균 구매단가(landed 원/kg) + 최신 시장가 + 시장가 대비 %.
 * 2026-10-09 회장 결정으로 **영업은 부르지 못한다**(원료별 구매가 · 시세를 영업에 주지 않는다 — 영업은 제품 총액만).
 */
create or replace function cost_sales_purchase_summary(p_business text, p_days int default 30, p_as_of date default null)
returns table (material_id text, name text, avg_purchase_krw_per_kg numeric, market_krw_per_kg numeric, purchase_vs_market_pct numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_on date;
  v_from date;
begin
  if not (cost_can('costing', p_business) or cost_can('purchasing', p_business)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  v_on := least(coalesce(p_as_of, cost_today()), cost_today());
  v_from := v_on - greatest(7, least(coalesce(p_days, 30), 365));
  return query
  with avgp as (
    select l.material_id, sum(l.landed_krw_per_kg * l.qty_kg) / sum(l.qty_kg) as avg_p
      from cost_purchase_lots l
     where l.business_id = p_business and l.voided_at is null
       and l.received_on > v_from and l.received_on <= v_on
     group by l.material_id
  )
  select m.material_id, m.name, round(a.avg_p, 0), round(mk.v, 0),
         case when mk.v > 0 and a.avg_p is not null then round((a.avg_p / mk.v - 1) * 100, 1) end
    from cost_materials m
    left join avgp a on a.material_id = m.material_id
    cross join lateral (select cost_market_on(m.material_id, v_on) as v) mk
   where m.business_id = p_business and m.active
   order by m.name;
end;
$fn$;

revoke all on function cost_grant(text, text, boolean) from public, anon;
revoke all on function cost_can(text, text, boolean) from public, anon;
grant execute on function cost_grant(text, text, boolean) to authenticated;
grant execute on function cost_can(text, text, boolean) to authenticated;
revoke all on function cost_market_on(text, date) from public, anon, authenticated;
revoke all on function cost_fx(text, date, numeric) from public, anon;
revoke all on function cost_stamp_insert() from public, anon, authenticated;
revoke all on function cost_master_update() from public, anon, authenticated;
revoke all on function cost_void_update() from public, anon, authenticated;
revoke all on function cost_market_price_calc() from public, anon, authenticated;
revoke all on function cost_lot_calc() from public, anon, authenticated;
revoke all on function cost_lot_source_check() from public, anon, authenticated;
revoke all on function cost_dismissal_check() from public, anon, authenticated;
revoke all on function cost_audit() from public, anon, authenticated;
revoke all on function cost_outlier_check() from public, anon, authenticated;
revoke all on function cost_purchase_candidates(text) from public, anon;
revoke all on function cost_production_materials(text, date) from public, anon;
revoke all on function cost_production_lots(text) from public, anon;
revoke all on function cost_sales_purchase_summary(text, int, date) from public, anon;
grant execute on function cost_purchase_candidates(text) to authenticated;
grant execute on function cost_production_materials(text, date) to authenticated;
grant execute on function cost_production_lots(text) to authenticated;
grant execute on function cost_sales_purchase_summary(text, int, date) to authenticated;
grant execute on function cost_fx(text, date, numeric) to authenticated;

commit;
