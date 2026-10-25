import { notFound } from 'next/navigation'

import { MarketDataForm, ScoreForm } from '@/components/investment/forms'
import { InvCard, NoData, PageTitle, RowLink, T, Td, Th } from '@/components/investment/ui'
import { day } from '@/lib/investment/format'
import { loadMarkets } from '@/lib/investment/markets-view'
import { investmentViewer } from '@/lib/investment/screen'
import { MARKET_FACTORS, latestFactors, type FactorInput } from '@/lib/investment/scores'

export const dynamic = 'force-dynamic'

const METHOD = { formula: '공식', judgment: '대표 판단', ai_estimate: 'AI 추정' } as const

/** 산업 한 곳 — 전망치(실측 · 전망 · AI 가정 구분) · Market Score 분해(방법 · 공식 · 근거) · 가치사슬 · 소속 기업. */
export default async function MarketPage(props: PageProps<'/investment/markets/[id]'>) {
  const { id } = await props.params
  const { repo, admin } = await investmentViewer()
  const markets = await loadMarkets(repo)
  const m = markets.find((x) => x.market.market_id === id)
  if (!m) notFound()
  const latest = latestFactors(m.inputs as (FactorInput & { created_at?: string })[])
  const [securities, recs] = await Promise.all([repo.invSecurities(), repo.invRecommendations({ latestOnly: true })])
  const members = securities.filter((s) => s.market_id === id)

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={m.market.name} sub={`${m.market.name_ko ?? ''} · Market Score ${m.score.total === null ? 'NEED DATA' : m.score.total.toFixed(2)}`} />

      <InvCard title="Market Score 분해" sub="Demand Growth × 25% + Profit Pool × 20% + Adoption × 20% + Supply Bottleneck × 20% + Durability × 15%(가중치는 설정) — 요소마다 가장 늦은 입력">
        <T minWidth={760}>
          <thead>
            <tr><Th>요소</Th><Th n>가중치</Th><Th n>점수</Th><Th n>기여</Th><Th>방법</Th><Th>근거 · 출처</Th></tr>
          </thead>
          <tbody>
            {MARKET_FACTORS.map((f) => {
              const p = m.score.parts.find((x) => x.key === f.key)!
              const row = latest.get(f.key) as (FactorInput & { created_at?: string }) | undefined
              return (
                <tr key={f.key}>
                  <Td>{f.label}<div className="text-[13px] text-ink-muted">{f.formula}</div></Td>
                  <Td n>{p.weight}%</Td>
                  <Td n>{p.score === null ? '—' : p.score.toFixed(1)}</Td>
                  <Td n>{p.contribution === null ? '—' : p.contribution.toFixed(2)}</Td>
                  <Td>{row ? <span className={`rounded px-1.5 py-0.5 text-[13px] font-semibold ${row.method === 'ai_estimate' ? 'bg-accent/15 text-accent' : row.method === 'formula' ? 'bg-ok/12 text-ok' : 'bg-raised text-ink-dim'}`}>{METHOD[row.method]}</span> : '입력 없음'}</Td>
                  <Td className="max-w-[360px] whitespace-normal text-[13px] text-ink-muted">
                    {row?.evidence ?? '—'}
                    {row?.source_url ? <> · <a href={row.source_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">출처</a></> : null}
                    {row?.as_of ? ` · ${day(row.as_of)}` : ''}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </T>
        <p className="text-[13px] text-ink-muted">AI 추정은 근거 문장과 출처를 단 «추정»입니다 — 대표 판단을 넣으면 그 줄이 이깁니다. 점수는 화면을 열 때마다 저장된 입력으로 다시 계산합니다(지난 추천은 그 시점 값 그대로).</p>
        {admin ? <ScoreForm subjectType="market" subjectId={id} factors={MARKET_FACTORS.map((f) => ({ key: f.key, label: f.label }))} /> : null}
      </InvCard>

      <InvCard title="산업 데이터" sub="현재 시장 규모 · 2030 · 2035 · 성장률 · 채택률 · 단위원가 · 이익 규모 — 실측 / 전망 / AI 가정을 따로">
        {m.forecasts.length === 0 ? (
          <NoData need="출처가 있는 자료가 아직 없습니다." />
        ) : (
          <T minWidth={760}>
            <thead>
              <tr><Th>지표</Th><Th n>연도</Th><Th n>값</Th><Th>구분</Th><Th>출처(발표일)</Th><Th>메모</Th></tr>
            </thead>
            <tbody>
              {m.forecasts.map((f, i) => (
                <tr key={i}>
                  <Td>{f.label}</Td>
                  <Td n>{f.year ?? '—'}</Td>
                  <Td n>{f.value !== null ? `${f.value.toLocaleString('en-US')} ${f.unit ?? ''}` : f.text_value}</Td>
                  <Td>{f.kind === 'actual' ? '실측' : f.kind === 'forecast' ? '전망' : 'AI 가정'}</Td>
                  <Td>{f.source ? <a href={f.source.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-accent hover:underline lg:min-h-0">{f.source.publisher} ({f.source.published_date ?? '발표일 미상'})</a> : '출처 없음'}</Td>
                  <Td className="max-w-[300px] whitespace-normal text-[13px] text-ink-muted">{f.note ?? ''}{f.source?.verified === 'snippet' ? ' · 사이트가 자동 열람을 막아 검색 문장으로 확인' : ''}</Td>
                </tr>
              ))}
            </tbody>
          </T>
        )}
        {admin ? <MarketDataForm marketId={id} /> : null}
      </InvCard>

      <InvCard title="가치사슬" sub="각 영역의 선도기업 — 시장이 큰 곳이 아니라 이익이 쌓이는 곳을 찾는다(규모 · 수익성 숫자는 출처가 있을 때만)">
        {m.chains.length === 0 ? <NoData need="가치사슬 자료 없음" /> : (
          <T minWidth={560}>
            <thead><tr><Th>영역</Th><Th>선도기업</Th><Th>규모</Th><Th>수익성 · 진입장벽</Th></tr></thead>
            <tbody>
              {m.chains.map((c) => (
                <tr key={c.chain_id ?? c.segment}>
                  <Td>{c.segment}</Td>
                  <Td className="max-w-[360px] whitespace-normal">{c.leaders.join(' · ')}</Td>
                  <Td>{c.size_value !== null ? `${c.size_value} ${c.size_unit ?? ''}` : '출처 없음'}</Td>
                  <Td className="text-[13px] text-ink-muted">{[c.profitability, c.barrier].filter(Boolean).join(' · ') || '출처 없음'}</Td>
                </tr>
              ))}
            </tbody>
          </T>
        )}
      </InvCard>

      <InvCard title="이 산업으로 지정한 기업" sub="종목 화면에서 산업을 지정하면 Opportunity의 Market Score가 이 산업 점수로 계산된다">
        {members.length === 0 ? <NoData need="지정한 기업이 없습니다(Stock & ETF 360 › 종목 › 산업 지정)." /> : (
          <ul className="flex flex-wrap gap-2">
            {members.map((s) => {
              const r = recs.find((x) => x.security_id === s.security_id)
              return <li key={s.security_id}><RowLink href={`/investment/securities/${s.security_id}`}>{s.ticker ?? s.name}{r?.leader_score !== null && r ? ` · Leader ${r.leader_score}` : ''}</RowLink></li>
            })}
          </ul>
        )}
      </InvCard>

      <InvCard title="자료 출처" sub="발행처 · 발표일 · 확인 방식">
        <ul className="flex flex-col gap-1 text-[14px]">
          {m.sources.map((s) => (
            <li key={s.source_id}><a className="inline-flex min-h-11 items-center text-accent hover:underline lg:min-h-0" href={s.url} target="_blank" rel="noreferrer">{s.publisher}</a> — {s.title} · {s.published_date ?? '발표일 미상'} · {s.verified === 'page' ? '페이지 확인' : s.verified === 'snippet' ? '검색 문장 확인' : '대표 입력'}{s.note ? ` · ${s.note}` : ''}</li>
          ))}
        </ul>
      </InvCard>
    </div>
  )
}
