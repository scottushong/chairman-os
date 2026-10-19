-- =====================================================================
-- Chairman OS — 0086_home_widgets («내 홈» — 직원별 위젯 배치)
-- 작성: 2026-10-20 · 원문 docs/specs/2026-10-20-home-widgets.txt · 시안 docs/specs/2026-10-20-home-widgets-mock.png · 결정 docs/decisions/2026-10-20-home-widgets.md
--
-- ■ 번호 ■ 0086은 0087(전자결재) · 0089(재무 보강)보다 앞 번호다. 이미 0087이 반영된 DB에는 «순서 밖»으로 들어간다 —
--   supabase db push는 --include-all이 있어야 적용한다(결정 문서 «반영 명령»). 이 파일은 0087 · 0089의 어떤 것에도 기대지 않는다
--   (0073 feature_on · 0002 is_active/auth_role만 쓴다) — 번호순(PGlite)으로도, 0089 뒤에 올려도 같은 결과.
--
-- ■ 모양 ■ home_layouts — 사람마다 한 줄(user_id = 기본키).
--   schema_version  배치 모양 판(지금 1). 앱이 모르는 판이면 기본 배치로 그린다(지우지 않는다).
--   revision        저장할 때마다 +1. 저장은 «내가 본 판»(p_expected)을 같이 보내고, 그 사이 다른 탭 · 기기가 저장했으면
--                   'home_conflict'로 거부한다 — 최신 설정을 무심코 덮어쓰지 않는다.
--   widgets         [{id, kind, size('s'|'m'|'l'), settings{filter?, items?}}] 배열 순서 = 화면 순서.
--                   kind는 모양만 본다(앱이 모르는 kind도 저장은 된다 — 새 위젯 · 없어진 위젯 때문에 배치를 지우지 않는다. 화면이 건너뛴다).
--
-- ■ 권한 ■ 읽기: RLS 본인 줄만(to authenticated · user_id = auth.uid()). 쓰기: 정의자 함수 home_layout_save만 —
--   사용자는 auth.uid()로 정한다(요청 본문의 사용자 id를 받지 않는다). 표에 insert · update · delete grant 없음.
--   시스템 계정(AIAgent · Integration) · 회수된 사람 · 스위치 꺼진 사람은 저장 못 한다.
-- ■ 스위치 ■ feature_on('home_widgets') — 기본 대표만. 그룹 줄 또는 내가 속한 회사 줄 하나라도 켜져 있으면 쓴다(0087 메뉴 규칙과 같다).
-- ■ 민감 정보 ■ 이 표에는 배치만 있다(위젯 내용은 각 기능의 기존 조회 · 기존 권한으로 화면이 따로 읽는다). 급여 · 원가 · 재무 숫자 없음.
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0085를 고치지 않는다. 새 정책 · grant는 늘 to authenticated.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 표
-- =====================================================================
create table home_layouts (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  schema_version int not null default 1 check (schema_version between 1 and 99),
  revision       int not null default 1 check (revision >= 1),
  widgets        jsonb not null default '[]'::jsonb check (jsonb_typeof(widgets) = 'array' and jsonb_array_length(widgets) <= 30),
  updated_at     timestamptz not null default now()
);
comment on table home_layouts is '0086. «내 홈» 개인 위젯 배치 — 사람마다 한 줄. 읽기는 본인만(RLS), 쓰기는 home_layout_save(정의자 · revision 충돌 검사)만.';
alter table home_layouts enable row level security;
revoke all on table home_layouts from public, anon, authenticated;
grant select on table home_layouts to authenticated;
create policy home_layouts_self_read on home_layouts for select to authenticated using (user_id = auth.uid());

-- =====================================================================
-- 2절. 판정 · 모양 검사
-- =====================================================================
/** 이 사람이 «내 홈»을 쓸 수 있나 — 사람 · 활성 · 스위치(그룹 줄 또는 내 회사 줄). */
create or replace function home_widgets_on() returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select auth.uid() is not null
     and is_active()
     and coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration')
     and (
       feature_on('home_widgets', null)
       or exists (select 1 from user_business_access a where a.user_id = auth.uid() and feature_on('home_widgets', a.business_id))
     );
$fn$;

/** 배치 모양 — 배열 · 30개 이하 · 20KB 이하 · 줄마다 id · kind · size · settings(객체) · id 겹침 없음. kind는 모양만 본다. */
create or replace function home_widgets_valid(p_widgets jsonb) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $fn$
declare
  w jsonb;
  ids text[] := '{}';
begin
  if p_widgets is null or jsonb_typeof(p_widgets) <> 'array' or jsonb_array_length(p_widgets) > 30 or octet_length(p_widgets::text) > 20000 then
    return false;
  end if;
  for w in select value from jsonb_array_elements(p_widgets) loop
    if jsonb_typeof(w) <> 'object' then return false; end if;
    if jsonb_typeof(w -> 'id') is distinct from 'string' or (w ->> 'id') !~ '^[a-z0-9_-]{1,40}$' then return false; end if;
    if jsonb_typeof(w -> 'kind') is distinct from 'string' or (w ->> 'kind') !~ '^[a-z][a-z0-9_]{1,30}$' then return false; end if;
    if (w ->> 'size') is null or (w ->> 'size') not in ('s', 'm', 'l') then return false; end if;
    if w ? 'settings' and jsonb_typeof(w -> 'settings') <> 'object' then return false; end if;
    if (w ->> 'id') = any(ids) then return false; end if;
    ids := ids || (w ->> 'id');
  end loop;
  return true;
end;
$fn$;

-- =====================================================================
-- 3절. 저장 — 본인 줄만 · revision 충돌 검사 · 모든 검사가 쓰기보다 먼저
--   p_expected  화면이 읽은 판(줄이 없었으면 0). 지금 판과 다르면 'home_conflict'(다른 탭 · 기기가 먼저 저장).
--   돌려주는 값 = 새 판.
-- =====================================================================
create or replace function home_layout_save(p_expected int, p_schema int, p_widgets jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  v_rev int;
  n     int;
begin
  if v_uid is null or not home_widgets_on() then
    raise exception 'home_denied' using errcode = '42501';
  end if;
  if p_expected is null or p_expected < 0 or p_schema is distinct from 1 or not home_widgets_valid(p_widgets) then
    raise exception 'home_invalid' using errcode = '22023';
  end if;

  select revision into v_rev from home_layouts where user_id = v_uid for update;
  if not found then
    if p_expected <> 0 then
      raise exception 'home_conflict' using errcode = '40001';
    end if;
    insert into home_layouts (user_id, schema_version, revision, widgets) values (v_uid, p_schema, 1, p_widgets)
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
  update home_layouts set schema_version = p_schema, revision = v_rev + 1, widgets = p_widgets, updated_at = now() where user_id = v_uid;
  return v_rev + 1;
end;
$fn$;

-- =====================================================================
-- 4절. 기능 스위치 · 함수 권한
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'home_widgets', true, 'chairman', '기본값(0086)')
on conflict do nothing;

revoke all on function home_widgets_valid(jsonb) from public, anon, authenticated;
revoke all on function home_widgets_on() from public, anon;
revoke all on function home_layout_save(int, int, jsonb) from public, anon;
grant execute on function home_widgets_on() to authenticated;
grant execute on function home_layout_save(int, int, jsonb) to authenticated;

commit;
