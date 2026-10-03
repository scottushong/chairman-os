import type { Role } from '@/types'

/**
 * 직원 화면 용어 원칙(CLAUDE.md, 2026-10-02).
 *
 * 직원들은 회장을 «대표»로 안다. «회장» · «Chairman»은 회장 본인 화면에서만 쓴다.
 * 그 외 역할(다른 사람의 화면 · 메일 · 알림 · AI 답변)에는 «대표»로 쓰고, 회장 전용 기능은 이름조차 꺼내지 않는다.
 */
export const isChairman = (role: Role | null | undefined): boolean => role === 'Chairman'

/** 보는 사람에 맞는 호칭. 회장 본인 = 회장, 그 외 = 대표. */
export function boss(role: Role | null | undefined): string {
  return isChairman(role) ? '회장' : '대표'
}

/** 영문 호칭. 회장 본인 = the Chairman, 그 외 = the CEO. */
export function bossEn(role: Role | null | undefined): string {
  return isChairman(role) ? 'the Chairman' : 'the CEO'
}

/** 역할 라벨(ROLE_LABEL_KO)의 Chairman 칸만 보는 사람에 맞춘다 — 직원 화면에 «Chairman»이 찍히지 않게. */
export function roleLabelFor(label: string, role: Role, viewer: Role | null | undefined): string {
  return role === 'Chairman' && !isChairman(viewer) ? '대표' : label
}

/**
 * DB · 감사 기록에 이미 들어 있는 문구를 보는 사람에 맞게 바꾼다.
 *   직원: 회장 · Chairman → 대표 (0049 이전에 남은 결재선 · 감사 메모 · DB 오류 문구)
 *   회장: 대표 → 회장 (0049부터 DB가 «대표»로 적는다). **DB가 적는 낱말만** 되돌린다 —
 *         결재선 칸 이름 «대표»와 «대표 결재 · 대표 확인 · 대표 기안 · 대표까지 · 대표 규칙».
 *         사람이 쓴 «VANA 대표 보고» · «대표이사»까지 «회장»으로 바꾸면 회장 화면이 거짓말을 한다.
 */
/**
 * 명세 번호(CH-0xx · Phase N)가 섞인 안내 문장을 직원에게는 번호 없이. 회장에게는 그대로.
 * 번호는 회장과 만드는 사람이 쓰는 말이다 — 직원 화면 용어 원칙(CLAUDE.md), SpecCode와 같은 결.
 */
export function specText(text: string, viewer: Role | null | undefined): string {
  if (isChairman(viewer)) return text
  return text
    .replace(/\s*\((?:CH-\d{3}(?:~\d{3})?|Phase [\d-]+)\)/g, '')
    .replace(/CH-\d{3}\s+/g, '')
    .replace(/Layer 2 기능 시스템입니다\. /g, '')
    .replace(/Phase 2 범위입니다/g, '다음 단계에서 만듭니다')
}

export function bossText(text: string, viewer: Role | null | undefined): string {
  if (!isChairman(viewer)) return text.replace(/회장/g, '대표').replace(/Chairman/g, '대표')
  if (text === '대표') return '회장'
  return text.replace(/대표(?=( 결재| 확인| 기안|까지| 규칙))/g, '회장')
}
