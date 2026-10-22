-- =====================================================================
-- 0091 staging 검사(재무 자동 판단 — 사람이 고친 기록) — 쓰지 않는다.
-- build-staging-dryrun.mjs --tests가 0091과 같은 트랜잭션에서 돌리고 끝에 되돌린다(이 파일만 돌릴 때도 끝은 raise exception).
-- 사람(이 시험 안에서만): 대표(Chairman) · rehearsal.member@example.com(직원 — 그 회사 장부를 쓰지 않으면 거부를 본다).
-- 기대: ERROR  0091 STAGING PASS a(대표 고치기 · 이름 · 전값 · 큐 · 감사) b(덧붙이기만) c(모양 · 직접 쓰기 거부) d(직원 거부 · 0줄) e(스위치 기본 줄 · 끄면 거부) f(anon 0)
-- =====================================================================
do $t$
declare
  v_chair uuid;
  v_m     uuid;
  v_out   text := '';
  v_id    bigint;
  n       int;
  j       jsonb;
  biz     text := 'biz_dy';
  keep_m  boolean;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_m from auth.users u join public.user_profiles p on p.user_id = u.id where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  if v_chair is null then raise exception 'FAIL 준비: 대표가 없다'; end if;

  -- ── a. 대표가 평가금액을 고친다 — 누가 · 전값 · 다시 계산 큐 · 감사 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  v_id := public.fin_auto_fix(biz, 'valuation', '2099-09:wip', '2099-09', 'value', '{"amount": 9000000}'::jsonb, '{"값": 12500000, "출처": "이월"}'::jsonb);
  select prev into j from public.fin_auto_fixes where fix_id = v_id;
  if j is null or (j->>'값')::numeric <> 12500000 then raise exception 'FAIL a: 전값이 없다 %', j; end if;
  select count(*) into n from public.fin_auto_fixes where fix_id = v_id and created_by = v_chair and created_by_name is not null;
  if n <> 1 then raise exception 'FAIL a: 누가 고쳤는지 없다'; end if;
  reset role;
  select count(*) into n from public.fin_recalc_jobs where business_id = biz and status = 'pending' and from_period <= '2099-09';
  if n <> 1 then raise exception 'FAIL a: 다시 계산 큐가 없다'; end if;
  select count(*) into n from public.audit_log where entity_table = 'fin_auto_fixes' and entity_id = v_id::text;
  if n <> 1 then raise exception 'FAIL a: 감사 기록이 없다'; end if;
  v_out := v_out || 'a(대표 고치기 · 이름 · 전값 · 큐 · 감사) ';

  -- ── b. 덧붙이기만 — «자동으로 돌리기»는 새 줄 ──
  set local role authenticated;
  perform public.fin_auto_fix(biz, 'valuation', '2099-09:wip', '2099-09', 'auto', null, null);
  perform public.fin_auto_fix(biz, 'period', '2099-09:x:line', '2099-08', 'month', '{"to": "2099-08"}'::jsonb, null);
  perform public.fin_auto_fix(biz, 'duplicate', '2099-09:x:card', '2099-09', 'restore', null, null);
  select count(*) into n from public.fin_auto_fixes where business_id = biz and item_key = '2099-09:wip';
  if n <> 2 then raise exception 'FAIL b: 덧붙이지 않았다 %', n; end if;
  v_out := v_out || 'b(덧붙이기만 · 귀속월 · 중복) ';

  -- ── c. 모양 · 직접 쓰기 거부 ──
  begin
    perform public.fin_auto_fix(biz, 'valuation', '2099-09:wip', '2099-09', 'month', '{"to": "2099-08"}'::jsonb, null);
    raise exception 'FAIL c: 평가에 달 고치기를 받았다';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.fin_auto_fix(biz, 'valuation', '2099-09:wip', '2099-09', 'value', '{"amount": -5}'::jsonb, null);
    raise exception 'FAIL c: 음수 금액을 받았다';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.fin_auto_fix(biz, 'period', '2099-09:x', '2099-09', 'month', '{"to": "2099-13"}'::jsonb, null);
    raise exception 'FAIL c: 없는 달을 받았다';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.fin_auto_fixes (business_id, rule, item_key, period, action) values (biz, 'duplicate', '2099-09:zz', '2099-09', 'restore');
    raise exception 'FAIL c: 표에 직접 썼다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'c(모양 · 직접 쓰기 거부) ';

  -- ── d. 장부를 쓰지 않는 직원은 고치지 못함 · 장부를 못 읽으면 0줄(staging에 리허설 직원이 있을 때만) ──
  if v_m is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_m::text, true);
    set local role authenticated;
    keep_m := coalesce(public.can_keep_books(biz), false);
    if not keep_m then
      begin
        perform public.fin_auto_fix(biz, 'duplicate', '2099-09:m:card', '2099-09', 'restore', null, null);
        raise exception 'FAIL d: 장부를 쓰지 않는 직원이 고쳤다';
      exception when insufficient_privilege then null;
      end;
    end if;
    if not coalesce(public.can_read_books(biz), false) then
      select count(*) into n from public.fin_auto_fixes;
      if n <> 0 then raise exception 'FAIL d: 장부를 못 읽는 직원이 % 줄을 본다', n; end if;
    end if;
    reset role;
    v_out := v_out || 'd(직원 거부 · 0줄) ';
  else
    v_out := v_out || 'd(리허설 직원 없음 — 건너뜀) ';
  end if;

  -- ── e. 스위치 — 기본 줄 전원 · 끄면 거부(이 트랜잭션 안에서만) ──
  select count(*) into n from public.feature_switches where feature_key = 'finance_auto' and business_id is null and enabled and audience = 'all';
  if n <> 1 then raise exception 'FAIL e: 스위치 기본 줄이 없다'; end if;
  update public.feature_switches set enabled = false where feature_key = 'finance_auto' and business_id is null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  begin
    perform public.fin_auto_fix(biz, 'duplicate', '2099-09:off:card', '2099-09', 'restore', null, null);
    raise exception 'FAIL e: 스위치를 꺼도 고쳐진다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'e(스위치 기본 줄 · 끄면 거부) ';

  -- ── f. anon — 함수 · 표 하나도 못 쓴다 ──
  set local role anon;
  begin
    perform public.fin_auto_fix(biz, 'duplicate', '2099-09:anon', '2099-09', 'restore', null, null);
    raise exception 'FAIL f: anon이 고쳤다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.fin_auto_fixes limit 1;
    raise exception 'FAIL f: anon이 고친 기록을 읽었다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'f(anon 0)';

  raise exception '0091 STAGING PASS %', v_out;
end
$t$;
