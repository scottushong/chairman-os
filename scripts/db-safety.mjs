import { parseEnv } from 'node:util'
import { readFileSync } from 'node:fs'

export const LOCAL_URL = 'http://127.0.0.1:55431'
export const PROJECT = 'chairman-os-d17'

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
