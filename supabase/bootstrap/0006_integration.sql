-- =====================================================================
-- Chairman OS — 0006_integration (수동 실행)
-- 출처: Phase 2-A ECOUNT 동기화 / DEFERRED D-19
-- 작성: Phase 2-A (2026-09-17)
--
-- ECOUNT 동기화(lib/ecount/sync.ts)가 로그인할 계정이다. 이 프로젝트에 service_role은 없다 —
-- 동기화도 야간 AI Agent처럼 로그인해서 RLS 안에서 돈다(CLAUDE.md 데이터 원칙).
--
-- 0005(AI Agent)와 따로 둔 이유: 0013이 AIAgent의 쓰기를 ai_night_outputs로 묶는다.
-- 원장을 쓰는 주체가 AI면 안 된다. 0015의 Integration 역할은 원장 5표만 쓰고, 나머지는 restrictive로 막힌다.
--
-- 선행: supabase/migrations/0015_finance_ledger.sql 적용.
--
-- 실행 절차 (0005와 같다)
--   1) Dashboard → Authentication → Users → "Add user". 예: ecount-sync@<사내 도메인>. Auto Confirm User.
--      이메일/비밀번호가 Vercel의 ECOUNT_SYNC_EMAIL / ECOUNT_SYNC_PASSWORD 다.
--   2) UID로 :sync_uid 를 전부 치환한 사본(0006_ready.sql, .gitignore)을 만든다.
--      psql이면: psql ... -v sync_uid="'…'::uuid" -f supabase/bootstrap/0006_integration.sql
--   3) SQL Editor에서 사본 전체 실행. 맨 아래 4절 기대값을 확인한다.
--
-- 회사가 새로 생기면 2절만 다시 돌린다. 볼 수 없는 회사의 원장은 쓸 수 없다(has_business).
-- =====================================================================

begin;

-- 1. 역할. 금액을 읽어야 upsert가 돈다 — [제한]까지.
insert into user_profiles (user_id, role, display_name, title_ko, max_security_class)
values (:sync_uid, 'Integration', 'ECOUNT Sync', 'ECOUNT 동기화', 'Restricted')
on conflict (user_id) do update
  set role               = excluded.role,
      display_name       = excluded.display_name,
      title_ko           = excluded.title_ko,
      max_security_class = excluded.max_security_class,
      revoked_at         = null;

-- 2. 회사 범위 — 지금 있는 회사 전부(보관 제외)
insert into user_business_access (user_id, business_id)
select :sync_uid, business_id
  from businesses
 where status <> 'Archived'
on conflict (user_id, business_id) do nothing;

-- 3. 기록 (CH-051)
insert into audit_log (actor_user_id, actor_role, action, entity_table, entity_id, note)
values (
  null, null, 'permission_change', 'user_profiles', (:sync_uid)::text,
  'bootstrap: Integration 지정(ECOUNT 동기화). supabase/bootstrap/0006_integration.sql 수동 실행.'
);

commit;

-- 4. 확인 — Integration JWT를 흉내 내 쓰고 전부 되돌린다.
--    기대값: task_update = 0, manual_journal = 'denied', open_journal = 'ok', closed_update = 0
begin;
select set_config('request.jwt.claims', json_build_object('sub', (:sync_uid)::text, 'role', 'authenticated')::text, true);
set local role authenticated;

with t as (update tasks set title = title returning 1) select count(*) as task_update from t;
with c as (update closings set amount = amount where closed returning 1) select count(*) as closed_update from c;

do $$
begin
  insert into journal_lines (business_id, entry_date, account_code, amount, side, slip_no, line_no, source, fetched_at)
  select business_id, current_date, account_code, 1, 'debit', 'bootstrap-probe-m', 1, 'manual', now()
    from accounts limit 1;
  raise notice 'manual_journal = allowed  <-- 기대와 다르다';
exception when insufficient_privilege then
  raise notice 'manual_journal = denied';
end
$$;

rollback;
