import type { SessionUser } from '@/types'

/**
 * 화면 · API 공통 판정(안내용 — RLS inv_reader가 진짜 판정). 대표 또는 «/investment» 지정자만. 시스템 계정은 사람 화면을 쓰지 않는다.
 * screen.ts(서버 전용)와 check:investment가 같이 쓴다.
 */
export function canSeeInvestment(user: Pick<SessionUser, 'role' | 'investment'> | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'AIAgent' || user.role === 'Integration') return false
  return user.role === 'Chairman' || user.investment === true
}
