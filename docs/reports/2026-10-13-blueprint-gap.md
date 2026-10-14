# 청사진 대조표 — 뼈대 완성 뒤 (2026-10-14)

기준: `docs/superpowers/specs/cost-engine.md` 15절 7개 모듈 + 대표 지시 «빈칸 8개». 브랜치 `feat/blueprint-skeleton`(feat/material-price-lock 2dce767 위), 마이그레이션 `0081_blueprint_skeleton`.
뼈대 = DB + 계산 함수 + 기본 화면 + 시험. 모든 새 기능은 0073 스위치(기본 «대표만»).

## 8개 — 시작 전 → 뼈대 완성 뒤

| # | 기능 | 시작 전 | 뼈대 완성 뒤 | 스위치 | 화면 |
|---|---|---|---|---|---|
| ① | Forecast 원가 | 없음 | **있음** — 예상 시장가(다음 달) 표 · 섞는 비율 · 예상 환율 설정 · `cost_forecast_list`(대표 원래 값 · 원가 관리 1원) | `cost_forecast` | /costs/<회사> Forecast 칸 · /purchasing/<회사>/market «다음 달 예상» |
| ② | 구매 성과 | 없음 | **있음** — LOT 절감액 · 환율 효과 · 원료/공급처/월 합계 `purchase_performance`(임원 이상은 월만 · 가림) | `purchase_performance` | /purchasing/<회사>?tab=performance |
| ③ | 고객별 수익성 | 부분 | **있음** — `customer_profit`(근거: 실제/추정/혼합/계산 불가) · `customer_profit_watch` 상위 10 · 영업은 본인 매출 · kg · 등급만 | `customer_profit` | /finance/<회사>/customers |
| ④ | 마진 변동 분해 | 없음 | **있음** — `margin_bridge`(합 = 전체, 원료별은 대표만) · 대표 대시보드 한 줄(코드 문장) | `margin_bridge` | 대표 대시보드(/) |
| ⑤ | 경쟁사 가정 | 없음 | **있음** — 가정 표 · `competitor_price`(영업은 결과만) | `competitor_price` | /costs/<회사>/competitor · /sales/<회사>/quotes 한 줄 |
| ⑥ | 작업지시 | 부분 | **있음** — 탱크 · 순서 · 담당 · 무작위 원료 코드 · 이름 가림 · 본인 오더만 `work_order_get` | `work_orders` | /production/<회사>/orders/<오더> |
| ⑦ | 진짜 BOM 넣기 | 있음(대부분) | **있음** — 전용 화면(미리보기 = 제품 코드 · 줄 수) · 문서 | (0063 «진짜 BOM 받기») | /costs/<회사>/bom/import · docs/onboarding/real-bom-import.md |
| ⑧ | 제품 진단 | 없음 | **있음** — `product_diagnosis` 역할별 카드(대표 11 · 원가 관리 10 · 영업 4) · `product_trend` 그래프 하나 | `product_diagnosis` | /costs/<회사>/products/<제품> |

## 15절 모듈

| 15절 블록 | 상태 |
|---|---|
| 1 구매 · 원가 함수 1차(0061 · 0062) | 있음 + 구매 성과(②) |
| 2 BOM 암호화(0063) | 있음 + 넣기 화면(⑦) |
| 3 생산(0064) | 있음 + 작업지시(⑥) |
| 4 비용 · 총원가 · Forecast(0065 · 0081) | 있음 |
| 5 가격 엔진(0066) | 있음 + 경쟁사 줄(⑤) |
| 6 판매 · 매출원가(0067 · 0075 · 0077) | 있음 + 고객별(③) · 분해(④) |
| 7 대시보드 | 뼈대 — 마진 이유 한 줄 · 제품 진단(⑧) |

## 남은 다듬기 — 우선순위 순

1. **0064 작업지시 줄 직접 읽기를 담당자로 좁히기**(새 번호) — 그 전에는 «원료 이름 가림»이 진짜로 가리지 못한다(리뷰 I3).
2. **0067 `cost_margins` 한도 키를 'costing:<회사>'로 합치기**(새 번호) — 원가 관리의 하루 회사 단위 스냅숏이 지금 20 + 20(리뷰 I4).
3. 구매 성과 제한 보기의 «LOT 3개» 문턱 — 분기 묶음 또는 k 키우기(달마다 3 언저리면 한 LOT 짐작 여지).
4. 진짜 데이터 투입 뒤 숫자 검산 — 예상 시장가 · 경쟁사 가정 · 진짜 BOM이 들어간 뒤 Forecast · 분해 · 진단 카드를 손계산과 한 번 대조.
5. 마진 분해 대표 원료별 기여를 출고일 가중으로(지금은 기간 끝 두 점).
6. `cost_secret.sale_costs` 한 번 계산으로 합치기(판매 수천 줄 성능).
7. 견적 목록 경쟁사 줄을 접힌 칸 열 때만 부르기(영업 200건 한도 절약).
8. 진짜 BOM 넣기 화면 안에서 충돌 · 오류 줄 고르기.
9. 제품 진단 차트 십자선 툴팁 · 디자인 다듬기.
10. check:mobile 전체 실행(이번 블록은 스크린샷 4자리 · 폰 1장만).
