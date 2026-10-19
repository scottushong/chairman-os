"""가격 리포트 1회 비용 시험 — 가짜(mock) Anthropic 클라이언트. 진짜 AI 호출 0.

    python -I macro/engine/tests/test_cost.py

① 가격표가 10-14 실측($2.36 — 입력 1,053,198 · 출력 13,409 · 검색 12)을 다시 만든다
② low 프리셋: 상한값으로 계산한 최악 비용 < $1(캐시가 하나도 안 먹어도) · 보통 < $0.40
③ low 흐름(가짜 클라이언트): 요청 수 · 도구 max_uses · 페이지 천장 · 캐싱 · effort · 요청 글 크기가 상한 안
④ pause_turn이 끝없이 와도 단계마다 max_requests번에서 멈춘다(돈이 새지 않음)
⑤ ② 사건 단계가 실패해도 ①의 가격은 남는다 · ① 단위 오류면 ②를 부르지 않는다
⑥ normal은 예전처럼 한 번(도구 둘) · 환경변수 덮기 · 잘못된 프리셋 거부
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
for _s in (sys.stdout, sys.stderr):   # -I는 PYTHONIOENCODING을 무시한다(Windows cp949)
    _s.reconfigure(encoding="utf-8")

from briefing import collect, config, estimate  # noqa: E402

# ① 가격표 ↔ 10-14 실측
measured = estimate.usd("claude-sonnet-5-5", inp=1_053_198, out=13_409, searches=12)
assert abs(measured - 2.36) < 0.02, f"가격표가 10-14 실측 $2.36을 못 만든다: {measured:.3f}"

# ② 상한값 추정
low = config.load({"BRIEFING_PRESET": "low"})
p = estimate.plan_for(low)
assert p["worst"] < 1.0, f"low 최악 ${p['worst']:.3f} ≥ $1\n" + estimate.table(p)
assert p["worst_cached"] < p["worst"] and p["typical"] < 0.40, estimate.table(p)
assert p["requests_max"] == 4, p["requests_max"]
# 출처를 끄면(te) 페이지 2장 — 더 싸야 한다
saved = dict(config.SOURCES)
config.SOURCES = {k: v for k, v in saved.items() if not k.startswith("te_")}
assert estimate.plan_for(low)["worst"] < p["worst"]
config.SOURCES = saved


# ③ 가짜 클라이언트
class Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


PRICES_JSON = {"settles": [{"series": "brent", "date": "2026-10-19", "value": 105.69, "source": "오피넷"}],
               "opinet_naphtha_bbl": [{"date": "2026-10-19", "value": 105.27}],
               "intraday": {"brent": {"date": "2026-10-20", "value": 104.5, "source": "TradingEconomics CFD"}, "wti": None},
               "naphtha_cfd": [{"date": "2026-10-20", "value": 905}], "missing": ["TE WTI"]}
NEWS_JSON = {"stamp": "2026-10-20 AM", "headline": "가짜 헤드라인", "sub": "s", "mopj_monthly": [],
             "events": [{"date": "2026-10-20", "title": "가짜 사건", "url": "https://example.invalid/a", "source": "가짜"}],
             "note_html": "<b>10/20 아침 신규</b>", "chat_summary": "요약", "missing": ["MOPJ 미발표"],
             "settles": [{"series": "brent", "date": "2026-10-19", "value": 999, "source": "지어냄"}]}  # ②가 가격을 다시 쓰면 무시돼야 한다


class FakeClient:
    def __init__(self, replies):
        self.replies = list(replies)   # (stop_reason, dict|str) — 단계 안 요청 순서대로
        self.requests = []
        self.messages = self

    def stream(self, **kw):
        self.requests.append(kw)
        stop, body = self.replies.pop(0) if self.replies else ("pause_turn", "")
        text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
        tools = [t["name"] for t in kw["tools"]]
        u = Obj(input_tokens=1000, output_tokens=200, cache_read_input_tokens=5000, cache_creation_input_tokens=3000,
                server_tool_use=Obj(web_search_requests=2 if "web_search" in tools else 0, web_fetch_requests=5 if "web_fetch" in tools else 0))
        msg = Obj(stop_reason=stop, usage=u, content=[Obj(type="text", text=text)])

        class Ctx:
            def __enter__(s):
                return Obj(get_final_message=lambda: msg)

            def __exit__(s, *a):
                return False
        return Ctx()


def req_tokens(kw) -> int:
    msgs = []
    for m in kw["messages"]:
        c = m["content"]
        msgs.append(c if isinstance(c, str) else "".join(getattr(b, "text", "") for b in c))
    return estimate.tokens_of(kw["system"]) + estimate.tokens_of("\n".join(msgs))


last = {"stamp": "2026-10-19 PM", "headline": "앞 헤드라인", "note_html": "가" * 9000}
fc = FakeClient([("end_turn", PRICES_JSON), ("end_turn", NEWS_JSON)])
out = collect.collect("AM", last, client=fc, settings=low)
assert len(fc.requests) == 2, len(fc.requests)
r1, r2 = fc.requests
n_src = len(config.SOURCES)
assert [t["name"] for t in r1["tools"]] == ["web_fetch"], r1["tools"]
assert r1["tools"][0]["max_uses"] == n_src and r1["tools"][0]["max_content_tokens"] == 6000, r1["tools"]
assert [t["name"] for t in r2["tools"]] == ["web_search"] and r2["tools"][0]["max_uses"] == 4, r2["tools"]
for r in (r1, r2):
    assert r["model"] == "claude-sonnet-5-5"
    assert r["cache_control"] == {"type": "ephemeral"}, "프롬프트 캐싱이 꺼져 있다"
assert r1["max_tokens"] == 3000 and r2["max_tokens"] == 7000
assert r1["output_config"] == {"effort": "low"} and r2["output_config"] == {"effort": "medium"}
# 요청 글 크기 — ①은 짧은 지시만, ②에는 페이지 본문이 없고 직전 리포트는 1,200자까지
assert req_tokens(r1) <= 1200, req_tokens(r1)
assert req_tokens(r2) <= 4500, req_tokens(r2)
assert "가" * 1201 not in r2["messages"][0]["content"], "직전 리포트가 천장보다 길게 들어갔다"
assert "opinet.co.kr" not in r2["messages"][0]["content"], "② 요청에 가격 페이지 주소(→ 다시 열기)가 들어갔다"
# 합치기 — 가격은 ①의 값, 글은 ②의 값, missing은 둘 다
assert out["settles"] == PRICES_JSON["settles"], "②가 가격을 덮었다"
assert out["headline"] == "가짜 헤드라인" and out["events"][0]["title"] == "가짜 사건"
assert out["missing"] == ["TE WTI", "MOPJ 미발표"], out["missing"]
u = out["_usage"]
assert u["preset"] == "low" and u["calls"] == 2 and u["web_fetch_requests"] == 5 and u["web_search_requests"] == 2
assert u["usd"] == round(estimate.usage_cost(u), 4) and u["usd"] > 0

# ④ pause_turn이 끝없이 — 단계마다 2번에서 멈추고(①에서 JSON 없음 → 실패), ②는 부르지 않는다
fc = FakeClient([])
try:
    collect.collect("AM", last, client=fc, settings=low)
    raise SystemExit("pause_turn만 오는데 성공했다")
except ValueError as exc:
    assert "pause_turn" in str(exc), exc
assert len(fc.requests) == 2, f"요청 {len(fc.requests)}번 — 천장 2를 넘었다"
# 이어받기 요청은 앞 대화를 그대로 다시 보낸다(append-only)
assert fc.requests[1]["messages"][0] == fc.requests[0]["messages"][0] and fc.requests[1]["messages"][1]["role"] == "assistant"

# ⑤ ② 실패 → 가격은 남는다
fc = FakeClient([("end_turn", PRICES_JSON), ("end_turn", "JSON 아님"), ])
out = collect.collect("AM", last, client=fc, settings=low)
assert out["settles"] == PRICES_JSON["settles"] and any("사건 수집 실패" in m for m in out["missing"]), out
assert len(fc.requests) == 2
# ① 단위 오류(884 원화 값) → ②를 부르지 않는다
bad = dict(PRICES_JSON, opinet_naphtha_bbl=[{"date": "2026-10-19", "value": 884}])
fc = FakeClient([("end_turn", bad)])
try:
    collect.collect("AM", last, client=fc, settings=low)
    raise SystemExit("884가 통과했다")
except ValueError:
    pass
assert len(fc.requests) == 1, "단위 오류인데 ② 사건 단계를 불렀다"

# ⑥ normal — 예전처럼 한 번에(도구 둘 · 검색 15 · 페이지 12 · 천장 없음) + 캐싱
normal = config.load({"BRIEFING_PRESET": "normal"})
fc = FakeClient([("end_turn", {**PRICES_JSON, **{k: v for k, v in NEWS_JSON.items() if k != "settles"}})])
out = collect.collect("PM", last, client=fc, settings=normal)
(r,) = fc.requests
assert [t["name"] for t in r["tools"]] == ["web_fetch", "web_search"]
assert r["tools"][0]["max_uses"] == 12 and "max_content_tokens" not in r["tools"][0] and r["tools"][1]["max_uses"] == 15
assert r["cache_control"] == {"type": "ephemeral"} and "output_config" not in r and r["max_tokens"] == 16000
assert estimate.plan_for(normal)["worst"] is None
# 덮기 · 기본 · 거부
assert config.load({})["preset"] == "low", "프리셋 기본이 low가 아니다"
o = config.load({"BRIEFING_PRESET": "low", "BRIEFING_MAX_SEARCHES": "2", "BRIEFING_FETCH_MAX_TOKENS": "", "BRIEFING_MODEL": " "})
assert o["max_searches"] == 2 and o["fetch_max_tokens"] == 6000 and o["model"] == "claude-sonnet-5-5"
try:
    config.load({"BRIEFING_PRESET": "cheap"})
    raise SystemExit("없는 프리셋이 통과했다")
except ValueError:
    pass

print(f"ok — low 최악 ${p['worst']:.2f} · 최악+캐시 ${p['worst_cached']:.2f} · 보통 ${p['typical']:.2f} (10-14 실측 ${measured:.2f})")
