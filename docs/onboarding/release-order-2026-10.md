# 2026-10 릴리스 순서: 결재(0054) 먼저, ECOUNT(0050~0052) 나중

> ## 2026-10-07 확정판 — 이 상자가 아래 본문보다 우선한다
>
> | 순서 | 브랜치(로컬) | 마이그레이션 | 명령 |
> |---|---|---|---|
> | 0 | — | staging에 0054 · 0055 · 0056 | 아래 «0. staging» |
> | A | `feat/approvals-0054` (8f5de3a, master를 이미 합침 → 충돌 없음) | **0054 0055** | `bash scripts/release-production.sh 0054 0055` |
> | B | `feat/ecount-import` (85fb83d, 결재 브랜치를 이미 합침 → A 뒤 충돌 없음) | **0050 0051 0052 0056** (0053은 없음) | `bash scripts/release-production.sh --include-all 0050 0051 0052 0056` |
>
> - **origin/master는 아직 `a3411e2`다.** 로컬 master의 a0be722 · 0efaeba · 8a00dd2(결재 양식 · 릴리스 스크립트 고침)와 이번 블록 커밋(AI 어시스턴트 · 공통 첨부 부품 · `--include-all` · 문서)은 **push되지 않았다.** A의 스크립트가 마지막에 `git push origin master`로 같이 내보낸다. DB 없는 변경만 먼저 내보내고 싶으면 A 전에 master에서 `git push origin master` 한 줄(= 앱 배포)도 된다 — master에는 production에 없는 마이그레이션이 없다(0049까지).
> - B의 대기 목록에는 0056이 0050~0052와 함께 들어간다. 0056은 0055보다 크지만 0050~0052가 낮아서 `--include-all`이 필요하고, 스크립트는 네 번호가 **정확히** 같을 때만 진행한다.
> - B 전에 production SQL Editor에서 `docs/onboarding/ecount-release-precheck.sql`(읽기 전용)을 돌린다.
>
> ### 0. staging (회장이 Git Bash에서 — 이 세션은 staging push가 권한 분류기에 막혔다)
>
> 리허설 checkout(`~/projects/chairman-os-rehearsal`, 브랜치 `release/ecount-rehearsal` = 결재 + ECOUNT 합친 것)에서:
>
> ```bash
> cd ~/projects/chairman-os-rehearsal
> cat supabase/.temp/project-ref        # itpenmxyracfhyormcep 이어야 한다
> npm run db:push:staging               # 검사(check:migrations 등) 뒤 0054 0055 0056 셋만 들어간다(staging은 0052)
> ```
>
> 그다음 staging 시험 SQL 두 개(마지막에 예외를 던져 전부 되돌린다 — staging에 아무것도 남기지 않는다):
>
> ```bash
> P=/c/Users/EDISON~1/AppData/Local/Temp/claude/C--Users-Edison-Hong/4f6e4e33-1a5c-464f-8de4-b0bda684a0ba/scratchpad
> SUPABASE_DB_PASSWORD=$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-) npx supabase db query --linked -f "$(cygpath -w $P/stage1/0054_staging_test.sql)"
> SUPABASE_DB_PASSWORD=$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-) npx supabase db query --linked -f "$(cygpath -w $P/stage2/0055_staging_test.sql)"
> ```
>
> 기대: 오류 문장이 `0054 STAGING PASS …` · `0055 STAGING PASS a … h`로 시작한다(FAIL이면 그 줄을 Claude에게).
>
> ### A 뒤 클릭 순서 (production 앱에서, 회장)
>
> 1. `/settings/users` → 조직도 → **김병훈** 패널 → «**DY (주) 사용자 관리자**» 체크(감사 기록이 남는다). 재무 입력 · 문서 등록 · 결재 올리기가 켜져 있는지 같이 본다.
> 2. 가입 Hook(0043)을 켠다 — `docs/onboarding/signup-hook-checklist.md` 3 → 4 → 5(A1은 이미 정상). **김병훈이 첫 위임 초대를 보내기 전에.**
> 3. 김병훈에게 `docs/onboarding/staff-admin-ko.pdf`를 건넨다.
> 4. 김병훈이 첫 초대를 저장하면 회장 종 알림에 «…님이 DY (주)에 …님(사원)을 초대했습니다»가 온다. 가입 뒤 조직도에서 그 사람의 결재 올리기 ☑(자동) · 고른 권한을 본다.
> 5. 0054 전에 올라온 «팀장 대기» 결재(회장이 팀장 칸에 선 것)가 있으면 `/me` 받은 결재에서 처리한다.

production DB는 지금 **0049**다. 이번 달 마이그레이션 두 묶음이 나가는데, 번호 순서와 내보내는 순서가 다르다.

| 순서 | 브랜치 | 마이그레이션 | 명령 |
|---|---|---|---|
| A (먼저) | `feat/approvals-0054` | 0054, 있으면 0055 | `bash scripts/release-production.sh 0054` |
| B (나중) | `feat/ecount-import` | 0050 · 0051 · 0052, 있으면 0053 | `bash scripts/release-production.sh --include-all 0050 0051 0052` |

B의 번호(0050~0052)는 A가 이미 넣은 0054보다 **낮다**. Supabase `db push`는 이런 «순서 뒤바뀜» 파일을
`--include-all` 없이는 넣지 않는다. 그래서 B에만 `--include-all`을 붙인다. A에는 붙이지 않는다.

**master에 push하면 곧바로 production 앱 배포(Vercel)다.** DB가 앱보다 먼저 가야 한다.
`release-production.sh`가 그 순서를 지킨다: DB push → staging 재link → origin 비교 → 두 번째 YES → `git push origin master` → health.
`git push`를 따로 치지 않는다. 스크립트 안에 있다.

모든 명령은 Git Bash에서 `~/projects/chairman-os`(master checkout)에서 친다.

---

## A. 결재 릴리스 (0054, 있으면 0055)

### A-0. 몇 번까지 있는지 본다

```bash
cd ~/projects/chairman-os
git checkout master
git pull --ff-only origin master
git merge --no-ff feat/approvals-0054
ls supabase/migrations | tail -4
```

- 끝이 `0054_…sql`이면 **0054 하나**다.
- `0055_…sql`까지 있으면 **0054 0055**다.
- 0050~0052가 보이면 ECOUNT가 먼저 섞인 것이다. 멈추고 물어본다.

`git status --short`가 비어 있어야 한다. 스크립트는 추적 안 된 파일이 하나라도 있으면 1단계에서 멈춘다
(2026-10-06 현재 master checkout에 추적 안 된 `projects/` 폴더가 있다. 릴리스 전에 다른 곳으로 옮긴다).

### A-1. 넣기 전 검사 (master에서)

```bash
npm run check:migrations
npm run typecheck
npm run lint
npm run build
npm run check:release
```

다섯 개 모두 통과해야 한다. 하나라도 실패하면 여기서 멈춘다.
staging에는 이미 넣어서 확인했어야 한다(OPERATIONS §9 1~2단계: `npm run db:push:staging` → Preview 확인).

### A-2. 리허설: production에 쓰지 않는다

0054 하나일 때:

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh 0054
```

0055도 있을 때:

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh 0054 0055
```

끝에 `RELEASE_DRY_RUN=1 — 여기서 멈춘다. production DB · git · 앱은 그대로다.` 가 나오고
`== 6. link를 staging(itpenmxyracfhyormcep)으로 되돌림 ==` → `staging으로 돌아왔다.` 가 보이면 된다.
중간의 «OPERATIONS §9 «되돌리는 길» 기록용:» 줄은 이때 적어 두지 않는다. 진짜 실행 때 나오는 줄을 쓴다.

### A-3. 진짜 실행

```bash
bash scripts/release-production.sh 0054
# 또는 0055도 있으면
bash scripts/release-production.sh 0054 0055
```

1. 2단계에서 나오는 «기록용» 한 줄을 복사해 둔다.
2. `production(nndvspgnljivkvihxlzj)에 0054 를 적용한다. 계속하려면 YES 입력:` → `YES`
3. 스크립트가 staging으로 되돌리고 나갈 커밋을 보여 준다.
4. `git push origin master = Vercel Production 배포. 앱 배포하려면 YES 입력:` → `YES`
5. 스크립트가 Vercel 배포가 끝나기를 기다린 뒤(최대 10분) `/api/health`를 부른다.

### A-4. 확인

- health JSON에서 anon 쪽이 전부 `rows: 0` · `rls_closed: true` (OPERATIONS §1 배포 후 확인 1~4).
- Vercel 대시보드에서 새 배포가 Production(Current)인지.
- 복사해 둔 «기록용» 줄을 OPERATIONS §9 «되돌리는 길» 목록 끝에 붙여 커밋한다.

---

## B. ECOUNT 릴리스 (나중에: 0050 · 0051 · 0052, 있으면 0053)

A가 끝나 production이 0054(또는 0055)인 상태에서 한다.

### B-0. ECOUNT 브랜치를 master에 합친다

```bash
cd ~/projects/chairman-os
git checkout master
git pull --ff-only origin master
git merge --no-ff feat/ecount-import      # 충돌 나면 풀고 커밋. rebase 쪽을 원하면 ECOUNT worktree에서 `git rebase master` 후 merge
ls supabase/migrations | tail -7
```

목록에 0050 · 0051 · 0052(있으면 0053)와 0054(있으면 0055)가 **같이** 있어야 한다.
0053이 있으면 아래 명령마다 `0053`을 덧붙인다.

### B-1. 넣기 전 검사 (master에서)

```bash
npm run check:migrations
npm run typecheck
npm run lint
npm run build
npm run check:release
```

주의: `check:migrations`(PGlite)는 파일을 **번호순**(0050 → 0054)으로 적용한다. production은 **0054 → 0050** 순서가 된다.
0050~0052가 0054·0055가 만든 것에 기대지 않고, 0054·0055가 0050~0052가 만들 것을 전제하지 않는지
(같은 함수·정책을 둘 다 고치지 않는지) 한 번 눈으로 본다.

### B-2. staging도 같은 순서 문제가 있다

staging에 0054가 먼저 들어가 있고 0050~0052가 없으면 `npm run db:push:staging`이 «Found local migration files to be inserted before the last migration on remote database»로 멈춘다.
`db:push:staging`은 일부러 `--include-all`을 받지 않는다(`check:db-safety`가 그것을 지킨다). 이때만 손으로:

```bash
STAGING_PW="$(grep '^SUPABASE_DB_PASSWORD=' .env.staging.local | cut -d= -f2- | tr -d '\r"')"
SUPABASE_DB_PASSWORD="$STAGING_PW" node scripts/supabase-guarded.mjs -- link --project-ref itpenmxyracfhyormcep
cat supabase/.temp/project-ref            # itpenmxyracfhyormcep 이 아니면 멈춘다
SUPABASE_DB_PASSWORD="$STAGING_PW" node scripts/supabase-guarded.mjs -- migration list --linked
SUPABASE_DB_PASSWORD="$STAGING_PW" node scripts/supabase-guarded.mjs -- db push --linked --dry-run --include-all
#   ↑ 0050 0051 0052(0053)만 나오면
SUPABASE_DB_PASSWORD="$STAGING_PW" node scripts/supabase-guarded.mjs --answer-y --timeout 900 -- db push --linked --yes --include-all
```

staging에 이미 0050~0052가 있으면(ECOUNT를 먼저 staging에 넣어 봤으면) 이 단계는 건너뛴다.
그다음 Preview에서 ECOUNT 업로드와 결재 화면을 둘 다 본다.

### B-3. 리허설

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh --include-all 0050 0051 0052
# 0053이 있으면
RELEASE_DRY_RUN=1 bash scripts/release-production.sh --include-all 0050 0051 0052 0053
```

4단계 끝에 이런 경고가 나온다. **정상이다**:

```text
dry-run도 같은 목록이다.

순서 뒤바뀜: 0050·0051·0052는 이미 적용된 0054보다 번호가 낮다 — --include-all로만 적용된다.
--include-all: dry-run과 push 둘 다 --include-all로 돈다. 대기 목록이 위 번호와 정확히 같다.

RELEASE_DRY_RUN=1 — 여기서 멈춘다. production DB · git · 앱은 그대로다.
```

(production이 0055면 «이미 적용된 0055보다»로 나온다.)

### B-4. 진짜 실행

```bash
bash scripts/release-production.sh --include-all 0050 0051 0052
# 또는
bash scripts/release-production.sh --include-all 0050 0051 0052 0053
```

YES 질문 바로 위에 같은 «순서 뒤바뀜» 경고가 한 번 더 나오고, 질문은
`production(nndvspgnljivkvihxlzj)에 0050 0051 0052 를 적용한다 (--include-all). 계속하려면 YES 입력:` 이다.
이후는 A-3 · A-4와 같다: «기록용» 줄 복사 → `YES` → 앱 `YES` → health 확인 → «되돌리는 길»에 줄 붙이기.

---

## 멈췄을 때

어느 단계에서 멈추든 스크립트는 나가면서 link를 staging으로 되돌린다(`staging으로 돌아왔다.`).
YES 전에 멈췄으면 production DB도 앱도 그대로다.

| 나온 말 | 뜻 | 할 일 |
|---|---|---|
| `순서 뒤바뀜: …` 다음에 `중단: --include-all 없이 실행했다.` | 대기 중인 번호가 이미 적용된 최고 번호보다 낮다 | 안내에 나온 대기 목록이 B에서 넣으려던 번호와 같은지 보고, 같으면 안내된 명령(`--include-all` + 그 번호들)으로 다시 친다. 다르면 멈추고 물어본다 |
| `중단: 대기 목록이 기대와 다르다. 아무것도 쓰지 않았다.` | production이 기다리는 목록과 인자로 준 번호가 다르다(하나 많거나 모자람) | `대기(migration list):` 줄을 본다. 0053·0055를 빠뜨렸으면 붙여서 다시. 모르는 번호가 있으면 멈추고 물어본다. `--include-all`은 그 목록을 **전부** 넣기 때문에, 번호가 정확히 같을 때만 진행한다 |
| `중단: production에만 있고 이 checkout에 없는 마이그레이션: …` | 이 master에 production이 가진 파일이 없다 | A가 합쳐지지 않은 checkout이다. `git pull` / merge 상태부터 본다 |
| `중단: dry-run 실패.` 위에 `Found local migration files to be inserted before …` | `--include-all`을 안 줬는데 CLI가 순서 뒤바뀜을 찾았다 | 위 첫 줄과 같다 |
| `중단: YES가 아니다. DB는 그대로다.` | 첫 질문에 YES 아닌 것을 쳤다 | 준비되면 같은 명령을 다시 |
| `중단: YES가 아니다. DB는 적용됐고 앱은 그대로다` | DB는 들어갔고 앱만 안 나갔다 | 준비되면 `git push origin master` 한 줄만 (DB를 다시 넣지 않는다) |
| `중단: origin에만 있는 커밋이 N 개 있다` | DB는 들어갔다. 그사이 누가 origin/master에 push했다 | `git pull --no-rebase origin master` → 검사 → `git push origin master` |
| `중단: db push 실패.` | 마이그레이션 적용 중 오류 | OPERATIONS §9 «DB 마이그레이션 실패». 다시 돌리기 전에 SQL Editor에서 `supabase_migrations.schema_migrations`의 최신 버전을 본다 |
| `경고: staging 재link 실패.` | 끝나고 link가 production에 남았을 수 있다 | `npm run db:push:staging` 또는 `npx supabase link --project-ref itpenmxyracfhyormcep` |
