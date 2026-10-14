-- =====================================================================
-- 0075 staging 검사(월별 손익 — 재고 반영 매출원가 · 마감 · 다시 열기 · 권한) — 쓰지 않는다.
-- 0075가 **적용된 뒤** staging에서 돌린다. 끝은 언제나 raise exception(«0075 STAGING PASS …») — 전부 되돌린다.
-- 돌리는 법(staging에 link된 checkout 루트에서):
--   cp docs/onboarding/staging-tests/0075_staging_test.sql supabase/.temp/
--   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0075_staging_test.sql"
--   rm -f supabase/.temp/0075_staging_test.sql
-- 기대: ERROR  0075 STAGING PASS a(직원 스위치 꺼짐) b(1월 매출원가 3억 · 영업이익 1억 · 원료 기말 6억 · 지급 9억) c(직원 원료별 없음 · 확정 거부 · 잠정 한 줄)
--        d(대표 마감 · 다시 눌러도 한 줄) e(마감 뒤 원천 바뀜 — 숫자 그대로 · 조정 거부) f(2월 기초 = 1월 확정 기말) g(다시 열기 — 2월 재마감 대상 · 확정 그대로)
--        h(1월 다시 마감 — 2월 기초 차이 표시) i(조정 — 본인 승인 거부 · 다른 사람 승인 · 평가손실 거부 · 허용오차 상한 · 승인된 조정 무효는 마감 권한) j(자료 없는 달 마감 거부) k(anon 거부)
-- 사람: 회장 · rehearsal.staff@example.com(이 시험 안에서만 VANA 재무 입력 · 원가 권한 없음). 기간 2098-12 ~ 2099-03(먼 달). 가짜 원료 · 가짜 금액만.
-- 금액 단위 원. 1월: 기초 0 · 매입 9억(900,000kg) · 생산 투입 300,000kg · 기말 600,000kg · 매출 5억 · 판관비 1억 · 원재료비 전표 9억(지금 장부 A 방식).
-- =====================================================================
begin;

do $t$
declare
  v_chair uuid;
  v_staff uuid;
  v_out   text := '';
  n       int;
  r       jsonb;
  v_id    uuid;
  v_id2   uuid;
  v_adj   uuid;
  v_val   uuid;
  biz     text := 'biz_vana';
  mat     text := '스테이징 가짜 원료 75';
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  select u.id into v_staff from auth.users u join public.user_profiles p on p.user_id = u.id
   where lower(u.email) = 'rehearsal.staff@example.com' and p.revoked_at is null;
  if v_chair is null or v_staff is null then
    raise exception 'FAIL 준비: 회장(%) · 리허설 직원(%)', v_chair, v_staff;
  end if;
  update public.user_profiles set role = 'Member', status = 'active' where user_id = v_staff;
  insert into public.user_business_access (user_id, business_id) values (v_staff, biz) on conflict do nothing;
  delete from public.user_module_access where user_id = v_staff and module in ('/finance/' || biz, '/costing/' || biz);
  insert into public.user_module_access (user_id, module, can_write, can_approve) values (v_staff, '/finance/' || biz, true, false);

  -- ── a. 스위치 기본(대표만): 직원에게는 꺼짐 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  begin
    perform public.fin_pl_month(biz, '2099-01');
    raise exception 'FAIL a: 스위치 기본(대표만)인데 직원이 월별 손익을 읽었다';
  exception when others then
    if sqlerrm not like '%feature_off%' then raise exception 'FAIL a: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'a(직원 스위치 꺼짐) ';

  -- ── 대표: 이 회사만 전원으로 · 가짜 자료 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.feature_switch_set('monthly_pl', biz, true, 'all', '0075 staging 시험');
  perform public.fin_upload_apply(biz, 'inventory', '2098-12', '가짜 재고 75-12.xlsx', repeat('1', 62) || '75', '재고', 'high', 0, false,
    jsonb_build_array(jsonb_build_object('row_no', 1, 'item', mat, 'stock_qty', 0, 'amount', 0)), null, 'none', null, null, 0);
  perform public.fin_upload_apply(biz, 'purchase_in', '2099-01', '가짜 입고 75-01.xlsx', repeat('2', 62) || '75', '입고', 'high', 0, false,
    jsonb_build_array(jsonb_build_object('row_no', 1, 'material', mat, 'qty', 900000, 'amount', 900000000)), null, 'none', null, null, 0);
  perform public.fin_upload_apply(biz, 'material_issue', '2099-01', '가짜 출고 75-01.xlsx', repeat('3', 62) || '75', '출고', 'high', 0, false,
    jsonb_build_array(jsonb_build_object('row_no', 1, 'material', mat, 'qty_kg', 300000, 'class', 'production', 'class_reason', '시험 규칙')), null, 'none', null, null, 0);
  perform public.fin_upload_apply(biz, 'inventory', '2099-01', '가짜 재고 75-01.xlsx', repeat('4', 62) || '75', '재고', 'high', 0, false,
    jsonb_build_array(jsonb_build_object('row_no', 1, 'item', mat, 'stock_qty', 600000, 'amount', 600000000)), null, 'none', null, null, 0);
  perform public.fin_upload_apply(biz, 'cashflow', '2099-01', '가짜 자금 75-01.xlsx', repeat('5', 62) || '75', '자금', 'high', 0, false,
    '[{"row_no":1,"flow_date":"2099-01-10","category":"원재료 대금","outflow":900000000},{"row_no":2,"flow_date":"2099-01-20","category":"매출 입금","inflow":500000000}]',
    null, 'none', null, null, 0);
  perform public.fin_opening_save(biz, '2099-01', 'wip', 0, 'confirmed_zero', 'manual', null, '첫 달 시험');
  perform public.fin_opening_save(biz, '2099-01', 'finished', 0, 'confirmed_zero', 'manual', null, '첫 달 시험');
  perform public.post_journal_entry(biz, '2099-01-15', '0075 시험 매출', null,
    '[{"account_code":"1030","amount":500000000,"side":"debit"},{"account_code":"4010","amount":500000000,"side":"credit"}]');
  perform public.post_journal_entry(biz, '2099-01-16', '0075 시험 판관비', null,
    '[{"account_code":"8010","amount":100000000,"side":"debit"},{"account_code":"1030","amount":100000000,"side":"credit"}]');
  perform public.post_journal_entry(biz, '2099-01-17', '0075 시험 매입(A 방식)', null,
    '[{"account_code":"4510","amount":900000000,"side":"debit"},{"account_code":"2010","amount":900000000,"side":"credit"}]');
  reset role;
  -- 직원이 평가금액(0 확인)을 넣고 대표가 확정(입력한 사람 ≠ 확정한 사람 — 0072).
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  perform public.fin_valuation_save(biz, '2099-01', 'wip', 0, 'confirmed_zero', '2099-01-31', '월 가중평균', 'material_labor_overhead', 'manual', null, null, null, 'provisional', null);
  perform public.fin_valuation_save(biz, '2099-01', 'finished', 0, 'confirmed_zero', '2099-01-31', '월 가중평균', 'material_labor_overhead', 'manual', null, null, null, 'provisional', null);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  for v_val in select valuation_id from public.fin_inventory_valuations where business_id = biz and period = '2099-01' and voided_at is null loop
    perform public.fin_valuation_confirm(v_val, null);
  end loop;

  -- ── b. 대표 보기 ──
  r := public.fin_pl_month(biz, '2099-01');
  if r ->> 'view_status' <> 'provisional' or (r #>> '{result,pl,cogs}')::numeric <> 300000000 or (r #>> '{result,pl,operating_income}')::numeric <> 100000000
     or (r #>> '{result,basis,raw_closing}')::numeric <> 600000000 or (r #>> '{result,cash,material_payments}')::numeric <> 900000000
     or (r #>> '{result,check,books_operating_income}')::numeric <> -500000000 or not (r #>> '{result,closable}')::boolean
     or jsonb_array_length(r #> '{result,materials}') <> 1 or (r #>> '{result,materials,0,wa_unit_cost}')::numeric <> 1000 then
    raise exception 'FAIL b: 1월 대표 보기가 다르다 %', r -> 'result';
  end if;
  reset role;
  v_out := v_out || 'b(1월 매출원가 3억 · 영업이익 1억 · 원료 기말 6억 · 지급 9억) ';

  -- ── c. 직원(장부 쓰기 · 원가 권한 없음) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  r := public.fin_pl_month(biz, '2099-01');
  if jsonb_array_length(r #> '{result,materials}') <> 0 or r #> '{result,basis,production_input}' <> 'null'::jsonb or position(mat in r::text) > 0
     or (r #>> '{result,pl,cogs}')::numeric <> 300000000 then
    raise exception 'FAIL c: 직원에게 원료별 줄 · 원료 이름 · 투입원가가 보인다(또는 합계가 다르다) %', r -> 'result';
  end if;
  begin
    perform public.fin_pl_record(biz, '2099-01', true, null);
    raise exception 'FAIL c: 마감 권한 없는 직원이 내부 마감했다';
  exception when others then
    if sqlerrm not like '%fin_pl_denied%' then raise exception 'FAIL c: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  v_id := public.fin_pl_record(biz, '2099-01', false, null);
  v_id2 := public.fin_pl_record(biz, '2099-01', false, null);
  if v_id <> v_id2 then raise exception 'FAIL c: 같은 입력의 잠정 저장이 줄을 늘렸다'; end if;
  begin
    perform totals from public.fin_pl_closes limit 1;
    raise exception 'FAIL c: 직원이 저장본 합계 칸을 직접 읽었다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL c: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'c(직원 원료별 없음 · 확정 거부 · 잠정 한 줄) ';

  -- ── d. 대표 내부 마감 · 다시 눌러도 한 줄 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  v_id := public.fin_pl_record(biz, '2099-01', true, '시험 마감');
  v_id2 := public.fin_pl_record(biz, '2099-01', true, '시험 마감');
  if v_id <> v_id2 then raise exception 'FAIL d: 같은 입력의 마감이 줄을 늘렸다'; end if;
  reset role;
  select count(*) into n from public.fin_pl_closes where business_id = biz and period = '2099-01';
  if n <> 2 then raise exception 'FAIL d: 1월 저장본이 %줄(잠정 1 + 확정 1이어야)', n; end if;
  select count(*) into n from public.fin_pl_closes where business_id = biz and period = '2099-01' and superseded_at is null and status = 'final';
  if n <> 1 then raise exception 'FAIL d: 살아 있는 확정이 %줄', n; end if;
  v_out := v_out || 'd(대표 마감 · 다시 눌러도 한 줄) ';

  -- ── e. 마감 뒤 원천이 바뀜(판관비 전표 하나 더) → 확정 숫자 그대로 · «자료 바뀜» · 확정 달 조정 거부 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.post_journal_entry(biz, '2099-01-28', '0075 시험 늦은 판관비', null,
    '[{"account_code":"8010","amount":5000000,"side":"debit"},{"account_code":"1030","amount":5000000,"side":"credit"}]');
  r := public.fin_pl_month(biz, '2099-01');
  if r ->> 'view_status' <> 'final' or (r #>> '{result,pl,operating_income}')::numeric <> 100000000 or not (r #>> '{stale,inputs_changed}')::boolean then
    raise exception 'FAIL e: 확정 숫자가 바뀌었거나 «자료 바뀜»이 없다 %', r -> 'stale';
  end if;
  begin
    perform public.fin_pl_adjust_propose(biz, '2099-01', 'shrinkage', 1000, '확정 달 시험');
    raise exception 'FAIL e: 확정 달에 조정을 넣었다';
  exception when others then
    if sqlerrm not like '%fin_pl_final%' then raise exception 'FAIL e: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  v_out := v_out || 'e(마감 뒤 원천 바뀜 — 숫자 그대로 · 조정 거부) ';

  -- ── f. 2월: 기초 = 1월 확정 기말 6억 · 매입 0 · 투입 300,000kg · 매출원가 3억 ──
  perform public.fin_upload_apply(biz, 'material_issue', '2099-02', '가짜 출고 75-02.xlsx', repeat('6', 62) || '75', '출고', 'high', 0, false,
    jsonb_build_array(jsonb_build_object('row_no', 1, 'material', mat, 'qty_kg', 300000, 'class', 'production', 'class_reason', '시험 규칙')), null, 'none', null, null, 0);
  perform public.fin_upload_apply(biz, 'inventory', '2099-02', '가짜 재고 75-02.xlsx', repeat('7', 62) || '75', '재고', 'high', 0, false,
    jsonb_build_array(jsonb_build_object('row_no', 1, 'item', mat, 'stock_qty', 300000, 'amount', 300000000)), null, 'none', null, null, 0);
  perform public.post_journal_entry(biz, '2099-02-15', '0075 시험 매출 2월', null,
    '[{"account_code":"1030","amount":500000000,"side":"debit"},{"account_code":"4010","amount":500000000,"side":"credit"}]');
  perform public.post_journal_entry(biz, '2099-02-16', '0075 시험 판관비 2월', null,
    '[{"account_code":"8010","amount":100000000,"side":"debit"},{"account_code":"1030","amount":100000000,"side":"credit"}]');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  perform public.fin_valuation_save(biz, '2099-02', 'wip', 0, 'confirmed_zero', '2099-02-28', '월 가중평균', 'material_labor_overhead', 'manual', null, null, null, 'provisional', null);
  perform public.fin_valuation_save(biz, '2099-02', 'finished', 0, 'confirmed_zero', '2099-02-28', '월 가중평균', 'material_labor_overhead', 'manual', null, null, null, 'provisional', null);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  for v_val in select valuation_id from public.fin_inventory_valuations where business_id = biz and period = '2099-02' and voided_at is null loop
    perform public.fin_valuation_confirm(v_val, null);
  end loop;
  r := public.fin_pl_month(biz, '2099-02');
  if (r #>> '{result,basis,raw_opening}')::numeric <> 600000000 or (r #>> '{result,pl,cogs}')::numeric <> 300000000
     or (r #>> '{result,pl,operating_income}')::numeric <> 100000000 or not (r #>> '{result,closable}')::boolean
     or r #>> '{result,materials,0,opening_source}' <> 'prev_close' then
    raise exception 'FAIL f: 2월이 1월 확정 기말에서 이어지지 않는다 %', r -> 'result';
  end if;
  perform public.fin_pl_record(biz, '2099-02', true, '시험 마감 2월');
  reset role;
  v_out := v_out || 'f(2월 기초 = 1월 확정 기말) ';

  -- ── g. 1월 다시 열기: 직원 거부 · 대표 + 이유 → 2월은 확정 그대로 + 재마감 대상 한 줄 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  begin
    perform public.fin_pl_reopen(biz, '2099-01', '직원 시험');
    raise exception 'FAIL g: 직원이 확정 달을 다시 열었다';
  exception when others then
    if sqlerrm not like '%fin_pl_denied%' then raise exception 'FAIL g: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  begin
    perform public.fin_pl_reopen(biz, '2099-01', ' ');
    raise exception 'FAIL g: 이유 없이 다시 열었다';
  exception when others then
    if sqlerrm not like '%fin_pl_reason%' then raise exception 'FAIL g: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  n := public.fin_pl_reopen(biz, '2099-01', '시험 다시 열기');
  if n <> 1 then raise exception 'FAIL g: 재마감 대상 표시가 %달(1이어야)', n; end if;
  r := public.fin_pl_month(biz, '2099-02');
  if r ->> 'view_status' <> 'final' or (r #>> '{stale,reclose_flags}')::int <> 1 or (r #>> '{result,pl,cogs}')::numeric <> 300000000 then
    raise exception 'FAIL g: 2월이 덮어써졌거나 재마감 대상이 없다 %', r -> 'stale';
  end if;
  reset role;
  v_out := v_out || 'g(다시 열기 — 2월 재마감 대상 · 확정 그대로) ';

  -- ── h. 1월 재공품 기말을 100만으로 바꿔(직원 저장 · 대표 확정) 다시 마감 → 바뀐 값 기록 · 2월에 «기초 ≠ 앞 달 확정 기말» ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  perform public.fin_valuation_save(biz, '2099-01', 'wip', 1000000, 'value', '2099-01-31', '월 가중평균', 'material_labor_overhead', 'manual', null, null, null, 'provisional', '재공품 재평가 시험');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  select valuation_id into v_val from public.fin_inventory_valuations where business_id = biz and period = '2099-01' and category = 'wip' and voided_at is null;
  perform public.fin_valuation_confirm(v_val, null);
  perform public.fin_pl_record(biz, '2099-01', true, '시험 다시 마감');
  r := public.fin_pl_month(biz, '2099-01');
  if (r #>> '{changed_vs_prev_final,wip_closing}')::numeric <> 1000000 or (r #>> '{result,pl,cogs}')::numeric <> 299000000 then
    raise exception 'FAIL h: 다시 마감한 1월의 바뀐 값이 없다 %', r;
  end if;
  r := public.fin_pl_month(biz, '2099-02');
  if r ->> 'view_status' <> 'final' or (r #>> '{stale,opening_diff,wip}')::numeric <> -1000000 then
    raise exception 'FAIL h: 2월에 기초 차이가 안 보인다(또는 2월이 덮어써졌다) %', r -> 'stale';
  end if;
  reset role;
  v_out := v_out || 'h(1월 다시 마감 — 2월 기초 차이 표시) ';

  -- ── i. 조정(3월): 대표 제안 → 대표 승인 거부(본인) · 직원 제안 → 직원 승인 거부(권한) · 대표 승인 ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  v_adj := public.fin_pl_adjust_propose(biz, '2099-03', 'shrinkage', 100000, '시험 감모');
  begin
    perform public.fin_pl_adjust_decide(v_adj, 'approve', null);
    raise exception 'FAIL i: 제안한 사람이 스스로 승인했다';
  exception when others then
    if sqlerrm not like '%fin_pl_self_approve%' then raise exception 'FAIL i: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  v_adj := public.fin_pl_adjust_propose(biz, '2099-03', 'scrap', 50000, '시험 폐기');
  if public.fin_pl_adjust_propose(biz, '2099-03', 'scrap', 50000, '시험 폐기') <> v_adj then raise exception 'FAIL i: 같은 제안이 줄을 늘렸다'; end if;
  begin
    perform public.fin_pl_adjust_decide(v_adj, 'approve', null);
    raise exception 'FAIL i: 마감 권한 없는 직원이 승인했다';
  exception when others then
    if sqlerrm not like '%fin_pl_denied%' then raise exception 'FAIL i: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  if not public.fin_pl_adjust_decide(v_adj, 'approve', null) then raise exception 'FAIL i: 대표가 직원 제안을 승인하지 못했다'; end if;
  -- 리뷰 고침: 평가손실 조정 거부 · 허용오차 100만 원 넘게 거부 · 승인된 조정의 무효는 마감 권한만.
  begin
    perform public.fin_pl_adjust_propose(biz, '2099-03', 'valuation_loss', 1000, '시험 평가손실');
    raise exception 'FAIL i: 평가손실 조정을 받았다';
  exception when others then
    if sqlerrm not like '%fin_pl_adjust_value%' then raise exception 'FAIL i: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  begin
    perform public.fin_pl_setting_save(biz, 'monthly_wa', false, 1000001, 'books', array['원재료'], '시험 상한');
    raise exception 'FAIL i: 허용오차 1,000,001원을 받았다';
  exception when others then
    if sqlerrm not like '%fin_pl_setting_value%' then raise exception 'FAIL i: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  set local role authenticated;
  begin
    perform public.fin_pl_adjust_decide(v_adj, 'void', '승인된 것 무효 시험');
    raise exception 'FAIL i: 마감 권한 없는 직원이 승인된 조정을 무효로 했다';
  exception when others then
    if sqlerrm not like '%fin_pl_denied%' then raise exception 'FAIL i: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  if not public.fin_pl_adjust_decide(v_adj, 'void', '승인된 것 무효 시험') then raise exception 'FAIL i: 대표가 승인된 조정을 무효로 못 했다'; end if;
  v_out := v_out || 'i(조정 — 본인 승인 거부 · 다른 사람 승인 · 평가손실 거부 · 허용오차 상한 · 승인된 조정 무효는 마감 권한) ';

  -- ── j. 자료 없는 3월 — 내부 마감 거부(입력 중) ──
  begin
    perform public.fin_pl_record(biz, '2099-03', true, null);
    raise exception 'FAIL j: 자료 없는 달이 마감됐다';
  exception when others then
    if sqlerrm not like '%fin_pl_entering%' and sqlerrm not like '%fin_pl_blocked%' then raise exception 'FAIL j: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'j(자료 없는 달 마감 거부) ';

  -- ── k. anon ──
  set local role anon;
  begin
    perform public.fin_pl_month(biz, '2099-01');
    raise exception 'FAIL k: anon이 월별 손익을 읽었다';
  exception when others then
    if sqlerrm not like '%permission denied%' then raise exception 'FAIL k: 거부 문장이 다르다(%)', sqlerrm; end if;
  end;
  reset role;
  v_out := v_out || 'k(anon 거부)';

  raise exception '0075 STAGING PASS %', v_out;
end
$t$;

rollback;
