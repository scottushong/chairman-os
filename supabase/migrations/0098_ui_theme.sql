-- =====================================================================
-- Chairman OS — 0098_ui_theme (화면 모양 스위치 — 새 모양 / 예전 모양)
-- 작성: 2026-10-26 · 원문 docs/specs/2026-10-26-design-refresh.txt · 시안 docs/design/chairman-os-custom-sections-edit-mode.png
--       결정 docs/decisions/2026-10-26-design-0098.md
--
-- ■ 무엇 ■ 사용자 설정(user_settings)에 칸 하나 — ui_theme. 'new'(새 모양) · 'classic'(예전 모양). 사람마다 고른다.
--   null = 고른 적 없음 = 새 모양(기본). 기본값을 칸에 두지 않는다 — «고른 적 없음»과 «새 모양을 골랐음»을 구분해 두고,
--   기본이 바뀌는 날 마이그레이션 없이 앱의 상수 한 줄로 바꾼다(lib/ui-prefs.ts UI_THEME_DEFAULT).
--
-- ■ 권한 ■ 0002 user_settings_own(본인 행만 · 모든 동작) 그대로. 남의 화면 모양은 대표도 못 읽는다. 표 grant는 바꾸지 않는다.
--
-- ■ Expand-only ■ 새 칸 하나(null 허용 · 기본값 없음) + 모양 제약. 기존 표 · 칸 · 정책 · 함수 변경 없음 —
--   직전 코드는 이 칸을 읽지도 쓰지도 않고(select 목록에 없음 · upsert에 안 실음) 그대로 돈다.
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0097을 고치지 않는다.
-- =====================================================================

begin;

alter table user_settings add column if not exists ui_theme text;  -- [일반] 화면 모양 하나(데이터 아님)

alter table user_settings add constraint user_settings_ui_theme_shape
  check (ui_theme is null or ui_theme in ('new', 'classic'));

comment on column user_settings.ui_theme is
  '0098. 화면 모양 — new(새 모양) · classic(예전 모양). null = 고른 적 없음 = 새 모양. 설정 → 화면 모양에서 본인이 고른다. 읽는 규칙은 lib/ui-prefs.ts 한 곳.';

commit;
