"""Supabase 저장(0082) — 엔진이 AI Agent 계정(야간 브리핑과 같은 로그인, service_role 아님)으로 RPC만 부른다.

환경변수(GitHub Secrets — 이름만, 값은 대표가 넣는다):
  SUPABASE_URL · SUPABASE_ANON_KEY · AI_AGENT_EMAIL · AI_AGENT_PASSWORD

읽기: 앞 가격 · 회차 메모 · 직전 리포트(표 RLS — price_report_reader가 AIAgent를 들인다)
쓰기: price_report_agent_begin · _points · _events · _save · _fail (0082 — AIAgent만)
"""
import json
import os

import httpx

from . import config, store


class Supa:
    def __init__(self, url: str, anon: str, email: str, password: str):
        self.url = url.rstrip("/")
        self.anon = anon
        r = httpx.post(f"{self.url}/auth/v1/token?grant_type=password", headers={"apikey": anon},
                       json={"email": email, "password": password}, timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"AI Agent 로그인 실패 HTTP {r.status_code}")
        self.token = r.json()["access_token"]

    def _h(self):
        return {"apikey": self.anon, "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def rpc(self, name: str, args: dict):
        r = httpx.post(f"{self.url}/rest/v1/rpc/{name}", headers=self._h(), content=json.dumps(args, ensure_ascii=False).encode("utf-8"), timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f"{name} HTTP {r.status_code}: {r.text[:300]}")
        return r.json() if r.content else None

    def select(self, table: str, query: str):
        r = httpx.get(f"{self.url}/rest/v1/{table}?{query}", headers=self._h(), timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f"{table} HTTP {r.status_code}: {r.text[:300]}")
        return r.json()


def from_env() -> Supa:
    need = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "AI_AGENT_EMAIL", "AI_AGENT_PASSWORD"]
    miss = [k for k in need if not os.getenv(k)]
    if miss:
        raise RuntimeError(f"환경변수 없음: {', '.join(miss)}")
    return Supa(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"], os.environ["AI_AGENT_EMAIL"], os.environ["AI_AGENT_PASSWORD"])


def pull(sb: Supa, biz: str = config.BUSINESS_ID):
    """DB → 엔진의 로컬 저장소(prices.json · notes.json · static.json · last_briefing.json). 렌더는 예전 그대로 파일을 읽는다."""
    pts = sb.select("purchase_price_points", f"business_id=eq.{biz}&select=series,point_date,value,kind,source,label&order=series,point_date")
    rows = [{"series": p["series"], "date": p["point_date"], "value": float(p["value"]), "kind": p["kind"], "source": p.get("source") or "", "label": p.get("label")} for p in pts]
    store._save(store.PRICES, rows)
    memos = sb.select("purchase_price_events", f"business_id=eq.{biz}&kind=eq.memo&select=title,html&order=first_seen_at.desc,event_id.desc&limit=200")
    store._save(store.NOTES, [{"stamp": m["title"], "html": m.get("html") or ""} for m in memos])
    seed = json.loads((config.DATA_DIR / "seed_v2.json").read_text(encoding="utf-8"))
    store._save(store.STATIC, {"table_static_rows": seed["table_static_rows"], "table_footnote": seed["table_footnote"]})
    last = sb.select("purchase_price_reports", f"business_id=eq.{biz}&select=figures&order=created_at.desc&limit=1")
    if last:
        store._save(store.LAST, last[0]["figures"])
    return len(rows), len(memos)


def push(sb: Supa, run_id: str, slot: str, report_date: str, briefing: dict, html_text: str, biz: str = config.BUSINESS_ID) -> dict:
    """엔진 결과 → DB. 가격(바뀐 줄만 세어 돌려받음) · 사건(새 것만 셈) · 회차 메모 · 리포트 + 실행 «완료»."""
    points = sb.rpc("price_report_agent_points", {"p_business": biz, "p_points": store.load_prices()})
    events = []
    for e in briefing.get("events") or []:
        if isinstance(e, dict) and str(e.get("title") or "").strip():
            url = str(e.get("url") or "").strip()
            events.append({"kind": "event", "date": e.get("date") or report_date, "title": str(e["title"])[:300],
                           "url": url if url.lower().startswith(("http://", "https://")) else "", "source": (e.get("source") or "")[:120]})
    if briefing.get("note_html"):
        from .render import clean_note
        events.append({"kind": "memo", "date": report_date, "title": briefing.get("stamp") or f"{report_date} {slot}", "html": clean_note(briefing["note_html"])})
    new_events = sb.rpc("price_report_agent_events", {"p_business": biz, "p_run": run_id, "p_slot": slot, "p_events": events}) if events else 0
    missing = [str(m) for m in (briefing.get("missing") or [])][:30]
    # «미확인» = 이번 회차 가격을 확인하지 못함(수집 실패 · 정산 · 오피넷 값이 하나도 없음). 못 찾은 뉴스 항목(missing)은 메모에만 보인다(채팅 리포트와 같다).
    unconfirmed = bool(briefing.get("_failed")) or not (briefing.get("settles") or briefing.get("opinet_naphtha_bbl"))
    figures = {k: briefing.get(k) for k in ("stamp", "headline", "sub", "settles", "intraday", "naphtha_cfd", "opinet_naphtha_bbl", "mopj_monthly", "note_html", "_usage")}
    figures["cards"] = summary_cards()
    sources = list(config.SOURCES.values())
    report_id = sb.rpc("price_report_agent_save", {
        "p_run": run_id, "p_report_date": report_date, "p_status": "unconfirmed" if unconfirmed else "ok", "p_html": html_text,
        "p_summary": briefing.get("chat_summary"), "p_figures": figures, "p_sources": sources, "p_missing": missing,
        "p_new_events": new_events or 0, "p_points": points or 0})
    return {"report_id": report_id, "points": points, "new_events": new_events}


def summary_cards() -> dict:
    """구매 개요 요약 카드용(Brent · 두바이 · 나프타 · 크랙) — 저장소의 마지막 값. 앱은 이 값만 그린다(계산하지 않는다)."""
    rows = store.load_prices()

    def last(series, kinds=None):
        s = sorted([r for r in rows if r["series"] == series and (kinds is None or r["kind"] in kinds)], key=lambda r: r["date"])
        return {"date": s[-1]["date"], "value": s[-1]["value"], "kind": s[-1]["kind"]} if s else None

    out = {"brent": last("brent"), "dubai": last("dubai"), "wti": last("wti"), "naphtha_cfd": last("naphtha_cfd"), "opinet_naphtha_bbl": last("opinet_naphtha_bbl")}
    opi = sorted([r for r in rows if r["series"] == "opinet_naphtha_bbl"], key=lambda r: r["date"])
    brent = {r["date"]: r["value"] for r in rows if r["series"] == "brent" and r["kind"] == "settle"}
    crack = [(r["date"], round(r["value"] - brent[r["date"]], 2)) for r in opi if r["date"] in brent]
    out["crack"] = {"date": crack[-1][0], "value": crack[-1][1]} if crack else None
    return out
