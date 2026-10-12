-- =====================================================================
-- 0070 staging 검사(회계 · 재무 자료 올리기 v2) — 쓰지 않는다.
-- 0070이 **적용된 뒤** staging에서 돌린다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0070 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다
-- (시험 올리기 · 줄 · 마감 줄 · 권한 줄 · 알림 · 감사 모두). 맨 앞 begin과 맨 끝 rollback은 psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(staging에 link된 checkout 루트에서, 상대 경로로):
--   cd ~/projects/chairman-os-finup
--   cp docs/onboarding/staging-tests/0070_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0070_staging_test.sql"
--   rm -f supabase/.temp/0070_staging_test.sql
-- 기대: ERROR  0070 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(anon 거부)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 사람(id를 박지 않는다): 회장 · rehearsal.staff@example.com(이 시험 안에서만 DY 재무 입력) · rehearsal.member@example.com(권한 없음).
-- 기간은 2099-01 · 2099-02(실제 자료와 겹치지 않는 먼 달).
-- =====================================================================
begin;

do $t$
declare
  v_chair  uuid;
  v_staff  uuid;
  v_member uuid;
  v_u1     uuid;
  v_u2     uuid;
  v_u3     uuid;
  v_pay    uuid;
  v_out    text := '';
  n        int;
  sha1     text := repeat('1', 64);
  sha2     text := repeat('2', 64);
  sha3     text := repeat('3', 64);
  rows1    jsonb := '[{"row_no":3,"customer":"가짜 거래처 A","product":"가짜 제품 1","qty":10,"unit_price":1000,"amount":10000},
                      {"row_no":4,"customer":"가짜 거래처 B","product":"가짜 제품 2","qty":5,"unit_price":2000,"amount":10000}]';
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_staff from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  select u.id into v_member from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.member@example.com' and p.revoked_at is null;
  if v_chair is null or v_staff is null or v_member is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 직원(%) · 리허설 사원(%)', v_chair, v_staff, v_member;
  end if;
  update public.user_profiles set role = 'Member', status = 'active' where user_id in (v_staff, v_member);
  insert into public.user_business_access (user_id, business_id) values (v_staff, 'biz_dy'), (v_member, 'biz_dy') on conflict do nothing;
  delete from public.user_module_access where user_id in (v_staff, v_member) and module = '/finance/biz_dy';
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_staff, '/finance/biz_dy', true, false);

  -- ── a. 재무 입력 직원: 자동 넣기(판매현황 2줄) · 알림 · 같은 파일 두 번 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  v_u1 := public.fin_upload_apply('biz_dy', 'sales', '2099-01', '가짜 판매현황.xlsx', sha1, '판매현황', 'high', 1, true, rows1, null, 'none', null, null);
  select count(*) into n from public.fin_sales_lines where upload_id = v_u1 and voided_at is null;
  if n <> 2 then raise exception 'FAIL a: 판매 줄이 2가 아니다(%)', n; end if;
  select count(*) into n from public.notifications where user_id = v_staff and link = '/finance/biz_dy/upload' and created_at > now() - interval '1 minute';
  if n < 1 then raise exception 'FAIL a: 자동 넣기 알림이 없다'; end if;
  begin
    perform public.fin_upload_apply('biz_dy', 'sales', '2099-01', '가짜 판매현황.xlsx', sha1, '판매현황', 'high', 1, false, rows1, null, 'replace', null, null);
    raise exception 'FAIL a: 같은 파일이 두 번 들어갔다';
  exception when others then
    if sqlerrm not like '%fin_upload_duplicate%' then raise exception 'FAIL a: 같은 파일 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  v_out := v_out || 'a(자동 넣기 2줄 · 알림 · 같은 파일 거부) ';

  -- ── b. 겹침: 다른 파일 같은 달 — 자동 거부 · 선택 없음 거부 · replace → 옛 줄 무효 · keep_old → skipped ──
  begin
    perform public.fin_upload_apply('biz_dy', 'sales', '2099-01', '가짜 판매현황 2.xlsx', sha2, '판매', 'high', 1, true, rows1, null, 'none', null, null);
    raise exception 'FAIL b: 겹침인데 자동으로 들어갔다';
  exception when others then
    if sqlerrm not like '%fin_upload_auto_blocked%' then raise exception 'FAIL b: 자동 겹침 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  begin
    perform public.fin_upload_apply('biz_dy', 'sales', '2099-01', '가짜 판매현황 2.xlsx', sha2, '판매', 'medium', 1, false, rows1, null, 'none', null, null);
    raise exception 'FAIL b: 겹침 선택 없이 들어갔다';
  exception when others then
    if sqlerrm not like '%fin_upload_overlap%' then raise exception 'FAIL b: 겹침 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  v_u2 := public.fin_upload_apply('biz_dy', 'sales', '2099-01', '가짜 판매현황 2.xlsx', sha2, '판매', 'medium', 1, false, rows1, null, 'replace', '새 파일이 맞음', null);
  select count(*) into n from public.fin_sales_lines where upload_id = v_u1 and voided_at is null;
  if n <> 0 then raise exception 'FAIL b: replace 뒤 옛 줄이 살아 있다(%)', n; end if;
  select count(upload_id) into n from public.fin_uploads where upload_id = v_u1 and status = 'replaced';
  if n <> 1 then raise exception 'FAIL b: 옛 올리기가 replaced가 아니다'; end if;
  v_u3 := public.fin_upload_apply('biz_dy', 'sales', '2099-01', '가짜 판매현황 3.xlsx', sha3, '판매', 'medium', 1, false, rows1, null, 'keep_old', null, null);
  select count(upload_id) into n from public.fin_uploads where upload_id = v_u3 and status = 'skipped';
  if n <> 1 then raise exception 'FAIL b: keep_old가 skipped가 아니다'; end if;
  select count(*) into n from public.fin_sales_lines where upload_id = v_u3;
  if n <> 0 then raise exception 'FAIL b: keep_old인데 줄이 들어갔다'; end if;
  v_out := v_out || 'b(겹침 — 자동 거부 · 선택 필수 · replace 옛 줄 무효 · keep_old 0줄) ';

  -- ── c. 되돌리기 · 미리보기 대기 → 넣기 · 취소 ──
  if not public.fin_upload_revert(v_u2, '시험') then raise exception 'FAIL c: 되돌리기 실패'; end if;
  select count(*) into n from public.fin_sales_lines where upload_id = v_u2 and voided_at is null;
  if n <> 0 then raise exception 'FAIL c: 되돌린 뒤 줄이 살아 있다(%)', n; end if;
  select count(*) into n from public.fin_sales_lines where upload_id = v_u2;
  if n <> 2 then raise exception 'FAIL c: 되돌리기가 줄을 지웠다(%)', n; end if;
  -- 리뷰 I-3: 바꾸기를 되돌리면 옛 올리기(v_u1)의 줄이 되살아나고 applied로 돌아온다.
  select count(*) into n from public.fin_sales_lines where upload_id = v_u1 and voided_at is null;
  if n <> 2 then raise exception 'FAIL c: 바꾸기를 되돌렸는데 옛 줄이 안 살아났다(%)', n; end if;
  select count(upload_id) into n from public.fin_uploads where upload_id = v_u1 and status = 'applied';
  if n <> 1 then raise exception 'FAIL c: 옛 올리기가 applied로 안 돌아왔다'; end if;
  -- 리뷰 I-1: 급여 대기 줄의 개인 줄은 직원에게 싣지 않는다 · pending 칸은 직접 못 읽는다.
  v_pay := public.fin_upload_record('biz_dy', 'payroll', '2099-03', '가짜 급여 대기.xlsx', repeat('8', 64), '급여', 'medium', 1, 'needs_review',
                                    '{"rows":[{"row_no":0,"dept":"영업","salary":1}],"people":[{"row_no":4,"dept":"영업","person_ref":"E9","salary":1}],"grid":[["부서","사번","급여"],["영업","E9",1]]}', null);
  if public.fin_upload_pending(v_pay) ? 'people' or public.fin_upload_pending(v_pay) ? 'grid' then raise exception 'FAIL c: 직원에게 급여 개인 줄 · 칸 격자가 실렸다'; end if;
  if not public.fin_upload_pending(v_pay) ? 'rows' then raise exception 'FAIL c: 직원이 대기 줄을 못 읽는다'; end if;
  begin
    perform pending from public.fin_uploads where upload_id = v_pay;
    raise exception 'FAIL c: pending 칸을 직접 읽었다';
  exception when insufficient_privilege then null;
  end;
  if not public.fin_upload_cancel(v_pay) then raise exception 'FAIL c: 급여 대기 취소 실패'; end if;
  v_u3 := public.fin_upload_record('biz_dy', 'unknown', null, '가짜 모르는 파일.xlsx', repeat('4', 64), 'Sheet1', 'low', 1, 'needs_review',
                                   jsonb_build_object('rows', '[]'::jsonb), null);
  v_u3 := public.fin_upload_apply('biz_dy', 'cashflow', '2099-02', '가짜 모르는 파일.xlsx', repeat('4', 64), 'Sheet1', 'low', 1, false,
                                  '[{"row_no":2,"flow_date":"2099-02-03","category":"가짜 매출 입금","inflow":5000,"outflow":0}]', null, 'none', '종류를 자금흐름으로 고침', v_u3);
  select count(upload_id) into n from public.fin_uploads where upload_id = v_u3 and status = 'applied' and kind = 'cashflow';
  if n <> 1 then raise exception 'FAIL c: 미리보기 대기 → 넣기가 안 됐다'; end if;
  if public.fin_upload_cancel(v_u3) then raise exception 'FAIL c: 넣은 것을 취소했다'; end if;
  v_out := v_out || 'c(되돌리기 = 무효 · 줄 남음 · 옛 줄 되살림 · 급여 개인 줄 직원 0 · pending 직접 읽기 거부 · 대기 → 종류 고쳐 넣기 · 넣은 것 취소 거부) ';

  -- ── d. 마감 달: 직원 거부 · 대표는 이유 있어야 ──
  reset role;
  set local session_replication_role = replica;  -- 시험 마감 줄(계정 FK · 트리거 없이). 이 트랜잭션은 버려진다.
  insert into public.closings (business_id, period, account_code, amount, closed_on, source, fetched_at, closed)
  values ('biz_dy', '2099-02', 'TEST0070', 0, current_date, 'manual', now(), true);
  set local session_replication_role = origin;
  set local role authenticated;
  begin
    perform public.fin_upload_apply('biz_dy', 'card', '2099-02', '가짜 카드.xlsx', repeat('5', 64), '카드', 'high', 1, false,
                                    '[{"row_no":2,"used_on":"2099-02-05","merchant":"가짜 식당","dept":"경영지원","card_last4":"1234","amount":30000}]', null, 'none', '이유', null);
    raise exception 'FAIL d: 직원이 마감 달에 넣었다';
  exception when others then
    if sqlerrm not like '%fin_upload_closed%' then raise exception 'FAIL d: 마감 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  begin
    perform public.fin_upload_apply('biz_dy', 'card', '2099-02', '가짜 카드.xlsx', repeat('5', 64), '카드', 'high', 1, false,
                                    '[{"row_no":2,"used_on":"2099-02-05","merchant":"가짜 식당","dept":"경영지원","card_last4":"1234","amount":30000}]', null, 'none', null, null);
    raise exception 'FAIL d: 대표가 이유 없이 마감 달에 넣었다';
  exception when others then
    if sqlerrm not like '%fin_upload_closed%' then raise exception 'FAIL d: 대표 이유 없음 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  perform public.fin_upload_apply('biz_dy', 'card', '2099-02', '가짜 카드.xlsx', repeat('5', 64), '카드', 'high', 1, false,
                                  '[{"row_no":2,"used_on":"2099-02-05","merchant":"가짜 식당","dept":"경영지원","card_last4":"1234","amount":30000}]', null, 'none', '세무사 수정분', null);
  v_out := v_out || 'd(마감 달 — 직원 거부 · 대표 이유 없음 거부 · 대표 이유 있음 넣음) ';

  -- ── e. 급여: 개인 줄은 대표 · CFO만 · 사원은 표 0줄 ──
  v_pay := public.fin_upload_apply('biz_dy', 'payroll', '2099-01', '가짜 급여대장.xlsx', repeat('6', 64), '급여대장', 'high', 1, false,
    '[{"row_no":0,"dept":"경영지원","salary":6000000,"bonus":0,"severance":0}]',
    '[{"row_no":5,"dept":"경영지원","person_ref":"E001","salary":3000000,"bonus":0,"severance":0},{"row_no":6,"dept":"경영지원","person_ref":"E002","salary":3000000,"bonus":0,"severance":0}]',
    'none', null, null);
  select count(*) into n from public.fin_payroll_people where upload_id = v_pay;
  if n <> 2 then raise exception 'FAIL e: 대표가 개인 줄 2를 못 본다(%)', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  select count(*) into n from public.fin_payroll_people where upload_id = v_pay;
  if n <> 0 then raise exception 'FAIL e: 재무 입력 직원이 급여 개인 줄을 본다(%)', n; end if;
  select count(*) into n from public.fin_payroll_depts where upload_id = v_pay;
  if n <> 1 then raise exception 'FAIL e: 재무 입력 직원이 부서 합계를 못 본다(%)', n; end if;
  begin
    insert into public.fin_sales_lines (upload_id, business_id, period, row_no, amount) values (v_pay, 'biz_dy', '2099-01', 1, 1);
    raise exception 'FAIL e: 표에 직접 넣었다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select count(upload_id) into n from public.fin_uploads where business_id = 'biz_dy' and period like '2099-%';
  if n <> 0 then raise exception 'FAIL e: 재무 권한 없는 사원이 올리기 기록을 본다(%)', n; end if;
  begin
    perform public.fin_upload_apply('biz_dy', 'sales', '2099-01', 'x.xlsx', repeat('7', 64), 's', 'high', 1, true, rows1, null, 'none', null, null);
    raise exception 'FAIL e: 권한 없는 사원이 넣었다';
  exception when others then
    if sqlerrm not like '%fin_upload_denied%' then raise exception 'FAIL e: 권한 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  select count(*) into n from information_schema.columns where table_name = 'fin_production_lines' and column_name ~ '(material|ratio|input|bom)';
  if n <> 0 then raise exception 'FAIL e: 생산 표에 원료 칸이 있다'; end if;
  select count(*) into n from public.audit_log where entity_table = 'fin_uploads' and occurred_at > now() - interval '5 minutes';
  v_out := v_out || 'e(급여 개인 줄 대표만 · 직원 부서 합계만 · 직접 넣기 거부 · 사원 0줄 · 권한 거부 · 생산 원료 칸 0 · 감사 ' || n || '줄) ';

  -- ── f. anon ──
  set local role anon;
  begin
    perform upload_id from public.fin_uploads limit 1;
    raise exception 'FAIL f: anon이 읽었다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fin_upload_revert(v_u2, 'x');
    raise exception 'FAIL f: anon이 되돌렸다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'f(anon 거부)';

  raise exception '0070 STAGING PASS %', v_out;
end;
$t$;

rollback;
