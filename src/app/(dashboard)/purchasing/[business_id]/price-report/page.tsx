import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { PriceReportBar } from "@/components/purchasing/price-report-bar";
import { PriceReportFrame } from "@/components/purchasing/price-report-frame";
import { PurchasingNav } from "@/components/purchasing/purchasing-nav";
import { recordScreenRead } from "@/lib/activity-record";
import { currentUser } from "@/lib/auth/session";
import { featureOn } from "@/lib/features-server";
import { dispatchReady } from "@/lib/price-report/dispatch";
import {
  buttonLock,
  canReadPriceReport,
  canRequestPriceReport,
  kstLabel,
  liveRun,
  manualPerDay,
  nextAutoKst,
  SLOT_KO,
} from "@/lib/price-report/rules";
import { getRepository } from "@/lib/repository";
import type {
  PriceEvent,
  PriceReport,
  PriceReportMeta,
  PriceRun,
} from "@/types";

/**
 * DY 구매팀 가격 리포트(0084) — /purchasing/<회사>/price-report. 엔진(macro/engine)이 하루 2번(08 · 18시 KST) + «지금 업데이트»로 만든
 * html을 그대로(채팅 리포트와 같은 화면) 스크립트를 막은 sandbox로 보인다. 날짜 · 회차를 골라 지난 리포트도.
 * 문: 스위치 purchase_price_report · 대표 · 임원 이상 · 구매 줄(안내 — 문은 DB 표 RLS). 아니면 404. 대표 홈에는 넣지 않는다.
 */
export default async function PriceReportPage(
  props: PageProps<"/purchasing/[business_id]/price-report">,
) {
  const { business_id } = await props.params;
  const sp = await props.searchParams;
  const pick =
    typeof sp.r === "string" && /^[0-9a-f-]{36}$/i.test(sp.r) ? sp.r : null;
  const [repo, user] = await Promise.all([getRepository(), currentUser()]);
  const business = (await repo.listBusinesses()).find(
    (b) => b.business_id === business_id,
  );
  if (
    !business ||
    !user ||
    !canReadPriceReport(user, business_id) ||
    !(await featureOn(user, "purchase_price_report", business_id))
  )
    notFound();
  await recordScreenRead({
    path: `/purchasing/${business_id}/price-report`,
    kind: "page",
    business_id,
  });

  // 0084 전 DB면 'price_report_unavailable' — 화면은 «준비 중». 다른 오류는 빈 화면(로그만).
  const data = await Promise.all([
    repo.listPriceReports(business_id, 60),
    repo.getPriceReport(business_id, pick),
    repo.listPriceEvents(business_id, 40),
    repo.listPriceRuns(business_id, 30),
  ]).then(
    ([reports, report, events, runs]) => ({
      unavailable: false,
      reports,
      report,
      events,
      runs,
    }),
    (e: unknown) => {
      if (!(e instanceof Error && e.message === "price_report_unavailable"))
        console.error(
          "[price-report]",
          e instanceof Error ? e.message : String(e),
        );
      return {
        unavailable:
          e instanceof Error && e.message === "price_report_unavailable",
        reports: [] as PriceReportMeta[],
        report: null as PriceReport | null,
        events: [] as PriceEvent[],
        runs: [] as PriceRun[],
      };
    },
  );
  const { unavailable, reports, report, events, runs } = data;
  const latest = reports[0] ?? null;
  const live = liveRun(runs);
  const perDay = manualPerDay();
  const canRequest = canRequestPriceReport(user, business_id);
  const lastFail = runs[0]?.status === "failed" ? runs[0] : null;
  // «새로» — 보고 있는 리포트를 만든 실행이 처음 본 사건.
  const freshRun = report?.run_id ?? null;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="cart"
        title={`${business.name} 가격 리포트`}
        code="PRICE-R1"
        description="오피넷 정산가 · 나프타 · 장중가 · 사건 메모 · 크랙 — 하루 2번 자동(08 · 18시) + «지금 업데이트»"
      >
        <PurchasingNav businessId={business_id} current="price-report" />
      </PageHeader>

      {unavailable ? (
        <p className="mt-4 rounded-md bg-panel px-3 py-2 text-t12 text-ink-dim">
          가격 리포트가 아직 준비 중입니다(DB 반영 전).
        </p>
      ) : (
        <>
          <PriceReportBar
            businessId={business_id}
            last={
              latest
                ? {
                    label: kstLabel(latest.created_at),
                    slot: SLOT_KO[latest.slot] ?? latest.slot,
                    status: latest.status,
                  }
                : null
            }
            nextAuto={nextAutoKst().label}
            canRequest={canRequest}
            ready={dispatchReady()}
            lock={buttonLock(runs, perDay)}
            liveRunId={live?.run_id ?? null}
          />
          {lastFail ? (
            <p
              className="mt-2 text-t11h text-critical"
              data-testid="price-report-last-fail"
            >
              마지막 실행 실패({kstLabel(lastFail.created_at)} ·{" "}
              {lastFail.trigger === "manual" ? "수동" : "자동"}) —{" "}
              {lastFail.error ?? "이유 모름"} · 아래는 직전 리포트입니다.
            </p>
          ) : null}

          {reports.length ? (
            <form
              method="get"
              className="mt-3 flex flex-wrap items-center gap-2 text-t12"
            >
              <label htmlFor="r" className="text-ink-muted">
                지난 리포트
              </label>
              <select
                id="r"
                name="r"
                defaultValue={report?.report_id ?? ""}
                className="max-w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12"
              >
                {reports.map((r) => (
                  <option key={r.report_id} value={r.report_id}>
                    {r.report_date} {SLOT_KO[r.slot] ?? r.slot} ·{" "}
                    {kstLabel(r.created_at)}
                    {r.status === "unconfirmed" ? " · 미확인" : ""}
                  </option>
                ))}
              </select>
              <button className="min-h-10 rounded-md border border-line px-3 text-ink-dim hover:border-accent lg:min-h-0 lg:py-1">
                보기
              </button>
            </form>
          ) : null}

          {report?.status === "unconfirmed" && report.missing.length ? (
            <p
              className="mt-2 rounded-md bg-gold/10 px-3 py-2 text-t11h text-ink-dim"
              data-testid="price-report-unconfirmed"
            >
              <span className="font-semibold text-gold">이번 회차 미확인</span>{" "}
              — {report.missing.join(" · ")}. 표시된 값은 직전에 확인된
              데이터입니다.
            </p>
          ) : null}

          <div className="mt-3">
            {report ? (
              <PriceReportFrame
                html={report.html}
                title={`가격 리포트 ${report.report_date} ${SLOT_KO[report.slot] ?? report.slot}`}
              />
            ) : (
              <p className="rounded-xl border border-line-soft bg-panel px-4 py-10 text-center text-t13 text-ink-dim">
                아직 리포트가 없습니다 — 다음 자동 회차({nextAutoKst().label})에
                만들어집니다.
              </p>
            )}
          </div>

          <section
            className="mt-4 rounded-xl border border-line-soft bg-panel p-3"
            aria-labelledby="ev-h"
            data-testid="price-events"
          >
            <h2 id="ev-h" className="text-t13 font-semibold">
              사건 · 뉴스{" "}
              <span className="text-t11h font-normal text-ink-muted">
                최근 순 · 같은 제목 · 링크는 한 번만
              </span>
            </h2>
            {events.length === 0 ? (
              <p className="mt-2 text-t11h text-ink-muted">아직 없습니다.</p>
            ) : null}
            <ul className="mt-2 divide-y divide-line-soft">
              {events.map((e) => (
                <li
                  key={e.event_id}
                  className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-t12"
                >
                  {freshRun && e.first_run === freshRun ? (
                    <span className="rounded bg-accent/15 px-1.5 text-t10 font-semibold text-accent">
                      새로
                    </span>
                  ) : null}
                  <span className="tnum text-ink-muted">
                    {e.event_date ?? kstLabel(e.first_seen_at).split(" ")[0]}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{e.title}</span>
                  {e.url ? (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-t11h text-accent hover:underline"
                    >
                      {e.source || "출처"}
                    </a>
                  ) : e.source ? (
                    <span className="text-t11h text-ink-muted">{e.source}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <p className="mt-3 text-t10h text-ink-muted">
            가격 출처: 오피넷(정산 · 한국 기준 나프타 $/bbl) ·
            TradingEconomics(장중 CFD) — 수집이 실패하면 직전 값과 «이번 회차
            미확인»을 보입니다. 원가 엔진 원료 시세에는 들어가지 않습니다.
          </p>
        </>
      )}
    </div>
  );
}
