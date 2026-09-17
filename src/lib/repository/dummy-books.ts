import { MOCK_FETCHED_AT } from '@/lib/ecount/mock'
import { loadMockLedger } from '@/lib/ecount/mock-ledger'
import { STANDARD_CHART, STANDARD_CHART_BUSINESSES, type StandardAccount } from '@/lib/ledger/standard-chart'
import type { Account, FinanceLedger } from '@/types'

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
    journal: [...ledger.journal],
    closings: [...ledger.closings],
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
