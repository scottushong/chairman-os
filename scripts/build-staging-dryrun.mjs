/**
 * staging 미리 돌려 보기 SQL을 만든다 — 대기 중인 마이그레이션 여러 개를 **한 트랜잭션**으로 실행하고 끝에 일부러 오류를 내 전부 되돌린다.
 * Supabase의 postgres(superuser 아님)로 실제로 돌려 보는 유일한 길이다(PGlite는 superuser라 «permission denied»를 못 잡는다 — 2026-10-14 0071).
 *
 *   node scripts/build-staging-dryrun.mjs 0071 0081
 *   → supabase/.temp/dryrun_0071_0081.sql (gitignore 자리 — 저장소에 남지 않는다)
 *   SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db query --linked -f "supabase/.temp/dryrun_0071_0081.sql"
 * 기대: ERROR … «0071-0081 DRYRUN PASS (11 files)». 다른 ERROR면 그 문장이 그 파일의 실패다(staging은 그대로).
 *
 * 각 파일의 맨 바깥 «begin;» · «commit;» 줄만 걷는다(그 밖의 트랜잭션 줄이 있으면 멈춘다).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [from, to] = process.argv.slice(2)
if (!/^\d{4}$/.test(from ?? '') || !/^\d{4}$/.test(to ?? '') || from > to) {
  console.error('쓰는 법: node scripts/build-staging-dryrun.mjs <처음 번호> <끝 번호>   예) 0071 0081')
  process.exit(2)
}
const dir = join(root, 'supabase', 'migrations')
// --skip=0087[,…]: 범위 안이지만 staging에 이미 들어간 번호(순서 밖 반영 — 2026-10-20 0086 · 0088이 0087 뒤에 들어감)는 빼고 돌린다.
const skip = new Set((process.argv.find((a) => a.startsWith('--skip='))?.slice(7) ?? '').split(',').filter(Boolean))
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) >= from && f.slice(0, 4) <= to && !skip.has(f.slice(0, 4))).sort()
if (files.length === 0) {
  console.error(`${from}~${to} 마이그레이션이 없다`)
  process.exit(2)
}
const parts = ['-- 자동 생성(scripts/build-staging-dryrun.mjs) — 한 트랜잭션 · 끝에 일부러 오류 · 전부 되돌림. 손으로 고치지 않는다.', 'begin;']
for (const f of files) {
  const lines = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').split('\n')
  const tx = lines.map((l, i) => [l.trim().toLowerCase(), i]).filter(([l]) => /^(begin|commit|rollback|start transaction);$/.test(l))
  if (tx.length !== 2 || tx[0][0] !== 'begin;' || tx[1][0] !== 'commit;') {
    console.error(`${f}: 맨 바깥 begin; · commit; 한 쌍이 아니다 — 손으로 본다`)
    process.exit(1)
  }
  const drop = new Set(tx.map(([, i]) => i))
  // --tests-only: 마이그레이션이 이미 staging에 들어간 뒤 — 시험만 한 트랜잭션으로(끝에 되돌림).
  if (!process.argv.includes('--tests-only')) parts.push(`-- ===== ${f} =====`, lines.filter((_, i) => !drop.has(i)).join('\n'))
}
// --tests: 같은 트랜잭션 안에서 그 번호들의 staging 시험(docs/onboarding/staging-tests/NNNN_staging_test.sql)도 돌린다.
// 시험의 do 블록을 pg_temp 함수로 바꾸고, 그 함수가 던지는 «NNNN STAGING PASS …»만 잡는다(하위 트랜잭션 — 시험이 바꾼 것은 되돌아간다).
// 다른 오류(FAIL …)는 그대로 던져 전체가 멈춘다.
let nTests = 0
if (process.argv.includes('--tests') || process.argv.includes('--tests-only')) {
  parts.push('create temp table dryrun_results (n text primary key, msg text not null);')
  const tdir = join(root, 'docs', 'onboarding', 'staging-tests')
  for (const f of files) {
    const n = f.slice(0, 4)
    const tf = readdirSync(tdir).find((x) => x === `${n}_staging_test.sql`)
    if (!tf) continue
    const lines = readFileSync(join(tdir, tf), 'utf8').replace(/\r\n/g, '\n').split('\n')
    const open = lines.findIndex((l) => l.trim() === 'do $t$')
    const close = lines.findIndex((l) => l.trim() === '$t$;')
    if (open < 0 || close < open || lines.filter((l) => l.trim() === 'do $t$').length !== 1) {
      console.error(`${tf}: «do $t$ … $t$;» 한 덩어리가 아니다 — 손으로 본다`)
      process.exit(1)
    }
    // 0071 시험은 AI Agent 계정이 있어야 한다. staging에 없으면 이 트랜잭션 안에서만 하나 만든다(끝에 되돌아간다 — PGlite 하네스와 같은 모양).
    if (n === '0071') parts.push(
      `do $a$ begin if not exists (select 1 from public.user_profiles where role::text = 'AIAgent' and revoked_at is null) then`,
      `  insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000061c005', 'dryrun-agent@example.com');`,
      `  insert into public.user_profiles (user_id, role, display_name, max_security_class) values ('00000000-0000-0000-0000-00000061c005', 'AIAgent', 'AI Agent', 'Restricted');`,
      `end if; end $a$;`)
    parts.push(`-- ===== 시험 ${tf} =====`,
      `create function pg_temp.dryrun_${n}() returns void language plpgsql as $t$`, ...lines.slice(open + 1, close), '$t$;',
      `do $w$ begin perform pg_temp.dryrun_${n}(); raise exception 'FAIL ${n}: 시험이 PASS 오류 없이 끝났다';`,
      `exception when others then if sqlerrm like '${n} STAGING PASS%' then insert into dryrun_results values ('${n}', sqlerrm); else raise; end if; end $w$;`)
    nTests += 1
  }
}
parts.push(nTests
  ? `do $dry$ begin raise exception '${from}-${to} ${process.argv.includes('--tests-only') ? 'TESTS' : 'DRYRUN'} PASS (${process.argv.includes('--tests-only') ? 0 : files.length} files · tests %/${nTests} · %)', (select count(*) from dryrun_results), (select string_agg(n, ',' order by n) from dryrun_results); end $dry$;`
  : `do $dry$ begin raise exception '${from}-${to} DRYRUN PASS (${files.length} files)'; end $dry$;`, 'rollback;', '')
const out = join(root, 'supabase', '.temp', `dryrun_${from}_${to}${process.argv.includes('--tests-only') ? '_tests_only' : nTests ? '_tests' : ''}.sql`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, parts.join('\n'))
console.log(`${out} — ${files.length}개: ${files.join(', ')}`)
