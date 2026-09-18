import { parseEnv } from 'node:util'
import { readFileSync } from 'node:fs'

export const LOCAL_URL = 'http://127.0.0.1:55431'
export const PROJECT = 'chairman-os-d17'

// Remote project references. These are identifiers, not secrets — they exist here so that a
// mistyped env file or a leftover link cannot decide which database a migration lands in.
export const PRODUCTION_REF = 'nndvspgnljivkvihxlzj'
export const STAGING_REF = 'itpenmxyracfhyormcep'
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`

export function identifyEnvironment(env) {
  const kind = env.CHAIRMAN_ENV
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  if (kind === 'production') return 'production'
  if (kind === 'local' && url === LOCAL_URL) return 'local'
  // A label alone is not permission to write to a remote project.
  if (kind === 'test' || kind === 'staging') return 'test-unverified'
  return 'unknown'
}

export function assertLocal(env) {
  if (identifyEnvironment(env) !== 'local') {
    throw new Error('Refused: validation requires the exact D-17 local target; production/test/unknown targets are forbidden.')
  }
  for (const key of ['SUPABASE_DB_URL', 'DATABASE_URL', 'SUPABASE_DB_PASSWORD',
    'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_ID', 'SUPABASE_PROJECT_REF',
    'SUPABASE_WORKDIR', 'SUPABASE_SERVICE_ROLE_KEY', 'DOCKER_HOST', 'DOCKER_CONTEXT']) {
    if (env[key]) throw new Error(`Refused: ${key} must be unset for isolated validation.`)
  }
}

export function loadLocalTarget(ambient = process.env) {
  const file = parseEnv(readFileSync(new URL('../.env.validation.local', import.meta.url), 'utf8'))
  // Ambient production labels/targets must not be silently overridden by the file.
  for (const key of ['CHAIRMAN_ENV', 'NEXT_PUBLIC_SUPABASE_URL']) {
    if (ambient[key] && ambient[key] !== file[key]) throw new Error('Refused: conflicting target environment.')
  }
  const env = { ...ambient, ...file }
  assertLocal(env)
  return env
}

export function assertDockerEndpoint(host) {
  if (!['unix:///var/run/docker.sock', 'npipe:////./pipe/docker_engine',
    'npipe:////./pipe/dockerDesktopLinuxEngine'].includes(host)) {
    throw new Error('Refused: Docker endpoint is not an approved local socket.')
  }
}

export function childEnvironment(env) {
  // Do not forward database credentials, cloud tokens, env-file loaders or Docker overrides.
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|ProgramFiles|ProgramData)$/i.test(key)))
}

// --- staging release path -------------------------------------------------
// A remote push is judged on the file's text, not only on its parsed values: a duplicated key
// parses cleanly and silently hands the target to whichever line happens to come last.
export function assertStagingFile(text) {
  if (text.includes(PRODUCTION_REF)) {
    throw new Error(`Refused: the staging env file still mentions the production project (${PRODUCTION_REF}). Delete those lines; a copied file is not a staging file.`)
  }
  for (const key of ['CHAIRMAN_ENV', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_DB_PASSWORD']) {
    const defined = text.split('\n').filter((line) => line.trimStart().startsWith(`${key}=`)).length
    if (defined > 1) throw new Error(`Refused: ${key} is defined ${defined} times; the last line would decide the target without saying so.`)
  }
  const env = parseEnv(text)
  if (env.CHAIRMAN_ENV !== 'staging') throw new Error('Refused: CHAIRMAN_ENV must be exactly "staging" in the staging env file.')
  if (env.NEXT_PUBLIC_SUPABASE_URL !== STAGING_URL) throw new Error('Refused: NEXT_PUBLIC_SUPABASE_URL is not the staging project URL.')
  if (!env.SUPABASE_DB_PASSWORD) throw new Error('Refused: SUPABASE_DB_PASSWORD is empty; the CLI would fall back to an interactive prompt.')
  return env
}

// The link state on disk is the last word — an env file cannot vouch for what the CLI is pointed at.
export function assertLinkedRef(ref) {
  if (ref === PRODUCTION_REF) throw new Error(`Refused: the workdir is linked to production (${PRODUCTION_REF}). Nothing was pushed.`)
  if (ref !== STAGING_REF) throw new Error(`Refused: linked project is ${ref || 'absent'}, not staging (${STAGING_REF}). Nothing was pushed.`)
}

export function remoteEnvironment(env) {
  // The same allowlist as local validation, plus only the secret the CLI needs to reach the linked project.
  const child = childEnvironment(env)
  if (env.SUPABASE_DB_PASSWORD) child.SUPABASE_DB_PASSWORD = env.SUPABASE_DB_PASSWORD
  return child
}
