-- =====================================================================
-- Chairman OS — 0082_purchase_price_report (DY 구매팀 가격 리포트 — 오피넷 정산가 · 나프타 · 장중가 · 사건 메모 · 크랙)
-- 작성: 2026-10-14 · 브랜치 feat/purchase-price-report · 엔진 macro/engine(채팅 리포트와 같은 화면)
--
-- ■ 무엇을 만드나 ■
--   표    purchase_price_reports(리포트 html · 채팅 요약 · 수치) · purchase_price_points(지점별 가격 시계열)
--         purchase_price_events(사건 · 뉴스 · 회차 메모 — 같은 제목 · 링크면 한 번만) · purchase_price_runs(실행 기록)
--   판정  price_report_reader(biz)   읽기 — 대표 · 그 회사 임원 이상(GroupCFO · BusinessCEO · Executive) · 구매 줄('/purchasing/<biz>') · AIAgent
--         price_report_requester(biz) «지금 업데이트» — 대표 · 구매 입력 줄(can_write) + 스위치
--   사람  price_report_request(biz, per_day)  권한 · 수집 중 잠김 · 10분 · 하루 n번(앱 env, DB 천장 12) → 실행 기록 «대기» + 감사
--         price_report_dispatch_failed(run, error)  GitHub 호출이 실패했을 때 자기 «대기» 기록만 «실패»로
--   AI Agent(야간 브리핑과 같은 로그인 — service_role 아님)
--         price_report_agent_begin · _points · _events · _save · _fail
--   적재  seed_v2(1월~10/14 가격 87점 · 사건 메모 1)를 한 번(이미 있으면 건너뜀)
--
-- ■ 지키는 것 ■
--   · 원가 엔진 원료 시세(cost_market_prices)와 섞지 않는다 — 이 파일은 cost_* 표에 쓰지 않는다.
--   · 쓰기는 정의자 RPC만(표에 insert · update grant 없음). 리포트 · 가격 · 사건은 AIAgent만, 실행 «시작»은 버튼 권한자만.
--   · 가격 범위 검사(오피넷 원화표 혼동 — 884 같은 값): 원유 · 오피넷 나프타 $/bbl 20~300 · 나프타 CFD · MOPJ $/톤 200~3000 밖은 거부.
--   · 정산(settle)은 장중(intraday)이 덮지 않는다(엔진 store.py와 같은 규칙).
--   · 리포트 html에 <script> · javascript: 가 있으면 거부(앱은 스크립트 없는 sandbox iframe으로 보인다 — 겹으로 막는다).
--   · 정책은 to authenticated · anon 0 · force 없음(정의자 함수의 소유자가 읽는다) · 감사 줄에는 값을 넣지 않는다.
-- 0035 규칙: 앞 파일을 고치지 않는다.
-- =====================================================================

begin;

-- =====================================================================
-- 0절. 기능 스위치 — src/lib/features.ts와 같은 키 · 기본값(check:features가 대조). 'all' + DB 읽기 규칙이 구매 · 대표 · 임원으로 거른다.
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'purchase_price_report', true, 'all', '기본값(0082)')
on conflict do nothing;

-- =====================================================================
-- 1절. 표
-- =====================================================================
create table purchase_price_runs (
  run_id       uuid primary key default gen_random_uuid(),
  business_id  text not null references businesses(business_id) on delete restrict,
  trigger      text not null check (trigger in ('auto', 'manual')),
  slot         text not null check (slot in ('AM', 'PM', 'manual')),
  requested_by uuid,                                                     -- null = 자동(GitHub Actions 시각)
  status       text not null check (status in ('queued', 'collecting', 'done', 'failed')),
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  error        text check (error is null or length(error) <= 300),
  report_id    uuid,
  new_events   int check (new_events is null or new_events >= 0),
  points       int check (points is null or points >= 0)
);
create index purchase_price_runs_by_biz on purchase_price_runs (business_id, created_at desc);

create table purchase_price_reports (
  report_id       uuid primary key default gen_random_uuid(),
  business_id     text not null references businesses(business_id) on delete restrict,
  report_date     date not null,
  slot            text not null check (slot in ('AM', 'PM', 'manual')),
  status          text not null check (status in ('ok', 'unconfirmed')),
  html            text not null check (length(html) between 100 and 3000000 and html !~* '<script' and html !~* 'javascript:'),
  chat_summary_md text check (chat_summary_md is null or length(chat_summary_md) <= 60000),
  figures         jsonb not null default '{}'::jsonb check (jsonb_typeof(figures) = 'object'),
  sources         jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  missing         jsonb not null default '[]'::jsonb check (jsonb_typeof(missing) = 'array'),
  run_id          uuid references purchase_price_runs(run_id),
  started_by      uuid,                                                  -- null = 자동
  created_at      timestamptz not null default now()
);
create index purchase_price_reports_by_biz on purchase_price_reports (business_id, report_date desc, created_at desc);
-- 자동 회차(AM · PM)는 그날 하나 — 다시 돌면 바꾼다. 수동은 여러 개.
create unique index purchase_price_reports_one_slot on purchase_price_reports (business_id, report_date, slot) where slot in ('AM', 'PM');
alter table purchase_price_runs add constraint purchase_price_runs_report_fk foreign key (report_id) references purchase_price_reports(report_id);

create table purchase_price_points (
  business_id text not null references businesses(business_id) on delete restrict,
  series      text not null check (series in ('brent', 'wti', 'dubai', 'naphtha_cfd', 'opinet_naphtha_bbl', 'mopj')),
  point_date  date not null,
  value       numeric(12, 4) not null,
  kind        text not null check (kind in ('settle', 'intraday', 'monthly', 'spot', 'forecast')),
  source      text not null default '' check (length(source) <= 120),
  label       text check (label is null or length(label) <= 80),
  updated_at  timestamptz not null default now(),
  primary key (business_id, series, point_date),
  -- 범위 검사(엔진 collect.validate와 같은 값) — 오피넷 원화표 혼동 · 단위 오류는 넣지 않는다.
  constraint purchase_price_points_range check (
    case when series in ('brent', 'wti', 'dubai', 'opinet_naphtha_bbl') then value > 20 and value < 300
         else value > 200 and value < 3000 end)
);

create table purchase_price_events (
  event_id      bigint generated always as identity primary key,
  business_id   text not null references businesses(business_id) on delete restrict,
  kind          text not null check (kind in ('event', 'memo')),           -- event = 사건 · 뉴스 한 건 / memo = 회차 메모(<b> · <br>만)
  event_date    date,
  title         text not null check (length(btrim(title)) between 1 and 300),
  url           text check (url is null or (length(url) <= 1000 and url ~* '^https?://')),
  source        text check (source is null or length(source) <= 120),
  html          text check (html is null or (length(html) <= 40000 and html !~* '<script' and html !~* 'javascript:')),
  dedupe_key    text not null check (length(dedupe_key) <= 1400),
  first_run     uuid references purchase_price_runs(run_id),
  first_slot    text,
  first_seen_at timestamptz not null default now(),
  unique (business_id, dedupe_key)
);
create index purchase_price_events_by_biz on purchase_price_events (business_id, first_seen_at desc);

comment on table purchase_price_reports is '0082. DY 구매팀 가격 리포트(엔진 macro/engine이 만든 html — 스크립트 없음). 쓰기는 AIAgent RPC만.';
comment on table purchase_price_points is '0082. 가격 리포트의 지점별 가격(원유 정산 · 장중 · 나프타 CFD · 오피넷 $/bbl · MOPJ). 원가 엔진 시세와 따로.';
comment on table purchase_price_events is '0082. 사건 · 뉴스(같은 제목 · 링크 한 번) · 회차 메모.';
comment on table purchase_price_runs is '0082. 가격 리포트 실행 기록(자동 08 · 18시 KST · «지금 업데이트»).';

-- =====================================================================
-- 2절. 판정
-- =====================================================================
/** 읽기 — AIAgent(엔진이 앞 데이터를 읽는다) · 대표 · 그 회사 임원 이상 · 구매 줄. 사람은 스위치도. 영업 · 생산 · 다른 회사 · anon은 거짓. */
create or replace function price_report_reader(p_business text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p_business is not null and (
    coalesce(auth_role()::text, '') = 'AIAgent'
    or (is_active()
        and has_business(p_business)
        and (coalesce(auth_role()::text, '') in ('Chairman', 'GroupCFO', 'BusinessCEO', 'Executive') or cost_grant('purchasing', p_business, false))
        and coalesce(feature_on('purchase_price_report', p_business), false)));
$fn$;

/** «지금 업데이트» — 대표 또는 구매 입력 줄(can_write) · 그 회사 · 스위치. */
create or replace function price_report_requester(p_business text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p_business is not null
     and is_active()
     and has_business(p_business)
     and (coalesce(auth_role()::text, '') = 'Chairman' or cost_grant('purchasing', p_business, true))
     and coalesce(feature_on('purchase_price_report', p_business), false);
$fn$;

-- =====================================================================
-- 3절. 읽기 정책(쓰기 grant 없음)
-- =====================================================================
alter table purchase_price_runs enable row level security;
alter table purchase_price_reports enable row level security;
alter table purchase_price_points enable row level security;
alter table purchase_price_events enable row level security;
revoke all on table purchase_price_runs, purchase_price_reports, purchase_price_points, purchase_price_events from public, anon, authenticated;
grant select on table purchase_price_runs, purchase_price_reports, purchase_price_points, purchase_price_events to authenticated;
create policy purchase_price_runs_read on purchase_price_runs for select to authenticated using (price_report_reader(business_id));
create policy purchase_price_reports_read on purchase_price_reports for select to authenticated using (price_report_reader(business_id));
create policy purchase_price_points_read on purchase_price_points for select to authenticated using (price_report_reader(business_id));
create policy purchase_price_events_read on purchase_price_events for select to authenticated using (price_report_reader(business_id));

-- =====================================================================
-- 4절. 사람 — «지금 업데이트»
-- =====================================================================
/** 30분 넘게 «대기 · 수집 중»인 기록은 멈춘 것으로 본다(Actions가 죽었거나 호출이 안 갔다) — 잠김이 영원하지 않게. */
create or replace function price_report_expire(p_business text) returns void
language sql security definer set search_path = public, pg_temp as $fn$
  update purchase_price_runs set status = 'failed', finished_at = now(), error = coalesce(error, '30분 안에 끝나지 않음(멈춘 것으로 봄)')
   where business_id = p_business and status in ('queued', 'collecting') and created_at < now() - interval '30 minutes';
$fn$;

/**
 * 버튼 — 판정은 여기서: 권한 · 수집 중이면 잠김(price_report_busy) · 마지막 실행 뒤 10분(price_report_too_soon) ·
 * 회사 하루(KST) 수동 n번(price_report_daily_limit — n은 앱 env PRICE_REPORT_MANUAL_PER_DAY, DB 천장 12). 감사 한 줄.
 */
create or replace function price_report_request(p_business text, p_per_day int default 6) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id  uuid;
  v_cap int := least(greatest(coalesce(p_per_day, 6), 1), 12);
  v_n   int;
begin
  if not coalesce(price_report_requester(p_business), false) then
    raise exception 'price_report_denied' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('purchase_price_runs:' || p_business));
  perform price_report_expire(p_business);
  if exists (select 1 from purchase_price_runs where business_id = p_business and status in ('queued', 'collecting')) then
    raise exception 'price_report_busy' using errcode = '55P03';
  end if;
  if exists (select 1 from purchase_price_runs where business_id = p_business and created_at > now() - interval '10 minutes') then
    raise exception 'price_report_too_soon' using errcode = '55P03';
  end if;
  select count(*) into v_n from purchase_price_runs
   where business_id = p_business and trigger = 'manual' and (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;
  if v_n >= v_cap then
    raise exception 'price_report_daily_limit' using errcode = '55P03';
  end if;
  insert into purchase_price_runs (business_id, trigger, slot, requested_by, status) values (p_business, 'manual', 'manual', auth.uid(), 'queued')
  returning run_id into v_id;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('create', 'purchase_price_runs', v_id::text, p_business, auth.uid(), auth_role()::text, null, jsonb_build_object('trigger', 'manual'), '가격 리포트 «지금 업데이트»(0082)');
  return v_id;
end;
$fn$;

/** GitHub 호출이 실패했을 때 — 자기가 누른 «대기» 기록만 «실패»로(오류 한 줄). */
create or replace function price_report_dispatch_failed(p_run uuid, p_error text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  update purchase_price_runs set status = 'failed', finished_at = now(), error = left(coalesce(nullif(btrim(p_error), ''), '자동 실행을 부르지 못함'), 300)
   where run_id = p_run and requested_by = auth.uid() and status = 'queued';
  return found;
end;
$fn$;

-- =====================================================================
-- 5절. AI Agent — 엔진(GitHub Actions)이 부른다
-- =====================================================================
create or replace function price_report_agent_check() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if coalesce(auth_role()::text, '') <> 'AIAgent' then
    raise exception 'price_report_agent_only' using errcode = '42501';
  end if;
end;
$fn$;

/** 시작 — 버튼 실행(p_run)이면 «대기 → 수집 중», 자동이면 새 기록. 이미 다른 실행이 수집 중이면 price_report_busy. */
create or replace function price_report_agent_begin(p_business text, p_run uuid, p_slot text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id uuid;
begin
  perform price_report_agent_check();
  if p_slot not in ('AM', 'PM', 'manual') then raise exception 'price_report_invalid' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('purchase_price_runs:' || p_business));
  perform price_report_expire(p_business);
  if p_run is not null then
    update purchase_price_runs set status = 'collecting', started_at = now()
     where run_id = p_run and business_id = p_business and status = 'queued'
    returning run_id into v_id;
    if v_id is null then raise exception 'price_report_run_state' using errcode = '55P03'; end if;
    return v_id;
  end if;
  if exists (select 1 from purchase_price_runs where business_id = p_business and status = 'collecting') then
    raise exception 'price_report_busy' using errcode = '55P03';
  end if;
  insert into purchase_price_runs (business_id, trigger, slot, status, started_at) values (p_business, 'auto', p_slot, 'collecting', now())
  returning run_id into v_id;
  return v_id;
end;
$fn$;

/** 가격 넣기 — [{series, date, value, kind, source, label}]. 범위 밖은 표 검사가 거부(통째로). 정산은 장중이 덮지 않는다. 돌려주는 값: 바뀐 줄 수. */
create or replace function price_report_agent_points(p_business text, p_points jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_n int := 0;
  e   jsonb;
begin
  perform price_report_agent_check();
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 2000 then raise exception 'price_report_invalid' using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(p_points) loop
    insert into purchase_price_points as t (business_id, series, point_date, value, kind, source, label)
    values (p_business, e ->> 'series', (e ->> 'date')::date, (e ->> 'value')::numeric, coalesce(e ->> 'kind', 'settle'), left(coalesce(e ->> 'source', ''), 120), left(e ->> 'label', 80))
    on conflict (business_id, series, point_date) do update
      set value = excluded.value, kind = excluded.kind, source = excluded.source, label = coalesce(excluded.label, t.label), updated_at = now()
      where not (t.kind = 'settle' and excluded.kind = 'intraday')
        and (t.value, t.kind, t.source, t.label) is distinct from (excluded.value, excluded.kind, excluded.source, coalesce(excluded.label, t.label));
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$fn$;

/**
 * 사건 · 메모 넣기 — [{kind, date, title, url, source, html}]. 사건은 같은 (제목 · 링크)면 한 번만(띄어쓰기 · 대소문자 무시).
 * 메모는 회차 이름(title)이 같으면 내용만 바꾼다(같은 회차 다시 돌기). 돌려주는 값: 새로 들어온 사건 수(메모 제외).
 */
create or replace function price_report_agent_events(p_business text, p_run uuid, p_slot text, p_events jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_new int := 0;
  e     jsonb;
  v_key text;
  v_url text;
begin
  perform price_report_agent_check();
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 200 then raise exception 'price_report_invalid' using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(p_events) loop
    v_url := nullif(btrim(e ->> 'url'), '');
    if coalesce(e ->> 'kind', 'event') = 'memo' then
      v_key := 'memo:' || btrim(e ->> 'title');
      insert into purchase_price_events as t (business_id, kind, event_date, title, html, dedupe_key, first_run, first_slot)
      values (p_business, 'memo', (e ->> 'date')::date, btrim(e ->> 'title'), e ->> 'html', v_key, p_run, p_slot)
      on conflict (business_id, dedupe_key) do update set html = excluded.html;
    else
      v_key := 'event:' || lower(regexp_replace(btrim(e ->> 'title'), '\s+', '', 'g')) || '|' || lower(coalesce(v_url, ''));
      insert into purchase_price_events (business_id, kind, event_date, title, url, source, dedupe_key, first_run, first_slot)
      values (p_business, 'event', (e ->> 'date')::date, left(btrim(e ->> 'title'), 300), v_url, left(e ->> 'source', 120), left(v_key, 1400), p_run, p_slot)
      on conflict (business_id, dedupe_key) do nothing;
      if found then v_new := v_new + 1; end if;
    end if;
  end loop;
  return v_new;
end;
$fn$;

/** 리포트 저장 + 실행 «완료». 자동 회차는 그날 같은 회차를 바꾼다. */
create or replace function price_report_agent_save(
  p_run uuid, p_report_date date, p_status text, p_html text, p_summary text, p_figures jsonb, p_sources jsonb, p_missing jsonb, p_new_events int, p_points int
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_run purchase_price_runs;
  v_id  uuid;
begin
  perform price_report_agent_check();
  select * into v_run from purchase_price_runs where run_id = p_run for update;
  if v_run.run_id is null or v_run.status <> 'collecting' then raise exception 'price_report_run_state' using errcode = '55P03'; end if;
  if v_run.slot in ('AM', 'PM') then
    update purchase_price_runs set report_id = null where report_id in (
      select report_id from purchase_price_reports where business_id = v_run.business_id and report_date = p_report_date and slot = v_run.slot);
    delete from purchase_price_reports where business_id = v_run.business_id and report_date = p_report_date and slot = v_run.slot;
  end if;
  insert into purchase_price_reports (business_id, report_date, slot, status, html, chat_summary_md, figures, sources, missing, run_id, started_by)
  values (v_run.business_id, p_report_date, v_run.slot, p_status, p_html, p_summary, coalesce(p_figures, '{}'::jsonb), coalesce(p_sources, '[]'::jsonb),
          coalesce(p_missing, '[]'::jsonb), p_run, v_run.requested_by)
  returning report_id into v_id;
  update purchase_price_runs set status = 'done', finished_at = now(), report_id = v_id, new_events = greatest(coalesce(p_new_events, 0), 0), points = greatest(coalesce(p_points, 0), 0)
   where run_id = p_run;
  return v_id;
end;
$fn$;

/** 실패 — 리포트는 그대로(직전 리포트가 화면에 남는다). */
create or replace function price_report_agent_fail(p_run uuid, p_error text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform price_report_agent_check();
  update purchase_price_runs set status = 'failed', finished_at = now(), error = left(coalesce(nullif(btrim(p_error), ''), '수집 실패'), 300)
   where run_id = p_run and status in ('queued', 'collecting');
  return found;
end;
$fn$;

-- =====================================================================
-- 6절. 함수 권한 — anon 0 · 공개 RPC만 authenticated
-- =====================================================================
revoke all on function price_report_reader(text) from public, anon;
revoke all on function price_report_requester(text) from public, anon;
revoke all on function price_report_expire(text) from public, anon, authenticated;
revoke all on function price_report_agent_check() from public, anon, authenticated;
revoke all on function price_report_request(text, int) from public, anon;
revoke all on function price_report_dispatch_failed(uuid, text) from public, anon;
revoke all on function price_report_agent_begin(text, uuid, text) from public, anon;
revoke all on function price_report_agent_points(text, jsonb) from public, anon;
revoke all on function price_report_agent_events(text, uuid, text, jsonb) from public, anon;
revoke all on function price_report_agent_save(uuid, date, text, text, text, jsonb, jsonb, jsonb, int, int) from public, anon;
revoke all on function price_report_agent_fail(uuid, text) from public, anon;
grant execute on function price_report_reader(text), price_report_requester(text), price_report_request(text, int), price_report_dispatch_failed(uuid, text),
  price_report_agent_begin(text, uuid, text), price_report_agent_points(text, jsonb), price_report_agent_events(text, uuid, text, jsonb),
  price_report_agent_save(uuid, date, text, text, text, jsonb, jsonb, jsonb, int, int), price_report_agent_fail(uuid, text) to authenticated;

-- =====================================================================
-- 7절. 한 번짜리 적재 — seed_v2(1월~10/14). macro/engine/tools/seed_sql.py가 만든 줄 그대로. 이미 있으면 건너뜀.
-- =====================================================================
insert into purchase_price_points (business_id, series, point_date, value, kind, source, label)
select v.* from (values
  ('biz_dy', 'brent', '2026-01-16'::date, 65.0, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-02-28'::date, 71.0, 'settle', '세션 누적 확인치', '개전 $71'),
  ('biz_dy', 'brent', '2026-03-03'::date, 81.0, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-03-27'::date, 108.0, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-04-01'::date, 118.4, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-04-17'::date, 90.4, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-04-30'::date, 126.0, 'intraday', '세션 누적 확인치', '$126(장중)'),
  ('biz_dy', 'brent', '2026-05-06'::date, 102.1, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-06-05'::date, 93.1, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-06-17'::date, 80.0, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-07-01'::date, 71.6, 'settle', '세션 누적 확인치', '저점 $71.6'),
  ('biz_dy', 'brent', '2026-07-23'::date, 105.0, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-08-03'::date, 83.5, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-08-10'::date, 87.7, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-08-24'::date, 92.1, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-09-02'::date, 95.6, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-09-09'::date, 100.4, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-09-15'::date, 108.7, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-09-21'::date, 100.3, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-09-24'::date, 106.6, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-09-29'::date, 102.6, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-10-01'::date, 102.3, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-10-02'::date, 102.25, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-10-05'::date, 100.32, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-10-06'::date, 100.58, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-10-07'::date, 100.2, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-10-08'::date, 104.28, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-10-09'::date, 104.72, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-10-12'::date, 106.65, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-10-13'::date, 105.69, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'brent', '2026-10-14'::date, 106.0, 'intraday', '세션 누적 확인치', '$106.0(장중)'),
  ('biz_dy', 'wti', '2026-01-16'::date, 60.0, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-02-28'::date, 65.0, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-04-17'::date, 83.9, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-04-30'::date, 105.1, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-05-06'::date, 94.3, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-06-05'::date, 90.5, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-07-01'::date, 68.0, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-08-10'::date, 82.1, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-09-07'::date, 92.3, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-09-18'::date, 100.3, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-09-21'::date, 95.8, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-09-25'::date, 92.4, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-09-28'::date, 94.5, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-09-29'::date, 89.4, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-10-01'::date, 92.9, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-10-02'::date, 91.11, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-10-05'::date, 89.43, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-10-06'::date, 89.44, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-10-07'::date, 88.28, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-10-08'::date, 91.49, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-10-09'::date, 91.85, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-10-12'::date, 93.74, 'settle', '세션 누적 확인치', null),
  ('biz_dy', 'wti', '2026-10-13'::date, 94.14, 'settle', '세션 누적 확인치', '$94.1'),
  ('biz_dy', 'naphtha_cfd', '2026-02-28'::date, 590.0, 'settle', 'TradingEconomics CFD', '$590'),
  ('biz_dy', 'naphtha_cfd', '2026-03-27'::date, 851.0, 'settle', 'TradingEconomics CFD', null),
  ('biz_dy', 'naphtha_cfd', '2026-08-19'::date, 752.0, 'settle', 'TradingEconomics CFD', null),
  ('biz_dy', 'naphtha_cfd', '2026-09-03'::date, 783.0, 'settle', 'TradingEconomics CFD', null),
  ('biz_dy', 'naphtha_cfd', '2026-09-09'::date, 826.0, 'settle', 'TradingEconomics CFD', null),
  ('biz_dy', 'naphtha_cfd', '2026-09-29'::date, 797.0, 'settle', 'TradingEconomics CFD', null),
  ('biz_dy', 'naphtha_cfd', '2026-10-01'::date, 829.0, 'settle', 'TradingEconomics CFD', null),
  ('biz_dy', 'naphtha_cfd', '2026-10-07'::date, 834.0, 'settle', 'TradingEconomics CFD', null),
  ('biz_dy', 'naphtha_cfd', '2026-10-08'::date, 871.0, 'settle', 'TradingEconomics CFD', null),
  ('biz_dy', 'naphtha_cfd', '2026-10-09'::date, 875.0, 'settle', 'TradingEconomics CFD', null),
  ('biz_dy', 'naphtha_cfd', '2026-10-12'::date, 891.0, 'settle', 'TradingEconomics CFD', 'CFD $891'),
  ('biz_dy', 'mopj', '2026-02-16'::date, 567.0, 'spot', 'OPIS/MOPJ(三協化学)', null),
  ('biz_dy', 'mopj', '2026-03-06'::date, 776.0, 'spot', 'OPIS/MOPJ(三協化学)', null),
  ('biz_dy', 'mopj', '2026-03-16'::date, 1100.0, 'spot', 'OPIS/MOPJ(三協化学)', null),
  ('biz_dy', 'mopj', '2026-04-01'::date, 1200.0, 'spot', 'OPIS/MOPJ(三協化学)', '$1,200+(3월말 현물)'),
  ('biz_dy', 'mopj', '2026-05-16'::date, 1140.0, 'monthly', 'OPIS/MOPJ(三協化学)', '5월 평균 $1,140'),
  ('biz_dy', 'mopj', '2026-06-16'::date, 1108.0, 'monthly', 'OPIS/MOPJ(三協化学)', null),
  ('biz_dy', 'mopj', '2026-07-16'::date, 925.0, 'monthly', 'OPIS/MOPJ(三協化学)', null),
  ('biz_dy', 'mopj', '2026-08-16'::date, 829.0, 'monthly', 'OPIS/MOPJ(三協化学)', '$829'),
  ('biz_dy', 'mopj', '2026-09-16'::date, 840.0, 'monthly', 'OPIS/MOPJ(三協化学)', '~$840(예상)'),
  ('biz_dy', 'opinet_naphtha_bbl', '2026-01-02'::date, 56.38, 'settle', '오피넷', '$502'),
  ('biz_dy', 'opinet_naphtha_bbl', '2026-03-31'::date, 141.72, 'settle', '오피넷', '$1,261(3/31)'),
  ('biz_dy', 'opinet_naphtha_bbl', '2026-05-26'::date, 91.85, 'settle', '오피넷', '$817'),
  ('biz_dy', 'opinet_naphtha_bbl', '2026-10-07'::date, 97.91, 'settle', '오피넷', null),
  ('biz_dy', 'opinet_naphtha_bbl', '2026-10-08'::date, 102.36, 'settle', '오피넷', null),
  ('biz_dy', 'opinet_naphtha_bbl', '2026-10-09'::date, 102.45, 'settle', '오피넷', null),
  ('biz_dy', 'opinet_naphtha_bbl', '2026-10-12'::date, 106.33, 'settle', '오피넷', null),
  ('biz_dy', 'opinet_naphtha_bbl', '2026-10-13'::date, 105.27, 'settle', '오피넷', null),
  ('biz_dy', 'dubai', '2026-10-07'::date, 105.93, 'settle', '오피넷', null),
  ('biz_dy', 'dubai', '2026-10-08'::date, 110.7, 'settle', '오피넷', null),
  ('biz_dy', 'dubai', '2026-10-09'::date, 108.5, 'settle', '오피넷', null),
  ('biz_dy', 'dubai', '2026-10-12'::date, 109.7, 'settle', '오피넷', null),
  ('biz_dy', 'dubai', '2026-10-13'::date, 108.75, 'settle', '오피넷', null)
) as v(business_id, series, point_date, value, kind, source, label)
where exists (select 1 from businesses b where b.business_id = 'biz_dy')
on conflict do nothing;

insert into purchase_price_events (business_id, kind, event_date, title, html, dedupe_key, first_slot)
select 'biz_dy', 'memo', '2026-10-14'::date, '2026-10-14 PM 이전', '<b>10/14 저녁 신규</b> — <b>정산 확정(오피넷)</b>: 10/13 Brent $105.69·WTI $94.14·Dubai $108.75. 나프타−Brent 크랙 10/13 −0.42 확정. 10/14 Brent ~$106.0(+0.3%) 강보합 — 장중 상승분 일부 반납. ① <b>아람코 다란</b>: 사우디 국영통신 "제한적 화재", 사상자 없음. 생산·운영 영향 보도 없음. 다란 단지(58㎢, 상주 1.1만 명)는 아람코 석유·가스 운영의 중심. 나세르 CEO(10/5) "최대지속생산능력 1,200만b/d를 수일 내 가동 가능, 시스템 온전". 올해 앞서 라스타누라 정유소(16일 중단)·주베일 사토프·얀부 삼레프도 피격 이력. ② <b>상쇄 요인</b>: 사우디 9월 생산 약 1/3 증가(OPEC), 미국 "호르무즈 통해 원유 1,900만배럴 이동 지원", 러시아 디젤 수출 일부 허용. <b>상승 요인</b>: 호르무즈 유조선 공격 지속, 후티 사우디 석유시설 표적 선언. ③ <b>IEA 이사회 10/15(내일)</b>: 3월 약속한 4억배럴 방출 지연, 디젤 우선 가속 방출 및 잔여 약 1억배럴 세부 결정 예정. 미 회계감사원(GAO) "미국 SPR 고갈 이후 대비 부족" 경고. <b>시사점</b>: 아람코 본사 피격에도 생산 차질이 없어 $108.65 돌파는 보류. 내일 IEA 방출 규모가 단기 상단을, 후티의 다음 표적(정유소·수출항 여부)이 돌파 여부를 결정.<br><b>10/14 아침 — 사우디 석유 심장부 타격</b> — ① <b>아람코 다란 본사(행정동) 피격·화재</b>(10/13 밤): 사우디 에너지부 "화재 발생, 진화", 사상자 없음. 직격인지 요격 잔해인지 불명. 일부 대피령(로이터 소식통 4명). 아람코 공식 코멘트 없음. 생산 영향 보도 없음. 지잔 정유소는 앞선 공격 이후 가동 중단 상태. ② <b>후티 대변인 사리</b>: 사우디 석유시설 "정당한 표적" — 아람코 다란 본사, 리야드 킹칼리드 공항, 리야드 아람코 계열 정유소 인근 민간인 대피 경고. 사나 공격 시 "가혹하고 고통스러운 대응". 리야드 겨냥 미사일 요격 잔해로 4명 부상·주택 15채 피해. 누적 사망 최소 18명. ③ <b>사우디 연합군</b>: 사나 예멘석유회사 알사바 기지·라스이사 항 저장탱크·호데이다 석유시설 공습. 예멘 정부군 "예멘의 새벽" 반격, 타이즈 공습 9회. 사우디 내각 "후티는 대가를 치를 것". ④ <b>가격</b>: 10/13 Brent 약 $105.7(−$1, 정산 근사), WTI $94.14(+$0.40). 10/14 아시아장 Brent ~$106.5(+0.8%). 미 디젤 선물 +5%. <b>2027년물 WTI 12거래일 연속 사상 최고(~$84), Brent 2027년물 ~$90 사상 최고</b> — 시장이 장기 공급 부족을 가격에 반영. ⑤ <b>나프타</b>: 오피넷 10/12 $106.33(≈$946/톤), 10/13 $105.27(≈$937/톤). TE CFD 10/12 $891.10(+1.85%). <b>나프타−Brent 크랙 −2.3(10/9) → −0.3(10/12) → −0.4(10/13)</b>: 나프타가 원유를 따라잡는 중, 아직 +10 신호선 아래. ⑥ OPEC: 9월 사우디 생산 840만b/d(8월 620만에서 급증), 2026 수요 전망 6개월 연속 하향·2027 상향(재고 재축적 수요). 골드만 "러시아 디젤로 연료가격 크게 안 내려감". 트럼프 "후티가 중간선거 전 유가 올리려 한다". 이란, 핵시설 등 요충지 방어 강화(선거 후 미 공습 대비) 보도. 호르무즈 동쪽 유조선 화재(이란 당국). 미국 "해협 통해 원유 1,900만배럴 이동 지원". <b>시사점</b>: 공격 대상이 공항에서 아람코 본사·정유소로 이동 = 대표님이 말한 "이권자 엔트로피" 현실화. $108.65 돌파 조건(사우디 석유시설 실제 피해) 절반 충족 — 생산 차질 확인 시 돌파 가능성 높음.<br><b>10/13 오후</b> — <b>정산 확정(오피넷)</b>: 10/12 Brent $106.65·WTI $93.74·Dubai $109.70. 10/13 아시아장 Brent ~$105.3(−1.2%, 3일 연속 상승 후 숨고르기 — 러시아 디젤 수출 일부 허용 반영). ① <b>후티</b>(부하이티 정치국원): 미국이 사우디 공습에 합류하면 "미국과 역내 모든 미국 이익에 빠르고 고통스러운 보복". 월요일 밤 리야드 공항 탄도미사일 "직격" 주장. 화요일 새벽 카미스무샤이트 겨냥 탄도미사일 2발 요격(연합군), 후티는 카미스무샤이트 공군기지 드론 타격 주장. 국제 항공사에 사우디 공항 운항 경고(메카·메디나 제외). ② <b>사우디</b>: 에너지장관 "똑같이 심각한 대응". 방공망이 공격을 못 막은 원인 조사 착수. 리야드 공항 10/17 자정까지 폐쇄. 누적 사망 14명(토 13·일 1), 부상 300여 명. 델타항공 리야드 노선 2027년 3월로 연기. ③ <b>호르무즈</b>: IRGC "이틀 사이 세 번째 초대형유조선 타격" 주장(독립 확인 없음). 이란은 "미국 답변 아직 검토 중", 호르무즈 혼란 책임은 미·이스라엘 탓. ④ <b>서방 vs 이란</b>: 미·영·호주·캐나다 등 27개국 이란 "하이브리드 활동" 규탄 공동성명(영 RAF 페어포드 사건 이란 배후 지목), NATO 외교장관도 규탄. 이란 "근거 없음". ⑤ 미국 후티 공격 합류 결정 아직 없음. <b>시사점</b>: 하루 숨고르기지만 후티-미국 직접 충돌 위협 + 사우디 보복 예고로 상방 리스크 유지. $108.65 돌파는 미국 개입 결정 또는 사우디 석유시설 실제 피해 확인 시.<br><b>10/13 아침</b> — Brent 10/12 정산 약 $106.65(+$1.93, +1.84%, 2주여 만에 최고, 장중 $106.5~107), WTI 약 $93.7(+2.1%). 9월 고점 $108.65까지 약 $2. ① <b>사우디 에너지장관</b>: "후티의 치명적인 석유·가스 시설 공격에 심각한 대응" 예고. 사우디 연합군, 카미스무샤이트 2발·리야드 1발 탄도미사일 요격. 리야드 킹칼리드 공항 <b>10/17까지 폐쇄 연장</b>. FAA 사우디 상공 주의(12/10까지). ② <b>트럼프</b>: 빈살만과 통화, "후티가 아주 못되게 굴고 있다". 사우디 공격 합류 여부 "할 수도" — 미결정. 이란 추가 군사행동 "두고 보자", "전쟁 곧 끝나고 유가 크게 떨어질 것". ③ <b>호르무즈</b>: 월요일 제품운반선(products tanker) 해협 통과 중 미확인 발사체 피격(UKMTO). 인도, 자국 선원 탄 선박 2척 피격 규탄(2명 실종). ④ <b>걸프 원유 출하 1,750만b/d, 전쟁 전의 약 98% 회복</b>(TE 인용 보도) — 원유는 우회·출하 회복, 그러나 공격·보험 리스크 지속. ⑤ <b>아람코 CEO</b>: "원유 공급 여전히 심각하게 타이트". 사우디 에너지부: 동서 파이프라인 1,000만b/d 확장에 2~3년. ⑥ <b>러시아·우크라이나</b>: 트럼프 "에너지 휴전 합의" 발표 직후 러시아가 우크라이나 가스시설 타격(젤렌스키). 러시아 디젤 수출 50만t(작년 2,860만t 대비 극소), 노박 "연말까지 300~350만t 가능". ⑦ IEA, 10/15 회의 전 디젤 방출 가속 촉구. 이란 "미국 답변 불충분" 유지, 중재자 통한 메시지 교환은 계속. <b>오늘 체크</b>: $108.65 돌파 여부, 오피넷 10/12 나프타(크랙 −2 → ?), IEA 10/15 회의.<br><b>10/12 아침 — 협상 정체 + 공격 확산</b> — ① <b>이란 "미국 답변 불충분"</b>(10/11, 최고국가안보회의 모센 레자이, IRNA): 이란은 더 이상 미국에 응답하지 않으며 미국이 일부 사안을 해명해야 한다. 전투 재개 시 "역내 해저케이블·데이터센터·AI 시설"을 타격하겠다고 위협. 호르무즈 완전 재개 협상 정체. ② <b>리야드 공항 또 피격(10/11 일)</b>: 국내선 3·4 터미널 피격, 공항 일요일 폐쇄. 후티 "토요일 이후 최소 4차례 작전" 주장, 사우디 공항 이용 경고. 부상 인도인 1명 사망(사망자 증가). ③ <b>담맘 킹파흐드 공항 공격</b>: 후티 주장, 사우디 당국 확인. 사우디 동부(유전 지대)까지 사정권. ④ <b>오만 소하르항 유조선 드론 피격</b>(UKMTO, 10/11 밤~12 새벽): 호르무즈 밖 오만 항구, 선원 대피 중, 피해·유출 미확인. 공격 범위가 해협 밖으로 확대. ⑤ 사우디·이란 외무장관 통화(후티 공격 격화 후 첫 공개 접촉). 트럼프 후티 공격 합류 결정 아직 없음. ⑥ 정산가 참고: 10/9 Brent 정산 $104.72, 정산 후 마지막 거래 $104.42. ⑦ 나프타 크랙 교차확인: Flux 10/7 MOPJ 나프타 크랙 +$1.85 — 오피넷 기준 −$2와 같은 "0 근처" 구간. <b>오늘 체크</b>: 개장 갭 크기, Brent $108.65(9월 고점) 시험 여부, 오피넷 나프타 10/12값과 나프타−Brent 크랙 방향.<br><b>10/11 오후</b> — ① <b>파키스탄, 사우디와의 상호방위조약 발동</b>(리야드 공항 공격 관련). 리야드 공항은 이번 주에만 세 번째 피격. ② <b>트럼프</b>: 미국 합류 여부 아직 미결정, 빈살만 왕세자와 곧 통화 — "빨리 결정하겠다". 루비오 국무장관 "비열한 공격 중단하라". ③ <b>美 CENTCOM(10/11 새벽)</b>: 봉쇄 돌파 시도한 파나마 선적 상선 Ocean Molica를 오만만에서 전투기 정밀타격으로 무력화. 봉쇄 3개월간 상선 4척 무력화·135척 회항·IRGC 연계 유조선 10척 파괴(CENTCOM 집계). ④ <b>호르무즈 화재 유조선</b>: UAE 당국이 선원 22명 구조. IRGC 주장 "기뢰 폭발 초대형유조선"은 여전히 독립 확인 없음. 해협 밖 대기 선박 114~148척. ⑤ <b>예측시장</b>: 호르무즈 정상 통항 복귀 확률 10월 말 1%, 12월 말 17%(Straits.live 집계). Reuters: 9/28~10/5 유조선 공격 최소 12건. ⑥ 외교: 美·이란 "7일 내 재개" 제안 교환 지속, 이란 회신 아직 없음. <b>월요일 체크</b>: 개장 갭(금 $104.72 기준), 트럼프의 후티 공격 결정, 이란 회신.<br><b>10/11 오전 — 주말 확전</b> — ① <b>리야드 킹칼리드 국제공항 피격(10/10 토 오후 3시경)</b>: 사우디 민항청 12명 사망·309명 부상(미국인 1명 포함), 2015년 이후 사우디 최악. "미사일"(AFP 외교소식통). 후티는 이번 건 미주장(목요일 공격은 탄도미사일로 주장), 미 국무부는 후티 지목. 공항 운영 일시 중단, 쿠웨이트항공 결항, 미·영·캐나다 등 공항 회피 권고. 같은 날 담맘 킹파흐드 공항 인근에도 발사체 낙하. ② <b>트럼프</b>: 후티 공격 합류 "할 수도 있다, 빨리 결정하겠다". 선거 전 이란 불공격 약속이 바뀌냐는 질문에 "보겠다(we''re gonna take a look)". 테네시 연설에서 이란 지도부 "미쳤다", 선거 전 이란이 먼저 움직일 수 있다고 경고. ③ <b>사우디 연합군</b>: 예멘 후티 군사목표 136곳 파괴(대규모 작전, 사다주). ④ <b>호르무즈</b>: UKMTO — 해협 빠져나오던 유조선 미확인 발사체 피격·화재(선원 무사). IRGC — "비인가 항로" 초대형유조선 기뢰 피격 주장(독립 확인 없음), LPG선 NV Sunshine 타격 주장. 라스알카이마(UAE) 정박지 선박들에 "정박지 떠나라" 무선 지시. UKMTO 최근 10일 걸프 상선 공격 16건(Windward 12건 확인, 11척 유조선). 10/8 하루 통과 8척, 대기 선박 149척. ⑤ <b>외교</b>: 이란 페제시키안 "수정안 준비, 중재자 통해 마무리 가능" vs "협상할 때마다 미국이 공격". 푸틴이 트럼프에게 이란 입장 전달(크렘린). ⑥ 러시아 디젤 30만t 즉시 방출(트럼프). 미 디젤 평균 $6.28/갤런(AAA). <b>시사점</b>: 금요일 종가($104.72)에 주말 확전 미반영 → 월요일(한국 시간 월요일 오전) 개장 시 상승 출발 가능성. 9월 고점 $108.65가 1차 관문.<br><b>10/10 밤</b> — 주말 휴장, 가격은 10/9 종가 유지(Brent $104.72·WTI $91.85). ① 오피넷 나프타 10/9 $102.45/bbl(≈$912/톤), 전일 대비 +0.1% 보합. ② 호르무즈 통과(Windward, 10/8 기준): 하루 8척(입항 5·출항 3, 1척 AIS 끔), 전일 18척에서 급감. ③ 이란 국영 IRIB: 10/8~9 호르무즈 남쪽 항로에서 대형 폭발 다수, "비인가 항로 선박이 기뢰에 닿았을 가능성". 선박명·피해 미확인(독립 확인 없음). IRGC는 "불법 항로" LPG선 피격·화재 주장(미확인). ④ 사우디 연합군 후티 추가 타격, 푸틴-트럼프 이란 관련 통화 — 크렘린 "트럼프가 러시아의 이란 합의 노력을 환영". ⑤ 이란의 7일 재개안 美 답변에 대한 회신: 아직 미발표(아락치 10/8 "수일 내"). 다음 주 체크: 이란 회신, 월요일 개장 시 Brent $108.65(9월 고점) 근접 여부, 오피넷−CFD 격차($100 초과 시 현물 패닉 신호).<br><b>10/10 오전</b> — 오피넷 나프타 10/8 $102.36/bbl(≈$911/톤), 10/7 $97.91(≈$871). TE CFD보다 약 $40 높음. 나프타 CFD 10/8 $870.70(+4.36%), 7월 이후 최고권·한 달 +5.5%, TE 4분기 전망 $856.55를 이미 상회. 10/9 종가 Brent $104.72(+44¢), WTI $91.85(+36¢). 주간 Brent +2.4%($102.25→$104.72), WTI +0.8%. 장중 $102대까지 밀렸다 반등 마감. <b>정정</b>: 10/8 종가는 Brent $104.28·WTI $91.49(앞서 $104.11/$91.18). ① 허리케인 Isaias: 미 멕시코만 원유 생산 70% 이상 중단(10/8 기준 130만b/d, 62.9%). ② 트럼프 "푸틴이 디젤 방출에 동의", 미 재무부 러시아 디젤 임시 일반허가(약 2,250만배럴 제안). ③ 페르시아만 유조선 운임 사상 최고. 호르무즈 밖 선박간 환적(STS)에 유조선 묶임. 10/4까지 1주 유조선 11척 공격(CNBC: 전시 최고). 미 SPR 사상 최저 근접. ④ 미국, 이란 원유·석유화학 운송 관련 선박 17척 등 추가 제재. ⑤ TradingEconomics 전망: Brent 분기말 $106.6, 12개월 $121.<br><b>10/9 밤</b> — Brent $102.7(-1.5%), WTI $90.4(-1.2%), 장중 CFD. 전날 종가 Brent $104.11·WTI $91.18. 주간 Brent +2%. ① 중국, 황금연휴 중단 후 10월 석유제품 수출 재개(로이터). 휘발유·디젤·항공유 합계 약 370만t 승인. 9월 예상치 400만t 초과 대비 소폭 감소. 글로벌 디젤 타이트 완화 요인. ② 이란 아락치 외무장관(10/8): 7일 호르무즈 재개안에 대한 미국 답변 검토 중, "수일 내 회신". 카타르 중재. 1~5일 미국 조치, 6일차 통항 정상화, 7일차 최종협상 개시. 조건: 적대행위 중단, 동결자산 해제, 원유수출 제재 해제, 해상봉쇄 해제. 트럼프는 앞서 이 조건을 거부. ③ 호르무즈·걸프 해운 위협 지속. 멕시코만 생산 약 130만b/d 중단(Isaias). 나프타 CFD는 10/7 $834.28 이후 갱신 없음.<br><b>10/9 오후</b> — 10/8 종가 Brent $104.11(+3.9%, 장중 +5.7%로 $106 근접), WTI $91.18(+3.3%). 10/9 아시아장 Brent $103.0(-1.2%, CFD). ① 공격 "지시" 아님: 국방부가 CENTCOM에 대규모 전투 재개 대비 준비 완료 지시(Axios), 백악관이 선거 전 타격 옵션 요청(The Atlantic). 트럼프 10/8 트루스소셜 "중간선거 전에는 이란 공격 안 한다", "생산적 대화". 이후 3일간 타격 계획이 마련돼 있다는 보도. 선거 후 재개 가능성은 열려 있음(TIME 인터뷰). ② 호르무즈: 최근 1주 유조선 9척 공격, 전쟁 이후 주간 최다. 화요일까지 1주 통과량 약 950만b/d(전쟁 전 대비 약 -30%), 통항 2개월래 최저. ANZ Hynes "다른 수출로가 없어 위험 감수". ③ 미 원유재고 -320만배럴(4억2,410만), 디스틸레이트 1억514만배럴로 5년 계절 범위 하회. IEA 디젤 가속 방출은 기존 4억배럴 계획 안의 물량(추가분 아님). ④ 허리케인급 폭풍 Isaias로 멕시코만 생산 최대 130만b/d 중단, 쉐브론·쉘 인력 철수. ⑤ 나프타 CFD 10/7 $834.28(+0.74%), 10/8 급등분은 미반영.<br><b>10/8 저녁</b> — Brent 장중 $105.01(+4.8%), WTI $92.6(+4.9%): 약 한 달 만의 최고치(TradingEconomics CFD, 종가 아님). ① The Atlantic: 백악관이 11/3 중간선거 전 이란 타격 옵션을 국방부에 요청. 규모·목표는 논의 중이며, 선거 후 더 큰 작전 가능성. 지지자들조차 호르무즈 통항 회복 효과는 기대하지 않음. ② UKMTO: 카타르 북쪽 51해리 해상에서 유조선이 다수 발사체에 피격, 사상자 발생. 공격 주체 미확인. 이란의 호르무즈 유조선 공격 증가 데이터. ③ 이란·오만, 호르무즈 지정 안전항로 좌표 합의(이란 외무부 대변인 바가이). 완전 개방이나 안전통항 보장은 아님. ④ 사우디 연합군, 후티 군사목표 82곳 타격(사다·호데이다·알자우프·마리브, 탄도미사일 저장시설 11곳 포함). 리야드 킹칼리드·아브하 공항 공격(3명 사망·36명 부상)에 대한 보복. ⑤ 열대폭풍 Isaias로 미 멕시코만 생산 50만b/d 이상(약 25%) 가동 중단. ⑥ 아람코 경고: 전 세계 재고 재축적에 약 2년 소요. ⑦ 미 10년물 금리 5.32%, 미 연준 9월 의사록: 연내 추가 인상 다수 의견. 나프타·중국 제품수출 재개는 신규 수치 없음.<br><b>10/8 오전</b> — 10/7 종가 Brent $100.20(-38¢)·WTI $88.28(-$1.16): IEA 회원국이 디젤 비축분 우선 방출에 합의하며 하락. 10/8 아시아장 Brent $100.93·WTI $89.02로 반등. EIA 주간 원유재고 -318.6만배럴(5주래 최대 감소, API -209만). EIA 단기전망(STEO) 4분기 Brent $105로 전월 대비 +$14 상향. 아람코 CEO 나세르 "전 세계 재고 전쟁 전 약 100억 → 60억배럴 미만, 실제 쓸 수 있는 건 약 10% — 위험할 정도로 얇다". Vitol "최근 7~10일 중동발 원유 약 1,200만b/d·제품 200만b/d 출하". UKMTO: 10월 들어 호르무즈 인근 공격 최소 9건(9월 전체의 절반). 후티, 사우디 지잔·나즈란 공항 공격(지잔에 40만b/d 정유소). <b>정정</b>: 10/6 종가는 Brent $100.58·WTI $89.44(앞서 $87.99는 CFD 장중값). 나프타는 10/1 $828.92 이후 신규 수치 없음.<br><b>10/7</b> — 사우디 에너지장관 "East-West 파이프라인 송유량 하루 580만배럴", 로이터 "선적 중단 없었음" → 앞서 AFP 소식통의 "재중단" 보도와 상충, 공식 수치 기준 정상가동으로 정정. Brent 10/6 장중 $97.8까지 밀렸다 $100대 회복, 10/7 $101.24(+0.65%). 10/5 종가 Brent $100.32·WTI $89.43. 미 API 원유재고 -209만배럴. G7(10/2) 디젤·원유 1억배럴 방출 합의 + 에너지 수출제한 자제 약속. 아람코 11월 아시아 판매가 6년래 최저. 내년 1월물 $96·2월물 $94(백워데이션). 쿠라이스 화재 연기 10/6까지 관측(Misbar).<br><b>10/4~6 사우디 공격</b> — 10/4(일) East-West 파이프라인 쿠라이스 펌프장(처음 피격) "큰 피해, 송유 재중단"(AFP 사우디 에너지업계 소식통, 10/5) — 상충 보도 있음. 9/11~22에 이어 두 번째 중단. 10/5(월) 후티 "리야드 킹칼리드 국제공항·아브하 공항·라비그 정유소" 공격 주장, 사우디 항공당국 공항 피격·3명 부상 확인, 리야드 항공편 중단. 후티 "메카·메디나 제외 사우디 영공 전체가 작전구역" 선언. 예멘 대통령실, 후티 장악지 탈환 작전 발표.<br><b>10/6~7 신규</b> — Kpler: 이란 제외 중동 원유수출이 지난주 전쟁전 수준 초과. 쿠웨이트 생산 전쟁전 75%, 이라크 선박 추가 용선 추진. 아람코 11월 아시아향 아랍라이트 OSP 기준가 대비 -$5(10월 -$2). G7 비상비축 방출. Brent $100 하회, WTI $87.99. 사우디 지원군 "홍해 연안 거점 탈환" 주장 vs 후티 "완전 통제" 반박. 영국 디젤 사상최고(정제품은 여전히 타이트). Brent 10/6 그래프 값은 근사치($100 하회).<br><b>10/5(월) 추가</b> — 사우디 주도 연합군, 후티의 리야드·쿠라이스 공격 주장을 "오해의 소지(misleading)"라고 반박. 이란 국회의장 갈리바프(일) "미국이 7개 조건 충족 전까지 호르무즈 계속 폐쇄". 아람코, 아시아향 아랍라이트 공식판매가 $3 인하(운임·전쟁보험 부담 반영, 대서양산으로의 이탈 방지). 금값 하락 — 시장은 안전자산 공포보다 인플레·금리 문제로 해석. 참고: 쿠라이스는 3월 이란 공격으로 생산능력 30만b/d 감소 이력(사우디 석유부, 4월 공개).<br><b>10/5(월) 신규</b> — 후티 "리야드·쿠라이스 아람코 시설에 탄도미사일·드론" 주장(Reuters), 실제 피해·생산 차질 여부 미확인. Brent $103.06(+81센트), WTI $91.57, 무르반 $110. <b>정정</b>: 금요일(10/2) 종가는 Brent $102.25·WTI $91.11 — 이전 보고한 $99.68/$88.31은 장중 저점. G7, 원유·디젤 비상비축 최대 1억배럴 방출 검토.<br><b>10/4(일)</b> — UKMTO: 호르무즈에서 미상 발사체가 유조선 타격. 사우디 사나에 26회 공습(후티 TV). 후티 대변인 사레 "리야드 인근 석유시설에 탄도미사일·드론, 화재 발생" 공식 주장. 예멘 전선 하루 전투원 80명 사망(AFP). 루비오, 미·이란 합의의 걸림돌 지목.<br><b>10/3(토)</b> — 후티 "리야드 아람코 시설에 탄도미사일·드론 공격" 주장, 로이터 목격자 리야드 아람코 시설 인근 대형 연기·화염 확인(피해 여부 미상). 사우디, 미국 정보·표적지원 받아 대후티 공세 준비 + 사나 공습. 트럼프 안보팀 캠프데이비드 회의(이란·예멘). IRGC계열 파르스 "호르무즈서 유조선 2척 폭발(AIS 끈 선박)". 이라크 원유 200만배럴 호르무즈 통과.<br><b>사우디 공격(최근 6일)</b> — 9/29경 얀부 남쪽 무아지즈 터미널 대형 저장탱크 화재(Al Akhbar). 9/30 아브카이크 피격 "추정"(X계정·위성연기, 미확인). 10/1 얀부 북부 원유터미널(적재능력 150만b/d) 항구 내부 첫 피격, 적재 일시중단(Maritime Executive). 후티측 "자잔·나지란·얀부 아람코 자산 1,000억달러를 정당한 표적 지정".<br><b>10/2 사건</b> — 유럽 전략비축유 방출 검토 → WTI -4.91%(1개월 최저). 펜타곤, 항모 1척+병력 1만명 추가 걸프 배치 검토. 트럼프, 측근에 "11월 중간선거 후 이란 폭격 재개" 예상 발언 보도. 무르반(UAE) +7% $109.4 — 걸프산 등급만 급등.<br>
<b>정정</b> — 어제 보고한 "10/1 Brent $96.76 종가"는 장중 스냅샷이었음. 실제는 수·목 연속 상승해 10/1 $102.31로 마감, 10/2 $99.68.<br>
<b>나프타</b> — CFD 10/1 $828.92(+4.30%, 월+6.01%, 전년+55.54%). TE 전망 4Q $813 → 1Q27 $874 → 3Q27 $942(상승 경로). 한국 1~7월 나프타 수입 -21.7%(1,260만톤). S-Oil 샤힌 크래커(에틸렌 180만톤) 10월말 가동 예정.<br>
<b>그래프 주의</b> — 4/30 $126은 장중 최고(종가 $114). 아시아 실물은 OPIS(2·4·5·7월)와 동북아 월간지수(9월) 혼합. 1월 나프타·일부 월 데이터 공백.', 'memo:' || '2026-10-14 PM 이전', 'seed'
where exists (select 1 from businesses b where b.business_id = 'biz_dy')
on conflict do nothing;

commit;
