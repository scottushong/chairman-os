-- =====================================================================
-- Chairman OS — 0047_finance_module_grants (재무 모듈 권한 · 사람 단위 + Vault 첨부 DB 차단)
-- 작성: 2026-09-29
--
-- 회장 지시: 첫 실사용자는 DY 경영지원팀 한 사람(TeamLead)이다. 그 사람이 /finance/biz_dy에서
-- 전표 입력 · 월별 손익 · 공식 재무제표 입력을 해야 한다. 월 마감은 기본적으로 Chairman · GroupCFO다.
-- 다른 회사의 재무는 여전히 존재하지 않는 것처럼 보여야 한다.
--
-- ■ 무엇이 없어서 만드나 ■
--   0016 can_keep_books()는 **역할**만 본다(Chairman · GroupCFO · BusinessCEO(자기 회사)). 읽기도
--   0015 · 0016 · 0020의 select 정책이 전부 can_read_restricted()(Chairman · GroupCFO · BusinessCEO ·
--   Executive · 등급 있는 AIAgent) 뒤에 있어서, TeamLead는 쓰기는커녕 원장을 한 줄도 못 읽는다.
--   역할을 넓히면(TeamLead 전원) «한 사람»이 아니라 «모든 팀장»이 재무를 본다 — 원문은 사람이다.
--
-- ■ 왜 이 모양인가 — 0002의 user_module_access를 쓴다 ■
--   0002가 이미 사람 단위 권한 표를 만들어 두었다(user_module_access · can_module()). 새 표를 만들지 않는다.
--   모듈 키는 '/finance'(05_Architecture의 경로 그대로 — 0002 표 주석의 규칙).
--     can_write   = 재무 입력(계정과목 · 전표 · 월별 손익 · 공식 재무제표)
--     can_approve = 월 마감
--   줄이 있으면(두 칸이 다 false여도) 읽기는 열린다 — «보기만» 주는 자리다. 화면은 둘 다 끄면 줄을 지운다.
--   회사 범위는 이 표가 아니라 **여전히 has_business()**다. 권한은 «이 사람이 재무 모듈을 쓰는가»이고,
--   «어느 회사인가»는 user_business_access가 말한다. DY 경영지원 팀장은 biz_dy만 가지고 있으므로
--   다른 회사의 원장은 여전히 0행이다.
--
-- ■ 판정 함수 ■
--   finance_grant(need_write, need_approve)   '/finance' 줄이 있는가(요구한 칸까지). 사람 역할만 —
--       AIAgent · Integration은 줄이 있어도 false다. 누가 실수로 시스템 계정에 줄을 넣어도 야간 Job ·
--       동기화의 읽기 · 쓰기 범위가 넓어지지 않는다(«AIAgent / Integration 동작은 바꾸지 않는다»).
--   can_keep_books(target)   0016 + «'/finance' can_write AND has_business(target)».
--   can_close_books()        0016 + «'/finance' can_approve». 회사 범위는 부르는 쪽이 has_business()로 같이
--                            본다(closings_books_insert · journal_lines_books_close · close_period — 0016 그대로).
--   can_read_books(target)   is_active() and has_business(target) and (can_read_restricted() or '/finance' 줄).
--       can_read_restricted() 자체는 고치지 않는다 — 재무 밖의 많은 것(야간 출력 · 키맨 · 마스킹 뷰 · 주의)이
--       그 함수를 문으로 쓰고, 거기를 넓히면 재무 권한이 재무 밖으로 샌다.
--
-- ■ 바꾸는 select 정책(전부 drop + 다시 만든다 — 이름 그대로) ■
--   finance_kpis_read              (finance_kpis_sheet — 0002가 만들고 0015가 표 이름을 바꿨다)
--   accounts_read · journal_lines_read · closings_read   (0015 — `or is_integration()` 그대로 남긴다)
--   journal_entries_read           (0016)
--   official_statements_read · official_statement_lines_read   (0020)
--   finance_kpis 뷰(0016)와 finance_ledger_cells 뷰는 security_invoker라 위 표의 정책을 그대로 따른다.
--   finance_kpis_masked(0015)는 칸 마스킹을 can_read_restricted() → can_read_books(business_id)로
--   바꿔 다시 세운다 — 줄은 보이는데 값만 null인 사람이 생기지 않게. 칸 순서 · 이름은 그대로다.
--   바꾸지 않는 것: market_multiples_read(회사 범위가 없는 밸류에이션 자료) · business_keymen_read(재무가 아니다)
--   · ai_night_outputs · 0035 주의 표. fx_rates · cost_indices는 이미 is_active()다.
--   쓰기 정책(0016 · 0020)은 이름 그대로 두고 판정 함수만 create or replace로 넓어진다.
--
-- ■ 기본 권한 — 경영지원 팀장 ■
--   가입(0026/0028 apply_user_invitation)은 user_profiles에 줄을 넣는다. 그 순간을 트리거로 잡는다:
--   user_profiles의 after insert · after update of role, team_id. 새 상태가 «TeamLead + team_dy_support
--   (0025 시드의 DY 경영지원) + 회수 안 됨»이면 '/finance' can_write=true · can_approve=false 한 줄을
--   **없을 때만** 넣는다(on conflict do nothing — 회장이 손으로 준 마감 권한을 덮지 않는다).
--   · apply_user_invitation()을 다시 쓰지 않는다. 그 함수는 결재 가드 · coalesce 규칙이 얽혀 있어서
--     본문을 복사해 고치는 것(0028의 방식)보다 옆에 트리거 하나가 덜 위험하다. 가입 · 회장 결재 ·
--     조직도에서 팀/역할을 옮기는 것 — 세 길이 전부 이 한 곳을 지난다.
--   · 팀은 **이름이 아니라 team_id**로 가른다. teams는 force RLS라(0025 머리 주석) definer 함수가
--     가입 순간(auth.uid() = null) 읽으면 0행이다 — 0023 3절 ③의 함정. team_id 상수는 표를 안 읽는다.
--     다른 회사의 경영지원팀이 생기면 이 목록에 더한다(DEFERRED).
--   · 회수 후 다시 주는 경우: 회장이 줄을 지운 뒤에도 그 사람의 역할/팀을 다른 값으로 옮겼다가 되돌리면
--     다시 붙는다. «경영지원 팀장이 된 순간»의 기본값이라 그게 맞다고 본다.
--   · 트리거는 **절대 던지지 않는다.** accept_user_invitation()의 exception 블록 안에서 돌기 때문에,
--     여기서 던지면 가입은 살지만 프로필 insert까지 통째로 롤백된다(0011의 판단이 막으려던 상태).
--   · 감사: audit_log에 permission_change 한 줄(entity_table='user_module_access'). audit_log는 force라
--     가입 순간(세션 없음)에는 audit_log_insert가 막는다(0031 5절) — 그때는 경고만 남기고 넘어간다.
--     그 경우 권한의 출처는 같은 가입의 초대 감사 줄(permission_change · user_invitations)과 이 줄의
--     granted_at이다. 회장 결재 · 조직도에서 옮기는 경우는 회장 세션이라 감사 줄이 선다.
--
-- ■ 화면에서 주고 거두기 ■
--   0002 module_access_admin_write(Chairman만 for all)가 그대로 자물쇠다. 앱은 감사를 먼저 쓰고
--   upsert/delete 한다 — user_business_access · 초대 · 회수와 같은 모양(lib/repository/supabase.ts).
--   본인은 0002 module_access_self_read로 자기 줄을 읽는다 — 세션이 이 줄로 화면 안내를 정한다.
--
-- ■ official_statement_save() 고침 (4절) ■
--   0020의 감사 insert가 text를 audit_action 칸에 넣어 이 함수는 한 번도 성공한 적이 없다(42804). 본문 그대로 +
--   `::audit_action` 하나. 이번 첫 실사용자의 «공식 재무제표 입력»이 이 함수 하나로 선다.
--
-- ■ Vault 첨부 — DB에서도 받지 않는다 (DEFERRED «Phase 10 — Vault 첨부 차단», 2026-09-29 회장 결정) ■
--   check 제약이 아니라 **restrictive insert 정책**이다. 이유:
--   · check 제약은 not valid로 걸어도 **기존 줄을 고칠 때마다** 다시 잰다. 0045 이후 production에 Vault
--     줄이 이미 있을 수 있고(회장 세션은 0045 정책을 통과했다), 그 줄의 요약 상태 갱신 · soft delete가
--     전부 23514로 깨진다. 정책은 새 줄에만 걸린다.
--   · 등급 칸은 update로 못 바꾼다(0045가 칸 다섯에만 update grant) — insert만 막으면 새 Vault 줄은 없다.
--   · 정책은 소유자(definer 함수)에게 안 걸리지만, attachments에 insert하는 definer 함수는 없다.
--   암호화 층이 오면 이 정책 한 줄과 Server Action 한 줄을 걷는다.
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0046을 고치지 않는다(함수는 create or replace, 정책은
-- drop + create) · 새 audit_action 값 없음(permission_change). 판정 함수는 anon에게서 걷지 않는다 —
-- /api/health가 anon으로 원장 표를 세고, 정책이 부르는 함수에 실행 권한이 없으면 0행이 아니라 42501이 된다
-- (0016 can_keep_books와 같은 기본값).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 판정 함수
-- =====================================================================

/** '/finance' 모듈 줄이 있는가. 사람 역할만. need_write / need_approve는 그 칸까지 요구한다. */
create or replace function finance_grant(need_write boolean default false, need_approve boolean default false)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active()
     and auth_role()::text not in ('AIAgent', 'Integration')
     and exists (
       select 1 from user_module_access
        where user_id = auth.uid()
          and module = '/finance'
          and (not need_write or can_write)
          and (not need_approve or can_approve)
     );
$fn$;

comment on function finance_grant(boolean, boolean) is
  '0047. 사람 단위 재무 모듈 권한(user_module_access ''/finance''). AIAgent · Integration은 줄이 있어도 false.';

/** 이 회사의 장부(계정과목 · 전표 · 공식 재무제표)를 쓸 수 있는가. 0016 + 모듈 권한. */
create or replace function can_keep_books(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and target is not null and case
    when auth_role() in ('Chairman', 'GroupCFO') then true
    when auth_role() = 'BusinessCEO' and has_business(target) then true
    else finance_grant(true, false) and has_business(target)
  end;
$fn$;

/** 월 마감을 할 수 있는가. 회사 범위는 부르는 쪽이 has_business()로 같이 본다(0016 그대로). */
create or replace function can_close_books() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and (
    auth_role() in ('Chairman', 'GroupCFO')
    or finance_grant(false, true)
  );
$fn$;

/** 이 회사의 원장 · 결산 · 공식 재무제표를 읽을 수 있는가. */
create or replace function can_read_books(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and has_business(target) and (can_read_restricted() or finance_grant(false, false));
$fn$;

comment on function can_read_books(text) is
  '0047. 재무 표 읽기의 문. 회사 범위(has_business) AND ([제한] 열람 역할 OR ''/finance'' 모듈 줄).';

-- =====================================================================
-- 2절. 재무 표의 읽기 정책
-- =====================================================================
drop policy if exists finance_kpis_read on finance_kpis_sheet;
create policy finance_kpis_read on finance_kpis_sheet
  for select using (can_read_books(business_id));

drop policy if exists accounts_read on accounts;
create policy accounts_read on accounts
  for select using (can_read_books(business_id) or (has_business(business_id) and is_integration()));

drop policy if exists journal_lines_read on journal_lines;
create policy journal_lines_read on journal_lines
  for select using (can_read_books(business_id) or (has_business(business_id) and is_integration()));

drop policy if exists closings_read on closings;
create policy closings_read on closings
  for select using (can_read_books(business_id) or (has_business(business_id) and is_integration()));

drop policy if exists journal_entries_read on journal_entries;
create policy journal_entries_read on journal_entries
  for select using (can_read_books(business_id));

drop policy if exists official_statements_read on official_statements;
create policy official_statements_read on official_statements
  for select using (can_read_books(business_id));

drop policy if exists official_statement_lines_read on official_statement_lines;
create policy official_statement_lines_read on official_statement_lines
  for select using (can_read_books(business_id));

-- 0015의 칸 마스킹 뷰. 모양(칸 순서 · 이름 · 타입)은 그대로이고 마스킹 판정만 바뀐다.
create or replace view finance_kpis_masked
with (security_invoker = true) as
select
  period,
  business_id,
  metric,
  case when can_read_books(business_id) then value else null end as value,
  case when can_read_books(business_id) then target else null end as target,
  currency,
  source,
  closed
from finance_kpis;

-- =====================================================================
-- 3절. 경영지원 팀장 기본 권한
-- =====================================================================
create or replace function finance_default_grant() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.role::text <> 'TeamLead'
     or new.team_id is distinct from 'team_dy_support'
     or new.revoked_at is not null then
    return null;
  end if;
  -- update of role, team_id는 같은 값을 다시 적어도 돈다. 실제로 그 자리에 «들어온» 경우만.
  if tg_op = 'UPDATE' and old.role = new.role and old.team_id is not distinct from new.team_id then
    return null;
  end if;

  begin
    insert into user_module_access (user_id, module, can_write, can_approve)
    values (new.user_id, '/finance', true, false)
    on conflict (user_id, module) do nothing;

    if found then
      begin
        insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
        values ('permission_change', 'user_module_access', new.user_id::text, 'biz_dy',
                auth.uid(), auth_role()::text,
                jsonb_build_object('module', '/finance', 'can_write', true, 'can_approve', false),
                '경영지원 팀장 기본 재무 권한(0047)');
      exception when others then
        -- 가입 순간(세션 없음)은 audit_log_insert가 막는다(force · 0031 5절). 권한은 남기고 넘어간다.
        raise warning 'finance_default_grant 감사 실패 (%): %', new.user_id, sqlerrm;
      end;
    end if;
  exception when others then
    -- 가입 · 프로필 저장을 살린다. 권한만 안 붙는다 — 회장이 사용자 화면에서 줄 수 있다.
    raise warning 'finance_default_grant 실패 (%): %', new.user_id, sqlerrm;
  end;
  return null;
end;
$fn$;

comment on function finance_default_grant() is
  '0047. TeamLead + team_dy_support가 된 순간 ''/finance'' 입력 권한(마감 제외)을 없을 때만 준다. 던지지 않는다.';

revoke all on function finance_default_grant() from public, anon, authenticated;

drop trigger if exists user_profiles_finance_default on user_profiles;
create trigger user_profiles_finance_default
  after insert or update of role, team_id on user_profiles
  for each row execute function finance_default_grant();

-- 이미 그 자리에 있는 사람(0047 이전 가입)에게도 같은 기본값. 감사는 시스템 줄 하나(actor null — 0004 부트스트랩과 같다).
-- audit_log는 force라 마이그레이션 세션(auth.uid() null)의 insert를 audit_log_insert가 막는다 —
-- 그래서 여기서는 감사를 쓰지 않고, 이 파일과 granted_at이 기록이다.
insert into user_module_access (user_id, module, can_write, can_approve)
select p.user_id, '/finance', true, false
  from user_profiles p
 where p.role::text = 'TeamLead'
   and p.team_id = 'team_dy_support'
   and p.revoked_at is null
on conflict (user_id, module) do nothing;

-- =====================================================================
-- 4절. official_statement_save() — 감사 줄의 action이 text라 저장이 한 번도 안 됐다
--
--   0020의 감사 insert가 `case when … then 'create' else 'update' end`를 audit_action 칸에 넣는다.
--   리터럴 둘뿐인 case는 text로 풀리고, text → enum은 대입 캐스트가 없다(42804
--   «column "action" is of type audit_action but expression is of type text»). 그래서 이 함수는
--   **어느 역할로 불러도** 마지막 줄에서 실패하고 전체가 롤백된다 — 공식 재무제표 입력 화면은
--   live에서 저장된 적이 없다. 0047의 검사(scripts/check-migrations.ts financeGrants)가 처음 불러서 드러났다.
--   0020:112-181의 본문을 **파일에서 그대로 복사**했고, 그 case에 `::audit_action` 하나를 붙인 것 말고는
--   한 줄도 바꾸지 않았다(0028 4절과 같은 방식). 새 audit_action 값이 아니라 55P04와 무관하다.
-- =====================================================================
create or replace function official_statement_save(
  p_business_id  text,
  p_period_kind  text,
  p_period_key   text,
  p_evidence_url text,
  p_memo         text,
  p_lines        jsonb   -- [{account_code, amount}, ...]
) returns bigint
language plpgsql security invoker set search_path = public as $fn$
declare
  v_prev    official_statements%rowtype;
  v_id      bigint;
  v_balance numeric(20, 2);
  v_before  jsonb;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '재무제표에 줄이 하나도 없습니다.';
  end if;

  -- 자산 + 부채 + 자본 = 0. 원장 규약(차변 − 대변)에서 재무상태표가 닫힌다는 뜻이 이것이다.
  select coalesce(sum((l->>'amount')::numeric), 0)
    into v_balance
    from jsonb_array_elements(p_lines) l
    join accounts a
      on a.business_id = p_business_id and a.account_code = l->>'account_code'
   where a.section in ('cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity');

  if v_balance <> 0 then
    raise exception '재무상태표가 닫히지 않습니다. 차이 %원', v_balance;
  end if;

  select * into v_prev
    from official_statements
   where business_id = p_business_id
     and period_kind = p_period_kind
     and period_key  = p_period_key
     and superseded_at is null;

  if found then
    select jsonb_build_object(
             'memo', v_prev.memo,
             'evidence_url', v_prev.evidence_url,
             'lines', coalesce(jsonb_agg(jsonb_build_object('account_code', account_code, 'amount', amount)
                                order by account_code), '[]'::jsonb))
      into v_before
      from official_statement_lines where statement_id = v_prev.id;

    update official_statements set superseded_at = now() where id = v_prev.id;
  end if;

  insert into official_statements (business_id, period_kind, period_key, evidence_url, memo, supersedes_id)
  values (p_business_id, p_period_kind, p_period_key, p_evidence_url, p_memo, v_prev.id)
  returning id into v_id;

  insert into official_statement_lines (statement_id, business_id, account_code, amount)
  select v_id, p_business_id, l->>'account_code', (l->>'amount')::numeric
    from jsonb_array_elements(p_lines) l;

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ((case when v_prev.id is null then 'create' else 'update' end)::audit_action,
          'official_statements', v_id::text, p_business_id, auth.uid(), auth_role()::text,
          v_before,
          jsonb_build_object('memo', p_memo, 'evidence_url', p_evidence_url, 'lines', p_lines),
          case when v_prev.id is null
               then format('공식 재무제표 %s %s', p_period_kind, p_period_key)
               else format('공식 재무제표 정정 %s %s — 이전 #%s', p_period_kind, p_period_key, v_prev.id) end);

  return v_id;
end;
$fn$;

comment on function official_statement_save is
  '0020/0047. 공식 재무제표 저장. supersede + 헤더 + 라인 + 감사기록을 한 트랜잭션으로. 닫히지 않으면 예외. 0047이 감사 action의 enum 캐스트를 고쳤다.';

-- =====================================================================
-- 5절. Vault 첨부 — 새 줄을 DB가 받지 않는다
-- =====================================================================
drop policy if exists attachments_no_vault_insert on attachments;
create policy attachments_no_vault_insert on attachments as restrictive for insert
  with check (security_class::text <> 'Vault');

commit;
