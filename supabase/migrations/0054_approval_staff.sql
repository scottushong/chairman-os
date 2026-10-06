-- =====================================================================
-- Chairman OS — 0054_approval_staff (첫 직원 결재 — 대표는 팀장 칸에 서지 않는다 · 직원 결재는 늘 Open · 새 직원 «결재 올리기»)
-- 작성: 2026-10-06 (첫 직원 김병훈 결재 피드백 · 회장 결정)
--
-- ■ 무엇이 없어서 만드나 ■
--   ① 상사(reports_to)가 대표 본인인 직원이 결재를 올리면 my_approval_lead()(0038)가 대표를 **팀장 칸**에
--      세운다 → 500만 원 미만 작은 요청도 대표가 «팀장 대기»로 눌러야 끝난다. 회장 규칙은 «대표는 열람만»이다.
--      상사를 «없음»으로 바꾸는 우회는 0026 subtree 밖이 되어 대표 목록에서 안 보인다(2026-10-06 staging 확인) —
--      쓰면 안 된다.
--   ② 양식 없는 결재(template_key null)는 0042 트리거가 status · decided_*를 강제하지 않는다(0002부터 있던 구멍).
--      «결재 올리기»가 켜진 직원이 PostgREST로 status='Approved'인 결재를 바로 넣을 수 있다.
--   ③ 새 직원은 «결재 올리기»(user_module_access '/chairman/decisions' can_write — 0002 decisions_create가 보는 줄)
--      없이 들어온다. 회장이 사용자 · 권한 패널의 토글(a0be722)을 켜기 전에는 양식 다섯이 전부 42501이다.
--
-- ■ 고치는 방식 ■
--   1절 my_approval_lead() — 후보(팀장 · reports_to)에서 Chairman을 뺀다. «떠난 사람»을 고르기 전에 빼는 0038의
--       alive 거름에 한 조건을 더한 것 말고는 본문 그대로다. 함수 자체를 고치는 이유: 부르는 곳이 셋(이 트리거 ·
--       결재 올리기 화면의 미리보기 · 직원 홈 /me)이고 셋 다 같은 답을 원한다 — 트리거만 고치면 미리보기가
--       «대표 대기»라고 말하는데 실제로는 «기록 완료»가 되는 거짓말이 생긴다.
--       팀장 칸이 대표면 reports_to로, reports_to도 대표면 0행 → 팀장 칸이 비어 0042의 «팀장 단계 건너뜀
--       (lead_status 'skipped')»이 그대로 선다: 기준 미만은 규칙 종결(decided_by_kind 'rule', 화면 «기록 완료»),
--       기준 이상 · 늘 대표 양식은 대표 칸으로 Open(«대기»).
--   2절 decisions_approval_line() — 0049 본문을 그대로 복사하고 두 군데만 바꾼다:
--       (a) INSERT의 Open 강제를 양식 결재만이 아니라 **승인권자(can_approve — Chairman · BusinessCEO)가 아닌 세션의
--           모든 insert**로 넓힌다. status = 'Open' · decided_at/decided_by/decided_by_kind = null. 비승인권자의 결재가
--           insert 순간에 닫히는 길은 이 트리거의 규칙 종결 하나뿐이다.
--           세션이 없는 insert(auth.uid() null — 마이그레이션 · 시드 · SQL 편집기 · 이관)와 lead_bundle(chairman.lead_step)은
--           예전 그대로 둔다 — 시드(0003)와 검사 시드가 status를 들고 들어온다.
--       (b) 빈 팀장 칸의 문장 '팀장 · 직속 상위가 없음' → '팀장 결재 단계 없음'. 상사가 대표인 사람에게
--           «직속 상위가 없음»은 거짓이다. 미리보기(lib/approval-line.ts)도 같은 문장으로 바꾼다. 이미 얼린 결재선은
--           고치지 않는다(0038 — 얼린 값).
--   3절 대표 열람 — 팀장 단계를 건너뛴 양식 결재(lead_status 'skipped')는 대표가 읽는다(회사 격리는 그대로).
--       상사가 대표인 사람의 결재는 0026 subtree로 이미 보이지만, 상사가 비어 있는 사람(조직도에 안 매달린 사람)의
--       규칙 종결은 대표에게서도 가려진다 — «대표는 열람만»의 뜻과 반대다. lead_status는 트리거만 적는다(0042 얼림).
--   4절 새 직원 «결재 올리기» — user_profiles에 사람이 **새로 생기거나(insert) 회수에서 되살아날 때**(revoked_at
--       not null → null, 재초대) '/chairman/decisions' can_write=true · can_approve=false 한 줄을 붙인다. a0be722 토글과
--       같은 모양(전역 키 한 줄 — 0002가 그렇게 정했다). 올릴 수 있는 회사는 회사 범위(has_business)가 정한다.
--       가입 경로(0026/0047 apply_user_invitation → user_profiles insert)를 고치지 않고 user_profiles 트리거로 둔다 —
--       회장이 사람을 직접 넣는 길도 같이 덮고, 500줄짜리 가입 함수를 또 복사하지 않는다.
--       Chairman(can_module이 늘 참) · AIAgent · Integration(사람이 아니다)에는 붙이지 않는다. 이미 줄이 있으면 그대로
--       (on conflict do nothing). **지금 있는 직원에게는 붙이지 않는다(백필 없음)** — 회장이 토글로 정한 상태를 존중한다.
--       회장이 끄면(토글 → 줄 삭제) 다시 붙지 않는다 — 이 트리거는 insert · 되살림 순간에만 돈다.
--       실패해도 가입은 살린다(경고만) — accept_user_invitation(0026)이 예외를 삼키므로, 여기서 던지면 프로필
--       자체가 안 생기는 장애가 된다(0047 finance_default_apply와 같은 판단).
--
-- ■ 직원 화면 용어 ■ 이 파일이 DB에 새로 적는 사용자 문구는 '팀장 결재 단계 없음'과 감사 메모뿐이고 «회장»이 없다(0049).
--
-- ■ ECOUNT(0050~0052)와의 관계 ■ 이 파일은 0050~0052의 어느 객체도 건드리지 않고, 그 셋도 이 파일의 객체를
--   건드리지 않는다(decisions · user_profiles · user_module_access · my_approval_lead · decisions_approval_line ·
--   module_grant_audit). production은 0054를 0050~0052보다 먼저 받는다 — 순서에 기대는 것이 없다.
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0053을 고치지 않는다(0038/0042/0049의 함수는 create or replace로 앞으로 고친다).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 결재선 첫 칸 — 대표는 후보가 아니다
-- =====================================================================
create or replace function my_approval_lead()
returns table (user_id uuid, display_name text, via text)
language sql stable security definer set search_path = public as $fn$
  with me as (
    select p.user_id, p.team_id, p.reports_to from user_profiles p
     where p.user_id = auth.uid() and is_active()
  ),
  -- 떠난 사람(revoked_at · status='left')은 **고르기 전에** 뺀다(0038). 0054: 대표(Chairman)도 고르기 전에 뺀다 —
  -- 대표는 팀장 칸에 서지 않는다. 팀장이 대표면 reports_to로, reports_to도 대표면 0행(팀장 단계 건너뜀).
  alive as (
    select p.user_id from user_profiles p
     where p.revoked_at is null and p.status = 'active' and p.role::text <> 'Chairman'
  ),
  lead as (
    select t.lead_user_id as uid, 'team_lead'::text as via
      from me join teams t on t.team_id = me.team_id
     where t.lead_user_id is not null and t.lead_user_id <> me.user_id
       and t.lead_user_id in (select user_id from alive)
  ),
  boss as (
    select me.reports_to as uid, 'reports_to'::text as via from me
     where me.reports_to is not null and me.reports_to in (select user_id from alive)
  ),
  pick as (
    select uid, via from lead
    union all
    select uid, via from boss where not exists (select 1 from lead)
  )
  select p.user_id, p.display_name, pick.via
    from pick join user_profiles p on p.user_id = pick.uid
   where p.revoked_at is null
   limit 1;
$fn$;

revoke execute on function my_approval_lead() from public, anon;
grant execute on function my_approval_lead() to authenticated;

comment on function my_approval_lead is
  '0038/0054. 결재선 첫 칸. 팀장(공석·본인·떠남이면 reports_to). 대표(Chairman)는 후보가 아니다 — 대표뿐이면 0행(팀장 단계 건너뜀). 이름과 id만 낸다.';

-- =====================================================================
-- 2절. 결재선 트리거 — 비승인권자의 insert는 늘 Open · 빈 팀장 칸 문장
-- =====================================================================
create or replace function decisions_approval_line() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_tpl approval_templates%rowtype;
  v_lead record;
  v_amount numeric;
  v_field jsonb;
  v_line jsonb := '[]'::jsonb;
  v_to_chairman boolean;
  v_why text;
  v_step boolean := coalesce(current_setting('chairman.lead_step', true), '') = 'on';
  -- 0054. 세션이 없는 insert(마이그레이션 · 시드 · 이관)는 예전 그대로 받는다. 세션이 있으면 승인권자만.
  v_approver boolean := auth.uid() is null or coalesce(can_approve(), false);
begin
  if tg_op = 'UPDATE' then
    if new.template_key is distinct from old.template_key
       or new.form is distinct from old.form
       or new.approval_line is distinct from old.approval_line then
      raise exception 'approval_line_frozen' using errcode = '42501';
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
    -- 리뷰 C1. 결정(Open → 다른 상태)은 단계를 건너뛰지 못한다:
    --   팀장 대기 중이면 팀장(lead_decide)만 — 회장은 위라서 예외. 회장 큐(chairman_required)면 회장만.
    --   CEO(can_approve)가 팀장 · 회장 단계를 건너뛰어 닫는 길, 묶음을 닫아 묶인 요청까지 닫는 길을 막는다.
    if not v_step and old.status::text = 'Open' and new.status::text <> 'Open' then
      if old.lead_status = 'pending' and auth_role()::text is distinct from 'Chairman' then
        raise exception 'lead_step_pending' using errcode = '42501';
      end if;
      if old.chairman_required is true and auth_role()::text is distinct from 'Chairman' then
        raise exception 'chairman_required' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- INSERT. 팀장 단계 칸은 화면이 보내도 버린다. 리뷰 C2 — **양식 결재는** 늘 Open으로 들어온다
  -- (decisions_create는 status를 보지 않는다). 규칙 종결은 아래에서 이 트리거가 직접 한다.
  -- 0054 — 양식이 없어도 **승인권자가 아닌 세션**의 insert는 늘 Open이다. 비승인권자의 결재가 insert 순간에
  -- 닫히는 길은 아래 규칙 종결 하나뿐이다. 세션 없는 insert(시드 · 이관)와 lead_bundle은 예전 그대로.
  if not v_step and (new.template_key is not null or not v_approver) then
    new.status := 'Open';
    new.decided_at := null;
    new.decided_by := null;
    new.decided_by_kind := null;
  end if;
  new.lead_decided_at := null;
  new.lead_decided_by := null;
  new.escalated := false;
  if not v_step then
    new.bundle_id := null;
  end if;

  if new.template_key is null then
    new.form := null;
    new.approval_line := null;
    -- 취합(lead_bundle)이 넣는 묶음 한 건은 양식이 없지만 회장 큐 표시를 가진다 — 그 함수가 켠
    -- 설정 안에서만 지킨다. 화면이 보낸 값은 버린다.
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

  -- 0054. 대표는 my_approval_lead()의 후보가 아니다 — 상사가 대표뿐이면 여기서 0행이고 팀장 칸이 빈다.
  select * into v_lead from my_approval_lead();
  if found then
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'lead', 'user_id', v_lead.user_id, 'name', v_lead.display_name,
      'why', case v_lead.via when 'team_lead' then '팀장' else '팀장 부재 · 직속 상위' end));
  else
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'lead', 'user_id', null, 'name', '—', 'why', '팀장 결재 단계 없음'));
  end if;

  begin
    v_amount := nullif(regexp_replace(coalesce(new.form->>'amount', ''), '[^0-9.]', '', 'g'), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  v_to_chairman := v_tpl.chairman_always
    or (v_tpl.chairman_over is not null and v_amount is not null and v_amount >= v_tpl.chairman_over);
  v_why := case
    when v_tpl.chairman_always then v_tpl.name_ko || ' 양식은 금액과 상관없이 대표 결재'
    when v_tpl.chairman_over is null then v_tpl.name_ko || ' 양식은 대표 규칙 없음'
    when v_to_chairman then '금액 ' || v_amount::text || '원 ≥ 기준 ' || v_tpl.chairman_over::text || '원'
    else '금액 ' || coalesce(v_amount::text, '—') || '원 < 기준 ' || v_tpl.chairman_over::text || '원'
  end;
  v_line := v_line || jsonb_build_array(jsonb_build_object('step', 'rule', 'user_id', null, 'name', '규칙 판정', 'why', v_why));
  if v_to_chairman then
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'chairman',
      'user_id', (select user_id from user_profiles where role::text = 'Chairman' and revoked_at is null order by created_at limit 1),
      'name', '대표', 'why', '규칙이 대표까지 올린다'));
  end if;
  new.approval_line := v_line;
  new.chairman_required := v_to_chairman;

  -- 팀장 칸이 비었으면(팀장 · 직속 상위가 없거나 대표뿐) 팀장 단계를 건너뛰고 규칙이 바로 판정한다.
  if v_lead.user_id is null then
    new.lead_status := 'skipped';
    if not v_to_chairman then
      new.status := 'Approved';
      new.decided_at := now();
      new.decided_by_kind := 'rule';
    end if;
  else
    new.lead_status := 'pending';
  end if;
  return new;
end;
$fn$;

-- =====================================================================
-- 3절. 대표 열람 — 팀장 단계를 건너뛴 양식 결재
-- =====================================================================
-- 0042 decisions_chairman_queue_read와 같은 모양(permissive, OR로 합쳐진다). 규칙 종결(«기록 완료»)도 대표가 본다 —
-- 기안자가 조직도에 매달려 있지 않아도. 회사 격리는 그대로(has_business).
create policy decisions_chairman_skipped_read on decisions for select
  using (is_active() and auth_role()::text = 'Chairman' and lead_status = 'skipped' and has_business(business_id));

-- =====================================================================
-- 4절. 새 직원 «결재 올리기»
-- =====================================================================
create or replace function user_profiles_draft_grant() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.revoked_at is not null or new.role::text in ('Chairman', 'AIAgent', 'Integration') then
    return null;
  end if;
  -- update는 «회수에서 되살아남»(재초대)만. 다른 update(이름 · 상사 · 역할 변경)로는 붙이지 않는다.
  if tg_op = 'UPDATE' and old.revoked_at is null then
    return null;
  end if;

  insert into user_module_access (user_id, module, can_write, can_approve)
  values (new.user_id, '/chairman/decisions', true, false)
  on conflict (user_id, module) do nothing;
  if found then
    -- 가입 순간은 세션이 없어 감사 insert가 막힌다 — module_grant_audit가 경고만 남긴다(0047). 기록은 granted_at.
    perform module_grant_audit(new.user_id, '/chairman/decisions', null,
      jsonb_build_object('module', '/chairman/decisions', 'can_write', true, 'can_approve', false),
      '새 직원 기본 «결재 올리기»(0054)');
  end if;
  return null;
exception when others then
  -- 가입 · 프로필 저장을 살린다. 권한만 안 붙는다 — 회장이 사용자 화면에서 켤 수 있다.
  raise warning 'user_profiles_draft_grant 실패 (%): %', new.user_id, sqlerrm;
  return null;
end;
$fn$;

revoke all on function user_profiles_draft_grant() from public, anon, authenticated;

comment on function user_profiles_draft_grant() is
  '0054. 새 직원(사람 역할 · 회장 제외)이 생기거나 회수에서 되살아날 때 «결재 올리기»(user_module_access ''/chairman/decisions'' can_write) 한 줄. 이미 있는 직원에게는 붙이지 않는다. 실패해도 가입은 살린다.';

drop trigger if exists user_profiles_draft_grant on user_profiles;
create trigger user_profiles_draft_grant
  after insert or update of revoked_at on user_profiles
  for each row execute function user_profiles_draft_grant();

commit;
