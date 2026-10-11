# 2026-10-11 블록 — 0부 기록 · 1부 원가 엔진 엑셀 «넣기만» (0068)

작성: 2026-10-11 · 브랜치 `feat/excel-import`(워크트리 `C:\Users\Edison Hong\projects\chairman-os-excel`) · push 없음 · 어느 DB에도 0068 없음.
시작 메모리: 남은 메모리 4.04GB / 15.5GB, **크롬 31개 프로세스 4.83GB가 여전히 떠 있었다**(회장이 껐다고 한 뒤).

## 0부 — 기록 (master `4073eb5`, 커밋만)

- `C:\Users\Edison Hong\projects\chairman-os\docs\OPERATIONS.md` §9 «되돌리는 길»에 한 줄: 2026-10-11 릴리스(0050~0066 · `8419b81`) — 복원 지점 `2026-10-11 02:07 UTC`(= 11:07 KST, production 0060) · 직전 SHA `96e563c`.
- `C:\Users\Edison Hong\projects\chairman-os\docs\HANDOVER.md` 현황 표 맨 위에 «2026-10-11 — 운영 큰 반영 뒤»: 운영 DB 0066 · origin `8419b81` · 운영 BOM 키 새 값 · 원가 권한자 0명 · 입구 스위치 꺼짐 · 0067은 feat/cost-engine에만.

## 1-1. 빼기 경로 현황 → 처리

| 화면(URL) | 경로 | 있던 것 | 처리 |
|---|---|---|---|
| `/purchasing/<회사>/lots` 구매 첨부 | 버튼 «내려받기» · 파일 이름 링크 → 서버 액션 `downloadDocAction` → Storage `purchasing` 서명 URL | 구매 · 원가 관리가 내려받음 | **대표만**: 버튼 · 링크는 대표 화면에만(`purchase-docs.tsx` `canDownload`), 서버 액션이 대표 외 거부, 감사가 먼저(`cost_purchase_doc_download_log` · action `export`), Storage 읽기 정책(`cost_doc_object_visible`)도 대표만 — 올린 사람만 1시간 자기 파일(올리기가 storage-api의 insert … returning에 죽지 않게, 리뷰 V1) |
| `/purchasing/<회사>` · materials · suppliers · market | — | 내려받기 · 복사 버튼 없음 | 그대로(없음 확인 — `check:cost-import` ④가 정적 검사) |
| `/production/<회사>` | — | 없음 | 그대로 |
| `/costs/<회사>` · `/costs/<회사>/bom` | — | 없음 | 그대로 |
| AI 도구(`src/lib/ai/**`) · 첨부 요약 · 입구 | 원가 함수 · BOM · 원가 엑셀을 부르는 도구 | 없음 | 그대로(④ 정적 검사: `cost-import` · `bom` 문자열 0) |
| 0067 마진 엑셀(feat/cost-engine) | `cost_margins_download_log` | **원가 관리도 허용** | **대표만으로 좁힘**(`C:\Users\Edison Hong\projects\chairman-os-cost\supabase\migrations\0067_cost_sales.sql` · 시험 `scripts/cost-engine-sales.ts`) — feat/cost-engine 커밋은 아래 «검사» 참고 |
| 유지 | `/sales/<회사>/quotes/<견적>/download`(고객용 견적서 — 원가 · 마진 없음), `/approvals/ledger/export`(결재 대장) | — | 회장 결정대로 유지 |
| 허용 | `/cost-import/template/<대상>` 빈 양식 | 새로 | 칸 이름 · 가짜 예시 한 줄 · 설명 시트. 저장소를 부르지 않는다. 내려받아 본 결과 실제 자료 칸 0(스크린숏 실행 로그 «real data cells 0») |

남은 것: 화면 표의 글자를 마우스로 골라 복사하는 것은 브라우저 기본이라 막지 않았다(미결 1).

## 1-2. 공통 틀

- 파일 놓기: 공통 `FileDropZone` · xlsx 하나 · 2MB · .xls/CSV는 «xlsx로 저장» 안내 · 앞머리 바이트 검사(ECOUNT와 같은 함수).
- 읽기: 서버 액션 본문의 바이트를 **exceljs로 코드만** 읽는다(`src/lib/cost-import/workbook.ts`). 파일은 Storage · 임시 파일 · 로그 어디에도 저장하지 않는다 — 브라우저가 File을 들고 미리보기 · 등록 때마다 다시 보낸다. AI 경로 0.
- 칸 맞추기: 머리글 동의어로 짐작(앞 20행에서 머리글 행도 짐작 — R2처럼 제목 줄이 있어도 됨) → 사람이 «이 칸 지정으로 미리보기»로 확정해야 등록이 풀린다.
- 등록: 서버가 **원본을 다시 읽고 계획을 다시 만든 뒤** DB 함수 한 번 `cost_import_apply`(security invoker — 대상 표의 RLS · 도장 · 이상치 · 잔량 · 감사 트리거가 화면 입력과 똑같이 돈다, 한 트랜잭션 · 전부 아니면 전무).
- 감사: 엑셀 한 번 = `cost_imports` 한 줄 + `audit_log` 한 줄(파일 이름 · 줄 수 · sha256 · 바꾼 줄(이전 값 · 이유) · 고친 칸 «파일 값 → 고친 값», BOM은 «고침»만). 줄마다의 기존 감사 트리거도 그대로.
- 같은 파일 두 번: 회사 · 대상 · sha256 유일 → 미리보기에서 잠김 + DB 거부.
- 한도: 파일당 500줄(비용 200 · BOM 1000줄 = 판 200) · 사람 · 대상마다 하루 20번.

## 1-3. 대상별 양식 · 권한 · 검증

| 대상 | 권한(화면 입력과 같음) | 칸 | 검증 |
|---|---|---|---|
| 원료 | 구매 입력 | 원료 이름* · 단위(kg만) · 분류 · 규격 · 메모 | 이름 120자 · 분류 다섯 중 하나 |
| 공급처 | 구매 입력 | 공급처 이름* · 국가 · 통화 · 연락처 · 조건 · 메모 | 통화 세 글자 |
| 시장가 | 구매 입력 | 원료* · 날짜* · 가격* · 통화 · 환율 · 출처* · 출처 주소 · 메모 | 원료 이름 못 찾으면 오류(자동 생성 없음 · «먼저 원료 엑셀») · 내일보다 먼 날짜 거부 · 같은 원료 같은 날 출처 셋 · **90일 중앙값 5배/1/5 이상치 거부**(대표 외 — DB 트리거 그대로, 미리보기도 같은 규칙) · 환율 없으면 오류 |
| 구매 LOT | 구매 입력 | 원료* · 공급처* · 입고일* · kg* · 단가* · 통화 · 환율 · 운송 · 관세 · 부대 · 공급처 LOT 번호 · 주문일 · 메모 | Landed는 DB가 계산(source `import`) · 이상치 · 미래 날짜 |
| 비용 줄 | 원가 관리 | 항목* · 방식*(월 금액/원/kg) · 금액* · 범위(제품 이름, 비우면 모든 제품) · 시작일* · 메모 | 범위는 원/kg만 · 배부 설정은 화면에서만 |
| 생산 LOT · 투입 | 생산 입력 | 오더* · 생산일* · 산출 kg* · 투입 LOT* · 투입 kg* · 메모 | 같은 오더 · 생산일 · 산출 kg = 생산 LOT 하나 · 열린 오더만 · **잔량 초과 거부**(파일 안 누적 포함, DB 트리거 그대로) · 생산일 < 입고일 거부 |
| BOM | **대표만** | 제품* · 시작일* · 수율* · 원료* · 원료 kg/제품 kg* · 메모 | 같은 제품 · 시작일 = 판 하나 · 판 안 수율 같음 · 원료 중복 거부 · 200줄 · 소수 8자리 · 저장은 0063 `cost_bom_save`(암호문) · «진짜 BOM 받기» 꺼져 있으면 가짜만(서버 · DB 둘 다) · 미리보기 화면은 대표 세션에만 · 오류 문장에 값 없음 |

## 1-4. 겹침 · 충돌

| 대상 | 같은 줄(건너뜀) | 충돌 | 중복 의심 | «둘 다 맞음» |
|---|---|---|---|---|
| 시장가 | 같은 원료 · 날짜 · 출처 · 가격 · 통화 | 같은 원료 · 날짜 · 출처, 가격 다름 | — | 불가(출처가 기준 칸) — 같은 날 **다른 출처는 충돌 아님**(평균) |
| 구매 LOT | — | 같은 원료 · 공급처 · 입고일 · kg, 단가 · 비용 다름 | 값까지 같음 → «그래도 넣기» | 공급처 LOT 번호가 다를 때만 |
| 비용 줄 | 같은 항목 · 범위 · 시작일 · 방식 · 금액 | 같은 항목 · 범위 · 시작일, 금액 · 방식 다름 | — | 불가 |
| 원료 · 공급처 | 이름 같고 다른 칸 같음(빈 칸은 «기존 유지») | 이름 같고 다른 칸 다름 | — | 불가(이름 유일) |
| BOM | — | 같은 제품 · 시작일 판이 이미 있음(값은 보이지 않음 — «판 #n 있음») | — | 불가 |
| 생산 | — | — | 같은 오더 · 생산일 · 산출 kg 생산 LOT가 있음 | — |

- 파일 안 겹침: 새 줄끼리 같은 기준이면 값이 같으면 «같은 줄», 다르면 둘 다 충돌 → 한 줄 «이 줄 버림»을 고르면 서버가 다시 재서 짝 줄이 새 줄로 돌아온다.
- 처리: «기존 유지»(엑셀 줄 버림) · «엑셀 값으로 바꾸기»(기존 줄 무효 + 새 줄, **이유 필수**, 원료 · 공급처는 마스터 수정 + 이전 값 감사) · «둘 다 맞음»(구분 칸이 다를 때만). 두 줄이 같은 기존 줄을 바꾸면 잠김.
- 칸 고치기: 미리보기 칸을 눌러 고침 → 색 표시 · 감사에 «파일 값 → 고친 값»(BOM은 «고침») · 고친 뒤 이상치 · 충돌을 서버가 다시 잰다.
- 등록 잠김: 칸 지정 미확인 · 필수 칸 없음 · 오류 · 충돌 미처리 · 바꾸기 이유 없음 · 중복 의심 미확인 · 같은 파일 · 넣을 줄 0.
- 동시 변경: 미리보기 때 자료 도장(md5) → 등록 때 DB가 회사 · 대상 잠금 뒤 다시 재서 다르면 «자료가 바뀌었습니다 — 다시 미리보기».
- 바꾸기 알림: 바꾼 줄을 넣은 사람이 다른 사람이면 그 사람에게 알림(값 없이, 이 트랜잭션에서 실제로 바꾼 줄만 — 위조 불가).
- 영업 0시 기준: 바꾸기 = 무효 + 새 줄이라 `created_at · voided_at`이 지금 → 영업은 내일부터 새 값(0062 `known` 그대로).

## 1-7. DB/RLS 리뷰 (1회 · 백그라운드 에이전트)

Critical 0 · Important 3 + 확인 1 → 전부 고침(`b6cbdc4`):
- I1 원료 · 공급처 바꾸기가 이전 값 · 이유를 남기지 않음 → 감사에 `before` · `reason`, 빈 칸은 기존 값 유지.
- I2 `cost_imports`에 직접 넣어 남의 파일 해시 막기 · 가짜 감사 줄 → 넣기 grant · 정책 삭제, 정의자 `cost_import_log`가 «이 트랜잭션에서 이 사람이 실제로 넣고 바꾼 줄»을 대조한 뒤에만 넣음.
- I3 0067 `cost_margins_download_log`가 원가 관리에게 열림 → 대표만(feat/cost-engine).
- V1 Storage 읽기를 대표만으로 좁히면 직원 업로드가 죽을 수 있음 → 올린 사람 1시간 자기 파일 허용. **staging에서 직원 업로드 한 번 확인 필요**(회장이 할 일 5).
- Minor 고침: M1(다른 회사 제품 BOM 거부) · M2(BOM 고친 칸 값 저장 안 함) · M3 · M6(로그에 시트 이름 대신 코드). M4(500줄 × 트리거 시간 — staging 실측 필요) · M5(도장 = 변경 신호, 수용)는 미결.

## 1-8 · 1-9. 시험 · 검사

- `npm run check:cost-import`(`scripts/check-cost-import.ts`) PASS — ① PGlite 전 마이그레이션: 대상 7종 등록 · 같은 파일 두 번 · 동시 변경 · 권한 없는 사람(영업 · 남의 회사 · 시스템 · 구매 읽기만 · 생산 · anon) · 바꾸기 이유 없음 거부 · 무효 + 새 줄(이력) · 알림 · 이상치 한 줄이면 파일 전체 되돌림 · 잔량 초과 · 숫자 모양 오류에 값 없음 · BOM 대표만 · 같은 날 판 조용히 갈지 않음 · 진짜 스위치 · 하루 20번 · 직접 넣기 · 가짜 감사 거부 · 첨부 대표만 · 영업은 엑셀 감사 못 봄 ② 계획 ③ 빈 양식 ④ 빼기 경로 0.
- staging 시험 SQL `C:\Users\Edison Hong\projects\chairman-os-excel\docs\onboarding\staging-tests\0068_staging_test.sql` — `check:staging-sql-cost`가 PGlite에서 먼저 돌린다.
- 검사 결과(하나씩 · 동시에 둘 안 돌림):
  - feat/excel-import `2a1e893`: typecheck · lint · check 27종(db-safety ~ staging-sql-cost) · check:migrations · build(--webpack) **전부 PASS**.
  - release/excel-rehearsal(0067 + 0068): typecheck · lint · check:migrations + check 27종 · build(--webpack) **전부 PASS**(19:36 · 빌드 뒤).
  - 고친 기존 검사 둘: check:cost-engine(원가 관리가 구매 첨부 파일을 읽던 단언 → 0068부터 대표만 + 올린 사람 1시간), check:sales-cost(dummy 엑셀 넣기가 가짜 BOM 저장소를 직접 import → dummy.ts가 넘김).
  - check:mobile은 돌리지 않았다(dummy 서버 + 120화면 — 메모리). 엑셀 넣기 폰 화면은 스크린숏 07 · 07b(가로 넘침 0px).
- 스크린숏 `C:\Users\Edison Hong\projects\chairman-os-excel\docs\reports\2026-10-11-excel-import-shots\` (dummy · 대표 세션):
  01 칸 맞추기 · 02 상태(새 1 · 같은 1 · 충돌 3 · 오류 1) · 03 고친 칸 색 + 잠김 이유 · 04 이유 적음 · 05 등록(4줄 · 바꾼 1 · 건너뜀 2) · 06 같은 파일 잠김 · 07/07b 폰(가로 넘침 0px) · 08 LOT 중복 의심 · 09 비용 줄 · 10 BOM(R2 모양 — 제목 줄 + 머리글 2행 짐작).
  직원 세션 스크린숏은 못 찍었다(dummy 서버 하나 = 사용자 하나) — 권한 없는 사람 거부는 DB 시험 ①로 갈음.

## 화면 URL (반영 뒤)

- https://chairman-os-eosin.vercel.app/purchasing/biz_dy/materials · /suppliers · /market · /lots — «엑셀로 넣기» · «빈 양식 받기»(구매 입력 권한자 · 대표)
- https://chairman-os-eosin.vercel.app/costs/biz_dy — 비용 줄(원가 관리 · 대표)
- https://chairman-os-eosin.vercel.app/production/biz_dy — 생산 LOT · 투입(생산 입력 · 대표)
- https://chairman-os-eosin.vercel.app/costs/biz_dy/bom — BOM(대표만)
- https://chairman-os-eosin.vercel.app/cost-import/template/market_prices — 빈 양식(대상: materials · suppliers · market_prices · purchase_lots · overheads · production · bom)

## 운영 반영 순서 — 권장안

**0067(DB만)과 0068을 함께** 낸다. 0068을 먼저 내면 나중 0067이 «순서 뒤바뀜»(`--include-all`)이 되고, 0067은 리뷰 · 검사가 끝났다(화면은 아직 — 표는 비어 있어도 무해). 순서: feat/cost-engine(0067 + 대표만 고침) → release/cost-rehearsal 합침 → feat/excel-import 합침 → staging `db:push:staging`(0067 · 0068) → staging 시험 SQL 0066 · 0068 + 직원 업로드 한 번 → 운영 `release-production.sh 0067 0068`. 원가 권한자가 0명이라 운영에 넣어도 당장 쓰는 사람은 대표뿐이다.

## 1-10. staging 리허설

- 브랜치 `release/excel-rehearsal`(워크트리 `C:\Users\Edison Hong\projects\chairman-os-rel68`) = master `4073eb5` + feat/cost-engine `7dbf0ba`(0067 · 마진 내려받기 대표만) + feat/excel-import. 충돌 1(`src/lib/version.ts` LATEST_MIGRATION → 0068).
- staging은 0066까지. 이 브랜치에서 `db:push:staging`하면 **0067 · 0068 둘**이 들어간다(dry-run에서 숫자 확인).
- staging 시험 SQL 0068은 PGlite에서 PASS(`check:staging-sql-cost`). 리허설 검사 결과는 아래.

## 미결

1. 화면 글자 선택 복사는 막지 않음(CSS로 막아도 개발자 도구로 뚫림 — 의미 없음 판단). 회장 결정 필요하면 `user-select: none`만 가능.
2. 리뷰 M4 — 500줄 · 생산 200투입 파일이 Supabase 기본 statement_timeout(8초)에 걸릴 수 있음. staging에서 실측.
3. 리뷰 V1 — staging에서 구매 직원 첨부 올리기 한 번 확인.
4. 원료 · 공급처 «둘 다 맞음» 없음(이름 유일). R2 BOM이 «%» 비율로만 나오면 kg/kg로 바꾼 칸이 필요(지금은 kg/kg만).
5. dummy 등록은 한 트랜잭션을 흉내 내지 못함(계획이 같은 검사를 먼저 다 돌림).
6. 0067 화면(deals · margins)은 여전히 미착수 — 마진 엑셀을 만들면 대표 세션에서만 그리고 `cost_margins_download_log`를 먼저 부를 것.

## 회장이 할 일

| 순서 | 담당 | 상태 | 방법 |
|---|---|---|---|
| 1 | 회장 | 대기 | 이 보고와 스크린숏 확인 — `C:\Users\Edison Hong\projects\chairman-os-excel\docs\reports\2026-10-11-excel-import-shots\` |
| 2 | 회장 | 대기 | 권장안(0067 DB + 0068 함께) 승인 여부 |
| 3 | 회장 | 승인 뒤 | staging 반영(0067 · 0068 — dry-run에서 둘인지 확인): 아래 명령 상자 ①② |
| 4 | 회장 | 3 뒤 | staging 시험 SQL 0068: 상자 ③④⑤ — 기대 `ERROR 0068 STAGING PASS a(…) … f(anon 거부)` |
| 5 | 회장 | 3 뒤 | staging Preview에서 구매 직원(리허설 계정)으로 구매 첨부 하나 올리기 → 올라가는지(리뷰 V1). Preview를 띄우려면 브랜치 push가 필요 — 상자 ⑥ |
| 6 | 회장 | 4 · 5 뒤 | 운영 반영 — OPERATIONS §9 순서(`release-production.sh`), 대기 번호 0067 0068 |

① 
```
cd ~/projects/chairman-os-rel68
```
② 
```
npm run db:push:staging
```
③ 
```
cp docs/onboarding/staging-tests/0068_staging_test.sql supabase/.temp/
```
④ 
```
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0068_staging_test.sql"
```
⑤ 
```
rm -f supabase/.temp/0068_staging_test.sql
```
⑥ 
```
git push origin release/excel-rehearsal
```
