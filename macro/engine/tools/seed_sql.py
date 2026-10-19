"""seed_v2.json(1월~10/14 가격 · 사건 메모) → 0084 마이그레이션의 한 번짜리 적재 SQL.

사용: python macro/engine/tools/seed_sql.py > (출력을 0084 «적재» 절에 붙인다)
같은 줄이 이미 있으면 건너뛴다(on conflict do nothing) — 두 번 돌아도 늘지 않는다.
"""
import json
import sys
from pathlib import Path

seed = json.loads((Path(__file__).resolve().parent.parent / "data" / "seed_v2.json").read_text(encoding="utf-8"))


def q(v):
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return repr(float(v))
    return "'" + str(v).replace("'", "''") + "'"


rows = [f"  ('biz_dy', {q(p['series'])}, {q(p['date'])}::date, {q(p['value'])}, {q(p['kind'])}, {q(p.get('source') or '')}, {q(p.get('label'))})" for p in seed["prices"]]
out = ["insert into purchase_price_points (business_id, series, point_date, value, kind, source, label)",
       "select v.* from (values", ",\n".join(rows), ") as v(business_id, series, point_date, value, kind, source, label)",
       "where exists (select 1 from businesses b where b.business_id = 'biz_dy')",
       "on conflict do nothing;", ""]
for n in seed["notes"]:
    out += ["insert into purchase_price_events (business_id, kind, event_date, title, html, dedupe_key, first_slot)",
            f"select 'biz_dy', 'memo', {q(n['stamp'][:10])}::date, {q(n['stamp'])}, {q(n['html'])}, 'memo:' || {q(n['stamp'])}, 'seed'",
            "where exists (select 1 from businesses b where b.business_id = 'biz_dy')",
            "on conflict do nothing;", ""]
sys.stdout.reconfigure(encoding="utf-8")
print("\n".join(out))
