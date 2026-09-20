'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import {
  MANUFACTURING_ROWS,
  STARTUP_ROWS,
  buildMonthlySlip,
  type MonthlyRow,
} from '@/lib/statements/monthly'
import { isLocked, type OfficialPeriod } from '@/lib/statements/period'

/**
 * 월별 간이 손익 저장 (Phase 2-C 블록 2).
 *
 * 한 달이 전표 한 장이다. 여러 달을 한 번에 넣으면 달마다 전표가 따로 선다 —
 * 한 전표에 두 달을 담으면 그 전표의 entry_date가 어느 달에도 속하지 못하고,
 * finance_ledger_cells가 to_char(entry_date)로 달을 가르므로 한쪽 달이 통째로 사라진다.
 *
 * **공식 재무제표가 덮은 달은 여기서 막는다.** 그 달은 이미 확정 결산이 말하고 있어서,
 * 잠정 전표를 더 얹으면 같은 달을 두 층이 두 번 말한다(0020 머리 주석).
 */

export interface MonthlyState {
  error?: string
  /** 저장된 달과 전표번호. */
  saved?: { month: string; slipNo: string }[]
  /** 미분류로 떨어진 달. 저장은 됐지만 회장이 알아야 한다. */
  unbalanced?: { month: string; residual: number }[]
}

function rowsFor(preset: unknown): readonly MonthlyRow[] {
  return preset === 'startup' ? STARTUP_ROWS : MANUFACTURING_ROWS
}

/** 한 달의 마지막 날. 전표 날짜는 그 달 안에 있어야 한다. */
function lastDayOf(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return `${month}-${String(day).padStart(2, '0')}`
}

export async function saveMonthlyBooks(input: {
  businessId: unknown
  preset: unknown
  /** [{ month: '2026-01', values: { revenue: 1000, ... } }] — 값은 사람이 읽는 양수다. */
  months: unknown
}): Promise<MonthlyState> {
  const business_id = typeof input.businessId === 'string' ? input.businessId.trim() : ''
  if (!business_id) return { error: '어느 회사인지 알 수 없습니다.' }
  if (!Array.isArray(input.months)) return { error: '월별 입력을 읽을 수 없습니다.' }

  const rows = rowsFor(input.preset)
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  // 달 순서를 보장한다. 잔액 항목이 '전월과의 차이'라 순서가 섞이면 차이가 뒤집힌다.
  const entries = (input.months as { month?: unknown; values?: unknown }[])
    .map((m) => ({
      month: typeof m.month === 'string' ? m.month : '',
      values: (m.values ?? {}) as Record<string, number>,
    }))
    .filter((m) => /^\d{4}-\d{2}$/.test(m.month))
    .sort((a, b) => a.month.localeCompare(b.month))

  if (entries.length === 0) return { error: '저장할 달이 없습니다.' }

  try {
    const repo = await getRepository()
    const officials = await repo.listOfficialStatements(business_id)
    const periods: OfficialPeriod[] = officials.map((o) => ({ kind: o.period_kind, key: o.period_key }))

    const blocked = entries.find((e) => isLocked(e.month, periods))
    if (blocked) {
      return {
        error: `${blocked.month}은 공식 재무제표가 덮은 달이라 월별 입력을 받지 않습니다.`,
      }
    }

    const saved: { month: string; slipNo: string }[] = []
    const unbalanced: { month: string; residual: number }[] = []
    // 잔액 항목의 '전월'은 바로 앞 달의 입력값이다. 회장이 한 해를 통째로 넣는 화면이라
    // 그 값이 곧 직전 잔액이고, 첫 달은 전월이 없으므로 잔액 전체가 움직임이 된다.
    let prior: Record<string, number> = {}

    for (const entry of entries) {
      const slip = buildMonthlySlip({ rows, values: entry.values, priorBalances: prior })
      prior = entry.values
      if (slip.lines.length === 0) continue

      const slipNo = await repo.postJournalEntry(
        {
          business_id,
          entry_date: lastDayOf(entry.month),
          memo: `${entry.month} 월별 간이 손익`,
          evidence_url: null,
          lines: slip.lines,
        },
        { user_id: user.user_id, role: user.role },
      )
      saved.push({ month: entry.month, slipNo })
      if (slip.residual !== 0) unbalanced.push({ month: entry.month, residual: slip.residual })
    }

    const base = `/finance/${encodeURIComponent(business_id)}`
    revalidatePath(`${base}/monthly`)
    revalidatePath(`${base}/journal`)
    revalidatePath(base)
    revalidatePath('/finance')
    revalidatePath(`/business/${encodeURIComponent(business_id)}`)
    revalidatePath('/')
    return { saved, unbalanced }
  } catch (e) {
    console.error('[saveMonthlyBooks]', e)
    const message = e instanceof Error ? e.message : ''
    if (/closed_period/.test(message)) return { error: '이미 마감된 달이 있습니다. 마감 후에는 정정 전표로 고칩니다.' }
    if (/42501|PGRST301|row-level security/.test(message)) {
      return { error: '이 회사의 장부를 쓸 권한이 없습니다. (Chairman · Group CFO · 해당 회사 Business CEO)' }
    }
    return { error: '월별 손익을 저장하지 못했습니다.' }
  }
}
