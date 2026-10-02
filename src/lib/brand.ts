import type { Role } from '@/types/permissions'

/**
 * 서비스 이름 — 회장에게만 «Chairman OS», 그 밖의 모든 사람(직원 · 로그인 전)에게는 «DY 그룹웨어» (2026-10-02 회장 지시).
 * 역할을 모르는 화면(로그인 · 가입 · PWA manifest)은 직원 이름이 기본이다.
 */
export const CHAIRMAN_BRAND = 'Chairman OS'
export const STAFF_BRAND = 'DY 그룹웨어'

export function brandFor(role: Role | null | undefined): string {
  return role === 'Chairman' ? CHAIRMAN_BRAND : STAFF_BRAND
}
