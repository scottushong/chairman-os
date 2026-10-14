-- =====================================================================
-- 0074 staging 검사(원료 출고 · 재고 «바꾸기» · «되돌리기»는 대표 · CFO만) — 쓰지 않는다.
-- 0074가 **적용된 뒤** staging에서 돌린다. 끝은 언제나 raise exception(«0074 STAGING PASS …») — 전부 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/0074_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0074_staging_test.sql"
--   rm -f supabase/.temp/0074_staging_test.sql
-- 기대: ERROR  0074 STAGING PASS a(직원 바꾸기 거부) d(직원 되돌리기 거부) b(대표 바꾸기) c(다른 종류는 그대로) e(대표 되돌리기)
-- 사람: 회장 · rehearsal.staff@example.com(이 시험 안에서만 DY 재무 입력). 기간 2099-10 ~ 2099-11(먼 달).
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_staff uuid;
  v_out   text := '';
  n       int;
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

  -- ── a. 직원: 원료 출고 처음 넣기는 되고, 같은 달 바꾸기는 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  perform public.fin_upload_apply('biz_dy', 'material_issue', '2099-10', '가짜 출고 74.xlsx', repeat('7', 64), '출고', 'high', 0, false,
    '[{"row_no":1,"material":"스테이징 가짜 원료 74","qty_kg":5}]', null, 'none', null, null, 0);
  begin
    perform public.fin_upload_apply('biz_dy', 'material_issue', '2099-10', '가짜 출고 74 고침.xlsx', repeat('8', 64), '출고', 'high', 0, false,
      '[{"row_no":1,"material":"스테이징 가짜 원료 74","qty_kg":6}]', null, 'replace', '시험 바꾸기', null, 0);
    raise exception 'FAIL a: 직원이 원료 출고를 바꿨다';
  exception when others then
    if sqlerrm not like '%fin_replace_restricted%' then raise exception 'FAIL a: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  select count(*) into n from public.fin_uploads where business_id = 'biz_dy' and kind = 'material_issue' and period = '2099-10' and status = 'applied';
  if n <> 1 then raise exception 'FAIL a: 거부 뒤 올리기가 %건(1이어야)', n; end if;
  v_out := v_out || 'a(직원 바꾸기 거부) ';

  -- ── d. 직원: 원료 출고 되돌리기도 거부(되돌린 뒤 다시 넣기 = 바꾸기) ──
  begin
    perform public.fin_upload_revert((select u.upload_id from public.fin_uploads u where u.business_id = 'biz_dy' and u.kind = 'material_issue' and u.period = '2099-10' and u.status = 'applied'), '시험 되돌리기');
    raise exception 'FAIL d: 직원이 원료 출고를 되돌렸다';
  exception when others then
    if sqlerrm not like '%fin_replace_restricted%' then raise exception 'FAIL d: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  select count(*) into n from public.fin_uploads where business_id = 'biz_dy' and kind = 'material_issue' and period = '2099-10' and status = 'applied';
  if n <> 1 then raise exception 'FAIL d: 거부 뒤 올리기가 %건(1이어야)', n; end if;
  v_out := v_out || 'd(직원 되돌리기 거부) ';

  -- ── c. 직원: 다른 종류(카드)의 바꾸기는 그대로 된다 ──
  perform public.fin_upload_apply('biz_dy', 'card', '2099-11', '가짜 카드 74.xlsx', repeat('9', 64), '카드', 'high', 0, false,
    '[{"row_no":1,"used_on":"2099-11-02","merchant":"가짜 가게","amount":1000}]', null, 'none', null, null, 0);
  perform public.fin_upload_apply('biz_dy', 'card', '2099-11', '가짜 카드 74 고침.xlsx', repeat('a', 63) || 'b', '카드', 'high', 0, false,
    '[{"row_no":1,"used_on":"2099-11-02","merchant":"가짜 가게","amount":1200}]', null, 'replace', '시험 바꾸기', null, 0);
  reset role;

  -- ── b. 대표: 원료 출고 바꾸기 된다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.fin_upload_apply('biz_dy', 'material_issue', '2099-10', '가짜 출고 74 대표.xlsx', repeat('c', 64), '출고', 'high', 0, false,
    '[{"row_no":1,"material":"스테이징 가짜 원료 74","qty_kg":6}]', null, 'replace', '대표 바꾸기', null, 0);
  reset role;
  select count(*) into n from public.fin_uploads where business_id = 'biz_dy' and kind = 'material_issue' and period = '2099-10' and status = 'replaced';
  if n <> 1 then raise exception 'FAIL b: 대표 바꾸기 뒤 replaced %건', n; end if;
  v_out := v_out || 'b(대표 바꾸기) ';
  select count(*) into n from public.fin_uploads where business_id = 'biz_dy' and kind = 'card' and period = '2099-11' and status = 'replaced';
  if n <> 1 then raise exception 'FAIL c: 카드 바꾸기가 안 됐다(%)', n; end if;
  v_out := v_out || 'c(다른 종류는 그대로) ';

  -- ── e. 대표: 원료 출고 되돌리기 된다(바꾼 것을 되돌리면 옛 줄이 다시 applied) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.fin_upload_revert((select u.upload_id from public.fin_uploads u where u.business_id = 'biz_dy' and u.kind = 'material_issue' and u.period = '2099-10' and u.status = 'applied'), '대표 되돌리기');
  reset role;
  select count(*) into n from public.fin_uploads where business_id = 'biz_dy' and kind = 'material_issue' and period = '2099-10' and status = 'reverted';
  if n <> 1 then raise exception 'FAIL e: 대표 되돌리기 뒤 reverted %건', n; end if;
  v_out := v_out || 'e(대표 되돌리기)';

  raise exception '0074 STAGING PASS %', v_out;
end
$t$;

rollback;
