"""설정값. 환경변수로 덮어쓸 수 있음."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # macro/engine
REPO_ROOT = ROOT.parent.parent                          # chairman-os
DATA_DIR = ROOT / "data"
REPORTS_DIR = REPO_ROOT / "macro" / "reports"           # 아카이브(연/월 폴더)
PUBLIC_DIR = REPO_ROOT / "public" / "macro"             # Next.js가 서빙: /macro/latest.html

# Anthropic API — 모델/도구 버전은 platform.claude.com 문서 기준(2026-10 확인)
# 2026-10-14 대표 결정: 기본 claude-sonnet-5-5(비용) — Opus는 BRIEFING_MODEL=claude-opus-5-5.
# 도구는 동적 거르기 판(_20260209 — Sonnet 5.5 · Opus 5.5가 받는 최신). 옛 모델이면 web_search_20250305 · web_fetch_20250910.
MODEL = os.getenv("BRIEFING_MODEL") or "claude-sonnet-5-5"
WEB_SEARCH_TOOL = os.getenv("BRIEFING_WEB_SEARCH_TOOL") or "web_search_20260209"
WEB_FETCH_TOOL = os.getenv("BRIEFING_WEB_FETCH_TOOL") or "web_fetch_20260209"
MAX_SEARCHES = int(os.getenv("BRIEFING_MAX_SEARCHES") or "15")   # 빈 Actions 변수 = 기본값
MAX_FETCHES = int(os.getenv("BRIEFING_MAX_FETCHES") or "12")
MAX_TOKENS = int(os.getenv("BRIEFING_MAX_TOKENS") or "16000")
# 한 페이지에서 읽는 글 천장(토큰). 비우면 천장 없음(채팅 리포트와 같은 깊이). 비용 줄이기: 20000 (docs/decisions/2026-10-14-price-report.md).
FETCH_MAX_TOKENS = int(os.getenv("BRIEFING_FETCH_MAX_TOKENS") or "0")

TIMEZONE = "Asia/Seoul"
YEAR = 2026                    # 차트 시작 연도 (1월~현재)
NAPHTHA_BBL_PER_TON = 8.9      # 오피넷 나프타 $/bbl → $/톤 환산 관행
CRACK_SIGNAL = 10.0            # 나프타−Brent(+10 이상 = 유화사 구매 복귀 신호)
TABLE_DYNAMIC_FROM = "2026-10-07"   # ③표에 자동 행으로 들어가는 시작일
BUSINESS_ID = os.getenv("PRICE_REPORT_BUSINESS") or "biz_dy"   # DY(대양) 구매팀

# 가격 1차 출처 (매 회차 web_fetch로 직접 확인)
SOURCES = {
    "opinet_crude": "https://www.opinet.co.kr/glopcoilSelect.do",     # Dubai/Brent/WTI 정산 (두 번째 표 = $/bbl)
    "opinet_products": "https://www.opinet.co.kr/glopopdSelect.do",   # 나프타 (두 번째 표 = $/bbl)
    "te_brent": "https://tradingeconomics.com/commodity/brent-crude-oil",
    "te_wti": "https://tradingeconomics.com/commodity/crude-oil",
    "te_naphtha": "https://tradingeconomics.com/commodity/naphtha",
}

# 수집 출처 끄기(약관 · 차단 대응 — docs/decisions/2026-10-14-price-report.md): BRIEFING_SOURCES_OFF="te" 이면 TradingEconomics 페이지를 열지 않는다
# (장중 CFD · 나프타 CFD는 «미확인»으로 남고, 오피넷 정산은 그대로). 대안: 구매팀이 값을 손으로 넣는 칸(미룬 일).
_OFF = {x.strip().lower() for x in os.getenv("BRIEFING_SOURCES_OFF", "").split(",") if x.strip()}
SOURCES = {k: v for k, v in SOURCES.items() if k.split("_")[0] not in _OFF}
