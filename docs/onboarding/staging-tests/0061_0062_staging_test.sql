-- =====================================================================
-- 0061 · 0062 staging 검사(원가 엔진 기초 · 비공개 BOM) — 쓰지 않는다. 두 파일이 **적용된 뒤** staging에서 돌린다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0061 0062 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다(가짜 원료 · BOM · 권한 줄 모두).
-- 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(staging에 link된 checkout 루트에서, 상대 경로로):
--   cd ~/projects/chairman-os
--   cp docs/onboarding/staging-tests/0061_0062_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0061_0062_staging_test.sql"
--   rm -f supabase/.temp/0061_0062_staging_test.sql
-- 기대: ERROR  0061 0062 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(…)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 사람(id를 박지 않는다): 회장 · rehearsal.staff@example.com(구매 입력으로 씀) · rehearsal.member@example.com(영업 견적으로 씀).
-- 권한 줄은 트랜잭션 안에서만 준다.
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_buy   uuid;
  v_sales uuid;
  v_mat   text;
  v_mat2  text;
  v_sup   text;
  v_prd   text;
  v_lot   text;
  v_ver   bigint;
  r record;
  n int;
  v_res text := '';
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_buy from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  select u.id into v_sales from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  if v_chair is null or v_buy is null or v_sales is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 직원(%) · 리허설 사원(%)', v_chair, v_buy, v_sales;
  end if;
  insert into public.user_module_access (user_id, module, can_write, can_approve) values
    (v_buy, '/purchasing/biz_dy', true, false), (v_sales, '/sales/biz_dy', true, false)
  on conflict (user_id, module) do update set can_write = true;
  -- 영업 사원에게 구매 줄이 남아 있으면 이 검사의 «영업만»이 깨진다.
  delete from public.user_module_access where user_id = v_sales and module in ('/purchasing/biz_dy', '/costing/biz_dy');

  -- ── (a) 구매: 원료 · 공급처 · 시장가 · LOT(Landed) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_buy, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_buy::text, true);
  set local role authenticated;
  insert into public.cost_materials (business_id, name) values ('biz_dy', '검사원료 가짜 A') returning material_id into v_mat;
  insert into public.cost_materials (business_id, name) values ('biz_dy', '검사원료 가짜 B') returning material_id into v_mat2;
  insert into public.cost_suppliers (business_id, name) values ('biz_dy', '검사 공급처') returning supplier_id into v_sup;
  insert into public.cost_market_prices (business_id, material_id, observed_on, price, source_name)
    values ('biz_dy', v_mat, current_date - 1, 1000, '검사'), ('biz_dy', v_mat2, current_date - 1, 2000, '검사');
  insert into public.cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, freight_krw)
    values ('biz_dy', v_mat, v_sup, current_date - 1, 100, 900, 5000) returning lot_id into v_lot;
  select landed_krw_per_kg into r from public.cost_purchase_lots where lot_id = v_lot;
  if r.landed_krw_per_kg <> 950 then raise exception 'FAIL a: Landed % (기대 950)', r.landed_krw_per_kg; end if;
  begin
    update public.cost_purchase_lots set unit_price = 1 where lot_id = v_lot;
    raise exception 'FAIL a: LOT 단가를 고쳤다';
  exception when insufficient_privilege then null;
  end;
  v_res := v_res || 'a(구매 입력 · Landed 950 · 고치기 거부) ';

  -- ── (b) 영업: 원료 · 시세는 보이고 LOT · 공급처는 0, 요약은 된다, LOT 함수는 거부 ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  set local role authenticated;
  select count(*) into n from public.cost_purchase_lots;
  if n <> 0 then raise exception 'FAIL b: 영업이 LOT %줄을 본다', n; end if;
  select count(*) into n from public.cost_suppliers;
  if n <> 0 then raise exception 'FAIL b: 영업이 공급처 %줄을 본다', n; end if;
  -- 회장 결정(2026-10-09) — 영업은 제품 총액만: 원료 이름 · 시세 · 원료별 요약 0.
  select count(*) into n from public.cost_market_prices;
  if n <> 0 then raise exception 'FAIL b: 영업이 원료 시세 %줄을 본다', n; end if;
  select count(*) into n from public.cost_materials;
  if n <> 0 then raise exception 'FAIL b: 영업이 원료 이름 %줄을 본다', n; end if;
  begin
    perform * from public.cost_sales_purchase_summary('biz_dy');
    raise exception 'FAIL b: 영업이 원료별 구매가 요약을 본다';
  exception when no_data_found then null;
  end;
  begin
    perform * from public.cost_production_lots('biz_dy');
    raise exception 'FAIL b: 영업이 LOT 가격 함수를 부른다';
  exception when no_data_found then null;
  end;
  v_res := v_res || 'b(영업 — 원료 · 시세 · LOT · 공급처 0 · 원료 요약 · LOT 함수 거부) ';

  -- ── (c) 대표: 제품 · 가짜 BOM ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  insert into public.cost_products (business_id, name) values ('biz_dy', '검사 제품 가짜') returning product_id into v_prd;
  v_ver := public.cost_bom_save(v_prd, current_date - 30, 100,
    jsonb_build_array(jsonb_build_object('material_id', v_mat, 'kg_per_kg', 0.6), jsonb_build_object('material_id', v_mat2, 'kg_per_kg', 0.4)), '검사');
  select count(*) into n from public.cost_bom_get(v_prd);
  if n <> 2 then raise exception 'FAIL c: 대표가 BOM %줄', n; end if;
  v_res := v_res || 'c(대표 가짜 BOM 저장 · 읽기) ';

  -- ── (d) 영업: 원가 합계 한 값(10원 반올림 · 주간 고정) · 분해 · BOM 거부 · 비공개 스키마 거부 ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  set local role authenticated;
  -- 영업 화면 한 줄: 총액 · 원가 우위 · 제시가만(원료 칸 없음).
  select count(*) into n from public.cost_sales_view(v_prd);
  if n <> 1 then raise exception 'FAIL d: 영업 화면 한 줄이 아니다(%)', n; end if;
  select * into r from public.cost_product_cost(v_prd, 'market', current_date);
  if r.as_of <> date_trunc('week', current_date)::date then raise exception 'FAIL d: 영업 기준일 % (월요일 고정 아님)', r.as_of; end if;
  if r.as_of > current_date - 1 then
    -- 이번 주 월요일이 시세 · LOT 날짜(어제)보다 앞이면 계산되지 않는 것이 맞다.
    if r.computed then raise exception 'FAIL d: 단가 없는 날 계산됨'; end if;
  end if;
  begin
    perform * from public.cost_product_breakdown(v_prd);
    raise exception 'FAIL d: 영업이 원료별 분해를 본다';
  exception when no_data_found then null;
  end;
  begin
    perform * from public.cost_bom_get(v_prd);
    raise exception 'FAIL d: 영업이 BOM을 읽는다';
  exception when no_data_found then null;
  end;
  begin
    perform * from cost_secret.bom_lines;
    raise exception 'FAIL d: 영업이 비공개 스키마 표를 읽는다';
  exception when insufficient_privilege then null;
  end;
  v_res := v_res || 'd(영업 화면 한 줄 · Market 한 값 · 월요일 고정 · 분해/BOM/비공개 표 거부) ';

  -- ── (e) 구매(원가 줄 없음): 원가 거부 ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_buy, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_buy::text, true);
  set local role authenticated;
  begin
    perform * from public.cost_product_cost(v_prd, 'market');
    raise exception 'FAIL e: 구매가 제품 원가를 본다';
  exception when no_data_found then null;
  end;
  v_res := v_res || 'e(구매 원가 거부) ';

  -- ── (f) anon: 표 · 함수 모두 거부 ──
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform 1 from public.cost_materials;
    raise exception 'FAIL f: anon이 원료 표를 읽는다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.cost_product_cost(v_prd, 'market');
    raise exception 'FAIL f: anon이 원가 함수를 부른다';
  exception when insufficient_privilege then null;
  end;
  v_res := v_res || 'f(anon 거부)';
  reset role;

  raise exception '0061 0062 STAGING PASS %', v_res;
end;
$t$;

rollback;
