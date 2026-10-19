"""1회 비용 추정 — 진짜 API · 토큰 세기 API 없이 코드의 상한값으로 계산한다(docs/onboarding/release-price-report.md «비용»).

가격표: https://platform.claude.com/docs/en/about-claude/pricing (2026-10-20 읽음) — $/백만 토큰.
  입력 · 5분 캐시 쓰기 · 캐시 읽기 · 출력. 웹 검색 $10/1,000회(=$0.01/회). 웹 fetch는 추가 요금 없음(읽은 글 = 입력 토큰).
  서버 도구는 한 요청 안에서 여러 차례 돈다 — 차례마다 그때까지의 대화 전체가 다시 입력으로 계산된다(문서: «search iterations
  executed during a single turn»). 그래서 페이지 · 검색 결과가 쌓일수록 입력이 제곱으로 는다(10-14 실측 105만 토큰의 원인).

글자 → 토큰(로컬 근사, 보수적으로 크게): 한글 1자 = 1토큰, 그 밖의 글자 3자 = 1토큰.
  (Claude 토크나이저는 한글 1자를 보통 1토큰 이하로, 영문 · 숫자 · JSON은 3~4자를 1토큰으로 센다 — 큰 쪽으로 잡았다.)
"""

# $/MTok: (input, cache_write_5m, cache_read, output)
PRICES = {
    "claude-sonnet-5-5": (2.00, 2.50, 0.10, 10.00),
    "claude-opus-5-5": (4.00, 5.00, 0.20, 20.00),
    "claude-haiku-5-5": (0.10, 0.125, 0.01, 0.50),   # 요청 프롬프트 10만 토큰 이하. 넘으면 (0.50, 0.625, 0.05, 2.50)
}
SEARCH_USD = 0.01

# 추정에 쓰는 가정(토큰) — 근거는 release-price-report.md «비용» 표 아래
TOOL_OVERHEAD = 1500        # 서버 도구 정의 · 동적 거르기(code execution) 안내가 붙이는 숨은 지시
STEP_OUT = 600              # 도구 한 번마다 모델이 쓰는 글(검색어 · 거르기 코드 · 짧은 생각) — 최악
STEP_OUT_TYP = 300
SEARCH_RESULT_MAX = 12000   # 검색 1번 결과(동적 거르기 뒤) — 최악. 10-14 실측 평균 ≈ 6,000(아래 TYP)의 2배
SEARCH_RESULT_TYP = 6000
FETCH_RESULT_TYP = 5000     # 가격 표 페이지 1장(거른 뒤) — 보통


def tokens_of(text: str) -> int:
    hangul = sum(1 for ch in text if "가" <= ch <= "힣" or "ㄱ" <= ch <= "ㆎ")
    return hangul + -(-(len(text) - hangul) // 3)


def usd(model: str, inp: float = 0, write: float = 0, read: float = 0, out: float = 0, searches: int = 0) -> float:
    pi, pw, pr, po = PRICES.get(model, PRICES["claude-sonnet-5-5"] if "sonnet" in model else PRICES["claude-opus-5-5"])
    return (inp * pi + write * pw + read * pr + out * po) / 1e6 + searches * SEARCH_USD


def usage_cost(u: dict) -> float:
    """실제 사용량(collect의 _usage) → $. input_tokens는 캐시 안 된 몫만이다(API 정의)."""
    return usd(u["model"], u.get("input_tokens", 0), u.get("cache_write", 0), u.get("cache_read", 0), u.get("output_tokens", 0), u.get("web_search_requests", 0))


def stage_tokens(prompt: int, uses: int, result: int, step_out: int, requests: int, max_tokens: int):
    """한 단계(첫 요청 + 이어받기)의 입력 · 출력 토큰.
    차례 i(0..uses)마다 입력 = 프롬프트 + 그때까지 쌓인 (결과 + 모델 글). 이어받기 요청마다 전체 대화를 한 번 더 읽는다.
    출력 상한 = 요청 수 × max_tokens(서버 차례의 글 · 생각이 모두 그 안)."""
    step = result + step_out
    full = prompt + uses * step
    inp = sum(prompt + i * step for i in range(uses + 1)) + (requests - 1) * full
    return {"input": inp, "new": full, "output": requests * max_tokens}


def plan(s: dict, sources: int, prompts: dict) -> dict:
    """프리셋 s의 최악 · 보통 비용. prompts = {"prices": 토큰, "news": 토큰, "single": 토큰}(시스템 + 사용자 글).
    천장 없는 설정(normal의 페이지 천장 0)은 최악을 계산할 수 없어 None."""
    model = s["model"]
    fetches = s["max_fetches"] or sources
    out = {"preset": s["preset"], "model": model, "requests_max": 0, "worst": None, "worst_cached": None, "typical": None, "rows": []}

    def add(name, prompt, uses, result_max, result_typ, requests, max_tokens, out_typ, searches):
        w = stage_tokens(prompt + TOOL_OVERHEAD, uses, result_max, STEP_OUT, requests, max_tokens)
        t = stage_tokens(prompt + TOOL_OVERHEAD, uses, result_typ, STEP_OUT_TYP, 1, out_typ)
        out["rows"].append({"stage": name, "prompt": prompt + TOOL_OVERHEAD, "uses": uses, "result_max": result_max, "requests": requests,
                            "max_tokens": max_tokens, "searches": searches,
                            "worst": {"input": w["input"], "output": w["output"],
                                      "usd": usd(model, inp=w["input"], out=w["output"], searches=searches),
                                      "usd_cached": usd(model, write=w["new"], read=w["input"] - w["new"], out=w["output"], searches=searches)},
                            "typical": {"input": t["input"], "output": t["output"],
                                        "usd": usd(model, write=t["new"], read=t["input"] - t["new"], out=t["output"], searches=searches)}})
        out["requests_max"] += requests

    if s["staged"]:
        add("① 가격 페이지(web_fetch)", prompts["prices"], fetches, s["fetch_max_tokens"], min(s["fetch_max_tokens"], FETCH_RESULT_TYP),
            s["max_requests"], s["max_tokens_prices"], 1500, 0)
        add("② 사건 검색 + 리포트(web_search)", prompts["news"], s["max_searches"], SEARCH_RESULT_MAX, SEARCH_RESULT_TYP,
            s["max_requests"], s["max_tokens"], 4500, s["max_searches"])
    else:
        if s["fetch_max_tokens"] <= 0:
            return out   # 천장 없음 — 10-14 실측($2.36)이 기준
        uses = fetches + s["max_searches"]
        res = max(s["fetch_max_tokens"], SEARCH_RESULT_MAX)
        add("한 번에(web_fetch + web_search)", prompts["single"], uses, res, SEARCH_RESULT_TYP, s["max_requests"], s["max_tokens"], 13000, s["max_searches"])
    out["worst"] = sum(r["worst"]["usd"] for r in out["rows"])
    out["worst_cached"] = sum(r["worst"]["usd_cached"] for r in out["rows"])
    out["typical"] = sum(r["typical"]["usd"] for r in out["rows"])
    return out


def plan_for(s: dict) -> dict:
    """지금 코드의 프롬프트로 plan — 직전 리포트는 천장 길이만큼 한글로 꽉 찼다고 본다(최악)."""
    from . import collect, config
    last = {"stamp": "2026-10-19 PM", "headline": "가" * 400, "note_html": "가" * 8000}
    prices = {"settles": [{"series": x, "date": "2026-10-19", "value": 105.69, "source": "오피넷"} for x in ("brent", "wti", "dubai") for _ in range(7)],
              "opinet_naphtha_bbl": [{"date": "2026-10-19", "value": 105.27}] * 7,
              "intraday": {"brent": {"date": "2026-10-20", "value": 104.5, "source": "TradingEconomics CFD"}, "wti": None},
              "naphtha_cfd": [{"date": "2026-10-20", "value": 905}]}
    prompts = {
        "prices": tokens_of(collect.PRICE_SYSTEM) + tokens_of(collect.build_price_prompt("AM")),
        "news": tokens_of(collect.SYSTEM_PROMPT) + tokens_of(collect.build_news_prompt("AM", last, prices, s["prev_chars"])),
        "single": tokens_of(collect.SYSTEM_PROMPT) + tokens_of(collect.build_user_prompt("AM", last, s["prev_chars"])),
    }
    return plan(s, len(config.SOURCES), prompts)


def table(p: dict) -> str:
    lines = [f"프리셋 {p['preset']} · 모델 {p['model']} · 요청 최대 {p['requests_max']}번"]
    for r in p["rows"]:
        lines.append(f"  {r['stage']}: 프롬프트 {r['prompt']:,} · 도구 {r['uses']}번 × 결과 ≤{r['result_max']:,} · 요청 ≤{r['requests']} · "
                     f"최악 입력 {r['worst']['input']:,} 출력 {r['worst']['output']:,} → ${r['worst']['usd']:.3f}(캐시 ${r['worst']['usd_cached']:.3f}) · "
                     f"보통 입력 {r['typical']['input']:,} 출력 {r['typical']['output']:,} → ${r['typical']['usd']:.3f}")
    if p["worst"] is None:
        lines.append("  천장 없음 — 최악 계산 불가(10-14 실측 약 $2.36)")
    else:
        lines.append(f"  합계: 최악 ${p['worst']:.2f}(캐시가 하나도 안 먹을 때) · 최악+캐시 ${p['worst_cached']:.2f} · 보통 ${p['typical']:.2f}")
    return "\n".join(lines)


if __name__ == "__main__":   # cd macro/engine 뒤 python -m briefing.estimate
    from . import config as _c
    for _name in ("low", "normal"):
        print(table(plan_for(_c.load({"BRIEFING_PRESET": _name}))))
