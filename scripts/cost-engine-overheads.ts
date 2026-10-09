/**
 * check:cost-engine ⑪ — 비용 마스터 · 배부 · 총원가(0065). 생산(⑩) 뒤 · BYPASSRLS 없는 소유자 아래에서 돈다.
 *   권한(원가 관리 · 대표만 표 · 영업은 합계만) · 월 금액 일할(창 안에서 금액이 바뀌는 날까지) ÷ 직전 28일 생산 kg · 원/kg 직접(전체 + 제품) ·
 *   미래 시작일 무시 · 계획 기준 · 배부 불가 = 계산 안 함(0 아님) · 무효 · 정밀도(유리수 대조 · 1원 끝자리 · 원가 + 비용 합의 1원 ≠ 1원끼리 합)
 */
import assert from 'node:assert/strict'

import { q4, qadd, qdiv, qfrac, qmul, qnear, Qof, qround, qsub, qsum, type Q } from './cost-rational'

export interface OhCtx {
  as: <T>(uid: string | null, sql: string, commit?: boolean) => Promise<T[]>
  run: (uid: string, sql: string) => Promise<unknown[]>
  owner: <T>(sql: string) => Promise<T[]>
  p1: string
  U: Record<string, string>
}

const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)
const R = (a: Q) => qround(a).toString()

export async function overheads({ as, run, owner, p1, U }: OhCtx) {
  const T = (await owner<{ t: string }>(`select cost_today()::text as t`))[0].t
  const count = async (uid: string, table: string) => Number((await as<{ n: number }>(uid, `select count(*)::int as n from ${table}`))[0].n)

  // 권한 — 비용 표는 원가 관리 · 대표만.
  await refuses(run(U.sales, `insert into cost_overheads (business_id, category, basis, amount, effective_from) values ('biz_dy', 'labor', 'monthly', 1, '${T}')`),
    /row-level security/, '0065: 영업이 비용을 넣는다')
  await refuses(run(U.buy, `insert into cost_overheads (business_id, category, basis, amount, effective_from) values ('biz_dy', 'labor', 'monthly', 1, '${T}')`),
    /row-level security/, '0065: 구매가 비용을 넣는다')
  await refuses(run(U.cost, `insert into cost_overheads (business_id, category, basis, amount, product_id, effective_from) values ('biz_dy', 'labor', 'monthly', 1, '${p1}', '${T}')`),
    /check constraint/, '0065: 월 금액에 제품을 붙인다(월 금액은 회사 전체 배부)')
  await refuses(as(U.sales, `select cost_alloc_set('biz_dy', 'trailing', 28, null)`), /cost_not_found/, '0065: 영업이 배부 기준을 바꾼다')
  await refuses(as(U.cost, `select cost_alloc_set('biz_dy', 'plan', 28, null)`), /cost_alloc_invalid/, '0065: 계획 기준인데 계획 생산량이 없다')
  await run(U.cost, `select cost_alloc_set('biz_dy', 'trailing', 28, null)`)

  // 월 금액 — 창(T−27 … T) 안에서 가스가 T−5에 바뀐다 · 전기는 T−10부터 · 임대는 T+3부터(창 밖).
  const monthly: [string, string, number][] = [['labor', '12345678.9', 60], ['power', '1234567', 10], ['gas', '500000', 60], ['gas', '650000', 5], ['rent', '3000000', -3]]
  for (const [c, a, ago] of monthly) {
    await run(U.cost, `insert into cost_overheads (business_id, category, basis, amount, effective_from) values ('biz_dy', '${c}', 'monthly', ${a}, '${T}'::date - ${ago})`)
  }
  for (const uid of [U.sales, U.buy, U.prod, U.exec, U.agent]) assert.equal(await count(uid, 'cost_overheads'), 0, `0065: ${uid.slice(-2)}가 비용 표를 본다`)
  assert.equal(await count(U.cost, 'cost_overheads'), 5, '0065: 원가 관리가 비용 표를 못 본다')

  const kg = Number((await owner<{ k: string }>(`select sum(output_kg)::text as k from cost_prod_lots where business_id = 'biz_dy' and voided_at is null and produced_on > '${T}'::date - 28`))[0].k)
  assert.ok(kg > 0, '0065 시험 준비: 직전 28일 생산이 없다(⑩ 생산이 먼저 돌아야)')
  const day = (amt: string, days: number) => qmul(Qof(amt), qdiv(Qof(12 * days), Qof(365)))
  const mfgAlloc = qdiv(qsum([day('12345678.9', 28), day('1234567', 11), day('500000', 22), day('650000', 6)]), Qof(kg))
  const pack = Qof('12.345')
  await run(U.cost, `insert into cost_overheads (business_id, category, basis, amount, product_id, effective_from) values ('biz_dy', 'packaging', 'per_kg', 12.345, '${p1}', '${T}'::date - 1)`)

  // 물류 원/kg를 골라 «1원 원가 + 1원 비용 ≠ 1원 총원가»가 되게 한다.
  const cu = Qof((await as<{ v: string }>(U.chair, `select material_krw_per_kg::text as v from cost_product_cost('${p1}', 'current')`))[0].v)
  const fc = qfrac(cu)
  const fo = qsub(fc, Qof('0.5')).n < 0n ? qsub(Qof('0.5'), qdiv(fc, Qof(2))) : qadd(Qof('0.5'), qdiv(qsub(Qof(1), fc), Qof(2)))
  const base = qadd(mfgAlloc, pack)
  let L = qadd(qsub(Qof(30), qfrac(base)), fo)
  L = Qof(q4(L))
  await run(U.cost, `insert into cost_overheads (business_id, category, basis, amount, effective_from) values ('biz_dy', 'logistics', 'per_kg', ${q4(L)}, '${T}'::date - 3)`)
  const oh = qadd(base, L)
  const total = qadd(cu, oh)
  assert.notEqual(R(total), (qround(cu) + qround(oh)).toString(), '0065 시험 준비: 1원끼리 합과 원래 합이 갈리게 고르지 못했다')

  // 영업: 비용 · 총원가 · 제시가가 원래 값 기준 1원.
  const sv = (await as<{ current_krw_per_kg: string; overhead_krw_per_kg: string; total_krw_per_kg: string; overhead_ready: boolean; offers: { margin_pct: number; price_krw_per_kg: number }[] }>(
    U.sales, `select * from cost_sales_view('${p1}')`))[0]
  assert.equal(sv.overhead_ready, true, '0065: 비용이 준비됐는데 영업에 안 붙는다')
  assert.equal(String(sv.current_krw_per_kg), R(cu), '0065: 영업 원료비')
  assert.equal(String(sv.overhead_krw_per_kg), R(oh), `0065: 영업 비용(원/kg) — 직접 계산 ${R(oh)}`)
  assert.equal(String(sv.total_krw_per_kg), R(total), '0065: 영업 총원가 = round(원래 원료비 + 원래 비용)')
  assert.notEqual(Number(sv.total_krw_per_kg), Number(sv.current_krw_per_kg) + Number(sv.overhead_krw_per_kg), '0065: 총원가를 1원끼리 더했다')
  for (const o of sv.offers) assert.equal(String(o.price_krw_per_kg), R(qdiv(total, qsub(Qof(1), qdiv(Qof(o.margin_pct), Qof(100))))), `0065: 제시가 ${o.margin_pct}%`)
  assert.equal((await as<{ v: string }>(U.cost, `select material_krw_per_kg::text as v from cost_product_cost('${p1}', 'total')`))[0].v, R(total), '0065: 원가 관리 총원가(total)')

  // 원가 관리 목록 — 묶음별 · 대표는 원래 값.
  const cl = (await as<Record<string, string>>(U.cost, `select * from cost_costing_list('biz_dy') where product_id = '${p1}'`))[0]
  assert.equal(String(cl.mfg_krw_per_kg), R(mfgAlloc), '0065: 제조(인건비 · 전기 · 가스 배부)')
  assert.equal(String(cl.pack_krw_per_kg), R(pack), '0065: 포장(제품 직접)')
  assert.equal(String(cl.logi_krw_per_kg), R(L), '0065: 물류(원/kg)')
  assert.equal(String(cl.indirect_krw_per_kg), '0', '0065: 미래 시작 임대가 들어왔다')
  assert.equal(String(cl.total_krw_per_kg), R(total), '0065: 원가 관리 목록 총원가')
  assert.equal(cl.overhead_basis, 'trailing')
  const chairList = (await as<Record<string, string>>(U.chair, `select total_krw_per_kg::text as t, mfg_krw_per_kg::text as m from cost_costing_list('biz_dy') where product_id = '${p1}'`))[0]
  assert.ok(qnear(Qof(chairList.t), total) && qnear(Qof(chairList.m), mfgAlloc), '0065: 대표 원가 관리 목록이 원래 값이 아니다')
  for (const uid of [U.sales, U.buy, U.prod]) {
    await refuses(as(uid, `select * from cost_costing_list('biz_dy')`), /cost_not_found/, `0065: ${uid.slice(-2)}가 원가 관리 목록을 본다`)
    await refuses(as(uid, `select * from cost_overhead_summary('biz_dy')`), /cost_not_found/, `0065: ${uid.slice(-2)}가 비용 항목을 본다`)
  }
  const sum = await as<{ category: string; per_kg: string; product_id: string | null }>(U.cost, `select category, per_kg::text as per_kg, product_id from cost_overhead_summary('biz_dy')`)
  const mfgSum = sum.filter((r) => ['labor', 'power', 'gas'].includes(r.category)).reduce((s, r) => qadd(s, Qof(r.per_kg)), Qof(0))
  assert.ok(qnear(mfgSum, mfgAlloc), '0065: 항목별 kg당 배부의 합 ≠ 제조 배부')
  assert.ok(!sum.some((r) => r.category === 'rent'), '0065: 미래 시작 항목이 오늘 요약에 있다')

  // 계획 기준 · 배부 불가 · 무효.
  await run(U.cost, `select cost_alloc_set('biz_dy', 'plan', 28, 30000)`)
  const planDiv = qdiv(Qof(30000 * 12 * 28), Qof(365))
  const mfgPlan = qdiv(qsum([day('12345678.9', 28), day('1234567', 11), day('500000', 22), day('650000', 6)]), planDiv)
  const cp = (await as<Record<string, string>>(U.cost, `select * from cost_costing_list('biz_dy') where product_id = '${p1}'`))[0]
  assert.equal(String(cp.mfg_krw_per_kg), R(mfgPlan), '0065: 계획 기준 배부')
  assert.equal(cp.overhead_basis, 'plan')
  await run(U.cost, `select cost_alloc_set('biz_dy', 'trailing', 28, null)`)
  // 나눌 kg가 없으면(생산 0 · 계획 없음) 계산 안 함 — 생산 LOT를 잠시 무효로 해 잰다.
  await owner(`set session_replication_role = replica`)
  await owner(`update cost_prod_lots set voided_at = now(), voided_by = created_by, void_reason = '시험 — 잠시' where business_id = 'biz_dy' and voided_at is null`)
  await owner(`set session_replication_role = origin`)
  const nr = await as<{ computed: boolean; reason: string }>(U.chair, `select computed, reason from cost_product_cost('${p1}', 'total')`)
  assert.deepEqual([nr[0].computed, nr[0].reason], [false, 'overhead_not_ready'], '0065: 나눌 kg가 없는데 비용을 0으로 메운다')
  // (생산 LOT를 무효로 하면 그 투입도 빠져 Current가 바뀐다 — 같은 줄의 원료비와 견준다.)
  const nrs = (await as<{ overhead_ready: boolean; total_krw_per_kg: string; current_krw_per_kg: string }>(U.sales, `select overhead_ready, total_krw_per_kg::text as total_krw_per_kg, current_krw_per_kg::text as current_krw_per_kg from cost_sales_view('${p1}')`))[0]
  assert.deepEqual([nrs.overhead_ready, nrs.total_krw_per_kg], [false, nrs.current_krw_per_kg], '0065: 배부 불가일 때 영업 총원가는 원료비만 · «비용 준비 전» 꼬리표')
  await owner(`set session_replication_role = replica`)
  await owner(`update cost_prod_lots set voided_at = null, voided_by = null, void_reason = null where void_reason = '시험 — 잠시'`)
  await owner(`set session_replication_role = origin`)
  await run(U.cost, `update cost_overheads set void_reason = '시험 — 가스 인상 취소' where category = 'gas' and amount = 650000`)
  const mfgVoid = qdiv(qsum([day('12345678.9', 28), day('1234567', 11), day('500000', 28)]), Qof(kg))
  assert.equal(String((await as<Record<string, string>>(U.cost, `select * from cost_costing_list('biz_dy') where product_id = '${p1}'`))[0].mfg_krw_per_kg), R(mfgVoid),
    '0065: 무효로 한 비용 줄이 남는다')
  await refuses(run(U.cost, `update cost_overheads set amount = 1 where category = 'labor'`), /permission denied/, '0065: 비용 금액을 고친다(무효 + 새 줄이어야)')
  console.log(`  비용: 제조 배부 ${R(mfgAlloc)}원/kg(${kg}kg · 28일) · 포장 ${R(pack)} · 물류 ${R(L)} · 총원가 ${R(total)}원(1원끼리 합 ${qround(cu) + qround(oh)}) · 계획 기준 · 배부 불가 · 무효`)
}
