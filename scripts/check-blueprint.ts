/**
 * 청사진 뼈대(0081) 검사 — npm run check:blueprint
 *
 * PGlite에 0001~0081을 올리고(Supabase 함수 기본 권한 흉내 · Vault 흉내 — check-cost-engine.ts와 같은 하네스) 역할별로 잰다.
 *   1. Forecast가 월별 손익(0075)에 안 섞임 — 0081 본문 정적 · 월별 손익 함수 정의가 0081 전후 같음 · 전망 넣기 전후 월별 손익 같은 결과
 *   2. 구매 성과 — USD 2.00/kg × 1,000kg · 환율 1,400 · 그달 평균 1,380 · 그날 시장가 2,900 → 구매가 2,800 · 절감 100,000 · 환율 효과 40,000(1원 일치)
 *   3. 마진 분해 — 효과 합 = 전체(대표 원래 값 · 원가 관리 1원)
 *   4. 영업에게 마진 · 원료 노출 0
 *   5. 생산 — 남의 오더 거부 · 본인 오더 원료 이름 가림 · 원료 id · 비율 없음 · BOM 함수 거부
 *   6. BOM 넣기 대표만(0063 재확인)
 *   7. 제품 진단 카드 집합(대표 11 · 원가 관리 10 · 영업 4)
 *   8. 스위치 — 기본 대표만(원가 관리 = feature_off) → 'all'로 연 뒤 역할 시험
 *   9. 정적 — raise notice 없음 · anon grant 없음 · 정책은 to authenticated · AI 코드에 새 함수 이름 없음
 *   + Forecast 손계산(섞기 50% · 100%) · 권한 카탈로그
 * PGlite는 연결 하나 — 질의는 늘 차례로(Promise.all 금지). 원료 이름 · 값은 전부 가짜.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

import { applyOne, MIGRATIONS, SUPABASE_STUBS } from './pglite'
import { PIN_SALES_IMMEDIATE } from './cost-engine-known'

const U = {
  chair: '00000000-0000-0000-0000-0000000081a1',
  buy: '00000000-0000-0000-0000-0000000081a2', // 구매 입력
  prod: '00000000-0000-0000-0000-0000000081a3', // 생산 입력 — 오더 담당
  prod2: '00000000-0000-0000-0000-0000000081a4', // 생산 입력 — 다른 담당
  sales: '00000000-0000-0000-0000-0000000081a5', // 영업
  sales2: '00000000-0000-0000-0000-0000000081a6', // 영업(다른 사람)
  cost: '00000000-0000-0000-0000-0000000081a7', // 원가 관리(쓰기)
  cfo: '00000000-0000-0000-0000-0000000081a8', // GroupCFO — 원가 관리 줄 없음
  exec: '00000000-0000-0000-0000-0000000081a9', // Executive — 줄 없음
  ceo: '00000000-0000-0000-0000-0000000081aa', // BusinessCEO — 줄 없음
}
const FAKE = ['가짜원료청사진A', '가짜원료청사진B']
const KEYS = ['cost_forecast', 'purchase_performance', 'customer_profit', 'margin_bridge', 'competitor_price', 'work_orders', 'product_diagnosis']
const RPCS = ['cost_outlook_set', 'cost_outlook_list', 'cost_forecast_setting_set', 'cost_forecast_setting', 'cost_forecast_list', 'purchase_performance',
  'customer_profit', 'customer_profit_watch', 'margin_bridge', 'competitor_assumption_set', 'competitor_assumption_list', 'competitor_price',
  'work_order_set', 'work_order_get', 'work_order_mine', 'product_diagnosis', 'product_trend']

let passed = 0
let failed = 0
async function group(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    passed++
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function main() {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } })
  await db.exec(SUPABASE_STUBS + '\n alter default privileges in schema public grant all on functions to anon, authenticated;')
  await db.exec(`
    create extension if not exists pgcrypto with schema extensions;
    create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text not null, created_at timestamptz not null default now());
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, created_at from vault.secrets;
    revoke all on schema vault from public;
    insert into vault.secrets (name, secret) values ('cost_bom_key', encode(extensions.gen_random_bytes(32), 'base64'));
  `)
  const owner = async <T,>(sql: string) => (await db.query<T>(sql)).rows
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  const F81 = '0081_blueprint_skeleton.sql'
  assert.ok(files.includes(F81), '0081이 없다')
  const plDefs = () => owner<{ f: string; h: string }>(`select p.oid::regprocedure::text as f, md5(p.prosrc || coalesce(array_to_string(p.proconfig, ','), '')) as h
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fin\\_pl%' order by 1`)
  let plBefore: { f: string; h: string }[] = []
  for (const f of files) {
    if (f === F81) plBefore = await plDefs()
    await applyOne(db, f)
  }
  const plAfter = await plDefs()
  await db.exec(PIN_SALES_IMMEDIATE) // 영업도 즉시(0시 기준은 check:cost-engine ⑫가 잰다)

  const [{ t: T, tm: TM, pm: PM, nm: NM, nm2: NM2 }] = await owner<{ t: string; tm: string; pm: string; nm: string; nm2: string }>(`
    select cost_today()::text as t, date_trunc('month', cost_today()::timestamp)::date::text as tm,
           (date_trunc('month', cost_today()::timestamp) - interval '1 month')::date::text as pm,
           (date_trunc('month', cost_today()::timestamp) + interval '1 month')::date::text as nm,
           (date_trunc('month', cost_today()::timestamp) + interval '2 month')::date::text as nm2`)
  const d = async (expr: string) => (await owner<{ v: string }>(`select (${expr})::date::text as v`))[0].v
  const D = await d(`'${PM}'::date + 4`) // 구매 LOT · 그날 시장가
  const PA = await d(`'${PM}'::date + 10`) // 기간 A 판매
  const TM1 = await d(`'${TM}'::date - 1`)

  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    insert into auth.users (id, email) values ${Object.values(U).map((u) => `('${u}', '${u.slice(-4)}@x')`).join(', ')};
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${U.chair}', 'Chairman', '대표', 'Vault'), ('${U.buy}', 'Member', '구매', 'Normal'), ('${U.prod}', 'Member', '생산1', 'Normal'),
      ('${U.prod2}', 'Member', '생산2', 'Normal'), ('${U.sales}', 'Member', '영업1', 'Normal'), ('${U.sales2}', 'Member', '영업2', 'Normal'),
      ('${U.cost}', 'Member', '경영지원', 'Normal'), ('${U.cfo}', 'GroupCFO', 'cfo', 'Restricted'), ('${U.exec}', 'Executive', '임원', 'Restricted'),
      ('${U.ceo}', 'BusinessCEO', '회사 대표', 'Restricted');
    insert into user_business_access values
      ('${U.buy}', 'biz_dy'), ('${U.prod}', 'biz_dy'), ('${U.prod2}', 'biz_dy'), ('${U.sales}', 'biz_dy'), ('${U.sales2}', 'biz_dy'),
      ('${U.cost}', 'biz_dy'), ('${U.exec}', 'biz_dy'), ('${U.ceo}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values
      ('${U.buy}', '/purchasing/biz_dy', true, false), ('${U.prod}', '/production/biz_dy', true, false), ('${U.prod2}', '/production/biz_dy', true, false),
      ('${U.sales}', '/sales/biz_dy', true, false), ('${U.sales2}', '/sales/biz_dy', true, false), ('${U.cost}', '/costing/biz_dy', true, false);
    insert into fx_rates (rate_date, base, quote, rate, source_name, source, fetched_at) values
      ('${PM}'::date + 1, 'USD', 'KRW', 1370, 'test', 'manual', now()), ('${PM}'::date + 2, 'USD', 'KRW', 1390, 'test', 'manual', now());
  `)

  const as = async <T,>(uid: string | null, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true); set local role ${uid ? 'authenticated' : 'anon'};`)
    try {
      const rows = (await db.query<T>(sql)).rows
      await db.exec('commit')
      return rows
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  const one = async <T,>(uid: string, sql: string) => ((await as<T>(uid, sql)) as T[])[0]
  const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)

  // ── 자료: 원료 둘 · 공급처 · 시장가 · LOT(USD · KRW · 이번 달) · 제품 · BOM · 비용 · 오더 · 생산 · 판매 ──
  const { m1 } = await one<{ m1: string }>(U.buy, `insert into cost_materials (business_id, name) values ('biz_dy', '${FAKE[0]}') returning material_id as m1`)
  const { m2 } = await one<{ m2: string }>(U.buy, `insert into cost_materials (business_id, name) values ('biz_dy', '${FAKE[1]}') returning material_id as m2`)
  const { s1 } = await one<{ s1: string }>(U.buy, `insert into cost_suppliers (business_id, name) values ('biz_dy', '가짜공급처') returning supplier_id as s1`)
  await as(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name) values
    ('biz_dy', '${m1}', '${D}', 2900, '조사'), ('biz_dy', '${m2}', '${D}', 1100, '조사')`)
  const { usdLot } = await one<{ usdLot: string }>(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, currency, fx_rate)
    values ('biz_dy', '${m1}', '${s1}', '${D}', 1000, 2, 'USD', 1400) returning lot_id as "usdLot"`)
  const { krwLot } = await one<{ krwLot: string }>(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price)
    values ('biz_dy', '${m2}', '${s1}', '${D}', 1000, 1000) returning lot_id as "krwLot"`)
  await as(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price) values ('biz_dy', '${m1}', '${s1}', '${TM}', 1000, 3500)`)
  const { p1 } = await one<{ p1: string }>(U.cost, `insert into cost_products (business_id, name) values ('biz_dy', '가짜제품 청사진') returning product_id as p1`)
  await as(U.chair, `select cost_bom_save('${p1}', '${PM}'::date - 60, 100, '${JSON.stringify([{ material_id: m1, kg_per_kg: 0.5 }, { material_id: m2, kg_per_kg: 0.5 }])}'::jsonb, '가짜 BOM')`)
  await as(U.cost, `insert into cost_overheads (business_id, category, basis, amount, effective_from) values
    ('biz_dy', 'labor', 'per_kg', 100, '${PM}'::date - 30), ('biz_dy', 'logistics', 'per_kg', 50, '${PM}'::date - 30),
    ('biz_dy', 'packaging', 'per_kg', 20, '${PM}'::date - 30), ('biz_dy', 'labor', 'per_kg', 130, '${TM}')`)
  const { o1 } = await one<{ o1: string }>(U.chair, `select cost_production_issue('${p1}', '${TM}', 1000) as o1`)
  const { o2 } = await one<{ o2: string }>(U.chair, `select cost_production_issue('${p1}', '${TM}', 500) as o2`)
  const { o3 } = await one<{ o3: string }>(U.chair, `select cost_production_issue('${p1}', '${TM}', 300) as o3`)
  const { pl1 } = await one<{ pl1: string }>(U.prod, `insert into cost_prod_lots (business_id, order_id, produced_on, output_kg) values ('biz_dy', '${o1}', '${TM}', 200) returning prod_lot_id as pl1`)
  await as(U.prod, `insert into cost_prod_inputs (business_id, prod_lot_id, lot_id, qty_kg) values ('biz_dy', '${pl1}', '${krwLot}', 100)`)

  // ── 8. 스위치 — 기본 대표만 ──
  await group('8. 스위치: 0081 기본 줄 일곱(대표만) · 원가 관리 = feature_off · 대표는 열림 → all로 연다', async () => {
    const rows = await owner<{ k: string; a: string; e: boolean }>(`select feature_key as k, audience as a, enabled as e from feature_switches where business_id is null and feature_key in (${KEYS.map((k) => `'${k}'`).join(', ')}) order by 1`)
    assert.deepEqual(rows.map((r) => [r.k, r.a, r.e]), [...KEYS].sort().map((k) => [k, 'chairman', true]), '기본 줄 일곱이 아니다')
    await refuses(as(U.cost, `select * from cost_forecast_list('biz_dy')`), /feature_off/, '원가 관리가 기본(대표만) Forecast를 불렀다')
    await refuses(as(U.cost, `select margin_bridge('biz_dy', '${PM}', '${TM1}', '${TM}', '${T}')`), /feature_off/, '원가 관리가 기본 분해를 불렀다')
    await refuses(as(U.sales, `select * from competitor_price('${p1}')`), /feature_off/, '영업이 기본 경쟁사를 불렀다')
    await refuses(as(U.prod, `select work_order_get('${o1}')`), /feature_off/, '생산이 기본 작업지시를 불렀다')
    await refuses(as(U.buy, `select * from purchase_performance('biz_dy', '${PM}', '${T}', 'lot')`), /feature_off/, '구매가 기본 구매 성과를 불렀다')
    assert.ok((await as(U.chair, `select * from cost_forecast_list('biz_dy')`)).length === 1, '대표 Forecast 목록')
    for (const k of KEYS) await as(U.chair, `select feature_switch_set('${k}', null, true, 'all', '0081 시험')`)
  })

  // ── 1. 월별 손익과 안 섞임 ──
  await group('1. Forecast · 구매이익 · 경쟁사가 월별 손익에 안 섞임(정적 · 함수 정의 전후 · 결과 전후)', async () => {
    const sql = readFileSync(join(MIGRATIONS, F81), 'utf8')
    assert.ok(!/fin_pl/i.test(sql), '0081 본문에 fin_pl이 있다')
    assert.ok(plBefore.length > 5, '월별 손익 함수를 못 찾았다(시험이 아무것도 재지 않는다)')
    assert.deepEqual(plAfter, plBefore, '0081 전후로 월별 손익 함수 정의가 바뀌었다')
    const pl = async () => {
      try {
        return JSON.stringify((await as<{ v: unknown }>(U.chair, `select fin_pl_month('biz_dy', '${TM.slice(0, 7)}') as v`))[0].v)
      } catch (e) {
        return `오류: ${(e as Error).message}`
      }
    }
    const before = await pl()
    await as(U.buy, `select cost_outlook_set('${m1}', '${NM}', 4000, 'KRW', null, '다음 달 전망')`)
    await as(U.chair, `select competitor_assumption_set('biz_dy', null, 90, 40, 10, '회사 기본')`)
    assert.equal(await pl(), before, '전망 · 경쟁사 가정을 넣은 뒤 월별 손익 결과가 달라졌다')
  })

  // ── Forecast 손계산 ──
  await group('①. Forecast — 전망 교체 · USD 전망 환산 · 섞기 50%(2,400 · 2,600) · 100%(2,250) · 원가 관리 1원 · 권한', async () => {
    await as(U.buy, `select cost_outlook_set('${m1}', '${NM}', 4000, 'KRW', null, '다시')`)
    await as(U.buy, `select cost_outlook_set('${m2}', '${NM2}', 1, 'USD', null, '두 달 뒤')`)
    const list = await as<{ material_id: string; month: string; price_krw_per_kg: string; material_name: string }>(U.buy, `select material_id, month::text, price_krw_per_kg::text, material_name from cost_outlook_list('biz_dy')`)
    assert.equal(list.filter((r) => r.material_id === m1).length, 1, '같은 원료 · 달 전망이 둘 살아 있다(무효 + 새 줄이어야)')
    assert.equal(Number(list.find((r) => r.material_id === m2)!.price_krw_per_kg), 1390, 'USD 전망 원화 환산(그 달 1일 이하 최신 환율)')
    assert.equal((await owner<{ n: number }>(`select count(*)::int as n from cost_market_outlook where material_id = '${m1}' and voided_at is not null`))[0].n, 1, '교체된 전망이 무효로 남지 않는다')
    for (const uid of [U.sales, U.cost, U.prod]) await refuses(as(uid, `select cost_outlook_set('${m1}', '${NM}', 1, 'KRW', null, '')`), /cost_not_found/, `${uid.slice(-2)}가 전망을 넣었다`)
    await refuses(as(U.sales, `select * from cost_outlook_list('biz_dy')`), /cost_not_found/, '영업이 전망 목록을 봤다')
    await refuses(as(U.buy, `select cost_outlook_set('${m1}', '${TM}'::date + 3, 1, 'KRW', null, '')`), /cost_invalid/, '달 1일이 아닌 전망')
    await refuses(as(U.buy, `select cost_outlook_set('${m1}', '${NM}', 1, 'EUR', null, '')`), /cost_invalid/, '환율 없는 통화 전망')
    const audit = await owner<{ a: string; t: string }>(`select after::text as a, entity_table as t from audit_log where entity_id like 'outlook:%' order by id desc limit 1`)
    assert.equal(audit[0].t, 'cost_market_prices', '전망 감사 줄이 좁힌 감사 이름이 아니다')
    assert.ok(!audit[0].a.includes('4000') && !audit[0].a.includes(m1), '전망 감사 줄에 값 · 원료 id')

    type FL = { product_id: string; forecast_material_krw_per_kg: string; forecast_total_krw_per_kg: string; computed: boolean; reason: string | null }
    const ch = (await as<FL>(U.chair, `select * from cost_forecast_list('biz_dy')`)).find((r) => r.product_id === p1)!
    assert.equal(Number(ch.forecast_material_krw_per_kg), 2400, '대표 Forecast 원료비(0.5 × (3500+4000)/2 + 0.5 × (1000+1100)/2)')
    assert.equal(Number(ch.forecast_total_krw_per_kg), 2600, '대표 Forecast 총원가(+ 제조 130 · 물류 50 · 포장 20)')
    const co = (await as<FL>(U.cost, `select * from cost_forecast_list('biz_dy')`)).find((r) => r.product_id === p1)!
    assert.deepEqual([co.forecast_material_krw_per_kg, co.forecast_total_krw_per_kg, co.computed], ['2400', '2600', true], '원가 관리 Forecast(1원)')
    for (const uid of [U.sales, U.buy, U.prod, U.cfo, U.exec]) await refuses(as(uid, `select * from cost_forecast_list('biz_dy')`), /cost_not_found/, `${uid.slice(-2)}가 Forecast를 봤다`)
    await refuses(as(U.cost, `select cost_forecast_setting_set('biz_dy', 100, 'today', '{}'::jsonb)`), /cost_not_found/, '원가 관리가 Forecast 설정을 바꿨다')
    await refuses(as(U.chair, `select cost_forecast_setting_set('biz_dy', 100, 'manual', '{"usd": 1}'::jsonb)`), /cost_invalid/, '잘못된 수동 환율')
    await as(U.chair, `select cost_forecast_setting_set('biz_dy', 100, 'today', '{}'::jsonb)`)
    const ch100 = (await as<FL>(U.chair, `select * from cost_forecast_list('biz_dy')`)).find((r) => r.product_id === p1)!
    assert.equal(Number(ch100.forecast_material_krw_per_kg), 2250, '섞기 100%(구매가만)')
    const st = await one<{ blend_purchase_pct: string; is_default: boolean }>(U.cost, `select * from cost_forecast_setting('biz_dy')`)
    assert.deepEqual([Number(st.blend_purchase_pct), st.is_default], [100, false], '원가 관리가 설정을 못 읽는다')
    await as(U.chair, `select cost_forecast_setting_set('biz_dy', 50, 'today', '{}'::jsonb)`)
  })

  // ── 2. 구매 성과 ──
  await group('2. 구매 성과 — 구매가 2,800 · 절감 100,000 · 환율 효과 40,000(1원 일치) · 묶음별 권한 · 감사', async () => {
    type PP = { key: string; label: string; n_lots: number; qty_kg: string; purchase_krw: string; market_krw: string; savings_krw: string; fx_effect_krw: string; n_no_market: number }
    const lots = await as<PP>(U.buy, `select * from purchase_performance('biz_dy', '${PM}', '${T}', 'lot')`)
    const u = lots.find((r) => r.key === usdLot)!
    assert.ok(u, 'USD LOT 줄이 없다')
    assert.equal(Number(u.purchase_krw) / Number(u.qty_kg), 2800, '구매 단가(물건값 원/kg)')
    assert.equal(Number(u.purchase_krw), 2_800_000, '구매 금액')
    assert.equal(Number(u.market_krw), 2_900_000, '그날 시장가 × kg')
    assert.equal(Number(u.savings_krw), 100_000, '절감액 = (2,900 − 2,800) × 1,000')
    assert.equal(Number(u.fx_effect_krw), 40_000, '환율 효과 = (1,400 − 1,380) × 2,000')
    const k = lots.find((r) => r.key === krwLot)!
    assert.deepEqual([Number(k.savings_krw), Number(k.fx_effect_krw)], [100_000, 0], 'KRW LOT 절감 · 환율 효과 0')
    const tmLot = lots.find((r) => r.key !== usdLot && r.key !== krwLot)!
    assert.deepEqual([tmLot.n_no_market, tmLot.savings_krw], [0, String(Number(tmLot.market_krw) - Number(tmLot.purchase_krw))], '이번 달 LOT(그 이전 최신 시장가)')
    const mon = await as<PP>(U.buy, `select * from purchase_performance('biz_dy', '${PM}', '${T}', 'month')`)
    assert.equal(Number(mon.find((r) => r.key === PM.slice(0, 7))!.savings_krw), 200_000, '월 묶음 = 원래 값끼리 더한 합')
    for (const by of ['lot', 'material', 'supplier', 'month']) {
      for (const uid of [U.chair, U.buy, U.cost, U.cfo]) assert.ok((await as(uid, `select * from purchase_performance('biz_dy', '${PM}', '${T}', '${by}')`)).length > 0, `${uid.slice(-2)} · ${by}`)
    }
    for (const uid of [U.exec, U.ceo]) {
      assert.ok((await as(uid, `select * from purchase_performance('biz_dy', '${PM}', '${T}', 'month')`)).length > 0, `임원 이상 월 묶음(${uid.slice(-2)})`)
      for (const by of ['lot', 'material', 'supplier']) await refuses(as(uid, `select * from purchase_performance('biz_dy', '${PM}', '${T}', '${by}')`), /cost_not_found/, `임원 이상이 ${by} 묶음을 봤다`)
    }
    for (const uid of [U.sales, U.prod]) await refuses(as(uid, `select * from purchase_performance('biz_dy', '${PM}', '${T}', 'month')`), /cost_not_found/, `${uid.slice(-2)}가 구매 성과를 봤다`)
    await refuses(as(U.buy, `select * from purchase_performance('biz_dy', '${PM}', '${T}', 'year')`), /cost_invalid/, '모르는 묶음')
    const au = await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'cost_purchase_lots' and entity_id = 'performance:biz_dy' and actor_user_id = '${U.exec}'`)
    assert.ok(au[0].n >= 1, '대표 외 구매 성과 조회 감사가 없다')
    const ac = await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_id = 'performance:biz_dy' and actor_user_id = '${U.chair}'`)
    assert.equal(ac[0].n, 0, '대표 조회도 감사한다(설계: 대표 외만)')
  })

  // ── 판매(기간 A = 지난달 · B = 이번 달) ──
  await as(U.sales, `select sale_record('${p1}', '${PA}', '김', 'A사', 100, 6000, 'KRW')`)
  await as(U.sales, `select sale_record('${p1}', '${TM}', '김', 'A사', 200, 6200, 'KRW')`)
  await as(U.sales2, `select sale_record('${p1}', '${TM}', '이', 'B사', 50, 6100, 'KRW')`)

  // ── 3. 분해 합 = 전체 ──
  await group('3. 마진 분해 — 효과 합 = 전체(대표 원래 값 · 원가 관리 1원) · 제조 효과 −30 · 대표만 원료별', async () => {
    const q = (uid: string, prod = 'null') => one<{ r: Record<string, any>; s: string; t: string }>(uid, `select r, ((r->'effects'->>'price')::numeric + (r->'effects'->>'material')::numeric
        + (r->'effects'->>'mfg')::numeric + (r->'effects'->>'logi')::numeric + (r->'effects'->>'other')::numeric)::text as s, (r->>'total') as t
      from (select margin_bridge('biz_dy', '${PM}', '${TM1}', '${TM}', '${T}', ${prod}) as r) x`)
    const ch = await q(U.chair)
    assert.ok(ch.t !== null && ch.r.reason === null, `분해가 계산되지 않았다 — ${JSON.stringify(ch.r)}`)
    assert.equal(Number(ch.s), Number(ch.t), '대표: 효과 합 ≠ 전체')
    const exact = await one<{ ok: boolean }>(U.chair, `select ((r->'effects'->>'price')::numeric + (r->'effects'->>'material')::numeric + (r->'effects'->>'mfg')::numeric
        + (r->'effects'->>'logi')::numeric + (r->'effects'->>'other')::numeric) = (r->>'total')::numeric as ok
      from (select margin_bridge('biz_dy', '${PM}', '${TM1}', '${TM}', '${T}') as r) x`)
    assert.equal(exact.ok, true, '대표: 효과 합이 전체와 정확히 같지 않다(numeric)')
    assert.equal(Number(ch.r.effects.mfg), -30, '제조 효과(100 → 130원/kg)')
    assert.equal(ch.r.materials, null, '제품 미지정인데 원료별이 있다')
    const co = await q(U.cost)
    assert.equal(Number(co.s), Number(co.t), '원가 관리: 효과 합 ≠ 전체(1원)')
    assert.equal(Number(co.t), Math.round(Number(ch.t)), '원가 관리 전체 = 대표 전체 1원')
    for (const v of Object.values(co.r.effects)) assert.ok(Number.isInteger(Number(v)), '원가 관리 효과에 1원 아래')
    for (const side of ['a', 'b']) for (const k of ['price', 'material', 'mfg', 'logi', 'other', 'gm']) assert.ok(Number.isInteger(Number(co.r[side][k])), `원가 관리 ${side}.${k} 1원`)
    const chp = await q(U.chair, `'${p1}'`)
    assert.ok(Array.isArray(chp.r.materials) && chp.r.materials.length === 2 && FAKE.includes(chp.r.materials[0].material_name), '대표 원료별 기여')
    const cop = await q(U.cost, `'${p1}'`)
    assert.equal(cop.r.materials, null, '원가 관리에게 원료별이 갔다')
    assert.ok(!FAKE.some((n) => JSON.stringify(cop.r).includes(n)) && !JSON.stringify(cop.r).includes(m1), '원가 관리 분해에 원료 이름 · id')
    const none = await one<{ r: Record<string, unknown> }>(U.chair, `select margin_bridge('biz_dy', '2020-01-01', '2020-01-31', '${TM}', '${T}') as r`)
    assert.ok(none.r.total === null && String(none.r.reason).includes('자료 없음'), '자료 없는 기간의 이유')
    await refuses(as(U.chair, `select margin_bridge('biz_dy', '${TM}', '${PM}', '${TM}', '${T}')`), /cost_invalid/, '거꾸로 된 기간')
    await refuses(as(U.chair, `select margin_bridge('biz_dy', '${PM}', '${TM1}', '${TM}', '${T}', 'prd_nope_nope')`), /cost_not_found/, '없는 제품')
  })

  // ── 4. 영업 노출 0 ──
  await group('4. 영업에게 마진 · 원료 노출 0 — 고객별 본인 판매 · gm null · 경쟁사 결과 칸만 · 나머지 cost_not_found', async () => {
    type CP = { customer: string; n_sales: number; gm_krw: string | null; cogs_krw: string | null; gm_pct: string | null; basis: string | null; grade: string | null }
    const s = await as<CP>(U.sales, `select * from customer_profit('biz_dy', '${PM}', '${T}')`)
    assert.deepEqual(s.map((r) => [r.customer, r.n_sales]), [['A사', 2]], '영업 고객별에 남의 판매가 섞였다')
    assert.ok(s.every((r) => r.gm_krw === null && r.cogs_krw === null && r.gm_pct === null && r.basis === null), '영업 고객별에 원가 · 마진 칸')
    const c = await as<CP>(U.chair, `select * from customer_profit('biz_dy', '${PM}', '${T}')`)
    assert.deepEqual(c.map((r) => r.customer).sort(), ['A사', 'B사'], '대표 고객별')
    assert.ok(c.every((r) => r.gm_krw !== null && r.basis !== null), `대표 고객별 원가가 계산되지 않았다 ${JSON.stringify(c)}`)
    const k = await as<CP>(U.cost, `select * from customer_profit('biz_dy', '${PM}', '${T}')`)
    assert.ok(k.every((r) => Number.isInteger(Number(r.gm_krw))), '원가 관리 고객별 1원')
    await refuses(as(U.cfo, `select * from customer_profit('biz_dy', '${PM}', '${T}')`), /cost_not_found/, 'CFO(원가 관리 줄 없음)가 고객별 수익성을 봤다(결정 8)')
    const w = await as<{ kind: string }>(U.cost, `select * from customer_profit_watch('biz_dy', '${PM}', '${T}')`)
    assert.ok(w.some((r) => r.kind === 'customer') && w.some((r) => r.kind === 'product'), '«매출 큰데 마진 낮은» 고객 · 제품')
    await refuses(as(U.sales, `select * from customer_profit_watch('biz_dy', '${PM}', '${T}')`), /cost_not_found/, '영업이 watch를 봤다')
    const cp = await as<Record<string, unknown>>(U.sales, `select * from competitor_price('${p1}')`)
    assert.deepEqual(Object.keys(cp[0]).sort(), ['competitor_min_krw_per_kg', 'computed', 'grade_at_competitor', 'our_margin_at_competitor_pct', 'our_target_krw_per_kg', 'product_id'],
      '영업 경쟁사 칸')
    assert.equal(cp[0].computed, true, '영업 경쟁사가 계산되지 않았다')
    assert.ok(Number.isInteger(Number(cp[0].competitor_min_krw_per_kg)), '영업 경쟁사 최소가 1원')
    const cpc = await one<{ competitor_min_krw_per_kg: string; our_target_krw_per_kg: string }>(U.chair, `select * from competitor_price('${p1}')`)
    // 경쟁사 = (Market 원료비 0.5×2900 + 0.5×1100 = 2000) + 제조 90 + 물류 40 = 2130 → ÷ 0.9. 우리 총원가 = Current + 200.
    assert.ok(Math.abs(Number(cpc.competitor_min_krw_per_kg) - 2130 / 0.9) < 1e-9, `대표 경쟁사 최소가 ${cpc.competitor_min_krw_per_kg}`)
    await refuses(as(U.sales, `select * from competitor_assumption_list('biz_dy')`), /cost_not_found/, '영업이 경쟁사 가정을 봤다')
    await refuses(as(U.sales, `select competitor_assumption_set('biz_dy', null, 1, 1, 1, '')`), /cost_not_found/, '영업이 경쟁사 가정을 넣었다')
    await refuses(as(U.buy, `select * from competitor_price('${p1}')`), /cost_not_found/, '구매가 경쟁사를 봤다')
    for (const sql of [`select margin_bridge('biz_dy', '${PM}', '${TM1}', '${TM}', '${T}')`, `select * from purchase_performance('biz_dy', '${PM}', '${T}', 'month')`,
      `select * from cost_forecast_list('biz_dy')`, `select * from product_trend('${p1}', 'month', '${PM}', '${T}')`]) {
      await refuses(as(U.sales, sql), /cost_not_found/, `영업이 부른다 — ${sql}`)
    }
    const dg = await one<{ v: { cards: { id: number }[] } }>(U.sales, `select product_diagnosis('${p1}') as v`)
    assert.deepEqual(dg.v.cards.map((x) => x.id), [5, 6, 7, 8], '영업 진단 카드')
    const all = JSON.stringify([s, cp, dg])
    for (const n of FAKE) assert.ok(!all.includes(n), '영업 출력에 원료 이름')
    assert.ok(!all.includes(m1) && !all.includes(m2), '영업 출력에 원료 id')
    const top = (dg.v.cards.find((x) => x.id === 8) as unknown as { value: { customers: { customer: string }[] } }).value.customers
    assert.deepEqual(top.map((x) => x.customer), ['A사'], '영업 진단 상위 고객에 남의 판매')
  })

  // ── 5. 생산 ──
  await group('5. 작업지시 — 남의 오더 · 담당 없는 오더 거부 · 본인 오더 원료 이름 가림 · id · 비율 없음 · BOM 함수 거부', async () => {
    await as(U.chair, `select work_order_set('${o1}', 'T-1', 1, '${U.prod}', true)`)
    await as(U.chair, `select work_order_set('${o2}', 'T-2', 2, '${U.prod2}', true)`)
    await refuses(as(U.prod, `select work_order_set('${o1}', 'T-9', 9, '${U.prod}', false)`), /cost_not_found/, '생산이 작업지시를 바꿨다')
    await refuses(as(U.prod, `select work_order_get('${o2}')`), /cost_not_found/, '남의 오더')
    await refuses(as(U.prod, `select work_order_get('${o3}')`), /cost_not_found/, '담당 없는 오더')
    await refuses(as(U.cost, `select work_order_get('${o1}')`), /cost_not_found/, '원가 관리가 작업지시를 봤다')
    await refuses(as(U.prod, `select work_order_get('PO-20990101-ABCDEF')`), /cost_not_found/, '없는 오더')
    const w = (await one<{ v: Record<string, any> }>(U.prod, `select work_order_get('${o1}') as v`)).v
    assert.deepEqual(Object.keys(w).sort(), ['hide_names', 'inputs', 'lines', 'order_id', 'planned_kg', 'planned_on', 'product_name', 'seq', 'status', 'tank'], '머리 칸')
    assert.equal(w.lines.length, 2, '줄 둘')
    for (const l of w.lines) {
      assert.deepEqual(Object.keys(l).sort(), ['batch_kg', 'code', 'material_name'], '줄 칸(원료 id · 비율 · 단가 없음)')
      assert.equal(l.material_name, null, '이름 가림 기본인데 원료 이름이 보인다')
      assert.match(l.code, /^R-[0-9A-F]{6}$/, '원료 코드 모양')
    }
    assert.deepEqual(Object.keys(w.inputs[0]).sort(), ['code', 'created_at', 'prod_lot_id', 'qty_kg'], '투입 칸')
    const txt = JSON.stringify(w)
    assert.ok(!txt.includes(m1) && !txt.includes(m2) && !FAKE.some((n) => txt.includes(n)) && !/kg_per_kg|yield/.test(txt), '작업지시에 원료 id · 이름 · 비율')
    const cw = (await one<{ v: Record<string, any> }>(U.chair, `select work_order_get('${o1}') as v`)).v
    assert.ok(cw.lines.every((l: { material_name: string }) => FAKE.includes(l.material_name)), '대표는 늘 원료 이름을 본다')
    await as(U.chair, `select work_order_set('${o1}', 'T-1', 1, '${U.prod}', false)`)
    const shown = (await one<{ v: Record<string, any> }>(U.prod, `select work_order_get('${o1}') as v`)).v
    assert.ok(shown.lines.every((l: { material_name: string }) => FAKE.includes(l.material_name)), '가림을 끈 뒤 원료 이름')
    const mine = await as<{ order_id: string }>(U.prod, `select * from work_order_mine('biz_dy')`)
    assert.deepEqual(mine.map((r) => r.order_id), [o1], '본인 담당 목록')
    assert.equal((await as(U.chair, `select * from work_order_mine('biz_dy')`)).length, 3, '대표 목록 = 전부')
    await refuses(as(U.sales, `select * from work_order_mine('biz_dy')`), /cost_not_found/, '영업이 작업지시 목록을 봤다')
    for (const sql of [`select * from cost_bom_get('${p1}')`, `select * from cost_product_breakdown('${p1}', 'current', '${T}')`, `select * from cost_bom_versions('biz_dy')`]) {
      await refuses(as(U.prod, sql), /cost_not_found/, `생산이 BOM을 읽었다 — ${sql}`)
    }
    const au = await owner<{ t: string }>(`select entity_table as t from audit_log where note = '작업지시(0081)' limit 1`)
    assert.equal(au[0].t, 'cost_production_orders', '작업지시 감사 이름')
  })

  // ── 6. BOM 넣기 대표만 ──
  await group('6. BOM 넣기 대표만 — cost_bom_save · cost_bom_real_allow 대표 외 거부(0063 재확인)', async () => {
    const lines = JSON.stringify([{ material_id: m1, kg_per_kg: 0.6 }, { material_id: m2, kg_per_kg: 0.4 }])
    for (const uid of [U.buy, U.prod, U.sales, U.cost, U.cfo, U.exec, U.ceo]) {
      await refuses(as(uid, `select cost_bom_save('${p1}', '${T}', 100, '${lines}'::jsonb)`), /cost_not_found/, `${uid.slice(-2)}가 BOM을 넣었다`)
      await refuses(as(uid, `select cost_bom_real_allow(true)`), /cost_not_found/, `${uid.slice(-2)}가 진짜 BOM 받기를 켰다`)
    }
  })

  // ── 7. 진단 카드 ──
  await group('7. 제품 진단 카드 — 대표 11 · 원가 관리 10(4 없음) · 영업 4 · 구매 · 생산 거부 · 추이', async () => {
    const ids = async (uid: string) => (await one<{ v: { cards: { id: number; state: string }[]; role: string } }>(uid, `select product_diagnosis('${p1}') as v`)).v
    const c = await ids(U.chair)
    assert.deepEqual(c.cards.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], '대표 카드')
    assert.equal(c.role, 'chairman')
    assert.ok(c.cards.filter((x) => x.state === 'ok').length >= 8, `대표 카드가 대부분 no_data ${JSON.stringify(c.cards)}`)
    const k = await ids(U.cost)
    assert.deepEqual(k.cards.map((x) => x.id), [1, 2, 3, 5, 6, 7, 8, 9, 10, 11], '원가 관리 카드')
    const kt = JSON.stringify(k)
    assert.ok(!FAKE.some((n) => kt.includes(n)) && !kt.includes(m1), '원가 관리 진단에 원료 이름 · id')
    assert.deepEqual((await ids(U.sales)).cards.map((x) => x.id), [5, 6, 7, 8], '영업 카드')
    for (const uid of [U.buy, U.prod]) await refuses(as(uid, `select product_diagnosis('${p1}')`), /cost_not_found/, `${uid.slice(-2)}가 진단을 봤다`)
    const tr = await as<{ period_start: string; kg: string; market_material_krw_per_kg: string | null }>(U.chair, `select period_start::text, kg::text, market_material_krw_per_kg::text from product_trend('${p1}', 'month', '${PM}', '${T}')`)
    assert.equal(tr.length, 2, '월 추이 두 점')
    assert.ok(tr.every((r) => r.market_material_krw_per_kg !== null), '대표 추이 Market 원료비')
    const trc = await as<{ period_start: string; market_material_krw_per_kg: string | null }>(U.cost, `select period_start::text, market_material_krw_per_kg::text from product_trend('${p1}', 'month', '${PM}', '${T}')`)
    assert.deepEqual(trc.map((r) => r.market_material_krw_per_kg === null), [true, false], '원가 관리 추이 Market 원료비는 오늘이 든 기간만(결정 15)')
    await refuses(as(U.chair, `select * from product_trend('${p1}', 'day', '2000-01-01', '${T}')`), /cost_invalid/, '400점 넘는 추이')
  })

  // ── 9. 정적 · 카탈로그 ──
  await group('9. 정적 — raise notice 없음 · anon grant 없음 · 정책 to authenticated · AI 코드에 새 함수 없음 · 권한 카탈로그', async () => {
    const sql = readFileSync(join(MIGRATIONS, F81), 'utf8')
    const code = sql.replace(/--[^\n]*/g, '')
    assert.ok(!/raise\s+(notice|warning|info)/i.test(code), '0081에 raise notice/warning/info')
    assert.ok(!/to\s+(anon|public)\b/i.test(code.replace(/from\s+public,\s*anon(,\s*authenticated)?/gi, '')), '0081이 anon · public에 grant한다')
    assert.ok(!/force\s+row\s+level\s+security/i.test(code), '0081이 FORCE를 건다')
    assert.ok(!/create\s+or\s+replace\s+function/i.test(code), '0081이 기존 함수를 create or replace한다')
    for (const m of code.matchAll(/create\s+policy[\s\S]*?;/gi)) assert.match(m[0], /to\s+authenticated/i, `정책이 to authenticated가 아니다 — ${m[0].slice(0, 80)}`)
    const aiRoot = join(__dirname, '..', 'src', 'lib', 'ai')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
    for (const f of walk(aiRoot)) {
      const t = readFileSync(f, 'utf8')
      for (const fn of RPCS) assert.ok(!t.includes(fn), `AI 코드(${f})가 ${fn}을 부른다`)
    }
    const anon = await owner<{ f: string }>(`select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any (array[${RPCS.map((r) => `'${r}'`).join(', ')}]) and has_function_privilege('anon', p.oid, 'execute')`)
    assert.deepEqual(anon, [], `anon이 부르는 0081 함수 — ${anon.map((r) => r.f).join(', ')}`)
    const authn = await owner<{ n: number }>(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any (array[${RPCS.map((r) => `'${r}'`).join(', ')}]) and has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef`)
    assert.equal(authn[0].n, RPCS.length, '공개 RPC 열일곱이 authenticated 정의자가 아니다')
    const secret = await owner<{ f: string }>(`select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'cost_secret' and has_function_privilege('authenticated', p.oid, 'execute')`)
    assert.deepEqual(secret, [], `authenticated가 부르는 비공개 함수 — ${secret.map((r) => r.f).join(', ')}`)
    const pinned = await owner<{ f: string }>(`select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname = 'cost_secret' or (n.nspname = 'public' and p.proname = any (array[${RPCS.map((r) => `'${r}'`).join(', ')}]))) and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%pg_temp%')`)
    assert.deepEqual(pinned, [], `search_path에 pg_temp 없는 정의자 — ${pinned.map((r) => r.f).join(', ')}`)
    for (const t of ['cost_market_outlook', 'cost_forecast_settings', 'cost_competitor_assumptions', 'cost_work_orders']) {
      const [r] = await owner<{ rls: boolean; force: boolean }>(`select relrowsecurity as rls, relforcerowsecurity as force from pg_class where relname = '${t}'`)
      assert.deepEqual([r.rls, r.force], [true, false], `${t}: RLS enable · FORCE 없음이 아니다`)
      await refuses(as(U.chair, `select * from ${t}`), /permission denied/, `대표가 ${t}를 직접 읽었다(정의자 함수만)`)
      await refuses(as(null, `select * from ${t}`), /permission denied/, `anon이 ${t}를 읽었다`)
    }
    await refuses(as(null, `select * from cost_forecast_list('biz_dy')`), /permission denied/, 'anon이 Forecast를 불렀다')
    const agent = '00000000-0000-0000-0000-0000000081ff'
    await db.exec(`insert into auth.users (id, email) values ('${agent}', 'ai@x'); insert into user_profiles (user_id, role, display_name, max_security_class) values ('${agent}', 'AIAgent', 'ai', 'Restricted');
      insert into user_business_access values ('${agent}', 'biz_dy'); insert into user_module_access (user_id, module, can_write, can_approve) values ('${agent}', '/costing/biz_dy', true, false), ('${agent}', '/purchasing/biz_dy', true, false)`)
    for (const s of [`select * from purchase_performance('biz_dy', '${PM}', '${T}', 'month')`, `select * from customer_profit('biz_dy', '${PM}', '${T}')`,
      `select product_diagnosis('${p1}')`, `select * from cost_outlook_list('biz_dy')`]) {
      await refuses(as(agent, s), /cost_not_found/, `AIAgent가 부른다 — ${s}`)
    }
  })

  await db.close()
  console.log(`${failed === 0 ? 'PASS' : 'FAIL'}: check:blueprint — ${passed} 묶음 통과 · ${failed} 실패`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
