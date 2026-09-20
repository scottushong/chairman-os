-- ---------------------------------------------------------------------
-- 0020. 공식 재무제표 (Phase 2-C 블록 1)
--
-- 회계 원천은 여전히 장부다(0015/0016). 이 표는 **회계법인이 낸 연·분기 결산**을 담는다.
-- 장부를 대신하지 않고 그 위에 한 층을 더 얹는다.
--
-- **왜 closings에 넣지 않았나.**
-- closings는 월 단위다 — `period ~ '^[0-9]{4}-[0-9]{2}$'`이고 손익 계정은 '그 달 발생액'이다.
-- 2025년 연간 매출 700억을 closings의 '2025-12'에 넣으면 그 달 발생액이 700억이 되고,
-- 그 값이 finance_ledger_cells → finance_kpis 뷰를 그대로 타고 올라가
-- '12월 한 달 매출 700억'인 추이 차트를 그린다. 연간 총액과 월별 합이 같은 표에서 더해지면
-- YTD도 두 배가 된다. 그래서 기간 단위가 다른 숫자는 표를 나눈다.
--
-- 두 층은 겹치지 않는다. 공식이 덮은 달은 월별 간이 손익(블록 2) 입력이 잠긴다.
-- 그래서 "기준: 2025 결산(확정) + 2026 1~8월(잠정)"이 그대로 사실이 된다.
--
-- data_source enum은 건드리지 않는다. 이 표에 들어왔다는 것이 곧 출처다 —
-- 누가 만들었는지는 evidence_url과 memo가 말한다.
-- (enum에 값을 더하면 alter type ... add value로 넣은 값을 같은 트랜잭션에서 못 써서
--  마이그레이션을 둘로 갈라야 한다. 얻는 것 없이 함정만 는다.)
-- ---------------------------------------------------------------------

create table official_statements (
  id            bigint generated always as identity primary key,
  business_id   text not null references businesses(business_id) on delete restrict, -- [일반]
  period_kind   text not null check (period_kind in ('year', 'quarter')),            -- [일반]
  -- 'YYYY' 또는 'YYYY-Q1'..'YYYY-Q4'. 두 모양을 한 칸에 두는 대신 kind로 어느 쪽인지 못 박는다.
  period_key    text not null,                                                       -- [일반]
  -- 증빙은 필수다. 확정 꼬리표를 다는 숫자에 근거가 없으면 그 꼬리표가 거짓이 된다.
  -- 파일 실체는 사내 스토리지에 두고 여기는 링크만 보관한다(CLAUDE.md).
  evidence_url  text not null check (evidence_url ~* '^https?://'),                  -- [제한]
  memo          text not null check (length(trim(memo)) > 0),                        -- [제한] '성연회계법인 2025 결산'
  created_by    uuid not null default auth.uid(),                                    -- [제한]
  created_at    timestamptz not null default now(),
  -- 정정. 같은 기간을 다시 넣으면 이전 행을 덮지 않고 supersede 한다(0016의 전표 규칙과 같다).
  superseded_at timestamptz,                                                         -- [일반]
  supersedes_id bigint references official_statements(id) on delete restrict,        -- [일반]

  constraint official_statements_period_shape check (
    (period_kind = 'year'    and period_key ~ '^[0-9]{4}$') or
    (period_kind = 'quarter' and period_key ~ '^[0-9]{4}-Q[1-4]$')
  )
);

-- 한 기간의 **활성** 결산은 하나뿐이다. 지난 정정 이력은 얼마든지 쌓인다.
create unique index official_statements_one_active
  on official_statements (business_id, period_kind, period_key)
  where superseded_at is null;

create index official_statements_by_business on official_statements (business_id, period_key);

comment on table official_statements is
  '0020. 회계법인 연·분기 결산의 헤더. 월 단위인 closings와 기간 단위가 달라 표를 나눴다. 고치지 않는다 — 정정으로 쌓는다.';

create table official_statement_lines (
  statement_id bigint not null references official_statements(id) on delete cascade, -- [일반]
  business_id  text not null,                                                        -- [일반]
  account_code text not null,                                                        -- [일반]
  -- 원장과 같은 규약: 차변 − 대변. 매출·부채·자본은 음수로 앉는다.
  -- 화면이 사람이 읽는 양수로 뒤집는다(lib/statements/balance.ts).
  amount       numeric(20, 2) not null,                                              -- [제한]
  primary key (statement_id, account_code),
  foreign key (business_id, account_code) references accounts (business_id, account_code) on delete restrict
);

comment on table official_statement_lines is
  '0020. 공식 재무제표의 계정별 금액. amount = 차변 − 대변(0015 규약 그대로).';

-- ---------------------------------------------------------------------
-- RLS — closings·journal_entries와 같은 문을 쓴다.
-- ---------------------------------------------------------------------
alter table official_statements enable row level security;
alter table official_statements force row level security;
alter table official_statement_lines enable row level security;
alter table official_statement_lines force row level security;

create policy official_statements_read on official_statements
  for select using (has_business(business_id) and can_read_restricted());
create policy official_statements_insert on official_statements
  for insert with check (can_keep_books(business_id) and created_by = auth.uid());
-- supersede만 허용한다. 금액·기간·증빙은 한 번 들어가면 고치지 못한다.
create policy official_statements_supersede on official_statements
  for update using (can_keep_books(business_id) and superseded_at is null)
  with check (can_keep_books(business_id));
-- delete 정책 없음(Default Deny). 결산은 지우지 않는다.

create policy official_statement_lines_read on official_statement_lines
  for select using (has_business(business_id) and can_read_restricted());
create policy official_statement_lines_insert on official_statement_lines
  for insert with check (can_keep_books(business_id));

-- AI Agent와 Integration은 이 표에 쓰지 않는다. 0016의 전표와 같은 이유다 —
-- 확정 결산은 사람이 증빙을 보고 넣는다.
create policy official_statements_ai_no_insert on official_statements as restrictive for insert
  with check (auth_role() is distinct from 'AIAgent');
create policy official_statements_integration_no_insert on official_statements as restrictive for insert
  with check (not is_integration());
create policy official_statement_lines_ai_no_insert on official_statement_lines as restrictive for insert
  with check (auth_role() is distinct from 'AIAgent');
create policy official_statement_lines_integration_no_insert on official_statement_lines as restrictive for insert
  with check (not is_integration());

-- ---------------------------------------------------------------------
-- 저장 — supersede + 헤더 + 라인 + audit_log를 **한 트랜잭션**으로.
--
-- 나뉘면 '활성 행이 둘'이거나 '하나도 없는' 순간이 생긴다. 그 순간에 다른 화면이 읽으면
-- 회사의 결산이 사라졌거나 두 개로 보인다.
--
-- 균형 검사(자산 = 부채 + 자본)는 화면이 먼저 하지만 여기서도 한 번 더 본다 —
-- 화면을 거치지 않고 들어오는 길이 생겨도 닫히지 않은 재무제표가 확정으로 앉으면 안 된다.
-- ---------------------------------------------------------------------
create or replace function official_statement_save(
  p_business_id  text,
  p_period_kind  text,
  p_period_key   text,
  p_evidence_url text,
  p_memo         text,
  p_lines        jsonb   -- [{account_code, amount}, ...]
) returns bigint
language plpgsql security invoker set search_path = public as $fn$
declare
  v_prev    official_statements%rowtype;
  v_id      bigint;
  v_balance numeric(20, 2);
  v_before  jsonb;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '재무제표에 줄이 하나도 없습니다.';
  end if;

  -- 자산 + 부채 + 자본 = 0. 원장 규약(차변 − 대변)에서 재무상태표가 닫힌다는 뜻이 이것이다.
  select coalesce(sum((l->>'amount')::numeric), 0)
    into v_balance
    from jsonb_array_elements(p_lines) l
    join accounts a
      on a.business_id = p_business_id and a.account_code = l->>'account_code'
   where a.section in ('cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity');

  if v_balance <> 0 then
    raise exception '재무상태표가 닫히지 않습니다. 차이 %원', v_balance;
  end if;

  select * into v_prev
    from official_statements
   where business_id = p_business_id
     and period_kind = p_period_kind
     and period_key  = p_period_key
     and superseded_at is null;

  if found then
    select jsonb_build_object(
             'memo', v_prev.memo,
             'evidence_url', v_prev.evidence_url,
             'lines', coalesce(jsonb_agg(jsonb_build_object('account_code', account_code, 'amount', amount)
                                order by account_code), '[]'::jsonb))
      into v_before
      from official_statement_lines where statement_id = v_prev.id;

    update official_statements set superseded_at = now() where id = v_prev.id;
  end if;

  insert into official_statements (business_id, period_kind, period_key, evidence_url, memo, supersedes_id)
  values (p_business_id, p_period_kind, p_period_key, p_evidence_url, p_memo, v_prev.id)
  returning id into v_id;

  insert into official_statement_lines (statement_id, business_id, account_code, amount)
  select v_id, p_business_id, l->>'account_code', (l->>'amount')::numeric
    from jsonb_array_elements(p_lines) l;

  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values (case when v_prev.id is null then 'create' else 'update' end,
          'official_statements', v_id::text, p_business_id, auth.uid(), auth_role()::text,
          v_before,
          jsonb_build_object('memo', p_memo, 'evidence_url', p_evidence_url, 'lines', p_lines),
          case when v_prev.id is null
               then format('공식 재무제표 %s %s', p_period_kind, p_period_key)
               else format('공식 재무제표 정정 %s %s — 이전 #%s', p_period_kind, p_period_key, v_prev.id) end);

  return v_id;
end;
$fn$;

comment on function official_statement_save is
  '0020. 공식 재무제표 저장. supersede + 헤더 + 라인 + 감사기록을 한 트랜잭션으로. 닫히지 않으면 예외.';
