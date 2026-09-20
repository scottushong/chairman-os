'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { balanceCheck, type StatementLine } from '@/lib/statements/balance'
import { isValidPeriodKey, type OfficialPeriodKind } from '@/lib/statements/period'
import type { AccountSection, NewOfficialStatement } from '@/types'

/**
 * Phase 2-C 블록 1 — 공식 재무제표 저장 (0020).
 *
 * 권한 판정은 여기서 하지 않는다. 로그인한 본인 세션으로 DB에 붙고 0020의 can_keep_books()가
 * 역할과 회사 범위를 본다. 감사 기록은 official_statement_save()가 남긴다.
 * 여기서는 입력 검증만 한다 — 그리고 그 검증은 **DB가 한 번 더 한다**.
 * 화면 검증은 사람에게 먼저 알려 주려는 것이고, 판정의 마지막 자리는 DB다.
 */

export interface StatementState {
  error?: string
  /** 저장된 재무제표 id */
  id?: number
  /** 자산 − (부채 + 자본). 안 맞을 때만 채워 보낸다 — 화면이 금액으로 말해 준다. */
  difference?: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 화면에서 온 줄을 읽는다. 금액이 숫자가 아니면 **그 줄을 버리지 않고 통째로 실패**시킨다 —
 * 한 줄을 조용히 빼면 재무상태표가 그만큼 안 맞는 채로 저장 시도에 들어가고,
 * 회장은 자기가 넣은 숫자가 왜 안 맞는지 알 수 없게 된다.
 */
function parseLines(
  raw: unknown,
  sectionOf: Map<string, AccountSection>,
): { lines: { account_code: string; amount: number }[]; typed: StatementLine[] } | null {
  if (!Array.isArray(raw)) return null

  const lines: { account_code: string; amount: number }[] = []
  const typed: StatementLine[] = []

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const row = item as { account_code?: unknown; amount?: unknown }
    const account_code = text(row.account_code)
    const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount)
    if (!account_code || !Number.isFinite(amount)) return null

    const section = sectionOf.get(account_code)
    if (!section) return null

    // 0원 줄은 넣지 않는다. 계정 30~40줄 중 대부분이 비는 것이 보통이고,
    // 그 빈 줄을 전부 0으로 저장하면 나중에 '이 계정은 0이었다'와 '이 계정은 없었다'가 섞인다.
    if (amount === 0) continue

    lines.push({ account_code, amount })
    typed.push({ account_code, section, amount })
  }

  return { lines, typed }
}

export async function saveOfficialStatement(input: {
  businessId: unknown
  periodKind: unknown
  periodKey: unknown
  evidenceUrl: unknown
  memo: unknown
  lines: unknown
}): Promise<StatementState> {
  const business_id = text(input.businessId)
  const period_kind = text(input.periodKind) as OfficialPeriodKind
  const period_key = text(input.periodKey)
  const evidence_url = text(input.evidenceUrl)
  const memo = text(input.memo)

  if (!business_id) return { error: '어느 회사의 재무제표인지 알 수 없습니다.' }
  if (period_kind !== 'year' && period_kind !== 'quarter') {
    return { error: '기간 단위는 연간 또는 분기입니다.' }
  }
  if (!isValidPeriodKey({ kind: period_kind, key: period_key })) {
    return { error: '기간 형식이 올바르지 않습니다. (연간 2025 · 분기 2026-Q1)' }
  }
  // 증빙과 메모를 막는 이유: 확정 꼬리표를 다는 숫자에 근거가 없으면 그 꼬리표가 거짓이 된다.
  if (!/^https?:\/\//i.test(evidence_url)) {
    return { error: '증빙 링크가 필요합니다. 사내 스토리지의 PDF 주소를 넣으세요.' }
  }
  if (!memo) return { error: '메모가 필요합니다. (예: 성연회계법인 2025 결산)' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    const ledger = await repo.loadFinanceLedger()
    const sectionOf = new Map(
      ledger.accounts.filter((a) => a.business_id === business_id).map((a) => [a.account_code, a.section]),
    )

    const parsed = parseLines(input.lines, sectionOf)
    if (!parsed) return { error: '금액을 읽을 수 없는 줄이 있습니다. 숫자만 넣으세요.' }
    if (parsed.lines.length === 0) return { error: '금액이 있는 줄이 하나도 없습니다.' }

    // 저장 전에 같은 규칙으로 한 번 본다. 판정은 DB가 한 번 더 한다(0020).
    const balance = balanceCheck(parsed.typed)
    if (!balance.balanced) {
      return {
        error: `재무상태표가 닫히지 않습니다. 자산 − (부채 + 자본) = ${balance.difference.toLocaleString('ko-KR')}원`,
        difference: balance.difference,
      }
    }

    const statement: NewOfficialStatement = {
      business_id,
      period_kind,
      period_key,
      evidence_url,
      memo,
      lines: parsed.lines,
    }
    const id = await repo.saveOfficialStatement(statement, { user_id: user.user_id, role: user.role })

    const base = `/finance/${encodeURIComponent(business_id)}`
    revalidatePath(`${base}/statements`)
    revalidatePath(`${base}/monthly`)
    revalidatePath(base)
    revalidatePath('/finance')
    revalidatePath(`/business/${encodeURIComponent(business_id)}`)
    revalidatePath('/')
    return { id }
  } catch (e) {
    console.error('[saveOfficialStatement]', e)
    const message = e instanceof Error ? e.message : ''
    if (/닫히지 않습니다/.test(message)) return { error: message }
    if (/42501|PGRST301|row-level security/.test(message)) {
      return { error: '이 회사의 결산을 넣을 권한이 없습니다. (Chairman · Group CFO · 해당 회사 Business CEO)' }
    }
    return { error: '재무제표를 저장하지 못했습니다.' }
  }
}
