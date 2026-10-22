# 0091 재무 자동 판단 — 반영 순서

브랜치 `feat/finance-auto-0091`(release/2026-10-20 위 — 0086 · 0088 · 0089 포함). 0090은 비어 있다(다른 블록 몫).
마이그레이션 하나: `supabase/migrations/0091_finance_auto.sql` — 표 `fin_auto_fixes` · 함수 `fin_auto_fix` · 스위치 `finance_auto`(기본 전원). 0085 · 0073만 문다.

## 확인한 것(2026-10-20)
- `npm run check:migrations` — 87개 전부 적용 PASS(0091 a~g 포함).
- `npm run check:finance-auto` — 31 PASS(다섯 규칙 맞는 경우 · 틀린 경우 · 빼기 → 다시 계산).
- `npm run check:finance-overview` · `check:features` — PASS. typecheck · eslint · `next build --webpack` — PASS.
- staging dry-run: `node scripts/build-staging-dryrun.mjs 0091 0091 --tests` → `0091-0091 DRYRUN PASS (1 files · tests 1/1 · 0091)`. 뒤에 읽어 보니 staging 마지막 버전 0087 · `fin_auto_fixes` 없음 — 되돌아갔다.

## 순서(회장이 손으로)
1. release/2026-10-20을 먼저 반영한다(docs/onboarding/release-2026-10-20.md — 0086 · 0088 · 0089).
2. staging: `cd ~/projects/chairman-os-auto91` → `npx supabase db push --linked --include-all`(0086 · 0088 · 0089 · 0091이 순서 밖이라 include-all).
3. 운영 미리 보기: `RELEASE_DRY_RUN=1 bash scripts/release-production.sh --include-all 0086 0088 0089 0091`
4. 운영 실제: `bash scripts/release-production.sh --include-all 0086 0088 0089 0091` → 앱 push(master).

## 되돌리기
- 화면만 끄기: 설정 › 기능 스위치 «재무 자동 판단» 끄기 → 0089까지 계산 그대로(표는 남는다).
- 고친 기록은 덧붙이기만 — 지울 필요 없음. 같은 자리에 «자동으로 돌리기»가 마지막이면 없던 것과 같다.
