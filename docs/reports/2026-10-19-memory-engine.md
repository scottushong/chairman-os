# 2026-10-19 기억 엔진 Phase 1 — 보고

브랜치 `feat/memory-engine` · 워크트리 `C:\Users\Edison Hong\projects\chairman-os-memory` · 마이그레이션 `0086_memory_engine` · push 없음 · staging 쓰기 없음(되돌리는 시험만).
지시문 `docs/specs/2026-10-19-memory-engine.txt` · 결정 `docs/decisions/2026-10-19-memory-engine.md` · 반영 `docs/onboarding/release-memory-engine.md` · 미룸 `DEFERRED.md` 끝.

## 앞 블록
| 블록 | 결과 |
|---|---|
| ① 가격 리포트 0084 정리 | 끝 — 0082 → 0084 · 검사 · staging 시험 PASS · 로컬 master 합침(push 없음) |
| ② 청사진 보강 0085 | **막힘** — 지시문 없음. 0085 비워 둠 |

## Phase 1 항목
| 항목 | 상태 | 비고 |
|---|---|---|
| Global Quick Capture | 작동 | 모든 화면 연필 단추 · Alt+M · 자동 보관 · 휴대폰 아래 판 · 대표에게만 |
| Text Note Saving | 작동 | 원본 즉시 저장 · 같은 열쇠 한 줄 · 원본 고치기 거부(트리거) |
| Universal Capture DB | 작동 | 0086 표 13 · staging(0084 위) 되돌리는 시험 PASS |
| AI Processing Pipeline | 작동 | 큐 · 재시도 · 3회 실패 뒤 규칙. 기본은 규칙(MEMORY_AI_PER_DAY=0), 켜면 Sonnet — 진짜 1회 PASS |
| Entity Extraction | 작동 | 회사 · 프로젝트 · 사람 · 바깥 인물 · 별칭 · 한/영 직함 |
| Existing DB Linking | 작동 | 회사 · 프로젝트 정식 이름만 자동 확정, 사람은 늘 검토 |
| AI Summary | 일부 | AI를 켜야 AI 요약. 기본은 «규칙 요약(첫 문장)»으로 표시 |
| Decision / Commitment / Task Extraction | 작동 | 내가/남이 약속 구분 · 기한은 원문 말 + 기록 시각으로만 |
| Memory Timeline | 작동 | /memory |
| Memory Search | 일부 | 전문 검색 + ilike만. 벡터는 자리만(업체 결정 대기) |
| Review Queue | 작동 | 확인 · 고치기 · 거절 · 기존 대상에 잇기 · 새 인물/회사 · 이력 |
| Source Reference | 작동 | 정보마다 원문 인용 · 기록 링크 · 앞 기록 링크 |
| 기본 Ask Chairman AI | 일부 | 어시스턴트 «기억 검색» 도구 — 도구 시험 PASS, 진짜 대화(모델)로는 아직 안 돌림 |
| 기존 Dashboard 연결 | 작동 | 주의 «기억에서 나온 주의» · 회사/프로젝트 «관련 기억» · 아침 루틴 칸 |
| Phase 2 · 3 · 4 | 안 됨 | 표 · 어댑터 인터페이스만(memory_segments · memory_meetings · STT · Embedding · ExternalSource) |

## 시험
`check:memory` 16묶음(Case A~H · 권한 7역할 + anon · 리뷰 고침 · 순수 · 도구 · dummy) · `check:migrations` 82개 · `check:features` · `check:ai-schemas` 10개 · `check:db-safety` · `check:price-report` · `typecheck` · `lint` · `next build --webpack` · dummy 화면(`.screenshots/memory/chair-*.png` 10장, 직원 점검 PASS) · staging 되돌리는 시험(0086 단독, staging 0084 위) · 진짜 AI 1회($0.0173). 독립 리뷰 1회 — Important 3개 고침(tasks 직접 넣기 · 밀린 초안의 검토 · 처리 쪽의 사람/바깥 인물 확정), Minor는 DEFERRED.

## 필요한 env
`MEMORY_AI_PER_DAY`(기본 0 = AI 안 씀) · `MEMORY_AI_MODEL`(선택, 기본 claude-sonnet-5-5) · `ANTHROPIC_API_KEY`(있음). 테스트용 `MEMORY_AI_MOCK=1|fail`(운영에 넣지 않는다).

## 대표가 정할 것
1. STT 업체(음성 전사) — 정해지기 전까지 음성은 원본만 보관.
2. 임베딩 업체(벡터 검색) — 정해지면 pgvector 마이그레이션 + 어댑터.
3. 월 AI 비용 한도 → `MEMORY_AI_PER_DAY` 값(메모 1건 약 $0.01~0.03).
4. 0085 자리(청사진 보강 지시문 · 또는 기억 엔진을 0085로).
