# 청사진 뼈대 0081 설계 — 2026-10-13

대표 결정(2026-10-13): «허락 없이 뼈대를 다 만든다. 대표가 나중에 뺀다.» 모든 새 기능은 0073 스위치, 기본 audience 'chairman'.
마이그레이션 하나: `supabase/migrations/0081_blueprint_skeleton.sql`. 0001~0080을 고치지 않는다(create or replace로 기존 함수를 바꾸지 않는다 — 새 함수만).
0035 규칙: 새 표는 RLS enable + **force**(새 표라 처음부터), 정책은 늘 `to authenticated`, 표 직접 쓰기 grant 없음(정의자 함수만), 함수는 public · anon에서 이름으로 회수 · authenticated에만 grant.
**주의(0062 함정):** FORCE RLS 표를 정의자 함수가 읽으려면 그 표에 소유자용 정책이 필요하다 — Supabase postgres는 BYPASSRLS가 아니다. 새 표는 정의자만 읽으므로 `using (true)` 정책을 **두지 않고**,
표에 select grant를 authenticated에 주지 않는다 → 그러면 FORCE는 소유자에게도 걸리므로 소유자 정책이 필요. 해법: 0061 이후 패턴(FORCE 없이 RLS enable + grant 없음)을 따른다 — 0061 · 0064 · 0067 표는 FORCE를 걸지 않았다(설계서 6.2-b 마지막 줄).
→ **결정: 0081 새 표는 0061~0067 원가 표와 같은 결 — RLS enable, FORCE 없음, authenticated grant 없음(정의자 함수로만).** (docs/decisions 한 줄)

## 공통

- 스위치 키(그룹 기본 줄, audience 'chairman', enabled true): `cost_forecast` · `purchase_performance` · `customer_profit` · `margin_bridge` · `competitor_price` · `work_orders` · `product_diagnosis`.
  (⑦ BOM 넣기는 0063 «진짜 BOM 받기» 스위치가 이미 있어 새 키 없음.) `src/lib/features.ts` FEATURES에도 같은 키 · 기본값(check:features가 대조).
- 모든 새 공개 RPC 첫 줄: `if not coalesce(feature_on('<키>', p_business), false) then raise exception 'feature_off' using errcode = '42501'; end if;`
- 역할 판정: `auth_role()`, `is_active()`, `has_business(biz)`, `cost_can(area, biz[, write])`, `cost_grant(...)`. AIAgent · Integration은 늘 거부.
- 원가 값은 `cost_secret.cost_gate_biz`(한도 · 감사 · 겸직 거부 · 영업 0시 기준)를 지난 뒤에만 계산한다. 대표 = 원래 값, 대표 외 = `cost_secret.shown(x, false)`(1원).
- 오류는 없는 것 · 권한 없는 것 모두 `cost_not_found`(P0002). 오류 · NOTICE에 원료 이름 · 값 없음. `raise notice` 금지.
- 원료 이름 · 원료별 값 · BOM 비율 · 원료별 kg · 원료별 단가는 대표(Chairman) 외 새 함수 출력에 **없다**(구매 성과 ②의 구매 · 원가 관리 · CFO는 예외 — 이미 원료 표를 읽는 사람). 0080 기준.
- **Forecast · 구매이익 · 경쟁사 가정은 0075(fin_pl_*) 어디에도 들어가지 않는다** — fin_pl_* 함수를 바꾸지 않고, 새 표를 참조하지 않는다.

## ① Forecast 원가

표
- `cost_market_outlook`(outlook_id identity pk, business_id, material_id → cost_materials, month date(그 달 1일, check day=1), price numeric >0, currency char(3), fx_rate numeric null,
  price_krw_per_kg numeric(트리거로 계산 — cost_fx(currency, month, fx_rate) 재사용), note, created_by default auth.uid(), created_at, voided_at/by/void_reason). 살아 있는 줄 unique(material_id, month).
  쓰기: `cost_outlook_set(p_material, p_month, p_price, p_currency, p_fx, p_note)` — `cost_can('purchasing', biz, true)` 또는 대표. 같은 원료 · 달 살아 있는 줄은 무효 + 새 줄. 감사 'cost_market_outlook'(값 포함 — 구매 자료).
  읽기: `cost_outlook_list(p_business)` — 구매 · 원가 관리 · 대표.
- `cost_forecast_settings`(business_id pk, blend_purchase_pct numeric default 50 check 0~100, fx_mode text 'today'|'manual' default 'today', fx_manual jsonb default '{}'(통화 → 원), updated_by, updated_at).
  쓰기 `cost_forecast_setting_set(biz, blend_pct, fx_mode, fx_manual)` — 대표만. 읽기 `cost_forecast_setting(biz)` — 대표 · 원가 관리.

계산(내부 `cost_secret.forecast_unit(p_material, p_on, p_business) returns numeric` — 원래 값):
- 구매 쪽 P = 그 원료의 가장 최근 살아 있는 구매 LOT(received_on desc, created_at desc): unit_price × fx_now + (freight_krw + duty_krw + other_krw) ÷ qty_kg.
  fx_now = KRW면 1, 아니면 fx_mode='manual'이고 fx_manual에 그 통화가 있으면 그 값, 없으면 `cost_fx(currency, p_on, null)`(오늘 환율). 환율 없으면 P = null.
- 시장 쪽 M = 다음 달(date_trunc('month', p_on) + 1 month) 살아 있는 outlook price_krw_per_kg, 없으면 `cost_secret.unit_price(material, 'market', p_on)`.
- 둘 다 있으면 w × P + (1 − w) × M (w = blend_purchase_pct/100). 하나만 있으면 그 값. 둘 다 없으면 null.
- 제품 Forecast 원료비 = Σ q(m) × forecast_unit(m) (q = kg_per_kg ÷ (yield/100), BOM = `cost_secret.bom_lines_of(cost_secret.version_on(p, d))`). 하나라도 null이면 null(0 금지).
- 총 Forecast = 원료비 + overhead.total(ready일 때; 비용 줄 있는데 not ready면 null, 비용 줄 없으면 원료비만) — 0065 sales_row와 같은 결.

공개 RPC
- `cost_forecast_list(p_business)` → (product_id, product_name, as_of, forecast_material_krw_per_kg, forecast_total_krw_per_kg, computed, reason)
  - 대표 = 원래 값 · 아무 이유 코드(no_bom · price_missing · overhead_not_ready). 원가 관리 = 1원 · 이유는 not_computed 하나. 다른 역할 = cost_not_found.
  - 문: `cost_secret.cost_gate_biz(biz, 'forecast:'||biz, 'costing_list', null)`(하루 20번 · 호출마다 감사 · 겸직 거부). 대표 외는 회사 원료 전부에 forecast_unit이 있을 때만 계산(0062 business_complete와 같은 결 — 하나라도 없으면 그 회사 전 제품 not_computed).

## ② 구매 성과

공개 RPC `purchase_performance(p_business, p_from date, p_to date, p_by text)` p_by ∈ 'lot' · 'material' · 'supplier' · 'month'(기간 ≤ 1100일).
- LOT 한 줄(입고일이 기간 안 · 살아 있는 LOT):
  - 구매 단가(원/kg) = unit_price × fx_rate(LOT에 저장된 값, KRW면 1). **landed가 아니라 물건값**(시장가도 물건값이라서 — 결정).
  - 그날 시장가 = `cost_market_on(material, received_on)` 결이 아니라 직접: received_on 이하 가장 최근 살아 있는 시장가 평균(같은 날 여러 출처 평균). 없으면 null.
  - 절감액 = (그날 시장가 − 구매 단가) × qty_kg. 시장가 없으면 null(«시장가 없음»).
  - 환율 효과 = 외화 LOT만: (LOT fx_rate − 기준 환율) × (unit_price × qty_kg). 기준 환율 = 그 달(입고월) `fx_rates`의 그 통화 평균(0015 표 · 칸 이름은 0015를 보고 맞춘다). 없으면 null. KRW LOT = 0.
- 묶음 합계: 원래 값끼리 더한 뒤 반환(구매 성과는 원가 아님 — 1원 반올림만, `round(x)`).
- 칸: key, label, n_lots, qty_kg, purchase_krw(Σ 구매 단가 × kg), market_krw(Σ 시장가 × kg, 시장가 있는 LOT만), savings_krw, fx_effect_krw, n_no_market.
- 보는 사람: 대표 · `cost_can('purchasing', biz)` · `cost_can('costing', biz)` · GroupCFO(has_business) — **모든 묶음**.
  임원 이상(BusinessCEO · Executive)은 **'month'만**(원료 · 공급처 · LOT 묶음은 cost_not_found — 0080: 일반 권한자는 합계만). 영업 · 생산 줄만 있는 사람 · 그 밖 = cost_not_found.
  단 영업 줄을 가진 사람은 구매 줄이 있어도 이 함수에서 거부하지 않는다(구매 성과에는 제품 원가가 없다).
- 감사: 대표 외 호출마다 audit_log 한 줄(action 'read', entity_table 'cost_purchase_lots', entity_id 'performance:'||biz, 값 없음).
- 화면 문구: «월별 손익에 구매이익을 따로 더하지 않습니다».

## ③ 고객별 수익성

공개 RPC `customer_profit(p_business, p_from, p_to)` — 0067 판매 × `cost_secret.sale_actual`(0067 cost_margins와 같은 실제 원가). **0075 월 매출원가와 섞지 않는다**(판매 한 줄 원가는 0067 그대로 · 결정: 0075는 회사 · 월 합계라 고객으로 못 나눈다).
- 대표 · 원가 관리(`cost_can('costing')`) · GroupCFO: 고객(customer_company)별 n_sales, kg, revenue_krw, cogs_krw, gm_krw, gm_pct(소수 1), grade(cost_grade), n_actual(생산 LOT Actual), n_estimated(Current 추정), n_uncomputed, basis('actual'|'estimated'|'mixed'|'uncomputed'), 대표 외 금액 1원.
  문: cost_gate_biz(biz, 'customers:'||biz, 'costing_list', null). GroupCFO는 cost_can('costing')이 없으면 cost_gate_biz가 거부하므로 **GroupCFO는 costing 줄이 있어야 한다**(결정: 0062 문을 그대로 쓴다 — 구조 덜 바꿈).
- 영업(`cost_can('sales')`, 원가 관리 줄 없음): **본인 판매만**(created_by = auth.uid()) 고객별 n_sales · kg · revenue_krw · grade(가장 최근 판매의 snap_grade)만 — gm · cogs · gm_pct · basis는 null. 문 없음(원가 값을 안 줌) · 감사 없음.
- 그 밖 = cost_not_found.
- 공개 RPC `customer_profit_watch(p_business, p_from, p_to)` — 대표 · 원가 관리만: «매출 큰데 마진 낮은» 상위 10 — 고객과 제품 각각, 기준 = 매출 상위 절반 중 gm_pct 낮은 순(계산된 것만). 칸: kind('customer'|'product'), key, label, revenue_krw, gm_pct, grade.
  (customer_profit과 한 번에 쓰는 화면은 문을 두 번 지난다 — 한도 20번 안.)

## ④ 마진 변동 분해

공개 RPC `margin_bridge(p_business, p_from_a, p_to_a, p_from_b, p_to_b, p_product text default null)` — 대표 · 원가 관리만(그 밖 cost_not_found). 문 cost_gate_biz(biz, 'bridge:'||biz, 'costing_list', null).
- 각 기간(A = 앞, B = 뒤)의 판매(제품 지정 시 그 제품만)에서 kg 가중 평균(원/kg, 원래 값):
  price = Σ kg × 판매가 ÷ Σ kg; material = 판매 한 줄의 원료비(생산 LOT 있으면 Actual 원료비, 없으면 출고일 Current 원료비) kg 가중; mfg · logi · other(= pack + indirect) = 출고일 `cost_secret.overhead` 묶음 kg 가중.
  원가가 계산 안 되는 판매는 두 기간 모두 빼고 n_excluded로 센다.
- gm_per_kg = price − material − mfg − logi − other. 변화 Δgm = Δprice − Δmaterial − Δmfg − Δlogi − Δother(**정확히** — 원래 값).
- 반환(한 줄 jsonb 또는 table): a{price,material,mfg,logi,other,gm,gm_pct,kg,n}, b{…}, effects{price: +Δprice, material: −Δmaterial, mfg: −Δmfg, logi: −Δlogi, other: −Δother}, total = Δgm, material_pct(원료비 변화율 %, 소수 1),
  n_excluded, reason(«자료 없음 · 필요한 것: 두 기간 판매 · 원가»).
  - 대표 외: 모든 원/kg 값 1원 — **효과 다섯을 반올림한 뒤 가장 큰 절댓값 하나에 차이를 몰아 합 = 반올림한 total**(합이 정확히 맞게). 원료별 없음.
  - 대표: 원래 값 + `materials`: 원료별 기여(원료 이름 · Δ원/kg, 제품 지정 시 그 제품 BOM의 원료별 q × Δ단가 — 출고일 Current 기준, 상위 10). 제품 미지정이면 materials = null.
- 대시보드 한 줄은 앱이 이 결과로 코드로 만든다(AI 금지): «이번 달 마진이 X원/kg 떨어졌습니다 — 가장 큰 이유: 원료비(+4.2%)».

## ⑤ 경쟁사 가정

표 `cost_competitor_assumptions`(business_id, product_id null = 회사 기본, mfg_krw_per_kg numeric null, logi_krw_per_kg numeric null, margin_pct numeric null check 0~60, note, updated_by, updated_at, unique(business_id, coalesce(product_id,''))).
null 칸 = «우리 값»(제조 = 우리 overhead.mfg, 물류 = 우리 overhead.logi, 마진 = 15).
- 쓰기 `competitor_assumption_set(biz, product, mfg, logi, margin, note)` — 대표 · `cost_can('costing', biz, true)`. 감사(값 포함 — 가정은 원가 아님).
- 읽기 `competitor_assumption_list(biz)` — 대표 · 원가 관리.
- `competitor_price(p_product)` → (product_id, competitor_min_krw_per_kg, our_target_krw_per_kg(20% 제시가), our_margin_at_competitor_pct, grade_at_competitor, computed)
  - 경쟁사 예상 원가 = Market 원료비(`material_cost(p,'market',d)`) + 경쟁사 제조 + 경쟁사 물류. 예상 최소가 = 원가 ÷ (1 − margin/100).
  - 우리 목표가 = 우리 총원가(0065 sales_row total_raw) ÷ 0.8. 경쟁사 최소가로 팔 때 우리 마진 % = (최소가 − 우리 총원가) ÷ 최소가 × 100, 등급 cost_grade.
  - 문: `cost_secret.cost_gate(p_product, 'competitor', null)`(영업 0시 기준 · 200건 · 감사 · 겸직 거부). 대표 외 1원 · 대표 외 회사 완전성(business_complete market · current) 아니면 computed false.
  - 영업은 **결과만**(위 칸들) — 가정 값 · 원가 값을 돌려주지 않는다. 영업 제시가는 이미 1원 단위로 받는 값이라 새 노출 없음.

## ⑥ 작업지시

표 `cost_work_orders`(order_id pk → cost_production_orders, tank text(≤40) null, seq int null, assignee uuid null → profiles? (FK 없이 uuid), hide_names boolean not null default true, updated_by, updated_at).
- 쓰기 `work_order_set(p_order, p_tank, p_seq, p_assignee, p_hide_names)` — 대표만. 감사.
- 읽기 `work_order_get(p_order)` → 머리(order_id, product_name, planned_on, planned_kg, status, tank, seq, hide_names) + 줄(code, material_name(hide_names면 null — **대표는 늘 보임**), batch_kg = 0064 order_lines.planned_kg) + 투입(prod_lot_id, code, qty_kg, created_at — 0064 cost_prod_inputs 살아 있는 줄).
  - 원료 코드 = 'R-' || upper(substr(md5(material_id), 1, 6)) (원료 id slug에 이름이 들어 있어 id를 그대로 보이지 않는다).
  - 볼 수 있는 사람: 대표 · `cost_can('production', biz)` **이고 assignee = auth.uid()**. 남의 오더 · 담당자 없는 오더 = cost_not_found.
  - BOM 비율 · 수율 · 원료 단가 · 원료 id를 돌려주지 않는다.
- `work_order_mine(p_business)` — 본인 담당 오더 목록(order_id, product_name, planned_on, planned_kg, status, tank, seq). 대표는 전부.
- 결정: 0064 표 정책(생산은 order_lines 직접 select)은 고치지 않는다(0001~0080 불변) — «본인 오더만»은 새 함수 · 새 화면에서. DEFERRED에 «0064 order_lines 직접 select를 담당자로 좁히기».

## ⑦ 진짜 BOM 넣기

DB 없음(0063 · 0068 있음). 화면 /costs/<회사>/bom/import + 문서만.

## ⑧ 제품 진단

공개 RPC `product_diagnosis(p_product)` returns jsonb `{product_id, product_name, role: 'chairman'|'costing'|'sales', as_of, cards: [{id: 1..11, key, state: 'ok'|'no_data', value…, need: '필요한 것'}]}`.
역할별 카드(목록에 없는 카드는 **배열에 넣지 않는다** — 화면은 받은 카드만 그린다):
| 카드 | 대표 | 원가 관리 | 영업 |
|---|---|---|---|
| 1 Actual(최근 생산 LOT Actual 원/kg — 0064 식) | O 원래 | O 1원 | — |
| 2 Current 총원가 | O | O | — |
| 3 Market 원료비 | O | O | — |
| 4 구매 절감(최근 90일 — 이 제품 BOM 원료의 LOT 절감 합) | O | — (BOM 소속이 샌다) | — |
| 5 경쟁사보다 싸게 팔아도 남는가(competitor_price) | O | O | O |
| 6 최소 판매가(총원가 ÷ 0.85) | O | O | O(1원 — 이미 제시가로 받는 값) |
| 7 20% 마진 가격(총원가 ÷ 0.8) | O | O | O |
| 8 상위 고객(최근 90일 매출 상위 5 — 고객 · 매출 · kg) | O | O | 본인 판매만(매출 · kg) |
| 9 매출 대비 마진 순위(회사 제품 중 매출 순위 · GM 순위) | O | O | — |
| 10 마진 하락 이유(이번 달 vs 지난달 margin_bridge 제품 지정 — 가장 큰 효과 이름 · 원/kg) | O(원료별 1위 포함) | O(묶음) | — |
| 11 원가 상승 최대 영향(대표: 7일 전 대비 Δ원/kg 가장 큰 원료 이름 · 값 / 원가 관리: 묶음 · 원료 합계 %) | O | O | — |
- 자료가 없으면 state 'no_data' + need(예: «생산 LOT 기록», «경쟁사 가정», «판매 기록 2개월»). 0을 넣지 않는다.
- 문: cost_secret.cost_gate(p_product, 'diagnosis', null) 한 번(영업 0시 · 200건 · 감사 · 겸직 거부). 구매 · 생산 = cost_not_found.
- 추이 `product_trend(p_product, p_grain 'day'|'week'|'month'|'quarter'|'year', p_from, p_to)` — 대표 · 원가 관리만: 기간마다 판매가(kg 가중) · Actual(그 기간 생산 LOT 산출 가중) · Market 원료비(기간 끝 날) · GM%. 문 한 번. 최대 400점.

## 시험 check:blueprint (scripts/check-blueprint.ts, PGlite — check-material-lock.ts · check-cost-engine.ts 하네스를 본뜬다)
1. Forecast가 0075에 안 섞임: 0081 본문에 fin_pl 없음(정적) + fin_pl_* 함수 정의가 0081 전후 같음(pg_proc prosrc 비교) + outlook 넣기 전후 fin_pl_month 같은 결과(가능하면).
2. 절감액 · 환율 효과: dummy LOT(USD 2.00/kg × 1,000kg, fx 1,400, 그달 fx_rates 평균 1,380, 그날 시장가 2,900원/kg) → 구매 단가 2,800 · 절감 100,000원 · 환율 효과 (1400−1380)×2000 = 40,000원 — 손계산과 1원 일치.
3. 분해 합 = 전체 변화(대표 원래 값 · 원가 관리 1원 둘 다).
4. 영업에게 마진 · 원료 노출 0: customer_profit 영업 결과에 gm 칸 null · 남의 판매 0, competitor_price 결과 칸에 원료 없음, margin_bridge · purchase_performance · cost_forecast_list · product_trend 영업 = cost_not_found, product_diagnosis 영업 카드 = 5 · 6 · 7 · 8만.
5. 생산: work_order_get 남의 오더 = cost_not_found, 본인 오더 줄에 원료 이름 null(hide 기본) · 원료 id · 비율 없음, BOM 함수 거부.
6. BOM 넣기 대표만: cost_bom_save · cost_bom_real_allow 대표 외 거부(0063 재확인).
7. 제품 진단 역할별 카드 집합(대표 11 · 원가 관리 10(4 없음) · 영업 4).
8. 스위치: 기본 audience chairman → 원가 관리 호출 = feature_off. 시험은 feature_switch_set으로 'all'로 연 뒤 역할 시험.
9. 정적: 0081에 raise notice 없음 · grant to anon 없음 · 새 정책 to authenticated · src/lib/ai/**에 새 함수 이름 없음.
