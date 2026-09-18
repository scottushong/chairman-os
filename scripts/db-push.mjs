import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { PRODUCTION_REF, STAGING_REF, assertLinkedRef, assertStagingFile, remoteEnvironment } from './db-safety.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const refFile = join(root, 'supabase', '.temp', 'project-ref')

function linkedRef() {
  return existsSync(refFile) ? readFileSync(refFile, 'utf8').trim() : ''
}

// OPERATIONS 9.1 asks for separate accounts and secrets per environment. Shared ones are not a
// reason to stop a schema push, but they must not pass unremarked — key names only, never values.
function warnSharedSecrets(file) {
  const path = join(root, '.env.local')
  if (!existsSync(path)) return
  const production = parseEnv(readFileSync(path, 'utf8'))
  const shared = Object.keys(production).filter((key) => /PASSWORD|SECRET|KEY$/.test(key) && file[key] && file[key] === production[key])
  if (shared.length) console.log(`Warning: ${shared.join(', ')} hold the same value as .env.local (production). OPERATIONS 9.1 wants separate staging secrets.`)
}

// The pinned devDependency is the CLI this repo is tested against, so it wins over whatever the
// PATH happens to offer. Resolving a real file also keeps every argument in argv: Node refuses to
// spawn the .cmd shim of a global install without a shell, and a shell concatenates instead.
function resolveCli(env) {
  const local = join(root, 'node_modules', 'supabase')
  if (existsSync(join(local, 'package.json'))) {
    const bin = JSON.parse(readFileSync(join(local, 'package.json'), 'utf8')).bin
    const entry = join(local, typeof bin === 'string' ? bin : bin?.supabase ?? '')
    if (existsSync(entry)) return entry.endsWith('.js') ? [process.execPath, entry] : [entry]
  }
  if (process.platform !== 'win32') return ['supabase']
  const found = spawnSync('where', ['supabase'], { env, encoding: 'utf8' })
  const paths = found.status === 0 ? found.stdout.split('\n').map((line) => line.trim()).filter(Boolean) : []
  const path = paths.find((candidate) => candidate.toLowerCase().endsWith('.exe')) ?? paths[0]
  if (!path) return []
  return /\.(cmd|bat)$/i.test(path) ? [env.COMSPEC ?? 'cmd.exe', '/d', '/s', '/c', path] : [path]
}

function main() {
  if (process.argv.length !== 3 || process.argv[2] !== 'staging') {
    throw new Error('Usage: npm run db:push:staging (staging is the only target this command accepts; production goes through the OPERATIONS 9 release procedure)')
  }
  const file = assertStagingFile(readFileSync(join(root, '.env.staging.local'), 'utf8'))
  const env = remoteEnvironment({ ...process.env, ...file })
  const secrets = [file.SUPABASE_DB_PASSWORD, file.NEXT_PUBLIC_SUPABASE_ANON_KEY].filter(Boolean)
  const redact = (text) => secrets.reduce((carry, secret) => carry.split(secret).join('<redacted>'), text ?? '')

  function run([command, ...prefix], args, label) {
    const result = spawnSync(command, [...prefix, ...args], { cwd: root, env, input: '', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    // The password and anon key are stripped before anything is printed; the CLI can echo a
    // connection string in an error path.
    const output = redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`).trim()
    if (output) console.log(output)
    if (result.error || result.status !== 0) throw new Error(`${label} failed (exited ${result.status ?? 'without running'}).`)
    return output
  }

  const cli = resolveCli(env)
  const installHint = 'Supabase CLI not available. Run `npm install` (it is a pinned devDependency) and `npx supabase login` once, then retry.'
  if (!cli.length) throw new Error(installHint)
  const version = spawnSync(cli[0], [...cli.slice(1), '--version'], { env, encoding: 'utf8' })
  if (version.error || version.status !== 0) throw new Error(installHint)
  const before = linkedRef()
  console.log(`Target: STAGING ${STAGING_REF}. Production (${PRODUCTION_REF}) is refused by this command.`)
  console.log(`Supabase CLI ${version.stdout.trim().replace(/[^\w. -]/g, '')}; workdir currently linked to ${before || 'nothing'}.`)
  if (before === PRODUCTION_REF) console.log('The production link will be replaced by the staging link. Relink deliberately before any production work.')
  warnSharedSecrets(file)

  console.log('\n[1/5] Migration check (PGlite, no network)')
  run([process.execPath], ['--import', 'tsx', 'scripts/check-migrations.ts'], 'check:migrations')

  console.log(`\n[2/5] Link to ${STAGING_REF}`)
  run(cli, ['link', '--project-ref', STAGING_REF], 'supabase link')

  console.log('\n[3/5] Verify the link before writing anything')
  const after = linkedRef()
  assertLinkedRef(after)
  console.log(`Linked project is ${after}. Confirmed staging.`)

  console.log('\n[4/5] Dry run — what would be applied')
  run(cli, ['db', 'push', '--linked', '--dry-run'], 'supabase db push --dry-run')

  console.log('\n[5/5] Push')
  run(cli, ['db', 'push', '--linked', '--yes'], 'supabase db push')

  console.log('\nApplied migrations on staging:')
  run(cli, ['migration', 'list', '--linked'], 'supabase migration list')
  console.log(`\nDone. Schema only — the three bootstrap files (OPERATIONS 2) still have to be run by hand in the ${STAGING_REF} SQL Editor.`)
}

try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
