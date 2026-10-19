import { KIND_SPECS, type UploadKind } from '@/lib/finance-upload/kinds'
import type { ChairmanRepository as Repository } from '@/lib/repository/types'
import type { FinUpload, MonthlyPlView } from '@/types'

/**
 * PHASE 8 «대표 대시보드»(스위치 'chairman_dashboard' · 기본 대표만) — 대표 홈 확장. 숫자는 0085 «재무 현황» 저장본(자동 계산 · 잠정)을 먼저,
 * 내부 마감 확정(0075 fin_pl_month final)이 있으면 그것을 — 재무 현황 화면과 같은 값이다.
 *   · 월 → 분기 → 년: 그 달들의 fin_pl_month 값(매출 · 영업이익 · 현금 순증감)을 더한다. 한 달이라도 확정이 아니면 그 묶음은 «잠정».
 *     값이 없는 달(미입력)이 섞이면 «일부 달 없음»으로 적고 더한 값은 있는 달만.
 *   · 일 · 주: 0075는 달 단위다 — 나누지 않는다(지어내지 않음). 화면에 그렇게 적는다.
 *   · 14가지 자료 «받은 것 / 없는 것»: 0070 fin_uploads에서 status 'applied'인 (종류 · 달).
 */

export type TrendGrain = 'month' | 'quarter' | 'year'
export const TREND_GRAIN_KO: Record<TrendGrain | 'day' | 'week', string> = { day: '일', week: '주', month: '월', quarter: '분기', year: '년' }

export interface TrendMonth {
  period: string
  /** null = 그 달 손익을 못 읽음(스위치 꺼짐 · 권한 · 미입력). */
  status: MonthlyPlView['view_status'] | null
  revenue: number | null
  operating_income: number | null
  cash_net: number | null
}

export interface TrendRow {
  key: string
  label: string
  months: number
  missing: number
  /** final = 모든 달이 내부 마감 확정 · provisional = 하나라도 잠정 · 입력 중. */
  basis: 'final' | 'provisional'
  revenue: number | null
  operating_income: number | null
  cash_net: number | null
}

/** 오늘(YYYY-MM-DD) 기준 지난 n달(이번 달 포함, 오래된 것 먼저). */
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i -= 1) {
    const t = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

const keyOf = (period: string, grain: TrendGrain) => {
  const [y, m] = period.split('-').map(Number)
  if (grain === 'month') return { key: period, label: `${y}년 ${m}월` }
  if (grain === 'quarter') return { key: `${y}-Q${Math.floor((m - 1) / 3) + 1}`, label: `${y}년 ${Math.floor((m - 1) / 3) + 1}분기` }
  return { key: String(y), label: `${y}년` }
}

const addN = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b)

export function rollTrend(months: readonly TrendMonth[], grain: TrendGrain): TrendRow[] {
  const rows = new Map<string, TrendRow>()
  for (const x of months) {
    const { key, label } = keyOf(x.period, grain)
    const r = rows.get(key) ?? { key, label, months: 0, missing: 0, basis: 'final' as const, revenue: null, operating_income: null, cash_net: null }
    r.months += 1
    if (x.status === null || x.status === 'entering' || x.revenue === null) r.missing += 1
    if (x.status !== 'final') r.basis = 'provisional'
    r.revenue = addN(r.revenue, x.revenue)
    r.operating_income = addN(r.operating_income, x.operating_income)
    r.cash_net = addN(r.cash_net, x.cash_net)
    rows.set(key, r)
  }
  return [...rows.values()]
}

/** 14가지(①~⑭) — 0070 «회계 · 재무 자료 올리기» 첫 열넷. */
export const FOURTEEN: readonly { kind: UploadKind; no: string; label: string }[] = KIND_SPECS.slice(0, 14).map((k) => ({ kind: k.kind, no: k.no, label: k.label }))

export function receivedSet(uploads: readonly FinUpload[]): Set<string> {
  return new Set(uploads.filter((u) => u.status === 'applied' && u.period).map((u) => `${u.kind}:${u.period}`))
}

export interface ChairDashboardData {
  months: TrendMonth[]
  received: Set<string>
  uploadsError: boolean
}

export async function loadChairDashboard(repo: Repository, businessId: string, today: string, n = 12): Promise<ChairDashboardData> {
  const periods = lastMonths(today, n)
  // 0085 — 재무 현황 저장본(자동 계산 · 잠정)을 먼저 쓴다. 내부 마감 확정(0075 final)이 있으면 그것이 이긴다.
  const snaps = new Map((await repo.listFinOverviewMonths(businessId, periods).catch(() => [])).map((r) => [r.period, r]))
  const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const months = await Promise.all(
    periods.map(async (period): Promise<TrendMonth> => {
      let v: MonthlyPlView | null = null
      try {
        v = await repo.finPlMonth(businessId, period)
      } catch {
        v = null
      }
      const snap = snaps.get(period)
      if (v && v.view_status === 'final') return { period, status: v.view_status, revenue: v.result.pl.revenue, operating_income: v.result.pl.operating_income, cash_net: v.result.cash.net }
      if (snap) {
        const pl = (snap.totals.pl ?? {}) as Record<string, unknown>
        const cash = (snap.totals.cash ?? {}) as Record<string, unknown>
        if (n0(pl.revenue) !== null || n0(cash.net) !== null) {
          return { period, status: 'provisional', revenue: n0(pl.revenue), operating_income: n0(pl.op) ?? (v ? v.result.pl.operating_income : null), cash_net: n0(cash.net) ?? (v ? v.result.cash.net : null) }
        }
      }
      if (!v) return { period, status: null, revenue: null, operating_income: null, cash_net: null }
      return { period, status: v.view_status, revenue: v.result.pl.revenue, operating_income: v.result.pl.operating_income, cash_net: v.result.cash.net }
    }),
  )
  let uploads: FinUpload[] = []
  let uploadsError = false
  try {
    uploads = await repo.listFinUploads(businessId)
  } catch {
    uploadsError = true
  }
  return { months, received: receivedSet(uploads), uploadsError }
}
