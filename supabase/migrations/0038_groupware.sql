-- ---------------------------------------------------------------------
-- 0038. 그룹웨어 · 전자결재 양식 · 문서 폴더 (Phase 9 블록 1~3)
--
-- 회장 지시 원문의 원칙: "이미 있는 건 연결, 없는 건 직원 홈과 같은 권한(subtree·회사·등급)으로."
-- 그래서 이 파일은 **새 권한 모델을 만들지 않는다.** 회사 격리는 has_business(), 사람의 높이는
-- role_rank()(0026), 문서 등급은 0026의 documents_read가 그대로 판정한다.
--
-- 0035 머리 주석의 규칙을 따른다:
--   * force row level security를 새로 걸지 않는다. 자물쇠는 revoke다.
--   * 0001~0037을 고치지 않는다. documents·decisions에는 칸만 더한다.
--   * 날짜 경계는 at time zone 'Asia/Seoul'. service_role은 없다.
--
-- 1절 공지(notices · notice_reads)      — 블록 1
-- 2절 결재 양식(approval_templates)     — 블록 2. decisions에 양식 · 양식 값 · 결재선 칸.
-- 3절 문서 폴더 · 태그 · 버전            — 블록 3. documents에 folder_id · tags · supersedes.
-- ---------------------------------------------------------------------

-- =====================================================================
-- 1절. 공지
--
-- **회사 단위 '공개' 등급이다.** 그 회사 사람이면 누구나 읽는다(has_business). 회사가 없는
-- 공지(business_id null)는 그룹 전체 공지이고 활성 사용자 전원이 읽는다. 문서 등급을 따로
-- 두지 않는다 — 공지는 알리려고 쓰는 글이라 등급을 나누는 순간 공지가 아니다. 등급이 필요한
-- 글은 문서(documents)로 올린다.
--
-- **쓰기는 Executive 이상**(role_rank >= 2). 그룹 전체 공지는 그룹 범위 역할만(Chairman ·
-- GroupCFO) — 한 회사의 임원이 그룹 전 직원에게 글을 내보내지 않는다.
--
-- **읽음 확인은 작성자와 회장만 본다**(notice_reads_read). 누가 안 읽었는지를 동료가 보면
-- 공지가 출석부가 된다. 본인은 자기 줄을 본다(«읽음» 표시를 그리려고).
-- =====================================================================
create table notices (
  notice_id   bigint generated always as identity primary key,
  business_id text references businesses(business_id) on delete restrict,        -- [일반] null = 그룹 전체
  title       text not null check (length(trim(title)) > 0),                      -- [일반]
  body        text not null default '',                                           -- [일반]
  title_en    text,                                                               -- [일반] 영문 화면. 없으면 한글을 그린다
  body_en     text,                                                               -- [일반]
  pinned      boolean not null default false,                                     -- [일반] 띠 맨 앞
  -- 공지를 내리는 날(KST 날짜). 이날이 지나면 띠에서 빠진다. null = 내릴 때까지.
  expires_on  date,                                                               -- [일반]
  created_by  uuid not null default auth.uid() references auth.users(id),         -- [일반]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index notices_by_business on notices (business_id, created_at desc);
create trigger notices_updated_at before update on notices
  for each row execute function set_updated_at();

comment on table notices is
  '0038. 공지. 회사 단위 공개 등급 — 그 회사 사람 전원이 읽는다. business_id null = 그룹 전체. 쓰기 Executive 이상.';

create table notice_reads (
  notice_id bigint not null references notices(notice_id) on delete cascade,
  user_id   uuid not null default auth.uid() references auth.users(id),
  read_at   timestamptz not null default now(),
  primary key (notice_id, user_id)
);

comment on table notice_reads is
  '0038. 누가 공지를 읽었나. 작성자와 회장만 남의 줄을 본다 — 동료가 보면 공지가 출석부가 된다.';

create or replace function can_read_notice(p_business text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and (p_business is null or has_business(p_business));
$fn$;

create or replace function can_write_notice(p_business text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active()
     and role_rank(auth_role()) >= 2
     and case when p_business is null then has_group_scope() else has_business(p_business) end;
$fn$;

-- 읽음 줄을 볼 수 있는 사람: 그 공지의 작성자, 또는 회장. 공지 표를 definer로 읽는 이유 —
-- notices는 이 사람에게 이미 보이지만, 정책 안의 하위 질의가 RLS를 또 타면 판정이 두 번 된다.
create or replace function can_see_notice_reads(p_notice bigint) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and (
    auth_role()::text = 'Chairman'
    or exists (select 1 from notices n where n.notice_id = p_notice and n.created_by = auth.uid())
  );
$fn$;

alter table notices enable row level security;
alter table notice_reads enable row level security;

create policy notices_read on notices
  for select using (can_read_notice(business_id));
create policy notices_insert on notices
  for insert with check (can_write_notice(business_id) and created_by = auth.uid());
-- 고치고 내리는 것은 쓴 사람, 또는 회장. 같은 회사 임원이 남의 공지를 고치지 않는다.
create policy notices_update on notices
  for update using (can_write_notice(business_id) and (created_by = auth.uid() or auth_role()::text = 'Chairman'))
  with check (can_write_notice(business_id) and (created_by = auth.uid() or auth_role()::text = 'Chairman'));
create policy notices_delete on notices
  for delete using (can_write_notice(business_id) and (created_by = auth.uid() or auth_role()::text = 'Chairman'));

create policy notice_reads_read on notice_reads
  for select using (user_id = auth.uid() or can_see_notice_reads(notice_id));
-- 자기 줄만, 그리고 읽을 수 있는 공지에만. 남의 이름으로 «읽음»을 찍지 못한다.
create policy notice_reads_insert on notice_reads
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from notices n where n.notice_id = notice_reads.notice_id)
  );

revoke all on table notices from anon, authenticated;
revoke all on table notice_reads from anon, authenticated;
grant select, insert, update, delete on table notices to authenticated;
-- 읽음은 한 번 찍으면 끝이다 — 고치거나 지우는 길을 두지 않는다.
grant select, insert on table notice_reads to authenticated;

revoke execute on function can_read_notice(text) from public, anon;
revoke execute on function can_write_notice(text) from public, anon;
revoke execute on function can_see_notice_reads(bigint) from public, anon;
grant execute on function can_read_notice(text) to authenticated;
grant execute on function can_write_notice(text) to authenticated;
grant execute on function can_see_notice_reads(bigint) to authenticated;

-- AI Agent와 Integration은 공지를 쓰지 않는다. 사람에게 알리는 글은 사람이 쓴다.
create policy ai_agent_no_insert on notices as restrictive for insert
  with check (auth_role() is distinct from 'AIAgent');
create policy ai_agent_no_update on notices as restrictive for update
  using (auth_role() is distinct from 'AIAgent') with check (auth_role() is distinct from 'AIAgent');
create policy ai_agent_no_delete on notices as restrictive for delete
  using (auth_role() is distinct from 'AIAgent');
create policy integration_no_insert on notices as restrictive for insert with check (not is_integration());
create policy integration_no_update on notices as restrictive for update
  using (not is_integration()) with check (not is_integration());
create policy integration_no_delete on notices as restrictive for delete using (not is_integration());

create or replace function notices_audit() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (
    case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete_request' end::audit_action,
    'notices',
    coalesce(new.notice_id, old.notice_id)::text,
    coalesce(new.business_id, old.business_id),
    auth.uid(),
    auth_role()::text,
    case when tg_op in ('UPDATE', 'DELETE') then jsonb_build_object('title', old.title, 'pinned', old.pinned, 'expires_on', old.expires_on) end,
    case when tg_op in ('INSERT', 'UPDATE') then jsonb_build_object('title', new.title, 'pinned', new.pinned, 'expires_on', new.expires_on) end,
    case tg_op when 'DELETE' then '공지 삭제' else '공지' end
  );
  return coalesce(new, old);
end;
$fn$;

create trigger notices_audit_trigger
  after insert or update or delete on notices
  for each row execute function notices_audit();

-- =====================================================================
-- 2절. 결재 양식
--
-- 다섯 양식(지출 · 구매 · 휴가 · 계약 · 채용)과 양식별 필수 항목 · 첨부 여부.
-- **회장까지 올라가는 규칙이 이 표의 두 칸이다**(chairman_always · chairman_over).
-- 결재선 미리보기(lib/approval-line.ts)가 이 값을 읽는다 — 규칙을 코드에 박으면 금액 기준을
-- 바꾸는 날 배포가 필요해진다. 쓰기는 Chairman만: 무엇이 회장에게 오는지는 회장이 정한다.
--
-- fields는 [{key, label_ko, label_en, type, required}]. type은 text · number · money · date ·
-- textarea. chairman_over가 보는 금액 칸의 key는 'amount'로 고정한다.
-- =====================================================================
create table approval_templates (
  template_key        text primary key
                      check (template_key in ('expense', 'purchase', 'leave', 'contract', 'hiring')),
  name_ko             text not null,
  name_en             text not null,
  fields              jsonb not null check (jsonb_typeof(fields) = 'array'),
  attachment_required boolean not null default false,
  -- 금액과 상관없이 늘 회장까지 간다(계약 · 채용).
  chairman_always     boolean not null default false,
  -- fields의 amount가 이 값 이상이면 회장까지 간다(원). null = 금액 규칙 없음.
  chairman_over       numeric check (chairman_over is null or chairman_over >= 0),
  sort_order          int not null default 0,
  updated_at          timestamptz not null default now()
);

comment on table approval_templates is
  '0038. 전자결재 양식 다섯. 필수 항목 · 첨부 · 회장까지 가는 규칙(chairman_always · chairman_over)을 들고 있다.';

create trigger approval_templates_updated_at before update on approval_templates
  for each row execute function set_updated_at();

alter table approval_templates enable row level security;
create policy approval_templates_read on approval_templates for select using (is_active());
create policy approval_templates_write on approval_templates for update
  using (is_active() and auth_role()::text = 'Chairman')
  with check (is_active() and auth_role()::text = 'Chairman');
revoke all on table approval_templates from anon, authenticated;
-- 양식은 다섯으로 고정이다(check). 더하고 지우는 길은 없고 고치는 길만 있다.
grant select, update on table approval_templates to authenticated;

insert into approval_templates (template_key, name_ko, name_en, fields, attachment_required, chairman_always, chairman_over, sort_order) values
  ('expense', '지출', 'Expense', '[
     {"key":"amount","label_ko":"금액(원)","label_en":"Amount (KRW)","type":"money","required":true},
     {"key":"purpose","label_ko":"지출 목적","label_en":"Purpose","type":"textarea","required":true},
     {"key":"spent_on","label_ko":"지출일","label_en":"Date","type":"date","required":true}
   ]'::jsonb, true, false, 5000000, 10),
  ('purchase', '구매', 'Purchase', '[
     {"key":"item","label_ko":"품목","label_en":"Item","type":"text","required":true},
     {"key":"vendor","label_ko":"거래처","label_en":"Vendor","type":"text","required":true},
     {"key":"quantity","label_ko":"수량","label_en":"Quantity","type":"number","required":true},
     {"key":"amount","label_ko":"금액(원)","label_en":"Amount (KRW)","type":"money","required":true},
     {"key":"needed_on","label_ko":"필요일","label_en":"Needed by","type":"date","required":false}
   ]'::jsonb, true, false, 10000000, 20),
  ('leave', '휴가', 'Leave', '[
     {"key":"starts_on","label_ko":"시작일","label_en":"From","type":"date","required":true},
     {"key":"ends_on","label_ko":"종료일","label_en":"To","type":"date","required":true},
     {"key":"reason","label_ko":"사유","label_en":"Reason","type":"textarea","required":false}
   ]'::jsonb, false, false, null, 30),
  ('contract', '계약', 'Contract', '[
     {"key":"counterparty","label_ko":"계약 상대","label_en":"Counterparty","type":"text","required":true},
     {"key":"amount","label_ko":"계약 금액(원)","label_en":"Amount (KRW)","type":"money","required":true},
     {"key":"term","label_ko":"계약 기간","label_en":"Term","type":"text","required":true},
     {"key":"summary","label_ko":"주요 조건","label_en":"Key terms","type":"textarea","required":true}
   ]'::jsonb, true, true, null, 40),
  ('hiring', '채용', 'Hiring', '[
     {"key":"position","label_ko":"직무","label_en":"Position","type":"text","required":true},
     {"key":"team","label_ko":"배치 팀","label_en":"Team","type":"text","required":true},
     {"key":"amount","label_ko":"연봉(원)","label_en":"Annual salary (KRW)","type":"money","required":true},
     {"key":"reason","label_ko":"채용 사유","label_en":"Reason","type":"textarea","required":true}
   ]'::jsonb, true, true, null, 50);

-- decisions에 칸 셋. 기존 결재(양식 없음)는 셋 다 null이다 — 지어내 채우지 않는다.
-- approval_line은 **제출 순간의 결재선**을 얼려 둔다([{step, user_id, name, why}]). 팀장이 나중에
-- 바뀌어도 이 결재가 누구를 거쳐 올라왔는지는 그대로 남아야 한다.
alter table decisions add column template_key text references approval_templates(template_key);
alter table decisions add column form jsonb check (form is null or jsonb_typeof(form) = 'object');
alter table decisions add column approval_line jsonb check (approval_line is null or jsonb_typeof(approval_line) = 'array');

comment on column decisions.approval_line is
  '0038. 제출 순간의 결재선(팀장 → 규칙 판정 → 회장). 얼린 값이다 — 조직이 바뀌어도 고치지 않는다.';

-- 결재선의 첫 칸(팀장)을 찾는다. 요청자는 팀장의 프로필을 못 읽을 수 있어서(0026 subtree)
-- definer로 한 사람의 id · 이름만 낸다. 팀장이 공석이거나 본인이면 reports_to(직속 상위)로 간다
-- — 0025의 «팀장 부재 시 상위 임원이 자동 승계»와 같은 규칙이다. 아무도 없으면 0행.
create or replace function my_approval_lead()
returns table (user_id uuid, display_name text, via text)
language sql stable security definer set search_path = public as $fn$
  with me as (
    select p.user_id, p.team_id, p.reports_to from user_profiles p
     where p.user_id = auth.uid() and is_active()
  ),
  -- 떠난 사람(revoked_at · status='left')은 **고르기 전에** 뺀다. 팀장 칸이 떠난 사람을 가리킨
  -- 채로 남아 있으면(0026 승계 트리거는 떠나는 사람의 reports_to가 없을 때 아무것도 안 한다)
  -- 고른 뒤에 빼면 reports_to로 넘어가지도 못하고 0행이 된다.
  alive as (
    select p.user_id from user_profiles p where p.revoked_at is null and p.status = 'active'
  ),
  lead as (
    select t.lead_user_id as uid, 'team_lead'::text as via
      from me join teams t on t.team_id = me.team_id
     where t.lead_user_id is not null and t.lead_user_id <> me.user_id
       and t.lead_user_id in (select user_id from alive)
  ),
  boss as (
    select me.reports_to as uid, 'reports_to'::text as via from me
     where me.reports_to is not null and me.reports_to in (select user_id from alive)
  ),
  pick as (
    select uid, via from lead
    union all
    select uid, via from boss where not exists (select 1 from lead)
  )
  select p.user_id, p.display_name, pick.via
    from pick join user_profiles p on p.user_id = pick.uid
   where p.revoked_at is null
   limit 1;
$fn$;

revoke execute on function my_approval_lead() from public, anon;
grant execute on function my_approval_lead() to authenticated;

comment on function my_approval_lead is
  '0038. 결재선 첫 칸. 팀장(공석·본인이면 reports_to). 이름과 id만 낸다 — 프로필 전체를 열지 않는다.';

-- **결재선은 DB가 만든다.** 화면이 보낸 approval_line을 믿지 않는다 — 믿으면 기안자가 회장 칸을
-- 빼고 올릴 수 있다. 양식이 붙은 결재가 들어오는 순간 이 트리거가 팀장 칸(my_approval_lead) ·
-- 규칙 칸 · 회장 칸을 새로 적고, 필수 항목 · 첨부가 비었으면 거부한다. 화면의 미리보기
-- (lib/approval-line.ts)는 같은 규칙을 보여 줄 뿐이고 판정은 여기다.
--
-- 한 번 들어간 세 칸(template_key · form · approval_line)은 고치지 못한다. 결재자가 결정을
-- 기록하는 update(decisions_decide)가 결재선을 다시 쓰는 길이 되면 «얼린 값»이 아니다.
create or replace function decisions_approval_line() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_tpl approval_templates%rowtype;
  v_lead record;
  v_amount numeric;
  v_field jsonb;
  v_line jsonb := '[]'::jsonb;
  v_to_chairman boolean;
  v_why text;
begin
  if tg_op = 'UPDATE' then
    if new.template_key is distinct from old.template_key
       or new.form is distinct from old.form
       or new.approval_line is distinct from old.approval_line then
      raise exception 'approval_line_frozen' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.template_key is null then
    -- 양식 없는 결재(기존 흐름)는 결재선이 없다. 화면이 보낸 값도 받지 않는다.
    new.form := null;
    new.approval_line := null;
    return new;
  end if;

  select * into v_tpl from approval_templates where template_key = new.template_key;
  new.form := coalesce(new.form, '{}'::jsonb);

  for v_field in select * from jsonb_array_elements(v_tpl.fields) loop
    if (v_field->>'required')::boolean
       and coalesce(trim(new.form->>(v_field->>'key')), '') = '' then
      raise exception 'approval_form_missing:%', v_field->>'key' using errcode = '23514';
    end if;
  end loop;
  if v_tpl.attachment_required and coalesce(trim(new.attachment_url), '') = '' then
    raise exception 'approval_attachment_missing' using errcode = '23514';
  end if;

  select * into v_lead from my_approval_lead();
  if found then
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'lead', 'user_id', v_lead.user_id, 'name', v_lead.display_name,
      'why', case v_lead.via when 'team_lead' then '팀장' else '팀장 부재 · 직속 상위' end));
  else
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'lead', 'user_id', null, 'name', '—', 'why', '팀장 · 직속 상위가 없음'));
  end if;

  begin
    v_amount := nullif(regexp_replace(coalesce(new.form->>'amount', ''), '[^0-9.]', '', 'g'), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  v_to_chairman := v_tpl.chairman_always
    or (v_tpl.chairman_over is not null and v_amount is not null and v_amount >= v_tpl.chairman_over);
  v_why := case
    when v_tpl.chairman_always then v_tpl.name_ko || ' 양식은 금액과 상관없이 회장 결재'
    when v_tpl.chairman_over is null then v_tpl.name_ko || ' 양식은 회장 규칙 없음'
    when v_to_chairman then '금액 ' || v_amount::text || '원 ≥ 기준 ' || v_tpl.chairman_over::text || '원'
    else '금액 ' || coalesce(v_amount::text, '—') || '원 < 기준 ' || v_tpl.chairman_over::text || '원'
  end;
  v_line := v_line || jsonb_build_array(jsonb_build_object('step', 'rule', 'user_id', null, 'name', '규칙 판정', 'why', v_why));
  if v_to_chairman then
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'chairman',
      'user_id', (select user_id from user_profiles where role::text = 'Chairman' and revoked_at is null order by created_at limit 1),
      'name', '회장', 'why', '규칙이 회장까지 올린다'));
  end if;
  new.approval_line := v_line;
  return new;
end;
$fn$;

create trigger decisions_approval_line_trigger
  before insert or update on decisions
  for each row execute function decisions_approval_line();

-- =====================================================================
-- 3절. 문서 폴더 · 태그 · 버전
--
-- 폴더 트리는 회사 > 팀 > 폴더. 회사 층과 팀 층은 이미 있는 표(businesses · teams)이고,
-- 이 표는 그 아래의 폴더만 든다. team_id가 null이면 회사 바로 밑 폴더다.
--
-- **폴더는 문서의 등급을 바꾸지 않는다.** 폴더를 볼 수 있어도 그 안의 Vault 문서는 0026의
-- documents_read가 따로 막는다 — 폴더 이름만 보이고 문서는 안 보인다. Vault는 원래대로
-- 링크만 보관한다(CLAUDE.md, 변경 없음).
--
-- **버전.** 같은 회사 · 같은 폴더에 같은 제목(대소문자 무시)으로 다시 올리면 v2가 되고
-- supersedes가 직전 판을 가리킨다. 트리거가 **이 사람에게 보이는 판**만 세서 번호를 낸다
-- (documents는 0002부터 force RLS라 트리거 안의 질의도 호출자의 RLS를 탄다) — 못 보는 판의
-- 존재가 번호로 새지 않는다. 그 대가로 서로 다른 판을 못 보는 두 사람이 각자 v2를 만들 수 있다.
-- =====================================================================
create table doc_folders (
  folder_id   bigint generated always as identity primary key,
  business_id text not null references businesses(business_id) on delete restrict,
  team_id     text references teams(team_id) on delete cascade,
  parent_id   bigint references doc_folders(folder_id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now()
);

create index doc_folders_by_business on doc_folders (business_id, team_id, parent_id);
create unique index doc_folders_name_unique on doc_folders
  (business_id, coalesce(team_id, ''), coalesce(parent_id, 0), lower(name));

comment on table doc_folders is
  '0038. 문서 폴더(회사 > 팀 > 폴더). 폴더는 문서 등급을 바꾸지 않는다 — Vault 문서는 documents_read가 따로 막는다.';

-- 부모 폴더와 팀은 같은 회사여야 한다. 다른 회사 폴더 밑에 폴더를 만들면 트리가 회사 격리를 넘는다.
create or replace function doc_folders_same_business() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if new.team_id is not null and not exists (
    select 1 from teams t where t.team_id = new.team_id and t.business_id = new.business_id
  ) then
    raise exception 'doc_folder_team_business_mismatch' using errcode = '23514';
  end if;
  if new.parent_id is not null and not exists (
    select 1 from doc_folders f where f.folder_id = new.parent_id and f.business_id = new.business_id
  ) then
    raise exception 'doc_folder_parent_business_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

create trigger doc_folders_same_business_trigger
  before insert or update on doc_folders
  for each row execute function doc_folders_same_business();

alter table doc_folders enable row level security;
-- 읽기는 그 회사 사람. 쓰기는 문서를 쓸 수 있는 사람(0012 documents_* 와 같은 판정).
create policy doc_folders_read on doc_folders for select using (has_business(business_id));
create policy doc_folders_insert on doc_folders for insert
  with check (has_business(business_id) and can_module('/core/search', true) and created_by = auth.uid());
create policy doc_folders_update on doc_folders for update
  using (has_business(business_id) and can_module('/core/search', true))
  with check (has_business(business_id) and can_module('/core/search', true));
create policy doc_folders_delete on doc_folders for delete
  using (has_business(business_id) and can_module('/core/search', true));
create policy ai_agent_no_insert on doc_folders as restrictive for insert
  with check (auth_role() is distinct from 'AIAgent');
create policy ai_agent_no_update on doc_folders as restrictive for update
  using (auth_role() is distinct from 'AIAgent') with check (auth_role() is distinct from 'AIAgent');
create policy ai_agent_no_delete on doc_folders as restrictive for delete
  using (auth_role() is distinct from 'AIAgent');
create policy integration_no_insert on doc_folders as restrictive for insert with check (not is_integration());
create policy integration_no_update on doc_folders as restrictive for update
  using (not is_integration()) with check (not is_integration());
create policy integration_no_delete on doc_folders as restrictive for delete using (not is_integration());

revoke all on table doc_folders from anon, authenticated;
grant select, insert, update, delete on table doc_folders to authenticated;

-- 폴더를 지우면 안의 문서는 폴더 밖(회사 바로 밑)으로 나온다. 문서를 같이 지우지 않는다.
alter table documents add column folder_id bigint references doc_folders(folder_id) on delete set null;
alter table documents add column tags text[] not null default '{}';
alter table documents add column supersedes text references documents(document_id) on delete set null;

create index documents_by_folder on documents (folder_id);
create index documents_tags on documents using gin (tags);

comment on column documents.supersedes is
  '0038. 이 판이 대신하는 직전 판. 같은 회사 · 폴더 · 제목으로 다시 올리면 트리거가 채운다.';

-- 태그는 소문자 · 앞뒤 공백 없이 · 중복 없이. «Q3»와 «q3 »가 두 태그가 되면 검색이 반쪽이 된다.
create or replace function documents_version() returns trigger
language plpgsql set search_path = public as $fn$
declare
  v_prev record;
begin
  new.tags := coalesce(
    (select array_agg(distinct t order by t)
       from (select lower(trim(x)) as t from unnest(new.tags) as x) s
      where t <> ''),
    '{}'
  );
  -- 폴더는 이 사람에게 보이고 같은 회사여야 한다. FK는 RLS를 보지 않아서, 검사 없이 두면
  -- 남의 회사 폴더에 문서를 넣을 수 있다.
  if new.folder_id is not null and not exists (
    select 1 from doc_folders f where f.folder_id = new.folder_id and f.business_id is not distinct from new.business_id
  ) then
    raise exception 'document_folder_mismatch' using errcode = '23514';
  end if;

  if new.supersedes is not null then
    -- 호출자가 직전 판을 지정했다. 보이지 않거나 다른 회사면 거부한다 — FK만 믿으면 못 보는
    -- 문서의 존재가 성공/실패로 새고(doc_### 번호는 순번이다), 남의 회사 문서에 판이 붙는다.
    select d.document_id, d.version into v_prev
      from documents d
     where d.document_id = new.supersedes and d.business_id is not distinct from new.business_id;
    if not found then
      raise exception 'document_supersedes_mismatch' using errcode = '23514';
    end if;
    new.version := v_prev.version + 1;
  else
    -- 같은 회사 · 폴더 · 제목에 **같은 유형 · 같은 등급**일 때만 판으로 잇는다. 제목만 보면
    -- 서로 다른 «회의록» 둘이, 또는 Normal 문서가 Vault 문서 위에 판으로 쌓인다.
    select d.document_id, d.version into v_prev
      from documents d
     where d.business_id is not distinct from new.business_id
       and d.folder_id is not distinct from new.folder_id
       and lower(trim(d.title)) = lower(trim(new.title))
       and d.doc_type = new.doc_type
       and d.security_class::text = new.security_class::text
     order by d.version desc, d.created_at desc
     limit 1;
    if found then
      new.supersedes := v_prev.document_id;
      new.version := v_prev.version + 1;
    end if;
  end if;
  return new;
end;
$fn$;

create trigger documents_version_trigger
  before insert on documents
  for each row execute function documents_version();
