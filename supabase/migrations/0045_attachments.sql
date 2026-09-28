-- =====================================================================
-- Chairman OS — 0045_attachments (Phase 10 · 파일 첨부 + AI 요약)
-- 작성: 2026-09-28
--
-- 회장 지시: 이니셔티브 · 회사 · 문서 · 결재 상세에 파일을 붙이고, AI가 3줄 요약 · 핵심 숫자 ·
-- 필요한 결정 · 다음 행동을 뽑는다. 이 파일은 표 · 버킷 · RLS · 감사까지다. 추출과 요약은 앱
-- (lib/attachments/*)이 하고, **추출한 본문은 어디에도 저장하지 않는다** — 원본은 파일 자체이고,
-- 본문을 칸에 두면 파일과 다른 권한으로 읽히는 두 번째 사본이 생긴다.
--
-- ■ 왜 Storage인가 — CLAUDE.md는 «Vault 문서는 링크만»이라 했는데 ■
--   이번 지시가 등급 셋(일반/제한/Vault)의 파일을 전부 받으라고 명시했다(회장 결정). Vault도
--   여기 둔다. 대신 Vault 줄은 ① 회장 + 회장이 지정한 사람만 보고 ② AI로 절대 나가지 않는다
--   (skipped_vault — 칸 제약이 요약을 못 적게 막는다). 링크 방식(documents.storage_url)은 그대로
--   남는다. DEFERRED에 이 판단을 적었다.
--
-- ■ 권한 — «붙은 대상의 규칙» AND «등급» ■
--   ① 대상: 첨부가 보이려면 그 이니셔티브 · 회사 · 문서 · 결재가 **먼저 보여야** 한다. 그 판정을
--      여기 옮겨 적지 않는다 — 대상 표를 호출자 권한으로 한 번 읽는 것이 곧 판정이다
--      (attachment_entity_visible, security invoker). 0032가 user_profiles를 읽어 얼굴의 범위를
--      이름의 범위와 맞춘 수법과 같다. 대상 쪽 규칙(0017 · 0026 · 0042 soft delete)이 바뀌면
--      이쪽은 아무것도 안 해도 따라온다.
--   ② 등급: 일반 · 제한은 max_security_class로(0002 documents_read와 같은 잣대). Vault는
--      max_class가 아니라 **회장 + 지정자**다 — 지정은 첨부마다 attachment_vault_viewers 한 줄이고
--      회장만 쓴다. 역할이나 등급으로 열면 «Vault 등급을 가진 사람 전원»이 되는데, 원문은
--      «지정된 사람»이다.
--
-- ■ 쓰기 ■
--   올리기: 대상이 보이고 그 등급을 볼 수 있는 사람. Vault는 회장만 올린다(지정자는 보기만).
--   요약 칸 고치기 · 지우기: 올린 사람 또는 회장. 고칠 수 있는 칸은 grant로 다섯만 연다 —
--   정책은 행을 고르지 칸을 못 고르므로(0030 4절), 등급 · 대상 · 파일 이름은 한 번 정해지면
--   API로도 못 바꾼다.
--
-- ■ 감사 ■
--   올림(upload) · 요약 상태 변화(ai_summarize) · 삭제(delete_request)는 트리거가 남긴다 —
--   앱이 빠뜨릴 수 없다. 내려받기(download)와 «외부 AI 전송»(ai_external_send)은 앱이 부르는
--   문 둘(record_attachment_download · record_attachment_ai_send)이 남긴다. 뒤의 것은 Vault면
--   예외를 던진다 — 앱의 분기가 틀려도 감사 없이 모델을 부르는 길이 서지 않게.
--   새 audit_action 넷은 **이 트랜잭션에서 한 번도 리터럴로 쓰지 않는다**(55P04 — 0022).
--   함수 본문은 실행될 때 해석되고, 그때는 커밋이 끝난 뒤다.
--
-- ■ AI 사용량 ■ ai_usage_log — 기능 · 모델 · 토큰 · 추정 비용. 회장만 읽는다. Phase 11의
--   «오늘 AI 비용»이 이 표를 다시 쓴다. 그래서 이름에 «첨부»가 없다.
--
-- ■ 하지 않는 것 ■
--   * force row level security 없음(0035 머리 주석 — 네 번 밟은 함정). 자물쇠는 revoke다.
--   * service_role 없음. 요약은 올린 사람의 세션으로 적는다.
--   * 대상에 FK를 걸 수 없다(대상이 넷). 대상이 soft delete되면 첨부도 ①에서 같이 숨는다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 감사 낱말 넷 (0013 · 0015 · 0023 · 0035의 관례). 이 파일 안에서는 전부 text로만 다룬다.
-- ---------------------------------------------------------------------
alter type audit_action add value if not exists 'upload';
alter type audit_action add value if not exists 'download';
alter type audit_action add value if not exists 'ai_summarize';
alter type audit_action add value if not exists 'ai_external_send';

-- ---------------------------------------------------------------------
-- 2. 요약의 모양 — 앱이 검사하지만 DB가 한 번 더 막는다(0044 city_anchors_ok와 같은 이유:
--    화면이 가두어도 API로 들어오는 길이 남는다). case로 순서를 박는다 — and의 판정 순서는
--    약속이 없어서, 배열이 아닌 값이 jsonb_array_length를 먼저 만나면 22023으로 터진다.
-- ---------------------------------------------------------------------
create or replace function attachment_summary_ok(s jsonb) returns boolean
language sql immutable set search_path = public as $fn$
  select case
    when jsonb_typeof(s) is distinct from 'object' then false
    when exists (
      select 1 from jsonb_object_keys(s) as k
       where k not in ('summary', 'summary_ko', 'key_numbers', 'decisions_needed', 'next_actions',
                       'confidence', 'language', 'dummy', 'sections')
    ) then false
    when jsonb_typeof(s -> 'summary') is distinct from 'array' then false
    when jsonb_typeof(s -> 'key_numbers') is distinct from 'array' then false
    when jsonb_typeof(s -> 'decisions_needed') is distinct from 'array' then false
    when jsonb_typeof(s -> 'next_actions') is distinct from 'array' then false
    when s ? 'summary_ko' and jsonb_typeof(s -> 'summary_ko') is distinct from 'array' then false
    when jsonb_array_length(s -> 'summary') not between 1 and 3 then false
    when s ? 'summary_ko' and jsonb_array_length(s -> 'summary_ko') > 3 then false
    when jsonb_array_length(s -> 'key_numbers') > 12
      or jsonb_array_length(s -> 'decisions_needed') > 10
      or jsonb_array_length(s -> 'next_actions') > 10 then false
    when exists (
      select 1 from jsonb_array_elements(
        (s -> 'summary') || coalesce(s -> 'summary_ko', '[]'::jsonb) || (s -> 'key_numbers')
          || (s -> 'decisions_needed') || (s -> 'next_actions')) as e
       where jsonb_typeof(e) <> 'string'
    ) then false
    when coalesce(s ->> 'confidence', '') not in ('high', 'medium', 'low') then false
    when s ? 'dummy' and jsonb_typeof(s -> 'dummy') <> 'boolean' then false
    when s ? 'language' and jsonb_typeof(s -> 'language') <> 'string' then false
    when s ? 'sections' and jsonb_typeof(s -> 'sections') <> 'number' then false
    else true
  end;
$fn$;

comment on function attachment_summary_ok(jsonb) is
  '0045. ai_summary 모양 — summary(1~3) · key_numbers · decisions_needed · next_actions(문자열 배열) · confidence(high/medium/low). 선택: summary_ko · language · dummy · sections.';

-- ---------------------------------------------------------------------
-- 3. attachments
-- ---------------------------------------------------------------------
create table attachments (
  attachment_id  uuid primary key default gen_random_uuid(),
  entity_table   text not null,                                   -- [일반] initiatives|businesses|documents|decisions
  entity_id      text not null,                                   -- [일반]
  -- 감사 · 화면 표시용. 대상에서 트리거가 채운다 — 화면이 보낸 값을 믿지 않는다.
  business_id    text,                                            -- [일반]
  file_name      text not null,                                   -- [제한] 파일 이름이 거래 상대를 말한다
  mime           text not null,                                   -- [일반]
  size_bytes     bigint not null,                                 -- [일반]
  -- 경로는 DB가 만든다. 화면이 경로를 정하면 남의 대상 밑으로 객체를 밀어 넣을 수 있다.
  storage_path   text generated always as (entity_table || '/' || entity_id || '/' || attachment_id::text) stored,
  security_class security_class not null default 'Restricted',    -- [일반] 기본 «제한»(회장 지시)
  uploaded_by    uuid not null default auth.uid(),                -- [제한]
  status         text not null default 'uploaded',                -- [일반]
  ai_summary     jsonb,                                           -- [등급 그대로] 요약. 추출 본문은 저장하지 않는다
  ai_model       text,                                            -- [일반]
  ai_error       text,                                            -- [일반] 실패 사유 한 줄(«다시 요약» 옆)
  summarized_at  timestamptz,                                     -- [일반]
  -- 검색(CH-043)이 ilike로 읽는 한 줄. 트리거가 이름 + 요약 문장으로 채운다.
  search_text    text,                                            -- [등급 그대로]
  created_at     timestamptz not null default now(),

  constraint attachments_entity_check check (entity_table in ('initiatives', 'businesses', 'documents', 'decisions')),
  -- 경로 조각이라 '/'나 '..'이 들어오면 다른 대상의 폴더를 가리킨다.
  constraint attachments_entity_id_check check (entity_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint attachments_file_name_check check (length(btrim(file_name)) between 1 and 255),
  constraint attachments_mime_check check (mime in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png', 'image/jpeg'
  )),
  constraint attachments_size_check check (size_bytes between 1 and 20971520),          -- 20MB
  -- 'Public'(0025)은 첨부에 없다. 공개 파일은 공지로 올린다.
  constraint attachments_class_check check (security_class::text in ('Normal', 'Restricted', 'Vault')),
  constraint attachments_status_check check (status in ('uploaded', 'extracting', 'summarized', 'skipped_vault', 'failed')),
  constraint attachments_summary_check check (ai_summary is null or attachment_summary_ok(ai_summary)),
  constraint attachments_summarized_check check (status <> 'summarized' or ai_summary is not null),
  -- Vault는 AI로 나가지 않는다. 요약 칸이 비어 있어야 하고 상태는 하나뿐이다.
  -- 앱이 분기를 틀려도 요약을 **적을** 수는 없다(보낸 사실은 record_attachment_ai_send가 막는다).
  constraint attachments_vault_check check (
    security_class::text <> 'Vault' or (status = 'skipped_vault' and ai_summary is null and ai_model is null)
  )
);

create index attachments_by_entity on attachments (entity_table, entity_id, created_at desc);
create index attachments_by_created on attachments (created_at desc);

comment on table attachments is
  '0045. 상세 화면 첨부(파일 실체는 attachments 버킷). 읽기 = 대상이 보이고 AND 등급(Vault는 회장 + 지정자). 추출 본문은 저장하지 않는다.';
comment on column attachments.storage_path is
  '0045. <entity_table>/<entity_id>/<attachment_id>. DB가 만든다 — 버킷 정책이 이 값으로 줄을 찾는다.';

-- Vault 지정자 — 첨부 하나에 사람 하나씩. 회장만 쓴다.
create table attachment_vault_viewers (
  attachment_id uuid not null references attachments(attachment_id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  granted_by    uuid not null default auth.uid(),
  granted_at    timestamptz not null default now(),
  primary key (attachment_id, user_id)
);

comment on table attachment_vault_viewers is
  '0045. Vault 첨부의 지정자. 회장만 넣고 뺀다. 지정은 max_security_class와 무관하다 — 원문이 «지정된 사람»이다.';

-- ---------------------------------------------------------------------
-- 4. 판정
-- ---------------------------------------------------------------------

-- ① 대상이 보이는가. **security invoker** — 대상 표를 호출자 권한으로 읽는 것이 판정 전부다.
--    definer로 두면 소유자 권한으로 읽어서 모든 것이 보인다(또는 force 표에서 0행 — 0035의 함정).
create or replace function attachment_entity_visible(p_table text, p_id text) returns boolean
language sql stable security invoker set search_path = public as $fn$
  select case p_table
    when 'initiatives' then exists (select 1 from public.initiatives where initiative_id = p_id)
    when 'businesses'  then exists (select 1 from public.businesses  where business_id  = p_id)
    when 'documents'   then exists (select 1 from public.documents   where document_id  = p_id)
    when 'decisions'   then exists (select 1 from public.decisions   where decision_id  = p_id)
    else false
  end;
$fn$;

-- ② 등급을 볼 수 있는가. definer — 지정자 표는 회장과 본인만 읽으므로(아래 정책) 판정은 표 밖에서 한다.
--    그 표에는 force가 없어 소유자 권한으로 온전히 읽힌다.
create or replace function attachment_class_ok(p_id uuid, p_class security_class) returns boolean
language sql stable security definer set search_path = public as $fn$
  -- Integration(ECOUNT 동기화 계정)은 회사 범위를 넓게 갖지만 첨부를 읽을 이유가 없다.
  select is_active() and auth_role()::text <> 'Integration' and case
    when p_class::text = 'Vault' then
      auth_role()::text = 'Chairman'
      or exists (select 1 from attachment_vault_viewers v where v.attachment_id = p_id and v.user_id = auth.uid())
    else class_rank(p_class) <= class_rank(max_class())
  end;
$fn$;

-- 요약 칸 · 삭제는 올린 사람 또는 회장.
create or replace function attachment_is_mine_or_chairman(p_uploaded_by uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and (p_uploaded_by = auth.uid() or auth_role()::text = 'Chairman');
$fn$;

comment on function attachment_entity_visible(text, text) is '0045. 첨부가 붙은 대상이 호출자에게 보이는가(security invoker — 대상 표의 RLS가 판정).';
comment on function attachment_class_ok(uuid, security_class) is '0045. 일반·제한은 max_class, Vault는 회장 + attachment_vault_viewers.';

-- ---------------------------------------------------------------------
-- 5. 트리거 — 믿지 않는 칸은 DB가 적는다
-- ---------------------------------------------------------------------
create or replace function attachments_stamp() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
    new.created_at := now();
    -- 요약은 올린 뒤에 붙는다. 처음부터 «요약됨»으로 넣는 길을 닫는다.
    new.ai_summary := null;
    new.ai_model := null;
    new.ai_error := null;
    new.summarized_at := null;
    new.status := case when new.security_class::text = 'Vault' then 'skipped_vault' else 'uploaded' end;
    -- 회사는 대상에서 낸다(호출자 권한으로 — 안 보이는 대상이면 null이고, 어차피 정책이 막는다).
    new.business_id := case new.entity_table
      when 'initiatives' then (select business_id from initiatives where initiative_id = new.entity_id)
      when 'businesses'  then new.entity_id
      when 'documents'   then (select business_id from documents where document_id = new.entity_id)
      when 'decisions'   then (select business_id from decisions where decision_id = new.entity_id)
    end;
  else
    if new.ai_summary is distinct from old.ai_summary then
      new.summarized_at := case when new.ai_summary is null then null else now() end;
    end if;
  end if;

  new.search_text := new.file_name || coalesce(' ' || (
    select string_agg(v, ' ')
      from jsonb_array_elements_text(
        coalesce(new.ai_summary -> 'summary', '[]'::jsonb)
        || coalesce(new.ai_summary -> 'summary_ko', '[]'::jsonb)
        || coalesce(new.ai_summary -> 'key_numbers', '[]'::jsonb)
        || coalesce(new.ai_summary -> 'decisions_needed', '[]'::jsonb)
        || coalesce(new.ai_summary -> 'next_actions', '[]'::jsonb)) as v
  ), '');
  return new;
end;
$fn$;

create trigger attachments_stamp_trigger
  before insert or update on attachments
  for each row execute function attachments_stamp();

-- 감사. 낱말은 text로 만들어 실행할 때 캐스트한다 — 이 트랜잭션에서 방금 더한 값이라서(55P04).
create or replace function attachments_audit() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_action text;
  v_note text;
begin
  if tg_op = 'INSERT' then
    v_action := 'upload';
    v_note := '첨부 올림';
  elsif tg_op = 'DELETE' then
    v_action := 'delete_request';
    v_note := '첨부 삭제';
  elsif new.status is distinct from old.status or new.ai_summary is distinct from old.ai_summary then
    v_action := 'ai_summarize';
    v_note := case new.status
      when 'summarized' then 'AI 요약'
      when 'failed' then 'AI 요약 실패'
      when 'extracting' then 'AI 요약 시작'
      else 'AI 요약 상태 변경'
    end;
  else
    return new;
  end if;

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (
    v_action::audit_action,
    'attachments',
    coalesce(new.attachment_id, old.attachment_id)::text,
    coalesce(new.business_id, old.business_id),
    auth.uid(),
    auth_role()::text,
    case when tg_op in ('UPDATE', 'DELETE') then jsonb_build_object(
      'entity', old.entity_table || ':' || old.entity_id, 'file_name', old.file_name,
      'security_class', old.security_class, 'status', old.status, 'ai_model', old.ai_model) end,
    case when tg_op in ('INSERT', 'UPDATE') then jsonb_build_object(
      'entity', new.entity_table || ':' || new.entity_id, 'file_name', new.file_name, 'mime', new.mime,
      'size_bytes', new.size_bytes, 'security_class', new.security_class, 'status', new.status,
      'ai_model', new.ai_model) end,
    v_note
  );
  return coalesce(new, old);
end;
$fn$;

create trigger attachments_audit_trigger
  after insert or update or delete on attachments
  for each row execute function attachments_audit();

create or replace function attachment_vault_viewers_audit() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into audit_log (action, entity_table, entity_id, actor_user_id, actor_role, before, after, note)
  values (
    'permission_change',
    'attachments',
    coalesce(new.attachment_id, old.attachment_id)::text,
    auth.uid(),
    auth_role()::text,
    case when tg_op = 'DELETE' then jsonb_build_object('vault_viewer', old.user_id) end,
    case when tg_op = 'INSERT' then jsonb_build_object('vault_viewer', new.user_id) end,
    case when tg_op = 'INSERT' then 'Vault 첨부 지정자 추가' else 'Vault 첨부 지정자 해제' end
  );
  return coalesce(new, old);
end;
$fn$;

create or replace function attachment_vault_viewers_stamp() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.granted_by := coalesce(auth.uid(), new.granted_by);
  new.granted_at := now();
  return new;
end;
$fn$;

create trigger attachment_vault_viewers_stamp_trigger
  before insert on attachment_vault_viewers
  for each row execute function attachment_vault_viewers_stamp();
create trigger attachment_vault_viewers_audit_trigger
  after insert or delete on attachment_vault_viewers
  for each row execute function attachment_vault_viewers_audit();

-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
alter table attachments enable row level security;
alter table attachment_vault_viewers enable row level security;

-- 자물쇠는 revoke(0035). Supabase는 새 표를 만들자마자 anon/authenticated에 연다.
revoke all on table attachments from anon, authenticated;
revoke all on table attachment_vault_viewers from anon, authenticated;
grant select, insert, delete on table attachments to authenticated;
-- 칸 단위 update — 요약 다섯 칸만. 등급 · 대상 · 파일 이름 · 올린 사람은 한 번 정해지면 그대로다.
grant update (status, ai_summary, ai_model, ai_error, summarized_at) on table attachments to authenticated;
grant select, insert, delete on table attachment_vault_viewers to authenticated;

revoke execute on function attachment_entity_visible(text, text) from public, anon;
revoke execute on function attachment_class_ok(uuid, security_class) from public, anon;
revoke execute on function attachment_is_mine_or_chairman(uuid) from public, anon;
grant execute on function attachment_entity_visible(text, text) to authenticated;
grant execute on function attachment_class_ok(uuid, security_class) to authenticated;
grant execute on function attachment_is_mine_or_chairman(uuid) to authenticated;

-- 등급이 먼저다 — 싸고, 등급에서 떨어지면 대상 표를 읽을 이유가 없다.
create policy attachments_read on attachments for select
  using (attachment_class_ok(attachment_id, security_class) and attachment_entity_visible(entity_table, entity_id));

-- 올리기. with check는 before 트리거 뒤의 줄을 본다 — uploaded_by는 이미 auth.uid()다.
-- Vault는 지정자가 아직 없으므로 attachment_class_ok가 회장만 통과시킨다.
create policy attachments_insert on attachments for insert
  with check (
    uploaded_by = auth.uid()
    and attachment_class_ok(attachment_id, security_class)
    and attachment_entity_visible(entity_table, entity_id)
  );

create policy attachments_update on attachments for update
  using (
    attachment_is_mine_or_chairman(uploaded_by)
    and attachment_class_ok(attachment_id, security_class)
    and attachment_entity_visible(entity_table, entity_id)
  )
  with check (
    attachment_is_mine_or_chairman(uploaded_by)
    and attachment_class_ok(attachment_id, security_class)
    and attachment_entity_visible(entity_table, entity_id)
  );

create policy attachments_delete on attachments for delete
  using (
    attachment_is_mine_or_chairman(uploaded_by)
    and attachment_class_ok(attachment_id, security_class)
    and attachment_entity_visible(entity_table, entity_id)
  );

-- 지정자 표 — 회장이 쓰고, 본인은 자기 줄만 본다.
create policy attachment_vault_viewers_read on attachment_vault_viewers for select
  using (is_active() and (user_id = auth.uid() or auth_role()::text = 'Chairman'));
create policy attachment_vault_viewers_insert on attachment_vault_viewers for insert
  with check (is_active() and auth_role()::text = 'Chairman');
create policy attachment_vault_viewers_delete on attachment_vault_viewers for delete
  using (is_active() and auth_role()::text = 'Chairman');

-- AI Agent와 Integration은 첨부를 쓰지 않는다 — 0017 · 0037과 같은 세 짝 이름이라
-- scripts/check-migrations.ts의 restrictive 루프가 카탈로그에서 잰다. AIAgent는 읽기만 한다
-- (야간 브리핑이 «이번 주 첨부 수 · 결정 필요 합계»를 센다).
do $$
declare
  t text;
begin
  foreach t in array array['attachments', 'attachment_vault_viewers'] loop
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
-- 7. 앱이 부르는 문 둘 — 감사가 먼저 서야 다음 걸음이 있다
--    security invoker: 첨부를 호출자 권한으로 읽는다(RLS). 안 보이면 null/false.
-- ---------------------------------------------------------------------

-- 내려받기 한 번 = 감사 한 줄. 경로를 돌려준다 — 앱은 이 값으로만 서명 URL을 만든다.
create or replace function record_attachment_download(p_id uuid) returns text
language plpgsql volatile security invoker set search_path = public as $fn$
declare
  a attachments;
begin
  select * into a from attachments where attachment_id = p_id;
  if not found then
    return null;
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
  values ('download'::text::audit_action, 'attachments', a.attachment_id::text, a.business_id, auth.uid(), auth_role()::text,
          jsonb_build_object('file_name', a.file_name, 'security_class', a.security_class), '첨부 내려받기');
  return a.storage_path;
end;
$fn$;

-- «외부 AI 전송» 한 줄. 제한 등급이면 원문의 «외부 AI 전송» 감사, 일반은 같은 낱말로 기록만.
-- **Vault면 던진다** — 앱이 이 문을 지나지 않고는 모델을 부르지 않는다(lib/attachments/summarize.ts).
create or replace function record_attachment_ai_send(p_id uuid, p_model text) returns boolean
language plpgsql volatile security invoker set search_path = public as $fn$
declare
  a attachments;
begin
  select * into a from attachments where attachment_id = p_id;
  if not found then
    return false;
  end if;
  if a.security_class::text = 'Vault' then
    raise exception 'attachment_vault_no_ai' using errcode = '42501';
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
  values ('ai_external_send'::text::audit_action, 'attachments', a.attachment_id::text, a.business_id, auth.uid(), auth_role()::text,
          jsonb_build_object('model', p_model, 'security_class', a.security_class, 'file_name', a.file_name),
          case when a.security_class::text = 'Restricted' then '외부 AI 전송 (제한 등급)' else '외부 AI 전송' end);
  return true;
end;
$fn$;

revoke execute on function record_attachment_download(uuid) from public, anon;
revoke execute on function record_attachment_ai_send(uuid, text) from public, anon;
grant execute on function record_attachment_download(uuid) to authenticated;
grant execute on function record_attachment_ai_send(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. 비공개 버킷 (0018 · 0032와 같은 모양)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'attachments' and public) then
    raise exception 'attachments 버킷이 공개로 설정되어 있다. 0045의 전제(비공개)가 깨진다 — '
      '콘솔에서 버킷을 비공개로 되돌린 뒤 이 마이그레이션을 다시 적용한다.';
  end if;
  -- 실제 Supabase의 buckets에는 크기 · 형식 칸이 있다. 있으면 한 겹 더 건다(PGlite 흉내에는 없다).
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$
      update storage.buckets
         set file_size_limit = 20971520,
             allowed_mime_types = array[
               'application/pdf',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'application/vnd.openxmlformats-officedocument.presentationml.presentation',
               'image/png', 'image/jpeg']
       where id = 'attachments'
    $q$;
  end if;
end $$;

-- 객체 이름 → 그 첨부 줄이 호출자에게 보이는가. **plpgsql + invoker.**
--   anon은 attachments 표 권한이 없다. 정책 안에서 그 표를 직접 읽으면 anon의 storage 질의가
--   (다른 버킷까지) 권한 오류로 죽는다 — 표 권한은 행을 보기 전에 계획 단계에서 잰다.
--   plpgsql은 도달한 문장만 계획하므로 anon은 첫 줄에서 false로 나간다.
--   AIAgent는 줄은 읽어도(브리핑 집계) 파일은 못 연다 — 브리핑은 파일을 읽지 않는다.
create or replace function attachment_object_visible(object_name text, p_owner_only boolean default false)
returns boolean
language plpgsql stable security invoker set search_path = public as $fn$
begin
  if auth.uid() is null or not public.is_active() then
    return false;
  end if;
  if public.auth_role()::text in ('AIAgent', 'Integration') then
    return false;
  end if;
  return exists (
    select 1 from public.attachments a
     where a.storage_path = object_name
       and (not p_owner_only or public.attachment_is_mine_or_chairman(a.uploaded_by))
  );
end;
$fn$;

-- 올리기: 줄이 먼저 서 있고(8절 순서) 그 줄을 올린 본인이어야 한다. 경로를 남의 줄에 맞춰도 못 올린다.
create or replace function attachment_object_uploadable(object_name text) returns boolean
language plpgsql stable security invoker set search_path = public as $fn$
begin
  if auth.uid() is null or not public.is_active() then
    return false;
  end if;
  return exists (
    select 1 from public.attachments a
     where a.storage_path = object_name
       and a.uploaded_by = auth.uid()
  );
end;
$fn$;

revoke all on function attachment_object_visible(text, boolean) from public;
revoke all on function attachment_object_uploadable(text) from public;
grant execute on function attachment_object_visible(text, boolean) to anon, authenticated;
grant execute on function attachment_object_uploadable(text) to anon, authenticated;

drop policy if exists attachments_objects_read on storage.objects;
create policy attachments_objects_read on storage.objects for select
  using (bucket_id = 'attachments' and public.attachment_object_visible(name));

drop policy if exists attachments_objects_insert on storage.objects;
create policy attachments_objects_insert on storage.objects for insert
  with check (bucket_id = 'attachments' and public.attachment_object_uploadable(name));

-- update 정책은 없다 — 원본은 덮어쓰지 않는다. 바꾸려면 지우고 새로 올린다(감사에 둘 다 남는다).

drop policy if exists attachments_objects_delete on storage.objects;
create policy attachments_objects_delete on storage.objects for delete
  using (bucket_id = 'attachments' and public.attachment_object_visible(name, true));

-- ---------------------------------------------------------------------
-- 9. ai_usage_log — AI 호출 한 번 = 한 줄. 회장만 읽는다. 지우지도 고치지도 않는다.
-- ---------------------------------------------------------------------
create table ai_usage_log (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  feature            text not null,                               -- [일반] attachment_summary · memo_structure …
  model              text not null,                               -- [일반]
  input_tokens       integer not null default 0,                  -- [일반]
  output_tokens      integer not null default 0,                  -- [일반]
  estimated_cost_usd numeric(12, 6) not null default 0,           -- [제한] 비용
  user_id            uuid not null default auth.uid(),            -- [제한]
  entity_table       text,                                        -- [일반]
  entity_id          text,                                        -- [일반]

  constraint ai_usage_log_feature_check check (feature ~ '^[a-z][a-z0-9_.-]{1,47}$'),
  constraint ai_usage_log_tokens_check check (input_tokens >= 0 and output_tokens >= 0),
  constraint ai_usage_log_cost_check check (estimated_cost_usd >= 0)
);

create index ai_usage_log_by_created on ai_usage_log (created_at desc);

comment on table ai_usage_log is
  '0045. AI 호출 사용량 · 추정 비용(USD). 회장만 읽는다. Phase 11의 일별 비용 화면이 다시 쓴다 — 첨부 전용 이름이 아닌 이유.';

create or replace function ai_usage_log_stamp() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.user_id := coalesce(auth.uid(), new.user_id);
  new.created_at := now();
  return new;
end;
$fn$;

create trigger ai_usage_log_stamp_trigger
  before insert on ai_usage_log
  for each row execute function ai_usage_log_stamp();

alter table ai_usage_log enable row level security;
revoke all on table ai_usage_log from anon, authenticated;
grant select, insert on table ai_usage_log to authenticated;
grant usage on sequence ai_usage_log_id_seq to authenticated;

-- 쓰기는 활성 사용자 누구나 자기 이름으로(요약은 올린 사람의 세션이 부른다). AIAgent도 쓴다 —
-- Phase 11이 야간 브리핑의 비용을 같은 표에 적는다. Integration은 AI를 부르지 않는다.
create policy ai_usage_log_insert on ai_usage_log for insert
  with check (is_active() and user_id = auth.uid() and not is_integration());
create policy ai_usage_log_read on ai_usage_log for select
  using (is_active() and auth_role()::text = 'Chairman');

commit;
