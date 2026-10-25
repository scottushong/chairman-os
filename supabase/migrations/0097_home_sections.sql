-- =====================================================================
-- Chairman OS — 0097_home_sections (대표 첫 화면 · 직원 홈 — 구역(Section) 층)
-- 작성: 2026-10-25 · 원문 docs/specs/2026-10-25-custom-dashboard.txt · 시안 docs/design/chairman-os-custom-sections-edit-mode.png
--       결정 docs/decisions/2026-10-25-custom-dashboard.md
--
-- ■ 원칙 ■ 0086 «내 홈» 위젯 엔진을 넓힌다 — 두 번째 위젯 표를 만들지 않는다. home_layouts에 칸 하나(sections)를 더할 뿐.
--   구조: 배치(사람마다 한 줄) → 구역(sections 배열) → 위젯(구역마다 widgets 배열 — 0086 home_widgets_valid 그대로).
--
-- ■ 모양 ■ schema_version 2 = sections를 쓴다. 판 1 줄(0086)은 그대로 읽힌다(앱이 «구역 하나»로 펼친다).
--   sections  [{id, title, hidden?, collapsed?, scope?{biz?, project?}, widgets[...]}] — 배열 순서 = 화면 순서.
--             scope.biz 'all' 또는 회사 id(데이터 범위 — 위젯은 기본으로 그 회사만), scope.project 프로젝트 id.
--             위젯 settings.scope가 있으면 구역 범위를 덮는다. 범위는 «보여 줄 것»을 좁힐 뿐 — 읽기는 각 기능의 RLS 그대로.
--   판 2로 저장하면 widgets 칸은 '[]'(직전 코드는 판 2를 모르는 판으로 보고 기본 배치를 그린다 — 지우지 않는다).
--   직전 코드가 다시 판 1로 저장하면 schema_version = 1 · widgets가 새 값 — 이 앱은 판 1 줄의 sections를 읽지 않는다.
--
-- ■ 권한 ■ 읽기: 0086 RLS 그대로(본인 줄만). 쓰기: 정의자 함수 home_layout_save_sections만 — 사용자는 auth.uid(),
--   revision 충돌은 0086 규칙(p_expected ≠ 지금 판 → home_conflict). 표 grant는 바꾸지 않는다(insert · update · delete 없음).
--   위젯 종류 문(home_kind_allowed): 재무 위젯은 대표 · 그룹 CFO만, 투자 위젯은 inv_reader()(대표 · /investment 지정자)만,
--   아침 루틴 판단 · 기억 검토함은 대표만. 직원이 그런 위젯을 넣은 배치는 저장 자체가 거부된다(home_kind_denied).
--   이 문은 배치만 막는다 — 위젯 내용은 각 기능의 기존 조회 · RLS로 따로 읽힌다(위젯을 더해도 볼 수 있는 것이 늘지 않는다).
--
-- ■ Expand-only ■ 새 칸 하나(null 허용 · 기본값 없음) · 새 함수 셋. 0086 표 · 칸 · 함수(home_layout_save)는 그대로 —
--   직전 코드가 이 DB 위에서 그대로 돈다. 스위치는 0086 home_widgets를 그대로 쓴다(새 줄 없음).
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0096을 고치지 않는다. 새 grant는 늘 to authenticated.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 칸
-- =====================================================================
alter table home_layouts add column if not exists sections jsonb;  -- [일반] 배치만(위젯 내용 · 숫자 없음)
alter table home_layouts add constraint home_layouts_sections_shape
  check (sections is null or (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) <= 12 and octet_length(sections::text) <= 60000));
comment on column home_layouts.sections is
  '0097. 구역 배치(schema_version 2) — [{id, title, hidden, collapsed, scope{biz, project}, widgets[]}]. 쓰기는 home_layout_save_sections만. 판 1 줄에서는 읽지 않는다.';

-- =====================================================================
-- 2절. 위젯 종류 문 · 구역 모양 검사
-- =====================================================================
/** 이 사람이 이 종류의 위젯을 배치에 둘 수 있나 — 재무(대표 · 그룹 CFO) · 투자(inv_reader) · 대표 전용. 그 밖(0086 위젯 · 모르는 종류)은 참. */
create or replace function home_kind_allowed(p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select case
    when p_kind in ('fin_kpis', 'cash_forecast', 'fin_checklist', 'companies')
      then coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO')
    when p_kind in ('inv_kpis', 'inv_buy_zone', 'inv_brief', 'inv_alerts', 'inv_monthly')
      then coalesce(inv_reader(), false)
    when p_kind in ('ai_judgment', 'memory_review')
      then coalesce(auth_role()::text, '') = 'Chairman'
    else true
  end;
$fn$;

/** 범위 모양 — 객체 · biz는 'all' 또는 회사 id 모양 · project는 id 모양. 빈 객체도 된다(물려받음). */
create or replace function home_scope_valid(p_scope jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $fn$
  select p_scope is null
      or (jsonb_typeof(p_scope) = 'object'
          and (not (p_scope ? 'biz') or (jsonb_typeof(p_scope -> 'biz') = 'string' and (p_scope ->> 'biz') ~ '^(all|[a-z][a-z0-9_]{1,40})$'))
          and (not (p_scope ? 'project') or jsonb_typeof(p_scope -> 'project') = 'null'
               or (jsonb_typeof(p_scope -> 'project') = 'string' and (p_scope ->> 'project') ~ '^[A-Za-z0-9_-]{1,60}$')));
$fn$;

/**
 * 구역 배치 모양 — 배열 · 12구역 · 60KB · 구역마다 id · 제목(1~40자) · 숨김/접힘(참거짓) · 범위 · widgets(0086 home_widgets_valid) ·
 * 위젯 id는 배치 전체에서 겹치지 않음 · 위젯 합계 60개 · 위젯 settings.scope 모양.
 */
create or replace function home_sections_valid(p_sections jsonb) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $fn$
declare
  s jsonb;
  w jsonb;
  sids text[] := '{}';
  wids text[] := '{}';
  total int := 0;
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) > 12 or octet_length(p_sections::text) > 60000 then
    return false;
  end if;
  for s in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(s) <> 'object' then return false; end if;
    if jsonb_typeof(s -> 'id') is distinct from 'string' or (s ->> 'id') !~ '^[a-z0-9_-]{1,40}$' or (s ->> 'id') = any(sids) then return false; end if;
    sids := sids || (s ->> 'id');
    if jsonb_typeof(s -> 'title') is distinct from 'string' or char_length(btrim(s ->> 'title')) not between 1 and 40 then return false; end if;
    if s ? 'hidden' and jsonb_typeof(s -> 'hidden') <> 'boolean' then return false; end if;
    if s ? 'collapsed' and jsonb_typeof(s -> 'collapsed') <> 'boolean' then return false; end if;
    if s ? 'scope' and not home_scope_valid(s -> 'scope') then return false; end if;
    if not home_widgets_valid(coalesce(s -> 'widgets', 'null'::jsonb)) then return false; end if;
    for w in select value from jsonb_array_elements(s -> 'widgets') loop
      if (w ->> 'id') = any(wids) then return false; end if;
      wids := wids || (w ->> 'id');
      if w -> 'settings' ? 'scope' and not home_scope_valid(w -> 'settings' -> 'scope') then return false; end if;
      total := total + 1;
    end loop;
  end loop;
  return total <= 60;
end;
$fn$;

-- =====================================================================
-- 3절. 저장 — 본인 줄만 · 0086 revision 규칙 · 종류 문 · 모든 검사가 쓰기보다 먼저
--   p_expected  화면이 읽은 판(줄이 없었으면 0). 돌려주는 값 = 새 판.
-- =====================================================================
create or replace function home_layout_save_sections(p_expected int, p_sections jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  v_rev int;
  v_kind text;
  n     int;
begin
  if v_uid is null or not home_widgets_on() then
    raise exception 'home_denied' using errcode = '42501';
  end if;
  if p_expected is null or p_expected < 0 or not home_sections_valid(p_sections) then
    raise exception 'home_invalid' using errcode = '22023';
  end if;
  for v_kind in select distinct w ->> 'kind' from jsonb_array_elements(p_sections) s, jsonb_array_elements(s -> 'widgets') w loop
    if not home_kind_allowed(v_kind) then
      raise exception 'home_kind_denied' using errcode = '42501';
    end if;
  end loop;

  select revision into v_rev from home_layouts where user_id = v_uid for update;
  if not found then
    if p_expected <> 0 then
      raise exception 'home_conflict' using errcode = '40001';
    end if;
    insert into home_layouts (user_id, schema_version, revision, widgets, sections) values (v_uid, 2, 1, '[]'::jsonb, p_sections)
      on conflict (user_id) do nothing;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'home_conflict' using errcode = '40001';
    end if;
    return 1;
  end if;

  if v_rev <> p_expected then
    raise exception 'home_conflict' using errcode = '40001';
  end if;
  update home_layouts set schema_version = 2, revision = v_rev + 1, widgets = '[]'::jsonb, sections = p_sections, updated_at = now() where user_id = v_uid;
  return v_rev + 1;
end;
$fn$;

-- =====================================================================
-- 4절. 함수 권한
-- =====================================================================
revoke all on function home_scope_valid(jsonb) from public, anon, authenticated;
revoke all on function home_sections_valid(jsonb) from public, anon, authenticated;
revoke all on function home_kind_allowed(text) from public, anon;
revoke all on function home_layout_save_sections(int, jsonb) from public, anon;
grant execute on function home_kind_allowed(text) to authenticated;
grant execute on function home_layout_save_sections(int, jsonb) to authenticated;

commit;
