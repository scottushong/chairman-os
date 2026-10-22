# 가격 리포트 엔진 v2 — DY 구매팀 (Chairman OS 방식)

채팅에서 "최신 사건 뉴스 가격"으로 받던 price_report(HTML)를 **화면 «지금 업데이트» · Actions «Run workflow»**로 만든다(자동 08 · 18시는 2026-10-20 뺌 — 비용 확인 뒤 되살림).
화면: `/purchasing/biz_dy/price-report` (구매 메뉴 «가격 리포트»). 대표 홈에는 넣지 않는다.

## 화면 구성 (채팅 리포트와 같다)
1. 헤더(h1 · sub) — 날짜 · 회차 + 핵심 사건
2. 카드 5개 — Brent / WTI (정산 → 장중) · 나프타 CFD · 오피넷 나프타($/bbl ≈ $/톤) · 나프타−Brent 크랙
3. ① 원유 1월~현재 · ② 나프타 1월~현재 — **SVG**(예전 canvas와 같은 좌표 · 색 · 글꼴 — 스크립트 없이 그려져 앱이 스크립트를 막은 sandbox로 보인다. 기준 화면과 픽셀 차 0.4%, 차트 안 글자 테두리뿐)
4. ③ 3층 비교표 · 5. 사건 메모(최신이 위)

## 저장 — Supabase(0084)만. 저장소에 커밋하지 않는다
| 표 | 내용 |
|---|---|
| purchase_price_points | 지점별 가격(정산 · 장중 · 월평균) — 정산은 장중이 덮지 않음 · 범위 밖(884 같은 원화 값) 거부 |
| purchase_price_events | 사건 · 뉴스(같은 제목 · 링크 한 번 · «새로») · 회차 메모 |
| purchase_price_reports | 리포트 html · 채팅 요약 · 수치(요약 카드) · 정상/미확인 |
| purchase_price_runs | 실행 기록(자동 · 수동, 대기 → 수집 중 → 완료/실패) |

엔진은 **AI Agent 계정**(야간 브리핑과 같은 로그인, service_role 아님)으로 0084 RPC만 부른다(`briefing/supa.py`).

## 파일
| 파일 | 역할 |
|---|---|
| briefing/config.py | 모델(BRIEFING_MODEL, 기본 claude-sonnet-5-5) · 도구(web_search/web_fetch _20260209) · 출처 · 8.9 환산 · 크랙 +10 · 출처 끄기(BRIEFING_SOURCES_OFF=te) · 페이지 글 천장(BRIEFING_FETCH_MAX_TOKENS) |
| briefing/collect.py | Claude API: low = ① 오피넷 · TE 페이지 web_fetch → ② 사건 web_search + 글(두 단계) · normal = 한 번에. 캐싱 · 단위 오류 검증 · 사용량(usd) |
| briefing/estimate.py | 가격표(2026-10-20) · 상한값으로 1회 최악 · 보통 비용 추정(`python -m briefing.estimate`) |
| briefing/store.py | 로컬 작업 파일(엔진 한 번 도는 동안) — upsert · 메모 누적 |
| briefing/render.py | HTML(SVG 차트 · 메모 정화: <b> · <br>만) |
| briefing/supa.py | Supabase: AI Agent 로그인 · 앞 데이터 읽기(pull) · 결과 쓰기(push) |
| run.py | `--supabase [--run-id] [--slot]`(Actions) · `--dry-run JSON`(API · DB 없이) |
| data/seed_v2.json | 1월~10/14 누적(가격 87 · ③표 고정행 6 · 메모 1) — 0084가 한 번 적재 · ③표 고정행은 이 파일에서 읽는다 |
| tools/seed_sql.py | seed_v2.json → 0084 적재 SQL |
| tests/test_supa.py | 가짜 PostgREST로 supa.py 시험(check:price-report가 부른다) |
| tests/test_cost.py | 가짜 Anthropic 클라이언트로 low 요청 수 · 천장 · 캐싱 · 최악 < $1 시험(check:price-report가 부른다) |

## 로컬에서 화면만 보기(API · DB 없음)
```bash
python -m pip install -r macro/engine/requirements.txt
```
```bash
python macro/engine/seed_v2.py
```
```bash
python macro/engine/run.py --dry-run macro/engine/sample_briefing.json --slot PM
```
→ `public/macro/latest.html`(gitignore — 로컬 확인용).

## 자동 실행
`.github/workflows/macro-briefing.yml` — (2026-10-20 cron 뺌 — 손으로만) workflow_dispatch(preset low/normal · run_id · slot=manual — 화면 버튼은 run_id · slot만, preset은 low) · concurrency 한 줄 · 커밋 없음.
Secrets 이름: ANTHROPIC_API_KEY · SUPABASE_URL · SUPABASE_ANON_KEY · AI_AGENT_EMAIL · AI_AGENT_PASSWORD. 절차: `docs/onboarding/release-price-report.md`.

## 비용(2026-10-14 진짜 1회 측정 — Sonnet 5.5)
입력 105만 토큰(웹 페이지 · 검색 결과) · 출력 1.3만 · 검색 12 · 페이지 6 → **약 $2.36/회**. Opus 5.5면 약 $4.60/회.
2026-10-20: 기본 low 프리셋(두 단계 · 검색 4 · 페이지 천장 6,000 · 캐싱) — 추정 보통 $0.26 · 최악 $0.94/회(`python -m briefing.estimate`, 시험 `tests/test_cost.py`). 예전 방식은 BRIEFING_PRESET=normal.
