-- =====================================================================
-- 0071 staging 검사(프로세스 차트 동기화) — 쓰지 않는다.
-- 0071이 **적용된 뒤** staging에서 돌린다. 진짜 구글을 부르지 않는다 — 앱 서버가 시트에서 읽었다고 치고 줄을 직접 넘긴다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0071 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다
-- (시험 팀 · 시험 탭 · 시트 줄 · 업무 · 프로젝트 · 동기화 기록 · 팀 배정 모두).
-- 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(staging에 link된 checkout 루트에서, 상대 경로로):
--   cd ~/projects/chairman-os-pchart
--   cp docs/onboarding/staging-tests/0071_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0071_staging_test.sql"
--   rm -f supabase/.temp/0071_staging_test.sql
-- 기대: ERROR  0071 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(…) h(…) i(…) j(…) k(…) g(…)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 사람(id를 박지 않는다): 회장 · AI Agent(역할로 찾는다) · rehearsal.member@example.com(시험 팀 팀원) ·
-- rehearsal.staff@example.com(다른 팀 팀원).
-- =====================================================================
begin;

do $t$
declare
  v_chair  uuid;
  v_agent  uuid;
  v_member uuid;
  v_staff  uuid;
  v_chart  bigint;
  v_res    jsonb;
  v_rows   jsonb;
  v_task   text;
  v_chart_b bigint;
  v_other  text;
  v_out    text := '';
  n int;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select p.user_id into v_agent from public.user_profiles p where p.role::text = 'AIAgent' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_member from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  select u.id into v_staff from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  if v_chair is null or v_agent is null or v_member is null or v_staff is null then
    raise exception 'FAIL 준비: 회장(%) · AI Agent(%) · 리허설 사원(%) · 리허설 직원(%)', v_chair, v_agent, v_member, v_staff;
  end if;

  -- 준비: 시험 팀 하나(대표 세션 — teams는 FORCE라 마이그레이션 세션으로는 못 넣는다) · 시험 탭 · 팀 배정.
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  insert into public.teams (team_id, business_id, name, name_en) values ('team_dy_stg71', 'biz_dy', '스테이징시험71', 'Staging 71');
  insert into public.process_charts (business_id, team_name, title, embed_url, sort_order, updated_by, sheet_id)
  values ('biz_dy', '스테이징시험71', '스테이징 시험 탭',
          'https://docs.google.com/spreadsheets/d/e/2PACX-staging71test/pubhtml', 999, v_chair, repeat('s', 30))
  returning id into v_chart;
  reset role;
  select count(*) into n from public.process_charts where id = v_chart and team_id = 'team_dy_stg71';
  if n <> 1 then raise exception 'FAIL 준비: 저장 트리거가 team_id를 채우지 않았다'; end if;
  update public.user_profiles set team_id = 'team_dy_stg71' where user_id = v_member;
  update public.user_profiles set team_id = null where user_id = v_staff;

  -- ── a. 보기: 시험 팀원은 그 탭을 본다 · 다른 팀원은 못 본다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select count(*) into n from public.process_charts where id = v_chart;
  if n <> 1 then raise exception 'FAIL a: 팀원이 자기 팀 탭을 못 본다'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  select count(*) into n from public.process_charts where id = v_chart;
  if n <> 0 then raise exception 'FAIL a: 다른 팀원이 시험 탭을 본다'; end if;
  reset role;
  v_out := v_out || 'a(자기 팀만) ';

  -- ── b. 사람은 동기화 함수를 못 부른다(가짜 줄 막기) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  begin
    perform public.process_chart_sync_apply(v_chart, 'button', v_member, 1, 0, '[]'::jsonb,
      '[{"id":"X","title":"가짜","status":"예정"}]'::jsonb);
    raise exception 'FAIL b: 팀원이 동기화 함수로 줄을 넣었다';
  exception when others then
    if sqlerrm not like '%process_sync_forbidden%' then raise exception 'FAIL b: %', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'b(사람 거부) ';

  -- ── c. AI Agent가 넣는다: 새 줄 3 · 담당자 못 찾음 경고 · 출처 · 캘린더 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  v_rows := '[
    {"id":"S71-1","stage":"접수","title":"스테이징 업무 1","email":"Rehearsal.Member@example.com","start":"2026-10-12","due":"2026-10-15","status":"진행","note":""},
    {"id":"S71-2","stage":"검토","title":"스테이징 업무 2","email":"nobody-71@example.invalid","start":null,"due":"2026-10-20","status":"예정","note":"메모"},
    {"id":"S71-3","stage":"","title":"스테이징 업무 3","email":"","start":null,"due":null,"status":"보류","note":""}
  ]'::jsonb;
  v_res := public.process_chart_sync_apply(v_chart, 'button', v_member, 5, 2,
    '[{"row":4,"id":null,"message":"ID 없음"},{"row":5,"id":"S71-9","message":"날짜 형식"}]'::jsonb, v_rows);
  if (v_res ->> 'new')::int <> 3 or (v_res ->> 'gone')::int <> 0 then raise exception 'FAIL c: 첫 동기화 %', v_res; end if;
  -- 경고 = 앱 2 + 담당 미정 2(못 찾음 · 비어 있음)
  if (v_res ->> 'warnings')::int <> 4 then raise exception 'FAIL c: 경고 수 %', v_res; end if;
  begin
    perform public.process_chart_sync_apply(v_chart, 'button', v_member, 3, 0, '[]'::jsonb, v_rows);
    raise exception 'FAIL c: 1분 안에 두 번째 동기화가 됐다';
  exception when others then
    if sqlerrm not like '%process_sync_too_soon%' then raise exception 'FAIL c: %', sqlerrm; end if;
  end;
  reset role;
  select count(*) into n from public.tasks t join public.process_chart_items i on i.task_id = t.task_id
   where i.chart_id = v_chart and t.source_label = '프로세스 차트 · 스테이징시험71';
  if n <> 3 then raise exception 'FAIL c: 업무 %건(3이어야)', n; end if;
  select count(*) into n from public.tasks t join public.process_chart_items i on i.task_id = t.task_id
   where i.chart_id = v_chart and i.sheet_row_id = 'S71-1' and t.owner_user_id = v_member and t.status::text = 'Doing' and t.deadline = date '2026-10-15';
  if n <> 1 then raise exception 'FAIL c: S71-1 담당 · 상태 · 마감이 틀렸다'; end if;
  select count(*) into n from public.process_chart_items where chart_id = v_chart and sheet_row_id = 'S71-2' and owner_user_id is null;
  if n <> 1 then raise exception 'FAIL c: 못 찾은 담당자가 «담당 미정»이 아니다'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select count(*) into n from public.calendar_items where kind = 'process' and title like '%스테이징 업무%';
  if n <> 2 then raise exception 'FAIL c: 팀원 캘린더에 프로세스 줄 %개(날짜 있는 2)', n; end if;
  select count(*) into n from public.process_chart_syncs where chart_id = v_chart and actor_user_id = v_member and ok;
  if n <> 1 then raise exception 'FAIL c: 팀원이 동기화 기록을 % 줄 본다', n; end if;
  reset role;
  v_out := v_out || 'c(새 3 · 담당 미정 경고 · 캘린더 2 · 1분 제한) ';

  -- ── d. 같은 줄로 두 번 — 늘지 않는다 ──
  update public.process_chart_syncs set synced_at = synced_at - interval '2 minutes' where chart_id = v_chart;
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  v_res := public.process_chart_sync_apply(v_chart, 'cron', null, 3, 0, '[]'::jsonb, v_rows);
  reset role;
  if (v_res ->> 'new')::int <> 0 or (v_res ->> 'changed')::int <> 0 or (v_res ->> 'gone')::int <> 0 then
    raise exception 'FAIL d: 같은 줄 두 번째 %', v_res;
  end if;
  select count(*) into n from public.process_chart_items where chart_id = v_chart;
  if n <> 3 then raise exception 'FAIL d: 시트 줄이 %개로 늘었다', n; end if;
  select count(*) into n from public.process_chart_syncs where chart_id = v_chart and actor_user_id is null and trigger = 'cron';
  if n <> 1 then raise exception 'FAIL d: 자동 동기화 기록이 %줄', n; end if;
  v_out := v_out || 'd(두 번 넣어도 3 · 자동 기록) ';

  -- ── e. 바뀐 줄 · 사라진 줄 ──
  update public.process_chart_syncs set synced_at = synced_at - interval '2 minutes' where chart_id = v_chart;
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  v_res := public.process_chart_sync_apply(v_chart, 'open', v_member, 2, 0, '[]'::jsonb, '[
    {"id":"S71-1","stage":"접수","title":"스테이징 업무 1","email":"rehearsal.member@example.com","start":"2026-10-12","due":"2026-10-15","status":"완료","note":""},
    {"id":"S71-3","stage":"","title":"스테이징 업무 3","email":"","start":null,"due":null,"status":"보류","note":""}
  ]'::jsonb);
  reset role;
  if (v_res ->> 'new')::int <> 0 or (v_res ->> 'changed')::int <> 1 or (v_res ->> 'gone')::int <> 1 then
    raise exception 'FAIL e: 바뀜 1 · 사라짐 1이 아니다 %', v_res;
  end if;
  select count(*) into n from public.process_chart_items where chart_id = v_chart;
  if n <> 3 then raise exception 'FAIL e: 사라진 줄을 지웠다(%줄)', n; end if;
  select i.task_id into v_task from public.process_chart_items i where i.chart_id = v_chart and i.sheet_row_id = 'S71-2' and i.gone_at is not null;
  if v_task is null then raise exception 'FAIL e: S71-2에 «시트에서 사라짐»이 없다'; end if;
  select count(*) into n from public.tasks where task_id = v_task and source_gone_at is not null;
  if n <> 1 then raise exception 'FAIL e: 사라진 줄의 업무에 표시가 없다'; end if;
  select count(*) into n from public.tasks t join public.process_chart_items i on i.task_id = t.task_id
   where i.chart_id = v_chart and i.sheet_row_id = 'S71-1' and t.status::text = 'Done';
  if n <> 1 then raise exception 'FAIL e: S71-1 상태가 완료로 안 바뀌었다'; end if;
  v_out := v_out || 'e(바뀜 1 · 사라짐 1 · 지우지 않음) ';

  -- ── f. 시트에서 온 업무는 앱에서 못 고친다(담당자 본인이어도) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  with u as (
    update public.tasks set status = 'Todo'
     where task_id = (select i.task_id from public.process_chart_items i where i.chart_id = v_chart and i.sheet_row_id = 'S71-1')
    returning 1
  ) select count(*) into n from u;
  reset role;
  if n <> 0 then raise exception 'FAIL f: 담당자가 시트 업무를 앱에서 고쳤다'; end if;
  v_out := v_out || 'f(앱 수정 0행) ';

  -- ── h. 리뷰 B: 담당 미정 시트 업무는 다른 팀 사람에게 안 보인다 · 같은 팀은 본다 · AI Agent는 0 ──
  update public.user_profiles set team_id = 'team_dy_sales' where user_id = v_staff;
  select i.task_id into v_task from public.process_chart_items i where i.chart_id = v_chart and i.sheet_row_id = 'S71-3';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  select count(*) into n from public.tasks where task_id = v_task;
  reset role;
  if n <> 0 then raise exception 'FAIL h: 다른 팀 사람이 담당 미정 시트 업무를 본다'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select count(*) into n from public.tasks where task_id = v_task;
  reset role;
  if n <> 1 then raise exception 'FAIL h: 같은 팀 사람이 담당 미정 시트 업무를 못 본다'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  select count(*) into n from public.tasks where source_label = '프로세스 차트 · 스테이징시험71';
  reset role;
  if n <> 0 then raise exception 'FAIL h: AI Agent가 시트 업무 %건을 읽는다', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select count(*) into n from public.tasks where source_label = '프로세스 차트 · 스테이징시험71';
  reset role;
  if n <> 3 then raise exception 'FAIL h: 대표가 시트 업무 %건을 본다(3이어야)', n; end if;
  v_out := v_out || 'h(담당 미정 업무 = 같은 팀만 · 대표 3 · AI Agent 0) ';

  -- ── i. 리뷰 C: 사람은 process_chart_visible_to(사람 id)를 못 부른다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  begin
    perform public.process_chart_visible_to(v_chair, 'biz_dy', '영업');
    raise exception 'FAIL i: 팀원이 process_chart_visible_to를 불렀다';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise exception 'FAIL i: 권한 거부가 아니라 %', sqlerrm;
  end;
  reset role;
  v_out := v_out || 'i(사람 id 판정 함수 거부) ';

  -- 준비: 두 번째 시험 탭(리뷰 A · 빈 시트용)
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  insert into public.teams (team_id, business_id, name, name_en) values ('team_dy_stg71b', 'biz_dy', '스테이징시험71B', 'Staging 71B');
  insert into public.process_charts (business_id, team_name, title, embed_url, sort_order, updated_by, sheet_id)
  values ('biz_dy', '스테이징시험71B', '스테이징 시험 탭 B',
          'https://docs.google.com/spreadsheets/d/e/2PACX-staging71testb/pubhtml', 998, v_chair, repeat('t', 30))
  returning id into v_chart_b;
  reset role;

  -- ── j. 리뷰 A: 같은 프로젝트 id가 다른 회사로 먼저 잡혀 있으면 넣지 않는다 ──
  select b.business_id into v_other from public.businesses b where b.business_id <> 'biz_dy' order by b.business_id limit 1;
  if v_other is null then raise exception 'FAIL 준비 j: biz_dy 말고 회사가 없다'; end if;
  insert into public.projects (project_id, business_id, name, status)
  values ('pc_biz_dy_' || substr(md5('스테이징시험71B'), 1, 10), v_other, '가로챈 프로젝트', 'Doing');
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  begin
    perform public.process_chart_sync_apply(v_chart_b, 'cron', null, 1, 0, '[]'::jsonb,
      '[{"id":"B-1","title":"가로채기 시험","status":"예정"}]'::jsonb);
    raise exception 'FAIL j: 다른 회사 프로젝트로 시트 업무가 들어갔다';
  exception when others then
    if sqlerrm not like '%process_sync_project_conflict%' then raise exception 'FAIL j: %', sqlerrm; end if;
  end;
  reset role;
  select count(*) into n from public.tasks where project_id = 'pc_biz_dy_' || substr(md5('스테이징시험71B'), 1, 10);
  if n <> 0 then raise exception 'FAIL j: 업무 %건이 남았다', n; end if;
  delete from public.projects where project_id = 'pc_biz_dy_' || substr(md5('스테이징시험71B'), 1, 10);
  v_out := v_out || 'j(다른 회사 프로젝트 거부) ';

  -- ── k. 빈 시트(넣을 줄 0)는 거부 — 업무를 «사라짐»으로 만들지 않는다 ──
  update public.process_chart_syncs set synced_at = synced_at - interval '2 minutes' where chart_id = v_chart;
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  begin
    perform public.process_chart_sync_apply(v_chart, 'cron', null, 0, 0, '[]'::jsonb, '[]'::jsonb);
    raise exception 'FAIL k: 빈 시트로 동기화가 됐다';
  exception when others then
    if sqlerrm not like '%process_sync_empty%' then raise exception 'FAIL k: %', sqlerrm; end if;
  end;
  perform public.process_chart_sync_fail(v_chart, 'cron', null, '빈 시트 경고(시험)');
  reset role;
  select count(*) into n from public.process_chart_items where chart_id = v_chart and gone_at is null;
  if n <> 2 then raise exception 'FAIL k: 빈 시트 뒤 시트에 있는 줄이 %개(2여야)', n; end if;
  select count(*) into n from public.process_chart_syncs where chart_id = v_chart and not ok and error like '빈 시트%';
  if n <> 1 then raise exception 'FAIL k: 빈 시트 경고 기록이 %줄', n; end if;
  v_out := v_out || 'k(빈 시트 거부 · 경고 기록) ';

  -- ── g. anon ──
  set local role anon;
  begin
    perform count(*) from public.process_chart_items;
    raise exception 'FAIL g: anon이 시트 줄을 읽었다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.process_chart_sync_targets();
    raise exception 'FAIL g: anon이 동기화 목록을 불렀다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  v_out := v_out || 'g(anon 거부)';

  raise exception '0071 STAGING PASS %', v_out;
end;
$t$;

rollback;
