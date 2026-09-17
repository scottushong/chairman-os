import type { AccountCategory, AccountSection, CashFlowClass } from '@/types'

/**
 * ECOUNT 계정코드 → Chairman OS 분류.
 *
 * ECOUNT가 주는 것은 코드와 이름뿐이다. '원가 구조에서 어느 막대인가(대분류)', '손익의 어느 단계인가(구분)',
 * '현금흐름표의 어느 활동인가'는 회사의 계정과목표를 보고 사람이 정한다.
 * mock은 아래 MOCK_CHART가 그 결정이다. 실제 회사의 분류는 코드가 아니라 DB의 accounts 표에 있다
 * (0016, /finance/[id]/accounts 화면에서 관리). 변환(map.ts)은 분류표를 인자로 받고,
 * 거기 없는 계정을 만나면 그 회사를 **멈춘다** — 분류를 모르는 계정을 '기타'로 넣으면 원가 구조가 조용히 틀린다.
 */

export interface AccountClassification {
  name: string
  category: AccountCategory
  section: AccountSection
  /** 현금 계정 자신과, 현금흐름에 넣지 않는 계정(감가상각누계액 — 상각비로 이미 더했다)은 null */
  cash_flow: CashFlowClass | null
}

/**
 * mock 계정과목표. 다섯 회사가 같은 코드를 쓴다 — 실제 회사들은 그렇지 않을 수 있다.
 * 코드는 한국 표준 계정 체계의 앞자리 관례(1 자산 / 2 부채 / 3 자본 / 4 매출·원가 / 8 판관비 / 9 영업외)를 따랐다.
 */
export const MOCK_CHART: AccountChart = {
  '1010': { name: '현금및현금성자산', category: 'asset', section: 'cash', cash_flow: null },
  '1080': { name: '외상매출금', category: 'asset', section: 'receivable', cash_flow: 'operating' },
  '1400': { name: '유형자산', category: 'asset', section: 'other_asset', cash_flow: 'investing' },
  '1410': { name: '감가상각누계액', category: 'asset', section: 'other_asset', cash_flow: null },
  '2010': { name: '외상매입금', category: 'liability', section: 'payable', cash_flow: 'operating' },
  '2600': { name: '차입금', category: 'liability', section: 'other_liability', cash_flow: 'financing' },
  '3310': { name: '자본금', category: 'equity', section: 'equity', cash_flow: 'financing' },
  '4010': { name: '제품매출', category: 'revenue', section: 'revenue', cash_flow: null },
  '4510': { name: '원재료비', category: 'raw_material', section: 'cogs', cash_flow: null },
  '4520': { name: '제조인건비', category: 'labor', section: 'cogs', cash_flow: null },
  '4530': { name: '전력비', category: 'electricity', section: 'cogs', cash_flow: null },
  '4540': { name: '운반비', category: 'freight', section: 'cogs', cash_flow: null },
  '4550': { name: '라이선스료', category: 'license', section: 'cogs', cash_flow: null },
  '4590': { name: '기타제조경비', category: 'other', section: 'cogs', cash_flow: null },
  '8010': { name: '급여(판관)', category: 'labor', section: 'sga', cash_flow: null },
  '8190': { name: '지급수수료', category: 'other', section: 'sga', cash_flow: null },
  // D-01 시트 모순을 숨기지 않고 드러내는 두 계정. lib/ecount/mock.ts 머리 주석 참고.
  '8990': { name: '시트 정합 조정(판관)', category: 'other', section: 'sga', cash_flow: null },
  '8210': { name: '감가상각비', category: 'other', section: 'd_and_a', cash_flow: null },
  '8299': { name: '시트 정합 조정(상각)', category: 'other', section: 'd_and_a', cash_flow: null },
  '9010': { name: '영업외수익', category: 'other', section: 'non_operating', cash_flow: null },
  '9310': { name: '이자비용', category: 'other', section: 'non_operating', cash_flow: null },
  '9980': { name: '법인세비용', category: 'other', section: 'tax', cash_flow: null },
}

/** 계정코드 → 분류. 한 회사의 계정과목표다. */
export type AccountChart = Record<string, AccountClassification>

/** DB에서 읽은 계정들을 분류표로. 비활성 계정도 넣는다 — 과거 전표는 그 계정을 계속 문다. */
export function chartOf(
  accounts: readonly { account_code: string; name: string; category: AccountCategory; section: AccountSection; cash_flow: CashFlowClass | null }[],
): AccountChart {
  return Object.fromEntries(
    accounts.map((x) => [x.account_code, { name: x.name, category: x.category, section: x.section, cash_flow: x.cash_flow }]),
  )
}
