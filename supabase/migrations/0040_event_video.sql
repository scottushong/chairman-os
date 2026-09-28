-- ---------------------------------------------------------------------
-- 0040. 일정의 화상회의 링크 · 참석자 · 알림 (Phase 9 블록 5)
--
-- 회장 지시 원문: "Jitsi Meet 임베드(meet.jit.si, 계정 불필요). 방 이름 = chairman-os-{회사}-{날짜}-{난수}.
-- 캘린더 이벤트 kind=미팅에 «화상 링크 생성» 버튼 → 이벤트에 링크 저장 → 참석자에게 알림.
-- 회장 아침 루틴 «오늘 일정»에 화상 버튼 표시."
--
-- 1) events에 video_url · attendee_ids. 일정은 지금까지 날짜만 있고 참석자가 없었다(0017).
-- 2) event_video_link(event_id) — **링크를 만드는 유일한 문.** 방 이름을 DB가 만들고, 저장하고,
--    참석자에게 알림을 넣는 것을 한 트랜잭션에서 한다. 화면이 방 이름을 보내지 않는다 —
--    보내게 두면 남의 방 이름이나 추측 가능한 이름이 들어간다(방 이름이 곧 입장권이다: meet.jit.si는
--    계정이 없어서 이름을 아는 사람은 누구나 들어온다). 그래서 난수는 16자리 hex다.
-- 3) notifications(0030)에는 지금까지 insert 경로가 없었다(표 주석: "아무것도 알림을 만들지 않는다").
--    이 함수가 첫 번째 생산자다. 표에 insert grant를 열지 않는다 — definer 함수 안에서만 만든다.
--
-- video_url을 saveEvent(일반 update)로 바꾸지 못하게 트리거가 막는다. 링크를 바꾸는 길은
-- 이 함수 하나이고, 함수가 트랜잭션 설정(chairman.video_link)을 켜 두었을 때만 트리거가 통과시킨다.
--
-- 0035 규칙: force 새로 걸지 않는다 · 0001~0039 안 고친다(events에 칸만 더한다).
-- ---------------------------------------------------------------------

alter table events add column video_url text
  check (video_url is null or video_url ~ '^https://meet\.jit\.si/chairman-os-[a-z0-9-]+$');
alter table events add column attendee_ids uuid[] not null default '{}';

comment on column events.video_url is
  '0040. Jitsi 방 주소. event_video_link()만 채운다(트리거가 다른 길을 막는다). 방 이름이 곧 입장권이다.';
comment on column events.attendee_ids is
  '0040. 참석자(user_id). 화상 링크를 만들 때 이 사람들에게 알림이 간다.';

create or replace function events_video_guard() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if coalesce(current_setting('chairman.video_link', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.video_url := null;
    elsif new.video_url is distinct from old.video_url then
      new.video_url := old.video_url;
    end if;
  end if;
  return new;
end;
$fn$;

create trigger events_video_guard_trigger
  before insert or update on events
  for each row execute function events_video_guard();

-- 회사 이름 대신 business_id의 꼬리(biz_dy → dy). 회사가 없으면 group. 날짜는 일정 시작일.
-- p_rotate = true면 이미 있는 링크를 **새로 만든다**(방 이름이 새어 나갔을 때 · 나중에 더한 참석자까지
-- 다시 알릴 때). 바꾸면 이전 링크는 헛방이 되므로, 지금 참석자 전원에게 새 링크로 다시 알린다.
create or replace function event_video_link(p_event_id uuid, p_rotate boolean default false) returns text
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_event events%rowtype;
  v_slug text;
  v_url text;
  v_uid uuid;
begin
  if not can_write_initiatives() then
    raise exception 'event_video_forbidden' using errcode = '42501';
  end if;
  select * into v_event from events where event_id = p_event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if v_event.kind <> 'Meeting' then
    raise exception 'event_not_meeting' using errcode = '23514';
  end if;
  if v_event.video_url is not null and not p_rotate then
    return v_event.video_url;   -- 이미 있으면 그대로. 바꾸는 것은 p_rotate로만(위 주석).
  end if;

  -- 소문자를 **먼저** — 대문자가 [^a-z0-9]에 걸려 '-'가 되지 않게.
  v_slug := regexp_replace(lower(coalesce(regexp_replace(v_event.business_id, '^biz_', ''), 'group')), '[^a-z0-9]+', '-', 'g');
  v_url := 'https://meet.jit.si/chairman-os-' || v_slug || '-' || to_char(v_event.starts_on, 'YYYYMMDD') || '-'
           || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 16);

  perform set_config('chairman.video_link', 'on', true);
  update events set video_url = v_url where event_id = p_event_id;
  perform set_config('chairman.video_link', 'off', true);

  -- 같은 사람이 두 번 적혀 있어도 알림은 한 번.
  for v_uid in select distinct u from unnest(v_event.attendee_ids) as u loop
    insert into notifications (user_id, kind, title, body, link)
    select v_uid, 'system',
           '화상회의 링크: ' || v_event.title,
           to_char(v_event.starts_on, 'YYYY-MM-DD') || coalesce(' · ' || nullif(v_event.location, ''), ''),
           '/meet?room=' || substr(v_url, length('https://meet.jit.si/') + 1)
     where exists (select 1 from user_profiles p where p.user_id = v_uid and p.revoked_at is null);
  end loop;

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
  values ('update', 'events', p_event_id::text, v_event.business_id, auth.uid(), auth_role()::text,
          jsonb_build_object('video_url', v_url, 'notified', coalesce(array_length(v_event.attendee_ids, 1), 0)),
          case when p_rotate then '화상회의 링크 다시 만들기' else '화상회의 링크 생성' end);
  return v_url;
end;
$fn$;

revoke all on function event_video_link(uuid, boolean) from public, anon;
grant execute on function event_video_link(uuid, boolean) to authenticated;

comment on function event_video_link(uuid, boolean) is
  '0040. 화상 링크를 만드는 유일한 문. 방 이름 생성 · 저장 · 참석자 알림 · 감사가 한 트랜잭션. 일정 쓰기 권한(Chairman · GroupCFO)만. 알림은 [제한] 등급인 일정 제목 · 장소를 일정을 못 읽는 참석자에게도 보낸다 — 참석자는 회장 · CFO가 고른 사람이라 의도한 전달이다.';
