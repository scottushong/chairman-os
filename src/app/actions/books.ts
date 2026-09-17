'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { parseAccountCode, parseAccountFields } from '@/lib/ledger/accounts'
import { CLOSE_PROBLEM_KO, type CloseProblem } from '@/lib/ledger/closing'
import { periodOfDate } from '@/lib/ledger/basis'
import {
  CLOSED_PERIOD_MESSAGE,
  CORRECTION_PROBLEM_KO,
  correctionProblem,
  entryProblem,
  isPeriodLocked,
  type CorrectionProblem,
  type DraftLine,
  type NewCorrection,
  type NewJournalEntry,
} from '@/lib/ledger/journal'
import { DUPLICATE_ACCOUNT_CODE, getRepository } from '@/lib/repository'
import type { Account } from '@/types'

/**
 * Phase 2-B 자체 장부 — 계정과목 (0016).
 *
 * 권한 판정은 여기서 하지 않는다. 로그인한 본인 세션으로 DB에 붙고 0016의 can_keep_books()가
 * 역할과 회사 범위를 본다. 감사 기록은 어댑터가 남긴다. 여기서는 입력 검증만 한다.
 */

export interface AccountState {
  error?: string
  account?: Account
  /** 표준 계정과목표로 넣은 수 */
  added?: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** DB가 거부한 이유를 사람 말로. 모르는 실패는 fallback이다 — 원문은 서버 로그에 남는다. */
function failure(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : ''
  if (message === DUPLICATE_ACCOUNT_CODE) return '이 회사에 같은 계정코드가 이미 있습니다.'
  if (/account_code_immutable/.test(message)) return '계정코드는 바꿀 수 없습니다. 새 계정을 만들고 옛 계정을 비활성화하세요.'
  if (/42501|PGRST301|row-level security|accounts: 고칠 계정이 없다/.test(message)) {
    return '이 회사의 계정과목을 고칠 권한이 없습니다. (Chairman · Group CFO · 해당 회사 Business CEO)'
  }
  return fallback
}

function revalidateBooks(businessId: string) {
  const base = `/finance/${encodeURIComponent(businessId)}`
  revalidatePath(`${base}/accounts`)
  revalidatePath(`${base}/journal`)
  revalidatePath(base)
}

export async function createAccount(input: {
  businessId: unknown
  code: unknown
  name: unknown
  category: unknown
  section: unknown
  cashFlow: unknown
}): Promise<AccountState> {
  const business_id = text(input.businessId)
  if (!business_id) return { error: '어느 회사의 계정인지 알 수 없습니다.' }
  const code = parseAccountCode(input.code)
  if ('error' in code) return { error: code.error }
  const parsed = parseAccountFields(input)
  if ('error' in parsed) return { error: parsed.error }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const account = await repo.createAccount(
      { business_id, account_code: code.code, ...parsed.fields },
      { user_id: user.user_id, role: user.role },
    )
    revalidateBooks(business_id)
    return { account }
  } catch (e) {
    console.error('[createAccount]', e)
    return { error: failure(e, '계정을 만들지 못했습니다. 잠시 후 다시 시도하세요.') }
  }
}

/** 이름·분류 수정. 코드는 받지 않는다 — 어느 계정인지 가리키는 데만 쓴다. */
export async function updateAccount(input: {
  businessId: unknown
  code: unknown
  name: unknown
  category: unknown
  section: unknown
  cashFlow: unknown
}): Promise<AccountState> {
  const business_id = text(input.businessId)
  const code = text(input.code)
  if (!business_id || !code) return { error: '고칠 계정을 알 수 없습니다.' }
  const parsed = parseAccountFields(input)
  if ('error' in parsed) return { error: parsed.error }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const account = await repo.updateAccount(business_id, code, parsed.fields, {
      user_id: user.user_id,
      role: user.role,
    })
    revalidateBooks(business_id)
    return { account }
  } catch (e) {
    console.error('[updateAccount]', e)
    return { error: failure(e, '계정을 고치지 못했습니다. 잠시 후 다시 시도하세요.') }
  }
}

export async function setAccountActive(input: {
  businessId: unknown
  code: unknown
  active: unknown
}): Promise<AccountState> {
  const business_id = text(input.businessId)
  const code = text(input.code)
  if (!business_id || !code || typeof input.active !== 'boolean') return { error: '바꿀 계정을 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const account = await repo.updateAccount(business_id, code, { active: input.active }, {
      user_id: user.user_id,
      role: user.role,
    })
    revalidateBooks(business_id)
    return { account }
  } catch (e) {
    console.error('[setAccountActive]', e)
    return { error: failure(e, '계정 상태를 바꾸지 못했습니다. 잠시 후 다시 시도하세요.') }
  }
}

export async function applyStandardChart(businessId: unknown): Promise<AccountState> {
  const business_id = text(businessId)
  if (!business_id) return { error: '어느 회사인지 알 수 없습니다.' }
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const added = await repo.applyStandardChart(business_id, { user_id: user.user_id, role: user.role })
    revalidateBooks(business_id)
    return { added }
  } catch (e) {
    console.error('[applyStandardChart]', e)
    return { error: failure(e, '표준 계정과목표를 적용하지 못했습니다. 잠시 후 다시 시도하세요.') }
  }
}

export interface JournalState {
  error?: string
  slipNo?: string
}

/** DB·dummy가 거부한 전표를 사람 말로. 낱말은 0016의 raise exception message다. */
function journalFailure(e: unknown): string {
  const message = e instanceof Error ? e.message : ''
  const word = (Object.keys(CORRECTION_PROBLEM_KO) as CorrectionProblem[]).find((w) => message.includes(w))
  if (word) return CORRECTION_PROBLEM_KO[word]
  if (/closed_period/.test(message)) return CLOSED_PERIOD_MESSAGE
  if (/unbalanced_slip/.test(message)) return '차변 합과 대변 합이 같지 않아 저장하지 않았습니다.'
  if (/inactive_account/.test(message)) return '비활성이거나 없는 계정이 들어 있습니다. 계정과목을 확인하세요.'
  const invalid = /invalid_entry: (.+)$/.exec(message)
  if (invalid) return invalid[1]
  if (/42501|PGRST301|row-level security/.test(message)) {
    return '이 회사의 전표를 입력할 권한이 없습니다. (Chairman · Group CFO · 해당 회사 Business CEO)'
  }
  return '전표를 저장하지 못했습니다. 잠시 후 다시 시도하세요.'
}

/** 폼에서 온 라인. 금액은 문자열(쉼표 포함)일 수 있다. */
function parseLines(value: unknown): DraftLine[] | null {
  if (!Array.isArray(value)) return null
  return value.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>
    const amount = Number(String(r.amount ?? '').replaceAll(',', '').trim())
    return {
      account_code: text(r.account_code),
      side: r.side === 'credit' ? 'credit' : 'debit',
      amount: Number.isFinite(amount) ? amount : NaN,
    }
  })
}

export async function postJournalEntry(input: {
  businessId: unknown
  entryDate: unknown
  memo: unknown
  evidenceUrl: unknown
  lines: unknown
}): Promise<JournalState> {
  const lines = parseLines(input.lines)
  if (!lines) return { error: '라인을 읽을 수 없습니다.' }
  const entry: NewJournalEntry = {
    business_id: text(input.businessId),
    entry_date: text(input.entryDate),
    memo: text(input.memo),
    evidence_url: text(input.evidenceUrl) || null,
    lines,
  }
  if (!entry.business_id) return { error: '어느 회사의 전표인지 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    // 저장 전에 같은 규칙으로 한 번 본다 — 사람 말로 먼저 알려 주려고. 판정은 DB가 한 번 더 한다.
    const problem = entryProblem(entry, await repo.loadFinanceLedger())
    if (problem) return { error: problem }
    const slipNo = await repo.postJournalEntry(entry, { user_id: user.user_id, role: user.role })
    revalidateBooks(entry.business_id)
    revalidatePath('/')
    revalidatePath('/finance')
    return { slipNo }
  } catch (e) {
    console.error('[postJournalEntry]', e)
    return { error: journalFailure(e) }
  }
}

export interface CloseState {
  error?: string
  /** 찍은 결산 칸 수 */
  cells?: number
}

export async function closePeriod(input: { businessId: unknown; period: unknown }): Promise<CloseState> {
  const business_id = text(input.businessId)
  const period = text(input.period)
  if (!business_id || !period) return { error: '마감할 회사와 달을 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const cells = await repo.closePeriod(business_id, period, { user_id: user.user_id, role: user.role })
    revalidateBooks(business_id)
    revalidatePath('/')
    revalidatePath('/finance')
    return { cells }
  } catch (e) {
    console.error('[closePeriod]', e)
    const message = e instanceof Error ? e.message : ''
    const word = (Object.keys(CLOSE_PROBLEM_KO) as CloseProblem[]).find((w) => message.includes(w))
    if (word) return { error: CLOSE_PROBLEM_KO[word] }
    if (/42501|PGRST301|row-level security/.test(message)) return { error: CLOSE_PROBLEM_KO.close_forbidden }
    return { error: '마감하지 못했습니다. 잠시 후 다시 시도하세요.' }
  }
}

export interface CorrectionState {
  error?: string
  reversal?: string
  restatement?: string | null
}

/**
 * 블록 4 — 정정 전표. 원 전표를 당월에 역분개하고, 라인이 있으면 정정분개를 넣는다.
 * 라인을 전부 비우면 역분개만 한다(원 전표 취소).
 */
export async function postCorrection(input: {
  businessId: unknown
  correctsId: unknown
  entryDate: unknown
  memo: unknown
  evidenceUrl: unknown
  lines: unknown
}): Promise<CorrectionState> {
  const lines = parseLines(input.lines)
  if (!lines) return { error: '라인을 읽을 수 없습니다.' }
  const correction: NewCorrection = {
    business_id: text(input.businessId),
    corrects_id: text(input.correctsId),
    entry_date: text(input.entryDate),
    memo: text(input.memo),
    evidence_url: text(input.evidenceUrl) || null,
    lines,
  }
  if (!correction.business_id || !correction.corrects_id) return { error: '정정할 전표를 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const ledger = await repo.loadFinanceLedger()
    const problem = correctionProblem(ledger, correction.business_id, correction.corrects_id, correction.entry_date)
    if (problem) return { error: CORRECTION_PROBLEM_KO[problem] }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(correction.entry_date)) return { error: '정정 일자가 올바르지 않습니다.' }
    if (isPeriodLocked(ledger, correction.business_id, periodOfDate(correction.entry_date))) {
      return { error: '정정 일자가 마감된 달입니다. 열린 달(당월)의 날짜를 고르세요.' }
    }
    if (lines.length > 0) {
      const restatement = entryProblem(correction, ledger)
      if (restatement) return { error: restatement }
    }
    const result = await repo.postCorrection(correction, { user_id: user.user_id, role: user.role })
    revalidateBooks(correction.business_id)
    revalidatePath('/')
    revalidatePath('/finance')
    return result
  } catch (e) {
    console.error('[postCorrection]', e)
    return { error: journalFailure(e) }
  }
}
