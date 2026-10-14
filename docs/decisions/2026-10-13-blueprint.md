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
