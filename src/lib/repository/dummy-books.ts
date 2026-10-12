import { ecountAuditNote } from '@/lib/ecount/excel/file-rules'
import { ECOUNT_MONTHLY_COUNTER, type MonthlyLedgerMonth } from '@/lib/ecount/excel/monthly-import'
import { MOCK_FETCHED_AT } from '@/lib/ecount/mock'
import { loadMockLedger } from '@/lib/ecount/mock-ledger'
import { SECTION_CATEGORIES } from '@/lib/ledger/accounts'
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
  type DraftLine,
  type NewCorrection,
  type NewJournalEntry,
} from '@/lib/ledger/journal'
import { embedProblem } from '@/lib/process-chart'
import { DUMMY_SHEET_IDS } from '@/lib/process-sync/fake'
import { BALANCE_SHEET_SECTIONS } from '@/lib/statements/balance'
import type {
  Account,
  Closing,
  FinanceLedger,
  JournalEntry,
  JournalLine,
  NewOfficialStatement,
  OfficialStatement,
  OfficialStatementBasis,
  OfficialStatementLine,
  ProcessChart,
  ProcessChartInput,
} from '@/types'

import { dummyFinanceGrant, dummyHasBusiness, dummyViewer } from './dummy-org'
import { dummyProcessVisible } from './dummy-process-sync'
import {
  DUPLICATE_ACCOUNT_CODE,
  type AccountPatch,
  type AuditActor,
  type EcountAccountMerge,
  type EcountMonthlyResult,
  type NewAccount,
} from './types'

/**
 * dummy 모드의 자체 장부 (Phase 2-B). 0016이 DB에서 하는 일을 메모리에서 흉내 낸다.
 *
 * 출발점은 mock 원장(lib/ecount/mock-ledger.ts)이다. 그 위에 화면에서 한 쓰기를 얹는다.
 * 서버가 살아 있는 동안만 남는다 — 다른 dummy 쓰기(키맨·기안)와 같은 한계다.
 *
 * 장부 규칙(코드 불변·중복 코드)은 흉내 낸다 — 규칙이 빠지면 dummy에서 되는 입력이 live에서
 * 거부되고, 그 차이를 화면 검증이 못 잡는다.
 *
 * 0047부터 **재무 권한도 흉내 낸다**(아래 canReadBooks · assertKeepBooks · assertCloseBooks). 첫 실사용자가
 * TeamLead라 «자기 회사만 보이고 · 입력은 되고 · 마감은 안 된다»를 dummy 화면에서 봐야 하는데, 권한을 안
 * 흉내 내면 dummy의 팀장 세션이 다섯 회사 장부를 다 보고 다 마감한다 — 그 화면은 거짓이다.
 */

/** 0015 · 0047의 읽기 역할 — can_read_restricted()(등급 있는 AIAgent 포함). */
const RESTRICTED_READER = ['Chairman', 'GroupCFO', 'BusinessCEO', 'Executive']

/** 0047 can_read_books(). 회사 범위 AND ([제한] 열람 역할 OR '/finance/<회사>' 줄). */
function canReadBooks(businessId: string): boolean {
  const viewer = dummyViewer()
  if (viewer.revoked_at || !dummyHasBusiness(viewer, businessId)) return false
  if (RESTRICTED_READER.includes(viewer.role)) return true
  if (viewer.role === 'AIAgent') return viewer.max_security_class === 'Restricted' || viewer.max_security_class === 'Vault'
  return dummyFinanceGrant(viewer, businessId, 'read')
}

/** 0047 can_keep_books(). live는 RLS 거부(42501)라 같은 낱말로 던진다 — 화면이 같은 문장을 보여 준다. */
function assertKeepBooks(businessId: string) {
  const viewer = dummyViewer()
  const ok =
    !viewer.revoked_at &&
    (viewer.role === 'Chairman' ||
      viewer.role === 'GroupCFO' ||
      (dummyHasBusiness(viewer, businessId) && (viewer.role === 'BusinessCEO' || dummyFinanceGrant(viewer, businessId, 'write'))))
  if (!ok) throw new Error('new row violates row-level security policy (0047 can_keep_books)')
}

/** 0047 close_period()의 첫 검사 = can_close_books(target) — 역할 둘 또는 '/finance/<회사>' can_approve, AND 회사 범위. */
function assertCloseBooks(businessId: string) {
  const viewer = dummyViewer()
  const ok =
    !viewer.revoked_at &&
    dummyHasBusiness(viewer, businessId) &&
    (viewer.role === 'Chairman' || viewer.role === 'GroupCFO' || dummyFinanceGrant(viewer, businessId, 'approve'))
  if (!ok) throw new Error('close_forbidden')
}

/** 0050 finance_imports 정책이 부르는 두 판정 — dummy-finance-imports.ts · 첨부 대상 판정이 같은 잣대를 쓴다. */
export const dummyCanReadBooks = canReadBooks
export function dummyCanKeepBooks(businessId: string): boolean {
  try {
    assertKeepBooks(businessId)
    return true
  } catch {
    return false
  }
}

const key = (businessId: string, code: string) => `${businessId}|${code}`

/** 금액을 센트 정수로 — Postgres round(x, 2)와 같게 0.5는 0에서 먼 쪽으로(0051 리뷰 m-5). */
function cents(amount: number): number {
  const c = Math.sign(amount) * Math.round(Math.abs(amount) * 100)
  return c === 0 ? 0 : c
}

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

/**
 * 화면이 읽는 원장 한 벌. 복사본을 준다 — 화면이 sort() 한 번만 잘못 불러도 원장이 영구히 바뀐다.
 * 0047: live의 원장 select 정책(can_read_books)처럼 보는 사람이 읽을 수 있는 회사의 줄만 준다.
 */
export async function dummyLedger(): Promise<FinanceLedger> {
  const ledger = await loadMockLedger()
  const store = await accountStore()
  const readable = new Map<string, boolean>()
  const can = (businessId: string) => {
    if (!readable.has(businessId)) readable.set(businessId, canReadBooks(businessId))
    return readable.get(businessId)!
  }
  return {
    accounts: [...store.values()].filter((a) => can(a.business_id)).map((a) => ({ ...a })),
    journal: [...ledger.journal, ...lines].filter((j) => can(j.business_id)).map((j) =>
      closedMonths.has(key(j.business_id, periodOfDate(j.entry_date))) ? { ...j, closed: true } : { ...j },
    ),
    closings: [...ledger.closings, ...closings].filter((c) => can(c.business_id)),
    entries: entries.filter((e) => can(e.business_id)).map((e) => ({ ...e })),
    fxRates: [...ledger.fxRates],
    costIndices: [...ledger.costIndices],
  }
}

export async function createAccount(input: NewAccount, actor: AuditActor): Promise<Account> {
  assertKeepBooks(input.business_id)
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
  assertKeepBooks(businessId)
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

/**
 * ① ECOUNT 계정과목 등록의 장부 쪽 — 0051 ecount_accounts_import()의 «계획 확인 → 새 코드 → 이름»과 같은 순서 · 같은 거부 낱말.
 * 판정(본인 · draft · 종류 · sha256 · 권한 · ECOUNT 회사)은 부르는 쪽(dummy-finance-imports registerEcountAccounts)이 끝냈다.
 * **전부 확인한 뒤에 쓴다** — 확인과 쓰기 사이에 await가 없어서 중간에 멈춰 반쪽이 남지 않는다(DB의 한 트랜잭션 자리).
 * 감사는 dummy에 없다(콘솔 note뿐) — live는 같은 트랜잭션에서 먼저 남긴다.
 */
export async function dummyApplyEcountAccounts(
  businessId: string,
  merge: EcountAccountMerge,
  actor: AuditActor,
  auditNote: string,
): Promise<{ added: number; renamed: number }> {
  const store = await accountStore()
  const seen = new Set<string>()
  for (const c of merge.creates) {
    const ok =
      typeof c.account_code === 'string' && c.account_code !== '' && c.account_code === c.account_code.trim() &&
      typeof c.name === 'string' && c.name.trim() !== '' && typeof c.active === 'boolean' && !!c.category && !!c.section
    if (!ok || seen.has(c.account_code)) throw new Error(`ecount_plan_invalid: 새 계정 ${c.account_code}`)
    seen.add(c.account_code)
  }
  for (const r of merge.renames) {
    const ok =
      typeof r.account_code === 'string' && r.account_code !== '' && typeof r.from === 'string' &&
      typeof r.to === 'string' && r.to.trim() !== ''
    if (!ok || seen.has(r.account_code)) throw new Error(`ecount_plan_invalid: 이름 바꿈 ${r.account_code}`)
    seen.add(r.account_code)
  }
  // 0051 리뷰 m-1: 이름은 늘 앞뒤 공백을 걷고 비교한다. 공백만 다른 바꿈은 빠진다(쓰기도 감사도 없음).
  const renames = merge.renames.filter((r) => r.to.trim() !== r.from.trim())
  for (const c of merge.creates) {
    if (store.has(key(businessId, c.account_code))) throw new Error(`account_exists: ${c.account_code}`)
  }
  for (const r of renames) {
    if (store.get(key(businessId, r.account_code))?.name.trim() !== r.from.trim()) throw new Error(`account_changed: ${r.account_code}`)
  }
  // 0015 accounts_category_section 제약
  for (const c of merge.creates) {
    if (!SECTION_CATEGORIES[c.section]?.includes(c.category)) throw new Error('new row violates check constraint "accounts_category_section"')
  }

  const fetched_at = new Date().toISOString()
  for (const c of merge.creates) {
    store.set(key(businessId, c.account_code), {
      business_id: businessId,
      account_code: c.account_code,
      name: c.name.trim(),
      category: c.category,
      section: c.section,
      cash_flow: c.cash_flow,
      source: 'ecount',
      fetched_at,
      closed: false,
      active: c.active,
    })
  }
  for (const r of renames) {
    const before = store.get(key(businessId, r.account_code))!
    store.set(key(businessId, r.account_code), { ...before, name: r.to.trim() })
  }
  note(actor, `${auditNote} — 더함 ${merge.creates.length} · 이름 ${renames.length}`)
  return { added: merge.creates.length, renamed: renames.length }
}

export async function applyStandardChart(businessId: string, actor: AuditActor): Promise<number> {
  assertKeepBooks(businessId)
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
  assertKeepBooks(input.business_id)
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
  assertKeepBooks(input.business_id)
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
  assertCloseBooks(businessId)
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
  assertKeepBooks(input.business_id)
  if (input.lines.length === 0) throw new Error('재무제표에 줄이 하나도 없습니다.')

  // 자산 + 부채 + 자본 = 0. 0020의 함수가 보는 것과 같은 식이다.
  const ledger = await dummyLedger()
  const sectionOf = new Map(
    ledger.accounts
      .filter((a) => a.business_id === input.business_id)
      .map((a) => [a.account_code, a.section]),
  )
  // 0051 리뷰 m-5: 줄마다 2자리로 반올림한 뒤 잰다(DB round(x, 2)와 같게 — 센트 정수로 더해 부동소수 오차를 없앤다).
  const balanceCents = input.lines.reduce((total, l) => {
    const section = sectionOf.get(l.account_code)
    return section && BALANCE_SHEET_SECTIONS.includes(section) ? total + cents(l.amount) : total
  }, 0)
  if (balanceCents !== 0) throw new Error(`재무상태표가 닫히지 않습니다. 차이 ${balanceCents / 100}원`)

  const now = new Date().toISOString()
  // 0050: 세무사 저장은 세무사 행만 supersede한다 — ECOUNT 잠정 행은 그대로.
  const prev = officialStatements.find(
    (s) =>
      s.business_id === input.business_id &&
      s.period_kind === input.period_kind &&
      s.period_key === input.period_key &&
      s.basis === 'accountant' &&
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
    basis: 'accountant',
    import_id: null,
  })
  officialLines.push(
    ...input.lines.map((l) => ({
      statement_id: id,
      business_id: input.business_id,
      account_code: l.account_code,
      amount: cents(l.amount) / 100,
    })),
  )
  note(actor, `official ${input.business_id}:${input.period_key}${prev ? ` (정정 #${prev.id})` : ''}`)
  return id
}

/**
 * ② ECOUNT 연간 등록의 결산 쪽 — 0051 official_statement_import_ecount()와 같은 순서 · 같은 거부 낱말:
 * 줄 모양 · 한 계정 한 줄 · 장부에 있는 계정 → 세무사 확정 해 → 균형 → 같은 해 ECOUNT 활성 행 supersede → 헤더 · 줄.
 * 판정(본인 · draft · 종류 · 해시 · 권한)은 부르는 쪽이 끝냈다. 확인을 다 한 뒤에 쓴다(반쪽 없음).
 */
export async function dummyImportEcountAnnual(
  imp: { business_id: string; period_key: string; import_id: string; file_name: string },
  lines: { account_code: string; amount: number }[],
  actor: AuditActor,
): Promise<number> {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('statement_empty')
  const codes = new Set<string>()
  for (const l of lines) {
    if (!l || typeof l.account_code !== 'string' || l.account_code === '' || typeof l.amount !== 'number' || !Number.isFinite(l.amount)) {
      throw new Error(`ecount_plan_invalid: 줄 ${l?.account_code ?? '?'}`)
    }
    if (codes.has(l.account_code)) throw new Error(`ecount_plan_invalid: 계정 ${l.account_code}에 줄 둘`)
    codes.add(l.account_code)
  }
  const store = await accountStore()
  for (const l of lines) if (!store.has(key(imp.business_id, l.account_code))) throw new Error(`statement_unknown_account: ${l.account_code}`)
  const active = (basis: OfficialStatementBasis) =>
    officialStatements.find(
      (s) =>
        s.business_id === imp.business_id && s.period_kind === 'year' && s.period_key === imp.period_key && s.basis === basis && s.superseded_at === null,
    )
  if (active('accountant')) throw new Error('official_confirmed')
  const balanceCents = lines.reduce((t, l) => {
    const section = store.get(key(imp.business_id, l.account_code))!.section
    return BALANCE_SHEET_SECTIONS.includes(section) ? t + cents(l.amount) : t
  }, 0)
  if (balanceCents !== 0) throw new Error(`statement_unbalanced: 차이 ${balanceCents / 100}원`)

  const now = new Date().toISOString()
  const prev = active('ecount_excel')
  if (prev) prev.superseded_at = now
  const id = ++officialSeq
  officialStatements.push({
    id,
    business_id: imp.business_id,
    period_kind: 'year',
    period_key: imp.period_key,
    evidence_url: null,
    memo: ecountAuditNote({ kind: 'annual', period: imp.period_key, fileName: imp.file_name, importId: imp.import_id }),
    created_by: actor.user_id,
    created_at: now,
    superseded_at: null,
    supersedes_id: prev?.id ?? null,
    basis: 'ecount_excel',
    import_id: imp.import_id,
  })
  officialLines.push(...lines.map((l) => ({ statement_id: id, business_id: imp.business_id, account_code: l.account_code, amount: cents(l.amount) / 100 })))
  note(actor, `official ECOUNT ${imp.business_id}:${imp.period_key}${prev ? ` (이전 #${prev.id})` : ''}`)
  return id
}

/** 0050 finance_import_slips의 dummy 자리 — 월별 업로드가 세운 전표 ↔ (회사, 달). 활성은 달마다 하나. */
const importSlips: { business_id: string; month: string; slip_no: string; import_id: string; superseded_at: string | null }[] = []

const PL_SECTIONS: readonly string[] = ['revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax']
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** 'YYYY-MM'의 말일. */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/**
 * ③ ECOUNT 월별 손익 등록의 장부 쪽 — 0052 ecount_monthly_import()와 같은 순서 · 같은 거부 낱말:
 * 모양(달 · 줄 · 한 달 한 계정 · 0원 · 대응 계정) → 장부에 있는 계정 → 손익 계정만 → 활성 → 마감 달 → 세무사 확정 달 →
 * 대응 계정(없으면 만듦 · equity · 활성) → 달마다(활성 업로드 전표 없음: 새 전표 / 이미 역분개: 멈춤 / 같은 내용: 건너뜀 /
 * 다른 내용: 역분개 + 정정분개 + 옛 줄 내림). 판정(본인 · draft · 종류 · 해시 · 해 · 당월/누계 · 원본)은 부르는 쪽이 끝냈다.
 * **확인을 다 한 뒤에 쓴다** — 달마다 전표도 쓰기 전에 entryProblem으로 먼저 다 잰다(DB의 한 트랜잭션 자리). 감사는 콘솔 note뿐.
 */
export async function dummyImportEcountMonthly(
  imp: { business_id: string; period_key: string; import_id: string; file_name: string },
  months: MonthlyLedgerMonth[],
  actor: AuditActor,
): Promise<EcountMonthlyResult> {
  const C = ECOUNT_MONTHLY_COUNTER.code
  if (!Array.isArray(months) || months.length === 0) throw new Error('statement_empty')
  const seenMonths = new Set<string>()
  for (const m of months) {
    const ok =
      !!m && typeof m.month === 'string' && MONTH.test(m.month) &&
      (m.month === imp.period_key || m.month.startsWith(`${imp.period_key}-`)) && Array.isArray(m.lines)
    if (!ok) throw new Error(`ecount_plan_invalid: 달 ${m?.month ?? '?'}`)
    if (seenMonths.has(m.month)) throw new Error(`ecount_plan_invalid: 달 ${m.month}가 두 번`)
    seenMonths.add(m.month)
  }
  // 0056 리뷰 I-2: 빈 달은 되돌릴 전표 번호(미리보기 때 본 활성 업로드 전표)를 들고 온다 · 금액 있는 달은 들고 오지 않는다.
  for (const m of months) {
    const bad = m.lines.length === 0 ? typeof m.reverses !== 'string' || !/^M\d{4}-\d{6}$/.test(m.reverses) : m.reverses !== undefined
    if (bad) throw new Error(`ecount_plan_invalid: 달 ${m.month} reverses`)
  }
  for (const m of months) {
    const codes = new Set<string>()
    for (const l of m.lines) {
      const ok =
        !!l && typeof l.account_code === 'string' && l.account_code !== '' && typeof l.amount === 'number' &&
        Number.isFinite(l.amount) && cents(l.amount) !== 0 && l.account_code !== C
      if (!ok) throw new Error(`ecount_plan_invalid: 줄 ${m.month} ${l?.account_code ?? '?'}`)
      if (codes.has(l.account_code)) throw new Error(`ecount_plan_invalid: ${m.month} ${l.account_code}에 줄 둘`)
      codes.add(l.account_code)
    }
  }
  const store = await accountStore()
  const all = months.flatMap((m) => m.lines)
  for (const l of all) if (!store.has(key(imp.business_id, l.account_code))) throw new Error(`statement_unknown_account: ${l.account_code}`)
  for (const l of all) {
    if (!PL_SECTIONS.includes(store.get(key(imp.business_id, l.account_code))!.section)) throw new Error(`ecount_monthly_bs_account: ${l.account_code}`)
  }
  for (const l of all) if (!store.get(key(imp.business_id, l.account_code))!.active) throw new Error(`inactive_account: ${l.account_code}`)

  const ledger = await dummyLedger()
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month))
  const last = ledger.closings
    .filter((c) => c.business_id === imp.business_id)
    .reduce<string | null>((m, c) => (m === null || c.period > m ? c.period : m), null)
  const activeSlip = (month: string) => importSlips.find((x) => x.business_id === imp.business_id && x.month === month && x.superseded_at === null)
  // 0056: 마감 · 확정 판정은 손댈 달만 — 금액 있는 달 + 되돌릴 업로드 전표가 있는 빈 달.
  const touched = sorted.filter((m) => m.lines.length > 0 || activeSlip(m.month))
  const closed = touched.find((m) => last !== null && m.month <= last)
  if (closed) throw new Error(`closed_period: ${closed.month}`)
  const officials = officialStatements.filter((s) => s.business_id === imp.business_id && s.basis === 'accountant' && s.superseded_at === null)
  const quarterOf = (month: string) => `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5)) + 2) / 3)}`
  const locked = touched.find((m) =>
    officials.some(
      (s) => (s.period_kind === 'year' && s.period_key === m.month.slice(0, 4)) || (s.period_kind === 'quarter' && s.period_key === quarterOf(m.month)),
    ),
  )
  if (locked) throw new Error(`official_month_locked: ${locked.month}`)
  const counter = store.get(key(imp.business_id, C))
  const anyLines = sorted.some((m) => m.lines.length > 0)
  if (anyLines && counter && (counter.section !== 'equity' || !counter.active)) throw new Error('ecount_counter_account_invalid')

  // 달마다 할 일을 먼저 다 정한다(쓰기 전). 전표 규칙은 entryProblem 한 곳(대응 계정은 아래에서 만들 것으로 본다).
  const counterRow: Account = counter ?? {
    business_id: imp.business_id,
    account_code: C,
    name: ECOUNT_MONTHLY_COUNTER.name,
    category: 'equity',
    section: 'equity',
    cash_flow: 'operating',
    source: 'ecount',
    fetched_at: new Date().toISOString(),
    closed: false,
    active: true,
  }
  const check = { accounts: [...ledger.accounts.filter((a) => !(a.business_id === imp.business_id && a.account_code === C)), counterRow], closings: ledger.closings }
  const shape = (ls: readonly { account_code: string; side: string; amount: number }[]) =>
    ls.map((l) => `${l.account_code}|${l.side}|${cents(l.amount)}`).sort().join(',')
  const plans = sorted.map((m) => {
    const prevActive = activeSlip(m.month)
    if (m.lines.length === 0 && prevActive?.slip_no !== m.reverses) {
      throw new Error(`import_changed: ecount_ledger_changed ${m.month} ${m.reverses} → ${prevActive?.slip_no ?? '없음'}`)
    }
    if (prevActive && entries.some((e) => e.business_id === imp.business_id && e.corrects_id === prevActive.slip_no && e.correction_kind === 'reversal')) {
      throw new Error(`ecount_month_reversed: ${m.month} ${prevActive.slip_no}`)
    }
    // 0056 빈 달 — 전표 규칙을 잴 것이 없다(역분개는 원 전표를 뒤집을 뿐).
    if (m.lines.length === 0) return { month: m.month, entry: null, prev: prevActive, same: false }
    const sum = m.lines.reduce((t, l) => t + cents(l.amount), 0)
    const slip: DraftLine[] = [...m.lines]
      .sort((a, b) => (a.account_code < b.account_code ? -1 : a.account_code > b.account_code ? 1 : 0))
      .map((l): DraftLine => ({ account_code: l.account_code, side: cents(l.amount) > 0 ? 'debit' : 'credit', amount: Math.abs(cents(l.amount)) / 100 }))
    if (sum !== 0) slip.push({ account_code: C, side: sum > 0 ? 'credit' : 'debit', amount: Math.abs(sum) / 100, memo: ECOUNT_MONTHLY_COUNTER.name })
    const entry: NewJournalEntry = {
      business_id: imp.business_id,
      entry_date: monthEnd(m.month),
      memo: `[ECOUNT 엑셀] ${m.month} 월별 손익 · import ${imp.import_id}`,
      evidence_url: null,
      lines: slip,
    }
    const problem = entryProblem(entry, check)
    if (problem) throw new Error(`invalid_entry: ${problem}`)
    const prev = prevActive
    const same = !!prev && shape(lines.filter((l) => l.business_id === imp.business_id && l.slip_no === prev.slip_no)) === shape(slip)
    return { month: m.month, entry, prev, same }
  })

  // 쓰기 — 대응 계정 → 달마다.
  if (!counter && anyLines) store.set(key(imp.business_id, C), counterRow)
  const now = new Date().toISOString()
  const result: EcountMonthlyResult = { posted: 0, corrected: 0, unchanged: 0, reversed: 0, months: [] }
  const flip = (slipNo: string) =>
    lines
      .filter((l) => l.business_id === imp.business_id && l.slip_no === slipNo)
      .sort((a, b) => a.line_no - b.line_no)
      .map((l): DraftLine => ({ account_code: l.account_code, side: l.side === 'debit' ? 'credit' : 'debit', amount: l.amount, memo: l.memo }))
  for (const p of plans) {
    if (p.entry === null) {
      // 0056 빈 달: 미리보기 때 본 업로드 전표(위에서 대조)를 역분개만 + 옛 줄 내림(새 활성 줄 없음).
      const prev = p.prev!
      const orig = entries.find((e) => e.business_id === imp.business_id && e.slip_no === prev.slip_no)!
      const reversal = insertEntry(
        { business_id: imp.business_id, entry_date: monthEnd(p.month), memo: `[역분개] ${orig.memo}`, evidence_url: orig.evidence_url, lines: flip(prev.slip_no) },
        actor,
        { corrects_id: prev.slip_no, kind: 'reversal' },
      )
      prev.superseded_at = now
      result.reversed += 1
      result.months.push({ month: p.month, action: 'reversed', reversal, previous: prev.slip_no })
      continue
    }
    if (p.prev && p.same) {
      result.unchanged += 1
      result.months.push({ month: p.month, action: 'unchanged', slip_no: p.prev.slip_no })
      continue
    }
    if (!p.prev) {
      const slip_no = insertEntry(p.entry, actor, null)
      importSlips.push({ business_id: imp.business_id, month: p.month, slip_no, import_id: imp.import_id, superseded_at: null })
      result.posted += 1
      result.months.push({ month: p.month, action: 'posted', slip_no })
      continue
    }
    // 0016 post_correction과 같은 모양 — 역분개(원 줄을 line_no 순서로 차대만 뒤집음) + 정정분개.
    const prev = p.prev
    const orig = entries.find((e) => e.business_id === imp.business_id && e.slip_no === prev.slip_no)!
    const flipped = flip(prev.slip_no)
    const reversal = insertEntry(
      { business_id: imp.business_id, entry_date: p.entry.entry_date, memo: `[역분개] ${orig.memo}`, evidence_url: orig.evidence_url, lines: flipped },
      actor,
      { corrects_id: prev.slip_no, kind: 'reversal' },
    )
    const restated = insertEntry(p.entry, actor, { corrects_id: prev.slip_no, kind: 'restatement' })
    prev.superseded_at = now
    importSlips.push({ business_id: imp.business_id, month: p.month, slip_no: restated, import_id: imp.import_id, superseded_at: null })
    result.corrected += 1
    result.months.push({ month: p.month, action: 'corrected', slip_no: restated, reversal, previous: prev.slip_no })
  }
  note(
    actor,
    `${ecountAuditNote({ kind: 'monthly', period: imp.period_key, fileName: imp.file_name, importId: imp.import_id })} — 새 ${result.posted} · 정정 ${result.corrected} · 같음 ${result.unchanged} · 빈 달 역분개 ${result.reversed}`,
  )
  return result
}

/** dummy 월별 업로드 전표 줄(검사용) — 회사의 활성 · 내려간 줄 전부. */
export function dummyImportSlips(businessId: string) {
  return importSlips.filter((x) => x.business_id === businessId).map((x) => ({ ...x }))
}

/** 활성 행만. 정정으로 밀려난 것은 목록에 없다 — 잠금 판정이 옛 결산을 보면 안 된다. 기본은 세무사 확정만(live와 같다). */
export async function listOfficialStatements(businessId: string, basis: OfficialStatementBasis | 'all' = 'accountant'): Promise<OfficialStatement[]> {
  if (!canReadBooks(businessId)) return []
  return officialStatements
    .filter((s) => s.business_id === businessId && s.superseded_at === null && (basis === 'all' || (s.basis ?? 'accountant') === basis))
    .map((s) => ({ ...s }))
}

/** 화면이 이전 값을 보여 줄 때 쓴다. */
export async function officialStatementLines(statementId: number): Promise<OfficialStatementLine[]> {
  return officialLines
    .filter((l) => l.statement_id === statementId && canReadBooks(l.business_id))
    .map((l) => ({ ...l }))
}

// ---------------------------------------------------------------------
// Phase 5-D — 프로세스차트(0021, 0036). 링크만 들고 있다.
// dummy에도 DY 세 팀을 미리 넣어 둔다 — 0021·0036 시드와 같은 게시 링크라
// 화면을 dummy로 검증한 모습이 live와 같다.
//
// 영업(0036)의 sort_order는 5다 — 경영지원·연구소보다 작아 목록 맨 앞에 온다
// (listProcessCharts는 business_id, sort_order 순으로 정렬한다). 회장 지시대로
// "제일 먼저 보이게" 하는 값이고, 나머지 두 행의 10·20은 그대로 둔다.
// ---------------------------------------------------------------------
const processCharts: ProcessChart[] = [
  {
    id: 3,
    business_id: 'biz_dy',
    team_name: '영업',
    title: 'DY 영업 업무 프로세스',
    embed_url:
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vTIW44d3lfRw9wIy61BL3u0y5Nfi2fdHEyOMzSfef1BP_NLus2WPez8PDB997sFq3iQ1RbYhh2FHZ2i/pubhtml',
    sort_order: 5,
    updated_by: 'dummy',
    updated_at: MOCK_FETCHED_AT,
    // 0071 — dummy는 가짜 시트(lib/process-sync/fake.ts)를 읽는다. 연구소는 비워 «연결 전» 모습을 남긴다.
    sheet_id: DUMMY_SHEET_IDS.sales,
    sheet_tab: null,
  },
  {
    id: 1,
    business_id: 'biz_dy',
    team_name: '경영지원',
    title: 'DY 경영지원 업무 프로세스',
    embed_url:
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vQyRIlUseLHMSeJT0Tr8HvnL0MmHpE8IeR0zx4AvVhJc5HJkcRZ_rzxy14l6pssZHdvXsRceC3mZPi5/pubhtml',
    sort_order: 10,
    updated_by: 'dummy',
    updated_at: MOCK_FETCHED_AT,
    sheet_id: DUMMY_SHEET_IDS.support,
    sheet_tab: null,
  },
  {
    id: 2,
    business_id: 'biz_dy',
    team_name: '연구소',
    title: 'DY 연구소 업무 프로세스',
    embed_url:
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vTR5jxnGGpYiiu-GBVI-45HmeRSbcKV5XzzD15NsxrwrWPaxJAPuSTQAuf6t1psQPg96ECH-p6TARRs/pubhtml',
    sort_order: 20,
    updated_by: 'dummy',
    updated_at: MOCK_FETCHED_AT,
    sheet_id: null,
    sheet_tab: null,
  },
]
let processSeq = processCharts.length

/** 0071 can_read_process_chart(biz, team). 임원 이상 = 자기 회사 전부, 팀장 · 팀원 = 자기 팀 탭만. */
function canReadProcessCharts(businessId: string, teamName: string): boolean {
  return dummyProcessVisible(dummyViewer(), businessId, teamName)
}

/** 0071 정의자 흉내 — 동기화(AI Agent 자리)가 RLS 없이 탭을 찾는다. */
export function dummyProcessChartById(id: number): ProcessChart | undefined {
  const c = processCharts.find((x) => x.id === id)
  return c ? { ...c } : undefined
}

/** 0021 can_write_process_charts(). Chairman · GroupCFO뿐(회사 범위를 보지 않는다). */
function canWriteProcessCharts(): boolean {
  const viewer = dummyViewer()
  return !viewer.revoked_at && (viewer.role === 'Chairman' || viewer.role === 'GroupCFO')
}

export async function listProcessCharts(): Promise<ProcessChart[]> {
  return processCharts
    .filter((c) => canReadProcessCharts(c.business_id, c.team_name))
    .map((c) => ({ ...c }))
    .sort((a, b) => a.business_id.localeCompare(b.business_id) || a.sort_order - b.sort_order)
}

export async function saveProcessChart(input: ProcessChartInput, actor: AuditActor): Promise<number> {
  // 링크 검증은 화면과 DB가 한다. dummy는 DB 자리라 여기서 한 번 더 본다 —
  // dummy에서 통과한 값이 live에서 막히면 dummy 검증의 뜻이 없다.
  if (embedProblem(input.embed_url) !== null) throw new Error('invalid_embed_url')
  // live는 RLS 거부(42501)다. 같은 낱말로 던져야 액션이 같은 «권한이 없습니다» 문장을 고른다.
  if (!canWriteProcessCharts()) throw new Error('new row violates row-level security policy (0021 can_write_process_charts)')

  const existing = input.id ? processCharts.find((c) => c.id === input.id) : undefined
  const now = new Date().toISOString()
  if (existing) {
    Object.assign(existing, {
      team_name: input.team_name.trim(),
      title: input.title.trim(),
      embed_url: input.embed_url.trim(),
      sort_order: input.sort_order,
      sheet_id: input.sheet_id ?? null,
      sheet_tab: input.sheet_tab ?? null,
      updated_by: actor.user_id,
      updated_at: now,
    })
    note(actor, `process chart update ${existing.id}`)
    return existing.id
  }

  const id = ++processSeq
  processCharts.push({
    id,
    business_id: input.business_id,
    team_name: input.team_name.trim(),
    title: input.title.trim(),
    embed_url: input.embed_url.trim(),
    sort_order: input.sort_order,
    sheet_id: input.sheet_id ?? null,
    sheet_tab: input.sheet_tab ?? null,
    updated_by: actor.user_id,
    updated_at: now,
  })
  note(actor, `process chart insert ${id}`)
  return id
}

export async function deleteProcessChart(id: number, actor: AuditActor): Promise<void> {
  // live의 delete는 RLS에 걸리면 오류 없이 0행이다 — dummy도 조용히 아무것도 지우지 않는다.
  if (!canWriteProcessCharts()) return
  const at = processCharts.findIndex((c) => c.id === id)
  if (at >= 0) processCharts.splice(at, 1)
  note(actor, `process chart delete ${id}`)
}
