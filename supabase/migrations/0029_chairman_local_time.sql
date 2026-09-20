-- =====================================================================
-- Chairman OS — 0029_chairman_local_time
-- 출처: docs/superpowers/specs/2026-09-20-incoming.md `## 3-C 변경`
-- 작성: Phase 3-C 현지 시간 (2026-09-21)
--
-- 무엇이 바뀌나
--   카톡 아침 알림이 "07:00 KST 고정"에서 **회장이 있는 곳의 06:00**으로 옮겨 간다.
--   스케줄러도 Vercel cron에서 GitHub Actions 틱(매시 정각 UTC)으로 바뀐다.
--   API가 매 틱마다 "지금 회장 현지 시각이 아침 창 안이고 오늘 것을 아직 안 보냈나"를
--   판정해야 하므로, DB가 답해 줘야 할 것이 셋 생긴다.
--
--     ① 회장이 마지막으로 앱을 연 기기의 시간대   user_settings.current_tz
--     ③ 회장이 손으로 고른 시간대                 user_settings.brief_tz   (null = 자동)
--     ② 오늘이 출장 기간이면 그 장소의 시간대      events.timezone
--
--   그리고 중복 발송을 막을 **현지 날짜 장부**가 하나 필요하다 — chairman_brief_sends.
--
-- 왜 ai_night_outputs.run_date에 기대지 않는가
--   그 칸은 KST 날짜다(lib/ai/night-brief.ts kstDate). 회계·장부·/ai의 날짜 축이 전부
--   그 값을 쓰고 있어서 뜻을 바꾸면 브리핑 이력이 어느 날 조용히 하루씩 어긋난다.
--   '오늘 아침 것을 보냈나'는 **회장의 현지 날짜**로만 답할 수 있는 질문이므로,
--   그 질문의 답을 담을 자리를 따로 만든다. 두 날짜는 대개 같지만 같다는 보장이 없고,
--   보장이 없는 것을 같다고 쓰는 코드가 이 저장소에서 가장 자주 틀린 자리였다.
--
-- 왜 chairman_kakao_token에 칸을 더하지 않고 표를 새로 만드는가
--   ① 그 표에 행이 없는 날(아직 연결 안 함 / 회장이 해제함)에도 기록할 자리가 있어야 한다.
--      틱은 매시 온다. '오늘 것은 끝났다'를 못 남기면 06~10시 사이 다섯 번의 틱이
--      회사 다섯 곳 + 그룹 = 여섯 번의 모델 호출을 **매시 다시** 돌린다. 카카오가 연결되지
--      않았을 때가 바로 그 상태다 — 가장 조용하고 가장 비싼 실패다.
--   ② chairman_kakao_token은 bearer 자격증명을 담은 표다(0023 머리 주석). 매일 아침
--      쓰기가 일어나는 칸을 그 표에 붙이면, 자격증명 표를 만지는 코드 경로가 하나 늘어난다.
--      날짜 장부는 자격증명이 아니다. 등급이 다른 값은 표를 나눈다.
--   ③ 'sent=false'로 남길 일이 있다 — 현지 10시를 넘겨 그날을 포기한 경우다. 토큰 표에
--      그 뜻의 칸을 두면 "토큰이 왜 발송 실패를 기억하나"가 된다.
--
-- 권한 — 0023의 방식을 그대로 따른다
--   AIAgent(야간 Job)는 표를 직접 읽지도 쓰지도 못한다. security definer 함수 셋만 문이다.
--
--     chairman_brief_timezone()        Chairman, AIAgent  ①③ 두 칸. 값 판정은 TS가 한다.
--     chairman_brief_send_status(date) Chairman, AIAgent  그날(또는 마지막) 기록 한 줄.
--     chairman_brief_send_record(...)  Chairman, AIAgent  그날 기록을 남긴다.
--
--   새 enum 값은 만들지 않는다(55P04, 0022가 production에서 터진 자리). 발송 성패의 감사
--   기록은 0023이 이미 더한 kakao_sent / kakao_failed 그대로다 — 이 표는 감사 기록이 아니라
--   **틱의 중복 방지 장부**이고, 둘은 다른 물건이다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. user_settings — 시간대 두 칸
--
--    current_tz는 클라이언트가 Intl.DateTimeFormat().resolvedOptions().timeZone으로
--    보낸 값이다. 브라우저가 주는 문자열이므로 DB는 **모양만** 본다 — 'Asia/Seoul'이
--    실재하는 시간대인지는 Intl이 아는 일이고, 그 판정은 TS(lib/chairman-timezone.ts)가 한다.
--    여기 check는 '사람이 손으로 넣은 쓰레기'를 거르는 최소선이다.
--
--    brief_tz가 null인 것이 기본값이고 그 뜻은 '자동'이다. 빈 문자열은 허용하지 않는다 —
--    ''와 null이 같은 뜻을 두 가지로 표현하게 되면 화면과 Job이 서로 다른 쪽을 본다.
-- ---------------------------------------------------------------------
alter table user_settings
  add column current_tz text,   -- [일반] ① 마지막 접속 기기의 IANA 시간대
  add column brief_tz   text;   -- [일반] ③ 회장이 손으로 고른 값. null = 자동

alter table user_settings
  add constraint user_settings_current_tz_shape
    check (current_tz is null or current_tz ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$'),
  add constraint user_settings_brief_tz_shape
    check (brief_tz   is null or brief_tz   ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$');

comment on column user_settings.current_tz is
  'Phase 3-C 현지 시간 ①. 마지막 앱 접속 때 클라이언트가 Intl로 보낸 IANA 시간대. 회장이 비행기에서 내려 앱을 열면 여기가 먼저 바뀐다 — 출장 일정을 안 넣었어도 다음 아침은 그 도시 06시에 온다.';
comment on column user_settings.brief_tz is
  'Phase 3-C 현지 시간 ③. /settings/chairman에서 손으로 고른 값. null이면 자동(②출장 → ①접속 → Asia/Seoul). 자동보다 먼저 이긴다 — 회장이 직접 고른 값을 시스템이 뒤집을 이유가 없다.';

-- ---------------------------------------------------------------------
-- 2. events — 출장 장소의 시간대
--
--    0017의 events에는 location(자유 문자열)만 있고 시간대가 없다. **도시 이름을 시간대로
--    추측하지 않는다** — '뉴욕'과 'NY'와 'New York 출장'이 전부 다른 문자열이고, 틀린
--    추측은 회장을 새벽 두 시에 깨운다. 칸을 더하고, 비어 있으면 ②를 건너뛴다.
--
--    kind='Trip'이 아닌 행에도 칸은 있다. 회의가 해외에서 열릴 수도 있지만 ②가 보는 것은
--    Trip뿐이다 — '그 도시에 머문다'와 '그 도시 일이 있다'는 다른 사실이다.
-- ---------------------------------------------------------------------
alter table events
  add column timezone text;   -- [일반] 이 일정 장소의 IANA 시간대. null이면 ②를 건너뛴다

alter table events
  add constraint events_timezone_shape
    check (timezone is null or timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$');

comment on column events.timezone is
  'Phase 3-C 현지 시간 ②. 출장(kind=Trip) 기간의 아침 알림이 갈 시간대. location은 사람이 읽는 자유 문자열이라 여기서 쓰지 않는다 — 도시 이름을 시간대로 추측하면 틀린 날 회장이 새벽에 깬다. null이면 그 출장은 ②에서 빠지고 ①로 내려간다.';

-- ---------------------------------------------------------------------
-- 3. user_settings의 force를 내린다 (0023 6절과 같은 함정)
--
--    0002:201이 이 표에 force row level security를 걸었다. 바로 아래 4-1의
--    chairman_brief_timezone()은 security definer라 소유자 권한으로 도는데, FORCE는
--    **소유자까지** 정책 아래로 끌어내린다. user_settings의 정책은 0002의
--    user_settings_own 하나이고 그 조건은 `user_id = auth.uid()`다 —
--    AIAgent 세션에서 부르면 auth.uid()가 Agent라 **회장의 행은 0행**이 된다.
--
--    그 실패는 예외가 아니다. 시간대가 null로 와서 조용히 'Asia/Seoul'로 떨어지고,
--    회장이 뉴욕에 있어도 알림은 서울 06시(= 뉴욕 16시 전날)에 간다. 화면에서는
--    '자동'이라고 적혀 있으니 아무도 고장을 의심하지 않는다.
--
--    이 저장소의 자물쇠는 revoke다(0023 3절 ①). user_settings는 authenticated에게 열려
--    있는 표이고, force를 내려도 닫혀 있던 것이 열리지 않는다 — enable도 정책도 그대로라
--    남의 설정은 여전히 어떤 역할도 못 읽는다. 내려가는 것은 '소유자도 정책을 받는다'뿐이다.
--
--    0002 파일은 건드리지 않는다. 이미 staging·production에 적용됐고, 적용된 마이그레이션을
--    고치면 체크섬이 드리프트된다(OPERATIONS 9, 0022가 겪은 일). 앞으로 나아가며 고친다.
--
--    events(0017:191)의 force는 그대로 둔다. ②가 읽는 events는 definer를 거치지 않고
--    AIAgent 세션이 직접 읽는다(0017 events_read가 AIAgent를 통과시킨다) — 소유자 권한으로
--    도는 코드가 없으므로 FORCE가 걸릴 자리가 없다.
-- ---------------------------------------------------------------------
alter table public.user_settings no force row level security;

-- ---------------------------------------------------------------------
-- 4. chairman_brief_sends — 현지 날짜 장부
--
--    한 현지 날짜에 한 행. 행이 있다는 것이 곧 '그날 아침 Job은 끝났다'는 뜻이고,
--    그것이 중복 방지의 실체다. sent는 카톡이 실제로 갔느냐를 따로 말한다 —
--    카카오가 연결되지 않아 못 보낸 날도 **그날은 끝난 날**이다. 둘을 한 칸으로 뭉치면
--    연결이 없는 동안 매시 여섯 번의 모델 호출이 다시 돈다.
--
--    회장이 둘인 날(승계 기간)은 여기서도 미룬다 — 0023 kakao_token_for_send()의 limit 1과
--    같은 미룸이고 같은 자리에 적혀 있다(DEFERRED.md Phase 3-C). 아침 알림은 '회장에게 가는
--    한 통'이지 '회장마다 한 통'이 아니라서 오늘은 날짜가 곧 키다.
-- ---------------------------------------------------------------------
create table chairman_brief_sends (
  local_date date primary key,                          -- [일반] 회장 현지 날짜. 이 표의 유일한 키
  timezone   text        not null,                      -- [일반] 그날 판정된 IANA 시간대
  sent       boolean     not null,                      -- [일반] 카톡이 실제로 갔나
  reason     text        not null default '',           -- [제한] 안 갔으면 왜. 사람이 읽는 한 줄
  decided_at timestamptz not null default now()         -- [일반] 마지막으로 이 행을 만진 시각
);

comment on table chairman_brief_sends is
  'Phase 3-C 현지 시간. 회장 현지 날짜 하루에 한 행. 행의 존재가 "그날 아침 Job은 끝났다"이고 그것이 GitHub Actions 틱의 중복 방지다. ai_night_outputs.run_date(KST)와 뜻이 다르다 — 그쪽은 브리핑의 장부 날짜이고 이쪽은 발송 판정의 날짜다.';
comment on column chairman_brief_sends.sent is
  '카톡이 실제로 갔나. false여도 행은 남는다 — 카카오가 연결되지 않은 날도 그날 Job은 끝난 날이고, 안 남기면 06~10시 틱이 매시 모델을 여섯 번 다시 부른다.';
comment on column chairman_brief_sends.reason is
  '안 갔으면 왜인지 한 줄. "현지 10시를 넘겨 그날은 건너뛴다"처럼 틱이 스스로 포기한 경우도 여기 남는다 — 아침에 카톡이 없는 날 답할 자리가 여기다.';

-- ---------------------------------------------------------------------
-- 5. 자물쇠 — 0023 3절과 같은 구성
--    ① revoke가 자물쇠다. grant가 없으면 RLS를 따지기 전에 42501이다.
--    ② 정책은 최후 방어선이다. grant가 되살아나는 날(Supabase의 alter default privileges)
--       Chairman 말고는 한 행도 못 보게 한다.
--    ③ force는 걸지 않는다. 아래 함수 셋이 전부 security definer다 — FORCE를 걸면 3절이
--       방금 user_settings에서 걷어낸 그 침묵 실패를 여기서 새로 만든다.
-- ---------------------------------------------------------------------
revoke all on table chairman_brief_sends from anon, authenticated;

alter table chairman_brief_sends enable row level security;

create policy chairman_brief_sends_read on chairman_brief_sends for select
  using (is_active() and auth_role() = 'Chairman');

do $$
begin
  execute format(
    'create policy integration_no_insert on public.%I as restrictive for insert
       with check (not is_integration())', 'chairman_brief_sends');
  execute format(
    'create policy integration_no_update on public.%I as restrictive for update
       using (not is_integration()) with check (not is_integration())', 'chairman_brief_sends');
  execute format(
    'create policy integration_no_delete on public.%I as restrictive for delete
       using (not is_integration())', 'chairman_brief_sends');
end
$$;

-- ---------------------------------------------------------------------
-- 6. 문 셋
--    0023 4절과 같다 — 예외를 던지지 않고, 역할이 맞지 않으면 조용히 0행 / false다.
-- ---------------------------------------------------------------------

-- 6-1. ①③ 두 칸. 어느 쪽이 이기는지는 여기서 정하지 않는다.
--      우선순위(③ > ② > ①)는 순수 함수 하나(lib/chairman-timezone.ts)에 있고, 그래야
--      scripts/check-brief-schedule.ts가 DB 없이 그 규칙 전부를 잰다. SQL이 같은 판정을
--      한 번 더 하면 두 벌이 되고, 두 벌이면 한쪽만 고쳐지는 날이 온다.
create or replace function chairman_brief_timezone()
returns table (brief_tz text, current_tz text)
language sql stable security definer set search_path = public as $fn$
  select s.brief_tz, s.current_tz
    from user_settings s
    join user_profiles p on p.user_id = s.user_id
   where is_active()
     and auth_role() in ('Chairman', 'AIAgent')
     and p.role = 'Chairman'
     and p.revoked_at is null
     -- Chairman이 부르면 자기 행만 본다. AIAgent에게는 auth.uid()가 회장이 아니라
     -- 그렇게 좁힐 수 없어서(0023 kakao_token_for_send()와 같은 사정) 가장 최근에
     -- 갱신된 회장 행을 고른다 — 임의 선택은 어느 날 조용히 바뀐다.
     and (auth_role() = 'AIAgent' or s.user_id = auth.uid())
   order by s.updated_at desc
   limit 1;
$fn$;

comment on function chairman_brief_timezone() is
  '0029. 아침 알림 시간대의 입력 두 칸(③ brief_tz · ① current_tz). user_settings는 남의 행을 어떤 역할도 못 읽는 표라, 야간 Job이 회장의 설정을 볼 유일한 문이다. 우선순위 판정은 여기서 하지 않는다 — lib/chairman-timezone.ts 한 곳에만 둔다.';

-- 6-2. 그날 기록 한 줄. p_local_date가 null이면 **가장 최근 행**을 준다 —
--      틱은 "마지막으로 끝낸 날이 언제인가"만 알면 되고, 그 한 번의 왕복으로 충분하다.
create or replace function chairman_brief_send_status(p_local_date date default null)
returns table (local_date date, timezone text, sent boolean, reason text, decided_at timestamptz)
language sql stable security definer set search_path = public as $fn$
  select b.local_date, b.timezone, b.sent, b.reason, b.decided_at
    from chairman_brief_sends b
   where is_active()
     and auth_role() in ('Chairman', 'AIAgent')
     and (p_local_date is null or b.local_date = p_local_date)
   order by b.local_date desc
   limit 1;
$fn$;

comment on function chairman_brief_send_status(date) is
  '0029. 현지 날짜 장부 한 줄. 인자가 null이면 가장 최근 행이다 — 틱이 "마지막으로 끝낸 현지 날짜"를 묻는 모양 그대로다.';

-- 6-3. 그날 기록을 남긴다.
create or replace function chairman_brief_send_record(
  p_local_date date, p_timezone text, p_sent boolean, p_reason text
) returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not (is_active() and auth_role() in ('Chairman', 'AIAgent')) then
    return false;
  end if;
  -- 날짜도 시간대도 없는 행은 장부가 아니다. 0023의 save가 그랬듯 예외 대신 false다.
  if p_local_date is null or coalesce(trim(p_timezone), '') = '' then
    return false;
  end if;

  insert into chairman_brief_sends (local_date, timezone, sent, reason)
  values (p_local_date, trim(p_timezone), coalesce(p_sent, false), coalesce(p_reason, ''))
  on conflict (local_date) do update set
    timezone   = excluded.timezone,
    -- **true는 false로 내려가지 않는다.** 같은 현지 날짜에 두 번째 기록이 오는 경우는
    -- '10시를 넘겨 포기했다'뿐인데, 그날 이미 보냈다면 그 사실이 이긴다. or를 빼고
    -- 그냥 덮어쓰면 포기 기록 하나가 "오늘은 안 갔다"로 이력을 바꿔 버린다.
    sent       = chairman_brief_sends.sent or excluded.sent,
    reason     = excluded.reason,
    decided_at = now();
  return true;
end;
$fn$;

comment on function chairman_brief_send_record(date, text, boolean, text) is
  '0029. 현지 날짜 장부에 그날을 적는다. 같은 날짜로 다시 오면 sent는 or로 합친다 — 한 번 간 것은 나중 기록이 취소하지 못한다.';

-- 0019·0023과 같은 이유로 public 기본 execute 권한을 먼저 걷고 필요한 역할에만 다시 준다.
revoke all on function chairman_brief_timezone()                              from public;
revoke all on function chairman_brief_send_status(date)                       from public;
revoke all on function chairman_brief_send_record(date, text, boolean, text)  from public;

grant execute on function chairman_brief_timezone()                             to authenticated;
grant execute on function chairman_brief_send_status(date)                      to authenticated;
grant execute on function chairman_brief_send_record(date, text, boolean, text) to authenticated;

commit;
