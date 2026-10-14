-- =====================================================================
-- 2026-10-14 운영 첫 사용 고침(feat/first-use-fix · 마이그레이션 없음) staging 검사 — 쓰지 않는다.
-- 끝은 언제나 raise exception(«FIRST-USE STAGING PASS …») — 전부 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/first-use-fix_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/first-use-fix_staging_test.sql"
--   rm -f supabase/.temp/first-use-fix_staging_test.sql
-- 기대: ERROR  FIRST-USE STAGING PASS a(학습 표가 원장 구조 키를 받음) b(숫자 아닌 값 거부 그대로) c(대기 meta 새 칸) d(PDF 스위치 줄 있음)
-- 앱이 새로 쓰는 DB 모양: fin_upload_shapes.column_map에 «@date · @balance · @head · @hdr · #<줄 종류>:<낱말>» 키(값은 0~200 정수 — 0070 규칙 그대로),
-- fin_uploads.pending.meta에 labels · ledger · tries(jsonb — 0070 규칙 그대로).
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_out   text := '';
  v_map   jsonb;
  v_id    uuid;
  biz     text := 'biz_dy';
  n       int;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  if v_chair is null then raise exception 'FAIL 준비: 회장 없음'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;

  -- ── a. 학습 표 — 원장 구조 키(앱 ledger.ts encodeShape와 같은 모양) ──
  v_map := jsonb_build_object('account_code', 0, 'debit', 4, 'credit', 5, '@date', 0, '@memo', 1, '@counterparty', 3, '@balance', 6, '@head', 0, '@hdr', 2,
                              '#day:당일합산', 1, '#month:월계', 1, '#cumulative:누계', 1, '#carry:전기이월', 1);
  perform public.fin_upload_shape_save(biz, repeat('f', 32), '계정별원장', 'ledger', v_map);
  select count(*) into n from public.fin_upload_shapes where business_id = biz and header_sig = repeat('f', 32) and column_map = v_map;
  if n <> 1 then raise exception 'FAIL a: 원장 구조 키가 학습 표에 그대로 들어가지 않았다(%)', n; end if;
  v_out := v_out || 'a(학습 표가 원장 구조 키를 받음) ';

  -- ── b. 숫자 아닌 값 · 큰 값은 그대로 거부(숫자를 학습 표에 두지 않는다) ──
  begin
    perform public.fin_upload_shape_save(biz, repeat('e', 32), '계정별원장', 'ledger', jsonb_build_object('#day:일계', 'x'));
    raise exception 'FAIL b: 글 값을 받았다';
  exception when others then
    if sqlerrm not like '%fin_upload_shape%' then raise exception 'FAIL b: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  begin
    perform public.fin_upload_shape_save(biz, repeat('e', 32), '계정별원장', 'ledger', jsonb_build_object('debit', 1162102000));
    raise exception 'FAIL b: 금액 크기의 값을 받았다';
  exception when others then
    if sqlerrm not like '%fin_upload_shape%' then raise exception 'FAIL b: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  v_out := v_out || 'b(숫자 아닌 값 거부 그대로) ';

  -- ── c. 대기 기록의 meta 새 칸(labels · ledger · tries) ──
  v_id := public.fin_upload_record(biz, 'ledger', '2099-01', '가짜 원장.xlsx', repeat('a', 64), '계정별원장', 'high', 2, 'needs_review',
    jsonb_build_object('rows', '[]'::jsonb, 'meta', jsonb_build_object('labels', jsonb_build_array(jsonb_build_object('text', '[당일합산]', 'role', 'day')),
      'ledger', jsonb_build_object('headerRow', 2, 'cols', jsonb_build_object('debit', 4, 'credit', 5, 'balance', 6), 'headCol', null), 'tries', 2)), null);
  if (public.fin_upload_pending(v_id) -> 'meta' -> 'ledger' ->> 'headerRow') is distinct from '2' then raise exception 'FAIL c: 대기 meta.ledger를 못 읽는다'; end if;
  if not public.fin_upload_cancel(v_id) then raise exception 'FAIL c: 대기 취소(다시 해석의 첫 걸음)가 안 된다'; end if;
  v_out := v_out || 'c(대기 meta 새 칸 · 취소) ';
  reset role;

  -- ── d. PDF · 사진 스위치 줄(0073) — 대표가 /settings/features에서 «전원»으로 바꾸는 줄 ──
  select count(*) into n from public.feature_switches where business_id is null and feature_key = 'finance_docs';
  if n <> 1 then raise exception 'FAIL d: finance_docs 그룹 줄이 없다(%)', n; end if;
  v_out := v_out || 'd(PDF 스위치 줄 있음) ';

  raise exception 'FIRST-USE STAGING PASS %', v_out;
end
$t$;

rollback;
