-- =====================================================================
-- Chairman OS — 0050_ecount_import (ECOUNT 엑셀 업로드 · 표 · 정책 · 출처 칸 · 첨부 대상)
-- 작성: 2026-10-03 (설계: docs/superpowers/specs/2026-10-02-ecount-excel-import.md «C. DB 변경» —
--       설계서는 0049로 적었지만 0049는 0049_staff_terms가 썼다)
--
-- 회장 지시: DY는 ECOUNT에서 계정과목 · 연간 재무제표 · 월별 손익을 엑셀로 내려받는다. 그 파일을 올려
-- 장부에 싣는다. 그 회사 재무 쓰기 권한자만(can_keep_books) · 마감된 달 거부 · 출처는 «ECOUNT 엑셀(잠정)»,
-- 세무사 확정은 «확정»으로 따로 · 원본 파일은 첨부로 보관 · 감사 기록.
--
-- ■ 이 파일이 하는 것 — 설계서 C의 1~6 ■
--   1절 finance_imports        업로드 한 건(draft → committed | cancelled). 원본 파일 · sha256 · 요약 · 만든 사람.
--       읽기 can_read_books · 넣기는 can_keep_books 본인 draft · 고치기는 만든 사람의 draft에서만 · 지우기 없음.
--       고칠 수 있는 칸은 grant로 넷만 연다(status · period_key · file_sha256 · summary — 0045와 같은 수법).
--       sha256은 한 번 적히면 못 바꾼다 — commit이 «미리보기 때 읽은 그 파일인가»를 이 값으로 잰다.
--   2절 finance_import_slips   월별 업로드가 세운 전표 한 장 ↔ (회사, 달). **활성 (business_id, month) 하나** —
--       같은 달을 다시 올리면 새 줄을 세우기 전에 옛 줄을 supersede한다(재업로드 = 정정 전표, 설계서 B-③).
--       넣기는 그 회사 장부 권한 + 본인의 monthly draft 업로드 + 이 트랜잭션에서 본인이 세운 그 달 전표(역분개 아님).
--       고치기는 superseded_at 채우기만이고, 그 전표에 본인이 세운 역분개 — 원 전표 줄의 정확한 반대 — 가
--       이미 있어야 한다(리뷰 I-1 · 2차 I-1).
--   3절 첨부 대상에 finance_imports — entity check · attachment_entity_visible · attachments_stamp에 한 case씩.
--       businesses/biz_dy에 붙이면 회사 · 등급만 맞는 사람에게 다 보이고 AI 요약까지 탄다(설계서 0.6) —
--       재무 원본은 재무 권한자(finance_imports_read = can_read_books)만 보게 한다.
--       **더한 것 하나**: finance_imports 첨부는 그 draft를 만든 본인만 올린다(restrictive insert).
--       0045 insert 정책은 «대상이 보이면» 올리게 해서, 재무 읽기만 가진 사람이 남의 업로드에 파일을
--       끼워 넣을 수 있다 — commit이 어느 파일을 읽을지 흐려진다.
--       **committed · cancelled 업로드의 원본은 못 지우고 못 바꾼다**(리뷰 I-2) — 첨부 줄 삭제 · Storage 객체
--       삭제 · 한 시간 재업로드 창을 «업로드가 draft일 때만»으로 좁힌다. 취소는 «첨부 취소 → cancelled» 순서다.
--   4절 accounts_books_insert  source in ('manual', 'ecount') — 사람이 올린 ECOUNT 계정에도 «ECOUNT» 꼬리표.
--       0015의 Integration 정책 · accounts_guard(source 변경 금지)는 그대로다.
--   5절 official_statements    basis('accountant' 기본 | 'ecount_excel') · import_id.
--       증빙: accountant는 0020 그대로(evidence_url 필수, http(s)) · ecount_excel은 import_id 필수(링크는 선택).
--       활성 unique를 basis까지 — 세무사 확정과 ECOUNT 잠정이 같은 기간에 한 줄씩 선다.
--       **update는 superseded_at 채우기만** — official_statements_guard 트리거. 0020 supersede 정책(0020:82)에
--       칸 제한이 없어서 재무 쓰기 권한자가 PostgREST로 memo · evidence_url을 고칠 수 있었다(설계서 0.7).
--       basis가 생기면 그 구멍이 «잠정 → 확정 위조»가 된다. 칸 목록이 아니라 «superseded_at 말고 전부»로 재서
--       나중에 칸이 늘어도 같이 닫힌다.
--   6절 official_statement_save()  0047 본문 그대로 + `and basis = 'accountant'` 한 줄. 빠뜨리면 세무사 저장이
--       ECOUNT 잠정 행을 supersede해 두 출처의 정정 사슬이 섞이거나, 두 출처가 다 활성일 때 엉뚱한 행을 밀고
--       accountant 활성 2행으로 unique에 깨진다.
--
-- ■ 하지 않는 것 ■
--   * **신규 RPC 둘(official_statement_import_ecount · ecount_monthly_import)은 0051 이후다.** 열 구성
--     (회장 스크린샷)이 확정된 뒤 연간 · 월별 단계에서 각자의 마이그레이션으로 만든다. 그 전까지
--     finance_imports는 계정과목 업로드(accounts에 직접 insert)만 쓴다.
--   * finance_imports의 상태 변화는 감사하지 않는다 — 감사는 대상별 쓰기(계정 · 결산 · 전표)가 같은
--     트랜잭션에서 남긴다(설계서 A «감사»). draft 행 자체는 장부가 아니다.
--   * official_statement_lines는 건드리지 않는다(update 정책이 원래 없다).
--
-- 0035 규칙: force를 새로 걸지 않는다(자물쇠는 revoke) · 0001~0049를 고치지 않는다(함수는 create or replace,
-- 정책은 drop + create, 제약 · 색인은 drop + 다시) · 새 enum 값 없음 · service_role 없음.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. finance_imports — 업로드 한 건
-- =====================================================================
create table finance_imports (
  import_id    uuid primary key default gen_random_uuid(),
  business_id  text not null references businesses(business_id) on delete restrict, -- [일반]
  kind         text not null check (kind in ('accounts', 'annual', 'monthly')),       -- [일반]
  -- annual 'YYYY' · monthly 'YYYY' 또는 'YYYY-MM' · accounts는 없다. 미리보기가 파일에서 읽어 채운다.
  period_key   text,                                                                  -- [일반]
  status       text not null default 'draft'
               check (status in ('draft', 'committed', 'cancelled')),                 -- [일반]
  file_name    text not null check (length(btrim(file_name)) between 1 and 255),     -- [제한] 파일 이름이 거래 상대를 말한다
  file_sha256  text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),   -- [일반]
  -- 미리보기 · 등록 결과 요약(행 수 · 오류 수 · 기간). 금액 원문은 두지 않는다 — 원본은 첨부다.
  summary      jsonb check (summary is null or jsonb_typeof(summary) = 'object'),     -- [제한]
  created_by   uuid not null default auth.uid(),                                      -- [제한]
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  committed_at timestamptz,
  cancelled_at timestamptz,

  -- 0050 2절 · 5절의 복합 FK가 «같은 회사의 업로드»를 문다.
  constraint finance_imports_business_key unique (import_id, business_id),
  constraint finance_imports_period_shape check (
    period_key is null
    or (kind = 'annual'  and period_key ~ '^[0-9]{4}$')
    or (kind = 'monthly' and period_key ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$')
  ),
  -- 등록은 «그 파일»이어야 한다. 해시 없이 committed가 되면 무엇을 실었는지 대조할 길이 없다.
  constraint finance_imports_commit_shape check (
    status <> 'committed' or (file_sha256 is not null and (kind = 'accounts' or period_key is not null))
  )
);

create index finance_imports_by_business on finance_imports (business_id, created_at desc);

comment on table finance_imports is
  '0050. ECOUNT 엑셀 업로드 한 건. draft → committed | cancelled. 원본 파일은 attachments(entity_table=finance_imports). 지우지 않는다.';

create trigger finance_imports_updated_at before update on finance_imports
  for each row execute function set_updated_at();

-- 믿지 않는 칸은 DB가 적는다(0045 attachments_stamp와 같은 결).
-- update: draft에서만 움직이고, 만든 사람 · 회사 · 종류 · 파일 이름은 그대로, sha256은 한 번만 적힌다.
create or replace function finance_imports_guard() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.committed_at := null;
    new.cancelled_at := null;
    return new;
  end if;

  if old.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'finance_import_closed',
      detail = format('업로드 %s는 이미 %s다. 다시 올리려면 새 업로드를 만든다.', old.import_id, old.status);
  end if;
  if (to_jsonb(new) - array['status', 'period_key', 'file_sha256', 'summary', 'updated_at', 'committed_at', 'cancelled_at'])
     is distinct from
     (to_jsonb(old) - array['status', 'period_key', 'file_sha256', 'summary', 'updated_at', 'committed_at', 'cancelled_at']) then
    raise exception using errcode = 'P0001', message = 'finance_import_immutable',
      detail = '회사 · 종류 · 파일 이름 · 만든 사람은 바꿀 수 없다.';
  end if;
  if old.file_sha256 is not null and new.file_sha256 is distinct from old.file_sha256 then
    raise exception using errcode = 'P0001', message = 'finance_import_hash_immutable',
      detail = '미리보기에서 읽은 파일의 해시는 바꿀 수 없다. 다른 파일이면 새 업로드를 만든다.';
  end if;

  new.committed_at := case when new.status = 'committed' then now() end;
  new.cancelled_at := case when new.status = 'cancelled' then now() end;
  return new;
end;
$fn$;

create trigger finance_imports_guard
  before insert or update on finance_imports
  for each row execute function finance_imports_guard();

alter table finance_imports enable row level security;

-- 자물쇠는 revoke(0035). Supabase는 새 표를 만들자마자 anon/authenticated에 연다.
revoke all on table finance_imports from anon, authenticated;
grant select, insert on table finance_imports to authenticated;
grant update (status, period_key, file_sha256, summary) on table finance_imports to authenticated;

create policy finance_imports_read on finance_imports
  for select using (can_read_books(business_id));
create policy finance_imports_insert on finance_imports
  for insert with check (can_keep_books(business_id) and created_by = auth.uid() and status = 'draft');
-- 만든 사람의 draft만 움직인다. committed · cancelled는 끝이다(트리거가 소유자에게도 막는다).
create policy finance_imports_update on finance_imports
  for update using (can_keep_books(business_id) and created_by = auth.uid() and status = 'draft')
  with check (can_keep_books(business_id) and created_by = auth.uid());
-- delete 정책 없음(Default Deny). 업로드 기록은 지우지 않는다 — 취소는 cancelled다.

-- =====================================================================
-- 2절. finance_import_slips — 월별 업로드가 세운 전표
-- =====================================================================
create table finance_import_slips (
  business_id   text not null references businesses(business_id) on delete restrict, -- [일반]
  month         text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),           -- [일반]
  slip_no       text not null,                                                        -- [일반]
  import_id     uuid not null,                                                        -- [일반]
  created_at    timestamptz not null default now(),
  -- 재업로드가 정정 전표를 세우면 옛 줄을 supersede한다. 전표 자체는 0016대로 지우지 않는다.
  superseded_at timestamptz,                                                          -- [일반]
  primary key (business_id, slip_no),
  foreign key (business_id, slip_no) references journal_entries (business_id, slip_no) on delete restrict,
  foreign key (import_id, business_id) references finance_imports (import_id, business_id) on delete restrict
);

-- 한 달의 **활성** 업로드 전표는 하나뿐이다. 같은 달에 두 장이 서면 손익이 두 배가 된다(설계서 0.3).
create unique index finance_import_slips_one_active
  on finance_import_slips (business_id, month)
  where superseded_at is null;

comment on table finance_import_slips is
  '0050. 월별 ECOUNT 업로드가 세운 전표 ↔ (회사, 달). 활성은 달마다 하나. 재업로드는 정정 전표 + 옛 줄 supersede.';

alter table finance_import_slips enable row level security;

revoke all on table finance_import_slips from anon, authenticated;
grant select, insert on table finance_import_slips to authenticated;
grant update (superseded_at) on table finance_import_slips to authenticated;

create policy finance_import_slips_read on finance_import_slips
  for select using (can_read_books(business_id));
-- 넣기: 그 회사 장부 권한 + 본인의 월별 draft 업로드(RPC가 committed로 바꾸기 전에 넣는다)
--   + 그 전표는 **이 트랜잭션에서 본인이 세운** 그 달 전표이고 역분개가 아니다(리뷰 I-1).
--   created_at = now()는 «같은 트랜잭션»이다(now()는 트랜잭션 시작 시각). 이미 있던 수기 전표 · 남의 전표를
--   업로드 전표로 둔갑시키는 길을 닫는다. 정정분개(restatement)는 잇는다 — 재업로드가 세우는 새 활성 전표다.
create policy finance_import_slips_insert on finance_import_slips
  for insert with check (
    can_keep_books(business_id)
    and superseded_at is null
    and exists (
      select 1 from finance_imports i
       where i.import_id = finance_import_slips.import_id
         and i.business_id = finance_import_slips.business_id
         and i.created_by = auth.uid()
         and i.kind = 'monthly'
         and i.status = 'draft'
    )
    and exists (
      select 1 from journal_entries e
       where e.business_id = finance_import_slips.business_id
         and e.slip_no = finance_import_slips.slip_no
         and to_char(e.entry_date, 'YYYY-MM') = finance_import_slips.month
         and e.created_by = auth.uid()
         and e.created_at = now()
         and e.correction_kind is distinct from 'reversal'
    )
  );
-- supersede만 허용한다(칸 grant가 superseded_at 하나다). 한 번 채운 줄은 다시 못 건드린다.
-- 그 전표에 **본인이 세운 역분개가 이미 있어야** 한다(리뷰 I-1) — 역분개 없이 줄만 내리면 원장에는 옛 전표가
-- 그대로 살아 있는데 «활성 업로드 전표 없음»이 되어 다음 업로드가 같은 달을 두 번 싣는다. 역분개는 전표당
-- 하나뿐이라(0016 journal_entries_one_reversal) 줄을 내릴 수 있는 사람은 그 정정을 세운 사람 하나다.
-- 그 역분개는 **원 전표 줄의 정확한 반대**여야 한다(2차 리뷰 I-1). journal_entry_insert(0016:286, invoker)는
-- 누구나 부르므로 p_correction_kind='reversal' · 1원 줄로 가짜 역분개를 세울 수 있다. post_correction(0016:691-708)이
-- 만드는 모양 그대로 잰다 — 원 줄을 line_no 순서로 읽어 계정 · 금액 · 적요(memo)는 그대로, 차변↔대변만 바꾸고,
-- journal_entry_insert가 1부터 다시 번호를 매긴다. 그래서 line_no로 full join해 어긋나는 줄이 하나도 없어야 한다.
create policy finance_import_slips_supersede on finance_import_slips
  for update using (can_keep_books(business_id) and superseded_at is null)
  with check (
    can_keep_books(business_id)
    and superseded_at is not null
    and exists (
      select 1 from journal_entries r
       where r.business_id = finance_import_slips.business_id
         and r.corrects_id = finance_import_slips.slip_no
         and r.correction_kind = 'reversal'
         and r.created_by = auth.uid()
         and not exists (
           select 1
             from (select line_no, account_code, amount, side, memo from journal_lines
                    where business_id = finance_import_slips.business_id
                      and slip_no = finance_import_slips.slip_no) o
             full join
                  (select line_no, account_code, amount, side, memo from journal_lines
                    where business_id = r.business_id and slip_no = r.slip_no) v
               on v.line_no = o.line_no
            where o.line_no is null or v.line_no is null
               or v.account_code is distinct from o.account_code
               or v.amount is distinct from o.amount
               or v.side is not distinct from o.side
               or v.memo is distinct from o.memo
         )
    )
  );
-- delete 정책 없음(Default Deny).

-- AI Agent와 Integration은 두 표에 쓰지 않는다 — 0045와 같은 세 짝 이름.
do $$
declare
  t text;
begin
  foreach t in array array['finance_imports', 'finance_import_slips'] loop
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

-- =====================================================================
-- 3절. 첨부 대상에 finance_imports — 0045의 세 자리에 한 case씩
-- =====================================================================
alter table attachments drop constraint attachments_entity_check;
alter table attachments add constraint attachments_entity_check
  check (entity_table in ('initiatives', 'businesses', 'documents', 'decisions', 'finance_imports'));

-- 0045:176-185 본문 그대로 + finance_imports 한 줄. 판정은 finance_imports_read(can_read_books)가 한다.
create or replace function attachment_entity_visible(p_table text, p_id text) returns boolean
language sql stable security invoker set search_path = public as $fn$
  select case p_table
    when 'initiatives' then exists (select 1 from public.initiatives where initiative_id = p_id)
    when 'businesses'  then exists (select 1 from public.businesses  where business_id  = p_id)
    when 'documents'   then exists (select 1 from public.documents   where document_id  = p_id)
    when 'decisions'   then exists (select 1 from public.decisions   where decision_id  = p_id)
    when 'finance_imports' then exists (select 1 from public.finance_imports where import_id::text = p_id)
    else false
  end;
$fn$;

comment on function attachment_entity_visible(text, text) is '0045/0050. 첨부가 붙은 대상이 호출자에게 보이는가(security invoker — 대상 표의 RLS가 판정). 0050이 finance_imports를 더했다.';

-- 0045:212-248 본문 그대로 + 회사 case에 finance_imports 한 줄.
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

-- 업로드 원본은 그 draft를 만든 본인만 올린다. 다른 대상의 첨부에는 걸리지 않는다.
drop policy if exists attachments_finance_import_owner on attachments;
create policy attachments_finance_import_owner on attachments as restrictive for insert
  with check (
    entity_table <> 'finance_imports'
    or exists (
      select 1 from finance_imports i
       where i.import_id::text = attachments.entity_id
         and i.created_by = auth.uid()
         and i.status = 'draft'
    )
  );

-- committed · cancelled 업로드의 원본은 증빙이다 — 지우지도 바꿔치지도 못한다(리뷰 I-2).
--   첨부 줄 삭제(0045 attachments_delete) · Storage 객체 삭제(0045 attachments_objects_delete) ·
--   한 시간 재업로드 창(0045 attachment_object_uploadable)이 전부 «업로드가 draft일 때만»이다.
--   그래서 취소 흐름은 «첨부 취소(줄 · 객체 삭제) → cancelled» 순서다. cancelled 뒤에 남은 파일은 그대로 남는다.
--   definer: Storage 정책은 anon도 거친다 — anon은 finance_imports 표 권한이 없어서 invoker면 다른 버킷 질의까지
--   권한 오류로 죽는다(0045 8절 주석). 돌려주는 것은 «그 id가 draft인가» 한 비트이고, 세션 없으면 false다.
create or replace function finance_import_is_draft(p_import text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select auth.uid() is not null
     and exists (select 1 from finance_imports where import_id::text = p_import and status = 'draft');
$fn$;

comment on function finance_import_is_draft(text) is
  '0050. 업로드가 draft인가(세션 없으면 false). committed · cancelled 업로드의 원본 첨부 · 객체를 지우거나 바꾸지 못하게 하는 정책들이 부른다.';

revoke all on function finance_import_is_draft(text) from public;
grant execute on function finance_import_is_draft(text) to anon, authenticated;

drop policy if exists attachments_finance_import_delete on attachments;
create policy attachments_finance_import_delete on attachments as restrictive for delete
  using (entity_table <> 'finance_imports' or finance_import_is_draft(entity_id));

-- 0045:595-597 정책을 이름 그대로 다시 만든다 — 본문 그대로 + 업로드 조건 한 줄.
drop policy if exists attachments_objects_delete on storage.objects;
create policy attachments_objects_delete on storage.objects for delete
  using (bucket_id = 'attachments' and public.attachment_object_visible(name, true)
    and (split_part(name, '/', 1) <> 'finance_imports' or public.finance_import_is_draft(split_part(name, '/', 2))));

-- 0045:557-573 본문 그대로 + 업로드 조건 한 줄. 0046~0049는 이 함수를 다시 정의하지 않았다.
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
  );
end;
$fn$;

-- =====================================================================
-- 4절. accounts_books_insert — 사람이 올린 ECOUNT 계정은 source='ecount'
--   0016:73-74의 정책을 이름 그대로 다시 만든다. 판정(can_keep_books)은 0047판 그대로.
-- =====================================================================
drop policy if exists accounts_books_insert on accounts;
create policy accounts_books_insert on accounts
  for insert with check (can_keep_books(business_id) and source in ('manual', 'ecount'));

-- =====================================================================
-- 5절. official_statements — 출처(basis) · 업로드 · 증빙 · 활성 unique · update guard
-- =====================================================================
alter table official_statements
  add column basis text not null default 'accountant'
    check (basis in ('accountant', 'ecount_excel')),                                   -- [일반]
  add column import_id uuid;                                                          -- [일반]

alter table official_statements
  add constraint official_statements_import_fk
    foreign key (import_id, business_id) references finance_imports (import_id, business_id) on delete restrict;

comment on column official_statements.basis is
  '0050. accountant = 세무사 · 회계법인 결산(«확정») · ecount_excel = ECOUNT 엑셀 업로드(«잠정»). 월별 잠금 · 기준 문구는 accountant만 센다.';

-- 증빙: accountant는 0020 그대로(링크 필수) · ecount_excel은 업로드(원본 첨부)가 증빙이고 링크는 선택.
alter table official_statements alter column evidence_url drop not null;
alter table official_statements drop constraint official_statements_evidence_url_check;
alter table official_statements add constraint official_statements_evidence_check check (
  (evidence_url is null or evidence_url ~* '^https?://')
  and case basis
        when 'accountant'   then evidence_url is not null and import_id is null
        when 'ecount_excel' then import_id is not null
        else false
      end
);

-- 활성 결산은 기간 × 출처마다 하나. 세무사 확정과 ECOUNT 잠정은 서로를 밀어내지 않는다.
drop index official_statements_one_active;
create unique index official_statements_one_active
  on official_statements (business_id, period_kind, period_key, basis)
  where superseded_at is null;

-- update는 superseded_at을 null → 시각으로 채우는 것만. 0020 supersede 정책(0020:82)에 칸 제한이 없었다.
create or replace function official_statements_guard() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if old.superseded_at is not null or new.superseded_at is null
     or (to_jsonb(new) - 'superseded_at') is distinct from (to_jsonb(old) - 'superseded_at') then
    raise exception using errcode = 'P0001', message = 'official_statement_immutable',
      detail = '공식 재무제표는 고치지 않는다. supersede(superseded_at 채우기)만 된다 — 정정은 새 결산으로 쌓는다.';
  end if;
  return new;
end;
$fn$;

create trigger official_statements_guard before update on official_statements
  for each row execute function official_statements_guard();

-- =====================================================================
-- 6절. official_statement_save() — 세무사 저장은 세무사 행만 supersede한다
--
--   0047:473-542의 본문을 **파일에서 그대로 복사**했고, 이전 활성 행을 찾는 select에
--   `and basis = 'accountant'` 한 줄을 더한 것 말고는 한 줄도 바꾸지 않았다. 새 행은 칸 기본값으로
--   basis = 'accountant'다. 0048 · 0049는 이 함수를 다시 정의하지 않았다.
-- =====================================================================
create or replace function official_statement_save(
  p_business_id  text,
  p_period_kind  text,
  p_period_key   text,
  p_evidence_url text,
  p_memo         text,
  p_lines        jsonb   -- [{account_code, amount}, ...]
) returns bigint
language plpgsql security invoker set search_path = public as $fn$
declare
  v_prev    official_statements%rowtype;
  v_id      bigint;
  v_balance numeric(20, 2);
  v_before  jsonb;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '재무제표에 줄이 하나도 없습니다.';
  end if;

  -- 자산 + 부채 + 자본 = 0. 원장 규약(차변 − 대변)에서 재무상태표가 닫힌다는 뜻이 이것이다.
  select coalesce(sum((l->>'amount')::numeric), 0)
    into v_balance
    from jsonb_array_elements(p_lines) l
    join accounts a
      on a.business_id = p_business_id and a.account_code = l->>'account_code'
   where a.section in ('cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity');

  if v_balance <> 0 then
    raise exception '재무상태표가 닫히지 않습니다. 차이 %원', v_balance;
  end if;

  select * into v_prev
    from official_statements
   where business_id = p_business_id
     and period_kind = p_period_kind
     and period_key  = p_period_key
     and basis = 'accountant'
     and superseded_at is null;

  if found then
    select jsonb_build_object(
             'memo', v_prev.memo,
             'evidence_url', v_prev.evidence_url,
             'lines', coalesce(jsonb_agg(jsonb_build_object('account_code', account_code, 'amount', amount)
                                order by account_code), '[]'::jsonb))
      into v_before
      from official_statement_lines where statement_id = v_prev.id;

    update official_statements set superseded_at = now() where id = v_prev.id;
  end if;

  insert into official_statements (business_id, period_kind, period_key, evidence_url, memo, supersedes_id)
  values (p_business_id, p_period_kind, p_period_key, p_evidence_url, p_memo, v_prev.id)
  returning id into v_id;

  insert into official_statement_lines (statement_id, business_id, account_code, amount)
  select v_id, p_business_id, l->>'account_code', (l->>'amount')::numeric
    from jsonb_array_elements(p_lines) l;

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ((case when v_prev.id is null then 'create' else 'update' end)::audit_action,
          'official_statements', v_id::text, p_business_id, auth.uid(), auth_role()::text,
          v_before,
          jsonb_build_object('memo', p_memo, 'evidence_url', p_evidence_url, 'lines', p_lines),
          case when v_prev.id is null
               then format('공식 재무제표 %s %s', p_period_kind, p_period_key)
               else format('공식 재무제표 정정 %s %s — 이전 #%s', p_period_kind, p_period_key, v_prev.id) end);

  return v_id;
end;
$fn$;

comment on function official_statement_save is
  '0020/0047/0050. 공식 재무제표(세무사 확정 — basis accountant) 저장. supersede + 헤더 + 라인 + 감사기록을 한 트랜잭션으로. 닫히지 않으면 예외. 0047이 감사 action의 enum 캐스트를 고쳤다. 0050이 supersede를 accountant 행으로 좁혔다 — ECOUNT 잠정 행은 건드리지 않는다.';

commit;
