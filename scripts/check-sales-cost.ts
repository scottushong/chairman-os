/**
 * 영업 원가 화면(회장 결정 2026-10-09 «영업은 제품 총액만») 검사 — npm run check:sales-cost
 *
 *   ① 순수 함수 — Postgres round(x, 0) · 1원(회장 결정 2026-10-09 밤) · 등급 경계(20 / 15, 반올림 전 %) · 목표 마진별 제시가(원래 총원가) ·
 *      마진 %(원래 총원가) · 원료비 영향 · 기준 문구(매일 최신) · 한도 문구
 *   ② dummy 거울 — 오늘 · 매일 최신 · 1원 · 대표는 원래 값 · 제시가 · 겸직 거부(구매 입력 · 구매 보기 · 생산 + 영업) · 영업은 원료 · 시세 목록 0 ·
 *      원가 관리 셋까지(cost_costing_cap) · 대표만 감시 목록 · 하루 200건
 *   ②' 생산 · 원가 관리 dummy 거울(0064 · 0065) — 작업지시 = 원료 · kg만 · 원가 관리는 작업지시 · 투입 · LOT 잔량 0 · 잔량 초과 거부 ·
 *      투입 남은 LOT 무효 거부 · Actual 1원(투입 kg 대표만) · 원가 관리 총원가 = 원래 값끼리 · 방식 바뀐 새 줄이 앞 줄 대신 · 배부 불가면 계산 안 함 · BOM 대표만
 *   ③ 정적 — 영업 화면 코드가 원료 단위 저장소 메서드 · 표 · 원가 관리 목록 · 비용을 부르지 않는다 · 가짜 BOM(dummy-sales-cost)은 dummy 어댑터만 import ·
 *      생산 · 원가 관리 화면이 BOM · 분해 · AI를 부르지 않는다 · 원가 관리 화면은 LOT 잔량을 부르지 않는다 · 직원이 보는 문구에 «회장» 없음
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { asOfLabel, costGrade, impactText, krw, materialImpactPct, pgRound, priceCheck, RED_NOTICE, round1, salesCostError, salesOffers } from '../src/lib/sales/cost'
import { dummyRepository } from '../src/lib/repository/dummy'
import { DUMMY_UID, dummyModuleGrants, setDummyModuleGrant } from '../src/lib/repository/dummy-org'
import { kstToday } from '../src/lib/chairman-project'
import { buildCustomerQuote, CUSTOMER_QUOTE_FIELDS } from '../src/lib/sales/quote-xlsx'

const ROOT = join(__dirname, '..')
const shiftDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// ── ① 순수 함수 ──────────────────────────────────────────────────────
assert.equal(round1(1234.4), 1234)
assert.equal(round1(1234.5), 1235, 'Postgres round: 0.5는 0에서 먼 쪽')
assert.equal(round1(-1234.5), -1235)
assert.equal(round1(-0.4), 0, '−0이 아니다')
assert.equal(krw(1234.5), '1,235')
assert.equal(krw(-0.3), '0', '−0 표기 없음')
assert.equal(krw(-12.5), '−13')
assert.equal(pgRound(1.005, 2), 1.01, '부동소수 오차를 걷는다')
assert.equal(pgRound(-12.25, 1), -12.3)
assert.equal(costGrade(20), 'green')
assert.equal(costGrade(19.9), 'yellow')
assert.equal(costGrade(15), 'yellow')
assert.equal(costGrade(14.9), 'red')
assert.equal(costGrade(-5), 'red')
assert.equal(costGrade(null), null)
assert.deepEqual(
  salesOffers(2550).map((o) => [o.margin_pct, o.price_krw_per_kg, o.grade]),
  [
    [15, 3000, 'yellow'],
    [20, 3188, 'green'], // 3187.5 → 3188(1원)
    [25, 3400, 'green'],
    [30, 3643, 'green'], // 3642.857 → 3643
  ],
)
// 원래 총원가로 나눈다 — 갈리는 예: 2549.5 ÷ 0.7 = 3642.14 → 3642, 1원 총원가 2550 ÷ 0.7 = 3642.86 → 3643.
assert.equal(salesOffers(2549.5)[3].price_krw_per_kg, 3642, '제시가는 원래 총원가로 나눈다(1원 총원가로 나누면 3643)')
assert.equal(salesOffers(2549.5, true)[3].price_krw_per_kg, 2549.5 / 0.7, '대표는 원래 값')
assert.deepEqual(salesOffers(null), [])
assert.deepEqual(priceCheck(2000, 4000), { total_krw_per_kg: 2000, margin_krw_per_kg: 2000, margin_pct: 50, grade: 'green' })
// 등급은 반올림 전 %로 — 14.955%는 Red(표시 15.0%).
const edge = priceCheck(2000, 2000 / (1 - 0.14955))!
assert.equal(edge.margin_pct, 15, '경계 준비: 표시 15.0%')
assert.equal(edge.grade, 'red', '등급이 표시값(15.0%)으로 매겨진다 — 반올림 전 14.96%여야')
assert.equal(priceCheck(1999.6, 2500)!.total_krw_per_kg, 2000, '총원가 1원 표시')
assert.equal(priceCheck(1999.6, 2500.7)!.margin_krw_per_kg, 501, '마진 = round(2500.7 − 1999.6) = 501(1원 총원가로 빼면 round(500.7) = 501 — 같음)')
assert.equal(priceCheck(1999.4, 2500.45)!.margin_krw_per_kg, 501, '마진 = round(2500.45 − 1999.4) = round(501.05) = 501, 1원 총원가 1999로 빼면 round(501.45) = 501')
assert.equal(priceCheck(1999.6, 2500.3)!.margin_krw_per_kg, 501, '마진 = round(2500.3 − 1999.6) = round(500.7) = 501, 1원 총원가 2000으로 빼면 round(500.3) = 500 — 갈린다')
assert.equal(priceCheck(1999.6, 2500, true)!.margin_krw_per_kg, 2500 - 1999.6, '대표는 원래 값')
assert.equal(priceCheck(2000, 2000)!.grade, 'red')
assert.equal(priceCheck(1640, 2000)!.grade, 'yellow') // 18%
assert.equal(priceCheck(2000, 1000)!.margin_pct, -100)
assert.equal(priceCheck(2000, 0), null, '0원 제시가 = cost_price_invalid')
assert.equal(priceCheck(2000, 2e9), null)
assert.deepEqual(priceCheck(null, 1000), { total_krw_per_kg: null, margin_krw_per_kg: null, margin_pct: null, grade: null })
assert.equal(materialImpactPct(1042, 1000), 4.2)
assert.equal(materialImpactPct(1000, 0), null)
assert.equal(materialImpactPct(null, 1000), null)
assert.equal(impactText(4.2), '원료비 영향 +4.2%')
assert.equal(impactText(-1), '원료비 영향 −1.0%')
assert.equal(impactText(null), null)
assert.equal(asOfLabel('2026-10-09'), '2026-10-09(금) 기준 · 지금 저장된 값')
assert.equal(asOfLabel('2026-10-09', false), '2026-10-09(금) · 오늘 0시 기준 원가(오늘 저장한 값은 내일 반영)', '(가) 영업 문구')
assert.equal(salesCostError('cost_rate_limited'), '오늘 조회 한도에 걸렸습니다 — 대표에게 문의하세요.', '회장 지시 한도 문구')
assert.ok(/대표/.test(RED_NOTICE) && !/회장/.test(RED_NOTICE))
for (const code of ['cost_role_conflict', 'cost_rate_limited', 'cost_price_invalid', 'cost_not_found', 'x']) {
  assert.ok(!/회장|Chairman/i.test(salesCostError(code)), `오류 문구에 «회장»: ${code}`)
}
assert.match(salesCostError('cost_role_conflict'), /구매 · 생산 권한과 영업 원가는 같이 볼 수 없습니다/)
console.log('① 순수 함수 OK')

// ── ② dummy 거울 ─────────────────────────────────────────────────────
const FAKE_MATERIALS = ['원료 A(가짜)', '원료 B(가짜)', '부원료 C(가짜)', '포장재 D(가짜)', 'mat_fake']
const chair = { user_id: DUMMY_UID.chair, role: 'Chairman' as const }

async function as<T>(user: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.DUMMY_USER
  if (user) process.env.DUMMY_USER = user
  else delete process.env.DUMMY_USER
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.DUMMY_USER
    else process.env.DUMMY_USER = prev
  }
}

async function main() {
  const repo = dummyRepository
  const today = kstToday()
  // (가) — 앞 절은 영업도 즉시로 잰다(1원 · 정밀도를 대표 원래 값과 맞춘다). 끝의 (가) 절이 진짜 0시 기준을 잰다.
  process.env.DUMMY_SALES_CUTOFF = 'now'

  // 영업 직원: 오늘 · 원료 없음.
  const staff = await as('sales_staff', () => repo.costSalesList('biz_dy'))
  assert.equal(staff.length, 3, 'dummy 제품 셋')
  assert.ok(staff.every((r) => r.as_of === today), '대표 외 기준일 = 오늘(매일 최신)')
  const text = JSON.stringify(staff)
  assert.ok(!FAKE_MATERIALS.some((n) => text.includes(n)), '영업 원가에 원료가 샌다')
  const x = staff.find((r) => r.product_name === '제품 X(가짜)')!
  assert.ok(x.computed && x.total_krw_per_kg !== null, '제품 X는 계산된다')
  for (const v of [x.market_krw_per_kg, x.current_krw_per_kg, x.total_krw_per_kg, x.advantage_krw_per_kg]) assert.ok(Number.isInteger(v), '대표 외 1원')
  // 대표는 원래 값 — 영업 직원 값은 그 1원이고, 원가 우위 · 제시가는 원래 값에서 1원.
  const chairX = (await as('chairman', () => repo.costSalesList('biz_dy'))).find((r) => r.product_id === x.product_id)!
  assert.ok(!Number.isInteger(chairX.current_krw_per_kg), 'dummy 시험 준비: 대표 원래 값에 소수가 있어야 한다')
  assert.equal(x.current_krw_per_kg, round1(chairX.current_krw_per_kg!), '대표 외 = 원래 값의 1원')
  assert.equal(x.advantage_krw_per_kg, round1(chairX.market_krw_per_kg! - chairX.current_krw_per_kg!), '원가 우위 = round(원래 차)')
  assert.deepEqual(x.offers, salesOffers(chairX.total_krw_per_kg), '제시가 = 원래 총원가 ÷ (1 − 마진) → 1원')
  // 0065 — dummy 시드에 비용 마스터(계획 기준)가 있다: 비용 = 대표 원래 값의 1원, 총원가 = round(원래 원료비 + 원래 비용).
  assert.equal(x.overhead_ready, true, 'dummy 비용 마스터 시드가 배부되지 않는다')
  assert.ok(Number.isInteger(x.overhead_krw_per_kg) && x.overhead_krw_per_kg! > 0, '비용 1원')
  assert.equal(x.overhead_krw_per_kg, round1(chairX.overhead_krw_per_kg!), '비용 = 원래 값의 1원')
  assert.equal(x.total_krw_per_kg, round1(chairX.current_krw_per_kg! + chairX.overhead_krw_per_kg!), '총원가 = round(원래 원료비 + 원래 비용)')
  assert.equal(staff.find((r) => r.product_name === '제품 Z(가짜)')!.computed, false, 'BOM 없는 제품은 계산 안 됨')
  const pc = await as('sales_staff', () => repo.costPriceCheck(x.product_id, x.total_krw_per_kg! * 2))
  assert.deepEqual(pc, priceCheck(chairX.total_krw_per_kg, x.total_krw_per_kg! * 2), 'dummy cost_price_check = 순수 함수(원래 총원가)')
  await assert.rejects(as('sales_staff', () => repo.costPriceCheck(x.product_id, 0)), /cost_price_invalid/)
  const view = await as('sales_staff', () => repo.costSalesView(x.product_id))
  assert.equal(view!.total_krw_per_kg, x.total_krw_per_kg, '목록과 제품 하나가 같은 값')

  // 영업은 원료 · 시세를 못 읽는다(0061 정책 · 회장 결정).
  assert.equal((await as('sales_staff', () => repo.listCostMaterials('biz_dy'))).length, 0, '영업이 원료 목록을 본다')
  assert.equal((await as('sales_staff', () => repo.listMarketPrices('biz_dy', 90))).length, 0, '영업이 시세를 본다')
  assert.equal((await as('sales_staff', () => repo.listPurchaseLots('biz_dy'))).length, 0, '영업이 LOT를 본다')

  // 대표: 오늘 기준 · 감시 목록.
  const chairRows = await as('chairman', () => repo.costSalesList('biz_dy'))
  assert.ok(chairRows.every((r) => r.as_of === today), '대표는 오늘 기준')
  const watch = await as('chairman', () => repo.costingWatch('biz_dy'))
  assert.ok(watch.some((w) => w.user_id === DUMMY_UID.supportLead), '감시 목록에 원가 관리 권한자(경영지원팀장)가 없다')
  await assert.rejects(as('sales_staff', () => repo.costingWatch('biz_dy')), /cost_not_found/, '직원이 감시 목록을 본다')
  await assert.rejects(as('support_lead', () => repo.costingWatch('biz_dy')), /cost_not_found/)
  // 원가 관리 조회는 호출마다 센다.
  const before = watch.find((w) => w.user_id === DUMMY_UID.supportLead)!.cost_reads_7d
  await as('support_lead', () => repo.costSalesList('biz_dy'))
  await as('support_lead', () => repo.costSalesList('biz_dy'))
  const after = (await as('chairman', () => repo.costingWatch('biz_dy'))).find((w) => w.user_id === DUMMY_UID.supportLead)!.cost_reads_7d
  assert.equal(after - before, 2, '원가 관리 조회가 호출마다 감사되지 않는다')

  // ── 생산 · 원가 관리 dummy 거울(0064 · 0065) ───────────────────────
  // 생산 직원: 작업지시 수량(원료 · kg)은 보고, 원가 · 분해 · 발행은 못 한다.
  const orders = await as('prod_staff', () => repo.listProductionOrders('biz_dy'))
  assert.ok(orders.length >= 3 && orders.some((o) => o.status === 'open'), 'dummy 오더 시드')
  const olines = await as('prod_staff', () => repo.listProductionOrderLines(orders.map((o) => o.order_id)))
  assert.ok(olines.length > 0 && olines.every((l) => Object.keys(l).sort().join() === 'material_id,order_id,planned_kg'), '작업지시 = 원료 · kg만')
  assert.equal((await as('support_lead', () => repo.listProductionOrderLines(orders.map((o) => o.order_id)))).length, 0, '원가 관리가 작업지시 수량을 본다')
  assert.equal((await as('support_lead', () => repo.listProdInputs('biz_dy'))).length, 0, '원가 관리가 투입을 본다')
  await assert.rejects(as('prod_staff', () => repo.prodActual('biz_dy')), /cost_not_found/, '생산이 Actual을 본다')
  await assert.rejects(as('prod_staff', () => repo.issueProductionOrder('prd_fake_x', today, 100, '')), /cost_not_found/, '생산이 오더를 발행한다')
  await assert.rejects(as('support_lead', () => repo.lotBalances('biz_dy')), /cost_not_found/, '원가 관리가 LOT 잔량을 본다(0064 리뷰 C1)')
  await assert.rejects(as('chairman', () => repo.prodActualBreakdown('ML-20260101-000000')), /cost_not_found/)
  // 잔량 초과 투입 거부 · 투입이 남은 구매 LOT 무효 거부.
  const bal = await as('prod_staff', () => repo.lotBalances('biz_dy'))
  assert.ok(bal.length > 0 && bal.every((b, i) => i === 0 || bal[i - 1].received_on <= b.received_on), '잔량은 입고 오래된 순')
  const openOrder = orders.find((o) => o.status === 'open')!
  const pl = await as('prod_staff', () => repo.addProdLot('biz_dy', { order_id: openOrder.order_id, produced_on: today, output_kg: 10, note: '' }))
  await assert.rejects(
    as('prod_staff', () => repo.addProdInput('biz_dy', { prod_lot_id: pl.prod_lot_id, lot_id: bal[0].lot_id, qty_kg: bal[0].remaining_kg + 1 })),
    /cost_lot_short/,
  )
  const inp = await as('prod_staff', () => repo.addProdInput('biz_dy', { prod_lot_id: pl.prod_lot_id, lot_id: bal[0].lot_id, qty_kg: 1 }))
  await assert.rejects(as('buy_staff', () => repo.voidPurchaseLot('biz_dy', bal[0].lot_id, '시험')), /cost_lot_in_use/, '투입이 남은 구매 LOT 무효')
  await as('prod_staff', () => repo.voidProdInput('biz_dy', inp.input_id, '시험 정리'))
  await as('prod_staff', () => repo.voidProdLot('biz_dy', pl.prod_lot_id, '시험 정리'))
  await assert.rejects(as('prod_staff', () => repo.closeProductionOrder('biz_dy', openOrder.order_id, 'cancelled')), /cost_order_closed/, '생산이 오더를 취소한다')
  // Actual: 원가 관리 = 1원 · 투입 kg 없음, 대표 = 원래 값 · 투입 kg.
  const actStaff = await as('support_lead', () => repo.prodActual('biz_dy'))
  const actChair = await as('chairman', () => repo.prodActual('biz_dy'))
  const done1 = actChair.find((r) => r.computed)!
  assert.ok(done1.input_kg !== null && !Number.isInteger(done1.actual_krw_per_kg), 'dummy 시험 준비: 대표 Actual 원래 값')
  const staff1 = actStaff.find((r) => r.prod_lot_id === done1.prod_lot_id)!
  assert.equal(staff1.input_kg, null, '원가 관리에게 투입 kg 합이 간다')
  assert.equal(staff1.actual_krw_per_kg, round1(done1.actual_krw_per_kg!), 'Actual 1원')
  const bd = await as('chairman', () => repo.prodActualBreakdown(done1.prod_lot_id))
  assert.ok(bd.length > 0 && bd.every((r) => r.planned_kg !== null), '분해에 작업지시 kg')
  // 원가 관리 목록: 총원가 = round(원래 Current + 원래 비용), 대표는 원래 값.
  const cl = await as('support_lead', () => repo.costingList('biz_dy'))
  const clChair = await as('chairman', () => repo.costingList('biz_dy'))
  const cx = cl.find((r) => r.product_id === 'prd_fake_x')!
  const cxr = clChair.find((r) => r.product_id === 'prd_fake_x')!
  assert.ok(cx.computed && cx.overhead_ready && cx.overhead_basis === 'plan', '원가 관리 목록 시드')
  assert.equal(cx.total_krw_per_kg, round1(cxr.current_krw_per_kg! + cxr.overhead_krw_per_kg!), '원가 관리 총원가 = 원래 값끼리 더한 뒤 1원')
  await assert.rejects(as('sales_staff', () => repo.costingList('biz_dy')), /cost_not_found/, '영업이 원가 관리 목록을 본다')
  await assert.rejects(as('prod_staff', () => repo.overheadSummary('biz_dy')), /cost_not_found/)
  // 방식이 달라도 같은 항목 새 줄이 앞 줄을 대신한다(0065 리뷰 I2) — 시험 뒤 무효로 되돌린다.
  const before2 = (await as('support_lead', () => repo.overheadSummary('biz_dy'))).filter((r) => r.category === 'labor')
  const swap = await as('support_lead', () =>
    repo.addOverhead('biz_dy', { category: 'labor', basis: 'per_kg', amount: 100, product_id: null, effective_from: today, note: '시험' }),
  )
  const after2 = (await as('support_lead', () => repo.overheadSummary('biz_dy'))).filter((r) => r.category === 'labor')
  assert.deepEqual([before2.length, after2.length, after2[0].basis], [1, 1, 'per_kg'], '월 금액 → 원/kg 새 줄이 앞 줄을 대신하지 않는다')
  await as('support_lead', () => repo.voidOverhead('biz_dy', swap.overhead_id, '시험 정리'))
  // 배부 불가(생산 · 계획 없음) → 총원가 · 제시가 계산 안 함(0065 리뷰 I1) — 시험 뒤 되돌린다.
  // 직전 7일 생산(시드 이틀 전 LOT)을 무효로 해 «생산 없음»을 만든다 — 이 검사 프로세스 안의 dummy 저장소만 바뀐다.
  for (const p of (await as('prod_staff', () => repo.listProdLots('biz_dy'))).filter((r) => !r.voided_at && r.produced_on > shiftDays(today, -7))) {
    await as('prod_staff', () => repo.voidProdLot('biz_dy', p.prod_lot_id, '배부 불가 시험'))
  }
  await as('support_lead', () => repo.setAllocSettings('biz_dy', 'trailing', 7, null))
  const noAlloc = (await as('sales_staff', () => repo.costSalesList('biz_dy'))).find((r) => r.product_id === x.product_id)!
  assert.deepEqual([noAlloc.computed, noAlloc.total_krw_per_kg, noAlloc.offers.length, noAlloc.overhead_ready], [false, null, 0, false], '배부 불가인데 원료비만으로 총원가')
  await as('support_lead', () => repo.setAllocSettings('biz_dy', 'plan', 28, 120_000))
  // BOM은 대표만.
  await assert.rejects(as('support_lead', () => repo.bomGet('prd_fake_x')), /cost_not_found/)
  await assert.rejects(as('prod_staff', () => repo.bomStatus()), /cost_not_found/)
  const bom = await as('chairman', () => repo.bomGet('prd_fake_x'))
  assert.ok(bom && bom.lines.length === 3 && bom.is_fake)
  await assert.rejects(
    as('chairman', () => repo.bomSave('prd_fake_x', today, 95, [{ material_id: 'mat_fake_a', kg_per_kg: 1 }], '', false)),
    /cost_bom_real_locked/,
    '스위치 꺼짐에 진짜 판',
  )
  console.log("②' 생산 · 원가 관리 dummy 거울 OK")

  // 겸직 거부.
  await assert.rejects(as('buy_staff', () => repo.costSalesList('biz_dy')), /cost_not_found/, '구매만 있는 사람이 영업 원가를 본다')
  setDummyModuleGrant(DUMMY_UID.buyStaff, { module: '/sales/biz_dy', can_write: true, can_approve: false })
  await assert.rejects(as('buy_staff', () => repo.costSalesList('biz_dy')), /cost_role_conflict/, '구매 입력 + 영업이 원가를 본다')
  setDummyModuleGrant(DUMMY_UID.buyStaff, { module: '/sales/biz_dy', can_write: false, can_approve: false })
  setDummyModuleGrant(DUMMY_UID.salesStaff, { module: '/production/biz_dy', can_write: true, can_approve: false })
  await assert.rejects(as('sales_staff', () => repo.costSalesList('biz_dy')), /cost_role_conflict/, '생산 + 영업이 원가를 본다')
  setDummyModuleGrant(DUMMY_UID.salesStaff, { module: '/production/biz_dy', can_write: false, can_approve: false })
  assert.equal(dummyModuleGrants(DUMMY_UID.salesStaff).length, 1)

  // 원가 관리 셋까지.
  const add = (uid: string, on: boolean) =>
    repo.setModuleGrant(uid, { module: '/costing/biz_dy', can_write: on, can_approve: false }, chair)
  await add(DUMMY_UID.exec, true)
  await add(DUMMY_UID.salesLead, true)
  await assert.rejects(add(DUMMY_UID.dyCeo, true), /cost_costing_cap/, '원가 관리 넷째가 켜진다')
  await add(DUMMY_UID.exec, true) // 이미 가진 사람 다시 켜기는 된다
  await add(DUMMY_UID.exec, false)
  await add(DUMMY_UID.dyCeo, true)
  await add(DUMMY_UID.dyCeo, false)
  await add(DUMMY_UID.salesLead, false)
  // ── (가) 회장 결정 2026-10-10 — 영업은 오늘 0시까지 저장된 값, 대표는 즉시 ──
  delete process.env.DUMMY_SALES_CUTOFF
  const pick = (rows: Awaited<ReturnType<typeof repo.costSalesList>>) => rows.find((r) => r.product_name === '제품 X(가짜)')!
  const s0 = pick(await as('sales_staff', () => repo.costSalesList('biz_dy')))
  const c0 = pick(await as('chairman', () => repo.costSalesList('biz_dy')))
  await as('buy_staff', () => repo.addMarketPrice('biz_dy', { material_id: 'mat_fake_a', observed_on: today, price: 9000, currency: 'KRW', fx_rate: null, source_name: '(가) 오늘 시험', source_url: null, note: '' }))
  const s1 = pick(await as('sales_staff', () => repo.costSalesList('biz_dy')))
  const c1 = pick(await as('chairman', () => repo.costSalesList('biz_dy')))
  assert.deepEqual(s1, s0, '(가) dummy: 오늘 넣은 시세가 영업 값에 바로 반영됐다')
  assert.notEqual(c1.market_krw_per_kg, c0.market_krw_per_kg, '(가) dummy: 오늘 넣은 시세가 대표 값에 바로 반영되지 않는다')
  process.env.DUMMY_SALES_CUTOFF = 'now' // «내일»
  const s2 = pick(await as('sales_staff', () => repo.costSalesList('biz_dy')))
  assert.equal(s2.market_krw_per_kg, round1(c1.market_krw_per_kg!), '(가) dummy: «내일» 영업 Market이 대표 값(1원)과 다르다')
  delete process.env.DUMMY_SALES_CUTOFF

  // ── 0066 견적 dummy 시나리오 — Green 바로 확정 / Red → 결재 → 승인 → 확정 / Red → 반려 → 새 판 ──
  const sx = pick(await as('sales_staff', () => repo.costSalesList('biz_dy')))
  const tot = sx.total_krw_per_kg!
  const valid = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10)
  const mk = (price: number, parent: string | null = null) =>
    as('sales_staff', () => repo.createQuote({ product_id: sx.product_id, customer_name: '김고객', customer_company: '(주)가짜고객', kg: 1000, price_krw_per_kg: price, currency: 'KRW', valid_until: valid, parent_id: parent }))
  const get = async (id: string) => (await as('sales_staff', () => repo.getQuote(id)))!.quote
  const staffActor = { user_id: DUMMY_UID.salesStaff, role: 'Member' }
  const g1 = await mk(tot * 2)
  const gq = await get(g1)
  assert.deepEqual([gq.grade, gq.status, gq.cost_total_krw_per_kg, gq.cost_basis], ['green', 'draft', tot, 'midnight'], '0066 dummy: Green 스냅숏이 영업 화면 값(0시 기준)이 아니다')
  await as('sales_staff', () => repo.confirmQuote(g1))
  assert.equal((await get(g1)).status, 'confirmed', '0066 dummy: Green이 바로 확정되지 않는다')
  await assert.rejects(as('sales_staff', () => repo.createDecision({ business_id: 'biz_dy', title: 'x', options: [], impact: 'Medium', deadline: today,
    template_key: 'price_exception' as never, form: { quote: 'x', product: 'x', kg: '1', price: '1', currency: 'KRW', margin_pct: '30', grade: 'Green' } }, staffActor)),
    /price_exception_use_quote/, '0066 dummy: 가격 예외를 손으로 올린다')
  const redPrice = Math.ceil(tot / 0.9)
  const r1 = await mk(redPrice)
  assert.equal((await get(r1)).grade, 'red')
  await assert.rejects(as('sales_staff', () => repo.confirmQuote(r1)), /quote_needs_approval/, '0066 dummy: Red가 결재 없이 확정된다')
  const dec = await as('sales_staff', () => repo.requestQuoteApproval(r1))
  const decided: string[] = []
  for (const who of ['sales_lead', 'exec', 'dy_ceo', 'chairman']) {
    const v = await as(who, () => repo.approvalDecide(dec, true, null, { user_id: 'x', role: 'x' })).catch(() => null)
    if (v) decided.push(`${who}:${v}`)
    if (v === 'approved') break
  }
  assert.equal(decided.at(-1), 'chairman:approved', `0066 dummy: 가격 예외가 대표 최종 승인으로 끝나지 않는다(${decided.join(', ')})`)
  await as('sales_staff', () => repo.confirmQuote(r1))
  assert.equal((await get(r1)).status, 'confirmed', '0066 dummy: 승인된 Red가 확정되지 않는다')
  const r2 = await mk(redPrice)
  const dec2 = await as('sales_staff', () => repo.requestQuoteApproval(r2))
  assert.equal(await as('sales_lead', () => repo.approvalDecide(dec2, false, '마진이 낮습니다', { user_id: 'x', role: 'x' })), 'rejected')
  assert.equal((await get(r2)).status, 'rejected', '0066 dummy: 반려된 Red가 «반려»가 아니다')
  const r2b = await mk(Math.ceil(tot / 0.75), r2)
  const nb = await get(r2b)
  assert.deepEqual([nb.version, nb.root_id, nb.grade], [2, r2, 'green'], '0066 dummy: 새 판이 원본에 이어지지 않는다')
  assert.equal((await as('buy_staff', () => repo.listQuotes('biz_dy'))).length, 0, '0066 dummy: 구매가 견적을 본다')
  // 고객용 견적서 — 원가 · 마진 · 등급 없음.
  const wb = buildCustomerQuote(gq.status === 'draft' ? await get(g1) : gq, 'DY')
  const cells: string[] = []
  wb.getWorksheet('견적서')!.eachRow((row) => row.eachCell((c) => cells.push(String(c.value instanceof Date ? 'date' : c.value))))
  const sheetText = cells.join('|')
  for (const bad of ['원가', '마진', 'Green', 'green', 'Red', String(tot)]) assert.ok(!sheetText.includes(bad), `0066: 고객용 견적서에 ${bad}가 들어갔다`)
  for (const f of CUSTOMER_QUOTE_FIELDS) assert.ok(cells.includes(f), `0066: 고객용 견적서에 «${f}» 칸이 없다`)
  console.log('②″ 견적 dummy(Green · Red 승인 · Red 반려 → 새 판 · 가격 예외 손 올리기 거부 · 고객용 견적서 원가 0) OK')
  console.log('② dummy 거울 OK')

  // ── ③ 정적 ─────────────────────────────────────────────────────────
  const walk = (p: string): string[] =>
    statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => walk(join(p, f))) : /\.(ts|tsx)$/.test(p) ? [p] : []
  const salesFiles = [
    ...walk(join(ROOT, 'src/app/(dashboard)/sales')),
    ...walk(join(ROOT, 'src/components/sales')),
    ...walk(join(ROOT, 'src/lib/sales')),
    join(ROOT, 'src/app/actions/sales.ts'),
  ]
  assert.ok(salesFiles.length >= 6, '영업 화면 파일을 못 찾았다')
  const MATERIAL_LEVEL =
    /\b(listCostMaterials|saveCostMaterial|listMarketPrices|addMarketPrice|listPurchaseLots|addPurchaseLot|listCostSuppliers|listPurchaseCandidates|listPurchaseDocs|downloadPurchaseDoc|costProductBreakdown|dummyCostLedger)\b|cost_materials|cost_market_prices|cost_purchase_lots|cost_sales_purchase_summary|cost_product_breakdown|cost_bom_|dummy-purchasing|dummy-sales-cost|MATERIAL_CATEGORY|costingList|listOverheads|overheadSummary|allocSettings|cost_costing_list|cost_overhead|lotBalances|prodActual|listProductionOrderLines|listProdInputs/
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  for (const f of salesFiles) {
    const code = stripComments(readFileSync(f, 'utf8'))
    const hit = code.match(MATERIAL_LEVEL)
    assert.equal(hit, null, `영업 화면 코드가 원료 단위를 부른다: ${relative(ROOT, f)} — ${hit?.[0]}`)
    assert.ok(!/회장|Chairman OS/.test(code.replace(/'Chairman'/g, '')), `영업 화면 문구에 «회장»: ${relative(ROOT, f)}`)
  }
  const live = stripComments(readFileSync(join(ROOT, 'src/lib/repository/supabase-sales-cost.ts'), 'utf8'))
  assert.ok(!/from\('cost_(materials|market_prices|purchase_lots|suppliers)'\)/.test(live), 'live 영업 어댑터가 원료 표를 읽는다')

  // 생산 · 원가 관리 화면: BOM · 제품 분해를 부르지 않는다(대표 BOM 화면 · bom 액션만 예외 — Actual 분해는 cost_prod_actual_breakdown) ·
  // AI import 없음 · 원가 관리 화면은 구매 LOT 잔량(0064 리뷰 C1)도 부르지 않는다 · 문구에 «회장» 없음(BOM 화면은 회장 전용이라 예외).
  const BOM_LEVEL =
    /\b(bomGet|bomSave|bomVoid|bomStatus|bomVersions|bomRealAllow|productBreakdown|bomBreakdownAction|bomSaveAction|bomVoidAction|bomRealAllowAction)\b|cost_bom_|cost_product_breakdown|actions\/bom'/
  const prodCostFiles = [
    ...walk(join(ROOT, 'src/app/(dashboard)/production')),
    ...walk(join(ROOT, 'src/app/(dashboard)/costs')).filter((f) => !/[\\/]bom[\\/]/.test(f)),
    ...walk(join(ROOT, 'src/components/production')),
    ...walk(join(ROOT, 'src/components/costs')),
    ...walk(join(ROOT, 'src/lib/production')),
    ...walk(join(ROOT, 'src/lib/costs')),
    join(ROOT, 'src/app/actions/production.ts'),
    join(ROOT, 'src/app/actions/costs.ts'),
  ]
  assert.ok(prodCostFiles.length >= 10, '생산 · 원가 관리 화면 파일을 못 찾았다')
  for (const f of prodCostFiles) {
    const code = stripComments(readFileSync(f, 'utf8'))
    const rel = relative(ROOT, f)
    // 오류 문구 표(lib/costs/errors.ts)는 BOM 이유 코드를 사람 말로 바꾸는 자리라 이름만 적힌다 — 부르는 곳이 아니다.
    const hit = /errors\.ts$/.test(f) ? null : code.match(BOM_LEVEL)
    assert.equal(hit, null, `생산 · 원가 관리 화면 코드가 BOM을 부른다: ${rel} — ${hit?.[0]}`)
    assert.ok(!/from '@\/lib\/ai/.test(code), `생산 · 원가 관리 화면이 AI 코드를 import: ${rel}`)
    assert.ok(!/회장|Chairman OS/.test(code.replace(/'Chairman'/g, '')), `생산 · 원가 관리 화면 문구에 «회장»: ${rel}`)
  }
  for (const f of [...walk(join(ROOT, 'src/app/(dashboard)/costs')), ...walk(join(ROOT, 'src/components/costs'))]) {
    assert.ok(!/\blotBalances\b|cost_lot_balances/.test(stripComments(readFileSync(f, 'utf8'))), `원가 관리 화면이 LOT 잔량을 부른다: ${relative(ROOT, f)}`)
  }
  for (const f of [...walk(join(ROOT, 'src/app/(dashboard)/costs/[business_id]/bom')), ...walk(join(ROOT, 'src/components/bom')), join(ROOT, 'src/app/actions/bom.ts')]) {
    assert.ok(!/from '@\/lib\/ai/.test(readFileSync(f, 'utf8')), `BOM 화면이 AI 코드를 import: ${relative(ROOT, f)}`)
  }
  const bomPage = readFileSync(join(ROOT, 'src/app/(dashboard)/costs/[business_id]/bom/page.tsx'), 'utf8')
  assert.ok(/role !== 'Chairman'\) redirect\('\/me'\)/.test(bomPage), 'BOM 화면이 대표 외를 /me로 돌리지 않는다')

  // 가짜 BOM은 dummy 어댑터만 — 화면 · live · 액션이 dummy-sales-cost를 import하지 않는다.
  for (const f of walk(join(ROOT, 'src'))) {
    const code = readFileSync(f, 'utf8')
    const rel = relative(ROOT, f).replace(/\\/g, '/')
    if (/from '\.\/dummy-sales-cost'|dummy-sales-cost'/.test(code)) {
      assert.equal(rel, 'src/lib/repository/dummy.ts', `가짜 BOM 저장소를 dummy 밖에서 import: ${rel}`)
    }
    if (/\bdummyCostLedger\b/.test(code)) {
      assert.ok(['src/lib/repository/dummy-purchasing.ts', 'src/lib/repository/dummy-sales-cost.ts'].includes(rel), `dummy 원장을 밖에서 부른다: ${rel}`)
    }
  }
  console.log('③ 정적 OK')
  console.log('check:sales-cost — 모두 통과')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
