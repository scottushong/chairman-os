/**
 * 마이그레이션 검증 — Docker 없이 (D-17 보완): npm run check:migrations
 *
 * 이 PC에는 Docker가 없어 8절의 로컬 Supabase를 못 띄운다. 그래서 0015까지 원격에 먼저 적용된 뒤에야
 * SQL이 도는지 알 수 있었다. PGlite(WASM Postgres, 메모리 안에서만 산다)로 그 틈을 메운다.
 *
 *   1) 0001부터 마지막까지 번호순으로 전부 적용된다. (Supabase 전용 조각 — auth 스키마, auth.uid(),
 *      anon/authenticated 역할, extensions 스키마, pg_trgm — 만 흉내 낸다. 마이그레이션 파일은 고치지 않는다.)
 *   2) 원장이 비었을 때 finance_kpis 뷰 = 시트 480행, 전부 수기 꼬리표 (0015 ③).
 *   3) mock 원장을 넣으면 뷰(SQL)와 lib/ledger(TS)가 모든 행에서 같다 — 값·source·closed까지.
 *   4) RLS: 역할별로 되는 것/막히는 것 (Integration · AIAgent · GroupCFO · Member · Chairman).
 *
 * 못 재는 것: 실제 Supabase의 기본 GRANT, PostgREST, Auth. 운영 적용 판정을 대신하지 않는다(OPERATIONS 9절).
 * 원격 DB에 연결하지 않는다. 환경변수도 읽지 않는다.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { sheetFinanceKpis } from '../src/data'
import { loadMockLedger } from '../src/lib/ecount/mock-ledger'
import { kpisFromLedger } from '../src/lib/ledger/cells'
import { STANDARD_CHART, STANDARD_CHART_BUSINESSES } from '../src/lib/ledger/standard-chart'

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations')
const BUSINESSES = ['biz_dy', 'biz_vana', 'biz_sticky', 'biz_hof', 'biz_boram']

const SUPABASE_STUBS = `
  create schema auth;
  create schema extensions;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon;
  create role authenticated;
`

type Db = PGlite

async function applyAll(db: Db): Promise<string[]> {
  await db.exec(SUPABASE_STUBS)
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
    } catch (e) {
      throw new Error(`${f} 적용 실패: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return files
}

async function bulk(db: Db, table: string, rows: object[], cols: string[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const params: unknown[] = []
    const values = rows.slice(i, i + 500).map((row) => {
      const r = row as Record<string, unknown>
      return `(${cols.map((c) => (params.push(r[c]), `$${params.length}`)).join(',')})`
    })
    await db.query(`insert into ${table} (${cols.join(',')}) values ${values.join(',')}`, params)
  }
}

interface KpiRow {
  period: string
  business_id: string
  metric: string
  v: number
  source: string
  closed: boolean
}
const kpiKey = (k: { period: string; business_id: string; metric: string }) => `${k.period}|${k.business_id}|${k.metric}`

async function readKpis(db: Db): Promise<Map<string, KpiRow>> {
  const { rows } = await db.query<KpiRow>(
    'select period, business_id, metric::text, value::float8 as v, source::text, closed from finance_kpis',
  )
  return new Map(rows.map((r) => [kpiKey(r), r]))
}

async function sheetOnlyView(db: Db) {
  const kpis = await readKpis(db)
  assert.equal(kpis.size, sheetFinanceKpis.length, '원장이 비면 뷰 = 시트 480행')
  assert.ok([...kpis.values()].every((k) => k.source === 'manual' && !k.closed), '시트 행은 수기 꼬리표')
}

/** 0016 표준 계정과목표 시드 = lib/ledger/standard-chart.ts. 스타트업 네 곳만, DY는 없다. */
async function standardChartSeed(db: Db) {
  const { rows } = await db.query<{ business_id: string; account_code: string; name: string; category: string; section: string; cash_flow: string | null; source: string; active: boolean }>(
    'select business_id, account_code, name, category::text, section::text, cash_flow::text, source::text, active from accounts order by business_id, account_code',
  )
  const want = STANDARD_CHART_BUSINESSES.flatMap((b) =>
    STANDARD_CHART.map((s) => [b, s.code, s.name, s.category, s.section, s.cash_flow, 'manual', true]),
  ).sort((x, y) => `${x[0]}|${x[1]}`.localeCompare(`${y[0]}|${y[1]}`))
  assert.deepEqual(
    rows.map((r) => [r.business_id, r.account_code, r.name, r.category, r.section, r.cash_flow, r.source, r.active]),
    want,
    '0016 시드 ≠ standard-chart.ts',
  )
  // 원장 비교(ledgerView)는 mock 계정과목표로 한다. 전표가 아직 없어서 지워도 FK가 걸리지 않는다.
  await db.exec(`delete from accounts where source = 'manual'`)
}

async function ledgerView(db: Db) {
  const ledger = await loadMockLedger()
  await bulk(db, 'accounts', ledger.accounts, ['business_id', 'account_code', 'name', 'category', 'section', 'cash_flow', 'source', 'fetched_at', 'closed'])
  await bulk(db, 'journal_lines', ledger.journal, ['business_id', 'entry_date', 'account_code', 'amount', 'side', 'slip_no', 'line_no', 'memo', 'source', 'fetched_at', 'closed'])
  await bulk(db, 'closings', ledger.closings, ['business_id', 'period', 'account_code', 'amount', 'closed_on', 'provisional_amount', 'source', 'fetched_at', 'closed'])

  const sql = await readKpis(db)
  const ts = kpisFromLedger(ledger, BUSINESSES)
  assert.equal(sql.size, ts.length, 'SQL 뷰와 TS 공식의 행 수')
  const bad = ts.filter((k) => {
    const s = sql.get(kpiKey(k))
    return !s || s.v !== k.value || s.source !== k.source || s.closed !== k.closed
  })
  assert.equal(bad.length, 0, `SQL ≠ TS: ${bad.slice(0, 3).map(kpiKey).join(', ')}`)
  for (const s of sheetFinanceKpis) {
    assert.equal(sql.get(kpiKey(s))?.v, s.value, `시트가 이긴다: ${kpiKey(s)}`)
  }
}

const UID = {
  integration: '00000000-0000-0000-0000-00000000000a',
  agent: '00000000-0000-0000-0000-00000000000b',
  cfo: '00000000-0000-0000-0000-00000000000c',
  ceo: '00000000-0000-0000-0000-00000000000f',
  member: '00000000-0000-0000-0000-00000000000d',
  chairman: '00000000-0000-0000-0000-00000000000e',
}

async function rls(db: Db) {
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    insert into auth.users values
      ('${UID.integration}', 'i@x'), ('${UID.agent}', 'a@x'), ('${UID.cfo}', 'c@x'),
      ('${UID.member}', 'm@x'), ('${UID.chairman}', 'ch@x'), ('${UID.ceo}', 'ceo@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${UID.integration}', 'Integration', 'sync', 'Restricted'),
      ('${UID.agent}', 'AIAgent', 'ai', 'Restricted'),
      ('${UID.cfo}', 'GroupCFO', 'cfo', 'Restricted'),
      ('${UID.member}', 'Member', 'm', 'Normal'),
      ('${UID.chairman}', 'Chairman', 'ch', 'Vault'),
      ('${UID.ceo}', 'BusinessCEO', 'ceo', 'Restricted');
    insert into user_business_access select '${UID.integration}', business_id from businesses;
    insert into user_business_access select '${UID.agent}', business_id from businesses;
    insert into user_business_access values ('${UID.member}', 'biz_dy');
    insert into user_business_access values ('${UID.ceo}', 'biz_vana');
  `)

  /** 역할 하나로 SQL 한 줄. 끝나면 되돌린다. 거부는 'denied', 나머지는 영향 행 수/첫 칸. */
  async function as(uid: string, sql: string): Promise<'denied' | number> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const res = await db.query<Record<string, number>>(sql)
      return res.rows.length ? Number(Object.values(res.rows[0])[0]) : (res.affectedRows ?? 0)
    } catch (e) {
      if (/row-level security/.test(e instanceof Error ? e.message : '')) return 'denied'
      throw e
    } finally {
      await db.exec('rollback')
    }
  }

  const journal = (source: string, slip: string) =>
    `insert into journal_lines (business_id, entry_date, account_code, amount, side, slip_no, line_no, source, fetched_at)
     values ('biz_dy', '2026-08-30', '1010', 1, 'debit', '${slip}', 1, '${source}', now())`
  const all = await db.query<{ n: number }>('select count(*)::int as n from finance_kpis')
  const total = all.rows[0].n

  // Integration — 원장 5표, source=ecount, 열린 달만
  assert.equal(await as(UID.integration, journal('ecount', 'T-1')), 1)
  assert.equal(await as(UID.integration, journal('manual', 'T-2')), 'denied', '원장에 수기 전표 금지')
  assert.equal(await as(UID.integration, `update journal_lines set memo = 'x' where closed`), 0, '마감 달 전표 고정')
  assert.ok(Number(await as(UID.integration, `delete from journal_lines where not closed`)) > 0, '열린 달은 다시 맞춘다')
  assert.equal(await as(UID.integration, `update closings set amount = 0 where closed`), 0, '확정 결산 고정')
  assert.equal(await as(UID.integration, `update tasks set title = 'x'`), 0, '다른 표 쓰기 없음')
  assert.equal(
    await as(UID.integration, `insert into ai_night_outputs (output_id, business_id, job_type, result_summary, status, completed_at) values ('x', null, 'Daily Brief', 'x', 'Done', now())`),
    'denied',
  )
  assert.equal(await as(UID.integration, `insert into audit_log (actor_user_id, action, entity_table) values ('${UID.integration}', 'ecount_sync_completed', 'journal_lines')`), 1)
  assert.equal(await as(UID.integration, `insert into audit_log (actor_user_id, action, entity_table) values ('${UID.integration}', 'update', 'journal_lines')`), 'denied')

  // AIAgent — 읽기만
  assert.equal(await as(UID.agent, 'select count(*)::int from finance_kpis'), total)
  assert.equal(
    await as(UID.agent, `insert into accounts (business_id, account_code, name, category, section, source, fetched_at) values ('biz_dy', '7777', 'x', 'other', 'sga', 'ecount', now())`),
    'denied',
  )

  // GroupCFO — 시트 수기 입력 금지, 환율 수기 허용, 멀티플 승인은 본인 이름으로만
  assert.equal(await as(UID.cfo, `insert into finance_kpis_sheet (period, business_id, metric, value) values ('2026-09', 'biz_dy', 'Revenue', 1)`), 'denied')
  assert.equal(await as(UID.cfo, `insert into fx_rates (rate_date, rate, source_name, source, fetched_at) values ('2026-09-01', 1390, 'ECOS', 'manual', now())`), 1)
  const multiple = (approver: string) =>
    `insert into market_multiples (industry, ev_ebitda, as_of, source_name, source, closed, approved_by, approved_at)
     values ('화학', 7.5, '2026-09-01', 'x', 'manual', true, '${approver}', now())`
  assert.equal(await as(UID.cfo, multiple(UID.chairman)), 'denied')
  assert.equal(await as(UID.cfo, multiple(UID.cfo)), 1)

  // Member — 재무를 못 본다, 키맨을 못 쓴다
  assert.equal(await as(UID.member, 'select count(*)::int from finance_kpis'), 0)
  assert.equal(await as(UID.member, 'select count(*)::int from journal_lines'), 0)
  assert.equal(await as(UID.member, `insert into business_keymen (business_id, name) values ('biz_dy', 'x')`), 'denied')

  // Chairman — 키맨은 쓰고, 원장은 직접 못 쓴다
  assert.equal(await as(UID.chairman, `insert into business_keymen (business_id, name) values ('biz_dy', 'x')`), 1)
  assert.equal(await as(UID.chairman, journal('ecount', 'T-3')), 'denied')
  assert.equal(await as(UID.chairman, 'select count(*)::int from finance_kpis_masked'), total)

  await books(as)
}

type As = (uid: string, sql: string) => Promise<'denied' | number>

/** 0016 자체 장부. 역할별로 되는 것/막히는 것. */
async function books(as: As) {
  // 블록 1 — 계정과목: 만들기·고치기는 장부 담당, 코드는 불변, 지우지 않는다
  const account = (biz: string, code: string) =>
    `insert into accounts (business_id, account_code, name, category, section, source, fetched_at)
     values ('${biz}', '${code}', '테스트', 'other', 'sga', 'manual', now())`
  assert.equal(await as(UID.cfo, account('biz_dy', '8888')), 1, 'GroupCFO는 계정을 만든다')
  assert.equal(await as(UID.ceo, account('biz_vana', '8888')), 1, 'BusinessCEO는 자기 회사 계정을 만든다')
  assert.equal(await as(UID.ceo, account('biz_dy', '8888')), 'denied', 'BusinessCEO는 남의 회사 계정을 못 만든다')
  assert.equal(await as(UID.member, account('biz_dy', '8888')), 'denied', 'Member는 계정을 못 만든다')
  assert.equal(await as(UID.agent, account('biz_dy', '8888')), 'denied', 'AIAgent는 계정을 못 만든다')
  assert.equal(
    await as(UID.chairman, `insert into accounts (business_id, account_code, name, category, section, source, fetched_at) values ('biz_dy', '8889', 'x', 'other', 'sga', 'ecount', now())`),
    'denied',
    '사람이 만드는 계정은 manual',
  )
  assert.equal(await as(UID.chairman, `update accounts set name = '급여', active = false where business_id = 'biz_dy' and account_code = '8010'`), 1, '이름·활성은 고친다')
  await assert.rejects(
    as(UID.chairman, `update accounts set account_code = '8011' where business_id = 'biz_dy' and account_code = '8010'`),
    /account_code_immutable/,
    '코드는 못 바꾼다',
  )
  assert.equal(await as(UID.chairman, `delete from accounts where business_id = 'biz_dy' and account_code = '8010'`), 0, '계정은 지우지 않는다')
  assert.equal(await as(UID.member, `update accounts set name = 'x' where business_id = 'biz_dy'`), 0, 'Member는 못 고친다')
}

async function main() {
  const db = new PGlite({ extensions: { pg_trgm } })
  const files = await applyAll(db)
  await standardChartSeed(db)
  await sheetOnlyView(db)
  await ledgerView(db)
  await rls(db)
  await db.close()
  console.log(
    `PASS: ${files.length} migrations (${files[0]} → ${files.at(-1)}), standard chart seed, sheet-only view, SQL view = TS ledger, RLS by role, books`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
