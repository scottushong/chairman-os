-- =====================================================================
-- Chairman OS — 0087_approvals («전자결재» — 결재할 문서 · 결재 예정 · 내가 올린 문서 · 임시저장 · 내 처리 이력 · 참조 · 공유 · 후속 처리)
-- 작성: 2026-10-19 · 원문 docs/specs/2026-10-19-approvals.txt · 시안 docs/specs/2026-10-19-approvals-mock.png · 결정 docs/decisions/2026-10-19-approvals.md
--
-- ■ 왜 새 표인가 ■ 예전 결재(decisions · 0038 · 0054 · 0059)는 회장 결정 · 결재 대장과 묶여 있다. 합의 · 참조 · 임시저장 · 버전 · 후속 처리 · 대결을
--   그 위에 얹으면 결재 대장 · 대표 대시보드가 같이 흔들린다(«기존 그룹웨어 기능에 영향을 주지 않는다»). 그래서 따로 둔다 — 예전 화면 · 표는 그대로.
--
-- ■ 모양 ■
--   ea_forms(양식 · 버전) · ea_line_rules(결재선 · 전결 규칙) — 관리자(대표)만 쓴다.
--   ea_docs(문서 — 상신 때 양식 · 결재선을 문서에 얼려 둔다) · ea_steps(결재 단계 — 승인 · 합의, 사람 또는 역할 «대표»)
--   ea_refs(참조 · 열람 — 열람과 «확인»을 따로) · ea_followups(후속 처리 — 문서마다 하나 · 최종 승인 때만) · ea_files(첨부 · 증빙 — 버킷 ea-files)
--   ea_events(이력 — 사용자 · 시각 · 행위 · 의견 · 대결 · 전후 상태 · 요청 id 유일 = 중복 클릭 · 재시도 한 번만)
--   ea_proxies(대결 — 기간 · 양식 · 금액 범위) · ea_favorites(자주 쓰는 결재선) · ea_settings(알림 설정)
--   표는 grant select 없음 — 읽기 · 쓰기 모두 아래 정의자 함수로만(권한 · 상태 판정이 한 곳). 예외: 양식 · 규칙은 읽기만 열어 둔다.
--
-- ■ 규칙(원문 5 · 6 · 8) ■
--   순차 결재. 지금 «대기» 단계의 지정 결재자(사람 · 역할 대표) 또는 그 사람의 유효한 대결자만 승인 · 반려. 참조자 · 예정 결재자는 못 한다.
--   합의 단계도 순서대로 — «합의» = 다음으로 · «반려»(이의) = 문서 반려. 반려는 사유 필수, 승인 의견은 선택(남는다).
--   모든 단계가 승인되어야 «승인 완료». 중간 승인은 다음 담당자에게 «대기»로 넘긴다.
--   회수: 기안자만 · 진행 중 · 아무도 처리하지 않았을 때만(처리 이력이 있으면 막고 안내). 기록은 지우지 않는다.
--   재상신: 반려된 원문서는 그대로 두고 새 버전(임시저장)을 만들어 잇는다 — 상신하면 결재선을 다시 검증하고 처음부터. 이전 승인 승계 없음.
--   후속 처리는 양식 설정에 따라 최종 승인 때 한 번(문서마다 유일) · 완료는 문서 상태를 바꾸지 않는다 · ECOUNT 전표번호는 글자 칸만.
--   읽기: 기안자 · 결재선의 사람(예정 포함 — 결재 예정함) · 그 사람의 유효한 대결자 · 참조 · 열람자 · (승인 뒤) 후속 담당자. 관리자라고 다 보지 않는다.
--   관련 문서를 이어도 그 문서 읽기 권한을 주지 않는다(제목도 권한 있는 것만).
--   동시 처리: 문서 줄을 잠그고 상태를 다시 본다 — 두 탭 · 두 기기의 같은 단계는 하나만 성공, 다른 하나는 'ea_step_not_waiting'.
-- ■ 스위치 ■ feature_on('approvals', 회사) — 기본 대표만. 대표가 회사 줄을 켜면 그 회사 전원.
-- ■ 알림 ■ 앱 안 알림(notifications)만 — 메일 · 카톡 없음. 이력 한 줄(요청 id 유일)과 같은 트랜잭션이라 재시도에 두 번 가지 않는다.
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0085를 고치지 않는다. 새 정책 · grant는 늘 to authenticated.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 양식 · 결재선 규칙
-- =====================================================================
create table ea_forms (
  form_key           text primary key check (form_key ~ '^[a-z][a-z0-9_]{1,30}$'),       -- [일반]
  name_ko            text not null check (length(btrim(name_ko)) between 1 and 40),        -- [일반]
  version            int not null default 1 check (version >= 1),                         -- [일반] 바꿀 때마다 +1(진행 중 문서는 상신 때 얼린 판을 쓴다)
  fields             jsonb not null check (jsonb_typeof(fields) = 'array'),               -- [일반] [{key,label,type,required,options?}]
  attachment_required boolean not null default false,                                       -- [일반]
  followup_kind      text check (followup_kind is null or length(followup_kind) between 1 and 40),  -- [일반] 발주 · 지급 · 근태 반영 …(null = 후속 없음)
  followup_required  boolean not null default false,                                       -- [일반] 후속 담당자 지정 필수
  note               text check (note is null or length(note) <= 300),                     -- [일반] 화면 안내(«잔여일수 검증은 연동 준비 중»)
  active             boolean not null default true,
  sort_order         int not null default 0,
  updated_by         uuid,
  updated_at         timestamptz not null default now()
);
comment on table ea_forms is '0087. 전자결재 양식. 관리자(대표)만 ea_form_save로 바꾼다(버전 +1). 문서는 상신 때 양식 판을 얼려 둔다.';
alter table ea_forms enable row level security;
revoke all on table ea_forms from public, anon, authenticated;
grant select on table ea_forms to authenticated;
create policy ea_forms_read on ea_forms for select to authenticated using (is_active());

create table ea_line_rules (
  rule_id          uuid primary key default gen_random_uuid(),
  form_key         text references ea_forms(form_key) on delete restrict,          -- [일반] null = 모든 양식
  business_id      text references businesses(business_id) on delete restrict,     -- [일반] null = 모든 회사
  min_amount       numeric(20,0) not null default 0 check (min_amount >= 0),       -- [일반] 이 금액 이상이면
  require_chairman boolean not null default true,                                  -- [일반] 마지막 «대표» 단계 필수(아래면 전결 — 대표 없이 끝)
  note             text check (note is null or length(note) <= 200),
  active           boolean not null default true,
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);
comment on table ea_line_rules is '0087. 결재선 · 전결 규칙 — 금액 이상이면 대표 단계 필수. 관리자(대표)만 ea_line_rule_save로.';
alter table ea_line_rules enable row level security;
revoke all on table ea_line_rules from public, anon, authenticated;
grant select on table ea_line_rules to authenticated;
create policy ea_line_rules_read on ea_line_rules for select to authenticated using (is_active());

insert into ea_forms (form_key, name_ko, fields, attachment_required, followup_kind, followup_required, note, sort_order) values
  ('purchase', '구매품의', '[
     {"key":"item","label":"품목","type":"text","required":true},
     {"key":"qty","label":"수량","type":"number","required":true},
     {"key":"vendor","label":"거래처","type":"text","required":true},
     {"key":"purpose","label":"사용 목적","type":"text","required":true},
     {"key":"supply","label":"공급가","type":"money","required":true},
     {"key":"vat","label":"부가세","type":"money","required":true},
     {"key":"total","label":"합계","type":"money","required":true},
     {"key":"delivery_date","label":"납품 희망일","type":"date","required":false}
   ]'::jsonb, true, '구매 담당자 발주', true, '견적서를 첨부합니다. 합계 = 공급가 + 부가세(서버가 다시 확인).', 1),
  ('expense', '지출결의', '[
     {"key":"payee","label":"지급처","type":"text","required":true},
     {"key":"reason","label":"지급 사유","type":"text","required":true},
     {"key":"total","label":"금액","type":"money","required":true},
     {"key":"pay_date","label":"지급 희망일","type":"date","required":false},
     {"key":"related_no","label":"관련 품의 문서번호","type":"text","required":false}
   ]'::jsonb, true, '관리부 지급', true, '증빙을 첨부합니다. 회계 · 재무 숫자에는 자동 반영하지 않습니다(결재만).', 2),
  ('vacation', '휴가신청', '[
     {"key":"leave_type","label":"휴가 종류","type":"select","required":true,"options":["연차","반차","병가","경조","기타"]},
     {"key":"start","label":"시작일","type":"date","required":true},
     {"key":"end","label":"종료일","type":"date","required":true},
     {"key":"days","label":"사용 일수","type":"number","required":true},
     {"key":"handover","label":"업무 인수인계","type":"textarea","required":false}
   ]'::jsonb, false, '근태 반영 여부 확인', false, '잔여일수 · 중복 신청 검증은 근태 기능 연동 준비 중입니다.', 3),
  ('trip', '출장신청', '[
     {"key":"start","label":"시작일","type":"date","required":true},
     {"key":"end","label":"종료일","type":"date","required":true},
     {"key":"place","label":"방문처","type":"text","required":true},
     {"key":"purpose","label":"목적","type":"text","required":true},
     {"key":"total","label":"예상 비용","type":"money","required":false}
   ]'::jsonb, false, null, false, null, 4),
  ('repair', '설비수리 품의', '[
     {"key":"equipment","label":"설비명","type":"text","required":true},
     {"key":"location","label":"위치","type":"text","required":true},
     {"key":"symptom","label":"증상","type":"textarea","required":true},
     {"key":"scope","label":"수리 범위","type":"textarea","required":true},
     {"key":"total","label":"견적 금액","type":"money","required":false}
   ]'::jsonb, false, '설비 담당 수리 진행', false, '견적서 · 사진을 첨부하면 좋습니다.', 5),
  ('general', '일반품의', '[]'::jsonb, false, null, false, null, 6);

-- 기본 전결 규칙: 1천만 원 이상 구매 · 지출 · 수리는 대표 단계 필수(관리자가 바꾼다).
insert into ea_line_rules (form_key, min_amount, require_chairman, note) values
  ('purchase', 10000000, true, '기본값(0087) — 1천만 원 이상은 대표 승인'),
  ('expense', 10000000, true, '기본값(0087) — 1천만 원 이상은 대표 승인'),
  ('repair', 10000000, true, '기본값(0087) — 1천만 원 이상은 대표 승인');

-- =====================================================================
-- 2절. 문서 · 단계 · 참조 · 후속 · 첨부 · 이력 · 대결 · 결재선 즐겨찾기 · 설정
-- =====================================================================
create sequence ea_doc_seq;

create table ea_docs (
  doc_id            uuid primary key default gen_random_uuid(),
  doc_no            text unique check (doc_no is null or doc_no ~ '^GW-[0-9]{4}-[0-9]{4,}$'),   -- [일반] 상신 때 붙는다
  business_id       text not null references businesses(business_id) on delete restrict,       -- [일반]
  form_key          text not null references ea_forms(form_key) on delete restrict,           -- [일반]
  form_version      int,                                                                       -- [일반] 상신 때 얼린 판
  form_snapshot     jsonb,                                                                     -- [일반] 상신 때 양식(필드 · 첨부 필수 · 후속)
  title             text not null check (length(btrim(title)) between 1 and 200),             -- [제한]
  body              text not null default '' check (length(body) <= 20000),                   -- [제한] 신청 내용
  fields            jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),  -- [제한] 양식별 칸
  amount            numeric(20,0) check (amount is null or amount >= 0),                      -- [제한] 합계(구매 · 지출 · 수리 · 출장)
  line              jsonb not null default '[]'::jsonb check (jsonb_typeof(line) = 'array'),  -- [일반] 작성 중 결재선(상신 때 단계로)
  refs              jsonb not null default '[]'::jsonb check (jsonb_typeof(refs) = 'array'),  -- [일반] 작성 중 참조 · 열람자
  due_date          date,                                                                      -- [일반] 처리 기한(있을 때만 «기한 초과»)
  wish_date         date,                                                                      -- [일반] 처리 희망일
  followup_assignee uuid references auth.users(id),                                            -- [일반] 후속 담당자
  related           uuid[] not null default '{}',                                              -- [일반] 관련 문서(읽기 권한은 주지 않는다)
  status            text not null default 'draft' check (status in ('draft', 'in_progress', 'rejected', 'approved', 'withdrawn')),
  current_seq       int,                                                                       -- [일반] 지금 «대기» 단계
  version           int not null default 1 check (version >= 1),                              -- [일반] 재상신 판
  prev_doc_id       uuid references ea_docs(doc_id) on delete restrict,                       -- [일반] 이전 버전
  drafter           uuid not null default auth.uid() references auth.users(id),
  drafter_name      text not null,                                                             -- [일반] 상신 때 이름 · 부서(이후 조직도가 바뀌어도)
  drafter_dept      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  decided_at        timestamptz
);
create index ea_docs_drafter on ea_docs (drafter, status);
create index ea_docs_prev on ea_docs (prev_doc_id);
comment on table ea_docs is '0087. 전자결재 문서. 임시저장은 기안자만 본다. 상신 뒤 내용 · 첨부는 고치지 않는다(재상신 = 새 버전). 쓰기 · 읽기는 ea_* 함수만.';
alter table ea_docs enable row level security;
revoke all on table ea_docs from public, anon, authenticated;

create table ea_steps (
  doc_id         uuid not null references ea_docs(doc_id) on delete restrict,
  seq            int not null check (seq between 1 and 20),
  kind           text not null check (kind in ('approve', 'agree')),                     -- 승인 · 합의
  approver_user  uuid references auth.users(id),                                         -- 사람 단계
  approver_role  text check (approver_role is null or approver_role = 'Chairman'),        -- 역할 단계(대표) — 이름이 아니라 역할로
  approver_name  text not null,                                                           -- 상신 때 이름(표시)
  status         text not null default 'planned' check (status in ('planned', 'waiting', 'approved', 'rejected', 'skipped')),
  acted_by       uuid references auth.users(id),                                         -- 실제 처리자(대결자일 수 있다)
  acted_as_proxy boolean not null default false,
  comment        text check (comment is null or length(comment) <= 2000),
  acted_at       timestamptz,
  waiting_since  timestamptz,
  primary key (doc_id, seq),
  constraint ea_steps_who check ((approver_user is null) <> (approver_role is null))
);
comment on table ea_steps is '0087. 결재 단계 — 예정 · 대기 · 승인 · 반려 · 미처리(취소 · 종료). 원 결재자(approver_*)와 실제 처리자(acted_by · 대결)를 둘 다 남긴다.';
alter table ea_steps enable row level security;
revoke all on table ea_steps from public, anon, authenticated;

create table ea_refs (
  doc_id       uuid not null references ea_docs(doc_id) on delete restrict,
  user_id      uuid not null references auth.users(id),
  kind         text not null check (kind in ('cc', 'viewer')),   -- 참조 · 열람
  seen_at      timestamptz,                                     -- 열어 봄
  confirmed_at timestamptz,                                     -- «확인» 눌렀음(열람과 다르다)
  primary key (doc_id, user_id)
);
alter table ea_refs enable row level security;
revoke all on table ea_refs from public, anon, authenticated;

create table ea_followups (
  doc_id       uuid primary key references ea_docs(doc_id) on delete restrict,   -- 문서마다 하나(중복 생성 막음)
  kind         text not null,
  assignee     uuid references auth.users(id),
  status       text not null default 'waiting' check (status in ('waiting', 'doing', 'done')),
  due_date     date,
  result       text check (result is null or length(result) <= 2000),
  ecount_slip  text check (ecount_slip is null or length(ecount_slip) <= 60),       -- 글자 칸만(ECOUNT 연동 없음)
  done_by      uuid references auth.users(id),
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table ea_followups is '0087. 후속 처리 — 최종 승인 때 양식 설정에 따라 한 번. 완료해도 문서의 «승인 완료»는 그대로.';
alter table ea_followups enable row level security;
revoke all on table ea_followups from public, anon, authenticated;

create table ea_files (
  file_id     uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references ea_docs(doc_id) on delete restrict,
  kind        text not null default 'doc' check (kind in ('doc', 'evidence')),      -- 문서 첨부 · 후속 증빙
  path        text not null check (path ~ '^[0-9a-f-]{36}/[0-9a-zA-Z._-]{1,120}$'),  -- ea-files 버킷 «<문서>/<이름>»
  name        text not null check (length(name) between 1 and 255),
  size_bytes  bigint not null check (size_bytes between 1 and 20971520),
  mime        text,
  uploaded_by uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (doc_id, path)
);
alter table ea_files enable row level security;
revoke all on table ea_files from public, anon, authenticated;

create table ea_events (
  event_id      bigint generated always as identity primary key,
  doc_id        uuid not null references ea_docs(doc_id) on delete restrict,
  actor         uuid,
  action        text not null check (action in ('draft', 'submit', 'approve', 'agree', 'reject', 'withdraw', 'resubmit', 'confirm', 'followup', 'reassign', 'file')),
  seq           int,
  as_proxy      boolean not null default false,
  original_user uuid,
  comment       text check (comment is null or length(comment) <= 2000),
  before        jsonb,
  after         jsonb,
  request_id    text unique check (request_id is null or length(request_id) between 8 and 80),   -- 같은 요청 두 번 = 한 번
  at            timestamptz not null default now()
);
create index ea_events_doc on ea_events (doc_id, at);
alter table ea_events enable row level security;
revoke all on table ea_events from public, anon, authenticated;

create table ea_proxies (
  proxy_id    uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id),  -- 원 결재자
  proxy       uuid not null references auth.users(id),                      -- 대결자
  date_from   date not null,
  date_to     date not null,
  forms       text[],                                                       -- null = 모든 양식
  max_amount  numeric(20,0),                                                -- null = 금액 제한 없음
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint ea_proxies_range check (date_to >= date_from and date_to <= date_from + 90 and owner <> proxy)
);
alter table ea_proxies enable row level security;
revoke all on table ea_proxies from public, anon, authenticated;

create table ea_favorites (
  fav_id     uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id),
  name       text not null check (length(btrim(name)) between 1 and 40),
  line       jsonb not null check (jsonb_typeof(line) = 'array'),
  refs       jsonb not null default '[]'::jsonb check (jsonb_typeof(refs) = 'array'),
  created_at timestamptz not null default now()
);
alter table ea_favorites enable row level security;
revoke all on table ea_favorites from public, anon, authenticated;

create table ea_settings (
  user_id    uuid primary key references auth.users(id),
  notify     jsonb not null default '{"turn":true,"result":true,"followup":true,"ref":true}'::jsonb check (jsonb_typeof(notify) = 'object'),
  updated_at timestamptz not null default now()
);
alter table ea_settings enable row level security;
revoke all on table ea_settings from public, anon, authenticated;

-- =====================================================================
-- 3절. 판정 · 도움 함수(내부)
-- =====================================================================
create or replace function ea_human() returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select auth.uid() is not null and is_active() and coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration');
$fn$;

/** 역할 «대표» 단계의 지금 사람. */
create or replace function ea_chairman_uid() returns uuid
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p.user_id from user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
$fn$;

/** 단계의 원 결재자(사람 단계 = 그 사람 · 대표 단계 = 지금 대표). */
create or replace function ea_step_owner(p_user uuid, p_role text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(p_user, case when p_role = 'Chairman' then ea_chairman_uid() end);
$fn$;

/** 나는 이 원 결재자의 유효한 대결자인가(오늘이 기간 안 · 양식 · 금액 범위 안). */
create or replace function ea_proxy_for(p_owner uuid, p_form text, p_amount numeric) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1 from ea_proxies x
     where x.owner = p_owner and x.proxy = auth.uid() and x.active
       and (now() at time zone 'Asia/Seoul')::date between x.date_from and x.date_to
       and (x.forms is null or p_form = any (x.forms))
       and (x.max_amount is null or coalesce(p_amount, 0) <= x.max_amount)
  );
$fn$;

/** 이 문서를 읽을 수 있는가 — 임시저장은 기안자만. 관리자라고 다 보지 않는다. */
create or replace function ea_can_read(p_doc uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  d ea_docs;
begin
  if not ea_human() then return false; end if;
  select * into d from ea_docs where doc_id = p_doc;
  if d.doc_id is null or not feature_on('approvals', d.business_id) then return false; end if;
  if d.drafter = auth.uid() then return true; end if;
  if d.status = 'draft' then return false; end if;
  if exists (select 1 from ea_steps s where s.doc_id = p_doc
               and (ea_step_owner(s.approver_user, s.approver_role) = auth.uid()
                    or ea_proxy_for(ea_step_owner(s.approver_user, s.approver_role), d.form_key, d.amount))) then
    return true;
  end if;
  if exists (select 1 from ea_refs r where r.doc_id = p_doc and r.user_id = auth.uid()) then return true; end if;
  if d.status = 'approved' and exists (select 1 from ea_followups f where f.doc_id = p_doc and f.assignee = auth.uid()) then return true; end if;
  return false;
end;
$fn$;

create or replace function ea_name(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((select display_name from user_profiles where user_id = p_user), '—');
$fn$;

create or replace function ea_dept(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $fn$
  select t.name from user_profiles p join teams t on t.team_id = p.team_id where p.user_id = p_user;
$fn$;

/** 앱 안 알림 한 줄(받는 사람이 그 문서를 읽을 수 있을 때만 — 제목이 권한 없는 사람에게 가지 않게 호출하는 쪽이 고른다). */
create or replace function ea_notify(p_user uuid, p_title text, p_doc uuid, p_box text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_on boolean;
  v_key text := case p_box when 'todo' then 'turn' when 'mine' then 'result' when 'followups' then 'followup' else 'ref' end;
begin
  if p_user is null then return; end if;
  select coalesce((notify ->> v_key)::boolean, true) into v_on from ea_settings where user_id = p_user;
  if v_on is false then return; end if;
  insert into notifications (user_id, kind, title, link)
  values (p_user, 'decision', left(p_title, 200), '/e-approval?box=' || p_box || '&doc=' || p_doc::text);
end;
$fn$;

create or replace function ea_event(p_doc uuid, p_action text, p_seq int, p_proxy boolean, p_orig uuid, p_comment text, p_before jsonb, p_after jsonb, p_req text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  insert into ea_events (doc_id, actor, action, seq, as_proxy, original_user, comment, before, after, request_id)
  values (p_doc, auth.uid(), p_action, p_seq, coalesce(p_proxy, false), p_orig, nullif(btrim(coalesce(p_comment, '')), ''), p_before, p_after, nullif(p_req, ''));
end;
$fn$;

/** 같은 요청 id가 이미 있으면 true(재시도 — 아무것도 다시 하지 않는다). */
create or replace function ea_seen(p_req text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p_req is not null and p_req <> '' and exists (select 1 from ea_events where request_id = p_req);
$fn$;

-- =====================================================================
-- 4절. 작성 · 상신 · 처리 · 회수 · 재상신
-- =====================================================================
/** 임시저장(새로 · 고치기). 기안자 본인 · 임시저장만. 상신 뒤에는 고치지 않는다. */
create or replace function ea_save_draft(p_doc uuid, p_business text, p_form text, p_title text, p_body text, p_fields jsonb, p_line jsonb,
                                         p_refs jsonb, p_due date, p_wish date, p_followup uuid, p_related uuid[]) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d    ea_docs;
  v_id uuid;
  v_amt numeric;
begin
  if not ea_human() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if not feature_on('approvals', p_business) or not has_business(p_business) then raise exception 'ea_denied' using errcode = '42501'; end if;
  if not exists (select 1 from ea_forms where form_key = p_form and active) then raise exception 'ea_form' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_fields, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_line, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_refs, '[]'::jsonb)) <> 'array' then
    raise exception 'ea_shape' using errcode = '22023';
  end if;
  v_amt := case when coalesce(p_fields ->> 'total', '') ~ '^[0-9]+$' then (p_fields ->> 'total')::numeric end;
  if p_doc is null then
    insert into ea_docs (business_id, form_key, title, body, fields, amount, line, refs, due_date, wish_date, followup_assignee, related, drafter_name, drafter_dept)
    values (p_business, p_form, coalesce(nullif(btrim(p_title), ''), '(제목 없음)'), coalesce(p_body, ''), coalesce(p_fields, '{}'::jsonb), v_amt,
            coalesce(p_line, '[]'::jsonb), coalesce(p_refs, '[]'::jsonb), p_due, p_wish, p_followup, coalesce(p_related, '{}'), ea_name(auth.uid()), ea_dept(auth.uid()))
    returning doc_id into v_id;
    perform ea_event(v_id, 'draft', null, false, null, null, null, null, null);
    return v_id;
  end if;
  select * into d from ea_docs where doc_id = p_doc for update;
  if d.doc_id is null or d.drafter <> auth.uid() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if d.status <> 'draft' then raise exception 'ea_not_draft' using errcode = '22023'; end if;
  update ea_docs set business_id = p_business, form_key = p_form, title = coalesce(nullif(btrim(p_title), ''), '(제목 없음)'), body = coalesce(p_body, ''),
         fields = coalesce(p_fields, '{}'::jsonb), amount = v_amt, line = coalesce(p_line, '[]'::jsonb), refs = coalesce(p_refs, '[]'::jsonb),
         due_date = p_due, wish_date = p_wish, followup_assignee = p_followup, related = coalesce(p_related, '{}'), updated_at = now()
   where doc_id = p_doc;
  return p_doc;
end;
$fn$;

create or replace function ea_delete_draft(p_doc uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d ea_docs;
begin
  select * into d from ea_docs where doc_id = p_doc for update;
  if d.doc_id is null or d.drafter <> auth.uid() or not ea_human() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if d.status <> 'draft' then raise exception 'ea_not_draft' using errcode = '22023'; end if;
  -- 상신한 적 없는 임시 문서만 지운다(이력 · 첨부 줄과 함께). 첨부 객체는 앱이 버킷에서 지운다.
  delete from ea_files where doc_id = p_doc;
  delete from ea_events where doc_id = p_doc;
  delete from ea_docs where doc_id = p_doc;
  return true;
end;
$fn$;

/** 상신 — 필수 칸 · 금액 합계 · 첨부 · 결재선(사람 · 대표 · 규칙)을 서버가 다시 본다. 양식 · 결재선을 문서에 얼린다. */
create or replace function ea_submit(p_doc uuid, p_req text) returns text
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d      ea_docs;
  f      ea_forms;
  e      jsonb;
  v_seq  int := 0;
  v_user uuid;
  v_role text;
  v_kind text;
  v_seen uuid[] := '{}';
  v_no   text;
  v_need boolean;
  v_last text;
  v_first uuid;
begin
  if ea_seen(p_req) then return (select doc_no from ea_docs where doc_id = p_doc); end if;
  select * into d from ea_docs where doc_id = p_doc for update;
  if d.doc_id is null or d.drafter <> auth.uid() or not ea_human() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if not feature_on('approvals', d.business_id) then raise exception 'ea_denied' using errcode = '42501'; end if;
  if d.status <> 'draft' then raise exception 'ea_not_draft' using errcode = '22023'; end if;
  select * into f from ea_forms where form_key = d.form_key;
  if not f.active then raise exception 'ea_form' using errcode = '22023'; end if;
  if length(btrim(d.title)) < 2 or d.title = '(제목 없음)' then raise exception 'ea_title' using errcode = '22023'; end if;
  -- 필수 칸
  for e in select * from jsonb_array_elements(f.fields) loop
    if coalesce((e ->> 'required')::boolean, false) and btrim(coalesce(d.fields ->> (e ->> 'key'), '')) = '' then
      raise exception 'ea_required' using errcode = '22023', detail = e ->> 'label';
    end if;
    if (e ->> 'type') in ('money', 'number') and btrim(coalesce(d.fields ->> (e ->> 'key'), '')) <> '' and (d.fields ->> (e ->> 'key')) !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'ea_number' using errcode = '22023', detail = e ->> 'label';
    end if;
  end loop;
  if d.form_key = 'general' and length(btrim(d.body)) < 2 then raise exception 'ea_required' using errcode = '22023', detail = '신청 내용'; end if;
  -- 금액 합계(구매: 공급가 + 부가세 = 합계)
  if d.form_key = 'purchase' and (d.fields ->> 'supply')::numeric + (d.fields ->> 'vat')::numeric <> (d.fields ->> 'total')::numeric then
    raise exception 'ea_total' using errcode = '22023';
  end if;
  if d.form_key in ('vacation', 'trip') and (d.fields ->> 'end')::date < (d.fields ->> 'start')::date then raise exception 'ea_dates' using errcode = '22023'; end if;
  if f.attachment_required and not exists (select 1 from ea_files where doc_id = p_doc and kind = 'doc') then raise exception 'ea_attachment' using errcode = '22023'; end if;
  if f.followup_required and d.followup_assignee is null then raise exception 'ea_followup_assignee' using errcode = '22023'; end if;
  if d.followup_assignee is not null and not exists (select 1 from user_profiles where user_id = d.followup_assignee and revoked_at is null) then
    raise exception 'ea_followup_assignee' using errcode = '22023';
  end if;
  -- 결재선: 1~10단계 · 사람은 활성 · 사람(시스템 계정 아님) · 기안자 아님 · 겹치지 않음 · 역할은 «대표»만 · 마지막은 승인.
  if jsonb_array_length(d.line) = 0 or jsonb_array_length(d.line) > 10 then raise exception 'ea_line' using errcode = '22023', detail = '결재선 1~10단계'; end if;
  delete from ea_steps where doc_id = p_doc;
  for e in select * from jsonb_array_elements(d.line) loop
    v_seq := v_seq + 1;
    v_kind := coalesce(e ->> 'kind', 'approve');
    if v_kind not in ('approve', 'agree') then raise exception 'ea_line' using errcode = '22023', detail = '단계 종류'; end if;
    v_role := nullif(e ->> 'role', '');
    v_user := case when coalesce(e ->> 'user_id', '') ~ '^[0-9a-f-]{36}$' then (e ->> 'user_id')::uuid end;
    if v_role is not null then
      if v_role <> 'Chairman' or v_user is not null then raise exception 'ea_line' using errcode = '22023', detail = '역할 단계는 대표만'; end if;
      v_user := null;
      if ea_chairman_uid() is null then raise exception 'ea_line' using errcode = '22023', detail = '대표 계정 없음'; end if;
      if ea_chairman_uid() = auth.uid() then raise exception 'ea_line' using errcode = '22023', detail = '기안자가 결재선에'; end if;
      if ea_chairman_uid() = any (v_seen) then raise exception 'ea_line' using errcode = '22023', detail = '같은 사람이 두 번'; end if;
      v_seen := v_seen || ea_chairman_uid();
    else
      if v_user is null or not exists (select 1 from user_profiles p where p.user_id = v_user and p.revoked_at is null and p.role::text not in ('AIAgent', 'Integration')) then
        raise exception 'ea_line' using errcode = '22023', detail = '결재자 없음 · 퇴사';
      end if;
      if v_user = auth.uid() then raise exception 'ea_line' using errcode = '22023', detail = '기안자가 결재선에'; end if;
      if v_user = any (v_seen) then raise exception 'ea_line' using errcode = '22023', detail = '같은 사람이 두 번'; end if;
      v_seen := v_seen || v_user;
    end if;
    insert into ea_steps (doc_id, seq, kind, approver_user, approver_role, approver_name, status, waiting_since)
    values (p_doc, v_seq, v_kind, v_user, v_role, case when v_role = 'Chairman' then '대표' else ea_name(v_user) end,
            case when v_seq = 1 then 'waiting' else 'planned' end, case when v_seq = 1 then now() end);
    v_last := v_kind;
    if v_seq = 1 then v_first := ea_step_owner(v_user, v_role); end if;
  end loop;
  if v_last <> 'approve' then raise exception 'ea_line' using errcode = '22023', detail = '마지막 단계는 승인'; end if;
  -- 전결 규칙: 금액 이상이면 대표 단계 필수.
  select bool_or(r.require_chairman) into v_need from ea_line_rules r
   where r.active and (r.form_key is null or r.form_key = d.form_key) and (r.business_id is null or r.business_id = d.business_id)
     and coalesce(d.amount, 0) >= r.min_amount;
  if coalesce(v_need, false) and not exists (select 1 from ea_steps where doc_id = p_doc and approver_role = 'Chairman')
     and coalesce(auth_role()::text, '') <> 'Chairman' then
    raise exception 'ea_line_rule' using errcode = '22023', detail = '이 금액은 대표 승인이 필요합니다';
  end if;
  -- 참조 · 열람자
  delete from ea_refs where doc_id = p_doc;
  insert into ea_refs (doc_id, user_id, kind)
  select distinct on ((x ->> 'user_id')::uuid) p_doc, (x ->> 'user_id')::uuid, coalesce(nullif(x ->> 'kind', ''), 'cc')
    from jsonb_array_elements(d.refs) x
   where coalesce(x ->> 'user_id', '') ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from user_profiles p where p.user_id = (x ->> 'user_id')::uuid and p.revoked_at is null)
     and (x ->> 'user_id')::uuid <> auth.uid()
     and coalesce(nullif(x ->> 'kind', ''), 'cc') in ('cc', 'viewer');
  v_no := 'GW-' || to_char(now() at time zone 'Asia/Seoul', 'YYYY') || '-' || lpad(nextval('ea_doc_seq')::text, 4, '0');
  update ea_docs set status = 'in_progress', current_seq = 1, submitted_at = now(), updated_at = now(), doc_no = v_no,
         form_version = f.version, form_snapshot = jsonb_build_object('name', f.name_ko, 'fields', f.fields, 'attachment_required', f.attachment_required,
                                                                    'followup_kind', f.followup_kind, 'version', f.version),
         drafter_name = ea_name(auth.uid()), drafter_dept = ea_dept(auth.uid())
   where doc_id = p_doc;
  perform ea_event(p_doc, 'submit', null, false, null, null, jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'in_progress', 'doc_no', v_no, 'steps', v_seq), p_req);
  perform ea_notify(v_first, '결재 요청: ' || d.title, p_doc, 'todo');
  for v_user in select user_id from ea_refs where doc_id = p_doc loop
    perform ea_notify(v_user, '참조: ' || d.title, p_doc, 'refs');
  end loop;
  return v_no;
end;
$fn$;

/**
 * 승인 · 합의 · 반려. 문서 줄을 잠그고 지금 «대기» 단계인지 다시 본다(두 탭 · 재시도 → 하나만).
 * 처리자: 그 단계의 원 결재자 또는 유효한 대결자. 반려는 사유 필수. 마지막 승인 = 승인 완료 + 후속 처리 한 번.
 */
create or replace function ea_act(p_doc uuid, p_seq int, p_action text, p_comment text, p_req text) returns text
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d       ea_docs;
  s       ea_steps;
  v_owner uuid;
  v_proxy boolean := false;
  v_next  ea_steps;
  v_fu    jsonb;
begin
  if ea_seen(p_req) then return (select status from ea_docs where doc_id = p_doc); end if;
  if not ea_human() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if p_action not in ('approve', 'reject') then raise exception 'ea_shape' using errcode = '22023'; end if;
  select * into d from ea_docs where doc_id = p_doc for update;
  if d.doc_id is null or not feature_on('approvals', d.business_id) then raise exception 'ea_denied' using errcode = '42501'; end if;
  if d.status <> 'in_progress' then raise exception 'ea_step_not_waiting' using errcode = '22023'; end if;
  select * into s from ea_steps where doc_id = p_doc and seq = p_seq for update;
  if s.doc_id is null or s.status <> 'waiting' or d.current_seq is distinct from p_seq then raise exception 'ea_step_not_waiting' using errcode = '22023'; end if;
  v_owner := ea_step_owner(s.approver_user, s.approver_role);
  if v_owner = auth.uid() then
    v_proxy := false;
  elsif ea_proxy_for(v_owner, d.form_key, d.amount) then
    v_proxy := true;
  else
    raise exception 'ea_not_your_turn' using errcode = '42501';
  end if;
  if p_action = 'reject' and length(btrim(coalesce(p_comment, ''))) < 2 then raise exception 'ea_reason' using errcode = '22023'; end if;

  update ea_steps set status = case when p_action = 'approve' then 'approved' else 'rejected' end, acted_by = auth.uid(), acted_as_proxy = v_proxy,
         comment = nullif(btrim(coalesce(p_comment, '')), ''), acted_at = now()
   where doc_id = p_doc and seq = p_seq;
  perform ea_event(p_doc, case when p_action = 'reject' then 'reject' when s.kind = 'agree' then 'agree' else 'approve' end, p_seq, v_proxy,
                   case when v_proxy then v_owner end, p_comment, jsonb_build_object('step', 'waiting', 'doc', 'in_progress'),
                   jsonb_build_object('step', case when p_action = 'approve' then 'approved' else 'rejected' end), p_req);

  if p_action = 'reject' then
    update ea_steps set status = 'skipped' where doc_id = p_doc and status = 'planned';
    update ea_docs set status = 'rejected', current_seq = null, decided_at = now(), updated_at = now() where doc_id = p_doc;
    perform ea_notify(d.drafter, '반려: ' || d.title, p_doc, 'mine');
    return 'rejected';
  end if;

  select * into v_next from ea_steps where doc_id = p_doc and seq > p_seq order by seq limit 1;
  if v_next.doc_id is not null then
    update ea_steps set status = 'waiting', waiting_since = now() where doc_id = p_doc and seq = v_next.seq;
    update ea_docs set current_seq = v_next.seq, updated_at = now() where doc_id = p_doc;
    perform ea_notify(ea_step_owner(v_next.approver_user, v_next.approver_role), '결재 요청: ' || d.title, p_doc, 'todo');
    return 'in_progress';
  end if;

  update ea_docs set status = 'approved', current_seq = null, decided_at = now(), updated_at = now() where doc_id = p_doc;
  v_fu := d.form_snapshot;
  if (v_fu ->> 'followup_kind') is not null then
    insert into ea_followups (doc_id, kind, assignee, due_date)
    values (p_doc, v_fu ->> 'followup_kind', d.followup_assignee, d.wish_date)
    on conflict (doc_id) do nothing;
    if found then perform ea_notify(d.followup_assignee, '후속 처리: ' || d.title, p_doc, 'followups'); end if;
  end if;
  perform ea_notify(d.drafter, '승인 완료: ' || d.title, p_doc, 'mine');
  return 'approved';
end;
$fn$;

/** 회수 — 기안자만 · 진행 중 · 아직 아무도 처리하지 않았을 때만. 기록은 지우지 않는다. */
create or replace function ea_withdraw(p_doc uuid, p_req text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d ea_docs;
begin
  if ea_seen(p_req) then return true; end if;
  select * into d from ea_docs where doc_id = p_doc for update;
  if d.doc_id is null or d.drafter <> auth.uid() or not ea_human() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if d.status <> 'in_progress' then raise exception 'ea_not_in_progress' using errcode = '22023'; end if;
  if exists (select 1 from ea_steps where doc_id = p_doc and acted_at is not null) then raise exception 'ea_withdraw_acted' using errcode = '22023'; end if;
  update ea_steps set status = 'skipped' where doc_id = p_doc and status in ('planned', 'waiting');
  update ea_docs set status = 'withdrawn', current_seq = null, decided_at = now(), updated_at = now() where doc_id = p_doc;
  perform ea_event(p_doc, 'withdraw', null, false, null, null, jsonb_build_object('status', 'in_progress'), jsonb_build_object('status', 'withdrawn'), p_req);
  return true;
end;
$fn$;

/** 재상신 — 반려 · 회수된 원문서를 그대로 두고 새 판(임시저장)을 만들어 잇는다. 첨부는 같은 객체를 가리키는 줄로 잇는다. */
create or replace function ea_resubmit(p_doc uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d    ea_docs;
  v_id uuid;
begin
  select * into d from ea_docs where doc_id = p_doc for update;
  if d.doc_id is null or d.drafter <> auth.uid() or not ea_human() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if d.status not in ('rejected', 'withdrawn') then raise exception 'ea_resubmit_state' using errcode = '22023'; end if;
  if exists (select 1 from ea_docs n where n.prev_doc_id = p_doc and n.status = 'draft') then
    return (select n.doc_id from ea_docs n where n.prev_doc_id = p_doc and n.status = 'draft' limit 1);
  end if;
  insert into ea_docs (business_id, form_key, title, body, fields, amount, line, refs, due_date, wish_date, followup_assignee, related, version, prev_doc_id, drafter_name, drafter_dept)
  values (d.business_id, d.form_key, d.title, d.body, d.fields, d.amount, d.line, d.refs, d.due_date, d.wish_date, d.followup_assignee,
          array_append(d.related, d.doc_id), d.version + 1, d.doc_id, ea_name(auth.uid()), ea_dept(auth.uid()))
  returning doc_id into v_id;
  insert into ea_files (doc_id, kind, path, name, size_bytes, mime, uploaded_by)
  select v_id, f.kind, f.path, f.name, f.size_bytes, f.mime, f.uploaded_by from ea_files f where f.doc_id = p_doc and f.kind = 'doc';
  perform ea_event(p_doc, 'resubmit', null, false, null, null, null, jsonb_build_object('new_doc', v_id, 'version', d.version + 1), null);
  perform ea_event(v_id, 'draft', null, false, null, null, null, jsonb_build_object('from', p_doc), null);
  return v_id;
end;
$fn$;

/** 참조 · 열람자 — 열어 봄(seen) · 확인(confirm)을 따로. 승인 버튼은 없다. */
create or replace function ea_ref_mark(p_doc uuid, p_confirm boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not ea_can_read(p_doc) then raise exception 'ea_denied' using errcode = '42501'; end if;
  update ea_refs set seen_at = coalesce(seen_at, now()), confirmed_at = case when coalesce(p_confirm, false) then coalesce(confirmed_at, now()) else confirmed_at end
   where doc_id = p_doc and user_id = auth.uid();
  if found and coalesce(p_confirm, false) then perform ea_event(p_doc, 'confirm', null, false, null, null, null, null, null); end if;
  return found;
end;
$fn$;

/** 후속 처리 — 후속 담당자만. 완료하면 처리자 · 처리일 · 결과(· 전표번호 글자). 문서 상태는 그대로. */
create or replace function ea_followup_update(p_doc uuid, p_status text, p_result text, p_slip text, p_req text) returns text
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  x ea_followups;
begin
  if ea_seen(p_req) then return (select status from ea_followups where doc_id = p_doc); end if;
  select * into x from ea_followups where doc_id = p_doc for update;
  if x.doc_id is null or x.assignee is distinct from auth.uid() or not ea_human() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if p_status not in ('waiting', 'doing', 'done') then raise exception 'ea_shape' using errcode = '22023'; end if;
  if x.status = 'done' then raise exception 'ea_followup_done' using errcode = '22023'; end if;
  if p_status = 'done' and length(btrim(coalesce(p_result, ''))) < 2 then raise exception 'ea_reason' using errcode = '22023'; end if;
  update ea_followups set status = p_status, result = coalesce(nullif(btrim(coalesce(p_result, '')), ''), result), ecount_slip = coalesce(nullif(btrim(coalesce(p_slip, '')), ''), ecount_slip),
         done_by = case when p_status = 'done' then auth.uid() end, done_at = case when p_status = 'done' then now() end, updated_at = now()
   where doc_id = p_doc;
  perform ea_event(p_doc, 'followup', null, false, null, p_result, jsonb_build_object('followup', x.status), jsonb_build_object('followup', p_status, 'slip', p_slip), p_req);
  return p_status;
end;
$fn$;

-- =====================================================================
-- 5절. 첨부(버킷 ea-files — 0082와 같은 길: 브라우저가 바로 올리고 서버는 경로만)
-- =====================================================================
insert into storage.buckets (id, name, public) values ('ea-files', 'ea-files', false) on conflict (id) do nothing;
do $$
begin
  if exists (select 1 from storage.buckets where id = 'ea-files' and public) then
    raise exception 'ea-files 버킷이 공개로 설정되어 있다 — 비공개로 되돌린 뒤 다시 적용한다.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$ update storage.buckets set file_size_limit = 20971520 where id = 'ea-files' $q$;
  end if;
end $$;

/** 올리기: «<문서>/<이름>» — 그 문서가 임시저장이고 내가 기안자(문서 첨부), 또는 승인 완료 · 내가 후속 담당자(증빙, 이름이 fu-로 시작). */
create or replace function ea_object_insert_ok(object_name text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_parts text[] := string_to_array(object_name, '/');
  v_doc   uuid;
  d       ea_docs;
begin
  if not ea_human() or coalesce(array_length(v_parts, 1), 0) <> 2 or v_parts[1] !~ '^[0-9a-f-]{36}$' or v_parts[2] = '' then return false; end if;
  v_doc := v_parts[1]::uuid;
  select * into d from ea_docs where doc_id = v_doc;
  if d.doc_id is null then return false; end if;
  if d.status = 'draft' and d.drafter = auth.uid() then return true; end if;
  return d.status = 'approved' and v_parts[2] like 'fu-%' and exists (select 1 from ea_followups f where f.doc_id = v_doc and f.assignee = auth.uid() and f.status <> 'done');
end;
$fn$;

/** 내려받기: 그 객체를 가리키는 첨부 줄 중 하나라도 내가 읽을 수 있는 문서이면(재상신 판도 같은 객체).
 *  기안자는 자기 문서 폴더를 본다 — 올리는 순간(첨부 줄이 서기 전) Storage가 돌려받는 행을 읽을 수 있어야 한다. */
create or replace function ea_object_read_ok(object_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select ea_human() and (
    exists (select 1 from ea_files f where f.path = object_name and ea_can_read(f.doc_id))
    or exists (select 1 from ea_docs d where d.doc_id::text = split_part(object_name, '/', 1) and d.drafter = auth.uid()));
$fn$;

drop policy if exists ea_objects_read on storage.objects;
drop policy if exists ea_objects_insert on storage.objects;
create policy ea_objects_read on storage.objects for select to authenticated using (bucket_id = 'ea-files' and public.ea_object_read_ok(name));
create policy ea_objects_insert on storage.objects for insert to authenticated with check (bucket_id = 'ea-files' and public.ea_object_insert_ok(name));

/** 첨부 줄 — 올린 객체가 있어야 한다. 상신 뒤 문서 첨부는 더하지 못한다(증빙은 후속 담당자만). */
create or replace function ea_file_add(p_doc uuid, p_path text, p_name text, p_size bigint, p_mime text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id uuid;
  v_kind text := case when split_part(p_path, '/', 2) like 'fu-%' then 'evidence' else 'doc' end;
begin
  if split_part(p_path, '/', 1) <> p_doc::text or not ea_object_insert_ok(p_path) then raise exception 'ea_denied' using errcode = '42501'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'ea-files' and o.name = p_path) then raise exception 'ea_file_missing' using errcode = '22023'; end if;
  insert into ea_files (doc_id, kind, path, name, size_bytes, mime) values (p_doc, v_kind, p_path, left(p_name, 255), p_size, left(p_mime, 100))
  on conflict (doc_id, path) do update set name = excluded.name
  returning file_id into v_id;
  return v_id;
end;
$fn$;

/** 임시저장 첨부 빼기(줄만 — 객체는 앱이 지운다). */
create or replace function ea_file_remove(p_file uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_path text;
begin
  delete from ea_files f using ea_docs d
   where f.file_id = p_file and d.doc_id = f.doc_id and d.status = 'draft' and d.drafter = auth.uid()
  returning f.path into v_path;
  if v_path is null then raise exception 'ea_denied' using errcode = '42501'; end if;
  return v_path;
end;
$fn$;

-- =====================================================================
-- 6절. 목록 · 건수 · 상세(홈 위젯과 메뉴가 같은 함수를 쓴다)
-- =====================================================================
/**
 * 상자별 목록. todo = 지금 내 차례(대결 포함) · planned = 결재선에 있지만 아직 아님(선결재 없음) · mine = 내가 올린 것(임시저장 빼고) ·
 * drafts = 임시저장 · history = 내가 처리한 것(내 결과와 문서 전체 상태를 따로) · refs = 참조 · 열람 · followups = 내 후속 처리.
 */
create or replace function ea_list(p_box text, p_q text default null)
returns table (doc_id uuid, doc_no text, title text, form_key text, form_name text, drafter_name text, drafter_dept text, submitted_at timestamptz,
               status text, current_label text, due_date date, overdue boolean, my_role text, my_result text, as_proxy boolean,
               ref_confirmed boolean, followup_status text, followup_kind text, amount numeric, updated_at timestamptz, version int)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
declare
  v_me   uuid := auth.uid();
  v_q    text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not ea_human() then return; end if;
  return query
  with base as (
    select d.*, (select s.approver_name || ' ' || case s.kind when 'agree' then '합의' else '검토' end from ea_steps s where s.doc_id = d.doc_id and s.seq = d.current_seq) as cur,
           coalesce(d.form_snapshot ->> 'name', (select fm.name_ko from ea_forms fm where fm.form_key = d.form_key)) as fname
      from ea_docs d
     where feature_on('approvals', d.business_id)
       and (v_q is null or d.title ilike '%' || v_q || '%' or d.drafter_name ilike '%' || v_q || '%')
  ), mine_steps as (
    select s.doc_id, s.seq, s.kind, s.status, s.acted_by, s.acted_as_proxy, (ea_step_owner(s.approver_user, s.approver_role) = v_me) as own
      from ea_steps s join base b on b.doc_id = s.doc_id
     where ea_step_owner(s.approver_user, s.approver_role) = v_me or s.acted_by = v_me
        or (s.status = 'waiting' and ea_proxy_for(ea_step_owner(s.approver_user, s.approver_role), b.form_key, b.amount))
  )
  select b.doc_id, b.doc_no, b.title, b.form_key, b.fname, b.drafter_name, b.drafter_dept, b.submitted_at, b.status,
         case b.status when 'in_progress' then b.cur when 'approved' then '승인 완료' when 'rejected' then '반려' when 'withdrawn' then '회수' else '임시저장' end,
         b.due_date, (b.due_date is not null and b.status = 'in_progress' and b.due_date < (now() at time zone 'Asia/Seoul')::date),
         ms.kind, ms.status, coalesce(ms.acted_as_proxy, false) or (ms.doc_id is not null and not ms.own and ms.status = 'waiting'),
         r.confirmed_at is not null, fu.status, fu.kind, b.amount, b.updated_at, b.version
    from base b
    left join lateral (select * from mine_steps m where m.doc_id = b.doc_id
                        order by (m.status = 'waiting') desc, m.seq limit 1) ms on true
    left join ea_refs r on r.doc_id = b.doc_id and r.user_id = v_me
    left join ea_followups fu on fu.doc_id = b.doc_id
   where case p_box
           when 'todo' then b.status = 'in_progress' and ms.status = 'waiting'
           when 'planned' then b.status = 'in_progress' and ms.status = 'planned' and ms.own
           when 'mine' then b.drafter = v_me and b.status <> 'draft'
           when 'drafts' then b.drafter = v_me and b.status = 'draft'
           when 'history' then exists (select 1 from ea_steps s where s.doc_id = b.doc_id and s.acted_by = v_me and s.status in ('approved', 'rejected'))
           when 'refs' then r.user_id is not null and b.status <> 'draft'
           when 'followups' then fu.assignee = v_me and b.status = 'approved'
           else false end
   order by coalesce(b.submitted_at, b.updated_at) desc
   limit 300;
end;
$fn$;

/** 건수 — 홈 위젯과 메뉴가 같은 수를 본다(결재 예정은 «결재할 문서»에 안 센다). */
create or replace function ea_counts() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $fn$
  select jsonb_build_object(
    'todo', (select count(*) from ea_list('todo')),
    'planned', (select count(*) from ea_list('planned')),
    'mine', (select count(*) from ea_list('mine') l where l.status = 'in_progress'),
    'drafts', (select count(*) from ea_list('drafts')),
    'history', (select count(*) from ea_list('history')),
    'refs', (select count(*) from ea_list('refs') l where not l.ref_confirmed),
    'followups', (select count(*) from ea_list('followups') l where l.followup_status <> 'done'));
$fn$;

/** 상세 — 읽을 수 없으면 null(제목도 안 나간다). 관련 문서 · 이전 판은 읽을 수 있는 것만 제목을 싣는다. */
create or replace function ea_doc(p_doc uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  d ea_docs;
  v_me uuid := auth.uid();
  v_fu ea_followups;
  v_assignee_only boolean;
begin
  if not ea_can_read(p_doc) then return null; end if;
  select * into d from ea_docs where doc_id = p_doc;
  select * into v_fu from ea_followups where doc_id = p_doc;
  return jsonb_build_object(
    'doc', to_jsonb(d) - 'line' - 'refs' || jsonb_build_object('line', case when d.status = 'draft' then d.line end, 'refs_draft', case when d.status = 'draft' then d.refs end,
                                                                'form_name', coalesce(d.form_snapshot ->> 'name', (select name_ko from ea_forms where form_key = d.form_key)),
                                                                'followup_assignee_name', case when d.followup_assignee is not null then ea_name(d.followup_assignee) end),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('seq', s.seq, 'kind', s.kind, 'name', s.approver_name, 'role', s.approver_role, 'user_id', s.approver_user,
                                                          'status', s.status, 'acted_by_name', case when s.acted_by is not null then ea_name(s.acted_by) end,
                                                          'as_proxy', s.acted_as_proxy, 'comment', s.comment, 'acted_at', s.acted_at,
                                                          'mine', ea_step_owner(s.approver_user, s.approver_role) = v_me,
                                                          'can_act', d.status = 'in_progress' and s.status = 'waiting' and d.current_seq = s.seq
                                                                     and (ea_step_owner(s.approver_user, s.approver_role) = v_me or ea_proxy_for(ea_step_owner(s.approver_user, s.approver_role), d.form_key, d.amount)))
                                        order by s.seq) from ea_steps s where s.doc_id = p_doc), '[]'::jsonb),
    'refs', coalesce((select jsonb_agg(jsonb_build_object('name', ea_name(r.user_id), 'kind', r.kind, 'seen', r.seen_at is not null, 'confirmed', r.confirmed_at is not null, 'me', r.user_id = v_me))
                       from ea_refs r where r.doc_id = p_doc), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('file_id', f.file_id, 'name', f.name, 'size', f.size_bytes, 'kind', f.kind, 'path', f.path) order by f.created_at)
                        from ea_files f where f.doc_id = p_doc), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actor', ea_name(e.actor), 'as_proxy', e.as_proxy,
                                                           'original', case when e.original_user is not null then ea_name(e.original_user) end,
                                                           'comment', e.comment, 'seq', e.seq, 'at', e.at) order by e.at)
                         from ea_events e where e.doc_id = p_doc and e.action <> 'draft'), '[]'::jsonb),
    'followup', case when v_fu.doc_id is null then null else jsonb_build_object('kind', v_fu.kind, 'status', v_fu.status, 'assignee', ea_name(v_fu.assignee),
                     'mine', v_fu.assignee = v_me, 'due_date', v_fu.due_date, 'result', v_fu.result, 'ecount_slip', v_fu.ecount_slip,
                     'done_by', case when v_fu.done_by is not null then ea_name(v_fu.done_by) end, 'done_at', v_fu.done_at) end,
    'related', coalesce((select jsonb_agg(jsonb_build_object('doc_id', x, 'title', case when ea_can_read(x) then (select title from ea_docs where doc_id = x) end,
                                                            'doc_no', case when ea_can_read(x) then (select doc_no from ea_docs where doc_id = x) end))
                          from unnest(d.related) x), '[]'::jsonb),
    'versions', coalesce((with recursive chain as (
                             select v.doc_id, v.prev_doc_id, v.version, v.status, v.doc_no from ea_docs v where v.doc_id = d.prev_doc_id
                             union all select v.doc_id, v.prev_doc_id, v.version, v.status, v.doc_no from ea_docs v join chain c on v.doc_id = c.prev_doc_id)
                           select jsonb_agg(jsonb_build_object('doc_id', c.doc_id, 'version', c.version, 'status', c.status, 'doc_no', c.doc_no) order by c.version)
                             from chain c where ea_can_read(c.doc_id)), '[]'::jsonb),
    'next_version', (select n.doc_id from ea_docs n where n.prev_doc_id = p_doc and ea_can_read(n.doc_id) limit 1),
    'me', jsonb_build_object('drafter', d.drafter = v_me,
                             'can_withdraw', d.drafter = v_me and d.status = 'in_progress' and not exists (select 1 from ea_steps s where s.doc_id = p_doc and s.acted_at is not null),
                             'can_resubmit', d.drafter = v_me and d.status in ('rejected', 'withdrawn'),
                             'ref', (select jsonb_build_object('kind', r.kind, 'confirmed', r.confirmed_at is not null) from ea_refs r where r.doc_id = p_doc and r.user_id = v_me))
  );
end;
$fn$;

/** 결재선 · 참조 · 후속 담당 고르기 — 같은 회사 사람(이름 · 부서 · 직함만). 대표는 사람으로 고르지 않는다(역할 단계 «대표»). */
create or replace function ea_people()
returns table (user_id uuid, name text, dept text, title text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p.user_id, p.display_name, t.name, p.title_ko
    from user_profiles p left join teams t on t.team_id = p.team_id
   where ea_human() and p.revoked_at is null and p.user_id <> auth.uid()
     and p.role::text not in ('AIAgent', 'Integration', 'Chairman')
     and (coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO') or p.role::text = 'GroupCFO'
          or exists (select 1 from user_business_access a join user_business_access b on b.business_id = a.business_id
                      where a.user_id = auth.uid() and b.user_id = p.user_id))
   order by t.name nulls last, p.display_name;
$fn$;

-- =====================================================================
-- 7절. 개인 설정 — 자주 쓰는 결재선 · 대결자 · 알림
-- =====================================================================
create or replace function ea_proxy_save(p_proxy uuid, p_from date, p_to date, p_forms text[], p_max numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id uuid;
begin
  if not ea_human() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if not exists (select 1 from user_profiles where user_id = p_proxy and revoked_at is null and role::text not in ('AIAgent', 'Integration')) or p_proxy = auth.uid() then
    raise exception 'ea_proxy_user' using errcode = '22023';
  end if;
  insert into ea_proxies (owner, proxy, date_from, date_to, forms, max_amount) values (auth.uid(), p_proxy, p_from, p_to, p_forms, p_max) returning proxy_id into v_id;
  return v_id;
end;
$fn$;

create or replace function ea_proxy_end(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  update ea_proxies set active = false where proxy_id = p_id and owner = auth.uid() and active;
  return found;
end;
$fn$;

create or replace function ea_my_settings() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $fn$
  select case when not ea_human() then null else jsonb_build_object(
    'proxies', coalesce((select jsonb_agg(jsonb_build_object('proxy_id', x.proxy_id, 'proxy', ea_name(x.proxy), 'proxy_id_user', x.proxy, 'from', x.date_from, 'to', x.date_to, 'forms', x.forms, 'max_amount', x.max_amount, 'active', x.active) order by x.created_at desc)
                         from ea_proxies x where x.owner = auth.uid()), '[]'::jsonb),
    'proxy_for', coalesce((select jsonb_agg(jsonb_build_object('owner', ea_name(x.owner), 'from', x.date_from, 'to', x.date_to)) from ea_proxies x
                           where x.proxy = auth.uid() and x.active and (now() at time zone 'Asia/Seoul')::date between x.date_from and x.date_to), '[]'::jsonb),
    'favorites', coalesce((select jsonb_agg(jsonb_build_object('fav_id', f.fav_id, 'name', f.name, 'line', f.line, 'refs', f.refs) order by f.created_at) from ea_favorites f where f.owner = auth.uid()), '[]'::jsonb),
    'notify', coalesce((select s.notify from ea_settings s where s.user_id = auth.uid()), '{"turn":true,"result":true,"followup":true,"ref":true}'::jsonb)) end;
$fn$;

create or replace function ea_favorite_save(p_name text, p_line jsonb, p_refs jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id uuid;
begin
  if not ea_human() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if (select count(*) from ea_favorites where owner = auth.uid()) >= 20 then raise exception 'ea_shape' using errcode = '22023'; end if;
  insert into ea_favorites (owner, name, line, refs) values (auth.uid(), p_name, coalesce(p_line, '[]'::jsonb), coalesce(p_refs, '[]'::jsonb)) returning fav_id into v_id;
  return v_id;
end;
$fn$;

create or replace function ea_favorite_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  delete from ea_favorites where fav_id = p_id and owner = auth.uid();
  return found;
end;
$fn$;

create or replace function ea_settings_save(p_notify jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not ea_human() or jsonb_typeof(p_notify) is distinct from 'object' then raise exception 'ea_denied' using errcode = '42501'; end if;
  insert into ea_settings (user_id, notify) values (auth.uid(), p_notify) on conflict (user_id) do update set notify = excluded.notify, updated_at = now();
end;
$fn$;

-- =====================================================================
-- 8절. 관리자(대표) — 양식 · 결재선 규칙 · 처리자 바꾸기(사유)
-- =====================================================================
create or replace function ea_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select ea_human() and coalesce(auth_role()::text, '') = 'Chairman';
$fn$;

create or replace function ea_form_save(p_key text, p_name text, p_fields jsonb, p_attach boolean, p_followup text, p_followup_required boolean, p_note text, p_active boolean) returns int
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v int;
begin
  if not ea_admin() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if jsonb_typeof(p_fields) is distinct from 'array' or jsonb_array_length(p_fields) > 40 then raise exception 'ea_shape' using errcode = '22023'; end if;
  insert into ea_forms as f (form_key, name_ko, fields, attachment_required, followup_kind, followup_required, note, active, sort_order, updated_by)
  values (p_key, p_name, p_fields, coalesce(p_attach, false), nullif(btrim(coalesce(p_followup, '')), ''), coalesce(p_followup_required, false), p_note, coalesce(p_active, true), 99, auth.uid())
  on conflict (form_key) do update set name_ko = excluded.name_ko, fields = excluded.fields, attachment_required = excluded.attachment_required,
     followup_kind = excluded.followup_kind, followup_required = excluded.followup_required, note = excluded.note, active = excluded.active,
     version = f.version + 1, updated_by = auth.uid(), updated_at = now()
  returning version into v;
  insert into audit_log (action, entity_table, entity_id, actor_user_id, actor_role, after, note)
  values ('update'::audit_action, 'ea_forms', p_key, auth.uid(), auth_role()::text, jsonb_build_object('version', v, 'name', p_name), '전자결재 양식(0087)');
  return v;
end;
$fn$;

create or replace function ea_line_rule_save(p_id uuid, p_form text, p_business text, p_min numeric, p_require boolean, p_note text, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id uuid;
begin
  if not ea_admin() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if p_id is null then
    insert into ea_line_rules (form_key, business_id, min_amount, require_chairman, note, active, updated_by)
    values (p_form, p_business, coalesce(p_min, 0), coalesce(p_require, true), p_note, coalesce(p_active, true), auth.uid()) returning rule_id into v_id;
  else
    update ea_line_rules set form_key = p_form, business_id = p_business, min_amount = coalesce(p_min, 0), require_chairman = coalesce(p_require, true), note = p_note,
           active = coalesce(p_active, true), updated_by = auth.uid(), updated_at = now() where rule_id = p_id returning rule_id into v_id;
  end if;
  insert into audit_log (action, entity_table, entity_id, actor_user_id, actor_role, after, note)
  values ('update'::audit_action, 'ea_line_rules', v_id::text, auth.uid(), auth_role()::text, jsonb_build_object('form', p_form, 'min', p_min, 'require', p_require), '전자결재 결재선 규칙(0087)');
  return v_id;
end;
$fn$;

/** 퇴사 등으로 대기 · 예정 단계의 처리자를 바꾼다 — 관리자 · 사유 필수 · 이력. 처리한 단계는 못 바꾼다. */
create or replace function ea_reassign(p_doc uuid, p_seq int, p_user uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  s ea_steps;
begin
  if not ea_admin() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 then raise exception 'ea_reason' using errcode = '22023'; end if;
  select * into s from ea_steps where doc_id = p_doc and seq = p_seq for update;
  if s.doc_id is null or s.status not in ('planned', 'waiting') then raise exception 'ea_step_not_waiting' using errcode = '22023'; end if;
  if not exists (select 1 from user_profiles where user_id = p_user and revoked_at is null) then raise exception 'ea_line' using errcode = '22023'; end if;
  update ea_steps set approver_user = p_user, approver_role = null, approver_name = ea_name(p_user) where doc_id = p_doc and seq = p_seq;
  perform ea_event(p_doc, 'reassign', p_seq, false, ea_step_owner(s.approver_user, s.approver_role), p_reason, jsonb_build_object('from', s.approver_name), jsonb_build_object('to', ea_name(p_user)), null);
  return true;
end;
$fn$;

-- =====================================================================
-- 9절. 기능 스위치 · 함수 권한
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'approvals', true, 'chairman', '기본값(0087)')
on conflict do nothing;

revoke all on function ea_human() from public, anon, authenticated;
revoke all on function ea_chairman_uid() from public, anon, authenticated;
revoke all on function ea_step_owner(uuid, text) from public, anon, authenticated;
revoke all on function ea_proxy_for(uuid, text, numeric) from public, anon, authenticated;
revoke all on function ea_name(uuid) from public, anon, authenticated;
revoke all on function ea_dept(uuid) from public, anon, authenticated;
revoke all on function ea_notify(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function ea_event(uuid, text, int, boolean, uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function ea_seen(text) from public, anon, authenticated;
revoke all on function ea_admin() from public, anon, authenticated;
revoke all on function ea_can_read(uuid) from public, anon;
revoke all on function ea_object_insert_ok(text) from public, anon;
revoke all on function ea_object_read_ok(text) from public, anon;
revoke all on function ea_save_draft(uuid, text, text, text, text, jsonb, jsonb, jsonb, date, date, uuid, uuid[]) from public, anon;
revoke all on function ea_delete_draft(uuid) from public, anon;
revoke all on function ea_submit(uuid, text) from public, anon;
revoke all on function ea_act(uuid, int, text, text, text) from public, anon;
revoke all on function ea_withdraw(uuid, text) from public, anon;
revoke all on function ea_resubmit(uuid) from public, anon;
revoke all on function ea_ref_mark(uuid, boolean) from public, anon;
revoke all on function ea_followup_update(uuid, text, text, text, text) from public, anon;
revoke all on function ea_file_add(uuid, text, text, bigint, text) from public, anon;
revoke all on function ea_file_remove(uuid) from public, anon;
revoke all on function ea_list(text, text) from public, anon;
revoke all on function ea_counts() from public, anon;
revoke all on function ea_doc(uuid) from public, anon;
revoke all on function ea_people() from public, anon;
revoke all on function ea_proxy_save(uuid, date, date, text[], numeric) from public, anon;
revoke all on function ea_proxy_end(uuid) from public, anon;
revoke all on function ea_my_settings() from public, anon;
revoke all on function ea_favorite_save(text, jsonb, jsonb) from public, anon;
revoke all on function ea_favorite_delete(uuid) from public, anon;
revoke all on function ea_settings_save(jsonb) from public, anon;
revoke all on function ea_form_save(text, text, jsonb, boolean, text, boolean, text, boolean) from public, anon;
revoke all on function ea_line_rule_save(uuid, text, text, numeric, boolean, text, boolean) from public, anon;
revoke all on function ea_reassign(uuid, int, uuid, text) from public, anon;

grant execute on function ea_can_read(uuid) to authenticated;
grant execute on function ea_object_insert_ok(text) to authenticated;
grant execute on function ea_object_read_ok(text) to authenticated;
grant execute on function ea_save_draft(uuid, text, text, text, text, jsonb, jsonb, jsonb, date, date, uuid, uuid[]) to authenticated;
grant execute on function ea_delete_draft(uuid) to authenticated;
grant execute on function ea_submit(uuid, text) to authenticated;
grant execute on function ea_act(uuid, int, text, text, text) to authenticated;
grant execute on function ea_withdraw(uuid, text) to authenticated;
grant execute on function ea_resubmit(uuid) to authenticated;
grant execute on function ea_ref_mark(uuid, boolean) to authenticated;
grant execute on function ea_followup_update(uuid, text, text, text, text) to authenticated;
grant execute on function ea_file_add(uuid, text, text, bigint, text) to authenticated;
grant execute on function ea_file_remove(uuid) to authenticated;
grant execute on function ea_list(text, text) to authenticated;
grant execute on function ea_counts() to authenticated;
grant execute on function ea_doc(uuid) to authenticated;
grant execute on function ea_people() to authenticated;
grant execute on function ea_proxy_save(uuid, date, date, text[], numeric) to authenticated;
grant execute on function ea_proxy_end(uuid) to authenticated;
grant execute on function ea_my_settings() to authenticated;
grant execute on function ea_favorite_save(text, jsonb, jsonb) to authenticated;
grant execute on function ea_favorite_delete(uuid) to authenticated;
grant execute on function ea_settings_save(jsonb) to authenticated;
grant execute on function ea_form_save(text, text, jsonb, boolean, text, boolean, text, boolean) to authenticated;
grant execute on function ea_line_rule_save(uuid, text, text, numeric, boolean, text, boolean) to authenticated;
grant execute on function ea_reassign(uuid, int, uuid, text) to authenticated;
revoke all on sequence ea_doc_seq from public, anon, authenticated;

commit;
