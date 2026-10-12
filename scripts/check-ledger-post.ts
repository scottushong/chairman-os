/**
 * PHASE 7 장부 반영(0079) — ⑤ 계정별 원장 → 장부(0016 전표).
 *   ① PGlite(실제 0001~0079): 스위치 기본(대표만) · 장부 쓰기 문 · 반영 대기 → 반영(0016 post_journal_entry · 차대 · 상대 계정) ·
 *      두 번 거부 · 같은 거래(0072 same 묶음 → 함께 · suspect 거부) · ECOUNT 전표 있는 달 거부 · 마감 달(대표 · CFO만 + 이유 · 0016 당월 날짜) ·
 *      무효 처리(대기 = 풀기 · 반영 = 역분개, 지우지 않음) · 감사 · anon · 4510 줄은 그대로(0075가 교체 — 바꾸지 않음)
 *   ② dummy 거울 · ③ 정적(화면 · 액션 스위치 · 문구)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000079a1',
  cfo: '00000000-0000-0000-0000-0000000079a2',
  ceo: '00000000-0000-0000-0000-0000000079a3',
  mem: '00000000-0000-0000-0000-0000000079a4',
}

async function db79() {
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
  const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)
  const [{ pm, pm2, today }] = await owner<{ pm: string; pm2: string; today: string }>(`select
    to_char(date_trunc('month', now() at time zone 'Asia/Seoul') - interval '1 month', 'YYYY-MM') as pm,
    to_char(date_trunc('month', now() at time zone 'Asia/Seoul') - interval '2 month', 'YYYY-MM') as pm2,
    ((now() at time zone 'Asia/Seoul')::date)::text as today`)
  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    insert into auth.users (id, email) values ('${U.chair}', 'c@x'), ('${U.cfo}', 'f@x'), ('${U.ceo}', 'o@x'), ('${U.mem}', 'm@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${U.chair}', 'Chairman', '대표', 'Vault'), ('${U.cfo}', 'GroupCFO', 'cfo', 'Restricted'),
      ('${U.ceo}', 'BusinessCEO', '회사 대표', 'Restricted'), ('${U.mem}', 'Member', '직원', 'Normal');
    insert into user_business_access values ('${U.ceo}', 'biz_dy'), ('${U.mem}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values ('${U.mem}', '/sales/biz_dy', true, false);
    insert into accounts (business_id, account_code, name, category, section, cash_flow, source, fetched_at) values
      ('biz_dy', '1530', '원재료', 'asset', 'other_asset', 'operating', 'manual', now()),
      ('biz_dy', '2010', '외상매입금', 'liability', 'payable', 'operating', 'manual', now()),
      ('biz_dy', '4510', '원재료비', 'raw_material', 'cogs', null, 'manual', now())
    on conflict do nothing;
  `)
  const up = async (period: string, n: number) =>
    (await owner<{ id: string }>(`insert into fin_uploads (business_id, kind, period, file_name, file_sha256, status, row_count, created_by)
      values ('biz_dy', 'ledger', '${period}', '가짜 원장 ${n}.xlsx', '${String(n).padStart(64, 'a')}', 'applied', 1, '${U.chair}') returning upload_id as id`))[0].id
  const u1 = await up(pm, 1)
  const line = async (upload: string, period: string, row: number, code: string, dr: number | null, cr: number | null, day = 5) =>
    Number((await owner<{ id: string }>(`insert into fin_ledger_lines (upload_id, business_id, period, row_no, tx_date, account_code, account_name, counterparty, memo, debit, credit)
      values ('${upload}', 'biz_dy', '${period}', ${row}, '${period}-${String(day).padStart(2, '0')}', '${code}', '가짜', '가짜 공급처', '가짜 매입', ${dr ?? 'null'}, ${cr ?? 'null'}) returning line_id::text as id`))[0].id)
  const l1 = await line(u1, pm, 4, '1530', 500_000, null)
  const l2 = await line(u1, pm, 5, '2010', null, 500_000)
  const l3 = await line(u1, pm, 6, '4510', 120_000, null, 21)
  const l4 = await line(u1, pm, 7, '1530', 300_000, null, 12)
  const l5 = await line(u1, pm, 8, '1530', 77_000, null, 13)
  // 0072 같은 거래: l1 ~ l2 같은 거래(same) · l4는 입고 줄과 중복 의심(suspect).
  const pin = (await owner<{ id: string }>(`insert into fin_purchase_in_lines (upload_id, business_id, period, row_no, material, supplier, qty, amount)
      values ('${u1}', 'biz_dy', '${pm}', 9, '가짜', '가짜', 1, 300000) returning line_id::text as id`))[0].id
  await owner(`with g as (insert into fin_tx_groups (business_id, period, status, evidence, saved_by) values ('biz_dy', '${pm}', 'same', '{"amount":"같음"}', '${U.chair}') returning group_id)
    insert into fin_tx_group_members (group_id, source_table, line_id, business_id) select group_id, 'fin_ledger_lines', x, 'biz_dy' from g, unnest(array[${l1}, ${l2}]::bigint[]) x`)
  await owner(`with g as (insert into fin_tx_groups (business_id, period, status, evidence, saved_by) values ('biz_dy', '${pm}', 'suspect', '{"amount":"같음"}', '${U.chair}') returning group_id)
    insert into fin_tx_group_members (group_id, source_table, line_id, business_id) select group_id, t, x, 'biz_dy' from g,
      (values ('fin_ledger_lines', ${l4}::bigint), ('fin_purchase_in_lines', ${pin}::bigint)) v(t, x)`)

  const Q = (uid: string | null, p = pm) => as<Record<string, unknown>>(uid, `select * from ledger_post_queue('biz_dy', '${p}')`)
  const stage = (uid: string, lines: number[], counter: string | null = null, date: string | null = null, reason: string | null = null) =>
    as<{ v: string }>(uid, `select ledger_post_stage('biz_dy', array[${lines.join(',')}]::bigint[], ${counter ? `'${counter}'` : 'null'}, ${date ? `'${date}'` : 'null'}, ${reason ? `'${reason}'` : 'null'})::text as v`)
  const apply = (uid: string, id: string, reason: string | null = null) => as<{ v: string }>(uid, `select ledger_post_apply('${id}', ${reason ? `'${reason}'` : 'null'}) as v`)
  const voidp = (uid: string, id: string, reason: string) => as<{ v: string }>(uid, `select ledger_post_void('${id}', '${reason}') as v`)
  const slipLines = (slip: string) => owner<{ code: string; side: string; amount: string }>(`select account_code as code, side::text, amount::text from journal_lines where business_id = 'biz_dy' and slip_no = '${slip}' order by line_no`)

  // 스위치 기본(대표만)
  await refuses(Q(U.ceo), /feature_off/, '0079: 스위치 기본(대표만)인데 회사 대표가 원장을 읽었다')
  assert.equal((await Q(U.chair)).length, 5, '0079: 대표 반영 대기 목록')
  await as(U.chair, `select feature_switch_set('ledger_post', 'biz_dy', true, 'all', '0079 시험')`)
  await refuses(Q(U.mem), /ledger_forbidden/, '0079: 장부 쓰기 없는 직원이 읽었다')
  // 리뷰 고침 M1 · I2 — 음수 줄 거부 · 전표 날짜 달 = 원장 달(마감 달 아니면)
  const l6 = await line(u1, pm, 10, '1530', -5, null)
  await refuses(stage(U.chair, [l6], '2010'), /ledger_line_shape/, '0079: 음수 원장 줄이 대기에 들어갔다')
  await refuses(stage(U.chair, [l5], '2010', `${pm2}-10`), /ledger_entry_date/, '0079: 다른 달 날짜로 대기')
  await refuses(as(null, `select * from ledger_post_queue('biz_dy', '${pm}')`), /permission denied/, '0079: anon')
  await refuses(as(U.ceo, `select * from fin_ledger_posts`), /permission denied/, '0079: 표 직접 읽기')

  // 같은 거래: l1만 골라도 l2가 함께(한 번만) · 차대 맞음 → 상대 계정 없이
  const [{ v: p1 }] = await stage(U.ceo, [l1])
  const q1 = await Q(U.ceo)
  assert.deepEqual(q1.filter((r) => r.post_id === p1).map((r) => Number(r.line_id)).sort(), [l1, l2].sort(), '0079: same 묶음 원장 줄이 함께 들어가지 않았다')
  await refuses(stage(U.ceo, [l2]), /ledger_already_staged/, '0079: 같은 줄이 두 번 대기에 들어갔다')
  await refuses(stage(U.ceo, [l4]), /ledger_dedupe_suspect/, '0079: 중복 의심 줄이 대기에 들어갔다')
  await refuses(stage(U.ceo, [l3]), /ledger_unbalanced/, '0079: 차대가 안 맞는데 상대 계정 없이 대기')
  assert.equal(Number((await owner<{ n: number }>(`select count(*)::int as n from journal_lines where business_id = 'biz_dy'`))[0].n), 0, '0079: 대기만으로 장부에 줄이 생겼다')
  const [{ v: s1 }] = await apply(U.ceo, p1)
  assert.deepEqual((await slipLines(s1)).map((r) => [r.code, r.side, Number(r.amount)]), [['1530', 'debit', 500000], ['2010', 'credit', 500000]], '0079: 반영 전표 줄')
  await refuses(apply(U.ceo, p1), /ledger_not_pending/, '0079: 같은 건을 두 번 반영했다')

  // 4510 — 상대 계정 2010 · 계정은 그대로(0075가 교체 — 0079는 바꾸지 않는다)
  const [{ v: p3 }] = await stage(U.ceo, [l3], '2010')
  const [{ v: s3 }] = await apply(U.ceo, p3)
  assert.deepEqual((await slipLines(s3)).map((r) => [r.code, r.side, Number(r.amount)]), [['4510', 'debit', 120000], ['2010', 'credit', 120000]], '0079: 4510 줄 · 상대 계정')

  // 무효 처리 — 반영 = 역분개(원 전표 남음) · 줄 풀림 → 다시 대기 가능 · 대기 = 풀기
  await refuses(voidp(U.ceo, p3, ' '), /ledger_void_reason/, '0079: 이유 없이 무효')
  const [{ v: r3 }] = await voidp(U.ceo, p3, '상대 계정 잘못')
  const rev = await owner<{ kind: string; c: string }>(`select correction_kind as kind, corrects_id as c from journal_entries where business_id = 'biz_dy' and slip_no = '${r3}'`)
  assert.deepEqual([rev[0]?.kind, rev[0]?.c], ['reversal', s3], '0079: 무효가 역분개가 아니다')
  assert.equal((await slipLines(s3)).length, 2, '0079: 무효가 원 전표를 지웠다')
  const [{ v: p3b }] = await stage(U.ceo, [l3], '2010')
  await voidp(U.ceo, p3b, '대기 취소')
  assert.ok((await Q(U.ceo)).find((r) => Number(r.line_id) === l3)?.post_id === null, '0079: 대기 무효 뒤 줄이 풀리지 않았다')

  // ECOUNT 전표가 있는 달은 거부
  const u2 = await up(pm2, 2)
  const e1 = await line(u2, pm2, 4, '1530', 1000, null)
  await owner(`insert into journal_lines (business_id, entry_date, account_code, amount, side, slip_no, line_no, memo, source, fetched_at)
    values ('biz_dy', '${pm2}-02', '1530', 1, 'debit', 'EC-1', 1, '', 'ecount', now())`)
  await refuses(stage(U.chair, [e1], '2010'), /ledger_books_has_ecount/, '0079: ECOUNT 전표가 있는 달에 반영 대기')
  await owner(`delete from journal_lines where slip_no = 'EC-1'`)
  // 리뷰 고침 C1 — 0052 월별 업로드는 장부 줄을 'manual'로 쓰고 전표를 finance_import_slips에 남긴다. 그 길로도 거부.
  await db.exec(`begin; set local session_replication_role = replica;
    insert into journal_entries (business_id, slip_no, entry_date, memo, created_by) values ('biz_dy', 'EC-2', '${pm2}-03', '가짜 월별 업로드', '${U.chair}');
    insert into finance_imports (import_id, business_id, kind, period_key, status, file_name, created_by) values ('00000000-0000-0000-0000-0000000079f1', 'biz_dy', 'monthly', '${pm2}', 'draft', '가짜.xlsx', '${U.chair}');
    insert into finance_import_slips (business_id, month, slip_no, import_id) values ('biz_dy', '${pm2}', 'EC-2', '00000000-0000-0000-0000-0000000079f1');
    commit;`)
  await refuses(stage(U.chair, [e1], '2010', null, '이유'), /ledger_books_has_ecount/, '0079: 월별 업로드 전표(finance_import_slips)가 있는 달에 반영 대기')
  await owner(`update finance_import_slips set superseded_at = now() where slip_no = 'EC-2'`)
  // 리뷰 고침 I1 — 그 달에 0079가 아닌 다른 전표(EC-2가 남음)가 있으면 대표 · CFO + 이유만
  await refuses(stage(U.ceo, [e1], '2010', null, '이유'), /ledger_books_has_entries/, '0079: 다른 전표가 있는 달에 회사 대표가 반영 대기')
  await refuses(stage(U.chair, [e1], '2010'), /ledger_books_has_entries/, '0079: 다른 전표가 있는 달에 이유 없이')

  // 마감 달(0016 closings 확정): 회사 대표 거부 · 대표도 이유 필수 · 그 달 날짜는 0016이 거부 → 오늘 날짜로 반영
  await owner(`insert into closings (business_id, period, account_code, amount, closed_on, source, fetched_at, closed) values ('biz_dy', '${pm2}', '1530', 0, '${today}', 'manual', now(), true)`)
  await refuses(stage(U.ceo, [e1], '2010', null, '이유'), /ledger_closed_month/, '0079: 마감 달에 회사 대표가 반영 대기')
  await refuses(stage(U.chair, [e1], '2010'), /ledger_closed_month/, '0079: 마감 달에 이유 없이')
  // 다시 리뷰 I-A: 장부가 막는 달(0016 closings)의 날짜는 대기에서 거부 — 뒤의 열린 달(이번 달까지)만
  await refuses(stage(U.cfo, [e1], '2010', null, '마감 뒤 받은 원장'), /ledger_entry_date/, '0079: 마감 달 날짜로 반영 대기')
  const [{ v: pc2 }] = await stage(U.cfo, [e1], '2010', today, '마감 뒤 받은 원장 — 당월')
  await refuses(apply(U.cfo, pc2), /ledger_closed_month/, '0079: 마감 달 반영에 반영하는 사람 이유가 없다(대기 이유로 대신 — M4)')
  const [{ v: sc }] = await apply(U.cfo, pc2, '당월 반영')
  assert.ok(sc.startsWith('M'), '0079: 당월 날짜 반영')

  // 원장 줄이 되돌려지면 반영 거부(대기 뒤 원천 바뀜)
  const [{ v: p5 }] = await stage(U.ceo, [l5], '2010')
  await owner(`update fin_ledger_lines set voided_at = now() where line_id = ${l5}`)
  await refuses(apply(U.ceo, p5), /ledger_source_changed/, '0079: 되돌린 원장 줄이 장부에 들어갔다')
  assert.ok((await Q(U.ceo)).some((r) => Number(r.line_id) === l5 && r.post_id === p5), '0079: 원장 줄이 되돌려지자 반영 건이 목록에서 사라졌다(C2)')
  // 리뷰 고침 C2 — 살아 있는 반영 건이 있는 원장 올리기는 바꾸기 · 되돌리기 거부
  await refuses(owner(`update fin_uploads set status = 'reverted' where upload_id = '${u1}'`), /ledger_post_live/, '0079: 반영 건이 있는 원장 올리기를 되돌렸다')
  // 반대 방향 — 반영된(posted) 원장 건이 있는 달(pm)에 월별 업로드 전표를 세우면 거부
  await db.exec(`begin; set local session_replication_role = replica;
    insert into journal_entries (business_id, slip_no, entry_date, memo, created_by) values ('biz_dy', 'EC-3', '${pm}-03', '가짜 월별 업로드', '${U.chair}'); commit;`)
  await refuses(owner(`insert into finance_import_slips (business_id, month, slip_no, import_id) values ('biz_dy', '${pm}', 'EC-3', '00000000-0000-0000-0000-0000000079f1')`),
    /ledger_post_month_posted/, '0079: 원장 반영된 달에 월별 업로드 전표가 섰다')

  // 감사 — 대기 · 반영 · 무효마다
  const [{ n: na }] = await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'fin_ledger_posts'`)
  assert.ok(na >= 10, `0079: 반영 감사가 적다(${na})`)
  // 끄면 대표도 꺼진다
  await as(U.chair, `select feature_switch_set('ledger_post', 'biz_dy', false, 'all', '0079 끄기')`)
  await refuses(Q(U.chair), /feature_off/, '0079: 껐는데 대표가 읽었다')
  await db.close()
  console.log('① PGlite 0079(스위치 · 문 · 대기 → 반영 · 차대 · 상대 계정 · 두 번 · same 함께 · suspect 거부 · ECOUNT 달 · 마감 달 · 역분개 무효 · 원천 바뀜 · 감사 · anon) OK')
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
  const P = '2026-09'
  await assert.rejects(as('dy_ceo', () => repo.ledgerPostQueue(B, P)), /feature_off/, 'dummy: 스위치 기본인데 회사 대표가 읽었다')
  const q = await as('chairman', () => repo.ledgerPostQueue(B, P))
  assert.ok(q.length >= 3, 'dummy: 원장 줄')
  const same = q.find((r) => r.group_status === 'same')!
  const suspect = q.find((r) => r.group_status === 'suspect')!
  await assert.rejects(as('chairman', () => repo.ledgerPostStage(B, [suspect.line_id], null, null, null)), /ledger_dedupe_suspect/, 'dummy: 의심 거부')
  await assert.rejects(as('chairman', () => repo.ledgerPostStage(B, [same.line_id], null, null, null)), /ledger_unbalanced/, 'dummy: 차대')
  const id = await as('chairman', () => repo.ledgerPostStage(B, [same.line_id], '2010', null, null))
  await assert.rejects(as('chairman', () => repo.ledgerPostStage(B, [same.line_id], '2010', null, null)), /ledger_already_staged/, 'dummy: 두 번')
  const slip = await as('chairman', () => repo.ledgerPostApply(id, null))
  assert.match(slip, /^M/, 'dummy: 반영 전표')
  const rev = await as('chairman', () => repo.ledgerPostVoid(id, '시험 무효'))
  assert.match(rev, /^M/, 'dummy: 역분개')
  assert.equal((await as('chairman', () => repo.ledgerPostQueue(B, P))).find((r) => r.line_id === same.line_id)?.post_id, null, 'dummy: 무효 뒤 풀림')
  console.log('② dummy 거울 OK')
}

function statics() {
  const root = join(__dirname, '..')
  const page = readFileSync(join(root, 'src/app/(dashboard)/finance/[business_id]/ledger-post/page.tsx'), 'utf8')
  const act = readFileSync(join(root, 'src/app/actions/ledger-post.ts'), 'utf8')
  const sql = readFileSync(join(root, 'supabase/migrations/0079_ledger_post.sql'), 'utf8')
  assert.match(page, /featureOn\(user, 'ledger_post', business_id\)\)\) notFound\(\)/, '화면이 스위치를 보지 않는다')
  assert.match(act, /featureOn\(user, 'ledger_post', businessId\)/, '액션이 스위치를 보지 않는다')
  for (const t of [page, act]) assert.ok(!/회장|ECOUNT 올리기/.test(t), '문구에 «회장» · «ECOUNT 올리기»')
  for (const fn of ['ledger_post_stage', 'ledger_post_apply', 'ledger_post_void', 'ledger_post_queue']) {
    const body = sql.slice(sql.indexOf(`create or replace function ${fn}(`))
    const head = body.slice(body.indexOf('\nbegin'), body.indexOf('\nbegin') + 400)
    assert.match(head, /feature_on\('ledger_post', p(\.business_id|_business)\)/, `${fn}가 스위치를 먼저 보지 않는다`)
  }
  assert.ok(!/delete from (journal|fin_ledger)/i.test(sql), '0079가 장부 · 원장을 지운다')
  assert.ok(!/update journal_lines|update accounts/i.test(sql), '0079가 장부 줄 · 계정을 고친다(4510은 그대로)')
  assert.ok(!/no force row level security|disable row level security/i.test(sql), '0079가 RLS를 끈다')
  console.log('③ 정적 OK')
}

async function main() {
  await db79()
  if (process.env.LP_DB_ONLY) return
  await dummy()
  statics()
  console.log('PASS: check:ledger-post')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
