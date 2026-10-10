# 2026-10-10 블록 보고 — 1부 검사 마무리 · staging 0066 준비 / 2부 판매 · 회계 0067

작성: Claude Code · 2026-10-11 00:55 (KST) · 블록 시작 2026-10-10 19:23 · **4시간 초과로 2부 중간에서 끝냄**

## 0. 시작 상태

- 남은 메모리 **1.57GB / 15.5GB** (19:23). 크롬 프로세스 30개(5.0GB)가 아직 떠 있었고, 다른 세션의 DEBUTPHOTO `next dev`(약 950MB) · eslint가 돌고 있었다(손대지 않음).
- 지시문 «현황»의 운영 Vault 키 결과 · staging 0061_0065 재시험 결과 칸이 비어 있었다 → 아래 1-6은 두 경우를 다 적는다.
- 규칙 위반 1건: check:cost-engine 직전 남은 메모리가 1.1GB였는데, 확인과 실행을 한 명령으로 묶어 그대로 돌았다(통과). 그 뒤로는 확인을 따로 했다.

## 1부 — 검사 마무리 + staging 0066 준비

### 1-1. feat/cost-engine 검사 (C:\Users\Edison Hong\projects\chairman-os-cost)

| # | 검사 | 결과 | 고친 것 |
|---|---|---|---|
| 1 | next typegen | ✓ | |
| 2 | typecheck | ✓(고친 뒤) | `src/app/(dashboard)/approvals/new/page.tsx` 재상신 초기값 templateKey를 손으로 올리는 다섯 양식으로 좁힘(TS2322) |
| 3 | lint | ✓(고친 뒤) | 안 쓰는 import 둘 · eslint가 gitignore된 `.screenshots/`를 읽지 않게 |
| 4 | check:cost-engine | ✓ | ⑬ 리뷰 수정 시험(I1 양식 칸 · I2 겸직 0행 · M3 · I3 too_low) 포함 |
| 5 | check:sales-cost | ✓(고친 뒤) | dummy «가격 예외» 양식에 **마진 % 칸이 남아 있었다**(I1 거울 누락) → 삭제 |
| 6 | check:purchasing | ✓ | |
| 7 | check:staging-sql-cost | ✓ | 0066 시험 b에 «양식에 margin_pct 없음» 단언 추가 후 PGlite PASS |
| 8 | check:migrations | ✓ | |
| 9 | build(--webpack) | ✓ | 컴파일 72초 |

### 1-2. 스크린샷 (dummy, 영업 직원, 서버 하나 → 끔)

폴더: `C:\Users\Edison Hong\projects\chairman-os-cost\.screenshots\2026-10-10-quotes\`
- PC: `sales-pc-list.png` · `sales-pc-new-green.png` · `sales-pc-new-red.png` · `sales-pc-green-confirmed.png` · `sales-pc-red-draft.png` · `sales-pc-red-pending.png` · `sales-pc-approval-price-exception.png` · `sales-pc-customer-quote.png`
- 폰: `sales-phone-list.png` · `sales-phone-new-green.png` · `sales-phone-red.png` · `sales-phone-approval-price-exception.png` · `sales-phone-customer-quote.png`
- 결재 상세 «가격 예외» 양식 칸 = 견적 번호 · 제품 · kg · 제시가 · 통화 · 등급 — **마진 % 없음**.
- 금지어 검사(스크립트 `scripts/shot-quotes.ts`): «회장» · 원료 이름 넷 · 공급처 둘 · 고객용 견적서의 원가/마진/등급 — **0건**.
- 고객용 견적서는 xlsx라 내려받은 칸을 표로 그려 찍었다(견적일 · 유효기간은 엑셀 날짜 칸).

### 1-3. 기록
- `89fa5ec` — 732f9ee의 «검사 미실행»을 통과 기록으로 대신(고친 셋 포함). `5224b9c` — 스크린샷 스크립트.

### 1-4. release/cost-rehearsal (C:\Users\Edison Hong\projects\chairman-os-cost-rehearsal)
- `5ba9358` = feat/cost-engine(5224b9c까지) 합침. 충돌 셋: `src/lib/repository/types.ts`(입구 + 견적 import 둘 다) · `package.json`(HEAD에 이미 있는 줄 — HEAD) · `0066_staging_test.sql`(feat 쪽).
- typegen · typecheck ✓ · check:cost-engine ✓ · check:staging-sql-cost ✓(0061_0065 · 0066).
- **0067은 rehearsal에 넣지 않았다**(대기 — 회장이 staging 0066 PASS를 알린 뒤).

### 1-5. staging 0066 반영 · 시험 (회장이 칠 것)
- staging `migration list`(읽기 전용, 2026-10-10 21:30 확인): 0001~0065 반영, **대기 0066 하나**.
- 명령은 아래 «회장이 할 일» 표 2~4.
- 기대 문구(ERROR로 나오는 것이 정상):
  `0066 STAGING PASS a(Green 스냅숏 = 영업 화면 0시 기준 · 바로 확정 · 표 쓰기 거부 · 내려받기 감사) b(Red 결재 전 확정 거부 · 손 가격 예외 거부 · 양식 마진 % 없음 · 결재 원료 0 · «회장» 0 · 사슬 n칸 → 대표 승인 → 확정) c(…) d(…) e(anon 거부)` — «FAIL»로 시작하면 그 줄을 알려 주세요.

### 1-6. 운영 Vault 키 `cost_bom_key` 권장안
운영(nndvspgnljivkvihxlzj)에는 0063이 아직 없다 → **암호문이 하나도 없으므로 지금은 키를 바꿔도 잃는 것이 없다.**
- **한 줄이 나왔다면:** 회장이 직접 만든 기억이 확실하지 않으면 **그 키를 쓰지 말고 0063 운영 반영 직전에 값을 새로 바꾼다**(누가 · 어떤 방법으로 만들었는지 모르는 키는 값이 밖에 적혔을 수 있다). 바꾸는 SQL은 표 7. 회장이 2026-10-09 이후 `docs/onboarding/bom-key-setup.md` 4절대로 SQL Editor에서 만든 기억이 있으면 그대로 써도 된다(그 방법은 값을 화면에 내지 않는다).
- **0줄이었다면:** 운영 순서 «0061~0067 db push 직전»에 `bom-key-setup.md` 4절(확장 확인 → 키 한 줄 → 이름 · 시각 확인)을 한다. 마이그레이션보다 먼저 해도 된다.
- 어느 쪽이든 0063 반영 뒤 `select length(cost_secret.bom_key()) > 0;` 이 true인지 본다(값은 보이지 않는다).

## 2부 — 판매 · 회계 0067 (feat/cost-engine, 중간에서 끝남)

### 한 것
- `supabase/migrations/0067_cost_sales.sql`
  - 표 `cost_sales`(출고일 · 고객 · 제품 · kg · 1원 판매가 · 통화/환율 · 확정 견적 선택 · 생산 LOT 선택 · 대체 앞 줄 · 기록 순간 영업 스냅숏). 쓰기 권한 없음 · 얼림 트리거(무효 칸만 한 번) · delete 막음.
  - 읽기 정책 `cost_sales_read` **to authenticated**: 본인 · subtree 영업 팀장 · 대표, 0066과 같은 겸직 거부 · 지금 영업 줄. 원가 관리는 표 0행(함수로만).
  - `sale_record`(영업 쓰기 줄 · 대표 — 원가 문 한 건 · 감사 · 0시 기준 스냅숏 · 하한 미만이면 `too_low`로 **기록은 남기고 마진 없음** · 문 뒤 raise 없음 · 대체는 이유 필수) · `sale_void` · `sale_lot_options`(LOT 번호 · 생산일만).
  - `cost_secret.sale_actual`(Actual / Current + 출고일 비용, 배부 불가면 계산 안 함) · `cost_margins`(대표 원래 값 · 원가 관리 1원, 판매 한 줄/제품/고객/전체 × 일/주/월/분기/년, **원래 값끼리 합한 뒤 1원**, 하루 20번 · 호출마다 감사) · `cost_margins_download_log`.
  - 영업이 읽는 칸에 실제 원가 · 실제 마진 없음.
- `scripts/cost-engine-sales.ts` = check:cost-engine **⑭ PASS**: 출고(Current/Actual) · 위조 · 모양 · 대체 · 무효 · 읽기(열 사람 + anon) · 마진 거부(영업 · 구매 · 생산 · 줄 없는 임원/CFO · 다른 회사 · AIAgent · 팀장) · 겸직 거부 · 대표 원래 값 · 원가 관리 1원 · 견적 순간 총원가 · **합산 1원 끝자리** · 주 = 월요일 · 원가 없음 n건 · 20번 한도 · 엑셀 감사.
- `src/lib/version.ts` LATEST_MIGRATION = 0067_cost_sales · 설계서 `docs/superpowers/specs/cost-engine.md` **20절**(회계 연결 설계: 매출 · 매출원가 전표 초안 모양, ECOUNT 우선, 자동 전표는 승인 뒤).

### 못 한 것(다음 블록)
1. **DB/RLS 리뷰 루프** — 리뷰 에이전트가 10분 무응답으로 멈췄다(22시 무렵). 0067은 **리뷰 미완** 상태로 커밋했다. 다음 블록 첫 일.
2. 화면 `/sales/<회사>/deals`(견적 상세 «출고 기록») · `/costs/<회사>/margins`(묶음 · 엑셀) · 저장소(live · dummy) · dummy 시나리오 · 스크린샷.
3. staging 시험 SQL에 판매 단계(PGlite 먼저) · check:migrations · lint · build를 0067과 함께 다시.
4. release/cost-rehearsal에 0067 — 회장의 staging 0066 PASS 뒤.

### 결정 · 가정(DEFERRED 성격)
- 영업이 보는 «등급»은 **기록 순간 0시 기준 총원가 대비 판매가 등급**(견적 · 제시가 확인과 같은 값)이다. 실제 원가 등급을 영업에 주면 판매가를 바꿔 기록 · 대체하는 것으로 실제 원가를 좁힐 수 있다(무효 + 새 줄이 오라클이 됨).
- 생산 LOT는 판매 한 줄에 하나(설계서 처음 안의 배열 대신 — FK로 회사 · 제품을 확인하려고). 여러 LOT 출고는 줄을 나눈다.
- 감사 action은 enum에 없는 'void' 대신 'update'(0066과 같다 — `alter type`을 트랜잭션 안에서 쓰지 않으려고).

## 운영 반영 순서 권장
1. 0060 ✓(운영 health ok).
2. **B(ECOUNT 0050 · 0051 · 0052 · 0056) · C(입구 0058)를 원가 엔진보다 먼저 낼지:** 김병훈 ECOUNT 실제 엑셀이 아직 없으므로 **B는 실제 엑셀로 staging 시험을 한 번 한 뒤**에 낸다 — 빈 채로 먼저 내도 해는 없지만, 첫 업로드에서 매핑이 틀리면 운영에서 고치게 된다. C(입구)는 원가 엔진 구매 화면과 같은 파일을 쓰므로 원가 엔진과 같이 내도 된다. 권장: **C → (키) → 0061~0066 → B는 엑셀 도착 후**. 다만 번호가 0050~0058 → 0061 순이라 `db push`는 B를 건너뛸 수 없다(`--include-all`도 «대기 전부») — B를 늦추려면 원가 엔진도 늦어진다. 그래서 현실적 권장은 **B · C · 0061~0066을 한 번에 내고, ECOUNT 업로드 화면만 엑셀 도착 전까지 쓰지 않는다**(DB에 빈 표가 있는 것은 무해).
3. 운영 Vault 키(1-6).
4. 0061~0066 → 0067(리뷰 · 화면 · staging 시험 뒤).

## 다음 블록 추천
- 0067 리뷰 루프 → 화면 둘(deals · margins) → staging 시험 판매 단계 → rehearsal.
- 대시보드: 일 → 주 → 월 → 분기 → 년(합산 뷰만) · 대표 «제품 하나 클릭하면 과거 전부»(원가 4종 · 견적 · 판매 · 실제 마진 이력).

## 미결
- 운영 Vault 키 결과 · staging 0061_0065 재시험 결과(지시문 칸이 비어 있었음).
- 이 PC 메모리: 크롬이 꺼져 있지 않았다(30개 · 5GB).

## 회장이 할 일

| 순서 | 담당 | 상태 | 방법 |
|---|---|---|---|
| 1 | 회장 | 대기 | 운영 키 결과와 staging 0061_0065 재시험 결과를 다음 블록 지시에 적기 |
| 2 | 회장 | 대기 | staging 0066 반영 — 아래 명령(rehearsal 폴더에서) |
| 3 | 회장 | 대기 | 0066 시험 파일 복사 |
| 4 | 회장 | 대기 | 0066 시험 실행 → 기대 문구 «0066 STAGING PASS …» |
| 5 | 회장 | 대기 | PASS/FAIL 줄을 다음 블록에 알리기(0067 rehearsal 반영 조건) |
| 6 | 회장 | 선택 | 크롬 완전 종료 확인(작업 관리자) |
| 7 | 회장 | 1-6에 따라 | 운영 키 값 바꾸기(키가 있고 출처가 불확실할 때만, 0063 반영 직전) |

명령(각 상자 하나씩):

```
cd ~/projects/chairman-os-cost-rehearsal
```
```
npm run db:push:staging
```
(dry-run에 **0066 하나**만 보여야 한다)
```
cp docs/onboarding/staging-tests/0066_staging_test.sql supabase/.temp/0066_staging_test.sql
```
```
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0066_staging_test.sql"
```
7번(운영 SQL Editor, https://supabase.com/dashboard/project/nndvspgnljivkvihxlzj/sql/new):
```sql
select vault.update_secret((select id from vault.secrets where name = 'cost_bom_key'), encode(extensions.gen_random_bytes(32), 'base64'));
```
