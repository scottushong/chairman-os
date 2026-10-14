-- =====================================================================
-- 0081 staging 검사(청사진 뼈대 — 스위치 7개 · 역할 문 · 진짜 소유자 아래 대표 호출) — 쓰지 않는다.
-- 0081이 **적용된 뒤** staging에서 돌린다. 끝은 언제나 raise exception(«0081 STAGING PASS …») — 전부 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/0081_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0081_staging_test.sql"
--   rm -f supabase/.temp/0081_staging_test.sql
-- 기대: ERROR  0081 STAGING PASS a(스위치 7개 대표만) b(스위치 기본 = 직원 feature_off) c(영업 = 원가 · 마진 함수 거부) d(생산 = 남의 오더 · 구매 성과 거부) e(임원 = 구매 성과 월만) f(대표 = 진짜 소유자 아래 호출) g(anon 거부)
-- 사람(이 시험 안에서만 바꾼다): 회장 · rehearsal.member@example.com(영업 → 생산 → 임원 차례로).
-- 자료: 새로 넣지 않는다(없는 오더 id 'PO-20990101-AAAAAA'로 생산 문을 본다). 스위치는 이 시험 안에서만 'all'로 연다.
-- =====================================================================
begin;

do $t$
declare
  v_chair  uuid;
  v_member uuid;
  v_out    text := '';
  v        jsonb;
  biz      text := 'biz_dy';
  n        int;
  k        text;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_member from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  if v_chair is null or v_member is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 사원(%)', v_chair, v_member;
  end if;

  -- ── a. 스위치 7개 — 그룹 기본 줄 · 켜짐 · 대표만 ──
  select count(*) into n from public.feature_switches
   where business_id is null and enabled and audience = 'chairman'
     and feature_key in ('cost_forecast', 'purchase_performance', 'customer_profit', 'margin_bridge', 'competitor_price', 'work_orders', 'product_diagnosis');
  if n <> 7 then raise exception 'FAIL a: 0081 스위치 기본 줄이 7개가 아니다(%)', n; end if;
  v_out := v_out || 'a(스위치 7개 대표만) ';

  -- 사원 = 영업 줄만.
  update public.user_profiles set role = 'Member', status = 'active' where user_id = v_member;
  insert into public.user_business_access (user_id, business_id) values (v_member, biz) on conflict do nothing;
  delete from public.user_module_access where user_id = v_member and module like '/%/' || biz;
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_member, '/sales/' || biz, true, false);

  -- ── b. 스위치 기본(대표만) — 직원은 feature_off ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  begin
    perform * from public.purchase_performance(biz, current_date - 30, current_date, 'month');
    raise exception 'FAIL b: 스위치 기본인데 직원이 구매 성과를 불렀다';
  exception when others then
    if sqlerrm not like '%feature_off%' then raise exception 'FAIL b: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  begin
    perform * from public.customer_profit(biz, current_date - 30, current_date);
    raise exception 'FAIL b: 스위치 기본인데 직원이 고객별 수익성을 불렀다';
  exception when others then
    if sqlerrm not like '%feature_off%' then raise exception 'FAIL b: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'b(스위치 기본 = 직원 feature_off) ';

  -- 이 시험 안에서만 스위치를 연다(롤백).
  update public.feature_switches set audience = 'all'
   where business_id is null
     and feature_key in ('cost_forecast', 'purchase_performance', 'customer_profit', 'margin_bridge', 'competitor_price', 'work_orders', 'product_diagnosis');

  -- ── c. 영업 — Forecast · 구매 성과 · 분해 · 고객 감시 · 경쟁사 가정 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  foreach k in array array['forecast', 'performance', 'bridge', 'watch', 'assumptions'] loop
    begin
      case k
        when 'forecast' then perform * from public.cost_forecast_list(biz);
        when 'performance' then perform * from public.purchase_performance(biz, current_date - 30, current_date, 'month');
        when 'bridge' then perform public.margin_bridge(biz, current_date - 60, current_date - 31, current_date - 30, current_date, null);
        when 'watch' then perform * from public.customer_profit_watch(biz, current_date - 30, current_date);
        when 'assumptions' then perform * from public.competitor_assumption_list(biz);
      end case;
      raise exception 'FAIL c: 영업이 % 를 불렀다', k;
    exception when others then
      if sqlerrm not like '%cost_not_found%' then raise exception 'FAIL c: % 거부 문장이 다르다(%)', k, sqlerrm; end if;
    end;
  end loop;
  -- 영업 고객별 = 본인 판매만 · 원가 칸 비움.
  select count(*) into n from public.customer_profit(biz, current_date - 365, current_date) c
   where c.gm_krw is not null or c.gm_pct is not null or c.cogs_krw is not null;
  if n <> 0 then raise exception 'FAIL c: 영업 고객별 수익성에 원가 · 마진 칸이 있다(%)', n; end if;
  reset role;
  v_out := v_out || 'c(영업 = 원가 · 마진 함수 거부) ';

  -- ── d. 생산 — 남의 오더 · 구매 성과 · 진단 거부 ──
  delete from public.user_module_access where user_id = v_member and module like '/%/' || biz;
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_member, '/production/' || biz, true, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  begin
    perform public.work_order_get('PO-20990101-AAAAAA');
    raise exception 'FAIL d: 생산이 없는 오더를 읽었다';
  exception when others then
    if sqlerrm not like '%cost_not_found%' and sqlerrm not like '%feature_off%' then raise exception 'FAIL d: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  select count(*) into n from public.work_order_mine(biz);
  if n <> 0 then raise exception 'FAIL d: 담당 없는 생산 직원에게 오더가 % 건 보인다', n; end if;
  begin
    perform * from public.purchase_performance(biz, current_date - 30, current_date, 'month');
    raise exception 'FAIL d: 생산이 구매 성과를 불렀다';
  exception when others then
    if sqlerrm not like '%cost_not_found%' then raise exception 'FAIL d: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'd(생산 = 남의 오더 · 구매 성과 거부) ';

  -- ── e. 임원(줄 없음) — 구매 성과 월만 ──
  delete from public.user_module_access where user_id = v_member and module like '/%/' || biz;
  update public.user_profiles set role = 'Executive' where user_id = v_member;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  perform * from public.purchase_performance(biz, current_date - 30, current_date, 'month');
  begin
    perform * from public.purchase_performance(biz, current_date - 30, current_date, 'material');
    raise exception 'FAIL e: 임원이 원료 묶음 구매 성과를 읽었다';
  exception when others then
    if sqlerrm not like '%cost_not_found%' then raise exception 'FAIL e: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  update public.user_profiles set role = 'Member' where user_id = v_member;
  v_out := v_out || 'e(임원 = 구매 성과 월만) ';

  -- ── f. 대표 — 진짜 소유자(BYPASSRLS 아님) 아래 정의자 호출이 오류 없이 돈다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform * from public.purchase_performance(biz, current_date - 90, current_date, 'lot');
  perform * from public.customer_profit(biz, current_date - 90, current_date);
  perform * from public.customer_profit_watch(biz, current_date - 90, current_date);
  v := public.margin_bridge(biz, current_date - 60, current_date - 31, current_date - 30, current_date, null);
  if v is null then raise exception 'FAIL f: 대표 마진 분해가 null'; end if;
  perform * from public.cost_outlook_list(biz);
  perform public.cost_forecast_setting(biz);
  perform * from public.competitor_assumption_list(biz);
  perform * from public.work_order_mine(biz);
  begin
    perform * from public.cost_forecast_list(biz);
  exception when others then
    -- 키가 없는 staging이면 BOM이 든 제품에서 멈춘다 — 그것은 0063 운영 조건(이 시험의 실패가 아니다).
    if sqlerrm not like '%cost_bom_key_missing%' then raise exception 'FAIL f: 대표 Forecast 목록 오류(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'f(대표 = 진짜 소유자 아래 호출) ';

  -- ── g. anon ──
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform * from public.purchase_performance(biz, current_date - 30, current_date, 'month');
    raise exception 'FAIL g: anon이 구매 성과를 불렀다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL g: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  begin
    perform public.product_diagnosis('x');
    raise exception 'FAIL g: anon이 제품 진단을 불렀다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL g: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'g(anon 거부)';

  raise exception '0081 STAGING PASS %', v_out;
end;
$t$;

rollback;
