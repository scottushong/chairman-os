-- =====================================================================
-- seed-check.sql — 운영에 처음부터 들어간 예시(시드) 줄 찾기. **읽기 전용**(select만, 쓰기 없음).
-- 작성: 2026-10-12. 회장이 /tasks에서 «Hot-melt 가격 승인»을 보고 누가 만든 건지 물음.
--
-- ■ 답 ■ 사람이 만든 줄이 아니다. 0003_seed.sql(마이그레이션)이 06_Dummy_Data(src/data/*.json, npm run gen:seed)를
--   DB를 처음 만들 때 넣었다. «Hot-melt 가격 승인» = tasks.task_id 'tsk_002'(프로젝트 prj_002, 담당 = 시드의 가짜 사람 user_001).
--   시드 줄은 0003이 넣은 id 목록 그대로 찾는다(tsk_001~005 · prj_001~008 · dec_001~004(기안자 없음) · alt_001~004 · ms_001~006 ·
--   risk_001~003 · goal 셋 · prio 둘 · ain_001~005). 모양(dec_###)으로 찾으면 앱이 만든 결재(dec_017 …)까지 걸린다.
--   시드 담당자 uuid(…uuid v5 of 'user_00N')는 실제 계정이 아니라 user_profiles에 없다 → 아래 «담당»이 «(시드 가짜 사람)»으로 나온다.
--   만든 시각(created_at) = 0003이 적용된 순간(그 DB를 처음 만든 날).
--
-- ■ 돌리는 법 ■ Supabase 대시보드 → SQL Editor에 **한 상자씩** 붙여 Run. 또는 link된 checkout에서 db query.
--   대시보드: https://supabase.com/dashboard/project/nndvspgnljivkvihxlzj/sql/new (운영) · …/itpenmxyracfhyormcep/sql/new (staging)
-- =====================================================================

-- [1] 표마다 시드 줄 수(요약). 지금 남은 줄만 센다.
select 'tasks' as 표, count(*) as 시드_줄 from tasks where task_id in ('tsk_001', 'tsk_002', 'tsk_003', 'tsk_004', 'tsk_005')
union all select 'projects', count(*) from projects where project_id in ('prj_001', 'prj_002', 'prj_003', 'prj_004', 'prj_005', 'prj_006', 'prj_007', 'prj_008')
union all select 'decisions', count(*) from decisions where decision_id in ('dec_001', 'dec_002', 'dec_003', 'dec_004') and created_by is null
union all select 'alerts', count(*) from alerts where alert_id in ('alt_001', 'alt_002', 'alt_003', 'alt_004')
union all select 'goals', count(*) from goals where goal_id in ('goal_group_2026', 'goal_dy_2026', 'goal_vana_2026')
union all select 'milestones', count(*) from milestones where milestone_id in ('ms_001', 'ms_002', 'ms_003', 'ms_004', 'ms_005', 'ms_006')
union all select 'monthly_priorities', count(*) from monthly_priorities where priority_id in ('prio_2026_09', 'prio_2026_09_dy')
union all select 'critical_risks', count(*) from critical_risks where risk_id in ('risk_001', 'risk_002', 'risk_003')
union all select 'ai_night_outputs', count(*) from ai_night_outputs where output_id in ('ain_001', 'ain_002', 'ain_003', 'ain_004', 'ain_005')
union all select 'finance_kpis(시트 숫자)', count(*) from finance_kpis where source::text <> 'Ledger';

-- [2] 업무(tasks) — 제목 · 담당 · 상태 · 만든 시각.
select t.task_id, t.title, coalesce(p.display_name, '(시드 가짜 사람)') as 담당, t.status, t.deadline, t.created_at
  from tasks t left join user_profiles p on p.user_id = t.owner_user_id
 where t.task_id in ('tsk_001', 'tsk_002', 'tsk_003', 'tsk_004', 'tsk_005') order by t.task_id;

-- [3] 프로젝트.
select r.project_id, r.business_id, r.name, coalesce(p.display_name, '(시드 가짜 사람)') as 담당, r.status, r.created_at
  from projects r left join user_profiles p on p.user_id = r.owner_user_id
 where r.project_id in ('prj_001', 'prj_002', 'prj_003', 'prj_004', 'prj_005', 'prj_006', 'prj_007', 'prj_008') order by r.project_id;

-- [4] 결정(decisions) — 시드 결정은 기안자(created_by)가 비어 있다.
select d.decision_id, d.business_id, d.title, d.status, coalesce(p.display_name, '(없음 — 시드)') as 기안자, d.created_at
  from decisions d left join user_profiles p on p.user_id = d.created_by
 where d.decision_id in ('dec_001', 'dec_002', 'dec_003', 'dec_004') and d.created_by is null order by d.decision_id;

-- [5] 알림(alerts).
select a.alert_id, a.business_id, a.message, a.status, a.created_at
  from alerts a where a.alert_id in ('alt_001', 'alt_002', 'alt_003', 'alt_004') order by a.alert_id;

-- [6] 목표 · 월간 우선순위 · 마일스톤 · 핵심 위험.
select 'goals' as 표, goal_id as id, title, created_at from goals where goal_id in ('goal_group_2026', 'goal_dy_2026', 'goal_vana_2026')
union all select 'monthly_priorities', priority_id, title, created_at from monthly_priorities where priority_id in ('prio_2026_09', 'prio_2026_09_dy')
union all select 'milestones', milestone_id, title, created_at from milestones where milestone_id in ('ms_001', 'ms_002', 'ms_003', 'ms_004', 'ms_005', 'ms_006')
union all select 'critical_risks', risk_id, title, created_at from critical_risks where risk_id in ('risk_001', 'risk_002', 'risk_003')
order by 1, 2;

-- [7] 야간 AI 출력(시드 예시 5줄).
select output_id, business_id, job_type, status, created_at
  from ai_night_outputs where output_id in ('ain_001', 'ain_002', 'ain_003', 'ain_004', 'ain_005') order by output_id;

-- [8] 시드 뒤에 사람이 손댄 시드 줄(updated_at이 created_at보다 1분 넘게 뒤) — 정리 전에 이것부터 본다.
select 'tasks' as 표, task_id as id, title, created_at, updated_at from tasks where task_id in ('tsk_001', 'tsk_002', 'tsk_003', 'tsk_004', 'tsk_005') and updated_at > created_at + interval '1 minute'
union all select 'projects', project_id, name, created_at, updated_at from projects where project_id in ('prj_001', 'prj_002', 'prj_003', 'prj_004', 'prj_005', 'prj_006', 'prj_007', 'prj_008') and updated_at > created_at + interval '1 minute'
union all select 'decisions', decision_id, title, created_at, updated_at from decisions where decision_id in ('dec_001', 'dec_002', 'dec_003', 'dec_004') and created_by is null and updated_at > created_at + interval '1 minute'
order by 1, 2;
