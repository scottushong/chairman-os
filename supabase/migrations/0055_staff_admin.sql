-- =====================================================================
-- Chairman OS — 0055_staff_admin (온보딩 위임 — «<회사> 사용자 관리자» · 사원 · 팀장 초대 · 자기 권한 안에서만)
-- 작성: 2026-10-06 (회장 결정 B — 김병훈(DY 경영지원 · 사원)은 사원 그대로, DY 사용자 관리자 능력을 따로 받는다)
--
-- ■ 무엇이 없어서 만드나 ■ (현황 표: docs/onboarding/staff-admin-status.md)
--   ① «사용자 관리자»라는 능력이 없다. 0026 위임 초대(user_invitations_delegated_insert)는 아무 활성 사용자에게 열려 있고
--      **상사가 초대자 subtree 안**이어야 한다 — 그러면 피초대자가 초대자 아래로 들어가 0026 in_my_subtree로 그 사람의
--      결재 · 업무 · 문서 · 감사가 초대자에게 보인다. 회장 결정: 사용자 관리는 업무 열람과 따로다.
--   ② 초대에 모듈 권한(재무 입력 · 문서 등록 · 결재 올리기)을 실을 칸이 없다. 모듈 줄 쓰기는 회장만(0002)이다.
--   ③ Executive 이상은 거부가 아니라 회장 결재 큐로 줄을 선다(0026). 회장 결정: 관리자는 사원 · 팀장만, 그 위는 거부.
--   ④ 회장에게 알림 · 아침 요약 숫자가 없다. notifications는 authenticated insert가 없고(0030), AIAgent는 초대를 못 읽는다.
--   ⑤ 위임자는 자기 초대를 취소하지 못한다(0026이 update 정책을 넓히지 않았다).
--
-- ■ 고치는 방식 ■
--   1절 능력 = user_module_access 한 줄 '/users/<business_id>' can_write. 회장만 쓴다(0002 module_access_admin_write) —
--       새 표 · 새 정책이 없다. 회수 = 줄 삭제, 감사는 화면(setModuleGrant)과 같은 permission_change.
--       판정 can_manage_users(회사) — 사람 역할(GroupCFO · BusinessCEO · Executive · TeamLead · Member) · 활성 · 그 회사 범위 · 줄.
--       **회장은 false다** — 회장은 0011 초대 폼(전 범위)을 쓴다. 이 길은 위임 전용이다.
--   2절 초대 칸 둘 — module_grants(jsonb 배열, 모듈 키) · staff_admin_business(이 길로 들어온 초대의 회사 = 꼬리표).
--       두 칸은 staff_admin_invite() 안에서만 채워진다(가드 트리거). 0026 위임 insert나 회장 insert로 권한을 싣지 못한다.
--   3절 staff_admin_invite() — definer RPC. 판정(순서대로, 오류 키는 앱이 문장으로 바꾼다):
--       능력(staff_admin_denied) · 역할 Member/TeamLead(staff_admin_role) · 이메일 · 이름 · 이미 계정 있는 이메일(staff_admin_exists)
--       · 팀 필수 + 그 회사 팀(staff_admin_team) · 상사 필수(staff_admin_boss_missing) · 상사 = 그 회사의 활성 사람
--       (staff_admin_boss_invalid) · 상사가 초대자 본인 · 초대자 아래면 거부(staff_admin_boss_self — 위 ①의 열람 누수)
--       · 등급 ≤ 초대자(staff_admin_class) · 권한 ⊆ 초대자의 쓰기 줄 ∩ {DY 재무 입력 · DY 문서 등록 · 결재 올리기}(staff_admin_grant).
--       마감(can_approve)은 실을 칸 자체가 없다 — 키 목록만 받고 가입 때 늘 can_write=true · can_approve=false로 붙인다.
--       감사 먼저(permission_change) → 초대 insert → 회장 알림(kind 'system'). 효력은 즉시(사원 · 팀장은 결재 큐 없음, 0026).
--   4절 가입 — apply_user_invitation()을 0047 본문 그대로 복사하고 «위임 초대 권한» 한 블록을 더했다. 붙이기 직전에
--       **초대자의 지금 권한으로 다시 본다**(능력 · 활성 · 그 줄의 can_write) — 하나라도 없으면 그 권한만 건너뛴다(닫힌 쪽).
--       0054 «결재 올리기» 자동 부여는 그대로 먼저 돈다(프로필 insert 트리거).
--   5절 취소 — staff_admin_revoke_invitation(): 본인이 이 길로 넣은 미수락 초대만. 회장은 예전 그대로 전부(0042 update 정책).
--   6절 고르기 — staff_admin_options(회사): 그 회사의 활성 사람(이름 · 팀 · 역할, 초대자 본인 · 아래 제외) · 팀 · 줄 수 있는 권한 ·
--       초대자 등급. 결재 · 업무 · 문서는 한 줄도 돌려주지 않는다.
--   7절 아침 숫자 — delegated_invite_count(since): 회장 · AIAgent만. 숫자 하나.
--   8절 module_grant_audit — 0048 본문 그대로, 감사 줄의 회사에 '/users/<회사>'도 읽는다.
--
-- ■ force RLS 아래에서도 돈다 (0047과 같은 가정) ■
--   user_invitations는 force RLS다(0011). staging의 postgres는 bypassrls=true(2026-10-06 조회)라 definer가 정책을 건너뛰지만
--   production이 같다고 기대지 않는다. 그래서 이 파일의 definer가 user_invitations를 만지는 세 자리(insert · 취소 update ·
--   숫자 select)는 **트랜잭션 안에서만 켜는 설정 chairman.staff_admin**('invite' · 'revoke' · 'count')으로 열리는 정책 셋을
--   따로 둔다(0042 chairman.lead_step · chairman.soft_delete와 같은 문). 설정은 함수가 켜고 같은 함수가 들어올 때 값으로 되돌린다.
--   PostgREST는 set_config를 열지 않는다(public 스키마 밖). 가입 순간의 초대 조회(apply_user_invitation)는 0047과 같다 —
--   bypassrls가 아니면 세션 없는 조회가 0행이라 가입 이행 자체가 안 되므로(0054 N4), 그 경우는 이 파일이 바꾸지 않는다.
--
-- ■ 직원 화면 용어 ■ 이 파일이 DB에 새로 적는 사용자 문구(알림 · 감사 메모)에 «회장»이 없다(0049). 오류는 키만 던진다.
--
-- ■ ECOUNT(0050~0052) · 0054와의 관계 ■ 0050~0052의 객체를 건드리지 않는다. 0054 뒤에 와야 한다(0054 트리거 · 결재 경로를 검사가 함께 잰다).
--
-- 0035 규칙: force를 새로 걸지 않는다 · 0001~0054를 고치지 않는다(apply_user_invitation · module_grant_audit는 create or replace).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 능력 — '/users/<business_id>' can_write
-- =====================================================================

/** 이 사람(p_admin)이 지금 그 회사의 «사용자 관리자»인가. 세션 없이도 부른다(가입 순간의 재확인). 회장은 false. */
create or replace function staff_admin_holds(p_admin uuid, p_business text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p_admin is not null and p_business is not null and exists (
    select 1 from user_profiles p
     where p.user_id = p_admin and p.revoked_at is null and p.status = 'active'
       and p.role::text in ('GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member')
       and (p.role::text = 'GroupCFO'
            or exists (select 1 from user_business_access a where a.user_id = p_admin and a.business_id = p_business))
  ) and exists (
    select 1 from user_module_access m
     where m.user_id = p_admin and m.module = '/users/' || p_business and m.can_write
  );
$fn$;

/** 세션 사람이 그 회사의 «사용자 관리자»인가. 화면 안내 · RPC 판정이 같이 쓴다. */
create or replace function can_manage_users(p_business text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(is_active(), false) and staff_admin_holds(auth.uid(), p_business);
$fn$;

comment on function can_manage_users(text) is
  '0055. 세션 사람이 그 회사의 «사용자 관리자»(user_module_access ''/users/<회사>'' can_write — 회장만 준다)인가. 회장은 false — 회장은 0011 초대 폼을 쓴다.';

-- =====================================================================
-- 2절. 초대 칸 둘 + 가드
-- =====================================================================
alter table user_invitations
  add column if not exists module_grants jsonb not null default '[]'::jsonb                     -- [제한]
    constraint user_invitations_module_grants_array check (jsonb_typeof(module_grants) = 'array'),
  add column if not exists staff_admin_business text references businesses(business_id);       -- [일반]

comment on column user_invitations.module_grants is
  '0055. 위임 초대(«사용자 관리자»)가 실은 모듈 키 목록(늘 can_write=true · can_approve=false로 붙는다). 가입 때 초대자의 지금 권한으로 다시 확인한다. staff_admin_invite()만 채운다.';
comment on column user_invitations.staff_admin_business is
  '0055. «사용자 관리자» 길로 들어온 초대의 회사(꼬리표). null = 회장 초대 또는 0026 위임 초대. staff_admin_invite()만 채운다.';

create or replace function staff_admin_invitation_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $fn$
begin
  -- 세션 없는 쓰기(마이그레이션 · 시드 · SQL 편집기)는 지나간다.
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if (new.module_grants is distinct from '[]'::jsonb or new.staff_admin_business is not null)
       and coalesce(current_setting('chairman.staff_admin', true), '') <> 'invite' then
      raise exception 'staff_admin_columns' using errcode = '42501';
    end if;
  elsif new.module_grants is distinct from old.module_grants
        or new.staff_admin_business is distinct from old.staff_admin_business then
    raise exception 'staff_admin_columns' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

revoke all on function staff_admin_invitation_guard() from public, anon, authenticated;

drop trigger if exists user_invitations_staff_admin_guard on user_invitations;
create trigger user_invitations_staff_admin_guard
  before insert or update on user_invitations
  for each row execute function staff_admin_invitation_guard();

-- force RLS 아래의 definer를 위한 문 셋(머리 주석). 설정은 아래 함수들만 켠다.
create policy user_invitations_staff_admin_insert on user_invitations
  as permissive for insert
  with check (
    coalesce(current_setting('chairman.staff_admin', true), '') = 'invite'
    and is_active() and invited_by = auth.uid() and staff_admin_business is not null
  );
create policy user_invitations_staff_admin_revoke on user_invitations
  as permissive for update
  using (coalesce(current_setting('chairman.staff_admin', true), '') = 'revoke'
         and is_active() and invited_by = auth.uid() and staff_admin_business is not null)
  with check (coalesce(current_setting('chairman.staff_admin', true), '') = 'revoke'
              and is_active() and invited_by = auth.uid() and staff_admin_business is not null);
create policy user_invitations_staff_admin_count on user_invitations
  as permissive for select
  using (coalesce(current_setting('chairman.staff_admin', true), '') = 'count' and staff_admin_business is not null);

-- =====================================================================
-- 3절. 초대
-- =====================================================================
create or replace function staff_admin_invite(
  p_business text,
  p_email text,
  p_display_name text,
  p_role text,
  p_team_id text,
  p_reports_to uuid,
  p_security_class text default 'Normal',
  p_module_grants text[] default '{}',
  p_display_name_en text default null,
  p_title_ko text default null,
  p_joined_on date default null,
  p_language text default 'ko'
) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  v_prev text := coalesce(current_setting('chairman.staff_admin', true), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_class security_class;
  v_grants text[];
  v_bad text;
  v_id uuid;
  v_admin_name text;
  v_biz_name text;
  v_team_name text;
  v_boss_name text;
  v_role_ko text;
  v_grant_ko text;
  c record;
begin
  if not can_manage_users(p_business) then
    raise exception 'staff_admin_denied' using errcode = '42501';
  end if;
  -- 회장 결정: 사원 · 팀장만. 그 위는 큐에 넣지 않고 거부한다(0026의 결재 큐와 다르다).
  if p_role is null or p_role not in ('Member', 'TeamLead') then
    raise exception 'staff_admin_role' using errcode = '42501';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email) > 254 then
    raise exception 'staff_admin_email' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 60 then
    raise exception 'staff_admin_name' using errcode = '22023';
  end if;
  -- 이미 계정이 있는 이메일은 받지 않는다 — 그 계정은 가입 트리거가 다시 돌지 않아 초대가 영영 대기로 남거나,
  -- 회장 승인 경로에서 남의 역할을 덮는다.
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'staff_admin_exists' using errcode = '23505';
  end if;
  if p_team_id is null or not exists (select 1 from teams t where t.team_id = p_team_id and t.business_id = p_business) then
    raise exception 'staff_admin_team' using errcode = '22023';
  end if;
  if p_reports_to is null then
    raise exception 'staff_admin_boss_missing' using errcode = '22023';
  end if;
  if not exists (
    select 1 from user_profiles b
     where b.user_id = p_reports_to and b.revoked_at is null and b.status = 'active'
       and b.role::text in ('Chairman', 'GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member')
       and (b.role::text in ('Chairman', 'GroupCFO')
            or exists (select 1 from user_business_access a where a.user_id = b.user_id and a.business_id = p_business))
  ) then
    raise exception 'staff_admin_boss_invalid' using errcode = '22023';
  end if;
  -- 상사가 초대자 본인이거나 그 아래면 피초대자가 초대자 subtree에 들어가 결재 · 업무가 초대자에게 보인다(머리 주석 ①).
  if in_my_subtree(p_reports_to) then
    raise exception 'staff_admin_boss_self' using errcode = '42501';
  end if;
  if p_security_class is null or p_security_class not in ('Normal', 'Restricted', 'Vault') then
    raise exception 'staff_admin_class' using errcode = '22023';
  end if;
  v_class := p_security_class::security_class;
  if class_rank(v_class) > class_rank(max_class()) then
    raise exception 'staff_admin_class' using errcode = '42501';
  end if;
  if coalesce(p_language, 'ko') not in ('ko', 'en') then
    raise exception 'staff_admin_language' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct g order by g), '{}') into v_grants
    from unnest(coalesce(p_module_grants, '{}')) g where g is not null;
  select g into v_bad from unnest(v_grants) g
   where g not in ('/finance/' || p_business, '/documents/' || p_business, '/chairman/decisions')
      or not exists (select 1 from user_module_access m where m.user_id = auth.uid() and m.module = g and m.can_write)
   limit 1;
  if v_bad is not null then
    raise exception 'staff_admin_grant' using errcode = '42501', detail = v_bad;
  end if;

  -- 기록이 먼저다(앱 repo의 초대 · 회수와 같은 순서). 무엇을 주기로 했는지가 통째로 남는다.
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('permission_change', 'user_invitations', v_email, p_business, auth.uid(), auth_role()::text, null,
          jsonb_build_object('email', v_email, 'role', p_role, 'max_security_class', p_security_class,
            'business_ids', jsonb_build_array(p_business), 'display_name', v_name, 'team_id', p_team_id,
            'reports_to', p_reports_to, 'module_grants', to_jsonb(v_grants), 'via', 'staff_admin'),
          '위임 초대(0055 사용자 관리자)');

  perform set_config('chairman.staff_admin', 'invite', true);
  insert into user_invitations (
    email, role, max_security_class, business_ids, display_name, display_name_en, title_ko,
    invited_by, reports_to, team_id, joined_on, language, module_grants, staff_admin_business
  ) values (
    v_email, p_role::app_role, v_class, array[p_business], v_name, nullif(btrim(coalesce(p_display_name_en, '')), ''),
    nullif(btrim(coalesce(p_title_ko, '')), ''), auth.uid(), p_reports_to, p_team_id, p_joined_on,
    coalesce(p_language, 'ko'), to_jsonb(v_grants), p_business
  ) returning invitation_id into v_id;
  perform set_config('chairman.staff_admin', v_prev, true);

  -- 회장 알림. DB 문구에 «회장»을 쓰지 않는다(0049) — 받는 사람이 회장뿐이어도 같은 규칙.
  select display_name into v_admin_name from user_profiles where user_id = auth.uid();
  select name into v_biz_name from businesses where business_id = p_business;
  select name into v_team_name from teams where team_id = p_team_id;
  select case when role::text = 'Chairman' then '대표' else display_name end into v_boss_name
    from user_profiles where user_id = p_reports_to;
  v_role_ko := case p_role when 'TeamLead' then '팀장' else '사원' end;
  select coalesce(string_agg(case
           when g = '/chairman/decisions' then '결재 올리기'
           when g like '/finance/%' then '재무 입력'
           else '문서 등록' end, ' · '), '없음')
    into v_grant_ko from unnest(v_grants) g;
  for c in select user_id from user_profiles where role::text = 'Chairman' and revoked_at is null loop
    insert into notifications (user_id, kind, title, body, link)
    values (c.user_id, 'system',
            coalesce(v_admin_name, '사용자 관리자') || '님이 ' || coalesce(v_biz_name, p_business) || '에 ' || v_name
              || '님(' || v_role_ko || ')을 초대했습니다',
            '팀 ' || coalesce(v_team_name, p_team_id) || ' · 상사 ' || coalesce(v_boss_name, '—') || ' · 권한 ' || v_grant_ko
              || '. 가입하면 바로 효력이 납니다 — 취소는 사용자 · 권한 화면에서.',
            '/settings/users');
  end loop;

  return v_id;
end;
$fn$;

comment on function staff_admin_invite(text, text, text, text, text, uuid, text, text[], text, text, date, text) is
  '0055. «사용자 관리자»의 초대. 사원 · 팀장만 · 그 회사 하나 · 팀 · 상사 필수(상사는 초대자 subtree 밖) · 등급 ≤ 초대자 · 권한 ⊆ 초대자의 쓰기 줄(재무 입력 · 문서 등록 · 결재 올리기 — 마감 없음). 감사 먼저 · 회장 알림. 효력 즉시.';

-- =====================================================================
-- 4절. 가입 — 위임 초대 권한 붙이기 + apply_user_invitation
-- =====================================================================

/**
 * 위임 초대가 실은 권한을 붙인다. 초대 행은 부르는 쪽(apply_user_invitation)이 이미 읽은 것을 받는다 —
 * user_invitations는 force RLS라 여기서 다시 읽지 않는다(0047과 같은 판단). 초대자의 **지금** 권한으로 다시 본다.
 */
create or replace function staff_admin_apply_grants(p_inv user_invitations, p_user uuid) returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  v_biz text := p_inv.staff_admin_business;
  g text;
  n int := 0;
begin
  if v_biz is null or jsonb_array_length(p_inv.module_grants) = 0 then return 0; end if;
  -- 능력이 회수됐거나 초대자가 떠났으면 하나도 붙이지 않는다(닫힌 쪽). 계정 · 회사 범위는 그대로 산다.
  if not staff_admin_holds(p_inv.invited_by, v_biz) then
    raise warning 'staff_admin_apply_grants: 초대자(%)가 지금 % 사용자 관리자가 아니다 — 권한을 붙이지 않는다', p_inv.invited_by, v_biz;
    return 0;
  end if;
  for g in select jsonb_array_elements_text(p_inv.module_grants) loop
    if g not in ('/finance/' || v_biz, '/documents/' || v_biz, '/chairman/decisions') then continue; end if;
    if not exists (select 1 from user_module_access m where m.user_id = p_inv.invited_by and m.module = g and m.can_write) then
      continue;
    end if;
    insert into user_module_access (user_id, module, can_write, can_approve)
    values (p_user, g, true, false)
    on conflict (user_id, module) do nothing;
    if found then
      n := n + 1;
      perform module_grant_audit(p_user, g, null,
        jsonb_build_object('module', g, 'can_write', true, 'can_approve', false),
        '위임 초대 권한(0055) — 초대 ' || p_inv.invitation_id::text);
    end if;
  end loop;
  return n;
exception when others then
  -- 가입을 살린다. 권한만 안 붙는다 — 회장이 사용자 화면에서 켤 수 있다.
  raise warning 'staff_admin_apply_grants 실패 (%): %', p_user, sqlerrm;
  return 0;
end;
$fn$;

revoke all on function staff_admin_apply_grants(user_invitations, uuid) from public, anon, authenticated;
revoke all on function staff_admin_holds(uuid, text) from public, anon, authenticated;

-- 가입 경로. 0047의 apply_user_invitation() 본문을 **파일에서 그대로 복사**했고, 0047 재무 기본값 블록 뒤에
-- «위임 초대 권한» 한 블록을 더한 것 말고는 한 줄도 바꾸지 않았다. grant는 여전히 없다(0026이 revoke했다) — 트리거 전용이다.
create or replace function apply_user_invitation(p_invitation uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  inv user_invitations;
  biz text;
begin
  select * into inv from user_invitations where invitation_id = p_invitation;
  if not found then return false; end if;
  if inv.accepted_at is not null or inv.revoked_at is not null then return false; end if;

  -- 회장 결재 큐. 승인 전에는 권한을 주지 않는다. 초대 행은 그대로 대기에 남는다 —
  -- 여기서 revoked_at을 채우면 승인이 난 뒤에 다시 부를 길이 없어진다.
  if inv.chairman_approval_required and inv.chairman_approved_at is null then
    return false;
  end if;

  insert into user_profiles (
    user_id, role, display_name, display_name_en, title_ko, max_security_class,
    reports_to, team_id, joined_on, language
  )
  values (
    p_user, inv.role, inv.display_name, inv.display_name_en, inv.title_ko, inv.max_security_class,
    coalesce(inv.reports_to, inv.invited_by), inv.team_id,
    coalesce(inv.joined_on, (now() at time zone 'Asia/Seoul')::date),
    inv.language
  )
  on conflict (user_id) do update
    set role               = excluded.role,
        display_name       = excluded.display_name,
        -- 영문 이름은 비어 있는 초대장이 기존 값을 지우지 않게 한다. 사람이 자기 철자를
        -- 한 번 적어 두면 재초대가 그것을 되돌리면 안 된다(reports_to·team_id와 같은 결).
        display_name_en    = coalesce(excluded.display_name_en, user_profiles.display_name_en),
        title_ko           = excluded.title_ko,
        max_security_class = excluded.max_security_class,
        -- 이미 조직도에 자리가 있는 사람이면 그 자리를 초대장이 덮지 않는다.
        -- 블록 B에서 사람이 옮겨 둔 상사를 재초대 한 번이 되돌리면 안 된다.
        reports_to         = coalesce(user_profiles.reports_to, excluded.reports_to),
        team_id            = coalesce(user_profiles.team_id, excluded.team_id),
        joined_on          = coalesce(user_profiles.joined_on, excluded.joined_on),
        language           = excluded.language,
        status             = 'active',
        revoked_at         = null;

  foreach biz in array inv.business_ids loop
    insert into user_business_access (user_id, business_id, granted_by)
    values (p_user, biz, inv.invited_by)
    on conflict (user_id, business_id) do nothing;
  end loop;

  -- 0047. 회장이 넣었거나(0026 set_approval이 칸을 채운다) 회장이 승인한 초대만. 위임 초대는 여기서 멈춘다(리뷰 C1).
  if inv.chairman_approved_at is not null then
    perform finance_default_apply(p_user);
  end if;

  -- 0055. «사용자 관리자»가 실은 권한 — 초대자의 지금 권한으로 다시 확인해 붙인다(없는 것은 건너뜀).
  if inv.staff_admin_business is not null then
    perform staff_admin_apply_grants(inv, p_user);
  end if;

  update user_invitations
     set accepted_at = now(), accepted_user_id = p_user
   where invitation_id = inv.invitation_id;

  return true;
end;
$fn$;

comment on function apply_user_invitation(uuid, uuid) is
  '0026/0028/0047/0055. 초대 한 건을 실제 권한으로 옮긴다. 결재가 필요한데 아직 안 났으면 아무것도 하지 않는다. 0028이 이름(en)·입사일·표기 언어를 같이 옮기게 했다. 0047이 회장이 넣거나 승인한 초대에 한해 DY 경영지원 팀장 기본 재무 권한을 붙인다. 0055가 «사용자 관리자» 초대의 권한을 초대자의 지금 권한으로 다시 확인해 붙인다. RPC로 열지 않는다 — 열면 결재를 건너뛰는 길이 된다.';

revoke all on function apply_user_invitation(uuid, uuid) from public;

-- =====================================================================
-- 5절. 취소 — 본인이 이 길로 넣은 미수락 초대만
-- =====================================================================
create or replace function staff_admin_revoke_invitation(p_invitation uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  v_prev text := coalesce(current_setting('chairman.staff_admin', true), '');
  inv user_invitations;
  v_now timestamptz := now();
begin
  if not coalesce(is_active(), false) then
    raise exception 'staff_admin_denied' using errcode = '42501';
  end if;
  select * into inv from user_invitations
   where invitation_id = p_invitation and invited_by = auth.uid() and staff_admin_business is not null
     and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'staff_admin_not_found' using errcode = '42501';
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('permission_change', 'user_invitations', inv.invitation_id::text, inv.staff_admin_business, auth.uid(),
          auth_role()::text, jsonb_build_object('revoked_at', null), jsonb_build_object('revoked_at', v_now),
          '위임 초대 취소(0055 사용자 관리자)');
  perform set_config('chairman.staff_admin', 'revoke', true);
  update user_invitations set revoked_at = v_now
   where invitation_id = inv.invitation_id and accepted_at is null and revoked_at is null;
  perform set_config('chairman.staff_admin', v_prev, true);
  return true;
end;
$fn$;

comment on function staff_admin_revoke_invitation(uuid) is
  '0055. «사용자 관리자»가 자기가 넣은 미수락 위임 초대를 취소한다. 능력이 회수된 뒤에도 자기 초대 취소는 된다(권한을 줄이는 쪽). 회장은 0042 update 정책으로 전부.';

-- =====================================================================
-- 6절. 고르기 — 사람 · 팀 · 줄 수 있는 권한 · 등급
-- =====================================================================
create or replace function staff_admin_options(p_business text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_people jsonb;
  v_teams jsonb;
  v_grants jsonb;
begin
  if not can_manage_users(p_business) then
    raise exception 'staff_admin_denied' using errcode = '42501';
  end if;
  -- 상사 후보: 그 회사의 활성 사람(전사 역할 포함), 초대자 본인 · 그 아래는 뺀다(staff_admin_invite가 거부하는 자리).
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'display_name', p.display_name,
           'team_id', p.team_id, 'role', p.role) order by p.display_name, p.user_id), '[]'::jsonb)
    into v_people
    from user_profiles p
   where p.revoked_at is null and p.status = 'active'
     and p.role::text in ('Chairman', 'GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member')
     and (p.role::text in ('Chairman', 'GroupCFO')
          or exists (select 1 from user_business_access a where a.user_id = p.user_id and a.business_id = p_business))
     and not in_my_subtree(p.user_id);
  select coalesce(jsonb_agg(jsonb_build_object('team_id', t.team_id, 'name', t.name) order by t.name, t.team_id), '[]'::jsonb)
    into v_teams from teams t where t.business_id = p_business;
  select coalesce(jsonb_agg(m.module order by m.module), '[]'::jsonb) into v_grants
    from user_module_access m
   where m.user_id = auth.uid() and m.can_write
     and m.module in ('/finance/' || p_business, '/documents/' || p_business, '/chairman/decisions');
  return jsonb_build_object('people', v_people, 'teams', v_teams, 'grantable', v_grants, 'max_class', max_class()::text);
end;
$fn$;

comment on function staff_admin_options(text) is
  '0055. «사용자 관리자» 초대 폼의 고르기 칸. 이름 · 팀 · 역할만 — 결재 · 업무 · 문서는 돌려주지 않는다.';

-- =====================================================================
-- 7절. 아침 숫자
-- =====================================================================
create or replace function delegated_invite_count(p_since timestamptz) returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  v_prev text := coalesce(current_setting('chairman.staff_admin', true), '');
  n int;
begin
  if not (coalesce(is_active(), false) and auth_role()::text in ('Chairman', 'AIAgent')) then
    raise exception 'staff_admin_denied' using errcode = '42501';
  end if;
  perform set_config('chairman.staff_admin', 'count', true);
  select count(*)::int into n from user_invitations
   where staff_admin_business is not null and invited_at >= p_since;
  perform set_config('chairman.staff_admin', v_prev, true);
  return n;
end;
$fn$;

comment on function delegated_invite_count(timestamptz) is
  '0055. p_since 이후 «사용자 관리자» 초대 수. 회장 · AIAgent만. 숫자 하나 — 이름 · 이메일은 돌려주지 않는다.';

-- =====================================================================
-- 8절. 감사 줄의 회사 — '/users/<biz>'도 회사로 읽는다
--   0048 3절의 module_grant_audit() 본문 그대로이고, business_id 식만 users를 더했다.
-- =====================================================================
create or replace function module_grant_audit(p_user uuid, p_module text, p_before jsonb, p_after jsonb, p_note text)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('permission_change', 'user_module_access', p_user::text,
          substring(p_module from '^/(?:finance|documents|users)/([a-z0-9_]+)$'),
          auth.uid(), auth_role()::text, p_before, p_after, p_note);
exception when others then
  raise warning 'module_grant_audit 실패 (%, %): %', p_user, p_module, sqlerrm;
end;
$fn$;

revoke all on function module_grant_audit(uuid, text, jsonb, jsonb, text) from public, anon, authenticated;

-- RPC 다섯은 로그인한 사람만. 판정은 각 함수 안에서 한다.
revoke all on function can_manage_users(text) from public, anon;
revoke all on function staff_admin_invite(text, text, text, text, text, uuid, text, text[], text, text, date, text) from public, anon;
revoke all on function staff_admin_revoke_invitation(uuid) from public, anon;
revoke all on function staff_admin_options(text) from public, anon;
revoke all on function delegated_invite_count(timestamptz) from public, anon;
grant execute on function can_manage_users(text) to authenticated;
grant execute on function staff_admin_invite(text, text, text, text, text, uuid, text, text[], text, text, date, text) to authenticated;
grant execute on function staff_admin_revoke_invitation(uuid) to authenticated;
grant execute on function staff_admin_options(text) to authenticated;
grant execute on function delegated_invite_count(timestamptz) to authenticated;

commit;
