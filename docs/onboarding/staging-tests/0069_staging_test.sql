-- =====================================================================
-- 0069 staging 검사(AI 어시스턴트 — 권한 · 조직 조회 · 보완 의견 · 보완함) — 쓰지 않는다.
-- 0069가 **적용된 뒤** staging에서 돌린다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0069 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다
-- (시험 대화 · 의견 · 묶음 · 감사 줄 · 권한 줄 모두). 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(staging에 link된 checkout 루트에서, 상대 경로로):
--   cd ~/projects/chairman-os-assist
--   cp docs/onboarding/staging-tests/0069_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0069_staging_test.sql"
--   rm -f supabase/.temp/0069_staging_test.sql
-- 기대: ERROR  0069 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(anon 거부)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 사람(id를 박지 않는다): 회장 · rehearsal.staff@example.com(이 시험 안에서만 DY 사용자 관리자) · rehearsal.member@example.com(사원).
-- =====================================================================
begin;

do $t$
declare
  v_chair  uuid;
  v_admin  uuid;
  v_member uuid;
  v_chat   uuid;
  v_q      bigint;
  v_a      bigint;
  v_a2     bigint;
  v_a3     bigint;
  v_fb     uuid;
  v_fb2    uuid;
  v_fb3    uuid;
  v_bundle uuid;
  v_res    jsonb;
  v_out    text := '';
  v_audit0 bigint;
  n int;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_admin from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  select u.id into v_member from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  if v_chair is null or v_admin is null or v_member is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 직원(%) · 리허설 사원(%)', v_chair, v_admin, v_member;
  end if;
  -- 이 시험 안에서만: 리허설 직원 = 사원 · DY 사용자 관리자, 리허설 사원 = 사원 · DY · 영업 견적(원가 줄 하나).
  update public.user_profiles set role = 'Member', status = 'active' where user_id in (v_admin, v_member);
  insert into public.user_business_access (user_id, business_id) values (v_admin, 'biz_dy'), (v_member, 'biz_dy') on conflict do nothing;
  delete from public.user_module_access where user_id in (v_admin, v_member)
     and module in ('/users/biz_dy', '/sales/biz_dy', '/documents/biz_dy');
  insert into public.user_module_access (user_id, module, can_write, can_approve) values
    (v_admin, '/users/biz_dy', true, false),
    (v_member, '/sales/biz_dy', true, false), (v_member, '/documents/biz_dy', true, false);
  select count(*) into v_audit0 from public.audit_log where entity_table in ('ai_feedback', 'ai_feedback_bundles');

  -- ── a. 대표: 사원의 권한 — 원가 줄까지 · cost_hidden=false ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  v_res := public.org_access_lookup(v_member::text);
  if jsonb_array_length(v_res) <> 1 then raise exception 'FAIL a: 대표가 사원을 못 찾았다(%)', v_res; end if;
  if not (v_res -> 0 -> 'modules') @> '[{"module":"/sales/biz_dy"}]'::jsonb or (v_res -> 0 ->> 'cost_hidden')::boolean then
    raise exception 'FAIL a: 대표에게 원가 줄이 안 보인다(%)', v_res -> 0 -> 'modules';
  end if;
  reset role;
  v_out := v_out || 'a(대표 → 사원 모듈 ' || jsonb_array_length(v_res -> 0 -> 'modules') || '줄 · 원가 줄 보임) ';

  -- ── b. 사용자 관리자(사원): 맡은 회사의 사원 — 원가 줄 빠짐 · 대표는 안 보임 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  v_res := public.org_access_lookup(v_member::text);
  if jsonb_array_length(v_res) <> 1 then raise exception 'FAIL b: 관리자가 맡은 회사 사원을 못 찾았다(%)', v_res; end if;
  if (v_res -> 0 -> 'modules') @> '[{"module":"/sales/biz_dy"}]'::jsonb or not (v_res -> 0 ->> 'cost_hidden')::boolean then
    raise exception 'FAIL b: 관리자에게 원가 줄이 보인다(%)', v_res -> 0 -> 'modules';
  end if;
  if not (v_res -> 0 -> 'modules') @> '[{"module":"/documents/biz_dy"}]'::jsonb then
    raise exception 'FAIL b: 관리자에게 문서 등록 줄이 안 보인다(%)', v_res -> 0 -> 'modules';
  end if;
  if jsonb_array_length(public.org_access_lookup(v_chair::text)) <> 0 then raise exception 'FAIL b: 관리자에게 대표가 보인다'; end if;
  -- 리뷰 I2: 상사가 대표면 이름 · 직함 · 역할 없이 top만.
  if (select reports_to from public.user_profiles where user_id = v_member) = v_chair
     and (v_res -> 0 -> 'reports_to') is distinct from '{"top": true}'::jsonb then
    raise exception 'FAIL b: 관리자에게 대표 상사의 이름 · 역할이 보인다(%)', v_res -> 0 -> 'reports_to';
  end if;
  reset role;
  v_out := v_out || 'b(관리자 → 사원 보임 · 원가 줄 숨김 · 대표 안 보임 · 대표 상사는 top만) ';

  -- ── c. 사원: 본인만 — 관리자 · 대표 안 보임, 'me'는 본인(원가 줄 숨김) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  if jsonb_array_length(public.org_access_lookup(v_admin::text)) <> 0 then raise exception 'FAIL c: 사원에게 다른 사원이 보인다'; end if;
  v_res := public.org_access_lookup('me');
  if jsonb_array_length(v_res) <> 1 or (v_res -> 0 ->> 'user_id')::uuid <> v_member then raise exception 'FAIL c: me가 본인이 아니다(%)', v_res; end if;
  if (v_res -> 0 -> 'modules') @> '[{"module":"/sales/biz_dy"}]'::jsonb then raise exception 'FAIL c: 사원 본인에게 원가 줄이 보인다'; end if;
  begin
    perform 1 from public.user_module_access where user_id = v_admin;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL c: 사원이 남의 모듈 줄을 직접 읽는다'; end if;
  end;
  v_out := v_out || 'c(사원 → 본인만 · 원가 줄 숨김) ';

  -- ── d. 사원: 의견 남기기 — 질문 · 답은 DB가 복사 · 같은 답 두 번 거부 · 표 직접 읽기 0 · 민감 낱말 → 제외 ──
  insert into public.ai_chats (title) values ('0069 시험') returning chat_id into v_chat;
  insert into public.ai_chat_messages (chat_id, role, content) values (v_chat, 'user', '내 권한은?') returning id into v_q;
  insert into public.ai_chat_messages (chat_id, role, content) values (v_chat, 'assistant', '시험 답입니다.') returning id into v_a;
  insert into public.ai_chat_messages (chat_id, role, content) values (v_chat, 'user', '이 제품 단가 알려줘') returning id into v_q;
  insert into public.ai_chat_messages (chat_id, role, content) values (v_chat, 'assistant', '단가 1200원/kg은 볼 수 없습니다.') returning id into v_a2;
  insert into public.ai_chat_messages (chat_id, role, content) values (v_chat, 'user', '결재 양식 뭐 있어?') returning id into v_q;
  insert into public.ai_chat_messages (chat_id, role, content) values (v_chat, 'assistant', '양식 다섯 개입니다.') returning id into v_a3;
  v_fb := public.ai_feedback_submit(v_a, '권한 표가 없어서 불편합니다', '/me', 'biz_dy', false, '{}');
  begin
    perform public.ai_feedback_submit(v_a, '두 번째', '/me', 'biz_dy', false, '{}');
    raise exception 'FAIL d: 같은 답에 의견이 두 번 들어갔다';
  exception when others then
    if sqlerrm not like '%ai_feedback_duplicate%' then raise exception 'FAIL d: 중복 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  v_fb2 := public.ai_feedback_submit(v_a2, '이 답이 짧습니다', '/me', 'biz_dy', false, '{}');
  v_fb3 := public.ai_feedback_submit(v_a3, '양식 설명이 더 필요합니다', '/me?tab=1', null, false, '{}');
  select count(*) into n from public.ai_feedback;
  if n <> 0 then raise exception 'FAIL d: 사원이 의견 표를 직접 읽는다(% 줄)', n; end if;
  select count(*) into n from public.ai_feedback_mine();
  if n <> 3 then raise exception 'FAIL d: 내 의견이 3개가 아니다(%)', n; end if;
  begin
    update public.ai_feedback set body = '고침' where feedback_id = v_fb;
    raise exception 'FAIL d: 의견을 고칠 수 있다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  select count(*) into n from public.ai_feedback where feedback_id = v_fb and question = '내 권한은?' and answer = '시험 답입니다.' and not ai_excluded;
  if n <> 1 then raise exception 'FAIL d: 질문 · 답 원문이 복사되지 않았다'; end if;
  select count(*) into n from public.ai_feedback where feedback_id = v_fb2 and ai_excluded and 'cost_number' = any (excluded_reasons);
  if n <> 1 then raise exception 'FAIL d: 답의 «단가 1200원»이 AI 정리 제외로 표시되지 않았다'; end if;
  v_out := v_out || 'd(의견 3 · 원문 복사 · 중복 거부 · 표 직접 읽기 0 · 고치기 거부 · 단가 숫자 → 제외) ';

  -- ── e. 다른 사람: 남의 답에 의견 거부 · 남의 의견 취소 false / 대표: 전부 읽기 · 상태 · AI 정리(제외 거부) · 묶음 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  begin
    perform public.ai_feedback_submit(v_a3, '남의 답', '/me', null, false, '{}');
    raise exception 'FAIL e: 남의 답에 의견이 들어갔다';
  exception when others then
    if sqlerrm not like '%ai_feedback_message%' then raise exception 'FAIL e: 남의 답 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  if public.ai_feedback_cancel(v_fb) then raise exception 'FAIL e: 남의 의견을 취소했다'; end if;
  begin
    perform public.ai_feedback_set_status(v_fb, 'held');
    raise exception 'FAIL e: 대표 아닌 사람이 상태를 바꿨다';
  exception when others then
    if sqlerrm not like '%ai_feedback_denied%' then raise exception 'FAIL e: 상태 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select count(*) into n from public.ai_feedback where feedback_id in (v_fb, v_fb2, v_fb3);
  if n <> 3 then raise exception 'FAIL e: 대표가 의견을 전부 못 읽는다(%)', n; end if;
  begin
    perform public.ai_feedback_save_triage(v_fb2, '{"summary":"s","expected":"e","instruction":"i","model":"m"}'::jsonb);
    raise exception 'FAIL e: AI 정리 제외 줄에 정리가 저장됐다';
  exception when others then
    if sqlerrm not like '%ai_feedback_excluded%' then raise exception 'FAIL e: 제외 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  begin
    perform public.ai_feedback_save_triage(v_fb, '{"summary":"원가 300원","expected":"e","instruction":"i","model":"m"}'::jsonb);
    raise exception 'FAIL e: 원가 숫자가 든 정리가 저장됐다';
  exception when others then
    if sqlerrm not like '%ai_feedback_triage_sensitive%' then raise exception 'FAIL e: 민감 정리 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  if not public.ai_feedback_save_triage(v_fb, '{"summary":"권한 표 없음","expected":"표가 보인다","instruction":"■ 현황","model":"m"}'::jsonb) then
    raise exception 'FAIL e: AI 정리 저장 실패';
  end if;
  select count(*) into n from public.ai_feedback where feedback_id = v_fb and status = 'triaged' and triage ->> 'by' = 'Chairman';
  if n <> 1 then raise exception 'FAIL e: 정리 뒤 상태가 triaged가 아니다'; end if;
  if not public.ai_feedback_set_status(v_fb, 'copied') then raise exception 'FAIL e: 상태 바꾸기 실패'; end if;
  begin
    perform public.ai_feedback_save_bundle(array[v_fb, v_fb2], '묶음', '{"summary":"s","expected":"e","instruction":"i","model":"m"}'::jsonb);
    raise exception 'FAIL e: 제외 줄이 묶였다';
  exception when others then
    if sqlerrm not like '%ai_feedback_excluded%' then raise exception 'FAIL e: 묶음 제외 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  v_bundle := public.ai_feedback_save_bundle(array[v_fb, v_fb3], '/me 권한 · 양식 설명', '{"summary":"s","expected":"e","instruction":"i","model":"m"}'::jsonb);
  select count(*) into n from public.ai_feedback where bundle_id = v_bundle;
  if n <> 2 then raise exception 'FAIL e: 묶음에 의견 둘이 안 붙었다(%)', n; end if;
  if not public.ai_feedback_bundle_set_status(v_bundle, 'applied') then raise exception 'FAIL e: 묶음 상태 실패'; end if;
  select count(*) into n from public.ai_feedback where bundle_id = v_bundle and status = 'applied';
  if n <> 2 then raise exception 'FAIL e: 묶음 «반영됨»이 의견에 안 적혔다(%)', n; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  if not public.ai_feedback_cancel(v_fb3) then raise exception 'FAIL e: 본인 취소 실패'; end if;
  if public.ai_feedback_cancel(v_fb3) then raise exception 'FAIL e: 두 번 취소됐다'; end if;
  reset role;
  select count(*) into n from public.ai_feedback where feedback_id = v_fb3 and cancelled_at is not null;
  if n <> 1 then raise exception 'FAIL e: 취소 표시가 없다(줄은 남아야 한다)'; end if;
  select count(*) - v_audit0 into n from public.audit_log where entity_table in ('ai_feedback', 'ai_feedback_bundles');
  if n < 7 then raise exception 'FAIL e: 감사 줄이 모자란다(%)', n; end if;
  v_out := v_out || 'e(남의 답 거부 · 대표 3줄 · 제외 정리 거부 · 원가 숫자 정리 거부 · 정리 → triaged · 묶음 2 → 반영됨 · 본인 취소 1번 · 감사 ' || n || '줄) ';

  -- ── f. anon: 조회 · 표 · 제출 모두 거부 ──
  set local role anon;
  begin
    perform public.org_access_lookup('me');
    raise exception 'FAIL f: anon이 조회했다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.ai_feedback limit 1;
    raise exception 'FAIL f: anon이 의견 표를 읽었다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ai_feedback_submit(v_a, 'x', '/', null, false, '{}');
    raise exception 'FAIL f: anon이 의견을 냈다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'f(anon 거부)';

  raise exception '0069 STAGING PASS %', v_out;
end;
$t$;

rollback;
