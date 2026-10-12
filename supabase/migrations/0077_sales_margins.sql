-- =====================================================================
-- Chairman OS — 0077_sales_margins (PHASE 5 «0067 화면 — 판매 실적 · 마진»: 스위치 문 두 개)
-- 작성: 2026-10-13 · 자율 블록 PHASE 5 · 원문 docs/specs/2026-10-12-autonomous-block-phases.txt · 결정 docs/decisions/2026-10-12-autonomous.md
--
-- ■ 왜 ■ 0067은 표 · 함수만 두고 화면이 없다. 화면 두 개(/sales/<회사>/deals · /costs/<회사>/margins)를 붙이며
--   기능 스위치 'sales_margins'(0073 · 기본 대표만)를 **RPC에서도** 지킨다. 0067은 고치지 않는다 — 감싸는 함수만 더한다.
--
-- ■ 무엇 ■
--   1. sales_deals(회사, 시작, 끝) — 영업 실적 목록. 보이는 줄 = 0067 sale_visible(본인 · 같은 회사 영업 팀장 subtree · 대표 · 겸직 거부).
--      돌려주는 칸 = 출고일 · 고객 · 제품 · kg · 판매가(원/kg) · 통화 · 매출(kg × 판매가, 1원) · 등급(기록 순간 0시 기준 snap_grade) · 견적 연결 · 본인 여부.
--      **실제 원가 · 실제 마진 · 0시 총원가 · 0시 마진 %는 돌려주지 않는다**(등급만 — 노출이 적은 쪽).
--   2. sales_margins(회사, 시작, 끝, 묶음 크기, 묶음) — 0067 cost_margins를 그대로 부른다(대표 원래 값 · 원가 관리 1원 · 하루 20번 ·
--      호출마다 감사 · 겸직 거부 — 0067 cost_gate_biz). 더하는 것:
--        · 매출(revenue_krw)도 대표 외 1원(0067 리뷰 M2 — 원래 값끼리 더한 뒤 1원).
--        · pl_closed · cost_basis — 그 묶음의 달(일 · 주 · 월 · 분기 · 년이 걸치는 모든 달)이 0075 fin_pl_closes에서 내부 마감 확정이면
--          'closed_month'(«확정 매출원가 기준»), 아니면 'provisional'(«잠정 대체원가» — 0067이 조회 때 계산 · 저장 안 함).
--          판매 한 줄 원가 자체는 0067 그대로(생산 LOT Actual · 없으면 출고일 Current) — 월 매출원가와 섞지 않는다(0075 경고와 같은 말).
--   두 함수 모두 첫 줄에서 feature_on('sales_margins', 회사) — 꺼지면 'feature_off'(대표 포함).
--   0067 cost_margins 직접 부르기는 그대로 둔다(같은 사람 · 같은 문 · 같은 한도 — 결정 표 · DEFERRED).
--
-- 0035 규칙: 0001~0076을 고치지 않는다 · 표를 만들지 않는다 · FORCE를 새로 걸거나 끄지 않는다. 함수는 public · anon에서 이름으로 회수 · authenticated에만.
-- =====================================================================

begin;

-- =====================================================================
-- 1절. 영업 실적 목록(원가 · 마진 없음)
-- =====================================================================
create or replace function sales_deals(p_business text, p_from date, p_to date)
returns table (sale_id text, shipped_on date, customer_company text, customer_name text, product_name text, kg numeric,
               price_krw_per_kg numeric, currency text, revenue_krw numeric, grade text, grade_as_of date, quote_id text, mine boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
begin
  if not coalesce(feature_on('sales_margins', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if p_business is null or p_from is null or p_to is null or p_from > p_to or p_to - p_from > 1100 then
    raise exception 'cost_invalid' using errcode = '22023';
  end if;
  return query
  select s.sale_id, s.shipped_on, s.customer_company, s.customer_name, s.product_name, s.kg, s.price_krw_per_kg, s.currency,
         round(s.kg * s.price_krw_per_kg), s.snap_grade, s.snap_as_of, s.quote_id, s.created_by = auth.uid()
    from cost_sales s
   where s.business_id = p_business and s.voided_at is null and s.shipped_on between p_from and p_to
     and sale_visible(s.sale_id)
   order by s.shipped_on desc, s.created_at desc
   limit 2000;
end;
$fn$;

-- =====================================================================
-- 2절. 견적 마진 vs 실제 마진(대표 · 원가 관리) — 0067 cost_margins + 매출 1원 + 월 마감 표시
-- =====================================================================
create or replace function sales_margins(p_business text, p_from date, p_to date, p_grain text default 'month', p_by text default 'product')
returns table (period_start date, key text, label text, n_sales int, n_uncomputed int, kg numeric, revenue_krw numeric,
               cost_krw numeric, margin_krw numeric, margin_pct numeric, grade text,
               quote_kg numeric, quote_margin_krw numeric, quote_margin_pct numeric,
               sale_id text, shipped_on date, customer text, product_name text, price_krw_per_kg numeric, currency text,
               cost_source text, cost_krw_per_kg numeric, quote_id text, quote_price_krw_per_kg numeric, quote_cost_krw_per_kg numeric,
               pl_closed boolean, cost_basis text)
language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
#variable_conflict use_column
declare
  v_chair boolean := coalesce(auth_role()::text, '') = 'Chairman';
  v_span  interval;
begin
  if not coalesce(feature_on('sales_margins', p_business), false) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  -- 묶음 하나가 걸치는 마지막 달까지의 거리(deal · day · month = 그 달 하나 · week = 6일 뒤 달까지).
  v_span := case when p_by = 'deal' then interval '0' else
              case p_grain when 'week' then interval '6 days' when 'quarter' then interval '2 months' when 'year' then interval '11 months' else interval '0' end end;
  return query
  with m as (select * from cost_margins(p_business, p_from, p_to, p_grain, p_by)),
  closed as (select c.period from fin_pl_closes c where c.business_id = p_business and c.status = 'final' and c.superseded_at is null)
  select m.period_start, m.key, m.label, m.n_sales, m.n_uncomputed, m.kg,
         case when v_chair then m.revenue_krw else round(m.revenue_krw) end,
         m.cost_krw, m.margin_krw, m.margin_pct, m.grade, m.quote_kg, m.quote_margin_krw, m.quote_margin_pct,
         m.sale_id, m.shipped_on, m.customer, m.product_name, m.price_krw_per_kg, m.currency,
         m.cost_source, m.cost_krw_per_kg, m.quote_id, m.quote_price_krw_per_kg, m.quote_cost_krw_per_kg,
         pc.ok, case when pc.ok then 'closed_month' else 'provisional' end
    from m
    cross join lateral (
      select coalesce(bool_and(to_char(x, 'YYYY-MM') in (select period from closed)), false) as ok
        from generate_series(date_trunc('month', m.period_start::timestamp), date_trunc('month', m.period_start::timestamp + v_span), interval '1 month') x
    ) pc
   order by m.period_start desc, m.label;
end;
$fn$;

-- =====================================================================
-- 3절. 함수 권한
-- =====================================================================
revoke all on function sales_deals(text, date, date) from public, anon;
revoke all on function sales_margins(text, date, date, text, text) from public, anon;
grant execute on function sales_deals(text, date, date) to authenticated;
grant execute on function sales_margins(text, date, date, text, text) to authenticated;

commit;
