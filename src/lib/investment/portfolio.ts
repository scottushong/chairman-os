import type { InvCorpTx, InvPaperTx, InvPrice } from './types'

/**
 * DY Portfolio 계산(원문 12) — 결정론. Real(법인 계좌 손 입력)과 Paper(가상)는 따로 계산하고 합치지 않는다.
 *   원가: 이동평균(평균 단가). 실현손익 = 매도 금액(원) − 평균 원가 × 매도 수량 − 그 거래 수수료 · 세금.
 *   평가금액 = 보유 수량 × 최신 가격 × 최신 환율(원). 환차손익 = 보유 원가(외화) × (현재 환율 − 매입 평균 환율).
 *   총수익률 = (평가금액 + 누적 인출 − 누적 입금) ÷ 누적 입금. 연복리 = 날짜 가중 IRR(XIRR, 입금 = −, 인출 · 현재 평가 = +).
 */

export interface Holding {
  security_id: string
  shares: number
  costKrw: number
  costCcy: number
  currency: string
  avgFx: number
}

export interface RealSummary {
  deposits: number
  withdrawals: number
  cash: number
  holdings: Holding[]
  marketValue: number | null
  realized: number
  unrealized: number | null
  dividends: number
  fees: number
  taxes: number
  fxPnl: number | null
  totalReturnPct: number | null
  cagrPct: number | null
  allocation: { security_id: string; valueKrw: number; pct: number }[]
  missingPrices: string[]
}

export type PriceOf = (securityId: string) => { price: number; currency: string; as_of: string } | null

/** XIRR — 날짜 가중 연수익률(뉴턴법). 해가 없으면 null. */
export function xirr(flows: readonly { date: string; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null
  const t0 = Date.parse(flows[0].date)
  const yrs = flows.map((f) => (Date.parse(f.date) - t0) / (365.25 * 86400_000))
  let r = 0.1
  for (let i = 0; i < 100; i++) {
    let f = 0
    let df = 0
    flows.forEach((x, k) => {
      const d = Math.pow(1 + r, yrs[k])
      f += x.amount / d
      df -= (yrs[k] * x.amount) / (d * (1 + r))
    })
    if (Math.abs(f) < 1e-7) return r
    if (df === 0) return null
    const next = r - f / df
    if (!Number.isFinite(next) || next <= -0.9999) return null
    if (Math.abs(next - r) < 1e-10) return next
    r = next
  }
  return null
}

export function realSummary(txs: readonly InvCorpTx[], priceOf: PriceOf, fxNow: number | null, today: string): RealSummary {
  const sorted = [...txs].sort((a, b) => a.trade_date.localeCompare(b.trade_date) || (a.tx_id ?? 0) - (b.tx_id ?? 0))
  const pos = new Map<string, Holding>()
  let deposits = 0
  let withdrawals = 0
  let cash = 0
  let realized = 0
  let dividends = 0
  let fees = 0
  let taxes = 0
  const flows: { date: string; amount: number }[] = []
  for (const t of sorted) {
    fees += t.fees_krw
    taxes += t.tax_krw
    const charge = t.fees_krw + t.tax_krw
    switch (t.kind) {
      case 'deposit':
        deposits += t.amount_krw
        cash += t.amount_krw
        flows.push({ date: t.trade_date, amount: -t.amount_krw })
        break
      case 'withdraw':
        withdrawals += t.amount_krw
        cash -= t.amount_krw
        flows.push({ date: t.trade_date, amount: t.amount_krw })
        break
      case 'buy': {
        const h = pos.get(t.security_id!) ?? { security_id: t.security_id!, shares: 0, costKrw: 0, costCcy: 0, currency: t.currency, avgFx: t.fx_rate ?? 1 }
        const ccy = (t.shares ?? 0) * (t.price ?? 0)
        h.avgFx = h.costCcy + ccy > 0 ? (h.costCcy * h.avgFx + ccy * (t.fx_rate ?? 1)) / (h.costCcy + ccy) : h.avgFx
        h.shares += t.shares ?? 0
        h.costKrw += t.amount_krw + charge
        h.costCcy += ccy
        pos.set(t.security_id!, h)
        cash -= t.amount_krw + charge
        break
      }
      case 'sell': {
        const h = pos.get(t.security_id!)
        const n = t.shares ?? 0
        if (h && h.shares > 0) {
          const frac = Math.min(1, n / h.shares)
          const costOut = h.costKrw * frac
          realized += t.amount_krw - costOut - charge
          h.costKrw -= costOut
          h.costCcy -= h.costCcy * frac
          h.shares -= n
        }
        cash += t.amount_krw - charge
        break
      }
      case 'dividend':
        dividends += t.amount_krw
        cash += t.amount_krw - charge
        break
      case 'fee':
      case 'tax':
        cash -= t.amount_krw
        if (t.kind === 'fee') fees += t.amount_krw
        else taxes += t.amount_krw
        break
      case 'fx':
      case 'adjust':
        break
    }
  }
  const holdings = [...pos.values()].filter((h) => h.shares > 1e-9)
  const missingPrices: string[] = []
  let mv = 0
  let fxPnl = 0
  let complete = true
  const allocation: RealSummary['allocation'] = []
  for (const h of holdings) {
    const p = priceOf(h.security_id)
    if (!p) {
      missingPrices.push(h.security_id)
      complete = false
      continue
    }
    const fx = p.currency === 'KRW' ? 1 : fxNow
    if (fx === null) {
      complete = false
      continue
    }
    const v = h.shares * p.price * fx
    mv += v
    if (p.currency !== 'KRW') fxPnl += h.costCcy * (fx - h.avgFx)
    allocation.push({ security_id: h.security_id, valueKrw: v, pct: 0 })
  }
  const marketValue = complete ? mv + cash : null
  const total = allocation.reduce((s, a) => s + a.valueKrw, 0) + Math.max(0, cash)
  for (const a of allocation) a.pct = total > 0 ? (a.valueKrw / total) * 100 : 0
  if (cash > 0) allocation.push({ security_id: 'cash', valueKrw: cash, pct: total > 0 ? (cash / total) * 100 : 0 })
  const unrealized = complete ? mv - holdings.reduce((s, h) => s + h.costKrw, 0) : null
  const irr = marketValue !== null && flows.length ? xirr([...flows, { date: today, amount: marketValue }]) : null
  return {
    deposits,
    withdrawals,
    cash,
    holdings,
    marketValue,
    realized,
    unrealized,
    dividends,
    fees,
    taxes,
    fxPnl: complete ? fxPnl : null,
    totalReturnPct: marketValue !== null && deposits > 0 ? ((marketValue + withdrawals - deposits) / deposits) * 100 : null,
    cagrPct: irr === null ? null : irr * 100,
    allocation,
    missingPrices,
  }
}

/** 월 적립 계획(원문 12.2) — 60/30/10. 원 단위로 반올림, 나머지는 현금. */
export function monthlyPlan(budget: number, pct: { equity: number; bond: number; cash: number }) {
  const equity = Math.round((budget * pct.equity) / 100)
  const bond = Math.round((budget * pct.bond) / 100)
  return { equity, bond, cash: budget - equity - bond }
}

/** DY 장기투자 시뮬레이터 — 매년 말 적립 · 수익 전액 재투자 · 일정 수익률 단순 복리(세금 · 수수료 · 환율 · 물가 · 중도인출 미반영). */
export function longTermSim(yearly: number, years: number, ratePct: number) {
  const r = ratePct / 100
  const final = r === 0 ? yearly * years : yearly * ((Math.pow(1 + r, years) - 1) / r)
  const principal = yearly * years
  return { final, principal, gains: final - principal }
}

/** Paper 포지션 — 매수 · 매도 줄로 종목별 보유와 실현/평가 수익(USD). */
export function paperSummary(txs: readonly InvPaperTx[], lastPrice: (id: string) => InvPrice | null) {
  const pos = new Map<string, { shares: number; cost: number; realized: number; opened: string }>()
  for (const t of [...txs].sort((a, b) => a.trade_date.localeCompare(b.trade_date))) {
    const p = pos.get(t.security_id) ?? { shares: 0, cost: 0, realized: 0, opened: t.trade_date }
    if (t.side === 'buy') {
      p.shares += t.shares
      p.cost += t.shares * t.price
    } else if (p.shares > 0) {
      const frac = Math.min(1, t.shares / p.shares)
      p.realized += t.shares * t.price - p.cost * frac
      p.cost -= p.cost * frac
      p.shares -= t.shares
    }
    pos.set(t.security_id, p)
  }
  const rows = [...pos].map(([security_id, p]) => {
    const lp = lastPrice(security_id)
    const value = lp && p.shares > 0 ? p.shares * lp.close : p.shares > 0 ? null : 0
    return { security_id, ...p, value, lastPrice: lp, unrealized: value === null ? null : value - p.cost }
  })
  const invested = txs.filter((t) => t.side === 'buy').reduce((s, t) => s + t.shares * t.price, 0)
  const realized = rows.reduce((s, r) => s + r.realized, 0)
  const unrealized = rows.some((r) => r.unrealized === null) ? null : rows.reduce((s, r) => s + (r.unrealized ?? 0), 0)
  return { rows, invested, realized, unrealized, returnPct: unrealized === null || invested === 0 ? null : ((realized + unrealized) / invested) * 100 }
}
