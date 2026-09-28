-- ---------------------------------------------------------------------
-- 0039. 회장 Gmail 읽기 전용 연결 (Phase 9 블록 4)
--
-- 회장 지시 원문: "Gmail API 읽기 전용 연결 (OAuth, 회장 본인 계정). 토큰은
-- chairman_google_token(0039), Chairman만. /mail: 오늘 받은 메일 목록, 열면 Gmail 새 탭.
-- 앱에서 보내지 않음. 브리핑에 «오늘 회장 메일 N통, 중요 발신자(키맨 목록과 매칭) M통» 요약.
-- 직원 메일은 범위 밖."
--
-- **0023(카카오 토큰)과 같은 모양이다.** 외부 계정의 bearer 자격증명이라 Chairman에게도 표를
-- 직접 열지 않고, security definer 함수 다섯 개만 문이다. 다른 점 셋:
--   ① refresh_expires_at이 없다. Google의 refresh token은 만료 시각을 주지 않는다(취소되거나
--      6개월 미사용이면 죽는다 — 그때 갱신이 invalid_grant로 실패하고 화면이 «다시 연결»을 띄운다).
--   ② email 칸이 있다. 회장이 어느 계정을 연결했는지 화면에 보여야 한다(개인 · 회사 계정이 둘일 수 있다).
--   ③ 범위는 gmail.readonly **하나**다. 보내기(gmail.send)를 받지 않는다 — «앱에서 보내지 않음».
--      scopes 칸이 그 사실을 남기고, lib/google/config.ts가 요청 범위를 그 하나로 못 박는다.
--
-- **AIAgent에게 읽기 토큰을 준다**(google_token_for_read). 아침 브리핑이 사람 없이 돌면서
-- «오늘 메일 N통»을 세야 해서다 — 0023 kakao_token_for_send()와 같은 사정. 메일 **본문**은
-- 이 앱 어디에도 저장하지 않는다: 제목 · 발신자 · 시각만 그 자리에서 읽고 버린다.
--
-- 키맨에 email 칸을 더한다(business_keymen · initiative_keymen). «중요 발신자»는 발신 주소가
-- 키맨의 email과 같은 메일이다. 이름으로 맞추지 않는다 — «김철수»는 흔하다.
--
-- 0035 규칙: force를 새로 걸지 않는다(이 표는 처음부터 revoke로 잠근다). 0001~0038을 고치지 않는다.
-- ---------------------------------------------------------------------

create table chairman_google_token (
  user_id       uuid primary key references auth.users(id) on delete cascade, -- [Vault] 연결한 사람
  email         text        not null default '',               -- [제한] 연결한 Google 계정 주소
  access_token  text        not null,                          -- [Vault] 화면 · 로그 · 프롬프트로 나가지 않는다
  refresh_token text        not null,                          -- [Vault]
  expires_at    timestamptz not null,                          -- [일반] access_token 만료
  scopes        text        not null default '',               -- [일반] Google이 실제로 준 범위(공백 구분)
  updated_at    timestamptz not null default now()
);

comment on table chairman_google_token is
  '0039. 회장 Gmail 읽기 전용 OAuth 토큰. 0023 카카오 토큰과 같은 등급 — 표는 아무에게도 열지 않고 definer 함수 다섯이 문이다.';
comment on column chairman_google_token.access_token is
  '[Vault] 이 값을 select 하는 코드는 google_token_for_read()뿐이어야 한다.';

create trigger chairman_google_token_updated_at before update on chairman_google_token
  for each row execute function set_updated_at();

revoke all on table chairman_google_token from anon, authenticated;
alter table chairman_google_token enable row level security;

-- 정책은 두지만 grant가 없어서 직접 질의는 어차피 막힌다(두 겹). 0023과 같다.
create policy chairman_google_token_all on chairman_google_token for all
  using (is_active() and auth_role()::text = 'Chairman' and user_id = auth.uid())
  with check (is_active() and auth_role()::text = 'Chairman' and user_id = auth.uid());
create policy integration_no_insert on chairman_google_token as restrictive for insert
  with check (not is_integration());
create policy integration_no_update on chairman_google_token as restrictive for update
  using (not is_integration()) with check (not is_integration());
create policy integration_no_delete on chairman_google_token as restrictive for delete
  using (not is_integration());

-- /settings/chairman · /mail이 «연결됨 / 다시 연결»을 그리는 값. 토큰은 반환 목록에 없다.
create or replace function google_token_status()
returns table (connected boolean, email text, scopes text, expires_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $fn$
  select true, t.email, t.scopes, t.expires_at, t.updated_at
    from chairman_google_token t
   where is_active() and auth_role()::text = 'Chairman' and t.user_id = auth.uid();
$fn$;

-- 토큰 값을 내주는 유일한 함수. Chairman(/mail)과 AIAgent(아침 브리핑).
-- AIAgent의 auth.uid()는 회장이 아니라서 where로 좁힐 수 없다 — 가장 최근 연결 하나(0023과 같은 판단).
create or replace function google_token_for_read()
returns table (user_id uuid, email text, access_token text, refresh_token text, expires_at timestamptz, scopes text)
language sql stable security definer set search_path = public as $fn$
  select t.user_id, t.email, t.access_token, t.refresh_token, t.expires_at, t.scopes
    from chairman_google_token t
   where is_active()
     and (
       (auth_role()::text = 'Chairman' and t.user_id = auth.uid())
       or auth_role()::text = 'AIAgent'
     )
   order by t.updated_at desc
   limit 1;
$fn$;

create or replace function google_token_save(
  p_access text, p_refresh text, p_expires timestamptz, p_scopes text, p_email text
) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not (is_active() and auth_role()::text = 'Chairman') then
    return false;
  end if;
  -- 보내기 범위가 섞여 들어오면 저장하지 않는다. 요청을 readonly 하나로 보내지만, 이미 다른 앱에
  -- 준 범위가 합쳐져 돌아오는 경우(include_granted_scopes)를 여기서 한 번 더 막는다.
  if coalesce(p_scopes, '') ~ '(gmail\.send|gmail\.compose|gmail\.modify|mail\.google\.com)' then
    return false;
  end if;
  insert into chairman_google_token (user_id, email, access_token, refresh_token, expires_at, scopes)
  values (auth.uid(), coalesce(p_email, ''), p_access, p_refresh, p_expires, coalesce(p_scopes, ''))
  on conflict (user_id) do update set
    email         = excluded.email,
    access_token  = excluded.access_token,
    -- Google은 다시 동의할 때만 refresh_token을 준다. 안 준 회차에 빈 값으로 덮지 않는다.
    refresh_token = coalesce(nullif(excluded.refresh_token, ''), chairman_google_token.refresh_token),
    expires_at    = excluded.expires_at,
    scopes        = excluded.scopes;
  return true;
end;
$fn$;

create or replace function google_token_refreshed(p_user_id uuid, p_access text, p_expires timestamptz)
returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  n integer;
begin
  if not (is_active() and auth_role()::text in ('Chairman', 'AIAgent')) then
    return false;
  end if;
  -- 회장 세션은 자기 줄만. AIAgent는 같은 회차의 google_token_for_read()가 준 user_id 줄만.
  update chairman_google_token set access_token = p_access, expires_at = p_expires
   where user_id = p_user_id
     and (auth_role()::text = 'AIAgent' or user_id = auth.uid());
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

create or replace function google_token_clear() returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not (is_active() and auth_role()::text = 'Chairman') then
    return false;
  end if;
  delete from chairman_google_token where user_id = auth.uid();
  return true;
end;
$fn$;

revoke all on function google_token_status() from public, anon;
revoke all on function google_token_for_read() from public, anon;
revoke all on function google_token_save(text, text, timestamptz, text, text) from public, anon;
revoke all on function google_token_refreshed(uuid, text, timestamptz) from public, anon;
revoke all on function google_token_clear() from public, anon;
grant execute on function google_token_status() to authenticated;
grant execute on function google_token_for_read() to authenticated;
grant execute on function google_token_save(text, text, timestamptz, text, text) to authenticated;
grant execute on function google_token_refreshed(uuid, text, timestamptz) to authenticated;
grant execute on function google_token_clear() to authenticated;

-- ---------------------------------------------------------------------
-- 키맨 email. 소문자로 저장한다 — Gmail의 From은 대소문자가 섞여 온다.
-- ---------------------------------------------------------------------
alter table business_keymen add column email text
  check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
alter table initiative_keymen add column email text
  check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create or replace function keymen_email_lower() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.email := nullif(lower(trim(new.email)), '');
  return new;
end;
$fn$;

create trigger business_keymen_email_lower before insert or update of email on business_keymen
  for each row execute function keymen_email_lower();
create trigger initiative_keymen_email_lower before insert or update of email on initiative_keymen
  for each row execute function keymen_email_lower();

comment on column business_keymen.email is
  '0039. 이 주소에서 온 메일이 브리핑의 «중요 발신자»다. 이름으로 맞추지 않는다.';
comment on column initiative_keymen.email is
  '0039. business_keymen.email과 같다.';
