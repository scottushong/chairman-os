// Runs the Supabase CLI for scripts/release-production.sh with three guards.
//
//   node scripts/supabase-guarded.mjs [--answer-y] [--timeout SEC] -- <supabase args…>
//
// 1. stdin is never the terminal. With --answer-y it gets exactly one "y\n" and is closed;
//    otherwise it is closed at once. No CLI prompt can wait on, or loop over, the keyboard.
// 2. A runaway — the same output line 20 times in a row, more than 2 MB of output, or more than
//    SEC seconds — kills the whole process tree (Windows: taskkill /T) and exits non-zero.
//    2026-10-06: the production push printed «y» endlessly in Git Bash until Ctrl+C.
// 3. Ctrl+C / TERM / HUP also kill the tree first, so no CLI is left talking to production.
//
// The CLI is started as `node node_modules/supabase/dist/supabase.js`, not `npx supabase`: on
// Windows npx goes through supabase.cmd (a cmd.exe batch), which adds its own «Terminate batch
// job (Y/N)?» prompt on Ctrl+C. `--agent no` makes the output the same text/table format in a
// real terminal and under Claude Code's `!` (which the CLI would otherwise detect as an agent
// and answer in JSON).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_REPEAT = 20
const MAX_BYTES = 2 * 1024 * 1024

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
if (sep === -1) {
  console.error('usage: supabase-guarded.mjs [--answer-y] [--timeout SEC] -- <supabase args…>')
  process.exit(2)
}
const own = argv.slice(0, sep)
const cliArgs = argv.slice(sep + 1)
const answerY = own.includes('--answer-y')
const timeoutIdx = own.indexOf('--timeout')
const timeoutSec = timeoutIdx === -1 ? 300 : Number(own[timeoutIdx + 1])
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
  console.error(`--timeout must be a positive number of seconds (got ${own[timeoutIdx + 1]})`)
  process.exit(2)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'node_modules', 'supabase', 'dist', 'supabase.js')
if (!existsSync(cli)) {
  console.error(`Supabase CLI not found: ${cli} — run npm install first.`)
  process.exit(2)
}

const child = spawn(process.execPath, [cli, '--agent', 'no', ...cliArgs], {
  cwd: root,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})
child.stdin.on('error', () => {})
child.stdin.end(answerY ? 'y\n' : '')

let stopping = null
function stop(reason, code) {
  if (stopping) return
  stopping = { reason, code }
  process.stderr.write(`\n[guard] ${reason} — CLI 프로세스를 강제 종료한다.\n`)
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    child.kill('SIGKILL')
  }
}

let bytes = 0
let lastLine = null
let repeat = 0
const pending = { stdout: '', stderr: '' }
function watch(name, chunk) {
  bytes += chunk.length
  if (bytes > MAX_BYTES) return stop(`출력이 ${MAX_BYTES} 바이트를 넘었다`, 3)
  const text = pending[name] + chunk.toString('utf8')
  const lines = text.split(/\r?\n|\r/)
  pending[name] = lines.pop() ?? ''
  for (const raw of lines) {
    const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim()
    if (line === '') continue
    repeat = line === lastLine ? repeat + 1 : 1
    lastLine = line
    if (repeat >= MAX_REPEAT) return stop(`같은 줄 «${line.slice(0, 60)}»이 ${MAX_REPEAT}번 연속 나왔다`, 3)
  }
}
child.stdout.on('data', (c) => { if (!stopping) { process.stdout.write(c); watch('stdout', c) } })
child.stderr.on('data', (c) => { if (!stopping) { process.stderr.write(c); watch('stderr', c) } })

const timer = setTimeout(() => stop(`${timeoutSec}초가 지났다`, 124), timeoutSec * 1000)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(`${sig}를 받았다`, 130))

child.on('error', (err) => {
  console.error(`Supabase CLI를 시작하지 못했다: ${err.message}`)
  process.exit(2)
})
child.on('close', (code, signal) => {
  clearTimeout(timer)
  if (stopping) process.exit(stopping.code)
  process.exit(code ?? (signal ? 1 : 0))
})
