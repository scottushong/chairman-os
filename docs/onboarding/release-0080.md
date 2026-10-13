# 0080 반영 — 원료 단가 · kg 노출 막기 (대표가 따라 하는 순서)

**넣는 것:** 브랜치 `feat/material-price-lock` (워크트리 `C:\Users\Edison Hong\projects\chairman-os-pricelock`) — `release/2026-10-13-all`(952110c) **위에** 쌓았다.
**마이그레이션 1개:** `0080_material_price_lock`.

**순서 조건:** 0080은 0069 ~ 0079 묶음(`docs/onboarding/release-2026-10-13-all.md`)이 **staging · 운영에 먼저 들어간 뒤**에만 넣는다.
0080은 0070 · 0072 · 0075 · 0076의 표와 함수를 고치므로, 앞 묶음 없이 넣으면 push가 실패한다(번호가 빠진다). 묶음과 같은 날 넣어도 된다 — 묶음의 c) ~ e)를 끝낸 뒤 여기 a)부터.

**무엇이 바뀌나(대표 결정 2026-10-13):**
- 원료별 매입 단가 · 원료별 kg(입고 · 재고 · OFFER SHEET 줄)는 **대표 · 그룹 CFO · 원가 관리 권한자 · 그 파일을 올린 사람 본인(올린 뒤 1시간)** 만 본다.
- 그 밖의 장부 권한자(김병훈 자리 · 회사 대표 · 장부 읽기)는 **회사 · 월 합계 금액**만 본다. 원료가 3가지 미만인 자료는 합계도 감춘다(합계가 곧 원료 하나의 값이라서).
- 원료 출고 kg는 0072부터 누구에게도 보이지 않는다 — 그대로 둔다.
- 화면: `https://chairman-os-eosin.vercel.app/finance/biz_dy/upload` 의 «자료 간 같은 거래» 줄 이름에 «금액 가림», 맨 위에 «원료 자료 합계» 한 줄, 숫자가 가려진 미리보기는 «넣기» 단추가 꺼지고 «파일을 다시 올려 주세요».
- AI 분류에 보내는 시트 견본은 머리글 아래 숫자를 «<숫자>»로 가린다.

**앱 · DB 순서:** DB 먼저 → 앱(늘 하던 대로). 순서가 바뀌어도 깨지지 않는다 — 새 앱은 0080 함수가 없으면 옛 방식으로 읽고, 옛 앱은 0080 뒤 입고 금액을 못 읽으면 빈 목록 · «자동 넣기 멈춤»으로 물러난다.

규칙: 상자 하나에 명령 하나(또는 SQL 한 문장). `&&`는 쓰지 않는다. 상자 아래 «기대»와 다르면 멈추고 결과를 보낸다.

---

## a) staging push (Git Bash)

```bash
cp ~/projects/chairman-os/.env.staging.local ~/projects/chairman-os-pricelock/
```

기대: 아무것도 출력되지 않는다.

```bash
cd ~/projects/chairman-os-pricelock
```

기대: 아무것도 출력되지 않는다.

```bash
git log --oneline -1
```

기대: «docs(0080): 반영 문서 · 결정 · 미룬 것»으로 끝나는 한 줄.

```bash
npm run db:push:staging
```

기대: dry-run 목록이 **정확히** `0080_material_price_lock.sql` 하나. 그다음 push, `migration list` 끝 줄이 `0080`. 0079 이하 번호가 보이면(앞 묶음이 아직 staging에 없다) dry-run 뒤에 멈추고(Ctrl+C) 목록을 보낸다.

---

## b) staging 시험 SQL (Git Bash, 같은 폴더)

마지막에 일부러 오류를 던져 **전부 되돌린다.** 정상이면 `ERROR: 0080 STAGING PASS …`. `FAIL`로 시작하면 그 줄을 보낸다.

```bash
cp docs/onboarding/staging-tests/0080_staging_test.sql supabase/.temp/
```

기대: 아무것도 출력되지 않는다.

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/0080_staging_test.sql"
```

기대: `ERROR:  0080 STAGING PASS a(숫자 칸 직접 읽기 거부) b(올린 사람 방금 = 숫자) c(장부 읽기만 = 가림 · 합계) d(61분 뒤 올린 사람 가림 · 대표 숫자) e(CFO · 원가 관리 숫자) f(대기 가림 · 넣기 거부) g(anon 거부)`

```bash
rm -f supabase/.temp/0080_staging_test.sql
```

기대: 아무것도 출력되지 않는다.

이 시험은 회장 · `rehearsal.staff@example.com` · `rehearsal.member@example.com` 계정을 쓴다(역할 · 모듈 줄은 시험 안에서만 바꾸고 되돌린다).

---

## c) master에 합치기 (Git Bash)

앞 묶음(`release/2026-10-13-all`)이 master에 이미 합쳐져 있어야 한다.

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

기대: «release: 2026-10-13 — 0069 ~ 0079 한 묶음» merge 줄. 이 SHA를 g)의 **직전 SHA** 칸에 적는다.

```bash
git merge --no-ff feat/material-price-lock -m "release: 0080 원료 단가 · kg 노출 막기"
```

기대: `Merge made by the 'ort' strategy.` 충돌 없음.

```bash
npm run check:migrations
```

기대: `PASS:`로 시작하고 끝 번호가 `0080_material_price_lock.sql`.

```bash
npm run check:material-lock
```

기대: 마지막 줄 `PASS: check:material-lock`.

---

## d) 운영 반영 — 먼저 리허설

### d-1. 운영 읽기 전용 확인 (Supabase SQL Editor)

브라우저 주소가 **`https://supabase.com/dashboard/project/nndvspgnljivkvihxlzj`**(production)인지 먼저 본다.

```sql
select version from supabase_migrations.schema_migrations order by version desc limit 3;
```

기대: 맨 위가 `0079`. `0080`은 **없다**. (0079가 아니면 앞 묶음이 아직이다 — 멈추고 보낸다.)

### d-2. 리허설 — 운영에 쓰지 않는다 (Git Bash, `~/projects/chairman-os`)

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh 0080
```

기대: `대기(migration list):` 줄이 **정확히** `0080`, 마지막 줄 `staging으로 돌아왔다.` 출력의 `복원 지점 …` · `직전 SHA …` 줄을 사진으로 남긴다(g에 적는다).

### d-3. 실제 반영

```bash
bash scripts/release-production.sh 0080
```

1. 첫 질문(DB 적용)에 `YES`
2. 둘째 질문(git push = 앱 배포)에 `YES`
3. 끝 줄 health가 `"ok":true`인지 본다.

---

## e) 운영 확인 (SQL Editor `nndvspgnljivkvihxlzj` — 읽기만)

```sql
select table_name, column_name from information_schema.column_privileges where grantee = 'authenticated' and privilege_type = 'SELECT' and table_name in ('fin_purchase_in_lines', 'fin_inventory_lines', 'fin_import_lines') and column_name in ('qty', 'amount', 'amount_vat', 'stock_qty', 'used_qty', 'opening_amount', 'fx_rate', 'amount_krw', 'extra_cost');
```

기대: 줄이 **하나도 없다.**

```sql
select proname from pg_proc where proname in ('fin_material_lines', 'fin_material_totals', 'fin_material_viewer', 'fin_material_line_ok', 'fin_material_apply_guard') order by 1;
```

기대: 다섯 줄.

화면: 대표 계정으로 `https://chairman-os-eosin.vercel.app/finance/biz_dy/upload` → 이 달 자료가 있으면 «원료 자료 합계» 한 줄 · «자료 간 같은 거래» 줄에 금액이 보인다(대표는 가리지 않는다).

---

## f) 김병훈 자리 확인(선택 · staging에서)

`docs/onboarding/test-kim-2026-10.md` A4 · A5 줄과 같이:
1. 가짜 입고명세서를 올린다 → 미리보기 · 같은 거래 줄에 금액이 보인다(올린 사람 본인 · 1시간).
2. 한 시간 뒤 같은 화면 → 같은 거래 줄은 «금액 가림», 위 «원료 자료 합계»는 합계만(원료 3가지 이상일 때).
3. 회장 계정 → 같은 줄에 금액이 보인다.

---

## g) 되돌리는 길

| 칸 | 적는 값 |
|---|---|
| 복원 지점 시각(d-2 출력) | ____-__-__ __:__ KST |
| 직전 SHA(c의 merge 전 `git log --oneline -1`) | ________ |
| 릴리스 SHA(c의 merge 뒤 `git log --oneline -1`) | ________ |

- **YES 전에 멈췄으면:** 운영 DB · 앱 모두 그대로. 스크립트가 link를 staging으로 돌려놓는다.
- **DB는 들어갔는데 앱이 이상하면:** 앱만 직전 SHA로(Vercel → Deployments → 그 배포 → **Promote to Production**). 옛 앱은 입고 금액을 못 읽어 «자료 간 같은 거래» 줄이 비고 자동 넣기가 멈출 뿐, 장부 · 손익은 그대로다.
- **DB를 되돌려야 하면:** 표의 숫자는 그대로 있다(0080은 읽기 권한만 바꾼다 — 지운 값 없음). 새 번호로 앞으로 고치는 것이 먼저다. 복원 지점 복원은 데이터가 상했을 때만(OPERATIONS §9).
- 끝나면 `docs/OPERATIONS.md` §9에 한 줄: «2026-10-__ 릴리스(0080 · `<릴리스 SHA>`), 복원 지점 …, 직전 SHA …».
