-- =====================================================================
-- Chairman OS — 0013_ai_agent
-- 출처: 02_기능명세 04_권한 시트 AIAgent 행 / CH-019, CH-045~048 / Phase 3-A
-- 작성: Phase 3-A 블록 1 (2026-09-17)
--
-- 무엇이 없어서 만드나
--   0002는 AIAgent 역할을 enum에만 두고 정책을 거의 주지 않았다. 야간 Job을 실제로 돌려 보면
--   네 군데서 막히거나 새어 나간다.
--
--   1) 읽기가 막힌다   can_read_restricted()에 AIAgent가 없어 finance_kpis가 0행이다.
--                      KPI 없이 회사를 요약하면 요약이 아니다.
--   2) 쓰기가 샌다     alerts_ack(update)는 has_business만 본다. Agent에게 회사 범위를 주는 순간
--                      Agent가 알림을 '확인' 처리할 수 있다. user_settings도 자기 행은 쓸 수 있다.
--                      요구는 "쓰기는 ai_night_outputs만"이다.
--   3) 그룹 브리핑을 둘 자리가 없다   ai_night_outputs.business_id가 NOT NULL이다.
--                      goals와 같은 규칙(null = 그룹 행)으로 푼다. 읽기는 has_business(null)이라
--                      전사 역할(Chairman/GroupCFO)만 본다.
--   4) 구조화 출력을 둘 칸이 없다   { summary, confidence, items[] } 중 items와,
--                      한 번의 실행을 묶는 run_id / 브리핑 날짜 run_date가 없다.
--
-- 왜 이 모양인가
--   - 읽기 상한은 역할 이름이 아니라 max_security_class로 건다. 부트스트랩(0005_ai_agent.sql)이
--     'Restricted'를 주고, 그 값이 곧 "제한까지"다. Vault는 documents_read의
--     class_rank(...) <= class_rank(max_class())가 이미 막는다 — 여기서 따로 손대지 않는다.
--   - 쓰기 차단은 AS RESTRICTIVE 정책으로 건다. 표마다 permissive 정책을 하나씩 고치면
--     나중에 누가 새 쓰기 정책을 넣는 날 Agent에게 다시 열린다. restrictive는 다른 정책이
--     무엇을 허용하든 AND로 붙어서, 이 파일 하나가 "Agent는 여기 말고 못 쓴다"를 계속 보장한다.
--   - audit_log는 예외로 남긴다(원칙 7 Audit Log 필수). 대신 Agent는
--     본인 이름으로 된 night_job_completed 한 종류만 쓸 수 있다.
--
-- enum 값 추가와 같은 트랜잭션 안에서는 새 값을 리터럴로 쓸 수 없다(55P04 unsafe use of new value).
-- 그래서 아래 정책은 action::text로 비교한다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 어휘
-- ---------------------------------------------------------------------
-- 회사별 요약과, 그걸 압축한 그룹 브리핑. 09_Night Job Pipeline 6단계와는 다른 축이다 —
-- 저쪽은 조사·발굴 같은 '일'이고, 이쪽은 밤사이 상태를 회장 아침용으로 접은 '보고'다.
alter type night_job_type add value if not exists 'Company Brief';
alter type night_job_type add value if not exists 'Daily Brief';

alter type audit_action add value if not exists 'night_job_completed';

-- ---------------------------------------------------------------------
-- 2. ai_night_outputs 확장
-- ---------------------------------------------------------------------
alter table ai_night_outputs alter column business_id drop not null;
comment on column ai_night_outputs.business_id is 'null = 그룹 행(Daily Brief). goals와 같은 규칙이라 전사 역할만 읽는다.';

alter table ai_night_outputs
  add column if not exists items    jsonb not null default '[]'::jsonb, -- [제한] 요약의 근거 항목. result_summary와 같은 등급
  add column if not exists run_id   text,                               -- [일반] 한 번의 실행에서 나온 행을 묶는다
  add column if not exists run_date date,                               -- [일반] 브리핑 기준일(KST). 23:00에 돌아 그날을 요약한다
  add column if not exists model    text;                               -- [일반] 어느 모델이 썼나. 품질이 바뀌면 여기부터 본다

alter table ai_night_outputs
  add constraint ai_night_outputs_items_array check (jsonb_typeof(items) = 'array');

create index if not exists ai_night_outputs_by_run_date on ai_night_outputs (run_date desc, completed_at desc);

-- ---------------------------------------------------------------------
-- 3. 읽기 — [제한]까지
-- ---------------------------------------------------------------------
/** 금액·원가 같은 [제한] 등급을 읽을 수 있는 역할인가. AIAgent는 부여받은 등급이 제한 이상일 때만. */
create or replace function can_read_restricted() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and (
    auth_role() in ('Chairman', 'GroupCFO', 'BusinessCEO', 'Executive')
    or (auth_role() = 'AIAgent' and class_rank(max_class()) >= class_rank('Restricted'))
  );
$fn$;

-- ---------------------------------------------------------------------
-- 4. 쓰기 — ai_night_outputs(와 자기 audit_log 한 종류)만
-- ---------------------------------------------------------------------
drop policy if exists night_outputs_write on ai_night_outputs;
create policy night_outputs_write on ai_night_outputs
  for insert with check (
    auth_role() = 'AIAgent'
    and (business_id is null or has_business(business_id))
  );

drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log
  for insert with check (
    is_active()
    and (
      auth_role() is distinct from 'AIAgent'
      or (action::text = 'night_job_completed' and actor_user_id = auth.uid())
    )
  );

do $$
declare
  t text;
begin
  foreach t in array array[
    'businesses', 'finance_kpis', 'goals', 'monthly_priorities', 'critical_risks', 'milestones',
    'projects', 'tasks', 'decisions', 'alerts', 'documents', 'user_settings',
    'user_profiles', 'user_business_access', 'user_module_access',
    'business_strategy', 'user_invitations'
  ] loop
    execute format(
      'create policy ai_agent_no_insert on public.%I as restrictive for insert
         with check (auth_role() is distinct from %L)', t, 'AIAgent');
    execute format(
      'create policy ai_agent_no_update on public.%I as restrictive for update
         using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
      t, 'AIAgent', 'AIAgent');
    execute format(
      'create policy ai_agent_no_delete on public.%I as restrictive for delete
         using (auth_role() is distinct from %L)', t, 'AIAgent');
  end loop;
end
$$;
