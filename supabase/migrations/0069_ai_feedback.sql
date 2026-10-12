-- =====================================================================
-- Chairman OS — 0069_ai_feedback (AI 어시스턴트 보강 — 권한 · 조직 조회 · «시스템 보완 의견» · 대표 «시스템 보완함»)
-- 작성: 2026-10-12 (회장 블록 지시 «AI 어시스턴트 보강»)
--
-- ■ 무엇이 없어서 만드나 ■
--   ① 2026-10-12 실사용: 대표가 «김병훈 사원의 권한은?»을 물었더니 «이름과 id만 조회되고 권한은 볼 수 없습니다»로 끝났다.
--      조직 도구(org_lookup)가 이름 · id만 돌려주고, 사람의 모듈 권한(user_module_access)은 0002 module_access_self_read로
--      본인 · 대표만 읽는다 — 회사 «사용자 관리자»(0055)는 자기가 맡은 회사 사람의 권한을 볼 길이 없다.
--   ② 답이 부족했을 때 사용자가 그 자리에서 남길 곳이 없다 — 대표가 모아서 개발 세션에 넘길 목록도 없다.
--
-- ■ 1절 권한 · 조직 조회 — org_access_lookup(query) ■ 읽기만. definer · to authenticated.
--   누가 누구를 보나(회장 결정 2):
--     대표(Chairman)                       전원.
--     회사 «사용자 관리자»(0055 can_manage_users) 그 회사 범위의 사원 · 팀장(0055가 다루는 역할) + 본인.
--     그 밖                                본인만.
--   돌려주는 칸: 이름 · 직함 · 역할 · 상태 · 팀 · 직속 상사(이름 · 역할) · 회사 범위 · 모듈 권한 줄.
--   **원가 4종('/purchasing' · '/production' · '/sales' · '/costing')은 대표 세션에만 싣는다** — 그 밖은 줄을 빼고
--   cost_hidden=true만 준다(본인 것도). BOM · 원가 숫자는 이 함수 어디에도 없다(권한 줄 이름뿐).
--   쓰기 없음 — 바꾸기는 사용자 화면(/settings/users)에서 대표가 한다.
--
-- ■ 2절 보완 의견 — ai_feedback ■
--   답마다 접힌 칸에서 쓴다. 함께 적는 것: 쓴 사람 · 회사 · 화면 경로 · 질문 · 답(원문) · 시각.
--   질문 · 답은 **앱이 보내지 않는다** — ai_feedback_submit(message_id)가 그 사람 본인의 대화(ai_chat_messages, 0041 본인만)에서
--   그 답과 바로 앞 질문을 읽어 복사한다. 남의 답 · 지어낸 답을 붙일 길이 없다.
--   읽기: 쓴 사람은 자기 것만(ai_feedback_mine() — 상태 · AI 정리 · «AI 정리 제외» 표시는 싣지 않는다), 대표는 표 전부,
--   AIAgent(밤 묶음 정리)는 «AI 정리 제외»가 아니고 취소되지 않은 줄만.
--   수정 · 삭제 없음(grant 없음). 취소는 표시만(ai_feedback_cancel — 쓴 사람 본인). 모든 쓰기는 audit_log 한 줄.
--
-- ■ 민감 차단(«AI 정리 제외») ■
--   의견 · 질문 · 답에 배합비(lib/intake/mix-ratio.ts) · Vault 등급 · 원가 엔진 숫자가 보이면 저장은 하되 ai_excluded=true.
--   세 겹: ⓐ 서버 액션이 mix-ratio 감지 + 낱말 규칙으로 판정해 넘기고 ⓑ 이 파일의 ai_feedback_sensitive()가 SQL 낱말 규칙으로
--   한 번 더 켠다(직접 RPC로 false를 넘겨도 꺼지지 않는다 — 켜기만) ⓒ AI 정리 코드가 보내기 직전에 다시 잰다.
--   AI 정리 결과 저장(ai_feedback_save_triage · ai_feedback_save_bundle)은 제외 · 취소 줄을 거부한다.
--
-- ■ 3절 시스템 보완함 ■ 대표만: 상태(새것 · AI 정리됨 · 지시문 복사함 · 반영됨 · 보류) 바꾸기 · AI 정리 저장 · 묶음.
--   AI 정리(요약 · 기대 결과 · Claude Code 지시문)는 대표의 버튼(대표 세션) 또는 밤 묶음(AIAgent 세션)이 저장한다.
--   지시문은 글일 뿐이다 — 이 DB · 앱 어디에도 지시문을 실행하거나 저장소를 바꾸는 길이 없다(대표가 복사해 직접 붙인다).
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0068을 고치지 않는다. 새 정책은 늘 to authenticated(0060 교훈).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 권한 · 조직 조회(읽기만)
-- =====================================================================

/** 원가 엔진 네 영역의 권한 줄인가(0061). 대표 세션 밖에서는 이 줄을 싣지 않는다. */
create or replace function org_access_is_cost_module(p_module text) returns boolean
language sql immutable set search_path = public, pg_temp as $fn$
  select p_module ~ '^/(purchasing|production|sales|costing)(/|$)';
$fn$;

/** 세션 사람이 그 사람(p_target)의 권한 · 조직 칸을 볼 수 있나 — 대표 전원 · 본인 · 사용자 관리자는 맡은 회사의 사원 · 팀장. */
create or replace function org_access_can_view(p_target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(is_active(), false) and p_target is not null and (
    auth_role()::text = 'Chairman'
    or p_target = auth.uid()
    or exists (
      select 1
        from user_profiles t
        join user_business_access a on a.user_id = t.user_id
       where t.user_id = p_target
         and t.role::text in ('TeamLead', 'Member')
         and staff_admin_holds(auth.uid(), a.business_id)
    )
  );
$fn$;

/**
 * 이름 · 팀 이름 · 'me' · uuid로 찾는다. 보이는 사람만, 많아야 8명. 사람마다 jsonb 한 덩이.
 * 대표가 아니면 원가 4종 줄을 빼고 cost_hidden=true. 상사가 대표면 이름 대신 역할만(«대표»는 앱이 붙인다).
 */
create or replace function org_access_lookup(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_me    uuid := auth.uid();
  v_chair boolean := coalesce(is_active(), false) and auth_role()::text = 'Chairman';
  v_q     text := btrim(coalesce(p_query, ''));
  v_uuid  uuid;
  v_out   jsonb;
begin
  if not coalesce(is_active(), false) or v_me is null then
    raise exception 'org_access_denied' using errcode = '42501';
  end if;
  if length(v_q) = 0 or length(v_q) > 60 then
    return '[]'::jsonb;
  end if;
  if v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := v_q::uuid;
  elsif lower(v_q) in ('me', '나', '내', '본인', '저') then
    v_uuid := v_me;
  end if;

  with hits as (
    select p.*
      from user_profiles p
      left join teams tm on tm.team_id = p.team_id
     where org_access_can_view(p.user_id)
       and (
         (v_uuid is not null and p.user_id = v_uuid)
         or (v_uuid is null and (
              replace(p.display_name, ' ', '') ilike '%' || replace(v_q, ' ', '') || '%'
              or coalesce(replace(p.display_name_en, ' ', ''), '') ilike '%' || replace(v_q, ' ', '') || '%'
              or replace(coalesce(tm.name, ''), ' ', '') = replace(regexp_replace(v_q, '\s*팀$', ''), ' ', '')
              or (tm.name is not null and replace(tm.name, ' ', '') || '팀' = replace(v_q, ' ', ''))))
       )
     order by (p.user_id = v_me) desc, p.revoked_at nulls first, p.display_name
     limit 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', h.user_id,
           'name', h.display_name,
           'title', h.title_ko,
           'role', h.role::text,
           'status', h.status::text,
           'revoked', h.revoked_at is not null,
           'self', h.user_id = v_me,
           'max_security_class', case when v_chair or h.user_id = v_me then h.max_security_class::text end,
           'team', (select jsonb_build_object('team_id', t.team_id, 'name', t.name, 'business_id', t.business_id)
                      from teams t where t.team_id = h.team_id),
           'reports_to', (select jsonb_build_object('user_id', b.user_id, 'name', b.display_name, 'role', b.role::text, 'title', b.title_ko)
                            from user_profiles b where b.user_id = h.reports_to),
           'businesses', case when h.role::text in ('Chairman', 'GroupCFO') then '["*"]'::jsonb
                              else coalesce((select jsonb_agg(a.business_id order by a.business_id)
                                               from user_business_access a where a.user_id = h.user_id), '[]'::jsonb) end,
           'modules', coalesce((select jsonb_agg(jsonb_build_object('module', m.module, 'can_write', m.can_write, 'can_approve', m.can_approve)
                                                 order by m.module)
                                  from user_module_access m
                                 where m.user_id = h.user_id
                                   and (v_chair or not org_access_is_cost_module(m.module))), '[]'::jsonb),
           'cost_hidden', not v_chair
         )), '[]'::jsonb)
    into v_out
    from hits h;
  return v_out;
end;
$fn$;

comment on function org_access_lookup(text) is
  '0069. AI 어시스턴트 권한 · 조직 조회(읽기만). 대표 전원 · 본인 · 사용자 관리자(0055)는 맡은 회사의 사원 · 팀장. 원가 4종 줄은 대표 세션에만.';

revoke all on function org_access_is_cost_module(text) from public, anon;
revoke all on function org_access_can_view(uuid) from public, anon;
revoke all on function org_access_lookup(text) from public, anon;
grant execute on function org_access_is_cost_module(text) to authenticated;
grant execute on function org_access_can_view(uuid) to authenticated;
grant execute on function org_access_lookup(text) to authenticated;

-- =====================================================================
-- 2절. 보완 의견 — 표 둘
-- =====================================================================
create table ai_feedback_bundles (
  bundle_id    uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid not null default auth.uid(),                       -- [제한] 대표 또는 AIAgent(밤 묶음)
  title        text not null check (length(title) between 1 and 120),  -- [일반]
  screen       text not null check (screen ~ '^/' and length(screen) <= 300),  -- [일반]
  feedback_ids uuid[] not null check (cardinality(feedback_ids) between 2 and 30),  -- [일반]
  triage       jsonb not null check (jsonb_typeof(triage) = 'object'),  -- [제한] {summary, expected, instruction, model}
  status       text not null default 'new' check (status in ('new', 'copied', 'applied', 'held'))
);

create table ai_feedback (
  feedback_id      uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),                   -- [일반]
  author_id        uuid not null default auth.uid() references auth.users(id),  -- [제한]
  author_name      text not null,                                        -- [제한] 쓴 때의 이름(뒤에 바뀌어도 기록은 남는다)
  author_role      text not null,                                        -- [제한]
  business_id      text references businesses(business_id),              -- [일반] 쓴 화면의 회사(없으면 null)
  path             text not null check (path ~ '^/' and path !~ '^//' and length(path) <= 300),  -- [일반]
  message_id       bigint not null,                                      -- [일반] ai_chat_messages.id(대화가 지워져도 이 줄은 남는다)
  question         text not null check (length(question) <= 2000),       -- [제한] 원문
  answer           text not null check (length(answer) between 1 and 8000),  -- [제한] 원문
  body             text not null check (length(btrim(body)) between 2 and 2000),  -- [제한]
  ai_excluded      boolean not null default false,                       -- [제한] «AI 정리 제외» — 대표에게만 보인다
  excluded_reasons text[] not null default '{}',                         -- [제한] mix_ratio · vault · cost_number
  cancelled_at     timestamptz,                                          -- [일반] 취소 표시(삭제 아님)
  status           text not null default 'new'
                   check (status in ('new', 'triaged', 'copied', 'applied', 'held')),  -- [일반]
  triage           jsonb check (triage is null or jsonb_typeof(triage) = 'object'),  -- [제한] {summary, expected, instruction, model, by}
  triaged_at       timestamptz,
  bundle_id        uuid references ai_feedback_bundles(bundle_id),
  updated_at       timestamptz not null default now(),
  constraint ai_feedback_one_per_answer unique (author_id, message_id)
);

create index ai_feedback_by_created on ai_feedback (created_at desc);
create index ai_feedback_by_status on ai_feedback (status, created_at desc);

comment on table ai_feedback is
  '0069. AI 어시스턴트 답마다의 «시스템 보완 의견». 쓴 사람은 ai_feedback_mine()으로 자기 것만, 대표는 전부, AIAgent는 AI 정리 제외 · 취소가 아닌 줄만. 수정 · 삭제 없음.';
comment on table ai_feedback_bundles is '0069. 비슷한 의견(같은 화면 · 같은 문제) 묶음과 «묶음 지시문». 대표만 읽는다.';

alter table ai_feedback enable row level security;
alter table ai_feedback_bundles enable row level security;

revoke all on table ai_feedback, ai_feedback_bundles from public, anon, authenticated;
grant select on table ai_feedback, ai_feedback_bundles to authenticated;

create policy ai_feedback_chairman_read on ai_feedback for select to authenticated
  using (coalesce(is_active(), false) and auth_role()::text = 'Chairman');
create policy ai_feedback_agent_read on ai_feedback for select to authenticated
  using (coalesce(is_active(), false) and auth_role()::text = 'AIAgent' and not ai_excluded and cancelled_at is null);
create policy ai_feedback_bundles_chairman_read on ai_feedback_bundles for select to authenticated
  using (coalesce(is_active(), false) and auth_role()::text = 'Chairman');

/**
 * SQL 쪽 민감 낱말(둘째 겹). 앱의 감지(mix-ratio · 낱말)보다 거칠다 — 켜기만 한다. 돌려주는 것: 걸린 이유 목록.
 *   mix_ratio   배합 · 처방 · 레시피 · formula · BOM · 투입 비율 · w/w · wt% · phr
 *   vault       Vault · 금고 등급
 *   cost_number 원가 · 단가 · 시장가 · 시세 · 구매가 · 마진 · 원/kg 낱말과 숫자가 함께
 */
create or replace function ai_feedback_sensitive(p_text text) returns text[]
language sql immutable set search_path = public, pg_temp as $fn$
  select array_remove(array[
    case when p_text ~* '(배합|처방|레시피|recipe|formula|\mbom\M|투입\s*비율?|함량비|w/w|wt\s*%|\mphr\M)' then 'mix_ratio' end,
    case when p_text ~* '(\mvault\M|금고\s*등급|\[금고\])' then 'vault' end,
    case when p_text ~* '(원가|단가|시장가|시세|구매가|매입가|마진|원\s*/\s*kg)' and p_text ~ '[0-9]' then 'cost_number' end
  ], null);
$fn$;

/** 쓰기 · 감사 한 줄. 이 파일의 RPC만 부른다. */
create or replace function ai_feedback_audit(p_action audit_action, p_id uuid, p_biz text, p_before jsonb, p_after jsonb, p_note text)
returns void
language sql security definer set search_path = public, pg_temp as $fn$
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (p_action, 'ai_feedback', p_id::text, p_biz, auth.uid(), auth_role()::text, p_before, p_after, p_note);
$fn$;

/**
 * 의견 남기기. 질문 · 답은 세션 사람 본인의 대화에서 복사한다(앱이 보내지 않는다).
 * p_excluded · p_reasons는 앱의 판정(mix-ratio 포함) — SQL 낱말 규칙이 더 켤 수는 있어도 끌 수는 없다.
 * 하루 30건(쓴 사람당). 같은 답에 한 번(두 번째는 ai_feedback_duplicate).
 */
create or replace function ai_feedback_submit(
  p_message_id bigint, p_body text, p_path text, p_business text, p_excluded boolean, p_reasons text[]
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_me      uuid := auth.uid();
  v_role    text := auth_role()::text;
  v_msg     ai_chat_messages;
  v_q       text;
  v_body    text := btrim(coalesce(p_body, ''));
  v_biz     text;
  v_reasons text[];
  v_name    text;
  v_id      uuid;
begin
  if not coalesce(is_active(), false) or v_me is null
     or v_role not in ('Chairman', 'GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member') then
    raise exception 'ai_feedback_denied' using errcode = '42501';
  end if;
  if length(v_body) < 2 or length(v_body) > 2000 then
    raise exception 'ai_feedback_body' using errcode = '22023';
  end if;
  if p_path is null or p_path !~ '^/' or p_path ~ '^//' or length(p_path) > 300 then
    raise exception 'ai_feedback_path' using errcode = '22023';
  end if;
  select m.* into v_msg
    from ai_chat_messages m join ai_chats c on c.chat_id = m.chat_id
   where m.id = p_message_id and m.role = 'assistant' and m.user_id = v_me and c.user_id = v_me;
  if v_msg.id is null then
    raise exception 'ai_feedback_message' using errcode = '42501';
  end if;
  if exists (select 1 from ai_feedback f where f.author_id = v_me and f.message_id = p_message_id) then
    raise exception 'ai_feedback_duplicate' using errcode = '23505';
  end if;
  if (select count(*) from ai_feedback f where f.author_id = v_me and f.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'ai_feedback_rate' using errcode = '54000';
  end if;
  select m.content into v_q
    from ai_chat_messages m
   where m.chat_id = v_msg.chat_id and m.role = 'user' and m.id < v_msg.id
   order by m.id desc limit 1;
  v_q := left(coalesce(v_q, ''), 2000);
  -- 회사: 화면이 가리킨 회사가 세션 사람의 범위 안일 때만(아니면 null — 남의 회사 이름을 붙일 길이 아니다).
  v_biz := case when p_business is not null and coalesce(has_business(p_business), false) then p_business end;
  v_reasons := array(
    select distinct r from unnest(
      coalesce(p_reasons, '{}'::text[])
      || ai_feedback_sensitive(v_body) || ai_feedback_sensitive(v_q) || ai_feedback_sensitive(v_msg.content)
    ) r where r in ('mix_ratio', 'vault', 'cost_number') order by r
  );
  select p.display_name into v_name from user_profiles p where p.user_id = v_me;

  insert into ai_feedback (author_id, author_name, author_role, business_id, path, message_id, question, answer, body,
                           ai_excluded, excluded_reasons)
  values (v_me, coalesce(v_name, ''), v_role, v_biz, p_path, p_message_id, v_q, v_msg.content, v_body,
          coalesce(p_excluded, false) or cardinality(v_reasons) > 0, v_reasons)
  returning feedback_id into v_id;

  -- 감사에는 본문을 싣지 않는다(본문은 이 표에 있고 대표만 읽는다) — 길이 · 화면 · 제외 여부만.
  perform ai_feedback_audit('create', v_id, v_biz, null,
    jsonb_build_object('path', p_path, 'message_id', p_message_id, 'body_length', length(v_body),
                       'ai_excluded', coalesce(p_excluded, false) or cardinality(v_reasons) > 0),
    'AI 보완 의견 남김(0069)');
  return v_id;
end;
$fn$;

/** 쓴 사람이 자기 의견을 본다 — 질문 · 답 · 의견 · 화면 · 시각 · 취소만(상태 · AI 정리 · 제외 표시는 싣지 않는다). */
create or replace function ai_feedback_mine() returns table (
  feedback_id uuid, created_at timestamptz, path text, message_id bigint, question text, answer text, body text, cancelled_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select f.feedback_id, f.created_at, f.path, f.message_id, f.question, f.answer, f.body, f.cancelled_at
    from ai_feedback f
   where coalesce(is_active(), false) and f.author_id = auth.uid()
   order by f.created_at desc
   limit 200;
$fn$;

/** 취소 표시 — 쓴 사람 본인만, 한 번. 줄은 남는다. */
create or replace function ai_feedback_cancel(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_row ai_feedback;
begin
  if not coalesce(is_active(), false) then
    raise exception 'ai_feedback_denied' using errcode = '42501';
  end if;
  update ai_feedback set cancelled_at = now(), updated_at = now()
   where feedback_id = p_id and author_id = auth.uid() and cancelled_at is null
  returning * into v_row;
  if v_row.feedback_id is null then
    return false;
  end if;
  perform ai_feedback_audit('update', p_id, v_row.business_id, jsonb_build_object('cancelled_at', null),
    jsonb_build_object('cancelled_at', v_row.cancelled_at), 'AI 보완 의견 취소(0069)');
  return true;
end;
$fn$;

-- =====================================================================
-- 3절. 시스템 보완함 — 대표(상태 · AI 정리 · 묶음), AIAgent(밤 묶음 정리)
-- =====================================================================

/** 상태 바꾸기 — 대표만. 'new'로 되돌리기도 된다(지시문을 다시 볼 때). */
create or replace function ai_feedback_set_status(p_id uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_before text;
  v_biz    text;
begin
  if not (coalesce(is_active(), false) and auth_role()::text = 'Chairman') then
    raise exception 'ai_feedback_denied' using errcode = '42501';
  end if;
  if p_status not in ('new', 'triaged', 'copied', 'applied', 'held') then
    raise exception 'ai_feedback_status' using errcode = '22023';
  end if;
  select status, business_id into v_before, v_biz from ai_feedback where feedback_id = p_id for update;
  if v_before is null then
    return false;
  end if;
  if v_before = p_status then
    return true;
  end if;
  update ai_feedback set status = p_status, updated_at = now() where feedback_id = p_id;
  perform ai_feedback_audit('update', p_id, v_biz, jsonb_build_object('status', v_before),
    jsonb_build_object('status', p_status), 'AI 보완 의견 상태(0069)');
  return true;
end;
$fn$;

/** 묶음 상태 — 대표만. 묶음의 «지시문 복사함 · 반영됨 · 보류»는 묶인 의견에도 같이 적는다. */
create or replace function ai_feedback_bundle_set_status(p_bundle uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_before text;
  v_ids    uuid[];
begin
  if not (coalesce(is_active(), false) and auth_role()::text = 'Chairman') then
    raise exception 'ai_feedback_denied' using errcode = '42501';
  end if;
  if p_status not in ('new', 'copied', 'applied', 'held') then
    raise exception 'ai_feedback_status' using errcode = '22023';
  end if;
  select status, feedback_ids into v_before, v_ids from ai_feedback_bundles where bundle_id = p_bundle for update;
  if v_before is null then
    return false;
  end if;
  update ai_feedback_bundles set status = p_status where bundle_id = p_bundle;
  if p_status <> 'new' then
    update ai_feedback set status = p_status, updated_at = now() where feedback_id = any (v_ids) and bundle_id = p_bundle;
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'ai_feedback_bundles', p_bundle::text, null, auth.uid(), auth_role()::text,
          jsonb_build_object('status', v_before), jsonb_build_object('status', p_status), 'AI 보완 묶음 상태(0069)');
  return true;
end;
$fn$;

/** triage jsonb의 모양 — summary · expected · instruction 글(각 상한) + model. */
create or replace function ai_feedback_triage_ok(p jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $fn$
  select jsonb_typeof(p) = 'object'
     and jsonb_typeof(p -> 'summary') = 'string' and length(p ->> 'summary') between 1 and 1500
     and jsonb_typeof(p -> 'expected') = 'string' and length(p ->> 'expected') between 1 and 1500
     and jsonb_typeof(p -> 'instruction') = 'string' and length(p ->> 'instruction') between 1 and 12000
     and jsonb_typeof(p -> 'model') = 'string';
$fn$;

/** AI 정리 저장 — 대표(버튼) 또는 AIAgent(밤). «AI 정리 제외» · 취소 줄은 거부. 상태가 'new'면 'triaged'로. */
create or replace function ai_feedback_save_triage(p_id uuid, p_triage jsonb) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_row ai_feedback;
begin
  if not (coalesce(is_active(), false) and auth_role()::text in ('Chairman', 'AIAgent')) then
    raise exception 'ai_feedback_denied' using errcode = '42501';
  end if;
  if not ai_feedback_triage_ok(p_triage) then
    raise exception 'ai_feedback_triage_shape' using errcode = '22023';
  end if;
  select * into v_row from ai_feedback where feedback_id = p_id for update;
  if v_row.feedback_id is null then
    return false;
  end if;
  if v_row.ai_excluded or v_row.cancelled_at is not null then
    raise exception 'ai_feedback_excluded' using errcode = '42501';
  end if;
  -- 지시문에도 민감 낱말이 생기면 저장하지 않는다(AI가 원가 숫자를 지어 넣는 길도 닫는다).
  if cardinality(ai_feedback_sensitive(p_triage::text)) > 0 then
    raise exception 'ai_feedback_triage_sensitive' using errcode = '22023';
  end if;
  update ai_feedback
     set triage = p_triage || jsonb_build_object('by', auth_role()::text),
         triaged_at = now(),
         status = case when status = 'new' then 'triaged' else status end,
         updated_at = now()
   where feedback_id = p_id;
  perform ai_feedback_audit('update', p_id, v_row.business_id, jsonb_build_object('status', v_row.status),
    jsonb_build_object('triaged', true, 'model', p_triage ->> 'model'), 'AI 보완 의견 AI 정리(0069)');
  return true;
end;
$fn$;

/** 묶음 저장 — 대표 또는 AIAgent. 둘 이상 · 전부 제외 아님 · 취소 아님 · 같은 화면. 묶인 의견에 bundle_id를 적는다. */
create or replace function ai_feedback_save_bundle(p_ids uuid[], p_title text, p_triage jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_ids    uuid[] := array(select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) x);
  v_n      int;
  v_paths  int;
  v_screen text;
  v_id     uuid;
begin
  if not (coalesce(is_active(), false) and auth_role()::text in ('Chairman', 'AIAgent')) then
    raise exception 'ai_feedback_denied' using errcode = '42501';
  end if;
  if cardinality(v_ids) < 2 or cardinality(v_ids) > 30 then
    raise exception 'ai_feedback_bundle_size' using errcode = '22023';
  end if;
  if not ai_feedback_triage_ok(p_triage) or length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'ai_feedback_triage_shape' using errcode = '22023';
  end if;
  if cardinality(ai_feedback_sensitive(p_triage::text || ' ' || p_title)) > 0 then
    raise exception 'ai_feedback_triage_sensitive' using errcode = '22023';
  end if;
  select count(*), count(distinct split_part(path, '?', 1)), min(split_part(path, '?', 1))
    into v_n, v_paths, v_screen
    from ai_feedback
   where feedback_id = any (v_ids) and not ai_excluded and cancelled_at is null;
  if v_n <> cardinality(v_ids) then
    raise exception 'ai_feedback_excluded' using errcode = '42501';
  end if;
  if v_paths <> 1 then
    raise exception 'ai_feedback_bundle_screen' using errcode = '22023';
  end if;
  insert into ai_feedback_bundles (title, screen, feedback_ids, triage)
  values (btrim(p_title), v_screen, v_ids, p_triage || jsonb_build_object('by', auth_role()::text))
  returning bundle_id into v_id;
  update ai_feedback set bundle_id = v_id, updated_at = now() where feedback_id = any (v_ids);
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('create', 'ai_feedback_bundles', v_id::text, null, auth.uid(), auth_role()::text, null,
          jsonb_build_object('feedback_ids', to_jsonb(v_ids), 'screen', v_screen), 'AI 보완 의견 묶음(0069)');
  return v_id;
end;
$fn$;

revoke all on function ai_feedback_sensitive(text) from public, anon;
revoke all on function ai_feedback_audit(audit_action, uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function ai_feedback_submit(bigint, text, text, text, boolean, text[]) from public, anon;
revoke all on function ai_feedback_mine() from public, anon;
revoke all on function ai_feedback_cancel(uuid) from public, anon;
revoke all on function ai_feedback_set_status(uuid, text) from public, anon;
revoke all on function ai_feedback_bundle_set_status(uuid, text) from public, anon;
revoke all on function ai_feedback_triage_ok(jsonb) from public, anon;
revoke all on function ai_feedback_save_triage(uuid, jsonb) from public, anon;
revoke all on function ai_feedback_save_bundle(uuid[], text, jsonb) from public, anon;

grant execute on function ai_feedback_sensitive(text) to authenticated;
grant execute on function ai_feedback_submit(bigint, text, text, text, boolean, text[]) to authenticated;
grant execute on function ai_feedback_mine() to authenticated;
grant execute on function ai_feedback_cancel(uuid) to authenticated;
grant execute on function ai_feedback_set_status(uuid, text) to authenticated;
grant execute on function ai_feedback_bundle_set_status(uuid, text) to authenticated;
grant execute on function ai_feedback_triage_ok(jsonb) to authenticated;
grant execute on function ai_feedback_save_triage(uuid, jsonb) to authenticated;
grant execute on function ai_feedback_save_bundle(uuid[], text, jsonb) to authenticated;

commit;
