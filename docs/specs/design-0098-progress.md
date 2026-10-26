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

## 다음 할 일

1. 화면 파일 이관 마무리(check:design 0건) → typecheck · eslint · build · check:* 전부.
2. 직원 화면 «회장» 전수 검사(직원 dummy 크롤) · check:mobile 전체.
3. 전 · 후 스크린숏(새 · 예전) → docs/onboarding/design-shots/.
4. 배포 절차 1~7(0094 블록) · 운영 스크린숏.
