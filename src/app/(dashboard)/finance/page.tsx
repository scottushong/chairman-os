import Link from 'next/link'
import { after } from 'next/server'

import { AutoList } from '@/components/finance-overview/auto-list'
import { CalendarTab } from '@/components/finance-overview/calendar-tab'
import { DailyTab } from '@/components/finance-overview/daily-tab'
import { KpiGrid } from '@/components/finance-overview/kpi-grid'
import { KpiSettingsPanel } from '@/components/finance-overview/kpi-settings'
import { NavSelect } from '@/components/finance-overview/nav-select'
import { Badge } from '@/components/finance-overview/parts'
import { PlTab } from '@/components/finance-overview/pl-tab'
import { OriginalsMenu } from '@/components/finance-overview/originals-menu'
import { SummaryTab } from '@/components/finance-overview/summary-tab'
import { FinanceView } from '@/components/finance/finance-view'
import { PlClosePanel } from '@/components/finance/pl-close-panel'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { canCloseBooks, canKeepBooks, canReadBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { ecountUploadShortcuts } from '@/lib/ecount/shortcut'
import { computeCalendar, computeDaily } from '@/lib/finance-overview/cash-days'
import { addMonths } from '@/lib/finance-overview/engine'
import { computeKpis } from '@/lib/finance-overview/kpis'
import { loadOverview } from '@/lib/finance-overview/load'
import { processRecalc } from '@/lib/finance-overview/recalc'
import { featureOn } from '@/lib/features-server'
import { plError } from '@/lib/monthly-pl/text'
import { firstParam, oneOf } from '@/lib/query'
import { getRepository } from '@/lib/repository'

/**
 * «회계 · 재무» — 재무 현황 한 곳(대표 확인 시안 2026-10-19, docs/specs/2026-10-19-finance-overview-mock/). 탭 다섯:
 *   요약 · 일별 자금보고 · 현금흐름 달력 · 손익계산서 · 12가지 지표. 회사 · 달(· 월 · 분기 · 년)은 URL에 있다(?biz · ?month · ?grain · ?tab).
 * 숫자는 0085 계산 엔진(lib/finance-overview — 순수 함수)이 사람 세션으로 읽은 자료에서 그때 계산한다(저장본은 대표 홈 · 다시 계산 큐용).
 * 권한: 장부 권한자 · 임원 이상 · 대표(0047 can_read_books — 판정은 RLS). 급여 개인 줄 · 원료별 숫자는 읽지 않는다(합계만).
 * 기능 스위치 finance_overview(0085 · 기본 전원)가 꺼지면 예전 «그룹 재무» 화면 그대로. ?view=group도 예전 화면(그룹 합산).
 * 직원 화면이다 — «회장»이 들어가지 않는다.
 */
export const maxDuration = 120

const TABS = [
  { key: 'summary', label: '요약' },
  { key: 'daily', label: '일별 자금보고' },
  { key: 'calendar', label: '현금흐름 달력' },
  { key: 'pl', label: '손익계산서' },
  { key: 'kpi', label: '12가지 지표' },
] as const

export default async function FinancePage(props: PageProps<'/finance'>) {
  const params = await props.searchParams
  const repo = await getRepository()
  const [businesses, user] = await Promise.all([repo.listBusinesses(), currentUser()])
  const active = businesses.filter((b) => b.status !== 'Archived').sort((a, b) => a.sort_order - b.sort_order)
  const readable = active.filter((b) => canReadBooks(user, b.business_id))
  const askedBiz = firstParam(params.biz)
  const business = readable.find((b) => b.business_id === askedBiz) ?? readable[0] ?? null
  const overviewOn = business ? await featureOn(user, 'finance_overview', business.business_id) : false

  if (firstParam(params.view) === 'group' || !overviewOn || !business) {
    return <LegacyGroupFinance params={params} />
  }

  await recordScreenRead({ path: '/finance', kind: 'finance', business_id: business.business_id })
  const biz = business.business_id
  const today = kstToday()
  const todayMonth = today.slice(0, 7)
  const tab = oneOf(firstParam(params.tab), TABS.map((t) => t.key)) ?? 'summary'
  const grain = oneOf(firstParam(params.grain), ['month', 'quarter', 'year'] as const) ?? 'month'
  const askedMonth = firstParam(params.month)
  // 기본 달 = 지난달(이번 달 자료는 보통 다음 달 초에 다 온다). 달력은 이번 달.
  const defaultMonth = tab === 'calendar' ? todayMonth : addMonths(todayMonth, -1)
  const period = askedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(askedMonth) ? askedMonth : defaultMonth

  // 0091 자동 판단(평가 · 귀속월 · 중복 · 원금/이자) — 스위치 finance_auto(기본 전원). 꺼지면 0089까지의 계산 그대로.
  const autoOn = await featureOn(user, 'finance_auto', biz)
  const loaded = await loadOverview(repo, biz, period, today, { auto: autoOn })
  const { ctx } = loaded
  const kpis = computeKpis(ctx, period)
  const canKeep = canKeepBooks(user, biz)
  // 원본 화면(재무제표 · 전표 · 계정과목 · 공식 결산 · 재고 · 평가 · 그룹 합산)은 «원본 보기 ›» 하나 아래에만 — 대표 · 그룹 CFO만(2026-10-20 A5).
  const top = user?.role === 'Chairman' || user?.role === 'GroupCFO'
  // 0075 내부 마감 확정 · 조정 제안 · 설정 — 예전 /finance/<회사>/monthly 아래 패널에서 손익계산서 탭 아래로(스위치 monthly_pl · 권한 그대로).
  const plClose = tab === 'pl' && (await featureOn(user, 'monthly_pl', biz)) ? await plCloseData(repo, biz, period) : null

  // 기다리는 다시 계산이 있으면 이 사람 세션으로 응답 뒤에(cron이 못 왔어도 저장본이 늦지 않게).
  if (canKeep) {
    const open = await repo.listFinRecalcJobs(biz).catch(() => [])
    if (open.some((j) => j.status === 'pending')) after(() => processRecalc(repo, { businessId: biz, limit: 1 }).then(() => undefined).catch(() => undefined))
  }

  const q = (patch: Record<string, string | null>) => {
    const base: Record<string, string | null> = { biz, month: askedMonth ?? null, tab, grain: grain === 'month' ? null : grain, ...patch }
    const s = new URLSearchParams(Object.entries(base).filter((e): e is [string, string] => !!e[1]))
    return `/finance${s.toString() ? `?${s}` : ''}`
  }
  const uploadHref = `/finance/${encodeURIComponent(biz)}/upload${tab === 'calendar' ? '' : `?month=${period}`}`
  const months = Array.from({ length: 18 }, (_, i) => addMonths(addMonths(todayMonth, tab === 'calendar' ? 3 : 0), -i))
  const got = loaded.checklist.filter((c) => c.state !== 'missing').length
  const finalMonth = false
  const last = loaded.lastUploadAt ? new Date(Date.parse(loaded.lastUploadAt) + 9 * 3_600_000).toISOString() : null

  return (
    <div className="min-h-full bg-app text-ink">
      <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-4 pt-6 pb-12 sm:px-7">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <h1 className="text-[22px] font-bold">재무 현황</h1>
          <div className="flex flex-wrap gap-2">
            <NavSelect label="회사" value={biz} options={readable.map((b) => ({ value: b.business_id, label: b.name, href: q({ biz: b.business_id }) }))} />
            {tab !== 'daily' ? <NavSelect label="달" value={period} options={(months.includes(period) ? months : [period, ...months]).map((p) => ({ value: p, label: `${p.slice(0, 4)}년 ${Number(p.slice(5, 7))}월`, href: q({ month: p }) }))} /> : null}
            {tab === 'summary' ? (
              <div className="flex overflow-hidden rounded-lg border border-line bg-card text-[14px]" role="group" aria-label="월 · 분기 · 년">
                {(
                  [
                    ['month', '월'],
                    ['quarter', '분기'],
                    ['year', '년'],
                  ] as const
                ).map(([g, l]) => (
                  <Link key={g} href={q({ grain: g === 'month' ? null : g })} aria-current={grain === g ? 'true' : undefined} className={`px-3 py-1.5 ${grain === g ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-muted'}`}>
                    {l}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2.5 text-[13px] text-ink-muted">
            {tab === 'daily' ? (
              <span>
                {today} ({'일월화수목금토'[new Date(`${today}T00:00:00Z`).getUTCDay()]}) 기준 · 자동 갱신
              </span>
            ) : tab === 'calendar' ? (
              <span>실제 = 진하게 · 예정 = 수금예정 · 지급예정 · 대출 일정에서 자동</span>
            ) : (
              <>
                <Badge final={finalMonth} />
                <span>
                  {last ? `마지막 올림 ${last.slice(5, 10)} ${last.slice(11, 16)} · ` : ''}자료 {got}/{loaded.checklist.length}
                </span>
              </>
            )}
            {canKeep ? (
              <Link href={uploadHref} className="rounded-lg bg-accent px-3.5 py-[7px] font-semibold text-on-accent hover:bg-accent/90">
                자료 올리기
              </Link>
            ) : null}
            {top ? <OriginalsMenu businessId={biz} period={period} canImport={canKeep} /> : null}
          </div>
        </div>

        <nav className="-mb-1 flex gap-1 overflow-x-auto border-b border-line whitespace-nowrap" aria-label="재무 현황">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={q({ tab: t.key === 'summary' ? null : t.key, month: t.key === 'calendar' || tab === 'calendar' ? null : askedMonth ?? null })}
              aria-current={tab === t.key ? 'page' : undefined}
              className={`shrink-0 px-4 py-2.5 text-[14px] max-sm:px-3 ${tab === t.key ? 'border-b-2 border-accent font-bold text-accent' : 'text-ink-muted hover:text-ink'}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {tab !== 'daily' && tab !== 'calendar' ? <AutoList decisions={loaded.decisions} businessId={biz} canFix={canKeep && autoOn} upload={uploadHref} /> : null}

        {tab === 'summary' ? (
          <SummaryTab
            withdraw={canKeep ? { businessId: biz } : null}
            ctx={ctx}
            period={period}
            grain={grain}
            kpis={kpis}
            checklist={loaded.checklist}
            links={{
              upload: uploadHref,
              pl: q({ tab: 'pl' }),
              calendar: q({ tab: 'calendar', month: null }),
              daily: q({ tab: 'daily' }),
              statements: top ? `/finance/${encodeURIComponent(biz)}?tab=bs&month=${period}` : null,
              customers: `/finance/${encodeURIComponent(biz)}/customers`,
              kpi: q({ tab: 'kpi' }),
            }}
          />
        ) : tab === 'daily' ? (
          <DailyTab d={computeDaily(ctx)} upload={uploadHref} />
        ) : tab === 'calendar' ? (
          <CalendarTab cal={computeCalendar(ctx, period)} />
        ) : tab === 'pl' ? (
          <div className="flex flex-col gap-4">
            <PlTab ctx={ctx} period={period} officials={loaded.officialStatements} upload={uploadHref} businessId={biz} canFix={canKeep && autoOn} selected={firstParam(params.acct) ?? null} hrefFor={(acct) => `${q({ tab: 'pl', acct, month: period })}${acct ? '#ledger' : ''}`} />
            {plClose ? (
              <PlClosePanel businessId={biz} period={period} view={plClose.view} error={plClose.error} settings={plClose.settings} canKeep={canKeep} canClose={canCloseBooks(user, biz)} isTop={top} />
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <KpiGrid kpis={kpis} title={`12가지 지표 — ${period.slice(0, 4)}년 ${Number(period.slice(5, 7))}월`} />
            <KpiSettingsPanel businessId={biz} settings={ctx.settings} canEdit={canCloseBooks(user, biz)} />
          </div>
        )}
      </div>
    </div>
  )
}

/** 예전 «그룹 재무»(5개사 단순 합산 · 손익 · 재무상태 · 현금흐름 · 출처 꼬리표) — 스위치가 꺼지면 · ?view=group. */
async function LegacyGroupFinance({ params }: { params: Record<string, string | string[] | undefined> }) {
  const repo = await getRepository()
  const [businesses, ledger, user] = await Promise.all([repo.listBusinesses(), repo.loadFinanceLedger(), currentUser()])
  const active = businesses.filter((b) => b.status !== 'Archived').sort((a, b) => a.sort_order - b.sort_order)
  const shortcuts = ecountUploadShortcuts(user, active, { withName: true })
  const tab = oneOf(firstParam(params.tab), ['is', 'bs', 'cf'] as const) ?? 'is'
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader icon="coin" title="그룹 재무" code="CH-025~027" description={`${active.length}개사 합산 · 손익계산서 · 재무상태표 · 현금흐름표 · 모든 숫자에 출처 꼬리표`}>
        <div className="m-tabs flex max-w-full flex-wrap items-center gap-1 max-sm:max-w-[calc(100vw-2rem)]">
          {shortcuts.map((s) => (
            <Link key={`ecount-${s.business_id}`} href={s.href} className={'rounded-md border border-accent/60 bg-accent/10 px-2.5 py-1.5 text-t11h font-semibold text-ink transition-colors hover:border-accent hover:bg-accent/20'}>
              {s.label}
            </Link>
          ))}
          {active.map((b) => (
            <Link key={b.business_id} href={`/finance/${encodeURIComponent(b.business_id)}`} className="rounded-md border border-line bg-panel px-2 py-1 text-t11 text-ink-dim transition-colors hover:border-accent hover:text-ink">
              {b.name}
            </Link>
          ))}
        </div>
      </PageHeader>
      <FinanceView ledger={ledger} businessIds={active.map((b) => b.business_id)} basePath="/finance" month={firstParam(params.month)} tab={tab} />
    </div>
  )
}

/** 0075 마감 · 조정 · 설정 칸이 읽는 것(예전 monthly 화면과 같다) — 읽기 실패는 문장으로(화면 전체를 깨지 않는다). */
async function plCloseData(repo: Awaited<ReturnType<typeof getRepository>>, businessId: string, period: string) {
  try {
    const [view, settings] = await Promise.all([repo.finPlMonth(businessId, period), repo.finPlSettings(businessId)])
    return { view, settings, error: view ? null : '이 기능의 DB가 아직 준비되지 않았습니다(0075 반영 전).' }
  } catch (e) {
    return { view: null, settings: null, error: plError(e) }
  }
}
