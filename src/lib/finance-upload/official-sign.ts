import type { AccountSection } from '@/types'

/**
 * 공식 결산 미리보기의 부호(화면 · 서버 같이 씀 — node 의존 없음). 문서 값(사람이 읽는 양수) → 원장 규약(차변 − 대변, 0015).
 * 대변 계정(매출 · 부채 · 자본 · 영업외수익 · 감가상각누계액 같은 차감 계정)은 음수.
 *
 * 2026-10-17: label(문서의 줄 이름)을 같이 본다 — «대손충당금»을 «외상매출금»에 묶어도 차감으로, «외화환산이익»을 영업외 계정
 * 아무 데나 묶어도 수익(대변)으로. 영업외는 줄 이름이 있으면 줄 이름이 이긴다(계정 이름은 묶음일 수 있다).
 */
const CREDIT_SECTIONS: AccountSection[] = ['revenue', 'payable', 'other_liability', 'equity']
const ASSET_SECTIONS: AccountSection[] = ['cash', 'receivable', 'other_asset']

export function signedAmount(section: AccountSection, name: string, printed: number, label = ''): number {
  if (/누계액|충당금/.test(name) || (ASSET_SECTIONS.includes(section) && /누계액|대손충당금/.test(label))) return printed < 0 ? printed : -printed
  const nonOpCredit = label ? /수익|이익|차익/.test(label) : /수익|이익/.test(name)
  const credit = CREDIT_SECTIONS.includes(section) || (section === 'non_operating' && nonOpCredit)
  return credit ? -printed : printed
}
