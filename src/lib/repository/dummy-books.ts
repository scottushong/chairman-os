import { MOCK_FETCHED_AT } from '@/lib/ecount/mock'
import { loadMockLedger } from '@/lib/ecount/mock-ledger'
import { STANDARD_CHART, STANDARD_CHART_BUSINESSES, type StandardAccount } from '@/lib/ledger/standard-chart'
import { periodOfDate } from '@/lib/ledger/basis'
import { closeProblem, closingRows } from '@/lib/ledger/closing'
import {
  CLOSED_PERIOD_MESSAGE,
  correctionProblem,
  entryProblem,
  isPeriodLocked,
  reversalLines,
  slipNumber,
  todayKst,
  type CorrectionResult,
  type NewCorrection,
  type NewJournalEntry,
} from '@/lib/ledger/journal'
import { BALANCE_SHEET_SECTIONS } from '@/lib/statements/balance'
import type {
  Account,
  Closing,
  FinanceLedger,
  JournalEntry,
  JournalLine,
  NewOfficialStatement,
  OfficialStatement,
  OfficialStatementLine,
} from '@/types'

import { DUPLICATE_ACCOUNT_CODE, type AccountPatch, type AuditActor, type NewAccount } from './types'

/**
 * dummy 모드의 자체 장부 (Phase 2-B). 0016이 DB에서 하는 일을 메모리에서 흉내 낸다.
 *
 * 출발점은 mock 원장(lib/ecount/mock-ledger.ts)이다. 그 위에 화면에서 한 쓰기를 얹는다.
 * 서버가 살아 있는 동안만 남는다 — 다른 dummy 쓰기(키맨·기안)와 같은 한계다.
 *
 * 권한은 흉내 내지 않는다(dummy.ts 머리 주석). 장부 규칙(코드 불변·중복 코드)은 흉내 낸다 —
 * 규칙이 빠지면 dummy에서 되는 입력이 live에서 거부되고, 그 차이를 화면 검증이 못 잡는다.
 */

const key = (businessId: string, code: string) => `${businessId}|${code}`

/** mock 계정 위에 얹은 계정들. 키는 business|code. mock 계정을 고치면 여기 복사본이 선다. */
let accounts: Map<string, Account> | null = null

/** 화면에서 넣은 전표. mock 전표 뒤에 붙는다. */
const entries: JournalEntry[] = []
const lines: JournalLine[] = []
let slipSeq = 0

/** 화면에서 한 마감. 결산 칸과, 마감된 회사·달(그 달 전표 라인은 읽을 때 closed로 보인다). */
const closings: Closing[] = []
const closedMonths = new Set<string>()

function standardRow(businessId: string, s: StandardAccount, fetched_at: string): Account {
  return {
    business_id: businessId,
    account_code: s.code,
    name: s.name,
    category: s.category,
    section: s.section,
    cash_flow: s.cash_flow,
    source: 'manual',
    fetched_at,
    closed: false,
    active: true,
  }
}

async function accountStore(): Promise<Map<string, Account>> {
  if (accounts) return accounts
  const ledger = await loadMockLedger()
  const store = new Map(ledger.accounts.map((a) => [key(a.business_id, a.account_code), { ...a }]))
  // 0016 시드와 같다 — 스타트업 네 곳은 표준 계정과목표를 받는다. mock이 이미 쓰는 코드는 그대로 둔다.
  for (const b of STANDARD_CHART_BUSINESSES) {
    for (const s of STANDARD_CHART) {
      if (!store.has(key(b, s.code))) store.set(key(b, s.code), standardRow(b, s, MOCK_FETCHED_AT))
    }
  }
  accounts = store
  return store
}

function note(actor: AuditActor, what: string) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[dummy] ${what} by ${actor.role} — 메모리에만 남는다.`)
  }
}

/** 화면이 읽는 원장 한 벌. 복사본을 준다 — 화면이 sort() 한 번만 잘못 불러도 원장이 영구히 바뀐다. */
export async function dummyLedger(): Promise<FinanceLedger> {
  const ledger = await loadMockLedger()
  const store = await accountStore()
  return {
    accounts: [...store.values()].map((a) => ({ ...a })),
    journal: [...ledger.journal, ...lines].map((j) =>
      closedMonths.has(key(j.business_id, periodOfDate(j.entry_date))) ? { ...j, closed: true } : { ...j },
    ),
    closings: [...ledger.closings, ...closings],
    entries: entries.map((e) => ({ ...e })),
    fxRates: [...ledger.fxRates],
    costIndices: [...ledger.costIndices],
  }
}

export async function createAccount(input: NewAccount, actor: AuditActor): Promise<Account> {
  const store = await accountStore()
  if (store.has(key(input.business_id, input.account_code))) throw new Error(DUPLICATE_ACCOUNT_CODE)
  const row: Account = {
    ...input,
    source: 'manual',
    fetched_at: new Date().toISOString(),
    closed: false,
    active: true,
  }
  store.set(key(input.business_id, input.account_code), row)
  note(actor, `create account ${input.business_id}:${input.account_code}`)
  return { ...row }
}

export async function updateAccount(
  businessId: string,
  accountCode: string,
  patch: AccountPatch,
  actor: AuditActor,
): Promise<Account> {
  const store = await accountStore()
  const before = store.get(key(businessId, accountCode))
  if (!before) throw new Error('accounts: 고칠 계정이 없다.')
  const next: Account = { ...before }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) Object.assign(next, { [k]: v })
  }
  store.set(key(businessId, accountCode), next)
  note(actor, `update account ${businessId}:${accountCode}`)
  return { ...next }
}

export async function applyStandardChart(businessId: string, actor: AuditActor): Promise<number> {
  const store = await accountStore()
  const fetched_at = new Date().toISOString()
  let n = 0
  for (const s of STANDARD_CHART) {
    if (store.has(key(businessId, s.code))) continue
    store.set(key(businessId, s.code), standardRow(businessId, s, fetched_at))
    n++
  }
  note(actor, `apply standard chart ${businessId} (${n})`)
  return n
}

/**
 * 0016 post_journal_entry()를 흉내 낸다. DB가 거부할 전표는 여기서도 거부한다 —
 * 규칙은 lib/ledger/journal.ts entryProblem 한 곳이다. 마감 달은 DB와 같은 낱말(closed_period)로 던진다.
 */
export async function postJournalEntry(input: NewJournalEntry, actor: AuditActor): Promise<string> {
  const ledger = await dummyLedger()
  const problem = entryProblem(input, ledger)
  if (problem === CLOSED_PERIOD_MESSAGE) throw new Error('closed_period')
  if (problem) throw new Error(`invalid_entry: ${problem}`)
  const slip_no = insertEntry(input, actor, null)
  note(actor, `post journal ${input.business_id}:${slip_no}`)
  return slip_no
}

/** 0016 journal_entry_insert()와 같다 — 헤더 + 라인. 검사는 부르는 쪽이 끝냈다. */
function insertEntry(
  input: NewJournalEntry,
  actor: AuditActor,
  correction: { corrects_id: string; kind: 'reversal' | 'restatement' } | null,
): string {
  const slip_no = slipNumber(input.entry_date, ++slipSeq)
  const now = new Date().toISOString()
  entries.push({
    business_id: input.business_id,
    slip_no,
    entry_date: input.entry_date,
    memo: input.memo.trim(),
    evidence_url: input.evidence_url?.trim() || null,
    created_by: actor.user_id,
    created_at: now,
    corrects_id: correction?.corrects_id ?? null,
    correction_kind: correction?.kind ?? null,
  })
  input.lines.forEach((l, i) =>
    lines.push({
      business_id: input.business_id,
      entry_date: input.entry_date,
      account_code: l.account_code,
      amount: l.amount,
      side: l.side,
      slip_no,
      line_no: i + 1,
      memo: l.memo?.trim() || input.memo.trim(),
      source: 'manual',
      fetched_at: now,
      closed: false,
    }),
  )
  return slip_no
}

/**
 * 0016 post_correction()을 흉내 낸다. 역분개는 검사를 다시 하지 않는다 — 원 전표를 뒤집은 것이라
 * 차대는 이미 맞고, 계정이 그 사이 비활성화됐어도 되돌릴 수 있어야 한다(DB 트리거와 같은 예외).
 */
export async function postCorrection(input: NewCorrection, actor: AuditActor): Promise<CorrectionResult> {
  const ledger = await dummyLedger()
  const problem = correctionProblem(ledger, input.business_id, input.corrects_id, input.entry_date)
  if (problem) throw new Error(problem)
  // 역분개 날짜의 달이 열려 있어야 한다. 정정분개 라인이 없어도(취소) 같다.
  if (isPeriodLocked(ledger, input.business_id, periodOfDate(input.entry_date))) throw new Error('closed_period')
  const restatement = input.lines.length > 0 ? entryProblem(input, ledger) : null
  if (restatement) throw new Error(`invalid_entry: ${restatement}`)

  const orig = ledger.entries.find((e) => e.business_id === input.business_id && e.slip_no === input.corrects_id)!
  const reversal = insertEntry(
    {
      business_id: input.business_id,
      entry_date: input.entry_date,
      memo: `[역분개] ${orig.memo}`,
      evidence_url: orig.evidence_url,
      lines: reversalLines(ledger, input.business_id, input.corrects_id),
    },
    actor,
    { corrects_id: input.corrects_id, kind: 'reversal' },
  )
  const restated =
    input.lines.length > 0 ? insertEntry(input, actor, { corrects_id: input.corrects_id, kind: 'restatement' }) : null
  note(actor, `correct ${input.business_id}:${input.corrects_id} → ${reversal}${restated ? ` + ${restated}` : ''}`)
  return { reversal, restatement: restated }
}

/** 0016 close_period()를 흉내 낸다. 검사 순서와 거부 낱말이 같다(lib/ledger/closing.ts). */
export async function closePeriod(businessId: string, period: string, actor: AuditActor): Promise<number> {
  const ledger = await dummyLedger()
  const today = todayKst()
  const problem = closeProblem(ledger, businessId, period, today)
  if (problem) throw new Error(problem)
  const rows = closingRows(ledger, businessId, period, today, new Date().toISOString())
  closings.push(...rows)
  closedMonths.add(key(businessId, period))
  note(actor, `close ${businessId}:${period} (${rows.length})`)
  return rows.length
}

// ---------------------------------------------------------------------
// Phase 2-C 블록 1 — 공식 재무제표. 0020의 official_statement_save()를 흉내 낸다.
// 검사 순서와 거부 낱말을 같게 둔다 — dummy에서 통과한 입력이 live에서 막히면
// 화면을 dummy로 검증한 의미가 없다(CLAUDE.md의 검증 관례).
// ---------------------------------------------------------------------
const officialStatements: OfficialStatement[] = []
const officialLines: OfficialStatementLine[] = []
let officialSeq = 0

export async function saveOfficialStatement(
  input: NewOfficialStatement,
  actor: AuditActor,
): Promise<number> {
  if (input.lines.length === 0) throw new Error('재무제표에 줄이 하나도 없습니다.')

  // 자산 + 부채 + 자본 = 0. 0020의 함수가 보는 것과 같은 식이다.
  const ledger = await dummyLedger()
  const sectionOf = new Map(
    ledger.accounts
      .filter((a) => a.business_id === input.business_id)
      .map((a) => [a.account_code, a.section]),
  )
  const balance = input.lines.reduce((total, l) => {
    const section = sectionOf.get(l.account_code)
    return section && BALANCE_SHEET_SECTIONS.includes(section) ? total + l.amount : total
  }, 0)
  if (balance !== 0) throw new Error(`재무상태표가 닫히지 않습니다. 차이 ${balance}원`)

  const now = new Date().toISOString()
  const prev = officialStatements.find(
    (s) =>
      s.business_id === input.business_id &&
      s.period_kind === input.period_kind &&
      s.period_key === input.period_key &&
      s.superseded_at === null,
  )
  if (prev) prev.superseded_at = now

  const id = ++officialSeq
  officialStatements.push({
    id,
    business_id: input.business_id,
    period_kind: input.period_kind,
    period_key: input.period_key,
    evidence_url: input.evidence_url.trim(),
    memo: input.memo.trim(),
    created_by: actor.user_id,
    created_at: now,
    superseded_at: null,
    supersedes_id: prev?.id ?? null,
  })
  officialLines.push(
    ...input.lines.map((l) => ({
      statement_id: id,
      business_id: input.business_id,
      account_code: l.account_code,
      amount: l.amount,
    })),
  )
  note(actor, `official ${input.business_id}:${input.period_key}${prev ? ` (정정 #${prev.id})` : ''}`)
  return id
}

/** 활성 행만. 정정으로 밀려난 것은 목록에 없다 — 잠금 판정이 옛 결산을 보면 안 된다. */
export async function listOfficialStatements(businessId: string): Promise<OfficialStatement[]> {
  return officialStatements
    .filter((s) => s.business_id === businessId && s.superseded_at === null)
    .map((s) => ({ ...s }))
}

/** 화면이 이전 값을 보여 줄 때 쓴다. */
export async function officialStatementLines(statementId: number): Promise<OfficialStatementLine[]> {
  return officialLines.filter((l) => l.statement_id === statementId).map((l) => ({ ...l }))
}
