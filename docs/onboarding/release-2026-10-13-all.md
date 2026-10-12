# 2026-10-13 반영 — 0069 ~ 0079 한 묶음 (대표가 따라 하는 순서)

**넣는 것:** `release/2026-10-13-all` 끝 커밋(«docs(release): 2026-10-13 전체 반영 문서 · 마지막 보고») — 코드는 `1274dbd`까지 (워크트리 `C:\Users\Edison Hong\projects\chairman-os-all`)
= `release/2026-10-12-rehearsal`(0069 · 0070 · 0071 · 시드 확인) 위에 이번 밤 블록 브랜치를 차례대로 `merge --no-ff -m` 한 것.

**마이그레이션 11개:** `0069_ai_feedback` · `0070_finance_upload` · `0071_process_chart_sync` · `0072_finance_v21` · `0073_feature_switches` · `0074_finance_replace_guard` · `0075_monthly_pl` · `0076_b_rest` · `0077_sales_margins` · `0078_cost_candidates` · `0079_ledger_post`. 번호가 빠짐없이 차례대로라 `--include-all`은 **쓰지 않는다.**

**staging 대기(2026-10-13 02:45 KST 읽기 전용 확인):** staging의 마지막 번호는 `0070`(0069 · 0070은 이미 들어가 있다). staging이 기다리는 것은 0071 ~ 0079 **9개**, 운영이 기다리는 것은 0069 ~ 0079 **11개**다.

**지금 운영 앱:** origin/master = `d47ebf7`. 되돌릴 때 이 값이 **직전 SHA**다.

규칙: 상자 하나에 명령 하나(또는 SQL 한 문장). `&&`는 쓰지 않는다. 상자 아래 «기대»와 다르면 멈추고 결과를 보낸다.

---

## a) staging push (Git Bash)

```bash
cp ~/projects/chairman-os/.env.staging.local ~/projects/chairman-os-all/
```

기대: 아무것도 출력되지 않는다.

```bash
cd ~/projects/chairman-os-all
```

기대: 아무것도 출력되지 않는다.

```bash
git log --oneline -1
```

기대: «docs(release): 2026-10-13 전체 반영 문서 · 마지막 보고»로 끝나는 한 줄.

```bash
npm run db:push:staging
```

기대: dry-run 목록이 **정확히** 0071 ~ 0079 9개(`0071_process_chart_sync.sql` … `0079_ledger_post.sql`). 그다음 push, `migration list` 끝 줄이 `0079`. 다른 번호(특히 0069 · 0070)가 보이면 dry-run 뒤에 멈추고(Ctrl+C) 목록을 보낸다.

---

## b) staging 시험 SQL — 번호마다 (Git Bash, 같은 폴더)

0069 · 0070 시험도 다시 돌린다(되돌리므로 남는 것 없음 — 0069 · 0070이 staging에 이미 있어도 같은 결과여야 한다).

시험 SQL은 마지막에 일부러 오류를 던져 **전부 되돌린다.** 정상이면 `ERROR: 00xx STAGING PASS …`. `FAIL`로 시작하면 그 줄을 보낸다. 반드시 번호 순서대로.

### b-1. 0069_ai_feedback

```bash
cp docs/onboarding/staging-tests/0069_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0069_staging_test.sql"
```

기대: `0069 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(anon 거부)`

```bash
rm -f supabase/.temp/0069_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-2. 0070_finance_upload

```bash
cp docs/onboarding/staging-tests/0070_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0070_staging_test.sql"
```

기대: `0070 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(anon 거부)`

```bash
rm -f supabase/.temp/0070_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-3. 0071_process_chart_sync

```bash
cp docs/onboarding/staging-tests/0071_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0071_staging_test.sql"
```

기대: `0071 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(…) h(…) i(…) j(…) k(…) g(…)`

```bash
rm -f supabase/.temp/0071_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-4. 0072_finance_v21

```bash
cp docs/onboarding/staging-tests/0072_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0072_staging_test.sql"
```

기대: `0072 STAGING PASS a(…) b(…) c(…) d(…) e(…) f(…) g(anon 거부)`

```bash
rm -f supabase/.temp/0072_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-5. 0073_feature_switches

```bash
cp docs/onboarding/staging-tests/0073_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0073_staging_test.sql"
```

기대: `0073 STAGING PASS a(…) b(…) c(…) d(…) e(anon 거부)`

```bash
rm -f supabase/.temp/0073_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-6. 0074_finance_replace_guard

```bash
cp docs/onboarding/staging-tests/0074_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0074_staging_test.sql"
```

기대: `0074 STAGING PASS a(직원 바꾸기 거부) d(직원 되돌리기 거부) b(대표 바꾸기) c(다른 종류는 그대로) e(대표 되돌리기)`

```bash
rm -f supabase/.temp/0074_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-7. 0075_monthly_pl

```bash
cp docs/onboarding/staging-tests/0075_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0075_staging_test.sql"
```

기대: `0075 STAGING PASS a(직원 스위치 꺼짐) b(1월 매출원가 3억 · 영업이익 1억 · 원료 기말 6억 · 지급 9억) c(직원 원료별 없음 · 확정 거부 · 잠정 한 줄)`

```bash
rm -f supabase/.temp/0075_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-8. 0076_b_rest

```bash
cp docs/onboarding/staging-tests/0076_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0076_staging_test.sql"
```

기대: `0076 STAGING PASS a(입력자 확인 거부) b(다른 사람 확인) c(두 번째 확인 false) d(미입력 확인 거부) e(일부 미입력) f(정의자 거름) g(anon 거부)`

```bash
rm -f supabase/.temp/0076_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-9. 0077_sales_margins

```bash
cp docs/onboarding/staging-tests/0077_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0077_staging_test.sql"
```

기대: `0077 STAGING PASS a(직원 스위치 꺼짐) b(대표 마진 · 칸 모양) c(직원 마진 거부) d(끄면 대표도 꺼짐) e(anon 거부)`

```bash
rm -f supabase/.temp/0077_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-10. 0078_cost_candidates

```bash
cp docs/onboarding/staging-tests/0078_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0078_staging_test.sql"
```

기대: `0078 STAGING PASS a(직원 스위치 꺼짐) b(대표 후보 · 칸 모양) c(영업 직원 거부) d(이유 필수 · 나중에 · 무시 · 감사) e(끄면 대표도 꺼짐) f(anon 거부)`

```bash
rm -f supabase/.temp/0078_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-11. 0079_ledger_post

```bash
cp docs/onboarding/staging-tests/0079_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0079_staging_test.sql"
```

기대: `0079 STAGING PASS a(직원 스위치 꺼짐) b(장부 쓰기 없는 직원 거부) c(대기 · 장부 0줄) d(반영 전표 · 두 번 거부) e(무효 = 역분개 · 원 전표 남음) f(끄면 대표도 꺼짐) g(anon 거부)`

```bash
rm -f supabase/.temp/0079_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

### b-12. FORCE 확인 (읽기만)

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked "select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('tasks','process_charts','teams') and not relforcerowsecurity"
```

기대: 줄이 **하나도 없다**(세 표 모두 FORCE 켜짐).

---

## c) master에 합치기 (Git Bash)

```bash
cd ~/projects/chairman-os
```

기대: 아무것도 출력되지 않는다.

```bash
git checkout master
```

기대: `Already on 'master'` 또는 `Switched to branch 'master'`.

```bash
git status
```

기대: `nothing to commit, working tree clean`.

```bash
git log --oneline -1
```

기대: `d47ebf7`로 시작한다(다르면 멈추고 보낸다).

```bash
git merge --no-ff release/2026-10-13-all -m "release: 2026-10-13 — 0069 ~ 0079 한 묶음"
```

기대: `Merge made by the 'ort' strategy.` 충돌 없음.

```bash
npm run check:migrations
```

기대: `PASS:`로 시작하고 끝 번호가 `0079_ledger_post.sql`.

```bash
npm run check:db-safety
```

기대: `PASS: FORCE RLS(있던 표가 꺼지지 않음), …`

---

## d) 운영 반영 — 먼저 리허설

### d-1. 운영 읽기 전용 확인 (Supabase SQL Editor)

브라우저 주소가 **`https://supabase.com/dashboard/project/nndvspgnljivkvihxlzj`**(production)인지 먼저 본다.

```sql
select version from supabase_migrations.schema_migrations order by version desc limit 3;
```

기대: 맨 위가 `0068`. `0069` 이후는 **없다**. (다르면 멈추고 보낸다.)

### d-2. 리허설 — 운영에 쓰지 않는다 (Git Bash, `~/projects/chairman-os`)

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh 0069 0070 0071 0072 0073 0074 0075 0076 0077 0078 0079
```

기대: `대기(migration list):` 줄이 **정확히** `0069 0070 0071 0072 0073 0074 0075 0076 0077 0078 0079`, 마지막 줄 `staging으로 돌아왔다.` 출력의 `복원 지점 …` · `직전 SHA d47ebf7` 줄을 사진으로 남긴다(g에 적는다). 번호가 차례대로이므로 `--include-all`은 필요 없다 — 리허설 출력이 «include-all» 이야기를 하면 멈추고 보낸다.

### d-3. 실제 반영

```bash
bash scripts/release-production.sh 0069 0070 0071 0072 0073 0074 0075 0076 0077 0078 0079
```

1. 첫 질문(DB 적용)에 `YES`
2. 둘째 질문(git push = 앱 배포)에 `YES`
3. 끝 줄 health가 `"ok":true`인지 본다.

---

## e) health (Git Bash)

```bash
curl -sS https://chairman-os-eosin.vercel.app/api/health
```

기대: `"ok":true`가 들어 있는 한 줄.

---

## f) FORCE 확인 (운영 SQL Editor `nndvspgnljivkvihxlzj`)

```sql
select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('tasks','process_charts','teams') and not relforcerowsecurity;
```

기대: 줄이 **하나도 없다.**

```sql
select feature_key, enabled, audience from feature_switches where business_id is null order by feature_key;
```

기대: 기본값 — 0069 · 0070/0072 · 0071 기능은 `all`, 이번 블록 기능은 `chairman`.

---

## g) 되돌리는 길

| 칸 | 적는 값 |
|---|---|
| 복원 지점 시각(d-2 출력) | ____-__-__ __:__ KST |
| 직전 SHA | `d47ebf7` |
| 릴리스 SHA(c의 merge 뒤 `git log --oneline -1`) | ________ |

- **YES 전에 멈췄으면:** 운영 DB · 앱 모두 그대로. 스크립트가 link를 staging으로 돌려놓는다.
- **DB는 들어갔는데 앱이 이상하면:** 앱만 직전 SHA `d47ebf7`로. Vercel 대시보드 → Deployments → `d47ebf7` 배포 → **Promote to Production**. 새 표 · 칸은 옛 앱이 쓰지 않는다.
- **기능 하나만 이상하면:** `https://chairman-os-eosin.vercel.app/settings/features` 에서 그 기능을 끈다(이유 필수). DB · 앱은 그대로.
- **DB가 잘못 들어갔으면:** 먼저 새 번호로 앞으로 고친다. 데이터가 상했을 때만 Supabase → Database → Backups에서 위 **복원 지점**으로 복원하고 그 뒤 앱을 직전 SHA로(DB 먼저, 앱 나중 — OPERATIONS §9).
- 끝나면 `docs/OPERATIONS.md` §9에 한 줄: «2026-10-13 릴리스(0069~0079 · `<릴리스 SHA>`), 복원 지점 …, 직전 SHA `d47ebf7`».

---

## 일부만 반영하고 싶을 때

빼기 안내서 `C:\Users\Edison Hong\projects\chairman-os-all\docs\onboarding\feature-removal.md`의 의존 표가 기준이다. 원칙:

- **끄기만 하면 되는 경우가 대부분이다** — 전부 반영한 뒤 `/settings/features`에서 끈다. 이 블록의 새 기능은 기본이 «대표만»이라 반영만으로 직원 화면은 바뀌지 않는다.
- **번호를 빼려면 뒤에서부터만 뺄 수 있다**(마이그레이션은 차례대로 들어간다). 아래 브랜치 순서의 «여기까지» 커밋에서 새 리허설 브랜치를 만들면 그 뒤 번호가 모두 빠진다.
- 중간 번호 하나만 빼는 것은 하지 않는다(뒤 번호가 앞 번호의 함수 · 표를 쓴다 — 안내서 표의 «얽힘» 칸).

### 브랜치 순서(뒤에서부터만 뺄 수 있다)

| 순서 | 브랜치 · 끝 커밋 | 번호 | 기능 | 스위치(기본) | 여기서 끊으면 빠지는 것 |
|---|---|---|---|---|---|
| 0 | `release/2026-10-12-rehearsal` `519f87f` | 0069 · 0070 · 0071 | AI 어시스턴트 보강 · 자료 올리기 v2 · 프로세스 차트 | `ai_assist` · `finance_upload` · `process_charts` (전원) | 아래 전부 |
| 1 | `feat/finance-v21` `69f8762` | 0072 | 재무 v2.1(평가금액 · 출고 구분 · 중복 묶음 · 재마감 표시 · 시드 «예시») | `finance_upload` | 2~ |
| 2 | `feat/finance-pdf` `5acf8e0` | — | PDF · 사진 읽기 | `finance_docs` (대표만) | 3~ |
| 3 | `feat/feature-switches` `6fa7b5f` | 0073 | 기능 스위치 · /settings/features · 빼기 안내서 | — | 4~ (뒤 번호 모두 `feature_on`을 쓴다) |
| 4 | `feat/finance-pdf-rest` `fb213a4` | 0074 | 원료 출고 · 재고 바꾸기 · 되돌리기 대표 · CFO만 · 0073 고침 | — (DB 규칙) | 5~ |
| 5 | `feat/monthly-pl` `2105514` | 0075 | 월별 손익(재고 반영 매출원가 · 손익과 현금 · 마감) | `monthly_pl` (대표만) | 6~ |
| 6 | `feat/b-rest` `42ecd92` | 0076 | 달 넘김 짝 · «예시» 꼬리표 · 첫 달 기초 확인 · 일부 미입력 | — | 7~ |
| 7 | `feat/sales-margins` `be25e37` | 0077 (+0075 고침) | 판매 실적 · 마진 화면 | `sales_margins` (대표만) | 8~ |
| 8 | `feat/cost-candidates` `5eeffdc` | 0078 | 원가 후보 승인 | `cost_candidates` (대표만) | 9~ |
| 9 | `feat/ledger-post` `363f6db` | 0079 | 원장 → 장부 반영 | `ledger_post` (대표만) | 10~ |
| 10 | `feat/chair-dashboard` `0d430fe` | — (0075 · 0077 · 0078 · 0079 고침) | 대표 대시보드 | `chairman_dashboard` (대표만) | 11 |
| 11 | `feat/wrapup` `ec751fc` | — (0075 · 0078 · 0079 고침) | 프로세스 차트 문서 · /tasks 출처 · 직원 안내 · 남은 목록 | — | — |

주의: 7 · 10 · 11에는 앞 번호(0075 · 0077 · 0078 · 0079)의 **리뷰 고침**이 들어 있다. 8에서 끊으면 0078 · 0079가 빠지므로 상관없지만, 예를 들어 «0079까지 넣고 대시보드만 빼기»는 브랜치로 끊지 말고 **전부 넣은 뒤 `chairman_dashboard`를 끈다**(10 · 11의 고침이 0079를 고치기 때문).

---

## 대표가 반영 뒤 켤 스위치 (추천 순서)

반영 직후에는 이 블록의 새 기능이 모두 **대표에게만** 보인다. 주소 `https://chairman-os-eosin.vercel.app/settings/features` 에서 하나씩 넓힌다(이유 필수 · 감사 기록).

| 순서 | 스위치 | 무엇이 보이나 | 켜기 전 확인 |
|---|---|---|---|
| 1 | `monthly_pl` 월별 손익 재고 반영 | `https://chairman-os-eosin.vercel.app/finance/biz_dy/monthly` 아래 손익 · 재고 근거 · 자금 참고 · 자료 상태 | 대표가 먼저 한 달(dummy 아닌 실제 자료)을 «잠정 저장»으로 본다. 재고평가방법은 «관리용 잠정 기준(원료별 월 가중평균)» — 세무사 확인 뒤 설정에서 바꾼다 |
| 2 | `chairman_dashboard` 대표 대시보드 | 대표 홈(`https://chairman-os-eosin.vercel.app/`)의 월 · 분기 · 년 추이 · 14가지 자료 달력 | 대표만 쓰는 화면 — 범위를 넓히지 않는다 |
| 3 | `finance_docs` PDF · 사진 읽기 | 자료 올리기에서 PDF · 사진 | AI env(`FINANCE_UPLOAD_AI_PER_FILE` · `FINANCE_UPLOAD_AI_PER_DAY`)를 넣어야 읽는다 · 장당 약 40~55원 · 처음 3개월은 미리보기 |
| 4 | `sales_margins` 판매 실적 · 마진 | `/sales/<회사>/deals`(영업: 판매가 · kg · 등급만) · `/costs/<회사>/margins`(대표 · 원가 관리) | 원가 관리 권한자 지정 뒤 범위 «임원 이상» |
| 5 | `cost_candidates` 원가 후보 승인 | `/costs/<회사>/candidates` | 원가 관리 권한자('/costing/<회사>' 쓰기) 지정 |
| 6 | `ledger_post` 원장 → 장부 반영 | `/finance/<회사>/ledger-post` | DY는 ECOUNT 월별 업로드와 같은 달에 쓰지 않는다(DB가 막는다). 다른 회사부터 |
