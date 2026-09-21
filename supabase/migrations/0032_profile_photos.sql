-- =====================================================================
-- Chairman OS — 0032_profile_photos
-- 출처: docs/superpowers/specs/2026-09-20-incoming.md `## [Phase 5-E …]` 4절
--       "프로필: … 사진(Storage)" — 5-E가 '준비 중'으로 남겨 둔 것을 갚는다.
--
-- 0018_initiative_logos의 한 벌을 그대로 베꼈다: 비공개 버킷 하나, storage.objects의
-- 정책 넷(read/insert/update/delete), 그리고 경로만 저장하는 칸 하나.
-- **바꾼 것은 딱 두 가지이고 둘 다 '누가'에 대한 것이다.**
--
--   ① 누가 올리는가 — **본인 것만.**
--      0018은 역할로 물었다(can_write_initiatives() = Chairman·GroupCFO). 로고는 회사의
--      자산이라 그것이 맞다. 사진은 사람의 얼굴이고, 회장이라고 남의 얼굴을 바꾸지 않는다.
--      그래서 여기서는 역할이 아니라 **객체의 경로에 적힌 사람**으로 묻는다:
--      profile_photo_owner(name) = auth.uid().
--
--   ② 누가 보는가 — **이름이 보이는 사람과 같은 범위.**
--      0026이 user_profiles를 subtree로 잘랐다(본인 OR 회장 OR 내 subtree). 조직도에
--      이름이 안 보이는 사람의 얼굴이 보이면 그 자체가 새는 것이다. 반대로 이름은
--      보이는데 얼굴만 안 보이면 조직도가 반쪽이 된다.
--
--      **그 판정을 여기에 옮겨 적지 않는다.** 정책 안에서 user_profiles를 한 번 읽는
--      것이 곧 판정이다 — 그 읽기에 0026의 user_profiles_self_read가 그대로 걸린다.
--      가시성 식을 복사해 오면 언젠가 0026 쪽만 고쳐지고 이쪽이 남아, 이름은 사라졌는데
--      얼굴은 남는 창이 열린다. (0026 3절이 shares의 insert에 쓴 것과 같은 수법이다.)
--
-- 왜 Storage인가 — CLAUDE.md는 '링크만 보관한다'고 했는데
--   그 원칙은 Vault 문서(계약서·실사 자료)의 **파일 실체**에 대한 것이다. 프로필 사진은
--   Vault 문서가 아니다 — 수십 KB짜리 얼굴 사진이고, 사내 스토리지에 올려 링크를 손으로
--   붙여 넣으라고 하면 아무도 사진을 넣지 않는다. 0018이 로고에 대해 내린 판단과 같고,
--   판단이 바뀌면 이 마이그레이션 하나만 되돌린다.
--
-- 왜 비공개인가
--   얼굴 사진은 개인정보다. 공개 버킷은 경로만 알면 로그인 없이 열리고, 이 버킷의 경로는
--   `<user_id>/photo`라 **user_id만 알면 맞힐 수 있다.** 비공개 + RLS + 볼 때마다
--   요청자 세션으로 서명 URL(만료 1시간)이다.
--
-- 하지 않는 것
--   * **URL을 저장하지 않는다.** user_profiles.photo_path에는 버킷 안 경로만 들어간다.
--     비공개 버킷이라 영구 URL이라는 것이 아예 없다(0018 1절과 같은 이유).
--   * **새 force row level security 없음.** 0023·0027·0029·0030이 네 번 만난 함정이다.
--   * **user_profiles에 self-update 정책을 얹지 않는다.** 정책은 행을 고르지 칸을 고르지
--     못해서, 그것을 얹으면 본인이 자기 role과 revoked_at도 고칠 수 있다(0030 4절).
--     좁은 구멍 하나(update_own_photo)만 문으로 둔다.
--   * **새 audit_action 값 없음.** 사진 교체는 기존 'update'다.
--
-- 왜 0031이 아니라 0032인가
--   블록 7과 프로필 사진은 서로 다른 딜리버러블이고 커밋이 따로다. 한 파일에 넣으면 앞
--   커밋이 뒤 커밋의 SQL을 이미 들고 있게 되고, 블록 7만 staging에 올리는 선택지가 사라진다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 경로 칸
--    이름은 photo_path다. 0018이 logo_url이라고 지은 것과 달리 **'url'을 쓰지 않았다** —
--    저 이름은 그때도 값과 어긋나 있었고(들어가는 값은 경로다) 주석 한 줄로 그것을
--    설명해야 했다. 새로 짓는 칸까지 같은 오해를 물려받을 이유가 없다.
--
--    한 사람에 객체 하나다(경로가 user_id로 정해진다) — 다시 올리면 덮어쓰고 고아 객체가
--    안 생긴다. 확장자를 붙이지 않는 이유도 0018과 같다: PNG→JPG로 바꾸면 경로가 달라져
--    옛 객체가 고아로 남는다. 서명 URL은 저장된 content-type으로 나간다.
-- ---------------------------------------------------------------------
alter table user_profiles
  add column photo_path text;   -- [제한] 이름이 보이는 범위에서 같이 보인다

comment on column user_profiles.photo_path is
  'profile-photos 버킷 안의 객체 경로(<user_id>/photo). 공개 URL이 아니다 — 비공개 버킷이라 볼 때마다 서명 URL을 발급한다. null이면 화면이 이름 첫 글자 배지로 떨어진다.';

-- ---------------------------------------------------------------------
-- 2. 비공개 버킷 (0018 2절을 그대로)
--
--    이미 있으면 건드리지 않는다. public을 false로 되돌리지도 않는다 — 누가 콘솔에서
--    공개로 바꿔 뒀다면 그건 사람이 내린 결정이고, 이 파일이 조용히 뒤집으면 왜 바뀌었는지
--    아무도 모른다. 대신 그 상태로는 적용을 멈춘다(경고만 찍고 넘어가면 '비공개다'라는
--    이 파일 전체의 전제가 깨진 채로 기능이 살아 커밋된다).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'profile-photos' and public) then
    raise exception 'profile-photos 버킷이 공개로 설정되어 있다. 0032의 전제(비공개)가 깨진다 — '
      '경로가 <user_id>/photo라 user_id만 알면 로그인 없이 얼굴을 열 수 있다. '
      '콘솔에서 버킷을 비공개로 되돌린 뒤 이 마이그레이션을 다시 적용한다.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. 경로에서 사람을 읽는다
--
--    객체 이름은 '<user_id>/photo'다. 정책 넷이 전부 이 값을 묻는다.
--
--    **immutable이고 예외를 안 던진다.** 정책 안에서 도는 함수라, 모양이 어긋난 이름
--    하나(콘솔에서 손으로 올린 파일, 옛 이름) 때문에 22P02로 터지면 그 버킷의 모든
--    질의가 죽는다. 모양이 아니면 null이고, null은 아래 네 정책 어디에서도 통과하지
--    않는다 — '모르는 이름의 객체는 아무도 못 본다'가 기본값이다.
--
--    정규식으로 먼저 거른다. ::uuid 캐스트는 '0-0-0-0-0'처럼 하이픈만 맞아도 통과하는
--    느슨한 파서가 아니라서, 캐스트 전에 모양을 못 박아야 예외가 안 난다.
-- ---------------------------------------------------------------------
create or replace function profile_photo_owner(object_name text) returns uuid
language sql immutable set search_path = public as $fn$
  select case
    when object_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/photo$'
      then split_part(object_name, '/', 1)::uuid
    else null
  end;
$fn$;

comment on function profile_photo_owner(text) is
  '블록 7 후속(프로필 사진). profile-photos 버킷의 객체 이름에서 주인을 읽는다. 모양이 어긋나면 null이고, null은 네 정책 어디에서도 통과하지 않는다 — 모르는 이름의 객체는 아무도 못 본다.';

revoke all on function profile_photo_owner(text) from public;
grant execute on function profile_photo_owner(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. 정책 넷 (0018 3절과 같은 모양·같은 이유)
--
--    bucket_id로 범위를 끊는다. storage.objects에는 다른 버킷(initiative-logos·vault-docs)의
--    객체도 함께 사는데, permissive라 이 네 줄은 이 버킷에만 권한을 **더한다.**
--
--    함수 이름에 public. 스키마를 붙인다. 실제 Supabase에서 Storage 쿼리는 search_path에
--    public이 없는 컨텍스트로 평가될 수 있고, 안 붙이면 함수를 못 찾아 조용히 새거나
--    예측 불가능하게 행동한다(0018이 겪고 적어 둔 자리다 — PGlite는 search_path가 느슨해
--    이 문제를 안 잡아낸다).
--
--    쓰기를 insert/update/delete 셋으로 나눈 것도 0018과 같다. for all로 묶으면 그 using이
--    select도 커버해서(permissive는 OR) read 정책이 죽은 정책이 된다.
--
--    ■ 읽기 — 이름이 보이는 범위와 **같다** ■
--    exists로 user_profiles를 한 번 읽는 것이 판정 전부다. 그 읽기에 0026의
--    user_profiles_self_read(본인 OR 회장 OR in_my_subtree)가 그대로 걸린다.
--    여기에 조건을 더하지도 빼지도 않는다 — 더하면 이름은 보이는데 얼굴이 안 보이고,
--    빼면 그 반대가 된다. 0026이 그 규칙을 고치는 날 이쪽은 아무것도 안 해도 따라온다.
--
--    revoked_at을 여기서 따로 보지 않는다. 회수된 사람의 행은 여전히 조직도에 남고
--    (0028의 '30일 입퇴사 이력'이 그것을 읽는다) 그 줄에 얼굴이 같이 보이는 것이 맞다.
--
--    ■ 쓰기 — 본인 것만 ■
--    is_active()를 AND로 건다. 권한이 회수된 사람은 자기 사진도 못 바꾼다(0002 원칙 8:
--    revoked_at 하나로 모든 문이 닫힌다).
-- ---------------------------------------------------------------------
drop policy if exists profile_photos_read on storage.objects;
create policy profile_photos_read on storage.objects for select
  using (
    bucket_id = 'profile-photos'
    and exists (
      select 1 from public.user_profiles up
       where up.user_id = public.profile_photo_owner(name)
    )
  );

drop policy if exists profile_photos_write_insert on storage.objects;
create policy profile_photos_write_insert on storage.objects for insert
  with check (
    bucket_id = 'profile-photos'
    and public.is_active()
    and public.profile_photo_owner(name) = auth.uid()
  );

drop policy if exists profile_photos_write_update on storage.objects;
create policy profile_photos_write_update on storage.objects for update
  using (
    bucket_id = 'profile-photos'
    and public.is_active()
    and public.profile_photo_owner(name) = auth.uid()
  )
  with check (
    bucket_id = 'profile-photos'
    and public.is_active()
    and public.profile_photo_owner(name) = auth.uid()
  );

drop policy if exists profile_photos_write_delete on storage.objects;
create policy profile_photos_write_delete on storage.objects for delete
  using (
    bucket_id = 'profile-photos'
    and public.is_active()
    and public.profile_photo_owner(name) = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 5. 포인터를 쓰는 문 (0030 4절과 같은 모양)
--
--    user_profiles에 self-update 정책을 얹지 않는다. 정책은 행을 고르지 **칸을 고르지
--    못해서**, `user_id = auth.uid()`로 update를 열면 본인이 자기 role과
--    max_security_class와 revoked_at도 고칠 수 있다. 그것은 권한 상승이다.
--
--    그래서 칸 하나만 만지는 definer 함수를 문으로 둔다. 0030의 update_own_profile()에
--    photo_path를 끼워 넣지 않은 이유는 그 함수가 **폼 한 벌**을 받기 때문이다 —
--    사진은 폼과 따로 올라가고(FormData), 거기에 이름·직함·생년월일을 같이 실으면
--    사진만 바꾸려다 다른 칸을 옛 값으로 덮는 경로가 생긴다.
--
--    p_path가 null이면 '사진 없음'이다. 삭제와 등록이 같은 문을 지난다.
--    경로의 모양을 여기서 한 번 더 본다 — 남의 경로를 자기 칸에 적어 두는 것을
--    막는 유일한 줄이다(그 객체를 읽을 수는 없지만, 칸에 남의 id가 적히면 화면이
--    서명 URL을 남의 경로로 요청하게 된다).
-- ---------------------------------------------------------------------
create or replace function update_own_photo(p_path text) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if v_uid is null or not is_active() then
    return false;
  end if;
  -- 남의 경로는 받지 않는다. 0030 update_own_profile()과 같이 예외가 아니라 false다 —
  -- 호출자가 화면이라 500보다 "저장하지 못했습니다" 한 줄이 낫다.
  if v_path is not null and profile_photo_owner(v_path) is distinct from v_uid then
    return false;
  end if;

  update user_profiles
     set photo_path = v_path
   where user_id = v_uid
     and revoked_at is null;

  return found;
end;
$fn$;

comment on function update_own_photo(text) is
  '프로필 사진의 포인터 한 칸만 고치는 문. user_profiles에 self-update 정책을 얹지 않은 이유는 정책이 행은 골라도 칸은 못 고르기 때문이다(0030 4절). null을 주면 사진 없음이다 — 등록과 삭제가 같은 문을 지난다.';

revoke all on function update_own_photo(text) from public;
grant execute on function update_own_photo(text) to authenticated;

commit;
