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
import { kstToday } from '../src/lib/chairman-project'
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

  -- Supabase Storage 최소 흉내 (0018). 실제 storage 스키마에는 훨씬 많은 칸이 있지만
  -- 0018이 건드리는 것은 buckets의 public과 objects의 bucket_id뿐이다.
  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text not null,
    owner uuid,
    created_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;

  -- Supabase의 기본 GRANT 흉내. 실제 프로젝트에서는 postgres 역할에 이 default privileges가
  -- 걸려 있어서, public 스키마에 새로 만든 표는 **만들자마자** anon/authenticated에게 열린다.
  -- 이것을 흉내 내지 않으면 마이그레이션의 revoke가 '이미 없는 권한을 걷는' 빈 문장이 되어,
  -- 그 줄을 지워도 아무 검사도 빨개지지 않는다(0001 audit_log, 0023 chairman_kakao_token).
  -- 표를 만드는 문장들보다 먼저 걸려야 하므로 STUBS의 마지막에 둔다.
  alter default privileges in schema public grant all on tables    to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
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
  // 승계 기간처럼 회장이 둘인 날을 흉내 낸다(0023 머리 주석). 0023 kakao 검사에서만 쓴다 —
  // 다른 표는 "회장은 한 사람"을 전제로 시드돼 있어 여기서 그 전제를 건드리지 않는다.
  chairman2: '00000000-0000-0000-0000-000000000010',
}

async function rls(db: Db) {
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    insert into auth.users values
      ('${UID.integration}', 'i@x'), ('${UID.agent}', 'a@x'), ('${UID.cfo}', 'c@x'),
      ('${UID.member}', 'm@x'), ('${UID.chairman}', 'ch@x'), ('${UID.ceo}', 'ceo@x'),
      ('${UID.chairman2}', 'ch2@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${UID.integration}', 'Integration', 'sync', 'Restricted'),
      ('${UID.agent}', 'AIAgent', 'ai', 'Restricted'),
      ('${UID.cfo}', 'GroupCFO', 'cfo', 'Restricted'),
      ('${UID.member}', 'Member', 'm', 'Normal'),
      ('${UID.chairman}', 'Chairman', 'ch', 'Vault'),
      ('${UID.ceo}', 'BusinessCEO', 'ceo', 'Restricted'),
      ('${UID.chairman2}', 'Chairman', 'ch2', 'Vault');
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
  // 0024 — AIAgent가 직접(security definer 함수를 거치지 않고) audit_log에 쓰는 애플리케이션 경로.
  // send-brief.ts의 done()이 매일 07:00에 이 문장을 던진다. 0023이 kakao_sent/kakao_failed를
  // 늘렸는데 이 정책만 못 따라가면 여기서 'denied'가 나야 할 자리에 통과가, 혹은 그 반대가 난다.
  assert.equal(
    await as(UID.agent, `insert into audit_log (actor_user_id, action, entity_table) values ('${UID.agent}', 'kakao_failed', 'chairman_kakao_token')`),
    1,
    '0024: AIAgent가 kakao_failed를 audit_log에 못 남긴다',
  )
  assert.equal(
    await as(UID.agent, `insert into audit_log (actor_user_id, action, entity_table) values ('${UID.agent}', 'kakao_sent', 'chairman_kakao_token')`),
    1,
    '0024: AIAgent가 kakao_sent를 audit_log에 못 남긴다',
  )
  assert.equal(
    await as(UID.agent, `insert into audit_log (actor_user_id, action, entity_table) values ('${UID.agent}', 'create', 'chairman_kakao_token')`),
    'denied',
    '0024: AIAgent가 임의 action(create)으로 audit_log에 쓸 수 있다',
  )

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

  /**
   * Phase 5-D 프로세스차트(0021/0022). **감사 트리거를 실제로 때린다.**
   *
   * 0021이 production에서 터진 적이 있다: 트리거가 lower(tg_op)로 'insert'를 만들었는데
   * audit_action enum에 그 값이 없었다. 그때 이 검사는 통과했다 — 0021의 시드가
   * Chairman이 있어야 INSERT를 하는데, 마이그레이션이 도는 시점에는 user_profiles가
   * 비어 있어 시드가 일찍 빠져나갔고 트리거가 한 번도 돌지 않았기 때문이다.
   *
   * 그래서 여기서 직접 넣는다. 넣는 순간 트리거가 돌고, 감사 낱말이 틀리면 여기서 터진다.
   */
  const embed = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTEST/pubhtml'
  assert.equal(
    await as(UID.chairman, `insert into process_charts (business_id, team_name, title, embed_url, updated_by) values ('biz_dy', '검사팀', 'x', '${embed}', '${UID.chairman}')`),
    1, 'Chairman은 프로세스차트를 넣는다 — 감사 트리거가 같이 돈다',
  )
  // 트리거가 남긴 낱말이 enum에 있는 값인지 본다. 'insert'였다면 위에서 이미 터졌다.
  assert.equal(
    await as(UID.chairman,
      `select count(*)::int from audit_log where entity_table = 'process_charts' and action = 'create'`,
      `insert into process_charts (business_id, team_name, title, embed_url, updated_by) values ('biz_dy', '검사팀2', 'x', '${embed}', '${UID.chairman}')`),
    1, '감사 기록이 create로 남는다',
  )
  // 게시 링크가 아니면 DB가 막는다. 화면 검증만으로는 API로 들어오는 길이 남는다.
  await assert.rejects(
    as(UID.chairman, `insert into process_charts (business_id, team_name, title, embed_url, updated_by) values ('biz_dy', '편집링크', 'x', 'https://docs.google.com/spreadsheets/d/1AbC/edit', '${UID.chairman}')`),
    /embed_url/, '편집 링크는 check 제약이 거부한다',
  )
  // Member는 Executive 미만이라 읽지도 쓰지도 못한다.
  assert.equal(await as(UID.member, 'select count(*)::int from process_charts'), 0)
  assert.equal(
    await as(UID.member, `insert into process_charts (business_id, team_name, title, embed_url, updated_by) values ('biz_dy', 'x', 'x', '${embed}', '${UID.member}')`),
    'denied',
  )

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
  // AIAgent는 읽기는 된다 — 야간 브리핑(Task 10)이 이 값을 본다. 쓰기 거부만 재고 읽기를
  // 안 재면, 읽기까지 막아버린 정책도 이 스위트를 통과한다.
  assert.equal(
    typeof (await as(UID.agent, 'select count(*) from initiatives')),
    'number', 'AIAgent는 이니셔티브를 읽는다',
  )
  // Integration — 결합 효과. permissive 정책만으로도 이미 막히지만(GroupCFO/Chairman이 아니므로),
  // 이 표에 다른 쓰기 경로가 안 생겼는지 재는 회귀 검사로 남겨 둔다.
  assert.equal(
    await as(UID.integration, `insert into initiatives (title, kind) values ('통합 딜', 'Deal')`),
    'denied', 'Integration은 이니셔티브를 못 만든다',
  )

  // 구조 단언 — restrictive 방어선이 실제로 있는지.
  // AIAgent와 Integration 둘 다 permissive 정책(can_write_initiatives) 하나만으로 이미 막힌다 —
  // Chairman/GroupCFO가 아니기 때문이다. 그래서 위의 행동 검사(insert가 'denied')는 permissive가
  // 막았는지 restrictive가 막았는지 구분하지 못한다. restrictive 루프는 나중에 permissive 정책이
  // 느슨해져도 남는 방어선이라는 게 존재 이유이므로, 있어야 할 자리에 실제로 있는지,
  // RESTRICTIVE로 만들어졌는지(만들어놓고 실수로 permissive가 되지 않았는지)를 카탈로그에서 직접 잰다.
  const { rows: restrictivePolicies } = await db.query<{ tablename: string; policyname: string; permissive: string }>(
    `select tablename, policyname, permissive from pg_policies
       where schemaname = 'public' and (policyname like 'ai_agent_no_%' or policyname like 'integration_no_%')`,
  )
  const policyKind = new Map(restrictivePolicies.map((r) => [`${r.tablename}.${r.policyname}`, r.permissive]))
  const aiAgentBlockedTables = ['initiatives', 'initiative_keymen', 'initiative_docs', 'events']
  const integrationBlockedTables = ['initiatives', 'initiative_keymen', 'initiative_docs', 'events', 'initiative_notes', 'chairman_checkins']
  for (const t of aiAgentBlockedTables) {
    for (const op of ['insert', 'update', 'delete']) {
      assert.equal(
        policyKind.get(`${t}.ai_agent_no_${op}`), 'RESTRICTIVE',
        `${t}에 ai_agent_no_${op}가 restrictive로 있어야 한다`,
      )
    }
  }
  for (const t of integrationBlockedTables) {
    for (const op of ['insert', 'update', 'delete']) {
      assert.equal(
        policyKind.get(`${t}.integration_no_${op}`), 'RESTRICTIVE',
        `${t}에 integration_no_${op}가 restrictive로 있어야 한다`,
      )
    }
  }

  // ── 0018 initiative-logos 버킷 ─────────────────────────────────────
  // 버킷이 비공개인가. as()는 첫 칸을 Number()로 바꾸는데 false가 0으로 둔갑하면
  // 잘못된 값도 조용히 통과한다 — db.query로 boolean 그대로 잰다.
  const bucketRow = await db.query<{ public: boolean }>(
    `select public from storage.buckets where id = 'initiative-logos'`,
  )
  assert.equal(bucketRow.rows[0]?.public, false, '0018: initiative-logos 버킷이 비공개가 아니다')

  // 로고 둘과, 0018이 정책을 만들지 않은 다른 버킷(vault-docs)에 객체 하나를 미리 심어 둔다.
  // as()는 끝나면 항상 롤백하므로 안에서 넣은 행은 다음 as() 호출까지 안 남는다 —
  // db.exec로 소유자 권한(RLS 밖)에서 한 번만 넣는다.
  // vault-docs를 넣는 이유: storage.objects는 프로젝트의 모든 버킷을 한 표에 담는다.
  // 아래 단언들이 전부 bucket_id = 'initiative-logos'로만 걸려 있으면, 정책에서
  // bucket_id 조건이 통째로 빠져도(= 모든 버킷을 열어 버려도) 아무것도 못 잡는다.
  await db.exec(`
    insert into storage.buckets (id, name, public) values ('vault-docs', 'vault-docs', false);
    insert into storage.objects (bucket_id, name) values
      ('initiative-logos', 'ini_001/logo'), ('initiative-logos', 'ini_002/logo'),
      ('vault-docs', 'contract_001.pdf');
  `)

  assert.equal(
    await as(UID.chairman, `select count(*)::int from storage.objects where bucket_id = 'initiative-logos'`),
    2, '0018: Chairman이 로고를 못 읽는다',
  )
  assert.equal(
    await as(UID.cfo, `select count(*)::int from storage.objects where bucket_id = 'initiative-logos'`),
    2, '0018: GroupCFO가 로고를 못 읽는다',
  )
  assert.equal(
    await as(UID.chairman, `insert into storage.objects (bucket_id, name) values ('initiative-logos', 'ini_003/logo')`),
    1, '0018: Chairman이 로고를 못 올린다',
  )
  assert.equal(
    await as(UID.cfo, `insert into storage.objects (bucket_id, name) values ('initiative-logos', 'ini_004/logo')`),
    1, '0018: GroupCFO가 로고를 못 올린다',
  )
  // 재업로드(덮어쓰기)와 정리(삭제) — 헤더 주석이 약속하는 "한 건에 객체 하나, 다시
  // 올리면 덮어쓴다"는 update/delete 경로다. select·insert만 재면 for insert만 남겨도
  // 이 스위트가 통과해 버린다.
  assert.equal(
    await as(UID.chairman, `update storage.objects set name = 'ini_001/logo-v2' where bucket_id = 'initiative-logos' and name = 'ini_001/logo'`),
    1, '0018: Chairman이 로고를 재업로드(덮어쓰기)하지 못한다',
  )
  assert.equal(
    await as(UID.chairman, `delete from storage.objects where bucket_id = 'initiative-logos' and name = 'ini_002/logo'`),
    1, '0018: Chairman이 로고를 지우지 못한다',
  )

  // AIAgent — 0017의 다른 표와 다르다. 읽기도 없다 — can_write_initiatives() 기준이라서다.
  assert.equal(
    await as(UID.agent, `select count(*)::int from storage.objects where bucket_id = 'initiative-logos'`),
    0, '0018: AIAgent에게 로고가 보인다 (can_write_initiatives여야 한다)',
  )
  assert.equal(
    await as(UID.agent, `insert into storage.objects (bucket_id, name) values ('initiative-logos', 'ini_005/logo')`),
    'denied', '0018: AIAgent가 로고를 올릴 수 있다',
  )
  // update/delete는 insert와 달리 (update의 using, delete의 using) with check가 아니라
  // 보이는 행을 거르는 필터다 — 매치되는 행이 없으면 에러가 아니라 영향 행 수 0으로
  // 조용히 끝난다. 'denied'로 재면 항상 실패한다(check-migrations.ts:209의 기존
  // 패턴과 같다 — Integration이 마감 달 전표를 update해도 0건인 것과 같은 이유).
  assert.equal(
    await as(UID.agent, `update storage.objects set name = 'x' where bucket_id = 'initiative-logos' and name = 'ini_001/logo'`),
    0, '0018: AIAgent가 로고를 고칠 수 있다',
  )
  assert.equal(
    await as(UID.agent, `delete from storage.objects where bucket_id = 'initiative-logos' and name = 'ini_001/logo'`),
    0, '0018: AIAgent가 로고를 지울 수 있다',
  )

  // Member(회사 담당자) — 존재 자체를 몰라야 한다.
  assert.equal(
    await as(UID.member, `select count(*)::int from storage.objects where bucket_id = 'initiative-logos'`),
    0, '0018: Member에게 로고가 보인다',
  )
  assert.equal(
    await as(UID.member, `insert into storage.objects (bucket_id, name) values ('initiative-logos', 'ini_006/logo')`),
    'denied', '0018: Member가 로고를 올릴 수 있다',
  )
  assert.equal(
    await as(UID.member, `update storage.objects set name = 'x' where bucket_id = 'initiative-logos' and name = 'ini_001/logo'`),
    0, '0018: Member가 로고를 고칠 수 있다',
  )
  assert.equal(
    await as(UID.member, `delete from storage.objects where bucket_id = 'initiative-logos' and name = 'ini_001/logo'`),
    0, '0018: Member가 로고를 지울 수 있다',
  )

  // BusinessCEO — 전사 역할이 아니다. 0017의 이니셔티브 표(238행)와 같은 이유로 아무것도 없다.
  assert.equal(
    await as(UID.ceo, `select count(*)::int from storage.objects where bucket_id = 'initiative-logos'`),
    0, '0018: BusinessCEO에게 로고가 보인다',
  )
  assert.equal(
    await as(UID.ceo, `insert into storage.objects (bucket_id, name) values ('initiative-logos', 'ini_007/logo')`),
    'denied', '0018: BusinessCEO가 로고를 올릴 수 있다',
  )

  // bucket_id 범위 검사 — 위 단언은 전부 initiative-logos 안에서만 쟀다. Chairman·GroupCFO가
  // 정책의 bucket_id 조건 없이 can_write_initiatives()만으로 통과하게 느슨해지면, 위 단언은
  // 하나도 안 건드리고 그대로 통과하면서 storage.objects 전체(다른 버킷 포함)가 열린다.
  // vault-docs를 직접 겨눠야 그 구멍을 잡는다.
  assert.equal(
    await as(UID.chairman, `select count(*)::int from storage.objects where bucket_id = 'vault-docs'`),
    0, '0018: Chairman이 vault-docs를 본다 — 정책의 bucket_id 조건이 빠졌다',
  )
  assert.equal(
    await as(UID.chairman, `insert into storage.objects (bucket_id, name) values ('vault-docs', 'contract_002.pdf')`),
    'denied', '0018: Chairman이 vault-docs에 쓴다 — 정책의 bucket_id 조건이 빠졌다',
  )
  assert.equal(
    await as(UID.cfo, `select count(*)::int from storage.objects where bucket_id = 'vault-docs'`),
    0, '0018: GroupCFO가 vault-docs를 본다 — 정책의 bucket_id 조건이 빠졌다',
  )
  assert.equal(
    await as(UID.cfo, `insert into storage.objects (bucket_id, name) values ('vault-docs', 'contract_003.pdf')`),
    'denied', '0018: GroupCFO가 vault-docs에 쓴다 — 정책의 bucket_id 조건이 빠졌다',
  )
  // update/delete도 같은 구멍이 있을 수 있다 — select·insert만 vault-docs로 겨누면
  // initiative_logos_write_update·_delete에서만 bucket_id 조건이 빠져도 못 잡는다.
  // 기존 update/delete 성공 케이스(354·358행)는 전부 initiative-logos 안의 행만
  // 건드려서 이 구멍을 안 지난다.
  assert.equal(
    await as(UID.chairman, `update storage.objects set name = 'x' where bucket_id = 'vault-docs'`),
    0, '0018: Chairman이 vault-docs를 고친다 — write_update의 bucket_id 조건이 빠졌다',
  )
  assert.equal(
    await as(UID.chairman, `delete from storage.objects where bucket_id = 'vault-docs'`),
    0, '0018: Chairman이 vault-docs를 지운다 — write_delete의 bucket_id 조건이 빠졌다',
  )
  assert.equal(
    await as(UID.cfo, `update storage.objects set name = 'x' where bucket_id = 'vault-docs'`),
    0, '0018: GroupCFO가 vault-docs를 고친다 — write_update의 bucket_id 조건이 빠졌다',
  )
  assert.equal(
    await as(UID.cfo, `delete from storage.objects where bucket_id = 'vault-docs'`),
    0, '0018: GroupCFO가 vault-docs를 지운다 — write_delete의 bucket_id 조건이 빠졌다',
  )

  // ── 0019 chairman_checkins ──────────────────────────────────────────
  // Chairman 전용. GroupCFO·AIAgent·Member·BusinessCEO·Integration 전부 읽기도 쓰기도 없다 —
  // 0014 chairman_manifesto/0017 initiatives와 달리 AIAgent에게도 안 준다(마이그레이션 주석 참고).
  // 읽을 행은 as()가 항상 롤백하므로 db.exec로 소유자 권한(RLS 밖)에서 미리 심어 둔다.
  await db.exec(
    `insert into chairman_checkins (checkin_date, condition, sleep_hours, weight_kg, meal_note)
     values ('2026-09-01', 4, 7.5, 78.2, '아침 든든하게')`,
  )

  // Chairman — 읽고 쓴다.
  assert.equal(
    await as(UID.chairman, `select count(*)::int from chairman_checkins where checkin_date = '2026-09-01'`),
    1, '0019: Chairman이 체크인을 못 읽는다',
  )
  assert.equal(
    await as(
      UID.chairman,
      `insert into chairman_checkins (checkin_date, condition, meal_note) values ('2026-09-02', 3, '늦은 점심')`,
    ),
    1, '0019: Chairman이 체크인을 못 만든다',
  )
  assert.equal(
    await as(UID.chairman, `update chairman_checkins set condition = 5 where checkin_date = '2026-09-01'`),
    1, '0019: Chairman이 체크인을 못 고친다',
  )
  assert.equal(
    await as(UID.chairman, `delete from chairman_checkins where checkin_date = '2026-09-01'`),
    1, '0019: Chairman이 체크인을 못 지운다',
  )

  // condition은 DB에서도 1~5로 가둔다 — TS 리터럴 유니온만 믿지 않는다.
  await assert.rejects(
    as(UID.chairman, `insert into chairman_checkins (checkin_date, condition) values ('2026-09-03', 6)`),
    /chairman_checkins_condition/,
    '0019: condition이 6이어도 저장된다',
  )
  await assert.rejects(
    as(UID.chairman, `insert into chairman_checkins (checkin_date, condition) values ('2026-09-03', 0)`),
    /chairman_checkins_condition/,
    '0019: condition이 0이어도 저장된다',
  )

  // GroupCFO — 0017과 달리 이 표는 전사 역할도 못 읽는다. 회사 데이터가 아니라 회장 개인
  // 건강 기록이라서다.
  assert.equal(
    await as(UID.cfo, `select count(*)::int from chairman_checkins where checkin_date = '2026-09-01'`),
    0, '0019: GroupCFO에게 체크인이 보인다',
  )
  assert.equal(
    await as(UID.cfo, `insert into chairman_checkins (checkin_date, condition) values ('2026-09-04', 3)`),
    'denied', '0019: GroupCFO가 체크인을 만들 수 있다',
  )
  assert.equal(
    await as(UID.cfo, `update chairman_checkins set condition = 1 where checkin_date = '2026-09-01'`),
    0, '0019: GroupCFO가 체크인을 고칠 수 있다',
  )
  assert.equal(
    await as(UID.cfo, `delete from chairman_checkins where checkin_date = '2026-09-01'`),
    0, '0019: GroupCFO가 체크인을 지울 수 있다',
  )

  // AIAgent — 0014/0017과 다른 자리다. 야간 브리핑은 앱이 읽어 넘겨 준 값만 쓴다(P5-5d) —
  // 이 표를 직접 읽는 경로가 없어야 한다.
  assert.equal(
    await as(UID.agent, `select count(*)::int from chairman_checkins where checkin_date = '2026-09-01'`),
    0, '0019: AIAgent에게 체크인이 보인다 (0014/0017과 달리 여기는 읽기도 없어야 한다)',
  )
  assert.equal(
    await as(UID.agent, `insert into chairman_checkins (checkin_date, condition) values ('2026-09-05', 3)`),
    'denied', '0019: AIAgent가 체크인을 만들 수 있다',
  )
  assert.equal(
    await as(UID.agent, `update chairman_checkins set condition = 1 where checkin_date = '2026-09-01'`),
    0, '0019: AIAgent가 체크인을 고칠 수 있다',
  )
  assert.equal(
    await as(UID.agent, `delete from chairman_checkins where checkin_date = '2026-09-01'`),
    0, '0019: AIAgent가 체크인을 지울 수 있다',
  )

  // Member — 존재 자체를 몰라야 한다.
  assert.equal(
    await as(UID.member, `select count(*)::int from chairman_checkins where checkin_date = '2026-09-01'`),
    0, '0019: Member에게 체크인이 보인다',
  )
  assert.equal(
    await as(UID.member, `insert into chairman_checkins (checkin_date, condition) values ('2026-09-06', 3)`),
    'denied', '0019: Member가 체크인을 만들 수 있다',
  )

  // BusinessCEO — 전사 역할이 아니다.
  assert.equal(
    await as(UID.ceo, `select count(*)::int from chairman_checkins where checkin_date = '2026-09-01'`),
    0, '0019: BusinessCEO에게 체크인이 보인다',
  )
  assert.equal(
    await as(UID.ceo, `insert into chairman_checkins (checkin_date, condition) values ('2026-09-07', 3)`),
    'denied', '0019: BusinessCEO가 체크인을 만들 수 있다',
  )

  // Integration — permissive 정책만으로 이미 막히지만, restrictive 방어선(위의
  // integrationBlockedTables 구조 단언이 정책의 존재·RESTRICTIVE 여부를 잰다)까지 겹으로 확인한다.
  assert.equal(
    await as(UID.integration, `select count(*)::int from chairman_checkins where checkin_date = '2026-09-01'`),
    0, '0019: Integration에게 체크인이 보인다',
  )
  assert.equal(
    await as(UID.integration, `insert into chairman_checkins (checkin_date, condition) values ('2026-09-08', 3)`),
    'denied', '0019: Integration이 체크인을 만들 수 있다',
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

  // ── 0023 chairman_kakao_token — 표는 아무에게도 안 열린다 ────────────────
  //
  // 0019와 다른 검사다. 저기서는 "Chairman은 되고 나머지는 안 된다"를 쟀다.
  // 여기서는 **Chairman도 안 된다**를 잰다 — 문은 함수 네 개뿐이라는 것이 이 표의 계약이다.
  //
  // 주의: 이 스크립트는 rls() 첫머리에서 authenticated에게 모든 표의 grant를 통째로 준다.
  // 0023의 revoke는 그 grant보다 먼저 돌았으므로 여기서 다시 걷어야 실제 배포와 같은 상태가 된다.
  // (실제 Supabase에서는 alter default privileges가 같은 일을 하고, 0023의 revoke가 최종 상태다.)
  //
  // **이 줄은 0023의 revoke를 대신 증명하지 않는다.** 여기서 상태를 다시 만들면 검사는 자기가
  // 만든 상태를 재게 되고, 내일 누가 0023의 revoke를 지워도 아래 단언은 그대로 통과한다.
  // 마이그레이션이 남긴 실제 권한은 main()의 kakaoRevokeSurvives()가 일괄 grant **이전에** 잰다.
  // 아래 단언들이 재는 것은 그 다음 층 — grant가 없을 때 RLS까지 묶여 문이 함수뿐이라는 것이다.
  await db.exec('revoke all on table chairman_kakao_token from anon, authenticated')

  const kakaoRow = `insert into chairman_kakao_token
      (user_id, access_token, refresh_token, expires_at, refresh_expires_at, scopes)
    values ('${UID.chairman}', 'AT', 'RT', now() + interval '6 hours', now() + interval '60 days', 'talk_message')`

  // 표 직접 접근 — 역할 불문 전부 막힌다. grant가 없으면 RLS 이전에 42501로 거절된다.
  for (const [who, uid] of [['Chairman', UID.chairman], ['AIAgent', UID.agent], ['GroupCFO', UID.cfo]] as const) {
    await assert.rejects(
      as(uid, 'select count(*)::int from chairman_kakao_token'),
      /permission denied|row-level security/,
      `0023: ${who}가 chairman_kakao_token을 직접 읽는다 (문은 함수뿐이어야 한다)`,
    )
  }

  /**
   * 함수 호출 전용 헬퍼. as()를 그대로 못 쓰는 이유는 지웠던 0019 condition() 헬퍼와 같다 —
   * 이 함수들은 예외를 던지지 않고 0행이나 false로 돌아온다.
   * as()는 0행을 affectedRows 0으로, false를 Number(false) === 0으로 뭉개 버려
   * '거부됨'과 '진짜 없음'을 구분하지 못한다.
   *
   * setup은 role을 authenticated로 바꾸기 전에, 소유자 권한으로 먼저 돈다. 이 함수들이 재는
   * 것은 읽기/쓰기 경로지 시딩 경로가 아니다 — 검사 대상인 grant 밑으로 시드를 넣으면
   * kakaoRow의 insert 자체가 42501로 막혀 버린다(0023이 authenticated의 모든 grant를 걷었으므로).
   */
  async function rpc<T>(uid: string, sql: string, setup = ''): Promise<T[]> {
    await db.exec(`begin; ${setup ? `${setup};` : ''} select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const res = await db.query<T>(sql)
      return res.rows
    } finally {
      await db.exec('rollback')
    }
  }

  // 아직 연결이 없다 — status는 누구에게도 행을 주지 않는다.
  assert.equal(
    (await rpc(UID.chairman, 'select * from kakao_token_status()')).length, 0,
    '0023: 연결이 없는데 kakao_token_status()가 행을 준다',
  )

  // Chairman만 연결을 만든다.
  assert.equal(
    (await rpc<{ kakao_token_save: boolean }>(UID.chairman,
      `select kakao_token_save('AT', 'RT', now() + interval '6 hours', now() + interval '60 days', 'talk_message')`,
    ))[0].kakao_token_save, true,
    '0023: Chairman이 카카오 연결을 저장하지 못한다',
  )
  for (const [who, uid] of [['AIAgent', UID.agent], ['GroupCFO', UID.cfo], ['Member', UID.member]] as const) {
    assert.equal(
      (await rpc<{ kakao_token_save: boolean }>(uid,
        `select kakao_token_save('X', 'X', now(), now(), 'talk_message')`,
      ))[0].kakao_token_save, false,
      `0023: ${who}가 카카오 연결을 만들 수 있다`,
    )
  }

  // 연결이 있는 상태에서: status는 Chairman만, 그리고 토큰 값은 반환 목록에 아예 없다.
  const statusRows = await rpc<Record<string, unknown>>(UID.chairman, 'select * from kakao_token_status()', kakaoRow)
  assert.equal(statusRows.length, 1, '0023: Chairman이 kakao_token_status()를 못 받는다')
  assert.ok(!('access_token' in statusRows[0]), '0023: kakao_token_status()가 access_token을 내보낸다')
  assert.ok(!('refresh_token' in statusRows[0]), '0023: kakao_token_status()가 refresh_token을 내보낸다')
  for (const [who, uid] of [['AIAgent', UID.agent], ['GroupCFO', UID.cfo], ['Member', UID.member]] as const) {
    assert.equal(
      (await rpc(uid, 'select * from kakao_token_status()', kakaoRow)).length, 0,
      `0023: ${who}에게 kakao_token_status()가 보인다`,
    )
  }

  // for_send — Chairman과 AIAgent만.
  for (const [who, uid] of [['Chairman', UID.chairman], ['AIAgent', UID.agent]] as const) {
    const rows = await rpc<{ access_token: string }>(uid, 'select * from kakao_token_for_send()', kakaoRow)
    assert.equal(rows[0]?.access_token, 'AT', `0023: ${who}가 kakao_token_for_send()로 토큰을 못 받는다`)
  }
  for (const [who, uid] of [['GroupCFO', UID.cfo], ['Member', UID.member], ['Integration', UID.integration], ['BusinessCEO', UID.ceo]] as const) {
    assert.equal(
      (await rpc(uid, 'select * from kakao_token_for_send()', kakaoRow)).length, 0,
      `0023: ${who}에게 카카오 토큰이 보인다`,
    )
  }

  // refreshed — AIAgent는 **있는 행만** 갱신한다. 없는 연결을 되살리지는 못한다.
  const refreshed = (uid: string, access = 'AT2') =>
    `select kakao_token_refreshed('${uid}', '${access}', now() + interval '6 hours', null, null)`
  assert.equal(
    (await rpc<{ kakao_token_refreshed: boolean }>(UID.agent, refreshed(UID.chairman), kakaoRow))[0].kakao_token_refreshed,
    true, '0023: AIAgent가 토큰을 갱신하지 못한다',
  )
  assert.equal(
    (await rpc<{ kakao_token_refreshed: boolean }>(UID.agent, refreshed(UID.chairman)))[0].kakao_token_refreshed,
    false, '0023: AIAgent가 없는 연결을 만들어 낸다 (행이 없으면 false여야 한다)',
  )
  assert.equal(
    (await rpc<{ kakao_token_refreshed: boolean }>(UID.cfo, refreshed(UID.chairman), kakaoRow))[0].kakao_token_refreshed,
    false, '0023: GroupCFO가 토큰을 갱신할 수 있다',
  )
  // p_user_id가 실제로 where에 걸리는가. 이것이 빠지면(= 표 전체 update로 돌아가면) 남의
  // user_id를 넘겨도 true가 온다 — 회장이 둘인 날 한 계정 토큰이 다른 계정 행을 덮어쓴다.
  assert.equal(
    (await rpc<{ kakao_token_refreshed: boolean }>(UID.agent, refreshed(UID.cfo), kakaoRow))[0].kakao_token_refreshed,
    false, '0023: kakao_token_refreshed()가 남의 user_id로도 행을 갱신한다 (where가 없다)',
  )
  // 카카오가 refresh_token을 안 준 회차(null)에 기존 값이 지워지지 않는가.
  assert.equal(
    (await rpc<{ refresh_token: string }>(UID.agent,
      `select refresh_token from kakao_token_for_send()`,
      `${kakaoRow}; ${refreshed(UID.chairman)}`,
    ))[0].refresh_token, 'RT',
    '0023: refresh_token을 안 준 갱신이 기존 refresh_token을 지운다',
  )
  // for_send()는 '아무 행'이 아니라 가장 최근 행을 고른다. 회장이 둘이면(승계 기간) 행도 둘이고,
  // 호출부(send-brief.ts)는 rows[0]을 쓴다 — order by가 없으면 그 선택이 어느 날 조용히 바뀐다.
  // 둘째 행의 user_id로 UID.ceo를 빌려 쓴다. 표는 user_id만 보고 역할은 묻지 않으므로
  // '행이 둘일 때 어느 것을 고르나'를 재는 데는 그 값이 누구 것인지가 상관없다.
  const twoRows = `${kakaoRow};
    insert into chairman_kakao_token
      (user_id, access_token, refresh_token, expires_at, refresh_expires_at, scopes, updated_at)
    values ('${UID.ceo}', 'AT-NEW', 'RT-NEW', now() + interval '6 hours', now() + interval '60 days',
            'talk_message', now() + interval '1 hour')`
  const picked = await rpc<{ user_id: string; access_token: string }>(
    UID.agent, 'select user_id, access_token from kakao_token_for_send()', twoRows,
  )
  assert.equal(picked.length, 1, '0023: 행이 둘일 때 kakao_token_for_send()가 둘을 준다 (limit 1이어야 한다)')
  assert.equal(picked[0].access_token, 'AT-NEW', '0023: kakao_token_for_send()가 가장 최근 행을 고르지 않는다')
  assert.equal(picked[0].user_id, UID.ceo, '0023: 고른 행의 user_id가 그 행의 것이 아니다')

  // clear — Chairman만.
  assert.equal(
    (await rpc<{ kakao_token_clear: boolean }>(UID.agent, 'select kakao_token_clear()', kakaoRow))[0].kakao_token_clear,
    false, '0023: AIAgent가 연결을 해제할 수 있다',
  )
  assert.equal(
    (await rpc<{ kakao_token_clear: boolean }>(UID.chairman, 'select kakao_token_clear()', kakaoRow))[0].kakao_token_clear,
    true, '0023: Chairman이 연결을 해제하지 못한다',
  )

  // ── 회장이 둘인 날(승계 기간, G-1) — status()·clear()가 자기 행만 보고 지우는가 ──────
  //
  // force를 걷은 뒤로(3절 ③) 정책은 더는 소유자를 묶지 않는다. status()/clear()가 where로
  // 스스로 좁히지 않으면 A가 B의 연결 상태를 보거나(status) B의 연결까지 지운다(clear) —
  // 위의 모든 단언은 회장이 하나뿐이라 이 구멍을 재지 못했다. 그래서 A·B 둘을 심고 A로 잰다.
  const kakaoRowB = `insert into chairman_kakao_token
      (user_id, access_token, refresh_token, expires_at, refresh_expires_at, scopes)
    values ('${UID.chairman2}', 'AT-B', 'RT-B', now() + interval '6 hours', now() + interval '60 days', 'profile')`

  // status — A 세션에는 A의 행 하나만 보여야 한다. 길이만으로는 "1행이지만 B의 값"인
  // 경우를 놓치므로 scopes 값까지 A의 것('talk_message')인지 함께 잰다.
  const statusA = await rpc<{ scopes: string }>(
    UID.chairman, 'select * from kakao_token_status()', `${kakaoRow}; ${kakaoRowB}`,
  )
  assert.equal(statusA.length, 1, '0023: 회장이 둘일 때 kakao_token_status()가 한 행이 아닌 것을 A에게 준다')
  assert.equal(statusA[0]?.scopes, 'talk_message', '0023: kakao_token_status()가 A 대신(또는 A와 함께) B의 값을 준다 — where user_id = auth.uid()가 없다')

  // clear — A가 해제해도 B의 연결은 남아야 한다. rpc()는 호출마다 rollback해서 "지운 뒤
  // 남았나"를 다음 호출로 이어 볼 수 없으므로, 한 트랜잭션 안에서 소유자 권한으로 직접 본다.
  await db.exec('begin')
  try {
    await db.exec(`${kakaoRow}; ${kakaoRowB}`)
    await db.exec(`select set_config('request.jwt.claim.sub', '${UID.chairman}', true); set local role authenticated;`)
    const clearedA = await db.query<{ kakao_token_clear: boolean }>('select kakao_token_clear()')
    assert.equal(clearedA.rows[0].kakao_token_clear, true, '0023: 회장이 둘일 때 A가 자기 연결을 해제하지 못한다')
    await db.exec('reset role') // 표를 직접 읽으려면 authenticated의 revoke를 벗어나야 한다(3절 ①).
    const remaining = await db.query<{ user_id: string }>('select user_id from chairman_kakao_token')
    assert.deepEqual(
      remaining.rows.map((r) => r.user_id), [UID.chairman2],
      '0023: 회장이 둘일 때 kakao_token_clear()가 B의 행까지 지운다 — where user_id = auth.uid()가 없다',
    )
  } finally {
    await db.exec('rollback')
  }

  // ── 0023 chairman_recent_condition() — 오늘이 없으면 어제 ─────────────────
  const today = kstToday()
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const twoDaysAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10)
  // checkin_date::text로 캐스팅한다 — PGlite는 date 칸을 JS Date 객체로 돌려주므로 '2026-09-19'
  // 같은 문자열과 그대로 비교하면 타입부터 어긋난다(값이 맞아도 실패한다).
  const recent = (uid: string, setup: string) =>
    rpc<{ condition: number; checkin_date: string }>(
      uid, 'select condition, checkin_date::text as checkin_date from chairman_recent_condition()', setup,
    )

  const ci = (d: string, c: number) => `insert into chairman_checkins (checkin_date, condition) values ('${d}', ${c})`

  assert.equal((await recent(UID.agent, ci(twoDaysAgo, 2))).length, 0,
    '0023: chairman_recent_condition()이 그저께 값을 준다 (이틀을 넘기면 안 된다)')

  let r = await recent(UID.agent, ci(yesterday, 3))
  assert.equal(r[0]?.condition, 3, '0023: 오늘 체크인이 없을 때 어제 값을 못 받는다')
  assert.equal(r[0]?.checkin_date, yesterday, '0023: 어제 값인데 checkin_date가 어제가 아니다')

  r = await recent(UID.agent, `${ci(yesterday, 3)}; ${ci(today, 5)}`)
  assert.equal(r[0]?.condition, 5, '0023: 오늘 체크인이 있는데 어제 값을 준다')
  assert.equal(r[0]?.checkin_date, today, '0023: 오늘 값인데 checkin_date가 오늘이 아니다')

  // 계약은 "Chairman과 AIAgent에게만"이다. 위 두 값 검사는 전부 AIAgent로만 돌았으니
  // Chairman 몫이 검증되지 않은 채 남는다 — 같은 setup으로 Chairman도 직접 잰다.
  const rChairman = await recent(UID.chairman, `${ci(yesterday, 3)}; ${ci(today, 5)}`)
  assert.equal(rChairman[0]?.condition, 5, '0023: Chairman이 chairman_recent_condition()으로 오늘 condition을 못 받는다')
  assert.equal(rChairman[0]?.checkin_date, today, '0023: Chairman에게 checkin_date가 오늘이 아니다')

  for (const [who, uid] of [['GroupCFO', UID.cfo], ['Member', UID.member]] as const) {
    assert.equal((await recent(uid, ci(today, 5))).length, 0,
      `0023: ${who}에게 chairman_recent_condition()이 값을 준다`)
  }
}

/**
 * 0023의 `revoke all on table chairman_kakao_token from anon, authenticated`가 살아 있는가.
 *
 * **rls()의 일괄 grant보다 먼저 불러야 한다.** rls() 첫머리가
 * `grant ... on all tables in schema public to authenticated`를 던져 0023의 revoke를 통째로
 * 무효화하기 때문이다. 그 뒤에 재면 검사는 자기가 만든 상태를 재게 되고, 0023에서 revoke 줄을
 * 지워도 통과한다 — 이 표를 실제로 잠그는 것이 그 한 줄이므로(0023 3절 ①) 여기가 유일하게
 * 의미 있는 자리다.
 */
async function kakaoRevokeSurvives(db: Db) {
  const g = await db.query<{ ok: boolean }>(
    `select not (has_table_privilege('authenticated','chairman_kakao_token','select')
              or has_table_privilege('authenticated','chairman_kakao_token','insert')
              or has_table_privilege('authenticated','chairman_kakao_token','update')
              or has_table_privilege('authenticated','chairman_kakao_token','delete')
              or has_table_privilege('anon','chairman_kakao_token','select')) as ok`,
  )
  assert.ok(g.rows[0].ok, '0023: chairman_kakao_token에 authenticated/anon 권한이 남아 있다')
}

/**
 * security definer 함수가 **BYPASSRLS 아닌 소유자**로 돌 때도 값을 주는가 (0023 3절 ③).
 *
 * 왜 별도 인스턴스인가 — 이 실험은 표와 함수의 소유자를 바꾼다. 위의 모든 단언이 소유자
 * 권한(postgres)으로 심은 시드에 기대고 있어서, 같은 DB에서 소유권을 옮기면 재현이 어려운
 * 방식으로 서로를 오염시킨다. 깨끗한 PGlite 하나를 더 띄우는 쪽이 싸고 분명하다.
 *
 * 왜 필요한가 — 이 harness는 postgres(superuser, bypassrls)로 돈다. superuser는 FORCE와
 * 무관하게 RLS를 전부 우회하므로, 위의 "AIAgent가 kakao_token_for_send()로 토큰을 받는다"는
 * 단언은 **이 질문에 원리적으로 답하지 못한다.** Supabase에서 표와 함수의 소유자가 BYPASSRLS가
 * 아니면, FORCE가 걸린 표에서는 소유자마저 정책(`auth_role() = 'Chairman'`) 아래로 내려가
 * AIAgent 세션의 definer 함수가 0행을 준다. 그러면 07:00 cron은 매일 조용히
 * "카카오가 연결되어 있지 않다"로 끝나고, 회장이 누르는 테스트 발송만 늘 성공해 보인다.
 *
 * 그래서 두 번 잰다.
 *   ① 마이그레이션이 남긴 그대로(FORCE 없음) → AIAgent가 값을 받는다.
 *   ② 같은 DB에 FORCE를 다시 걸면 → 0행. ①이 우연이 아니라 FORCE의 유무 때문임을 증명한다.
 * 누가 0023에 force를 되살리는 순간 ①이 빨개진다.
 *
 * chairman_recent_condition()을 같이 재는 이유: 이쪽이 더 조용하다. 토큰이 0행이면 발송이
 * 멈추지만 컨디션이 0행이면 브리핑에서 문장 하나가 빠질 뿐이라 아무도 눈치채지 못한다.
 */
async function definerUnderNonBypassOwner() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)

  // 전제 확인 — 이 harness가 superuser/bypassrls로 돈다는 것이 이 함수의 존재 이유다.
  const me = await db.query<{ super: boolean; bypass: boolean }>(
    `select rolsuper as super, rolbypassrls as bypass from pg_roles where rolname = current_user`,
  )
  assert.ok(
    me.rows[0].super || me.rows[0].bypass,
    'harness가 더는 superuser가 아니다 — 이 실험의 전제(기본 단언들이 RLS를 우회한다)를 다시 확인하라',
  )

  // 마이그레이션이 force를 남기지 않았는가. 카탈로그에서 직접 잰다 —
  // 아래 행동 검사와 겹으로 두는 이유는, 행동 검사가 통과하는 다른 경로가 생겨도
  // "force를 걸지 않는다"는 0023의 결정 자체는 그대로 지켜져야 하기 때문이다.
  const forced = await db.query<{ relname: string; f: boolean }>(
    `select relname, relforcerowsecurity as f from pg_class
      where relname in ('chairman_kakao_token', 'chairman_checkins')`,
  )
  // 행 수부터 잰다 — 표 이름이 바뀌거나 오타가 나면 위 쿼리가 0행을 주고, 아래 for는
  // 그냥 공회전하며 통과해 버린다(무엇도 단언하지 않은 채). 둘을 정확히 찾았는지가 먼저다.
  assert.equal(forced.rows.length, 2, `0023: force 검사가 표 둘을 못 찾는다 (${forced.rows.map((r) => r.relname).join(', ') || '0개'})`)
  for (const row of forced.rows) {
    assert.equal(row.f, false, `0023: ${row.relname}에 force row level security가 걸려 있다 (definer 함수가 0행을 준다)`)
  }

  // 표와 definer 함수를 BYPASSRLS 없는 역할에게 넘긴다. Supabase에서 소유자가 무엇이든
  // 이 조건에서 동작해야 한다는 것이 요구다 — 소유자의 bypassrls에 기대지 않는다.
  await db.exec(`
    create role app_owner nosuperuser nobypassrls nologin;
    grant usage on schema auth to app_owner;
    alter table public.chairman_kakao_token owner to app_owner;
    alter table public.chairman_checkins    owner to app_owner;
    alter function public.kakao_token_for_send()       owner to app_owner;
    alter function public.chairman_recent_condition()  owner to app_owner;
  `)
  const owner = await db.query<{ s: boolean; b: boolean }>(
    `select rolsuper as s, rolbypassrls as b from pg_roles where rolname = 'app_owner'`,
  )
  assert.equal(owner.rows[0].s, false, '실험 설정이 깨졌다 — app_owner가 superuser다')
  assert.equal(owner.rows[0].b, false, '실험 설정이 깨졌다 — app_owner가 bypassrls다')

  await db.exec(`
    insert into auth.users values ('${UID.chairman}', 'ch@x'), ('${UID.agent}', 'a@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${UID.chairman}', 'Chairman', 'ch', 'Vault'),
      ('${UID.agent}', 'AIAgent', 'ai', 'Restricted');
    insert into chairman_kakao_token
      (user_id, access_token, refresh_token, expires_at, refresh_expires_at, scopes)
    values ('${UID.chairman}', 'AT', 'RT', now() + interval '6 hours', now() + interval '60 days', 'talk_message');
    insert into chairman_checkins (checkin_date, condition)
    values ((now() at time zone 'Asia/Seoul')::date, 4);
  `)

  async function rows(uid: string, sql: string): Promise<number> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      return (await db.query(sql)).rows.length
    } finally {
      await db.exec('rollback')
    }
  }
  const forSend = 'select * from kakao_token_for_send()'
  const condition = 'select * from chairman_recent_condition()'

  // ① 지금 상태 — 07:00 cron이 실제로 밟는 경로다.
  assert.equal(await rows(UID.agent, forSend), 1,
    '0023: BYPASSRLS 없는 소유자에서 AIAgent가 kakao_token_for_send()로 토큰을 못 받는다 — 07:00 발송이 매일 조용히 skipped가 된다')
  assert.equal(await rows(UID.agent, condition), 1,
    '0023: BYPASSRLS 없는 소유자에서 AIAgent가 chairman_recent_condition()을 못 받는다 — 브리핑에서 컨디션 문장이 조용히 빠진다')
  // Chairman(테스트 발송)도 같은 조건에서 되는가. 이쪽만 되는 상태가 바로 숨은 실패 모드였다.
  assert.equal(await rows(UID.chairman, forSend), 1,
    '0023: BYPASSRLS 없는 소유자에서 Chairman의 테스트 발송이 토큰을 못 받는다')

  // ② 대조군 — force를 되살리면 정말 0행이 되는가. ①이 FORCE의 유무 때문임을 증명한다.
  await db.exec(`
    alter table public.chairman_kakao_token force row level security;
    alter table public.chairman_checkins    force row level security;
  `)
  assert.equal(await rows(UID.agent, forSend), 0,
    '대조군이 성립하지 않는다 — force를 걸어도 AIAgent가 토큰을 받는다면 ①은 FORCE를 재고 있지 않다')
  assert.equal(await rows(UID.agent, condition), 0,
    '대조군이 성립하지 않는다 — force를 걸어도 AIAgent가 컨디션을 받는다면 ①은 FORCE를 재고 있지 않다')

  await db.close()
}

async function main() {
  const db = new PGlite({ extensions: { pg_trgm } })
  const files = await applyAll(db)
  // rls()의 일괄 grant보다 **먼저**. 이유는 함수 주석에 있다.
  await kakaoRevokeSurvives(db)
  await standardChartSeed(db)
  await sheetOnlyView(db)
  await ledgerView(db)
  await rls(db)
  await db.close()
  await definerUnderNonBypassOwner()
  console.log(
    `PASS: ${files.length} migrations (${files[0]} → ${files.at(-1)}), standard chart seed, sheet-only view, SQL view = TS ledger, RLS by role, books, kakao revoke + definer under non-bypassrls owner`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
