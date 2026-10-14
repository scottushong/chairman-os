# 청사진 뼈대 블록 — 마지막 보고 (2026-10-14)

- **끝낸 것:** 빈칸 8개 모두 «작동하는 최소 형태» — 마이그레이션 `0081_blueprint_skeleton`(새 표 4 + 원료 코드 표 1 · 공개 RPC 17 · 스위치 7) · 화면 8개 · check:blueprint(12묶음) · staging 시험 SQL · 리뷰 1회 + 고침 + 재리뷰 + 재검토 고침.
- **줄인 것:** 없음(화면 · 그래프 모두 만듦). ⑦ 진짜 BOM 넣기는 0063 · 0068에 이미 있어 DB를 새로 만들지 않고 화면 · 문서만.
- **반영 문서:** `C:\Users\Edison Hong\projects\chairman-os-blueprint\docs\onboarding\release-0081.md`
- **대조표:** `C:\Users\Edison Hong\projects\chairman-os-blueprint\docs\reports\2026-10-13-blueprint-gap.md`(뼈대 완성 뒤 · 남은 다듬기 10개)
- **결정 기록:** `C:\Users\Edison Hong\projects\chairman-os-blueprint\docs\decisions\2026-10-13-blueprint.md`(42줄)

브랜치 `feat/blueprint-skeleton`(워크트리 `C:\Users\Edison Hong\projects\chairman-os-blueprint`), push 없음. staging · production 쓰기 없음, service_role 없음, 진짜 AI 호출 0회, 진짜 BOM · 회사 파일 없음(dummy만).

## 8개 기능 결과

| 기능 | 결과 | 스위치 | 기본값 | 화면 주소 |
|---|---|---|---|---|
| ① Forecast 원가 | 됨 — 최신 구매가 × 환율(오늘/대표 입력) ⊕ 다음 달 예상 시장가(없으면 오늘 시장가), 기본 50:50. 대표 원래 값 · 원가 관리 1원. 0075와 섞이지 않음(시험) | `cost_forecast` | 켜짐 · 대표만 | https://chairman-os-eosin.vercel.app/costs/biz_dy · /purchasing/biz_dy/market |
| ② 구매 성과 | 됨 — 절감액 · 환율 효과 손계산 1원 일치(2,800 · 100,000 · 40,000). 구매 · 원가 관리 · CFO 전부, 임원 · 회사 대표는 월만(달 전체로 넓힘 · 작은 묶음 가림) | `purchase_performance` | 켜짐 · 대표만 | https://chairman-os-eosin.vercel.app/purchasing/biz_dy?tab=performance |
| ③ 고객별 수익성 | 됨 — 근거 실제/추정/혼합/계산 불가 · 상위 10. 영업은 본인 매출 · kg · 등급만 | `customer_profit` | 켜짐 · 대표만 | https://chairman-os-eosin.vercel.app/finance/biz_dy/customers |
| ④ 마진 변동 분해 | 됨 — 판매가 · 원료 · 제조 · 물류 · 기타, 합 = 전체(대표 원래 값 · 원가 관리 1원). 원료별은 대표만. 대시보드 한 줄은 코드 문장 | `margin_bridge` | 켜짐 · 대표만 | https://chairman-os-eosin.vercel.app/ |
| ⑤ 경쟁사 가정 | 됨 — 가정(대표 · 원가 관리) · 영업은 예상 최소가 · 목표가 · 마진 % · 등급만 | `competitor_price` | 켜짐 · 대표만 | https://chairman-os-eosin.vercel.app/costs/biz_dy/competitor · /sales/biz_dy/quotes |
| ⑥ 작업지시 | 됨 — 탱크 · 순서 · 담당 · 무작위 원료 코드 · 이번 배치 kg · 투입. 생산은 본인 오더만, 이름 가림 기본 켜짐 | `work_orders` | 켜짐 · 대표만 | https://chairman-os-eosin.vercel.app/production/biz_dy/orders/<오더> |
| ⑦ 진짜 BOM 넣기 | 됨 — 대표만(그 밖 /me), 미리보기 = 제품 코드 · 줄 수 · 문서 | (0063 «진짜 BOM 받기» 스위치) | 꺼짐 | https://chairman-os-eosin.vercel.app/costs/biz_dy/bom/import |
| ⑧ 제품 진단 | 됨 — 카드 대표 11 · 원가 관리 10 · 영업 4, 자료 없으면 «자료 없음 · 필요한 것», 그래프 하나(일→년) | `product_diagnosis` | 켜짐 · 대표만 | https://chairman-os-eosin.vercel.app/costs/biz_dy/products/<제품> |

## 검사

| 검사 | 결과 |
|---|---|
| typecheck · lint | PASS |
| check:migrations (78개, 0001 → 0081) | PASS |
| check:db-safety | PASS |
| check:cost-engine | PASS |
| check:monthly-pl | PASS (39) |
| check:material-lock | PASS |
| check:features | PASS (14) |
| check:blueprint | PASS (12묶음 · 0 실패) |
| check:staging-sql-cost (0081 STAGING PASS a~g 포함) | PASS |
| build (`next build --webpack`) | PASS — 재검토 고침 전 한 번(그 뒤는 SQL · dummy 몇 줄 + typecheck · lint만) |
| 스크린샷 | 대표 · 원가 관리 · 영업 · 생산 자리 PC + 제품 진단 폰 — `.screenshots/blueprint/` |

## 스스로 정한 것 — 상위 10

1. 새 표는 0061~0067 원가 표와 같은 결 — RLS 켬 · FORCE 없음 · grant 없음(정의자 함수로만). FORCE면 운영 소유자 아래 정의자가 0행.
2. 구매 성과 «구매가» = 물건값(단가 × 환율, 부대비 빼고) — 시장가도 물건값이라.
3. 고객별 원가 = 0067 판매 한 줄 실제 원가 — 0075 월 매출원가는 회사 · 월 합계라 섞지 않음.
4. 임원 · 회사 대표 · (영업 줄 가진) CFO의 구매 성과 = 월 묶음만 · 기간은 달 전체로 넓힘 · LOT 3개 미만이나 시장가/외화 LOT가 셋 미만인 칸은 가림.
5. 작업지시 원료 코드 = 원료마다 무작위(id의 md5가 아님 — 생산이 원료 id 목록으로 되짚을 수 있었다).
6. Forecast · 고객별 · 분해는 원가 관리 목록과 같은 한도 키 — 하루 회사 단위 조회 20번을 함께 씀.
7. 제품 진단 ④ 구매 절감 카드는 대표만 — 원가 관리에게 주면 «이 제품에 드는 원료»가 샌다.
8. 제품 추이의 Market 원료비는 대표만 기간마다, 원가 관리는 오늘이 든 기간 하나만(지난 날짜 합계 여러 개 = BOM 역산).
9. 마진 분해는 GM 원/kg(kg 가중) 기준, 대표 외 1원 표시는 반올림 차이를 가장 큰 효과 하나에 몰아 합 = 전체.
10. 경쟁사 가정 빈 칸 = 우리 값(제조 · 물류 = 우리 비용 묶음, 마진 15%).

## 진짜 데이터가 있어야 의미가 생기는 것 · 대표가 할 일

- **진짜 BOM** — 0063 키(staging에는 있음) · «진짜 BOM 받기» 켜기 → /costs/biz_dy/bom/import에 R2 내보내기 파일. 그 전까지 Forecast · 분해 원료별 · 진단 숫자는 가짜 BOM 기준이다.
- **다음 달 예상 시장가** — 구매팀이 /purchasing/biz_dy/market «다음 달 예상»에 입력. 없으면 Forecast가 오늘 시장가를 쓴다.
- **예상 환율 · 섞는 비율** — 대표가 /costs/biz_dy «Forecast 설정»(기본 오늘 환율 · 50:50).
- **경쟁사 가정** — 대표 · 원가 관리가 /costs/biz_dy/competitor에 제조 · 물류 · 마진. 없으면 우리 값으로 계산하고 카드에 «경쟁사 가정 없음».
- **작업지시 담당 · 탱크 · 순서** — 대표가 오더마다 지정. 담당 없는 오더는 생산 직원에게 안 보인다.
- **판매 · 생산 기록 두 달 이상** — 분해 · 마진 하락 이유 · 고객 근거(실제)가 채워진다.

## 하지 못한 것 · 남은 위험

- 생산 직원은 0064 표(`cost_production_order_lines`)를 직접 읽을 수 있어 «원료 이름 가림»이 진짜로 가리지는 못한다 — 표 정책 좁히기는 다음 번호(대조표 1번).
- 0067 마진 목록은 따로 한도 키 — 원가 관리 하루 회사 단위 스냅숏이 20 + 20(대조표 2번).
- 구매 성과 가림은 묶음 단위 — 달마다 LOT 수가 3 언저리면 달 차이로 한 LOT를 짐작할 여지.
- 원가 관리는 원료 시세 · LOT와 제품 Forecast 합계를 함께 본다 — 0062 «원가 관리 감수 조건»과 같은 역산 위험(설계서 16절 ③)이 식 하나 더 늘었다(한도 키 공유로 횟수는 그대로).
- build는 재검토 고침 전에 돌렸다(그 뒤 바뀐 것은 SQL 한 함수 · dummy 몇 줄 · 시험 — typecheck · lint PASS). check:mobile 전체는 돌리지 않았다.
- 0081은 staging에 없다 — 운영 전 a) ~ b) 필요.

## 회장이 할 일

| 순서 | 담당 | 상태 | 방법 |
|---|---|---|---|
| 1 | 회장 | 대기 | 0069 ~ 0079 운영 반영 — `C:\Users\Edison Hong\projects\chairman-os-blueprint\docs\onboarding\release-2026-10-13-all.md` |
| 2 | 회장 | 대기 | 0080 운영 반영 — `C:\Users\Edison Hong\projects\chairman-os-pricelock\docs\onboarding\release-0080.md` |
| 3 | 회장 | 대기 | 0081 staging push — release-0081.md a). Git Bash에서 `cd ~/projects/chairman-os-blueprint` 다음 `npm run db:push:staging` |
| 4 | Claude Code 가능 | 대기 | 0081 staging 시험 — release-0081.md b) 한 줄 반복문, 기대 `0081 STAGING PASS a(…) … g(anon 거부)` |
| 5 | 회장 | 대기 | master 합치기 — `cd ~/projects/chairman-os` 다음 `git merge --no-ff feat/blueprint-skeleton -m "release: 0081 청사진 뼈대"` |
| 6 | 회장 | 대기 | 운영 반영 — `RELEASE_DRY_RUN=1 bash scripts/release-production.sh 0081` 다음 `bash scripts/release-production.sh 0081` |
| 7 | 회장 | 대기 | health — `curl -sS https://chairman-os-eosin.vercel.app/api/health` |
| 8 | 회장 | 선택 | 직원에게 열기 — https://chairman-os-eosin.vercel.app/settings/features 에서 기능마다 범위(이유 필수) |
| 9 | 회장 · 구매팀 | 진짜 데이터 | 진짜 BOM(/costs/biz_dy/bom/import) · 다음 달 예상 시장가 · 경쟁사 가정 · 작업지시 담당 |
