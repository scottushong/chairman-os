-- =====================================================================
-- 0095 staging 검사(Investment Intelligence 2단계 — 분석 이력 불변 · BUY 가드 · AI 한도) — 쓰지 않는다.
-- build-staging-dryrun.mjs 0095 0095 --tests가 0095와 같은 트랜잭션에서 돌리고 끝에 되돌린다.
-- 기대: ERROR  0095 STAGING PASS a(AI INSERT만) b(UPDATE·DELETE 거부) c(BUY 가드) d(수집 계정 0행) e(AI 한도 하루·월) f(CONFIRMED 규칙) g(시드)
-- =====================================================================
do $t$
declare
  v_chair uuid;
  v_integ uuid := '00000000-0000-0000-0000-0000009501a1';
  v_agent uuid := '00000000-0000-0000-0000-0000009501a2';
  v_out   text := '';
  v_sec   uuid;
  v_rec   uuid;
  n       int;
  ok      boolean;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  if v_chair is null then raise exception 'FAIL 준비: 대표 없음'; end if;
  insert into auth.users (id, email) values (v_integ, 'dryrun95-integ@example.com'), (v_agent, 'dryrun95-agent@example.com');
  insert into public.user_profiles (user_id, role, display_name, max_security_class) values (v_integ, 'Integration', 'sync95', 'Restricted'), (v_agent, 'AIAgent', 'ai95', 'Restricted');
  insert into public.securities (kind, name, ticker, cusip, source) values ('stock', 'DRYRUN95', 'DRY95', 'DRY950001', 'test') returning security_id into v_sec;

  -- ── a. AI 계정 INSERT ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  insert into public.investment_recommendations (security_id, version, status, checks, inputs, calculation_version, created_kind)
    values (v_sec, 1, 'WATCH', '[{"key":"price","pass":false}]'::jsonb, '{}'::jsonb, 'x', 'system') returning rec_id into v_rec;
  insert into public.investment_scores (subject_type, subject_id, factor, score, method, evidence, created_kind) values ('company', v_sec::text, 'moat', 70, 'ai_estimate', 'AI 추정 근거', 'ai');
  v_out := v_out || 'a(AI INSERT만) ';
  -- ── b. UPDATE · DELETE 거부 ──
  ok := false;
  begin
    update public.investment_recommendations set status = 'BUY ZONE' where rec_id = v_rec;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL b: AI가 추천을 고쳤다'; end if;
  ok := false;
  begin
    delete from public.investment_recommendations where rec_id = v_rec;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL b: AI가 추천을 지웠다'; end if;
  v_out := v_out || 'b(UPDATE·DELETE 거부) ';
  -- ── c. BUY 가드 ──
  ok := false;
  begin
    insert into public.investment_recommendations (security_id, version, status, checks, inputs, calculation_version, created_kind)
      values (v_sec, 2, 'BUY ZONE', '[{"key":"price","pass":true}]'::jsonb, '{}'::jsonb, 'x', 'ai');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL c: AI 줄 BUY'; end if;
  ok := false;
  begin
    insert into public.investment_recommendations (security_id, version, status, checks, inputs, calculation_version, created_kind)
      values (v_sec, 2, 'BUY ZONE', '[{"key":"price","pass":false}]'::jsonb, '{}'::jsonb, 'x', 'system');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL c: 조건 실패 BUY'; end if;
  v_out := v_out || 'c(BUY 가드) ';
  reset role;

  -- ── d. 수집 계정 0행 · 쓰기 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_integ, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_integ::text, true);
  set local role authenticated;
  select count(*) into n from public.investment_recommendations;
  if n <> 0 then raise exception 'FAIL d: 수집 계정이 추천 % 줄을 봤다', n; end if;
  select count(*) into n from public.future_markets;
  if n <> 0 then raise exception 'FAIL d: 수집 계정이 산업을 봤다'; end if;
  ok := false;
  begin
    insert into public.investment_recommendations (security_id, version, status, checks, inputs, calculation_version, created_kind)
      values (v_sec, 9, 'WATCH', '[]'::jsonb, '{}'::jsonb, 'x', 'system');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL d: 수집 계정이 추천을 썼다'; end if;
  reset role;
  v_out := v_out || 'd(수집 계정 0행) ';

  -- ── e. AI 한도(시험값 하루 2 · 월 $1) ──
  update public.investment_settings set ai_daily_calls = 2, ai_monthly_usd = 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  perform public.investment_ai_reserve('explain', 0.4);
  perform public.investment_ai_reserve('explain', 0.4);
  ok := false;
  begin
    perform public.investment_ai_reserve('explain', 0.01);
  exception when others then ok := sqlerrm like 'investment_ai_limit_day%';
  end;
  if not ok then raise exception 'FAIL e: 하루 한도'; end if;
  reset role;
  update public.investment_settings set ai_daily_calls = 20;
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  ok := false;
  begin
    perform public.investment_ai_reserve('explain', 0.3);
  exception when others then ok := sqlerrm like 'investment_ai_limit_month%';
  end;
  if not ok then raise exception 'FAIL e: 월 한도(0.4 + 0.4 + 0.3 > 1)'; end if;
  reset role;
  v_out := v_out || 'e(AI 한도 하루·월) ';

  -- ── f. CONFIRMED 규칙 ──
  ok := false;
  begin
    insert into public.investment_theses (security_id, kind, statement, classification, created_kind) values (v_sec, 'company', '출처 없는 확정', 'CONFIRMED', 'human');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL f: 출처 없는 CONFIRMED'; end if;
  v_out := v_out || 'f(CONFIRMED 규칙) ';

  -- ── g. 시드 ──
  select count(*) into n from public.future_markets;
  if n <> 5 then raise exception 'FAIL g: 산업 %', n; end if;
  select count(*) into n from public.market_forecasts where kind <> 'ai_assumption' and source_id is null;
  if n <> 0 then raise exception 'FAIL g: 출처 없는 전망 %', n; end if;
  select count(*) into n from public.investment_scores where subject_type = 'market';
  if n < 25 then raise exception 'FAIL g: 산업 점수 입력 %', n; end if;
  v_out := v_out || 'g(시드)';

  raise exception '0095 STAGING PASS %', v_out;
end
$t$;
