import type {
  Account,
  AccountSection,
  BusinessId,
  Figure,
  FinanceKpi,
  FinanceLedger,
  FinanceMetric,
  PeriodKey,
} from '@/types'
import { PL_SECTIONS } from '@/types'

import { addMonths, basisOf, figureOf, periodOfDate, sumFigures } from './basis'

/**
 * 원천(전표·결산) → 계정 × 월의 한 칸 → 8개 지표.
 *
 * 규칙은 셋이다. 0015의 finance_kpis 뷰가 같은 셋을 SQL로 쓴다 — 어긋나면 대시보드(뷰)와
 * 재무 화면(여기)이 같은 달을 다른 숫자로 말한다. scripts/check-finance-ledger.ts와
 * PGlite 검증이 둘 다 06_Dummy_Data 시트값과 맞는지 잰다.
 *
 *   ① 결산이 있는 달은 결산만 본다. 결산은 시산표 한 벌이다 — 계정 몇 개만 전표로 채워 섞으면
 *      자산 = 부채 + 자본이 깨진다.
 *   ② 결산이 없는 달은 전표로 만든다. 손익 계정은 그 달의 발생액,
 *      상태표 계정은 '직전 결산 잔액 + 그 뒤 전표'. 직전 결산이 없으면 전표 누계다.
 *   ③ 값은 차변 − 대변. 매출·부채·자본은 음수다. 부호를 뒤집는 곳은 지표 공식(metricsOf)과
 *      화면 행(statements.ts)뿐이다.
 */

export interface AccountCell {
  account_code: string
  /** 차변 − 대변. 손익은 월 발생액, 상태표는 월말 잔액. */
  amount: Figure
}

export interface PeriodCells {
  business_id: BusinessId
  period: PeriodKey
  /** 결산(가마감 포함)에서 왔나, 전표에서 만들었나. 화면이 '전표 기준' 주석을 달지 여부를 정한다. */
  from: 'closing' | 'journal'
  cells: Map<string, AccountCell>
}

const BS_SECTION = new Set<AccountSection>([
  'cash',
  'receivable',
  'other_asset',
  'payable',
  'other_liability',
  'equity',
])
const PL_SECTION = new Set<AccountSection>(PL_SECTIONS)

export function isBalanceSheet(a: Pick<Account, 'section'>): boolean {
  return BS_SECTION.has(a.section)
}

/** 회사 하나의 원천을 한 번 훑어 월별 칸을 전부 만든다. 화면이 달을 바꿀 때마다 다시 훑지 않게. */
export function buildCells(ledger: FinanceLedger, businessId: BusinessId): Map<PeriodKey, PeriodCells> {
  const accounts = new Map(
    ledger.accounts.filter((a) => a.business_id === businessId).map((a) => [a.account_code, a]),
  )
  const closings = ledger.closings.filter((c) => c.business_id === businessId)
  const journal = ledger.journal.filter((j) => j.business_id === businessId)

  const closedPeriods = new Set(closings.map((c) => c.period))
  const periods = [
    ...new Set([...closedPeriods, ...journal.map((j) => periodOfDate(j.entry_date))]),
  ].sort()

  // 전표를 월 × 계정으로 한 번만 접는다.
  const activity = new Map<PeriodKey, Map<string, Figure[]>>()
  for (const j of journal) {
    const p = periodOfDate(j.entry_date)
    const byAccount = activity.get(p) ?? new Map<string, Figure[]>()
    const list = byAccount.get(j.account_code) ?? []
    list.push(figureOf(j.side === 'debit' ? j.amount : -j.amount, j))
    byAccount.set(j.account_code, list)
    activity.set(p, byAccount)
  }

  const out = new Map<PeriodKey, PeriodCells>()
  for (const period of periods) {
    if (closedPeriods.has(period)) {
      const cells = new Map<string, AccountCell>()
      for (const c of closings.filter((x) => x.period === period)) {
        cells.set(c.account_code, { account_code: c.account_code, amount: figureOf(c.amount, c) })
      }
      out.set(period, { business_id: businessId, period, from: 'closing', cells })
      continue
    }

    // ② 직전 결산 — 그 달의 상태표 잔액이 출발점이다.
    const priorClose = [...closedPeriods].filter((p) => p < period).sort().at(-1)
    const cells = new Map<string, AccountCell>()

    for (const [code, figs] of activity.get(period) ?? []) {
      const a = accounts.get(code)
      if (a && PL_SECTION.has(a.section)) {
        cells.set(code, { account_code: code, amount: sumFigures(figs)! })
      }
    }

    for (const a of accounts.values()) {
      if (!isBalanceSheet(a)) continue
      const parts: Figure[] = []
      if (priorClose) {
        const opening = out.get(priorClose)?.cells.get(a.account_code)
        if (opening) parts.push(opening.amount)
      }
      for (let p = priorClose ? addMonths(priorClose, 1) : periods[0]; p <= period; p = addMonths(p, 1)) {
        parts.push(...(activity.get(p)?.get(a.account_code) ?? []))
      }
      const sum = sumFigures(parts)
      if (sum) cells.set(a.account_code, { account_code: a.account_code, amount: sum })
    }

    out.set(period, { business_id: businessId, period, from: 'journal', cells })
  }
  return out
}

/** 한 칸들의 구분별 합(차변 − 대변). 없으면 null. */
export function sectionSum(
  cells: Map<string, AccountCell>,
  accounts: Map<string, Account>,
  sections: AccountSection[],
): Figure | null {
  const want = new Set(sections)
  return sumFigures(
    [...cells.values()]
      .filter((c) => {
        const a = accounts.get(c.account_code)
        return a !== undefined && want.has(a.section)
      })
      .map((c) => c.amount),
  )
}

/**
 * 8개 지표 공식. 0015 finance_kpis 뷰의 '지표' 절과 한 줄씩 대응한다.
 *
 * EBITDA를 시트에서 받지 않고 계산하는 것은 DEFERRED D-01의 Phase 2 약속이다.
 * 단 D-01이 드러낸 시트의 모순(Revenue − Cost < EBITDA인 달)은 mock이 '시트 정합 조정' 계정으로
 * 명시적으로 옮겨 온다 — 공식을 바꿔 맞추지 않는다(lib/ecount/mock.ts).
 *
 * 전부 원천이 없는 지표는 결과에서 빠진다. 0으로 채우지 않는다.
 */
export function metricsOf(
  cells: Map<string, AccountCell>,
  accounts: Map<string, Account>,
): Partial<Record<FinanceMetric, Figure>> {
  const neg = (f: Figure | null) => (f ? { ...f, value: -f.value } : null)
  const s = (...sections: AccountSection[]) => sectionSum(cells, accounts, sections)

  const out: Partial<Record<FinanceMetric, Figure | null>> = {
    Revenue: neg(s('revenue')),
    Cost: s('cogs'),
    EBITDA: neg(s('revenue', 'cogs', 'sga')),
    OperatingProfit: neg(s('revenue', 'cogs', 'sga', 'd_and_a')),
    NetIncome: neg(s('revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax')),
    Cash: s('cash'),
    AR: s('receivable'),
    AP: neg(s('payable')),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null)) as Partial<
    Record<FinanceMetric, Figure>
  >
}

export function accountMap(ledger: FinanceLedger, businessId: BusinessId): Map<string, Account> {
  return new Map(
    ledger.accounts.filter((a) => a.business_id === businessId).map((a) => [a.account_code, a]),
  )
}

/**
 * dummy 모드의 finance_kpis. live에서는 0015의 뷰가 같은 일을 한다.
 * 출처 세 칸은 Figure에서 되돌린다 — basis가 이미 판정이 끝난 값이라 source/closed로 역산한다.
 */
export function kpisFromLedger(ledger: FinanceLedger, businessIds: BusinessId[]): FinanceKpi[] {
  const rows: FinanceKpi[] = []
  for (const id of businessIds) {
    const accounts = accountMap(ledger, id)
    for (const pc of buildCells(ledger, id).values()) {
      for (const [metric, f] of Object.entries(metricsOf(pc.cells, accounts))) {
        rows.push({
          period: pc.period,
          business_id: id,
          metric: metric as FinanceMetric,
          value: f.value,
          currency: 'KRW',
          source: f.basis === 'manual' ? 'manual' : f.basis === 'estimate' ? 'estimate' : 'ecount',
          closed: f.basis === 'confirmed',
          fetched_at: f.fetched_at ?? '',
        })
      }
    }
  }
  return rows
}

/** FinanceKpi 한 칸을 화면용 Figure로. 대시보드 KPI 스트립이 쓴다. */
export function kpiFigure(k: FinanceKpi): Figure {
  return { value: k.value, basis: basisOf(k), fetched_at: k.fetched_at || null }
}
