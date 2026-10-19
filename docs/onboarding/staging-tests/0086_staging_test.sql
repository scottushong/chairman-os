-- =====================================================================
-- 0086 staging 검사(내 홈 위젯 배치) — 쓰지 않는다.
-- build-staging-dryrun.mjs --tests가 0086과 같은 트랜잭션에서 돌리고 끝에 되돌린다(이 파일만 돌릴 때도 끝은 raise exception).
--   node scripts/build-staging-dryrun.mjs 0086 0086 --tests
-- 사람(이 시험 안에서만): A = rehearsal.member@example.com · B = rehearsal.staff@example.com · 대표(스위치).
-- 기대: ERROR  0086 STAGING PASS a(스위치 기본 대표만) b(회사 줄) c(A 저장 · B 못 읽음) d(충돌) e(모양) f(직접 쓰기 없음) g(anon)
-- =====================================================================
do $t$
declare
  v_chair uuid;
  v_a     uuid;
  v_b     uuid;
  v_out   text := '';
  n       int;
  r       int;
  biz     text := 'biz_dy';
  w1      jsonb := '[{"id":"my_tasks","kind":"my_tasks","size":"m","settings":{"filter":"open"}},{"id":"approvals","kind":"approvals","size":"s","settings":{"filter":"todo"}}]';
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_a from auth.users u join public.user_profiles p on p.user_id = u.id where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  select u.id into v_b from auth.users u join public.user_profiles p on p.user_id = u.id where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  if v_chair is null or v_a is null or v_b is null then raise exception 'FAIL 준비: 대표(%) · A(%) · B(%)', v_chair, v_a, v_b; end if;
  insert into public.user_business_access (user_id, business_id) values (v_a, biz), (v_b, biz) on conflict do nothing;

  -- ── a. 기본 줄은 대표만 — A는 저장 못 한다 ──
  if not exists (select 1 from public.feature_switches where business_id is null and feature_key = 'home_widgets' and enabled and audience = 'chairman') then
    raise exception 'FAIL a: 기본 줄(home_widgets · 대표만)이 없다';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  begin
    perform public.home_layout_save(0, 1, w1);
    raise exception 'FAIL a: 스위치 기본(대표만)에서 직원이 저장';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'a(스위치 기본 대표만) ';

  -- ── b. 대표가 회사 줄을 켠다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.feature_switch_set('home_widgets', biz, true, 'all', 'staging 시험(되돌림)');
  reset role;
  v_out := v_out || 'b(회사 줄) ';

  -- ── c. A 저장 · A는 읽고 B는 못 읽는다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  select count(*) into n from public.home_layouts;
  if n <> 0 then raise exception 'FAIL c: 저장 전 A에게 줄 %개', n; end if;
  r := public.home_layout_save(0, 1, w1);
  if r <> 1 then raise exception 'FAIL c: 첫 판 %', r; end if;
  select count(*) into n from public.home_layouts where user_id = v_a and jsonb_array_length(widgets) = 2;
  if n <> 1 then raise exception 'FAIL c: A가 자기 배치를 못 읽는다'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  select count(*) into n from public.home_layouts;
  if n <> 0 then raise exception 'FAIL c: B가 A의 배치를 읽는다(%)', n; end if;
  r := public.home_layout_save(0, 1, '[]'::jsonb);
  if r <> 1 then raise exception 'FAIL c: B 첫 판 %', r; end if;
  reset role;
  v_out := v_out || 'c(A 저장 · B 못 읽음) ';

  -- ── d. 충돌 — 옛 판으로 저장하면 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  r := public.home_layout_save(1, 1, '[]'::jsonb);
  if r <> 2 then raise exception 'FAIL d: 두 번째 판 %', r; end if;
  begin
    perform public.home_layout_save(1, 1, w1);
    raise exception 'FAIL d: 옛 판(1)이 덮어썼다';
  exception when others then if sqlerrm <> 'home_conflict' then raise; end if;
  end;
  begin
    perform public.home_layout_save(0, 1, w1);
    raise exception 'FAIL d: 0으로 덮어썼다';
  exception when others then if sqlerrm <> 'home_conflict' then raise; end if;
  end;
  v_out := v_out || 'd(충돌) ';

  -- ── e. 모양 ──
  begin
    perform public.home_layout_save(2, 1, '{}'::jsonb);
    raise exception 'FAIL e: 배열 아님이 저장됐다';
  exception when others then if sqlerrm <> 'home_invalid' then raise; end if;
  end;
  begin
    perform public.home_layout_save(2, 1, '[{"id":"x","kind":"my_tasks","size":"xl"}]'::jsonb);
    raise exception 'FAIL e: 틀린 크기가 저장됐다';
  exception when others then if sqlerrm <> 'home_invalid' then raise; end if;
  end;
  v_out := v_out || 'e(모양) ';

  -- ── f. 표 직접 쓰기 없음 ──
  begin
    insert into public.home_layouts (user_id, widgets) values (v_b, '[]'::jsonb);
    raise exception 'FAIL f: A가 B 줄을 직접 넣었다';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.home_layouts set widgets = '[]'::jsonb;
    raise exception 'FAIL f: A가 표를 직접 고쳤다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'f(직접 쓰기 없음) ';

  -- ── g. anon ──
  set local role anon;
  begin
    perform 1 from public.home_layouts limit 1;
    raise exception 'FAIL g: anon이 표를 읽었다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.home_layout_save(0, 1, '[]'::jsonb);
    raise exception 'FAIL g: anon이 저장 함수를 불렀다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'g(anon)';

  raise exception '0086 STAGING PASS %', v_out;
end
$t$;
