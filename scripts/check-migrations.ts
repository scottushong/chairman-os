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
  basis: string
}
const kpiKey = (k: { period: string; business_id: string; metric: string }) => `${k.period}|${k.business_id}|${k.metric}`

async function readKpis(db: Db): Promise<Map<string, KpiRow>> {
  const { rows } = await db.query<KpiRow>(
    'select period, business_id, metric::text, value::float8 as v, source::text, closed, basis from finance_kpis',
  )
  return new Map(rows.map((r) => [kpiKey(r), r]))
}

async function sheetOnlyView(db: Db) {
  const kpis = await readKpis(db)
  assert.equal(kpis.size, sheetFinanceKpis.length, '원장이 비면 뷰 = 시트 480행')
  assert.ok([...kpis.values()].every((k) => k.source === 'manual' && !k.closed && k.basis === 'manual'), '시트 행은 수기 꼬리표')
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
    return !s || s.v !== k.value || s.source !== k.source || s.closed !== k.closed || s.basis !== k.basis
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

  /**
   * 역할 하나로 SQL 한 줄. 끝나면 되돌린다. 거부는 'denied', 나머지는 영향 행 수/첫 칸.
   * 되돌리면 deferred 제약(0016 차대 검사)이 커밋까지 가지 않는다 — 그래서 되돌리기 전에 immediate로 돌린다.
   * setup은 같은 트랜잭션에서 먼저 도는 문장들이다(예: 전표를 넣은 뒤 뷰를 읽는다).
   */
  async function as(uid: string, sql: string, setup = ''): Promise<'denied' | number> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      if (setup) await db.exec(setup)
      const res = await db.query<Record<string, number>>(sql)
      // 미뤄 둔 검사를 지금 돌린다. 문장 안(함수 안)의 중간 상태가 아니라 끝난 상태를 잰다 — 커밋과 같다.
      await db.exec('set constraints all immediate')
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
  // 0016부터 manual 라인은 헤더 검사(트리거)가 RLS보다 먼저 막는다. 어느 쪽이든 들어가지 않는다.
  await assert.rejects(as(UID.integration, journal('manual', 'T-2')), /missing_entry_header/, '원장에 수기 전표 금지')
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

  // Phase 4-A 이니셔티브. 전사 역할만 읽고 쓴다. AIAgent는 읽기만, 나머지는 아무것도 없다.
  assert.equal(
    await as(UID.chairman, `insert into initiatives (title, kind) values ('테스트 딜', 'Deal')`),
    1, 'Chairman은 이니셔티브를 만든다',
  )
  assert.equal(
    await as(UID.cfo, `insert into initiatives (title, kind) values ('CFO 딜', 'Deal')`),
    1, 'GroupCFO도 이니셔티브를 만든다',
  )
  assert.equal(
    await as(UID.ceo, `insert into initiatives (title, kind) values ('사장 딜', 'Deal')`),
    'denied', 'BusinessCEO는 이니셔티브를 못 만든다',
  )
  assert.equal(
    await as(UID.member, `select count(*) from initiatives`),
    0, 'Member에게 이니셔티브는 존재하지 않는다',
  )
  assert.equal(
    await as(UID.agent, `insert into initiatives (title, kind) values ('AI 딜', 'Deal')`),
    'denied', 'AIAgent는 읽기만 한다',
  )
  assert.equal(
    await as(UID.cfo, `select count(*) from initiative_notes`),
    0, '회장 메모는 GroupCFO에게 보이지 않는다',
  )

  await books(db, as)
}

type As = (uid: string, sql: string, setup?: string) => Promise<'denied' | number>

/** 0016 자체 장부. 역할별로 되는 것/막히는 것. */
async function books(db: Db, as: As) {
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

  // 블록 2 — 전표 입력. mock 원장은 2026-07까지 마감, 2026-08은 전표만(잠정).
  const post = (biz: string, date: string, lines: object[]) =>
    `select count(*)::int from (select post_journal_entry('${biz}', '${date}', '테스트 전표', 'https://drive.example/x', '${JSON.stringify(lines)}'::jsonb)) x`
  const sale = (amount: number) => [
    { account_code: '1010', side: 'debit', amount },
    { account_code: '4010', side: 'credit', amount },
  ]
  assert.equal(await as(UID.ceo, post('biz_vana', '2026-08-20', sale(1_000_000))), 1, 'BusinessCEO는 자기 회사 전표를 넣는다')
  assert.equal(await as(UID.cfo, post('biz_dy', '2026-08-20', sale(1_000_000))), 1, 'GroupCFO는 전표를 넣는다')
  assert.equal(await as(UID.ceo, post('biz_dy', '2026-08-20', sale(1_000_000))), 'denied', 'BusinessCEO는 남의 회사 전표를 못 넣는다')
  assert.equal(await as(UID.member, post('biz_dy', '2026-08-20', sale(1_000_000))), 'denied', 'Member는 전표를 못 넣는다')
  assert.equal(await as(UID.agent, post('biz_dy', '2026-08-20', sale(1_000_000))), 'denied', 'AIAgent는 전표를 못 넣는다')
  await assert.rejects(
    as(UID.chairman, post('biz_vana', '2026-08-20', [{ account_code: '1010', side: 'debit', amount: 1000 }, { account_code: '4010', side: 'credit', amount: 999 }])),
    /unbalanced_slip/,
    '차대가 맞지 않으면 저장 불가',
  )
  await assert.rejects(
    as(UID.chairman, post('biz_vana', '2026-08-20', [{ account_code: '1010', side: 'debit', amount: 1000 }])),
    /unbalanced_slip/,
    '한 줄 전표는 저장 불가',
  )
  await assert.rejects(as(UID.chairman, post('biz_vana', '2026-07-15', sale(1000))), /closed_period/, '마감된 달은 정정 전표만')
  await assert.rejects(as(UID.chairman, post('biz_vana', '2026-06-15', sale(1000))), /closed_period/, '마감된 달보다 앞선 달도 막는다')
  await assert.rejects(
    as(UID.chairman, post('biz_vana', '2026-08-20', sale(1000)), `update accounts set active = false where business_id = 'biz_vana' and account_code = '4010';`),
    /inactive_account/,
    '비활성 계정에는 전표를 못 넣는다',
  )
  await assert.rejects(
    as(UID.chairman, `insert into journal_lines (business_id, entry_date, account_code, amount, side, slip_no, line_no, source, fetched_at) values ('biz_vana', '2026-08-20', '1010', 1, 'debit', 'NOHEAD', 1, 'manual', now())`),
    /missing_entry_header/,
    '헤더 없는 자체 장부 라인은 없다',
  )
  const posted = post('biz_vana', '2026-08-20', sale(1_000_000)).replace('select count(*)::int from', 'select 1 from') + ';'
  await assert.rejects(
    as(UID.chairman, `update journal_lines set amount = 1 where source = 'manual'`, posted),
    /journal_line_immutable/,
    '전표는 고치지 않는다',
  )
  assert.equal(await as(UID.ceo, `update journal_lines set amount = 1 where source = 'manual'`, posted), 0, 'BusinessCEO에게는 update 정책이 없다')
  assert.equal(await as(UID.chairman, `delete from journal_entries`, posted), 0, '전표는 지우지 않는다')
  assert.equal(
    await as(UID.chairman, `select count(*)::int from audit_log where entity_table = 'journal_entries' and action = 'create'`, posted),
    1,
    '전표 입력은 audit_log에 남는다',
  )
  assert.equal(
    await as(
      UID.chairman,
      `select count(*)::int from finance_kpis where business_id = 'biz_vana' and period = '2026-08' and metric = 'Revenue' and basis = 'provisional' and source = 'manual'`,
      posted,
    ),
    1,
    '자체 장부 전표가 섞인 마감 전 달은 잠정(source=manual)',
  )

  // 블록 3 — 월 마감. VANA 2026-08(mock 전표 + 자체 장부 전표)을 닫는다.
  const close = (biz: string, period: string) => `select close_period('${biz}', '${period}')`
  const closed = `${posted} ${close('biz_vana', '2026-08')};`
  const revenue = `select value::float8 from finance_kpis where business_id = 'biz_vana' and period = '2026-08' and metric = 'Revenue'`
  assert.ok(Number(await as(UID.chairman, close('biz_vana', '2026-08'), posted)) > 0, 'Chairman은 마감한다 — 결산 칸 수')
  assert.ok(Number(await as(UID.cfo, close('biz_vana', '2026-08'))) > 0, 'GroupCFO는 마감한다')
  await assert.rejects(as(UID.ceo, close('biz_vana', '2026-08')), /close_forbidden/, 'BusinessCEO는 마감하지 못한다')
  await assert.rejects(as(UID.member, close('biz_vana', '2026-08')), /close_forbidden/, 'Member는 마감하지 못한다')
  await assert.rejects(as(UID.chairman, close('biz_vana', '2026-07')), /already_closed/, '이미 마감된 달')
  await assert.rejects(as(UID.chairman, close('biz_vana', '2999-01')), /period_not_ended/, '끝나지 않은 달')
  assert.equal(
    await as(UID.chairman, `select count(*)::int from finance_kpis where business_id = 'biz_vana' and period = '2026-08' and basis = 'confirmed'`, closed),
    8,
    '마감 뒤 8개 지표가 전부 확정',
  )
  assert.equal(await as(UID.chairman, revenue, closed), await as(UID.chairman, revenue, posted), '마감은 숫자를 바꾸지 않는다 — 꼬리표만')
  assert.equal(
    await as(UID.chairman, `select count(*)::int from journal_lines where business_id = 'biz_vana' and entry_date >= '2026-08-01' and not closed`, closed),
    0,
    '그 달 전표 라인이 전부 closed',
  )
  assert.equal(
    await as(UID.chairman, `select count(*)::int from closings where business_id = 'biz_vana' and period = '2026-08' and provisional_amount is distinct from amount`, closed),
    0,
    '잠정치를 보존한다',
  )
  assert.equal(
    await as(UID.chairman, `select count(*)::int from audit_log where entity_table = 'closings' and entity_id = 'biz_vana:2026-08'`, closed),
    1,
    '마감은 audit_log에 남는다',
  )
  await assert.rejects(as(UID.chairman, post('biz_vana', '2026-08-25', sale(1000)), closed), /closed_period/, '마감 뒤 그 달 입력은 거부')
  await assert.rejects(
    as(UID.chairman, `update journal_lines set amount = 5 where business_id = 'biz_vana' and entry_date = '2026-08-20' and source = 'manual'`, posted),
    /journal_line_immutable/,
    '마감 담당도 금액은 못 고친다',
  )
  await assert.rejects(
    as(UID.chairman, `update journal_lines set closed = true where business_id = 'biz_vana' and entry_date = '2026-08-20'`, posted),
    /journal_line_immutable/,
    '결산 없이 마감 표시만 켤 수 없다',
  )
  assert.equal(await as(UID.chairman, `delete from closings where business_id = 'biz_vana'`, closed), 0, '마감 해제 없음')
  assert.equal(await as(UID.chairman, `update closings set amount = 0 where business_id = 'biz_vana'`, closed), 0, '결산은 고치지 않는다')

  // 순서대로 마감한다 — 마감이 한 번도 없는 회사에서 앞 달을 건너뛰지 못한다.
  await db.exec(`
    insert into businesses (business_id, name, status, industry) values ('biz_close', '마감 순서 검사', 'Active', 'x');
    insert into accounts (business_id, account_code, name, category, section, source, fetched_at)
    values ('biz_close', '1010', '현금', 'asset', 'cash', 'ecount', now()), ('biz_close', '4010', '매출', 'revenue', 'revenue', 'ecount', now());
    insert into journal_lines (business_id, entry_date, account_code, amount, side, slip_no, line_no, source, fetched_at) values
      ('biz_close', '2020-01-10', '1010', 100, 'debit', 'A', 1, 'ecount', now()), ('biz_close', '2020-01-10', '4010', 100, 'credit', 'A', 2, 'ecount', now()),
      ('biz_close', '2020-02-10', '1010', 100, 'debit', 'B', 1, 'ecount', now()), ('biz_close', '2020-02-10', '4010', 100, 'credit', 'B', 2, 'ecount', now());
  `)
  await assert.rejects(as(UID.chairman, close('biz_close', '2020-02')), /earlier_period_open/, '앞 달부터 순서대로')
  assert.equal(await as(UID.chairman, close('biz_close', '2020-01')), 2, '첫 달은 마감된다')
  await assert.rejects(as(UID.chairman, close('biz_close', '2019-12')), /nothing_to_close|already_closed/, '전표 없는 달')

  // 블록 4 — 정정 전표. 8월에 넣은 전표를 8월 마감 뒤 9월에 고친다.
  const slipOf = `(select slip_no from journal_entries where business_id = 'biz_vana' and correction_kind is null order by created_at limit 1)`
  const correct = (date: string, lines: object[]) =>
    `select post_correction('biz_vana', ${slipOf}, '${date}', '[정정] 금액 수정', null, '${JSON.stringify(lines)}'::jsonb)`
  const corrected = `${closed} ${correct('2026-09-05', sale(1_200_000))};`
  assert.equal(
    await as(UID.chairman, `select count(*)::int from journal_entries where business_id = 'biz_vana' and corrects_id is not null`, corrected),
    2,
    '역분개 + 정정분개 두 장',
  )
  assert.equal(
    await as(
      UID.chairman,
      `select count(*)::int from journal_lines j join journal_entries e using (business_id, slip_no)
        where e.correction_kind = 'reversal' and ((j.account_code = '1010' and j.side = 'credit') or (j.account_code = '4010' and j.side = 'debit'))`,
      corrected,
    ),
    2,
    '역분개는 원 전표의 차대를 뒤집는다',
  )
  assert.equal(
    await as(UID.chairman, `select (-sum(case when side = 'debit' then amount else -amount end))::float8 from journal_lines where business_id = 'biz_vana' and account_code = '4010' and entry_date >= '2026-09-01'`, corrected),
    200_000,
    '9월 순효과 = 정정분개 − 원 전표',
  )
  assert.equal(
    await as(UID.chairman, `select count(*)::int from closings where business_id = 'biz_vana' and period = '2026-08'`, corrected),
    await as(UID.chairman, `select count(*)::int from closings where business_id = 'biz_vana' and period = '2026-08'`, closed),
    '마감된 8월은 그대로',
  )
  assert.equal(
    await as(UID.chairman, `select count(*)::int from audit_log where note like '정정 전표%'`, corrected),
    1,
    '정정은 audit_log에 남는다',
  )
  await assert.rejects(as(UID.chairman, correct('2026-09-06', sale(1000)), corrected), /already_corrected/, '한 전표는 한 번만 정정')
  await assert.rejects(
    as(UID.chairman, `select post_correction('biz_vana', (select slip_no from journal_entries where correction_kind = 'reversal' limit 1), '2026-09-06', 'x', null, '[]'::jsonb)`, corrected),
    /cannot_correct_reversal/,
    '역분개는 정정하지 않는다',
  )
  await assert.rejects(as(UID.chairman, correct('2026-08-25', sale(1000)), closed), /closed_period/, '정정은 열린 달에')
  await assert.rejects(as(UID.chairman, correct('2026-08-19', sale(1000)), posted), /correction_before_original/, '원 전표보다 앞선 날 불가')
  await assert.rejects(as(UID.chairman, correct('2026-09-05', [{ account_code: '1010', side: 'debit', amount: 5 }]), closed), /unbalanced_slip/, '정정분개도 차대 일치')
  assert.equal(
    await as(UID.chairman, `select count(*)::int from journal_entries where corrects_id is not null`, `${closed} ${correct('2026-09-05', [])};`),
    1,
    '라인을 비우면 역분개만(취소)',
  )
  await assert.rejects(
    as(UID.chairman, `select post_correction('biz_vana', 'NOPE', '2026-09-05', 'x', null, '[]'::jsonb)`),
    /correction_target_missing/,
    'ECOUNT·없는 전표는 정정 대상이 아니다',
  )

  // 준비(setup)도 그 역할로 돈다 — Member는 전표를 못 넣으니, Chairman이 넣은 전표를 커밋해 두고 Member가 겨눈다.
  // Member는 VANA 전표를 읽지 못해 대상조차 찾지 못한다(없는 것과 못 보는 것을 구분하지 않는다). 이 검사가 마지막이다.
  await db.exec(`begin; select set_config('request.jwt.claim.sub', '${UID.chairman}', true); set local role authenticated; ${posted} commit;`)
  await assert.rejects(
    as(UID.member, `select post_correction('biz_vana', (select slip_no from journal_entries limit 1), '2026-09-05', 'x', null, '[]'::jsonb)`),
    /correction_target_missing/,
    'Member는 정정 대상을 보지도 못한다',
  )
  assert.equal(await as(UID.chairman, `select count(*)::int from journal_entries`), 1, '(검사 준비) Chairman에게는 보인다')
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
