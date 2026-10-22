"""1회 실행: 수집 → 누적 저장 → HTML 생성 → 저장.
사용: python run.py --supabase [--run-id <uuid>] [--slot AM|PM|manual]   (GitHub Actions — 결과는 Supabase RPC로만, 저장소에 커밋하지 않음)
      python run.py --dry-run sample_briefing.json --slot PM         (API · DB 없이 렌더 시험 — 로컬 파일 저장소 · public/macro/latest.html)
      python run.py --slot AM                                         (로컬 파일 저장소로 진짜 수집 — 키 필요)
"""
import argparse
import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from briefing import archive, config, render, store


def fail_briefing(now, slot, last, exc):
    return {"stamp": f"{now:%Y-%m-%d} {slot}", "headline": (last or {}).get("headline", ""),
            "sub": "이번 회차 수집 실패 — 직전 데이터 표시", "missing": [f"수집 실패: {str(exc)[:200]}"], "_failed": True}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slot", choices=["AM", "PM", "manual"])
    ap.add_argument("--dry-run", metavar="JSON", help="API 대신 저장된 브리핑 JSON 사용")
    ap.add_argument("--supabase", action="store_true", help="저장을 Supabase(0084 RPC, AI Agent 로그인)로")
    ap.add_argument("--run-id", default="", help="«지금 업데이트»가 만든 실행 기록 id(없으면 자동 회차)")
    args = ap.parse_args()

    now = datetime.now(ZoneInfo(config.TIMEZONE))
    auto_slot = "AM" if now.hour < 13 else "PM"
    slot = args.slot or ("manual" if args.run_id else auto_slot)
    prompt_slot = auto_slot if slot == "manual" else slot

    sb = run_id = None
    if args.supabase:
        from briefing import supa
        sb = supa.from_env()
        run_id = sb.rpc("price_report_agent_begin", {"p_business": config.BUSINESS_ID, "p_run": args.run_id or None, "p_slot": slot})
        try:
            n_pts, n_memo = supa.pull(sb)
            print(f"앞 데이터: 가격 {n_pts}점 · 메모 {n_memo}개")
        except Exception as exc:
            sb.rpc("price_report_agent_fail", {"p_run": run_id, "p_error": f"앞 데이터 읽기 실패: {str(exc)[:200]}"})
            raise
    last = store.load_last()

    if args.dry_run:
        with open(args.dry_run, encoding="utf-8") as f:
            briefing = json.load(f)
    else:
        from briefing import estimate
        from briefing.collect import collect
        print("비용 추정(상한값 기준 — 실제는 아래 «사용량»의 usd):\n" + estimate.table(estimate.plan_for(config.SETTINGS)))
        try:
            briefing = collect(prompt_slot, last)
        except Exception as exc:  # 실패해도 기존 데이터로 리포트 생성(«이번 회차 미확인»)
            print(f"[수집 실패] {exc}", file=sys.stderr)
            briefing = fail_briefing(now, prompt_slot, last, exc)

    try:
        store.ingest(briefing)
        html_text = render.render(briefing, slot)
        if sb:
            out = supa.push(sb, run_id, slot, f"{now:%Y-%m-%d}", briefing, html_text)
            print(f"저장: 리포트 {out['report_id']} · 바뀐 가격 {out['points']} · 새 사건 {out['new_events']}")
        else:
            out = archive.save_report(html_text, f"{now:%Y%m%d}", slot)
            if briefing.get("chat_summary"):
                (config.DATA_DIR / "chat_summary.md").write_text(briefing["chat_summary"], encoding="utf-8")
            print(f"리포트 생성: {out}")
            print(f"최신본: {config.PUBLIC_DIR / 'latest.html'}")
        if briefing.get("_usage"):
            print("사용량:", json.dumps(briefing["_usage"], ensure_ascii=False))
    except Exception as exc:
        if sb:
            sb.rpc("price_report_agent_fail", {"p_run": run_id, "p_error": str(exc)[:300]})
        raise


if __name__ == "__main__":
    main()
