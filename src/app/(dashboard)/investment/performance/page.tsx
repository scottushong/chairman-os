import { FailureCauseForm } from '@/components/investment/forms'
import { InvCard, NoData, PageTitle, RowLink, T, Td, Th } from '@/components/investment/ui'
import { kstToday } from '@/lib/chairman-project'
import { effectivePeriods } from '@/lib/investment/changes'
import { COMPARABLE_QUALITY } from '@/lib/investment/collect/run'
import { day, pct } from '@/lib/investment/format'
import { FAILURE_LABEL, HORIZONS, backtest, metricsFor, suggestCause, type BacktestSignal } from '@/lib/investment/performance'
import { investmentViewer } from '@/lib/investment/screen'
import type { InvOutcome, InvPrice } from '@/lib/investment/types'

export const dynamic = 'force-dynamic'

/** 8. Performance & Learning(원문 13) — 추천 성과(기간별) · 지표 · 백테스트(미래 정보 금지 · 상장폐지 포함) · 실패 원인 9분류. */
export default async function PerformancePage() {
  const { repo, admin } = await investmentViewer()
  const today = kstToday()
  const [outcomesAll, recs, securities, disclosures, managers] = await Promise.all([repo.invOutcomes(), repo.invRecommendations(), repo.invSecurities(), repo.invDisclosures(), repo.invManagers()])
  // 같은 추천 · 기간은 가장 늦은 줄(원인이 붙은 줄)이 이긴다
  const latest = new Map<string, InvOutcome>()
  for (const o of outcomesAll) latest.set(`${o.rec_id}|${o.horizon_months}`, o)
  const outcomes = [...latest.values()]
  const sec = (id: string) => securities.find((s) => s.security_id === id)

  // 백테스트 — 집중투자 기관 13F NEW 신호, 공개일 다음 가격에 사서 3개월 뒤(분기말 파생 가격이면 다음 분기말)
  const signals: BacktestSignal[] = []
  for (const m of managers.filter((x) => x.style === 'concentrated')) {
    const eff = effectivePeriods(disclosures.filter((d) => d.source_id === `sec13f:${m.manager_id}` && (d.data_quality ?? 100) >= COMPARABLE_QUALITY))
    for (const p of eff.slice(1)) {
      const ch = await repo.invChanges({ toDisclosures: [p.primary.disclosure_id], statuses: ['NEW'] })
      for (const c of ch) if (c.security_id && p.primary.source_published_at) signals.push({ security_id: c.security_id, data_as_of: p.as_of, published_at: p.primary.source_published_at, kind: 'NEW' })
    }
  }
  const universe = securities.filter((s) => s.watch && s.kind !== 'fx').map((s) => s.security_id)
  const priceMap = new Map<string, InvPrice[]>()
  await Promise.all([...new Set([...universe, ...signals.map((s) => s.security_id)])].map(async (id) => priceMap.set(id, await repo.invPrices(id))))
  const bt = backtest(signals, (id) => priceMap.get(id) ?? [], 3, today, universe)
  const priceKinds = new Set([...priceMap.values()].flat().map((p) => p.source))

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Performance & Learning" sub="추천 뒤 실제 성과로 모델을 검증한다 — 적중률만으로 우수성을 단정하지 않는다." />

      <InvCard title="기간별 추천 성과" sub="신호(추천 생성) 다음 날 이후 첫 가격에 진입 · 기간이 지난 것만 계산(미래 가격 없음) · 가격이 끊긴 종목도 빼지 않음(상장폐지 포함)">
        <T minWidth={900}>
          <thead><tr><Th>기간</Th><Th n>표본</Th><Th n>Hit Rate</Th><Th n>평균 수익</Th><Th n>Excess</Th><Th n>연환산</Th><Th n>변동성</Th><Th n>Sharpe</Th><Th n>MDD</Th><Th>판단</Th></tr></thead>
          <tbody>
            {HORIZONS.map((h) => {
              const m = metricsFor(outcomes.filter((o) => o.horizon_months === h))
              return (
                <tr key={h}>
                  <Td>{h}개월</Td><Td n>{m.n}</Td><Td n>{pct(m.hitRate)}</Td><Td n>{pct(m.avgReturn, 1, true)}</Td><Td n>{m.avgExcess === null ? 'NEED DATA' : pct(m.avgExcess, 1, true)}</Td><Td n>{pct(m.annualized, 1, true)}</Td><Td n>{pct(m.volatility)}</Td><Td n>{m.sharpe === null ? '—' : m.sharpe.toFixed(2)}</Td><Td n>{pct(m.maxDrawdown)}</Td>
                  <Td className="text-[13px] text-ink-muted">{m.n === 0 ? '기간 미도래' : m.enoughData ? '표본 30 이상' : `표본 ${m.n} — 판단 보류`}</Td>
                </tr>
              )
            })}
          </tbody>
        </T>
        <p className="text-[13px] text-ink-muted">Excess · Benchmark 대비는 벤치마크(SPY) 일별 가격이 있어야 계산됩니다(TWELVEDATA_API_KEY). 배당 · 분할은 일별 가격(분할 · 배당 보정)일 때 반영, 환율은 KRW 성과에서 반영. 거래비용은 Real Portfolio에서.</p>
      </InvCard>

      <InvCard title="예측 오차" sub="Forecast Revenue Error · Forecast FCF Error · Valuation Forecast Error — 예측 시점의 가정(추천 이력의 입력)과 이후 공시 실적을 비교">
        <NoData need={`비교할 실적이 아직 없습니다 — 추천 이력 ${recs.length}줄의 가정(FCF/주 · 성장률)은 다음 연간 공시(XBRL)가 나온 뒤 오차를 계산합니다.`} />
      </InvCard>

      <InvCard title="백테스트 — 집중투자 기관 신규 편입(13F NEW)" sub={`공시 «공개일» 다음 가격에 진입(기준일 가격 아님 — 미래 정보 금지) · 3개월 보유 · 가격 원천 ${[...priceKinds].join(', ') || '없음'} · 벤치마크 = 같은 원천 관심 종목 평균`}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-line-soft px-3 py-2"><div className="text-[13px] text-ink-muted">거래</div><div className="text-[18px] font-bold">{bt.trades.length}</div></div>
          <div className="rounded-lg border border-line-soft px-3 py-2"><div className="text-[13px] text-ink-muted">평균 수익</div><div className="text-[18px] font-bold">{pct(bt.avgReturn, 1, true)}</div></div>
          <div className="rounded-lg border border-line-soft px-3 py-2"><div className="text-[13px] text-ink-muted">Hit Rate</div><div className="text-[18px] font-bold">{pct(bt.hitRate)}</div></div>
          <div className="rounded-lg border border-line-soft px-3 py-2"><div className="text-[13px] text-ink-muted">벤치마크 평균</div><div className="text-[18px] font-bold">{pct(bt.benchmarkAvg, 1, true)}</div></div>
        </div>
        {bt.trades.length ? (
          <T minWidth={560}>
            <thead><tr><Th>종목</Th><Th>신호(공개일)</Th><Th>진입</Th><Th>청산</Th><Th n>수익</Th><Th>메모</Th></tr></thead>
            <tbody>{bt.trades.slice(0, 40).map((t, i) => <tr key={i}><Td>{sec(t.security_id)?.ticker ?? t.security_id}</Td><Td>{day(t.signal)}</Td><Td>{day(t.entry)}</Td><Td>{day(t.exit)}</Td><Td n>{pct(t.returnPct, 1, true)}</Td><Td>{t.delisted ? '가격 끊김(상장폐지 가능) — 마지막 가격' : ''}</Td></tr>)}</tbody>
          </T>
        ) : (
          <NoData need={`청산까지 간 신호가 없습니다(신호 ${signals.length} · 가격/기간 부족 ${bt.skippedNoPrice}) — 일별 가격이 없으면 분기말 파생 가격만이라 표본이 적습니다.`} />
        )}
        <p className="text-[13px] text-ink-muted">작은 표본의 백테스트는 우연일 수 있습니다 — 모델 가중치는 표본 30 이상 · 여러 기간이 쌓인 뒤 대표가 조정합니다.</p>
      </InvCard>

      <InvCard title="실패 원인" sub="손실 · 미달 추천의 원인 9분류 — 규칙 추정을 제안하고 대표가 고른다(새 줄로 기록)">
        <ul className="flex flex-wrap gap-2 text-[13px]">
          {Object.entries(FAILURE_LABEL).map(([k, v]) => (
            <li key={k} className="rounded-full border border-line-soft px-2 py-0.5">{v} · {outcomes.filter((o) => o.failure_cause === k).length}</li>
          ))}
        </ul>
        {outcomes.filter((o) => (o.return_pct ?? 0) < 0).length === 0 ? (
          <NoData need="원인을 붙일 손실 추천이 아직 없습니다." />
        ) : (
          <ul className="flex flex-col gap-2">
            {outcomes.filter((o) => (o.return_pct ?? 0) < 0).slice(0, 20).map((o) => {
              const rec = recs.find((r) => r.rec_id === o.rec_id)
              const sug = suggestCause({ returnPct: o.return_pct ?? 0, thesisBroken: rec?.status === 'THESIS BROKEN', dataQuality: rec?.data_quality ?? null, entryAboveBuy: rec?.buy_price !== null && rec?.buy_price !== undefined && (o.entry_price ?? 0) > rec.buy_price })
              return (
                <li key={o.outcome_id} className="rounded-lg border border-line-soft p-2.5">
                  <div className="text-[14px]"><RowLink href={`/investment/recommendations?security=${o.security_id}`}>{sec(o.security_id)?.ticker ?? o.security_id}</RowLink> · {o.horizon_months}개월 {pct(o.return_pct, 1, true)} · 원인 {o.failure_cause ? `${FAILURE_LABEL[o.failure_cause]}(${o.cause_basis === 'human' ? '대표' : 'AI 추론'})` : '미정'}{sug && !o.failure_cause ? ` · 규칙 추정: ${FAILURE_LABEL[sug]}` : ''}</div>
                  {admin ? <FailureCauseForm outcomeId={o.outcome_id!} suggested={o.failure_cause ?? sug} /> : null}
                </li>
              )
            })}
          </ul>
        )}
      </InvCard>
    </div>
  )
}
