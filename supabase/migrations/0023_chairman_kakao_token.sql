-- =====================================================================
-- Chairman OS — 0023_chairman_kakao_token
-- 출처: Phase 3-C 카톡 아침 알림
-- 작성: Phase 3-C (2026-09-20)
--
-- 무엇이 없어서 만드나
--   야간 브리핑은 /ai를 열어야 보인다. 회장이 아침에 앱을 안 열면 브리핑은 없는 것과 같다.
--   카카오톡 '나에게 보내기'로 한 줄을 밀어 넣으면 그 한 줄이 링크가 되어 /ai로 데려온다.
--   그러려면 회장의 카카오 OAuth 토큰을 보관할 자리가 필요하다.
--
-- 권한 — 0019보다 한 단계 더 좁다. **아무도 표를 직접 읽지 못한다**
--   0019 chairman_checkins는 표 자체를 Chairman에게 열어 두고 AIAgent에게만 keyhole을 줬다.
--   여기서는 Chairman에게도 표를 열지 않는다. 담긴 것이 건강 기록이 아니라 **외부 계정의
--   bearer 자격증명**이기 때문이다. 체중은 새 나가면 프라이버시 사고지만, access_token은
--   새 나가는 순간 남이 회장 이름으로 카카오톡을 보낸다. 값을 읽을 수 있는 코드 경로가
--   하나라도 더 있으면 언젠가 그 경로가 화면으로 이어진다 — 0019가 sleep_hours를 keyhole
--   반환값에서 아예 뺀 것과 같은 판단을, 여기서는 표 전체에 적용한다.
--
--   그 "열지 않는다"를 실제로 집행하는 것은 3절의 `revoke` 한 줄이다. RLS 정책이 아니다 —
--   정책(chairman_kakao_token_all)은 permissive라 오히려 Chairman의 select를 **허용**한다.
--   자세한 것은 3절 주석에 적었다.
--
--   그래서 문은 다섯 개뿐이고 전부 security definer다. 각 함수가 자기 몸통 안에서 역할을 판정한다.
--
--     kakao_token_status()     Chairman           연결됐나 · 언제까지 · 어떤 동의를 받았나.
--                                                 **토큰 값은 반환하지 않는다.** 화면이 쓴다.
--     kakao_token_for_send()   Chairman, AIAgent  토큰 한 벌. 발송하는 코드만 쓴다.
--     kakao_token_save(...)    Chairman           연결/재연결. 행을 만들거나 통째로 갈아 끼운다.
--     kakao_token_refreshed(…) Chairman, AIAgent  refresh로 받은 새 access_token만 갈아 끼운다.
--                                                 **행을 만들지 못한다** — AIAgent가 없는 연결을
--                                                 되살릴 수는 없다. 연결은 사람이 한다.
--     kakao_token_clear()      Chairman           연결 해제.
--
--   왜 AIAgent에게 for_send를 주는가 — 야간 Job은 매일 07:00 KST에 사람 없이 cron으로 돈다.
--   빌려 올 회장 세션이 없다(0019 P5-5d 1라운드 수정에서 같은 결론에 도달했다).
--
-- 왜 refresh와 save를 나누는가
--   두 경로의 권한이 다르다. 연결은 회장이 브라우저에서 카카오에 로그인해야 생긴다.
--   갱신은 Job이 사람 없이 해야 한다. 한 함수로 합치면 AIAgent에게 '행 만들기'까지 주게 되고,
--   그러면 Job 쪽 버그 하나가 회장이 끊어 둔 연결을 되살릴 수 있다.
--
-- 왜 행이 여럿일 수 있다고 보고 쓰는가
--   user_id가 기본키라 Chairman이 둘이면 행도 둘이다. "회장은 한 사람"은 오늘의 운영 사실이지
--   스키마가 지키는 제약이 아니다 — 언젠가 회장이 둘인 날(승계 기간의 신·구 회장)이 오면
--   표 전체를 갱신하거나 지우는 코드는 한 계정이 다른 계정의 행까지 건드린다. 그래서
--   kakao_token_for_send()는 `order by updated_at desc limit 1`로 **한 행을 고르고**,
--   kakao_token_refreshed()는 그 행의 user_id를 받아 **그 행만** 갱신하고,
--   kakao_token_status()/kakao_token_clear()는 `where user_id = auth.uid()`로 **호출자 자신의
--   행만** 보고 지운다(force를 걷은 뒤로 정책이 더는 이것을 대신해 주지 않는다 — 3절 ③, G-1).
--   AIAgent가 user_id를 손에 쥐게 되지만, 그 값은 이미 for_send()가 돌려주던 것이고
--   (send-brief.ts가 audit_log의 actor로 쓰는 값과 같은 등급이다) 토큰 값이 아니다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 어휘
--    이 트랜잭션 안에서는 새 값을 리터럴로 쓸 수 없다(55P04). 실제 사용은 런타임
--    TypeScript(lib/kakao/send-brief.ts)에서만 한다 — 이 파일 안에는 등장하지 않는다.
-- ---------------------------------------------------------------------
alter type audit_action add value if not exists 'kakao_sent';
alter type audit_action add value if not exists 'kakao_failed';

-- ---------------------------------------------------------------------
-- 2. 표
-- ---------------------------------------------------------------------
create table chairman_kakao_token (
  user_id            uuid primary key references auth.users(id) on delete cascade, -- [Vault] 연결한 사람
  access_token       text        not null,                  -- [Vault] bearer 자격증명. 절대 화면으로 나가지 않는다
  refresh_token      text        not null,                  -- [Vault] 같은 등급
  expires_at         timestamptz not null,                  -- [일반] access_token 만료 시각
  refresh_expires_at timestamptz not null,                  -- [일반] 지나면 사람이 다시 연결해야 한다
  scopes             text        not null default '',       -- [일반] 카카오가 실제로 준 동의항목(공백 구분)
  updated_at         timestamptz not null default now()     -- [일반]
);

comment on table chairman_kakao_token is
  'Phase 3-C. 회장 카카오 OAuth 토큰. 외부 계정의 bearer 자격증명이라 0019 chairman_checkins보다 한 단계 더 좁다 — Chairman에게도 표를 직접 열지 않고, security definer 함수 다섯 개만 문이다.';
comment on column chairman_kakao_token.access_token is
  '[Vault] 이 값을 select 하는 코드는 kakao_token_for_send()뿐이어야 한다. 화면·로그·모델 프롬프트 어디에도 나가지 않는다.';
comment on column chairman_kakao_token.scopes is
  '카카오 토큰 응답의 scope. talk_message가 없으면 연결은 됐어도 발송은 -402로 거절된다 — 화면이 그때 "다시 연결"을 띄운다.';

create trigger chairman_kakao_token_updated_at before update on chairman_kakao_token
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 3. 자물쇠는 하나, 최후 방어선이 하나
--
--    ① **자물쇠는 `revoke`다.** 이것 하나가 표를 닫는다 — grant가 없으면 RLS를 따지기도 전에
--       42501로 거절된다. security definer 함수 다섯은 소유자 권한으로 돌아 여기에 걸리지 않는다.
--       scripts/check-migrations.ts가 applyAll() 직후(일괄 grant 이전)에 이 상태를 직접 단언한다 —
--       이 줄이 지워지면 검사가 빨개진다.
--
--    ② **RLS 정책은 자물쇠가 아니다.** chairman_kakao_token_all은 permissive `for all`이라
--       Chairman의 select를 오히려 **허용**한다. 이 층이 존재하는 이유는 둘이다.
--         - Chairman의 쓰기 경로(연결·해제). kakao_token_save()/clear()가 definer로 돌지만,
--           정책이 없으면 나중에 grant가 되살아난 날 Chairman 본인의 행도 못 만진다.
--         - grant가 되살아나는 날(Supabase의 alter default privileges, 검사 스크립트의 일괄 grant)
--           **다른 역할**을 막는 최후 방어선. GroupCFO·Member·AIAgent는 그때도 한 행도 못 본다.
--
--    ③ **force는 걸지 않는다.** FORCE는 소유자까지 정책 아래로 끌어내린다. Supabase에서 이 표와
--       함수 다섯의 소유자가 BYPASSRLS가 아니면, 소유자 권한으로 도는 kakao_token_for_send()가
--       `auth_role() = 'Chairman'` 정책에 걸려 **AIAgent 세션에서 0행**을 준다. 그러면 07:00 cron은
--       매일 조용히 "카카오가 연결되어 있지 않다"로 끝나고, 회장이 누르는 테스트 발송만 성공해 보인다.
--       FORCE가 여기서 더해 주는 보안은 없다(자물쇠는 ①이다) — 더하는 것은 그 침묵 실패 위험뿐이다.
--       check-migrations.ts가 BYPASSRLS 없는 별도 소유자를 세워 이 판단을 영구히 증명한다.
-- ---------------------------------------------------------------------
revoke all on table chairman_kakao_token from anon, authenticated;

alter table chairman_kakao_token enable row level security;

create policy chairman_kakao_token_all on chairman_kakao_token for all
  using (is_active() and auth_role() = 'Chairman' and user_id = auth.uid())
  with check (is_active() and auth_role() = 'Chairman' and user_id = auth.uid());

do $$
begin
  execute format(
    'create policy integration_no_insert on public.%I as restrictive for insert
       with check (not is_integration())', 'chairman_kakao_token');
  execute format(
    'create policy integration_no_update on public.%I as restrictive for update
       using (not is_integration()) with check (not is_integration())', 'chairman_kakao_token');
  execute format(
    'create policy integration_no_delete on public.%I as restrictive for delete
       using (not is_integration())', 'chairman_kakao_token');
end
$$;

-- ---------------------------------------------------------------------
-- 4. 문 다섯 개
--    전부 예외를 던지지 않는다. 역할이 맞지 않으면 조용히 0행 / null이다 —
--    '없는 것'과 '못 읽는 것'을 구분하지 않는 이 저장소의 계약을 그대로 따른다.
-- ---------------------------------------------------------------------

-- 4-1. 화면용. 토큰 값이 반환 목록에 아예 없다.
create or replace function kakao_token_status()
returns table (connected boolean, scopes text, expires_at timestamptz,
               refresh_expires_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $fn$
  -- force를 걷었으므로(3절 ③) 정책이 더는 소유자를 묶지 않는다 — where로 직접 좁히지 않으면
  -- 회장이 둘인 날 A가 B의 연결 상태(scopes·만료·updated_at)까지 받는다. 호출자가 Chairman
  -- 세션이라 auth.uid()가 곧 그 회장이다.
  select true, t.scopes, t.expires_at, t.refresh_expires_at, t.updated_at
    from chairman_kakao_token t
   where is_active() and auth_role() = 'Chairman' and t.user_id = auth.uid();
$fn$;

comment on function kakao_token_status() is
  '0023. /settings/chairman이 "연결됨/다시 연결"을 그리는 데 쓰는 유일한 값. access_token·refresh_token은 반환 목록에 없다 — 반환하지 않은 값은 HTML로도 새어 나갈 수 없다.';

-- 4-2. 발송용. 유일하게 토큰 값을 내주는 자리다.
create or replace function kakao_token_for_send()
returns table (user_id uuid, access_token text, refresh_token text,
               expires_at timestamptz, refresh_expires_at timestamptz, scopes text)
language sql stable security definer set search_path = public as $fn$
  select t.user_id, t.access_token, t.refresh_token, t.expires_at, t.refresh_expires_at, t.scopes
    from chairman_kakao_token t
   where is_active() and auth_role() in ('Chairman', 'AIAgent')
   -- 회장이 둘이면 행도 둘이다(머리 주석). 호출부는 rows[0]을 쓰므로 '아무 행'이 아니라
   -- **가장 최근에 연결·갱신된 행**을 고른다 — 임의 선택은 어느 날 조용히 바뀐다.
   -- 이 함수는 AIAgent(야간 Job)가 부르므로 auth.uid()가 회장이 아니다 — G-1처럼 where로
   -- 좁힐 수 없다. 회장이 둘이 되면 이 limit 1은 '어느 회장이 그 회장인가'라는 개념이
   -- 필요해지는 자리다(오늘은 운영상 한 명이라 미룬다 — DEFERRED.md Phase 3-C 참고).
   order by t.updated_at desc
   limit 1;
$fn$;

comment on function kakao_token_for_send() is
  '0023. 토큰 값을 내주는 유일한 함수. AIAgent에게도 주는 이유는 야간 Job이 07:00 KST에 사람 없이 돌기 때문이다(0019 chairman_today_condition()과 같은 사정). 회장이 둘이 되는 날 이 limit 1이 미뤄 둔 것은 DEFERRED.md Phase 3-C를 본다.';

-- 4-3. 연결/재연결. Chairman만. 행을 만든다.
create or replace function kakao_token_save(
  p_access text, p_refresh text, p_expires timestamptz,
  p_refresh_expires timestamptz, p_scopes text
) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not (is_active() and auth_role() = 'Chairman') then
    return false;
  end if;
  insert into chairman_kakao_token
    (user_id, access_token, refresh_token, expires_at, refresh_expires_at, scopes)
  values (auth.uid(), p_access, p_refresh, p_expires, p_refresh_expires, coalesce(p_scopes, ''))
  on conflict (user_id) do update set
    access_token       = excluded.access_token,
    refresh_token      = excluded.refresh_token,
    expires_at         = excluded.expires_at,
    refresh_expires_at = excluded.refresh_expires_at,
    scopes             = excluded.scopes;
  return true;
end;
$fn$;

comment on function kakao_token_save(text, text, timestamptz, timestamptz, text) is
  '0023. 카카오 연결/재연결. Chairman만, 자기 user_id로만. 실패를 예외가 아니라 false로 돌려준다 — 호출부(/api/kakao/callback)가 사람에게 보여 줄 문구를 스스로 고르게 한다.';

-- 4-4. 갱신. Chairman + AIAgent. **행을 만들지 못한다.**
create or replace function kakao_token_refreshed(
  p_user_id uuid, p_access text, p_expires timestamptz,
  p_refresh text, p_refresh_expires timestamptz
) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  n integer;
begin
  if not (is_active() and auth_role() in ('Chairman', 'AIAgent')) then
    return false;
  end if;
  -- **그 행만** 갱신한다. p_user_id는 같은 회차의 kakao_token_for_send()가 돌려준 값이고,
  -- where 없이 표 전체를 update 하면 회장이 둘인 날 한 계정의 토큰이 다른 계정 행을 덮어쓴다.
  -- insert 경로가 없는 것은 그대로다 — 없는 user_id면 0행, 즉 false다(연결은 사람이 만든다).
  --
  -- 카카오는 refresh_token을 '만료 한 달 미만'일 때만 새로 준다. 안 준 회차에는
  -- 기존 값을 그대로 둬야 한다 — null로 덮으면 not null 제약에 걸리기 전에 연결이 끊긴다.
  update chairman_kakao_token set
    access_token       = p_access,
    expires_at         = p_expires,
    refresh_token      = coalesce(p_refresh, refresh_token),
    refresh_expires_at = coalesce(p_refresh_expires, refresh_expires_at)
  where user_id = p_user_id;
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

comment on function kakao_token_refreshed(uuid, text, timestamptz, text, timestamptz) is
  '0023. refresh_token 교환 결과를 그 행 하나에만 되쓴다. insert 경로가 없는 것이 요점이다 — 연결은 사람이 브라우저에서 하는 일이고, Job은 이미 있는 연결을 잇기만 한다. p_user_id는 같은 회차의 kakao_token_for_send()가 준 값이다.';

-- 4-5. 해제. Chairman만.
create or replace function kakao_token_clear() returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not (is_active() and auth_role() = 'Chairman') then
    return false;
  end if;
  -- force를 걷었으므로(3절 ③) 정책이 더는 소유자를 묶지 않는다 — where 없이 표 전체를
  -- 지우면 회장이 둘인 날 A의 '연결 해제'가 B의 연결까지 지운다. 호출자가 Chairman
  -- 세션이라 auth.uid()가 곧 그 회장이다.
  delete from chairman_kakao_token where user_id = auth.uid();
  return true;
end;
$fn$;

comment on function kakao_token_clear() is
  '0023. 연결 해제. 카카오 쪽 연결(unlink)까지 끊지는 않는다 — 우리가 가진 토큰을 버릴 뿐이다.';

-- 0019와 같은 이유로 public 기본 execute 권한을 먼저 걷고 필요한 역할에만 다시 준다.
revoke all on function kakao_token_status()      from public;
revoke all on function kakao_token_for_send()    from public;
revoke all on function kakao_token_save(text, text, timestamptz, timestamptz, text) from public;
revoke all on function kakao_token_refreshed(uuid, text, timestamptz, text, timestamptz)  from public;
revoke all on function kakao_token_clear()       from public;

grant execute on function kakao_token_status()      to authenticated;
grant execute on function kakao_token_for_send()    to authenticated;
grant execute on function kakao_token_save(text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function kakao_token_refreshed(uuid, text, timestamptz, text, timestamptz)  to authenticated;
grant execute on function kakao_token_clear()       to authenticated;

-- ---------------------------------------------------------------------
-- 5. 컨디션 keyhole을 하루 넓힌다 (cron이 23:00 → 07:00로 옮겨 간 결과)
--
--    0019 chairman_today_condition()은 23:00 KST에 도는 Job을 위한 함수였다. 그 시각이면
--    회장은 이미 아침 체크인을 했다. 07:00으로 옮기면 거의 매일 체크인 **전**이라 그 함수는
--    늘 null을 준다 — 브리핑에서 컨디션 문장이 통째로 사라진다.
--
--    그래서 '오늘 아니면 어제'까지 본다. 이틀을 넘기지 않는 이유: 사흘 전 컨디션으로
--    "오늘은 큰 결정을 미루라"고 말하는 것은 근거가 아니라 추측이다.
--    checkin_date를 같이 돌려주는 것은 화면과 모델이 **어제 값임을 알고 말하게** 하기 위해서다.
--
--    0019의 함수는 아무도 부르지 않게 되므로 지운다. 이 저장소는 배선만 되고 실제로는
--    안 켜지는 코드를 남기지 않는다(P5-5d 2라운드에서 listRecentCheckins를 지운 전례).
-- ---------------------------------------------------------------------
create or replace function chairman_recent_condition()
returns table (condition smallint, checkin_date date)
language sql stable security definer set search_path = public as $fn$
  select c.condition, c.checkin_date
    from chairman_checkins c
   where c.checkin_date >= (now() at time zone 'Asia/Seoul')::date - 1
     and c.checkin_date <= (now() at time zone 'Asia/Seoul')::date
     and is_active()
     and auth_role() in ('Chairman', 'AIAgent')
   order by c.checkin_date desc
   limit 1;
$fn$;

comment on function chairman_recent_condition() is
  '0023. 0019 chairman_today_condition()을 대체한다. 야간 Job이 07:00 KST로 옮겨 가 체크인보다 먼저 도는 날이 기본이 됐다 — 오늘 행이 없으면 어제 것을 주고, 어느 날 값인지 같이 준다. sleep_hours·weight_kg·meal_note는 여기서도 반환값에 없다.';

revoke all on function chairman_recent_condition() from public;
grant execute on function chairman_recent_condition() to authenticated;

drop function if exists chairman_today_condition();

-- ---------------------------------------------------------------------
-- 6. 0019 chairman_checkins의 force를 내린다
--
--    0019:71이 이 표에 force row level security를 걸었다. 3절 ③과 같은 함정이다 —
--    FORCE는 소유자까지 정책(`auth_role() = 'Chairman'`) 아래로 끌어내리고, 바로 위
--    chairman_recent_condition()은 그 소유자 권한으로 도는 security definer다. 소유자가
--    BYPASSRLS가 아니면 **AIAgent 세션에서 0행**이 나온다.
--
--    이쪽이 더 조용하다. 카카오 토큰이 0행이면 발송이 통째로 멈추지만, 컨디션이 0행이면
--    브리핑에서 문장 하나가 빠질 뿐이라 아무도 눈치채지 못한다 — 그래서 여기서 같이 내린다.
--
--    0019 파일은 건드리지 않는다. 이미 staging·production에 적용됐고, 적용된 마이그레이션을
--    고치면 체크섬이 드리프트된다(OPERATIONS 9, 0022가 겪은 일). 그래서 앞으로 나아가며 고친다.
--
--    표가 열리는 것이 아니다. enable은 그대로고 정책도 그대로라 Chairman 아닌 역할은 여전히
--    한 행도 못 본다. 내려가는 것은 '소유자도 정책을 받는다'뿐이다.
-- ---------------------------------------------------------------------
alter table public.chairman_checkins no force row level security;

commit;
