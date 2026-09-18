-- =====================================================================
-- Chairman OS — 0017_initiatives
-- 출처: Phase 4-A 이니셔티브 · 키맨 · 캘린더
-- 작성: 2026-09-18
--
-- 무엇이 없어서 만드나
--   이 앱은 회사 다섯 곳을 본다. 그런데 회장이 실제로 굴리는 것은 그 다섯 곳만이 아니다 —
--   딜·신사업·투자유치·법인 설립이 열네 건 넘게 동시에 돈다. 지금 그것들이 있는 곳은
--   회장의 머리와 카톡이다. 그래서 '무엇이 멈춰 있는가'를 아무도 못 센다.
--
--   initiatives        회사에 속하지 않는 일. business_id는 있을 수도 없을 수도 있다.
--   initiative_keymen  그 일의 사람들. business_keymen과 같은 모양 + 연락 수단(channel).
--   initiative_docs    링크만. 파일 실체는 사내 스토리지다(CLAUDE.md 데이터 원칙).
--   events             출장·미팅·마감. 이니셔티브에도 회사에도 안 걸릴 수 있다.
--   calendar_items     위 넷과 마일스톤·결재 마감을 한 줄 모양으로 합친 뷰.
--
-- 왜 projects와 따로 두나
--   CH-020 projects는 회사에 속하고 progress_pct를 사람이 올린다. 이쪽은 회사가 없을 수 있고
--   '진행'이 단계(stage)다. 0014 chairman_projects와도 다르다 — 저쪽은 몇 년짜리 한 줄 목표고
--   이쪽은 다음 행동이 있는 살아 있는 건이다.
--
-- 왜 시드가 없나
--   0014와 같은 이유다. 회장이 지금 누구와 무엇을 협상 중인지가 git에 들어가면
--   저장소를 읽을 수 있는 모든 사람이 읽는다. 회장이 화면에서 직접 넣는다.
--
-- 권한
--   Chairman · GroupCFO   읽기 · 쓰기
--   AIAgent               읽기만 — 야간 브리핑이 멈춘 건을 집어낸다(daily-brief.md)
--   그 외 역할             없음. 회사 데이터가 아니다.
--   회장 메모(initiative_notes)만 Chairman 전용 — chairman_manifesto와 같은 성격이다(0014).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. user_profiles 영문 표기
--    대외 문서·영문 서명에 쓸 이름이 없어서 코드가 음차하거나 한글을 그대로 내보냈다.
--    음차는 사람마다 답이 갈린다. 본인이 쓰는 철자가 유일한 정답이라 사람이 넣는 칸으로 둔다.
--    null을 허용한다 — 강제하면 계정 만들 때 모르는 값을 지어내게 된다.
--    읽는 쪽은 coalesce(display_name_en, display_name)로 떨어진다.
-- ---------------------------------------------------------------------
alter table user_profiles
  add column if not exists display_name_en text;

comment on column user_profiles.display_name_en is
  '영문 표기. 본인이 쓰는 철자를 그대로 넣는다 — 코드가 음차하지 않는다. 비면 display_name으로 떨어진다.';

-- UID가 아니라 role로 집는다. UID는 prod와 staging이 다르고 마이그레이션에 박을 값이 아니다.
-- 이미 값이 있으면 건드리지 않는다 — 사람이 고친 표기를 마이그레이션이 되돌리면 안 된다.
update user_profiles
   set display_name_en = 'Edison S. Hong'
 where role = 'Chairman'
   and display_name_en is null;

-- ---------------------------------------------------------------------
-- 2. 이니셔티브
--    id는 사람이 읽는 코드다(ini_001). audit_log와 주소창에 그대로 나간다.
--    stage와 status를 따로 둔다 — stage는 '어디까지 갔나'고 status는 '살아 있나'다.
--    끝난 건은 status='Done'이고 그때 stage는 'Closing'에 멈춰 있다.
--    next_action_* 세 칸이 이 표의 존재 이유다. '무엇을 하기로 했는가'가 없으면 목록일 뿐이다.
-- ---------------------------------------------------------------------
create table initiatives (
  initiative_id     text primary key,                                              -- [일반]
  title             text not null check (length(trim(title)) > 0),                 -- [제한]
  kind              text not null                                                  -- [일반]
                    check (kind in ('NewBiz', 'Deal', 'Fundraise', 'Entity', 'Internal')),
  business_id       text references businesses(business_id) on delete set null,     -- [일반] null = 회사에 안 걸린 건
  stage             text not null default 'Planning'                                -- [일반]
                    check (stage in ('Planning', 'Contact', 'Negotiation', 'Execution', 'Closing', 'Halted')),
  goal              text not null default '',                                       -- [제한]
  target_date       date,                                                           -- [제한] null = 목표일 없음
  next_action       text not null default '',                                       -- [제한]
  next_action_date  date,                                                           -- [제한]
  next_action_owner text not null default '',                                        -- [제한] 사람 이름이 들어온다
  blocker           text not null default '',                                        -- [제한]
  status            text not null default 'Active'                                   -- [일반]
                    check (status in ('Active', 'Done', 'Dropped')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table initiatives is
  'Phase 4-A. 회사 밖에서 회장이 직접 굴리는 건. business_id는 선택이다 — 회사에 안 걸리는 딜이 있다.';
comment on column initiatives.next_action_date is
  '다음 행동의 기한. 캘린더와 야간 브리핑이 이 값을 본다. null이면 기한 없는 행동이다.';

-- ini_001 꼴. decisions/documents와 같은 시퀀스 방식이다(0010, 0007).
create sequence initiatives_ini_seq owned by initiatives.initiative_id;
alter table initiatives
  alter column initiative_id set default 'ini_' || to_char(nextval('initiatives_ini_seq'), 'FM000');
grant usage on sequence initiatives_ini_seq to authenticated;

create index initiatives_by_status on initiatives (status, next_action_date nulls last);
create index initiatives_by_business on initiatives (business_id) where business_id is not null;

create trigger initiatives_updated_at before update on initiatives
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 3. 회장 메모
--    initiatives 안의 칸으로 두지 않는다. Postgres RLS는 행 단위라 한 표 안에서
--    이 칸만 GroupCFO에게 가릴 방법이 없다. 0014가 chairman_manifesto를 따로 둔 것과 같은 이유다.
--    이니셔티브를 지우면 메모도 같이 간다.
-- ---------------------------------------------------------------------
create table initiative_notes (
  initiative_id text primary key references initiatives(initiative_id) on delete cascade,
  note          text not null default '',                  -- [Vault 성격] 회장 개인의 판단이다
  updated_at    timestamptz not null default now()
);
comment on table initiative_notes is
  'Phase 4-A. 회장 개인의 메모. GroupCFO도 못 읽는다 — 회사 데이터가 아니라 회장의 판단이다(0014 chairman_manifesto와 같다).';

create trigger initiative_notes_updated_at before update on initiative_notes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 4. 키맨 · 문서 · 이벤트
--    키맨은 business_keymen과 같은 모양이다. 화면에서 같은 패널이 둘 다 그린다.
--    다른 것은 channel 하나 — 딜은 누구와 어느 창구로 말하고 있는지가 곧 진행 상황이다.
-- ---------------------------------------------------------------------
create table initiative_keymen (
  keyman_id       uuid primary key default gen_random_uuid(),                          -- [일반]
  initiative_id   text not null references initiatives(initiative_id) on delete cascade, -- [일반]
  name            text not null check (length(trim(name)) > 0),                        -- [제한]
  relation        text not null default '',                                            -- [제한] 예: 대표 / 투자심사역
  channel         text not null default 'Other'                                        -- [제한]
                  check (channel in ('KakaoTalk', 'WeChat', 'Email', 'Phone', 'Other')),
  last_contact_on date,                                                                -- [제한] null = 기록 없음
  note            text not null default '',                                            -- [제한]
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table initiative_keymen is
  'Phase 4-A. 이니셔티브의 사람. business_keymen과 같은 모양 + channel. 이름과 관계는 [제한] 등급이다.';

create index initiative_keymen_by_initiative on initiative_keymen (initiative_id, name);
create trigger initiative_keymen_updated_at before update on initiative_keymen
  for each row execute function set_updated_at();

-- 문서는 링크만 둔다. 파일 실체는 사내 스토리지다(CLAUDE.md 데이터 원칙, vault_columns.md 선택지 B).
create table initiative_docs (
  doc_id        uuid primary key default gen_random_uuid(),                            -- [일반]
  initiative_id text not null references initiatives(initiative_id) on delete cascade,  -- [일반]
  title         text not null check (length(trim(title)) > 0),                          -- [제한]
  url           text not null check (url ~ '^https?://'),                               -- [제한]
  created_at    timestamptz not null default now()
);
comment on table initiative_docs is
  'Phase 4-A. 이니셔티브 문서 링크. 파일을 담지 않는다 — 링크만이다.';

create index initiative_docs_by_initiative on initiative_docs (initiative_id, created_at);

-- 이벤트는 이니셔티브에도 회사에도 안 걸릴 수 있다. 회장의 출장이 늘 딜 때문인 것은 아니다.
create table events (
  event_id      uuid primary key default gen_random_uuid(),                            -- [일반]
  title         text not null check (length(trim(title)) > 0),                          -- [제한]
  starts_on     date not null,                                                          -- [일반]
  ends_on       date,                                                                   -- [일반] null = 하루짜리
  kind          text not null default 'Other'                                           -- [일반]
                check (kind in ('Trip', 'Meeting', 'Deadline', 'Other')),
  initiative_id text references initiatives(initiative_id) on delete set null,           -- [일반]
  business_id   text references businesses(business_id) on delete set null,              -- [일반]
  location      text not null default '',                                                -- [제한]
  note          text not null default '',                                                -- [제한]
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint events_range check (ends_on is null or ends_on >= starts_on)
);
comment on table events is
  'Phase 4-A. 회장의 일정. 하루짜리는 ends_on이 null이다 — starts_on을 복사해 넣지 않는다.';

create index events_by_date on events (starts_on, ends_on);
create trigger events_updated_at before update on events
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 5. RLS — Default Deny
--    읽기: Chairman · GroupCFO · AIAgent.  쓰기: Chairman · GroupCFO.
--    회사에 걸린 이니셔티브라도 has_business()를 보지 않는다 — 이 표는 전사 역할만 읽는다.
--    BusinessCEO에게 자기 회사 딜을 보여 주면 '회장이 그 회사를 어떻게 하려는지'가 같이 보인다.
--    회장 메모는 Chairman만. AIAgent도 못 읽는다 — 브리핑이 회장의 판단을 되읊을 이유가 없다.
-- ---------------------------------------------------------------------
alter table initiatives       enable row level security;
alter table initiatives       force  row level security;
alter table initiative_notes  enable row level security;
alter table initiative_notes  force  row level security;
alter table initiative_keymen enable row level security;
alter table initiative_keymen force  row level security;
alter table initiative_docs   enable row level security;
alter table initiative_docs   force  row level security;
alter table events            enable row level security;
alter table events            force  row level security;

create or replace function can_read_initiatives() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and auth_role() in ('Chairman', 'GroupCFO', 'AIAgent');
$fn$;

create or replace function can_write_initiatives() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and auth_role() in ('Chairman', 'GroupCFO');
$fn$;

create policy initiatives_read  on initiatives for select using (can_read_initiatives());
create policy initiatives_write on initiatives for all
  using (can_write_initiatives()) with check (can_write_initiatives());

create policy initiative_keymen_read  on initiative_keymen for select using (can_read_initiatives());
create policy initiative_keymen_write on initiative_keymen for all
  using (can_write_initiatives()) with check (can_write_initiatives());

create policy initiative_docs_read  on initiative_docs for select using (can_read_initiatives());
create policy initiative_docs_write on initiative_docs for all
  using (can_write_initiatives()) with check (can_write_initiatives());

create policy events_read  on events for select using (can_read_initiatives());
create policy events_write on events for all
  using (can_write_initiatives()) with check (can_write_initiatives());

-- 회장 메모만 다르다.
create policy initiative_notes_all on initiative_notes for all
  using (is_active() and auth_role() = 'Chairman')
  with check (is_active() and auth_role() = 'Chairman');

-- AIAgent·Integration 쓰기 차단은 restrictive로 한 번 더 건다(0015 방식).
-- 위의 permissive 정책이 나중에 느슨해져도 이 줄이 남는다.
do $$
declare
  t text;
begin
  foreach t in array array['initiatives', 'initiative_keymen', 'initiative_docs', 'events'] loop
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

  foreach t in array array['initiatives', 'initiative_notes', 'initiative_keymen', 'initiative_docs', 'events'] loop
    execute format(
      'create policy integration_no_insert on public.%I as restrictive for insert
         with check (not is_integration())', t);
    execute format(
      'create policy integration_no_update on public.%I as restrictive for update
         using (not is_integration()) with check (not is_integration())', t);
    execute format(
      'create policy integration_no_delete on public.%I as restrictive for delete
         using (not is_integration())', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 6. 캘린더 한 줄 모양
--    네 원천을 화면에서 합치지 않는다. 합치면 /calendar가 매번 네 번 질의하고,
--    정렬과 범위 자르기를 JS가 한다 — 항목이 늘면 그 자리가 먼저 무너진다.
--    security_invoker=true라 각 원천의 RLS가 부르는 사람 기준으로 그대로 걸린다.
--    즉 Executive가 이 뷰를 읽으면 이니셔티브 줄은 0행이고 자기 회사 마일스톤만 나온다.
--    href를 뷰가 만든다 — 화면이 kind별 분기를 다시 쓰지 않게.
-- ---------------------------------------------------------------------
create view calendar_items
with (security_invoker = true) as
  select 'event'::text            as kind,
         e.event_id::text         as source_id,
         e.title                  as title,
         e.starts_on              as on_date,
         e.ends_on                as ends_on,
         e.business_id            as business_id,
         e.initiative_id          as initiative_id,
         case when e.initiative_id is not null
              then '/initiatives/' || e.initiative_id
              else '/calendar' end as href
    from events e
  union all
  select 'next_action',
         i.initiative_id,
         i.title || ' — ' || i.next_action,
         i.next_action_date,
         null::date,
         i.business_id,
         i.initiative_id,
         '/initiatives/' || i.initiative_id
    from initiatives i
   where i.status = 'Active'
     and i.next_action_date is not null
     and length(trim(i.next_action)) > 0
  union all
  select 'milestone',
         m.milestone_id,
         m.title,
         m.deadline,
         null::date,
         m.business_id,
         null::text,
         case when m.business_id is not null
              then '/business/' || m.business_id
              else '/calendar' end
    from milestones m
   where m.done_at is null
  union all
  select 'decision',
         d.decision_id,
         d.title,
         d.deadline,
         null::date,
         d.business_id,
         null::text,
         '/approvals'
    from decisions d
   where d.status = 'Open'
     and d.deadline is not null;

comment on view calendar_items is
  'Phase 4-A. 캘린더 한 줄 모양. 네 원천을 DB에서 합친다. security_invoker=true라 각 표의 RLS가 그대로 걸린다.';

commit;
