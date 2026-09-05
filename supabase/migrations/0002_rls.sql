-- =====================================================================
-- Chairman OS — 0002_rls (초안)
-- 출처: 05_Architecture "6. Permission 원칙" / 02_기능명세 04_권한 시트
-- 작성: Phase 1-A (2026-09-05)
--
-- 05_Architecture 6번의 원칙을 이 파일이 어디서 지키는지 대응표:
--
--   1) Default Deny            → 모든 테이블 ENABLE + FORCE ROW LEVEL SECURITY.
--                                정책이 없는 동작은 전부 거부다. 아래에 없는 것은 못 한다.
--   2) Least Privilege         → 정책마다 역할을 열거한다. '로그인했으니 읽기'는 없다.
--   3) Business Isolation      → has_business() 하나로만 판정. 회사 밖 행은 나가지 않는다.
--   4) Module-level Permission → user_module_access + can_module().
--   5) Row/Field-level         → Row는 정책, Field는 마스킹 뷰(맨 아래 예시).
--   6) Production DB 직접 접근 금지 → 파일 끝 GRANT 주석 참고. 앱은 PostgREST로만 붙는다.
--   7) Audit Log 필수          → audit_log는 INSERT/SELECT만. UPDATE/DELETE 정책 자체를 안 만든다.
--   8) 퇴사/계약 종료 즉시 회수 → user_profiles.revoked_at 한 줄로 전 테이블이 동시에 닫힌다.
--
-- 이 파일은 초안이다. 실제 사용자·역할이 생기기 전이라 정책의 모양만 확정하고,
-- 값(누가 어느 회사를 보는가)은 user_profiles / user_business_access 로 넣는다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 역할 — 02_기능명세 04_권한 시트의 9개
-- ---------------------------------------------------------------------
create type app_role as enum (
  'Chairman',        -- 전체 / 전체 / Read·Write·Approve / Vault 포함
  'GroupCFO',        -- 전체 / Finance / Read·Write / Formula·HOF IP 제외
  'BusinessCEO',     -- 자기 Business / 전체 / Read·Write·Approve
  'Executive',       -- 자기 Business / 담당 Module / Read·Write
  'TeamLead',        -- 자기 Business / 자기 팀 / Read·Write
  'Member',          -- 자기 Business / 할당업무 / Read·Update
  'ExternalExpert',  -- 지정 Project / 지정 Module / Read·Comment
  'Vendor',          -- Dev/Staging / 기술영역 / 실제 Vault 금지
  'AIAgent'          -- 지정 Scope / 지정 Function
);

create table user_profiles (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  role               app_role not null,
  display_name       text not null,
  title_ko           text,
  -- 이 사용자가 볼 수 있는 최고 보안등급. 여기 없는 등급은 값 자체를 안 내려보낸다.
  max_security_class security_class not null default 'Normal',
  -- 계약 종료·퇴사 시 여기만 채우면 아래 모든 정책이 한 번에 닫힌다(원칙 8).
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table user_profiles is '권한 판정의 단일 출처. auth.users에는 역할을 두지 않는다.';

create trigger user_profiles_updated_at before update on user_profiles
  for each row execute function set_updated_at();

-- 전사 역할(Chairman/GroupCFO)은 여기에 행을 넣지 않는다. 나머지는 명시된 회사만 본다.
create table user_business_access (
  user_id     uuid not null references auth.users(id) on delete cascade,
  business_id text not null references businesses(business_id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid,
  primary key (user_id, business_id)
);
comment on table user_business_access is 'Business Isolation의 실체. 이 표에 없으면 그 회사는 존재하지 않는 것처럼 보인다.';

-- 05_Architecture 3번 Repository 경로를 모듈 이름으로 그대로 쓴다.
create table user_module_access (
  user_id    uuid not null references auth.users(id) on delete cascade,
  module     text not null,
  can_write  boolean not null default false,
  can_approve boolean not null default false,
  granted_at timestamptz not null default now(),
  primary key (user_id, module)
);
comment on table user_module_access is 'Module-level Permission. 경로(/chairman/decisions 등) 단위로 연다.';

-- ---------------------------------------------------------------------
-- 1. 판정 함수
--    security definer라 정책 안에서 이 표들을 다시 RLS로 막지 않는다.
--    search_path를 고정하지 않으면 함수가 다른 스키마를 볼 수 있다.
-- ---------------------------------------------------------------------
create or replace function auth_profile()
returns user_profiles
language sql stable security definer set search_path = public as $fn$
  select * from user_profiles
   where user_id = auth.uid()
     and revoked_at is null;
$fn$;

create or replace function auth_role() returns app_role
language sql stable security definer set search_path = public as $fn$
  select role from user_profiles
   where user_id = auth.uid() and revoked_at is null;
$fn$;

/** 활성 사용자인가. 권한 회수(revoked_at)는 여기 한 곳에서 걸린다. */
create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from user_profiles
     where user_id = auth.uid() and revoked_at is null
  );
$fn$;

/** 전사 범위 역할인가. 04_권한 시트에서 'Business 범위 = 전체'인 둘. */
create or replace function has_group_scope() returns boolean
language sql stable security definer set search_path = public as $fn$
  select auth_role() in ('Chairman', 'GroupCFO');
$fn$;

/**
 * 이 회사를 볼 수 있는가.
 * business_id가 null인 행(그룹 목표·그룹 좌표)은 전사 역할만 본다.
 */
create or replace function has_business(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select case
    when not is_active() then false
    when has_group_scope() then true
    when target is null then false
    else exists (
      select 1 from user_business_access
       where user_id = auth.uid() and business_id = target
    )
  end;
$fn$;

create or replace function can_module(target text, need_write boolean default false)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select case
    when not is_active() then false
    when auth_role() = 'Chairman' then true
    else exists (
      select 1 from user_module_access
       where user_id = auth.uid()
         and module = target
         and (not need_write or can_write)
    )
  end;
$fn$;

/** 금액·원가 같은 [제한] 등급을 읽을 수 있는 역할인가. */
create or replace function can_read_restricted() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and auth_role() in
    ('Chairman', 'GroupCFO', 'BusinessCEO', 'Executive');
$fn$;

/** 승인 권한. 04_권한 시트에서 Approve를 가진 역할만. */
create or replace function can_approve() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and auth_role() in ('Chairman', 'BusinessCEO');
$fn$;

create or replace function max_class() returns security_class
language sql stable security definer set search_path = public as $fn$
  select coalesce(max_security_class, 'Normal') from user_profiles
   where user_id = auth.uid() and revoked_at is null;
$fn$;

/** 등급 비교. Normal < Restricted < Vault. */
create or replace function class_rank(c security_class) returns int
language sql immutable as $fn$
  select case c when 'Normal' then 1 when 'Restricted' then 2 else 3 end;
$fn$;

-- ---------------------------------------------------------------------
-- 2. Default Deny — 전 테이블 RLS on.
--    FORCE까지 켜야 테이블 소유자도 정책을 우회하지 못한다.
-- ---------------------------------------------------------------------
alter table businesses          enable row level security;
alter table finance_kpis        enable row level security;
alter table goals               enable row level security;
alter table monthly_priorities  enable row level security;
alter table critical_risks      enable row level security;
alter table milestones          enable row level security;
alter table projects            enable row level security;
alter table tasks               enable row level security;
alter table decisions           enable row level security;
alter table alerts              enable row level security;
alter table ai_night_outputs    enable row level security;
alter table documents           enable row level security;
alter table audit_log           enable row level security;
alter table user_settings       enable row level security;
alter table user_profiles       enable row level security;
alter table user_business_access enable row level security;
alter table user_module_access  enable row level security;

alter table businesses          force row level security;
alter table finance_kpis        force row level security;
alter table goals               force row level security;
alter table monthly_priorities  force row level security;
alter table critical_risks      force row level security;
alter table milestones          force row level security;
alter table projects            force row level security;
alter table tasks               force row level security;
alter table decisions           force row level security;
alter table alerts              force row level security;
alter table ai_night_outputs    force row level security;
alter table documents           force row level security;
alter table audit_log           force row level security;
alter table user_settings       force row level security;

-- ---------------------------------------------------------------------
-- 3. 권한 테이블 자신의 정책
--    자기 것만 읽고, 바꾸는 건 Chairman만. 권한 변경은 CH-051 기록 대상이다.
-- ---------------------------------------------------------------------
create policy user_profiles_self_read on user_profiles
  for select using (user_id = auth.uid() or auth_role() = 'Chairman');
create policy user_profiles_admin_write on user_profiles
  for all using (auth_role() = 'Chairman') with check (auth_role() = 'Chairman');

create policy business_access_self_read on user_business_access
  for select using (user_id = auth.uid() or auth_role() = 'Chairman');
create policy business_access_admin_write on user_business_access
  for all using (auth_role() = 'Chairman') with check (auth_role() = 'Chairman');

create policy module_access_self_read on user_module_access
  for select using (user_id = auth.uid() or auth_role() = 'Chairman');
create policy module_access_admin_write on user_module_access
  for all using (auth_role() = 'Chairman') with check (auth_role() = 'Chairman');

-- ---------------------------------------------------------------------
-- 4. businesses (CH-001~005)
-- ---------------------------------------------------------------------
create policy businesses_read on businesses
  for select using (has_business(business_id));

-- CH-002 회사 생성 / CH-057 Archive는 Chairman만.
create policy businesses_write on businesses
  for all using (auth_role() = 'Chairman') with check (auth_role() = 'Chairman');

-- ---------------------------------------------------------------------
-- 5. finance_kpis (CH-006~010)
--    값이 [제한]이라 회사 범위 + 재무 열람 역할 둘 다 통과해야 한다.
-- ---------------------------------------------------------------------
create policy finance_kpis_read on finance_kpis
  for select using (has_business(business_id) and can_read_restricted());

create policy finance_kpis_write on finance_kpis
  for all using (auth_role() in ('Chairman', 'GroupCFO'))
  with check (auth_role() in ('Chairman', 'GroupCFO'));

-- ---------------------------------------------------------------------
-- 6. 전략 좌표 4종 (CH-011~014)
--    business_id IS NULL = 그룹 행. has_business(null)이 전사 역할만 통과시킨다.
-- ---------------------------------------------------------------------
create policy goals_read on goals for select using (has_business(business_id));
create policy goals_write on goals
  for all using (can_approve() and has_business(business_id))
  with check (can_approve() and has_business(business_id));

create policy priorities_read on monthly_priorities for select using (has_business(business_id));
create policy priorities_write on monthly_priorities
  for all using (can_approve() and has_business(business_id))
  with check (can_approve() and has_business(business_id));

create policy risks_read on critical_risks for select using (has_business(business_id));
create policy risks_write on critical_risks
  for all using (can_approve() and has_business(business_id))
  with check (can_approve() and has_business(business_id));

create policy milestones_read on milestones for select using (has_business(business_id));
create policy milestones_write on milestones
  for all using (can_approve() and has_business(business_id))
  with check (can_approve() and has_business(business_id));

-- ---------------------------------------------------------------------
-- 7. projects / tasks (CH-020, CH-040, CH-017)
-- ---------------------------------------------------------------------
create policy projects_read on projects for select using (has_business(business_id));
create policy projects_write on projects
  for all using (has_business(business_id) and can_module('/chairman/dashboard', true))
  with check (has_business(business_id) and can_module('/chairman/dashboard', true));

create policy tasks_read on tasks
  for select using (
    exists (
      select 1 from projects p
       where p.project_id = tasks.project_id and has_business(p.business_id)
    )
  );

-- 직원은 '할당업무'만 고친다(04_권한 Member = Read/Update). 담당자이거나 승인권자여야 한다.
create policy tasks_write on tasks
  for update using (
    owner_user_id = auth.uid()
    or can_approve()
  ) with check (
    owner_user_id = auth.uid()
    or can_approve()
  );

-- ---------------------------------------------------------------------
-- 8. decisions (CH-015/016)
--    읽기는 회사 범위, 처리(승인/거절/수정/위임)는 승인권자만.
-- ---------------------------------------------------------------------
create policy decisions_read on decisions for select using (has_business(business_id));
create policy decisions_decide on decisions
  for update using (can_approve() and has_business(business_id))
  with check (can_approve() and has_business(business_id));
create policy decisions_create on decisions
  for insert with check (has_business(business_id) and can_module('/chairman/decisions', true));

-- ---------------------------------------------------------------------
-- 9. alerts / ai_night_outputs (CH-018, CH-019)
-- ---------------------------------------------------------------------
create policy alerts_read on alerts for select using (has_business(business_id));
create policy alerts_ack on alerts
  for update using (has_business(business_id)) with check (has_business(business_id));

create policy night_outputs_read on ai_night_outputs
  for select using (has_business(business_id) and can_read_restricted());
-- 야간 Job은 사람이 아니라 Agent가 쓴다. 서버(service_role)만 INSERT한다.
create policy night_outputs_write on ai_night_outputs
  for insert with check (auth_role() = 'AIAgent');

-- ---------------------------------------------------------------------
-- 10. documents (CH-042) — Row + Field 판정이 같이 걸리는 유일한 표
-- ---------------------------------------------------------------------
create policy documents_read on documents
  for select using (
    has_business(business_id)
    and class_rank(security_class) <= class_rank(max_class())
  );
create policy documents_write on documents
  for all using (has_business(business_id) and can_module('/core/search', true))
  with check (has_business(business_id) and can_module('/core/search', true));

-- ---------------------------------------------------------------------
-- 11. audit_log (CH-051)
--     INSERT와 SELECT만 만든다. UPDATE/DELETE 정책이 없으므로 Default Deny로 막힌다.
--     (0001의 트리거·REVOKE와 합쳐 3중이다.)
-- ---------------------------------------------------------------------
create policy audit_log_insert on audit_log
  for insert with check (is_active());

-- 감사 기록을 읽는 것 자체가 민감하다. Chairman만 전체를 본다.
create policy audit_log_read on audit_log
  for select using (
    auth_role() = 'Chairman'
    or actor_user_id = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 12. user_settings (CH-003/004/056)
--     남의 화면 설정은 Chairman도 읽지 못한다. 업무 데이터가 아니다.
-- ---------------------------------------------------------------------
create policy user_settings_own on user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 13. Field-level 마스킹 예시 (원칙 5)
--     정책은 '행'까지만 자른다. 금액 '칸'을 가리는 건 뷰의 일이다.
--     TeamLead 이하가 프로젝트 화면에서 재무를 볼 때 이 뷰를 읽게 한다.
-- ---------------------------------------------------------------------
create view finance_kpis_masked
with (security_invoker = true) as
select
  id,
  period,
  business_id,
  metric,
  case when can_read_restricted() then value else null end as value,
  case when can_read_restricted() then target else null end as target,
  currency
from finance_kpis;
comment on view finance_kpis_masked is
  'Row는 RLS가, Field는 이 뷰가 자른다. security_invoker=true라 뷰가 RLS를 우회하지 않는다.';

-- ---------------------------------------------------------------------
-- 14. Production DB 직접 접근 금지 (원칙 6)
--     앱은 PostgREST(anon/authenticated)로만 붙고, 사람이 직접 붙는 계정은 만들지 않는다.
--     service_role 키는 서버 런타임에만 두고 브라우저로 내려보내지 않는다.
--     아래는 기본값 확인용이다. Supabase 프로젝트 생성 직후 한 번 점검한다.
--
--       revoke all on schema public from anon;
--       grant usage on schema public to anon, authenticated;
--       grant select on all tables in schema public to authenticated;
--       grant insert on audit_log to authenticated;
--
--     쓰기 권한은 테이블별로 필요한 것만 따로 grant 한다. 한 번에 열지 않는다.
-- ---------------------------------------------------------------------
