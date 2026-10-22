/**
 * 12가지 지표 «자료 부족: 무엇이 필요» — 공식(kpis.ts)이 실제로 읽는 입력을 하나씩 빼 보고, 빠진 입력의 이름이 그 지표의 말에 나오는지(2026-10-22).
 *   npm run check:kpi-needs
 *
 * 손으로 만든 작은 ctx(가짜 회사 · 순수 함수만 — 저장소 · AI · 네트워크 0). 다 있으면 5 · 6(이 화면에서 계산하지 않음)만 «자료 부족».
 * 입력 하나를 빼면: 그 입력만 쓰는 지표는 «자료 부족» + 그 이름, 다른 길(대신 쓰는 입력)이 있는 지표는 계산이 그대로 선다.
 */
import assert from 'node:assert/strict'

import { buildChecklist } from '../src/lib/finance-overview/checklist'
import { addMonths, type Ctx, type MonthData, type OfficialYear } from '../src/lib/finance-overview/engine'
import { computeKpis, KPI_NEED, type Kpi } from '../src/lib/finance-overview/kpis'
import { KPI_DEFAULTS } from '../src/lib/finance-overview/settings'
import { ledgerScope } from '../src/lib/ledger/scope'
import type { Account, AccountSection, FinanceLedger, FinRow, FinUpload } from '../src/types'

const BIZ = 'biz_t'
const TODAY = '2026-10-19'
const PERIOD = '2026-09'

type Drop = 'ledger' | 'ledgerRevenue' | 'sales' | 'cashflow' | 'balance' | 'official' | 'material' | 'valuation' | 'loans' | 'borrowings' | 'safety' | 'krw' | 'rate'
type DropIn = Drop | `ledgerExcept:${string}` | `salesOnly:${string}`

const ACCTS: [string, string, AccountSection, Account['category']][] = [
  ['4040', '제품매출', 'revenue', 'revenue' as Account['category']],
  ['4550', '원재료비', 'cogs', 'raw_material' as Account['category']],
  ['8020', '직원급여', 'sga', 'sga' as Account['category']],
  ['1030', '보통예금', 'cash', 'cash' as Account['category']],
  ['1080', '외상매출금', 'receivable', 'receivable' as Account['category']],
  ['2600', '단기차입금', 'other_liability', 'other_liability' as Account['category']],
  ['3310', '자본금', 'equity', 'equity' as Account['category']],
]

const row = (o: Record<string, string | number | null>, i = 0): FinRow => ({ row_no: i, ...o }) as FinRow

function build(drops: DropIn[] = []): Ctx {
  const d = new Set<string>(drops)
  const keepLedger = drops.find((x) => x.startsWith('ledgerExcept:'))?.slice('ledgerExcept:'.length)
  const salesOnly = drops.find((x) => x.startsWith('salesOnly:'))?.slice('salesOnly:'.length)
  const accounts = new Map<string, Account>(ACCTS.map(([code, name, section, category]) => [code, { business_id: BIZ, account_code: code, name, section, category, cash_flow: null, active: true } as unknown as Account]))
  const months = new Map<string, MonthData>()
  for (let p = '2025-09'; p <= '2027-01'; p = addMonths(p, 1)) {
    const m: MonthData = {
      period: p, ledgerSums: [], ledgerLines: [], sales: [], shipment: [], payroll: [], cashflow: [], card: [], overseas: [], promo: [], loans: [], borrowings: [], savings: [], taxInvoice: [], production: [],
      material: null, valuation: { wip: null, finished: null }, received: new Set(),
    }
    const thisYear = p >= '2026-01' && p <= PERIOD
    const ledgerHere = thisYear && !d.has('ledger') && (keepLedger === undefined || keepLedger === p) && !(salesOnly !== undefined)
    if (ledgerHere) {
      const k = Number(p.slice(5, 7))
      m.ledgerSums = [
        ...(d.has('ledgerRevenue') && p === PERIOD ? [] : [row({ account_code: '4040', account_name: '제품매출', debit: 0, credit: 1_000_000_000 + k * 10_000_000 })]),
        row({ account_code: '4550', account_name: '원재료비', debit: 600_000_000, credit: 0 }),
        row({ account_code: '8020', account_name: '직원급여', debit: 200_000_000, credit: 0 }),
        row({ account_code: '1030', account_name: '보통예금', debit: 100_000_000, credit: 0 }),
        row({ account_code: '1080', account_name: '외상매출금', debit: 50_000_000, credit: 0 }),
      ]
    }
    const salesHere = thisYear && !d.has('sales') && (salesOnly === undefined || p <= salesOnly)
    if (salesHere && (p === PERIOD || salesOnly !== undefined)) m.sales = [row({ customer: 'A사', product: '제품1', amount: 900_000_000, qty: 1000 })]
    if (p >= '2026-08' && p <= '2026-12' && !d.has('cashflow')) {
      const planned = p > '2026-10' ? 1 : 0
      const rows: FinRow[] = [row({ account: '국민', currency: d.has('krw') ? 'USD' : 'KRW', flow_date: `${p}-10`, category: '매출 수금', inflow: 800_000_000, outflow: 0, planned, balance: d.has('balance') || planned ? null : 2_000_000_000 }), row({ account: '국민', currency: d.has('krw') ? 'USD' : 'KRW', flow_date: `${p}-12`, category: '원재료 대금', inflow: 0, outflow: 700_000_000, planned, balance: d.has('balance') || planned ? null : 1_300_000_000 })]
      m.cashflow = rows
    }
    if (p === PERIOD && !d.has('loans')) m.loans = [row({ lender: '가은행', principal: 3_000_000_000, rate: 4.5, maturity: '2027-06-30', pay_day: 25 })]
    if (p === '2026-03' && !d.has('borrowings')) m.borrowings = [row({ lender: '대표', amount: 500_000_000, direction: '차입' })]
    if ((p === PERIOD || p === '2026-08') && !d.has('material')) m.material = { purchase_lines: 3, purchase_amount: 500_000_000, inventory_lines: 3, inventory_closing: 1_500_000_000, inventory_opening: 1_400_000_000, import_lines: 0, import_krw: null, import_extra: null }
    if ((p === PERIOD || p === '2026-08') && !d.has('valuation')) m.valuation = { wip: 300_000_000, finished: 400_000_000 }
    months.set(p, m)
  }
  const officials: OfficialYear[] = d.has('official') ? [] : [{ year: '2025', lines: [{ account_code: '1030', amount: 1_000_000_000 }, { account_code: '1080', amount: 700_000_000 }, { account_code: '2600', amount: -500_000_000 }, { account_code: '3310', amount: -1_200_000_000 }] }]
  const ledger: FinanceLedger = { accounts: [], journal: [], closings: [], entries: [], fxRates: [], costIndices: [] }
  const settings = { ...KPI_DEFAULTS, safety_cash: d.has('safety') ? null : 500_000_000 }
  return { businessId: BIZ, today: TODAY, scope: ledgerScope(ledger, [BIZ]), accounts, months, officials, settings, usdKrw: d.has('rate') ? null : d.has('krw') ? 1400 : null }
}

const k = (drops: DropIn[], no: number): Kpi => computeKpis(build(drops), PERIOD).find((x) => x.no === no)!
const lacks = (drops: DropIn[], no: number, words: string[], why: string) => {
  const x = k(drops, no)
  assert.ok(x.need, `${no} ${x.title}: [${drops.join(',')}] 뺐는데 계산이 섰다(${x.value}) — ${why}`)
  for (const w of words) assert.ok(x.need!.includes(w), `${no} ${x.title}: [${drops.join(',')}] 뺐는데 «${w}»를 말하지 않는다 — «${x.need}»`)
  assert.equal(x.detail, `필요한 것: ${x.need}`)
  return x
}
const computes = (drops: DropIn[], no: number, why: string) => {
  const x = k(drops, no)
  assert.equal(x.need, null, `${no} ${x.title}: [${drops.join(',')}]만 뺐는데 «자료 부족»(${x.need}) — ${why}`)
  return x
}
const notSay = (drops: DropIn[], no: number, words: string[]) => {
  const x = k(drops, no)
  for (const w of words) assert.ok(!x.need?.includes(w), `${no} ${x.title}: 쓰지 않는 «${w}»를 필요하다고 말한다 — «${x.need}»`)
}

// 다 있으면 — 5 · 6만 자료 부족
const full = computeKpis(build(), PERIOD)
assert.equal(full.length, 12)
assert.deepEqual(full.filter((x) => x.need).map((x) => x.no), [5, 6], `다 있는데 자료 부족: ${full.filter((x) => x.need).map((x) => `${x.no} ${x.need}`).join(' / ')}`)
for (const no of [5, 6]) assert.match(full[no - 1].need!, /아직 읽지 않음/, `${no}: 올려도 계산하지 않는 것을 «올리면 된다»처럼 말한다`)

// 1 매출 — 판매현황 또는 손익(원장 · 월별 손익) 중 하나
computes(['ledger'], 1, '판매현황만으로 매출은 선다')
computes(['sales'], 1, '원장만으로 매출은 선다')
lacks(['ledger', 'sales'], 1, ['판매현황', '계정별 원장', '월별 손익계산서'], '둘 다 없다')

// 2 이익 — 손익 원천(원장 · 월별 손익)이 있어야, 매출 계정도
lacks(['ledger'], 2, ['계정별 원장', '월별 손익계산서'], '판매현황만으로는 이익이 없다')
notSay(['ledger'], 2, ['판매현황'])
lacks(['ledgerRevenue'], 2, ['매출 계정'], '매출 0이면 이익률을 못 낸다')

// 3 예상 실적 — 올해 두 달 이상의 매출
lacks([`ledgerExcept:${PERIOD}`, 'sales'], 3, ['두 달', '판매현황', '계정별 원장'], '한 달뿐')
const salesOnly = computes([`salesOnly:${PERIOD}`], 3, '판매현황만 있는 달도 매출 전망은 선다')
assert.match(salesOnly.detail, /영업이익 전망은 계정별 원장/, `판매현황만 있는 달의 이익을 0으로 더해 전망했다: ${salesOnly.detail}`)
assert.ok(!/영업이익 전망 [−\-\d]/.test(salesOnly.detail), `판매현황만인데 영업이익 전망 숫자를 냈다: ${salesOnly.detail}`)

// 4 원가 — 손익 원천만(재고금액명세서는 없어도 장부 원가로 선다)
lacks(['ledger'], 4, ['계정별 원장', '월별 손익계산서'], '원가 계정이 없다')
notSay(['ledger'], 4, ['재고금액명세서'])
computes(['material', 'valuation'], 4, '재고가 없으면 장부 원가 그대로')
lacks(['ledgerRevenue'], 4, ['매출 계정'], '매출 0이면 원가율을 못 낸다')

// 7 현금 — 자금흐름표 잔액 또는 현금 계정 잔액
computes(['balance'], 7, '잔액 칸이 없으면 장부(원장 + 전년 결산) 현금')
computes(['official'], 7, '전년 결산이 없어도 자금흐름표 잔액')
const c7 = lacks(['balance', 'official'], 7, ['잔액', '자금흐름표', '현금 계정', '공식 결산'], '잔액을 알 길이 없다')
notSay(['balance', 'official'], 7, ['예정'])
lacks(['krw', 'rate'], 7, ['달러 환율'], '달러 계좌만 있고 환율이 없으면 0원이 아니다')
void c7

// 8 · 12 자금 전망 · 투자 여력 — 이번 달 초 잔액(예정 줄 · 평균은 잔액 없이는 못 쓴다)
computes(['balance'], 8, '잔액 칸이 없으면 장부 현금으로 시작')
lacks(['balance', 'official'], 8, ['잔액', '자금흐름표', '현금 계정'], '시작 잔액이 없다')
lacks(['balance', 'official'], 12, ['잔액', '자금흐름표', '현금 계정'], '시작 잔액이 없다')
computes(['safety'], 12, '기준값이 없어도 최근 실제 지출 평균')
lacks(['safety', 'cashflow'], 12, ['안전선 잔액', '자금흐름표'], '안전선을 정할 길이 없다')

// 9 매출채권 — 외상매출금 잔액(원장 거래 줄만으로는 잔액을 못 낸다)
lacks(['official'], 9, ['외상매출금', '공식 결산'], '기초 잔액이 없다')
notSay(['official'], 9, ['원장 거래 줄'])

// 10 재고 — 재고금액명세서 또는 평가(둘 중 하나로 선다)
computes(['material'], 10, '평가만으로')
computes(['valuation'], 10, '재고금액명세서만으로')
lacks(['material', 'valuation'], 10, ['재고금액명세서', '평가'], '재고 자료가 없다')

// 11 차입금 — 대출현황 또는 차입금
computes(['loans'], 11, '차입금만으로')
computes(['borrowings'], 11, '대출현황만으로')
lacks(['loans', 'borrowings'], 11, ['대출현황', '차입금'], '빚 자료가 없다')

// 같은 입력은 같은 말로
for (const v of Object.values(KPI_NEED)) assert.ok(v.length > 4)

// ── 체크표 «자료 N/18» — 그 달에 실제로 저장된 종류 수 ──
const up = (kind: string, period: string, status: FinUpload['status'] = 'applied', id = `${kind}-${period}-${status}`): FinUpload => ({ upload_id: id, business_id: BIZ, kind, period, file_name: `${kind}.xlsx`, file_sha256: id, sheet_name: null, ai_confidence: 'none', ai_used: 0, auto: true, status, row_count: 1, overlap: 'none', reason: null, error: null, created_by: 'u', created_at: `${period}-28T00:00:00Z`, applied_at: status === 'applied' ? `${period}-28T00:00:00Z` : null, reverted_at: null, replaced_by: null })
const got = (c: ReturnType<typeof buildChecklist>) => c.filter((x) => x.state !== 'missing').map((x) => x.key)
const base = { period: PERIOD, accounts: 'none' as const, accountsAt: null, plMonthlyAt: null, valuationAt: null }
assert.deepEqual(got(buildChecklist({ ...base, uploads: [up('sales', PERIOD), up('sales', PERIOD, 'applied', 'sales-2')] })), ['sales'], '같은 종류 두 번 저장이 둘로 셌다')
assert.deepEqual(got(buildChecklist({ ...base, uploads: [up('sales', '2026-08'), up('card', PERIOD, 'reverted'), up('loans', PERIOD, 'replaced'), up('cashflow', PERIOD, 'needs_review'), up('tax_invoice', PERIOD), up('ledger_lines', PERIOD)] })), [], '다른 달 · 되돌림 · 대체됨 · 대기 · 18가지 밖 종류를 셌다')
assert.deepEqual(got(buildChecklist({ ...base, uploads: [], accounts: 'auto' })), [], '자동 생성 계정만 있는데 계정과목표를 받은 것으로 셌다')
assert.deepEqual(got(buildChecklist({ ...base, uploads: [], accounts: 'file', plMonthlyAt: `${PERIOD}-01T00:00:00Z`, valuationAt: `${PERIOD}-05T00:00:00Z` })), ['accounts', 'pl_monthly', 'valuation'], '장부 쪽 · 화면 입력 평가를 세지 않았다')
assert.equal(buildChecklist({ ...base, uploads: [] }).length, 18)

console.log('PASS: 체크표 — 같은 종류 두 번은 하나 · 다른 달 · 되돌림 · 대기 · 18가지 밖은 세지 않음 · 자동 생성 계정만은 «빠짐» · 장부 쪽 · 화면 입력 평가는 셈')
console.log('PASS: 12가지 지표 «필요한 것» — 입력을 하나씩 빼면 그 입력의 이름(1 · 2 · 3 · 4 · 7 · 8 · 9 · 10 · 11 · 12), 대신 쓰는 길이 있으면 계산이 선다 · 5 · 6은 «아직 읽지 않음»')
