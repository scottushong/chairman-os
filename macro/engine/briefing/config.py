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
MAX_SEARCHES = int(os.getenv("BRIEFING_MAX_SEARCHES", "15"))
MAX_FETCHES = int(os.getenv("BRIEFING_MAX_FETCHES", "12"))
MAX_TOKENS = int(os.getenv("BRIEFING_MAX_TOKENS", "16000"))

TIMEZONE = "Asia/Seoul"
YEAR = 2026                    # 차트 시작 연도 (1월~현재)
NAPHTHA_BBL_PER_TON = 8.9      # 오피넷 나프타 $/bbl → $/톤 환산 관행
CRACK_SIGNAL = 10.0            # 나프타−Brent(+10 이상 = 유화사 구매 복귀 신호)
TABLE_DYNAMIC_FROM = "2026-10-07"   # ③표에 자동 행으로 들어가는 시작일
BUSINESS_ID = os.getenv("PRICE_REPORT_BUSINESS", "biz_dy")   # DY(대양) 구매팀

# 가격 1차 출처 (매 회차 web_fetch로 직접 확인)
SOURCES = {
    "opinet_crude": "https://www.opinet.co.kr/glopcoilSelect.do",     # Dubai/Brent/WTI 정산 (두 번째 표 = $/bbl)
    "opinet_products": "https://www.opinet.co.kr/glopopdSelect.do",   # 나프타 (두 번째 표 = $/bbl)
    "te_brent": "https://tradingeconomics.com/commodity/brent-crude-oil",
    "te_wti": "https://tradingeconomics.com/commodity/crude-oil",
    "te_naphtha": "https://tradingeconomics.com/commodity/naphtha",
}
