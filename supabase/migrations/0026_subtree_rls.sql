-- =====================================================================
-- Chairman OS — 0026_subtree_rls
-- 출처: Phase 6-1 블록 A2 "위계 + 조직 + 초대 위임"
--       (docs/superpowers/specs/2026-09-20-incoming.md, 2026-09-21 접수)
-- 작성: Phase 6-1 A2 (2026-09-21)
--
-- 무엇이 없어서 만드나
--   0025가 다섯 번째 겹의 **재료**를 놓았다 — reports_to · teams · shares ·
--   in_my_subtree() · shared_with_me() · 'Public'. 그런데 그 재료는 아직 아무것도 막지
--   않는다. 0025는 기존 정책을 한 줄도 건드리지 않았고(그 파일 머리 주석의 명시적 판단),
--   그래서 지금도 같은 회사·같은 모듈을 여는 사람끼리는 서로의 업무·문서·결정이 그대로
--   보인다. 이 파일이 그 재료를 실제로 문에 건다.
--
--   회장 지시 원문: "누구든 자기 subtree만 본다. 회사·팀·역할·등급 4겹은 그대로 AND."
--
-- 이 파일의 다섯 부분
--   0절  백필 — 정책을 뒤집기 전에 트리를 세운다. **순서가 곧 안전이다.**
--   1절  헬퍼 둘 — owner_unknown() · role_rank()
--   2절  일곱 표의 읽기 정책에 다섯 번째 겹
--   3절  shares의 insert를 연다 — "볼 수 있는 것만 공유할 수 있다" (0025의 인계 지점)
--   4절  초대 위임 — 자기 subtree로 부른다, Executive 이상은 회장 결재
--   5절  승계 — 팀장이 나가면 그 아래가 위로 붙는다
--
-- 기존 정책을 기억으로 다시 쓰지 않는다
--   이 파일에서 가장 쉽게 나는 사고다. 일곱 표의 using 식에는 회사 격리·역할·보안등급이
--   이미 들어 있고, 그것을 새로 타이핑하면 어느 분기를 조용히 잃거나 넓히게 된다 —
--   0024가 0015의 정책을 복원할 때 한 줄씩 대조해서 피한 사고다. 그래서 아래 2절의
--   모든 정책은 **원본 파일의 줄을 그대로 복사해 놓고** 그 위에 한 겹을 얹는다.
--   각 절의 주석에 복사해 온 자리(파일:줄)를 적어 두었다. 다음 사람이 대조할 수 있어야 한다.
--
-- 42P17 (infinite recursion) — 만나면 정책을 느슨하게 하지 마라
--   in_my_subtree()가 user_profiles의 정책 안으로 들어간다. "정책이 함수를 부르고 →
--   함수가 그 표를 읽고 → 다시 정책이 돈다"는 고리가 생길 자리인데, 0025가 그 함수를
--   security definer로 만들고 user_profiles·shares에 force row level security를 걸지
--   않는 것으로 고리를 미리 끊어 두었다(0025 4절·5절, 0023 3절 ③). 그 둘 중 하나라도
--   무너지면 여기서 42P17이 나거나 공유 겹이 조용히 사라진다.
--   **force를 새로 걸지 마라.** scripts/check-migrations.ts가 구조 단언으로 지킨다.
--
-- service_role은 이 프로젝트에 없다
--   야간 Job도 AIAgent 세션으로 RLS 안에서 돈다(CLAUDE.md). 이 파일은 RLS를 우회하는
--   경로를 새로 만들지 않는다. security definer 함수 넷을 더하지만 전부
--   set search_path = public · revoke all from public 뒤에 필요한 곳에만 다시 준다.
--
-- '오늘'은 언제나 KST다 — (now() at time zone 'Asia/Seoul')::date. current_date(서버 UTC)를
--   쓰지 않는다(0019 3절·0023 5절·0025 3절과 같다).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 백필 — 정책을 뒤집기 전에 트리를 세운다
--
--    **이 절이 2절보다 먼저 도는 것이 이 파일의 유일한 안전장치다.**
--    0025가 적용된 직후 reports_to는 전원 null이다(새 칸이라 채울 값이 없다). 그 상태의
--    in_my_subtree()는 누구에게든 자기 자신 하나만 준다 — 회장도 마찬가지다. 그대로 2절을
--    적용하면 모든 화면이 통째로 빈다. 0025의 보고가 이 자리를 미결로 넘겼다.
--
--    회장 판정: **활성 사용자 중 reports_to가 null이고 Chairman이 아닌 사람은 전부 Chairman
--    아래로 붙인다(평평한 트리).** 오늘의 조직이 실제로 그렇고, 그래야 정책을 뒤집는 순간
--    회장 화면이 그대로 산다. 진짜 계층 — 누가 어느 팀장 밑인가 — 은 블록 B의 조직도에서
--    사람이 세운다. 마이그레이션이 지어낸 조직도는 틀렸다는 것조차 아무도 모르는 채로 굳는다.
--
--    회장이 하나가 아닐 때 (둘 이상 / 하나도 없음)
--      **아무것도 하지 않는다.** 둘 이상이면 어느 쪽 밑에 붙일지 이 파일이 정할 수 없고,
--      하나도 없으면 붙일 자리가 없다. 그 경우 2절이 걸리는 순간 사람들은 자기 것만 보게
--      된다 — 화면이 비는 것이지 새는 것이 아니다(안전한 쪽으로 실패한다). 대신 warning을
--      남기고, scripts/check-migrations.ts가 이 두 갈래를 각각 단언으로 잡는다.
--      **적용 직후 이 warning이 로그에 보이면 조직도(블록 B)로 트리를 먼저 세워야 한다.**
--
--    회수·퇴사자는 건드리지 않는다. 그 사람들의 reports_to를 지금 회장 밑으로 옮기면
--    '나갈 때 누구 밑이었나'가 지워진다 — 5절의 승계가 남긴 기록과도 어긋난다.
--    대신 회장은 user_profiles 정책의 기존 Chairman 분기(2-1절)로 그들을 계속 본다.
--
--    이 update는 user_profiles_no_cycle 트리거(0025 3절)를 그대로 탄다. 붙이는 자리가
--    뿌리(reports_to is null인 Chairman)라 고리가 생길 수 없다.
-- ---------------------------------------------------------------------
do $backfill$
declare
  root      uuid;
  chairmen  int;
  attached  int;
begin
  select count(*) into chairmen
    from user_profiles
   where role = 'Chairman' and revoked_at is null and status = 'active';

  if chairmen <> 1 then
    raise warning
      '0026 백필을 건너뛴다: 활성 Chairman이 %명이다. reports_to가 null인 사람은 자기 것만 보게 된다 — 조직도(블록 B)로 트리를 세워야 한다.',
      chairmen;
    return;
  end if;

  select user_id into root
    from user_profiles
   where role = 'Chairman' and revoked_at is null and status = 'active'
   limit 1;

  update user_profiles
     set reports_to = root
   where reports_to is null
     and user_id <> root
     and role <> 'Chairman'
     and revoked_at is null
     and status = 'active';
  get diagnostics attached = row_count;

  raise notice '0026 백필: %명을 회장(%) 아래 평평하게 붙였다. 진짜 계층은 조직도에서 세운다.', attached, root;
end;
$backfill$;

-- ---------------------------------------------------------------------
-- 1. 헬퍼 둘
--
-- 1-1. owner_unknown(uuid) — "이 소유자는 우리 조직 사람이 아니다"
--
--    A2 브리프의 판정: **owner가 null인 행에는 subtree 조건을 적용하지 않는다.** 시드로
--    들어온 행과 시스템이 만든 행은 소유자가 없고, 그것들을 subtree로 묶으면 회장 말고는
--    아무에게도 안 보이게 되어 화면이 통째로 빈다. 소유자가 없다는 것은 '회사 공통'이라는
--    뜻으로 읽고 기존 회사·등급 조건만으로 판정한다.
--
--    그런데 이 저장소에서 그 판정을 `owner is null`로만 쓰면 절반만 맞는다.
--    **0003_seed의 projects·tasks는 소유자 칸이 비어 있지 않다.** gen-seed-sql.ts가
--    'user_001' 같은 문자열을 접어 만든 uuid가 박혀 있고, 그 uuid는 auth.users에 없어서
--    user_profiles 행을 만들 수조차 없다(FK). 화면은 이미 그것을 '미지정'으로 그린다
--    (src/lib/repository/supabase.ts의 UNKNOWN_OWNER 주석 1·2번). 즉 **null이 아니지만
--    주인이 없는 행**이 이미 production에 있고, 그 행들이 CH-017 '내 결정 대기' 패널을
--    채운다. `owner is null`만 보면 그 패널이 적용 당일 빈다.
--
--    그래서 '소유자 없음'을 한 함수로 좁혀 둔다: null이거나, 그 uuid를 가진 user_profiles
--    행이 없거나. 둘 다 "이 행의 주인은 우리 조직 안에 없다"는 같은 사실이다.
--
--    security definer인 이유는 in_my_subtree()와 같다 — 정책 안에서 user_profiles를 다시
--    RLS로 막지 않는다. user_profiles에 force가 없어야 이것이 성립한다(0025 4절).
--
--    한계 하나를 적어 둔다. 계정을 **하드 삭제**하면(auth.users 삭제 → user_profiles
--    cascade) 그 사람이 남긴 행이 회사 공통으로 넓어진다. 이 저장소의 퇴사 경로는 삭제가
--    아니라 revoked_at·status다(0002 원칙 8, 0025 3절) — 회수된 사람의 프로필 행은 남으므로
--    그 행들은 계속 그 사람 것이다. 하드 삭제는 사람이 SQL로 직접 하는 일이고, 그때 이
--    넓어짐이 따라온다는 것을 여기 적어 둔다.
-- ---------------------------------------------------------------------
create or replace function owner_unknown(target uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select target is null
      or not exists (select 1 from user_profiles where user_id = target);
$fn$;

comment on function owner_unknown(uuid) is
  '0026. 이 소유자가 우리 조직 밖인가(null이거나 user_profiles에 행이 없다). 그런 행은 subtree로 묶지 않고 회사 공통으로 읽는다 — 0003 시드의 projects/tasks 담당자가 실제로 그런 uuid다(auth.users에 없어 프로필을 만들 수조차 없다).';

revoke all on function owner_unknown(uuid) from public;
grant execute on function owner_unknown(uuid) to authenticated;

-- 1-2. role_rank(app_role) — 역할의 높이
--
--    "역할이 Executive 이상이면 회장 결재"를 판정하려면 역할에 순서가 있어야 하는데
--    app_role enum의 선언 순서에 기대면 안 된다 — 0015가 'Integration'을 뒤에 붙였고
--    앞으로도 붙는다. 값을 명시한다.
--
--    시스템 역할(ExternalExpert·Vendor·AIAgent·Integration)은 -1이다. 사람의 위계에
--    들어가지 않는 계정이라 '누구보다 높다'는 질문 자체가 성립하지 않고, 0으로 두면
--    Member와 같은 높이가 되어 언젠가 '이상' 비교에 섞여 든다.
--
--    r::text로 비교하는 것은 0015 is_integration()·0025 class_rank()와 같은 이유다.
--    새 enum 값이 같은 트랜잭션에서 리터럴로 쓰이면 55P04로 터진다(0022가 production에서
--    실제로 겪었다). 이 파일은 enum 값을 더하지 않지만 관례를 깨지 않는다.
--
--    immutable이다 — 입력이 같으면 답이 같다. 4절의 트리거와 정책이 문장마다 부른다.
create or replace function role_rank(r app_role) returns int
language sql immutable as $fn$
  select case r::text
    when 'Chairman'    then 5
    when 'GroupCFO'    then 4
    when 'BusinessCEO' then 3
    when 'Executive'   then 2
    when 'TeamLead'    then 1
    when 'Member'      then 0
    else -1                       -- ExternalExpert · Vendor · AIAgent · Integration
  end;
$fn$;

comment on function role_rank(app_role) is
  '0026. 역할의 높이. Executive 이상(>= 2)이면 초대에 회장 결재가 붙는다. enum 선언 순서에 기대지 않는다 — 0015가 Integration을 뒤에 붙였고 앞으로도 붙는다. 시스템 역할은 -1이다(사람의 위계에 들어가지 않는다).';

-- ---------------------------------------------------------------------
-- 2. 다섯 번째 겹 — 일곱 표의 읽기 정책
--
--    얹는 모양은 표마다 둘 중 하나다. **어느 쪽인지가 이 절에서 가장 중요하다.**
--
--    (A) AND — 기존 식이 '같은 회사면 전부'인 표(projects·tasks·decisions·documents).
--        subtree는 그 위에서 **좁히는** 한 겹이다. 기존 식을 괄호째 그대로 두고
--        `and (가시성 식)`을 붙인다.
--
--    (B) OR — 기존 식이 이미 '본인 것만'인 표(user_profiles·audit_log·user_invitations).
--        여기서 AND를 하면 아무것도 바뀌지 않는다(본인 것은 이미 본인 subtree 안이다).
--        회장 지시의 검증 a "영업팀장 조직도 = 영업팀 4명"은 **넓히지 않으면 성립하지
--        않는다** — 위임이란 아래를 보게 하는 일이다. 원문의 재작성 문장
--        ("본인 OR in_my_subtree(owner) OR shares에 있음 OR (같은 회사 AND 공개)")도
--        OR이다. 넓히는 방향은 **아래로만**이다. 옆과 위는 여전히 존재도 보이지 않는다.
--
--    쓰기 정책은 건드리지 않는다. 회장 지시의 다섯 번째 겹은 '본다'에 대한 것이고,
--    쓰기는 이미 더 좁다(tasks_write는 담당자·승인권자, documents_*는 can_module).
--    읽기를 좁히면 쓰기도 따라 좁아진다 — UPDATE/DELETE가 고칠 행을 고를 때 select
--    정책이 같이 걸리기 때문이다. 한쪽만 고치는 편이 대조하기 쉽다.
--
--    성능 한 줄: in_my_subtree()는 행마다 재귀 CTE를 돈다. 0025가 만든
--    user_profiles_by_reports_to 인덱스가 그 비용의 바닥을 잡고, 대상 표들(업무·문서·
--    결정·프로젝트)은 수백 행 규모다. 재무 표(수만 행)에 이 겹을 걸지 않는 이유이기도 하다.
-- ---------------------------------------------------------------------

-- 2-1. user_profiles — (B) OR. 조직도가 서는 자리다.
--
--   기존 식(0002:207-208을 그대로 복사):
--     user_id = auth.uid() or auth_role() = 'Chairman'
--   얹은 것: or in_my_subtree(user_id)
--
--   Chairman 분기를 지우지 않는다. A2 브리프는 "별도 예외를 만들지 마라"고 하는데 —
--   그것은 **새 예외를 만들지 말라**는 말이고, 이 분기는 0002가 2026-09-05부터 들고 있던
--   기존 식이다. 지우는 것이야말로 정책을 기억으로 다시 쓰는 일이다. 남겨 두는 값도 있다:
--   0절의 백필이 건너뛰었거나(회장이 둘 이상) 트리가 끊긴 날에도 회장의 사람 목록은 살아
--   있어서, '조직도가 비었다'가 아니라 '이 사람의 상사가 비었다'로 보인다 — 고칠 수 있는
--   화면이 남는다.
--
--   회사 격리를 새로 더하지 않는다. 0002가 이 표에 has_business()를 걸지 않았고, subtree는
--   '누가 내 밑인가'이지 '어느 회사인가'가 아니다. 없던 조건을 이 파일이 지어내지 않는다.
drop policy if exists user_profiles_self_read on user_profiles;
create policy user_profiles_self_read on user_profiles
  for select using (
    user_id = auth.uid() or auth_role() = 'Chairman'
    or in_my_subtree(user_id)
  );

-- 2-2. projects — **이 표에는 겹을 얹지 않는다.** 기존 식(0002:270)을 그대로 둔다.
--
--    회장 지시 원문은 재작성 대상 일곱에 projects를 넣었다. 그런데 이 스키마에서 그것을
--    하면 **업무 화면이 통째로 빈다.** 실험으로 확인했고(PGlite, 아래 재현 경로),
--    scripts/check-migrations.ts의 subtreeRls() b가 그 자리를 계속 지킨다.
--
--    왜 그런가 — tasks는 회사를 직접 들고 있지 않다
--      0002:275-281의 tasks_read는 회사를 projects를 거쳐 판정한다:
--        exists (select 1 from projects p where p.project_id = tasks.project_id
--                                          and has_business(p.business_id))
--      정책 식 안의 subquery도 그 표의 RLS를 그대로 탄다. 그래서 projects_read를 좁히는
--      순간 이 exists는 "회사가 같은가"가 아니라 "그 프로젝트가 나에게 **보이는가**"가
--      된다. 팀장이 만든 프로젝트 안에 있는 **직원 자신의 업무**가 사라진다 —
--      프로젝트가 안 보이니 그 안의 업무도 없는 것이 된다.
--
--    왜 우회할 수 없는가 (막다른 길 셋을 다 밟아 보고 적는다)
--      ① security definer 헬퍼로 projects를 읽는다 → **안 된다.** projects에는 0002:194가
--         force row level security를 걸어 두었고, FORCE는 표 소유자까지 정책 아래로
--         끌어내린다. Supabase의 소유자(postgres)는 BYPASSRLS가 아니다(0023 3절 ③에서
--         실제로 겪었다). 즉 definer로 감싸도 같은 필터를 탄다. 게다가 PGlite harness는
--         superuser라 이 함정을 **통과시킨다** — 검사가 초록인 채 production만 깨진다.
--      ② projects_read에 "내 업무가 이 프로젝트에 있다" 분기를 더한다 → **안 된다.**
--         projects_read가 tasks를 읽고 tasks_read가 projects를 읽어 42P17이다.
--      ③ tasks에 business_id를 비정규화한다 → 가능은 하다. 다만 백필과 동기화 트리거가
--         둘 다 projects를 읽어야 하고, 그 읽기가 다시 ①의 FORCE 함정에 걸려 0003_seed가
--         쓴 'no force → 넣고 → force' 춤을 마이그레이션마다 추게 된다. 컨테이너 표
--         하나의 **이름**을 가리자고 치르기에는 비싼 값이고, 틀렸을 때 조용히 틀린다.
--
--    그래서 A1이 teams에서 내린 것과 같은 판단을 한다(0025 2절): **뼈대는 비밀이 아니다.**
--    다섯 번째 겹이 자르는 것은 '사람과 그 사람의 일'이고, 그 일이 매달릴 컨테이너까지
--    감추면 화면은 빈 상자가 된다. 회사 격리(has_business)는 그대로라 남의 회사 프로젝트는
--    여전히 존재하지 않는 것처럼 보인다. 회장 지시의 검증 a~f 어디에도 '프로젝트 목록이
--    잘린다'는 항목은 없다(있는 것은 사람·업무·문서·결재·초대다).
--
--    shared_with_me('projects', …)는 A1이 이미 만들어 두었다. 나중에 ③을 치르기로 하는
--    날 이 자리에 그대로 들어가면 된다.

-- 2-3. tasks — (A) AND.
--   기존 식(0002:275-281을 그대로 복사). 위 2-2의 이유로 이 exists는 지금도 순수한
--   회사 판정이다 — projects_read가 has_business() 하나뿐이기 때문이다.
--   **이 둘은 한 몸이다. 2-2를 좁히는 사람은 여기가 같이 좁아진다는 것을 알고 해야 한다.**
--
--   여기서 얹는 것은 tasks의 담당자이지 프로젝트의 담당자가 아니다. 프로젝트가 내
--   subtree 밖이어도 그 안의 내 업무는 보인다(팀을 가로지르는 프로젝트가 정상이다).
drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks
  for select using (
    exists (
      select 1 from projects p
       where p.project_id = tasks.project_id and has_business(p.business_id)
    )
    and (
      owner_user_id = auth.uid()
      or in_my_subtree(owner_user_id)
      or shared_with_me('tasks', task_id)
      or owner_unknown(owner_user_id)
    )
  );

-- 2-4. decisions — (A) AND. **소유자 칸을 하나 더한다.**
--
--   0001의 decisions에는 소유자가 없다. 있는 것은 decided_by(처리자)뿐이고 그것은
--   '누가 승인을 눌렀나'이지 '누구의 결재인가'가 아니다. decided_by만으로 겹을 얹으면
--   두 가지가 동시에 틀어진다.
--     ① 올라와 있는 결재는 전부 decided_by가 null이라 영원히 회사 공통이다 — 겹이 없다.
--     ② 처리되는 순간 그 결재가 처리자의 subtree 밖 사람들에게서 사라진다 — 어제까지
--        보이던 것이 승인 한 번에 없어진다.
--   그래서 기안자 칸을 만든다. 기존 행은 전부 null이라 ①의 '회사 공통'이 그대로 유지되고
--   (오늘 화면이 하나도 변하지 않는다), 오늘 이후의 기안부터 주인이 생긴다.
--   값은 src/lib/repository/supabase.ts의 createDecision()이 넣는다.
--
--   기존 식(0002:297을 그대로 복사): has_business(business_id)
alter table decisions
  add column if not exists created_by uuid references auth.users(id);   -- [제한] 기안자

comment on column decisions.created_by is
  'CH-041 기안자. decided_by(처리자)와 다른 사실이다 — 올린 사람과 누른 사람은 대개 다르다. 0026의 다섯 번째 겹이 이 칸을 본다. 0026 이전 행은 null이고 그대로 회사 공통으로 읽힌다.';

create index if not exists decisions_by_creator on decisions (created_by);

drop policy if exists decisions_read on decisions;
create policy decisions_read on decisions
  for select using (
    has_business(business_id)
    and (
      created_by = auth.uid()
      or decided_by = auth.uid()
      or in_my_subtree(created_by)
      or in_my_subtree(decided_by)
      -- 소유자 칸이 **둘 다** 비어 있을 때만 회사 공통이다. 하나라도 주인이 있으면
      -- 그 주인으로 판정한다 — 한 칸만 보고 넘기면 '아직 처리 전'이라는 이유로
      -- 남의 결재가 전사에 열린다.
      or (owner_unknown(created_by) and owner_unknown(decided_by))
    )
  );

-- 2-5. documents — (A) AND. 공개 등급이 여기서 예외가 된다.
--
--   기존 식(0002:321-325를 그대로 복사):
--     has_business(business_id) and class_rank(security_class) <= class_rank(max_class())
--   0012는 documents_write만 쪼갰고 documents_read는 건드리지 않았다(0012:1-2 주석) —
--   즉 위 두 줄이 지금 production에서 도는 그대로다.
--
--   소유자 칸이 둘이다. 0007:31이 uploaded_by를 더하면서 그 이유를 적어 두었다 —
--   owner_user_id는 '문서의 주인'이고 uploaded_by는 '이 링크를 여기 등록한 사람'이라
--   비서가 회장 명의 계약서를 올리면 둘이 갈린다. 앱이 실제로 채우는 것은 uploaded_by
--   하나뿐이므로(createDocument), uploaded_by만 보면 겹이 거의 항상 비고 owner_user_id만
--   보면 겹이 아무것도 막지 못한다. **둘 다 본다.**
--
--   'Public' 분기(회장 지시: "공개 등급 공지 → 전 직원 보임")는 security_class 칸이 있는
--   이 표에만 붙는다. 같은 회사 조건은 위의 has_business()가 이미 AND로 걸고 있어서 여기서
--   다시 쓰지 않는다 — 두 번 쓰면 언젠가 한쪽만 고쳐진다.
--   ::text 비교는 0013·0015·0025의 관례다.
drop policy if exists documents_read on documents;
create policy documents_read on documents
  for select using (
    has_business(business_id)
    and class_rank(security_class) <= class_rank(max_class())
    and (
      owner_user_id = auth.uid()
      or uploaded_by = auth.uid()
      or in_my_subtree(owner_user_id)
      or in_my_subtree(uploaded_by)
      or shared_with_me('documents', document_id)
      or security_class::text = 'Public'
      or (owner_unknown(owner_user_id) and owner_unknown(uploaded_by))
    )
  );

-- 2-6. audit_log — (B) OR. **읽기만이다.**
--
--   기존 식(0002:339-342를 그대로 복사):
--     auth_role() = 'Chairman' or actor_user_id = auth.uid()
--   얹은 것: or in_my_subtree(actor_user_id)
--
--   append-only 장치는 한 줄도 건드리지 않는다 — audit_log_insert 정책(마지막 정의는
--   0024:30)도, 0001의 no_update/no_delete 트리거도, revoke도 그대로다. 감사 기록은
--   지우지도 고치지도 못한다.
--
--   여기에는 '소유자 없음' 분기를 만들지 않는다. actor_user_id가 null인 행은 시스템·Agent가
--   남긴 것이고 지금은 회장만 본다. 그것을 '회사 공통'으로 읽으면 이 파일이 감사 기록을
--   **넓히게 된다** — 다섯 번째 겹을 더하는 파일이 할 일이 아니다. 2절의 (A) 표들에서
--   owner_unknown()이 하는 일은 오늘의 가시성을 지키는 것이지 늘리는 것이 아니다.
drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log
  for select using (
    auth_role() = 'Chairman'
    or actor_user_id = auth.uid()
    or in_my_subtree(actor_user_id)
  );

-- ---------------------------------------------------------------------
-- 3. shares의 insert — "볼 수 있는 것만 공유할 수 있다"
--
--    0025가 의도적으로 남긴 인계 지점이다(0025 5절 마지막 문단). 그 파일은 permissive
--    insert 정책을 하나도 만들지 않아 문을 닫아 두었다. 공유를 만들 수 있는 사람은
--    "그 대상을 볼 수 있는 사람"인데, '볼 수 있다'의 정의가 바로 위 2절이기 때문이다.
--    이제 그 정의가 있으므로 문을 연다.
--
--    **판정을 다시 쓰지 않는다.** 대상 표를 exists로 한 번 읽는 것이 곧 판정이다 —
--    그 읽기에 2절의 정책이 그대로 걸린다. 여기에 가시성 식을 복사해 오면 언젠가 2절만
--    고쳐지고 이쪽이 남아, 못 보는 것을 공유할 수 있는 창이 열린다.
--
--    회사 격리는 받는 쪽에서 한 번 더 걸린다. 공유를 받아도 대상 표의 정책이 여전히
--    has_business()를 AND로 요구하므로, 남의 회사 사람에게 공유해도 그 사람에게는
--    그 행이 존재하지 않는다. 공유는 **회사 안에서 subtree를 가로지르는** 길이지
--    회사를 넘는 길이 아니다.
--
--    restrictive 둘(0025:425 shares_insert_is_self · shares_integration_no_write)은
--    그대로 남아 이 permissive 위에 AND로 걸린다 — 남의 이름으로 공유를 만들 수 없고,
--    ECOUNT 동기화 계정은 공유를 만들지 않는다.
-- ---------------------------------------------------------------------
create policy shares_insert_visible on shares
  as permissive for insert
  with check (
    is_active()
    and case entity_table
      when 'documents' then exists (select 1 from documents d where d.document_id = entity_id)
      when 'tasks'     then exists (select 1 from tasks     t where t.task_id     = entity_id)
      when 'projects'  then exists (select 1 from projects  p where p.project_id  = entity_id)
      else false
    end
  );

comment on policy shares_insert_visible on shares is
  '0026. 볼 수 있는 것만 공유할 수 있다. 대상 표를 exists로 읽는 것이 곧 판정이다 — 그 읽기에 0026 2절의 정책이 그대로 걸리므로 가시성 식을 여기 복사하지 않는다.';

-- ---------------------------------------------------------------------
-- 4. 초대 위임 — 자기 subtree로 부른다, Executive 이상은 회장 결재
--
--    지금 초대는 회장만 할 수 있다(0011:82 user_invitations_admin, for all Chairman).
--    회장 지시: "초대 범위 = 자기 subtree. 역할이 Executive 이상이면
--    chairman_approval_required=true → 회장 결재 큐."
--
--    0011의 정책은 **지우지 않는다.** permissive 정책은 OR로 합쳐지므로, 아래 두 정책을
--    더하는 것만으로 회장의 기존 경로는 한 글자도 바뀌지 않은 채 위임 경로가 열린다.
--    (0011의 정책을 재작성하면 그 for all 안의 update/delete 분기까지 다시 쓰게 된다.)
-- ---------------------------------------------------------------------

-- 4-1. 초대 행이 담아야 하는 것
--   reports_to  초대받는 사람이 들어갈 자리. 이것이 없으면 '자기 subtree로 부른다'를
--               판정할 수 없다(0011은 역할·등급·회사만 담았다).
--   team_id     블록 B의 초대 폼이 팀을 고른다. 계정이 생길 때 프로필로 그대로 옮긴다.
--   chairman_approved_at/by  결재 큐의 도장 자리. 0025가 놓은
--               chairman_approval_required가 '결재가 필요한가'라면 이 둘은 '결재가 됐는가'다.
alter table user_invitations
  add column if not exists reports_to           uuid references auth.users(id),   -- [제한]
  add column if not exists team_id              text references teams(team_id),   -- [일반]
  add column if not exists chairman_approved_at timestamptz,                      -- [일반]
  add column if not exists chairman_approved_by uuid references auth.users(id);   -- [제한]

comment on column user_invitations.reports_to is
  '초대받는 사람이 들어갈 자리(직속 상사). 위임 초대는 이 값이 초대자 자신이거나 초대자의 subtree 안이어야 한다 — 그것이 "초대 범위 = 자기 subtree"의 실체다. 회장의 초대는 비어 있을 수 있고, 그때는 초대자(회장)가 기본값이다.';
comment on column user_invitations.chairman_approved_at is
  '결재가 된 시각. chairman_approval_required가 true인데 이 칸이 비어 있으면 계정이 생겨도 권한이 붙지 않는다(4-3절).';

-- 4-2. chairman_approval_required는 **서버가 정한다**
--
--   클라이언트가 false로 보내도 덮어쓴다. 클라이언트가 정하게 두면 그것은 결재가 아니다.
--   그래서 정책(우회 가능한 자리가 아니다)이 아니라 트리거로 강제한다.
--
--   회장이 직접 넣은 초대는 그 자리에서 결재된 것으로 남긴다. '필요했는가'(required)와
--   '됐는가'(approved_at)를 둘 다 사실대로 적는 편이 required를 false로 눌러 두는 것보다
--   낫다 — 감사 기록에서 "이 사람은 결재 없이 들어왔다"와 "회장이 직접 불렀다"가 구분된다.
--   눌러 두면 0011부터 도는 회장 초대 화면이 자기 결재를 기다리며 한 단계 멈춘다.
--
--   update 가지는 방어선이다. 승인 칸을 고칠 수 있는 것은 0011의 Chairman 정책뿐이지만,
--   나중에 누가 update 정책을 넓히는 날 이 raise가 남는다.
create or replace function user_invitations_set_approval() returns trigger
language plpgsql set search_path = public as $fn$
begin
  -- 역할이 Executive 이상이면 회장 결재가 붙는다(role_rank >= 2).
  new.chairman_approval_required := role_rank(new.role) >= 2;

  if tg_op = 'INSERT' then
    if coalesce(auth_role()::text, '') = 'Chairman' then
      new.chairman_approved_at := coalesce(new.chairman_approved_at, now());
      new.chairman_approved_by := coalesce(new.chairman_approved_by, auth.uid());
    else
      -- 위임받은 초대자는 자기 초대에 스스로 도장을 찍지 못한다.
      new.chairman_approved_at := null;
      new.chairman_approved_by := null;
    end if;
  else
    if (new.chairman_approved_at is distinct from old.chairman_approved_at
        or new.chairman_approved_by is distinct from old.chairman_approved_by)
       and coalesce(auth_role()::text, '') <> 'Chairman' then
      raise exception '회장 승인 칸은 Chairman만 채울 수 있습니다 (초대 %)', new.invitation_id;
    end if;
    if new.chairman_approved_at is not null and new.chairman_approved_by is null then
      new.chairman_approved_by := auth.uid();
    end if;
  end if;

  return new;
end;
$fn$;

create trigger user_invitations_approval
  before insert or update on user_invitations
  for each row execute function user_invitations_set_approval();

-- 4-3. 이행 — 0011의 몸통을 함수 하나로 떼어 낸다
--
--   0011은 '계정이 생기는 순간' 한 방향으로만 이행했다(auth.users의 after insert 트리거).
--   결재 큐가 생기면 방향이 하나 더 필요하다 — **계정이 먼저 생기고 결재가 나중에 날 수
--   있다.** 그때 다시 이행해 줄 사람이 없으면 승인 버튼을 눌러도 아무 일이 안 일어나고,
--   그 사람은 '로그인은 되는데 아무것도 안 보이는' 계정이 된다(0011 머리 주석이 경계한 것).
--
--   그래서 몸통을 apply_user_invitation()으로 떼고 트리거 둘이 같은 몸통을 부른다.
--   0011이 지키던 성질 — "초대를 먼저 하든 계정을 먼저 만들든 결과가 같다" — 이 결재가
--   끼어들어도 그대로 성립한다.
--
--   grant를 주지 않는다. 이 함수가 RPC로 열려 있으면 결재를 건너뛰는 길이 된다.
--   부르는 것은 아래 두 트리거뿐이고, 둘 다 security definer라 소유자 권한으로 부른다.
--
--   reports_to의 기본값은 초대자다(coalesce(inv.reports_to, inv.invited_by)).
--   회장 지시 블록 B의 초대 폼이 "직속 상사(기본=초대자)"라고 적었고, 무엇보다 여기서
--   null을 그대로 넣으면 그 사람은 조직도 어디에도 매달리지 않아 회장 말고 아무에게도
--   안 보인다 — 0절의 백필이 막으려던 바로 그 상태를 새 사람마다 다시 만든다.
create or replace function apply_user_invitation(p_invitation uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  inv user_invitations;
  biz text;
begin
  select * into inv from user_invitations where invitation_id = p_invitation;
  if not found then return false; end if;
  if inv.accepted_at is not null or inv.revoked_at is not null then return false; end if;

  -- 회장 결재 큐. 승인 전에는 권한을 주지 않는다. 초대 행은 그대로 대기에 남는다 —
  -- 여기서 revoked_at을 채우면 승인이 난 뒤에 다시 부를 길이 없어진다.
  if inv.chairman_approval_required and inv.chairman_approved_at is null then
    return false;
  end if;

  insert into user_profiles (
    user_id, role, display_name, title_ko, max_security_class,
    reports_to, team_id, joined_on
  )
  values (
    p_user, inv.role, inv.display_name, inv.title_ko, inv.max_security_class,
    coalesce(inv.reports_to, inv.invited_by), inv.team_id,
    (now() at time zone 'Asia/Seoul')::date
  )
  on conflict (user_id) do update
    set role               = excluded.role,
        display_name       = excluded.display_name,
        title_ko           = excluded.title_ko,
        max_security_class = excluded.max_security_class,
        -- 이미 조직도에 자리가 있는 사람이면 그 자리를 초대장이 덮지 않는다.
        -- 블록 B에서 사람이 옮겨 둔 상사를 재초대 한 번이 되돌리면 안 된다.
        reports_to         = coalesce(user_profiles.reports_to, excluded.reports_to),
        team_id            = coalesce(user_profiles.team_id, excluded.team_id),
        status             = 'active',
        revoked_at         = null;

  foreach biz in array inv.business_ids loop
    insert into user_business_access (user_id, business_id, granted_by)
    values (p_user, biz, inv.invited_by)
    on conflict (user_id, business_id) do nothing;
  end loop;

  update user_invitations
     set accepted_at = now(), accepted_user_id = p_user
   where invitation_id = inv.invitation_id;

  return true;
end;
$fn$;

comment on function apply_user_invitation(uuid, uuid) is
  '0026. 초대 한 건을 실제 권한으로 옮긴다. 0011의 accept_user_invitation() 몸통을 떼어 낸 것이고, 결재가 필요한데 아직 안 났으면 아무것도 하지 않는다. RPC로 열지 않는다 — 열면 결재를 건너뛰는 길이 된다.';

revoke all on function apply_user_invitation(uuid, uuid) from public;

-- 계정이 먼저 생기는 방향. 0011:100의 함수를 같은 이름·같은 트리거로 다시 쓴다.
--   exception 블록을 그대로 유지한다 — 이 함수가 실패하면 auth.users INSERT가 통째로
--   롤백되고 그건 '회원가입 자체가 안 되는' 장애다(0011의 판단). 권한이 안 붙은 사람은
--   currentUser()가 null로 잘라 내므로 안전한 쪽으로 실패한다.
create or replace function accept_user_invitation()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  inv_id uuid;
begin
  if new.email is null then return new; end if;

  select invitation_id into inv_id
    from user_invitations
   where lower(email) = lower(new.email)
     and accepted_at is null
     and revoked_at is null
   order by invited_at desc
   limit 1;

  if not found then return new; end if;

  -- 결재 대기 중이면 여기서 false가 돌아오고 아무 일도 일어나지 않는다.
  -- 회장이 승인을 누르는 순간 아래 user_invitations_approved 트리거가 같은 몸통을 부른다.
  perform apply_user_invitation(inv_id, new.id);
  return new;
exception when others then
  -- 회원가입은 살린다. 권한만 안 붙는다.
  raise warning 'accept_user_invitation 실패 (%): %', new.email, sqlerrm;
  return new;
end;
$fn$;

comment on function accept_user_invitation is
  '계정이 생기는 순간 살아 있는 초대를 찾아 권한을 부여한다(0011). 0026부터 결재가 필요한 초대는 여기서 멈추고, 회장이 승인할 때 user_invitations_approved 트리거가 이어 받는다.';

-- 결재가 나중에 나는 방향. 0026이 더하는 두 번째 입구다.
create or replace function user_invitations_approved() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  target uuid;
begin
  -- 방금 도장이 찍힌 경우만. 이미 찍혀 있던 값을 다시 쓰는 update는 지나간다.
  if new.chairman_approved_at is null or old.chairman_approved_at is not null then
    return null;
  end if;
  if new.accepted_at is not null or new.revoked_at is not null then
    return null;
  end if;

  -- 계정이 아직 없으면 할 일이 없다. 나중에 계정이 생길 때 accept_user_invitation()이 한다.
  select id into target from auth.users where lower(email) = lower(new.email) limit 1;
  if not found then return null; end if;

  perform apply_user_invitation(new.invitation_id, target);
  return null;
end;
$fn$;

create trigger user_invitations_approved
  after update of chairman_approved_at on user_invitations
  for each row execute function user_invitations_approved();

-- 4-4. 위임 정책 둘
--
--   읽기: 초대자 본인 + 그 위 subtree. (회장은 0011의 정책이 이미 통과시킨다.)
--     in_my_subtree(invited_by)는 "그 초대자가 내 아래인가"다 — 즉 내가 그 사람 위일 때
--     그 사람의 초대가 보인다. 방향을 뒤집어 쓰면 아래가 위의 초대를 보게 된다.
create policy user_invitations_subtree_read on user_invitations
  as permissive for select
  using (
    is_active()
    and (invited_by = auth.uid() or in_my_subtree(invited_by))
  );

--   쓰기(insert): 자기 subtree 안으로만 부른다. 이 정책은 **위임 경로 전용**이다 —
--   회장은 0011의 for all 정책으로 들어오므로 여기에 Chairman 분기를 만들지 않는다.
--
--   뒤의 두 조건은 권한 상승을 막는 자리다. 위임은 '사람을 부르는 권한'이지 '자기보다
--   넓은 권한을 나눠 주는 권한'이 아니다(0002 원칙 2 Least Privilege).
--     · 등급: 자기 최고 등급보다 높은 등급을 줄 수 없다. 없으면 Normal 팀장이 Vault
--       계정을 만들 수 있고, 그건 초대 화면이 등급 상승 창구가 된다는 뜻이다.
--     · 회사: 자기가 못 보는 회사를 붙여 줄 수 없다. Business Isolation(원칙 3)이
--       초대장을 통해 새면 그 겹은 없는 것과 같다.
--   역할에는 상한을 두지 않는다 — 팀장이 Executive를 부르는 것이 회장 결재 큐가 존재하는
--   이유다(회장 지시 검증 d). 높은 역할은 막는 것이 아니라 결재로 올린다.
create policy user_invitations_delegated_insert on user_invitations
  as permissive for insert
  with check (
    is_active()
    and invited_by = auth.uid()
    and reports_to is not null
    and (reports_to = auth.uid() or in_my_subtree(reports_to))
    and class_rank(max_security_class) <= class_rank(max_class())
    and not exists (select 1 from unnest(business_ids) b where not has_business(b))
  );

-- 수정·취소(update/delete) 정책은 더하지 않는다. 지금처럼 회장만 고친다.
-- 블록 B의 '대기 초대 재발송·취소'가 초대자 본인에게도 필요하면 그때 정책 한 줄을
-- 더한다 — 이 파일이 쓰기를 미리 넓혀 두지 않는다.

-- ---------------------------------------------------------------------
-- 5. 승계 — 팀장이 나가면 그 아래가 위로 붙는다
--
--    회장 지시: "팀장 부재 시 상위 임원이 자동 승계(reports_to 체인)."
--    검증 f: "영업팀장 회수 → 임원이 영업팀 자동 승계."
--
--    두 가지를 같이 올린다. reports_to(누구에게 보고하나)와 teams.lead_user_id(팀장이
--    누구인가)는 다른 사실이라, 한쪽만 올리면 조직도가 '팀장은 나간 사람인데 보고선은
--    임원'이라는 모순된 그림을 그린다.
--
--    올릴 상사가 없으면(나가는 사람의 reports_to가 null) **아무것도 하지 않는다.**
--    아래 사람들의 reports_to를 null로 내리는 쪽이 더 나빠 보이기 쉽지만 —
--    null로 내리면 그 가지가 트리에서 통째로 떨어져 나가 회장 말고 아무에게도 안 보인다.
--    그대로 두면 조직도에 '상사가 나간 사람으로 남아 있음'이라는 경고로 뜬다(블록 B).
--    **트리를 끊는 것보다 화면에서 틀린 것이 보이는 편이 낫다** — 보이면 고칠 수 있다.
--
--    audit_log에는 permission_change로 남긴다. 새 enum 값을 만들지 않는다(0022의 55P04,
--    0025 5절과 같은 규칙). 공유는 delegate, 회수·승계는 permission_change다.
--
--    security definer인 이유: 이 트리거의 두 update가 조용히 0행이 되는 것이 가장 나쁜
--    결과다(조직도는 승계된 것처럼 보이는데 실제로는 아무것도 안 움직였다).
--    definer면 user_profiles 쪽은 소유자 권한으로 돌아 정책과 무관하게 전부 옮긴다
--    (그 표에 force가 없다 — 0025 4절). teams는 force가 걸려 있어 소유자도 정책 아래이고
--    (0025 2절), teams_write가 Chairman을 요구한다. 오늘 user_profiles를 고칠 수 있는
--    사람은 Chairman뿐이므로(0002 user_profiles_admin_write) 둘은 언제나 같이 움직인다.
--    **나중에 회수 권한을 넓히는 사람은 teams_write도 같이 봐야 한다.** 그래서 아래는
--    실제로 옮긴 행 수를 세어 기록에 적는다 — 0행이면 기록이 그렇게 말한다.
--
--    audit_log의 insert는 이 함수가 definer라도 정책을 탄다(그 표는 force다).
--    0024의 audit_log_insert는 is_active()와 역할별 분기를 보는데, 여기 도달하는 세션은
--    Chairman이라 else 분기로 통과한다.
--
--    재귀하지 않는다: 안쪽 update는 reports_to만 건드리고 이 트리거는
--    `after update of revoked_at, status`라 다시 불리지 않는다.
-- ---------------------------------------------------------------------
create or replace function user_profiles_succession() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  successor uuid;
  moved     int := 0;
  teams_led int := 0;
begin
  -- 지금 막 떠난 경우만. 이미 나간 사람을 다시 건드리는 update는 지나간다.
  if not (
    (new.revoked_at is not null and old.revoked_at is null)
    or (new.status = 'left' and old.status is distinct from 'left')
  ) then
    return null;
  end if;

  successor := new.reports_to;
  if successor is null then
    -- 올릴 자리가 없다. 위 주석의 판단 — 끊지 않고 그대로 둔다.
    return null;
  end if;

  update user_profiles
     set reports_to = successor
   where reports_to = new.user_id
     and user_id <> new.user_id;
  get diagnostics moved = row_count;

  update teams
     set lead_user_id = successor
   where lead_user_id = new.user_id;
  get diagnostics teams_led = row_count;

  if moved > 0 or teams_led > 0 then
    insert into audit_log (
      actor_user_id, actor_role, action, entity_table, entity_id, note, after
    ) values (
      auth.uid(), auth_role()::text, 'permission_change', 'user_profiles',
      new.user_id::text,
      format('상위 승계: 부하 %s명과 팀 %s개의 팀장 자리를 상위로 올렸다', moved, teams_led),
      jsonb_build_object(
        'successor', successor,
        'reports_moved', moved,
        'teams_moved', teams_led,
        'on', (now() at time zone 'Asia/Seoul')::date
      )
    );
  end if;

  return null;
end;
$fn$;

comment on function user_profiles_succession() is
  '0026. 사람이 나가면(revoked_at이 차거나 status가 left) 그 아래 사람들의 reports_to와 그 사람이 맡던 teams.lead_user_id를 그 사람의 상사로 올린다. 올릴 상사가 없으면 아무것도 하지 않는다 — 트리를 끊는 것보다 조직도에 경고로 남는 편이 낫다.';

create trigger user_profiles_succession
  after update of revoked_at, status on user_profiles
  for each row execute function user_profiles_succession();

commit;

-- 확인:
--   select display_name, role, reports_to, team_id, status from user_profiles order by role;
--   select count(*) from user_profiles where reports_to is null;   -- 회장 한 명이어야 정상
--   select polname, polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
--    where c.relname in ('user_profiles','tasks','decisions','documents','projects','user_invitations','audit_log','shares')
--    order by c.relname, polname;
--   select role_rank('Executive'::app_role), role_rank('Member'::app_role), role_rank('AIAgent'::app_role);
