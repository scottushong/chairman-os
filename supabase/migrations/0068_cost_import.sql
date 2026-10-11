-- =====================================================================
-- Chairman OS — 0068_cost_import (원가 엔진 엑셀 «넣기만» · 겹침 처리 · 빼기 막기)
-- 작성: 2026-10-11 · 회장 결정(같은 날): 원가 엔진의 모든 자료는 엑셀로도 넣을 수 있다. 넣기만 되고 빼기는 안 된다.
--
-- ■ 무엇을 만드나 ■
--   표     cost_imports — 엑셀 한 번 = 한 줄(대상 · 파일 이름 · sha256 · 줄 수 · 고친 칸 수 · 바꾼 줄). 같은 회사 · 대상 · 해시는 한 번만.
--   함수   cost_import_check(biz, target, sha)   자료 도장(stamp) · 같은 파일을 넣은 적이 있는가. 정의자 — 권한을 먼저 본다.
--          cost_import_apply(biz, target, …)     **security invoker** — 대상 표의 RLS · 도장 트리거 · 이상치 · 잔량 · 감사가 화면 입력과 똑같이 돈다.
--                                                한 트랜잭션: 도장 대조 → 하루 한도 → 바꾸기(무효 또는 마스터 수정) → cost_imports 한 줄 → 새 줄들.
--          cost_import_bom_live(product, from)   대표: 같은 제품 · 시작일의 살아 있는 판 번호(엑셀 BOM이 조용히 판을 갈지 않게).
--          cost_purchase_doc_download_log(doc)    대표만 — 구매 첨부 내려받기 전 감사(action 'export').
--   트리거 cost_imports_after — 감사 한 줄(파일 이름 · 줄 수 · 해시 · 고친 칸 «파일 값 → 고친 값»(BOM은 «고침»만)) +
--          바꾼 줄을 넣은 사람이 다른 사람이면 그 사람에게 알림(값 없이).
--   빼기   구매 첨부 파일(Storage 'purchasing') 읽기를 대표만으로 좁힌다(cost_doc_object_visible 교체). 첨부 목록(이름 · 종류)은 그대로.
--
-- ■ 지키는 것 ■
--   · 지우기 없음 — «엑셀 값으로 바꾸기»는 기존 줄 무효(이유 필수) + 새 줄. 원료 · 공급처는 마스터 수정(0061 grant 칸만). 이력은 남는다.
--   · 영업 0시 기준(0062 known) 그대로 — 무효 · 새 줄은 created_at · voided_at이 지금이라 영업에게는 내일부터 보인다.
--   · 이상치(0061 cost_outlier_check)는 줄마다 그대로 돈다 — 기준은 «어제까지 들어온 줄»이라 오늘 대량으로 넣어도 기준이 흔들리지 않는다.
--   · 감사 줄의 entity_table은 대상 표 이름(cost_materials … cost_bom) — 0061/0065/0067의 audit_log_cost_private가 이미 좁힌다.
--     **이 파일은 audit_log_cost_private를 다시 만들지 않는다**(0067이 그 정책에 판매 · 견적을 더한다 — 순서가 바뀌어도 서로 지우지 않게).
--   · BOM 칸 값은 오류 문장 · 감사 · 알림 어디에도 싣지 않는다. 숫자 모양은 캐스트 전에 정규식으로 본다(«invalid input … "0.123"» 문장 막기).
--   · 정책 · 권한은 늘 to authenticated(0060 교훈).
--
-- 0035 규칙: 0001~0067을 고치지 않는다(함수 하나 cost_doc_object_visible은 create or replace — 0061의 이름 그대로 범위만 좁힘).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 표
-- =====================================================================

create table cost_imports (
  import_id    uuid primary key default gen_random_uuid(),
  business_id  text not null references businesses(business_id),
  target       text not null check (target in ('materials', 'suppliers', 'market_prices', 'purchase_lots', 'overheads', 'production', 'bom')),
  file_name    text not null check (length(btrim(file_name)) between 1 and 120),
  file_sha256  text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_count    int not null check (row_count between 1 and 1000),
  skipped      int not null default 0 check (skipped >= 0),
  edits        jsonb not null default '[]'::jsonb check (jsonb_typeof(edits) = 'array' and jsonb_array_length(edits) <= 5000),
  replaced     jsonb not null default '[]'::jsonb check (jsonb_typeof(replaced) = 'array' and jsonb_array_length(replaced) <= 1000),
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (business_id, target, file_sha256)
);
create index cost_imports_by_user on cost_imports (created_by, target, created_at desc);
comment on table cost_imports is
  '0068. 원가 엔진 엑셀 넣기 한 번 = 한 줄. 같은 회사 · 대상 · 파일 해시는 한 번만. 파일 내용은 없다(저장하지 않는다). cost_import_apply로만 넣는다.';

/** 대상 → 영역(화면 입력 권한과 같다). bom = 대표만. */
create or replace function cost_import_area(p_target text) returns text
language sql immutable set search_path = pg_temp as $fn$
  select case p_target
    when 'materials' then 'purchasing' when 'suppliers' then 'purchasing'
    when 'market_prices' then 'purchasing' when 'purchase_lots' then 'purchasing'
    when 'overheads' then 'costing' when 'production' then 'production'
    when 'bom' then 'chairman' end;
$fn$;

/** 이 사람이 이 회사 이 대상을 엑셀로 넣을 수 있는가 — 화면 입력 권한과 같다. */
create or replace function cost_import_can(p_business text, p_target text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select case cost_import_area(p_target)
    when 'chairman' then is_active() and coalesce(auth_role()::text, '') = 'Chairman' and has_business(p_business)
    when null then false
    else cost_can(cost_import_area(p_target), p_business, true) end;
$fn$;

alter table cost_imports enable row level security;
revoke all on table cost_imports from anon, public;
revoke insert, update, delete, truncate, references, trigger on table cost_imports from authenticated;
grant select, insert on cost_imports to authenticated;
create policy cost_imports_no_system on cost_imports as restrictive for all to authenticated
  using (coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration'));
-- 읽기: 본인 · 대표 · 그 대상 입력 권한자. 넣기: 본인 이름으로 · 그 대상 입력 권한자(cost_import_apply 안에서만 부른다 — 직접 넣어도 자기 해시를 막을 뿐).
create policy cost_imports_read on cost_imports for select to authenticated
  using (created_by = auth.uid() or coalesce(auth_role()::text, '') = 'Chairman' or cost_import_can(business_id, target));
create policy cost_imports_insert on cost_imports for insert to authenticated
  with check (created_by = auth.uid() and cost_import_can(business_id, target));

-- =====================================================================
-- 2절. 도장 · 같은 파일
-- =====================================================================

/**
 * 자료 도장 — 그 회사 그 대상 계획에 쓰이는 표들의 (줄 수 · 마지막 생성 · 마지막 무효/수정) md5. 미리보기와 등록 사이에 누가 바꿨으면 달라진다.
 * 정의자(BOM 판 · 생산이 못 읽는 구매 LOT까지 센다) — 그래서 권한을 먼저 본다. 값은 내지 않는다(md5 한 줄).
 */
create or replace function cost_import_stamp(p_business text, p_target text) returns text
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v text := '';
begin
  if not cost_import_can(p_business, p_target) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_target in ('materials', 'market_prices', 'purchase_lots', 'bom') then
    v := v || (select count(*) || '/' || coalesce(max(updated_at)::text, '') from cost_materials where business_id = p_business);
  end if;
  if p_target in ('suppliers', 'purchase_lots') then
    v := v || '|' || (select count(*) || '/' || coalesce(max(updated_at)::text, '') from cost_suppliers where business_id = p_business);
  end if;
  if p_target = 'market_prices' then
    v := v || '|' || (select count(*) || '/' || coalesce(max(created_at)::text, '') || '/' || coalesce(max(voided_at)::text, '')
                        from cost_market_prices where business_id = p_business);
  end if;
  if p_target in ('purchase_lots', 'production') then
    v := v || '|' || (select count(*) || '/' || coalesce(max(created_at)::text, '') || '/' || coalesce(max(voided_at)::text, '')
                        from cost_purchase_lots where business_id = p_business);
  end if;
  if p_target in ('overheads', 'bom') then
    v := v || '|' || (select count(*) || '/' || coalesce(max(updated_at)::text, '') from cost_products where business_id = p_business);
  end if;
  if p_target = 'overheads' then
    v := v || '|' || (select count(*) || '/' || coalesce(max(created_at)::text, '') || '/' || coalesce(max(voided_at)::text, '')
                        from cost_overheads where business_id = p_business);
  end if;
  if p_target = 'production' then
    v := v || '|' || (select count(*) || '/' || coalesce(max(created_at)::text, '') || '/' || coalesce(max(closed_at)::text, '')
                        from cost_production_orders where business_id = p_business)
           || '|' || (select count(*) || '/' || coalesce(max(created_at)::text, '') || '/' || coalesce(max(voided_at)::text, '')
                        from cost_prod_lots where business_id = p_business)
           || '|' || (select count(*) || '/' || coalesce(max(created_at)::text, '') || '/' || coalesce(max(voided_at)::text, '')
                        from cost_prod_inputs where business_id = p_business)
           || '|' || (select count(*) || '/' || coalesce(max(created_at)::text, '') || '/' || coalesce(max(voided_at)::text, '')
                        from cost_lot_adjustments where business_id = p_business);
  end if;
  if p_target = 'bom' then
    v := v || '|' || (select count(*) || '/' || coalesce(max(b.created_at)::text, '') || '/' || coalesce(max(b.voided_at)::text, '')
                        from cost_secret.bom_versions b join cost_products p on p.product_id = b.product_id
                       where p.business_id = p_business);
  end if;
  return md5(p_target || ':' || v);
end;
$fn$;

/** 미리보기: 도장 + 같은 파일을 이미 넣었는가. */
create or replace function cost_import_check(p_business text, p_target text, p_sha text)
returns table (stamp text, seen boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if p_sha is null or p_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'cost_import_invalid' using errcode = '22023';
  end if;
  return query select cost_import_stamp(p_business, p_target),
                      exists (select 1 from cost_imports i where i.business_id = p_business and i.target = p_target and i.file_sha256 = p_sha);
end;
$fn$;

/** 대표: 같은 제품 · 시작일의 살아 있는 판 번호(없으면 null). cost_bom_save가 같은 날 판을 조용히 갈므로 엑셀 등록은 먼저 이것을 본다. */
create or replace function cost_import_bom_live(p_product text, p_from date) returns bigint
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
begin
  if not is_active() or coalesce(auth_role()::text, '') <> 'Chairman' then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return (select b.version_id from cost_secret.bom_versions b join cost_products p on p.product_id = b.product_id
           where b.product_id = p_product and b.valid_from = p_from and b.voided_at is null and has_business(p.business_id)
           order by b.version_id desc limit 1);
end;
$fn$;

-- =====================================================================
-- 3절. 등록 — security invoker(대상 표의 RLS · 트리거가 문)
-- =====================================================================

/** 숫자 칸: 10진 글자만(캐스트 오류 문장에 값이 실리지 않게). 비면 p_default. */
create or replace function cost_import_num(p_v text, p_default numeric default null) returns numeric
language plpgsql immutable set search_path = pg_temp as $fn$
begin
  if p_v is null or p_v = '' then
    if p_default is null then raise exception 'cost_import_invalid' using errcode = '22023'; end if;
    return p_default;
  end if;
  if p_v !~ '^[0-9]{1,15}(\.[0-9]{1,12})?$' then
    raise exception 'cost_import_invalid' using errcode = '22023';
  end if;
  return p_v::numeric;
end;
$fn$;

create or replace function cost_import_date(p_v text, p_null_ok boolean default false) returns date
language plpgsql immutable set search_path = pg_temp as $fn$
begin
  if p_v is null or p_v = '' then
    if p_null_ok then return null; end if;
    raise exception 'cost_import_invalid' using errcode = '22023';
  end if;
  if p_v !~ '^20[0-9]{2}-[01][0-9]-[0-3][0-9]$' then
    raise exception 'cost_import_invalid' using errcode = '22023';
  end if;
  return p_v::date;
end;
$fn$;

/**
 * 엑셀 등록. p_rows는 서버가 이름을 id로 바꾼 줄(lib/cost-import/payload.ts). 줄마다 replace_id + reason이면 «엑셀 값으로 바꾸기».
 * 실패하면 전부 되돌린다(함수 = 한 트랜잭션). 오류 hint에 'item N'(1부터)을 단다 — 값은 싣지 않는다.
 * 돌려주는 것: {"import_id", "inserted", "replaced"}.
 */
create or replace function cost_import_apply(p_business text, p_target text, p_file_name text, p_sha text, p_stamp text,
                                             p_rows jsonb, p_edits jsonb default '[]'::jsonb, p_skipped int default 0)
returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $fn$
declare
  r jsonb;
  inp jsonb;
  i int := 0;
  n int;
  v_rep text;
  v_reason text;
  v_replaced jsonb := '[]'::jsonb;
  v_import uuid;
  v_prod text;
  v_ver bigint;
  v_cnt int;
  v_table text;
begin
  if not is_active() or not cost_import_can(p_business, p_target) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or p_edits is null or jsonb_typeof(p_edits) <> 'array' then
    raise exception 'cost_import_invalid' using errcode = '22023';
  end if;
  n := jsonb_array_length(p_rows);
  if n < 1 or n > (case when p_target = 'bom' then 200 else 500 end) then
    raise exception 'cost_import_invalid' using errcode = '22023';
  end if;
  -- 같은 사람 · 같은 대상 엑셀은 하루 20번까지(KST) — 대량 넣기를 여러 파일로 쪼개 감사를 흐리지 않게.
  perform pg_advisory_xact_lock(hashtext('cost_import:' || auth.uid()::text || ':' || p_target));
  if (select count(*) from cost_imports where created_by = auth.uid() and target = p_target
        and created_at >= (cost_today()::timestamp at time zone 'Asia/Seoul')) >= 20 then
    raise exception 'cost_import_too_many' using errcode = '22023';
  end if;
  -- 미리보기 뒤 누가 같은 자료를 바꿨으면 거부(회사 · 대상 잠금 뒤에 잰다 — 두 사람이 같은 도장으로 동시에 넣지 못하게).
  perform pg_advisory_xact_lock(hashtext('cost_import:' || p_business || ':' || p_target));
  if p_stamp is null or p_stamp <> cost_import_stamp(p_business, p_target) then
    raise exception 'cost_import_stale' using errcode = '40001';
  end if;

  -- ── 1. 바꾸기(기존 줄) — 새 줄보다 먼저(같은 날 · 같은 출처 유일 인덱스) ──
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_rep := r ->> 'replace_id';
    continue when v_rep is null;
    v_reason := btrim(coalesce(r ->> 'reason', ''));
    if v_reason = '' or length(v_reason) > 300 then
      raise exception 'cost_void_reason' using errcode = '23514', hint = 'item ' || i;
    end if;
    begin
      case p_target
        when 'materials' then
          update cost_materials set category = r ->> 'category', spec = coalesce(r ->> 'spec', ''), note = coalesce(r ->> 'note', '')
           where material_id = v_rep and business_id = p_business;
          v_table := 'cost_materials';
        when 'suppliers' then
          update cost_suppliers set country = coalesce(r ->> 'country', ''), currency_default = r ->> 'currency_default',
                 contact = coalesce(r ->> 'contact', ''), terms = coalesce(r ->> 'terms', ''), note = coalesce(r ->> 'note', '')
           where supplier_id = v_rep and business_id = p_business;
          v_table := 'cost_suppliers';
        when 'market_prices' then
          if v_rep !~ '^[0-9]{1,18}$' then raise exception 'cost_import_invalid' using errcode = '22023'; end if;
          update cost_market_prices set void_reason = v_reason
           where price_id = v_rep::bigint and business_id = p_business and voided_at is null;
          v_table := 'cost_market_prices';
        when 'purchase_lots' then
          update cost_purchase_lots set void_reason = v_reason
           where lot_id = v_rep and business_id = p_business and voided_at is null;
          v_table := 'cost_purchase_lots';
        when 'overheads' then
          if v_rep !~ '^[0-9]{1,18}$' then raise exception 'cost_import_invalid' using errcode = '22023'; end if;
          update cost_overheads set void_reason = v_reason
           where overhead_id = v_rep::bigint and business_id = p_business and voided_at is null;
          v_table := 'cost_overheads';
        when 'bom' then
          if v_rep !~ '^[0-9]{1,18}$' then raise exception 'cost_import_invalid' using errcode = '22023'; end if;
          -- 바꾸는 판이 그 줄의 제품 · 시작일 판이어야 한다(다른 판을 무효로 하는 길 막기).
          if cost_import_bom_live(r ->> 'product_id', cost_import_date(r ->> 'valid_from')) is distinct from v_rep::bigint then
            raise exception 'cost_import_stale' using errcode = '40001';
          end if;
          perform cost_bom_void(v_rep::bigint, v_reason);
          v_table := 'cost_bom';
        else
          raise exception 'cost_import_invalid' using errcode = '22023';
      end case;
      get diagnostics v_cnt = row_count;
      -- 0줄 = 이미 무효 · 다른 회사 · 권한 밖(RLS) — 미리보기 뒤 바뀐 것으로 본다. (bom은 perform이라 row_count가 1이 아니다 — 위에서 판을 확인했다.)
      if p_target <> 'bom' and v_cnt <> 1 then
        raise exception 'cost_import_stale' using errcode = '40001';
      end if;
    exception when others then
      raise exception using message = sqlerrm, errcode = sqlstate, hint = 'item ' || i;
    end;
    v_replaced := v_replaced || jsonb_build_array(jsonb_build_object('t', v_table, 'id', v_rep));
  end loop;

  -- ── 2. 엑셀 한 줄(감사 · 알림은 트리거) ──
  begin
    insert into cost_imports (business_id, target, file_name, file_sha256, row_count, skipped, edits, replaced)
    values (p_business, p_target, left(btrim(coalesce(p_file_name, '')), 120), p_sha, n, greatest(coalesce(p_skipped, 0), 0), p_edits, v_replaced)
    returning import_id into v_import;
  exception when unique_violation then
    raise exception 'cost_import_duplicate' using errcode = '23505';
  end;

  -- ── 3. 새 줄 ──
  i := 0;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      case p_target
        when 'materials' then
          continue when r ? 'replace_id';   -- 마스터는 위에서 고쳤다
          insert into cost_materials (business_id, name, category, spec, note)
          values (p_business, r ->> 'name', coalesce(nullif(r ->> 'category', ''), 'main'), coalesce(r ->> 'spec', ''), coalesce(r ->> 'note', ''));
        when 'suppliers' then
          continue when r ? 'replace_id';
          insert into cost_suppliers (business_id, name, country, currency_default, contact, terms, note)
          values (p_business, r ->> 'name', coalesce(r ->> 'country', ''), coalesce(nullif(r ->> 'currency_default', ''), 'KRW'),
                  coalesce(r ->> 'contact', ''), coalesce(r ->> 'terms', ''), coalesce(r ->> 'note', ''));
        when 'market_prices' then
          insert into cost_market_prices (business_id, material_id, observed_on, price, currency, fx_rate, source_name, source_url, note)
          values (p_business, r ->> 'material_id', cost_import_date(r ->> 'observed_on'), cost_import_num(r ->> 'price'),
                  coalesce(nullif(r ->> 'currency', ''), 'KRW'), nullif(cost_import_num(r ->> 'fx_rate', 0), 0),
                  r ->> 'source_name', nullif(r ->> 'source_url', ''), coalesce(r ->> 'note', ''));
        when 'purchase_lots' then
          insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, ordered_on, supplier_lot_no, qty_kg, unit_price,
                                          currency, fx_rate, freight_krw, duty_krw, other_krw, source, note)
          values (p_business, r ->> 'material_id', r ->> 'supplier_id', cost_import_date(r ->> 'received_on'), cost_import_date(r ->> 'ordered_on', true),
                  coalesce(r ->> 'supplier_lot_no', ''), cost_import_num(r ->> 'qty_kg'), cost_import_num(r ->> 'unit_price'),
                  coalesce(nullif(r ->> 'currency', ''), 'KRW'), nullif(cost_import_num(r ->> 'fx_rate', 0), 0),
                  cost_import_num(r ->> 'freight_krw', 0), cost_import_num(r ->> 'duty_krw', 0), cost_import_num(r ->> 'other_krw', 0),
                  'import', coalesce(r ->> 'note', ''));
        when 'overheads' then
          insert into cost_overheads (business_id, category, basis, amount, product_id, effective_from, note)
          values (p_business, r ->> 'category', r ->> 'basis', cost_import_num(r ->> 'amount'), nullif(r ->> 'product_id', ''),
                  cost_import_date(r ->> 'effective_from'), coalesce(r ->> 'note', ''));
        when 'production' then
          if jsonb_typeof(r -> 'inputs') is distinct from 'array' or jsonb_array_length(r -> 'inputs') not between 1 and 200 then
            raise exception 'cost_import_invalid' using errcode = '22023';
          end if;
          insert into cost_prod_lots (business_id, order_id, produced_on, output_kg, note)
          values (p_business, r ->> 'order_id', cost_import_date(r ->> 'produced_on'), cost_import_num(r ->> 'output_kg'), coalesce(r ->> 'note', ''))
          returning prod_lot_id into v_prod;
          for inp in select * from jsonb_array_elements(r -> 'inputs') loop
            insert into cost_prod_inputs (business_id, prod_lot_id, lot_id, qty_kg)
            values (p_business, v_prod, inp ->> 'lot_id', cost_import_num(inp ->> 'qty_kg'));
          end loop;
        when 'bom' then
          -- 같은 제품 · 시작일 판이 (바꾸기 뒤에도) 살아 있으면 거부 — cost_bom_save가 조용히 갈지 않게(회장 결정: 겹침은 사람이 고른다).
          if cost_import_bom_live(r ->> 'product_id', cost_import_date(r ->> 'valid_from')) is not null then
            raise exception 'cost_import_stale' using errcode = '40001';
          end if;
          if jsonb_typeof(r -> 'lines') is distinct from 'array'
             or exists (select 1 from jsonb_array_elements(r -> 'lines') e
                         where jsonb_typeof(e) <> 'object' or coalesce(e ->> 'kg_per_kg', '') !~ '^[0-9]{1,3}(\.[0-9]{1,8})?$') then
            raise exception 'cost_bom_invalid' using errcode = '22023';
          end if;
          v_ver := cost_bom_save(r ->> 'product_id', cost_import_date(r ->> 'valid_from'), cost_import_num(r ->> 'yield_pct'),
                                 (select jsonb_agg(jsonb_build_object('material_id', e ->> 'material_id', 'kg_per_kg', (e ->> 'kg_per_kg')::numeric))
                                    from jsonb_array_elements(r -> 'lines') e),
                                 left(coalesce(r ->> 'note', ''), 300), coalesce((r ->> 'is_fake')::boolean, true));
        else
          raise exception 'cost_import_invalid' using errcode = '22023';
      end case;
    exception when others then
      raise exception using message = sqlerrm, errcode = sqlstate, hint = 'item ' || i;
    end;
  end loop;

  return jsonb_build_object('import_id', v_import, 'inserted', n - case when p_target in ('materials', 'suppliers') then jsonb_array_length(v_replaced) else 0 end,
                            'replaced', jsonb_array_length(v_replaced));
end;
$fn$;

-- =====================================================================
-- 4절. 감사 · 알림 — cost_imports 줄이 들어갈 때(정의자)
-- =====================================================================

create or replace function cost_imports_after() returns trigger
language plpgsql security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  v_table text := case new.target
    when 'materials' then 'cost_materials' when 'suppliers' then 'cost_suppliers' when 'market_prices' then 'cost_market_prices'
    when 'purchase_lots' then 'cost_purchase_lots' when 'overheads' then 'cost_overheads' when 'production' then 'cost_prod_lots'
    else 'cost_bom' end;
  v_path text := case cost_import_area(new.target)
    when 'purchasing' then '/purchasing/' || new.business_id when 'production' then '/production/' || new.business_id
    else '/costs/' || new.business_id end;
  x jsonb;
  v_owner uuid;
begin
  -- 감사: 파일 이름 · 줄 수 · 해시 · 고친 칸. BOM의 고친 칸은 값 없이(«고침»). 내용(줄 값)은 없다.
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('create', v_table, new.import_id::text, new.business_id, auth.uid(), auth_role()::text, null,
          jsonb_build_object('import_id', new.import_id, 'target', new.target, 'rows', new.row_count, 'skipped', new.skipped,
                             'sha256', new.file_sha256, 'replaced', new.replaced,
                             'edits', case when new.target = 'bom'
                                        then (select coalesce(jsonb_agg(jsonb_build_object('row', e -> 'row', 'field', e -> 'field', 'edit', '고침')), '[]'::jsonb)
                                                from jsonb_array_elements(new.edits) e)
                                        else new.edits end),
          '엑셀 넣기(0068) · 파일 ' || regexp_replace(new.file_name, '[[:cntrl:]]+', ' ', 'g') || ' · ' || new.row_count || '줄'
            || case when jsonb_array_length(new.replaced) > 0 then ' · 바꾼 줄 ' || jsonb_array_length(new.replaced) else '' end
            || case when jsonb_array_length(new.edits) > 0 then ' · 고친 칸 ' || jsonb_array_length(new.edits) else '' end);

  -- 알림: 바꾼 줄을 넣은 사람이 다른 사람이면. 이 트랜잭션에서 이 사람이 실제로 바꾼 줄만(위조 알림 막기 — 무효 처리자 · 시각 = now()).
  for x in select * from jsonb_array_elements(new.replaced) loop
    v_owner := null;
    if x ->> 't' = 'cost_market_prices' and x ->> 'id' ~ '^[0-9]{1,18}$' then
      select created_by into v_owner from cost_market_prices where price_id = (x ->> 'id')::bigint and business_id = new.business_id
         and voided_by = auth.uid() and voided_at = now();
    elsif x ->> 't' = 'cost_purchase_lots' then
      select created_by into v_owner from cost_purchase_lots where lot_id = x ->> 'id' and business_id = new.business_id
         and voided_by = auth.uid() and voided_at = now();
    elsif x ->> 't' = 'cost_overheads' and x ->> 'id' ~ '^[0-9]{1,18}$' then
      select created_by into v_owner from cost_overheads where overhead_id = (x ->> 'id')::bigint and business_id = new.business_id
         and voided_by = auth.uid() and voided_at = now();
    elsif x ->> 't' = 'cost_materials' then
      select created_by into v_owner from cost_materials where material_id = x ->> 'id' and business_id = new.business_id and updated_at = now();
    elsif x ->> 't' = 'cost_suppliers' then
      select created_by into v_owner from cost_suppliers where supplier_id = x ->> 'id' and business_id = new.business_id and updated_at = now();
    end if;
    if v_owner is not null and v_owner <> auth.uid() then
      insert into notifications (user_id, kind, title, body, link)
      values (v_owner, 'system', '넣으신 원가 자료가 엑셀 값으로 바뀌었습니다',
              '다른 사람이 엑셀 넣기에서 «엑셀 값으로 바꾸기»를 골랐습니다. 이전 줄은 무효로 남아 있습니다(이유는 그 줄에).', v_path);
    end if;
  end loop;
  return null;
end;
$fn$;

create trigger cost_imports_after after insert on cost_imports for each row execute function cost_imports_after();

-- =====================================================================
-- 5절. 빼기 막기 — 구매 첨부 파일은 대표만(회장 결정: 원가 엔진 화면 내려받기 0, 대표 예외 · 감사)
-- =====================================================================

create or replace function cost_doc_object_visible(object_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select is_active() and coalesce(auth_role()::text, '') = 'Chairman' and exists (
    select 1 from cost_purchase_docs d
     where d.storage_path = object_name and d.voided_at is null and has_business(d.business_id)
  );
$fn$;

/** 대표: 구매 첨부 내려받기 전 감사 한 줄(action 'export'). 대표 외는 cost_not_found. 실패하면 내려받기도 없다. */
create or replace function cost_purchase_doc_download_log(p_doc uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  v_biz text;
begin
  if not is_active() or coalesce(auth_role()::text, '') <> 'Chairman' then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  select business_id into v_biz from cost_purchase_docs where doc_id = p_doc and voided_at is null;
  if v_biz is null or not has_business(v_biz) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('export', 'cost_purchase_docs', p_doc::text, v_biz, auth.uid(), auth_role()::text, null, jsonb_build_object('id', p_doc),
          '구매 첨부 내려받기(0068 · 대표만)');
end;
$fn$;

-- =====================================================================
-- 6절. 실행 권한 — 늘 authenticated만
-- =====================================================================

revoke all on function cost_import_area(text) from public, anon;
revoke all on function cost_import_can(text, text) from public, anon;
revoke all on function cost_import_stamp(text, text) from public, anon;
revoke all on function cost_import_check(text, text, text) from public, anon;
revoke all on function cost_import_bom_live(text, date) from public, anon;
revoke all on function cost_import_num(text, numeric) from public, anon;
revoke all on function cost_import_date(text, boolean) from public, anon;
revoke all on function cost_import_apply(text, text, text, text, text, jsonb, jsonb, int) from public, anon;
revoke all on function cost_imports_after() from public, anon, authenticated;
revoke all on function cost_purchase_doc_download_log(uuid) from public, anon;
grant execute on function cost_import_area(text) to authenticated;
grant execute on function cost_import_can(text, text) to authenticated;
grant execute on function cost_import_stamp(text, text) to authenticated;
grant execute on function cost_import_check(text, text, text) to authenticated;
grant execute on function cost_import_bom_live(text, date) to authenticated;
grant execute on function cost_import_num(text, numeric) to authenticated;
grant execute on function cost_import_date(text, boolean) to authenticated;
grant execute on function cost_import_apply(text, text, text, text, text, jsonb, jsonb, int) to authenticated;
grant execute on function cost_purchase_doc_download_log(uuid) to authenticated;

commit;
