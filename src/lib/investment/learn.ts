import { latestPrice } from './metrics'
import { newOutcomeRows, outcomesFor } from './performance'
import type { InvestmentMethods } from './store'
import type { InvPrice, InvRecommendation } from './types'

/**
 * 분석 실행기의 3단계 부분(0096) — Paper 가상 매매 · 추천 성과 줄. 덧붙이기만.
 *   Paper: 종목의 최신 추천이 WATCH · BUY ZONE인데 보유가 없으면, 추천 생성일 «다음 날 이후 첫 가격»에 종목당 notional만큼 가상 매수.
 *          OVERVALUED · THESIS BROKEN이 되면 같은 규칙으로 가상 매도. 그 가격이 아직 없으면 다음 실행에서(같은 날 가격은 쓰지 않는다).
 *   성과: NEED DATA가 아닌 추천마다 1 · 3 · 6 · 12 · 24 · 36 · 60개월이 지난 기간만 줄을 더한다.
 * 0096 전 DB면 아무것도 하지 않는다(표 없음 → null).
 */
export async function runPaperAndOutcomes(repo: InvestmentMethods, today: string): Promise<{ paper: number; outcomes: number } | null> {
  let portfolios
  try {
    portfolios = await repo.invPaperPortfolios()
  } catch (e) {
    if (e instanceof Error && e.message === 'investment_unavailable') return null
    throw e
  }
  const pf = portfolios[0]
  if (!pf) return null
  const [recsAll, txs, outcomes, securities] = await Promise.all([repo.invRecommendations(), repo.invPaperTxs(), repo.invOutcomes(), repo.invSecurities()])
  const latest = new Map<string, InvRecommendation>()
  for (const r of recsAll) if (!latest.has(r.security_id) || (latest.get(r.security_id)!.version < r.version)) latest.set(r.security_id, r)
  const priceCache = new Map<string, InvPrice[]>()
  const pricesOf = async (id: string) => {
    if (!priceCache.has(id)) priceCache.set(id, await repo.invPrices(id))
    return priceCache.get(id)!
  }
  const holding = (id: string) => txs.filter((t) => t.security_id === id).reduce((s, t) => s + (t.side === 'buy' ? t.shares : -t.shares), 0)
  let paper = 0
  for (const r of latest.values()) {
    const want = r.status === 'WATCH' || r.status === 'BUY ZONE' ? 'buy' : r.status === 'OVERVALUED' || r.status === 'THESIS BROKEN' ? 'sell' : null
    const held = holding(r.security_id)
    if (!want || (want === 'buy' && held > 0) || (want === 'sell' && held <= 0)) continue
    const day = (r.created_at ?? today).slice(0, 10)
    const next = (await pricesOf(r.security_id)).filter((p) => p.d > day).sort((a, b) => a.d.localeCompare(b.d))[0]
    if (!next) continue
    await repo.invAddPaperTx({
      portfolio_id: pf.portfolio_id,
      security_id: r.security_id,
      side: want,
      signal_at: r.created_at ?? `${today}T00:00:00Z`,
      trade_date: next.d,
      shares: want === 'buy' ? pf.notional / next.close : held,
      price: next.close,
      price_source: next.source,
      rec_id: r.rec_id ?? null,
      note: `추천 v${r.version} ${r.status} → 다음 가격(${next.source === 'sec13f_implied' ? '13F 분기말' : '일별'})`,
      created_kind: 'system',
    })
    paper += 1
  }
  // 벤치마크: SPY 일별이 있으면 그것, 없으면 null
  const spy = securities.find((s) => s.ticker === 'SPY' && s.kind === 'etf')
  const bench = spy ? (await pricesOf(spy.security_id)).filter((p) => p.source === 'twelvedata') : null
  const lastGlobal = (await Promise.all(securities.filter((s) => s.watch).slice(0, 80).map((s) => pricesOf(s.security_id)))).flat().map((p) => p.d).sort().at(-1) ?? null
  let n = 0
  for (const r of recsAll.filter((x) => x.status !== 'NEED DATA')) {
    const calcs = outcomesFor(r.created_at ?? today, await pricesOf(r.security_id), bench && bench.length ? bench : null, today, lastGlobal)
    const rows = newOutcomeRows(r, calcs, outcomes)
    for (const row of rows) {
      await repo.invAddOutcome(row)
      n += 1
    }
  }
  void latestPrice
  return { paper, outcomes: n }
}
