import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, copyFileSync, existsSync, writeFileSync, rmSync, lstatSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { assertDockerEndpoint, childEnvironment, loadLocalTarget, PROJECT } from './db-safety.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(root, '.d17-local')
const action = process.argv[2]

function main() {
  if (process.argv.length !== 3 || !['inspect', 'start', 'reset', 'verify', 'stop'].includes(action)) {
    throw new Error('Usage: npm run db:local -- inspect|start|reset|verify|stop (no extra CLI arguments accepted)')
  }
  const env = childEnvironment(loadLocalTarget())
  function run(command, args, input) {
    const result = spawnSync(command, args, { cwd: root, env, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    // Never echo CLI status, SQL input, credentials or raw child errors.
    if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed; check local executable/runtime availability. Child output withheld to protect secrets.`)
    return result.stdout.trim()
  }
  const version = run('supabase', ['--version'])
  const context = run('docker', ['context', 'show'])
  const info = JSON.parse(run('docker', ['context', 'inspect', context]))
  assertDockerEndpoint(info[0]?.Endpoints?.docker?.Host)
  // Pin the inspected context on every Docker call and for Supabase's Docker client.
  env.DOCKER_HOST = info[0].Endpoints.docker.Host
  run('docker', ['info', '--format', '{{.ServerVersion}}'])
  console.log(`Target: LOCAL disposable ${PROJECT}; Supabase CLI ${version.replace(/[^\w. -]/g, '')}`)
  if (action === 'inspect') return

  if (existsSync(join(work, 'supabase', '.temp', 'project-ref'))) throw new Error('Refused: disposable workdir is linked to a remote project.')
  const localSupabase = join(work, 'supabase')
  const migrations = join(localSupabase, 'migrations')
  for (const path of [work, localSupabase, migrations, join(localSupabase, 'config.toml')]) {
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Refused: symlink in disposable workdir.')
  }
  if (action !== 'stop') rmSync(join(work, 'last-validation.json'), { force: true })
  mkdirSync(migrations, { recursive: true })
  // Only our generated migration-copy directory is cleaned; never source/history.
  if (resolve(migrations) !== join(root, '.d17-local', 'supabase', 'migrations')) throw new Error('Unsafe workdir')
  for (const file of readdirSync(migrations)) {
    if (!/^\d+_[\w-]+\.sql$/.test(file)) throw new Error('Unexpected file in disposable migrations')
    rmSync(join(migrations, file))
  }
  const names = readdirSync(join(root, 'supabase', 'migrations')).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
  for (const name of names) copyFileSync(join(root, 'supabase', 'migrations', name), join(migrations, name))
  copyFileSync(join(root, 'supabase', 'config.toml'), join(localSupabase, 'config.toml'))
  function cli(...args) { return run('supabase', [...args, '--workdir', work]) }
  function sql(file) {
    return run('docker', ['exec', '-i', `supabase_db_${PROJECT}`, 'psql', '-X', '-h', '/var/run/postgresql', '-p', '5432', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
      `set chairman.validation_environment = 'local';\n${readFileSync(join(root, file), 'utf8')}`)
  }
  if (action === 'stop') { cli('stop'); console.log('Local stack stopped; no remote action.'); return }
  if (action === 'start') cli('start')
  if (action === 'reset') cli('db', 'reset', '--local', '--no-seed', '--yes')
  if (action === 'start' || action === 'reset') sql('supabase/tests/seed.sql')
  if (action === 'verify') {
    sql('supabase/tests/verify.sql')
    let status
    try { status = JSON.parse(cli('status', '-o', 'json')) }
    catch { throw new Error('Unable to read local CLI status; output withheld to protect secrets.') }
    if (status.API_URL !== 'http://127.0.0.1:55431' || !status.JWT_SECRET || !status.ANON_KEY) {
      throw new Error('Local status lacks the expected URL / legacy JWT test credentials; see OPERATIONS prerequisites.')
    }
    // Feed secrets over stdin, never arguments, logs, or a file. No service role is used.
    run(process.execPath, ['--import', 'tsx', 'scripts/check-local-repository.ts'],
      JSON.stringify({ url: status.API_URL, anon: status.ANON_KEY, secret: status.JWT_SECRET }))
    writeFileSync(join(work, 'last-validation.json'), JSON.stringify({
      environment: 'local', validatedAt: new Date().toISOString(),
      commit: run('git', ['rev-parse', 'HEAD']), cliVersion: version, migrations: names,
      checks: ['RLS SQL', 'authenticated PostgREST pagination/null deadlines'],
    }, null, 2))
    console.log('PASS: local RLS and authenticated repository checks; evidence in .d17-local/last-validation.json')
  } else console.log('Local schema and synthetic fixtures ready. Run verify next.')
}
try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
