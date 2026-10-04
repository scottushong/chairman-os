-- =====================================================================
-- Chairman OS — 0052_ecount_monthly_import (ECOUNT 월별 손익 등록 RPC)
-- 작성: 2026-10-04 (설계: docs/superpowers/specs/2026-10-02-ecount-excel-import.md «B-③» ·
--       DEFERRED «0050» 절의 «업로드 전표 잇기 · 내리기» · «0051 월별 RPC가 챙길 것» · «0051 등록 RPC» 절의 «못 한 것»)
--
-- 왜: 월별 손익 업로드는 미리보기(검증)까지만 있었다. 0050이 finance_import_slips(활성 (회사, 달) 하나)를 만들어 두었고,
-- 0051이 업로드 판정(finance_import_claim)을 세웠다. 이 파일은 그 둘을 이어 **달마다 요약 전표 한 장**을 싣는다.
--
-- ■ 이 파일이 하는 것 ■
--   0절 도우미 하나 — ecount_monthly_counter_code() = 'ECOUNT-PL'. 앱 ECOUNT_MONTHLY_COUNTER와 같은 값(check-migrations가 대조).
--   1절 ecount_monthly_import(import_id, file_sha256, period_key, basis, months) → {months:[…], posted, corrected, unchanged}
--       p_months [{month:'YYYY-MM', lines:[{account_code, amount}]}]  amount = 차변 − 대변(0015 규약 — 수익 −, 비용 +).
--       **당월 금액**이다 — 누계(YTD) → 당월은 앱이 원본에서 바꾼다(lib/ecount/excel/monthly-import.ts ytdToMonthly ·
--       monthlyLedgerMonths). DB는 basis가 미리보기 때 확정한 열 지정(summary.mapping.basis)과 같은지만 다시 본다.
--       한 트랜잭션:
--         ① 판정 — finance_import_claim(본인 · draft · monthly · sha256 · 장부 권한 · ECOUNT 회사 · 사람) · 해 · basis
--         ② 회사 단위 advisory lock — 같은 회사의 월별 등록 둘이 같은 달 · 대응 계정을 동시에 만지지 않게
--         ③ 원본 첨부 줄을 for update로 잡고 «정확히 하나 · 올린 사람 = 만든 사람 · 같은 회사 · xlsx · Storage 객체 있음»
--         ④ 줄 모양 · 달 모양(그 해 안 · 겹치지 않음) · 한 달 한 계정 한 줄 · 0원 줄 없음 · 장부에 있는 계정 ·
--            **손익 계정만**(재무상태표 계정이 섞이면 거부) · 활성 계정 · 대응 계정 코드는 보내지 못함
--         ⑤ 마감된 달(그 달 이후 closings) 거부 · 세무사 확정(basis='accountant' 활성 · 해/분기)이 덮은 달 거부
--         ⑥ 대응 계정 «ECOUNT 월별손익 대응»(equity) 없으면 감사 → 만든다 / 있으면 equity · 활성인지 본다
--         ⑦ 달마다(달 순서): 그 달 **활성 업로드 전표**(finance_import_slips)를 for update로 잡고
--              없음        → 감사 먼저 → 전표(journal_entry_insert) → 업로드 전표 줄
--              같은 내용   → 건너뜀(쓰기 · 감사 없음)
--              다른 내용   → 감사 먼저 → post_correction(역분개 + 정정분개 — 같은 호출자 · 같은 트랜잭션) →
--                            옛 줄 supersede → 정정분개를 새 활성 줄로
--              이미 역분개됨(누가 손으로 정정했거나 가짜 역분개) → **멈춘다**(ecount_month_reversed). 또 뒤집지 않는다.
--         ⑧ 업로드 committed + summary.result
--
-- ■ 고른 것 — 다른 선택지는 DEFERRED «2026-10-04 — ECOUNT 월별 등록 RPC 0052» ■
--   * 대응 계정: 손익만으로는 전표가 닫히지 않는다. 그 달 손익 합(= −순이익)의 반대쪽에 «ECOUNT 월별손익 대응» 한 줄.
--     equity라 현금 · 채권 · 채무 KPI를 건드리지 않고(설계서 B-③), cash_flow='operating'이라 현금흐름표에서
--     순이익을 되돌려 «현금 증감 0»으로 검산이 맞는다(lib/ledger/statements.ts cashFlowMonth). 코드는 숫자가 아닌
--     'ECOUNT-PL' — ECOUNT 코드(숫자)와 부딪히지 않는다(ACCOUNT_CODE_PATTERN 안).
--   * 재업로드: post_correction을 **그대로** 부른다 — 역분개 모양(0050 supersede 정책이 재는 «정확한 반대»)을 손으로
--     다시 만들지 않는다. 정정분개가 새 활성 줄이다(0050 insert 정책이 정정분개는 잇는다고 적어 둔 그 길).
--   * 재무상태표 계정: 거부(ecount_monthly_bs_account). 미리보기도 경고 → 차단으로 바꿨다.
--
-- ■ FORCE와 definer(HANDOVER §3 ①) ■
--   journal_entries · journal_lines · accounts · closings · audit_log  force 그대로. definer 안에서도 호출자의 auth.uid()로
--       정책을 다시 탄다 — claim이 can_keep_books를 봤으니 같은 답이다(journal_entries_insert · journal_lines_books_insert ·
--       accounts_books_insert · audit_log_insert). 마감 · 비활성 · 차대는 0016 트리거가 한 번 더 막는다.
--   finance_import_slips · finance_imports · attachments · official_statements  force 없음 → 소유자는 정책을 안 탄다.
--       그래서 판정(본인 업로드 · 역분개 · 첨부 주인)을 몸통이 한다. finance_import_slips의 0050 정책(사람의 insert ·
--       supersede)은 그대로 둔다 — 사람이 정확한 역분개 뒤에 줄을 내리는 길(0050 2절)은 남는다.
--   storage.objects   Supabase에서는 소유자가 아니다 — 소유자(postgres)에게 select 권한이 있을 때만 객체를 확인하고,
--       그 읽기는 호출자의 Storage 정책(attachments_objects_read — 올린 본인은 통행증 없이 본다)을 탄다.
--
-- ■ 하지 않는 것 ■
--   * 마감된 달의 «당월 자동 정정» — 손익을 엉뚱한 달로 옮긴다(설계서 B-③). 거부만 한다.
--   * 그 달 수기 전표와의 겹침 — 경고(미리보기)만. DB는 막지 않는다(수기 전표가 정당한 달도 있다).
--   * 올린 파일에서 0원이 된 달(앞 업로드에는 있던 달)은 손대지 않는다 — 앱이 금액 있는 달만 보낸다(DEFERRED 남은 일).
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0051을 고치지 않는다 · 새 enum 값 없음 · 새 표 없음 · service 키 없음.
-- =====================================================================

begin;

-- =====================================================================
-- 0절. 대응 계정 코드 — 사람이 부르지 못한다
-- =====================================================================
create or replace function ecount_monthly_counter_code() returns text
language sql immutable set search_path = public as $fn$
  select 'ECOUNT-PL'::text;
$fn$;

comment on function ecount_monthly_counter_code() is
  '0052. ECOUNT 월별 손익 업로드의 대응 계정 코드. 앱 ECOUNT_MONTHLY_COUNTER와 같은 값(check-migrations가 대조한다).';

revoke all on function ecount_monthly_counter_code() from public, anon, authenticated;

-- =====================================================================
-- 1절. ecount_monthly_import — 월별 손익(ECOUNT 엑셀 · 잠정) 등록
-- =====================================================================
create or replace function ecount_monthly_import(
  p_import_id   uuid,
  p_file_sha256 text,
  p_period_key  text,   -- 미리보기 때 사람이 본 해('YYYY'). 업로드 줄의 period_key와 같아야 한다.
  p_basis       text,   -- 'monthly' | 'ytd' — 미리보기 때 확정한 열 지정(summary.mapping.basis)과 같아야 한다.
  p_months      jsonb   -- [{month:'YYYY-MM', lines:[{account_code, amount}]}] — 당월 금액 · 원장 규약(차변 − 대변)
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_imp       finance_imports%rowtype;
  v_att       attachments%rowtype;
  v_acc       accounts%rowtype;
  v_prev      finance_import_slips%rowtype;
  v_counter   constant text := ecount_monthly_counter_code();
  v_n         int;
  v_bad       text;
  v_m         jsonb;
  v_month     text;
  v_date      date;
  v_memo      text;
  v_note      text;
  v_total     numeric(20, 2);
  v_slip      jsonb;
  v_prev_lines jsonb;
  v_same      boolean;
  v_corr      jsonb;
  v_new       text;
  v_out       jsonb := '[]'::jsonb;
  v_posted    int := 0;
  v_corrected int := 0;
  v_unchanged int := 0;
begin
  -- ① 판정
  v_imp := finance_import_claim(p_import_id, 'monthly', p_file_sha256);
  if v_imp.period_key is null then
    raise exception using errcode = 'P0001', message = 'finance_import_period', detail = '몇 년도 자료인지 정해지지 않았다.';
  end if;
  if p_period_key is distinct from v_imp.period_key then
    raise exception using errcode = 'P0001', message = 'import_changed',
      detail = format('미리보기의 해(%s)와 업로드의 해(%s)가 다르다. 미리보기를 다시 한다.', p_period_key, v_imp.period_key);
  end if;
  -- 누계 → 당월은 앱이 바꾼다. DB가 잴 수 있는 것은 «사람이 미리보기에서 본 당월/누계 표시로 바꾼 금액인가»다.
  if p_basis is null or p_basis not in ('monthly', 'ytd')
     or p_basis is distinct from (v_imp.summary -> 'mapping' ->> 'basis') then
    raise exception using errcode = 'P0001', message = 'import_changed',
      detail = format('당월/누계 표시(%s)가 미리보기에서 확정한 열 지정(%s)과 다르다.', p_basis, v_imp.summary -> 'mapping' ->> 'basis');
  end if;

  -- ② 같은 회사의 월별 등록은 한 번에 하나. 같은 달 활성 줄 · 대응 계정을 두 트랜잭션이 같이 만지면 하나는 unique에 깨지고
  --    다른 하나는 이미 밀려난 줄을 또 뒤집으려 한다. 기다린 쪽은 앞 등록이 끝난 장부를 보고 이어 간다(read committed).
  perform pg_advisory_xact_lock(hashtext('ecount_monthly_import:' || v_imp.business_id));

  -- ③ 원본 — 미리보기 때 그 파일이 아직 거기 있는가(DEFERRED «0051 월별 RPC가 챙길 것»). sha256은 claim이 봤다.
  select count(*) into v_n
    from (select 1 from attachments
           where entity_table = 'finance_imports' and entity_id = v_imp.import_id::text
           for update) a;
  select * into v_att from attachments where entity_table = 'finance_imports' and entity_id = v_imp.import_id::text limit 1;
  if v_n <> 1 or v_att.uploaded_by is distinct from v_imp.created_by or v_att.business_id is distinct from v_imp.business_id
     or v_att.mime <> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then
    raise exception using errcode = 'P0001', message = 'ecount_original_missing',
      detail = format('업로드 원본 첨부가 %s개이거나 올린 사람 · 회사 · 형식이 업로드와 다르다.', v_n);
  end if;
  if to_regclass('storage.objects') is not null then
    if has_table_privilege('storage.objects', 'select') then
      if not exists (select 1 from storage.objects where bucket_id = 'attachments' and name = v_att.storage_path) then
        raise exception using errcode = 'P0001', message = 'ecount_original_missing', detail = '원본 파일 객체가 Storage에 없다.';
      end if;
    end if;
  end if;

  -- ④ 모양
  if jsonb_typeof(p_months) is distinct from 'array' or jsonb_array_length(p_months) = 0 then
    raise exception using errcode = 'P0001', message = 'statement_empty', detail = '실을 달이 없다.';
  end if;
  select coalesce(m->>'month', '?') into v_bad
    from jsonb_array_elements(p_months) m
   where jsonb_typeof(m) <> 'object'
      or coalesce(m->>'month', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      or not (m->>'month' = v_imp.period_key or left(m->>'month', 5) = v_imp.period_key || '-')
      or jsonb_typeof(m->'lines') is distinct from 'array' or jsonb_array_length(m->'lines') = 0
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid',
      detail = format('달 %s의 모양이 틀렸거나 업로드의 해(%s) 밖이다.', v_bad, v_imp.period_key);
  end if;
  select m->>'month' into v_bad from jsonb_array_elements(p_months) m group by m->>'month' having count(*) > 1 limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid', detail = format('달 %s가 두 번 있다.', v_bad);
  end if;
  select (m->>'month') || ' ' || coalesce(l->>'account_code', '?') into v_bad
    from jsonb_array_elements(p_months) m, jsonb_array_elements(m->'lines') l
   where jsonb_typeof(l) <> 'object' or coalesce(l->>'account_code', '') = ''
      or jsonb_typeof(l->'amount') is distinct from 'number'
      or round((l->>'amount')::numeric, 2) = 0
      or l->>'account_code' = v_counter
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid',
      detail = format('줄 %s의 모양이 틀렸다(금액이 숫자 아님 · 0원 · 대응 계정).', v_bad);
  end if;
  select (m->>'month') || ' ' || (l->>'account_code') into v_bad
    from jsonb_array_elements(p_months) m, jsonb_array_elements(m->'lines') l
   group by m->>'month', l->>'account_code' having count(*) > 1 limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid', detail = format('%s에 줄이 둘 이상이다.', v_bad);
  end if;

  -- 계정: 장부에 있고 · 손익 계정이고 · 활성. accounts는 force — 이 읽기도 호출자의 읽기 정책을 탄다.
  select l->>'account_code' into v_bad
    from jsonb_array_elements(p_months) m, jsonb_array_elements(m->'lines') l
   where not exists (select 1 from accounts a where a.business_id = v_imp.business_id and a.account_code = l->>'account_code')
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'statement_unknown_account', detail = format('계정 %s가 장부에 없다.', v_bad);
  end if;
  select l->>'account_code' into v_bad
    from jsonb_array_elements(p_months) m, jsonb_array_elements(m->'lines') l
    join accounts a on a.business_id = v_imp.business_id and a.account_code = l->>'account_code'
   where a.section not in ('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax')
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_monthly_bs_account',
      detail = format('계정 %s는 재무상태표 계정이다. 월별 업로드는 손익 계정만 싣는다.', v_bad);
  end if;
  select l->>'account_code' into v_bad
    from jsonb_array_elements(p_months) m, jsonb_array_elements(m->'lines') l
    join accounts a on a.business_id = v_imp.business_id and a.account_code = l->>'account_code'
   where not a.active
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'inactive_account', detail = format('계정 %s는 비활성이다.', v_bad);
  end if;

  -- ⑤ 마감된 달 · 세무사 확정이 덮은 달(0016 closed_period · lib/statements/period.ts isLocked와 같은 판정)
  select m->>'month' into v_bad
    from jsonb_array_elements(p_months) m
   where exists (select 1 from closings c where c.business_id = v_imp.business_id and c.period >= m->>'month')
   order by 1 limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'closed_period',
      detail = format('%s는 마감됐다(또는 그 뒤 달이 마감됐다). 마감된 달의 월별 손익은 받지 않는다.', v_bad);
  end if;
  select m->>'month' into v_bad
    from jsonb_array_elements(p_months) m
   where exists (
     select 1 from official_statements s
      where s.business_id = v_imp.business_id and s.basis = 'accountant' and s.superseded_at is null
        and ((s.period_kind = 'year' and s.period_key = left(m->>'month', 4))
          or (s.period_kind = 'quarter' and s.period_key = left(m->>'month', 4) || '-Q' || ((substr(m->>'month', 6, 2)::int + 2) / 3)))
   )
   order by 1 limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'official_month_locked',
      detail = format('%s는 세무사 확정 결산이 덮은 달이다.', v_bad);
  end if;

  -- ⑥ 대응 계정
  select * into v_acc from accounts where business_id = v_imp.business_id and account_code = v_counter;
  if not found then
    insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
    values ('create'::audit_action, 'accounts', v_imp.business_id || ':' || v_counter, v_imp.business_id, auth.uid(), auth_role()::text,
            jsonb_build_object('account_code', v_counter, 'name', 'ECOUNT 월별손익 대응', 'section', 'equity', 'cash_flow', 'operating'),
            ecount_audit_note('monthly', v_imp.period_key, v_imp.file_name, v_imp.import_id) || ' — 대응 계정 만듦');
    insert into accounts (business_id, account_code, name, category, section, cash_flow, active, source, fetched_at)
    values (v_imp.business_id, v_counter, 'ECOUNT 월별손익 대응', 'equity'::account_category, 'equity'::account_section,
            'operating'::cash_flow_class, true, 'ecount'::data_source, now());
  elsif v_acc.section <> 'equity' or not v_acc.active then
    raise exception using errcode = 'P0001', message = 'ecount_counter_account_invalid',
      detail = format('대응 계정 %s가 자본(equity)이 아니거나 비활성이다.', v_counter);
  end if;

  -- ⑦ 달마다
  for v_m in select m from jsonb_array_elements(p_months) m order by m->>'month' loop
    v_month := v_m->>'month';
    v_date  := (to_date(v_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
    v_memo  := format('[ECOUNT 엑셀] %s 월별 손익 · import %s', v_month, v_imp.import_id);
    v_note  := ecount_audit_note('monthly', v_month, v_imp.file_name, v_imp.import_id);

    -- 전표 줄: 손익 줄(계정 순) + 대응 한 줄. amount = 차변 − 대변 → 양수 차변 · 음수 대변.
    select coalesce(sum(round((l->>'amount')::numeric, 2)), 0) into v_total from jsonb_array_elements(v_m->'lines') l;
    select jsonb_agg(x.j order by x.k)
      into v_slip
      from (select l->>'account_code' as k,
                   jsonb_build_object('account_code', l->>'account_code',
                                      'side', case when round((l->>'amount')::numeric, 2) > 0 then 'debit' else 'credit' end,
                                      'amount', abs(round((l->>'amount')::numeric, 2))) as j
              from jsonb_array_elements(v_m->'lines') l) x;
    if v_total <> 0 then
      v_slip := v_slip || jsonb_build_array(jsonb_build_object(
        'account_code', v_counter, 'side', case when v_total > 0 then 'credit' else 'debit' end,
        'amount', abs(v_total), 'memo', 'ECOUNT 월별손익 대응'));
    end if;

    select * into v_prev from finance_import_slips
     where business_id = v_imp.business_id and month = v_month and superseded_at is null
     for update;

    if not found then
      insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
      values ('create'::audit_action, 'finance_import_slips', v_imp.business_id || ':' || v_month, v_imp.business_id,
              auth.uid(), auth_role()::text,
              jsonb_build_object('import_id', v_imp.import_id, 'entry_date', v_date, 'lines', v_slip), v_note);
      v_new := journal_entry_insert(v_imp.business_id, v_date, v_memo, null, v_slip, null, null);
      insert into finance_import_slips (business_id, month, slip_no, import_id)
      values (v_imp.business_id, v_month, v_new, v_imp.import_id);
      v_posted := v_posted + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('month', v_month, 'action', 'posted', 'slip_no', v_new));
      continue;
    end if;

    -- 활성 업로드 전표가 이미 역분개됐다 — 누가 손으로 정정했거나(post_correction) 가짜 역분개로 막혔다.
    -- 또 뒤집지 않는다(전표당 역분개 하나 · 0016 journal_entries_one_reversal). 사람이 장부를 보고 정리한다.
    if exists (select 1 from journal_entries r
                where r.business_id = v_imp.business_id and r.corrects_id = v_prev.slip_no and r.correction_kind = 'reversal') then
      raise exception using errcode = 'P0001', message = 'ecount_month_reversed',
        detail = format('%s의 업로드 전표 %s가 이미 역분개됐다. 그 정정을 확인한 뒤 다시 올린다.', v_month, v_prev.slip_no);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('account_code', account_code, 'side', side, 'amount', amount) order by line_no), '[]'::jsonb)
      into v_prev_lines
      from journal_lines where business_id = v_imp.business_id and slip_no = v_prev.slip_no;
    -- 같은 내용(계정 · 차대 · 금액의 모음)이면 건너뛴다 — 같은 파일을 다시 올려도 정정 전표가 쌓이지 않게.
    v_same := not exists (
             select 1
               from (select account_code, side::text as side, amount from journal_lines
                      where business_id = v_imp.business_id and slip_no = v_prev.slip_no) o
               full join (select l->>'account_code' as account_code, l->>'side' as side, (l->>'amount')::numeric as amount
                            from jsonb_array_elements(v_slip) l) n
                 on n.account_code = o.account_code and n.side = o.side and n.amount = o.amount
              where o.account_code is null or n.account_code is null)
           and jsonb_array_length(v_prev_lines) = jsonb_array_length(v_slip);
    if v_same then
      v_unchanged := v_unchanged + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('month', v_month, 'action', 'unchanged', 'slip_no', v_prev.slip_no));
      continue;
    end if;

    -- 재업로드 = 정정 전표. 감사 먼저 → 역분개 + 정정분개(post_correction — 같은 호출자 · 이 트랜잭션) → 옛 줄 내림 → 새 줄.
    insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
    values ('update'::audit_action, 'finance_import_slips', v_imp.business_id || ':' || v_month, v_imp.business_id,
            auth.uid(), auth_role()::text,
            jsonb_build_object('slip_no', v_prev.slip_no, 'import_id', v_prev.import_id, 'lines', v_prev_lines),
            jsonb_build_object('import_id', v_imp.import_id, 'entry_date', v_date, 'lines', v_slip),
            format('%s — 이전 전표 %s 정정', v_note, v_prev.slip_no));
    v_corr := post_correction(v_imp.business_id, v_prev.slip_no, v_date, v_memo, null, v_slip);
    v_new := v_corr->>'restatement';
    update finance_import_slips set superseded_at = now()
     where business_id = v_imp.business_id and slip_no = v_prev.slip_no and superseded_at is null;
    insert into finance_import_slips (business_id, month, slip_no, import_id)
    values (v_imp.business_id, v_month, v_new, v_imp.import_id);
    v_corrected := v_corrected + 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object('month', v_month, 'action', 'corrected', 'slip_no', v_new,
                                                           'reversal', v_corr->>'reversal', 'previous', v_prev.slip_no));
  end loop;

  -- ⑧ committed
  update finance_imports
     set status = 'committed',
         summary = coalesce(summary, '{}'::jsonb)
                   || jsonb_build_object('stage', 'committed',
                                         'result', jsonb_build_object('posted', v_posted, 'corrected', v_corrected,
                                                                      'unchanged', v_unchanged, 'months', v_out))
   where import_id = v_imp.import_id;

  return jsonb_build_object('posted', v_posted, 'corrected', v_corrected, 'unchanged', v_unchanged, 'months', v_out);
end;
$fn$;

comment on function ecount_monthly_import(uuid, text, text, text, jsonb) is
  '0052. ECOUNT 월별 손익 업로드 등록(잠정 — 월 마감이 확정으로). 달마다 요약 전표 한 장 + 대응 계정(ECOUNT-PL) 한 줄. 같은 달 재업로드는 post_correction(역분개 + 정정분개) + 옛 업로드 줄 supersede — 활성 줄은 달마다 하나라 두 번 세지 않는다. 마감 달 · 세무사 확정 달 · 재무상태표 계정 · 이미 역분개된 업로드 전표는 거부. 감사 먼저 · committed까지 한 트랜잭션.';

revoke all on function ecount_monthly_import(uuid, text, text, text, jsonb) from public, anon;
grant execute on function ecount_monthly_import(uuid, text, text, text, jsonb) to authenticated;

commit;
