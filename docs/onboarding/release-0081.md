# 0081 반영 — 청사진 뼈대 (대표가 따라 하는 순서)

**넣는 것:** 브랜치 `feat/blueprint-skeleton` (워크트리 `C:\Users\Edison Hong\projects\chairman-os-blueprint`) — `feat/material-price-lock`(2dce767) **위에** 쌓았다.
**마이그레이션 1개:** `0081_blueprint_skeleton`.

> **2026-10-14 긴급 고침 — 먼저 읽을 것.** 0071의 함수 SET 절이 Supabase(postgres가 superuser 아님)에서 «permission denied to set parameter»로 멈췄다.
> 이 브랜치의 0071은 고친 판이다(본문 set_config). **`release/2026-10-13-all`(chairman-os-all)의 0071은 옛 판** — 그 브랜치로 운영에 넣지 않는다.
> 운영은 이 브랜치(`feat/blueprint-skeleton` — 0069 ~ 0081 전부 + 고친 0071)를 master에 합쳐 **0069 ~ 0081을 한 번에** 넣는다(아래 c · d의 번호 목록을 그렇게 읽는다).
> staging은 2026-10-14에 0071 ~ 0081이 들어갔고, staging 시험 0071 ~ 0081이 staging에서 11/11 PASS(`node scripts/build-staging-dryrun.mjs 0071 0081 --tests-only`). 결정 기록 `docs/decisions/2026-10-14-staging-0071.md`.

**전제: 0069 ~ 0080이 운영에 먼저 들어간 뒤.** (위 긴급 고침 뒤로는: 이 브랜치 하나로 0069 ~ 0081을 함께.) 0081은 0073 스위치 표 · 0061 ~ 0067 원가 함수 · 0080 위에 선다. 순서는
`docs/onboarding/release-2026-10-13-all.md`(0069 ~ 0079) → `docs/onboarding/release-0080.md`(0080) → 이 문서.

**무엇이 생기나(전부 스위치 — 기본 «대표만»):**

| 기능 | 스위치 | 화면 |
|---|---|---|
| ① Forecast 원가 | `cost_forecast` | `https://chairman-os-eosin.vercel.app/costs/biz_dy` (Forecast 칸) · `/purchasing/biz_dy/market` (다음 달 예상) |
| ② 구매 성과 | `purchase_performance` | `https://chairman-os-eosin.vercel.app/purchasing/biz_dy?tab=performance` |
| ③ 고객별 수익성 | `customer_profit` | `https://chairman-os-eosin.vercel.app/finance/biz_dy/customers` |
| ④ 마진 변동 분해 | `margin_bridge` | `https://chairman-os-eosin.vercel.app/` (대표 대시보드 «이번 달 마진이 떨어진 이유») |
| ⑤ 경쟁사 가정 | `competitor_price` | `https://chairman-os-eosin.vercel.app/costs/biz_dy/competitor` · 견적 화면 한 줄 |
| ⑥ 작업지시 | `work_orders` | `https://chairman-os-eosin.vercel.app/production/biz_dy/orders/<오더>` |
| ⑦ 진짜 BOM 넣기 | (0063 «진짜 BOM 받기») | `https://chairman-os-eosin.vercel.app/costs/biz_dy/bom/import` · `docs/onboarding/real-bom-import.md` |
| ⑧ 제품 진단 | `product_diagnosis` | `https://chairman-os-eosin.vercel.app/costs/biz_dy/products/<제품>` |

직원에게 열려면 `https://chairman-os-eosin.vercel.app/settings/features`에서 기능마다 범위를 바꾼다(이유 필수 · 감사). 열어도 DB가 역할을 다시 거른다(영업은 마진 · 원료 없음, 생산은 본인 오더만).

**앱 · DB 순서:** DB 먼저 → 앱. 새 앱은 0081 함수가 없으면 그 칸 · 화면이 «지금은 쓸 수 없는 화면» / 비어 보일 뿐 다른 화면은 그대로다.

규칙: 상자 하나에 명령 하나(또는 SQL 한 문장). `&&`는 쓰지 않는다. 상자 아래 «기대»와 다르면 멈추고 결과를 보낸다.

---

## a) staging push (Git Bash)

```bash
cp ~/projects/chairman-os/.env.staging.local ~/projects/chairman-os-blueprint/
```

기대: 아무것도 출력되지 않는다.

```bash
cd ~/projects/chairman-os-blueprint
```

기대: 아무것도 출력되지 않는다.

```bash
npm run db:push:staging
```

기대: dry-run 목록이 **정확히** `0081_blueprint_skeleton.sql` 하나. 0080 이하 번호가 보이면(앞 묶음이 아직 staging에 없다) dry-run 뒤에 멈추고(Ctrl+C) 목록을 보낸다.

---

## b) staging 시험 SQL — Claude Code가 돌릴 수 있게 (Git Bash, 같은 폴더)

마지막에 일부러 오류를 던져 **전부 되돌린다**(쓰지 않는다). 한 줄 반복문 — 0081 시험 파일을 복사 · 실행 · 지운다:

```bash
for f in 0081_staging_test.sql; do cp "docs/onboarding/staging-tests/$f" supabase/.temp/; SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/$f"; rm -f "supabase/.temp/$f"; done
```

기대: `ERROR:  0081 STAGING PASS a(스위치 7개 대표만) b(스위치 기본 = 직원 feature_off) c(영업 = 원가 · 마진 함수 거부) d(생산 = 남의 오더 · 구매 성과 거부) e(임원 = 구매 성과 월만) f(대표 = 진짜 소유자 아래 호출) g(anon 거부)`
`FAIL`로 시작하면 그 줄을 보낸다. 이 시험은 회장 · `rehearsal.member@example.com`을 쓴다(역할 · 모듈 줄 · 스위치는 시험 안에서만 바꾸고 되돌린다).

같은 시험은 PGlite로 미리 돌렸다: `npm run check:staging-sql-cost` → `0081_staging_test.sql: 0081 STAGING PASS …`.

---

## c) master에 합치기 (Git Bash)

0080(`feat/material-price-lock`)이 master에 이미 합쳐져 있어야 한다.

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

기대: «release: 0080 원료 단가 · kg 노출 막기» merge 줄. 이 SHA를 f)의 **직전 SHA** 칸에 적는다.

```bash
git merge --no-ff feat/blueprint-skeleton -m "release: 0081 청사진 뼈대"
```

기대: `Merge made by the 'ort' strategy.` 충돌 없음.

```bash
npm run check:migrations
```

기대: `PASS:`로 시작하고 끝 번호가 `0081_blueprint_skeleton.sql`.

```bash
npm run check:blueprint
```

기대: 마지막 줄 `PASS: check:blueprint`.

---

## d) 운영 반영 — 먼저 리허설

### d-1. 운영 읽기 전용 확인 (Supabase SQL Editor)

브라우저 주소가 **`https://supabase.com/dashboard/project/nndvspgnljivkvihxlzj`**(production)인지 먼저 본다.

```sql
select version from supabase_migrations.schema_migrations order by version desc limit 3;
```

기대: 맨 위가 `0080`. `0081`은 **없다**.

### d-2. 리허설 — 운영에 쓰지 않는다 (Git Bash, `~/projects/chairman-os`)

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh 0081
```

기대: `대기(migration list):` 줄이 **정확히** `0081`, 마지막 줄 `staging으로 돌아왔다.` 출력의 `복원 지점 …` · `직전 SHA …` 줄을 사진으로 남긴다(f에 적는다).

### d-3. 실제 반영

```bash
bash scripts/release-production.sh 0081
```

1. 첫 질문(DB 적용)에 `YES`
2. 둘째 질문(git push = 앱 배포)에 `YES`

---

## e) health · 운영 확인 (읽기만)

```bash
curl -s https://chairman-os-eosin.vercel.app/api/health
```

기대: `"ok":true`가 들어 있는 한 줄.

```sql
select feature_key, audience from feature_switches where business_id is null and feature_key in ('cost_forecast', 'purchase_performance', 'customer_profit', 'margin_bridge', 'competitor_price', 'work_orders', 'product_diagnosis') order by 1;
```

기대: 일곱 줄, 모두 `chairman`.

화면: 대표 계정으로 `https://chairman-os-eosin.vercel.app/costs/biz_dy` → 표에 Forecast 칸(자료 없으면 «계산 안 됨»).

---

## f) 되돌리는 길

| 칸 | 적는 값 |
|---|---|
| 복원 지점 시각(d-2 출력) | ____-__-__ __:__ KST |
| 직전 SHA(c의 merge 전 `git log --oneline -1`) | ________ |
| 릴리스 SHA(c의 merge 뒤 `git log --oneline -1`) | ________ |

- **YES 전에 멈췄으면:** 운영 DB · 앱 모두 그대로.
- **기능 하나만 빼려면(가장 쉬움):** `https://chairman-os-eosin.vercel.app/settings/features` 에서 그 기능 «끄기»(이유 적기). 화면 · RPC 둘 다 꺼진다(대표 포함). 자세한 것은 `docs/onboarding/feature-removal.md`.
- **앱이 이상하면:** 앱만 직전 SHA로(Vercel → Deployments → 그 배포 → **Promote to Production**). 0081 표 · 함수는 옛 앱이 부르지 않아 아무 일도 하지 않는다.
- **DB를 되돌려야 하면:** 0081은 새 표 4개 · 새 함수 · 스위치 줄 7개만 더했다(기존 표 · 함수 · 정책을 바꾸지 않음). 새 번호로 앞으로 고치는 것이 먼저다. 복원 지점 복원은 데이터가 상했을 때만(OPERATIONS §9).
- 끝나면 `docs/OPERATIONS.md` §9에 한 줄: «2026-10-__ 릴리스(0081 · `<릴리스 SHA>`), 복원 지점 …, 직전 SHA …».
