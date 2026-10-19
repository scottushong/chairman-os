-- =====================================================================
-- 0084 staging 검사(DY 가격 리포트 — 적재 · 읽기 문 · 버튼 판정 · AI Agent만 쓰기 · 범위 검사) — 쓰지 않는다.
-- build-staging-dryrun.mjs --tests가 0084와 같은 트랜잭션에서 돌리고 끝에 되돌린다(이 파일만 돌릴 때도 끝은 raise exception).
-- 사람(이 시험 안에서만 바꾼다): 대표 · rehearsal.member@example.com(구매 입력 → 영업) · AI Agent 계정(있으면).
-- 기대: ERROR  0084 STAGING PASS a(적재 87 · 메모 1) b(대표 읽음) c(구매 입력 버튼 · 잠김 · 자기 실패) d(영업 0행 · 버튼 거부) e(사람 쓰기 거부) f(AI Agent 범위 · 사건 한 번) g(anon 0)
-- =====================================================================
do $t$
declare
  v_chair  uuid;
  v_member uuid;
  v_agent  uuid;
  v_out    text := '';
  v_run    uuid;
  v_ar     uuid;
  n        int;
  biz      text := 'biz_dy';
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_member from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  select p.user_id into v_agent from public.user_profiles p where p.role::text = 'AIAgent' and p.revoked_at is null order by p.created_at limit 1;
  if v_chair is null or v_member is null then raise exception 'FAIL 준비: 대표(%) · 리허설 사원(%)', v_chair, v_member; end if;

  -- ── a. 적재 ──
  select count(*) into n from public.purchase_price_points where business_id = biz;
  if n <> 87 then raise exception 'FAIL a: 가격 % 점(87이어야)', n; end if;
  select count(*) into n from public.purchase_price_events where business_id = biz and kind = 'memo';
  if n <> 1 then raise exception 'FAIL a: 메모 %개', n; end if;
  v_out := v_out || 'a(적재 87 · 메모 1) ';

  -- ── b. 대표 읽음 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select count(*) into n from public.purchase_price_points;
  if n <> 87 then raise exception 'FAIL b: 대표가 % 점을 본다', n; end if;
  reset role;
  v_out := v_out || 'b(대표 읽음) ';

  -- ── c. 구매 입력 = 버튼 · 잠김 · 자기 «대기»만 실패로 ──
  update public.user_profiles set role = 'Member', status = 'active' where user_id = v_member;
  insert into public.user_business_access (user_id, business_id) values (v_member, biz) on conflict do nothing;
  delete from public.user_module_access where user_id = v_member and module like '/%/' || biz;
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_member, '/purchasing/' || biz, true, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select count(*) into n from public.purchase_price_points;
  if n <> 87 then raise exception 'FAIL c: 구매 입력이 % 점을 본다', n; end if;
  -- 이 시험 안에서만 앞 실행 기록을 비켜 둔다(10분 · 잠김 규칙이 staging의 진짜 기록에 걸리지 않게 — 끝에 되돌림).
  reset role;
  update public.purchase_price_runs set created_at = created_at - interval '2 days', status = case when status in ('queued', 'collecting') then 'failed' else status end where business_id = biz;
  set local role authenticated;
  v_run := public.price_report_request(biz, 6);
  begin
    perform public.price_report_request(biz, 6);
    raise exception 'FAIL c: 대기 중인데 또 눌렸다';
  exception when others then
    if sqlerrm not like '%price_report_busy%' then raise exception 'FAIL c: 거부 문장(%)', sqlerrm; end if;
  end;
  if not public.price_report_dispatch_failed(v_run, '시험 — GitHub 호출 실패 흉내') then raise exception 'FAIL c: 자기 대기를 실패로 못 바꿨다'; end if;
  begin
    perform public.price_report_agent_points(biz, '[]'::jsonb);
    raise exception 'FAIL e: 사람이 가격을 넣었다';
  exception when others then
    if sqlerrm not like '%price_report_agent_only%' then raise exception 'FAIL e: 거부 문장(%)', sqlerrm; end if;
  end;
  begin
    insert into public.purchase_price_reports (business_id, report_date, slot, status, html) values (biz, current_date, 'manual', 'ok', repeat('x', 200));
    raise exception 'FAIL e: 사람이 리포트 표에 직접 썼다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'c(구매 입력 버튼 · 잠김 · 자기 실패) ';

  -- ── d. 영업 = 0행 · 버튼 거부 ──
  delete from public.user_module_access where user_id = v_member and module = '/purchasing/' || biz;
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_member, '/sales/' || biz, true, false);
  set local role authenticated;
  select count(*) into n from public.purchase_price_points;
  if n <> 0 then raise exception 'FAIL d: 영업이 % 점을 본다', n; end if;
  begin
    perform public.price_report_request(biz, 6);
    raise exception 'FAIL d: 영업이 버튼을 눌렀다';
  exception when others then
    if sqlerrm not like '%price_report_denied%' then raise exception 'FAIL d: 거부 문장(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'd(영업 0행 · 버튼 거부) e(사람 쓰기 거부) ';

  -- ── f. AI Agent — 범위 검사 · 사건 한 번(계정이 있을 때만) ──
  if v_agent is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_agent::text, true);
    set local role authenticated;
    begin
      perform public.price_report_agent_points(biz, '[{"series":"opinet_naphtha_bbl","date":"2099-01-01","value":884,"kind":"settle"}]'::jsonb);
      raise exception 'FAIL f: 884 원화 값이 들어갔다';
    exception when check_violation then null;
    end;
    v_ar := public.price_report_agent_begin(biz, null, 'AM');
    n := public.price_report_agent_events(biz, v_ar, 'AM', '[{"kind":"event","date":"2099-01-01","title":"시험 사건","url":"https://example.invalid/x"},{"kind":"event","date":"2099-01-01","title":"시험  사건 ","url":"https://EXAMPLE.invalid/x"}]'::jsonb);
    if n <> 1 then raise exception 'FAIL f: 같은 사건이 %번 들어갔다', n; end if;
    perform public.price_report_agent_fail(v_ar, '시험');
    reset role;
    v_out := v_out || 'f(AI Agent 범위 · 사건 한 번) ';
  else
    v_out := v_out || 'f(AI Agent 계정 없음 — 건너뜀) ';
  end if;

  -- ── g. anon ──
  if has_table_privilege('anon', 'public.purchase_price_points', 'select') or has_function_privilege('anon', 'public.price_report_request(text, integer)', 'execute') then
    raise exception 'FAIL g: anon이 표 · 함수를 쓸 수 있다';
  end if;
  v_out := v_out || 'g(anon 0)';

  raise exception '0084 STAGING PASS %', v_out;
end
$t$;
