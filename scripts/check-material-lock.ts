/**
 * 0080 원료 단가 · kg 노출 막기 — npm run check:material-lock
 *   ① PGlite(실제 0001~0080): 열 grant(세 표 숫자 칸 없음 — 대표도 직접 select 거부) · fin_material_lines 줄마다 문
 *      (장부 담당 = 김병훈 자리 · 회사 대표 · 장부 읽기만 · CFO · 대표 · 원가 관리 · 올린 사람 59분 / 61분) · 합계(fin_material_totals — 수량 없음) ·
 *      미리보기 대기(fin_upload_pending — 가림 · 칸 격자 없음) · 넣기 지킴(가려진 사람 거부 · 올린 사람 됨) · 월별 손익 원료별 문(CFO 더함) ·
 *      AIAgent · anon · 정의자 함수 전수(세 표 · 대기 줄을 읽는 정의자 = 허용 목록)
 *   ② dummy 거울(대표 · 원가 관리 · 회사 대표 · 올린 사람 1시간) · ③ AI 견본 숫자 가림 · ④ 정적(화면 · 액션 · 저장소)
 * 진짜 회사 자료 · AI 호출 · 네트워크 없음. 원료 이름 · 금액은 전부 가짜.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000080a1',
  cfo: '00000000-0000-0000-0000-0000000080a2',
  kim: '00000000-0000-0000-0000-0000000080a3', // 김병훈 자리 — DY 경영지원 사원 · '/finance/biz_dy' 쓰기
  ceo: '00000000-0000-0000-0000-0000000080a4', // 회사 대표(BusinessCEO) — 장부 쓰기 · 원가 관리 아님
  reader: '00000000-0000-0000-0000-0000000080a5', // '/finance/biz_dy' 읽기만
  cost: '00000000-0000-0000-0000-0000000080a6', // '/finance/biz_dy' 읽기 + '/costing/biz_dy' 읽기
  ai: '00000000-0000-0000-0000-0000000080a7', // AIAgent — 원가 관리 줄이 있어도 거짓
}
const P = '2099-03'
const NUMERIC = ['qty', 'amount', 'amount_vat', 'stock_qty', 'used_qty', 'opening_amount', 'fx_rate', 'amount_krw', 'extra_cost', 'qty_kg']

/** 0080이 검토한 정의자 함수 — 세 표(입고 · 재고 · OFFER) 또는 대기 줄(pending)을 읽는 것. 새로 생기면 이 목록과 0080 머리말에 더하고 다시 본다. */
const DEFINERS = [
  'cost_candidate_upload_guard', 'cost_fin_candidate_decide', 'cost_fin_candidates', 'cost_fin_candidates_line_ok',
  'fin_inventory_roll', 'fin_material_lines', 'fin_material_totals', 'fin_pl_gather',
  'fin_tx_line_ok', 'fin_upload_apply', 'fin_upload_pending', 'fin_upload_unvoid', 'fin_upload_void',
]

async function pglite() {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } })
  await applyAll(db)
  const owner = async <T,>(sql: string) => (await db.query<T>(sql)).rows
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
  /** 내부 함수(authenticated grant 없음)를 그 사람 세션 값으로 — 역할은 소유자 그대로. */
  const claim = async <T,>(uid: string, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    try {
      return (await db.query<T>(sql)).rows
    } finally {
      await db.exec('rollback')
    }
  }
  const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)
  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    insert into auth.users (id, email) values ${Object.values(U).map((u) => `('${u}', '${u.slice(-4)}@x')`).join(', ')};
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${U.chair}', 'Chairman', '대표', 'Vault'), ('${U.cfo}', 'GroupCFO', 'cfo', 'Restricted'), ('${U.kim}', 'Member', '경영지원 사원', 'Normal'),
      ('${U.ceo}', 'BusinessCEO', '회사 대표', 'Restricted'), ('${U.reader}', 'Member', '장부 읽기', 'Normal'),
      ('${U.cost}', 'Member', '원가 관리', 'Normal'), ('${U.ai}', 'AIAgent', 'AI', 'Restricted');
    insert into user_business_access values ('${U.kim}', 'biz_dy'), ('${U.ceo}', 'biz_dy'), ('${U.reader}', 'biz_dy'), ('${U.cost}', 'biz_dy'), ('${U.ai}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values
      ('${U.kim}', '/finance/biz_dy', true, false), ('${U.reader}', '/finance/biz_dy', false, false),
      ('${U.cost}', '/finance/biz_dy', false, false), ('${U.cost}', '/costing/biz_dy', false, false), ('${U.ai}', '/costing/biz_dy', true, false);
  `)

  // ── a. 열 grant — 세 표의 숫자 칸은 authenticated에 없다(대표도 직접 select 거부 · 이름 칸은 읽힌다) ──
  const granted = await owner<{ t: string; c: string }>(`select p.table_name as t, p.column_name as c from information_schema.column_privileges p
    join information_schema.columns c on c.table_schema = p.table_schema and c.table_name = p.table_name and c.column_name = p.column_name
   where p.grantee = 'authenticated' and p.privilege_type = 'SELECT' and p.table_schema = 'public'
     and p.table_name in ('fin_purchase_in_lines', 'fin_inventory_lines', 'fin_import_lines', 'fin_material_issues') and c.data_type = 'numeric'`)
  assert.deepEqual(granted, [], `0080: 원료 표 숫자 칸이 authenticated에 열려 있다 (${granted.map((g) => `${g.t}.${g.c}`).join(', ')})`)
  for (const [t, c] of [['fin_purchase_in_lines', 'amount'], ['fin_purchase_in_lines', 'qty'], ['fin_inventory_lines', 'stock_qty'], ['fin_import_lines', 'amount_krw']]) {
    await refuses(as(U.chair, `select ${c} from ${t} limit 1`), /permission denied/, `0080: 대표가 ${t}.${c}를 직접 읽었다(읽기는 fin_material_lines)`)
    await refuses(as(U.kim, `select ${c} from ${t} limit 1`), /permission denied/, `0080: 장부 담당이 ${t}.${c}를 직접 읽었다`)
  }

  // ── b. 김병훈 자리가 입고 · 재고 · OFFER를 넣는다(올린 사람 = 김병훈) ──
  const apply = (uid: string, kind: string, sha: string, rows: unknown[], upload: string | null = null) =>
    as<{ id: string }>(uid, `select fin_upload_apply('biz_dy', '${kind}', '${P}', '가짜 ${kind}.xlsx', '${sha.repeat(64).slice(0, 64)}', 's', 'high', 0, false,
      '${JSON.stringify(rows)}'::jsonb, null, 'none', null, ${upload ? `'${upload}'` : 'null'}, 0)::text as id`)
  const [{ id: upPur }] = await apply(U.kim, 'purchase_in', 'a', [
    { row_no: 4, material: '가짜 원료 가', supplier: '가짜 공급처', qty: 1000, amount: 1_250_000 },
    { row_no: 5, material: '가짜 원료 나', supplier: '가짜 공급처', qty: 500, amount: 900_000 },
    { row_no: 6, material: '가짜 원료 마', supplier: '가짜 공급처', qty: 100, amount: 100_000 },
  ])
  const [{ id: upInv }] = await apply(U.kim, 'inventory', 'b', [{ row_no: 3, item: '가짜 원료 가', stock_qty: 200, amount: 250_000, amount_state: 'value' }])
  const [{ id: upImp }] = await apply(U.kim, 'import', 'c', [{ row_no: 2, ref_no: 'OF-1', material: '가짜 원료 다', supplier: '가짜 해외', currency: 'USD', amount: 1000, fx_rate: 1300, amount_krw: 1_300_000, extra_cost: 80_000 }])
  assert.ok(upPur && upInv && upImp, '0080: 넣기 준비')

  type Line = Record<string, unknown> & { hidden: boolean }
  const lines = async (uid: string, kind: string) => (await as<{ v: Line[] }>(uid, `select fin_material_lines('biz_dy', '${P}', '${kind}') as v`))[0].v
  const shows = async (uid: string, kind: string, why: string) => {
    const ls = await lines(uid, kind)
    assert.ok(ls.length > 0 && ls.every((l) => !l.hidden && l.amount !== null), `0080: ${why} — ${kind} 숫자가 보여야 한다`)
  }
  const hides = async (uid: string, kind: string, why: string) => {
    const ls = await lines(uid, kind)
    assert.ok(ls.length > 0, `0080: ${why} — ${kind} 줄(이름)은 보여야 한다`)
    for (const l of ls) {
      assert.equal(l.hidden, true, `0080: ${why} — ${kind} hidden이 아니다`)
      for (const k of NUMERIC) assert.ok(l[k] === undefined || l[k] === null, `0080: ${why} — ${kind}.${k} = ${String(l[k])}`)
    }
  }
  // 올린 사람 본인(방금) · 대표 · CFO · 원가 관리 — 보인다. 회사 대표 · 장부 읽기만 — 가림.
  for (const k of ['purchase_in', 'inventory', 'import']) {
    await shows(U.kim, k, '올린 사람(방금)')
    await shows(U.chair, k, '대표')
    await shows(U.cfo, k, 'CFO')
    await shows(U.cost, k, '원가 관리')
    await hides(U.ceo, k, '회사 대표(원가 관리 아님 · 올린 사람 아님)')
    await hides(U.reader, k, '장부 읽기만')
  }
  const pur = await lines(U.chair, 'purchase_in')
  assert.deepEqual(pur.map((l) => [l.material, Number(l.qty), Number(l.amount)]), [['가짜 원료 가', 1000, 1_250_000], ['가짜 원료 나', 500, 900_000], ['가짜 원료 마', 100, 100_000]], '0080: 대표 입고 줄 값')
  // 올린 뒤 59분 — 아직 보인다 · 61분 — 가림(김병훈 자리도 합계만).
  await owner(`update fin_uploads set created_at = now() - interval '59 minutes' where upload_id in ('${upPur}', '${upInv}', '${upImp}')`)
  for (const k of ['purchase_in', 'inventory', 'import']) await shows(U.kim, k, '올린 사람(59분)')
  await owner(`update fin_uploads set created_at = now() - interval '61 minutes' where upload_id in ('${upPur}', '${upInv}', '${upImp}')`)
  for (const k of ['purchase_in', 'inventory', 'import']) await hides(U.kim, k, '올린 사람(61분)')
  await shows(U.chair, 'purchase_in', '대표(61분 뒤에도)')
  // 장부 권한이 없어진 올린 사람 — 1시간 안이어도 가림.
  await owner(`update fin_uploads set created_at = now() - interval '5 minutes' where upload_id = '${upPur}'`)
  await shows(U.kim, 'purchase_in', '올린 사람(5분)')
  await owner(`update user_module_access set can_write = false where user_id = '${U.kim}' and module = '/finance/biz_dy'`)
  await hides(U.kim, 'purchase_in', '장부 쓰기를 잃은 올린 사람')
  await owner(`update user_module_access set can_write = true where user_id = '${U.kim}' and module = '/finance/biz_dy'`)
  await owner(`update fin_uploads set created_at = now() - interval '61 minutes' where upload_id = '${upPur}'`)

  // ── c. 회사 · 월 합계 금액 — 장부 읽기만 · 회사 대표도. 수량 · 원료 이름 없음 ──
  const [{ v: tot }] = await as<{ v: Record<string, unknown> }>(U.reader, `select fin_material_totals('biz_dy', '${P}') as v`)
  assert.equal(Number(tot.purchase_amount), 2_250_000, '0080: 입고 합계(원료 3가지)')
  // 리뷰 I1: 원료 1가지인 재고 · OFFER는 합계가 곧 원료 하나의 값 — 장부 읽기만에게 감춘다.
  assert.deepEqual([tot.inventory_closing, tot.import_krw, tot.import_extra, tot.withheld], [null, null, null, ['inventory', 'import']], '0080: 원료 3가지 미만 합계가 보인다')
  for (const k of Object.keys(tot)) assert.ok(!/qty|kg|material|unit/.test(k), `0080: 합계에 ${k}`)
  const [{ v: totChair }] = await as<{ v: Record<string, unknown> }>(U.chair, `select fin_material_totals('biz_dy', '${P}') as v`)
  assert.deepEqual([Number(totChair.inventory_closing), Number(totChair.import_krw), Number(totChair.import_extra), totChair.withheld], [250_000, 1_300_000, 80_000, []], '0080: 대표 합계')
  // 기초재고 연결(fin_inventory_roll) 원재료 줄도 같은 문턱.
  const raw = async (uid: string) => (await as<{ closing_amount: string | null }>(uid, `select closing_amount from fin_inventory_roll('biz_dy', '${P}') where category = 'raw'`))[0].closing_amount
  assert.equal(await raw(U.reader), null, '0080: 품목 1가지 원재료 기말이 장부 읽기만에게 보인다')
  assert.equal(Number(await raw(U.cfo)), 250_000, '0080: CFO 원재료 기말')
  // AIAgent는 0047부터 장부 읽기([제한] 열람) — 회사 · 월 합계는 읽고, 줄 숫자는 원가 관리 줄이 있어도 가림.
  assert.equal(Number((await as<{ v: Record<string, unknown> }>(U.ai, `select fin_material_totals('biz_dy', '${P}') as v`))[0].v.purchase_amount), 2_250_000, '0080: AI 합계')
  for (const k of ['purchase_in', 'inventory', 'import']) await hides(U.ai, k, 'AIAgent(원가 관리 줄이 있어도)')
  await refuses(as(null, `select fin_material_totals('biz_dy', '${P}')`), /permission denied/, '0080: anon 합계')
  await refuses(as(null, `select fin_material_lines('biz_dy', '${P}', 'purchase_in')`), /permission denied/, '0080: anon 줄')
  await refuses(as(U.kim, `select fin_material_lines('biz_dy', '${P}', 'sales')`), /fin_material_kind/, '0080: 다른 종류')
  const outsider = '00000000-0000-0000-0000-0000000080b1'
  await db.exec(`insert into auth.users (id, email) values ('${outsider}', 'o@x'); insert into user_profiles (user_id, role, display_name, max_security_class) values ('${outsider}', 'Member', '다른 회사', 'Normal')`)
  await refuses(as(outsider, `select fin_material_lines('biz_dy', '${P}', 'purchase_in')`), /fin_upload_denied/, '0080: 장부 권한 없는 사람')

  // ── d. 미리보기 대기 — 올린 사람(방금)은 숫자 · 칸 격자, 회사 대표는 가림 · 칸 격자 없음, 대표는 그대로 ──
  const pending = { rows: [{ row_no: 4, material: '가짜 원료 라', supplier: '가짜', qty: 300, amount: 450_000 }], grid: [['자재명', '공급처', '수량', '금액'], ['가짜 원료 라', '가짜', 300, 450_000]], meta: { header_row: 0, errors: ['금액 칸 줄의 합 450,000 ≠ 합계 줄 450,001'], warnings: ['«원료 라 소계» 수량 칸: 줄의 합 300'] } }
  const [{ id: pend }] = await as<{ id: string }>(U.kim, `select fin_upload_record('biz_dy', 'purchase_in', '2099-04', '가짜 대기.xlsx', '${'d'.repeat(64)}', 's', 'medium', 0, 'needs_review',
    '${JSON.stringify(pending)}'::jsonb, null)::text as id`)
  const pv = async (uid: string) => (await as<{ v: Record<string, unknown> & { rows: Record<string, unknown>[] } }>(uid, `select fin_upload_pending('${pend}') as v`))[0].v
  const kimPv = await pv(U.kim)
  assert.ok(!kimPv.masked && kimPv.grid && kimPv.rows[0].amount === 450_000, '0080: 올린 사람(방금) 대기 숫자')
  const ceoPv = await pv(U.ceo)
  assert.equal(ceoPv.masked, true, '0080: 회사 대표 대기가 가려지지 않았다')
  assert.equal(ceoPv.grid, undefined, '0080: 회사 대표에게 칸 격자(시트 숫자)가 갔다')
  assert.ok(ceoPv.rows[0].material === '가짜 원료 라' && ceoPv.rows[0].qty === undefined && ceoPv.rows[0].amount === undefined, '0080: 회사 대표 대기 줄 숫자')
  const ceoMeta = ceoPv.meta as Record<string, unknown>
  assert.ok(ceoMeta.errors === undefined && ceoMeta.warnings === undefined && ceoMeta.header_row === 0, '0080: 회사 대표 대기 검증 문구에 줄 합 · 소계 숫자가 남았다(리뷰 M1)')
  assert.ok(Array.isArray((kimPv.meta as Record<string, unknown>).errors), '0080: 올린 사람 검증 문구')
  // 리뷰 M3: 다른 종류(판매)로 잡힌 대기도 칸 격자는 문 밖에 가지 않는다(종류를 잘못 알아본 원료 파일).
  const [{ id: pendS }] = await as<{ id: string }>(U.kim, `select fin_upload_record('biz_dy', 'sales', '2099-04', '가짜 판매 대기.xlsx', '${'1'.repeat(64)}', 's', 'low', 0, 'needs_review',
    '${JSON.stringify({ rows: [{ row_no: 2, product: '가짜 제품', amount: 1000 }], grid: [['품목', '금액'], ['가짜 원료 라', 450_000]], meta: {} })}'::jsonb, null)::text as id`)
  const [{ v: salesCeo }] = await as<{ v: Record<string, unknown> & { rows: Record<string, unknown>[] } }>(U.ceo, `select fin_upload_pending('${pendS}') as v`)
  assert.ok(salesCeo.grid === undefined && !salesCeo.masked && salesCeo.rows[0].amount === 1000, '0080: 판매 대기 칸 격자가 회사 대표에게 갔다(줄은 그대로)')
  const cfoPv = await pv(U.cfo)
  assert.ok(!cfoPv.masked && cfoPv.grid, '0080: CFO 대기')
  // 모름(unknown) 시트도 원료 파일일 수 있다 — 칸 격자를 가린다.
  const [{ id: pendU }] = await as<{ id: string }>(U.kim, `select fin_upload_record('biz_dy', 'unknown', null, '가짜 모름.xlsx', '${'e'.repeat(64)}', 's', 'none', 0, 'needs_review',
    '${JSON.stringify({ rows: [], grid: pending.grid, meta: {} })}'::jsonb, null)::text as id`)
  const [{ v: unkCeo }] = await as<{ v: Record<string, unknown> }>(U.ceo, `select fin_upload_pending('${pendU}') as v`)
  assert.ok(unkCeo.masked === true && unkCeo.grid === undefined, '0080: 모름 시트 칸 격자가 회사 대표에게 갔다')

  // ── e. 넣기 지킴 — 가려진 사람(회사 대표)은 그 대기를 넣지 못한다 · 올린 사람(방금)은 넣는다 ──
  const pendRows = JSON.stringify(ceoPv.rows)
  await refuses(as(U.ceo, `select fin_upload_apply('biz_dy', 'purchase_in', '2099-04', null, null, 's', 'medium', 0, false, '${pendRows}'::jsonb, null, 'none', null, '${pend}', 0)`),
    /fin_material_hidden/, '0080: 가려진 대기를 회사 대표가 넣었다(숫자 없는 줄)')
  await refuses(as(U.ceo, `select fin_upload_apply('biz_dy', 'sales', '2099-04', null, null, 's', 'medium', 0, false, '[{"row_no":1,"product":"x","amount":1}]'::jsonb, null, 'none', null, '${pendU}', 0)`.replace(`'sales', '2099-04'`, `'purchase_in', '2099-04'`).replace('"product":"x","amount":1', '"material":"x"')),
    /fin_material_hidden/, '0080: 가려진 모름 대기를 회사 대표가 입고로 넣었다')
  await as(U.kim, `select fin_upload_apply('biz_dy', 'purchase_in', '2099-04', null, null, 's', 'medium', 0, false, '${JSON.stringify(kimPv.rows)}'::jsonb, null, 'none', null, '${pend}', 0)`)
  assert.equal((await lines(U.chair, 'purchase_in')).length, 3, '0080: 넣기 뒤 다른 달 줄이 섞였다')
  const [{ n: n04 }] = await owner<{ n: number }>(`select count(*)::int as n from fin_purchase_in_lines where period = '2099-04' and amount = 450000`)
  assert.equal(n04, 1, '0080: 올린 사람이 넣은 대기 줄의 금액')
  // 1시간 지난 자기 대기도 넣지 못한다(가려진 줄이 돌아온다).
  const [{ id: pend2 }] = await as<{ id: string }>(U.kim, `select fin_upload_record('biz_dy', 'import', '2099-05', '가짜 대기 2.xlsx', '${'f'.repeat(64)}', 's', 'medium', 0, 'needs_review',
    '${JSON.stringify({ rows: [{ row_no: 2, material: '가짜', amount: 1, amount_krw: 1300 }], grid: [['품목', '원화'], ['가짜', 1300]], meta: {} })}'::jsonb, null)::text as id`)
  await owner(`update fin_uploads set created_at = now() - interval '61 minutes' where upload_id = '${pend2}'`)
  assert.equal((await as<{ v: Record<string, unknown> }>(U.kim, `select fin_upload_pending('${pend2}') as v`))[0].v.masked, true, '0080: 61분 지난 자기 대기가 가려지지 않았다')
  await refuses(as(U.kim, `select fin_upload_apply('biz_dy', 'import', '2099-05', null, null, 's', 'medium', 0, false, '[{"row_no":2,"material":"가짜"}]'::jsonb, null, 'none', null, '${pend2}', 0)`),
    /fin_material_hidden/, '0080: 61분 지난 자기 대기를 넣었다')
  // 취소(cancelled)는 그대로 된다 — 지킴은 «넣기»만.
  await as(U.kim, `select fin_upload_cancel('${pend2}')`)

  // ── f. 월별 손익 원료별 줄의 문 = 대표 · CFO · 원가 관리(0075는 CFO가 빠져 있었다) ──
  const viewer = async (uid: string) => (await claim<{ v: boolean }>(uid, `select fin_pl_cost_viewer('biz_dy') as v`))[0].v
  const seen: boolean[] = []
  for (const u of [U.chair, U.cfo, U.cost, U.kim, U.ceo, U.reader, U.ai]) seen.push(await viewer(u)) // 한 연결 — 차례로(동시에 부르면 begin이 섞인다)
  assert.deepEqual(seen, [true, true, true, false, false, false, false], `0080: 월별 손익 원료별 줄을 보는 사람(대표 · CFO · 원가 관리만 — AIAgent 거짓) ${JSON.stringify(seen)}`)
  const [{ v: aiLine }] = await claim<{ v: boolean }>(U.ai, `select fin_material_line_ok('biz_dy', '${upPur}') as v`)
  assert.equal(aiLine, false, '0080: AIAgent 줄 문')
  for (const fn of ['fin_material_viewer(text)', 'fin_material_line_ok(text, uuid)', 'fin_pl_cost_viewer(text)', 'fin_material_apply_guard()']) {
    const [{ ok }] = await owner<{ ok: boolean }>(`select has_function_privilege('authenticated', '${fn}', 'execute') as ok`)
    assert.equal(ok, false, `0080: authenticated가 내부 함수 ${fn}를 부른다`)
  }

  // ── g. 정의자 함수 전수 — 세 표 · 대기 줄을 읽는 정의자는 검토한 목록뿐 ──
  const defs = (await owner<{ f: string }>(`select distinct p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and (p.prosrc ~ '(fin_purchase_in_lines|fin_inventory_lines|fin_import_lines)' or p.prosrc ~ '\\.pending\\M') order by 1`)).map((r) => r.f)
  assert.deepEqual(defs, [...DEFINERS].sort(), `0080: 원료 표 · 대기 줄을 읽는 정의자 함수가 검토 목록과 다르다 — 새 함수는 0080 머리말처럼 문을 보고 목록에 더한다 (${defs.join(', ')})`)
  await db.close()
  console.log('① PGlite 0080(열 grant · 줄마다 문 · 59/61분 · 장부 잃음 · 합계 · 대기 가림 · 모름 · 넣기 지킴 · 월별 손익 CFO · AIAgent · anon · 정의자 전수) OK')
}

async function dummy() {
  const { dummyRepository: repo } = await import('../src/lib/repository/dummy')
  const as = async <T,>(user: string, fn: () => Promise<T>) => {
    const prev = process.env.DUMMY_USER
    process.env.DUMMY_USER = user
    try {
      return await fn()
    } finally {
      if (prev === undefined) delete process.env.DUMMY_USER
      else process.env.DUMMY_USER = prev
    }
  }
  const B = 'biz_dy'
  // 예시 자료(2026-09 — 오래전에 올린 것): 대표 · 원가 관리(support_lead)는 숫자, 회사 대표는 가림.
  const purOf = (ls: Awaited<ReturnType<typeof repo.listFinTxLines>>) => ls.filter((l) => l.ref.startsWith('fin_purchase_in_lines:'))
  const chair = purOf(await as('chairman', () => repo.listFinTxLines(B, '2026-09')))
  assert.ok(chair.length > 0 && chair.every((l) => !l.hidden && l.amount !== null), 'dummy: 대표 입고 줄 숫자')
  assert.ok(purOf(await as('support_lead', () => repo.listFinTxLines(B, '2026-09'))).every((l) => !l.hidden), 'dummy: 원가 관리 입고 줄 숫자')
  const ceo = purOf(await as('dy_ceo', () => repo.listFinTxLines(B, '2026-09')))
  assert.ok(ceo.length > 0 && ceo.every((l) => l.hidden && l.amount === null && l.qty === null && l.vat === null), 'dummy: 회사 대표 입고 줄이 가려지지 않았다')
  const tot = await as('dy_ceo', () => repo.finMaterialTotals(B, '2026-09'))
  assert.ok(tot && tot.purchase_lines > 0 && (tot.purchase_amount !== null || !!tot.withheld?.includes('purchase')), 'dummy: 회사 대표 합계')
  const totChair = await as('chairman', () => repo.finMaterialTotals(B, '2026-09'))
  assert.ok(totChair && totChair.purchase_amount !== null && !totChair.withheld?.length, 'dummy: 대표 합계')
  // 회사 대표가 방금 올린 대기 — 본인은 숫자, 다른 장부 담당(support_lead는 원가 관리라 봄)… 회사 대표 대기를 대표가 보고, 가림은 1시간 뒤.
  const id = await as('dy_ceo', () => repo.finUploadRecord({ business_id: B, kind: 'purchase_in', period: '2099-06', file_name: '가짜.xlsx', file_sha256: 'c'.repeat(64), sheet_name: 's', ai_confidence: 'medium', ai_used: 0, status: 'needs_review', pending: { rows: [{ row_no: 2, material: '가짜 원료', qty: 10, amount: 1000 }], grid: [['자재명', '수량', '금액'], ['가짜 원료', 10, 1000]], meta: {} }, error: null }))
  const own = await as('dy_ceo', () => repo.finUploadPending(id))
  assert.ok(own && !own.masked && own.grid && own.rows[0].amount === 1000, 'dummy: 올린 사람(방금) 대기 숫자')
  const { dummyFinStore } = await import('../src/lib/repository/dummy-finance-upload')
  const row = dummyFinStore().uploads.find((u) => u.upload_id === id)!
  row.created_at = new Date(Date.now() - 61 * 60 * 1000).toISOString()
  const late = await as('dy_ceo', () => repo.finUploadPending(id))
  assert.ok(late?.masked && !late.grid && late.rows[0].amount === undefined && late.rows[0].material === '가짜 원료', 'dummy: 61분 뒤 대기가 가려지지 않았다')
  await assert.rejects(as('dy_ceo', () => repo.finUploadApply({ business_id: B, kind: 'purchase_in', period: '2099-06', file_name: '', file_sha256: '', sheet_name: 's', ai_confidence: 'medium', ai_used: 0, auto: false, rows: late!.rows, people: null, overlap: 'none', reason: null, upload_id: id, dup_suspects: null })),
    /fin_material_hidden/, 'dummy: 가려진 대기를 넣었다')
  const chairPv = await as('chairman', () => repo.finUploadPending(id))
  assert.ok(chairPv && !chairPv.masked && chairPv.grid, 'dummy: 대표 대기')
  console.log('② dummy 거울(대표 · 원가 관리 · 회사 대표 가림 · 합계 · 올린 사람 1시간 · 넣기 지킴) OK')
}

async function aiSampleMask() {
  const { aiSample } = await import('../src/lib/finance-upload/pipeline')
  const t = (v: string) => ({ t: 'text' as const, v })
  const num = (v: number) => ({ t: 'number' as const, v })
  const sheet = {
    name: '입고명세서',
    rows: [
      [t('2099년 3월 입고명세서')],
      [t('자재명'), t('입고일자'), t('수량'), t('단가'), t('금액')],
      [t('가짜 원료 가'), t('2099-03-04'), num(1000), t('1,250'), num(1_250_000)],
      [t('가짜 원료 나'), t('2099.03.05'), t('1.5톤'), t('@3,200'), t('USD 12,000')],
      [t('합계'), t(''), num(1000), t(''), t('1,250,000원')],
    ],
  }
  const s = aiSample(sheet as never, 1)
  const flat = s.rows.flat().join('|')
  assert.ok(!/1,?250|1000|1\.5|3,200|12,000/.test(flat), `AI 견본에 숫자가 남았다 (${flat})`)
  assert.ok(flat.includes('2099.03.05'), `AI 견본이 날짜를 가렸다 (${flat})`)
  assert.ok(flat.includes('자재명') && flat.includes('가짜 원료 가') && flat.includes('2099-03-04') && flat.includes('<숫자>'), `AI 견본이 머리글 · 글자 · 날짜를 잃었다 (${flat})`)
  console.log('③ AI 견본(머리글 아래 숫자 → <숫자> · 머리글 · 글자 · 날짜는 그대로) OK')
}

function statics() {
  const root = join(__dirname, '..')
  const read = (p: string) => readFileSync(join(root, p), 'utf8')
  const repoSb = read('src/lib/repository/supabase-finance-upload.ts')
  assert.match(repoSb, /rpc\('fin_material_lines'/, '저장소가 입고 줄을 fin_material_lines로 읽지 않는다')
  assert.match(repoSb, /rpc\('fin_material_totals'/, '저장소에 합계 RPC가 없다')
  // 2026-10-20 A2: 넣기 한 건은 lib/finance-upload/pending-save.ts(«예전 자료 가져오기»와 같은 길)로 옮겨졌다.
  assert.match(read('src/app/actions/finance-upload.ts'), /await savePending\(/, '넣기 액션이 savePending을 거치지 않는다')
  assert.match(read('src/lib/finance-upload/pending-save.ts'), /if \(pending\.masked\) return \{ error: MATERIAL_HIDDEN/, '넣기 액션이 가려진 대기를 거르지 않는다')
  const page = read('src/app/(dashboard)/finance/[business_id]/upload/page.tsx')
  assert.match(page, /l\.hidden \? '금액 가림'/, '같은 거래 줄 이름에 가린 금액 표시가 없다')
  assert.match(page, /masked: !!p\?\.masked/, '화면이 대기 가림을 넘기지 않는다')
  // 0085 — 보류 칸(upload-board): 가려진 대기는 «저장» 단추 자체가 없다.
  assert.match(read('src/components/finance-overview/upload-board.tsx'), /const canDo = !h\.masked/, '가려진 대기의 «저장» 단추가 열려 있다')
  const sql = read('supabase/migrations/0080_material_price_lock.sql')
  assert.ok(!/disable row level security|no force row level security|service_role/i.test(sql), '0080이 RLS를 끄거나 service_role을 쓴다')
  for (const t of [page, read('src/components/finance/finance-upload-board.tsx'), read('src/components/finance-overview/upload-board.tsx')]) assert.ok(!/회장/.test(t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), '직원 화면 문구에 «회장»')
  console.log('④ 정적(저장소 RPC · 액션 거름 · 화면 가림 · 단추 · RLS · 문구) OK')
}

async function main() {
  await pglite()
  await dummy()
  await aiSampleMask()
  statics()
  console.log('PASS: check:material-lock')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
