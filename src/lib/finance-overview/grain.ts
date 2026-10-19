import { addMonths, computePl, type Ctx } from './engine'

/** 월 · 분기 · 년 — 고른 달이 속한 묶음의 달들(그 달까지)과 앞 묶음 · 전년 같은 묶음. */
export type Grain = 'month' | 'quarter' | 'year'

export function grainMonths(period: string, grain: Grain): string[] {
  const [y, m] = period.split('-').map(Number)
  const start = grain === 'month' ? m : grain === 'quarter' ? Math.floor((m - 1) / 3) * 3 + 1 : 1
  return Array.from({ length: m - start + 1 }, (_, i) => `${y}-${String(start + i).padStart(2, '0')}`)
}

export function grainLabel(period: string, grain: Grain): string {
  const [y, m] = period.split('-').map(Number)
  if (grain === 'month') return `${m}월`
  if (grain === 'quarter') return `${Math.floor((m - 1) / 3) + 1}분기`
  return `${y}년`
}

/** 앞 묶음의 마지막 달(월 = 앞 달 · 분기 = 앞 분기 끝 · 년 = 전년 같은 달). */
export function prevGrainEnd(period: string, grain: Grain): string {
  if (grain === 'month') return addMonths(period, -1)
  if (grain === 'quarter') return addMonths(grainMonths(period, 'quarter')[0], -1)
  return addMonths(period, -12)
}

export interface PlSum {
  revenue: number | null
  cogs: number | null
  gross: number | null
  sga: number | null
  op: number | null
  nonop: number | null
  net: number | null
  months: number
  missing: string[]
}

/** 여러 달 손익 합(계산 못 한 달은 빼고 «빠진 달»에 적는다). 한 달도 없으면 전부 null. */
export function plSum(ctx: Ctx, months: string[]): PlSum {
  const keys = ['revenue', 'cogs', 'gross', 'sga', 'op', 'nonop', 'net'] as const
  const out: PlSum = { revenue: null, cogs: null, gross: null, sga: null, op: null, nonop: null, net: null, months: 0, missing: [] }
  for (const p of months) {
    const r = computePl(ctx, p)
    if (r.source === 'none' && r.revenue === null) {
      out.missing.push(p)
      continue
    }
    out.months += 1
    for (const k of keys) {
      const v = r[k]
      if (v !== null) out[k] = (out[k] ?? 0) + v
    }
  }
  return out
}
