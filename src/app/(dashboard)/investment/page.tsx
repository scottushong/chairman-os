import Link from 'next/link'

import { ForecastChart } from '@/components/investment/forecast-chart'
import { ChangeBadge, DemoBanner, InvCard, Kpi, NoData, PageTitle, RecBadge, RowLink, SourceLine, StatusBadge, T, Td, Th } from '@/components/investment/ui'
import { DEMO_RADAR } from '@/lib/investment/demo'
import { day, krw, seoulDateTime, shares, usd, usdBig } from '@/lib/investment/format'
import { latestPrice } from '@/lib/investment/metrics'
import { loadMarkets } from '@/lib/investment/markets-view'
import { investmentViewer } from '@/lib/investment/screen'
import type { ScenarioInputs } from '@/lib/investment/types'
import { commonHoldings, dashboardKpis, loadRadar, sourceStatus } from '@/lib/investment/view'

export const dynamic = 'force-dynamic'

/** 1. Dashboard(원문 3) — 실측 KPI · 기관 레이더 · 미래 산업 신호 · 관심 후보 · 5년 가치 전망 · 아침 투자 브리핑 · 알림. Demo는 «Demo 보기»일 때만. */
export default async function InvestmentDashboard(props: PageProps<'/investment'>) {
  const sp = await props.searchParams
  const demo = sp.demo === '1'
  const { repo } = await investmentViewer()
  const [radar, watch, settings, runs, recs, markets, briefs, alerts] = await Promise.all([
    loadRadar(repo),
    repo.invSecurities({ watch: true }),
    repo.invSettings(),
    repo.invRuns(1),
    repo.invRecommendations({ latestOnly: true }),
    loadMarkets(repo),
    repo.invBriefs(1),
    repo.invAlerts(8),
  ])
  const buyZone = recs.length ? recs.filter((r) => r.status === 'BUY ZONE').length : null
  const kpis = dashboardKpis(radar, watch, settings, demo, buyZone)
  const common = kpis.mode === 'live' ? await commonHoldings(repo, radar) : []
  const top = common.slice(0, 8)
  const prices = await Promise.all(top.map((h) => (h.security_id ? repo.invPrices(h.security_id) : Promise.resolve([]))))
  const secById = new Map(watch.map((s) => [s.security_id, s]))
  const recOf = (id: string | null) => (id ? recs.find((r) => r.security_id === id) : undefined)
  const lastRun = runs[0] ?? null
  const v = (n: number | null) => (n === null ? 'NEED DATA' : n.toLocaleString('ko-KR'))
  const managerName = (id: string) => radar.managers.find((m) => m.manager_id === id)?.name ?? id

  // 5년 가치 전망 — Opportunity 1위 중 Base 시나리오가 있는 종목
  const ranked = [...recs].filter((r) => r.buy_price !== null).sort((a, b) => (b.opportunity_score ?? -1) - (a.opportunity_score ?? -1))
  const lead = ranked[0] ?? null
  const leadScenario = lead ? ((lead.inputs.scenarios as Record<string, ScenarioInputs | null> | undefined)?.base ?? null) : null
  const thisYear = Number((brief0Date(briefs) ?? lastRun?.started_at ?? '2026').slice(0, 4))
  const forecast =
    lead && leadScenario && leadScenario.fcf_per_share.value && leadScenario.fcf_cagr.value !== null && leadScenario.exit_multiple.value
      ? Array.from({ length: 6 }, (_, t) => ({ year: thisYear + t, value: leadScenario.fcf_per_share.value! * Math.pow(1 + leadScenario.fcf_cagr.value! / 100, t) * leadScenario.exit_multiple.value! }))
      : null

  const recent = radar.latest13F.filter((c) => c.status === 'NEW' || c.status === 'ADD' || c.status === 'TRIM')
  const bigMoves = (status: 'NEW' | 'ADD' | 'TRIM') =>
    recent
      .filter((c) => c.status === status && c.manager_id !== 'nbim')
      .sort((a, b) => Math.abs((b.cur_value ?? b.prev_value ?? 0) * (b.change_pct ?? 100)) - Math.abs((a.cur_value ?? a.prev_value ?? 0) * (a.change_pct ?? 100)))
      .slice(0, 5)
  const brief = briefs[0] ?? null
  const items = (brief?.content.items ?? {}) as Record<string, unknown>

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Investment Intelligence"
        sub="Institutional Portfolio & Future Leaders — We invest in the future, but pay for the present."
        right={
          <>
            {kpis.mode === 'demo' ? <StatusBadge status="DEMO" /> : kpis.mode === 'live' ? <StatusBadge status="LIVE" /> : <StatusBadge status="UNAVAILABLE" />}
            <span className="text-[13px] text-ink-muted">마지막 수집 {lastRun ? seoulDateTime(lastRun.finished_at ?? lastRun.started_at) : '없음'}</span>
            <Link href={demo ? '/investment' : '/investment?demo=1'} className="inline-flex min-h-11 items-center rounded-lg border border-line-soft px-3 text-[13px] text-ink-dim hover:text-ink lg:min-h-9">
              {demo ? '실측 보기' : 'Demo 보기'}
            </Link>
          </>
        }
      />
      {kpis.mode === 'demo' ? <DemoBanner>원문 3.1의 Demo 값입니다. 실측 화면은 «실측 보기».</DemoBanner> : null}
      {kpis.mode === 'empty' ? <NoData need="아직 수집된 공시가 없습니다. 데이터 상태에서 «지금 수집»을 누르거나 아침 cron을 기다립니다." href="/investment/sources" /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="추적 중인 투자기관" value={v(kpis.managers)} sub={kpis.mode === 'live' ? `최신 공시 기준일 ${day(kpis.asOf)}` : undefined} href="/investment/radar" />
        <Kpi label="분석 대상 투자 후보" value={v(kpis.candidates)} sub={kpis.mode === 'live' ? '집중투자 기관 13F 보유 + 대표 지정' : undefined} href="/investment/securities" />
        <Kpi label="새로 편입된 종목" value={v(kpis.newPositions)} sub="13F 최신 두 공시 비교" tone="ok" href="/investment/radar?status=NEW" />
        <Kpi label="보유 수량 증가 종목" value={v(kpis.added)} sub="주식 수 기준(평가액 아님)" href="/investment/radar?status=ADD" />
        <Kpi label="보유 수량 감소 종목" value={v(kpis.trimmed)} sub="분할 보정 후" tone="bad" href="/investment/radar?status=TRIM" />
        <Kpi label="매수가 도달 종목" value={v(kpis.buyZone)} sub={kpis.buyZone === null ? '추천 생성 전' : 'BUY ZONE(검증 조건 전부 통과)'} tone="ok" href="/investment/recommendations" />
        <Kpi label="월 투자 예정액" value={krw(kpis.monthlyKrw)} sub="설정값(실측 아님)" />
        <Kpi label="연간 예정 납입액" value={krw(kpis.yearlyKrw)} sub="월 × 12" />
      </div>

      <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
        <InvCard title="Investor Radar" sub="기관별 최신 두 공시 사이 순보유 변화(주식 수 · 분할 보정)" more={{ href: '/investment/radar', label: '전체 ›' }}>
          {kpis.mode === 'demo' ? (
            <T minWidth={420}>
              <thead>
                <tr><Th>기관</Th><Th>종목</Th><Th n>이전 수량</Th><Th n>현재 수량</Th><Th>변화</Th></tr>
              </thead>
              <tbody>
                {DEMO_RADAR.map((r) => (
                  <tr key={r.company}>
                    <Td>{r.manager}</Td><Td>{r.company}</Td><Td n>{shares(r.prev)}</Td><Td n>{shares(r.cur)}</Td>
                    <Td><ChangeBadge status={r.status} pct={r.pct} /></Td>
                  </tr>
                ))}
              </tbody>
            </T>
          ) : (
            <T minWidth={460}>
              <thead>
                <tr><Th>기관 · 경로</Th><Th>기준일(공개일)</Th><Th n>NEW</Th><Th n>ADD</Th><Th n>TRIM</Th><Th n>EXIT</Th><Th>상태</Th></tr>
              </thead>
              <tbody>
                {radar.pairs.filter((p) => p.source.kind === 'sec_13f' || p.source.kind === 'nbim_holdings').map((p) => (
                  <tr key={p.source.source_id}>
                    <Td><RowLink href={`/investment/radar/${p.manager.manager_id}`}>{p.manager.name}</RowLink><div className="text-[13px] text-ink-muted">{p.source.kind === 'sec_13f' ? '13F(미국분)' : '전체 목록(주식 수 없음)'}</div></Td>
                    <Td>{p.to ? `${p.to.as_of} (${p.to.primary.source_published_at ?? '공개일 없음'})` : '—'}</Td>
                    <Td n className="text-ok">{p.counts?.NEW ?? '—'}</Td>
                    <Td n>{p.source.kind === 'nbim_holdings' ? 'n/a' : (p.counts?.ADD ?? '—')}</Td>
                    <Td n className="text-critical">{p.source.kind === 'nbim_holdings' ? 'n/a' : (p.counts?.TRIM ?? '—')}</Td>
                    <Td n>{p.counts?.EXIT ?? '—'}</Td>
                    <Td><StatusBadge status={sourceStatus(p.source)} title={p.source.status_note ?? undefined} /></Td>
                  </tr>
                ))}
              </tbody>
            </T>
          )}
          <p className="text-[13px] text-ink-muted">공개된 공시 사이의 순변화만 계산합니다 — 실제 매수일 · 평균 매수가 · 거래 횟수는 공개되지 않아 만들지 않습니다.</p>
        </InvCard>

        <InvCard title="Future Market Signals" sub="Market Score(저장된 입력으로 다시 계산) — 향후 3~5년 산업 매력도" more={{ href: '/investment/markets', label: '전체 ›' }}>
          {markets.length === 0 ? (
            <NoData need="산업 자료가 없습니다(0095 전)." />
          ) : (
            <ul className="flex flex-col gap-2">
              {[...markets].sort((a, b) => (b.score.total ?? -1) - (a.score.total ?? -1)).map((m) => (
                <li key={m.market.market_id} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-2">
                  <RowLink href={`/investment/markets/${m.market.market_id}`} className="truncate text-[14px]">{m.market.name}</RowLink>
                  <div className="h-2.5 rounded-full bg-raised"><div className="h-2.5 rounded-full bg-accent" style={{ width: `${m.score.total ?? 0}%` }} /></div>
                  <span className="w-12 text-right text-[14px] font-semibold tnum">{m.score.total === null ? '—' : m.score.total.toFixed(0)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-ink-muted">요소 일부는 «AI 추정»(근거 · 출처 표시) — 산업 화면에서 대표 판단으로 덮을 수 있습니다.</p>
        </InvCard>

        <InvCard title="AI Investment Watchlist" sub="둘 이상의 기관이 함께 보유한 종목(13F) — Buy Below · Signal은 최신 추천" more={{ href: '/investment/recommendations', label: '전체 ›' }}>
          {kpis.mode === 'demo' ? (
            <NoData need="Demo 모드에서는 관심 종목 표를 그리지 않습니다(실측 보기)." />
          ) : top.length === 0 ? (
            <NoData need="공통 보유 종목이 아직 없습니다(13F 수집 뒤 — SEC_USER_AGENT 필요)." href="/investment/sources" />
          ) : (
            <T minWidth={520}>
              <thead>
                <tr><Th>종목</Th><Th>보유 기관</Th><Th n>Opportunity</Th><Th n>가격(기준일)</Th><Th n>Buy Below</Th><Th>Signal</Th></tr>
              </thead>
              <tbody>
                {top.map((h, i) => {
                  const s = h.security_id ? secById.get(h.security_id) : undefined
                  const p = latestPrice(prices[i])
                  const r = recOf(h.security_id)
                  return (
                    <tr key={h.cusip}>
                      <Td>{h.security_id ? <RowLink href={`/investment/securities/${h.security_id}`}>{s?.ticker ?? h.issuer}</RowLink> : h.issuer}<div className="max-w-[180px] truncate text-[13px] text-ink-muted">{h.issuer}</div></Td>
                      <Td>{h.managers.length}곳 · {h.managers.map(managerName).map((n) => n.split(' ')[0]).join(' · ')}</Td>
                      <Td n>{r?.opportunity_score ?? '—'}</Td>
                      <Td n>{p ? usd(p.value) : '—'}<div className="text-[13px] text-ink-muted">{p ? `${p.as_of}${p.source === 'sec13f_implied' ? ' · 13F 분기말' : ''}` : '가격 없음'}</div></Td>
                      <Td n>{r?.buy_price !== null && r?.buy_price !== undefined ? usd(r.buy_price) : 'NEED DATA'}</Td>
                      <Td>{r ? <RecBadge status={r.status} /> : <RecBadge status="NEED DATA" />}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </T>
          )}
          <p className="text-[13px] text-ink-muted">BUY ZONE은 검증된 주가 · 재무 · 가치평가 가정(출처 · 기준일 · 데이터 품질 {settings.data_quality_min} 이상)이 모두 있을 때만 붙습니다. 기관 보유는 보조 지표입니다.</p>
        </InvCard>

        <InvCard title="5Y Value Forecast" sub={lead ? `${secById.get(lead.security_id)?.ticker ?? '—'} — Base 시나리오 FCF 모델(추천 v${lead.version})` : 'Base 시나리오가 있는 추천 1위'}>
          {forecast && lead?.buy_price ? (
            <ForecastChart points={forecast} buyPrice={lead.buy_price} />
          ) : (
            <NoData need="Base 시나리오(FCF/주 · 성장률 · 배수)가 저장된 종목이 아직 없습니다 — AI Investment Engine에서 입력." href="/investment/engine" hrefLabel="AI Investment Engine" />
          )}
        </InvCard>
      </div>

      <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
        <InvCard title="Morning Investment Brief" sub={brief ? `${brief.brief_date} · 원천 최신 기준일 ${day(brief.data_as_of)} · 생성 ${seoulDateTime(brief.created_at)}${brief.model_version ? ` · AI 요약 ${brief.model_version}` : ''}` : '매일 아침(cron 06:30 KST 수집 → 분석) — 데이터가 늦으면 마지막 성공 시각을 적는다'}>
          {!brief ? (
            <NoData need="브리핑이 아직 없습니다 — «지금 분석» 또는 아침 cron." href="/investment/recommendations" hrefLabel="Recommendations" />
          ) : (
            <>
              {brief.ai_summary ? <p className="rounded-lg bg-raised px-3 py-2 text-[14px]">{brief.ai_summary}</p> : <p className="text-[13px] text-ink-muted">AI 요약 없음(AI 꺼짐 · 한도) — 아래 항목은 결정론 집계.</p>}
              <ol className="flex flex-col gap-1 text-[14px]">
                {Object.entries(items).map(([k, val]) => (
                  <li key={k} className="flex flex-wrap gap-2">
                    <span className="font-semibold text-ink-dim">{k}</span>
                    <span className="text-ink-muted">{briefText(val)}</span>
                  </li>
                ))}
              </ol>
              <p className="text-[13px] text-ink-muted">마지막 수집 성공 {seoulDateTime((brief.content.last_success as string | null) ?? null)}{(brief.content.collect_failed as string[] | undefined)?.length ? ` · 갱신 실패: ${(brief.content.collect_failed as string[]).join(' · ')}` : ''}</p>
            </>
          )}
        </InvCard>

        <InvCard title="알림" sub="공시 · 매수 기준가 접근/도달 · 상태 변화 · 갱신 실패" more={{ href: '/investment/recommendations', label: '전체 ›' }}>
          {alerts.length === 0 ? <NoData need="알림이 없습니다." /> : (
            <ul className="flex flex-col">
              {alerts.map((a) => (
                <li key={a.alert_id} className={`border-b border-line-soft/60 py-1 text-[14px] ${a.read_at ? 'opacity-60' : ''}`}>
                  {a.link ? <Link href={a.link} className="inline-flex min-h-11 items-center hover:underline lg:min-h-0">{a.title}</Link> : a.title}
                  <span className="ml-2 text-[13px] text-ink-muted">{seoulDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </InvCard>
      </div>

      {kpis.mode === 'live' ? (
        <InvCard title="최근 변화" sub="집중투자 기관(Berkshire · Fundsmith · Pershing) 13F 최신 비교 — 평가액 × 변화율이 큰 순">
          <div className="grid gap-4 lg:grid-cols-3">
            {(['NEW', 'ADD', 'TRIM'] as const).map((st) => (
              <div key={st} className="min-w-0">
                <h3 className="mb-1 text-[14px] font-semibold text-ink-dim">{st === 'NEW' ? '신규 편입' : st === 'ADD' ? '보유 수량 확대' : '보유 수량 축소'}</h3>
                <ul className="flex flex-col">
                  {bigMoves(st).map((c) => (
                    <li key={`${c.to_disclosure}${c.holding_key}`} className="flex items-center justify-between gap-2 border-b border-line-soft/60 py-1">
                      <span className="min-w-0 truncate text-[14px]">
                        {c.security_id ? <RowLink href={`/investment/securities/${c.security_id}`}>{c.issuer_name}</RowLink> : c.issuer_name}
                        <span className="text-[13px] text-ink-muted"> · {managerName(c.manager_id).split(' ')[0]}</span>
                      </span>
                      <span className="flex items-center gap-2"><span className="text-[13px] text-ink-muted tnum">{usdBig(c.cur_value ?? c.prev_value)}</span><ChangeBadge status={c.status} pct={c.change_pct} /></span>
                    </li>
                  ))}
                  {bigMoves(st).length === 0 ? <li className="text-[13px] text-ink-muted">없음</li> : null}
                </ul>
              </div>
            ))}
          </div>
          <SourceLine url="https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets" label="SEC 13F" asOf={kpis.asOf} />
          <p className="text-[13px] text-ink-muted">평가액 증가와 주식 수 증가를 구분합니다 — 판정과 % 는 주식 수 변화만 봅니다(옆의 금액은 최신 평가액).</p>
        </InvCard>
      ) : null}
    </div>
  )
}

function brief0Date(briefs: { brief_date: string }[]): string | null {
  return briefs[0]?.brief_date ?? null
}

/** 브리핑 항목 한 칸 — 배열은 앞 5개 이름, 문자열은 그대로. */
function briefText(val: unknown): string {
  if (!Array.isArray(val)) return String(val)
  if (val.length === 0) return '없음'
  return val
    .slice(0, 5)
    .map((x) => {
      if (typeof x === 'string') return x
      const o = x as { issuer?: string; manager?: string; as_of?: string; pct?: number | null; gap_pct?: number | null; security_id?: string }
      if (o.issuer) return `${o.issuer}${o.manager ? `(${o.manager})` : ''}${typeof o.pct === 'number' ? ` ${o.pct > 0 ? '+' : ''}${o.pct.toFixed(1)}%` : ''}`
      if (o.as_of) return `${o.manager ?? ''} ${o.as_of}`
      if (typeof o.gap_pct === 'number') return `${o.security_id?.slice(0, 8)} ${o.gap_pct.toFixed(1)}%`
      return JSON.stringify(x).slice(0, 40)
    })
    .join(' · ')
}
