# 2026-10 큰 반영 — ECOUNT · 자료 입구 · 원가 엔진 · 견적 (회장이 따라 하는 순서)

**넣는 것:** `release/cost-rehearsal` — 마이그레이션 **0050 · 0051 · 0052 · 0056**(ECOUNT) · **0058**(자료 입구) · **0061~0066**(원가 엔진 · 견적), 모두 열한 개.
(0059 · 0060은 이미 운영에 있다. **0067은 넣지 않는다.**)

**staging 대조(2026-10-11 컨트롤러 확인):** 위 열한 개와 0054 · 0055 · 0059 · 0060의 파일이 staging에 적용된 SQL과 글자 단위로 같다(공백 제외). staging 시험 0059~0066 PASS(회장 확인).

**지금 운영 앱:** origin/master = `96e563c` — 이것이 되돌릴 때의 **직전 SHA**다.

규칙: 명령 · SQL은 상자 하나에 한 줄(또는 한 문장). 상자마다 따로 붙여 넣고 실행한다. `&&`는 쓰지 않는다.

---

## a) 운영 읽기 전용 사전 점검 (SQL Editor)

1. 브라우저 주소가 **`https://supabase.com/dashboard/project/nndvspgnljivkvihxlzj`** 인지 본다(Tokyo · production). `itpenmxyracfhyormcep`(staging)이면 틀린 곳이다.
2. 왼쪽 **SQL Editor** → **+ New query**. 아래 상자를 **하나씩** 붙여 넣고 **Run**. 모두 `select`다(아무것도 바꾸지 않는다).

[a-1] 운영에 적용된 마지막 번호 — 기대: 맨 위가 `0060`, 그 아래 `0059 · 0055 · 0054 · 0049 …`. 0050~0052 · 0056 · 0058 · 0061~0066은 **없다**.

```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 8;
```

[a-2] 이번에 만들 표가 아직 없는가 — 기대: 다섯 칸 모두 `false`.

```sql
select to_regclass('public.finance_imports') is not null as ecount, to_regclass('public.intake_items') is not null as intake, to_regclass('public.cost_materials') is not null as cost, to_regclass('public.cost_bom') is not null as bom, to_regclass('public.quotes') is not null as quotes;
```

[a-3] 원가 엔진 확장 둘 — 기대: 두 줄(`pgcrypto | extensions`, `supabase_vault | vault`). 하나라도 없으면 **Database → Extensions**에서 켠다.

```sql
select extname, extnamespace::regnamespace as schema from pg_extension where extname in ('pgcrypto', 'supabase_vault');
```

[a-4] BOM 키가 이미 있는가 — **0줄**이면 b-1, **한 줄**이면 b-2. (값은 보이지 않는다 — 이름과 시각만.)

```sql
select name, created_at at time zone 'Asia/Seoul' as created_kst from vault.secrets where name = 'cost_bom_key';
```

[a-5] 원가 권한(구매 · 생산 · 영업 · 원가 관리) 줄 수 — 기대: `0`. (0이면 0066 감사 기록 구멍(I1)에 닿을 사람이 없다 — 0067과 함께 다음 반영에서 닫는다.)

```sql
select count(*) as cost_grants from user_module_access where module ~ '^/(purchasing|production|sales|costing)/';
```

[a-6] DY 회사 · 첨부 버킷 — 기대: `dy_rows = 1`, `bucket_public = false`, `postgres_reads_storage = true`.

```sql
select (select count(*) from businesses where business_id = 'biz_dy') as dy_rows, (select public from storage.buckets where id = 'attachments') as bucket_public, has_table_privilege('postgres', 'storage.objects', 'select') as postgres_reads_storage;
```

[a-7] 김병훈 권한 지금 그대로 — 기대: 결재 올리기 · DY 사용자 관리자 · 재무 입력 · 문서 등록 · 결재 대장 열람 줄. 원가 모듈 줄은 없다.

```sql
select m.module, m.can_write, m.can_approve from user_profiles p join user_module_access m on m.user_id = p.user_id where p.display_name = '김병훈' order by m.module;
```

ECOUNT 쪽을 더 자세히 보고 싶으면 `C:\Users\Edison Hong\projects\chairman-os-cost-rehearsal\docs\onboarding\ecount-release-precheck.sql`의 블록 [2]~[12]를 같은 방법으로 하나씩(전부 select, 합친 뒤에는 이 폴더에도 생긴다).

**a-1 · a-2 · a-5가 기대와 다르면 여기서 멈추고 결과를 보낸다.**

---

## b) 운영 BOM 키 — 0063 반영 **전에**

다시 주소가 **`nndvspgnljivkvihxlzj`** 인지 본다. a-4 결과에 따라 **둘 중 하나만**.

**b-1. a-4가 0줄(키 없음) — 새로 만든다** (DB가 무작위로 만든다 — 글자로 적힌 키가 없다):

```sql
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'cost_bom_key', 'chairman-os 0063 BOM 암호 키 — 지우거나 바꾸지 말 것');
```

**b-2. a-4가 한 줄(키 있음 · 누가 언제 만들었는지 불확실) — 새 값으로 바꾼다.** 지금은 0063 전이라 이 키로 잠근 BOM이 하나도 없으므로 바꿔도 잃는 것이 없다(a-2의 `bom = false`가 그 확인). **0063 반영 뒤에는 절대 바꾸지 않는다.**

```sql
select vault.update_secret((select id from vault.secrets where name = 'cost_bom_key'), encode(extensions.gen_random_bytes(32), 'base64'));
```

**b-3. 확인** — 한 줄이 나오면 된다(b-2였다면 `updated_kst`가 방금 시각).

```sql
select name, created_at at time zone 'Asia/Seoul' as created_kst, updated_at at time zone 'Asia/Seoul' as updated_kst from vault.secrets where name = 'cost_bom_key';
```

`vault.decrypted_secrets`는 열지 않는다.

---

## c) master에 합치고 검사 (Git Bash)

```bash
cd ~/projects/chairman-os
```

```bash
git checkout master
```

```bash
git status
```

→ `nothing to commit, working tree clean` 이어야 한다(릴리스 스크립트가 깨끗한 작업 트리만 받는다).

```bash
git merge --no-ff release/cost-rehearsal -m "release: 2026-10 큰 반영 — ECOUNT 0050·0051·0052·0056 · 자료 입구 0058(대표만) · 원가 엔진 0061~0066 · 견적"
```

```bash
npm run check:migrations
```

→ `PASS: … (0001_init.sql → 0066_quotes.sql)` — **끝 번호가 0066**이어야 한다(0067이 보이면 멈춘다).

---

## d) 리허설 — 운영에 쓰지 않는다

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh --include-all 0050 0051 0052 0056 0058 0061 0062 0063 0064 0065 0066
```

→ `대기(migration list):` 줄이 **정확히** `0050 0051 0052 0056 0058 0061 0062 0063 0064 0065 0066` 이고, 마지막에 `staging으로 돌아왔다.`
→ 하나라도 다르면(많거나 모자람) 멈추고 그 줄을 보낸다. `--include-all`은 대기 목록 **전부**를 넣는다.
→ 출력의 `복원 지점 …` · `직전 SHA 96e563c` 두 줄을 사진으로 남긴다(g에 쓴다).

---

## e) 실제 반영

```bash
bash scripts/release-production.sh --include-all 0050 0051 0052 0056 0058 0061 0062 0063 0064 0065 0066
```

1. 첫 질문(DB 적용) → `YES`
2. 둘째 질문(git push = 앱 배포) → `YES`
3. 끝의 health가 `"ok":true` 인지 본다. 따로 볼 때:

```bash
curl -sS https://chairman-os-eosin.vercel.app/api/health
```

---

## f) 반영 뒤 확인

**f-1. 운영 SQL Editor(`nndvspgnljivkvihxlzj`)** — 키를 함수가 읽는가. 기대: `true`(값은 보이지 않는다).

```sql
select length(cost_secret.bom_key()) > 0 as bom_key_ok;
```

**f-2. 운영 번호** — 기대: 맨 위 `0066`, 0050~0052 · 0056 · 0058 · 0061~0065 모두 있음.

```sql
select version from supabase_migrations.schema_migrations where version between '0050' and '0067' order by version;
```

**f-3. 대표 화면** (https://chairman-os-eosin.vercel.app)

| 주소 | 보여야 할 것 |
|---|---|
| `/` | 사이드바 «기능 시스템»에 **구매 · 영업 · 생산 · 원가 관리**(새). 옛 «구매 / SCM» · «영업 / CRM» · «생산 / MES» 자리표는 사라짐 |
| `/finance/biz_dy/import` | ECOUNT 엑셀 올리기 화면 |
| `/business/biz_dy` | «자료 받는 입구» 칸(대표에게만) |
| `/costs/biz_dy/bom` | 머리에 **«암호 키: 준비됨»**. 진짜 BOM 받기 스위치는 **꺼진 채로 둔다** |
| `/sales/biz_dy/quotes` | 견적 목록(비어 있음) |

**f-4. 김병훈 화면** (김병훈 계정으로 로그인 — 다른 브라우저 또는 시크릿 창)

| 주소 | 보여야 할 것 |
|---|---|
| `/me` | 사이드바에 **구매 · 영업 · 생산 · 원가 관리 없음**(옛 자리표 «구매 / SCM» 등 준비 중 항목만 그대로) · 결재 대장은 그대로 |
| `/finance/biz_dy/import` | ECOUNT 엑셀 올리기 화면(첫 과제) |
| `/business/biz_dy` | 예전과 같은 **«첨부»** 칸 — «자료 받는 입구»가 **보이면 안 된다** |
| `/purchasing` · `/sales` · `/production` · `/costs` | 모두 **404**(찾을 수 없음) |

---

## g) 문제가 생기면 — 되돌리는 길

- **YES 전에 멈췄으면:** 운영 DB · 앱 모두 그대로다. 스크립트가 link를 staging으로 돌려놓는다.
- **DB는 들어갔고 앱이 이상하면:** 앱만 직전 SHA `96e563c`로 — Vercel 대시보드 → Deployments → `96e563c` 배포 → **Promote to Production**(Instant Rollback). 새 표는 옛 앱이 쓰지 않으므로 그대로 둬도 된다.
- **DB가 잘못 들어갔으면:** 먼저 새 번호의 전방 수정(컨트롤러에게 결과를 보낸다). 데이터가 상했을 때만 Supabase 대시보드 → Database → Backups에서 d)에서 적어 둔 **복원 지점**으로 복원한 뒤, 앱을 `96e563c`로 되돌린다(OPERATIONS §9 «되돌리는 길», DB → 앱의 역순).
- **BOM 키:** 0063 반영 뒤에는 지우거나 바꾸지 않는다(바꾸면 저장한 BOM을 못 읽는다). 지금은 진짜 BOM이 0건이다.
- 반영이 끝나면 `docs/OPERATIONS.md` §9에 «2026-10-?? 릴리스(0050~0066 · `<릴리스 SHA>`)의 값은 복원 지점 … 직전 SHA `96e563c`» 한 줄을 남긴다(스크립트가 그 문장을 출력한다).

---

## 반영 뒤 누가 무엇을 새로 보나

| 사람 | 새로 보이는 메뉴 · 화면 | 안 보이는 것 |
|---|---|---|
| 대표 | 구매 · 영업(견적) · 생산 · 원가 관리(BOM · 비용) 메뉴 · ECOUNT 엑셀 올리기 · 회사 화면 «자료 받는 입구» | — |
| 김병훈(결재 올리기 · DY 사용자 관리자 · 재무 입력 · 문서 등록 · 결재 대장 열람) | DY 재무의 **ECOUNT 엑셀 올리기**(재무 입력 줄로) | 원가 엔진 메뉴 넷(원가 줄 0 — 주소로 가도 404) · 자료 입구(스위치 꺼짐 — 회사 화면은 옛 «첨부» 칸, 입구 동작은 서버에서 거부) |

자료 입구 스위치: `src/lib/intake/switch.ts`의 `INTAKE_OPEN_TO_STAFF = false`(대표만). 실제 AI 시험 뒤 `true`로 바꾸는 한 줄 커밋이 «직원에게 열기»다.
