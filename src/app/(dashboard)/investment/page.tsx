import Link from 'next/link'

import { ChangeBadge, DemoBanner, InvCard, Kpi, NoData, PageTitle, RowLink, SourceLine, StatusBadge, T, Td, Th } from '@/components/investment/ui'
import { DEMO_RADAR } from '@/lib/investment/demo'
import { day, krw, seoulDateTime, shares, usd, usdBig } from '@/lib/investment/format'
import { latestPrice } from '@/lib/investment/metrics'
import { investmentViewer } from '@/lib/investment/screen'
import { commonHoldings, dashboardKpis, loadRadar, sourceStatus } from '@/lib/investment/view'

export const dynamic = 'force-dynamic'

/** 1. Dashboard(원문 3) — 실측 KPI · 기관 레이더 요약 · 관심 후보 · 최근 변화. Demo는 «Demo 보기»일 때만 DEMO 띠와 함께. */
export default async function InvestmentDashboard(props: PageProps<'/investment'>) {
  const sp = await props.searchParams
  const demo = sp.demo === '1'
  const { repo } = await investmentViewer()
  const [radar, watch, settings, runs] = await Promise.all([loadRadar(repo), repo.invSecurities({ watch: true }), repo.invSettings(), repo.invRuns(1)])
  const kpis = dashboardKpis(radar, watch, settings, demo, null)
  const common = kpis.mode === 'live' ? await commonHoldings(repo, radar) : []
  const top = common.slice(0, 8)
  const prices = await Promise.all(top.map((h) => (h.security_id ? repo.invPrices(h.security_id) : Promise.resolve([]))))
  const secById = new Map(watch.map((s) => [s.security_id, s]))
  const lastRun = runs[0] ?? null
  const v = (n: number | null) => (n === null ? 'NEED DATA' : n.toLocaleString('ko-KR'))
  const managerName = (id: string) => radar.managers.find((m) => m.manager_id === id)?.name ?? id

  const recent = radar.latest13F.filter((c) => c.status === 'NEW' || c.status === 'ADD' || c.status === 'TRIM')
  const bigMoves = (status: 'NEW' | 'ADD' | 'TRIM') =>
    recent
      .filter((c) => c.status === status && c.manager_id !== 'nbim')
      .sort((a, b) => Math.abs((b.cur_value ?? b.prev_value ?? 0) * (b.change_pct ?? 100)) - Math.abs((a.cur_value ?? a.prev_value ?? 0) * (a.change_pct ?? 100)))
      .slice(0, 5)

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Investment Intelligence"
        sub="글로벌 기관 공시 · 종목 · 가치평가 — We invest in the future, but pay for the present."
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
        <Kpi label="분석 대상 투자 후보" value={v(kpis.candidates)} sub={kpis.mode === 'live' ? '집중투자 기관 13F 보유' : undefined} href="/investment/securities" />
        <Kpi label="새로 편입된 종목" value={v(kpis.newPositions)} sub="13F 최신 두 공시 비교" tone="ok" href="/investment/radar?status=NEW" />
        <Kpi label="보유 수량 증가 종목" value={v(kpis.added)} sub="주식 수 기준(평가액 아님)" href="/investment/radar?status=ADD" />
        <Kpi label="보유 수량 감소 종목" value={v(kpis.trimmed)} sub="분할 보정 후" tone="bad" href="/investment/radar?status=TRIM" />
        <Kpi label="매수가 도달 종목" value={v(kpis.buyZone)} sub={kpis.buyZone === null ? '가치평가 입력 전 — BUY 없음' : undefined} />
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

        <InvCard title="AI Investment Watchlist" sub="둘 이상의 기관이 함께 보유한 종목(13F) — 매수 기준가는 가치평가 입력 뒤" more={{ href: '/investment/securities', label: '전체 ›' }}>
          {kpis.mode === 'demo' ? (
            <NoData need="Demo 모드에서는 관심 종목 표를 그리지 않습니다(실측 보기)." />
          ) : top.length === 0 ? (
            <NoData need="공통 보유 종목이 아직 없습니다(13F 수집 뒤)." href="/investment/sources" />
          ) : (
            <T minWidth={460}>
              <thead>
                <tr><Th>종목</Th><Th>보유 기관</Th><Th n>가격(기준일)</Th><Th n>Buy Below</Th><Th>Signal</Th></tr>
              </thead>
              <tbody>
                {top.map((h, i) => {
                  const s = h.security_id ? secById.get(h.security_id) : undefined
                  const p = latestPrice(prices[i])
                  return (
                    <tr key={h.cusip}>
                      <Td>{h.security_id ? <RowLink href={`/investment/securities/${h.security_id}`}>{s?.ticker ?? h.issuer}</RowLink> : h.issuer}<div className="max-w-[180px] truncate text-[13px] text-ink-muted">{h.issuer}</div></Td>
                      <Td>{h.managers.length}곳 · {h.managers.map(managerName).map((n) => n.split(' ')[0]).join(' · ')}</Td>
                      <Td n>{p ? usd(p.value) : '—'}<div className="text-[13px] text-ink-muted">{p ? `${p.as_of}${p.source === 'sec13f_implied' ? ' · 13F 분기말 파생' : ''}` : '가격 없음'}</div></Td>
                      <Td n>NEED DATA</Td>
                      <Td><span className="rounded bg-raised px-1.5 py-0.5 text-[13px] font-bold text-ink-dim">NEED DATA</span></Td>
                    </tr>
                  )
                })}
              </tbody>
            </T>
          )}
          <p className="text-[13px] text-ink-muted">BUY ZONE은 검증된 주가 · 재무 · 가치평가 가정(출처 · 기준일 · 데이터 품질 {settings.data_quality_min} 이상)이 모두 있을 때만 붙습니다. 기관 보유는 보조 지표입니다.</p>
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
          <p className="text-[13px] text-ink-muted">평가액 증가와 주식 수 증가를 구분합니다 — 위 판정과 % 는 주식 수 변화만 봅니다(옆의 금액은 최신 평가액).</p>
        </InvCard>
      ) : null}
    </div>
  )
}
