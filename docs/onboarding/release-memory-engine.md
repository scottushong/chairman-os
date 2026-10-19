# 기억 엔진(0088) 반영 — 대표가 따라 하는 순서

**넣는 것:** 브랜치 `release/2026-10-20`(워크트리 `C:\Users\Edison Hong\projects\chairman-os-rel1020`) — `feat/memory-engine`(bba4f62)을 합치고 번호를 0086 → 0088로 바꾼 것. 같은 브랜치에 0086 직원 홈 · 0087 전자결재 · 0089 재무 보강도 있다.
**마이그레이션 1개(기억 엔진 몫):** `0088_memory_engine`(표 열셋 · RPC 열 · 비공개 버킷 `memory-assets` · tasks 넣기 정책 하나 · 스위치 `memory_engine` 기본 «대표만»). 0082~0087의 어떤 것도 물지 않는다(0073 스위치 표 · 0001/0031 감사 · 0002 · 0009만).
**화면:** `https://chairman-os-eosin.vercel.app/memory` · `/memory/review` · 모든 화면 오른쪽 아래 연필 단추(Alt+M) · 주의 화면 «기억에서 나온 주의» · 회사/프로젝트 «관련 기억» · 아침 루틴 «어제 기억 · 열린 약속» · 어시스턴트 «기억 검색». 직원 화면에는 아무것도 없다.

규칙: 상자 하나에 명령 하나. `&&`는 쓰지 않는다. 상자 아래 «기대»와 다르면 멈추고 결과를 보낸다.

---

## 0) 앞 반영이 먼저

staging은 0084 · 0085 · 0087까지 있다(2026-10-20 읽기 확인). 0086 · 0088은 0087보다 낮은 번호라 **«순서 밖»** — `db push`는 `--include-all`이 있어야 받는다(`docs/decisions/2026-10-20-home-widgets.md` «반영 명령»과 같다). 0089는 그 뒤.

## 1) master에 합치기 (Git Bash)

```bash
cd ~/projects/chairman-os
```

```bash
git merge --no-ff release/2026-10-20 -m "merge: release/2026-10-20 (0086 홈 · 0087 전자결재 · 0088 기억 엔진 · 0089 재무 보강)"
```

기대: 충돌 없음.

## 2) staging push (순서 밖 — 손 명령)

`npm run db:push:staging`은 `--include-all`을 받지 않는다. 그래서:

```bash
npx supabase link --project-ref itpenmxyracfhyormcep
```

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db push --linked --include-all
```

기대: 목록이 **정확히** `0086_home_widgets.sql` · `0088_memory_engine.sql` · `0089_finance_mapping.sql` → 적용.

staging 시험(쓰지 않는다 — 끝에 되돌림):

```bash
node scripts/build-staging-dryrun.mjs 0088 0088 --tests-only
```

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/dryrun_0088_0088_tests_only.sql"
```

기대: `ERROR … 0088-0088 TESTS PASS (0 files · tests 1/1 · 0088)`. (Claude Code가 2026-10-20에 staging(0084 · 0085 · 0087) 위에서 0086 · 0088 · 0089 + 시험 셋을 한 트랜잭션으로 돌려 `0086-0089 DRYRUN PASS (3 files · tests 3/3 · 0086,0088,0089)` · 되돌림(뒤에 읽어 표 · 함수 · 스위치 줄 · 버킷 0)을 확인했다 — 명령 `node scripts/build-staging-dryrun.mjs 0086 0089 --tests --skip=0087`.)

## 3) production 반영 (Git Bash — DB 먼저 → 앱)

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh --include-all 0086 0088 0089
```

기대: 대기 목록 = production에 없는 번호 전부(0087이 이미 있으면 `0086 · 0088 · 0089`) → «여기서 멈춘다». 번호가 다르면 스크립트가 맞는 목록을 보여 준다 — 그 목록으로 다시.

```bash
bash scripts/release-production.sh --include-all 0086 0088 0089
```

기대: YES 두 번(DB · 앱) → 배포 success → health.
## 4) AI 켜기 (브라우저 · 돈이 드는 일 — 대표가 정한다)

`https://vercel.com` → chairman-os → Settings → Environment Variables → Production:

| 이름 | 값 | 뜻 |
|---|---|---|
| `MEMORY_AI_PER_DAY` | 예: `30` | 하루 AI 처리 건수. **비우거나 0이면 AI 없이 규칙으로만 처리**(기본). |
| `MEMORY_AI_MODEL` | (비움) | 기본 `claude-sonnet-5-5`. |
| `ANTHROPIC_API_KEY` | 이미 있음 | 다른 AI 기능과 같은 키. |

넣은 뒤 Deployments → 최신 Production → «Redeploy». 비용: 메모 한 건 약 $0.01~0.03(진짜 1회 실측 $0.0173 · 입력 3.1k · 출력 1.1k 토큰) — 하루 30건이면 월 약 $10~25.

## 5) 휴대폰 점검 (대표)

1. 아무 화면 → 오른쪽 아래 연필 → «오늘 A회사와 통화했다. 다음 주 금요일까지 견적을 보내기로 했다.» → 저장 → «원본 저장됨 · 분석 중 → 검토 필요».
2. `/memory` → 타임라인에 그 기록 · «내가 한 약속»에 기한 날짜.
3. `/memory/review` → «A회사» 누구인지 · 업무로 만들까 → 프로젝트 골라 «업무로 만들기» → `/tasks`에 업무.
4. 음성: 연필 → «음성» → 녹음 → 저장 → 기록 화면에 «원본 보관 · 전사 대기».
5. 직원 계정(리허설 사원)으로 → 연필 단추 · «기억» 메뉴 없음 · `/memory` 주소 → 내 홈으로.

## 되돌리기

앱: Vercel 직전 Production «Promote». 화면만 숨기기: `/settings/features` «기억 엔진» 끄기(대표도 0행). DB 0088 표는 남겨 둬도 다른 화면에 영향 없다(tasks에는 승인한 업무만 일반 업무로 남는다).

## 검사 (Claude Code가 2026-10-20 release/2026-10-20에서 다시 돌림 — 전부 PASS)

`check:memory`(16묶음 — Case A~H · 권한 · 리뷰 고침 · 순수 · 도구 · dummy) · `check:migrations`(0001 → 0089, 86개 — 0086 홈 · 0088 기억 · 0089 재무 PGlite) · `check:features` · `check:home-widgets` · `check:finance-upload` · `check:boundaries` · `check:ai-schemas`(10개) · `check:db-safety` · `typecheck` · `lint`(바뀐 파일) · dummy 화면(`docs/onboarding/memory-shots-1020/` — 대표 1280 · 390 · 직원 막힘) · staging 되돌리는 시험(0086 · 0088 · 0089 한 트랜잭션). 진짜 AI 0회(2026-10-19 1단계 때 1회 $0.0173).
