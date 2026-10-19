"""리포트 저장(연/월 아카이브 + public 최신본) 및 아카이브 목록 index.html 생성."""
import html
import re
import shutil
from pathlib import Path

from . import config

PATTERN = re.compile(r"price_report_(\d{8})_(AM|PM)\.html$")


def save_report(html_text: str, date_str: str, slot: str) -> Path:
    """date_str: YYYYMMDD"""
    month_dir = config.REPORTS_DIR / date_str[:4] / date_str[4:6]
    month_dir.mkdir(parents=True, exist_ok=True)
    name = f"price_report_{date_str}_{slot}.html"
    out = month_dir / name
    out.write_text(html_text, encoding="utf-8")

    # public 쪽: 최신본 + 아카이브 사본(웹에서 열람용)
    pub_month = config.PUBLIC_DIR / "archive" / date_str[:4] / date_str[4:6]
    pub_month.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(out, pub_month / name)
    shutil.copyfile(out, config.PUBLIC_DIR / "latest.html")
    build_index()
    return out


def build_index():
    files = sorted(config.REPORTS_DIR.rglob("price_report_*.html"), reverse=True)
    rows, current_month = [], None
    for f in files:
        m = PATTERN.search(f.name)
        if not m:
            continue
        d, slot = m.group(1), m.group(2)
        month = f"{d[:4]}년 {d[4:6]}월"
        if month != current_month:
            rows.append(f"<h2>{month}</h2>")
            current_month = month
        href = f"archive/{d[:4]}/{d[4:6]}/{f.name}"
        rows.append(f'<a class="item" href="{html.escape(href)}">{d[:4]}-{d[4:6]}-{d[6:]} '
                    f'<span class="{slot}">{slot}</span></a>')
    page = f"""<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>거시 브리핑 아카이브</title>
<style>body{{background:#0b0d12;color:#e8e8e8;font-family:'Malgun Gothic',sans-serif;max-width:800px;margin:0 auto;padding:16px}}
h1{{font-size:19px}}h2{{font-size:14px;color:#8ab4f8;margin-top:20px}}
.item{{display:block;background:#12151c;border-radius:8px;padding:10px 14px;margin:6px 0;color:#e8e8e8;text-decoration:none}}
.item:hover{{background:#1b2030}}.AM{{color:#f6c25b}}.PM{{color:#5ac0e8}}.top{{color:#7ee787}}</style></head><body>
<h1>거시 브리핑 아카이브</h1><a class="item top" href="latest.html">▶ 최신 리포트 보기</a>
{''.join(rows) or '<p>아직 리포트 없음</p>'}</body></html>"""
    config.PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    (config.PUBLIC_DIR / "index.html").write_text(page, encoding="utf-8")
