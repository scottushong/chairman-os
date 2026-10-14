/**
 * check:cost-engine ⑫ — 회장 결정(2026-10-10) 역산 위험 (가): 영업 값은 «오늘 0시(KST)까지 저장된 값», 원가 관리 · 대표는 즉시.
 *
 * 앞 절들은 cost_secret.sales_cutoff()를 «지금 + 하루»로 바꿔 둔 채 돈다(영업도 즉시 = 계산 · 정밀도 단언을 그대로 쓰려고).
 * 이 절이 진짜 정의(오늘 0시 KST)로 되돌리고 잰다:
 *   ① 지금까지 넣은 줄을 이틀 전으로 돌린다 → 영업 = 원가 관리(1원) = 대표(원래 값 1원)가 같은 값.
 *   ② 오늘 넣은 시세 · LOT · BOM 판 · 비용 줄 · 배부 기준 · 무효 처리 — 하나씩 넣을 때마다 영업 값(총액 · Market · Current ·
 *      제시가 확인 · 목록 · 원료비 영향)은 그대로, 원가 관리 · 대표 값은 바로 바뀐다.
 *   ③ «내일»(오늘 줄을 하루 전으로 돌림) — 영업 값이 원가 관리 값과 같아진다.
 * BYPASSRLS 없는 소유자(⑥ 이후) 아래에서 돈다.
 */
import assert from 'node:assert/strict'

import type { PGlite } from '@electric-sql/pglite'

export interface KnownCtx {
  db: PGlite
  as: <T>(uid: string | null, sql: string, commit?: boolean) => Promise<T[]>
  run: (uid: string, sql: string) => Promise<unknown[]>
  owner: <T>(sql: string) => Promise<T[]>
  p1: string
  mats: string[]
  s1: string
  U: Record<string, string>
}

/** 앞 절용 — 영업도 즉시(«지금 + 하루»까지 저장된 값 = 지금 저장된 값 전부). */
export const PIN_SALES_IMMEDIATE = `create or replace function cost_secret.sales_cutoff() returns timestamptz
  language sql stable set search_path = public, pg_temp as $fn$ select now() + interval '1 day'; $fn$;`

/** 0062의 진짜 정의 그대로(check:blueprint 11절도 쓴다). */
export const REAL_CUTOFF = `create or replace function cost_secret.sales_cutoff() returns timestamptz
  language sql stable set search_path = public, pg_temp as $fn$ select (cost_today()::timestamp) at time zone 'Asia/Seoul'; $fn$;`

const TABLES = ['cost_market_prices', 'cost_purchase_lots', 'cost_secret.bom_versions', 'cost_prod_lots', 'cost_prod_inputs', 'cost_lot_adjustments', 'cost_overheads']

/** p 이전(전부) 또는 오늘 0시 뒤(오늘 것만)의 줄을 days일 앞으로 돌린다. */
export function shiftKnown(days: number, onlyToday: boolean) {
  const cut = `(cost_today()::timestamp at time zone 'Asia/Seoul')`
  return `set session_replication_role = replica;
    ${TABLES.map((t) => `update ${t} set created_at = created_at - interval '${days} days'${onlyToday ? ` where created_at > ${cut}` : ''};
      update ${t} set voided_at = voided_at - interval '${days} days' where voided_at is not null${onlyToday ? ` and voided_at > ${cut}` : ''};`).join('\n')}
    update cost_alloc_settings set updated_at = updated_at - interval '${days} days'${onlyToday ? ` where updated_at > ${cut}` : ''};
    set session_replication_role = origin;`
}

export async function knownCutoff({ db, as, run, owner, p1, mats, s1, U }: KnownCtx) {
  const [m1, m2, m3] = mats
  const T = (await owner<{ t: string }>(`select cost_today()::text as t`))[0].t
  // 오늘 무효로 할 LOT — 평균을 크게 움직이게 양 · 단가를 따로 둔다(어제 이전 줄이 된다).
  const { big } = (await run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price)
    values ('biz_dy', '${m2}', '${s1}', '${T}'::date - 3, 50000, 5000) returning lot_id as big`))[0] as { big: string }
  await db.exec(REAL_CUTOFF)
  await db.exec(shiftKnown(2, false))
  const reset = () => db.exec(`delete from cost_secret.cost_reads`)

  type SV = { market_krw_per_kg: string; current_krw_per_kg: string; total_krw_per_kg: string; computed: boolean }
  const sales = async () => {
    await reset()
    const v = (await as<SV>(U.sales, `select market_krw_per_kg::text, current_krw_per_kg::text, total_krw_per_kg::text, computed from cost_sales_view('${p1}')`))[0]
    const l = (await as<SV>(U.sales, `select market_krw_per_kg::text, current_krw_per_kg::text, total_krw_per_kg::text, computed from cost_sales_list('biz_dy') where product_id = '${p1}'`))[0]
    const pc = (await as<{ t: string }>(U.sales, `select total_krw_per_kg::text as t from cost_price_check('${p1}', 999999)`))[0]
    const imp = (await as<{ v: string | null }>(U.sales, `select cost_material_impact('${p1}', 'current', '${T}'::date - 7, '${T}')::text as v`))[0]
    const tot = (await as<{ v: string | null }>(U.sales, `select material_krw_per_kg::text as v from cost_product_cost('${p1}', 'total')`))[0]
    assert.deepEqual(l, v, '(가): 영업 목록과 영업 한 줄이 다른 값')
    assert.equal(pc.t, v.total_krw_per_kg, '(가): 영업 제시가 확인의 총원가가 영업 화면과 다르다')
    return { ...v, impact: imp.v, product_total: tot.v }
  }
  const costing = async (kind: 'market' | 'current' | 'total' = 'total') => {
    await reset()
    return (await as<{ v: string | null }>(U.cost, `select material_krw_per_kg::text as v from cost_product_cost('${p1}', '${kind}')`))[0].v
  }
  const chair = async (kind: 'market' | 'current' | 'total' = 'total') =>
    (await as<{ v: string | null }>(U.chair, `select round(material_krw_per_kg, 0)::text as v from cost_product_cost('${p1}', '${kind}')`))[0].v

  // ① 지금까지의 줄이 전부 0시 전 → 셋이 같은 값.
  const base = await sales()
  assert.ok(base.computed && base.total_krw_per_kg != null, '(가) 전제: 영업 총원가가 계산되지 않는다')
  assert.equal(await costing(), base.total_krw_per_kg, '(가): 0시 전 값만 있을 때 영업 총원가 ≠ 원가 관리 총원가')
  assert.equal(await chair(), base.total_krw_per_kg, '(가): 0시 전 값만 있을 때 영업 총원가 ≠ 대표 총원가(1원)')
  assert.equal(base.product_total, base.total_krw_per_kg, '(가): 영업 cost_product_cost(total)이 영업 화면과 다르다')

  // ② 오늘 넣는 것 — 하나씩.
  const steps: [string, () => Promise<unknown>, 'market' | 'current' | 'total'][] = [
    ['시세', () => run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name) values ('biz_dy', '${m1}', '${T}', 1700, '오늘 조사')`), 'market'],
    ['LOT', () => run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price) values ('biz_dy', '${m2}', '${s1}', '${T}', 100000, 4100)`), 'current'],
    ['BOM 판', () => run(U.chair, `select cost_bom_save('${p1}', '${T}', 90, '${JSON.stringify([{ material_id: m1, kg_per_kg: 0.6 }, { material_id: m2, kg_per_kg: 0.2 }, { material_id: m3, kg_per_kg: 0.25 }])}'::jsonb, '오늘 판')`), 'current'],
    ['비용 줄', () => run(U.cost, `insert into cost_overheads (business_id, category, basis, amount, product_id, effective_from) values ('biz_dy', 'qc', 'per_kg', 37, '${p1}', '${T}')`), 'total'],
    ['배부 기준', () => run(U.cost, `select cost_alloc_set('biz_dy', 'trailing', 7, null)`), 'total'],
    ['무효', () => run(U.buy, `update cost_purchase_lots set void_reason = '오늘 무효' where lot_id = '${big}'`), 'current'],
  ]
  let prevCost = await costing()
  let prevChair = await chair()
  for (const [what, act, kind] of steps) {
    const before = { c: await costing(kind), h: await chair(kind) }
    await act()
    assert.deepEqual(await sales(), base, `(가): 오늘 넣은 ${what}가 영업 값(총액 · Market · Current · 제시가 확인 · 목록 · 원료비 영향)에 바로 반영됐다`)
    const after = { c: await costing(kind), h: await chair(kind) }
    if (what === '배부 기준') {
      // 배부 창을 바꿔도 총원가가 같을 수 있다(생산이 창 안에 몰려 있으면) — 영업 불변만 단언한다(위).
      continue
    }
    assert.notEqual(after.c, before.c, `(가) 전제: 오늘 넣은 ${what}가 원가 관리 ${kind} 값을 바꾸지 않는다(시험이 아무것도 재지 않는다)`)
    assert.notEqual(after.h, before.h, `(가): 오늘 넣은 ${what}가 대표 값에 바로 반영되지 않는다`)
  }
  // 리뷰 I — 오늘 만든 원료(사용 중 · 단가 없음)가 영업의 회사 전체 «계산 안 됨»을 바로 켜지 않는다.
  const { nm } = (await run(U.buy, `insert into cost_materials (business_id, name) values ('biz_dy', '오늘 원료(가짜)') returning material_id as nm`))[0] as { nm: string }
  assert.deepEqual(await sales(), base, '(가): 오늘 만든 원료가 영업 값(계산 여부)을 바로 바꿨다')
  await run(U.buy, `update cost_materials set active = false where material_id = '${nm}'`)
  const nowCost = await costing()
  assert.notEqual(nowCost, prevCost, '(가) 전제: 오늘 넣은 것들이 원가 관리 총원가를 바꾸지 않았다')
  assert.notEqual(await chair(), prevChair, '(가): 대표 총원가가 즉시 바뀌지 않는다')
  prevCost = nowCost
  prevChair = (await chair())!
  // 영업 감사 줄의 as_of는 오늘(기준일) — 0시 기준은 «저장 시각»의 거르기이지 날짜를 바꾸지 않는다.
  const audit = await owner<{ n: number }>(`select count(*)::int as n from audit_log where actor_user_id = '${U.sales}' and action = 'read' and entity_table = 'cost_products'`)
  assert.ok(audit[0].n > 0, '(가): 영업 원가 조회 감사가 남지 않는다')

  // ③ 내일 — 오늘 줄을 하루 앞으로. 영업 = 원가 관리.
  await db.exec(shiftKnown(1, true))
  const tomorrow = await sales()
  assert.equal(tomorrow.total_krw_per_kg, prevCost, '(가): «내일» 영업 총원가가 원가 관리 총원가(오늘 넣은 것 포함)와 다르다')
  assert.equal(await chair(), tomorrow.total_krw_per_kg, '(가): «내일» 영업 총원가가 대표 총원가(1원)와 다르다')
  assert.notEqual(tomorrow.total_krw_per_kg, base.total_krw_per_kg, '(가): «내일»에도 영업 총원가가 어제 값 그대로다')
  await db.exec(PIN_SALES_IMMEDIATE)
}
