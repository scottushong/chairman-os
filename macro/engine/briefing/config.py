"""설정값. 환경변수로 덮어쓸 수 있음."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # macro/engine
REPO_ROOT = ROOT.parent.parent                          # chairman-os
DATA_DIR = ROOT / "data"
REPORTS_DIR = REPO_ROOT / "macro" / "reports"           # 아카이브(연/월 폴더)
PUBLIC_DIR = REPO_ROOT / "public" / "macro"             # Next.js가 서빙: /macro/latest.html

# Anthropic API — 모델/도구 버전 · 가격은 platform.claude.com 문서 기준(2026-10-20 확인 — briefing/estimate.py)
# 2026-10-14 대표 결정: 기본 claude-sonnet-5-5(비용) — Opus는 BRIEFING_MODEL=claude-opus-5-5.
# 도구는 동적 거르기 판(_20260209 — Sonnet 5.5 · Opus 5.5가 받는 최신). 옛 모델이면 web_search_20250305 · web_fetch_20250910.
#
# 2026-10-20 비용 줄이기(docs/decisions/2026-10-20-price-report-cost.md): 프리셋 BRIEFING_PRESET = low(기본) | normal.
#   low    — 두 단계로 나눠 부른다: ① 가격 페이지만 web_fetch(페이지 글 천장 6,000토큰 · 출처 수만큼) → ② 사건 web_search 4번 + 리포트 글.
#            ①의 페이지 본문이 ②의 대화에 실려 매 차례 다시 읽히지 않는다. 프롬프트 캐싱 켬 · 직전 리포트는 1,200자만.
#   normal — 예전 한 번에 다 하는 방식(검색 15 · 페이지 12 · 천장 없음) + 프롬프트 캐싱. 비교 · 깊게 볼 때만.
# Actions Variables(BRIEFING_MODEL · BRIEFING_MAX_SEARCHES · BRIEFING_MAX_FETCHES · BRIEFING_FETCH_MAX_TOKENS · BRIEFING_MAX_TOKENS)는
# 값이 있을 때만 프리셋 위에 덮는다(빈 변수 = 프리셋 값).
WEB_SEARCH_TOOL = os.getenv("BRIEFING_WEB_SEARCH_TOOL") or "web_search_20260209"
WEB_FETCH_TOOL = os.getenv("BRIEFING_WEB_FETCH_TOOL") or "web_fetch_20260209"

PRESETS = {
    "low": {
        "model": "claude-sonnet-5-5",
        "staged": True,
        "max_searches": 4,
        "max_fetches": 0,            # 0 = 가격 출처 수(SOURCES — te를 끄면 2)
        "fetch_max_tokens": 6000,
        "max_tokens_prices": 3000,   # ① 가격 JSON(생각 포함)
        "max_tokens": 7000,          # ② 리포트 JSON(메모 · 채팅 요약 · 생각 포함)
        "max_requests": 2,           # 단계마다 요청 수(첫 요청 + pause_turn 이어받기 1번)
        "effort_prices": "low",
        "effort": "medium",
        "prev_chars": 1200,
        "cache": True,
    },
    "normal": {
        "model": "claude-sonnet-5-5",
        "staged": False,
        "max_searches": 15,
        "max_fetches": 12,
        "fetch_max_tokens": 0,       # 0 = 천장 없음(채팅 리포트와 같은 깊이)
        "max_tokens_prices": 0,
        "max_tokens": 16000,
        "max_requests": 8,
        "effort_prices": None,
        "effort": None,              # 모델 기본
        "prev_chars": 4000,
        "cache": True,
    },
}


def load(env=None) -> dict:
    """프리셋 + 환경변수 덮기. 시험은 env 사전을 넘긴다."""
    env = os.environ if env is None else env
    name = (env.get("BRIEFING_PRESET") or "low").strip().lower()
    if name not in PRESETS:
        raise ValueError(f"BRIEFING_PRESET은 low 또는 normal: {name!r}")
    s = dict(PRESETS[name], preset=name)
    for key, var in (("max_searches", "BRIEFING_MAX_SEARCHES"), ("max_fetches", "BRIEFING_MAX_FETCHES"),
                     ("fetch_max_tokens", "BRIEFING_FETCH_MAX_TOKENS"), ("max_tokens", "BRIEFING_MAX_TOKENS")):
        if (env.get(var) or "").strip():
            s[key] = int(env[var])
    if (env.get("BRIEFING_MODEL") or "").strip():
        s["model"] = env["BRIEFING_MODEL"].strip()
    return s


SETTINGS = load()
MODEL = SETTINGS["model"]

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
