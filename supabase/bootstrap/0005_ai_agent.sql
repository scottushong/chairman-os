-- =====================================================================
-- Chairman OS — 0005_ai_agent (수동 실행)
-- 출처: 02_기능명세 04_권한 시트 AIAgent 행 / Phase 3-A 블록 1
-- 작성: Phase 3-A (2026-09-17)
--
-- 야간 Job(/api/cron/night-brief)이 로그인할 계정이다. 이 프로젝트에 service_role은 없다 —
-- Agent도 사람처럼 로그인해서 RLS 안에서 돈다(CLAUDE.md 데이터 원칙).
--
-- 0004와 같은 이유로 migrations/ 밖에 있다. UID가 프로젝트마다 다르고,
-- user_profiles 쓰기는 Chairman 세션이 필요해서 SQL Editor(postgres 세션)에서 한 번 돌린다.
--
-- 선행: supabase/migrations/0013_ai_agent.sql 이 적용되어 있어야 한다.
--       (0013 없이 돌리면 이 계정이 KPI를 못 읽고, 알림을 '확인' 처리할 수 있는 상태가 된다.)
--
-- 실행 절차
--   1) Dashboard → Authentication → Users → "Add user"
--      이메일 예: ai-agent@<사내 도메인>. 비밀번호는 길고 무작위로. Auto Confirm User 켠다.
--      이 이메일/비밀번호가 Vercel의 AI_AGENT_EMAIL / AI_AGENT_PASSWORD 다.
--   2) UID 복사 → 이 파일의 :agent_uid 를 전부 치환한 사본(0005_ready.sql, .gitignore)을 만든다.
--        :agent_uid   →   '11111111-2222-3333-4444-555555555555'::uuid
--      psql이면 치환 없이: psql ... -v agent_uid="'…'::uuid" -f supabase/bootstrap/0005_ai_agent.sql
--   3) SQL Editor에서 사본 전체 실행.
--   4) 맨 아래 5절 확인 결과가 전부 기대값인지 본다.
--
-- 회사가 새로 생기면 Agent는 그 회사를 못 본다(04_권한 '지정 Scope'). 2절만 다시 돌리면 된다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 역할과 등급
--    max_security_class = 'Restricted' — 금액·원가까지는 읽고 Vault는 못 읽는다.
--    0013의 can_read_restricted()가 이 값을 보고, documents_read가 Vault 행을 자른다.
-- ---------------------------------------------------------------------
insert into user_profiles (user_id, role, display_name, title_ko, max_security_class)
values (:agent_uid, 'AIAgent', 'AI Night Agent', '야간 AI', 'Restricted')
on conflict (user_id) do update
  set role               = excluded.role,
      display_name       = excluded.display_name,
      title_ko           = excluded.title_ko,
      max_security_class = excluded.max_security_class,
      revoked_at         = null;

-- ---------------------------------------------------------------------
-- 2. 회사 범위 — 지금 있는 회사 전부(보관 제외)
--    AIAgent는 전사 역할이 아니라 has_business()가 이 표를 본다.
-- ---------------------------------------------------------------------
insert into user_business_access (user_id, business_id)
select :agent_uid, business_id
  from businesses
 where status <> 'Archived'
on conflict (user_id, business_id) do nothing;

-- ---------------------------------------------------------------------
-- 3. 기록 (CH-051)
-- ---------------------------------------------------------------------
insert into audit_log (actor_user_id, actor_role, action, entity_table, entity_id, note)
values (
  null, null, 'permission_change', 'user_profiles', (:agent_uid)::text,
  'bootstrap: AIAgent 지정(max_security_class=Restricted). supabase/bootstrap/0005_ai_agent.sql 수동 실행.'
);

commit;

-- ---------------------------------------------------------------------
-- 4. 확인 — 계정
-- ---------------------------------------------------------------------
select p.user_id, p.role, p.max_security_class, p.revoked_at, u.email,
       (select count(*) from user_business_access a where a.user_id = p.user_id) as businesses
  from user_profiles p
  join auth.users u on u.id = p.user_id
 where p.role = 'AIAgent';

-- ---------------------------------------------------------------------
-- 5. 확인 — RLS가 실제로 그렇게 도는가
--    Agent의 JWT를 흉내 낸 authenticated 세션으로 읽고 써 본 뒤 전부 되돌린다.
--    기대값: vault_docs = 0, kpis > 0, alert_ack = 0, settings_write = 'denied', output_write = 'ok'
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims', json_build_object('sub', (:agent_uid)::text, 'role', 'authenticated')::text, true);
set local role authenticated;

select
  (select count(*) from documents where security_class = 'Vault')      as vault_docs,
  (select count(*) from documents where security_class = 'Restricted') as restricted_docs,
  (select count(*) from finance_kpis)                                  as kpis,
  (select count(*) from decisions)                                     as decisions;

with acked as (
  update alerts set status = 'Acknowledged' where status = 'Open' returning 1
)
select count(*) as alert_ack from acked;

do $$
begin
  insert into user_settings (user_id) values (auth.uid());
  raise notice 'settings_write = allowed  <-- 기대와 다르다';
exception when insufficient_privilege then
  raise notice 'settings_write = denied';
end
$$;

insert into ai_night_outputs (output_id, business_id, job_type, result_summary, status, completed_at, run_date)
values ('bootstrap_probe', null, 'Daily Brief', 'probe', 'Done', now(), current_date);
select 'ok' as output_write;

rollback;
