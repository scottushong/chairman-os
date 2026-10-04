-- =====================================================================
-- Chairman OS — 0051_ecount_import_rpc (ECOUNT 엑셀 업로드 등록 RPC 둘 · 0050이 남긴 구멍 닫기)
-- 작성: 2026-10-04 (설계: docs/superpowers/specs/2026-10-02-ecount-excel-import.md «B-① · B-②» ·
--       DEFERRED «2026-10-03 블록 — ECOUNT 엑셀 업로드 0050» · «2026-10-03 — ECOUNT 업로드 열 지정»)
--
-- 왜: 0050까지 계정과목 등록은 앱이 PostgREST로 여러 번 썼다(감사 → 새 코드 insert → 이름 바꿈마다 감사 + update
-- → committed). 이름 바꿈 도중 끊기면 반쪽만 바뀌고, committed 전이를 앱이 하니 만든 사람이 PostgREST로 draft를
-- 곧장 committed로 바꿀 수 있었다(«빈 committed», 0050 리뷰 M-1). 연간 재무제표는 등록 길 자체가 없었고,
-- 공식 재무제표 헤더 · 줄은 정책만 맞으면 균형 검사 · 감사 없이 직접 insert되었다(0020부터 · 리뷰 I-3).
--
-- ■ 이 파일이 하는 것 ■
--   0절 도우미 셋(사람이 부르지 못한다 — execute를 다 걷는다)
--       ecount_code_business(target)   ECOUNT 코드 체계 회사인가. 앱 ECOUNT_CODE_BUSINESSES와 같은 목록(check-migrations가 대조).
--       ecount_audit_note(...)         감사 · memo 문구. 앱 ecountAuditNote(file-rules.ts)와 같은 글(check-migrations가 대조).
--                                      **DB가 만든다** — 화면 · 서버가 보낸 note를 믿지 않는다.
--       finance_import_claim(...)      두 RPC가 같이 쓰는 업로드 판정. 행을 for update로 잡고 «본인 · draft · 그 종류 ·
--                                      sha256 같음 · 그 회사 장부 권한 · ECOUNT 회사 · 사람(AIAgent/Integration 아님)»을 다 본다.
--   1절 ecount_accounts_import(import_id, file_sha256, creates, renames) → {added, renamed}
--       한 트랜잭션: 판정 → 계획 모양 · 중복 · 이미 있는 코드 · 바뀐 이름 확인 → **감사 먼저**(새 코드 묶음 한 줄 +
--       이름 바꿈 한 줄씩 — 0050까지 앱이 남기던 모양 그대로) → 새 코드 insert(source='ecount') → 이름 update → committed.
--       하나라도 어긋나면 전부 되돌아간다(감사 줄까지).
--   2절 official_statement_import_ecount(import_id, file_sha256, lines) → 새 결산 id
--       official_statement_save와 같은 구성: 줄 모양 · 장부에 있는 계정 → 세무사 확정이 덮은 해면 거부 → 균형 →
--       ECOUNT 활성 행 supersede(basis별 활성 unique — 0050 5절) → 헤더(basis='ecount_excel', import_id) · 줄 → committed.
--       **감사가 먼저다**: 새 id를 시퀀스에서 먼저 받아(overriding system value) 감사 줄을 앞에 쓴다.
--   3절 official_statement_save(세무사 확정)를 security definer로 — 직접 insert 정책을 지우면 invoker 함수도 못 넣는다.
--       본문은 0050 그대로 + 맨 앞에 권한 판정(can_keep_books · 사람) 한 덩어리. 0020 정책이 하던 판정을 몸통이 다시 한다.
--   4절 구멍 닫기
--       ① official_statements · official_statement_lines: 직접 insert · supersede 정책을 지우고 grant도 걷는다 —
--          헤더 · 줄은 이제 definer RPC 셋(save · import_ecount · 그리고 supersede는 그 둘 안에서)으로만 선다.
--          **force를 내린다** — HANDOVER §3 ①: FORCE가 걸린 표에서는 definer도 정책 아래로 내려가고, insert 정책을
--          지운 뒤에는 definer가 조용히가 아니라 **늘** 거부된다(PGlite harness는 superuser라 이것을 못 본다 —
--          check-migrations가 BYPASSRLS 없는 소유자로 따로 잰다). 표가 열리는 것이 아니다: authenticated의 읽기는
--          0047 읽기 정책을 그대로 타고, 쓰기는 grant 자체가 없다(자물쇠는 revoke — 0035).
--       ② official_statement_lines에 (statement_id, business_id) 복합 FK — 다른 회사 결산에 줄을 붙이지 못한다.
--       ③ finance_imports_update의 with check를 status in ('draft', 'cancelled')로 — committed는 definer RPC만.
--
-- ■ FORCE와 definer — 표마다 어떻게 했나(HANDOVER §3 ①) ■
--   finance_imports            force 없음(0050). 소유자로 읽고 쓴다 → restrictive(ai_agent_no_* · integration_no_*)도
--                              소유자에게는 안 걸린다 → 그래서 claim이 역할을 몸통에서 다시 거른다.
--   official_statements · lines  이 파일이 force를 내린다(위 4절 ①). 같은 이유로 restrictive가 소유자에게 안 걸린다.
--   accounts                   force 그대로(0015). definer여도 accounts_books_insert/update가 **호출자의 auth.uid()로**
--                              다시 재진다 — 몸통이 이미 can_keep_books를 봤으니 같은 답이 나온다. 내릴 이유가 없다
--                              (accounts에는 Integration 정책이 따로 있고, 문을 세울 표가 아니다).
--   audit_log                  force 그대로(0002 · 0034 · HANDOVER §3 ②). audit_log_insert가 호출자로 재진다 —
--                              활성 사람은 «else true» 갈래다. 이 표의 force는 절대 내리지 않는다.
--
-- ■ 하지 않는 것 ■
--   * 월별 RPC(ecount_monthly_import)는 다음 마이그레이션 — 대응 계정 · 정정 전표 설계가 남았다.
--   * restrictive 넷(official_statements_ai_no_insert 등, 0020)은 지우지 않는다. permissive insert가 없으니 오늘은
--     잴 것이 없지만, 누가 insert 정책을 되살리면 그날 다시 막는다(0035 exceptions와 같은 이유 — HANDOVER §3).
--   * 마감된 달(closings)은 연간 등록을 막지 않는다 — 연간은 원장(전표)에 손대지 않는 별도 층이다(설계서 0-2:
--     official_statement_lines는 KPI를 타지 않는다). 연간의 «확정»은 세무사 결산(basis='accountant')이고 그것이 덮은 해를 거부한다.
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0050을 고치지 않는다(함수는 create or replace, 정책은 drop + create) ·
-- 새 enum 값 없음 · service 키 없음.
-- =====================================================================

begin;

-- =====================================================================
-- 0절. 도우미 — 사람이 부르지 못한다(두 RPC가 소유자로 부른다)
-- =====================================================================

-- ECOUNT 코드 체계 회사. src/lib/ledger/standard-chart.ts ECOUNT_CODE_BUSINESSES와 같은 목록이어야 한다 —
-- 한쪽만 늘면 화면은 업로드를 열고 DB가 «ECOUNT 회사가 아니다»로 막는다(check-migrations가 대조한다).
create or replace function ecount_code_business(target text) returns boolean
language sql immutable set search_path = public as $fn$
  select coalesce(target = any (array['biz_dy']), false);
$fn$;

comment on function ecount_code_business(text) is
  '0051. ECOUNT 코드 체계 회사인가. 앱 ECOUNT_CODE_BUSINESSES와 같은 목록(check-migrations가 대조한다).';

-- 감사 note · ECOUNT 결산 memo. src/lib/ecount/excel/file-rules.ts ecountAuditNote와 같은 글:
-- «ECOUNT 엑셀 업로드 — {종류} {기간} · 파일 {이름} · import {id}». 파일 이름은 제어 문자 · 연속 공백을 한 칸으로,
-- 120자를 넘으면 119자 + «…». 앱이 보낸 문구를 쓰지 않는다 — 감사 문구도 DB가 아는 사실(업로드 줄)에서 만든다.
create or replace function ecount_audit_note(p_kind text, p_period text, p_file_name text, p_import_id uuid) returns text
language sql immutable set search_path = public as $fn$
  select format('ECOUNT 엑셀 업로드 — %s · 파일 %s · import %s',
    concat_ws(' ',
      case p_kind when 'accounts' then '계정과목' when 'annual' then '연간 재무제표' when 'monthly' then '월별 손익' end,
      nullif(btrim(coalesce(p_period, '')), '')),
    (select case when char_length(f) > 120 then left(f, 119) || '…' else f end
       from (select btrim(regexp_replace(regexp_replace(coalesce(p_file_name, ''), '[[:cntrl:]]+', ' ', 'g'), '\s+', ' ', 'g')) as f) s),
    p_import_id);
$fn$;

comment on function ecount_audit_note(text, text, text, uuid) is
  '0051. ECOUNT 업로드 감사 note · 결산 memo. 앱 ecountAuditNote와 같은 글(check-migrations가 대조한다).';

-- 두 RPC가 같이 쓰는 업로드 판정. 실패 낱말(message)은 앱(lib/ecount/import-errors.ts)과 dummy가 같은 것을 쓴다.
-- 순서가 뜻이다:
--   ① 사람 · 활성 · AIAgent/Integration 아님 — 소유자로 도는 RPC에는 0050 restrictive가 안 걸린다(머리 주석).
--   ② 업로드가 없거나 그 회사 재무를 **읽지도** 못하면 «없음» — 없는 것과 못 보는 것을 가르지 않는다(HANDOVER §2 ⑤).
--   ③ 만든 사람만 · ④ 그 회사 장부 쓰기 · ⑤ ECOUNT 회사 · ⑥ draft · ⑦ 종류 · ⑧ sha256(서버가 방금 다시 읽은 파일 = 미리보기 때 파일).
-- for update: 같은 업로드를 두 번 누르면 둘째는 첫째가 끝날 때까지 기다렸다가 ⑥에서 멈춘다.
-- security invoker지만 execute를 아무에게도 주지 않는다 — definer RPC 안에서 소유자로만 돈다.
create or replace function finance_import_claim(p_import_id uuid, p_kind text, p_file_sha256 text)
returns finance_imports
language plpgsql security invoker set search_path = public as $fn$
declare
  v finance_imports%rowtype;
begin
  if auth.uid() is null or not is_active() or auth_role()::text in ('AIAgent', 'Integration') then
    raise exception using errcode = '42501', message = 'books_forbidden',
      detail = 'ECOUNT 업로드 등록은 그 회사 재무 쓰기 권한이 있는 사람만 한다.';
  end if;

  select * into v from finance_imports where import_id = p_import_id for update;
  if not found or not can_read_books(v.business_id) then
    raise exception using errcode = 'P0002', message = 'finance_import_not_found';
  end if;
  if v.created_by is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'finance_import_not_owner',
      detail = '올린 사람만 이 업로드를 등록한다.';
  end if;
  if not can_keep_books(v.business_id) then
    raise exception using errcode = '42501', message = 'books_forbidden',
      detail = format('%s의 재무 쓰기 권한이 없다.', v.business_id);
  end if;
  if not ecount_code_business(v.business_id) then
    raise exception using errcode = 'P0001', message = 'ecount_business_only',
      detail = format('%s는 ECOUNT 코드 체계 회사가 아니다.', v.business_id);
  end if;
  if v.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'finance_import_closed',
      detail = format('업로드 %s는 이미 %s다.', v.import_id, v.status);
  end if;
  if v.kind <> p_kind then
    raise exception using errcode = 'P0001', message = 'finance_import_kind',
      detail = format('업로드 종류가 %s다(%s 등록을 불렀다).', v.kind, p_kind);
  end if;
  if v.file_sha256 is null or p_file_sha256 is null or v.file_sha256 <> lower(p_file_sha256) then
    raise exception using errcode = 'P0001', message = 'finance_import_hash_mismatch',
      detail = '미리보기 때 읽은 파일과 지금 읽은 파일이 다르다(또는 미리보기 전이다).';
  end if;
  return v;
end;
$fn$;

comment on function finance_import_claim(uuid, text, text) is
  '0051. ECOUNT 업로드 등록 RPC가 같이 쓰는 판정(본인 · draft · 종류 · sha256 · 장부 권한 · ECOUNT 회사 · 사람). 행을 for update로 잡는다. 사람은 부르지 못한다.';

revoke all on function ecount_code_business(text) from public, anon, authenticated;
revoke all on function ecount_audit_note(text, text, text, uuid) from public, anon, authenticated;
revoke all on function finance_import_claim(uuid, text, text) from public, anon, authenticated;

-- =====================================================================
-- 1절. ecount_accounts_import — 계정과목 등록 한 트랜잭션
--
--   p_creates [{account_code, name, category, section, cash_flow, active}, ...]  새 코드(source='ecount')
--   p_renames [{account_code, from, to}, ...]                                     사람이 체크한 이름 바꿈
--   계획은 서버 액션이 **원본을 다시 읽어** 만든 것이다(lib/ecount/excel/accounts-import.ts planAccounts).
--   DB는 그 계획이 지금 장부와 맞는지만 다시 본다 — 그 사이 같은 코드가 생겼거나(account_exists) ·
--   이름이 바뀌었으면(account_changed) 아무것도 쓰지 않고 멈춘다. 다시 미리보기하면 새 계획이 선다.
--   분류(section · category · cash_flow)의 모순은 accounts_category_section 제약이 막는다.
-- =====================================================================
create or replace function ecount_accounts_import(
  p_import_id   uuid,
  p_file_sha256 text,
  p_creates     jsonb,
  p_renames     jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_imp     finance_imports%rowtype;
  v_note    text;
  v_bad     text;
  v_added   int := 0;
  v_renamed int := 0;
begin
  v_imp := finance_import_claim(p_import_id, 'accounts', p_file_sha256);

  p_creates := coalesce(p_creates, '[]'::jsonb);
  p_renames := coalesce(p_renames, '[]'::jsonb);
  if jsonb_typeof(p_creates) <> 'array' or jsonb_typeof(p_renames) <> 'array' then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid', detail = '계획이 배열이 아니다.';
  end if;

  -- 모양: 코드는 앞뒤 공백 없이(장부 코드와 그대로 비교한다) · 이름 · 분류 · 사용여부(boolean)가 있어야 한다.
  select coalesce(c->>'account_code', '?') into v_bad
    from jsonb_array_elements(p_creates) c
   where jsonb_typeof(c) <> 'object'
      or coalesce(c->>'account_code', '') = '' or c->>'account_code' <> btrim(c->>'account_code')
      or coalesce(btrim(c->>'name'), '') = ''
      or c->>'category' is null or c->>'section' is null
      or jsonb_typeof(c->'active') is distinct from 'boolean'
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid', detail = format('새 계정 %s의 모양이 틀렸다.', v_bad);
  end if;
  select coalesce(r->>'account_code', '?') into v_bad
    from jsonb_array_elements(p_renames) r
   where jsonb_typeof(r) <> 'object'
      or coalesce(r->>'account_code', '') = ''
      or coalesce(btrim(r->>'to'), '') = '' or r->>'from' is null or r->>'to' = r->>'from'
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid', detail = format('이름 바꿈 %s의 모양이 틀렸다.', v_bad);
  end if;
  -- 한 코드는 계획에 한 번만(새 코드 둘 · 새 코드이면서 이름 바꿈 · 이름 바꿈 둘 다 안 된다).
  select code into v_bad
    from (select c->>'account_code' as code from jsonb_array_elements(p_creates) c
          union all
          select r->>'account_code' from jsonb_array_elements(p_renames) r) x
   group by code having count(*) > 1
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid', detail = format('코드 %s가 계획에 두 번 있다.', v_bad);
  end if;

  -- 지금 장부와 맞는가. accounts는 force라 이 읽기도 호출자의 읽기 정책(can_read_books)을 탄다 — 장부 쓰기 권한자는
  -- 그 회사 계정을 다 본다(claim이 can_keep_books를 봤다).
  select c->>'account_code' into v_bad
    from jsonb_array_elements(p_creates) c
   where exists (select 1 from accounts a where a.business_id = v_imp.business_id and a.account_code = c->>'account_code')
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'account_exists',
      detail = format('계정코드 %s가 그 사이 장부에 생겼다. 미리보기를 다시 한다.', v_bad);
  end if;
  select r->>'account_code' into v_bad
    from jsonb_array_elements(p_renames) r
   where not exists (select 1 from accounts a
                      where a.business_id = v_imp.business_id and a.account_code = r->>'account_code' and a.name = r->>'from')
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'account_changed',
      detail = format('계정 %s가 없거나 이름이 미리보기 때와 다르다. 미리보기를 다시 한다.', v_bad);
  end if;

  v_note := ecount_audit_note('accounts', null, v_imp.file_name, v_imp.import_id);

  -- 기록이 먼저(HANDOVER §2 ③). 새 코드는 묶음 한 줄(코드 목록) · 이름 바꿈은 코드마다 한 줄 — 0050까지 앱이 남기던 모양.
  if jsonb_array_length(p_creates) > 0 then
    insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
    values ('create'::audit_action, 'accounts', v_imp.business_id || ':ecount-upload', v_imp.business_id, auth.uid(), auth_role()::text,
            jsonb_build_object('codes', (select jsonb_agg(c->>'account_code' order by n)
                                           from jsonb_array_elements(p_creates) with ordinality e(c, n))),
            format('%s — 계정 %s개 더함', v_note, jsonb_array_length(p_creates)));
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  select 'update'::audit_action, 'accounts', v_imp.business_id || ':' || (r->>'account_code'), v_imp.business_id, auth.uid(), auth_role()::text,
         jsonb_build_object('name', r->>'from'), jsonb_build_object('name', r->>'to'), v_note || ' — 이름 바꿈'
    from jsonb_array_elements(p_renames) with ordinality e(r, n)
   order by n;

  -- 상태가 나중. accounts는 force — 이 insert · update도 accounts_books_insert/update를 호출자로 다시 탄다.
  insert into accounts (business_id, account_code, name, category, section, cash_flow, active, source, fetched_at)
  select v_imp.business_id, c->>'account_code', btrim(c->>'name'),
         (c->>'category')::account_category, (c->>'section')::account_section,
         nullif(c->>'cash_flow', '')::cash_flow_class, (c->>'active')::boolean, 'ecount'::data_source, now()
    from jsonb_array_elements(p_creates) c;
  get diagnostics v_added = row_count;

  -- 이름만 바꾼다. 분류 · 사용여부 · source는 보내지도 않는다(있는 계정의 분류는 안 바꾼다 — 설계서 B-①).
  update accounts a
     set name = btrim(r->>'to')
    from jsonb_array_elements(p_renames) r
   where a.business_id = v_imp.business_id and a.account_code = r->>'account_code';
  get diagnostics v_renamed = row_count;
  if v_renamed <> jsonb_array_length(p_renames) then
    -- 위에서 다 있는 것을 봤으니 여기 오면 정책이 update를 0행으로 걸렀다는 뜻이다 — 반쪽 등록을 남기지 않는다.
    raise exception using errcode = '42501', message = 'books_forbidden', detail = '이름을 바꿀 계정 일부를 고치지 못했다.';
  end if;

  update finance_imports
     set status = 'committed',
         summary = coalesce(summary, '{}'::jsonb)
                   || jsonb_build_object('stage', 'committed', 'result', jsonb_build_object('added', v_added, 'renamed', v_renamed))
   where import_id = v_imp.import_id;

  return jsonb_build_object('added', v_added, 'renamed', v_renamed);
end;
$fn$;

comment on function ecount_accounts_import(uuid, text, jsonb, jsonb) is
  '0051. ECOUNT 계정과목 업로드 등록 — 감사(새 코드 묶음 + 이름 바꿈마다) → 새 코드(source=ecount) → 이름 → committed를 한 트랜잭션으로. 전부 아니면 전무.';

revoke all on function ecount_accounts_import(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function ecount_accounts_import(uuid, text, jsonb, jsonb) to authenticated;

-- =====================================================================
-- 2절. official_statement_import_ecount — 연간 재무제표(ECOUNT 엑셀 · 잠정) 등록
--
--   p_lines [{account_code, amount}, ...]  amount = 차변 − 대변(0015 규약 — 부채 · 자본 · 수익은 음수).
--   부호는 서버 액션이 계정 구분 + 영업외 소속 머리로 정한다(lib/ecount/excel/annual-import.ts annualLedgerLines) —
--   영업외 수익/비용은 계정 구분만으로 가를 수 없어서(같은 non_operating) DB가 다시 정할 수 없다.
--   DB가 다시 보는 것: 줄 모양 · 한 계정 한 줄 · 그 회사 장부에 있는 계정 · 세무사 확정 해 · 재무상태표 균형.
-- =====================================================================
create or replace function official_statement_import_ecount(
  p_import_id   uuid,
  p_file_sha256 text,
  p_lines       jsonb   -- [{account_code, amount}, ...]
) returns bigint
language plpgsql security definer set search_path = public as $fn$
declare
  v_imp     finance_imports%rowtype;
  v_prev    official_statements%rowtype;
  v_id      bigint;
  v_balance numeric(20, 2);
  v_before  jsonb;
  v_note    text;
  v_bad     text;
begin
  v_imp := finance_import_claim(p_import_id, 'annual', p_file_sha256);
  -- 0050 finance_imports_period_shape가 annual이면 'YYYY'로 묶는다. 미리보기 전이면 비어 있다.
  if v_imp.period_key is null then
    raise exception using errcode = 'P0001', message = 'finance_import_period', detail = '몇 년도 자료인지 정해지지 않았다.';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'statement_empty', detail = '재무제표에 줄이 하나도 없습니다.';
  end if;
  select coalesce(l->>'account_code', '?') into v_bad
    from jsonb_array_elements(p_lines) l
   where jsonb_typeof(l) <> 'object' or coalesce(l->>'account_code', '') = ''
      or jsonb_typeof(l->'amount') is distinct from 'number'
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid', detail = format('줄 %s의 모양이 틀렸다.', v_bad);
  end if;
  select l->>'account_code' into v_bad
    from jsonb_array_elements(p_lines) l group by l->>'account_code' having count(*) > 1 limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid', detail = format('계정 %s에 줄이 둘 이상이다.', v_bad);
  end if;
  select l->>'account_code' into v_bad
    from jsonb_array_elements(p_lines) l
   where not exists (select 1 from accounts a where a.business_id = v_imp.business_id and a.account_code = l->>'account_code')
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'statement_unknown_account',
      detail = format('계정 %s가 장부에 없다.', v_bad);
  end if;

  -- 확정과의 관계(설계서 B-②): 그 해에 세무사 확정이 서 있으면 ECOUNT 잠정은 받지 않는다.
  if exists (select 1 from official_statements
              where business_id = v_imp.business_id and period_kind = 'year' and period_key = v_imp.period_key
                and basis = 'accountant' and superseded_at is null) then
    raise exception using errcode = 'P0001', message = 'official_confirmed',
      detail = format('%s년은 세무사 확정 결산이 이미 있다.', v_imp.period_key);
  end if;

  -- 자산 + 부채 + 자본 = 0(원장 규약). official_statement_save와 같은 식이다.
  select coalesce(sum((l->>'amount')::numeric), 0)
    into v_balance
    from jsonb_array_elements(p_lines) l
    join accounts a
      on a.business_id = v_imp.business_id and a.account_code = l->>'account_code'
   where a.section in ('cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity');
  if v_balance <> 0 then
    raise exception using errcode = 'P0001', message = 'statement_unbalanced',
      detail = format('재무상태표가 닫히지 않습니다. 차이 %s원', v_balance);
  end if;

  -- 같은 해의 ECOUNT 활성 행(재업로드 = 새 버전 supersede). 세무사 행은 건드리지 않는다.
  select * into v_prev
    from official_statements
   where business_id = v_imp.business_id and period_kind = 'year' and period_key = v_imp.period_key
     and basis = 'ecount_excel' and superseded_at is null
   for update;
  if found then
    select jsonb_build_object(
             'memo', v_prev.memo,
             'import_id', v_prev.import_id,
             'lines', coalesce(jsonb_agg(jsonb_build_object('account_code', account_code, 'amount', amount)
                                order by account_code), '[]'::jsonb))
      into v_before
      from official_statement_lines where statement_id = v_prev.id;
  end if;

  v_note := ecount_audit_note('annual', v_imp.period_key, v_imp.file_name, v_imp.import_id);
  -- 새 결산 id를 먼저 받는다 — 감사 줄이 그 id를 가리키며 **먼저** 선다(HANDOVER §2 ③).
  v_id := nextval(pg_get_serial_sequence('public.official_statements', 'id'));

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ((case when v_prev.id is null then 'create' else 'update' end)::audit_action,
          'official_statements', v_id::text, v_imp.business_id, auth.uid(), auth_role()::text,
          v_before,
          jsonb_build_object('basis', 'ecount_excel', 'import_id', v_imp.import_id, 'lines', p_lines),
          case when v_prev.id is null then v_note else format('%s — 이전 #%s', v_note, v_prev.id) end);

  if v_prev.id is not null then
    update official_statements set superseded_at = now() where id = v_prev.id;
  end if;

  insert into official_statements
    (id, business_id, period_kind, period_key, evidence_url, memo, created_by, supersedes_id, basis, import_id)
  overriding system value
  values (v_id, v_imp.business_id, 'year', v_imp.period_key, null, v_note, auth.uid(), v_prev.id, 'ecount_excel', v_imp.import_id);

  insert into official_statement_lines (statement_id, business_id, account_code, amount)
  select v_id, v_imp.business_id, l->>'account_code', (l->>'amount')::numeric
    from jsonb_array_elements(p_lines) l;

  update finance_imports
     set status = 'committed',
         summary = coalesce(summary, '{}'::jsonb)
                   || jsonb_build_object('stage', 'committed',
                                         'result', jsonb_build_object('statement_id', v_id, 'lines', jsonb_array_length(p_lines),
                                                                      'supersedes_id', v_prev.id))
   where import_id = v_imp.import_id;

  return v_id;
end;
$fn$;

comment on function official_statement_import_ecount(uuid, text, jsonb) is
  '0051. ECOUNT 연간 재무제표 업로드 등록(basis=ecount_excel · 잠정). 세무사 확정 해 거부 · 균형 · ECOUNT 활성 행 supersede · 감사 먼저 · 헤더 · 줄 · committed를 한 트랜잭션으로.';

revoke all on function official_statement_import_ecount(uuid, text, jsonb) from public, anon;
grant execute on function official_statement_import_ecount(uuid, text, jsonb) to authenticated;

-- =====================================================================
-- 3절. official_statement_save — 세무사 확정 저장을 definer로
--
--   0050:464-534 본문을 **파일에서 그대로 복사**했고, 바꾼 것은 둘이다:
--     ① language 줄의 security invoker → definer (4절이 직접 insert 정책을 지우기 때문)
--     ② 맨 앞 권한 판정 한 덩어리 — 0020 official_statements_insert(can_keep_books and created_by = auth.uid()) ·
--        restrictive 둘(AIAgent · Integration)이 하던 일. created_by는 칸 기본값 auth.uid()가 그대로 적는다.
--   실패 낱말 books_forbidden(42501) — statements.ts가 42501을 «권한이 없습니다»로 그린다(문장 그대로).
-- =====================================================================
create or replace function official_statement_save(
  p_business_id  text,
  p_period_kind  text,
  p_period_key   text,
  p_evidence_url text,
  p_memo         text,
  p_lines        jsonb   -- [{account_code, amount}, ...]
) returns bigint
language plpgsql security definer set search_path = public as $fn$
declare
  v_prev    official_statements%rowtype;
  v_id      bigint;
  v_balance numeric(20, 2);
  v_before  jsonb;
begin
  -- 0051 ②: 정책이 하던 판정을 몸통이 한다(definer라 official_statements의 정책을 안 탄다).
  if auth.uid() is null or not can_keep_books(p_business_id) or auth_role()::text in ('AIAgent', 'Integration') then
    raise exception using errcode = '42501', message = 'books_forbidden',
      detail = '공식 재무제표는 그 회사 재무 쓰기 권한이 있는 사람만 넣는다.';
  end if;

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
  '0020/0047/0050/0051. 공식 재무제표(세무사 확정 — basis accountant) 저장. supersede + 헤더 + 라인 + 감사기록을 한 트랜잭션으로. 닫히지 않으면 예외. 0051부터 security definer — 헤더 · 줄의 직접 insert 정책이 없어서 몸통이 can_keep_books · 사람을 먼저 본다.';

revoke all on function official_statement_save(text, text, text, text, text, jsonb) from public, anon;
grant execute on function official_statement_save(text, text, text, text, text, jsonb) to authenticated;

-- =====================================================================
-- 4절. 구멍 닫기
-- =====================================================================

-- ① 헤더 · 줄은 RPC로만. force를 먼저 내린다(머리 주석 «FORCE와 definer»).
alter table official_statements      no force row level security;
alter table official_statement_lines no force row level security;

-- 0020:79 · 0020:82 · 0020:89. 앱은 이 셋을 직접 쓰지 않는다(supabase.ts는 rpc('official_statement_save')뿐 —
-- 0051 이후 rpc('official_statement_import_ecount')가 더해진다). update(supersede)도 두 RPC 안에서만 한다:
-- 사람이 PostgREST로 활성 결산을 supersede만 하면 «그 해 확정 없음»이 되어 월별 잠금이 풀린다.
drop policy if exists official_statements_insert     on official_statements;
drop policy if exists official_statements_supersede  on official_statements;
drop policy if exists official_statement_lines_insert on official_statement_lines;

-- 자물쇠는 revoke(0035). 읽기(select)는 0047 정책을 그대로 탄다. anon은 아무것도 없다.
revoke all on table official_statements, official_statement_lines from anon;
revoke insert, update, delete, truncate, references, trigger on table official_statements, official_statement_lines from authenticated;
grant select on table official_statements, official_statement_lines to authenticated;

-- ② 복합 FK — 줄의 회사는 헤더의 회사다(리뷰 I-3). 지금까지 줄은 official_statement_save 하나가 헤더와 같은
-- p_business_id로만 넣었으니 이미 있는 줄은 다 맞는다(어긋난 줄이 있으면 이 문장이 실패한다 — 그게 맞다).
alter table official_statements
  add constraint official_statements_business_key unique (id, business_id);
alter table official_statement_lines
  add constraint official_statement_lines_statement_business_fk
    foreign key (statement_id, business_id) references official_statements (id, business_id) on delete cascade;

-- ③ committed는 definer RPC만. 사람은 draft를 고치거나(미리보기) 취소만 한다. 0050:147을 이름 그대로 다시 만든다.
drop policy if exists finance_imports_update on finance_imports;
create policy finance_imports_update on finance_imports
  for update using (can_keep_books(business_id) and created_by = auth.uid() and status = 'draft')
  with check (can_keep_books(business_id) and created_by = auth.uid() and status in ('draft', 'cancelled'));

commit;
