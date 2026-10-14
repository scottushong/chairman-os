# 가격 리포트 엔진 v2 — 채팅 리포트와 같은 화면

채팅에서 "최신 사건 뉴스 가격"으로 받던 price_report(HTML)를 하루 2번 자동으로 만든다.

## 화면 구성 (채팅 리포트와 동일)
1. 헤더(h1·sub) — 날짜·시간대 + 핵심 사건
2. 카드 5개 — Brent / WTI (정산 → 장중) · 나프타 CFD · 오피넷 나프타($/bbl ≈ $/톤) · 나프타−Brent 크랙
3. ① 원유 1월~현재 (Brent·WTI, $100 점선)
4. ② 나프타 1월~현재 (CFD · MOPJ · 오피넷×8.9)
5. ③ 3층 비교표 (CFD · 오피넷 · MOPJ · 오피넷−CFD · 나프타−Brent)
6. 사건 메모 (최신이 맨 위에 쌓임)

## 바뀐 파일 (기존 macro/engine 위에 덮어쓰기)
| 파일 | 역할 |
|---|---|
| briefing/config.py | 모델·도구 버전, 오피넷/TE 주소, 8.9 환산, 크랙 신호선(+10) |
| briefing/collect.py | Claude API: 오피넷·TE 페이지 web_fetch + 사건 web_search → JSON. 단위 오류 검증 |
| briefing/store.py | 가격(정산/장중 구분) upsert, 메모 누적 |
| briefing/render.py | HTML 생성 (차트 x축은 데이터에 맞춰 자동 확장) |
| run.py | 수집 → 저장 → 렌더 → 아카이브. 수집 실패해도 직전 데이터로 생성 |
| seed_v2.py + data/seed_v2.json | 1월~10/14 누적 데이터(가격 87점, ③표 고정행, 사건 메모) 1회 이관 |
| briefing/archive.py | 그대로(연/월 아카이브 + public/macro/latest.html + index.html) |

## 설치 순서
```bash
cd C:\Users\Edison Hong\projects\chairman-os\macro\engine
pip install -r requirements.txt
python seed_v2.py                                   # 1회만: 지금까지 데이터 이관
python run.py --dry-run sample_briefing.json --slot PM   # API 없이 화면 확인
```
→ `public/macro/latest.html`을 브라우저로 열어 채팅 리포트와 같은지 확인.

실제 수집 테스트(키 필요):
```bash
set ANTHROPIC_API_KEY=sk-ant-...        (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-...")
python run.py --slot AM
```
채팅용 요약은 `data/chat_summary.md`에 같이 저장됨.

## 자동 실행
`.github/workflows/macro-briefing.yml` (08:00 / 18:00 KST). GitHub → Settings → Secrets → `ANTHROPIC_API_KEY` 등록.
Actions 탭 → "Macro briefing" → Run workflow 로 수동 실행 가능.

## Chairman OS 첫 화면에 붙이기 (Next.js)
```tsx
// src/app/page.tsx (또는 대시보드 첫 화면 컴포넌트)
<iframe src="/macro/latest.html" style={{ width: "100%", height: "100vh", border: 0 }} />
```
아카이브 목록: `/macro/index.html`

## 비용·주의
- 1회 실행 = web_fetch 최대 12회 + web_search 최대 15회 + 모델 토큰. 하루 2회.
- 모델 기본값 `claude-opus-5-5`. 비용을 줄이려면 환경변수 `BRIEFING_MODEL=claude-sonnet-5-5`.
- 도구 버전: web_search_20260318, web_fetch_20260318 (platform.claude.com 문서 2026-10 기준). 오류 나면 환경변수로 `web_search_20250305`, `web_fetch_20250910`으로 낮출 수 있음.
- 오피넷 페이지 구조가 바뀌면 collect.py의 validate()가 범위 오류를 잡아 그 회차는 직전 데이터로 표시됨(메모 맨 위에 "이번 회차 미확인").
- ③표 고정행(1/2, 2월말, 3월말, 5월, 8월, 9월)은 data/static.json에서 직접 수정 가능.
