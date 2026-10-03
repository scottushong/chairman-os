-- =====================================================================
-- Chairman OS — 0049_staff_terms (직원 화면 용어 — DB가 적는 «회장»을 «대표»로)
-- 작성: 2026-10-02 (회장 지시 «직원 화면 용어 원칙»)
--
-- 회장 지시: 직원들은 회장을 «대표»로 안다. «회장»은 회장 본인 OS 안에서만 쓰는 말이다. 회장 외 역할의
-- 화면 · 메일 · 알림 · AI 답변 어디에도 «회장»이 보이면 안 된다(CLAUDE.md «직원 화면 용어 원칙»).
--
-- ■ 무엇이 DB에 «회장»을 적고 있나 ■
--   decisions_approval_line()(0042)  결재선 JSON의 마지막 칸 name '회장' · why '규칙이 회장까지 올린다',
--                                     규칙 칸 why '… 양식은 금액과 상관없이 회장 결재' / '… 양식은 회장 규칙 없음'.
--                                     기안자 · 팀장 · 결재 상세를 보는 직원 전원이 읽는다.
--   lead_decide()(0042)               감사 메모 '팀장 승인 · 회장 확인 요청' / '팀장 승인 · 규칙 판정: 회장 결재'.
--   lead_bundle()(0042)               감사 메모 '회장 기안(취합)'.
--
-- ■ 고치는 방식 ■
--   1절 세 함수를 create or replace로 다시 쓴다 — 본문은 0042와 한 글자도 다르지 않고 문구만 «대표»다.
--       저장 문구를 «대표»로 두는 이유: 결재선 · 메모를 읽는 쪽은 직원이 대부분이고(회장 한 사람 대 전원),
--       AI 어시스턴트처럼 원문을 그대로 넘기는 경로도 있다. 회장 화면은 앱(lib/boss.ts bossText)이
--       «대표» → «회장»으로 되돌려 그린다. 반대로 두면 원문을 읽는 모든 새 경로가 직원에게 «회장»을 흘린다.
--   2절 이미 적힌 결재선을 고쳐 쓴다. approval_line은 얼린 값(0038)이라 트리거가 update를 막는다 —
--       이 마이그레이션 안에서만 트리거를 잠시 끄고 문구만 바꾼다. **사람 · 단계 · user_id · 순서는 그대로다**
--       (step이 rule · chairman인 칸의 name · why 문자열의 '회장'만 '대표'로). updated_at 트리거도 같이 끈다 —
--       문구 교체가 «최근 갱신»으로 보이면 안 된다.
--       취합 묶음의 제목(앱이 넘긴 p_title)에 '회장 기안'이 들어 있으면 그것도 '대표 기안'으로.
--   audit_log는 고치지 않는다 — 감사 기록은 append-only다(0001 audit_log_no_update). 옛 메모의 «회장»은
--       앱이 직원에게 그릴 때 «대표»로 바꾼다(bossText).
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0048을 고치지 않는다.
-- =====================================================================

-- =====================================================================
-- 1절. 결재선 · 팀장 단계 함수 — 문구만 «대표»
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
  -- 양식 없는 결재(기존 흐름 · 시드 · 이관)는 0038 이전과 같이 둔다 — 이 절이 여는 길이 아니다.
  if not v_step and new.template_key is not null then
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

  select * into v_lead from my_approval_lead();
  if found then
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'lead', 'user_id', v_lead.user_id, 'name', v_lead.display_name,
      'why', case v_lead.via when 'team_lead' then '팀장' else '팀장 부재 · 직속 상위' end));
  else
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'lead', 'user_id', null, 'name', '—', 'why', '팀장 · 직속 상위가 없음'));
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

  -- 팀장 칸이 비었으면(팀장 · 직속 상위 없음) 팀장 단계를 건너뛰고 규칙이 바로 판정한다.
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

create or replace function lead_decide(p_decision text, p_approve boolean, p_escalate boolean default false, p_note text default null)
returns text
language plpgsql volatile security definer set search_path = public as $fn$
declare
  d decisions%rowtype;
  v_result text;
begin
  select * into d from decisions where decision_id = p_decision for update;
  if not found or not is_active() then
    raise exception 'lead_not_found' using errcode = 'P0002';
  end if;
  if d.lead_status is distinct from 'pending' or d.status::text <> 'Open' then
    raise exception 'lead_not_pending' using errcode = '23514';
  end if;
  if d.approval_line->0->>'user_id' is distinct from auth.uid()::text then
    raise exception 'lead_forbidden' using errcode = '42501';
  end if;

  perform set_config('chairman.lead_step', 'on', true);
  if not p_approve then
    update decisions set lead_status = 'rejected', lead_decided_at = now(), lead_decided_by = auth.uid(),
           status = 'Rejected', decided_at = now(), decided_by = auth.uid(), decided_by_kind = 'ceo'
     where decision_id = p_decision;
    v_result := 'rejected';
  elsif p_escalate or d.chairman_required then
    update decisions set lead_status = 'approved', lead_decided_at = now(), lead_decided_by = auth.uid(),
           chairman_required = true, escalated = p_escalate and not coalesce(d.chairman_required, false)
     where decision_id = p_decision;
    v_result := 'to_chairman';
  else
    update decisions set lead_status = 'approved', lead_decided_at = now(), lead_decided_by = auth.uid(),
           status = 'Approved', decided_at = now(), decided_by = auth.uid(), decided_by_kind = 'rule'
     where decision_id = p_decision;
    v_result := 'closed_by_rule';
  end if;
  perform set_config('chairman.lead_step', 'off', true);

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
  values (case when p_approve then 'approve' else 'reject' end::audit_action, 'decisions', p_decision, d.business_id,
          auth.uid(), auth_role()::text,
          jsonb_build_object('lead_status', case when p_approve then 'approved' else 'rejected' end, 'result', v_result, 'note', p_note),
          case v_result
            when 'rejected' then '팀장 반려'
            when 'to_chairman' then case when p_escalate then '팀장 승인 · 대표 확인 요청' else '팀장 승인 · 규칙 판정: 대표 결재' end
            else '팀장 승인 · 규칙 판정: 팀 선에서 종결'
          end);
  return v_result;
end;
$fn$;

-- 회장 기안(취합) — 팀장이 자기가 승인해 회장 큐에 올린 요청 여럿을 한 건으로 묶는다. 같은 회사끼리만.
-- 묶인 요청은 bundle_id로 그 한 건을 가리키고, 회장이 그 한 건을 정하면 같이 닫힌다(아래 트리거).
create or replace function lead_bundle(p_ids text[], p_title text) returns text
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_business text;
  v_n int;
  v_id text;
begin
  if not is_active() or coalesce(array_length(p_ids, 1), 0) < 2 or length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'bundle_invalid' using errcode = '23514';
  end if;
  perform 1 from decisions where decision_id = any(p_ids) for update;
  select count(*) into v_n from decisions d
   where d.decision_id = any(p_ids)
     and d.lead_status = 'approved' and d.lead_decided_by = auth.uid()
     and d.status::text = 'Open' and d.bundle_id is null;
  if v_n <> array_length(p_ids, 1) then
    raise exception 'bundle_forbidden' using errcode = '42501';
  end if;
  select min(business_id) into v_business from decisions where decision_id = any(p_ids);
  if (select count(distinct business_id) from decisions where decision_id = any(p_ids)) <> 1 then
    raise exception 'bundle_mixed_business' using errcode = '23514';
  end if;

  perform set_config('chairman.lead_step', 'on', true);
  insert into decisions (business_id, title, options, impact, deadline, status, created_by, chairman_required, lead_status)
  values (v_business, trim(p_title), array['승인', '반려'], 'Medium',
          (select min(deadline) from decisions where decision_id = any(p_ids)),
          'Open', auth.uid(), true, 'approved')
  returning decision_id into v_id;
  update decisions set bundle_id = v_id where decision_id = any(p_ids);
  perform set_config('chairman.lead_step', 'off', true);

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
  values ('create', 'decisions', v_id, v_business, auth.uid(), auth_role()::text,
          jsonb_build_object('bundle_of', to_jsonb(p_ids)), '대표 기안(취합)');
  return v_id;
end;
$fn$;

-- =====================================================================
-- 2절. 이미 적힌 결재선 · 취합 제목
-- =====================================================================
alter table decisions disable trigger decisions_approval_line_trigger;
alter table decisions disable trigger decisions_updated_at;

update decisions d
   set approval_line = (
         select jsonb_agg(
                  case when e->>'step' in ('rule', 'chairman')
                       then e || jsonb_build_object('name', replace(e->>'name', '회장', '대표'),
                                                    'why', replace(e->>'why', '회장', '대표'))
                       else e
                  end order by t.ord)
           from jsonb_array_elements(d.approval_line) with ordinality as t(e, ord))
 where jsonb_typeof(d.approval_line) = 'array'
   and jsonb_array_length(d.approval_line) > 0
   and exists (select 1 from jsonb_array_elements(d.approval_line) e
                where e->>'step' in ('rule', 'chairman')
                  and (coalesce(e->>'name', '') like '%회장%' or coalesce(e->>'why', '') like '%회장%'));

update decisions d
   set title = replace(d.title, '회장 기안', '대표 기안')
 where d.title like '%회장 기안%'
   and exists (select 1 from decisions k where k.bundle_id = d.decision_id);

alter table decisions enable trigger decisions_updated_at;
alter table decisions enable trigger decisions_approval_line_trigger;

comment on column decisions.approval_line is
  '0038. 제출 순간의 결재선(팀장 → 규칙 판정 → 대표). 얼린 값이다 — 조직이 바뀌어도 고치지 않는다. 0049가 한 번, 사람 · 단계는 그대로 두고 문구의 «회장»만 «대표»로 바꿨다(직원 화면 용어 원칙).';
