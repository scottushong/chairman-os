-- =====================================================================
-- Chairman OS — 0025_hierarchy
-- 출처: Phase 6-1 블록 A "위계 + 조직 + 초대 위임"
--       (docs/superpowers/specs/2026-09-20-incoming.md, 2026-09-21 접수)
-- 작성: Phase 6-1 A1 (2026-09-21)
--
-- 무엇이 없어서 만드나
--   지금 이 저장소의 접근 통제는 네 겹이다 — 회사(has_business) · 모듈(can_module) ·
--   역할(auth_role) · 등급(class_rank). 넷이 전부 AND라 촘촘해 보이지만, 같은 회사에서
--   같은 모듈을 여는 사람끼리는 서로의 업무·문서·결정이 그대로 보인다. DY 영업 직원이
--   구매팀장의 업무를 열 수 있다는 뜻이다. 회장이 이번에 더하라고 한 다섯 번째 겹이
--   그 자리다 — **누구든 자기 subtree만 본다.**
--
--   그 subtree를 말하려면 이 스키마에 없는 것이 셋이다.
--     ① 누가 누구 밑인가        user_profiles.reports_to (3절)
--     ② 팀이라는 실체           teams (2절). 지금은 process_charts.team_name이라는
--                               자유 문자열뿐이라 팀장을 가리키지도, 사람을 매달지도 못한다.
--     ③ 선을 넘겨주는 장치      shares (5절). subtree 밖 한 사람에게 한 건만 여는 길.
--   그리고 그 다섯 번째 겹이 **막지 말아야 할 것**을 위해 하나 더 —
--     ④ security_class 'Public' (1절). 공지·규정은 위계와 무관하게 회사 전체가 본다.
--
-- 이 파일이 하지 않는 것 — 기존 정책은 한 줄도 건드리지 않는다
--   위 넷을 실제로 접근 통제에 물리는 일(user_profiles·tasks·decisions·documents·
--   projects·user_invitations·audit_log의 RLS 재작성)은 다음 마이그레이션(0026, 블록 A2)이
--   한다. 한 파일에서 스키마와 정책을 같이 뒤집으면, 무언가 안 보일 때 그것이 새 칸 때문인지
--   새 정책 때문인지 가를 수 없다.
--
--   더 큰 이유는 42P17(infinite recursion)이다. in_my_subtree()가 user_profiles의 정책
--   안으로 들어가는 순간 "정책이 함수를 부르고 → 함수가 그 표를 읽고 → 다시 정책이 돈다"는
--   고리가 생긴다. 이 파일은 그 고리를 끊는 조건(security definer, 4절)을 먼저 갖춘 함수를
--   내놓고 scripts/check-migrations.ts가 그 의미를 못 박게 한 뒤, 정책이 그것을 부르는 일은
--   다음 파일로 미룬다. 함수가 먼저 증명되지 않으면 42P17이 났을 때 "정책을 느슨하게 해서"
--   넘어가고 싶어지는데, 그것은 다섯 번째 겹을 도로 무르는 일이다.
--
-- 55P04 — 이 파일에서 가장 쉽게 터지는 자리
--   1절이 security_class에 'Public'을 더한다. Postgres는 같은 트랜잭션 안에서 방금 만든
--   enum 값을 **리터럴로 쓰는 것**을 거부한다(55P04 unsafe use of new value). 0022가
--   production에서 실제로 이 함정에 걸렸다. 그래서 이 파일 어디에도 security_class 리터럴
--   'Public'은 없다 — class_rank()의 비교는 전부 c::text다. 'Normal'·'Restricted'는 이미
--   있던 값이라 enum 리터럴로 써도 되지만, 한 함수 안에서 어떤 값은 enum으로 어떤 값은
--   text로 비교하면 다음 사람이 그 차이를 규칙으로 읽지 못한다. 넷 다 ::text로 맞춘다.
--
-- 시드를 0003이 아니라 여기 넣는 이유
--   0003_seed.sql은 이미 staging·production에 적용된 파일이다. 적용된 마이그레이션을
--   고치면 체크섬이 드리프트된다(OPERATIONS 9절, 0022가 겪은 일). 앞으로 나아가며 고친다 —
--   0023이 0019의 force를 0019 파일이 아니라 자기 파일에서 내린 것과 같은 규칙이다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 어휘 — security_class에 '공개'를 더한다
--
--    화면 문구는 '공개'고 DB 값은 'Public'이다. 0001의 다른 enum들과 같은 규약이라
--    한글은 src/types/enums.ts의 SECURITY_CLASS_LABEL_KO가 붙인다.
--
--    class_rank()를 반드시 같이 고쳐야 한다. 0002:161의 원래 본문은
--      case c when 'Normal' then 1 when 'Restricted' then 2 else 3 end
--    이라 'Public'이 else로 떨어져 **3 = Vault와 같은 등급**이 된다. 그러면 전 직원이
--    보라고 만든 공지가 회장만 보는 문서로 잠긴다 — 의도와 정확히 반대다. 등급 하나를
--    더하는 일이 '아무것도 안 하면 가장 안전한 쪽으로 실패한다'가 아니라 '아무것도 안 하면
--    정반대로 실패한다'인 드문 자리라, 이 두 문장은 떼어 놓을 수 없다.
--
--    0002의 documents_read(class_rank(security_class) <= class_rank(max_class()))는
--    그대로 둔다. 시그니처가 같아 그 정책은 재작성 없이 새 순서를 탄다 — 기존 정책을
--    건드리지 않는다는 이 파일의 약속이 여기서 값을 한다.
-- ---------------------------------------------------------------------
alter type security_class add value if not exists 'Public';

create or replace function class_rank(c security_class) returns int
language sql immutable as $fn$
  -- ::text 비교인 이유는 머리 주석의 55P04다. 방금 만든 'Public'을 enum 리터럴로 쓰면
  -- 이 트랜잭션이 통째로 터진다.
  select case c::text
    when 'Public'     then 0
    when 'Normal'     then 1
    when 'Restricted' then 2
    else 3
  end;
$fn$;

comment on function class_rank(security_class) is
  '0025. 등급 비교. Public(0) < Normal(1) < Restricted(2) < Vault(3). 같은 트랜잭션에서 방금 만든 enum 값을 리터럴로 쓰면 55P04라 비교는 전부 ::text로 한다.';

-- ---------------------------------------------------------------------
-- 2. teams — 팀이라는 실체
--
--    지금까지 '팀'은 process_charts.team_name이라는 자유 문자열로만 있었다. 문자열은
--    팀장을 가리키지 못하고, 사람을 매달지 못하고, 오타를 막지 못한다('영업'과 '영업팀'이
--    서로 다른 팀이 된다). 조직도(블록 B)가 그릴 뼈대라 표로 세운다.
--
--    team_id는 사람이 읽는 키다. 0001의 businesses(biz_dy)·projects(prj_001)와 같은
--    밑줄 규약을 따른다 — 회장 지시 원문의 예시는 'dy-sales'였지만 이 저장소의 키에
--    하이픈을 쓰는 표가 하나도 없어 규약 쪽을 택했다(브리프도 "기존 표들의 관례를 따른다").
--
--    name_en을 not null로 둔다. 0017이 user_profiles.display_name_en에 null을 허용한 것과
--    다른 판단인데, 그쪽은 **사람 이름**이라 코드가 음차하면 안 되는 값이고 이쪽은 팀을
--    만드는 사람이 그 자리에서 정하면 되는 값이기 때문이다. ko/en 두 벌을 내는 것이 6-1의
--    요구라, 비워 둘 수 있게 하면 영문 화면에 한글 팀 이름이 그대로 나간다.
--
--    lead_user_id는 비어 있을 수 있다. 팀장 공석은 고장이 아니라 상태다(회장 지시:
--    "팀장 부재 시 상위 임원이 자동 승계"). 조직도가 경고로 보여 줄 값이지 제약이 아니다.
-- ---------------------------------------------------------------------
create table teams (
  team_id      text primary key,                                                   -- [일반] team_dy_sales 같은 사람이 읽는 키
  business_id  text not null references businesses(business_id) on delete cascade, -- [일반] 회사 격리의 축
  name         text not null,                                                      -- [일반] '영업'. 화면에 그대로 나간다
  name_en      text not null,                                                      -- [일반] 'Sales'. 영문 화면이 음차하지 않게 한다
  lead_user_id uuid references auth.users(id),                                     -- [제한] 팀장. null = 공석(조직도 경고)
  created_at   timestamptz not null default now(),                                 -- [일반]
  updated_at   timestamptz not null default now()                                  -- [일반]
);

comment on table teams is
  'Phase 6-1 블록 A. 조직도(회사 > 팀 > 사람)의 가운데 층. process_charts.team_name이라는 자유 문자열을 대신한다 — 그쪽은 문자열이라 팀장을 가리키지도 사람을 매달지도 못했다.';
comment on column teams.lead_user_id is
  'null은 고장이 아니라 공석이다. 팀장이 없으면 reports_to 체인을 따라 상위 임원이 승계한다(블록 A2) — 조직도는 이것을 경고로 보여 준다.';
comment on column teams.name_en is
  'ko/en 두 벌이 6-1의 요구다. 0017 display_name_en과 달리 not null인 이유는, 사람 이름은 본인 철자가 유일한 정답이지만 팀 이름은 만드는 사람이 정하면 되는 값이기 때문이다.';

create index teams_by_business on teams (business_id);
create trigger teams_updated_at before update on teams
  for each row execute function set_updated_at();

-- DY 다섯 팀 (회장 지시 원문: 영업·생산·경영지원·구매·연구소).
-- business_id는 추측하지 않고 0003:38의 실제 키(biz_dy)를 확인해서 박았다.
--
-- **RLS를 켜기 전에 넣는다.** 0003_seed.sql 머리 주석이 기록한 함정이다 — FORCE는 표
-- 소유자까지 정책 아래로 끌어내리는데, 마이그레이션 세션은 auth.uid()가 null이라
-- auth_role()도 null이다. 아래 teams_write(`auth_role() = 'Chairman'`)를 통과하지 못한다.
-- 0003은 그래서 넣는 동안만 NO FORCE로 내렸다 올렸지만, 이 표는 이 파일에서 처음 만들므로
-- 더 간단한 길이 있다: RLS를 켜기 전에 넣는다. 나중에 이 파일에 시드 행을 더하는 사람은
-- 반드시 이 지점(아래 alter table ... enable 앞)에 넣어야 한다.
-- PGlite 검사는 superuser로 돌아 이 함정을 못 잡는다 — 0023의
-- definerUnderNonBypassOwner() 주석이 같은 한계를 적어 두었다.
--
-- on conflict do nothing인 이유: 이 표는 사람이 앱에서 팀을 더하는 표라, 재적용이나
-- 손으로 만든 같은 키가 있으면 마이그레이션이 사람의 데이터를 밀어내지 않고 비켜선다.
-- lead_user_id는 비워 둔다 — 팀장이 누구인지는 운영이 정할 일이고, UID를 마이그레이션에
-- 박으면 staging과 production이 서로 다른 사람을 가리킨다(0017 1절과 같은 이유).
insert into teams (team_id, business_id, name, name_en) values
  ('team_dy_sales',      'biz_dy', '영업',     'Sales'),
  ('team_dy_production', 'biz_dy', '생산',     'Production'),
  ('team_dy_support',    'biz_dy', '경영지원', 'Management Support'),
  ('team_dy_purchasing', 'biz_dy', '구매',     'Purchasing'),
  ('team_dy_rnd',        'biz_dy', '연구소',   'R&D')
on conflict (team_id) do nothing;

-- RLS — 읽기는 회사 격리, 쓰기는 Chairman.
--   회장 지시 원문 블록 B: "회장만: 팀 추가·이름·팀장 지정·회사 간 이동."
--   읽기를 subtree로 자르지 않는 이유: 팀 **이름**은 조직의 뼈대이지 비밀이 아니다.
--   다섯 번째 겹이 자르는 것은 '사람과 그 사람의 일'이고(0026), 그 사람들이 매달릴
--   뼈대까지 감추면 조직도는 화면이 아니라 빈 상자가 된다. 회사 격리(has_business)는
--   그대로라 남의 회사 팀은 여전히 존재하지 않는 것처럼 보인다.
--
--   force를 건다(0002 원칙 1). 5절 shares와 다른 판단인데, 이 표를 읽는 security definer
--   함수가 하나도 없기 때문이다 — 0023 3절 ③의 함정(FORCE가 소유자를 정책 아래로 끌어내려
--   definer 함수가 0행을 준다)이 여기서는 성립하지 않는다. 나중에 이 표를 읽는 definer
--   함수를 만드는 사람은 그 줄을 쓰기 전에 이 문단을 먼저 읽어야 한다.
alter table teams enable row level security;
alter table teams force  row level security;

create policy teams_read on teams
  for select using (has_business(business_id));
create policy teams_write on teams
  for all using (is_active() and auth_role() = 'Chairman')
  with check (is_active() and auth_role() = 'Chairman');

-- Integration(ECOUNT 동기화 계정)은 조직 구조를 만들지 않는다. 위의 permissive 정책만으로도
-- 이미 막히지만(Integration은 Chairman이 아니다), 나중에 누가 teams_write를 느슨하게 고쳐도
-- 이 방어선은 남는다 — 0021 process_charts_integration_no_write와 같은 모양이다.
create policy teams_integration_no_write on teams as restrictive for all
  using (not is_integration())
  with check (not is_integration());

-- ---------------------------------------------------------------------
-- 3. user_profiles — 위계와 재직 상태
--
--    reports_to가 이 파일 전체의 축이다. 이 칸 하나로 조직이 트리가 되고, 4절의
--    in_my_subtree()가 그 트리를 내려간다. Chairman은 null이다 — 뿌리 위에는 아무도 없다.
--
--    status와 revoked_at을 둘 다 두는 이유(둘을 합치지 않는다)
--      revoked_at은 '권한을 끊었다'다. 0002 원칙 8이 약속하는 그 칸 — 채우는 순간 전
--      테이블이 동시에 닫힌다. status는 '재직 상태'다. 퇴사자는 보통 둘 다지만 둘은
--      같은 사건이 아니다. 휴직·파견은 재직 상태만 바뀌고 권한은 살아 있을 수 있고,
--      사고 대응으로 권한만 급히 끊는 날은 그 사람이 아직 재직 중이다. 한 칸으로 합치면
--      둘 중 하나는 반드시 거짓말이 된다.
--
--    status를 enum이 아니라 text + check로 둔 이유
--      값이 둘뿐이고 늘어날 계획이 없다. 새 enum 타입을 만들면 언젠가 값을 더하는 날
--      이 파일이 1절에서 겪은 55P04 함정을 그 사람이 다시 만난다. 두 값짜리 어휘에
--      그 비용을 물릴 이유가 없다.
--
--    **이 파일이 적용된 직후 reports_to는 전원 null이다.** 새 칸이라 채울 값이 없다 —
--    그 상태에서 in_my_subtree()는 자기 자신 말고 아무도 주지 않는다. Chairman도 마찬가지다
--    (뿌리가 전원을 덮는 것은 사람들이 실제로 체인으로 매달려 있을 때의 이야기다).
--    그래서 **0026이 이 함수를 정책에 걸기 전에 트리가 먼저 서야 한다** — 조직도(블록 B)로
--    채우든 0026이 백필하든, 둘 중 하나가 없으면 정책을 뒤집는 순간 모든 화면이 빈다.
--    이 파일은 백필을 하지 않는다: '누가 누구 밑인가'는 스키마가 지어낼 수 있는 값이 아니고,
--    마이그레이션이 지어낸 조직도는 틀렸다는 것조차 아무도 모르는 채로 굳는다.
--
--    joined_on/left_on은 date다. '오늘'이 필요한 계산(30일 입퇴사 이력 등, 블록 B)은
--    언제나 KST로 한다 — SQL에서는 (now() at time zone 'Asia/Seoul')::date이고
--    current_date(서버 UTC)는 쓰지 않는다. 0019 3절·0023 5절이 같은 계산을 쓴다.
-- ---------------------------------------------------------------------
alter table user_profiles
  add column if not exists reports_to uuid references auth.users(id),
  add column if not exists team_id    text references teams(team_id),
  add column if not exists status     text not null default 'active'
    constraint user_profiles_status check (status in ('active', 'left')),
  add column if not exists joined_on  date,
  add column if not exists left_on    date;

comment on column user_profiles.reports_to is
  '직속 상사. Chairman은 null이다 — 뿌리 위에는 아무도 없다. in_my_subtree()가 이 칸만 따라 내려간다. 순환은 아래 user_profiles_no_cycle 트리거가 막는다.';
comment on column user_profiles.status is
  '재직 상태. revoked_at(권한 회수)과 같은 사건이 아니다 — 휴직은 status만 바뀌고, 사고 대응으로 권한만 끊는 날은 revoked_at만 찬다.';
comment on column user_profiles.team_id is
  '소속 팀. null이면 팀 미배정이고, 조직도가 경고로 보여 준다(블록 B).';

-- in_my_subtree()의 재귀가 매 단계 where reports_to = ? 로 한 층씩 내려간다.
-- 인덱스가 없으면 조직 깊이만큼 user_profiles 전체 스캔이 반복되고, 그 비용을 모든
-- 정책 판정이 문장마다 문다(0026이 이 함수를 7개 표의 정책에 건다).
create index user_profiles_by_reports_to on user_profiles (reports_to);

-- 순환 금지
--   트리가 고리가 되면 in_my_subtree()의 재귀가 끝나지 않는다. 4절이 깊이 상한으로
--   한 번 더 막지만, 상한은 '터지지 않는다'를 지킬 뿐 '누가 누구 밑인가'를 되돌려 주지
--   못한다 — 고리 안의 사람들은 서로의 subtree에 들어가 서로를 다 보게 된다.
--   그래서 고리는 만들어지는 순간에 막는다.
--
--   두 가지를 본다.
--     ① 자기 자신을 직속 상사로 지정하는 것(길이 1짜리 고리). 아래 재귀는 조상 쪽에서
--        출발하므로 이 경우를 스스로 잡지 못한다 — 따로 본다.
--     ② new.reports_to에서 위로 올라가는 조상 체인에 new.user_id가 있는가.
--        update일 때 재귀가 읽는 것은 아직 바뀌지 않은 옛 값이다(before 트리거).
--        그래도 판정은 옳다 — 우리가 묻는 것은 "저 위에 내가 있는가"뿐이고,
--        그 체인은 이번 update가 건드리지 않는 다른 행들로 이루어져 있다.
--
--   한계 하나를 적어 둔다. 한 문장이 여러 행의 reports_to를 동시에 바꾸면(A와 B를 한
--   update로 맞바꾸는 경우) before 행 트리거가 보는 스냅샷에는 같은 문장의 다른 행 변경이
--   보이지 않아 고리를 놓칠 수 있다. 앱의 경로는 한 사람씩 바꾸는 것뿐이고(블록 B의
--   '상사 변경'), 그래서 4절의 깊이 상한을 두 번째 방어선으로 남겨 둔다.
create or replace function user_profiles_no_cycle() returns trigger
language plpgsql as $fn$
declare
  cyclic boolean;
begin
  if new.reports_to is null then
    return new;
  end if;

  if new.reports_to = new.user_id then
    raise exception using errcode = 'P0001',
      message = '자기 자신을 직속 상사로 지정할 수 없습니다.',
      detail  = format('user_id=%s', new.user_id);
  end if;

  with recursive ancestors(user_id, reports_to, depth) as (
    select p.user_id, p.reports_to, 1
      from user_profiles p
     where p.user_id = new.reports_to
    union all
    select p.user_id, p.reports_to, a.depth + 1
      from user_profiles p
      join ancestors a on p.user_id = a.reports_to
     -- 이미 고리가 있는 표(예: 이 트리거가 없던 시절에 들어간 값)에서도 이 질의 자체는
     -- 끝나야 한다. 상한에 걸려 멈추면 그 아래 exists는 false가 될 수 있지만, 그때는
     -- 이미 4절의 깊이 상한이 그 고리를 subtree 밖으로 밀어낸다.
     where a.depth < 64
  )
  select exists (select 1 from ancestors a where a.user_id = new.user_id) into cyclic;

  if cyclic then
    raise exception using errcode = 'P0001',
      message = '보고 체계에 순환이 생깁니다. 이미 내 아래에 있는 사람을 직속 상사로 지정할 수 없습니다.',
      detail  = format('user_id=%s, reports_to=%s', new.user_id, new.reports_to);
  end if;

  return new;
end;
$fn$;

comment on function user_profiles_no_cycle() is
  '0025. reports_to가 고리를 만들지 못하게 한다. 고리는 in_my_subtree()의 재귀를 끝나지 않게 만들 뿐 아니라, 고리 안의 사람들이 서로를 전부 보게 만든다.';

-- update of reports_to — 그 칸을 건드리는 문장에서만 돈다. 다른 칸만 바꾸는 update는
-- 고리를 만들 수 없으므로 재귀 질의를 돌릴 이유가 없다.
create trigger user_profiles_no_cycle
  before insert or update of reports_to on user_profiles
  for each row execute function user_profiles_no_cycle();

-- ---------------------------------------------------------------------
-- 4. in_my_subtree(target_user_id) — 다섯 번째 겹의 판정 하나
--
--    의미: auth.uid()를 뿌리로 하는 subtree(자기 자신 포함)에 target_user_id가 있는가.
--    0026이 이 함수를 user_profiles·tasks·decisions·documents·projects·
--    user_invitations·audit_log의 정책에서 부른다.
--
--    **security definer여야 한다.** 이 함수는 user_profiles를 읽는다. 0026이 이것을
--    user_profiles의 select 정책 안에서 부르는 순간, invoker 권한이면 함수의 읽기가 다시
--    그 정책을 불러 42P17(infinite recursion)이 난다. definer는 그 고리를 끊는다 —
--    0002의 auth_profile()·has_business()가 같은 이유로 전부 definer인 것과 같다.
--    42P17을 만나면 정책을 느슨하게 해서 넘기는 것이 아니라 여기(definer 설정 · 함수가
--    읽는 경로)를 본다.
--
--    퇴사자·권한 회수자가 경로를 끊지 않는다 — 의도한 판단이다
--      status='left'이거나 revoked_at이 찬 사람을 재귀에서 걸러 내면, 팀장이 퇴사한 날
--      그 팀 전체가 임원의 화면에서 통째로 사라진다. 사람이 나간 것이 조직이 사라진 것이
--      될 수는 없다(회장 지시: "팀장 부재 시 상위 임원이 자동 승계"). 그래서 아무것도
--      거르지 않는다 — 나간 사람 자신도 subtree 안이라 true다. '그 사람을 지금 볼 수
--      있는가'는 이 함수가 아니라 정책의 다른 겹(is_active() 등)이 따로 판정한다.
--      이 함수는 오직 '트리에서 내 아래인가'만 대답한다.
--
--    깊이 상한 20 — 3절 트리거가 있어도 두 번째 방어선을 둔다. 트리거가 놓치는 자리가
--      하나 있고(3절 마지막 문단, 한 문장으로 여러 행을 바꾸는 경우), 트리거가 생기기
--      전에 들어간 값도 있을 수 있다. 이 함수는 모든 정책 판정마다 도는 자리라,
--      여기서 끝나지 않으면 앱 전체가 멈춘다. 20은 이 조직의 실제 깊이(회사 > 임원 >
--      팀장 > 직원, 4단)보다 한참 크고 무한보다는 한참 작다.
-- ---------------------------------------------------------------------
create or replace function in_my_subtree(target_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  with recursive subtree(user_id, depth) as (
    -- 뿌리는 호출자 자신이다. auth.uid()가 null이면(로그인 없는 세션) 앵커가 null 한 줄이라
    -- 아래 join이 한 층도 내려가지 못하고, exists는 false가 된다 — 조용히 아무것도 아니다.
    select auth.uid(), 0
    union all
    select p.user_id, s.depth + 1
      from user_profiles p
      join subtree s on p.reports_to = s.user_id
     where s.depth < 20
  )
  select exists (select 1 from subtree where user_id = target_user_id);
$fn$;

comment on function in_my_subtree(uuid) is
  '0025. Phase 6-1의 다섯 번째 겹. auth.uid()의 subtree(자기 자신 포함)에 대상이 있는가. security definer가 아니면 0026이 이것을 user_profiles의 정책에서 부르는 순간 42P17이 난다. 퇴사자·권한 회수자도 경로를 끊지 않는다 — 사람이 나간 것이 그 아래 조직이 사라진 것이 될 수는 없다.';

-- 0019·0023과 같은 이유로 public 기본 execute 권한을 먼저 걷고 필요한 역할에만 다시 준다.
-- security definer 함수에서 public 기본값은 곧 "anon도 RPC로 부를 수 있다"는 뜻이다.
revoke all on function in_my_subtree(uuid) from public;
grant execute on function in_my_subtree(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. shares — subtree 밖으로 한 건만 넘기는 길
--
--    다섯 번째 겹은 기본값이지 감옥이 아니다. 구매팀장이 영업팀장에게 계약서 한 건을
--    보여 줘야 하는 날이 있고, 그때 답이 "역할을 올려 준다"가 되면 겹 전체가 무의미해진다.
--    이 표가 그 예외를 **한 건 · 한 사람 · 기간 한정**으로 좁힌다.
--
--    entity_id가 text인 이유: 대상 셋의 기본키가 전부 text다 — documents.document_id,
--    tasks.task_id, projects.project_id(0001). 확인하고 맞췄다.
--
--    FK를 걸지 않는다(걸 수 없다). 한 칸이 세 표를 가리키기 때문이다. 대상이 지워지면
--    이 표에 유령 행이 남지만, shared_with_me()가 true를 줘도 대상 표의 정책은 없는 행을
--    내주지 못하므로 새는 것은 없다. 유령은 블록 C의 '공유받은 목록'에서 사람이 지운다.
--
--    expires_at null = 무기한. 기간을 강제하지 않는 이유는, 무기한이 필요한 공유(상시
--    참조하는 규정 문서)가 실제로 있고 그것을 못 하게 하면 사람이 대신 등급을 낮춘다 —
--    한 사람에게 한 건을 여는 것보다 훨씬 넓은 구멍이다.
--
--    감사 기록은 audit_log에 남는다. action은 **기존 enum 값**을 쓴다 —
--    공유는 delegate, 회수는 permission_change. 새 값을 만들지 않는다(1절의 55P04이기도
--    하고, 이미 뜻이 맞는 값이 있다). 실제로 남기는 일은 0026/블록 C의 서버 액션이 한다.
-- ---------------------------------------------------------------------
create table shares (
  share_id     uuid primary key default gen_random_uuid(),              -- [일반]
  entity_table text not null                                            -- [일반] 대상 표. 셋뿐이다
    constraint shares_entity_table check (entity_table in ('documents', 'tasks', 'projects')),
  entity_id    text not null,                                           -- [일반] 대상 셋의 기본키가 전부 text다
  shared_with  uuid not null references auth.users(id) on delete cascade, -- [제한] 받는 사람
  shared_by    uuid not null references auth.users(id),                 -- [제한] 연 사람. 회수할 수 있는 유일한 사람이다
  expires_at   timestamptz,                                             -- [일반] null = 무기한
  created_at   timestamptz not null default now(),                      -- [일반]
  -- 같은 사람에게 같은 것을 두 번 공유하지 않는다. 두 행이 되면 '회수'가 한 행만 지우고
  -- 다른 행이 남아, 회수한 사람은 닫혔다고 믿는데 상대는 계속 보는 상태가 된다.
  unique (entity_table, entity_id, shared_with)
);

comment on table shares is
  'Phase 6-1 블록 A. subtree 밖 한 사람에게 한 건만 여는 예외. 기간이 있으면 기간이 끝나는 순간 닫힌다 — 사람이 회수를 잊어도 닫힌다는 것이 이 표의 요점이다.';
comment on column shares.entity_id is
  '세 표를 가리키므로 FK를 걸 수 없다. 대상이 지워지면 유령 행이 남지만, 대상 표의 정책이 없는 행을 내주지 못하므로 새는 것은 없다.';
comment on column shares.expires_at is
  'null = 무기한. 기간을 강제하지 않는 이유는, 못 하게 하면 사람이 대신 문서 등급을 낮추기 때문이다 — 그쪽이 훨씬 넓은 구멍이다.';

-- 0026의 정책이 이 방향으로 조회한다: "내가 받은 것 중에 이 행이 있는가."
create index shares_by_recipient on shares (shared_with, entity_table, entity_id);

-- RLS
--   읽기  내가 받은 것 + 내가 한 공유. 남이 남에게 한 공유는 존재도 보이지 않는다.
--   회수  내가 한 공유만. 받은 사람은 스스로 지우지 못한다 — 회수는 연 사람의 권한이고,
--         받은 쪽이 지울 수 있으면 '누구에게 열려 있나'를 연 사람이 알 수 없게 된다.
--   수정  정책을 만들지 않는다(Default Deny). 기간 연장은 회수 후 다시 공유다 —
--         한 행을 늘렸다 줄였다 하면 audit_log에 '언제까지였는가'가 남지 않는다.
--
--   **insert는 열지 않는다.** 공유를 만들 수 있는 사람은 "그 대상을 볼 수 있는 사람"인데,
--   '볼 수 있다'의 정의가 바로 0026(A2)이 쓰는 것이다. 지금 permissive insert 정책을
--   하나라도 만들면 그 정의가 없는 채로 문이 열린다 — 아무나 아무 document_id나 적어
--   행을 만들 수 있고, 0026이 적용되는 순간 그 행들이 소급해서 가시성이 된다.
--
--   그래서 permissive 정책은 만들지 않고(Default Deny로 닫힌 채 둔다), 대신 restrictive로
--   `shared_by = auth.uid()` 한 조건만 미리 박아 둔다. restrictive는 혼자서 아무것도
--   허용하지 못하므로 문은 여전히 닫혀 있고, 0026이 permissive 정책을 더하는 날
--   "남의 이름으로 공유를 만들 수 없다"는 이 조건은 그 정책이 무엇으로 쓰이든 남는다
--   (0017·0019의 integration_no_* 방어선과 같은 모양이다).
--   **0026이 할 일: 대상 가시성 조건을 담은 permissive insert 정책 하나를 더한다.**
--
--   force를 걸지 않는다 — 2절 teams와 다른 판단이다. 아래 shared_with_me()가 이 표를 읽는
--   security definer 함수이고, 0023 3절 ③이 적어 둔 함정이 정확히 여기에 있다: 소유자가
--   BYPASSRLS가 아니면 FORCE가 그 함수를 자기 정책 아래로 끌어내려, 공유받은 사람이
--   자기 것을 못 보는 게 아니라 **0026의 모든 정책에서 공유 겹이 통째로 조용히 사라진다.**
alter table shares enable row level security;

create policy shares_read on shares
  for select using (is_active() and (shared_with = auth.uid() or shared_by = auth.uid()));
create policy shares_revoke on shares
  for delete using (is_active() and shared_by = auth.uid());

create policy shares_insert_is_self on shares as restrictive for insert
  with check (shared_by = auth.uid());

-- Integration(ECOUNT 동기화 계정)은 공유를 만들지 않는다. 지금은 insert 자체가 닫혀 있어
-- 겹치는 방어선이지만, 0026이 permissive insert를 더하는 날 이 줄이 남아 있어야 한다.
create policy shares_integration_no_write on shares as restrictive for all
  using (not is_integration())
  with check (not is_integration());

-- 0026의 정책들이 부르는 조회 헬퍼.
--   definer인 이유는 in_my_subtree()와 같다 — 정책 안에서 이 표를 다시 RLS로 막지 않는다.
--   만료 비교를 함수 안에 가두는 이유: 정책마다 expires_at 조건을 따로 쓰면 언젠가 한 곳이
--   그것을 빠뜨리고, 그 표에서만 만료된 공유가 영원히 살아 있게 된다.
create or replace function shared_with_me(p_table text, p_id text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from shares s
     where s.entity_table = p_table
       and s.entity_id    = p_id
       and s.shared_with  = auth.uid()
       and (s.expires_at is null or s.expires_at > now())
  );
$fn$;

comment on function shared_with_me(text, text) is
  '0025. 이 행이 지금 나에게 공유되어 있는가. 만료 판정을 이 함수 안에 가둔 이유는, 정책마다 expires_at 조건을 따로 쓰면 언젠가 한 곳이 그것을 빠뜨리기 때문이다.';

revoke all on function shared_with_me(text, text) from public;
grant execute on function shared_with_me(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. 초대 위임 — user_invitations.chairman_approval_required
--
--    지금 초대는 Chairman만 할 수 있다(0011의 user_invitations_admin). 회장 지시는
--    그것을 subtree로 위임한다 — 팀장은 자기 subtree 안으로 사람을 부를 수 있고,
--    다만 역할이 Executive 이상이면 회장 결재를 거친다.
--
--    이 파일은 그 '거친다'를 담을 칸 하나만 놓는다. 누가 초대할 수 있는가(정책)와 결재
--    큐가 어떻게 도는가(동작)는 0026/블록 B다. invited_by는 0011:51에 이미 있다 —
--    확인했고 다시 만들지 않는다.
--
--    default false인 이유: 이미 들어와 있는 초대 행들은 전부 회장이 직접 넣은 것이라
--    결재가 필요 없다. true를 기본으로 하면 적용하는 순간 과거의 미수락 초대가 전부
--    결재 대기로 바뀐다.
-- ---------------------------------------------------------------------
alter table user_invitations
  add column if not exists chairman_approval_required boolean not null default false;

comment on column user_invitations.chairman_approval_required is
  '초대 위임(6-1). 팀장·임원이 자기 subtree로 부른 사람 중 역할이 Executive 이상이면 true가 되어 회장 결재 큐로 간다. 판정과 큐 동작은 0026/블록 B가 한다.';

commit;

-- 확인:
--   select team_id, name, name_en from teams where business_id = 'biz_dy' order by team_id;
--   select class_rank('Public'::security_class), class_rank('Vault'::security_class);
--   select display_name, reports_to, team_id, status from user_profiles order by display_name;
