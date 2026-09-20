-- =====================================================================
-- Chairman OS — 0030_notifications_profile
-- 출처: docs/superpowers/specs/2026-09-20-incoming.md `## [Phase 5-E …]` + `## 5-E 변경`
-- 작성: Phase 5-E 죽은 버튼·프로필·사이드바·설정 허브 (2026-09-21)
--
-- 원문은 이 표들을 "(0025)"라 불렀다. 그 번호는 Phase 6-1 위계가 이미 썼고, 컨트롤러 메모가
-- 적어 둔 대로 "(0025)"는 **다음 번호**라는 뜻으로 읽는다. 실제 번호는 0030이다.
--
-- 무엇이 들어오나 — 넷이다.
--   1. notifications          헤더 알림 종이 셀 실제 건수. 지금은 0건이 맞다.
--   2. user_profiles.birth_date  프로필 설정의 생년월일
--   3. 회장 행의 이름 교정      '홍성호' → '홍석현' (0003_seed / bootstrap이 넣은 값)
--   4. user_settings.sidebar_prefs  사이드바 접기·숨김 상태
--
-- 하지 않는 것
--   * **새 audit_action 값을 만들지 않는다.** 0022가 production에서 55P04로 터진 자리다.
--     알림은 감사 기록이 아니다 — 감사가 필요한 사건은 이미 audit_log에 자기 action이 있다.
--   * **force row level security를 새로 걸지 않는다.** 0023 kakao_token · chairman_checkins ·
--     0027 projects · 0029 user_settings에서 네 번 같은 함정을 만났다. FORCE는 소유자를 정책
--     아래로 끌어내려 security definer 문을 조용히 막는다. 이 저장소의 자물쇠는 revoke다.
--   * **'내 데이터 내보내기'를 만들지 않는다.** 원문 4절의 그 줄은 뒤따라온 `5-E 변경`이
--     취소했다("나가는 통로 없음"). 같은 절의 감사 로그 열람 링크만 남는다.
--   * **0003_seed.sql을 고치지 않는다.** 이미 적용된 파일이라 체크섬이 드리프트된다
--     (OPERATIONS 9, 0022가 겪은 일). DB 쪽 값은 아래 3절의 update로 고친다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. notifications — 앱 안의 알림 한 줄
--
--    헤더의 종 두 개는 Phase 5-E 전까지 `12`와 `5`를 **하드코딩**하고 있었다. 그 숫자는
--    시안에서 온 값이라 아무것도 세지 않았고, 아무리 눌러도 열리지 않았다. 지금은 이 표를
--    센다 — **아직 알림을 만드는 코드가 없으므로 화면에 0이 뜨는 것이 정상이다.**
--    0이 뜨는 것과 12가 뜨는 것은 다르다. 앞엣것은 사실이고 뒤엣것은 거짓말이다.
--
--    kind는 지금 쓸 것만 넣는다. 원문이 "check로 종류를 묶는다"고 한 이유가 이것이다 —
--    열어 두면 만드는 쪽이 제각각 문자열을 넣고, 화면은 모르는 종류를 어떻게 그릴지 모른다.
--    넷으로 시작한다. 새 종류가 필요하면 그때 check를 넓히는 마이그레이션을 쓴다
--    (enum이 아니라 check라 넓히는 것이 안전하다 — 55P04가 없다).
--
--      decision  결정이 나를 기다린다        link → /approvals/…
--      task      업무가 나에게 왔다·막혔다    link → /tasks/…
--      share     누가 나에게 무언가를 열었다  link → /shared
--      system    그 밖의 시스템 알림          link → 아무 데나
--
--    link는 앱 안의 경로다. 외부 URL을 담지 않는다 — 알림을 만드는 것이 언젠가 서버가 되는데,
--    거기에 바깥 주소를 넣을 수 있으면 알림이 피싱 통로가 된다.
-- ---------------------------------------------------------------------
create table notifications (
  notification_id uuid primary key default gen_random_uuid(),   -- [일반]
  user_id         uuid not null references auth.users(id) on delete cascade, -- [제한] 받는 사람
  kind            text not null,                                -- [일반] 아래 check의 넷 중 하나
  title           text not null,                                -- [일반] 한 줄 제목
  body            text,                                         -- [일반] 본문. 없어도 된다
  link            text,                                         -- [일반] 누르면 갈 앱 안의 경로
  read_at         timestamptz,                                  -- [일반] null이면 안 읽음
  created_at      timestamptz not null default now()            -- [일반]
);

alter table notifications
  add constraint notifications_kind_known
    check (kind in ('decision', 'task', 'share', 'system')),
  -- 제목이 없는 알림은 화면에 그릴 수 없다. 빈 문자열은 null과 같은 뜻을 두 가지로 쓰는 것이라 막는다.
  add constraint notifications_title_present
    check (length(btrim(title)) > 0),
  -- 앱 안의 경로만. 'http…'도 '//evil'도 아니다. 알림을 만드는 쪽이 언젠가 서버가 되므로
  -- 그 문이 바깥으로 열리지 않게 **표가** 못 박는다.
  add constraint notifications_link_internal
    check (link is null or (link like '/%' and link not like '//%'));

comment on table notifications is
  'Phase 5-E 1-2절. 헤더 알림 종이 세는 표. 만드는 코드는 아직 없다 — 화면에 0건이 뜨는 것이 정상이고 그것이 하드코딩 12/5보다 정직하다.';
comment on column notifications.kind is
  '지금 쓰는 넷만(decision·task·share·system). enum이 아니라 check인 이유는 넓히는 날 55P04를 만나지 않기 위해서다(0022가 production에서 터진 자리).';
comment on column notifications.link is
  '앱 안의 경로만. 알림을 만드는 것이 언젠가 서버가 되는데 바깥 주소를 담을 수 있으면 알림이 피싱 통로가 된다 — 그래서 표가 막는다.';
comment on column notifications.read_at is
  'null이면 안 읽음. 헤더의 뱃지가 세는 것이 이 칸이다. 지우지 않고 표시만 한다 — 읽은 알림도 목록에 남아야 "그때 뭐였지"에 답할 수 있다.';

-- 원문이 지목한 그대로다. 종이 매 화면마다 묻는 질문이
-- "내 것 중 read_at이 null인 것 몇 개"라 세 칸이 이 순서여야 인덱스만으로 답한다.
create index notifications_by_user_unread
  on notifications (user_id, read_at, created_at desc);

-- ---------------------------------------------------------------------
-- 2. 자물쇠 — 0023 3절 · 0029 5절과 같은 구성
--
--    ① revoke가 자물쇠다. grant가 없으면 RLS를 따지기 전에 42501이다.
--       Supabase는 public 스키마의 새 표를 만들자마자 anon/authenticated에게 연다
--       (alter default privileges). 그래서 걷고 필요한 것만 다시 준다.
--    ② **insert를 아무에게도 주지 않는다.** 원문이 "만드는 것은 지금 없다 — insert 정책을
--       넓게 열지 마라"고 한 자리다. 넓게 여는 대신 **아예 열지 않았다**: insert 정책도
--       insert 권한도 없다. 서버가 알림을 만들게 되는 날 definer 함수 하나가 문이 된다
--       (0023 kakao_token_save()와 같은 모양). 그때 이 표에 '누가 만들 수 있나'를
--       한 곳에서 정하게 된다.
--    ③ update는 **칸 단위로** 준다. 정책은 행만 고르지 칸을 고르지 못한다 —
--       행 단위 update 정책만 두면 본인이 자기 알림의 title·link를 바꿀 수 있고,
--       그러면 '읽음 표시'가 아니라 '알림 위조'가 된다. grant update (read_at)가 그 문을 닫는다.
--    ④ force는 걸지 않는다. 0023·0027·0029가 같은 함정을 세 번 만난 자리다.
-- ---------------------------------------------------------------------
revoke all on table notifications from anon, authenticated;
grant select on table notifications to authenticated;
grant update (read_at) on table notifications to authenticated;

alter table notifications enable row level security;

create policy notifications_own_read on notifications for select
  using (is_active() and user_id = auth.uid());

create policy notifications_own_mark on notifications for update
  using (is_active() and user_id = auth.uid())
  with check (user_id = auth.uid());

-- Integration(ECOUNT 동기화 계정)은 이 표에 닿을 일이 없다. grant가 이미 없지만,
-- grant가 되살아나는 날(Supabase의 default privileges)을 대비해 제한 정책을 같이 둔다
-- — 0029 5절 ②와 같은 이유다.
do $$
begin
  execute format(
    'create policy integration_no_insert on public.%I as restrictive for insert
       with check (not is_integration())', 'notifications');
  execute format(
    'create policy integration_no_update on public.%I as restrictive for update
       using (not is_integration()) with check (not is_integration())', 'notifications');
  execute format(
    'create policy integration_no_delete on public.%I as restrictive for delete
       using (not is_integration())', 'notifications');
end
$$;

-- ---------------------------------------------------------------------
-- 3. user_profiles.birth_date + 회장 행의 이름 교정
--
--    display_name_en은 이미 있다(0017 2절이 만들고 회장 행에 'Edison S. Hong'을 넣었다).
--    여기서 다시 만들지 않는다 — 없을 때만 더하는 방어는 0017이 이미 했다.
--
--    생년월일에 not null을 걸지 않는다. 사람마다 넣을 수도 안 넣을 수도 있는 값이고,
--    not null + 기본값으로 두면 아무도 넣지 않은 날짜가 모든 사람의 생일이 된다.
-- ---------------------------------------------------------------------
alter table user_profiles
  add column birth_date date;   -- [제한] 본인과 Chairman만 본다(0002 user_profiles_self_read)

alter table user_profiles
  -- 사람이 손으로 넣는 칸이라 최소선만 본다. 1900년 이전이나 미래 날짜는 오타다.
  add constraint user_profiles_birth_date_sane
    check (birth_date is null or (birth_date >= date '1900-01-01' and birth_date <= date '2100-01-01'));

comment on column user_profiles.birth_date is
  'Phase 5-E 2절. 프로필의 생년월일. [제한] 등급이라 본인과 Chairman만 읽는다(0002 user_profiles_self_read 그대로). 연·월·일 전부 본인이 고칠 수 있다 — 회장 지시가 "월일은 설정에서 수정"이었고, 연도만 막을 이유가 따로 없다.';

/**
 * 회장 행의 이름 교정 (원문 2절: "더미 시드의 '홍성호'도 '홍석현'으로").
 *
 * **0003_seed.sql과 supabase/bootstrap/0004_ready_staging.sql을 고치지 않는다.**
 * 적용된 마이그레이션을 고치면 체크섬이 드리프트된다(0022가 겪은 일). 앞으로 나아가며 고친다.
 *
 * where에 display_name을 건다. 회장이 그 사이에 이름을 제 손으로 고쳐 뒀다면 이 update가
 * 그 값을 덮어쓰면 안 된다 — 마이그레이션이 사람이 넣은 값을 되돌리는 것이 이 저장소에서
 * 가장 되돌리기 어려운 종류의 사고다(0005가 같은 주의를 적어 뒀다).
 */
update user_profiles
   set display_name = '홍석현'
 where role = 'Chairman'
   and revoked_at is null
   and display_name = '홍성호';

-- 0017이 이미 넣었지만, 그 마이그레이션이 돌던 시점에 회장 행이 없던 환경도 있다.
-- 비어 있을 때만 채운다 — 0017과 같은 조건이라 두 번 돌아도 같은 결과다.
update user_profiles
   set display_name_en = 'Edison S. Hong'
 where role = 'Chairman'
   and revoked_at is null
   and display_name_en is null;

-- 생년월일의 시작값. 회장이 설정에서 고친다 — 그래서 null일 때만 넣는다.
update user_profiles
   set birth_date = date '1988-01-01'
 where role = 'Chairman'
   and revoked_at is null
   and birth_date is null;

-- ---------------------------------------------------------------------
-- 4. 본인 프로필을 본인이 고치는 문
--
--    0002의 user_profiles_admin_write는 `for all using (auth_role() = 'Chairman')`이다.
--    즉 **Chairman 말고는 자기 이름도 못 고친다.** 프로필 설정(4절 '전 사용자 공통')이
--    성립하려면 문이 하나 필요하다.
--
--    정책을 넓히지 않는다. `user_id = auth.uid()`로 update 정책을 하나 더 얹으면 그 사람이
--    **자기 role과 max_security_class와 revoked_at도** 고칠 수 있다 — 정책은 행을 고르지
--    칸을 고르지 못하기 때문이다. 그것은 권한 상승이고, 이 저장소에서 가장 하면 안 되는 일이다.
--
--    그래서 security definer 함수 하나만 문으로 둔다. 이 함수가 만지는 칸은 넷뿐이고,
--    그 넷에 role·revoked_at·max_security_class는 없다. RLS를 우회하는 새 경로가 아니라
--    **좁은 구멍 하나**다(0023 4절이 토큰에 쓴 것과 같은 모양).
--
--    search_path = public을 건다. 없으면 함수가 다른 스키마의 user_profiles를 볼 수 있다.
-- ---------------------------------------------------------------------
create or replace function update_own_profile(
  p_display_name    text,
  p_display_name_en text,
  p_title_ko        text,
  p_birth_date      date,
  p_language        text
) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  -- 0023 kakao_token_save()와 같다 — 예외를 던지지 않고 false다. 호출자가 화면이라
  -- 500보다 "저장하지 못했습니다" 한 줄이 낫다.
  if not is_active() then
    return false;
  end if;
  -- 이름 없는 사람은 만들지 않는다. display_name은 not null이고, 화면 곳곳이 첫 글자를
  -- 아바타로 쓴다 — 빈 문자열이면 그 자리가 통째로 빈다.
  if v_name = '' then
    return false;
  end if;

  update user_profiles
     set display_name    = v_name,
         -- 빈 문자열은 null로 접는다. 영문 이름과 직함은 '없음'이 정상 상태이고,
         -- ''와 null이 같은 뜻을 두 가지로 표현하면 읽는 쪽이 둘 다 검사해야 한다.
         display_name_en = nullif(btrim(coalesce(p_display_name_en, '')), ''),
         title_ko        = nullif(btrim(coalesce(p_title_ko, '')), ''),
         birth_date      = p_birth_date,
         -- 모르는 값은 지금 값을 그대로 둔다. 0028의 check가 ko/en만 받으므로 여기서
         -- 거르지 않으면 폼의 오타 하나가 23514로 올라와 "저장하지 못했습니다"가 된다.
         language        = case when p_language in ('ko', 'en') then p_language else language end
   where user_id = auth.uid()
     and revoked_at is null;

  return found;
end;
$fn$;

comment on function update_own_profile(text, text, text, date, text) is
  'Phase 5-E 2절. 본인이 자기 프로필의 다섯 칸(이름 ko/en·직함·생년월일·표기 언어)만 고치는 문. user_profiles에 self-update 정책을 얹지 않은 이유는 정책이 행은 골라도 칸은 못 고르기 때문이다 — 그러면 본인이 자기 role과 revoked_at도 고칠 수 있다.';

revoke all on function update_own_profile(text, text, text, date, text) from public;
grant execute on function update_own_profile(text, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. user_settings.sidebar_prefs — 사이드바 접기·숨김
--
--    **항목 목록과 분리된 칸이다.** 곧 올 Phase 7 블록 E가 사이드바를 10개 항목으로 갈아
--    끼우는데, 숨김 상태가 항목 목록의 모양(배열의 자리, 라벨)에 묶여 있으면 그날 설정이
--    통째로 깨진다. 그래서 이 칸은 **키의 주머니**다:
--
--      { "collapsed_groups": ["grp_systems"],
--        "hidden_items":     ["nav_crm", "nav_scm"],
--        "hide_not_ready":   true }
--
--    읽는 쪽(lib/sidebar-prefs.ts)은 **모르는 키를 조용히 무시한다.** 목록에 없는 키가
--    남아 있어도 아무 일이 없고, 목록이 되돌아오면 그 설정이 그대로 살아난다.
--    jsonb 한 칸인 이유도 같다 — 항목이 늘 때마다 칸을 더하면 목록과 스키마가 묶인다.
--
--    dashboard_layout(0001)에 얹지 않는다. 그 칸은 CH-056 '대시보드 위젯의 표시/위치'이고
--    이쪽은 사이드바다. 한 칸에 두 화면의 설정을 섞으면 한쪽을 저장할 때 다른 쪽을
--    실수로 덮는 경로가 생긴다(둘 다 부분 갱신이라 읽고-합치고-쓰기가 필요하다).
-- ---------------------------------------------------------------------
alter table user_settings
  add column sidebar_prefs jsonb not null default '{}'::jsonb;  -- [일반] 키의 주머니. 아래 check가 모양만 본다

alter table user_settings
  -- 객체인지만 본다. 안의 키는 TS가 안다 — DB가 항목 이름을 알기 시작하면
  -- Phase 7이 목록을 갈아 끼울 때 마이그레이션이 따라와야 한다. 그것이 바로 피하려던 결합이다.
  add constraint user_settings_sidebar_prefs_object
    check (jsonb_typeof(sidebar_prefs) = 'object');

/**
 * app_prefs — 화면 전체에 쓰는 주머니. 테마(라이트/다크/자동)와 알림 종류별 on/off다.
 *
 * sidebar_prefs와 나눈 이유는 **부분 갱신** 때문이다. 둘 다 '읽고 합치고 쓰기'가 필요한
 * 주머니인데 한 칸에 섞으면 사이드바 설정을 저장할 때 테마를 덮는 경로가 생기고,
 * 그 합치기를 두 화면이 각자 하면 언젠가 한쪽이 진다.
 *
 * 여기서도 DB는 안의 키를 모른다. 알림 종류가 늘어도(0030 1절의 kind check는 넓힐 수 있다)
 * 이 칸은 마이그레이션 없이 따라온다.
 */
alter table user_settings
  add column app_prefs jsonb not null default '{}'::jsonb;   -- [일반] 테마·알림 스위치

alter table user_settings
  add constraint user_settings_app_prefs_object
    check (jsonb_typeof(app_prefs) = 'object');

comment on column user_settings.app_prefs is
  'Phase 5-E 4절. 테마(theme: light|dark|auto)와 알림 종류별 on/off(notify). 아침 루틴(/ai)은 이 값과 무관하게 늘 다크다 — 그 화면의 셸이 자기 트리에 직접 건다. 읽는 규칙은 lib/ui-prefs.ts 한 곳에만 있다.';

comment on column user_settings.sidebar_prefs is
  'Phase 5-E 3절. 사이드바 접기(collapsed_groups)·숨김(hidden_items)·"준비 중 기본 숨김"(hide_not_ready). 항목의 키로만 저장한다 — 모르는 키는 화면이 조용히 무시하므로 Phase 7이 사이드바 목록을 통째로 갈아 끼워도 이 칸은 깨지지 않는다.';

commit;
