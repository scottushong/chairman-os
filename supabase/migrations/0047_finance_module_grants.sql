-- =====================================================================
-- Chairman OS — 0047_finance_module_grants (재무 모듈 권한 · 사람 × 회사 단위 + Vault 첨부 DB 차단)
-- 작성: 2026-09-29 (같은 날 리뷰 C1 · I1 · I2 반영 — 아직 어느 DB에도 적용 전이라 파일을 고쳤다)
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
-- ■ 왜 이 모양인가 — 0002의 user_module_access, 키는 회사까지 ■
--   0002가 이미 사람 단위 권한 표를 만들어 두었다(user_module_access · can_module()). 새 표를 만들지 않는다.
--   모듈 키는 **'/finance/<business_id>'**다(예 '/finance/biz_dy') — 0002 표 주석의 «경로 단위로 연다»를
--   화면 경로(/finance/[business_id]) 그대로 따른다.
--     can_write   = 그 회사의 재무 입력(계정과목 · 전표 · 월별 손익 · 공식 재무제표)
--     can_approve = 그 회사의 월 마감
--   줄이 있으면(두 칸이 다 false여도) 그 회사의 읽기는 열린다. 화면은 둘 다 끄면 줄을 지운다.
--   **회사를 키에 넣은 이유(리뷰 I1):** 키가 '/finance' 하나면 권한이 사람에게만 붙고 회사 범위는
--   has_business()가 정한다 — 그러면 나중에 누가 그 사람에게 biz_vana 접근(user_business_access)을 더하는
--   순간 VANA 장부 입력까지 조용히 열린다. 회사 접근과 재무 권한은 다른 결정이다. 그래서 둘 다 요구한다:
--   has_business(target) AND '/finance/<target>' 줄.
--
-- ■ 판정 함수 ■
--   finance_grant(target, need_write, need_approve)  '/finance/<target>' 줄이 있는가(요구한 칸까지). 사람 역할만 —
--       AIAgent · Integration은 줄이 있어도 false다. 누가 실수로 시스템 계정에 줄을 넣어도 야간 Job ·
--       동기화의 읽기 · 쓰기 범위가 넓어지지 않는다(«AIAgent / Integration 동작은 바꾸지 않는다»).
--   can_keep_books(target)    0016 + «finance_grant(target, 쓰기) AND has_business(target)».
--   can_close_books(target)   **새 판(인자 있음)**. Chairman · GroupCFO 또는 finance_grant(target, 마감), AND has_business.
--       0016의 인자 없는 can_close_books()는 고치지 않는다(역할만 — 부르는 곳을 전부 인자 있는 판으로 옮겼다):
--       closings_books_insert · journal_lines_books_close(정책 drop + create) · close_period()(본문 복사 + 판정 한 줄).
--   can_read_books(target)    is_active() and has_business(target) and (can_read_restricted() or finance_grant(target)).
--       can_read_restricted() 자체는 고치지 않는다 — 재무 밖의 많은 것(야간 출력 · 키맨 · 마스킹 뷰 · 주의)이
--       그 함수를 문으로 쓰고, 거기를 넓히면 재무 권한이 재무 밖으로 샌다.
--
-- ■ 바꾸는 select 정책(전부 drop + 다시 만든다 — 이름 그대로) ■
--   finance_kpis_read              (finance_kpis_sheet — 0002가 만들고 0015가 표 이름을 바꿨다)
--   accounts_read · journal_lines_read · closings_read   (0015 — Integration 분기 그대로 남긴다)
--   journal_entries_read           (0016)
--   official_statements_read · official_statement_lines_read   (0020)
--   finance_kpis 뷰(0016)와 finance_ledger_cells 뷰는 security_invoker라 위 표의 정책을 그대로 따른다.
--   finance_kpis_masked(0015)는 칸 마스킹을 can_read_restricted() → can_read_books(business_id)로
--   바꿔 다시 세운다 — 줄은 보이는데 값만 null인 사람이 생기지 않게. 칸 순서 · 이름은 그대로다.
--   바꾸지 않는 것: market_multiples_read(회사 범위가 없는 밸류에이션 자료) · business_keymen_read(재무가 아니다)
--   · ai_night_outputs · 0035 주의 표. fx_rates · cost_indices는 이미 is_active()다.
--   쓰기 정책(0016 · 0020의 insert · update)은 이름 그대로 두고 can_keep_books()만 create or replace로 넓어진다.
--
-- ■ 기본 권한 — DY 경영지원 팀장, **회장이 관여한 경우에만** (리뷰 C1) ■
--   기본값: '/finance/biz_dy' can_write=true · can_approve=false, 없을 때만(on conflict do nothing —
--   회장이 손으로 준 마감 권한을 덮지 않는다). 조건은 «TeamLead + team_dy_support + 회수 안 됨 + biz_dy 접근».
--   **회장이 관여하지 않으면 붙지 않는다.** 0026 user_invitations_delegated_insert는 아무 활성 사용자나
--   (reports_to = 자기로) 팀장을 초대할 수 있게 하고, TeamLead(rank 1)는 회장 결재가 없다 — 기본 권한을
--   가입에 무조건 붙이면 DY의 아무 직원이나 장부 입력자를 만들 수 있다. 그래서 두 입구만 연다:
--   ① 가입(apply_user_invitation): 초대의 chairman_approved_at이 있을 때만. 회장이 직접 넣은 초대는
--      0026 user_invitations_set_approval이 그 칸을 채우고, 위임 초대는 회장 결재가 난 경우에만 채워진다.
--      apply_user_invitation()을 0028 본문 그대로 복사하고 이 한 블록을 더했다(0028 4절과 같은 방식).
--      user_invitations는 force RLS라 트리거에서 다시 읽지 않는다 — 이미 읽은 inv를 쓴다.
--   ② 조직도에서 옮김(user_profiles update of role, team_id): auth_role() = 'Chairman'일 때만.
--   그 밖(위임 초대 · 세션 없는 수정 · 회장 아닌 사람)은 아무것도 붙지 않는다 — 회장이 사용자 화면에서 체크한다.
--   · 팀은 **이름이 아니라 team_id**로 가른다. teams는 force RLS라(0025 머리 주석) definer 함수가
--     가입 순간(auth.uid() = null) 읽으면 0행이다 — 0023 3절 ③의 함정. team_id 상수는 표를 안 읽는다.
--   · 기본 권한 블록은 **던지지 않는다.** accept_user_invitation()의 exception 블록 안에서 돌기 때문에,
--     여기서 던지면 가입은 살지만 프로필 insert까지 통째로 롤백된다(0011의 판단이 막으려던 상태).
--   · 감사: permission_change 한 줄(entity_table='user_module_access', business_id='biz_dy'). audit_log는 force라
--     가입 순간(세션 없음)에는 audit_log_insert가 막는다(0031 5절) — 그때는 경고만 남긴다. 그 경우 출처는
--     회장이 넣거나 승인한 초대의 감사 줄과 granted_at이다.
--
-- ■ 권한을 거두는 두 길 (리뷰 I2) ■
--   ① 회수(user_profiles.revoked_at이 채워지는 순간): 그 사람의 user_module_access 줄을 **전부** 지운다.
--      is_active()가 이미 모든 표를 닫지만, 줄이 남으면 재초대(apply_user_invitation이 revoked_at을 null로
--      되돌린다) 한 번에 옛 재무 · 결재 권한이 그대로 살아난다. 줄마다 감사(세션이 있을 때).
--   ② 회장이 경영지원 팀장 자리에서 옮김: 기본값 모양의 줄('/finance/biz_dy' · can_approve=false)만 지운다.
--      회장이 마감까지 준 줄(can_approve=true)은 손으로 정한 것이라 남긴다(DEFERRED).
--
-- ■ 화면에서 주고 거두기 ■
--   0002 module_access_admin_write(Chairman만 for all)가 그대로 자물쇠다. 앱은 감사를 먼저 쓰고
--   upsert/delete 한다 — user_business_access · 초대 · 회수와 같은 모양(lib/repository/supabase.ts).
--   본인은 0002 module_access_self_read로 자기 줄을 읽는다 — 세션이 이 줄로 화면 안내를 정한다.
--
-- ■ official_statement_save() 고침 (5절) ■
--   0020의 감사 insert가 text를 audit_action 칸에 넣어 이 함수는 한 번도 성공한 적이 없다(42804). 본문 그대로 +
--   `::audit_action` 하나. 이번 첫 실사용자의 «공식 재무제표 입력»이 이 함수 하나로 선다.
--
-- ■ Vault 첨부 — DB에서도 받지 않는다 (6절 · DEFERRED «Phase 10 — Vault 첨부 차단», 2026-09-29 회장 결정) ■
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

/** '/finance/<target>' 모듈 줄이 있는가. 사람 역할만. need_write / need_approve는 그 칸까지 요구한다. */
create or replace function finance_grant(target text, need_write boolean default false, need_approve boolean default false)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active()
     and target is not null
     and auth_role()::text not in ('AIAgent', 'Integration')
     and exists (
       select 1 from user_module_access
        where user_id = auth.uid()
          and module = '/finance/' || target
          and (not need_write or can_write)
          and (not need_approve or can_approve)
     );
$fn$;

comment on function finance_grant(text, boolean, boolean) is
  '0047. 사람 × 회사 단위 재무 모듈 권한(user_module_access ''/finance/<business_id>''). AIAgent · Integration은 줄이 있어도 false.';

/** 이 회사의 장부(계정과목 · 전표 · 공식 재무제표)를 쓸 수 있는가. 0016 + 그 회사의 모듈 권한. */
create or replace function can_keep_books(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and target is not null and case
    when auth_role() in ('Chairman', 'GroupCFO') then true
    when auth_role() = 'BusinessCEO' and has_business(target) then true
    else finance_grant(target, true, false) and has_business(target)
  end;
$fn$;

/** 이 회사의 월을 마감할 수 있는가. 0016의 인자 없는 판(역할만)은 그대로 두고, 부르는 곳을 이쪽으로 옮긴다. */
create or replace function can_close_books(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and has_business(target) and (
    auth_role() in ('Chairman', 'GroupCFO')
    or finance_grant(target, false, true)
  );
$fn$;

comment on function can_close_books(text) is
  '0047. 월 마감 판정(회사까지). Chairman · GroupCFO 또는 ''/finance/<target>'' can_approve, AND has_business(target).';

/** 이 회사의 원장 · 결산 · 공식 재무제표를 읽을 수 있는가. */
create or replace function can_read_books(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and has_business(target) and (can_read_restricted() or finance_grant(target, false, false));
$fn$;

comment on function can_read_books(text) is
  '0047. 재무 표 읽기의 문. 회사 범위(has_business) AND ([제한] 열람 역할 OR ''/finance/<target>'' 모듈 줄).';

-- =====================================================================
-- 2절. 재무 표의 읽기 정책 · 마감 정책
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

-- 0016의 마감 정책 둘. 모양은 그대로이고 판정만 회사까지 보는 판으로 옮긴다(has_business는 그 안에 있다).
drop policy if exists closings_books_insert on closings;
create policy closings_books_insert on closings
  for insert with check (
    can_close_books(business_id) and source = 'manual' and closed
  );

drop policy if exists journal_lines_books_close on journal_lines;
create policy journal_lines_books_close on journal_lines
  for update using (can_close_books(business_id) and not closed)
  with check (can_close_books(business_id) and closed);

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
-- 3절. close_period() — 판정 한 줄만 회사까지 보는 판으로
--
--   0016:581-643의 본문을 **파일에서 그대로 복사**했고, 첫 검사 `can_close_books() and has_business(p_business_id)`를
--   `can_close_books(p_business_id)`로(그 안에 has_business가 있다) 바꾸고 detail 문구 하나를 고친 것 말고는 그대로다.
-- =====================================================================
create or replace function close_period(p_business_id text, p_period text) returns int
language plpgsql security invoker set search_path = public as $fn$
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

-- =====================================================================
-- 4절. 기본 권한 · 권한 거두기
-- =====================================================================

/** 감사 한 줄 — 세션이 없으면(가입 순간) audit_log_insert가 막는다. 그때는 경고만 남긴다. 던지지 않는다. */
create or replace function module_grant_audit(p_user uuid, p_module text, p_before jsonb, p_after jsonb, p_note text)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('permission_change', 'user_module_access', p_user::text,
          case when p_module like '/finance/%' then substr(p_module, length('/finance/') + 1) end,
          auth.uid(), auth_role()::text, p_before, p_after, p_note);
exception when others then
  raise warning 'module_grant_audit 실패 (%, %): %', p_user, p_module, sqlerrm;
end;
$fn$;

/**
 * DY 경영지원 팀장 기본 재무 권한을 붙인다(조건이 맞고 줄이 없을 때만). **회장 관여 여부는 부르는 쪽이 본다** —
 * apply_user_invitation(초대의 chairman_approved_at) · finance_profile_grants(auth_role() = 'Chairman').
 */
create or replace function finance_default_apply(p_user uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not exists (
    select 1 from user_profiles
     where user_id = p_user and role::text = 'TeamLead' and team_id = 'team_dy_support' and revoked_at is null
  ) or not exists (
    select 1 from user_business_access where user_id = p_user and business_id = 'biz_dy'
  ) then
    return;
  end if;

  insert into user_module_access (user_id, module, can_write, can_approve)
  values (p_user, '/finance/biz_dy', true, false)
  on conflict (user_id, module) do nothing;
  if found then
    perform module_grant_audit(p_user, '/finance/biz_dy', null,
      jsonb_build_object('module', '/finance/biz_dy', 'can_write', true, 'can_approve', false),
      '경영지원 팀장 기본 재무 권한(0047)');
  end if;
exception when others then
  -- 가입 · 프로필 저장을 살린다. 권한만 안 붙는다 — 회장이 사용자 화면에서 줄 수 있다.
  raise warning 'finance_default_apply 실패 (%): %', p_user, sqlerrm;
end;
$fn$;

/**
 * user_profiles after update of role, team_id, revoked_at.
 *   회수        → 그 사람의 모듈 줄 전부 삭제(줄마다 감사). 재초대가 옛 권한을 살리지 못하게.
 *   회장이 옮김 → 경영지원 팀장이 되면 기본 권한, 그 자리를 떠나면 기본값 모양의 줄(can_approve=false)만 삭제.
 *   그 밖(세션 없음 · 회장 아닌 사람 · 가입 경로의 on conflict update)은 아무것도 붙이지 않는다.
 */
create or replace function finance_profile_grants() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  r user_module_access%rowtype;
  v_was boolean := old.role::text = 'TeamLead' and old.team_id is not distinct from 'team_dy_support';
  v_now boolean := new.role::text = 'TeamLead' and new.team_id is not distinct from 'team_dy_support';
begin
  if new.revoked_at is not null and old.revoked_at is null then
    for r in delete from user_module_access where user_id = new.user_id returning * loop
      perform module_grant_audit(new.user_id, r.module,
        jsonb_build_object('module', r.module, 'can_write', r.can_write, 'can_approve', r.can_approve), null,
        '계정 회수에 따른 모듈 권한 삭제(0047)');
    end loop;
    return null;
  end if;
  if new.revoked_at is not null then return null; end if;
  if coalesce(auth_role()::text, '') <> 'Chairman' then return null; end if;

  if v_now and not v_was then
    perform finance_default_apply(new.user_id);
  elsif v_was and not v_now then
    for r in delete from user_module_access
              where user_id = new.user_id and module = '/finance/biz_dy' and not can_approve
          returning * loop
      perform module_grant_audit(new.user_id, r.module,
        jsonb_build_object('module', r.module, 'can_write', r.can_write, 'can_approve', r.can_approve), null,
        '경영지원 팀장 자리를 떠나 기본 재무 권한 삭제(0047)');
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'finance_profile_grants 실패 (%): %', new.user_id, sqlerrm;
  return null;
end;
$fn$;

revoke all on function module_grant_audit(uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function finance_default_apply(uuid) from public, anon, authenticated;
revoke all on function finance_profile_grants() from public, anon, authenticated;

drop trigger if exists user_profiles_finance_grants on user_profiles;
create trigger user_profiles_finance_grants
  after update of role, team_id, revoked_at on user_profiles
  for each row execute function finance_profile_grants();

-- 가입 경로. 0028:194-250의 apply_user_invitation() 본문을 **파일에서 그대로 복사**했고, user_invitations
-- update 앞에 «회장이 넣거나 승인한 초대면 기본 재무 권한» 한 블록을 더한 것 말고는 한 줄도 바꾸지 않았다.
-- grant는 여전히 없다(0026이 revoke했다) — 트리거 전용이다.
create or replace function apply_user_invitation(p_invitation uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  inv user_invitations;
  biz text;
begin
  select * into inv from user_invitations where invitation_id = p_invitation;
  if not found then return false; end if;
  if inv.accepted_at is not null or inv.revoked_at is not null then return false; end if;

  -- 회장 결재 큐. 승인 전에는 권한을 주지 않는다. 초대 행은 그대로 대기에 남는다 —
  -- 여기서 revoked_at을 채우면 승인이 난 뒤에 다시 부를 길이 없어진다.
  if inv.chairman_approval_required and inv.chairman_approved_at is null then
    return false;
  end if;

  insert into user_profiles (
    user_id, role, display_name, display_name_en, title_ko, max_security_class,
    reports_to, team_id, joined_on, language
  )
  values (
    p_user, inv.role, inv.display_name, inv.display_name_en, inv.title_ko, inv.max_security_class,
    coalesce(inv.reports_to, inv.invited_by), inv.team_id,
    coalesce(inv.joined_on, (now() at time zone 'Asia/Seoul')::date),
    inv.language
  )
  on conflict (user_id) do update
    set role               = excluded.role,
        display_name       = excluded.display_name,
        -- 영문 이름은 비어 있는 초대장이 기존 값을 지우지 않게 한다. 사람이 자기 철자를
        -- 한 번 적어 두면 재초대가 그것을 되돌리면 안 된다(reports_to·team_id와 같은 결).
        display_name_en    = coalesce(excluded.display_name_en, user_profiles.display_name_en),
        title_ko           = excluded.title_ko,
        max_security_class = excluded.max_security_class,
        -- 이미 조직도에 자리가 있는 사람이면 그 자리를 초대장이 덮지 않는다.
        -- 블록 B에서 사람이 옮겨 둔 상사를 재초대 한 번이 되돌리면 안 된다.
        reports_to         = coalesce(user_profiles.reports_to, excluded.reports_to),
        team_id            = coalesce(user_profiles.team_id, excluded.team_id),
        joined_on          = coalesce(user_profiles.joined_on, excluded.joined_on),
        language           = excluded.language,
        status             = 'active',
        revoked_at         = null;

  foreach biz in array inv.business_ids loop
    insert into user_business_access (user_id, business_id, granted_by)
    values (p_user, biz, inv.invited_by)
    on conflict (user_id, business_id) do nothing;
  end loop;

  -- 0047. 회장이 넣었거나(0026 set_approval이 칸을 채운다) 회장이 승인한 초대만. 위임 초대는 여기서 멈춘다(리뷰 C1).
  if inv.chairman_approved_at is not null then
    perform finance_default_apply(p_user);
  end if;

  update user_invitations
     set accepted_at = now(), accepted_user_id = p_user
   where invitation_id = inv.invitation_id;

  return true;
end;
$fn$;

comment on function apply_user_invitation(uuid, uuid) is
  '0026/0028/0047. 초대 한 건을 실제 권한으로 옮긴다. 결재가 필요한데 아직 안 났으면 아무것도 하지 않는다. 0028이 이름(en)·입사일·표기 언어를 같이 옮기게 했다. 0047이 회장이 넣거나 승인한 초대에 한해 DY 경영지원 팀장 기본 재무 권한을 붙인다. RPC로 열지 않는다 — 열면 결재를 건너뛰는 길이 된다.';

revoke all on function apply_user_invitation(uuid, uuid) from public;

-- 이미 그 자리에 있는 사람(0047 이전 가입)은 **회장이 넣거나 승인한 초대로 들어온 경우에만** 같은 기본값.
-- user_invitations는 force RLS라 마이그레이션 세션이 bypassrls가 아니면 0행 — 그러면 아무에게도 안 붙고,
-- 회장이 사용자 화면에서 체크한다(안전한 쪽). 감사는 쓰지 않는다(세션 없음 — 이 파일과 granted_at이 기록).
insert into user_module_access (user_id, module, can_write, can_approve)
select p.user_id, '/finance/biz_dy', true, false
  from user_profiles p
 where p.role::text = 'TeamLead'
   and p.team_id = 'team_dy_support'
   and p.revoked_at is null
   and exists (select 1 from user_business_access a where a.user_id = p.user_id and a.business_id = 'biz_dy')
   and exists (select 1 from user_invitations i where i.accepted_user_id = p.user_id and i.chairman_approved_at is not null)
on conflict (user_id, module) do nothing;

-- =====================================================================
-- 5절. official_statement_save() — 감사 줄의 action이 text라 저장이 한 번도 안 됐다
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
-- 6절. Vault 첨부 — 새 줄을 DB가 받지 않는다
-- =====================================================================
drop policy if exists attachments_no_vault_insert on attachments;
create policy attachments_no_vault_insert on attachments as restrictive for insert
  with check (security_class::text <> 'Vault');

commit;
