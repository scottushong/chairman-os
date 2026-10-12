/**
 * docs/onboarding/staging-tests/0061_0065_staging_test.sql을 PGlite에서 미리 돌린다 — staging과 비슷한 조건:
 *   · 사람: 회장 · rehearsal.staff@example.com · rehearsal.member@example.com(이메일로 찾는다 — 파일과 같다).
 *   · Vault 키 cost_bom_key가 있다(staging에 있음 — 2026-10-10 회장 확인).
 *   · (가) 0시 기준은 진짜 정의 그대로(PIN_SALES_IMMEDIATE를 걸지 않는다) — staging 2차 FAIL d가 바로 이것이었다.
 *   · biz_dy에 이 시험 밖의 원료 · 시세 · LOT · BOM이 이틀 전부터 있다(«기존 원료가 섞인 회사»).
 * 파일이 «0061-0065 STAGING PASS»로 끝나는지, 아무것도 남기지 않는지 본다. staging에는 쓰지 않는다.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

import { applyOne, MIGRATIONS, SUPABASE_STUBS } from './pglite'

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
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) await applyOne(db, f)

  const chair = '00000000-0000-0000-0000-00000061c001'
  const staff = '00000000-0000-0000-0000-00000061c002'
  const member = '00000000-0000-0000-0000-00000061c003'
  const buyer = '00000000-0000-0000-0000-00000061c004'
  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    insert into auth.users (id, email) values ('${chair}', 'chair@x'), ('${staff}', 'rehearsal.staff@example.com'),
      ('${member}', 'Rehearsal.Member@example.com'), ('${buyer}', 'buyer@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${chair}', 'Chairman', '회장', 'Vault'), ('${staff}', 'Member', '리허설 직원', 'Normal'),
      ('${member}', 'Member', '리허설 사원', 'Normal'), ('${buyer}', 'Member', '기존 구매', 'Normal');
    insert into user_business_access values ('${staff}', 'biz_dy'), ('${member}', 'biz_dy'), ('${buyer}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values ('${buyer}', '/purchasing/biz_dy', true, false);
    -- staging 0059 전제: 리허설 사원의 상사 = 대표.
    update user_profiles set reports_to = '${chair}' where user_id in ('${member}', '${staff}');
  `)
  const as = async (uid: string, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const rows = (await db.query<Record<string, string>>(sql)).rows
      await db.exec('commit')
      return rows
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  // 기존 원료 둘 · 시세 · LOT · 제품 BOM(완전) — 이틀 전에 들어온 것으로 돌린다.
  const [{ o1 }] = await as(buyer, `insert into cost_materials (business_id, name) values ('biz_dy', '기존 가짜 원료 1') returning material_id as o1`)
  const [{ o2 }] = await as(buyer, `insert into cost_materials (business_id, name) values ('biz_dy', '기존 가짜 원료 2') returning material_id as o2`)
  const [{ s }] = await as(buyer, `insert into cost_suppliers (business_id, name) values ('biz_dy', '기존 공급처') returning supplier_id as s`)
  await as(buyer, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name)
    values ('biz_dy', '${o1}', cost_today() - 5, 500, '기존'), ('biz_dy', '${o2}', cost_today() - 5, 700, '기존')`)
  await as(buyer, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price)
    values ('biz_dy', '${o1}', '${s}', cost_today() - 5, 1000, 480), ('biz_dy', '${o2}', '${s}', cost_today() - 5, 1000, 690)`)
  const [{ p }] = await as(chair, `insert into cost_products (business_id, name) values ('biz_dy', '기존 가짜 제품') returning product_id as p`)
  await as(chair, `select cost_bom_save('${p}', cost_today() - 30, 100,
    jsonb_build_array(jsonb_build_object('material_id', '${o1}', 'kg_per_kg', 0.5), jsonb_build_object('material_id', '${o2}', 'kg_per_kg', 0.5)), '기존')`)
  await db.exec(`set session_replication_role = replica;
    update cost_materials set created_at = now() - interval '2 days';
    update cost_market_prices set created_at = now() - interval '2 days';
    update cost_purchase_lots set created_at = now() - interval '2 days';
    update cost_secret.bom_versions set created_at = now() - interval '2 days';
    set session_replication_role = origin;
    delete from cost_secret.cost_reads;`)
  const before = (await db.query<{ n: number }>(`select (select count(*) from cost_materials) + (select count(*) from cost_products)
    + (select count(*) from cost_secret.bom_versions) + (select count(*) from cost_purchase_lots) + (select count(*) from user_module_access) as n`)).rows[0].n

  const runFile = async (name: string) => {
    const sql = readFileSync(join(__dirname, '..', 'docs', 'onboarding', 'staging-tests', name), 'utf8')
    let msg = ''
    try {
      await db.exec(sql)
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    try {
      await db.exec('rollback')
    } catch {
      // 이미 끝난 트랜잭션
    }
    console.log(`${name}: ${msg}`)
    return msg
  }
  const message = await runFile('0061_0065_staging_test.sql')
  assert.match(message, /^0061-0065 STAGING PASS /, 'staging 시험 SQL이 PASS로 끝나지 않는다')
  assert.match(message, /d\(오늘 넣은 값 영업 NULL · 대표 즉시 · «내일» 영업 1원/, '(가) 두 단계(d1 · d2)를 돌지 않았다')
  const after = (await db.query<{ n: number }>(`select (select count(*) from cost_materials) + (select count(*) from cost_products)
    + (select count(*) from cost_secret.bom_versions) + (select count(*) from cost_purchase_lots) + (select count(*) from user_module_access) as n`)).rows[0].n
  assert.equal(Number(after), Number(before), 'staging 시험 SQL이 줄을 남겼다')
  // 트리거가 다시 켜져 있다(파일이 끄고 켠다 — 되돌림과 별개로 확인).
  const off = (await db.query<{ n: number }>(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname in ('cost_materials', 'cost_market_prices', 'cost_purchase_lots') and not t.tgisinternal and t.tgenabled = 'D'`)).rows[0].n
  assert.equal(off, 0, '트리거가 꺼진 채 남았다')

  // 0066이 있는 브랜치(feat/cost-engine)에서만 — 견적 · 가격 예외 결재.
  if (files.includes('0066_quotes.sql')) {
    const m66 = await runFile('0066_staging_test.sql')
    assert.match(m66, /^0066 STAGING PASS a\(.*b\(Red .*사슬 1칸 → 대표 승인 → 확정\) c\(.*d\(.*e\(anon 거부\)$/, '0066 staging 시험 SQL이 PASS로 끝나지 않는다')
    const left = (await db.query<{ n: number }>(`select (select count(*) from quotes) + (select count(*) from decisions where template_key = 'price_exception') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0066 staging 시험 SQL이 견적 · 결재를 남겼다')
  }
  // 0068(엑셀 넣기)이 있는 브랜치에서만.
  if (files.includes('0068_cost_import.sql')) {
    const m68 = await runFile('0068_staging_test.sql')
    assert.match(m68, /^0068 STAGING PASS a\(.*b\(.*c\(.*d\(.*e\(.*f\(anon 거부\)$/, '0068 staging 시험 SQL이 PASS로 끝나지 않는다')
    const left = (await db.query<{ n: number }>(`select (select count(*) from cost_imports) + (select count(*) from cost_materials where name like '스테이징 엑셀%') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0068 staging 시험 SQL이 엑셀 기록 · 원료를 남겼다')
  }
  // 0070(회계 · 재무 자료 올리기 v2)이 있는 브랜치에서만.
  if (files.includes('0070_finance_upload.sql')) {
    const m70 = await runFile('0070_staging_test.sql')
    assert.match(m70, /^0070 STAGING PASS a\(.*b\(.*c\(.*d\(.*e\(.*f\(anon 거부\)$/, '0070 staging 시험 SQL이 PASS로 끝나지 않는다')
    const left = (await db.query<{ n: number }>(`select (select count(*) from fin_uploads) + (select count(*) from fin_sales_lines)
      + (select count(*) from closings where period = '2099-02') as n`)).rows[0].n
    assert.equal(Number(left), 0, '0070 staging 시험 SQL이 올리기 · 줄 · 마감 줄을 남겼다')
  }
  await db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
