"""누적 데이터 → 가격 리포트 HTML (채팅에서 쓰던 price_report 레이아웃과 동일).

구성: 헤더(h1·sub) → 카드 5개 → ① 원유 차트 → ② 나프타 차트 → ③ 3층 비교표 → 사건 메모(최신이 위)
"""
import html as _h
from datetime import date, datetime
from zoneinfo import ZoneInfo

from . import config, store

WEEK = "월화수목금토일"

CSS = """body{background:#0b0d12;color:#e8e8e8;font-family:'Malgun Gothic',sans-serif;padding:16px;max-width:1150px;margin:0 auto}
h1{font-size:18px;color:#fff;margin-bottom:4px}.sub{color:#999;font-size:12px;margin-bottom:14px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.s{background:#12151c;border-radius:10px;padding:10px 12px;flex:1;min-width:140px}
.l{font-size:10px;color:#888}.v{font-size:15px;font-weight:700}.dn{color:#7ee787}.up{color:#e8734a}.hot{color:#e85a5a}.mix{color:#f6c25b}
.box{background:#12151c;border-radius:12px;padding:16px;margin-bottom:16px}.t{font-size:13px;color:#ccc;margin-bottom:6px;font-weight:600}
.lg{font-size:11px;color:#aaa;margin-bottom:6px}.lg span{margin-right:12px}
svg{width:100%;height:auto}.note{font-size:11px;color:#888;line-height:1.75}
table td,table th{padding:4px}"""

def _num(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".")


def chart_svg(series, min_v, max_v, unit, line100, max_x, months, w=1100, h=380):
    """예전 canvas chart()와 같은 그림을 SVG로(스크립트 없이 — 앱이 스크립트를 막은 sandbox로 보인다).
    좌표 · 색 · 글꼴 · 점선 · 꼭짓점 글은 canvas 판과 같은 계산이다."""
    L, B, T, R = 60, 40, 15, 20
    pw, ph, r = w - L - R, h - T - B, max_v - min_v
    X = lambda d: L + ((d - 1) / (max_x - 1)) * pw
    Y = lambda v: T + ph - ((v - min_v) / r) * ph
    out = [f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg" '
           'style="width:100%;height:auto;font-family:sans-serif">']
    for g in range(7):
        y = T + ph - (g / 6) * ph
        out.append(f'<line x1="{L}" y1="{_num(y)}" x2="{w - R}" y2="{_num(y)}" stroke="#2a2d35" stroke-width="1"/>')
        out.append(f'<text x="{L - 6}" y="{_num(y + 4)}" fill="#777" font-size="11" text-anchor="end">{_h.escape(unit)}{min_v + g / 6 * r:.0f}</text>')
    for i in range(1, months + 1):
        out.append(f'<text x="{_num(X(i))}" y="{h - B + 18}" fill="#999" font-size="11" text-anchor="middle">{i}월</text>')
    if line100:
        out.append(f'<line x1="{L}" y1="{_num(Y(100))}" x2="{w - R}" y2="{_num(Y(100))}" stroke="rgba(232,90,90,.5)" stroke-width="1" stroke-dasharray="5,5"/>')
    for s in series:
        pts = s["d"]
        if pts:
            path = " ".join(f"{_num(X(p[0]))},{_num(Y(p[1]))}" for p in pts)
            out.append(f'<polyline points="{path}" fill="none" stroke="{s["c"]}" stroke-width="2.3"/>')
        for p in pts:
            out.append(f'<circle cx="{_num(X(p[0]))}" cy="{_num(Y(p[1]))}" r="3" fill="{s["c"]}"/>')
            if len(p) > 2 and p[2]:
                out.append(f'<text x="{_num(X(p[0]))}" y="{_num(Y(p[1]) - 9)}" fill="#ddd" font-size="10" text-anchor="middle">{_h.escape(str(p[2]))}</text>')
    out.append("</svg>")
    return "".join(out)


ALLOWED_NOTE_TAGS = {"&lt;b&gt;": "<b>", "&lt;/b&gt;": "</b>", "&lt;br&gt;": "<br>", "&lt;br/&gt;": "<br>", "&lt;br /&gt;": "<br>"}


def clean_note(html_text: str) -> str:
    """사건 메모는 바깥 글(AI · 웹)이다 — 전부 escape한 뒤 <b> · </b> · <br>만 되살린다(속성 없는 꼴만)."""
    t = _h.escape(html_text or "", quote=True)
    for k, v in ALLOWED_NOTE_TAGS.items():
        t = t.replace(k, v).replace(k.upper(), v)
    return t


GREY = '<td align=center style="color:#888">—</td>'


def _x(d: str) -> float:
    y, m, dd = map(int, d.split("-"))
    return round(m + (dd - 1) / 30, 3)


def _md(d: str) -> str:
    return f"{int(d[5:7])}/{int(d[8:10])}"


def _series(rows, name, kinds=None):
    out = [r for r in rows if r["series"] == name and (kinds is None or r.get("kind") in kinds)
           and r["date"].startswith(str(config.YEAR))]
    return sorted(out, key=lambda r: r["date"])


def _latest(rows, name, kind=None):
    s = [r for r in _series(rows, name) if kind is None or r.get("kind") == kind]
    return s[-1] if s else None


def _prev_settle(rows, name, before):
    s = [r for r in _series(rows, name, {"settle"}) if r["date"] < before]
    return s[-1] if s else None


def _pts(rows, fmt_last, mult=1.0):
    pts = []
    for i, r in enumerate(rows):
        v = round(r["value"] * mult, 2)
        lab = r.get("label")
        if i == len(rows) - 1:
            lab = fmt_last(r, v)
        pts.append([_x(r["date"]), v, lab] if lab else [_x(r["date"]), v])
    return pts


def _pct(a, b):
    return (a - b) / b * 100 if b else None


def _cls(v):
    return "hot" if v is not None and v >= 1.5 else ("up" if v is not None and v > 0 else "dn")


def _card(label, value, cls):
    return f'<div class="s"><div class="l">{label}</div><div class="v {cls}">{value}</div></div>'


def _crude_card(rows, name, title):
    st = _latest(rows, name, "settle")
    it = _latest(rows, name, "intraday")
    if not st:
        return _card(title, "—", "dn")
    pv = _prev_settle(rows, name, st["date"])
    ch = _pct(st["value"], pv["value"]) if pv else None
    if it and it["date"] > st["date"]:
        ich = _pct(it["value"], st["value"])
        return _card(f"{title}({_md(st['date'])} 정산 → {_md(it['date'])} 장중)",
                     f"${st['value']:.2f} → ~${it['value']:.1f} ({ich:+.1f}%)", _cls(ich))
    return _card(f"{title}({_md(st['date'])} 정산)",
                 f"${st['value']:.2f}" + (f" ({ch:+.2f}%)" if ch is not None else ""), _cls(ch))


def _crack(rows, d):
    n = next((r for r in _series(rows, "opinet_naphtha_bbl") if r["date"] == d), None)
    b = next((r for r in _series(rows, "brent", {"settle"}) if r["date"] == d), None)
    if n and b:
        return round(n["value"] - b["value"], 2), n["value"], b["value"]
    return None


def _table(rows, static):
    cfd = {r["date"]: r["value"] for r in _series(rows, "naphtha_cfd")}
    opi = {r["date"]: r["value"] for r in _series(rows, "opinet_naphtha_bbl")}
    dates = sorted(d for d in set(cfd) | set(opi) if d >= config.TABLE_DYNAMIC_FROM)
    out = []
    for i, d in enumerate(dates):
        last = i == len(dates) - 1
        b = lambda s: f"<b>{s}</b>" if last else s
        c = f"<td align=center>{cfd[d]:.0f}</td>" if d in cfd else '<td align=center style="color:#888">미발표</td>'
        if d in opi:
            t = opi[d] * config.NAPHTHA_BBL_PER_TON
            o = f'<td align=center style="color:#f2cc60">{b(f"{t:,.0f}")} <small>(${opi[d]:.2f}/bbl)</small></td>'
        else:
            o = GREY
        diff = f"<td align=center>{opi[d]*config.NAPHTHA_BBL_PER_TON - cfd[d]:+.0f}</td>" if d in opi and d in cfd else GREY
        ck = _crack(rows, d)
        if ck:
            col = "#ff7b72" if ck[0] >= config.CRACK_SIGNAL else ("#f2cc60" if ck[0] > -1 else "#7ee787")
            k = f'<td align=center style="color:{col}">{b(f"{ck[0]:+.1f}")}<br><small>({ck[1]:.2f} vs {ck[2]:.2f})</small></td>'
        else:
            k = GREY
        out.append(f'<tr><td style="padding:5px">{b(_md(d))}</td>{c}{o}{GREY}{diff}{k}</tr>')
    head = ('<tr style="background:#1f2a3a"><th style="padding:6px;text-align:left">시점</th><th>CFD</th>'
            '<th style="color:#f2cc60">오피넷 (한국)</th><th>MOPJ (일본)</th><th>오피넷−CFD</th>'
            '<th style="color:#7ee787">나프타−Brent<br><small>($/배럴, 크랙)</small></th></tr>')
    return ('<div class="box"><div class="t">③ 나프타 3층 비교 ($/톤) — CFD · 오피넷(한국 기준) · MOPJ(일본 실물)</div>\n'
            '<table style="width:100%;border-collapse:collapse;font-size:13px;color:#ddd">\n' + head + "\n"
            + "\n".join(static.get("table_static_rows", []) + out) + "\n</table>\n"
            + static.get("table_footnote", "") + "</div>")


def _ylim(vals, lo, hi, step):
    if not vals:
        return lo, hi
    return min(lo, (int(min(vals)) // step) * step), max(hi, (int(max(vals)) // step + 1) * step)


def render(b: dict, slot: str) -> str:
    rows = store.load_prices()
    notes = store.load_notes()
    static = store.load_static()
    now = datetime.now(ZoneInfo(config.TIMEZONE))
    slot_ko = {"AM": "아침", "PM": "저녁", "manual": "수시"}.get(slot, slot)

    brent, wti = _series(rows, "brent"), _series(rows, "wti")
    cfd, mopj, opi = _series(rows, "naphtha_cfd"), _series(rows, "mopj"), _series(rows, "opinet_naphtha_bbl")
    k = config.NAPHTHA_BBL_PER_TON
    lab_crude = lambda r, v: f"${v:.1f}" + ("(장중)" if r.get("kind") == "intraday" else "")
    c1 = [{"c": "#4a8fe8", "d": _pts(brent, lab_crude)}, {"c": "#7ee787", "d": _pts(wti, lab_crude)}]
    c2 = [{"c": "#5ac0e8", "d": _pts(cfd, lambda r, v: f"CFD ${v:,.0f}")},
          {"c": "#e8734a", "d": _pts(mopj, lambda r, v: r.get("label") or (f"~${v:,.0f}(예상)" if r.get("kind") == "forecast" else f"${v:,.0f}"))},
          {"c": "#f2cc60", "d": _pts(opi, lambda r, v: f"오피넷 ${v:,.0f}", mult=k)}]
    all_dates = [r["date"] for r in rows if r["date"].startswith(str(config.YEAR))]
    max_x = round(max([_x(d) for d in all_dates] + [now.month + (now.day - 1) / 30]) + 0.2, 2)
    months = int(max_x)
    y1 = _ylim([p[1] for s in c1 for p in s["d"]], 55, 135, 10)
    y2 = _ylim([p[1] for s in c2 for p in s["d"]], 450, 1450, 50)

    # 카드
    cards = [_crude_card(rows, "brent", "Brent"), _crude_card(rows, "wti", "WTI")]
    lc = cfd[-1] if cfd else None
    if lc:
        pv = cfd[-2]["value"] if len(cfd) > 1 else None
        ch = _pct(lc["value"], pv) if pv else None
        cards.append(_card(f"나프타 CFD({_md(lc['date'])})", f"${lc['value']:,.2f}" + (f" ({ch:+.2f}%)" if ch is not None else ""), _cls(ch)))
    lo = opi[-1] if opi else None
    if lo:
        cards.append(_card(f"오피넷 나프타({_md(lo['date'])}, 한국 기준)", f"${lo['value']:.2f}/bbl ≈ ${lo['value']*k:,.0f}/톤", "hot"))
    ck_dates = [r["date"] for r in opi if _crack(rows, r["date"])]
    if ck_dates:
        d = ck_dates[-1]
        ck = _crack(rows, d)[0]
        prev = _crack(rows, ck_dates[-2])[0] if len(ck_dates) > 1 else None
        col = "#ff7b72" if ck >= config.CRACK_SIGNAL else ("#f2cc60" if ck > -1 else "#7ee787")
        tail = f" ({_md(ck_dates[-2])} {prev:+.1f} → {'상승' if ck > prev else '하락'})" if prev is not None else ""
        cards.append(f'<div class="s"><div class="l">나프타−Brent (크랙, {_md(d)})</div>'
                     f'<div class="v" style="color:{col}">{ck:+.1f}/bbl{tail}</div></div>')

    title_date = f"{now.year}년 {now.month}월 {now.day}일"
    h1 = f"가격 리포트 — {title_date}({WEEK[now.weekday()]}) {slot_ko} · 1월~현재 전체 · " + _h.escape(b.get("headline", ""))
    sub = _h.escape(b.get("sub", ""))
    note_html = "<br>".join(clean_note(n["html"]) for n in notes)
    missing = b.get("missing") or []
    if missing:
        note_html = f'<b style="color:#e85a5a">이번 회차 미확인</b>: {_h.escape(" · ".join(missing))}<br>' + note_html

    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>가격 리포트 — {title_date} (1월~현재)</title>
<style>
{CSS}
</style></head><body>
<h1>{h1}</h1>
<div class="sub">{sub}</div>
<div class="row">
{chr(10).join(cards)}
</div>

<div class="box"><div class="t">① 원유 1월~현재 (Brent·WTI, $/배럴)</div>
<div class="lg"><span style="color:#4a8fe8">● Brent</span><span style="color:#7ee787">● WTI</span><span style="color:#e85a5a">--- $100</span></div>
{chart_svg(c1, y1[0], y1[1], '$', True, max_x, months, 1100, 380)}</div>

<div class="box"><div class="t">② 나프타 1월~현재 ($/톤)</div>
<div class="lg"><span style="color:#5ac0e8">● CFD 벤치마크(TE)</span><span style="color:#e8734a">● 아시아 실물 MOPJ(5월~ 월평균, 3월 현물)</span><span style="color:#f2cc60">● 오피넷 나프타(한국 기준, $/bbl×8.9→톤)</span></div>
{chart_svg(c2, y2[0], y2[1], '$', False, max_x, months, 1100, 340)}</div>

{_table(rows, static)}

<div class="note">
{note_html}
</div>
</body></html>"""
