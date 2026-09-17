-- =====================================================================
-- Chairman OS — 0014_chairman_routine
-- 출처: Phase 3-B 회장 루틴 화면 (/ai 아침 루틴, /settings/chairman)
-- 작성: Phase 3-B (2026-09-17)
--
-- 무엇이 없어서 만드나
--   회장이 아침에 가장 먼저 보는 것은 회사 숫자가 아니라 '내가 무엇을 향해 가고 있나'다.
--   그 두 가지 — 몇 년짜리 장기 프로젝트와, 회장이 스스로 쓴 선언문 — 를 둘 자리가 없었다.
--
--   chairman_projects   장기 프로젝트. D-day와 경과율은 저장하지 않는다 — today 기준으로
--                       코드가 계산한다(lib/chairman-project.ts). 저장하면 하루 지나 틀린 값이 된다.
--                       CH-020 projects와 다른 표인 이유: 저쪽은 회사에 속한 업무 묶음이고
--                       progress_pct를 사람이 올린다. 이쪽은 회사가 없고 '진행'이 곧 시간이다.
--   chairman_manifesto  선언문 전문. 한 행뿐이다(id = 1).
--
-- 왜 시드가 없나
--   두 표의 내용은 회장 개인의 문장이다. git에 들어가면 저장소를 읽을 수 있는 모든 사람이
--   읽는다. 회장이 /settings/chairman 에서 직접 넣는다.
--
-- 권한
--   Chairman      읽기·쓰기
--   AIAgent       읽기만 — 야간 브리핑이 선언문의 원칙으로 우선순위를 매긴다(daily-brief.md)
--   그 외 역할     없음. GroupCFO도 못 읽는다 — 회사 데이터가 아니라 회장 개인의 기록이다.
-- =====================================================================

create table chairman_projects (
  project_id        uuid primary key default gen_random_uuid(),   -- [일반]
  title             text not null check (length(trim(title)) > 0), -- [제한]
  start_date        date not null,                                 -- [제한]
  target_date       date not null,                                 -- [제한]
  note              text not null default '',                      -- [제한]
  this_month_action text not null default '',                      -- [제한] 매달 바뀐다
  status            text not null default 'Active'
                    check (status in ('Active', 'Done', 'Dropped')), -- [일반]
  constraint chairman_projects_dates check (target_date > start_date)
);
comment on table chairman_projects is
  'Phase 3-B. 회장의 장기 프로젝트. D-day·경과율은 저장하지 않고 today 기준으로 계산한다.';

create table chairman_manifesto (
  id         smallint primary key default 1 check (id = 1),  -- 단일 행
  body       text not null default '',                       -- [제한] 줄바꿈·문단을 그대로 둔다
  updated_at timestamptz not null default now()              -- [일반]
);
comment on table chairman_manifesto is
  'Phase 3-B. 회장 선언문 전문. id = 1 한 행. 변경 이력은 audit_log(update)가 갖는다.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table chairman_projects  enable row level security;
alter table chairman_projects  force row level security;
alter table chairman_manifesto enable row level security;
alter table chairman_manifesto force row level security;

create policy chairman_projects_read on chairman_projects
  for select using (is_active() and auth_role() in ('Chairman', 'AIAgent'));
create policy chairman_projects_insert on chairman_projects
  for insert with check (auth_role() = 'Chairman');
create policy chairman_projects_update on chairman_projects
  for update using (auth_role() = 'Chairman') with check (auth_role() = 'Chairman');
create policy chairman_projects_delete on chairman_projects
  for delete using (auth_role() = 'Chairman');

create policy chairman_manifesto_read on chairman_manifesto
  for select using (is_active() and auth_role() in ('Chairman', 'AIAgent'));
create policy chairman_manifesto_insert on chairman_manifesto
  for insert with check (auth_role() = 'Chairman');
create policy chairman_manifesto_update on chairman_manifesto
  for update using (auth_role() = 'Chairman') with check (auth_role() = 'Chairman');

-- 0013과 같은 보장: 누가 나중에 permissive 쓰기 정책을 더해도 Agent에게는 열리지 않는다.
do $$
declare
  t text;
begin
  foreach t in array array['chairman_projects', 'chairman_manifesto'] loop
    execute format(
      'create policy ai_agent_no_insert on public.%I as restrictive for insert
         with check (auth_role() is distinct from %L)', t, 'AIAgent');
    execute format(
      'create policy ai_agent_no_update on public.%I as restrictive for update
         using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
      t, 'AIAgent', 'AIAgent');
    execute format(
      'create policy ai_agent_no_delete on public.%I as restrictive for delete
         using (auth_role() is distinct from %L)', t, 'AIAgent');
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 야간 브리핑의 장기 프로젝트별 '이번 주 행동'
-- ---------------------------------------------------------------------
-- 그룹 행(Daily Brief)에만 채워진다. items와 같은 등급·같은 모양 규칙.
alter table ai_night_outputs
  add column if not exists project_notes jsonb not null default '[]'::jsonb; -- [제한]
alter table ai_night_outputs
  add constraint ai_night_outputs_project_notes_array check (jsonb_typeof(project_notes) = 'array');
