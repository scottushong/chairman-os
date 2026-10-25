/**
 * 0097 구역 배치 — check-migrations.ts가 부른다(PGlite · 전부 적용한 DB). 혼자: npx tsx scripts/check-dashboard-db.ts
 *   저장: home_layout_save_sections(판 2 · widgets '[]') · 0086 revision 규칙 그대로(옛 판 · 0 · 앞 판 = home_conflict).
 *   호환: 0086 home_layout_save(판 1)가 이 DB에서도 그대로 돈다(직전 코드) — 판이 오가도 revision은 하나로 오른다.
 *   종류 문: 재무 위젯 = 대표 · 그룹 CFO만 · 투자 위젯 = 대표 · /investment 지정자만 · 아침 루틴 판단 · 기억 검토함 = 대표만 → 아니면 home_kind_denied.
 *   본인만: 직원이 대표 배치를 못 읽는다(RLS 0086 그대로) · 표 직접 쓰기 없음 · anon · AI Agent 거부.
 *   모양: 13구역 · 위젯 id 구역 사이 겹침 · 구역 id 겹침 · 빈 제목 · 41자 제목 · 숨김 글자 · 범위 모양 · 위젯 범위 모양 · 61위젯 · 배열 아님 → home_invalid.
 *   Expand-only: sections 칸은 null 허용 · 0086 줄(판 1)은 그대로 읽힌다.
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000097a1',
  cfo: '00000000-0000-0000-0000-0000000097a2',
  a: '00000000-0000-0000-0000-0000000097a3', // DY 직원
  desig: '00000000-0000-0000-0000-0000000097a4', // DY 직원 + /investment 지정자
  agent: '00000000-0000-0000-0000-0000000097a5',
}

const sec = (id: string, kinds: string[], extra: object = {}, prefix = id) => ({ id, title: `구역 ${id}`, hidden: false, collapsed: false, scope: { biz: 'all' }, widgets: kinds.map((k, i) => ({ id: `${prefix}-${k}-${i}`, kind: k, size: 's', settings: {} })), ...extra })
const J = (v: unknown) => JSON.stringify(v).replace(/'/g, "''")

export async function dashboardDb(): Promise<string> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ${Object.values(U).map((id, i) => `('${id}', 'd${i}@x')`).join(', ')};
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id, revoked_at) values
      ('${U.chair}', 'Chairman', '홍대표', 'Vault', null, null), ('${U.cfo}', 'GroupCFO', '재무총괄', 'Restricted', null, null),
      ('${U.a}', 'Member', '박지훈', 'Normal', null, null), ('${U.desig}', 'Member', '투자지정', 'Normal', null, null),
      ('${U.agent}', 'AIAgent', 'agent', 'Restricted', null, null);
    insert into user_business_access values ('${U.a}', 'biz_dy'), ('${U.cfo}', 'biz_dy'), ('${U.desig}', 'biz_dy'), ('${U.agent}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write) values ('${U.desig}', '/investment', false);
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
    assert.ok(Array.isArray(r), `0097: 거부되면 안 되는 호출이 거부됐다 — ${String(r).slice(0, 200)} · ${sql.slice(0, 160)}`)
    return (r as T[])[0]
  }
  const deny = async (uid: string | null, sql: string, re: RegExp, why: string, role: 'authenticated' | 'anon' = 'authenticated') => {
    const r = await as(uid, sql, role)
    assert.ok(typeof r === 'string' && re.test(r), `0097: ${why} — ${typeof r === 'string' ? r.slice(0, 160) : JSON.stringify(r).slice(0, 160)}`)
  }
  const save = (exp: number, sections: unknown) => `select home_layout_save_sections(${exp}, '${J(sections)}'::jsonb) as r`
  const rev = async (uid: string, exp: number, sections: unknown) => (await one<{ r: number }>(uid, save(exp, sections))).r
  const row = async (uid: string) =>
    ((await as<{ user_id: string; schema_version: number; revision: number; widgets: unknown[]; sections: unknown[] | null }>(uid, `select user_id, schema_version, revision, widgets, sections from home_layouts`)) as {
      user_id: string
      schema_version: number
      revision: number
      widgets: unknown[]
      sections: unknown[] | null
    }[])

  const CHAIR = [sec('today', ['ai_judgment', 'approvals']), sec('finance', ['fin_kpis', 'cash_forecast', 'fin_checklist', 'companies'], { scope: { biz: 'biz_dy' } }), sec('invest', ['inv_kpis', 'inv_buy_zone', 'inv_monthly']), sec('brief', ['inv_brief', 'inv_alerts', 'memory_review'])]

  // ── 대표: 기본 배치 전부 · 판 2 · widgets '[]' ──
  assert.equal(await rev(U.chair, 0, CHAIR), 1, '대표 첫 구역 저장 판 1')
  const c1 = (await row(U.chair))[0]
  assert.deepEqual([c1.schema_version, c1.revision, c1.widgets.length, c1.sections?.length], [2, 1, 0, 4], '판 2 · widgets 빈 배열 · 구역 넷')

  // ── 호환: 직전 코드(0086 home_layout_save 판 1)가 같은 줄에 그대로 쓴다 → 다시 구역 저장. revision 하나로 오른다 ──
  assert.equal((await one<{ r: number }>(U.chair, `select home_layout_save(1, 1, '[{"id":"my_tasks","kind":"my_tasks","size":"m","settings":{}}]'::jsonb) as r`)).r, 2, '0086 저장이 0097 DB에서 안 돈다')
  const c2 = (await row(U.chair))[0]
  assert.deepEqual([c2.schema_version, c2.revision, c2.widgets.length], [1, 2, 1], '판 1로 돌아간 줄(앱은 판 1 줄의 sections를 읽지 않는다)')
  await deny(U.chair, save(1, CHAIR), /home_conflict/, '0086 저장 뒤 옛 판(1)으로 구역 저장이 덮어썼다')
  assert.equal(await rev(U.chair, 2, CHAIR), 3, '판 2 다시 저장')

  // ── 스위치: 기본 대표만 → 직원 거부 → DY 줄 켬 ──
  await deny(U.a, save(0, [sec('main', ['my_tasks'])]), /home_denied/, '스위치 기본(대표만)에서 직원이 구역 배치를 저장했다')
  await one(U.chair, `select feature_switch_set('home_widgets', 'biz_dy', true, 'all', '시험 — DY 전원') as x`)

  // ── 종류 문 ──
  for (const k of ['fin_kpis', 'cash_forecast', 'fin_checklist', 'companies', 'inv_kpis', 'inv_buy_zone', 'inv_brief', 'inv_alerts', 'inv_monthly', 'ai_judgment', 'memory_review']) {
    await deny(U.a, save(0, [sec('main', ['my_tasks', k])]), /home_kind_denied/, `직원이 «${k}» 위젯을 저장했다`)
  }
  assert.equal(await rev(U.a, 0, [sec('main', ['my_tasks', 'approvals', 'projects', 'retired_widget'])]), 1, '직원 기본 위젯 + 프로젝트 현황 + 모르는 종류(보존)')
  assert.equal(await rev(U.cfo, 0, [sec('finance', ['fin_kpis', 'companies']), sec('main', ['my_tasks'])]), 1, 'CFO 재무 위젯')
  await deny(U.cfo, save(1, [sec('x', ['inv_kpis'])]), /home_kind_denied/, 'CFO가 투자 위젯을 저장했다(지정자 아님)')
  await deny(U.cfo, save(1, [sec('x', ['ai_judgment'])]), /home_kind_denied/, 'CFO가 아침 루틴 판단을 저장했다(대표만)')
  assert.equal(await rev(U.desig, 0, [sec('inv', ['inv_kpis', 'inv_brief']), sec('main', ['my_tasks'])]), 1, '지정자 투자 위젯')
  await deny(U.desig, save(1, [sec('x', ['fin_kpis'])]), /home_kind_denied/, '투자 지정자가 재무 위젯을 저장했다')
  assert.equal(
    (await one<{ a: boolean; b: boolean }>(U.a, `select home_kind_allowed('fin_kpis') as a, home_kind_allowed('my_tasks') as b`)).a,
    false,
    '직원 home_kind_allowed(fin_kpis) = 참',
  )

  // ── 본인만 · 표 직접 쓰기 없음 · anon · AI ──
  assert.deepEqual((await row(U.a)).map((r) => r.user_id), [U.a], '직원이 남의(대표) 배치를 읽는다')
  assert.deepEqual((await row(U.chair)).map((r) => r.user_id), [U.chair], '대표가 남의 배치를 읽는다')
  await deny(U.a, `update home_layouts set sections = '[]'::jsonb`, /permission denied/, '표를 직접 고쳤다')
  await deny(U.a, `insert into home_layouts (user_id, sections) values ('${U.cfo}', '[]'::jsonb)`, /permission denied/, '남의 줄을 직접 넣었다')
  await deny(U.a, `select home_sections_valid('[]'::jsonb)`, /permission denied/, '내부 모양 함수가 열려 있다')
  await deny(U.agent, save(0, [sec('main', ['my_tasks'])]), /home_denied/, 'AI Agent가 저장했다')
  await deny(null, save(0, [sec('main', ['my_tasks'])]), /permission denied|home_denied/, 'anon이 저장했다', 'anon')

  // ── 충돌 ──
  await deny(U.a, save(0, [sec('main', ['my_tasks'])]), /home_conflict/, '줄이 있는데 expected 0')
  await deny(U.a, save(7, [sec('main', ['my_tasks'])]), /home_conflict/, '없는 앞 판')
  assert.equal(await rev(U.a, 1, [sec('main', ['my_tasks']), sec('two', ['schedule'], { hidden: true, collapsed: true, scope: { biz: 'biz_dy', project: 'P-1' } })]), 2, '구역 둘 · 숨김 · 접힘 · 범위')
  await deny(U.a, save(1, [sec('main', ['my_tasks'])]), /home_conflict/, '옛 판(다른 탭)')

  // ── 모양 ──
  const bad: [unknown, string][] = [
    [{}, '배열 아님'],
    [Array.from({ length: 13 }, (_, i) => sec(`s${i}`, [])), '13구역'],
    [[sec('a', ['my_tasks'], {}, 'x'), sec('b', ['my_tasks'], {}, 'x')], '위젯 id가 구역 사이에서 겹침'],
    [[sec('a', []), sec('a', [])], '구역 id 겹침'],
    [[sec('a', [], { title: '  ' })], '빈 제목'],
    [[sec('a', [], { title: 'ㄱ'.repeat(41) })], '41자 제목'],
    [[sec('a', [], { hidden: 'yes' })], '숨김 글자'],
    [[sec('a', [], { scope: { biz: 'Bad Biz' } })], '범위 모양'],
    [[sec('a', [], { scope: [] })], '범위 배열'],
    [[{ ...sec('a', []), widgets: [{ id: 'w', kind: 'my_tasks', size: 's', settings: { scope: { project: 'x y' } } }] }], '위젯 범위 모양'],
    [Array.from({ length: 3 }, (_, i) => ({ ...sec(`s${i}`, []), widgets: Array.from({ length: 21 }, (_, j) => ({ id: `w${i}-${j}`, kind: 'my_tasks', size: 's', settings: {} })) })), '61위젯'],
    [[{ id: 'a', title: '제목' }], 'widgets 없음'],
    [[sec('A B', [])], '구역 id 모양'],
  ]
  for (const [v, why] of bad) await deny(U.a, save(2, v), /home_invalid/, `${why}가 저장됐다`)
  await deny(U.a, `select home_layout_save_sections(-1, '[]'::jsonb)`, /home_invalid/, '음수 판')
  assert.equal(await rev(U.a, 2, []), 3, '빈 배치(구역 전부 지움)가 저장 안 된다')

  // ── 스위치를 끄면 저장 거부 ──
  await one(U.chair, `select feature_switch_set('home_widgets', 'biz_dy', false, 'all', '시험 — 끔') as x`)
  await deny(U.a, save(3, [sec('main', ['my_tasks'])]), /home_denied/, '스위치를 껐는데 저장됐다')

  const fns = await db.query<{ f: string; anon: boolean; auth: boolean }>(
    `select p.proname as f, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
       from pg_proc p where p.proname in ('home_layout_save_sections', 'home_kind_allowed', 'home_sections_valid', 'home_scope_valid') order by 1`,
  )
  assert.deepEqual(fns.rows, [
    { f: 'home_kind_allowed', anon: false, auth: true },
    { f: 'home_layout_save_sections', anon: false, auth: true },
    { f: 'home_scope_valid', anon: false, auth: false },
    { f: 'home_sections_valid', anon: false, auth: false },
  ], '0097 함수 권한')
  const col = await db.query<{ is_nullable: string; column_default: string | null }>(`select is_nullable, column_default from information_schema.columns where table_name = 'home_layouts' and column_name = 'sections'`)
  assert.deepEqual(col.rows, [{ is_nullable: 'YES', column_default: null }], 'sections 칸은 null 허용 · 기본값 없음(Expand-only)')
  await db.close()
  return '0097 구역 배치(판 2 · 0086 저장 호환 · revision 하나 · 종류 문 — 직원 재무/투자/대표 전용 11종 거부 · CFO 재무만 · 지정자 투자만 · 본인만 · 표 직접 쓰기 없음 · AI · anon · 충돌 · 모양 열넷 · 빈 배치 · 끄면 거부 · 함수 권한 · 칸 null)'
}

if (process.argv[1]?.endsWith('check-dashboard-db.ts')) {
  dashboardDb()
    .then((s) => console.log(`PASS: ${s}`))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
