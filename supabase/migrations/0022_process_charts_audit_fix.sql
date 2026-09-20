-- ---------------------------------------------------------------------
-- 0022. process_charts_audit()의 audit_action 매핑 수정 (전방 수정)
--
-- **무슨 일이 있었나.** 0021의 트리거가 `lower(tg_op)::audit_action`으로 감사 낱말을
-- 만들었는데, audit_action enum에는 'insert'가 없다(0001: read / create / update /
-- delete_request / approve / reject / modify / delegate / permission_change / export / login).
-- 그래서 process_charts에 행을 **처음 넣는 순간** 22P02로 터진다.
--
-- **왜 검사에서 안 걸렸나.** 0021의 시드는 user_profiles에 Chairman이 있어야 INSERT를 한다.
-- PGlite 검사와 staging에는 Chairman이 없어 시드가 일찍 빠져나갔고, 트리거가 한 번도 돌지 않았다.
-- Chairman이 있는 production에서만 처음 실행됐고 거기서 터졌다.
-- 이제 scripts/check-migrations.ts가 Chairman을 넣고 시드를 실제로 돌려 이 경로를 밟는다.
--
-- **이 마이그레이션이 필요한 이유.** production은 0021이 롤백되어 고친 0021을 그대로 받지만,
-- staging에는 0021이 이미 적용되어 **깨진 함수가 남아 있다**. 적용된 마이그레이션을 고쳐
-- 다시 적용한 척하지 않는다(OPERATIONS 9 '완료했지만 동작이 잘못됨') — 새 번호로 앞으로 고친다.
-- 0021을 갓 적용한 환경에서는 같은 정의를 한 번 더 쓰는 것이라 아무 일도 일어나지 않는다.
-- ---------------------------------------------------------------------

create or replace function process_charts_audit() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (
    -- 'delete_request'가 삭제 계열의 유일한 값이라 실제 삭제도 여기로 보낸다 —
    -- 낱말은 거칠지만 note가 '프로세스차트 링크 삭제'로 정확히 말한다.
    case tg_op
      when 'INSERT' then 'create'
      when 'UPDATE' then 'update'
      else 'delete_request'
    end::audit_action,
    'process_charts',
    coalesce(new.id, old.id)::text,
    coalesce(new.business_id, old.business_id),
    auth.uid(),
    auth_role()::text,
    case when tg_op in ('UPDATE', 'DELETE')
         then jsonb_build_object('team_name', old.team_name, 'title', old.title, 'embed_url', old.embed_url) end,
    case when tg_op in ('INSERT', 'UPDATE')
         then jsonb_build_object('team_name', new.team_name, 'title', new.title, 'embed_url', new.embed_url) end,
    case tg_op when 'DELETE' then '프로세스차트 링크 삭제' else '프로세스차트' end
  );
  return coalesce(new, old);
end;
$fn$;

comment on function process_charts_audit is
  '0022. 0021의 lower(tg_op) 매핑을 고친 것. audit_action enum에는 insert가 없다.';
