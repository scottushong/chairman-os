/**
 * 원가 엔진(0061 · 0062) 검사 — npm run check:cost-engine
 *
 * check-migrations.ts와 따로 둔다: 브랜치끼리 합칠 때 그 파일의 시험 함수가 엇갈려 붙은 일이 있다(2026-10-08).
 * PGlite에 전 마이그레이션을 올리고(scripts/pglite.ts — Supabase 기본 GRANT 흉내 포함) 역할별로 잰다.
 *
 *   ① 권한 표(설계서 3.2)의 모든 칸 — 구매 · 생산 · 영업 · 원가 관리 · 대표 · 줄 없는 임원 · 회사 대표 · 다른 회사 · 시스템 계정 · anon
 *   ② 고치지 않는 기록(무효만) · 계산(Landed · 환율) · 위조 불가(만든 사람)
 *   ③ BOM이 대표 외에게 나가는 길 0개 — 스키마 · 표 · 뷰 · 함수 · 오류 문장 · pg_stats · execute 권한
 *   ④ 원가 함수 — 반올림 합계만 · 영업 주간 고정 · 한도 · 하루 한 줄 감사 · 이유 코드
 *   ⑤ 구매 결재 → LOT 후보 · 구매 첨부 버킷
 *   ⑥ 코드 경계 — AI 도구가 BOM 함수를 부르지 않는다
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000061a1',
  buy: '00000000-0000-0000-0000-0000000061a2', // 구매 입력(DY)
  prod: '00000000-0000-0000-0000-0000000061a3', // 생산 입력(DY)
  sales: '00000000-0000-0000-0000-0000000061a4', // 영업 견적(DY)
  cost: '00000000-0000-0000-0000-0000000061a5', // 원가 관리(DY) — 경영지원
  exec: '00000000-0000-0000-0000-0000000061a6', // 임원(DY) — 줄 없음
  ceo: '00000000-0000-0000-0000-0000000061a7', // 회사 대표(DY) — 줄 없음
  vana: '00000000-0000-0000-0000-0000000061a8', // VANA 직원 — DY 줄은 있지만 DY 접근 없음
  agent: '00000000-0000-0000-0000-0000000061a9', // AIAgent — 줄 있음
  cfo: '00000000-0000-0000-0000-0000000061aa', // GroupCFO — 줄 없음
}

const FAKE_MATERIAL_NAMES = ['가짜원료알파', '가짜원료베타', '가짜원료감마']

async function main() {
  const db = new PGlite({ extensions: { pg_trgm } })
  const files = await applyAll(db)
  assert.ok(files.includes('0061_cost_engine_base.sql') && files.includes('0062_cost_secret_bom.sql'), '0061 · 0062가 없다')

  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    insert into auth.users (id, email) values
      ('${U.chair}', 'c@x'), ('${U.buy}', 'b@x'), ('${U.prod}', 'p@x'), ('${U.sales}', 's@x'), ('${U.cost}', 'k@x'),
      ('${U.exec}', 'e@x'), ('${U.ceo}', 'o@x'), ('${U.vana}', 'v@x'), ('${U.agent}', 'a@x'), ('${U.cfo}', 'f@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${U.chair}', 'Chairman', '대표', 'Vault'), ('${U.buy}', 'Member', '구매', 'Normal'), ('${U.prod}', 'Member', '생산', 'Normal'),
      ('${U.sales}', 'Member', '영업', 'Normal'), ('${U.cost}', 'Member', '경영지원', 'Normal'), ('${U.exec}', 'Executive', '임원', 'Restricted'),
      ('${U.ceo}', 'BusinessCEO', '회사 대표', 'Restricted'), ('${U.vana}', 'Member', 'VANA', 'Normal'),
      ('${U.agent}', 'AIAgent', 'ai', 'Restricted'), ('${U.cfo}', 'GroupCFO', 'cfo', 'Restricted');
    insert into user_business_access values
      ('${U.buy}', 'biz_dy'), ('${U.prod}', 'biz_dy'), ('${U.sales}', 'biz_dy'), ('${U.cost}', 'biz_dy'),
      ('${U.exec}', 'biz_dy'), ('${U.ceo}', 'biz_dy'), ('${U.vana}', 'biz_vana'), ('${U.agent}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values
      ('${U.buy}', '/purchasing/biz_dy', true, false), ('${U.prod}', '/production/biz_dy', true, false),
      ('${U.sales}', '/sales/biz_dy', true, false), ('${U.cost}', '/costing/biz_dy', true, false),
      ('${U.vana}', '/sales/biz_dy', true, false), ('${U.vana}', '/purchasing/biz_dy', true, false),
      ('${U.agent}', '/purchasing/biz_dy', true, false), ('${U.agent}', '/sales/biz_dy', true, false), ('${U.agent}', '/costing/biz_dy', true, false);
    insert into fx_rates (rate_date, base, quote, rate, source_name, source, fetched_at)
      values ('2026-10-01', 'USD', 'KRW', 1400, 'test', 'manual', now());
  `)

  const owner = async <T,>(sql: string) => (await db.query<T>(sql)).rows
  const as = async <T,>(uid: string | null, sql: string, commit = false) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true); set local role ${uid ? 'authenticated' : 'anon'};`)
    try {
      const rows = (await db.query<T>(sql)).rows
      await db.exec(commit ? 'commit' : 'rollback')
      return rows
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  const run = (uid: string, sql: string) => as(uid, sql, true)
  const count = async (uid: string | null, table: string) => Number((await as<{ n: number }>(uid, `select count(*)::int as n from ${table}`))[0].n)
  const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)

  // ── ② 구매가 기초를 넣는다 ─────────────────────────────────────────────
  const [{ m1 }] = await run(U.buy, `insert into cost_materials (business_id, name, created_by) values ('biz_dy', '${FAKE_MATERIAL_NAMES[0]}', '${U.sales}') returning material_id as m1`) as { m1: string }[]
  const [{ m2 }] = await run(U.buy, `insert into cost_materials (business_id, name) values ('biz_dy', '${FAKE_MATERIAL_NAMES[1]}') returning material_id as m2`) as { m2: string }[]
  const [{ m3 }] = await run(U.buy, `insert into cost_materials (business_id, name) values ('biz_dy', '${FAKE_MATERIAL_NAMES[2]}') returning material_id as m3`) as { m3: string }[]
  assert.equal((await owner<{ c: string }>(`select created_by::text as c from cost_materials where material_id = '${m1}'`))[0].c, U.buy,
    '0061: 만든 사람을 남으로 위조할 수 있다')
  const [{ s1 }] = await run(U.buy, `insert into cost_suppliers (business_id, name, currency_default, contact, terms) values ('biz_dy', '가짜공급처', 'USD', '010-0000', 'FOB 30일') returning supplier_id as s1`) as { s1: string }[]
  await run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, currency, source_name, price_krw_per_kg)
    values ('biz_dy', '${m1}', '2026-10-05', 1000, 'KRW', '구매팀 조사', 1),
           ('biz_dy', '${m2}', '2026-10-05', 2, 'USD', 'Platts', 1),
           ('biz_dy', '${m3}', '2026-10-05', 500, 'KRW', '구매팀 조사', 1),
           ('biz_dy', '${m1}', '2026-10-08', 1200, 'KRW', '구매팀 조사', 1)`)
  const mp = await owner<{ p: string }>(`select price_krw_per_kg::text as p from cost_market_prices where material_id = '${m2}'`)
  assert.equal(Number(mp[0].p), 2800, '0061: 외화 시장가의 원화 환산(환율 표)이 틀렸다 — 입력한 price_krw_per_kg를 믿었다?')
  await refuses(run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, currency, source_name)
    values ('biz_dy', '${m1}', '2026-10-05', 1, 'EUR', 'x')`), /cost_fx_missing/, '0061: 환율 없는 통화가 들어간다')

  const [{ lot }] = await run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, currency,
      freight_krw, duty_krw, other_krw, landed_krw_per_kg)
    values ('biz_dy', '${m1}', '${s1}', '2026-10-06', 1000, 1, 'USD', 50000, 20000, 10000, 1) returning lot_id as lot`) as { lot: string }[]
  const landed = await owner<{ g: string; l: string }>(`select goods_krw::text as g, landed_krw_per_kg::text as l from cost_purchase_lots where lot_id = '${lot}'`)
  assert.equal(Number(landed[0].g), 1_400_000, '0061: 물품 원화 = 단가 × 수량 × 환율이 아니다')
  assert.equal(Number(landed[0].l), 1480, '0061: Landed = (물품 + 운송 + 관세 + 부대) ÷ kg이 아니다')
  await run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price) values
    ('biz_dy', '${m2}', '${s1}', '2026-10-06', 500, 3000), ('biz_dy', '${m3}', '${s1}', '2026-10-06', 100, 600), ('biz_dy', '${m1}', '${s1}', '2026-10-07', 1000, 1600)`)

  // 고치지 않는다 — 무효만.
  await refuses(run(U.buy, `update cost_purchase_lots set unit_price = 2 where lot_id = '${lot}'`), /permission denied/, '0061: LOT 단가를 고칠 수 있다')
  await refuses(run(U.buy, `update cost_market_prices set price = 1 where material_id = '${m1}'`), /permission denied/, '0061: 시장가를 고칠 수 있다')
  await refuses(run(U.buy, `delete from cost_purchase_lots where lot_id = '${lot}'`), /permission denied/, '0061: LOT를 지울 수 있다')
  await refuses(run(U.buy, `update cost_market_prices set void_reason = '' where material_id = '${m3}'`), /cost_void_reason/, '0061: 이유 없는 무효')
  await refuses(run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price) values ('biz_vana', '${m1}', '${s1}', '2026-10-06', 1, 1)`),
    /row-level security|foreign key/, '0061: 다른 회사 LOT에 DY 원료를 붙인다')

  // ── ① 권한 표 — 표 읽기 ────────────────────────────────────────────────
  const tables = ['cost_materials', 'cost_suppliers', 'cost_market_prices', 'cost_purchase_lots', 'cost_products']
  const expect: Record<string, Record<string, boolean>> = {
    //            materials suppliers market  lots   products
    [U.buy]:   { cost_materials: true, cost_suppliers: true, cost_market_prices: true, cost_purchase_lots: true, cost_products: true },
    [U.prod]:  { cost_materials: true, cost_suppliers: false, cost_market_prices: false, cost_purchase_lots: false, cost_products: true },
    [U.sales]: { cost_materials: true, cost_suppliers: false, cost_market_prices: true, cost_purchase_lots: false, cost_products: true },
    [U.cost]:  { cost_materials: true, cost_suppliers: true, cost_market_prices: true, cost_purchase_lots: true, cost_products: true },
    [U.chair]: { cost_materials: true, cost_suppliers: true, cost_market_prices: true, cost_purchase_lots: true, cost_products: true },
  }
  // 제품 하나(원가 관리가 만든다) — 제품 표 읽기 시험 전에.
  const [{ p1 }] = await run(U.cost, `insert into cost_products (business_id, name) values ('biz_dy', '가짜제품 1') returning product_id as p1`) as { p1: string }[]
  const [{ p2 }] = await run(U.cost, `insert into cost_products (business_id, name) values ('biz_dy', '가짜제품 BOM 없음') returning product_id as p2`) as { p2: string }[]
  await refuses(run(U.sales, `insert into cost_products (business_id, name) values ('biz_dy', 'x')`), /row-level security/, '0061: 영업이 제품을 만든다')
  for (const [uid, row] of Object.entries(expect)) {
    for (const t of tables) {
      const n = await count(uid, t)
      assert.equal(n > 0, row[t], `0061 권한 표: ${uid.slice(-2)} · ${t} = ${n}행(기대 ${row[t] ? '보임' : '0'})`)
    }
  }
  for (const uid of [U.exec, U.ceo, U.vana, U.agent, U.cfo]) {
    for (const t of tables) assert.equal(await count(uid, t), 0, `0061: 줄 없는 사람 · 다른 회사 · 시스템 계정(${uid.slice(-2)})이 ${t}를 본다`)
  }
  for (const t of [...tables, 'cost_purchase_docs']) {
    await refuses(as(null, `select 1 from ${t}`), /permission denied/, `0061: anon이 ${t}를 읽는다`)
  }
  await refuses(run(U.sales, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name) values ('biz_dy', '${m1}', '2026-10-09', 1, 'x')`),
    /row-level security/, '0061: 영업이 시장가를 넣는다')
  await refuses(run(U.agent, `insert into cost_materials (business_id, name) values ('biz_dy', 'ai원료')`), /row-level security/, '0061: AIAgent가 원료를 넣는다')

  // 생산 «제한» · 영업 «요약» 함수.
  const plots = await as<Record<string, unknown>>(U.prod, `select * from cost_production_lots('biz_dy')`)
  assert.ok(plots.length >= 4, '0061: 생산이 LOT 목록을 못 본다')
  assert.deepEqual(Object.keys(plots[0]).sort(),
    ['landed_krw_per_kg', 'lot_id', 'material_id', 'material_name', 'qty_kg', 'received_on', 'supplier_lot_no', 'supplier_name'],
    '0061: 생산 LOT 함수가 «제한» 밖의 칸(외화 단가 · 환율 · 부대비 · 연락처)을 돌려준다')
  const pmat = await as<Record<string, unknown>>(U.prod, `select * from cost_production_materials('biz_dy')`)
  assert.deepEqual(Object.keys(pmat[0]).sort(), ['category', 'market_krw_per_kg', 'material_id', 'name'], '0061: 생산 시장가 함수의 칸')
  await refuses(as(U.prod, `select * from cost_sales_purchase_summary('biz_dy')`), /cost_not_found/, '0061: 생산이 영업 요약을 본다')
  await refuses(as(U.sales, `select * from cost_production_lots('biz_dy')`), /cost_not_found/, '0061: 영업이 LOT 가격을 본다')
  const summary = await as<{ material_id: string; avg_purchase_krw_per_kg: string; purchase_vs_market_pct: string }>(U.sales,
    `select * from cost_sales_purchase_summary('biz_dy', 30, '2026-10-09')`)
  const s1row = summary.find((r) => r.material_id === m1)!
  assert.equal(Number(s1row.avg_purchase_krw_per_kg), 1540, '0061: 영업 요약의 수량가중 평균(1480 · 1600 각 1000kg)이 틀렸다')
  assert.equal(Number(s1row.purchase_vs_market_pct), 28.3, '0061: 시장가(1200) 대비 %가 틀렸다')
  for (const uid of [U.exec, U.ceo, U.vana, U.agent, U.cfo]) {
    await refuses(as(uid, `select * from cost_sales_purchase_summary('biz_dy')`), /cost_not_found/, `0061: ${uid.slice(-2)}가 영업 요약을 본다`)
    await refuses(as(uid, `select * from cost_production_lots('biz_dy')`), /cost_not_found/, `0061: ${uid.slice(-2)}가 LOT 가격을 본다`)
  }

  // ── ⑤ 구매 결재 → LOT 후보 ─────────────────────────────────────────────
  await db.exec(`set session_replication_role = replica;
    insert into decisions (decision_id, business_id, title, status, template_key, form, decided_at) values
      ('dec_c61_ok', 'biz_dy', '원료 구매', 'Approved', 'purchase', '{"item":"가짜원료알파","vendor":"가짜공급처","quantity":"500","amount":"700,000","link":"https://x.co/a"}', now()),
      ('dec_c61_open', 'biz_dy', '원료 구매 2', 'Open', 'purchase', '{"item":"x","vendor":"y","quantity":"1","amount":"1"}', null),
      ('dec_c61_vana', 'biz_vana', 'VANA 구매', 'Approved', 'purchase', '{"item":"x","vendor":"y","quantity":"1","amount":"1"}', now());
    set session_replication_role = origin;`)
  const cands = await as<{ decision_id: string; amount_krw: string; quantity: string }>(U.buy, `select * from cost_purchase_candidates('biz_dy')`)
  assert.deepEqual(cands.map((c) => c.decision_id), ['dec_c61_ok'], '0061: 결재 후보가 승인된 DY 구매 양식만이 아니다')
  assert.equal(Number(cands[0].amount_krw), 700000, '0061: 금액 쉼표를 못 읽는다')
  await refuses(as(U.sales, `select * from cost_purchase_candidates('biz_dy')`), /cost_not_found/, '0061: 영업이 결재 후보를 본다')
  await refuses(run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, source, source_ref)
    values ('biz_dy', '${m1}', '${s1}', '2026-10-08', 500, 1400, 'approval', 'dec_c61_open')`), /cost_candidate_invalid/, '0061: 열린 결재로 LOT를 만든다')
  await run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, source, source_ref)
    values ('biz_dy', '${m1}', '${s1}', '2026-10-08', 500, 1400, 'approval', 'dec_c61_ok')`)
  await refuses(run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, source, source_ref)
    values ('biz_dy', '${m1}', '${s1}', '2026-10-08', 500, 1400, 'approval', 'dec_c61_ok')`), /duplicate key/, '0061: 결재 한 건으로 LOT 둘')
  assert.equal((await as(U.buy, `select * from cost_purchase_candidates('biz_dy')`)).length, 0, '0061: LOT가 된 결재가 후보에 남는다')

  // 구매 첨부 버킷 — 줄이 먼저, 파일이 뒤. 영업은 못 본다. 줄 없는 파일은 못 올린다.
  const path = `biz_dy/11111111-1111-1111-1111-111111111111/q.pdf`
  await run(U.buy, `insert into cost_purchase_docs (doc_id, business_id, lot_id, kind, file_name, mime, size_bytes, sha256, storage_path, mix_checked)
    values ('11111111-1111-1111-1111-111111111111', 'biz_dy', '${lot}', 'quote', 'q.pdf', 'application/pdf', 100, '${'a'.repeat(64)}', '${path}', true)`)
  await run(U.buy, `insert into storage.objects (bucket_id, name) values ('purchasing', '${path}')`)
  await refuses(run(U.buy, `insert into storage.objects (bucket_id, name) values ('purchasing', 'biz_dy/x/y.pdf')`), /row-level security/, '0061: 줄 없는 파일을 올린다')
  assert.equal(await count(U.sales, `storage.objects where bucket_id = 'purchasing'`), 0, '0061: 영업이 구매 첨부 파일을 본다')
  assert.equal(await count(U.cost, `storage.objects where bucket_id = 'purchasing'`), 1, '0061: 원가 관리가 구매 첨부를 못 본다')
  await run(U.buy, `delete from storage.objects where bucket_id = 'purchasing'`) // 정책이 없어 0행 — 오류 없이 아무것도 안 지운다
  assert.equal(await count(U.chair, `storage.objects where bucket_id = 'purchasing'`), 1, '0061: 올린 파일을 지울 수 있다(정책 없음이어야)')

  // ── ③ BOM — 대표만 ─────────────────────────────────────────────────────
  const lines = JSON.stringify([{ material_id: m1, kg_per_kg: 0.5 }, { material_id: m2, kg_per_kg: 0.3 }, { material_id: m3, kg_per_kg: 0.25 }])
  for (const uid of [U.buy, U.prod, U.sales, U.cost, U.exec, U.ceo, U.cfo, U.agent]) {
    await refuses(as(uid, `select cost_bom_save('${p1}', '2026-10-01', 100, '${lines}'::jsonb)`), /cost_not_found/, `0062: ${uid.slice(-2)}가 BOM을 쓴다`)
  }
  const [{ v }] = await run(U.chair, `select cost_bom_save('${p1}', '2026-10-01', 95, '${lines}'::jsonb, '가짜 BOM') as v`) as { v: number }[]
  assert.ok(Number(v) > 0, '0062: 대표가 BOM을 못 쓴다')
  await refuses(run(U.chair, `select cost_bom_save('${p1}', '2026-10-01', 95, '[{"material_id":"${m1}","kg_per_kg":0.5},{"material_id":"${m1}","kg_per_kg":0.1}]'::jsonb)`),
    /cost_bom_invalid/, '0062: 같은 원료 두 줄')
  await refuses(db.query(`insert into cost_secret.bom_versions (product_id, valid_from, is_fake, created_by) values ('${p1}', '2027-01-01', false, '${U.chair}')`),
    /check constraint/, '0062: 진짜 BOM(is_fake=false)이 들어간다 — 암호화 전 입력 금지')

  for (const uid of [U.buy, U.prod, U.sales, U.cost, U.exec, U.ceo, U.cfo, U.agent, U.vana]) {
    for (const sql of [
      `select * from cost_secret.bom_lines`, `select * from cost_secret.bom_versions`, `select * from cost_secret.bom_access`,
      `select cost_secret.material_cost('${p1}', 'market', '2026-10-09')`, `select cost_secret.unit_price('${m1}', 'market', '2026-10-09')`,
    ]) {
      await refuses(as(uid, sql), /permission denied/, `0062: ${uid.slice(-2)}가 비공개 스키마에 닿는다 — ${sql}`)
    }
    await refuses(as(uid, `select * from cost_bom_get('${p1}')`), /cost_not_found/, `0062: ${uid.slice(-2)}가 BOM을 읽는다`)
    await refuses(as(uid, `select * from cost_product_breakdown('${p1}', 'market', '2026-10-09')`), /cost_not_found/, `0062: ${uid.slice(-2)}가 원료별 분해를 본다`)
  }
  await refuses(as(null, `select * from cost_product_cost('${p1}')`), /permission denied/, '0062: anon이 원가 함수를 부른다')
  await refuses(as(null, `select * from cost_secret.bom_lines`), /permission denied/, '0062: anon이 BOM 표에 닿는다')

  // 대표: 분해 · BOM 읽기.
  const bom = await as<{ material_id: string; kg_per_kg: string; is_fake: boolean }>(U.chair, `select * from cost_bom_get('${p1}', '2026-10-09')`)
  assert.equal(bom.length, 3, '0062: 대표가 BOM을 못 읽는다')
  assert.ok(bom.every((r) => r.is_fake), '0062: 가짜 표시가 없다')
  const bd = await as<{ contribution_krw_per_kg: string }>(U.chair, `select * from cost_product_breakdown('${p1}', 'market', '2026-10-09')`)
  // Market(10-09): m1 1200 · m2 2800 · m3 500. q = kg_per_kg ÷ 0.95.
  const market = (0.5 * 1200 + 0.3 * 2800 + 0.25 * 500) / 0.95
  assert.ok(Math.abs(bd.reduce((s, r) => s + Number(r.contribution_krw_per_kg), 0) - market) < 0.01, '0062: 분해 합이 Market 원가와 다르다')

  // 원가 관리: 합계 한 값 · 10원 반올림.
  const cc = await as<Record<string, unknown>>(U.cost, `select * from cost_product_cost('${p1}', 'market', '2026-10-09')`)
  assert.equal(cc.length, 1, '0062: 원가 함수가 한 줄이 아니다(원료 수가 응답 크기로 샌다)')
  assert.deepEqual(Object.keys(cc[0]).sort(), ['as_of', 'computed', 'kind', 'material_krw_per_kg', 'product_id', 'reason'], '0062: 원가 함수 칸')
  assert.equal(Number(cc[0].material_krw_per_kg), Math.round(market / 10) * 10, '0062: Market 원가(10원 반올림)가 틀렸다')
  // Current(10-09): m1 = (1480×1000 + 1600×1000 + 1400×500)/2500 = 1512 · m2 = 3000 · m3 = 600.
  const current = (0.5 * 1512 + 0.3 * 3000 + 0.25 * 600) / 0.95
  const cur = await as<{ material_krw_per_kg: string; as_of: string }>(U.cost, `select * from cost_product_cost('${p1}', 'current', '2026-10-09')`)
  assert.equal(Number(cur[0].material_krw_per_kg), Math.round(current / 10) * 10, '0062: Current 원가가 틀렸다')

  // 영업: 주간 고정(10-09 목 → 10-05 월). 그 날 Market = m1 1000.
  const sc = await as<{ material_krw_per_kg: string; as_of: string }>(U.sales, `select material_krw_per_kg, as_of::text as as_of from cost_product_cost('${p1}', 'market', '2026-10-09')`)
  assert.equal(sc[0].as_of, '2026-10-05', '0062: 영업 원가가 주간(월요일) 고정이 아니다')
  assert.equal(Number(sc[0].material_krw_per_kg), Math.round((0.5 * 1000 + 0.3 * 2800 + 0.25 * 500) / 0.95 / 10) * 10, '0062: 영업 주간 원가')
  const fut = await as<{ as_of: string }>(U.cost, `select as_of::text as as_of from cost_product_cost('${p1}', 'market', '2999-01-01')`)
  assert.ok(fut[0].as_of < '2999-01-01', '0062: 미래 기준일을 받는다')

  // 그 밖: 생산 · 구매 · 임원 · 회사 대표 · CFO · 다른 회사 · 시스템 계정 → 같은 오류.
  for (const uid of [U.buy, U.prod, U.exec, U.ceo, U.cfo, U.vana, U.agent]) {
    await refuses(as(uid, `select * from cost_product_cost('${p1}', 'market')`), /cost_not_found/, `0062: ${uid.slice(-2)}가 제품 원가를 본다`)
  }
  await refuses(as(U.cost, `select * from cost_product_cost('prd_nope_nope', 'market')`), /cost_not_found/, '0062: 없는 제품의 오류가 다르다')
  await refuses(as(U.cost, `select * from cost_product_cost('${p1}', 'actual')`), /cost_kind_unsupported/, '0062: 1차에 없는 Actual을 받는다')

  // 이유 코드 — 원료 이름 · 개수 없이.
  const nb = await as<{ computed: boolean; reason: string; material_krw_per_kg: unknown }>(U.cost, `select * from cost_product_cost('${p2}', 'market', '2026-10-09')`)
  assert.deepEqual([nb[0].computed, nb[0].reason, nb[0].material_krw_per_kg], [false, 'no_bom', null], '0062: BOM 없는 제품의 답')
  const pm = await as<{ computed: boolean; reason: string }>(U.cost, `select * from cost_product_cost('${p1}', 'market', '2026-10-04')`)
  assert.deepEqual([pm[0].computed, pm[0].reason], [false, 'price_missing'], '0062: 시세 없는 날의 답 — 0으로 메우면 안 된다')

  // 오류 · 경고 문장에 원료 이름이 없다.
  for (const sql of [`select * from cost_product_cost('${p1}', 'market')`, `select * from cost_bom_get('${p1}')`, `select * from cost_product_breakdown('${p1}')`,
    `select cost_bom_save('${p1}', '2026-10-01', 95, '${lines}'::jsonb)`]) {
    try {
      await as(U.sales, sql)
    } catch (e) {
      // 서버가 돌려준 칸만 본다(PGlite 오류 객체에는 보낸 SQL 원문도 붙는다 — 그것은 부른 사람이 이미 아는 값이다).
      const err = e as { message?: string; detail?: string; hint?: string; where?: string }
      const msg = [err.message, err.detail, err.hint, err.where].join(' | ')
      for (const name of FAKE_MATERIAL_NAMES) assert.ok(!msg.includes(name), `0062: 오류에 원료 이름이 샌다 — ${sql}`)
      assert.ok(!msg.includes(m1) && !msg.includes(m2), `0062: 오류에 원료 id가 샌다 — ${sql}`)
    }
  }

  // 원료비 영향 — 묶음 한 값.
  const imp = await as<{ v: string }>(U.cost, `select cost_material_impact('${p1}', 'market', '2026-10-05', '2026-10-09') as v`)
  const before = (0.5 * 1000 + 0.3 * 2800 + 0.25 * 500) / 0.95
  assert.equal(Number(imp[0].v), Math.round((market / before - 1) * 1000) / 10, '0062: 원료비 영향 %')

  // 하루 한 줄 감사 · 한도 200.
  const auditBefore = Number((await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'cost_products' and actor_user_id = '${U.sales}'`))[0].n)
  for (let i = 0; i < 3; i++) await run(U.sales, `select * from cost_product_cost('${p1}', 'current')`)
  const auditAfter = Number((await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'cost_products' and actor_user_id = '${U.sales}'`))[0].n)
  assert.equal(auditAfter - auditBefore, 1, '0062: 같은 날 같은 제품 · 종류 조회가 감사 한 줄로 합쳐지지 않는다')
  await db.exec(`update cost_secret.cost_reads set calls = 199 where user_id = '${U.sales}' and kind = 'current'`)
  await run(U.sales, `select * from cost_product_cost('${p1}', 'current')`)
  await refuses(run(U.sales, `select * from cost_product_cost('${p1}', 'current')`), /cost_rate_limited/, '0062: 하루 200건 한도가 없다')
  assert.equal(Number((await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'cost_products' and actor_user_id = '${U.chair}'`))[0].n), 0,
    '0062: 대표 조회가 한도 · 감사에 걸린다')
  const bomAudit = await owner<{ after: unknown }>(`select after from audit_log where entity_table = 'cost_bom' and action = 'create'`)
  assert.equal(bomAudit.length, 1, '0062: BOM 저장 감사가 없다')
  const bomAuditText = JSON.stringify(bomAudit)
  assert.ok(!bomAuditText.includes(m1) && !bomAuditText.includes('0.5'), '0062: BOM 저장 감사에 원료 · 비율이 들어갔다')

  // 카탈로그 — 공개 뷰가 비공개 스키마를 참조하지 않는다 · pg_stats 비공개 · anon execute 없음 · 내부 함수 execute 없음.
  const deps = await owner<{ v: string }>(`
    select distinct c.relname as v from pg_depend d
      join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = r.ev_class join pg_namespace n on n.oid = c.relnamespace
      join pg_class t on t.oid = d.refobjid join pg_namespace tn on tn.oid = t.relnamespace
     where n.nspname <> 'cost_secret' and tn.nspname = 'cost_secret'`)
  assert.deepEqual(deps, [], `0062: 공개 뷰가 비공개 BOM을 참조한다 — ${deps.map((d) => d.v).join(', ')}`)
  await db.exec('analyze cost_secret.bom_lines; analyze cost_secret.bom_versions;')
  assert.equal(await count(U.sales, `pg_stats where schemaname = 'cost_secret'`), 0, '0062: pg_stats로 BOM 값 분포가 보인다')
  const anonCallable = await owner<{ f: string }>(`
    select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where ((n.nspname = 'public' and p.proname like 'cost\\_%') or n.nspname = 'cost_secret')
       and p.proname <> 'cost_today' and has_function_privilege('anon', p.oid, 'execute')`)
  assert.deepEqual(anonCallable, [], `0062: anon이 부를 수 있는 원가 함수 — ${anonCallable.map((r) => r.f).join(', ')}`)
  const secretCallable = await owner<{ f: string }>(`
    select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cost_secret' and has_function_privilege('authenticated', p.oid, 'execute')`)
  assert.deepEqual(secretCallable, [], `0062: authenticated가 부를 수 있는 비공개 함수 — ${secretCallable.map((r) => r.f).join(', ')}`)
  const internal = await owner<{ f: string }>(`
    select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('cost_market_on', 'cost_audit', 'cost_lot_calc', 'cost_lot_source_check')
       and has_function_privilege('authenticated', p.oid, 'execute')`)
  assert.deepEqual(internal, [], '0061: 내부 함수를 authenticated가 부른다')
  const secretPriv = await owner<{ n: number }>(`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'cost_secret' and grantee in ('anon', 'authenticated', 'PUBLIC')`)
  assert.equal(Number(secretPriv[0].n), 0, '0062: 비공개 표에 grant가 있다')

  // ── ⑥ 코드 경계 — AI 도구 · 프롬프트 · 요약이 BOM 함수를 부르지 않는다 ─────────────────
  const root = join(__dirname, '..', 'src')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
  const aiFiles = walk(join(root, 'lib', 'ai')).concat(walk(join(root, 'lib', 'attachments')))
  for (const f of aiFiles) {
    const text = readFileSync(f, 'utf8')
    for (const bad of ['cost_secret', 'cost_bom_', 'cost_product_breakdown', 'cost_product_cost', 'costBom', 'productCost']) {
      assert.ok(!text.includes(bad), `경계: AI · 첨부 코드(${f})가 원가 · BOM(${bad})을 부른다`)
    }
  }

  await db.close()
  console.log(
    'PASS: 0061 · 0062 원가 엔진 — 권한 표(구매 · 생산 · 영업 · 원가 관리 · 대표 · 줄 없는 임원/회사 대표/CFO · 다른 회사 · AIAgent · anon) · ' +
      '무효만(단가 · 시장가 고치기 · 지우기 거부) · Landed · 환율 · 만든 사람 위조 불가 · 생산 «제한» · 영업 «요약» 칸 · 결재 후보(승인 · 회사 · 중복) · ' +
      '구매 첨부 버킷(줄 먼저 · 영업 0 · 지우기 없음) · BOM 대표만(쓰기 · 읽기 · 분해 · 비공개 스키마 · 내부 함수 · 진짜 BOM 거부) · ' +
      '원가 합계 한 줄 · 10원 반올림 · Market/Current 값 · 영업 주간 고정 · 미래 거부 · 같은 오류 · 이유 코드 · 오류에 원료 없음 · 원료비 영향 · ' +
      '하루 한 줄 감사 · 200건 한도 · 대표 감사 없음 · BOM 감사에 값 없음 · 공개 뷰 의존 0 · pg_stats 0 · anon/authenticated execute · AI 코드 경계',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
