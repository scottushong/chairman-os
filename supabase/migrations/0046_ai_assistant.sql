-- =====================================================================
-- Chairman OS — 0046_ai_assistant (Phase 11 · AI 어시스턴트, 모든 화면)
-- 작성: 2026-09-29
--
-- 회장 지시: 모든 화면 오른쪽 아래의 AI 어시스턴트. 묻고 · 계산하고 · 틀린 것을 찾고 ·
-- **고치자고 제안한다.** 고치는 것은 반드시 «미리보기 → 사람이 확인 버튼 → 실행»이다 —
-- 모델이 직접 쓰기를 실행하는 길은 없어야 한다. 이 파일은 그 «확인»을 DB가 지키게 하는 자리다.
--
-- ■ ai_actions — AI가 제안한 쓰기 한 건 = 한 줄 ■
--   모델의 도구(propose_*)는 이 표에 **pending 줄을 넣을 뿐이다.** 실행은 확인 버튼을 누른 사람의
--   요청이 ai_action_decide()를 불러 그 줄을 pending → confirmed로 **한 번만** 넘긴 뒤에야 한다.
--   · 넣을 때 상태 · 만료 · 주인은 트리거가 정한다 — 클라이언트가 'confirmed'나 먼 만료를 보내도
--     pending · 15분 · auth.uid()로 덮인다.
--   · 고치는 grant가 없다(update · delete 없음). 상태를 옮기는 문은 definer 함수 둘뿐이다:
--       ai_action_decide(id, confirm)  주인 · pending · 만료 전일 때만. 같은 줄은 두 번 못 넘긴다.
--       ai_action_finish(id, ok, note) confirmed → done | failed (실행 결과를 적는다).
--   · 확인은 감사에 남는다 — «AI 제안, 회장 확인»(역할은 실제 역할). 대상 줄(이니셔티브 등)이
--     정해져 있으면 그 줄의 이력에 붙인다: 상세 화면의 기록 줄에서 바로 보이게.
--     그 줄은 **본인과 회장만** 읽는다(audit_log_ai_actions_private).
--   · 실제 쓰기는 앱이 **기존 쓰기 문**(이니셔티브 · 일정 · 결재 기안 · 체크인 · 메모 · 첨부 요약)으로
--     한다 — 권한은 그 표의 RLS가 그대로 본다. 이 표는 «확인했는가»만 지킨다.
--   payload(실행할 값)는 서버가 적고 서버가 읽는다. 확인 버튼은 action_id만 보낸다 — 화면이
--   미리보기와 다른 값을 실행하게 만들 길이 없다.
--
-- ■ ai_chat_messages에 두 칸 · ai_chats에 한 칸 ■
--   tokens   그 답에 쓴 토큰(입력+출력). 대화 하나의 토큰 상한을 앱이 이 합으로 잰다 —
--            ai_usage_log는 회장만 읽어서 직원 세션은 자기 사용량을 못 센다.
--   actions  그 답이 만든 ai_actions의 id 목록(문자열 배열). 화면이 답 아래에 확인 카드를 붙인다.
--   context_path  대화를 연 화면(앱 안 경로). 다시 열었을 때 «어느 화면에서 물었나».
--
-- 0035 규칙: force 없음 · revoke로 잠금 · 0001~0045 안 고침 · 새 audit_action 값 없음('update').
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 대화 표에 칸 셋
-- ---------------------------------------------------------------------
alter table ai_chats add column if not exists context_path text;
alter table ai_chats add constraint ai_chats_context_path_check
  check (context_path is null or (length(context_path) <= 200 and context_path ~ '^/($|[^/\\])'));

alter table ai_chat_messages add column if not exists tokens integer not null default 0;
alter table ai_chat_messages add constraint ai_chat_messages_tokens_check check (tokens between 0 and 10000000);
alter table ai_chat_messages add column if not exists actions jsonb not null default '[]';
alter table ai_chat_messages add constraint ai_chat_messages_actions_check
  check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) <= 10);

-- ---------------------------------------------------------------------
-- 2. ai_actions
-- ---------------------------------------------------------------------
create table ai_actions (
  action_id    uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chat_id      uuid references ai_chats(chat_id) on delete cascade,
  kind         text not null,
  payload      jsonb not null,                               -- [제한] 실행할 값(서버가 적는다)
  preview      jsonb not null,                               -- [제한] 사람이 보는 전 · 후
  target_table text,                                         -- [일반] 고칠 대상 표(새로 만드는 쓰기는 null)
  target_id    text,                                         -- [일반]
  business_id  text,                                         -- [일반] 감사 줄의 회사 칸
  status       text not null default 'pending',
  result       text,                                         -- [일반] 실행 결과 한 줄
  expires_at   timestamptz not null default now() + interval '15 minutes',
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,

  constraint ai_actions_kind_check check (kind in (
    'initiative_update', 'event_create', 'approval_draft', 'checkin', 'memo_tidy', 'attachment_summary')),
  constraint ai_actions_status_check check (status in ('pending', 'confirmed', 'cancelled', 'done', 'failed')),
  constraint ai_actions_payload_check check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 20000),
  constraint ai_actions_preview_check check (jsonb_typeof(preview) = 'object' and length(preview::text) <= 20000),
  constraint ai_actions_result_check check (result is null or length(result) <= 500)
);

create index ai_actions_by_chat on ai_actions (chat_id, created_at);
create index ai_actions_by_user on ai_actions (user_id, created_at desc);

comment on table ai_actions is
  '0046. AI 어시스턴트가 제안한 쓰기. 넣으면 늘 pending(15분). 실행 전 확인은 ai_action_decide()만 — 주인 · 한 번 · 만료 전.';

-- 넣을 때 상태 · 만료 · 시각 · 주인은 DB가 정한다. «이미 확인된 제안»을 끼워 넣는 길을 막는다.
create or replace function ai_actions_stamp() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.user_id := coalesce(auth.uid(), new.user_id);
  new.status := 'pending';
  new.result := null;
  new.decided_at := null;
  new.created_at := now();
  new.expires_at := now() + interval '15 minutes';
  return new;
end;
$fn$;

create trigger ai_actions_stamp_trigger
  before insert on ai_actions
  for each row execute function ai_actions_stamp();

alter table ai_actions enable row level security;
revoke all on table ai_actions from anon, authenticated;
-- 읽고 넣기만. 고치고 지우는 grant가 없다 — 상태는 아래 함수 둘만 옮긴다.
grant select, insert on table ai_actions to authenticated;

create policy ai_actions_own_read on ai_actions for select
  using (is_active() and user_id = auth.uid());
-- 사람만 제안을 받는다(시스템 역할 role_rank -1은 대화 창이 없다). 대화에 걸면 자기 대화여야 한다.
create policy ai_actions_own_insert on ai_actions for insert with check (
  is_active() and user_id = auth.uid() and role_rank(auth_role()) >= 0
  and (chat_id is null or exists (select 1 from ai_chats c where c.chat_id = ai_actions.chat_id and c.user_id = auth.uid()))
);
-- 방어선(0045와 같은 모양): permissive가 언젠가 느슨해져도 시스템 계정은 제안을 못 만든다.
create policy ai_agent_no_insert on ai_actions as restrictive for insert with check (auth_role() is distinct from 'AIAgent');
create policy integration_no_insert on ai_actions as restrictive for insert with check (not is_integration());

-- ---------------------------------------------------------------------
-- 3. 확인 · 취소 — 한 번만, 주인만, 만료 전만. 확인은 감사에 남는다.
-- ---------------------------------------------------------------------
-- jsonb로 돌려준다: 복합형 null은 PostgREST가 «칸이 전부 null인 객체»로 내보내 «없음»과 헷갈린다.
create or replace function ai_action_decide(p_action uuid, p_confirm boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  r ai_actions;
  v_label text;
begin
  if auth.uid() is null or not is_active() or role_rank(auth_role()) < 0 then
    raise exception 'ai_action_denied' using errcode = '42501';
  end if;

  -- 조건이 update 하나에 다 있다: 동시에 두 번 눌러도 한쪽만 pending을 본다.
  update ai_actions
     set status = case when p_confirm then 'confirmed' else 'cancelled' end,
         decided_at = now()
   where action_id = p_action
     and user_id = auth.uid()
     and status = 'pending'
     and expires_at > now()
  returning * into r;

  if not found then
    return null;   -- 남의 것 · 이미 결정된 것 · 만료된 것은 전부 «없음»이다(구분해 알려 주지 않는다).
  end if;

  if p_confirm then
    v_label := case auth_role()::text
      when 'Chairman' then '회장' when 'GroupCFO' then '그룹 CFO' when 'BusinessCEO' then '대표이사'
      when 'Executive' then '임원' when 'TeamLead' then '팀장' when 'Member' then '직원'
      else auth_role()::text end;
    insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
    values (
      'update',
      coalesce(r.target_table, 'ai_actions'),
      coalesce(r.target_id, r.action_id::text),
      -- 회사 칸은 실제 있는 회사일 때만(제안 값을 그대로 믿지 않는다).
      (select b.business_id from businesses b where b.business_id = r.business_id),
      auth.uid(),
      auth_role()::text,
      jsonb_build_object('ai_action', r.action_id, 'kind', r.kind, 'title', r.preview->>'title'),
      'AI 제안, ' || v_label || ' 확인'
    );
  end if;
  return to_jsonb(r);
end;
$fn$;

comment on function ai_action_decide(uuid, boolean) is
  '0046. 제안 하나를 pending → confirmed | cancelled. 주인 · 만료 전 · 한 번. 확인이면 감사 «AI 제안, <역할> 확인».';

create or replace function ai_action_finish(p_action uuid, p_ok boolean, p_result text) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not is_active() then
    return false;
  end if;
  update ai_actions
     set status = case when p_ok then 'done' else 'failed' end,
         result = left(coalesce(p_result, ''), 500)
   where action_id = p_action and user_id = auth.uid() and status = 'confirmed';
  return found;
end;
$fn$;

-- **AI 확인 감사 줄은 본인과 회장만 읽는다**(0041 audit_log_ai_chats_private · 0045 audit_log_attachments_private와
-- 같은 모양 — 리뷰 Important 2). 줄에 제안의 제목(메모 정리 · 체크인 같은 사적인 것도 있다)이 들어 있어서,
-- 0031의 subtree 읽기가 그대로면 팀장 · 임원이 부하 직원이 AI와 무엇을 고쳤는지 읽는다.
-- 표 이름으로 가를 수 없다 — 확인 줄은 대상 표(initiatives 등)에 붙는다. 그래서 after의 'ai_action' 표지로 가른다.
-- after가 null인 줄은 이 정책과 무관하다(coalesce → true).
create policy audit_log_ai_actions_private on audit_log as restrictive for select
  using (coalesce(not (after ? 'ai_action'), true) or actor_user_id = auth.uid() or auth_role()::text = 'Chairman');

revoke all on function ai_action_decide(uuid, boolean) from public, anon;
revoke all on function ai_action_finish(uuid, boolean, text) from public, anon;
revoke all on function ai_actions_stamp() from public, anon;
grant execute on function ai_action_decide(uuid, boolean) to authenticated;
grant execute on function ai_action_finish(uuid, boolean, text) to authenticated;

commit;
