-- =====================================================================
-- 0068 staging 검사(원가 엔진 엑셀 넣기) — 쓰지 않는다.
-- 0061 ~ 0068이 **적용된 뒤** staging에서 돌린다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0068 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다(가짜 원료 · 시세 · 엑셀 기록 · 권한 줄 모두).
-- 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(staging에 link된 checkout 루트에서, 상대 경로로):
--   cd ~/projects/chairman-os-excel
--   cp docs/onboarding/staging-tests/0068_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0068_staging_test.sql"
--   rm -f supabase/.temp/0068_staging_test.sql
-- 기대: ERROR  0068 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(…)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 사람(id를 박지 않는다): 회장 · rehearsal.staff@example.com(구매 입력) · rehearsal.member@example.com(영업).
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_staff uuid;
  v_sales uuid;
  v_today date := public.cost_today();
  v_stamp text;
  v_res   jsonb;
  v_mat   text;
  v_pid   text;
  v_out   text := '';
  n int;
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

  -- ── a. 구매 입력: 원료 둘 엑셀 넣기 · 감사 한 줄 · 같은 파일 두 번 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  select stamp into v_stamp from public.cost_import_check('biz_dy', 'materials', repeat('a', 64));
  v_res := public.cost_import_apply('biz_dy', 'materials', '스테이징 시험.xlsx', repeat('a', 64), v_stamp,
    '[{"name":"스테이징 엑셀 가짜원료 1","category":"main","spec":"","note":""},{"name":"스테이징 엑셀 가짜원료 2","category":"sub","spec":"","note":""}]'::jsonb);
  if (v_res ->> 'inserted')::int <> 2 then raise exception 'FAIL a: 원료 2줄이 들어가지 않았다(%)', v_res; end if;
  begin
    select stamp into v_stamp from public.cost_import_check('biz_dy', 'materials', repeat('a', 64));
    perform public.cost_import_apply('biz_dy', 'materials', '스테이징 시험.xlsx', repeat('a', 64), v_stamp,
      '[{"name":"스테이징 엑셀 가짜원료 3","category":"main","spec":"","note":""}]'::jsonb);
    raise exception 'FAIL a: 같은 파일이 두 번 들어갔다';
  exception when others then
    if sqlerrm not like '%cost_import_duplicate%' then raise exception 'FAIL a: 같은 파일 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  select count(*) into n from public.audit_log where entity_table = 'cost_materials' and actor_user_id = v_staff and note like '엑셀 넣기(0068)%' and occurred_at > now() - interval '1 minute';
  if n <> 1 then raise exception 'FAIL a: 엑셀 감사 줄이 %개', n; end if;
  v_out := v_out || 'a(원료 2줄 · 감사 1줄 · 같은 파일 거부) ';

  -- ── b. 도장 다르면 거부 ──
  set local role authenticated;
  begin
    perform public.cost_import_apply('biz_dy', 'materials', 'b.xlsx', repeat('b', 64), repeat('0', 32),
      '[{"name":"스테이징 엑셀 가짜원료 4","category":"main","spec":"","note":""}]'::jsonb);
    raise exception 'FAIL b: 도장이 다른데 들어갔다';
  exception when others then
    if sqlerrm not like '%cost_import_stale%' then raise exception 'FAIL b: %', sqlerrm; end if;
  end;
  v_out := v_out || 'b(동시 변경 거부) ';

  -- ── c. 시장가 바꾸기: 이유 없음 거부 · 무효 + 새 줄 ──
  select material_id into v_mat from public.cost_materials where business_id = 'biz_dy' and name = '스테이징 엑셀 가짜원료 1';
  select stamp into v_stamp from public.cost_import_check('biz_dy', 'market_prices', repeat('c', 64));
  perform public.cost_import_apply('biz_dy', 'market_prices', 'c.xlsx', repeat('c', 64), v_stamp,
    jsonb_build_array(jsonb_build_object('material_id', v_mat, 'observed_on', v_today::text, 'price', '1000', 'currency', 'KRW',
      'fx_rate', null, 'source_name', '스테이징 시험', 'source_url', null, 'note', '')));
  select price_id::text into v_pid from public.cost_market_prices where material_id = v_mat and voided_at is null;
  begin
    select stamp into v_stamp from public.cost_import_check('biz_dy', 'market_prices', repeat('d', 64));
    perform public.cost_import_apply('biz_dy', 'market_prices', 'd.xlsx', repeat('d', 64), v_stamp,
      jsonb_build_array(jsonb_build_object('material_id', v_mat, 'observed_on', v_today::text, 'price', '1100', 'currency', 'KRW',
        'fx_rate', null, 'source_name', '스테이징 시험', 'source_url', null, 'note', '', 'replace_id', v_pid, 'reason', ' ')));
    raise exception 'FAIL c: 이유 없는 바꾸기가 됐다';
  exception when others then
    if sqlerrm not like '%cost_void_reason%' then raise exception 'FAIL c: %', sqlerrm; end if;
  end;
  select stamp into v_stamp from public.cost_import_check('biz_dy', 'market_prices', repeat('d', 64));
  perform public.cost_import_apply('biz_dy', 'market_prices', 'd.xlsx', repeat('d', 64), v_stamp,
    jsonb_build_array(jsonb_build_object('material_id', v_mat, 'observed_on', v_today::text, 'price', '1100', 'currency', 'KRW',
      'fx_rate', null, 'source_name', '스테이징 시험', 'source_url', null, 'note', '', 'replace_id', v_pid, 'reason', '스테이징 정정')));
  select count(*) into n from public.cost_market_prices where material_id = v_mat;
  if n <> 2 then raise exception 'FAIL c: 바꾸기 뒤 줄이 %개(무효 + 새 줄 = 2)', n; end if;
  v_out := v_out || 'c(이유 필수 · 무효 + 새 줄) ';

  -- ── d. cost_imports 직접 넣기 · 데이터 없는 감사 줄 거부 ──
  begin
    insert into public.cost_imports (business_id, target, file_name, file_sha256, row_count) values ('biz_dy', 'materials', 'x.xlsx', repeat('e', 64), 1);
    raise exception 'FAIL d: cost_imports에 직접 넣었다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.cost_import_log('biz_dy', 'materials', 'x.xlsx', repeat('f', 64), 3, 0, '[]'::jsonb, '[]'::jsonb);
    raise exception 'FAIL d: 데이터 없이 엑셀 감사 줄을 만들었다';
  exception when others then
    if sqlerrm not like '%cost_import_invalid%' then raise exception 'FAIL d: %', sqlerrm; end if;
  end;
  v_out := v_out || 'd(직접 넣기 · 가짜 감사 거부) ';
  reset role;

  -- ── e. 영업은 엑셀로 원료를 못 넣는다 · 엑셀 기록도 못 본다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sales::text, true);
  set local role authenticated;
  begin
    perform public.cost_import_apply('biz_dy', 'materials', 'e.xlsx', repeat('9', 64), repeat('0', 32),
      '[{"name":"영업 가짜","category":"main","spec":"","note":""}]'::jsonb);
    raise exception 'FAIL e: 영업이 엑셀로 원료를 넣었다';
  exception when others then
    if sqlerrm not like '%cost_not_found%' then raise exception 'FAIL e: %', sqlerrm; end if;
  end;
  select count(*) into n from public.cost_imports;
  if n <> 0 then raise exception 'FAIL e: 영업이 엑셀 기록 %줄을 본다', n; end if;
  reset role;
  v_out := v_out || 'e(영업 거부) ';

  -- ── f. anon ──
  set local role anon;
  begin
    perform public.cost_import_check('biz_dy', 'materials', repeat('a', 64));
    raise exception 'FAIL f: anon이 도장을 읽었다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  v_out := v_out || 'f(anon 거부)';

  raise exception '0068 STAGING PASS %', v_out;
end;
$t$;

rollback;
