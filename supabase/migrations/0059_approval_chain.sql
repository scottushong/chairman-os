-- =====================================================================
-- Chairman OS — 0059_approval_chain (결재선 = 조직도 상사 사슬 · 단계 결재 · 결재 대장 열람 권한)
-- 작성: 2026-10-07 (회장 결정 — 결재 저장소(대장) · 엑셀 · 조직도 상사 승인 블록)
--
-- ■ 무엇이 없어서 만드나 ■
--   0038/0042/0054의 결재선은 «팀장 한 칸 → 규칙 판정 → 대표»다. 팀장(teams.lead_user_id 또는 reports_to 한 칸)이
--   없거나 대표뿐이면(0054) 팀장 단계를 건너뛰고 기준 미만은 «기록 완료»(decided_by_kind 'rule')로 닫혔다.
--   DY 경영지원(팀장 없음, 상사 = 대표)의 500만 미만 지출은 아무도 승인하지 않은 채 끝났다.
--   또 결재선은 한 칸뿐이라 «상사의 상사»를 거치지 못했고, 반려 사유 · 재상신 · 결재 대장 열람 권한이 없었다.
--
-- ■ 회장 결정(2026-10-07) ■
--   · 결재선 = 조직도 상사 사슬(user_profiles.reports_to): 직원 → 직속 상사 → 그 상사 … (teams.lead_user_id는 보지 않는다 —
--     팀장을 두면 그 사람을 reports_to로 건다).
--   · 기준 금액 미만(양식별 chairman_over 미만, 금액 규칙 없는 양식 포함): 직속 상사 승인으로 종결.
--   · 기준 금액 이상: 직속 상사부터 차례로 → 대표 최종. 계약 · 채용(chairman_always): 금액 무관 사슬 → 대표.
--   · 직속 상사가 대표면 소액도 대표 승인(«기록 완료» 자동 종결 폐지). 사슬이 끝까지 비면 대표.
--   · 같은 사람은 한 번만. 상사가 비었거나 퇴사(revoked · left)면 그 위로 건너뛴다.
--   · 반려는 사유 필수 · 즉시 종결 · 올린 사람에게 알림 · 새 결재로 재상신(원본 연결).
--   · 끝난 결재(승인 · 반려 · 기록 완료)는 값 수정 불가.
--   · 결재 대장 열람: 본인 것 · 결재선에 든 것 · 대표는 전부 · 회사별 «결재 대장 열람» 모듈 권한('/approvals/ledger/<회사>')을
--     받은 사람은 그 회사 전부. 회장만 준다(0002 module_access_admin_write). 사용자 관리자(0055) 위임 목록에는 없다.
--
-- ■ 고치는 방식 ■
--   1절 decisions 칸 — step_chain(단계 결재인가) · resubmit_of(재상신 원본) · requester_name/team(올린 사람 스냅숏).
--       스냅숏을 두는 이유: 대장은 «회사 전부»를 읽는 경영지원도 쓰는데, 그 사람은 0026 subtree 때문에 남의 프로필을
--       못 읽는다. 결재가 들어오는 순간 이름 · 팀을 얼려 두면 대장은 decisions · approval_steps만 RLS로 읽는다.
--       이미 있는 양식 결재에는 이름 · 팀만 채운다(백필) — 결재의 값(상태 · 금액 · 결재선)은 건드리지 않는다.
--   2절 approval_steps — 단계마다 결재자 · 상태(waiting · pending · approved · rejected · cancelled) · 처리 시각 · 의견.
--       올리는 순간(after insert) decisions.approval_line에서 만든다. 쓰기는 이 파일의 definer 함수만.
--   3절 사슬 계산 — approval_boss_chain(사람, 회사)(내부) · my_approval_chain(회사)(미리보기 RPC).
--       건너뛰는 사람: 떠남(revoked · left) · 사람 역할이 아님(AIAgent · Integration · 외부) · 그 회사 접근이 없음
--       (접근 없는 결재자는 결재를 읽지도 처리하지도 못해 결재가 멈춘다 — 회사 격리를 지키며 위로 건너뛴다).
--       대표(Chairman)를 만나면 거기서 멈춘다(대표는 마지막 칸으로 따로 붙는다).
--   4절 결재선 트리거 — 0054 본문을 복사해 양식 결재를 단계 결재로 바꾼다. 0054의 «비승인권자 insert는 늘 Open»,
--       «decided_by 위조 금지», «금액 모양 검사»는 그대로. 단계 결재는 approval_decide()만 상태를 바꾼다
--       (트랜잭션 설정 chairman.approval_step = 'on'). 끝난 양식 결재는 세션이 고치지 못한다.
--   5절 approval_decide(결재, 승인?, 의견) · approval_decide_many(결재들, 의견) — 차례인 사람만(대표는 결재자가 떠났거나
--       회사 접근을 잃은 칸만 대신 처리 — 멈춘 결재를 푸는 길) · 반려는 사유 필수 · 건마다 audit_log · 알림.
--   6절 읽기 — decisions_chain_read(결재선에 든 사람) · decisions_ledger_read(대표 전부 · 대장 권한 회사 전부) ·
--       approval_steps_read(결재가 보이면 단계도).
--   7절 대장 내려받기 감사 — approval_ledger_log(회사, 건수, 거르기).
--   8절 module_grant_audit — 0055 본문 그대로, 감사 줄의 회사에 '/approvals/ledger/<회사>'도 읽는다.
--
-- ■ 이미 있는 결재 ■ step_chain = false로 남는다. 끝난 것은 그대로(값 수정 불가만 새로 걸린다). 열린 것(«팀장 대기» ·
--   «대표 대기»)은 예전 길(lead_decide · 대표 처리)로 끝난다 — 이 파일은 그 길을 지우지 않는다.
--
-- ■ 위임 결재(휴가 중 대리) ■ 이번엔 설계만(docs/superpowers/specs/2026-10-07-approval-chain-ledger.md).
--
-- ■ 직원 화면 용어 ■ 이 파일이 DB에 새로 적는 사용자 문구(결재선 why · 알림)는 «대표»로 쓴다(0049). 회장 화면은 bossText로 되돌린다.
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0058을 고치지 않는다(함수는 create or replace, 정책은 새로).
-- 0058(입구, feat/intake)과 0060(결산 잠정 제안)의 객체를 건드리지 않는다.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. decisions 칸
-- =====================================================================
alter table decisions add column step_chain boolean not null default false;
alter table decisions add column resubmit_of text references decisions(decision_id);
alter table decisions add column requester_name text;
alter table decisions add column requester_team_id text;
alter table decisions add column requester_team_name text;

comment on column decisions.step_chain is
  '0059. 단계 결재(조직도 상사 사슬 → 대표)인가. 상태는 approval_decide()만 바꾼다. 0059 전의 결재는 false(예전 길).';
comment on column decisions.resubmit_of is
  '0059. 반려된 결재를 고쳐 다시 올렸으면 그 원본. 원본 한 건에 재상신 한 건.';
comment on column decisions.requester_name is
  '0059. 올린 사람의 이름 — 올리는 순간 얼린다. 대장(회사 전부를 읽는 사람)이 남의 프로필을 못 읽어도 이름을 그린다.';

create unique index decisions_resubmit_once on decisions (resubmit_of) where resubmit_of is not null;
create index decisions_ledger on decisions (business_id, created_at) where template_key is not null;

-- 이미 있는 양식 결재에 이름 · 팀만 채운다. 결재의 값은 그대로이고 updated_at도 건드리지 않는다.
alter table decisions disable trigger decisions_updated_at;
update decisions d
   set requester_name = p.display_name,
       requester_team_id = p.team_id,
       requester_team_name = t.name
  from user_profiles p left join teams t on t.team_id = p.team_id
 where d.template_key is not null and d.created_by = p.user_id and d.requester_name is null;
alter table decisions enable trigger decisions_updated_at;

-- =====================================================================
-- 2절. approval_steps
-- =====================================================================
create table approval_steps (
  decision_id      text not null references decisions(decision_id) on delete cascade,
  seq              int not null check (seq >= 1),
  approver_user_id uuid not null references auth.users(id),
  approver_name    text not null,
  -- '직속 상사' · '상위 상사' · '대표 최종 승인' … 사람이 읽는 한 줄(얼린 값).
  why              text not null,
  is_chairman      boolean not null default false,
  status           text not null check (status in ('waiting', 'pending', 'approved', 'rejected', 'cancelled')),
  decided_at       timestamptz,
  -- 실제로 누른 사람. 결재자 본인이거나, 결재자가 떠난 칸을 대표가 대신 처리했으면 대표.
  decided_by       uuid references auth.users(id),
  note             text,
  created_at       timestamptz not null default now(),
  primary key (decision_id, seq),
  constraint approval_steps_decided check ((status in ('approved', 'rejected')) = (decided_at is not null))
);

comment on table approval_steps is
  '0059. 단계 결재의 칸. 올리는 순간 decisions.approval_line에서 만든다(얼린 사슬). 쓰기는 approval_decide()만.';

create index approval_steps_by_approver on approval_steps (approver_user_id, status);
-- 한 결재에 «지금 차례»는 한 칸뿐이다.
create unique index approval_steps_one_pending on approval_steps (decision_id) where status = 'pending';

alter table approval_steps enable row level security;
revoke all on table approval_steps from anon, authenticated;
grant select on table approval_steps to authenticated;

-- =====================================================================
-- 3절. 사슬 계산
-- =====================================================================
-- 다른 사람이 그 회사를 볼 수 있는가 — 0002 has_business()를 «세션» 대신 «그 사람»으로.
create or replace function user_has_business(p_user uuid, p_business text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1 from user_profiles p
     where p.user_id = p_user and p.revoked_at is null and p.status = 'active'
       and (p.role::text in ('Chairman', 'GroupCFO')
            or exists (select 1 from user_business_access a where a.user_id = p_user and a.business_id = p_business))
  );
$fn$;

revoke all on function user_has_business(uuid, text) from public, anon, authenticated;

-- 사람의 상사 사슬(대표 앞까지). 건너뛰기: 떠남 · 사람 역할 아님 · 그 회사 접근 없음 · 이미 나온 사람.
-- 대표를 만나면 멈춘다. 순환(잘못 걸린 reports_to)은 본 사람 목록으로 끊는다.
create or replace function approval_boss_chain(p_user uuid, p_business text)
returns table (seq int, user_id uuid, display_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_cur uuid;
  v_seen uuid[] := array[p_user];
  v_n int := 0;
  p user_profiles%rowtype;
begin
  select reports_to into v_cur from user_profiles where user_profiles.user_id = p_user;
  for i in 1..50 loop
    exit when v_cur is null or v_cur = any(v_seen);
    v_seen := v_seen || v_cur;
    select * into p from user_profiles where user_profiles.user_id = v_cur;
    exit when not found;
    exit when p.role::text = 'Chairman';
    if p.revoked_at is null and p.status = 'active'
       and p.role::text in ('GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member')
       and user_has_business(p.user_id, p_business) then
      v_n := v_n + 1;
      seq := v_n;
      user_id := p.user_id;
      display_name := p.display_name;
      return next;
    end if;
    v_cur := p.reports_to;
  end loop;
end;
$fn$;

revoke all on function approval_boss_chain(uuid, text) from public, anon, authenticated;

comment on function approval_boss_chain(uuid, text) is
  '0059. 상사 사슬(대표 앞까지). 떠남 · 사람 역할 아님 · 그 회사 접근 없음 · 중복은 건너뛴다. 내부용 — 미리보기는 my_approval_chain().';

-- 결재 올리기 화면의 미리보기. 세션 본인의 사슬만, 이름과 id만.
create or replace function my_approval_chain(p_business text)
returns table (seq int, user_id uuid, display_name text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select c.seq, c.user_id, c.display_name from approval_boss_chain(auth.uid(), p_business) c
   where is_active() and has_business(p_business);
$fn$;

revoke all on function my_approval_chain(text) from public, anon;
grant execute on function my_approval_chain(text) to authenticated;

-- 대표(결재선 마지막 칸) — 가장 먼저 만든 살아 있는 Chairman.
create or replace function approval_chairman() returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p.user_id, p.display_name from user_profiles p
   where p.role::text = 'Chairman' and p.revoked_at is null and p.status = 'active' order by p.created_at limit 1;
$fn$;

revoke all on function approval_chairman() from public, anon, authenticated;

-- 세션이 그 결재의 결재선에 들었는가(어느 칸이든). 정책이 부른다 — approval_steps를 RLS 없이 본다(재귀 없음).
create or replace function in_approval_chain(p_decision text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from approval_steps s where s.decision_id = p_decision and s.approver_user_id = auth.uid());
$fn$;

revoke all on function in_approval_chain(text) from public, anon;
grant execute on function in_approval_chain(text) to authenticated;

-- 회사별 «결재 대장 열람» 줄('/approvals/ledger/<회사>'). 사람 역할만(0047 finance_grant와 같은 규칙).
create or replace function approval_ledger_grant(target text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select target is not null and is_active()
     and auth_role()::text in ('GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member')
     and exists (select 1 from user_module_access m
                  where m.user_id = auth.uid() and m.module = '/approvals/ledger/' || target);
$fn$;

revoke all on function approval_ledger_grant(text) from public, anon;
grant execute on function approval_ledger_grant(text) to authenticated;

comment on function approval_ledger_grant(text) is
  '0059. 세션 사람이 그 회사의 «결재 대장 열람»(user_module_access ''/approvals/ledger/<회사>'') 줄을 가졌는가. 회장은 false(역할로 전부 본다).';

-- =====================================================================
-- 4절. 결재선 트리거 — 0054 본문 + 단계 결재
-- =====================================================================
create or replace function decisions_approval_line() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_tpl approval_templates%rowtype;
  v_amount numeric;
  v_field jsonb;
  v_line jsonb := '[]'::jsonb;
  v_to_chairman boolean;
  v_why text;
  v_step boolean := coalesce(current_setting('chairman.lead_step', true), '') = 'on';
  -- 0059. approval_decide()가 켠다 — 단계 결재의 상태 · 처리 칸은 그 함수만 바꾼다.
  v_chain_on boolean := coalesce(current_setting('chairman.approval_step', true), '') = 'on';
  -- 0054. 세션이 없는 insert(마이그레이션 · 시드 · 이관)는 예전 그대로 받는다. 세션이 있으면 승인권자만.
  v_approver boolean := auth.uid() is null or coalesce(can_approve(), false);
  v_requester uuid;
  v_req user_profiles%rowtype;
  v_orig decisions%rowtype;
  v_boss record;
  v_n int := 0;
  v_chair record;
begin
  if tg_op = 'UPDATE' then
    if new.template_key is distinct from old.template_key
       or new.form is distinct from old.form
       or new.approval_line is distinct from old.approval_line
       -- 0059. 단계 결재 · 재상신 · 올린 사람 스냅숏도 얼린다.
       or new.step_chain is distinct from old.step_chain
       or new.resubmit_of is distinct from old.resubmit_of
       or new.requester_name is distinct from old.requester_name
       or new.requester_team_id is distinct from old.requester_team_id
       or new.requester_team_name is distinct from old.requester_team_name then
      raise exception 'approval_line_frozen' using errcode = '42501';
    end if;

    -- 0059. 단계 결재는 approval_decide()만 고친다 — 그 함수가 켠 설정 안에서 상태 · 처리 칸만.
    -- 세션 없는 update(마이그레이션 · 데이터 정정)는 예전처럼 받는다.
    if old.step_chain and auth.uid() is not null then
      if not v_chain_on then
        if (to_jsonb(new) - 'updated_at' - 'search_tsv') is distinct from (to_jsonb(old) - 'updated_at' - 'search_tsv') then
          raise exception 'approval_use_steps' using errcode = '42501';
        end if;
        return new;
      end if;
      if (to_jsonb(new) - 'updated_at' - 'search_tsv' - 'status' - 'decided_at' - 'decided_by' - 'decided_by_kind')
         is distinct from (to_jsonb(old) - 'updated_at' - 'search_tsv' - 'status' - 'decided_at' - 'decided_by' - 'decided_by_kind') then
        raise exception 'approval_use_steps' using errcode = '42501';
      end if;
      return new;
    end if;

    -- 0059. 끝난 양식 결재(승인 · 반려 · 기록 완료)는 세션이 고치지 못한다(감사 기록 유지).
    if old.template_key is not null and old.status::text <> 'Open' and auth.uid() is not null and not v_step
       and (to_jsonb(new) - 'updated_at' - 'search_tsv') is distinct from (to_jsonb(old) - 'updated_at' - 'search_tsv') then
      raise exception 'approval_closed_frozen' using errcode = '42501';
    end if;

    if not v_step and (
         new.lead_status is distinct from old.lead_status
         or new.lead_decided_at is distinct from old.lead_decided_at
         or new.lead_decided_by is distinct from old.lead_decided_by
         or new.chairman_required is distinct from old.chairman_required
         or new.escalated is distinct from old.escalated
         or new.bundle_id is distinct from old.bundle_id) then
      raise exception 'lead_step_frozen' using errcode = '42501';
    end if;
    -- 0042 리뷰 C1(예전 길 그대로). 팀장 대기 중이면 팀장(lead_decide)만 — 회장은 위라서 예외. 회장 큐면 회장만.
    if not v_step and old.status::text = 'Open' and new.status::text <> 'Open' then
      if old.lead_status = 'pending' and auth_role()::text is distinct from 'Chairman' then
        raise exception 'lead_step_pending' using errcode = '42501';
      end if;
      if old.chairman_required is true and auth_role()::text is distinct from 'Chairman' then
        raise exception 'chairman_required' using errcode = '42501';
      end if;
    end if;
    -- 0054 재리뷰 N1 — 결정을 기록하는 update의 처리자는 그 세션이다.
    if not v_step and auth.uid() is not null and old.status::text = 'Open' and new.status::text <> 'Open' then
      new.decided_by := auth.uid();
      new.decided_by_kind := decision_kind_of(auth_role()::text);
      new.decided_at := now();
    end if;
    return new;
  end if;

  -- INSERT. 0054 그대로 — 양식 결재와 비승인권자 세션의 insert는 늘 Open이다.
  if not v_step and (new.template_key is not null or not v_approver) then
    new.status := 'Open';
    new.decided_at := null;
    new.decided_by := null;
    new.decided_by_kind := null;
  elsif not v_step and auth.uid() is not null and new.status::text = 'Open' then
    new.decided_at := null;
    new.decided_by := null;
    new.decided_by_kind := null;
  elsif not v_step and auth.uid() is not null then
    new.decided_by := auth.uid();
    new.decided_by_kind := decision_kind_of(auth_role()::text);
    new.decided_at := now();
  end if;
  new.lead_decided_at := null;
  new.lead_decided_by := null;
  new.escalated := false;
  new.step_chain := false;
  new.requester_name := null;
  new.requester_team_id := null;
  new.requester_team_name := null;
  if not v_step then
    new.bundle_id := null;
  end if;

  if new.template_key is null then
    new.form := null;
    new.approval_line := null;
    new.resubmit_of := null;
    if not v_step then
      new.lead_status := null;
      new.chairman_required := null;
    end if;
    return new;
  end if;

  select * into v_tpl from approval_templates where template_key = new.template_key;
  new.form := coalesce(new.form, '{}'::jsonb);

  for v_field in select * from jsonb_array_elements(v_tpl.fields) loop
    if (v_field->>'required')::boolean
       and coalesce(trim(new.form->>(v_field->>'key')), '') = '' then
      raise exception 'approval_form_missing:%', v_field->>'key' using errcode = '23514';
    end if;
  end loop;
  if v_tpl.attachment_required and coalesce(trim(new.attachment_url), '') = '' then
    raise exception 'approval_attachment_missing' using errcode = '23514';
  end if;

  -- 0054 리뷰 C1 — 금액은 모양을 먼저 본다(닫힌 쪽 실패). lib/approval-line.ts AMOUNT_PATTERN과 같은 정규식.
  if coalesce(new.form->>'amount', '') ~ '^\s*([0-9]+|[0-9]{1,3}(,[0-9]{3})+)(\.[0-9]+)?\s*원?\s*$' then
    v_amount := regexp_replace(new.form->>'amount', '[^0-9.]', '', 'g')::numeric;
  else
    v_amount := null;
  end if;
  if v_tpl.chairman_over is not null and v_amount is null then
    raise exception 'approval_amount_invalid' using errcode = '23514';
  end if;
  v_to_chairman := v_tpl.chairman_always
    or (v_tpl.chairman_over is not null and v_amount is not null and v_amount >= v_tpl.chairman_over);
  -- 0059. 규칙 문장 — lib/approval-chain.ts chainRuleWhy와 같은 글자.
  v_why := case
    when v_tpl.chairman_always then v_tpl.name_ko || ' 양식은 금액과 상관없이 상사 결재 → 대표 최종 승인'
    when v_tpl.chairman_over is null then v_tpl.name_ko || ' 양식은 직속 상사 승인으로 종결'
    when v_to_chairman then '금액 ' || v_amount::text || '원 ≥ 기준 ' || v_tpl.chairman_over::text || '원 → 상사 결재 → 대표 최종 승인'
    else '금액 ' || v_amount::text || '원 < 기준 ' || v_tpl.chairman_over::text || '원 → 직속 상사 승인으로 종결'
  end;

  -- 0059. 올린 사람 = 세션(세션 없는 insert는 created_by). 세션이 있으면 created_by를 세션으로 덮는다 —
  -- 남의 이름으로 올리면 그 사람의 사슬 · 읽기 범위가 된다.
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  v_requester := new.created_by;
  select * into v_req from user_profiles where user_id = v_requester;
  if found then
    new.requester_name := v_req.display_name;
    new.requester_team_id := v_req.team_id;
    new.requester_team_name := (select t.name from teams t where t.team_id = v_req.team_id);
  end if;

  -- 재상신 — 내가 올려 반려된 같은 양식 · 같은 회사 결재만. 원본 한 건에 한 번(decisions_resubmit_once).
  if new.resubmit_of is not null then
    select * into v_orig from decisions where decision_id = new.resubmit_of;
    if not found or v_orig.created_by is distinct from v_requester or v_orig.status::text <> 'Rejected'
       or v_orig.template_key is distinct from new.template_key or v_orig.business_id is distinct from new.business_id then
      raise exception 'approval_resubmit_invalid' using errcode = '23514';
    end if;
  end if;

  new.step_chain := true;
  new.lead_status := null;

  -- 대표 본인이 올린 양식 결재는 대표 결정으로 바로 닫는다(자기 결재를 자기에게 올리지 않는다).
  if v_req.role::text = 'Chairman' then
    new.approval_line := jsonb_build_array(jsonb_build_object('step', 'rule', 'user_id', null, 'name', '규칙 판정', 'why', '대표 본인 결재'));
    new.chairman_required := false;
    new.status := 'Approved';
    new.decided_at := now();
    new.decided_by := v_requester;
    new.decided_by_kind := 'chairman';
    return new;
  end if;

  -- 상사 사슬: 기준 미만은 직속 상사 한 칸, 이상 · 늘 대표 양식은 사슬 전부 + 대표.
  for v_boss in select * from approval_boss_chain(v_requester, new.business_id) loop
    v_n := v_n + 1;
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'boss', 'user_id', v_boss.user_id, 'name', v_boss.display_name,
      'why', case when v_n = 1 then '직속 상사' else '상위 상사' end));
    exit when not v_to_chairman;
  end loop;
  if v_to_chairman or v_n = 0 then
    select * into v_chair from approval_chairman();
    if v_chair.user_id is null then
      raise exception 'approval_no_chairman' using errcode = '23514';
    end if;
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'chairman', 'user_id', v_chair.user_id, 'name', '대표',
      'why', case when v_to_chairman then '대표 최종 승인' when v_req.reports_to = v_chair.user_id then '직속 상사(대표)' else '결재할 상사가 없어 대표' end));
  end if;
  v_line := v_line || jsonb_build_array(jsonb_build_object('step', 'rule', 'user_id', null, 'name', '규칙 판정', 'why', v_why));
  new.approval_line := v_line;
  new.chairman_required := v_to_chairman or v_n = 0;
  return new;
end;
$fn$;

-- 올린 순간 단계 칸을 만든다(얼린 approval_line에서). 첫 칸 = 지금 차례, 나머지 = 기다림. 첫 결재자에게 알림 —
-- 대표에게는 건마다 보내지 않는다(아침 요약의 숫자 한 줄 · 승인함).
create or replace function decisions_steps_create() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_first uuid;
  v_first_chair boolean;
begin
  if not new.step_chain or new.status::text <> 'Open' then
    return null;
  end if;
  -- 번호는 rule 칸을 뺀 순서(얼린 approval_line의 순서)로 매긴다.
  insert into approval_steps (decision_id, seq, approver_user_id, approver_name, why, is_chairman, status)
  select new.decision_id, (row_number() over (order by s.n0))::int, (s.v->>'user_id')::uuid, s.v->>'name', s.v->>'why',
         s.v->>'step' = 'chairman',
         case when row_number() over (order by s.n0) = 1 then 'pending' else 'waiting' end
    from jsonb_array_elements(new.approval_line) with ordinality as s(v, n0)
   where s.v->>'step' in ('boss', 'chairman');

  select approver_user_id, is_chairman into v_first, v_first_chair from approval_steps
   where decision_id = new.decision_id and seq = 1;
  if v_first is not null and not v_first_chair then
    insert into notifications (user_id, kind, title, body, link)
    values (v_first, 'decision', '결재 차례: ' || left(new.title, 80),
            coalesce(new.requester_name, '—') || '님이 올린 결재입니다.', '/approvals?id=' || new.decision_id);
  end if;
  return null;
end;
$fn$;

revoke all on function decisions_steps_create() from public, anon, authenticated;

create trigger decisions_steps_create_trigger
  after insert on decisions
  for each row execute function decisions_steps_create();

-- =====================================================================
-- 5절. 처리 — approval_decide · approval_decide_many
-- =====================================================================
create or replace function approval_decide(p_decision text, p_approve boolean, p_note text default null)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  d decisions%rowtype;
  s approval_steps%rowtype;
  v_next approval_steps%rowtype;
  v_proxy boolean := false;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_result text;
  v_prev text := coalesce(current_setting('chairman.approval_step', true), '');
begin
  if not is_active() then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  select * into d from decisions where decision_id = p_decision for update;
  -- 다른 회사 결재는 «없는 결재»다(회사 격리).
  if not found or not has_business(d.business_id) then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  -- 리뷰 M2 — 결재선 밖 사람에게는 있는지 · 열렸는지도 말하지 않는다(대표는 대리 처리가 있어 예외).
  if not in_approval_chain(p_decision) and auth_role()::text is distinct from 'Chairman' then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  if not d.step_chain or d.status::text <> 'Open' then
    raise exception 'approval_not_pending' using errcode = '23514';
  end if;
  select * into s from approval_steps where decision_id = p_decision and status = 'pending' for update;
  if not found then
    raise exception 'approval_not_pending' using errcode = '23514';
  end if;
  if s.approver_user_id is distinct from auth.uid() then
    -- 대표는 결재자가 떠났거나(revoked · left) 그 회사 접근을 잃었거나 사람 역할이 아니게 된 칸만 대신 처리한다
    -- (멈춘 결재를 푸는 길, 리뷰 M7). 살아 있는 사람의 차례는 아무도 못 뺏는다.
    if auth_role()::text = 'Chairman'
       and (not user_has_business(s.approver_user_id, d.business_id)
            or (not s.is_chairman and not exists (
                  select 1 from user_profiles p where p.user_id = s.approver_user_id
                     and p.role::text in ('Chairman', 'GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member')))) then
      v_proxy := true;
    else
      raise exception 'approval_not_your_turn' using errcode = '42501';
    end if;
  elsif not user_has_business(auth.uid(), d.business_id) then
    -- 리뷰 M1 — 떠남(status 'left')으로만 표시되고 회수 전인 결재자는 처리하지 못한다(is_active()는 revoked_at만 본다).
    raise exception 'approval_not_your_turn' using errcode = '42501';
  end if;
  if not p_approve and v_note is null then
    raise exception 'approval_reason_required' using errcode = '23514';
  end if;
  if length(coalesce(v_note, '')) > 2000 then
    raise exception 'approval_note_too_long' using errcode = '23514';
  end if;

  perform set_config('chairman.approval_step', 'on', true);
  update approval_steps
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid(), note = v_note
   where decision_id = p_decision and seq = s.seq;

  if not p_approve then
    update approval_steps set status = 'cancelled' where decision_id = p_decision and status = 'waiting';
    update decisions set status = 'Rejected', decided_at = now(), decided_by = auth.uid(),
           decided_by_kind = decision_kind_of(auth_role()::text)
     where decision_id = p_decision;
    v_result := 'rejected';
  else
    select * into v_next from approval_steps where decision_id = p_decision and status = 'waiting' order by seq limit 1;
    if found then
      update approval_steps set status = 'pending' where decision_id = p_decision and seq = v_next.seq;
      v_result := 'next';
    else
      update decisions set status = 'Approved', decided_at = now(), decided_by = auth.uid(),
             decided_by_kind = decision_kind_of(auth_role()::text)
       where decision_id = p_decision;
      v_result := 'approved';
    end if;
  end if;
  perform set_config('chairman.approval_step', v_prev, true);

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (case when p_approve then 'approve' else 'reject' end::audit_action, 'decisions', p_decision, d.business_id,
          auth.uid(), auth_role()::text,
          jsonb_build_object('seq', s.seq, 'approver', s.approver_user_id, 'status', 'pending'),
          jsonb_build_object('seq', s.seq, 'status', case when p_approve then 'approved' else 'rejected' end,
                             'result', v_result, 'note', v_note, 'proxy', v_proxy),
          '결재 ' || s.seq || '단계 ' || case when p_approve then '승인' else '반려' end
            || case when v_proxy then '(대표 대리 — 결재자 부재)' else '' end
            || case v_result when 'approved' then ' · 최종 승인' when 'rejected' then ' · 종결' else ' · 다음 차례' end);

  -- 알림: 다음 차례(대표 제외 — 아침 요약 · 승인함) · 반려 · 최종 승인은 올린 사람에게.
  if v_result = 'next' and not v_next.is_chairman then
    insert into notifications (user_id, kind, title, body, link)
    values (v_next.approver_user_id, 'decision', '결재 차례: ' || left(d.title, 80),
            coalesce(d.requester_name, '—') || '님이 올린 결재입니다. 앞 단계가 승인했습니다.', '/approvals?id=' || p_decision);
  elsif v_result in ('approved', 'rejected') and d.created_by is not null and d.created_by is distinct from auth.uid() then
    insert into notifications (user_id, kind, title, body, link)
    values (d.created_by, 'decision',
            case v_result when 'approved' then '결재 최종 승인: ' else '결재 반려: ' end || left(d.title, 80),
            case v_result when 'approved' then '결재가 끝났습니다.' else '반려 사유: ' || left(v_note, 300) || ' — 고쳐서 다시 올릴 수 있습니다.' end,
            '/approvals?id=' || p_decision);
  end if;
  return v_result;
end;
$fn$;

comment on function approval_decide(text, boolean, text) is
  '0059. 단계 결재 한 칸 처리. 지금 차례인 결재자만(대표는 떠난 결재자의 칸만 대신). 반려는 사유 필수 · 즉시 종결. 건마다 audit_log · 알림.';

-- 승인함 «선택 항목 한 번에 승인» — 한 트랜잭션. 한 건이라도 내 차례가 아니면 전부 되돌린다(어느 건인지 오류에 적는다).
create or replace function approval_decide_many(p_ids text[], p_note text default null)
returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  v_id text;
  v_n int := 0;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 200 then
    raise exception 'approval_batch_invalid' using errcode = '23514';
  end if;
  for v_id in select distinct x from unnest(p_ids) x order by 1 loop
    begin
      perform approval_decide(v_id, true, p_note);
    exception when others then
      raise exception '%:%', sqlerrm, v_id using errcode = sqlstate;
    end;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

revoke all on function approval_decide(text, boolean, text) from public, anon;
revoke all on function approval_decide_many(text[], text) from public, anon;
grant execute on function approval_decide(text, boolean, text) to authenticated;
grant execute on function approval_decide_many(text[], text) to authenticated;

-- =====================================================================
-- 6절. 읽기
-- =====================================================================
-- 결재선에 든 사람(어느 칸이든 — 기다림 · 끝난 칸 포함)은 그 결재를 읽는다. 회사 격리는 그대로.
create policy decisions_chain_read on decisions for select
  using (is_active() and step_chain and has_business(business_id) and in_approval_chain(decision_id));

-- 결재 대장 — 대표는 양식 결재 전부, «결재 대장 열람» 줄을 가진 사람은 그 회사 양식 결재 전부.
create policy decisions_ledger_read on decisions for select
  using (is_active() and template_key is not null and has_business(business_id)
         and (auth_role()::text = 'Chairman' or approval_ledger_grant(business_id)));

-- 단계는 결재가 보이면 보인다(decisions의 RLS를 그대로 탄다).
create policy approval_steps_read on approval_steps for select
  using (is_active() and exists (select 1 from decisions d where d.decision_id = approval_steps.decision_id));

-- 리뷰 I2 — 0042 decisions_lead_read(결재선 첫 칸이면 읽는다)에는 회사 격리가 없었다. 0059부터 첫 칸 = 직속 상사라
-- 이 정책이 모든 단계 결재에 닿는다 — 회사 접근을 잃은 상사가 계속 읽는다. 이름 그대로 회사 격리를 더해 다시 만든다.
drop policy if exists decisions_lead_read on decisions;
create policy decisions_lead_read on decisions for select
  using (is_active() and has_business(business_id) and approval_line->0->>'user_id' = auth.uid()::text);

-- 리뷰 I1 — 양식 결재의 첨부(0045 attachments)는 «결재가 보이면» 올리고 지울 수 있었다. 대장 열람 · 결재선의 누구나
-- 남의 결재에 파일을 붙이고, 끝난 결재의 증빙을 바꿔치기할 수 있었다. 양식 결재에는 restrictive 한 겹:
-- 열린 결재에, 올린 사람 · 지금 차례 결재자(0059 전 결재는 팀장 칸 · 대표)만. 끝난 결재는 아무도(대표도) 못 바꾼다.
create or replace function approval_attachment_ok(p_entity_table text, p_entity_id text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  -- 재리뷰 Minor 1 — 못 보는 회사의 결재는 «양식 결재인가»도 말하지 않는다(참 = 판단 안 함, 0045 정책이 막는다).
  select p_entity_table is distinct from 'decisions'
      or not exists (select 1 from decisions d where d.decision_id = p_entity_id and d.template_key is not null and has_business(d.business_id))
      or exists (
        select 1 from decisions d
         where d.decision_id = p_entity_id and is_active()
           and (
             (d.status::text = 'Open'
              and (d.created_by = auth.uid()
                   or (d.step_chain and exists (select 1 from approval_steps s
                                                 where s.decision_id = d.decision_id and s.status = 'pending' and s.approver_user_id = auth.uid()))
                   or (not d.step_chain and (auth_role()::text = 'Chairman' or d.approval_line->0->>'user_id' = auth.uid()::text))))
             -- 재리뷰 I-B — 대표 본인 결재는 올리는 순간 닫힌다. 증빙은 올린 대표 본인이 뒤에 붙인다.
             or (d.step_chain and d.status::text = 'Approved' and d.created_by = auth.uid() and d.decided_by = auth.uid()
                 and d.decided_by_kind = 'chairman')));
$fn$;

revoke all on function approval_attachment_ok(text, text) from public, anon;
grant execute on function approval_attachment_ok(text, text) to authenticated;

create policy attachments_approval_insert on attachments as restrictive for insert
  with check (approval_attachment_ok(entity_table, entity_id));
create policy attachments_approval_delete on attachments as restrictive for delete
  using (approval_attachment_ok(entity_table, entity_id));

-- 재리뷰 I-A — 줄만 잠그면 파일(storage.objects)은 올린 사람 · 대표가 그대로 지우고(1시간 안이면) 같은 경로에 다시 올린다.
-- attachments 버킷의 객체에도 같은 판단을 restrictive로 건다. 다른 버킷은 건드리지 않는다.
create or replace function approval_object_ok(object_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((select approval_attachment_ok(a.entity_table, a.entity_id) from attachments a where a.storage_path = object_name limit 1), true);
$fn$;

revoke all on function approval_object_ok(text) from public;
grant execute on function approval_object_ok(text) to anon, authenticated;

drop policy if exists attachments_objects_approval_insert on storage.objects;
create policy attachments_objects_approval_insert on storage.objects as restrictive for insert
  with check (bucket_id is distinct from 'attachments' or public.approval_object_ok(name));
drop policy if exists attachments_objects_approval_delete on storage.objects;
create policy attachments_objects_approval_delete on storage.objects as restrictive for delete
  using (bucket_id is distinct from 'attachments' or public.approval_object_ok(name));

-- =====================================================================
-- 7절. 대장 내려받기 감사
-- =====================================================================
create or replace function approval_ledger_log(p_business text, p_count int, p_filters jsonb)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
begin
  -- 리뷰 M3 — 대표(회사 전체 · 한 회사) 또는 그 회사 «결재 대장 열람» 줄을 가진 사람만. 거르기 값은 2,000자까지.
  if not is_active()
     or (p_business is not null and not has_business(p_business))
     or not (auth_role()::text = 'Chairman' or (p_business is not null and approval_ledger_grant(p_business))) then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  if length(coalesce(p_filters, '{}'::jsonb)::text) > 2000 or coalesce(p_count, 0) < 0 then
    raise exception 'approval_ledger_log_invalid' using errcode = '23514';
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
  values ('download', 'decisions', 'ledger', p_business, auth.uid(), auth_role()::text,
          jsonb_build_object('count', p_count, 'filters', coalesce(p_filters, '{}'::jsonb)),
          '결재 대장 엑셀 ' || coalesce(p_count, 0) || '건');
end;
$fn$;

revoke all on function approval_ledger_log(text, int, jsonb) from public, anon;
grant execute on function approval_ledger_log(text, int, jsonb) to authenticated;

-- =====================================================================
-- 8절. 감사 줄의 회사 — '/approvals/ledger/<biz>'도 회사로 읽는다(0055 8절 본문 그대로)
-- =====================================================================
create or replace function module_grant_audit(p_user uuid, p_module text, p_before jsonb, p_after jsonb, p_note text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('permission_change', 'user_module_access', p_user::text,
          substring(p_module from '^/(?:finance|documents|users|approvals/ledger)/([a-z0-9_]+)$'),
          auth.uid(), auth_role()::text, p_before, p_after, p_note);
exception when others then
  raise warning 'module_grant_audit 실패 (%, %): %', p_user, p_module, sqlerrm;
end;
$fn$;

revoke all on function module_grant_audit(uuid, text, jsonb, jsonb, text) from public, anon, authenticated;

commit;
