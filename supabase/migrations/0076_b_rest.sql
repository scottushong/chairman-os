-- =====================================================================
-- Chairman OS — 0076_b_rest (B 남은 것: 첫 달 기초 «확인» · 기초 «일부 미입력» · 시드 정의자 거름 하나)
-- 작성: 2026-10-12 · 자율 블록 PHASE 4(«B 남은 것 + 0072 DEFERRED»)
--
-- ■ 무엇 ■
--   1. fin_opening_confirm — 첫 달 기초재고(fin_inventory_openings, 0072) «확인». 입력한 사람 ≠ 확인한 사람.
--      0072는 confirmed_by · confirmed_at 칸만 두고 RPC를 미뤘다(DEFERRED «첫 달 기초는 확정 RPC를 두지 않음»).
--      판정 = fin_valuation_confirm(0072)과 같은 결: can_keep_books · 본인 거부 · 미입력 거부 · 마감 달은 대표 · CFO + 이유 · 재마감 대상 · 감사.
--      다시 저장(fin_opening_save)하면 새 줄이 생기므로 확인은 자연히 풀린다(새 줄은 미확인).
--   2. fin_inventory_roll 다시 만듦(drop + create — 돌려주는 칸이 늘어서). 앞 칸 열은 0072 그대로, 뒤에 셋을 더한다:
--        opening_id          — 기초가 첫 달 직접 입력일 때 그 줄(확인 단추용). 그 밖 null.
--        opening_confirmed   — 첫 달 직접 입력 줄의 확인 여부. 그 밖 null.
--        prev_missing_lines  — 원재료 기초가 앞 달 명세서 기말일 때, 앞 달의 빈칸 줄 수.
--      0072 DEFERRED «앞 달 명세서에 빈칸 줄이 섞이면 아는 줄만 더한 합을 앞 달 기말로 쓴다»: 이제 그때 opening_state = 'partial'
--      («일부 미입력»)로 돌려준다(금액은 아는 줄의 합 그대로 — 0으로 채우지 않는다). 표에 적는 상태가 아니라 이 함수의 결과만이다
--      (fin_value_state_ok 제약과 무관). 월별 손익(0075)은 이 함수를 쓰지 않고 원료별로 빈칸을 따로 본다 — 바뀌지 않는다.
--   3. 시드 A안 정의자 거름(0072 리뷰의 «남긴 것» 17개 재검토): 시드 표의 **내용**을 대표 아닌 세션에 돌려주는 것은
--      cost_purchase_candidates(0061 — 구매 담당에게 승인된 구매 결재의 제목 · 품목 · 공급처 · 금액) 하나다.
--      같은 거름 한 줄(not is_example or 대표)을 더해 다시 만든다(본문은 0061 그대로). 나머지 열여섯은 앱이 만든 id로만 움직이거나
--      내용을 돌려주지 않는다 — docs/decisions · DEFERRED.md.
--
-- 0035 규칙: 0001~0075를 고치지 않는다 · FORCE를 새로 걸거나 끄지 않는다. 함수는 public · anon에서 이름으로 회수.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 첫 달 기초 «확인»
-- =====================================================================
create or replace function fin_opening_confirm(p_id uuid, p_reason text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_row fin_inventory_openings;
begin
  select * into v_row from fin_inventory_openings where opening_id = p_id for update;
  if v_row.opening_id is null or not coalesce(can_keep_books(v_row.business_id), false)
     or not coalesce(feature_on('finance_upload', v_row.business_id), false) then
    raise exception 'fin_upload_denied' using errcode = '42501';
  end if;
  if v_row.voided_at is not null or v_row.confirmed_at is not null then
    return false;
  end if;
  if v_row.entered_by = auth.uid() then
    raise exception 'fin_opening_self_confirm' using errcode = '42501';
  end if;
  if v_row.value_state = 'missing' then
    raise exception 'fin_opening_missing' using errcode = '22023';
  end if;
  perform fin_closed_gate(v_row.business_id, v_row.period, p_reason);
  update fin_inventory_openings set confirmed_by = auth.uid(), confirmed_at = now() where opening_id = p_id;
  perform fin_reclose_mark(v_row.business_id, v_row.period, null, 'opening', coalesce(p_reason, '첫 달 기초 확인'));
  perform fin_audit('approve', 'fin_inventory_openings', p_id::text, v_row.business_id, jsonb_build_object('confirmed', false),
    jsonb_build_object('confirmed', true, 'period', v_row.period, 'category', v_row.category, 'entered_by', v_row.entered_by),
    '첫 달 기초재고 확인(0076)');
  return true;
end;
$fn$;

comment on function fin_opening_confirm(uuid, text) is
  '0076. 첫 달 기초재고 «확인» — 입력한 사람이 아닌 장부 쓰기 권한자. 미입력 · 무효 · 이미 확인은 거부 또는 false. 마감 달은 대표 · CFO + 이유.';

-- =====================================================================
-- 2절. 기초재고 연결 — «일부 미입력» · 확인 여부(보여 주기만)
-- =====================================================================
drop function if exists fin_inventory_roll(text, text);
create function fin_inventory_roll(p_business text, p_period text)
returns table (category text, opening_amount numeric, opening_state text, opening_source text,
               closing_amount numeric, closing_state text, closing_status text, missing_lines int,
               statement_opening numeric, diff_vs_prev_close numeric,
               opening_id uuid, opening_confirmed boolean, prev_missing_lines int)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
declare
  v_prev text := fin_prev_period(p_period);
  c      text;
  v_pa   numeric; v_ps text;     -- 앞 달 기말
  v_pmiss int;                   -- 앞 달 빈칸 줄 수(원재료)
  v_oa   numeric; v_os text; v_osrc text;
  v_oid  uuid; v_ocf boolean;
  v_ca   numeric; v_cs text; v_cst text; v_miss int;
  v_st   numeric;
  v_n    int; v_known int;
begin
  if not coalesce(can_read_books(p_business), false) or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return;
  end if;
  foreach c in array array['raw', 'wip', 'finished'] loop
    v_pa := null; v_ps := null; v_pmiss := 0; v_ca := null; v_cs := 'missing'; v_cst := null; v_miss := 0; v_st := null;
    v_oid := null; v_ocf := null;
    if c = 'raw' then
      -- 앞 달 기말
      select count(*), count(*) filter (where l.amount_state <> 'missing'), sum(l.amount) filter (where l.amount_state <> 'missing')
        into v_n, v_known, v_pa
        from fin_inventory_lines l where l.business_id = p_business and l.period = v_prev and l.voided_at is null;
      if v_known = 0 then v_pa := null; v_ps := null; else v_ps := case when v_pa = 0 then 'confirmed_zero' else 'value' end; end if;
      v_pmiss := coalesce(v_n, 0) - coalesce(v_known, 0);
      -- 이 달 기말 · 명세서 기초
      select count(*), count(*) filter (where l.amount_state <> 'missing'), sum(l.amount) filter (where l.amount_state <> 'missing'),
             count(*) filter (where l.amount_state = 'missing'),
             sum(l.opening_amount) filter (where l.opening_state <> 'missing')
        into v_n, v_known, v_ca, v_miss, v_st
        from fin_inventory_lines l where l.business_id = p_business and l.period = p_period and l.voided_at is null;
      if v_known = 0 then v_ca := null; v_cs := 'missing'; else v_cs := case when v_ca = 0 then 'confirmed_zero' else 'value' end; end if;
    else
      select v.amount, v.value_state into v_pa, v_ps
        from fin_inventory_valuations v
       where v.business_id = p_business and v.period = v_prev and v.category = c and v.voided_at is null and v.status = 'final';
      if v_ps = 'missing' then v_pa := null; v_ps := null; end if;
      select v.amount, v.value_state, v.status into v_ca, v_cs, v_cst
        from fin_inventory_valuations v
       where v.business_id = p_business and v.period = p_period and v.category = c and v.voided_at is null;
      v_cs := coalesce(v_cs, 'missing');
    end if;

    if v_ps is not null then
      v_oa := v_pa; v_osrc := 'prev_close';
      -- 0076: 앞 달에 빈칸 줄이 섞였으면 «일부 미입력»(아는 줄의 합 — 온전한 기초로 보이지 않게).
      v_os := case when v_pmiss > 0 then 'partial' else v_ps end;
    else
      select o.amount, o.value_state, o.source, o.opening_id, (o.confirmed_at is not null)
        into v_oa, v_os, v_osrc, v_oid, v_ocf
        from fin_inventory_openings o
       where o.business_id = p_business and o.period = p_period and o.category = c and o.voided_at is null;
      if v_osrc is null then
        v_oa := null; v_os := 'missing'; v_osrc := 'unlinked'; v_oid := null; v_ocf := null;
      end if;
    end if;

    category := c; opening_amount := v_oa; opening_state := v_os; opening_source := v_osrc;
    closing_amount := v_ca; closing_state := v_cs; closing_status := v_cst; missing_lines := v_miss;
    statement_opening := v_st;
    diff_vs_prev_close := case when v_st is not null and v_ps is not null then v_st - v_pa end;
    opening_id := v_oid; opening_confirmed := v_ocf;
    prev_missing_lines := case when v_osrc = 'prev_close' then v_pmiss else 0 end;
    return next;
    v_oa := null; v_os := null; v_osrc := null;
  end loop;
end;
$fn$;

comment on function fin_inventory_roll(text, text) is
  '0072 → 0076. 기초재고 연결(보여 주기만). 0076: 앞 달 명세서에 빈칸 줄이 섞이면 원재료 기초 opening_state = partial(«일부 미입력») · 첫 달 직접 입력 줄 id · 확인 여부.';

-- =====================================================================
-- 3절. 시드 A안 정의자 거름 — cost_purchase_candidates(0061 본문 그대로 + 거름 한 줄)
-- =====================================================================
create or replace function cost_purchase_candidates(p_business text)
returns table (decision_id text, title text, item text, vendor text, quantity numeric, amount_krw numeric, link text, decided_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not cost_can('purchasing', p_business, true) then
    raise exception 'cost_not_found' using errcode = 'P0002';
  end if;
  return query
  select d.decision_id, d.title,
         left(d.form ->> 'item', 200), left(d.form ->> 'vendor', 200),
         case when (d.form ->> 'quantity') ~ '^[0-9]+(\.[0-9]+)?$' then (d.form ->> 'quantity')::numeric end,
         case when replace(d.form ->> 'amount', ',', '') ~ '^[0-9]+(\.[0-9]+)?$' then replace(d.form ->> 'amount', ',', '')::numeric end,
         case when (d.form ->> 'link') ~* '^https?://' then left(d.form ->> 'link', 1000) end,
         d.decided_at
    from decisions d
   where d.business_id = p_business and d.template_key = 'purchase' and d.status = 'Approved'
     and (not d.is_example or coalesce(auth_role()::text, '') = 'Chairman')
     and not exists (select 1 from cost_purchase_lots l where l.source = 'approval' and l.source_ref = d.decision_id and l.voided_at is null)
     and not exists (select 1 from cost_candidate_dismissals x where x.decision_id = d.decision_id)
   order by d.decided_at desc nulls last, d.decision_id
   limit 200;
end;
$fn$;

-- =====================================================================
-- 4절. 함수 권한 — public · anon에게서 이름으로 걷는다. 부르는 RPC만 authenticated.
-- =====================================================================
revoke all on function fin_opening_confirm(uuid, text) from public, anon;
revoke all on function fin_inventory_roll(text, text) from public, anon;
revoke all on function cost_purchase_candidates(text) from public, anon;
grant execute on function fin_opening_confirm(uuid, text) to authenticated;
grant execute on function fin_inventory_roll(text, text) to authenticated;
grant execute on function cost_purchase_candidates(text) to authenticated;

commit;
