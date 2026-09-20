import type { AccountSection } from '@/types'

/**
 * 공식 재무제표의 검증과 소계 (Phase 2-C 블록 1).
 *
 * **부호 규약.** 0015의 원장은 `amount = 차변 − 대변`이다. 매출·부채·자본은 대변이라
 * 음수로 앉는다. 화면은 사람이 읽는 양수로 보여 줘야 하므로 여기서 뒤집는다.
 * 뒤집기를 한 군데라도 빠뜨리면 자산과 부채가 **더해져** 재무상태표가 닫힌 것처럼 보인다 —
 * 그게 이 파일에서 가장 위험한 실수고, scripts/check-statements.ts가 그것만 본다.
 *
 * 소계 공식은 0015의 finance_kpis 뷰에서 그대로 가져왔다. 화면이 제 공식을 따로 쓰면
 * 같은 회사의 영업이익이 이 화면과 대시보드에서 다르게 나온다.
 */

export interface StatementLine {
  account_code: string
  section: AccountSection
  /** 원장 규약 그대로. 차변 양수 / 대변 음수. */
  amount: number
}

const ASSET_SECTIONS: AccountSection[] = ['cash', 'receivable', 'other_asset']
const LIABILITY_SECTIONS: AccountSection[] = ['payable', 'other_liability']
const EQUITY_SECTIONS: AccountSection[] = ['equity']

export const BALANCE_SHEET_SECTIONS: AccountSection[] = [
  ...ASSET_SECTIONS,
  ...LIABILITY_SECTIONS,
  ...EQUITY_SECTIONS,
]

export const INCOME_SECTIONS: AccountSection[] = [
  'revenue',
  'cogs',
  'sga',
  'd_and_a',
  'non_operating',
  'tax',
]

function sumOf(lines: StatementLine[], sections: AccountSection[]): number {
  return lines.reduce((total, l) => (sections.includes(l.section) ? total + l.amount : total), 0)
}

export interface BalanceCheck {
  /** 사람이 읽는 양수. */
  assets: number
  liabilities: number
  equity: number
  /** 자산 − (부채 + 자본). 0이어야 닫힌다. */
  difference: number
  balanced: boolean
}

/**
 * 자산 = 부채 + 자본인가.
 *
 * 줄이 하나도 없으면 0 = 0이라 수식은 성립하지만 **닫혔다고 하지 않는다.**
 * 빈 재무제표가 확정으로 저장되는 길을 열어 두면, 그 회사의 '2025 결산 확정'이
 * 아무 숫자도 없는 행이 된다.
 */
export function balanceCheck(lines: StatementLine[]): BalanceCheck {
  const assets = sumOf(lines, ASSET_SECTIONS)
  const liabilities = -sumOf(lines, LIABILITY_SECTIONS)
  const equity = -sumOf(lines, EQUITY_SECTIONS)
  const difference = assets - (liabilities + equity)

  const hasAnyLine = lines.some((l) => BALANCE_SHEET_SECTIONS.includes(l.section))
  return { assets, liabilities, equity, difference, balanced: hasAnyLine && difference === 0 }
}

export interface IncomeSubtotals {
  revenue: number
  cogs: number
  grossProfit: number
  sga: number
  ebitda: number
  dAndA: number
  operatingProfit: number
  /** 영업외손익. **이익이 양수**고 비용이면 음수다. */
  nonOperating: number
  tax: number
  netIncome: number
}

/** 손익 소계. 입력이 아니라 계산된 줄이다 — 화면에서 고칠 수 없다. */
export function incomeSubtotals(lines: StatementLine[]): IncomeSubtotals {
  const revenue = -sumOf(lines, ['revenue'])
  const cogs = sumOf(lines, ['cogs'])
  const grossProfit = revenue - cogs
  const sga = sumOf(lines, ['sga'])
  const ebitda = grossProfit - sga
  const dAndA = sumOf(lines, ['d_and_a'])
  const operatingProfit = ebitda - dAndA
  const nonOperating = -sumOf(lines, ['non_operating'])
  const tax = sumOf(lines, ['tax'])

  return {
    revenue,
    cogs,
    grossProfit,
    sga,
    ebitda,
    dAndA,
    operatingProfit,
    nonOperating,
    tax,
    netIncome: operatingProfit + nonOperating - tax,
  }
}
