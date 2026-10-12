-- =====================================================================
-- 0078 staging 검사(원가 후보 승인 — cost_fin_candidates · cost_fin_candidate_decide) — 쓰지 않는다.
-- 0078이 **적용된 뒤** staging에서 돌린다. 끝은 언제나 raise exception(«0078 STAGING PASS …») — 전부 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/0078_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0078_staging_test.sql"
--   rm -f supabase/.temp/0078_staging_test.sql
-- 기대: ERROR  0078 STAGING PASS a(직원 스위치 꺼짐) b(대표 후보 · 칸 모양) c(영업 직원 거부) d(이유 필수 · 나중에 · 무시 · 감사) e(끄면 대표도 꺼짐) f(anon 거부)
-- 사람: 회장 · rehearsal.staff@example.com(이 시험 안에서만 DY 원가 관리 쓰기 줄). 후보 줄은 2099-09 가짜 입고 한 줄(이 시험 안에서만).
-- LOT로 넣기는 하지 않는다(원가 엔진 원료 · 공급처 준비가 길다 — 넣기는 check:cost-engine ⑮).
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_staff uuid;
  v_out   text := '';
  v_res   text;
  v_up    uuid;
  v_line  bigint;
  biz     text := 'biz_dy';
  n       int;
  a0      int;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_staff from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  if v_chair is null or v_staff is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 직원(%)', v_chair, v_staff;
  end if;
  update public.user_profiles set role = 'Member', status = 'active' where user_id = v_staff;
  insert into public.user_business_access (user_id, business_id) values (v_staff, biz) on conflict do nothing;
  delete from public.user_module_access where user_id = v_staff and module like '/%/' || biz;
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_staff, '/costing/' || biz, true, false);
  insert into public.fin_uploads (business_id, kind, period, file_name, file_sha256, status, row_count, created_by)
  values (biz, 'purchase_in', '2099-09', '0078 staging 가짜 입고.xlsx', repeat('7', 64), 'applied', 1, v_chair) returning upload_id into v_up;
  insert into public.fin_purchase_in_lines (upload_id, business_id, period, row_no, material, supplier, qty, amount)
  values (v_up, biz, '2099-09', 4, '가짜 원재료', '가짜 공급처', 10, 10000) returning line_id into v_line;

  -- ── a. 스위치 기본(대표만): 원가 관리 직원에게 꺼짐 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  begin
    perform * from public.cost_fin_candidates(biz, false);
    raise exception 'FAIL a: 스위치 기본(대표만)인데 직원이 후보를 읽었다';
  exception when others then
    if sqlerrm not like '%feature_off%' then raise exception 'FAIL a: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'a(직원 스위치 꺼짐) ';

  -- ── b. 대표: 후보에 그 줄 · 칸에 BOM · 투입 없음 → 이 회사 전원으로 연다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select count(*) into n from public.cost_fin_candidates(biz, false) c where c.line_id = v_line and c.kind = 'purchase_lot';
  if n <> 1 then raise exception 'FAIL b: 대표 후보에 가짜 입고 줄이 없다(%)', n; end if;
  select pg_get_function_result('public.cost_fin_candidates(text, boolean)'::regprocedure) into v_res;
  if v_res ~ '(bom|kg_per_kg|ratio|yield)' then raise exception 'FAIL b: 후보 칸에 BOM · 비율이 있다(%)', v_res; end if;
  perform public.feature_switch_set('cost_candidates', biz, true, 'all', '0078 staging 시험');
  reset role;
  v_out := v_out || 'b(대표 후보 · 칸 모양) ';

  -- ── c. 영업 줄만 있는 직원은 거부(원가 관리 쓰기 · 대표만) ──
  update public.user_module_access set module = '/sales/' || biz where user_id = v_staff and module = '/costing/' || biz;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  begin
    perform * from public.cost_fin_candidates(biz, false);
    raise exception 'FAIL c: 영업 직원이 후보를 읽었다';
  exception when others then
    if sqlerrm not like '%cost_not_found%' then raise exception 'FAIL c: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  update public.user_module_access set module = '/costing/' || biz where user_id = v_staff and module = '/sales/' || biz;
  v_out := v_out || 'c(영업 직원 거부) ';

  -- ── d. 원가 관리 직원: 이유 없이 거부 · 나중에 · 무시 · 다시 결정 거부 · 결정마다 감사 ──
  select count(*) into a0 from public.audit_log where entity_table = 'cost_fin_candidate_decisions';
  set local role authenticated;
  begin
    perform public.cost_fin_candidate_decide(biz, 'fin_purchase_in_lines', v_line, 'later', '  ');
    raise exception 'FAIL d: 빈 이유로 결정됐다';
  exception when others then
    if sqlerrm not like '%cost_candidate_reason%' then raise exception 'FAIL d: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  perform public.cost_fin_candidate_decide(biz, 'fin_purchase_in_lines', v_line, 'later', '0078 staging 나중에');
  perform public.cost_fin_candidate_decide(biz, 'fin_purchase_in_lines', v_line, 'ignore', '0078 staging 무시');
  begin
    perform public.cost_fin_candidate_decide(biz, 'fin_purchase_in_lines', v_line, 'later', '다시');
    raise exception 'FAIL d: 무시한 줄을 다시 결정했다';
  exception when others then
    if sqlerrm not like '%cost_candidate_done%' then raise exception 'FAIL d: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  select count(*) into n from public.cost_fin_candidates(biz, false) c where c.line_id = v_line;
  if n <> 0 then raise exception 'FAIL d: 무시한 줄이 후보에 남았다'; end if;
  reset role;
  select count(*) - a0 into n from public.audit_log where entity_table = 'cost_fin_candidate_decisions';
  if n <> 2 then raise exception 'FAIL d: 결정 감사가 두 줄이 아니다(%)', n; end if;
  v_out := v_out || 'd(이유 필수 · 나중에 · 무시 · 감사) ';

  -- ── e. 끄면 대표도 꺼짐 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.feature_switch_set('cost_candidates', biz, false, 'all', '0078 staging 끄기');
  begin
    perform * from public.cost_fin_candidates(biz, false);
    raise exception 'FAIL e: 껐는데 대표가 후보를 읽었다';
  exception when others then
    if sqlerrm not like '%feature_off%' then raise exception 'FAIL e: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'e(끄면 대표도 꺼짐) ';

  -- ── f. anon ──
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform * from public.cost_fin_candidates(biz, false);
    raise exception 'FAIL f: anon이 후보를 읽었다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL f: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'f(anon 거부)';

  raise exception '0078 STAGING PASS %', v_out;
end;
$t$;

rollback;
