-- =====================================================================
-- Chairman OS — 0066_quotes (가격 엔진 · 견적 · Red 견적 «가격 예외» 결재)
-- 작성: 2026-10-10 · 설계서 docs/superpowers/specs/cost-engine.md 11절 · 19절
--
-- ■ 회장 결정 ■
--   · 견적 = 고객(이름 · 회사) · 제품 · kg · 제시가(원/kg, 1원 단위) · 통화 · 유효기간 · 상태(초안 · 승인 대기 · 확정 · 반려 · 취소, 만료는 읽을 때).
--   · 저장 순간 원가 스냅숏을 영구 저장: 영업이 본 값 그대로(0시 기준 총원가 · 마진 · % · 등급)는 견적 행에,
--     대표용 원래 값(0시 기준 원래 값 · 지금 원래 값)은 비공개 스키마(cost_secret.quote_raw)에.
--   · 견적은 고치지 않는다 — 바꾸려면 새 판(원본 연결, 같은 뿌리 · 판 번호 +1). 상태만 함수가 바꾼다. 모든 쓰기 감사.
--   · Red(마진 15% 미만)는 0059 결재(상사 사슬 → 대표)로 승인받아야 확정. 새 양식 «가격 예외»(approval_templates check 확장).
--     결재 화면 · 대장 · 엑셀에 원료 정보 0 — 양식 칸은 견적 번호 · 제품 · kg · 제시가 · 통화 · 등급(«Red (마진 15% 미만)»)뿐이고 DB가 만든다.
--     리뷰 I1 — 마진 %는 양식에 넣지 않는다: 결재는 상사 사슬 · 결재 대장 권한자(구매 · 생산 겸직 포함)가 읽어서, 제시가 × (1 − 마진 %)로
--     제품 원가가 겸직자에게 간다(cost_role_conflict 우회). 마진은 견적 화면(본인 · 영업 팀장 · 대표)에만.
--   · Green · Yellow는 바로 확정.
--   · 권한: 영업 견적 권한자('/sales/<회사>' 쓰기)는 본인 견적 쓰기 · 읽기. 같은 회사 영업 팀장(TeamLead + 그 회사 영업 줄)은
--     subtree 팀원 견적 읽기. 대표 전부. 구매 · 생산 · 원가 관리는 견적 표 0행 — 원가 관리는 확정 견적의 제품 · kg · 제시가만(회계용 RPC).
--
-- ■ 막는 길 ■
--   · 스냅숏 위조: 견적 표에 insert · update · delete 권한 없음 — 쓰기는 이 파일의 정의자 함수만. 스냅숏은 함수가 원가 엔진(문 통과)으로 계산.
--   · Red 우회: 확정 함수가 Red면 연결된 결재가 Approved인지 본다. 결재 뒤 제시가를 바꾸는 길 없음(행 얼림 트리거 · 새 판은 새 결재).
--     «가격 예외» 결재를 손으로 올리는 길 없음(decisions insert 가드 — quote_request_approval 안에서만).
--   · 다른 회사: has_business · cost_can · 제품의 회사 = 견적의 회사(복합 FK).
--   · 원가 노출: 견적 만들기는 0062 문(cost_gate)을 지난다 — 하루 200건 한도에 한 건 · 감사 · 겸직 거부 · 영업은 0시 기준(0062 (가)).
--
-- 0035 규칙: force를 걸지 않는다. 0001~0065를 고치지 않는다(양식 check만 drop/add — 다섯 양식은 그대로 받는다).
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 결재 양식 «가격 예외»
-- =====================================================================
alter table approval_templates drop constraint if exists approval_templates_template_key_check;
alter table approval_templates add constraint approval_templates_template_key_check
  check (template_key in ('expense', 'purchase', 'leave', 'contract', 'hiring', 'price_exception'));

insert into approval_templates (template_key, name_ko, name_en, fields, attachment_required, chairman_always, chairman_over, sort_order) values
  ('price_exception', '가격 예외', 'Price exception', '[
     {"key":"quote","label_ko":"견적 번호","label_en":"Quote","type":"text","required":true},
     {"key":"product","label_ko":"제품","label_en":"Product","type":"text","required":true},
     {"key":"kg","label_ko":"수량(kg)","label_en":"Quantity (kg)","type":"text","required":true},
     {"key":"price","label_ko":"제시가(원/kg)","label_en":"Price (KRW/kg)","type":"text","required":true},
     {"key":"currency","label_ko":"통화","label_en":"Currency","type":"text","required":true},
     {"key":"grade","label_ko":"등급","label_en":"Grade","type":"text","required":true}
   ]'::jsonb, false, true, null, 60)
on conflict (template_key) do nothing;

-- 손으로 올리는 «가격 예외»는 받지 않는다 — 양식 칸(제품 · 마진 %)을 사람이 지어 넣으면 결재자가 거짓 견적을 승인한다.
create or replace function decisions_price_exception_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.template_key = 'price_exception' and coalesce(current_setting('chairman.quote_approval', true), '') <> 'on' then
    raise exception 'price_exception_use_quote' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke all on function decisions_price_exception_guard() from public, anon, authenticated;
create trigger decisions_price_exception_guard before insert on decisions
  for each row execute function decisions_price_exception_guard();

-- =====================================================================
-- 2절. 견적 표 · 비공개 원래 값
-- =====================================================================
create table quotes (
  quote_id              text primary key default ('qt_' || replace(gen_random_uuid()::text, '-', '')),
  business_id           text not null references businesses(business_id),
  root_id               text not null,                          -- 첫 판의 quote_id(첫 판은 자기 자신)
  version               int not null check (version between 1 and 999),
  parent_id             text references quotes(quote_id),
  customer_name         text not null check (length(btrim(customer_name)) between 1 and 100),
  customer_company      text not null check (length(btrim(customer_company)) between 1 and 200),
  product_id            text not null,
  product_name          text not null,
  kg                    numeric not null check (kg > 0 and kg <= 1e9),
  price_krw_per_kg      numeric not null check (price_krw_per_kg > 0 and price_krw_per_kg <= 1e9 and price_krw_per_kg = trunc(price_krw_per_kg)),
  currency              text not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  fx_rate               numeric not null default 1 check (fx_rate > 0),   -- 저장 순간 통화 → 원(KRW = 1). 고객용 견적서 금액 = 제시가 ÷ fx_rate
  valid_until           date not null,
  status                text not null default 'draft' check (status in ('draft', 'pending_approval', 'confirmed', 'rejected', 'cancelled')),
  -- 스냅숏 — 영업이 본 값 그대로(대표 외 1원 · 대표는 원래 값). 원료 · 원료별 값 없음.
  cost_as_of            date not null,
  cost_basis            text not null check (cost_basis in ('midnight', 'now')),   -- midnight = 오늘 0시까지 저장된 값(영업) · now = 즉시
  cost_total_krw_per_kg numeric not null,
  margin_krw_per_kg     numeric not null,
  margin_pct            numeric not null,
  grade                 text not null check (grade in ('green', 'yellow', 'red')),
  decision_id           text references decisions(decision_id),
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  confirmed_at          timestamptz,
  cancelled_at          timestamptz,
  foreign key (product_id, business_id) references cost_products (product_id, business_id),
  unique (root_id, version),
  constraint quotes_decision_shape check (decision_id is null or grade = 'red')
);
create index quotes_by_biz on quotes (business_id, created_at desc);
create index quotes_by_creator on quotes (created_by, created_at desc);
create unique index quotes_one_decision on quotes (decision_id) where decision_id is not null;
comment on table quotes is '0066. 견적 — 고치지 않는다(새 판). 쓰기는 quote_* 정의자 함수만. 스냅숏은 원가 엔진이 계산한 영업 값.';

create table cost_secret.quote_raw (
  quote_id         text primary key references public.quotes(quote_id),
  total_raw_basis  numeric not null,   -- 견적 행 스냅숏의 원래 값(영업 = 0시 기준)
  total_raw_now    numeric,            -- 같은 순간 즉시 원래 값(대표 비교용)
  material_raw_now numeric,
  overhead_raw_now numeric,
  computed_at      timestamptz not null default now()
);
alter table cost_secret.quote_raw enable row level security;
revoke all on table cost_secret.quote_raw from public, anon, authenticated;

alter table quotes enable row level security;
revoke all on table quotes from public, anon, authenticated;
grant select on table quotes to authenticated;

-- 본인 · 같은 회사 영업 팀장(subtree) · 대표. 회사 접근은 늘 함께.
-- 리뷰 I2 · M3 — 대표 외에는 원가 문(cost_gate_biz)과 같은 겸직 거부: 구매 쓰기 줄, 또는 원가 관리 없이 구매 · 생산 줄이 있으면 0행.
-- 본인 견적도 지금 그 회사 영업 줄이 있을 때만(영업에서 구매로 옮긴 사람이 옛 견적 원가를 계속 읽지 않게).
create policy quotes_read on quotes for select to authenticated
  using (is_active() and has_business(business_id) and (
           auth_role()::text = 'Chairman'
           or (cost_grant('sales', business_id)
               and not cost_grant('purchasing', business_id, true)
               and (cost_grant('costing', business_id) or not (cost_grant('purchasing', business_id) or cost_grant('production', business_id)))
               and (created_by = auth.uid()
                    or (auth_role()::text = 'TeamLead' and in_my_subtree(created_by))))));

-- 얼림 — 정의자 함수가 바꾸는 칸(상태 · 결재 · 확정/취소 시각)만. 소유자 경로(함수)도 이 트리거를 지난다.
create or replace function quotes_frozen() returns trigger
language plpgsql set search_path = public, pg_temp as $fn$
begin
  if (to_jsonb(new) - 'status' - 'decision_id' - 'confirmed_at' - 'cancelled_at')
     is distinct from (to_jsonb(old) - 'status' - 'decision_id' - 'confirmed_at' - 'cancelled_at') then
    raise exception 'quote_frozen' using errcode = '42501';
  end if;
  if old.decision_id is not null and new.decision_id is distinct from old.decision_id then
    raise exception 'quote_frozen' using errcode = '42501';
  end if;
  if old.status in ('confirmed', 'rejected', 'cancelled') and new.status is distinct from old.status
     and not (old.status = 'confirmed' and new.status = 'cancelled') then
    raise exception 'quote_closed' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke all on function quotes_frozen() from public, anon, authenticated;
create trigger quotes_frozen before update on quotes for each row execute function quotes_frozen();

-- =====================================================================
-- 3절. 함수
-- =====================================================================

/**
 * 리뷰 I3 — 0062 cost_price_check에 대표 외 제시가 하한(1원 총원가의 절반)을 더한다(quote_create와 같은 문). 하한 밑이면 등급 'too_low' ·
 * 마진 null(raise 아님 — 재검토 N1). 나머지는 0062 그대로.
 * 0062를 고치지 않으려고 여기서 다시 정의한다(같은 서명 · 같은 권한).
 */
create or replace function cost_price_check(p_product text, p_price_krw_per_kg numeric)
returns table (total_krw_per_kg numeric, margin_krw_per_kg numeric, margin_pct numeric, grade text)
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  g record;
  r record;
  v_pct numeric;
begin
  if p_price_krw_per_kg is null or p_price_krw_per_kg <= 0 or p_price_krw_per_kg > 1e9 then
    raise exception 'cost_price_invalid' using errcode = '22023';
  end if;
  select * into g from cost_secret.cost_gate(p_product, 'price_check', null);
  if not g.chairman and p_price_krw_per_kg <> trunc(p_price_krw_per_kg) then
    raise exception 'cost_price_invalid' using errcode = '22023';
  end if;
  select * into r from cost_secret.sales_row(p_product, g.business_id, g.as_of, g.chairman,
    cost_secret.business_complete(g.business_id, 'market', g.as_of) and cost_secret.business_complete(g.business_id, 'current', g.as_of),
    false);
  if r.total_raw is null then
    return query select null::numeric, null::numeric, null::numeric, null::text;
    return;
  end if;
  -- 재검토 N1 — 문 뒤에서는 raise하지 않는다(한도 · 감사가 되돌아간다). 등급 'too_low'로 답한다(총원가는 이 함수가 원래 알려 주는 값).
  if not g.chairman and p_price_krw_per_kg * 2 < r.total_krw_per_kg then
    return query select r.total_krw_per_kg, null::numeric, null::numeric, 'too_low'::text;
    return;
  end if;
  v_pct := (p_price_krw_per_kg - r.total_raw) / p_price_krw_per_kg * 100;
  return query select r.total_krw_per_kg, cost_secret.shown(p_price_krw_per_kg - r.total_raw, g.chairman), round(v_pct, 1), cost_grade(v_pct);
end;
$fn$;
revoke all on function cost_price_check(text, numeric) from public, anon;
grant execute on function cost_price_check(text, numeric) to authenticated;

/** 보이는 견적(정책과 같은 조건) — 정의자 함수 안에서 «읽을 수 있나»를 같은 글자로. */
create or replace function quote_visible(p_quote text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from quotes q
                  where q.quote_id = p_quote and is_active() and has_business(q.business_id)
                    and (auth_role()::text = 'Chairman'
                         or (cost_grant('sales', q.business_id)
                             and not cost_grant('purchasing', q.business_id, true)
                             and (cost_grant('costing', q.business_id) or not (cost_grant('purchasing', q.business_id) or cost_grant('production', q.business_id)))
                             and (q.created_by = auth.uid()
                                  or (auth_role()::text = 'TeamLead' and in_my_subtree(q.created_by))))));
$fn$;

/** 쓸 수 있는 견적 — 만든 사람(그 회사 영업 쓰기 줄이 아직 있을 때) 또는 대표. */
create or replace function quote_writable(p_quote text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  -- 재검토 N3 — 읽을 수 있는 견적만(겸직 거부 · 지금 영업 줄).
  select quote_visible(p_quote) and exists (select 1 from quotes q
                  where q.quote_id = p_quote and is_active() and has_business(q.business_id)
                    and (auth_role()::text = 'Chairman' or (q.created_by = auth.uid() and cost_can('sales', q.business_id, true))));
$fn$;

/**
 * 새 견적(또는 새 판). 원가 엔진 문(cost_gate)을 지난다 — 영업은 0시 기준 · 대표는 즉시 원래 값. 계산이 안 되면 거부.
 * p_parent: 새 판의 원본(같은 회사 · 내가 쓸 수 있는 견적). 원본이 초안 · 승인 대기 · 반려면 취소된다(대체).
 */
create or replace function quote_create(p_product text, p_customer_name text, p_customer_company text, p_kg numeric,
                                        p_price_krw_per_kg numeric, p_currency text, p_valid_until date, p_parent text default null)
returns text
language plpgsql volatile security definer set search_path = public, cost_secret, pg_temp as $fn$
declare
  g record;
  r record;
  n record;
  v_biz text;
  v_name text;
  v_fx numeric;
  v_pct numeric;
  v_basis text;
  v_root text;
  v_ver int := 1;
  v_id text := 'qt_' || replace(gen_random_uuid()::text, '-', '');
  v_par quotes%rowtype;
  v_today date := cost_today();
begin
  select p.business_id, p.name into v_biz, v_name from cost_products p where p.product_id = p_product;
  if v_biz is null or not cost_can('sales', v_biz, true) then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if p_kg is null or p_kg <= 0 or p_kg > 1e9
     or p_price_krw_per_kg is null or p_price_krw_per_kg <= 0 or p_price_krw_per_kg > 1e9 or p_price_krw_per_kg <> trunc(p_price_krw_per_kg)
     or p_valid_until is null or p_valid_until < v_today or p_valid_until > v_today + 365
     or length(btrim(coalesce(p_customer_name, ''))) not between 1 and 100
     or length(btrim(coalesce(p_customer_company, ''))) not between 1 and 200
     or coalesce(p_currency, '') !~ '^[A-Z]{3}$' then
    raise exception 'quote_invalid' using errcode = '22023';
  end if;
  if p_parent is not null then
    select * into v_par from quotes where quote_id = p_parent;
    if not found or v_par.business_id <> v_biz or not quote_writable(p_parent) then
      raise exception 'quote_not_found' using errcode = 'P0002';
    end if;
    v_root := v_par.root_id;
    select coalesce(max(version), 0) + 1 into v_ver from quotes where root_id = v_root;
  else
    v_root := v_id;
  end if;
  v_fx := case when p_currency = 'KRW' then 1 else cost_fx(p_currency, v_today, null) end;

  -- 원가 — 문(한도 · 감사 · 겸직 거부 · 영업 0시 기준). 제시가 확인(cost_price_check)과 같은 계산.
  select * into g from cost_secret.cost_gate(p_product, 'quote', null);
  v_basis := case when coalesce(current_setting('cost.known_at', true), '') = '' then 'now' else 'midnight' end;
  select * into r from cost_secret.sales_row(p_product, g.business_id, g.as_of, g.chairman,
    cost_secret.business_complete(g.business_id, 'market', g.as_of) and cost_secret.business_complete(g.business_id, 'current', g.as_of),
    false);
  if r.total_raw is null then
    raise exception 'quote_cost_unavailable' using errcode = '22023';
  end if;
  -- 리뷰 I3 — 대표 외 제시가 하한(1원 총원가의 절반). 마진 %(0.1%p)는 원래 총원가를 «제시가 × 0.001원» 폭으로 푼다 —
  -- 제시가 1원이면 0.001원. 하한이 있으면 한 번에 «총원가 × 0.0005» 폭 아래로는 못 내려간다(총원가 1,000원/kg 이상이면 0.5원 이상).
  -- 회장 결정(마진 %는 원래 값)은 그대로. 여러 제시가를 겹쳐 좁히는 길은 설계서 16절의 남는 위험(200건 한도 안).
  -- 재검토 N1 — 문(cost_gate) 뒤에서 raise하면 한도 · 감사 줄까지 되돌아가 «거부 여부»가 공짜 오라클이 된다. 저장 없이 null을 돌려준다
  -- (앱 저장소가 cost_price_too_low로 바꾼다). 한도 · 감사는 남는다.
  if not g.chairman and p_price_krw_per_kg * 2 < r.total_krw_per_kg then
    return null;
  end if;
  v_pct := (p_price_krw_per_kg - r.total_raw) / p_price_krw_per_kg * 100;

  insert into quotes (quote_id, business_id, root_id, version, parent_id, customer_name, customer_company, product_id, product_name,
                      kg, price_krw_per_kg, currency, fx_rate, valid_until, status, cost_as_of, cost_basis,
                      cost_total_krw_per_kg, margin_krw_per_kg, margin_pct, grade, created_by)
  values (v_id, v_biz, v_root, v_ver, p_parent, btrim(p_customer_name), btrim(p_customer_company), p_product, v_name,
          p_kg, p_price_krw_per_kg, p_currency, v_fx, p_valid_until, 'draft', g.as_of, v_basis,
          r.total_krw_per_kg, cost_secret.shown(p_price_krw_per_kg - r.total_raw, g.chairman),
          round(v_pct, 1), cost_grade(v_pct), auth.uid());

  -- 대표용 원래 값 — 같은 순간의 즉시 값도(영업 견적이면 0시 기준과 다를 수 있다). 이 뒤로 이 트랜잭션은 즉시다(함수 끝).
  perform set_config('cost.known_at', '', true);
  select * into n from cost_secret.sales_row(p_product, g.business_id, g.as_of, true, true, false);
  insert into cost_secret.quote_raw (quote_id, total_raw_basis, total_raw_now, material_raw_now, overhead_raw_now)
  values (v_id, r.total_raw, n.total_raw, n.current_krw_per_kg, n.overhead_krw_per_kg);

  if v_par.quote_id is not null and v_par.status in ('draft', 'pending_approval', 'rejected') then
    update quotes set status = 'cancelled', cancelled_at = now() where quote_id = v_par.quote_id and status in ('draft', 'pending_approval');
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('create', 'quotes', v_id, v_biz, auth.uid(), auth_role()::text, null,
          jsonb_build_object('version', v_ver, 'parent', p_parent, 'kg', p_kg, 'price', p_price_krw_per_kg, 'grade', cost_grade(v_pct)),
          '견적 저장(0066)');
  return v_id;
end;
$fn$;

/** Red 견적 → «가격 예외» 결재(0059 단계 결재 · 대표까지). 양식 칸은 여기서 만든다. */
create or replace function quote_request_approval(p_quote text)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  q quotes%rowtype;
  v_dec text := 'dec_q' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  v_status text;
begin
  select * into q from quotes where quote_id = p_quote for update;
  if not found or not quote_writable(p_quote) then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if q.grade <> 'red' then
    raise exception 'quote_not_red' using errcode = '22023';
  end if;
  if q.status <> 'draft' then
    raise exception 'quote_not_draft' using errcode = '22023';
  end if;
  if q.valid_until < cost_today() then
    raise exception 'quote_expired' using errcode = '22023';
  end if;
  perform set_config('chairman.quote_approval', 'on', true);
  insert into decisions (decision_id, business_id, title, template_key, form, created_by)
  values (v_dec, q.business_id, '가격 예외 — ' || q.product_name || ' ' || trim(to_char(q.kg, 'FM999,999,999,990.###')) || 'kg', 'price_exception',
          jsonb_build_object('quote', q.quote_id || ' (' || q.version || '판)', 'product', q.product_name,
                             'kg', trim(to_char(q.kg, 'FM999,999,999,990.###')),
                             'price', trim(to_char(q.price_krw_per_kg, 'FM999,999,999,990')),
                             'currency', q.currency, 'grade', 'Red (마진 15% 미만)'),
          auth.uid());
  perform set_config('chairman.quote_approval', '', true);
  select status::text into v_status from decisions where decision_id = v_dec;
  -- 대표 본인 견적은 0059가 바로 승인으로 닫는다.
  update quotes set status = 'pending_approval', decision_id = v_dec where quote_id = p_quote;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'quotes', p_quote, q.business_id, auth.uid(), auth_role()::text, jsonb_build_object('status', 'draft'),
          jsonb_build_object('status', 'pending_approval', 'decision_id', v_dec, 'decision_status', v_status), '가격 예외 결재 요청(0066)');
  return v_dec;
end;
$fn$;

/** 확정 — Green · Yellow는 초안에서 바로. Red는 연결된 «가격 예외» 결재가 승인(Approved)이어야. 만료(유효기간 지남)면 거부. */
create or replace function quote_confirm(p_quote text)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  q quotes%rowtype;
  d record;
begin
  select * into q from quotes where quote_id = p_quote for update;
  if not found or not quote_writable(p_quote) then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if q.valid_until < cost_today() then
    raise exception 'quote_expired' using errcode = '22023';
  end if;
  if q.grade = 'red' then
    if q.status <> 'pending_approval' or q.decision_id is null then
      raise exception 'quote_needs_approval' using errcode = '42501';
    end if;
    select status::text as status, template_key, form into d from decisions where decision_id = q.decision_id;
    if d.status is distinct from 'Approved' or d.template_key is distinct from 'price_exception'
       or d.form->>'quote' is distinct from (q.quote_id || ' (' || q.version || '판)') then
      raise exception 'quote_needs_approval' using errcode = '42501';
    end if;
  elsif q.status <> 'draft' then
    raise exception 'quote_not_draft' using errcode = '22023';
  end if;
  update quotes set status = 'confirmed', confirmed_at = now() where quote_id = p_quote;
  -- 같은 견적의 앞 판이 확정돼 있었으면 그 판은 이 판으로 대체된다.
  update quotes set status = 'cancelled', cancelled_at = now()
   where root_id = q.root_id and quote_id <> p_quote and status = 'confirmed';
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('approve', 'quotes', p_quote, q.business_id, auth.uid(), auth_role()::text, jsonb_build_object('status', q.status),
          jsonb_build_object('status', 'confirmed', 'grade', q.grade, 'decision_id', q.decision_id), '견적 확정(0066)');
end;
$fn$;

/** 취소 — 초안 · 승인 대기만(확정은 새 판으로 대체). 열린 결재는 그대로 두되, 승인돼도 취소된 견적은 확정할 수 없다. */
create or replace function quote_cancel(p_quote text)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  q quotes%rowtype;
begin
  select * into q from quotes where quote_id = p_quote for update;
  if not found or not quote_writable(p_quote) then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if q.status not in ('draft', 'pending_approval') then
    raise exception 'quote_not_draft' using errcode = '22023';
  end if;
  update quotes set status = 'cancelled', cancelled_at = now() where quote_id = p_quote;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('update', 'quotes', p_quote, q.business_id, auth.uid(), auth_role()::text, jsonb_build_object('status', q.status),
          jsonb_build_object('status', 'cancelled'), '견적 취소(0066)');
end;
$fn$;

/** 결재가 반려되면 견적은 «반려»(새 판으로 다시). 0059 approval_decide가 decisions를 닫는 순간. */
create or replace function quotes_decision_closed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.template_key = 'price_exception' and old.status::text = 'Open' and new.status::text = 'Rejected' then
    update quotes set status = 'rejected' where decision_id = new.decision_id and status = 'pending_approval';
  end if;
  return new;
end;
$fn$;
revoke all on function quotes_decision_closed() from public, anon, authenticated;
create trigger quotes_decision_closed after update of status on decisions
  for each row execute function quotes_decision_closed();

/** 고객용 견적서 내려받기 감사(원가 · 마진 없음 — 화면이 만든다). 확정 견적만. */
create or replace function quote_download_log(p_quote text, p_format text)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
declare
  q quotes%rowtype;
begin
  select * into q from quotes where quote_id = p_quote;
  if not found or not quote_visible(p_quote) then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if q.status <> 'confirmed' or p_format not in ('xlsx', 'pdf') then
    raise exception 'quote_not_confirmed' using errcode = '22023';
  end if;
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, before, after, note)
  values ('export', 'quotes', p_quote, q.business_id, auth.uid(), auth_role()::text, null,
          jsonb_build_object('format', p_format), '고객용 견적서 내려받기(0066)');
end;
$fn$;

/** 원가 관리(회계용) — 그 회사 확정 견적의 제품 · kg · 제시가 · 통화 · 확정일만. 원가 스냅숏 · 고객 · 만든 사람 없음. */
create or replace function quotes_confirmed_for_costing(p_business text)
returns table (quote_id text, product_name text, kg numeric, price_krw_per_kg numeric, currency text, confirmed_on date)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not cost_can('costing', p_business) then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  return query select q.quote_id, q.product_name, q.kg, q.price_krw_per_kg, q.currency, (q.confirmed_at at time zone 'Asia/Seoul')::date
    from quotes q where q.business_id = p_business and q.status = 'confirmed' order by q.confirmed_at desc limit 2000;
end;
$fn$;

/** 대표: 견적의 원래 값(0시 기준 원래 값 · 같은 순간 즉시 값). */
create or replace function quote_raw(p_quote text)
returns table (quote_id text, total_raw_basis numeric, total_raw_now numeric, material_raw_now numeric, overhead_raw_now numeric)
language plpgsql stable security definer set search_path = public, cost_secret, pg_temp as $fn$
begin
  if not (is_active() and auth_role()::text = 'Chairman') then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  return query select r.quote_id, r.total_raw_basis, r.total_raw_now, r.material_raw_now, r.overhead_raw_now
    from cost_secret.quote_raw r join quotes q on q.quote_id = r.quote_id
   where r.quote_id = p_quote and has_business(q.business_id);
end;
$fn$;

revoke all on function quote_visible(text) from public, anon, authenticated;
revoke all on function quote_writable(text) from public, anon, authenticated;
revoke all on function quote_create(text, text, text, numeric, numeric, text, date, text) from public, anon;
revoke all on function quote_request_approval(text) from public, anon;
revoke all on function quote_confirm(text) from public, anon;
revoke all on function quote_cancel(text) from public, anon;
revoke all on function quote_download_log(text, text) from public, anon;
revoke all on function quotes_confirmed_for_costing(text) from public, anon;
revoke all on function quote_raw(text) from public, anon;
grant execute on function quote_create(text, text, text, numeric, numeric, text, date, text) to authenticated;
grant execute on function quote_request_approval(text) to authenticated;
grant execute on function quote_confirm(text) to authenticated;
grant execute on function quote_cancel(text) to authenticated;
grant execute on function quote_download_log(text, text) to authenticated;
grant execute on function quotes_confirmed_for_costing(text) to authenticated;
grant execute on function quote_raw(text) to authenticated;

commit;
