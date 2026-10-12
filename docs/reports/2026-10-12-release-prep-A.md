# 2026-10-12 A 보고 — 0069 · 0070 · 0071 한 번에 반영 준비 + tasks FORCE RLS

## FORCE RLS 답 (맨 위)

**예. ff14103 뒤 최종 0071(b7a0b43)은 `tasks`와 `process_charts`의 FORCE ROW LEVEL SECURITY를 없앴다.**
1절의 `alter table process_charts no force row level security;` · `alter table tasks no force row level security;` 두 줄이다.

- **고쳤다(`cbb3e14`, `feat/process-charts-sync` = `release/process-charts`).** 0071은 이제 FORCE를 내리지 않고, 9절에서 두 표에 FORCE를 다시 건다.
- 동기화가 FORCE 아래에서도 돌게 하려고 «동기화 통로»를 좁게 냈다.
  - `process_chart_sync_ctx()`는 동기화 함수 넷(targets · gate · apply · fail) 안에서만 참이다. 함수 SET 절이 값을 켜고, 함수가 끝나면 Postgres가 되돌린다.
  - 통로로 열리는 것: `process_charts` 읽기와 줄 잡기, `tasks` 중 **시트 업무만**(source_label 있음) 읽기 · 넣기 · 고치기. 앱 업무는 통로로도 못 고친다.
  - 0013 · 0021의 «AI Agent는 쓰지 않는다» restrictive 셋도 같은 통로만 열어 다시 만들었다.
  - `process_charts_read`는 표를 다시 읽지 않는 판정(team_id)으로 바꿨다. FORCE 아래에서 정책이 자기 자신을 부르지 않게 하려는 것이다.
- **tasks · calendar_items에 걸린 다른 표:**
  - `calendar_items`는 security_invoker 뷰다. 읽는 표는 events · decisions · initiatives · milestones · tasks · process_chart_items다.
  - 0071은 이 중 tasks만 건드렸고, 지금은 그대로 FORCE다.
  - decisions의 FORCE는 0034에 일부러 내렸다(이번 일과 무관 · 목록 예외).
  - teams는 0071 안에서 잠깐 내렸다가 같은 파일에서 다시 건다. 최종 상태는 FORCE다.
  - 나머지 셋(events · initiatives · milestones)은 0071이 건드리지 않는다.
  - 정의자 함수와 owner 뷰 중 tasks · process_charts를 읽는 것은 0071 함수뿐이었다(전 마이그레이션 검색).
- **staging 사실(읽기 전용 확인):** `postgres`는 BYPASSRLS이고 `authenticated`에 속한다. 그래서 통로 없이도 돈다. 통로는 BYPASSRLS가 아닌 소유자에 대비한 것이다.
- **check:db-safety에 «FORCE RLS가 있던 표가 꺼지면 FAIL»을 넣었다** (`scripts/check-force-rls.mjs`).
  - 예외는 과거에 일부러 내린 8개 표 목록뿐이다: 0023 둘 · 0027 · 0029 둘 · 0034 · 0051 둘.
  - 옛 0071을 넣으면 `tasks` · `process_charts` 두 줄로 FAIL이 나는 것을 확인했다.

## 결과 표

| 항목 | 결과 |
|---|---|
| 0071 FORCE 고침 | `cbb3e14` — FORCE 유지 + 동기화 통로 |
| BYPASSRLS 아닌 소유자에서 0071 시험 | PASS — `check:staging-sql-cost`가 소유자를 바꿔 0071 staging 시험 SQL을 한 번 더 돌린다(통로를 넣기 전에는 `process_sync_not_found`로 FAIL — 대조군) |
| 사람 세션이 통로를 켜기 | 거부 — 설정값을 켜도 `process_chart_sync_ctx()` = false, 시트 업무 넣기는 RLS가 막음 |
| DB/RLS 리뷰(서브에이전트, 읽기만) | Critical 0 · Important 0 · Minor 3 → `DEFERRED.md` |
| 리허설 브랜치 | `release/2026-10-12-rehearsal` · 워크트리 `C:\Users\Edison Hong\projects\chairman-os-rehearsal1012` |
| 합친 순서 | master `d47ebf7` → `release/ai-assist` → `release/finance-upload-v2` → `release/process-charts` → `docs/seed-check` (모두 merge -m) |
| 충돌 | `version.ts`(마지막 번호 0071) · `check-staging-sql-0061.ts`(0069 → 0070 → 0071 순서 · 0071은 소유자를 바꾸므로 맨 뒤) · repository `dummy.ts` · `supabase.ts` · `types.ts` · `types/index.ts` — 셋 다 살림 |
| typecheck | PASS (새 워크트리라 `next typegen` 먼저) |
| lint | PASS |
| check 29개(db-safety ~ release, mobile 제외) | 전부 PASS |
| check:migrations | PASS — 68 migrations (0001 → 0071) |
| build(`next build --webpack`) | PASS (exit 0 · «Compiled successfully» · [activity] 동적 렌더 안내 줄은 예전과 같음) |
| staging 대기 | **0069 · 0070 · 0071 셋뿐** — staging 마지막 번호 `0068`(읽기 전용 `schema_migrations` 조회) |
| 반영 문서 | `C:\Users\Edison Hong\projects\chairman-os-rehearsal1012\docs\onboarding\release-2026-10-12.md` (a~f · 상자 하나에 한 줄 · 상자마다 기대 · 직원 화면 표) |
| 대표 결정 | 사용자 관리자 범위 «관리하는 회사의 사원 · 팀장» — 0069 구현이 이미 그대로라 바꿀 것 없음. 시드 정리 A안 → B 마이그레이션에 넣음 |

## 하지 못한 것

- **check:mobile**은 dummy 서버(:3100)와 120화면이 필요하다. 메모리 규칙(1.5GB) 때문에 이번에도 돌리지 않았다.
- **staging push와 운영 반영**은 이 세션에서 막혀 있다(권한 분류기). 대표가 문서 a)부터 직접 한다.
- 0071 staging 시험은 staging에서 postgres(BYPASSRLS)로 돈다. 그래서 FORCE 아래 동기화는 PGlite(BYPASSRLS 아닌 소유자)에서만 쟀다.

## 회장이 할 일

| 순서 | 담당 | 상태 | 방법 |
|---|---|---|---|
| 1 | 회장 | 대기 | `C:\Users\Edison Hong\projects\chairman-os-rehearsal1012\docs\onboarding\release-2026-10-12.md`의 a) staging push → b) 시험 SQL 셋 + FORCE 확인 |
| 2 | 회장 | 대기 | 같은 문서 c) master merge → d-1 운영 읽기(맨 위 0068) → d-2 `RELEASE_DRY_RUN=1` → d-3 실제 반영 |
| 3 | 회장 | 대기 | e) `https://chairman-os-eosin.vercel.app/api/health` · 운영 FORCE 두 줄 true |
| 4 | 회장 | 선택 | 프로세스 차트 시트 연결: `C:\Users\Edison Hong\projects\chairman-os-pchart\docs\onboarding\process-chart-google-setup.md`(Vercel env `GOOGLE_SHEETS_SA_JSON`) |
| 5 | 회장 | 선택 | 재무 올리기 AI 분류를 켤 때만: Vercel env `FINANCE_UPLOAD_AI_PER_FILE`(권장 2) · `FINANCE_UPLOAD_AI_PER_DAY`(권장 50) |
| 6 | 회장 | **필요** | 통합 블록 D(월별 손익)의 지시문 본문이 빠져 있다(«<<< 여기에 월별 손익 지시문 전체 … >>>» 자리). 붙여 주어야 D를 한다 |
