-- =====================================================================
-- Chairman OS — 0056_ecount_finish (ECOUNT 월별 등록 마무리 · 마감과 같은 회사 잠금)
-- 작성: 2026-10-06 (설계: docs/superpowers/specs/2026-10-02-ecount-excel-import.md «B-③» ·
--       DEFERRED «2026-10-04 — ECOUNT 월별 등록 RPC 0052» 남은 일 · 리뷰 m-2 · m-3 · «2026-10-04 블록» ECOUNT 남은 것)
--
-- 번호: 0053은 비어 있고 0054 · 0055는 결재 브랜치 몫이라 이 파일은 0056이다(병합 순서 — release-order-2026-10.md).
--
-- 왜: 0052 월별 등록에 남은 셋과 0016부터 있던 경쟁 하나.
--   ① 첫 등록은 감사가 finance_import_slips 줄(회사:달)뿐이었다 — 재업로드는 post_correction이 전표(journal_entries)
--      감사를 하나 더 남겨서, 전표 번호로 감사를 찾으면 첫 업로드 전표만 비었다.
--   ② 새 파일에서 금액이 다 빠진 달(앞 업로드엔 금액)은 옛 업로드 전표가 그대로 남았다(리뷰 m-3) — 장부가 옛 파일을 말한다.
--   ③ close_period가 회사 잠금을 잡지 않았다(리뷰 m-2) — 월별 등록(잠금 잡음)과 같은 달 마감이 동시에 돌면
--      마감 스냅샷 뒤에 업로드 전표가 끼어들 수 있었다(closed_period 트리거는 커밋 전 마감을 못 본다).
--
-- ■ 이 파일이 하는 것 ■
--   0절 finance_books_lock_key(business_id) → bigint. **0052가 쓰던 열쇠 그대로**(hashtext('ecount_monthly_import:' || 회사)) —
--       0052판 등록이 이 마이그레이션을 건너 돌고 있어도 같은 열쇠라 서로 기다린다. 이름만 «장부 회사 잠금»으로 세운다.
--   1절 ecount_monthly_import — 0052 본문 그대로 + 세 군데:
--       a. 잠금은 finance_books_lock_key(같은 값).
--       b. **빈 달**({month, lines: [], reverses: '<전표 번호>'})을 받는다 = «이 파일은 그 달을 말하지만 금액이 하나도 없다 —
--          미리보기에서 사람이 확인한 그 업로드 전표를 역분개한다»(앱은 미리보기가 역분개할 달로 적고 사람이 확인한 달만 보낸다).
--            활성 업로드 전표 = reverses → 감사 먼저 → post_correction(줄 없이 = 역분개만) → 옛 줄 supersede · 새 줄 없음
--                                        (action 'reversed', 결과 reversed 셈)
--            없음 · 다른 전표             → import_changed(detail «ecount_ledger_changed» — 미리보기 뒤 장부가 바뀌었다:
--                                        남이 그 사이 등록 · 정정했다. 보지 않은 전표를 뒤집지 않는다 — 리뷰 I-2)
--            이미 역분개됨                → ecount_month_reversed(0052와 같이 멈춘다)
--          reverses 없는 빈 달 · 금액 있는 달의 reverses는 ecount_plan_invalid.
--          마감 달 · 세무사 확정 달 판정은 **금액 있는 달 + 되돌릴 전표가 있는 빈 달**에만 건다 — 마감된 달의 0칸은
--          손댈 것이 없으니 막지 않는다. 대응 계정은 금액 있는 달이 있을 때만 만든다.
--       c. 첫 등록도 **전표 감사 한 줄**(entity journal_entries · 전표 번호) — post_journal_entry(0016)가 남기는 모양과 같다.
--          달 감사(finance_import_slips · 회사:달)는 그대로 먼저 남는다. note는 ecount_audit_note(달) + « — 전표 M…».
--   2절 close_period — 0047 본문 그대로 + 권한 판정 바로 뒤에 같은 회사 잠금 한 줄.
--       월별 등록이 잠금을 쥐고 있으면 마감은 그 등록이 끝난 장부(read committed)를 보고 찍는다.
--       마감이 쥐고 있으면 등록은 기다렸다가 새 마감을 보고 closed_period로 거부한다.
--
-- ■ 고른 것 — 다른 선택지는 DEFERRED «2026-10-06 — ECOUNT 마무리 0056» ■
--   * 열쇠를 바꾸지 않는다(이름 있는 도우미로만 감싼다). 다른 선택지: hashtext('books:'||회사) 새 열쇠 — 배포 순간
--     0052판 등록과 0056판 마감이 다른 열쇠를 잡아 서로 못 본다.
--   * 수기 전표(post_journal_entry · post_correction 직접 호출)는 이 잠금을 잡지 않는다 — 0016부터 같은 경쟁이 있고
--     장부 블록에서 고친다(DEFERRED). 등록 안에서 부르는 post_correction은 같은 트랜잭션이라 잠금이 이미 있다.
--
-- ■ FORCE와 definer(HANDOVER §3 ①) — 0052와 같다 ■
--   ecount_monthly_import는 definer · search_path(public, pg_temp). 장부 표(journal_entries · journal_lines · accounts ·
--   closings · audit_log)는 force 그대로 — 호출자 정책을 다시 탄다. 새 force 해제 없음.
--   close_period는 invoker 그대로(0016 · 0047) — search_path에 pg_temp만 더했다. 잠금 열쇠 도우미는 immutable sql이고
--   그 invoker 함수가 부르니 authenticated에 실행을 준다(값 하나를 계산할 뿐 — 잠금 자체는 pg_advisory_xact_lock이 누구에게나 열려 있다).
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0052를 고치지 않는다(함수는 create or replace) · 새 enum 값 없음 ·
-- 새 표 없음 · service 키 없음.
-- =====================================================================

begin;

-- =====================================================================
-- 0절. 장부 회사 잠금 열쇠 — 0052의 값 그대로
-- =====================================================================
create or replace function finance_books_lock_key(p_business_id text) returns bigint
language sql immutable set search_path = public, pg_temp as $fn$
  select hashtext('ecount_monthly_import:' || p_business_id)::bigint;
$fn$;

comment on function finance_books_lock_key(text) is
  '0056. 한 회사 장부의 트랜잭션 잠금 열쇠(pg_advisory_xact_lock). ECOUNT 월별 등록(0052 · 0056)과 월 마감(close_period)이 같이 잡는다. 0052가 쓰던 값 그대로.';

revoke all on function finance_books_lock_key(text) from public, anon;
grant execute on function finance_books_lock_key(text) to authenticated;

-- =====================================================================
-- 1절. ecount_monthly_import — 0052 본문 + 빈 달 · 첫 등록 전표 감사 · 잠금 도우미
-- =====================================================================
create or replace function ecount_monthly_import(
  p_import_id   uuid,
  p_file_sha256 text,
  p_period_key  text,   -- 미리보기 때 사람이 본 해('YYYY'). 업로드 줄의 period_key와 같아야 한다.
  p_basis       text,   -- 'monthly' | 'ytd' — 미리보기 때 확정한 열 지정(summary.mapping.basis)과 같아야 한다.
  p_months      jsonb   -- [{month:'YYYY-MM', lines:[{account_code, amount}]}] — 당월 금액 · 원장 규약(차변 − 대변).
                        -- lines = [] 는 «파일이 말하는 달인데 금액이 없다»(0056) — 그 달 활성 업로드 전표를 역분개한다.
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
  v_reversed  int := 0;
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
  if p_basis is null or p_basis not in ('monthly', 'ytd')
     or p_basis is distinct from (v_imp.summary -> 'mapping' ->> 'basis') then
    raise exception using errcode = 'P0001', message = 'import_changed',
      detail = format('당월/누계 표시(%s)가 미리보기에서 확정한 열 지정(%s)과 다르다.', p_basis, v_imp.summary -> 'mapping' ->> 'basis');
  end if;

  -- ② 같은 회사의 월별 등록 · 월 마감은 한 번에 하나(0056 — close_period도 같은 열쇠).
  perform pg_advisory_xact_lock(finance_books_lock_key(v_imp.business_id));

  -- ③ 원본 — 0052와 같다.
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
    if not has_table_privilege('storage.objects', 'select') then
      raise exception using errcode = 'P0001', message = 'ecount_original_missing',
        detail = 'Storage 객체를 확인할 권한이 없다(storage.objects select). 확인하지 못한 원본으로는 싣지 않는다.';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'attachments' and name = v_att.storage_path) then
      raise exception using errcode = 'P0001', message = 'ecount_original_missing', detail = '원본 파일 객체가 Storage에 없다.';
    end if;
  end if;

  -- ④ 모양 — 빈 달(lines = [])을 받는다(0056).
  if jsonb_typeof(p_months) is distinct from 'array' or jsonb_array_length(p_months) = 0 then
    raise exception using errcode = 'P0001', message = 'statement_empty', detail = '실을 달이 없다.';
  end if;
  select coalesce(m->>'month', '?') into v_bad
    from jsonb_array_elements(p_months) m
   where jsonb_typeof(m) <> 'object'
      or coalesce(m->>'month', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      or not (m->>'month' = v_imp.period_key or left(m->>'month', 5) = v_imp.period_key || '-')
      or jsonb_typeof(m->'lines') is distinct from 'array'
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid',
      detail = format('달 %s의 모양이 틀렸거나 업로드의 해(%s) 밖이다.', v_bad, v_imp.period_key);
  end if;
  select m->>'month' into v_bad from jsonb_array_elements(p_months) m group by m->>'month' having count(*) > 1 limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid', detail = format('달 %s가 두 번 있다.', v_bad);
  end if;
  -- 빈 달은 되돌릴 전표 번호(미리보기 때 본 활성 업로드 전표)를 들고 온다 · 금액 있는 달은 들고 오지 않는다(0056 리뷰 I-2).
  select m->>'month' into v_bad
    from jsonb_array_elements(p_months) m
   where (jsonb_array_length(m->'lines') = 0
          and (jsonb_typeof(m->'reverses') is distinct from 'string' or m->>'reverses' !~ '^M[0-9]{4}-[0-9]{6}$'))
      or (jsonb_array_length(m->'lines') > 0 and m ? 'reverses')
   limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'ecount_plan_invalid',
      detail = format('달 %s: 빈 달은 되돌릴 전표 번호(reverses)가 있어야 하고, 금액 있는 달은 없어야 한다.', v_bad);
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

  -- ⑤ 마감된 달 · 세무사 확정이 덮은 달 — **손댈 달**만: 금액 있는 달 + 되돌릴 활성 업로드 전표가 있는 빈 달.
  select m->>'month' into v_bad
    from jsonb_array_elements(p_months) m
   where (jsonb_array_length(m->'lines') > 0
          or exists (select 1 from finance_import_slips s
                      where s.business_id = v_imp.business_id and s.month = m->>'month' and s.superseded_at is null))
     and exists (select 1 from closings c where c.business_id = v_imp.business_id and c.period >= m->>'month')
   order by 1 limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'closed_period',
      detail = format('%s는 마감됐다(또는 그 뒤 달이 마감됐다). 마감된 달의 월별 손익은 받지 않는다.', v_bad);
  end if;
  select m->>'month' into v_bad
    from jsonb_array_elements(p_months) m
   where (jsonb_array_length(m->'lines') > 0
          or exists (select 1 from finance_import_slips s
                      where s.business_id = v_imp.business_id and s.month = m->>'month' and s.superseded_at is null))
     and exists (
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

  -- ⑥ 대응 계정 — 금액 있는 달이 있을 때만(빈 달 역분개는 옛 전표의 줄을 뒤집을 뿐이다).
  if exists (select 1 from jsonb_array_elements(p_months) m where jsonb_array_length(m->'lines') > 0) then
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
  end if;

  -- ⑦ 달마다
  for v_m in select m from jsonb_array_elements(p_months) m order by m->>'month' loop
    v_month := v_m->>'month';
    v_date  := (to_date(v_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
    v_memo  := format('[ECOUNT 엑셀] %s 월별 손익 · import %s', v_month, v_imp.import_id);
    v_note  := ecount_audit_note('monthly', v_month, v_imp.file_name, v_imp.import_id);

    select * into v_prev from finance_import_slips
     where business_id = v_imp.business_id and month = v_month and superseded_at is null
     for update;

    -- 빈 달(0056) ---------------------------------------------------------------------------------
    if jsonb_array_length(v_m->'lines') = 0 then
      if not found or v_prev.slip_no is distinct from v_m->>'reverses' then
        raise exception using errcode = 'P0001', message = 'import_changed',
          detail = format('ecount_ledger_changed: %s의 활성 업로드 전표가 미리보기 때(%s)와 다르다(지금 %s). 미리보기를 다시 한다.',
                          v_month, v_m->>'reverses', coalesce(v_prev.slip_no, '없음'));
      end if;
      if exists (select 1 from journal_entries r
                  where r.business_id = v_imp.business_id and r.corrects_id = v_prev.slip_no and r.correction_kind = 'reversal') then
        raise exception using errcode = 'P0001', message = 'ecount_month_reversed',
          detail = format('%s의 업로드 전표 %s가 이미 역분개됐다. 그 정정을 확인한 뒤 다시 올린다.', v_month, v_prev.slip_no);
      end if;
      select coalesce(jsonb_agg(jsonb_build_object('account_code', account_code, 'side', side, 'amount', amount) order by line_no), '[]'::jsonb)
        into v_prev_lines
        from journal_lines where business_id = v_imp.business_id and slip_no = v_prev.slip_no;
      insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
      values ('update'::audit_action, 'finance_import_slips', v_imp.business_id || ':' || v_month, v_imp.business_id,
              auth.uid(), auth_role()::text,
              jsonb_build_object('slip_no', v_prev.slip_no, 'import_id', v_prev.import_id, 'lines', v_prev_lines),
              jsonb_build_object('import_id', v_imp.import_id, 'entry_date', v_date, 'lines', '[]'::jsonb),
              format('%s — 금액 없는 달, 이전 전표 %s 역분개', v_note, v_prev.slip_no));
      v_corr := post_correction(v_imp.business_id, v_prev.slip_no, v_date, v_memo, null, '[]'::jsonb);
      update finance_import_slips set superseded_at = now()
       where business_id = v_imp.business_id and slip_no = v_prev.slip_no and superseded_at is null;
      v_reversed := v_reversed + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('month', v_month, 'action', 'reversed',
                                                             'reversal', v_corr->>'reversal', 'previous', v_prev.slip_no));
      continue;
    end if;

    -- 금액 있는 달 — 0052와 같다(첫 등록에 전표 감사 한 줄이 더해졌다) ---------------------------------
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

    if v_prev.slip_no is null then
      insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
      values ('create'::audit_action, 'finance_import_slips', v_imp.business_id || ':' || v_month, v_imp.business_id,
              auth.uid(), auth_role()::text,
              jsonb_build_object('import_id', v_imp.import_id, 'entry_date', v_date, 'lines', v_slip), v_note);
      v_new := journal_entry_insert(v_imp.business_id, v_date, v_memo, null, v_slip, null, null);
      -- 0056: 전표 감사 한 줄 — post_journal_entry(0016)와 같은 entity(journal_entries · 전표 번호)와 after 모양.
      insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
      values ('create'::audit_action, 'journal_entries', v_new, v_imp.business_id, auth.uid(), auth_role()::text,
              jsonb_build_object('entry_date', v_date, 'memo', v_memo, 'evidence_url', null, 'lines', v_slip),
              format('%s — 전표 %s', v_note, v_new));
      insert into finance_import_slips (business_id, month, slip_no, import_id)
      values (v_imp.business_id, v_month, v_new, v_imp.import_id);
      v_posted := v_posted + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('month', v_month, 'action', 'posted', 'slip_no', v_new));
      continue;
    end if;

    if exists (select 1 from journal_entries r
                where r.business_id = v_imp.business_id and r.corrects_id = v_prev.slip_no and r.correction_kind = 'reversal') then
      raise exception using errcode = 'P0001', message = 'ecount_month_reversed',
        detail = format('%s의 업로드 전표 %s가 이미 역분개됐다. 그 정정을 확인한 뒤 다시 올린다.', v_month, v_prev.slip_no);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('account_code', account_code, 'side', side, 'amount', amount) order by line_no), '[]'::jsonb)
      into v_prev_lines
      from journal_lines where business_id = v_imp.business_id and slip_no = v_prev.slip_no;
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
                                                                      'unchanged', v_unchanged, 'reversed', v_reversed,
                                                                      'months', v_out))
   where import_id = v_imp.import_id;

  return jsonb_build_object('posted', v_posted, 'corrected', v_corrected, 'unchanged', v_unchanged,
                            'reversed', v_reversed, 'months', v_out);
end;
$fn$;

comment on function ecount_monthly_import(uuid, text, text, text, jsonb) is
  '0052/0056. ECOUNT 월별 손익 업로드 등록(잠정 — 월 마감이 확정으로). 달마다 요약 전표 한 장 + 대응 계정(ECOUNT-PL) 한 줄 · 첫 등록은 달 감사 + 전표 감사. 같은 달 재업로드는 post_correction(역분개 + 정정분개) + 옛 업로드 줄 supersede. 파일이 말하는데 금액이 없는 달(lines=[], reverses=미리보기 때 본 전표)은 그 전표를 역분개만 한다(0056) — 다른 전표면 import_changed. 마감 달 · 세무사 확정 달(손댈 달만) · 재무상태표 계정 · 이미 역분개된 업로드 전표는 거부. 회사 잠금(finance_books_lock_key — close_period와 같은 열쇠) · 감사 먼저 · committed까지 한 트랜잭션.';

revoke all on function ecount_monthly_import(uuid, text, text, text, jsonb) from public, anon;
grant execute on function ecount_monthly_import(uuid, text, text, text, jsonb) to authenticated;

-- =====================================================================
-- 2절. close_period — 0047 본문 그대로 + 같은 회사 잠금 한 줄(리뷰 m-2)
-- =====================================================================
create or replace function close_period(p_business_id text, p_period text) returns int
language plpgsql security invoker set search_path = public, pg_temp as $fn$
declare
  v_today_period text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_last         text;
  v_open         text;
  v_n            int;
begin
  if not can_close_books(p_business_id) then
    raise exception using errcode = '42501', message = 'close_forbidden',
      detail = '월 마감은 Chairman · GroupCFO와 그 회사의 월 마감 권한(0047)을 받은 사람만 한다.';
  end if;
  -- 0056: ECOUNT 월별 등록과 같은 회사 잠금. 아래 읽기(closings · journal_lines · finance_ledger_cells)는 잠금을 얻은 뒤의
  -- 문장들이라 read committed에서 앞 등록이 커밋한 장부를 본다.
  perform pg_advisory_xact_lock(finance_books_lock_key(p_business_id));
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception using errcode = 'P0001', message = 'invalid_period';
  end if;
  if p_period >= v_today_period then
    raise exception using errcode = 'P0001', message = 'period_not_ended',
      detail = format('%s는 아직 끝나지 않았다.', p_period);
  end if;

  select max(period) into v_last from closings where business_id = p_business_id;
  if v_last is not null and v_last >= p_period then
    raise exception using errcode = 'P0001', message = 'already_closed',
      detail = format('%s까지 마감됐다.', v_last);
  end if;

  select min(to_char(entry_date, 'YYYY-MM')) into v_open
    from journal_lines
   where business_id = p_business_id
     and to_char(entry_date, 'YYYY-MM') < p_period
     and (v_last is null or to_char(entry_date, 'YYYY-MM') > v_last);
  if v_open is not null then
    raise exception using errcode = 'P0001', message = 'earlier_period_open',
      detail = format('%s부터 순서대로 마감한다.', v_open);
  end if;

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
  values ('create', 'closings', p_business_id || ':' || p_period, p_business_id, auth.uid(), auth_role()::text,
          jsonb_build_object('period', p_period), format('%s 월 마감', p_period));

  insert into closings (business_id, period, account_code, amount, closed_on, provisional_amount, source, fetched_at, closed)
  select business_id, period, account_code, amount, (now() at time zone 'Asia/Seoul')::date, amount, 'manual', now(), true
    from finance_ledger_cells
   where business_id = p_business_id and period = p_period;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception using errcode = 'P0001', message = 'nothing_to_close',
      detail = format('%s에는 전표도 직전 결산도 없다.', p_period);
  end if;

  update journal_lines
     set closed = true
   where business_id = p_business_id and to_char(entry_date, 'YYYY-MM') = p_period and not closed;

  return v_n;
end;
$fn$;

comment on function close_period(text, text) is
  '0016/0047/0056. 한 회사 한 달 마감. 0056: ECOUNT 월별 등록과 같은 회사 잠금(finance_books_lock_key)을 권한 판정 뒤에 잡는다.';

commit;
