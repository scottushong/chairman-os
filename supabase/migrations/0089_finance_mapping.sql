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
--   4절 fin_legacy_imports — «예전 자료 가져오기»(A2) 옮김 기록(원천 자리마다 한 줄 · 대표만 · 쓰기는 fin_legacy_import_mark만).
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

revoke all on function fin_column_map_save(text, text, jsonb, text) from public, anon;
revoke all on function official_unmatched_save(bigint, jsonb) from public, anon;
revoke all on function fin_legacy_import_mark(text, text, text, text, uuid, text) from public, anon;
grant execute on function fin_column_map_save(text, text, jsonb, text) to authenticated;
grant execute on function official_unmatched_save(bigint, jsonb) to authenticated;
grant execute on function fin_legacy_import_mark(text, text, text, text, uuid, text) to authenticated;

commit;
