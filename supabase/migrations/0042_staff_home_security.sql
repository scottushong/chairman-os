-- ---------------------------------------------------------------------
-- 0042. 직원 홈 · 가입 · 보안 (Phase 6-2)
--
-- 1절 결재의 팀장 단계 — «요청 → 팀장 승인 → 규칙 판정»(원문 검증). 0038이 결재선을 얼려 두었고
--     (lead → rule → chairman), 이 절이 그 첫 칸에 **승인 권한**을 준다. 새 requests 표를 만들지 않는다 —
--     0033 머리 주석이 적었듯 이 저장소의 요청은 decisions다. TeamLead의 «회장 기안(취합)»도 여기.
-- 2절 가입 — 초대된(등록된) 이메일인지 묻는 한 줄. 가입 뒤 팀 · 역할 · 상사 연결은 0028
--     apply_user_invitation()이 이미 한다(auth.users insert 트리거).
-- 3절 원격 로그아웃 — service_role이 없어서 Supabase 세션을 서버에서 끊을 수 없다. 대신
--     user_profiles.sessions_revoked_at을 두고, 그보다 **먼저 로그인한 세션**을 앱이 끊는다.
-- 4절 새 기기 로그인 알림 — 본인에게 앱 내 알림, 회장에게 카톡(큐 → 매시 틱이 AIAgent로 보낸다.
--     직원 세션은 카톡 토큰을 못 읽는다 — 0023).
-- 5절 soft delete — 기록 표에서 permissive DELETE를 걷는다. 지우기 = deleted_at 적기(update).
--     지운 줄은 restrictive select가 숨긴다. 남기는 DELETE는 허용 목록(권한 부여 줄 · 개인 설정 ·
--     공유 회수 · 외부 원천 재적재 · 화면 배치/링크)뿐이고, check:db-safety · check:migrations가 잰다.
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0041을 고치지 않는다(0038의 트리거 함수는 create or replace로
-- 앞으로 고친다 — 0038 9절과 같은 방식).
-- ---------------------------------------------------------------------

-- =====================================================================
-- 1절. 팀장 단계
-- =====================================================================
alter table decisions add column lead_status text
  check (lead_status is null or lead_status in ('pending', 'approved', 'rejected', 'skipped'));
alter table decisions add column lead_decided_at timestamptz;
alter table decisions add column lead_decided_by uuid references auth.users(id);
-- 규칙이 회장까지 올리는가(제출 순간 얼린다) · 팀장이 규칙과 상관없이 회장에게 올렸는가.
alter table decisions add column chairman_required boolean;
alter table decisions add column escalated boolean not null default false;
-- 회장 기안(취합) — 팀장이 여러 요청을 묶어 올린 한 건. 묶인 요청이 이 칸으로 그 한 건을 가리킨다.
alter table decisions add column bundle_id text references decisions(decision_id);

comment on column decisions.lead_status is
  '0042. 팀장 단계. pending = 팀장 대기, skipped = 팀장 · 직속 상위가 없어 규칙으로 바로 간 건. 양식 없는 결재는 null.';

-- 0038의 결재선 트리거를 앞으로 고친다. 결재선 · 양식 칸의 동결은 그대로이고, 팀장 단계 칸들을 더한다.
-- 팀장 단계 칸은 lead_decide() · lead_bundle()만 바꾼다(트랜잭션 설정 chairman.lead_step='on').
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
    when v_tpl.chairman_always then v_tpl.name_ko || ' 양식은 금액과 상관없이 회장 결재'
    when v_tpl.chairman_over is null then v_tpl.name_ko || ' 양식은 회장 규칙 없음'
    when v_to_chairman then '금액 ' || v_amount::text || '원 ≥ 기준 ' || v_tpl.chairman_over::text || '원'
    else '금액 ' || coalesce(v_amount::text, '—') || '원 < 기준 ' || v_tpl.chairman_over::text || '원'
  end;
  v_line := v_line || jsonb_build_array(jsonb_build_object('step', 'rule', 'user_id', null, 'name', '규칙 판정', 'why', v_why));
  if v_to_chairman then
    v_line := v_line || jsonb_build_array(jsonb_build_object(
      'step', 'chairman',
      'user_id', (select user_id from user_profiles where role::text = 'Chairman' and revoked_at is null order by created_at limit 1),
      'name', '회장', 'why', '규칙이 회장까지 올린다'));
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

-- 팀장(결재선 첫 칸)은 그 결재를 읽는다. 기안자가 팀장의 subtree가 아니어도(teams.lead_user_id로만
-- 팀장인 경우) 0026 decisions_read가 막지 않게 — 이 한 경로만 연다(permissive, OR로 합쳐진다).
create policy decisions_lead_read on decisions for select
  using (is_active() and approval_line->0->>'user_id' = auth.uid()::text);

-- 회장 큐에 올라온 건(규칙 · 회장 확인 요청 · 취합)은 회장이 읽는다. 기안자가 조직도에서 회장 밑으로
-- 매달려 있지 않으면(reports_to가 빈 사람) 0026 subtree가 회장에게서도 그 결재를 가린다 — 회장에게
-- 올린 결재가 회장에게 안 보이는 것은 이 흐름의 뜻과 반대다. 회사 격리는 그대로(has_business).
create policy decisions_chairman_queue_read on decisions for select
  using (is_active() and auth_role()::text = 'Chairman' and chairman_required is true and has_business(business_id));

-- 팀장 승인 · 반려 · 회장 확인 요청. 팀장 = 얼린 결재선의 첫 칸(그때의 팀장). 승인하면 규칙 판정:
--   회장까지 가는 규칙(또는 회장 확인 요청)이면 Open으로 남아 회장 큐로, 아니면 여기서 종결(rule).
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
            when 'to_chairman' then case when p_escalate then '팀장 승인 · 회장 확인 요청' else '팀장 승인 · 규칙 판정: 회장 결재' end
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
          jsonb_build_object('bundle_of', to_jsonb(p_ids)), '회장 기안(취합)');
  return v_id;
end;
$fn$;

-- 회장이 묶음 한 건을 정하면 묶인 요청도 같은 결론으로 닫는다.
create or replace function decisions_bundle_close() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_prev text := coalesce(current_setting('chairman.lead_step', true), '');
begin
  if old.status::text = 'Open' and new.status::text <> 'Open' then
    perform set_config('chairman.lead_step', 'on', true);
    update decisions set status = new.status, decided_at = coalesce(new.decided_at, now()),
           decided_by = new.decided_by, decided_by_kind = coalesce(new.decided_by_kind, 'chairman')
     where bundle_id = new.decision_id and status::text = 'Open';
    -- 바깥(lead_decide 등)이 켜 둔 값을 끄지 않는다 — 들어올 때의 값으로 돌린다.
    perform set_config('chairman.lead_step', v_prev, true);
  end if;
  return new;
end;
$fn$;

create trigger decisions_bundle_close_trigger
  after update of status on decisions
  for each row execute function decisions_bundle_close();

revoke all on function lead_decide(text, boolean, boolean, text) from public, anon;
revoke all on function lead_bundle(text[], text) from public, anon;
grant execute on function lead_decide(text, boolean, boolean, text) to authenticated;
grant execute on function lead_bundle(text[], text) to authenticated;

-- =====================================================================
-- 2절. 가입 — 초대된 이메일인가
--
-- 로그인 전 화면이 부르므로 anon에게 연다. 돌려주는 것은 참/거짓 하나다 — 초대된 사람의 이름 · 역할은
-- 말하지 않는다. 미등록이면 화면이 «관리자에게 문의»를 띄우고 signUp을 부르지 않는다.
-- 초대 없이 signUp이 들어와도(API 직접 호출) 프로필이 생기지 않아 로그인에서 막힌다(auth.ts) — 두 겹.
-- =====================================================================
create or replace function invitation_open(p_email text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from user_invitations i
     where lower(i.email) = lower(trim(p_email))
       and i.accepted_at is null and i.revoked_at is null
  );
$fn$;

revoke all on function invitation_open(text) from public;
grant execute on function invitation_open(text) to anon, authenticated;

-- =====================================================================
-- 3절. 원격 로그아웃
-- =====================================================================
alter table user_profiles add column sessions_revoked_at timestamptz;

comment on column user_profiles.sessions_revoked_at is
  '0042. 이 시각보다 먼저 로그인한 세션은 앱이 끊는다(원격 로그아웃). service_role 없이 «모든 기기 로그아웃»을 하는 방법.';

-- 리뷰 I7. 앱만 막으면 훔친 토큰으로 PostgREST를 직접 부르는 길이 남는다. is_active() — 모든 정책이
-- 거치는 한 자리 — 에서 «그 토큰의 로그인 시각이 sessions_revoked_at보다 앞이면 비활성»을 본다.
-- 로그인 시각은 JWT amr[0].timestamp(갱신해도 바뀌지 않는 최초 인증 시각)다. PostgREST가
-- request.jwt.claims에 싣는다 — 없으면(마이그레이션 · SQL 편집기) 0으로 보아, 원격 로그아웃된 사람은
-- 그런 세션에서도 비활성이다.
create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from user_profiles p
     where p.user_id = auth.uid() and p.revoked_at is null
       and (
         p.sessions_revoked_at is null
         or coalesce(
              (nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr' -> 0 ->> 'timestamp')::bigint,
              0
            ) >= extract(epoch from p.sessions_revoked_at)::bigint
       )
  );
$fn$;

create or replace function force_logout(p_user uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  n integer;
begin
  if not (is_active() and auth_role()::text = 'Chairman') then
    return false;
  end if;
  update user_profiles set sessions_revoked_at = now() where user_id = p_user;
  get diagnostics n = row_count;
  if n = 0 then
    return false;
  end if;
  insert into audit_log (action, entity_table, entity_id, actor_user_id, actor_role, after, note)
  values ('permission_change', 'user_profiles', p_user::text, auth.uid(), auth_role()::text,
          jsonb_build_object('sessions_revoked_at', now()), '모든 기기 로그아웃');
  return true;
end;
$fn$;

revoke all on function force_logout(uuid) from public, anon;
grant execute on function force_logout(uuid) to authenticated;

-- =====================================================================
-- 4절. 새 기기 로그인 알림
--
-- «새 기기» = 이 사람의 지난 90일 성공 로그인(audit_log 'login')에 같은 기기 요약이 없다.
-- 로그인 줄을 적기 **전에** 부른다. 본인에게는 앱 알림, 회장에게는 security_alerts 큐(매시 틱이 카톡으로).
-- 기기 요약은 'Chrome · Windows' 수준이고 IP는 없다(0031과 같다).
-- =====================================================================
create table security_alerts (
  alert_id   bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('new_device')),
  device     text not null default '',
  city       text not null default '',
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  send_note  text
);

alter table security_alerts enable row level security;
create policy security_alerts_read on security_alerts for select
  using (is_active() and auth_role()::text in ('Chairman', 'AIAgent'));
revoke all on table security_alerts from anon, authenticated;
grant select on table security_alerts to authenticated;

create or replace function report_login_device(p_device text, p_city text) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_new boolean;
  v_name text;
begin
  if not is_active() or auth.uid() is null then
    return false;
  end if;
  -- 리뷰 I6. 로그인 줄(0031)과 같은 모양으로 맞춘 뒤 비교한다 — 원문 User-Agent는 null로 버리고,
  -- 기기 · 도시는 요약만 남긴다(IP 없음). 같은 사람의 안 보낸 알림이 한 시간 안에 있으면 더 쌓지 않는다
  -- (지어낸 문자열로 회장 카톡을 채우는 길을 막는다).
  p_device := activity_device(p_device);
  p_city := activity_city(p_city);
  if exists (select 1 from security_alerts s where s.user_id = auth.uid() and s.sent_at is null and s.created_at > now() - interval '1 hour') then
    return false;
  end if;
  v_new := not exists (
    select 1 from audit_log a
     where a.actor_user_id = auth.uid() and a.action = 'login'
       and a.after->>'device' is not distinct from p_device
       and a.occurred_at > now() - interval '90 days'
  );
  -- 처음 로그인하는 사람(기록이 하나도 없다)은 «새 기기»가 아니라 첫 접속이다 — 알리지 않는다.
  if v_new and exists (select 1 from audit_log a where a.actor_user_id = auth.uid() and a.action = 'login') then
    select display_name into v_name from user_profiles where user_id = auth.uid();
    insert into notifications (user_id, kind, title, body, link)
    values (auth.uid(), 'system', '새 기기에서 로그인했습니다',
            coalesce(nullif(p_device, ''), '알 수 없는 기기') || coalesce(' · ' || nullif(p_city, ''), '') || ' — 본인이 아니면 비밀번호를 바꾸고 관리자에게 알리세요.',
            '/settings/profile');
    insert into security_alerts (user_id, kind, device, city) values (auth.uid(), 'new_device', coalesce(p_device, ''), coalesce(p_city, ''));
    return true;
  end if;
  return false;
end;
$fn$;

-- 매시 틱(AIAgent)이 카톡으로 보낸 뒤 표시한다. 보낸 것만 — 줄을 지우지 않는다.
create or replace function security_alert_sent(p_id bigint, p_note text) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not (is_active() and auth_role()::text in ('Chairman', 'AIAgent')) then
    return false;
  end if;
  update security_alerts set sent_at = now(), send_note = left(p_note, 200) where alert_id = p_id and sent_at is null;
  return found;
end;
$fn$;

revoke all on function report_login_device(text, text) from public, anon;
revoke all on function security_alert_sent(bigint, text) from public, anon;
grant execute on function report_login_device(text, text) to authenticated;
grant execute on function security_alert_sent(bigint, text) to authenticated;

-- =====================================================================
-- 5절. soft delete
--
-- 기록 표 열넷. 각 표에 deleted_at을 두고, **permissive** DELETE 권한(FOR ALL · FOR DELETE)을 걷는다.
-- FOR ALL은 select · insert · update 셋으로 같은 식 그대로 나눈다 — 권한이 줄지도 늘지도 않고 DELETE만
-- 빠진다. restrictive 정책(ai_agent_no_delete 등)은 건드리지 않는다: 허용이 아니라 방어선이다.
-- 지운 줄은 restrictive select(«deleted_at is null»)가 숨긴다. 되살리기는 SQL로 deleted_at을 비운다.
--
-- **남기는 DELETE(허용 목록)** — 지우는 것이 곧 정상 동작인 표들. 기록이 아니다:
--   user_business_access · user_module_access(권한 부여 줄 — 회수가 삭제다) · user_settings(개인 설정) ·
--   shares(공유 회수) · ai_chats · ai_chat_messages(본인 대화) · chairman_kakao_token · chairman_google_token
--   (연결 해제) · finance_kpis · fx_rates · cost_indices · market_multiples · journal_lines(외부 원천 재적재) ·
--   business_strategy(회사당 한 줄 설정) · process_charts · city_layout · doc_folders(화면 배치 · 링크) ·
--   exception_rules · attention_scores(규칙 · 점수 재계산) ·
--   **자연 키 표**(리뷰 I4) chairman_checkins(날짜) · initiative_notes(이니셔티브) · chairman_directions(회사) ·
--   dependency_areas · autonomy_assessments · absence_tests(회사 × 영역/분기/일수) · teams(team_id) — 키가 곧
--   그 줄이라 숨기면 같은 키로 다시 못 쓴다. 지우는 대신 값을 고친다.
-- 사람 · 초대(user_profiles · user_invitations)는 DELETE를 닫고 «지우기 = 회수(revoked_at)»로 둔다.
--
-- 알려진 틈(DEFERRED): definer 함수(company_progress · 0034/0035 집계 등)는 RLS를 타지 않아 지운 줄도 센다.
-- =====================================================================
do $soft$
declare
  v_tables text[] := array[
    'businesses', 'projects', 'goals', 'monthly_priorities', 'critical_risks', 'milestones',
    'business_keymen', 'initiatives', 'initiative_keymen', 'initiative_docs', 'events',
    'chairman_projects', 'documents', 'notices'
  ];
  -- 사람 · 초대는 «지우기 = 회수»다. deleted_at으로 숨기지 않는다(숨기면 다시 초대했을 때 0028이
  -- revoked_at만 비워 사람이 영영 안 보인다 — 리뷰 I5). DELETE 길만 닫고 soft_delete()가 revoked_at을 적는다.
  v_revoke_only text[] := array['user_profiles', 'user_invitations'];
  t text;
  r record;
  v_roles text;
  v_cmd text;
begin
  foreach t in array v_tables || v_revoke_only loop
    if not (t = any(v_revoke_only)) then
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
    -- 지운 줄은 안 보인다. **soft_delete() 안에서만** 예외 — Postgres는 UPDATE의 새 줄에도 SELECT 정책을
    -- 적용해서, 이 예외가 없으면 deleted_at을 적는 update가 «새 줄이 정책을 어긴다»로 거부된다.
    execute format(
      'create policy soft_delete_hidden on public.%I as restrictive for select
         using (deleted_at is null or coalesce(current_setting(%L, true), %L) = %L)',
      t, 'chairman.soft_delete', '', 'on');
    end if;

    for r in
      select * from pg_policies
       where schemaname = 'public' and tablename = t and permissive = 'PERMISSIVE' and cmd in ('ALL', 'DELETE')
    loop
      select string_agg(quote_ident(x), ', ') into v_roles from unnest(r.roles) as x;
      if r.cmd = 'ALL' then
        foreach v_cmd in array array['select', 'insert', 'update'] loop
          execute format(
            'create policy %I on public.%I for %s to %s %s %s',
            left(r.policyname, 50) || '_' || v_cmd, t, v_cmd, v_roles,
            case when v_cmd in ('select', 'update') and r.qual is not null then 'using (' || r.qual || ')' else '' end,
            case when v_cmd in ('insert', 'update') and coalesce(r.with_check, r.qual) is not null
                 then 'with check (' || coalesce(r.with_check, r.qual) || ')' else '' end);
        end loop;
      end if;
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
  end loop;
end
$soft$;

-- 지우기의 유일한 문. **SECURITY INVOKER** — 호출자의 update 권한(RLS)으로 돈다. 권한을 새로 주지 않고,
-- 트랜잭션 안에서만 «지운 줄 숨김»의 예외를 켰다 끈다. 표는 위 스물셋만 받는다(동적 SQL의 입구).
create or replace function soft_delete(p_table text, p_key text) returns boolean
language plpgsql volatile security invoker set search_path = public as $fn$
declare
  v_pk text;
  n integer;
begin
  -- 사람 · 초대는 회수다(위 5절). 초대를 지우면 0028 apply_user_invitation()이 revoked_at을 보고
  -- 가입을 거부한다 — 리뷰 C3(지운 초대로 가입되던 길).
  if p_table = 'user_profiles' then
    update public.user_profiles set revoked_at = coalesce(revoked_at, now()), status = 'left' where user_id::text = p_key and revoked_at is null;
    get diagnostics n = row_count;
    return n > 0;
  elsif p_table = 'user_invitations' then
    update public.user_invitations set revoked_at = coalesce(revoked_at, now()) where invitation_id::text = p_key and revoked_at is null;
    get diagnostics n = row_count;
    return n > 0;
  end if;
  if p_table <> all (array[
    'businesses', 'projects', 'goals', 'monthly_priorities', 'critical_risks', 'milestones',
    'business_keymen', 'initiatives', 'initiative_keymen', 'initiative_docs', 'events',
    'chairman_projects', 'documents', 'notices'
  ]) then
    raise exception 'soft_delete_table_not_allowed' using errcode = '42501';
  end if;
  select a.attname into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = ('public.' || quote_ident(p_table))::regclass and i.indisprimary;
  perform set_config('chairman.soft_delete', 'on', true);
  execute format('update public.%I set deleted_at = now() where %I::text = $1 and deleted_at is null', p_table, v_pk)
    using p_key;
  get diagnostics n = row_count;
  perform set_config('chairman.soft_delete', 'off', true);
  return n > 0;
end;
$fn$;

revoke all on function soft_delete(text, text) from public, anon;
grant execute on function soft_delete(text, text) to authenticated;

-- user_profiles의 «지우기»는 권한 회수다 — deleted_at과 함께 revoked_at · status를 적는 것은 앱(/settings/users)의
-- revokeUser가 이미 한다. 여기서는 DELETE 길만 닫았다.
