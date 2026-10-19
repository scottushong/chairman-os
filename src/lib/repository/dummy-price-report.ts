import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  PriceCards,
  PriceEvent,
  PriceReport,
  PriceReportMeta,
  PriceRun,
} from "@/types";

import { dummyHasBusiness, dummyModuleGrants, dummyViewer } from "./dummy-org";
import type { PriceReportMethods } from "./types";

/**
 * 0084 가격 리포트의 dummy 자리. **DB(0084)가 막는 것을 여기서도 막는다**:
 *   읽기 = 대표 · 그 회사 임원 이상(GroupCFO · BusinessCEO · Executive) · '/purchasing/<회사>' 줄 · 스위치 — 아니면 0행.
 *   버튼 = 대표 · 구매 입력 줄(can_write) · 스위치 → 수집 중 잠김 · 10분 · 하루 n번(천장 12) · 30분 넘은 «대기 · 수집 중»은 실패로.
 * 리포트 html은 엔진 dry-run 결과(fixtures/price-report-sample.html — 가짜 아님: 채팅 리포트 1월~10/14 누적 값과 같은 화면).
 * 엔진 쪽(GitHub Actions)은 dummy에 없다 — 시험 · 화면 확인은 dummyPriceAgent()로 «완료 · 실패»를 흉내 낸다.
 */

type StoredReport = PriceReport;

const SAMPLE_CARDS: PriceCards = {
  brent: { date: "2026-10-14", value: 106.0, kind: "intraday" },
  dubai: { date: "2026-10-13", value: 104.71, kind: "settle" },
  wti: { date: "2026-10-14", value: 94.14, kind: "settle" },
  naphtha_cfd: { date: "2026-10-13", value: 891.0, kind: "settle" },
  opinet_naphtha_bbl: { date: "2026-10-13", value: 105.27, kind: "settle" },
  crack: { date: "2026-10-13", value: -0.4 },
};

interface Store {
  reports: StoredReport[];
  events: (PriceEvent & { business_id: string })[];
  runs: (PriceRun & { business_id: string })[];
}

// globalThis에 둔다 — webpack dev는 Server Action 층과 화면 층이 모듈을 따로 읽어 저장소가 둘이 된다(dummy-org.ts와 같은 이유).
const G = globalThis as { __dummyPriceReport?: Store | null };

function sampleHtml(): string {
  try {
    return readFileSync(
      join(
        process.cwd(),
        "src",
        "lib",
        "repository",
        "fixtures",
        "price-report-sample.html",
      ),
      "utf8",
    );
  } catch {
    return '<!DOCTYPE html><html lang="ko"><body style="background:#0b0d12;color:#e8e8e8;font-family:sans-serif;padding:16px"><h1>가격 리포트(견본)</h1><p>견본 파일이 없습니다.</p></body></html>';
  }
}

function s(): Store {
  if (G.__dummyPriceReport) return G.__dummyPriceReport;
  const at = "2026-10-14T09:05:00.000Z";
  const runId = "00000000-0000-4000-8000-0000000082a1";
  const store: Store = {
    reports: [
      {
        report_id: "00000000-0000-4000-8000-0000000082b1",
        business_id: "biz_dy",
        report_date: "2026-10-14",
        slot: "PM",
        status: "ok",
        created_at: at,
        missing: [],
        cards: SAMPLE_CARDS,
        headline:
          "Brent $106 공방 · 아람코 다란 «제한적 화재» · 내일(10/15) IEA 이사회",
        run_id: runId,
        html: sampleHtml(),
        chat_summary_md: null,
      },
    ],
    events: [
      {
        business_id: "biz_dy",
        event_id: 2,
        event_date: "2026-10-14",
        title: "아람코 다란 «제한적 화재» — 생산 영향 미보고",
        url: "https://example.invalid/aramco",
        source: "견본",
        first_slot: "PM",
        first_run: runId,
        first_seen_at: at,
      },
      {
        business_id: "biz_dy",
        event_id: 1,
        event_date: "2026-10-13",
        title: "사우디 9월 증산(+1/3) vs 호르무즈 공격",
        url: null,
        source: "견본",
        first_slot: "AM",
        first_run: null,
        first_seen_at: "2026-10-13T23:05:00.000Z",
      },
    ],
    runs: [
      {
        business_id: "biz_dy",
        run_id: runId,
        trigger: "auto",
        slot: "PM",
        requested_by: null,
        status: "done",
        created_at: "2026-10-14T09:00:00.000Z",
        started_at: "2026-10-14T09:00:30.000Z",
        finished_at: at,
        error: null,
        report_id: "00000000-0000-4000-8000-0000000082b1",
        new_events: 1,
        points: 3,
      },
    ],
  };
  G.__dummyPriceReport = store;
  return store;
}

/** 시험 전용 — 처음 상태로. */
export function resetDummyPriceReport() {
  G.__dummyPriceReport = null;
}

const EXEC = ["Chairman", "GroupCFO", "BusinessCEO", "Executive"];

function reader(businessId: string): boolean {
  const v = dummyViewer();
  if (!dummyHasBusiness(v, businessId)) return false;
  return (
    EXEC.includes(v.role) ||
    dummyModuleGrants(v.user_id).some(
      (m) => m.module === `/purchasing/${businessId}`,
    )
  );
}

function requester(businessId: string): boolean {
  const v = dummyViewer();
  if (!dummyHasBusiness(v, businessId)) return false;
  return (
    v.role === "Chairman" ||
    dummyModuleGrants(v.user_id).some(
      (m) => m.module === `/purchasing/${businessId}` && m.can_write,
    )
  );
}

const kstDate = (iso: string) =>
  new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);

function expire(businessId: string, now: number) {
  for (const r of s().runs) {
    if (
      r.business_id === businessId &&
      (r.status === "queued" || r.status === "collecting") &&
      Date.parse(r.created_at) < now - 30 * 60_000
    ) {
      r.status = "failed";
      r.finished_at = new Date(now).toISOString();
      r.error = r.error ?? "30분 안에 끝나지 않음(멈춘 것으로 봄)";
    }
  }
}

export function dummyPriceReport(deps: {
  featureOn(businessId: string): Promise<boolean>;
  now?: () => number;
}): PriceReportMethods {
  const now = () => (deps.now ? deps.now() : Date.now());
  const canRead = async (b: string) => reader(b) && (await deps.featureOn(b));
  return {
    async listPriceReports(businessId, limit = 60) {
      if (!(await canRead(businessId))) return [];
      return s()
        .reports.filter((r) => r.business_id === businessId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((r) => {
          const m: Partial<StoredReport> = { ...r };
          delete m.html;
          delete m.chat_summary_md;
          return m as PriceReportMeta;
        });
    },
    async getPriceReport(businessId, reportId) {
      if (!(await canRead(businessId))) return null;
      const list = s()
        .reports.filter((r) => r.business_id === businessId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const r = reportId ? list.find((x) => x.report_id === reportId) : list[0];
      return r ? { ...r } : null;
    },
    async listPriceEvents(businessId, limit = 40) {
      if (!(await canRead(businessId))) return [];
      return s()
        .events.filter((e) => e.business_id === businessId)
        .sort(
          (a, b) =>
            b.first_seen_at.localeCompare(a.first_seen_at) ||
            b.event_id - a.event_id,
        )
        .slice(0, limit)
        .map((e): PriceEvent => ({
          event_id: e.event_id,
          event_date: e.event_date,
          title: e.title,
          url: e.url,
          source: e.source,
          first_slot: e.first_slot,
          first_run: e.first_run,
          first_seen_at: e.first_seen_at,
        }));
    },
    async listPriceRuns(businessId, limit = 20) {
      if (!(await canRead(businessId))) return [];
      return s()
        .runs.filter((r) => r.business_id === businessId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((r) => {
          const o: Partial<typeof r> = { ...r };
          delete o.business_id;
          return o as PriceRun;
        });
    },
    async priceReportRequest(businessId, perDay) {
      if (!requester(businessId) || !(await deps.featureOn(businessId)))
        throw new Error("price_report_denied");
      const t = now();
      expire(businessId, t);
      const runs = s().runs.filter((r) => r.business_id === businessId);
      if (runs.some((r) => r.status === "queued" || r.status === "collecting"))
        throw new Error("price_report_busy");
      if (runs.some((r) => Date.parse(r.created_at) > t - 10 * 60_000))
        throw new Error("price_report_too_soon");
      const cap = Math.min(Math.max(Math.floor(perDay) || 6, 1), 12);
      const today = kstDate(new Date(t).toISOString());
      if (
        runs.filter(
          (r) => r.trigger === "manual" && kstDate(r.created_at) === today,
        ).length >= cap
      )
        throw new Error("price_report_daily_limit");
      const run = {
        business_id: businessId,
        run_id: randomUUID(),
        trigger: "manual" as const,
        slot: "manual" as const,
        requested_by: dummyViewer().user_id,
        status: "queued" as const,
        created_at: new Date(t).toISOString(),
        started_at: null,
        finished_at: null,
        error: null,
        report_id: null,
        new_events: null,
        points: null,
      };
      s().runs.push(run);
      return run.run_id;
    },
    async priceReportDispatchFailed(runId, message) {
      const r = s().runs.find(
        (x) =>
          x.run_id === runId &&
          x.requested_by === dummyViewer().user_id &&
          x.status === "queued",
      );
      if (!r) return false;
      r.status = "failed";
      r.finished_at = new Date(now()).toISOString();
      r.error = (message.trim() || "자동 실행을 부르지 못함").slice(0, 300);
      return true;
    },
  };
}

/**
 * 엔진 흉내(시험 · dummy 화면) — GitHub Actions가 하는 일을 dummy 저장소에 한다. 사건은 같은 제목 · 링크면 한 번만(0084와 같은 열쇠).
 */
export function dummyPriceAgent() {
  const key = (t: string, u: string | null) =>
    `${t.trim().replace(/\s+/g, "").toLowerCase()}|${(u ?? "").toLowerCase()}`;
  return {
    begin(runId: string) {
      const r = s().runs.find(
        (x) => x.run_id === runId && x.status === "queued",
      );
      if (!r) throw new Error("price_report_run_state");
      r.status = "collecting";
      r.started_at = new Date().toISOString();
    },
    complete(
      runId: string,
      o: {
        events?: { title: string; url?: string | null; date?: string }[];
        status?: "ok" | "unconfirmed";
        missing?: string[];
        html?: string;
      },
    ) {
      const r = s().runs.find((x) => x.run_id === runId);
      if (!r || r.status !== "collecting")
        throw new Error("price_report_run_state");
      let fresh = 0;
      for (const e of o.events ?? []) {
        if (
          s().events.some(
            (x) =>
              x.business_id === r.business_id &&
              key(x.title, x.url) === key(e.title, e.url ?? null),
          )
        )
          continue;
        s().events.push({
          business_id: r.business_id,
          event_id: Math.max(0, ...s().events.map((x) => x.event_id)) + 1,
          event_date: e.date ?? null,
          title: e.title,
          url: e.url ?? null,
          source: null,
          first_slot: r.slot,
          first_run: r.run_id,
          first_seen_at: new Date().toISOString(),
        });
        fresh += 1;
      }
      const prev = s()
        .reports.filter((x) => x.business_id === r.business_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const report: StoredReport = {
        report_id: randomUUID(),
        business_id: r.business_id,
        report_date: kstDate(new Date().toISOString()),
        slot: r.slot,
        status: o.status ?? "ok",
        created_at: new Date().toISOString(),
        missing: o.missing ?? [],
        cards: prev?.cards ?? SAMPLE_CARDS,
        headline: prev?.headline ?? null,
        run_id: r.run_id,
        html: o.html ?? prev?.html ?? sampleHtml(),
        chat_summary_md: null,
      };
      s().reports.push(report);
      Object.assign(r, {
        status: "done",
        finished_at: new Date().toISOString(),
        report_id: report.report_id,
        new_events: fresh,
        points: 0,
      });
      return { report_id: report.report_id, new_events: fresh };
    },
    fail(runId: string, error: string) {
      const r = s().runs.find(
        (x) =>
          x.run_id === runId &&
          (x.status === "queued" || x.status === "collecting"),
      );
      if (!r) return false;
      Object.assign(r, {
        status: "failed",
        finished_at: new Date().toISOString(),
        error: error.slice(0, 300),
      });
      return true;
    },
    /** 시험 — 실행 기록 시각을 앞당긴다(10분 · 30분 규칙). */
    age(runId: string, minutes: number) {
      const r = s().runs.find((x) => x.run_id === runId);
      if (r)
        r.created_at = new Date(
          Date.parse(r.created_at) - minutes * 60_000,
        ).toISOString();
    },
  };
}
