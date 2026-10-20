import type { FinAutoRule } from '@/types'

/** 0091 자동 판단 — 화면(클라이언트)도 읽는 모양 · 이름만(계산은 auto.ts). */
export type AutoRule = FinAutoRule | 'loan'
export const AUTO_RULE_KO: Record<AutoRule, string> = { valuation: '재고 평가', period: '귀속월', duplicate: '중복', loan: '원금 · 이자' }

export interface AutoDecision {
  /** `${rule}|${key}` */
  id: string
  rule: AutoRule
  key: string
  /** 다시 계산할 첫 달(고치기의 period) */
  period: string
  /** 이 판단이 숫자를 바꾸는 달 */
  periods: string[]
  title: string
  basis: string
  /** auto = 시스템이 정함 · fixed = 사람이 고침 · off = 사람이 원래대로(원래 날짜 · 되살림) */
  state: 'auto' | 'fixed' | 'off'
  fix: { by: string | null; at: string; prev: Record<string, unknown> | null } | null
  /** 평가: 지금 값(고치기 칸의 처음 값) */
  value?: number | null
  /** 귀속월: 원래 달 · 자동이 고른 달 */
  from?: string
  months?: string[]
}
