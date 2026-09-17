import {
  ACCOUNT_CATEGORY,
  ACCOUNT_SECTION,
  CASH_FLOW_CLASS,
  type AccountCategory,
  type AccountSection,
  type CashFlowClass,
} from '@/types'

/**
 * 계정과목 한 줄의 규칙 (Phase 2-B 블록 1). 화면·Server Action·dummy 어댑터가 같은 규칙을 본다.
 * DB에는 0015의 accounts_category_section check와 0016의 accounts_guard가 같은 규칙으로 서 있다 —
 * 여기는 저장 버튼을 누르기 전에 사람 말로 알려 주는 자리고, 진짜 문은 DB다.
 */

/** 구분(재무제표의 줄)마다 올 수 있는 대분류. 0015 accounts_category_section과 같다. */
export const SECTION_CATEGORIES: Record<AccountSection, readonly AccountCategory[]> = {
  revenue: ['revenue'],
  cogs: ['raw_material', 'labor', 'electricity', 'freight', 'license', 'other'],
  sga: ['raw_material', 'labor', 'electricity', 'freight', 'license', 'other'],
  d_and_a: ['raw_material', 'labor', 'electricity', 'freight', 'license', 'other'],
  non_operating: ['raw_material', 'labor', 'electricity', 'freight', 'license', 'other'],
  tax: ['raw_material', 'labor', 'electricity', 'freight', 'license', 'other'],
  cash: ['asset'],
  receivable: ['asset'],
  other_asset: ['asset'],
  payable: ['liability'],
  other_liability: ['liability'],
  equity: ['equity'],
}

export const ACCOUNT_CODE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z-]{0,19}$/
export const ACCOUNT_NAME_MAX = 60

export interface AccountFields {
  name: string
  category: AccountCategory
  section: AccountSection
  cash_flow: CashFlowClass | null
}

/** 폼에서 온 값(문자열)을 계정 분류로. 틀리면 사람이 읽을 문장을 돌려준다. */
export function parseAccountFields(input: {
  name: unknown
  category: unknown
  section: unknown
  cashFlow: unknown
}): { fields: AccountFields } | { error: string } {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const section = String(input.section ?? '') as AccountSection
  const category = String(input.category ?? '') as AccountCategory
  const rawFlow = String(input.cashFlow ?? '')

  if (!name) return { error: '계정명을 입력하세요.' }
  if (name.length > ACCOUNT_NAME_MAX) return { error: `계정명은 ${ACCOUNT_NAME_MAX}자까지입니다.` }
  if (!ACCOUNT_SECTION.includes(section)) return { error: '구분을 고르세요.' }
  if (!ACCOUNT_CATEGORY.includes(category)) return { error: '대분류를 고르세요.' }
  if (!SECTION_CATEGORIES[section].includes(category)) {
    return { error: '구분과 대분류가 맞지 않습니다. (예: 매출 구분은 매출 대분류만)' }
  }
  const cash_flow = rawFlow === '' ? null : (rawFlow as CashFlowClass)
  if (cash_flow !== null && !CASH_FLOW_CLASS.includes(cash_flow)) return { error: '현금흐름 구분이 올바르지 않습니다.' }
  return { fields: { name, category, section, cash_flow } }
}

export function parseAccountCode(value: unknown): { code: string } | { error: string } {
  const code = typeof value === 'string' ? value.trim() : ''
  if (!code) return { error: '계정코드를 입력하세요.' }
  if (!ACCOUNT_CODE_PATTERN.test(code)) return { error: '계정코드는 영문·숫자·하이픈 20자까지입니다.' }
  return { code }
}
