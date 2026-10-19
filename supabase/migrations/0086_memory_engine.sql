-- =====================================================================
-- Chairman OS — 0086_memory_engine (기억 엔진 Phase 1 — 빠른 기록 · 원본 보존 · AI 추출 · 기존 회사/사람/프로젝트 연결 · 검토함 · 검색)
-- 작성: 2026-10-19 · 브랜치 feat/memory-engine · 지시문 docs/specs/2026-10-19-memory-engine.txt · 결정 docs/decisions/2026-10-19-memory-engine.md
--
-- ■ 누구 것인가 ■
--   1차 사용자는 대표 한 명. 모든 줄은 **owner_id = 본인**이고, 읽기 · 쓰기 판정은 memory_me(owner_id) 하나다:
--   로그인 · 활성 · 역할 Chairman · 스위치 memory_engine(기본 'chairman') · 줄의 주인이 본인.
--   직원 · 임원 · GroupCFO · AI Agent · Integration · anon은 표 · RPC · 검색 어디에서도 0행(거부). 나중에 직원용을 열어도
--   개인 기록은 주인만 본다(대표도 남의 기록은 못 본다 — 판정이 «주인 = 본인»이다).
--
-- ■ 무엇을 만드나 ■
--   표    memory_captures(원본 — 고치지 않음) · memory_capture_assets(올린 파일) · memory_segments(전사 · 긴 문서 조각, Phase 2 자리)
--         memory_meetings(회의 머리, Phase 2 자리) · memory_items(AI · 규칙이 뽑은 정보 단위 — 초안) · memory_links(기존 회사 · 사람 ·
--         프로젝트 · 업무와의 연결) · memory_entities(DB에 없는 바깥 인물 · 회사 — 확인 전 Pending) · memory_aliases(별칭)
--         memory_revisions(바뀜 이력 — 넣기만) · memory_review_queue(검토함) · memory_processing_runs(처리 이력 — 넣기만)
--         memory_jobs(처리 큐 — 기록 하나에 한 줄) · memory_embeddings(벡터 검색 자리 — 업체 결정 전, 비어 있음)
--   RPC   memory_capture_save · memory_asset_add · memory_job_claim · memory_apply · memory_fail · memory_review_resolve
--         memory_item_set · memory_search(invoker — 표 RLS가 거른다)
--   버킷  memory-assets(비공개 · '<본인 uid>/<기록 id>/<이름>' · 25MB)
--
-- ■ 지키는 것 ■
--   · 원본은 저장 즉시 남고 고쳐지지 않는다(raw_text · captured_at · 주인 · client_key 바꾸기 거부). AI 결과는 다른 칸 · 다른 표.
--   · 같은 기록을 두 번 처리해도 정보 · 연결 · 검토가 두 번 생기지 않는다(dedupe_key unique) — 처리 이력(runs)은 매번 남는다.
--   · 기존 확정 정보를 덮지 않는다 — 바뀜 후보는 검토함으로, 승인하면 옛 줄을 superseded로 두고 이력(revisions)을 남긴다.
--   · 재무 수치 · 투자 조건 · 기존 결정과의 충돌은 늘 검토함(자동 확정 없음). 원가 엔진 · BOM 표는 읽지도 쓰지도 않는다.
--   · 업무는 검토함 승인 뒤에만 tasks에 생긴다(자동 생성 없음). 업무 id에는 출처를 쓰지 않는다 — 직원이 보는 업무에 «기억»이
--     드러나지 않게, 출처는 memory_links(대표만 봄)에 남긴다.
--   · 감사 줄에는 내용(본문 · 요약)을 넣지 않는다. memory_* 감사 줄은 주인 본인만 읽는다(restrictive).
--   · 정책은 to authenticated · anon grant 0 · force 없음(정의자 함수의 소유자가 읽는다).
-- 0035 규칙: 앞 파일을 고치지 않는다.
-- =====================================================================

begin;

-- =====================================================================
-- 0절. 기능 스위치 — src/lib/features.ts와 같은 키 · 기본값(check:features가 대조). 기본 «대표만».
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'memory_engine', true, 'chairman', '기본값(0086)')
on conflict do nothing;

-- =====================================================================
-- 1절. 판정 — 주인 본인 · 대표 · 스위치
-- =====================================================================
/** 이 줄(주인 p_owner)을 지금 사람이 다룰 수 있나. 주인 = 본인 · 활성 · Chairman · 스위치. 나머지 전부 거짓. */
create or replace function memory_me(p_owner uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p_owner is not null
     and auth.uid() is not null
     and p_owner = auth.uid()
     and is_active()
     and coalesce(auth_role()::text, '') = 'Chairman'
     and coalesce(feature_on('memory_engine', null), false);
$fn$;
comment on function memory_me(uuid) is '0086. 기억 엔진 판정 — 줄의 주인이 본인 · 활성 · Chairman · 스위치 memory_engine. 표 RLS · RPC가 같이 쓴다.';
revoke all on function memory_me(uuid) from public, anon;
grant execute on function memory_me(uuid) to authenticated;

-- =====================================================================
-- 2절. 표
-- =====================================================================
create table memory_captures (
  capture_id        uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid(),
  client_key        text not null check (length(client_key) between 8 and 80),       -- 화면이 만든 열쇠 — 두 번 눌러도 한 줄
  capture_type      text not null check (capture_type in ('note', 'voice', 'meeting', 'online_meeting', 'file', 'conversation', 'email', 'phone_call')),
  title             text check (title is null or length(title) <= 200),
  raw_text          text not null default '' check (length(raw_text) <= 200000),     -- 원본(사람이 쓴 그대로) — 고치지 않는다
  source            text not null default 'quick_capture' check (source ~ '^[a-z_]{2,40}$'),
  source_reference  text check (source_reference is null or length(source_reference) <= 500),
  captured_at       timestamptz not null default now(),                               -- 기록한 때(상대 날짜 해석 기준)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  processing_status text not null default 'saved'
                    check (processing_status in ('saved', 'processing', 'ready', 'needs_review', 'failed', 'waiting_transcript')),
  summary           text check (summary is null or length(summary) <= 4000),          -- AI(또는 규칙) 요약 — 원본과 따로
  categories        text[] not null default '{}'
                    check (categories <@ array['business_meeting', 'investment_ma', 'operations', 'sales', 'finance', 'rnd', 'hr',
                                               'personal_note', 'idea', 'strategy', 'other']::text[]),
  metadata          jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  archived_at       timestamptz,                                                       -- 보관(목록에서 숨김 — 지우지 않음)
  search_tsv        tsvector generated always as (
                      to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || raw_text || ' ' || coalesce(summary, ''))) stored,
  unique (owner_id, client_key)
);
create index memory_captures_by_owner on memory_captures (owner_id, captured_at desc);
create index memory_captures_tsv on memory_captures using gin (search_tsv);
create index memory_captures_trgm on memory_captures using gin (raw_text extensions.gin_trgm_ops);

create table memory_capture_assets (
  asset_id          uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid(),
  capture_id        uuid not null references memory_captures(capture_id) on delete restrict,
  storage_path      text not null unique check (length(storage_path) between 10 and 400),
  file_name         text not null check (length(btrim(file_name)) between 1 and 200),
  file_type         text not null check (length(file_type) between 1 and 120),
  file_size         bigint not null check (file_size between 1 and 26214400),
  kind              text not null check (kind in ('audio', 'document', 'image', 'other')),
  processing_status text not null default 'stored'
                    check (processing_status in ('stored', 'waiting_transcript', 'extracted', 'failed', 'skipped')),
  extracted_chars   int check (extracted_chars is null or extracted_chars >= 0),
  metadata          jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at        timestamptz not null default now()
);
create index memory_capture_assets_by_capture on memory_capture_assets (capture_id);

-- Phase 2 자리 — 음성 전사 · 긴 문서 조각. 발언자는 «Speaker 1» 같은 표시만(사람과 잇는 것은 검토 뒤 memory_links).
create table memory_segments (
  segment_id        uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid(),
  capture_id        uuid not null references memory_captures(capture_id) on delete restrict,
  source            text not null check (source in ('transcript', 'note', 'document')),
  sequence_number   int not null check (sequence_number >= 0),
  speaker_reference text check (speaker_reference is null or length(speaker_reference) <= 80),
  content           text not null check (length(content) <= 20000),
  start_ms          int check (start_ms is null or start_ms >= 0),
  end_ms            int check (end_ms is null or end_ms >= 0),
  metadata          jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (capture_id, source, sequence_number)
);

-- Phase 2 자리 — 회의 머리(기록 하나 = 회의 하나: 메모 · 녹음 · 전사 · 첨부가 같은 capture_id에 붙는다).
create table memory_meetings (
  capture_id        uuid primary key references memory_captures(capture_id) on delete restrict,
  owner_id          uuid not null default auth.uid(),
  started_at        timestamptz,
  ended_at          timestamptz,
  participants      jsonb not null default '[]'::jsonb check (jsonb_typeof(participants) = 'array'),
  related_entities  jsonb not null default '[]'::jsonb check (jsonb_typeof(related_entities) = 'array'),
  recording_status  text not null default 'none' check (recording_status in ('none', 'recording', 'stopped', 'failed', 'consent_missing')),
  consent_noted     boolean not null default false,
  status            text not null default 'live' check (status in ('live', 'ended'))
);

-- DB에 없는 바깥 인물 · 회사(그리고 신원이 불확실한 언급) — 확인 전에는 pending.
create table memory_entities (
  entity_id         uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid(),
  entity_type       text not null check (entity_type in ('person', 'company', 'project', 'other')),
  display_name      text not null check (length(btrim(display_name)) between 1 and 120),
  note              text check (note is null or length(note) <= 500),
  status            text not null default 'pending' check (status in ('pending', 'confirmed', 'merged', 'rejected')),
  linked_type       text check (linked_type is null or linked_type in ('business', 'project', 'person')),
  linked_id         text check (linked_id is null or length(linked_id) <= 80),
  first_capture_id  uuid references memory_captures(capture_id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index memory_entities_one_name on memory_entities (owner_id, entity_type, lower(btrim(display_name)));

create table memory_aliases (
  alias_id            uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid(),
  entity_type         text not null check (entity_type in ('business', 'project', 'person', 'entity')),
  entity_id           text not null check (length(entity_id) between 1 and 80),
  alias               text not null check (length(btrim(alias)) between 1 and 80),
  language            text not null default 'ko' check (language in ('ko', 'en', 'other')),
  verification_status text not null default 'suggested' check (verification_status in ('suggested', 'confirmed', 'rejected')),
  created_at          timestamptz not null default now()
);
create unique index memory_aliases_one on memory_aliases (owner_id, entity_type, entity_id, lower(btrim(alias)));

create table memory_items (
  item_id             uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid(),
  capture_id          uuid not null references memory_captures(capture_id) on delete restrict,
  segment_id          uuid references memory_segments(segment_id) on delete restrict,
  memory_type         text not null check (memory_type in ('fact', 'claim', 'decision', 'proposal', 'commitment', 'task', 'risk', 'opportunity', 'question')),
  content             text not null check (length(btrim(content)) between 1 and 2000),
  source_quote        text check (source_quote is null or length(source_quote) <= 1000),   -- 원본에서 그대로 옮긴 근거
  speaker_label       text check (speaker_label is null or length(speaker_label) <= 80),
  direction           text not null default 'unknown' check (direction in ('mine', 'others', 'unknown')), -- 약속: 내가 / 남이
  who_text            text check (who_text is null or length(who_text) <= 120),
  to_text             text check (to_text is null or length(to_text) <= 120),
  due_date            date,                                                                -- 원문에서 확정된 날만(지어내지 않음)
  due_text            text check (due_text is null or length(due_text) <= 80),             -- 원문의 기한 말(«다음 주» · «11월까지»)
  amount_text         text check (amount_text is null or length(amount_text) <= 80),
  event_time          timestamptz,
  confidence          numeric(3, 2) not null default 0.5 check (confidence between 0 and 1),
  verification_status text not null default 'draft' check (verification_status in ('draft', 'confirmed', 'rejected')),
  lifecycle_status    text not null default 'open' check (lifecycle_status in ('open', 'done', 'superseded', 'cancelled', 'on_hold')),
  origin              text not null check (origin in ('ai', 'rule', 'manual')),
  dedupe_key          text not null check (length(dedupe_key) between 8 and 80),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (owner_id, dedupe_key)
);
create index memory_items_by_capture on memory_items (capture_id);
create index memory_items_open on memory_items (owner_id, memory_type, lifecycle_status, due_date);
create index memory_items_trgm on memory_items using gin (content extensions.gin_trgm_ops);

create table memory_links (
  link_id             uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid(),
  capture_id          uuid not null references memory_captures(capture_id) on delete restrict,
  item_id             uuid references memory_items(item_id) on delete restrict,
  target_type         text not null check (target_type in ('business', 'project', 'person', 'entity', 'decision', 'task')),
  target_id           text not null check (length(target_id) between 1 and 80),
  relationship        text not null default 'mentions' check (relationship in ('mentions', 'about', 'speaker', 'promised_by', 'promised_to', 'created_task')),
  verification_status text not null default 'suggested' check (verification_status in ('suggested', 'confirmed', 'rejected')),
  confidence          numeric(3, 2) not null default 0.5 check (confidence between 0 and 1),
  mention_text        text check (mention_text is null or length(mention_text) <= 120),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index memory_links_one on memory_links
  (owner_id, capture_id, coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid), target_type, target_id, relationship);
create index memory_links_by_target on memory_links (owner_id, target_type, target_id);

create table memory_revisions (
  revision_id       bigint generated always as identity primary key,
  owner_id          uuid not null default auth.uid(),
  item_id           uuid references memory_items(item_id) on delete restrict,
  link_id           uuid references memory_links(link_id) on delete restrict,
  previous_version  jsonb,
  new_version       jsonb,
  change_reason     text not null check (length(btrim(change_reason)) between 1 and 300),
  source_capture_id uuid references memory_captures(capture_id) on delete restrict,
  review_id         uuid,
  changed_at        timestamptz not null default now()
);
create index memory_revisions_by_item on memory_revisions (item_id, changed_at);

create table memory_review_queue (
  review_id          uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid(),
  review_type        text not null check (review_type in ('entity_identity', 'link_suggestion', 'change_detected', 'conflict', 'financial',
                                                         'task_candidate', 'date_ambiguous', 'decision_check')),
  title              text not null check (length(btrim(title)) between 1 and 300),
  proposed_change    jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_change) = 'object'),
  capture_id         uuid not null references memory_captures(capture_id) on delete restrict,
  item_id            uuid references memory_items(item_id) on delete restrict,
  related_item_id    uuid references memory_items(item_id) on delete restrict,          -- 바뀜 · 충돌의 옛 정보
  link_id            uuid references memory_links(link_id) on delete restrict,
  priority           text not null default 'medium' check (priority in ('critical', 'high', 'medium', 'low')),
  status             text not null default 'open' check (status in ('open', 'confirmed', 'edited', 'rejected', 'linked', 'created')),
  resolution         jsonb check (resolution is null or jsonb_typeof(resolution) = 'object'),
  dedupe_key         text not null check (length(dedupe_key) between 8 and 80),
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  unique (owner_id, dedupe_key)
);
create index memory_review_open on memory_review_queue (owner_id, status, created_at desc);

create table memory_processing_runs (
  run_id            uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid(),
  capture_id        uuid not null references memory_captures(capture_id) on delete restrict,
  processing_stage  text not null check (processing_stage in ('ingest', 'extract', 'link', 'detect', 'embed', 'transcribe')),
  status            text not null check (status in ('done', 'failed', 'skipped')),
  engine            text not null check (engine in ('ai', 'rule', 'mock')),
  model             text check (model is null or length(model) <= 80),
  model_version     text check (model_version is null or length(model_version) <= 80),
  prompt_version    text check (prompt_version is null or length(prompt_version) <= 40),
  attempt_count     int not null default 1 check (attempt_count between 1 and 100),
  input_hash        text check (input_hash is null or length(input_hash) <= 80),
  stats             jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  error_details     text check (error_details is null or length(error_details) <= 500),
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);
create index memory_runs_by_capture on memory_processing_runs (capture_id, created_at);

create table memory_jobs (
  capture_id   uuid primary key references memory_captures(capture_id) on delete restrict,
  owner_id     uuid not null default auth.uid(),
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts     int not null default 0 check (attempts between 0 and 100),
  next_at      timestamptz not null default now(),
  locked_at    timestamptz,
  last_error   text check (last_error is null or length(last_error) <= 500),
  updated_at   timestamptz not null default now()
);
create index memory_jobs_due on memory_jobs (owner_id, status, next_at);

-- 벡터 검색 자리 — 업체 · 키는 대표 결정 뒤. pgvector를 켜면 embedding을 vector(n)으로 바꾸는 새 마이그레이션을 쓴다. 지금은 비어 있다.
create table memory_embeddings (
  embedding_id uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid(),
  capture_id   uuid not null references memory_captures(capture_id) on delete restrict,
  item_id      uuid references memory_items(item_id) on delete restrict,
  provider     text not null check (length(provider) between 1 and 40),
  model        text not null check (length(model) between 1 and 80),
  dims         int not null check (dims between 1 and 4096),
  embedding    real[] not null,
  content_hash text not null check (length(content_hash) between 8 and 80),
  created_at   timestamptz not null default now()
);
create unique index memory_embeddings_one on memory_embeddings
  (owner_id, capture_id, coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid), model, content_hash);

comment on table memory_captures is '0086. 기억 엔진 원본(빠른 기록 · 회의 · 파일). 주인 본인만(memory_me). raw_text는 고치지 않는다.';
comment on table memory_items is '0086. 기록에서 뽑은 정보 단위(사실 · 주장 · 결정 · 제안 · 약속 · 업무 · 위험 · 기회 · 질문) — 초안으로 시작.';
comment on table memory_review_queue is '0086. 기억 검토함 — 불확실한 연결 · 바뀜 · 재무 · 업무 후보 · 모호한 날짜. 자동 확정 없음.';
comment on table memory_embeddings is '0086. 벡터 검색 자리(업체 결정 전 — 비어 있음). 같은 판정(memory_me).';

-- 원본 보존 — 주인 · 열쇠 · 본문 · 기록 시각은 바꾸지 않는다(처리 칸 · 요약 · 분류 · 보관만 바뀐다).
create or replace function memory_captures_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $fn$
begin
  if new.owner_id is distinct from old.owner_id or new.client_key is distinct from old.client_key
     or new.raw_text is distinct from old.raw_text or new.captured_at is distinct from old.captured_at
     or new.capture_type is distinct from old.capture_type or new.created_at is distinct from old.created_at then
    raise exception 'memory_original_locked' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;
create trigger memory_captures_guard before update on memory_captures for each row execute function memory_captures_guard();

-- =====================================================================
-- 3절. 읽기 정책 — 주인 본인 · 대표 · 스위치(쓰기 grant 없음 — 정의자 RPC만)
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['memory_captures', 'memory_capture_assets', 'memory_segments', 'memory_meetings', 'memory_entities',
                           'memory_aliases', 'memory_items', 'memory_links', 'memory_revisions', 'memory_review_queue',
                           'memory_processing_runs', 'memory_jobs', 'memory_embeddings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from public, anon, authenticated', t);
    execute format('grant select on table %I to authenticated', t);
    execute format('create policy %I on %I for select to authenticated using (memory_me(owner_id))', t || '_read', t);
  end loop;
end $$;
revoke all on sequence memory_revisions_revision_id_seq from public, anon, authenticated;

-- memory_* 감사 줄은 주인 본인만 읽는다(0045 attachments와 같은 restrictive 모양). 내용은 감사 줄에 넣지 않는다.
create policy audit_log_memory_private on audit_log as restrictive for select to authenticated
  using (entity_table is null or entity_table not like 'memory\_%' or actor_user_id = auth.uid());

-- 검토함에서 승인한 업무만 넣는다(출처 칸 없음 = 앱 업무 · 직원이 그 회사 업무로 본다). 정의자 함수(memory_review_resolve) 안에서만
-- 참이다 — PostgREST 세션(current_user = authenticated)에서 대표가 직접 tasks에 넣는 길은 열지 않는다(0071 통로와 같은 생각).
-- Supabase의 postgres는 BYPASSRLS라 이 정책 없이도 돌지만, BYPASSRLS 없는 소유자에서도 같은 결과가 나게 둔다.
create policy tasks_memory_insert on tasks for insert to authenticated
  with check (source_label is null and memory_me(auth.uid()) and current_user not in ('authenticated', 'anon', 'authenticator'));

-- =====================================================================
-- 4절. 비공개 버킷 — '<본인 uid>/<기록 id>/<이름>'
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('memory-assets', 'memory-assets', false)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'memory-assets' and public) then
    raise exception 'memory-assets 버킷이 공개로 설정되어 있다 — 콘솔에서 비공개로 되돌린 뒤 다시 적용한다.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$ update storage.buckets set file_size_limit = 26214400 where id = 'memory-assets' $q$;
  end if;
end $$;

create or replace function memory_object_ok(object_name text) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $fn$
declare
  v_parts text[];
begin
  if auth.uid() is null then
    return false;
  end if;
  v_parts := string_to_array(object_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 or v_parts[3] = '' or v_parts[3] like '.%'
     or v_parts[2] !~ '^[0-9a-f-]{36}$' or v_parts[1] <> auth.uid()::text then
    return false;
  end if;
  return public.memory_me(auth.uid());
end;
$fn$;
comment on function memory_object_ok(text) is '0086. 기억 파일 «<본인 uid>/<기록 id>/<이름>» — 본인 폴더 · memory_me. 읽기 · 올리기 공통(지우기 · 옮기기 없음).';
revoke all on function memory_object_ok(text) from public, anon;
grant execute on function memory_object_ok(text) to authenticated;

drop policy if exists memory_objects_read on storage.objects;
drop policy if exists memory_objects_insert on storage.objects;
create policy memory_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'memory-assets' and public.memory_object_ok(name));
create policy memory_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'memory-assets' and public.memory_object_ok(name));

-- =====================================================================
-- 5절. RPC — 저장 · 처리 · 검토 · 검색
-- =====================================================================

/** 감사 한 줄(내용 없음). */
create or replace function memory_audit(p_action text, p_table text, p_id text, p_after jsonb, p_note text) returns void
language sql security definer set search_path = public, pg_temp as $fn$
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (p_action::audit_action, p_table, p_id, null, auth.uid(), auth_role()::text, null, p_after, p_note);
$fn$;
revoke all on function memory_audit(text, text, text, jsonb, text) from public, anon, authenticated;

/** 정규화한 글 → 중복 열쇠의 몸통(소문자 · 공백 · 문장부호 뺌). */
create or replace function memory_norm(p text) returns text
language sql immutable set search_path = public, pg_temp as $fn$
  select regexp_replace(lower(coalesce(p, '')), '[[:space:][:punct:]·«»“”‘’]+', '', 'g');
$fn$;

/** 기록 저장 — 원본을 바로 남기고 처리 큐에 한 줄. 같은 client_key면 처음 줄을 그대로 돌려준다(두 번 눌러도 한 줄). */
create or replace function memory_capture_save(
  p_client_key text, p_type text, p_title text, p_raw_text text,
  p_captured_at timestamptz default null, p_source text default 'quick_capture', p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id   uuid;
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if not memory_me(auth.uid()) then
    raise exception 'memory_denied' using errcode = '42501';
  end if;
  if jsonb_typeof(v_meta) <> 'object' or length(v_meta::text) > 4000 then
    raise exception 'memory_bad_metadata' using errcode = '22023';
  end if;
  select capture_id into v_id from memory_captures where owner_id = auth.uid() and client_key = p_client_key;
  if v_id is not null then
    return v_id;
  end if;
  if length(btrim(coalesce(p_raw_text, ''))) = 0 and p_type not in ('voice', 'file', 'meeting', 'online_meeting', 'phone_call') then
    raise exception 'memory_empty' using errcode = '22023';
  end if;
  insert into memory_captures (owner_id, client_key, capture_type, title, raw_text, source, captured_at, metadata)
  values (auth.uid(), p_client_key, p_type, nullif(btrim(coalesce(p_title, '')), ''), coalesce(p_raw_text, ''),
          coalesce(nullif(p_source, ''), 'quick_capture'),
          -- 기록 시각은 지금 기준 앞 30일 ~ 뒤 1일만 받는다(시계가 틀린 기기).
          case when p_captured_at is null or p_captured_at > now() + interval '1 day' or p_captured_at < now() - interval '30 days'
               then now() else p_captured_at end,
          v_meta)
  on conflict (owner_id, client_key) do nothing
  returning capture_id into v_id;
  if v_id is null then
    select capture_id into v_id from memory_captures where owner_id = auth.uid() and client_key = p_client_key;
    return v_id;
  end if;
  if p_type in ('meeting', 'online_meeting') then
    insert into memory_meetings (capture_id, owner_id, started_at, participants, status)
    values (v_id, auth.uid(), now(),
            case when jsonb_typeof(v_meta -> 'participants') = 'array' then v_meta -> 'participants' else '[]'::jsonb end, 'ended')
    on conflict (capture_id) do nothing;
  end if;
  insert into memory_jobs (capture_id, owner_id) values (v_id, auth.uid()) on conflict (capture_id) do nothing;
  insert into memory_processing_runs (owner_id, capture_id, processing_stage, status, engine, stats, completed_at)
  values (auth.uid(), v_id, 'ingest', 'done', 'rule', jsonb_build_object('chars', length(coalesce(p_raw_text, ''))), now());
  perform memory_audit('create', 'memory_captures', v_id::text, jsonb_build_object('type', p_type), '기억 기록 저장(0086)');
  return v_id;
end;
$fn$;

/** 올린 파일 한 줄 — 경로는 «<본인>/<기록>/<이름>»(버킷 정책과 같은 모양). 음성은 «전사 대기». */
create or replace function memory_asset_add(
  p_capture uuid, p_path text, p_name text, p_type text, p_size bigint, p_kind text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_owner uuid;
  v_id    uuid;
begin
  select owner_id into v_owner from memory_captures where capture_id = p_capture;
  if v_owner is null or not memory_me(v_owner) then
    raise exception 'memory_denied' using errcode = '42501';
  end if;
  if p_path is null or p_path not like auth.uid()::text || '/' || p_capture::text || '/%' or p_path like '%/../%'
     or coalesce(array_length(string_to_array(p_path, '/'), 1), 0) <> 3 then
    raise exception 'memory_bad_path' using errcode = '22023';
  end if;
  insert into memory_capture_assets (owner_id, capture_id, storage_path, file_name, file_type, file_size, kind, processing_status)
  values (v_owner, p_capture, p_path, p_name, p_type, p_size, p_kind,
          case when p_kind = 'audio' then 'waiting_transcript' else 'stored' end)
  on conflict (storage_path) do nothing
  returning asset_id into v_id;
  if v_id is null then
    select asset_id into v_id from memory_capture_assets where storage_path = p_path and owner_id = v_owner and capture_id = p_capture;
    return v_id;
  end if;
  -- 새 파일이 오면 다시 처리한다(같은 기록 · 같은 큐 줄).
  update memory_jobs set status = 'queued', next_at = now(), updated_at = now() where capture_id = p_capture and status <> 'running';
  perform memory_audit('create', 'memory_capture_assets', v_id::text, jsonb_build_object('kind', p_kind, 'size', p_size), '기억 파일 올림(0086)');
  return v_id;
end;
$fn$;

/** 파일 상태(추출 끝 · 실패 · 건너뜀) — 처리 쪽이 부른다. 음성 «전사 대기»는 STT가 붙기 전까지 그대로 둔다. */
create or replace function memory_asset_status(p_asset uuid, p_status text, p_chars int default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_owner uuid;
begin
  select owner_id into v_owner from memory_capture_assets where asset_id = p_asset;
  if v_owner is null or not memory_me(v_owner) then
    raise exception 'memory_denied' using errcode = '42501';
  end if;
  update memory_capture_assets set processing_status = p_status, extracted_chars = coalesce(p_chars, extracted_chars) where asset_id = p_asset;
  return true;
end;
$fn$;

/**
 * 처리 시작 — 큐 줄을 잡는다. 이미 돌고 있으면(10분 안) null — 같은 기록을 두 곳에서 동시에 처리하지 않는다.
 * 10분 넘게 «running»이면 멈춘 것으로 보고 다시 잡는다. 돌려주는 값 = 이번 시도 번호.
 */
create or replace function memory_job_claim(p_capture uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_owner uuid;
  v_job   memory_jobs%rowtype;
begin
  select owner_id into v_owner from memory_captures where capture_id = p_capture;
  if v_owner is null or not memory_me(v_owner) then
    raise exception 'memory_denied' using errcode = '42501';
  end if;
  insert into memory_jobs (capture_id, owner_id) values (p_capture, v_owner) on conflict (capture_id) do nothing;
  select * into v_job from memory_jobs where capture_id = p_capture for update;
  if v_job.status = 'running' and v_job.locked_at > now() - interval '10 minutes' then
    return null;
  end if;
  update memory_jobs set status = 'running', attempts = least(attempts + 1, 100), locked_at = now(), updated_at = now()
   where capture_id = p_capture
  returning * into v_job;
  update memory_captures set processing_status = 'processing' where capture_id = p_capture;
  return v_job.attempts;
end;
$fn$;

/** 대상이 있는가(연결 · 업무). 정의자 — 대표만 부르므로 회사 범위는 전체다. */
create or replace function memory_target_ok(p_type text, p_id text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select case p_type
    when 'business' then exists (select 1 from businesses where business_id = p_id)
    when 'project'  then exists (select 1 from projects where project_id = p_id)
    when 'person'   then exists (select 1 from user_profiles where user_id::text = p_id)
    when 'decision' then exists (select 1 from decisions where decision_id = p_id)
    when 'task'     then exists (select 1 from tasks where task_id = p_id)
    when 'entity'   then exists (select 1 from memory_entities where entity_id::text = p_id and owner_id = auth.uid())
    else false end;
$fn$;
revoke all on function memory_target_ok(text, text) from public, anon, authenticated;

/** 이름 → 바깥 인물 · 회사(없으면 pending으로 만든다). */
create or replace function memory_entity_for(p_owner uuid, p_type text, p_name text, p_capture uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_id uuid;
begin
  select entity_id into v_id from memory_entities
   where owner_id = p_owner and entity_type = p_type and lower(btrim(display_name)) = lower(btrim(p_name));
  if v_id is null then
    insert into memory_entities (owner_id, entity_type, display_name, first_capture_id)
    values (p_owner, p_type, btrim(p_name), p_capture)
    on conflict do nothing
    returning entity_id into v_id;
    if v_id is null then
      select entity_id into v_id from memory_entities
       where owner_id = p_owner and entity_type = p_type and lower(btrim(display_name)) = lower(btrim(p_name));
    end if;
  end if;
  return v_id;
end;
$fn$;
revoke all on function memory_entity_for(uuid, text, text, uuid) from public, anon, authenticated;

/**
 * 처리 결과 넣기 — 한 트랜잭션. p_payload(앱이 스키마 검사 뒤 보낸다):
 *   { summary, categories[], status_hint, runs:[{stage,status,engine,model,model_version,prompt_version,input_hash,stats,error}],
 *     items:[{ref, memory_type, content, source_quote, speaker_label, direction, who_text, to_text, due_date, due_text, amount_text,
 *             event_time, confidence, origin}],
 *     links:[{item_ref|null, target_type, target_id | (entity_type + display_name), relationship, verification_status, confidence, mention_text}],
 *     reviews:[{review_type, title, proposed_change, item_ref|null, related_item_id|null, link_ref|null, priority, key}] }
 * 같은 결과를 두 번 넣어도 정보 · 연결 · 검토는 한 번(열쇠 unique). 처리 이력(runs)은 매번 남는다.
 * 이번에 다시 나오지 않은 앞 초안(draft · ai/rule)은 지우지 않고 superseded로 둔다(사람이 확정한 것은 그대로).
 */
create or replace function memory_apply(p_capture uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_owner   uuid;
  v_r       jsonb;
  v_refs    jsonb := '{}'::jsonb;   -- item ref → item_id
  v_lrefs   jsonb := '{}'::jsonb;   -- link 순번 → link_id
  v_id      uuid;
  v_key     text;
  v_target  text;
  v_i       int := 0;
  v_new_items int := 0;
  v_new_links int := 0;
  v_new_reviews int := 0;
  v_open    int;
  v_status  text;
  v_keys    text[] := '{}';
begin
  select owner_id into v_owner from memory_captures where capture_id = p_capture;
  if v_owner is null or not memory_me(v_owner) then
    raise exception 'memory_denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or jsonb_array_length(coalesce(p_payload -> 'items', '[]')) > 80
     or jsonb_array_length(coalesce(p_payload -> 'links', '[]')) > 120
     or jsonb_array_length(coalesce(p_payload -> 'reviews', '[]')) > 80
     or jsonb_array_length(coalesce(p_payload -> 'runs', '[]')) > 10 then
    raise exception 'memory_bad_payload' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('memory_apply:' || p_capture::text));

  for v_r in select * from jsonb_array_elements(coalesce(p_payload -> 'runs', '[]')) loop
    insert into memory_processing_runs (owner_id, capture_id, processing_stage, status, engine, model, model_version, prompt_version,
                                        attempt_count, input_hash, stats, error_details, completed_at)
    values (v_owner, p_capture, v_r ->> 'stage', v_r ->> 'status', v_r ->> 'engine', v_r ->> 'model', v_r ->> 'model_version',
            v_r ->> 'prompt_version', coalesce((select attempts from memory_jobs where capture_id = p_capture), 1),
            v_r ->> 'input_hash', coalesce(v_r -> 'stats', '{}'), left(v_r ->> 'error', 500), now());
  end loop;

  -- 정보 단위
  for v_r in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]')) loop
    v_key := md5(p_capture::text || ':' || (v_r ->> 'memory_type') || ':' || memory_norm(v_r ->> 'content'));
    v_keys := v_keys || v_key;
    insert into memory_items (owner_id, capture_id, memory_type, content, source_quote, speaker_label, direction, who_text, to_text,
                              due_date, due_text, amount_text, event_time, confidence, origin, dedupe_key)
    values (v_owner, p_capture, v_r ->> 'memory_type', btrim(v_r ->> 'content'), nullif(v_r ->> 'source_quote', ''),
            nullif(v_r ->> 'speaker_label', ''), coalesce(nullif(v_r ->> 'direction', ''), 'unknown'), nullif(v_r ->> 'who_text', ''),
            nullif(v_r ->> 'to_text', ''), nullif(v_r ->> 'due_date', '')::date, nullif(v_r ->> 'due_text', ''),
            nullif(v_r ->> 'amount_text', ''), nullif(v_r ->> 'event_time', '')::timestamptz,
            least(greatest(coalesce((v_r ->> 'confidence')::numeric, 0.5), 0), 1),
            case when v_r ->> 'origin' = 'ai' then 'ai' else 'rule' end, v_key)
    on conflict (owner_id, dedupe_key) do nothing
    returning item_id into v_id;
    if v_id is null then
      select item_id into v_id from memory_items where owner_id = v_owner and dedupe_key = v_key;
      -- 앞에서 superseded로 밀렸던 초안이 다시 나오면 되살린다(사람이 정한 상태는 건드리지 않음).
      update memory_items set lifecycle_status = 'open', updated_at = now()
       where item_id = v_id and verification_status = 'draft' and lifecycle_status = 'superseded'
         and not exists (select 1 from memory_revisions rv where rv.item_id = v_id);
      -- 그때 자동으로 닫았던 검토도 다시 연다(사람이 닫은 것은 그대로).
      update memory_review_queue set status = 'open', resolution = null, resolved_at = null
       where item_id = v_id and status = 'rejected' and resolution ->> 'auto' = 'superseded_by_reprocess'
         and exists (select 1 from memory_items i where i.item_id = v_id and i.lifecycle_status = 'open');
    else
      v_new_items := v_new_items + 1;
    end if;
    v_refs := v_refs || jsonb_build_object(coalesce(v_r ->> 'ref', v_key), v_id);
  end loop;

  update memory_items set lifecycle_status = 'superseded', updated_at = now()
   where capture_id = p_capture and verification_status = 'draft' and origin in ('ai', 'rule')
     and lifecycle_status = 'open' and not (dedupe_key = any (v_keys))
     and not exists (select 1 from memory_revisions rv where rv.item_id = memory_items.item_id);
  -- 밀려난 초안을 가리키던 열린 검토는 닫는다(같은 약속이 다른 말로 다시 나와 업무 후보가 둘 생기지 않게 — 리뷰 I2).
  update memory_review_queue q set status = 'rejected', resolution = '{"auto": "superseded_by_reprocess"}'::jsonb, resolved_at = now()
    from memory_items i
   where q.item_id = i.item_id and q.capture_id = p_capture and q.status = 'open'
     and i.capture_id = p_capture and i.lifecycle_status = 'superseded' and i.verification_status = 'draft';

  -- 연결
  v_i := 0;
  for v_r in select * from jsonb_array_elements(coalesce(p_payload -> 'links', '[]')) loop
    if v_r ->> 'target_type' = 'entity' and coalesce(v_r ->> 'target_id', '') = '' then
      v_target := memory_entity_for(v_owner, coalesce(v_r ->> 'entity_type', 'other'), v_r ->> 'display_name', p_capture)::text;
    else
      v_target := v_r ->> 'target_id';
    end if;
    if v_target is null or not memory_target_ok(v_r ->> 'target_type', v_target) then
      raise exception 'memory_bad_target' using errcode = '22023';
    end if;
    v_id := null;
    insert into memory_links (owner_id, capture_id, item_id, target_type, target_id, relationship, verification_status, confidence, mention_text)
    values (v_owner, p_capture, nullif(v_refs ->> (v_r ->> 'item_ref'), '')::uuid, v_r ->> 'target_type', v_target,
            coalesce(v_r ->> 'relationship', 'mentions'),
            -- 처리 쪽(AI · 규칙)이 확정할 수 있는 것은 회사 · 프로젝트의 정식 이름 연결뿐 — 사람 · 바깥 인물 · 결정 · 업무는 검토함에서만(리뷰 I3).
            case when v_r ->> 'target_type' in ('business', 'project') and v_r ->> 'verification_status' = 'confirmed' then 'confirmed' else 'suggested' end,
            least(greatest(coalesce((v_r ->> 'confidence')::numeric, 0.5), 0), 1), left(v_r ->> 'mention_text', 120))
    on conflict do nothing
    returning link_id into v_id;
    if v_id is null then
      select link_id into v_id from memory_links
       where owner_id = v_owner and capture_id = p_capture
         and coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(nullif(v_refs ->> (v_r ->> 'item_ref'), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         and target_type = v_r ->> 'target_type' and target_id = v_target and relationship = coalesce(v_r ->> 'relationship', 'mentions');
    else
      v_new_links := v_new_links + 1;
    end if;
    v_lrefs := v_lrefs || jsonb_build_object(v_i::text, v_id);
    v_i := v_i + 1;
  end loop;

  -- 검토함
  for v_r in select * from jsonb_array_elements(coalesce(p_payload -> 'reviews', '[]')) loop
    if (v_r ->> 'related_item_id') is not null
       and not exists (select 1 from memory_items where item_id = (v_r ->> 'related_item_id')::uuid and owner_id = v_owner) then
      raise exception 'memory_bad_target' using errcode = '22023';
    end if;
    v_key := md5(p_capture::text || ':' || (v_r ->> 'review_type') || ':' || coalesce(v_r ->> 'key', '') || ':' ||
                 coalesce(v_r ->> 'related_item_id', ''));
    insert into memory_review_queue (owner_id, review_type, title, proposed_change, capture_id, item_id, related_item_id, link_id, priority, dedupe_key)
    values (v_owner, v_r ->> 'review_type', left(btrim(v_r ->> 'title'), 300), coalesce(v_r -> 'proposed_change', '{}'), p_capture,
            nullif(v_refs ->> (v_r ->> 'item_ref'), '')::uuid, nullif(v_r ->> 'related_item_id', '')::uuid,
            nullif(v_lrefs ->> (v_r ->> 'link_ref'), '')::uuid, coalesce(v_r ->> 'priority', 'medium'), v_key)
    on conflict (owner_id, dedupe_key) do nothing
    returning review_id into v_id;
    if v_id is not null then
      v_new_reviews := v_new_reviews + 1;
    end if;
  end loop;

  select count(*) into v_open from memory_review_queue where capture_id = p_capture and status = 'open';
  v_status := case
    when p_payload ->> 'status_hint' = 'waiting_transcript' then 'waiting_transcript'
    when v_open > 0 then 'needs_review'
    else 'ready' end;
  update memory_captures
     set summary = coalesce(nullif(left(p_payload ->> 'summary', 4000), ''), summary),
         categories = coalesce((select array_agg(distinct c) from jsonb_array_elements_text(coalesce(p_payload -> 'categories', '[]')) c), categories),
         processing_status = v_status
   where capture_id = p_capture;
  -- 끝나면 시도 수를 0으로(다음 «다시 처리»는 1번째 시도 — 연속 실패만 센다).
  update memory_jobs set status = 'done', attempts = 0, locked_at = null, last_error = null, updated_at = now() where capture_id = p_capture;
  return jsonb_build_object('status', v_status, 'new_items', v_new_items, 'new_links', v_new_links, 'new_reviews', v_new_reviews);
end;
$fn$;

/** 처리 실패 — 원본은 그대로, 기록은 «실패», 큐는 뒤로(1 · 4 · 16 · 60분), 처리 이력 한 줄. */
create or replace function memory_fail(p_capture uuid, p_error text, p_engine text default 'ai', p_model text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_owner uuid;
  v_att   int;
begin
  select owner_id into v_owner from memory_captures where capture_id = p_capture;
  if v_owner is null or not memory_me(v_owner) then
    raise exception 'memory_denied' using errcode = '42501';
  end if;
  select attempts into v_att from memory_jobs where capture_id = p_capture;
  update memory_jobs
     set status = 'failed', locked_at = null, last_error = left(coalesce(p_error, '알 수 없는 오류'), 500), updated_at = now(),
         next_at = now() + (least(power(4, greatest(coalesce(v_att, 1) - 1, 0)), 60) || ' minutes')::interval
   where capture_id = p_capture;
  update memory_captures set processing_status = 'failed' where capture_id = p_capture;
  insert into memory_processing_runs (owner_id, capture_id, processing_stage, status, engine, model, attempt_count, error_details, completed_at)
  values (v_owner, p_capture, 'extract', 'failed', coalesce(p_engine, 'ai'), p_model, greatest(coalesce(v_att, 1), 1),
          left(coalesce(p_error, '알 수 없는 오류'), 500), now());
  return true;
end;
$fn$;

/** 다시 처리 — 실패 · 끝난 기록을 큐에 다시 올린다(원본 · 앞 결과는 그대로). */
create or replace function memory_requeue(p_capture uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_owner uuid;
begin
  select owner_id into v_owner from memory_captures where capture_id = p_capture;
  if v_owner is null or not memory_me(v_owner) then
    raise exception 'memory_denied' using errcode = '42501';
  end if;
  insert into memory_jobs (capture_id, owner_id) values (p_capture, v_owner)
  on conflict (capture_id) do update set status = 'queued', next_at = now(), updated_at = now()
   where memory_jobs.status <> 'running' or memory_jobs.locked_at < now() - interval '10 minutes';
  return true;
end;
$fn$;

/** 정보 상태 바꾸기(끝남 · 취소 · 보류 · 다시 열기 · 확정 · 내용 고침) — 이력 한 줄. 원래 줄은 지우지 않는다. */
create or replace function memory_item_set(p_item uuid, p_patch jsonb, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_old memory_items%rowtype;
  v_new memory_items%rowtype;
begin
  select * into v_old from memory_items where item_id = p_item for update;
  if v_old.item_id is null or not memory_me(v_old.owner_id) then
    raise exception 'memory_denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'memory_reason_required' using errcode = '22023';
  end if;
  update memory_items set
    lifecycle_status    = coalesce(p_patch ->> 'lifecycle_status', lifecycle_status),
    verification_status = coalesce(p_patch ->> 'verification_status', verification_status),
    content             = coalesce(nullif(btrim(p_patch ->> 'content'), ''), content),
    due_date            = case when p_patch ? 'due_date' then nullif(p_patch ->> 'due_date', '')::date else due_date end,
    direction           = coalesce(p_patch ->> 'direction', direction),
    updated_at          = now()
   where item_id = p_item
  returning * into v_new;
  insert into memory_revisions (owner_id, item_id, previous_version, new_version, change_reason, source_capture_id)
  values (v_old.owner_id, p_item,
          jsonb_build_object('content', v_old.content, 'lifecycle_status', v_old.lifecycle_status, 'verification_status', v_old.verification_status,
                             'due_date', v_old.due_date, 'direction', v_old.direction),
          jsonb_build_object('content', v_new.content, 'lifecycle_status', v_new.lifecycle_status, 'verification_status', v_new.verification_status,
                             'due_date', v_new.due_date, 'direction', v_new.direction),
          left(btrim(p_reason), 300), v_old.capture_id);
  return true;
end;
$fn$;

/**
 * 검토함 처리 — p_action: confirm · edit · reject · link(기존 대상에 잇기) · create_entity(새 바깥 인물 · 회사).
 * p_data: { target_type, target_id, display_name, entity_type, content, due_date, project_id, owner_user_id, title, alias }
 *   entity_identity · link_suggestion  confirm = 제안된 연결 확정 · link = 고른 대상으로 잇기(+ 별칭) · create_entity = 바깥 인물로 확정
 *   change_detected · conflict         confirm = 새 정보가 맞다(옛 정보 superseded + 이력) · reject = 옛 정보 유지
 *   task_candidate                     confirm/edit = tasks에 한 줄(project_id 필수 · 같은 약속이 이미 업무면 그 업무에 잇기만)
 *   financial · decision_check · date_ambiguous  confirm/edit = 정보 확정(edit는 내용 · 날짜 고침)
 * 모든 바뀜은 memory_revisions에 남고, 검토 줄은 지우지 않는다.
 */
create or replace function memory_review_resolve(p_review uuid, p_action text, p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_rv      memory_review_queue%rowtype;
  v_item    memory_items%rowtype;
  v_data    jsonb := coalesce(p_data, '{}'::jsonb);
  v_status  text;
  v_link    uuid;
  v_entity  uuid;
  v_task    text;
  v_project text;
  v_result  jsonb := '{}'::jsonb;
begin
  select * into v_rv from memory_review_queue where review_id = p_review for update;
  if v_rv.review_id is null or not memory_me(v_rv.owner_id) then
    raise exception 'memory_denied' using errcode = '42501';
  end if;
  if v_rv.status <> 'open' then
    raise exception 'memory_review_closed' using errcode = '55P03';
  end if;
  if p_action not in ('confirm', 'edit', 'reject', 'link', 'create_entity') then
    raise exception 'memory_bad_action' using errcode = '22023';
  end if;
  if p_action in ('link', 'create_entity') and v_rv.review_type not in ('entity_identity', 'link_suggestion') then
    raise exception 'memory_bad_action' using errcode = '22023';
  end if;
  if v_rv.item_id is not null then
    select * into v_item from memory_items where item_id = v_rv.item_id;
    if p_action <> 'reject' and v_item.lifecycle_status = 'superseded'
       and v_rv.review_type in ('task_candidate', 'financial', 'decision_check', 'date_ambiguous') then
      raise exception 'memory_item_superseded' using errcode = '55P03';
    end if;
  end if;

  if p_action = 'reject' then
    v_status := 'rejected';
    if v_rv.link_id is not null then
      update memory_links set verification_status = 'rejected', updated_at = now() where link_id = v_rv.link_id;
      insert into memory_revisions (owner_id, link_id, previous_version, new_version, change_reason, source_capture_id, review_id)
      values (v_rv.owner_id, v_rv.link_id, jsonb_build_object('verification_status', 'suggested'), jsonb_build_object('verification_status', 'rejected'),
              '검토함 — 연결 거절', v_rv.capture_id, p_review);
    end if;

  elsif v_rv.review_type in ('entity_identity', 'link_suggestion') then
    if p_action = 'link' then
      if (v_data ->> 'target_type') not in ('business', 'project', 'person', 'entity') or not memory_target_ok(v_data ->> 'target_type', v_data ->> 'target_id') then
        raise exception 'memory_bad_target' using errcode = '22023';
      end if;
      insert into memory_links (owner_id, capture_id, item_id, target_type, target_id, relationship, verification_status, confidence, mention_text)
      values (v_rv.owner_id, v_rv.capture_id, v_rv.item_id, v_data ->> 'target_type', v_data ->> 'target_id', 'mentions', 'confirmed', 1,
              left(v_rv.proposed_change ->> 'mention', 120))
      on conflict do nothing;
      if v_rv.link_id is not null then
        update memory_links set verification_status = 'rejected', updated_at = now()
         where link_id = v_rv.link_id and not (target_type = v_data ->> 'target_type' and target_id = v_data ->> 'target_id');
        update memory_links set verification_status = 'confirmed', updated_at = now()
         where link_id = v_rv.link_id and target_type = v_data ->> 'target_type' and target_id = v_data ->> 'target_id';
      end if;
      -- 별칭으로 남긴다(«방 사장» → 그 사람). 다음 기록부터 후보로 먼저 뜬다 — 그래도 자동 확정은 아니다.
      if length(btrim(coalesce(v_data ->> 'alias', v_rv.proposed_change ->> 'mention', ''))) between 1 and 80 then
        insert into memory_aliases (owner_id, entity_type, entity_id, alias, verification_status)
        values (v_rv.owner_id, v_data ->> 'target_type', v_data ->> 'target_id', btrim(coalesce(v_data ->> 'alias', v_rv.proposed_change ->> 'mention')), 'confirmed')
        on conflict do nothing;
      end if;
      v_status := 'linked';
    elsif p_action = 'create_entity' then
      if length(btrim(coalesce(v_data ->> 'display_name', ''))) = 0 then
        raise exception 'memory_name_required' using errcode = '22023';
      end if;
      v_entity := memory_entity_for(v_rv.owner_id, coalesce(v_data ->> 'entity_type', 'person'), v_data ->> 'display_name', v_rv.capture_id);
      update memory_entities set status = 'confirmed', updated_at = now() where entity_id = v_entity;
      insert into memory_links (owner_id, capture_id, item_id, target_type, target_id, relationship, verification_status, confidence, mention_text)
      values (v_rv.owner_id, v_rv.capture_id, v_rv.item_id, 'entity', v_entity::text, 'mentions', 'confirmed', 1, left(v_rv.proposed_change ->> 'mention', 120))
      on conflict do nothing;
      if v_rv.link_id is not null then
        update memory_links set verification_status = 'rejected', updated_at = now() where link_id = v_rv.link_id and target_id <> v_entity::text;
      end if;
      v_status := 'created';
      v_result := jsonb_build_object('entity_id', v_entity);
    else -- confirm · edit = 제안된 연결 그대로 확정
      if v_rv.link_id is null then
        raise exception 'memory_nothing_to_confirm' using errcode = '22023';
      end if;
      update memory_links set verification_status = 'confirmed', updated_at = now() where link_id = v_rv.link_id;
      update memory_entities e set status = 'confirmed', updated_at = now()
        from memory_links l where l.link_id = v_rv.link_id and l.target_type = 'entity' and e.entity_id::text = l.target_id and e.status = 'pending';
      v_status := 'confirmed';
    end if;
    insert into memory_revisions (owner_id, link_id, previous_version, new_version, change_reason, source_capture_id, review_id)
    values (v_rv.owner_id, v_rv.link_id, v_rv.proposed_change, v_data || jsonb_build_object('action', p_action), '검토함 — 신원 · 연결', v_rv.capture_id, p_review);

  elsif v_rv.review_type in ('change_detected', 'conflict') then
    -- 새 정보가 맞다 → 옛 정보는 superseded(지우지 않음) · 새 정보 확정. 둘 다 이력.
    if v_rv.related_item_id is not null then
      perform memory_item_set(v_rv.related_item_id, jsonb_build_object('lifecycle_status', 'superseded'), '검토함 — 새 기록으로 바뀜 확인');
    end if;
    if v_rv.item_id is not null then
      perform memory_item_set(v_rv.item_id,
        jsonb_build_object('verification_status', 'confirmed') ||
        case when p_action = 'edit' then jsonb_strip_nulls(jsonb_build_object('content', v_data ->> 'content', 'due_date', v_data ->> 'due_date')) else '{}'::jsonb end,
        '검토함 — 바뀜 확인');
    end if;
    v_status := case when p_action = 'edit' then 'edited' else 'confirmed' end;

  elsif v_rv.review_type = 'task_candidate' then
    v_project := nullif(btrim(coalesce(v_data ->> 'project_id', v_rv.proposed_change ->> 'project_id', '')), '');
    if v_project is null or not exists (select 1 from projects where project_id = v_project) then
      raise exception 'memory_project_required' using errcode = '22023';
    end if;
    -- 같은 약속(정규화한 내용)이 이미 이 프로젝트의 업무로 이어져 있으면 새 업무를 만들지 않는다.
    select l.target_id into v_task
      from memory_links l
      join memory_items i on i.item_id = l.item_id
      join tasks t on t.task_id = l.target_id
     where l.owner_id = v_rv.owner_id and l.target_type = 'task' and l.relationship = 'created_task'
       and t.project_id = v_project
       and memory_norm(i.content) = memory_norm(coalesce(v_item.content, v_rv.proposed_change ->> 'title', v_rv.title))
     limit 1;
    if v_task is null then
      v_task := 't' || to_char(now() at time zone 'Asia/Seoul', 'YYMMDD') || '_' || substr(md5(p_review::text), 1, 10);
      insert into tasks (task_id, project_id, title, owner_user_id, priority, status, deadline)
      values (v_task, v_project,
              left(coalesce(nullif(btrim(v_data ->> 'title'), ''), v_item.content, v_rv.title), 300),
              nullif(v_data ->> 'owner_user_id', '')::uuid, 'Medium', 'Todo',
              coalesce(nullif(v_data ->> 'due_date', '')::date, v_item.due_date))
      on conflict (task_id) do nothing;
      v_result := jsonb_build_object('task_id', v_task, 'created', found);
    else
      v_result := jsonb_build_object('task_id', v_task, 'created', false);
    end if;
    insert into memory_links (owner_id, capture_id, item_id, target_type, target_id, relationship, verification_status, confidence)
    values (v_rv.owner_id, v_rv.capture_id, v_rv.item_id, 'task', v_task, 'created_task', 'confirmed', 1)
    on conflict do nothing;
    if v_rv.item_id is not null then
      perform memory_item_set(v_rv.item_id, jsonb_build_object('verification_status', 'confirmed'), '검토함 — 업무로 등록');
    end if;
    v_status := case when p_action = 'edit' then 'edited' else 'confirmed' end;

  else -- financial · decision_check · date_ambiguous
    if v_rv.item_id is not null then
      perform memory_item_set(v_rv.item_id,
        jsonb_build_object('verification_status', 'confirmed') ||
        case when p_action = 'edit' then jsonb_strip_nulls(jsonb_build_object('content', v_data ->> 'content', 'due_date', v_data ->> 'due_date')) else '{}'::jsonb end,
        '검토함 — 확인');
    end if;
    v_status := case when p_action = 'edit' then 'edited' else 'confirmed' end;
  end if;

  update memory_review_queue set status = v_status, resolution = v_data || jsonb_build_object('action', p_action) || v_result, resolved_at = now()
   where review_id = p_review;
  -- 열린 검토가 없으면 기록은 «준비됨».
  update memory_captures set processing_status = 'ready'
   where capture_id = v_rv.capture_id and processing_status = 'needs_review'
     and not exists (select 1 from memory_review_queue where capture_id = v_rv.capture_id and status = 'open');
  perform memory_audit('update', 'memory_review_queue', p_review::text, jsonb_build_object('action', p_action, 'status', v_status), '기억 검토(0086)');
  return jsonb_build_object('status', v_status) || v_result;
end;
$fn$;

/**
 * 검색 — invoker(표 RLS가 거른다 — 주인 아니면 0행). 낱말마다 본문 · 제목 · 요약 · 정보 내용에 들어 있어야 한다(한국어는 형태소가 없어
 * ilike — 삼중자 색인이 받친다, 영어 순위는 tsvector). 사람 세션이 extensions 스키마를 몰라도 돌게 삼중자 함수는 부르지 않는다. 대상(회사 · 프로젝트 · 사람 · 바깥 인물) · 날짜 · 종류로 거른다. 기록 줄과 정보 줄을 함께 돌려준다.
 */
create or replace function memory_search(
  p_query text, p_from date default null, p_to date default null, p_type text default null,
  p_target_type text default null, p_target_id text default null, p_limit int default 30
) returns table (
  kind text, capture_id uuid, item_id uuid, memory_type text, capture_type text, title text, snippet text,
  captured_at timestamptz, due_date date, lifecycle_status text, verification_status text, score real
)
language plpgsql stable security invoker set search_path = public, pg_temp as $fn$
declare
  v_q     text := btrim(coalesce(p_query, ''));
  v_words text[];
  v_lim   int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if not memory_me(auth.uid()) then
    return;
  end if;
  v_words := array(select replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_')
                     from unnest(regexp_split_to_array(v_q, '\s+')) w where length(w) > 0 limit 8);
  return query
  with caps as (
    select c.* from memory_captures c
     where c.owner_id = auth.uid() and c.archived_at is null
       and (p_from is null or (c.captured_at at time zone 'Asia/Seoul')::date >= p_from)
       and (p_to is null or (c.captured_at at time zone 'Asia/Seoul')::date <= p_to)
       and (p_target_type is null or exists (
             select 1 from memory_links l where l.capture_id = c.capture_id and l.target_type = p_target_type
                and l.target_id = p_target_id and l.verification_status <> 'rejected'))
  ), cap_hits as (
    select 'capture'::text as kind, c.capture_id, null::uuid as item_id, null::text as memory_type, c.capture_type,
           coalesce(c.title, left(regexp_replace(c.raw_text, '\s+', ' ', 'g'), 60)) as title,
           left(regexp_replace(coalesce(c.summary, c.raw_text), '\s+', ' ', 'g'), 240) as snippet,
           c.captured_at, null::date as due_date, null::text as lifecycle_status, null::text as verification_status,
           (case when cardinality(v_words) = 0 then 0
                 else ts_rank(c.search_tsv, plainto_tsquery('simple', v_q))
                      + case when coalesce(c.title, '') ilike '%' || v_words[1] || '%' then 0.3 else 0 end end)::real as score
      from caps c
     where p_type is null
       and (cardinality(v_words) = 0 or not exists (
             select 1 from unnest(v_words) w
              where (coalesce(c.title, '') || ' ' || c.raw_text || ' ' || coalesce(c.summary, '')) not ilike '%' || w || '%'))
  ), item_hits as (
    select 'item'::text, i.capture_id, i.item_id, i.memory_type, c.capture_type,
           left(i.content, 120), left(coalesce(i.source_quote, i.content), 240),
           c.captured_at, i.due_date, i.lifecycle_status, i.verification_status,
           (case when cardinality(v_words) = 0 then 0
                 else 0.2 + case when i.lifecycle_status = 'open' then 0.1 else 0 end end)::real
      from memory_items i join caps c on c.capture_id = i.capture_id
     where i.owner_id = auth.uid() and i.verification_status <> 'rejected'
       and (p_type is null or i.memory_type = p_type)
       and (cardinality(v_words) = 0 or not exists (
             select 1 from unnest(v_words) w
              where (i.content || ' ' || coalesce(i.source_quote, '') || ' ' || coalesce(i.who_text, '') || ' ' || coalesce(i.to_text, ''))
                    not ilike '%' || w || '%'))
  )
  select * from (select * from cap_hits union all select * from item_hits) h
   order by h.score desc, h.captured_at desc
   limit v_lim;
end;
$fn$;

-- =====================================================================
-- 6절. 실행 권한 — 사람(authenticated)만. 판정은 함수 첫 줄(memory_me).
-- =====================================================================
revoke all on function memory_norm(text) from public, anon;
grant execute on function memory_norm(text) to authenticated;
revoke all on function memory_capture_save(text, text, text, text, timestamptz, text, jsonb) from public, anon;
revoke all on function memory_asset_add(uuid, text, text, text, bigint, text) from public, anon;
revoke all on function memory_asset_status(uuid, text, int) from public, anon;
revoke all on function memory_job_claim(uuid) from public, anon;
revoke all on function memory_apply(uuid, jsonb) from public, anon;
revoke all on function memory_fail(uuid, text, text, text) from public, anon;
revoke all on function memory_requeue(uuid) from public, anon;
revoke all on function memory_item_set(uuid, jsonb, text) from public, anon;
revoke all on function memory_review_resolve(uuid, text, jsonb) from public, anon;
revoke all on function memory_search(text, date, date, text, text, text, int) from public, anon;
grant execute on function memory_capture_save(text, text, text, text, timestamptz, text, jsonb) to authenticated;
grant execute on function memory_asset_add(uuid, text, text, text, bigint, text) to authenticated;
grant execute on function memory_asset_status(uuid, text, int) to authenticated;
grant execute on function memory_job_claim(uuid) to authenticated;
grant execute on function memory_apply(uuid, jsonb) to authenticated;
grant execute on function memory_fail(uuid, text, text, text) to authenticated;
grant execute on function memory_requeue(uuid) to authenticated;
grant execute on function memory_item_set(uuid, jsonb, text) to authenticated;
grant execute on function memory_review_resolve(uuid, text, jsonb) to authenticated;
grant execute on function memory_search(text, date, date, text, text, text, int) to authenticated;
revoke all on function memory_captures_guard() from public, anon, authenticated;

commit;
