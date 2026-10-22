/**
 * 0086 «내 홈» 배치 — check-migrations.ts가 부른다(PGlite · 전부 적용한 DB). 혼자: npx tsx scripts/check-home-widgets-db.ts
 *   스위치: 기본 대표만 — 직원은 저장 못 함 → 대표가 회사 줄을 켜면 그 회사 직원은 저장 · 다른 회사 직원은 여전히 못 함.
 *   본인만: A가 저장한 줄을 B가 못 읽는다(RLS) · 표에 직접 insert · update · delete 못 함 · 저장 함수는 세션(auth.uid())의 줄만 쓴다.
 *   충돌: 처음 저장은 expected 0 · 그 뒤 판이 다르면 home_conflict(다른 탭) · 같은 판으로 두 번째 저장도 conflict · 판은 하나씩 오른다.
 *   모양: 배열 아님 · 31개 · id 겹침 · 크기 틀림 · settings 배열 · 판 2 → home_invalid. 모르는 kind는 저장된다(새 위젯 · 없어진 위젯 때문에 지우지 않는다).
 *   anon · 시스템 계정(AIAgent) · 회수된 사람 거부.
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000086a1',
  a: '00000000-0000-0000-0000-0000000086a2', // DY 직원 A
  b: '00000000-0000-0000-0000-0000000086a3', // DY 직원 B
  v: '00000000-0000-0000-0000-0000000086a4', // VANA 직원
  agent: '00000000-0000-0000-0000-0000000086a5',
  gone: '00000000-0000-0000-0000-0000000086a6', // 회수된 DY 직원
}

const W = (n: number, extra: object = {}) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `w${i}`, kind: i === 0 ? 'my_tasks' : 'approvals', size: 's', settings: {}, ...extra })))

export async function homeWidgetsDb(): Promise<string> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ${Object.values(U).map((id, i) => `('${id}', 'h${i}@x')`).join(', ')};
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id, revoked_at) values
      ('${U.chair}', 'Chairman', '홍대표', 'Vault', null, null), ('${U.a}', 'Member', '박지훈', 'Normal', null, null),
      ('${U.b}', 'Member', '김민수', 'Normal', null, null), ('${U.v}', 'Member', '정하늘', 'Normal', null, null),
      ('${U.agent}', 'AIAgent', 'agent', 'Restricted', null, null), ('${U.gone}', 'Member', '퇴사', 'Normal', null, now());
    insert into user_business_access values ('${U.a}', 'biz_dy'), ('${U.b}', 'biz_dy'), ('${U.v}', 'biz_vana'), ('${U.agent}', 'biz_dy'), ('${U.gone}', 'biz_dy');
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
  const one = async <T>(uid: string, sql: string): Promise<T> => {
    const r = await as<T>(uid, sql)
    assert.ok(Array.isArray(r), `0086: 거부되면 안 되는 호출이 거부됐다 — ${String(r).slice(0, 200)} · ${sql.slice(0, 140)}`)
    return (r as T[])[0]
  }
  const deny = async (uid: string | null, sql: string, re: RegExp, why: string, role: 'authenticated' | 'anon' = 'authenticated') => {
    const r = await as(uid, sql, role)
    assert.ok(typeof r === 'string' && re.test(r), `0086: ${why} — ${typeof r === 'string' ? r.slice(0, 160) : JSON.stringify(r).slice(0, 160)}`)
  }
  const save = (exp: number, widgets: string, schema = 1) => `select home_layout_save(${exp}, ${schema}, '${widgets}'::jsonb) as r`
  const mine = async (uid: string) => (await as<{ user_id: string; revision: number; widgets: unknown }>(uid, `select user_id, revision, widgets from home_layouts`)) as { user_id: string; revision: number; widgets: unknown }[]

  // ── 스위치: 기본 대표만 ──
  await deny(U.a, save(0, W(2)), /home_denied/, '스위치 기본(대표만)에서 직원이 저장했다')
  assert.equal((await one<{ r: number }>(U.chair, save(0, W(1)))).r, 1, '대표 첫 저장 판')
  await one(U.chair, `select feature_switch_set('home_widgets', 'biz_dy', true, 'all', '시험 — DY 전원') as x`)
  await deny(U.v, save(0, W(2)), /home_denied/, 'DY 줄만 켰는데 VANA 직원이 저장했다')
  await deny(U.agent, save(0, W(2)), /home_denied/, 'AI Agent가 저장했다')
  await deny(U.gone, save(0, W(2)), /home_denied/, '회수된 사람이 저장했다')
  await deny(null, save(0, W(2)), /permission denied|home_denied/, 'anon이 저장했다', 'anon')
  await deny(null, `select * from home_layouts`, /permission denied/, 'anon이 표를 읽었다', 'anon')

  // ── A 저장 · B 분리 ──
  assert.equal((await one<{ r: number }>(U.a, save(0, W(2)))).r, 1, 'A 첫 저장 판 1')
  assert.deepEqual((await mine(U.a)).map((r) => [r.user_id, r.revision]), [[U.a, 1]], 'A가 자기 줄을 못 읽는다')
  assert.equal((await mine(U.b)).length, 0, 'B가 A의 배치를 읽는다(RLS)')
  assert.equal((await mine(U.chair)).filter((r) => r.user_id === U.a).length, 0, '대표도 남의 배치를 읽는다(본인만이어야)')
  assert.equal((await one<{ r: number }>(U.b, save(0, W(3)))).r, 1, 'B 첫 저장 — A 저장이 B의 판을 바꿨다')
  assert.equal(((await mine(U.a))[0].widgets as unknown[]).length, 2, 'B 저장이 A 배치를 바꿨다')

  // ── 표 직접 쓰기 없음 · 본문 사용자 id 없음 ──
  await deny(U.a, `insert into home_layouts (user_id, widgets) values ('${U.b}', '[]'::jsonb)`, /permission denied/, 'A가 표에 직접 B 줄을 넣었다')
  await deny(U.a, `update home_layouts set widgets = '[]'::jsonb`, /permission denied/, 'A가 표를 직접 고쳤다')
  await deny(U.a, `delete from home_layouts`, /permission denied/, 'A가 표를 직접 지웠다')
  await deny(U.a, `select home_widgets_valid('[]'::jsonb)`, /permission denied/, '내부 모양 함수가 열려 있다')

  // ── 충돌(다른 탭) ──
  assert.equal((await one<{ r: number }>(U.a, save(1, W(4)))).r, 2, 'A 두 번째 저장 판 2')
  await deny(U.a, save(1, W(1)), /home_conflict/, '옛 판(1)으로 저장이 덮어썼다(다른 탭)')
  await deny(U.a, save(0, W(1)), /home_conflict/, '줄이 있는데 expected 0으로 덮어썼다')
  await deny(U.a, save(5, W(1)), /home_conflict/, '없는 앞 판(5)으로 저장됐다')
  assert.equal(((await mine(U.a))[0].widgets as unknown[]).length, 4, '충돌 거부 뒤 배치가 바뀌었다')

  // ── 모양 ──
  await deny(U.a, `select home_layout_save(2, 1, '{}'::jsonb)`, /home_invalid/, '배열이 아닌 배치가 저장됐다')
  await deny(U.a, save(2, W(31)), /home_invalid/, '31개가 저장됐다')
  await deny(U.a, save(2, JSON.stringify([{ id: 'x', kind: 'my_tasks', size: 's' }, { id: 'x', kind: 'approvals', size: 's' }])), /home_invalid/, 'id 겹침이 저장됐다')
  await deny(U.a, save(2, JSON.stringify([{ id: 'x', kind: 'my_tasks', size: 'xl' }])), /home_invalid/, '틀린 크기가 저장됐다')
  await deny(U.a, save(2, JSON.stringify([{ id: 'x', kind: 'my_tasks', size: 's', settings: [] }])), /home_invalid/, 'settings 배열이 저장됐다')
  await deny(U.a, save(2, JSON.stringify([{ id: 'X Y', kind: 'my_tasks', size: 's' }])), /home_invalid/, '틀린 id가 저장됐다')
  await deny(U.a, save(2, W(1), 2), /home_invalid/, '모르는 판(2)이 저장됐다')
  await deny(U.a, `select home_layout_save(-1, 1, '[]'::jsonb)`, /home_invalid/, '음수 판이 저장됐다')
  assert.equal((await one<{ r: number }>(U.a, save(2, JSON.stringify([{ id: 'old', kind: 'retired_widget', size: 'm', settings: { filter: 'x' } }])))).r, 3, '모르는 kind가 저장 안 된다(배치를 지우면 안 된다)')
  assert.equal((await one<{ r: number }>(U.a, save(3, '[]'))).r, 4, '빈 배치(전부 지움)가 저장 안 된다')

  // ── 스위치를 끄면 저장 거부(읽기는 본인 줄 그대로) ──
  await one(U.chair, `select feature_switch_set('home_widgets', 'biz_dy', false, 'all', '시험 — 끔') as x`)
  await deny(U.a, save(4, W(1)), /home_denied/, '스위치를 껐는데 저장됐다')
  assert.equal((await mine(U.a)).length, 1, '스위치를 꺼도 본인 줄 읽기는 그대로여야')

  const fns = await db.query<{ f: string; anon: boolean; auth: boolean }>(
    `select p.proname as f, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
       from pg_proc p where p.proname in ('home_layout_save', 'home_widgets_on', 'home_widgets_valid') order by 1`,
  )
  assert.deepEqual(fns.rows, [
    { f: 'home_layout_save', anon: false, auth: true },
    { f: 'home_widgets_on', anon: false, auth: true },
    { f: 'home_widgets_valid', anon: false, auth: false },
  ], '0086 함수 권한')
  const pol = await db.query<{ roles: string[]; cmd: string }>(`select roles::text[] as roles, cmd from pg_policies where tablename = 'home_layouts'`)
  assert.deepEqual(pol.rows, [{ roles: ['authenticated'], cmd: 'SELECT' }], '0086 정책은 to authenticated select 하나')
  await db.close()
  return '0086 내 홈(스위치 기본 대표만 · 회사 줄 · 다른 회사 · AI Agent · 회수 · anon 거부 · A/B 분리(대표도 남의 배치 못 읽음) · 표 직접 쓰기 없음 · revision 충돌(옛 판 · 0 · 앞 판) · 모양 일곱 · 모르는 kind · 빈 배치 · 끄면 저장 거부 · 함수 권한 · 정책 to authenticated)'
}

if (process.argv[1]?.endsWith('check-home-widgets-db.ts')) {
  homeWidgetsDb()
    .then((s) => console.log(`PASS: ${s}`))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
