/**
 * 0091 «자동 판단 · 버튼 없음» — 다섯 규칙마다 맞는 경우 · 틀린 경우(사람이 고침) + 파일 빼기 → 바로 다시 계산. 진짜 AI 0회 · 진짜 회사 파일 없음.
 *   npm run check:finance-auto
 *
 *   1 평가     실측(파일) · 추정(제조지시 · 출하) · 이월(앞 달 · 3달까지) / 틀림 → 값 고치기(누가 · 전값) · 자동으로 · 고친 뒤 새 파일이 이김
 *   2 귀속월   «8월분» → 8월 · «2026.10~2026.12» → 3등분 · 연납(보험 한 해 한 번) → 12등분 · 그냥 날짜는 그대로 / 틀림 → 달 고치기 · 전표 날짜로
 *   3 중복     같은 금액 · ±3일 · 같은 거래처 → 카드 쪽 제외 · 9일 차이 · 다른 금액은 둘 다 / 틀림 → 되살리기
 *   4 원금/이자 대출현황 열 → 원장 이자비용 → 잔액 × 금리 · 스위치 끄면 예전 계산
 *   5 목록     그 달 «자동으로 정한 것» N건(0건이면 빈 목록) · dummy 저장소로 고치기(권한 · 스위치) · 체크표 «빼기» → 다시 계산
 */
import assert from 'node:assert/strict'

process.env.DUMMY_FIN_DEMO = 'off'
process.env.DUMMY_USER = 'teamless_staff'

import { applyAuto, decisionsFor, periodsFromMemo } from '../src/lib/finance-overview/auto'
import { computeCosts, computeDebt, computePl, inventoryAt, plAccounts, type Ctx, type MonthData } from '../src/lib/finance-overview/engine'
import { loadOverview } from '../src/lib/finance-overview/load'
import { parseKpiSettings } from '../src/lib/finance-overview/settings'
import { ledgerScope } from '../src/lib/ledger/scope'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyFinOverviewStore } from '../src/lib/repository/dummy-finance-upload'
import type { Account, FinAutoFix, FinRow } from '../src/types'

const BIZ = 'biz_dy'
let passed = 0
const ok = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/* ───────── 시험 장부(가짜) ───────── */

const ACC: [string, string, Account['section'], Account['category']][] = [
  ['4040', '제품매출', 'revenue', 'revenue'],
  ['4550', '제품매출원가', 'cogs', 'other'],
  ['8190', '지급임차료', 'sga', 'other'],
  ['8210', '보험료', 'sga', 'other'],
  ['8300', '소모품비', 'sga', 'other'],
  ['8310', '복리후생비', 'sga', 'other'],
  ['9310', '이자비용', 'non_operating', 'other'],
]
const months = Array.from({ length: 13 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 9 + i, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}) // 2025-10 … 2026-10

let rowNo = 0
const r = (x: Record<string, unknown>): FinRow => ({ row_no: (rowNo += 1), ...x }) as FinRow

function baseCtx(o: { auto?: boolean } = {}): Ctx {
  const accounts = new Map(ACC.map(([code, name, section, category]) => [code, { business_id: BIZ, account_code: code, name, section, category, cash_flow: null, active: true } as unknown as Account]))
  const m = new Map<string, MonthData>()
  for (const p of months) {
    m.set(p, {
      period: p, ledgerSums: [], ledgerLines: [], sales: [], shipment: [], payroll: [], cashflow: [], card: [], overseas: [], promo: [], loans: [], borrowings: [], savings: [], taxInvoice: [], production: [],
      material: null, valuation: { wip: null, finished: null }, valuationKnown: true, valuationAt: null, received: new Set(),
    })
  }
  const g = (p: string) => m.get(p)!
  // 손익(계정별 원장 합계) — 매달 매출 1억 · 원가 7천만 · 소모품 50만 · 복리후생 30만
  for (const p of months) {
    g(p).ledgerSums.push(r({ account_code: '4040', account_name: '제품매출', debit: 0, credit: 100_000_000 }), r({ account_code: '4550', account_name: '제품매출원가', debit: 70_000_000, credit: 0 }), r({ account_code: '8300', account_name: '소모품비', debit: 500_000, credit: 0 }), r({ account_code: '8310', account_name: '복리후생비', debit: 300_000, credit: 0 }))
  }
  g('2026-09').ledgerSums.push(r({ account_code: '9310', account_name: '이자비용', debit: 3_500_000, credit: 0 }), r({ account_code: '8190', account_name: '지급임차료', debit: 3_000_000, credit: 0 }))
  g('2026-01').ledgerSums.push(r({ account_code: '8210', account_name: '보험료', debit: 12_000_000, credit: 0 }))
  // 1 평가 — 7월 실측 · 8월 제조 · 출하만 · 9월 아무것도 없음
  g('2026-07').valuation = { wip: 10_000_000, finished: 20_000_000 }
  g('2026-07').valuationAt = '2026-08-05T01:00:00Z'
  g('2026-07').production.push(r({ product: 'A', qty: 800 }))
  g('2026-08').production.push(r({ product: 'A', qty: 1000 }))
  g('2026-08').shipment.push(r({ ship_date: '2026-08-20', customer: '가', product: 'A', qty: 900, amount: 9_000_000 }))
  // 2 귀속월 — 원장 거래 줄
  g('2026-09').ledgerLines.push(
    r({ tx_date: '2026-09-05', account_code: '8300', account_name: '소모품비', counterparty: '오피스디포', memo: '8월분 사무용품', debit: 300_000, credit: 0 }),
    r({ tx_date: '2026-09-25', account_code: '8190', account_name: '지급임차료', counterparty: '대한빌딩', memo: '2026.10~2026.12 임차료', debit: 3_000_000, credit: 0 }),
    r({ tx_date: '2026-09-15', account_code: '8310', account_name: '복리후생비', counterparty: '김밥천국', memo: '2026-09-15 야근 식대', debit: 200_000, credit: 0 }),
    // 3 중복 — 카드와 같은 거래(같은 금액 · 2일 · 같은 거래처) · 9일 차이 거래
    r({ tx_date: '2026-09-12', account_code: '8310', account_name: '복리후생비', counterparty: '스타벅스코리아', memo: '회의 음료', debit: 45_000, credit: 0 }),
    r({ tx_date: '2026-09-20', account_code: '8300', account_name: '소모품비', counterparty: '쿠팡', memo: '토너', debit: 120_000, credit: 0 }),
  )
  g('2026-01').ledgerLines.push(r({ tx_date: '2026-01-10', account_code: '8210', account_name: '보험료', counterparty: '한화손해보험', memo: '공장 화재보험', debit: 12_000_000, credit: 0 }))
  // 원장 거래 줄이 여섯 달 넘게 있어야 «한 해 한 번»을 말한다 — 2~6월에 다른 거래처 식대 줄.
  for (const p of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06']) g(p).ledgerLines.push(r({ tx_date: `${p}-20`, account_code: '8310', account_name: '복리후생비', counterparty: `식당${p}`, memo: '회식', debit: 100_000, credit: 0 }))
  g('2026-09').card.push(
    r({ used_on: '2026-09-10', merchant: '(주)스타벅스코리아', dept: '영업', amount: 45_000 }),
    r({ used_on: '2026-09-11', merchant: '쿠팡', dept: '총무', amount: 120_000 }),
    r({ used_on: '2026-09-12', merchant: '스타벅스코리아', dept: '영업', amount: 46_000 }),
  )
  // 4 대출 — 이자 열 없음
  g('2026-09').loans.push(r({ lender: 'KDB산업은행', principal: 1_000_000_000, rate: 4.5, principal_paid: 10_000_000, maturity: '2028-03-31' }))
  const ledger = { accounts: [...accounts.values()], journal: [], closings: [], entries: [], fxRates: [], costIndices: [] }
  return { businessId: BIZ, today: '2026-10-20', scope: ledgerScope(ledger as never, [BIZ]), accounts, months: m, officials: [], settings: parseKpiSettings(null), usdKrw: 1380, auto: o.auto }
}

let fixSeq = 0
const fx = (rule: FinAutoFix['rule'], key: string, action: FinAutoFix['action'], value: FinAutoFix['value'] = null, at = '2026-10-20T01:00:00Z'): FinAutoFix => ({
  fix_id: (fixSeq += 1), business_id: BIZ, rule, item_key: key, period: key.slice(0, 7), action, value, prev: { 값: 1 }, created_by: 'u', created_by_name: '김병훈', created_at: at,
})
const amountOf = (ctx: Ctx, p: string, code: string) => plAccounts(ctx, p)?.find((a) => a.code === code)?.amount ?? 0

async function main() {
  console.log('1 재공품 · 완제품 평가')
  {
    const ctx = baseCtx()
    const all = applyAuto(ctx, [])
    const m7 = ctx.months.get('2026-07')!
    const m8 = ctx.months.get('2026-08')!
    const m9 = ctx.months.get('2026-09')!
    ok('실측 — 7월 파일 값 그대로 · 목록에 없음', () => {
      assert.deepEqual(m7.valuation, { wip: 10_000_000, finished: 20_000_000 })
      assert.deepEqual(m7.valuationSource, { wip: 'measured', finished: 'measured' })
      assert.ok(!all.some((d) => d.key.startsWith('2026-07')))
    })
    ok('추정 — 8월 재공품 = 7월 × 제조 1000/800 · 완제품 = 7월 + (1000 − 900) × kg당 원가(출하 단가 1만 × 원가율 70%)', () => {
      assert.equal(m8.valuation.wip, 12_500_000)
      assert.equal(m8.valuation.finished, 20_700_000)
      assert.deepEqual(m8.valuationSource, { wip: 'estimated', finished: 'estimated' })
      assert.match(all.find((d) => d.key === '2026-08:finished')!.basis, /제조지시 1,000 − 출하 900/)
    })
    ok('이월 — 9월 자료 없음 → 8월 값 · 손익 잠정 문구', () => {
      assert.deepEqual(m9.valuation, { wip: 12_500_000, finished: 20_700_000 })
      assert.deepEqual(m9.valuationSource, { wip: 'carried', finished: 'carried' })
      assert.ok(inventoryAt(ctx, '2026-09').notes.some((n) => /8월 값을 이월/.test(n)))
    })
    ok('이월은 3달까지 — 10월(이월 2) 다음 달은 없음 · 6월 이전(앞 값 없음)은 비움', () => {
      assert.equal(ctx.months.get('2026-10')!.valuationSource!.wip, 'carried')
      assert.equal(ctx.months.get('2026-06')!.valuation.wip, null)
    })
    const ctx2 = baseCtx()
    ctx2.months.get('2026-10')!.valuationKnown = true
    const fixes = [fx('valuation', '2026-09:wip', 'value', { amount: 9_000_000 })]
    const all2 = applyAuto(ctx2, fixes)
    ok('틀림 → 9월 재공품 값 고치기 — 고침 · 누가 · 전값 · 10월 이월이 고친 값을 잇는다', () => {
      const m = ctx2.months.get('2026-09')!
      assert.equal(m.valuation.wip, 9_000_000)
      assert.equal(m.valuationSource!.wip, 'manual')
      const d = all2.find((x) => x.key === '2026-09:wip')!
      assert.equal(d.state, 'fixed')
      assert.equal(d.fix!.by, '김병훈')
      assert.deepEqual(d.fix!.prev, { 값: 1 })
      assert.equal(ctx2.months.get('2026-10')!.valuation.wip, 9_000_000)
    })
    ok('«자동으로 돌리기» → 다시 이월', () => {
      const c = baseCtx()
      applyAuto(c, [...fixes, fx('valuation', '2026-09:wip', 'auto')])
      assert.equal(c.months.get('2026-09')!.valuationSource!.wip, 'carried')
    })
    ok('고친 뒤에 새 평가 파일이 오면 파일이 이긴다 · 고친 뒤 파일보다 앞선 파일은 고친 값이 이긴다', () => {
      const c = baseCtx()
      c.months.get('2026-07')!.valuationAt = '2026-10-21T00:00:00Z'
      applyAuto(c, [fx('valuation', '2026-07:wip', 'value', { amount: 1 })])
      assert.equal(c.months.get('2026-07')!.valuationSource!.wip, 'measured')
      const d = baseCtx()
      applyAuto(d, [fx('valuation', '2026-07:wip', 'value', { amount: 1 })])
      assert.equal(d.months.get('2026-07')!.valuation.wip, 1)
    })
  }

  console.log('2 귀속월')
  {
    ok('적요 읽기 — N월분 · 기간 · 날짜 하이픈은 기간이 아님 · 1월 전표의 «12월분»은 지난해', () => {
      assert.deepEqual(periodsFromMemo('8월분 사무용품', '2026-09')?.months, ['2026-08'])
      assert.deepEqual(periodsFromMemo('2026.10~2026.12 임차료', '2026-09')?.months, ['2026-10', '2026-11', '2026-12'])
      assert.deepEqual(periodsFromMemo('1~3월 관리비', '2026-04')?.months, ['2026-01', '2026-02', '2026-03'])
      assert.deepEqual(periodsFromMemo('12월분 전기료', '2026-01')?.months, ['2025-12'])
      assert.equal(periodsFromMemo('2026-09-15 야근 식대', '2026-09'), null)
      assert.equal(periodsFromMemo('9월분 식대', '2026-09'), null, '같은 달은 판단 없음')
    })
    const ctx = baseCtx()
    const all = applyAuto(ctx, [])
    ok('«8월분» 30만 — 9월 소모품비 −30만 · 8월 +30만 (원장 원본 줄은 그대로)', () => {
      assert.equal(amountOf(ctx, '2026-09', '8300'), 500_000 - 300_000)
      assert.equal(amountOf(ctx, '2026-08', '8300'), 500_000 + 300_000)
      assert.equal(ctx.months.get('2026-09')!.ledgerLines.length, 5)
    })
    ok('기간 «2026.10~2026.12» 300만 — 9월 −300만 · 10월 +100만(11 · 12월은 자료 없는 달이라 손익 없음)', () => {
      assert.equal(amountOf(ctx, '2026-09', '8190'), 0)
      assert.equal(amountOf(ctx, '2026-10', '8190'), 1_000_000)
      const d = all.find((x) => x.rule === 'period' && x.title.includes('지급임차료'))!
      assert.deepEqual(d.months, ['2026-10', '2026-11', '2026-12'])
    })
    ok('연납 — 1월 보험료 1,200만(한화손해보험 한 해 한 번) → 1~12월 100만씩', () => {
      assert.equal(amountOf(ctx, '2026-01', '8210'), 1_000_000)
      assert.equal(amountOf(ctx, '2026-05', '8210'), 1_000_000)
      assert.match(all.find((x) => x.title.includes('보험료'))!.basis, /연납 모양/)
    })
    ok('원장이 두 달뿐이면 한 번 나온 임차료도 12등분하지 않는다 · 적요에 «연간»이 있으면 한다', () => {
      const c = baseCtx()
      for (const p of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06']) c.months.get(p)!.ledgerLines = []
      c.months.get('2026-09')!.ledgerLines.push(r({ tx_date: '2026-09-28', account_code: '8190', account_name: '지급임차료', counterparty: '창고주인', memo: '창고 임차료', debit: 2_000_000, credit: 0 }))
      c.months.get('2026-09')!.ledgerLines.push(r({ tx_date: '2026-09-28', account_code: '8210', account_name: '보험료', counterparty: '삼성화재', memo: '차량보험 연간', debit: 1_200_000, credit: 0 }))
      const d = applyAuto(c, [])
      assert.ok(!d.some((x) => x.title.includes('창고주인')))
      assert.ok(!d.some((x) => x.title.includes('한화손해보험')), '두 달 자료로 1월 보험을 연납이라 했다')
      assert.match(d.find((x) => x.title.includes('삼성화재'))!.basis, /적요에 한 해 치/)
    })
    ok('그냥 날짜 · «야근 식대»는 판단 없음(전표 날짜)', () => {
      assert.ok(!all.some((x) => x.rule === 'period' && x.title.includes('김밥')))
    })
    const key = all.find((x) => x.title.includes('소모품비') && x.rule === 'period')!.key
    ok('틀림 → 달 고치기(7월) — 9월 −30만 · 7월 +30만 · 8월 그대로', () => {
      const c = baseCtx()
      const d = applyAuto(c, [fx('period', key, 'month', { to: '2026-07' })])
      assert.equal(amountOf(c, '2026-07', '8300'), 800_000)
      assert.equal(amountOf(c, '2026-08', '8300'), 500_000)
      assert.equal(d.find((x) => x.key === key)!.state, 'fixed')
    })
    ok('틀림 → 전표 날짜로 되돌리기 — 조정 없음 · 목록엔 «원래대로»', () => {
      const c = baseCtx()
      const d = applyAuto(c, [fx('period', key, 'keep_date')])
      assert.equal(amountOf(c, '2026-09', '8300'), 500_000)
      assert.equal(amountOf(c, '2026-08', '8300'), 500_000)
      assert.equal(d.find((x) => x.key === key)!.state, 'off')
    })
    ok('조정은 손익만 — 한 해 합계는 그대로(옮기기만)', () => {
      const total = (c: Ctx) => months.filter((p) => p.startsWith('2026')).reduce((s, p) => s + amountOf(c, p, '8300'), 0)
      const plain = baseCtx()
      assert.equal(total(ctx), total(plain))
    })
  }

  console.log('3 중복')
  {
    const ctx = baseCtx()
    const all = applyAuto(ctx, [])
    const card = ctx.months.get('2026-09')!.card
    ok('같은 금액 · 2일 · 같은 거래처((주) 떼고) → 카드 쪽 제외', () => {
      assert.ok(!card.some((c) => c.amount === 45_000))
      assert.equal(all.filter((d) => d.rule === 'duplicate').length, 1)
      assert.match(all.find((d) => d.rule === 'duplicate')!.basis, /같은 거래처/)
    })
    ok('9일 차이(쿠팡) · 다른 금액(46,000)은 둘 다 센다', () => {
      assert.ok(card.some((c) => c.amount === 120_000))
      assert.ok(card.some((c) => c.amount === 46_000))
      assert.equal(computeCosts(ctx, '2026-09').find((x) => x.label.startsWith('법인카드'))!.amount, 166_000)
    })
    const key = all.find((d) => d.rule === 'duplicate')!.key
    ok('틀림 → 되살리기 — 카드 줄이 돌아온다 · 목록엔 «원래대로»', () => {
      const c = baseCtx()
      const d = applyAuto(c, [fx('duplicate', key, 'restore')])
      assert.equal(c.months.get('2026-09')!.card.length, 3)
      assert.equal(d.find((x) => x.key === key)!.state, 'off')
    })
  }

  console.log('4 원금 · 이자')
  {
    ok('대출현황에 이자 열이 없으면 원장 이자비용 350만 — 출처 «원장 이자비용» · 원리금 = 원금 1천만 + 350만', () => {
      const ctx = baseCtx()
      applyAuto(ctx, [])
      const d = computeDebt(ctx, '2026-09')
      assert.equal(d.interestSource, 'ledger')
      assert.equal(d.principalSource, 'loans')
      assert.equal(d.monthlyInterest, 3_500_000)
      assert.equal(d.monthlyPay, 13_500_000)
    })
    ok('대출현황에 이자 열이 있으면 그 값(출처 «대출현황»)', () => {
      const ctx = baseCtx()
      ctx.months.get('2026-09')!.loans[0].interest_paid = 3_750_000
      applyAuto(ctx, [])
      const d = computeDebt(ctx, '2026-09')
      assert.equal(d.interestSource, 'loans')
      assert.equal(d.monthlyInterest, 3_750_000)
    })
    ok('이자 열 · 원장 이자비용 둘 다 없으면 잔액 × 금리 ÷ 12(출처 «추정»)', () => {
      const ctx = baseCtx()
      ctx.months.get('2026-09')!.ledgerSums = ctx.months.get('2026-09')!.ledgerSums.filter((x) => x.account_code !== '9310')
      applyAuto(ctx, [])
      const d = computeDebt(ctx, '2026-09')
      assert.equal(d.interestSource, 'estimate')
      assert.equal(d.monthlyInterest, 3_750_000)
    })
    ok('스위치 끔(자동 판단 없음) — 예전 계산(잔액 × 금리) 그대로', () => {
      const ctx = baseCtx({ auto: false })
      assert.equal(computeDebt(ctx, '2026-09').interestSource, 'estimate')
    })
  }

  console.log('5 «자동으로 정한 것» 목록')
  {
    const ctx = baseCtx()
    const all = applyAuto(ctx, [])
    const sep = decisionsFor(ctx, all, '2026-09')
    ok('9월 — 평가 이월 2 · 귀속월 2(8월분 · 임차료) · 연납 1 · 중복 1 · 이자 출처 1 = 7건(규칙 순)', () => {
      assert.deepEqual(sep.map((d) => d.rule), ['valuation', 'valuation', 'period', 'period', 'period', 'duplicate', 'loan'])
    })
    ok('판단할 것이 없는 회사 · 달은 0건(화면 한 줄도 안 그림)', () => {
      const c = baseCtx()
      for (const m of c.months.values()) {
        m.ledgerLines = []
        m.card = []
        m.loans = []
        m.production = []
        m.shipment = []
        m.valuation = { wip: null, finished: null }
      }
      assert.equal(decisionsFor(c, applyAuto(c, []), '2026-09').length, 0)
    })
    ok('손익이 조정을 반영 — 9월 판관비 = 소모품 20만 + 복리 30만 + 임차 0 + 보험 12분의 1(100만)', () => {
      assert.equal(computePl(ctx, '2026-09').sga, 200_000 + 300_000 + 0 + 1_000_000)
    })
  }

  console.log('dummy 저장소 — 고치기 권한 · 체크표 «빼기» → 다시 계산')
  {
    const save = (rule: FinAutoFix['rule'], action: FinAutoFix['action'], value: FinAutoFix['value'] = null) => repo.saveFinAutoFix({ business_id: BIZ, rule, item_key: '2026-09:wip', period: '2026-09', action, value, prev: { 값: 1 } })
    process.env.DUMMY_USER = 'teamless_staff'
    const id = await save('valuation', 'value', { amount: 5 })
    assert.ok(id > 0)
    await assert.rejects(() => save('valuation', 'month', { to: '2026-08' }), /fin_auto_shape/)
    await assert.rejects(() => save('valuation', 'value', { amount: -1 }), /fin_auto_shape/)
    const list = await repo.listFinAutoFixes(BIZ)
    ok('김병훈 자리(장부 쓰기)가 고친다 · 이름이 남는다 · 모양 거부', () => {
      assert.equal(list.at(-1)!.created_by_name !== null, true)
      assert.equal(list.at(-1)!.value!.amount, 5)
    })
    process.env.DUMMY_USER = 'prod_staff'
    await assert.rejects(() => save('valuation', 'auto'), /fin_auto_denied/)
    ok('장부 못 쓰는 직원은 거부', () => undefined)
    process.env.DUMMY_USER = 'teamless_staff'
    await save('valuation', 'auto')

    // 체크표 «빼기» — 법인카드 파일 하나를 넣고 → 빼면 체크표 · 계산이 바로 바뀐다.
    const upId = await repo.finUploadSave({
      business_id: BIZ, kind: 'card', period: '2026-09', file_name: '법인카드_9월.xlsx', file_sha256: 'c'.repeat(64), sheet_name: 'Sheet1', ai_confidence: 'high', ai_used: 0,
      rows: [{ row_no: 1, used_on: '2026-09-10', merchant: '문구사', dept: '총무', amount: 77_000 }], people: null, reason: null, upload_id: null, warnings: [],
    } as never)
    const before = await loadOverview(repo, BIZ, '2026-09', '2026-10-20')
    const item = before.checklist.find((c) => c.key === 'card')!
    ok('체크표 «법인카드 사용내역»에 그 파일(빼기 단추가 쓸 올리기 id)', () => {
      assert.equal(item.state, 'ok')
      assert.equal(item.uploadId, upId)
      assert.equal(before.ctx.months.get('2026-09')!.card.length, 1)
    })
    assert.equal(await repo.finUploadRevert(upId, '체크표에서 빼기(0091)'), true)
    const after = await loadOverview(repo, BIZ, '2026-09', '2026-10-20')
    ok('빼기 → 같은 화면을 다시 열면 체크표 «빠짐» · 카드 0건 · 다시 계산 큐', () => {
      assert.equal(after.checklist.find((c) => c.key === 'card')!.state, 'missing')
      assert.equal(after.ctx.months.get('2026-09')!.card.length, 0)
      assert.ok(dummyFinOverviewStore().jobs.some((j) => j.business_id === BIZ && j.status === 'pending'), '다시 계산 큐가 없다')
    })
    const switchOff = await loadOverview(repo, BIZ, '2026-09', '2026-10-20', { auto: false })
    ok('스위치 끔 — 목록 0 · ctx.auto 없음', () => {
      assert.equal(switchOff.decisions.length, 0)
      assert.equal(switchOff.ctx.auto, undefined)
    })
  }

  console.log(`PASS check:finance-auto — ${passed}개`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
