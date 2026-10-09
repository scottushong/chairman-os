-- =====================================================================
-- 김병훈 «결재 올리기»('/chairman/decisions') 권한 이력 — 읽기 전용(select만).
-- Supabase SQL Editor(production)에 통째로 붙여 넣고 Run. 결과 표 넷(①~④)을 캡처해 주세요.
--
-- 판정 기준(아래 ⑤ 주석) — «화면만 옛 값»인가, «실제로 꺼졌다 켜짐»인가.
-- =====================================================================

-- ① 지금 줄 — granted_at은 줄이 «처음 생긴» 시각이다(upsert는 이 칸을 바꾸지 않는다).
--    줄이 지워졌다가 다시 생기면 granted_at이 그 다시 생긴 시각으로 바뀐다.
select p.display_name as 이름, m.module as 모듈, m.can_write as 올리기, m.can_approve as 승인칸,
       m.granted_at at time zone 'Asia/Seoul' as 줄_생긴_시각_KST
  from user_profiles p
  left join user_module_access m on m.user_id = p.user_id
 where p.display_name = '김병훈'
 order by m.module;

-- ② 감사 기록 — 이 사람의 모듈 권한이 바뀐 모든 순간(앱 저장 · 트리거 · 회수 모두 entity_table = 'user_module_access').
--    after가 null이면 «줄 삭제(꺼짐)», before가 null이면 «줄 생김(켜짐)».
select a.occurred_at at time zone 'Asia/Seoul' as 시각_KST,
       coalesce(x.display_name, '(세션 없음 · 트리거)') as 누가, a.actor_role as 역할,
       coalesce(a.after ->> 'module', a.before ->> 'module') as 모듈,
       a.before ->> 'can_write' as 전_올리기, a.after ->> 'can_write' as 후_올리기,
       a.note as 메모
  from audit_log a
  join user_profiles p on p.user_id::text = a.entity_id
  left join user_profiles x on x.user_id = a.actor_user_id
 where p.display_name = '김병훈' and a.entity_table = 'user_module_access'
 order by a.occurred_at;

-- ③ 계정 자체의 변화 — 회수 · 역할 · 팀 · 상사 변경(회수되면 0047 트리거가 모듈 줄을 전부 지운다).
select a.occurred_at at time zone 'Asia/Seoul' as 시각_KST, coalesce(x.display_name, '(세션 없음)') as 누가,
       a.entity_table as 표, a.before as 전, a.after as 후, a.note as 메모
  from audit_log a
  join user_profiles p on p.user_id::text = a.entity_id
  left join user_profiles x on x.user_id = a.actor_user_id
 where p.display_name = '김병훈' and a.entity_table in ('user_profiles', 'user_business_access')
 order by a.occurred_at;

-- ④ 계정 시각 — 가입(created_at) · 회수 여부. 초대는 이메일로 이어진다.
select p.display_name as 이름, p.role::text as 역할, p.team_id as 팀, p.revoked_at as 회수,
       p.created_at at time zone 'Asia/Seoul' as 가입_KST,
       (select count(*) from user_invitations i join auth.users u on lower(u.email) = lower(i.email)
         where u.id = p.user_id) as 초대_건수
  from user_profiles p where p.display_name = '김병훈';

-- =====================================================================
-- ⑤ 판정 기준
--
-- «화면만 옛 값»(실제로는 계속 켜져 있었다):
--   · ① granted_at이 10-07 캡처보다 «앞»이고,
--   · ② 10-07 캡처 ~ 10-09 오늘 사이에 '/chairman/decisions'의 «후_올리기 = null 또는 false» 줄이 없다.
--   → 꺼진 적이 없다. 오늘 꺼져 보인 것은 화면이 저장 전 값을 들고 있던 것(10-07에 고친 «다시 그리기 안 됨»과 같은 결,
--     또는 열려 있던 탭이 F5 전 값)이다. 이번 블록의 즉시 표시(useOptimistic) 수정이 이 증상을 없앤다.
--
-- «실제로 꺼졌다 켜짐»:
--   · ②에 '/chairman/decisions' «후_올리기 = null(모듈 권한 회수)» 줄이 있고 그 뒤에 «켜짐» 줄이 있다, 또는
--   · ① granted_at이 10-07 캡처보다 «뒤»다(줄이 지워졌다가 다시 생겼다).
--   → «누가» 칸이 회장 본인이면 체크를 눌러 끈 기록(느린 체크를 두 번 누른 경우 포함 — 0-3 문제의 흔적).
--     «(세션 없음 · 트리거)» + 메모 «계정 회수에 따른 모듈 권한 삭제(0047)»면 계정 회수 경로. ③에 revoked_at 변화가 같이 보인다.
--
-- 코드 확인(2026-10-09): 기존 직원의 '/chairman/decisions' 줄을 «지우는» 자동 경로는 0047 finance_profile_grants의
--   «계정 회수 → 모듈 줄 전부 삭제» 하나뿐이다. 0054 user_profiles_draft_grant는 «붙이기만» 한다(insert · 회수에서 되살아남 때만,
--   on conflict do nothing). 0055의 자동 회수 트리거들은 '/users/<회사>' 위임 초대만 취소한다. 0059는 이 줄을 건드리지 않는다.
--
-- ② 의 세션 없는 줄: 가입 순간 트리거가 남기는 감사는 세션이 없어 막힐 수 있다(module_grant_audit 경고만) — 그래서
--   «처음 생김»은 ②에 없고 ①의 granted_at으로만 보일 수 있다.
-- =====================================================================
