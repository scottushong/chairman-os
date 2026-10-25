import { effectivePeriods } from './changes'
import { COMPARABLE_QUALITY } from './collect/run'
import { computeMetrics, latestPrice, sharesOutstanding } from './metrics'
import { RECOMMEND_VERSION, decide, etfChecks, stockChecks, type Check } from './recommend'
import { DEFAULT_WEIGHTS, SCORE_VERSION, institutionalSignal, latestFactors, leaderFormulaInputs, leaderScore, marketScore, opportunityScore, r2, type FactorInput } from './scores'
import type { InvestmentMethods } from './store'
import type {
  InvAlert,
  InvChange,
  InvDisclosure,
  InvManager,
  InvRecommendation,
  InvScenario,
  InvScoreRow,
  InvSecurity,
  RecExplanation,
  ScenarioInputs,
} from './types'
import { VALUATION_VERSION, valuate, validateInput, valuationScore, type ValuationResult } from './valuation'

/**
 * 분석 한 번(0095) — 결정론 계산 → 바뀐 것만 새 버전 줄(덧붙이기만). AI는 «설명 글»만(선택, 한도 안에서).
 *   종목마다: 시나리오(최신) → 가치평가 스냅숏 · Market/Leader/Valuation/Institutional/Opportunity · BUY 조건 · 상태
 *   → 최신 추천과 상태 · 점수 · 기준가 · 가격 기준일이 다르면 새 버전 · 알림
 *   공시 · 수집 실패 알림, 아침 투자 브리핑(하루 한 번, 10항목 — 원천 기준일 · 생성 시각을 같이)
 * 사람(대표 «지금 분석») · AI 분석 계정(cron) 둘 다 같은 함수 — 판정 줄은 created_kind 'system'(BUY는 system 줄만 — DB 트리거).
 */
export const ANALYZE_VERSION = `${VALUATION_VERSION}+${SCORE_VERSION}+${RECOMMEND_VERSION}`

export type Explainer = (input: Record<string, unknown>) => Promise<{ text: RecExplanation; model: string } | null>
export type BriefSummarizer = (content: Record<string, unknown>) => Promise<{ summary: string; model: string } | null>

export interface AnalyzeOptions {
  today: string
  nowIso: string
  explain?: Explainer | null
  summarize?: BriefSummarizer | null
  /** 이번 실행에서 AI 설명을 몇 개까지(한도는 DB가 한 번 더) */
  maxExplain?: number
}

export interface AnalyzeResult {
  analyzed: number
  newRecommendations: number
  newValuations: number
  alerts: number
  brief: boolean
  aiExplained: number
  notes: string[]
}

const SCN = ['bear', 'base', 'bull'] as const
const latestScenario = (rows: readonly InvScenario[], s: string) => rows.filter((r) => r.scenario === s).sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')).at(-1) ?? null

export function inputsToValuation(inp: ScenarioInputs, years: number, price: number) {
  return {
    price,
    fcfPerShare: inp.fcf_per_share.value ?? NaN,
    fcfCagr: (inp.fcf_cagr.value ?? NaN) / 100,
    exitMultiple: inp.exit_multiple.value ?? NaN,
    requiredReturn: (inp.required_return.value ?? NaN) / 100,
    marginOfSafety: (inp.margin_of_safety.value ?? NaN) / 100,
    years,
  }
}

/** 13F 네 곳 최신 비교에서 이 종목 줄(기관마다 하나). */
export function latestChangesFor(securityId: string, changes: readonly InvChange[], disclosures: readonly InvDisclosure[], managers: readonly InvManager[]): InvChange[] {
  const out: InvChange[] = []
  for (const m of managers) {
    const eff = effectivePeriods(disclosures.filter((d) => d.source_id === `sec13f:${m.manager_id}` && (d.data_quality ?? 100) >= COMPARABLE_QUALITY))
    const to = eff.at(-1)?.primary.disclosure_id
    const c = changes.find((x) => x.security_id === securityId && x.to_disclosure === to && x.status !== 'UNKNOWN')
    if (c) out.push(c)
  }
  return out
}

export interface SecurityAnalysis {
  security: InvSecurity
  valuations: Partial<Record<'bear' | 'base' | 'bull', ValuationResult>>
  checks: Check[]
  status: InvRecommendation['status']
  market: ReturnType<typeof marketScore> | null
  leader: ReturnType<typeof leaderScore> | null
  valuationScore: number | null
  institutional: { score: number | null; note: string }
  opportunity: ReturnType<typeof opportunityScore>
  dataQuality: number | null
  priceRef: ReturnType<typeof latestPrice>
  record: Omit<InvRecommendation, 'rec_id' | 'created_at' | 'version' | 'explanation' | 'model_version' | 'created_kind'>
}

/** 종목 하나 분석(결정론 — 화면 · 실행기 공통). DB에 쓰지 않는다. */
export async function analyzeSecurity(repo: InvestmentMethods, s: InvSecurity, ctx: { today: string; managers: InvManager[]; disclosures: InvDisclosure[]; marketScores: InvScoreRow[]; minQuality: number; weights: typeof DEFAULT_WEIGHTS }): Promise<SecurityAnalysis> {
  const [prices, facts, scenarios, companyScores, theses, changes, metricsRows, etfRows] = await Promise.all([
    repo.invPrices(s.security_id),
    repo.invFacts(s.security_id),
    repo.invScenarios(s.security_id),
    repo.invScores('company', s.security_id),
    repo.invTheses(s.security_id),
    repo.invChanges({ securityId: s.security_id }),
    repo.invMetrics(s.security_id),
    repo.invEtfHoldings(s.security_id),
  ])
  const evidence = await repo.invEvidence(theses.map((t) => t.thesis_id!).filter(Boolean))
  const m = computeMetrics(facts, prices, sharesOutstanding(facts)?.value ?? null)
  const priceRef = latestPrice(prices)
  const valuations: SecurityAnalysis['valuations'] = {}
  for (const k of SCN) {
    const row = latestScenario(scenarios, k)
    if (!row || !priceRef) continue
    const vi = inputsToValuation(row.inputs, row.years, priceRef.value)
    if (validateInput(vi) === null) valuations[k] = valuate(vi)
  }
  const base = valuations.base ?? null
  const baseRow = latestScenario(scenarios, 'base')
  const thesisBroken = (() => {
    const last = [...theses].filter((t) => t.kind !== 'manager_reason').sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')).at(-1)
    return last?.state === 'broken'
  })()
  // 점수
  const mFactors = s.market_id ? latestFactors(ctx.marketScores.filter((x) => x.subject_id === s.market_id) as (FactorInput & { created_at?: string })[]) : null
  const market = mFactors ? marketScore(mFactors, ctx.weights) : null
  const leader = s.kind === 'stock' ? leaderScore(latestFactors(companyScores as (FactorInput & { created_at?: string })[]), leaderFormulaInputs(m, m.fy?.period_end ?? null), ctx.weights) : null
  const vScore = base && priceRef ? r2(valuationScore(base.presentValue, priceRef.value)) : null
  const inst = institutionalSignal(latestChangesFor(s.security_id, changes, ctx.disclosures, ctx.managers), ctx.managers)
  const opportunity = opportunityScore({ market: market?.total ?? null, leader: leader?.total ?? null, valuation: vScore, institutional: inst.score }, ctx.weights)
  // 데이터 품질 — 가정 · 점수 입력 품질 평균, 가격이 13F 파생이면 −20
  const qs: number[] = []
  if (baseRow) for (const a of Object.values(baseRow.inputs)) if (typeof a.quality === 'number') qs.push(a.quality)
  if (market?.dataQuality) qs.push(market.dataQuality)
  if (leader?.dataQuality) qs.push(leader.dataQuality)
  let dataQuality = qs.length ? Math.round(qs.reduce((a, b) => a + b, 0) / qs.length) : null
  if (dataQuality !== null && priceRef?.source === 'sec13f_implied') dataQuality = Math.max(0, dataQuality - 20)

  let checks: Check[]
  if (s.kind === 'etf') {
    const metric = (k: string) => metricsRows.filter((x) => x.metric === k).at(-1)
    checks = etfChecks({
      kind: 'etf',
      price: priceRef,
      today: ctx.today,
      items: {
        index: { ok: !!s.etf_index, detail: s.etf_index ?? '기초지수 없음' },
        expenseRatio: { ok: !!metric('expense_ratio'), detail: metric('expense_ratio') ? `${metric('expense_ratio')!.value}% · ${metric('expense_ratio')!.as_of}` : '총보수 없음' },
        holdings: { ok: etfRows.length > 0, detail: etfRows.length ? `${etfRows.length}줄 · ${etfRows[0].as_of}` : '구성 종목 없음' },
        trackingError: { ok: !!metric('tracking_error'), detail: metric('tracking_error') ? `${metric('tracking_error')!.value}% · ${metric('tracking_error')!.as_of}` : '추적오차 없음' },
      },
      minQuality: ctx.minQuality,
      dataQuality: metricsRows.length ? 80 : null,
      thesisBroken,
    })
  } else {
    const a = (k: keyof ScenarioInputs) => baseRow?.inputs[k] ?? { value: null, source_url: null, as_of: null, quality: null }
    checks = stockChecks({
      kind: 'stock',
      price: priceRef,
      today: ctx.today,
      financialsAsOf: m.fy?.period_end ?? null,
      assumptions: { fcfPerShare: a('fcf_per_share'), fcfCagr: a('fcf_cagr'), exitMultiple: a('exit_multiple'), requiredReturn: a('required_return'), marginOfSafety: a('margin_of_safety') },
      minQuality: ctx.minQuality,
      dataQuality,
      evidenceCount: evidence.filter((e) => e.source_url).length,
      thesisBroken,
      netDebtToEbitda: m.netDebtToEbitda,
      fcf: m.fcf,
      valuation: base,
      requiredReturnPct: a('required_return').value,
    })
  }
  const status = decide(checks, { thesisBroken, valuation: base, etf: s.kind === 'etf' })
  const record: SecurityAnalysis['record'] = {
    security_id: s.security_id,
    status,
    market_id: s.market_id ?? null,
    market_score: market?.total ?? null,
    leader_score: leader?.total ?? null,
    valuation_score: vScore,
    institutional_signal: inst.score,
    opportunity_score: opportunity.total,
    data_quality: dataQuality,
    current_price: priceRef?.value ?? null,
    price_as_of: priceRef?.as_of ?? null,
    buy_price: base ? r2(base.buyPrice) : null,
    gap_pct: base ? r2(base.gapToBuyPct) : null,
    expected_return_5y: base ? r2(base.upsidePct) : null,
    checks,
    inputs: {
      price: priceRef,
      scenarios: Object.fromEntries(SCN.map((k) => [k, latestScenario(scenarios, k)?.inputs ?? null])),
      valuations,
      market: market ? { total: market.total, parts: market.parts, aiEstimated: market.aiEstimated } : null,
      leader: leader ? { total: leader.total, parts: leader.parts, aiEstimated: leader.aiEstimated } : null,
      institutional: inst,
      opportunity,
      metrics: { revenue: m.revenue, fcf: m.fcf, fcfPerShare: m.fcfPerShare, roic: m.roic, netDebtToEbitda: m.netDebtToEbitda, fy: m.fy?.label ?? null },
      weights: ctx.weights,
    },
    calculation_version: ANALYZE_VERSION,
    data_as_of: [priceRef?.as_of, m.fy?.period_end].filter(Boolean).sort().at(-1) ?? null,
  }
  return { security: s, valuations, checks, status, market, leader, valuationScore: vScore, institutional: inst, opportunity, dataQuality, priceRef, record }
}

function templateExplanation(a: SecurityAnalysis): RecExplanation {
  const fail = a.checks.filter((c) => !c.pass).map((c) => c.label)
  return {
    source: 'template',
    why_company: a.leader?.total !== null && a.leader ? `Leader Score ${a.leader.total}${a.leader.aiEstimated ? '(AI 추정 포함)' : ''}.` : 'Leader Score 자료 없음.',
    why_market: a.market?.total !== null && a.market ? `Market Score ${a.market.total}(${a.security.market_id}).` : '산업 지정 · Market Score 없음.',
    why_now: a.record.current_price !== null && a.record.buy_price !== null ? `현재가 ${a.record.current_price} · 매수 기준가 ${a.record.buy_price} · 차이 ${a.record.gap_pct}%.` : '가격 또는 기준가 없음.',
    buy_price: a.record.buy_price !== null ? `기본 시나리오 5년 모델: 매수 기준가 ${a.record.buy_price}.` : '가치평가 가정 입력 전.',
    what_could_go_wrong: fail.length ? `통과 못 한 조건: ${fail.join(' · ')}.` : '모든 조건 통과 — 가정(성장률 · 배수)이 틀리면 기준가가 바뀐다.',
    invalidation: '가설 훼손 기록 · FCF 감소 · 순차입금/EBITDA 4배 초과 시 재검토.',
  }
}

const changed = (a: SecurityAnalysis['record'], b: InvRecommendation | undefined) =>
  !b || a.status !== b.status || a.opportunity_score !== b.opportunity_score || a.buy_price !== b.buy_price || a.price_as_of !== b.price_as_of || a.market_score !== b.market_score || a.leader_score !== b.leader_score

export async function runAnalysis(repo: InvestmentMethods, opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const out: AnalyzeResult = { analyzed: 0, newRecommendations: 0, newValuations: 0, alerts: 0, brief: false, aiExplained: 0, notes: [] }
  const [settings, managers, disclosures, marketScores, securities, latestRecs, sources] = await Promise.all([
    repo.invSettings(),
    repo.invManagers(),
    repo.invDisclosures(),
    repo.invScores('market'),
    repo.invSecurities(),
    repo.invRecommendations({ latestOnly: true }),
    repo.invSources(),
  ])
  const weights = settings.weights ?? DEFAULT_WEIGHTS
  const scenarioSecs = new Set((await repo.invScenarios()).map((s) => s.security_id))
  const targets = securities.filter((s) => s.kind !== 'fx' && (s.watch || scenarioSecs.has(s.security_id)))
  const alerts: Omit<InvAlert, 'alert_id' | 'created_at' | 'read_at'>[] = []
  let explainLeft = opts.maxExplain ?? 5
  for (const s of targets) {
    const a = await analyzeSecurity(repo, s, { today: opts.today, managers, disclosures, marketScores, minQuality: settings.data_quality_min, weights })
    out.analyzed += 1
    const prev = latestRecs.find((r) => r.security_id === s.security_id)
    if (!changed(a.record, prev)) continue
    // 가치평가 스냅숏(바뀐 때만)
    for (const k of SCN) {
      const v = a.valuations[k]
      if (!v || !a.priceRef) continue
      await repo.invAddValuation({
        security_id: s.security_id,
        scenario: k,
        scenario_row_id: null,
        calculation_version: VALUATION_VERSION,
        inputs: (a.record.inputs.scenarios as Record<string, unknown>)[k] as Record<string, unknown>,
        future_fcf_ps: v.futureFcfPerShare,
        future_price: v.futurePrice,
        present_value: v.presentValue,
        buy_price: v.buyPrice,
        current_price: a.priceRef.value,
        price_as_of: a.priceRef.as_of,
        price_source: a.priceRef.source,
        upside_pct: v.upsidePct,
        expected_cagr_pct: v.expectedCagrPct,
        created_kind: 'system',
      })
      out.newValuations += 1
    }
    let explanation = templateExplanation(a)
    let model: string | null = null
    if (opts.explain && explainLeft > 0 && a.status !== 'NEED DATA') {
      explainLeft -= 1
      const ex = await opts.explain({ security: { name: s.name, ticker: s.ticker, kind: s.kind }, status: a.status, record: a.record }).catch(() => null)
      if (ex) {
        explanation = { ...ex.text, source: 'ai' }
        model = ex.model
        out.aiExplained += 1
      }
    }
    await repo.invAddRecommendation({ ...a.record, version: (prev?.version ?? 0) + 1, explanation, model_version: model, created_kind: 'system' })
    out.newRecommendations += 1
    const t = s.ticker ?? s.name
    if (prev && prev.status !== a.status) {
      alerts.push({ kind: 'rec.status', severity: a.status === 'BUY ZONE' || a.status === 'THESIS BROKEN' ? 'critical' : 'info', title: `${t} ${prev.status} → ${a.status}`, body: null, security_id: s.security_id, manager_id: null, link: `/investment/recommendations?security=${s.security_id}`, dedupe_key: `rec:${s.security_id}:${(prev.version ?? 0) + 1}` })
    }
    const base = a.valuations.base
    if (base && a.priceRef && a.status !== 'NEED DATA') {
      const gap = base.gapToBuyPct
      if (gap <= 0) alerts.push({ kind: 'price.buy_reached', severity: 'warn', title: `${t} 매수 기준가 도달(${gap.toFixed(1)}%)`, body: '도달은 가격 조건 하나 — BUY ZONE은 다른 조건까지 통과해야 한다', security_id: s.security_id, manager_id: null, link: `/investment/securities/${s.security_id}`, dedupe_key: `buy_reached:${s.security_id}:${a.priceRef.as_of}` })
      else if (gap <= 5) alerts.push({ kind: 'price.buy_near', severity: 'info', title: `${t} 매수 기준가 접근(+${gap.toFixed(1)}%)`, body: null, security_id: s.security_id, manager_id: null, link: `/investment/securities/${s.security_id}`, dedupe_key: `buy_near:${s.security_id}:${a.priceRef.as_of}` })
      if (a.priceRef.value > base.presentValue * 1.5) alerts.push({ kind: 'price.premium', severity: 'info', title: `${t} 추정 가치 대비 지나친 프리미엄(${((a.priceRef.value / base.presentValue - 1) * 100).toFixed(0)}%)`, body: null, security_id: s.security_id, manager_id: null, link: `/investment/securities/${s.security_id}`, dedupe_key: `premium:${s.security_id}:${a.priceRef.as_of}` })
    }
  }
  // 공시 · 수집 알림
  const recentDay = new Date(Date.parse(`${opts.today}T00:00:00Z`) - 45 * 86400_000).toISOString().slice(0, 10)
  for (const d of disclosures.filter((x) => (x.source_type === 'sec_13f' || x.source_type === 'nbim_holdings') && (x.source_published_at ?? x.ingested_at.slice(0, 10)) >= recentDay)) {
    const m = managers.find((x) => x.manager_id === d.manager_id)
    if (!m) continue
    alerts.push({ kind: 'disclosure.new', severity: 'info', title: `${m.name} 새 공시 — 기준일 ${d.data_as_of}`, body: `공개일 ${d.source_published_at ?? '파일에 없음'} · ${d.position_count ?? '—'}줄`, security_id: null, manager_id: m.manager_id, link: `/investment/radar/${m.manager_id}`, dedupe_key: `disc:${d.disclosure_id}` })
  }
  for (const src of sources.filter((x) => x.last_error && (!x.last_success_at || (x.last_attempt_at ?? '') > x.last_success_at))) {
    alerts.push({ kind: 'collect.failed', severity: 'warn', title: `데이터 갱신 실패 — ${src.label}`, body: src.last_error, security_id: null, manager_id: src.manager_id, link: '/investment/sources', dedupe_key: `fail:${src.source_id}:${opts.today}` })
  }
  out.alerts = alerts.length ? await repo.invAddAlerts(alerts) : 0

  // 아침 투자 브리핑(하루 한 번)
  const briefs = await repo.invBriefs(1)
  if (!briefs[0] || briefs[0].brief_date !== opts.today) {
    const content = await briefContent(repo, { today: opts.today, managers, disclosures, sources })
    let summary: string | null = null
    let model: string | null = null
    if (opts.summarize) {
      const r = await opts.summarize(content).catch(() => null)
      if (r) {
        summary = r.summary
        model = r.model
      }
    }
    await repo.invAddBrief({ brief_date: opts.today, content, ai_summary: summary, data_as_of: (content.data_as_of as string | null) ?? null, model_version: model, created_kind: 'system' })
    out.brief = true
  }
  return out
}

/** 아침 투자 브리핑 10항목(원문 3.2) — 결정론. 원천 최신 기준일을 같이 싣는다. */
export async function briefContent(
  repo: InvestmentMethods,
  ctx: { today: string; managers: InvManager[]; disclosures: InvDisclosure[]; sources: Awaited<ReturnType<InvestmentMethods['invSources']>> },
): Promise<Record<string, unknown>> {
  const since = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - 45 * 86400_000).toISOString().slice(0, 10)
  const recentDisc = ctx.disclosures.filter((d) => (d.source_published_at ?? d.ingested_at.slice(0, 10)) >= since)
  const tos: string[] = []
  for (const m of ctx.managers) {
    const eff = effectivePeriods(ctx.disclosures.filter((d) => d.source_id === `sec13f:${m.manager_id}` && (d.data_quality ?? 100) >= COMPARABLE_QUALITY))
    if (eff.length >= 2) tos.push(eff.at(-1)!.primary.disclosure_id)
  }
  const changes = tos.length ? await repo.invChanges({ toDisclosures: tos, statuses: ['NEW', 'ADD', 'TRIM'] }) : []
  const pick = (st: string) =>
    changes
      .filter((c) => c.status === st && c.manager_id !== 'nbim')
      .sort((a, b) => (b.cur_value ?? b.prev_value ?? 0) - (a.cur_value ?? a.prev_value ?? 0))
      .slice(0, 5)
      .map((c) => ({ issuer: c.issuer_name, manager: c.manager_id, pct: c.change_pct, security_id: c.security_id }))
  const recs = await repo.invRecommendations({ latestOnly: true })
  const near = recs.filter((r) => r.gap_pct !== null && r.gap_pct <= 5).map((r) => ({ security_id: r.security_id, gap_pct: r.gap_pct, status: r.status }))
  const broken = recs.filter((r) => r.status === 'THESIS BROKEN').map((r) => r.security_id)
  const markets = await repo.invMarkets()
  const lastAsOf = ctx.disclosures.map((d) => d.data_as_of).sort().at(-1) ?? null
  const failed = ctx.sources.filter((s) => s.last_error && (!s.last_success_at || (s.last_attempt_at ?? '') > s.last_success_at)).map((s) => s.label)
  return {
    generated_for: ctx.today,
    data_as_of: lastAsOf,
    last_success: ctx.sources.map((s) => s.last_success_at).filter(Boolean).sort().at(-1) ?? null,
    items: {
      '1 신규 공시': recentDisc.map((d) => ({ manager: d.manager_id, as_of: d.data_as_of, published: d.source_published_at })),
      '2 신규 편입': pick('NEW'),
      '3 보유수량 확대': pick('ADD'),
      '4 보유수량 축소': pick('TRIM'),
      '5 관심종목 주가 변화': '일별 주가 경로(Twelve Data) 키가 있을 때만 — 없으면 13F 분기말 파생 가격',
      '6 목표 매수가 접근': near,
      '7 미래 산업 전망 변화': markets.map((m) => m.name),
      '8 실적 발표 · 재무 변화': 'SEC XBRL 수집분(종목 화면)',
      '9 투자 가설 약화': broken,
      '10 DY Portfolio': '3단계(0096)에서 연결',
    },
    collect_failed: failed,
  }
}
