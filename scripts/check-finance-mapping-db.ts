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
  const sw2 = (await db.query<{ enabled: boolean; audience: string }>(`select enabled, audience from feature_switches where business_id is null and feature_key = 'finance_legacy_import'`)).rows
  assert.deepEqual(sw2, [{ enabled: true, audience: 'chairman' }], '0089: finance_legacy_import 기본 줄(대표만)이 없다')

  // ── 4. «예전 자료 가져오기» 옮김 기록 ──
  const mark = (uid: string | null, ref: string, outcome = 'saved', source = 'inbox', biz = 'biz_dy') => as<{ r: boolean }>(uid, `select fin_legacy_import_mark('${biz}', '${source}', '${ref}', '${outcome}', null, '시험') as r`)
  assert.match(String(await mark(U.ceo, 'a')), /fin_legacy_denied/, '0089: 대표가 아닌 회사 대표가 옮김 기록을 적었다')
  assert.match(String(await mark(U.member, 'a')), /fin_legacy_denied/, '0089: 직원이 옮김 기록을 적었다')
  assert.match(String(await mark(U.agent, 'a')), /fin_legacy_denied/, '0089: AI Agent가 옮김 기록을 적었다')
  assert.equal(typeof (await mark(null, 'a')), 'string', '0089: 익명이 옮김 기록을 적었다')
  assert.deepEqual(await mark(U.chair, 'a'), [{ r: true }], '0089: 대표가 처음 기록을 못 적었다')
  assert.deepEqual(await mark(U.chair, 'a'), [{ r: false }], '0089: 같은 자리를 두 번 적었다(멱등 아님)')
  assert.deepEqual(await mark(U.chair, 'b', 'failed'), [{ r: true }])
  assert.deepEqual(await mark(U.chair, 'b', 'saved'), [{ r: true }], '0089: 실패 기록을 새 결과로 못 바꿨다')
  assert.deepEqual(await mark(U.chair, 'b', 'failed'), [{ r: false }], '0089: 옮긴 기록을 실패로 덮었다')
  assert.match(String(await mark(U.chair, 'c', 'saved', 'robot')), /fin_legacy_shape/, '0089: 모르는 원천을 받았다')
  assert.match(String(await mark(U.chair, 'c', 'weird')), /fin_legacy_shape/, '0089: 모르는 결과를 받았다')
  assert.match(String(await mark(U.chair, 'c', 'saved', 'inbox', 'biz_nope')), /fin_legacy_shape/, '0089: 없는 회사를 받았다')
  assert.equal(((await as(U.chair, `select 1 from fin_legacy_imports where business_id = 'biz_dy'`)) as unknown[]).length, 2, '0089: 대표가 옮김 기록을 못 읽는다')
  assert.equal(((await as(U.ceo, `select 1 from fin_legacy_imports`)) as unknown[]).length, 0, '0089: 대표가 아닌 사람이 옮김 기록을 읽는다')
  assert.equal(typeof (await as(U.chair, `insert into fin_legacy_imports (business_id, source, source_ref, outcome) values ('biz_dy', 'inbox', 'z', 'saved') returning 1`)), 'string', '0089: 옮김 기록 표에 직접 썼다')
  assert.equal(typeof (await as(U.chair, `delete from fin_legacy_imports returning 1`)), 'string', '0089: 옮김 기록을 직접 지웠다')
  assert.equal(typeof (await as(null, `select 1 from fin_legacy_imports`)), 'string', '0089: 익명이 옮김 기록 표를 읽는다')

  // ── 5. 수신함 남의 폴더 읽기(대표 + 스위치 켬만 · 읽기만) ──
  const other = `biz_dy/${U.ceo}/legacy-a.xlsx`
  await db.exec(`insert into storage.objects (bucket_id, name, owner) values ('fin-upload-inbox', '${other}', '${U.ceo}'), ('fin-upload-inbox', 'biz_dy/${U.member}/legacy-b.xlsx', '${U.member}')`)
  const seeInbox = async (uid: string) => ((await as<{ n: number }>(uid, `select count(*)::int as n from storage.objects where bucket_id = 'fin-upload-inbox' and name like 'biz_dy/%/legacy-%'`)) as { n: number }[])[0].n
  assert.equal(await seeInbox(U.chair), 2, '0089: 대표 + 스위치 켬인데 직원 폴더 파일이 안 보인다')
  assert.equal(await seeInbox(U.ceo), 1, '0089: 회사 대표가 남의 폴더 파일을 본다(본인 것 하나만 보여야)')
  assert.equal(await seeInbox(U.member), 0, '0089: 장부 권한 없는 직원이 수신함을 본다')
  assert.deepEqual(await as(U.chair, `delete from storage.objects where bucket_id = 'fin-upload-inbox' and name = '${other}' returning 1`), [], '0089: 대표가 남의 수신함 파일을 지웠다')
  assert.equal(typeof (await as(U.chair, `insert into storage.objects (bucket_id, name, owner) values ('fin-upload-inbox', 'biz_dy/${U.ceo}/forged.xlsx', '${U.chair}') returning 1`)), 'string', '0089: 대표가 남의 수신함 폴더에 썼다')
  await db.exec(`update feature_switches set enabled = false where business_id is null and feature_key = 'finance_legacy_import'`)
  assert.equal(await seeInbox(U.chair), 0, '0089: 스위치를 껐는데 대표가 남의 폴더를 본다')
  await db.exec(`update feature_switches set enabled = true where business_id is null and feature_key = 'finance_legacy_import'`)

  // ── 6. «받을 것»(owner_inputs) — 대표만 · 직원 · 회사 대표 · AI Agent · 익명 거부 · 모양 · 원가 권한 먼저 · 구글 키는 Vault에만 ──
  const ownerOut = await ownerInputsDb(db, as)
  await db.close()
  return `${ownerOut} · 0089 열 맞춤(장부 쓰는 사람만 읽기 · 저장 · 직원 · AI Agent · 익명 · 다른 회사 거부 · 직접 쓰기 없음 · 더하기 · 칸 이름 모양 · 숫자 거부) · 다시 맞출 줄(권한 · 모양 · 통째로 바꿈 · 밀려난 결산 거부 · 읽기 범위 · 직접 쓰기 없음) · 스위치 finance_upload_ai · finance_legacy_import · 옮김 기록(대표만 · 두 번 안 적힘 · 실패만 다시 · 모양 · 직접 쓰기 없음) · 수신함 남의 폴더 읽기(대표 + 스위치 켬만 · 회사 대표 · 직원 안 보임 · 지우기 · 쓰기 없음 · 끄면 안 보임)`
}

type As = <T>(uid: string | null, sql: string) => Promise<T[] | string>

/** 시험용 가짜 서비스 계정 키 — 진짜처럼 보이지 않게 FAKE를 박는다(구글이 받지 않는 모양). */
export const FAKE_SA = {
  type: 'service_account',
  project_id: 'fake-project-0089',
  private_key_id: 'FAKE0089',
  private_key: '-----BEGIN FAKE KEY-----\nFAKE-NOT-A-REAL-KEY-0089-DO-NOT-USE\n-----END FAKE KEY-----\n',
  client_email: 'fake-reader@fake-project-0089.iam.gserviceaccount.com',
  client_id: '000000000000000000000',
}

/** 0089 5절 owner_inputs — financeMappingDb의 DB 위에서(사람 넷 · biz_dy · 장부 시드는 위에서 넣었다). */
async function ownerInputsDb(db: PGlite, as: As): Promise<string> {
  // Supabase Vault 흉내 — 표 하나 + create_secret · update_secret(authenticated 권한 없음).
  await db.exec(`
    create schema if not exists vault;
    create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text not null, description text, created_at timestamptz not null default now());
    create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid
      language sql as $f$ insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id $f$;
    create or replace function vault.update_secret(secret_id uuid, new_secret text default null) returns void
      language sql as $f$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $f$;
    revoke all on schema vault from public;
  `)
  const fake = JSON.stringify(FAKE_SA)
  const q = (s: string) => s.replace(/'/g, "''")
  const mark = (uid: string | null, item: string, scope: string, summary: string) => as(uid, `select owner_input_mark('${item}', '${scope}', '${q(summary)}'::jsonb) as r`)
  const sa = (uid: string | null, json: string) => as<{ r: Record<string, string> }>(uid, `select owner_input_google_sa_save('${q(json)}') as r`)

  // 6-1. 대표만 — 직원 · 회사 대표 · AI Agent · 익명 거부
  for (const [who, uid] of [['직원', U.member], ['회사 대표', U.ceo], ['AI Agent', U.agent]] as const) {
    assert.match(String(await mark(uid, 'inventory_method', 'biz_dy', '{"method":"fifo"}')), /owner_input_denied/, `0089 받을 것: ${who}가 받음을 적었다`)
    assert.match(String(await sa(uid, fake)), /owner_input_denied/, `0089 받을 것: ${who}가 구글 키를 올렸다`)
  }
  assert.equal(typeof (await mark(null, 'inventory_method', 'biz_dy', '{"method":"fifo"}')), 'string', '0089 받을 것: 익명이 받음을 적었다')
  assert.equal(typeof (await sa(null, fake)), 'string', '0089 받을 것: 익명이 구글 키를 올렸다')

  // 6-2. 모양 — 모르는 항목 · 없는 회사 · 모르는 방법 · 긴 메모 · 남는 칸 · 음수 · 구글은 mark로 못 받음
  for (const [item, scope, summary, why] of [
    ['inventory_method', 'biz_dy', '{"method":"lifo"}', '모르는 방법'],
    ['inventory_method', 'biz_dy', `{"method":"fifo","memo":"${'가'.repeat(501)}"}`, '긴 메모'],
    ['inventory_method', 'biz_dy', '{"method":"fifo","x":1}', '남는 칸'],
    ['inventory_method', 'biz_nope', '{"method":"fifo"}', '없는 회사'],
    ['real_bom', 'biz_dy', '{"rows":-1}', '음수 줄 수'],
    ['real_bom', 'biz_dy', '{"rows":"12"}', '글 줄 수'],
    ['google_sa', 'group', '{"client_email":"x"}', 'mark로 구글'],
    ['robot', 'biz_dy', '{}', '모르는 항목'],
  ] as const) {
    assert.match(String(await mark(U.chair, item, scope, summary)), /owner_input_shape/, `0089 받을 것: ${why}을(를) 받았다`)
  }

  // 6-3. 대표 — 재고평가방법 · 진짜 BOM 받음 · 바꾸기
  assert.ok(Array.isArray(await mark(U.chair, 'inventory_method', 'biz_dy', '{"method":"total_avg","memo":"세무사 확인(가짜)"}')), '0089 받을 것: 대표가 재고평가방법을 못 적었다')
  assert.ok(Array.isArray(await mark(U.chair, 'inventory_method', 'biz_dy', '{"method":"moving_avg"}')), '0089 받을 것: 대표가 재고평가방법을 못 바꿨다')
  assert.ok(Array.isArray(await mark(U.chair, 'real_bom', 'biz_dy', '{"rows":3}')), '0089 받을 것: 대표가 진짜 BOM 받음을 못 적었다')
  const inv = (await as<{ summary: Record<string, string>; received_by: string }>(U.chair, `select summary, received_by from owner_inputs where item_key = 'inventory_method' and scope = 'biz_dy'`)) as { summary: Record<string, string>; received_by: string }[]
  assert.deepEqual(inv[0].summary, { method: 'moving_avg' }, '0089 받을 것: 새 값으로 바꾸지 않았다')
  assert.equal(inv[0].received_by, U.chair)

  // 6-4. 원가 관리 권한자 — 원가 권한 줄이 먼저 있어야 적힌다
  assert.match(String(await mark(U.chair, 'cost_manager', 'biz_dy', `{"user_id":"${U.member}"}`)), /owner_input_no_grant/, '0089 받을 것: 원가 권한 없이 권한자로 적었다')
  await db.exec(`insert into user_module_access (user_id, module, can_write, can_approve) values ('${U.member}', '/costing/biz_dy', true, false)`)
  assert.ok(Array.isArray(await mark(U.chair, 'cost_manager', 'biz_dy', `{"user_id":"${U.member}"}`)), '0089 받을 것: 원가 권한 뒤에도 권한자를 못 적었다')
  assert.match(String(await mark(U.chair, 'cost_manager', 'biz_dy', '{"user_id":"not-a-uuid"}')), /owner_input_shape/, '0089 받을 것: uuid 아닌 사람을 받았다')

  // 6-5. 구글 서비스 계정 — 잘못된 JSON · type · private_key 없음 거부(오류에 본문 없음) · 대표 저장 → Vault에만 본문 · 응답 · 표에 본문 없음
  const broken = `{"type":"service_account","private_key":"FAKE-SECRET-SHOULD-NOT-ECHO-${'x'.repeat(40)}"`
  const e1 = String(await sa(U.chair, broken))
  assert.match(e1, /owner_input_sa_shape/, '0089 받을 것: 깨진 JSON을 받았다')
  assert.doesNotMatch(e1, /FAKE-SECRET-SHOULD-NOT-ECHO/, '0089 받을 것: 오류 문장에 키 본문이 실렸다')
  assert.match(String(await sa(U.chair, JSON.stringify({ ...FAKE_SA, type: 'authorized_user' }))), /owner_input_sa_shape/, '0089 받을 것: type이 다른 JSON을 받았다')
  const { private_key: _drop, ...noKey } = FAKE_SA
  void _drop
  assert.match(String(await sa(U.chair, JSON.stringify(noKey))), /owner_input_sa_shape/, '0089 받을 것: private_key 없는 JSON을 받았다')
  assert.match(String(await sa(U.chair, JSON.stringify({ ...FAKE_SA, client_email: 'someone@gmail.com' }))), /owner_input_sa_shape/, '0089 받을 것: 서비스 계정 아닌 이메일을 받았다')
  const saved = await sa(U.chair, fake)
  assert.ok(Array.isArray(saved), `0089 받을 것: 대표가 구글 키를 못 올렸다 ${typeof saved === 'string' ? saved : ''}`)
  const back = JSON.stringify(saved)
  assert.doesNotMatch(back, /FAKE-NOT-A-REAL-KEY|private_key|BEGIN/, '0089 받을 것: 응답에 키 본문이 실렸다')
  assert.deepEqual((saved as { r: Record<string, string> }[])[0].r, { client_email: FAKE_SA.client_email, project_id: FAKE_SA.project_id, secret: 'google_sheets_sa' })
  assert.ok(Array.isArray(await sa(U.chair, JSON.stringify({ ...FAKE_SA, private_key_id: 'FAKE0089b' }))), '0089 받을 것: 두 번째 올림(바꾸기)이 실패했다')
  const vault = (await db.query<{ n: number; secret: string }>(`select count(*) over ()::int as n, secret from vault.secrets where name = 'google_sheets_sa'`)).rows
  assert.equal(vault.length, 1, '0089 받을 것: Vault 비밀이 한 개가 아니다(바꾸기가 아니라 더했다)')
  assert.match(vault[0].secret, /FAKE0089b/, '0089 받을 것: Vault 비밀을 바꾸지 않았다')
  const rows = JSON.stringify(await as(U.chair, `select * from owner_inputs`))
  assert.doesNotMatch(rows, /FAKE-NOT-A-REAL-KEY|private_key|BEGIN/, '0089 받을 것: 표에 키 본문이 있다')
  assert.equal(typeof (await as(U.chair, `select 1 from vault.secrets`)), 'string', '0089 받을 것: 대표 세션이 Vault 표를 직접 읽는다')

  // 6-6. 읽기 — 대표만 · 표에 직접 쓰기 없음 · 스위치를 끄면 대표도 0 · 거부
  assert.equal(((await as(U.chair, `select 1 from owner_inputs`)) as unknown[]).length, 4, '0089 받을 것: 대표가 넷을 못 읽는다')
  for (const uid of [U.ceo, U.member, U.agent]) assert.equal(((await as(uid, `select 1 from owner_inputs`)) as unknown[]).length, 0, '0089 받을 것: 대표가 아닌 사람이 받을 것을 읽는다')
  assert.equal(typeof (await as(null, `select 1 from owner_inputs`)), 'string', '0089 받을 것: 익명이 받을 것 표를 읽는다')
  assert.equal(typeof (await as(U.chair, `insert into owner_inputs (item_key, scope) values ('real_bom', 'biz_vana') returning 1`)), 'string', '0089 받을 것: 표에 직접 썼다')
  assert.equal(typeof (await as(U.chair, `delete from owner_inputs returning 1`)), 'string', '0089 받을 것: 표를 직접 지웠다')
  await db.exec(`update feature_switches set enabled = false where business_id is null and feature_key = 'owner_inputs'`)
  assert.equal(((await as(U.chair, `select 1 from owner_inputs`)) as unknown[]).length, 0, '0089 받을 것: 스위치를 껐는데 대표가 읽는다')
  assert.match(String(await mark(U.chair, 'real_bom', 'biz_dy', '{"rows":1}')), /owner_input_denied/, '0089 받을 것: 스위치를 껐는데 적었다')
  assert.match(String(await sa(U.chair, fake)), /owner_input_denied/, '0089 받을 것: 스위치를 껐는데 구글 키를 올렸다')
  await db.exec(`update feature_switches set enabled = true where business_id is null and feature_key = 'owner_inputs'`)
  const sw = (await db.query<{ audience: string }>(`select audience from feature_switches where business_id is null and feature_key = 'owner_inputs' and enabled`)).rows
  assert.deepEqual(sw, [{ audience: 'chairman' }], '0089 받을 것: 스위치 기본 줄(대표만)이 없다')

  // 6-7. Vault가 없는 DB — 낱말 하나(본문 없음)
  await db.exec(`drop schema vault cascade`)
  const e2 = String(await sa(U.chair, fake))
  assert.match(e2, /owner_input_vault_missing/, '0089 받을 것: Vault 없는 DB에서 다른 오류')
  assert.doesNotMatch(e2, /FAKE-NOT-A-REAL-KEY/, '0089 받을 것: Vault 오류에 키 본문이 실렸다')
  return '0089 받을 것(대표만 · 직원 · 회사 대표 · AI Agent · 익명 거부 · 모양 여덟 · 바꾸기 · 원가 권한 먼저 · 깨진 JSON · type · private_key 없음 · 서비스 계정 아닌 이메일 거부(오류에 본문 없음) · Vault에만 본문 · 바꾸기 한 개 · 응답 · 표에 본문 없음 · 대표도 Vault 직접 못 읽음 · 직접 쓰기 없음 · 스위치 끄면 0 · 거부 · Vault 없음 낱말)'
}
