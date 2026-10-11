/**
 * 원가 엔진(0061 · 0062) 검사 — npm run check:cost-engine
 *
 * check-migrations.ts와 따로 둔다: 브랜치끼리 합칠 때 그 파일의 시험 함수가 엇갈려 붙은 일이 있다(2026-10-08).
 * PGlite에 전 마이그레이션을 올리고(scripts/pglite.ts의 Supabase 기본 GRANT 흉내 + **함수 기본 권한 흉내** — 리뷰 M1) 역할별로 잰다.
 *
 *   ① 권한 표(설계서 3.2)의 모든 칸 — 구매 · 생산 · 영업 · 원가 관리 · 대표 · 줄 없는 임원 · 회사 대표 · CFO · 다른 회사 · 시스템 계정 · anon
 *   ② 고치지 않는 기록(무효만) · 계산(Landed · 환율) · 위조 불가(만든 사람) · 터무니없는 값 거부
 *   ③ BOM이 대표 외에게 나가는 길 0개 — 스키마 · 표 · 뷰 · 함수 · 오류 문장 · pg_stats · execute 권한
 *   ④ 원가 함수 — 합계 한 값(대표 외 1원 · 대표 원래 값) · 대표 외 기준일 오늘 하나 · 매일 최신(입력 · 무효 · BOM · 새 원료가 바로 비친다) ·
 *      회사 단위 계산 여부 · 구매 겸직 거부 · 이유 코드 하나 · 원료비 영향 0.1%p(7일 전 → 오늘) · 한도 · 감사
 *   ⑧ 정밀도(회장 결정 2026-10-09 밤 «반올림 없이 1원까지») — 여러 LOT · 환율 · 부대비가 섞인 원가를 유리수로 직접 계산한 값과 비교,
 *      1원 끝자리 오차 0, 표시값 차 ≠ 원값 차인 경우를 일부러 만들어 원값으로 계산하는지
 *   ⑤ 구매 결재 → LOT 후보 · 구매 첨부 버킷 · 영업 요약(지난 달 · 3건) · 생산 제한(오늘만)
 *   ⑥ BYPASSRLS 없는 소유자(Supabase 실제 조건 — 리뷰 C1)에서도 정의자 함수가 산다
 *   ⑦ 코드 경계 — AI 도구가 BOM · 원가 함수를 부르지 않는다
 *
 * 날짜는 오늘(KST) 기준 상대값이다 — 대표 외 기준일이 «오늘»로 고정되기 때문(회장 결정 2026-10-09 밤 «매일 최신»).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

import { applyOne, MIGRATIONS, SUPABASE_STUBS } from './pglite'
import { encryption } from './cost-engine-encryption'
import { q4, qadd, qdiv, qfrac, qmul, qnear, Qof, qround, qsub, qsum, type Q } from './cost-rational'
import { knownCutoff, PIN_SALES_IMMEDIATE } from './cost-engine-known'
import { overheads } from './cost-engine-overheads'
import { quotes } from './cost-engine-quotes'
import { sales } from './cost-engine-sales'
import { production } from './cost-engine-production'

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
  both: '00000000-0000-0000-0000-0000000061ab', // 구매 입력 + 원가 관리(겸직 — 리뷰 C2)
  both2: '00000000-0000-0000-0000-0000000061ac', // 구매 입력 + 영업
  sp: '00000000-0000-0000-0000-0000000061ad', // 영업 + 생산(리뷰 5회차 I1)
  sr: '00000000-0000-0000-0000-0000000061ae', // 영업 + 구매 읽기만(리뷰 5회차 I1)
}

const FAKE_MATERIAL_NAMES = ['가짜원료알파', '가짜원료베타', '가짜원료감마', '가짜원료델타']

async function main() {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } })
  // Supabase는 public의 새 함수에도 anon · authenticated execute를 기본으로 준다(리뷰 M1) — pglite.ts의 표 흉내에 함수 한 줄을 더해 올린다.
  await db.exec(SUPABASE_STUBS + '\n alter default privileges in schema public grant all on functions to anon, authenticated;')
  // 0063 — Supabase에는 pgcrypto(extensions)와 Vault가 기본으로 있다. Vault는 표 하나 + decrypted_secrets 뷰로 흉내 낸다(authenticated 권한 없음).
  // 키는 bom-key-setup.md와 같은 식으로 DB 안에서 만든다(글자로 보지 않는다).
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
  // (가) — 앞 절들은 영업도 즉시로 잰다(계산 · 정밀도 단언). ⑫ knownCutoff가 진짜 0시 기준으로 되돌려 따로 잰다.
  await db.exec(PIN_SALES_IMMEDIATE)
  assert.ok(files.includes('0061_cost_engine_base.sql') && files.includes('0062_cost_secret_bom.sql'), '0061 · 0062가 없다')

  const owner = async <T,>(sql: string) => (await db.query<T>(sql)).rows
  const [{ t, m }] = await owner<{ t: string; m: string }>(`select cost_today()::text as t, cost_today()::text as m`)
  // M = 대표 외 기준일(오늘). 주간 스냅샷(월요일)은 회장 결정 2026-10-09 밤으로 없앴다 — 이름만 남겨 아래 날짜(M3 = 사흘 전 …)를 그대로 쓴다.
  const T = t
  const M = m
  const d = async (expr: string) => (await owner<{ v: string }>(`select (${expr})::date::text as v`))[0].v
  const M3 = await d(`'${M}'::date - 3`)
  const M4 = await d(`'${M}'::date - 4`)
  const M5 = await d(`'${M}'::date - 5`)
  const M10 = await d(`'${M}'::date - 10`)
  const PM = await d(`date_trunc('month', '${T}'::date) - interval '1 month'`) // 지난 달 1일

  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    insert into auth.users (id, email) values
      ('${U.chair}', 'c@x'), ('${U.buy}', 'b@x'), ('${U.prod}', 'p@x'), ('${U.sales}', 's@x'), ('${U.cost}', 'k@x'),
      ('${U.exec}', 'e@x'), ('${U.ceo}', 'o@x'), ('${U.vana}', 'v@x'), ('${U.agent}', 'a@x'), ('${U.cfo}', 'f@x'),
      ('${U.both}', 'bo@x'), ('${U.both2}', 'bs@x'), ('${U.sp}', 'sp@x'), ('${U.sr}', 'sr@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${U.chair}', 'Chairman', '대표', 'Vault'), ('${U.buy}', 'Member', '구매', 'Normal'), ('${U.prod}', 'Member', '생산', 'Normal'),
      ('${U.sales}', 'Member', '영업', 'Normal'), ('${U.cost}', 'Member', '경영지원', 'Normal'), ('${U.exec}', 'Executive', '임원', 'Restricted'),
      ('${U.ceo}', 'BusinessCEO', '회사 대표', 'Restricted'), ('${U.vana}', 'Member', 'VANA', 'Normal'),
      ('${U.agent}', 'AIAgent', 'ai', 'Restricted'), ('${U.cfo}', 'GroupCFO', 'cfo', 'Restricted'),
      ('${U.both}', 'Member', '겸직1', 'Normal'), ('${U.both2}', 'Member', '겸직2', 'Normal'),
      ('${U.sp}', 'Member', '영업생산', 'Normal'), ('${U.sr}', 'Member', '영업구매읽기', 'Normal');
    update user_profiles set reports_to = '${U.sales}' where user_id = '${U.buy}'; -- 영업 담당이 구매 담당의 상사(감사 줄 subtree 시험)
    insert into user_business_access values
      ('${U.buy}', 'biz_dy'), ('${U.prod}', 'biz_dy'), ('${U.sales}', 'biz_dy'), ('${U.cost}', 'biz_dy'),
      ('${U.exec}', 'biz_dy'), ('${U.ceo}', 'biz_dy'), ('${U.vana}', 'biz_vana'), ('${U.agent}', 'biz_dy'),
      ('${U.both}', 'biz_dy'), ('${U.both2}', 'biz_dy'), ('${U.sp}', 'biz_dy'), ('${U.sr}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values
      ('${U.buy}', '/purchasing/biz_dy', true, false), ('${U.prod}', '/production/biz_dy', true, false),
      ('${U.sales}', '/sales/biz_dy', true, false), ('${U.cost}', '/costing/biz_dy', true, false),
      ('${U.vana}', '/sales/biz_dy', true, false), ('${U.vana}', '/purchasing/biz_dy', true, false),
      ('${U.agent}', '/purchasing/biz_dy', true, false), ('${U.agent}', '/sales/biz_dy', true, false), ('${U.agent}', '/costing/biz_dy', true, false),
      ('${U.both}', '/purchasing/biz_dy', true, false), ('${U.both}', '/costing/biz_dy', true, false),
      ('${U.both2}', '/purchasing/biz_dy', true, false), ('${U.both2}', '/sales/biz_dy', true, false),
      ('${U.sp}', '/sales/biz_dy', true, false), ('${U.sp}', '/production/biz_dy', true, false),
      ('${U.sr}', '/sales/biz_dy', true, false), ('${U.sr}', '/purchasing/biz_dy', false, false);
    insert into fx_rates (rate_date, base, quote, rate, source_name, source, fetched_at)
      values ('${T}'::date - 60, 'USD', 'KRW', 1400, 'test', 'manual', now());
  `)

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
  const one = async <T,>(uid: string, sql: string) => ((await run(uid, sql)) as T[])[0]
  /**
   * 넣은 줄을 «열흘 전에 들어온 것»으로 만든다 — 0061 터무니없는 값 거부의 기준이 «어제까지 들어온 줄»이라서다(원가 계산은 매일 최신 —
   * 들어온 시각을 보지 않는다). BOM 판은 판 번호 순서를 지키게 1초씩 벌린다. 트리거를 잠시 끈다.
   */
  const age = () =>
    db.exec(`set session_replication_role = replica;
      update cost_market_prices set created_at = now() - interval '10 days', voided_at = case when voided_at is null then null else now() - interval '9 days' end;
      update cost_purchase_lots set created_at = now() - interval '10 days', voided_at = case when voided_at is null then null else now() - interval '9 days' end;
      update cost_materials set created_at = now() - interval '10 days';
      update cost_secret.bom_versions set created_at = now() - interval '10 days' + version_id * interval '1 second',
        voided_at = case when voided_at is null then null else now() - interval '10 days' + version_id * interval '1 second' + interval '500 milliseconds' end;
      set session_replication_role = origin;`)

  // ── ② 구매가 기초를 넣는다 ─────────────────────────────────────────────
  const { m1 } = await one<{ m1: string }>(U.buy, `insert into cost_materials (business_id, name, created_by) values ('biz_dy', '${FAKE_MATERIAL_NAMES[0]}', '${U.sales}') returning material_id as m1`)
  const { m2 } = await one<{ m2: string }>(U.buy, `insert into cost_materials (business_id, name) values ('biz_dy', '${FAKE_MATERIAL_NAMES[1]}') returning material_id as m2`)
  const { m3 } = await one<{ m3: string }>(U.buy, `insert into cost_materials (business_id, name) values ('biz_dy', '${FAKE_MATERIAL_NAMES[2]}') returning material_id as m3`)
  const { m4 } = await one<{ m4: string }>(U.buy, `insert into cost_materials (business_id, name) values ('biz_dy', '${FAKE_MATERIAL_NAMES[3]}') returning material_id as m4`)
  const forcedId = await one<{ id: string }>(U.buy, `insert into cost_materials (material_id, business_id, name) values ('mat_sesame_oil', 'biz_dy', '참기름 시험') returning material_id as id`)
  assert.notEqual(forcedId.id, 'mat_sesame_oil', '0061: 원료 키를 사람이 지어 이름을 키에 넣을 수 있다(리뷰 5회차 M1)')
  await run(U.buy, `update cost_materials set active = false where material_id = '${forcedId.id}'`)
  assert.equal((await owner<{ c: string }>(`select created_by::text as c from cost_materials where material_id = '${m1}'`))[0].c, U.buy,
    '0061: 만든 사람을 남으로 위조할 수 있다')
  const { s1 } = await one<{ s1: string }>(U.buy, `insert into cost_suppliers (business_id, name, currency_default, contact, terms) values ('biz_dy', '가짜공급처', 'USD', '010-0000', 'FOB 30일') returning supplier_id as s1`)
  await run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, currency, source_name, price_krw_per_kg) values
    ('biz_dy', '${m1}', '${M3}', 1000, 'KRW', '구매팀 조사', 1),
    ('biz_dy', '${m2}', '${M5}', 2, 'USD', 'Platts', 1), ('biz_dy', '${m2}', '${M4}', 2, 'USD', 'Platts', 1), ('biz_dy', '${m2}', '${M3}', 2, 'USD', 'Platts', 1),
    ('biz_dy', '${m3}', '${M3}', 500, 'KRW', '구매팀 조사', 1),
    ('biz_dy', '${m1}', '${T}', 1200, 'KRW', '구매팀 조사', 1),
    ('biz_dy', '${m1}', '${M10}', 900, 'KRW', '구매팀 조사', 1), ('biz_dy', '${m2}', '${M10}', 2, 'USD', 'Platts', 1),
    ('biz_dy', '${m3}', '${M10}', 500, 'KRW', '구매팀 조사', 1)`)
  const mp = await owner<{ p: string }>(`select price_krw_per_kg::text as p from cost_market_prices where material_id = '${m2}' limit 1`)
  assert.equal(Number(mp[0].p), 2800, '0061: 외화 시장가의 원화 환산(환율 표)이 틀렸다 — 입력한 price_krw_per_kg를 믿었다?')
  await refuses(run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, currency, source_name)
    values ('biz_dy', '${m1}', '${M3}', 1, 'EUR', 'x')`), /cost_fx_missing/, '0061: 환율 없는 통화가 들어간다')
  const { lot } = await one<{ lot: string }>(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, currency,
      freight_krw, duty_krw, other_krw, landed_krw_per_kg)
    values ('biz_dy', '${m1}', '${s1}', '${M3}', 1000, 1, 'USD', 50000, 20000, 10000, 1) returning lot_id as lot`)
  const landed = await owner<{ g: string; l: string }>(`select goods_krw::text as g, landed_krw_per_kg::text as l from cost_purchase_lots where lot_id = '${lot}'`)
  assert.equal(Number(landed[0].g), 1_400_000, '0061: 물품 원화 = 단가 × 수량 × 환율이 아니다')
  assert.equal(Number(landed[0].l), 1480, '0061: Landed = (물품 + 운송 + 관세 + 부대) ÷ kg이 아니다')
  await run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price) values
    ('biz_dy', '${m2}', '${s1}', '${M3}', 500, 3000), ('biz_dy', '${m3}', '${s1}', '${M3}', 100, 600), ('biz_dy', '${m1}', '${s1}', '${M3}', 1000, 1600),
    ('biz_dy', '${m3}', '${s1}', '${PM}'::date + 1, 100, 600), ('biz_dy', '${m3}', '${s1}', '${PM}'::date + 2, 100, 600), ('biz_dy', '${m3}', '${s1}', '${PM}'::date + 3, 100, 600), ('biz_dy', '${m4}', '${s1}', '${M3}', 100, 700)`)
  // 리뷰 C2(c) · 2회차 M1 — 기준은 «어제까지 들어온 줄». 줄을 어제 이전으로 돌린 뒤 잰다.
  await age()
  // 리뷰 C2(c) — 터무니없는 값(90일 중앙값의 5배 초과 · 0.2배 미만)은 대표 외 거부.
  await refuses(run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, currency, source_name)
    values ('biz_dy', '${m2}', '${M3}', 1000000000000, 'KRW', 'zz')`), /cost_price_outlier/, '0061: 가짜 시세 1조가 들어간다')
  await refuses(run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, currency, source_name)
    values ('biz_dy', '${m2}', '${M3}', 1, 'KRW', 'zz')`), /cost_price_outlier/, '0061: 가짜 시세 1원이 들어간다')

  await refuses(run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price) values ('biz_dy', '${m3}', '${s1}', '${M3}', 1000000000, 1000000)`),
    /cost_price_outlier/, '0061: 가짜 LOT(1e6 원/kg)가 들어간다')
  await refuses(run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name)
    values ('biz_dy', '${m1}', '${T}'::date + 5, 1000, '미래')`), /cost_date_future/, '0061: 먼 미래 날짜 시세(기준 창 밖)가 들어간다')
  await run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name) values
    ('biz_dy', '${m4}', '${M3}', 700, 'a'), ('biz_dy', '${m4}', '${M3}', 700, 'b'), ('biz_dy', '${m4}', '${M3}', 700, 'c'), ('biz_dy', '${m4}', '${M10}', 700, 'a10')`)
  await refuses(run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name) values ('biz_dy', '${m4}', '${M3}', 700, 'd')`),
    /cost_price_too_many/, '0061: 같은 날 같은 원료 시세가 출처 넷 이상(중앙값 끌어올리기)')
  await run(U.buy, `update cost_market_prices set void_reason = '시험' where material_id = '${m2}'`)
  await refuses(run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, currency, source_name)
    values ('biz_dy', '${m2}', '${M3}', 1000000000000, 'KRW', 'zz2')`), /cost_price_outlier/, '0061: 진짜 줄을 무효로 해 기준을 없앤 뒤 1조 시세')
  await db.exec(`set session_replication_role = replica; update cost_market_prices set voided_at = null, voided_by = null, void_reason = null where material_id = '${m2}'; set session_replication_role = origin;`)

  // 고치지 않는다 — 무효만.
  await refuses(run(U.buy, `update cost_purchase_lots set unit_price = 2 where lot_id = '${lot}'`), /permission denied/, '0061: LOT 단가를 고칠 수 있다')
  await refuses(run(U.buy, `update cost_market_prices set price = 1 where material_id = '${m1}'`), /permission denied/, '0061: 시장가를 고칠 수 있다')
  await refuses(run(U.buy, `delete from cost_purchase_lots where lot_id = '${lot}'`), /permission denied/, '0061: LOT를 지울 수 있다')
  await refuses(run(U.buy, `update cost_market_prices set void_reason = '' where material_id = '${m3}'`), /cost_void_reason/, '0061: 이유 없는 무효')
  await refuses(run(U.buy, `select setval('cost_market_prices_price_id_seq', 1)`), /permission denied/, '0061: 시퀀스를 되감는다(리뷰 M3)')
  await refuses(run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price) values ('biz_vana', '${m1}', '${s1}', '${M3}', 1, 1)`),
    /row-level security|foreign key/, '0061: 다른 회사 LOT에 DY 원료를 붙인다')

  // ── ① 권한 표 — 표 읽기 ────────────────────────────────────────────────
  const tables = ['cost_materials', 'cost_suppliers', 'cost_market_prices', 'cost_purchase_lots', 'cost_products']
  const { p1 } = await one<{ p1: string }>(U.cost, `insert into cost_products (business_id, name) values ('biz_dy', '가짜제품 1') returning product_id as p1`)
  const { p2 } = await one<{ p2: string }>(U.cost, `insert into cost_products (business_id, name) values ('biz_dy', '가짜제품 BOM 없음') returning product_id as p2`)
  const { p3 } = await one<{ p3: string }>(U.cost, `insert into cost_products (business_id, name) values ('biz_dy', '가짜제품 시세 없는 원료') returning product_id as p3`)
  await refuses(run(U.sales, `insert into cost_products (business_id, name) values ('biz_dy', 'x')`), /row-level security/, '0061: 영업이 제품을 만든다')
  const expect: Record<string, Record<string, boolean>> = {
    [U.buy]: { cost_materials: true, cost_suppliers: true, cost_market_prices: true, cost_purchase_lots: true, cost_products: true },
    [U.prod]: { cost_materials: true, cost_suppliers: false, cost_market_prices: false, cost_purchase_lots: false, cost_products: true },
    // 회장 결정(2026-10-09) — 영업은 제품 총액만: 원료 이름 · 원료별 시세 · 구매가 · LOT 0.
    [U.sales]: { cost_materials: false, cost_suppliers: false, cost_market_prices: false, cost_purchase_lots: false, cost_products: true },
    [U.cost]: { cost_materials: true, cost_suppliers: true, cost_market_prices: true, cost_purchase_lots: true, cost_products: true },
    [U.chair]: { cost_materials: true, cost_suppliers: true, cost_market_prices: true, cost_purchase_lots: true, cost_products: true },
  }
  for (const [uid, row] of Object.entries(expect)) {
    for (const tb of tables) {
      const n = await count(uid, tb)
      assert.equal(n > 0, row[tb], `0061 권한 표: ${uid.slice(-2)} · ${tb} = ${n}행(기대 ${row[tb] ? '보임' : '0'})`)
    }
  }
  for (const uid of [U.exec, U.ceo, U.vana, U.agent, U.cfo]) {
    for (const tb of tables) assert.equal(await count(uid, tb), 0, `0061: 줄 없는 사람 · 다른 회사 · 시스템 계정(${uid.slice(-2)})이 ${tb}를 본다`)
  }
  for (const tb of [...tables, 'cost_purchase_docs']) {
    await refuses(as(null, `select 1 from ${tb}`), /permission denied/, `0061: anon이 ${tb}를 읽는다`)
  }
  await refuses(run(U.sales, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name) values ('biz_dy', '${m1}', '${T}', 1, 'x')`),
    /row-level security/, '0061: 영업이 시장가를 넣는다')
  await refuses(run(U.agent, `insert into cost_materials (business_id, name) values ('biz_dy', 'ai원료')`), /row-level security/, '0061: AIAgent가 원료를 넣는다')

  // 생산 «제한»: 오늘 한 값만(리뷰 I7).
  const plots = await as<Record<string, unknown>>(U.prod, `select * from cost_production_lots('biz_dy')`)
  assert.ok(plots.length >= 4, '0061: 생산이 LOT 목록을 못 본다')
  assert.deepEqual(Object.keys(plots[0]).sort(),
    ['landed_krw_per_kg', 'lot_id', 'material_id', 'material_name', 'qty_kg', 'received_on', 'remaining_kg', 'supplier_lot_no', 'supplier_name'],
    '0061: 생산 LOT 함수가 «제한» 밖의 칸(외화 단가 · 환율 · 부대비 · 연락처)을 돌려준다')
  const pmat = await as<Record<string, string>>(U.prod, `select * from cost_production_materials('biz_dy', '${M3}')`)
  assert.deepEqual(Object.keys(pmat[0]).sort(), ['category', 'market_krw_per_kg', 'material_id', 'name'], '0061: 생산 시장가 함수의 칸')
  assert.equal(Number(pmat.find((r) => r.material_id === m1)!.market_krw_per_kg), 1200, '0061: 생산이 지난 날짜 시세(이력)를 본다')
  const bmat = await as<Record<string, string>>(U.buy, `select * from cost_production_materials('biz_dy', '${M3}')`)
  assert.equal(Number(bmat.find((r) => r.material_id === m1)!.market_krw_per_kg), 1000, '0061: 구매는 날짜를 골라 볼 수 있어야 한다')
  await refuses(as(U.prod, `select * from cost_sales_purchase_summary('biz_dy')`), /cost_not_found/, '0061: 생산이 영업 요약을 본다')
  await refuses(as(U.sales, `select * from cost_production_lots('biz_dy')`), /cost_not_found/, '0061: 영업이 LOT 가격을 본다')
  // 회장 결정 — 영업은 원료별 요약도 못 본다.
  await refuses(as(U.sales, `select * from cost_sales_purchase_summary('biz_dy')`), /cost_not_found/, '0061: 영업이 원료별 구매가 요약을 본다')
  const fullSummary = await as<{ material_id: string; avg_purchase_krw_per_kg: string; purchase_vs_market_pct: string }>(U.buy,
    `select * from cost_sales_purchase_summary('biz_dy', 30, '${T}')`)
  const s1row = fullSummary.find((r) => r.material_id === m1)!
  assert.equal(Number(s1row.avg_purchase_krw_per_kg), 1540, '0061: 구매 요약의 수량가중 평균(1480 · 1600 각 1000kg)이 틀렸다')
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
  const cands = await as<{ decision_id: string; amount_krw: string }>(U.buy, `select * from cost_purchase_candidates('biz_dy')`)
  assert.deepEqual(cands.map((c) => c.decision_id), ['dec_c61_ok'], '0061: 결재 후보가 승인된 DY 구매 양식만이 아니다')
  assert.equal(Number(cands[0].amount_krw), 700000, '0061: 금액 쉼표를 못 읽는다')
  await refuses(as(U.sales, `select * from cost_purchase_candidates('biz_dy')`), /cost_not_found/, '0061: 영업이 결재 후보를 본다')
  await refuses(run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, source, source_ref)
    values ('biz_dy', '${m1}', '${s1}', '${M3}', 500, 1400, 'approval', 'dec_c61_open')`), /cost_candidate_invalid/, '0061: 열린 결재로 LOT를 만든다')
  await run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, source, source_ref)
    values ('biz_dy', '${m1}', '${s1}', '${M3}', 500, 1400, 'approval', 'dec_c61_ok')`)
  await refuses(run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, source, source_ref)
    values ('biz_dy', '${m1}', '${s1}', '${M3}', 500, 1400, 'approval', 'dec_c61_ok')`), /duplicate key/, '0061: 결재 한 건으로 LOT 둘')
  assert.equal((await as(U.buy, `select * from cost_purchase_candidates('biz_dy')`)).length, 0, '0061: LOT가 된 결재가 후보에 남는다')

  // 구매 첨부 버킷 — 줄이 먼저, 파일이 뒤. 영업은 못 본다. 줄 없는 파일은 못 올린다. 지우기 없음.
  const path = `biz_dy/11111111-1111-1111-1111-111111111111/q.pdf`
  await run(U.buy, `insert into cost_purchase_docs (doc_id, business_id, lot_id, kind, file_name, mime, size_bytes, sha256, storage_path, mix_checked)
    values ('11111111-1111-1111-1111-111111111111', 'biz_dy', '${lot}', 'quote', 'q.pdf', 'application/pdf', 100, '${'a'.repeat(64)}', '${path}', true)`)
  await refuses(run(U.buy, `insert into cost_purchase_docs (business_id, kind, file_name, mime, size_bytes, sha256, storage_path, mix_checked)
    values ('biz_dy', 'quote', 'q.pdf', 'application/pdf', 100, '${'b'.repeat(64)}', 'biz_vana/x/q.pdf', true)`), /check constraint/, '0061: 다른 회사 경로')
  await run(U.buy, `insert into storage.objects (bucket_id, name) values ('purchasing', '${path}')`)
  await refuses(run(U.buy, `insert into storage.objects (bucket_id, name) values ('purchasing', 'biz_dy/x/y.pdf')`), /row-level security/, '0061: 줄 없는 파일을 올린다')
  assert.equal(await count(U.sales, `storage.objects where bucket_id = 'purchasing'`), 0, '0061: 영업이 구매 첨부 파일을 본다')
  assert.equal(await count(U.cost, `storage.objects where bucket_id = 'purchasing'`), 1, '0061: 원가 관리가 구매 첨부를 못 본다')
  await run(U.buy, `delete from storage.objects where bucket_id = 'purchasing'`)
  assert.equal(await count(U.chair, `storage.objects where bucket_id = 'purchasing'`), 1, '0061: 올린 파일을 지울 수 있다(정책 없음이어야)')

  // ── ③ BOM — 대표만 ─────────────────────────────────────────────────────
  await age()
  const lines = JSON.stringify([{ material_id: m1, kg_per_kg: 0.5 }, { material_id: m2, kg_per_kg: 0.3 }, { material_id: m3, kg_per_kg: 0.25 }])
  for (const uid of [U.buy, U.prod, U.sales, U.cost, U.exec, U.ceo, U.cfo, U.agent, U.both]) {
    await refuses(as(uid, `select cost_bom_save('${p1}', '${M}'::date - 30, 100, '${lines}'::jsonb)`), /cost_not_found/, `0062: ${uid.slice(-2)}가 BOM을 쓴다`)
  }
  const { v } = await one<{ v: number }>(U.chair, `select cost_bom_save('${p1}', '${M}'::date - 30, 95, '${lines}'::jsonb, '가짜 BOM') as v`)
  assert.ok(Number(v) > 0, '0062: 대표가 BOM을 못 쓴다')
  await run(U.chair, `select cost_bom_save('${p3}', '${M}'::date - 30, 100, '[{"material_id":"${m1}","kg_per_kg":0.5},{"material_id":"${m4}","kg_per_kg":0.5}]'::jsonb)`)
  await age()
  await refuses(run(U.chair, `select cost_bom_save('${p1}', '${M}'::date - 30, 95, '[{"material_id":"${m1}","kg_per_kg":0.5},{"material_id":"${m1}","kg_per_kg":0.1}]'::jsonb)`),
    /cost_bom_invalid/, '0062: 같은 원료 두 줄')
  // 0063 — 진짜 BOM은 «진짜 BOM 받기» 스위치(기본 꺼짐)가 켜져야만.
  await refuses(run(U.chair, `select cost_bom_save('${p1}', '2027-01-01', 100, '${lines}'::jsonb, '', false)`), /cost_bom_real_locked/, '0063: 스위치 꺼진 채 진짜 BOM이 들어간다')
  await refuses(db.query(`insert into cost_secret.bom_versions (product_id, valid_from, is_fake, created_by) values ('${p1}', '2027-01-01', true, '${U.chair}')`),
    /check constraint/, '0063: 암호문 없는 판이 들어간다')
  await age() // BOM 판 · 원료를 스냅샷 앞으로

  for (const uid of [U.buy, U.prod, U.sales, U.cost, U.exec, U.ceo, U.cfo, U.agent, U.vana]) {
    for (const sql of [
      `select * from cost_secret.bom_settings`, `select * from cost_secret.bom_versions`, `select * from cost_secret.bom_access`, `select cost_secret.bom_key()`,
      `select * from cost_secret.bom_lines_of(1)`, `select * from vault.decrypted_secrets`,
      `select cost_secret.material_cost('${p1}', 'market', '${T}')`, `select cost_secret.unit_price('${m1}', 'market', '${T}')`,
    ]) {
      await refuses(as(uid, sql), /permission denied/, `0062: ${uid.slice(-2)}가 비공개 스키마에 닿는다 — ${sql}`)
    }
    await refuses(as(uid, `select * from cost_bom_get('${p1}')`), /cost_not_found/, `0062: ${uid.slice(-2)}가 BOM을 읽는다`)
    await refuses(as(uid, `select * from cost_product_breakdown('${p1}', 'market', '${T}')`), /cost_not_found/, `0062: ${uid.slice(-2)}가 원료별 분해를 본다`)
  }
  await refuses(as(null, `select * from cost_product_cost('${p1}')`), /permission denied/, '0062: anon이 원가 함수를 부른다')
  await refuses(as(null, `select * from cost_secret.bom_versions`), /permission denied/, '0062: anon이 BOM 표에 닿는다')

  // 대표: 분해 · BOM 읽기.
  const bom = await as<{ material_id: string; is_fake: boolean }>(U.chair, `select * from cost_bom_get('${p1}', '${T}')`)
  assert.equal(bom.length, 3, '0062: 대표가 BOM을 못 읽는다')
  assert.ok(bom.every((r) => r.is_fake), '0062: 가짜 표시가 없다')
  const bd = await as<{ contribution_krw_per_kg: string }>(U.chair, `select * from cost_product_breakdown('${p1}', 'market', '${T}')`)
  const marketT = (0.5 * 1200 + 0.3 * 2800 + 0.25 * 500) / 0.95
  assert.ok(Math.abs(bd.reduce((s, r) => s + Number(r.contribution_krw_per_kg), 0) - marketT) < 0.01, '0062: 분해 합이 Market 원가와 다르다')

  // 원가 관리: 합계 한 값 · 1원 · 기준일 오늘(리뷰 2회차 C1 — 날짜 인자 무시).
  const marketM = marketT
  const r1 = (x: number) => Math.sign(x) * Math.round(Math.abs(x)) || 0 // Postgres round(x, 0) — 0.5는 0에서 먼 쪽 · −0 없음
  // 회장 결정 — 영업 · 원가 관리 모두 Market · Current 총액을 본다(영업은 원료별 값을 못 보므로 두 식이 역산이 되지 않는다).
  assert.equal((await as(U.cost, `select * from cost_product_cost('${p1}', 'market')`)).length, 1, '0062: 원가 관리가 Market 총액을 못 본다')
  assert.equal((await as(U.sales, `select * from cost_product_cost('${p1}', 'current')`)).length, 1, '0062: 영업이 Current 총액을 못 본다')
  const cc = await as<Record<string, unknown>>(U.cost, `select * from cost_product_cost('${p1}', 'current', '${T}')`)
  assert.equal(cc.length, 1, '0062: 원가 함수가 한 줄이 아니다(원료 수가 응답 크기로 샌다)')
  assert.deepEqual(Object.keys(cc[0]).sort(), ['as_of', 'computed', 'kind', 'material_krw_per_kg', 'product_id', 'reason'], '0062: 원가 함수 칸')
  const m1cur = (1480 * 1000 + 1600 * 1000 + 1400 * 500) / 2500
  const currentT = (0.5 * m1cur + 0.3 * 3000 + 0.25 * 600) / 0.95
  assert.equal(cc[0].material_krw_per_kg, String(r1(currentT)), '0062: Current 원가(1원 · 오늘)가 틀렸다 — 원가 관리에게 1원 아래 자릿수가 나간다?')
  const chairCur = await as<{ material_krw_per_kg: string }>(U.chair, `select * from cost_product_cost('${p1}', 'current', '${T}')`)
  assert.ok(Math.abs(Number(chairCur[0].material_krw_per_kg) - currentT) < 1e-6, '0062: 대표 Current 원가(원래 값)가 틀렸다')
  assert.ok(!Number.isInteger(Number(chairCur[0].material_krw_per_kg)), '0062: 대표 값이 반올림됐다(원래 값이어야)')
  const old = await as<{ as_of: string }>(U.cost, `select as_of::text as as_of from cost_product_cost('${p1}', 'current', '${T}'::date - 60)`)
  assert.equal(old[0].as_of, T, '0062: 원가 관리가 오늘 밖을 본다(리뷰 2회차 C1)')
  const fut = await as<{ as_of: string }>(U.cost, `select as_of::text as as_of from cost_product_cost('${p1}', 'current', '2999-01-01')`)
  assert.equal(fut[0].as_of, T, '0062: 미래 기준일을 받는다')

  // 영업: 오늘 하나(인자 무시).
  for (const ask of [T, '2026-01-05', M3]) {
    const sc = await as<{ material_krw_per_kg: string; as_of: string }>(U.sales, `select material_krw_per_kg, as_of::text as as_of from cost_product_cost('${p1}', 'market', '${ask}')`)
    assert.equal(sc[0].as_of, T, `0062: 영업 기준일이 오늘이 아니다(요청 ${ask})`)
    assert.equal(sc[0].material_krw_per_kg, String(r1(marketM)), '0062: 영업 원가(1원)')
  }

  // 리뷰 C2 — 가짜 시세 오라클. (a) 구매 겸직은 원가를 못 본다.
  for (const uid of [U.both, U.both2]) {
    await refuses(as(uid, `select * from cost_product_cost('${p1}', 'market')`), /cost_role_conflict/, `0062: 구매 겸직(${uid.slice(-2)})이 원가를 본다`)
    await refuses(as(uid, `select cost_material_impact('${p1}', 'market', '${M3}', '${T}')`), /cost_role_conflict/, `0062: 구매 겸직(${uid.slice(-2)})이 원료비 영향을 본다`)
  }
  // (b) 매일 최신(회장 결정 2026-10-09 밤) — 오늘 넣은 LOT · 시세, 오늘 무효로 한 시세가 대표 외 원가에도 바로 비친다(쌍시간 · 주간 스냅샷 없음).
  const before = Number((await as<{ x: string }>(U.cost, `select material_krw_per_kg as x from cost_product_cost('${p1}', 'current', '${T}')`))[0].x)
  const { zlot } = await one<{ zlot: string }>(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price) values ('biz_dy', '${m2}', '${s1}', '${M3}', 100000, 4000) returning lot_id as zlot`)
  const after = Number((await as<{ x: string }>(U.cost, `select material_krw_per_kg as x from cost_product_cost('${p1}', 'current', '${T}')`))[0].x)
  const m2curZ = (3000 * 500 + 4000 * 100000) / 100500
  assert.equal(after, r1((0.5 * m1cur + 0.3 * m2curZ + 0.25 * 600) / 0.95), '0062: 오늘 넣은 LOT가 원가 관리 원가에 바로 비치지 않는다(매일 최신)')
  assert.notEqual(after, before, '0062: 오늘 넣은 LOT가 원가를 움직이지 않는다')
  await run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, currency, source_name) values ('biz_dy', '${m2}', '${M3}', 10000, 'KRW', 'zz')`)
  const salesNow = Number((await as<{ x: string }>(U.sales, `select material_krw_per_kg as x from cost_product_cost('${p1}', 'market')`))[0].x)
  assert.equal(salesNow, r1((0.5 * 1200 + 0.3 * ((2800 + 10000) / 2) + 0.25 * 500) / 0.95), '0062: 오늘 넣은 시세가 영업 원가에 바로 비치지 않는다(매일 최신)')
  await run(U.buy, `update cost_market_prices set void_reason = '시험' where material_id = '${m3}'`)
  const salesVoid = await as<{ computed: boolean; reason: string }>(U.sales, `select computed, reason from cost_product_cost('${p1}', 'market')`)
  assert.deepEqual([salesVoid[0].computed, salesVoid[0].reason], [false, 'not_computed'], '0062: 오늘 무효로 한 시세가 영업 원가에 바로 비치지 않는다')
  const chairRow = await as<{ computed: boolean; reason: string }>(U.chair, `select computed, reason from cost_product_cost('${p1}', 'market', '${T}')`)
  assert.deepEqual([chairRow[0].computed, chairRow[0].reason], [false, 'price_missing'], '0062: 대표는 지금 저장된 전부(무효 반영)로 본다')
  await db.exec(`set session_replication_role = replica;
    update cost_market_prices set voided_at = null, voided_by = null, void_reason = null where material_id = '${m3}';
    update cost_market_prices set voided_at = now(), voided_by = '${U.buy}', void_reason = '시험 정리' where source_name = 'zz';
    update cost_purchase_lots set voided_at = now(), voided_by = '${U.buy}', void_reason = '시험 정리' where lot_id = '${zlot}';
    set session_replication_role = origin;`)

  // 그 밖: 생산 · 구매 · 임원 · 회사 대표 · CFO · 다른 회사 · 시스템 계정 → 같은 오류.
  for (const uid of [U.buy, U.prod, U.exec, U.ceo, U.cfo, U.vana, U.agent]) {
    await refuses(as(uid, `select * from cost_product_cost('${p1}', 'current')`), /cost_not_found/, `0062: ${uid.slice(-2)}가 제품 원가를 본다`)
  }
  await refuses(as(U.cost, `select * from cost_product_cost('prd_nope_nope', 'current')`), /cost_not_found/, '0062: 없는 제품의 오류가 다르다')
  await refuses(as(U.cost, `select * from cost_product_cost('${p1}', 'actual')`), /cost_kind_unsupported/, '0062: 1차에 없는 Actual을 받는다')

  // 리뷰 2회차 I1 — 회사의 사용 중 원료 하나라도 단가가 없으면 그 회사 모든 제품이 not_computed(BOM 소속이 «계산됨»으로 새지 않게).
  const { m5 } = await one<{ m5: string }>(U.buy, `insert into cost_materials (business_id, name) values ('biz_dy', '가짜원료 새것') returning material_id as m5`)
  // 매일 최신 — 새 원료는 만든 순간 회사 단위 계산 여부에 들어간다(단가가 생길 때까지 그 회사 모든 제품이 똑같이 not_computed).
  const inc = await as<{ computed: boolean; reason: string }>(U.cost, `select computed, reason from cost_product_cost('${p1}', 'current')`)
  assert.deepEqual([inc[0].computed, inc[0].reason], [false, 'not_computed'], '0062: 단가 없는 새 원료가 있는데 BOM에 없는 제품은 계산된다(소속이 샌다)')
  const incI = await as<{ v: string | null }>(U.sales, `select cost_material_impact('${p1}', 'market', '${M3}', '${T}') as v`)
  assert.equal(incI[0].v, null, '0062: 회사가 불완전한데 원료비 영향이 나온다')
  await run(U.buy, `update cost_materials set active = false where material_id = '${m5}'`)
  // 리뷰 3회차 I1 — 사용 중이 아닌 원료라도 그 날 쓰는 BOM에 들어 있으면 센다(그 제품만 not_computed가 되지 않게).
  await run(U.chair, `select cost_bom_save('${p3}', '${M}'::date - 30, 100, '[{"material_id":"${m1}","kg_per_kg":0.5},{"material_id":"${m5}","kg_per_kg":0.5}]'::jsonb)`)
  // 매일 최신 — 고친 BOM은 저장한 순간 대표 외 값에도 비친다(스냅샷 없음).
  const incB = await as<{ computed: boolean }>(U.cost, `select computed from cost_product_cost('${p1}', 'current')`)
  assert.equal(incB[0].computed, false, '0062: 단종 원료가 든 BOM이 있는데 다른 제품은 계산된다(소속이 샌다)')
  await run(U.chair, `select cost_bom_save('${p3}', '${M}'::date - 30, 100, '[{"material_id":"${m1}","kg_per_kg":0.5},{"material_id":"${m4}","kg_per_kg":0.5}]'::jsonb)`)
  await age()

  // 이유 코드 — 대표 외는 not_computed 하나(리뷰 I5).
  for (const p of [p2]) {
    const r = await as<{ computed: boolean; reason: string; material_krw_per_kg: unknown }>(U.cost, `select * from cost_product_cost('${p}', 'current', '${T}')`)
    assert.deepEqual([r[0].computed, r[0].reason, r[0].material_krw_per_kg], [false, 'not_computed', null], '0062: 대표 외에게 이유가 갈라진다')
  }
  const cr2 = await as<{ reason: string }>(U.chair, `select reason from cost_product_cost('${p2}', 'market', '${T}')`)
  assert.equal(cr2[0].reason, 'no_bom', '0062: 대표에게는 이유를 갈라 보여야 한다(BOM 없음)')
  const cr3 = await as<{ computed: boolean }>(U.chair, `select computed from cost_product_cost('${p3}', 'market', '${T}')`)
  assert.equal(cr3[0].computed, true, '0062: 시세가 다 있는 p3를 대표가 계산하지 못한다')

  // 오류 · 경고 문장에 원료 이름이 없다.
  for (const sql of [`select * from cost_product_cost('${p1}', 'market')`, `select * from cost_bom_get('${p1}')`, `select * from cost_product_breakdown('${p1}')`,
    `select cost_bom_save('${p1}', '${T}', 95, '${lines}'::jsonb)`]) {
    for (const uid of [U.prod, U.both]) {
      try {
        await as(uid, sql)
      } catch (e) {
        // 서버가 돌려준 칸만 본다(PGlite 오류 객체에는 보낸 SQL 원문도 붙는다 — 그것은 부른 사람이 이미 아는 값이다).
        const err = e as { message?: string; detail?: string; hint?: string; where?: string }
        const msg = [err.message, err.detail, err.hint, err.where].join(' | ')
        for (const name of FAKE_MATERIAL_NAMES) assert.ok(!msg.includes(name), `0062: 오류에 원료 이름이 샌다 — ${sql}`)
        assert.ok(!msg.includes(m1) && !msg.includes(m2) && !msg.includes(m4), `0062: 오류에 원료 id가 샌다 — ${sql}`)
      }
    }
  }

  // 원료비 영향 — 원래 값 둘로 0.1%p(회장 결정 2026-10-09 밤 — 표시값끼리가 아니다).
  const marketM3 = (0.5 * 1000 + 0.3 * 2800 + 0.25 * 500) / 0.95
  // 대표 외는 인자와 무관하게 «7일 전 → 오늘» 한 값(리뷰 2회차 C1). 7일 전에는 열흘 전(M−10) 시세가 쓰인다.
  const marketPrev = (0.5 * 900 + 0.3 * 2800 + 0.25 * 500) / 0.95
  for (const from of [M3, '2026-01-01']) {
    const imp = await as<{ v: string }>(U.sales, `select cost_material_impact('${p1}', 'market', '${from}', '${T}') as v`)
    assert.equal(Number(imp[0].v), Math.round((marketM / marketPrev - 1) * 1000) / 10, '0062: 영업 원료비 영향(7일 전 → 오늘 · 0.1%p)')
  }
  const impC = await as<{ v: string }>(U.chair, `select cost_material_impact('${p1}', 'market', '${M3}', '${T}') as v`)
  assert.equal(Number(impC[0].v), Math.round((marketT / marketM3 - 1) * 1000) / 10, '0062: 대표 원료비 영향(0.1%p)')

  // 하루 · 기준일마다 감사 한 줄 · 한도 200 · 감사에 기준일.
  const auditN = async (uid: string) =>
    Number((await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'cost_products' and actor_user_id = '${uid}'`))[0].n)
  const a0 = await auditN(U.sales)
  for (let i = 0; i < 3; i++) await run(U.sales, `select * from cost_product_cost('${p1}', 'market')`)
  assert.equal((await auditN(U.sales)) - a0, 1, '0062: 같은 날 같은 제품 · 종류 · 기준일 조회가 감사 한 줄로 합쳐지지 않는다')
  const lastAudit = await owner<{ a: string }>(`select after->>'as_of' as a from audit_log where entity_table = 'cost_products' and actor_user_id = '${U.sales}' order by id desc limit 1`)
  assert.equal(lastAudit[0].a, T, '0062: 원가 조회 감사에 기준일(오늘)이 없다')
  await db.exec(`update cost_secret.cost_reads set calls = 199 where user_id = '${U.sales}' and kind = 'market'`)
  await run(U.sales, `select * from cost_product_cost('${p1}', 'market')`)
  await refuses(run(U.sales, `select * from cost_product_cost('${p1}', 'market')`), /cost_rate_limited/, '0062: 하루 200건 한도가 없다')
  assert.equal(await auditN(U.chair), 0, '0062: 대표 조회가 한도 · 감사에 걸린다')
  const bomAudit = await owner<{ after: unknown }>(`select after from audit_log where entity_table = 'cost_bom' and action = 'create'`)
  assert.equal(bomAudit.length, 4, '0062: BOM 저장 감사가 저장마다 한 줄이 아니다(p1 · p3 · p3 단종 시험 · p3 되돌림)')
  const bomAuditText = JSON.stringify(bomAudit)
  assert.ok(!bomAuditText.includes(m1) && !bomAuditText.includes('0.5'), '0062: BOM 저장 감사에 원료 · 비율이 들어갔다')

  // ── 회장 결정(2026-10-09) — 영업 화면 한 줄: 총액만 · 원가 우위 · 목표 마진별 제시가 · 등급 ─────────────────────
  await db.exec(`delete from cost_secret.cost_reads where user_id = '${U.sales}'`) // 위 200건 한도 시험이 쓴 몫을 비운다
  const sv = await as<Record<string, unknown>>(U.sales, `select * from cost_sales_view('${p1}')`)
  assert.deepEqual(Object.keys(sv[0]).sort(), ['advantage_krw_per_kg', 'as_of', 'computed', 'current_krw_per_kg', 'market_krw_per_kg', 'material_impact_pct',
    'offers', 'overhead_krw_per_kg', 'overhead_ready', 'product_id', 'total_krw_per_kg'], '결정: 영업 화면 칸에 원료 · 원료별 값이 섞였다')
  // 1원(회장 결정 2026-10-09 밤) · 원가 우위는 원래 값끼리 뺀 뒤 1원(표시값끼리가 아니다 — ⑧ 정밀도가 둘이 갈리는 경우를 따로 만든다).
  assert.equal(sv[0].market_krw_per_kg, String(r1(marketM)), '결정: 영업 Market 총액(1원)')
  assert.equal(sv[0].current_krw_per_kg, String(r1(currentT)), '결정: 영업 Current 총액(1원)')
  assert.equal(Number(sv[0].advantage_krw_per_kg), r1(marketM - currentT), '결정: 원가 우위 = round(Market − Current)')
  const offers = sv[0].offers as { margin_pct: number; price_krw_per_kg: number; grade: string }[]
  const tot = r1(currentT)
  assert.deepEqual(offers.map((o) => [o.margin_pct, Number(o.price_krw_per_kg), o.grade]),
    [15, 20, 25, 30].map((m) => [m, r1(currentT / (1 - m / 100)), m >= 20 ? 'green' : m >= 15 ? 'yellow' : 'red']), '결정: 목표 마진별 제시가(원래 총원가 ÷ (1 − 마진) → 1원) · 등급')
  assert.ok(!JSON.stringify(sv).includes(m1) && !FAKE_MATERIAL_NAMES.some((n) => JSON.stringify(sv).includes(n)), '결정: 영업 화면에 원료가 샌다')
  // 리뷰(10-09 밤) C2 — 대표 외 제시가는 1원 단위만(소수 제시가로 마진 반올림 · 등급 경계를 이분 탐색하면 원래 총원가가 풀린다).
  await refuses(as(U.sales, `select * from cost_price_check('${p1}', 2345.67)`), /cost_price_invalid/, '리뷰 C2: 영업이 소수 제시가를 넣는다')
  assert.equal((await as(U.chair, `select * from cost_price_check('${p1}', 2345.67)`)).length, 1, '대표는 소수 제시가를 넣을 수 있다')
  const pc = async (price: number) => (await as<{ margin_pct: string; margin_krw_per_kg: string; grade: string; total_krw_per_kg: string }>(U.sales, `select * from cost_price_check('${p1}', ${price})`))[0]
  // 마진 · % · 등급은 원래 총원가로(1원 총원가로 빼지 않는다). 등급은 반올림 전 %로 — 14.96%는 Red.
  for (const price of [tot * 2, Math.round(tot / 0.82), tot, 2346]) {
    const got = await pc(price)
    const pct = ((price - currentT) / price) * 100
    assert.equal(got.total_krw_per_kg, String(tot), '결정: 제시가 확인의 총원가(1원)')
    assert.equal(Number(got.margin_krw_per_kg), r1(price - currentT), `결정: 마진 원 = round(제시가 − 원래 총원가) — 제시가 ${price}`)
    assert.equal(Number(got.margin_pct), r1(pct * 10) / 10, `결정: 마진 % = (제시가 − 원래 총원가) ÷ 제시가 — 제시가 ${price}`)
    assert.equal(got.grade, pct >= 20 ? 'green' : pct >= 15 ? 'yellow' : 'red', `결정: 등급(반올림 전 %) — 제시가 ${price}`)
  }
  // 경계: 원래 %가 15 바로 밑(14.96…)이면 표시 15.0%여도 Red — 원래 값으로 판정한다.
  const gm = (pr: number) => ((pr - currentT) / pr) * 100
  let edgeP = Math.floor(currentT / 0.85) // 1원 단위 제시가 중 원래 %가 [14.95, 15)인 것
  while (!(gm(edgeP) >= 14.95 && gm(edgeP) < 15)) {
    assert.ok(gm(edgeP) >= 14.95, '정밀도 시험 준비: 경계 제시가를 못 찾았다')
    edgeP--
  }
  const ge = await pc(edgeP)
  assert.equal(ge.margin_pct, '15.0', '정밀도: 경계 시험 준비(표시 15.0%)')
  assert.equal(ge.grade, 'red', '정밀도: 반올림 전 14.96%가 Yellow로 올라간다(표시값으로 등급을 매긴다)')
  await refuses(as(U.sales, `select * from cost_price_check('${p1}', 0)`), /cost_price_invalid/, '결정: 0원 제시가')
  for (const uid of [U.buy, U.prod, U.exec, U.ceo, U.cfo, U.vana, U.agent]) {
    await refuses(as(uid, `select * from cost_sales_view('${p1}')`), /cost_not_found/, `결정: ${uid.slice(-2)}가 영업 원가 화면을 본다`)
  }
  await refuses(as(U.both2, `select * from cost_sales_view('${p1}')`), /cost_role_conflict/, '결정: 구매 입력 + 영업 견적 겸직이 영업 원가를 본다')

  // 리뷰 5회차 I1 — 영업 + 생산 · 영업 + 구매(읽기만) 겸직은 영업 원가를 못 본다(원료 이름 · 시세가 한 사람에게 모인다).
  for (const uid of [U.sp, U.sr]) {
    await refuses(as(uid, `select * from cost_sales_view('${p1}')`), /cost_role_conflict/, `5회차: 겸직(${uid.slice(-2)})이 영업 원가를 본다`)
    await refuses(as(uid, `select * from cost_sales_list('biz_dy')`), /cost_role_conflict/, `5회차: 겸직(${uid.slice(-2)})이 영업 목록을 본다`)
  }
  // 리뷰 5회차 M6 — 영업 목록은 한 번의 조회로(한도 한 칸).
  const reads0 = Number((await owner<{ n: number }>(`select coalesce(sum(calls), 0)::int as n from cost_secret.cost_reads where user_id = '${U.sales}'`))[0].n)
  const list = await as<{ product_id: string; product_name: string; current_krw_per_kg: string }>(U.sales, `select * from cost_sales_list('biz_dy')`, true)
  const reads1 = Number((await owner<{ n: number }>(`select coalesce(sum(calls), 0)::int as n from cost_secret.cost_reads where user_id = '${U.sales}'`))[0].n)
  assert.equal(reads1 - reads0, 1, '영업 목록 한 번 = 한도 한 건(0063 리뷰 I1 — 제품 수만큼 세면 제품 50개에 하루 네 번)')
  // 리뷰(10-09 밤) C1 — 목록은 하루 20번까지(200건과 따로). 시세 입력 하나하나의 영향을 떼어 보려고 자주 찍는 길을 묶는다.
  await db.exec(`update cost_secret.cost_reads set calls = 20 where user_id = '${U.sales}' and kind = 'sales_list'`)
  await refuses(as(U.sales, `select * from cost_sales_list('biz_dy')`), /cost_rate_limited/, '리뷰 C1: 영업 목록이 하루 20번을 넘는다')
  assert.equal((await as(U.sales, `select * from cost_sales_view('${p1}')`)).length, 1, '목록 한도에 걸려도 제품 하나 보기는 된다(200건 안)')
  await db.exec(`update cost_secret.cost_reads set calls = 1 where user_id = '${U.sales}' and kind = 'sales_list'`)
  assert.equal(Number(list.find((r) => r.product_id === p1)!.current_krw_per_kg), tot, '5회차: 영업 목록 값이 한 줄 값과 다르다')
  assert.ok(!FAKE_MATERIAL_NAMES.some((n) => JSON.stringify(list).includes(n)), '5회차: 영업 목록에 원료가 샌다')
  // 리뷰 5회차 M1 — 영업 팀장은 아래 구매 담당의 원가 표 감사 줄(원료 id · 시각)을 못 본다.
  assert.equal(await count(U.sales, `audit_log where entity_table in ('cost_materials', 'cost_market_prices', 'cost_purchase_lots')`), 0,
    '5회차: 영업이 subtree 감사로 원료 id를 본다')
  // 리뷰 5회차 M3 — 결재 후보 트리거가 RLS보다 먼저 말하지 않는다.
  await refuses(run(U.sales, `insert into cost_candidate_dismissals (decision_id, business_id) values ('dec_c61_open', 'biz_dy')`), /row-level security|permission denied/,
    '5회차: 권한 없는 사람이 결재 id를 탐침한다')

  await precision({ as, run, one, owner, s1 })
  await encryption({ as, run, owner, db, p1, mats: [m1, m2, m3, m4], U })

  // 원가 관리 감수 조건 — 회사마다 셋까지 · 호출마다 감사 · 대표 감시.
  await refuses(db.query(`insert into user_module_access (user_id, module, can_write) values ('${U.exec}', '/costing/biz_dy', true)`), /cost_costing_cap/,
    '결정: 원가 관리 권한자가 회사에 넷 이상')
  const ca0 = await auditN(U.cost)
  for (let i = 0; i < 3; i++) await run(U.cost, `select * from cost_product_cost('${p1}', 'current')`)
  assert.equal((await auditN(U.cost)) - ca0, 3, '결정: 원가 관리 원가 조회가 호출마다 감사되지 않는다')
  for (const path of ['/purchasing/biz_dy', '/purchasing/biz_dy/lots', '/purchasing/biz_dyx', '/sales/biz_dy/q', '/sales/biz_dyx']) {
    await db.exec(`set session_replication_role = replica;
      insert into audit_log (action, entity_table, entity_id, business_id, actor_user_id, actor_role, after, note)
      values ('read', 'screen', '${path}', 'biz_dy', '${U.cost}', 'Member', jsonb_build_object('path', '${path}'), '시험 열람');
      set session_replication_role = origin;`)
  }
  const watch = await as<{ user_id: string; cost_reads_7d: number }>(U.chair, `select * from cost_costing_watch('biz_dy')`)
  assert.ok(watch.some((w) => w.user_id === U.cost && Number(w.cost_reads_7d) >= 3), '결정: 대표 감시 목록에 원가 관리 권한자 · 조회 수가 없다')
  assert.equal(Number((watch.find((w) => w.user_id === U.cost) as unknown as { screen_reads_7d: number }).screen_reads_7d), 3,
    '6회차: 감시 목록 화면 열람 수(/purchasing/biz_dy · /purchasing/biz_dy/lots · /sales/biz_dy/q — biz_dyx 제외)')
  for (const uid of [U.cost, U.sales, U.buy]) {
    await refuses(as(uid, `select * from cost_costing_watch('biz_dy')`), /cost_not_found/, `결정: ${uid.slice(-2)}가 원가 관리 감시 목록을 본다`)
  }

  // 카탈로그 — 공개 뷰가 비공개 스키마를 참조하지 않는다 · pg_stats 비공개 · anon execute 없음 · 내부 함수 execute 없음 · pg_temp · FORCE 없음.
  const deps = await owner<{ v: string }>(`
    select distinct c.relname as v from pg_depend dp
      join pg_rewrite r on r.oid = dp.objid join pg_class c on c.oid = r.ev_class join pg_namespace n on n.oid = c.relnamespace
      join pg_class tc on tc.oid = dp.refobjid join pg_namespace tn on tn.oid = tc.relnamespace
     where n.nspname <> 'cost_secret' and tn.nspname = 'cost_secret'`)
  assert.deepEqual(deps, [], `0062: 공개 뷰가 비공개 BOM을 참조한다 — ${deps.map((x) => x.v).join(', ')}`)
  await db.exec('analyze cost_secret.bom_versions;')
  assert.equal(await count(U.sales, `pg_stats where schemaname = 'cost_secret'`), 0, '0062: pg_stats로 BOM 값 분포가 보인다')
  const anonCallable = await owner<{ f: string }>(`
    select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where ((n.nspname = 'public' and p.proname like 'cost\\_%') or n.nspname = 'cost_secret')
       and has_function_privilege('anon', p.oid, 'execute')`)
  assert.deepEqual(anonCallable, [], `0061 · 0062: anon이 부를 수 있는 원가 함수(Supabase 함수 기본 권한 흉내 아래) — ${anonCallable.map((r) => r.f).join(', ')}`)
  const secretCallable = await owner<{ f: string }>(`
    select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cost_secret' and has_function_privilege('authenticated', p.oid, 'execute')`)
  assert.deepEqual(secretCallable, [], `0062: authenticated가 부를 수 있는 비공개 함수 — ${secretCallable.map((r) => r.f).join(', ')}`)
  const internal = await owner<{ f: string }>(`
    select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('cost_market_on', 'cost_audit', 'cost_lot_calc', 'cost_lot_source_check', 'cost_outlier_check')
       and has_function_privilege('authenticated', p.oid, 'execute')`)
  assert.deepEqual(internal, [], '0061: 내부 함수를 authenticated가 부른다')
  const secretPriv = await owner<{ n: number }>(`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'cost_secret' and grantee in ('anon', 'authenticated', 'PUBLIC')`)
  assert.equal(Number(secretPriv[0].n), 0, '0062: 비공개 표에 grant가 있다')
  const noPinned = await owner<{ f: string }>(`
    select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'cost_secret' or (n.nspname = 'public' and p.proname like 'cost\\_%')) and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%pg_temp%')`)
  assert.deepEqual(noPinned, [], `0061 · 0062: search_path에 pg_temp가 없는 정의자 함수(리뷰 M2) — ${noPinned.map((r) => r.f).join(', ')}`)
  const forced = await owner<{ r: string }>(`select relname as r from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and relforcerowsecurity and relname in ('cost_materials', 'cost_suppliers', 'cost_market_prices',
       'cost_purchase_lots', 'cost_products', 'cost_purchase_docs', 'cost_candidate_dismissals')`)
  assert.deepEqual(forced, [], '0061: 원가 표에 FORCE RLS — Supabase에서 정의자 함수가 0행이 된다(리뷰 C1)')

  // ── ⑥ BYPASSRLS 없는 소유자(리뷰 C1) — Supabase의 postgres는 BYPASSRLS가 아니다(0026 · 0027). 표 · 함수 · 비공개 스키마를 넘기고 다시 잰다.
  await db.exec(`
    create role app_owner nosuperuser nobypassrls nologin;
    grant usage on schema auth to app_owner;
    grant select on auth.users to app_owner;
    grant usage on schema storage to app_owner;
    grant select on storage.buckets to app_owner;
    grant usage on schema extensions, vault to app_owner;
    grant select on vault.decrypted_secrets to app_owner;
    do $o$
    declare r record;
    begin
      for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname in ('public', 'cost_secret') and c.relkind in ('r', 'v') loop
        execute format('alter table %I.%I owner to app_owner', r.nspname, r.relname);
      end loop;
      for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'cost_secret') and p.prokind = 'f' loop
        execute format('alter function %s owner to app_owner', r.f);
      end loop;
    end $o$;
    alter schema cost_secret owner to app_owner;
  `)
  const nb = await owner<{ s: boolean; b: boolean }>(`select rolsuper as s, rolbypassrls as b from pg_roles where rolname = 'app_owner'`)
  assert.deepEqual([nb[0].s, nb[0].b], [false, false], '실험 설정이 깨졌다 — app_owner가 superuser · bypassrls다')
  const nbCost = await as<{ x: string }>(U.cost, `select material_krw_per_kg as x from cost_product_cost('${p1}', 'current', '${T}')`)
  assert.equal(Number(nbCost[0].x), r1(currentT), '0062(BYPASSRLS 없는 소유자): 원가 관리 원가가 죽는다')
  assert.equal((await as(U.chair, `select * from cost_bom_get('${p1}', '${T}')`)).length, 3, '0062(BYPASSRLS 없는 소유자): 대표 BOM 읽기가 죽는다')
  assert.ok((await as(U.prod, `select * from cost_production_lots('biz_dy')`)).length >= 4, '0061(BYPASSRLS 없는 소유자): 생산 LOT 함수가 0행')
  assert.ok((await as(U.prod, `select * from cost_production_materials('biz_dy')`)).length >= 4, '0061(BYPASSRLS 없는 소유자): 생산 시세 함수가 0행')
  assert.ok((await as(U.cost, `select * from cost_sales_purchase_summary('biz_dy')`)).length >= 4, '0061(BYPASSRLS 없는 소유자): 원료 요약이 0행')
  assert.equal(await count(U.cost, `storage.objects where bucket_id = 'purchasing'`), 1, '0061(BYPASSRLS 없는 소유자): 구매 첨부가 안 보인다')
  await run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name) values ('biz_dy', '${m3}', '${T}', 510, '소유자 시험')`)
  await refuses(run(U.buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, source_name) values ('biz_dy', '${m2}', '${M3}', 1000000000000, '소유자 1조')`),
    /cost_price_outlier/, '0061(BYPASSRLS 없는 소유자): 터무니없는 값 거부가 죽는다')
  assert.ok((await as(U.cost, `select cost_material_impact('${p1}', 'current', '${M3}', '${T}') as v`)).length === 1, '0062(BYPASSRLS 없는 소유자): 원료비 영향이 죽는다')
  await db.exec(`set session_replication_role = replica;
    insert into decisions (decision_id, business_id, title, status, template_key, form, decided_at) values
      ('dec_c61_ok2', 'biz_dy', '원료 구매 3', 'Approved', 'purchase', '{"item":"a","vendor":"b","quantity":"10","amount":"7000"}', now());
    set session_replication_role = origin;`)
  assert.deepEqual((await as<{ decision_id: string }>(U.buy, `select decision_id from cost_purchase_candidates('biz_dy')`)).map((r) => r.decision_id), ['dec_c61_ok2'],
    '0061(BYPASSRLS 없는 소유자): 결재 후보가 죽는다')
  await run(U.buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, source, source_ref)
    values ('biz_dy', '${m1}', '${s1}', '${M3}', 10, 1400, 'approval', 'dec_c61_ok2')`)
  const path2 = `biz_dy/22222222-2222-2222-2222-222222222222/r.pdf`
  await run(U.buy, `insert into cost_purchase_docs (doc_id, business_id, kind, file_name, mime, size_bytes, sha256, storage_path, mix_checked)
    values ('22222222-2222-2222-2222-222222222222', 'biz_dy', 'quote', 'r.pdf', 'application/pdf', 100, '${'c'.repeat(64)}', '${path2}', true)`)
  await run(U.buy, `insert into storage.objects (bucket_id, name) values ('purchasing', '${path2}')`)
  await run(U.chair, `select cost_bom_save('${p2}', '${T}', 100, '[{"material_id":"${m1}","kg_per_kg":1}]'::jsonb)`)

  // ── ⑩ 생산(0064) — BYPASSRLS 없는 소유자 아래에서.
  await production({ as, run, owner, p1, p3, lot, mats: [m1, m2, m3], U })
  // ── ⑪ 비용 마스터 · 배부 · 총원가(0065)
  await overheads({ as, run, owner, p1, U })
  // ── ⑫ 회장 결정(2026-10-10) (가) — 영업은 오늘 0시까지 저장된 값, 원가 관리 · 대표는 즉시
  await knownCutoff({ db, as, run, owner, p1, mats: [m1, m2, m3], s1, U })
  // ── ⑬ 0066 견적 · 가격 예외 결재
  await quotes({ db, as, run, owner, p1, mats: [m1, m2, m3], materialNames: [...FAKE_MATERIAL_NAMES], U })
  // ── ⑭ 0067 판매 실적 · 실제 원가 · 견적 마진 vs 실제 마진
  await sales({ db, as, run, owner, p1, U })

  // ── ⑦ 코드 경계 — AI 도구 · 프롬프트 · 요약이 BOM · 원가 함수를 부르지 않는다 ─────────────────
  const root = join(__dirname, '..', 'src')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
  const aiFiles = walk(join(root, 'lib', 'ai')).concat(walk(join(root, 'lib', 'attachments')))
  for (const f of aiFiles) {
    const text = readFileSync(f, 'utf8')
    for (const bad of ['cost_secret', 'cost_bom_', 'cost_product_breakdown', 'cost_product_cost', 'cost_material_impact', 'cost_sales_view', 'cost_price_check', 'costBom', 'productCost']) {
      assert.ok(!text.includes(bad), `경계: AI · 첨부 코드(${f})가 원가 · BOM(${bad})을 부른다`)
    }
  }

  await db.close()
  console.log(
    'PASS: 0061~0067 원가 엔진 — 판매(출고 · Actual/Current · 견적 vs 실제 마진 · 합산 1원 · 대체 · 읽기 · 20번 · 엑셀 감사) · 견적(Green 확정 · Red 결재 승인/반려 · 새 판 · 위조 · 우회 · 읽기 · 회계용 · 내려받기 감사 · 만료) · (가) 영업 0시 기준(시세 · LOT · BOM · 비용 · 배부 · 무효는 내일 · 원가 관리 · 대표 즉시) · 생산(발행 · 투입 · 잔량 · Actual) · 비용 마스터(배부 · 총원가 · 계획 기준) · BOM 암호화(Vault 키 · 암호문만 · 키 없음 멈춤 · 틀린 키 · 깨진 암호문 · 진짜 BOM 스위치) · 권한 표(구매 · 생산 · 영업 · 원가 관리 · 대표 · 줄 없는 임원/회사 대표/CFO · 다른 회사 · AIAgent · anon) · ' +
      '무효만 · 시퀀스 되감기 거부 · Landed · 환율 · 만든 사람 위조 불가 · 터무니없는 값 거부 · 생산 «제한»(오늘만) · 영업 원료 0(이름 · 시세 · 요약) · 영업 화면 총액만(Market · Current · 우위 · 제시가 · 등급) · 원가 관리 셋까지 · 호출마다 감사 · 대표 감시 · ' +
      '결재 후보 · 구매 첨부 버킷 · BOM 대표만 · 진짜 BOM 거부 · 원가 합계 한 줄 · 1원(대표 외) · 원래 값(대표) · Market/Current 값 · 대표 외 기준일 오늘 하나 · 매일 최신(LOT · 시세 · 무효 · 새 원료 · BOM 즉시) · ' +
      '회사 단위 계산 여부(단종 BOM 원료 포함) · 원료비 영향 7일 전→오늘 · 출처 셋 · 미래 날짜 거부 · 무효로 기준 없애기 거부 · 구매 겸직 거부 · 같은 오류 · 이유 코드 하나 · 오류에 원료 없음 · ' +
      '정밀도(LOT 다섯 · 환율 · 부대비 유리수 대조 · 1원 끝자리 · 원값 차 ≠ 표시값 차 · 제시가 원래 총원가 · 등급 반올림 전 %) · 원료비 영향 0.1%p · 하루 · 대상 감사 한 줄 · 200건 한도 · BOM 감사에 값 없음 · 공개 뷰 의존 0 · pg_stats 0 · anon execute 0(함수 기본 권한 흉내) · ' +
      'pg_temp 고정 · FORCE 없음 · BYPASSRLS 없는 소유자에서 정의자 함수 동작 · AI 코드 경계',
  )
}

// ── ⑧ 정밀도 — 유리수(BigInt)로 직접 계산한 값과 DB 값 ─────────────────────────────────────────────

interface Ctx {
  as: <T>(uid: string | null, sql: string, commit?: boolean) => Promise<T[]>
  run: (uid: string, sql: string) => Promise<unknown[]>
  one: <T>(uid: string, sql: string) => Promise<T>
  owner: <T>(sql: string) => Promise<T[]>
  s1: string
}

/**
 * 회장 결정(2026-10-09 밤) «반올림 없이 1원까지»:
 *   ① 여러 LOT(KRW 셋 · USD 둘, 환율 · 운송 · 관세 · 부대비) × 수율 × BOM 두 원료의 Current 원가를 유리수로 계산 → 대표 값 = 원래 값(1e-9 안) · 대표 외 = 그 1원
 *   ② Market(외화 시세 · 환율 직접) 같은 식
 *   ③ 원가 우위: round(Market − Current) ≠ round(Market) − round(Current)이 되게 시세를 골라 넣고, 영업 값이 앞쪽(원래 값으로 뺀 것)인지
 *   ④ 목표 마진별 제시가 = round(원래 총원가 ÷ (1 − 마진)) — 1원 총원가로 나눈 값과 갈리는지도 본다
 */
async function precision({ as, run, one, owner, s1 }: Ctx) {
  const T = (await owner<{ t: string }>(`select cost_today()::text as t`))[0].t
  const chair = '00000000-0000-0000-0000-0000000061a1'
  const buy = '00000000-0000-0000-0000-0000000061a2'
  const cost = '00000000-0000-0000-0000-0000000061a5'
  const sales = '00000000-0000-0000-0000-0000000061a4'
  const { ma } = await one<{ ma: string }>(buy, `insert into cost_materials (business_id, name) values ('biz_dy', '정밀도 원료 가') returning material_id as ma`)
  const { mb } = await one<{ mb: string }>(buy, `insert into cost_materials (business_id, name) values ('biz_dy', '정밀도 원료 나') returning material_id as mb`)
  const { pp } = await one<{ pp: string }>(chair, `insert into cost_products (business_id, name) values ('biz_dy', '정밀도 제품') returning product_id as pp`)
  // LOT — (원료, kg, 단가, 통화, 환율, 운송, 관세, 부대). 입고일은 그제 · 사흘 전 · 열흘 전(180일 창 안).
  const lots: [string, string, string, string, string | null, string, string, string, number][] = [
    [ma, '1234.5', '1873.25', 'KRW', null, '41234.7', '0', '3210.05', 2],
    [ma, '800', '1950.1', 'KRW', null, '0', '0', '999.99', 3],
    [ma, '333.333', '1820', 'KRW', null, '12000', '0', '0', 10],
    [mb, '500', '2.35', 'USD', '1387.45', '150000', '35123.4', '0', 3],
    [mb, '750.5', '2.41', 'USD', '1402.1', '0', '20000', '5555.55', 2],
  ]
  for (const [m, kg, up, cur, fx, fr, du, ot, ago] of lots) {
    await run(buy, `insert into cost_purchase_lots (business_id, material_id, supplier_id, received_on, qty_kg, unit_price, currency, fx_rate, freight_krw, duty_krw, other_krw)
      values ('biz_dy', '${m}', '${s1}', '${T}'::date - ${ago}, ${kg}, ${up}, '${cur}', ${fx ?? 'null'}, ${fr}, ${du}, ${ot})`)
  }
  const landed = (kg: string, up: string, fx: string | null, fr: string, du: string, ot: string) =>
    qdiv(qadd(qadd(qadd(qmul(qmul(Qof(up), Qof(kg)), Qof(fx ?? 1)), Qof(fr)), Qof(du)), Qof(ot)), Qof(kg))
  const current = (m: string) => {
    const ls = lots.filter((l) => l[0] === m)
    return qdiv(qsum(ls.map((l) => qmul(landed(l[1], l[2], l[4], l[5], l[6], l[7]), Qof(l[1])))), qsum(ls.map((l) => Qof(l[1]))))
  }
  // DB의 Landed는 반올림하지 않는다(0061) — LOT 하나를 유리수와 견준다.
  const lr = await owner<{ l: string }>(`select landed_krw_per_kg::text as l from cost_purchase_lots where material_id = '${mb}' and qty_kg = 750.5`)
  assert.ok(qnear(Qof(lr[0].l), landed('750.5', '2.41', '1402.1', '0', '20000', '5555.55')), `정밀도: Landed(USD · 환율 · 관세 · 부대)가 원래 값이 아니다 — ${lr[0].l}`)

  const yieldPct = '97.5'
  const kA = '0.6234'
  const kB = '0.3891'
  await run(chair, `select cost_bom_save('${pp}', '${T}'::date - 30, ${yieldPct}, '[{"material_id":"${ma}","kg_per_kg":${kA}},{"material_id":"${mb}","kg_per_kg":${kB}}]'::jsonb, '정밀도 가짜')`)
  const qA = qdiv(Qof(kA), qdiv(Qof(yieldPct), Qof(100)))
  const qB = qdiv(Qof(kB), qdiv(Qof(yieldPct), Qof(100)))
  const cu = qadd(qmul(qA, current(ma)), qmul(qB, current(mb)))

  // ③을 위해 Market을 고른다: Current의 소수 부분 fc에 따라 Market의 소수 부분을 정해 round(차) ≠ round(앞) − round(뒤)가 되게.
  const pA = Qof('1999.9')
  const fc = qfrac(cu)
  const fTarget = qsub(fc, Qof('0.5')).n < BigInt(0) ? qadd(Qof('0.5'), qdiv(fc, Qof(2))) : qdiv(fc, Qof(2))
  const approx = qadd(qmul(qA, pA), qmul(qB, Qof('3500')))
  const targetMk = qadd(Qof((approx.n / approx.d).toString()), fTarget) // 정수 부분 + 고른 소수 부분
  const pBkrw = q4(qdiv(qsub(targetMk, qmul(qA, pA)), qB)) // 원화 시세(소수 4자리)
  await run(buy, `insert into cost_market_prices (business_id, material_id, observed_on, price, currency, source_name) values
    ('biz_dy', '${ma}', '${T}', 1999.9, 'KRW', '정밀도'), ('biz_dy', '${mb}', '${T}', ${pBkrw}, 'KRW', '정밀도')`)
  const mk = qadd(qmul(qA, pA), qmul(qB, Qof(pBkrw)))
  const R = (a: Q) => qround(a).toString()
  assert.notEqual(R(qsub(mk, cu)), (qround(mk) - qround(cu)).toString(), '정밀도 시험 준비: 표시값 차와 원값 차가 갈리게 고르지 못했다')

  // ① ② 대표 = 원래 값, 원가 관리 = 1원(끝자리까지).
  for (const [kind, exact] of [['current', cu], ['market', mk]] as const) {
    const c = await as<{ v: string }>(chair, `select material_krw_per_kg::text as v from cost_product_cost('${pp}', '${kind}', '${T}')`)
    assert.ok(qnear(Qof(c[0].v), exact), `정밀도: 대표 ${kind} 원가 ${c[0].v} ≠ 원래 값`)
    const k = await as<{ v: string }>(cost, `select material_krw_per_kg::text as v from cost_product_cost('${pp}', '${kind}')`)
    assert.equal(k[0].v, R(exact), `정밀도: 원가 관리 ${kind} 원가 1원 끝자리 — DB ${k[0].v} · 직접 계산 ${R(exact)}`)
  }

  // ③ ④ 영업 화면.
  const sv = (await as<{ market_krw_per_kg: string; current_krw_per_kg: string; advantage_krw_per_kg: string; total_krw_per_kg: string; offers: { margin_pct: number; price_krw_per_kg: number }[] }>(
    sales, `select * from cost_sales_view('${pp}')`))[0]
  assert.equal(sv.market_krw_per_kg, R(mk), '정밀도: 영업 Market 1원')
  assert.equal(sv.current_krw_per_kg, R(cu), '정밀도: 영업 Current 1원')
  assert.equal(String(sv.advantage_krw_per_kg), R(qsub(mk, cu)), '정밀도: 원가 우위를 표시값끼리 뺐다(원래 값으로 빼야 한다)')
  assert.notEqual(Number(sv.advantage_krw_per_kg), Number(sv.market_krw_per_kg) - Number(sv.current_krw_per_kg), '정밀도: 원가 우위 = 표시값 차(원값 차여야)')
  let split = 0
  for (const o of sv.offers) {
    const exact = qdiv(cu, qsub(Qof(1), qdiv(Qof(o.margin_pct), Qof(100))))
    assert.equal(String(o.price_krw_per_kg), R(exact), `정밀도: 목표 마진 ${o.margin_pct}% 제시가`)
    if (R(exact) !== R(qdiv(Qof(R(cu)), qsub(Qof(1), qdiv(Qof(o.margin_pct), Qof(100)))))) split++
  }
  // 대표 화면(목록)도 원래 값을 받는다 — 화면이 1원으로 그린다.
  const cl = await as<{ total_krw_per_kg: string }>(chair, `select total_krw_per_kg::text as total_krw_per_kg from cost_sales_list('biz_dy') where product_id = '${pp}'`)
  assert.ok(qnear(Qof(cl[0].total_krw_per_kg), cu), '정밀도: 대표 영업 목록 총원가가 원래 값이 아니다')
  console.log(`  정밀도: Current ${R(cu)}원 · Market ${R(mk)}원 · 우위 ${R(qsub(mk, cu))}원(표시값 차 ${qround(mk) - qround(cu)}) · 1원 총원가로 나눴다면 갈렸을 제시가 ${split}칸`)
  return { pp, ma, mb, cu, mk, Qof, qround }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
