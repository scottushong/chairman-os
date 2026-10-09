-- =====================================================================
-- Chairman OS — 0062_cost_secret_bom (비공개 BOM · 원가 함수 1차: Market · Current)
-- 작성: 2026-10-09 · 설계서 docs/superpowers/specs/cost-engine.md (2.7 · 4 · 6 · 7절)
--
-- ■ 회장 결정 ■
--   BOM · 비율 · 제품별 원료 구성 = 대표(Chairman)만 열람 · 편집. 임원 · 회사 대표 포함 전원 불가. 넓힐 자리 = cost_secret.bom_access(비어 있음).
--   진짜 BOM은 암호화(0063) 전에는 입력 금지 → bom_versions.is_fake = true만 받는다(check). 가짜 BOM으로만 시험한다.
--   BOM은 AI 도구 · 요약 · 어시스턴트 · 입구 분류에 가지 않는다 — 이 스키마를 부르는 AI 도구가 없고, 시스템 계정은 함수 첫 줄에서 막힌다.
--
-- ■ 나가는 길(일반 사용자 = 0개) ■
--   · 스키마 cost_secret: usage 없음(public · anon · authenticated). PostgREST 노출 스키마(config.toml)에 없다. 표에 grant 없음.
--     RLS enable(정책 없음) — 실수로 grant가 생겨도 0행. force는 걸지 않는다(정의자 함수의 소유자가 읽어야 한다).
--   · 공개 스키마의 어떤 뷰도 cost_secret을 참조하지 않는다.
--   · 내부 함수(cost_secret.*)는 execute를 전부 걷는다.
--   · 공개 RPC 다섯:
--       cost_bom_get(product, as_of)            대표 — 판 · 원료 · 비율. 읽음 감사.
--       cost_bom_save(product, from, yield, lines, note)  대표 — 가짜만. 감사(값 없이 판 번호 · 원료 수).
--       cost_bom_void(version, reason)          대표.
--       cost_product_cost(product, kind, as_of) 대표 · 원가 관리 · 영업 — **반올림한 원료비 합계(원/kg) 한 값**만.
--                                               인자로 BOM을 바꾸거나 원료를 고르는 길이 없다. 영업은 기준일이 그 주 월요일로 고정된다.
--       cost_product_breakdown(product, kind, as_of)  대표 — 원료별 분해.
--       cost_material_impact(product, kind, from, to) 대표 · 원가 관리 · 영업 — 원료비 변화율 하나(0.1%p).
--   · 오류: 없는 제품 · 다른 회사 · 권한 없음 = 같은 'cost_not_found'(P0002). 오류 · 경고에 원료 이름 · 개수 · 비율을 넣지 않는다.
--   · 대표 외 조회는 하루 · 사람 · 제품 · 종류마다 audit_log 한 줄 + 하루 200건 한도('cost_rate_limited').
--
-- ■ 1차 계산 ■
--   투입량 q(m) = kg_per_kg ÷ (yield_pct / 100). 원료비 = Σ q(m) × 단가(m, d).
--   Market  단가 = d 이하 최신 시장가(같은 날 여러 출처 평균) — 0061 cost_market_on.
--   Current 단가 = d 이전 180일 안에 들어온 LOT의 수량 가중 평균 landed(원/kg) · 없으면 d 이하 마지막 LOT.
--             (생산 투입 · 잔량은 0064에서 — 그때 «남은 LOT 잔량 가중»으로 create or replace한다.)
--   단가 없는 원료가 하나라도 있으면 계산하지 않는다(0으로 메우지 않는다) — reason 'price_missing'(개수 없이).
--   Actual · Forecast는 0064 · 0065. 지금 부르면 'cost_kind_unsupported'.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 비공개 스키마
-- =====================================================================
create schema if not exists cost_secret;
revoke all on schema cost_secret from public;
revoke all on schema cost_secret from anon, authenticated;

create table cost_secret.bom_versions (
  version_id  bigint generated always as identity primary key,
  product_id  text not null references public.cost_products(product_id),
  valid_from  date not null,
  yield_pct   numeric(7, 4) not null default 100 check (yield_pct > 0 and yield_pct <= 100),
  is_fake     boolean not null check (is_fake),          -- 1차: 진짜 BOM 입력 금지(회장 결정). 0063이 이 check를 푼다.
  payload_enc bytea,                                     -- 0063 암호화 자리(원료 목록 + 비율 통째). 1차는 null.
  note        text not null default '' check (length(note) <= 300),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid,
  void_reason text,
  constraint bom_versions_void_shape check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)),
  constraint bom_versions_no_payload_yet check (payload_enc is null)
);
create unique index bom_versions_one_per_day on cost_secret.bom_versions (product_id, valid_from) where voided_at is null;

create table cost_secret.bom_lines (
  version_id  bigint not null references cost_secret.bom_versions(version_id),
  material_id text not null references public.cost_materials(material_id),
  kg_per_kg   numeric(12, 8) not null check (kg_per_kg > 0 and kg_per_kg <= 100),
  primary key (version_id, material_id)
);

/** 넓힐 자리(회장 결정 1). 1차는 비어 있고 쓰는 길(RPC)도 없다 — 대표가 SQL Editor에서만 넣을 수 있다. */
create table cost_secret.bom_access (
  user_id    uuid primary key,
  can_read   boolean not null default false,
  can_write  boolean not null default false,
  granted_by uuid not null,
  granted_at timestamptz not null default now()
);

/** 대표 외 원가 조회 — 하루 한도 · 하루 한 줄 감사의 근거. */
create table cost_secret.cost_reads (
  user_id    uuid not null,
  read_on    date not null,
  product_id text not null,
  kind       text not null,
  as_of      date not null,
  calls      int not null default 1,
  constraint cost_reads_pkey primary key (user_id, read_on, product_id, kind, as_of)
);

alter table cost_secret.bom_versions enable row level security;
alter table cost_secret.bom_lines    enable row level security;
alter table cost_secret.bom_access   enable row level security;
alter table cost_secret.cost_reads   enable row level security;
revoke all on all tables in schema cost_secret from public, anon, authenticated;
revoke all on all sequences in schema cost_secret from public, anon, authenticated;

-- =====================================================================
-- 2절. 판정 · 내부 계산(cost_secret — execute 없음)
-- =====================================================================

/** BOM을 읽을 수 있는가: 활성 대표, 또는 bom_access(비어 있음). 시스템 계정은 늘 거짓. */
create or replace function cost_secret.bom_reader(p_write boolean default false) returns boolean
language sql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
  select is_active()
     and coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration')
     and (coalesce(auth_role()::text, '') = 'Chairman'
          or exists (select 1 from cost_secret.bom_access a
                      where a.user_id = auth.uid() and a.can_read and (not p_write or a.can_write)));
$fn$;

/**
 * 원료 m의 d 단가(원/kg). market · current. 없으면 null.
 * p_known(리뷰 C2(b) — 쌍시간): 그 시각에 «이미 들어와 있었고 아직 무효가 아니던» 줄만 본다. 대표는 'infinity'(지금 아는 전부),
 * 대표 외는 cost_gate가 정한 시각(지금보다 3일 전 · 기준일 끝 중 이른 것) — 오늘 넣은 가짜 시세 · 과거 날짜로 넣은 줄 · 오늘 무효로 한 줄이
 * 원가에 바로 비치지 않게.
 */
create or replace function cost_secret.unit_price(p_material text, p_kind text, p_on date, p_known timestamptz default 'infinity')
returns numeric
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v numeric;
begin
  if p_kind = 'market' then
    select avg(m.price_krw_per_kg) into v from public.cost_market_prices m
     where m.material_id = p_material and m.created_at <= p_known and (m.voided_at is null or m.voided_at > p_known)
       and m.observed_on = (select max(x.observed_on) from public.cost_market_prices x
                             where x.material_id = p_material and x.observed_on <= p_on
                               and x.created_at <= p_known and (x.voided_at is null or x.voided_at > p_known));
    return v;
  elsif p_kind = 'current' then
    select sum(l.landed_krw_per_kg * l.qty_kg) / nullif(sum(l.qty_kg), 0) into v
      from public.cost_purchase_lots l
     where l.material_id = p_material and l.created_at <= p_known and (l.voided_at is null or l.voided_at > p_known)
       and l.received_on <= p_on and l.received_on > p_on - 180;
    if v is null then
      select l.landed_krw_per_kg into v from public.cost_purchase_lots l
       where l.material_id = p_material and l.created_at <= p_known and (l.voided_at is null or l.voided_at > p_known)
         and l.received_on <= p_on
       order by l.received_on desc, l.created_at desc limit 1;
    end if;
    return v;
  end if;
  return null;
end;
$fn$;

/** d에 쓰는 BOM 판(무효 제외, valid_from ≤ d 중 가장 늦은 것). */
create or replace function cost_secret.version_on(p_product text, p_on date) returns bigint
language sql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
  select version_id from cost_secret.bom_versions
   where product_id = p_product and voided_at is null and valid_from <= p_on
   order by valid_from desc limit 1;
$fn$;

/** 원료비 합계(원/kg, 반올림 전) · 단가 없는 원료 수(-1 = BOM 없음). */
create or replace function cost_secret.material_cost(p_product text, p_kind text, p_on date, p_known timestamptz default 'infinity',
                                                     out total numeric, out missing int)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_ver bigint := cost_secret.version_on(p_product, p_on);
  v_yield numeric;
begin
  if v_ver is null then
    total := null; missing := -1; return;
  end if;
  select yield_pct into v_yield from cost_secret.bom_versions where version_id = v_ver;
  select sum(x.q * x.up), count(*) filter (where x.up is null)::int into total, missing
    from (select l.kg_per_kg / (v_yield / 100) as q, cost_secret.unit_price(l.material_id, p_kind, p_on, p_known) as up
            from cost_secret.bom_lines l where l.version_id = v_ver) x;
  if missing > 0 then total := null; end if;
end;
$fn$;

/**
 * 원가 조회 문. 제품이 보이는 회사인지 · 원가 관리 또는 영업인지 판정하고, 하루 한도를 세고, 하루 · 기준일마다 한 줄 감사를 남긴다.
 * 돌려주는 것: 회사 · 기준일 · 아는 시각 · 대표인가.
 *   대표       기준일 그대로 · 아는 시각 = 지금 전부 · 한도 · 감사 없음.
 *   원가 관리 · 영업  기준일 = 이번 주 월요일 하나(인자 무시 — 리뷰 2회차 C1: 시세 표를 읽는 사람이 합계를 여러 날짜로 받으면
 *                     원료 k개 제품의 비율이 k+1개 날짜로 풀린다. 한 주에 한 점만 쌓이게 한다).
 *   아는 시각 = least(지금 − 3일, 기준일 끝(KST)) — 리뷰 C2(b).
 *   구매 입력 줄을 같이 가진 사람은 원가를 못 본다(리뷰 C2(a) — 시세를 넣고 원가 변화를 읽으면 비율이 그대로 나온다): 'cost_role_conflict'.
 */
create or replace function cost_secret.cost_gate(p_product text, p_kind text, p_as_of date,
                                                 out business_id text, out as_of date, out known_at timestamptz, out chairman boolean)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_role text := coalesce(auth_role()::text, '');
  v_today date := cost_today();
  v_total int;
  v_new boolean;
begin
  if not is_active() or v_role in ('AIAgent', 'Integration', '') then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select p.business_id into business_id from cost_products p where p.product_id = p_product;
  if business_id is null then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  chairman := v_role = 'Chairman';
  if chairman then
    if not has_business(business_id) then raise exception 'cost_not_found' using errcode = 'P0002'; end if;
    as_of := coalesce(p_as_of, v_today);
    known_at := 'infinity';
    return;
  end if;
  if not (cost_can('costing', business_id) or cost_can('sales', business_id)) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if cost_grant('purchasing', business_id, true) then
    raise exception 'cost_role_conflict' using errcode = '42501';
  end if;
  -- 리뷰 2회차 C1 — 시세를 읽는 사람(원가 관리 · 영업 둘 다 시세 표 O)이 합계를 여러 날짜로 받으면 최소제곱으로 비율이 첫날에 풀린다.
  -- 대표 외는 원가 관리 · 영업 모두 «이번 주 월요일» 한 값(인자 무시) — 한 주에 한 점씩만 쌓인다(설계서 6.3).
  as_of := date_trunc('week', v_today)::date;
  -- 회장 결정(2026-10-09) — 대표 외 원가는 «주 1회 월요일 0시(KST) 스냅샷»: 이번 주 월요일 기준일, 월요일 0시까지 들어와 있던 시세 · LOT만.
  -- 주 안에서 값이 움직이지 않는다(리뷰 3회차 C1 — 흐르는 «아는 시각»은 원료 하나씩 비율을 흘린다).
  -- 영업은 원료 이름 · 시세 · 구매가를 못 보므로 Market · Current 둘 다 받는다(제품 총액만 · 원가 우위). 원가 관리는 원리상 역산 가능 —
  -- 감수 조건(소수 · 호출마다 감사 · 대표 감시)으로 둘 다 받는다(설계서 16절).
  known_at := (as_of::timestamp at time zone 'Asia/Seoul');
  select coalesce(sum(r.calls), 0) into v_total from cost_secret.cost_reads r where r.user_id = auth.uid() and r.read_on = v_today;
  if v_total >= 200 then
    raise exception 'cost_rate_limited' using errcode = '54000';
  end if;
  insert into cost_secret.cost_reads (user_id, read_on, product_id, kind, as_of) values (auth.uid(), v_today, p_product, p_kind, as_of)
  on conflict on constraint cost_reads_pkey do update set calls = cost_secret.cost_reads.calls + 1
  returning (xmax = 0) into v_new;
  -- 원가 관리 조회는 호출마다 감사(회장 결정 감수 조건). 영업은 하루 · 제품 · 종류 · 기준일마다 한 줄.
  if v_new or cost_can('costing', business_id) then
    insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
    values ('read', 'cost_products', p_product, business_id, auth.uid(), v_role, null,
            jsonb_build_object('kind', p_kind, 'as_of', as_of), '원가 조회(0062) — 하루 · 기준일마다 한 줄');
  end if;
end;
$fn$;

/** 리뷰 3회차 I1 — 사용 중이 아니어도 그 날 쓰는 BOM 판에 든 원료는 센다(단종 원료가 든 제품만 계산 안 됨이 소속을 알려 주지 않게).
 *  그 회사의 사용 중 원료 전부에 그 종류 · 그 날짜 · 그 시각까지 알려진 단가가 있는가(대표 외 «계산됨»의 문 — 리뷰 2회차 I1). */
create or replace function cost_secret.business_complete(p_business text, p_kind text, p_on date, p_known timestamptz) returns boolean
language sql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
  select not exists (
    select 1 from public.cost_materials m
     where m.business_id = p_business
       and (m.active or exists (
             select 1 from cost_secret.bom_lines l join cost_secret.bom_versions v on v.version_id = l.version_id
              where l.material_id = m.material_id and v.voided_at is null
                and v.version_id = cost_secret.version_on(v.product_id, p_on)))
       and cost_secret.unit_price(m.material_id, p_kind, p_on, p_known) is null
  );
$fn$;

revoke all on all functions in schema cost_secret from public, anon, authenticated;

-- =====================================================================
-- 3절. 공개 RPC
-- =====================================================================

/**
 * 제품 원료비(원/kg) — 10원 반올림 한 값. 계산 못 하면 computed = false + 이유 코드.
 * 이유: 대표 = no_bom · price_missing. 대표 외 = not_computed 하나(리뷰 I5 — «이 날 단가 없는 원료가 있다»가 BOM 소속을 알려 준다).
 */
create or replace function cost_product_cost(p_product text, p_kind text default 'current', p_as_of date default null)
returns table (product_id text, kind text, as_of date, material_krw_per_kg numeric, computed boolean, reason text)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  g record;
  c record;
begin
  if p_kind is null or p_kind not in ('market', 'current') then
    raise exception 'cost_kind_unsupported' using errcode = '22023';
  end if;
  select * into g from cost_secret.cost_gate(p_product, p_kind, p_as_of);
  -- 리뷰 2회차 I1 — 대표 외에게 «계산됨»이 BOM에 기대면(단가 없는 원료가 이 제품에 있나) 소속이 샌다. 회사의 사용 중 원료 전부에
  -- 그 종류 단가가 있을 때만 계산한다 — 하나라도 없으면 그 회사 모든 제품이 똑같이 not_computed.
  if not g.chairman and not cost_secret.business_complete(g.business_id, p_kind, g.as_of, g.known_at) then
    return query select p_product, p_kind, g.as_of, null::numeric, false, 'not_computed'::text;
    return;
  end if;
  select * into c from cost_secret.material_cost(p_product, p_kind, g.as_of, g.known_at);
  return query select p_product, p_kind, g.as_of,
    case when c.total is null then null else round(c.total, -1) end,
    c.total is not null,
    case when c.total is not null then null
         when not g.chairman then 'not_computed'
         when c.missing = -1 then 'no_bom' else 'price_missing' end;
end;
$fn$;

/**
 * 원료비 변화율(묶음 한 값). 대표 = 0.1%p(반올림 전 합계). 대표 외 = 반올림한 합계끼리 · 1%p, 시작일은 기준일 35일 안
 * (리뷰 I4 — 0.1%p는 10원 반올림보다 정밀해서 원료 하나의 값이 움직인 날 비율을 거의 그대로 알려 준다). 한도 · 감사는 한 번.
 */
create or replace function cost_material_impact(p_product text, p_kind text, p_from date, p_to date)
returns numeric
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  g record;
  v_from date;
  a record;
  b record;
begin
  if p_kind is null or p_kind not in ('market', 'current') or p_from is null or p_to is null then
    raise exception 'cost_kind_unsupported' using errcode = '22023';
  end if;
  select * into g from cost_secret.cost_gate(p_product, 'impact_' || p_kind, p_to);
  v_from := least(p_from, g.as_of);
  if not g.chairman then
    -- 리뷰 2회차 C1 — 대표 외는 «지난 주 월요일 → 이번 주 월요일» 한 값만(인자 무시). 날짜를 바꿔 가며 과거 합계를 되살리지 못하게.
    v_from := g.as_of - 7;
    if not (cost_secret.business_complete(g.business_id, p_kind, v_from, g.known_at)
            and cost_secret.business_complete(g.business_id, p_kind, g.as_of, g.known_at)) then
      return null;
    end if;
  end if;
  select * into a from cost_secret.material_cost(p_product, p_kind, v_from, g.known_at);
  select * into b from cost_secret.material_cost(p_product, p_kind, g.as_of, g.known_at);
  if a.total is null or b.total is null or a.total = 0 then return null; end if;
  -- «원료비 영향 +4.2%» — 묶음 한 값, 0.1%p(회장 결정 화면 예). 영업은 원료별 시세를 못 봐 이 값으로 비율을 풀 수 없다.
  return round((b.total / a.total - 1) * 100, 1);
end;
$fn$;

/** 대표: 원료별 분해(반올림 전). 읽음 감사(값 없이). */
create or replace function cost_product_breakdown(p_product text, p_kind text default 'current', p_as_of date default null)
returns table (material_id text, material_name text, kg_per_kg numeric, qty_kg_per_kg numeric, unit_krw_per_kg numeric, contribution_krw_per_kg numeric)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_biz text;
  v_on date := coalesce(p_as_of, cost_today());
  v_ver bigint;
  v_yield numeric;
begin
  if not cost_secret.bom_reader() or p_kind is null or p_kind not in ('market', 'current') then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select p.business_id into v_biz from cost_products p where p.product_id = p_product;
  if v_biz is null or not has_business(v_biz) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  v_ver := cost_secret.version_on(p_product, v_on);
  if v_ver is null then return; end if;
  select yield_pct into v_yield from cost_secret.bom_versions where version_id = v_ver;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('read', 'cost_bom', v_ver::text, v_biz, auth.uid(), auth_role()::text, null, null, 'BOM 분해 열람(0062)');
  return query
  select l.material_id, m.name, l.kg_per_kg, l.kg_per_kg / (v_yield / 100), u.up, (l.kg_per_kg / (v_yield / 100)) * u.up
    from cost_secret.bom_lines l
    join cost_materials m on m.material_id = l.material_id
    cross join lateral (select cost_secret.unit_price(l.material_id, p_kind, v_on) as up) u
   where l.version_id = v_ver
   order by m.name;
end;
$fn$;

/** 대표: 그 날 쓰는 BOM 판 · 원료 · 비율. 읽음 감사(값 없이). */
create or replace function cost_bom_get(p_product text, p_as_of date default null)
returns table (version_id bigint, valid_from date, yield_pct numeric, is_fake boolean, material_id text, material_name text, kg_per_kg numeric)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_biz text;
  v_ver bigint;
begin
  if not cost_secret.bom_reader() then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select p.business_id into v_biz from cost_products p where p.product_id = p_product;
  if v_biz is null or not has_business(v_biz) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  v_ver := cost_secret.version_on(p_product, coalesce(p_as_of, cost_today()));
  if v_ver is null then return; end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('read', 'cost_bom', v_ver::text, v_biz, auth.uid(), auth_role()::text, null, null, 'BOM 열람(0062)');
  return query
  select b.version_id, b.valid_from, b.yield_pct, b.is_fake, l.material_id, m.name, l.kg_per_kg
    from cost_secret.bom_versions b
    join cost_secret.bom_lines l on l.version_id = b.version_id
    join cost_materials m on m.material_id = l.material_id
   where b.version_id = v_ver
   order by m.name;
end;
$fn$;

/**
 * 대표: BOM 판 저장(가짜만 — 1차). p_lines = [{"material_id": "...", "kg_per_kg": 0.25}, …] 1~200줄 · 같은 회사 원료 · 중복 없음.
 * 감사는 값 없이(판 번호 · 원료 수) — 감사 줄은 백업 · 내보내기로 샌다.
 */
create or replace function cost_bom_save(p_product text, p_valid_from date, p_yield_pct numeric, p_lines jsonb, p_note text default '')
returns bigint
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_biz text;
  v_ver bigint;
  v_n int;
begin
  if not cost_secret.bom_reader(true) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select p.business_id into v_biz from cost_products p where p.product_id = p_product;
  if v_biz is null or not has_business(v_biz) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_valid_from is null or p_yield_pct is null or p_yield_pct <= 0 or p_yield_pct > 100 then
    raise exception 'cost_bom_invalid' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'cost_bom_invalid' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_lines);
  if v_n < 1 or v_n > 200 then
    raise exception 'cost_bom_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e -> 'kg_per_kg') <> 'number'
        or (e ->> 'kg_per_kg')::numeric <= 0 or (e ->> 'kg_per_kg')::numeric > 100
        or not exists (select 1 from cost_materials m where m.material_id = e ->> 'material_id' and m.business_id = v_biz)
  ) or (select count(distinct e ->> 'material_id') from jsonb_array_elements(p_lines) e) <> v_n then
    raise exception 'cost_bom_invalid' using errcode = '22023';
  end if;

  -- 같은 날 판이 있으면 그것을 무효로 하고 새로 쓴다(이력은 남는다).
  update cost_secret.bom_versions set voided_at = now(), voided_by = auth.uid(), void_reason = '같은 날 새 판으로 교체'
   where product_id = p_product and valid_from = p_valid_from and voided_at is null;

  insert into cost_secret.bom_versions (product_id, valid_from, yield_pct, is_fake, note, created_by)
  values (p_product, p_valid_from, p_yield_pct, true, left(coalesce(p_note, ''), 300), auth.uid())
  returning version_id into v_ver;
  insert into cost_secret.bom_lines (version_id, material_id, kg_per_kg)
  select v_ver, e ->> 'material_id', (e ->> 'kg_per_kg')::numeric from jsonb_array_elements(p_lines) e;

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('create', 'cost_bom', v_ver::text, v_biz, auth.uid(), auth_role()::text, null,
          jsonb_build_object('version_id', v_ver, 'valid_from', p_valid_from, 'lines', v_n, 'fake', true), 'BOM 판 저장(0062 · 가짜)');
  return v_ver;
end;
$fn$;

create or replace function cost_bom_void(p_version bigint, p_reason text)
returns void
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_biz text;
begin
  if not cost_secret.bom_reader(true) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select p.business_id into v_biz from cost_secret.bom_versions b join cost_products p on p.product_id = b.product_id
   where b.version_id = p_version and b.voided_at is null;
  if v_biz is null or not has_business(v_biz) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or length(p_reason) > 300 then
    raise exception 'cost_void_reason' using errcode = '23514';
  end if;
  update cost_secret.bom_versions set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where version_id = p_version;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'cost_bom', p_version::text, v_biz, auth.uid(), auth_role()::text, null, jsonb_build_object('voided', true), 'BOM 판 무효(0062)');
end;
$fn$;

/** 등급 — GM 20% 이상 Green · 15~20% Yellow · 15% 미만 Red(회장 결정). */
create or replace function cost_grade(p_gm_pct numeric) returns text
language sql immutable set search_path = public, pg_temp as $fn$
  select case when p_gm_pct is null then null when p_gm_pct >= 20 then 'green' when p_gm_pct >= 15 then 'yellow' else 'red' end;
$fn$;

/**
 * 영업 화면 한 줄(회장 결정 2026-10-09 «영업은 제품 총액만»): 제품마다
 *   Market 원료비(시장가로 샀다면) · Current 원료비(DY 원가) · 원가 우위(Market − Current) · 비용(비용 마스터 0065 전에는 null) ·
 *   총원가(Current + 비용) · 원료비 영향(지난 주 → 이번 주, 0.1%p) · 목표 마진별 제시가(15 · 20 · 25 · 30%).
 * 모두 10원/kg 반올림 · 이번 주 월요일 0시 스냅샷. **원료 이름 · 원료별 값은 어디에도 없다.** 조회 한도 · 감사는 한 번으로 센다.
 */
create or replace function cost_sales_view(p_product text)
returns table (product_id text, as_of date, market_krw_per_kg numeric, current_krw_per_kg numeric, advantage_krw_per_kg numeric,
               overhead_krw_per_kg numeric, total_krw_per_kg numeric, overhead_ready boolean, material_impact_pct numeric,
               computed boolean, offers jsonb)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  g record;
  v_mk_raw numeric;
  v_cu_raw numeric;
  v_pr_raw numeric;
  v_total numeric;
  v_mk numeric;
  v_cu numeric;
  v_ok boolean;
begin
  select * into g from cost_secret.cost_gate(p_product, 'sales_view', null);
  v_ok := g.chairman or (cost_secret.business_complete(g.business_id, 'market', g.as_of, g.known_at)
                         and cost_secret.business_complete(g.business_id, 'current', g.as_of, g.known_at));
  if v_ok then
    select x.total into v_mk_raw from cost_secret.material_cost(p_product, 'market', g.as_of, g.known_at) x;
    select x.total into v_cu_raw from cost_secret.material_cost(p_product, 'current', g.as_of, g.known_at) x;
    select x.total into v_pr_raw from cost_secret.material_cost(p_product, 'current', g.as_of - 7, g.known_at) x;
  end if;
  v_mk := round(v_mk_raw, -1);
  v_cu := round(v_cu_raw, -1);
  v_total := v_cu;  -- 0065 비용 마스터가 오면 + 배부 비용
  return query select p_product, g.as_of, v_mk, v_cu,
    v_mk - v_cu,
    null::numeric, v_total, false,
    case when v_pr_raw > 0 then round((v_cu_raw / v_pr_raw - 1) * 100, 1) end,
    v_cu is not null,
    case when v_total is null then '[]'::jsonb else (
      select jsonb_agg(jsonb_build_object('margin_pct', m, 'price_krw_per_kg', round(v_total / (1 - m / 100.0), -1), 'grade', cost_grade(m)) order by m)
        from unnest(array[15, 20, 25, 30]) m) end;
end;
$fn$;

/** 영업: 제시가를 넣으면 마진(원 · %)과 등급. 총원가는 cost_sales_view와 같은 주간 값. Red면 화면이 0059 결재로 승인 요청을 올린다. */
create or replace function cost_price_check(p_product text, p_price_krw_per_kg numeric)
returns table (total_krw_per_kg numeric, margin_krw_per_kg numeric, margin_pct numeric, grade text)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v record;
begin
  if p_price_krw_per_kg is null or p_price_krw_per_kg <= 0 or p_price_krw_per_kg > 1e9 then
    raise exception 'cost_price_invalid' using errcode = '22023';
  end if;
  select * into v from cost_sales_view(p_product);
  if v.total_krw_per_kg is null then
    return query select null::numeric, null::numeric, null::numeric, null::text;
    return;
  end if;
  return query select v.total_krw_per_kg, p_price_krw_per_kg - v.total_krw_per_kg,
    round((p_price_krw_per_kg - v.total_krw_per_kg) / p_price_krw_per_kg * 100, 1),
    cost_grade(round((p_price_krw_per_kg - v.total_krw_per_kg) / p_price_krw_per_kg * 100, 1));
end;
$fn$;

revoke all on function cost_grade(numeric) from public, anon;
grant execute on function cost_grade(numeric) to authenticated;
revoke all on function cost_sales_view(text) from public, anon;
revoke all on function cost_price_check(text, numeric) from public, anon;
grant execute on function cost_sales_view(text) to authenticated;
grant execute on function cost_price_check(text, numeric) to authenticated;

revoke all on function cost_product_cost(text, text, date) from public, anon;
revoke all on function cost_material_impact(text, text, date, date) from public, anon;
revoke all on function cost_product_breakdown(text, text, date) from public, anon;
revoke all on function cost_bom_get(text, date) from public, anon;
revoke all on function cost_bom_save(text, date, numeric, jsonb, text) from public, anon;
revoke all on function cost_bom_void(bigint, text) from public, anon;
grant execute on function cost_product_cost(text, text, date) to authenticated;
grant execute on function cost_material_impact(text, text, date, date) to authenticated;
grant execute on function cost_product_breakdown(text, text, date) to authenticated;
grant execute on function cost_bom_get(text, date) to authenticated;
grant execute on function cost_bom_save(text, date, numeric, jsonb, text) to authenticated;
grant execute on function cost_bom_void(bigint, text) to authenticated;

commit;
