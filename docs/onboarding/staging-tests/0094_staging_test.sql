-- =====================================================================
-- 0094 staging 검사(Investment Intelligence 원천 · 권한) — 쓰지 않는다.
-- build-staging-dryrun.mjs 0094 0094 --tests가 0094와 같은 트랜잭션에서 돌리고 끝에 되돌린다(이 파일만 돌릴 때도 끝은 raise exception).
-- 사람(이 시험 안에서만 만들고 되돌림): 수집(Integration) · AI(AIAgent) · 직원(Member) · 지정자(TeamLead + '/investment') + 실제 대표.
-- 기대: ERROR  0094 STAGING PASS a(수집 원천 쓰기) b(수집 기관·설정 거부) c(AI 원천 거부) d(직원 0행·거부) e(지정자 읽기만) f(대표 손 입력) g(delete 없음) h(스위치)
-- =====================================================================
do $t$
declare
  v_chair uuid;
  v_integ uuid := '00000000-0000-0000-0000-0000009401a1';
  v_agent uuid := '00000000-0000-0000-0000-0000009401a2';
  v_mem   uuid := '00000000-0000-0000-0000-0000009401a3';
  v_des   uuid := '00000000-0000-0000-0000-0000009401a4';
  v_out   text := '';
  v_sec   uuid;
  v_dis   uuid;
  n       int;
  ok      boolean;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  if v_chair is null then raise exception 'FAIL 준비: 대표 없음'; end if;
  insert into auth.users (id, email) values (v_integ, 'dryrun94-integ@example.com'), (v_agent, 'dryrun94-agent@example.com'), (v_mem, 'dryrun94-member@example.com'), (v_des, 'dryrun94-des@example.com');
  insert into public.user_profiles (user_id, role, display_name, max_security_class) values
    (v_integ, 'Integration', 'sync94', 'Restricted'), (v_agent, 'AIAgent', 'ai94', 'Restricted'), (v_mem, 'Member', '직원94', 'Normal'), (v_des, 'TeamLead', '지정자94', 'Normal');
  insert into public.user_module_access (user_id, module, can_write) values (v_des, '/investment', false);

  -- ── a. 수집 계정: 원천 insert · update ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_integ, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_integ::text, true);
  set local role authenticated;
  insert into public.securities (kind, name, ticker, cusip, source) values ('stock', 'APPLE INC', 'AAPL', '037833100', 'sec13f') returning security_id into v_sec;
  insert into public.investment_disclosures (manager_id, source_id, source_type, doc_key, data_as_of, source_published_at, source_url, coverage)
    values ('berkshire', 'sec13f:berkshire', 'sec_13f', 'stg94-0001', '2026-06-30', '2026-08-14', 'https://www.sec.gov/x', '13F') returning disclosure_id into v_dis;
  insert into public.investment_positions (disclosure_id, line_no, holding_key, issuer_name, cusip, security_id, shares, value) values (v_dis, 1, '037833100', 'APPLE INC', '037833100', v_sec, 10, 100);
  insert into public.investment_position_changes (manager_id, source_id, to_disclosure, holding_key, issuer_name, status, basis, calculation_version) values ('berkshire', 'sec13f:berkshire', v_dis, '037833100', 'APPLE INC', 'NEW', 'shares', 'chg-1.0');
  insert into public.security_prices (security_id, d, close, source) values (v_sec, '2026-06-30', 10, 'sec13f_implied');
  update public.investment_sources set status = 'LIVE', last_success_at = now() where source_id = 'sec13f:berkshire';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL a: 수집 계정 경로 상태 고치기 %', n; end if;
  insert into public.investment_audit_logs (action, entity) values ('collect.run', 'investment_collect_runs');
  reset role;
  if (select actor from public.investment_audit_logs order by log_id desc limit 1) <> v_integ then raise exception 'FAIL a: 감사 도장'; end if;
  v_out := v_out || 'a(수집 원천 쓰기) ';

  -- ── b. 수집 계정: 기관 · 설정 못 고침 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_integ, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_integ::text, true);
  set local role authenticated;
  update public.investment_settings set collect_daily_limit = 5000;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL b: 수집 계정이 설정을 고쳤다'; end if;
  update public.investment_managers set signal_weight = 1 where manager_id = 'nbim';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL b: 수집 계정이 기관을 고쳤다'; end if;
  reset role;
  v_out := v_out || 'b(수집 기관·설정 거부) ';

  -- ── c. AI 계정: 원천 읽기만 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  select count(*) into n from public.investment_positions where disclosure_id = v_dis;
  if n <> 1 then raise exception 'FAIL c: AI 계정이 원천을 못 읽음'; end if;
  ok := false;
  begin
    insert into public.securities (kind, name, source) values ('stock', 'X', 'ai');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL c: AI 계정이 원천을 썼다'; end if;
  update public.investment_position_changes set status = 'ADD' where to_disclosure = v_dis;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL c: AI 계정이 판정을 고쳤다'; end if;
  reset role;
  v_out := v_out || 'c(AI 원천 거부) ';

  -- ── d. 직원: 0행 · 쓰기 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_mem, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_mem::text, true);
  set local role authenticated;
  select (select count(*) from public.securities) + (select count(*) from public.investment_positions) + (select count(*) from public.investment_disclosures)
       + (select count(*) from public.investment_sources) + (select count(*) from public.investment_settings) + (select count(*) from public.investment_managers) into n;
  if n <> 0 then raise exception 'FAIL d: 직원이 % 행을 봤다', n; end if;
  ok := false;
  begin
    insert into public.securities (kind, name, source) values ('stock', 'X', 'x');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL d: 직원이 썼다'; end if;
  reset role;
  v_out := v_out || 'd(직원 0행·거부) ';

  -- ── e. 지정자: 읽기만 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_des, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_des::text, true);
  set local role authenticated;
  select count(*) into n from public.investment_positions where disclosure_id = v_dis;
  if n <> 1 then raise exception 'FAIL e: 지정자가 못 읽음'; end if;
  ok := false;
  begin
    insert into public.securities (kind, name, source) values ('stock', 'X', 'x');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL e: 지정자가 썼다'; end if;
  reset role;
  v_out := v_out || 'e(지정자 읽기만) ';

  -- ── f. 대표: 손 입력 · 설정 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  insert into public.security_corporate_actions (security_id, ex_date, kind, ratio, source, source_url) values (v_sec, '2026-07-01', 'split', 4, 'manual', 'https://x');
  update public.investment_settings set data_quality_min = 75;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL f: 대표 설정'; end if;
  -- ── g. delete 없음(대표도) ──
  ok := false;
  begin
    delete from public.investment_positions where disclosure_id = v_dis;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL g: 대표가 보유 줄을 지웠다'; end if;
  reset role;
  v_out := v_out || 'f(대표 손 입력) g(delete 없음) ';

  -- ── h. 스위치 기본 줄 ──
  if (select audience from public.feature_switches where feature_key = 'investment' and business_id is null) <> 'chairman' then raise exception 'FAIL h: 스위치'; end if;
  v_out := v_out || 'h(스위치)';

  raise exception '0094 STAGING PASS %', v_out;
end
$t$;
