-- =====================================================================
-- Chairman OS — 0093_ea_boss_name (전자결재 — 대표 단계 처리자 이름 «대표»)
-- 작성: 2026-10-23 · 결정 docs/decisions/2026-10-23-repair-0093.md
--
-- ■ 왜 ■ (대표 지시 2026-10-23 «0093 보수» 1번)
--   결재선 칸은 0087부터 역할 단계를 «대표»로 적는다. 그런데 결재 의견 · 변경 이력(ea_doc.events)과 단계의 처리자(acted_by_name)는
--   ea_name(uuid)로 실명을 그대로 꺼냈다 — 직원 · 후속 담당 화면에 대표 실명이 섰다. 결재선 칸과 같은 규칙으로 맞춘다.
--   대표 본인 화면(auth_role() = 'Chairman')은 실명 그대로.
--
-- ■ 바꾸는 것 ■
--   1절 ea_shown_name(uuid) — 보는 사람이 대표가 아니고, 그 사람이 대표(user_profiles.role = 'Chairman')이면 «대표». 아니면 ea_name.
--   2절 ea_doc · ea_list · ea_my_settings — 사람 이름이 나가는 자리를 모두 ea_shown_name으로(이력 actor · 대결 원 결재자 · 단계 처리자 ·
--        기안자 · 참조 · 후속 담당 · 대결 설정). ea_list의 기안자 검색도 보이는 이름으로만 찾는다(실명으로 찾아 대표 문서를 고르지 못하게).
--   3절 ea_reassign — 처리자를 대표로 바꾸면 결재선 칸 · 이력의 «to»가 «대표».
--   4절 백필 — 이미 쌓인 것 중 이름 글자를 저장한 자리만: ea_steps.approver_name(사람 단계로 대표가 선 줄) ·
--        ea_events(reassign)의 before.from / after.to. 사람(uuid) · 시각(acted_at · at) · 상태는 그대로.
--        이력 actor · 처리자는 uuid만 저장돼 있어 2절이 옛 줄에도 그대로 적용된다(따로 고칠 것 없음).
--
-- 0035 규칙: force를 새로 걸지 않는다 · FORCE를 내리지 않는다 · 표를 새로 만들지 않는다. 새 grant는 늘 to authenticated.
-- 함수 본문은 0087과 같고 이름 자리만 다르다(앞 번호 파일은 고치지 않는다).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 보이는 이름
-- =====================================================================
/** 보는 사람에 따라 이름 — 대표 본인 화면은 실명, 그 밖은 대표를 «대표»로(결재선 칸과 같은 규칙). */
create or replace function ea_shown_name(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $fn$
  select case
           when p_user is null then null
           when coalesce(auth_role()::text, '') <> 'Chairman'
                and exists (select 1 from user_profiles p where p.user_id = p_user and p.role::text = 'Chairman') then '대표'
           else ea_name(p_user)
         end;
$fn$;

-- =====================================================================
-- 2절. 이름이 나가는 함수
-- =====================================================================
create or replace function ea_list(p_box text, p_q text default null)
returns table (doc_id uuid, doc_no text, title text, form_key text, form_name text, drafter_name text, drafter_dept text, submitted_at timestamptz,
               status text, current_label text, due_date date, overdue boolean, my_role text, my_result text, as_proxy boolean,
               ref_confirmed boolean, followup_status text, followup_kind text, amount numeric, updated_at timestamptz, version int)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
declare
  v_me   uuid := auth.uid();
  v_q    text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not ea_human() then return; end if;
  return query
  with base0 as (
    select d.*, case when d.drafter is not null and ea_shown_name(d.drafter) = '대표' then '대표' else d.drafter_name end as shown_drafter
      from ea_docs d
     where feature_on('approvals', d.business_id)
  ), base as (
    select d.*, (select s.approver_name || ' ' || case s.kind when 'agree' then '합의' else '검토' end from ea_steps s where s.doc_id = d.doc_id and s.seq = d.current_seq) as cur,
           coalesce(d.form_snapshot ->> 'name', (select fm.name_ko from ea_forms fm where fm.form_key = d.form_key)) as fname
      from base0 d
     where (v_q is null or d.title ilike '%' || v_q || '%' or d.shown_drafter ilike '%' || v_q || '%')
  ), mine_steps as (
    select s.doc_id, s.seq, s.kind, s.status, s.acted_by, s.acted_as_proxy, (ea_step_owner(s.approver_user, s.approver_role) = v_me) as own
      from ea_steps s join base b on b.doc_id = s.doc_id
     where ea_step_owner(s.approver_user, s.approver_role) = v_me or s.acted_by = v_me
        or (s.status = 'waiting' and ea_proxy_for(ea_step_owner(s.approver_user, s.approver_role), b.form_key, b.amount))
  )
  select b.doc_id, b.doc_no, b.title, b.form_key, b.fname, b.shown_drafter, b.drafter_dept, b.submitted_at, b.status,
         case b.status when 'in_progress' then b.cur when 'approved' then '승인 완료' when 'rejected' then '반려' when 'withdrawn' then '회수' else '임시저장' end,
         b.due_date, (b.due_date is not null and b.status = 'in_progress' and b.due_date < (now() at time zone 'Asia/Seoul')::date),
         ms.kind, ms.status, coalesce(ms.acted_as_proxy, false) or (ms.doc_id is not null and not ms.own and ms.status = 'waiting'),
         r.confirmed_at is not null, fu.status, fu.kind, b.amount, b.updated_at, b.version
    from base b
    left join lateral (select * from mine_steps m where m.doc_id = b.doc_id
                        order by (m.status = 'waiting') desc, m.seq limit 1) ms on true
    left join ea_refs r on r.doc_id = b.doc_id and r.user_id = v_me
    left join ea_followups fu on fu.doc_id = b.doc_id
   where case p_box
           when 'todo' then b.status = 'in_progress' and ms.status = 'waiting'
           when 'planned' then b.status = 'in_progress' and ms.status = 'planned' and ms.own
           when 'mine' then b.drafter = v_me and b.status <> 'draft'
           when 'drafts' then b.drafter = v_me and b.status = 'draft'
           when 'history' then exists (select 1 from ea_steps s where s.doc_id = b.doc_id and s.acted_by = v_me and s.status in ('approved', 'rejected'))
           when 'refs' then r.user_id is not null and b.status <> 'draft'
           when 'followups' then fu.assignee = v_me and b.status = 'approved'
           else false end
   order by coalesce(b.submitted_at, b.updated_at) desc
   limit 300;
end;
$fn$;

create or replace function ea_doc(p_doc uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  d ea_docs;
  v_me uuid := auth.uid();
  v_fu ea_followups;
begin
  if not ea_can_read(p_doc) then return null; end if;
  select * into d from ea_docs where doc_id = p_doc;
  select * into v_fu from ea_followups where doc_id = p_doc;
  return jsonb_build_object(
    'doc', to_jsonb(d) - 'line' - 'refs' || jsonb_build_object('line', case when d.status = 'draft' then d.line end, 'refs_draft', case when d.status = 'draft' then d.refs end,
                                                                'form_name', coalesce(d.form_snapshot ->> 'name', (select name_ko from ea_forms where form_key = d.form_key)),
                                                                'followup_assignee_name', case when d.followup_assignee is not null then ea_shown_name(d.followup_assignee) end,
                                                                'drafter_name', case when ea_shown_name(d.drafter) = '대표' then '대표' else d.drafter_name end),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('seq', s.seq, 'kind', s.kind, 'name', s.approver_name, 'role', s.approver_role, 'user_id', s.approver_user,
                                                          'status', s.status, 'acted_by_name', case when s.acted_by is not null then ea_shown_name(s.acted_by) end,
                                                          'as_proxy', s.acted_as_proxy, 'comment', s.comment, 'acted_at', s.acted_at,
                                                          'mine', ea_step_owner(s.approver_user, s.approver_role) = v_me,
                                                          'can_act', d.status = 'in_progress' and s.status = 'waiting' and d.current_seq = s.seq
                                                                     and (ea_step_owner(s.approver_user, s.approver_role) = v_me or ea_proxy_for(ea_step_owner(s.approver_user, s.approver_role), d.form_key, d.amount)))
                                        order by s.seq) from ea_steps s where s.doc_id = p_doc), '[]'::jsonb),
    'refs', coalesce((select jsonb_agg(jsonb_build_object('name', ea_shown_name(r.user_id), 'kind', r.kind, 'seen', r.seen_at is not null, 'confirmed', r.confirmed_at is not null, 'me', r.user_id = v_me))
                       from ea_refs r where r.doc_id = p_doc), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('file_id', f.file_id, 'name', f.name, 'size', f.size_bytes, 'kind', f.kind, 'path', f.path) order by f.created_at)
                        from ea_files f where f.doc_id = p_doc), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actor', ea_shown_name(e.actor), 'as_proxy', e.as_proxy,
                                                           'original', case when e.original_user is not null then ea_shown_name(e.original_user) end,
                                                           'comment', e.comment, 'seq', e.seq, 'at', e.at) order by e.at)
                         from ea_events e where e.doc_id = p_doc and e.action <> 'draft'), '[]'::jsonb),
    'followup', case when v_fu.doc_id is null then null else jsonb_build_object('kind', v_fu.kind, 'status', v_fu.status, 'assignee', ea_shown_name(v_fu.assignee),
                     'mine', v_fu.assignee = v_me, 'due_date', v_fu.due_date, 'result', v_fu.result, 'ecount_slip', v_fu.ecount_slip,
                     'done_by', case when v_fu.done_by is not null then ea_shown_name(v_fu.done_by) end, 'done_at', v_fu.done_at) end,
    'related', coalesce((select jsonb_agg(jsonb_build_object('doc_id', x, 'title', case when ea_can_read(x) then (select title from ea_docs where doc_id = x) end,
                                                            'doc_no', case when ea_can_read(x) then (select doc_no from ea_docs where doc_id = x) end))
                          from unnest(d.related) x), '[]'::jsonb),
    'versions', coalesce((with recursive chain as (
                             select v.doc_id, v.prev_doc_id, v.version, v.status, v.doc_no from ea_docs v where v.doc_id = d.prev_doc_id
                             union all select v.doc_id, v.prev_doc_id, v.version, v.status, v.doc_no from ea_docs v join chain c on v.doc_id = c.prev_doc_id)
                           select jsonb_agg(jsonb_build_object('doc_id', c.doc_id, 'version', c.version, 'status', c.status, 'doc_no', c.doc_no) order by c.version)
                             from chain c where ea_can_read(c.doc_id)), '[]'::jsonb),
    'next_version', (select n.doc_id from ea_docs n where n.prev_doc_id = p_doc and ea_can_read(n.doc_id) limit 1),
    'me', jsonb_build_object('drafter', d.drafter = v_me,
                             'can_withdraw', d.drafter = v_me and d.status = 'in_progress' and not exists (select 1 from ea_steps s where s.doc_id = p_doc and s.acted_at is not null),
                             'can_resubmit', d.drafter = v_me and d.status in ('rejected', 'withdrawn'),
                             'ref', (select jsonb_build_object('kind', r.kind, 'confirmed', r.confirmed_at is not null) from ea_refs r where r.doc_id = p_doc and r.user_id = v_me))
  );
end;
$fn$;

create or replace function ea_my_settings() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $fn$
  select case when not ea_human() then null else jsonb_build_object(
    'proxies', coalesce((select jsonb_agg(jsonb_build_object('proxy_id', x.proxy_id, 'proxy', ea_shown_name(x.proxy), 'proxy_id_user', x.proxy, 'from', x.date_from, 'to', x.date_to, 'forms', x.forms, 'max_amount', x.max_amount, 'active', x.active) order by x.created_at desc)
                         from ea_proxies x where x.owner = auth.uid()), '[]'::jsonb),
    'proxy_for', coalesce((select jsonb_agg(jsonb_build_object('owner', ea_shown_name(x.owner), 'from', x.date_from, 'to', x.date_to)) from ea_proxies x
                           where x.proxy = auth.uid() and x.active and (now() at time zone 'Asia/Seoul')::date between x.date_from and x.date_to), '[]'::jsonb),
    'favorites', coalesce((select jsonb_agg(jsonb_build_object('fav_id', f.fav_id, 'name', f.name, 'line', f.line, 'refs', f.refs) order by f.created_at) from ea_favorites f where f.owner = auth.uid()), '[]'::jsonb),
    'notify', coalesce((select s.notify from ea_settings s where s.user_id = auth.uid()), '{"turn":true,"result":true,"followup":true,"ref":true}'::jsonb)) end;
$fn$;

-- =====================================================================
-- 3절. 처리자 바꾸기 — 대표로 바꾸면 «대표»
-- =====================================================================
create or replace function ea_reassign(p_doc uuid, p_seq int, p_user uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  s ea_steps;
  v_name text;
begin
  if not ea_admin() then raise exception 'ea_denied' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 then raise exception 'ea_reason' using errcode = '22023'; end if;
  select * into s from ea_steps where doc_id = p_doc and seq = p_seq for update;
  if s.doc_id is null or s.status not in ('planned', 'waiting') then raise exception 'ea_step_not_waiting' using errcode = '22023'; end if;
  if not exists (select 1 from user_profiles where user_id = p_user and revoked_at is null) then raise exception 'ea_line' using errcode = '22023'; end if;
  v_name := case when exists (select 1 from user_profiles where user_id = p_user and role::text = 'Chairman') then '대표' else ea_name(p_user) end;
  update ea_steps set approver_user = p_user, approver_role = null, approver_name = v_name where doc_id = p_doc and seq = p_seq;
  perform ea_event(p_doc, 'reassign', p_seq, false, ea_step_owner(s.approver_user, s.approver_role), p_reason, jsonb_build_object('from', s.approver_name), jsonb_build_object('to', v_name), null);
  return true;
end;
$fn$;

-- =====================================================================
-- 4절. 백필 — 저장된 이름 글자만(사람 · 시각 · 상태 그대로)
-- =====================================================================
update ea_steps s
   set approver_name = '대표'
  from user_profiles p
 where p.user_id = s.approver_user and p.role::text = 'Chairman' and s.approver_name <> '대표';

update ea_events e
   set after = jsonb_set(e.after, '{to}', '"대표"')
 where e.action = 'reassign' and e.after ? 'to' and e.after ->> 'to' <> '대표'
   and exists (select 1 from user_profiles p where p.role::text = 'Chairman' and p.display_name = e.after ->> 'to');

update ea_events e
   set before = jsonb_set(e.before, '{from}', '"대표"')
 where e.action = 'reassign' and e.before ? 'from' and e.before ->> 'from' <> '대표'
   and exists (select 1 from user_profiles p where p.role::text = 'Chairman' and p.display_name = e.before ->> 'from');

-- =====================================================================
-- 5절. 함수 권한(0087과 같다 — create or replace는 grant를 지키지만 새 함수는 잠근다)
-- =====================================================================
revoke all on function ea_shown_name(uuid) from public, anon, authenticated;
revoke all on function ea_list(text, text) from public, anon;
revoke all on function ea_doc(uuid) from public, anon;
revoke all on function ea_my_settings() from public, anon;
revoke all on function ea_reassign(uuid, int, uuid, text) from public, anon;
grant execute on function ea_list(text, text) to authenticated;
grant execute on function ea_doc(uuid) to authenticated;
grant execute on function ea_my_settings() to authenticated;
grant execute on function ea_reassign(uuid, int, uuid, text) to authenticated;

commit;
