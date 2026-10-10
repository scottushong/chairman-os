-- =====================================================================
-- 0066 staging 검사(견적 · «가격 예외» 결재) — 쓰지 않는다.
-- 0061 ~ 0066이 **적용된 뒤**, BOM 암호 키(cost_bom_key)가 있는 staging에서 돌린다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0066 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다(가짜 원료 · BOM · 견적 · 결재 · 권한 줄 모두).
-- 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(staging에 link된 checkout 루트에서, 상대 경로로):
--   cd ~/projects/chairman-os-cost-rehearsal
--   cp docs/onboarding/staging-tests/0066_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0066_staging_test.sql"
--   rm -f supabase/.temp/0066_staging_test.sql
-- 기대: ERROR  0066 STAGING PASS a(…) b(…) c(…) d(…) e(…)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 사람(id를 박지 않는다): 회장 · rehearsal.staff@example.com(구매 → 원가 관리) · rehearsal.member@example.com(영업, 상사 사슬 → 대표).
-- 원료 · 시세 · LOT · BOM은 트랜잭션 안에서 «어제 들어온 것»으로 돌린다 — 영업은 오늘 0시까지 저장된 값만 본다(회장 결정 (가)).
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_staff uuid;
  v_sales uuid;
  v_who   uuid;
  v_last  boolean;
  v_today date := public.cost_today();
  v_mat   text;
  v_mat2  text;
  v_sup   text;
  v_prd   text;
  v_ver   bigint;
  v_total numeric;
  v_q1    text;
  v_q2    text;
  v_q3    text;
  v_q4    text;
  v_dec   text;
  v_out   text;
  v_steps int;
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
  if (select role::text from public.user_profiles where user_id = v_sales) = 'TeamLead' then
    raise exception 'FAIL 준비: 리허설 사원이 팀장이다(subtree 읽기 시험이 흐려진다)';
  end if;
  delete from public.user_module_access where user_id in (v_staff, v_sales)
     and module in ('/purchasing/biz_dy', '/production/biz_dy', '/sales/biz_dy', '/costing/biz_dy');
  insert into public.user_module_access (user_id, module, can_write, can_approve) values
    (v_staff, '/purchasing/biz_dy', true, false), (v_sales, '/sales/biz_dy', true, false);

  -- ── 준비: 구매가 원료 둘 · 시세 · LOT, 대표가 가짜 BOM(70 : 30) → 전부 «어제»로 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  insert into public.cost_materials (business_id, name) values ('biz_dy', '견적검사원료 가짜 A') returning material_id into v_mat;
  insert into public.cost_materials (business_id, name) values ('biz_dy', '견적검사원료 가짜 B') returning material_id into v_mat2;
  insert into public.cost_suppliers (business_id, name) values ('biz_dy', '견적검사 공급처') returning supplier_id into v_sup;
  insert into public.cost_market_prices (business_id, material_id, observed_on, price, source_name)
    values ('biz_dy', v_mat, v_today - 1, 1000, '검사'), ('biz_dy', v_mat2, v_today - 1, 2000, '검사');
  insert into public.cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price)
    values ('biz_dy', v_mat, v_sup, v_today - 1, 300, 1000), ('biz_dy', v_mat2, v_sup, v_today - 1, 100, 2000);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  if not (select key_ready from public.cost_bom_status()) then raise exception 'FAIL 준비: BOM 암호 키가 없다'; end if;
  insert into public.cost_products (business_id, name) values ('biz_dy', '견적검사 제품 가짜') returning product_id into v_prd;
  v_ver := public.cost_bom_save(v_prd, v_today - 30, 100,
    jsonb_build_array(jsonb_build_object('material_id', v_mat, 'kg_per_kg', 0.7), jsonb_build_object('material_id', v_mat2, 'kg_per_kg', 0.3)), '검사');
  reset role;
  alter table public.cost_materials disable trigger user;
  alter table public.cost_market_prices disable trigger user;
  alter table public.cost_purchase_lots disable trigger user;
  update public.cost_materials set created_at = created_at - interval '1 day' where material_id in (v_mat, v_mat2);
  update public.cost_market_prices set created_at = created_at - interval '1 day' where material_id in (v_mat, v_mat2);
  update public.cost_purchase_lots set created_at = created_at - interval '1 day' where material_id in (v_mat, v_mat2);
  update cost_secret.bom_versions set created_at = created_at - interval '1 day' where version_id = v_ver;
  alter table public.cost_materials enable trigger user;
  alter table public.cost_market_prices enable trigger user;
  alter table public.cost_purchase_lots enable trigger user;

  -- ── (a) Green: 영업 견적 → 스냅숏 = 영업 화면 값(0시 기준) → 바로 확정 · 표 쓰기 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  set local role authenticated;
  select total_krw_per_kg into v_total from public.cost_sales_view(v_prd);
  -- 0.7 × 1000 + 0.3 × 2000 = 1300(비용 줄이 없으면 총원가 = 원료비).
  if v_total is null then raise exception 'FAIL a: 영업 총원가가 비었다(«어제»로 돌린 값이 안 보인다)'; end if;
  v_q1 := public.quote_create(v_prd, '검사 고객', '검사 고객사', 500, 2000, 'KRW', v_today + 30);
  select * into r from public.quotes where quote_id = v_q1;
  if r.grade <> 'green' or r.status <> 'draft' or r.cost_basis <> 'midnight' or r.cost_total_krw_per_kg is distinct from v_total
     or r.margin_krw_per_kg is distinct from 2000 - v_total or r.created_by <> v_sales then
    raise exception 'FAIL a: 스냅숏 등급 % · 상태 % · 기준 % · 총원가 % (화면 %) · 마진 %', r.grade, r.status, r.cost_basis, r.cost_total_krw_per_kg, v_total, r.margin_krw_per_kg;
  end if;
  begin
    update public.quotes set cost_total_krw_per_kg = 1 where quote_id = v_q1;
    raise exception 'FAIL a: 영업이 견적 스냅숏을 고쳤다';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.quotes (business_id, root_id, version, customer_name, customer_company, product_id, product_name, kg, price_krw_per_kg,
                               valid_until, cost_as_of, cost_basis, cost_total_krw_per_kg, margin_krw_per_kg, margin_pct, grade, created_by)
    values ('biz_dy', 'x', 1, 'x', 'x', v_prd, 'x', 1, 1, v_today + 1, v_today, 'midnight', 0, 1, 100, 'green', v_sales);
    raise exception 'FAIL a: 영업이 견적 줄을 손으로 넣었다';
  exception when insufficient_privilege then null;
  end;
  perform public.quote_confirm(v_q1);
  if (select status from public.quotes where quote_id = v_q1) <> 'confirmed' then raise exception 'FAIL a: Green이 확정되지 않았다'; end if;
  perform public.quote_download_log(v_q1, 'xlsx');
  v_res := v_res || 'a(Green 스냅숏 = 영업 화면 0시 기준 · 바로 확정 · 표 쓰기 거부 · 내려받기 감사) ';

  -- ── (b) Red: 결재 전 확정 거부 → «가격 예외» 결재(원료 정보 0 · «회장» 0) → 사슬 → 대표 승인 → 확정 ──
  v_q2 := public.quote_create(v_prd, '검사 고객', '검사 고객사', 800, 1350, 'KRW', v_today + 30);
  if (select grade from public.quotes where quote_id = v_q2) <> 'red' then raise exception 'FAIL b: 1,350원이 Red가 아니다'; end if;
  begin
    perform public.quote_confirm(v_q2);
    raise exception 'FAIL b: Red가 결재 없이 확정됐다';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.decisions (decision_id, business_id, title, template_key, form, created_by)
    values ('dec_t66hand', 'biz_dy', '손 가격 예외', 'price_exception',
            jsonb_build_object('quote', v_q2 || ' (1판)', 'product', '견적검사 제품 가짜', 'kg', '800', 'price', '1,350',
                               'currency', 'KRW', 'margin_pct', '30', 'grade', 'Green'), v_sales);
    raise exception 'FAIL b: 손으로 «가격 예외» 결재를 올렸다';
  exception when insufficient_privilege then null;
  end;
  v_dec := public.quote_request_approval(v_q2);
  reset role;
  select * into r from public.decisions where decision_id = v_dec;
  if r.template_key <> 'price_exception' or r.status::text <> 'Open' then raise exception 'FAIL b: 결재 % · %', r.template_key, r.status; end if;
  if (r.form::text || r.title) ~ (v_mat || '|' || v_mat2 || '|견적검사원료|kg_per_kg|' || v_sup)
     or (r.form::text || r.title || coalesce(r.approval_line::text, '')) like '%회장%' then
    raise exception 'FAIL b: 결재에 원료 정보 또는 «회장» — %', r.form;
  end if;
  if exists (select 1 from public.approval_steps where decision_id = v_dec and (approver_name like '%회장%' or why like '%회장%')) then
    raise exception 'FAIL b: 결재 칸에 «회장»';
  end if;
  -- 기안자는 자기 결재를 처리하지 못한다.
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  set local role authenticated;
  begin
    perform public.approval_decide(v_dec, true, null);
    raise exception 'FAIL b: 기안자가 자기 가격 예외를 승인했다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  for i in 1..10 loop
    reset role;
    select approver_user_id, is_chairman into v_who, v_last from public.approval_steps where decision_id = v_dec and status = 'pending';
    exit when v_who is null;
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_who::text, true);
    set local role authenticated;
    v_out := public.approval_decide(v_dec, true, null);
    exit when v_out <> 'next';
    v_who := null;
  end loop;
  reset role;
  if v_out <> 'approved' or v_last is not true then raise exception 'FAIL b: 가격 예외가 % · 마지막 칸 대표 %', v_out, v_last; end if;
  select count(*) into v_steps from public.approval_steps where decision_id = v_dec;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  set local role authenticated;
  perform public.quote_confirm(v_q2);
  if (select status from public.quotes where quote_id = v_q2) <> 'confirmed' then raise exception 'FAIL b: 승인된 Red가 확정되지 않았다'; end if;
  v_res := v_res || format('b(Red 결재 전 확정 거부 · 손 가격 예외 거부 · 결재 원료 0 · «회장» 0 · 사슬 %s칸 → 대표 승인 → 확정) ', v_steps);

  -- ── (c) Red → 반려 → 견적 «반려» → 새 판(2판) ──
  v_q3 := public.quote_create(v_prd, '검사 고객', '검사 고객사', 100, 1310, 'KRW', v_today + 30);
  v_dec := public.quote_request_approval(v_q3);
  reset role;
  select approver_user_id into v_who from public.approval_steps where decision_id = v_dec and status = 'pending';
  perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_who::text, true);
  set local role authenticated;
  perform public.approval_decide(v_dec, false, '0066 검사 — 가격을 올려 다시');
  reset role;
  if (select status from public.quotes where quote_id = v_q3) <> 'rejected' then raise exception 'FAIL c: 반려된 결재의 견적이 «반려»가 아니다'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  set local role authenticated;
  begin
    perform public.quote_confirm(v_q3);
    raise exception 'FAIL c: 반려된 Red가 확정됐다';
  exception when insufficient_privilege then null;
  end;
  v_q4 := public.quote_create(v_prd, '검사 고객', '검사 고객사', 100, 2000, 'KRW', v_today + 30, v_q3);
  select * into r from public.quotes where quote_id = v_q4;
  if r.version <> 2 or r.root_id <> v_q3 or r.parent_id <> v_q3 or r.grade <> 'green' then
    raise exception 'FAIL c: 새 판 % · 뿌리 % · 등급 %', r.version, r.root_id, r.grade;
  end if;
  perform public.quote_confirm(v_q4);
  v_res := v_res || 'c(Red 반려 → 견적 반려 · 확정 거부 · 새 판 2판 확정) ';

  -- ── (d) 다른 사람: 구매 · 원가 관리 견적 0행 · 원가 관리 회계용은 제품 · kg · 제시가만 ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  select count(*) into n from public.quotes;
  if n <> 0 then raise exception 'FAIL d: 구매가 견적 %줄을 본다', n; end if;
  reset role;
  delete from public.user_module_access where user_id = v_staff and module = '/purchasing/biz_dy';
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_staff, '/costing/biz_dy', true, false);
  set local role authenticated;
  select count(*) into n from public.quotes;
  if n <> 0 then raise exception 'FAIL d: 원가 관리가 견적 %줄을 본다', n; end if;
  select count(*) into n from public.quotes_confirmed_for_costing('biz_dy') where quote_id in (v_q1, v_q2, v_q4);
  if n <> 3 then raise exception 'FAIL d: 원가 관리 회계용 확정 견적 %줄 (기대 3)', n; end if;
  begin
    perform * from public.quote_raw(v_q1);
    raise exception 'FAIL d: 원가 관리가 대표 원래 값을 본다';
  exception when no_data_found then null;
  end;
  v_res := v_res || 'd(구매 · 원가 관리 견적 0행 · 회계용 3줄 · 원래 값 거부) ';

  -- ── (e) anon: 표 · 함수 거부 ──
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform 1 from public.quotes;
    raise exception 'FAIL e: anon이 견적 표를 읽는다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.quote_create(v_prd, 'x', 'x', 1, 2000, 'KRW', v_today + 1);
    raise exception 'FAIL e: anon이 견적을 만든다';
  exception when insufficient_privilege then null;
  end;
  v_res := v_res || 'e(anon 거부)';
  reset role;

  raise exception '0066 STAGING PASS %', v_res;
end;
$t$;

rollback;
