-- =====================================================================
-- 0077 staging 검사(판매 실적 · 마진 스위치 문 — sales_deals · sales_margins) — 쓰지 않는다.
-- 0077이 **적용된 뒤** staging에서 돌린다. 끝은 언제나 raise exception(«0077 STAGING PASS …») — 전부 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/0077_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0077_staging_test.sql"
--   rm -f supabase/.temp/0077_staging_test.sql
-- 기대: ERROR  0077 STAGING PASS a(직원 스위치 꺼짐) b(대표 마진 · 칸 모양) c(직원 마진 거부) d(끄면 대표도 꺼짐) e(anon 거부)
-- 사람: 회장 · rehearsal.staff@example.com(이 시험 안에서만 DY 영업 줄). 판매 줄은 만들지 않는다(원가 엔진 준비가 길다 — 계산은 check:cost-engine ⑭).
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_staff uuid;
  v_out   text := '';
  v_res   text;
  biz     text := 'biz_dy';
  n       int;
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
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_staff, '/sales/' || biz, true, false);

  -- ── a. 스위치 기본(대표만): 직원에게 판매 실적 · 마진 둘 다 꺼짐 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  begin
    perform * from public.sales_deals(biz, current_date - 30, current_date);
    raise exception 'FAIL a: 스위치 기본(대표만)인데 직원이 판매 실적을 읽었다';
  exception when others then
    if sqlerrm not like '%feature_off%' then raise exception 'FAIL a: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'a(직원 스위치 꺼짐) ';

  -- ── b. 대표: 마진이 돈다(판매 0줄이어도) · 영업 칸에 원가 · 마진이 없다 · 마진 칸에 월 마감 표시 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select count(*) into n from public.sales_margins(biz, current_date - 30, current_date, 'month', 'product');
  select pg_get_function_result('public.sales_deals(text, date, date)'::regprocedure) into v_res;
  if v_res ~ '(cost|margin|snap_total)' then raise exception 'FAIL b: 영업 칸에 원가 · 마진이 있다(%)', v_res; end if;
  select pg_get_function_result('public.sales_margins(text, date, date, text, text)'::regprocedure) into v_res;
  if v_res not like '%pl_closed boolean%' or v_res not like '%cost_basis text%' then raise exception 'FAIL b: 마진 칸에 월 마감 표시가 없다(%)', v_res; end if;
  perform public.feature_switch_set('sales_margins', biz, true, 'all', '0077 staging 시험');
  reset role;
  v_out := v_out || 'b(대표 마진 · 칸 모양) ';

  -- ── c. 스위치를 이 회사 전원으로 연 뒤에도 영업 직원은 마진 거부(원가 관리 · 대표만) · 실적은 읽힌다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  perform * from public.sales_deals(biz, current_date - 30, current_date);
  begin
    perform * from public.sales_margins(biz, current_date - 30, current_date, 'month', 'product');
    raise exception 'FAIL c: 영업 직원이 마진을 읽었다';
  exception when others then
    if sqlerrm not like '%cost_not_found%' then raise exception 'FAIL c: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'c(직원 마진 거부) ';

  -- ── d. 끄면 대표도 꺼짐 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.feature_switch_set('sales_margins', biz, false, 'all', '0077 staging 시험 끄기');
  begin
    perform * from public.sales_margins(biz, current_date - 30, current_date, 'month', 'product');
    raise exception 'FAIL d: 스위치를 껐는데 대표가 마진을 읽었다';
  exception when others then
    if sqlerrm not like '%feature_off%' then raise exception 'FAIL d: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'd(끄면 대표도 꺼짐) ';

  -- ── e. anon ──
  set local role anon;
  begin
    perform * from public.sales_deals(biz, current_date - 30, current_date);
    raise exception 'FAIL e: anon이 판매 실적을 읽었다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL e: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'e(anon 거부)';

  raise exception '0077 STAGING PASS %', v_out;
end
$t$;

rollback;
