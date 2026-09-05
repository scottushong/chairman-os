-- =====================================================================
-- Chairman OS — 0001_init
-- 출처: 02_기능명세 02_데이터필드 / 04_Data_API 맵 / src/types/domain.ts
-- 작성: Phase 1-A (2026-09-05)
--
-- 테이블 구성
--   02_데이터필드의 공통 객체 9개를 12개 물리 테이블로 편다.
--   Goal 객체 하나가 05_Strategic Coordinates의 4종(CH-011~014)으로 갈라지기 때문이다.
--
--     Business  → businesses
--     KPI       → finance_kpis
--     Goal      → goals / monthly_priorities / critical_risks / milestones
--     Project   → projects
--     Task      → tasks
--     Decision  → decisions
--     Alert     → alerts
--     AIOutput  → ai_night_outputs
--     Document  → documents
--   + audit_log     (CH-051. append only. UPDATE/DELETE 권한 없음)
--   + user_settings (CH-003/004/056. 숨김·핀·개인 레이아웃)
--
-- 이번 마이그레이션에서 뺀 것
--   1) Vault 등급 컬럼 전부 → supabase/vault_columns.md 에 목록만 둔다.
--      03_Vault_Map 원칙상 실제 값은 외주/Dev 환경에 내려오지 않는다.
--   2) MES / R&D / BOM (Layer 2) → Phase 2 ECOUNT·미래소프트·MES 연동 때 만든다.
--      BOM은 표 전체가 Vault라 여기서 스키마도 만들지 않는다.
--
-- 보안등급 표기: [일반] 누구나 / [제한] 역할 제한 / [Vault] 최고민감(이 파일에 없음)
-- 등급은 02_데이터필드 '보안등급' 칸을 따른다. RLS는 0002_rls.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 공통 Enum — 06_상태코드 시트. 개발팀이 임의 상태명을 만들지 않는다.
-- ---------------------------------------------------------------------
create type business_status as enum ('Active', 'Incubating', 'Hold', 'Exit', 'Archived');
create type task_status     as enum ('Todo', 'Doing', 'Blocked', 'Done');
create type work_priority   as enum ('Critical', 'High', 'Medium', 'Low');
create type severity        as enum ('Info', 'Warning', 'Critical');
create type security_class  as enum ('Normal', 'Restricted', 'Vault');
create type currency_code   as enum ('KRW', 'USD');

create type finance_metric as enum (
  'Revenue', 'Cost', 'EBITDA', 'Cash', 'AR', 'AP', 'OperatingProfit', 'NetIncome'
);

create type decision_status as enum ('Open', 'Approved', 'Rejected', 'Modified', 'Delegated');
create type alert_status    as enum ('Open', 'Acknowledged', 'Resolved');
create type alert_source    as enum ('Rule', 'AI');

create type alert_category as enum (
  'Cash', 'AR', 'Sales', 'EBITDA', 'Margin', 'Inventory', 'Production',
  'Quality', 'Customer', 'Project', 'Contract', 'HR', 'Compliance', 'AI Anomaly'
);

create type night_job_type as enum (
  'Research', 'Vendor Scout', 'Finance', 'Risk', 'Task Generation', 'Decision Memo'
);
create type night_job_status as enum ('Done', 'Running', 'Failed');

-- CH-051이 기록하라고 못박은 행위들. 조회까지 남긴다.
create type audit_action as enum (
  'read', 'create', 'update', 'delete_request',
  'approve', 'reject', 'modify', 'delegate',
  'permission_change', 'export', 'login'
);

-- ---------------------------------------------------------------------
-- 1. 공통 트리거 — updated_at은 애플리케이션이 아니라 DB가 찍는다.
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 2. businesses (CH-001~005)
-- ---------------------------------------------------------------------
create table businesses (
  business_id   text primary key,                         -- [일반] biz_dy 등 고유 ID
  name          text not null,                            -- [일반] 표시명
  status        business_status not null default 'Active',-- [일반] Active/Incubating/Hold/Exit/Archived
  industry      text not null default '미분류',            -- [일반] 업종
  owner_user_id uuid,                                     -- [제한] CEO/Owner. 인사정보라 제한이다
  visible       boolean not null default true,            -- [일반] CH-003 표시 플래그. 삭제가 아니다
  sort_order    integer not null default 0,               -- [일반] CH-005 정렬 순서
  pinned        boolean not null default false,           -- [일반] CH-004 기본 핀(개인 핀은 user_settings)
  created_at    timestamptz not null default now(),       -- [일반]
  updated_at    timestamptz not null default now()        -- [일반]
);
comment on table businesses is 'CH-001~005 Business 카드의 원천. 삭제 대신 status=Archived로 보관한다(CH-057).';

create trigger businesses_updated_at before update on businesses
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 3. finance_kpis (CH-006~010, CH-025~026)
--    기간 × 회사 × 지표의 한 칸. 화면 합계는 전부 이 표에서 나온다.
-- ---------------------------------------------------------------------
create table finance_kpis (
  id          bigint generated always as identity primary key,
  period      text not null,                              -- [일반] 기준월 YYYY-MM
  business_id text not null references businesses(business_id) on delete restrict, -- [일반]
  metric      finance_metric not null,                    -- [일반] 지표 코드
  value       numeric(20, 2) not null,                    -- [제한] 실적값. 금액은 역할 제한이다
  target      numeric(20, 2),                             -- [제한] 목표값(CH-027 Budget vs Actual)
  currency    currency_code not null default 'KRW',       -- [일반]
  source      text,                                       -- [일반] ECOUNT/미래소프트/Excel 등 출처
  created_at  timestamptz not null default now(),         -- [일반]
  updated_at  timestamptz not null default now(),         -- [일반]
  constraint finance_kpis_period_format check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint finance_kpis_unique unique (period, business_id, metric)
);
comment on table finance_kpis is 'CH-006~010 그룹 KPI와 CH-025~026 추이가 공유하는 단일 원천. 화면마다 따로 더하지 않는다.';

create index finance_kpis_lookup on finance_kpis (metric, period);
create trigger finance_kpis_updated_at before update on finance_kpis
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 4. goals (CH-011 Top Goal)
--    business_id가 null이면 그룹 전체 목표다. 앱의 'group' 센티널이 여기로 매핑된다.
-- ---------------------------------------------------------------------
create table goals (
  goal_id       text primary key,                         -- [일반]
  business_id   text references businesses(business_id) on delete cascade, -- [일반] null = 그룹
  title         text not null,                            -- [일반] 목표 문장
  target_value  text not null,                            -- [제한] 목표 수치(금액이 들어온다)
  current_value text not null,                            -- [제한] 현재 수치
  progress_pct  smallint not null default 0,              -- [일반] 0~100
  due           date not null,                            -- [일반]
  created_at    timestamptz not null default now(),       -- [일반]
  updated_at    timestamptz not null default now(),       -- [일반]
  constraint goals_progress_range check (progress_pct between 0 and 100)
);
comment on table goals is 'CH-011. business_id IS NULL 이 그룹 최상위 목표다.';

create trigger goals_updated_at before update on goals
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 5. monthly_priorities (CH-012)
-- ---------------------------------------------------------------------
create table monthly_priorities (
  priority_id   text primary key,                         -- [일반]
  business_id   text references businesses(business_id) on delete cascade, -- [일반] null = 그룹
  title         text not null,                            -- [일반]
  detail        text not null default '',                 -- [일반] 왜 이번 달인지
  owner_user_id uuid,                                     -- [제한] 담당자
  weight        work_priority not null default 'High',    -- [일반]
  period        text not null,                            -- [일반] 대상 월 YYYY-MM
  created_at    timestamptz not null default now(),       -- [일반]
  updated_at    timestamptz not null default now(),       -- [일반]
  constraint monthly_priorities_period_format check (period ~ '^[0-9]{4}-[0-9]{2}$')
);
comment on table monthly_priorities is 'CH-012. Chairman이 직접 고쳐 쓰는 칸이라 쓰기 권한이 좁다.';

create trigger monthly_priorities_updated_at before update on monthly_priorities
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 6. critical_risks (CH-013)
-- ---------------------------------------------------------------------
create table critical_risks (
  risk_id     text primary key,                           -- [일반]
  business_id text references businesses(business_id) on delete cascade, -- [일반] null = 그룹
  title       text not null,                              -- [일반]
  detail      text not null default '',                   -- [제한] 원인 서술에 내부 수치가 들어온다
  impact      severity not null,                          -- [일반] 정렬 기준 1
  urgency     severity not null,                          -- [일반] 정렬 기준 2
  source      alert_source not null default 'Rule',       -- [일반] Rule이 잡았나 AI가 잡았나
  resolved_at timestamptz,                                -- [일반] null이면 열려 있음
  created_at  timestamptz not null default now(),         -- [일반]
  updated_at  timestamptz not null default now()          -- [일반]
);
comment on table critical_risks is 'CH-013. Impact/Urgency 순으로 상위 1~3개만 화면에 올린다.';

create trigger critical_risks_updated_at before update on critical_risks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 7. milestones (CH-014)
-- ---------------------------------------------------------------------
create table milestones (
  milestone_id  text primary key,                         -- [일반]
  business_id   text references businesses(business_id) on delete cascade, -- [일반] null = 그룹
  project_id    text,                                     -- [일반] 프로젝트에 걸린 좌표면 연결
  title         text not null,                            -- [일반]
  owner_user_id uuid,                                     -- [제한]
  deadline      date not null,                            -- [일반] D-Day는 저장하지 않고 여기서 계산한다
  done_at       timestamptz,                              -- [일반]
  created_at    timestamptz not null default now(),       -- [일반]
  updated_at    timestamptz not null default now()        -- [일반]
);
comment on table milestones is 'CH-014. 남은 일수는 항상 deadline에서 계산한다 — 저장하면 어긋난다.';

create trigger milestones_updated_at before update on milestones
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 8. projects (CH-020)
-- ---------------------------------------------------------------------
create table projects (
  project_id    text primary key,                         -- [일반]
  business_id   text not null references businesses(business_id) on delete cascade, -- [일반]
  name          text not null,                            -- [일반]
  owner_user_id uuid,                                     -- [제한]
  priority      work_priority not null default 'Medium',  -- [일반]
  status        task_status not null default 'Doing',     -- [일반]
  progress_pct  smallint not null default 0,              -- [일반] 0~100
  deadline      date,                                     -- [일반]
  created_at    timestamptz not null default now(),       -- [일반]
  updated_at    timestamptz not null default now(),       -- [일반]
  constraint projects_progress_range check (progress_pct between 0 and 100)
);
comment on table projects is 'CH-020. 회사 카드의 진행률은 이 표의 평균이다(DEFERRED D-04 결정 C).';

create index projects_by_business on projects (business_id);
create trigger projects_updated_at before update on projects
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 9. tasks (CH-040, CH-017)
-- ---------------------------------------------------------------------
create table tasks (
  task_id         text primary key,                       -- [일반]
  project_id      text not null references projects(project_id) on delete cascade, -- [일반]
  title           text not null,                          -- [일반]
  owner_user_id   uuid,                                   -- [제한]
  priority        work_priority not null default 'Medium',-- [일반]
  status          task_status not null default 'Todo',    -- [일반]
  blocked_since   date not null default current_date,     -- [일반] 지금 상태로 들어간 날(DEFERRED D-02 결정 A)
  deadline        date,                                   -- [일반]
  chairman_needed boolean not null default false,         -- [일반] true면 CH-017 Waiting on Me로 올라온다
  created_at      timestamptz not null default now(),     -- [일반]
  updated_at      timestamptz not null default now()      -- [일반]
);
comment on column tasks.blocked_since is 'CH-017 대기일수의 기준선. 상태가 바뀌면 이 날짜도 같이 갱신해야 한다.';
comment on table tasks is 'CH-040 Task. chairman_needed=true 가 Chairman 화면으로 올라오는 유일한 조건이다.';

create index tasks_waiting_on_chairman on tasks (chairman_needed, status) where chairman_needed;
create trigger tasks_updated_at before update on tasks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 10. decisions (CH-015, CH-016)
-- ---------------------------------------------------------------------
create table decisions (
  decision_id       text primary key,                     -- [일반]
  business_id       text not null references businesses(business_id) on delete cascade, -- [일반]
  title             text not null,                        -- [일반]
  options           text[] not null default '{}',         -- [제한] 선택안에 가격·조건이 들어온다
  ai_recommendation text,                                 -- [제한] AI 추천안
  ai_confidence     numeric(3, 2),                        -- [일반] 0~1
  impact            work_priority not null default 'Medium', -- [일반]
  deadline          date,                                 -- [일반]
  status            decision_status not null default 'Open', -- [일반]
  decided_at        timestamptz,                          -- [일반] 처리 시각. 이력 자체는 audit_log가 갖는다
  decided_by        uuid,                                 -- [제한] 처리자
  created_at        timestamptz not null default now(),   -- [일반]
  updated_at        timestamptz not null default now(),   -- [일반]
  constraint decisions_confidence_range check (ai_confidence is null or ai_confidence between 0 and 1)
);
comment on table decisions is 'CH-015/016. 승인·거절·수정요청·위임의 흔적은 여기가 아니라 audit_log에 남는다.';

create index decisions_open on decisions (status, deadline) where status = 'Open';
create trigger decisions_updated_at before update on decisions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 11. alerts (CH-018)
-- ---------------------------------------------------------------------
create table alerts (
  alert_id            text primary key,                   -- [일반]
  business_id         text not null references businesses(business_id) on delete cascade, -- [일반]
  category            alert_category not null,            -- [일반]
  message             text not null,                      -- [제한] 본문에 금액·고객명이 섞인다
  severity            severity not null,                  -- [일반]
  source              alert_source not null,              -- [일반]
  status              alert_status not null default 'Open', -- [일반]
  related_decision_id text references decisions(decision_id) on delete set null, -- [일반] '관련 결정으로 이동'
  triggered_at        timestamptz not null default now(), -- [일반]
  acknowledged_at     timestamptz,                        -- [일반]
  created_at          timestamptz not null default now(), -- [일반]
  updated_at          timestamptz not null default now()  -- [일반]
);
comment on table alerts is 'CH-018. Critical만 패널 본문에 오르고 Warning은 카운트로만 나간다.';

create index alerts_open_critical on alerts (severity, status) where status <> 'Resolved';
create trigger alerts_updated_at before update on alerts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 12. ai_night_outputs (CH-019, CH-045~048)
-- ---------------------------------------------------------------------
create table ai_night_outputs (
  output_id      text primary key,                        -- [일반]
  business_id    text not null references businesses(business_id) on delete cascade, -- [일반]
  job_type       night_job_type not null,                 -- [일반]
  result_summary text not null,                           -- [제한] 요약에 내부 수치가 들어간다
  status         night_job_status not null default 'Done',-- [일반]
  artifact_link  text,                                    -- [제한] 결과물 경로. 문서 권한을 따른다
  confidence     numeric(3, 2),                           -- [일반] 0~1
  agent_name     text,                                    -- [일반] 03_AI기능의 Agent 이름
  completed_at   timestamptz not null,                    -- [일반]
  created_at     timestamptz not null default now(),      -- [일반]
  constraint ai_night_outputs_confidence_range check (confidence is null or confidence between 0 and 1)
);
comment on table ai_night_outputs is 'CH-019. 요약만 있고 artifact_link가 없으면 그 줄은 실패로 본다(요구사항서 11번).';

create index ai_night_outputs_recent on ai_night_outputs (completed_at desc);

-- ---------------------------------------------------------------------
-- 13. documents (CH-042)
--     파일 자체는 Storage에 두고 여기엔 메타와 등급만 둔다.
-- ---------------------------------------------------------------------
create table documents (
  document_id    text primary key,                        -- [일반]
  business_id    text references businesses(business_id) on delete cascade, -- [일반] null = 그룹 공통
  title          text not null,                           -- [일반]
  doc_type       text not null,                           -- [일반] Contract/IR/TDS/MSDS/Meeting 등
  security_class security_class not null default 'Normal',-- [일반] 이 값이 접근 판정의 입력이다
  storage_path   text not null,                           -- [제한] Storage 경로
  version        integer not null default 1,              -- [일반]
  owner_user_id  uuid,                                    -- [제한]
  created_at     timestamptz not null default now(),      -- [일반]
  updated_at     timestamptz not null default now()       -- [일반]
);
comment on column documents.security_class is 'Vault 문서는 이 표에 메타만 남기고 실제 파일은 별도 Vault 버킷에 둔다(03_Vault_Map).';
comment on table documents is 'CH-042 중앙 문서. 버전과 권한이 Acceptance다.';

create trigger documents_updated_at before update on documents
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 14. audit_log (CH-051) — append only
--     "삭제 불가"가 정책이라 UPDATE/DELETE를 트리거와 권한 양쪽에서 막는다.
--     RLS 정책도 0002에서 INSERT/SELECT만 준다.
-- ---------------------------------------------------------------------
create table audit_log (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),       -- [일반] 감사에는 '무엇을'보다 '언제'가 먼저다
  actor_user_id uuid,                                     -- [제한] 행위자. null이면 시스템/Agent
  actor_role    text,                                     -- [제한] 그 시점의 역할. 나중에 바뀌어도 기록은 남는다
  action        audit_action not null,                    -- [일반]
  entity_table  text not null,                            -- [일반] 대상 테이블
  entity_id     text,                                     -- [일반] 대상 행
  business_id   text,                                     -- [일반] Business Isolation 판정용
  before        jsonb,                                    -- [제한] 변경 전 값
  after         jsonb,                                    -- [제한] 변경 후 값
  note          text,                                     -- [일반]
  request_id    text                                      -- [일반] 한 요청에서 나온 기록을 묶는다
);
comment on table audit_log is 'CH-051. append only. 수정·삭제 경로를 만들지 않는 것이 정책 그 자체다.';

create index audit_log_by_entity on audit_log (entity_table, entity_id, occurred_at desc);
create index audit_log_by_actor  on audit_log (actor_user_id, occurred_at desc);

create or replace function audit_log_is_append_only() returns trigger
language plpgsql as $fn$
begin
  raise exception 'audit_log is append-only (02_기능명세 CH-051). % 는 허용되지 않는다', tg_op;
end;
$fn$;

create trigger audit_log_no_update before update on audit_log
  for each row execute function audit_log_is_append_only();
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function audit_log_is_append_only();

revoke update, delete on audit_log from anon, authenticated;
-- TRUNCATE는 행 트리거가 잡지 못한다. 위 append-only 트리거를 그냥 지나간다.
-- 기본값으로도 없는 권한이지만, 나중에 누가 grant all 한 줄을 쓰는 날을 대비해 명시적으로 회수한다.
revoke truncate on audit_log from anon, authenticated;

-- ---------------------------------------------------------------------
-- 15. user_settings (CH-003 / CH-004 / CH-056)
--     지금 localStorage에 있는 개인 설정이 그대로 올라올 자리다(DEFERRED D-05 결정 A).
-- ---------------------------------------------------------------------
create table user_settings (
  user_id           uuid primary key references auth.users(id) on delete cascade, -- [제한]
  hidden_businesses text[] not null default '{}',         -- [일반] CH-003. 데이터 삭제가 아니라 표시 플래그
  pinned_businesses text[] not null default '{}',         -- [일반] CH-004
  business_order    text[] not null default '{}',         -- [일반] CH-005 드래그 순서
  dashboard_layout  jsonb not null default '{}'::jsonb,   -- [일반] CH-056 위젯 표시/위치
  updated_at        timestamptz not null default now()    -- [일반]
);
comment on table user_settings is 'CH-056 개인 설정. 다른 사람 설정은 어떤 역할도 읽지 못한다(0002 RLS).';

create trigger user_settings_updated_at before update on user_settings
  for each row execute function set_updated_at();
