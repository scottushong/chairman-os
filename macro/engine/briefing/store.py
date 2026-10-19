"""가격·메모를 JSON 파일에 누적 저장 (덮어쓰지 않고 upsert / prepend).

prices.json  : [{series, date, value, kind, source, label}]
  series = brent | wti | dubai | naphtha_cfd | opinet_naphtha_bbl | mopj
  kind   = settle(정산) | intraday(장중) | monthly(월평균) | spot | forecast
notes.json   : [{stamp, html}]   최신이 앞
static.json  : ③표 고정 행(1/2, 2월말, 3월말 …) + 각주
"""
import json
from pathlib import Path

from . import config

PRICES = config.DATA_DIR / "prices.json"
NOTES = config.DATA_DIR / "notes.json"
STATIC = config.DATA_DIR / "static.json"
LAST = config.DATA_DIR / "last_briefing.json"


def _load(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def _save(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def load_prices():
    return _load(PRICES, [])


def load_notes():
    return _load(NOTES, [])


def load_static():
    return _load(STATIC, {"table_static_rows": [], "table_footnote": ""})


def load_last():
    return _load(LAST, None)


def upsert_price(rows, series, date, value, kind="settle", source="", label=None):
    """같은 series·date면 갱신. 정산(settle)은 장중(intraday)보다 우선 — 장중값이 정산을 덮지 않음."""
    if value is None or not date:
        return rows
    old = next((r for r in rows if r["series"] == series and r["date"] == date), None)
    if old and old.get("kind") == "settle" and kind == "intraday":
        return rows
    rows = [r for r in rows if not (r["series"] == series and r["date"] == date)]
    rows.append({"series": series, "date": date, "value": float(value), "kind": kind,
                 "source": source, "label": label if label is not None else (old or {}).get("label")})
    rows.sort(key=lambda r: (r["series"], r["date"]))
    return rows


def ingest(b: dict):
    rows = load_prices()
    # 장중값은 그날 하나만 유지: 오늘 이전 날짜의 intraday는 정산 들어오면 자동 교체
    for s in b.get("settles", []):
        rows = upsert_price(rows, s["series"], s.get("date"), s.get("value"), "settle", s.get("source", ""))
    for key, it in (b.get("intraday") or {}).items():
        if it and it.get("value") is not None:
            rows = upsert_price(rows, key, it.get("date"), it["value"], "intraday", it.get("source", ""))
    for it in b.get("naphtha_cfd", []):
        rows = upsert_price(rows, "naphtha_cfd", it.get("date"), it.get("value"), "settle", "TradingEconomics CFD")
    for it in b.get("opinet_naphtha_bbl", []):
        rows = upsert_price(rows, "opinet_naphtha_bbl", it.get("date"), it.get("value"), "settle", "오피넷")
    for it in b.get("mopj_monthly", []):
        m = it.get("month")  # YYYY-MM → 그 달 15일 위치에 표시
        if m:
            rows = upsert_price(rows, "mopj", f"{m}-15", it.get("value"),
                                "forecast" if it.get("is_forecast") else "monthly", it.get("source", "MOPJ"))
    _save(PRICES, rows)

    if b.get("note_html"):
        notes = load_notes()
        stamp = b.get("stamp", "")
        notes = [n for n in notes if n.get("stamp") != stamp]
        notes.insert(0, {"stamp": stamp, "html": b["note_html"]})
        _save(NOTES, notes)
    _save(LAST, b)
