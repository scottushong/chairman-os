-- =====================================================================
-- 0080 staging 검사(원료 단가 · kg 노출 막기 — 열 grant · fin_material_lines · fin_material_totals · fin_upload_pending · 넣기 지킴) — 쓰지 않는다.
-- 0080이 **적용된 뒤** staging에서 돌린다. 끝은 언제나 raise exception(«0080 STAGING PASS …») — 전부 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/0080_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0080_staging_test.sql"
--   rm -f supabase/.temp/0080_staging_test.sql
-- 기대: ERROR  0080 STAGING PASS a(숫자 칸 직접 읽기 거부) b(올린 사람 방금 = 숫자) c(장부 읽기만 = 가림 · 합계) d(61분 뒤 올린 사람 가림 · 대표 숫자) e(CFO · 원가 관리 숫자) f(대기 가림 · 넣기 거부) g(anon 거부)
-- 사람(이 시험 안에서만 바꾼다): 회장 · rehearsal.staff@example.com(김병훈 자리 — DY '/finance' 쓰기) ·
--   rehearsal.member@example.com(DY '/finance' 읽기 → 쓰기 → 그룹 CFO → 원가 관리 읽기 차례로).
-- 자료: 2099-07 가짜 입고 세 줄(원료 3가지 — 장부 읽기만에게도 합계가 보이는 문턱) · 2099-08 가짜 OFFER 대기 하나(이 시험 안에서만).
-- =====================================================================
begin;

do $t$
declare
  v_chair  uuid;
  v_staff  uuid;
  v_member uuid;
  v_out    text := '';
  v_up     uuid;
  v_pend   uuid;
  v        jsonb;
  biz      text := 'biz_dy';
  n        int;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_staff from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  select u.id into v_member from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  if v_chair is null or v_staff is null or v_member is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 직원(%) · 리허설 사원(%)', v_chair, v_staff, v_member;
  end if;
  update public.user_profiles set role = 'Member', status = 'active' where user_id in (v_staff, v_member);
  insert into public.user_business_access (user_id, business_id) values (v_staff, biz), (v_member, biz) on conflict do nothing;
  delete from public.user_module_access where user_id in (v_staff, v_member) and module like '/%/' || biz;
  insert into public.user_module_access (user_id, module, can_write, can_approve) values
    (v_staff, '/finance/' || biz, true, false), (v_member, '/finance/' || biz, false, false);

  -- ── a. 숫자 칸 직접 읽기 거부(대표도) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  begin
    perform amount from public.fin_purchase_in_lines limit 1;
    raise exception 'FAIL a: 대표가 입고 금액 칸을 직접 읽었다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL a: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  begin
    perform stock_qty from public.fin_inventory_lines limit 1;
    raise exception 'FAIL a: 대표가 재고 수량 칸을 직접 읽었다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL a: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  begin
    perform amount_krw from public.fin_import_lines limit 1;
    raise exception 'FAIL a: 대표가 OFFER 원화 칸을 직접 읽었다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL a: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  perform count(material) from public.fin_purchase_in_lines;
  reset role;
  v_out := v_out || 'a(숫자 칸 직접 읽기 거부) ';

  -- ── b. 리허설 직원(김병훈 자리)이 넣는다 — 방금 올린 본인은 숫자 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  v_up := public.fin_upload_apply(biz, 'purchase_in', '2099-07', '0080 staging 가짜 입고.xlsx', repeat('8', 64), 's', 'high', 0, false,
    '[{"row_no":4,"material":"가짜 원료 가","supplier":"가짜 공급처","qty":1000,"amount":1250000},{"row_no":5,"material":"가짜 원료 나","supplier":"가짜 공급처","qty":500,"amount":900000},{"row_no":6,"material":"가짜 원료 마","supplier":"가짜 공급처","qty":100,"amount":100000}]'::jsonb,
    null, 'none', null, null, 0);
  v := public.fin_material_lines(biz, '2099-07', 'purchase_in');
  if jsonb_array_length(v) <> 3 or exists (select 1 from jsonb_array_elements(v) e where (e ->> 'hidden')::boolean or e -> 'amount' = 'null'::jsonb) then
    raise exception 'FAIL b: 방금 올린 본인에게 숫자가 안 보인다(%)', v;
  end if;
  reset role;
  v_out := v_out || 'b(올린 사람 방금 = 숫자) ';

  -- ── c. 리허설 사원(장부 읽기만) — 줄은 가림 · 합계는 보임 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  v := public.fin_material_lines(biz, '2099-07', 'purchase_in');
  if jsonb_array_length(v) <> 3 or exists (select 1 from jsonb_array_elements(v) e
                                             where not (e ->> 'hidden')::boolean or e -> 'amount' <> 'null'::jsonb or e -> 'qty' <> 'null'::jsonb) then
    raise exception 'FAIL c: 장부 읽기만인 사원에게 숫자가 보인다(%)', v;
  end if;
  v := public.fin_material_totals(biz, '2099-07');
  if (v ->> 'purchase_amount')::numeric is distinct from 2250000 or v ? 'purchase_qty' then
    raise exception 'FAIL c: 합계가 다르다(%)', v;
  end if;
  reset role;
  v_out := v_out || 'c(장부 읽기만 = 가림 · 합계) ';

  -- ── d. 61분 뒤 — 올린 본인도 가림 · 대표는 숫자 ──
  update public.fin_uploads set created_at = now() - interval '61 minutes' where upload_id = v_up;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  v := public.fin_material_lines(biz, '2099-07', 'purchase_in');
  if exists (select 1 from jsonb_array_elements(v) e where not (e ->> 'hidden')::boolean) then
    raise exception 'FAIL d: 61분 뒤에도 올린 본인에게 숫자가 보인다(%)', v;
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  v := public.fin_material_lines(biz, '2099-07', 'purchase_in');
  if exists (select 1 from jsonb_array_elements(v) e where (e ->> 'hidden')::boolean) then
    raise exception 'FAIL d: 대표에게 숫자가 안 보인다(%)', v;
  end if;
  reset role;
  v_out := v_out || 'd(61분 뒤 올린 사람 가림 · 대표 숫자) ';

  -- ── e. 그룹 CFO · 원가 관리 읽기 — 숫자 ──
  update public.user_profiles set role = 'GroupCFO' where user_id = v_member;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  v := public.fin_material_lines(biz, '2099-07', 'purchase_in');
  if exists (select 1 from jsonb_array_elements(v) e where (e ->> 'hidden')::boolean) then
    raise exception 'FAIL e: 그룹 CFO에게 숫자가 안 보인다(%)', v;
  end if;
  reset role;
  update public.user_profiles set role = 'Member' where user_id = v_member;
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_member, '/costing/' || biz, false, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  v := public.fin_material_lines(biz, '2099-07', 'purchase_in');
  if exists (select 1 from jsonb_array_elements(v) e where (e ->> 'hidden')::boolean) then
    raise exception 'FAIL e: 원가 관리에게 숫자가 안 보인다(%)', v;
  end if;
  reset role;
  delete from public.user_module_access where user_id = v_member and module = '/costing/' || biz;
  v_out := v_out || 'e(CFO · 원가 관리 숫자) ';

  -- ── f. 대기 — 직원이 올린 OFFER 대기를 장부 쓰는 사원(원가 관리 아님)이 보면 가림 · 넣기 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  v_pend := public.fin_upload_record(biz, 'import', '2099-08', '0080 staging 가짜 OFFER.xlsx', repeat('9', 64), 's', 'medium', 0, 'needs_review',
    '{"rows":[{"row_no":2,"material":"가짜 원료 다","amount":1000,"amount_krw":1300000}],"grid":[["품목","원화"],["가짜 원료 다",1300000]],"meta":{}}'::jsonb, null);
  reset role;
  update public.user_module_access set can_write = true where user_id = v_member and module = '/finance/' || biz;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  v := public.fin_upload_pending(v_pend);
  if v is null or not coalesce((v ->> 'masked')::boolean, false) or v ? 'grid' or (v -> 'rows' -> 0) ? 'amount_krw' then
    raise exception 'FAIL f: 사원에게 대기 숫자 · 칸 격자가 갔다(%)', v;
  end if;
  begin
    perform public.fin_upload_apply(biz, 'import', '2099-08', null, null, 's', 'medium', 0, false, v -> 'rows', null, 'none', null, v_pend, 0);
    raise exception 'FAIL f: 가려진 대기를 사원이 넣었다';
  exception when others then
    if sqlerrm not like '%fin_material_hidden%' then raise exception 'FAIL f: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'f(대기 가림 · 넣기 거부) ';

  -- ── g. anon ──
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform public.fin_material_lines(biz, '2099-07', 'purchase_in');
    raise exception 'FAIL g: anon이 줄을 읽었다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL g: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  begin
    perform public.fin_material_totals(biz, '2099-07');
    raise exception 'FAIL g: anon이 합계를 읽었다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL g: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'g(anon 거부)';

  raise exception '0080 STAGING PASS %', v_out;
end;
$t$;

rollback;
