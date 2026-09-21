-- =====================================================================
-- Chairman OS — 0033_succession (Phase 7 블록 A · 의존)
-- 바인딩 권위: docs/chairman-architecture-v1.md §7 · §9 · §11 · §12 · §20 · §21 · §34~35
-- 블록 지시 원문: docs/superpowers/specs/2026-09-20-incoming.md `A. 의존 (SUCCESSION)`
-- 작성: 2026-09-21
--
-- 이 파일이 답하려는 질문은 하나다: **"Edison 없이 DY가 얼마나 돌아가는가."**
-- 그 답은 숫자여야 하고, 숫자는 세어서 나와야 한다. 그래서 이 파일이 하는 일의 절반은
-- '세는 법을 정하는 것'이고 나머지 절반은 **'못 센 것을 못 셌다고 말하는 것'**이다.
--
-- ■ 가장 위험한 자리 — 기존 decisions 행의 역산 ■
--   0001의 decisions에는 "회장이 정했는가"를 말해 주는 칸이 **없다.** decided_by(uuid)와
--   status만 있다. 그래서 decided_by_kind를 새로 만들면 기존 행의 값은 어디선가 와야 하는데,
--   그 '어디'가 추측이면 §7의 지표 전체가 허구가 된다. Founder Dependency는 회장이
--   "내가 얼마나 빠졌나"를 보는 숫자다 — 지어낸 값은 그 질문에 거짓으로 답한다.
--
--   그래서 규칙을 코드 안에 숨기지 않고 **여기 글로 적는다**(3절). 규칙이 닿지 않는 행은
--   null로 남고, 뷰가 그 행을 **분자에서도 분모에서도 뺀 뒤 몇 건을 뺐는지 같이 내준다**(7절).
--   null을 'ceo'로 접는 쪽이 훨씬 쉽지만, 그 방향의 거짓이 제일 나쁘다 — 지표가 좋아 보인다.
--
-- ■ 하지 않는 것 ■
--   * **새 audit_action enum 값을 만들지 않는다.** approve/reject/modify/delegate는 0001에
--     이미 있다. 0022가 production에서 55P04를 밟은 자리다.
--   * **force row level security를 새로 걸지 않는다.** 0023 chairman_kakao_token ·
--     0023이 내린 chairman_checkins · 0027 projects · 0029 user_settings — 같은 함정을
--     네 번 만났다. FORCE는 소유자를 정책 아래로 끌어내려 security definer 문을 조용히
--     막는다. 이 저장소의 자물쇠는 revoke다.
--   * **RLS를 우회하는 새 경로를 만들지 않는다.** 뷰 둘 다 security_invoker = true다
--     (0002 finance_kpis_masked · 0015 · 0017 calendar_items와 같은 관례).
--     이 선택의 대가는 7절·8절에 적었다 — 숨기지 않는다.
--   * **0026의 다섯 번째 겹(subtree)을 새 표에 얹지 않는다.** 원문이 이 표들의 권한을
--     **역할로** 못 박았다(Chairman·GroupCFO 읽기·쓰기 / CEO 자기 회사 읽기 / 나머지 거부).
--     subtree는 '누구의 업무인가'를 가르는 겹이고, 승계는 회사의 사실이지 개인의 업무가 아니다.
--   * **없는 값을 채우지 않는다.** DY의 Autonomy 등급은 이 파일에 없다 — 문서 어디에도
--     "DY는 지금 L몇"이 없기 때문이다(§34는 목표가 L5라고만 한다). 화면이 '아직 평가 없음'
--     이라고 말한다. dependency_areas의 level·transfer_status가 nullable인 것도 같은 이유다(9절).
--
-- ■ requests 표 ■
--   원문은 "decisions·requests.decided_by_kind"를 말하지만 **이 저장소에 requests 표는
--   없다.** 0001~0032의 create table 43개를 확인했다(가장 가까운 것은 0011의
--   user_invitations인데 그것은 초대 승인 큐이지 '결정'이 아니다 — 회사도 없고 §7의
--   '중요한 의사결정'에 들어가지 않는다). 그래서 decisions에만 칸을 더한다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. decisions.decided_by_kind — "누가 정했는가"의 세 값
--
--    chairman  회장 큐에서 회장이 처리했다
--    ceo       팀장·CEO 선에서 종결됐다
--    rule      규칙·시스템이 자동으로 닫았다
--    null      **모른다.** 값이 아니라 '역산이 닿지 않았다'는 사실이다.
--
--    enum이 아니라 text + check인 이유: 0022가 production에서 55P04(새 enum 값을 같은
--    트랜잭션에서 리터럴로 못 쓴다)를 밟았고, 이 파일은 같은 트랜잭션 안에서 이 값들을
--    리터럴로 쓴다(3절 역산 · 4절 트리거 · 7절 뷰). check 제약은 enum과 똑같이 강제하면서
--    그 함정이 없다.
--
--    ■ 'rule'은 오늘 만들어질 경로가 없다 ■ 0013이 decisions에 ai_agent_no_update를
--    restrictive로 걸어 두어 야간 Job은 결정을 한 줄도 못 닫는다. 그래서 이 값은
--    지금은 **비어 있는 칸**이고, 블록 B(예외 엔진)가 규칙 자동 종결을 들고 올 때 채워진다.
--    값을 미리 만들어 두는 이유는 그때 가서 check 제약을 고치면 기존 행이 잠깐 위법해지기
--    때문이다. 오늘 0건인 것은 화면이 그대로 0건이라고 말한다.
-- ---------------------------------------------------------------------
alter table decisions
  add column if not exists decided_by_kind text;                -- [일반] chairman/ceo/rule/null

alter table decisions
  add constraint decisions_decided_by_kind_check
  check (decided_by_kind is null or decided_by_kind in ('chairman', 'ceo', 'rule'));

comment on column decisions.decided_by_kind is
  '§7 Founder Dependency의 분자. chairman/ceo/rule. **null은 값이 아니라 "역산이 닿지 않았다"는 사실이다** — 0033 이전 행에는 이 사실을 말해 주는 칸이 없었고, 뷰 founder_dependency가 그런 행을 분자에서도 분모에서도 뺀 뒤 몇 건을 뺐는지 같이 내준다.';

-- 뷰가 회사·월로 묶으면서 이 칸으로 거른다. 처리된 결정만 보므로 부분 인덱스다.
create index decisions_kind_by_business
  on decisions (business_id, decided_by_kind)
  where status <> 'Open';

-- ---------------------------------------------------------------------
-- 2. decision_kind_of(role) — 역할 한 개를 세 값 중 하나로 접는 유일한 자리
--
--    역산(3절)도 트리거(4절)도 이 함수를 쓴다. 두 곳이 각자 case를 적으면 언젠가
--    한쪽만 고쳐지고, 그러면 **과거와 미래가 다른 규칙으로 세어진다** — 추세선이
--    그 지점에서 꺾이는데 아무도 이유를 모른다.
--
--    매핑은 원문 그대로다: "회장 큐 처리 = chairman, 팀장·CEO 종결 = ceo, 규칙 자동 = rule".
--      Chairman                        → chairman
--      BusinessCEO · Executive · TeamLead → ceo   (원문의 '팀장·CEO 선')
--      AIAgent                         → rule
--      그 밖(GroupCFO·Member·ExternalExpert·Vendor·Integration·null) → **null**
--
--    GroupCFO를 'ceo'로 접지 않은 것이 이 함수에서 유일하게 망설인 자리다. 접으면 역산
--    도달률이 올라가지만, 그룹 CFO는 회사의 CEO가 아니고 §7이 세려는 '회사가 스스로 정한
--    결정'도 아니다 — 그 방향의 오분류는 지표를 **좋아 보이게** 만든다. 모르면 null이다.
--    (오늘 GroupCFO는 decisions를 못 닫는다. 0002 decisions_decide가 can_approve()를
--     요구하고 그 함수는 Chairman·BusinessCEO뿐이다. 그래서 이 분기는 방어선이지 경로가 아니다.)
--
--    text를 받는다. app_role을 받으면 audit_log.actor_role(text, 그 시점의 역할 문자열)을
--    넘길 때마다 캐스팅이 필요하고, 그 캐스팅은 지금은 없는 역할 이름 앞에서 22P02로 터진다 —
--    5년 전 기록에 지금 없는 역할이 적혀 있는 것은 감사 기록에서 정상이다.
-- ---------------------------------------------------------------------
create or replace function decision_kind_of(role text) returns text
language sql immutable set search_path = public as $fn$
  select case btrim(coalesce(role, ''))
    when 'Chairman'    then 'chairman'
    when 'BusinessCEO' then 'ceo'
    when 'Executive'   then 'ceo'
    when 'TeamLead'    then 'ceo'
    when 'AIAgent'     then 'rule'
    else null
  end;
$fn$;

comment on function decision_kind_of(text) is
  '§7. 역할 이름 → decided_by_kind. 역산(0033 3절)과 트리거(4절)가 같은 규칙을 쓰게 하는 한 자리. GroupCFO는 null이다 — 모르는 것을 ceo로 접으면 지표가 좋아 보인다.';

-- ---------------------------------------------------------------------
-- 3. 기존 행 역산 — **무엇을 재료로 썼고 어디까지 닿는가**
--
--    ■ 재료 ■ audit_log다. 0001부터 결정 처리는 두 줄로 남는다:
--      decisions.status가 바뀌고, audit_log에 (action ∈ approve/reject/modify/delegate,
--      entity_table='decisions', entity_id=decision_id, actor_role='그 시점의 역할') 한 줄이
--      들어간다(supabase.ts recordDecisionAction — 기록이 **먼저**다). 그 actor_role이
--      "회장이 정했는가"에 답하는 **실제로 기록된 사실**이다. 추측이 아니다.
--
--    ■ 규칙 ■ 순서대로 본다. 앞 규칙이 답하면 뒤는 안 본다.
--      ① 처리된 결정(status <> 'Open')에 대해, audit_log에서 그 결정의 **마지막** 처리 줄을
--         찾아 actor_role을 decision_kind_of()에 넣는다. 여러 번 처리된 결정은 마지막이
--         현재 status를 만든 줄이다.
--      ② ①이 못 찾았고 decisions.decided_by(처리자 uuid)가 user_profiles에 있으면,
--         **그 사람의 지금 역할**을 decision_kind_of()에 넣는다.
--         이것은 ①보다 약한 재료다 — 사람의 역할은 바뀌고, 이 규칙은 '그때'가 아니라
--         '지금'을 본다. 그래서 두 번째다. 그래도 추측은 아니다(실재하는 행 두 개를 잇는다).
--      ③ 둘 다 못 찾으면 **null로 남긴다.** 처리되지 않은 결정(status='Open')은 애초에
--         '누가 정했나'가 없으므로 이 역산의 대상이 아니다 — 뷰도 그 행을 세지 않는다(7절).
--
--    ■ 닿지 않는 행 ■ 0003_seed.sql의 결정 4건은 전부 status='Open'이고 audit_log에는
--      시드가 한 줄도 없다(그 파일 14행: "기록은 행위에서만 생긴다"). 그래서 **오늘 staging의
--      역산 도달률은 처리된 결정 0건 중 0건이다** — 분모가 0이다. 이 사실을 숨기지 않고
--      화면이 그대로 말한다(/dependency의 '아직 계산할 수 없습니다').
--      이 숫자는 블록 A 보고서에 적혀 있다.
--
--    ■ 왜 마이그레이션이 이 일을 하는가 ■ 앱 코드에 두면 "언제 돌았나"가 기록에 남지 않고,
--      두 번 돌 수 있다. 여기서 한 번 돌고 끝난다.
-- ---------------------------------------------------------------------

-- 규칙 ① — audit_log의 마지막 처리 줄
update decisions d
   set decided_by_kind = decision_kind_of(a.actor_role)
  from (
    select distinct on (entity_id)
           entity_id, actor_role
      from audit_log
     where entity_table = 'decisions'
       and action::text in ('approve', 'reject', 'modify', 'delegate')
     order by entity_id, occurred_at desc, id desc
  ) a
 where a.entity_id = d.decision_id
   and d.status <> 'Open'
   and d.decided_by_kind is null
   and decision_kind_of(a.actor_role) is not null;

-- 규칙 ② — 처리자의 지금 역할
update decisions d
   set decided_by_kind = decision_kind_of(p.role::text)
  from user_profiles p
 where p.user_id = d.decided_by
   and d.status <> 'Open'
   and d.decided_by_kind is null
   and decision_kind_of(p.role::text) is not null;

-- ---------------------------------------------------------------------
-- 4. 앞으로 들어오는 행 — 트리거가 채운다
--
--    왜 앱이 아니라 트리거인가. 앱도 채운다(supabase.ts recordDecisionAction). 그런데
--    앱만 채우면 PostgREST로 직접 status를 바꾸는 길이 그대로 열려 있고, 그 길로 들어온
--    행은 영원히 null이 되어 **지표에서 조용히 빠진다.** 빠진 행은 화면에 '제외 N건'으로
--    보이긴 하지만, 그 N이 왜 늘었는지는 아무도 모른다.
--
--    앱이 이미 값을 넣었으면 건드리지 않는다(아래 첫 줄). 트리거는 빈 칸만 채운다 —
--    앱이 아는 것(그 요청을 처리한 사람의 역할)이 더 정확할 수 있기 때문이다.
--
--    이미 닫힌 결정을 다시 UPDATE하는 것(메모 수정 등)은 건드리지 않는다. 그때의 auth_role()은
--    '그 결정을 내린 사람'이 아니라 '지금 메모를 고치는 사람'이다.
-- ---------------------------------------------------------------------
create or replace function decisions_fill_kind() returns trigger
language plpgsql set search_path = public as $fn$
begin
  -- 이미 값이 있으면 그대로 둔다. 트리거는 빈 칸만 채운다.
  if new.decided_by_kind is not null then
    return new;
  end if;
  -- 아직 처리 전이면 '누가 정했나'가 없다.
  if new.status::text = 'Open' then
    return new;
  end if;
  -- 이미 닫혀 있던 행의 다른 칸을 고치는 중이면 건드리지 않는다.
  if tg_op = 'UPDATE' and old.status::text <> 'Open' then
    return new;
  end if;

  new.decided_by_kind := decision_kind_of(auth_role()::text);
  return new;
end;
$fn$;

comment on function decisions_fill_kind() is
  '§7. 결정이 Open에서 벗어나는 순간 decided_by_kind를 채운다. 앱이 이미 넣었으면 건드리지 않는다 — 트리거는 PostgREST 직접 쓰기로 들어온 행이 지표에서 조용히 빠지는 것을 막는 방어선이다.';

create trigger decisions_fill_kind_trg
  before insert or update on decisions
  for each row execute function decisions_fill_kind();

-- ---------------------------------------------------------------------
-- 5. dependency_areas — "회사가 회장의 어느 부분에 의존하는가"(§7 DEPENDENCY CATEGORY)
--                       + "무엇이 이양됐는가"(§11 TRANSFER MATRIX)
--
--    두 표로 나누지 않았다. 문서의 두 목록은 **같은 영역을 두 각도에서 본 것**이다 —
--    '가격'은 의존도 HIGH이면서 이양이 IN PROGRESS다. 표를 나누면 그 두 줄을 이름 문자열로
--    이어야 하고, '가격'과 '가격 결정'이 다른 영역이 되는 날이 온다.
--
--    ■ level과 transfer_status가 **둘 다 nullable**이다. 이것이 이 표의 요점이다 ■
--    문서의 두 목록은 겹치지만 같지 않다:
--      §7/원문 의존 영역 6: 가격 · 주요거래처 · 베트남투자 · R&D · 채용 · 생산
--      §11 이양 7:         생산 · 채용 · 국내영업 · 가격 · 주요거래처 · 자본배분 · 베트남
--    합집합은 8개다. R&D에는 이양 계획이 아직 없고, 국내영업·자본배분에는 의존도 평가가
--    아직 없다. not null + default를 걸면 그 세 칸이 **'not_started'와 'LOW'라는 없는
--    사실로** 채워진다. 그 둘은 그럴듯해서 아무도 의심하지 않는다 — 그래서 null이다.
--    화면이 '아직 평가 없음' · '이양 계획 없음'이라고 적는다.
-- ---------------------------------------------------------------------
create table dependency_areas (
  id              bigint generated always as identity primary key,
  business_id     text not null references businesses(business_id) on delete cascade, -- [일반]
  area            text not null,                          -- [일반] 영역 이름(가격·주요거래처…)
  area_en         text,                                   -- [일반] 영문 병기(§7의 Pricing 등)
  level           text,                                   -- [제한] HIGH/MEDIUM/LOW. null=미평가
  transfer_status text,                                   -- [제한] done/in_progress/not_started. null=계획 없음
  target_date     date,                                   -- [일반] 이양 목표일
  note            text,                                   -- [제한] 근거 메모
  sort_order      integer not null default 0,             -- [일반]
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint dependency_areas_unique unique (business_id, area),
  constraint dependency_areas_level_check
    check (level is null or level in ('HIGH', 'MEDIUM', 'LOW')),
  constraint dependency_areas_transfer_check
    check (transfer_status is null or transfer_status in ('done', 'in_progress', 'not_started'))
);

comment on table dependency_areas is
  '§7 DEPENDENCY CATEGORY + §11 TRANSFER MATRIX. 한 영역의 두 각도(얼마나 의존하는가 / 이양됐는가)를 한 줄에 둔다. level·transfer_status가 둘 다 nullable인 것은 의도다 — 문서의 두 목록이 겹치되 같지 않아서, not null이면 없는 평가가 그럴듯한 값으로 채워진다.';
comment on column dependency_areas.level is
  'HIGH/MEDIUM/LOW. **null은 LOW가 아니라 "아직 평가하지 않았다"다.**';
comment on column dependency_areas.transfer_status is
  'done/in_progress/not_started. **null은 not_started가 아니라 "이양 계획이 아직 없다"다.**';

create trigger dependency_areas_updated_at before update on dependency_areas
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 6. autonomy_assessments — CEO 자율성 L1~L5 (§9)
--
--    분기 단위다. 등급은 회장이 매기는 판단이고, 판단에는 **누가 언제** 매겼는지가 따라야
--    한다 — 그것이 없으면 "L4"는 어느 날 갑자기 화면에 있는 숫자가 된다.
--
--    level은 'L1'~'L5' 문자열이다. 정수 1~5가 아니다: 문서가 등급 이름으로 쓰고(§9 GROUP KPI가
--    "L5 CEOs: 7"), 화면·시드·검사가 전부 같은 글자를 쓰게 하려는 것이다. 평균(§9 "L4.1")은
--    화면이 숫자로 바꿔 낸다 — 표에 평균을 저장하지 않는다.
-- ---------------------------------------------------------------------
create table autonomy_assessments (
  id          bigint generated always as identity primary key,
  business_id text not null references businesses(business_id) on delete cascade, -- [일반]
  quarter     text not null,                              -- [일반] YYYY-Qn
  level       text not null,                              -- [제한] L1~L5
  assessed_by uuid references auth.users(id),             -- [제한] 매긴 사람
  note        text,                                       -- [제한] 근거
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint autonomy_quarter_unique unique (business_id, quarter),
  constraint autonomy_quarter_format check (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  constraint autonomy_level_check check (level in ('L1', 'L2', 'L3', 'L4', 'L5'))
);

comment on table autonomy_assessments is
  '§9 CEO Autonomy Level. 분기 × 회사 하나. 등급은 판단이라 누가 언제 매겼는지가 같이 남는다 — 평가가 없는 분기는 행이 없고, 화면은 그 자리를 추정하지 않고 "아직 평가 없음"이라고 적는다.';

create trigger autonomy_assessments_updated_at before update on autonomy_assessments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 7-1. absence_tests — 회장 부재 테스트 (§12)
--
--    ■ days는 **넷**이다: 7 / 30 / 90 / 365 ■ 원문 지시는 30/90/365 셋만 적었지만
--    문서 §12가 "Track: 7 DAY / 30 DAY / 90 DAY / 365 DAY"라고 넷을 말한다. 둘이 어긋나면
--    문서가 이긴다(브리프의 첫 줄). 7일을 빼면 첫 테스트를 30일부터 시작해야 하는데,
--    그것은 회사가 처음 이 시험을 치를 때 가장 큰 한 걸음을 먼저 요구하는 것이다.
--
--    result는 pass/fail/**pending**이다. pending이 이 표의 절반이다 — 예정된 테스트와
--    치르지 않은 테스트를 같은 칸에 담아야 화면이 "다음 부재 테스트: 12월 90일"을 말할 수 있다.
-- ---------------------------------------------------------------------
create table absence_tests (
  id           bigint generated always as identity primary key,
  business_id  text not null references businesses(business_id) on delete cascade, -- [일반]
  days         integer not null,                          -- [일반] 7/30/90/365
  scheduled_on date not null,                             -- [일반] 시작 예정일
  result       text not null default 'pending',           -- [제한] pass/fail/pending
  note         text,                                      -- [제한]
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint absence_tests_unique unique (business_id, days, scheduled_on),
  constraint absence_tests_days_check check (days in (7, 30, 90, 365)),
  constraint absence_tests_result_check check (result in ('pass', 'fail', 'pending'))
);

comment on table absence_tests is
  '§12 Chairman Absence Test. days는 문서대로 7/30/90/365 넷이다(원문 지시는 셋이었고, 어긋나면 문서가 이긴다). result의 pending이 절반의 쓰임이다 — 예정된 테스트가 같은 표에 있어야 "다음 부재 테스트"를 말할 수 있다.';

create trigger absence_tests_updated_at before update on absence_tests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 7-2. chairman_directions — Direction(§20) + Chairman Letter(§21)
--
--    ■ §21의 필드 목록과 대조했다 ■ 원문 지시의 칸은 다섯이었다
--    (five_year · priorities[] · do_not[] · contact_when[] · letter).
--    문서 §21이 요구하는 일곱 칸과 맞춰 보면 셋이 비어 있었다:
--
--      §21 Why we own this company            → why_own              (없었다 · 더함)
--      §21 5-year objective                   → five_year            ✓
--      §21 Capital philosophy                 → capital_philosophy   (없었다 · 더함)
--      §21 Things Chairman cares about        → cares_about[]        (없었다 · 더함)
--      §21 Things Chairman does NOT want to manage → not_managed[]   (없었다 · 더함)
--      §21 Red lines                          → red_lines[]          (없었다 · 더함)
--      §21 When to contact Chairman           → contact_when[]       ✓
--      §20 Priorities                         → priorities[]         ✓
--      §20 DO NOT                             → do_not[]             ✓
--      원문 letter(1페이지 본문)               → letter               ✓
--
--    cares_about을 priorities로, not_managed를 do_not으로 접지 않았다. §20의 둘은
--    **회사가 무엇을 할 것인가**이고(우선순위 넷 · 하지 말 것), §21의 둘은 **회장이
--    무엇을 볼 것인가**다(내가 신경 쓰는 것 · 내가 관리하지 않을 것). 접으면 "회장이
--    관리하지 않겠다"가 "회사가 하지 말라"로 읽힌다 — 승계 문서에서 그 둘은 반대말에 가깝다.
--
--    회사당 한 줄이다(business_id가 기본키). Direction은 버전이 아니라 현재 상태다 —
--    바뀐 이력은 audit_log가 갖는다(0001부터의 원칙: 이력은 표가 아니라 감사 기록이다).
-- ---------------------------------------------------------------------
create table chairman_directions (
  business_id        text primary key references businesses(business_id) on delete cascade, -- [일반]
  five_year          text,                                -- [제한] §20/§21 5년 방향
  priorities         text[] not null default '{}',        -- [제한] §20 Priorities
  do_not             text[] not null default '{}',        -- [제한] §20 DO NOT (회사가 하지 말 것)
  contact_when       text[] not null default '{}',        -- [제한] §21 When to contact Chairman
  why_own            text,                                -- [제한] §21 Why we own this company
  capital_philosophy text,                                -- [제한] §21 Capital philosophy
  cares_about        text[] not null default '{}',        -- [제한] §21 Things Chairman cares about
  not_managed        text[] not null default '{}',        -- [제한] §21 Things Chairman does NOT manage
  red_lines          text[] not null default '{}',        -- [제한] §21 Red lines
  letter             text,                                -- [제한] §21 1페이지 본문
  updated_by         uuid references auth.users(id),      -- [제한]
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table chairman_directions is
  '§20 Direction + §21 Chairman Letter. CEO의 operating constitution. 회사당 한 줄이고 이력은 audit_log가 갖는다. §21의 일곱 필드와 대조해 why_own·capital_philosophy·cares_about·not_managed·red_lines 다섯을 더했다 — 원문 지시의 다섯 칸에는 없었다.';
comment on column chairman_directions.not_managed is
  '§21 "Things Chairman does NOT want to manage". §20의 do_not(회사가 하지 말 것)과 다른 사실이다 — 접으면 "내가 관리하지 않겠다"가 "너희가 하지 말라"로 읽힌다.';

create trigger chairman_directions_updated_at before update on chairman_directions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 8. RLS — **역할 기반이다. subtree가 아니다.**
--
--    원문: "Chairman·GroupCFO 읽기·쓰기. CEO 자기 회사 읽기. 나머지 거부."
--    'CEO'는 이 저장소에서 app_role의 **BusinessCEO**다(0002 0절에서 확인).
--
--    자물쇠는 revoke다. Supabase는 public 스키마의 새 표를 만들자마자 anon/authenticated에게
--    열어 버린다(postgres 역할의 default privileges). 먼저 걷고 필요한 것만 다시 준다.
--    **force row level security는 걸지 않는다** — 이 저장소가 네 번 밟은 함정이다.
--
--    Executive·TeamLead·Member는 여기서 0건이다. 승계 자료는 "회사가 회장 없이 도는가"를
--    재는 값이라, 그 회사 안의 사람이 자기 회사의 의존도 점수를 보는 것은 원문이 준 범위가
--    아니다. CEO에게 읽기를 주는 것까지가 원문이다(CEO는 그 시험의 대상이자 주체다).
-- ---------------------------------------------------------------------
revoke all on table dependency_areas      from anon, authenticated;
revoke all on table autonomy_assessments  from anon, authenticated;
revoke all on table absence_tests         from anon, authenticated;
revoke all on table chairman_directions   from anon, authenticated;

grant select, insert, update, delete on table dependency_areas     to authenticated;
grant select, insert, update, delete on table autonomy_assessments to authenticated;
grant select, insert, update, delete on table absence_tests        to authenticated;
grant select, insert, update, delete on table chairman_directions  to authenticated;

alter table dependency_areas      enable row level security;
alter table autonomy_assessments  enable row level security;
alter table absence_tests         enable row level security;
alter table chairman_directions   enable row level security;

/**
 * 이 표들을 읽을 수 있는가. 역할로만 판정한다.
 *   Chairman · GroupCFO  전부
 *   BusinessCEO          has_business()가 통과시키는 회사(= user_business_access에 있는 회사)
 *   그 밖                거짓
 *
 * has_business()를 BusinessCEO 분기 안에서만 부르는 이유: 그 함수는 전사 역할에게 무조건
 * true를 주므로(0002), 바깥에서 부르면 Executive·TeamLead도 자기 회사에서 통과한다.
 */
create or replace function can_read_succession(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select case
    when not is_active() then false
    when auth_role() in ('Chairman', 'GroupCFO') then true
    when auth_role() = 'BusinessCEO' then has_business(target)
    else false
  end;
$fn$;

comment on function can_read_succession(text) is
  '§11·§12. 승계 표 넷의 읽기 판정. **역할 기반이고 subtree가 아니다** — 원문이 권한을 역할로 못 박았다. Executive·TeamLead·Member는 자기 회사에서도 0건이다.';

revoke all on function can_read_succession(text) from public;
grant execute on function can_read_succession(text) to authenticated;

/** 쓰기는 Chairman·GroupCFO뿐이다. CEO는 자기 회사도 읽기까지다(원문). */
create or replace function can_write_succession() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and auth_role() in ('Chairman', 'GroupCFO');
$fn$;

comment on function can_write_succession() is
  '§11. 승계 표 넷의 쓰기 판정. Chairman·GroupCFO뿐 — CEO는 자기 회사도 읽기까지다(원문). AIAgent·Integration은 이 함수를 통과하지 못하므로 0013 같은 restrictive 정책을 따로 걸지 않았다.';

revoke all on function can_write_succession() from public;
grant execute on function can_write_succession() to authenticated;

create policy dependency_areas_read on dependency_areas
  for select using (can_read_succession(business_id));
create policy dependency_areas_write on dependency_areas
  for all using (can_write_succession()) with check (can_write_succession());

create policy autonomy_read on autonomy_assessments
  for select using (can_read_succession(business_id));
create policy autonomy_write on autonomy_assessments
  for all using (can_write_succession()) with check (can_write_succession());

create policy absence_tests_read on absence_tests
  for select using (can_read_succession(business_id));
create policy absence_tests_write on absence_tests
  for all using (can_write_succession()) with check (can_write_succession());

create policy directions_read on chairman_directions
  for select using (can_read_succession(business_id));
create policy directions_write on chairman_directions
  for all using (can_write_succession()) with check (can_write_succession());

-- ---------------------------------------------------------------------
-- 9. 뷰 founder_dependency — §7의 식 **그대로**
--
--        Founder Dependency = Chairman-involved major decisions / Total major decisions × 100
--
--    ■ '중요한 의사결정'이 무엇인가 ■ 이 저장소에 정의가 없다.
--    `Ruling: decisions 표에 들어온 것을 전부 '중요'로 본다.` 그 표 자체가 이미 걸러진 것이다 —
--    아무 일이나 decisions에 올라오지 않는다(0002 decisions_create가 can_module로 좁힌다).
--    이 정의를 /dependency/settings 화면에 **글로** 적어 회장이 보고 고칠 수 있게 했다.
--
--    ■ 세지 않는 것 둘 ■
--      ① status='Open' — 아직 아무도 정하지 않았다. '누가 정했나'가 없는 행이다.
--      ② decided_by_kind is null — **역산이 닿지 않았다.** 분자에서도 **분모에서도** 뺀다.
--         분모에만 남기면(= CEO 결정으로 세면) 지표가 좋아 보인다. 그 방향의 거짓이 제일 나쁘다.
--         대신 몇 건을 뺐는지 unknown_count로 같이 낸다 — 화면이 그 숫자를 그대로 보여 준다.
--
--    ■ 달은 KST다 ■ 이 저장소의 '오늘'은 KST다. decided_at은 timestamptz라 UTC로 저장되고,
--    그대로 to_char를 하면 한국 시간 1일 아침 7시의 결정이 전달로 세어진다.
--    (아침 알림 판정만 회장 현지 날짜이고, 그 자리는 0029가 정한 대로 건드리지 않는다.)
--    decided_at이 비어 있는 행은 created_at으로 떨어진다 — 앱은 늘 decided_at을 넣지만
--    PostgREST로 직접 status만 바꾼 행이 있을 수 있고, 그 행을 버리면 분모가 조용히 줄어든다.
--
--    ■ security_invoker = true ■ RLS를 우회하지 않는다(0002·0015·0017 관례).
--    **대가**: 0026이 decisions_read에 얹은 다섯 번째 겹 때문에, 회장이 아닌 사람이 이 뷰를
--    읽으면 자기에게 보이는 결정만으로 계산된 %를 본다. 0026 이전 행과 시드 행은 소유자
--    칸이 둘 다 비어 있어 회사 공통으로 읽히므로 오늘은 차이가 없지만, 앞으로 기안자가 붙은
--    결정이 쌓이면 갈린다. 화면이 "이 값은 보는 사람의 권한 안에서 계산됩니다"라고 적는다.
--    definer 함수로 우회하는 길은 만들지 않았다 — 그것이 이 저장소가 금지한 바로 그 경로다.
-- ---------------------------------------------------------------------
create view founder_dependency
with (security_invoker = true) as
  select
    d.business_id,
    to_char(
      coalesce(d.decided_at, d.created_at) at time zone 'Asia/Seoul', 'YYYY-MM'
    ) as period,
    count(*) filter (where d.decided_by_kind = 'chairman')              as chairman_count,
    count(*) filter (where d.decided_by_kind = 'ceo')                   as ceo_count,
    count(*) filter (where d.decided_by_kind = 'rule')                  as rule_count,
    count(*) filter (where d.decided_by_kind is not null)               as total_count,
    count(*) filter (where d.decided_by_kind is null)                   as unknown_count,
    case
      when count(*) filter (where d.decided_by_kind is not null) = 0 then null
      else round(
        count(*) filter (where d.decided_by_kind = 'chairman')::numeric * 100
        / count(*) filter (where d.decided_by_kind is not null), 1)
    end as dependency_pct
  from decisions d
 where d.status <> 'Open'
 group by 1, 2;

comment on view founder_dependency is
  '§7 Founder Dependency Index. 회사 × 월(KST). chairman/(chairman+ceo+rule)×100. **decided_by_kind가 null인 행은 분자에서도 분모에서도 빠지고 unknown_count로 따로 나온다** — 역산이 닿지 않은 행을 CEO 결정으로 세면 지표가 좋아 보인다. 처리되지 않은 결정(Open)은 아예 세지 않는다. security_invoker라 보는 사람의 RLS가 그대로 걸린다.';

revoke all on founder_dependency from anon, authenticated;
grant select on founder_dependency to authenticated;

-- ---------------------------------------------------------------------
-- 10. 뷰 interventions — 회장이 실제로 손댄 횟수 (audit_log에서)
--
--    "회장 actor의 승인·반려·수정을 회사·월·유형별로". delegate(위임)도 넣는다 —
--    위임은 회장이 그 건을 **손댄** 것이고, 빼면 개입 횟수가 실제보다 적게 보인다.
--    지표를 좋아 보이게 만드는 방향의 누락은 이 블록에서 가장 조심하는 것이다.
--
--    actor_role은 **그 시점에 기록된 역할 문자열**이다. 지금 회장이 아닌 사람이 과거에
--    회장으로 처리한 줄도 그대로 '회장 개입'으로 센다 — 그것이 그때의 사실이다.
--
--    ■ 이 뷰는 사실상 회장 전용이다. 숨기지 않고 적는다 ■
--    audit_log에는 FORCE row level security가 걸려 있고(0002:200), audit_log_read는
--    Chairman / 본인 / in_my_subtree(actor)에게만 준다(0031 6절). **GroupCFO도 CEO도
--    회장의 audit 줄을 못 읽는다** — 회장은 누구의 subtree에도 없다(회장이 뿌리다).
--    그래서 그들이 이 뷰를 읽으면 0행이다.
--
--    definer 함수로 열어 줄 수도 없다. FORCE가 걸린 표는 소유자도 정책 아래로 끌려 내려오고,
--    그것을 풀려면 audit_log_read에 분기를 하나 더 여는 수밖에 없는데 — 그 순간 블록 7이
--    지키려던 것(남의 열람 기록을 가로질러 읽지 못한다)이 같이 무너진다. 정책을 넓히지 않는다.
--    **대신 화면이 "0건"이라고 말하지 않고 "회장 계정에서만 집계됩니다"라고 말한다.**
--    없는 것과 못 보는 것은 다른 사실이고, 그 둘을 같은 '0'으로 그리는 것이 이 블록에서
--    금지된 거짓말이다.
-- ---------------------------------------------------------------------
create view interventions
with (security_invoker = true) as
  select
    a.business_id,
    to_char(a.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM') as period,
    a.action::text as kind,
    count(*) as count
  from audit_log a
 where a.actor_role = 'Chairman'
   and a.action::text in ('approve', 'reject', 'modify', 'delegate')
 group by 1, 2, 3;

comment on view interventions is
  '§7·§34. 회장이 실제로 손댄 횟수. 회사 × 월(KST) × 유형. 위임도 센다 — 빼면 개입이 실제보다 적게 보인다. **audit_log의 FORCE RLS 때문에 회장 세션에서만 행이 나온다**(회장은 누구의 subtree에도 없다). 그 제약을 풀려면 audit_log_read를 넓혀야 하고, 그것은 블록 7이 지키려던 것을 무너뜨린다 — 화면이 "회장 계정에서만 집계됩니다"라고 대신 말한다.';

revoke all on interventions from anon, authenticated;
grant select on interventions to authenticated;

-- ---------------------------------------------------------------------
-- 11. DY 시드 — §34 첫 파일럿
--
--    business_id는 **확인하고 쓴다**: 0003_seed.sql:39의 'biz_dy'다(추측이 아니다).
--    0003은 이미 적용된 파일이라 건드리지 않는다 — 값은 여기서 insert한다.
--    전부 on conflict do nothing이다. 이 파일이 두 번 도는 일은 없지만, 시드가
--    사람이 고친 값을 덮는 경로는 만들지 않는다.
--
--    ■ 넣지 않은 것 ■
--      * **Autonomy 등급.** 문서 어디에도 "DY는 지금 L몇"이 없다(§34는 목표가 L5라고만
--        한다). 지금 L3쯤으로 찍어 두면 다음 분기 평가가 그 숫자에서 출발한다.
--      * **Founder Dependency %.** §35의 37%는 문서의 예시 화면이지 이 저장소의 계산
--        결과가 아니다. 이 값은 세어서 나와야 한다 — 표에 저장하는 칸 자체가 없다.
--        오늘 staging의 decisions는 4건 전부 Open이라 뷰가 null을 낸다. 화면이 그대로 말한다.
--      * **letter 본문 · contact_when.** 문서에 DY의 실제 문구가 없다. 빈 채로 두고
--        화면이 "아직 작성되지 않았습니다"라고 적는다.
--      * **R&D의 이양 상태.** §11의 TRANSFER MATRIX 7줄에 R&D가 없고, §35의 화면 예시에는
--        R&D가 IN PROGRESS로 있다 — **문서 안에서 두 절이 어긋난다.** 한쪽을 고르는 것은
--        추측이라 null로 둔다(원문 지시와 §11이 말한 '이양 7'을 따른다).
-- ---------------------------------------------------------------------

-- 의존 영역 8줄 = 의존도 평가 6 + 이양 계획 7 (겹치는 5)
insert into dependency_areas (business_id, area, area_en, level, transfer_status, sort_order, note)
select * from (values
  ('biz_dy', '가격 결정',   'Pricing',            'HIGH',   'in_progress', 1,
   '§7 Pricing 72% · §11 IN PROGRESS. 이양 진행 중인 유일한 HIGH 영역이다.'),
  ('biz_dy', '주요 거래처', 'Top Customers',      'HIGH',   'not_started', 2,
   '§7 Top Customers 83% · §11 NOT TRANSFERRED. 이 회사에서 회장 의존이 가장 높은 자리.'),
  ('biz_dy', '베트남 투자', 'Vietnam Strategy',   'HIGH',   'not_started', 3,
   '§7 Vietnam Strategy 67% · §11 NOT TRANSFERRED. §20 Priorities 1번이기도 하다.'),
  ('biz_dy', 'R&D',         'R&D',                'MEDIUM', null,          4,
   '§7 R&D 41%. 이양 상태는 비워 둔다 — §11의 TRANSFER MATRIX에 R&D가 없고 §35 화면 예시에는 IN PROGRESS로 있어 문서 안에서 어긋난다. 추측으로 채우지 않았다.'),
  ('biz_dy', '채용',         'Routine Hiring',     'LOW',    'done',        5,
   '§7 Hiring 8% · §11 COMPLETE.'),
  ('biz_dy', '생산',         'Production',         'LOW',    'done',        6,
   '§7 Production 12% · §11 COMPLETE.'),
  ('biz_dy', '국내 영업',    'Domestic Sales',     null,     'done',        7,
   '§11 COMPLETE. 의존도 평가는 아직 없다 — §7의 영역 목록에 없어서 빈 칸으로 둔다.'),
  ('biz_dy', '자본 배분',    'Capital Allocation', null,     'not_started', 8,
   '§11 NOT TRANSFERRED. 의존도 평가는 아직 없다. §13 자본 배분은 블록 C가 들고 온다.')
) as v(business_id, area, area_en, level, transfer_status, sort_order, note)
where exists (select 1 from businesses b where b.business_id = 'biz_dy')
on conflict (business_id, area) do nothing;

-- 부재 테스트 둘 — §34 TARGET의 "30-day absence PASS / 90-day absence PASS"
insert into absence_tests (business_id, days, scheduled_on, result, note)
select * from (values
  ('biz_dy', 30, date '2026-08-03', 'pass',
   '§34 30-day absence PASS. 8월 첫 주. 부재 중 회장 결재 요청 0건.'),
  ('biz_dy', 90, date '2026-12-01', 'pending',
   '§34 90-day absence. 12월 시작 예정. 결과는 치른 뒤에 적는다 — 미리 적을 수 있는 칸이 아니다.')
) as v(business_id, days, scheduled_on, result, note)
where exists (select 1 from businesses b where b.business_id = 'biz_dy')
on conflict (business_id, days, scheduled_on) do nothing;

-- Direction — §20의 DY 예시 그대로. 사용자용 문구라 한국어다(고유명사는 원문 표기).
insert into chairman_directions (business_id, five_year, priorities, do_not)
select
  'biz_dy',
  '글로벌 접착제 네트워크가 된다.',
  array['베트남', '동남아시아', 'Sticky Alliance', '고마진 특수 접착제'],
  array['범용 가격 경쟁', '저마진 확장']
where exists (select 1 from businesses b where b.business_id = 'biz_dy')
on conflict (business_id) do nothing;

commit;
