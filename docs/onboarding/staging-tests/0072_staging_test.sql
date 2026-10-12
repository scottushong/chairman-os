-- =====================================================================
-- 0072 staging 검사(회계 · 재무 자료 올리기 v2.1 차이분 · 시드 정리 A안) — 쓰지 않는다.
-- 0072가 **적용된 뒤** staging에서 돌린다.
--
-- 끝은 언제나 raise exception이다: 통과해도 «0072 STAGING PASS …»로 던져서 트랜잭션 전체가 버려진다
-- (시험 올리기 · 평가금액 · 출고 줄 · 묶음 · 재마감 대상 · 마감 줄 · 권한 줄 · 감사 모두). 맨 앞 begin과 맨 끝 rollback은
-- psql로 돌릴 때를 위한 두 번째 안전줄이다.
-- 돌리는 법(staging에 link된 checkout 루트에서, 상대 경로로):
--   cd ~/projects/chairman-os-next
--   cp docs/onboarding/staging-tests/0072_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0072_staging_test.sql"
--   rm -f supabase/.temp/0072_staging_test.sql
-- 기대: ERROR  0072 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(…) g(anon 거부)  — «FAIL»로 시작하면 그 줄이 깨진 것.
--
-- 사람(id를 박지 않는다): 회장 · rehearsal.staff@example.com(이 시험 안에서만 DY 재무 입력) · rehearsal.member@example.com(권한 없음).
-- 기간은 2099-03 ~ 2099-09(실제 자료와 겹치지 않는 먼 달). 진짜 회사 파일 · 진짜 구성표 없음(가짜 원료 이름).
-- =====================================================================
begin;

do $t$
declare
  v_chair  uuid;
  v_staff  uuid;
  v_member uuid;
  v_w      uuid;
  v_u      uuid;
  v_g      uuid;
  v_sl     bigint;
  v_tl     bigint;
  v_out    text := '';
  n        int;
  v_s      jsonb;
  v_txt    text;
  v_num    numeric;
  v_before text;
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

  -- ── a. 평가금액: 입력한 직원은 확정 못 함 · 권한 없는 사원 거부 · 대표가 확정 · 빈칸은 null ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  v_w := public.fin_valuation_save('biz_dy', '2099-03', 'wip', 1000, null, null, '월 가중평균', 'material_only', 'manual', null, null, null, 'provisional', null);
  begin
    perform public.fin_valuation_confirm(v_w, null);
    raise exception 'FAIL a: 입력한 사람이 스스로 확정했다';
  exception when others then
    if sqlerrm not like '%fin_valuation_self_confirm%' then raise exception 'FAIL a: 자기 확정 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  perform public.fin_valuation_save('biz_dy', '2099-03', 'finished', null, null, null, null, 'material_only', 'manual', null, null, null, 'entering', null);
  select count(*) into n from public.fin_inventory_valuations where period = '2099-03' and category = 'finished' and voided_at is null and amount is null and value_state = 'missing';
  if n <> 1 then raise exception 'FAIL a: 빈칸이 null · missing이 아니다(%)', n; end if;
  begin
    perform public.fin_valuation_save('biz_dy', '2099-03', 'finished', 0, null, null, null, 'material_only', 'manual', null, null, null, 'entering', null);
    raise exception 'FAIL a: 상태 없는 0이 들어갔다';
  exception when others then
    if sqlerrm not like '%fin_value_state%' then raise exception 'FAIL a: 0 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  begin
    perform public.fin_valuation_confirm(v_w, null);
    raise exception 'FAIL a: 권한 없는 사원이 확정했다';
  exception when others then
    if sqlerrm not like '%fin_upload_denied%' then raise exception 'FAIL a: 권한 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  if not public.fin_valuation_confirm(v_w, null) then raise exception 'FAIL a: 대표 확정 실패'; end if;
  v_out := v_out || 'a(자기 확정 거부 · 사원 거부 · 대표 확정 · 빈칸 null · 상태 없는 0 거부) ';

  -- ── b. 경고 · 기초재고 연결 ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  perform public.fin_valuation_save('biz_dy', '2099-04', 'wip', 1200, null, null, null, 'material_labor_overhead', 'manual', null, null, null, 'provisional', null);
  select count(*) into n from public.fin_valuation_warnings('biz_dy', '2099-04') w where w.kind = 'scope_mismatch';
  if n <> 1 then raise exception 'FAIL b: 포함 범위 경고가 없다(%)', n; end if;
  select r.opening_source, r.opening_amount into v_txt, v_num from public.fin_inventory_roll('biz_dy', '2099-04') r where r.category = 'wip';
  if v_txt <> 'prev_close' or v_num <> 1000 then raise exception 'FAIL b: 재공품 기초가 앞 달 확정 기말이 아니다(% %)', v_txt, v_num; end if;
  select r.opening_source into v_txt from public.fin_inventory_roll('biz_dy', '2099-04') r where r.category = 'finished';
  if v_txt <> 'unlinked' then raise exception 'FAIL b: 완제품 기초가 미연결이 아니다(%)', v_txt; end if;
  perform public.fin_opening_save('biz_dy', '2099-04', 'finished', 300, null, 'manual', null, '첫 달 실사');
  select r.opening_source, r.opening_amount into v_txt, v_num from public.fin_inventory_roll('biz_dy', '2099-04') r where r.category = 'finished';
  if v_txt <> 'manual' or v_num <> 300 then raise exception 'FAIL b: 첫 달 직접 입력 기초가 아니다(% %)', v_txt, v_num; end if;
  v_u := public.fin_upload_apply('biz_dy', 'valuation', '2099-05', '가짜 평가.xlsx', repeat('a', 64), '평가', 'high', 0, false,
    '[{"row_no":3,"category":"wip","amount":500,"cost_scope":"material_only"},{"row_no":4,"category":"finished","amount":500,"cost_scope":"material_only"}]',
    null, 'none', null, null, 0);
  select count(*) into n from public.fin_valuation_warnings('biz_dy', '2099-05') w where w.kind = 'wip_finished_duplicate';
  if n <> 1 then raise exception 'FAIL b: 재공품 · 완제품 중복 의심 경고가 없다(%)', n; end if;
  select count(*) into n from public.fin_inventory_valuations where source_upload_id = v_u and status = 'provisional' and source = 'excel' and entered_by = v_staff;
  if n <> 2 then raise exception 'FAIL b: 엑셀 평가금액이 잠정 · excel · 입력자 아님(%)', n; end if;
  v_out := v_out || 'b(범위 다름 · 앞 달 확정 연결 · 미연결 · 첫 달 직접 · 중복 의심 · 엑셀 잠정) ';

  -- ── c. 원료 출고: 기본 확인 필요 · 일괄 결정 이유 · 그 원료만 · kg 칸 못 읽음 · 요약 ──
  perform public.fin_upload_apply('biz_dy', 'material_issue', '2099-06', '가짜 출고.xlsx', repeat('b', 64), '출고', 'high', 0, false,
    '[{"row_no":1,"material":"스테이징 가짜 원료 1","qty_kg":10},{"row_no":2,"material":"스테이징 가짜 원료 2","qty_kg":7,"class":"production","class_reason":"규칙: 생산 출고"},{"row_no":3,"material":"스테이징 가짜 원료 3","qty_kg":1}]',
    null, 'none', null, null, 0);
  select count(*) into n from public.fin_material_issues where period = '2099-06' and business_id = 'biz_dy' and class = 'needs_review';
  if n <> 2 then raise exception 'FAIL c: 구분 없는 출고가 확인 필요가 아니다(%)', n; end if;
  begin
    perform public.fin_issue_bulk_decide('biz_dy', '2099-06', '스테이징 가짜 원료 1', 'production', null, '');
    raise exception 'FAIL c: 이유 없는 일괄 결정';
  exception when others then
    if sqlerrm not like '%fin_issue_reason%' then raise exception 'FAIL c: 이유 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  if public.fin_issue_bulk_decide('biz_dy', '2099-06', '스테이징 가짜 원료 1', 'production', null, '생산 투입 확인') <> 1 then
    raise exception 'FAIL c: 일괄 결정 줄 수가 1이 아니다';
  end if;
  select count(*) into n from public.fin_material_issues where period = '2099-06' and business_id = 'biz_dy' and class = 'needs_review';
  if n <> 1 then raise exception 'FAIL c: 다른 원료까지 바뀌었다(%)', n; end if;
  begin
    perform qty_kg from public.fin_material_issues limit 1;
    raise exception 'FAIL c: kg 칸을 읽었다';
  exception when insufficient_privilege then null;
  end;
  v_s := public.fin_issue_summary('biz_dy', '2099-06');
  if (v_s ->> 'production_input_kg')::numeric <> 17 or jsonb_array_length(v_s -> 'needs_review') <> 1
     or (v_s -> 'needs_review' -> 0) ? 'kg' or (v_s -> 'needs_review' -> 0 ->> 'lines')::int <> 1 then
    raise exception 'FAIL c: 요약이 다르다(%)', v_s;
  end if;
  v_out := v_out || 'c(확인 필요 기본 · 이유 필수 · 그 원료만 · kg 칸 거부 · 요약 합계만) ';

  -- ── d. 같은 거래 묶음 · 자동 다섯째 조건 ──
  perform public.fin_upload_apply('biz_dy', 'sales', '2099-08', '가짜 판매.xlsx', repeat('c', 64), '판매', 'high', 0, false,
    '[{"row_no":1,"customer":"가짜 거래처","amount":1000,"tx_date":"2099-08-03","source_system":"r2"}]', null, 'none', null, null, 0);
  perform public.fin_upload_apply('biz_dy', 'tax_invoice', '2099-08', '가짜 세금계산서.xlsx', repeat('d', 64), '세금계산서', 'high', 0, false,
    '[{"row_no":1,"issued_on":"2099-08-03","counterparty":"가짜 거래처","supply_amount":1000,"vat":100,"total":1100,"direction":"sales"}]', null, 'none', null, null, 0);
  select line_id into v_sl from public.fin_sales_lines where business_id = 'biz_dy' and period = '2099-08' and voided_at is null limit 1;
  select line_id into v_tl from public.fin_tax_invoice_lines where business_id = 'biz_dy' and period = '2099-08' and voided_at is null limit 1;
  v_g := public.fin_tx_group_save('biz_dy', '2099-08', 'suspect',
    jsonb_build_array(jsonb_build_object('source_table', 'fin_sales_lines', 'line_id', v_sl), jsonb_build_object('source_table', 'fin_tax_invoice_lines', 'line_id', v_tl)),
    null, null, null);
  select count(*) into n from public.fin_tx_groups where group_id = v_g and status = 'suspect';
  if n <> 1 then raise exception 'FAIL d: 중복 의심이 저장되지 않았다'; end if;
  if not public.fin_tx_group_decide(v_g, 'same', '같은 거래 확인') then raise exception 'FAIL d: 사람의 결정 실패'; end if;
  begin
    perform public.fin_upload_apply('biz_dy', 'card', '2099-07', '가짜 카드.xlsx', repeat('e', 64), '카드', 'high', 0, true,
      '[{"row_no":1,"amount":1}]', null, 'none', null, null, 1);
    raise exception 'FAIL d: 중복 의심이 있는데 자동으로 들어갔다';
  exception when others then
    if sqlerrm not like '%fin_upload_auto_blocked%' then raise exception 'FAIL d: 자동 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  v_out := v_out || 'd(중복 의심 저장 · 사람 결정 · 자동 다섯째 조건) ';

  -- ── e. 마감 달: 대표 넣기 → 재마감 대상 · closings 그대로 ──
  reset role;
  set local session_replication_role = replica;  -- 시험 마감 줄(계정 FK · 트리거 없이). 이 트랜잭션은 버려진다.
  insert into public.closings (business_id, period, account_code, amount, closed_on, source, fetched_at, closed)
  values ('biz_dy', '2099-09', 'TEST0072', 0, current_date, 'manual', now(), true);
  set local session_replication_role = origin;
  select count(*)::text || ':' || coalesce(sum(amount), 0)::text into v_before from public.closings where business_id = 'biz_dy';
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  v_u := public.fin_upload_apply('biz_dy', 'card', '2099-09', '가짜 카드 마감.xlsx', repeat('f', 64), '카드', 'high', 0, false,
    '[{"row_no":1,"amount":5}]', null, 'none', '세무사 수정분', null, 0);
  select count(*) into n from public.fin_reclose_flags where upload_id = v_u and cause = 'upload' and cleared_at is null;
  if n <> 1 then raise exception 'FAIL e: 재마감 대상이 없다(%)', n; end if;
  reset role;
  select count(*)::text || ':' || coalesce(sum(amount), 0)::text into v_txt from public.closings where business_id = 'biz_dy';
  if v_txt <> v_before then raise exception 'FAIL e: 넣기가 closings를 건드렸다(% → %)', v_before, v_txt; end if;
  v_out := v_out || 'e(마감 달 재마감 대상 · closings 그대로) ';

  -- ── f. 예시 줄: 사원 0 · 대표 전부 ──
  update public.tasks set owner_user_id = v_member where task_id = (select task_id from public.tasks where is_example order by task_id limit 1);
  select count(*) into n from public.tasks where is_example;
  if n = 0 then raise exception 'FAIL f: 예시 표시된 업무가 없다'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select (select count(*) from public.tasks where is_example) + (select count(*) from public.goals where is_example)
       + (select count(*) from public.alerts where is_example) + (select count(*) from public.decisions where is_example) into n;
  if n <> 0 then raise exception 'FAIL f: 사원이 예시 줄을 본다(%)', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select count(*) into n from public.tasks where is_example;
  if n = 0 then raise exception 'FAIL f: 대표가 예시 업무를 못 본다'; end if;
  reset role;
  v_out := v_out || 'f(예시 줄 사원 0 · 대표 ' || n || '줄) ';

  -- ── g. anon ──
  set local role anon;
  begin
    perform valuation_id from public.fin_inventory_valuations limit 1;
    raise exception 'FAIL g: anon이 평가금액을 읽었다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fin_issue_summary('biz_dy', '2099-06');
    raise exception 'FAIL g: anon이 출고 요약을 불렀다';
  exception when insufficient_privilege then null;
  end;
  reset role;
  v_out := v_out || 'g(anon 거부)';

  raise exception '0072 STAGING PASS %', v_out;
end;
$t$;

rollback;
