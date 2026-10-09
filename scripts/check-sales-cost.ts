/**
 * 영업 원가 화면(회장 결정 2026-10-09 «영업은 제품 총액만») 검사 — npm run check:sales-cost
 *
 *   ① 순수 함수 — Postgres round(x, 0) · 1원(회장 결정 2026-10-09 밤) · 등급 경계(20 / 15, 반올림 전 %) · 목표 마진별 제시가(원래 총원가) ·
 *      마진 %(원래 총원가) · 원료비 영향 · 기준 문구(매일 최신) · 한도 문구
 *   ② dummy 거울 — 오늘 · 매일 최신 · 1원 · 대표는 원래 값 · 제시가 · 겸직 거부(구매 입력 · 구매 보기 · 생산 + 영업) · 영업은 원료 · 시세 목록 0 ·
 *      원가 관리 셋까지(cost_costing_cap) · 대표만 감시 목록 · 하루 200건
 *   ③ 정적 — 영업 화면 코드가 원료 단위 저장소 메서드 · 표를 부르지 않는다 · 가짜 BOM(dummy-sales-cost)은 dummy 어댑터만 import ·
 *      직원이 보는 문구에 «회장» 없음
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { asOfLabel, costGrade, impactText, krw, materialImpactPct, pgRound, priceCheck, RED_NOTICE, round1, salesCostError, salesOffers } from '../src/lib/sales/cost'
import { dummyRepository } from '../src/lib/repository/dummy'
import { DUMMY_UID, dummyModuleGrants, setDummyModuleGrant } from '../src/lib/repository/dummy-org'
import { kstToday } from '../src/lib/chairman-project'

const ROOT = join(__dirname, '..')

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
assert.equal(asOfLabel('2026-10-09'), '2026-10-09(금) 기준 · 지금 저장된 값(매일 최신)')
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
  assert.equal(x.overhead_ready, false)
  assert.equal(x.overhead_krw_per_kg, null)
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
    /\b(listCostMaterials|saveCostMaterial|listMarketPrices|addMarketPrice|listPurchaseLots|addPurchaseLot|listCostSuppliers|listPurchaseCandidates|listPurchaseDocs|downloadPurchaseDoc|costProductBreakdown|dummyCostLedger)\b|cost_materials|cost_market_prices|cost_purchase_lots|cost_sales_purchase_summary|cost_product_breakdown|cost_bom_|dummy-purchasing|dummy-sales-cost|MATERIAL_CATEGORY/
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  for (const f of salesFiles) {
    const code = stripComments(readFileSync(f, 'utf8'))
    const hit = code.match(MATERIAL_LEVEL)
    assert.equal(hit, null, `영업 화면 코드가 원료 단위를 부른다: ${relative(ROOT, f)} — ${hit?.[0]}`)
    assert.ok(!/회장|Chairman OS/.test(code.replace(/'Chairman'/g, '')), `영업 화면 문구에 «회장»: ${relative(ROOT, f)}`)
  }
  const live = stripComments(readFileSync(join(ROOT, 'src/lib/repository/supabase-sales-cost.ts'), 'utf8'))
  assert.ok(!/from\('cost_(materials|market_prices|purchase_lots|suppliers)'\)/.test(live), 'live 영업 어댑터가 원료 표를 읽는다')

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
