-- =====================================================================
-- Chairman OS — 0063_cost_bom_encrypt (BOM 암호화 — Supabase Vault 키 + pgcrypto)
-- 작성: 2026-10-09 · 설계서 docs/superpowers/specs/cost-engine.md 7절(안 A) · 키 만들기 docs/onboarding/bom-key-setup.md
--
-- ■ 무엇이 바뀌나 ■
--   · BOM 비율은 판(bom_versions)마다 한 줄 payload_enc(bytea)에 암호문으로만 남는다. 평문 표 cost_secret.bom_lines는 없어진다
--     (0062까지 들어간 줄은 가짜뿐 — check is_fake — 이고, 여기서 암호문으로 옮긴 뒤 표를 지운다).
--   · 키는 Supabase Vault의 비밀 'cost_bom_key' 하나. 이 마이그레이션도, 앱도, 저장소도 키를 갖지 않는다 — 대표가 SQL Editor에서
--     `vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'cost_bom_key', …)`로 만든다(키가 글자로 화면에 나오지 않는다).
--   · 복호화는 cost_secret 안의 정의자 함수(bom_lines_of) 한 곳뿐. 부르는 곳: 원가 계산(material_cost · business_complete) ·
--     대표 BOM 열람(cost_bom_get) · 대표 분해(cost_product_breakdown). 모두 0062의 문(대표 · 원가 관리 · 영업 판정)을 지난 뒤다.
--   · 키가 없으면 BOM 저장 · 원가 계산이 'cost_bom_key_missing'으로 멈춘다(조용히 0 · 빈 값 금지). 키가 틀리거나 암호문이 깨지면
--     'cost_bom_unreadable' 한 문장 — 원문 · 원료 id · 비율이 오류 문장 · DETAIL · CONTEXT에 실리지 않게 모든 해독 · 파싱 오류를 삼켜 바꾼다.
--   · 진짜 BOM: is_fake check를 푼다. 대신 «진짜 BOM 받기» 스위치(cost_secret.bom_settings.real_allowed, 기본 꺼짐)를 대표가
--     cost_bom_real_allow(true)로 켜야 진짜(is_fake = false) 판을 받는다 — 회장 결정 «진짜 BOM은 암호화가 운영에 들어간 뒤».
--
-- ■ 새지 않게 ■
--   · 암호: pgp_sym_encrypt(…, 'cipher-algo=aes256, compress-algo=0, s2k-mode=1') — 압축 없음(길이로 내용을 짐작하는 길), 키가 무작위
--     256비트라 s2k 반복은 필요 없다(계산 속도). 원문은 512바이트 단위로 공백을 채워 길이로 원료 수가 드러나지 않게 한다.
--   · 감사 줄 · 오류 · NOTICE에 값이 없다(0062와 같다). 이 파일에는 raise notice/warning/info가 없다(check:cost-engine이 정적으로 잰다).
--   · 표 · 함수 권한은 0062와 같다 — cost_secret에 usage 없음, 내부 함수 execute 없음. vault 스키마도 authenticated에 권한이 없다(Supabase 기본).
--
-- ■ 운영 조건 ■ (OPERATIONS · bom-key-setup.md)
--   · 키를 지우거나 바꾸면 그때까지의 BOM을 읽을 수 없다 — 원본은 R2(자체 ERP)에 있으므로 다시 넣는다. 키를 복사해 두지 않는다.
--   · pgcrypto(extensions 스키마)와 supabase_vault는 Supabase 프로젝트에 기본으로 켜져 있다. 이 파일은 확장을 만들지 않는다
--     (PGlite 검사기 · check:migrations가 확장 없이도 이 파일을 올릴 수 있게 — 함수 본문은 plpgsql이라 부를 때 찾는다).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 키 · 암호 · 해독(cost_secret — execute 없음)
-- =====================================================================

/** Vault 비밀 'cost_bom_key'. 없으면(또는 vault · 권한이 없으면) cost_bom_key_missing. 동적 SQL — vault가 없는 DB에서도 이 파일이 올라간다. */
create or replace function cost_secret.bom_key() returns text
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v text;
begin
  begin
    execute 'select decrypted_secret::text from vault.decrypted_secrets where name = $1 order by created_at desc limit 1' into v using 'cost_bom_key';
  exception when others then
    v := null;
  end;
  if v is null or length(v) < 32 then
    raise exception 'cost_bom_key_missing' using errcode = '55000';
  end if;
  return v;
end;
$fn$;

/** 원료 목록 + 비율 → 암호문. p_lines = [{"material_id":…, "kg_per_kg":…}, …](검증은 부르는 쪽). 512바이트 단위로 채운다. */
create or replace function cost_secret.bom_encrypt(p_lines jsonb) returns bytea
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_txt text;
  v_key text := cost_secret.bom_key();
begin
  v_txt := jsonb_build_object('v', 1, 'l', (
    select jsonb_agg(jsonb_build_object('m', e ->> 'material_id', 'q', (e ->> 'kg_per_kg')::numeric) order by e ->> 'material_id')
      from jsonb_array_elements(p_lines) e))::text;
  v_txt := rpad(v_txt, ((length(v_txt) / 512) + 1) * 512, ' ');
  return extensions.pgp_sym_encrypt(v_txt, v_key, 'cipher-algo=aes256, compress-algo=0, s2k-mode=1');
end;
$fn$;

/**
 * 판 하나의 원료 · 비율(해독). 키 없음 = cost_bom_key_missing, 해독 · 파싱 실패 = cost_bom_unreadable — 어느 쪽도 원문 조각을 싣지 않는다
 * (json 파싱 오류는 DETAIL에 원문 토큰을, numeric 변환 오류는 값을 싣는다 — 그래서 해독부터 변환까지를 한 블록에서 삼킨다).
 */
create or replace function cost_secret.bom_lines_of(p_version bigint)
returns table (material_id text, kg_per_kg numeric)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_enc bytea;
  v_key text;
  v_m text[];
  v_q numeric[];
begin
  select b.payload_enc into v_enc from cost_secret.bom_versions b where b.version_id = p_version;
  if v_enc is null then
    return;
  end if;
  v_key := cost_secret.bom_key();
  begin
    select array_agg(e ->> 'm' order by e ->> 'm'), array_agg((e ->> 'q')::numeric order by e ->> 'm') into v_m, v_q
      from jsonb_array_elements(extensions.pgp_sym_decrypt(v_enc, v_key)::jsonb -> 'l') e;
  exception when others then
    raise exception 'cost_bom_unreadable' using errcode = '55000';
  end;
  return query select u.m, u.q from unnest(v_m, v_q) as u(m, q);
end;
$fn$;

-- =====================================================================
-- 2절. 0062 평문 줄 → 암호문 · 평문 표 제거 · 진짜 BOM 스위치
-- =====================================================================

alter table cost_secret.bom_versions drop constraint bom_versions_no_payload_yet;
alter table cost_secret.bom_versions drop constraint bom_versions_is_fake_check;

do $do$
begin
  -- 0062 뒤에 저장된 판이 있으면(가짜뿐) 키로 옮긴다. 키가 없으면 여기서 멈춘다 — bom-key-setup.md 1단계(키 만들기)가 먼저다.
  if exists (select 1 from cost_secret.bom_lines) then
    update cost_secret.bom_versions v
       set payload_enc = cost_secret.bom_encrypt((
             select jsonb_agg(jsonb_build_object('material_id', l.material_id, 'kg_per_kg', l.kg_per_kg))
               from cost_secret.bom_lines l where l.version_id = v.version_id))
     where exists (select 1 from cost_secret.bom_lines l where l.version_id = v.version_id);
  end if;
  -- 줄 없는 판(있을 수 없지만)은 무효로 — 아래 check가 «암호문 없는 살아 있는 판»을 받지 않는다.
  update cost_secret.bom_versions set voided_at = now(), voided_by = created_by, void_reason = '0063 — 원료 줄 없는 판'
   where payload_enc is null and voided_at is null;
end;
$do$;

drop table cost_secret.bom_lines;

alter table cost_secret.bom_versions
  add constraint bom_versions_payload_required check (payload_enc is not null or voided_at is not null);

comment on column cost_secret.bom_versions.payload_enc is
  '0063. 원료 목록 + 비율(jsonb, 512바이트 단위로 채움)을 Vault 키 cost_bom_key로 pgp_sym_encrypt(aes256 · 압축 없음). 해독은 cost_secret.bom_lines_of에서만.';

/** 진짜 BOM 받기 스위치 — 한 줄. 대표가 cost_bom_real_allow로만 바꾼다. 기본 꺼짐(회장 결정: 운영에서 암호화를 확인한 뒤). */
create table cost_secret.bom_settings (
  id           boolean primary key default true check (id),
  real_allowed boolean not null default false,
  changed_by   uuid,
  changed_at   timestamptz
);
insert into cost_secret.bom_settings (id) values (true);
alter table cost_secret.bom_settings enable row level security;
revoke all on cost_secret.bom_settings from public, anon, authenticated;

-- =====================================================================
-- 3절. 0062 함수 — 평문 표 대신 해독(문 · 칸 · 오류 코드는 그대로)
-- =====================================================================

create or replace function cost_secret.material_cost(p_product text, p_kind text, p_on date, out total numeric, out missing int)
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
    from (select l.kg_per_kg / (v_yield / 100) as q, cost_secret.unit_price(l.material_id, p_kind, p_on) as up
            from cost_secret.bom_lines_of(v_ver) l) x;
  if missing > 0 then total := null; end if;
end;
$fn$;

/**
 * 0062와 같은 판정(사용 중 원료 + 그 날 쓰는 BOM 판에 든 단종 원료). 해독은 «단가 없는 단종 원료»가 있을 때만 — 사용 중 원료만 보면 되는
 * 날에는 키를 부르지 않는다(속도). 키가 없으면 그때 cost_bom_key_missing.
 */
create or replace function cost_secret.business_complete(p_business text, p_kind text, p_on date) returns boolean
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_gap text[];
begin
  if exists (select 1 from public.cost_materials m
              where m.business_id = p_business and m.active
                and cost_secret.unit_price(m.material_id, p_kind, p_on) is null) then
    return false;
  end if;
  select array_agg(m.material_id) into v_gap from public.cost_materials m
   where m.business_id = p_business and not m.active
     and cost_secret.unit_price(m.material_id, p_kind, p_on) is null;
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

/** 대표: 원료별 분해(원래 값). 읽음 감사(값 없이). */
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
  values ('read', 'cost_bom', v_ver::text, v_biz, auth.uid(), auth_role()::text, null, null, 'BOM 분해 열람(0063)');
  return query
  select l.material_id, m.name, l.kg_per_kg, l.kg_per_kg / (v_yield / 100), u.up, (l.kg_per_kg / (v_yield / 100)) * u.up
    from cost_secret.bom_lines_of(v_ver) l
    join cost_materials m on m.material_id = l.material_id
    cross join lateral (select cost_secret.unit_price(l.material_id, p_kind, v_on) as up) u
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
  values ('read', 'cost_bom', v_ver::text, v_biz, auth.uid(), auth_role()::text, null, null, 'BOM 열람(0063)');
  return query
  select b.version_id, b.valid_from, b.yield_pct, b.is_fake, l.material_id, m.name, l.kg_per_kg
    from cost_secret.bom_versions b
    cross join lateral cost_secret.bom_lines_of(b.version_id) l
    join cost_materials m on m.material_id = l.material_id
   where b.version_id = v_ver
   order by m.name;
end;
$fn$;

/** 대표: 판 목록(제품 · 시작일 · 수율 · 가짜 여부 · 무효) — 비율 없이. 대표 BOM 화면의 이력. */
create or replace function cost_bom_versions(p_business text)
returns table (version_id bigint, product_id text, valid_from date, yield_pct numeric, is_fake boolean, note text,
               created_at timestamptz, voided_at timestamptz, void_reason text)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
begin
  if not cost_secret.bom_reader() or p_business is null or not has_business(p_business) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select b.version_id, b.product_id, b.valid_from, b.yield_pct, b.is_fake, b.note, b.created_at, b.voided_at, b.void_reason
    from cost_secret.bom_versions b join public.cost_products p on p.product_id = b.product_id
   where p.business_id = p_business
   order by p.name, b.valid_from desc, b.version_id desc
   limit 1000;
end;
$fn$;

drop function cost_bom_save(text, date, numeric, jsonb, text);

/**
 * 대표: BOM 판 저장(암호문). p_lines = [{"material_id": "...", "kg_per_kg": 0.25}, …] 1~200줄 · 같은 회사 원료 · 중복 없음.
 * p_is_fake = false(진짜)는 «진짜 BOM 받기» 스위치가 켜져 있을 때만(cost_bom_real_locked). 키가 없으면 cost_bom_key_missing — 판을 만들기 전에 멈춘다.
 * 감사는 값 없이(판 번호 · 원료 수 · 가짜 여부).
 */
create or replace function cost_bom_save(p_product text, p_valid_from date, p_yield_pct numeric, p_lines jsonb, p_note text default '',
                                         p_is_fake boolean default true)
returns bigint
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_biz text;
  v_ver bigint;
  v_n int;
  v_enc bytea;
begin
  if not cost_secret.bom_reader(true) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select p.business_id into v_biz from cost_products p where p.product_id = p_product;
  if v_biz is null or not has_business(v_biz) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_is_fake is null or (not p_is_fake and not (select s.real_allowed from cost_secret.bom_settings s where s.id)) then
    raise exception 'cost_bom_real_locked' using errcode = '42501';
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
  -- 형식을 먼저 본다(숫자가 아닌 kg_per_kg를 ::numeric으로 바꾸다 값이 오류 문장에 실리지 않게 — case로 걸러 둔다).
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e -> 'material_id') is distinct from 'string'
        or jsonb_typeof(e -> 'kg_per_kg') is distinct from 'number'
        or (case when jsonb_typeof(e -> 'kg_per_kg') = 'number' then (e ->> 'kg_per_kg')::numeric end) not between 0.00000001 and 100
        or not exists (select 1 from cost_materials m where m.material_id = e ->> 'material_id' and m.business_id = v_biz)
  ) or (select count(distinct e ->> 'material_id') from jsonb_array_elements(p_lines) e) <> v_n then
    raise exception 'cost_bom_invalid' using errcode = '22023';
  end if;

  v_enc := cost_secret.bom_encrypt(p_lines);  -- 키가 없으면 여기서 멈춘다(판을 무효로 하기 전)

  -- 같은 날 판이 있으면 그것을 무효로 하고 새로 쓴다(이력은 남는다).
  update cost_secret.bom_versions set voided_at = now(), voided_by = auth.uid(), void_reason = '같은 날 새 판으로 교체'
   where product_id = p_product and valid_from = p_valid_from and voided_at is null;

  insert into cost_secret.bom_versions (product_id, valid_from, yield_pct, is_fake, payload_enc, note, created_by)
  values (p_product, p_valid_from, p_yield_pct, p_is_fake, v_enc, left(coalesce(p_note, ''), 300), auth.uid())
  returning version_id into v_ver;

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('create', 'cost_bom', v_ver::text, v_biz, auth.uid(), auth_role()::text, null,
          jsonb_build_object('version_id', v_ver, 'valid_from', p_valid_from, 'lines', v_n, 'fake', p_is_fake),
          case when p_is_fake then 'BOM 판 저장(0063 · 가짜 · 암호문)' else 'BOM 판 저장(0063 · 진짜 · 암호문)' end);
  return v_ver;
end;
$fn$;

/** 대표: «진짜 BOM 받기» 켜기 · 끄기. 감사 한 줄. 키가 없으면 켤 수 없다(cost_bom_key_missing). */
create or replace function cost_bom_real_allow(p_on boolean)
returns boolean
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
begin
  if not is_active() or coalesce(auth_role()::text, '') <> 'Chairman' or p_on is null then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_on then
    perform cost_secret.bom_key();
  end if;
  update cost_secret.bom_settings set real_allowed = p_on, changed_by = auth.uid(), changed_at = now() where id;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'cost_bom', 'settings', null, auth.uid(), auth_role()::text, null, jsonb_build_object('real_allowed', p_on),
          case when p_on then '진짜 BOM 받기 켬(0063)' else '진짜 BOM 받기 끔(0063)' end);
  return p_on;
end;
$fn$;

/** 대표: 키 · 스위치 상태(값 없이) — BOM 화면 머리. key_ready = Vault에 키가 있고 길이가 맞다. */
create or replace function cost_bom_status()
returns table (key_ready boolean, real_allowed boolean, changed_at timestamptz)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_ready boolean := true;
begin
  if not cost_secret.bom_reader() then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  begin
    perform cost_secret.bom_key();
  exception when others then
    v_ready := false;
  end;
  return query select v_ready, s.real_allowed, s.changed_at from cost_secret.bom_settings s where s.id;
end;
$fn$;

revoke all on all functions in schema cost_secret from public, anon, authenticated;
revoke all on function cost_bom_save(text, date, numeric, jsonb, text, boolean) from public, anon;
revoke all on function cost_bom_real_allow(boolean) from public, anon;
revoke all on function cost_bom_status() from public, anon;
revoke all on function cost_bom_versions(text) from public, anon;
grant execute on function cost_bom_save(text, date, numeric, jsonb, text, boolean) to authenticated;
grant execute on function cost_bom_real_allow(boolean) to authenticated;
grant execute on function cost_bom_status() to authenticated;
grant execute on function cost_bom_versions(text) to authenticated;

commit;
