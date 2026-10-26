-- =====================================================================
-- 0098 staging 검사(화면 모양 칸 user_settings.ui_theme) — 쓰지 않는다.
-- build-staging-dryrun.mjs 0098 0098 --tests가 0098과 같은 트랜잭션에서 돌리고 끝에 되돌린다.
-- 사람(이 시험 안에서만 만들고 되돌림): 직원 A · B(Member).
-- 기대: ERROR  0098 STAGING PASS a(칸 null 허용 · 기본값 없음) b(직전 코드 저장) c(본인 저장 new/classic) d(모르는 값 거부) e(남의 줄 0행)
-- =====================================================================
do $t$
declare
  v_a   uuid := '00000000-0000-0000-0000-0000009801a1';
  v_b   uuid := '00000000-0000-0000-0000-0000009801b2';
  v_out text := '';
  r     record;
  n     int;
  ok    boolean;
begin
  insert into auth.users (id, email) values (v_a, 'dryrun98-a@example.com'), (v_b, 'dryrun98-b@example.com');
  insert into public.user_profiles (user_id, role, display_name, max_security_class) values
    (v_a, 'Member', '직원98A', 'Normal'), (v_b, 'Member', '직원98B', 'Normal');

  -- a. 칸 모양
  select is_nullable, column_default into r from information_schema.columns
   where table_schema = 'public' and table_name = 'user_settings' and column_name = 'ui_theme';
  if r.is_nullable is distinct from 'YES' or r.column_default is not null then raise exception 'FAIL a: 칸 모양 %', row_to_json(r); end if;
  v_out := v_out || 'a(칸 null 허용 · 기본값 없음) ';

  -- b. 직전 코드 — ui_theme 없이 upsert (본인)
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  insert into public.user_settings (user_id, app_prefs) values (v_a, '{"theme":"light"}'::jsonb)
    on conflict (user_id) do update set app_prefs = excluded.app_prefs;
  select ui_theme into r from public.user_settings where user_id = v_a;
  if r.ui_theme is not null then raise exception 'FAIL b: 직전 코드 저장 뒤 ui_theme %', r.ui_theme; end if;
  v_out := v_out || 'b(직전 코드 저장) ';

  -- c. 본인 저장
  update public.user_settings set ui_theme = 'classic' where user_id = v_a;
  update public.user_settings set ui_theme = 'new' where user_id = v_a;
  select ui_theme into r from public.user_settings where user_id = v_a;
  if r.ui_theme is distinct from 'new' then raise exception 'FAIL c: 본인 저장 %', r.ui_theme; end if;
  v_out := v_out || 'c(본인 저장 new/classic) ';

  -- d. 모르는 값
  ok := false;
  begin
    update public.user_settings set ui_theme = 'dark' where user_id = v_a;
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL d: 모르는 값이 들어간다'; end if;
  v_out := v_out || 'd(모르는 값 거부) ';

  -- e. 직원 B는 A의 줄을 못 읽고 못 바꾼다
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  select count(*) into n from public.user_settings where user_id = v_a;
  if n <> 0 then raise exception 'FAIL e: 남의 줄 읽음 %', n; end if;
  update public.user_settings set ui_theme = 'classic' where user_id = v_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL e: 남의 줄 바꿈 %', n; end if;
  v_out := v_out || 'e(남의 줄 0행)';
  reset role;

  raise exception '0098 STAGING PASS %', v_out;
end
$t$;
