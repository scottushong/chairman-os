-- =====================================================================
-- Chairman OS — 0091_finance_auto (재무 — 자동 판단 · 버튼 없음)
-- 작성: 2026-10-20 · 결정 docs/decisions/2026-10-20-finance-auto.md
--
-- ■ 왜 ■ (대표 지시 2026-10-20 «0091 재무 — 자동 판단, 버튼 없음»)
--   자료가 들어오면 시스템이 정한다 — 재공품 · 완제품 평가(실측 · 추정 · 이월) · 귀속월(N월분 · 기간 · 연납) · 중복(법인카드 쪽 제외) ·
--   원금/이자 출처. 사람에게 고르라고 하지 않는다. 틀리면 파일을 빼거나 숫자를 고친다.
--   자동 판단 자체는 앱이 화면을 열 때마다 원천에서 다시 계산한다(lib/finance-overview/auto.ts — 저장하지 않는다).
--   DB에 두는 것은 **사람이 고친 것**뿐이다: 평가금액 고치기 · 귀속월 달 고치기 · 원래 날짜로 되돌리기 · 중복 되살리기 · 자동으로 돌리기.
--   원장 원본(fin_ledger_lines · fin_card_lines · 전표)은 고치지 않는다 — 손익 · 지표만 이 기록을 덮어 계산한다.
--
-- ■ 더하는 것 ■ (앞 번호 파일 · 함수는 고치지 않는다 · 0090은 다른 블록 몫으로 비워 둔다)
--   1절 fin_auto_fixes — 고친 기록(덧붙이기만 · 지우지 않음). 같은 (회사, 규칙, 자리)는 마지막 줄이 이긴다. 누가(uid · 그때 이름) · 언제 · 전값.
--        읽기는 장부를 읽는 사람(can_read_books) · 쓰기는 fin_auto_fix만(장부를 쓰는 사람 · 사람 세션 · 스위치 켜짐).
--   2절 기능 스위치 finance_auto(기본 전원) — 끄면 자동 판단을 하지 않고 0089까지의 계산 그대로(평가는 앞 달 3달 이월 · 귀속 · 중복 없음).
--
-- 0035 규칙: force를 새로 걸지 않는다 · FORCE를 내리지 않는다 · 0001~0089를 고치지 않는다. 새 정책 · grant는 늘 to authenticated.
-- 정의자 함수는 auth.uid()가 없으면(익명 · service) 거부한다.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 사람이 고친 것
-- =====================================================================
create table fin_auto_fixes (
  fix_id          bigint generated always as identity primary key,
  business_id     text not null references businesses(business_id) on delete restrict,   -- [일반]
  rule            text not null check (rule in ('valuation', 'period', 'duplicate')),       -- [일반] 1 평가 · 2 귀속월 · 3 중복 (4 원금/이자는 고칠 것 없음 — 파일로)
  item_key        text not null check (length(item_key) between 3 and 200),                 -- [일반] 자리(앱이 만든 내용 열쇠 — 평가는 «달:wip|finished»)
  period          text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),             -- [일반] 다시 계산할 첫 달
  action          text not null check (action in ('value', 'month', 'keep_date', 'restore', 'auto')),  -- [일반]
  value           jsonb,                                                                    -- [일반] value {amount} · month {to}
  prev            jsonb,                                                                    -- [일반] 고치기 전 화면 값(전값 기록)
  created_by      uuid not null default auth.uid(),
  created_by_name text,
  created_at      timestamptz not null default now(),
  constraint fin_auto_fixes_rule_action check (
    (rule = 'valuation' and action in ('value', 'auto'))
    or (rule = 'period' and action in ('month', 'keep_date', 'auto'))
    or (rule = 'duplicate' and action in ('restore', 'auto'))
  ),
  constraint fin_auto_fixes_value_shape check (
    (action = 'value' and jsonb_typeof(value -> 'amount') = 'number')
    or (action = 'month' and coalesce(value ->> 'to', '') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    or (action in ('keep_date', 'restore', 'auto') and value is null)
  )
);
create index fin_auto_fixes_biz on fin_auto_fixes (business_id, rule, item_key, fix_id desc);
comment on table fin_auto_fixes is
  '0091. 재무 자동 판단을 사람이 고친 기록(덧붙이기만). 같은 (회사, 규칙, 자리)는 마지막 줄이 이긴다. 원장 원본은 고치지 않는다. 쓰기는 fin_auto_fix만.';
alter table fin_auto_fixes enable row level security;
revoke all on table fin_auto_fixes from public, anon, authenticated;
grant select on table fin_auto_fixes to authenticated;
create policy fin_auto_fixes_read on fin_auto_fixes for select to authenticated using (can_read_books(business_id));

/**
 * 고치기 한 줄 — 장부를 쓰는 사람(사람 세션 · AI Agent · 연동 아님) · 스위치 finance_auto 켜짐. 금액은 0 이상 1조 미만 정수.
 * 그 달부터 다시 계산 큐에 넣고 감사 기록을 남긴다. 돌려주는 값 = fix_id.
 */
create or replace function fin_auto_fix(p_business text, p_rule text, p_key text, p_period text, p_action text, p_value jsonb, p_prev jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id bigint;
  v_name text;
  v_amount numeric;
begin
  if auth.uid() is null or auth_role()::text in ('AIAgent', 'Integration') or not coalesce(can_keep_books(p_business), false) then
    raise exception 'fin_auto_denied' using errcode = '42501';
  end if;
  if not feature_on('finance_auto', p_business) then
    raise exception 'fin_auto_off' using errcode = '42501';
  end if;
  if p_action = 'value' then
    v_amount := (p_value ->> 'amount')::numeric;
    if v_amount is null or v_amount < 0 or v_amount >= 1e12 or v_amount <> trunc(v_amount) then
      raise exception 'fin_auto_shape' using errcode = '22023';
    end if;
  end if;
  if p_prev is not null and (jsonb_typeof(p_prev) <> 'object' or length(p_prev::text) > 500) then
    raise exception 'fin_auto_shape' using errcode = '22023';
  end if;
  select display_name into v_name from user_profiles where user_id = auth.uid();
  begin
    insert into fin_auto_fixes (business_id, rule, item_key, period, action, value, prev, created_by, created_by_name)
    values (p_business, p_rule, p_key, p_period, p_action, p_value, p_prev, auth.uid(), left(v_name, 60))
    returning fix_id into v_id;
  exception when check_violation or not_null_violation or invalid_text_representation then
    raise exception 'fin_auto_shape' using errcode = '22023';
  end;
  perform fin_recalc_enqueue(p_business, p_period, 'manual');
  insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
  values ('update'::audit_action, 'fin_auto_fixes', v_id::text, p_business, auth.uid(), auth_role()::text,
          jsonb_build_object('rule', p_rule, 'key', p_key, 'action', p_action, 'value', p_value, 'prev', p_prev),
          '재무 자동 판단 고치기(0091): ' || p_rule || ' · ' || p_action);
  return v_id;
end;
$fn$;

revoke all on function fin_auto_fix(text, text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function fin_auto_fix(text, text, text, text, text, jsonb, jsonb) to authenticated;

-- =====================================================================
-- 2절. 기능 스위치
-- =====================================================================
insert into feature_switches (business_id, feature_key, enabled, audience, reason) values
  (null, 'finance_auto', true, 'all', '기본값(0091)')
on conflict do nothing;

commit;
