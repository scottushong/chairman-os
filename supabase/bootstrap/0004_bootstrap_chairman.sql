-- =====================================================================
-- Chairman OS — 0004_bootstrap_chairman (수동 실행)
-- 출처: 05_Architecture "6. Permission 원칙" / 02_기능명세 04_권한 시트
-- 작성: Phase 1-B (2026-09-06)
--
-- 이 파일은 supabase/migrations/ 안에 있지 않다. 일부러 그렇다.
--   - `supabase db push`는 migrations/ 만 적용한다. 이 파일은 자동으로 돌지 않는다.
--   - 첫 사람의 uid는 프로젝트마다 다르다. 마이그레이션에 박아 넣을 값이 아니다.
--   - user_profiles의 쓰기 정책은 auth_role() = 'Chairman'을 요구한다(0002).
--     Chairman이 아직 없으므로 앱 경로로는 첫 행을 넣을 방법이 없다 —
--     이 한 번만 RLS 밖에 있는 postgres 세션, 즉 Supabase SQL Editor에서 실행한다.
--
-- 실행 절차 (순서대로)
--   1) Supabase Dashboard → Authentication → Users → "Add user"
--      이메일/비밀번호로 회장 계정을 하나 만든다. Auto Confirm User를 켠다.
--   2) 만들어진 사용자 행의 UID(uuid)를 복사한다.
--   3) 이 파일의 :chairman_uid 3곳을 그 UID로 바꾼다. 따옴표째로 바꿔 넣는다.
--
--        :chairman_uid   →   '11111111-2222-3333-4444-555555555555'::uuid
--
--      psql로 돌린다면 치환하지 말고 그대로 두고 이렇게 넘긴다:
--        psql ... -v chairman_uid="'11111111-...-555555555555'::uuid" \
--                 -f supabase/bootstrap/0004_bootstrap_chairman.sql
--      SQL Editor는 바인딩 변수를 지원하지 않으니 직접 치환한다.
--      display_name / title_ko 도 실제 값으로 바꾼다.
--   4) Dashboard → SQL Editor에 이 파일 전체를 붙여넣고 실행한다.
--   5) 맨 아래 확인 쿼리로 행 1개가 나오는지 본다.
--
-- 한 번 돌고 나면 두 번째 사람부터는 이 파일을 쓰지 않는다.
-- 회장이 앱에서 초대하고, 그 변경은 CH-051에 따라 audit_log에 남는다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 최초 Chairman
--    max_security_class = 'Vault' — 04_권한 시트에서 Vault를 보는 유일한 역할이다.
--    revoked_at은 비워 둔다. 채우는 순간 전 테이블이 동시에 닫힌다(원칙 8).
--    전사 범위 역할이라 user_business_access에는 행을 넣지 않는다(0002 주석).
-- ---------------------------------------------------------------------
insert into user_profiles (user_id, role, display_name, title_ko, max_security_class)
values (
  :chairman_uid,   -- ← 2)에서 복사한 UID
  'Chairman',
  '회장',          -- ← 실제 이름
  '회장',          -- ← 실제 직함
  'Vault'
)
on conflict (user_id) do update
  set role               = excluded.role,
      max_security_class = excluded.max_security_class,
      revoked_at         = null;

-- ---------------------------------------------------------------------
-- 2. 개인 설정 빈 행 (CH-056)
--    없어도 앱이 만들지만, 첫 로그인 화면이 기본값으로 뜨는 편이 낫다.
-- ---------------------------------------------------------------------
insert into user_settings (user_id)
values (:chairman_uid)
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- 3. 이 부트스트랩 자체를 기록한다 (CH-051)
--    권한 부여는 permission_change다. 사람이 아니라 시스템이 한 일이라 actor는 null이다.
--    이 한 줄이 "회장 계정이 언제 어떻게 생겼는가"에 대한 유일한 답이 된다.
-- ---------------------------------------------------------------------
insert into audit_log (actor_user_id, actor_role, action, entity_table, entity_id, note)
values (
  null,
  null,
  'permission_change',
  'user_profiles',
  (:chairman_uid)::text,
  'bootstrap: 최초 Chairman 지정. supabase/bootstrap/0004_bootstrap_chairman.sql 수동 실행.'
);

commit;

-- ---------------------------------------------------------------------
-- 4. 확인 — 행이 정확히 1개, role이 Chairman, revoked_at이 null이어야 한다.
-- ---------------------------------------------------------------------
select p.user_id, p.role, p.display_name, p.max_security_class, p.revoked_at, u.email
  from user_profiles p
  join auth.users u on u.id = p.user_id
 where p.role = 'Chairman';
