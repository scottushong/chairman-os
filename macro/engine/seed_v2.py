"""1회만 실행: 채팅에서 쌓은 1월~10/14 데이터(가격·③표 고정행·사건 메모)를 v2 저장소로 옮김.
사용: python seed_v2.py          (기존 data/prices.json·notes.json·static.json 덮어씀)
"""
import json
from pathlib import Path

from briefing import config

seed = json.loads((Path(__file__).parent / "data" / "seed_v2.json").read_text(encoding="utf-8"))
config.DATA_DIR.mkdir(parents=True, exist_ok=True)
(config.DATA_DIR / "prices.json").write_text(json.dumps(seed["prices"], ensure_ascii=False, indent=1), encoding="utf-8")
(config.DATA_DIR / "notes.json").write_text(json.dumps(seed["notes"], ensure_ascii=False, indent=1), encoding="utf-8")
(config.DATA_DIR / "static.json").write_text(json.dumps(
    {"table_static_rows": seed["table_static_rows"], "table_footnote": seed["table_footnote"]},
    ensure_ascii=False, indent=1), encoding="utf-8")
print(f"가격 {len(seed['prices'])}개, ③표 고정행 {len(seed['table_static_rows'])}개, 메모 {len(seed['notes'])}개 저장 완료")
