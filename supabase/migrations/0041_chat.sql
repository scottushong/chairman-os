-- ---------------------------------------------------------------------
-- 0041. 사내 메신저 · AI 대화 (Phase 9 블록 6)
--
-- 회장 지시 원문: "자체 메신저: Supabase Realtime. 채널 = 회사 전체 / 팀 / 1:1. RLS subtree 규칙 그대로
-- (팀 채널은 팀원+팀장+상위). 텍스트·링크·문서 첨부(documents 참조). 읽음 표시."
-- "AI 채팅: 사용자 권한 범위 안의 데이터만 컨텍스트로. 대화는 저장(ai_chats, 본인만), 회장은 자기 것만.
-- audit_log에 질문 요약."
--
-- ■ 채널이 누구에게 열리는가 — can_read_channel() 하나가 판정한다 ■
--   company  그 회사 사람(has_business). 회사 공지방과 같은 범위다.
--   team     팀원 · 팀장 · **상위**. «상위»는 새 규칙이 아니라 0025 in_my_subtree()다 — 팀원 가운데
--            한 사람이라도 내 subtree에 있으면 나는 그 팀의 위다. 회사 격리(has_business)는 먼저 본다.
--            다른 팀은 안 보인다(원문 검증 «다른 팀 안 보임»).
--   dm       두 사람만. 회장도 남의 1:1은 못 본다 — subtree가 1:1을 넘지 않는다.
--
-- ■ 메시지는 지우거나 고치지 않는다 ■ 대화는 기록이다(append-only). 잘못 보낸 것은 다시 보낸다.
-- ■ 문서 첨부는 참조만 ■ document_id를 건다. 받는 사람이 그 문서를 못 보면 제목도 안 보인다 —
--   화면이 documents를 RLS로 다시 읽기 때문이다. 보내는 사람은 **자기가 보는 문서만** 걸 수 있다.
-- ■ 읽음 ■ chat_reads에 채널별 «어디까지 읽었나» 한 줄. 같은 채널 사람은 서로의 줄을 본다(1:1의 «읽음»).
--
-- ■ AI 대화 ■ ai_chats · ai_chat_messages. 본인만 읽고 쓴다 — 회장도 남의 대화는 못 본다(원문).
--   사용자 질문이 들어갈 때 트리거가 audit_log에 «질문 요약»(앞 80자)을 남긴다. 답변은 남기지 않는다.
--   그 줄은 **본인과 회장만** 읽는다(audit_log_ai_chats_private) — 0031의 subtree 읽기가 그대로면
--   팀장 · 임원이 부하 직원의 질문을 읽게 된다.
--   AI에게 무엇을 보여 주는지는 이 표가 아니라 앱이 정한다: 질문한 사람의 세션으로 읽은 것(RLS)만.
--
-- 0035 규칙: force 새로 걸지 않는다 · revoke로 잠근다 · 0001~0040 안 고친다.
-- Realtime: supabase_realtime publication이 있는 환경(Supabase)에만 chat_messages · chat_reads를 싣는다.
-- Realtime의 postgres_changes는 구독자의 RLS를 그대로 적용한다 — 못 보는 채널의 메시지는 오지 않는다.
-- ---------------------------------------------------------------------

create table chat_channels (
  channel_id  uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('company', 'team', 'dm')),
  business_id text references businesses(business_id) on delete cascade,
  team_id     text references teams(team_id) on delete cascade,
  -- 1:1의 두 사람. 작은 쪽이 a — 같은 두 사람에게 방이 둘 생기지 않게(unique).
  dm_a        uuid references auth.users(id) on delete cascade,
  dm_b        uuid references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint chat_channels_shape check (
    (kind = 'company' and business_id is not null and team_id is null and dm_a is null and dm_b is null)
    or (kind = 'team' and business_id is not null and team_id is not null and dm_a is null and dm_b is null)
    or (kind = 'dm' and business_id is null and team_id is null and dm_a is not null and dm_b is not null and dm_a < dm_b)
  )
);

create unique index chat_channels_company on chat_channels (business_id) where kind = 'company';
create unique index chat_channels_team on chat_channels (team_id) where kind = 'team';
create unique index chat_channels_dm on chat_channels (dm_a, dm_b) where kind = 'dm';

comment on table chat_channels is
  '0041. 메신저 채널. 회사 전체 / 팀 / 1:1. 여는 문은 ensure_chat_channels() · open_dm()뿐이다 — 표에 insert grant가 없다.';

create table chat_messages (
  message_id  bigint generated always as identity primary key,
  channel_id  uuid not null references chat_channels(channel_id) on delete cascade,
  sender_id   uuid not null default auth.uid() references auth.users(id),
  body        text not null default '' check (length(body) <= 4000),
  -- 링크 하나. 바깥 링크(https)나 앱 안의 경로('/…', '//…'는 아님).
  -- '/\\evil.com'은 브라우저가 '//evil.com'으로 읽는다 — 앱 안 경로는 '/' 다음이 '/'도 '\\'도 아니어야 한다.
  link        text check (link is null or link ~ '^https?://' or link ~ '^/($|[^/\\])'),
  document_id text references documents(document_id) on delete set null,
  created_at  timestamptz not null default now()
  -- «빈 메시지 금지»는 제약이 아니라 보낼 때의 트리거다. 제약으로 두면 첨부만 있던 메시지의 문서를
  -- 지우는 순간(on delete set null) 그 메시지가 제약에 걸려 문서 삭제 자체가 실패한다.
);

create index chat_messages_by_channel on chat_messages (channel_id, created_at desc);

-- 시각은 DB가 적는다. 클라이언트가 created_at을 보내 과거로 끼워 넣으면 «기록»의 순서가 거짓이 된다.
create or replace function chat_messages_stamp() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if length(trim(coalesce(new.body, ''))) = 0 and new.link is null and new.document_id is null then
    raise exception 'chat_message_empty' using errcode = '23514';
  end if;
  new.created_at := now();
  new.sender_id := coalesce(auth.uid(), new.sender_id);
  return new;
end;
$fn$;

create trigger chat_messages_stamp_trigger
  before insert on chat_messages
  for each row execute function chat_messages_stamp();

create table chat_reads (
  channel_id   uuid not null references chat_channels(channel_id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

-- 읽음 시각도 DB가 적는다 — 미래 시각으로 «다 읽었다»를 미리 찍지 못하게.
create or replace function chat_reads_stamp() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.last_read_at := now();
  return new;
end;
$fn$;

create trigger chat_reads_stamp_trigger
  before insert or update on chat_reads
  for each row execute function chat_reads_stamp();

-- ---------------------------------------------------------------------
-- 판정 — 채널 하나를 이 사람이 볼 수 있는가
-- ---------------------------------------------------------------------
create or replace function can_read_channel(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  -- 사람의 대화다. 시스템 역할(AIAgent · Integration, role_rank -1)은 회사 권한이 있어도 못 읽는다 —
  -- 야간 Job이 브리핑을 위해 회사 범위를 받았다고 사내 대화까지 읽을 이유가 없다.
  select is_active() and role_rank(auth_role()) >= 0 and exists (
    select 1 from chat_channels c
     where c.channel_id = p_channel
       and case c.kind
         when 'company' then has_business(c.business_id)
         when 'team' then has_business(c.business_id) and (
           exists (select 1 from teams t where t.team_id = c.team_id and t.lead_user_id = auth.uid())
           or exists (
             select 1 from user_profiles p
              where p.team_id = c.team_id and p.revoked_at is null and in_my_subtree(p.user_id)
           )
         )
         when 'dm' then auth.uid() in (c.dm_a, c.dm_b)
         else false
       end
  );
$fn$;

comment on function can_read_channel(uuid) is
  '0041. 회사 = has_business · 팀 = 팀장 또는 팀원이 내 subtree(자기 포함)에 있음 · 1:1 = 두 사람. 회장도 남의 1:1은 못 본다.';

alter table chat_channels enable row level security;
alter table chat_messages enable row level security;
alter table chat_reads enable row level security;

create policy chat_channels_read on chat_channels for select using (can_read_channel(channel_id));

create policy chat_messages_read on chat_messages for select using (can_read_channel(channel_id));
create policy chat_messages_insert on chat_messages for insert with check (
  can_read_channel(channel_id)
  and sender_id = auth.uid()
  -- 자기가 보는 문서만 건다. 하위 질의는 documents의 RLS를 그대로 탄다.
  and (document_id is null or exists (select 1 from documents d where d.document_id = chat_messages.document_id))
);

create policy chat_reads_read on chat_reads for select using (can_read_channel(channel_id));
create policy chat_reads_write on chat_reads for insert with check (user_id = auth.uid() and can_read_channel(channel_id));
create policy chat_reads_update on chat_reads for update
  using (user_id = auth.uid()) with check (user_id = auth.uid() and can_read_channel(channel_id));

-- 사람의 대화다. AI Agent와 Integration은 채널에 쓰지 않는다.
create policy ai_agent_no_insert on chat_messages as restrictive for insert with check (auth_role() is distinct from 'AIAgent');
create policy integration_no_insert on chat_messages as restrictive for insert with check (not is_integration());

revoke all on table chat_channels, chat_messages, chat_reads from anon, authenticated;
grant select on table chat_channels to authenticated;
-- 메시지는 보내고 읽기만. 고치고 지우는 grant가 없다(append-only).
grant select, insert on table chat_messages to authenticated;
grant select, insert, update on table chat_reads to authenticated;

-- ---------------------------------------------------------------------
-- 채널을 여는 문 둘
-- ---------------------------------------------------------------------

-- 이 사람이 속한 회사 · 팀의 채널이 없으면 만든다(여러 번 불러도 같다). 채널 목록은 이것을 부른 뒤
-- chat_channels를 RLS로 읽는다 — 만드는 것과 보이는 것이 같은 판정을 탄다.
create or replace function ensure_chat_channels() returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  n integer := 0;
  m integer;
begin
  if not is_active() or role_rank(auth_role()) < 0 then
    return 0;   -- 시스템 역할(AIAgent · Integration)은 채널을 열지 않는다.
  end if;
  insert into chat_channels (kind, business_id)
  select 'company', b.business_id from businesses b
   where has_business(b.business_id)
  on conflict (business_id) where kind = 'company' do nothing;
  get diagnostics m = row_count; n := n + m;

  -- 팀 채널: 내 팀, 내가 팀장인 팀, 그리고 내 subtree 사람이 있는 팀(상위자에게도 방이 보여야 한다).
  insert into chat_channels (kind, business_id, team_id)
  select 'team', t.business_id, t.team_id from teams t
   where has_business(t.business_id)
     and (
       t.lead_user_id = auth.uid()
       or exists (select 1 from user_profiles p where p.team_id = t.team_id and p.revoked_at is null and in_my_subtree(p.user_id))
     )
  on conflict (team_id) where kind = 'team' do nothing;
  get diagnostics m = row_count; n := n + m;
  return n;
end;
$fn$;

-- 1:1 열기. 상대가 활성 사용자이고 **같은 회사를 하나라도 함께** 가질 때만(그룹 범위 역할은 전원과).
-- 모르는 회사의 사람에게 말을 걸 수 있으면 회사 격리가 메신저로 샌다.
create or replace function open_dm(p_other uuid) returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_id uuid;
begin
  if not is_active() or role_rank(auth_role()) < 0 or p_other is null or p_other = v_me then
    raise exception 'dm_forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from user_profiles o
     where o.user_id = p_other and o.revoked_at is null and o.status = 'active' and role_rank(o.role) >= 0
       and (
         has_group_scope()
         or o.role::text in ('Chairman', 'GroupCFO')
         or exists (
           select 1 from user_business_access mine join user_business_access theirs using (business_id)
            where mine.user_id = v_me and theirs.user_id = p_other
         )
       )
  ) then
    raise exception 'dm_forbidden' using errcode = '42501';
  end if;
  v_a := least(v_me, p_other);
  v_b := greatest(v_me, p_other);
  insert into chat_channels (kind, dm_a, dm_b) values ('dm', v_a, v_b)
  on conflict (dm_a, dm_b) where kind = 'dm' do nothing;
  select channel_id into v_id from chat_channels where kind = 'dm' and dm_a = v_a and dm_b = v_b;
  return v_id;
end;
$fn$;

revoke all on function can_read_channel(uuid) from public, anon;
revoke all on function ensure_chat_channels() from public, anon;
revoke all on function open_dm(uuid) from public, anon;
grant execute on function can_read_channel(uuid) to authenticated;
grant execute on function ensure_chat_channels() to authenticated;
grant execute on function open_dm(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- AI 대화 — 본인만
-- ---------------------------------------------------------------------
create table ai_chats (
  chat_id    uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null default '',
  created_at timestamptz not null default now()
);

create table ai_chat_messages (
  id         bigint generated always as identity primary key,
  chat_id    uuid not null references ai_chats(chat_id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (length(content) between 1 and 8000),
  -- 답변의 근거 링크 [{label, href}] — 앱 안의 경로만.
  sources    jsonb not null default '[]' check (jsonb_typeof(sources) = 'array'),
  created_at timestamptz not null default now()
);

create index ai_chat_messages_by_chat on ai_chat_messages (chat_id, id);

alter table ai_chats enable row level security;
alter table ai_chat_messages enable row level security;

create policy ai_chats_own on ai_chats for all
  using (is_active() and user_id = auth.uid()) with check (is_active() and user_id = auth.uid());
create policy ai_chat_messages_own on ai_chat_messages for all
  using (is_active() and user_id = auth.uid())
  with check (
    is_active() and user_id = auth.uid()
    and exists (select 1 from ai_chats c where c.chat_id = ai_chat_messages.chat_id and c.user_id = auth.uid())
  );

revoke all on table ai_chats, ai_chat_messages from anon, authenticated;
grant select, insert, delete on table ai_chats to authenticated;
grant select, insert on table ai_chat_messages to authenticated;

-- 근거 링크는 앱 안의 경로만(화면이 그대로 <a href>로 그린다). 'javascript:' · 바깥 주소 · '//'는 받지 않는다.
create or replace function ai_chat_messages_check() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if exists (
    select 1 from jsonb_array_elements(new.sources) e
     where jsonb_typeof(e) <> 'object' or coalesce(e->>'href', '') !~ '^/($|[^/\\])'
  ) then
    raise exception 'ai_source_href' using errcode = '23514';
  end if;
  new.created_at := now();
  return new;
end;
$fn$;

create trigger ai_chat_messages_check_trigger
  before insert on ai_chat_messages
  for each row execute function ai_chat_messages_check();

-- 질문 요약을 감사에 남긴다(원문). 답변 · 질문 전문은 남기지 않는다 — audit_log는 회장이 읽는 표라,
-- 직원이 AI에게 한 질문의 전문을 회장이 읽게 되면 AI 채팅이 감시 도구가 된다. 앞 80자까지만.
create or replace function ai_chat_audit() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.role = 'user' then
    insert into audit_log (action, entity_table, entity_id, actor_user_id, actor_role, after, note)
    values ('create', 'ai_chats', new.chat_id::text, auth.uid(), auth_role()::text,
            jsonb_build_object('question', left(new.content, 80)),
            'AI에게 묻기 — 질문 요약');
  end if;
  return new;
end;
$fn$;

create trigger ai_chat_audit_trigger
  after insert on ai_chat_messages
  for each row execute function ai_chat_audit();

-- **질문 요약은 본인과 회장만 읽는다.** audit_log_read(0031)는 subtree를 열어 두어서, 그대로 두면
-- 팀장 · 임원이 부하 직원이 AI에게 무엇을 물었는지 읽게 된다 — AI 채팅이 감시 도구가 된다.
-- 넓히지 않고 좁힌다(restrictive): ai_chats 줄에만 걸리고 다른 감사 줄은 그대로다.
create policy audit_log_ai_chats_private on audit_log as restrictive for select
  using (entity_table is distinct from 'ai_chats' or actor_user_id = auth.uid() or auth_role()::text = 'Chairman');

-- ---------------------------------------------------------------------
-- Realtime — Supabase에만 있는 publication. 없는 환경(PGlite 검사)에서는 건너뛴다.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table chat_messages;
    alter publication supabase_realtime add table chat_reads;
  end if;
end
$$;
