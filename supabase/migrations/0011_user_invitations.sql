-- =====================================================================
-- Chairman OS — 0011_user_invitations
-- 출처: 02_기능명세 CH-049 RBAC(회사/Module/Role별 권한, Default deny) / 04_권한 시트
--       05_Architecture "6. Permission 원칙" 8번(퇴사·계약 종료 즉시 회수)
-- 작성: Phase 1-D (2026-09-07)
--
-- 무엇이 없어서 만드나
--   0004_bootstrap_chairman은 첫 사람 한 명을 SQL Editor에서 심는 파일이고,
--   그 파일 머리에 "두 번째 사람부터는 회장이 앱에서 초대한다"고 적어 두었다.
--   그 앱 화면이 지금까지 없었다. 두 번째 사람을 넣으려면 여전히 SQL Editor를 열어야 했고,
--   그건 05_Architecture 6번(Production DB 직접 접근 금지)과 부딪힌다.
--
-- 왜 초대가 '표 한 줄'인가 — service_role이 없기 때문이다
--   보통은 auth.admin.inviteUserByEmail()로 계정 생성과 권한 부여를 한 번에 한다.
--   그건 service_role 키를 요구하는데 이 프로젝트에는 service_role이 없다(CLAUDE.md).
--   서버에서 signInWithOtp를 대신 쓸 수도 없다 — PKCE 검증자가 초대를 누른 사람(회장)의
--   브라우저 쿠키에 저장되고 초대받은 사람 브라우저에는 없어서 링크가 열리지 않는다.
--
--   그래서 둘을 쪼갠다.
--     신원(auth.users)  Supabase Dashboard가 만든다. 메일도 거기서 나간다.
--     권한(user_profiles / user_business_access)  Chairman OS가 만든다.
--
--   이 표는 그 사이를 잇는 약속이다. "이 이메일로 계정이 생기면 이 역할을 준다."
--   계정이 생기는 순간 아래 트리거가 약속을 이행한다. 순서는 상관없다 —
--   초대를 먼저 하든 계정을 먼저 만들든(그때는 회장이 초대를 나중에 넣고
--   그 사람이 다시 로그인하면 된다) 결과가 같다.
--
--   메일을 앱에서 직접 못 보내는 것은 남는 문제다. DEFERRED D-15에 적어 두었다.
--
-- 왜 초대에도 권한이 통째로 들어 있나
--   역할·보안등급·회사 범위를 초대 시점에 정한다. 계정이 생긴 뒤에 따로 채우면
--   그 사이에 '로그인은 되는데 아무것도 안 보이는' 사람이 생기고,
--   본인은 그것을 고장으로 읽는다(0002 Default Deny의 정상 동작인데도).
-- =====================================================================

create table user_invitations (
  invitation_id    uuid primary key default gen_random_uuid(),      -- [일반]
  -- auth.users.email과 맞춘다. 대소문자는 lower()로 눌러서 비교한다 — 메일 주소의 로컬 파트가
  -- 이론상 대소문자를 구분해도, 사람이 초대장에 그렇게 적는 일은 없고 사고만 난다.
  email            text not null,                                   -- [제한]
  role             app_role not null,                               -- [제한]
  max_security_class security_class not null default 'Normal',      -- [제한]
  -- 이 사람이 볼 회사들. 전사 역할(Chairman/GroupCFO)은 비워 둔다 —
  -- 0002의 has_business()가 그 둘은 user_business_access를 보지 않고 통과시킨다.
  business_ids     text[] not null default '{}',                    -- [제한]
  display_name     text not null,                                   -- [일반]
  title_ko         text,                                            -- [일반]
  invited_by       uuid not null references auth.users(id),          -- [제한]
  invited_at       timestamptz not null default now(),              -- [일반]
  -- 계정이 생겨 권한이 실제로 부여된 시각. 이 표의 '이행 완료' 표시다.
  accepted_at      timestamptz,                                     -- [일반]
  accepted_user_id uuid references auth.users(id),                  -- [제한]
  -- 아직 수락되지 않은 초대를 취소한 시각. 이미 수락된 사람을 자르는 건
  -- 이 칸이 아니라 user_profiles.revoked_at이다(원칙 8).
  revoked_at       timestamptz                                      -- [일반]
);
comment on table user_invitations is
  'CH-049. 신원(auth.users)과 권한(user_profiles)을 잇는 약속. '
  'service_role이 없어 계정 생성과 권한 부여를 한 트랜잭션에 담을 수 없다 — '
  '이 표가 그 둘 사이의 시차를 견딘다.';
comment on column user_invitations.business_ids is
  '전사 역할(Chairman/GroupCFO)은 비워 둔다. 0002의 has_business()가 그 둘은 이 표를 보지 않는다.';
comment on column user_invitations.revoked_at is
  '수락 전 초대를 취소한 시각. 이미 들어온 사람을 자르는 칸이 아니다 — 그건 user_profiles.revoked_at이다.';

-- 한 이메일에 살아 있는 초대는 하나다. 둘이면 트리거가 어느 역할을 줄지 정할 수 없다.
-- 부분 유니크라 취소·수락된 옛 초대는 얼마든지 남는다 — 기록이니 지우지 않는다.
create unique index user_invitations_pending
  on user_invitations (lower(email))
  where accepted_at is null and revoked_at is null;

create index user_invitations_recent on user_invitations (invited_at desc);

-- ---------------------------------------------------------------------
-- RLS — 권한을 나눠 주는 표라 권한 표들과 같은 모양이다(0002 3절).
--   Chairman만 읽고 쓴다. 본인 초대장도 본인은 못 읽는다 —
--   거기 적힌 것은 '이 사람의 정보'가 아니라 '이 사람에게 무엇을 줄지에 대한 결정'이다.
-- ---------------------------------------------------------------------
alter table user_invitations enable row level security;
alter table user_invitations force row level security;

create policy user_invitations_admin on user_invitations
  for all using (auth_role() = 'Chairman') with check (auth_role() = 'Chairman');

-- ---------------------------------------------------------------------
-- 이행 — 계정이 생기면 약속을 지킨다
--
-- security definer인 이유: 이 함수가 도는 순간은 회원가입 직후라 auth.uid()가 없다.
--   0002의 정책은 전부 auth.uid()에서 시작하므로 호출자 권한으로는 한 줄도 못 쓴다.
--
-- audit_log에는 쓰지 않는다. audit_log_insert 정책이 is_active()를 요구하고,
--   그 값이 여기서는 거짓이다. 정책을 느슨하게 고쳐 트리거를 통과시키는 대신
--   '누가 이 권한을 주기로 했는가'는 초대를 넣을 때 회장 세션이 이미 남긴다(CH-051).
--   여기서는 그 줄의 accepted_at을 채워 이행 시각을 남긴다.
--
-- exception 블록으로 감싼다. 이 함수가 실패하면 auth.users INSERT가 통째로 롤백되고,
--   그건 '회원가입 자체가 안 되는' 장애다. 권한 부여 실패가 로그인 장애로 번지지 않게 한다 —
--   권한이 안 붙은 사람은 currentUser()가 null로 잘라 내므로 안전한 쪽으로 실패한다.
-- ---------------------------------------------------------------------
create or replace function accept_user_invitation()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  inv user_invitations;
  biz text;
begin
  if new.email is null then return new; end if;

  select * into inv
    from user_invitations
   where lower(email) = lower(new.email)
     and accepted_at is null
     and revoked_at is null
   order by invited_at desc
   limit 1;

  -- 초대가 없으면 아무것도 하지 않는다. 계정은 생기지만 권한 표에 행이 없어
  -- currentUser()가 null을 돌려주고, 그 사람은 앱을 쓸 수 없다(0002 Default Deny).
  if not found then return new; end if;

  insert into user_profiles (user_id, role, display_name, title_ko, max_security_class)
  values (new.id, inv.role, inv.display_name, inv.title_ko, inv.max_security_class)
  on conflict (user_id) do update
    set role               = excluded.role,
        display_name       = excluded.display_name,
        title_ko           = excluded.title_ko,
        max_security_class = excluded.max_security_class,
        revoked_at         = null;

  foreach biz in array inv.business_ids loop
    insert into user_business_access (user_id, business_id, granted_by)
    values (new.id, biz, inv.invited_by)
    on conflict (user_id, business_id) do nothing;
  end loop;

  update user_invitations
     set accepted_at = now(), accepted_user_id = new.id
   where invitation_id = inv.invitation_id;

  return new;
exception when others then
  -- 회원가입은 살린다. 권한만 안 붙는다.
  raise warning 'accept_user_invitation 실패 (%): %', new.email, sqlerrm;
  return new;
end;
$fn$;

comment on function accept_user_invitation is
  '계정이 생기는 순간 살아 있는 초대를 찾아 권한을 부여한다. '
  '초대가 없으면 아무것도 하지 않는다 — 그 계정은 로그인은 되지만 앱을 쓸 수 없다(Default Deny).';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function accept_user_invitation();

-- 확인:
--   select email, role, accepted_at, revoked_at from user_invitations order by invited_at desc;
--   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass;
