-- =====================================================================
-- Chairman OS — 0028_org_screen
-- 출처: Phase 6-1 블록 B·C (화면) + 컨트롤러 판정 2026-09-21 "회사 진행률"
-- 작성: Phase 6-1 블록 B·C (2026-09-21)
--
-- 무엇이 없어서 만드나
--   0025~0027이 위계·공유·subtree를 다 놓았다. 그 위에 화면을 그리다 보니 **칸과 문이**
--   넷 모자랐다. 넷 다 화면에서 지어낼 수 없는 것들이라 여기로 온다.
--
--   1절 company_progress()  회사 카드의 진행률이 0027 이후 **보는 사람마다 달라진다.**
--        진행률은 회사의 사실이지 개인의 시야가 아니다. definer 집계로 평균 하나만 낸다.
--   2절 company_people()    공유 대상 검색. 0026이 사람 목록을 subtree로 잘랐기 때문에,
--        구매팀장이 영업팀장에게 문서를 공유하려 해도(회장 지시 검증 c) 화면에서 그 사람을
--        **고를 수가 없다.** 이름 두 칸만 내주는 문을 연다.
--   3절 초대장이 담지 못하던 칸 셋(display_name_en · joined_on · language)과
--        user_profiles.language. 원문 블록 B-4의 초대 폼이 요구하는 칸이다.
--   4절 apply_user_invitation() 재정의 — 3절의 칸을 계정이 생길 때 프로필로 옮긴다.
--   5절 'ECOUNT Sync' → 'Integration' (원문 블록 B-6). DB에 박힌 값이라 여기서 고친다.
--
-- 두 함수는 우회가 아니라 좁은 문이다 (keyhole 원칙 — 0027 2절과 같은 모양)
--   service_role은 이 프로젝트에 없고(CLAUDE.md), 이 파일도 RLS를 우회하는 경로를 만들지
--   않는다. 증거는 **반환 목록**이다.
--     company_progress()  int 하나. 프로젝트 행은 한 줄도 나가지 않는다 — 이름도, 담당자도,
--                         마감일도, 건수조차 아니다. 평균 하나뿐이다.
--     company_people()    이름 두 칸(ko/en)과 id. 역할·등급·이메일·소속 팀은 나가지 않는다.
--   둘 다 회사 격리(has_business)를 **함수 안에서 그대로 진다.** 남의 회사는 여전히
--   존재하지 않는 것처럼 보인다 — 다섯 번째 겹만 비켜서고 앞의 네 겹은 그대로다.
--
--   다음 사람이 이 함수들에 칸을 하나 더 붙이고 싶어지면, 그 순간 이것은 문이 아니라
--   projects_read / user_profiles_self_read를 우회하는 창이 된다. 붙이지 마라.
--
-- audit_action enum에 새 값을 만들지 않는다 (55P04 — 0022가 production에서 겪었다).
--   공유는 delegate, 회수·권한 변경은 permission_change. 이 파일은 어휘를 건드리지 않는다.
--
-- 이 파일은 통째로 재적용해도 안전하다(create or replace · add column if not exists ·
--   조건부 update). 검사가 그것에 기댄다 — scripts/check-migrations.ts의 orgScreen()이
--   'ECOUNT Sync' 행을 심어 놓고 이 파일을 한 번 더 적용해 5절이 실제로 고치는지를 본다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 회사 진행률 — 보는 사람에 따라 달라지지 않는다
--
--    0027이 projects에 다섯 번째 겹을 얹으면서 목록이 사람마다 잘린다. 그 자체는 옳다.
--    문제는 회사 카드의 '프로젝트 진행률'이 그 잘린 목록의 평균이었다는 것이다
--    (lib/finance.ts businessProgress, 0027 보고 6절 ⑤). 같은 회사 카드를 회장은 41%로,
--    영업 직원은 80%로 보게 된다. 새는 것은 없지만 **같은 숫자를 서로 다르게 보는 상태**고,
--    그런 숫자는 회의에서 둘 중 하나가 틀렸다는 것조차 모른 채 인용된다.
--
--    진행률은 회사의 사실이다. 재무 KPI가 이미 회사·역할 단위로 보이는 것과 같은 등급이라
--    (0015 finance_kpis는 subtree를 타지 않는다), 같은 자리에 둔다.
--
--    내주는 것은 **평균 하나**다. 행도, 건수도, 어느 프로젝트가 몇 퍼센트인지도 아니다.
--    "이 회사가 지금 어디까지 왔나"에 답하는 데 필요한 값이 그것뿐이기 때문이다.
--
--    회사 격리는 함수 안에서 그대로 진다. 못 보는 회사는 null이고, 화면은 그 자리에
--    숫자 대신 '—'를 그린다. 프로젝트가 한 건도 없는 회사도 null이다 — 0으로 내리면
--    '아직 아무것도 없다'와 '전부 0%다'가 같은 그림이 된다(0002 CH-002 새 회사의 재무
--    칸에서 같은 판단을 이미 했다: hasFinanceData).
--
--    projects에 force가 없어야 이 함수가 돈다(0027 1절이 내렸다). 되살아나면 이 함수는
--    production에서만 조용히 null을 주고 모든 회사 카드의 진행률이 '—'가 된다 —
--    check-migrations.ts의 0027 구조 단언이 그 자리를 지킨다.
-- ---------------------------------------------------------------------
create or replace function company_progress(p_business_id text) returns int
language sql stable security definer set search_path = public as $fn$
  select case when has_business(p_business_id) then (
    select round(avg(progress_pct))::int from projects where business_id = p_business_id
  ) end;
$fn$;

comment on function company_progress(text) is
  '0028. 회사 전체 프로젝트 진행률의 평균 하나. 행은 한 줄도 내주지 않는다 — 0027 project_business_id()와 같은 keyhole이다. 못 보는 회사와 프로젝트가 없는 회사는 둘 다 null이고, 화면이 그 자리에 ''—''를 그린다.';

revoke all on function company_progress(text) from public;
grant execute on function company_progress(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. 공유 대상 검색 — 같은 회사 사람의 **이름만**
--
--    회장 지시 블록 C: "문서·업무·프로젝트 상세에 공유 버튼 → 사람 검색(같은 회사)".
--    검증 c: "구매팀장이 영업팀장에게 문서 1건 공유."
--
--    0026이 user_profiles의 읽기를 subtree로 잘랐다(그것이 블록 B의 요구다 — 상위·옆은
--    존재도 보이지 않는다). 구매팀장에게 영업팀장은 **옆 가지**라 보이지 않는다. 그래서
--    화면에서 공유 대상을 고를 수가 없다 — 공유 기능이 통째로 서지 못한다.
--
--    두 요구가 부딪히는 자리다. 원문이 둘 다 명시했으므로 어느 쪽도 지울 수 없고,
--    가장 좁은 문을 내는 것이 답이다.
--
--    이 함수가 내주는 것
--      user_id · display_name · display_name_en   — 그게 전부다.
--    내주지 않는 것
--      역할 · 보안등급 · 이메일 · 소속 팀 · 상사 · 재직 상태 · 회사 목록.
--      조직도(블록 B)가 보여 주는 것은 여전히 subtree뿐이다. 이 문으로는 '누가 있나'를
--      훑을 수 없다 — 질의 문자열이 비면 **0행**이고(목록 조회가 아니다), 최대 20행이다.
--
--    좁히는 조건들
--      · 호출자가 활성이어야 한다(is_active).
--      · 자기 자신은 후보가 아니다. 자기에게 공유하는 일은 없다.
--      · 회수된 사람(revoked_at) · 나간 사람(status='left')은 후보가 아니다.
--        나간 사람에게 문서를 여는 것은 원칙 8을 정면으로 거스른다.
--      · 시스템 계정(AIAgent · Integration)은 후보가 아니다. 야간 Job과 ECOUNT 동기화
--        계정에게 사람이 문서를 공유하는 일은 없고, 열어 두면 그것은 감사에 '사람이 아닌
--        계정에 열린 문서'로 남는다.
--      · **회사 격리는 그대로 진다.** 나와 회사가 하나라도 겹치는 사람만 나온다.
--        전사 역할(Chairman/GroupCFO)은 user_business_access에 행이 없지만 모든 회사를
--        보므로(0002 has_group_scope) 후보에 둔다 — 위로 보고하려고 여는 공유가 막히면
--        사람들은 대신 문서 등급을 낮춘다(0025가 shares.expires_at에서 한 판단과 같다).
--
--    공유가 실제로 만들어지는지는 이 함수가 정하지 않는다. 0026의 shares_insert_visible이
--    "볼 수 있는 것만 공유할 수 있다"를 판정하고, 받는 사람도 대상 표의 has_business()를
--    통과해야 그 행을 읽는다. 이 함수는 **이름을 고르게 할 뿐**이다.
-- ---------------------------------------------------------------------
create or replace function company_people(p_query text)
returns table (user_id uuid, display_name text, display_name_en text)
language sql stable security definer set search_path = public as $fn$
  select p.user_id, p.display_name, p.display_name_en
    from user_profiles p
   where is_active()
     and length(btrim(coalesce(p_query, ''))) >= 1
     and p.user_id <> auth.uid()
     and p.revoked_at is null
     and p.status = 'active'
     and p.role not in ('AIAgent', 'Integration')
     and (
       p.role in ('Chairman', 'GroupCFO')
       or exists (
         select 1 from user_business_access a
          where a.user_id = p.user_id and has_business(a.business_id)
       )
     )
     and (
       p.display_name ilike '%' || btrim(p_query) || '%'
       or coalesce(p.display_name_en, '') ilike '%' || btrim(p_query) || '%'
     )
   order by p.display_name
   limit 20;
$fn$;

comment on function company_people(text) is
  '0028. 공유 대상 고르기 전용. 같은 회사 사람의 id와 이름 두 칸만 내준다 — 역할·등급·이메일·팀은 나가지 않고, 질의가 비면 0행이다(목록 조회가 아니다). 조직도가 보여 주는 범위는 여전히 subtree뿐이다.';

revoke all on function company_people(text) from public;
grant execute on function company_people(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. 초대장이 담지 못하던 칸 셋 + 프로필의 표기 언어
--
--    원문 블록 B-4의 초대 폼: "이메일·이름(ko/en)·팀·역할·입사일·언어·직속 상사".
--    0011의 표에는 이름 한 벌(display_name)뿐이고, 0026이 reports_to·team_id를 더했다.
--    남은 셋이 여기 있다.
--
--    display_name_en  0017이 user_profiles에 만든 칸과 **같은 성질**이다. null을 허용한다 —
--                     사람 이름의 영문 철자는 본인이 쓰는 것이 유일한 정답이고, 코드가
--                     음차하지 않는다(0017의 명시적 판단). 없으면 화면이 영문 줄을 안 그린다.
--    joined_on        입사일. 없으면 이행하는 날(KST)이 입사일이다 — 4절이 coalesce로 떨어진다.
--                     블록 B-5의 '30일 입퇴사 이력'이 이 칸을 읽는다.
--    language         표기 언어(ko/en). **새 i18n 체계가 아니다** — 이 저장소의 이중 언어는
--                     칸 두 벌(display_name/display_name_en, teams.name/name_en)로 하고,
--                     이 칸은 '이 사람이 어느 쪽을 쓰는가'를 적어 두는 자리다. 오늘 화면을
--                     한국어에서 영어로 바꾸는 장치는 없고, 그것이 생기는 날 이 칸이 입력이다.
--                     지어낸 값이 들어가지 않게 기본값은 'ko'이고 체크로 둘만 받는다.
-- ---------------------------------------------------------------------
alter table user_invitations
  add column if not exists display_name_en text,                                  -- [일반]
  add column if not exists joined_on       date,                                  -- [일반]
  add column if not exists language        text not null default 'ko'             -- [일반]
    constraint user_invitations_language check (language in ('ko', 'en'));

alter table user_profiles
  add column if not exists language text not null default 'ko'                    -- [일반]
    constraint user_profiles_language check (language in ('ko', 'en'));

comment on column user_invitations.joined_on is
  '입사일. 비어 있으면 초대가 이행되는 날(KST)이 입사일이 된다 — 0026의 apply_user_invitation()이 coalesce로 떨어진다.';
comment on column user_profiles.language is
  '표기 언어(ko/en). 새 i18n 체계가 아니다 — 이중 언어는 칸 두 벌(display_name/display_name_en)로 하고, 이 칸은 그중 어느 쪽을 쓰는 사람인가를 적어 둔다.';

-- ---------------------------------------------------------------------
-- 4. apply_user_invitation() 재정의 — 3절의 칸을 프로필로 옮긴다
--
--    **0026:513-565의 본문을 파일에서 그대로 복사**했고, insert/update 목록에 칸 셋을
--    더한 것 말고는 한 줄도 바꾸지 않았다. 결재 가드도, 이미 있는 자리를 초대장이 덮지
--    않게 하는 coalesce 두 줄도, business_ids 반복도 그대로다 — 기억으로 다시 쓰지 않는다.
--
--    grant는 여전히 없다(0026이 revoke했고 이 파일은 되돌리지 않는다). 트리거 전용이다 —
--    RPC로 열면 회장 결재를 건너뛰는 길이 된다.
--
--    joined_on은 coalesce(inv.joined_on, KST 오늘)이다. 'today'는 언제나 KST다
--    (0019 3절·0023 5절·0025 3절과 같은 계산. current_date는 서버 UTC라 쓰지 않는다).
-- ---------------------------------------------------------------------
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
    user_id, role, display_name, display_name_en, title_ko, max_security_class,
    reports_to, team_id, joined_on, language
  )
  values (
    p_user, inv.role, inv.display_name, inv.display_name_en, inv.title_ko, inv.max_security_class,
    coalesce(inv.reports_to, inv.invited_by), inv.team_id,
    coalesce(inv.joined_on, (now() at time zone 'Asia/Seoul')::date),
    inv.language
  )
  on conflict (user_id) do update
    set role               = excluded.role,
        display_name       = excluded.display_name,
        -- 영문 이름은 비어 있는 초대장이 기존 값을 지우지 않게 한다. 사람이 자기 철자를
        -- 한 번 적어 두면 재초대가 그것을 되돌리면 안 된다(reports_to·team_id와 같은 결).
        display_name_en    = coalesce(excluded.display_name_en, user_profiles.display_name_en),
        title_ko           = excluded.title_ko,
        max_security_class = excluded.max_security_class,
        -- 이미 조직도에 자리가 있는 사람이면 그 자리를 초대장이 덮지 않는다.
        -- 블록 B에서 사람이 옮겨 둔 상사를 재초대 한 번이 되돌리면 안 된다.
        reports_to         = coalesce(user_profiles.reports_to, excluded.reports_to),
        team_id            = coalesce(user_profiles.team_id, excluded.team_id),
        joined_on          = coalesce(user_profiles.joined_on, excluded.joined_on),
        language           = excluded.language,
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
  '0026/0028. 초대 한 건을 실제 권한으로 옮긴다. 결재가 필요한데 아직 안 났으면 아무것도 하지 않는다. 0028이 이름(en)·입사일·표기 언어를 같이 옮기게 했다. RPC로 열지 않는다 — 열면 결재를 건너뛰는 길이 된다.';

revoke all on function apply_user_invitation(uuid, uuid) from public;

-- ---------------------------------------------------------------------
-- 5. 'ECOUNT Sync' → 'Integration' (원문 블록 B-6)
--
--    이 이름은 화면 문자열이 아니라 **DB 값**이다. supabase/bootstrap/0006_integration.sql이
--    손으로 실행되면서 user_profiles.display_name에 박는다. 그래서 화면 쪽 매핑으로
--    고칠 수 없다 — 고치면 '화면에 보이는 이름'과 '감사 기록에 남는 이름'이 갈라진다.
--
--    왜 이름을 바꾸나: 그 계정이 하는 일은 ECOUNT만이 아니다(0015 Integration 역할은
--    원장 다섯 표를 쓴다). 회장 지시가 시스템 계정 탭에서 그것을 'Integration'으로
--    부르라고 했고, 역할 이름(app_role 'Integration')과도 그쪽이 맞는다.
--
--    좁게 고친다. role이 Integration이고 이름이 정확히 그 옛 값인 행만 — 사람이 이미
--    다른 이름으로 바꿔 두었으면 이 마이그레이션이 그것을 되돌리지 않는다.
--    bootstrap 파일도 같이 고쳤다(재실행하면 같은 값이 들어가게).
--
--    audit_log에는 남기지 않는다. 이 문장은 권한을 움직이지 않고 표시 이름만 바꾼다 —
--    0026의 백필도 같은 이유로 기록을 남기지 않았다(마이그레이션 로그가 그 기록이다).
-- ---------------------------------------------------------------------
update user_profiles
   set display_name = 'Integration'
 where role = 'Integration'
   and display_name = 'ECOUNT Sync';

commit;

-- 확인:
--   select company_progress('biz_dy');                       -- 회사 전체 평균 하나 (또는 null)
--   select * from company_people('영업');                    -- 이름 두 칸 + id, 최대 20행
--   select * from company_people('');                        -- 0행이어야 한다
--   select display_name from user_profiles where role = 'Integration';   -- 'Integration'
--   select column_name from information_schema.columns
--    where table_name = 'user_invitations' and column_name in ('display_name_en','joined_on','language');
