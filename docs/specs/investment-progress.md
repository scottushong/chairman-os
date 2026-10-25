# 0094~0096 Investment Intelligence — 진행 기록

새 세션은 이 파일을 읽고 «다음 할 일»부터 묻지 않고 이어간다.
작업 자리: worktree `C:\Users\Edison Hong\projects\chairman-os-invest` · 브랜치 `feat/investment-0094` (단계마다 master에 merge -m).

## 기록

- 2026-10-25 12:20 KST — 원문 · 참고 이미지 7장 · 이 파일을 master `611def9`로 커밋. worktree 생성.
- 2026-10-25 12:38 KST — **0093 선행 릴리스**(이 블록 것 아님). 운영 DB가 0091이라 0094는 0093 없이 나갈 수 없음(번호 순서 push).
  0093은 10-23 staging 시험 PASS · 반영 문서 준비분이라 단독 릴리스로 먼저 냄.
  - staging `npm run db:push:staging` → 0093 적용.
  - `bash scripts/release-production.sh 0093` → push · 앱 `611def9` 배포 success · health ok:true · anon 전부 0 · rls_closed true.
  - 기록용: 2026-10-25 릴리스(0093 · `611def9`) 복원 지점 ≈ `2026-10-25 03:2x UTC`(= 12:2x KST, 리허설 03:24 UTC 직후 · 실행 출력 앞부분 잘림), production 0091, 직전 SHA `dfad81d`.

- 2026-10-25 13:50 KST — 1단계 구현 · 검사 끝(브랜치 feat/investment-0094).
  - check:investment 27 PASS · check:migrations PASS(0094 권한 + Expand-only) · check:features PASS · check:mobile 투자 6화면 × 6기기 36/36 · typecheck.
  - staging 시험 `0094-0094 DRYRUN PASS (1 files · tests 1/1 · 0094)`(되돌림).
  - 실제 수집(메모리, 네트워크): 13F 4곳 × 5분기 · NBIM 2기 · OpenFIGI 59/60 · XBRL · 환율 — Berkshire 2026-06-30 NEW 4 · ADD 11 · TRIM 12 · EXIT 17.

### 1단계 DB 변경 목록(0094_investment_radar) — 새 것만
- 표: investment_settings · investment_managers(시드 4) · investment_sources(시드 13) · investment_collect_runs · securities · security_prices ·
  security_corporate_actions · etf_holdings · company_financials · company_metrics · investment_disclosures · investment_positions ·
  investment_position_changes · investment_audit_logs
- 함수: inv_admin · inv_reader · inv_collector · inv_analyst · investment_audit_stamp(트리거)
- 줄: feature_switches (null, 'investment', true, 'chairman')
- 기존 표 · 칸 변경 없음.

## 다음 할 일

1단계 배포(merge → master 검사 → staging push → 직전 코드 호환 → 릴리스 → health → 배포 뒤 검증).
