# 2026-10-20 메모리 엔진(기억 엔진) 0088 — 정한 것 (release/2026-10-20 · PHASE D)

처음 결정 · 설계는 `docs/decisions/2026-10-19-memory-engine.md`(그때 번호 0086 — 기록으로 그대로 둠). 여기는 이번 블록에서 바꾼 것만.

- **번호 0086 → 0088.** 이 블록의 번호표(0086 직원 홈 · 0087 전자결재 · 0088 메모리 엔진 · 0089 재무 보강)대로. `git mv`로 이름만 바꾸고 본문의 «0086» 표기(주석 · 감사 문구 · 스위치 기본 줄 이유)를 0088로. 시험용 uuid 꼬리 `0086a1…`도 `0088a1…`로(같은 트랜잭션에서 도는 0086 홈 staging 시험과 겹치지 않게).
- **합치기:** `feat/memory-engine`(bba4f62)를 `merge --no-ff`로. 충돌은 양쪽 다 살림 — 스위치 24개(home_widgets 뒤에 memory_engine) · FEATURE_NAV 순서 `nav_process_charts · nav_eapproval · nav_home · nav_memory` · LATEST_MIGRATION은 0089 그대로 · DEFERRED 두 절. staging 시험 파일은 add/add 충돌이라 홈 것을 0086에 두고 기억 엔진 것을 `0088_staging_test.sql`로(합치는 커밋 안에서).
- **스위치** `memory_engine` 기본 «대표만» 확인(0088 기본 줄 · features.ts · check:features).
- **1단계 범위:** 저장(빠른 기록 · 원본 보존 · 큐) · 검색(전문 + ilike) · 화면(/memory · /memory/review · /memory/<id> · 연결 칸)이 다 있어 새로 만든 것 없음. 2단계 이후는 DEFERRED.md «메모리 엔진 2단계 이후 — …» 항목별 한 줄.
- **외부 전송:** 기억 코드(src/lib/memory · components/memory · actions/memory · 화면 · 저장소 · 어시스턴트 도구)에 fetch · 외부 URL 없음(grep 0줄). AI는 `MEMORY_AI_PER_DAY` 기본 0이면 부르지 않고 규칙 엔진만(actions/memory.ts aiAllowed).
- **staging 미리 돌려 보기:** `build-staging-dryrun.mjs`는 범위 안 번호를 다 넣는다 — staging에 0087이 이미 있어 그대로면 0087을 다시 돈다. 그래서 `--skip=0087[,…]` 손잡이를 더했다(되돌리기 쉬움 · 기존 사용법 그대로).
- **검사 고침 둘(동작은 그대로):** check:memory Case H «미래 날짜 범위»가 UTC 15~24시(서울은 이미 다음 날)에 실패 → 하루 뒤 대신 이틀 뒤로. check:boundaries가 프로젝트 화면을 그릴 때 새 «관련 기억» 칸(server-only)을 불러 멈춤 → 다른 세션 칸처럼 비움(로그인 안 한 상태면 원래 아무것도 안 그림).
- **반영 순서:** staging에는 0084 · 0085 · 0087이 있다. 0086 · 0088은 순서 밖이라 `--include-all` 필요(홈 위젯 결정 문서와 같음).
