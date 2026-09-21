-- =====================================================================
-- Chairman OS — 0031_activity_log
-- 출처: docs/superpowers/specs/2026-09-20-incoming.md `## 블록 7 — 회장 전용 접속 현황`
-- 작성: 블록 7 회장 전용 접속 현황 /settings/activity (2026-09-21)
--
-- 이것은 **사람의 행동을 기록하는 기능**이다. 잘못 만들면 감시 도구가 되고, 못 만들면
-- 감사가 안 된다. 그래서 이 파일이 하는 일의 절반은 '기록하는 것'이고 나머지 절반은
-- '기록하지 않는 것'이다. 아래 네 줄이 그 절반이다.
--
--   ① IP 원본을 남길 칸도, 그것을 받을 **인자도 없다.**  record_read()의 시그니처에
--      p_ip가 없다. 칸만 비워 두면 언젠가 누가 채운다 — 받을 자리를 아예 안 만든다.
--      도시까지다(Vercel x-vercel-ip-city). 한 번 새면 되돌릴 수 없는 종류의 값이다.
--   ② 기기는 **요약**만이다. 'Chrome · Windows' 한 줄. 원문 User-Agent가 통째로 실려
--      오면 버린다(아래 4절의 guard) — 요약이 아닌 것을 기록하느니 안 하는 것이 낫다.
--   ③ **보관 기간 180일.** 그 뒤로는 회장에게도, 본인에게도 보이지 않는다(5절).
--      audit_log는 append-only라 행을 지우지 않는다 — 지울 수 있게 만드는 순간
--      감사 기록이 아니게 된다. 대신 **읽을 수 있는 사람을 0명으로** 만든다.
--   ④ 같은 화면 5분 내 재진입은 1회다. 이 억제는 **DB 안에서** 일어난다(4절) —
--      클라이언트가 "이번엔 안 보낼게"를 정하면 그것은 기록이 아니다.
--
-- 하지 않는 것
--   * **새 표를 만들지 않는다(열람 기록은).** audit_log가 이미 append-only이고
--     (0001의 revoke update,delete + audit_log_is_append_only() 트리거 둘), 회장 읽기
--     정책도 있다. 열람 기록은 action='read' 한 줄이다.
--   * **새 audit_action 값을 만들지 않는다.** 'read'도 'login'도 0001에 이미 있다.
--     0022가 production에서 55P04로 터진 자리다.
--   * **force row level security를 새로 걸지 않는다.** 0023 kakao_token · chairman_checkins ·
--     0027 projects · 0029 user_settings에서 네 번 만난 함정이다. 자물쇠는 revoke다.
--   * **append-only 장치를 건드리지 않는다.** 0001의 revoke도 트리거 둘도 그대로다.
--     audit_log의 FORCE도 그대로 둔다 — 그것을 내리면 소유자 권한으로 도는 모든 definer
--     함수가 남의 열람 기록을 가로질러 읽을 수 있게 된다. 이 기능이 지키려는 것이
--     정확히 그 가로지르기다(7절에 이 제약이 야간 Job에 무엇을 뜻하는지 적었다).
--
-- 마이그레이션 번호
--   프로필 사진(Storage)은 이 파일에 넣지 않고 0032로 뺐다. 둘은 서로 다른 딜리버러블이고
--   커밋도 따로다 — 한 파일에 넣으면 앞 커밋이 뒤 커밋의 내용을 이미 들고 있게 된다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 열람 기록을 찾는 인덱스
--
--    화면이 매번 묻는 질문은 "최근 N일의 read·login 전부, 최신순"이다. audit_log에는
--    장부·문서·결정의 기록이 같이 쌓이므로 action으로 먼저 좁히지 않으면 전체 스캔이 된다.
--    부분 인덱스로 둔다 — 이 표의 대부분은 read도 login도 아니다.
--
--    'read'·'login'은 0001이 만든 값이라 같은 트랜잭션에서 갓 추가한 enum 리터럴이
--    아니다(55P04가 걸릴 자리가 아니다).
-- ---------------------------------------------------------------------
create index audit_log_activity
  on audit_log (occurred_at desc)
  where action = 'read' or action = 'login';

-- ---------------------------------------------------------------------
-- 2. activity_digest — 브리핑 한 줄이 읽는 **숫자만**의 표
--
--    왜 표가 하나 더 필요한가. audit_log에는 FORCE row level security가 걸려 있다(0002:200).
--    FORCE는 소유자까지 정책 아래로 끌어내리므로, security definer 함수도 **부르는 사람이
--    볼 수 있는 것 이상을 못 본다.** 야간 Job(AIAgent 세션)은 남의 열람 기록을 한 줄도
--    못 읽는다 — 그리고 그것이 옳다. 읽게 해 주려면 audit_log_read에 AIAgent 분기를
--    열어야 하는데, 그 순간 이 기능이 지키려던 것이 무너진다.
--
--    그래서 브리핑에는 **집계된 숫자만** 간다. 이 표에는 사람도 경로도 도시도 없다 —
--    '이번 주 접속 84건 · 문서 열람 21건 · 활동한 사람 7명'이 전부다. 원문이 요구한
--    "주간 요약을 ChairmanContext에 → 브리핑 한 줄"이 그것이고, 요약이지 명단이 아니다.
--
--    people은 '이번 주에 한 번이라도 기록을 남긴 사람 수'다. record_read()가 그 사람의
--    **자기 기록**을 보고 이번 주 첫 줄일 때만 1을 더한다(자기 기록은 본인도 읽을 수 있다 —
--    audit_log_read의 actor_user_id = auth.uid() 분기). 누구인지는 어디에도 안 남는다.
--
--    주 시작은 KST 월요일이다. 이 저장소의 '오늘'은 KST다(아침 알림 판정만 회장 현지
--    날짜이고, 그 자리는 0029가 정한 대로 건드리지 않는다).
-- ---------------------------------------------------------------------
create table activity_digest (
  week_start  date primary key,                        -- [일반] KST 월요일
  events      integer not null default 0,              -- [일반] 그 주의 열람 기록 줄 수
  doc_reads   integer not null default 0,              -- [일반] 그중 문서 열람
  people      integer not null default 0,              -- [일반] 한 번이라도 기록을 남긴 사람 수
  updated_at  timestamptz not null default now()       -- [일반]
);

comment on table activity_digest is
  '블록 7. 브리핑 한 줄이 읽는 주간 집계. 사람·경로·도시가 한 칸도 없다 — 야간 Job(AIAgent)은 audit_log의 FORCE RLS 때문에 남의 열람 기록을 못 읽고, 읽게 해 주는 것이 이 기능이 막으려는 일이기 때문이다. 요약이지 명단이 아니다.';

-- 자물쇠는 revoke다(0023 3절 ①). Supabase는 public 스키마의 새 표를 만들자마자
-- anon/authenticated에게 여므로 걷고 필요한 것만 다시 준다.
-- **쓰기 권한은 아무에게도 주지 않는다.** 이 표를 쓰는 것은 record_read() 하나뿐이고,
-- 그 함수는 소유자 권한으로 돈다(이 표에는 force를 걸지 않았다 — 그래서 definer가 통과한다).
revoke all on table activity_digest from anon, authenticated;
grant select on table activity_digest to authenticated;

alter table activity_digest enable row level security;

-- 읽기: 회장과 야간 Job. GroupCFO에게도 주지 않는다 — 접속 현황은 회장 전용이다.
create policy activity_digest_read on activity_digest for select
  using (is_active() and auth_role() in ('Chairman', 'AIAgent'));

-- Integration(ECOUNT 동기화 계정)은 이 표에 닿을 일이 없다. grant가 이미 없지만,
-- Supabase의 default privileges로 grant가 되살아나는 날을 대비해 제한 정책을 같이 둔다
-- (0029 5절 ② · 0030 2절 ④와 같은 이유).
create policy integration_no_insert on activity_digest as restrictive for insert
  with check (not is_integration());
create policy integration_no_update on activity_digest as restrictive for update
  using (not is_integration()) with check (not is_integration());
create policy integration_no_delete on activity_digest as restrictive for delete
  using (not is_integration());

-- ---------------------------------------------------------------------
-- 3. 남기는 값을 좁히는 순수 함수 둘
--
--    한 곳에 모아 둔다. 기록하는 함수가 둘(record_read · record_login_failure)이고,
--    둘이 각자 정규화를 하면 언젠가 한쪽만 고쳐진다.
-- ---------------------------------------------------------------------

/**
 * 기기 요약을 받아들일 것인가.
 *
 * 앱(lib/activity.ts summarizeUserAgent)이 'Chrome · Windows' 한 줄로 줄여서 보낸다.
 * 여기는 그 약속이 깨졌을 때의 마지막 문이다 — 원문 User-Agent가 통째로 실려 오면
 * (Mozilla/… AppleWebKit/… 같은 조각이 보이면) **버린다.** 잘라서 저장하지 않는다:
 * 잘린 UA는 여전히 지문이고, 화면에서는 요약처럼 보여 아무도 이상하게 여기지 않는다.
 * 60자 상한은 그 위의 안전핀이다.
 */
create or replace function activity_device(raw text) returns text
language sql immutable set search_path = public as $fn$
  select case
    when raw is null or btrim(raw) = '' then null
    when raw ~ '(Mozilla|AppleWebKit|Gecko/|Version/[0-9])' then null
    else left(btrim(raw), 60)
  end;
$fn$;

comment on function activity_device(text) is
  '블록 7. 기기 칸에 들어갈 수 있는 값. 원문 User-Agent로 보이면 null로 버린다 — 잘라서 저장하면 여전히 지문인데 화면에서는 요약처럼 보인다.';

/**
 * 도시를 받아들일 것인가. **IP 원본이 이 칸으로 새는 것을 막는 자리다.**
 *
 * record_read()에는 p_ip 인자가 없다. 그래도 도시 칸에 IP를 넣어 보내는 호출자가
 * 생길 수 있고(앱의 버그 한 줄이면 된다), 그러면 이 파일의 제일 앞 약속이 조용히
 * 깨진 채로 몇 달이 간다. 숫자 넷으로 된 점 표기나 콜론이 든 문자열은 도시 이름이 아니다.
 *
 * 'Seoul, KR'처럼 나라 코드가 붙는 것은 허용한다 — 같은 이름의 도시를 구분하는 값이고
 * 여전히 도시 단위다.
 */
create or replace function activity_city(raw text) returns text
language sql immutable set search_path = public as $fn$
  select case
    when raw is null or btrim(raw) = '' then null
    -- IPv4 점 표기
    when btrim(raw) ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' then null
    -- IPv6(콜론). 도시 이름에 콜론이 들어가는 경우는 없다.
    when btrim(raw) like '%:%' then null
    else left(btrim(raw), 60)
  end;
$fn$;

comment on function activity_city(text) is
  '블록 7. 도시 칸에 들어갈 수 있는 값. IP처럼 보이면 null로 버린다 — record_read()에 p_ip 인자가 없어도 앱의 버그 한 줄이면 이 칸으로 샐 수 있다.';

-- ---------------------------------------------------------------------
-- 4. record_read — 열람 기록 한 줄. **5분 중복 억제가 여기 있다.**
--
--    왜 DB 안인가. 브리프가 "중복 억제를 서버에서 해라, 클라이언트가 '이번엔 안 보낼게'를
--    정하면 그것은 기록이 아니다"라고 했다. Next 서버도 서버지만, 앱 서버에 두면
--    (a) 두 요청이 겹칠 때 둘 다 "최근 기록 없음"을 보고 둘 다 넣는 경합이 남고,
--    (b) 앱을 거치지 않고 PostgREST로 직접 audit_log에 넣는 길이 그대로 열려 있다.
--    함수 안에서 같은 트랜잭션으로 보고-넣으면 그 둘이 같이 닫힌다.
--
--    왜 security definer인가. 이 함수가 하는 일은 **정확히 한 종류의 행 한 줄**을 넣는
--    것이고, 그 문을 좁게 두기 위해서다(0023 kakao_token_save()와 같은 모양).
--    audit_log에는 FORCE가 걸려 있어 이 함수도 정책을 그대로 받는다 —
--    insert는 audit_log_insert(is_active())가, 중복 검사의 select는 audit_log_read의
--    `actor_user_id = auth.uid()` 분기가 통과시킨다. **RLS를 우회하는 새 경로가 아니다.**
--
--    예외를 던지지 않고 boolean을 돌려준다. 호출자가 화면이라 500보다 '기록 안 됨'이 낫다.
--    true = 이번에 한 줄 남겼다 / false = 억제됐거나 기록 대상이 아니다.
--
--    AIAgent·Integration은 여기로 들어오지 못한다. 그 둘은 화면을 보지 않고,
--    audit_log_insert 정책의 그들 분기는 'read'를 통과시키지 않아 42501이 난다 —
--    던지기 전에 먼저 false로 돌려보낸다.
-- ---------------------------------------------------------------------
create or replace function record_read(
  p_path         text,
  p_kind         text default 'page',
  p_entity_id    text default null,
  p_entity_table text default null,
  p_business_id  text default null,
  p_device       text default null,
  p_city         text default null
) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_uid    uuid := auth.uid();
  v_role   app_role;
  v_path   text := left(btrim(coalesce(p_path, '')), 200);
  v_kind   text;
  v_week   date;
  v_first  boolean;
begin
  if v_uid is null or not is_active() then
    return false;
  end if;

  v_role := auth_role();
  -- 시스템 계정은 화면을 보지 않는다. 이 둘이 들어오면 기록이 아니라 버그다.
  if v_role in ('AIAgent', 'Integration') then
    return false;
  end if;

  -- 경로 없는 열람 기록은 나중에 읽을 수 없다. 화면이 무엇인지가 이 기록의 뼈대다.
  if v_path = '' or v_path not like '/%' then
    return false;
  end if;

  -- 모르는 종류는 '페이지 진입'으로 접는다. 종류는 화면의 묶음일 뿐이고,
  -- 여기서 거부하면 오타 하나가 기록을 통째로 잃게 만든다.
  v_kind := case when p_kind in ('page', 'document', 'finance') then p_kind else 'page' end;

  /*
   * 5분 중복 억제. **같은 사람, 같은 경로**가 키다.
   *
   * 경로가 키인 이유: 브리프가 말한 '같은 화면'이 곧 경로다. 문서마다 경로가 다르므로
   * 문서 A를 보고 문서 B를 보면 두 줄이 남는다 — 그것이 맞다. 새로고침 한 번에 기록이
   * 수십 줄이 되는 것을 막는 것이 이 억제의 목적이고, 그 순간 이 표는 읽을 수 없는
   * 것이 되어 감사 도구가 아니게 된다.
   *
   * 억제된 재진입은 아무 데도 안 남는다. '몇 번 새로고침했나'는 감사에 필요한 사실이
   * 아니고, 그것을 세기 시작하면 이 표가 사람의 손가락을 세는 표가 된다.
   */
  if exists (
    select 1 from audit_log
     where actor_user_id = v_uid
       and action = 'read'
       and after->>'path' = v_path
       and occurred_at > now() - interval '5 minutes'
  ) then
    return false;
  end if;

  -- 2절의 people. audit_log 쪽 insert보다 **먼저** 본다 — 뒤에 보면 방금 넣은 줄 때문에
  -- 늘 false가 되어 people이 한 번도 안 오른다.
  v_week := date_trunc('week', (now() at time zone 'Asia/Seoul'))::date;
  v_first := not exists (
    select 1 from audit_log
     where actor_user_id = v_uid
       and action = 'read'
       and occurred_at >= (v_week::timestamp at time zone 'Asia/Seoul')
  );

  /*
   * entity_table을 'screen'으로 둔다. 진짜 표 이름('documents')을 넣으면 그 문서의
   * 변경 이력 화면(listEntityAudit은 entity_table로 고른다)이 열람 기록으로 뒤덮인다 —
   * 그 화면은 "이 문서에 무슨 일이 있었나"를 묻는 자리지 "누가 몇 번 열었나"가 아니다.
   * 무엇을 열었는지는 entity_id와 after.entity_table이 같이 들고 있어 접속 현황 화면이
   * 그대로 읽는다.
   */
  insert into audit_log (
    actor_user_id, actor_role, action, entity_table, entity_id, business_id, after, note
  ) values (
    v_uid, v_role::text, 'read', 'screen', nullif(btrim(coalesce(p_entity_id, '')), ''), p_business_id,
    jsonb_strip_nulls(jsonb_build_object(
      'path',         v_path,
      'kind',         v_kind,
      'entity_table', nullif(btrim(coalesce(p_entity_table, '')), ''),
      'device',       activity_device(p_device),
      'city',         activity_city(p_city),
      -- 시간대는 호출자가 보내지 않는다. 0029가 이미 user_settings.current_tz에 받아 두었고
      -- (브라우저만 아는 값이라 브라우저가 알려 주는 수밖에 없다), 여기서 그 값을 읽는다.
      -- 없으면 null이다 — 화면은 '—'를 그린다. 서울로 추측하지 않는다.
      'tz',           (select current_tz from user_settings where user_id = v_uid)
    )),
    case v_kind when 'document' then '문서 열람' when 'finance' then '재무 화면 조회' else '페이지 진입' end
  );

  insert into activity_digest (week_start, events, doc_reads, people)
  values (
    v_week, 1,
    case when v_kind = 'document' then 1 else 0 end,
    case when v_first then 1 else 0 end
  )
  on conflict (week_start) do update set
    events     = activity_digest.events    + 1,
    doc_reads  = activity_digest.doc_reads + excluded.doc_reads,
    people     = activity_digest.people    + excluded.people,
    updated_at = now();

  return true;
end;
$fn$;

comment on function record_read(text, text, text, text, text, text, text) is
  '블록 7. 열람 기록 한 줄(audit_log action=read). 같은 사람·같은 경로의 5분 내 재진입은 여기서 억제한다 — 억제를 앱에 두면 경합이 남고 PostgREST로 직접 넣는 길도 열려 있다. **p_ip 인자가 없다** — 도시까지다.';

revoke all on function record_read(text, text, text, text, text, text, text) from public;
grant execute on function record_read(text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. 실패한 로그인 — 세션이 없는 사람이 남기는 유일한 줄
--
--    원문이 "오늘 로그인(성공·실패)"을 요구한다. 성공은 쉽다 — 그 순간 세션이 있어서
--    앱이 자기 이름으로 audit_log에 넣는다(actions/auth.ts, 0001부터 그래 왔다).
--    실패는 **세션이 없다.** auth.uid()가 null이고, audit_log_insert의 is_active()가
--    막는다. FORCE가 걸려 있어 definer 함수도 그 정책을 그대로 받는다.
--
--    그래서 정책에 익명 분기를 하나 연다. 그 분기는 최대한 좁다:
--    action='login' + entity_table='auth.users' + actor가 지목돼 있고 + before가 없고 +
--    after.ok가 'false'. 그리고 **anon에게서 audit_log의 INSERT 권한을 걷는다** —
--    이 저장소의 자물쇠는 revoke다(0023 3절 ①). 권한이 없으면 정책을 따지기 전에 42501이다.
--    소유자 권한으로 도는 아래 함수만 이 분기를 지난다.
--
--    함수는 **실재하는 활성 계정에 대해서만** 남긴다. 모르는 이메일로는 한 줄도 안 생긴다 —
--    그래야 이 문이 아무나 audit_log를 부풀리는 통로가 되지 않는다. 계정 존재 여부가
--    새지도 않는다: 이 기록을 읽는 사람은 회장뿐이고, 로그인 화면은 어느 쪽이든 같은
--    문구를 돌려준다(actions/auth.ts messageKo).
--
--    ■ 남은 구멍 ■ 실재하는 이메일 하나를 아는 사람은 이 문으로 줄을 계속 만들 수 있다.
--    DB 안에서 막지 못한다 — 횟수를 세려면 audit_log를 읽어야 하는데 익명 세션에는
--    그 정책이 한 줄도 안 준다(FORCE). 그래서 앞단에서 막는다: 앱은 **자격 증명이 실제로
--    틀렸을 때만**(invalid_credentials) 이 함수를 부르고, 그 앞에는 GoTrue의 자체
--    요청 제한(over_request_rate_limit)이 서 있다. 이 사실을 report.md에 적었다.
-- ---------------------------------------------------------------------
revoke insert on table audit_log from anon;

drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log
  for insert with check (
    case
      -- 익명(로그인 실패). 0024가 세운 아래 분기들은 전부 is_active()를 전제하는데
      -- 이 줄만 세션이 없다. 그래서 case 바깥으로 빼지 않고 첫 분기로 둔다.
      when auth.uid() is null
        then action::text = 'login'
         and entity_table = 'auth.users'
         and actor_user_id is not null
         and actor_role is not null
         and before is null
         and coalesce(after->>'ok', '') = 'false'
      when not is_active() then false
      when auth_role() = 'AIAgent'
        then action::text in ('night_job_completed', 'kakao_sent', 'kakao_failed') and actor_user_id = auth.uid()
      when is_integration()
        then action::text = 'ecount_sync_completed' and actor_user_id = auth.uid()
      else true
    end
  );

create or replace function record_login_failure(
  p_email  text,
  p_device text default null,
  p_city   text default null
) returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_uid  uuid;
  v_role app_role;
begin
  -- 이미 로그인한 사람이 실패를 남길 일은 없다. 이 문은 익명 전용이다.
  if auth.uid() is not null then
    return;
  end if;

  select p.user_id, p.role into v_uid, v_role
    from auth.users u
    join user_profiles p on p.user_id = u.id
   where lower(u.email) = lower(btrim(coalesce(p_email, '')))
     and p.revoked_at is null;

  -- 모르는 이메일이면 아무것도 남기지 않는다. 이 문이 부풀리기 통로가 되지 않게 하는 줄이다.
  if v_uid is null then
    return;
  end if;

  insert into audit_log (
    actor_user_id, actor_role, action, entity_table, entity_id, after, note
  ) values (
    v_uid, v_role::text, 'login', 'auth.users', v_uid::text,
    jsonb_strip_nulls(jsonb_build_object(
      'ok',     'false',
      'path',   '/login',
      'device', activity_device(p_device),
      'city',   activity_city(p_city)
    )),
    '로그인 실패'
  );
end;
$fn$;

comment on function record_login_failure(text, text, text) is
  '블록 7. 실패한 로그인 한 줄. 세션이 없는 유일한 기록 경로라 audit_log_insert에 익명 분기가 하나 있다 — 그 대신 anon에게서 INSERT 권한을 걷었고(자물쇠는 revoke), 실재하는 활성 계정에 대해서만 남긴다.';

revoke all on function record_login_failure(text, text, text) from public;
-- anon에게 execute를 준다. 로그인 화면은 세션이 없는 자리다.
grant execute on function record_login_failure(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. 보관 기간 180일 — 지우지 않고, **읽을 수 있는 사람을 0명으로** 만든다
--
--    보관 기간을 정하지 않으면 영구 보관이고, 그것을 고지 없이 하는 것이 이 기능의
--    유일한 진짜 위험이다. 그래서 정한다: **열람 기록(action='read')은 180일.**
--
--    왜 180일인가. 짧으면 감사가 안 된다 — 분기 결산·연 1회 외부 점검·"작년 그 건을
--    누가 봤나" 같은 질문은 한 분기를 넘어간다. 길면 감시 도구가 된다 — 2년 치 동선은
--    누구에게도 필요 없고, 있으면 언젠가 다른 용도로 쓰인다. 반년은 그 사이에서
--    "지난 분기 전부 + 그 앞 한 분기"가 남는 지점이다.
--
--    왜 지우지 않는가. audit_log는 append-only다(0001의 revoke update,delete + 트리거 둘).
--    지울 수 있게 만드는 순간 감사 기록이 아니게 된다 — '지워진 줄'과 '없던 일'을
--    구분할 방법이 사라진다. 그래서 행은 남기고 **정책이 아무에게도 안 준다.**
--    회장에게도, 본인에게도, 상사에게도 0건이다. /privacy에 이대로 적었다.
--
--    기존 세 분기(0002의 Chairman·본인 + 0026의 subtree)는 한 글자도 안 바꾼다.
--    앞에 AND로 시간 창 하나를 더할 뿐이고, 그 창은 action='read'에만 걸린다 —
--    장부·문서·결정의 기록은 지금까지처럼 기간 제한 없이 보인다. 그쪽은 회계·계약
--    기록이라 보존 기간이 다르고, 이 파일이 그것을 줄일 권한은 없다.
--
--    action::text로 비교하는 것은 0022~0024의 관례를 따르는 것이다(55P04).
-- ---------------------------------------------------------------------
drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log
  for select using (
    (action::text <> 'read' or occurred_at >= now() - interval '180 days')
    and (
      auth_role() = 'Chairman'
      or actor_user_id = auth.uid()
      or in_my_subtree(actor_user_id)
    )
  );

-- ---------------------------------------------------------------------
-- 7. activity_events — 화면이 읽는 자리. **회장만이다.**
--
--    RLS만으로는 '회장만'이 되지 않는다. 0026이 audit_log_read에 in_my_subtree(actor)를
--    얹었기 때문에 팀장 세션은 자기 팀원의 열람 기록을 본다 — 그것은 0026이 의도한
--    규칙이고 여기서 뒤집지 않는다. 다만 **이 화면의 데이터**는 회장 전용이다
--    (원문: "RLS: Chairman만"). 그래서 문을 하나로 좁히고 그 문에서 역할을 본다.
--
--    이 함수는 RLS를 **우회하지 않는다.** audit_log의 FORCE 때문에 definer라도 정책을
--    그대로 받는다 — 회장이 부르면 정책이 전부를 주고(회장 분기), 팀장이 부르면
--    아래 첫 줄에서 0행으로 끝난다. 두 겹이 같은 답을 말한다.
--
--    coalesce(...::text, '')를 쓴다. auth_role()이 null인 세션(프로필이 없는 계정)에서
--    `auth_role() <> 'Chairman'`은 null이고, `if null then` 은 거짓이라 **그냥 통과해
--    버린다.** 이 한 줄이 그 구멍을 막는다.
--
--    p_days는 180에서 자른다. 6절의 보관 기간을 함수 인자 하나로 넘을 수 없게 한다 —
--    정책이 이미 막지만, 두 곳이 같은 말을 해야 나중에 한쪽만 바뀌는 날 드러난다.
-- ---------------------------------------------------------------------
create or replace function activity_events(p_days integer default 30)
returns table (
  occurred_at   timestamptz,
  actor_user_id uuid,
  actor_role    text,
  action        text,
  entity_id     text,
  entity_table  text,
  business_id   text,
  path          text,
  kind          text,
  device        text,
  city          text,
  tz            text,
  ok            boolean
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if coalesce(auth_role()::text, '') <> 'Chairman' then
    return;
  end if;

  return query
    select
      a.occurred_at,
      a.actor_user_id,
      a.actor_role,
      a.action::text,
      a.entity_id,
      a.after->>'entity_table',
      a.business_id,
      a.after->>'path',
      a.after->>'kind',
      a.after->>'device',
      a.after->>'city',
      a.after->>'tz',
      -- 로그인만 성공/실패가 있다. 열람 기록에는 그 개념이 없어 null이다.
      case when a.action::text = 'login' then coalesce(a.after->>'ok', 'true') <> 'false' else null end
    from audit_log a
   where (a.action::text = 'read' or a.action::text = 'login')
     and a.occurred_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 180))
   order by a.occurred_at desc;
end;
$fn$;

comment on function activity_events(integer) is
  '블록 7. /settings/activity가 읽는 유일한 문. 회장이 아니면 0행이다 — 0026이 audit_log_read에 얹은 subtree 분기 때문에 RLS만으로는 "회장만"이 되지 않는다. RLS를 우회하지는 않는다(audit_log는 FORCE라 definer도 정책을 그대로 받는다).';

revoke all on function activity_events(integer) from public;
grant execute on function activity_events(integer) to authenticated;

commit;
