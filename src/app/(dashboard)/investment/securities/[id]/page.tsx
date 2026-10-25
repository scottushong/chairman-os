import { notFound } from 'next/navigation'

import { MetricForm, SplitForm, WatchToggle } from '@/components/investment/forms'
import { PriceChart, type ChartEvent } from '@/components/investment/price-chart'
import { ChangeBadge, InvCard, Kpi, NoData, PageTitle, SourceLine, StatusBadge, T, Td, Th } from '@/components/investment/ui'
import { DASH, day, pct, shares, times, usd, usdBig } from '@/lib/investment/format'
import { annualRows, computeMetrics, latestPrice, quarterRows, sharesOutstanding, type FinRow } from '@/lib/investment/metrics'
import { investmentViewer } from '@/lib/investment/screen'
import { institutionalRows } from '@/lib/investment/view'

export const dynamic = 'force-dynamic'

/** Stock & ETF 360 한 종목(원문 5) — 현재가 · 매수 기준가 · 그래프 · 기관 보유 4분기 · 재무 · (ETF) 운용 정보. */
export default async function SecurityPage(props: PageProps<'/investment/securities/[id]'>) {
  const { id } = await props.params
  const { repo, admin } = await investmentViewer()
  const s = await repo.invSecurity(id)
  if (!s) notFound()
  const [prices, actions, facts, metricsRows, etf, positions, changes, disclosures, managers, securities, settings, recs] = await Promise.all([
    repo.invPrices(id),
    repo.invActions(id),
    repo.invFacts(id),
    repo.invMetrics(id),
    repo.invEtfHoldings(id),
    repo.invSecurityPositions(id),
    repo.invChanges({ securityId: id }),
    repo.invDisclosures(),
    repo.invManagers(),
    repo.invSecurities(),
    repo.invSettings(),
    repo.invRecommendations({ securityId: id }),
  ])
  const rec = recs[0] ?? null
  const vals = (rec?.inputs.valuations ?? {}) as Partial<Record<'bear' | 'base' | 'bull', { futurePrice: number; presentValue: number; buyPrice: number; upsidePct: number }>>
  const baseV = vals.base ?? null
  const scorePart = (k: 'market' | 'leader') => (rec?.inputs[k] as { aiEstimated?: boolean } | null | undefined)?.aiEstimated ?? false
  const fxSec = securities.find((x) => x.kind === 'fx' && x.ticker === 'USDKRW')
  const bench = securities.find((x) => x.kind === 'etf' && x.ticker === (s.benchmark_ticker ?? (s.kind === 'etf' ? 'ACWI' : 'SPY')))
  const [fx, benchPrices] = await Promise.all([fxSec ? repo.invPrices(fxSec.security_id) : Promise.resolve([]), bench && bench.security_id !== id ? repo.invPrices(bench.security_id) : Promise.resolve([])])
  const so = sharesOutstanding(facts)
  const m = computeMetrics(facts, prices, so?.value ?? null)
  const price = latestPrice(prices)
  const daily = prices.filter((p) => p.source === 'twelvedata' || p.source === 'manual')
  const prevDaily = daily.at(-2)
  const inst = institutionalRows(managers, disclosures, positions, changes)
  const instTotals = new Map<string, number>()
  for (const r of inst) for (const p of r.points) if (p.shares) instTotals.set(p.as_of, (instTotals.get(p.as_of) ?? 0) + p.shares)
  const filed = [...new Set(facts.filter((f) => f.form === '10-K' || f.form === '10-Q' || f.form === '20-F').map((f) => `${f.filed}|${f.form}`))].map((x) => x.split('|'))
  const events: ChartEvent[] = [
    ...filed.filter(([d]) => d).map(([d, form]) => ({ d, kind: 'earnings' as const, label: `${form} 공시` })),
    ...actions.map((a) => ({ d: a.ex_date, kind: a.kind === 'split' ? ('split' as const) : ('dividend' as const), label: a.kind === 'split' ? `분할 ×${a.ratio}` : `배당 ${a.amount}` })),
  ]
  const annual = annualRows(facts)
  const quarters = quarterRows(facts)
  const metric = (k: string) => metricsRows.filter((x) => x.metric === k).sort((a, b) => a.as_of.localeCompare(b.as_of)).at(-1) ?? null
  const ccy = m.currency
  const money = (v: number | null) => (ccy === 'USD' ? usdBig(v) : v === null ? DASH : `${(v / 1e9).toFixed(2)}B ${ccy}`)
  const short = (mid: string) => managers.find((x) => x.manager_id === mid)?.name.split(' ')[0] ?? mid
  const pricesStatus = daily.length ? 'LIVE' : price ? 'PARTIAL' : 'UNAVAILABLE'

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title={`${s.ticker ? `${s.ticker} · ` : ''}${s.name}`}
        sub={`Stock & ETF 360 · ${s.kind === 'etf' ? 'ETF' : '주식'} · ${[s.exchange && s.exchange !== 'UNMAPPED' ? s.exchange : null, s.sector, s.cusip ? `CUSIP ${s.cusip}` : null, s.figi ? `FIGI ${s.figi}` : null, s.cik ? `CIK ${s.cik}` : null].filter(Boolean).join(' · ')}`}
        right={
          <>
            <StatusBadge status={pricesStatus} title="가격" />
            <StatusBadge status={facts.length ? 'LIVE' : s.kind === 'etf' ? 'PARTIAL' : 'UNAVAILABLE'} title="재무" />
          </>
        }
      />
      <p className="text-[13px] text-ink-muted">{s.watch ? `관심 후보 — ${s.watch_reason ?? ''}` : '관심 후보 아님'}</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Current Price"
          value={price ? usd(price.value) : 'NEED DATA'}
          sub={price ? `${price.as_of} · ${price.source === 'sec13f_implied' ? '13F 분기말 파생(일별 아님)' : price.source === 'twelvedata' ? 'Twelve Data 일봉' : '손 입력'}${prevDaily && price.source === 'twelvedata' ? ` · 전일비 ${pct(((price.value - prevDaily.close) / prevDaily.close) * 100, 2, true)}` : ''}` : '가격 경로 없음'}
        />
        <Kpi label="Buy Below" value={rec?.buy_price !== null && rec?.buy_price !== undefined ? usd(rec.buy_price) : 'NEED DATA'} sub={rec?.buy_price !== null && rec?.buy_price !== undefined ? `현재가 대비 ${pct(rec.gap_pct, 1, true)} · Base 5년 모델` : '가치평가 가정(FCF/주 · 성장률 · 배수 · 요구수익률 · 안전마진) 입력 전'} href={`/investment/engine?security=${s.security_id}`} />
        <Kpi label="Opportunity Score" value={rec?.opportunity_score !== null && rec?.opportunity_score !== undefined ? `${rec.opportunity_score} / 100` : 'NEED DATA'} sub={rec ? `데이터 품질 ${rec.data_quality ?? '—'} · 추천 v${rec.version}` : 'Market · Leader · Valuation 점수 전'} tone="ok" href={`/investment/engine?security=${s.security_id}`} />
        <Kpi label="Risk State" value={rec?.status ?? 'NEED DATA'} sub={`BUY는 검증 입력이 모두 LIVE · 품질 ${settings.data_quality_min} 이상일 때만`} tone={rec?.status === 'BUY ZONE' ? 'ok' : rec?.status === 'THESIS BROKEN' || rec?.status === 'OVERVALUED' ? 'bad' : 'warn'} href={`/investment/recommendations?security=${s.security_id}`} />
      </div>

      <InvCard title="Price vs Fair Value" sub="기간 · 겹쳐 보기 · KRW 환산(ECB 기준환율). 일별 주가가 없으면 13F 분기말 파생 점만 — 없는 날을 채우지 않는다.">
        <PriceChart
          daily={daily.map((p) => ({ d: p.d, close: p.close, adj: p.adj_close, volume: p.volume }))}
          quarterly={prices.filter((p) => p.source === 'sec13f_implied').map((p) => ({ d: p.d, close: p.close, adj: null, volume: null }))}
          benchmark={bench && benchPrices.some((p) => p.source === 'twelvedata') ? { ticker: bench.ticker ?? '', points: benchPrices.filter((p) => p.source === 'twelvedata').map((p) => ({ d: p.d, close: p.close, adj: p.adj_close, volume: p.volume })) } : null}
          fx={fx.map((p) => ({ d: p.d, v: p.close }))}
          institutional={[...instTotals].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ d, shares: v }))}
          events={events}
          fairValue={baseV ? { low: baseV.buyPrice, high: baseV.presentValue } : null}
          buyBelow={baseV?.buyPrice ?? null}
          currency={s.currency}
        />
        <SourceLine url={prices.at(-1)?.source_url} label={daily.length ? 'Twelve Data' : 'SEC 13F 평가액 ÷ 주식 수'} asOf={price?.as_of ?? null} />
      </InvCard>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <InvCard title="Valuation Scenarios" sub="5-Year Price Outlook — 최신 추천에 저장된 Bear · Base · Bull(그 시점 값)" more={{ href: `/investment/engine?security=${s.security_id}`, label: '시나리오 ›' }}>
          {Object.keys(vals).length === 0 ? (
            <NoData need="시나리오가 없습니다 — AI Investment Engine에서 Bear · Base · Bull 가정을 출처와 함께 저장." href={`/investment/engine?security=${s.security_id}`} hrefLabel="입력하기" />
          ) : (
            <ul className="flex flex-col gap-2">
              {(['bear', 'base', 'bull'] as const).map((k) => {
                const x = vals[k]
                const max = Math.max(...Object.values(vals).map((y) => y?.futurePrice ?? 0), 1)
                return (
                  <li key={k} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2">
                    <span className="text-[14px] font-semibold">{k[0].toUpperCase() + k.slice(1)}</span>
                    <div className="h-3 rounded bg-raised"><div className={`h-3 rounded ${k === 'bear' ? 'bg-ink-muted/60' : k === 'base' ? 'bg-[#3b74d6]/70' : 'bg-[#1e3a8a]'}`} style={{ width: `${x ? (x.futurePrice / max) * 100 : 0}%` }} /></div>
                    <span className="text-[14px] tnum">{x ? `${usd(x.futurePrice)} (${pct(x.upsidePct, 0, true)})` : '—'}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </InvCard>
        <InvCard title="Why AI Is Watching" sub="점수는 결정론 계산 — «AI 추정» 요소는 표시">
          {!rec ? (
            <NoData need="추천이 아직 없습니다(«지금 분석»)." href="/investment/recommendations" hrefLabel="Recommendations" />
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {[
                  ['Industry outlook(Market)', rec.market_score, scorePart('market')],
                  ['Business quality(Leader)', rec.leader_score, scorePart('leader')],
                  ['Valuation', rec.valuation_score, false],
                  ['Institutional Signal', rec.institutional_signal, false],
                ].map(([label, val, ai]) => (
                  <li key={String(label)} className="grid grid-cols-[minmax(0,12rem)_auto_minmax(0,1fr)] items-center gap-2">
                    <span className="text-[14px]">{String(label)}{ai ? ' · AI 추정 포함' : ''}</span>
                    <span className="w-16 text-right text-[14px] font-semibold tnum">{val === null ? (label === 'Institutional Signal' ? 'UNKNOWN' : '—') : `${val} / 100`}</span>
                    <div className="h-2.5 rounded-full bg-raised"><div className="h-2.5 rounded-full bg-ok/70" style={{ width: `${typeof val === 'number' ? val : 0}%` }} /></div>
                  </li>
                ))}
              </ul>
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[14px]">
                <strong>Decision:</strong> {rec.status === 'BUY ZONE' ? '검증 조건 전부 통과 — 매수 검토(실제 매매는 사람이 결정 · 투자 승인 결재)' : rec.status === 'WATCH' ? 'WATCH — 가격이 안전마진 안으로 들어오거나 남은 조건이 채워질 때까지' : rec.status === 'OVERVALUED' ? 'OVERVALUED — 현재가가 추정 현재가치 위' : rec.status === 'THESIS BROKEN' ? 'THESIS BROKEN — 가설 재검토' : `NEED DATA — ${rec.checks.filter((c) => c.required && !c.pass).map((c) => c.label).join(' · ')}`}
              </p>
            </>
          )}
        </InvCard>
      </div>

      <InvCard title="Institutional Positions" sub="기관별 공시 기준일 주식 수(최근 5기) · 최신 판정 — 마지막 공개 보유이지 실시간 매매가 아니다">
        <T minWidth={560}>
          <thead>
            <tr><Th>기관</Th><Th>추이(주식 수)</Th><Th n>최신 주식 수</Th><Th n>평가액</Th><Th>최신 판정</Th></tr>
          </thead>
          <tbody>
            {inst.map((r) => {
              const max = Math.max(1, ...r.points.map((p) => p.shares ?? 0))
              const last = r.points.at(-1)
              return (
                <tr key={r.manager_id}>
                  <Td>{short(r.manager_id)}</Td>
                  <Td>
                    {r.points.length === 0 ? (
                      <span className="text-[13px] text-ink-muted">13F 없음</span>
                    ) : (
                      <span className="flex h-7 items-end gap-1" title={r.points.map((p) => `${p.as_of}: ${p.shares === null ? '보유 없음' : shares(p.shares)}`).join('\n')}>
                        {r.points.map((p) => (
                          <span key={p.as_of} className={`w-3 rounded-sm ${p.shares ? 'bg-[#3b74d6]' : 'bg-line'}`} style={{ height: `${p.shares ? Math.max(12, (p.shares / max) * 100) : 8}%` }} />
                        ))}
                      </span>
                    )}
                  </Td>
                  <Td n>{last?.shares ? shares(last.shares) : '—'}</Td>
                  <Td n>{last?.value ? usdBig(last.value) : '—'}</Td>
                  <Td>{r.latest ? <ChangeBadge status={r.latest.status} pct={r.latest.change_pct} /> : r.points.length ? <span className="text-[13px] text-ink-muted">{last?.shares ? 'HOLD/비교 없음' : 'NOT DISCLOSED'}</span> : <span className="text-[13px] text-ink-muted">NOT DISCLOSED</span>}</Td>
                </tr>
              )
            })}
          </tbody>
        </T>
        <p className="text-[13px] text-ink-muted">기관 데이터는 보조 지표입니다 — 보유하지 않거나 공개되지 않았다는 이유로 매수를 막지 않습니다(Institutional Signal = UNKNOWN).</p>
      </InvCard>

      {s.kind !== 'etf' ? (
        <InvCard title="기업 재무" sub={`SEC XBRL(최근 회계연도 ${m.fy?.label ?? '—'}) · 같은 기간을 다시 낸 값은 가장 늦은 공시 · 통화 ${ccy}`}>
          {facts.length === 0 ? (
            <NoData need={s.cik ? 'XBRL 재무를 아직 받지 않았습니다(하루 한도 안에서 차례로 받습니다).' : 'SEC CIK가 없는 종목입니다(미국 외 상장 · ADR 일부) — 재무 경로 없음.'} href="/investment/sources" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Mini label="Revenue" v={money(m.revenue)} />
                <Mini label="Revenue CAGR 3Y · 5Y" v={`${pct(m.revenueCagr3)} · ${pct(m.revenueCagr5)}`} />
                <Mini label="Gross · Operating Margin" v={`${pct(m.grossMargin)} · ${pct(m.opMargin)}`} />
                <Mini label="EBITDA" v={money(m.ebitda)} />
                <Mini label="EPS(희석)" v={m.eps === null ? DASH : `${m.eps.toFixed(2)} ${ccy}`} />
                <Mini label="FCF · FCF/주" v={`${money(m.fcf)} · ${m.fcfPerShare === null ? DASH : m.fcfPerShare.toFixed(2)}`} />
                <Mini label="ROIC · ROE" v={`${pct(m.roic)} · ${pct(m.roe)}`} />
                <Mini label="Net Debt · /EBITDA" v={`${money(m.netDebt)} · ${times(m.netDebtToEbitda)}`} />
                <Mini label="Market Cap" v={money(m.marketCap)} sub={m.price ? `가격 ${m.price.as_of}${m.price.source === 'sec13f_implied' ? '(13F 분기말)' : ''}` : '가격 없음'} />
                <Mini label="P/E · EV/EBITDA" v={`${times(m.pe)} · ${times(m.evEbitda)}`} />
                <Mini label="P/FCF · EV/FCF" v={`${times(m.pFcf)} · ${times(m.evFcf)}`} />
                <Mini label="Share Count" v={shares(m.shareCount)} sub={so ? `발행주식 ${so.as_of}` : '희석 가중평균'} />
              </div>
              <p className="text-[13px] text-ink-muted">
                5-Year Historical Valuation(P/FCF): {m.pFcfRange ? `${times(m.pFcfRange.min)} ~ ${times(m.pFcfRange.max)} (가격이 있는 ${m.pFcfRange.years}개 회계연도)` : 'NEED DATA — 회계연도 말 가격이 필요합니다(일별 주가 키 또는 13F 분기말 점이 그 무렵에 있어야 함)'}.
                {' '}ROIC = 영업이익 × (1 − 실효세율) ÷ (자본 + 차입금 − 현금) · FCF = 영업현금흐름 − 설비투자.
              </p>
              <FinTable title="연간" rows={annual} money={money} />
              <FinTable title="분기(3개월 · 현금흐름은 누계 차이)" rows={quarters} money={money} />
              <SourceLine url={facts[0]?.source_url} label="SEC XBRL companyfacts" asOf={annual[0]?.period_end ?? null} published={annual[0]?.filed ?? null} />
            </>
          )}
        </InvCard>
      ) : (
        <InvCard title="ETF 정보" sub="운용사 공식 자료 기준 — 자동 경로(Twelve Data)는 가격만. 나머지는 출처 · 기준일과 함께 손 입력">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Mini label="운용사" v={s.etf_issuer ?? DASH} />
            <Mini label="기초지수" v={s.etf_index ?? DASH} />
            <Mini label="총보수" v={metric('expense_ratio') ? pct(metric('expense_ratio')!.value, 2) : DASH} sub={metric('expense_ratio')?.as_of} />
            <Mini label="순자산(AUM)" v={metric('aum_usd') ? usdBig(metric('aum_usd')!.value) : DASH} sub={metric('aum_usd')?.as_of} />
            <Mini label="추적오차" v={metric('tracking_error') ? pct(metric('tracking_error')!.value, 2) : DASH} sub={metric('tracking_error')?.as_of} />
            <Mini label="환헤지" v={s.hedged === null ? DASH : s.hedged ? '헤지' : '비헤지'} />
            <Mini label="분배금 수익률" v={metric('distribution_yield') ? pct(metric('distribution_yield')!.value, 2) : DASH} />
            <Mini label="1년 수익률 · 기초지수" v={`${pct(metric('etf_return_1y')?.value ?? null)} · ${pct(metric('index_return_1y')?.value ?? null)}`} />
          </div>
          {etf.length === 0 ? (
            <NoData need="구성 종목(상위 10) · 산업/국가 비중 · 구성 변경은 운용사 공식 파일이 필요합니다(무료 자동 경로 없음)." />
          ) : (
            <T minWidth={420}>
              <thead><tr><Th>구성 종목</Th><Th n>비중</Th><Th>기준일</Th></tr></thead>
              <tbody>{etf.slice(0, 10).map((h) => <tr key={`${h.as_of}${h.line_no}`}><Td>{h.holding_name}</Td><Td n>{pct(h.weight_pct, 2)}</Td><Td>{day(h.as_of)}</Td></tr>)}</tbody>
            </T>
          )}
          <p className="text-[13px] text-ink-muted">ETF 가격 변화와 구성 종목 교체는 다른 사건입니다 — 가격은 그래프, 구성 변경은 구성 종목 기준일 비교로 봅니다.</p>
          {admin ? <MetricForm securityId={s.security_id} /> : null}
        </InvCard>
      )}

      <InvCard title="기업행위(분할 · 배당)" sub="보유 변화 판정의 분할 보정에 쓰인다 — 기록이 없으면 «분할 의심»은 UNKNOWN으로 남긴다">
        {actions.length === 0 ? <p className="text-[13px] text-ink-muted">기록 없음{s.prices_checked_at ? '(Twelve Data 분할 자료 확인됨 — 분할 없음)' : ''}</p> : (
          <ul className="flex flex-col gap-1 text-[14px]">
            {actions.map((a) => <li key={`${a.ex_date}${a.kind}${a.source}`}>{a.ex_date} · {a.kind === 'split' ? `분할 ×${a.ratio}` : `배당 ${a.amount} ${a.currency ?? ''}`} · <a className="text-accent hover:underline" href={a.source_url} target="_blank" rel="noreferrer">{a.source}</a></li>)}
          </ul>
        )}
        {admin ? <SplitForm securityId={s.security_id} /> : null}
      </InvCard>

      {admin ? (
        <InvCard title="관심 종목" sub="대표 지정 · 해제(사유 기록)">
          <WatchToggle securityId={s.security_id} watch={s.watch} />
        </InvCard>
      ) : null}
    </div>
  )
}

function Mini({ label, v, sub }: { label: string; v: string; sub?: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border border-line-soft px-3 py-2">
      <div className="text-[13px] text-ink-muted">{label}</div>
      <div className="truncate text-[15px] font-semibold tnum" title={v}>{v}</div>
      {sub ? <div className="text-[13px] text-ink-muted">{sub}</div> : null}
    </div>
  )
}

function FinTable({ title, rows, money }: { title: string; rows: FinRow[]; money: (v: number | null) => string }) {
  if (rows.length === 0) return null
  const lines: [string, (r: FinRow) => string][] = [
    ['Revenue', (r) => money(r.revenue)],
    ['Gross Profit', (r) => money(r.gross)],
    ['Operating Income', (r) => money(r.op)],
    ['Net Income', (r) => money(r.net)],
    ['EBITDA', (r) => money(r.ebitda)],
    ['영업현금흐름', (r) => money(r.ocf)],
    ['설비투자', (r) => money(r.capex)],
    ['FCF', (r) => money(r.fcf)],
    ['EPS(희석)', (r) => (r.eps === null ? DASH : r.eps.toFixed(2))],
    ['희석 주식 수', (r) => shares(r.dilShares)],
    ['현금', (r) => money(r.cash)],
    ['차입금', (r) => money(r.debt)],
    ['자본', (r) => money(r.equity)],
  ]
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[14px] font-semibold text-ink-dim">{title}</h3>
      <T minWidth={140 + rows.length * 110}>
        <thead>
          <tr><Th>항목</Th>{rows.map((r) => <Th key={r.period_end} n>{r.label}</Th>)}</tr>
        </thead>
        <tbody>
          {lines.map(([label, f]) => (
            <tr key={label}><Td>{label}</Td>{rows.map((r) => <Td key={r.period_end} n>{f(r)}</Td>)}</tr>
          ))}
        </tbody>
      </T>
    </div>
  )
}
