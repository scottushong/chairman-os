"""Claude API(web_fetch + web_search)로 최신 가격·사건을 수집해 JSON으로 반환.

채팅에서 "최신 사건 뉴스 가격"을 만들던 절차를 그대로 옮긴 것:
  1) 오피넷 원유·제품 페이지 직접 확인 (정산가, 나프타 $/bbl)
  2) TradingEconomics Brent/WTI/나프타 (장중 CFD, 나프타 CFD)
  3) 웹검색으로 사건 — 날짜 확인 후 채택
"""
import json
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import anthropic

from . import config

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


def build_user_prompt(slot: str, last: dict | None) -> str:
    now = datetime.now(ZoneInfo(config.TIMEZONE))
    src = "\n".join(f"- {k}: {v}" for k, v in config.SOURCES.items())
    prev = json.dumps({k: last.get(k) for k in ("stamp", "headline", "note_html")}, ensure_ascii=False)[:4000] if last else "없음"
    return (f"현재 시각: {now:%Y-%m-%d %H:%M} KST ({slot}).\n"
            f"1) 아래 가격 페이지를 web_fetch로 직접 열어 최신 값을 읽어라:\n{src}\n"
            "   - 오피넷 원유: 표에 있는 모든 날짜의 Dubai/Brent/WTI 정산을 settles에 넣어라.\n"
            "   - 오피넷 제품: 표에 있는 모든 날짜의 나프타 $/bbl을 opinet_naphtha_bbl에 넣어라.\n"
            "   - TE 나프타: 최신 날짜 값을 naphtha_cfd에. TE Brent/WTI: 오늘 장중값을 intraday에.\n"
            "2) 직전 리포트 이후 새 사건을 웹검색하라(날짜 확인 필수).\n"
            "3) MOPJ 월평균 새 값이 공개됐으면 mopj_monthly에 넣어라(없으면 빈 배열).\n\n"
            f"직전 리포트(중복·정정 확인용):\n{prev}\n\n{SCHEMA}")


def _extract_json(text: str) -> dict:
    text = re.sub(r"```(?:json)?", "", text).strip()
    s, e = text.find("{"), text.rfind("}")
    if s == -1 or e == -1:
        raise ValueError("응답에서 JSON을 찾지 못함")
    return json.loads(text[s:e + 1])


def collect(slot: str, last: dict | None = None) -> dict:
    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY
    tools = [
        {"type": config.WEB_FETCH_TOOL, "name": "web_fetch", "max_uses": config.MAX_FETCHES,
         **({"max_content_tokens": config.FETCH_MAX_TOKENS} if config.FETCH_MAX_TOKENS > 0 else {})},
        {"type": config.WEB_SEARCH_TOOL, "name": "web_search", "max_uses": config.MAX_SEARCHES},
    ]
    messages = [{"role": "user", "content": build_user_prompt(slot, last)}]
    usage = {"model": config.MODEL, "calls": 0, "input_tokens": 0, "output_tokens": 0, "cache_read": 0, "cache_write": 0,
             "web_search_requests": 0, "web_fetch_requests": 0}
    for _ in range(8):   # pause_turn 이어받기
        # 스트리밍으로 받는다 — 도구를 여러 번 쓰는 긴 차례가 HTTP 시간 제한에 걸리지 않게.
        with client.messages.stream(model=config.MODEL, max_tokens=config.MAX_TOKENS,
                                    system=SYSTEM_PROMPT, tools=tools, messages=messages) as stream:
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
        data = _extract_json(text)
    except ValueError as exc:
        # 왜 JSON이 없었는지 실행 기록 오류 한 줄에 남긴다(차례 수 · 멈춘 이유 · 사용량).
        print("사용량(실패):", json.dumps(usage, ensure_ascii=False), file=sys.stderr)
        raise ValueError(f"{exc}(stop_reason={resp.stop_reason}, 차례 {usage['calls']}, 글 {len(text)}자)") from exc
    validate(data)
    data["_usage"] = usage
    return data


def validate(b: dict):
    """명백한 오류 차단: 단위 혼동(오피넷 원화표), 비정상 변동."""
    for it in b.get("opinet_naphtha_bbl", []):
        if not (20 < float(it["value"]) < 300):
            raise ValueError(f"오피넷 나프타 $/bbl 범위 이상(원화표 혼동?): {it}")
    for s in b.get("settles", []):
        if not (20 < float(s["value"]) < 300):
            raise ValueError(f"원유 정산 범위 이상: {s}")
    for it in b.get("naphtha_cfd", []):
        if not (200 < float(it["value"]) < 3000):
            raise ValueError(f"나프타 CFD $/톤 범위 이상: {it}")
