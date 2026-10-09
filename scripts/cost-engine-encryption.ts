/**
 * check:cost-engine ⑨ — BOM 암호화(0063). 암호문 저장 · 계산 · 대표 열람 · 비대표 거부 · 진짜 BOM 스위치 · 키 없음 · 틀린 키 ·
 * 깨진 암호문 · 새는 길(오류 문장 · 감사 줄 · pg_stats · NOTICE). check-cost-engine.ts가 부른다(그 파일이 커서 떼어 놓았다).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PGlite } from '@electric-sql/pglite'

import { MIGRATIONS } from './pglite'

export interface EncCtx {
  as: <T>(uid: string | null, sql: string, commit?: boolean) => Promise<T[]>
  run: (uid: string, sql: string) => Promise<unknown[]>
  owner: <T>(sql: string) => Promise<T[]>
  db: PGlite
  p1: string
  mats: string[]
  U: Record<string, string>
}

const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)

export async function encryption({ as, run, owner, db, p1, mats, U }: EncCtx) {
  const T = (await owner<{ t: string }>(`select cost_today()::text as t`))[0].t
  const errText = (e: unknown) => {
    const x = e as { message?: string; detail?: string; hint?: string; where?: string; internalQuery?: string }
    return [x.message, x.detail, x.hint, x.where, x.internalQuery].join(' | ')
  }
  const noLeak = (text: string, why: string) => {
    for (const m of mats) assert.ok(!text.includes(m), `0063: ${why}에 원료 id가 샌다`)
    for (const n of ['가짜원료알파', '가짜원료베타', '가짜원료감마', '0.5', '0.3', '0.25', '"q"', '"m"']) assert.ok(!text.includes(n), `0063: ${why}에 «${n}»이 샌다`)
  }
  const fails = async (uid: string, sql: string, re: RegExp, why: string) => {
    try {
      await as(uid, sql)
    } catch (e) {
      assert.match(errText(e), re, `${why} — 오류가 다르다: ${errText(e)}`)
      return errText(e)
    }
    assert.fail(`${why} — 오류 없이 지나간다`)
  }

  // 평문 표가 없다 · 살아 있는 판은 모두 암호문(원료 id · 칸 이름 글자가 바이트에 없다) · 512바이트 단위로 채움.
  assert.equal((await owner<{ r: string | null }>(`select to_regclass('cost_secret.bom_lines')::text as r`))[0].r, null, '0063: 평문 BOM 표가 남았다')
  const hits = mats.map((m) => `position(convert_to('${m}', 'UTF8') in payload_enc) > 0`).join(' or ')
  const enc = await owner<{ n: number; len: number; hit: boolean }>(`
    select count(*)::int as n, min(octet_length(payload_enc))::int as len,
           bool_or(${hits} or position(convert_to('kg_per_kg', 'UTF8') in payload_enc) > 0) as hit
      from cost_secret.bom_versions where voided_at is null`)
  assert.ok(Number(enc[0].n) >= 3, '0063: 살아 있는 판이 없다')
  assert.equal(enc[0].hit, false, '0063: 암호문 바이트에 원료 id · 칸 이름이 그대로 있다')
  assert.ok(Number(enc[0].len) >= 512, '0063: 원문을 512바이트로 채우지 않았다(길이로 원료 수가 보인다)')

  // 비대표 거부 — 새 함수까지(계산 · 대표 열람은 앞 절들이 암호문 위에서 이미 통과).
  for (const uid of [U.buy, U.prod, U.sales, U.cost, U.exec, U.ceo, U.cfo, U.agent]) {
    await refuses(as(uid, `select * from cost_bom_versions('biz_dy')`), /cost_not_found/, `0063: ${uid.slice(-2)}가 BOM 판 목록을 본다`)
    await refuses(as(uid, `select * from cost_bom_status()`), /cost_not_found/, `0063: ${uid.slice(-2)}가 키 상태를 본다`)
    await refuses(as(uid, `select cost_bom_real_allow(true)`), /cost_not_found/, `0063: ${uid.slice(-2)}가 진짜 BOM 스위치를 켠다`)
  }
  const vers = await as<Record<string, unknown>>(U.chair, `select * from cost_bom_versions('biz_dy')`)
  assert.ok(vers.length >= 3 && !('payload_enc' in vers[0]) && !('kg_per_kg' in vers[0]), '0063: 판 목록에 비율 · 암호문 칸이 있다')
  const st = await as<{ key_ready: boolean; real_allowed: boolean }>(U.chair, `select key_ready, real_allowed from cost_bom_status()`)
  assert.deepEqual([st[0].key_ready, st[0].real_allowed], [true, false], '0063: 키 상태')

  // 진짜 BOM 스위치 — 켜면 is_fake = false 판이 들어가고, 끄면 다시 막힌다(값은 가짜 — 회장 결정: 진짜 BOM 입력 금지).
  await run(U.chair, `select cost_bom_real_allow(true)`)
  const { pr } = (await run(U.chair, `insert into cost_products (business_id, name) values ('biz_dy', '스위치 시험 제품') returning product_id as pr`))[0] as { pr: string }
  await run(U.chair, `select cost_bom_save('${pr}', '${T}', 100, '[{"material_id":"${mats[0]}","kg_per_kg":1}]'::jsonb, '스위치 시험(가짜 값)', false)`)
  assert.equal((await as<{ is_fake: boolean }>(U.chair, `select is_fake from cost_bom_get('${pr}', '${T}')`))[0].is_fake, false, '0063: 스위치를 켜도 진짜 판이 안 들어간다')
  await run(U.chair, `select cost_bom_real_allow(false)`)
  await refuses(run(U.chair, `select cost_bom_save('${pr}', '${T}', 100, '[{"material_id":"${mats[0]}","kg_per_kg":1}]'::jsonb, '', false)`),
    /cost_bom_real_locked/, '0063: 스위치를 꺼도 진짜 판이 들어간다')
  await run(U.chair, `select cost_bom_void((select max(version_id) from cost_bom_versions('biz_dy') where product_id = '${pr}'), '스위치 시험 정리')`)
  await run(U.chair, `update cost_products set active = false where product_id = '${pr}'`)

  // 키 없음 — 저장 · 원가 계산 · 영업 목록 · 대표 열람이 분명한 코드로 멈춘다(조용히 0 · 빈 값 금지).
  await db.exec(`update vault.secrets set name = 'cost_bom_key_moved' where name = 'cost_bom_key'`)
  await refuses(run(U.chair, `select cost_bom_save('${p1}', '${T}'::date + 1, 95, '[{"material_id":"${mats[0]}","kg_per_kg":1}]'::jsonb)`),
    /cost_bom_key_missing/, '0063: 키 없이 BOM이 저장된다')
  await fails(U.cost, `select * from cost_product_cost('${p1}', 'current')`, /cost_bom_key_missing/, '0063: 키 없이 원가 관리 원가')
  await fails(U.sales, `select * from cost_sales_list('biz_dy')`, /cost_bom_key_missing/, '0063: 키 없이 영업 목록')
  await fails(U.chair, `select * from cost_bom_get('${p1}', '${T}')`, /cost_bom_key_missing/, '0063: 키 없이 대표 BOM')
  assert.equal((await as<{ k: boolean }>(U.chair, `select key_ready as k from cost_bom_status()`))[0].k, false, '0063: 키 없음을 상태가 모른다')
  await refuses(as(U.chair, `select cost_bom_real_allow(true)`), /cost_bom_key_missing/, '0063: 키 없이 진짜 BOM 스위치가 켜진다')
  await db.exec(`update vault.secrets set name = 'cost_bom_key' where name = 'cost_bom_key_moved'`)

  // 틀린 키 — 한 문장(cost_bom_unreadable), 원문 조각 없음.
  await db.exec(`update vault.secrets set name = 'cost_bom_key_old' where name = 'cost_bom_key';
                 insert into vault.secrets (name, secret) values ('cost_bom_key', encode(extensions.gen_random_bytes(32), 'base64'));`)
  for (const [uid, sql] of [
    [U.chair, `select * from cost_bom_get('${p1}', '${T}')`],
    [U.cost, `select * from cost_product_cost('${p1}', 'current')`],
    [U.sales, `select * from cost_sales_view('${p1}')`],
  ] as const) {
    noLeak(await fails(uid, sql, /cost_bom_unreadable/, `0063: 틀린 키 — ${sql}`), '틀린 키 오류')
  }
  // 깨진 암호문: 형식은 맞지만 숫자 자리에 글자 — numeric 변환 오류가 값을 싣지 않는다.
  const v1 = (await owner<{ v: number }>(`select max(version_id)::int as v from cost_secret.bom_versions where product_id = '${p1}' and voided_at is null`))[0].v
  await db.exec(`update cost_secret.bom_versions
       set payload_enc = extensions.pgp_sym_encrypt('{"v":1,"l":[{"m":"${mats[0]}","q":"abc0.5"}]}', (select decrypted_secret from vault.decrypted_secrets where name = 'cost_bom_key'))
     where version_id = ${v1}`)
  const broken = await fails(U.chair, `select * from cost_bom_get('${p1}', '${T}')`, /cost_bom_unreadable/, '0063: 깨진 암호문')
  assert.ok(!broken.includes('abc'), '0063: 변환 오류가 원문 값을 싣는다')
  noLeak(broken, '깨진 암호문 오류')

  // 새 키로 다시 저장하면 산다(운영: 키를 바꾸면 R2에서 다시 넣는다). 옛 키 판은 무효로 정리.
  await run(U.chair, `select cost_bom_save('${p1}', '${T}'::date - 30, 95, '[{"material_id":"${mats[0]}","kg_per_kg":0.5},{"material_id":"${mats[1]}","kg_per_kg":0.3},{"material_id":"${mats[2]}","kg_per_kg":0.25}]'::jsonb, '가짜 BOM')`)
  await db.exec(`update cost_secret.bom_versions set voided_at = now(), voided_by = created_by, void_reason = '시험 — 옛 키'
                  where product_id <> '${p1}' and voided_at is null`)
  assert.equal((await as<{ c: boolean }>(U.chair, `select computed as c from cost_product_cost('${p1}', 'current')`))[0].c, true, '0063: 새 키로 다시 저장한 판으로 계산이 안 된다')
  await db.exec(`delete from vault.secrets where name = 'cost_bom_key_old'`)

  // 감사 줄 · pg_stats · 정적(NOTICE 없음).
  const audits = JSON.stringify(await owner(`select entity_id, before, after, note from audit_log where entity_table = 'cost_bom'`))
  noLeak(audits, 'BOM 감사 줄')
  assert.ok(!/\\\\x[0-9a-f]{16}/.test(audits), '0063: 감사 줄에 암호문이 있다')
  await db.exec('analyze cost_secret.bom_versions; analyze vault.secrets;')
  for (const uid of [U.sales, U.cost, U.buy]) {
    const n = Number((await as<{ n: number }>(uid, `select count(*)::int as n from pg_stats where schemaname in ('cost_secret', 'vault')`))[0].n)
    assert.equal(n, 0, '0063: pg_stats로 암호문 · 키 분포가 보인다')
  }
  for (const f of readdirSync(MIGRATIONS).filter((x) => /^006[2-9]_.*\.sql$/.test(x))) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8').replace(/--.*$/gm, '')
    assert.ok(!/raise\s+(notice|warning|info|log|debug)/i.test(sql), `0063: ${f}에 NOTICE · WARNING(로그로 값이 샐 수 있다)`)
  }
  console.log('  암호화: 평문 표 없음 · 암호문에 id 없음 · 512바이트 · 비대표 거부 · 진짜 BOM 스위치 · 키 없음 멈춤 · 틀린 키 · 깨진 암호문 한 문장 · 감사 · pg_stats · NOTICE 0')
}
