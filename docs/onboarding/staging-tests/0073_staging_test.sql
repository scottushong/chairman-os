-- =====================================================================
-- 0073 staging 검사(기능 스위치) — 쓰지 않는다.
-- 0073이 **적용된 뒤** staging에서 돌린다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0073 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다
-- (시험 스위치 줄 · 바꾼 기본 줄 · 감사 모두). 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(staging에 link된 checkout 루트에서, 상대 경로로):
--   cd ~/projects/chairman-os-next
--   cp docs/onboarding/staging-tests/0073_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0073_staging_test.sql"
--   rm -f supabase/.temp/0073_staging_test.sql
-- 기대: ERROR  0073 STAGING PASS a(…) b(…) c(…) d(…) e(anon 거부)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 사람(id를 박지 않는다): 회장 · rehearsal.member@example.com(이 시험 안에서만 DY 사원).
-- =====================================================================
begin;

do $t$
declare
  v_chair  uuid;
  v_member uuid;
  v_out    text := '';
  n        int;
  v_on     boolean;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_member from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  if v_chair is null or v_member is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 사원(%)', v_chair, v_member;
  end if;
  update public.user_profiles set role = 'Member', status = 'active' where user_id = v_member;
  insert into public.user_business_access (user_id, business_id) values (v_member, 'biz_dy') on conflict do nothing;
  select count(*) into n from public.feature_switches where business_id is null;
  if n < 10 then raise exception 'FAIL 준비: 그룹 기본 줄이 %개(10개 이상이어야)', n; end if;

  -- ── a. 기본값: 입구는 대표만 · AI 보강은 전원 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select count(*) into n from public.feature_switches;
  if n < 10 then raise exception 'FAIL a: 사원이 스위치 표를 못 읽는다(%)', n; end if;
  if public.feature_on('intake', 'biz_dy') then raise exception 'FAIL a: 사원에게 입구(기본 대표만)가 열렸다'; end if;
  if not public.feature_on('ai_assist', 'biz_dy') then raise exception 'FAIL a: 사원에게 AI 보강(기본 전원)이 꺼져 있다'; end if;
  reset role;
  v_out := v_out || 'a(기본: 입구 사원 꺼짐 · AI 보강 사원 켜짐) ';

  -- ── b. 사원은 못 바꾼다 · 표에 직접 못 쓴다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  begin
    perform public.feature_switch_set('intake', 'biz_dy', true, 'all', '사원 시험');
    raise exception 'FAIL b: 사원이 스위치를 바꿨다';
  exception when others then
    if sqlerrm not like '%feature_switch_denied%' then raise exception 'FAIL b: 사원 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  begin
    update public.feature_switches set audience = 'all' where feature_key = 'intake';
    raise exception 'FAIL b: 사원이 표를 직접 고쳤다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'b(사원 바꾸기 · 직접 쓰기 거부) ';

  -- ── c. 대표: 이유 필수 → DY만 전원으로 → 사원 DY 켜짐 · 그룹 꺼짐 · 감사 한 줄 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  begin
    perform public.feature_switch_set('intake', 'biz_dy', true, 'all', ' ');
    raise exception 'FAIL c: 이유 없이 바꿨다';
  exception when others then
    if sqlerrm not like '%feature_switch_reason%' then raise exception 'FAIL c: 이유 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  perform public.feature_switch_set('intake', 'biz_dy', true, 'all', '0073 staging 시험');
  reset role;
  select count(*) into n from public.audit_log where entity_table = 'feature_switches' and after->>'reason' = '0073 staging 시험';
  if n <> 1 then raise exception 'FAIL c: 감사 줄이 %개', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  if not public.feature_on('intake', 'biz_dy') then raise exception 'FAIL c: DY 줄(전원)이 사원에게 안 열린다'; end if;
  if public.feature_on('intake', null) then raise exception 'FAIL c: DY 줄이 그룹 판정을 바꿨다'; end if;
  reset role;
  v_out := v_out || 'c(이유 필수 · DY 덮어쓰기 · 감사 1줄) ';

  -- ── d. 끄기: 대표에게도 꺼진다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.feature_switch_set('process_charts', null, false, 'all', '0073 staging 시험 끄기');
  v_on := public.feature_on('process_charts', null);
  if v_on then raise exception 'FAIL d: 끈 기능이 대표에게 켜져 있다'; end if;
  reset role;
  v_out := v_out || 'd(끄면 대표도 꺼짐) ';

  -- ── e. anon ──
  set local role anon;
  begin
    perform 1 from public.feature_switches limit 1;
    raise exception 'FAIL e: anon이 스위치 표를 읽었다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.feature_on('ai_assist', null);
    raise exception 'FAIL e: anon이 feature_on을 불렀다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'e(anon 거부)';

  raise exception '0073 STAGING PASS %', v_out;
end;
$t$;

rollback;
