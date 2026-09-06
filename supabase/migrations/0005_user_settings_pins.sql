-- =====================================================================
-- Chairman OS — 0005_user_settings_pins
--
-- 번호가 0004를 건너뛴다. supabase/bootstrap/0004_bootstrap_chairman.sql이 이미
-- 그 번호를 쓰고 있어서다. 그 파일은 migrations/ 밖에 있어 db push가 집지 않지만,
-- 같은 번호가 두 벌 돌아다니면 "0004를 돌렸나"가 두 가지를 뜻하게 된다.
-- 출처: 02_기능명세 CH-004 / 0001_init.sql businesses.pinned 주석
-- 작성: Phase 1-B (2026-09-06)
--
-- 왜 이 마이그레이션이 필요한가
--   0001은 businesses.pinned를 '기본 핀', user_settings.pinned_businesses를 '개인 핀'으로
--   나눠 두었다. 그런데 개인 핀 칸이 `not null default '{}'` 라서 두 상태를 구분하지 못한다.
--
--     아직 핀을 정한 적이 없다  → 기본 핀(biz_dy)이 떠야 한다
--     전부 해제했다              → 아무것도 뜨면 안 된다
--
--   둘 다 빈 배열로 저장되니, 사용자가 마지막 핀을 떼는 순간 기본 핀이 되살아난다.
--   화면에서는 "핀이 안 떼진다"로 보인다.
--
--   NULL을 '아직 정하지 않음'으로 쓰면 이 구분이 컬럼 하나로 그대로 표현된다.
--   localStorage 시절 pinned-businesses.ts가 빈 문자열(UNSET)로 하던 구분과 같다.
--
-- 숨김(hidden_businesses)은 그대로 둔다. 조직 차원의 '기본 숨김' 개념이 없어
--   빈 배열 = 숨긴 것 없음 하나뿐이고, 구분할 두 번째 상태가 없다.
-- =====================================================================

alter table user_settings
  alter column pinned_businesses drop not null,
  alter column pinned_businesses drop default;

comment on column user_settings.pinned_businesses is
  'CH-004 개인 핀. NULL = 아직 정한 적 없음(businesses.pinned를 기본값으로 쓴다). '
  '빈 배열 = 사용자가 전부 해제했다. 이 둘은 다른 상태다.';

-- 지금 있는 행은 0004_bootstrap_chairman.sql이 넣은 최초 Chairman의 빈 행뿐이고,
-- 아무도 아직 핀을 손댄 적이 없다. 그 행의 '{}'는 '전부 해제'가 아니라 '아직 정하지 않음'이므로
-- NULL로 되돌린다. 사람이 실제로 정한 값이 생긴 뒤에는 이 UPDATE를 다시 돌리면 안 된다.
update user_settings
   set pinned_businesses = null
 where pinned_businesses = '{}';
