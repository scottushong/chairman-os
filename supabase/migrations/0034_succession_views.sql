-- =====================================================================
-- 0034. 승계 뷰 둘을 스펙대로 다시 세운다 (전방 수정)
--
-- 0033이 뷰 둘을 `security_invoker = true`로 만들었고, 그 결과 둘 다 원문과 어긋난다.
-- 원문(`2026-09-20-incoming.md`의 A절) 한 줄: **RLS: Chairman·GroupCFO 읽기·쓰기.
-- CEO 자기 회사 읽기. 나머지 거부.**
--
--   ① `interventions`가 GroupCFO에게도 CEO에게도 0행이다. `audit_log`에 FORCE가 걸려 있고
--      (0002:200) `audit_log_read`는 회장/본인/subtree뿐인데(0031 6절) 회장은 누구의
--      subtree에도 없다. 원문은 GroupCFO에게 읽기를 줬다 — 스펙 미달이다.
--   ② `founder_dependency`가 보는 사람마다 다른 %를 낸다. 0026이 `decisions_read`에 얹은
--      다섯 번째 겹 때문이다. **회사의 의존도는 보는 사람에 따라 달라지면 안 된다.**
--
-- ---------------------------------------------------------------------
-- 먼저 실증했다 — 0033 10절의 주장은 **맞다.** 그리고 0024:15의 주장도 맞다.
-- ---------------------------------------------------------------------
-- 0033:534~537이 "definer 함수로 열어 줄 수도 없다. FORCE가 걸린 표는 소유자도 정책 아래로
-- 끌려 내려온다"고 적고, 0024:15는 검사가 RPC를 "owner(security definer) 권한으로만 돌렸을
-- 뿐"이라 RLS가 막는 자리를 못 밟았다고 적는다. 둘이 어긋나 보이지만 **둘 다 맞았다 —
-- 서로 다른 소유자를 말하고 있었다.** PGlite에 0001~0033을 올리고 BYPASSRLS 없는 소유자를
-- 세워 같은 몸통을 네 가지로 불러 확인했다(GroupCFO 세션 · 회장 actor 줄 2개가 있는 상태):
--
--     raw=0   invoker(app_owner)=0   definer(app_owner)=0   definer(postgres/superuser)=2
--
-- 마지막 칸만 값을 내는데, PGlite의 postgres가 superuser라 RLS를 통째로 건너뛰기 때문이다.
-- 0027 1절이 배포 환경의 사실을 이미 못 박아 두었다 — *"소유자가 BYPASSRLS가 아니면
-- (Supabase의 postgres가 그렇다) definer가 **조용히 0행**을 받는다."*
--
-- 다른 길도 다 닫혀 있다. 함수 소유자를 표 소유자가 아닌 제3의 역할로 두어도 ENABLE RLS가
-- 그대로 걸려 0행이고, `set local row_security = off`는 우회가 아니라 **에러**다
-- (`query would be affected by row-level security policy`). BYPASSRLS 없는 역할에게 그
-- GUC는 "조용히 지나가기"가 아니라 "걸리면 실패하기"다.
--
-- 그래서 "뷰 둘을 definer 집계 문으로"라는 처음 설계는 **그대로는 성립하지 않는다.**
-- 두 절반을 다르게 닫는다.
--
--   ② `decisions`의 force를 내린다 → definer 집계 문이 성립한다 (2·3절)
--   ① `audit_log`의 force는 **내리지 않는다** → 집계 전용 표를 만든다 (4·5·6·7절)
--
-- 두 표를 하나로 묶어 처리하는 것이 이 파일이 피하는 실수다. `audit_log`에는
-- `read`·`login` 줄이 있다 — 누가 언제 무엇을 열어 봤나다. `decisions`에는 그런 줄이 없다.
--
-- ---------------------------------------------------------------------
-- 넘지 않은 경계
-- ---------------------------------------------------------------------
-- **`audit_log_read`를 한 글자도 넓히지 않았다.** 이 파일에는 그 정책을 건드리는 문장이
-- 하나도 없다(위 주석에 이름이 나올 뿐이다 — 검사가 주석을 걷고 그것을 단언한다).
-- 블록 7이 지킨 것(남의 열람 기록을 가로질러 읽지 못한다)이 이 일의 경계다.
--
-- 0001~0033은 한 글자도 고치지 않는다. 이미 적용된 마이그레이션을 고치면 체크섬이
-- 드리프트된다(OPERATIONS 9, 0022가 겪은 일). 앞으로 나아가며 고친다.
--
-- `audit_action` enum에 새 값을 만들지 않는다(55P04 — 0022가 production에서 겪었다).
-- 이 파일은 어휘를 건드리지 않는다. `service_role`도 없다(CLAUDE.md).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 뷰 둘을 먼저 내린다
--
--    둘 다 **읽는 대상 자체가** 바뀐다(decisions → 집계 문 / audit_log → 집계 표).
--    `create or replace view`로도 칸 이름·타입이 같으면 통과하지만, 그 문장은 옛 정의의
--    옵션을 조용히 물려받는다. 내리고 다시 세우면 `security_invoker`와 grant·revoke가
--    **이 파일에 전부 적힌 대로**만 남는다 — 무엇이 걸려 있는지 다음 사람이 한 곳에서 읽는다.
--
--    뷰를 내리는 것은 값을 버리는 일이 아니다 — 뷰에는 행이 없다.
-- ---------------------------------------------------------------------
drop view if exists founder_dependency;
drop view if exists interventions;

-- ---------------------------------------------------------------------
-- 2. ② `decisions`의 force를 내린다
--
--    **표를 여는 것이 아니다.** 0027 1절과 0029 3절이 `projects`와 `user_settings`에
--    같은 판단을 했고, 그 둘은 staging·production에서 살아 있다. enable도 정책도 그대로라
--    `authenticated`로 붙는 실제 경로(앱은 PostgREST뿐 — 0002 원칙 6)는 `decisions_read`의
--    겹 다섯을 한 줄도 빠짐없이 탄다. 내려가는 것은 **'소유자도 정책을 받는가'** 하나뿐이고,
--    그 자리의 실제 자물쇠는 revoke다(0023 3절 ①).
--
--    FORCE가 여기서 더해 주는 보안은 없고, 더하는 것은 침묵 실패 위험뿐이다 — 3절의
--    집계 문이 정확히 그 함정 위에 선다. 내리지 않으면 `founder_dependency`는 production
--    에서만 계정마다 다른 %를 주고, PGlite harness는 superuser라 그것을 **통과시킨다**
--    (검사가 초록인 채 production만 깨지는 최악의 모양이다 — 0027:60).
--
--    `projects`와 마찬가지로 두 번 걸려 있다: 0002:196이 걸고 0003:597이 시드 뒤에 다시
--    건다. 0002·0003 파일은 건드리지 않는다.
--
--    `scripts/check-migrations.ts`의 force 카탈로그가 이 줄을 지킨다 — 누가 되살리면 빨개진다.
-- ---------------------------------------------------------------------
alter table public.decisions no force row level security;

-- ---------------------------------------------------------------------
-- 3. ② `founder_dependency` — §7의 식 **그대로**, 집계는 소유자의 눈으로
--
--    식은 0033 9절에서 **한 글자도 바꾸지 않고** 옮겼다. 특히 이 셋은 그 블록이 지키려던
--    것이라 건드리지 않는다:
--      · `decided_by_kind is null`인 행은 **분자에서도 분모에서도** 빠지고 `unknown_count`로
--        따로 나온다. 분모에만 남기면(= CEO 결정으로 세면) 지표가 좋아 보인다.
--      · `status = 'Open'`인 결정은 아예 안 센다 — '누가 정했나'가 없는 행이다.
--      · 달은 KST다. `current_date`를 쓰지 않는다(0019 3절).
--
--    **바뀐 것은 '누구의 눈으로 세는가' 하나다.** 집계는 소유자의 눈으로 전부 세고,
--    그 다음에 **회사 단위로** 보여 줄지 말지를 정한다. 판정은 0033:412의
--    `can_read_succession()`을 **그대로 쓴다** — 새로 만들지 않는다. 승계 표 넷과 이 지표가
--    다른 답을 하는 날이 오면 안 되고, 두 벌이 되는 순간 한쪽만 고쳐진다.
--      Chairman·GroupCFO  전부
--      BusinessCEO        `has_business(target)`인 회사만
--      그 밖              0행 (오류가 아니라 0행)
--    그 함수가 `is_active()`를 먼저 본다 — `revoked_at`이 찍힌 계정은 아무것도 못 읽는다(원칙 8).
--
--    § 어느 칸도 새로 내주지 않는다 § 반환 칸은 0033 뷰와 **같은 여덟**이다. 결정의 제목도,
--    기안자도, 처리자도 없다 — 숫자뿐이다. 0026의 겹이 지키던 것은 '어느 결정을 볼 수
--    있는가'이고, 이 문이 내주는 것은 '그 회사에서 몇 건이었나'다. 그 둘은 다른 사실이다.
--
--    § AIAgent·Integration § 두 역할은 `can_read_succession()`을 통과하지 못하므로 0행이다.
--    야간 Job이 이 숫자를 필요로 하는 경로는 오늘 없다. 필요해지면 그때 낸다.
-- ---------------------------------------------------------------------
create or replace function founder_dependency_rows()
returns table (
  business_id     text,
  period          text,
  chairman_count  bigint,
  ceo_count       bigint,
  rule_count      bigint,
  total_count     bigint,
  unknown_count   bigint,
  dependency_pct  numeric
)
language sql stable security definer set search_path = public as $fn$
  select
    d.business_id,
    to_char(
      coalesce(d.decided_at, d.created_at) at time zone 'Asia/Seoul', 'YYYY-MM'
    ),
    count(*) filter (where d.decided_by_kind = 'chairman'),
    count(*) filter (where d.decided_by_kind = 'ceo'),
    count(*) filter (where d.decided_by_kind = 'rule'),
    count(*) filter (where d.decided_by_kind is not null),
    count(*) filter (where d.decided_by_kind is null),
    case
      when count(*) filter (where d.decided_by_kind is not null) = 0 then null
      else round(
        count(*) filter (where d.decided_by_kind = 'chairman')::numeric * 100
        / count(*) filter (where d.decided_by_kind is not null), 1)
    end
  from decisions d
 where d.status <> 'Open'
   and can_read_succession(d.business_id)
 group by 1, 2;
$fn$;

comment on function founder_dependency_rows() is
  '§7 Founder Dependency Index의 유일한 문. 집계는 소유자의 눈으로 하고(2절이 decisions의 force를 내렸다) 회사 단위 판정만 can_read_succession()에 맡긴다 — 회사의 의존도는 보는 사람에 따라 달라지지 않는다. 반환 칸은 숫자 여덟뿐이고 결정의 제목·기안자·처리자는 하나도 없다.';

-- 0019 3절이 그 이유를 적어 뒀다: Postgres는 새 함수의 execute를 public에 기본으로 주고,
-- security definer 함수에서 그 기본값은 곧 "anon도 RPC로 부를 수 있다"는 뜻이다. 몸통이
-- can_read_succession()으로 걸러 anon에게는 0행이지만, 기본 권한을 남겨 두지 않는다 —
-- 나중에 몸통이 한 줄 바뀌는 날 그 기본값이 구멍이 된다.
revoke all on function founder_dependency_rows() from public;
grant execute on function founder_dependency_rows() to authenticated;

/*
 * 뷰는 `security_invoker = true`다. **이 파일의 뷰 둘 다 그렇고, 이유가 같다:
 * 문은 늘 뷰보다 한 층 아래에 둔다.**
 *
 * 여기서 뷰가 하는 일은 이름을 빌려주는 것뿐이다 — 판정은 전부 함수 몸통에 있다.
 * invoker면 호출자가 자기 권한으로 함수를 부르므로 위의 grant가 실제로 재어진다.
 * definer(기본값)로 두면 함수의 execute를 **뷰 소유자**의 권한으로 확인하게 되어,
 * grant가 빠진 날에도 화면이 멀쩡히 돌고 검사만 그 사실을 놓친다.
 * 문이 둘이 되는 것도 피한다 — 뷰와 함수가 각자 판정하면 언젠가 한쪽만 고쳐진다.
 *
 * 칸 이름·타입은 0033과 같다. `supabase.ts`의 select 문자열이 한 글자도 안 바뀐다.
 */
create view founder_dependency
with (security_invoker = true) as
  select * from founder_dependency_rows();

comment on view founder_dependency is
  '§7 Founder Dependency Index. 회사 × 월(KST). chairman/(chairman+ceo+rule)×100. **decided_by_kind가 null인 행은 분자에서도 분모에서도 빠지고 unknown_count로 따로 나온다.** 처리되지 않은 결정(Open)은 아예 세지 않는다. 0034부터 **회사의 값은 보는 사람과 무관하게 같다** — founder_dependency_rows()가 소유자의 눈으로 세고 회사 단위 판정만 can_read_succession()에 맡긴다.';

revoke all on founder_dependency from anon, authenticated;
grant select on founder_dependency to authenticated;

-- ---------------------------------------------------------------------
-- 4. ① `intervention_counts` — 집계 전용 표. **`audit_log`의 force는 내리지 않는다.**
--
--    0031 2절이 바로 이 질문 앞에서 force를 내리기를 **거절하고** `activity_digest`를
--    지었다. 그 거절은 옳고 여기서 뒤집지 않는다. `decisions`와 `audit_log`가 다른 이유:
--    `audit_log`에는 `read`·`login` 줄이 있다 — 누가 언제 무엇을 열어 봤나다. force를
--    내리면 앞으로 누가 definer 함수 하나만 잘못 쓰면 그 줄까지 닿고, 막는 것은
--    '우리가 조심한다'뿐이 된다. 블록 7이 지킨 것은 그런 방어선이 아니었다.
--
--    § 이 표에 무엇이 없는지가 이 표의 요점이다 §
--    칸은 회사·달·유형·건수 넷과 `updated_at`뿐이다. `entity_id`·`actor_user_id`·
--    `before`/`after`·`note`가 한 칸이라도 들어오면 이 표는 `audit_log`의 사본이 되고,
--    그 순간 정책을 넓히지 않고도 정책을 우회한 것이 된다. `activity_digest`가 사람·경로·
--    도시를 한 칸도 두지 않은 것과 같은 규율이다. 검사가 칸 이름 집합을 못 박는다.
--
--    § force를 걸지 않는다 § 이 저장소가 네 번 밟은 함정이다(0023·0027·0029). 5절의
--    트리거가 소유자 권한으로 이 표에 쓰는데, force를 걸면 그 쓰기가 정책 아래로 내려가
--    **조용히 아무것도 안 쓴다.** 자물쇠는 revoke다.
--
--    § 쓰기 권한은 아무에게도 주지 않는다 § 이 표를 쓰는 것은 5절의 트리거 하나뿐이다.
--    restrictive 정책(0031 2절)을 따로 두지 않은 이유: 여기에는 **permissive 쓰기 정책이
--    하나도 없어** insert·update·delete가 이미 default deny다. Supabase의 default
--    privileges로 grant가 되살아나는 날에도 정책이 없으면 한 줄도 못 쓴다 — restrictive를
--    얹어도 잴 것이 없다. 0033이 승계 표 넷에 같은 판단을 했다.
-- ---------------------------------------------------------------------
create table intervention_counts (
  business_id text not null references businesses(business_id) on delete cascade, -- [일반]
  period      text not null,                                 -- [일반] YYYY-MM, KST
  kind        text not null,                                 -- [일반] approve·reject·modify·delegate
  count       bigint not null default 0,                     -- [일반] 건수. **이 표에는 이 숫자뿐이다**
  updated_at  timestamptz not null default now(),            -- [일반]
  primary key (business_id, period, kind)
);

comment on table intervention_counts is
  '§7·§34. 회장이 손댄 횟수의 집계 전용 표. 회사 × 월(KST) × 유형 × 건수가 전부다 — entity_id·actor·before/after·note는 한 칸도 없다. audit_log의 FORCE를 내리는 대신 이 표를 둔다(0031 activity_digest와 같은 규율). 쓰는 것은 audit_log의 after-insert 트리거 하나뿐이고, 사람에게는 쓰기 권한이 없다.';

-- 자물쇠는 revoke다(0023 3절 ①). Supabase는 public 스키마의 새 표를 만들자마자
-- anon/authenticated에게 열어 버린다(postgres 역할의 default privileges).
revoke all on table intervention_counts from anon, authenticated;
grant select on table intervention_counts to authenticated;

alter table intervention_counts enable row level security;

-- 읽기 판정은 0033:412의 것을 **그대로** 쓴다 — 승계 표 넷·§7 지표·이 표가 세 벌로
-- 갈라지지 않게. 원문대로 Chairman·GroupCFO 전체 / BusinessCEO는 자기 회사 /
-- Executive·TeamLead·Member·AIAgent·Integration은 0행이다.
create policy intervention_counts_read on intervention_counts
  for select using (can_read_succession(business_id));

-- ---------------------------------------------------------------------
-- 5. ① 트리거 — 감사 줄이 남는 순간 건수 하나가 오른다
--
--    `record_read()`(0031 6절)가 세운 모양이다: security definer · set search_path.
--    definer여야 하는 이유는 우회가 아니라 **권한**이다 — 4절이 이 표의 쓰기 권한을
--    아무에게도 주지 않았으므로, 트리거가 호출자(`authenticated`) 권한으로 돌면 42501이
--    나서 감사 줄 자체가 안 남는다.
--
--    § 세는 것 § `actor_role = 'Chairman'`이고 `action`이 승인·반려·수정·**위임** 넷인 줄.
--    위임도 회장이 그 건을 **손댄** 것이고, 빼면 개입 횟수가 실제보다 적게 보인다 —
--    지표를 좋아 보이게 만드는 방향의 누락은 이 블록에서 가장 조심하는 것이다.
--    `business_id`가 null인 줄은 건너뛴다. 어느 회사의 개입인지 모르는 줄을 아무 회사에나
--    얹을 수는 없고, 그 줄은 `audit_log`에 그대로 남아 있다.
--
--    `actor_role`은 **그 시점에 기록된 역할 문자열**이다. 지금 회장이 아닌 사람이 과거에
--    회장으로 처리한 줄도 그대로 '회장 개입'으로 센다 — 그것이 그때의 사실이다.
--
--    § 이 트리거는 감사 줄의 insert를 **절대 실패시키지 않는다** § 기록이 먼저이고 집계는
--    나중이다(HANDOVER 2절 ③). 집계가 터져서 감사 줄이 안 남는 일은 없어야 한다 —
--    `audit_log`는 append only이고, 남지 않은 줄은 되살릴 방법이 없다. 그래서 몸통을
--    예외 블록으로 감싼다. 예외 블록은 서브트랜잭션이라 집계만 되돌아가고 바깥의
--    insert는 그대로 커밋된다. 집계가 틀리면 다시 셀 수 있지만 기록은 다시 만들 수 없다.
--
--    after 트리거라 반환값은 무시된다. `null`을 돌려준다.
-- ---------------------------------------------------------------------
create or replace function interventions_bump() returns trigger
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if new.actor_role = 'Chairman'
     and new.action::text in ('approve', 'reject', 'modify', 'delegate')
     and new.business_id is not null
  then
    begin
      insert into intervention_counts (business_id, period, kind, count, updated_at)
      values (
        new.business_id,
        to_char(new.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM'),
        new.action::text,
        1,
        now()
      )
      on conflict (business_id, period, kind) do update
        set count = intervention_counts.count + 1,
            updated_at = now();
    exception when others then
      -- 기록이 먼저, 집계는 나중(HANDOVER 2절 ③). 집계 실패로 감사 줄을 잃지 않는다.
      null;
    end;
  end if;
  return null;
end;
$fn$;

comment on function interventions_bump() is
  '§7·§34. audit_log의 after-insert 트리거. 회장의 승인·반려·수정·위임 한 줄이 남을 때 intervention_counts의 건수 하나를 올린다. **감사 줄의 insert를 절대 실패시키지 않는다** — 집계는 예외 블록 안에서 돌고, 터지면 조용히 포기한다(기록이 먼저, 집계는 나중).';

-- 이 함수를 부르는 것은 아래 트리거뿐이다. 0019 3절과 같은 이유로 public 기본 execute를
-- 걷되, **다시 주지 않는다** — 사람이 부를 자리가 없는 함수다.
revoke all on function interventions_bump() from public;

create trigger audit_log_interventions
  after insert on audit_log
  for each row execute function interventions_bump();

-- ---------------------------------------------------------------------
-- 6. ① 과거분 채우기 — **경계가 분명한 창 하나**
--
--    트리거만 달면 0034 이전의 회장 개입이 영원히 0이다. §34가 12개월 추이를 요구하므로
--    그 침묵은 곧 거짓이 된다("개입 없음"과 "0034 이전이라 안 셌음"은 다른 사실이다).
--
--    § 왜 창이 필요한가 § 이 마이그레이션은 소유자 권한으로 돈다. `audit_log`에 FORCE가
--    걸려 있으면 **소유자마저** `audit_log_read` 아래로 내려가는데, 마이그레이션 세션에는
--    JWT가 없어 `auth_role()`도 `auth.uid()`도 null이다 — 정책의 세 분기가 전부 거짓이라
--    아래 select가 **예외 없이 조용히 0행**이 된다. 0027 1절이 적은 그 함정이고, 여기서는
--    아무도 눈치채지 못한 채 12개월 추이가 통째로 비는 모양으로 나타난다.
--
--    § 왜 영구히 내리지 않는가 § 4절에 적었다. `audit_log`의 FORCE는 이 저장소가 감사
--    기록에 대해 의도적으로 고른 두 번째 방어선이고, 0031 2절이 그것을 지키려고 표를
--    하나 더 만들었다. 이 창은 **같은 트랜잭션 안**에서 열고 닫힌다. 커밋된 뒤의 상태는
--    오늘과 글자 하나까지 같다 — `check-migrations.ts`가 "audit_log에는 force가 있다"를
--    단언해 그것을 다음 사람이 확인할 수 있게 한다.
--
--    § 소유자가 BYPASSRLS인 환경에서는 § 이 창이 아무 일도 하지 않는다(이미 지나간다).
--    양쪽 다에서 같은 결과를 내는 것이 이 세 줄의 요점이다.
--
--    § 순서가 요점이다 — 트리거(5절)가 **먼저**이고 backfill이 나중이다 §
--    `create trigger`가 audit_log에 ACCESS EXCLUSIVE 락을 잡으므로, 그 시점부터 커밋까지
--    다른 세션의 insert는 막힌다. 아래 select는 그 락을 잡은 뒤에 도니 **그 순간까지
--    커밋된 줄 전부**를 본다(read committed). 반대 순서로 두면 select와 create trigger
--    사이에 커밋된 줄이 둘 다에서 빠진다 — backfill은 못 봤고 트리거는 아직 없었다.
--    빠진 줄은 예외도 경고도 없이 그냥 세어지지 않으므로, 그 틈은 열어 두지 않는다.
--
--    `on conflict do nothing` — 이 마이그레이션이 두 번 도는 일은 없지만, 시드가 사람이
--    고친 값을 덮는 경로는 만들지 않는다(0033 11절과 같은 규율).
-- ---------------------------------------------------------------------
alter table public.audit_log no force row level security;

insert into intervention_counts (business_id, period, kind, count, updated_at)
select
  a.business_id,
  to_char(a.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM'),
  a.action::text,
  count(*),
  now()
from audit_log a
where a.actor_role = 'Chairman'
  and a.action::text in ('approve', 'reject', 'modify', 'delegate')
  and a.business_id is not null
  and exists (select 1 from businesses b where b.business_id = a.business_id)
group by 1, 2, 3
on conflict (business_id, period, kind) do nothing;

alter table public.audit_log force row level security;

-- ---------------------------------------------------------------------
-- 7. ① 뷰 `interventions` — 이름도 칸도 그대로
--
--    어댑터(`supabase.ts:3788~3795`)가 `.from('interventions')`로 읽고 칸 이름을 문자열로
--    나열한다. 이름과 칸 넷(`business_id,period,kind,count`)과 타입을 그대로 유지하는 것이
--    성공 조건이라, 읽는 대상만 `audit_log`에서 `intervention_counts`로 바뀐다.
--
--    `security_invoker = true`인 이유는 3절과 같다 — **문은 뷰보다 한 층 아래에 둔다.**
--    여기서 그 문은 4절의 `intervention_counts_read` 정책이다. definer로 두면 뷰가 그
--    정책을 지나가 버려서, select 권한만 있으면 누구나 전사 개입 건수를 보게 된다 —
--    고치려던 것보다 더 넓다.
-- ---------------------------------------------------------------------
create view interventions
with (security_invoker = true) as
  select c.business_id, c.period, c.kind, c.count
    from intervention_counts c;

comment on view interventions is
  '§7·§34. 회장이 실제로 손댄 횟수. 회사 × 월(KST) × 유형. 위임도 센다 — 빼면 개입이 실제보다 적게 보인다. 0034부터 **audit_log가 아니라 intervention_counts를 읽는다**: audit_log의 FORCE를 내리지 않고 원문의 가시성(Chairman·GroupCFO 전체 / CEO 자기 회사)을 주려고 집계 전용 표를 두었다. Executive·TeamLead·Member는 여전히 0행이고, 화면은 그것을 "0건"이라고 말하지 않는다.';

revoke all on interventions from anon, authenticated;
grant select on interventions to authenticated;

commit;
