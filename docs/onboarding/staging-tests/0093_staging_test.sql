-- =====================================================================
-- 0093 staging 검사(전자결재 대표 이름) — 쓰지 않는다.
-- build-staging-dryrun.mjs 0093 0093 --tests가 0093과 같은 트랜잭션에서 돌리고 끝에 되돌린다(이 파일만 돌릴 때도 끝은 raise exception).
-- 사람(이 시험 안에서만): A = rehearsal.member@example.com(기안) · B = rehearsal.staff@example.com(검토) · 대표(역할 단계).
-- 기대: ERROR  0093 STAGING PASS a(옛 실명 백필) b(직원 화면 «대표») c(대표 본인 실명) d(처리자 바꾸기 «대표») e(도움 함수 잠금)
-- =====================================================================
do $t$
declare
  v_chair uuid;
  v_name  text;
  v_a     uuid;
  v_b     uuid;
  v_out   text := '';
  d1      uuid;
  d2      uuid;
  j       jsonb;
  t       text;
  biz     text := 'biz_dy';
begin
  select p.user_id, p.display_name into v_chair, v_name from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_a from auth.users u join public.user_profiles p on p.user_id = u.id where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  select u.id into v_b from auth.users u join public.user_profiles p on p.user_id = u.id where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  if v_chair is null or v_a is null or v_b is null or coalesce(v_name, '') in ('', '대표') then raise exception 'FAIL 준비: 대표(% · %) · A(%) · B(%)', v_chair, v_name, v_a, v_b; end if;
  insert into public.user_business_access (user_id, business_id) values (v_a, biz), (v_b, biz) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.feature_switch_set('approvals', biz, true, 'all', 'staging 시험(되돌림)');
  reset role;

  -- ── a. 옛 이력(0087 판처럼 실명이 적힌 처리자 바꾸기) — 0093 백필과 같은 문장이 이름 글자만 바꾼다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  d1 := public.ea_save_draft(null, biz, 'general', '0093 시험 일반품의', '내용', '{}'::jsonb,
                             jsonb_build_array(jsonb_build_object('user_id', v_b, 'kind', 'approve'), jsonb_build_object('role', 'Chairman', 'kind', 'approve')), '[]'::jsonb, null, null, null, null);
  perform public.ea_submit(d1, 'stg93-sub-0001');
  d2 := public.ea_save_draft(null, biz, 'general', '0093 시험 바꿀 문서', '내용', '{}'::jsonb, jsonb_build_array(jsonb_build_object('user_id', v_b, 'kind', 'approve')), '[]'::jsonb, null, null, null, null);
  perform public.ea_submit(d2, 'stg93-sub-0002');
  reset role;
  -- 0087 판 처리자 바꾸기가 남긴 모양을 손으로 심는다(소유자 권한 — 이 트랜잭션 안에서만).
  update public.ea_steps set approver_user = v_chair, approver_name = v_name where doc_id = d2 and seq = 1;
  insert into public.ea_events (doc_id, actor, action, seq, original_user, comment, before, after)
  values (d2, v_chair, 'reassign', 1, v_b, '시험', jsonb_build_object('from', '시험 팀장'), jsonb_build_object('to', v_name));
  update public.ea_steps s set approver_name = '대표' from public.user_profiles p
   where p.user_id = s.approver_user and p.role::text = 'Chairman' and s.approver_name <> '대표' and s.doc_id = d2;
  update public.ea_events e set after = jsonb_set(e.after, '{to}', '"대표"')
   where e.doc_id = d2 and e.action = 'reassign' and e.after ? 'to' and e.after ->> 'to' <> '대표'
     and exists (select 1 from public.user_profiles p where p.role::text = 'Chairman' and p.display_name = e.after ->> 'to');
  if (select approver_name from public.ea_steps where doc_id = d2 and seq = 1) <> '대표' then raise exception 'FAIL a: 결재선 칸 백필'; end if;
  if (select after ->> 'to' from public.ea_events where doc_id = d2 and action = 'reassign') <> '대표' then raise exception 'FAIL a: 이력 «to» 백필'; end if;
  if (select approver_user from public.ea_steps where doc_id = d2 and seq = 1) <> v_chair then raise exception 'FAIL a: 백필이 사람을 바꿨다'; end if;
  v_out := v_out || 'a(옛 실명 백필) ';

  -- ── b. B 검토 → 대표 승인 → A · B 화면에 실명 없음 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  perform public.ea_act(d1, 1, 'approve', '확인', 'stg93-act-0001');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  t := public.ea_act(d1, 2, 'approve', '승인', 'stg93-act-0002');
  if t <> 'approved' then raise exception 'FAIL b: 최종 승인 %', t; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  j := public.ea_doc(d1);
  if j is null or position(v_name in j::text) > 0 then raise exception 'FAIL b: 기안자 화면에 대표 실명'; end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'events') e where e ->> 'action' = 'approve' and e ->> 'actor' = '대표') then raise exception 'FAIL b: 대표 승인 이력이 «대표»가 아니다'; end if;
  if position(v_name in public.ea_doc(d2)::text) > 0 then raise exception 'FAIL b: 바꾼 문서 화면에 대표 실명'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  if position(v_name in public.ea_doc(d1)::text) > 0 then raise exception 'FAIL b: 검토자 화면에 대표 실명'; end if;
  reset role;
  v_out := v_out || 'b(직원 화면 «대표») ';

  -- ── c. 대표 본인 화면은 실명 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  if not exists (select 1 from jsonb_array_elements(public.ea_doc(d1) -> 'events') e where e ->> 'actor' = v_name) then raise exception 'FAIL c: 대표 본인 화면에 실명이 없다'; end if;
  v_out := v_out || 'c(대표 본인 실명) ';

  -- ── d. 새 처리자 바꾸기(0093 판) → «대표» ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  d2 := public.ea_save_draft(null, biz, 'general', '0093 시험 새로 바꿀 문서', '내용', '{}'::jsonb, jsonb_build_array(jsonb_build_object('user_id', v_b, 'kind', 'approve')), '[]'::jsonb, null, null, null, null);
  perform public.ea_submit(d2, 'stg93-sub-0003');
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  perform public.ea_reassign(d2, 1, v_chair, '시험');
  reset role;
  if (select approver_name from public.ea_steps where doc_id = d2 and seq = 1) <> '대표' then raise exception 'FAIL d: 새 처리자 바꾸기가 실명'; end if;
  if (select after ->> 'to' from public.ea_events where doc_id = d2 and action = 'reassign') <> '대표' then raise exception 'FAIL d: 새 처리자 바꾸기 이력에 실명'; end if;
  v_out := v_out || 'd(처리자 바꾸기 «대표») ';

  -- ── e. 도움 함수는 직접 못 부른다 ──
  if has_function_privilege('authenticated', 'public.ea_shown_name(uuid)', 'execute') or has_function_privilege('anon', 'public.ea_doc(uuid)', 'execute') then
    raise exception 'FAIL e: ea_shown_name · ea_doc 권한';
  end if;
  v_out := v_out || 'e(도움 함수 잠금)';

  raise exception '0093 STAGING PASS %', v_out;
end
$t$;
