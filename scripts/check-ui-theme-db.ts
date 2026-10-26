/**
 * 0098 화면 모양 칸 — check-migrations.ts가 부른다(PGlite · 전부 적용한 DB). 혼자: npx tsx scripts/check-ui-theme-db.ts
 *   칸: user_settings.ui_theme — null 허용 · 기본값 없음(직전 코드의 upsert가 그대로 돈다) · 'new' · 'classic'만.
 *   본인만: 0002 user_settings_own 그대로 — 대표도 남의 화면 모양을 못 읽고 못 바꾼다 · anon 거부.
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000098a1',
  a: '00000000-0000-0000-0000-0000000098a2',
}

export async function uiThemeDb(): Promise<string> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ('${U.chair}', 'c@x'), ('${U.a}', 'a@x');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id, revoked_at) values
      ('${U.chair}', 'Chairman', '홍대표', 'Vault', null, null), ('${U.a}', 'Member', '박지훈', 'Normal', null, null);
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

  // 칸 모양 — null 허용 · 기본값 없음.
  const col = await db.query<{ is_nullable: string; column_default: string | null }>(
    `select is_nullable, column_default from information_schema.columns where table_name = 'user_settings' and column_name = 'ui_theme'`,
  )
  assert.equal(col.rows[0]?.is_nullable, 'YES', '0098: ui_theme이 null을 허용하지 않는다')
  assert.equal(col.rows[0]?.column_default, null, '0098: ui_theme에 기본값이 있다')

  // 직전 코드의 저장(ui_theme 없이 upsert)이 그대로 된다 — null로 남는다.
  const legacy = await as(U.a, `insert into user_settings (user_id, app_prefs) values ('${U.a}', '{"theme":"light"}') on conflict (user_id) do update set app_prefs = excluded.app_prefs returning ui_theme`)
  assert.ok(Array.isArray(legacy) && (legacy as { ui_theme: string | null }[])[0].ui_theme === null, `0098: 직전 코드 저장이 거부됐다 — ${String(legacy)}`)

  // 본인 저장 · 값 모양.
  assert.ok(Array.isArray(await as(U.a, `update user_settings set ui_theme = 'classic' where user_id = '${U.a}'`)), '0098: 본인 저장 거부')
  assert.match(String(await as(U.a, `update user_settings set ui_theme = 'dark' where user_id = '${U.a}'`)), /user_settings_ui_theme_shape/, '0098: 모르는 값이 들어간다')
  assert.ok(Array.isArray(await as(U.chair, `insert into user_settings (user_id, ui_theme) values ('${U.chair}', 'new')`)), '0098: 대표 본인 저장 거부')

  // 본인만 — 대표도 남의 줄은 0행, 바꾸기 0행.
  const peek = await as<{ n: number }>(U.chair, `select count(*)::int as n from user_settings where user_id = '${U.a}'`)
  assert.deepEqual(peek, [{ n: 0 }], '0098: 대표가 남의 화면 모양을 읽는다')
  const poke = await as(U.chair, `update user_settings set ui_theme = 'new' where user_id = '${U.a}' returning 1`)
  assert.deepEqual(poke, [], '0098: 대표가 남의 화면 모양을 바꾼다')
  const mine = await as<{ ui_theme: string }>(U.a, `select ui_theme from user_settings where user_id = '${U.a}'`)
  assert.deepEqual(mine, [{ ui_theme: 'classic' }], '0098: 본인 값이 그대로가 아니다')

  // anon 거부.
  const anon = await as(null, `select count(*)::int as n from user_settings`, 'anon')
  assert.ok(typeof anon === 'string' || (Array.isArray(anon) && (anon as { n: number }[])[0].n === 0), '0098: anon이 화면 설정을 읽는다')

  await db.close()
  return '0098 화면 모양(ui_theme null 허용 · 기본값 없음 · 직전 코드 저장 · new/classic만 · 본인만 — 대표도 남의 것 0행 · anon)'
}

if (process.argv[1]?.endsWith('check-ui-theme-db.ts')) {
  uiThemeDb().then((s) => console.log(`PASS ${s}`), (e) => { console.error(e); process.exit(1) })
}
