-- =====================================================================
-- Chairman OS — 0058_intake (자료 받는 입구 · AI 제외 대상의 DB 문)
-- 작성: 2026-10-07 (설계: docs/superpowers/specs/2026-10-06-intake-and-purchasing.md «A1~A6 · B③④ · D 0058_intake»)
--
-- 회장 지시: 회사 화면의 «첨부» 칸이 «자료 받는 입구»가 된다(F9). 파일을 놓으면 AI가 한 번 읽고 «이 파일은 ‹종류›로
-- 보입니다»를 **제안**(결정 아님)하고, 사람이 확인하면 그 메뉴에 들어간다. 이 블록에서 들어갈 수 있는 메뉴는 **문서뿐**이다.
-- 회장 결정(2026-10-07, 구속): 구매(0059)는 취소 — 원가 엔진 설계로 따로 간다. 결산 초안은 0060에서.
--
-- ■ 이 파일이 하는 것 ■
--   1절 intake_items          입구 줄 하나 = 원본 파일(첨부) 하나. 상태 · AI 제안(jsonb) · 사람이 확인한 종류 · 적재된 곳.
--       믿지 않는 칸은 DB가 적는다(0045 attachments_stamp와 같은 결): 올린 사람 · 시각 · 상태(처음엔 늘 uploaded) ·
--       제안 이력 · 종류 확인 도장 · «배합비 아님» 확인 도장 · 적재 칸. 회사 · 등급 · 파일 · 해시는 한 번 정해지면 그대로다.
--       **등급 칸을 입구 줄에도 둔다**(설계서 D에 없음) — 읽기 규칙 «has_business AND attachment_class_ok»가 첨부 줄을
--       읽지 않고 판정하게. 첨부를 읽으면 첨부 쪽 정책(대상 = 입구 줄이 보이는가)과 서로를 부르는 원이 된다.
--       같은 값인지는 첨부 insert(restrictive)와 커밋 때 검사(deferred 제약 트리거)가 잰다.
--   2절 RLS                   읽기 = 회사 AND 등급(적재된 줄은 + 그 문서가 보이는 사람 · 올린 사람 · 회장 — 리뷰 I4) · 넣기 = 본인 · 그 회사 · 그 등급 · 고치기 = 칸 다섯(grant) + 정책(올린 사람 ·
--       확인 권한자 · 회장) · 지우기 없음 · AIAgent/Integration restrictive 세 짝(0045와 같은 이름).
--       적재 칸(loaded_*) · 종류 확인 도장(kind_confirmed_*) · 제안 이력은 grant가 없다 — 올린 사람이 «적재됨»을 꾸밀 수 없다.
--       status = 'loaded'는 적재 칸이 차 있을 때만(칸 제약) → 적재는 RPC로만 선다.
--   3절 첨부 대상에 intake_items — entity check · attachment_entity_visible · attachments_stamp에 한 case씩.
--       **0050판 본문을 그대로 옮기고 한 줄씩 더했다**(0045판에서 옮기면 finance_imports가 조용히 빠진다).
--       storage_path를 **생성 칸에서 보통 칸으로**(drop expression — 값은 그대로) 바꾸고 stamp가 insert 때 같은 식으로 적는다.
--       이유: 입구 → 문서로 첨부의 대상을 바꾸면 생성 칸은 경로를 다시 계산하는데, Storage의 객체는 SQL로 옮길 수 없다
--       (객체 이름을 고쳐도 실체는 안 움직인다). 경로는 «처음 올린 자리»로 고정하고, 버킷 정책은 지금처럼 그 칸으로 줄을 찾는다.
--       0045의 «경로는 DB가 만든다»는 그대로다 — authenticated에게 그 칸의 update grant는 없고, insert 값은 stamp가 덮는다.
--       입구 원본은 그 입구 줄을 만든 본인만, 그 줄의 첨부 id · 등급으로만 올린다(restrictive insert — 0050 finance_imports와 같은 모양).
--       읽고 난 원본은 바꿔 올리지 못한다 — 0045의 한 시간 재업로드 창을 입구 줄이 uploaded일 때만으로 좁힌다(attachment_object_uploadable).
--       문서로 적재된 원본은 지우지 못한다(restrictive delete) — 지우려면 문서를 지워(되돌려) 입구로 돌린 뒤에.
--       첨부의 대상 재지정은 **입구 → 문서(적재) · 문서 → 입구(되돌리기)** 두 길만 연다(attachments_entity_guard). 칸 grant가 원래
--       없어서 직원은 어느 쪽도 직접 못 하고, 소유자 권한으로 도는 이 파일의 함수 둘만 그 길을 탄다.
--   4절 AI 제외 대상을 DB에서 막는다 — record_attachment_ai_send(0045판이 마지막 — 0046~0057은 다시 정의하지 않았다).
--       첨부의 대상이 제외 목록('finance_imports' — 0057 전표 증빙 대상 자리 표시)이면 무엇을 적기 전에 42501 'ai_excluded'.
--       읽기 통행증(0045 attachment_recent_pass)이 이 감사 줄을 보므로, 줄을 못 남기면 **제3자**(올린 사람 · 회장 밖)에게는
--       Storage가 파일을 내주지 않는다. **올린 사람과 회장은 통행증 없이 객체를 연다**(0045 attachment_object_visible —
--       그 의미는 바꾸지 않는다). 그 둘의 세션에서는 «감사 → 거부되면 멈춤 → 그다음에 파일 읽기» 순서를 앱이 지켜야
--       한다(lib/attachments/summarize.ts의 호출 순서) — DB가 막는 것은 제3자 경로뿐이다.
--       입구 줄이 AI 차단(ai_blocked_reason — 아래)이거나 «AI 안 보냄»(no_ai)이거나, 사진(image/*)인데 올린 사람의 «배합비 아님»
--       확인이 없으면(F4) 같은 42501이다. 스캔 PDF는 DB가 글자층을 모르니 앱이 같은 확인을 요구한다(설계서 A5).
--       **AI 차단은 끈적하다(리뷰 I1)**: no_ai에 들어가는 순간 이유가 ai_blocked_reason에 복사되고, no_ai에서 나가거나 이유를
--       바꾸는 것은 대표(또는 세션 없는 SQL)만이다 — 이유가 무엇이든. 대표가 직접 풀면(제안 · 보관 등) 차단이 지워지고,
--       대표가 차단된 줄을 문서로 적재하면 차단은 남는다(적재 · 되돌리기를 지나도 그 원본은 AI로 못 간다).
--       되돌리면 차단된 줄은 no_ai(같은 이유)로, 아닌 줄은 proposed로 돌아온다.
--   5절 intake_move_to_document(…)  확인 → 문서 한 트랜잭션: 권한(0048 can_write_documents) · documents insert · 첨부 재지정 ·
--       입구 줄 loaded · 감사 두 줄(«입구 ‹item›에서 — AI 제안, ‹역할› 확인»). 이중 적재는 줄 잠금 + 상태 + unique로 막는다.
--       되돌리기 = 문서 soft delete(0042 soft_delete — 문서의 0048 고치기 규칙 = 적재한 사람 · 회장)가 트리거로 첨부를 입구 줄로
--       돌리고 상태를 'proposed'(AI 차단 줄은 no_ai)로 되돌린다. 같은 파일(sha256) 알림은 intake_same_file(item).
--       입구 줄 만들기는 intake_begin(…) 하나로 — 입구 줄과 첨부 줄은 서로를 가리켜서(첨부 FK · 첨부의 대상) 한 트랜잭션이어야 하고,
--       PostgREST 요청 둘은 트랜잭션 둘이다. security invoker — 호출자의 insert 권한(위 정책)으로 돈다.
--
-- ■ 왜 적재 함수가 security definer인가 ■
--   설계서 A1-6은 «security invoker»라 했다. 적재가 쓰는 칸이 셋 다 호출자에게 grant가 없는 칸이다 —
--   attachments.entity_table · entity_id(0045가 요약 다섯 칸만 열었다), intake_items.loaded_*(위 2절 — 올린 사람이 꾸미지 못하게).
--   invoker로 두려면 이 칸들을 authenticated에 열어야 하고, 그러면 PostgREST로 직접 고치는 길이 같이 열린다(정책은 행만 고른다 —
--   0030 4절). 그래서 definer로 두고, 호출자 판정을 함수 안에 전부 적는다: 활성 · 사람 역할 · 그 줄이 보이는가(회사 AND 등급) ·
--   문서 쓰기(can_write_documents — 0048) · 문서 등급 ≤ 내 열람 등급 · 등록자 = 본인 · AI 차단 줄은 대표만.
--   **Supabase에서 소유자(postgres)는 BYPASSRLS라 documents · audit_log의 force가 이 함수에는 걸리지 않는다** — 판정은 함수 안의
--   것이 전부다. (check-migrations는 BYPASSRLS 없는 소유자로도 돌려 보지만, 그것은 보조 확인일 뿐 운영의 방어선이 아니다.)
--   같은 이유로 0038 documents_version 트리거가 «직전 판»을 RLS 없이 찾는다 — 호출자가 못 보는 문서의 판 사슬에 새 문서가
--   붙을 수 있다(리뷰 I3). 그래서 함수가 그 후보를 호출자 기준(documents_read와 같은 식 — intake_doc_readable)으로 다시 재고,
--   못 보는 후보면 supersedes = null · version = 1로 세운다. 되돌리기 트리거도 같은 이유(grant 없는 칸)로 definer다.
--
-- ■ 하지 않는 것 ■
--   * 구매 표 · 결산 초안 없음(0059 취소 · 0060 뒤). loaded_table은 'documents' 하나 — 0060이 'statement_drafts'를 더한다.
--     kind는 다섯(statement · price_list · contract · official_letter · other)을 그대로 받는다 — AI가 «무엇으로 보이는가»는 말하되,
--     이 블록에서 적재는 문서뿐이다(재무제표 · 단가표는 «그냥 보관(문서)» 또는 보관만).
--   * Storage 객체 삭제 정책(0050 attachments_objects_delete)은 건드리지 않았다 — 문서로 적재된 원본의 객체를 올린 사람이 지우는 길은
--     0045부터의 모든 첨부와 같다(DEFERRED).
--   * 앱 화면 · 읽기 · 분류 프롬프트 · 배합비 감지는 다음 블록이다.
--
-- 0035 규칙: force를 새로 걸지 않는다(자물쇠는 revoke) · 0001~0057을 고치지 않는다(함수는 create or replace, 정책은
-- drop + create, 제약은 drop + 다시) · 새 audit_action 값 없음(create · update · upload · ai_external_send) · service_role 없음.
-- DB가 적는 사용자 문구는 «대표»다(0049 · CLAUDE.md 직원 화면 용어 원칙).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. intake_items — 입구 줄
-- =====================================================================
create table intake_items (
  item_id            text primary key default ('itk_' || replace(gen_random_uuid()::text, '-', '')), -- [일반] 경로 조각이 된다
  business_id        text not null references businesses(business_id) on delete restrict,         -- [일반]
  -- 원본 하나 = 줄 하나. 입구 줄과 첨부 줄이 서로를 가리키므로 커밋 때 잰다(intake_begin이 한 트랜잭션에 둘 다 넣는다).
  -- 첨부가 지워지면(올린 사람 · 회장 — 감사 delete_request) 입구 줄도 같이 간다. 적재된 원본은 못 지운다(3절).
  attachment_id      uuid not null unique references attachments(attachment_id)
                       on delete cascade deferrable initially deferred,                                -- [일반]
  security_class     security_class not null default 'Restricted',                                    -- [일반] 첨부와 같은 값
  status             text not null default 'uploaded',                                                -- [일반]
  no_ai_reason       text,                                                                            -- [일반]
  -- AI 차단 — no_ai에 들어갈 때 이유가 복사되고, 대표가 직접 풀 때만 지워진다. 적재 · 되돌리기를 지나도 남는다(리뷰 I1).
  ai_blocked_reason  text,                                                                            -- [일반]
  mix_attested_by    uuid,                                                                            -- [제한] 사진 · 스캔본 «배합비 아님»
  mix_attested_at    timestamptz,                                                                     -- [일반]
  proposal           jsonb,                                                                           -- [등급 그대로] AI 제안 — 결정 아님
  proposal_history   jsonb not null default '[]'::jsonb,                                              -- [등급 그대로] 바뀐 제안들
  kind               text,                                                                            -- [일반] 사람이 확인한 종류
  kind_confirmed_by  uuid,                                                                            -- [제한]
  kind_confirmed_at  timestamptz,                                                                     -- [일반]
  loaded_table       text,                                                                            -- [일반]
  loaded_id          text,                                                                            -- [일반]
  loaded_by          uuid,                                                                            -- [제한]
  loaded_at          timestamptz,                                                                     -- [일반]
  file_sha256        text,                                                                            -- [일반] 같은 파일 알림
  created_by         uuid not null default auth.uid(),                                                -- [제한]
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint intake_items_id_check check (item_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- Vault는 입구로 받지 않는다 — 파일 자체를 받지 않는 등급이다(문서 › 링크로 등록, 0047).
  constraint intake_items_class_check check (security_class::text in ('Normal', 'Restricted')),
  constraint intake_items_status_check check (status in
    ('uploaded', 'reading', 'proposed', 'no_ai', 'failed', 'loaded', 'kept', 'discarded')),
  constraint intake_items_no_ai_check check (
    (no_ai_reason is null or no_ai_reason in ('mix_ratio', 'excluded_entity', 'not_attested'))
    and (status <> 'no_ai' or no_ai_reason is not null)
    and (ai_blocked_reason is null or ai_blocked_reason in ('mix_ratio', 'excluded_entity', 'not_attested'))
    and (status <> 'no_ai' or ai_blocked_reason is not null)
  ),
  constraint intake_items_mix_check check ((mix_attested_at is null) = (mix_attested_by is null)),
  constraint intake_items_proposal_check check (proposal is null or jsonb_typeof(proposal) = 'object'),
  constraint intake_items_history_check check (jsonb_typeof(proposal_history) = 'array'),
  constraint intake_items_kind_check check (kind is null or kind in ('statement', 'price_list', 'contract', 'official_letter', 'other')),
  constraint intake_items_kind_confirmed_check check (kind is not null or (kind_confirmed_by is null and kind_confirmed_at is null)),
  -- 이 블록의 적재 대상은 문서 하나. 0060이 'statement_drafts'(결산 초안)를 더한다.
  constraint intake_items_loaded_table_check check (loaded_table is null or loaded_table in ('documents')),
  -- «적재됨»은 적재 칸이 다 찼을 때만이고, 거꾸로도 같다. 적재 칸에는 grant가 없어서 이 줄이 «적재는 RPC로만»을 만든다.
  constraint intake_items_loaded_check check (
    (status = 'loaded') = (loaded_table is not null)
    and (loaded_table is null) = (loaded_id is null)
    and (loaded_table is null) = (loaded_at is null)
  ),
  constraint intake_items_sha_check check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$')
);

-- 한 대상 줄(문서)은 한 입구 줄에서만 온다. 입구 줄 하나에는 적재 칸이 한 벌뿐이라 «활성 적재 하나»는 줄 모양이 이미 지킨다.
create unique index intake_items_loaded_once on intake_items (loaded_table, loaded_id) where loaded_table is not null;
create index intake_items_by_business on intake_items (business_id, created_at desc);
create index intake_items_by_sha on intake_items (business_id, file_sha256) where file_sha256 is not null;

comment on table intake_items is
  '0058. 자료 받는 입구 — 원본 파일(첨부, entity intake_items) 하나 = 줄 하나. AI 제안(proposal)은 결정이 아니다. 적재는 intake_move_to_document만.';
comment on column intake_items.proposal is '0058. AI 제안(kind · confidence · reason · 뽑은 값). «AI 제안 — 결정 아님». 원문은 저장하지 않는다(0045).';
comment on column intake_items.proposal_history is '0058. 바뀐 제안들(트리거가 덧붙인다 — 앱에 grant 없음). 오분류 교정 기록.';
comment on column intake_items.security_class is '0058. 첨부와 같은 등급(일반 · 제한). 읽기 판정이 첨부 줄을 읽지 않게 여기에도 둔다.';

/** 입구 줄을 고칠 수 있는가 — 종류 확인 권한자. 지금 적재 대상은 문서뿐이라 종류와 무관하게 0048 문서 쓰기다. */
create or replace function intake_can_confirm(p_business text, p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  -- p_kind: 0060이 'statement' → can_keep_books(p_business)를 더한다. 지금은 모든 종류가 문서로만 들어간다.
  select is_active()
     and coalesce(auth_role()::text, '') not in ('AIAgent', 'Integration')
     and can_write_documents(p_business);
$fn$;

/** 입구 줄을 고칠 수 있는가 — 올린 사람 · 확인 권한자 · 회장(설계서 A3 «종류 바꾸기 · 다시 읽기»). 회사 범위는 늘 건다. */
create or replace function intake_can_edit(p_business text, p_created_by uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select is_active() and has_business(p_business) and (
    p_created_by = auth.uid()
    or auth_role()::text = 'Chairman'
    or intake_can_confirm(p_business, p_kind)
  );
$fn$;

comment on function intake_can_confirm(text, text) is '0058. 입구 종류 확인 권한 — 지금은 0048 can_write_documents(문서 적재뿐). 0060이 결산 갈래를 더한다.';
comment on function intake_can_edit(text, uuid, text) is '0058. 입구 줄 고치기 — 회사 범위 AND (올린 사람 · 회장 · intake_can_confirm).';

-- 믿지 않는 칸은 DB가 적는다.
create or replace function intake_items_stamp() returns trigger
language plpgsql set search_path = public, pg_temp as $fn$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.updated_at := now();
    -- 처음부터 «제안» · «적재됨» · «확인됨»으로 넣는 길을 닫는다.
    new.status := 'uploaded';
    new.no_ai_reason := null;
    new.ai_blocked_reason := null;
    new.proposal := null;
    new.proposal_history := '[]'::jsonb;
    new.kind := null;
    new.kind_confirmed_by := null;
    new.kind_confirmed_at := null;
    new.loaded_table := null;
    new.loaded_id := null;
    new.loaded_by := null;
    new.loaded_at := null;
    -- 올릴 때 «배합비 아님»을 눌렀으면 도장은 올린 사람 · 지금이다.
    if new.mix_attested_at is not null then
      new.mix_attested_by := new.created_by;
      new.mix_attested_at := now();
    else
      new.mix_attested_by := null;
    end if;
    return new;
  end if;

  -- 한 번 정해지면 그대로인 칸. 칸 grant가 이미 막지만 소유자 권한 함수의 실수까지 막는다.
  if new.item_id is distinct from old.item_id
     or new.business_id is distinct from old.business_id
     or new.attachment_id is distinct from old.attachment_id
     or new.security_class is distinct from old.security_class
     or new.file_sha256 is distinct from old.file_sha256
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'intake_item_immutable' using errcode = '42501';
  end if;
  new.updated_at := now();

  -- 적재된 줄은 되돌리기 전까지 얼린다(종류 · 제안 · AI 제외 · 확인).
  if old.status = 'loaded' and new.status = 'loaded' and (
       new.kind is distinct from old.kind or new.proposal is distinct from old.proposal
       or new.no_ai_reason is distinct from old.no_ai_reason or new.mix_attested_at is distinct from old.mix_attested_at) then
    raise exception 'intake_loaded_locked' using errcode = '55000',
      detail = '적재된 입구 줄은 문서를 지워(되돌려) 입구로 돌린 뒤에 고친다.';
  end if;

  -- «업로드됨»으로 되돌아가는 길은 없다 — 되돌리면 0045의 한 시간 재업로드 창이 다시 열린다(리뷰 M1).
  if new.status = 'uploaded' and old.status is distinct from 'uploaded' then
    raise exception 'intake_status_back_to_uploaded' using errcode = '42501';
  end if;

  -- AI 차단은 끈적하다(리뷰 I1). no_ai에서 나가거나 이유를 바꾸는 것은 대표만 — 이유가 무엇이든(배합비는 F3 권장).
  -- 세션 없는 수정(SQL 편집기 · 마이그레이션)은 막지 않는다. 차단 칸은 grant가 없고 여기서만 바뀐다.
  new.ai_blocked_reason := old.ai_blocked_reason;
  if old.status = 'no_ai' and (new.status is distinct from 'no_ai' or new.no_ai_reason is distinct from old.no_ai_reason) then
    if auth.uid() is not null and coalesce(auth_role()::text, '') <> 'Chairman' then
      raise exception 'intake_ai_unblock_forbidden' using errcode = '42501',
        detail = '«AI 안 보냄»으로 막힌 입구 줄은 대표만 풀 수 있다(0058 리뷰 I1 · 설계서 F3).';
    end if;
    if new.status = 'no_ai' then
      new.ai_blocked_reason := new.no_ai_reason;      -- 대표가 이유를 바꿨다
    elsif new.status <> 'loaded' then
      new.ai_blocked_reason := null;                  -- 대표가 직접 풀었다. 적재(loaded)는 풀기가 아니다 — 차단이 남는다.
    end if;
  end if;
  if new.status = 'no_ai' and old.status is distinct from 'no_ai' then
    new.ai_blocked_reason := new.no_ai_reason;
  end if;
  if new.status <> 'no_ai' then
    new.no_ai_reason := null;
  end if;

  -- 사진 · 스캔본의 «배합비 아님» 확인은 올린 사람만(F3 · F4). 도장은 DB가 찍는다.
  if new.mix_attested_at is distinct from old.mix_attested_at then
    if new.mix_attested_at is not null then
      if auth.uid() is not null and auth.uid() is distinct from old.created_by then
        raise exception 'intake_mix_attest_uploader_only' using errcode = '42501',
          detail = '«배합비 · 레시피가 아닙니다» 확인은 파일을 올린 사람만 누른다(설계서 F3).';
      end if;
      new.mix_attested_by := coalesce(auth.uid(), old.created_by);
      new.mix_attested_at := now();
    else
      new.mix_attested_by := null;
    end if;
  else
    new.mix_attested_by := old.mix_attested_by;
  end if;

  -- 종류 확인 도장 — 누가 · 언제 «이 종류»라고 했나.
  if new.kind is distinct from old.kind then
    new.kind_confirmed_by := case when new.kind is null then null else auth.uid() end;
    new.kind_confirmed_at := case when new.kind is null then null else now() end;
  else
    new.kind_confirmed_by := old.kind_confirmed_by;
    new.kind_confirmed_at := old.kind_confirmed_at;
  end if;

  -- 제안 이력은 DB만 쓴다 — 제안이 바뀌면 옛 제안을 덧붙인다(무엇을 틀렸는지가 다음 프롬프트 손질 재료다).
  new.proposal_history := old.proposal_history;
  if new.proposal is distinct from old.proposal and old.proposal is not null then
    new.proposal_history := old.proposal_history || jsonb_build_array(jsonb_build_object(
      'proposal', old.proposal, 'kind', old.kind, 'replaced_at', now(), 'replaced_by', auth.uid()));
  end if;
  return new;
end;
$fn$;

create trigger intake_items_stamp_trigger
  before insert or update on intake_items
  for each row execute function intake_items_stamp();

-- 감사 — 종류 바꾸기 · AI 제외 · 배합비 확인 · 차단 풀기(설계서 A4). 제안 자체는 감사하지 않는다(효력 없음).
-- 적재 · 되돌리기는 그 함수가 같은 트랜잭션에서 따로 적는다.
create or replace function intake_items_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_notes text[] := '{}';
  n text;
begin
  if new.kind is distinct from old.kind then
    v_notes := v_notes || case when old.kind is null then '입구 종류 확인' else '입구 종류 바꿈' end;
  end if;
  if new.status = 'no_ai' and (old.status is distinct from 'no_ai' or old.no_ai_reason is distinct from new.no_ai_reason) then
    v_notes := v_notes || ('AI 제외 — ' || case new.no_ai_reason
      when 'mix_ratio' then '배합비로 보임'
      when 'excluded_entity' then 'AI 제외 자료'
      else '«배합비 아님» 확인 없음' end);
  end if;
  if old.ai_blocked_reason is not null and new.ai_blocked_reason is null then
    v_notes := v_notes || case old.ai_blocked_reason when 'mix_ratio' then '배합비 차단 풀림 — 대표 확인' else 'AI 제외 풀림 — 대표 확인' end;
  end if;
  if new.mix_attested_at is not null and old.mix_attested_at is null then
    v_notes := v_notes || '«배합비 · 레시피 아님» 확인 — 올린 사람'::text;
  end if;
  foreach n in array v_notes loop
    insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
    values ('update', 'intake_items', new.item_id, new.business_id, auth.uid(), auth_role()::text,
            jsonb_build_object('status', old.status, 'kind', old.kind, 'no_ai_reason', old.no_ai_reason),
            jsonb_build_object('status', new.status, 'kind', new.kind, 'no_ai_reason', new.no_ai_reason),
            n);
  end loop;
  return null;
end;
$fn$;

create trigger intake_items_audit_trigger
  after update on intake_items
  for each row execute function intake_items_audit();

-- 커밋 때 — 입구 줄의 첨부가 정말 이 줄에 붙은 그 파일인가(같은 회사 · 같은 등급). 남의 첨부 id를 적어 넣는 길을 닫는다.
-- definer: 첨부 줄을 호출자 권한과 무관하게 본다(거부만 한다 — 아무것도 돌려주지 않는다).
create or replace function intake_items_link_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v intake_items;
begin
  select * into v from intake_items where item_id = new.item_id;
  if not found then
    return null;   -- 첨부가 지워져 같이 갔다(cascade) — 볼 것이 없다.
  end if;
  if not exists (
    select 1 from attachments a
     where a.attachment_id = v.attachment_id
       and a.security_class = v.security_class
       and a.business_id is not distinct from v.business_id
       and ((a.entity_table = 'intake_items' and a.entity_id = v.item_id)
            or (v.loaded_table is not null and a.entity_table = v.loaded_table and a.entity_id = v.loaded_id))
  ) then
    raise exception 'intake_attachment_missing' using errcode = '23514',
      detail = '입구 줄의 첨부가 없거나 이 줄에 붙은 파일이 아니다(intake_begin으로 만든다).';
  end if;
  return null;
end;
$fn$;

create constraint trigger intake_items_link_check
  after insert on intake_items
  deferrable initially deferred
  for each row execute function intake_items_link_check();

-- =====================================================================
-- 2절. RLS
-- =====================================================================
alter table intake_items enable row level security;

-- 자물쇠는 revoke(0035). Supabase는 새 표를 만들자마자 anon/authenticated에 연다.
revoke all on table intake_items from anon, authenticated;
grant select, insert on table intake_items to authenticated;
-- 칸 단위 update — 읽기 · 제안 · 분류 · AI 제외 · 확인. 적재 칸 · 도장 · 이력 · 회사 · 등급 · 파일은 열지 않는다.
grant update (status, no_ai_reason, mix_attested_at, proposal, kind) on table intake_items to authenticated;

revoke all on function intake_can_confirm(text, text) from public, anon;
revoke all on function intake_can_edit(text, uuid, text) from public, anon;
grant execute on function intake_can_confirm(text, text) to authenticated;
grant execute on function intake_can_edit(text, uuid, text) to authenticated;
revoke all on function intake_items_link_check() from public, anon, authenticated;
revoke all on function intake_items_audit() from public, anon, authenticated;

-- 읽기 = 회사 AND 등급(첨부와 같은 잣대 — 0045 attachment_class_ok. Integration은 거기서 떨어진다).
-- 적재된 줄(제안 = AI가 뽑은 값 · loaded_id)은 그 문서가 보이는 사람 · 올린 사람 · 회장만(리뷰 I4) — 문서는 0026 subtree로
-- 좁은데 입구 줄이 회사 전체에 열려 있으면 문서 내용이 제안 칸으로 샌다. attachment_entity_visible은 invoker라 문서 표의
-- RLS(documents_read)가 판정한다.
create policy intake_items_read on intake_items for select
  using (
    has_business(business_id) and attachment_class_ok(attachment_id, security_class)
    and (
      status <> 'loaded'
      or created_by = auth.uid()
      or auth_role()::text = 'Chairman'
      or attachment_entity_visible(loaded_table, loaded_id)
    )
  );

-- 넣기 = 본인 이름 · 보이는 회사 · 볼 수 있는 등급. with check는 before 트리거 뒤의 줄을 본다(created_by = auth.uid()).
create policy intake_items_insert on intake_items for insert
  with check (
    created_by = auth.uid()
    and has_business(business_id)
    and attachment_class_ok(attachment_id, security_class)
  );

-- 고치기 = 올린 사람 · 확인 권한자 · 회장. using은 옛 종류, with check는 새 종류로 잰다.
create policy intake_items_update on intake_items for update
  using (intake_can_edit(business_id, created_by, kind) and attachment_class_ok(attachment_id, security_class))
  with check (intake_can_edit(business_id, created_by, kind) and attachment_class_ok(attachment_id, security_class));

-- 지우기 정책은 없다(grant도 없다). 원본 첨부를 지우면 줄이 같이 간다(FK cascade, 첨부 삭제는 감사에 남는다).

-- AI Agent와 Integration은 입구에 쓰지 않는다 — 0045와 같은 세 짝 이름(check-migrations가 카탈로그에서 잰다).
do $$
declare
  t text := 'intake_items';
begin
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
end
$$;

-- =====================================================================
-- 3절. 첨부 대상에 intake_items — 0050판 위에 한 case씩
-- =====================================================================
alter table attachments drop constraint attachments_entity_check;
alter table attachments add constraint attachments_entity_check
  check (entity_table in ('initiatives', 'businesses', 'documents', 'decisions', 'finance_imports', 'intake_items'));

-- 경로는 «처음 올린 자리»로 고정한다(머리 주석 3절). 값은 그대로 남고, 새 줄은 stamp가 같은 식으로 적는다.
alter table attachments alter column storage_path drop expression;
alter table attachments alter column storage_path set not null;
comment on column attachments.storage_path is
  '0045/0058. 처음 올린 자리 <entity_table>/<entity_id>/<attachment_id>. DB(attachments_stamp)가 insert 때 적고 다시는 안 바뀐다 — 입구 → 문서로 대상이 바뀌어도 객체는 그 자리다.';

-- 0050:285-295 본문 그대로 + intake_items 한 줄. 판정은 intake_items_read(회사 AND 등급)가 한다.
create or replace function attachment_entity_visible(p_table text, p_id text) returns boolean
language sql stable security invoker set search_path = public as $fn$
  select case p_table
    when 'initiatives' then exists (select 1 from public.initiatives where initiative_id = p_id)
    when 'businesses'  then exists (select 1 from public.businesses  where business_id  = p_id)
    when 'documents'   then exists (select 1 from public.documents   where document_id  = p_id)
    when 'decisions'   then exists (select 1 from public.decisions   where decision_id  = p_id)
    when 'finance_imports' then exists (select 1 from public.finance_imports where import_id::text = p_id)
    when 'intake_items' then exists (select 1 from public.intake_items where item_id = p_id)
    else false
  end;
$fn$;

comment on function attachment_entity_visible(text, text) is '0045/0050/0058. 첨부가 붙은 대상이 호출자에게 보이는가(security invoker — 대상 표의 RLS가 판정). 0050이 finance_imports, 0058이 intake_items를 더했다.';

-- 0050:300-337 본문 그대로 + 회사 case에 intake_items 한 줄 + storage_path(생성 칸이던 식 그대로, insert 때만).
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
      when 'finance_imports' then (select business_id from finance_imports where import_id::text = new.entity_id)
      when 'intake_items' then (select business_id from intake_items where item_id = new.entity_id)
    end;
    -- 0058: 경로는 DB가 만든다(0045 생성 칸과 같은 식). 화면이 보낸 값은 덮는다.
    new.storage_path := new.entity_table || '/' || new.entity_id || '/' || new.attachment_id::text;
  else
    if new.ai_summary is distinct from old.ai_summary then
      new.summarized_at := case when new.ai_summary is null then null else now() end;
    end if;
    -- 0058: 경로는 처음 자리 그대로(대상이 입구 → 문서로 바뀌어도).
    new.storage_path := old.storage_path;
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

-- 입구 원본은 그 입구 줄을 만든 본인만, 그 줄이 적어 둔 첨부 id · 등급으로, 아직 읽기 전에만 올린다.
-- 다른 대상의 첨부에는 걸리지 않는다(0050 attachments_finance_import_owner와 같은 모양).
drop policy if exists attachments_intake_owner on attachments;
create policy attachments_intake_owner on attachments as restrictive for insert
  with check (
    entity_table <> 'intake_items'
    or exists (
      select 1 from intake_items i
       where i.item_id = attachments.entity_id
         and i.attachment_id = attachments.attachment_id
         and i.security_class = attachments.security_class
         and i.created_by = auth.uid()
         and i.status = 'uploaded'
    )
  );

-- 문서로 적재된 입구 원본은 지우지 못한다 — 문서를 지워(되돌려) 입구로 돌린 뒤에 지운다.
-- definer: 입구 줄을 호출자 권한과 무관하게 본다. 돌려주는 것은 «그 첨부가 적재 중인가» 한 비트다.
create or replace function intake_attachment_loaded(p_attachment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from intake_items where attachment_id = p_attachment and status = 'loaded');
$fn$;

comment on function intake_attachment_loaded(uuid) is '0058. 이 첨부가 입구에서 문서로 적재 중인가. 적재된 원본 첨부의 삭제를 막는 restrictive 정책이 부른다.';
revoke all on function intake_attachment_loaded(uuid) from public, anon;
grant execute on function intake_attachment_loaded(uuid) to authenticated;

drop policy if exists attachments_intake_loaded_delete on attachments;
create policy attachments_intake_loaded_delete on attachments as restrictive for delete
  using (not intake_attachment_loaded(attachment_id));

-- 대상 재지정은 두 길만 — 입구 → 문서(적재) · 문서 → 입구(되돌리기). 그 밖의 entity 변경은 전부 거부.
-- authenticated에게 그 칸 grant가 원래 없으므로(0045) 이 트리거를 지나는 것은 소유자 권한의 이 파일 함수 둘뿐이다.
create or replace function attachments_entity_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.entity_table is not distinct from old.entity_table and new.entity_id is not distinct from old.entity_id then
    return new;
  end if;
  if old.entity_table = 'intake_items' and new.entity_table = 'documents' and exists (
       select 1 from intake_items i
        where i.attachment_id = old.attachment_id and i.item_id = old.entity_id and i.status <> 'loaded') then
    return new;
  end if;
  if old.entity_table = 'documents' and new.entity_table = 'intake_items' and exists (
       select 1 from intake_items i
        where i.attachment_id = old.attachment_id and i.item_id = new.entity_id
          and i.status = 'loaded' and i.loaded_table = 'documents' and i.loaded_id = old.entity_id) then
    return new;
  end if;
  raise exception 'attachment_entity_change_forbidden' using errcode = '42501',
    detail = '첨부의 대상은 입구 → 문서(적재)와 그 되돌리기로만 바뀐다(0058).';
end;
$fn$;

revoke all on function attachments_entity_guard() from public, anon, authenticated;

drop trigger if exists attachments_entity_guard_trigger on attachments;
create trigger attachments_entity_guard_trigger
  before update of entity_table, entity_id on attachments
  for each row execute function attachments_entity_guard();

-- 0050:381-398 본문 그대로 + 입구 조건 한 줄. 0051~0057은 이 함수를 다시 정의하지 않았다.
create or replace function attachment_object_uploadable(object_name text) returns boolean
language plpgsql stable security invoker set search_path = public as $fn$
begin
  if auth.uid() is null or not public.is_active() then
    return false;
  end if;
  -- 올리는 창은 **요약 전 · 한 시간 안**뿐이다. 요약이 선 뒤에 파일을 지우고 다른 바이트를 같은 경로에
  -- 올리면 요약 · 감사가 다른 파일을 말하게 된다(0045 리뷰 Important 2 — «원본은 덮어쓰지 않는다»).
  return exists (
    select 1 from public.attachments a
     where a.storage_path = object_name
       and a.uploaded_by = auth.uid()
       and a.status::text in ('uploaded', 'skipped_vault')
       and a.created_at > now() - interval '1 hour'
       and (a.entity_table <> 'finance_imports' or public.finance_import_is_draft(a.entity_id))
       -- 0058: 입구 원본은 읽기 전(uploaded)에만 — 읽고 제안이 선 뒤에 바이트를 바꾸지 못한다.
       and not exists (select 1 from public.intake_items i where i.attachment_id = a.attachment_id and i.status <> 'uploaded')
  );
end;
$fn$;

-- =====================================================================
-- 4절. AI 제외 대상 — DB 문
--   0045:454-472 본문 그대로 + 맨 앞에 제외 검사 둘. 0046~0057은 이 함수를 다시 정의하지 않았다.
-- =====================================================================
/** 이 첨부가 입구 원본이고 AI로 못 가는가 — 차단 · no_ai · 확인 없는 사진. definer: 입구 줄의 RLS와 무관하게(돌려주는 것은 한 비트). */
create or replace function intake_ai_blocked(p_attachment uuid, p_mime text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1 from intake_items i
     where i.attachment_id = p_attachment
       and (i.ai_blocked_reason is not null or i.status = 'no_ai'
            or (coalesce(p_mime, '') like 'image/%' and i.mix_attested_at is null))
  );
$fn$;

comment on function intake_ai_blocked(uuid, text) is '0058. 입구 원본의 AI 차단(끈적) · no_ai · 확인 없는 사진. record_attachment_ai_send가 부른다.';
revoke all on function intake_ai_blocked(uuid, text) from public, anon;
grant execute on function intake_ai_blocked(uuid, text) to authenticated;

create or replace function record_attachment_ai_send(p_id uuid, p_model text) returns boolean
language plpgsql volatile security invoker set search_path = public as $fn$
declare
  a attachments;
begin
  select * into a from attachments where attachment_id = p_id;
  if not found then
    return false;
  end if;
  -- 0058: 제외 대상 — 등급과 무관하게 AI로 보내지 않는다(설계서 A5-2). 무엇을 적기 전에 던진다 —
  --   감사 줄이 없으면 읽기 통행증(attachment_recent_pass)도 없어서 Storage가 파일을 내주지 않는다.
  if a.entity_table in (
       'finance_imports'          -- 0050 ECOUNT 업로드 원본
       -- , 'journal_entries'     -- ← 0057 전표 증빙(DEFERRED «전표 증빙 — 0057 제안»)이 서면 그 대상을 여기 한 줄
     ) then
    raise exception 'ai_excluded' using errcode = '42501',
      detail = 'AI 제외 자료(ECOUNT 업로드 원본 · 전표 증빙)는 외부 AI로 보내지 않는다(0058).';
  end if;
  -- 0058: 입구 원본 — AI 차단(끈적 — 적재 · 되돌리기를 지나도)이거나 «AI 안 보냄»이거나, 사진인데 올린 사람의 «배합비 아님»
  --   확인이 없으면 보내지 않는다(F4). 입구 줄은 RLS와 무관하게 잰다(intake_ai_blocked — 적재된 줄은 보이는 사람이 좁다).
  if public.intake_ai_blocked(a.attachment_id, a.mime) then
    raise exception 'ai_excluded' using errcode = '42501',
      detail = '입구 원본이 AI 제외 상태이거나 사진에 «배합비 아님» 확인이 없다(0058 · 설계서 A5).';
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

comment on function record_attachment_ai_send(uuid, text) is
  '0045/0058. «외부 AI 전송» 감사 한 줄 — 모델을 부르기 전에. Vault · AI 제외 대상(finance_imports, 0057 전표 증빙 자리) · 입구의 AI 차단 / AI 안 보냄 / 확인 없는 사진은 42501. 제3자는 이 줄 없이 파일을 못 열지만 올린 사람 · 회장은 통행증 없이 연다(0045) — 그 둘에게는 앱의 호출 순서가 문이다.';

-- =====================================================================
-- 5절. 입구 만들기 · 문서로 적재 · 되돌리기 · 같은 파일
-- =====================================================================

/**
 * 입구 줄 + 원본 첨부 줄을 한 트랜잭션으로. **security invoker** — 위 insert 정책 둘(입구 · 첨부 + 입구 본인 restrictive)을
 * 호출자 권한으로 지난다. 돌려준 storage_path로 브라우저가 Storage에 직접 올린다(0045와 같은 길).
 */
create or replace function intake_begin(
  p_business     text,
  p_class        security_class,
  p_file_name    text,
  p_mime         text,
  p_size         bigint,
  p_sha256       text default null,
  p_mix_attested boolean default false
) returns table (item_id text, attachment_id uuid, storage_path text)
language plpgsql volatile security invoker set search_path = public as $fn$
#variable_conflict use_column
declare
  v_item text := 'itk_' || replace(gen_random_uuid()::text, '-', '');
  v_att  uuid := gen_random_uuid();
  v_path text;
begin
  insert into intake_items (item_id, business_id, attachment_id, security_class, file_sha256, mix_attested_at)
  values (v_item, p_business, v_att, p_class, nullif(lower(p_sha256), ''), case when p_mix_attested then now() end);
  insert into attachments (attachment_id, entity_table, entity_id, file_name, mime, size_bytes, security_class)
  values (v_att, 'intake_items', v_item, p_file_name, p_mime, p_size, p_class)
  returning attachments.storage_path into v_path;
  return query select v_item, v_att, v_path;
end;
$fn$;

comment on function intake_begin(text, security_class, text, text, bigint, text, boolean) is
  '0058. 입구 줄 + 원본 첨부 줄(entity intake_items)을 한 트랜잭션으로. security invoker. 돌려준 경로로 Storage에 올린다.';

/** 역할 이름 — 감사 메모용. 회장은 «대표»(0049). */
create or replace function intake_role_label() returns text
language sql stable security definer set search_path = public, pg_temp as $fn$
  select case auth_role()::text
    when 'Chairman' then '대표' when 'GroupCFO' then '그룹 CFO' when 'BusinessCEO' then '대표이사'
    when 'Executive' then '임원' when 'TeamLead' then '팀장' when 'Member' then '직원'
    else coalesce(auth_role()::text, '시스템') end;
$fn$;

revoke all on function intake_role_label() from public, anon, authenticated;

/**
 * 이 문서가 **호출자에게** 보이는가 — 0026 documents_read(2-5)와 같은 식 + 0042 soft delete 숨김. definer 함수 안에서 호출자 기준
 * 가시성을 재려고 둔다(definer 안에서는 역할을 바꿔 RLS를 탈 수 없다). documents_read를 바꾸는 마이그레이션은 이 함수도 같이 고친다.
 */
create or replace function intake_doc_readable(p_doc text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1 from documents d
     where d.document_id = p_doc
       and d.deleted_at is null
       and has_business(d.business_id)
       and class_rank(d.security_class) <= class_rank(max_class())
       and (
         d.owner_user_id = auth.uid()
         or d.uploaded_by = auth.uid()
         or in_my_subtree(d.owner_user_id)
         or in_my_subtree(d.uploaded_by)
         or shared_with_me('documents', d.document_id)
         or d.security_class::text = 'Public'
         or (owner_unknown(d.owner_user_id) and owner_unknown(d.uploaded_by))
       )
  );
$fn$;

comment on function intake_doc_readable(text) is '0058. 호출자가 이 문서를 보는가(0026 documents_read와 같은 식 + soft delete). 적재 함수가 판 사슬 후보를 거르는 데 쓴다.';
revoke all on function intake_doc_readable(text) from public, anon, authenticated;

/**
 * 확인 → 문서. 한 트랜잭션: documents 한 줄 · 원본 첨부를 그 문서로 · 입구 줄 loaded · 감사 둘.
 * **security definer**(머리 주석 «왜 적재 함수가 security definer인가») — 호출자 판정은 전부 여기 적는다.
 * 돌려주는 것은 새 document_id. 되돌리기는 그 문서의 soft delete(아래 트리거).
 */
create or replace function intake_move_to_document(
  p_item      text,
  p_title     text,
  p_doc_type  text default '기타',
  p_folder_id bigint default null,
  p_tags      text[] default '{}'
) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  v       intake_items;
  a       attachments;
  v_doc   text;
  v_title text := btrim(coalesce(p_title, ''));
  v_type  text := coalesce(nullif(btrim(coalesce(p_doc_type, '')), ''), '기타');
  v_label text;
  v_prev  text;
begin
  if auth.uid() is null or not is_active() or coalesce(auth_role()::text, '') in ('AIAgent', 'Integration') then
    raise exception 'intake_forbidden' using errcode = '42501';
  end if;

  -- 줄 잠금 — 같은 줄을 둘이 동시에 적재하면 뒤 사람은 앞 사람의 'loaded'를 본다.
  select * into v from intake_items where item_id = p_item for update;
  -- 소유자 권한이라 RLS가 안 걸린다 — 보이는가를 직접 잰다(intake_items_read와 같은 식). 못 보는 줄은 «없음»이다.
  if not found or not (has_business(v.business_id) and attachment_class_ok(v.attachment_id, v.security_class)) then
    raise exception 'intake_not_found' using errcode = '42501';
  end if;
  if v.status = 'loaded' then
    raise exception 'intake_already_loaded' using errcode = '23505',
      detail = format('이미 %s에 문서 %s로 넣은 입구 줄이다.', to_char(v.loaded_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'), v.loaded_id);
  end if;
  if v.status in ('reading', 'discarded') then
    raise exception 'intake_not_ready' using errcode = '55000';
  end if;
  -- AI 차단 줄(no_ai)은 대표만 적재한다(리뷰 I1). 적재해도 차단은 남는다(ai_blocked_reason).
  if v.status = 'no_ai' and coalesce(auth_role()::text, '') <> 'Chairman' then
    raise exception 'intake_ai_blocked' using errcode = '42501',
      detail = '«AI 안 보냄»으로 막힌 입구 줄은 대표만 문서로 넣는다.';
  end if;
  if v.kind is null then
    raise exception 'intake_kind_missing' using errcode = '23514',
      detail = '종류를 먼저 확인한다(AI 제안을 받아들이거나 직접 고른다).';
  end if;
  -- 문서 쓰기(0048) — 회사 범위 AND (회장 · 옛 전역 줄 · 그 회사 문서 줄). 등급은 내 열람 등급 이하.
  if not can_write_documents(v.business_id) or class_rank(v.security_class) > class_rank(max_class()) then
    raise exception 'intake_document_write_forbidden' using errcode = '42501',
      detail = '이 회사 문서를 등록할 권한이 없다(0048 «문서 등록» 줄).';
  end if;
  if length(v_title) not between 1 and 300 then
    raise exception 'intake_title_invalid' using errcode = '23514';
  end if;

  select * into a from attachments where attachment_id = v.attachment_id for update;
  if not found or a.entity_table <> 'intake_items' or a.entity_id <> v.item_id then
    raise exception 'intake_attachment_missing' using errcode = '23514';
  end if;

  -- 문서 id는 0007 시퀀스 default와 같은 식으로 먼저 받는다 — 링크 칸이 그 id를 쓴다.
  v_doc := 'doc_' || to_char(nextval('documents_doc_seq'), 'FM000');
  insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by, folder_id, tags)
  values (v_doc, v.business_id, v_title, v_type, v.security_class,
          -- 파일 실체는 이 문서의 첨부다. 링크 칸은 앱 안의 문서 화면(첨부 칸이 있는 곳)을 가리킨다.
          '/documents/' || v_doc,
          auth.uid(), p_folder_id, coalesce(p_tags, '{}'));

  -- 판 사슬(리뷰 I3): 0038 documents_version이 방금 이 문서에 붙인 «직전 판»이 호출자에게 안 보이면 끊는다 —
  -- 소유자 권한(Supabase는 BYPASSRLS)으로 찾은 후보라 남의 · 지운 문서일 수 있다. 보이면 그대로 둔다.
  select supersedes into v_prev from documents where document_id = v_doc;
  if v_prev is not null and not intake_doc_readable(v_prev) then
    update documents set supersedes = null, version = 1 where document_id = v_doc;
  end if;

  update attachments set entity_table = 'documents', entity_id = v_doc where attachment_id = a.attachment_id;
  update intake_items
     set status = 'loaded', loaded_table = 'documents', loaded_id = v_doc, loaded_by = auth.uid(), loaded_at = now()
   where item_id = v.item_id;

  v_label := intake_role_label();
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
  values ('create', 'documents', v_doc, v.business_id, auth.uid(), auth_role()::text,
          jsonb_build_object('title', v_title, 'doc_type', v_type, 'security_class', v.security_class,
                             'storage_url', '/documents/' || v_doc, 'intake_item', v.item_id,
                             'attachment_id', a.attachment_id, 'kind', v.kind,
                             'kind_confirmed_by', v.kind_confirmed_by, 'ai_proposal', v.proposal is not null),
          case when v.proposal is not null
               then format('입구 %s에서 — AI 제안, %s 확인', v.item_id, v_label)
               else format('입구 %s에서 — 사람이 분류, %s 확인', v.item_id, v_label) end);
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'intake_items', v.item_id, v.business_id, auth.uid(), auth_role()::text,
          jsonb_build_object('status', v.status, 'entity', 'intake_items:' || v.item_id),
          jsonb_build_object('status', 'loaded', 'loaded_table', 'documents', 'loaded_id', v_doc, 'entity', 'documents:' || v_doc),
          format('입구 적재 — 문서 %s', v_doc));
  return v_doc;
end;
$fn$;

comment on function intake_move_to_document(text, text, text, bigint, text[]) is
  '0058. 입구 줄 → 문서(한 트랜잭션: 문서 · 첨부 재지정 · 입구 loaded · 감사). security definer — 판정은 함수 안(0048 문서 쓰기 · 회사 · 등급). 되돌리기 = 문서 soft delete.';

revoke all on function intake_begin(text, security_class, text, text, bigint, text, boolean) from public, anon;
revoke all on function intake_move_to_document(text, text, text, bigint, text[]) from public, anon;
grant execute on function intake_begin(text, security_class, text, text, bigint, text, boolean) to authenticated;
grant execute on function intake_move_to_document(text, text, text, bigint, text[]) to authenticated;

/**
 * 되돌리기 — 입구에서 온 문서가 soft delete되면(0042 soft_delete · 0048 고치기 규칙 = 적재한 사람 · 회장) 원본 첨부를 입구 줄로
 * 돌리고 상태를 'proposed'로. 종류를 바꿔 다시 넣을 수 있다. 문서 줄은 지운 채로 남는다(감사에 둘 다).
 * definer: 첨부 대상 칸 · 적재 칸은 호출자에게 grant가 없다. 문서 update가 이미 호출자 정책을 지난 뒤에만 돈다.
 */
create or replace function intake_document_unload() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v intake_items;
begin
  if new.deleted_at is null or old.deleted_at is not null then
    return null;
  end if;
  select * into v from intake_items where loaded_table = 'documents' and loaded_id = new.document_id for update;
  if not found then
    return null;
  end if;
  update attachments set entity_table = 'intake_items', entity_id = v.item_id
   where attachment_id = v.attachment_id and entity_table = 'documents' and entity_id = new.document_id;
  -- AI 차단 줄은 no_ai(같은 이유)로, 아닌 줄은 proposed로(리뷰 I1).
  update intake_items
     set status = case when v.ai_blocked_reason is not null then 'no_ai' else 'proposed' end,
         no_ai_reason = v.ai_blocked_reason,
         loaded_table = null, loaded_id = null, loaded_by = null, loaded_at = null
   where item_id = v.item_id;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'intake_items', v.item_id, v.business_id, auth.uid(), auth_role()::text,
          jsonb_build_object('status', 'loaded', 'loaded_table', 'documents', 'loaded_id', new.document_id),
          jsonb_build_object('status', case when v.ai_blocked_reason is not null then 'no_ai' else 'proposed' end,
                             'ai_blocked_reason', v.ai_blocked_reason, 'entity', 'intake_items:' || v.item_id),
          format('입구 %s로 되돌림 — 문서 %s 지움', v.item_id, new.document_id));
  return null;
end;
$fn$;

revoke all on function intake_document_unload() from public, anon, authenticated;

drop trigger if exists documents_intake_unload on documents;
create trigger documents_intake_unload
  after update of deleted_at on documents
  for each row execute function intake_document_unload();

/** 같은 파일(sha256)이 이 회사 입구에 또 있는가 — «이미 ‹날짜›에 ‹메뉴›로 넣은 파일입니다». 막지 않고 알린다. invoker(보이는 줄만). */
create or replace function intake_same_file(p_item text)
returns table (item_id text, status text, loaded_table text, loaded_id text, loaded_at timestamptz, created_at timestamptz)
language sql stable security invoker set search_path = public as $fn$
  select o.item_id, o.status, o.loaded_table, o.loaded_id, o.loaded_at, o.created_at
    from public.intake_items me
    join public.intake_items o
      on o.business_id = me.business_id and o.file_sha256 = me.file_sha256 and o.item_id <> me.item_id
   where me.item_id = p_item and me.file_sha256 is not null
   order by o.created_at;
$fn$;

comment on function intake_same_file(text) is '0058. 같은 회사 입구에 같은 sha256 파일이 또 있는가(보이는 줄만). 알림용 — 막지 않는다.';
revoke all on function intake_same_file(text) from public, anon;
grant execute on function intake_same_file(text) to authenticated;

commit;
