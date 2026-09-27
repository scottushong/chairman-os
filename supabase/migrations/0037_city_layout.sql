-- ---------------------------------------------------------------------
-- 0037. 그룹 시티 배치 (Phase 8 G-1)
--
-- /group은 도시 전경 한 장 위에 회사와 이니셔티브를 핫스팟으로 올린다. 이 표는
-- **그 핫스팟이 그림의 어디에 서는지**만 안다 — 회사의 숫자(매출·자율성·이양)는
-- 여기 없고 화면이 원래 자리(finance_kpis · autonomy_assessments · dependency_areas)에서
-- 읽어 lib/city.ts로 접는다. 숫자를 여기 베끼면 두 벌이 생겨 곧 어긋난다.
--
-- **한 줄은 회사 하나이거나 이니셔티브 하나다. 둘 다이거나 둘 다 아닌 줄은 없다**
-- (city_layout_target_check). 이니셔티브의 줄은 «빈 터»다. 회장이 그 터를 회사로
-- **승격**하면 같은 줄이 initiative_id를 비우고 business_id를 받는다 — 같은 자리에
-- 같은 상자가 그대로 남고, stage_image가 'foundation'으로 선다(한 번의 update라
-- 중간에 두 줄이 되거나 빈 자리가 생기는 순간이 없다).
--
-- **좌표는 그림에 대한 백분율이다(0~100).** 픽셀로 적으면 폰·노트북·원본 폭(1280/1920/2752)
-- 중 하나에서만 맞는다. 상자가 그림 밖으로 나가는 값은 DB가 막는다 — 화면이 드래그를
-- 가두지만 API로 들어오는 길이 남는다.
--
-- **stage_image는 덮어쓰기다. null이 기본이고 null은 «자동»이다.** 자동이면 화면이
-- 완성도(lib/city.ts)에서 단계를 낸다(0~25 foundation / ~60 frame / ~90 finishing /
-- 100 complete). 값이 있으면 그 단계로 고정한다 — 승격 직후의 'foundation'이 그렇고,
-- 회장이 /group/edit에서 «자동»으로 되돌리면 다시 null이 된다.
-- ---------------------------------------------------------------------

create table city_layout (
  id            bigint generated always as identity primary key,
  business_id   text references businesses(business_id) on delete restrict,          -- [일반]
  -- 이니셔티브가 지워지면 그 터도 지운다. 주인 없는 터는 눌러도 갈 곳이 없다.
  initiative_id text references initiatives(initiative_id) on delete cascade,         -- [일반]
  x             numeric(5, 2) not null,                                               -- [일반] 왼쪽 %
  y             numeric(5, 2) not null,                                               -- [일반] 위쪽 %
  w             numeric(5, 2) not null,                                               -- [일반] 폭 %
  h             numeric(5, 2) not null,                                               -- [일반] 높이 %
  stage_image   text,                                                                 -- [일반] null = 자동
  updated_by    uuid not null default auth.uid(),                                     -- [제한]
  updated_at    timestamptz not null default now(),

  constraint city_layout_target_check check ((business_id is null) <> (initiative_id is null)),
  constraint city_layout_box_check check (
    x >= 0 and y >= 0 and w > 0 and h > 0 and x + w <= 100 and y + h <= 100
  ),
  -- 'lot'은 빈 터다. 회사에 'lot'을 걸면 «회사가 아직 땅도 안 팠다»가 되는데, 그것은
  -- 승격 전 이니셔티브가 말하는 사실이다 — 그래도 막지 않는다. 회장이 고르는 값이다.
  constraint city_layout_stage_check check (
    stage_image is null or stage_image in ('lot', 'foundation', 'frame', 'finishing', 'complete')
  ),
  -- 한 회사가 도시에 두 번 서면 핫스팟 둘이 같은 숫자를 말한다.
  constraint city_layout_business_unique unique (business_id),
  constraint city_layout_initiative_unique unique (initiative_id)
);

comment on table city_layout is
  '0037. 그룹 시티 전경 위 핫스팟의 자리(%). 회사 하나 또는 이니셔티브 하나. 숫자는 여기 두지 않는다.';
comment on column city_layout.stage_image is
  '0037. null = 완성도에서 자동(lib/city.ts). 값이 있으면 그 단계로 고정.';

-- 고친 사람과 시각은 DB가 적는다. 화면이 보낸 값을 믿지 않는다 — updated_by를 남의 id로
-- 적어 보내면 감사가 거짓말을 한다.
create or replace function city_layout_touch() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$fn$;

create trigger city_layout_touch_trigger
  before insert or update on city_layout
  for each row execute function city_layout_touch();

-- ---------------------------------------------------------------------
-- RLS — 읽기는 그 줄의 주인을 볼 수 있는 사람. 쓰기는 Chairman만.
--
-- 회사 줄은 has_business()가 판정한다(0002 Business Isolation). 이니셔티브 줄은
-- 이니셔티브를 읽을 수 있는 역할만 본다(0017 can_read_initiatives) — 터의 자리만으로도
-- «회장이 무엇을 준비하는가»가 새어 나간다.
--
-- **쓰기가 Chairman뿐인 이유.** 원문이 "회장이 /group/edit에서 드래그 배치"다. 도시에
-- 무엇이 어디 서는지는 회장의 그림이고, CFO가 옮길 이유가 없다.
-- ---------------------------------------------------------------------
create or replace function can_read_city_layout(p_business text, p_initiative text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and case
    when p_business is not null then has_business(p_business)
    when p_initiative is not null then can_read_initiatives()
    else false
  end;
$fn$;

comment on function can_read_city_layout is
  '0037. 회사 줄은 has_business, 이니셔티브 줄은 can_read_initiatives.';

create or replace function can_write_city_layout() returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_active() and auth_role() = 'Chairman';
$fn$;

alter table city_layout enable row level security;

-- **force를 걸지 않는다.** 0035 머리 주석의 규칙이다 — 이 저장소가 네 번 밟은 함정
-- (0023 · 0027 · 0029 · 0034)이고, 나중에 이 표를 읽는 definer 함수가 조용히 0행을 받는다.
-- 자물쇠는 revoke다: Supabase는 public의 새 표를 만들자마자 anon/authenticated에게 여므로
-- (truncate까지) 걷고 필요한 것만 다시 준다. anon은 한 줄도 못 본다.
revoke all on table city_layout from anon, authenticated;
grant select, insert, update, delete on table city_layout to authenticated;
-- 판정 함수도 anon에게서 걷는다. PUBLIC에서 걷지 않으면 anon만 걷는 것은 뜻이 없다.
revoke execute on function can_read_city_layout(text, text) from public, anon;
revoke execute on function can_write_city_layout() from public, anon;
grant execute on function can_read_city_layout(text, text) to authenticated;
grant execute on function can_write_city_layout() to authenticated;

create policy city_layout_read on city_layout
  for select using (can_read_city_layout(business_id, initiative_id));
create policy city_layout_insert on city_layout
  for insert with check (can_write_city_layout());
create policy city_layout_update on city_layout
  for update using (can_write_city_layout()) with check (can_write_city_layout());
create policy city_layout_delete on city_layout
  for delete using (can_write_city_layout());

-- AI Agent와 Integration은 도시를 옮기지 않는다. 위의 permissive가 이미 막지만(Chairman이
-- 아니다), 그것이 나중에 느슨해져도 남는 방어선이다 — 0017과 같은 세 짝 이름이라
-- scripts/check-migrations.ts의 restrictive 루프가 카탈로그에서 잰다.
do $$
begin
  create policy ai_agent_no_insert on public.city_layout as restrictive for insert
    with check (auth_role() is distinct from 'AIAgent');
  create policy ai_agent_no_update on public.city_layout as restrictive for update
    using (auth_role() is distinct from 'AIAgent') with check (auth_role() is distinct from 'AIAgent');
  create policy ai_agent_no_delete on public.city_layout as restrictive for delete
    using (auth_role() is distinct from 'AIAgent');
  create policy integration_no_insert on public.city_layout as restrictive for insert
    with check (not is_integration());
  create policy integration_no_update on public.city_layout as restrictive for update
    using (not is_integration()) with check (not is_integration());
  create policy integration_no_delete on public.city_layout as restrictive for delete
    using (not is_integration());
end
$$;

-- ---------------------------------------------------------------------
-- 감사 기록. 0021이 밟은 자리를 다시 밟지 않는다 — audit_action에 'insert'는 없다(0022).
-- 승격은 update 한 줄이라 before/after가 initiative_id → business_id로 그대로 남는다.
-- ---------------------------------------------------------------------
create or replace function city_layout_audit() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (
    case tg_op
      when 'INSERT' then 'create'
      when 'UPDATE' then 'update'
      else 'delete_request'
    end::audit_action,
    'city_layout',
    coalesce(new.id, old.id)::text,
    coalesce(new.business_id, old.business_id),
    auth.uid(),
    auth_role()::text,
    case when tg_op in ('UPDATE', 'DELETE') then jsonb_build_object(
      'business_id', old.business_id, 'initiative_id', old.initiative_id,
      'x', old.x, 'y', old.y, 'w', old.w, 'h', old.h, 'stage_image', old.stage_image) end,
    case when tg_op in ('INSERT', 'UPDATE') then jsonb_build_object(
      'business_id', new.business_id, 'initiative_id', new.initiative_id,
      'x', new.x, 'y', new.y, 'w', new.w, 'h', new.h, 'stage_image', new.stage_image) end,
    case
      when tg_op = 'DELETE' then '그룹 시티 배치 삭제'
      when tg_op = 'UPDATE' and old.initiative_id is not null and new.business_id is not null
        then '그룹 시티 승격 (이니셔티브 → 회사)'
      else '그룹 시티 배치'
    end
  );
  return coalesce(new, old);
end;
$fn$;

create trigger city_layout_audit_trigger
  after insert or update or delete on city_layout
  for each row execute function city_layout_audit();

-- ---------------------------------------------------------------------
-- 시드 — 0003의 다섯 회사가 있는 환경에만, 전경(city-day)에서 눈으로 잰 자리.
--
-- 회장이 /group/edit에서 옮기기 전의 출발점이다. 회사가 없는 환경(새 production 회사를
-- «새 회사» 모달로만 만든 곳)에서는 아무 줄도 안 생긴다 — from businesses where가 그 판정이다.
-- updated_by는 auth.uid()가 비는 실행 시점이라 회장을 찾아 넣는다. 회장이 없으면 건너뛴다
-- (0021 · 0036과 같은 모양).
-- ---------------------------------------------------------------------
do $seed$
declare
  v_chairman uuid;
begin
  select user_id into v_chairman from user_profiles where role = 'Chairman' order by created_at limit 1;
  if v_chairman is null then
    raise notice '0037: Chairman 계정이 없어 그룹 시티 시드를 건너뛴다 (/group/edit에서 배치한다).';
    return;
  end if;

  insert into city_layout (business_id, x, y, w, h, updated_by)
  select b.business_id, s.x, s.y, s.w, s.h, v_chairman
    from (values
      ('biz_dy',     8.0, 40.0, 13.0, 42.0),
      ('biz_vana',  31.0, 14.0,  6.0, 31.0),
      ('biz_sticky', 59.0,  7.0, 15.0, 42.0),
      ('biz_hof',   70.0, 60.0, 13.0, 24.0),
      ('biz_boram', 83.0, 50.0, 16.0, 50.0)
    ) as s(business_id, x, y, w, h)
    join businesses b on b.business_id = s.business_id
  on conflict (business_id) do nothing;
end;
$seed$;
