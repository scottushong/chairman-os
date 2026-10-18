-- =====================================================================
-- 0083 공식 결산 v2 staging 검사 — 쓰지 않는다(0083을 한 트랜잭션 안에서 적용해 보고 전부 되돌린다).
-- 끝은 언제나 raise exception(«0083 STAGING PASS …») — 버킷 · 칸 · 표 · 함수 · 시험 결산 · 시험 계정 모두 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/0083_official_statement_v2_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0083_official_statement_v2_staging_test.sql"
--   rm -f supabase/.temp/0083_official_statement_v2_staging_test.sql
-- 기대: ERROR  0083 STAGING PASS a(…) b(…) … (DY 계정 n개 — 참고)
-- 0083 본문은 supabase/migrations/0083_official_statement_v2.sql의 begin ~ commit 사이와 같다(scripts로 복사 — 파일을 고치면 다시 만든다).
-- =====================================================================
begin;

-- ── 0083 본문 ──

-- =====================================================================
-- 1절. 증빙 버킷
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('fin-official-evidence', 'fin-official-evidence', false)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'fin-official-evidence' and public) then
    raise exception 'fin-official-evidence 버킷이 공개로 설정되어 있다. 0083의 전제(비공개)가 깨진다 — 콘솔에서 비공개로 되돌린 뒤 다시 적용한다.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$ update storage.buckets set file_size_limit = 20971520 where id = 'fin-official-evidence' $q$;
  end if;
end $$;

-- 경로 «<회사>/<sha256 64자>.<확장자>» 모양인가 → 그 회사.
create or replace function fin_evidence_business(object_name text) returns text
language sql immutable set search_path = public as $fn$
  select case when object_name ~ '^[a-z0-9_]{2,40}/[0-9a-f]{64}\.(pdf|jpg|jpeg|png)$'
              then split_part(object_name, '/', 1) end;
$fn$;

comment on function fin_evidence_business(text) is
  '0083. 공식 결산 증빙 객체 «<회사>/<sha256>.<확장자>»의 회사. 모양이 틀리면 null.';

revoke all on function fin_evidence_business(text) from public, anon;
grant execute on function fin_evidence_business(text) to authenticated;

-- 올리기: 로그인 · 활성 · 사람 · 그 회사 장부를 쓰는 사람. plpgsql invoker(0082 fin_inbox_object_ok와 같은 까닭).
create or replace function fin_evidence_insert_ok(object_name text) returns boolean
language plpgsql stable security invoker set search_path = public as $fn$
declare
  v_biz text := public.fin_evidence_business(object_name);
begin
  if v_biz is null or auth.uid() is null or not public.is_active() then
    return false;
  end if;
  if public.auth_role()::text in ('AIAgent', 'Integration') then
    return false;
  end if;
  return public.can_keep_books(v_biz);
end;
$fn$;

comment on function fin_evidence_insert_ok(text) is
  '0083. 공식 결산 증빙을 올릴 수 있는가 — 사람 · 그 회사 장부를 쓰는 사람(can_keep_books).';

revoke all on function fin_evidence_insert_ok(text) from public, anon;
grant execute on function fin_evidence_insert_ok(text) to authenticated;

drop policy if exists fin_evidence_objects_read on storage.objects;
drop policy if exists fin_evidence_objects_insert on storage.objects;
create policy fin_evidence_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'fin-official-evidence' and public.fin_evidence_business(name) is not null
         and public.can_read_books(public.fin_evidence_business(name)));
create policy fin_evidence_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fin-official-evidence' and public.fin_evidence_insert_ok(name));
-- update · delete 정책 없음(Default Deny) — 확정 결산의 근거는 옮기거나 지우지 않는다.

-- =====================================================================
-- 2절. official_statements — 증빙 파일 · 닫히지 않은 이유
-- =====================================================================
alter table official_statements
  add column evidence_file text
    check (evidence_file is null or fin_evidence_business(evidence_file) is not null),          -- [제한]
  add column unbalanced_reason text
    check (unbalanced_reason is null or length(btrim(unbalanced_reason)) between 5 and 500);   -- [제한]

-- 증빙 파일의 회사는 결산의 회사다.
alter table official_statements
  add constraint official_statements_evidence_file_business
    check (evidence_file is null or fin_evidence_business(evidence_file) = business_id);

comment on column official_statements.evidence_file is
  '0083. 세무사 확정 결산의 원본 파일(fin-official-evidence «<회사>/<sha256>.<확장자>»). 링크(evidence_url)와 둘 중 하나 이상.';
comment on column official_statements.unbalanced_reason is
  '0083. 재무상태표가 닫히지 않은 채 저장했으면 그 이유(대표 · 그룹 CFO · 마감 권한자만). 닫혔으면 null.';

alter table official_statements drop constraint official_statements_evidence_check;
alter table official_statements add constraint official_statements_evidence_check check (
  (evidence_url is null or evidence_url ~* '^https?://')
  and case basis
        when 'accountant'   then (evidence_url is not null or evidence_file is not null) and import_id is null
        when 'ecount_excel' then import_id is not null
        else false
      end
);

-- =====================================================================
-- 3절. 계정 맞춤 학습
-- =====================================================================
create table official_account_map (
  business_id  text not null,                                                                   -- [일반]
  -- «묶음:이름» — 묶음은 lib/finance-upload/official-lines.ts의 OfficialGroup(asset · sga …), 이름은 번호 · 띄어쓰기 · 괄호를 뗀 것.
  std_key      text not null check (std_key ~ '^[a-z_]{1,20}:.{1,80}$'),                         -- [일반]
  account_code text not null,                                                                   -- [일반]
  hits         int not null default 1 check (hits >= 1),                                        -- [일반]
  updated_by   uuid not null default auth.uid(),                                                -- [제한]
  updated_at   timestamptz not null default now(),
  primary key (business_id, std_key),
  foreign key (business_id, account_code) references accounts (business_id, account_code) on delete cascade
);

comment on table official_account_map is
  '0083. 공식 결산 계정 맞춤 학습 — 표준재무제표 줄(묶음:이름) → 회사 계정. official_statement_save_v2가 저장한 결산 줄로 쓴다(직접 쓰기 없음).';

alter table official_account_map enable row level security;
revoke all on table official_account_map from public, anon, authenticated;
grant select on table official_account_map to authenticated;
create policy official_account_map_read on official_account_map for select to authenticated
  using (can_read_books(business_id));

-- =====================================================================
-- 4절. official_statement_save_v2
--
--   0051:441-517 official_statement_save 본문을 바탕으로(옛 함수는 그대로 남긴다 — 앱이 DB보다 먼저 나가도 옛 길이 돈다).
--   더한 것: ① 증빙 = 링크 또는 파일(파일은 그 회사 증빙 버킷에 정말 있어야) ② 닫히지 않으면 can_close_books + 이유
--   ③ 같은 해 확정이 있으면 p_replace일 때만 ④ 학습(p_learn — 저장한 줄에 든 계정만) ⑤ 한 계정 한 줄(23505 대신 말로).
--   실패 낱말: books_forbidden(42501) · official_evidence_missing · official_evidence_file_missing · official_unbalanced ·
--   official_unbalanced_forbidden · official_exists · official_line_duplicate · official_line_unknown_account.
-- =====================================================================
create or replace function official_statement_save_v2(
  p_business_id       text,
  p_period_kind       text,
  p_period_key        text,
  p_evidence_url      text,
  p_evidence_file     text,
  p_memo              text,
  p_lines             jsonb,   -- [{account_code, amount}, ...]
  p_unbalanced_reason text,
  p_replace           boolean,
  p_learn             jsonb    -- [{std_key, account_code}, ...]
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_prev    official_statements%rowtype;
  v_id      bigint;
  v_balance numeric(20, 2);
  v_before  jsonb;
  v_url     text := nullif(btrim(coalesce(p_evidence_url, '')), '');
  v_file    text := nullif(btrim(coalesce(p_evidence_file, '')), '');
  v_reason  text := nullif(btrim(coalesce(p_unbalanced_reason, '')), '');
begin
  if auth.uid() is null or not can_keep_books(p_business_id) or auth_role()::text in ('AIAgent', 'Integration') then
    raise exception using errcode = '42501', message = 'books_forbidden',
      detail = '공식 재무제표는 그 회사 재무 쓰기 권한이 있는 사람만 넣는다.';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '재무제표에 줄이 하나도 없습니다.';
  end if;

  -- ① 증빙 — 링크 또는 이 회사 증빙 버킷의 파일.
  if v_url is null and v_file is null then
    raise exception using errcode = 'P0001', message = 'official_evidence_missing',
      detail = '확정 결산에는 증빙(올린 원본 파일 또는 링크)이 있어야 한다.';
  end if;
  if v_url is not null and v_url !~* '^https?://' then
    raise exception using errcode = 'P0001', message = 'official_evidence_missing', detail = '증빙 링크는 http(s) 주소다.';
  end if;
  if v_file is not null and (fin_evidence_business(v_file) is distinct from p_business_id
     or not exists (select 1 from storage.objects o where o.bucket_id = 'fin-official-evidence' and o.name = v_file)) then
    raise exception using errcode = 'P0001', message = 'official_evidence_file_missing',
      detail = '증빙 파일이 이 회사 증빙 보관함에 없다 — 파일을 다시 올린다.';
  end if;

  -- ⑤ 한 계정 한 줄 · 장부에 있는 계정(앱이 같은 계정을 더해 보낸다 — 0020 줄 키가 statement_id + account_code).
  if exists (select 1 from jsonb_array_elements(p_lines) l group by l->>'account_code' having count(*) > 1) then
    raise exception using errcode = 'P0001', message = 'official_line_duplicate', detail = '같은 계정이 두 줄이다 — 더해서 한 줄로 보낸다.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
              where not exists (select 1 from accounts a where a.business_id = p_business_id and a.account_code = l->>'account_code')) then
    raise exception using errcode = 'P0001', message = 'official_line_unknown_account', detail = '계정과목표에 없는 계정이 있다.';
  end if;

  -- ② 자산 + 부채 + 자본 = 0(원장 규약). 안 닫히면 대표 · CFO · 마감 권한자가 이유를 적어야.
  select coalesce(sum(round((l->>'amount')::numeric, 2)), 0)
    into v_balance
    from jsonb_array_elements(p_lines) l
    join accounts a
      on a.business_id = p_business_id and a.account_code = l->>'account_code'
   where a.section in ('cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity');

  if v_balance <> 0 then
    if v_reason is null or length(v_reason) < 5 then
      raise exception using errcode = 'P0001', message = 'official_unbalanced',
        detail = format('재무상태표가 닫히지 않습니다. 차이 %s원', v_balance);
    end if;
    if not can_close_books(p_business_id) then
      raise exception using errcode = '42501', message = 'official_unbalanced_forbidden',
        detail = '닫히지 않은 결산은 대표 · 그룹 CFO · 마감 권한자만 이유를 적고 저장한다.';
    end if;
  else
    v_reason := null;
  end if;

  select * into v_prev
    from official_statements
   where business_id = p_business_id
     and period_kind = p_period_kind
     and period_key  = p_period_key
     and basis = 'accountant'
     and superseded_at is null;

  if found then
    -- ③ 이미 그 해 확정이 있다 — 화면이 «바꾸기»를 확인했을 때만.
    if not coalesce(p_replace, false) then
      raise exception using errcode = 'P0001', message = 'official_exists',
        detail = format('%s %s 확정 결산(#%s)이 이미 있다 — 바꾸려면 확인한다.', p_period_kind, p_period_key, v_prev.id);
    end if;
    select jsonb_build_object(
             'memo', v_prev.memo,
             'evidence_url', v_prev.evidence_url,
             'evidence_file', v_prev.evidence_file,
             'lines', coalesce(jsonb_agg(jsonb_build_object('account_code', account_code, 'amount', amount)
                                order by account_code), '[]'::jsonb))
      into v_before
      from official_statement_lines where statement_id = v_prev.id;

    update official_statements set superseded_at = now() where id = v_prev.id;
  end if;

  insert into official_statements (business_id, period_kind, period_key, evidence_url, evidence_file, unbalanced_reason, memo, supersedes_id)
  values (p_business_id, p_period_kind, p_period_key, v_url, v_file, v_reason, p_memo, v_prev.id)
  returning id into v_id;

  insert into official_statement_lines (statement_id, business_id, account_code, amount)
  select v_id, p_business_id, l->>'account_code', round((l->>'amount')::numeric, 2)
    from jsonb_array_elements(p_lines) l;

  -- ④ 학습 — 모양이 맞고 이 회사 계정인 것만(나머지는 조용히 버린다: 학습은 저장의 덤이다).
  if jsonb_typeof(p_learn) = 'array' then
    insert into official_account_map as m (business_id, std_key, account_code)
    select distinct on (k.std_key) p_business_id, k.std_key, k.account_code
      from (select l->>'std_key' as std_key, l->>'account_code' as account_code from jsonb_array_elements(p_learn) l) k
      join accounts a on a.business_id = p_business_id and a.account_code = k.account_code
     where k.std_key ~ '^[a-z_]{1,20}:.{1,80}$'
     order by k.std_key, k.account_code
    on conflict (business_id, std_key) do update
      set account_code = excluded.account_code,
          hits = case when m.account_code = excluded.account_code then m.hits + 1 else 1 end,
          updated_by = auth.uid(),
          updated_at = now();
  end if;

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ((case when v_prev.id is null then 'create' else 'update' end)::audit_action,
          'official_statements', v_id::text, p_business_id, auth.uid(), auth_role()::text,
          v_before,
          jsonb_build_object('memo', p_memo, 'evidence_url', v_url, 'evidence_file', v_file, 'unbalanced_reason', v_reason, 'lines', p_lines),
          case when v_prev.id is null
               then format('공식 재무제표 %s %s', p_period_kind, p_period_key)
               else format('공식 재무제표 정정 %s %s — 이전 #%s', p_period_kind, p_period_key, v_prev.id) end
          || case when v_reason is null then '' else format(' · 닫히지 않음(차이 %s원): %s', v_balance, v_reason) end);

  return v_id;
end;
$fn$;

comment on function official_statement_save_v2(text, text, text, text, text, text, jsonb, text, boolean, jsonb) is
  '0083. 공식 재무제표(세무사 확정) 저장 v2 — 증빙 링크 또는 올린 원본 · 닫히지 않으면 대표 · CFO가 이유와 · 같은 해는 바꾸기 확인 · 계정 맞춤 학습. supersede + 헤더 + 줄 + 학습 + 감사를 한 트랜잭션으로.';

revoke all on function official_statement_save_v2(text, text, text, text, text, text, jsonb, text, boolean, jsonb) from public, anon;
grant execute on function official_statement_save_v2(text, text, text, text, text, text, jsonb, text, boolean, jsonb) to authenticated;

-- ── 검사 ──
do $t$
declare
  v_chair uuid;
  v_out   text := '';
  v_dy    int;
  v_id    bigint;
  v_file  text := 'biz_dy/' || repeat('e', 64) || '.pdf';
  v_lines jsonb := '[{"account_code":"zz83_cash","amount":1000},{"account_code":"zz83_cap","amount":-1000}]';
  v_off   jsonb := '[{"account_code":"zz83_cash","amount":1000},{"account_code":"zz83_cap","amount":-990}]';
  n int;
begin
  select count(*) into v_dy from public.accounts where business_id = 'biz_dy';
  select user_id into v_chair from public.user_profiles where role::text = 'Chairman' and revoked_at is null order by created_at limit 1;
  if v_chair is null then raise exception 'FAIL 준비: 회장 없음'; end if;
  -- 시험 계정 둘(되돌림) — DY 계정표가 비어 있어도 돈다.
  insert into public.accounts (business_id, account_code, name, category, section, cash_flow, source, fetched_at)
  values ('biz_dy', 'zz83_cash', '시험현금', 'asset', 'cash', null, 'manual', now()),
         ('biz_dy', 'zz83_cap', '시험자본', 'equity', 'equity', 'financing', 'manual', now());

  -- a. 버킷 비공개 · 20MB · 칸 · 표
  select count(*) into n from storage.buckets where id = 'fin-official-evidence' and public = false;
  if n <> 1 then raise exception 'FAIL a: 증빙 버킷이 비공개로 없다'; end if;
  v_out := v_out || ' a(비공개 버킷)';

  -- b. 대표 — 증빙 올림 · 봄
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner) values ('fin-official-evidence', v_file, v_chair);
  select count(*) into n from storage.objects where bucket_id = 'fin-official-evidence' and name = v_file;
  if n <> 1 then raise exception 'FAIL b: 올린 증빙을 못 본다'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('fin-official-evidence', 'biz_dy/x.pdf', v_chair);
    raise exception 'FAIL b: 경로 모양이 틀린 증빙을 받았다';
  exception when insufficient_privilege or check_violation then null;
  end;
  update storage.objects set name = 'biz_dy/' || repeat('f', 64) || '.pdf' where bucket_id = 'fin-official-evidence' and name = v_file;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL b: 증빙을 옮겼다'; end if;
  v_out := v_out || ' b(올림 · 봄 · 모양 거부 · 옮기기 0줄)';

  -- c. 링크 없이 원본으로 저장 · 학습
  v_id := public.official_statement_save_v2('biz_dy', 'year', '2099', null, v_file, 'staging 시험', v_lines, null, false,
            '[{"std_key":"asset:현금및현금성자산","account_code":"zz83_cash"}]'::jsonb);
  select count(*) into n from public.official_statements where id = v_id and evidence_url is null and evidence_file = v_file;
  if n <> 1 then raise exception 'FAIL c: 원본 증빙으로 저장되지 않았다'; end if;
  select count(*) into n from public.official_account_map where business_id = 'biz_dy' and std_key = 'asset:현금및현금성자산' and account_code = 'zz83_cash';
  if n <> 1 then raise exception 'FAIL c: 학습 줄이 없다'; end if;
  v_out := v_out || ' c(원본 증빙 저장 · 학습)';

  -- d. 같은 해 — 확인 없이 거부 · 확인하면 바꿈
  begin
    perform public.official_statement_save_v2('biz_dy', 'year', '2099', null, v_file, 'staging 다시', v_lines, null, false, '[]'::jsonb);
    raise exception 'FAIL d: 같은 해를 확인 없이 덮었다';
  exception when others then
    if sqlerrm not like '%official_exists%' then raise; end if;
  end;
  perform public.official_statement_save_v2('biz_dy', 'year', '2099', 'https://example.invalid/x.pdf', null, 'staging 바꿈', v_lines, null, true, '[]'::jsonb);
  v_out := v_out || ' d(같은 해 확인 · 바꾸기)';

  -- e. 안 닫힘 — 이유 없으면 거부 · 대표는 이유와 저장
  begin
    perform public.official_statement_save_v2('biz_dy', 'year', '2098', null, v_file, 'staging 안 닫힘', v_off, null, false, '[]'::jsonb);
    raise exception 'FAIL e: 이유 없이 안 닫힌 결산이 저장됐다';
  exception when others then
    if sqlerrm not like '%official_unbalanced%' then raise; end if;
  end;
  perform public.official_statement_save_v2('biz_dy', 'year', '2098', null, v_file, 'staging 안 닫힘', v_off, '세무사 반올림 차이', false, '[]'::jsonb);
  v_out := v_out || ' e(안 닫힘 이유 · 대표)';

  -- f. 없는 증빙 파일
  begin
    perform public.official_statement_save_v2('biz_dy', 'year', '2097', null, 'biz_dy/' || repeat('0', 64) || '.pdf', 'x', v_lines, null, false, '[]'::jsonb);
    raise exception 'FAIL f: 없는 증빙 파일을 받았다';
  exception when others then
    if sqlerrm not like '%official_evidence_file_missing%' then raise; end if;
  end;
  v_out := v_out || ' f(없는 파일 거부)';

  -- g. 학습 표 직접 쓰기 없음
  begin
    insert into public.official_account_map (business_id, std_key, account_code) values ('biz_dy', 'sga:x', 'zz83_cash');
    raise exception 'FAIL g: 학습 표에 직접 썼다';
  exception when insufficient_privilege then v_out := v_out || ' g(학습 표 직접 쓰기 거부)';
  end;
  reset role;

  raise exception '0083 STAGING PASS% (참고: staging biz_dy 계정 %개)', v_out, v_dy;
end
$t$;

rollback;
