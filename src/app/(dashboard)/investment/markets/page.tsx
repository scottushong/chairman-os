import { InvCard, PageTitle, RowLink } from '@/components/investment/ui'
import { investmentViewer } from '@/lib/investment/screen'
import { loadMarkets } from '@/lib/investment/markets-view'

export const dynamic = 'force-dynamic'

/** 3. Future Markets(원문 6) — 산업 다섯의 Market Score(저장된 입력으로 다시 계산) · 핵심 전망치(출처 · 발표일). */
export default async function MarketsPage() {
  const { repo } = await investmentViewer()
  const markets = await loadMarkets(repo)
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Future Markets" sub="미래 성장 산업 — 시장 규모가 아니라 «이익이 쌓이는 공급망»을 찾는다. 출처가 없는 숫자는 실측으로 표시하지 않는다." />
      <div className="grid gap-3 lg:grid-cols-2">
        {markets.map((m) => {
          const key = m.forecasts.filter((f) => f.metric === 'market_size' || f.metric === 'cagr').slice(0, 4)
          return (
            <InvCard key={m.market.market_id} title={<RowLink href={`/investment/markets/${m.market.market_id}`}>{m.market.name}</RowLink>} sub={m.market.name_ko ?? undefined}
              right={<span className="text-[24px] font-bold tnum">{m.score.total === null ? 'NEED DATA' : m.score.total.toFixed(1)}</span>}>
              <div className="h-2 rounded-full bg-raised"><div className="h-2 rounded-full bg-accent" style={{ width: `${m.score.total ?? 0}%` }} /></div>
              <p className="text-[13px] text-ink-muted">Market Score{m.score.aiEstimated ? ' — 요소 일부 AI 추정' : ''}{m.score.missing.length ? ` · 빠진 요소: ${m.score.missing.join(' · ')}` : ''}</p>
              <ul className="flex flex-col gap-1">
                {key.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
                    <span className="min-w-0">{f.label}{f.year ? ` (${f.year})` : ''} <span className={`rounded px-1 text-[13px] ${f.kind === 'actual' ? 'bg-ok/12 text-ok' : f.kind === 'forecast' ? 'bg-info/12 text-info' : 'bg-accent/15 text-accent'}`}>{f.kind === 'actual' ? '실측' : f.kind === 'forecast' ? '전망' : 'AI 가정'}</span></span>
                    <span className="tnum">{f.value?.toLocaleString('en-US') ?? f.text_value} {f.unit ?? ''}</span>
                    <span className="w-full text-[13px] text-ink-muted">{f.source ? `${f.source.publisher} · ${f.source.published_date ?? '발표일 미상'}${f.source.verified === 'snippet' ? ' · 검색 문장 확인' : ''}` : '출처 없음'}</span>
                  </li>
                ))}
              </ul>
            </InvCard>
          )
        })}
      </div>
    </div>
  )
}
