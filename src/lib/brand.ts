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

/**
 * 서비스 설명(meta description · 링크 미리보기). 이름과 같은 규칙 — 회장에게만 원래 설명,
 * 그 밖(역할을 모르는 화면 포함)에는 회장 전용 기능(관제 · 야간 AI)을 꺼내지 않는 중립 문구(직원 화면 용어 원칙, CLAUDE.md).
 */
export const CHAIRMAN_DESCRIPTION = '그룹 통합 관제 + Business 전용 OS 연동 + AI Overnight Workforce'
export const STAFF_DESCRIPTION = 'DY 그룹 사내 업무 시스템 — 결재 · 업무 · 문서 · 소통'

export function descriptionFor(role: Role | null | undefined): string {
  return role === 'Chairman' ? CHAIRMAN_DESCRIPTION : STAFF_DESCRIPTION
}
