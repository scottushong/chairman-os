/**
 * «superuser 아닌 소유자로 0001 ~ 끝 적용» — 2026-10-14 staging push 실패의 재발 방지.
 *
 * 그날 0071이 staging에서 «permission denied to set parameter "chairman.process_chart_sync"»로 멈췄다. 함수 SET 절의
 * 사용자 정의 설정은 superuser만 쓸 수 있는데, Supabase의 postgres는 superuser가 아니다(rolsuper = false · rolbypassrls = true,
 * staging 2026-10-14 확인). PGlite 하네스는 superuser라 이것을 못 잡았다.
 *
 * 여기서는 Supabase의 postgres를 흉내 낸 역할(stg_postgres: superuser 아님 · BYPASSRLS · createrole · public 스키마 주인 ·
 * anon · authenticated 멤버)로 **모든 마이그레이션을 차례로** 올린다. 그 역할로 안 되는 문장(사용자 정의 설정 SET 절 · alter system ·
 * 신뢰 안 된 확장 · 남의 객체 바꾸기 · 카탈로그 쓰기 …)이 들어오면 여기서 그 파일 이름과 함께 FAIL.
 * 대조군: 같은 역할로 사용자 정의 설정 SET 절 함수를 만들면 staging과 같은 문장으로 거부되어야 한다(흉내가 진짜와 같은가).
 *
 * 혼자 돌리기 · 대조군(원본 파일로 바꿔 끼우기):
 *   npx tsx scripts/check-nonsuper-apply.ts
 *   NONSUPER_OVERRIDE="0071_process_chart_sync.sql=<원본 경로>" npx tsx scripts/check-nonsuper-apply.ts   → FAIL이 나야 한다
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { MIGRATIONS, SUPABASE_STUBS } from './pglite'

export async function nonSuperuserApply(): Promise<number> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await db.exec(SUPABASE_STUBS)
  // Supabase postgres 흉내. auth · storage 표는 Supabase에서도 postgres가 참조 · 정책을 걸 수 있으므로 넘겨 둔다(그 밖은 주지 않는다).
  await db.exec(`
    create role stg_postgres nosuperuser bypassrls createrole nologin;
    grant anon, authenticated, supabase_auth_admin to stg_postgres;
    alter schema public owner to stg_postgres;
    do $g$ begin execute format('grant create, temporary on database %I to stg_postgres', current_database()); end $g$;
    grant usage, create on schema auth, extensions, storage to stg_postgres;
    grant all on all tables in schema auth, storage to stg_postgres;
    alter table storage.objects owner to stg_postgres;
    alter table storage.buckets owner to stg_postgres;
    alter default privileges for role stg_postgres in schema public grant all on tables    to anon, authenticated;
    alter default privileges for role stg_postgres in schema public grant all on sequences to anon, authenticated;
  `)
  await db.exec('set role stg_postgres')
  const me = (await db.query<{ u: string; s: boolean; b: boolean }>(
    `select current_user as u, rolsuper as s, rolbypassrls as b from pg_roles where rolname = current_user`)).rows[0]
  assert.deepEqual([me.u, me.s, me.b], ['stg_postgres', false, true], `흉내 역할이 아니다 ${JSON.stringify(me)}`)

  // 대조군 — staging 2026-10-14와 같은 거부.
  let control = ''
  try {
    await db.exec(`create function pg_temp.nonsuper_control() returns int language sql set chairman.process_chart_sync = 'on' as 'select 1'`)
  } catch (e) {
    control = e instanceof Error ? e.message : String(e)
  }
  assert.match(control, /permission denied to set parameter/, `대조군: superuser 아닌 역할의 사용자 정의 설정 SET 절이 거부되지 않았다(${control || '통과'}) — 흉내가 staging과 다르다`)

  const override = new Map(
    (process.env.NONSUPER_OVERRIDE ?? '').split(';').filter(Boolean).map((kv) => kv.split('=') as [string, string]),
  )
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    const sql = readFileSync(override.get(f) ?? join(MIGRATIONS, f), 'utf8')
    try {
      await db.exec(sql)
    } catch (e) {
      throw new Error(`superuser 아닌 소유자(Supabase postgres 흉내)로 ${f} 적용 실패: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  await db.close()
  return files.length
}

if (require.main === module) {
  nonSuperuserApply()
    .then((n) => console.log(`PASS: superuser 아닌 소유자로 ${n}개 적용 · 대조군(사용자 정의 설정 SET 절 거부)`))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exit(1)
    })
}
