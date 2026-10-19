/**
 * 0089 재무 보강(열 맞춤 · 공식 결산 «다시 맞출 줄») — check-migrations.ts가 부른다(PGlite · 전부 적용한 DB).
 *   fin_column_maps: 장부를 쓰는 사람만 읽기 · 저장(정의자 함수) · 직원 · AI Agent · 익명 거부 · 표 직접 쓰기 없음 · 있는 맞춤에 더함 ·
 *                    값 모양(칸 이름 · '-')만 · 숫자 값 거부 · 모르는 종류 거부.
 *   official_unmatched_lines: 장부를 쓰는 사람만 저장 · 활성 결산만 · 통째로 바꿈 · 모양 · 장부를 읽는 사람만 읽기 · 직접 쓰기 없음.
 *   기능 스위치 finance_upload_ai 기본 줄(전원).
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000089a1',
  ceo: '00000000-0000-0000-0000-0000000089a2', // DY 회사 대표 — can_keep_books(biz_dy)
  member: '00000000-0000-0000-0000-0000000089a3',
  agent: '00000000-0000-0000-0000-0000000089a4',
}
const SHA = 'b'.repeat(64)
const FILE = `biz_dy/${SHA}.pdf`

export async function financeMappingDb(): Promise<string> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ('${U.chair}', 'm1@x'), ('${U.ceo}', 'm2@x'), ('${U.member}', 'm3@x'), ('${U.agent}', 'm4@x');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${U.chair}', 'Chairman', 'ch', 'Vault', null), ('${U.ceo}', 'BusinessCEO', 'dy대표', 'Restricted', null),
      ('${U.member}', 'Member', '직원', 'Normal', 'team_dy_production'), ('${U.agent}', 'AIAgent', 'agent', 'Normal', null);
    insert into user_business_access values ('${U.ceo}', 'biz_dy'), ('${U.member}', 'biz_dy');
    insert into accounts (business_id, account_code, name, category, section, cash_flow, source, fetched_at) values
      ('biz_dy', '1030', '보통예금', 'asset', 'cash', null, 'ecount', now()),
      ('biz_dy', '3310', '자본금', 'equity', 'equity', 'financing', 'ecount', now()),
      ('biz_dy', 'ZZ-SGA', '기타 판관비(자동)', 'other', 'sga', null, 'manual', now())
    on conflict do nothing;
  `)
  const as = async <T>(uid: string | null, sql: string): Promise<T[] | string> => {
    await db.exec(`begin; ${uid ? `select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;` : 'set local role anon;'}`)
    try {
      const r = await db.query<T>(sql)
      await db.exec('commit')
      return r.rows
    } catch (e) {
      await db.exec('rollback')
      return String((e as Error).message)
    }
  }
  const saveMap = (uid: string | null, map: string, kind = 'sales', biz = 'biz_dy', source = 'ai') => as(uid, `select fin_column_map_save('${biz}', '${kind}', '${map}'::jsonb, '${source}') as r`)

  // ── 1. 열 맞춤 ──
  assert.match(String(await saveMap(U.member, '{"매출액":"amount"}')), /fin_upload_denied/, '0089: 장부 권한 없는 직원이 열 맞춤을 저장했다')
  assert.match(String(await saveMap(U.agent, '{"매출액":"amount"}')), /fin_upload_denied/, '0089: AI Agent가 열 맞춤을 저장했다')
  assert.equal(typeof (await saveMap(null, '{"매출액":"amount"}')), 'string', '0089: 익명이 열 맞춤을 저장했다')
  assert.match(String(await saveMap(U.ceo, '{"매출액":"amount"}', 'sales', 'biz_vana')), /fin_upload_denied/, '0089: 다른 회사 열 맞춤을 저장했다')
  assert.match(String(await saveMap(U.ceo, '{"매출액":12}')), /fin_column_map_shape/, '0089: 숫자 값을 받았다')
  assert.match(String(await saveMap(U.ceo, '{"매출액":"Amount; drop"}')), /fin_column_map_shape/, '0089: 칸 이름 모양이 아닌 값을 받았다')
  assert.match(String(await saveMap(U.ceo, '{}')), /fin_column_map_shape/, '0089: 빈 맞춤을 받았다')
  assert.match(String(await saveMap(U.ceo, '{"매출액":"amount"}', 'payroll_people')), /fin_column_map_shape/, '0089: 모르는 종류를 받았다')
  assert.match(String(await saveMap(U.ceo, '{"매출액":"amount"}', 'sales', 'biz_dy', 'robot')), /fin_column_map_shape/, '0089: 모르는 출처를 받았다')
  assert.ok(Array.isArray(await saveMap(U.ceo, '{"매출액":"amount","판가":"-"}')), '0089: 회사 대표가 열 맞춤을 저장하지 못했다')
  assert.ok(Array.isArray(await saveMap(U.ceo, '{"매출처명":"customer"}', 'sales', 'biz_dy', 'person')), '0089: 두 번째 저장이 실패했다')
  const m = (await as<{ label_map: Record<string, string>; source: string }>(U.ceo, `select label_map, source from fin_column_maps where business_id = 'biz_dy' and kind = 'sales'`)) as { label_map: Record<string, string>; source: string }[]
  assert.deepEqual(m[0].label_map, { 매출액: 'amount', 판가: '-', 매출처명: 'customer' }, '0089: 있는 맞춤에 더하지 않았다')
  assert.equal(m[0].source, 'person')
  assert.equal(((await as(U.member, `select 1 from fin_column_maps`)) as unknown[]).length, 0, '0089: 장부 권한 없는 직원이 열 맞춤을 읽는다')
  assert.equal(((await as(U.chair, `select 1 from fin_column_maps where business_id = 'biz_dy'`)) as unknown[]).length, 1, '0089: 대표가 열 맞춤을 못 읽는다')
  assert.equal(typeof (await as(U.ceo, `insert into fin_column_maps (business_id, kind, label_map) values ('biz_dy', 'card', '{}') returning 1`)), 'string', '0089: 표에 직접 썼다')
  assert.equal(typeof (await as(U.ceo, `update fin_column_maps set label_map = '{}' where business_id = 'biz_dy' returning 1`)), 'string', '0089: 표를 직접 고쳤다')
  assert.equal(typeof (await as(null, `select 1 from fin_column_maps`)), 'string', '0089: 익명이 열 맞춤 표를 읽는다')

  // ── 2. 공식 결산 «다시 맞출 줄» ──
  const put = await as(U.ceo, `insert into storage.objects (bucket_id, name, owner) values ('fin-official-evidence', '${FILE}', '${U.ceo}') returning 1`)
  assert.ok(Array.isArray(put), `0089: 증빙을 못 올렸다 ${put}`)
  const saved = (await as<{ id: number }>(
    U.ceo,
    `select official_statement_save_v2('biz_dy', 'year', '2091', null, '${FILE}', '세무사 2091',
      '[{"account_code":"1030","amount":1000},{"account_code":"3310","amount":-1000},{"account_code":"ZZ-SGA","amount":50}]'::jsonb, null, false, '[]'::jsonb) as id`,
  )) as { id: number }[]
  assert.ok(Array.isArray(saved), `0089: 시험 결산을 못 세웠다 ${saved}`)
  const sid = Number(saved[0].id)
  const lines = `'[{"std_key":"sga:가짜전기료","label":"29.가짜전기료","grp":"sga","printed":30,"from_code":"ZZ-SGA"},{"std_key":"sga:가짜잡비","label":"30.가짜잡비","grp":"sga","printed":20,"from_code":"ZZ-SGA"}]'::jsonb`
  const saveUn = (uid: string | null, l: string, id = sid) => as<{ n: number }>(uid, `select official_unmatched_save(${id}, ${l}) as n`)
  assert.match(String(await saveUn(U.member, lines)), /books_forbidden/, '0089: 장부 권한 없는 직원이 다시 맞출 줄을 저장했다')
  assert.match(String(await saveUn(U.agent, lines)), /books_forbidden/, '0089: AI Agent가 다시 맞출 줄을 저장했다')
  assert.equal(typeof (await saveUn(null, lines)), 'string', '0089: 익명이 다시 맞출 줄을 저장했다')
  assert.match(String(await saveUn(U.ceo, `'[{"std_key":"Bad","label":"x","printed":1,"from_code":"ZZ-SGA"}]'::jsonb`)), /official_unmatched_shape/, '0089: 모양이 틀린 열쇠를 받았다')
  assert.match(String(await saveUn(U.ceo, `'[{"std_key":"sga:x","label":"x","printed":"1","from_code":"ZZ-SGA"}]'::jsonb`)), /official_unmatched_shape/, '0089: 글 금액을 받았다')
  assert.deepEqual(await saveUn(U.ceo, lines), [{ n: 2 }], '0089: 회사 대표가 다시 맞출 줄을 저장하지 못했다')
  assert.deepEqual(await saveUn(U.ceo, `'[{"std_key":"sga:가짜잡비","label":"30.가짜잡비","grp":"sga","printed":20,"from_code":"ZZ-SGA"}]'::jsonb`), [{ n: 1 }], '0089: 통째로 바꾸지 않았다')
  assert.equal(((await as(U.chair, `select 1 from official_unmatched_lines where statement_id = ${sid}`)) as unknown[]).length, 1, '0089: 바꾼 뒤 줄 수가 다르다')
  assert.equal(((await as(U.member, `select 1 from official_unmatched_lines`)) as unknown[]).length, 0, '0089: 장부 읽기 권한 없는 직원이 다시 맞출 줄을 본다')
  assert.equal(typeof (await as(U.ceo, `insert into official_unmatched_lines (statement_id, business_id, std_key, label, printed, from_code) values (${sid}, 'biz_dy', 'sga:y', 'y', 1, 'ZZ-SGA') returning 1`)), 'string', '0089: 다시 맞출 줄 표에 직접 썼다')
  assert.equal(typeof (await as(U.ceo, `delete from official_unmatched_lines returning 1`)), 'string', '0089: 다시 맞출 줄을 직접 지웠다')
  // 바꾸기로 밀려난 결산에는 쓰지 못한다.
  const again = (await as<{ id: number }>(
    U.ceo,
    `select official_statement_save_v2('biz_dy', 'year', '2091', null, '${FILE}', '다시 맞춤',
      '[{"account_code":"1030","amount":1000},{"account_code":"3310","amount":-1000},{"account_code":"ZZ-SGA","amount":20}]'::jsonb, null, true, '[]'::jsonb) as id`,
  )) as { id: number }[]
  assert.ok(Array.isArray(again), `0089: 바꾸기 결산을 못 세웠다 ${again}`)
  assert.match(String(await saveUn(U.ceo, lines, sid)), /official_unmatched_state/, '0089: 밀려난 결산에 다시 맞출 줄을 저장했다')
  assert.deepEqual(await saveUn(U.ceo, `'[]'::jsonb`, Number(again[0].id)), [{ n: 0 }], '0089: 빈 목록(지움)을 받지 않았다')

  // ── 3. 기능 스위치 ──
  const sw = (await db.query<{ enabled: boolean; audience: string }>(`select enabled, audience from feature_switches where business_id is null and feature_key = 'finance_upload_ai'`)).rows
  assert.deepEqual(sw, [{ enabled: true, audience: 'all' }], '0089: finance_upload_ai 기본 줄이 없다')
  await db.close()
  return '0089 열 맞춤(장부 쓰는 사람만 읽기 · 저장 · 직원 · AI Agent · 익명 · 다른 회사 거부 · 직접 쓰기 없음 · 더하기 · 칸 이름 모양 · 숫자 거부) · 다시 맞출 줄(권한 · 모양 · 통째로 바꿈 · 밀려난 결산 거부 · 읽기 범위 · 직접 쓰기 없음) · 스위치 finance_upload_ai'
}
