import type { DraftLine } from '@/lib/ledger/journal'
import type { AccountSection } from '@/types'

/**
 * 월별 간이 손익 → 요약 전표 (Phase 2-C 블록 2).
 *
 * 이 화면은 장부를 대신하지 않는다. **장부에 쓰는 편한 입구**다.
 * 회장이 넣은 한 달치 숫자를 복식부기 전표 한 장으로 접어 journal_lines에 넣고,
 * 그 뒤는 기존 경로(finance_ledger_cells → finance_kpis 뷰)가 그대로 읽는다.
 * 그래서 이 파일이 하는 일은 하나다 — **차변과 대변을 맞추는 것.**
 *
 * ## 손익 항목과 잔액 항목이 다르다
 *
 * 매출·비용은 그 달의 **발생액**이라 그대로 전표 줄이 된다.
 * 현금잔액·매출채권·매입채무는 **월말 잔액**이라 그대로 넣으면 안 된다 —
 * 전표는 움직임을 적는 것이고 잔액은 움직임의 결과다. 잔액 항목은 전월 잔액과의
 * **차이**를 줄로 만든다. 첫 달(전월 잔액이 없는 달)은 잔액 전체가 차이다.
 *
 * ## 남는 차액은 이익잉여금이 아니라 미분류로 간다
 *
 * 처음에 상대 계정을 이월이익잉여금으로 뒀다가 테스트에서 틀린 것을 잡았다.
 * 이익잉여금이 상대가 되는 것은 **마감 전표**(손익 계정을 자본으로 닫는 전표)이지
 * 한 달 활동을 적는 전표가 아니다. 활동의 상대는 현금·매출채권·매입채무이고,
 * 그래서 이 화면이 그 셋을 항목으로 받는다.
 *
 * 회장이 넣은 숫자가 서로 맞으면(이익이 현금·채권·채무의 움직임으로 설명되면)
 * 전표는 저절로 닫힌다. 안 맞는 만큼만 **미분류 계정 한 줄**로 남는다.
 * 그 줄을 이익잉여금에 섞으면 그 달 이익이 소리 없이 틀어지고,
 * 숨기면 회장이 자기 숫자가 안 맞는다는 사실을 영영 모른다. 그래서 화면이 그 줄을 보여 준다.
 */

export interface MonthlyRow {
  key: string
  label: string
  account_code: string
  section: AccountSection
  /** true = 그 달 발생액(손익) · false = 월말 잔액(재무상태) */
  flow: boolean
  /** 대변이 정상인 줄(매출·매입채무). 화면의 양수를 대변으로 읽는다. */
  credit: boolean
}

const row = (
  key: string,
  label: string,
  account_code: string,
  section: AccountSection,
  flow: boolean,
  credit = false,
): MonthlyRow => ({ key, label, account_code, section, flow, credit })

/**
 * 제조(DY 형) 기본 항목. 표준 계정과목표(0016)의 대표 계정에 붙인다.
 * '기타비용'은 소모품비에 붙였다 — 표준표에 잡비 계정이 없고, 새 계정과목 체계를
 * 이 화면에서 만들지 않기로 했기 때문이다(계정 추가는 계정과목 화면의 일이다).
 */
export const MANUFACTURING_ROWS: readonly MonthlyRow[] = [
  row('revenue', '매출', '4010', 'revenue', true, true),
  row('cogs', '매출원가', '4510', 'cogs', true),
  row('labor', '인건비', '8010', 'sga', true),
  row('rent', '임차·관리', '8220', 'sga', true),
  row('marketing', '마케팅', '8330', 'sga', true),
  row('outsourcing', '외주·용역', '4600', 'cogs', true),
  row('other_cost', '기타비용', '8300', 'sga', true),
  row('non_operating', '영업외손익', '9010', 'non_operating', true, true),
  row('cash', '현금잔액', '1030', 'cash', false),
  row('receivable', '매출채권', '1080', 'receivable', false),
  row('payable', '매입채무', '2010', 'payable', false, true),
]

/** 스타트업(간이형). 매출원가·외주를 빼고 시작한다. 항목 추가는 화면에서 한다. */
export const STARTUP_ROWS: readonly MonthlyRow[] = MANUFACTURING_ROWS.filter(
  (r) => r.key !== 'cogs' && r.key !== 'outsourcing',
).map((r) => (r.key === 'revenue' ? { ...r, account_code: '4030' } : r))

/**
 * 맞지 않는 차액이 앉는 자리. 표준 계정과목표(0016)에서 가계정 성격을 가진 유일한 계정이다.
 * 이 줄이 크면 그 달 입력이 서로 안 맞는다는 뜻이고, 화면이 그대로 경고한다.
 */
export const SUSPENSE_ACCOUNT = '1360'

export interface MonthlySlipInput {
  rows: readonly MonthlyRow[]
  /** rowKey → 회장이 넣은 값. 사람이 읽는 양수다. 없는 키는 0으로 본다. */
  values: Record<string, number>
  /** rowKey → 전월 말 잔액. 잔액 항목만 쓴다. 없으면 0(첫 달). */
  priorBalances?: Record<string, number>
}

export interface MonthlySlip {
  lines: DraftLine[]
  /** 차변 − 대변. 0이면 회장이 넣은 숫자끼리 맞은 것이다. */
  residual: number
}

/**
 * 한 달치를 전표 한 장으로.
 *
 * 값이 0인 줄은 넣지 않는다 — 열한 항목 중 대부분이 비는 달이 보통이고,
 * 0원 줄을 전부 넣으면 전표가 읽히지 않는다.
 */
export function buildMonthlySlip({ rows, values, priorBalances = {} }: MonthlySlipInput): MonthlySlip {
  const lines: DraftLine[] = []
  let debit = 0
  let credit = 0

  for (const r of rows) {
    const entered = values[r.key] ?? 0
    // 잔액 항목은 전월과의 차이가 곧 그 달의 움직임이다.
    const movement = r.flow ? entered : entered - (priorBalances[r.key] ?? 0)
    if (movement === 0) continue

    // 대변 줄(매출·매입채무)은 양수가 대변이다. 움직임이 음수면 방향이 뒤집힌다 —
    // 매출채권이 줄어든 달은 대변이고, 매입채무가 줄어든 달은 차변이다.
    const naturallyCredit = r.credit
    const isCredit = movement > 0 ? naturallyCredit : !naturallyCredit
    const amount = Math.abs(movement)

    lines.push({
      account_code: r.account_code,
      side: isCredit ? 'credit' : 'debit',
      amount,
      memo: r.label,
    })
    if (isCredit) credit += amount
    else debit += amount
  }

  // 전표는 반드시 닫힌다 — 닫히지 않으면 0016이 통째로 거부해 한 달치가 저장되지 않는다.
  // 차변이 모자라면 차변으로, 대변이 모자라면 대변으로 미분류 한 줄을 세운다.
  const residual = debit - credit
  if (residual !== 0) {
    lines.push({
      account_code: SUSPENSE_ACCOUNT,
      side: residual > 0 ? 'credit' : 'debit',
      amount: Math.abs(residual),
      memo: '미분류 차액 — 입력한 숫자가 서로 맞지 않습니다',
    })
  }

  return { lines, residual }
}
