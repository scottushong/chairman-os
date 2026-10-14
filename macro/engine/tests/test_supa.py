"""supa.py 시험 — 가짜 PostgREST(httpx를 바꿔 끼움). 진짜 Supabase · AI 호출 0.

    python -I macro/engine/tests/test_supa.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from briefing import store, supa  # noqa: E402

calls = []


class R:
    def __init__(self, status, body):
        self.status_code = status
        self._b = body
        self.content = json.dumps(body).encode() if body is not None else b""
        self.text = self.content.decode()

    def json(self):
        return self._b


def fake_post(url, headers=None, json=None, content=None, timeout=None):
    if "/auth/v1/token" in url:
        assert json == {"email": "agent@x", "password": "pw"}
        return R(200, {"access_token": "tok"})
    name = url.rsplit("/", 1)[1]
    args = __import__("json").loads(content.decode("utf-8"))
    assert headers["Authorization"] == "Bearer tok"
    calls.append((name, args))
    return R(200, {"price_report_agent_points": 3, "price_report_agent_events": 1, "price_report_agent_save": "rep-1"}.get(name, None))


def fake_get(url, headers=None, timeout=None):
    if "purchase_price_points" in url:
        return R(200, [{"series": "brent", "point_date": "2026-10-13", "value": "105.69", "kind": "settle", "source": "오피넷", "label": None},
                       {"series": "opinet_naphtha_bbl", "point_date": "2026-10-13", "value": "105.27", "kind": "settle", "source": "오피넷", "label": None}])
    if "purchase_price_events" in url:
        return R(200, [{"title": "2026-10-14 PM", "html": "<b>메모</b>"}])
    if "purchase_price_reports" in url:
        return R(200, [{"figures": {"stamp": "2026-10-14 PM", "headline": "앞 리포트"}}])
    raise AssertionError(url)


httpx.post = fake_post
httpx.get = fake_get

sb = supa.Supa("https://x.supabase.co", "anon", "agent@x", "pw")
n_pts, n_memo = supa.pull(sb)
assert (n_pts, n_memo) == (2, 1)
assert store.load_last()["headline"] == "앞 리포트"
assert store.load_notes() == [{"stamp": "2026-10-14 PM", "html": "<b>메모</b>"}]

b = {"stamp": "2026-10-15 AM", "settles": [{"series": "brent", "date": "2026-10-14", "value": 106}], "note_html": "<b>새 메모</b><script>x</script>",
     "events": [{"date": "2026-10-15", "title": "가짜 사건", "url": "javascript:alert(1)"}, {"title": " "}], "missing": ["MOPJ 미발표"]}
store.ingest(b)  # run.py와 같은 순서: 저장소에 넣고 → 렌더 → push
out = supa.push(sb, "run-1", "AM", "2026-10-15", b, "<html>" + "." * 200 + "</html>")
assert out == {"report_id": "rep-1", "points": 3, "new_events": 1}, out
names = [c[0] for c in calls]
assert names == ["price_report_agent_points", "price_report_agent_events", "price_report_agent_save"], names
ev = calls[1][1]["p_events"]
assert ev[0] == {"kind": "event", "date": "2026-10-15", "title": "가짜 사건", "url": "", "source": ""}, ev[0]  # javascript: 주소는 버림
assert len(ev) == 2 and ev[1]["kind"] == "memo" and "<script>" not in ev[1]["html"] and "&lt;script&gt;" in ev[1]["html"]
save = calls[2][1]
assert save["p_status"] == "ok", "뉴스 못 찾음(missing)만으로 «미확인»이 됐다"
assert save["p_missing"] == ["MOPJ 미발표"] and save["p_figures"]["cards"]["brent"]["value"] == 106

calls.clear()
supa.push(sb, "run-2", "PM", "2026-10-15", {"stamp": "x", "missing": ["수집 실패: 오피넷 범위 이상"], "_failed": True}, "<html>" + "." * 200 + "</html>")
assert calls[-1][1]["p_status"] == "unconfirmed", "수집 실패가 «미확인»이 아니다"
print("ok")
