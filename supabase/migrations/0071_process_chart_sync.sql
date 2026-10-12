-- =====================================================================
-- Chairman OS — 0071_process_chart_sync (프로세스 차트 메뉴 · 구글 시트 → 업무 관리 · 캘린더 동기화)
-- 작성: 2026-10-12 · 대표 결정(같은 날): 사이드 메뉴 «프로세스 차트»(/process-charts)를 세우고, 시트 내용이
-- 업무 관리(/tasks)와 캘린더에 들어오게 한다. 시트 → 앱 한 방향(읽기 전용). 시트가 원천이다.
--
-- ■ 무엇을 만드나 ■
--   process_charts       sheet_id · sheet_tab 칸(구글 Sheets API로 읽을 파일 ID · 탭 이름) · team_id(팀 판정). 끼워 넣기(embed_url)는 그대로.
--                        읽기 정책 교체 — 임원 이상은 자기 회사 탭 전부, 팀장 · 팀원은 **자기 팀 탭만**(0021은 팀장 이하 0행).
--   process_chart_items  시트 한 줄 = 한 줄. (회사, 팀, 시트 ID) unique — 같은 업무가 두 번 들어가지 않는다.
--                        시트에서 사라진 줄은 지우지 않고 gone_at(«시트에서 사라짐»)으로 남긴다.
--   process_chart_syncs  동기화 기록(언제 · 누가(null = 자동) · 팀 · 읽은 줄 · 새로 · 바뀜 · 사라짐 · 건너뜀 · 경고 목록 · 실패 문장).
--   tasks                source_label(«프로세스 차트 · <팀>», null = 앱 업무) · source_gone_at 칸.
--                        **동기화로 들어온 업무는 앱에서 고치지 못한다** — restrictive 정책. 고칠 곳은 시트다.
--   calendar_items       뷰에 다섯째 원천 'process'(시작일 또는 마감일이 있는 시트 줄). 캘린더는 0017 뷰로 그려지므로
--                        새 일정 표를 만들지 않고 뷰에 한 갈래를 더한다(href = /tasks/<업무>).
--   함수   process_chart_visible_to(user, biz, team)  누가 그 탭을 보는가 — 정책 · 동기화 함수가 같이 쓴다.
--          can_read_process_chart(biz, team)           위를 auth.uid()로.
--          process_chart_sync_targets()               AI Agent: 시트가 연결된 탭 목록(새벽 cron).
--          process_chart_sync_apply(…)                AI Agent: 앱 서버가 시트에서 읽은 줄을 넣는다(한 트랜잭션).
--          process_chart_sync_fail(…)                 AI Agent: 읽기 실패를 기록에 남긴다.
--
-- ■ 쓰기는 왜 AI Agent 세션만인가 ■
--   줄은 구글에서 오고, 구글을 읽는 것은 앱 서버(서비스 계정 GOOGLE_SHEETS_SA_JSON)다. DB는 그 줄이 진짜 시트에서
--   왔는지 확인할 길이 없다. 사람 세션이 apply를 부를 수 있으면 같은 팀 사람이 PostgREST로 가짜 줄을 넣어
--   남의 이름으로 업무를 만들 수 있다. 그래서 **사람은 이 함수를 못 부르고**, 앱 서버가 «이 사람이 이 탭을 보는가»를
--   그 사람 세션으로 확인한 뒤 AI Agent 계정(야간 브리핑과 같은 로그인 — service_role 아님)으로 부른다.
--   누가 눌렀는지는 p_requested_by로 받고, 함수가 그 사람이 정말 그 탭을 보는지 다시 확인한다.
--
-- ■ FORCE를 내리는 표 둘 ■
--   process_charts · tasks. 0002/0021이 FORCE를 걸어 두어 정의자 함수(소유자 postgres, Supabase에서 BYPASSRLS 아님)가
--   정책 아래로 내려간다 — AI Agent에게는 process_charts 읽기 정책도 tasks 넣기 정책도 없어 동기화가 0행이 된다.
--   0023 · 0027 · 0029 · 0034와 같은 판단: 이 저장소의 자물쇠는 revoke와 정책이지 FORCE가 아니다. 새 FORCE는 걸지 않는다.
--
-- ■ 지키는 것 ■
--   · 지우기 없음 — 사라진 줄은 gone_at, 업무는 그대로(«시트에서 사라짐» 표시).
--   · 정책 · 권한은 늘 to authenticated. 함수는 public · anon에서 이름으로 회수.
--   · 같은 팀 동기화는 1분에 1번(성공 · 실패 기록을 다 센다). process_charts 줄을 for update로 잡아 동시 동기화를 줄 세운다.
--   · 시트 내용은 AI 경로(프롬프트 · 야간 브리핑)에 넣지 않는다 — 이 파일은 AI 표를 건드리지 않는다.
--
-- 0035 규칙: 0001~0070을 고치지 않는다. calendar_items는 create or replace(0017 본문 그대로 + 한 갈래).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. FORCE 내리기 (머리 주석 «FORCE를 내리는 표 둘»)
-- =====================================================================
alter table process_charts no force row level security;
alter table tasks no force row level security;

-- =====================================================================
-- 2절. process_charts — 시트 파일 ID · 탭 이름
--   파일 ID는 편집 주소 /spreadsheets/d/<ID>/edit의 <ID>다. 주소 전체가 아니라 ID만 저장한다 —
--   편집 주소를 저장하면 언젠가 누가 그것을 iframe에 건다(0021이 막으려던 그 사고).
-- =====================================================================
alter table process_charts
  add column if not exists sheet_id  text check (sheet_id is null or sheet_id ~ '^[A-Za-z0-9_-]{20,100}$'),  -- [일반]
  add column if not exists sheet_tab text check (sheet_tab is null or (length(btrim(sheet_tab)) between 1 and 100 and sheet_tab !~ '[''!]'));  -- [일반]

comment on column process_charts.sheet_id is
  '0071. 구글 시트 파일 ID(편집 주소의 /d/<ID>/). 앱 서버가 서비스 계정(spreadsheets.readonly)으로 읽는다. null = 연결 전.';
comment on column process_charts.sheet_tab is
  '0071. 읽을 탭 이름. null이면 첫 탭. 작은따옴표 · 느낌표는 범위 문법과 부딪혀 받지 않는다.';

-- 감사 트리거에 새 두 칸을 싣는다. 시트가 바뀌면 업무 관리에 들어오는 줄이 통째로 바뀐다.
create or replace function process_charts_audit() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (
    case tg_op
      when 'INSERT' then 'create'
      when 'UPDATE' then 'update'
      else 'delete_request'
    end::audit_action,
    'process_charts',
    coalesce(new.id, old.id)::text,
    coalesce(new.business_id, old.business_id),
    auth.uid(),
    auth_role()::text,
    case when tg_op in ('UPDATE', 'DELETE')
         then jsonb_build_object('team_name', old.team_name, 'title', old.title, 'embed_url', old.embed_url,
                                 'sheet_id', old.sheet_id, 'sheet_tab', old.sheet_tab) end,
    case when tg_op in ('INSERT', 'UPDATE')
         then jsonb_build_object('team_name', new.team_name, 'title', new.title, 'embed_url', new.embed_url,
                                 'sheet_id', new.sheet_id, 'sheet_tab', new.sheet_tab) end,
    case tg_op when 'DELETE' then '프로세스차트 링크 삭제' else '프로세스차트' end
  );
  return coalesce(new, old);
end;
$fn$;

comment on function process_charts_audit is
  '0071. 0022 그대로 + sheet_id · sheet_tab.';

-- =====================================================================
-- 3절. 누가 그 탭을 보는가
--   임원 이상(Chairman · GroupCFO · BusinessCEO · Executive) = 자기 회사 탭 전부.
--   팀장 · 팀원 = 자기 팀(user_profiles.team_id) 탭만.
--
--   **teams를 판정 중에 읽지 않는다.** teams는 FORCE(0025, check-migrations가 지킨다)라 정의자 안에서도
--   호출자의 teams_read(has_business)를 탄다 — AI Agent 세션(동기화)에서는 0행이 되어 «눌렀던 팀원»이
--   자기 탭을 못 보는 것으로 판정된다. 그래서 process_charts에 team_id를 적어 두고(3-1) user_profiles.team_id와
--   바로 비교한다. team_id는 저장할 때 트리거가 같은 회사 · 같은 이름의 팀에서 찾는다(저장하는 사람은 대표 · CFO라
--   teams_read를 통과한다). 팀 이름을 바꾸면 그 탭을 한 번 다시 저장해야 팀원에게 보인다(DEFERRED).
--
--   사람 id를 인자로 받는 판(process_chart_visible_to)을 따로 두는 이유: 동기화 함수는 AI Agent 세션으로 돌면서
--   «눌렀던 그 사람»이 탭을 보는지 확인해야 한다. auth.uid()만 보는 has_business()로는 그 질문을 못 한다.
--   has_business()의 뜻(그룹 범위 = Chairman · GroupCFO, 나머지 = user_business_access)을 그대로 옮겨 적었다.
-- =====================================================================

-- 3-1. process_charts.team_id
alter table process_charts
  add column if not exists team_id text references teams(team_id);   -- [일반] 팀원 · 팀장 판정용

comment on column process_charts.team_id is
  '0071. 같은 회사 · 같은 이름(team_name)의 teams.team_id. 저장 때 트리거가 채운다. 팀장 · 팀원은 user_profiles.team_id가 이 값일 때만 탭을 본다.';

create or replace function process_charts_team_fill() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  select t.team_id into new.team_id
    from teams t where t.business_id = new.business_id and t.name = btrim(new.team_name)
   limit 1;
  return new;
end;
$fn$;

create trigger process_charts_team_fill_trigger
  before insert or update of business_id, team_name on process_charts
  for each row execute function process_charts_team_fill();

-- 이미 있는 탭(0021 · 0036 시드)을 채운다. 마이그레이션 세션은 auth.uid()가 null이라 FORCE 걸린 teams를 0행으로 본다 —
-- 이 문장 동안만 teams의 FORCE를 내렸다 올린다(0034 6절 audit_log와 같은 춤). 감사 트리거는 이 채우기를 적지 않는다
-- (사람이 바꾼 것이 아니고, 마이그레이션 세션에서 audit_log도 FORCE다).
alter table teams no force row level security;
alter table process_charts disable trigger process_charts_audit_trigger;
update process_charts c set team_id = t.team_id
  from teams t where t.business_id = c.business_id and t.name = c.team_name and c.team_id is null;
alter table process_charts enable trigger process_charts_audit_trigger;
alter table teams force row level security;

create or replace function process_chart_visible_to(p_user uuid, p_business text, p_team text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_user is not null and p_business is not null and exists (
    select 1 from user_profiles p
     where p.user_id = p_user and p.revoked_at is null
       and (
         p.role in ('Chairman', 'GroupCFO')
         or (
           exists (select 1 from user_business_access a where a.user_id = p_user and a.business_id = p_business)
           and (
             p.role in ('BusinessCEO', 'Executive')
             or (p.role in ('TeamLead', 'Member') and p.team_id is not null and exists (
                   select 1 from process_charts c
                    where c.business_id = p_business and c.team_name = p_team and c.team_id = p.team_id))
           )
         )
       )
  );
$fn$;

comment on function process_chart_visible_to(uuid, text, text) is
  '0071. 이 사람이 이 회사 · 팀의 프로세스 차트 탭을 보는가. 임원 이상 = 자기 회사 전부, 팀장 · 팀원 = 자기 팀만.';

create or replace function can_read_process_chart(p_business text, p_team text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and process_chart_visible_to(auth.uid(), p_business, p_team);
$fn$;

comment on function can_read_process_chart(text, text) is
  '0071. 정책용 — auth.uid()가 이 탭을 보는가(is_active 포함 — 원격 로그아웃 · 회수가 여기서 걸린다).';

-- 0021 정책 교체. 쓰기 정책(대표 · CFO)은 그대로다.
drop policy if exists process_charts_read on process_charts;
create policy process_charts_read on process_charts
  for select to authenticated using (can_read_process_chart(business_id, team_name));

comment on function can_read_process_charts(text) is
  '0021. 0071부터 정책은 can_read_process_chart(biz, team)을 쓴다. 이 함수는 남겨 둔다(지우지 않는다).';

-- =====================================================================
-- 4절. 표 — 시트 줄 · 동기화 기록
-- =====================================================================
create table process_chart_items (
  id              bigint generated always as identity primary key,
  business_id     text not null references businesses(business_id),                -- [일반]
  team_name       text not null check (length(btrim(team_name)) > 0),               -- [일반]
  chart_id        bigint references process_charts(id) on delete set null,          -- [일반] 링크를 지워도 줄 · 업무는 남는다
  sheet_row_id    text not null check (length(btrim(sheet_row_id)) between 1 and 100), -- [일반] 시트의 ID 칸
  stage           text check (stage is null or length(stage) <= 200),               -- [일반] 단계
  title           text not null check (length(btrim(title)) between 1 and 500),     -- [일반] 업무명
  assignee_email  text check (assignee_email is null or length(assignee_email) <= 320), -- [제한] 담당자 이메일(시트 값 그대로)
  owner_user_id   uuid references auth.users(id),                                   -- [제한] 찾은 직원. null = 담당 미정
  start_on        date,                                                             -- [일반]
  due_on          date,                                                             -- [일반]
  status          text not null default '예정' check (status in ('예정', '진행', '완료', '보류')), -- [일반]
  note            text check (note is null or length(note) <= 2000),                -- [일반] 비고
  task_id         text references tasks(task_id),                                   -- [일반] 업무 관리의 그 업무
  gone_at         timestamptz,                                                      -- [일반] 시트에서 사라진 때. null = 시트에 있다
  first_synced_at timestamptz not null default now(),
  last_synced_at  timestamptz not null default now(),
  unique (business_id, team_name, sheet_row_id)
);

comment on table process_chart_items is
  '0071. 프로세스 차트 시트 한 줄. (회사, 팀, 시트 ID)가 같은 업무다. 시트에서 사라지면 지우지 않고 gone_at을 적는다. 쓰기는 process_chart_sync_apply만.';

create index process_chart_items_by_team on process_chart_items (business_id, team_name, gone_at);
create index process_chart_items_by_task on process_chart_items (task_id);

create table process_chart_syncs (
  id             bigint generated always as identity primary key,
  business_id    text not null references businesses(business_id),
  team_name      text not null,
  chart_id       bigint references process_charts(id) on delete set null,
  synced_at      timestamptz not null default now(),
  actor_user_id  uuid references auth.users(id),                                    -- null = 자동(새벽 cron)
  trigger        text not null check (trigger in ('button', 'open', 'cron')),
  ok             boolean not null,
  error          text check (error is null or length(error) <= 500),
  read_count     int not null default 0 check (read_count >= 0),
  new_count      int not null default 0 check (new_count >= 0),
  changed_count  int not null default 0 check (changed_count >= 0),
  gone_count     int not null default 0 check (gone_count >= 0),
  skipped_count  int not null default 0 check (skipped_count >= 0),
  warnings       jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array')
);

comment on table process_chart_syncs is
  '0071. 프로세스 차트 동기화 한 번 = 한 줄. actor_user_id null = 자동(cron). 실패도 남는다(ok = false, error).';

create index process_chart_syncs_by_team on process_chart_syncs (business_id, team_name, synced_at desc);

alter table process_chart_items enable row level security;
alter table process_chart_syncs enable row level security;

create policy process_chart_items_read on process_chart_items
  for select to authenticated using (can_read_process_chart(business_id, team_name));
create policy process_chart_syncs_read on process_chart_syncs
  for select to authenticated using (can_read_process_chart(business_id, team_name));

revoke all on table process_chart_items from anon, public;
revoke all on table process_chart_syncs from anon, public;
revoke insert, update, delete, truncate, references, trigger on table process_chart_items from authenticated;
revoke insert, update, delete, truncate, references, trigger on table process_chart_syncs from authenticated;
grant select on process_chart_items to authenticated;
grant select on process_chart_syncs to authenticated;

-- =====================================================================
-- 5절. tasks — 출처 칸 · 앱에서 고치기 막기
-- =====================================================================
alter table tasks
  add column if not exists source_label   text check (source_label is null or length(source_label) <= 120), -- [일반] «프로세스 차트 · 영업». null = 앱 업무
  add column if not exists source_gone_at timestamptz;                                                       -- [일반] 시트에서 사라진 때

comment on column tasks.source_label is
  '0071. 바깥 원천. null = 앱 업무. «프로세스 차트 · <팀>»이면 시트가 원천이라 앱에서 고치지 못한다(tasks_external_readonly).';
comment on column tasks.source_gone_at is
  '0071. 원천(시트)에서 그 줄이 사라진 때. 업무는 지우지 않고 «시트에서 사라짐»으로 보인다.';

-- 사람 세션은 시트에서 온 업무를 고치지 못한다. 동기화 함수는 정의자(소유자 — FORCE를 내렸으므로 정책 밖)라 지나간다.
create policy tasks_external_readonly on tasks as restrictive
  for update to authenticated
  using (source_label is null)
  with check (source_label is null);

-- 리뷰 B: 담당자를 못 찾은 시트 업무는 owner_user_id가 null이라 0026 owner_unknown(null) = true — 회사 사람 전부가
-- 다른 팀 시트 업무를 /tasks에서 본다. 시트 업무는 «담당자 본인 또는 그 탭을 보는 사람»으로 좁힌다
-- (process_chart_items의 RLS가 can_read_process_chart로 탭 보기를 판정한다). AI Agent는 시트 업무를 아예 못 읽는다 —
-- 시트 내용은 AI 경로에 넣지 않는다(동기화 함수는 정의자 = 소유자라 이 정책 밖이다).
create policy tasks_external_scope on tasks as restrictive
  for select to authenticated
  using (
    source_label is null
    or (
      auth_role() is distinct from 'AIAgent'
      and (owner_user_id = auth.uid()
           or exists (select 1 from process_chart_items i where i.task_id = tasks.task_id))
    )
  );

-- =====================================================================
-- 6절. 캘린더 — calendar_items에 'process' 갈래
--   0017 본문 그대로 + 맨 아래 한 갈래. security_invoker라 process_chart_items(탭 보기)와 tasks(업무 보기)의
--   RLS가 둘 다 걸린다 — 탭을 보는 사람 중 그 업무도 보는 사람에게만 뜬다.
--   시작일과 마감일이 다 있으면 걸치는 날 전부(ends_on), 하나만 있으면 그 하루.
-- =====================================================================
create or replace view calendar_items
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
     and d.deadline is not null
  union all
  select 'process',
         pi.task_id,
         case when pi.stage is not null and length(btrim(pi.stage)) > 0
              then pi.stage || ' · ' || pi.title else pi.title end,
         coalesce(pi.start_on, pi.due_on),
         case when pi.start_on is not null and pi.due_on is not null and pi.due_on > pi.start_on
              then pi.due_on end,
         pi.business_id,
         null::text,
         '/tasks/' || pi.task_id
    from process_chart_items pi
    join tasks t on t.task_id = pi.task_id
   where pi.gone_at is null
     and (pi.start_on is not null or pi.due_on is not null);

comment on view calendar_items is
  'Phase 4-A + 0071. 캘린더 한 줄 모양. 다섯 원천(이벤트 · 다음 행동 · 마일스톤 · 결재 마감 · 프로세스 차트)을 DB에서 합친다. security_invoker=true라 각 표의 RLS가 그대로 걸린다.';

-- =====================================================================
-- 7절. 동기화 함수 — AI Agent 세션만
-- =====================================================================

-- 시트가 연결된 탭 목록(새벽 cron). AI Agent는 process_charts 읽기 정책이 없으므로 이 함수로만 본다.
create or replace function process_chart_sync_targets()
returns table (chart_id bigint, business_id text, team_name text, sheet_id text, sheet_tab text)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not is_active() or auth_role() is distinct from 'AIAgent' then
    raise exception 'process_sync_forbidden' using errcode = '42501';
  end if;
  return query
    select c.id, c.business_id, c.team_name, c.sheet_id, c.sheet_tab
      from process_charts c
     where c.sheet_id is not null
     order by c.business_id, c.sort_order, c.id;
end;
$fn$;

-- 공통 입구 판정: AI Agent · 탭 있음 · 시트 연결됨 · 누른 사람이 그 탭을 봄 · 1분 간격. 탭 줄을 잡아 둔다.
create or replace function process_chart_sync_gate(p_chart_id bigint, p_trigger text, p_requested_by uuid)
returns process_charts
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_chart process_charts;
begin
  if not is_active() or auth_role() is distinct from 'AIAgent' then
    raise exception 'process_sync_forbidden' using errcode = '42501';
  end if;
  if p_trigger is null or p_trigger not in ('button', 'open', 'cron') then
    raise exception 'process_sync_invalid: trigger';
  end if;
  -- 자동(cron)은 사람이 없다. 사람이 누른 동기화는 그 사람이 있어야 하고, 그 사람이 탭을 봐야 한다.
  if (p_trigger = 'cron') <> (p_requested_by is null) then
    raise exception 'process_sync_invalid: requested_by';
  end if;

  select * into v_chart from process_charts where id = p_chart_id for update;
  if not found then
    raise exception 'process_sync_not_found' using errcode = 'P0002';
  end if;
  if v_chart.sheet_id is null then
    raise exception 'process_sync_not_connected';
  end if;
  if p_requested_by is not null and not process_chart_visible_to(p_requested_by, v_chart.business_id, v_chart.team_name) then
    raise exception 'process_sync_not_found' using errcode = 'P0002';
  end if;

  -- 같은 팀 1분에 1번(성공 · 실패 모두 센다). 실패를 세지 않으면 구글 오류가 날 때 버튼이 구글을 두드린다.
  if exists (
    select 1 from process_chart_syncs s
     where s.business_id = v_chart.business_id and s.team_name = v_chart.team_name
       and s.synced_at > now() - interval '1 minute'
  ) then
    raise exception 'process_sync_too_soon';
  end if;
  return v_chart;
end;
$fn$;

/*
 * 앱 서버가 시트에서 읽어 검사를 마친 줄을 넣는다. p_rows의 한 줄:
 *   {"id": "...", "stage": "...", "title": "...", "email": "...", "start": "YYYY-MM-DD"|null, "due": ...|null,
 *    "status": "예정"|"진행"|"완료"|"보류", "note": "..."}
 * 줄 검사(ID 없음 · 날짜 틀림 · 상태 낱말)는 앱(src/lib/process-sync/parse.ts)이 하고 건너뛴 수 · 경고를 넘긴다.
 * 여기서는 같은 검사를 한 번 더 해서 틀린 줄이 오면 통째로 거부한다(PostgREST로 직접 오는 길).
 * 담당자 이메일 → 직원 찾기와 그 경고는 여기서 더한다(이메일 ↔ 사람은 DB만 안다).
 */
create or replace function process_chart_sync_apply(
  p_chart_id bigint, p_trigger text, p_requested_by uuid,
  p_read int, p_skipped int, p_warnings jsonb, p_rows jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_chart    process_charts;
  v_label    text;
  v_project  text;
  v_row      jsonb;
  v_id       text;
  v_title    text;
  v_stage    text;
  v_email    text;
  v_note     text;
  v_status   text;
  v_start    date;
  v_due      date;
  v_owner    uuid;
  v_old      process_chart_items;
  v_item_id  bigint;
  v_task_id  text;
  v_tstatus  task_status;
  v_warn     jsonb := coalesce(p_warnings, '[]'::jsonb);
  v_ids      text[] := '{}';
  v_new      int := 0;
  v_changed  int := 0;
  v_gone     int := 0;
  v_sync_id  bigint;
begin
  v_chart := process_chart_sync_gate(p_chart_id, p_trigger, p_requested_by);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'process_sync_invalid: rows';
  end if;
  if jsonb_typeof(v_warn) <> 'array' or jsonb_array_length(v_warn) > 2000 then
    raise exception 'process_sync_invalid: warnings';
  end if;
  if coalesce(p_read, -1) < 0 or coalesce(p_skipped, -1) < 0 or p_read < jsonb_array_length(p_rows) then
    raise exception 'process_sync_invalid: counts';
  end if;
  -- 넣을 줄이 0이면 넣지 않는다 — 탭을 잘못 고르거나 시트를 잠깐 비운 순간에 팀 업무 전부가 «시트에서 사라짐»이 되지 않게.
  -- 앱은 이 경우 apply 대신 process_chart_sync_fail로 경고를 남긴다(lib/process-sync/run.ts).
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'process_sync_empty';
  end if;

  v_label := '프로세스 차트 · ' || v_chart.team_name;
  -- 팀마다 업무를 매달 프로젝트 하나. 키는 (회사, 팀 이름)에서 나온다 — 링크를 지웠다 다시 만들어도 같은 자리.
  v_project := 'pc_' || v_chart.business_id || '_' || substr(md5(v_chart.team_name), 1, 10);
  insert into projects (project_id, business_id, name, owner_user_id, status)
  values (v_project, v_chart.business_id, v_label, null, 'Doing')
  on conflict (project_id) do nothing;
  -- 리뷰 A: 키가 예측 가능하다(pc_<회사>_<md5(팀)>). 누가 같은 id로 **다른 회사** 프로젝트를 먼저 만들어 두면
  -- 시트 업무가 그 회사로 들어간다(tasks_read는 project_business_id로 회사를 본다). 회사가 다르면 멈춘다.
  if (select p.business_id from projects p where p.project_id = v_project) is distinct from v_chart.business_id then
    raise exception 'process_sync_project_conflict';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'process_sync_invalid: row'; end if;
    v_id    := nullif(btrim(coalesce(v_row ->> 'id', '')), '');
    v_title := nullif(btrim(coalesce(v_row ->> 'title', '')), '');
    v_stage := nullif(btrim(coalesce(v_row ->> 'stage', '')), '');
    v_email := lower(nullif(btrim(coalesce(v_row ->> 'email', '')), ''));
    v_note  := nullif(btrim(coalesce(v_row ->> 'note', '')), '');
    v_status := coalesce(v_row ->> 'status', '예정');
    if v_id is null or length(v_id) > 100 or v_title is null or length(v_title) > 500 then
      raise exception 'process_sync_invalid: id/title';
    end if;
    if v_id = any(v_ids) then raise exception 'process_sync_invalid: duplicate id'; end if;
    v_ids := v_ids || v_id;
    if v_status not in ('예정', '진행', '완료', '보류') then raise exception 'process_sync_invalid: status'; end if;
    if (v_row ->> 'start') is not null and (v_row ->> 'start') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'process_sync_invalid: start'; end if;
    if (v_row ->> 'due') is not null and (v_row ->> 'due') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'process_sync_invalid: due'; end if;
    v_start := (v_row ->> 'start')::date;
    v_due   := (v_row ->> 'due')::date;

    -- 담당자: 그 회사를 보는 재직 직원 중 이메일이 같은 사람. 못 찾으면 담당 미정 + 경고.
    v_owner := null;
    if v_email is not null then
      select u.id into v_owner
        from auth.users u
        join user_profiles p on p.user_id = u.id
       where lower(u.email) = v_email and p.revoked_at is null
         and p.role not in ('AIAgent', 'Integration')
         and (p.role in ('Chairman', 'GroupCFO')
              or exists (select 1 from user_business_access a where a.user_id = u.id and a.business_id = v_chart.business_id))
       limit 1;
    end if;
    if v_owner is null then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('id', v_id,
        'message', case when v_email is null then '담당자 이메일이 비어 «담당 미정»으로 넣었습니다.'
                        else '담당자 이메일(' || v_email || ')을 직원에서 찾지 못해 «담당 미정»으로 넣었습니다.' end));
    end if;

    v_tstatus := case v_status when '진행' then 'Doing' when '완료' then 'Done' when '보류' then 'Blocked' else 'Todo' end::task_status;

    select * into v_old from process_chart_items
     where business_id = v_chart.business_id and team_name = v_chart.team_name and sheet_row_id = v_id
     for update;

    if not found then
      insert into process_chart_items (business_id, team_name, chart_id, sheet_row_id, stage, title, assignee_email,
                                       owner_user_id, start_on, due_on, status, note)
      values (v_chart.business_id, v_chart.team_name, v_chart.id, v_id, v_stage, v_title, v_email,
              v_owner, v_start, v_due, v_status, v_note)
      returning id into v_item_id;
      v_task_id := 'pc_' || v_item_id;
      insert into tasks (task_id, project_id, title, owner_user_id, priority, status, blocked_since, deadline, source_label)
      values (v_task_id, v_project, v_title, v_owner, 'Medium', v_tstatus, current_date, v_due, v_label);
      update process_chart_items set task_id = v_task_id where id = v_item_id;
      v_new := v_new + 1;
    else
      if v_old.gone_at is not null
         or v_old.stage is distinct from v_stage or v_old.title is distinct from v_title
         or v_old.assignee_email is distinct from v_email or v_old.owner_user_id is distinct from v_owner
         or v_old.start_on is distinct from v_start or v_old.due_on is distinct from v_due
         or v_old.status is distinct from v_status or v_old.note is distinct from v_note
         or v_old.chart_id is distinct from v_chart.id then
        v_changed := v_changed + 1;
      end if;
      update process_chart_items
         set chart_id = v_chart.id, stage = v_stage, title = v_title, assignee_email = v_email, owner_user_id = v_owner,
             start_on = v_start, due_on = v_due, status = v_status, note = v_note, gone_at = null, last_synced_at = now()
       where id = v_old.id;
      v_task_id := coalesce(v_old.task_id, 'pc_' || v_old.id);
      insert into tasks (task_id, project_id, title, owner_user_id, priority, status, blocked_since, deadline, source_label)
      values (v_task_id, v_project, v_title, v_owner, 'Medium', v_tstatus, current_date, v_due, v_label)
      on conflict (task_id) do update
        set title = excluded.title,
            owner_user_id = excluded.owner_user_id,
            deadline = excluded.deadline,
            -- 상태가 바뀔 때만 대기일수 기준선을 옮긴다(0001 tasks.blocked_since 주석).
            blocked_since = case when tasks.status is distinct from excluded.status then current_date else tasks.blocked_since end,
            status = excluded.status,
            source_label = excluded.source_label,
            source_gone_at = null;
      if v_old.task_id is null then
        update process_chart_items set task_id = v_task_id where id = v_old.id;
      end if;
    end if;
  end loop;

  -- 시트에서 사라진 줄 — 지우지 않는다. gone_at과 업무의 source_gone_at만 적는다.
  with gone as (
    update process_chart_items i
       set gone_at = now()
     where i.business_id = v_chart.business_id and i.team_name = v_chart.team_name
       and i.gone_at is null and not (i.sheet_row_id = any(v_ids))
    returning i.task_id
  ), marked as (
    update tasks t set source_gone_at = now()
      from gone g where t.task_id = g.task_id
    returning 1
  )
  select count(*) into v_gone from gone;

  insert into process_chart_syncs (business_id, team_name, chart_id, actor_user_id, trigger, ok,
                                   read_count, new_count, changed_count, gone_count, skipped_count, warnings)
  values (v_chart.business_id, v_chart.team_name, v_chart.id, p_requested_by, p_trigger, true,
          p_read, v_new, v_changed, v_gone, p_skipped, v_warn)
  returning id into v_sync_id;

  return jsonb_build_object('sync_id', v_sync_id, 'read', p_read, 'new', v_new, 'changed', v_changed,
                            'gone', v_gone, 'skipped', p_skipped, 'warnings', jsonb_array_length(v_warn));
end;
$fn$;

-- 시트를 못 읽었을 때(권한 · 주소 · 구글 오류). 문장은 앱이 사람 말로 만든 것 — 시트 내용을 싣지 않는다.
create or replace function process_chart_sync_fail(
  p_chart_id bigint, p_trigger text, p_requested_by uuid, p_error text
) returns bigint
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_chart process_charts;
  v_id    bigint;
begin
  v_chart := process_chart_sync_gate(p_chart_id, p_trigger, p_requested_by);
  insert into process_chart_syncs (business_id, team_name, chart_id, actor_user_id, trigger, ok, error)
  values (v_chart.business_id, v_chart.team_name, v_chart.id, p_requested_by, p_trigger, false,
          left(coalesce(nullif(btrim(p_error), ''), '알 수 없는 오류'), 500))
  returning id into v_id;
  return v_id;
end;
$fn$;

-- =====================================================================
-- 8절. 권한 — 이름으로 회수(Supabase가 anon에게 execute를 이름으로 준다)
-- =====================================================================
revoke all on function process_charts_team_fill() from public, anon, authenticated;
-- 리뷰 C: 사람 id를 받는 판이라 직원이 «X가 대표 · CFO인가»를 캐 볼 수 있다 — 정의자만 부른다(authenticated에도 안 준다).
revoke all on function process_chart_visible_to(uuid, text, text) from public, anon, authenticated;
revoke all on function can_read_process_chart(text, text) from public, anon;
revoke all on function process_chart_sync_targets() from public, anon;
revoke all on function process_chart_sync_gate(bigint, text, uuid) from public, anon, authenticated;
revoke all on function process_chart_sync_apply(bigint, text, uuid, int, int, jsonb, jsonb) from public, anon;
revoke all on function process_chart_sync_fail(bigint, text, uuid, text) from public, anon;
grant execute on function can_read_process_chart(text, text) to authenticated;
grant execute on function process_chart_sync_targets() to authenticated;
grant execute on function process_chart_sync_apply(bigint, text, uuid, int, int, jsonb, jsonb) to authenticated;
grant execute on function process_chart_sync_fail(bigint, text, uuid, text) to authenticated;

commit;
