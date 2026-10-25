import type { Metrics } from './metrics'
import type { ChangeStatus, InvChange, InvManager } from './types'

/**
 * 점수(원문 6.2 · 7 · 9) — 결정론. 저장된 입력(investment_scores 줄 · XBRL 재무 · 13F 판정)으로 화면을 열 때마다 다시 계산한다.
 * 요소마다 «방법»을 단다: formula(정량 공식 — 공식을 화면에 적는다) · judgment(대표 판단 + 근거) · ai_estimate(AI 추정 — 화면에 «AI 추정»).
 * 가중치는 investment_settings(관리자 설정). 점수는 BUY를 부여하지 않는다 — BUY는 recommend.ts의 별개 조건.
 */
export const SCORE_VERSION = 'score-1.0'

export type Method = 'formula' | 'judgment' | 'ai_estimate'

export interface FactorInput {
  factor: string
  score: number | null
  method: Method
  raw_value: number | null
  raw_unit: string | null
  evidence: string | null
  source_url: string | null
  as_of: string | null
  data_quality: number | null
}

export const MARKET_FACTORS = [
  { key: 'demand_growth', label: 'Demand Growth', weightKey: 'w_market_demand', formula: '미래 CAGR(%) ÷ 30 × 100 (30% 이상 = 100)' },
  { key: 'profit_pool', label: 'Profit Pool Expansion', weightKey: 'w_market_profit', formula: '산업 이익 규모 연평균 증가율(%) ÷ 30 × 100' },
  { key: 'adoption', label: 'Adoption Evidence', weightKey: 'w_market_adoption', formula: '판단 · 근거(채택률 · 침투율 자료)' },
  { key: 'bottleneck', label: 'Supply Bottleneck', weightKey: 'w_market_bottleneck', formula: '판단 · 근거(공급 병목 = 가격 결정력)' },
  { key: 'durability', label: 'Structural Durability', weightKey: 'w_market_durability', formula: '판단 · 근거(구조적 수요의 지속성)' },
] as const

export const LEADER_FACTORS = [
  { key: 'market_share', label: 'Market Share Competitiveness', weightKey: 'w_leader_share', formula: '판단 · 근거(점유율 자료)' },
  { key: 'moat', label: 'Competitive Moat', weightKey: 'w_leader_moat', formula: '판단 · 근거(기술 · 전환비용 · 반복 매출 · 과점)' },
  { key: 'cash_flow', label: 'Cash Flow Quality', weightKey: 'w_leader_cash', formula: '½ × min(100, FCF 마진% × 4) + ½ × min(100, FCF ÷ 순이익 × 100)' },
  { key: 'balance_sheet', label: 'Balance Sheet Strength', weightKey: 'w_leader_balance', formula: '100 − 25 × (순차입금 ÷ EBITDA), 순현금이면 100' },
  { key: 'management', label: 'Management & Capital Allocation', weightKey: 'w_leader_mgmt', formula: 'min(100, ROIC% × 4) — 자본배분 결과로 본다(판단으로 덮을 수 있음)' },
] as const

export interface Weights {
  w_market_demand: number
  w_market_profit: number
  w_market_adoption: number
  w_market_bottleneck: number
  w_market_durability: number
  w_leader_share: number
  w_leader_moat: number
  w_leader_cash: number
  w_leader_balance: number
  w_leader_mgmt: number
  w_opp_market: number
  w_opp_leader: number
  w_opp_valuation: number
  w_opp_inst: number
}

/** 원문 6.2 · 7 · 9 초기 가중치 */
export const DEFAULT_WEIGHTS: Weights = {
  w_market_demand: 25,
  w_market_profit: 20,
  w_market_adoption: 20,
  w_market_bottleneck: 20,
  w_market_durability: 15,
  w_leader_share: 25,
  w_leader_moat: 25,
  w_leader_cash: 20,
  w_leader_balance: 15,
  w_leader_mgmt: 15,
  w_opp_market: 30,
  w_opp_leader: 35,
  w_opp_valuation: 30,
  w_opp_inst: 5,
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))
export const r2 = (n: number) => Math.round(n * 100) / 100

export const demandGrowthScore = (cagrPct: number) => clamp((cagrPct / 30) * 100)

/** 요소 입력 → 최신 한 줄씩(같은 요소는 가장 늦게 넣은 것). */
export function latestFactors<T extends FactorInput & { created_at?: string }>(rows: readonly T[]): Map<string, T> {
  const m = new Map<string, T>()
  for (const r of [...rows].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))) m.set(r.factor, r)
  return m
}

export interface ScoreResult {
  total: number | null
  /** 빠진 요소 — 하나라도 빠지면 total = null(NEED DATA) */
  missing: string[]
  parts: { key: string; label: string; weight: number; score: number | null; method: Method | null; formula: string; contribution: number | null }[]
  aiEstimated: boolean
  dataQuality: number | null
}

function weighted(defs: readonly { key: string; label: string; weightKey: keyof Weights; formula: string }[], inputs: Map<string, FactorInput>, w: Weights): ScoreResult {
  const parts = defs.map((d) => {
    const f = inputs.get(d.key)
    const score = f?.score ?? null
    return { key: d.key, label: d.label, weight: w[d.weightKey], score, method: f?.method ?? null, formula: d.formula, contribution: score === null ? null : (score * w[d.weightKey]) / 100 }
  })
  const missing = parts.filter((p) => p.score === null).map((p) => p.label)
  const qs = defs.map((d) => inputs.get(d.key)?.data_quality).filter((q): q is number => typeof q === 'number')
  return {
    total: missing.length ? null : r2(parts.reduce((s, p) => s + (p.contribution ?? 0), 0)),
    missing,
    parts,
    aiEstimated: parts.some((p) => p.method === 'ai_estimate'),
    dataQuality: qs.length ? Math.round(qs.reduce((a, b) => a + b, 0) / qs.length) : null,
  }
}

export function marketScore(inputs: Map<string, FactorInput>, w: Weights = DEFAULT_WEIGHTS): ScoreResult {
  return weighted(MARKET_FACTORS, inputs, w)
}

/** 재무에서 바로 나오는 리더 요소(현금흐름 · 재무구조 · 경영)는 공식으로 채운다 — 판단 줄이 있으면 판단이 이긴다. */
export function leaderFormulaInputs(m: Metrics, asOf: string | null): FactorInput[] {
  const out: FactorInput[] = []
  const fy = m.fy
  if (fy && fy.fcf !== null && fy.revenue && fy.net) {
    const margin = (fy.fcf / fy.revenue) * 100
    const conv = fy.net > 0 ? fy.fcf / fy.net : 0
    out.push({ factor: 'cash_flow', score: r2(0.5 * clamp(margin * 4) + 0.5 * clamp(conv * 100)), method: 'formula', raw_value: r2(margin), raw_unit: 'FCF 마진 %', evidence: `FCF 마진 ${margin.toFixed(1)}% · FCF/순이익 ${(conv * 100).toFixed(0)}% (${fy.label})`, source_url: null, as_of: asOf, data_quality: 90 })
  }
  if (m.netDebt !== null && m.ebitda) {
    const nd = m.netDebt / m.ebitda
    out.push({ factor: 'balance_sheet', score: r2(m.netDebt <= 0 ? 100 : clamp(100 - 25 * nd)), method: 'formula', raw_value: r2(nd), raw_unit: '순차입금/EBITDA 배', evidence: `순차입금/EBITDA ${nd.toFixed(2)}배`, source_url: null, as_of: asOf, data_quality: 90 })
  }
  if (m.roic !== null) {
    out.push({ factor: 'management', score: r2(clamp(m.roic * 4)), method: 'formula', raw_value: r2(m.roic), raw_unit: 'ROIC %', evidence: `ROIC ${m.roic.toFixed(1)}%`, source_url: null, as_of: asOf, data_quality: 85 })
  }
  return out
}

export function leaderScore(stored: Map<string, FactorInput>, formula: readonly FactorInput[], w: Weights = DEFAULT_WEIGHTS): ScoreResult {
  const merged = new Map<string, FactorInput>(formula.map((f) => [f.factor, f]))
  for (const [k, v] of stored) merged.set(k, v)
  return weighted(LEADER_FACTORS, merged, w)
}

/**
 * Institutional Signal(0~100) — 13F 최신 판정 × 기관 신호 가중치(NBIM 0.5).
 *   50 + 10 × Σ(가중치 × 판정점수) + 5 × Σ(보유 기관 가중치), 판정점수 NEW +2 · ADD +1 · HOLD 0 · TRIM −1 · EXIT −2 · UNKNOWN 0
 * 13F 범위 밖(보유 기록 없음)이면 null = UNKNOWN — 매수를 막지 않고 근거에 «기관 데이터 없음»을 적는다(머리말).
 */
export function institutionalSignal(latest: readonly InvChange[], managers: readonly InvManager[]): { score: number | null; note: string } {
  if (latest.length === 0) return { score: null, note: 'UNKNOWN — 4개 기관 13F 공개 범위에 보유 기록 없음' }
  const pts: Record<ChangeStatus, number> = { NEW: 2, ADD: 1, HOLD: 0, TRIM: -1, EXIT: -2, UNKNOWN: 0 }
  let s = 50
  const parts: string[] = []
  for (const c of latest) {
    const w = managers.find((m) => m.manager_id === c.manager_id)?.signal_weight ?? 1
    s += 10 * w * pts[c.status]
    if (c.status !== 'EXIT') s += 5 * w
    parts.push(`${c.manager_id} ${c.status}`)
  }
  return { score: r2(clamp(s)), note: parts.join(' · ') }
}

export interface OpportunityResult {
  total: number | null
  parts: { key: 'market' | 'leader' | 'valuation' | 'institutional'; weight: number; score: number | null; contribution: number | null }[]
  note: string | null
}

/**
 * Opportunity = Market × 30% + Leader × 35% + Valuation × 30% + Institutional × 5% (가중치는 설정).
 * Institutional이 UNKNOWN이면 그 가중치를 뺀 나머지로 다시 나눈다(근거에 적는다). 셋 중 하나라도 없으면 null.
 */
export function opportunityScore(s: { market: number | null; leader: number | null; valuation: number | null; institutional: number | null }, w: Weights = DEFAULT_WEIGHTS): OpportunityResult {
  const parts = [
    { key: 'market' as const, weight: w.w_opp_market, score: s.market },
    { key: 'leader' as const, weight: w.w_opp_leader, score: s.leader },
    { key: 'valuation' as const, weight: w.w_opp_valuation, score: s.valuation },
    { key: 'institutional' as const, weight: w.w_opp_inst, score: s.institutional },
  ]
  if (s.market === null || s.leader === null || s.valuation === null) {
    return { total: null, parts: parts.map((p) => ({ ...p, contribution: null })), note: 'Market · Leader · Valuation 중 빠진 점수가 있어 계산하지 않음' }
  }
  const used = parts.filter((p) => p.score !== null)
  const sum = used.reduce((a, p) => a + p.weight, 0)
  const total = r2(used.reduce((a, p) => a + (p.score! * p.weight) / sum, 0))
  return {
    total,
    parts: parts.map((p) => ({ ...p, contribution: p.score === null ? null : r2((p.score * p.weight) / sum) })),
    note: s.institutional === null ? `Institutional Signal UNKNOWN — 가중치 ${w.w_opp_inst}%를 빼고 나머지 ${sum}%로 다시 나눔` : null,
  }
}
