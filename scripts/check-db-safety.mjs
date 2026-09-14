import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { assertLocal, assertDockerEndpoint, childEnvironment, identifyEnvironment, LOCAL_URL } from './db-safety.mjs'

const local = { CHAIRMAN_ENV: 'local', NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL }
assert.doesNotThrow(() => assertLocal(local))
for (const kind of [undefined, '', 'unknown', 'production', 'test', 'staging']) {
  assert.throws(() => assertLocal({ ...local, CHAIRMAN_ENV: kind }), /Refused/)
}
for (const url of [undefined, 'https://example.supabase.co', 'http://localhost:55431',
  'http://127.0.0.1:54321', `${LOCAL_URL}/`, `${LOCAL_URL}@example.invalid`, 'http://127.0.0.1:55431.evil.invalid']) {
  assert.throws(() => assertLocal({ ...local, NEXT_PUBLIC_SUPABASE_URL: url }), /Refused/)
}
for (const key of ['SUPABASE_DB_URL', 'DATABASE_URL', 'SUPABASE_DB_PASSWORD', 'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_ID', 'SUPABASE_PROJECT_REF', 'SUPABASE_WORKDIR', 'SUPABASE_SERVICE_ROLE_KEY',
  'DOCKER_HOST', 'DOCKER_CONTEXT']) {
  assert.throws(() => assertLocal({ ...local, [key]: 'redacted' }), /Refused/)
}
assert.equal(identifyEnvironment({ CHAIRMAN_ENV: 'production' }), 'production')
assert.equal(identifyEnvironment({ CHAIRMAN_ENV: 'staging' }), 'test-unverified')
for (const host of ['ssh://remote', 'tcp://127.0.0.1:2375', undefined]) assert.throws(() => assertDockerEndpoint(host))
assert.doesNotThrow(() => assertDockerEndpoint('unix:///var/run/docker.sock'))
assert.doesNotThrow(() => assertDockerEndpoint('npipe:////./pipe/dockerDesktopLinuxEngine'))
assert.deepEqual(childEnvironment({ PATH: 'test', SUPABASE_ACCESS_TOKEN: 'redacted', NODE_OPTIONS: 'redacted' }), { PATH: 'test' })
for (const args of [['reset', '--linked'], ['reset', '--db-url', 'redacted'], ['push'], ['reset', '--workdir', '..']]) {
  const result = spawnSync(process.execPath, ['scripts/local-db.mjs', ...args], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Usage:/)
}
for (const file of ['seed.sql', 'verify.sql']) {
  const sql = readFileSync(new URL(`../supabase/tests/${file}`, import.meta.url), 'utf8')
  assert.ok(sql.includes("current_setting('chairman.validation_environment', true) is distinct from 'local'"))
  assert.ok(sql.indexOf('Refused:') < sql.indexOf(file === 'seed.sql' ? 'truncate public' : 'create function'))
}
const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
assert.match(config, /project_id = "chairman-os-d17"/)
assert.match(config, /max_rows = 137/)
assert.match(config, /\[db.seed\][\s\S]*?enabled = false/)
console.log('PASS: local target, production/unknown/remote rejection, Docker isolation, secret stripping, CLI argument rejection, SQL guards, config invariants')
