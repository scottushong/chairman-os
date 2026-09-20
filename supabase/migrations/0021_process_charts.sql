-- ---------------------------------------------------------------------
-- 0021. 프로세스차트 (Phase 5-D 1단계)
--
-- 팀별 업무 프로세스를 구글 시트로 관리하고 대시보드에서 그대로 본다.
-- **시트를 이 앱으로 옮기지 않는다.** 실무가 이미 시트에서 돌고 있고, 그것을 앱 안의
-- 표로 베끼면 두 벌이 생겨 곧 어긋난다. 여기 보관하는 것은 링크뿐이다 —
-- Vault 문서를 사내 스토리지에 두고 링크만 갖는 것과 같은 판단이다(CLAUDE.md).
--
-- **게시 링크만 받는다.** embed_url은 '웹에 게시'로 만든 pubhtml 주소여야 한다.
-- 편집 링크(/edit)나 일반 공유 링크(/d/<id>)를 넣으면 iframe이 로그인 화면을 띄우거나,
-- 더 나쁘게는 편집 권한이 있는 사람에게 편집 가능한 시트를 대시보드에 열어 준다.
-- 그래서 도메인과 경로 모양을 DB가 직접 막는다 — 화면 검증만으로는 API로 들어오는 길이 남는다.
-- ---------------------------------------------------------------------

create table process_charts (
  id          bigint generated always as identity primary key,
  business_id text not null references businesses(business_id) on delete restrict, -- [일반]
  team_name   text not null check (length(trim(team_name)) > 0),                   -- [일반]
  title       text not null check (length(trim(title)) > 0),                       -- [일반]
  -- 구글 '웹에 게시' 주소만. 2PACX로 시작하는 게시 토큰이 들어간 형태다.
  embed_url   text not null check (
    embed_url ~ '^https://docs\.google\.com/spreadsheets/d/e/[A-Za-z0-9_-]+/pubhtml'
  ),                                                                               -- [일반]
  sort_order  int not null default 0,                                              -- [일반] 팀 탭 순서
  updated_by  uuid not null default auth.uid(),                                    -- [제한]
  updated_at  timestamptz not null default now(),

  -- 한 회사에 같은 팀 이름이 둘이면 탭이 둘로 갈린다.
  unique (business_id, team_name)
);

create index process_charts_by_business on process_charts (business_id, sort_order);

comment on table process_charts is
  '0021. 팀별 프로세스차트의 구글 시트 게시 링크. 시트 내용은 옮기지 않는다 — 링크만 보관한다.';

-- ---------------------------------------------------------------------
-- RLS — Executive 이상 읽기, Chairman·GroupCFO 편집.
--
-- 읽기에 has_business()를 같이 거는 이유: Executive는 '자기 Business'만 보는 역할이라
-- 역할만 보고 통과시키면 다른 회사의 프로세스가 새어 나간다(0002의 Business Isolation).
-- ---------------------------------------------------------------------
create or replace function can_read_process_charts(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and target is not null
     and auth_role() in ('Chairman', 'GroupCFO', 'BusinessCEO', 'Executive')
     and has_business(target);
$fn$;

comment on function can_read_process_charts is
  '0021. 프로세스차트 열람. Executive 이상 + 자기 회사. TeamLead 이하는 보지 않는다.';

create or replace function can_write_process_charts() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and auth_role() in ('Chairman', 'GroupCFO');
$fn$;

alter table process_charts enable row level security;
alter table process_charts force row level security;

create policy process_charts_read on process_charts
  for select using (can_read_process_charts(business_id));
create policy process_charts_insert on process_charts
  for insert with check (can_write_process_charts() and updated_by = auth.uid());
create policy process_charts_update on process_charts
  for update using (can_write_process_charts()) with check (can_write_process_charts());
create policy process_charts_delete on process_charts
  for delete using (can_write_process_charts());

-- AI Agent와 Integration은 링크를 넣지 않는다. 외부 문서를 대시보드에 띄우는 결정은 사람이 한다.
create policy process_charts_ai_no_write on process_charts as restrictive for all
  using (auth_role() is distinct from 'AIAgent')
  with check (auth_role() is distinct from 'AIAgent');
create policy process_charts_integration_no_write on process_charts as restrictive for all
  using (not is_integration())
  with check (not is_integration());

-- ---------------------------------------------------------------------
-- 감사 기록 — 넣고 고치고 지운 것을 남긴다.
-- 링크가 바뀌면 대시보드가 다른 문서를 띄우므로, 누가 언제 바꿨는지가 남아야 한다.
-- ---------------------------------------------------------------------
create or replace function process_charts_audit() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (
    -- **tg_op를 그대로 소문자로 낮추면 안 된다.** audit_action enum에는 'insert'가 없다
    -- (0001: read/create/update/delete_request/approve/reject/modify/delegate/...).
    -- 'delete_request'가 삭제 계열의 유일한 값이라 실제 삭제도 여기로 보낸다 —
    -- 낱말은 거칠지만 note가 '프로세스차트 링크 삭제'로 정확히 말한다.
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
         then jsonb_build_object('team_name', old.team_name, 'title', old.title, 'embed_url', old.embed_url) end,
    case when tg_op in ('INSERT', 'UPDATE')
         then jsonb_build_object('team_name', new.team_name, 'title', new.title, 'embed_url', new.embed_url) end,
    case tg_op when 'DELETE' then '프로세스차트 링크 삭제' else '프로세스차트' end
  );
  return coalesce(new, old);
end;
$fn$;

create trigger process_charts_audit_trigger
  after insert or update or delete on process_charts
  for each row execute function process_charts_audit();

-- ---------------------------------------------------------------------
-- 시드 — DY 두 팀. **게시 링크라 저장소에 넣어도 된다.**
-- 편집 링크는 절대 넣지 않는다 — 저장소를 읽는 사람이 곧 편집자가 된다.
--
-- updated_by는 auth.uid()가 null인 마이그레이션 실행 시점이라 회장 계정을 찾아 넣는다.
-- 부트스트랩(0004) 전에 이 마이그레이션이 돌면 회장이 없으므로 시드를 건너뛴다.
-- ---------------------------------------------------------------------
do $seed$
declare
  v_chairman uuid;
begin
  select user_id into v_chairman from user_profiles where role = 'Chairman' order by created_at limit 1;
  if v_chairman is null then
    raise notice '0021: Chairman 계정이 없어 프로세스차트 시드를 건너뛴다 (0004 뒤에 손으로 넣는다).';
    return;
  end if;

  insert into process_charts (business_id, team_name, title, embed_url, sort_order, updated_by)
  values
    ('biz_dy', '경영지원', 'DY 경영지원 업무 프로세스',
     'https://docs.google.com/spreadsheets/d/e/2PACX-1vQyRIlUseLHMSeJT0Tr8HvnL0MmHpE8IeR0zx4AvVhJc5HJkcRZ_rzxy14l6pssZHdvXsRceC3mZPi5/pubhtml',
     10, v_chairman),
    ('biz_dy', '연구소', 'DY 연구소 업무 프로세스',
     'https://docs.google.com/spreadsheets/d/e/2PACX-1vTR5jxnGGpYiiu-GBVI-45HmeRSbcKV5XzzD15NsxrwrWPaxJAPuSTQAuf6t1psQPg96ECH-p6TARRs/pubhtml',
     20, v_chairman)
  on conflict (business_id, team_name) do nothing;
end;
$seed$;
