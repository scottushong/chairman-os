import type { AccountSection } from '@/types'

/**
 * 공식 결산 미리보기의 부호(화면 · 서버 같이 씀 — node 의존 없음). 문서 값(사람이 읽는 양수) → 원장 규약(차변 − 대변, 0015).
 * 대변 계정(매출 · 부채 · 자본 · 영업외수익 · 감가상각누계액 같은 차감 계정)은 음수.
 */
const CREDIT_SECTIONS: AccountSection[] = ['revenue', 'payable', 'other_liability', 'equity']

export function signedAmount(section: AccountSection, name: string, printed: number): number {
  if (/누계액|충당금/.test(name)) return printed < 0 ? printed : -printed
  const credit = CREDIT_SECTIONS.includes(section) || (section === 'non_operating' && /수익|이익/.test(name))
  return credit ? -printed : printed
}
