# ECOUNT 실제 엑셀 — 어디에 두고 어떻게 시험하나

실제 ECOUNT 내려받기 파일(DY 장부 숫자)은 **저장소 밖**에 둔다. 저장소에는 견본도 두지 않는다(`.gitignore`가 `*.xlsx` · `*.xls`를 막는다 — 2026-10-06부터).

## 1. 폴더

```
C:\Users\Edison Hong\projects\ecount-real\
  accounts\   계정과목(기초데이터 › 계정 내려받기)        예: DY_계정_2026-10-06.xlsx
  annual\     재무상태표 · 손익계산서(한 해)               예: DY_재무제표_2025.xlsx
  monthly\    월별 손익계산서(1~12월, 당월 또는 누계)      예: DY_월별손익_2026_누계.xlsx
```

- 2026-10-06 현재 이 폴더는 **없다**(만들지 않았다 — 회장이 파일을 받으면 만든다).
- 파일 이름에 종류 · 해 · 당월/누계를 넣는다. 원본을 고치지 않는다(엑셀에서 열어 «xlsx로 저장»만 — .xls · CSV · 웹 표는 업로드가 거절한다).
- 이 폴더를 클라우드 공유 · 메일로 보내지 않는다(재무 원본 — 업로드 뒤에는 앱 첨부(재무 권한자만 · AI 제외)가 원본이다).

## 2. 오프라인 확인(DB 없음 · 읽기만)

파일이 파서를 지나는지, 시트 · 머리글 · 단위를 어떻게 짐작하는지만 본다. 아무 데도 쓰지 않는다.

```bash
cd "C:/Users/Edison Hong/projects/chairman-os-ecount"
npx tsx scripts/ecount-outline.ts "C:/Users/Edison Hong/projects/ecount-real"/*/*.xlsx
```

파일마다 ✓(시트 이름 · 행 · 열 · 기간 · 단위 · 못 읽은 칸 수) 또는 ✕(거절 이유 — .xls · CSV · 웹 표 · 깨진 파일)를 찍는다. 숫자 칸은 찍지 않는다.

견본(가짜) 파일이 필요하면: `ECOUNT_SAMPLE_DIR="C:/Users/Edison Hong/projects/ecount-real/_samples" npm run check:ecount-import`.

## 3. staging 시험(세 종류 — 컨트롤러가 돌린다)

전제: staging에 0050 · 0051 · 0052 · 0056이 올라가 있다(`npm run db:push:staging` — 컨트롤러가 리뷰 뒤). production에는 쓰지 않는다.

1. 작업 트리 복사본에서 staging으로 dev 서버(메모리 «staging 재리허설» 방법):
   - 복사본 `.env.local` = `.env.staging.local`(끝나면 지운다) · `npx next dev --webpack -p 3200`
   - 리허설 직원 계정(`rehearsal.member@example.com` 등 — DY `/finance/biz_dy` 쓰기 줄) 또는 회장 계정으로 로그인
2. `/finance/biz_dy/import`(또는 그룹 재무 · DY 재무 머리글의 «ECOUNT 업로드»)에서 순서대로:
   1. **계정과목** — `accounts\` 파일을 칸에 끌어다 놓기 → 열 지정 확인 → 미리보기(분류 제안 · 이름 다름) → 등록
   2. **연간** — `annual\` 파일 → 해 · 단위(천원) 확인 → 합계 행 대조 0 · 균형 → 등록(«ECOUNT 엑셀(잠정)»)
   3. **월별** — `monthly\` 파일 → 당월/누계 확인 → 달마다 이익 줄 대조 0 → 등록 → 전표 화면에서 출처 «ECOUNT 엑셀»
   4. 같은 월별 파일 다시 → «같아서 건너뜀» · 한 달만 바꾼 파일 → 그 달만 정정 전표
3. 읽기 확인(staging, 읽기만):
   ```bash
   SUPABASE_DB_PASSWORD=<.env.staging.local의 값> npx supabase db query --linked \
     "select month, slip_no, superseded_at from finance_import_slips where business_id = 'biz_dy' order by month, superseded_at nulls last"
   ```
4. staging은 지우지 않는다(마감은 되돌릴 수 없어 staging에서도 만들지 않는다 — 마감 달 거부는 PGlite 검사로 잰다).

## 4. production

production에 실제 파일을 올리는 것은 0050~0056 릴리스(회장이 `release-production.sh`) **뒤**다. 그 전에 `docs/onboarding/ecount-release-precheck.sql`(읽기 전용)을 회장이 SQL Editor에서 돌려 결과를 보낸다.
