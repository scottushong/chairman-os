# 기억 엔진(0086) 반영 — 대표가 따라 하는 순서

**넣는 것:** 브랜치 `feat/memory-engine`(워크트리 `C:\Users\Edison Hong\projects\chairman-os-memory`) — 로컬 master(0084 가격 리포트까지) 위.
**마이그레이션 1개:** `0086_memory_engine`(표 열셋 · RPC 열 · 비공개 버킷 `memory-assets` · tasks 넣기 정책 하나 · 스위치 `memory_engine` 기본 «대표만»). **0085는 비어 있다**(청사진 보강 블록 몫 — 지시문 못 찾음).
**화면:** `https://chairman-os-eosin.vercel.app/memory` · `/memory/review` · 모든 화면 오른쪽 아래 연필 단추(Alt+M) · 주의 화면 «기억에서 나온 주의» · 회사/프로젝트 «관련 기억» · 아침 루틴 «어제 기억 · 열린 약속» · 어시스턴트 «기억 검색». 직원 화면에는 아무것도 없다.

규칙: 상자 하나에 명령 하나. `&&`는 쓰지 않는다. 상자 아래 «기대»와 다르면 멈추고 결과를 보낸다.

---

## 0) 앞 반영이 먼저

production이 **0084**여야 한다(0082 수신함 → 0083 공식 결산 → 0084 가격 리포트: `release-2026-10-16.md` · `release-2026-10-17a.md` · `release-price-report.md`). staging은 이미 0084(2026-10-19 확인).

## 1) 0085 자리 정하기 (하나만 고른다)

- 청사진 보강(0085) 지시문이 곧 온다 → 그 블록이 0085를 먼저 반영한 뒤 2)로.
- 0085를 쓰지 않는다 → 이 브랜치에서 `0086_memory_engine.sql`을 `0085_memory_engine.sql`로 이름만 바꾸고(본문 그대로) 아래 번호를 0085로 읽는다. Claude Code에게 «기억 엔진 번호 0085로»라고 하면 된다.
- 그냥 0086으로 둔다 → 그대로 2). (나중에 0085를 넣으려면 `db push --include-all`이 필요하다.)

## 2) master에 합치기 (Git Bash)

```bash
cd ~/projects/chairman-os
```

```bash
git merge --no-ff feat/memory-engine -m "merge: 기억 엔진 Phase 1 (0086 · feat/memory-engine)"
```

기대: 충돌 없음.

## 3) staging push

```bash
npm run db:push:staging
```

기대: dry-run 목록이 **정확히** `0086_memory_engine.sql` 하나 → 적용.

staging 시험(쓰지 않는다 — 끝에 되돌림):

```bash
node scripts/build-staging-dryrun.mjs 0086 0086 --tests-only
```

```bash
SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/dryrun_0086_0086_tests.sql"
```

기대: `ERROR … 0086-0086 TESTS PASS (0 files · tests 1/1 · 0086)`. (Claude Code가 2026-10-19에 staging(0084) 위에서 0086 + 시험을 한 트랜잭션으로 돌려 `DRYRUN PASS (1 files · tests 1/1 · 0086)` · 되돌림을 확인했다.)

## 4) production 반영 (Git Bash — DB 먼저 → 앱)

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh 0086
```

기대: 대기 목록 = `0086` 하나 → «여기서 멈춘다».

```bash
bash scripts/release-production.sh 0086
```

기대: YES 두 번(DB · 앱) → 배포 success → health.

## 5) AI 켜기 (브라우저 · 돈이 드는 일 — 대표가 정한다)

`https://vercel.com` → chairman-os → Settings → Environment Variables → Production:

| 이름 | 값 | 뜻 |
|---|---|---|
| `MEMORY_AI_PER_DAY` | 예: `30` | 하루 AI 처리 건수. **비우거나 0이면 AI 없이 규칙으로만 처리**(기본). |
| `MEMORY_AI_MODEL` | (비움) | 기본 `claude-sonnet-5-5`. |
| `ANTHROPIC_API_KEY` | 이미 있음 | 다른 AI 기능과 같은 키. |

넣은 뒤 Deployments → 최신 Production → «Redeploy». 비용: 메모 한 건 약 $0.01~0.03(진짜 1회 실측 $0.0173 · 입력 3.1k · 출력 1.1k 토큰) — 하루 30건이면 월 약 $10~25.

## 6) 휴대폰 점검 (대표)

1. 아무 화면 → 오른쪽 아래 연필 → «오늘 A회사와 통화했다. 다음 주 금요일까지 견적을 보내기로 했다.» → 저장 → «원본 저장됨 · 분석 중 → 검토 필요».
2. `/memory` → 타임라인에 그 기록 · «내가 한 약속»에 기한 날짜.
3. `/memory/review` → «A회사» 누구인지 · 업무로 만들까 → 프로젝트 골라 «업무로 만들기» → `/tasks`에 업무.
4. 음성: 연필 → «음성» → 녹음 → 저장 → 기록 화면에 «원본 보관 · 전사 대기».
5. 직원 계정(리허설 사원)으로 → 연필 단추 · «기억» 메뉴 없음 · `/memory` 주소 → 내 홈으로.

## 되돌리기

앱: Vercel 직전 Production «Promote». 화면만 숨기기: `/settings/features` «기억 엔진» 끄기(대표도 0행). DB 0086 표는 남겨 둬도 다른 화면에 영향 없다(tasks에는 승인한 업무만 일반 업무로 남는다).

## 검사 (Claude Code가 2026-10-19에 돌림 — 전부 PASS)

`check:memory`(16묶음 — Case A~H · 권한 · 리뷰 고침 · 순수 · 도구 · dummy) · `check:migrations`(0001 → 0086, 82개) · `check:features` · `check:ai-schemas`(10개) · `check:db-safety` · `typecheck` · `lint` · `next build --webpack` · dummy 화면(대표 10장 · 직원 점검 `scripts/shot-memory-staff.ts`) · staging 되돌리는 시험 · 진짜 AI 1회.
