/**
 * 0060 재발 방지 — /api/health가 anon으로 세는 표 전부를 **BYPASSRLS 없는 소유자** 아래에서 anon으로 select한다.
 * 오류 없이 0행이어야 한다. 그리고 같은 조건에서 직원(Member · TeamLead · BusinessCEO) · 대표 · 결재 대장 열람자의
 * 결재 경로(decisions · approval_steps 읽기 · approval_decide · approval_ledger_log)가 오류 없이 도는지 잰다.
 *
 * 0059 검사가 이것을 못 잡은 이유: 0059 검사는 authenticated 세션만 돌렸고(anon으로 decisions를 읽은 적이 없다),
 * 함수 권한은 has_function_privilege 카탈로그로만 쟀다 — «anon이 execute를 못 한다»는 맞았지만, 그 함수를
 * **anon에게도 걸리는 정책**이 부른다는 것은 행동으로 재야만 보인다.
 *
 * 표 목록은 src/app/api/health/route.ts의 TABLES를 그대로 읽는다 — health에 표가 늘면 이 검사도 는다.
 * check:migrations의 main()이 부른다. 혼자 돌릴 때: npx tsx scripts/check-anon-health.ts
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyOne, MIGRATIONS, SUPABASE_STUBS, type Db } from './pglite'

/**
 * applyAll과 같되 Supabase의 **함수** 기본 권한도 흉내 낸다. 실제 프로젝트는 public에 새로 만든 함수의 execute를
 * anon · authenticated에게 **이름으로** 준다 — 그래서 `revoke … from public`만 한 함수(0025 in_my_subtree 등)는
 * production에서 anon이 여전히 부른다. 0059는 `from public, anon`으로 걷어서 정책이 anon에서 깨졌다.
 * 이 줄이 없으면 PGlite는 «public에서 걷음 = anon도 못 부름»이 되어 production과 다른 답을 낸다.
 * (공용 SUPABASE_STUBS에 넣지 않는 이유: 다른 검사의 카탈로그 단언 기준이 바뀐다 — DEFERRED에 적었다.)
 */
async function applyLikeSupabase(db: Db, upTo?: string) {
  await db.exec(SUPABASE_STUBS)
  await db.exec(`alter default privileges in schema public grant all on functions to anon, authenticated;`)
  const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const f of upTo ? all.slice(0, all.indexOf(upTo) + 1) : all) await applyOne(db, f)
}

export function healthTables(): string[] {
  const src = readFileSync(join(__dirname, '..', 'src', 'app', 'api', 'health', 'route.ts'), 'utf8')
  const block = src.match(/const TABLES = \[([\s\S]*?)\] as const/)
  assert.ok(block, 'health route에서 TABLES를 못 찾았다')
  const tables = [...block[1].replace(/\/\/.*$/gm, '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(tables.length >= 24, `health TABLES가 ${tables.length}개뿐이다 — 읽기 정규식이 깨졌다`)
  return tables
}

/** Supabase 흉내: public의 표 · 뷰 · 함수 전부를 BYPASSRLS 없는 한 소유자에게(production의 postgres와 같은 조건). */
async function nonBypassOwner(db: Db) {
  await db.exec(`
    create role app_owner nosuperuser nobypassrls nologin;
    grant usage on schema auth, storage, extensions to app_owner;
    grant select on auth.users to app_owner;
    grant select, insert, update, delete on storage.objects to app_owner;
    grant usage on schema public, auth, extensions to authenticated, anon;
    do $$ declare r record; begin
      for r in select c.oid::regclass as t, c.relkind from pg_class c
                where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
                  and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
        execute format('alter %s %s owner to app_owner',
          case r.relkind when 'v' then 'view' when 'm' then 'materialized view' else 'table' end, r.t);
      end loop;
      for r in select p.oid::regprocedure as f, p.prokind from pg_proc p
                where p.pronamespace = 'public'::regnamespace
                  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
        execute format('alter %s %s owner to app_owner',
          case r.prokind when 'p' then 'procedure' when 'a' then 'aggregate' else 'function' end, r.f);
      end loop;
    end $$;
  `)
  const o = (await db.query<{ s: boolean; b: boolean }>(`select rolsuper as s, rolbypassrls as b from pg_roles where rolname = 'app_owner'`)).rows[0]
  assert.deepEqual(o, { s: false, b: false }, '실험 설정이 깨졌다 — app_owner가 superuser거나 bypassrls다')
  const left = (await db.query<{ n: number }>(`select count(*)::int as n from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v') and pg_get_userbyid(c.relowner) <> 'app_owner'
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')`)).rows[0].n
  assert.equal(left, 0, '실험 설정이 깨졌다 — 소유자를 못 넘긴 표가 있다')
}

async function anonCount(db: Db, table: string): Promise<number> {
  await db.exec(`begin; set local role anon;`)
  try {
    return (await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n
  } finally {
    await db.exec('rollback')
  }
}

const P = {
  chair: '00000000-0000-0000-0000-0000000060a1',
  ceo: '00000000-0000-0000-0000-0000000060a2', // DY BusinessCEO, 상사 = 대표
  lead: '00000000-0000-0000-0000-0000000060a3', // DY TeamLead, 상사 = 대표
  mem: '00000000-0000-0000-0000-0000000060a4', // DY Member, 상사 = lead
  clerk: '00000000-0000-0000-0000-0000000060a5', // DY 경영지원 — «DY 결재 대장 열람»
  other: '00000000-0000-0000-0000-0000000060a6', // DY Member, 결재선 밖 · 대장 권한 없음
}

export async function anonHealth() {
  const tables = healthTables()

  // ── 대조군: 0059까지만 — 이 검사가 0059의 고장(anon decisions 42501)을 실제로 잡는가 ──
  {
    const db = new PGlite({ extensions: { pg_trgm } })
    await applyLikeSupabase(db, '0059_approval_chain.sql')
    await nonBypassOwner(db)
    await assert.rejects(anonCount(db, 'decisions'), /permission denied for function/,
      '대조군이 성립하지 않는다 — 0059만 올린 DB에서 anon decisions가 오류 없이 돈다(이 검사가 0059의 고장을 재지 않는다)')
    await db.close()
  }

  const db = new PGlite({ extensions: { pg_trgm } })
  await applyLikeSupabase(db)
  await nonBypassOwner(db)

  // ── anon: health 표 전부 오류 없이 0행 ──
  const seeded = (await db.query<{ n: number }>(`select count(*)::int as n from decisions`)).rows[0].n
  assert.ok(seeded > 0, '전제: 시드 결재가 없다 — anon 0행이 «막혀서»인지 «비어서»인지 구분이 안 된다')
  for (const t of tables) {
    let n: number
    try {
      n = await anonCount(db, t)
    } catch (e) {
      throw new Error(`0060: anon이 ${t}를 읽다 오류 — /api/health가 ok:false가 된다: ${e instanceof Error ? e.message : String(e)}`)
    }
    assert.equal(n, 0, `0060: anon에게 ${t}의 행이 ${n}개 보인다`)
  }

  // ── 직원 · 대표 · 대장 경로 ──
  await db.exec(`
    insert into auth.users select id::uuid, id || '@x' from unnest(array[${Object.values(P).map((u) => `'${u}'`).join(', ')}]) id;
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${P.chair}', 'Chairman', '회장님', 'Vault', null),
      ('${P.ceo}', 'BusinessCEO', 'DY 대표이사', 'Restricted', null),
      ('${P.lead}', 'TeamLead', '팀장', 'Normal', 'team_dy_support'),
      ('${P.mem}', 'Member', '사원', 'Normal', 'team_dy_support'),
      ('${P.clerk}', 'Member', '경영지원', 'Normal', 'team_dy_support'),
      ('${P.other}', 'Member', '남', 'Normal', null);
    update user_profiles set reports_to = '${P.chair}' where user_id in ('${P.ceo}', '${P.lead}');
    update user_profiles set reports_to = '${P.lead}' where user_id in ('${P.mem}', '${P.clerk}', '${P.other}');
    insert into user_business_access select u::uuid, 'biz_dy' from unnest(array['${P.ceo}', '${P.lead}', '${P.mem}', '${P.clerk}', '${P.other}']) u;
    insert into user_module_access (user_id, module, can_write, can_approve) values ('${P.clerk}', '/approvals/ledger/biz_dy', false, false);
    update approval_templates set attachment_required = false;
  `)
  const run = async <T,>(uid: string, sql: string, commit = false) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const r = (await db.query<T>(sql)).rows
      await db.exec(commit ? 'commit' : 'rollback')
      return r
    } catch (e) {
      await db.exec('rollback')
      throw new Error(`0060: ${uid.slice(-2)} 경로 오류 — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const sees = async (uid: string) => {
    const [d] = await run<{ d: number; s: number; all_d: number; all_s: number }>(uid, `select
      (select count(*)::int from decisions where decision_id = 'dec_60a') as d,
      (select count(*)::int from approval_steps where decision_id = 'dec_60a') as s,
      (select count(*)::int from decisions) as all_d,
      (select count(*)::int from approval_steps) as all_s`)
    return { d: d.d, s: d.s }
  }

  await run(P.mem, `insert into decisions (decision_id, business_id, title, template_key, form, created_by)
    values ('dec_60a', 'biz_dy', '지출', 'expense', '{"amount":"6000000","purpose":"비품","spent_on":"2026-10-10"}'::jsonb, '${P.mem}')
    returning 'ok' as v`, true)
  const steps = (await db.query<{ who: string }>(`select approver_user_id::text as who from approval_steps where decision_id = 'dec_60a' order by seq`)).rows
  assert.deepEqual(steps.map((s) => s.who), [P.lead, P.chair], '0060 전제: 600만 지출의 결재선이 팀장 → 대표가 아니다')

  assert.deepEqual(await sees(P.mem), { d: 1, s: 2 }, '0060: 올린 직원(Member)이 자기 결재 · 단계를 못 본다')
  assert.deepEqual(await sees(P.lead), { d: 1, s: 2 }, '0060: 결재선의 팀장(TeamLead)이 결재 · 단계를 못 본다')
  await sees(P.ceo) // BusinessCEO — 결재선 밖. 오류 없이 도는 것이 요구다(보이는 범위는 0026 · 0042 규칙).
  assert.deepEqual(await sees(P.clerk), { d: 1, s: 2 }, '0060: 결재 대장 열람자가 그 회사 결재를 못 본다')
  assert.deepEqual(await sees(P.other), { d: 0, s: 0 }, '0060: 결재선 밖 · 대장 권한 없는 직원이 남의 결재를 본다')

  const [n1] = await run<{ v: string }>(P.lead, `select approval_decide('dec_60a', true, null) as v`, true)
  assert.equal(n1.v, 'next', '0060: 팀장 승인이 BYPASSRLS 없는 소유자에서 대표 차례로 넘어가지 않는다')
  const [n2] = await run<{ v: string }>(P.chair, `select approval_decide('dec_60a', true, null) as v`, true)
  assert.equal(n2.v, 'approved', '0060: 대표 최종 승인이 BYPASSRLS 없는 소유자에서 안 된다')
  assert.deepEqual(await sees(P.mem), { d: 1, s: 2 }, '0060: 끝난 결재를 올린 직원이 못 본다')
  await run(P.clerk, `select approval_ledger_log('biz_dy', 1, '{}'::jsonb)::text as v`, true)
  await assert.rejects(run(P.other, `select approval_ledger_log('biz_dy', 1, '{}'::jsonb)::text as v`), /approval_not_found/,
    '0060: 대장 권한 없는 직원이 대장 내려받기 감사를 남긴다')

  // 고친 뒤에도 anon은 그대로 막혀 있다(결재가 생긴 뒤 한 번 더).
  assert.equal(await anonCount(db, 'decisions'), 0, '0060: 결재가 생긴 뒤 anon에게 decisions가 보인다')
  await assert.rejects(anonCount(db, 'approval_steps'), /permission denied for table/, '0060: anon에게 approval_steps 표 권한이 열렸다')
  await db.close()
  return tables.length
}

if (require.main === module) {
  anonHealth().then((n) => console.log(`PASS: anon health ${n}개 표 오류 없이 0행 · 직원/대표/대장 결재 경로(BYPASSRLS 없는 소유자) · 0059 대조군`))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
