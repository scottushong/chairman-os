/** Called only by the guarded local runner. Credentials arrive on stdin and are never printed. */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseRepository } from '../src/lib/repository/supabase'

async function main() {
  const { url, anon, secret } = JSON.parse(readFileSync(0, 'utf8')) as Record<string, string>
  if (url !== 'http://127.0.0.1:55431' || !anon || !secret) throw new Error('Refused: invalid local target')
  const safeFetch: typeof fetch = (input, init) => {
    const target = new URL(String(input))
    if (target.origin !== url) throw new Error('Refused: non-local request')
    return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) })
  }
  function client(actor?: number) {
    const now = Math.floor(Date.now() / 1000)
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: `00000000-0000-4000-8000-${String(actor).padStart(12, '0')}`,
      role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 300,
    })}`
    const token = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
    return createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: safeFetch, headers: actor ? { Authorization: `Bearer ${token}` } : {} },
    })
  }
  for (const [actor, expected] of [[1, 6], [2, 1], [3, 2], [4, 3], [5, 0]]) {
    assert.equal((await createSupabaseRepository(client(actor)).listDocuments()).length, expected)
  }
  const scoped = client(2)
  const raw = await scoped.from('tasks').select('task_id')
  assert.ifError(raw.error)
  assert.equal(raw.data?.length, 137, 'configured low PostgREST row cap is active')
  const repo = createSupabaseRepository(scoped)
  for (const [rows, key] of [
    [await repo.listTasks(), 'task_id'], [await repo.listProjects(), 'project_id'],
  ] as const) {
    assert.equal(rows.length, 1203)
    const ids = rows.map((r) => key === 'task_id' ? ('task_id' in r ? r.task_id : '') : ('project_id' in r ? r.project_id : ''))
    assert.equal(new Set(ids).size, 1203)
    assert.deepEqual(ids, [...ids].sort())
    assert.equal(rows.filter((r) => r.deadline === null).length, 601)
  }
  assert.equal((await createSupabaseRepository(client()).listTasks()).length, 0)
}
main().catch(() => { console.error('Local repository validation failed; no credentials logged.'); process.exitCode = 1 })
