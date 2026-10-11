/**
 * check:cost-engine ⑬ — 0066 견적 · 가격 예외 결재. BYPASSRLS 없는 소유자(⑥ 이후) 아래에서 돈다.
 *   Green 바로 확정 · Red → 결재(팀장 → 대표) → 승인 → 확정 · Red → 반려 → 새 판 · 스냅숏 = 영업 화면 값(0시 기준) ·
 *   위조(표 쓰기 · 손으로 올린 가격 예외 · 소유자 경로 얼림) · Red 우회(결재 전 확정 · 결재 뒤 제시가) · 결재 양식에 원료 0 ·
 *   읽기(본인 · subtree 영업 팀장 · 대표 / 다른 영업 · 구매 · 생산 · 원가 관리 0행) · 원가 관리 회계용(제품 · kg · 제시가만) ·
 *   다른 회사 · 대표 원래 값 · 내려받기 감사 · 만료.
 */
import assert from 'node:assert/strict'

import type { PGlite } from '@electric-sql/pglite'

export interface QuoteCtx {
  db: PGlite
  as: <T>(uid: string | null, sql: string, commit?: boolean) => Promise<T[]>
  run: (uid: string, sql: string) => Promise<unknown[]>
  owner: <T>(sql: string) => Promise<T[]>
  p1: string
  mats: string[]
  materialNames: string[]
  U: Record<string, string>
}

const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)

export async function quotes({ db, as, run, owner, p1, mats, materialNames, U }: QuoteCtx) {
  const lead = '00000000-0000-0000-0000-0000000066a1' // DY 영업 팀장(TeamLead) — U.sales의 상사
  const other = '00000000-0000-0000-0000-0000000066a2' // DY 다른 영업 직원(팀장 subtree 밖)
  await db.exec(`
    insert into auth.users (id, email) values ('${lead}', 'ql@x'), ('${other}', 'qo@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${lead}', 'TeamLead', '영업 팀장', 'Normal'), ('${other}', 'Member', '다른 영업', 'Normal');
    insert into user_business_access values ('${lead}', 'biz_dy'), ('${other}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values
      ('${lead}', '/sales/biz_dy', true, false), ('${other}', '/sales/biz_dy', true, false);
    update user_profiles set reports_to = '${lead}' where user_id = '${U.sales}';
    update user_profiles set reports_to = '${U.chair}' where user_id in ('${lead}', '${other}');
    delete from cost_secret.cost_reads;
  `)
  const T = (await owner<{ t: string }>(`select cost_today()::text as t`))[0].t
  const sv = (await as<{ total: string; t: string }>(U.sales, `select total_krw_per_kg::text as total from cost_sales_view('${p1}')`))[0]
  const total = Number(sv.total)
  assert.ok(total > 0, '0066 전제: 영업 총원가가 없다')
  const create = (uid: string, price: number, parent: string | null = null, cur = 'KRW') =>
    as<{ id: string }>(uid, `select quote_create('${p1}', '김고객', '(주)가짜고객', 1000, ${price}, '${cur}', '${T}'::date + 30${parent ? `, '${parent}'` : ''}) as id`, true).then((r) => r[0].id)
  type Q = { status: string; grade: string; cost_total_krw_per_kg: string; margin_pct: string; cost_basis: string; decision_id: string | null; version: number; root_id: string }
  const q = async (id: string) => (await owner<Q>(`select status, grade, cost_total_krw_per_kg::text, margin_pct::text, cost_basis, decision_id, version, root_id from quotes where quote_id = '${id}'`))[0]
  const decide = (uid: string, id: string, ok: boolean, note: string | null = null) =>
    as<{ v: string }>(uid, `select approval_decide('${id}', ${ok}, ${note === null ? 'null' : `'${note}'`}) as v`, true).then((r) => r[0].v)

  // ── Green: 바로 확정 · 스냅숏 = 영업 화면 값 ──
  const g1 = await create(U.sales, total * 2)
  const gq = await q(g1)
  assert.deepEqual([gq.status, gq.grade, gq.cost_total_krw_per_kg, gq.cost_basis], ['draft', 'green', String(total), 'midnight'], '0066: Green 견적 스냅숏이 영업 화면 값(0시 기준 · 1원)이 아니다')
  await refuses(run(U.sales, `select quote_request_approval('${g1}')`), /quote_not_red/, '0066: Green에 가격 예외 결재를 올린다')
  await run(U.sales, `select quote_confirm('${g1}')`)
  assert.equal((await q(g1)).status, 'confirmed', '0066: Green이 바로 확정되지 않는다')
  await refuses(as(U.sales, `select quote_create('${p1}', 'a', 'b', 1, 1234.5, 'KRW', '${T}')`), /quote_invalid/, '0066: 1원 단위가 아닌 제시가')
  await refuses(as(U.sales, `select quote_create('${p1}', 'a', 'b', 1, 1000, 'KRW', '${T}'::date - 1)`), /quote_invalid/, '0066: 지난 유효기간')

  // ── Red: 결재 전 확정 불가 → 팀장 → 대표 → 확정 ──
  const redPrice = Math.ceil(total / 0.9) // 마진 약 10%
  const r1 = await create(U.sales, redPrice)
  assert.equal((await q(r1)).grade, 'red', '0066 전제: 마진 10% 견적이 Red가 아니다')
  await refuses(run(U.sales, `select quote_confirm('${r1}')`), /quote_needs_approval/, '0066: Red가 결재 없이 확정된다')
  await refuses(run(U.sales, `insert into decisions (decision_id, business_id, title, template_key, form, created_by)
    values ('dec_fake_pe', 'biz_dy', '가격 예외', 'price_exception', '{"quote":"x","product":"x","kg":"1","price":"1","currency":"KRW","grade":"Green"}'::jsonb, '${U.sales}')`),
    /price_exception_use_quote/, '0066: 가격 예외 결재를 손으로(지어낸 양식으로) 올린다')
  const dec = (await as<{ v: string }>(U.sales, `select quote_request_approval('${r1}') as v`, true))[0].v
  assert.equal((await q(r1)).status, 'pending_approval')
  const steps = await owner<{ who: string }>(`select approver_user_id::text as who from approval_steps where decision_id = '${dec}' order by seq`)
  assert.deepEqual(steps.map((s) => s.who), [lead, U.chair], '0066: 가격 예외 결재선이 상사 사슬 → 대표가 아니다')
  const form = (await owner<{ f: Record<string, string>; t: string }>(`select form as f, title as t from decisions where decision_id = '${dec}'`))[0]
  assert.deepEqual(Object.keys(form.f).sort(), ['currency', 'grade', 'kg', 'price', 'product', 'quote'], '0066: 가격 예외 양식 칸이 다르다(리뷰 I1 — 마진 % 없음)')
  assert.equal(form.f.grade, 'Red (마진 15% 미만)', '0066: 가격 예외 등급 칸')
  const formText = JSON.stringify(form)
  for (const bad of [...mats, ...materialNames, 'total', 'cost']) assert.ok(!formText.includes(bad), `0066: 가격 예외 결재에 원료 · 원가 정보(${bad})가 들어갔다`)
  await refuses(run(U.sales, `select quote_request_approval('${r1}')`), /quote_not_draft/, '0066: 같은 견적에 결재를 두 번 올린다')
  // 결재선의 팀장은 결재(양식)를 읽는다 — 0059 decisions_chain_read.
  assert.equal((await as(lead, `select 1 from decisions where decision_id = '${dec}'`)).length, 1, '0066: 팀장이 가격 예외 결재를 못 본다')
  assert.equal(await decide(lead, dec, true), 'next', '0066: 팀장 승인 뒤 대표 차례가 아니다')
  await refuses(run(U.sales, `select quote_confirm('${r1}')`), /quote_needs_approval/, '0066: 팀장만 승인한 Red가 확정된다')
  // 결재 뒤 제시가 바꾸기 — 표 권한 없음 · 소유자 경로도 얼림.
  await refuses(run(U.sales, `update quotes set price_krw_per_kg = 1 where quote_id = '${r1}'`), /permission denied/, '0066: 영업이 견적 제시가를 고친다')
  await refuses(db.exec(`update quotes set price_krw_per_kg = 1 where quote_id = '${r1}'`), /quote_frozen/, '0066: 소유자 경로로 견적 값이 바뀐다(얼림 없음)')
  await refuses(run(U.sales, `insert into quotes (business_id, root_id, version, customer_name, customer_company, product_id, product_name, kg, price_krw_per_kg, valid_until,
      cost_as_of, cost_basis, cost_total_krw_per_kg, margin_krw_per_kg, margin_pct, grade, created_by)
    values ('biz_dy', 'x', 1, 'a', 'b', '${p1}', 'p', 1, 100, '${T}', '${T}', 'now', 1, 99, 99, 'green', '${U.sales}')`), /permission denied/, '0066: 영업이 스냅숏을 지어 견적을 넣는다')
  assert.equal(await decide(U.chair, dec, true), 'approved', '0066: 대표 최종 승인이 안 된다')
  await run(U.sales, `select quote_confirm('${r1}')`)
  assert.equal((await q(r1)).status, 'confirmed', '0066: 승인된 Red가 확정되지 않는다')

  // ── Red → 반려 → 새 판 ──
  const r2 = await create(U.sales, redPrice)
  const dec2 = (await as<{ v: string }>(U.sales, `select quote_request_approval('${r2}') as v`, true))[0].v
  assert.equal(await decide(lead, dec2, false, '마진이 너무 낮습니다'), 'rejected')
  assert.equal((await q(r2)).status, 'rejected', '0066: 반려된 결재의 견적이 «반려»가 아니다')
  await refuses(run(U.sales, `select quote_confirm('${r2}')`), /quote_needs_approval/, '0066: 반려된 Red가 확정된다')
  const r2b = await create(U.sales, Math.ceil(total / 0.75), r2)
  const nb = await q(r2b)
  assert.deepEqual([nb.version, nb.root_id, nb.grade, nb.status], [2, r2, 'green', 'draft'], '0066: 새 판이 원본에 이어지지 않는다(판 번호 · 뿌리)')
  assert.equal((await q(r2)).status, 'rejected', '0066: 새 판이 반려 원본을 바꿨다')
  // 승인된 Red의 새 판은 새 결재가 필요하다.
  const r1b = await create(U.sales, redPrice + 1, r1)
  await refuses(run(U.sales, `select quote_confirm('${r1b}')`), /quote_needs_approval/, '0066: 승인된 Red의 새 판이 결재 없이 확정된다')

  // ── 읽기 ──
  const n = async (uid: string) => Number((await as<{ n: number }>(uid, `select count(*)::int as n from quotes`))[0].n)
  const mine = await n(U.sales)
  assert.ok(mine >= 5, '0066: 영업이 자기 견적을 못 본다')
  assert.equal(await n(lead), mine, '0066: 영업 팀장이 subtree 팀원 견적을 못 본다')
  assert.equal(await n(other), 0, '0066: 다른 영업 직원이 남의 견적을 본다')
  for (const uid of [U.buy, U.prod, U.cost, U.exec, U.ceo, U.cfo, U.vana, U.agent]) assert.equal(await n(uid), 0, `0066: ${uid.slice(-2)}가 견적(원가 스냅숏)을 본다`)
  assert.equal(await n(U.chair), mine, '0066: 대표가 견적을 다 못 본다')
  assert.equal((await as(null, `select 1 from quotes`).catch((e) => String(e))).toString().includes('permission denied'), true, '0066: anon에게 견적 표가 열렸다')
  const acc = await as<Record<string, unknown>>(U.cost, `select * from quotes_confirmed_for_costing('biz_dy')`)
  assert.ok(acc.length >= 2, '0066: 원가 관리가 확정 견적(회계용)을 못 본다')
  assert.deepEqual(Object.keys(acc[0]).sort(), ['confirmed_on', 'currency', 'kg', 'price_krw_per_kg', 'product_name', 'quote_id'], '0066: 원가 관리 회계용 칸에 원가 · 고객이 섞였다')
  for (const uid of [U.buy, U.prod, U.sales]) await refuses(as(uid, `select * from quotes_confirmed_for_costing('biz_dy')`), /quote_not_found/, `0066: ${uid.slice(-2)}가 회계용 견적 목록을 본다`)
  await refuses(as(U.sales, `select * from quote_raw('${r1}')`), /quote_not_found/, '0066: 영업이 견적 원래 값을 본다')
  const raw = (await as<{ b: string }>(U.chair, `select total_raw_basis::text as b from quote_raw('${r1}')`))[0]
  assert.equal(Math.round(Number(raw.b)), total, '0066: 대표 원래 값(0시 기준)이 스냅숏의 원래 값이 아니다')
  // 다른 회사 · 남의 견적.
  await refuses(as(U.vana, `select quote_create('${p1}', 'a', 'b', 1, 100000, 'KRW', '${T}')`), /quote_not_found/, '0066: 다른 회사 사람이 DY 견적을 만든다')
  await refuses(run(other, `select quote_cancel('${r1b}')`), /quote_not_found/, '0066: 다른 영업이 남의 견적을 취소한다')
  await refuses(run(lead, `select quote_confirm('${r2b}')`), /quote_not_found/, '0066: 팀장이 팀원 견적을 확정한다(읽기만)')
  await refuses(as(U.sp, `select quote_create('${p1}', 'a', 'b', 1, 100000, 'KRW', '${T}')`), /cost_role_conflict/, '0066: 영업 + 생산 겸직이 견적(원가)을 만든다')
  // 리뷰 I2 — 영업 팀장이 구매 읽기 줄을 같이 가지면(원가 문은 cost_role_conflict) 견적 표도 0행.
  await db.exec(`insert into user_module_access (user_id, module, can_write, can_approve) values ('${lead}', '/purchasing/biz_dy', false, false)`)
  assert.equal(await n(lead), 0, '리뷰 I2: 구매 겸직 영업 팀장이 팀원 견적(원가 스냅숏)을 본다')
  await db.exec(`delete from user_module_access where user_id = '${lead}' and module = '/purchasing/biz_dy'`)
  assert.equal(await n(lead), mine, '리뷰 I2: 겸직을 걷은 뒤 팀장 읽기가 돌아오지 않는다')
  // 리뷰 M3 — 영업 줄을 잃은 만든 사람은 옛 견적도 0행.
  await db.exec(`update user_module_access set module = '/sales/biz_vana' where user_id = '${U.sales}' and module = '/sales/biz_dy'`)
  assert.equal(await n(U.sales), 0, '리뷰 M3: 영업 줄을 잃은 사람이 옛 견적 원가를 본다')
  await db.exec(`update user_module_access set module = '/sales/biz_dy' where user_id = '${U.sales}' and module = '/sales/biz_vana'`)
  // 리뷰 I3 — 대표 외 제시가 하한(1원 총원가의 절반): 제시가 1원으로 마진 %(0.1%p)를 찍어 원래 총원가를 0.001원까지 푸는 길.
  // 재검토 N1 — 하한 밑은 raise가 아니라 답(한도 · 감사가 남는다 — raise면 되돌아가 «거부 여부»가 공짜 오라클).
  const reads = async () => Number((await owner<{ n: number }>(`select coalesce(sum(calls), 0)::int as n from cost_secret.cost_reads where user_id = '${U.sales}'`))[0].n)
  const before = await reads()
  const low = (await as<{ m: string | null; g: string }>(U.sales, `select margin_pct::text as m, grade as g from cost_price_check('${p1}', 1)`, true))[0]
  assert.deepEqual([low.m, low.g], [null, 'too_low'], '리뷰 I3: 영업이 제시가 1원으로 마진 %를 받는다')
  const lowQ = (await as<{ id: string | null }>(U.sales, `select quote_create('${p1}', 'a', 'b', 1, ${Math.floor((total - 1) / 2)}, 'KRW', '${T}') as id`, true))[0]
  assert.equal(lowQ.id, null, '리뷰 I3: 총원가 절반 미만 견적이 저장된다')
  assert.equal(await reads(), before + 2, '재검토 N1: 하한 밑 조회가 한도에 세어지지 않는다')
  assert.equal((await as(U.sales, `select * from cost_price_check('${p1}', ${Math.ceil(total / 2)})`)).length, 1, '리뷰 I3: 절반 이상은 받는다')
  assert.equal((await as(U.chair, `select * from cost_price_check('${p1}', 1)`)).length, 1, '리뷰 I3: 대표는 하한 없음')

  // ── 내려받기 감사 · 만료 ──
  await refuses(run(U.sales, `select quote_download_log('${r1b}', 'xlsx')`), /quote_not_confirmed/, '0066: 확정 전 견적서를 내려받는다')
  await run(U.sales, `select quote_download_log('${g1}', 'xlsx')`)
  assert.equal((await owner(`select 1 from audit_log where entity_table = 'quotes' and entity_id = '${g1}' and action = 'export'`)).length, 1, '0066: 내려받기 감사가 없다')
  await db.exec(`set session_replication_role = replica; update quotes set valid_until = '${T}'::date - 1 where quote_id = '${r2b}'; set session_replication_role = origin;`)
  await refuses(run(U.sales, `select quote_confirm('${r2b}')`), /quote_expired/, '0066: 유효기간 지난 견적이 확정된다')
  const audits = await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'quotes'`)
  assert.ok(audits[0].n >= 10, '0066: 견적 쓰기 감사가 모자라다')
}
