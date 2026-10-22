-- =====================================================================
-- Chairman OS — 0089_finance_mapping (재무 보강 — ECOUNT 엑셀은 받은 그대로 · 공식 결산 미매칭 다시 맞춤)
-- 작성: 2026-10-20 · 결정 docs/decisions/2026-10-20-finance-mapping.md
--
-- ■ 왜 ■ (대표 지시 2026-10-20 PHASE A)
--   A1 엑셀은 ECOUNT에서 받은 그대로 받는다 — 열 이름이 우리 낱말과 다르면 비슷한 이름 표 → (그래도 안 되면) AI 한 번으로 맞추고,
--      맞춘 결과를 (회사, 종류)마다 저장해 다음부터 AI 없이 읽는다. 못 맞춘 열만 «이 열은 무엇입니까?»로 한 번 묻는다.
--      (0070 fin_upload_shapes는 «시트명 + 머리글 줄 전체» 서명이라 시트명 · 열 하나만 달라도 다시 AI를 불렀다 — 이 표는 머리글 글 하나씩.)
--   A3 계정과목표가 올라오면 공식 결산(0083 · 0085 «놓으면 저장»)에서 계정을 못 맞춰 «기타 …(자동)»에 넣은 줄을 다시 맞춘다 —
--      그러려면 그 줄(문서의 줄 이름 · 묶음 · 금액)을 어딘가 두어야 한다(0020 줄은 계정 · 금액만 둔다).
--
-- ■ 더하는 것 ■ (앞 번호 파일 · 함수는 고치지 않는다)
--   1절 fin_column_maps — (회사, 종류) → {머리글 글: 칸 이름 | '-'(쓰지 않음)}. 숫자 없음. 읽기 · 쓰기는 그 회사 장부를 쓰는 사람(can_keep_books).
--        쓰기는 정의자 함수 fin_column_map_save만(표에 직접 쓰기 grant 없음 · 있는 맞춤에 더한다 · 값 모양을 본다).
--   2절 official_unmatched_lines — 공식 결산(official_statements.id)마다 «다시 맞출 줄»(std_key · 줄 이름 · 묶음 · 문서 값 · 지금 들어 있는 계정).
--        읽기는 장부를 읽는 사람(can_read_books — 결산 줄과 같다) · 쓰기는 official_unmatched_save(장부를 쓰는 사람 · 활성 결산만 · 통째로 바꾸기).
--   3절 기능 스위치 finance_upload_ai(엑셀 열 맞추기 AI · 기본 전원 — 0089 전과 같은 동작. 대표가 회사 줄로 끈다)
--        · finance_legacy_import(«예전 자료 가져오기» 단추 · 기본 대표만).
--   4절 fin_legacy_imports — «예전 자료 가져오기»(A2) 옮김 기록(원천 자리마다 한 줄 · 대표만 · 쓰기는 fin_legacy_import_mark만)
--        · 수신함 읽기 정책 하나(fin_inbox_objects_legacy_read — 대표 + 스위치 켜짐일 때 그 회사 폴더 전체 select만, 쓰기 · 지우기 없음).
--   5절 owner_inputs — «받을 것»(PHASE E: 진짜 BOM · 세무사 재고평가방법 · 구글 서비스 계정(Vault) · 원가 관리 권한자) 받음 기록 · 대표만
--        · 쓰기는 owner_input_mark · owner_input_google_sa_save(키 본문은 Vault에만) · 스위치 owner_inputs(기본 대표만).
--
-- 0035 규칙: force를 새로 걸지 않는다 · FORCE를 내리지 않는다 · 0001~0088을 고치지 않는다. 새 정책 · grant는 늘 to authenticated.
-- 정의자 함수는 auth.uid()가 없으면(익명 · service) 거부한다.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. (회사, 종류) 열 맞춤
-- =====================================================================
create table fin_column_maps (
  business_id text not null references businesses(business_id) on delete restrict,   -- [일반]
  kind        text not null,                                                          -- [일반] 자료 종류(0085 fin_uploads_kind_known과 같은 목록)
  label_map   jsonb not null check (jsonb_typeof(label_map) = 'object'),              -- [일반] 머리글 글(띄어쓰기 없는 소문자) → 칸 이름 · '-'
  source      text not null default 'code' check (source in ('code', 'ai', 'person')), -- [일반] 마지막으로 더한 쪽(비슷한 이름 · AI · 사람)
  updated_by  uuid not null default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (business_id, kind),
  constraint fin_column_maps_kind_known check (kind in ('sales', 'purchase_in', 'inventory', 'production', 'ledger', 'payroll', 'import', 'cashflow', 'card',
    'overseas', 'promo', 'loans', 'borrowings', 'savings', 'valuation', 'material_issue', 'tax_invoice', 'ledger_lines', 'shipment'))
);
comment on table fin_column_maps is
  '0089. 자료 올리기 열 맞춤 — (회사, 종류)마다 ECOUNT 머리글 글 → 칸 이름. 숫자는 두지 않는다. 쓰기는 fin_column_map_save만.';
alter table fin_column_maps enable row level security;
revoke all on table fin_column_maps from public, anon, authenticated;
grant select on table fin_column_maps to authenticated;
create policy fin_column_maps_read on fin_column_maps for select to authenticated using (can_keep_books(business_id));

/** 열 맞춤 저장 — 있는 맞춤에 더한다(같은 머리글은 새 값). 값은 칸 이름 모양(영문 소문자 · 숫자 · _) 또는 '-'만, 머리글은 40자까지. */
create or replace function fin_column_map_save(p_business text, p_kind text, p_map jsonb, p_source text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_merged jsonb;
begin
  if auth.uid() is null or not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('sales', 'purchase_in', 'inventory', 'production', 'ledger', 'payroll', 'import', 'cashflow', 'card',
       'overseas', 'promo', 'loans', 'borrowings', 'savings', 'valuation', 'material_issue', 'tax_invoice', 'ledger_lines', 'shipment')
     or coalesce(p_source, '') not in ('code', 'ai', 'person')
     or p_map is null or jsonb_typeof(p_map) <> 'object'
     or (select count(*) from jsonb_each(p_map)) not between 1 and 80
     or exists (select 1 from jsonb_each(p_map) e
                 where length(e.key) not between 1 and 40
                    or jsonb_typeof(e.value) <> 'string'
                    or (e.value #>> '{}') !~ '^([a-z][a-z0-9_]{0,39}|-)$') then
    raise exception 'fin_column_map_shape' using errcode = '22023';
  end if;
  select coalesce(m.label_map, '{}'::jsonb) || p_map into v_merged from (select 1) one left join fin_column_maps m on m.business_id = p_business and m.kind = p_kind;
  if (select count(*) from jsonb_each(v_merged)) > 200 then
    raise exception 'fin_column_map_shape' using errcode = '22023';
  end if;
  insert into fin_column_maps as m (business_id, kind, label_map, source)
  values (p_business, p_kind, v_merged, p_source)
  on conflict (business_id, kind) do update
     set label_map = excluded.label_map, source = excluded.source, updated_by = auth.uid(), updated_at = now();
end;
$fn$;

-- =====================================================================
-- 2절. 공식 결산 «다시 맞출 줄»
-- =====================================================================
create table official_unmatched_lines (
  statement_id bigint not null references official_statements(id) on delete restrict,  -- [일반]
  business_id  text not null references businesses(business_id) on delete restrict,   -- [일반] 결산의 회사(정의자 함수가 결산에서 채운다)
  std_key      text not null check (std_key ~ '^[a-z_]{1,20}:.{1,80}$'),               -- [일반] 0083 학습 열쇠 «묶음:이름»
  label        text not null check (length(label) between 1 and 200),                 -- [일반] 문서의 줄 이름(번호 그대로)
  grp          text check (grp is null or grp ~ '^[a-z_]{1,20}$'),                     -- [일반] 묶음(asset · sga …)
  printed      numeric(18, 2) not null,                                                 -- [제한] 문서에 찍힌 값(그 해)
  from_code    text not null check (length(from_code) between 1 and 20),               -- [일반] 지금 이 줄이 든 계정(기타 · 묶음 계정)
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  primary key (statement_id, std_key)
);
comment on table official_unmatched_lines is
  '0089. 공식 결산에서 계정을 못 맞춰 기타(자동) · 묶음 계정에 넣은 줄. 계정과목표가 올라오면 앱이 다시 맞춰 같은 해 결산을 바꾸기로 새로 세운다. 쓰기는 official_unmatched_save만.';
create index official_unmatched_lines_business on official_unmatched_lines (business_id);
alter table official_unmatched_lines enable row level security;
revoke all on table official_unmatched_lines from public, anon, authenticated;
grant select on table official_unmatched_lines to authenticated;
create policy official_unmatched_lines_read on official_unmatched_lines for select to authenticated using (can_read_books(business_id));

/**
 * 그 결산의 «다시 맞출 줄»을 통째로 바꾼다(빈 배열 = 지움). 장부를 쓰는 사람 · 활성(밀려나지 않은) 세무사 결산만.
 * 실패 낱말: books_forbidden(42501) · official_unmatched_state · official_unmatched_shape.
 */
create or replace function official_unmatched_save(p_statement bigint, p_lines jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_st official_statements;
  v_n  int;
begin
  select * into v_st from official_statements where id = p_statement;
  if v_st.id is null or auth.uid() is null or not coalesce(can_keep_books(v_st.business_id), false) then
    raise exception 'books_forbidden' using errcode = '42501';
  end if;
  if v_st.superseded_at is not null then
    raise exception 'official_unmatched_state' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 500
     or exists (select 1 from jsonb_array_elements(p_lines) l
                 where jsonb_typeof(l) <> 'object'
                    or coalesce(l->>'std_key', '') !~ '^[a-z_]{1,20}:.{1,80}$'
                    or length(coalesce(l->>'label', '')) not between 1 and 200
                    or length(coalesce(l->>'from_code', '')) not between 1 and 20
                    or jsonb_typeof(l->'printed') <> 'number'
                    or (l ? 'grp' and jsonb_typeof(l->'grp') <> 'null' and coalesce(l->>'grp', '') !~ '^[a-z_]{1,20}$')) then
    raise exception 'official_unmatched_shape' using errcode = '22023';
  end if;
  delete from official_unmatched_lines where statement_id = p_statement;
  insert into official_unmatched_lines (statement_id, business_id, std_key, label, grp, printed, from_code)
  select distinct on (l->>'std_key') p_statement, v_st.business_id, l->>'std_key', l->>'label', nullif(l->>'grp', ''), round((l->>'printed')::numeric, 2), l->>'from_code'
    from jsonb_array_elements(p_lines) l
   order by l->>'std_key';
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- =====================================================================
-- 3절. 기능 스위치(0073) — 엑셀 열 맞추기 AI(기본 전원: 0089 전에도 엑셀 해석 AI는 한도 안에서 누구에게나 돌았다)
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'finance_upload_ai', true, 'all', '기본값(0089)'),
  (null, 'finance_legacy_import', true, 'chairman', '기본값(0089)')
on conflict do nothing;

-- =====================================================================
-- 4절. «예전 자료 가져오기» 옮김 기록(A2 — 2026-10-20 · docs/decisions/2026-10-20-finance-legacy.md)
--   0082 · 0083 방식으로 들어온 것(수신함에 남은 파일 · «확인 필요»에 있던 예전 대기 · 공식 결산 증빙 PDF · 월별 입력 전표)을
--   0085 저장(fin_upload_save · 공식 결산 «놓으면 저장»)으로 옮길 때, 무엇을 이미 옮겼는지 적는다 — 두 번 눌러도 다시 넣지 않게.
--   숫자 · 파일 내용은 두지 않는다(원천 자리 · 결과 · 짧은 메모만). 대표만 적고 읽는다(단추가 대표만).
--   실패(failed)로 적힌 것만 다음 누름에서 다시 해 본다(그때 결과로 바꾼다). 'run'은 «한 번이라도 눌렀다»는 표시(수신함 정리 재개).
-- =====================================================================
create table fin_legacy_imports (
  business_id text not null references businesses(business_id) on delete restrict,             -- [일반]
  source      text not null check (source in ('inbox', 'pending', 'evidence', 'monthly', 'run')), -- [일반] 원천 종류
  source_ref  text not null check (length(source_ref) between 1 and 300),                       -- [일반] 수신함 경로 · 올리기 id · 증빙 경로 · 달 · 누른 시각
  outcome     text not null check (outcome in ('saved', 'held', 'failed', 'already', 'skipped')), -- [일반]
  upload_id   uuid,                                                                               -- [일반] 만든 · 쓴 fin_uploads(있으면)
  note        text check (note is null or length(note) <= 300),                                   -- [일반] 사람 말 한 줄(숫자 원문 없음)
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (business_id, source, source_ref)
);
comment on table fin_legacy_imports is
  '0089. «예전 자료 가져오기» 옮김 기록 — 원천 자리마다 한 줄(두 번 눌러도 다시 넣지 않음). 쓰기는 fin_legacy_import_mark(대표)만.';
alter table fin_legacy_imports enable row level security;
revoke all on table fin_legacy_imports from public, anon, authenticated;
grant select on table fin_legacy_imports to authenticated;
create policy fin_legacy_imports_read on fin_legacy_imports for select to authenticated
  using (coalesce(auth_role()::text, '') = 'Chairman' and is_active());

/** 옮김 한 줄 — 대표(활성 · 사람)만. 같은 자리가 이미 있으면 그 줄이 실패였을 때만 새 결과로 바꾼다. 돌려주는 값 = 적었나. */
create or replace function fin_legacy_import_mark(p_business text, p_source text, p_ref text, p_outcome text, p_upload uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_n int;
begin
  if auth.uid() is null or coalesce(auth_role()::text, '') <> 'Chairman' or not is_active() then
    raise exception 'fin_legacy_denied' using errcode = '42501';
  end if;
  if not exists (select 1 from businesses b where b.business_id = p_business) then
    raise exception 'fin_legacy_shape' using errcode = '22023';
  end if;
  if coalesce(p_source, '') not in ('inbox', 'pending', 'evidence', 'monthly', 'run')
     or coalesce(p_outcome, '') not in ('saved', 'held', 'failed', 'already', 'skipped')
     or length(coalesce(p_ref, '')) not between 1 and 300 then
    raise exception 'fin_legacy_shape' using errcode = '22023';
  end if;
  insert into fin_legacy_imports as l (business_id, source, source_ref, outcome, upload_id, note)
  values (p_business, p_source, p_ref, p_outcome, p_upload, left(nullif(btrim(coalesce(p_note, '')), ''), 300))
  on conflict (business_id, source, source_ref) do update
     set outcome = excluded.outcome, upload_id = excluded.upload_id, note = excluded.note, created_by = auth.uid(), created_at = now()
   where l.outcome = 'failed';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;

-- 4절 이어서 — «예전 자료 가져오기»가 그 회사 수신함 전체(직원 폴더 포함)를 읽는 좁은 문.
--   0082는 «본인 폴더만»이다. 이 단추는 «한 번 누르면 전부»라 남의 폴더에 끊겨 남은 파일도 옮겨야 한다(대표 지시 2026-10-20).
--   **읽기(select)만** · 대표(활성 · 사람) · 스위치 finance_legacy_import가 그 회사에 켜져 있을 때만 · 그 회사 장부를 쓰는 사람.
--   쓰기 · 지우기 · 바꾸기 정책은 늘리지 않는다(남의 파일은 옮긴 뒤에도 지우지 않는다). 스위치를 끄면 0082 그대로(본인 폴더만).
create or replace function fin_inbox_legacy_read_ok(object_name text) returns boolean
language plpgsql stable security invoker set search_path = public as $fn$
declare
  v_parts text[];
begin
  if auth.uid() is null or not public.is_active() or coalesce(public.auth_role()::text, '') <> 'Chairman' then
    return false;
  end if;
  v_parts := string_to_array(object_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 or v_parts[3] = '' or v_parts[1] !~ '^[a-z0-9_]{2,40}$' then
    return false;
  end if;
  return public.feature_on('finance_legacy_import', v_parts[1]) and public.can_keep_books(v_parts[1]);
end;
$fn$;

comment on function fin_inbox_legacy_read_ok(text) is
  '0089. «예전 자료 가져오기» — 대표 · 스위치 finance_legacy_import 켜짐 · 그 회사 장부 쓰기일 때 수신함 «<회사>/<누구든>/<이름>» 읽기만.';

revoke all on function fin_inbox_legacy_read_ok(text) from public, anon;
grant execute on function fin_inbox_legacy_read_ok(text) to authenticated;

drop policy if exists fin_inbox_objects_legacy_read on storage.objects;
create policy fin_inbox_objects_legacy_read on storage.objects for select to authenticated
  using (bucket_id = 'fin-upload-inbox' and public.fin_inbox_legacy_read_ok(name));

revoke all on function fin_column_map_save(text, text, jsonb, text) from public, anon;
revoke all on function official_unmatched_save(bigint, jsonb) from public, anon;
revoke all on function fin_legacy_import_mark(text, text, text, text, uuid, text) from public, anon;
grant execute on function fin_column_map_save(text, text, jsonb, text) to authenticated;
grant execute on function official_unmatched_save(bigint, jsonb) to authenticated;
grant execute on function fin_legacy_import_mark(text, text, text, text, uuid, text) to authenticated;

-- =====================================================================
-- 5절. «받을 것»(owner_inputs) — 사람이 줘야 하는 것 넷의 받는 자리(PHASE E · docs/decisions/2026-10-20-intake-items.md)
--   /settings «받을 것» 카드 넷: 진짜 BOM(R2) · 세무사 재고평가방법 · 구글 서비스 계정 · 원가 관리 권한자.
--   표 이름이 intake_items가 아닌 이유: intake_items는 0058 «자료 받는 입구»가 이미 쓴다.
--   이 표는 «받았다 · 언제 · 누가 · 짧은 요약»만 둔다 — 파일 · 키 본문은 두지 않는다.
--     real_bom         (회사)  {"rows": n}                         진짜 BOM은 기존 넣기 흐름(0068 · 0063 암호문)이 저장한다 — 여기는 «받음»만.
--     inventory_method (회사)  {"method": total_avg|moving_avg|fifo, "memo": …}  0075 fin_pl_settings와 나란히 둔 «세무사 확인값»(바꾸지 않는다).
--     google_sa        (group) {"client_email", "project_id", "secret"}  키 JSON은 Vault 'google_sheets_sa'에만. 이 표 · 응답 · 오류에 키 본문 없음.
--     cost_manager     (회사)  {"user_id"}                         기존 원가 권한('/costing/<회사>' 줄 · 0061 셋까지)을 준 뒤에만 적힌다.
--   읽기 · 쓰기 모두 대표(Chairman · 활성 · 사람)만 · 스위치 owner_inputs(기본 대표만). 표에 직접 쓰기 grant 없음.
--   쓰기는 정의자 함수 둘(owner_input_mark · owner_input_google_sa_save)만 — 안에서 auth.uid() · 대표 · 활성을 본다.
-- =====================================================================
create table owner_inputs (
  item_key    text not null check (item_key in ('real_bom', 'inventory_method', 'google_sa', 'cost_manager')), -- [일반]
  scope       text not null check (scope ~ '^[a-z0-9_]{2,40}$'),                                               -- [일반] 'group' 또는 회사 id
  summary     jsonb not null default '{}'::jsonb
                check (jsonb_typeof(summary) = 'object' and length(summary::text) <= 2000),                     -- [일반] 짧은 요약(키 · 파일 본문 없음)
  received_by uuid not null default auth.uid(),
  received_at timestamptz not null default now(),
  primary key (item_key, scope)
);
comment on table owner_inputs is
  '0089. «받을 것» — 사람이 줘야 하는 것(진짜 BOM · 세무사 재고평가방법 · 구글 서비스 계정 · 원가 관리 권한자)을 받은 때 · 누가 · 짧은 요약. 키 · 파일 본문은 두지 않는다. 대표만 읽고, 쓰기는 owner_input_mark · owner_input_google_sa_save만.';
alter table owner_inputs enable row level security;
revoke all on table owner_inputs from public, anon, authenticated;
grant select on table owner_inputs to authenticated;
create policy owner_inputs_read on owner_inputs for select to authenticated
  using (coalesce(auth_role()::text, '') = 'Chairman' and is_active() and feature_on('owner_inputs', null));

insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'owner_inputs', true, 'chairman', '기본값(0089)')
on conflict do nothing;

/**
 * 받음 한 줄(진짜 BOM · 재고평가방법 · 원가 관리 권한자). 대표(활성 · 사람) · 스위치 켜짐만. 같은 (항목, 회사)는 새 값으로 바꾼다.
 * 구글 서비스 계정은 여기로 받지 않는다(owner_input_google_sa_save만 — 키는 Vault).
 * 실패 낱말: owner_input_denied(42501) · owner_input_shape(22023) · owner_input_no_grant(22023 — 원가 권한을 먼저 주지 않았다).
 */
create or replace function owner_input_mark(p_item text, p_scope text, p_summary jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if auth.uid() is null or coalesce(auth_role()::text, '') <> 'Chairman' or not is_active() or not feature_on('owner_inputs', null) then
    raise exception 'owner_input_denied' using errcode = '42501';
  end if;
  if coalesce(p_item, '') not in ('real_bom', 'inventory_method', 'cost_manager')
     or not exists (select 1 from businesses b where b.business_id = p_scope)
     or p_summary is null or jsonb_typeof(p_summary) <> 'object' or length(p_summary::text) > 2000 then
    raise exception 'owner_input_shape' using errcode = '22023';
  end if;
  if p_item = 'real_bom' then
    -- 순서대로 본다(숫자 변환은 숫자인 것이 확인된 뒤에만 — or 안의 평가 순서는 정해져 있지 않다).
    if exists (select 1 from jsonb_object_keys(p_summary) k where k <> 'rows') or jsonb_typeof(p_summary->'rows') is distinct from 'number' then
      raise exception 'owner_input_shape' using errcode = '22023';
    end if;
    if (p_summary->>'rows')::numeric < 0 or (p_summary->>'rows')::numeric <> trunc((p_summary->>'rows')::numeric) then
      raise exception 'owner_input_shape' using errcode = '22023';
    end if;
  end if;
  if p_item = 'inventory_method' and (
       exists (select 1 from jsonb_object_keys(p_summary) k where k not in ('method', 'memo'))
       or coalesce(p_summary->>'method', '') not in ('total_avg', 'moving_avg', 'fifo')
       or (p_summary ? 'memo' and (jsonb_typeof(p_summary->'memo') <> 'string' or length(p_summary->>'memo') > 500))) then
    raise exception 'owner_input_shape' using errcode = '22023';
  end if;
  if p_item = 'cost_manager' then
    if exists (select 1 from jsonb_object_keys(p_summary) k where k <> 'user_id')
       or coalesce(p_summary->>'user_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'owner_input_shape' using errcode = '22023';
    end if;
    -- 기록만으로 권한이 생기지 않는다 — 기존 원가 권한 줄(0061 '/costing/<회사>' · 쓰기)이 이미 있어야 적힌다(거짓 «받음» 막기).
    if not exists (select 1 from user_module_access m join user_profiles p on p.user_id = m.user_id
                    where m.user_id = (p_summary->>'user_id')::uuid and m.module = '/costing/' || p_scope and m.can_write
                      and p.revoked_at is null) then
      raise exception 'owner_input_no_grant' using errcode = '22023';
    end if;
  end if;
  insert into owner_inputs as o (item_key, scope, summary)
  values (p_item, p_scope, p_summary)
  on conflict (item_key, scope) do update
     set summary = excluded.summary, received_by = auth.uid(), received_at = now();
end;
$fn$;

/**
 * 구글 서비스 계정 키(JSON 본문) → Vault 'google_sheets_sa'(있으면 바꾸기). 대표(활성 · 사람) · 스위치 켜짐만.
 * 모양: JSON 객체 · type = service_account · private_key(글) · client_email(…gserviceaccount.com) · project_id. 하나라도 틀리면 owner_input_sa_shape.
 * **키 본문은 어디에도 다시 나가지 않는다** — 돌려주는 값 · 이 표 · 오류 문장에는 client_email · project_id · 비밀 이름만.
 * JSON 해석 오류(DETAIL에 원문 조각이 실린다)와 Vault 오류는 모두 삼켜 낱말 하나로 바꾼다. 이 함수에는 raise notice가 없다.
 * Vault는 동적 SQL로 부른다(vault가 없는 DB — PGlite — 에서도 파일이 올라가게. 없으면 owner_input_vault_missing).
 * 실패 낱말: owner_input_denied(42501) · owner_input_sa_shape(22023) · owner_input_vault_missing(55000).
 */
create or replace function owner_input_google_sa_save(p_json text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v       jsonb;
  v_id    uuid;
  v_sum   jsonb;
begin
  if auth.uid() is null or coalesce(auth_role()::text, '') <> 'Chairman' or not is_active() or not feature_on('owner_inputs', null) then
    raise exception 'owner_input_denied' using errcode = '42501';
  end if;
  if p_json is null or length(p_json) not between 50 and 20000 then
    raise exception 'owner_input_sa_shape' using errcode = '22023';
  end if;
  begin
    v := p_json::jsonb;
  exception when others then
    v := null;
  end;
  if v is null or jsonb_typeof(v) <> 'object'
     or (v->>'type') is distinct from 'service_account'
     or jsonb_typeof(v->'private_key') is distinct from 'string' or length(v->>'private_key') < 20
     or coalesce(v->>'client_email', '') !~ '^[a-z0-9._-]{1,100}@[a-z0-9.-]{1,100}\.gserviceaccount\.com$'
     or coalesce(v->>'project_id', '') !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'owner_input_sa_shape' using errcode = '22023';
  end if;
  v_sum := jsonb_build_object('client_email', v->>'client_email', 'project_id', v->>'project_id', 'secret', 'google_sheets_sa');
  v := null;
  begin
    execute 'select id from vault.secrets where name = $1 limit 1' into v_id using 'google_sheets_sa';
    if v_id is null then
      execute 'select vault.create_secret($1, $2, $3)' into v_id using p_json, 'google_sheets_sa', 'chairman-os 0089 구글 서비스 계정(시트 읽기) — /settings «받을 것»에서 대표가 올림';
    else
      execute 'select vault.update_secret($1, $2)' using v_id, p_json;
    end if;
  exception when others then
    raise exception 'owner_input_vault_missing' using errcode = '55000';
  end;
  insert into owner_inputs as o (item_key, scope, summary)
  values ('google_sa', 'group', v_sum)
  on conflict (item_key, scope) do update
     set summary = excluded.summary, received_by = auth.uid(), received_at = now();
  return v_sum;
end;
$fn$;

revoke all on function owner_input_mark(text, text, jsonb) from public, anon;
revoke all on function owner_input_google_sa_save(text) from public, anon;
grant execute on function owner_input_mark(text, text, jsonb) to authenticated;
grant execute on function owner_input_google_sa_save(text) to authenticated;

commit;
