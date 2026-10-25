-- =====================================================================
-- 0096 staging 검사(DY Portfolio — 투자 승인 결재 · 손 입력 거래 · 시스템 계정 0행 · Paper) — 쓰지 않는다.
-- build-staging-dryrun.mjs 0096 0096 --tests가 0096과 같은 트랜잭션에서 돌리고 끝에 되돌린다.
-- 사람(이 시험 안에서만 만들고 되돌림): 지정자(TeamLead + '/investment', biz_dy) · AI(AIAgent) · 수집(Integration) + 실제 대표.
-- 기대: ERROR  0096 STAGING PASS a(양식) b(입금) c(진행 중 매수 거부) d(승인 뒤 매수 · 승인자 · 시각) e(덧붙이기만) f(시스템 계정 0행) g(Paper)
-- =====================================================================
do $t$
declare
  v_chair uuid;
  v_des   uuid := '00000000-0000-0000-0000-0000009601a1';
  v_agent uuid := '00000000-0000-0000-0000-0000009601a2';
  v_integ uuid := '00000000-0000-0000-0000-0000009601a3';
  v_out   text := '';
  v_sec   uuid;
  v_acc   uuid;
  v_doc   uuid;
  v_ap    uuid;
  v_pf    uuid;
  n       int;
  ok      boolean;
  r       record;
begin
  select p.user_id into v_chair from public.user_profiles p where p.role::text = 'Chairman' and p.revoked_at is null order by p.created_at limit 1;
  if v_chair is null then raise exception 'FAIL 준비: 대표 없음'; end if;
  insert into auth.users (id, email) values (v_des, 'dryrun96-des@example.com'), (v_agent, 'dryrun96-agent@example.com'), (v_integ, 'dryrun96-integ@example.com');
  insert into public.user_profiles (user_id, role, display_name, max_security_class) values (v_des, 'TeamLead', '지정자96', 'Normal'), (v_agent, 'AIAgent', 'ai96', 'Restricted'), (v_integ, 'Integration', 'sync96', 'Restricted');
  insert into public.user_module_access (user_id, module, can_write) values (v_des, '/investment', false);
  insert into public.user_business_access (user_id, business_id) values (v_des, 'biz_dy') on conflict do nothing;
  insert into public.securities (kind, name, ticker, source) values ('etf', 'DRYRUN96 ETF', 'DRY96', 'test') returning security_id into v_sec;

  if not exists (select 1 from public.ea_forms where form_key = 'investment' and active) then raise exception 'FAIL a: 양식 없음'; end if;
  v_out := v_out || 'a(양식) ';

  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  perform public.feature_switch_set('approvals', 'biz_dy', true, 'all', 'staging 시험(되돌림)');
  insert into public.corporate_investment_accounts (name, broker, account_last4) values ('DRYRUN 계좌', '시험증권', '0000') returning account_id into v_acc;
  insert into public.corporate_transactions (account_id, trade_date, kind, amount, amount_krw) values (v_acc, '2026-11-01', 'deposit', 1000000, 1000000);
  reset role;
  v_out := v_out || 'b(입금) ';

  perform set_config('request.jwt.claims', json_build_object('sub', v_des, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_des::text, true);
  set local role authenticated;
  v_doc := public.ea_save_draft(null, 'biz_dy', 'investment', 'DRYRUN 정기 적립', '근거',
    '{"kind":"월 정기 적립","target":"DRY96","total":"1000000","rationale":"staging 시험 — 월 100만 원 계획"}'::jsonb,
    '[{"role":"Chairman","kind":"approve"}]'::jsonb, '[]'::jsonb, null, null, null, null);
  perform public.ea_submit(v_doc, 'stg96-sub-0001');
  insert into public.corporate_investment_approvals (kind, title, amount_krw, ea_doc_id) values ('monthly_plan', 'DRYRUN 정기 적립', 1000000, v_doc) returning approval_id into v_ap;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_chair, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_chair::text, true);
  set local role authenticated;
  ok := false;
  begin
    insert into public.corporate_transactions (account_id, trade_date, kind, security_id, shares, price, currency, fx_rate, amount, amount_krw, approval_id)
      values (v_acc, '2026-11-03', 'buy', v_sec, 4, 110, 'USD', 1400, 440, 616000, v_ap);
  exception when insufficient_privilege then ok := sqlerrm like 'investment_trade_not_approved%';
  end;
  if not ok then raise exception 'FAIL c: 결재 진행 중 매수가 들어갔다'; end if;
  v_out := v_out || 'c(진행 중 매수 거부) ';

  perform public.ea_act(v_doc, 1, 'approve', '승인', 'stg96-act-0001');
  insert into public.corporate_transactions (account_id, trade_date, kind, security_id, shares, price, currency, fx_rate, amount, amount_krw, approval_id)
    values (v_acc, '2026-11-03', 'buy', v_sec, 4, 110, 'USD', 1400, 440, 616000, v_ap);
  select approved_by_name, approved_at into r from public.corporate_transactions where account_id = v_acc and kind = 'buy';
  if r.approved_by_name is null or r.approved_at is null then raise exception 'FAIL d: 승인자 · 시각 없음'; end if;
  v_out := v_out || 'd(승인 뒤 매수 · 승인자 · 시각) ';

  ok := false;
  begin
    update public.corporate_transactions set amount_krw = 1 where account_id = v_acc;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL e: 거래를 고쳤다'; end if;
  reset role;
  v_out := v_out || 'e(덧붙이기만) ';

  foreach v_integ in array array[v_agent, '00000000-0000-0000-0000-0000009601a3'::uuid] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_integ, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_integ::text, true);
    set local role authenticated;
    select (select count(*) from public.corporate_transactions) + (select count(*) from public.corporate_investment_accounts) + (select count(*) from public.corporate_investment_approvals) into n;
    reset role;
    if n <> 0 then raise exception 'FAIL f: 시스템 계정이 Real % 줄을 봤다', n; end if;
  end loop;
  v_out := v_out || 'f(시스템 계정 0행) ';

  select portfolio_id into v_pf from public.paper_portfolios limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  set local role authenticated;
  insert into public.paper_transactions (portfolio_id, security_id, side, signal_at, trade_date, shares, price, price_source, created_kind)
    values (v_pf, v_sec, 'buy', '2026-11-01T01:00:00Z', '2026-11-02', 10, 100, 'test', 'system');
  ok := false;
  begin
    update public.paper_transactions set price = 1 where security_id = v_sec;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL g: Paper를 고쳤다'; end if;
  reset role;
  v_out := v_out || 'g(Paper)';

  raise exception '0096 STAGING PASS %', v_out;
end
$t$;
