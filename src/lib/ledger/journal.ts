import type {
  Account,
  BusinessId,
  DrCr,
  FinanceLedger,
  IsoDate,
  JournalEntry,
  JournalLine,
  PeriodKey,
} from '@/types'

import { periodOfDate } from './basis'

/**
 * 전표 한 장의 규칙 (Phase 2-B 블록 2). 입력 폼 · Server Action · dummy 어댑터가 같은 규칙을 본다.
 *
 * 진짜 문은 DB다(0016) — 차대 일치(journal_slip_balanced), 마감 달(journal_lines_manual_guard),
 * 비활성 계정, 권한(can_keep_books). 여기는 저장을 누르기 전에 같은 말을 사람 말로 먼저 하는 자리다.
 * 두 곳이 어긋나면 폼은 통과시키고 DB가 거부한다 — 데이터는 틀리지 않고, 문장만 덜 친절해진다.
 */

export interface DraftLine {
  account_code: string
  side: DrCr
  /** 원 단위 양의 정수 */
  amount: number
  memo?: string
}

export interface NewJournalEntry {
  business_id: BusinessId
  entry_date: IsoDate
  memo: string
  evidence_url: string | null
  lines: DraftLine[]
}

export const ENTRY_MEMO_MAX = 200
/** 한 전표 한 줄의 상한. numeric(20,2)보다 훨씬 작게 — 자릿수를 잘못 친 입력을 막는다(1경 원). */
export const LINE_AMOUNT_MAX = 10_000_000_000_000_000

export const CLOSED_PERIOD_MESSAGE = '마감된 달입니다. 당월에 정정 전표로 입력하세요.'

/** 한국 시간 오늘. 서버(UTC)와 브라우저가 같은 날짜를 말하게 한다. */
export function todayKst(now: Date = new Date()): IsoDate {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

/** 이 회사의 마지막 마감 달. 마감이 없으면 null. */
export function lastClosedPeriod(ledger: Pick<FinanceLedger, 'closings'>, businessId: BusinessId): PeriodKey | null {
  let last: PeriodKey | null = null
  for (const c of ledger.closings) {
    if (c.business_id === businessId && (last === null || c.period > last)) last = c.period
  }
  return last
}

/** 이 달에 전표를 넣을 수 없나. 마감된 달과 그보다 앞선 달이다(0016 closed_period와 같다). */
export function isPeriodLocked(
  ledger: Pick<FinanceLedger, 'closings'>,
  businessId: BusinessId,
  period: PeriodKey,
): boolean {
  const last = lastClosedPeriod(ledger, businessId)
  return last !== null && period <= last
}

export function slipTotals(lines: readonly Pick<DraftLine, 'side' | 'amount'>[]): { debit: number; credit: number } {
  let debit = 0
  let credit = 0
  for (const l of lines) {
    if (l.side === 'debit') debit += l.amount
    else credit += l.amount
  }
  return { debit, credit }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** 저장해도 되는 전표인가. 안 되면 사람이 읽을 문장, 되면 null. */
export function entryProblem(
  entry: NewJournalEntry,
  ledger: Pick<FinanceLedger, 'accounts' | 'closings'>,
): string | null {
  if (!isIsoDate(entry.entry_date)) return '전표 일자가 올바르지 않습니다.'
  if (!entry.memo.trim()) return '적요를 입력하세요.'
  if (entry.memo.length > ENTRY_MEMO_MAX) return `적요는 ${ENTRY_MEMO_MAX}자까지입니다.`
  if (entry.evidence_url && !/^https?:\/\//i.test(entry.evidence_url)) {
    return '증빙 링크는 http:// 또는 https://로 시작해야 합니다.'
  }
  if (entry.lines.length < 2) return '라인이 두 줄 이상이어야 합니다.'

  const accounts = new Map<string, Account>(
    ledger.accounts.filter((a) => a.business_id === entry.business_id).map((a) => [a.account_code, a]),
  )
  for (const [i, l] of entry.lines.entries()) {
    const n = i + 1
    if (!l.account_code) return `${n}번째 줄의 계정을 고르세요.`
    const a = accounts.get(l.account_code)
    if (!a) return `${n}번째 줄의 계정 ${l.account_code}가 이 회사에 없습니다.`
    if (!a.active) return `${n}번째 줄의 계정 ${a.account_code} ${a.name}은(는) 비활성입니다.`
    if (l.side !== 'debit' && l.side !== 'credit') return `${n}번째 줄의 차변/대변이 올바르지 않습니다.`
    if (!Number.isSafeInteger(l.amount) || l.amount <= 0) return `${n}번째 줄의 금액은 1원 이상의 정수여야 합니다.`
    if (l.amount > LINE_AMOUNT_MAX) return `${n}번째 줄의 금액이 너무 큽니다.`
  }

  const { debit, credit } = slipTotals(entry.lines)
  if (debit !== credit) {
    return `차변 합(${debit.toLocaleString('ko-KR')})과 대변 합(${credit.toLocaleString('ko-KR')})이 같지 않습니다.`
  }
  if (isPeriodLocked(ledger, entry.business_id, periodOfDate(entry.entry_date))) return CLOSED_PERIOD_MESSAGE
  return null
}

/** 화면 한 줄 — 전표 한 장. ECOUNT·mock 전표는 헤더가 없어 첫 라인의 적요를 쓴다. */
export interface SlipView {
  slip_no: string
  entry_date: IsoDate
  memo: string
  evidence_url: string | null
  /** 자체 장부(헤더 있음)인가 */
  own: boolean
  /** 그 달이 마감됐나 */
  closed: boolean
  lines: JournalLine[]
  debit: number
  credit: number
}

/** 한 회사 한 달의 전표. 날짜 → 전표번호 순. */
export function slipsOf(ledger: FinanceLedger, businessId: BusinessId, period: PeriodKey): SlipView[] {
  const headers = new Map<string, JournalEntry>(
    ledger.entries.filter((e) => e.business_id === businessId).map((e) => [e.slip_no, e]),
  )
  const bySlip = new Map<string, JournalLine[]>()
  for (const j of ledger.journal) {
    if (j.business_id !== businessId || periodOfDate(j.entry_date) !== period) continue
    const list = bySlip.get(j.slip_no) ?? []
    list.push(j)
    bySlip.set(j.slip_no, list)
  }
  const locked = isPeriodLocked(ledger, businessId, period)
  return [...bySlip]
    .map(([slip_no, lines]): SlipView => {
      const sorted = [...lines].sort((a, b) => a.line_no - b.line_no)
      const h = headers.get(slip_no)
      const { debit, credit } = slipTotals(sorted)
      return {
        slip_no,
        entry_date: h?.entry_date ?? sorted[0].entry_date,
        memo: h?.memo ?? sorted[0].memo,
        evidence_url: h?.evidence_url ?? null,
        own: h !== undefined,
        closed: locked,
        lines: sorted,
        debit,
        credit,
      }
    })
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.slip_no.localeCompare(b.slip_no))
}

/** 전표 화면의 달 목록, 최신 순. 전표가 있는 달 + 오늘이 속한 달(아직 비어 있어도 입력할 자리). */
export function journalPeriods(ledger: FinanceLedger, businessId: BusinessId, today: IsoDate): PeriodKey[] {
  const periods = new Set<PeriodKey>([periodOfDate(today)])
  for (const j of ledger.journal) {
    if (j.business_id === businessId) periods.add(periodOfDate(j.entry_date))
  }
  return [...periods].sort().reverse()
}

/** 전표번호. 0016 post_journal_entry()와 같은 모양(M{YYMM}-{일련번호 6자리}). dummy가 쓴다. */
export function slipNumber(entryDate: IsoDate, seq: number): string {
  return `M${entryDate.slice(2, 4)}${entryDate.slice(5, 7)}-${String(seq).padStart(6, '0')}`
}
