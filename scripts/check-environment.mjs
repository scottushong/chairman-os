import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { identifyEnvironment } from './db-safety.mjs'

try {
  if (process.argv.length !== 3) throw new Error('Usage: npm run env:check -- <env-file>')
  const kind = identifyEnvironment(parseEnv(readFileSync(process.argv[2], 'utf8')))
  console.log(`Environment file classification: ${kind}. Values are not printed; no network request made.`)
  if (kind === 'unknown') process.exitCode = 1
} catch { console.error('Environment inspection failed. Supply an existing env file; no values logged.'); process.exitCode = 1 }
