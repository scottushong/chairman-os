/**
 * 0091 재무 자동 판단 — 사람이 고친 기록(fin_auto_fixes · fin_auto_fix). check-migrations.ts가 부른다(PGlite · 전부 적용한 DB).
 *   장부 쓰기만 고친다(사원 · 대표) · 장부 못 쓰는 직원 · AI Agent · anon 거부 · 규칙과 행동 짝 · 값 모양 · 표 직접 쓰기 없음 ·
 *   덧붙이기만(같은 자리 두 번 → 두 줄) · 누가(이름) · 전값 · 그 달부터 다시 계산 큐 · 감사 · 장부 못 읽는 직원 0줄 · 스위치 끄면 거부.
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000091a1',
  member: '00000000-0000-0000-0000-0000000091a3', // DY 직원 — 재무 줄 없음
  agent: '00000000-0000-0000-0000-0000000091a4',
  keeper: '00000000-0000-0000-0000-0000000091a5', // DY 사원 — 재무 입력 줄(김병훈 자리)
}

export async function financeAutoDb(): Promise<string> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ('${U.chair}', 'a1@x'), ('${U.member}', 'a3@x'), ('${U.agent}', 'a4@x'), ('${U.keeper}', 'a5@x');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${U.chair}', 'Chairman', 'ch', 'Vault', null), ('${U.member}', 'Member', '직원', 'Normal', 'team_dy_production'),
      ('${U.agent}', 'AIAgent', 'agent', 'Restricted', null), ('${U.keeper}', 'Member', '장부 사원', 'Normal', null);
    insert into user_business_access values ('${U.member}', 'biz_dy'), ('${U.keeper}', 'biz_dy'), ('${U.agent}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values ('${U.keeper}', '/finance/biz_dy', true, false);
  `)
  const as = async <T>(uid: string | null, sql: string, role: 'authenticated' | 'anon' = 'authenticated'): Promise<T[] | string> => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true); set local role ${role};`)
    try {
      const r = await db.query<T>(sql)
      await db.exec('commit')
      return r.rows
    } catch (e) {
      await db.exec('rollback')
      return String((e as Error).message)
    }
  }
  const su = async <T>(sql: string) => (await db.query<T>(sql)).rows
  const fix = (rule: string, key: string, period: string, action: string, value: string, prev = 'null') =>
    `select fin_auto_fix('biz_dy', '${rule}', '${key}', '${period}', '${action}', ${value}, ${prev}) as id`

  // ── a. 장부 쓰기(사원) — 평가 고치기 · 누가 · 전값 · 큐 · 감사 ──
  const a = await as<{ id: number }>(U.keeper, fix('valuation', '2099-09:wip', '2099-09', 'value', `'{"amount": 9000000}'::jsonb`, `'{"값": 12500000, "출처": "이월"}'::jsonb`))
  assert.ok(Array.isArray(a), `0091 a: 사원의 평가 고치기가 거부됐다 — ${String(a).slice(0, 160)}`)
  const row = (await su<{ created_by_name: string; prev: Record<string, unknown>; value: { amount: number } }>(`select created_by_name, prev, value from fin_auto_fixes where fix_id = ${a[0].id}`))[0]
  assert.equal(row.created_by_name, '장부 사원', '0091 a: 고친 사람 이름이 남지 않았다')
  assert.equal(row.prev['값'], 12500000, '0091 a: 전값이 남지 않았다')
  assert.equal(row.value.amount, 9000000, '0091 a: 고친 값이 다르다')
  assert.deepEqual(await su(`select from_period, cause from fin_recalc_jobs where business_id = 'biz_dy' and status = 'pending'`), [{ from_period: '2099-09', cause: 'manual' }], '0091 a: 다시 계산 큐가 서지 않았다')
  assert.equal(Number((await su<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'fin_auto_fixes'`))[0].n), 1, '0091 a: 감사 기록이 없다')

  // ── b. 덧붙이기만 — 같은 자리 «자동으로» → 두 줄 ──
  const b = await as<{ id: number }>(U.keeper, fix('valuation', '2099-09:wip', '2099-09', 'auto', 'null'))
  assert.ok(Array.isArray(b), `0091 b: 자동으로 돌리기가 거부됐다 — ${String(b).slice(0, 160)}`)
  assert.equal(Number((await su<{ n: number }>(`select count(*)::int as n from fin_auto_fixes where item_key = '2099-09:wip'`))[0].n), 2, '0091 b: 덧붙이지 않고 고쳐 썼다')

  // ── c. 귀속월 · 중복 · 대표 ──
  for (const [rule, action, value] of [
    ['period', 'month', `'{"to": "2099-08"}'::jsonb`],
    ['period', 'keep_date', 'null'],
    ['duplicate', 'restore', 'null'],
  ] as const) {
    const r = await as<{ id: number }>(U.chair, fix(rule, `2099-09:k:${action}`, '2099-09', action, value))
    assert.ok(Array.isArray(r), `0091 c: 대표의 ${rule} ${action}가 거부됐다 — ${String(r).slice(0, 160)}`)
  }

  // ── d. 모양 — 규칙 · 행동 짝 · 금액 · 달 · 열쇠 ──
  for (const [label, sql] of [
    ['평가에 달 고치기', fix('valuation', '2099-09:wip', '2099-09', 'month', `'{"to": "2099-08"}'::jsonb`)],
    ['음수 금액', fix('valuation', '2099-09:wip', '2099-09', 'value', `'{"amount": -1}'::jsonb`)],
    ['소수 금액', fix('valuation', '2099-09:wip', '2099-09', 'value', `'{"amount": 1.5}'::jsonb`)],
    ['금액 글', fix('valuation', '2099-09:wip', '2099-09', 'value', `'{"amount": "1"}'::jsonb`)],
    ['달 모양', fix('period', '2099-09:x', '2099-09', 'month', `'{"to": "2099-13"}'::jsonb`)],
    ['되살리기에 값', fix('duplicate', '2099-09:x', '2099-09', 'restore', `'{"to": "2099-08"}'::jsonb`)],
    ['짧은 열쇠', fix('duplicate', 'x', '2099-09', 'restore', 'null')],
    ['모르는 규칙', fix('loan', '2099-09:x', '2099-09', 'auto', 'null')],
    ['첫 달 모양', fix('duplicate', '2099-09:x', '2099-9', 'restore', 'null')],
  ] as const) {
    const r = await as(U.keeper, sql)
    assert.ok(typeof r === 'string' && /fin_auto_shape/.test(r), `0091 d: ${label}이(가) fin_auto_shape로 거부되지 않았다 — ${String(Array.isArray(r) ? 'OK' : r).slice(0, 120)}`)
  }

  // ── e. 거부 — 장부 못 쓰는 직원 · AI Agent · anon · 표 직접 쓰기 ──
  const denied = async (uid: string | null, role: 'authenticated' | 'anon', label: string) => {
    const r = await as(uid, fix('valuation', '2099-09:fin', '2099-09', 'value', `'{"amount": 1}'::jsonb`), role)
    assert.ok(typeof r === 'string' && /fin_auto_denied|permission denied/.test(r), `0091 e: ${label}가 고쳤다 — ${String(Array.isArray(r) ? 'OK' : r).slice(0, 120)}`)
  }
  await denied(U.member, 'authenticated', '장부 못 쓰는 직원')
  await denied(U.agent, 'authenticated', 'AI Agent')
  await denied(null, 'anon', 'anon')
  const direct = await as(U.keeper, `insert into fin_auto_fixes (business_id, rule, item_key, period, action, value) values ('biz_dy', 'duplicate', '2099-09:zz', '2099-09', 'restore', null)`)
  assert.ok(typeof direct === 'string', '0091 e: 표에 직접 쓸 수 있다')

  // ── f. 읽기 — 장부 읽는 사람만 ──
  const seen = await as<{ n: number }>(U.keeper, `select count(*)::int as n from fin_auto_fixes`)
  assert.ok(Array.isArray(seen) && seen[0].n === 5, `0091 f: 사원이 고친 기록 다섯 줄을 못 본다 — ${JSON.stringify(seen)}`)
  const hidden = await as<{ n: number }>(U.member, `select count(*)::int as n from fin_auto_fixes`)
  assert.ok(Array.isArray(hidden) && hidden[0].n === 0, '0091 f: 장부 못 읽는 직원에게 고친 기록이 보인다')
  const anon = await as<{ n: number }>(null, `select count(*)::int as n from fin_auto_fixes`, 'anon')
  assert.ok(typeof anon === 'string' || anon[0].n === 0, '0091 f: anon이 읽는다')

  // ── g. 스위치 — 기본 줄 전원 · 끄면 거부 ──
  assert.deepEqual(await su(`select enabled, audience from feature_switches where feature_key = 'finance_auto' and business_id is null`), [{ enabled: true, audience: 'all' }], '0091 g: 스위치 기본 줄이 전원이 아니다')
  await su(`update feature_switches set enabled = false where feature_key = 'finance_auto' and business_id is null`)
  const off = await as(U.keeper, fix('valuation', '2099-09:fin', '2099-09', 'value', `'{"amount": 1}'::jsonb`))
  assert.ok(typeof off === 'string' && /fin_auto_off/.test(off), `0091 g: 스위치를 꺼도 고쳐진다 — ${String(Array.isArray(off) ? 'OK' : off).slice(0, 120)}`)
  await db.close()
  return '0091 재무 자동 판단(a 사원 고치기 · 이름 · 전값 · 큐 · 감사 b 덧붙이기만 c 귀속월 · 중복 · 대표 d 모양 9 e 직원 · AI Agent · anon · 직접 쓰기 거부 f 읽기는 장부 권한 g 스위치 기본 전원 · 끄면 거부)'
}
