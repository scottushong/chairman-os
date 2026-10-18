-- =====================================================================
-- 0082 자료 올리기 수신함 — 브라우저가 Storage로 바로 올리는 비공개 버킷 'fin-upload-inbox' (2026-10-16 업로드 단단히)
--
-- 왜: «회계 · 재무 자료 올리기»(0070)는 파일 바이트를 서버 액션 요청 몸통으로 받았다. Vercel 함수 요청 한도(4.5MB)를 넘는
--     파일(5MB 엑셀 · 15MB PDF)은 화면이 «파일당 20MB»라고 말하는데도 요청째 실패했다(운영 5b3922a 점검).
--     이제 브라우저가 이 버킷으로 바로 올리고, 서버 액션에는 경로만 보낸다. 서버는 사람 세션(RLS 안)으로 내려받아
--     처리한 뒤 지운다 — **원본 파일은 두지 않는 0070 설계 그대로**(대기에는 버리기 뒤 칸 격자만 남는다).
--
-- 경로 = '<business_id>/<auth.uid()>/<임의 이름>'. 읽기 · 올리기 · 지우기 모두 같은 규칙:
--   로그인 · 활성 · 사람(AIAgent · Integration 아님) · 둘째 칸이 본인 · can_keep_books(첫째 칸)(0047 — 장부를 쓰는 사람).
--   남의 폴더 · 다른 회사 · 장부 권한 없는 사람은 못 올리고 못 본다. 대표도 남의 폴더는 못 본다(남의 원본을 볼 길을 만들지 않는다).
--   update 정책은 없다(덮어쓰기 · 옮기기 없음). 크기 20MB(실제 Supabase에만 있는 칸 — PGlite 흉내에는 없다).
-- 표 · RPC · 0070 판정은 바꾸지 않는다. 버킷 하나 · 함수 하나 · 정책 셋.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('fin-upload-inbox', 'fin-upload-inbox', false)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'fin-upload-inbox' and public) then
    raise exception 'fin-upload-inbox 버킷이 공개로 설정되어 있다. 0082의 전제(비공개)가 깨진다 — 콘솔에서 비공개로 되돌린 뒤 다시 적용한다.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$ update storage.buckets set file_size_limit = 20971520 where id = 'fin-upload-inbox' $q$;
  end if;
end $$;

-- 객체 이름 → 이 사람의 수신함 자리인가. plpgsql + invoker(0045 attachment_object_visible과 같은 까닭 — anon은 첫 줄에서 false로 나간다).
-- can_keep_books는 definer(0047)라 invoker 안에서 불러도 된다.
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

comment on function fin_inbox_object_ok(text) is
  '0082. 자료 올리기 수신함 객체 «<회사>/<본인 uid>/<이름>» — 본인 폴더 · 장부를 쓰는 사람(can_keep_books)만. 읽기 · 올리기 · 지우기 공통.';

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
