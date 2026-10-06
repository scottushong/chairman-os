-- =====================================================================
-- 0055 staging 검사 — 쓰지 않는다. 0054 · 0055가 **적용된 뒤** staging에서 돌린다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0055 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다(commit 없음).
-- 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(읽기 전용 아님 — 그러나 commit이 없다):
--   SUPABASE_DB_PASSWORD=$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-) \
--     npx supabase db query --linked "$(cat 0055_staging_test.sql)"
-- 기대 결과: ERROR  0055 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(…) g(…) h(…)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 계정은 이메일 · 역할로 찾는다(id를 박지 않는다).
--   rehearsal.member@example.com — Member · DY · 경영지원 · 상사 = 회장. 이 트랜잭션 안에서만 회장 세션으로
--     «DY 사용자 관리자»(/users/biz_dy) · DY 재무 입력 · DY 문서 등록 · 결재 올리기를 켠다(롤백으로 사라진다).
--   회장 — user_profiles.role = 'Chairman'
-- =====================================================================
begin;

do $t$
declare
  v_admin uuid;
  v_chair uuid;
  v_admin_class text;
  v_above text;
  v_res text := '';
  v_id_tl uuid;
  v_id_m uuid;
  v_new uuid := gen_random_uuid();
  v_tag text := substr(md5(random()::text), 1, 8);
  v_email_tl text;
  v_email_m text;
  v_path text;
  v_opt jsonb;
  v_case text;
  v_want text;
  n int;
  n0 int;
  r record;
begin
  v_email_tl := 'stage0055tl.' || v_tag || '@example.com';
  v_email_m := 'stage0055m.' || v_tag || '@example.com';

  -- ── 준비(기본 역할) ──
  select u.id, p.max_security_class::text into v_admin, v_admin_class
    from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.role::text = 'Member' and p.revoked_at is null;
  select p.user_id into v_chair from public.user_profiles p
   where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  if v_admin is null or v_chair is null then
    raise exception 'FAIL 준비: 리허설 직원(%) 또는 회장(%)을 못 찾았다', v_admin, v_chair;
  end if;
  if not exists (select 1 from public.user_business_access where user_id = v_admin and business_id = 'biz_dy') then
    raise exception 'FAIL 준비: 리허설 직원에게 DY 회사 범위가 없다';
  end if;
  if to_regprocedure('public.staff_admin_invite(text,text,text,text,text,uuid,text,text[],text,text,date,text)') is null then
    raise exception 'FAIL 준비: 0055가 적용되지 않았다(staff_admin_invite 없음)';
  end if;
  v_above := case v_admin_class when 'Normal' then 'Restricted' when 'Restricted' then 'Vault' else null end;
  select count(*) into n0 from public.notifications where user_id = v_chair;

  -- ── 회장 세션 — 능력과 권한 셋을 켠다(이 트랜잭션 안에서만) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  insert into public.user_module_access (user_id, module, can_write, can_approve) values
    (v_admin, '/users/biz_dy', true, false), (v_admin, '/finance/biz_dy', true, false),
    (v_admin, '/documents/biz_dy', true, false), (v_admin, '/chairman/decisions', true, false)
  on conflict (user_id, module) do update set can_write = true;
  -- 회장은 위임 길에 들어오지 않는다.
  if public.can_manage_users('biz_dy') then raise exception 'FAIL 준비: 회장이 can_manage_users(DY)로 참'; end if;

  -- ── 관리자 세션 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  if not public.can_manage_users('biz_dy') then raise exception 'FAIL a: 관리자가 can_manage_users(DY) 거짓'; end if;
  if public.can_manage_users('biz_vana') then raise exception 'FAIL a: DY 관리자가 VANA 관리자'; end if;
  v_opt := public.staff_admin_options('biz_dy');
  if not (v_opt->'people') @> jsonb_build_array(jsonb_build_object('user_id', v_chair)) then
    raise exception 'FAIL a: 상사 후보에 회장이 없다';
  end if;
  if (v_opt->'people') @> jsonb_build_array(jsonb_build_object('user_id', v_admin)) then
    raise exception 'FAIL a: 상사 후보에 관리자 본인이 있다';
  end if;
  if exists (select 1 from jsonb_array_elements(v_opt->'teams') t where t->>'team_id' not like 'team_dy_%') then
    raise exception 'FAIL a: 팀 후보에 DY 밖 팀이 있다';
  end if;
  if (v_opt->'grantable') <> '["/documents/biz_dy", "/finance/biz_dy"]'::jsonb then
    raise exception 'FAIL a: 줄 수 있는 권한이 다르다 — %', v_opt->'grantable';
  end if;
  v_res := v_res || format('a(능력 · 고르기 사람 %s · 팀 %s) ', jsonb_array_length(v_opt->'people'), jsonb_array_length(v_opt->'teams'));

  -- (b) 팀장 · 사원 초대 — 즉시 효력(결재 큐 없음)
  v_id_tl := public.staff_admin_invite(p_business => 'biz_dy', p_email => v_email_tl, p_display_name => '0055 검사 팀장',
    p_role => 'TeamLead', p_team_id => 'team_dy_sales', p_reports_to => v_chair);
  v_id_m := public.staff_admin_invite(p_business => 'biz_dy', p_email => v_email_m, p_display_name => '0055 검사 사원',
    p_role => 'Member', p_team_id => 'team_dy_support', p_reports_to => v_chair,
    p_module_grants => array['/finance/biz_dy', '/documents/biz_dy', '/chairman/decisions']);
  select chairman_approval_required as req, staff_admin_business as sab, module_grants as mg into r
    from public.user_invitations where invitation_id = v_id_m;
  -- 리뷰 I4 — «결재 올리기»는 버려지고(새 직원 기본) 둘만 실린다.
  if r.req is not false or r.sab is distinct from 'biz_dy' or r.mg <> '["/documents/biz_dy", "/finance/biz_dy"]'::jsonb then
    raise exception 'FAIL b: 사원 초대 = req % / sab % / mg %', r.req, r.sab, r.mg;
  end if;
  v_res := v_res || 'b(팀장 · 사원 초대 · 결재 큐 없음) ';

  -- (c) 거부 — 역할 · 권한 · 상사 · 팀 · 등급 · 회사
  foreach v_case in array array['exec', 'grant', 'boss', 'self', 'team', 'class', 'vana', 'taken'] loop
    v_want := case v_case when 'exec' then 'staff_admin_role' when 'grant' then 'staff_admin_grant' when 'taken' then 'staff_admin_email_taken'
      when 'boss' then 'staff_admin_boss_missing' when 'self' then 'staff_admin_boss_self' when 'team' then 'staff_admin_team'
      when 'class' then 'staff_admin_class' else 'staff_admin_denied' end;
    if v_case = 'class' and v_above is null then continue; end if;
    begin
      perform public.staff_admin_invite(
        p_business => case when v_case = 'vana' then 'biz_vana' else 'biz_dy' end,
        p_email => case when v_case = 'taken' then v_email_m else 'stage0055x' || v_case || '.' || v_tag || '@example.com' end,
        p_display_name => '0055 거부 ' || v_case,
        p_role => case when v_case = 'exec' then 'Executive' else 'Member' end,
        p_team_id => case when v_case = 'team' then null else 'team_dy_support' end,
        p_reports_to => case when v_case = 'boss' then null when v_case = 'self' then v_admin else v_chair end,
        p_security_class => case when v_case = 'class' then v_above else 'Normal' end,
        p_module_grants => case when v_case = 'grant' then array['/finance/biz_vana'] else '{}'::text[] end);
      raise exception 'FAIL c: %이(가) 거부되지 않았다', v_case;
    exception when insufficient_privilege or invalid_parameter_value or unique_violation then
      if sqlerrm <> v_want then raise exception 'FAIL c: % 오류가 % (기대 %)', v_case, sqlerrm, v_want; end if;
    end;
  end loop;
  v_res := v_res || 'c(Executive · 남의 회사 권한 · 상사 없음 · 본인 상사 · 팀 없음 · 등급 · VANA · 같은 이메일 거부) ';

  -- (c2) 리뷰 I1 · I3 — 설정을 직접 켜도 · 0026 길로 직접 넣어도 막힌다.
  begin
    insert into public.user_invitations (email, role, display_name, invited_by, reports_to, business_ids, team_id)
    values ('stage0055d.' || v_tag || '@example.com', 'Member', 'x', v_admin, v_chair, array['biz_dy'], 'team_dy_support');
    raise exception 'FAIL c2: 0026 위임 insert가 열려 있다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform set_config('chairman.staff_admin', 'invite', true);
    insert into public.user_invitations (email, role, display_name, invited_by, reports_to, business_ids, team_id, staff_admin_business)
    values ('stage0055g.' || v_tag || '@example.com', 'Executive', 'x', v_admin, v_chair, array['biz_dy'], 'team_dy_support', 'biz_dy');
    raise exception 'FAIL c2: 설정을 켠 직접 insert로 Executive가 들어간다';
  exception when insufficient_privilege then null;
  end;
  perform set_config('chairman.staff_admin', '', true);
  v_res := v_res || 'c2(0026 직접 · 설정 직접 거부) ';

  -- (d) 회장 알림 · 감사
  reset role;
  select count(*) into n from public.notifications where user_id = v_chair and title like '%0055 검사 %';
  if n <> 2 then raise exception 'FAIL d: 회장 알림 %건(2건이어야)', n; end if;
  if exists (select 1 from public.notifications where user_id = v_chair and title like '%0055 검사 %'
              and (title || coalesce(body, '')) like '%회장%') then
    raise exception 'FAIL d: 알림 문구에 «회장»';
  end if;
  select count(*) into n from public.audit_log where action::text = 'permission_change' and entity_table = 'user_invitations'
     and actor_user_id = v_admin and entity_id in (v_email_tl, v_email_m) and note like '위임 초대(0055%';
  if n <> 2 then raise exception 'FAIL d: 위임 초대 감사 %건(2건이어야)', n; end if;
  v_res := v_res || 'd(회장 알림 2 · 감사 2) ';

  -- (e) 가입 — 세션 없이 auth.users insert → 프로필 · 회사 · 권한 셋(0054 결재 올리기 포함)
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    insert into auth.users (id, instance_id, aud, role, email)
    values (v_new, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email_m);
    v_path := '가입';
  exception when others then
    raise exception 'FAIL e: auth.users insert 실패 — %', sqlerrm;
  end;
  select role::text as role, team_id, reports_to into r from public.user_profiles where user_id = v_new and revoked_at is null;
  if not found or r.role <> 'Member' or r.team_id <> 'team_dy_support' or r.reports_to <> v_chair then
    raise exception 'FAIL e: 프로필 = % / % / %', r.role, r.team_id, r.reports_to;
  end if;
  select count(*) into n from public.user_module_access
   where user_id = v_new and can_write and not can_approve and module in ('/finance/biz_dy', '/documents/biz_dy', '/chairman/decisions');
  if n <> 3 then raise exception 'FAIL e: 가입한 직원의 권한 %줄(3줄이어야)', n; end if;
  if exists (select 1 from public.user_module_access where user_id = v_new and can_approve) then
    raise exception 'FAIL e: 가입한 직원에게 마감이 붙었다';
  end if;
  v_res := v_res || 'e(가입 · 권한 3줄 · 마감 없음) ';

  -- (f) 새 직원이 결재를 올린다 · 관리자는 그 결재를 못 본다 · 새 직원은 초대를 못 한다
  perform set_config('request.jwt.claims', json_build_object('sub', v_new, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_new::text, true);
  set local role authenticated;
  insert into public.decisions (decision_id, business_id, title, options, template_key, form, created_by)
  select 'dec_t55f', 'biz_dy', '0055 검사 휴가', array['승인', '반려'], 'leave',
         jsonb_object_agg(f->>'key', case f->>'type' when 'date' then '2026-10-07' else '0055 검사' end), v_new
    from public.approval_templates t, jsonb_array_elements(t.fields) f where t.template_key = 'leave';
  begin
    perform public.staff_admin_invite(p_business => 'biz_dy', p_email => 'stage0055n.' || v_tag || '@example.com',
      p_display_name => 'x', p_role => 'Member', p_team_id => 'team_dy_support', p_reports_to => v_chair);
    raise exception 'FAIL f: 능력 없는 새 직원이 초대한다';
  exception when insufficient_privilege then
    if sqlerrm <> 'staff_admin_denied' then raise exception 'FAIL f: 새 직원 초대 오류가 %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select count(*) into n from public.decisions where decision_id = 'dec_t55f';
  if n <> 0 then raise exception 'FAIL f: 관리자가 자기 초대자의 결재를 본다'; end if;
  -- 결재선 첫 칸 · 자기 아래(0026 subtree — 이 검사가 만든 것이 아님) 밖의 남의 결재는 0건이어야 한다.
  select count(*) into n from public.decisions d where d.created_by <> v_admin
     and coalesce(d.approval_line->0->>'user_id', '') <> v_admin::text
     and not public.in_my_subtree(d.created_by);
  if n <> 0 then raise exception 'FAIL f: 관리자가 남의 결재 %건을 본다(결재선 · 자기 아래 밖)', n; end if;
  v_res := v_res || 'f(새 직원 결재 O · 초대 거부 · 관리자 열람 0) ';

  -- (g) 관리자 취소(자기 대기 초대) · 숫자
  if not public.staff_admin_revoke_invitation(v_id_tl) then raise exception 'FAIL g: 취소가 false'; end if;
  begin
    perform public.staff_admin_revoke_invitation(v_id_m);
    raise exception 'FAIL g: 수락된 초대를 취소한다';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  n := public.delegated_invite_count(now() - interval '1 hour');
  if n < 2 then raise exception 'FAIL g: 아침 숫자 %(2 이상이어야)', n; end if;
  reset role;
  if not exists (select 1 from public.user_invitations where invitation_id = v_id_tl and revoked_at is not null) then
    raise exception 'FAIL g: 취소가 안 됐다';
  end if;
  v_res := v_res || format('g(관리자 취소 · 숫자 %s) ', n);

  -- (h) 능력 회수(회장) → 대기 위임 초대 자동 취소 · 초대 거부
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  v_id_tl := public.staff_admin_invite(p_business => 'biz_dy', p_email => 'stage0055p.' || v_tag || '@example.com', p_display_name => '0055 검사 대기',
    p_role => 'Member', p_team_id => 'team_dy_support', p_reports_to => v_chair);
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  delete from public.user_module_access where user_id = v_admin and module = '/users/biz_dy';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    perform public.staff_admin_invite(p_business => 'biz_dy', p_email => 'stage0055h.' || v_tag || '@example.com',
      p_display_name => 'x', p_role => 'Member', p_team_id => 'team_dy_support', p_reports_to => v_chair);
    raise exception 'FAIL h: 능력 회수 뒤에도 초대가 된다';
  exception when insufficient_privilege then
    if sqlerrm <> 'staff_admin_denied' then raise exception 'FAIL h: 오류가 %', sqlerrm; end if;
  end;
  reset role;
  if not exists (select 1 from public.user_invitations where invitation_id = v_id_tl and revoked_at is not null) then
    raise exception 'FAIL h: 능력 회수 뒤에도 대기 위임 초대가 열려 있다';
  end if;
  if not exists (select 1 from public.audit_log where entity_id = v_id_tl::text and note like '위임 초대 자동 취소%') then
    raise exception 'FAIL h: 자동 취소 감사가 없다';
  end if;
  v_res := v_res || 'h(능력 회수 → 대기 초대 자동 취소 · 감사 · 거부) ';

  reset role;
  raise exception '0055 STAGING PASS %', v_res;
end
$t$;

rollback;
