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

- **2026-10-25 14:40 KST — 1단계 배포 완료(0094 · `e827b5f`).**
  - master 검사: typecheck · eslint · build · check:* 49개 전부 · check:release · check:mobile 162/162(27화면 × 6기기).
  - staging `npm run db:push:staging` → 0094. 호환: 직전 운영 SHA `611def9`를 staging(0094) 위에서 빌드 · 기동 — health ok · rls_closed · 화면 로그인 리다이렉트 · 오류 로그 없음.
  - `RELEASE_DRY_RUN=1` 기대 = 대기(0094) → 릴리스 → 배포 success · health ok:true · anon 0 · rls_closed true.
  - 배포 뒤 검증: 운영 cron 수동 호출(Integration) — 환율 LIVE · NBIM 2기 LIVE(NEW 466 · EXIT 590 = 로컬 계산과 같음) ·
    **SEC 13F 네 곳 403 = 막힘**: sec.gov 문서 서버가 연락 이메일 없는 User-Agent를 막음(data.sec.gov는 통과). Vercel 환경변수
    `SEC_USER_AGENT`(회사명 + 연락 이메일)가 필요 — 회장 몫. 권한: anon 0행 · 수집 계정 설정/기관 고치기 0줄 · 지우기 42501 · AI 계정 원천 고치기 0줄.
  - 대표 · 직원 계정 로그인 검증은 자격증명이 없어 못 함(직원 0행 · 403은 PGlite + staging SQL 시험으로).

- 2026-10-25 16:00 KST — 2단계 구현 · 검사 끝(브랜치 feat/investment-0094).
  - check:investment 42 · check:investment-ai-cap · check-investment-db 0095(PGlite) · check:ai-schemas 13 · check:mobile 새 화면.
  - staging 시험 `0095-0095 DRYRUN PASS (1 files · tests 1/1 · 0095)`(되돌림).
  - 8.3 예시 $201.14 · $114.13 · $91.30 · WATCH · 원문 9 예시 76.75 — 검사로 고정.

### 2단계 DB 변경 목록(0095_investment_engine) — 새 것만
- 새 칸: investment_settings(w_market_* 5 · w_leader_* 5 · w_opp_* 4 · ai_daily_calls · ai_monthly_usd — 기본값 · 합 100 제약) · securities.market_id
- 표: future_markets(시드 5) · market_research_sources(16) · market_forecasts(24) · market_value_chains(24) · investment_scores(시드 25) ·
  investment_manager_philosophy(20) · investment_theses · investment_thesis_evidence · investment_scenarios · investment_valuations ·
  investment_recommendations · investment_alerts · investment_briefs · investment_ai_reservations
- 함수: inv_analysis_reader · investment_recommendation_guard(트리거) · investment_append_only(트리거) · investment_ai_reserve · investment_ai_finish
- 줄: feature_switches (null, 'investment_ai', true, 'chairman')

## 다음 할 일

2단계 배포(merge → master 검사 → staging push → 직전 코드 호환 → 릴리스 → health → 배포 뒤 검증 — 운영 cron 1회로 수집 + AI 분석).
