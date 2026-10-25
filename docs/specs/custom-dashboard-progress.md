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

## 다음 할 일

배포 절차 1~7(0094 블록과 같음).
