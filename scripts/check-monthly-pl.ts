/**
 * PHASE 3 «월별 손익 — 재고 반영 매출원가 · 손익과 현금 분리 · 마감» 검사: npm run check:monthly-pl
 *   (= tsx --conditions=react-server scripts/check-monthly-pl.ts — dummy repo를 읽는다. 진짜 회사 자료 · AI 호출 · 네트워크 없음.)
 *
 *   1) 순수 계산(src/lib/monthly-pl/calc.ts) — 시험 1~10(원문 9절). 금액 단위는 전부 원(KRW), 수량은 kg. 가정은 시험 이름 · 주석에.
 *   2) 같은 입력을 0075 fin_pl_compute(SQL, PGlite)에 넣어 TS와 결과가 같은지 — live는 SQL이 계산한다(두 벌이 갈라지지 않게).
 *   3) dummy repo(마감 · 재마감 · 권한 · 같은 입력 = 같은 결과 · 재계산 중복 없음).
 */
import assert from 'node:assert/strict'

import {
  computeMonthlyPl,
  dedupeLines,
  estimateSingleProductFinished,
  laterFinalPeriods,
  maskPlResult,
  plDiff,
  roundWon,
} from '../src/lib/monthly-pl/calc'
import type { MonthlyPlInput, MonthlyPlResult, PlMaterialInput } from '../src/types'

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

/* ─────────────── 시험 10. 권한 및 재마감 ─────────────── */
ok('T10 원가 권한 밖: 원료별 줄 · 원료 이름 · 원료별 단가가 없다(화면 · API · 내보내기 모두 이 모양만 받는다)', () => {
  const r = computeMonthlyPl(base({ materials: [t3Mat(), mat({ name: '가짜 원료 나', opening_qty: null, opening_amount: null, opening_source: 'missing' })] }))
  const masked = maskPlResult(r, false)
  const text = JSON.stringify(masked)
  assert.equal(masked.materials.length, 0)
  assert.ok(!text.includes('가짜 원료'), '원료 이름이 샜다')
  assert.ok(!text.includes('wa_unit_cost'), '원료별 단가가 샜다')
  assert.equal(masked.basis.production_input, null, '원료 3가지 미만인데 투입원가 합계가 보인다')
  assert.deepEqual(masked.withheld, ['production_input', 'recon_diff'])
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
  base({ method: 'statement', method_confirmed: true, materials: [mat({ opening_qty: 1000, opening_amount: 200 * 만, purchase_qty: 1000, purchase_amount: 300 * 만, production_qty: 800, closing_qty: 1200, closing_statement_amount: 290 * 만 })], cash: { uploaded: false, material_payments: null, inflow: null, outflow: null }, books_has_lines: false, revenue: null, mfg_labor: null, mfg_overhead: null, sga: null }),
  base({ issues_uploaded: false, materials: [mat({ opening_qty: 10, opening_amount: 1000, production_qty: null, closing_qty: 5, non_production: { sample: 1 } })], purchase_suspects: 1, purchase_dupes_excluded: 2, link: { prev_final: false, earlier_final: true }, wip: { ...base().wip, opening_scope: 'material_only', duplicate_suspect: true } }),
]

async function main() {
  for (const t of tests) {
    await t.fn()
    passed++
    console.log(`  ✓ ${t.name}`)
  }
  console.log(`PASS check:monthly-pl — ${passed}개`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
