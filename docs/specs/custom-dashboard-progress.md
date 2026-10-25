# 0097 대표 첫 화면 구역 · 위젯 — 진행 기록

새 세션은 이 파일을 읽고 «다음 할 일»부터 묻지 않고 이어간다.
작업 자리: worktree `C:\Users\Edison Hong\projects\chairman-os-dash0097` · 브랜치 `feat/dashboard-0097`.

## 기록

- 2026-10-25 — 지시문 · 시안을 master `4a26c98`로 커밋. worktree 생성.
- 구현 · 검사(브랜치): check:dashboard 20 · check-dashboard-db(PGlite) · check:home-widgets 18 · 화면 시험 CHAIR · STAFF · FAIL PASS · check:mobile `/` · `/home` 12/12.

### DB 변경 목록(0097_home_sections) — 새 것만
- 새 칸: home_layouts.sections(jsonb · null 허용 · 기본값 없음) + 모양 제약 home_layouts_sections_shape
- 함수: home_kind_allowed · home_scope_valid · home_sections_valid · home_layout_save_sections
- 기존 표 · 칸 · 함수 변경 없음 · 스위치 줄 없음(0086 home_widgets 그대로).

- **2026-10-25 23:10 KST — 배포 완료(0097 · `ee23a69`).**
  - master 검사: typecheck · eslint · build · check:* 51개 전부(check:migrations는 V8 wasm 메모리 오류로 한 번 죽어 단독 재실행 PASS · LATEST_MIGRATION 맞춤) · check:mobile `/` · `/home` 12/12 · 화면 시험 CHAIR · STAFF · FAIL.
  - staging: 되돌리는 시험 `0097-0097 DRYRUN PASS (1 files · tests 1/1 · 0097)` → `npm run db:push:staging` → 반영 뒤 `0097 TESTS PASS (tests 1/1)`.
  - 호환: 직전 운영 SHA `5b2db2b`를 staging(0097) 위에서 빌드 · 기동 — health ok · rls_closed · 화면 로그인 리다이렉트 · 오류 로그 없음.
  - 리허설 기대 = 대기(0097) → 릴리스 → 배포 success · health ok:true · anon 0 · rls_closed true.
  - 배포 뒤 검증(운영): anon RPC · 표 42501 · AI 계정 저장 home_denied · home_kind_allowed('fin_kpis') false · 0행. 대표 · 직원 로그인 검증은 자격증명이 없어 못 함(직원 403은 dummy 화면 시험 + staging SQL 시험 c).

## 다음 할 일

없음 — 최종 보고 완료.
