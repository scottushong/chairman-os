-- =====================================================================
-- 0097 staging 검사(구역 배치 — 판 2 저장 · 0086 호환 · 종류 문 · 본인만 · 충돌) — 쓰지 않는다.
-- build-staging-dryrun.mjs 0097 0097 --tests가 0097과 같은 트랜잭션에서 돌리고 끝에 되돌린다.
-- 사람(이 시험 안에서만 만들고 되돌림): 직원(Member, biz_dy) + 실제 대표.
-- 기대: ERROR  0097 STAGING PASS a(대표 판 2) b(0086 호환) c(직원 재무 · 투자 거부) d(직원 저장) e(본인만) f(표 직접 쓰기 없음) g(충돌)
-- =====================================================================
do $t$
declare
  v_chair uuid;
  v_staff uuid := '00000000-0000-0000-0000-0000009701a1';
  v_out   text := '';
  v_rev   int;
  r       record;
  n       int;
  ok      boolean;
  i       int;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  if v_chair is null then raise exception 'FAIL 준비: 대표 없음'; end if;
  insert into auth.users (id, email) values (v_staff, 'dryrun97-staff@example.com');
  insert into public.user_profiles (user_id, role, display_name, max_security_class) values (v_staff, 'Member', '직원97', 'Normal');
  insert into public.user_business_access (user_id, business_id) values (v_staff, 'biz_dy') on conflict do nothing;

  -- a. 대표 — 기본 구역 넷(재무 · 투자 · 아침 루틴 포함) 판 2
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select coalesce((select revision from public.home_layouts where user_id = v_chair), 0) into v_rev;
  v_rev := public.home_layout_save_sections(v_rev, '[
    {"id":"today","title":"오늘의 경영","scope":{"biz":"all"},"widgets":[{"id":"ai_judgment","kind":"ai_judgment","size":"m","settings":{}},{"id":"approvals","kind":"approvals","size":"s","settings":{"filter":"todo"}}]},
    {"id":"finance","title":"재무 지표","scope":{"biz":"biz_dy"},"widgets":[{"id":"fin_kpis","kind":"fin_kpis","size":"l","settings":{}}]},
    {"id":"invest","title":"투자","widgets":[{"id":"inv_kpis","kind":"inv_kpis","size":"l","settings":{}}]}
  ]'::jsonb);
  select schema_version, widgets, jsonb_array_length(sections) as ns into r from public.home_layouts where user_id = v_chair;
  if r.schema_version <> 2 or r.widgets <> '[]'::jsonb or r.ns <> 3 then raise exception 'FAIL a: 판 2 줄 모양 %', row_to_json(r); end if;
  v_out := v_out || 'a(대표 판 2) ';

  -- b. 직전 코드(0086 home_layout_save) — 같은 줄에 판 1로 쓴다 · revision 하나로 오른다
  if public.home_layout_save(v_rev, 1, '[{"id":"my_tasks","kind":"my_tasks","size":"m","settings":{}}]'::jsonb) <> v_rev + 1 then raise exception 'FAIL b: 0086 저장 판'; end if;
  v_rev := v_rev + 1;
  perform public.feature_switch_set('home_widgets', 'biz_dy', true, 'all', 'staging 시험(되돌림)');
  reset role;
  v_out := v_out || 'b(0086 호환) ';

  -- c · d. 직원 — 재무 · 투자 · 대표 전용 위젯 거부, 직원 위젯은 저장
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  foreach i in array array[1, 2, 3] loop
    ok := false;
    begin
      perform public.home_layout_save_sections(0, format('[{"id":"main","title":"내 업무","widgets":[{"id":"x","kind":"%s","size":"s","settings":{}}]}]',
        (array['fin_kpis', 'inv_kpis', 'ai_judgment'])[i])::jsonb);
    exception when insufficient_privilege then ok := sqlerrm like 'home_kind_denied%';
    end;
    if not ok then raise exception 'FAIL c: 직원이 대표 위젯(%)을 저장했다', (array['fin_kpis', 'inv_kpis', 'ai_judgment'])[i]; end if;
  end loop;
  v_out := v_out || 'c(직원 재무 · 투자 거부) ';
  if public.home_layout_save_sections(0, '[{"id":"main","title":"내 업무 공간","widgets":[{"id":"my_tasks","kind":"my_tasks","size":"m","settings":{}},{"id":"projects","kind":"projects","size":"m","settings":{"scope":{"biz":"biz_dy"}}}]}]'::jsonb) <> 1 then
    raise exception 'FAIL d: 직원 첫 저장 판';
  end if;
  v_out := v_out || 'd(직원 저장) ';

  -- e. 본인만(직원이 대표 줄을 못 읽음)
  select count(*) into n from public.home_layouts where user_id = v_chair;
  if n <> 0 then raise exception 'FAIL e: 직원이 대표 배치를 읽는다'; end if;
  v_out := v_out || 'e(본인만) ';

  -- f. 표 직접 쓰기 없음
  ok := false;
  begin
    update public.home_layouts set sections = '[]'::jsonb;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL f: 표를 직접 고쳤다'; end if;
  v_out := v_out || 'f(표 직접 쓰기 없음) ';

  -- g. 충돌(다른 탭 — 옛 판)
  ok := false;
  begin
    perform public.home_layout_save_sections(0, '[]'::jsonb);
  exception when serialization_failure then ok := sqlerrm like 'home_conflict%';
  end;
  if not ok then raise exception 'FAIL g: 옛 판으로 덮어썼다'; end if;
  reset role;
  v_out := v_out || 'g(충돌)';

  raise exception '0097 STAGING PASS %', v_out;
end;
$t$;
