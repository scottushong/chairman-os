# 2026-10-12 회계 · 재무 자료 올리기 v2 — 1차(엑셀 14가지 + 자동 넣기)

브랜치 `feat/finance-upload-v2` = `release/finance-upload-v2`. 워크트리는 `C:\Users\Edison Hong\projects\chairman-os-finup`이고, master d47ebf7에서 갈라졌다. push는 하지 않았다.
이 블록은 앞의 «ECOUNT 쉬운 올리기» · «재무 PDF · 사진» 두 블록을 대신한다(대표 결정).

## 0. 조사 (5줄)

1. 예전 `/finance/<회사>/import` 화면에는 칸이 셋(계정과목 · 연간 · 월별)뿐이었다. 표는 0050 `finance_imports`와 0051 등록 RPC이고, 칸은 엑셀 xlsx만 받았다.
2. 결산 · 공식 결산 칸은 이렇다. `closings`(0015)의 `closed` 칸이 마감 달을 정한다. 공식 결산(세무사 확정)은 `/finance/<회사>/statements/new`에서 넣는다.
3. 자료 입구(intake, 0058)는 `INTAKE_OPEN_TO_STAFF=false`라 대표에게만 열려 있다. AI 경로는 `lib/ai/anthropic.ts`(AI_MODEL)를 쓰고, 비용은 `ai_usage_log`에 적는다. 따로 정한 비용 한도는 없었다.
4. 원가 엔진 표는 0067 `cost_sales`(판매 실적), 0061 `cost_purchase_lots`(구매 LOT), 0064 `cost_production_orders` · `_lines`(생산)다. 이번 블록은 이 표들에 쓰지 않는다.
5. 다음 빈 마이그레이션 번호는 **0070**이다. 0069는 AI 어시스턴트 블록이, 0071은 프로세스 차트 블록이 쓴다.

## 결과 표

| 항목 | 결과 |
|---|---|
| 화면 | `https://chairman-os-eosin.vercel.app/finance/biz_dy/upload`. 메뉴 · 탭 이름은 «회계 · 재무 자료 올리기»다. 예전 `/import`는 새 주소로 넘긴다. 화면 문구에서 «ECOUNT 업로드»를 지웠다. |
| 놓는 칸 | 칸 하나에 여러 파일(10개 · 파일당 20MB)을 놓는다. 파일마다 카드가 생긴다: 종류 · 기간 · 상태(자동 넣음 · 확인 필요 · 실패 · 이미 올림 · 되돌림). |
| 체크표 | 14가지 자료를 «이번 달 받은 것 / 아직 없는 것»으로 보여 준다. 회사 · 달마다이고, 달은 고를 수 있다. |
| 14가지 | 판매현황 · 입고 · 재고 · 제조지시(제품별 수량만) · 계정별 원장(계정별 월 합계) · 급여(부서 합계 + 개인 줄) · OFFER SHEET · 자금흐름 · 법인카드 · 베트남 법인 · 해외판촉 · 대출(기준일마다) · 차입 · 절감목표. 시트명이 달라도 머리글 · 제목으로 알아본다(검사로 확인). |
| 열기 | xlsx · csv(UTF-8/EUC-KR)를 연다. DRM · 암호 · 옛 xls는 OLE 모양으로 알아보고 문구로 안내한다. 이름만 xlsx인 웹 표 · 깨진 파일도 문구로 안내한다. PDF · 사진은 «준비 중(2차) — 엑셀로». |
| 버리기(AI · 저장 전) | ④ 원료 투입 줄을 통째로 버린다. ⑥ 이름 · 주민번호 · 계좌 칸을 비우고 사번만 남긴다. ⑨ 카드번호는 뒤 4자리만 남긴다. 머리글 줄만 보고 판단한다(«가짜 은행» 같은 자료 줄은 건드리지 않는다). |
| 분류 | 순서: 학습(시트 모양) → 코드 낱말 점수 → AI. AI는 믿음이 «높음»이 아니고 한도가 남았을 때만 부른다. AI는 JSON(종류 · 머리글 줄 · 칸 번호 · 믿음 · 이유)만 돌려준다. 숫자는 코드가 읽는다. AI에 보내는 것은 시트명 · 머리글 근처 20줄 · 합계 줄뿐이다(버리기 뒤). |
| 검증 | 합계 줄 대조 · 날짜 · 통화 · 음수 · 같은 기간(겹침) · 마감 달 · 같은 파일. |
| 자동 넣기 | 믿음 «높음» + 검증 통과 + 겹침 없음 + 마감 아님이면 자동으로 넣는다. 넣으면 알림이 가고 «되돌리기»가 7일 동안 보인다. 되돌리기는 지우지 않고 무효(voided)로 바꾼다. 바꾸기로 넣은 것을 되돌리면 옛 줄이 되살아난다. |
| 미리보기 | 종류 · 칸(머리글 열 고르기) · 기간 · 겹침(새 값으로 바꾸기 / 기존 값 두기) · 이유를 고친다. 종류 · 칸을 고치면 버리기 뒤의 칸 격자로 서버가 다시 읽는다. 마감 달은 대표 · CFO가 이유를 적어야만 넣는다. |
| 배우기 | 사람이 고친 종류 · 칸을 시트 모양 서명으로 `fin_upload_shapes`에 둔다. 숫자는 두지 않는다(DB가 0~200 정수만 받는다). |
| DB 0070 | `fin_uploads`(기록) · 자료 표 14개 + `fin_payroll_people` · `fin_upload_shapes`, RPC 7개. 정책은 모두 `to authenticated`이고 쓰기 grant는 없다. 원가 엔진 «후보»(①②⑦)는 이 표까지만 쓰고 `cost_*` 표에는 한 줄도 쓰지 않는다. |
| 권한 | 급여 개인 줄 · 급여 대기 줄(people · 칸 격자)은 대표 · CFO만 본다. 나머지는 `can_read_books`(지금 회계 표 기준)를 따른다. 넣기 · 되돌리기는 `can_keep_books`가 판정한다. |
| 비용 한도 | `FINANCE_UPLOAD_AI_PER_FILE` · `FINANCE_UPLOAD_AI_PER_DAY` env 둘(값은 대표가 넣는다). **값이 없으면 AI를 끄고** 낱말로만 분류한다. 호출마다 `ai_usage_log`(feature `finance_upload_classify`)에 적는다. |

## AI 비용 추정(엑셀 한 시트)

견본은 머리글 근처 20줄 + 합계 줄이다(입력 약 1.5~2.5k 토큰, 시스템 프롬프트는 캐시). 출력은 약 0.1~0.2k 토큰이다.
claude-sonnet-5-5(입력 $2 · 출력 $10 / 100만 토큰) 기준으로 **시트 한 장당 약 $0.005~0.007**이다.
14가지를 매달 한 번씩, 그중 절반만 AI를 탄다고 보면 한 달 약 $0.05다. 학습된 모양은 다음 달부터 AI를 부르지 않는다.

## 검사 (워크트리, 하나씩)

- typecheck PASS · lint(바뀐 파일) PASS.
- `check:finance-upload` **PASS**. 진짜 AI 호출 0회다. 확인한 것: 14가지 자동 넣기 · 시트명 다름 · ④ 원료 줄 DB 0 · AI 요청 0 · 급여 이름 · 주민 · 계좌 0 · 카드 뒤 4자리 · 두 번 올리기 · 합계 틀림 · 겹침 · 되돌리기 · 마감 달 · 급여 대기 줄 권한 · 권한 없음 · DRM · 웹 표 · PDF 문구 · 0070 칸 = kinds.ts.
- `check:ecount-import`(바로가기 이름 · 주소 갱신) · `check:migrations` · `check:db-safety` · `check:cost-engine` · `check:cost-import` · `check:boundaries` · `check:attachments` · `check:file-drop` · `check:ask` 모두 PASS.
- staging 시험 SQL 0070(PGlite) **PASS**: a(자동 · 알림 · 같은 파일) · b(겹침) · c(되돌리기 · 옛 줄 되살림 · 급여 개인 줄 · 격자 직원 0) · d(마감 달) · e(권한 · 생산 원료 칸 0 · 감사) · f(anon).
- build --webpack **PASS**.
- DB/RLS 리뷰 1회: Critical 0. Important 3건은 고쳤다 — I-1 pending 열 grant 제외 + `fin_upload_pending`, I-2 되돌리기 잠금, I-3 바꾸기를 되돌리면 옛 줄 되살림. 더해서 급여 칸 격자도 대표 · CFO만 보게 막았다(이것은 내가 찾았다).

스크린샷은 `C:\Users\Edison Hong\projects\chairman-os-finup\.screenshots\finance-upload\`에 있다.
- `staff-1-pc.png` · `staff-1b-pc-main.png` · `staff-2-phone.png`: 경영지원팀장 자리 = 재무 입력 권한자(김병훈 화면과 같은 권한). 판매 자동 · 카드 합계 틀림 · 모르는 시트 · 암호 파일을 올린 화면이고, «회장» · «ECOUNT 업로드» 0을 스크립트가 확인했다.
- `chair-1-pc.png` · `chair-1b-pc-main.png` · `chair-2-phone.png`: 대표 화면. 대출은 자동으로 들어가고, 급여는 합계 틀림으로 확인 필요 · 개인 줄 수(대표 · CFO만)가 보인다.

## 하지 못한 것(2차로)

1. **PDF · 사진 읽기.** 지금은 «준비 중 — 엑셀로» 안내만 한다. 급여 · 제조지시 PDF · 사진은 2차에서도 AI에 보내지 않고 «엑셀로 올려 주세요»로 안내한다(문구는 이미 lib에 있다).
2. ⑤ 계정별 원장은 `fin_ledger_sums`(계정별 월 합계)까지 넣는다. **장부(전표 · 월별 손익)에는 아직 반영하지 않는다.** 장부 반영은 마감 · basis 규칙과 함께 다음 블록에서 한다.
3. ①②⑦ «후보»를 원가 엔진에서 승인하는 화면, 0067 판매 실적 · ③ 재고 잔량과의 대조 보고는 아직 없다. 표만 준비했다.
4. 겹침 선택은 파일 단위(새 값 · 기존 값)다. «줄마다» 고르기는 하지 않았다.
5. 옛 xls(BIFF)는 읽지 못한다. 문구로 xlsx 저장을 안내한다(exceljs는 xls를 못 읽고, npm `xlsx`는 CVE 때문에 쓰지 않는다).
6. 실패한 옛 ECOUNT 업로드 초안(finance_imports draft) 정리는 «그 밖» 칸의 기존 취소 버튼에 맡겼다. 새 흐름은 실패를 바로 failed로 끝내므로 «진행 중»에 남지 않는다.
7. 원본 파일을 첨부로 남기지 않는다(해시 · 이름만 둔다). 필요하면 2차에서 0045 첨부(재무 권한 · AI 제외)로 붙인다.

## 회장이 할 일

| 순서 | 담당 | 상태 | 방법 |
|---|---|---|---|
| 1 | 회장 | 대기 | staging에 0070 반영(명령 1~2) |
| 2 | 회장 | 대기 | staging 시험 SQL(명령 3~4). 기대값: `ERROR 0070 STAGING PASS a(…) … f(anon 거부)` |
| 3 | 회장 | 대기 | (AI를 켤 때만) Vercel env에 `FINANCE_UPLOAD_AI_PER_FILE`(권장 2) · `FINANCE_UPLOAD_AI_PER_DAY`(권장 50)를 넣는다. 넣지 않으면 AI 없이 낱말로만 분류한다. |
| 4 | 회장 | 대기 | master에 합치기(명령 5~6) → 운영 반영(명령 7) |
| 5 | 김병훈 | 대기 | https://chairman-os-eosin.vercel.app/finance/biz_dy/upload 에 이번 달 엑셀을 한꺼번에 놓는다 → «확인 필요»만 보고 넣는다 → 위 체크표에서 빠진 자료를 확인한다. |

```
cd ~/projects/chairman-os-finup
```
```
npm run db:push:staging
```
```
cp docs/onboarding/staging-tests/0070_staging_test.sql supabase/.temp/
```
```
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0070_staging_test.sql"
```
```
cd ~/projects/chairman-os
```
```
git merge --no-ff release/finance-upload-v2 -m "merge: 회계 · 재무 자료 올리기 v2 0070 — 14가지 엑셀 · 자동 넣기 · 되돌리기"
```
```
bash scripts/release-production.sh 0070
```

0069(AI 어시스턴트) · 0071(프로세스 차트)과 함께 반영하면 번호 순서대로 합친다. master에서 `LATEST_MIGRATION`과 `scripts/check-staging-sql-0061.ts`의 분기가 겹치는데, 합칠 때 셋을 모두 남긴다(아래 «합치는 순서»).

## 합치는 순서(셋 함께일 때)

0069 `release/ai-assist` → 0070 `release/finance-upload-v2` → 0071 `release/process-charts`. 충돌은 `src/lib/version.ts`(마지막 번호로) · `scripts/check-staging-sql-0061.ts`(분기 셋 모두) · `src/lib/repository/{types,supabase,dummy}.ts`(펼침 줄 모두)에서만 난다.
