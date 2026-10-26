# 0098 디자인 전면 교체 — 진행 기록

새 세션은 이 파일을 읽고 «다음 할 일»부터 묻지 않고 이어간다.
작업 자리: worktree `C:\Users\Edison Hong\projects\chairman-os-design0098` · 브랜치 `feat/design-0098`.
지시문 `docs/specs/2026-10-26-design-refresh.txt` · 시안 `docs/design/chairman-os-custom-sections-edit-mode.png`.

## 기록

- 2026-10-26 — worktree 생성. 바꾸기 전 스크린숏(master 9352d90, dummy) 12화면 × PC · 폰 → 작업 뒤 docs/onboarding/design-shots/ 로 복사.
- 토큰: `src/app/globals.css` — @theme(= 새 모양) · [data-ui='classic'](예전 값 그대로) · 다크 두 벌 · 사이드바 면 · 심플(예전).
  JS 쪽 `src/lib/design/tokens.ts`(이름표 · 값이 필요한 자리) · `src/lib/design/scene-palette.ts`(그룹 시티 3D).
- 스위치: `user_settings.ui_theme`(0098 · null = 새 모양) · 설정 → 화면 → «화면 모양» · 셸 data-ui.
- 검사: `npm run check:design`(토큰 밖 색 · 글꼴 0 · 대비 7판 AA · 두 벌 이름) · `scripts/check-ui-theme-db.ts`(check:migrations 안).

### DB 변경 목록(0098_ui_theme) — 새 것만
- 새 칸: user_settings.ui_theme(text · null 허용 · 기본값 없음) + 제약 user_settings_ui_theme_shape(new · classic)
- 기존 표 · 칸 · 정책 · 함수 변경 없음.

- 이관: 화면 파일 133개(1차 커밋) — 재무 21 · 전자결재/결재 15 · 그룹 시티 16(+ scene-palette 약 155값) · 그 밖 46 · 셸 7. check:design 토큰 밖 995 → 0.
- 브랜치 검사: typecheck · eslint 0 오류 · check:design PASS · 직원 «회장» 크롤 sales_staff 160화면 · dy_ceo 160화면 0곳 · check:mobile 204/204(dev 서버가 메모리로 한 번 죽어 아이패드 둘은 다시 돌림).
- 스크린숏: docs/onboarding/design-shots/ 72장(12화면 × PC · 폰 × 전 · 새 · 예전) + README 비교표.

- **2026-10-26 16:22 KST — 배포 완료(0098 · `f5da0be`).**
  - master 검사: typecheck · eslint(오류 0) · build · check:* 52개 전부(check:migrations 0098 포함 · check:design 포함) · check:mobile 204/204 · 직원 «회장» 크롤 2역할 × 160화면 0곳.
  - staging: `0098-0098 DRYRUN PASS (1 files · tests 1/1 · 0098)` → `npm run db:push:staging` → 반영 뒤 `0098-0098 TESTS PASS (tests 1/1)`.
  - 호환: 직전 운영 SHA `9352d90`를 staging(0098) 위에서 빌드 · 기동 — health ok · rls_closed · 화면 로그인 리다이렉트 · 오류 로그 없음.
  - 리허설 기대 = 대기(0098) → 릴리스 → 배포 success · health ok:true · anon 0 · rls_closed true.
  - 배포 뒤(운영): user_settings.ui_theme 칸 있음(없는 칸 42703 대조) · anon 0행 · /login · /privacy 새 모양(prod-*.jpg). 로그인 뒤 화면은 자격증명이 없어 운영에서 못 찍음(dummy 스크린숏으로 대신).

## 다음 할 일

없음 — 최종 보고 완료.
