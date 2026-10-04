-- Hook A1 — Auth 서버가 0043 가입 Hook 함수를 부를 수 있는가 (읽기 전용 · 아무것도 바꾸지 않는다)
-- 어디서: Supabase 대시보드 → production(nndvspgnljivkvihxlzj · Tokyo) → SQL Editor → + New query → 붙여 넣기 → Run
-- 기대값: auth_exec = true · auth_schema_usage = true · anon_exec = false
-- 결과 읽는 법: docs/onboarding/signup-hook-checklist.md 2절 표
select has_function_privilege('supabase_auth_admin','public.before_user_created_hook(jsonb)','execute') as auth_exec,
       has_schema_privilege('supabase_auth_admin','public','usage')                                  as auth_schema_usage,
       has_function_privilege('anon','public.before_user_created_hook(jsonb)','execute')             as anon_exec;
