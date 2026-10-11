/**
 * 원가 엔진 엑셀 넣기(0068) 검사 — npm run check:cost-import
 *
 * 회장 결정(2026-10-11): 원가 엔진 자료는 엑셀로 «넣기만». 겹침은 사람이 고른다. 빼기(내려받기 · 내보내기 · 복사용 표)는 대표 예외 말고 0.
 *
 *   ① DB(PGlite · 전 마이그레이션): 대상마다 정상 등록 · 같은 파일 두 번 거부 · 도장 다르면 거부 · 권한 없는 사람(영업 · 남의 회사 · 시스템 · anon) 거부 ·
 *      바꾸기(이유 없음 거부 · 무효 + 새 줄 · 이력 남음 · 넣은 사람에게 알림) · 이상치 거부 시 전부 되돌림 · 잔량 초과 거부 · 숫자 모양 오류 문장에 값 없음 ·
 *      BOM 대표만 · 같은 날 판 조용히 갈지 않음 · 진짜 BOM 스위치 · 하루 20번 · 감사 한 줄(파일 이름 · 줄 수 · 해시 · BOM 고친 칸 값 없음) ·
 *      구매 첨부 파일 대표만 + 내려받기 감사
 *   ② 계획(lib/cost-import/plan.ts): 새 줄 · 같은 줄 · 충돌 · 파일 안 충돌 · 중복 의심 · 오류 · 고치기 · 잠김 이유
 *   ③ 빈 양식: 저장소를 부르지 않는다 · 셀이 전부 spec.ts 고정 문구
 *   ④ 빼기 경로 0: 원가 화면 · 액션 · 라우트 · AI 도구 정적 검사
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

import { planImport, type GridSheet, type PlanContext } from '../src/lib/cost-import/plan'
import { IMPORT_FIELDS } from '../src/lib/cost-import/spec'
import { buildImportTemplate } from '../src/lib/cost-import/template'
import { IMPORT_TARGETS } from '../src/lib/cost-import/types'
import { applyOne, MIGRATIONS, SUPABASE_STUBS } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000068a1',
  buy: '00000000-0000-0000-0000-0000000068a2',
  buy2: '00000000-0000-0000-0000-0000000068a3',
  prod: '00000000-0000-0000-0000-0000000068a4',
  cost: '00000000-0000-0000-0000-0000000068a5',
  sales: '00000000-0000-0000-0000-0000000068a6',
  vana: '00000000-0000-0000-0000-0000000068a7',
  agent: '00000000-0000-0000-0000-0000000068a8',
  read: '00000000-0000-0000-0000-0000000068a9', // 구매 읽기만
}
const SHA = (n: number) => n.toString(16).padStart(64, '0')

async function dbChecks() {
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
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) await applyOne(db, f)
  assert.ok(files.includes('0068_cost_import.sql'), '0068이 없다')

  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    insert into auth.users (id, email) values ${Object.values(U).map((u) => `('${u}', '${u.slice(-2)}@x')`).join(', ')};
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${U.chair}', 'Chairman', '대표', 'Vault'), ('${U.buy}', 'Member', '구매', 'Normal'), ('${U.buy2}', 'Member', '구매2', 'Normal'),
      ('${U.prod}', 'Member', '생산', 'Normal'), ('${U.cost}', 'Member', '원가', 'Normal'), ('${U.sales}', 'Member', '영업', 'Normal'),
      ('${U.vana}', 'Member', 'VANA', 'Normal'), ('${U.agent}', 'AIAgent', 'ai', 'Restricted'), ('${U.read}', 'Member', '읽기', 'Normal');
    insert into user_business_access values
      ('${U.buy}', 'biz_dy'), ('${U.buy2}', 'biz_dy'), ('${U.prod}', 'biz_dy'), ('${U.cost}', 'biz_dy'), ('${U.sales}', 'biz_dy'),
      ('${U.vana}', 'biz_vana'), ('${U.agent}', 'biz_dy'), ('${U.read}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values
      ('${U.buy}', '/purchasing/biz_dy', true, false), ('${U.buy2}', '/purchasing/biz_dy', true, false),
      ('${U.prod}', '/production/biz_dy', true, false), ('${U.cost}', '/costing/biz_dy', true, false),
      ('${U.sales}', '/sales/biz_dy', true, false), ('${U.vana}', '/purchasing/biz_dy', true, false),
      ('${U.agent}', '/purchasing/biz_dy', true, false), ('${U.read}', '/purchasing/biz_dy', false, false);
  `)
  const as = async <T,>(uid: string | null, sql: string, commit = true) => {
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
  const owner = async <T,>(sql: string) => (await db.query<T>(sql)).rows
  const n = async (sql: string) => Number((await owner<{ n: number }>(`select (${sql})::int as n`))[0].n)
  const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)
  const stamp = async (uid: string, target: string) =>
    (await as<{ stamp: string }>(uid, `select stamp from cost_import_check('biz_dy', '${target}', '${SHA(0)}')`))[0].stamp
  const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  const apply = async (uid: string, target: string, sha: number, rows: unknown[], opts: { stamp?: string; edits?: unknown[]; biz?: string } = {}) => {
    const st = opts.stamp ?? (await stamp(uid, target).catch(() => '0'.repeat(32)))
    return as<{ r: { import_id: string; inserted: number; replaced: number } }>(
      uid,
      `select cost_import_apply('${opts.biz ?? 'biz_dy'}', '${target}', '시험.xlsx', '${SHA(sha)}', '${st}', ${lit(rows)}, ${lit(opts.edits ?? [])}, 0) as r`,
    )
  }
  const T = (await owner<{ t: string }>(`select cost_today()::text as t`))[0].t

  // ── 원료 · 공급처 ──
  const r1 = await apply(U.buy, 'materials', 1, [
    { name: '가짜원료가', category: 'main', spec: '', note: '' },
    { name: '가짜원료나', category: 'sub', spec: '포대', note: '' },
  ])
  assert.equal(r1[0].r.inserted, 2, '원료 2줄이 들어가지 않았다')
  assert.equal(await n(`select count(*) from cost_imports where target = 'materials'`), 1)
  const audit = await owner<{ note: string; after: { sha256: string; rows: number } }>(
    `select note, after from audit_log where entity_table = 'cost_materials' and note like '엑셀 넣기%'`,
  )
  assert.equal(audit.length, 1, '엑셀 감사 한 줄이 없다')
  assert.ok(audit[0].note.includes('시험.xlsx') && audit[0].note.includes('2줄') && audit[0].after.sha256 === SHA(1), '감사 줄에 파일 이름 · 줄 수 · 해시가 없다')
  assert.ok(!JSON.stringify(audit[0]).includes('가짜원료가'), '감사 줄에 내용(원료 이름)이 들어갔다')
  await refuses(apply(U.buy, 'materials', 1, [{ name: '가짜원료다', category: 'main', spec: '', note: '' }]), /cost_import_duplicate/, '같은 파일이 두 번 들어갔다')
  await refuses(
    apply(U.buy, 'materials', 2, [{ name: '가짜원료다', category: 'main', spec: '', note: '' }], { stamp: 'f'.repeat(32) }),
    /cost_import_stale/,
    '도장이 다른데 등록됐다(동시 변경)',
  )
  for (const [uid, why] of [
    [U.sales, '영업'],
    [U.vana, '남의 회사'],
    [U.agent, '시스템 계정'],
    [U.read, '구매 읽기만'],
    [U.prod, '생산'],
  ] as const) {
    await refuses(apply(uid, 'materials', 3, [{ name: '가짜원료라', category: 'main', spec: '', note: '' }], { stamp: '0'.repeat(32) }), /cost_not_found|row-level/, `${why}가 원료를 엑셀로 넣었다`)
  }
  await refuses(as(null, `select cost_import_check('biz_dy', 'materials', '${SHA(1)}')`), /permission denied|cost_not_found/, 'anon이 도장을 읽었다')
  // 원료 바꾸기 = 마스터 수정(지우지 않는다)
  const mat = (await owner<{ id: string }>(`select material_id as id from cost_materials where name = '가짜원료나'`))[0].id
  await refuses(apply(U.buy, 'materials', 4, [{ name: '가짜원료나', category: 'additive', spec: '', note: '', replace_id: mat }]), /cost_void_reason/, '이유 없는 바꾸기가 됐다')
  await apply(U.buy2, 'materials', 4, [{ name: '가짜원료나', category: 'additive', spec: '', note: '', replace_id: mat, reason: '분류 정정' }])
  assert.equal((await owner<{ c: string }>(`select category as c from cost_materials where material_id = '${mat}'`))[0].c, 'additive')
  assert.equal(await n(`select count(*) from notifications where user_id = '${U.buy}'`), 1, '다른 사람이 넣은 원료를 바꿨는데 알림이 없다')
  const repAudit = JSON.stringify(await owner(`select after from audit_log where entity_table = 'cost_materials' and note like '엑셀 넣기%바꾼 줄%'`))
  assert.ok(repAudit.includes('분류 정정') && repAudit.includes('"category": "sub"') || repAudit.includes('"category":"sub"'), `원료 바꾸기의 이전 값 · 이유가 감사에 없다(리뷰 I1) ${repAudit}`)
  assert.equal((await owner<{ s: string }>(`select spec as s from cost_materials where material_id = '${mat}'`))[0].s, '포대', '빈 칸이 기존 규격을 지웠다(리뷰 I1)')
  // 리뷰 I2 — cost_imports에 직접 넣기 · 데이터 없이 cost_import_log 부르기 거부
  await refuses(as(U.buy, `insert into cost_imports (business_id, target, file_name, file_sha256, row_count) values ('biz_dy', 'materials', 'x.xlsx', '${SHA(77)}', 1)`), /permission denied|row-level/, 'cost_imports에 직접 넣었다')
  await refuses(as(U.buy, `select cost_import_log('biz_dy', 'materials', 'x.xlsx', '${SHA(78)}', 5, 0, '[]'::jsonb, '[]'::jsonb)`), /cost_import_invalid/, '데이터 없이 엑셀 감사 줄을 만들었다')
  await refuses(as(U.buy, `select cost_import_log('biz_dy', 'materials', 'x.xlsx', '${SHA(79)}', 1, 0, '[]'::jsonb, '[{"t":"cost_materials","id":"${mat}"}]'::jsonb)`), /cost_import_invalid/, '바꾸지 않은 줄로 알림 · 감사를 만들었다')
  await apply(U.buy, 'suppliers', 5, [{ name: '가짜공급사', country: '한국', currency_default: 'KRW', contact: '', terms: '', note: '' }])
  const [m1, m2] = (await owner<{ id: string }>(`select material_id as id from cost_materials order by name`)).map((x) => x.id)
  const sup = (await owner<{ id: string }>(`select supplier_id as id from cost_suppliers`))[0].id

  // ── 시장가: 바꾸기 · 이력 · 알림 · 이상치 되돌림 ──
  await apply(U.buy, 'market_prices', 10, [
    { material_id: m1, observed_on: T, price: '1000', currency: 'KRW', fx_rate: null, source_name: '출처0', source_url: null, note: '' },
    { material_id: m1, observed_on: T, price: '1000', currency: 'KRW', fx_rate: null, source_name: '출처A', source_url: null, note: '' },
  ])
  const pid = (await owner<{ id: string }>(`select price_id::text as id from cost_market_prices where source_name = '출처A'`))[0].id
  const row = { material_id: m1, observed_on: T, price: '1100', currency: 'KRW', fx_rate: null, source_name: '출처A', source_url: null, note: '' }
  await refuses(apply(U.buy2, 'market_prices', 11, [{ ...row, replace_id: pid, reason: ' ' }]), /cost_void_reason/, '이유 없는 시장가 바꾸기')
  await refuses(apply(U.buy2, 'market_prices', 11, [row]), /cost_market_prices_one_a_day|unique/, '바꾸기 없이 같은 날 · 같은 출처가 겹쳐 들어갔다')
  await apply(U.buy2, 'market_prices', 11, [{ ...row, replace_id: pid, reason: '시세 정정' }])
  assert.equal(await n(`select count(*) from cost_market_prices where source_name = '출처A'`), 2, '바꾸기가 이력을 지웠다(무효 + 새 줄이어야 한다)')
  assert.equal(await n(`select count(*) from cost_market_prices where source_name = '출처A' and voided_at is not null and void_reason = '시세 정정'`), 1)
  assert.equal(await n(`select count(*) from notifications where user_id = '${U.buy}'`), 2, '남이 넣은 시세를 바꿨는데 알림이 없다')
  // 이상치: 열흘 전 줄 셋을 기준으로 — 한 줄이 5배 넘으면 파일 전체가 되돌아간다
  await db.exec(`set session_replication_role = replica;
    insert into cost_market_prices (business_id, material_id, observed_on, price, currency, fx_rate, price_krw_per_kg, source_name, created_by, created_at)
    select 'biz_dy', '${m2}', '${T}'::date - g, 100, 'KRW', 1, 100, 'base' || g, '${U.buy}', now() - interval '10 days' from generate_series(3, 5) g;
    set session_replication_role = origin;`)
  const before = await n(`select count(*) from cost_market_prices`)
  await refuses(
    apply(U.buy, 'market_prices', 12, [
      { material_id: m2, observed_on: T, price: '110', currency: 'KRW', fx_rate: null, source_name: 'ok', source_url: null, note: '' },
      { material_id: m2, observed_on: T, price: '900', currency: 'KRW', fx_rate: null, source_name: 'big', source_url: null, note: '' },
    ]),
    /cost_price_outlier/,
    '엑셀로 이상치가 들어갔다',
  )
  assert.equal(await n(`select count(*) from cost_market_prices`), before, '이상치 거부 뒤 앞 줄이 남았다(전부 아니면 전무)')
  // 숫자 모양 — 오류 문장에 값이 없다
  await assert.rejects(
    apply(U.buy, 'market_prices', 13, [{ ...row, source_name: 'x', price: '12abc34' }]),
    (e: Error) => /cost_import_invalid/.test(e.message) && !e.message.includes('12abc34'),
    '숫자 모양 오류에 값이 실렸다',
  )

  // ── 구매 LOT · 비용 줄 ──
  await apply(U.buy, 'purchase_lots', 20, [
    { material_id: m1, supplier_id: sup, received_on: T, ordered_on: null, supplier_lot_no: 'A', qty_kg: '100', unit_price: '1000', currency: 'KRW', fx_rate: null, freight_krw: '0', duty_krw: '0', other_krw: '0', note: '' },
  ])
  const lot = (await owner<{ id: string; s: string }>(`select lot_id as id, source as s from cost_purchase_lots`))[0]
  assert.equal(lot.s, 'import', 'LOT 출처가 import가 아니다')
  await apply(U.cost, 'overheads', 21, [{ category: 'power', basis: 'monthly', amount: '100', product_id: null, effective_from: T, note: '' }])
  await refuses(
    apply(U.buy, 'overheads', 22, [{ category: 'power', basis: 'monthly', amount: '100', product_id: null, effective_from: T, note: '' }], { stamp: '0'.repeat(32) }),
    /cost_not_found/,
    '구매 입력이 비용 줄을 넣었다',
  )

  // ── BOM: 대표만 · 같은 날 판 · 진짜 스위치 · 감사에 값 없음 ──
  const prod = (await as<{ id: string }>(U.cost, `insert into cost_products (business_id, name) values ('biz_dy', '가짜제품') returning product_id as id`))[0].id
  const bom = { product_id: prod, valid_from: T, yield_pct: '95', is_fake: true, note: '', lines: [{ material_id: m1, kg_per_kg: '0.6' }, { material_id: m2, kg_per_kg: '0.45' }] }
  for (const uid of [U.buy, U.cost, U.prod]) await refuses(apply(uid, 'bom', 30, [bom], { stamp: '0'.repeat(32) }), /cost_not_found/, `${uid.slice(-2)}가 BOM을 엑셀로 넣었다`)
  await apply(U.chair, 'bom', 30, [bom], { edits: [{ row: 2, field: 'kg_per_kg', from: '', to: '고침' }] })
  await refuses(apply(U.chair, 'bom', 31, [bom]), /cost_import_stale/, '같은 제품 · 같은 시작일 판이 조용히 바뀌었다')
  const ver = (await as<{ v: string }>(U.chair, `select cost_import_bom_live('${prod}', '${T}')::text as v`))[0].v
  await refuses(apply(U.chair, 'bom', 31, [{ ...bom, is_fake: false, replace_id: ver, reason: '새 판' }]), /cost_bom_real_locked/, '진짜 BOM 스위치가 꺼졌는데 진짜가 들어갔다')
  await apply(U.chair, 'bom', 31, [{ ...bom, replace_id: ver, reason: '새 판' }])
  const bomAudit = JSON.stringify(await owner(`select after, note from audit_log where entity_table = 'cost_bom' and note like '엑셀 넣기%'`))
  assert.ok(bomAudit.includes('고침') && !bomAudit.includes('0.6') && !bomAudit.includes('0.45'), 'BOM 감사 줄에 값이 실렸다')
  await refuses(as(U.buy, `select cost_import_bom_live('${prod}', '${T}')`), /cost_not_found/, '대표 외가 BOM 판 번호를 읽었다')

  // ── 생산 LOT · 투입: 잔량 초과 거부 · 되돌림 ──
  const order = (await as<{ o: string }>(U.chair, `select cost_production_issue('${prod}', '${T}', 100) as o`))[0].o
  const pl = await n(`select count(*) from cost_prod_lots`)
  await refuses(
    apply(U.prod, 'production', 40, [{ order_id: order, produced_on: T, output_kg: '50', note: '', inputs: [{ lot_id: lot.id, qty_kg: '101' }] }]),
    /cost_lot_short/,
    '잔량을 넘는 투입이 들어갔다',
  )
  assert.equal(await n(`select count(*) from cost_prod_lots`), pl, '투입 거부 뒤 생산 LOT가 남았다')
  await apply(U.prod, 'production', 41, [{ order_id: order, produced_on: T, output_kg: '50', note: '', inputs: [{ lot_id: lot.id, qty_kg: '30' }] }])
  assert.equal(await n(`select count(*) from cost_prod_inputs`), 1)
  await refuses(apply(U.buy, 'production', 42, [{ order_id: order, produced_on: T, output_kg: '5', note: '', inputs: [{ lot_id: lot.id, qty_kg: '1' }] }], { stamp: '0'.repeat(32) }), /cost_not_found/, '구매 입력이 생산을 넣었다')

  // ── 하루 20번 ──
  for (let i = 0; i < 19; i += 1) await apply(U.buy2, 'suppliers', 100 + i, [{ name: `가짜공급${i}`, country: '', currency_default: 'KRW', contact: '', terms: '', note: '' }])
  assert.equal(await n(`select count(*) from cost_imports where created_by = '${U.buy2}' and target = 'suppliers'`), 19)
  await apply(U.buy2, 'suppliers', 200, [{ name: '가짜공급끝', country: '', currency_default: 'KRW', contact: '', terms: '', note: '' }])
  await refuses(apply(U.buy2, 'suppliers', 201, [{ name: '가짜공급넘침', country: '', currency_default: 'KRW', contact: '', terms: '', note: '' }]), /cost_import_too_many/, '하루 20번을 넘겨 넣었다')

  // ── 빼기: 구매 첨부 파일은 대표만 ──
  await as(U.buy, `insert into cost_purchase_docs (business_id, kind, file_name, mime, size_bytes, sha256, storage_path, mix_checked)
               values ('biz_dy', 'quote', 'q.pdf', 'application/pdf', 10, '${SHA(9)}', 'biz_dy/x/q.pdf', true)`)
  const doc = (await owner<{ id: string }>(`select doc_id::text as id from cost_purchase_docs`))[0].id
  assert.equal((await as<{ v: boolean }>(U.buy2, `select cost_doc_object_visible('biz_dy/x/q.pdf') as v`))[0].v, false, '다른 구매 담당이 첨부 파일을 내려받을 수 있다')
  assert.equal((await as<{ v: boolean }>(U.cost, `select cost_doc_object_visible('biz_dy/x/q.pdf') as v`))[0].v, false, '원가 관리가 첨부 파일을 내려받을 수 있다')
  assert.equal((await as<{ v: boolean }>(U.chair, `select cost_doc_object_visible('biz_dy/x/q.pdf') as v`))[0].v, true, '대표가 첨부 파일을 못 내려받는다')
  await refuses(as(U.buy, `select cost_purchase_doc_download_log('${doc}')`), /cost_not_found/, '대표 외가 내려받기 감사 함수를 불렀다')
  await as(U.chair, `select cost_purchase_doc_download_log('${doc}')`)
  assert.equal(await n(`select count(*) from audit_log where action = 'export' and entity_table = 'cost_purchase_docs'`), 1, '대표 내려받기 감사가 없다')

  // ── 감사 줄 읽기 범위: 영업은 엑셀 감사 줄을 못 본다 ──
  assert.equal(Number((await as<{ n: number }>(U.sales, `select count(*)::int as n from audit_log where note like '엑셀 넣기%'`))[0].n), 0, '영업이 엑셀 감사 줄을 읽는다')
  assert.equal(Number((await as<{ n: number }>(U.sales, `select count(*)::int as n from cost_imports`))[0].n), 0, '영업이 엑셀 기록을 읽는다')
  console.log('  ① DB — 대상 7종 · 권한 · 해시 · 도장 · 바꾸기 · 알림 · 이상치 · 잔량 · BOM · 한도 · 첨부 대표만: PASS')
}

// ── ② 계획 ──
function planChecks() {
  const today = '2026-10-11'
  const ctx: PlanContext = {
    target: 'market_prices',
    today,
    chairman: false,
    materials: [{ material_id: 'mat_aaaa', business_id: 'b', name: '가짜원료가', spec: '', category: 'main', active: true, note: '', updated_at: '' }],
    suppliers: [],
    market: [
      { price_id: 1, business_id: 'b', material_id: 'mat_aaaa', observed_on: '2026-10-01', price: 1000, currency: 'KRW', fx_rate: 1, price_krw_per_kg: 1000, source_name: '출처A', source_url: null, note: '', created_at: '2026-10-01T00:00:00Z', voided_at: null, void_reason: null },
    ],
    lots: [],
    overheads: [],
    products: [],
    orders: [],
    prodLots: [],
    balances: [],
    bomVersions: [],
    fx: {},
  }
  const grid = (rows: string[][]): GridSheet[] => [{ name: '시장가', rows: rows.map((r) => r.map((v) => ({ v }))) }]
  const sheet = grid([
    ['원료', '날짜', '가격', '출처'],
    ['가짜원료가', '2026-10-01', '1000', '출처A'], // 2: 같은 줄
    ['가짜원료가', '2026-10-01', '1200', '출처A'], // 3: 충돌(기존)
    ['가짜원료가', '2026-10-02', '1000', '출처B'], // 4: 새 줄
    ['가짜원료가', '2026-10-03', '1000', '출처C'], // 5: 파일 안 충돌
    ['가짜원료가', '2026-10-03', '1100', '출처C'], // 6: 파일 안 충돌
    ['없는원료', '2026-10-02', '1000', '출처B'], // 7: 오류
    ['가짜원료가', '2026-10-04', '1000', '출처D'], // 8: 새 줄
    ['가짜원료가', '2026-10-04', '1000', '출처D'], // 9: 파일 안 같은 줄
  ])
  const p0 = planImport('market_prices', sheet, {}, ctx)
  assert.equal(p0.mappingConfirmed, false)
  assert.match(p0.locked ?? '', /칸 지정/, '칸 지정을 확인하지 않았는데 잠기지 않았다')
  const mapping = p0.mapping
  assert.deepEqual([mapping.material, mapping.date, mapping.price, mapping.source], [0, 1, 2, 3], '머리글 짐작이 틀렸다')
  const st = (p: ReturnType<typeof planImport>) => Object.fromEntries(p.rows.map((r) => [r.row, r.status]))
  const p1 = planImport('market_prices', sheet, { mapping }, ctx)
  assert.deepEqual(st(p1), { 2: 'same', 3: 'conflict', 4: 'new', 5: 'conflict', 6: 'conflict', 7: 'error', 8: 'new', 9: 'same' }, `상태가 틀렸다 ${JSON.stringify(st(p1))}`)
  assert.ok(p1.locked, '오류 · 충돌이 있는데 등록이 열렸다')
  assert.match(p1.rows.find((r) => r.row === 7)!.message, /먼저 원료 엑셀/, '못 찾은 원료 안내가 없다')
  // 고치기: 7행 원료 이름 · 6행 가격을 고친다 → 오류 · 파일 안 충돌이 풀린다
  const edits = { '7': { material: '가짜원료가' }, '6': { price: '1000' } }
  const p2 = planImport('market_prices', sheet, { mapping, edits }, ctx)
  const s2 = st(p2)
  assert.equal(s2[7], 'same', '고친 7행이 4행과 같은 줄로 읽히지 않았다')
  assert.equal(s2[6], 'same', '고친 6행이 5행과 같은 줄이 아니다')
  assert.deepEqual(p2.rows.find((r) => r.row === 6)!.edited, ['price'], '고친 칸 표시가 없다')
  assert.ok(p2.edits.some((e) => e.row === 6 && e.from === '1100' && e.to === '1000'), '감사의 «파일 값 → 고친 값»이 없다')
  // 충돌 처리: 바꾸기 이유 없음 → 잠김 · 이유 → 열림
  const p3 = planImport('market_prices', sheet, { mapping, edits, choices: { '3': { choice: 'replace' } } }, ctx)
  assert.match(p3.locked ?? '', /이유/, '이유 없는 바꾸기가 잠기지 않았다')
  const p4 = planImport('market_prices', sheet, { mapping, edits, choices: { '3': { choice: 'replace', reason: '정정' } } }, ctx)
  assert.equal(p4.locked, null, `다 고쳤는데 잠겼다: ${p4.locked}`)
  assert.equal(p4.payloads.length, 4, '등록 줄 수가 틀렸다(3 바꾸기 · 4 · 5 · 8)')
  assert.ok(p4.payloads.some((x) => 'replace_id' in x && x.replace_id === '1'), '바꾸기 줄에 기존 id가 없다')
  // «둘 다 맞음»은 구분 칸이 다를 때만 — 시장가는 기준에 출처가 들어 있어 고를 수 없다
  const p5 = planImport('market_prices', sheet, { mapping, edits, choices: { '3': { choice: 'both' } } }, ctx)
  assert.match(p5.locked ?? '', /둘 다 맞음/, '구분 칸이 같은데 «둘 다 맞음»이 됐다')
  // 이상치(대표 외): 어제까지 줄 셋 · 중앙값 1000 → 6000은 오류
  const old = (d: string, id: number) => ({ ...ctx.market[0], price_id: id, observed_on: d, source_name: `s${id}` })
  const ctx2 = { ...ctx, market: [old('2026-10-01', 11), old('2026-10-02', 12), old('2026-10-03', 13)] }
  const outl = planImport('market_prices', grid([['원료', '날짜', '가격', '출처'], ['가짜원료가', '2026-10-05', '6000', 'x']]), { mapping }, ctx2)
  assert.equal(outl.rows[0].status, 'error', '이상치가 미리보기에서 걸리지 않았다')
  assert.equal(planImport('market_prices', grid([['원료', '날짜', '가격', '출처'], ['가짜원료가', '2026-10-05', '6000', 'x']]), { mapping }, { ...ctx2, chairman: true }).rows[0].status, 'new', '대표에게 이상치가 걸렸다')
  // 구매 LOT: 값까지 같으면 중복 의심 · «그래도 넣기» 전 잠김
  const lctx: PlanContext = {
    ...ctx,
    target: 'purchase_lots',
    suppliers: [{ supplier_id: 'sup_aaaa', business_id: 'b', name: '가짜공급', country: '', currency_default: 'KRW', contact: '', terms: '', active: true, note: '', updated_at: '' }],
    lots: [{ lot_id: 'PL-20261001-AAAAAA', business_id: 'b', material_id: 'mat_aaaa', supplier_id: 'sup_aaaa', received_on: '2026-10-01', ordered_on: null, supplier_lot_no: 'L1', qty_kg: 100, unit_price: 1000, currency: 'KRW', fx_rate: 1, freight_krw: 0, duty_krw: 0, other_krw: 0, goods_krw: 100000, landed_krw_per_kg: 1000, source: 'manual', source_ref: null, note: '', created_at: '2026-10-01T00:00:00Z', voided_at: null, void_reason: null }],
  }
  const lsheet = grid([
    ['원료', '공급처', '입고일', 'kg', '단가', '공급처 LOT 번호'],
    ['가짜원료가', '가짜공급', '2026-10-01', '100', '1000', ''],
    ['가짜원료가', '가짜공급', '2026-10-01', '100', '1100', 'L2'],
  ])
  const lm = planImport('purchase_lots', lsheet, {}, lctx).mapping
  const lp = planImport('purchase_lots', lsheet, { mapping: lm }, lctx)
  assert.deepEqual(st(lp), { 2: 'duplicate', 3: 'conflict' }, `LOT 상태가 틀렸다 ${JSON.stringify(st(lp))}`)
  assert.equal(lp.rows[1].canBoth, true, 'LOT 번호가 다른데 «둘 다 맞음»을 못 고른다')
  const lp2 = planImport('purchase_lots', lsheet, { mapping: lm, dupOk: [2], choices: { '3': { choice: 'both' } } }, lctx)
  assert.equal(lp2.locked, null, `중복 확인 · 둘 다 맞음 뒤에도 잠겼다: ${lp2.locked}`)
  console.log('  ② 계획 — 새 줄 · 같은 줄 · 충돌 · 파일 안 충돌 · 중복 의심 · 오류 · 고치기 · 바꾸기 이유 · 이상치 · 잠김: PASS')
}

// ── ③ 빈 양식 ──
async function templateChecks() {
  const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  const src = code('src/lib/cost-import/template.ts')
  assert.ok(!/repository|supabase|getRepository|currentUser/.test(src), '빈 양식이 저장소를 부른다')
  const route = code('src/app/(dashboard)/cost-import/template/[target]/route.ts')
  assert.ok(!/getRepository|repository|supabase/.test(route), '빈 양식 라우트가 저장소를 부른다')
  for (const t of IMPORT_TARGETS) {
    const wb = buildImportTemplate(t)
    const allowed = new Set<string>(['칸', '꼭', '설명', '예', ''])
    for (const f of IMPORT_FIELDS[t]) [f.label, f.example, f.hint].forEach((x) => allowed.add(x))
    const strays: string[] = []
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        row.eachCell((c) => {
          const v = String(c.value ?? '')
          if (!allowed.has(v) && !v.startsWith('2행은 예시') && !v.startsWith('이름(원료') && !v.startsWith('이미 있는 자료')) strays.push(v)
        }),
      ),
    )
    assert.deepEqual(strays, [], `빈 양식(${t})에 고정 문구가 아닌 칸이 있다`)
    const data = wb.worksheets[0]
    assert.equal(data.rowCount, 2, `빈 양식(${t})에 머리글 · 예시 말고 줄이 있다`)
  }
  console.log('  ③ 빈 양식 — 저장소 0 · 고정 문구만 · 머리글 + 예시 한 줄: PASS')
}

// ── ④ 빼기 경로 0 ──
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}
function exportChecks() {
  const roots = [
    'src/app/(dashboard)/purchasing',
    'src/app/(dashboard)/production',
    'src/app/(dashboard)/costs',
    'src/app/(dashboard)/cost-import',
    'src/components/purchasing',
    'src/components/production',
    'src/components/costs',
    'src/components/cost',
    'src/components/bom',
    'src/components/cost-import',
    'src/lib/cost-import',
    'src/lib/purchasing',
    'src/lib/costs',
  ]
  const files = [...roots.flatMap(walk), 'src/app/actions/purchasing.ts', 'src/app/actions/production.ts', 'src/app/actions/costs.ts', 'src/app/actions/bom.ts', 'src/app/actions/cost-import.ts']
  const EXPORT = /writeBuffer|text\/csv|navigator\.clipboard|createObjectURL|\.csv['"`]|toCSV|exportCsv|download=|window\.print/
  const allowed = new Map([
    ['src/lib/cost-import/template.ts', '빈 양식'],
    ['src/app/(dashboard)/cost-import/template/[target]/route.ts', '빈 양식'],
    ['src/components/cost-import/cost-import-panel.tsx', '빈 양식 링크'],
    ['src/components/purchasing/purchase-docs.tsx', '대표만 첨부 내려받기'],
    ['src/lib/purchasing/doc-rules.ts', '받는 형식 목록(text/csv 첨부)'],
    ['src/lib/purchasing/doc-screen.ts', '받은 CSV 검사'],
  ])
  const hits = files.filter((f) => EXPORT.test(readFileSync(f, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))).map((f) => f.replace(/\\/g, '/'))
  const stray = hits.filter((f) => !allowed.has(f))
  assert.deepEqual(stray, [], `원가 엔진에 빼기 경로가 남았다: ${stray.join(', ')}`)
  // 대표 예외는 서버에서도 막는다
  const act = readFileSync('src/app/actions/purchasing.ts', 'utf8')
  assert.ok(/user\.role !== 'Chairman'[\s\S]{0,200}logPurchaseDocDownload/.test(act), '첨부 내려받기 액션이 대표만 · 감사 먼저가 아니다')
  const docs = readFileSync('src/components/purchasing/purchase-docs.tsx', 'utf8')
  assert.ok(/canDownload \?/.test(docs), '첨부 내려받기 버튼이 대표에게만 그려지지 않는다')
  const panel = readFileSync('src/components/cost-import/cost-import-panel.tsx', 'utf8')
  assert.ok(!/회장/.test(panel), '엑셀 넣기 화면에 «회장»')
  // 템플릿 링크 말고 다른 다운로드가 패널에 없다
  assert.ok(!/createObjectURL|clipboard|writeBuffer/.test(panel), '엑셀 넣기 화면에 내보내기 · 복사')
  // AI 도구 · 첨부 요약이 원가 엑셀을 부르지 않는다
  for (const f of walk('src/lib/ai').concat(walk('src/lib/attachments'), walk('src/lib/intake'))) {
    const s = readFileSync(f, 'utf8')
    assert.ok(!/cost-import|cost_import|readCostWorkbook|bom/i.test(s.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')), `AI 경로가 원가 엑셀 · BOM을 부른다: ${f}`)
  }
  console.log('  ④ 빼기 경로 0(대표 첨부 · 빈 양식 예외) · AI 경로 0: PASS')
}

async function main() {
  planChecks()
  await templateChecks()
  exportChecks()
  await dbChecks()
  console.log('check:cost-import PASS')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
