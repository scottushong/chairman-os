import 'server-only'

import type { ChairmanRepository } from '@/lib/repository/types'

import { DEFAULT_WEIGHTS, latestFactors, marketScore, type FactorInput, type ScoreResult } from './scores'
import type { InvForecast, InvMarket, InvMarketSource, InvScoreRow, InvValueChain } from './types'

/** Future Markets 화면 집계 — 저장된 입력으로 Market Score를 다시 계산한다(원문 6.2 · 완료 조건). */
export interface MarketView {
  market: InvMarket
  score: ScoreResult
  inputs: InvScoreRow[]
  forecasts: (InvForecast & { source: InvMarketSource | null })[]
  sources: InvMarketSource[]
  chains: InvValueChain[]
}

export async function loadMarkets(repo: ChairmanRepository): Promise<MarketView[]> {
  const [markets, sources, forecasts, chains, scores, settings] = await Promise.all([
    repo.invMarkets(),
    repo.invMarketSources(),
    repo.invForecasts(),
    repo.invValueChains(),
    repo.invScores('market'),
    repo.invSettings(),
  ])
  const w = settings.weights ?? DEFAULT_WEIGHTS
  return markets.map((m) => {
    const inputs = scores.filter((s) => s.subject_id === m.market_id)
    return {
      market: m,
      score: marketScore(latestFactors(inputs as (FactorInput & { created_at?: string })[]), w),
      inputs,
      forecasts: forecasts.filter((f) => f.market_id === m.market_id).map((f) => ({ ...f, source: sources.find((s) => s.source_id === f.source_id) ?? null })),
      sources: sources.filter((s) => s.market_id === m.market_id),
      chains: chains.filter((c) => c.market_id === m.market_id),
    }
  })
}
