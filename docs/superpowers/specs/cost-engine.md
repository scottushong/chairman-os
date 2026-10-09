# 원가 엔진(Secret BOM) 설계서 — 2026-10-09 1차

브랜치 `feat/cost-engine`(master d637059에서). 이 문서가 입구 설계서(`feat/intake` · `docs/superpowers/specs/2026-10-06-intake-and-purchasing.md`)의
**«C. 구매 모듈» · «D. 0059_purchasing» · «E. 블록 4~6»을 대체**한다(아래 12절 연결 메모).

> **용어.** 이 문서의 «대표»는 직원 화면 용어 그대로 **Chairman 역할 한 사람**(0059 결재 «상사 사슬 → 대표»의 그 대표)이다.
> 회사 대표이사(BusinessCEO 역할)는 «회사 대표»로 따로 적는다 — 회장 결정상 BOM은 회사 대표도 못 본다.
> «Vault»가 두 번 나온다: ① chairman-os 문서 등급 Vault(사내 최고 등급, 파일 실체를 받지 않음) ② Supabase Vault(DB 안 비밀 금고).
> ②는 늘 «Supabase Vault»라고 적는다.

---

## 0. 회장 결정(구속) · 이 설계가 지키는 것

1. BOM · BOM 비율 · 제품별 원료 구성 = **대표만** 열람 · 편집. 임원 · 회사 대표 포함 그 외 전원 불가. 나중에 넓힐 수 있게(`cost_secret.bom_access`, 비어 있음).
2. BOM 원본은 R2(자체 ERP). 진짜 BOM은 **BOM 암호화(7절)가 운영에 들어가기 전까지 입력 금지** — 개발 · 시험은 가짜 BOM만.
3. BOM은 어떤 AI 도구 · 요약 · 어시스턴트 · 입구 분류에도 보내지 않는다(8절 — 구조로 막는다).
4. 주 = 월요일 시작 ISO 주. 모든 숫자는 **일 단위**로만 저장, 주 · 월 · 분기 · 년은 합산 뷰(저장 금지).
5. 원가 4종 Actual · Current · Market · Forecast(4절). 판매가 = 총원가 ÷ (1 − 목표마진율). GM ≥ 20% Green · 15~20% Yellow · < 15% Red → 0059 결재.
6. 견적 시점 원가 스냅샷은 견적과 함께 영구 · 수정 불가 · 감사.
7. 승인된 구매 결재(0059 · 구입처 · 링크 · 금액) → 구매 LOT 후보.
8. 금액 · 수량 numeric, 기본 단위 kg, 환율은 0015 `fx_rates`(USD→KRW 등, rate = 1 base당 quote).

---

## 1. 일곱 모듈과 데이터 흐름

```
              ┌────────────── 0059 결재(구매 품의 승인) ──────────────┐
              ▼                                                        │
 [1 Purchase Intelligence]  원료 마스터 · 공급처 · 시장가격(일) · 구매/입고 LOT(Landed Cost)
              │  LOT 단가(원/kg)                        │ 시장가(원/kg)
              ▼                                          ▼
 [3 Production & LOT Traceability]  생산 오더 → 생산 LOT ← 투입 원료 LOT · 수량(kg)
              │  실제 투입                                │
              ▼                                          │
 [2 Secret BOM Engine] (cost_secret 스키마 · 대표만) ────┤  제품별 kg당 원료 투입량(비공개)
              │  합계만 나간다(반올림)                     │
              ▼                                          ▼
 [4 Cost Engine]  Actual · Current · Market · Forecast  +  비용 마스터(일) · 배부 기준 → 총원가(원/kg)
              │
              ▼
 [5 Pricing Engine]  판매가 = 총원가 ÷ (1 − 목표마진) · GM 신호 · 견적(+스냅샷) → Red는 0059 결재
              │
              ▼
 [6 Finance Engine]  판매 실적 × 실제원가 → 매출원가 · 견적 마진 vs 실제 마진 → 전표 초안(자체 장부)
              │
              ▼
 [7 Executive Dashboard]  대표: 원가 4종 추이 · 원료비 영향 · 마진 신호 · 견적/실적 차이(일→주→월→분기→년)
```

| # | 모듈 | 주인(입력) | 핵심 표 | 이번 1차 |
|---|---|---|---|---|
| 1 | Purchase Intelligence | 구매 | `cost_materials` · `cost_suppliers` · `cost_market_prices` · `cost_purchase_lots` | **DB + 화면** |
| 2 | Secret BOM Engine | 대표 | `cost_secret.products_bom` · `cost_secret.bom_lines` | **DB(가짜 BOM)** · 암호화 자리만 |
| 3 | Production & LOT | 생산 | `cost_production_orders` · `cost_production_lots` · `cost_lot_inputs` | 설계만 |
| 4 | Cost Engine | 경영지원 | 함수 `cost_product_cost` · `cost_product_breakdown` · 비용 마스터 | **Market · Current 함수 1차** |
| 5 | Pricing Engine | 영업 | `cost_quotes` · `cost_quote_snapshots` | 설계만 |
| 6 | Finance Engine | 경영지원 | `cost_sales` · 전표 초안 | 설계만 |
| 7 | Executive Dashboard | 대표 | 뷰 | 설계만 |

---

## 2. 표 설계

이름 앞에 `cost_`를 붙인다(공개 스키마의 다른 표와 섞이지 않게). 금액 `numeric(20,4)`, 수량 `numeric(20,4)` kg, 비율 `numeric(12,8)`.
모든 표: RLS enable + **force**, `created_by uuid default auth.uid()`, `created_at timestamptz default now()`. 고치지 않는 기록(가격 · LOT · 스냅샷)은
update 권한을 «무효 칸»에만 준다(틀리면 무효 + 새 줄 — 0015 원장 · 입구 설계서 단가 이력과 같은 결).

### 2.1 원료 마스터 `cost_materials` (회사별)
`material_id text pk`('mat_' + slug) · `business_id` → businesses · `name` · `name_norm`(소문자 · 공백 제거, unique(business_id, name_norm)) · `spec` ·
`base_unit text default 'kg'`(1차는 kg만 허용 — check) · `category`(주원료 · 부원료 · 포장재 …) · `active` · `note`.
**배합 · 비율 칸은 없다.** 원료가 어느 제품에 들어가는지도 이 표에 없다(그것은 BOM이다).

### 2.2 공급처 `cost_suppliers` (회사별)
`supplier_id text pk` · `business_id` · `name` · `country` · `currency_default char(3)` · `contact`([제한]) · `terms`([제한] 결제 · 인도 조건) · `active` · `note`.

### 2.3 시장가격 이력 `cost_market_prices` (일 단위)
`price_id bigint identity pk` · `business_id` · `material_id` · `observed_on date` · `price numeric(20,4) >0` · `currency char(3)` · `unit`('kg') ·
`fx_rate numeric(18,6)`(KRW 아닌 통화일 때 그날 환율 — 비우면 `fx_rates`에서 찾는다) · `price_krw_per_kg numeric(20,4)`(저장 시 계산 · 트리거) ·
`source_name`(예: «Platts» · «거래처 시세 문자» · «구매팀 조사») · `source_url` · `voided_at/by/reason`.
unique(material_id, observed_on, source_name) where voided_at is null — 같은 날 같은 출처는 한 값.

### 2.4 구매 · 입고 LOT `cost_purchase_lots` — Landed Cost
`lot_id text pk`('PL-YYYYMMDD-nnn' — 사람이 읽는 키) · `business_id` · `material_id` · `supplier_id` · `received_on date`(입고일 = 원가 기준일) ·
`ordered_on date` · `supplier_lot_no` · `qty_kg numeric >0` ·
`unit_price numeric >0` · `currency char(3)` · `fx_rate numeric(18,6)`(KRW면 1) ·
`freight_krw` · `duty_krw` · `other_krw`(부대비: 통관 · 보험 · 검사 · 하역) — 전부 ≥ 0, 원화 금액 ·
**`landed_krw_per_kg` = (unit_price × qty × fx_rate + freight + duty + other) ÷ qty**(저장 시 트리거로 계산 — 고칠 수 없음) ·
`source`('approval' | 'manual' | 'import') · `source_ref`(decision_id) · `voided_*`.
unique(source_ref) where source='approval' and voided_at is null — 결재 한 건은 LOT 하나로만.

### 2.5 재고 LOT 잔량 — 저장하지 않는다
`cost_lot_balances` **뷰** = 입고 qty − Σ 투입(`cost_lot_inputs`) − Σ 조정(`cost_lot_adjustments`: 폐기 · 실사 차이, 일 단위 · 이유 필수). 잔량을 표에 적지 않는다(일 원자료 원칙).

### 2.6 제품 마스터 `cost_products` (공개 스키마 — 이름만)
`product_id text pk` · `business_id` · `name` · `name_norm` · `sku` · `unit`('kg') · `pack_kg`(포장 단위) · `active`.
**여기에는 원료가 하나도 없다.** 영업 · 경영지원이 보는 제품 목록은 이 표다.

### 2.7 BOM(비공개) — `cost_secret` 스키마
```
cost_secret.bom_versions(version_id bigint identity pk, product_id text not null → public.cost_products,
   valid_from date not null, yield_pct numeric(7,4) not null default 100 (투입 대비 산출, 100 = 손실 없음),
   note text, is_fake boolean not null,   -- 1차는 true만 허용(check) — 진짜 BOM 입력 금지(회장 결정 2)
   payload_enc bytea,                      -- 7절 암호화 자리. 1차는 null(check: is_fake면 null 허용)
   created_by uuid, created_at, voided_at, voided_by, void_reason,
   unique(product_id, valid_from) where voided_at is null)
cost_secret.bom_lines(version_id → bom_versions, material_id text → public.cost_materials,
   kg_per_kg numeric(12,8) not null check (> 0),   -- 제품 1kg을 만드는 데 드는 그 원료 kg(손실 포함 전)
   primary key(version_id, material_id))
cost_secret.bom_access(user_id uuid pk, can_read bool, can_write bool, granted_by, granted_at)  -- 1차: 비어 있음 · 쓰는 길 없음(넓힐 자리)
cost_secret.cost_reads(…)  -- 원가 조회 감사(아래 6.4) — 공개 audit_log에도 한 줄
```
- `cost_secret` 스키마: `revoke all on schema cost_secret from public, anon, authenticated` · 표마다 `revoke all` · PostgREST 노출 스키마
  (`supabase/config.toml` `schemas = ["public","graphql_public"]`)에 **넣지 않는다** — 일반 사용자의 select 경로 0개.
- BOM을 쓰고 읽는 길은 `public`의 security definer 함수뿐이고, 함수 첫 줄이 «대표(또는 bom_access)인가»를 판정한다(6절).
- 1차에서 `bom_lines`는 평문이다 — **가짜 BOM만**(check `is_fake`). 7절 암호화가 들어오면 `bom_lines`를 비우고 `payload_enc`(원료 목록 + 비율 통째)로 옮긴다.

### 2.8 생산 (설계만 — 다음 블록)
`cost_production_orders`(order_id · business_id · product_id · planned_on · planned_kg · status) — **작업지시 수량**: 생산이 받는 것은 «원료 X를 몇 kg»
목록이다. 이 목록은 대표가 지시를 «발행»할 때 함수가 BOM × 계획량으로 만든 **그 한 번의 수량 목록**이고 비율이 아니다(권한 표 «X(작업지시 수량만)»).
`cost_production_lots`(prod_lot_id · order_id · product_id · produced_on · output_kg) ·
`cost_lot_inputs`(prod_lot_id · purchase lot_id · kg) — 실제 투입. Actual 원가의 원천.
역산 주의: 한 오더의 «원료별 kg ÷ 계획 kg» = 비율이다. 생산은 그것을 본다 — 회장 결정 «X(작업지시 수량만)»의 잔여 위험(9.3).

### 2.9 비용 마스터 `cost_overheads` · 배부 기준 (설계만)
`cost_overheads`(overhead_id · business_id · category · amount_krw · period_from date · period_to date · basis · note · voided_*)
- category: 인건비 · 전기 · 가스 · 감가상각 · 임대 · 포장 · 팔레트 · 물류 · 창고 · 보험 · QC · 폐기Loss · 금융비용 · 커미션 · 기타.
- 금액은 **기간 총액**으로 넣고, 뷰가 일할(÷ 일수)로 펼친다 — 저장은 입력 그대로 한 줄(월 데이터를 따로 만들지 않는다).
- basis: `per_kg`(그 기간 생산 kg으로 나눔) · `per_batch`(생산 LOT 수로 나눔) · `per_product`(특정 제품 직접) · `pct_of_price`(커미션 — 가격식으로).
- 적용 시작일 = period_from. 바뀌면 새 줄(앞 줄 period_to를 닫음).

### 2.10 원가 스냅샷 · 견적 · 판매 (설계만)
`cost_quotes`(quote_id · business_id · customer · product_id · qty_kg · price_krw_per_kg · target_margin · status · decision_id(Red) · created_by)
`cost_quote_snapshots`(quote_id pk → cost_quotes · taken_at · kinds jsonb{actual,current,market,forecast: 원/kg 반올림} · overhead_krw_per_kg ·
  total_krw_per_kg · gm_pct · signal · method_version) — **insert만, update · delete 권한 없음 + 트리거로 막음**, 감사 한 줄.
`cost_sales`(sale_id · business_id · sold_on · customer · product_id · qty_kg · price_krw_per_kg · quote_id? · prod_lot_ids text[]) — ECOUNT · 수기에서.

---

## 3. 권한 — 서버 · DB에서 강제

### 3.1 모듈 키(0047 · 0048 방식, 사람 × 회사)
| 키 | 화면 이름 | can_write | can_approve |
|---|---|---|---|
| `'/purchasing/<biz>'` | 구매 입력 | 원료 · 공급처 · 시장가 · LOT 입력 · 결재 후보 처리 | — |
| `'/production/<biz>'` | 생산 입력 | 생산 LOT · 투입 기록 | — |
| `'/sales/<biz>'` | 영업 견적 | 견적 만들기 · 시뮬레이터 | — |
| `'/costing/<biz>'` | 원가 관리 | 비용 마스터 · 배부 · 원가 조회(합계) · 매출원가 | — |

- 줄은 대표만 준다(0002 `module_access_admin_write`). 사용자 화면의 체크 칸은 0-3의 즉시 표시 방식.
- **사용자 관리자(0055) 위임: 1차는 불가(권장).** 0055 `staff_admin_invite`의 허용 목록이 `'/finance/<biz>'` · `'/documents/<biz>'` 둘뿐이라
  아무것도 고치지 않아도 위 네 키는 위임으로 못 준다. 넓힐 때 후보는 «구매 입력 · 생산 입력»(가격 · 원가가 아닌 입력 권한)뿐이다 — 회장 확인(13절).
- 역할만으로 되는 사람: **대표(Chairman)만.** GroupCFO · 회사 대표 · 임원도 줄을 받아야 한다(권장 — 원가는 회장 결정상 부서 권한이다).
- AIAgent · Integration: 줄이 있어도 false(0047 `finance_grant`와 같은 문). 원가 표 전부에 restrictive 정책.

### 3.2 권한 표(회장 지시 · 2026-10-09 결정 반영) → 구현

> **회장 결정(2026-10-09): «영업은 제품 총액만, 원료별 가격은 모른다».** 아래 표가 이 결정을 반영한 판이다.

| 정보 | 구매 | 생산 | 영업 | 경영지원(원가 관리) | 대표 |
|---|---|---|---|---|---|
| 원료 이름 | O 표 | O 표 | **X** | O 표 | O |
| 시장 원료가격 | O 표 | **제한** 함수 | **X** | O 표 | O |
| 실제 구매가격 | O 표 | **제한** 함수 | **X** | O 표 | O |
| 공급처 | O 표 | **제한** 함수 | X | O 표 | O |
| BOM · 비율 · 제품별 원료 구성 | X | X(작업지시 수량만) | X | X | O 함수 |
| LOT 가격 | O 표 | O 함수 | X | O 표 | O |
| 제품 원가(총액) | X | X | **O 함수** — Market · Current · 원가 우위 · 총원가(주 1회 월요일 0시 · 10원/kg) | O 함수(같은 주간 값 · 호출마다 감사) | O 함수(분해까지 · 아무 날짜) |
| 원가 변동 원인 | X | X | 비용 묶음 비율만(«원료비 영향 +4.2% · 물류비 +1.1%») | O | O |
| 마진 · 제시가 · 등급 | X | X | O(판매가 → 마진 원 · % · Green/Yellow/Red · 목표 마진별 제시가) | O | O |
| 회계 손익 | X | X | **제한** | O | O |

- 영업 함수: `cost_sales_view(제품)` = Market · Current · 원가 우위 · 비용(0065 전 null) · 총원가 · 원료비 영향 · 목표 마진 15/20/25/30% 제시가 · 등급,
  `cost_price_check(제품, 제시가)` = 마진 원 · % · 등급. **원료 이름 · 원료별 값을 돌려주는 칸이 없다.** 영업 화면 · API · AI 도구 어디에도 원료를 넣지 않는다.
- 겸직: 영업 견적 + 구매(입력 · 읽기 모두) 또는 생산 → 영업 원가 거부(원료 이름 · 시세와 총원가가 한 사람에게 모이지 않게 — 리뷰 5회차). 구매 입력 + 원가 관리 → 거부(기존).
- 스냅샷: 대표 외 값은 그 주 월요일 0시까지 저장돼 있던 시세 · LOT · 원료 · BOM 판으로만 — 주 중에 생긴 원료 · 고친 BOM은 다음 주에 반영. 영업 목록은 `cost_sales_list(회사)` 한 번의 조회.
- 원가 표 감사 줄(원료 · 공급처 · 시세 · LOT · 첨부 · BOM)은 본인 · 대표 · 그 회사 구매 · 원가 관리만 읽는다(영업 팀장이 아래 구매 담당 감사로 원료 id를 보지 않게).
- 원가 관리 감수 조건: 회사마다 **셋까지**(DB 트리거) · 원가 조회는 **호출마다** 감사 · 구매 화면 열람은 0031 열람 기록 · 대표 화면에 «원가 관리 권한자 + 최근 7일 조회 수»(`cost_costing_watch`).
- Red(GM < 15%) → 0059 결재(상사 사슬 → 대표). 결재 양식 «가격 예외»와 견적 스냅샷은 가격 엔진 블록(0066)에서 함께 만든다 — 결재가 견적 스냅샷을 물어야 해서다.

«표» = RLS select 정책으로 그 줄을 직접 읽는다. «함수» = 표는 못 읽고 security definer 함수가 정해진 칸만 돌려준다.

### 3.3 «제한» · «요약»의 정확한 뜻
- **생산 · 시장 원료가격(제한)**: 원료별 «오늘 시장가(원/kg) 한 값»만 — 날짜를 고를 수 없다(이력 없음) · 출처 · 외화 원가 · 공급처 비교 없음. (`cost_production_materials()`)
- **생산 · 실제 구매가격(제한)**: LOT별 **landed 원/kg 한 값**(= LOT 가격)만 — 외화 단가 · 환율 · 운송비 · 관세 · 부대비 분해 · 공급처 계약가 없음.
- **생산 · 공급처(제한)**: LOT 추적에 필요한 공급처 **이름 · 공급처 LOT 번호**만 — 연락처 · 결제 · 인도 조건 · 단가 없음.
- ~~영업 · 실제 구매가격(요약)~~ — 2026-10-09 회장 결정으로 **없앰**. 영업은 원료별 구매가 · 시세를 보지 않는다(`cost_sales_purchase_summary`는 구매 · 원가 관리만).
- **영업 · 회계 손익(제한)**: 자기가 만든 견적 · 그 견적에 이어진 판매의 «견적 마진 vs 실제 마진»과 제품별 GM 합계만 — 회사 손익계산서 · 비용 분해 · 다른 사람 견적 없음.
- 회장이 다르게 정하면 위 함수 하나씩만 바뀐다(표 정책은 그대로).

---

## 4. 원가 4종 계산식

공통: 제품 p, 기준일 d. BOM 판 v = `valid_from ≤ d`인 것 중 가장 늦은 것(무효 제외). 원료 m의 투입량 `q(m) = kg_per_kg(m) ÷ (yield_pct/100)`.
원료비(원/kg) = Σ_m q(m) × 단가(m, d). 총원가 = 원료비 + 가공비(5절) + 포장 · 물류 등(5절). **나가는 값은 반올림(6.3)**.

| 종류 | 단가(m, d) | 원천 |
|---|---|---|
| **Market** | d 이하 가장 최근 `cost_market_prices.price_krw_per_kg`(무효 제외, 같은 날 여러 출처면 평균) | 구매가 넣은 시세 |
| **Current** | d 시점 남은 LOT의 잔량 가중평균 `landed_krw_per_kg`(재고 이동평균) — 잔량 0이면 가장 최근 LOT 단가 | 입고 LOT − 투입 |
| **Actual** | 제품이 아니라 **생산 LOT** 단위: Σ(실제 투입 LOT kg × 그 LOT landed) ÷ 산출 kg | `cost_lot_inputs` |
| **Forecast** | coalesce(그 날짜의 «예상 시장가»(구매가 넣는 미래 날짜 시세), 최신 LOT의 외화 단가 × d의 최신 환율 + 최신 LOT의 kg당 부대비) | 최신 구매가 + 환율 |

- Actual은 BOM을 쓰지 않는다(실제 투입) — 그래서 생산 LOT의 Actual은 BOM 없이도 계산되고, 그 값이 BOM과 얼마나 다른지(«배합 이탈»)는 대표만 본다.
- 단가가 없는 원료가 하나라도 있으면 그 종류의 원가는 **계산 안 함(null + 이유 «원료 단가 없음 n개»)** — 0으로 메우지 않는다. 이유에 원료 이름은 넣지 않는다(대표 외).
- **LOT 소진 규칙**: 투입은 생산이 **LOT를 지정해 기록**한다(FIFO 자동 차감 없음). 화면은 «입고 오래된 순»으로 제안만 한다.
  잔량보다 많이 투입하면 거부(트리거). 조정(폐기 · 실사)은 이유 필수.

## 5. 비용 배부 · 총원가 구성

총원가(원/kg) = 원료비(종류별) + Σ 배부 비용(원/kg)
- `per_kg`: 그 비용의 일할액을 같은 날짜 범위의 **생산 kg 합**으로 나눈다(기준 기간 = 기본 직전 28일 이동, 회장 확인).
- `per_batch`: 일할액 ÷ 생산 LOT 수 ÷ 그 LOT 평균 산출 kg.
- `per_product`: 그 제품에 직접(포장재 · 전용 팔레트).
- `pct_of_price`: 커미션 · 카드 수수료 — 원가가 아니라 가격식에 들어간다(5.1).
- 생산 실적이 아직 없으면(1차) 배부 비용은 «계획 kg»(회장이 넣는 월 계획 생산량)으로 나눈다 — 화면에 «계획 기준» 꼬리표.

### 5.1 가격식
판매가 = 총원가 ÷ (1 − 목표마진율 − 커미션율). 커미션이 없으면 회장 공식 그대로. GM = (판매가 − 총원가) ÷ 판매가.
신호: GM ≥ 20% Green · 15% ≤ GM < 20% Yellow · GM < 15% **Red → 0059 결재**(양식 «가격 예외 승인», 상사 사슬 → 대표). 결재가 Approved일 때만 견적 «발행».

## 6. 보안 설계(필수)

### 6.1 BOM이 나가는 길 = 0개(대표 외)
- 표: `cost_secret` 스키마 — usage 없음, PostgREST 미노출, graphql 미노출(pg_graphql은 select 권한 있는 표만 그린다 — 권한이 없다).
- 뷰: BOM을 읽는 뷰를 만들지 않는다. 공개 스키마의 어떤 뷰도 `cost_secret`을 참조하지 않는다(검사 스크립트가 `pg_depend`로 확인).
- 함수: BOM을 읽는 함수는 셋뿐이고 전부 공개 스키마의 security definer — `cost_bom_get`(대표) · `cost_bom_save`(대표) · `cost_product_cost`(합계).
  내부 도우미(`cost_secret.*`)는 `revoke execute from public` — authenticated가 부를 수 없다.
- `cost_product_cost(product, kind, as_of)`의 반환: **반올림된 총 원료비 · 총원가 · 계산 여부 · 이유 코드**만. 인자로 BOM을 바꾸거나(«이 비율로 계산해 줘»)
  원료를 고르는(«이 원료만 빼고») 길이 없다. 원료별 분해는 `cost_product_breakdown` — 대표만.
- 오류 메시지 · 정렬 · 필터 우회: 함수는 «없는 제품»과 «권한 없는 제품»을 같은 오류(`cost_not_found`)로 답한다. 원료 이름 · 개수 · 비율을 담은
  오류 · 경고 · NOTICE를 내지 않는다(검사 스크립트가 오류 문장에 원료 이름이 없음을 잰다). 정렬 · 필터 인자가 없다.
- 타이밍 · 크기: 반환 행 수는 늘 1(제품 수 = 요청한 제품 수). 원료 수가 응답 크기로 새지 않는다.

### 6.2 역산 방지
- 원가 반올림: 기본 **10원/kg**(1차). «원료비 영향»은 **묶음 비율 하나**(«원료비 영향 +4.2%», 0.1%p 반올림) — 원료별 영향은 대표만.
- 영업 시뮬레이터: 입력 = 제품 · 수량 · 목표마진 또는 제시가 → 출력 = **판매가 · GM · 신호**만(원가를 따로 돌려주지 않는다 — 권한 표상 영업은 원가 O지만,
  시뮬레이터는 마진만 — 원가 합계는 «제품 원가» 화면에서 하루 한 값으로만).
- 영업 · 경영지원이 보는 원가는 **하루 한 값(기준일 단위 캐시 없이 같은 날 같은 답)** — 같은 날 몇 번 불러도 같은 숫자다.
- 원가 조회 감사: 대표 외의 모든 `cost_product_cost` 호출이 `audit_log`(action 'read', entity 'cost_products', note «원가 조회 · 종류»)에 남는다.
  하루 제품당 한 줄로 합친다(같은 사람 · 같은 제품 · 같은 날 · 같은 종류는 한 번만 적는다).
- 호출 한도: 사람당 하루 **제품 200건**(넘으면 `cost_rate_limited` — 대표에게 알림). 정상 업무(견적 수십 건)보다 넉넉하고, 긁어 가기에는 좁다.

### 6.2-b 1차 리뷰(2026-10-09)로 더한 문

| 문 | 무엇을 막나 |
|---|---|
| **구매 겸직 거부** — 구매 입력 줄을 가진 사람은 원가 · 원료비 영향을 못 본다(`cost_role_conflict`) | 시세 한 줄을 넣고 원가 변화를 읽으면 그 원료 비율이 **한 번에 정확히** 나온다(리뷰가 실제로 0.31578947 = 0.3/0.95를 뽑았다) |
| **쌍시간** — 대표 외 원가는 «3일 전까지 들어와 있던 · 그때 무효가 아니던» 시세 · LOT만 본다 | 오늘 넣은 가짜 시세 · 과거 날짜로 넣은 시세 · 오늘 무효로 한 시세가 원가에 바로 비치는 것 |
| **터무니없는 값 거부** — 대표 외 입력이 그 원료 90일 중앙값의 0.2~5배 밖이면 거부(`cost_price_outlier`) | 1조 원 시세 · 1e6 원/kg LOT로 원가를 크게 흔들어 비율을 읽는 것 |
| **기준일 = 이번 주 월요일 하나**(원가 관리 · 영업 둘 다, 인자 무시 — 리뷰 2회차) · 원료비 영향 = «지난 주 월요일 → 이번 주 월요일» 한 값 | 날짜를 바꿔 가며 합계를 여러 개 받는 것(리뷰 2회차가 원가 관리 한 사람 · 첫날 · 100번 안쪽 호출로 비율을 ±0.01까지 풀었다) |
| **회사 단위 «계산됨»**(대표 외) — 회사의 사용 중 원료 하나라도 단가가 없으면 그 회사 모든 제품이 not_computed | «이 제품만 계산 안 됨» = 단가 없는 그 원료가 이 제품에 있다 |
| **아는 시각 = 그 주 내내 하나**(월요일 앞 금요일 0시 KST — 리뷰 3회차) | now() − 3일처럼 흘러가면 월~금 사이 시세가 하나씩 비쳐 들어와 한 주 안에 원료 하나씩 비율이 풀린다(리뷰가 실제로 0.30 · 0.70을 뽑았다) |
| **역할마다 원가 종류 하나** — 원가 관리 = Current, 영업 = Market(둘 다 가진 사람은 원가 관리) | 한 주에 식이 둘이면 역산이 두 배 빠르다 |
| 계산 여부의 원료 = 사용 중 + 그 날 쓰는 BOM에 든 단종 원료 | 단종 원료가 든 제품만 not_computed가 되어 소속이 새는 것 |
| 터무니없는 값 기준 = 어제까지 들어온 줄(무효 포함) · 창 [날짜 − 90, 날짜] · 대표 외 내일 넘는 날짜 거부 · 같은 날 같은 원료 출처 셋까지 · 구매 입력 없는 사람에게는 아무 말 없이 RLS가 거부 | 같은 날 출처를 바꿔 중앙값 끌어올리기 · 진짜 줄을 무효로 해 기준 없애기 · 먼 미래 날짜 · 오류로 시세 범위 엿보기 |
| **이유 코드 하나** — 대표 외는 `not_computed`만 | «이 날 단가 없는 원료가 있다»로 BOM 소속을 알아내는 것 |
| **원료비 영향 1%p · 반올림 합계끼리**(대표 외) | 0.1%p가 10원 반올림보다 정밀해 원료 하나가 움직인 날 비율을 거의 그대로 주는 것 |
| 감사 줄에 기준일 · 하루 · 기준일마다 한 줄 | 이력 긁기가 «한 번 읽음»으로 보이는 것 |
| FORCE RLS 없음(원가 표) | Supabase postgres는 BYPASSRLS가 아니라 FORCE면 정의자 함수가 0행 — 엔진이 통째로 죽는다(PGlite는 superuser라 못 잡는다 → 검사에 «BYPASSRLS 없는 소유자» 실행을 넣었다) |

남는 것(정직하게):
- 원가 관리 · 영업은 그 주 원가를 금요일 0시까지 들어온 값으로 본다 — 금~일에 넣은 시세 · LOT는 다음 주 값에 들어간다(업무 설명에 적는다).
- BOM이 아예 없는(또는 기준일 뒤에 시작하는) 제품은 그 제품만 not_computed다 — BOM이 «있다»는 것만 알려 주고 비율은 아니다.
- 원료비 영향은 지난 주 월요일 값을 이번 주 아는 시각으로 다시 계산한다 — 늦게 들어온 지난 주 시세가 1%p 단위 약한 식 하나를 더한다.
- 같은 날 출처 셋 한도는 동시에 넣는 두 트랜잭션이 넘을 수 있다(짜는 사람이 필요 · 방어 겹일 뿐).
- 원료의 «사용 중» 표시는 스냅샷이 아니다 — 구매 입력자가 주 중에 단가 없는 원료를 «사용 안 함»으로 바꾸면 그 주 영업 «계산 여부»가 바뀔 수 있다(구매 + 영업 두 사람이 짜야 하고, 알 수 있는 것은 «그 원료가 어떤 BOM에 있는가» 하나 · 리뷰 6회차 Minor).
- **두 사람이 짜면**(구매 담당이 그럴듯한 시세를 넣고, 영업 · 원가 관리가 3일 뒤 원가를 본다) 비율은 천천히 새어 나간다. 쌍시간 · 범위 거부는 속도를 늦추고
  흔적(시세 입력 감사 · 원가 조회 감사)을 남길 뿐이다. 이상 탐지(같은 원료 시세가 자주 무효 · 같은 사람이 매일 전 제품 조회)를 대시보드 블록에서 대표 알림으로.
- 카탈로그 통계(`pg_class.reltuples` · `pg_stat_user_tables.n_tup_ins`)는 누구나 읽는다 — `cost_secret.bom_lines`의 **전체 줄 수**와 저장 때마다 늘어난 수(= 그 판의 원료 수)가 보인다.
  PostgREST로는 닿지 않는다(SQL 세션이 필요). 0063 암호화(판마다 한 줄)로 사라진다.
- 구매 첨부의 `mix_checked`는 DB가 확인할 수 없다 — PostgREST로 직접 넣는 사람은 «검사함»이라고 적을 수 있다(감사 줄은 남는다).
- 한도 · 감사는 트랜잭션이 되돌려지면 같이 사라진다 — PostgREST `db-tx-end`가 `commit`(기본값)인지 운영 반영 전 확인.

### 6.3 장기 시계열 역산 위험(정직하게)

> **회장이 꼭 알아야 할 한 줄(리뷰 2회차):** 시세를 읽을 수 있는 사람(권한 표상 원가 관리 · 영업 둘 다 O)이 제품 원가 합계를 받으면,
> 원료 k개짜리 제품의 비율은 **서로 다른 시세 시점 k+1개**로 풀린다 — 짜는 사람 없이 혼자서. 1차는 그 시점을 «한 주에 하나»로 묶었으므로
> 원료 10개 제품이면 약 11주(석 달)다. 반올림 · 쌍시간 · 한도는 이것을 늦출 뿐 막지 못한다. 막는 길은 셋뿐이다:
> ① 그 역할에게 합계를 주지 않는다(영업은 시뮬레이터의 판매가 · 마진만) ② 합계를 주는 역할에게 시세 표를 주지 않는다 ③ 합계를 상대값으로 거칠게(유효숫자 2자리).
> 권한 표의 «영업 · 제품 원가 O» · «영업 · 시장 원료가격 O»를 그대로 두면 ①~③ 중 하나를 고르는 것이 회장 결정이다(16절 3).
- 영업은 원료 시장가(O)와 제품 원가 합계(O)를 **매일** 본다. 제품 원가(Market) = Σ 비율 × 시장가 + 배부비. 원료 k개 제품이면 시장가가 서로 다르게
  움직인 날이 k+1일 넘게 쌓이면 **최소제곱으로 비율을 추정할 수 있다.** 10원/kg 반올림은 잡음일 뿐 — 날이 많으면 평균으로 지워진다.
  1년(250영업일) · 원료 10개 제품이면 비율을 ±수 % 정확도로 추정할 수 있다고 봐야 한다. **반올림만으로는 막지 못한다.**
- 완화(권장 순):
  1. **영업에게 Market 원가를 매일 주지 않는다** — 영업이 보는 원가는 «이번 주 월요일» 한 값(지난 주는 다시 못 본다). 1년 52점이 **한 주에 한 점씩만** 쌓인다(원료 10개면 여전히 풀리지만 몇 달이 걸리고 흔적이 남는다). — **구현됨(0062)**
  2. 영업 원가 화면은 **Current(재고 이동평균)** 를 기본으로 — 시장가가 아니라 영업이 모르는 LOT 단가에 묶여 있어 시장가 회귀가 잘 맞지 않는다.
  3. 반올림 단위를 상대값으로(유효숫자 3자리) — 원가가 클수록 잡음도 크다.
  4. 감사 + 한도 + 이상 탐지(한 사람이 전 제품을 매일 조회하면 대표 알림).
  5. 완전한 차단은 «영업은 원가를 보지 않고 판매가 · 마진만 본다»뿐이다 — 권한 표의 «제품 원가 O(영업)»를 «X(시뮬레이터 마진만)»로 바꾸는 회장 결정이 필요하다.
- 생산의 «작업지시 수량»은 그 자체로 비율이다(9.3). 생산 쪽 위험은 반올림으로 줄일 수 없다 — 지시서를 받는 사람 수를 줄이는 것이 완화다.

### 6.4 감사
| 순간 | 기록 |
|---|---|
| BOM 저장 · 무효 | `audit_log` permission_change 아님 → 'update'/'create', entity 'cost_bom', **값 없이**(before/after에 비율 · 원료를 넣지 않는다 — 감사 줄도 대표만 읽지만 백업 · 내보내기로 샌다) — 판 번호 · 원료 수만 |
| BOM 열람(대표) | 'read', entity 'cost_bom', 판 번호 |
| 원가 조회(대표 외) | 'read', entity 'cost_products', 하루 한 줄 |
| 가격 · LOT · 시장가 입력 · 무효 | 'create' / 'update'(무효 이유) |
| 견적 스냅샷 | 'create', 스냅샷 값 그대로(원가 합계는 BOM이 아니다) |

### 6.5 숫자 형식
금액 · 수량 numeric. 화면 입력은 `src/components/ui/number-input.tsx` 재사용. 통화는 ISO 3자리. 기본 단위 kg(1차는 kg만 받는다 — 톤 · 드럼은 2차에 환산표).

## 7. BOM 암호화(제안 — 구현은 승인 후)

service_role 없이 · 키가 평문으로 DB 표나 저장소에 남지 않게.

| 안 | 방식 | 막는 것 | 못 막는 것 | 비용 |
|---|---|---|---|---|
| **A(권장)** | **Supabase Vault**에 데이터 키 하나(`vault.create_secret`) — `payload_enc = pgp_sym_encrypt(jsonb 원료목록+비율, key)`(pgcrypto). 복호화는 `cost_secret` 소유 역할의 security definer 함수 안에서만, 키는 `vault.decrypted_secrets`에서 그 순간 읽는다. `vault` 스키마는 authenticated에 권한 없음 | DB 백업 · 덤프 · 표 내보내기 · 실수로 연 grant · SQL Editor에서 표만 열어 보기 · 로그 | Supabase 프로젝트 소유자(=postgres 권한으로 함수 · Vault를 직접 부름) | 무료 · 마이그레이션 1개 |
| B | 앱 레벨: Vercel 환경변수의 키로 Next 서버가 암호화 · 복호화 · 계산. DB는 암호문만 | DB가 통째로 새도 BOM은 못 읽는다 | Vercel 관리자 · 서버 코드 실수(권한 판정이 앱으로 올라간다) | 비밀값 1개(회장 결정 필요) · 원가 함수가 DB 밖으로 |
| C | 대표 비밀번호에서 키를 만드는 브라우저 암호화 | 서버 · DB 둘 다 새도 안전 | — 원가 계산을 대표가 접속해 있을 때만 할 수 있다 → 영업 원가 조회가 불가능 | 운영 불가 |

- 권장 A의 실행 순서(승인 후 한 블록): 0063 — `payload_enc` 채우는 함수 · 복호화 함수 · `bom_lines` 비우기(평문 줄 삭제 = 가짜뿐) · `is_fake` check 풀기 →
  대표가 SQL Editor에서 `select vault.create_secret('<키>', 'cost_bom_key')` 한 줄(키는 대표가 만든다 — 이 세션은 비밀값을 만들지 않는다).
- pgsodium은 Supabase가 새 기능 지원을 멈춘 상태라 쓰지 않는다(Vault 자체는 유지). pgcrypto는 이미 켜져 있다(gen_random_uuid).

## 8. AI 차단(구조)

- BOM은 `cost_secret`에만 있고, AI 어시스턴트 도구(0046 · `src/lib/ai/assistant/tools*.ts`) · 야간 Job(AIAgent 역할) · 입구 분류(0058) · 첨부 요약 어디에도
  **BOM 함수를 부르는 도구를 만들지 않는다.** AIAgent · Integration은 `cost_*` 표 · 함수에서 restrictive로 막힌다(DB).
- 검사 스크립트: `src/lib/ai/**`에 `cost_bom` · `cost_product_breakdown` · `cost_secret` 문자열이 있으면 실패(check:cost-engine).
- 원가 합계(영업용)도 AI 도구에 넣지 않는다(1차) — 넣으면 AI 로그에 원가 시계열이 쌓인다(6.3).
- 구매 첨부(견적서 · 단가표)는 AI에 보내지 않고(요약 없음), 올릴 때 배합비 감지(`src/lib/intake/mix-ratio.ts` — feat/intake와 같은 파일)로 걸리면 저장하지 않는다.
  Vault 등급은 받지 않는다.

## 9. 시간 구조 · 날짜 기준

### 9.1 저장 = 일
- 기준일: 시장가 `observed_on` · 구매 LOT `received_on`(입고일 — 발주일 아님) · 생산 `produced_on` · 판매 `sold_on` · 비용 `period_from~to`(일할).
  날짜는 **KST 달력 날짜**(`date`, 시각 없음). 화면 기본값은 `kstToday()`.
- 주 = ISO 주(월요일 시작, `date_trunc('week', d)` = 월요일 — Postgres 규칙과 같다). 연도 경계 주는 ISO 연(`isoyear`)으로 묶는다.
- 월 · 분기 · 년 = 달력. 회계연도 = 달력 연(DY).

### 9.2 합산 = 뷰
`cost_daily_*` 뷰가 일 단위로 펼치고, 화면이 `group by date_trunc('week'|'month'|'quarter'|'year', d)`로 묶는다. 주 · 월 표를 따로 저장하지 않는다.
평균 단가(주 · 월)는 **수량 가중**(Σ금액 ÷ Σkg) — 단순 평균이 아니다.

### 9.3 생산 작업지시의 잔여 위험
작업지시서의 «원료별 kg» ÷ «계획 kg» = BOM 비율이다. 회장 결정 «X(작업지시 수량만)»은 이것을 허용한다. 완화: 지시서는 생산 LOT 단위로만(제품 전체 비율표가 아니라),
여러 원료를 묶음 코드로(«부원료 A세트») — 2차 결정.

## 10. 회계 연결

- **매출원가 전표(월)**: 판매 실적(`cost_sales`) × 그 판매에 이어진 생산 LOT의 Actual 원가 → «원가 엔진 매출원가» 초안. 자체 장부(0016)에 **초안 전표**로만
  (경영지원이 확인 → 등록). 마감된 달은 정정 전표로(CLAUDE.md).
- **ECOUNT와 겹칠 때(DY)**: ECOUNT 엑셀(0050)에 매출원가가 있으면 **재무회계는 ECOUNT가 이긴다**(공식 장부). 원가 엔진 값은 관리회계로만 보이고,
  화면에 «ECOUNT 매출원가 vs 원가 엔진 매출원가 — 차이 ₩, %»를 둔다(재고 평가 차이 · 배부 차이 발견용). 둘 다 전표로 넣지 않는다.
- **구매 결재 → 구매 LOT**: 0059 승인된 `purchase` 양식(품목 · 구입처 · 링크 · 금액 · 수량) → 뷰 `cost_purchase_lot_candidates`(security_invoker) →
  구매가 «LOT로 넣기»(원료 고르기 · kg · 통화 · 입고일 · 부대비 채움) 또는 «무시». 같은 결재로 LOT 둘은 unique가 막는다.
  금액 ÷ 수량은 «후보 단가»일 뿐(부가세 · 배송비가 섞인다 — 사람이 고친다).
- **R2 연계(권장안)**: 1차 = **R2 내보내기 파일(엑셀/CSV)을 대표가 직접** `/costing/<biz>/bom`에 올린다 → 서버가 **AI 없이** 읽어(파일은 저장하지 않음)
  `cost_bom_save`로 넣고 «원료 n개 · 합계 kg_per_kg» 확인 → 대표 확인 후 저장. 수동 입력도 같은 화면. **R2 API 연동은 하지 않는다**(키 · 비밀값 · R2 쪽 권한 노출).
  회장 확인: R2에서 BOM을 볼 수 있는 사람 · R2 내보내기 기록(누가 언제 내려받았는가) · 내려받은 파일이 PC · 메일 · 메신저에 남는 문제.

## 11. 견적 → 결재 → 판매 → 실제원가

```
견적 만들기(영업) ─▶ 원가 스냅샷(그 순간 · 영구) ─▶ GM 신호
   Green/Yellow ─▶ 발행
   Red ─▶ 0059 결재(«가격 예외 승인», 상사 사슬 → 대표) ─▶ Approved면 발행 / Rejected면 수정 후 재상신
발행 ─▶ 판매(cost_sales, quote_id) ─▶ 생산 LOT 연결 ─▶ Actual 원가 ─▶ «견적 마진 vs 실제 마진»(판매 건 · 제품 · 영업 사람 · 월)
```

## 12. 입구 설계서와의 연결 메모

- 입구 설계서 C · D(0059_purchasing) · E 4~6은 **이 문서로 대체**된다. 0059 번호는 결재 대장이 썼다.
- 입구 ②(단가표 → 단가 초안)는 이 문서의 `cost_market_prices`(시세) · `cost_purchase_lots`(견적서 → LOT 후보)로 적재한다. `purchase_items` → `cost_materials`,
  `purchase_prices` → 시세는 `cost_market_prices`, 실제 구매는 `cost_purchase_lots`. 입구의 «배합비 감지»는 그대로(같은 파일 공유).
- 입구 권한 `'/purchasing/<biz>'`는 이 문서의 키와 같다(같은 이름으로 맞췄다).

## 13. 화면 목록(URL)

| URL | 누가 | 칸 | 1차 |
|---|---|---|---|
| `/purchasing/[business_id]` | 구매 · 경영지원 · 대표 | 원료별: 최근 시장가 · 최근 구매가(landed) · **시장가 대비 %** · 공급처별 평균단가 · 추이(일/주/월) | **예** |
| `/purchasing/[business_id]/materials` | 구매 | 원료 마스터(이름 · 규격 · 분류 · 사용) | **예** |
| `/purchasing/[business_id]/suppliers` | 구매 | 공급처(이름 · 나라 · 통화 · 연락처 · 조건) | **예** |
| `/purchasing/[business_id]/market` | 구매 | 시장가 입력(날짜 · 원료 · 가격 · 통화 · 출처) · 이력 | **예** |
| `/purchasing/[business_id]/lots` | 구매 | 구매 · 입고 LOT 입력(Landed Cost 계산 미리보기 · 환율 자동) · 결재 후보 · 첨부(견적서 · 단가표) | **예** |
| `/production/[business_id]` | 생산 | 작업지시 · 생산 LOT · 투입 LOT 기록 | 2차 |
| `/sales/[business_id]` | 영업 | 제품 원가(주간 고정 · 합계) · 시뮬레이터(판매가 · GM · 신호) · 견적 · 원료 시세 · 구매가 요약 | 3차 |
| `/costing/[business_id]` | 경영지원 | 원가 4종(합계) · 비용 마스터 · 배부 기준 · 매출원가 · 견적 vs 실제 | 2~3차 |
| `/costing/[business_id]/bom` | **대표만**(서버 redirect('/me')) | BOM 판 · 가짜/진짜 표시 · 원료별 분해 · R2 파일 올리기 | 1차(가짜 BOM 보기만) |
| `/dashboard` 원가 카드 | 대표 | 원가 4종 추이 · 원료비 영향 · 마진 신호 | 4차 |

사이드바: «구매»(그 회사 `'/purchasing/<biz>'` 줄이 있거나 대표) 등 모듈 키가 있는 사람에게만. 직원 화면에 «회장» 없음.

## 14. 마이그레이션 번호

사용 중: 0050~0052 · 0056(ECOUNT) · 0054 · 0055(결재 · 온보딩) · 0058(입구) · 0059(결재 대장). **0053 비움.** 예약: 0057(전표 증빙) · 0060(결산 잠정).

| 번호 | 이름 | 내용 | 블록 |
|---|---|---|---|
| **0061** | `cost_engine_base` | 모듈 키 판정 함수 넷 · 원료 · 공급처 · 시장가 · 구매 LOT · 제품 · 구매 첨부(버킷 `purchasing`) · 결재 후보 뷰 · 생산 · 영업용 제한/요약 함수 | 1차 |
| **0062** | `cost_secret_bom` | `cost_secret` 스키마 · BOM(가짜만) · `cost_bom_get/save` · `cost_product_cost`(Market · Current) · `cost_product_breakdown` · 조회 감사 · 한도 | 1차 |
| 0063 | `cost_bom_encrypt` | Supabase Vault 키 · `payload_enc` · 평문 줄 제거 · 진짜 BOM 허용 | 승인 후 |
| 0064 | `cost_production` | 생산 오더 · 생산 LOT · 투입 · 잔량 뷰 · 조정 · Actual | 2차 |
| 0065 | `cost_overheads` | 비용 마스터 · 배부 · 총원가 · Forecast | 2차 |
| 0066 | `cost_pricing` | 견적 · 스냅샷(불변) · 가격 예외 결재 양식(0059 연결) | 3차 |
| 0067 | `cost_finance` | 판매 실적 · 매출원가 초안 · ECOUNT 대조 | 3차 |

**반영 순서 의존**: 0061 · 0062는 0050~0059에 기대지 않게 썼다(master 위). 단 staging · production에는 0059 **뒤에** 간다(번호 순). 0066은 0059가 production에 있어야 한다.
check는 `check:migrations`가 아니라 **새 스크립트 `check:cost-engine`**(브랜치 합칠 때 check-migrations.ts 충돌을 피한다 — 10-08 함정).

## 15. 구현 블록 · 예상 시간

| # | 블록 | 시간 | 리뷰 루프 |
|---|---|---|---|
| 1 | (이번) 설계 · 0061 · 0062 · 구매 화면 · 원가 함수 1차 · check:cost-engine | 10h | 예(DB · RLS · BOM) |
| 2 | 0063 BOM 암호화 + 대표 BOM 화면 · R2 파일 올리기 | 6h | 예 |
| 3 | 0064 생산 LOT · 투입 · 잔량 · Actual · 생산 화면 | 8h | 예(돈) |
| 4 | 0065 비용 마스터 · 배부 · 총원가 · Forecast · 원가 관리 화면 | 8h | 예(돈) |
| 5 | 0066 가격 엔진 · 견적 · 스냅샷 · Red 결재 · 영업 화면 | 8h | 예(돈 · 결재) |
| 6 | 0067 판매 · 매출원가 · ECOUNT 대조 · 견적 vs 실제 | 8h | 예(돈) |
| 7 | 대시보드(일 → 주 → 월 → 분기 → 년) | 6h | 아니오 |

## 16. 역산 위험 — 회장 결정(2026-10-09) 기준 다시 계산

기호: 제품 하나의 원료 k개, 비율 q(1..k)를 모른다. 대표 외가 받는 원가는 **주 1회(월요일 0시 스냅샷) · 10원/kg 반올림** 한 값.

| 경우 | 아는 것 | 모르는 것 | 비율을 풀 수 있나 | 걸리는 시간 · 정확도 |
|---|---|---|---|---|
| **① 영업 단독(총액만)** | 주마다 Market 총액 M(t) · Current 총액 C(t) · 원가 우위 · 원료비 영향 % | 원료가 무엇인지, 원료별 시세 p(t) · 구매가 · LOT | **풀 수 없다.** 식 M(t) = Σ q·p(t)에서 q와 p가 둘 다 모르는 값이다 — 미지수가 주마다 k개씩 늘어난다. 총액의 오르내림(원가 추세)만 안다 | — (총원가 수준 · 원가 우위는 결정상 영업에게 주는 정보다) |
| **② 영업 + 외부 공개 시세** | ① + 업계 상식으로 원료 후보를 짐작하고, 공개 지수(국제 원자재 시세 등) P(t)를 구한다 | 정확한 원료 목록 · DY가 적는 시세와 공개 지수의 차이 · 반올림 | **근사로 풀 수 있다** — M(t) ≈ Σ q·P(t)로 회귀. Current는 DY LOT 단가라 공개 값과 맞지 않아 쓸모가 적다 | 원료 k개면 최소 k+1주, 실제로는 공개 지수와 DY 시세의 차이 · 10원 반올림 · 원료 짐작 오류 때문에 **수개월(원료 10개면 6개월 이상)에 ±수~수십 %**. 원료를 잘못 짐작하면 틀린 답이 나온다 |
| **③ 경영지원(원가 관리)** | 원료 이름 · 원료별 시세 · LOT 단가(정확) + 주마다 Market · Current 총액 | 비율만 | **정확히 풀 수 있다** — 주마다 식 둘(Market · Current), 원료별 단가를 다 안다 | 원료 k개면 약 k/2주(원료 10개면 약 5주), 10원 반올림 안에서 정확. **원리상 막을 수 없다** — 회계를 위해 원료별 값과 제품 원가를 같이 봐야 하는 역할이다 |
| (참고) 구매 + 영업 두 사람이 짬 | ③과 같음 | | ③과 같음 | 한 사람이 둘을 겸하면 DB가 거부한다(겸직 규칙). 두 사람이 짜는 것은 감사 기록(시세 입력 · 원가 조회)으로만 드러난다 |

- ③의 감수 조건(회장 결정): 회사마다 셋까지 · 호출마다 감사 · 대표 화면 감시(위 3.2). 이 셋은 «막는 장치»가 아니라 «누가 볼 수 있고 실제로 얼마나 봤는지를 대표가 아는 장치»다.
- ②를 더 늦추려면(선택): Market 총액을 50원/kg 단위로 · 또는 Market 총액 대신 «원가 우위 %»만. 지금은 회장 결정대로 둘 다 10원/kg.
- 앞 6.2-b · 6.3의 «시세를 읽는 역할이 합계를 받으면 k+1주» 경고는 이제 ③에만 해당한다(영업은 시세를 못 본다).

## 17. 회장이 정할 것

1. «제한»의 뜻(3.3) — 권장안대로인가.
2. 반올림 단위 — 10원/kg(결정됨).
3. ~~영업 · 원가 관리가 보는 원가~~ — **2026-10-09 결정됨**(3.2 · 16).
4. 배부 기준 — per_kg 기본 · 기준 기간 직전 28일(권장) / 월 단위.
5. 커미션을 가격식 분모에 넣을지(권장) / 원가에 넣을지.
6. BOM 암호화 — 안 A Supabase Vault(권장) / B 앱 키(비밀값) / C 불가.
7. R2 연계 — 내보내기 파일을 대표가 올림(권장) / 수동 입력만 / API 연동(비권장). R2 쪽 BOM 열람자 · 내려받기 기록 확인.
8. 위임 — 원가 모듈 넷은 사용자 관리자 위임 불가(권장) / «구매 입력 · 생산 입력»만 위임.
9. 회사 대표(BusinessCEO) · GroupCFO도 BOM 불가가 맞는지(회장 결정 문장상 «임원 포함 전원 불가» — 권장 그대로).
10. 하루 조회 한도 200건(권장).
11. 원가 관리 권한자 상한 — 회사마다 셋(지금 값) / 다른 수.
