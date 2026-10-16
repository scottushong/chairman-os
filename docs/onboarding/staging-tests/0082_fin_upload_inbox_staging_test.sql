-- =====================================================================
-- 0082 자료 올리기 수신함(fin-upload-inbox) staging 검사 — 쓰지 않는다(0082를 한 트랜잭션 안에서 적용해 보고 전부 되돌린다).
-- 끝은 언제나 raise exception(«0082 STAGING PASS …») — 버킷 · 함수 · 정책 · 시험 객체 모두 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/0082_fin_upload_inbox_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0082_fin_upload_inbox_staging_test.sql"
--   rm -f supabase/.temp/0082_fin_upload_inbox_staging_test.sql
-- 기대: ERROR  0082 STAGING PASS a(비공개 · 20MB) b(본인 폴더 올림 · 읽음) c(남의 폴더 거부) d(경로 모양 거부) e(장부 권한 없는 사람 거부 또는 «없음») f(update 0줄) g(지우기 본인)
-- 0082 본문은 supabase/migrations/0082_fin_upload_inbox.sql과 같다(아래 «0082 본문» 사이) — 파일을 고치면 여기도.
-- =====================================================================
begin;

-- ── 0082 본문 ──
insert into storage.buckets (id, name, public)
values ('fin-upload-inbox', 'fin-upload-inbox', false)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'fin-upload-inbox' and public) then
    raise exception 'fin-upload-inbox 버킷이 공개로 설정되어 있다.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$ update storage.buckets set file_size_limit = 20971520 where id = 'fin-upload-inbox' $q$;
  end if;
end $$;

create or replace function fin_inbox_object_ok(object_name text) returns boolean
language plpgsql stable security invoker set search_path = public as $fn$
declare
  v_parts text[];
begin
  if auth.uid() is null or not public.is_active() then
    return false;
  end if;
  if public.auth_role()::text in ('AIAgent', 'Integration') then
    return false;
  end if;
  v_parts := string_to_array(object_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 or v_parts[3] = '' or v_parts[1] !~ '^[a-z0-9_]{2,40}$' then
    return false;
  end if;
  if v_parts[2] <> auth.uid()::text then
    return false;
  end if;
  return public.can_keep_books(v_parts[1]);
end;
$fn$;

revoke all on function fin_inbox_object_ok(text) from public, anon;
grant execute on function fin_inbox_object_ok(text) to authenticated;

drop policy if exists fin_inbox_objects_read on storage.objects;
drop policy if exists fin_inbox_objects_insert on storage.objects;
drop policy if exists fin_inbox_objects_delete on storage.objects;
create policy fin_inbox_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'fin-upload-inbox' and public.fin_inbox_object_ok(name));
create policy fin_inbox_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fin-upload-inbox' and public.fin_inbox_object_ok(name));
create policy fin_inbox_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fin-upload-inbox' and public.fin_inbox_object_ok(name));
-- ── 0082 본문 끝 ──

do $t$
declare
  v_chair uuid;
  v_other uuid;
  v_out   text := '';
  n       int;
  v_pub   boolean;
  v_lim   bigint;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  if v_chair is null then raise exception 'FAIL 준비: 회장 없음'; end if;
  -- 장부 권한이 없을 사람(직원 · 팀장 중 재무 줄 없는 사람) — 없으면 e는 «없음»으로 적는다.
  select p.user_id into v_other from public.user_profiles p
   where p.role::text in ('Member', 'TeamLead') and p.revoked_at is null
     and not exists (select 1 from public.user_module_access g where g.user_id = p.user_id and g.module = '/finance/biz_dy' and g.can_write)
   order by p.created_at limit 1;

  -- a. 비공개 · 20MB
  select public, file_size_limit into v_pub, v_lim from storage.buckets where id = 'fin-upload-inbox';
  if v_pub is distinct from false then raise exception 'FAIL a: 버킷이 비공개가 아니다'; end if;
  if v_lim is distinct from 20971520 then raise exception 'FAIL a: 크기 한도 %', v_lim; end if;
  v_out := v_out || ' a(비공개 · 20MB)';

  -- b. 대표 — 본인 폴더 올림 · 읽음
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner) values ('fin-upload-inbox', 'biz_dy/' || v_chair || '/staging-test.xlsx', v_chair);
  select count(*) into n from storage.objects where bucket_id = 'fin-upload-inbox' and name = 'biz_dy/' || v_chair || '/staging-test.xlsx';
  if n <> 1 then raise exception 'FAIL b: 본인 파일을 못 읽는다(%)', n; end if;
  v_out := v_out || ' b(본인 폴더 올림 · 읽음)';

  -- c. 남의 폴더
  begin
    insert into storage.objects (bucket_id, name, owner) values ('fin-upload-inbox', 'biz_dy/00000000-0000-0000-0000-000000000001/x.xlsx', v_chair);
    raise exception 'FAIL c: 남의 폴더에 올렸다';
  exception when insufficient_privilege or check_violation then v_out := v_out || ' c(남의 폴더 거부)';
  end;

  -- d. 경로 모양
  begin
    insert into storage.objects (bucket_id, name, owner) values ('fin-upload-inbox', 'biz_dy/' || v_chair, v_chair);
    raise exception 'FAIL d: 두 칸 경로를 받았다';
  exception when insufficient_privilege or check_violation then v_out := v_out || ' d(경로 모양 거부)';
  end;

  -- f. update 정책 없음
  update storage.objects set name = 'biz_dy/' || v_chair || '/moved.xlsx' where bucket_id = 'fin-upload-inbox' and name = 'biz_dy/' || v_chair || '/staging-test.xlsx';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL f: 수신함 파일을 옮겼다'; end if;
  v_out := v_out || ' f(update 0줄)';

  -- e. 장부 권한 없는 사람
  reset role;
  if v_other is null then
    v_out := v_out || ' e(대상 직원 없음 — 건너뜀)';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_other::text, true);
    set local role authenticated;
    select count(*) into n from storage.objects where bucket_id = 'fin-upload-inbox';
    if n <> 0 then raise exception 'FAIL e: 직원이 남의 수신함을 본다(%)', n; end if;
    begin
      insert into storage.objects (bucket_id, name, owner) values ('fin-upload-inbox', 'biz_dy/' || v_other || '/x.xlsx', v_other);
      raise exception 'FAIL e: 장부 권한 없는 직원이 올렸다';
    exception when insufficient_privilege or check_violation then v_out := v_out || ' e(장부 권한 없는 사람 거부)';
    end;
    reset role;
  end if;

  -- g. 지우기 본인
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  -- 실제 Supabase는 storage 표 직접 delete를 막는다(storage.protect_delete — 지우기는 Storage API). 그래서 정책 판정만 본다.
  if not public.fin_inbox_object_ok('biz_dy/' || v_chair || '/staging-test.xlsx') then raise exception 'FAIL g: 본인 파일 지우기 판정이 거짓'; end if;
  if public.fin_inbox_object_ok('biz_dy/00000000-0000-0000-0000-000000000001/x.xlsx') then raise exception 'FAIL g: 남의 파일 지우기 판정이 참'; end if;
  reset role;
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fin_inbox_objects_delete' and cmd = 'DELETE';
  if n <> 1 then raise exception 'FAIL g: 지우기 정책이 없다'; end if;
  v_out := v_out || ' g(지우기 판정 본인만 · 정책 있음 — 직접 delete는 Supabase가 막아 API로)';

  raise exception '0082 STAGING PASS%', v_out;
end
$t$;

rollback;
