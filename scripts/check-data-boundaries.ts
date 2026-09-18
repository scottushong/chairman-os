/** Offline P0-07 regression checks: npm exec -- tsx scripts/check-data-boundaries.ts */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createClient } from '@supabase/supabase-js'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { WaitingOnMe } from '../src/components/dashboard/waiting-on-me'
import { compareDeadlines, dDay, formatDDay, isOverdue } from '../src/lib/format'
import { dummyRepository } from '../src/lib/repository/dummy'
import { createSupabaseRepository } from '../src/lib/repository/supabase'
import type { ChairmanRepository } from '../src/lib/repository/types'
import type { Business, Project, Task } from '../src/types'

type Row = Record<string, string | number | boolean | null | string[]>
type Fault = 'error' | 'count' | 'duplicate' | 'empty' | 'missing-count'
const SIZE = 1203
const records = (make: (i: number) => Row) => Array.from({ length: SIZE }, (_, i) => make(i)).reverse()
const id = (i: number) => String(i).padStart(4, '0')
const tables: Record<string, Row[]> = {
  tasks: records((i) => ({ task_id: id(i), project_id: '0000', title: `Task ${i}`,
    owner_user_id: id(i), priority: 'High', status: 'Todo', blocked_since: '2026-09-01',
    deadline: i % 2 ? '2026-09-30' : null, chairman_needed: true })),
  projects: records((i) => ({ project_id: id(i), business_id: '0000', name: `Project ${i}`,
    owner_user_id: id(i), priority: 'High', status: 'Todo', progress_pct: 0, deadline: null })),
  businesses: records((i) => ({ business_id: id(i), name: `Business ${i}`, status: 'Active',
    industry: '', owner_user_id: null, visible: true, sort_order: i, pinned: false })),
  user_profiles: records((i) => ({ user_id: id(i), display_name: `Owner ${i}`, role: 'Chairman',
    title_ko: null, max_security_class: 'Vault', revoked_at: null, created_at: '2026-09-01' })),
  user_business_access: records((i) => ({ user_id: '0000', business_id: id(i) })),
  finance_kpis: records((i) => ({ period: '2026-09', business_id: id(i), metric: 'EBITDA',
    value: '280000000', target: null, currency: 'KRW', source: 'ecount', closed: false,
    fetched_at: '2026-09-16T14:00:00Z', basis: 'provisional' })),
  // 0015 원장. id·키가 뒤섞여 들어와도 fetchAll이 끝까지 읽는지 본다.
  accounts: records((i) => ({ business_id: '0000', account_code: id(i), name: `Account ${i}`,
    category: 'other', section: 'sga', cash_flow: null, source: 'ecount',
    fetched_at: '2026-09-16T14:00:00Z', closed: true })),
  journal_lines: records((i) => ({ id: i, business_id: '0000', entry_date: '2026-08-25',
    account_code: id(i), amount: '1000.00', side: i % 2 ? 'debit' : 'credit', slip_no: `S-${i}`,
    line_no: 1, memo: '', source: 'ecount', fetched_at: '2026-09-16T14:00:00Z', closed: false })),
  journal_entries: records((i) => ({ business_id: '0000', slip_no: `M2608-${id(i)}`, entry_date: '2026-08-25',
    memo: `Entry ${i}`, evidence_url: null, created_by: id(i), created_at: '2026-09-16T14:00:00Z',
    corrects_id: null, correction_kind: null })),
  closings: records((i) => ({ business_id: '0000', period: '2026-07', account_code: id(i),
    amount: '-500.50', closed_on: '2026-08-10', provisional_amount: i % 3 ? null : '-400',
    source: 'ecount', fetched_at: '2026-09-16T14:00:00Z', closed: true })),
  fx_rates: records((i) => ({ rate_date: `2020-01-01+${id(i)}`, base: 'USD', quote: 'KRW',
    rate: '1390.5', source_name: 'x', source: 'manual', fetched_at: '2026-09-16T14:00:00Z', closed: true })),
  cost_indices: records((i) => ({ index_code: 'cpi', index_date: id(i), value: '101.25', unit: '',
    source_name: 'x', source: 'manual', fetched_at: '2026-09-16T14:00:00Z', closed: false })),
  business_keymen: records((i) => ({ keyman_id: id(i), business_id: '0000', name: `Keyman ${i}`,
    relation: '', last_contact_on: i % 2 ? '2026-09-01' : null, note: '' })),
  documents: records((i) => ({ document_id: id(i), business_id: '0000', title: `Doc ${i}`,
    doc_type: 'Report', security_class: 'General', storage_url: 'https://example.invalid',
    version: 1, uploaded_by: id(i), created_at: i < 600 ? '2026-09-01' : '2026-09-02' })),
  decisions: records((i) => ({ decision_id: id(i), business_id: '0000', title: `Decision ${i}`,
    options: ['A'], ai_recommendation: null, impact: 'High', deadline: '2026-09-30',
    status: 'Open', ai_confidence: null, attachment_url: null })),
  alerts: records((i) => ({ alert_id: id(i), business_id: '0000', category: 'Finance',
    message: `Alert ${i}`, severity: 'High', source: 'Rule', status: 'Open' })),
  goals: records((i) => ({ goal_id: id(i), business_id: null, title: `Goal ${i}`,
    target_value: '', current_value: '', progress_pct: 0, due: '2026-09-30' })),
  monthly_priorities: records((i) => ({ priority_id: id(i), business_id: null,
    title: `Priority ${i}`, detail: '', owner_user_id: id(i), weight: 'High' })),
  critical_risks: records((i) => ({ risk_id: id(i), business_id: null,
    title: `Risk ${i}`, detail: '', impact: 'High', urgency: 'High' })),
  milestones: records((i) => ({ milestone_id: id(i), business_id: null,
    title: `Milestone ${i}`, owner_user_id: id(i), deadline: '2026-09-30' })),
  business_strategy: records((i) => ({ business_id: id(i), mission: '', goal_1y: '', goal_3y: '',
    top_kpi: '', current_position: '', target_position: '', gap: '', current_priority: '',
    bottleneck: '', chairman_comment: '' })),
  ai_night_outputs: records((i) => ({ output_id: id(i), business_id: id(i), job_type: 'Report',
    result_summary: '', status: 'Done', artifact_link: null, confidence: null,
    completed_at: '2026-09-01T00:00:00Z' })),
  audit_log: records((i) => ({ id: i, entity_table: 'decisions', entity_id: '0000',
    action: 'approve', occurred_at: '2026-09-01T00:00:00Z', actor_user_id: id(i),
    actor_role: 'Chairman', before: null, after: null, note: null })),
  user_invitations: records((i) => ({ invitation_id: id(i), email: `${i}@example.invalid`,
    role: 'Chairman', max_security_class: 'Vault', business_ids: null, display_name: '',
    title_ko: null, invited_at: '2026-09-01', accepted_at: null, revoked_at: null })),
  // Phase 4-A (0017). listInitiatives() is a single unranged select (chairman_projects'
  // pattern — "dozens, not thousands") and is covered separately in checkInitiatives(),
  // not through checkPagination()'s row-cap-busting fixture(). Kept here anyway so both
  // checks share one fixture table.
  initiatives: records((i) => ({ initiative_id: `ini_${id(i)}`, title: `Initiative ${i}`,
    kind: 'Deal', business_id: i % 2 ? id(i) : null, stage: 'Execution', goal: '',
    target_date: i % 3 ? '2026-12-31' : null, next_action: `Action ${i}`,
    next_action_date: i % 2 ? '2026-09-30' : null, next_action_owner: '', blocker: '',
    status: 'Active', updated_at: '2026-09-16T00:00:00Z' })),
  initiative_keymen: records((i) => ({ keyman_id: id(i), initiative_id: `ini_${id(i)}`,
    name: `Keyman ${i}`, relation: '', channel: 'KakaoTalk',
    last_contact_on: i % 2 ? '2026-09-01' : null, note: '' })),
  initiative_docs: records((i) => ({ doc_id: id(i), initiative_id: `ini_${id(i)}`,
    title: `Doc ${i}`, url: 'https://example.invalid' })),
  events: records((i) => ({ event_id: id(i), title: `Event ${i}`, starts_on: '2026-09-01',
    ends_on: i % 2 ? '2026-09-03' : null, kind: 'Trip',
    initiative_id: i % 2 ? `ini_${id(i)}` : null, business_id: i % 3 ? id(i) : null,
    location: '', note: '' })),
  // calendar_items is a view over four sources; source_id is only unique per kind
  // (an event_id and an initiative_id can coincide). Every 4 rows share one source_id
  // across the four kinds — this is the exact shape listCalendarItems must not drop rows from.
  calendar_items: records((i) => ({
    kind: (['event', 'next_action', 'milestone', 'decision'] as const)[i % 4],
    source_id: id(Math.floor(i / 4)), title: `Calendar ${i}`, on_date: '2026-09-15',
    ends_on: i % 5 === 0 ? '2026-09-17' : null, business_id: i % 3 === 0 ? id(i) : null,
    initiative_id: i % 2 === 0 ? `ini_${id(i)}` : null, href: '/calendar' })),
}

function fixture(cap: number, fault?: Fault, source = tables) {
  const requests: URL[] = []
  const client = createClient('https://offline.invalid', 'offline-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input))
      requests.push(url)
      const table = url.pathname.split('/').at(-1)!
      assert.ok(source[table], `Unexpected table ${table}`)
      const from = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit'))
      assert.ok(limit > 0, 'Every list must have an explicit batch range')
      const orders = url.searchParams.get('order')?.split(',') ?? []
      const exact = new Headers(init?.headers).get('prefer')?.includes('count=exact')
      if (exact) assert.ok(orders.length, 'Pagination requires deterministic ordering')
      let all = [...source[table]]
      for (const [key, value] of url.searchParams) {
        if (value.startsWith('eq.')) all = all.filter((r) => String(r[key]) === value.slice(3))
        if (value.startsWith('in.(')) all = all.filter((r) => value.slice(4, -1).split(',').includes(String(r[key])))
      }
      all.sort((a, b) => {
        for (const order of orders) {
          const [key, direction] = order.split('.')
          const x = a[key], y = b[key]
          const cmp = x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1
          if (cmp) return direction === 'desc' ? -cmp : cmp
        }
        return 0
      })
      if (fault === 'error' && from > 0) {
        return new Response(JSON.stringify({ code: '42501', message: 'page denied' }), { status: 403 })
      }
      let page = all.slice(from, from + Math.min(cap, limit))
      if (from > 0 && fault === 'duplicate') page[0] = all[0]
      if (from > 0 && fault === 'empty') page = []
      // PostgREST sends only selected fields, including explicitly requested identities.
      const columns = url.searchParams.get('select')!
      if (columns !== '*') page = page.map((r) => Object.fromEntries(columns.split(',').map((k) => [k, r[k]])))
      const count = all.length + (from > 0 && fault === 'count' ? 1 : 0)
      return new Response(JSON.stringify(page), { status: 200, headers: {
        'content-type': 'application/json',
        'content-range': `${from}-${from + page.length - 1}/${exact && fault !== 'missing-count' ? count : '*'}`,
      } })
    } },
  })
  return { repo: createSupabaseRepository(client), requests }
}

async function checkPagination() {
  const { repo, requests } = fixture(137) // Deliberately below both 500 and Supabase's usual 1000.
  const tasks = await repo.listTasks()
  assert.equal(tasks.length, SIZE)
  assert.deepEqual(tasks.map((t) => t.task_id), Array.from({ length: SIZE }, (_, i) => id(i)))
  assert.equal(tasks.at(-1)?.owner, `Owner ${SIZE - 1}`, 'Name cache must also paginate')
  assert.equal(tasks[0].deadline, null)
  const taskRequests = requests.filter((u) => u.pathname.endsWith('/tasks'))
  assert.deepEqual(taskRequests.map((u) => Number(u.searchParams.get('offset'))),
    Array.from({ length: Math.ceil(SIZE / 137) }, (_, i) => i * 137))
  assert.equal(new Set(tasks.map((t) => t.task_id)).size, SIZE)
  const projects = await repo.listProjects()
  assert.equal(projects.length, SIZE)
  assert.equal(projects[0].deadline, null)
  const finance = await repo.listFinanceKpis()
  assert.equal(finance.length, SIZE)
  assert.ok(finance.every((r) => r.value === 280000000))
  assert.ok(finance.every((r) => r.source === 'ecount' && r.closed === false && r.basis === 'provisional'), 'Provenance must survive the read')
  const ledger = await repo.loadFinanceLedger()
  for (const [key, rows] of Object.entries(ledger)) assert.equal(rows.length, SIZE, `ledger.${key} must paginate`)
  assert.ok(ledger.journal.every((j) => j.amount === 1000 && !('id' in j)), 'numeric strings become numbers')
  assert.equal(ledger.closings.filter((c) => c.provisional_amount === null).length, SIZE - Math.ceil(SIZE / 3))
  assert.ok(ledger.closings.every((c) => c.amount === -500.5))
  assert.equal((await repo.listKeymen()).length, SIZE)
  const docs = await repo.listDocuments()
  assert.equal(docs.length, SIZE)
  assert.deepEqual(docs.map((d) => d.document_id),
    [...Array.from({ length: SIZE - 600 }, (_, i) => id(i + 600)), ...Array.from({ length: 600 }, (_, i) => id(i))])
  assert.equal((await repo.listDecisionAudit()).length, SIZE)
  const audit = await repo.listEntityAudit('decisions', '0000')
  assert.deepEqual(audit.map((a) => a.id), Array.from({ length: SIZE }, (_, i) => SIZE - 1 - i))
  assert.equal((await repo.listEntityAudit('tasks', 'missing')).length, 0)
  const accounts = await repo.listUserAccounts()
  assert.equal(accounts.length, SIZE)
  assert.equal(accounts[0].business_ids.length, SIZE, 'Composite-key access list must be complete')
  for (const read of [repo.listBusinesses, repo.listDecisions, repo.listAlerts, repo.listTopGoals,
    repo.listMonthlyPriorities, repo.listCriticalRisks, repo.listNextMilestones,
    repo.listBusinessStrategy, repo.listUserInvitations, repo.listAiNightOutputs]) {
    assert.equal((await read()).length, SIZE)
  }
  const hits = await repo.search('Task', 3)
  assert.equal(hits.length, 15, 'Search remains bounded to three per kind')
  for (const cap of [1, 500]) {
    const small = { ...tables, alerts: tables.alerts.slice(0, cap === 1 ? 3 : 1000) }
    assert.equal((await fixture(cap, undefined, small).repo.listAlerts()).length, small.alerts.length)
  }
  assert.deepEqual(await fixture(137, undefined, { ...tables, alerts: [] }).repo.listAlerts(), [])
  for (const fault of ['error', 'count', 'duplicate', 'empty', 'missing-count'] as const) {
    await assert.rejects(fixture(137, fault).repo.listAlerts(), /Supabase alerts/, fault)
  }

  // Phase 4-A (0017). listInitiativeKeymen/listInitiativeDocs/listEvents all use the same
  // fetchAll+range helper as the tables above, so they get the same >1000-row/dedup coverage.
  const keymen = await repo.listInitiativeKeymen()
  assert.equal(keymen.length, SIZE)
  assert.ok(keymen.some((k) => k.last_contact_on === null), 'nullable last_contact_on must survive as null')
  assert.ok(keymen.every((k) => k.last_contact_on !== undefined && k.last_contact_on !== ''))

  const docs2 = await repo.listInitiativeDocs()
  assert.equal(docs2.length, SIZE)

  const events = await repo.listEvents()
  assert.equal(events.length, SIZE)
  assert.ok(events.some((e) => e.ends_on === null), 'nullable ends_on must survive as null')
  assert.ok(events.some((e) => e.business_id === null), 'nullable business_id must survive as null')
  assert.ok(events.some((e) => e.initiative_id === null), 'nullable initiative_id must survive as null')
  assert.ok(events.every((e) =>
    e.ends_on !== undefined && e.business_id !== undefined && e.initiative_id !== undefined))

  // calendar_items dedupes on the composite key (kind, source_id) — a view row's identity is
  // both together, because an event_id and an initiative_id can be the same string. If the
  // client ever narrows the identity to source_id alone, rows with a colliding source_id
  // under a different kind would be treated as duplicates and dropped. Nothing else catches this.
  const calendarItems = await repo.listCalendarItems('2020-01-01', '2030-01-01')
  assert.equal(calendarItems.length, SIZE, 'no row may be dropped when source_id repeats across kinds')
  assert.equal(new Set(calendarItems.map((c) => `${c.kind}:${c.source_id}`)).size, SIZE,
    'every (kind, source_id) pair is its own identity')
  const kindsBySource = new Map<string, Set<string>>()
  for (const c of calendarItems) {
    if (!kindsBySource.has(c.source_id)) kindsBySource.set(c.source_id, new Set())
    kindsBySource.get(c.source_id)!.add(c.kind)
  }
  assert.ok([...kindsBySource.values()].some((kinds) => kinds.size > 1),
    'fixture must actually exercise a source_id shared across different kinds')
  assert.ok(calendarItems.some((c) => c.ends_on === null))
  assert.ok(calendarItems.some((c) => c.business_id === null))
  assert.ok(calendarItems.some((c) => c.initiative_id === null))

  console.log('PASS: all list reads, >1000 rows, lowered server cap, tied sort keys, unique rows, exact/empty pages, errors, bounded search, initiative keymen/docs/events, calendar_items composite-key dedup')
}

/**
 * Phase 4-A (0017). listInitiatives() is a single `.select()` with no `.range()` — the same
 * "chairman's own list is dozens, not thousands" pattern as listChairmanProjects (0014), which
 * this suite has never covered for the same reason. It cannot go through checkPagination()'s
 * fixture(): that mock asserts every request carries an explicit limit/offset (the whole point
 * of this file), and a request with neither would be rejected before ever reaching the
 * assertions below. So this uses its own minimal single-page mock instead, to check what
 * actually matters for an unranged read: nullable fields still round-trip as null, and nothing
 * silently drops rows while the table sits below whatever cap the real server would apply.
 */
async function checkInitiatives() {
  const source = tables.initiatives
  const client = createClient('https://offline.invalid', 'offline-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input))
      const table = url.pathname.split('/').at(-1)!
      assert.equal(table, 'initiatives', `checkInitiatives only mocks initiatives, got ${table}`)
      assert.equal(url.searchParams.get('limit'), null, 'listInitiatives must stay unranged (no .range()) — update this check if that changes')
      const orders = url.searchParams.get('order')?.split(',') ?? []
      const all = [...source].sort((a, b) => {
        for (const order of orders) {
          const [key] = order.split('.')
          const x = a[key], y = b[key]
          const cmp = x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1
          if (cmp) return cmp
        }
        return 0
      })
      return new Response(JSON.stringify(all), { status: 200, headers: { 'content-type': 'application/json' } })
    } },
  })
  const repo = createSupabaseRepository(client)
  const initiatives = await repo.listInitiatives()
  assert.equal(initiatives.length, SIZE, 'a single unranged select must still return every row below the fixture size')
  assert.ok(initiatives.some((i) => i.target_date === null), 'nullable target_date must survive as null')
  assert.ok(initiatives.some((i) => i.next_action_date === null), 'nullable next_action_date must survive as null')
  assert.ok(initiatives.some((i) => i.business_id === null), 'nullable business_id must survive as null')
  assert.ok(initiatives.every((i) =>
    i.target_date !== undefined && i.next_action_date !== undefined && i.business_id !== undefined &&
    i.target_date !== '' && i.next_action_date !== '' && i.business_id !== ''),
    'nullable fields must never become undefined or empty string')
  // next_action_date nulls last (INITIATIVE_COLUMNS order clause) — nulls must not sort first.
  const firstNullIndex = initiatives.findIndex((i) => i.next_action_date === null)
  const lastDatedIndex = initiatives.reduce((last, i, idx) => (i.next_action_date !== null ? idx : last), -1)
  assert.ok(firstNullIndex > lastDatedIndex, 'every dated row must sort before every null row')
  console.log('PASS: listInitiatives (unranged) nullable round-trip and null-last ordering')
}

// Run the real page JSX offline with only its repository and interactive controls stubbed.
const requireFromHere = createRequire(resolve('scripts/check-data-boundaries.ts'))
async function renderPage(path: string, repo: ChairmanRepository) {
  const filename = resolve(path)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const exports: { default?: (props: { params: Promise<{ id: string }> }) => Promise<ReactNode> } = {}
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === '@/lib/repository') return { getRepository: async () => repo }
    if (name === '@/components/tasks/task-controls') return { TaskControls: () => null }
    return requireFromHere(name.startsWith('@/') ? resolve('src', name.slice(2)) : name)
  } }, { filename })
  return renderToStaticMarkup(await exports.default!({ params: Promise.resolve({ id: '0000' }) }))
}

async function checkNullDeadlines() {
  const today = new Date(2026, 8, 8)
  assert.equal(formatDDay(null, today), '—')
  assert.equal(isOverdue(null, today), false)
  assert.equal(formatDDay('2026-09-08', today), 'D-DAY')
  assert.equal(formatDDay('2026-09-07', today), 'D+1')
  assert.equal(dDay('2026-09-09', today), 1)
  assert.deepEqual([null, '2026-09-09', null, '2026-09-07'].sort(compareDeadlines),
    ['2026-09-07', '2026-09-09', null, null])
  const task: Task = { ...(await fixture(500).repo.listTasks())[0], title: 'No deadline task' }
  const project: Project = { ...(await fixture(500).repo.listProjects())[0], name: 'No deadline project' }
  const business: Business = (await fixture(500).repo.listBusinesses())[0]
  const repo: ChairmanRepository = { ...dummyRepository,
    listTasks: async () => [task, { ...task, task_id: '0001', deadline: '2026-09-30' }],
    listProjects: async () => [project], listBusinesses: async () => [business],
    listEntityAudit: async () => [],
  }
  for (const path of ['src/app/(dashboard)/tasks/[id]/page.tsx', 'src/app/(dashboard)/projects/[id]/page.tsx']) {
    const html = await renderPage(path, repo)
    assert.ok(html.includes('—'))
    assert.ok(!/NaN|Invalid Date|D-null/.test(html))
    assert.match(html, /마감<\/dt><dd[^>]*><span class="">—<\/span><\/dd>/)
  }
  const html = renderToStaticMarkup(createElement(WaitingOnMe, {
    tasks: await repo.listTasks(), projects: [project], businesses: [business],
  }))
  assert.ok(html.includes('—'))
  assert.ok(!/NaN|Invalid Date|D-null/.test(html))
  // Dummy adapter preserves nullable values supplied by its typed source, without new edit powers.
  const { tasks, projects } = requireFromHere('../src/data') as { tasks: Task[]; projects: Project[] }
  const taskDate = tasks[0].deadline, projectDate = projects[0].deadline
  try {
    tasks[0].deadline = null
    projects[0].deadline = null
    assert.equal((await dummyRepository.listTasks())[0].deadline, null)
    assert.equal((await dummyRepository.listProjects())[0].deadline, null)
  } finally {
    tasks[0].deadline = taskDate
    projects[0].deadline = projectDate
  }
  console.log('PASS: nullable live/dummy contracts, date sorting, task/project page rendering, Waiting on Me rendering')
}

async function main() {
  await checkPagination()
  await checkInitiatives()
  await checkNullDeadlines()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
