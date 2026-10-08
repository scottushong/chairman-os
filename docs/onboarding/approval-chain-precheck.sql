-- =====================================================================
-- 0059 반영 전 production 점검 — 읽기 전용(select만). Supabase SQL Editor(production)에 붙여 넣고 Run.
-- 이미 올라간 양식 결재가 0059 뒤 어떻게 되는지 숫자로 본다(끝난 것은 그대로 · 열린 것은 예전 길로 끝낸다).
-- =====================================================================

-- ① 양식 결재 — 상태 · 예전 팀장 단계 · 처리 종류별 건수
select status::text as 상태, coalesce(lead_status, '—') as 팀장단계, coalesce(decided_by_kind, '—') as 처리종류,
       chairman_required as 대표까지, count(*) as 건수
  from decisions where template_key is not null
 group by 1, 2, 3, 4 order by 1, 2, 3, 4;

-- ② 열린 양식 결재 — 0059 뒤에도 예전 길(팀장 /me 받은 결재 · 대표 /approvals 4버튼)로 끝낸다
select decision_id, business_id, title, lead_status, chairman_required, created_at
  from decisions where template_key is not null and status::text = 'Open'
 order by created_at;

-- ③ 올린 사람 이름 · 팀 백필 대상(0059가 이름 · 팀만 채운다 — 결재 값은 그대로)
select count(*) as 백필_대상 from decisions d join user_profiles p on p.user_id = d.created_by
 where d.template_key is not null;

-- ④ 직원의 직속 상사(reports_to) — 0059부터 결재선은 이 사슬이다. 상사가 비어 있으면 대표가 승인한다.
select p.display_name as 이름, p.role::text as 역할, t.name as 팀, b.display_name as 직속상사, b.role::text as 상사역할
  from user_profiles p left join teams t on t.team_id = p.team_id left join user_profiles b on b.user_id = p.reports_to
 where p.revoked_at is null and p.role::text in ('GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member')
 order by t.name nulls last, p.display_name;
