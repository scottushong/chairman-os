-- =====================================================================
-- 0054 staging 검사 — 쓰지 않는다. 0054가 **적용된 뒤** staging에서 돌린다.
-- (적용 전에 미리 보려면 같은 폴더의 0054_staging_rehearsal.sql — 0054 본문을 같은 트랜잭션 안에 넣고 함께 버린다.)
--
-- 끝은 언제나 raise exception이다: 통과해도 «0054 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다.
-- 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(읽기 전용 아님 — 그러나 commit이 없다):
--   SUPABASE_DB_PASSWORD=$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-) \
--     npx supabase db query --linked "$(cat 0054_staging_test.sql)"
-- 기대 결과: ERROR  0054 STAGING PASS a(…) b(…) b2(…) c(…) a/b(…) d(…) e(…)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 계정은 이메일 · 역할로 찾는다(id를 박지 않는다). authenticated는 auth.users를 못 읽으므로 기본 역할에서 먼저 찾는다.
--   rehearsal.member@example.com — Member · DY · 경영지원(팀장 공석) · 상사 = 회장 · «결재 올리기» 켬
--   회장 — user_profiles.role = 'Chairman'
-- =====================================================================
begin;

do $t$
declare
  v_member uuid;
  v_chair  uuid;
  v_boss_role text;
  v_lead_of_team uuid;
  v_over numeric;
  v_form jsonb;
  v_res text := '';
  r record;
  n int;
  v_new uuid := gen_random_uuid();
  v_email text := 'stage0054.' || substr(md5(random()::text), 1, 8) || '@example.com';
  v_path text;
  v_vendor uuid := gen_random_uuid();
  v_vendor_email text := 'stage0054v.' || substr(md5(random()::text), 1, 8) || '@example.com';
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
  select (select b.role::text from public.user_profiles b where b.user_id = p.reports_to), t.lead_user_id
    into v_boss_role, v_lead_of_team
    from public.user_profiles p left join public.teams t on t.team_id = p.team_id
   where p.user_id = v_member;
  if v_boss_role is distinct from 'Chairman' or (v_lead_of_team is not null and v_lead_of_team <> v_chair) then
    raise exception 'FAIL 준비: 리허설 직원의 상사가 회장이 아니거나(%) 팀장이 따로 있다(%)', v_boss_role, v_lead_of_team;
  end if;
  if not exists (select 1 from public.user_module_access where user_id = v_member and module = '/chairman/decisions' and can_write) then
    raise exception 'FAIL 준비: 리허설 직원에게 «결재 올리기»가 없다';
  end if;
  select chairman_over into v_over from public.approval_templates where template_key = 'expense';
  if v_over is null or v_over <= 4000000 or v_over > 6000000 then
    raise exception 'FAIL 준비: 지출 대표 기준(%)이 400만 초과 · 600만 이하가 아니다', v_over;
  end if;
  -- 필수 항목을 양식에서 읽어 채운다(항목 key가 staging에서 f_1 · f_2처럼 바뀌어 있어도).
  select jsonb_object_agg(f->>'key',
           case f->>'type' when 'date' then '2026-10-06' when 'number' then '1' when 'url' then 'https://example.com/0054'
                           when 'money' then '0' else '0054 검사' end)
    into v_form
    from public.approval_templates t, jsonb_array_elements(t.fields) f
   where t.template_key = 'expense';

  -- ── 직원 세션 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;

  -- (a) 400만 — 팀장 건너뜀 · 규칙 종결(«기록 완료»)
  select count(*) into n from public.my_approval_lead();
  if n <> 0 then raise exception 'FAIL a: my_approval_lead()가 %행 — 회장이 팀장 칸에 선다', n; end if;
  insert into public.decisions (decision_id, business_id, title, options, impact, deadline, status, template_key, form, created_by)
  values ('dec_t54a', 'biz_dy', '0054 검사 400만', array['승인', '반려'], 'Low', date '2026-10-31', 'Open', 'expense',
          v_form || jsonb_build_object('amount', '4000000'), v_member);
  select status::text as s, decided_by_kind as k, lead_status as l, chairman_required as c, decided_by as dby,
         approval_line->0->>'user_id' as lead_uid, approval_line->0->>'why' as lead_why, approval_line::text as line
    into r from public.decisions where decision_id = 'dec_t54a';
  if r.s <> 'Approved' or r.k is distinct from 'rule' or r.l is distinct from 'skipped' or r.c is not false or r.lead_uid is not null then
    raise exception 'FAIL a: 400만 = % / % / % / % / lead %', r.s, r.k, r.l, r.c, r.lead_uid;
  end if;
  if r.line like '%회장%' then raise exception 'FAIL a: 결재선에 «회장» — %', r.line; end if;
  v_res := v_res || format('a(직원: %s · %s · lead %s · «%s») ', r.s, r.k, r.l, r.lead_why);

  -- (b) 600만 — 대표 칸 Open
  insert into public.decisions (decision_id, business_id, title, options, impact, deadline, status, template_key, form, created_by)
  values ('dec_t54b', 'biz_dy', '0054 검사 600만', array['승인', '반려'], 'Low', date '2026-10-31', 'Open', 'expense',
          v_form || jsonb_build_object('amount', '6000000'), v_member);
  select status::text as s, decided_by_kind as k, lead_status as l, chairman_required as c,
         jsonb_array_length(approval_line) as len, approval_line->2->>'user_id' as chair_uid
    into r from public.decisions where decision_id = 'dec_t54b';
  if r.s <> 'Open' or r.k is not null or r.l is distinct from 'skipped' or r.c is not true or r.len <> 3 or r.chair_uid is distinct from v_chair::text then
    raise exception 'FAIL b: 600만 = % / % / % / % / len % / chair %', r.s, r.k, r.l, r.c, r.len, r.chair_uid;
  end if;
  v_res := v_res || format('b(%s · chairman_required %s · lead %s) ', r.s, r.c, r.l);

  -- (b2) 리뷰 C1 — «600만» · «10억» · «1.000.000»은 거부(approval_amount_invalid, 23514). 숫자만 걸러 읽어 기준 미만으로 닫히던 길.
  declare
    v_bad text;
  begin
    foreach v_bad in array array['600만', '10억', '1.000.000'] loop
      begin
        insert into public.decisions (decision_id, business_id, title, options, impact, deadline, status, template_key, form, created_by)
        values ('dec_t54z', 'biz_dy', '0054 검사 금액 ' || v_bad, array['승인', '반려'], 'Low', date '2026-10-31', 'Open', 'expense',
                v_form || jsonb_build_object('amount', v_bad), v_member);
        raise exception 'FAIL b2: 금액 «%»이 들어갔다', v_bad;
      exception when check_violation then
        if sqlerrm <> 'approval_amount_invalid' then raise exception 'FAIL b2: 금액 «%» 오류가 %', v_bad, sqlerrm; end if;
      end;
    end loop;
  end;
  v_res := v_res || 'b2(600만 · 10억 · 1.000.000 거부) ';

  -- (c) 양식 없는 결재를 «승인»으로 — Open · decided_* null로 들어와야 한다(또는 거부)
  begin
    insert into public.decisions (decision_id, business_id, title, options, status, decided_at, decided_by, decided_by_kind, created_by)
    values ('dec_t54c', 'biz_dy', '0054 검사 몰래 승인', array['승인'], 'Approved', now(), v_chair, 'chairman', v_member);
    select status::text as s, decided_at as at, decided_by as dby, decided_by_kind as k
      into r from public.decisions where decision_id = 'dec_t54c';
    if r.s <> 'Open' or r.at is not null or r.dby is not null or r.k is not null then
      raise exception 'FAIL c: 양식 없는 결재가 % / % / % / %로 들어갔다', r.s, r.at, r.dby, r.k;
    end if;
    v_res := v_res || format('c(%s · decided_* null) ', r.s);
  exception when insufficient_privilege then
    v_res := v_res || 'c(거부 42501) ';
  end;

  -- ── 회장 세션 — (a)(b)를 읽는가 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  select count(*) into n from public.decisions where decision_id in ('dec_t54a', 'dec_t54b');
  if n <> 2 then raise exception 'FAIL a/b: 회장에게 %건만 보인다(2건이어야)', n; end if;
  v_res := v_res || 'a/b(회장 열람 2건) ';

  -- (d) 새 직원 — 회장 초대 → 가입(auth.users insert, 세션 없음) → user_profiles insert → «결재 올리기»
  insert into public.user_invitations (email, role, display_name, invited_by, reports_to, max_security_class, business_ids, team_id)
  values (v_email, 'Member', '0054 검사 신입', v_chair, v_chair, 'Normal', array['biz_dy'], 'team_dy_support');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    insert into auth.users (id, instance_id, aud, role, email)
    values (v_new, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email);
    v_path := '가입';
  exception when others then
    -- auth.users에 못 넣으면(권한 · 칸) 같은 트리거의 다른 입구 — 회수에서 되살림(재초대) — 로 잰다.
    v_path := '되살림(auth.users insert 실패: ' || sqlerrm || ')';
    -- 되살림은 회장 세션(또는 회장 초대)일 때만 다시 붙는다(리뷰 I4) — 회수는 기본 역할로, 되살림은 회장 세션으로.
    v_new := v_member;
    delete from public.user_module_access where user_id = v_member and module = '/chairman/decisions';
    update public.user_profiles set revoked_at = now(), status = 'left' where user_id = v_member;
    perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_chair::text, true);
    set local role authenticated;
    update public.user_profiles set revoked_at = null, status = 'active' where user_id = v_member;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
  end;
  if not exists (select 1 from public.user_profiles where user_id = v_new and revoked_at is null) then
    raise exception 'FAIL d(%): 프로필이 안 생겼다', v_path;
  end if;
  select count(*) into n from public.user_module_access
   where user_id = v_new and module = '/chairman/decisions' and can_write and not can_approve;
  if n <> 1 then raise exception 'FAIL d(%): «결재 올리기» 줄 %개', v_path, n; end if;
  select count(*) into n from public.user_business_access where user_id = v_new and business_id = 'biz_dy';
  if n <> 1 then raise exception 'FAIL d(%): 회사 범위(biz_dy)가 없다', v_path; end if;
  -- 새 직원 세션으로 DY 휴가 결재가 올라가고 VANA는 막힌다.
  perform set_config('request.jwt.claims', json_build_object('sub', v_new, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_new::text, true);
  set local role authenticated;
  insert into public.decisions (decision_id, business_id, title, options, template_key, form, created_by)
  select 'dec_t54d', 'biz_dy', '0054 검사 휴가', array['승인', '반려'], 'leave',
         jsonb_object_agg(f->>'key', case f->>'type' when 'date' then '2026-10-07' else '0054 검사' end), v_new
    from public.approval_templates t, jsonb_array_elements(t.fields) f where t.template_key = 'leave';
  -- 휴가는 대표 기준이 없다 — 상사가 대표인 새 직원의 휴가는 팀장 단계 없이 «기록 완료»(DEFERRED I3).
  select status::text as s, decided_by_kind as k, lead_status as l, created_by as cb into r from public.decisions where decision_id = 'dec_t54d';
  if not found then raise exception 'FAIL d: 새 직원의 휴가 결재가 안 보인다(본인 결재)'; end if;
  if r.cb is distinct from v_new or (v_path = '가입' and (r.s <> 'Approved' or r.k is distinct from 'rule' or r.l is distinct from 'skipped')) then
    raise exception 'FAIL d: 휴가 결재 = % / % / % / 기안 %', r.s, r.k, r.l, r.cb;
  end if;
  begin
    insert into public.decisions (decision_id, business_id, title, options, created_by)
    values ('dec_t54e', 'biz_vana', '0054 검사 남의 회사', array['승인'], v_new);
    raise exception 'FAIL d: 새 직원이 VANA 결재를 올린다';
  exception when insufficient_privilege then
    null;
  end;
  v_res := v_res || format('d(%s · 결재 올리기 1줄 · 휴가 %s/%s · DY 올림 O · VANA 거부) ', v_path, r.s, r.k);

  -- (e) 리뷰 I1 — Vendor(외부 역할)로 가입한 사람에게는 «결재 올리기»가 없다. 가입 경로가 되는 staging에서만.
  reset role;
  if v_path = '가입' then
    perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_chair::text, true);
    set local role authenticated;
    insert into public.user_invitations (email, role, display_name, invited_by, reports_to, max_security_class, business_ids)
    values (v_vendor_email, 'Vendor', '0054 검사 거래처', v_chair, v_chair, 'Normal', array['biz_dy']);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    insert into auth.users (id, instance_id, aud, role, email)
    values (v_vendor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_vendor_email);
    if not exists (select 1 from public.user_profiles where user_id = v_vendor and role::text = 'Vendor') then
      raise exception 'FAIL e: Vendor 초대가 프로필을 만들지 않았다';
    end if;
    select count(*) into n from public.user_module_access where user_id = v_vendor and module = '/chairman/decisions';
    if n <> 0 then raise exception 'FAIL e: Vendor에게 «결재 올리기»가 붙었다'; end if;
    v_res := v_res || 'e(Vendor 결재 올리기 없음) ';
  else
    v_res := v_res || 'e(건너뜀 — auth.users insert 불가) ';
  end if;

  reset role;
  raise exception '0054 STAGING PASS %', v_res;
end
$t$;

rollback;
