import type { AccountSection } from '@/types'

import type { StatementLine } from './balance'

/**
 * 공식 재무제표 저장 줄 읽기(actions/statements.ts가 부름 — 'use server' 파일은 함수만 내보내서 여기 둔다).
 *
 * 금액이 숫자가 아니면 **그 줄을 버리지 않고 통째로 실패**시킨다 — 한 줄을 조용히 빼면 재무상태표가 그만큼 안 맞는 채로
 * 저장 시도에 들어가고, 회장은 자기가 넣은 숫자가 왜 안 맞는지 알 수 없게 된다.
 *
 * 같은 계정이 두 줄이면 더한다(2026-10-17) — 표준재무제표의 «건물 · 기계장치 · 비품»을 한 «유형자산»에 묶으면 계정이 겹친다.
 * 0020 줄 키가 (statement_id, account_code)라 겹친 채 보내면 23505로 «다른 사람이 같은 해를 등록했다»고 잘못 말한다.
 */
export function readStatementLines(
  raw: unknown,
  sectionOf: Map<string, AccountSection>,
): { lines: { account_code: string; amount: number }[]; typed: StatementLine[] } | null {
  if (!Array.isArray(raw)) return null

  const sums = new Map<string, number>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const row = item as { account_code?: unknown; amount?: unknown }
    const account_code = typeof row.account_code === 'string' ? row.account_code.trim() : ''
    const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount)
    if (!account_code || !Number.isFinite(amount)) return null
    if (!sectionOf.has(account_code)) return null
    sums.set(account_code, Math.round(((sums.get(account_code) ?? 0) + amount) * 100) / 100)
  }

  const lines: { account_code: string; amount: number }[] = []
  const typed: StatementLine[] = []
  for (const [account_code, amount] of sums) {
    // 0원 줄은 넣지 않는다. 계정 30~40줄 중 대부분이 비는 것이 보통이고,
    // 그 빈 줄을 전부 0으로 저장하면 나중에 '이 계정은 0이었다'와 '이 계정은 없었다'가 섞인다.
    if (amount === 0) continue
    lines.push({ account_code, amount })
    typed.push({ account_code, section: sectionOf.get(account_code)!, amount })
  }
  return { lines, typed }
}
