/**
 * check:cost-engine ⑩ — 생산(0064). BYPASSRLS 없는 소유자(⑥) 아래에서 돈다(Supabase 실제 조건).
 *   발행(대표만 · BOM × 계획 kg) · 작업지시 수량 권한(대표 · 생산만) · 생산 LOT · 투입 · 잔량 초과 거부 · 조정(이유 필수) · 무효로 잔량 복원 ·
 *   Actual(대표 원래 값 · 원가 관리 1원 + 감사 · 생산 · 영업 거부) · 분해 대표만 · Current = 잔량 가중 · 오더 닫기 · 닫힌 오더 거부
 */
import assert from 'node:assert/strict'

export interface ProdCtx {
  as: <T>(uid: string | null, sql: string, commit?: boolean) => Promise<T[]>
  run: (uid: string, sql: string) => Promise<unknown[]>
  owner: <T>(sql: string) => Promise<T[]>
  p1: string
  p3: string
  lot: string
  mats: string[]
  U: Record<string, string>
}

const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)
const r1 = (x: number) => Math.sign(x) * Math.round(Math.abs(x)) || 0
const near = (a: number, b: number, why: string) => assert.ok(Math.abs(a - b) < 1e-6, `${why} — ${a} ≠ ${b}`)

export async function production({ as, run, owner, p1, p3, lot, mats, U }: ProdCtx) {
  const [m1, m2, m3] = mats
  const T = (await owner<{ t: string }>(`select cost_today()::text as t`))[0].t
  const count = async (uid: string, table: string) => Number((await as<{ n: number }>(uid, `select count(*)::int as n from ${table}`))[0].n)

  // 발행 — 대표만. BOM 없는(무효로 한) 제품은 cost_bom_missing.
  for (const uid of [U.prod, U.buy, U.sales, U.cost, U.exec, U.ceo, U.agent]) {
    await refuses(as(uid, `select cost_production_issue('${p1}', '${T}', 1000)`), /cost_not_found/, `0064: ${uid.slice(-2)}가 생산 오더를 발행한다`)
  }
  await refuses(as(U.chair, `select cost_production_issue('${p3}', '${T}', 1000)`), /cost_bom_missing/, '0064: BOM 없는 제품의 오더가 발행된다')
  const order = ((await run(U.chair, `select cost_production_issue('${p1}', '${T}', 1000, '시험 오더') as o`))[0] as { o: string }).o
  assert.match(order, /^PO-\d{8}-[0-9A-F]{6}$/)

  // 작업지시 수량 = kg_per_kg ÷ 수율 × 계획 kg(원래 값). 대표 · 생산만.
  const lines = await as<{ material_id: string; planned_kg: string }>(U.prod, `select material_id, planned_kg::text as planned_kg from cost_production_order_lines where order_id = '${order}' order by material_id`)
  const want = new Map([[m1, (0.5 / 0.95) * 1000], [m2, (0.3 / 0.95) * 1000], [m3, (0.25 / 0.95) * 1000]])
  assert.equal(lines.length, 3, '0064: 생산이 작업지시 수량을 못 본다')
  for (const l of lines) near(Number(l.planned_kg), want.get(l.material_id)!, `0064: 작업지시 수량(${l.material_id})`)
  for (const uid of [U.cost, U.buy, U.sales, U.exec, U.ceo, U.cfo, U.agent]) {
    assert.equal(await count(uid, 'cost_production_order_lines'), 0, `0064: ${uid.slice(-2)}가 작업지시 수량(= 비율)을 본다`)
  }
  assert.equal(await count(U.cost, 'cost_production_orders'), 1, '0064: 원가 관리가 오더 머리를 못 본다')
  for (const uid of [U.buy, U.sales]) assert.equal(await count(uid, 'cost_production_orders'), 0, `0064: ${uid.slice(-2)}가 오더를 본다`)
  await refuses(run(U.prod, `insert into cost_production_orders (business_id, product_id, planned_on, planned_kg, created_by) values ('biz_dy', '${p1}', '${T}', 1, '${U.prod}')`),
    /permission denied/, '0064: 생산이 오더를 직접 만든다(작업지시 수량을 BOM 없이 꾸민다)')
  await refuses(run(U.prod, `insert into cost_production_order_lines (order_id, material_id, planned_kg) values ('${order}', '${m1}', 1)`), /permission denied/,
    '0064: 생산이 작업지시 수량을 고친다')

  // 생산 LOT — 생산 입력만. 회사 · 제품은 오더에서.
  await refuses(run(U.buy, `insert into cost_prod_lots (business_id, order_id, produced_on, output_kg) values ('biz_dy', '${order}', '${T}', 980)`), /row-level security/,
    '0064: 구매가 생산 LOT를 만든다')
  const pl = ((await run(U.prod, `insert into cost_prod_lots (business_id, order_id, product_id, produced_on, output_kg) values ('biz_dy', '${order}', 'prd_xxxx', '${T}', 980) returning prod_lot_id as p, product_id as q`))[0]) as { p: string; q: string }
  assert.equal(pl.q, p1, '0064: 생산 LOT 제품을 오더가 아닌 입력값으로 받는다')

  // 투입 — 잔량 안에서만. 원료는 LOT에서.
  const m2lot = (await owner<{ l: string }>(`select lot_id as l from cost_purchase_lots where material_id = '${m2}' and voided_at is null order by received_on limit 1`))[0].l
  await run(U.prod, `insert into cost_prod_inputs (business_id, prod_lot_id, lot_id, material_id, qty_kg) values ('biz_dy', '${pl.p}', '${lot}', 'mat_xxxx', 600)`)
  await refuses(run(U.prod, `insert into cost_prod_inputs (business_id, prod_lot_id, lot_id, material_id, qty_kg) values ('biz_dy', '${pl.p}', '${lot}', '', 400.0001)`),
    /cost_lot_short/, '0064: 잔량(400)보다 많이 쓴다')
  await run(U.prod, `insert into cost_prod_inputs (business_id, prod_lot_id, lot_id, material_id, qty_kg) values ('biz_dy', '${pl.p}', '${lot}', '', 400)`)
  await run(U.prod, `insert into cost_prod_inputs (business_id, prod_lot_id, lot_id, material_id, qty_kg) values ('biz_dy', '${pl.p}', '${m2lot}', '', 300)`)
  assert.equal((await owner<{ m: string }>(`select distinct material_id as m from cost_prod_inputs where lot_id = '${lot}'`))[0].m, m1, '0064: 투입 원료를 LOT가 아닌 입력값으로 받는다')
  await refuses(run(U.buy, `insert into cost_prod_inputs (business_id, prod_lot_id, lot_id, material_id, qty_kg) values ('biz_dy', '${pl.p}', '${m2lot}', '', 1)`),
    /row-level security/, '0064: 구매가 투입을 적는다')
  for (const uid of [U.cost, U.buy, U.sales]) assert.equal(await count(uid, 'cost_prod_inputs'), 0, `0064: ${uid.slice(-2)}가 투입(= 실제 배합)을 본다`)

  // 잔량 · 조정.
  const bal = await as<{ lot_id: string; remaining_kg: string }>(U.prod, `select lot_id, remaining_kg::text as remaining_kg from cost_lot_balances('biz_dy', true)`)
  assert.equal(Number(bal.find((b) => b.lot_id === lot)!.remaining_kg), 0, '0064: 잔량 = 입고 − 투입이 아니다')
  assert.ok(!(await as<{ lot_id: string }>(U.prod, `select lot_id from cost_lot_balances('biz_dy')`)).some((b) => b.lot_id === lot), '0064: 다 쓴 LOT가 «남은 것» 목록에 있다')
  await refuses(as(U.sales, `select * from cost_lot_balances('biz_dy')`), /cost_not_found/, '0064: 영업이 잔량을 본다')
  const pr = await as<Record<string, unknown>>(U.prod, `select * from cost_production_lots('biz_dy')`)
  assert.ok('remaining_kg' in pr[0] && !('unit_price' in pr[0]) && !('fx_rate' in pr[0]), '0064: 생산 LOT 목록 칸')
  await refuses(run(U.buy, `insert into cost_lot_adjustments (business_id, lot_id, adjusted_on, qty_kg, reason) values ('biz_dy', '${m2lot}', '${T}', 10, '')`),
    /check constraint/, '0064: 이유 없는 조정')
  await run(U.buy, `insert into cost_lot_adjustments (business_id, lot_id, adjusted_on, qty_kg, reason) values ('biz_dy', '${m2lot}', '${T}', 10, '시험 — 실사 부족')`)
  await refuses(run(U.sales, `insert into cost_lot_adjustments (business_id, lot_id, adjusted_on, qty_kg, reason) values ('biz_dy', '${m2lot}', '${T}', 1, 'x')`),
    /row-level security/, '0064: 영업이 조정을 넣는다')
  const m2left = Number((await as<{ r: string }>(U.prod, `select remaining_kg::text as r from cost_lot_balances('biz_dy') where lot_id = '${m2lot}'`))[0].r)
  assert.equal(m2left, 500 - 300 - 10, '0064: 잔량 = 입고 − 투입 − 조정')
  await refuses(run(U.prod, `update cost_prod_inputs set qty_kg = 1 where lot_id = '${lot}'`), /permission denied/, '0064: 투입 kg를 고친다')
  await refuses(run(U.prod, `delete from cost_prod_inputs where lot_id = '${lot}'`), /permission denied/, '0064: 투입을 지운다')

  // Actual — Σ(kg × landed) ÷ 산출. 대표 원래 값, 원가 관리 1원 + 감사, 생산 · 영업 · 구매 거부.
  const exact = (1000 * 1480 + 300 * 3000) / 980
  const ca = await as<{ prod_lot_id: string; actual_krw_per_kg: string; input_kg: string }>(U.chair, `select prod_lot_id, actual_krw_per_kg::text as actual_krw_per_kg, input_kg::text as input_kg from cost_prod_actual('biz_dy')`)
  near(Number(ca.find((r) => r.prod_lot_id === pl.p)!.actual_krw_per_kg), exact, '0064: 대표 Actual(원래 값)')
  const auditBefore = Number((await owner<{ n: number }>(`select count(*)::int as n from audit_log where actor_user_id = '${U.cost}' and entity_id = 'actual:biz_dy'`))[0].n)
  const ka = await as<{ prod_lot_id: string; actual_krw_per_kg: string }>(U.cost, `select prod_lot_id, actual_krw_per_kg::text as actual_krw_per_kg from cost_prod_actual('biz_dy')`, true)
  assert.equal(ka.find((r) => r.prod_lot_id === pl.p)!.actual_krw_per_kg, String(r1(exact)), '0064: 원가 관리 Actual(1원)')
  assert.equal(Number((await owner<{ n: number }>(`select count(*)::int as n from audit_log where actor_user_id = '${U.cost}' and entity_id = 'actual:biz_dy'`))[0].n) - auditBefore, 1,
    '0064: 원가 관리 Actual 조회가 감사되지 않는다')
  for (const uid of [U.prod, U.sales, U.buy, U.exec, U.agent]) {
    await refuses(as(uid, `select * from cost_prod_actual('biz_dy')`), /cost_not_found/, `0064: ${uid.slice(-2)}가 Actual을 본다`)
    await refuses(as(uid, `select * from cost_prod_actual_breakdown('${pl.p}')`), /cost_not_found/, `0064: ${uid.slice(-2)}가 Actual 분해를 본다`)
  }
  await refuses(as(U.cost, `select * from cost_prod_actual_breakdown('${pl.p}')`), /cost_not_found/, '0064: 원가 관리가 Actual 분해를 본다')
  const bd = await as<{ material_id: string; amount_krw: string; planned_kg: string }>(U.chair, `select material_id, amount_krw::text as amount_krw, planned_kg::text as planned_kg from cost_prod_actual_breakdown('${pl.p}')`)
  near(bd.reduce((s, r) => s + Number(r.amount_krw), 0) / 980, exact, '0064: 분해 합 ÷ 산출 = Actual')
  near(Number(bd.find((r) => r.material_id === m1)!.planned_kg), (0.5 / 0.95) * 1000, '0064: 분해에 작업지시 수량(배합 이탈 보기)')

  // Current = 잔량 가중(재고 이동평균) — 다 쓴 LOT(1480)는 빠진다. 매일 최신: 투입 즉시.
  const m1lots = await owner<{ l: string; q: string }>(`select landed_krw_per_kg::text as l, qty_kg::text as q from cost_purchase_lots where material_id = '${m1}' and voided_at is null and lot_id <> '${lot}'`)
  const m1cur = m1lots.reduce((s, r) => s + Number(r.l) * Number(r.q), 0) / m1lots.reduce((s, r) => s + Number(r.q), 0)
  const m2lots = await owner<{ lot_id: string; l: string; q: string }>(`select lot_id, landed_krw_per_kg::text as l, qty_kg::text as q from cost_purchase_lots where material_id = '${m2}' and voided_at is null`)
  const m2rem = m2lots.map((r) => ({ l: Number(r.l), q: r.lot_id === m2lot ? Number(r.q) - 310 : Number(r.q) }))
  const m2cur = m2rem.reduce((s, r) => s + r.l * r.q, 0) / m2rem.reduce((s, r) => s + r.q, 0)
  const cur = (0.5 * m1cur + 0.3 * m2cur + 0.25 * 600) / 0.95
  const kc = await as<{ v: string }>(U.cost, `select material_krw_per_kg::text as v from cost_product_cost('${p1}', 'current')`)
  assert.equal(kc[0].v, String(r1(cur)), '0064: Current가 잔량 가중이 아니다(다 쓴 LOT가 남아 있다)')

  // 무효 — 투입을 무효로 하면 잔량이 돌아온다.
  await run(U.prod, `update cost_prod_inputs set void_reason = '시험 — 잘못 적음' where lot_id = '${m2lot}'`)
  const back = Number((await as<{ r: string }>(U.prod, `select remaining_kg::text as r from cost_lot_balances('biz_dy') where lot_id = '${m2lot}'`))[0].r)
  assert.equal(back, 490, '0064: 무효로 한 투입이 잔량에 남는다')

  // 오더 닫기 — 생산은 done만, 취소는 대표. 닫힌 오더에는 생산 LOT를 못 붙인다.
  await refuses(run(U.prod, `update cost_production_orders set status = 'cancelled' where order_id = '${order}'`), /cost_order_closed/, '0064: 생산이 오더를 취소한다')
  await run(U.prod, `update cost_production_orders set status = 'done' where order_id = '${order}'`)
  await refuses(run(U.prod, `insert into cost_prod_lots (business_id, order_id, produced_on, output_kg) values ('biz_dy', '${order}', '${T}', 1)`), /cost_order_closed/,
    '0064: 닫힌 오더에 생산 LOT가 붙는다')
  await refuses(run(U.prod, `update cost_production_orders set status = 'open' where order_id = '${order}'`), /cost_order_closed/, '0064: 닫힌 오더를 다시 연다')

  // 감사 줄에 값이 없다(id만).
  const aud = JSON.stringify(await owner(`select after, note from audit_log where entity_table in ('cost_prod_inputs', 'cost_production_orders', 'cost_prod_lots')`))
  assert.ok(!aud.includes(m1) && !aud.includes('planned_kg') && !aud.includes('qty_kg'), '0064: 생산 감사 줄에 값(kg · 원료)이 있다')
  console.log('  생산: 발행 대표만 · 작업지시 수량 대표/생산만 · 생산 LOT · 투입 · 잔량 초과 거부 · 조정 · 무효 복원 · Actual(대표 원래 값 · 원가 관리 1원 + 감사) · 분해 대표만 · Current 잔량 가중 · 오더 닫기')
}
