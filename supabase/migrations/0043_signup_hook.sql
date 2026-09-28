-- =====================================================================
-- 0043 가입 문지기 — Supabase Auth «Before User Created» Hook
--
-- 0042 invitation_open()은 앱 화면(/signup)의 문이다. 누가 anon 키로 /auth/v1/signup을 직접 부르면
-- 화면을 거치지 않고 auth.users 행이 생긴다(프로필이 없어 로그인에서 막히지만, 계정 · 인증 메일은 나간다).
-- 이 함수는 Auth 서버가 계정을 만들기 **전에** 부른다 — 초대(열린 것)가 없는 이메일은 403으로 돌려보낸다.
--
-- **이 파일만으로는 아무것도 막지 않는다.** 대시보드 Authentication → Hooks → Before User Created →
-- Postgres → public.before_user_created_hook 으로 켜야 선다(OPERATIONS 3-1절 6번). 끄면 곧바로 0042 상태다.
--
-- 대시보드 «Add user» · 관리자 API로 만드는 계정에도 같이 걸린다. Integration · AIAgent 같은 부트스트랩
-- 계정을 새로 만들 때는 초대를 먼저 넣거나 그동안 Hook을 끈다.
--
-- 판정은 invitation_open()과 같은 조건(lower(email) · 미수락 · 미회수)이다 — 두 문이 다르게 말하면 안 된다.
-- =====================================================================

begin;

create or replace function public.before_user_created_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_email text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if v_email <> '' and exists (
    select 1 from user_invitations i
     where lower(i.email) = v_email
       and i.accepted_at is null and i.revoked_at is null
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', '등록되지 않은 이메일입니다. 관리자에게 문의하세요.'
  ));
end;
$fn$;

-- Auth 서버(supabase_auth_admin)만 부른다. anon · authenticated가 RPC로 부르면 초대 여부를 캐는 창이 된다.
revoke all on function public.before_user_created_hook(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;

commit;
