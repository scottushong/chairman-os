-- =====================================================================
-- 0088 staging 검사(기억 엔진 — 대표 본인만 · 저장 · 처리 넣기 · 중복 없음 · 검토 · 업무 · 검색 · 직원/AI Agent/anon 0) — 쓰지 않는다.
-- build-staging-dryrun.mjs --tests가 0088과 같은 트랜잭션에서 돌리고 끝에 되돌린다(이 파일만 돌릴 때도 끝은 raise exception).
-- 사람(이 시험 안에서만): 대표 · rehearsal.member@example.com(사원) · AI Agent 계정(있으면).
-- 기대: ERROR  0088 STAGING PASS a(스위치 대표만) b(저장 · 같은 열쇠 한 줄) c(넣기 · 두 번 넣어도 한 번) d(사람 확정 안 됨) e(업무 승인 · 정의자 통로) f(검색) g(사원 0 · 거부) h(AI Agent 0) i(anon 거부) j(원본 고치기 거부)
-- =====================================================================
do $t$
declare
  v_chair  uuid;
  v_member uuid;
  v_agent  uuid;
  v_out    text := '';
  v_cap    uuid;
  v_cap2   uuid;
  v_rv     uuid;
  v_proj   text;
  v_r      jsonb;
  n        int;
  v_payload jsonb;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_member from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  select p.user_id into v_agent from public.user_profiles p where p.role::text = 'AIAgent' and p.revoked_at is null order by p.created_at limit 1;
  select project_id into v_proj from public.projects order by project_id limit 1;
  if v_chair is null or v_member is null or v_proj is null then raise exception 'FAIL 준비: 대표(%) · 리허설 사원(%) · 프로젝트(%)', v_chair, v_member, v_proj; end if;

  -- ── a. 스위치 기본 «대표만» ──
  select count(*) into n from public.feature_switches where feature_key = 'memory_engine' and business_id is null and enabled and audience = 'chairman';
  if n <> 1 then raise exception 'FAIL a: memory_engine 기본 줄 %', n; end if;
  v_out := v_out || 'a(스위치 대표만) ';

  -- ── b. 대표 저장 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  v_cap := public.memory_capture_save('staging-0088-test-a', 'note', null, 'A회사는 11월 납품을 약속했다. 방 사장에게 전달했다.', null, 'quick_capture', '{}'::jsonb);
  if public.memory_capture_save('staging-0088-test-a', 'note', null, '다른 글', null, 'quick_capture', '{}'::jsonb) <> v_cap then raise exception 'FAIL b: 같은 열쇠로 두 줄'; end if;
  select count(*) into n from public.memory_captures where capture_id = v_cap and processing_status = 'saved';
  if n <> 1 then raise exception 'FAIL b: 대표가 자기 기록을 못 본다'; end if;
  v_out := v_out || 'b(저장 · 같은 열쇠 한 줄) ';

  -- ── c. 처리 결과 넣기 · 두 번 ──
  if public.memory_job_claim(v_cap) is null then raise exception 'FAIL c: 큐를 못 잡았다'; end if;
  v_payload := jsonb_build_object(
    'summary', '규칙 요약', 'categories', jsonb_build_array('operations'),
    'runs', jsonb_build_array(jsonb_build_object('stage', 'extract', 'status', 'done', 'engine', 'rule')),
    'items', jsonb_build_array(
      jsonb_build_object('ref', 'i0', 'memory_type', 'commitment', 'content', 'A회사는 11월 납품을 약속했다.', 'source_quote', 'A회사는 11월 납품을 약속했다.', 'direction', 'others', 'due_text', '11월', 'confidence', 0.65, 'origin', 'rule'),
      jsonb_build_object('ref', 'i1', 'memory_type', 'task', 'content', '견적서를 보내야 한다', 'direction', 'mine', 'confidence', 0.6, 'origin', 'rule')),
    'links', jsonb_build_array(
      jsonb_build_object('item_ref', null, 'target_type', 'entity', 'entity_type', 'company', 'display_name', 'A회사', 'relationship', 'mentions', 'verification_status', 'suggested', 'confidence', 0.4, 'mention_text', 'A회사'),
      jsonb_build_object('item_ref', null, 'target_type', 'person', 'target_id', v_member::text, 'relationship', 'mentions', 'verification_status', 'confirmed', 'confidence', 0.9, 'mention_text', '방 사장')),
    'reviews', jsonb_build_array(
      jsonb_build_object('review_type', 'task_candidate', 'title', '업무로?', 'proposed_change', jsonb_build_object('project_id', v_proj, 'title', '견적서를 보내야 한다'), 'item_ref', 'i1', 'priority', 'low', 'key', 'task1'),
      jsonb_build_object('review_type', 'entity_identity', 'title', '방 사장 누구?', 'proposed_change', jsonb_build_object('mention', '방 사장'), 'link_ref', '1', 'priority', 'medium', 'key', 'who1')));
  v_r := public.memory_apply(v_cap, v_payload);
  perform public.memory_job_claim(v_cap);
  v_r := public.memory_apply(v_cap, v_payload);
  if (v_r ->> 'new_items')::int <> 0 or (v_r ->> 'new_reviews')::int <> 0 or (v_r ->> 'new_links')::int <> 0 then raise exception 'FAIL c: 두 번째 넣기가 늘었다 %', v_r; end if;
  select count(*) into n from public.memory_items where capture_id = v_cap;
  if n <> 2 then raise exception 'FAIL c: 정보 % 줄', n; end if;
  select count(*) into n from public.memory_processing_runs where capture_id = v_cap;
  if n < 3 then raise exception 'FAIL c: 처리 이력 % 줄', n; end if;
  v_out := v_out || 'c(넣기 · 두 번 넣어도 한 번) ';

  -- ── d. 사람은 처리 쪽이 확정 못 함 ──
  select count(*) into n from public.memory_links where capture_id = v_cap and target_type = 'person' and verification_status = 'confirmed';
  if n <> 0 then raise exception 'FAIL d: 사람이 확정되었다'; end if;
  v_out := v_out || 'd(사람 확정 안 됨) ';

  -- ── e. 업무 승인(정의자 통로) · 직접 넣기 거부 ──
  select review_id into v_rv from public.memory_review_queue where capture_id = v_cap and review_type = 'task_candidate';
  v_r := public.memory_review_resolve(v_rv, 'confirm', '{}'::jsonb);
  if not (v_r ->> 'created')::boolean then raise exception 'FAIL e: 업무가 안 생겼다 %', v_r; end if;
  begin
    insert into public.tasks (task_id, project_id, title) values ('staging_0088_direct', v_proj, '직접');
    raise exception 'FAIL e: 대표가 tasks에 직접 넣었다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  v_out := v_out || 'e(업무 승인 · 정의자 통로) ';

  -- ── f. 검색 ──
  select count(*) into n from public.memory_search('A회사', null, null, null, null, null, 30);
  if n < 1 then raise exception 'FAIL f: 검색 0건'; end if;
  v_out := v_out || 'f(검색) ';

  -- ── j. 원본 고치기 거부(사람 세션은 update grant 없음) ──
  begin
    update public.memory_captures set raw_text = '고침' where capture_id = v_cap;
    raise exception 'FAIL j: 원본이 고쳐졌다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  -- ── g. 사원 0 · 거부 ──
  update public.user_profiles set role = 'Member', status = 'active' where user_id = v_member;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select count(*) into n from public.memory_captures;
  if n <> 0 then raise exception 'FAIL g: 사원이 기록 %줄을 본다', n; end if;
  select count(*) into n from public.memory_items;
  if n <> 0 then raise exception 'FAIL g: 사원이 정보를 본다'; end if;
  select count(*) into n from public.memory_search('A회사', null, null, null, null, null, 30);
  if n <> 0 then raise exception 'FAIL g: 사원 검색 결과'; end if;
  select count(*) into n from public.audit_log where entity_table like 'memory%';
  if n <> 0 then raise exception 'FAIL g: 사원이 기억 감사 줄을 본다'; end if;
  begin
    v_cap2 := public.memory_capture_save('staging-0088-member', 'note', null, '몰래', null, 'quick_capture', '{}'::jsonb);
    raise exception 'FAIL g: 사원이 저장했다';
  exception when others then
    if sqlerrm not like '%memory_denied%' then raise exception 'FAIL g: 거부 문장(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'g(사원 0 · 거부) ';

  -- ── h. AI Agent 0 ──
  if v_agent is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_agent::text, true);
    set local role authenticated;
    select count(*) into n from public.memory_captures;
    if n <> 0 then raise exception 'FAIL h: AI Agent가 기록을 본다'; end if;
    reset role;
    v_out := v_out || 'h(AI Agent 0) ';
  else
    v_out := v_out || 'h(AI Agent 계정 없음 — 건너뜀) ';
  end if;

  -- ── i. anon ──
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    select count(*) into n from public.memory_captures;
    raise exception 'FAIL i: anon이 읽었다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  v_out := v_out || 'i(anon 거부) j(원본 고치기 거부)';

  raise exception '0088 STAGING PASS %', v_out;
end
$t$;
