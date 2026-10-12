-- =====================================================================
-- 0076 staging 검사(첫 달 기초 «확인» · 기초 «일부 미입력» · 시드 정의자 거름) — 쓰지 않는다.
-- 0076이 **적용된 뒤** staging에서 돌린다. 끝은 언제나 raise exception(«0076 STAGING PASS …») — 전부 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/0076_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0076_staging_test.sql"
--   rm -f supabase/.temp/0076_staging_test.sql
-- 기대: ERROR  0076 STAGING PASS a(입력자 확인 거부) b(다른 사람 확인) c(두 번째 확인 false) d(미입력 확인 거부) e(일부 미입력) f(정의자 거름) g(anon 거부)
-- 사람: 회장 · rehearsal.staff@example.com(이 시험 안에서만 DY 재무 입력). 기간 2099-07 ~ 2099-08(먼 달).
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_staff uuid;
  v_out   text := '';
  v_id    uuid;
  v_ok    boolean;
  r       record;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_staff from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  if v_chair is null or v_staff is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 직원(%)', v_chair, v_staff;
  end if;
  update public.user_profiles set role = 'Member', status = 'active' where user_id = v_staff;
  insert into public.user_business_access (user_id, business_id) values (v_staff, 'biz_dy') on conflict do nothing;
  delete from public.user_module_access where user_id = v_staff and module = '/finance/biz_dy';
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_staff, '/finance/biz_dy', true, false);

  -- ── a. 직원: 첫 달 기초(완제품) 입력 → 본인 확인은 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  v_id := public.fin_opening_save('biz_dy', '2099-08', 'finished', 1000, 'value', 'manual', null, '스테이징 첫 달 실사표');
  perform public.fin_opening_save('biz_dy', '2099-08', 'wip', null, 'missing', 'manual', null, '스테이징 아직 모름');
  begin
    perform public.fin_opening_confirm(v_id, null);
    raise exception 'FAIL a: 입력한 사람이 확인했다';
  exception when others then
    if sqlerrm not like '%fin_opening_self_confirm%' then raise exception 'FAIL a: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'a(입력자 확인 거부) ';

  -- ── b · c · d. 대표: 확인 → 연결 표에 확인됨 · 두 번째는 false · 미입력 줄은 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  v_ok := public.fin_opening_confirm(v_id, null);
  if v_ok is distinct from true then raise exception 'FAIL b: 다른 사람이 확인하지 못했다(%)', v_ok; end if;
  select * into r from public.fin_inventory_roll('biz_dy', '2099-08') x where x.category = 'finished';
  if r.opening_id is distinct from v_id or r.opening_confirmed is distinct from true or r.opening_source <> 'manual' then
    raise exception 'FAIL b: 연결 표가 다르다(% % %)', r.opening_id, r.opening_confirmed, r.opening_source;
  end if;
  v_out := v_out || 'b(다른 사람 확인) ';
  if public.fin_opening_confirm(v_id, null) is distinct from false then raise exception 'FAIL c: 두 번째 확인이 false가 아니다'; end if;
  v_out := v_out || 'c(두 번째 확인 false) ';
  begin
    perform public.fin_opening_confirm((select o.opening_id from public.fin_inventory_openings o
      where o.business_id = 'biz_dy' and o.period = '2099-08' and o.category = 'wip' and o.voided_at is null), null);
    raise exception 'FAIL d: 미입력 기초를 확인했다';
  exception when others then
    if sqlerrm not like '%fin_opening_missing%' then raise exception 'FAIL d: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  v_out := v_out || 'd(미입력 확인 거부) ';

  -- ── e. 앞 달(2099-07) 재고금액명세서에 빈칸 줄 하나 → 2099-08 원재료 기초 = «일부 미입력»(아는 줄의 합) ──
  perform public.fin_upload_apply('biz_dy', 'inventory', '2099-07', '가짜 재고 76.xlsx', repeat('6', 64), '재고금액명세서', 'high', 0, false,
    '[{"row_no":1,"item":"스테이징 가짜 원재료 76 가","stock_qty":10,"amount":700,"amount_state":"value"},{"row_no":2,"item":"스테이징 가짜 원재료 76 나","stock_qty":null,"amount":null,"amount_state":"missing"}]',
    null, 'none', null, null, 0);
  select * into r from public.fin_inventory_roll('biz_dy', '2099-08') x where x.category = 'raw';
  if r.opening_state is distinct from 'partial' or r.prev_missing_lines <> 1 or r.opening_amount is distinct from 700 or r.opening_source <> 'prev_close' then
    raise exception 'FAIL e: 일부 미입력이 아니다(% % % %)', r.opening_state, r.prev_missing_lines, r.opening_amount, r.opening_source;
  end if;
  reset role;
  v_out := v_out || 'e(일부 미입력) ';

  -- ── f. cost_purchase_candidates에 예시 거름 ──
  if pg_get_functiondef('public.cost_purchase_candidates(text)'::regprocedure) not like '%not d.is_example%' then
    raise exception 'FAIL f: cost_purchase_candidates에 예시 거름이 없다';
  end if;
  v_out := v_out || 'f(정의자 거름) ';

  -- ── g. anon은 새 함수를 부르지 못한다 ──
  if has_function_privilege('anon', 'public.fin_opening_confirm(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.fin_inventory_roll(text, text)', 'execute') then
    raise exception 'FAIL g: anon이 0076 함수를 부를 수 있다';
  end if;
  v_out := v_out || 'g(anon 거부)';

  raise exception '0076 STAGING PASS %', v_out;
end
$t$;

rollback;
