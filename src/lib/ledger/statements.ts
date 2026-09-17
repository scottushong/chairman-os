import type { AccountSection, Figure, PeriodKey } from '@/types'
import { ACCOUNT_SECTION_LABEL_KO, CASH_FLOW_CLASS, CASH_FLOW_CLASS_LABEL_KO } from '@/types'

import { addMonths, combine2, mapFigure, sumFigures } from './basis'
import type { LedgerScope } from './scope'

/**
 * 손익계산서 · 재무상태표 · 현금흐름표의 행.
 *
 * 계정별 원본이 먼저고 합계는 그 아래 선다. 합계만 보여 주면 '이 숫자가 어느 계정에서 왔나'를
 * 물을 자리가 없다. 계정 행은 ECOUNT 계정코드를 그대로 달고 나간다.
 *
 * 행의 key가 곧 화면의 앵커(id)다. KPI 카드의 숫자를 누르면 그 key로 내려온다(METRIC_ANCHOR).
 *
 * 부호: 원천은 차변 − 대변이지만 화면은 사람이 읽는 부호로 쓴다.
 *   손익 — 매출·이익은 +, 비용도 +(비용이 크다 = 양수가 크다). 영업외수익은 비용 음수로 선다.
 *   상태표 — 자산·부채·자본 모두 잔액을 +로.
 */

export type StatementKind = 'is' | 'bs' | 'cf'

export const STATEMENT_LABEL_KO: Record<StatementKind, string> = {
  is: '손익계산서',
  bs: '재무상태표',
  cf: '현금흐름표',
}

export interface StatementRow {
  key: string
  kind: 'account' | 'section' | 'subtotal' | 'total' | 'note'
  label: string
  account_code?: string
  /** 당월(손익·현금흐름) / 당월말(상태표) */
  current: Figure | null
  /** 손익: 전년동월 / 상태표: 전월말 / 현금흐름: 없음 */
  prior: Figure | null
  /** 손익: 없음 / 상태표: 전년동월말 */
  priorYear: Figure | null
  /** 손익·현금흐름: 연초부터 누계. 빠진 달이 있으면 null */
  ytd: Figure | null
}

/** KPI 카드의 숫자를 누르면 내려갈 자리. */
export const METRIC_ANCHOR = {
  Revenue: { tab: 'is', key: 'total-revenue' },
  Cost: { tab: 'is', key: 'total-cogs' },
  EBITDA: { tab: 'is', key: 'total-ebitda' },
  OperatingProfit: { tab: 'is', key: 'total-op' },
  NetIncome: { tab: 'is', key: 'total-ni' },
  Cash: { tab: 'bs', key: 'sec-cash' },
  AR: { tab: 'bs', key: 'sec-receivable' },
  AP: { tab: 'bs', key: 'sec-payable' },
} as const satisfies Record<string, { tab: StatementKind; key: string }>

const CREDIT_NORMAL = new Set<AccountSection>(['revenue', 'payable', 'other_liability', 'equity'])

function display(section: AccountSection, f: Figure | null): Figure | null {
  return f && CREDIT_NORMAL.has(section) ? mapFigure(f, (v) => -v) : f
}

function codesIn(scope: LedgerScope, sections: AccountSection[]): string[] {
  return [...scope.accounts.values()]
    .filter((a) => sections.includes(a.section))
    .map((a) => a.account_code)
    .sort()
}

/** 연초부터 period까지 모든 달이 있을 때만 더한다. 빠진 달을 조용히 건너뛴 누계는 누계가 아니다. */
function ytdOf(scope: LedgerScope, period: PeriodKey, at: (p: PeriodKey) => Figure | null): Figure | null {
  const parts: (Figure | null)[] = []
  for (let p = `${period.slice(0, 4)}-01`; p <= period; p = addMonths(p, 1)) {
    if (!scope.periods.includes(p)) return null
    parts.push(at(p))
  }
  return sumFigures(parts)
}

// ---------------------------------------------------------------------------
// 손익계산서
// ---------------------------------------------------------------------------

const PL_BLOCKS: { sections: AccountSection[]; key: string; label: string; total?: { key: string; label: string } }[] = [
  { sections: ['revenue'], key: 'total-revenue', label: '매출액' },
  { sections: ['cogs'], key: 'total-cogs', label: '매출원가', total: { key: 'total-gross', label: '매출총이익' } },
  { sections: ['sga'], key: 'total-sga', label: '판매비와관리비', total: { key: 'total-ebitda', label: 'EBITDA' } },
  { sections: ['d_and_a'], key: 'total-d_and_a', label: '감가상각비', total: { key: 'total-op', label: '영업이익' } },
  {
    sections: ['non_operating', 'tax'],
    key: 'total-below',
    label: '영업외손익 · 법인세',
    total: { key: 'total-ni', label: '당기순이익' },
  },
]

export function incomeStatement(scope: LedgerScope, period: PeriodKey): StatementRow[] {
  const rows: StatementRow[] = []
  const ly = addMonths(period, -12)

  const accountAt = (code: string) => (p: PeriodKey) => {
    const a = scope.accounts.get(code)!
    return display(a.section, scope.cellsAt(p).get(code) ?? null)
  }
  const blockAt = (sections: AccountSection[]) => (p: PeriodKey) =>
    sumFigures(codesIn(scope, sections).map((c) => accountAt(c)(p)))
  /** 여기까지 올라온 이익 = 매출 − 지금까지 나온 비용 구분들 */
  const profitAt = (costSections: AccountSection[]) => (p: PeriodKey) => {
    const revenue = blockAt(['revenue'])(p)
    const costs = blockAt(costSections)(p)
    if (!revenue && !costs) return null
    if (!costs) return revenue
    if (!revenue) return mapFigure(costs, (v) => -v)
    return combine2(revenue, costs, (r, c) => r - c)
  }

  const line = (key: string, kind: StatementRow['kind'], label: string, at: (p: PeriodKey) => Figure | null, code?: string): StatementRow => ({
    key,
    kind,
    label,
    account_code: code,
    current: at(period),
    prior: scope.periods.includes(ly) ? at(ly) : null,
    priorYear: null,
    ytd: ytdOf(scope, period, at),
  })

  const costSoFar: AccountSection[] = []
  for (const block of PL_BLOCKS) {
    for (const code of codesIn(scope, block.sections)) {
      rows.push(line(`acct-${code}`, 'account', scope.accounts.get(code)!.name, accountAt(code), code))
    }
    rows.push(line(block.key, 'subtotal', block.label, blockAt(block.sections)))
    if (block.sections[0] !== 'revenue') costSoFar.push(...block.sections)
    if (block.total) rows.push(line(block.total.key, 'total', block.total.label, profitAt([...costSoFar])))
  }
  return rows
}

// ---------------------------------------------------------------------------
// 재무상태표
// ---------------------------------------------------------------------------

const BS_GROUPS: { key: string; label: string; sections: AccountSection[] }[] = [
  { key: 'total-assets', label: '자산총계', sections: ['cash', 'receivable', 'other_asset'] },
  { key: 'total-liabilities', label: '부채총계', sections: ['payable', 'other_liability'] },
  { key: 'total-equity', label: '자본총계', sections: ['equity'] },
]

export function balanceSheet(scope: LedgerScope, period: PeriodKey): StatementRow[] {
  const rows: StatementRow[] = []
  const has = (p: PeriodKey) => scope.periods.includes(p)
  const accountAt = (code: string) => (p: PeriodKey) =>
    display(scope.accounts.get(code)!.section, scope.cellsAt(p).get(code) ?? null)
  const groupAt = (sections: AccountSection[]) => (p: PeriodKey) =>
    sumFigures(codesIn(scope, sections).map((c) => accountAt(c)(p)))

  /**
   * 누적손익. 손익 계정을 이익잉여금으로 옮기는 마감분개가 원장에 없으면 상태표가 그만큼 비어 닫히지 않는다.
   * 자산 − 부채 − 자본 계정으로 계산해서 보여 준다 — 복식부기 항등식이라 지어낸 숫자가 아니지만,
   * '계산'이라고 이름에 적는다.
   */
  const retainedAt = (p: PeriodKey) => {
    const a = groupAt(['cash', 'receivable', 'other_asset'])(p)
    const l = groupAt(['payable', 'other_liability'])(p)
    const e = groupAt(['equity'])(p)
    if (!a) return null
    let out = a
    if (l) out = combine2(out, l, (x, y) => x - y)
    if (e) out = combine2(out, e, (x, y) => x - y)
    return out
  }

  const line = (key: string, kind: StatementRow['kind'], label: string, at: (p: PeriodKey) => Figure | null, code?: string): StatementRow => ({
    key,
    kind,
    label,
    account_code: code,
    current: at(period),
    prior: has(addMonths(period, -1)) ? at(addMonths(period, -1)) : null,
    priorYear: has(addMonths(period, -12)) ? at(addMonths(period, -12)) : null,
    ytd: null,
  })

  for (const group of BS_GROUPS) {
    for (const section of group.sections) {
      const codes = codesIn(scope, [section])
      if (codes.length === 0) continue
      rows.push({ key: `sec-${section}`, kind: 'section', label: ACCOUNT_SECTION_LABEL_KO[section], current: null, prior: null, priorYear: null, ytd: null })
      for (const code of codes) {
        rows.push(line(`acct-${code}`, 'account', scope.accounts.get(code)!.name, accountAt(code), code))
      }
    }
    if (group.key === 'total-equity') {
      rows.push(line('calc-retained', 'account', '누적손익 (계산)', retainedAt))
      rows.push(line(group.key, 'subtotal', group.label, (p) => sumFigures([groupAt(group.sections)(p), retainedAt(p)])))
    } else {
      rows.push(line(group.key, 'subtotal', group.label, groupAt(group.sections)))
    }
  }
  rows.push(
    line('total-le', 'total', '부채와자본총계', (p) =>
      sumFigures([groupAt(['payable', 'other_liability'])(p), groupAt(['equity'])(p), retainedAt(p)]),
    ),
  )
  return rows
}

// ---------------------------------------------------------------------------
// 현금흐름표 (간접법)
// ---------------------------------------------------------------------------

/**
 * 간접법으로 만든다. 결산에는 전표가 없어서 '이 현금이 어느 거래에서 나왔나'를 따라갈 수 없다 —
 * 결산 달과 전표 달이 같은 방식으로 나오려면 잔액의 변화에서 거꾸로 가는 수밖에 없다.
 *
 *   영업활동 = 당기순이익 + 감가상각비 − (영업 계정 잔액 증가분)
 *   투자활동 = −(투자 계정 잔액 증가분)
 *   재무활동 = −(재무 계정 잔액 증가분)
 * 현금흐름 분류가 없는(null) 비현금 계정은 빠진다 — 감가상각누계액은 상각비로 이미 더했다.
 * 분류가 빠진 계정이 있으면 합이 현금 증감과 어긋난다. 그래서 검산 줄을 둔다.
 */
export function cashFlowStatement(scope: LedgerScope, period: PeriodKey): StatementRow[] {
  const memo = new Map<PeriodKey, StatementRow[] | null>()
  const monthly = (p: PeriodKey) => {
    if (!memo.has(p)) memo.set(p, cashFlowMonth(scope, p))
    return memo.get(p)!
  }
  const now = monthly(period)
  if (!now) {
    return [
      {
        key: 'cf-unavailable',
        kind: 'note',
        label: '전월 잔액이 없어 현금흐름을 만들 수 없습니다 (원장의 첫 달).',
        current: null,
        prior: null,
        priorYear: null,
        ytd: null,
      },
    ]
  }
  return now.map((row) => ({
    ...row,
    ytd:
      row.kind === 'note' || row.key === 'cf-open' || row.key === 'cf-close'
        ? null
        : ytdOf(scope, period, (p) => monthly(p)?.find((r) => r.key === row.key)?.current ?? null),
  }))
}

function cashFlowMonth(scope: LedgerScope, period: PeriodKey): StatementRow[] | null {
  const prev = addMonths(period, -1)
  if (!scope.periods.includes(prev)) return null

  const cur = scope.cellsAt(period)
  const old = scope.cellsAt(prev)
  const row = (key: string, kind: StatementRow['kind'], label: string, current: Figure | null, code?: string): StatementRow => ({
    key, kind, label, account_code: code, current, prior: null, priorYear: null, ytd: null,
  })

  /** 잔액 증가분의 반대 = 현금 영향. 한쪽 달에만 있는 계정은 다른 쪽을 0으로 본다. */
  const cashEffect = (code: string): Figure | null => {
    const a = cur.get(code) ?? null
    const b = old.get(code) ?? null
    if (!a && !b) return null
    if (!a) return b
    if (!b) return mapFigure(a, (v) => -v)
    return combine2(a, b, (x, y) => -(x - y))
  }

  const pl = (sections: AccountSection[]) =>
    sumFigures(codesIn(scope, sections).map((c) => cur.get(c) ?? null))
  const netIncome = (() => {
    const f = pl(['revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax'])
    return f ? mapFigure(f, (v) => -v) : null
  })()
  const dna = pl(['d_and_a'])

  const rows: StatementRow[] = []
  const totals: (Figure | null)[] = []
  for (const cls of CASH_FLOW_CLASS) {
    const parts: (Figure | null)[] = []
    if (cls === 'operating') {
      rows.push(row('cf-ni', 'account', '당기순이익', netIncome))
      rows.push(row('cf-dna', 'account', '감가상각비 가산', dna))
      parts.push(netIncome, dna)
    }
    const codes = [...scope.accounts.values()]
      .filter((a) => a.cash_flow === cls && a.section !== 'cash' && ['receivable', 'other_asset', 'payable', 'other_liability', 'equity'].includes(a.section))
      .map((a) => a.account_code)
      .sort()
    for (const code of codes) {
      const effect = cashEffect(code)
      rows.push(row(`cf-${code}`, 'account', `${scope.accounts.get(code)!.name} 증감`, effect, code))
      parts.push(effect)
    }
    const subtotal = sumFigures(parts)
    rows.push(row(`total-cf-${cls}`, 'subtotal', `${CASH_FLOW_CLASS_LABEL_KO[cls]} 현금흐름`, subtotal))
    totals.push(subtotal)
  }

  const change = sumFigures(totals)
  const cashCodes = codesIn(scope, ['cash'])
  const open = sumFigures(cashCodes.map((c) => old.get(c) ?? null))
  const close = sumFigures(cashCodes.map((c) => cur.get(c) ?? null))
  rows.push(row('total-cf-change', 'total', '현금 증감', change))
  rows.push(row('cf-open', 'account', '기초 현금', open))
  rows.push(row('cf-close', 'account', '기말 현금', close))

  if (change && open && close && Math.round(open.value + change.value - close.value) !== 0) {
    rows.push(
      row(
        'cf-check',
        'note',
        '검산 불일치 — 현금흐름 분류가 빠진 계정이 있습니다 (계정과목표 확인)',
        combine2(combine2(open, change, (a, b) => a + b), close, (a, b) => a - b),
      ),
    )
  }
  return rows
}

export function statementRows(kind: StatementKind, scope: LedgerScope, period: PeriodKey): StatementRow[] {
  if (kind === 'is') return incomeStatement(scope, period)
  if (kind === 'bs') return balanceSheet(scope, period)
  return cashFlowStatement(scope, period)
}

/** 현금흐름표 한 달의 활동별 합. Runway와 야간 브리핑이 쓴다. */
export function cashFlowTotals(
  scope: LedgerScope,
  period: PeriodKey,
): { operating: Figure | null; investing: Figure | null; financing: Figure | null } | null {
  const rows = cashFlowMonth(scope, period)
  if (!rows) return null
  const pick = (cls: string) => rows.find((r) => r.key === `total-cf-${cls}`)?.current ?? null
  return { operating: pick('operating'), investing: pick('investing'), financing: pick('financing') }
}
