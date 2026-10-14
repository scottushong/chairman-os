# 청사진 뼈대 블록 — 스스로 정한 것 (2026-10-13 ~ 10-14)

기준: «되돌리기 쉬움 · 노출 적음 · 구조 덜 바꿈». 한 줄씩.

1. 마이그레이션 번호 0081 — supabase/migrations 마지막이 0080(feat/material-price-lock 2dce767). 0069~0080 운영 반영 뒤에만.
2. 새 표는 0061~0067 원가 표와 같은 결: RLS enable · FORCE 없음 · authenticated grant 없음(정의자 함수로만). FORCE를 걸면 Supabase postgres(BYPASSRLS 아님) 아래 정의자가 0행(0062 함정). 한 번도 FORCE였던 적이 없어 check:force-rls와 충돌 없음.
3. 스위치 7개(cost_forecast · purchase_performance · customer_profit · margin_bridge · competitor_price · work_orders · product_diagnosis), 기본 enabled · audience 'chairman'. ⑦ BOM 넣기는 0063 «진짜 BOM 받기» 스위치가 이미 있어 새 키 없음.
4. 0001~0080 함수는 고치지 않는다 — 새 함수만. 0064 order_lines 직접 select(생산 전원)는 그대로, «본인 오더만»은 새 함수 work_order_get에서(DEFERRED: 표 정책 좁히기).
5. 구매 성과의 «구매가» = 물건값(unit_price × fx_rate), landed 아님 — 시장가도 물건값이라 같은 기준끼리 뺀다. 부대비는 절감액에 넣지 않는다.
6. 환율 효과의 기준 환율 = 입고월 fx_rates 평균(그 통화). 없으면 null(0 금지).
7. 고객별 수익성 원가 = 0067 판매 한 줄 실제 원가(cost_secret.sale_actual). 0075 월 매출원가는 회사 · 월 합계라 고객으로 나눌 수 없다 — 섞지 않는다.
8. «경영지원 팀장 이상» = 대표 · 원가 관리 줄(cost_can('costing')). GroupCFO도 원가 관리 줄이 있어야 한다(0062 문을 그대로 — 구조 덜 바꿈).
9. 임원 이상(BusinessCEO · Executive)의 구매 성과는 «월» 묶음만 — 원료 · 공급처 · LOT 묶음은 원료별 단가가 비쳐 0080 기준(일반 권한자는 합계만)에 걸린다.
10. 마진 분해는 GM 원/kg(kg 가중 평균) 기준 — 판매가 · 원료 · 제조 · 물류 · 기타(포장 + 간접비). 대표 외 1원 표시는 효과 다섯을 반올림한 뒤 가장 큰 효과 하나에 차이를 몰아 합 = 전체.
11. 경쟁사 가정 null = 우리 값(제조 · 물류 = 우리 비용 묶음, 마진 = 15%). 영업은 예상 최소가 · 우리 목표가 · 그 값에서의 우리 마진 % · 등급만.
12. 작업지시 원료 코드 = 'R-' + md5(material_id) 앞 6자리 — material_id slug에 원료 이름이 들어 있어 그대로 보이지 않는다.
13. 제품 진단 카드 4(구매 절감 — 이 제품 BOM 원료의 절감 합)는 대표만 — 원가 관리에게 주면 BOM 소속이 샌다.
14. 감사 줄 이름은 0067 audit_log_cost_private가 이미 좁히는 이름을 다시 쓴다 — 전망 = cost_market_prices('outlook:<id>') · 경쟁사 가정 = cost_overheads('competitor:<회사>:<제품|*>') · 작업지시 = cost_production_orders · 구매 성과 = cost_purchase_lots. 그 정책을 다시 만들지 않는다(다른 브랜치와 서로 지우지 않게). 전망 감사 줄에는 값을 넣지 않는다(설계 «값 포함»보다 노출 적은 쪽 — id · 달 · 통화만).
15. 마진 분해 대표 원료별 기여 = 기간 B 끝 날 BOM의 q × (Current 단가 B 끝 − A 끝) 상위 10 — 출고일 가중이 아니라 기간 끝 두 점(단순 · 되돌리기 쉬움).
16. 제품 추이(product_trend) Market 원료비는 대표만 기간마다, 원가 관리는 오늘이 든 기간 하나만 — 지난 날짜 원료비 합계 여러 개 + 원료별 시세 이력이면 BOM 역산(0062 리뷰 2회차 C1과 같은 이유).
17. Forecast 구매 쪽 «오늘 환율»은 fx_rates의 그 날 이하 최신을 직접 찾는다 — 0061 cost_fx와 같은 찾기지만 없으면 오류 대신 null(그 원료 Forecast 계산 안 됨).
18. 경쟁사 가정 빈 칸은 칸마다 제품 줄 → 회사 기본 줄 → 우리 값. 우리 비용 줄이 아예 없으면 제조 · 물류 0(0065 «비용 없음 = 원료비만»과 같은 결), 비용 줄은 있는데 배부 못 하면 계산 안 함.
19. 판매 한 줄 원가(고객별 · 분해 · 진단 · 추이) = cost_secret.sale_costs — 0067 sale_actual을 그대로 부르고 원료비 · 비용 묶음(제조 · 물류 · 기타 = 포장 + 간접비)을 옆에 더한다. 완전성 판정도 0067 cost_margins와 같다.
20. 진단 카드 8(상위 고객)의 영업 = 본인 판매만 · 고객 이름 포함(자기 고객 — 새 노출 없음). 카드 11의 원가 관리 = 원료비 합계 %(오늘 · 7일 전 회사 완전성) + 비용 묶음 Δ(1원).
21. Forecast 설정 · 경쟁사 가정 · 작업지시는 한 줄을 고친다(upsert) — 설계가 «무효 + 새 줄»을 요구한 것은 전망뿐. 이력은 감사 줄.
22. 제품 추이는 스위치 product_diagnosis 아래(새 키 없음). 구매 성과 묶음 합계는 대표도 1원(round) — 원가가 아니라서(설계 그대로).
23. (화면) 고객별 수익성 · 제품 진단 화면의 문 = 대표 · 원가 관리 줄 · 영업 줄(lib/blueprint/page.ts openBlueprint) — 재무 화면 문(장부 권한)과 openCosts(원가 관리만)는 영업 카드 · 본인 판매를 막는다. 진짜 판정은 0081 RPC.
24. (화면) 구매 성과는 새 화면이 아니라 /purchasing/<회사>?tab=performance — 구매 메뉴 탭(PurchasingNav)은 고치지 않고 개요 위 칩 둘(개요 · 구매 성과). 스위치가 꺼지면 탭이 없고 개요로.
25. (화면) 제품 진단 차트는 축 하나 원칙(dataviz) — 원/kg 세 줄(판매가 · Actual · Market) 위 칸 + GM% 아래 칸(같은 가로축). 두 눈금을 한 칸에 겹치지 않는다. 새 라이브러리 없음(인라인 SVG).
26. (화면) 진짜 BOM 넣기 미리보기 = CostImportPanel summaryOnly(제품 칸 값 · 줄 수 · 상태 수). 충돌 · 오류 줄 고치기는 이 모양에서 안 한다 — 파일 고쳐 다시 올리거나 BOM 화면 넣기 칸.
27. (문서) 진짜 BOM 확인 SQL은 cost_bom_versions RPC가 아니라 cost_secret.bom_versions 표를 센다 — RPC는 대표 로그인 세션만 통과해 SQL Editor(로그인 없음)에서 거부된다. 개수만(값 없음).
28. (dummy) DUMMY_FEATURES_OPEN=1이면 0081 스위치 일곱을 dummy에서만 처음부터 'all'로 — 직원 자리 화면 찍기용. dummy 원가 엔진 손잡이는 dummy-sales-cost.ts dummyBlueprintEngine → dummy.ts만 넘긴다(가짜 BOM 저장소 import 금지 — check:sales-cost).
29. (리뷰 I1) 구매 성과 제한 보기는 p_from · p_to를 그 달 1일 · 말일로 넓히고, LOT 3개 미만 묶음은 금액 · kg를 null + suppressed = true(n_lots는 남김). 전부 보기는 suppressed = false. 새 칸은 반환 표 맨 끝(suppressed · n_no_fx) — 기존 칸 순서를 안 바꿔 되돌리기 쉽다.
30. (리뷰 I2) 전부 보기 = 대표 · 구매 줄 · 원가 관리 줄 · 영업 줄 없는 GroupCFO. 제한 보기 = BusinessCEO · Executive · 영업 줄 있는 GroupCFO. 영업 줄 + 구매 줄은 전부 보기 그대로(0062 문이 그 사람에게 영업 원가를 이미 거부). 영업 줄 판정은 0061 cost_grant('sales') 재사용(새 함수 없음).
31. (리뷰 I3) 원료 코드 = 원료마다 무작위('R-' + uuid 앞 6자리 대문자) — 표 cost_secret.material_codes(RLS enable · 권한 없음 · 0066 quote_raw와 같은 결) · 0081 안에서 기존 원료 채움 · cost_materials AFTER INSERT 트리거(정의자 cost_secret.material_code_new). 겹치면 다시 뽑기(최대 50번). 0061 표에 트리거 하나를 더한 것이 0001~0080 불변의 유일한 예외 — 표 모양 · 정책은 그대로.
32. (리뷰 I3 알림) hide_names는 0064 cost_production_order_lines 직접 select 정책(생산 전원)을 좁힌 뒤에야 진짜로 이름을 가린다 — 지금은 생산이 그 표에서 material_id를 직접 읽을 수 있다(DEFERRED). 0081 머리말에도 적었다.
33. (리뷰 I4) Forecast · 고객별(customer_profit · watch) · 분해의 문 키 = 0065 cost_costing_list와 같은 'costing:<회사>' · 'costing_list' — 원가 관리 한 사람이 회사 전체 스냅숏을 화면 수와 상관없이 하루 20번까지. 0067 cost_margins 키는 그대로(0001~0080 불변 · DEFERRED).
34. (리뷰 M1) id를 받는 RPC(cost_outlook_set · competitor_price · work_order_set · work_order_get · product_diagnosis · product_trend)는 «없는 id 또는 내 회사 밖 id»를 스위치보다 먼저 cost_not_found — 없음만이 아니라 has_business까지 먼저 봐야 다른 회사 id의 스위치 상태로 떠보지 못한다(brief보다 한 걸음 더 · 노출 적은 쪽).
35. (리뷰 M2 · M4) n_no_fx = 외화 LOT 중 입고월 기준 환율 없는 수(맨 끝 칸). 수동 환율 모양(jsonb object)은 따로 IF로 먼저 — jsonb_each가 배열 · 글자를 만나지 않게.
36. (리뷰 M3) 대표 외 분해 b.gm = shown(a.gm) + shown(전체) — b.gm_pct는 원래 값으로(1원 표시와 % 계산을 섞지 않는다).
37. (리뷰 M5) 작업지시 담당 = 사용 중(revoked_at 없음) · 사람 역할(AIAgent · Integration 아님) · user_business_access 그 회사 · user_module_access '/production/<회사>'. 아니면 cost_invalid. 지금 담당이 그 조건을 잃었으면 대표 화면은 «없음»에서 시작하고 알린다(그대로 다시 저장하면 거부되니까).
38. (리뷰 B) work_order_get JSON에 assignee — 대표에게만 uuid, 생산 직원에게는 null(키는 늘 있다 — 모양을 역할마다 바꾸지 않는다). 대표 작업지시 폼이 지금 담당으로 채운다.
39. (리뷰 T1 · T2) check:blueprint — 월별 손익 전후 비교는 «결과가 오류 글자가 아님»을 먼저 단언. 영업 0시 기준은 11절 한 경우만 진짜 sales_cutoff(check:cost-engine ⑫의 REAL_CUTOFF · shiftKnown을 cost-engine-known.ts에서 export해 그대로 씀) — 나머지 절은 PIN_SALES_IMMEDIATE 그대로.
40. (lint) check-blueprint.ts의 any 넷은 jsonb 모양 타입(BridgeJ · WorkOrderJ)으로 — 시험이 읽는 칸만.
41. (dummy) dummy 원료 코드도 무작위(저장소 Map) · 구매 성과 제한 보기 · 담당 조건 · 한도 키 · b.gm을 0081과 같게. 회사 밖 id는 스위치보다 먼저 cost_not_found.
