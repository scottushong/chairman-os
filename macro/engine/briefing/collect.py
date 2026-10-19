"""Claude API(web_fetch + web_search)로 최신 가격·사건을 수집해 JSON으로 반환.

채팅에서 "최신 사건 뉴스 가격"을 만들던 절차를 그대로 옮긴 것:
  1) 오피넷 원유·제품 페이지 직접 확인 (정산가, 나프타 $/bbl)
  2) TradingEconomics Brent/WTI/나프타 (장중 CFD, 나프타 CFD)
  3) 웹검색으로 사건 — 날짜 확인 후 채택

프리셋(config.load — docs/decisions/2026-10-20-price-report-cost.md):
  low(기본)  두 단계 — ① 가격 페이지 web_fetch만(짧은 지시 · 페이지 글 천장) → ② ①의 숫자(JSON 몇 줄)만 받아 사건 web_search + 리포트 글.
             페이지 본문이 ② 대화에 실리지 않아 매 차례 다시 읽히지 않는다.
  normal     예전 한 번에 다 하는 방식.
둘 다 프롬프트 캐싱(cache_control) — 서버 도구가 한 요청 안에서 여러 번 돌 때 앞부분을 캐시로 읽는다.
"""
import json
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from . import config, estimate

SYSTEM_PROMPT = """너는 대양산업(DY Industrial, 핫멜트 접착제: EVA·SIS/SBS·PA) 홍석현 대표의 에너지·지정학 가격 리포트 에이전트다.
원료: EVA, DCPD(석유수지), Group II 500N. 우선순위: 나프타 > 원유.

반드시 지킬 검증 규칙:
1. 정산(settle)과 장중(intraday)을 구분한다. 오피넷 원유 페이지의 두 번째 표($/bbl)가 정산 확정값이다.
   TradingEconomics 값은 CFD 장중값이다(종가 아님).
2. 오피넷 제품 페이지의 나프타 두 번째 표 값이 $/bbl이다. 첫 번째 표(원화 환산) 값을 쓰지 마라.
3. 모든 사건은 기사 날짜를 확인한다. 과거 기사가 검색에 섞이면 버린다.
4. 확인 안 된 주장은 "주장", "(독립 확인 없음)"으로 표기한다. 숫자를 지어내지 않는다. 못 찾으면 missing에 넣는다.
5. CFD·MOPJ·오피넷을 섞지 않는다.
6. 이전 보고 수치가 틀렸으면 note_html 안에 <b>정정</b>으로 명시한다.
7. 정치 진영을 지지·비난하지 않고 "~라고 했다/본다"로 전달한다.

필수 확인 범위: 미·이란 전쟁/협상, 호르무즈(유조선 공격·통과량), 후티·사우디(석유시설·공항), 미국의 개입 결정,
러시아 디젤·우크라이나, IEA/G7 비축유, OPEC, 중국 석유제품 수출, 한국 정부 나프타 대책, 아람코·Vitol·Kpler 코멘트.

대표 관점(분석에 반영): 중동 반복 공격과 이권자들의 긴장 누적 → 11월 중간선거까지 가격 점착, 중국 재고 재축적,
국제가 → 한국 → 지역 → 산업까지 1~3개월 시차, 원유와 제품(나프타·디젤) 분리, 나프타−Brent 크랙 +10은 유화사 구매 복귀 신호."""

# low ① — 가격 페이지 읽기 전용(사건 · 관점 규칙은 필요 없다)
PRICE_SYSTEM = """너는 가격 페이지에서 숫자만 옮기는 도구다. 숫자를 지어내지 않는다. 못 읽은 값은 missing에 적는다.
1. 오피넷 원유 페이지의 두 번째 표($/bbl)가 정산(settle) 확정값이다.
2. 오피넷 제품 페이지의 나프타는 두 번째 표($/bbl)만 쓴다. 첫 번째 표(원화 환산)는 쓰지 마라.
3. TradingEconomics 값은 CFD 장중값이다(종가 아님). 나프타 CFD는 $/톤.
4. 페이지는 web_fetch로 한 번씩만 연다. 필요한 표만 남기도록 걸러 읽어라."""

SCHEMA = """다음 JSON 하나만 출력(설명 텍스트 금지):
{
  "stamp": "YYYY-MM-DD AM|PM",
  "headline": "h1 뒤에 붙일 핵심 4~5개를 ' · '로 이은 한 줄 (예: Brent $106 공방 · 아람코 다란 \\"제한적 화재\\" · 내일 IEA 이사회)",
  "sub": "출처 교차확인 목록 · 장중/정산 구분 · 미게시 항목",
  "settles": [{"series":"brent|wti|dubai","date":"YYYY-MM-DD","value":number,"source":"오피넷"}],
  "intraday": {"brent":{"date":"YYYY-MM-DD","value":number,"source":"TradingEconomics CFD"}|null,
               "wti":{"date":"YYYY-MM-DD","value":number,"source":"TradingEconomics CFD"}|null},
  "naphtha_cfd": [{"date":"YYYY-MM-DD","value":number}],
  "opinet_naphtha_bbl": [{"date":"YYYY-MM-DD","value":number}],
  "mopj_monthly": [{"month":"YYYY-MM","value":number,"is_forecast":bool,"source":str}],
  "events": [{"date":"YYYY-MM-DD","title":"사건 한 줄(기관 · 주체 포함)","url":"기사 원문 주소","source":"기관명"}],
  "note_html": "<b>M/D 아침|저녁 신규</b> — ① <b>제목</b>: 내용 ② <b>제목</b>: 내용 … <b>시사점</b>: 대표 관점 1~2문장",
  "chat_summary": "채팅용 요약(한국어 마크다운): 한 줄 결론 → 가격표 → 사건 → 대표님 관점에서 → 볼 것 → Sources",
  "missing": ["찾지 못한 항목"]
}
note_html 규칙: 허용 태그는 <b>, <br> 뿐(속성 없이). 번호는 ①②③…, 각 항목 1~3문장, 출처 기관명 괄호 표기.
events 규칙: note_html에 쓴 새 사건마다 한 줄. url은 실제로 연 기사 주소만(없으면 빈 글). 같은 사건을 여러 줄로 쓰지 않는다."""

PRICE_SCHEMA = """다음 JSON 하나만 출력(설명 텍스트 금지):
{"settles":[{"series":"brent|wti|dubai","date":"YYYY-MM-DD","value":number,"source":"오피넷"}],
 "opinet_naphtha_bbl":[{"date":"YYYY-MM-DD","value":number}],
 "intraday":{"brent":{"date":"YYYY-MM-DD","value":number,"source":"TradingEconomics CFD"}|null,"wti":{…}|null},
 "naphtha_cfd":[{"date":"YYYY-MM-DD","value":number}],
 "missing":["못 읽은 값"]}"""

NEWS_SCHEMA = """다음 JSON 하나만 출력(설명 텍스트 금지 · 가격 숫자는 다시 쓰지 않는다 — 위 «확인된 가격»을 그대로 인용만):
{
  "stamp": "YYYY-MM-DD AM|PM",
  "headline": "핵심 4~5개를 ' · '로 이은 한 줄",
  "sub": "출처 교차확인 목록 · 장중/정산 구분 · 미게시 항목",
  "mopj_monthly": [{"month":"YYYY-MM","value":number,"is_forecast":bool,"source":str}],
  "events": [{"date":"YYYY-MM-DD","title":"사건 한 줄(기관 · 주체 포함)","url":"기사 원문 주소","source":"기관명"}],
  "note_html": "<b>M/D 아침|저녁 신규</b> — ① <b>제목</b>: 내용 ② … <b>시사점</b>: 대표 관점 1~2문장",
  "chat_summary": "채팅용 요약(한국어 마크다운, 20줄 안): 한 줄 결론 → 가격표 → 사건 → 대표님 관점에서 → 볼 것 → Sources",
  "missing": ["찾지 못한 항목"]
}
note_html 규칙: 허용 태그는 <b>, <br> 뿐(속성 없이). 번호는 ①②③…, 각 항목 1~3문장, 출처 기관명 괄호 표기.
events 규칙: note_html에 쓴 새 사건마다 한 줄. url은 검색 결과에서 본 기사 주소만(없으면 빈 글). 같은 사건을 여러 줄로 쓰지 않는다."""

PRICE_KEYS = ("settles", "intraday", "naphtha_cfd", "opinet_naphtha_bbl")


def _now():
    return datetime.now(ZoneInfo(config.TIMEZONE))


def _prev(last: dict | None, chars: int) -> str:
    if not last:
        return "없음"
    return json.dumps({k: last.get(k) for k in ("stamp", "headline", "note_html")}, ensure_ascii=False)[:chars]


def build_user_prompt(slot: str, last: dict | None, prev_chars: int = 4000) -> str:
    """normal — 예전 한 번에 다 하는 지시."""
    now = _now()
    src = "\n".join(f"- {k}: {v}" for k, v in config.SOURCES.items())
    return (f"현재 시각: {now:%Y-%m-%d %H:%M} KST ({slot}).\n"
            f"1) 아래 가격 페이지를 web_fetch로 직접 열어 최신 값을 읽어라:\n{src}\n"
            "   - 오피넷 원유: 표에 있는 모든 날짜의 Dubai/Brent/WTI 정산을 settles에 넣어라.\n"
            "   - 오피넷 제품: 표에 있는 모든 날짜의 나프타 $/bbl을 opinet_naphtha_bbl에 넣어라.\n"
            "   - TE 나프타: 최신 날짜 값을 naphtha_cfd에. TE Brent/WTI: 오늘 장중값을 intraday에.\n"
            "2) 직전 리포트 이후 새 사건을 웹검색하라(날짜 확인 필수).\n"
            "3) MOPJ 월평균 새 값이 공개됐으면 mopj_monthly에 넣어라(없으면 빈 배열).\n\n"
            f"직전 리포트(중복·정정 확인용):\n{_prev(last, prev_chars)}\n\n{SCHEMA}")


def build_price_prompt(slot: str) -> str:
    """low ① — 가격 페이지만."""
    now = _now()
    src = "\n".join(f"- {k}: {v}" for k, v in config.SOURCES.items())
    te = "" if any(k.startswith("te_") for k in config.SOURCES) else "\n(TradingEconomics는 끔 — intraday는 null, naphtha_cfd는 빈 배열.)"
    return (f"현재 시각: {now:%Y-%m-%d %H:%M} KST ({slot}).\n"
            f"아래 페이지를 web_fetch로 한 번씩 열어 값을 옮겨라(검색하지 않는다):\n{src}{te}\n"
            "- 오피넷 원유: 표의 모든 날짜 Dubai/Brent/WTI 정산 → settles.\n"
            "- 오피넷 제품: 표의 모든 날짜 나프타 $/bbl → opinet_naphtha_bbl.\n"
            "- TE 나프타: 최신 날짜 → naphtha_cfd. TE Brent/WTI: 오늘 장중 → intraday.\n\n"
            f"{PRICE_SCHEMA}")


def build_news_prompt(slot: str, last: dict | None, prices: dict, prev_chars: int) -> str:
    """low ② — ①의 숫자만(페이지 본문 없이) + 직전 리포트 조금."""
    now = _now()
    p = json.dumps({k: prices.get(k) for k in PRICE_KEYS}, ensure_ascii=False, separators=(",", ":"))
    return (f"현재 시각: {now:%Y-%m-%d %H:%M} KST ({slot}).\n"
            f"확인된 가격(이번 회차 오피넷 · TE에서 방금 읽은 값 — 다시 열지 않는다):\n{p}\n\n"
            "1) 직전 리포트 이후 새 사건을 웹검색하라(날짜 확인 필수 · 검색은 꼭 필요한 만큼만).\n"
            "2) MOPJ 월평균 새 값이 검색에 보이면 mopj_monthly에(없으면 빈 배열).\n\n"
            f"직전 리포트(중복·정정 확인용 · 앞부분만):\n{_prev(last, prev_chars)}\n\n{NEWS_SCHEMA}")


def _extract_json(text: str) -> dict:
    text = re.sub(r"```(?:json)?", "", text).strip()
    s, e = text.find("{"), text.rfind("}")
    if s == -1 or e == -1:
        raise ValueError("응답에서 JSON을 찾지 못함")
    return json.loads(text[s:e + 1])


def _new_usage(model: str, preset: str) -> dict:
    return {"model": model, "preset": preset, "calls": 0, "input_tokens": 0, "output_tokens": 0, "cache_read": 0, "cache_write": 0,
            "web_search_requests": 0, "web_fetch_requests": 0}


def _stage(client, s: dict, usage: dict, system: str, user: str, tools: list, max_tokens: int, effort: str | None):
    """한 단계 — 첫 요청 + pause_turn 이어받기(합쳐 s['max_requests']번까지). 텍스트 · 멈춘 이유를 돌려준다."""
    messages = [{"role": "user", "content": user}]
    kwargs = {}
    if s.get("cache"):
        kwargs["cache_control"] = {"type": "ephemeral"}   # 앞부분 자동 캐시(서버 도구 차례마다 다시 읽는 몫이 캐시 읽기가 된다)
    if effort:
        kwargs["output_config"] = {"effort": effort}
    resp = None
    for _ in range(max(1, s["max_requests"])):
        # 스트리밍으로 받는다 — 도구를 여러 번 쓰는 긴 차례가 HTTP 시간 제한에 걸리지 않게.
        with client.messages.stream(model=s["model"], max_tokens=max_tokens, system=system, tools=tools, messages=messages, **kwargs) as stream:
            resp = stream.get_final_message()
        usage["calls"] += 1
        u = resp.usage
        usage["input_tokens"] += u.input_tokens or 0
        usage["output_tokens"] += u.output_tokens or 0
        usage["cache_read"] += getattr(u, "cache_read_input_tokens", 0) or 0
        usage["cache_write"] += getattr(u, "cache_creation_input_tokens", 0) or 0
        stu = getattr(u, "server_tool_use", None)
        if stu is not None:
            usage["web_search_requests"] += getattr(stu, "web_search_requests", 0) or 0
            usage["web_fetch_requests"] += getattr(stu, "web_fetch_requests", 0) or 0
        if resp.stop_reason != "pause_turn":
            break
        messages = [*messages, {"role": "assistant", "content": resp.content}]
    if resp.stop_reason == "refusal":
        raise ValueError("모델이 답하지 않음(refusal)")
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    try:
        return _extract_json(text)
    except ValueError as exc:
        # 왜 JSON이 없었는지 실행 기록 오류 한 줄에 남긴다(차례 수 · 멈춘 이유 · 사용량).
        print("사용량(실패):", json.dumps(usage, ensure_ascii=False), file=sys.stderr)
        raise ValueError(f"{exc}(stop_reason={resp.stop_reason}, 차례 {usage['calls']}, 글 {len(text)}자)") from exc


def fetch_tool(s: dict) -> dict:
    n = s["max_fetches"] or len(config.SOURCES)
    return {"type": config.WEB_FETCH_TOOL, "name": "web_fetch", "max_uses": n,
            **({"max_content_tokens": s["fetch_max_tokens"]} if s["fetch_max_tokens"] > 0 else {})}


def search_tool(s: dict) -> dict:
    return {"type": config.WEB_SEARCH_TOOL, "name": "web_search", "max_uses": s["max_searches"]}


def collect(slot: str, last: dict | None = None, client=None, settings: dict | None = None) -> dict:
    s = settings or config.SETTINGS
    if client is None:
        import anthropic
        client = anthropic.Anthropic()  # ANTHROPIC_API_KEY
    usage = _new_usage(s["model"], s["preset"])
    if not s["staged"]:
        data = _stage(client, s, usage, SYSTEM_PROMPT, build_user_prompt(slot, last, s["prev_chars"]),
                      [fetch_tool(s), search_tool(s)], s["max_tokens"], s["effort"])
    else:
        prices = _stage(client, s, usage, PRICE_SYSTEM, build_price_prompt(slot), [fetch_tool(s)], s["max_tokens_prices"], s["effort_prices"])
        validate(prices)   # 단위 혼동이면 ②를 부르지 않는다(돈을 더 쓰지 않음)
        try:
            news = _stage(client, s, usage, SYSTEM_PROMPT, build_news_prompt(slot, last, prices, s["prev_chars"]),
                          [search_tool(s)], s["max_tokens"], s["effort"])
        except Exception as exc:  # ② 실패 — ①의 가격은 살린다(사건만 «미확인»)
            print(f"[사건 단계 실패] {exc}", file=sys.stderr)
            now = _now()
            news = {"stamp": f"{now:%Y-%m-%d} {slot if slot in ('AM', 'PM') else 'PM'}", "headline": (last or {}).get("headline", ""),
                    "sub": "가격만 확인 — 사건 수집 실패", "missing": [f"사건 수집 실패: {str(exc)[:160]}"]}
        data = {**news, **{k: prices.get(k) for k in PRICE_KEYS if k in prices},
                "missing": [*(prices.get("missing") or []), *(news.get("missing") or [])]}
    validate(data)
    usage["usd"] = round(estimate.usage_cost(usage), 4)
    data["_usage"] = usage
    return data


def validate(b: dict):
    """명백한 오류 차단: 단위 혼동(오피넷 원화표), 비정상 변동."""
    for it in b.get("opinet_naphtha_bbl") or []:
        if not (20 < float(it["value"]) < 300):
            raise ValueError(f"오피넷 나프타 $/bbl 범위 이상(원화표 혼동?): {it}")
    for s in b.get("settles") or []:
        if not (20 < float(s["value"]) < 300):
            raise ValueError(f"원유 정산 범위 이상: {s}")
    for it in b.get("naphtha_cfd") or []:
        if not (200 < float(it["value"]) < 3000):
            raise ValueError(f"나프타 CFD $/톤 범위 이상: {it}")
