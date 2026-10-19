-- =====================================================================
-- 0085 staging 검사(재무 현황 · 저장 한 번 · 큐 · 저장본 · 급여 보류 · 출하집계표 · 지표 기준값) — 쓰지 않는다.
-- build-staging-dryrun.mjs --tests가 0085와 같은 트랜잭션에서 돌리고 끝에 되돌린다(이 파일만 돌릴 때도 끝은 raise exception).
-- 사람(이 시험 안에서만 바꾼다): 대표 · rehearsal.member@example.com(이 트랜잭션에서만 DY 재무 입력 줄을 준다).
-- 기대: ERROR  0085 STAGING PASS a(저장 · 자동 · 경고 · 큐) b(바꾸기 · 되돌리기) c(출하 줄 따라감) d(급여 개인 줄 보류 · 대표만) e(큐 가져가기 · 끝내기) f(저장본 · 원료 칸 거부) g(기준값 대표만) h(anon 0)
-- =====================================================================
do $t$
declare
  v_chair  uuid;
  v_member uuid;
  v_out    text := '';
  v_a      uuid;
  v_b      uuid;
  v_s1     uuid;
  v_s2     uuid;
  v_pay    uuid;
  v_hold   uuid;
  v_job    uuid;
  n        int;
  t        text;
  biz      text := 'biz_dy';
  ok       boolean;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_member from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  if v_chair is null or v_member is null then raise exception 'FAIL 준비: 대표(%) · 리허설 사원(%)', v_chair, v_member; end if;
  insert into public.user_business_access (user_id, business_id) values (v_member, biz) on conflict do nothing;
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_member, '/finance/' || biz, true, false)
  on conflict (user_id, module) do update set can_write = true, can_approve = false;

  -- ── a. 사원(재무 입력)이 저장 — applied · auto · 경고 · 큐 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  v_a := public.fin_upload_save(biz, 'sales', '2099-01', 'a.xlsx', repeat('a', 64), 'S', 'high', 0,
    '[{"row_no":3,"customer":"가","product":"P","qty":1,"unit_price":1,"amount":100,"vat_state":"missing"}]'::jsonb, null, null, null, '["합계가 맞지 않습니다"]'::jsonb);
  reset role;
  select count(*) into n from public.fin_uploads where upload_id = v_a and status = 'applied' and auto and warnings = '["합계가 맞지 않습니다"]'::jsonb;
  if n <> 1 then raise exception 'FAIL a: 저장 · 자동 · 경고'; end if;
  select count(*) into n from public.fin_recalc_jobs where business_id = biz and status = 'pending' and from_period <= '2099-01';
  if n <> 1 then raise exception 'FAIL a: 큐가 서지 않았다'; end if;
  v_out := v_out || 'a(저장 · 자동 · 경고 · 큐) ';

  -- ── b. 같은 달 다시 → 바꾸기 · 되돌리기 → 옛 값 ──
  set local role authenticated;
  v_b := public.fin_upload_save(biz, 'sales', '2099-01', 'b.xlsx', repeat('b', 64), 'S', 'high', 0,
    '[{"row_no":3,"customer":"가","product":"P","qty":1,"unit_price":1,"amount":250,"vat_state":"missing"}]'::jsonb, null, null, null, '[]'::jsonb);
  reset role;
  select status into t from public.fin_uploads where upload_id = v_a;
  if t <> 'replaced' then raise exception 'FAIL b: 옛 올리기 %', t; end if;
  set local role authenticated;
  ok := public.fin_upload_revert(v_b, '시험');
  reset role;
  select count(*) into n from public.fin_sales_lines where upload_id = v_a and voided_at is null;
  if not ok or n <> 1 then raise exception 'FAIL b: 되돌리기가 옛 값을 되살리지 않았다'; end if;
  v_out := v_out || 'b(바꾸기 · 되돌리기) ';

  -- ── c. 출하집계표 — 바꾸기 · 되돌리기에 줄이 따라간다 ──
  set local role authenticated;
  v_s1 := public.fin_upload_save(biz, 'shipment', '2099-01', 's1.xlsx', repeat('c', 64), 'S', 'high', 0, '[{"row_no":2,"customer":"가","qty":10,"amount":1}]'::jsonb, null, null, null, '[]'::jsonb);
  v_s2 := public.fin_upload_save(biz, 'shipment', '2099-01', 's2.xlsx', repeat('d', 64), 'S', 'high', 0, '[{"row_no":2,"customer":"가","qty":20,"amount":1}]'::jsonb, null, null, null, '[]'::jsonb);
  ok := public.fin_upload_revert(v_s2, null);
  reset role;
  select count(*) into n from public.fin_shipment_lines where upload_id = v_s1 and voided_at is null;
  if n <> 1 then raise exception 'FAIL c: 출하 옛 줄이 되살아나지 않았다'; end if;
  select count(*) into n from public.fin_shipment_lines where upload_id = v_s2 and voided_at is null;
  if n <> 0 then raise exception 'FAIL c: 되돌린 출하 줄이 살아 있다'; end if;
  v_out := v_out || 'c(출하 줄 따라감) ';

  -- ── d. 급여 개인 줄 — 사원은 보류 · 줄 내용 못 봄 · 대표만 저장 ──
  set local role authenticated;
  v_pay := public.fin_upload_save(biz, 'payroll', '2099-01', 'p.xlsx', repeat('e', 64), 'S', 'high', 0, '[{"row_no":1,"dept":"생산","salary":300}]'::jsonb, null, null, null, '[]'::jsonb);
  v_hold := public.fin_payroll_hold(v_pay, '[{"row_no":4,"dept":"생산","person_ref":"E01","salary":300}]'::jsonb);
  select count(*) into n from public.fin_payroll_held_list(biz) where rows is null and people = 1;
  if n < 1 then raise exception 'FAIL d: 사원에게 개인 줄 내용이 갔다'; end if;
  begin
    perform public.fin_payroll_release(v_hold, true);
    raise exception 'FAIL d: 사원이 개인 줄을 풀었다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select count(*) into n from public.fin_payroll_held_list(biz) where hold_id = v_hold and rows is not null;
  if n <> 1 then raise exception 'FAIL d: 대표가 보류 줄을 못 본다'; end if;
  ok := public.fin_payroll_release(v_hold, true);
  reset role;
  select count(*) into n from public.fin_payroll_people where upload_id = v_pay and voided_at is null;
  if n <> 1 then raise exception 'FAIL d: 대표 저장 뒤 개인 줄 %', n; end if;
  v_out := v_out || 'd(급여 개인 줄 보류 · 대표만) ';

  -- ── e. 큐 — 사원이 자기 회사 일을 가져가 끝낸다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select job_id into v_job from public.fin_recalc_claim(biz, 5) limit 1;
  if v_job is null then raise exception 'FAIL e: 일을 못 가져갔다'; end if;
  perform public.fin_recalc_finish(v_job, true, null);
  reset role;
  select status into t from public.fin_recalc_jobs where job_id = v_job;
  if t <> 'done' then raise exception 'FAIL e: 끝낸 일 %', t; end if;
  v_out := v_out || 'e(큐 가져가기 · 끝내기) ';

  -- ── f. 저장본 — 장부 쓰기는 쓰고 · 원료 칸 이름은 거부 ──
  set local role authenticated;
  perform public.fin_overview_save(biz, '2099-01', '{"pl":{"revenue":100}}'::jsonb, '[]'::jsonb, true);
  begin
    perform public.fin_overview_save(biz, '2099-01', '{"materials":[1]}'::jsonb, '[]'::jsonb, true);
    raise exception 'FAIL f: 원료 칸이 실렸다';
  exception when invalid_parameter_value then null;
  end;
  reset role;
  v_out := v_out || 'f(저장본 · 원료 칸 거부) ';

  -- ── g. 기준값 — 사원 거부 · 대표 저장 ──
  set local role authenticated;
  begin
    perform public.fin_kpi_settings_save(biz, '{"safety_cash":1}'::jsonb, '시험');
    raise exception 'FAIL g: 사원이 기준값을 바꿨다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.fin_kpi_settings_save(biz, '{"safety_cash":1000000000}'::jsonb, '시험');
  reset role;
  v_out := v_out || 'g(기준값 대표만) ';

  -- ── h. anon — 새 함수 하나도 못 부른다 ──
  set local role anon;
  begin
    perform public.fin_upload_save(biz, 'sales', '2099-02', 'x', repeat('f', 64), null, 'high', 0, '[]'::jsonb, null, null, null, '[]'::jsonb);
    raise exception 'FAIL h: anon이 저장을 불렀다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.fin_overview_months limit 1;
    raise exception 'FAIL h: anon이 저장본을 읽었다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'h(anon 0)';

  raise exception '0085 STAGING PASS %', v_out;
end
$t$;
