/**
 * PHASE 3 «월별 손익 — 재고 반영 매출원가 · 손익과 현금 분리 · 마감» 검사: npm run check:monthly-pl
 *   (= tsx --conditions=react-server scripts/check-monthly-pl.ts — dummy repo를 읽는다. 진짜 회사 자료 · AI 호출 · 네트워크 없음.)
 *
 *   1) 순수 계산(src/lib/monthly-pl/calc.ts) — 시험 1~10(원문 9절). 금액 단위는 전부 원(KRW), 수량은 kg. 가정은 시험 이름 · 주석에.
 *   2) 같은 입력을 0075 fin_pl_compute(SQL, PGlite)에 넣어 TS와 결과가 같은지 — live는 SQL이 계산한다(두 벌이 갈라지지 않게).
 *   3) dummy repo(마감 · 재마감 · 권한 · 같은 입력 = 같은 결과 · 재계산 중복 없음).
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import {
  computeMonthlyPl,
  dedupeLines,
  estimateSingleProductFinished,
  laterFinalPeriods,
  maskPlResult,
  plDiff,
  roundWon,
} from '../src/lib/monthly-pl/calc'
import type { MonthlyPlInput, MonthlyPlResult, PlIssue, PlMaterialInput } from '../src/types'

import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyPlCloses } from '../src/lib/repository/dummy-monthly-pl'
import { applyAll } from './pglite'

let passed = 0
const tests: { name: string; fn: () => void | Promise<void> }[] = []
const ok = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn })

const 억 = 100_000_000
const 만 = 10_000

/** 원료 한 가지(가짜). 수량 kg · 금액 원. */
function mat(over: Partial<PlMaterialInput> = {}): PlMaterialInput {
  return {
    name: '가짜 원료 가',
    opening_qty: 0,
    opening_amount: 0,
    opening_source: 'statement',
    purchase_qty: 0,
    purchase_amount: 0,
    production_qty: 0,
    non_production: {},
    issue_needs_review: 0,
    issue_missing_qty: 0,
    closing_qty: 0,
    closing_statement_amount: 0,
    ...over,
  }
}

/** 깨끗한 한 달 — 재공품 · 완제품 0(확정) · 장부 줄 있음 · 조정 없음 · 자금흐름표 있음. 첫 달(앞 달 마감 없음)로 둔다. */
function base(over: Partial<MonthlyPlInput> = {}): MonthlyPlInput {
  return {
    period: '2099-01',
    method: 'monthly_wa',
    method_confirmed: false,
    tolerance_krw: 1000,
    materials: [mat()],
    issues_uploaded: true,
    statement_uploaded: true,
    raw_opening_manual: null,
    raw_statement_opening: null,
    wip: { opening_amount: 0, opening_source: 'manual', opening_scope: null, closing_amount: 0, closing_status: 'final', closing_scope: 'material_labor_overhead', duplicate_suspect: false },
    finished: { opening_amount: 0, opening_source: 'manual', opening_scope: null, closing_amount: 0, closing_status: 'final', closing_scope: 'material_labor_overhead', duplicate_suspect: false },
    revenue: 0,
    revenue_source: 'books',
    books_has_lines: true,
    books_raw_material: null,
    books_merchandise_cogs: 0,
    mfg_labor: 0,
    mfg_overhead: 0,
    sga: 0,
    books_operating_income: null,
    adjustments: [],
    cash: { uploaded: true, material_payments: 0, inflow: 0, outflow: 0 },
    purchase_dupes_excluded: 0,
    purchase_suspects: 0,
    link: { prev_final: false, earlier_final: false },
    ...over,
  }
}

/** 이 달 결과의 원료 기말 → 다음 달 기초(앞 달 확정 기말). */
function carry(r: MonthlyPlResult, name: string): Pick<PlMaterialInput, 'opening_qty' | 'opening_amount' | 'opening_source'> {
  const m = r.materials.find((x) => x.name === name)!
  return { opening_qty: m.closing_qty, opening_amount: m.closing_amount, opening_source: 'prev_close' }
}

const codes = (r: MonthlyPlResult) => r.blockers.map((b) => b.code)

/* ─────────────── 시험 1. 원료 선매입 후 3개월 사용 ─────────────── */
// 가정(원): 기초 원료 0 · 1월 매입 9억(900,000kg × 1,000원/kg) · 2 · 3월 매입 0 · 매달 3억어치(300,000kg) 생산 투입 ·
//   생산분은 그달 전량 판매 · 재공품 · 완제품 기말 0 · 원료 외 제조비 0 · 매달 매출 5억 · 판관비 1억.
//   1월에 원료대금 9억 전액 지급(자금흐름표 출금 9억, 원료 대금 항목).
const t1Month = (period: string, opening: Pick<PlMaterialInput, 'opening_qty' | 'opening_amount' | 'opening_source'>, purchaseKg: number, closingKg: number, paid: number, prevFinal: boolean) =>
  base({
    period,
    materials: [mat({ ...opening, purchase_qty: purchaseKg, purchase_amount: purchaseKg * 1000, production_qty: 300_000, closing_qty: closingKg, closing_statement_amount: closingKg * 1000 })],
    revenue: 5 * 억,
    sga: 1 * 억,
    // 지금 장부(A 방식): 매입이 원재료비로 바로 비용 → 영업이익 = 매출 − 매입 − 판관비.
    books_raw_material: purchaseKg * 1000,
    books_operating_income: 5 * 억 - purchaseKg * 1000 - 1 * 억,
    cash: { uploaded: true, material_payments: paid, inflow: 5 * 억, outflow: paid + 1 * 억 },
    link: { prev_final: prevFinal, earlier_final: false },
  })
const t1 = (() => {
  const m1 = computeMonthlyPl(t1Month('2099-01', { opening_qty: 0, opening_amount: 0, opening_source: 'statement' }, 900_000, 600_000, 9 * 억, false))
  const m2 = computeMonthlyPl(t1Month('2099-02', carry(m1, '가짜 원료 가'), 0, 300_000, 0, true))
  const m3 = computeMonthlyPl(t1Month('2099-03', carry(m2, '가짜 원료 가'), 0, 0, 0, true))
  return [m1, m2, m3]
})()
ok('T1 9억 선매입 → 매달 매출원가 3억 · 영업이익 1억(원)', () => {
  for (const r of t1) {
    assert.equal(r.pl.cogs, 3 * 억, `${r.period} 매출원가`)
    assert.equal(r.pl.operating_income, 1 * 억, `${r.period} 영업이익`)
    assert.equal(r.closable, true, `${r.period} 마감 가능해야 — ${codes(r).join(',')}`)
  }
})
ok('T1 월말 원료 재고 6억 → 3억 → 0원', () => {
  assert.deepEqual(t1.map((r) => r.basis.raw_closing), [6 * 억, 3 * 억, 0])
})
ok('T1 첫 달 매입 9억이 첫 달 비용으로 다 들어가지 않는다(매입 9억 ≠ 매출원가 3억 · 지금 장부 영업이익 −5억)', () => {
  assert.equal(t1[0].basis.raw_purchases, 9 * 억)
  assert.notEqual(t1[0].pl.cogs, 9 * 억)
  assert.equal(t1[0].check.books_operating_income, -5 * 억)
})
ok('T1 1월 지급 9억은 현금에 그대로(출금 · 순증감), 손익은 지급이 0이어도 같다', () => {
  assert.equal(t1[0].cash.material_payments, 9 * 억)
  assert.equal(t1[0].cash.net, 5 * 억 - 10 * 억)
  const unpaid = computeMonthlyPl({ ...t1Month('2099-01', { opening_qty: 0, opening_amount: 0, opening_source: 'statement' }, 900_000, 600_000, 0, false) })
  assert.deepEqual(unpaid.pl, t1[0].pl, '지급 여부가 손익을 바꿨다')
  // «이익은 났지만 현금은 줄었다»가 표현된다 — 둘을 같게 맞추지 않는다.
  assert.ok(t1[0].pl.operating_income! > 0 && t1[0].cash.net! < 0)
})

/* ─────────────── 시험 2. 생산했지만 일부만 판매 ─────────────── */
// 가정(원 · kg): 단일 제품 · 기초 재공품 · 완제품 0 · 당월 원료 사용액 3,000만(10,000kg × 3,000원) · 제조 인건비 600만 + 제조경비 400만 = 1,000만 ·
//   완성 10,000kg · 판매 6,000kg · 기말 재공품 0 · 매출 5,000만 · 판관비 500만.
ok('T2 제조원가 4,000만 · kg당 4,000원 · 매출원가 2,400만 · 기말 완제품 1,600만 — 제조비 1,000만을 다시 빼지 않는다(원)', () => {
  const mats = [mat({ purchase_qty: 10_000, purchase_amount: 3000 * 만, production_qty: 10_000, closing_qty: 0, closing_statement_amount: 0 })]
  const pre = computeMonthlyPl(base({ materials: mats, mfg_labor: 600 * 만, mfg_overhead: 400 * 만, finished: { ...base().finished, closing_amount: null, closing_status: null } }))
  assert.equal(pre.basis.cogm, 4000 * 만)
  const est = estimateSingleProductFinished({ products: 1, opening_kg: 0, opening_amount: 0, produced_kg: 10_000, cogm: pre.basis.cogm!, sold_kg: 6_000 })
  assert.ok(!('error' in est))
  assert.equal(est.unit_cost, 4000)
  assert.equal(est.cogs, 2400 * 만)
  assert.equal(est.closing_amount, 1600 * 만)
  assert.equal(est.basis, '추정 — 단일 제품 월 가중평균')
  // 평가금액(기말 완제품 1,600만)을 넣으면 손익 화면의 매출원가가 2,400만.
  const r = computeMonthlyPl(base({ materials: mats, mfg_labor: 600 * 만, mfg_overhead: 400 * 만, revenue: 5000 * 만, sga: 500 * 만, finished: { ...base().finished, closing_amount: est.closing_amount } }))
  assert.equal(r.pl.cogs, 2400 * 만)
  assert.equal(r.basis.finished_closing, 1600 * 만)
  assert.equal(r.pl.operating_income, 5000 * 만 - 2400 * 만 - 500 * 만, '제조비가 손익에서 다시 빠졌다')
  assert.equal(r.pl.sga, 500 * 만, '제조비가 판관비로 갔다')
})
ok('T2 제품이 둘이면 kg 비율 배분을 하지 않는다(추정 거부)', () => {
  const est = estimateSingleProductFinished({ products: 2, opening_kg: 0, opening_amount: 0, produced_kg: 10_000, cogm: 4000 * 만, sold_kg: 6_000 })
  assert.ok('error' in est)
})

/* ─────────────── 시험 3. 원료별 월 가중평균 ─────────────── */
// 가정(원 · kg): 같은 원료 기초 1,000kg × 2,000원(200만) · 매입 1,000kg × 3,000원(300만) · 생산 투입 800kg · 기타 변동 없음.
const t3 = computeMonthlyPl(base({ materials: [mat({ opening_qty: 1000, opening_amount: 200 * 만, purchase_qty: 1000, purchase_amount: 300 * 만, production_qty: 800, closing_qty: 1200, closing_statement_amount: 300 * 만 })] }))
ok('T3 월 가중평균 2,500원/kg · 투입원가 200만 · 기말 1,200kg · 300만(원)', () => {
  const m = t3.materials[0]
  assert.equal(m.wa_unit_cost, 2500)
  assert.equal(m.production_cost, 200 * 만)
  assert.equal(m.expected_closing_qty, 1200)
  assert.equal(m.closing_amount, 300 * 만)
  assert.equal(t3.basis.recon_diff, 0)
  assert.equal(t3.basis.recon_ok, true)
})
ok('T3 원료끼리 섞지 않는다 — 다른 원료(5,000원/kg)를 더해도 이 원료 단가는 2,500원', () => {
  const r = computeMonthlyPl(base({ materials: [t3Mat(), mat({ name: '가짜 원료 나', purchase_qty: 100, purchase_amount: 50 * 만, production_qty: 100, closing_qty: 0 })] }))
  assert.equal(r.materials.find((m) => m.name === '가짜 원료 가')!.wa_unit_cost, 2500)
  assert.equal(r.materials.find((m) => m.name === '가짜 원료 나')!.wa_unit_cost, 5000)
})
function t3Mat() {
  return mat({ opening_qty: 1000, opening_amount: 200 * 만, purchase_qty: 1000, purchase_amount: 300 * 만, production_qty: 800, closing_qty: 1200, closing_statement_amount: 300 * 만 })
}
ok('T3 수량 0 · 음수 — 나눗셈 없이 단가 null, 최신 구매가로 대신하지 않는다', () => {
  const r = computeMonthlyPl(base({ materials: [mat({ opening_qty: -500, opening_amount: 100 * 만, purchase_qty: 500, purchase_amount: 150 * 만, production_qty: 0, closing_qty: 0 })] }))
  assert.equal(r.materials[0].wa_unit_cost, null)
  assert.ok(codes(r).includes('material_qty_nonpositive'))
  assert.equal(r.closable, false)
})
ok('T3 반올림: 1/3원 단가도 원료별 금액을 한 번에 계산해 1원, 합계가 원 단위로 맞물린다', () => {
  // 기초 0 · 매입 3kg × 1,000,000원/3 ≒ 333,333.33원/kg — 금액 1,000,000원. 투입 1kg · 기말 2kg.
  const r = computeMonthlyPl(base({ materials: [mat({ purchase_qty: 3, purchase_amount: 1_000_000, production_qty: 1, closing_qty: 2 })] }))
  const m = r.materials[0]
  assert.equal(m.production_cost, 333_333)
  assert.equal(m.closing_amount, 666_667)
  assert.equal(r.basis.raw_usage! , 1_000_000 - 666_667)
  assert.equal(r.basis.recon_diff, 0)
  assert.equal(roundWon(-2.5), -3)
  assert.equal(roundWon(2.5), 3)
})

/* ─────────────── 시험 4. 전월 완제품 재고 판매 ─────────────── */
// 가정(원 · kg): 기초 완제품 1,000kg · 400만 · 당월 생산 없음 · 당월 600kg 판매 · 원료 움직임 없음 · 매출 500만.
ok('T4 매출원가 240만 · 기말 400kg · 160만 — 생산이 없어도 매출원가는 0이 아니다(원)', () => {
  const est = estimateSingleProductFinished({ products: 1, opening_kg: 1000, opening_amount: 400 * 만, produced_kg: 0, cogm: 0, sold_kg: 600 })
  assert.ok(!('error' in est))
  assert.deepEqual([est.cogs, est.closing_kg, est.closing_amount], [240 * 만, 400, 160 * 만])
  const r = computeMonthlyPl(base({ revenue: 500 * 만, finished: { ...base().finished, opening_amount: 400 * 만, opening_source: 'prev_final_valuation', opening_scope: 'material_labor_overhead', closing_amount: est.closing_amount } }))
  assert.equal(r.pl.cogs, 240 * 만)
  assert.notEqual(r.pl.cogs, 0)
  assert.equal(r.basis.cogm, 0)
})

/* ─────────────── 시험 5. 매입월과 지급월이 다른 경우(외상) ─────────────── */
// 가정(원): 1월 원료 9억 외상 매입(900,000kg) · 1월 투입 300,000kg · 2월 지급 9억 · 2월 매입 0 · 2월 투입 300,000kg.
ok('T5 매입 · 재고는 1월, 현금지출은 2월 — 2월 지급이 원가로 다시 들어가지 않는다(원)', () => {
  const j = computeMonthlyPl(t1Month('2099-01', { opening_qty: 0, opening_amount: 0, opening_source: 'statement' }, 900_000, 600_000, 0, false))
  const f = computeMonthlyPl(t1Month('2099-02', carry(j, '가짜 원료 가'), 0, 300_000, 9 * 억, true))
  assert.equal(j.basis.raw_purchases, 9 * 억)
  assert.equal(j.cash.material_payments, 0)
  assert.equal(f.basis.raw_purchases, 0)
  assert.equal(f.cash.material_payments, 9 * 억)
  assert.equal(f.pl.cogs, 3 * 억, '2월 지급 9억이 2월 원가로 들어갔다')
  const fUnpaid = computeMonthlyPl(t1Month('2099-02', carry(j, '가짜 원료 가'), 0, 300_000, 0, true))
  assert.deepEqual(f.pl, fUnpaid.pl)
})

/* ─────────────── 시험 6. 재고자료 누락 ─────────────── */
ok('T6 기말 재공품 평가금액 누락 → 0으로 채우지 않음 · 확정 불가 · 원료 사용액까지만(잠정 범위 표시)', () => {
  const r = computeMonthlyPl(base({ materials: [t3Mat()], revenue: 1000 * 만, wip: { ...base().wip, closing_amount: null, closing_status: null } }))
  assert.equal(r.basis.wip_closing, null)
  assert.equal(r.pl.cogs, null)
  assert.equal(r.pl.operating_income, null)
  assert.equal(r.status, 'entering')
  assert.equal(r.closable, false)
  assert.equal(r.scope, 'raw_usage_only')
  assert.equal(r.basis.raw_usage, 200 * 만)
  assert.ok(codes(r).includes('wip_closing_missing'))
})
ok('T6 기초재고 누락(원료) → 0이 아니라 미입력 · 원료 사용액도 못 냄', () => {
  const r = computeMonthlyPl(base({ materials: [mat({ opening_qty: null, opening_amount: null, opening_source: 'missing', purchase_qty: 100, purchase_amount: 10 * 만, production_qty: 50, closing_qty: 50 })] }))
  assert.equal(r.basis.raw_opening, null)
  assert.equal(r.basis.raw_usage, null)
  assert.equal(r.scope, 'none')
  assert.ok(codes(r).includes('material_opening_missing'))
})
ok('T6 기말 완제품 평가금액 누락 · 기초 완제품 미연결 → 막음', () => {
  const r = computeMonthlyPl(base({ finished: { ...base().finished, opening_amount: null, opening_source: 'unlinked', closing_amount: null, closing_status: null } }))
  assert.ok(codes(r).includes('finished_closing_missing') && codes(r).includes('finished_opening_missing'))
  assert.equal(r.closable, false)
})
ok('T6 평가금액 잠정(확정 전) → 계산은 되지만 마감은 막힘', () => {
  const r = computeMonthlyPl(base({ wip: { ...base().wip, closing_amount: 100 * 만, closing_status: 'provisional' } }))
  assert.equal(r.status, 'provisional')
  assert.ok(codes(r).includes('wip_closing_not_final'))
  assert.equal(r.closable, false)
})

/* ─────────────── 시험 7. 과거 손익 보호 ─────────────── */
ok('T7 마감 뒤 Current · Market이 바뀌어도 확정 손익은 그대로 — 계산 입력에 Current · Market 칸이 없다', () => {
  const keys = JSON.stringify(Object.keys(base()).concat(Object.keys(mat())))
  assert.ok(!/current|market|forecast/i.test(keys), '월별 손익 입력이 Current · Market · Forecast를 받는다')
  // 확정본은 저장된 결과다 — 같은 달 원천이 나중에 바뀌어도 저장본은 그대로(화면은 «자료 바뀜»으로만 표시 — 3절 dummy에서 확인).
  const frozen = structuredClone(t1[1])
  const later = computeMonthlyPl({ ...t1Month('2099-02', carry(t1[0], '가짜 원료 가'), 0, 300_000, 0, true), sga: 2 * 억 })
  assert.notDeepEqual(later.pl, frozen.pl)
  assert.deepEqual(frozen.pl, t1[1].pl)
})

/* ─────────────── 시험 8. 중복 및 비정상 자료 ─────────────── */
ok('T8 같은 거래 묶음(same) — 입고 줄 둘(R2 · ECOUNT)은 한 번만, 금액 기준 줄을 남긴다', () => {
  const d = dedupeLines('fin_purchase_in_lines', [1, 2, 3], [
    { status: 'same', amount_base_ref: 'fin_purchase_in_lines:2', members: [{ source_table: 'fin_purchase_in_lines', line_id: 1, released: false }, { source_table: 'fin_purchase_in_lines', line_id: 2, released: false }] },
  ])
  assert.deepEqual([...d.excluded], [1])
  assert.equal(d.suspects, 0)
})
ok('T8 R2 입고 + 회계 원장 같은 매입 — 원장은 매입 원천이 아니라 입고 줄 하나만 센다 · 장부 원재료비는 교체(합산 아님)', () => {
  const d = dedupeLines('fin_purchase_in_lines', [1], [
    { status: 'same', amount_base_ref: 'fin_ledger_lines:9', members: [{ source_table: 'fin_purchase_in_lines', line_id: 1, released: false }, { source_table: 'fin_ledger_lines', line_id: 9, released: false }] },
  ])
  assert.equal(d.excluded.size, 0)
  const r = computeMonthlyPl({ ...t1Month('2099-01', { opening_qty: 0, opening_amount: 0, opening_source: 'statement' }, 900_000, 600_000, 0, false), books_raw_material: 9 * 억 })
  assert.equal(r.pl.cogs, 3 * 억, '장부 원재료비 9억이 새 매출원가에 더해졌다')
})
ok('T8 중복 의심(suspect) 입고 묶음 → 자동으로 같은 거래로 보지 않고 마감을 막는다', () => {
  const d = dedupeLines('fin_purchase_in_lines', [1, 2], [
    { status: 'suspect', amount_base_ref: null, members: [{ source_table: 'fin_purchase_in_lines', line_id: 1, released: false }, { source_table: 'fin_purchase_in_lines', line_id: 2, released: false }] },
  ])
  assert.deepEqual([d.excluded.size, d.suspects], [0, 1])
  const r = computeMonthlyPl(base({ purchase_suspects: d.suspects }))
  assert.ok(codes(r).includes('purchase_suspects'))
  assert.equal(r.closable, false)
})
ok('T8 음수 재고 · 투입 초과 → 오류 표시, 수량 · 금액을 고치지 않는다', () => {
  const neg = computeMonthlyPl(base({ materials: [mat({ purchase_qty: 100, purchase_amount: 10 * 만, production_qty: 50, closing_qty: -5 })] }))
  assert.ok(codes(neg).includes('material_negative_stock'))
  assert.equal(neg.materials[0].closing_qty, -5)
  assert.equal(neg.materials[0].closing_amount, null)
  const over = computeMonthlyPl(base({ materials: [mat({ opening_qty: 1000, opening_amount: 200 * 만, purchase_qty: 1000, purchase_amount: 300 * 만, production_qty: 2500, closing_qty: 0 })] }))
  assert.ok(codes(over).includes('material_over_issue'))
  assert.equal(over.materials[0].production_qty, 2500, '투입 kg를 고쳤다')
  assert.equal(over.materials[0].expected_closing_qty, -500)
  assert.equal(over.closable, false)
})
ok('T8 재고조정과 비용 이중 반영 금지 — 승인된 감모 조정 10만은 줄만 옮기고 영업이익은 그대로(원)', () => {
  // 투입 기준보다 재고가 10만 원(40kg × 2,500원) 덜 남았다 — 대사 차이 10만 → 승인된 «감모» 10만으로 설명.
  const m = mat({ opening_qty: 1000, opening_amount: 200 * 만, purchase_qty: 1000, purchase_amount: 300 * 만, production_qty: 800, closing_qty: 1160 })
  const without = computeMonthlyPl(base({ materials: [m], revenue: 1000 * 만 }))
  assert.equal(without.basis.recon_diff, 10 * 만)
  assert.ok(codes(without).includes('recon_over_tolerance'))
  const withAdj = computeMonthlyPl(base({ materials: [m], revenue: 1000 * 만, adjustments: [{ kind: 'shrinkage', amount: 10 * 만, status: 'approved' }] }))
  assert.equal(withAdj.pl.operating_income, without.pl.operating_income, '조정이 영업이익을 한 번 더 바꿨다')
  assert.equal(withAdj.pl.inventory_other, 10 * 만)
  assert.equal(withAdj.basis.recon_diff, 0)
  assert.equal(withAdj.closable, true, codes(withAdj).join(','))
  // 승인 전 조정은 마감을 막는다.
  const proposed = computeMonthlyPl(base({ materials: [m], revenue: 1000 * 만, adjustments: [{ kind: 'shrinkage', amount: 10 * 만, status: 'proposed' }] }))
  assert.ok(codes(proposed).includes('adjustments_unapproved'))
})
ok('T8 대사 차이가 허용오차(1,000원) 안이면 마감 가능 · 밖이면 막음 — 자동으로 맞추지 않는다', () => {
  // 0.2kg × 2,500원 = 500원 차이.
  const m = mat({ opening_qty: 1000, opening_amount: 200 * 만, purchase_qty: 1000, purchase_amount: 300 * 만, production_qty: 800, closing_qty: 1199.8 })
  const r = computeMonthlyPl(base({ materials: [m] }))
  assert.equal(r.basis.recon_diff, 500)
  assert.equal(r.basis.recon_ok, true)
  const strict = computeMonthlyPl(base({ materials: [m], tolerance_krw: 100 }))
  assert.equal(strict.basis.recon_ok, false)
  assert.equal(strict.materials[0].closing_qty, 1199.8)
})
ok('T8 출고 구분 «확인 필요» · kg 빈칸 · 반품 출고 → 막음(생산 투입이 기본값이 아니다)', () => {
  const r = computeMonthlyPl(base({ materials: [mat({ issue_needs_review: 2, issue_missing_qty: 1, non_production: { return: 5 }, opening_qty: 10, opening_amount: 1000, closing_qty: 5 })] }))
  for (const c of ['material_needs_review', 'material_missing_qty', 'material_return_kind']) assert.ok(codes(r).includes(c), c)
})

/* ─────────────── 시험 9. 기존 손익과의 중복 반영 방지 ─────────────── */
ok('T9 새 영업이익은 기존 장부 영업이익에 재고 증감을 더한 값이 아니다(기존 손익을 입력으로 쓰지 않는다)', () => {
  const a = computeMonthlyPl({ ...t1Month('2099-01', { opening_qty: 0, opening_amount: 0, opening_source: 'statement' }, 900_000, 600_000, 0, false) })
  const b = computeMonthlyPl({ ...t1Month('2099-01', { opening_qty: 0, opening_amount: 0, opening_source: 'statement' }, 900_000, 600_000, 0, false), books_operating_income: 123 * 억 })
  assert.deepEqual(a.pl, b.pl, '기존 장부 영업이익이 새 손익에 섞였다')
  // 검산 칸(기존 + 기말 − 기초)은 깨끗한 경우 새 영업이익과 같다 — 검산일 뿐 보정이 아니다.
  assert.equal(a.check.check_value, 1 * 억)
  assert.equal(a.check.diff_vs_new, 0)
})
ok('T9 기존 구매비용(장부 원재료비)은 새 매출원가로 교체 — 따로 남지 않는다', () => {
  const r = t1[0]
  assert.equal(r.check.books_raw_material, 9 * 억)
  assert.equal(r.pl.cogs, 3 * 억)
  assert.equal(r.pl.cogs! + r.pl.sga! + r.pl.inventory_other!, 4 * 억, '구매비용이 별도 비용으로 남았다')
})
ok('T9 제조비용은 매출원가에만 — 판관비에 다시 들어가지 않고, 재고에 남은 몫은 비용이 아니다(원)', () => {
  const m = [mat({ purchase_qty: 10_000, purchase_amount: 3000 * 만, production_qty: 10_000, closing_qty: 0 })]
  const allSold = computeMonthlyPl(base({ materials: m, mfg_labor: 1000 * 만, revenue: 1 * 억, sga: 500 * 만 }))
  const noLabor = computeMonthlyPl(base({ materials: m, mfg_labor: 0, revenue: 1 * 억, sga: 500 * 만 }))
  assert.equal(allSold.pl.sga, 500 * 만)
  assert.equal(allSold.pl.operating_income! - noLabor.pl.operating_income!, -1000 * 만)
  // 40%가 완제품으로 남으면(기말 완제품 = 제조원가의 40%) 인건비도 40%는 재고에 남는다.
  const partly = computeMonthlyPl(base({ materials: m, mfg_labor: 1000 * 만, revenue: 1 * 억, sga: 500 * 만, finished: { ...base().finished, closing_amount: 1600 * 만 } }))
  assert.equal(partly.pl.cogs, 2400 * 만)
})
ok('T9 매입 9억 · 장부 원재료비 9억 — 검산 칸은 차이(장부 vs 입고)를 보여 주기만', () => {
  const r = computeMonthlyPl({ ...t1Month('2099-01', { opening_qty: 0, opening_amount: 0, opening_source: 'statement' }, 900_000, 600_000, 0, false), books_raw_material: 8.5 * 억 })
  assert.equal(r.check.purchase_vs_books_diff, -0.5 * 억)
  assert.ok(r.warnings.some((w) => w.code === 'purchase_vs_books_diff'))
  assert.equal(r.pl.cogs, 3 * 억)
})

/* ─────────────── 0075 리뷰 고침 ─────────────── */
ok('T9b 4610 상품매출원가 4천만은 교체되지 않고 매출원가에 남는다(입고명세서에 없는 상품)', () => {
  const plain = t1[0]
  const r = computeMonthlyPl({ ...t1Month('2099-01', { opening_qty: 0, opening_amount: 0, opening_source: 'statement' }, 900_000, 600_000, 0, false), books_merchandise_cogs: 4000 * 만 })
  assert.equal(r.pl.cogs, 3 * 억 + 4000 * 만, '상품매출원가가 매출원가에서 빠졌다')
  assert.equal(r.basis.merchandise_cogs, 4000 * 만)
  assert.equal(r.pl.operating_income, plain.pl.operating_income! - 4000 * 만)
  // 장부 원재료비(4510 — 교체되는 줄)와 따로다: 교체되는 쪽 9억은 그대로 검산 칸에만.
  assert.equal(r.check.books_raw_material, 9 * 억)
  assert.ok(!r.warnings.some((w) => w.code === 'purchase_vs_books_diff'), '4610이 장부 원재료비 대조에 섞였다')
  // 장부 줄이 없으면(미입력) 상품매출원가도 미입력 — 매출원가를 0으로 채우지 않는다.
  assert.equal(computeMonthlyPl(base({ books_merchandise_cogs: null })).pl.cogs, null)
})
ok('이동 출고(transfer) 줄 → «이동 출고 — 처리 기준 필요»로 막는다(kg에 넣지 않는다)', () => {
  const r = computeMonthlyPl(base({ materials: [mat({ purchase_qty: 10, purchase_amount: 1000, production_qty: 10, closing_qty: 0, issue_transfer: 2 })] }))
  assert.ok(codes(r).includes('material_transfer_kind'))
  assert.equal(r.closable, false)
  assert.ok(r.blockers.find((b) => b.code === 'material_transfer_kind')!.message.startsWith('이동 출고 — 처리 기준 필요'))
  assert.ok(maskPlResult(r, false).blockers.some((b) => b.code === 'material_transfer_kind' && b.message.includes('(원료 1가지)')))
})
ok('평가손실 조정은 받지 않는다 — 조정 종류는 감모 · 폐기 · 기타', () => {
  const r = computeMonthlyPl(base({ adjustments: [{ kind: 'shrinkage', amount: 10, status: 'approved' }] }))
  assert.deepEqual(Object.keys(r.basis.adjustments_by_kind), ['shrinkage'])
})
ok('같은 거래 금액 기준 줄(amount_base_ref)은 «표:숫자» 꼴만 — 아니면 가장 작은 줄 번호', () => {
  const g = (ref: string) => [{ status: 'same' as const, amount_base_ref: ref, members: [1, 2, 3].map((id) => ({ source_table: 'fin_purchase_in_lines', line_id: id, released: false })) }]
  assert.deepEqual([...dedupeLines('fin_purchase_in_lines', [1, 2, 3], g('fin_purchase_in_lines:3')).excluded].sort(), [1, 2])
  for (const bad of ['fin_purchase_in_lines:3x', 'fin_purchase_in_lines:1e0', 'fin_purchase_in_lines: 3', 'fin_purchase_in_lines:', 'fin_sales_lines:3']) {
    assert.deepEqual([...dedupeLines('fin_purchase_in_lines', [1, 2, 3], g(bad)).excluded].sort(), [2, 3], bad)
  }
})

/* ─────────────── 시험 10. 권한 및 재마감 ─────────────── */
ok('T10 원가 권한 밖: 원료별 줄 · 원료 이름 · 원료별 단가가 없다(화면 · API · 내보내기 모두 이 모양만 받는다)', () => {
  const r = computeMonthlyPl(base({ materials: [t3Mat(), mat({ name: '가짜 원료 나', opening_qty: null, opening_amount: null, opening_source: 'missing' })] }))
  const masked = maskPlResult(r, false)
  const text = JSON.stringify(masked)
  assert.equal(masked.materials.length, 0)
  assert.ok(!text.includes('가짜 원료'), '원료 이름이 샜다')
  assert.ok(!text.includes('wa_unit_cost'), '원료별 단가가 샜다')
  assert.equal(masked.basis.production_input, null, '원료 3가지 미만인데 투입원가 합계가 보인다')
  // 0080 리뷰 I-A · I-B: 매입 · 기초 · 기말을 이루는 원료가 각각 1~2가지면 그 칸 · 검산 칸도 감춘다(합계가 곧 원료 하나의 금액).
  assert.deepEqual(masked.withheld, ['production_input', 'recon_diff', 'raw_opening', 'raw_purchases', 'raw_closing', 'check'])
  assert.deepEqual([masked.basis.raw_opening, masked.basis.raw_purchases, masked.basis.raw_closing, masked.check.check_value], [null, null, null, null], '원료 1~2가지인데 원재료 합계가 보인다')
  assert.equal(masked.pl.cogs, r.pl.cogs, '감추기가 손익 계산을 바꿨다')
  // I-B · I-C: 매입 원료 하나 + 기말 원료 넷 — 합쳐 세면 4가지라 매입이 보였다. 매입만 비우면 사용액으로 풀리므로 셋 다 감춘다.
  const many = computeMonthlyPl(base({ materials: [
    mat({ name: '가짜 매입 하나', purchase_qty: 100, purchase_amount: 100_000, closing_qty: 100, closing_statement_amount: 100_000 }),
    ...['나', '다', '라'].map((n) => mat({ name: `가짜 재고 ${n}`, opening_qty: 10, opening_amount: 10_000, closing_qty: 10, closing_statement_amount: 10_000 })),
  ] }))
  const mm = maskPlResult(many, false)
  assert.ok(many.material_count >= 3 && mm.basis.raw_purchases === null && mm.basis.raw_opening === null && mm.basis.raw_closing === null && mm.check.check_value === null,
    `I-B · I-C: 매입 원료 하나인 달의 원재료 합계가 풀린다 (${JSON.stringify(mm.withheld)})`)
  assert.equal(mm.basis.raw_usage, many.basis.raw_usage, '감추기가 원료 사용액(매출원가 줄)을 바꿨다')
  assert.ok(masked.blockers.some((b) => b.message.includes('(원료 1가지)')))
  const full = maskPlResult(r, true)
  assert.equal(full.materials.length, 2)
})
ok('T10 원료 3가지 이상 · 구분 끝 → 투입원가 합계는 보이고 원료별은 여전히 없다', () => {
  const three = computeMonthlyPl(base({ materials: ['가', '나', '다'].map((n) => mat({ name: `가짜 원료 ${n}`, purchase_qty: 10, purchase_amount: 1000, production_qty: 10, closing_qty: 0 })) }))
  const masked = maskPlResult(three, false)
  assert.equal(masked.basis.production_input, 3000)
  assert.equal(masked.materials.length, 0)
})
ok('T10 과거 달을 다시 마감하면 이후 확정 달은 «재마감 대상»으로만 — 덮어쓰지 않는다', () => {
  const recs = [
    { period: '2099-01', status: 'final' as const, live: false },
    { period: '2099-02', status: 'final' as const, live: true },
    { period: '2099-03', status: 'final' as const, live: true },
    { period: '2099-04', status: 'provisional' as const, live: true },
  ]
  assert.deepEqual(laterFinalPeriods(recs, '2099-01'), ['2099-02', '2099-03'])
  assert.equal(recs[1].status, 'final')
})
ok('T10 앞 달이 마감 전인데 그 앞 달이 확정이면 이 달은 막힌다(기초 = 전월 확정 기말)', () => {
  const r = computeMonthlyPl(base({ link: { prev_final: false, earlier_final: true } }))
  assert.ok(codes(r).includes('prev_not_closed'))
})
ok('잠정 → 마감 조정 내역(plDiff)', () => {
  const d = plDiff(t1[0].pl, { ...t1[0].pl, cogs: 290_000_000, operating_income: 110_000_000 })
  assert.equal(d.cogs, 10_000_000)
  assert.equal(d.operating_income, -10_000_000)
})

/** 2절 · 3절이 쓰는 입력들(SQL 대조). */
export const PARITY_INPUTS: MonthlyPlInput[] = [
  t1Month('2099-01', { opening_qty: 0, opening_amount: 0, opening_source: 'statement' }, 900_000, 600_000, 9 * 억, false),
  base({ materials: [t3Mat()] }),
  base({ materials: [mat({ purchase_qty: 3, purchase_amount: 1_000_000, production_qty: 1, closing_qty: 2 })] }),
  base({ materials: [t3Mat()], revenue: 1000 * 만, wip: { ...base().wip, closing_amount: null, closing_status: null } }),
  base({ materials: [mat({ opening_qty: null, opening_amount: null, opening_source: 'missing', purchase_qty: 100, purchase_amount: 10 * 만, production_qty: 50, closing_qty: 50 })] }),
  base({ materials: [mat({ opening_qty: 1000, opening_amount: 200 * 만, purchase_qty: 1000, purchase_amount: 300 * 만, production_qty: 800, closing_qty: 1160 })], revenue: 1000 * 만, adjustments: [{ kind: 'shrinkage', amount: 10 * 만, status: 'approved' }, { kind: 'other', amount: 1, status: 'proposed' }] }),
  base({ materials: [mat({ purchase_qty: 100, purchase_amount: 10 * 만, production_qty: 50, closing_qty: -5 }), mat({ name: '가짜 원료 나', opening_qty: -500, opening_amount: 100 * 만, purchase_qty: 500, purchase_amount: 150 * 만, production_qty: 0, closing_qty: 0 })] }),
  base({ method: 'statement', method_confirmed: true, materials: [mat({ opening_qty: 1000, opening_amount: 200 * 만, purchase_qty: 1000, purchase_amount: 300 * 만, production_qty: 800, closing_qty: 1200, closing_statement_amount: 290 * 만 })], cash: { uploaded: false, material_payments: null, inflow: null, outflow: null }, books_has_lines: false, revenue: null, books_merchandise_cogs: null, mfg_labor: null, mfg_overhead: null, sga: null }),
  { ...t1Month('2099-01', { opening_qty: 0, opening_amount: 0, opening_source: 'statement' }, 900_000, 600_000, 9 * 억, false), books_merchandise_cogs: 4000 * 만 },
  base({ materials: [mat({ purchase_qty: 10, purchase_amount: 1000, production_qty: 10, closing_qty: 0, issue_transfer: 1 }), mat({ name: '가짜 원료 나', purchase_qty: 5, purchase_amount: 500, production_qty: 5, closing_qty: 0 })] }),
  base({ issues_uploaded: false, materials: [mat({ opening_qty: 10, opening_amount: 1000, production_qty: null, closing_qty: 5, non_production: { sample: 1 } })], purchase_suspects: 1, purchase_dupes_excluded: 2, link: { prev_final: false, earlier_final: true }, wip: { ...base().wip, opening_scope: 'material_only', duplicate_suspect: true } }),
  // PHASE 11 — 첫 달 기초 확인 전 경고(opening_unconfirmed)
  base({ materials: [t3Mat()], openings_unconfirmed: 2 }),
]

/** 순서와 상관없이 같은 까닭들인가(SQL은 같은 순서로 쌓지만, 대조는 내용으로). */
const issueKey = (xs: PlIssue[]) => xs.map((i) => `${i.code}|${i.target ?? ''}|${i.message}`).sort()

/** 2절 — 같은 입력을 0075 fin_pl_compute · fin_pl_mask(SQL)에 넣어 TS와 같은지. */
async function parity() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  const sql = async (x: MonthlyPlInput, cost: boolean | null): Promise<MonthlyPlResult> => {
    const q = cost === null ? `select fin_pl_compute($1::jsonb) as r` : `select fin_pl_mask(fin_pl_compute($1::jsonb), ${cost}) as r`
    const rows = (await db.query<{ r: MonthlyPlResult }>(q, [JSON.stringify(x)])).rows
    return JSON.parse(JSON.stringify(rows[0].r)) as MonthlyPlResult
  }
  let n = 0
  for (const x of PARITY_INPUTS) {
    const ts = computeMonthlyPl(x)
    const db1 = await sql(x, null)
    const { blockers: tb, warnings: tw, ...tRest } = ts
    const { blockers: sb, warnings: sw, ...sRest } = db1
    assert.deepEqual(sRest, tRest, `SQL ≠ TS (${x.period} ${x.materials.map((m) => m.name).join(',')})`)
    assert.deepEqual(issueKey(sb), issueKey(tb), `SQL ≠ TS blockers (${x.period})`)
    assert.deepEqual(issueKey(sw), issueKey(tw), `SQL ≠ TS warnings (${x.period})`)
    for (const cost of [true, false]) {
      const tm = maskPlResult(ts, cost)
      const sm = await sql(x, cost)
      // 대표 · 원가 권한(cost = true)은 두 쪽 모두 결과를 그대로 돌려준다(withheld 칸 없음).
      assert.deepEqual({ ...sm, blockers: issueKey(sm.blockers), warnings: issueKey(sm.warnings) }, { ...tm, blockers: issueKey(tm.blockers), warnings: issueKey(tm.warnings) }, `SQL ≠ TS mask(${cost})`)
    }
    n++
  }
  await db.close()
  return n
}

/**
 * 3절 — dummy repo(0075 거울): 가짜 DY 2099-05 ~ 2099-07(원). 5월: 기초 0 · 매입 9억(900,000kg) · 투입 300,000kg · 기말 600,000kg ·
 * 매출 5억 · 판관비 1억 · 장부 원재료비 9억(A 방식) · 자금흐름표 원재료 대금 9억. 재공품 · 완제품 0(DY 대표가 넣고 대표가 확정).
 */
async function dummyFlow() {
  const BIZ = 'biz_dy'
  const as = (who: string) => (process.env.DUMMY_USER = who)
  let shaN = 0
  const sha = () => `${'d'.repeat(60)}${String(++shaN).padStart(4, '0')}`
  const apply = (kind: string, period: string, rows: Record<string, string | number | null>[]) =>
    repo.finUploadApply({
      business_id: BIZ, kind, period, file_name: `가짜 ${kind} ${period}.xlsx`, file_sha256: sha(), sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: false,
      rows: rows.map((r, i) => ({ ...r, row_no: i + 1 })), people: null, overlap: 'none', reason: null, upload_id: null, dup_suspects: 0,
    })
  const M = '가짜 원료 PL'
  as('chairman')
  const ledger = await repo.loadFinanceLedger()
  const acct = (section: string, category?: string) => {
    const a = ledger.accounts.find((x) => x.business_id === BIZ && x.active && x.section === section && (!category || x.category === category))
    assert.ok(a, `dummy DY 계정 없음: ${section} ${category ?? ''}`)
    return a.account_code
  }
  const [rev, sga, raw, cash, pay] = [acct('revenue'), acct('sga'), acct('cogs', 'raw_material'), acct('cash'), acct('payable')]
  const actor = { user_id: 'dummy-chair', role: 'Chairman' } as unknown as Parameters<typeof repo.postJournalEntry>[1]
  const slip = (date: string, debit: string, credit: string, amount: number, memo: string) =>
    repo.postJournalEntry({ business_id: BIZ, entry_date: date, memo, evidence_url: null, lines: [{ account_code: debit, side: 'debit', amount }, { account_code: credit, side: 'credit', amount }] }, actor)
  const valuations = async (period: string, wip = 0) => {
    as('dy_ceo')
    for (const [category, amount] of [['wip', wip], ['finished', 0]] as const) {
      if (category === 'finished' && wip !== 0) continue
      await repo.finValuationSave({
        business_id: BIZ, period, category, amount, state: amount === 0 ? 'confirmed_zero' : 'value', valuation_date: `${period}-28`, method: '월 가중평균',
        cost_scope: 'material_labor_overhead', source: 'manual', upload_id: null, source_ref: null, note: '가짜', status: 'provisional', reason: '재평가 시험',
      })
    }
    as('chairman')
    for (const v of (await repo.listFinValuations(BIZ, period)).filter((x) => !x.voided_at && x.status !== 'final')) await repo.finValuationConfirm(v.valuation_id, null)
  }
  await apply('inventory', '2099-04', [{ item: M, stock_qty: 0, amount: 0, amount_state: 'confirmed_zero' }])
  await apply('purchase_in', '2099-05', [{ material: M, qty: 900_000, amount: 9 * 억 }])
  // T8 — 같은 파일(같은 해시)을 다시 올리면 거부 — 입고 줄이 두 번 생기지 않는다.
  await assert.rejects(
    repo.finUploadApply({ business_id: BIZ, kind: 'purchase_in', period: '2099-05', file_name: '가짜 다시.xlsx', file_sha256: `${'d'.repeat(60)}0002`, sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: false, rows: [{ row_no: 1, material: M, qty: 900_000, amount: 9 * 억 }], people: null, overlap: 'none', reason: null, upload_id: null, dup_suspects: 0 }),
    /fin_upload_duplicate|fin_upload_overlap/,
  )
  await apply('material_issue', '2099-05', [{ material: M, qty_kg: 300_000, class: 'production', class_reason: '시험 규칙' }])
  await apply('inventory', '2099-05', [{ item: M, stock_qty: 600_000, amount: 6 * 억 }])
  await apply('cashflow', '2099-05', [{ flow_date: '2099-05-10', category: '원재료 대금', outflow: 9 * 억, inflow: null }, { flow_date: '2099-05-20', category: '매출 입금', inflow: 5 * 억, outflow: null }])
  for (const c of ['wip', 'finished'] as const) await repo.finOpeningSave({ business_id: BIZ, period: '2099-05', category: c, amount: 0, state: 'confirmed_zero', source: 'manual', upload_id: null, note: '첫 달 시험' })
  await slip('2099-05-15', cash, rev, 5 * 억, '가짜 매출')
  await slip('2099-05-16', sga, cash, 1 * 억, '가짜 판관비')
  await slip('2099-05-17', raw, pay, 9 * 억, '가짜 매입(A 방식)')
  await valuations('2099-05')

  const may = (await repo.finPlMonth(BIZ, '2099-05'))!
  assert.equal(may.view_status, 'provisional')
  assert.deepEqual([may.result.pl.cogs, may.result.pl.operating_income, may.result.basis.raw_closing, may.result.cash.material_payments], [3 * 억, 1 * 억, 6 * 억, 9 * 억], 'dummy 5월 숫자')
  assert.equal(may.result.closable, true, may.result.blockers.map((b) => b.code).join(','))
  assert.equal(may.result.materials.length, 1, '대표에게 원료별 줄이 없다')

  // T10 — 원가 권한 없는 장부 담당(DY 대표): 스위치를 이 회사 전원으로 연 뒤에만 보이고, 원료별 줄 · 이름이 없고, 확정 못 한다.
  as('dy_ceo')
  await assert.rejects(repo.finPlMonth(BIZ, '2099-05'), /feature_off/, '스위치 기본(대표만)인데 DY 대표가 읽었다')
  as('chairman')
  await repo.setFeatureSwitch({ feature_key: 'monthly_pl', business_id: BIZ, enabled: true, audience: 'all', reason: '시험' })
  as('dy_ceo')
  const ceoView = (await repo.finPlMonth(BIZ, '2099-05'))!
  assert.equal(ceoView.result.materials.length, 0)
  assert.ok(!JSON.stringify(ceoView).includes(M), 'DY 대표에게 원료 이름이 보인다')
  assert.equal(ceoView.result.basis.production_input, null)
  await assert.rejects(repo.finPlRecord(BIZ, '2099-05', true, null), /fin_pl_denied/)
  const p1 = await repo.finPlRecord(BIZ, '2099-05', false, null)
  assert.equal(await repo.finPlRecord(BIZ, '2099-05', false, null), p1, '같은 입력의 잠정 저장이 줄을 늘렸다')

  // 대표 마감 — 다시 눌러도 한 줄(같은 입력 = 같은 결과).
  as('chairman')
  const f1 = await repo.finPlRecord(BIZ, '2099-05', true, '시험')
  assert.equal(await repo.finPlRecord(BIZ, '2099-05', true, '시험'), f1)
  assert.equal(dummyPlCloses().filter((c) => c.business_id === BIZ && c.period === '2099-05').length, 2, '잠정 1 + 확정 1이 아니다')

  // T7 — 마감 뒤 원천이 바뀌어도(늦은 판관비) 확정 숫자 그대로 · «자료 바뀜» · 확정 달 조정 거부.
  await slip('2099-05-28', sga, cash, 500 * 만, '가짜 늦은 판관비')
  const mayAfter = (await repo.finPlMonth(BIZ, '2099-05'))!
  assert.deepEqual([mayAfter.view_status, mayAfter.result.pl.operating_income, mayAfter.stale.inputs_changed], ['final', 1 * 억, true])
  await assert.rejects(repo.finPlAdjustPropose({ business_id: BIZ, period: '2099-05', kind: 'shrinkage', amount: 1000, reason: '확정 달' }), /fin_pl_final/)

  // 6월 — 기초 = 5월 확정 기말 6억.
  await apply('material_issue', '2099-06', [{ material: M, qty_kg: 300_000, class: 'production', class_reason: '시험 규칙' }])
  await apply('inventory', '2099-06', [{ item: M, stock_qty: 300_000, amount: 3 * 억 }])
  await slip('2099-06-15', cash, rev, 5 * 억, '가짜 매출 6월')
  await slip('2099-06-16', sga, cash, 1 * 억, '가짜 판관비 6월')
  await valuations('2099-06')
  const jun = (await repo.finPlMonth(BIZ, '2099-06'))!
  assert.deepEqual([jun.result.basis.raw_opening, jun.result.pl.cogs, jun.result.pl.operating_income, jun.result.closable], [6 * 억, 3 * 억, 1 * 억, true], jun.result.blockers.map((b) => b.code).join(','))
  await repo.finPlRecord(BIZ, '2099-06', true, '시험')

  // T10 — 5월 다시 열기: DY 대표 거부 · 대표 + 이유 → 6월은 확정 그대로 + 재마감 대상 1.
  as('dy_ceo')
  await assert.rejects(repo.finPlReopen(BIZ, '2099-05', '직원 시험'), /fin_pl_denied/)
  as('chairman')
  await assert.rejects(repo.finPlReopen(BIZ, '2099-05', ' '), /fin_pl_reason/)
  assert.equal(await repo.finPlReopen(BIZ, '2099-05', '시험 다시 열기'), 1)
  const junFlag = (await repo.finPlMonth(BIZ, '2099-06'))!
  assert.deepEqual([junFlag.view_status, junFlag.stale.reclose_flags, junFlag.result.pl.cogs], ['final', 1, 3 * 억])
  // 5월 재공품 기말을 100만으로 다시 평가 → 다시 마감 → 6월에 «기초 ≠ 앞 달 확정 기말»(−100만), 6월 숫자는 그대로.
  await valuations('2099-05', 100 * 만)
  await repo.finPlRecord(BIZ, '2099-05', true, '다시 마감')
  const may2 = (await repo.finPlMonth(BIZ, '2099-05'))!
  assert.deepEqual([may2.changed_vs_prev_final?.wip_closing, may2.result.pl.cogs], [100 * 만, 3 * 억 - 100 * 만])
  const jun2 = (await repo.finPlMonth(BIZ, '2099-06'))!
  assert.deepEqual([jun2.view_status, jun2.stale.opening_diff?.wip, jun2.result.pl.cogs], ['final', -100 * 만, 3 * 억])

  // 조정 — 본인 승인 거부 · 다른 사람 승인. 자료 없는 7월 — 마감 거부.
  const a1 = await repo.finPlAdjustPropose({ business_id: BIZ, period: '2099-07', kind: 'shrinkage', amount: 100_000, reason: '시험 감모' })
  await assert.rejects(repo.finPlAdjustDecide(a1, 'approve', null), /fin_pl_self_approve/)
  as('dy_ceo')
  const a2 = await repo.finPlAdjustPropose({ business_id: BIZ, period: '2099-07', kind: 'scrap', amount: 50_000, reason: '시험 폐기' })
  assert.equal(await repo.finPlAdjustPropose({ business_id: BIZ, period: '2099-07', kind: 'scrap', amount: 50_000, reason: '시험 폐기' }), a2, '같은 제안이 줄을 늘렸다')
  as('chairman')
  assert.equal(await repo.finPlAdjustDecide(a2, 'approve', null), true)
  // 승인된 조정의 무효는 마감 권한만(DY 대표 = 장부 쓰기만 → 거부) · 승인 전 제안의 무효는 장부 쓰기로 된다.
  as('dy_ceo')
  await assert.rejects(repo.finPlAdjustDecide(a2, 'void', '승인된 것 무효 시험'), /fin_pl_denied/)
  assert.equal(await repo.finPlAdjustDecide(a1, 'void', '제안 무효 시험'), true)
  await assert.rejects(repo.finPlAdjustPropose({ business_id: BIZ, period: '2099-07', kind: 'valuation_loss' as never, amount: 1000, reason: '평가손실 시험' }), /fin_pl_adjust_value/)
  as('chairman')
  assert.equal(await repo.finPlAdjustDecide(a2, 'void', '승인된 것 무효 시험'), true)
  await assert.rejects(
    repo.finPlSettingsSave(BIZ, { method: 'monthly_wa', method_confirmed: false, tolerance_krw: 1_000_001, revenue_source: 'books', payment_categories: ['원재료'] }, '허용오차 상한 시험'),
    /fin_pl_setting_value/,
  )
  // 4610 상품매출원가 전표 — 교체되는 장부 원재료비에 섞이지 않고 상품매출원가 칸으로.
  if (!ledger.accounts.some((a) => a.business_id === BIZ && a.account_code === '4610')) {
    await repo.createAccount({ business_id: BIZ, account_code: '4610', name: '상품매출원가', category: 'raw_material', section: 'cogs', cash_flow: null }, actor)
  }
  await slip('2099-07-10', '4610', pay, 4000 * 만, '가짜 상품 매입원가')
  const jul = (await repo.finPlMonth(BIZ, '2099-07'))!
  assert.deepEqual([jul.result.basis.merchandise_cogs, jul.result.check.books_raw_material], [4000 * 만, 0], '4610이 장부 원재료비로 읽혔다')
  await assert.rejects(repo.finPlRecord(BIZ, '2099-07', true, null), /fin_pl_entering|fin_pl_blocked/)

  // 스위치를 끄면 대표에게도 꺼진다(화면 · 액션 · RPC 모두 같은 문).
  await repo.setFeatureSwitch({ feature_key: 'monthly_pl', business_id: null, enabled: false, audience: 'chairman', reason: '시험 끄기' })
  await repo.setFeatureSwitch({ feature_key: 'monthly_pl', business_id: BIZ, enabled: false, audience: 'all', reason: '시험 끄기' })
  await assert.rejects(repo.finPlMonth(BIZ, '2099-05'), /feature_off/)
  await repo.setFeatureSwitch({ feature_key: 'monthly_pl', business_id: null, enabled: true, audience: 'chairman', reason: '시험 되돌림' })
}

async function main() {
  for (const t of tests) {
    await t.fn()
    passed++
    console.log(`  ✓ ${t.name}`)
  }
  const n = await parity()
  console.log(`  ✓ 0075 fin_pl_compute · fin_pl_mask(SQL) = calc.ts — 입력 ${n}벌`)
  passed++
  await dummyFlow()
  console.log('  ✓ dummy 0075 거울 — 마감 · 같은 입력 한 줄 · 확정 불변 · 기초 = 전월 확정 기말 · 다시 열기 → 재마감 대상 · 조정 승인 · 권한 · 스위치')
  passed++
  console.log(`PASS check:monthly-pl — ${passed}개`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
