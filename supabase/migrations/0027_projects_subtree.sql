-- =====================================================================
-- Chairman OS — 0027_projects_subtree
-- 출처: Phase 6-1 블록 A2가 남긴 구멍 하나 (컨트롤러 판정 2026-09-21)
-- 작성: Phase 6-1 projects-fix (2026-09-21)
--
-- 무엇이 없어서 만드나
--   0026이 다섯 번째 겹("누구든 자기 subtree만 본다")을 일곱 표 중 **여섯**에 얹었다.
--   `projects` 하나가 비었다(0026 2-2절). 그래서 오늘도 프로젝트 목록은 회사 전원에게
--   그대로 보인다 — 영업팀장이 만든 프로젝트를 구매팀 직원이 이름째 읽는다.
--   회장 지시 원문은 재작성 대상 일곱에 projects를 명시했고, 컨트롤러가 그대로 판정했다.
--
--   **이 구멍을 남기지 않는다.** 0026이 못 얹은 이유는 정당했지만(아래), 그 이유는
--   이 파일이 먼저 치우는 것으로 없앨 수 있다.
--
-- 0026이 막혔던 자리 — 한 문장으로
--   tasks는 회사를 직접 들고 있지 않다. tasks_read(0002:275-281)가 업무의 회사를
--   `exists (select 1 from projects p where … has_business(p.business_id))`로 판정하는데,
--   **정책 식 안의 subquery도 그 표의 RLS를 그대로 탄다.** projects_read를 좁히는 순간
--   이 exists는 "회사가 같은가"가 아니라 "그 프로젝트가 나에게 **보이는가**"가 되고,
--   팀장이 만든 프로젝트 안의 **직원 자신의 업무**가 0건이 된다(A2가 PGlite로 재현했다).
--
-- 그래서 순서가 이 파일의 전부다. 셋을 이 차례로 한다
--   1절  projects의 force row level security를 내린다.
--   2절  project_business_id() — definer 헬퍼 하나. tasks_read의 회사 판정이 더는
--        projects의 RLS를 타지 않게 한다.
--   3절  그제서야 projects_read에 subtree 겹을 얹는다.
--
--   1절 없이 2절을 하면 헬퍼가 **조용히 0행**을 준다(FORCE가 소유자까지 정책 아래로
--   끌어내리고, definer는 그 소유자 권한으로 돈다). 2절 없이 3절을 하면 업무 화면이
--   통째로 빈다. 셋은 한 트랜잭션 안에서 이 순서로만 성립한다.
--
-- 이 헬퍼는 우회가 아니라 좁은 문이다 (keyhole 원칙)
--   service_role은 이 프로젝트에 없고(CLAUDE.md), 이 파일도 RLS를 우회하는 경로를 만들지
--   않는다. project_business_id()가 내주는 것은 **business_id 문자열 하나**다 —
--   이름도, 담당자도, 진행률도, 마감일도 아니다. 반환 목록이 하나뿐인 것이 그 증거다
--   (0023 kakao_token_status()가 토큰 값을 반환 목록에서 아예 뺀 것과 같은 모양이다).
--   회사 판정은 원래 tasks_read가 하던 일이고, 헬퍼는 그 판정에 필요한 값 하나만 건넨다.
--
-- 기존 정책을 기억으로 다시 쓰지 않는다
--   2절의 tasks_read는 **0026:277-290의 본문을 파일에서 그대로 복사**했고, 그중
--   exists 블록 한 덩어리만 헬퍼 호출로 바꿨다. 가시성 그룹 네 줄은 한 글자도 건드리지
--   않았다. 3절의 가시성 식도 0026:283-289(tasks)와 **같은 모양**을 쓴다 — 표 이름과
--   기본키 칸만 다르다. 새 규칙을 지어내지 않는다.
--
-- audit_action enum에 새 값을 만들지 않는다 (55P04 — 0022가 production에서 겪었다).
--   이 파일은 어휘를 건드리지 않는다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. projects의 force를 내린다
--
--    0002:194가 걸었고 0003:595가 시드 뒤에 다시 걸었다. 여기서 내린다.
--
--    왜 — 0023 3절 ③과 6절이 같은 판정을 **실험으로** 확인해 두었다. FORCE는 표 소유자까지
--    정책 아래로 끌어내린다. security definer 함수는 그 소유자 권한으로 돌기 때문에,
--    소유자가 BYPASSRLS가 아니면(Supabase의 postgres가 그렇다) definer가 **조용히 0행**을
--    받는다. 2절의 헬퍼가 정확히 그 함정 위에 서 있다 — 내리지 않으면 헬퍼는 production에서만
--    null을 주고, PGlite harness는 superuser라 그 함정을 **통과시킨다**(검사가 초록인 채
--    production만 깨지는 최악의 모양이다. 0026 2-2절 ①이 그래서 이 길을 피했다).
--
--    **표가 열리는 것이 아니다.** enable은 그대로고 정책도 그대로라, 이 표를 읽는 실제 경로
--    (앱은 PostgREST로 authenticated 역할로만 붙는다 — 0002 원칙 6)는 여전히 3절의 정책을
--    한 줄도 빠짐없이 탄다. FORCE가 바꾸는 것은 '표 소유자도 정책을 받는가' 하나뿐이고,
--    이 저장소에서 그 자리의 실제 자물쇠는 revoke다(0023 3절 ①).
--
--    반대로 FORCE가 여기서 더해 주는 보안은 없고, 더하는 것은 침묵 실패 위험뿐이다.
--    scripts/check-migrations.ts가 구조 단언으로 이 상태를 지킨다 — 누가 되살리면 빨개진다.
--
--    0002·0003 파일은 건드리지 않는다. 이미 staging·production에 적용됐고, 적용된
--    마이그레이션을 고치면 체크섬이 드리프트된다(OPERATIONS 9, 0022가 겪은 일).
--    그래서 앞으로 나아가며 고친다 — 0023 6절이 0019의 force를 내린 것과 같은 방식이다.
-- ---------------------------------------------------------------------
alter table public.projects no force row level security;

-- ---------------------------------------------------------------------
-- 2. project_business_id() — 업무가 자기 회사를 되찾는 문
--
--    **이 함수가 내주는 것은 business_id 하나다.** 프로젝트의 내용(이름·담당자·진행률·
--    마감일·상태)은 한 칸도 나가지 않는다. 즉 "그 프로젝트를 볼 수 있는가"와
--    "그 프로젝트가 어느 회사 것인가"를 여기서 갈라 놓는다 — 뒤엣것만 내주는 문이다.
--    다음 사람이 이 함수에 칸을 하나 더 붙이고 싶어지면, 그 순간 이것은 문이 아니라
--    projects_read를 우회하는 창이 된다. 붙이지 마라. 필요하면 새 함수를 만들고
--    그 함수가 무엇을 왜 내주는지를 여기처럼 적어라.
--
--    왜 stable인가 — projects.business_id는 한 트랜잭션 안에서 변하지 않는다.
--    정책 식은 행마다 평가되므로 플래너가 같은 project_id에 대해 재사용할 수 있어야 한다.
--
--    반환이 null인 경우는 '그런 project_id가 없다'뿐이다(business_id는 0001:207에서
--    not null이다). tasks.project_id는 not null + FK(on delete cascade)라 업무가 가리키는
--    프로젝트는 언제나 존재한다 — 즉 아래 tasks_read에서 이 함수는 null을 내지 않는다.
--    혹시 그런 날이 오면 has_business(null)이 전사 역할만 통과시키고(0002:120) 나머지는
--    거부한다. 원래의 exists가 그 경우 false였던 것과 전사 역할에서만 갈리는데,
--    전사 역할은 어차피 모든 회사를 보므로 넓어지는 것이 없다.
-- ---------------------------------------------------------------------
create or replace function project_business_id(p_project_id text) returns text
language sql stable security definer set search_path = public as $fn$
  select business_id from projects where project_id = p_project_id;
$fn$;

comment on function project_business_id(text) is
  '0027. 이 프로젝트가 어느 회사 것인가. **business_id 하나만 내준다** — 이름·담당자·진행률은 반환 목록에 없다(keyhole). tasks_read가 업무의 회사를 판정할 때 projects의 RLS를 타지 않게 하려고 definer로 둔다: 그러지 않으면 projects에 subtree 겹을 얹는 순간 직원 자신의 업무가 0건이 된다.';

revoke all on function project_business_id(text) from public;
grant execute on function project_business_id(text) to authenticated;

-- 2-1. tasks_read 재정의 — 0026:277-290을 파일에서 그대로 복사하고 exists 한 덩어리만 바꿨다.
--
--   바뀐 것:
--     exists (select 1 from projects p
--              where p.project_id = tasks.project_id and has_business(p.business_id))
--   →  has_business(project_business_id(tasks.project_id))
--
--   **뜻은 그대로다.** 둘 다 "이 업무가 매달린 프로젝트의 회사를 내가 보는가"를 묻는다.
--   다른 것은 그 프로젝트를 **어떤 눈으로 찾는가**뿐이다 — 앞엣것은 호출자의 눈(정책을
--   탄다), 뒤엣것은 definer의 눈(회사 칸만 본다). 3절이 projects를 좁히기 때문에 앞엣것은
--   오늘부터 회사 판정이 아니라 가시성 판정이 된다.
--
--   가시성 그룹 네 줄(담당자 본인 · subtree · 공유 · 주인 없음)은 한 글자도 건드리지 않았다.
--   여기서 얹혀 있는 것은 tasks의 담당자이지 프로젝트의 담당자가 아니다 — 프로젝트가 내
--   subtree 밖이어도 그 안의 내 업무는 보인다(팀을 가로지르는 프로젝트가 정상이다).
--   **3절이 projects를 좁힌 뒤에도 이 성질이 살아 있는 것이 이 파일의 목적 전부다.**
--   scripts/check-migrations.ts의 subtreeRls()가 그 자리를 회귀 단언으로 지킨다.
drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks
  for select using (
    has_business(project_business_id(tasks.project_id))
    and (
      owner_user_id = auth.uid()
      or in_my_subtree(owner_user_id)
      or shared_with_me('tasks', task_id)
      or owner_unknown(owner_user_id)
    )
  );

comment on policy tasks_read on tasks is
  '0027. 회사 판정을 project_business_id() definer로 옮긴 것 말고는 0026과 같다. 정책 식 안의 subquery는 그 표의 RLS를 타므로, projects에 subtree 겹이 걸린 뒤에 exists를 그대로 두면 이 정책이 "프로젝트가 보이는가"를 묻게 되어 직원 자신의 업무가 사라진다.';

-- ---------------------------------------------------------------------
-- 3. projects — 이제 겹을 얹는다. (A) AND.
--
--    기존 식(0002:270을 그대로 복사):
--      has_business(business_id)
--    얹은 것: 0026이 나머지 여섯 표에 쓴 것과 **같은 가시성 식**이다. tasks(0026:283-289)와
--    나란히 놓고 읽으면 표 이름과 기본키 칸만 다르다.
--
--    소유자 칸 — projects.owner_user_id 하나뿐이다(0001:209). documents처럼 '주인'과
--    '등록자'가 갈리지 않는다(0007:31이 그 둘을 나눈 표는 documents다). 그래서 이 표에서는
--    owner_user_id 한 칸이 곧 소유자다.
--
--    소유자가 없는 행은 0026과 **같은 규칙**으로 다룬다 — owner_unknown(owner_user_id).
--    null이거나 user_profiles에 행이 없으면 subtree 조건을 적용하지 않고 회사 공통으로
--    읽는다. 여기에 `owner_user_id is null`만 쓰면 안 된다: 0003_seed의 projects 담당자
--    칸은 비어 있지 않고 gen-seed-sql.ts가 접어 만든 가상 uuid가 박혀 있으며, 그 uuid는
--    auth.users에 없어 프로필 행을 만들 수조차 없다(0026 1-1절이 이 함수를 만든 이유다).
--    null만 보면 **적용 당일** 프로젝트 목록이 통째로 빈다.
--
--    회사 격리는 그대로 앞에 선다. 소유자가 본인이어도 남의 회사 프로젝트는 여전히
--    존재하지 않는 것처럼 보인다 — AND의 순서가 그것을 말한다.
--
--    projects_write는 건드리지 않는다. 0026 2절의 판단 그대로다: 다섯 번째 겹은 '본다'에
--    대한 것이고, 읽기를 좁히면 UPDATE/DELETE가 고칠 행을 고를 때 select 정책이 같이
--    걸리므로 쓰기도 따라 좁아진다. 한쪽만 고치는 편이 대조하기 쉽다.
--
--    0026 2-2절이 "나중에 치르기로 하는 날 이 자리에 그대로 들어가면 된다"고 적어 둔
--    shared_with_me('projects', …)가 바로 여기다. 0026 3절의 shares_insert_visible도
--    'projects' 분기를 이미 들고 있어서(0026:412) 이 날을 기다리고 있었다 — 그 분기는
--    대상 표를 exists로 읽는 것이 곧 판정이라, 오늘부터 "볼 수 있는 프로젝트만 공유할 수
--    있다"가 저절로 성립한다. 한 줄도 고치지 않는다.
-- ---------------------------------------------------------------------
drop policy if exists projects_read on projects;
create policy projects_read on projects
  for select using (
    has_business(business_id)
    and (
      owner_user_id = auth.uid()
      or in_my_subtree(owner_user_id)
      or shared_with_me('projects', project_id)
      or owner_unknown(owner_user_id)
    )
  );

comment on policy projects_read on projects is
  '0027. 0026이 여섯 표에 얹은 다섯 번째 겹을 projects에도 얹는다. 회사 격리(0002:270)를 그대로 앞에 두고 subtree·공유·주인없음을 AND로 좁힌다. 이 정책이 서려면 tasks_read의 회사 판정이 먼저 project_business_id()로 옮겨져 있어야 한다(2절) — 그러지 않으면 직원 자신의 업무가 사라진다.';

commit;

-- 확인:
--   select relforcerowsecurity from pg_class where relname = 'projects';  -- false여야 한다
--   select project_business_id('prj_002');                               -- 'biz_dy'
--   select polname, pg_get_expr(polqual, polrelid) from pg_policy p
--     join pg_class c on c.oid = p.polrelid
--    where c.relname in ('projects', 'tasks') and polname like '%_read';
--   -- 영업 직원 세션에서: select count(*) from tasks;   -- 자기 업무가 0이 아니어야 한다
