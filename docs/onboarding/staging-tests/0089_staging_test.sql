-- =====================================================================
-- 0089 staging 검사(재무 보강 — 열 맞춤 · 공식 결산 «다시 맞출 줄») — 쓰지 않는다.
-- build-staging-dryrun.mjs --tests가 0089와 같은 트랜잭션에서 돌리고 끝에 되돌린다(이 파일만 돌릴 때도 끝은 raise exception).
-- 사람(이 시험 안에서만): 대표(Chairman) · rehearsal.member@example.com(직원 — 그 회사 장부를 쓰지 않으면 거부를 본다).
-- 기대: ERROR  0089 STAGING PASS a(열 맞춤 저장 · 더하기) b(모양 거부) c(직원 거부) d(다시 맞출 줄 · 통째로 바꿈) e(밀려난 결산 거부) f(스위치 기본 줄) g(anon 0) h(옮김 기록 …) i(남의 폴더 읽기 …) j(받을 것 …)
-- j는 가짜 구글 키(FAKE — 진짜처럼 보이지 않음)를 Vault에 넣어 본다 — 같은 트랜잭션이 끝에 되돌리므로 staging Vault에는 남지 않는다.
-- =====================================================================
do $t$
declare
  v_chair uuid;
  v_m     uuid;
  v_out   text := '';
  v_sid   bigint;
  n       int;
  j       jsonb;
  biz     text := 'biz_dy';
  keep_m  boolean;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_m from auth.users u join public.user_profiles p on p.user_id = u.id where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  if v_chair is null then raise exception 'FAIL 준비: 대표가 없다'; end if;

  -- ── a. 대표가 열 맞춤 저장 → 다시 저장하면 더한다 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.fin_column_map_save(biz, 'sales', '{"매출액":"amount","매출처명":"customer"}'::jsonb, 'ai');
  perform public.fin_column_map_save(biz, 'sales', '{"판가":"unit_price","규격":"-"}'::jsonb, 'person');
  select label_map into j from public.fin_column_maps where business_id = biz and kind = 'sales';
  if j is null or j->>'매출액' <> 'amount' or j->>'판가' <> 'unit_price' or j->>'규격' <> '-' then raise exception 'FAIL a: 더하지 않았다 %', j; end if;
  v_out := v_out || 'a(열 맞춤 저장 · 더하기) ';

  -- ── b. 모양 거부 — 숫자 값 · 칸 이름 아님 · 모르는 종류 · 빈 맞춤 ──
  begin
    perform public.fin_column_map_save(biz, 'sales', '{"매출액":12}'::jsonb, 'ai');
    raise exception 'FAIL b: 숫자 값을 받았다';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.fin_column_map_save(biz, 'sales', '{"매출액":"Amount;drop"}'::jsonb, 'ai');
    raise exception 'FAIL b: 칸 이름 모양이 아닌 값을 받았다';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.fin_column_map_save(biz, 'payroll_people', '{"매출액":"amount"}'::jsonb, 'ai');
    raise exception 'FAIL b: 모르는 종류를 받았다';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.fin_column_map_save(biz, 'sales', '{}'::jsonb, 'ai');
    raise exception 'FAIL b: 빈 맞춤을 받았다';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.fin_column_maps (business_id, kind, label_map) values (biz, 'card', '{"x":"amount"}');
    raise exception 'FAIL b: 표에 직접 썼다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'b(모양 · 직접 쓰기 거부) ';

  -- ── c. 장부를 쓰지 않는 직원은 저장 · 읽기 못 함(staging에 리허설 직원이 있고 그 회사 장부 권한이 없을 때만) ──
  if v_m is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_m::text, true);
    set local role authenticated;
    keep_m := coalesce(public.can_keep_books(biz), false);
    if not keep_m then
      begin
        perform public.fin_column_map_save(biz, 'sales', '{"x":"amount"}'::jsonb, 'ai');
        raise exception 'FAIL c: 장부 권한 없는 직원이 저장했다';
      exception when insufficient_privilege then null;
      end;
      select count(*) into n from public.fin_column_maps where business_id = biz;
      if n <> 0 then raise exception 'FAIL c: 장부 권한 없는 직원이 열 맞춤 %줄을 읽었다', n; end if;
      v_out := v_out || 'c(직원 거부) ';
    else
      v_out := v_out || 'c(리허설 직원이 장부 권한 있음 — 건너뜀) ';
    end if;
    reset role;
  else
    v_out := v_out || 'c(리허설 직원 없음 — 건너뜀) ';
  end if;

  -- ── d. 공식 결산 «다시 맞출 줄» — 시험 결산(2091 · 이 트랜잭션 안에서만) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  insert into public.official_statements (business_id, period_kind, period_key, evidence_url, memo, created_by)
  values (biz, 'year', '2091', 'https://example.com/dryrun-0089', 'dryrun 0089', v_chair) returning id into v_sid;
  set local role authenticated;
  select public.official_unmatched_save(v_sid, '[{"std_key":"sga:가짜전기료","label":"29.가짜전기료","grp":"sga","printed":30,"from_code":"ZZ-SGA"},{"std_key":"sga:가짜잡비","label":"30.가짜잡비","grp":"sga","printed":20,"from_code":"ZZ-SGA"}]'::jsonb) into n;
  if n <> 2 then raise exception 'FAIL d: 두 줄이 아니다 %', n; end if;
  select public.official_unmatched_save(v_sid, '[{"std_key":"sga:가짜잡비","label":"30.가짜잡비","grp":"sga","printed":20,"from_code":"ZZ-SGA"}]'::jsonb) into n;
  select count(*) into n from public.official_unmatched_lines where statement_id = v_sid;
  if n <> 1 then raise exception 'FAIL d: 통째로 바꾸지 않았다 %', n; end if;
  begin
    perform public.official_unmatched_save(v_sid, '[{"std_key":"Bad","label":"x","printed":1,"from_code":"ZZ"}]'::jsonb);
    raise exception 'FAIL d: 모양이 틀린 열쇠를 받았다';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.official_unmatched_lines (statement_id, business_id, std_key, label, printed, from_code) values (v_sid, biz, 'sga:y', 'y', 1, 'ZZ-SGA');
    raise exception 'FAIL d: 다시 맞출 줄 표에 직접 썼다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'd(다시 맞출 줄 · 통째로 바꿈 · 모양 · 직접 쓰기 거부) ';

  -- ── e. 밀려난 결산에는 쓰지 못한다 ──
  update public.official_statements set superseded_at = now() where id = v_sid;
  set local role authenticated;
  begin
    perform public.official_unmatched_save(v_sid, '[]'::jsonb);
    raise exception 'FAIL e: 밀려난 결산에 저장했다';
  exception when invalid_parameter_value then null;
  end;
  reset role;
  v_out := v_out || 'e(밀려난 결산 거부) ';

  -- ── f. 기능 스위치 기본 줄 ──
  if not exists (select 1 from public.feature_switches where business_id is null and feature_key = 'finance_upload_ai' and enabled and audience::text = 'all') then
    raise exception 'FAIL f: finance_upload_ai 기본 줄이 없다';
  end if;
  v_out := v_out || 'f(스위치 기본 줄) ';

  -- ── g. anon — 새 함수 · 표 하나도 못 쓴다 ──
  set local role anon;
  begin
    perform public.fin_column_map_save(biz, 'sales', '{"x":"amount"}'::jsonb, 'ai');
    raise exception 'FAIL g: anon이 열 맞춤을 저장했다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.official_unmatched_lines limit 1;
    raise exception 'FAIL g: anon이 다시 맞출 줄을 읽었다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fin_legacy_import_mark(biz, 'inbox', 'x', 'saved', null, null);
    raise exception 'FAIL g: anon이 옮김 기록을 적었다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'g(anon 0) ';

  -- ── h. «예전 자료 가져오기» 옮김 기록 — 대표만 적고 읽음 · 같은 자리 두 번은 안 적힘 · 실패만 다시 · 모양 · 직원 거부 · 직접 쓰기 없음 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  if not public.fin_legacy_import_mark(biz, 'inbox', 'biz_dy/dryrun/0089-a.xlsx', 'saved', null, '시험') then raise exception 'FAIL h: 처음 기록을 못 적었다'; end if;
  if public.fin_legacy_import_mark(biz, 'inbox', 'biz_dy/dryrun/0089-a.xlsx', 'saved', null, '시험') then raise exception 'FAIL h: 같은 자리를 두 번 적었다'; end if;
  if not public.fin_legacy_import_mark(biz, 'inbox', 'biz_dy/dryrun/0089-b.xlsx', 'failed', null, '시험') then raise exception 'FAIL h: 실패 기록을 못 적었다'; end if;
  if not public.fin_legacy_import_mark(biz, 'inbox', 'biz_dy/dryrun/0089-b.xlsx', 'saved', null, '다시') then raise exception 'FAIL h: 실패를 새 결과로 못 바꿨다'; end if;
  select count(*) into n from public.fin_legacy_imports where business_id = biz and source_ref like 'biz_dy/dryrun/0089-%' and outcome = 'saved';
  if n <> 2 then raise exception 'FAIL h: 대표가 기록 %줄을 읽었다(2여야)', n; end if;
  begin
    perform public.fin_legacy_import_mark(biz, 'robot', 'x', 'saved', null, null);
    raise exception 'FAIL h: 모르는 원천을 받았다';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.fin_legacy_imports (business_id, source, source_ref, outcome) values (biz, 'inbox', 'direct', 'saved');
    raise exception 'FAIL h: 표에 직접 썼다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  if v_m is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_m::text, true);
    set local role authenticated;
    begin
      perform public.fin_legacy_import_mark(biz, 'inbox', 'biz_dy/dryrun/0089-c.xlsx', 'saved', null, null);
      raise exception 'FAIL h: 직원이 옮김 기록을 적었다';
    exception when insufficient_privilege then null;
    end;
    select count(*) into n from public.fin_legacy_imports;
    if n <> 0 then raise exception 'FAIL h: 직원이 옮김 기록 %줄을 읽었다', n; end if;
    reset role;
  end if;
  if not exists (select 1 from public.feature_switches where business_id is null and feature_key = 'finance_legacy_import' and enabled and audience::text = 'chairman') then
    raise exception 'FAIL h: finance_legacy_import 기본 줄이 없다';
  end if;
  v_out := v_out || 'h(옮김 기록 대표만 · 두 번 안 적힘 · 실패만 다시 · 모양 · 직원 거부 · 직접 쓰기 없음 · 스위치) ';

  -- ── i. 수신함 남의 폴더 읽기 — 대표 + 스위치 켬 = 보임 · 스위치 끔 = 안 보임 · 직원 = 안 보임 · 대표도 지우기 0 ──
  insert into storage.objects (bucket_id, name) values ('fin-upload-inbox', 'biz_dy/00000000-0000-0000-0000-0000000089ff/dryrun-0089.xlsx');
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'fin-upload-inbox' and name = 'biz_dy/00000000-0000-0000-0000-0000000089ff/dryrun-0089.xlsx';
  if n <> 1 then raise exception 'FAIL i: 대표 + 스위치 켬인데 남의 폴더 파일이 안 보인다(%)', n; end if;
  -- 지우기 정책이 없다(0 줄) — Supabase는 직접 지우기 자체도 막는다(42501). 둘 다 «못 지움».
  begin
    delete from storage.objects where bucket_id = 'fin-upload-inbox' and name = 'biz_dy/00000000-0000-0000-0000-0000000089ff/dryrun-0089.xlsx';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL i: 대표가 남의 수신함 파일을 지웠다'; end if;
  exception when insufficient_privilege then null;
  end;
  reset role;
  update public.feature_switches set enabled = false where business_id is null and feature_key = 'finance_legacy_import';
  set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'fin-upload-inbox' and name = 'biz_dy/00000000-0000-0000-0000-0000000089ff/dryrun-0089.xlsx';
  if n <> 0 then raise exception 'FAIL i: 스위치를 껐는데 대표가 남의 폴더를 본다'; end if;
  reset role;
  update public.feature_switches set enabled = true where business_id is null and feature_key = 'finance_legacy_import';
  if v_m is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_m::text, true);
    set local role authenticated;
    select count(*) into n from storage.objects where bucket_id = 'fin-upload-inbox' and name = 'biz_dy/00000000-0000-0000-0000-0000000089ff/dryrun-0089.xlsx';
    if n <> 0 then raise exception 'FAIL i: 직원이 남의 수신함 파일을 본다'; end if;
    reset role;
  end if;
  v_out := v_out || 'i(남의 폴더 읽기 — 대표 + 스위치 켬 보임 · 끔 안 보임 · 직원 안 보임 · 지우기 0) ';

  -- ── j. «받을 것»(5절 owner_inputs) — 대표만 · 모양 · 가짜 구글 키(FAKE)는 Vault에만(이 트랜잭션 안에서만 — 끝에 되돌림) · 응답 · 표에 본문 없음 · 직원 · anon 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.owner_input_mark('inventory_method', biz, '{"method":"total_avg","memo":"dryrun 0089"}'::jsonb);
  perform public.owner_input_mark('real_bom', biz, '{"rows":1}'::jsonb);
  begin
    perform public.owner_input_mark('inventory_method', biz, '{"method":"lifo"}'::jsonb);
    raise exception 'FAIL j: 모르는 방법을 받았다';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.owner_input_google_sa_save('{"type":"service_account","private_key":"FAKE-NOT-A-REAL-KEY-0089-DRYRUN-xxxxxxxxxxxxxxxxxxxx"');
    raise exception 'FAIL j: 깨진 JSON을 받았다';
  exception when invalid_parameter_value then null;
  end;
  select public.owner_input_google_sa_save('{"type":"service_account","project_id":"fake-project-0089","private_key_id":"FAKE0089","private_key":"-----BEGIN FAKE KEY-----\nFAKE-NOT-A-REAL-KEY-0089-DRYRUN\n-----END FAKE KEY-----\n","client_email":"fake-reader@fake-project-0089.iam.gserviceaccount.com"}') into j;
  if j::text ~ 'FAKE-NOT-A-REAL-KEY|private_key|BEGIN' or j->>'client_email' <> 'fake-reader@fake-project-0089.iam.gserviceaccount.com' then raise exception 'FAIL j: 응답에 키 본문이 있거나 이메일이 다르다'; end if;
  select count(*) into n from public.owner_inputs where scope in (biz, 'group') and item_key in ('inventory_method', 'real_bom', 'google_sa');
  if n <> 3 then raise exception 'FAIL j: 대표가 받을 것 %줄을 읽었다(3이어야)', n; end if;
  if exists (select 1 from public.owner_inputs where summary::text ~ 'FAKE-NOT-A-REAL-KEY|private_key|BEGIN') then raise exception 'FAIL j: 표에 키 본문이 있다'; end if;
  begin
    insert into public.owner_inputs (item_key, scope) values ('real_bom', 'biz_vana');
    raise exception 'FAIL j: 표에 직접 썼다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from vault.secrets limit 1;
    raise exception 'FAIL j: 대표 세션이 Vault를 직접 읽었다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  select count(*) into n from vault.secrets where name = 'google_sheets_sa';
  if n <> 1 then raise exception 'FAIL j: Vault에 google_sheets_sa가 한 개가 아니다(%)', n; end if;
  if v_m is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_m::text, true);
    set local role authenticated;
    begin
      perform public.owner_input_mark('inventory_method', biz, '{"method":"fifo"}'::jsonb);
      raise exception 'FAIL j: 직원이 받을 것을 적었다';
    exception when insufficient_privilege then null;
    end;
    select count(*) into n from public.owner_inputs;
    if n <> 0 then raise exception 'FAIL j: 직원이 받을 것 %줄을 읽었다', n; end if;
    reset role;
  end if;
  set local role anon;
  begin
    perform public.owner_input_google_sa_save('{}');
    raise exception 'FAIL j: anon이 구글 키를 올렸다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  if not exists (select 1 from public.feature_switches where business_id is null and feature_key = 'owner_inputs' and enabled and audience::text = 'chairman') then
    raise exception 'FAIL j: owner_inputs 기본 줄이 없다';
  end if;
  v_out := v_out || 'j(받을 것 — 대표만 · 모양 · 가짜 키 Vault에만 · 응답 · 표 본문 없음 · 직접 쓰기 · Vault 직접 읽기 거부 · 직원 · anon 거부 · 스위치)';

  raise exception '0089 STAGING PASS %', v_out;
end
$t$;
