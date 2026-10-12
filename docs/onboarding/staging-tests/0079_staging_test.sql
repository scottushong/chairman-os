-- =====================================================================
-- 0079 staging 검사(원장 → 장부 반영 — ledger_post_*) — 쓰지 않는다.
-- 0079가 **적용된 뒤** staging에서 돌린다. 끝은 언제나 raise exception(«0079 STAGING PASS …») — 전부 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/0079_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0079_staging_test.sql"
--   rm -f supabase/.temp/0079_staging_test.sql
-- 기대: ERROR  0079 STAGING PASS a(직원 스위치 꺼짐) b(장부 쓰기 없는 직원 거부) c(대기 · 장부 0줄) d(반영 전표 · 두 번 거부) e(무효 = 역분개 · 원 전표 남음) f(끄면 대표도 꺼짐) g(anon 거부)
-- 사람: 회장 · rehearsal.staff@example.com. 자료는 이 시험 안에서만 — 2099-08 가짜 원장 두 줄 · 시험 계정 T7901 · T7902(DY).
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_staff uuid;
  v_out   text := '';
  v_up    uuid;
  l1      bigint;
  l2      bigint;
  v_post  uuid;
  v_slip  text;
  v_rev   text;
  biz     text := 'biz_dy';
  n       int;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_staff from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  if v_chair is null or v_staff is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 직원(%)', v_chair, v_staff;
  end if;
  update public.user_profiles set role = 'Member', status = 'active' where user_id = v_staff;
  insert into public.user_business_access (user_id, business_id) values (v_staff, biz) on conflict do nothing;
  delete from public.user_module_access where user_id = v_staff and module like '/%/' || biz;
  insert into public.accounts (business_id, account_code, name, category, section, cash_flow, source, fetched_at) values
    (biz, 'T7901', '0079 시험 원재료', 'asset', 'other_asset', 'operating', 'manual', now()),
    (biz, 'T7902', '0079 시험 외상매입금', 'liability', 'payable', 'operating', 'manual', now())
  on conflict do nothing;
  insert into public.fin_uploads (business_id, kind, period, file_name, file_sha256, status, row_count, created_by)
  values (biz, 'ledger', '2099-08', '0079 staging 가짜 원장.xlsx', repeat('9', 64), 'applied', 2, v_chair) returning upload_id into v_up;
  insert into public.fin_ledger_lines (upload_id, business_id, period, row_no, tx_date, account_code, account_name, memo, debit, credit)
  values (v_up, biz, '2099-08', 4, '2099-08-05', 'T7901', '시험', '0079 시험', 1000, null) returning line_id into l1;
  insert into public.fin_ledger_lines (upload_id, business_id, period, row_no, tx_date, account_code, account_name, memo, debit, credit)
  values (v_up, biz, '2099-08', 5, '2099-08-05', 'T7902', '시험', '0079 시험', null, 1000) returning line_id into l2;

  -- ── a. 스위치 기본(대표만): 직원에게 꺼짐 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  begin
    perform * from public.ledger_post_queue(biz, '2099-08');
    raise exception 'FAIL a: 스위치 기본(대표만)인데 직원이 원장을 읽었다';
  exception when others then
    if sqlerrm not like '%feature_off%' then raise exception 'FAIL a: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'a(직원 스위치 꺼짐) ';

  -- ── b. 회사 전원으로 열어도 장부 쓰기 없는 직원은 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.feature_switch_set('ledger_post', biz, true, 'all', '0079 staging 시험');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  begin
    perform * from public.ledger_post_queue(biz, '2099-08');
    raise exception 'FAIL b: 장부 쓰기 없는 직원이 원장을 읽었다';
  exception when others then
    if sqlerrm not like '%ledger_forbidden%' then raise exception 'FAIL b: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'b(장부 쓰기 없는 직원 거부) ';

  -- ── c. 대표: 반영 대기 — 장부에는 아직 0줄 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  v_post := public.ledger_post_stage(biz, array[l1, l2], null, null, null);
  reset role;
  select count(*) into n from public.journal_lines where business_id = biz and account_code in ('T7901', 'T7902');
  if n <> 0 then raise exception 'FAIL c: 대기만으로 장부 줄이 생겼다(%)', n; end if;
  v_out := v_out || 'c(대기 · 장부 0줄) ';

  -- ── d. 반영 — 0016 전표 두 줄 · 두 번 반영 거부 ──
  set local role authenticated;
  v_slip := public.ledger_post_apply(v_post, null);
  begin
    perform public.ledger_post_apply(v_post, null);
    raise exception 'FAIL d: 같은 건을 두 번 반영했다';
  exception when others then
    if sqlerrm not like '%ledger_not_pending%' then raise exception 'FAIL d: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  select count(*) into n from public.journal_lines where business_id = biz and slip_no = v_slip;
  if n <> 2 then raise exception 'FAIL d: 반영 전표 줄이 두 줄이 아니다(%)', n; end if;
  v_out := v_out || 'd(반영 전표 · 두 번 거부) ';

  -- ── e. 무효 처리 = 역분개(원 전표 남음) ──
  set local role authenticated;
  v_rev := public.ledger_post_void(v_post, '0079 staging 무효');
  reset role;
  select count(*) into n from public.journal_entries where business_id = biz and slip_no = v_rev and corrects_id = v_slip and correction_kind = 'reversal';
  if n <> 1 then raise exception 'FAIL e: 무효가 역분개가 아니다(%)', v_rev; end if;
  select count(*) into n from public.journal_lines where business_id = biz and slip_no = v_slip;
  if n <> 2 then raise exception 'FAIL e: 무효가 원 전표를 지웠다'; end if;
  v_out := v_out || 'e(무효 = 역분개 · 원 전표 남음) ';

  -- ── f. 끄면 대표도 꺼짐 ──
  set local role authenticated;
  perform public.feature_switch_set('ledger_post', biz, false, 'all', '0079 staging 끄기');
  begin
    perform * from public.ledger_post_queue(biz, '2099-08');
    raise exception 'FAIL f: 껐는데 대표가 원장을 읽었다';
  exception when others then
    if sqlerrm not like '%feature_off%' then raise exception 'FAIL f: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'f(끄면 대표도 꺼짐) ';

  -- ── g. anon ──
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform * from public.ledger_post_queue(biz, '2099-08');
    raise exception 'FAIL g: anon이 원장을 읽었다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL g: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'g(anon 거부)';

  raise exception '0079 STAGING PASS %', v_out;
end;
$t$;

rollback;
