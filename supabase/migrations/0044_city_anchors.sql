-- =====================================================================
-- 0044 그룹 시티 길목 — door · desk · road (Phase 8 G-2b · G-3)
--
-- 살아 있는 도시는 사람을 그림 위에서 걷게 한다. 걷는 길의 끝점이 건물마다 셋이다.
--
--   door  건물 입구. 접속한 사람이 서고, 결재 서류가 들어간다.
--   desk  창가 자리. 진행 중인 업무의 주인이 앉는다(진행바).
--   road  건물 앞 길. 사람이 들어오고 나가는 곳, 차량이 서는 곳.
--
-- **null이 기본이고 null은 «상자에서 낸다»다.** 점을 적지 않은 줄은 화면이 상자(x·y·w·h)에서
-- 셋을 계산한다(lib/city-live.ts anchorsOf). 회장이 /group/edit에서 점을 끌어야 값이 선다.
-- 한 점만 적어도 된다 — 없는 점은 상자에서 낸다.
--
-- **좌표는 0037과 같이 그림에 대한 %(0~100)다.** 상자 밖에 둘 수 있다 — 입구 앞 길은 상자 아래에
-- 있는 것이 보통이다. 그림 밖만 막는다. 모양이 틀린 값(키 오타·문자열 좌표)은 DB가 막는다:
-- 화면이 가두어도 API로 들어오는 길이 남고(0037 box_check와 같은 이유), 틀린 점은 사람을
-- 그림 밖으로 걷게 한다.
--
-- 권한은 0037 그대로다 — 새 표가 아니라 칸 하나라 RLS · 자물쇠 · 제한 정책이 그대로 걸린다.
-- 감사만 다시 쓴다: 점을 옮긴 update가 before/after에 보이지 않으면 «무엇이 바뀌었나»가 빈다.
-- =====================================================================

begin;

alter table city_layout add column anchors jsonb;                                  -- [일반] null = 상자에서

-- 점 하나: {"x": 0~100, "y": 0~100}. 다른 키는 받지 않는다.
create or replace function city_point_ok(p jsonb) returns boolean
language sql immutable set search_path = public as $fn$
  -- case로 순서를 박는다. SQL의 and는 앞에서부터 판정한다는 약속이 없어서, 문자열 좌표가
  -- 모양 검사보다 먼저 ::numeric을 만나면 23514가 아니라 22P02로 터진다.
  select case
    when jsonb_typeof(p) is distinct from 'object' then false
    when (select array_agg(k order by k) from jsonb_object_keys(p) as k) is distinct from array['x', 'y'] then false
    when jsonb_typeof(p -> 'x') <> 'number' or jsonb_typeof(p -> 'y') <> 'number' then false
    else (p ->> 'x')::numeric between 0 and 100 and (p ->> 'y')::numeric between 0 and 100
  end;
$fn$;

-- 점 묶음: door · desk · road 중 **있는 것만**, 각각 city_point_ok. 빈 객체도 받는다(= 전부 상자에서).
create or replace function city_anchors_ok(a jsonb) returns boolean
language sql immutable set search_path = public as $fn$
  select case
    when jsonb_typeof(a) is distinct from 'object' then false
    else not exists (
      select 1 from jsonb_each(a) as e(k, v)
       where e.k not in ('door', 'desk', 'road') or not city_point_ok(e.v)
    )
  end;
$fn$;

comment on function city_point_ok(jsonb) is '0044. 그룹 시티 점 하나 — {"x","y"} 둘 다 0~100 숫자.';
comment on function city_anchors_ok(jsonb) is '0044. 그룹 시티 길목 — door · desk · road 중 있는 것만, 각각 city_point_ok.';

alter table city_layout add constraint city_layout_anchors_check
  check (anchors is null or city_anchors_ok(anchors));

comment on column city_layout.anchors is
  '0044. {door, desk, road} 각 {x, y}(%). null이거나 빠진 점은 상자에서 낸다(lib/city-live.ts).';

-- 감사 — 0037의 함수를 anchors까지 담아 다시 쓴다. 나머지는 한 글자도 바꾸지 않는다.
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
      'x', old.x, 'y', old.y, 'w', old.w, 'h', old.h, 'stage_image', old.stage_image,
      'anchors', old.anchors) end,
    case when tg_op in ('INSERT', 'UPDATE') then jsonb_build_object(
      'business_id', new.business_id, 'initiative_id', new.initiative_id,
      'x', new.x, 'y', new.y, 'w', new.w, 'h', new.h, 'stage_image', new.stage_image,
      'anchors', new.anchors) end,
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

commit;
