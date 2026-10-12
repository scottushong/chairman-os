-- =====================================================================
-- Chairman OS — 0073_feature_switches («빼기 쉬운 구조» PHASE 1 — 기능 스위치)
-- 작성: 2026-10-12 (대표 결정 «대표 허락 없이 끝까지 만든다. 대표가 나중에 뺀다.»)
--
-- ■ 무엇을 하나 ■
--   새 기능마다 스위치 한 줄. 켜기 · 끄기(enabled)와 누가 보나(audience: chairman 대표만 · exec 임원 이상 · all 전원).
--   business_id가 null이면 그룹 기본값, 회사 id면 그 회사만 덮는다. 바꿀 때마다 이유 필수 · 감사 한 줄.
--   앱(src/lib/features.ts)이 화면 · 메뉴 · Server Action을 이 표로 거른다. 다음 단계의 새 RPC는 feature_on()을 부른다.
--
-- ■ 판정 ■ 읽기 = 로그인한 사람 전원(비밀 없음 — 기능 이름 · 켜짐 · 범위뿐). 쓰기 = feature_switch_set(대표만)뿐 —
--   표에 직접 쓰는 grant는 없다. 'exec' = Chairman · GroupCFO · BusinessCEO · Executive.
--   기본값은 DB가 모르면 안 되므로 그룹 기본 줄을 기능마다 미리 넣는다(아래 3절). 줄이 없는 기능 키는 꺼진 것으로 본다.
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0072를 고치지 않는다 · FORCE를 내리지 않는다. 새 정책 · grant는 늘 to authenticated.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 표
-- =====================================================================
create table feature_switches (
  switch_id   uuid primary key default gen_random_uuid(),
  business_id text references businesses(business_id) on delete restrict,            -- [일반] null = 그룹 기본값
  feature_key text not null check (feature_key ~ '^[a-z][a-z0-9_]{1,62}$'),           -- [일반]
  enabled     boolean not null default true,                                         -- [일반]
  audience    text not null check (audience in ('chairman', 'exec', 'all')),         -- [일반] 대표만 · 임원 이상 · 전원
  reason      text not null check (length(btrim(reason)) between 2 and 500),         -- [일반] 바꾼 이유(기본 줄은 «기본값(0073)»)
  updated_by  uuid,                                                                  -- [일반] 기본 줄은 null
  updated_at  timestamptz not null default now()
);
create unique index feature_switches_one on feature_switches ((coalesce(business_id, '')), feature_key);
comment on table feature_switches is
  '0073. 기능 스위치 — 그룹 기본(business_id null) · 회사 덮어쓰기. 쓰기는 feature_switch_set(대표만 · 이유 · 감사)뿐.';

alter table feature_switches enable row level security;
revoke all on table feature_switches from public, anon, authenticated;
grant select on table feature_switches to authenticated;
create policy feature_switches_read on feature_switches for select to authenticated using (true);

-- =====================================================================
-- 2절. 함수
-- =====================================================================

/** 지금 사람이 이 범위에 드나. 'all'은 로그인한 사람(역할이 있는 사람) 전원. */
create or replace function feature_audience_ok(p_audience text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select case p_audience
    when 'all' then auth_role() is not null
    when 'exec' then coalesce(auth_role()::text in ('Chairman', 'GroupCFO', 'BusinessCEO', 'Executive'), false)
    when 'chairman' then coalesce(auth_role()::text = 'Chairman', false)
    else false
  end;
$fn$;

/**
 * 이 기능이 지금 사람에게 켜져 있나. 회사 줄 → 그룹 줄 순서. 줄이 없으면(모르는 기능) false.
 * 다음 단계의 RPC는 첫 줄에서 «if not feature_on('키', 회사) then raise exception 'feature_off' …»로 부른다.
 */
create or replace function feature_on(p_feature text, p_business text default null) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((
    select s.enabled and feature_audience_ok(s.audience)
      from feature_switches s
     where s.feature_key = p_feature
       and (s.business_id is null or s.business_id = p_business)
     order by (s.business_id is null)
     limit 1
  ), false);
$fn$;

/**
 * 스위치 바꾸기 — 대표만 · 이유 필수 · 아는 기능(그룹 기본 줄이 있는 키)만 · 감사 한 줄.
 * 모든 검사가 쓰기보다 먼저다(쓴 뒤에는 raise하지 않는다).
 */
create or replace function feature_switch_set(p_feature text, p_business text, p_enabled boolean, p_audience text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_old feature_switches;
  v_id  uuid;
begin
  if coalesce(auth_role()::text, '') <> 'Chairman' then
    raise exception 'feature_switch_denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 or length(p_reason) > 500 then
    raise exception 'feature_switch_reason' using errcode = '22023';
  end if;
  if p_enabled is null or p_audience is null or p_audience not in ('chairman', 'exec', 'all') then
    raise exception 'feature_switch_value' using errcode = '22023';
  end if;
  if not exists (select 1 from feature_switches where business_id is null and feature_key = p_feature) then
    raise exception 'feature_switch_unknown' using errcode = '22023';
  end if;
  if p_business is not null and not exists (select 1 from businesses where business_id = p_business) then
    raise exception 'feature_switch_business' using errcode = '22023';
  end if;

  select * into v_old from feature_switches
   where coalesce(business_id, '') = coalesce(p_business, '') and feature_key = p_feature
   for update;
  if v_old.switch_id is not null then
    update feature_switches
       set enabled = p_enabled, audience = p_audience, reason = btrim(p_reason), updated_by = auth.uid(), updated_at = now()
     where switch_id = v_old.switch_id;
    v_id := v_old.switch_id;
  else
    insert into feature_switches (business_id, feature_key, enabled, audience, reason, updated_by)
    values (p_business, p_feature, p_enabled, p_audience, btrim(p_reason), auth.uid())
    returning switch_id into v_id;
  end if;

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'feature_switches', v_id::text, p_business, auth.uid(), auth_role()::text,
    case when v_old.switch_id is null then null
         else jsonb_build_object('enabled', v_old.enabled, 'audience', v_old.audience) end,
    jsonb_build_object('feature', p_feature, 'business_id', p_business, 'enabled', p_enabled, 'audience', p_audience, 'reason', btrim(p_reason)),
    '기능 스위치 바꾸기(0073)');
end;
$fn$;

-- =====================================================================
-- 3절. 그룹 기본 줄 — src/lib/features.ts의 FEATURES와 같은 키 · 같은 기본값(check:features가 대조한다)
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'ai_assist',          true, 'all',      '기본값(0073)'),
  (null, 'finance_upload',     true, 'all',      '기본값(0073)'),
  (null, 'process_charts',     true, 'all',      '기본값(0073)'),
  (null, 'intake',             true, 'chairman', '기본값(0073)'),
  (null, 'finance_docs',       true, 'chairman', '기본값(0073)'),
  (null, 'monthly_pl',         true, 'chairman', '기본값(0073)'),
  (null, 'sales_margins',      true, 'chairman', '기본값(0073)'),
  (null, 'cost_candidates',    true, 'chairman', '기본값(0073)'),
  (null, 'ledger_post',        true, 'chairman', '기본값(0073)'),
  (null, 'chairman_dashboard', true, 'chairman', '기본값(0073)');

-- =====================================================================
-- 4절. 함수 권한 — public · anon에게서 이름으로 걷는다. 부르는 것만 authenticated.
-- =====================================================================
revoke all on function feature_audience_ok(text) from public, anon, authenticated;
revoke all on function feature_on(text, text) from public, anon;
revoke all on function feature_switch_set(text, text, boolean, text, text) from public, anon;
grant execute on function feature_on(text, text) to authenticated;
grant execute on function feature_switch_set(text, text, boolean, text, text) to authenticated;

commit;
