-- =====================================================================
-- 0061 ~ 0065 staging 검사(원가 엔진 — 구매 · BOM 암호화 · 영업 1원 · 매일 최신 · 생산 · 비용 마스터) — 쓰지 않는다.
-- 다섯 파일이 **적용된 뒤**, 그리고 BOM 암호 키(docs/onboarding/bom-key-setup.md 1절)를 만든 뒤 staging에서 돌린다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0061-0065 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다(가짜 원료 · BOM · 오더 · 비용 · 권한 줄 모두).
-- 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(staging에 link된 checkout 루트에서, 상대 경로로):
--   cd ~/projects/chairman-os-cost-rehearsal
--   cp docs/onboarding/staging-tests/0061_0065_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0061_0065_staging_test.sql"
--   rm -f supabase/.temp/0061_0065_staging_test.sql
-- 기대: ERROR  0061-0065 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(…) g(…)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 사람(id를 박지 않는다): 회장 · rehearsal.staff@example.com(구매 → 생산 → 원가 관리로 차례로 바꿔 씀) · rehearsal.member@example.com(영업).
-- 권한 줄은 트랜잭션 안에서만 준다.
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_staff uuid;
  v_sales uuid;
  v_today date := public.cost_today();
  v_mat   text;
  v_mat2  text;
  v_sup   text;
  v_prd   text;
  v_lot   text;
  v_lot2  text;
  v_ver   bigint;
  v_order text;
  v_pl    text;
  r record;
  n int;
  v_res text := '';
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_staff from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  select u.id into v_sales from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  if v_chair is null or v_staff is null or v_sales is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 직원(%) · 리허설 사원(%)', v_chair, v_staff, v_sales;
  end if;
  delete from public.user_module_access where user_id in (v_staff, v_sales)
     and module in ('/purchasing/biz_dy', '/production/biz_dy', '/sales/biz_dy', '/costing/biz_dy');
  insert into public.user_module_access (user_id, module, can_write, can_approve) values
    (v_staff, '/purchasing/biz_dy', true, false), (v_sales, '/sales/biz_dy', true, false);

  -- ── (a) 구매: 원료 · 공급처 · 시장가 · LOT(Landed — 반올림 없음) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  insert into public.cost_materials (business_id, name) values ('biz_dy', '검사원료 가짜 A') returning material_id into v_mat;
  insert into public.cost_materials (business_id, name) values ('biz_dy', '검사원료 가짜 B') returning material_id into v_mat2;
  insert into public.cost_suppliers (business_id, name) values ('biz_dy', '검사 공급처') returning supplier_id into v_sup;
  insert into public.cost_market_prices (business_id, material_id, observed_on, price, source_name)
    values ('biz_dy', v_mat, v_today - 1, 1000, '검사'), ('biz_dy', v_mat2, v_today - 1, 2000, '검사');
  insert into public.cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, freight_krw)
    values ('biz_dy', v_mat, v_sup, v_today - 1, 300, 900, 1000) returning lot_id into v_lot;
  insert into public.cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price)
    values ('biz_dy', v_mat2, v_sup, v_today - 1, 100, 1800) returning lot_id into v_lot2;
  select landed_krw_per_kg into r from public.cost_purchase_lots where lot_id = v_lot;
  if abs(r.landed_krw_per_kg - 2710::numeric / 3) > 0.000000001 or r.landed_krw_per_kg = round(r.landed_krw_per_kg, 4) then
    raise exception 'FAIL a: Landed % (기대 903.333… — 반올림 없이)', r.landed_krw_per_kg;
  end if;
  begin
    update public.cost_purchase_lots set unit_price = 1 where lot_id = v_lot;
    raise exception 'FAIL a: LOT 단가를 고쳤다';
  exception when insufficient_privilege then null;
  end;
  v_res := v_res || 'a(구매 입력 · Landed 원래 값 · 고치기 거부) ';

  -- ── (b) 영업: 원료 · 시세 · LOT · 공급처 0 ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  set local role authenticated;
  select (select count(*) from public.cost_purchase_lots) + (select count(*) from public.cost_suppliers)
       + (select count(*) from public.cost_market_prices) + (select count(*) from public.cost_materials) into n;
  if n <> 0 then raise exception 'FAIL b: 영업이 원료 · 시세 · LOT · 공급처 %줄을 본다', n; end if;
  begin
    perform * from public.cost_production_lots('biz_dy');
    raise exception 'FAIL b: 영업이 LOT 가격 함수를 부른다';
  exception when no_data_found then null;
  end;
  v_res := v_res || 'b(영업 — 원료 · 시세 · LOT · 공급처 0) ';

  -- ── (c) 대표: 키 준비 · 가짜 BOM 암호문 저장 · 읽기 · 진짜 BOM 잠김 ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select * into r from public.cost_bom_status();
  if not r.key_ready then raise exception 'FAIL c: BOM 암호 키가 없다 — bom-key-setup.md 1절을 먼저'; end if;
  insert into public.cost_products (business_id, name) values ('biz_dy', '검사 제품 가짜') returning product_id into v_prd;
  v_ver := public.cost_bom_save(v_prd, v_today - 30, 100,
    jsonb_build_array(jsonb_build_object('material_id', v_mat, 'kg_per_kg', 0.7), jsonb_build_object('material_id', v_mat2, 'kg_per_kg', 0.3)), '검사');
  select count(*) into n from public.cost_bom_get(v_prd);
  if n <> 2 then raise exception 'FAIL c: 대표가 BOM %줄', n; end if;
  begin
    perform public.cost_bom_save(v_prd, v_today - 29, 100, jsonb_build_array(jsonb_build_object('material_id', v_mat, 'kg_per_kg', 1)), '', false);
    raise exception 'FAIL c: 진짜 BOM 스위치가 꺼져 있는데 진짜 판이 들어간다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  select count(*) into n from cost_secret.bom_versions where version_id = v_ver
     and (position(convert_to(v_mat, 'UTF8') in payload_enc) > 0 or position(convert_to('kg_per_kg', 'UTF8') in payload_enc) > 0);
  if n <> 0 then raise exception 'FAIL c: 암호문에 원료 id가 그대로 있다'; end if;
  if to_regclass('cost_secret.bom_lines') is not null then raise exception 'FAIL c: 평문 BOM 표가 남았다'; end if;
  v_res := v_res || 'c(키 준비 · 암호문 저장 · 읽기 · 진짜 잠김 · 평문 없음) ';

  -- ── (d) 영업: (가) 오늘 0시 기준 · 1원 · 매일 최신 · 제시가 1원 단위 · 분해 · BOM · 비공개 거부 ──
  -- 회장 결정(2026-10-10) (가): 영업은 «오늘 0시(KST)까지 저장된 값», 대표 · 원가 관리는 즉시.
  -- 이 시험이 오늘 넣은 원료 · 시세 · LOT · BOM은 영업에게 «내일 보일 값»이다 → d1에서 NULL을 확인하고,
  -- d2에서 시험 줄만 트랜잭션 안에서 하루 앞으로 돌린(= «내일») 뒤 기대값을 본다. 끝의 raise로 전부 되돌아간다.
  -- 준비 확인: staging biz_dy에 이 시험 밖의 «0시 전에 만든 · 사용 중 · 단가 없는» 원료가 있으면 회사 단위로 영업 값이 비는 것이 앱 규칙이다.
  select count(*) into n from public.cost_materials m
   where m.business_id = 'biz_dy' and m.active and m.material_id not in (v_mat, v_mat2)
     and m.created_at <= cost_secret.sales_cutoff()
     and (cost_secret.unit_price(m.material_id, 'market', v_today) is null or cost_secret.unit_price(m.material_id, 'current', v_today) is null);
  if n <> 0 then
    raise exception 'FAIL d 준비: staging biz_dy에 단가 없는 사용 중 원료 %개(시험 밖) — 앱 규칙상 영업 값이 회사 전체에서 비어 시험이 성립하지 않는다', n;
  end if;
  -- d1 · 영업: 오늘 넣은 값은 아직 안 보인다.
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  set local role authenticated;
  select * into r from public.cost_sales_view(v_prd);
  if r.as_of <> v_today then raise exception 'FAIL d1: 영업 기준일 % (오늘이어야)', r.as_of; end if;
  if r.current_krw_per_kg is not null or r.market_krw_per_kg is not null or r.advantage_krw_per_kg is not null then
    raise exception 'FAIL d1: 영업이 오늘 넣은 값을 바로 본다 — Current % · Market % · 우위 % (기대 NULL · 0시 기준)', r.current_krw_per_kg, r.market_krw_per_kg, r.advantage_krw_per_kg;
  end if;
  -- d1 · 대표: 즉시(원래 값).
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select * into r from public.cost_sales_view(v_prd);
  if r.current_krw_per_kg is null or abs(r.current_krw_per_kg - (0.7 * 2710::numeric / 3 + 0.3 * 1800)) > 0.000001 or r.market_krw_per_kg is distinct from 1300 then
    raise exception 'FAIL d1: 대표 값 Current % · Market % (기대 즉시 1172.333… · 1300)', r.current_krw_per_kg, r.market_krw_per_kg;
  end if;
  -- «내일»: 시험이 넣은 줄만 하루 앞으로(트리거는 만든 시각을 못 바꾸게 막으므로 잠시 끈다 — 소유자 · 이 트랜잭션 안에서만).
  reset role;
  alter table public.cost_materials disable trigger user;
  alter table public.cost_market_prices disable trigger user;
  alter table public.cost_purchase_lots disable trigger user;
  update public.cost_materials set created_at = created_at - interval '1 day' where material_id in (v_mat, v_mat2);
  update public.cost_market_prices set created_at = created_at - interval '1 day' where material_id in (v_mat, v_mat2);
  update public.cost_purchase_lots set created_at = created_at - interval '1 day' where lot_id in (v_lot, v_lot2);
  update cost_secret.bom_versions set created_at = created_at - interval '1 day' where version_id = v_ver;
  alter table public.cost_materials enable trigger user;
  alter table public.cost_market_prices enable trigger user;
  alter table public.cost_purchase_lots enable trigger user;
  -- d2 · 영업(«내일»): 기대값.
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  set local role authenticated;
  select * into r from public.cost_sales_view(v_prd);
  if r.as_of <> v_today then raise exception 'FAIL d2: 영업 기준일 % (오늘이어야 — 매일 최신)', r.as_of; end if;
  -- Current = 0.7 × 903.333… + 0.3 × 1800 = 1172.333… → 1원 1172. Market = 0.7 × 1000 + 0.3 × 2000 = 1300. 우위 = round(127.666…) = 128.
  if r.current_krw_per_kg is distinct from 1172 or r.market_krw_per_kg is distinct from 1300 or r.advantage_krw_per_kg is distinct from 128 then
    raise exception 'FAIL d2: 영업 값 Current % · Market % · 우위 % (기대 1172 · 1300 · 128)', r.current_krw_per_kg, r.market_krw_per_kg, r.advantage_krw_per_kg;
  end if;
  begin
    perform * from public.cost_price_check(v_prd, 1500.5);
    raise exception 'FAIL d: 영업이 소수 제시가를 넣는다';
  exception when invalid_parameter_value then null;
  end;
  select * into r from public.cost_price_check(v_prd, 1500);
  if r.margin_krw_per_kg is distinct from 328 then raise exception 'FAIL d: 마진 % (기대 round(1500 − 1172.333…) = 328 — 1원 총원가로 빼면 328)', r.margin_krw_per_kg; end if;
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
    perform * from cost_secret.bom_versions;
    raise exception 'FAIL d: 영업이 비공개 스키마 표를 읽는다';
  exception when insufficient_privilege then null;
  end;
  v_res := v_res || 'd(오늘 넣은 값 영업 NULL · 대표 즉시 · «내일» 영업 1원 · 제시가 1원 단위 · 분해/BOM/비공개 거부) ';

  -- ── (e) 생산: 대표가 발행 → 생산이 작업지시 수량 · 생산 LOT · 투입 · 잔량 초과 거부 ──
  reset role;
  delete from public.user_module_access where user_id = v_staff and module = '/purchasing/biz_dy';
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_staff, '/production/biz_dy', true, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  v_order := public.cost_production_issue(v_prd, v_today, 200, '검사');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  select count(*) into n from public.cost_production_order_lines where order_id = v_order;
  if n <> 2 then raise exception 'FAIL e: 생산이 작업지시 수량 %줄', n; end if;
  insert into public.cost_prod_lots (business_id, order_id, product_id, produced_on, output_kg) values ('biz_dy', v_order, '', v_today, 195) returning prod_lot_id into v_pl;
  insert into public.cost_prod_inputs (business_id, prod_lot_id, lot_id, material_id, qty_kg) values ('biz_dy', v_pl, v_lot, '', 120);
  begin
    insert into public.cost_prod_inputs (business_id, prod_lot_id, lot_id, material_id, qty_kg) values ('biz_dy', v_pl, v_lot2, '', 101);
    raise exception 'FAIL e: LOT 잔량(100)보다 많이 쓴다';
  exception when check_violation then null;
  end;
  insert into public.cost_prod_inputs (business_id, prod_lot_id, lot_id, material_id, qty_kg) values ('biz_dy', v_pl, v_lot2, '', 80);
  select remaining_kg into r from public.cost_lot_balances('biz_dy') where lot_id = v_lot;
  if r.remaining_kg <> 180 then raise exception 'FAIL e: 잔량 % (기대 180)', r.remaining_kg; end if;
  begin
    perform * from public.cost_prod_actual('biz_dy');
    raise exception 'FAIL e: 생산이 Actual 원가를 본다';
  exception when no_data_found then null;
  end;
  v_res := v_res || 'e(발행 · 작업지시 수량 · 생산 LOT · 투입 · 잔량 초과 거부 · Actual 거부) ';

  -- ── (f) 원가 관리: 비용 · 배부 · 총원가 · Actual 1원 · 투입/작업지시 수량 0 ──
  reset role;
  delete from public.user_module_access where user_id = v_staff and module = '/production/biz_dy';
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_staff, '/costing/biz_dy', true, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  select (select count(*) from public.cost_prod_inputs) + (select count(*) from public.cost_production_order_lines) into n;
  if n <> 0 then raise exception 'FAIL f: 원가 관리가 투입 · 작업지시 수량(= 배합) %줄을 본다', n; end if;
  perform public.cost_alloc_set('biz_dy', 'trailing', 28, null);
  insert into public.cost_overheads (business_id, category, basis, amount, effective_from) values ('biz_dy', 'labor', 'monthly', 365000, v_today - 60);
  insert into public.cost_overheads (business_id, category, basis, amount, effective_from) values ('biz_dy', 'logistics', 'per_kg', 10.4, v_today - 1);
  select * into r from public.cost_costing_list('biz_dy') where product_id = v_prd;
  -- 제조 = 365,000 × 12 ÷ 365 × 28 ÷ (직전 28일 생산 kg — 이 검사의 195kg + staging에 이미 있던 생산)
  if not r.overhead_ready or r.logi_krw_per_kg is distinct from 10 then
    raise exception 'FAIL f: 비용 준비 % · 물류 % (기대 true · 10)', r.overhead_ready, r.logi_krw_per_kg;
  end if;
  if abs(r.total_krw_per_kg - (1172.3333333 + r.mfg_krw_per_kg + 10.4)) > 1 then
    raise exception 'FAIL f: 총원가 % · 제조 %', r.total_krw_per_kg, r.mfg_krw_per_kg;
  end if;
  select * into r from public.cost_prod_actual('biz_dy') where prod_lot_id = v_pl;
  -- Actual = (120 × 903.333… + 80 × 1800) ÷ 195 = 252,400 ÷ 195 = 1294.358… → 1294
  if r.actual_krw_per_kg is distinct from 1294 then raise exception 'FAIL f: Actual % (기대 1294)', r.actual_krw_per_kg; end if;
  v_res := v_res || 'f(원가 관리 — 비용 · 배부 · 총원가 · Actual 1원 · 배합 0) ';

  -- ── (g) anon: 표 · 함수 모두 거부 ──
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform 1 from public.cost_overheads;
    raise exception 'FAIL g: anon이 비용 표를 읽는다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.cost_sales_view(v_prd);
    raise exception 'FAIL g: anon이 원가 함수를 부른다';
  exception when insufficient_privilege then null;
  end;
  v_res := v_res || 'g(anon 거부)';
  reset role;

  raise exception '0061-0065 STAGING PASS %', v_res;
end;
$t$;

rollback;
