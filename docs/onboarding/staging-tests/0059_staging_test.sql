-- =====================================================================
-- 0059 staging 검사 — 쓰지 않는다. 0059가 **적용된 뒤** staging에서 돌린다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0059 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다.
-- 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(읽기 전용 아님 — 그러나 commit이 없다):
--   staging에 link된 checkout 루트에서, 이 파일을 supabase/.temp/(gitignore)로 복사한 뒤 상대 경로로:
--     cd ~/projects/chairman-os
--     cp docs/onboarding/staging-tests/0059_staging_test.sql supabase/.temp/
--     SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" \
--       npx supabase db query --linked -f "supabase/.temp/0059_staging_test.sql"
-- 기대 결과: ERROR  0059 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(…) g(…) h(…)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 계정은 이메일 · 역할로 찾는다(id를 박지 않는다). authenticated는 auth.users를 못 읽으므로 기본 역할에서 먼저 찾는다.
--   rehearsal.member@example.com — Member · DY · 상사 = 회장 · «결재 올리기» 켬(0054 검사와 같은 사람)
--   회장 — user_profiles.role = 'Chairman'
--   중간 상사 — DY 접근이 있는 살아 있는 TeamLead · Executive 한 사람(있으면). 트랜잭션 안에서만 리허설 직원의 상사로 건다.
-- =====================================================================
begin;

do $t$
declare
  v_member uuid;
  v_chair  uuid;
  v_mid    uuid;
  v_form   jsonb;
  v_over   numeric;
  v_res    text := '';
  v_out    text;
  r record;
  n int;
  v_who uuid;
  v_last boolean;
begin
  -- ── 준비(기본 역할) ──
  select u.id into v_member
    from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.role::text = 'Member' and p.revoked_at is null;
  select p.user_id into v_chair from public.user_profiles p
   where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  if v_member is null or v_chair is null then
    raise exception 'FAIL 준비: 리허설 직원(%) 또는 회장(%)을 못 찾았다', v_member, v_chair;
  end if;
  if (select reports_to from public.user_profiles where user_id = v_member) is distinct from v_chair then
    raise exception 'FAIL 준비: 리허설 직원의 상사가 회장이 아니다';
  end if;
  select chairman_over into v_over from public.approval_templates where template_key = 'expense';
  if v_over is null or v_over <= 300000 or v_over > 6000000 then
    raise exception 'FAIL 준비: 지출 대표 기준(%)이 30만 초과 · 600만 이하가 아니다', v_over;
  end if;
  select jsonb_object_agg(f->>'key',
           case f->>'type' when 'date' then '2026-10-07' when 'number' then '1' when 'url' then 'https://example.com/0059'
                           when 'money' then '0' else '0059 검사' end)
    into v_form
    from public.approval_templates t, jsonb_array_elements(t.fields) f
   where t.template_key = 'expense';
  select p.user_id into v_mid from public.user_profiles p
   where p.role::text in ('TeamLead', 'Executive') and p.revoked_at is null and p.status = 'active' and p.user_id <> v_member
     and exists (select 1 from public.user_business_access a where a.user_id = p.user_id and a.business_id = 'biz_dy')
   order by p.created_at limit 1;

  -- ── (a) 상사가 대표인 직원의 30만 — 대표 승인 대기(«기록 완료» 폐지) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  insert into public.decisions (decision_id, business_id, title, options, impact, deadline, template_key, form, created_by)
  values ('dec_t59a', 'biz_dy', '0059 검사 30만', array['승인', '반려'], 'Low', date '2026-10-31', 'expense',
          v_form || jsonb_build_object('amount', '300000'), v_member);
  select status::text as s, step_chain as c, chairman_required as cr, approval_line::text as line, requester_name as rn
    into r from public.decisions where decision_id = 'dec_t59a';
  if r.s <> 'Open' or r.c is not true or r.cr is not true then
    raise exception 'FAIL a: 30만 = % / chain % / cr %', r.s, r.c, r.cr;
  end if;
  if r.line like '%회장%' then raise exception 'FAIL a: 결재선에 «회장» — %', r.line; end if;
  select count(*) into n from public.approval_steps where decision_id = 'dec_t59a' and approver_user_id = v_chair and status = 'pending' and is_chairman;
  if n <> 1 then raise exception 'FAIL a: 대표 차례 칸이 %개', n; end if;
  -- 기안자는 자기 결재를 처리하지 못한다.
  begin
    perform public.approval_decide('dec_t59a', true, null);
    raise exception 'FAIL a: 기안자가 자기 결재를 승인했다';
  exception when no_data_found then null;  -- 결재선 밖 사람에게는 «없는 결재»(리뷰 M2)
  end;
  v_res := v_res || format('a(%s · 대표 차례 · 이름 %s) ', r.s, r.rn);

  -- ── (b) 600만 — 대표 차례 · 사유 없는 반려 거부 · 사유 반려 · 재상신 ──
  insert into public.decisions (decision_id, business_id, title, options, impact, deadline, template_key, form, created_by)
  values ('dec_t59b', 'biz_dy', '0059 검사 600만', array['승인', '반려'], 'Low', date '2026-10-31', 'expense',
          v_form || jsonb_build_object('amount', '6000000'), v_member);
  -- 결재선 위조 — 단계 표는 아무도 못 쓴다.
  begin
    insert into public.approval_steps (decision_id, seq, approver_user_id, approver_name, why, status)
    values ('dec_t59b', 9, v_member, '나', 'x', 'pending');
    raise exception 'FAIL b: 직원이 결재 단계를 직접 넣었다';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  begin
    perform public.approval_decide('dec_t59b', false, '  ');
    raise exception 'FAIL b: 사유 없는 반려가 됐다';
  exception when check_violation then
    if sqlerrm <> 'approval_reason_required' then raise exception 'FAIL b: 반려 오류가 %', sqlerrm; end if;
  end;
  v_out := public.approval_decide('dec_t59b', false, '0059 검사 — 견적 두 곳 더');
  if v_out <> 'rejected' then raise exception 'FAIL b: 반려 결과 %', v_out; end if;
  begin
    update public.decisions set title = '고침' where decision_id = 'dec_t59b';
    raise exception 'FAIL b: 끝난 결재의 제목이 고쳐졌다';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  select count(*) into n from public.notifications where user_id = v_member and title like '결재 반려%' and body like '%견적 두 곳 더%';
  if n <> 1 then raise exception 'FAIL b: 반려 알림 %건', n; end if;
  insert into public.decisions (decision_id, business_id, title, options, impact, deadline, template_key, form, created_by, resubmit_of)
  values ('dec_t59b2', 'biz_dy', '0059 검사 600만 재상신', array['승인', '반려'], 'Low', date '2026-10-31', 'expense',
          v_form || jsonb_build_object('amount', '6000000'), v_member, 'dec_t59b');
  select status::text into v_out from public.decisions where decision_id = 'dec_t59b2';
  v_res := v_res || format('b(반려 사유 필수 · 반려 · 알림 · 얼림 · 재상신 %s) ', v_out);

  -- ── (c) 대표 «한 번에 승인» — 하나라도 남의 것이면 전부 되돌림, 아니면 건마다 감사 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  begin
    perform public.approval_decide_many(array['dec_t59a', 'dec_t59b2', 'dec_t59b'], null);
    raise exception 'FAIL c: 끝난 결재가 섞인 한 번에 승인이 통과했다';
  exception when check_violation then null;
  end;
  select count(*) into n from public.decisions where decision_id in ('dec_t59a', 'dec_t59b2') and status::text = 'Open';
  if n <> 2 then raise exception 'FAIL c: 실패한 한 번에 승인이 일부를 닫았다(Open %건)', n; end if;
  n := public.approval_decide_many(array['dec_t59a', 'dec_t59b2'], null);
  if n <> 2 then raise exception 'FAIL c: 한 번에 승인 %건', n; end if;
  select count(*) into n from public.audit_log where entity_table = 'decisions' and entity_id in ('dec_t59a', 'dec_t59b2')
     and action::text = 'approve' and actor_user_id = v_chair;
  if n <> 2 then raise exception 'FAIL c: 감사 %줄', n; end if;
  v_res := v_res || 'c(전부 되돌림 · 2건 승인 · 감사 2줄) ';

  -- ── (d) 중간 상사 — 30만은 상사 종결, 600만은 상사 → 대표, 차례 건너뛰기 거부 ──
  if v_mid is not null then
    reset role;
    update public.user_profiles set reports_to = v_mid where user_id = v_member;
    perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_member::text, true);
    set local role authenticated;
    insert into public.decisions (decision_id, business_id, title, options, impact, deadline, template_key, form, created_by)
    values ('dec_t59d1', 'biz_dy', '0059 검사 상사 30만', array['승인', '반려'], 'Low', date '2026-10-31', 'expense',
            v_form || jsonb_build_object('amount', '300000'), v_member),
           ('dec_t59d2', 'biz_dy', '0059 검사 상사 600만', array['승인', '반려'], 'Low', date '2026-10-31', 'expense',
            v_form || jsonb_build_object('amount', '6000000'), v_member);
    -- 대표가 상사 차례를 건너뛰지 못한다.
    perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_chair::text, true);
    begin
      perform public.approval_decide('dec_t59d2', true, null);
      raise exception 'FAIL d: 대표가 상사 차례를 건너뛰었다';
    exception when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_mid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_mid::text, true);
    if public.approval_decide('dec_t59d1', true, null) <> 'approved' then raise exception 'FAIL d: 30만이 상사 승인으로 안 닫혔다'; end if;
    -- 600만은 사슬을 따라 차례로(중간 상사 위에 상사가 더 있으면 그 사람들도) — 마지막 칸은 대표여야 한다.
    for i in 1..10 loop
      reset role;
      select approver_user_id, is_chairman into v_who, v_last from public.approval_steps where decision_id = 'dec_t59d2' and status = 'pending';
      exit when v_who is null;
      perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_who::text, true);
      set local role authenticated;
      v_out := public.approval_decide('dec_t59d2', true, null);
      exit when v_out <> 'next';
      v_who := null;
    end loop;
    if v_out <> 'approved' or v_last is not true then raise exception 'FAIL d: 600만이 % · 마지막 칸 대표 %', v_out, v_last; end if;
    select count(*) into n from public.approval_steps where decision_id = 'dec_t59d2';
    v_res := v_res || format('d(상사 종결 · 사슬 %s칸 → 대표 · 건너뛰기 거부) ', n);
  else
    v_res := v_res || 'd(건너뜀 — DY 중간 상사 없음) ';
  end if;

  -- ── (e) 다른 회사 — VANA에 결재가 있으면 DY 직원 · 상사가 처리하지 못한다 ──
  -- VANA 결재 한 건을 기본 역할로 심는다(기안 = 리허설 직원 — 사슬은 대표 한 칸). 직원 · 중간 상사는 DY만 본다.
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.decisions (decision_id, business_id, title, options, impact, deadline, template_key, form, created_by)
  values ('dec_t59v', 'biz_vana', '0059 검사 VANA', array['승인', '반려'], 'Low', date '2026-10-31', 'expense',
          v_form || jsonb_build_object('amount', '100000'), v_member);
  foreach v_who in array array[v_member, v_mid] loop
    continue when v_who is null;
    continue when exists (select 1 from public.user_business_access where user_id = v_who and business_id = 'biz_vana');
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_who::text, true);
    set local role authenticated;
    begin
      perform public.approval_decide('dec_t59v', true, null);
      raise exception 'FAIL e: VANA 접근이 없는 사람(%)이 VANA 결재를 처리했다', v_who;
    exception when no_data_found then null;
    end;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  v_res := v_res || 'e(다른 회사 결재 = approval_not_found) ';

  -- ── (f) 결재 대장 — 권한 없는 직원은 남의 결재 0건, 회장이 «DY 결재 대장 열람»을 주면 DY 전부 ──
  select count(*) into n from public.decisions where template_key is not null and created_by is distinct from v_member
     and not public.in_approval_chain(decision_id);
  if n <> 0 then raise exception 'FAIL f: 권한 없는 직원이 남의 결재 %건을 본다', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_member, '/approvals/ledger/biz_dy', true, false);
  select count(*) into n from public.decisions where template_key is not null and business_id = 'biz_dy';
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  if (select count(*) from public.decisions where template_key is not null and business_id = 'biz_dy') <> n then
    raise exception 'FAIL f: 대장 권한자가 DY 양식 결재 %건을 다 못 본다', n;
  end if;
  if exists (select 1 from public.decisions where template_key is not null and business_id <> 'biz_dy' and created_by is distinct from v_member) then
    raise exception 'FAIL f: DY 대장 권한이 다른 회사 결재를 연다';
  end if;
  begin
    insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_member, '/approvals/ledger/biz_vana', true, false);
    raise exception 'FAIL f: 직원이 스스로 대장 권한을 줬다';
  exception when insufficient_privilege then null;
  end;
  perform public.approval_ledger_log('biz_dy', n, '{"검사":"0059"}');
  v_res := v_res || format('f(권한 없음 0건 · DY 대장 %s건 · 스스로 부여 거부 · 내려받기 감사) ', n);

  -- ── (g) 0059 전 결재 — 끝난 양식 결재는 세션이 못 고친다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  select decision_id into v_out from public.decisions where template_key is not null and not step_chain and status::text <> 'Open' limit 1;
  if v_out is not null then
    begin
      update public.decisions set title = title || ' ' where decision_id = v_out;
      raise exception 'FAIL g: 0059 전 끝난 결재(%)가 고쳐졌다', v_out;
    exception when insufficient_privilege then null;
    end;
    v_res := v_res || format('g(%s 고치기 거부) ', v_out);
  else
    v_res := v_res || 'g(건너뜀 — 0059 전 끝난 양식 결재 없음) ';
  end if;

  -- ── (h) 직원 용어 — 0059가 새로 적은 결재선 · 알림에 «회장»이 없다 ──
  reset role;
  if exists (select 1 from public.decisions where decision_id like 'dec_t59%' and approval_line::text like '%회장%')
     or exists (select 1 from public.approval_steps where decision_id like 'dec_t59%' and (approver_name like '%회장%' or why like '%회장%'))
     or exists (select 1 from public.notifications where link like '/approvals?id=dec_t59%' and (title like '%회장%' or body like '%회장%')) then
    raise exception 'FAIL h: 결재선 · 단계 · 알림에 «회장»';
  end if;
  v_res := v_res || 'h(«회장» 없음) ';

  raise exception '0059 STAGING PASS %', v_res;
end
$t$;

rollback;
