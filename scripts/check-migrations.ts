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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

// PGlite 스텁과 적용 루프는 scripts/pglite.ts로 옮겼다 — 블록 7의 check-activity.ts가
// 같은 것을 쓴다. 두 벌이 되면 한쪽만 고쳐지는 날이 온다(특히 default privileges 흉내).
import { applyAll, applyOne, MIGRATIONS, type Db } from './pglite'

import { sheetFinanceKpis } from '../src/data'
import { kstToday } from '../src/lib/chairman-project'
import { loadMockLedger } from '../src/lib/ecount/mock-ledger'
import { kpisFromLedger } from '../src/lib/ledger/cells'
import { STANDARD_CHART, STANDARD_CHART_BUSINESSES } from '../src/lib/ledger/standard-chart'

const BUSINESSES = ['biz_dy', 'biz_vana', 'biz_sticky', 'biz_hof', 'biz_boram']

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

  /**
   * 0035 `exceptions` — **세 짝이 아니다.** 그래서 위의 루프에 표 이름만 얹을 수 없고,
   * 이 표만 따로 잰다.
   *
   *   · `ai_agent_no_insert`가 **없다.** 있으면 안 된다 — 야간 Job이 예외를 만드는 것이
   *     블록 B의 설계다(0035 7절). AI가 못 하는 것은 «만드는 것»이 아니라 «정하는 것»이다.
   *   · `ai_agent_no_delete`도 없다. 그 표에는 permissive delete 정책도 grant도 없어
   *     이미 default deny이고, restrictive를 얹어도 잴 것이 없다(0034 4절과 같은 판단).
   *   · 대신 둘이 있다: update를 통째로 막는 줄과, **insert를 `status='open'`으로만
   *     통과시키는 줄.** 뒤의 것이 없으면 AIAgent가 처음부터 닫힌 예외를 넣을 수 있고,
   *     그것은 "만들되 닫지 않는다"를 글자로만 지킨 것이다.
   *
   * 위의 두 루프와 같은 이유로 카탈로그에서 직접 잰다: 행동 검사는 permissive가 막았는지
   * restrictive가 막았는지 구분하지 못하고, restrictive의 존재 이유는 **permissive가
   * 느슨해진 날 남는 방어선**이다. `as restrictive`를 빠뜨리면 permissive 정책이 하나
   * 늘어난 셈이 되는데, 그때 이 표는 더 조용히 넓어진다 — permissive는 OR로 합쳐진다.
   */
  for (const name of ['ai_agent_no_update', 'ai_agent_no_closed_insert']) {
    assert.equal(
      policyKind.get(`exceptions.${name}`), 'RESTRICTIVE',
      `0035: exceptions에 ${name}가 restrictive로 있어야 한다 — AI는 예외를 만들 수는 있어도 닫지는 못한다(§19 "AI가 CEO를 대신하지 않는다")`,
    )
  }
  assert.equal(
    policyKind.get('exceptions.ai_agent_no_insert'), undefined,
    '0035: exceptions에 ai_agent_no_insert가 생겼다 — 야간 Job이 예외를 만들지 못하면 블록 B의 규칙 엔진이 통째로 막힌다. AI가 못 하는 것은 «만드는 것»이 아니라 «정하는 것»이다',
  )

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

  // ── 0032 profile-photos 버킷 ───────────────────────────────────────
  //
  // 0018과 **같은 한 벌**이지만 '누가'가 다르다. 그 차이를 재는 것이 이 블록의 전부다.
  //   올리는 것  본인만. 회장도 남의 얼굴은 못 바꾼다(0018은 역할로 물었다).
  //   보는 것    이름이 보이는 범위와 같다(0026 user_profiles_self_read를 정책이 그대로 쓴다).
  //
  // 이 harness의 시드에는 reports_to가 없다 — 그래서 각자의 subtree는 자기 자신뿐이고,
  // 회장만 전원을 본다. 그것이 여기서 재려는 조건 그대로다.
  const photoBucket = await db.query<{ public: boolean }>(
    `select public from storage.buckets where id = 'profile-photos'`,
  )
  assert.equal(photoBucket.rows[0]?.public, false,
    '0032: profile-photos 버킷이 비공개가 아니다 — 경로가 <user_id>/photo라 user_id만 알면 로그인 없이 얼굴이 열린다')

  // 세 사람의 사진 + **모양이 어긋난 이름 하나.** 콘솔에서 손으로 올린 파일이 그렇게 생긴다.
  await db.exec(`
    insert into storage.objects (bucket_id, name) values
      ('profile-photos', '${UID.chairman}/photo'),
      ('profile-photos', '${UID.cfo}/photo'),
      ('profile-photos', '${UID.member}/photo'),
      ('profile-photos', 'not-a-uuid/photo'),
      -- **다른 버킷에 같은 모양의 이름.** 이것이 없으면 읽기 정책에서 bucket_id 조건이
      -- 통째로 빠져도 아무것도 안 잡힌다 — vault-docs의 'contract_001.pdf'는
      -- profile_photo_owner()가 null을 주어 exists가 어차피 막아 주기 때문이다.
      -- 음성 대조가 그 구멍을 잡아냈다.
      ('vault-docs', '${UID.chairman}/photo');
  `)

  assert.equal(
    await as(UID.chairman, `select count(*)::int from storage.objects where bucket_id = 'profile-photos'`),
    3, '0032: 회장이 세 사람의 사진을 다 보지 못한다 — 조직도에 이름이 보이는 사람의 얼굴은 보여야 한다',
  )
  assert.equal(
    await as(UID.member, `select count(*)::int from storage.objects where bucket_id = 'profile-photos'`),
    1, '0032: 직원에게 남의 사진이 보인다 — 이 직원의 subtree는 자기 자신뿐이고, 사진이 보이는 범위는 이름이 보이는 범위와 같아야 한다',
  )
  // GroupCFO가 0018과 갈라지는 자리다. 로고는 전부 보지만 얼굴은 자기 것만 본다.
  assert.equal(
    await as(UID.cfo, `select count(*)::int from storage.objects where bucket_id = 'profile-photos'`),
    1, '0032: GroupCFO에게 남의 사진이 보인다 — 0018의 로고와 달리 사진은 역할이 아니라 이름 가시성으로 갈린다',
  )
  // 모양이 어긋난 이름은 아무도 못 본다. profile_photo_owner()가 null을 주고, null은
  // exists 안에서 어떤 행과도 안 맞는다 — '모르는 이름의 객체는 안 보인다'가 기본값이다.
  assert.equal(
    await as(UID.chairman, `select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'not-a-uuid/photo'`),
    0, '0032: 이름 모양이 어긋난 객체가 회장에게 보인다 — profile_photo_owner()가 null을 안 주고 있다',
  )

  // 쓰기 — 본인 것만.
  assert.equal(
    await as(UID.member, `insert into storage.objects (bucket_id, name) values ('profile-photos', '${UID.member}/photo2')`),
    'denied', '0032: 직원이 자기 것이 아닌 경로(<uid>/photo2)에 올릴 수 있다 — 경로 모양이 정책의 판정 근거다',
  )
  assert.equal(
    await as(UID.member, `update storage.objects set owner = null where bucket_id = 'profile-photos' and name = '${UID.member}/photo'`),
    1, '0032: 본인이 자기 사진을 못 바꾼다',
  )
  assert.equal(
    await as(UID.member, `delete from storage.objects where bucket_id = 'profile-photos' and name = '${UID.member}/photo'`),
    1, '0032: 본인이 자기 사진을 못 내린다',
  )
  assert.equal(
    await as(UID.member, `insert into storage.objects (bucket_id, name) values ('profile-photos', '${UID.chairman}/photo-x')`),
    'denied', '0032: 직원이 회장의 경로에 사진을 올릴 수 있다',
  )

  // **회장도 남의 얼굴은 못 바꾼다.** 0018과 정확히 갈라지는 자리이고, 이 블록에서
  // 가장 중요한 세 줄이다. update/delete는 using이 필터라 예외가 아니라 0행이다.
  assert.equal(
    await as(UID.chairman, `insert into storage.objects (bucket_id, name) values ('profile-photos', '${UID.member}/photo-x')`),
    'denied', '0032: 회장이 남의 경로에 사진을 올릴 수 있다 — 사진은 그 사람의 얼굴이지 회사의 자산이 아니다',
  )
  assert.equal(
    await as(UID.chairman, `update storage.objects set owner = null where bucket_id = 'profile-photos' and name = '${UID.cfo}/photo'`),
    0, '0032: 회장이 남의 사진을 바꿔치기할 수 있다',
  )
  assert.equal(
    await as(UID.chairman, `delete from storage.objects where bucket_id = 'profile-photos' and name = '${UID.cfo}/photo'`),
    0, '0032: 회장이 남의 사진을 지울 수 있다',
  )

  // bucket_id 범위 — 0032의 읽기 정책에서 bucket_id 조건이 빠지면 "본인 행이 있는 사람"은
  // storage.objects 전체를 보게 된다. 0018의 Member 단언(로고 0건)이 그 구멍을 같이 막지만,
  // vault-docs를 직접 겨눠야 이 정책이 연 문인지 저 정책이 연 문인지가 드러난다.
  assert.equal(
    await as(UID.member, `select count(*)::int from storage.objects where bucket_id = 'vault-docs'`),
    0, '0032: 직원이 vault-docs를 본다 — profile_photos_read의 bucket_id 조건이 빠졌다',
  )
  assert.equal(
    await as(UID.chairman, `select count(*)::int from storage.objects where bucket_id = 'vault-docs'`),
    0, '0032: 회장이 vault-docs의 <uuid>/photo 객체를 본다 — profile_photos_read의 bucket_id 조건이 빠졌다. 이름 모양만 맞으면 다른 버킷의 파일까지 열린다',
  )

  // update_own_photo() — 포인터를 쓰는 좁은 문. **남의 경로는 받지 않는다.**
  assert.equal(
    await as(UID.member, `select update_own_photo('${UID.member}/photo')::int`),
    1, '0032: 본인이 자기 photo_path를 못 쓴다 — update_own_photo()가 거절한다',
  )
  assert.equal(
    await as(UID.member, `select update_own_photo('${UID.chairman}/photo')::int`),
    0, '0032: update_own_photo()가 남의 경로를 자기 칸에 적어 준다 — 화면이 남의 경로로 서명 URL을 요청하게 된다',
  )
  assert.equal(
    await as(UID.member, `select update_own_photo(null)::int`),
    1, '0032: photo_path를 null로 되돌리지 못한다 — 등록과 삭제가 같은 문을 지나야 한다',
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

  // 0029도 같은 자물쇠를 쓴다. 장부 표는 아무 역할도 직접 못 읽고, 문은 함수 셋뿐이다.
  const b = await db.query<{ ok: boolean }>(
    `select not (has_table_privilege('authenticated','chairman_brief_sends','select')
              or has_table_privilege('authenticated','chairman_brief_sends','insert')
              or has_table_privilege('authenticated','chairman_brief_sends','update')
              or has_table_privilege('authenticated','chairman_brief_sends','delete')
              or has_table_privilege('anon','chairman_brief_sends','select')) as ok`,
  )
  assert.ok(b.rows[0].ok, '0029: chairman_brief_sends에 authenticated/anon 권한이 남아 있다 — 이 표의 자물쇠는 revoke다(0023 3절 ①)')

  /**
   * 0030 notifications — 여기 세 줄이 이 표의 정책 전부다.
   *
   * 이 검사가 rls()보다 **먼저** 도는 이유가 바로 이것이다. rls()는 authenticated에게
   * 모든 표의 select/insert/update/delete를 한 번에 주는데, 그 줄 뒤에서는 칸 단위 grant가
   * 통째로 덮여서 아래 두 단언이 아무것도 재지 못한다.
   */
  const n = await db.query<{ sel: boolean; ins: boolean; del: boolean; anon: boolean }>(
    `select has_table_privilege('authenticated','notifications','select')   as sel,
            has_table_privilege('authenticated','notifications','insert')   as ins,
            has_table_privilege('authenticated','notifications','delete')   as del,
            has_table_privilege('anon','notifications','select')            as anon`,
  )
  assert.equal(n.rows[0].sel, true, '0030: authenticated가 notifications를 못 읽는다 — 헤더의 종이 영영 0을 센다')
  assert.equal(n.rows[0].ins, false,
    '0030: authenticated에게 notifications insert 권한이 있다 — 알림을 만드는 것은 아직 아무도 아니고, 열어 두면 본인이 자기에게 아무 알림이나 만들 수 있다(원문 "insert 정책을 넓게 열지 마라")')
  assert.equal(n.rows[0].del, false, '0030: authenticated가 notifications 행을 지울 수 있다 — 읽음은 표시지 삭제가 아니다')
  assert.equal(n.rows[0].anon, false, '0030: 로그인하지 않은 사람이 notifications를 읽는다')

  // 칸 단위 grant. 정책은 행을 고르지 칸을 고르지 못하므로, update를 행 단위로만 열면
  // 본인이 자기 알림의 title·link를 바꿀 수 있다 — '읽음 표시'가 아니라 '알림 위조'가 된다.
  const c = await db.query<{ readat: boolean; title: boolean }>(
    `select has_column_privilege('authenticated','notifications','read_at','update') as readat,
            has_column_privilege('authenticated','notifications','title','update')   as title`,
  )
  assert.equal(c.rows[0].readat, true, '0030: 본인이 자기 알림을 읽음 표시하지 못한다 — 뱃지가 영영 안 줄어든다')
  assert.equal(c.rows[0].title, false,
    '0030: authenticated가 notifications.title을 고칠 수 있다 — 읽음 표시 문이 알림 위조 문이 됐다(grant update (read_at) 한 칸만 주는 이유)')
}

/**
 * 0029 — 아침 알림의 현지 날짜 장부와 문 셋.
 *
 * 재는 것은 셋이다.
 *   ① **행의 존재가 중복 방지다.** 발송에 실패한 날도 행이 남아야 한다 — 안 남으면
 *      06~10시의 틱이 매시 회사 다섯 + 그룹 = 여섯 번의 모델 호출을 다시 돌린다.
 *   ② **true는 false로 내려가지 않는다.** 같은 날짜에 '포기' 기록이 뒤따라와도
 *      이미 보낸 사실이 이긴다. or를 빼고 그냥 덮어쓰면 이력이 거짓말을 한다.
 *   ③ **문은 Chairman과 AIAgent에게만 열린다.** 다른 역할에게는 예외가 아니라 0행/false다
 *      (이 저장소의 계약 — '없는 것'과 '못 읽는 것'을 구분하지 않는다).
 *
 * rls() 다음에 부른다 — 거기서 세션이 쓸 schema usage와 표 권한이 한 번에 깔린다.
 */
async function briefLedger(db: Db) {
  async function rows<T extends object>(uid: string, sql: string): Promise<T[]> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      return (await db.query<T>(sql)).rows
    } finally {
      await db.exec('rollback')
    }
  }
  const one = async <T>(uid: string, sql: string): Promise<T | null> => {
    const r = await rows<Record<string, T>>(uid, sql)
    return r.length ? (Object.values(r[0])[0] ?? null) : null
  }
  /**
   * 쓰기는 커밋해야 한다. 위의 rows()는 롤백하므로 적은 행이 다음 단언에 남지 않는다 —
   * 이 검사가 재려는 것이 바로 '다음 틱이 그 행을 본다'이고, 롤백하면 그 자리가 사라진다.
   */
  const write = async <T>(uid: string, sql: string): Promise<T | null> => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const r = await db.query<Record<string, T>>(sql)
      await db.exec('commit')
      return r.rows.length ? (Object.values(r.rows[0])[0] ?? null) : null
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }

  // 0029 1절·2절이 실제로 칸을 더했는가. 아래 단언들이 칸 이름을 조용히 놓치지 않게 먼저 본다.
  const cols = await db.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where (table_name = 'user_settings' and column_name in ('current_tz','brief_tz'))
         or (table_name = 'events' and column_name = 'timezone')`,
  )
  assert.equal(cols.rows[0].n, 3, '0029: user_settings.current_tz/brief_tz · events.timezone 셋 중 빠진 칸이 있다')

  // ① 야간 Job(AIAgent)이 그날을 적는다. 보냈다는 기록.
  assert.equal(await write<boolean>(UID.agent, `select chairman_brief_send_record('2026-09-22'::date, 'America/New_York', true, '')`), true,
    '0029: AIAgent가 현지 날짜 장부를 못 적는다 — 다음 틱이 같은 날 아침을 한 번 더 보낸다')
  assert.equal(await one<string>(UID.agent, `select local_date::text from chairman_brief_send_status(null::date)`), '2026-09-22',
    '0029: 적은 행이 chairman_brief_send_status()로 안 돌아온다 — 틱이 "오늘은 이미 끝났다"를 영영 모른다')

  // ① 카카오가 연결되지 않아 못 보낸 날도 행은 남는다. 그날 Job은 끝난 날이다.
  assert.equal(await write<boolean>(UID.agent, `select chairman_brief_send_record('2026-09-23'::date, 'Asia/Seoul', false, '카카오가 연결되어 있지 않다')`), true,
    '0029: 발송 실패한 날을 장부에 못 적는다 — 연결이 없는 동안 매시 여섯 번의 모델 호출이 다시 돈다')

  // ② 포기 기록이 뒤따라와도 '보냈다'를 뒤집지 못한다.
  await write(UID.agent, `select chairman_brief_send_record('2026-09-22'::date, 'America/New_York', false, '현지 10시를 넘겼다')`)
  assert.equal(await one<boolean>(UID.agent, `select sent from chairman_brief_send_status('2026-09-22'::date)`), true,
    '0029: 나중에 온 포기 기록이 "보냈다"를 false로 덮었다 — 감사 이력이 거짓말을 한다(0029 6-3의 or)')
  assert.equal(await one<string>(UID.agent, `select reason from chairman_brief_send_status('2026-09-22'::date)`), '현지 10시를 넘겼다',
    '0029: reason은 마지막 판정으로 갱신되어야 한다')

  // 날짜나 시간대가 없는 행은 장부가 아니다. 예외가 아니라 false다(0023 save와 같은 절제).
  assert.equal(await write<boolean>(UID.agent, `select chairman_brief_send_record(null::date, 'Asia/Seoul', true, '')`), false,
    '0029: 날짜 없는 기록을 받아들였다')
  assert.equal(await write<boolean>(UID.agent, `select chairman_brief_send_record('2026-09-24'::date, '  ', true, '')`), false,
    '0029: 시간대 없는 기록을 받아들였다 — 어느 시간대로 판정한 날인지 모르는 행은 나중에 아무것도 설명하지 못한다')

  // ③ 다른 역할에게는 문이 없다. 표도 못 읽고, 함수도 0행/false다.
  assert.equal(await write<boolean>(UID.member, `select chairman_brief_send_record('2026-09-25'::date, 'Asia/Seoul', true, '')`), false,
    '0029: Member가 아침 알림 장부를 적는다')
  assert.equal((await rows(UID.member, `select * from chairman_brief_send_status(null::date)`)).length, 0,
    '0029: Member가 아침 알림 장부를 읽는다')
  assert.equal((await rows(UID.member, `select * from chairman_brief_timezone()`)).length, 0,
    '0029: Member가 회장의 시간대 설정을 읽는다 — user_settings는 남의 행을 어떤 역할도 못 보는 표다')
  assert.equal((await rows(UID.cfo, `select * from chairman_brief_timezone()`)).length, 0,
    '0029: GroupCFO가 회장의 시간대 설정을 읽는다')
}

/**
 * Phase 6-1 블록 A1(0025) — 다섯 번째 겹의 바닥.
 *
 * 0025는 정책을 한 줄도 고치지 않는다. 그래서 위의 역할별 RLS 검사로는 이 파일이 실제로
 * 무엇을 하는지 하나도 재지 못한다 — 표가 생겼는지만 보고 넘어간다. 이 함수가 재는 것은
 * 0026(A2)이 정책에서 부르게 될 **의미** 넷이다.
 *
 *   ① class_rank의 새 순서. 0002의 원래 본문은 모르는 값을 else(=3, Vault)로 떨어뜨린다.
 *      class_rank를 같이 고치는 것을 잊으면 '전 직원 공지'가 '회장 전용'이 된다 —
 *      아무것도 안 했을 때 안전한 쪽이 아니라 **정반대**로 실패하는 드문 자리다.
 *   ② 순환 금지. 고리는 in_my_subtree()를 끝나지 않게 만들 뿐 아니라 고리 안의 사람들이
 *      서로를 전부 보게 만든다 — 다섯 번째 겹을 조용히 무르는 방법이다.
 *   ③ in_my_subtree()의 방향. 위에서 아래는 보이고, 아래에서 위와 옆은 안 보인다.
 *      방향이 뒤집힌 함수도 "true를 준다"만 재는 검사는 통과한다.
 *   ④ shared_with_me()의 만료와 주인. 만료를 안 보는 함수는 기간 공유를 무기한으로 바꾸고,
 *      shared_with를 안 보는 함수는 한 사람에게 연 문을 전 직원에게 연다.
 *
 * rls() 다음에 부른다 — 거기서 authenticated에게 schema usage와 표 권한을 한 번에 주고,
 * 이 함수의 세션들이 그 위에서 돈다.
 */
/**
 * 0025/0026이 쓰는 조직 트리의 사람들. rls()가 심어 둔 UID와 섞이지 않게 번호를 따로 쓴다 —
 * 그쪽은 "회장은 한 사람, 나머지는 평평하다"를 전제로 시드돼 있고 여기서는 트리를 세운다.
 *
 * 트리는 hierarchy()가 세우고 subtreeRls()가 그대로 이어 쓴다. 회장 지시의 4세션 검증
 * (영업팀장 / 영업 직원 / 구매팀장 / 그 위 임원)이 정확히 이 모양이라 두 벌 만들지 않는다.
 *
 *   임원 ─┬─ 영업팀장 ─┬─ 영업 직원
 *         │            └─ 영업 직원 2 (형제)
 *         └─ 구매팀장 (다른 팀, staff의 subtree 밖)
 */
const H = {
  exec: '00000000-0000-0000-0000-000000000021', // 임원 (뿌리)
  lead: '00000000-0000-0000-0000-000000000022', // 영업팀장
  staff: '00000000-0000-0000-0000-000000000023', // 영업 직원
  peer: '00000000-0000-0000-0000-000000000024', // 영업 직원 2 — staff의 형제
  buyer: '00000000-0000-0000-0000-000000000025', // 구매팀장 — 다른 팀
}

async function hierarchy(db: Db) {
  // ── ① 등급 순서 ────────────────────────────────────────────────────
  const rank = await db.query<{ pub: number; normal: number; restricted: number; vault: number }>(`
    select class_rank('Public'::security_class)     as pub,
           class_rank('Normal'::security_class)     as normal,
           class_rank('Restricted'::security_class) as restricted,
           class_rank('Vault'::security_class)      as vault
  `)
  const r = rank.rows[0]
  assert.ok(
    r.pub < r.normal,
    `0025: class_rank('Public')=${r.pub} 이 class_rank('Normal')=${r.normal} 보다 낮지 않다 — 공개 공지가 오히려 잠긴다(class_rank 재정의를 빠뜨렸다)`,
  )
  // 새 값 하나를 끼워 넣으면서 나머지 순서를 뒤집지 않았는가. pub만 재면 전부 0으로 만든
  // 함수도 통과한다.
  assert.ok(
    r.normal < r.restricted && r.restricted < r.vault,
    `0025: 기존 등급 순서가 깨졌다 (Normal=${r.normal}, Restricted=${r.restricted}, Vault=${r.vault})`,
  )

  // ── 팀 시드 ────────────────────────────────────────────────────────
  const teams = await db.query<{ team_id: string; name: string; name_en: string }>(
    `select team_id, name, name_en from teams where business_id = 'biz_dy' order by team_id`,
  )
  assert.deepEqual(
    teams.rows.map((t) => [t.team_id, t.name, t.name_en]),
    [
      ['team_dy_production', '생산', 'Production'],
      ['team_dy_purchasing', '구매', 'Purchasing'],
      ['team_dy_rnd', '연구소', 'R&D'],
      ['team_dy_sales', '영업', 'Sales'],
      ['team_dy_support', '경영지원', 'Management Support'],
    ],
    '0025: DY 팀 시드 다섯이 biz_dy에 붙어 있지 않다',
  )

  // ── 트리를 세운다 (모양은 H의 주석) ────────────────────────────────
  await db.exec(`
    insert into auth.users values
      ('${H.exec}', 'ex@x'), ('${H.lead}', 'lead@x'), ('${H.staff}', 'st@x'),
      ('${H.peer}', 'peer@x'), ('${H.buyer}', 'buy@x');
    insert into user_profiles (user_id, role, display_name, max_security_class, reports_to, team_id) values
      ('${H.exec}',  'Executive', '임원',        'Restricted', null,         'team_dy_sales'),
      ('${H.lead}',  'TeamLead',  '영업팀장',    'Normal',     '${H.exec}',  'team_dy_sales'),
      ('${H.staff}', 'Member',    '영업 직원',   'Normal',     '${H.lead}',  'team_dy_sales'),
      ('${H.peer}',  'Member',    '영업 직원 2', 'Normal',     '${H.lead}',  'team_dy_sales'),
      ('${H.buyer}', 'TeamLead',  '구매팀장',    'Normal',     '${H.exec}',  'team_dy_purchasing');
    insert into user_business_access select '${H.exec}', 'biz_dy';
    insert into user_business_access select '${H.lead}', 'biz_dy';
    insert into user_business_access select '${H.staff}', 'biz_dy';
    insert into user_business_access select '${H.peer}', 'biz_dy';
    insert into user_business_access select '${H.buyer}', 'biz_dy';
  `)

  /** 한 사람의 세션으로 boolean 하나를 받는다. authenticated 역할로 도는 것까지 같이 잰다 — 0025의 grant가 빠지면 여기서 터진다. */
  async function ask(uid: string, sql: string): Promise<boolean> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const res = await db.query<{ v: boolean }>(sql)
      return res.rows[0].v
    } finally {
      await db.exec('rollback')
    }
  }
  const subtree = (me: string, target: string) => ask(me, `select in_my_subtree('${target}') as v`)

  // ── ③ in_my_subtree의 방향 ─────────────────────────────────────────
  assert.equal(await subtree(H.exec, H.staff), true, '0025: 임원이 2단 아래 직원을 subtree로 못 본다')
  assert.equal(await subtree(H.lead, H.staff), true, '0025: 팀장이 자기 팀원을 subtree로 못 본다')
  assert.equal(await subtree(H.staff, H.staff), true, '0025: 자기 자신이 subtree 밖이다')
  assert.equal(await subtree(H.staff, H.lead), false, '0025: 직원이 자기 팀장을 subtree로 본다 — 위계가 뒤집혔다')
  assert.equal(await subtree(H.staff, H.exec), false, '0025: 직원이 임원을 subtree로 본다 — 위계가 뒤집혔다')
  assert.equal(await subtree(H.staff, H.peer), false, '0025: 직원이 같은 팀 동료를 subtree로 본다 — 옆은 안 보여야 한다')
  assert.equal(await subtree(H.lead, H.buyer), false, '0025: 영업팀장에게 구매팀장이 보인다 — 옆 가지는 안 보여야 한다')

  // 퇴사자가 경로를 끊지 않는가 (0025 4절의 명시적 판단). 팀장이 나간 날 그 팀이 임원의
  // 화면에서 통째로 사라지면 안 된다. 되돌려 놓고 나간다 — 아래 순환 검사가 같은 트리를 쓴다.
  await db.exec(`update user_profiles set status = 'left', left_on = (now() at time zone 'Asia/Seoul')::date, revoked_at = now() where user_id = '${H.lead}'`)
  assert.equal(
    await subtree(H.exec, H.staff), true,
    '0025: 팀장이 퇴사하자 그 아래 직원이 임원의 subtree에서 사라졌다 — 사람이 나간 것이 조직이 사라진 것이 될 수는 없다',
  )
  assert.equal(
    await subtree(H.exec, H.lead), true,
    '0025: 퇴사한 팀장 자신이 subtree에서 빠졌다 — 그 사람을 지금 볼 수 있는가는 다른 겹이 판정한다',
  )
  // 되돌린다. 팀장의 status/revoked_at뿐 아니라 **아래 사람들의 reports_to까지** 되돌려야
  // 한다 — 0026이 더한 user_profiles_succession 트리거가 방금 위 update에 반응해서
  // staff·peer를 임원 밑으로 올려 버렸기 때문이다(그것이 0026 5절이 하는 일이고,
  // subtreeRls()의 f가 그 동작 자체를 따로 잰다). 여기서 되돌리지 않으면 이 다음의
  // 순환 검사와 0026의 시나리오 검사가 서로 다른 트리 위에서 돌게 된다.
  await db.exec(`
    update user_profiles set status = 'active', left_on = null, revoked_at = null where user_id = '${H.lead}';
    update user_profiles set reports_to = '${H.lead}' where user_id in ('${H.staff}', '${H.peer}');
  `)

  // ── ② 순환 금지 ────────────────────────────────────────────────────
  // 먼저 정상 경로가 통과하는지 본다. 이것이 없으면 "무조건 예외를 던지는 트리거"도
  // 아래 rejects 셋을 전부 통과한다.
  await db.exec(`update user_profiles set reports_to = '${H.exec}' where user_id = '${H.peer}'`)
  await db.exec(`update user_profiles set reports_to = '${H.lead}' where user_id = '${H.peer}'`)

  // 임원 → 팀장 → 직원인 트리에서 임원의 상사를 그 직원으로 바꾸면 고리가 닫힌다.
  await assert.rejects(
    db.exec(`update user_profiles set reports_to = '${H.staff}' where user_id = '${H.exec}'`),
    /순환/,
    '0025: reports_to로 고리를 만들 수 있다',
  )
  // 한 단계 위(직속)로 고리를 닫는 경우도 같이 본다. 재귀가 첫 층만 보고 마는 구현을 잡는다.
  await assert.rejects(
    db.exec(`update user_profiles set reports_to = '${H.lead}' where user_id = '${H.exec}'`),
    /순환/,
    '0025: 직속 부하를 자기 상사로 지정할 수 있다',
  )
  await assert.rejects(
    db.exec(`update user_profiles set reports_to = '${H.exec}' where user_id = '${H.exec}'`),
    /자기 자신/,
    '0025: 자기 자신을 직속 상사로 지정할 수 있다',
  )
  // insert 경로도 같은 트리거를 탄다. update만 막고 insert를 열어 두면 조직도의 '사람 추가'가 구멍이다.
  await assert.rejects(
    db.exec(`
      insert into auth.users values ('00000000-0000-0000-0000-000000000026', 'self@x');
      insert into user_profiles (user_id, role, display_name, reports_to)
      values ('00000000-0000-0000-0000-000000000026', 'Member', '자기참조', '00000000-0000-0000-0000-000000000026');
    `),
    /자기 자신/,
    '0025: insert로는 자기 자신을 상사로 넣을 수 있다',
  )

  // ── ④ shared_with_me의 만료와 주인 ─────────────────────────────────
  // 구매팀장이 영업 직원에게 문서 셋을 공유한다(회장 지시 검증 c의 모양이다).
  await db.exec(`
    insert into shares (entity_table, entity_id, shared_with, shared_by, expires_at) values
      ('documents', 'doc_live',    '${H.staff}', '${H.buyer}', now() + interval '1 day'),
      ('documents', 'doc_expired', '${H.staff}', '${H.buyer}', now() - interval '1 day'),
      ('documents', 'doc_forever', '${H.staff}', '${H.buyer}', null);
  `)
  const shared = (uid: string, table: string, id: string) =>
    ask(uid, `select shared_with_me('${table}', '${id}') as v`)

  assert.equal(await shared(H.staff, 'documents', 'doc_live'), true, '0025: 만료 전 공유가 보이지 않는다')
  assert.equal(await shared(H.staff, 'documents', 'doc_forever'), true, '0025: 무기한 공유(expires_at null)가 보이지 않는다')
  assert.equal(await shared(H.staff, 'documents', 'doc_expired'), false, '0025: 만료된 공유가 아직 살아 있다 — 사람이 회수를 잊어도 닫혀야 한다')
  assert.equal(await shared(H.peer, 'documents', 'doc_live'), false, '0025: 남에게 한 공유가 제3자에게도 보인다')
  // 표 이름까지 보는가. entity_id만 비교하는 구현은 다른 표의 같은 id를 열어 준다.
  assert.equal(await shared(H.staff, 'tasks', 'doc_live'), false, '0025: entity_table을 보지 않는다 — 다른 표의 같은 id가 열린다')

  // shares의 insert는 **0026이 열었다.** 0025는 permissive 정책 없이 닫아 두었고, 그것이
  // A1이 남긴 의도된 인계 지점이었다(0025 5절 마지막 문단). 0026의 shares_insert_visible이
  // "볼 수 있는 것만 공유할 수 있다"를 채웠으므로, 여기서 "닫혀 있다"를 재던 단언은
  // subtreeRls()의 ③으로 옮겼다 — 거기서는 대상 문서가 실제로 있고 누가 그것을 보는지가
  // 정해져 있어서 '가시성 판정'을 진짜로 잴 수 있다.

  // 구조 단언 — 0026의 42P17 방어선.
  //   in_my_subtree()는 security definer로 user_profiles를 읽는다. 그 표에 FORCE가 걸리면
  //   소유자(=함수 소유자)마저 정책 아래로 내려가고, 0026이 그 정책 안에서 이 함수를 부르는
  //   순간 "정책 → 함수 → 정책"의 무한 재귀가 된다. shares/shared_with_me()도 같은 모양이다
  //   (0023 3절 ③이 chairman_kakao_token에서 먼저 겪은 함정이다).
  const forced = await db.query<{ relname: string; f: boolean }>(
    `select relname, relforcerowsecurity as f from pg_class where relname in ('user_profiles', 'shares')`,
  )
  assert.equal(forced.rows.length, 2, `0025: force 검사가 표 둘을 못 찾는다 (${forced.rows.map((x) => x.relname).join(', ') || '0개'})`)
  for (const row of forced.rows) {
    assert.equal(row.f, false, `0025: ${row.relname}에 force row level security가 걸려 있다 — definer 함수가 정책 아래로 내려가 0026에서 42P17이 난다`)
  }
}

/**
 * 0026 — 다섯 번째 겹이 실제로 행을 자르는가.
 *
 * 회장 지시의 검증 시나리오 a~f를 **DB 층에서** 잰다. 원문은 4세션(Chairman / DY 대표 /
 * 영업팀장 / 영업 직원)의 화면을 말하지만, 화면이 비는 이유는 거의 언제나 정책이다 —
 * 정책이 옳다는 것을 먼저 못 박아 두면 블록 B가 화면을 그릴 때 "안 보이는 게 버그인지
 * 설계인지"를 매번 다시 조사하게 된다.
 *
 * 트리는 hierarchy()가 세운 것을 그대로 쓴다(H의 주석). 그 위에 이 함수가 '일'을 얹는다 —
 * 프로젝트·업무·문서·결재를 누가 가졌는지가 이 검사의 입력이다.
 *
 * 이 DB에는 활성 Chairman이 둘이라(rls()의 chairman/chairman2) 0026의 백필이 건너뛰었다.
 * 그래서 rls()·hierarchy()가 심은 사람들의 reports_to는 지금도 null이고, 그 상태가 오히려
 * 이 검사에 맞는다 — "트리에 매달리지 않은 사람에게는 자기 것만 보인다"가 백필이 필요한
 * 이유 그 자체다. 백필 자체는 subtreeBackfill()이 깨끗한 DB에서 따로 잰다.
 */
async function subtreeRls(db: Db) {
  // ── 일감을 심는다 (superuser라 RLS를 우회한다 — 여기서는 '누가 가졌나'만 정한다) ──
  //   prj_vana / doc_vana는 회귀 대조용이다: 소유자는 영업팀장인데 회사가 다르다.
  //   소유권이 회사 격리를 이기면 안 된다.
  await db.exec(`
    insert into projects (project_id, business_id, name, owner_user_id) values
      ('prj_sales', 'biz_dy',   '영업 프로젝트', '${H.lead}'),
      ('prj_buy',   'biz_dy',   '구매 프로젝트', '${H.buyer}'),
      ('prj_vana',  'biz_vana', '남의 회사 것', '${H.lead}'),
      ('prj_null',  'biz_dy',   '담당자 미지정', null);
    insert into tasks (task_id, project_id, title, owner_user_id) values
      ('tsk_lead',  'prj_sales', '팀장 업무',   '${H.lead}'),
      ('tsk_staff', 'prj_sales', '직원 업무',   '${H.staff}'),
      ('tsk_buy',   'prj_buy',   '구매 업무',   '${H.buyer}');
    insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by) values
      ('doc_sales',  'biz_dy',   '영업 계약서', 'Contract', 'Normal', 'https://x/1', '${H.lead}'),
      ('doc_buy',    'biz_dy',   '구매 계약서', 'Contract', 'Normal', 'https://x/2', '${H.buyer}'),
      ('doc_notice', 'biz_dy',   '전사 공지',   'Notice',   'Public', 'https://x/3', '${H.buyer}'),
      ('doc_vana',   'biz_vana', '남의 회사 문서', 'Contract', 'Normal', 'https://x/4', '${H.lead}');
    insert into decisions (decision_id, business_id, title, created_by) values
      ('dec_lead', 'biz_dy', '영업팀장 기안', '${H.lead}'),
      ('dec_buy',  'biz_dy', '구매팀장 기안', '${H.buyer}');
  `)

  /**
   * 한 사람의 세션으로 행들을 받는다. as()와 달리 값을 그대로 돌려준다 —
   * 여기서 재는 것은 건수만이 아니라 **어느 행인가**다(0이 아니라 '무엇이 0인가').
   */
  async function rows<T extends object>(uid: string, sql: string, setup = ''): Promise<T[] | 'denied'> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      if (setup) await db.exec(setup)
      return (await db.query<T>(sql)).rows
    } catch (e) {
      if (/row-level security/.test(e instanceof Error ? e.message : '')) return 'denied'
      throw e
    } finally {
      await db.exec('rollback')
    }
  }
  const ids = async (uid: string, sql: string, setup = '') => {
    const r = await rows<Record<string, string>>(uid, sql, setup)
    return r === 'denied' ? 'denied' : r.map((x) => String(Object.values(x)[0])).sort()
  }

  // ── 회귀 대조 — 회사 격리를 잃지 않았는가 ──────────────────────────
  //   subtree를 얹으면서 has_business()를 놓치면 소유자가 나인 남의 회사 행이 열린다.
  //   prj_vana / doc_vana의 소유자는 영업팀장 본인이다. 그런데도 0건이어야 한다.
  assert.deepEqual(
    await ids(H.lead, `select project_id from projects where project_id in ('prj_sales','prj_vana','prj_001')`),
    ['prj_sales'],
    '0026: 회사 격리가 깨졌다 — 소유자가 본인이라는 이유로 남의 회사 프로젝트가 열린다(0002 projects_read의 has_business를 잃었다)',
  )
  assert.deepEqual(
    await ids(H.lead, `select document_id from documents where document_id in ('doc_sales','doc_vana')`),
    ['doc_sales'],
    '0026: 회사 격리가 깨졌다 — 소유자가 본인이라는 이유로 남의 회사 문서가 열린다',
  )
  // ── 0027. projects에도 다섯 번째 겹이 얹혔는가, 그리고 그 대가를 치르지 않았는가 ──
  //
  //   0026은 이 표만 비워 두었다(0026 2-2절). 이유는 정당했다: tasks_read(0002:275-281)의
  //   회사 판정이 projects를 exists로 거치는데, 정책 식 안의 subquery도 그 표의 RLS를 탄다.
  //   그래서 projects_read를 좁히는 순간 그 exists는 "회사가 같은가"가 아니라 "그 프로젝트가
  //   나에게 보이는가"가 되고, 팀장이 만든 프로젝트 안의 **직원 자신의 업무**가 사라진다.
  //   0027이 그 회사 판정을 project_business_id() definer로 옮겨 먼저 치우고 겹을 얹었다.
  //
  //   **아래 첫 단언이 이 파일에서 가장 중요한 자리다.** A2가 PGlite로 재현한 실패가 정확히
  //   그것이고, 이 단언이 없으면 다음 사람이 같은 실패를 다시 만든 채 초록을 본다 —
  //   화면이 비는 것은 다음 날 아침이다.
  assert.deepEqual(
    await ids(H.staff, `select task_id from tasks where task_id = 'tsk_staff'`),
    ['tsk_staff'],
    '0027: 영업 직원이 자기 업무를 잃었다 — projects에 subtree 겹을 얹으면서 tasks_read의 회사 판정이 "프로젝트가 보이는가"로 바뀌었다(A2가 재현한 그 실패다). tasks_read가 project_business_id()를 쓰는지, projects에 force가 되살아나지 않았는지를 보라',
  )
  //   그 업무가 매달린 프로젝트 자체는 이제 직원에게 보이지 않는다. 위 단언과 이 단언이
  //   **같이** 성립해야 0027이 한 일이 성립한다 — 하나만 보면 둘 중 어느 쪽으로든 속는다.
  assert.deepEqual(
    await ids(H.staff, `select project_id from projects where project_id = 'prj_sales'`),
    [],
    '0027: 팀장의 프로젝트가 직원에게 그대로 보인다 — projects에 subtree 겹이 얹히지 않았다(0026이 남긴 구멍)',
  )
  // 위에서 아래로는 보인다. 영업팀장은 자기 프로젝트를, 임원은 두 팀 것을 다 본다.
  assert.deepEqual(
    await ids(H.lead, `select project_id from projects where project_id in ('prj_sales','prj_buy')`),
    ['prj_sales'],
    '0027: 영업팀장이 자기 프로젝트를 못 보거나 구매팀 프로젝트를 본다 — subtree 겹의 방향이 틀렸다',
  )
  assert.deepEqual(
    await ids(H.exec, `select project_id from projects where project_id in ('prj_sales','prj_buy')`),
    ['prj_buy', 'prj_sales'],
    '0027: 임원이 자기 subtree의 프로젝트를 못 본다 — 위에서 아래로는 보여야 한다(위임이란 그것이다)',
  )
  // 주인 없는 프로젝트는 **기존 회사 규칙 그대로** 보인다. 0026이 여섯 표에 쓴 것과
  //   같은 규칙(owner_unknown)이다. prj_002는 0003 시드 — 담당자 칸이 비어 있지 않고
  //   거기 박힌 uuid가 auth.users에 없다. prj_null은 칸 자체가 null인 경우다.
  //   `owner_user_id is null`만 보면 prj_002가 사라지고 적용 당일 목록이 빈다.
  assert.deepEqual(
    await ids(H.staff, `select project_id from projects where project_id in ('prj_002','prj_null')`),
    ['prj_002', 'prj_null'],
    '0027: 주인 없는 프로젝트가 사라졌다 — owner_unknown() 분기를 빠뜨렸다(0003 시드의 가상 담당자 uuid까지 같은 규칙이다)',
  )
  // 공유는 subtree를 가로지른다. 구매팀장이 영업팀장에게 자기 프로젝트를 연다.
  //   행은 superuser로 심는다 — 여기서 재는 것은 '읽기'이고, 공유를 만들 수 있는가는
  //   아래 ③(shares_insert_visible)이 따로 잰다.
  await db.exec(`insert into shares (entity_table, entity_id, shared_with, shared_by) values ('projects', 'prj_buy', '${H.lead}', '${H.buyer}')`)
  assert.deepEqual(
    await ids(H.lead, `select project_id from projects where project_id = 'prj_buy'`),
    ['prj_buy'],
    "0027: 공유한 프로젝트가 받는 사람에게 보이지 않는다 — projects_read에 shared_with_me('projects', …) 분기를 빠뜨렸다",
  )
  await db.exec(`delete from shares where entity_table = 'projects' and entity_id = 'prj_buy'`)
  // 반대 방향의 회귀 — 주인이 없는 시드 행은 **그대로 보여야** 한다.
  //   0003_seed의 tsk_002는 담당자 칸이 비어 있지 않고, 거기 박힌 uuid는 auth.users에
  //   없어서 user_profiles 행을 만들 수조차 없다(supabase.ts UNKNOWN_OWNER 주석 1번).
  //   owner_unknown()이 이것을 '회사 공통'으로 읽지 못하면 CH-017 '내 결정 대기'가
  //   0026 적용 당일 통째로 빈다.
  assert.deepEqual(
    await ids(H.lead, `select task_id from tasks where task_id = 'tsk_002'`),
    ['tsk_002'],
    '0026: 주인 없는 시드 업무가 사라졌다 — owner_unknown()이 0003 시드의 가상 담당자를 회사 공통으로 읽지 못한다(적용 당일 업무 화면이 빈다)',
  )

  // ── a. 영업팀장 세션: 조직도가 영업팀만 준다 ───────────────────────
  assert.deepEqual(
    await ids(H.lead, `select display_name from user_profiles`),
    ['영업 직원', '영업 직원 2', '영업팀장'].sort(),
    '0026: 영업팀장의 사람 목록이 자기 팀이 아니다 (a: 구매팀·임원은 존재도 보이지 않아야 한다)',
  )
  assert.deepEqual(
    await ids(H.lead, `select user_id from user_profiles where user_id in ('${H.buyer}','${H.exec}')`),
    [],
    '0026: 영업팀장에게 구매팀장·임원이 보인다 (a) — 옆과 위는 존재도 보이지 않아야 한다',
  )
  // 회장은 그대로 전원을 본다. 0002의 Chairman 분기를 지우지 않았다는 증거다 —
  // 이 DB는 백필이 건너뛴 상태라 subtree만으로는 회장도 자기 하나뿐이다.
  const chairmanSees = await rows<{ n: number }>(UID.chairman, `select count(*)::int as n from user_profiles`)
  assert.ok(
    chairmanSees !== 'denied' && chairmanSees[0].n >= 12,
    `0026: 회장이 사람 목록을 잃었다 (${chairmanSees === 'denied' ? 'denied' : chairmanSees[0].n}명) — 0002:208의 Chairman 분기를 지웠다`,
  )

  // ── b. 영업 직원 세션: 자기 것 + 공유받은 것만 ─────────────────────
  assert.deepEqual(
    await ids(H.staff, `select task_id from tasks where task_id in ('tsk_lead','tsk_staff','tsk_buy')`),
    ['tsk_staff'],
    '0026: 영업 직원에게 팀장·구매팀 업무가 보인다 (b)',
  )
  await db.exec(`insert into shares (entity_table, entity_id, shared_with, shared_by) values ('tasks', 'tsk_buy', '${H.staff}', '${H.buyer}')`)
  assert.deepEqual(
    await ids(H.staff, `select task_id from tasks where task_id in ('tsk_lead','tsk_staff','tsk_buy')`),
    ['tsk_buy', 'tsk_staff'],
    '0026: 공유받은 업무가 보이지 않는다 (b) — shared_with_me 분기를 tasks_read에서 빠뜨렸다',
  )
  await db.exec(`delete from shares where entity_table = 'tasks' and entity_id = 'tsk_buy'`)

  // ── c. 구매팀장 → 영업팀장 문서 공유, 만료되면 사라진다 ────────────
  assert.deepEqual(await ids(H.lead, `select document_id from documents where document_id = 'doc_buy'`), [],
    '0026: 공유 전부터 구매팀 문서가 영업팀장에게 보인다 (c)')
  await db.exec(`insert into shares (entity_table, entity_id, shared_with, shared_by) values ('documents', 'doc_buy', '${H.lead}', '${H.buyer}')`)
  assert.deepEqual(await ids(H.lead, `select document_id from documents where document_id = 'doc_buy'`), ['doc_buy'],
    '0026: 공유한 문서가 받는 사람에게 보이지 않는다 (c)')
  assert.deepEqual(await ids(H.peer, `select document_id from documents where document_id = 'doc_buy'`), [],
    '0026: 공유가 제3자에게도 열렸다 (c) — 공유는 한 사람 한 건이다')
  await db.exec(`update shares set expires_at = now() - interval '1 day' where entity_table = 'documents' and entity_id = 'doc_buy'`)
  assert.deepEqual(await ids(H.lead, `select document_id from documents where document_id = 'doc_buy'`), [],
    '0026: 만료된 공유가 아직 문서를 열어 준다 (c) — 사람이 회수를 잊어도 닫혀야 한다')
  await db.exec(`delete from shares where entity_table = 'documents' and entity_id = 'doc_buy'`)

  // 결재도 같은 겹을 탄다. created_by(기안자)를 0026이 더한 이유다 —
  // decided_by만 보면 '아직 처리 전'이라는 이유로 남의 기안이 전사에 열린다.
  assert.deepEqual(
    await ids(H.lead, `select decision_id from decisions where decision_id in ('dec_lead','dec_buy')`),
    ['dec_lead'],
    '0026: 구매팀장의 기안이 영업팀장에게 보인다 — decisions에 created_by 겹이 걸리지 않았다',
  )
  assert.deepEqual(
    await ids(H.lead, `select decision_id from decisions where decision_id = 'dec_001'`),
    [],
    '0026: 남의 회사(biz_vana) 결재가 열린다 — decisions_read의 has_business를 잃었다',
  )
  assert.deepEqual(
    await ids(H.lead, `select decision_id from decisions where decision_id = 'dec_002'`),
    ['dec_002'],
    '0026: 주인 없는 시드 결재가 사라졌다 — 0026 이전 행은 회사 공통으로 남아야 한다(화면이 그대로 서야 한다)',
  )

  // ── e. 공개 등급은 subtree 밖에도 보인다 ───────────────────────────
  assert.deepEqual(
    await ids(H.peer, `select document_id from documents where document_id in ('doc_notice','doc_buy')`),
    ['doc_notice'],
    "0026: 'Public' 공지가 subtree 밖 직원에게 보이지 않는다 (e) — 공지는 위계와 무관하다",
  )
  // 트리에 아예 매달리지 않은 사람(rls()의 Member, reports_to null)에게도 보인다.
  assert.deepEqual(
    await ids(UID.member, `select document_id from documents where document_id in ('doc_notice','doc_sales')`),
    ['doc_notice'],
    "0026: 'Public' 공지가 같은 회사 전원에게 가지 않는다 (e)",
  )

  // ── ③ shares의 insert — 볼 수 있는 것만 공유할 수 있다 (0025 C22의 후속) ──
  //   0025는 이 문을 닫아 두고 "대상 가시성 조건은 0026이 채운다"고 인계했다.
  assert.deepEqual(
    await rows(H.buyer, `insert into shares (entity_table, entity_id, shared_with, shared_by) values ('documents','doc_buy','${H.lead}','${H.buyer}')`),
    [],
    '0026: 자기가 올린 문서를 공유하지 못한다 — shares_insert_visible이 너무 좁다',
  )
  assert.equal(
    await rows(H.staff, `insert into shares (entity_table, entity_id, shared_with, shared_by) values ('documents','doc_buy','${H.peer}','${H.staff}')`),
    'denied',
    '0026: 자기가 못 보는 문서를 공유할 수 있다 — 공유가 가시성 우회 통로가 된다',
  )
  assert.equal(
    await rows(H.buyer, `insert into shares (entity_table, entity_id, shared_with, shared_by) values ('documents','doc_ghost','${H.lead}','${H.buyer}')`),
    'denied',
    '0026: 없는 문서에 대한 공유 행을 만들 수 있다 — 대상 표를 읽지 않는다',
  )
  // 0025의 restrictive(shared_by = auth.uid())가 0026의 permissive 아래에서도 남는가.
  assert.equal(
    await rows(H.buyer, `insert into shares (entity_table, entity_id, shared_with, shared_by) values ('documents','doc_buy','${H.lead}','${H.staff}')`),
    'denied',
    '0026: 남의 이름으로 공유를 만들 수 있다 — 0025의 shares_insert_is_self가 무너졌다',
  )

  // ── d. 초대 위임 ───────────────────────────────────────────────────
  const invite = (email: string, role: string, boss: string, cls = 'Normal', biz = `'{biz_dy}'`) =>
    `insert into user_invitations (email, role, display_name, invited_by, reports_to, max_security_class, business_ids)
     values ('${email}', '${role}', '${email}', '${H.lead}', '${boss}', '${cls}', ${biz})`

  // 팀장이 자기 밑으로 Member를 부른다 → 결재 없음.
  assert.deepEqual(
    await rows<{ req: boolean }>(H.lead, `select chairman_approval_required as req from user_invitations where email = 'm1@x'`,
      invite('m1@x', 'Member', H.lead)),
    [{ req: false }],
    '0026: 팀장의 Member 초대에 회장 결재가 붙었다 (d)',
  )
  // Executive → 결재. 클라이언트가 false를 보내도 서버가 덮어쓴다.
  assert.deepEqual(
    await rows<{ req: boolean }>(H.lead, `select chairman_approval_required as req from user_invitations where email = 'e1@x'`,
      `insert into user_invitations (email, role, display_name, invited_by, reports_to, max_security_class, business_ids, chairman_approval_required)
       values ('e1@x', 'Executive', 'e1', '${H.lead}', '${H.lead}', 'Normal', '{biz_dy}', false)`),
    [{ req: true }],
    '0026: Executive 초대에 회장 결재가 안 붙는다 (d) — 클라이언트가 false로 보내면 통과한다면 그것은 결재가 아니다',
  )
  // 자기 subtree 밖(구매팀장 밑)으로는 못 부른다.
  assert.equal(await rows(H.lead, invite('x1@x', 'Member', H.buyer)), 'denied',
    '0026: 초대 범위가 자기 subtree를 넘는다 (d) — 팀장이 남의 팀에 사람을 꽂을 수 있다')
  assert.equal(await rows(H.lead, `insert into user_invitations (email, role, display_name, invited_by, max_security_class, business_ids) values ('x2@x','Member','x2','${H.lead}','Normal','{biz_dy}')`), 'denied',
    '0026: reports_to 없이 초대할 수 있다 — 그 사람은 조직도 어디에도 매달리지 않는다')
  // 권한 상승 — 자기보다 높은 등급·못 보는 회사를 나눠 줄 수 없다.
  assert.equal(await rows(H.lead, invite('x3@x', 'Member', H.lead, 'Vault')), 'denied',
    '0026: Normal 팀장이 Vault 계정을 초대로 만들 수 있다 — 초대 화면이 등급 상승 창구가 된다')
  assert.equal(await rows(H.lead, invite('x4@x', 'Member', H.lead, 'Normal', `'{biz_vana}'`)), 'denied',
    '0026: 자기가 못 보는 회사를 초대로 붙여 줄 수 있다 — Business Isolation이 초대장으로 샌다')
  // 읽기: 초대자 본인 + 그 위. 아래·옆에서는 안 보인다.
  //   초대 행은 superuser로 심는다 — 읽기를 재는 자리라 '누가 넣었나'는 invited_by 칸이
  //   말하면 되고, 위임 insert 정책은 바로 위에서 따로 쟀다.
  await db.exec(invite('m2@x', 'Member', H.lead))
  assert.deepEqual(
    await ids(H.exec, `select email from user_invitations where email = 'm2@x'`),
    ['m2@x'],
    '0026: 상위 임원이 팀장의 초대를 못 본다 (초대 읽기 = 초대자 본인 + 그 위 subtree)',
  )
  assert.deepEqual(
    await ids(H.lead, `select email from user_invitations where email = 'm2@x'`),
    ['m2@x'],
    '0026: 초대자 본인이 자기 초대를 못 본다',
  )
  assert.deepEqual(
    await ids(H.staff, `select email from user_invitations where email = 'm2@x'`),
    [],
    '0026: 직원이 팀장의 초대를 본다 — 초대 읽기가 아래로 열렸다',
  )
  assert.deepEqual(
    await ids(H.buyer, `select email from user_invitations where email = 'm2@x'`),
    [],
    '0026: 구매팀장이 영업팀장의 초대를 본다 — 초대 읽기가 옆으로 열렸다',
  )

  // 결재 큐가 실제로 막는가. 초대 → 계정 생성 → 권한이 붙지 않는다 → 회장 승인 → 붙는다.
  const invitee = '00000000-0000-0000-0000-000000000031'
  await db.exec(`
    ${invite('queue@x', 'Executive', H.lead)};
    insert into auth.users values ('${invitee}', 'queue@x');
  `)
  assert.deepEqual(
    await rows<{ n: number }>(UID.chairman, `select count(*)::int as n from user_profiles where user_id = '${invitee}'`),
    [{ n: 0 }],
    '0026: 회장 결재 전인 Executive 초대가 계정 생성만으로 수락됐다 (d) — 결재 큐가 아무것도 막지 않는다',
  )
  assert.deepEqual(
    await rows<{ n: number; boss: string }>(UID.chairman,
      `select count(*)::int as n, min(reports_to::text) as boss from user_profiles where user_id = '${invitee}'`,
      `update user_invitations set chairman_approved_at = now() where email = 'queue@x'`),
    [{ n: 1, boss: H.lead }],
    '0026: 회장이 승인해도 권한이 붙지 않는다 (d) — 계정이 먼저 생긴 초대를 이어받을 입구가 없다',
  )
  // 승인 칸은 회장만 채운다. 둘로 막혀 있고 둘 다 잰다.
  //   ① 정책 — 0011의 user_invitations_admin이 update를 회장으로 묶는다. 초대자가 자기
  //      초대를 승인하려 하면 예외가 아니라 **0행**이다(RLS가 행을 안 내준다).
  assert.deepEqual(
    await rows<{ pending: boolean }>(H.lead,
      `select chairman_approved_at is null as pending from user_invitations where email = 'queue@x'`,
      `update user_invitations set chairman_approved_at = now() where email = 'queue@x'`),
    [{ pending: true }],
    '0026: 초대자가 자기 초대를 스스로 승인할 수 있다 — 결재가 아니라 자기 확인이 된다',
  )
  //   ② 트리거 — RLS 밖(마이그레이션·SQL 편집기처럼 auth.uid()가 없는 세션)에서도 막는다.
  //      정책 하나에만 기대면 나중에 update 정책을 넓히는 날 이 문이 같이 열린다.
  await assert.rejects(
    db.exec(`update user_invitations set chairman_approved_at = now() where email = 'm2@x'`),
    /Chairman만/,
    '0026: RLS를 우회하는 세션에서 승인 도장을 찍을 수 있다',
  )
  // Member 초대는 계정이 생기는 순간 그대로 수락된다(0011의 성질을 0026이 깨지 않았다).
  const member2 = '00000000-0000-0000-0000-000000000032'
  await db.exec(`
    ${invite('now@x', 'Member', H.lead)};
    insert into auth.users values ('${member2}', 'now@x');
  `)
  assert.deepEqual(
    await rows<{ n: number; boss: string }>(UID.chairman,
      `select count(*)::int as n, min(reports_to::text) as boss from user_profiles where user_id = '${member2}'`),
    [{ n: 1, boss: H.lead }],
    '0026: 결재가 필요 없는 초대까지 멈췄다 — 0011의 "계정이 생기면 바로 들어온다"가 깨졌다',
  )

  // ── f. 팀장 부재 → 상위 승계 ───────────────────────────────────────
  await db.exec(`update teams set lead_user_id = '${H.lead}' where team_id = 'team_dy_sales'`)
  // 기준선을 먼저 잰다. hierarchy()의 '퇴사자가 경로를 안 끊는다' 검사가 이미 한 번
  // 팀장을 내보냈다 가 되돌렸고, 그때도 승계 트리거가 돌아 감사 행을 남겼다 —
  // 절대값으로 재면 그 검사를 고칠 때마다 여기가 같이 빨개진다.
  const auditBase = (await db.query<{ n: number }>(
    `select count(*)::int as n from audit_log where action = 'permission_change' and entity_id = '${H.lead}'`,
  )).rows[0].n
  const succession = `
    select (select reports_to::text from user_profiles where user_id = '${H.staff}') as staff_boss,
           (select reports_to::text from user_profiles where user_id = '${H.peer}')  as peer_boss,
           (select lead_user_id::text from teams where team_id = 'team_dy_sales')    as team_lead,
           (select count(*)::int from audit_log
             where action = 'permission_change' and entity_id = '${H.lead}')         as audits`
  assert.deepEqual(
    await rows(UID.chairman, succession,
      `update user_profiles set revoked_at = now(), status = 'left' where user_id = '${H.lead}'`),
    [{ staff_boss: H.exec, peer_boss: H.exec, team_lead: H.exec, audits: auditBase + 1 }],
    '0026: 팀장을 회수해도 아래 사람과 팀장 자리가 상위로 올라가지 않는다 (f)',
  )
  // 올릴 상사가 없으면 트리를 끊지 않고 그대로 둔다(0026 5절의 명시적 판단).
  assert.deepEqual(
    await rows(UID.chairman,
      `select (select reports_to::text from user_profiles where user_id = '${H.lead}')  as lead_boss,
              (select reports_to::text from user_profiles where user_id = '${H.buyer}') as buyer_boss`,
      `update user_profiles set revoked_at = now() where user_id = '${H.exec}'`),
    [{ lead_boss: H.exec, buyer_boss: H.exec }],
    '0026: 뿌리가 나갔을 때 그 아래 가지를 끊었다 (5절: 트리를 끊는 것보다 조직도에 경고로 남는 편이 낫다)',
  )
}

/**
 * 0028 — 화면 층이 요구한 문 둘과 칸 셋.
 *
 * 블록 B·C(화면)는 정책을 다시 구현하지 않는다. 그래서 여기서 재는 것도 '화면이 맞나'가
 * 아니라 **화면이 기대는 DB의 성질**이다. 둘 다 앞의 검사들이 세워 둔 트리 위에서 잰다
 * (subtreeRls가 쓰는 그 DB다 — 두 벌을 만들면 "DB에서는 되는데 화면에서는 안 된다"를
 * 매번 새로 조사하게 된다).
 *
 *   ① company_progress()  회사 진행률은 **보는 사람에 따라 달라지지 않는다.**
 *      0027이 projects를 잘랐기 때문에, 화면이 목록에서 평균을 내면 같은 회사 카드가
 *      사람마다 다른 숫자가 된다. 그 두 값이 실제로 다르다는 것까지 같이 잰다 —
 *      다르지 않으면 이 단언은 아무것도 재지 못한다.
 *   ② company_people()    공유 대상 검색. 옆 가지가 보여야 하고(검증 c의 전제),
 *      남의 회사·나간 사람·시스템 계정은 보이지 않아야 하며, **칸이 셋뿐**이어야 한다.
 *   ③ 초대장의 새 칸 셋이 계정 생성 시점에 프로필로 옮겨지는가.
 *   ④ 'ECOUNT Sync' → 'Integration'. 0028을 한 번 더 적용해서 잰다(그 파일은 재적용해도
 *      안전하게 썼다).
 */
async function orgScreen(db: Db) {
  async function rows<T extends object>(uid: string, sql: string): Promise<T[]> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      return (await db.query<T>(sql)).rows
    } finally {
      await db.exec('rollback')
    }
  }
  const one = async <T>(uid: string, sql: string): Promise<T> => {
    const r = await rows<Record<string, T>>(uid, sql)
    return r.length ? Object.values(r[0])[0] : (null as T)
  }

  // ── ① 회사 진행률 ────────────────────────────────────────────────
  //   두 프로젝트에 서로 다른 값을 박아 '잘린 목록의 평균'과 '회사 전체 평균'이 실제로
  //   갈리게 만든다. 같아지면 아래 단언이 통과해도 아무것도 재지 못한다.
  await db.exec(`
    update projects set progress_pct = 40 where project_id = 'prj_sales';
    update projects set progress_pct = 80 where project_id = 'prj_buy';
  `)
  const whole = (await db.query<{ v: number }>(
    `select round(avg(progress_pct))::int as v from projects where business_id = 'biz_dy'`,
  )).rows[0].v

  const progressFor = (uid: string) => one<number>(uid, `select company_progress('biz_dy') as v`)
  // 화면이 예전에 하던 계산 — 자기에게 보이는 목록의 평균.
  const visibleAvg = (uid: string) =>
    one<number>(uid, `select round(avg(progress_pct))::int as v from projects where business_id = 'biz_dy'`)

  assert.notEqual(
    Number(await visibleAvg(H.staff)), Number(whole),
    '0028: 이 실험의 전제가 깨졌다 — 직원에게 보이는 프로젝트의 평균과 회사 전체 평균이 같으면 company_progress()가 무엇을 고쳤는지 잴 수 없다',
  )
  assert.equal(Number(await progressFor(H.staff)), Number(whole),
    '0028: 영업 직원이 보는 회사 진행률이 회사 전체 평균이 아니다 — 회사 카드의 숫자가 보는 사람마다 달라진다(회의에서 둘 중 하나가 틀렸다는 것조차 모른 채 인용된다)')
  assert.equal(Number(await progressFor(H.lead)), Number(whole),
    '0028: 영업팀장이 보는 회사 진행률이 회사 전체 평균이 아니다')
  assert.equal(Number(await progressFor(H.exec)), Number(whole),
    '0028: 임원이 보는 회사 진행률이 회사 전체 평균이 아니다')
  // 회사 격리는 함수 안에서 그대로 진다. keyhole은 다섯 번째 겹만 비켜서는 문이다.
  assert.equal(await one<number>(H.staff, `select company_progress('biz_vana') as v`), null,
    '0028: 못 보는 회사의 진행률이 나온다 — company_progress()가 has_business()를 잃었다(keyhole이 창이 됐다)')

  // ── ② 공유 대상 검색 ─────────────────────────────────────────────
  //   남의 회사 사람 하나와 나간 사람 하나를 심는다. 둘 다 후보가 아니어야 한다.
  // 41번대를 쓴다. 31·32는 0026 절의 초대 검사가 이미 쓴 번호다.
  const OUTSIDER = '00000000-0000-0000-0000-000000000041'
  const LEAVER = '00000000-0000-0000-0000-000000000042'
  await db.exec(`
    insert into auth.users values ('${OUTSIDER}', 'out@x'), ('${LEAVER}', 'left@x');
    insert into user_profiles (user_id, role, display_name, display_name_en, reports_to, status) values
      ('${OUTSIDER}', 'Member', '남의 회사 영업', 'Vana Sales', null, 'active'),
      ('${LEAVER}',   'Member', '영업 퇴사자',   null,          '${H.lead}', 'left');
    insert into user_business_access values ('${OUTSIDER}', 'biz_vana'), ('${LEAVER}', 'biz_dy');
  `)
  const names = async (uid: string, q: string) =>
    (await rows<{ display_name: string }>(uid, `select display_name from company_people('${q}') order by display_name`))
      .map((r) => r.display_name)

  // 검증 c의 전제: 구매팀장에게 영업팀장은 **옆 가지**라 조직도에는 없다. 그런데도
  // 공유 대상으로는 고를 수 있어야 한다 — 고를 수 없으면 블록 C가 통째로 서지 못한다.
  assert.equal(
    (await rows(H.buyer, `select user_id from user_profiles where user_id = '${H.lead}'`)).length, 0,
    '0028: 이 실험의 전제가 깨졌다 — 구매팀장에게 영업팀장이 이미 보인다면 company_people()이 무엇을 여는지 잴 수 없다',
  )
  assert.ok((await names(H.buyer, '영업팀장')).includes('영업팀장'),
    '0028: 구매팀장이 영업팀장을 공유 대상으로 찾지 못한다 — 옆 가지로 공유하는 길이 닫혔다(회장 지시 검증 c가 화면에서 성립하지 않는다)')
  assert.deepEqual(await names(H.lead, '남의 회사'), [],
    '0028: 공유 대상 검색이 회사를 넘는다 — company_people()이 has_business()를 잃었다')
  assert.deepEqual(await names(H.lead, '영업 퇴사자'), [],
    '0028: 나간 사람이 공유 대상으로 나온다 — 나간 사람에게 문서를 여는 것은 원칙 8을 정면으로 거스른다')
  assert.deepEqual(await names(H.lead, '영업팀장'), [],
    '0028: 자기 자신이 공유 대상 목록에 있다 — 자기에게 공유하는 일은 없다')
  assert.deepEqual(await names(H.lead, ''), [],
    '0028: 빈 질의에 사람이 나온다 — 이 문은 검색이지 목록 조회가 아니다(회사 사람을 통째로 훑는 창구가 된다)')
  assert.deepEqual(await names(H.lead, 'sync'), [],
    '0028: 시스템 계정이 공유 대상으로 나온다 — 야간 Job·동기화 계정에 사람이 문서를 여는 일은 없다')

  // 칸이 셋뿐인가. 다음 사람이 역할이나 이메일을 하나 더 붙이면 이 문은 조직도를
  // 우회하는 창이 된다(0028 머리 주석). 그 순간 여기가 빨개진다.
  const shape = await rows<Record<string, unknown>>(H.lead, `select * from company_people('영업') limit 1`)
  assert.deepEqual(Object.keys(shape[0] ?? {}).sort(), ['display_name', 'display_name_en', 'user_id'],
    '0028: company_people()이 이름 두 칸과 id 말고 다른 것을 내준다 — 좁은 문이 창이 됐다')

  // ── ③ 초대장의 새 칸 셋이 프로필로 옮겨지는가 ────────────────────
  const NEWBIE = '00000000-0000-0000-0000-000000000043'
  await db.exec(`
    insert into user_invitations (email, role, display_name, display_name_en, title_ko, business_ids,
                                  invited_by, reports_to, team_id, joined_on, language)
    values ('newbie@x', 'Member', '신입', 'New Joiner', '사원', array['biz_dy'],
            '${H.lead}', '${H.lead}', 'team_dy_sales', date '2026-03-02', 'en');
    insert into auth.users values ('${NEWBIE}', 'newbie@x');
  `)
  const applied = await db.query<{ en: string; joined: string; lang: string; team: string }>(
    `select display_name_en as en, joined_on::text as joined, language as lang, team_id as team
       from user_profiles where user_id = '${NEWBIE}'`,
  )
  assert.deepEqual(
    applied.rows,
    [{ en: 'New Joiner', joined: '2026-03-02', lang: 'en', team: 'team_dy_sales' }],
    '0028: 초대장의 이름(en)·입사일·표기 언어가 계정 생성 시점에 프로필로 옮겨지지 않는다 — 초대 폼이 받은 값이 어디에도 남지 않는다',
  )

  // ── ④ 'ECOUNT Sync' → 'Integration' ─────────────────────────────
  //   0028은 통째로 재적용해도 안전하게 썼다. 옛 이름을 심어 두고 한 번 더 적용한다.
  const SYNC = '00000000-0000-0000-0000-000000000044'
  await db.exec(`
    insert into auth.users values ('${SYNC}', 'sync2@x');
    insert into user_profiles (user_id, role, display_name) values ('${SYNC}', 'Integration', 'ECOUNT Sync');
  `)
  await applyOne(db, '0028_org_screen.sql')
  assert.equal(
    (await db.query<{ n: string }>(`select display_name as n from user_profiles where user_id = '${SYNC}'`)).rows[0].n,
    'Integration',
    "0028: 시스템 계정의 이름이 'ECOUNT Sync'로 남아 있다 — 이 값은 화면 문자열이 아니라 DB 값이라 마이그레이션이 고쳐야 한다(회장 지시 블록 B-6)",
  )
}

/**
 * 0026 0절 — 백필이 트리를 세우는가, 그리고 회장이 하나가 아닐 때 물러서는가.
 *
 * **왜 별도 인스턴스인가.** 이 검사의 입력은 '0026이 적용되는 순간의 user_profiles'다.
 * main()의 DB는 마이그레이션을 전부 돌린 뒤에 사람을 심으므로 그 순간 이 표가 비어 있어
 * 백필이 무엇을 했는지 원리적으로 잴 수 없다. 0001~0025까지만 적용하고, 사람을 심고,
 * 그 다음에 0026 한 장을 얹는다.
 *
 * **왜 이것이 이 파일에서 가장 중요한 단언 중 하나인가.** 0025 적용 직후 reports_to는
 * 전원 null이고, 그 상태에서 0026의 정책을 걸면 in_my_subtree()가 누구에게든 자기 자신
 * 하나만 준다 — 모든 화면이 빈다. 백필이 그 사이를 메운다. 백필이 조용히 0행을 처리하면
 * 마이그레이션은 성공으로 끝나고 다음 날 아침에야 알게 된다.
 */
async function subtreeBackfill() {
  const BEFORE = '0025_hierarchy.sql'
  const AFTER = '0026_subtree_rls.sql'
  const U = {
    chair: '00000000-0000-0000-0000-0000000000a1',
    chair2: '00000000-0000-0000-0000-0000000000a2',
    exec: '00000000-0000-0000-0000-0000000000a3',
    member: '00000000-0000-0000-0000-0000000000a4',
    gone: '00000000-0000-0000-0000-0000000000a5', // 회수된 사람 — 백필 대상이 아니다
    agent: '00000000-0000-0000-0000-0000000000a6', // 시스템 계정도 사람과 같이 붙는다
  }
  const people = (extraChairman: boolean) => `
    insert into auth.users values
      ('${U.chair}', 'c1@x'), ('${U.exec}', 'e@x'), ('${U.member}', 'm@x'),
      ('${U.gone}', 'g@x'), ('${U.agent}', 'ag@x')
      ${extraChairman ? `, ('${U.chair2}', 'c2@x')` : ''};
    insert into user_profiles (user_id, role, display_name) values
      ('${U.chair}', 'Chairman', '회장'),
      ('${U.exec}', 'Executive', '임원'),
      ('${U.member}', 'Member', '직원'),
      ('${U.agent}', 'AIAgent', '야간 Job')
      ${extraChairman ? `, ('${U.chair2}', 'Chairman', '회장2')` : ''};
    insert into user_profiles (user_id, role, display_name, revoked_at) values
      ('${U.gone}', 'Member', '나간 사람', now());
  `

  // ① 회장이 한 사람 — 활성 비(非)회장 전원이 회장 아래로 붙는다.
  {
    const db = new PGlite({ extensions: { pg_trgm } })
    await applyAll(db, BEFORE)
    await db.exec(people(false))
    const before = await db.query<{ n: number }>(`select count(*)::int as n from user_profiles where reports_to is null`)
    assert.equal(before.rows[0].n, 5, '전제가 깨졌다 — 0025 직후 reports_to는 전원 null이어야 한다')

    await applyOne(db, AFTER)
    const after = await db.query<{ user_id: string; boss: string | null }>(
      `select user_id::text, reports_to::text as boss from user_profiles order by user_id`,
    )
    const boss = new Map(after.rows.map((r) => [r.user_id, r.boss]))
    assert.equal(boss.get(U.exec), U.chair, '0026: 백필이 임원을 회장 아래로 붙이지 않았다 — 적용 즉시 모든 화면이 빈다')
    assert.equal(boss.get(U.member), U.chair, '0026: 백필이 직원을 회장 아래로 붙이지 않았다')
    assert.equal(boss.get(U.agent), U.chair, '0026: 백필이 시스템 계정을 빠뜨렸다 — 야간 Job이 자기 것 말고 아무것도 못 본다')
    assert.equal(boss.get(U.chair), null, '0026: 백필이 회장에게 상사를 붙였다 — 뿌리 위에는 아무도 없다')
    assert.equal(boss.get(U.gone), null, '0026: 백필이 회수된 사람까지 옮겼다 — 나갈 때 누구 밑이었나가 지워진다')

    // 그리고 그 트리 위에서 회장이 실제로 전원을 본다. 백필의 존재 이유가 이것이다.
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${U.chair}', true);`)
    const sees = await db.query<{ n: number }>(
      `select count(*)::int as n from user_profiles where in_my_subtree(user_id)`,
    )
    await db.exec('rollback')
    assert.equal(sees.rows[0].n, 4, '0026: 백필 뒤에도 회장의 subtree가 전원이 아니다 (회장 + 활성 3명)')
    await db.close()
  }

  // ② 회장이 둘 — 어느 쪽 밑에 붙일지 정할 수 없으므로 아무것도 하지 않는다.
  //    회장이 하나도 없는 경우는 main()의 DB가 아니라 여기서도 같은 갈래다
  //    (do 블록의 chairmen <> 1). 둘을 다 재는 이유는, '한 명일 때만 돈다'를
  //    '아무 때나 돈다'로 잘못 쓰면 ①만으로는 빨개지지 않기 때문이다.
  {
    const db = new PGlite({ extensions: { pg_trgm } })
    await applyAll(db, BEFORE)
    await db.exec(people(true))
    await applyOne(db, AFTER)
    const n = await db.query<{ n: number }>(`select count(*)::int as n from user_profiles where reports_to is not null`)
    assert.equal(n.rows[0].n, 0,
      '0026: 회장이 둘인데 백필이 돌았다 — 마이그레이션이 어느 회장 밑인지를 지어냈다')
    await db.close()
  }
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
/** 0027·0034의 실험에 쓰는 넷. rls()/H의 번호와 섞이지 않게 b번대를 쓴다. */
const OW = {
  boss: '00000000-0000-0000-0000-0000000000b1',
  worker: '00000000-0000-0000-0000-0000000000b2',
  /** 0034. 회장 직속 그룹 CFO — 회장과 같은 %를 보아야 하는 사람이다. */
  cfo: '00000000-0000-0000-0000-0000000000b3',
  /** 0034. 회장 직속 대표. 이 사람이 **기안자**라 0026의 다섯째 겹이 실제로 걸린다. */
  drafter: '00000000-0000-0000-0000-0000000000b4',
}

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
  //
  // projects가 여기 끼어 있는 이유는 0027이다. 0002:194가 걸고 0003:595가 다시 건 force를
  // 0027 1절이 내린다 — 그러지 않으면 project_business_id()가 production에서만 null을 준다.
  // 누가 그것을 되살리면 이 줄이 빨개진다.
  //
  // user_settings가 여기 끼어 있는 이유는 0029다. 0002:201이 건 force를 0029 3절이 내린다 —
  // 그러지 않으면 chairman_brief_timezone()이 AIAgent 세션에서 0행을 주고, 시간대가 조용히
  // 'Asia/Seoul'로 떨어져 회장이 뉴욕에 있어도 알림은 서울 06시에 간다. 화면에는 '자동'이라
  // 적혀 있으니 아무도 고장을 의심하지 않는다.
  //
  // decisions가 여기 끼어 있는 이유는 0034다. 0002:196이 걸고 0003:597이 시드 뒤에 다시 건
  // force를 0034 2절이 내린다 — 그러지 않으면 founder_dependency_rows()가 소유자 권한으로
  // 돌면서 decisions_read(0026의 다섯째 겹) 아래로 내려가고, **회사의 의존도가 계정마다
  // 다른 %**로 보인다. 그리고 PGlite harness는 superuser라 그 상태를 그냥 통과시킨다.
  const forced = await db.query<{ relname: string; f: boolean }>(
    `select relname, relforcerowsecurity as f from pg_class
      where relname in ('chairman_kakao_token', 'chairman_checkins', 'projects', 'user_settings', 'chairman_brief_sends', 'decisions')`,
  )
  // 행 수부터 잰다 — 표 이름이 바뀌거나 오타가 나면 위 쿼리가 0행을 주고, 아래 for는
  // 그냥 공회전하며 통과해 버린다(무엇도 단언하지 않은 채). 여섯을 정확히 찾았는지가 먼저다.
  assert.equal(forced.rows.length, 6, `0023/0027/0029/0034: force 검사가 표 여섯을 못 찾는다 (${forced.rows.map((r) => r.relname).join(', ') || '0개'})`)
  for (const row of forced.rows) {
    assert.equal(
      row.f,
      false,
      row.relname === 'projects'
        ? '0027: projects에 force row level security가 되살아났다 — project_business_id()가 소유자 권한으로 돌면서 정책 아래로 내려가 조용히 null을 주고, 직원의 업무 화면이 production에서만 빈다(0027 1절)'
        : row.relname === 'decisions'
          ? '0034: decisions에 force row level security가 되살아났다 — founder_dependency의 집계 문이 소유자 권한으로 돌면서 정책 아래로 내려가, 회사의 의존도가 계정마다 다른 %로 보인다'
          : row.relname === 'user_settings' || row.relname === 'chairman_brief_sends'
            ? `0029: ${row.relname}에 force row level security가 걸려 있다 — 아침 알림의 시간대 keyhole이 AIAgent 세션에서 0행을 주고, 회장이 어디 있든 서울 06시에 알림이 간다(0029 3절)`
            : `0023: ${row.relname}에 force row level security가 걸려 있다 (definer 함수가 0행을 준다)`,
    )
  }

  // 반대쪽 단언 하나. **audit_log에는 force가 있어야 한다.**
  // 0034 6절이 backfill을 위해 같은 트랜잭션 안에서 잠깐 열었다 닫는다 — 그 창이 닫힌 채로
  // 커밋됐음을 다음 사람이 여기서 확인한다. 0031 2절이 이 표의 force를 내리기를 거절하고
  // activity_digest를 지은 판단이 이 한 줄이고, 그 표에는 열람 기록(read·login)이 있다.
  const auditForced = await db.query<{ f: boolean }>(
    `select relforcerowsecurity as f from pg_class where relname = 'audit_log'`,
  )
  assert.equal(auditForced.rows.length, 1, '0034: audit_log를 못 찾는다 — 이 단언이 아무것도 재지 못한다')
  assert.equal(
    auditForced.rows[0].f,
    true,
    '0034: audit_log에서 force row level security가 사라졌다 — 6절의 backfill 창이 열린 채로 닫히지 않았거나 누가 영구히 내렸다. 그 표에는 누가 언제 무엇을 열어 봤나(read·login)가 쌓이고, 0031 2절이 지키려던 것이 이 한 줄이다',
  )

  // 표와 definer 함수를 BYPASSRLS 없는 역할에게 넘긴다. Supabase에서 소유자가 무엇이든
  // 이 조건에서 동작해야 한다는 것이 요구다 — 소유자의 bypassrls에 기대지 않는다.
  await db.exec(`
    create role app_owner nosuperuser nobypassrls nologin;
    grant usage on schema auth to app_owner;
    -- 0027 ②의 대조군을 성립시키는 줄이다. force를 되살리면 app_owner가 projects_read
    -- **아래로** 내려가고, 그 정책은 in_my_subtree() 같은 헬퍼를 부른다 — 실행 권한이
    -- 없으면 0행이 아니라 42501이 나서 "조용히 빈다"가 "시끄럽게 터진다"로 바뀐다.
    -- Supabase에서는 표와 헬퍼의 소유자가 같은 역할(postgres)이라 이 권한이 원래 있다.
    -- 0027의 위험은 '권한이 없다'가 아니라 '권한이 있는데도 0행'이고, 그쪽을 재야 한다.
    grant execute on all functions in schema public to app_owner;
    alter table public.chairman_kakao_token owner to app_owner;
    alter table public.chairman_checkins    owner to app_owner;
    alter function public.kakao_token_for_send()       owner to app_owner;
    alter function public.chairman_recent_condition()  owner to app_owner;
    -- 0029. 같은 실험을 아침 알림의 시간대 keyhole에도 건다.
    -- user_profiles까지 같이 넘기는 것은 Supabase를 흉내 내기 위해서다 — 거기서는 public의
    -- 표와 함수가 전부 postgres 한 소유자라 definer가 어느 표를 읽든 소유자로 읽는다.
    -- 여기서만 소유자가 갈리면, 재려던 것(user_settings의 FORCE)이 아니라 harness의
    -- 소유권 분할을 재게 된다.
    alter table public.user_settings        owner to app_owner;
    alter table public.user_profiles        owner to app_owner;
    alter table public.chairman_brief_sends owner to app_owner;
    alter function public.chairman_brief_timezone()    owner to app_owner;
    -- 0027. 같은 실험을 projects/project_business_id()에도 건다. 0026이 이 길을 아예
    -- 피한 이유가 정확히 이 함정이었고(0026 2-2절 ①), 0027은 force를 먼저 내리는 것으로
    -- 치웠다고 주장한다 — 그 주장을 여기서 실험으로 세운다.
    alter table public.projects                       owner to app_owner;
    alter function public.project_business_id(text)   owner to app_owner;
    -- 0034. 같은 실험을 decisions/founder_dependency_rows()에도 건다. 0033 9절이 이 길을
    -- 피한 이유가 정확히 이 함정이었고(그래서 뷰가 security_invoker였다), 0034 2절은
    -- force를 먼저 내리는 것으로 치웠다고 주장한다 — 그 주장을 여기서 실험으로 세운다.
    alter table public.decisions                      owner to app_owner;
    alter function public.founder_dependency_rows()   owner to app_owner;
    -- 세션들이 authenticated로 돌려면 schema usage가 필요하다(main()의 rls()가 하는 일).
    -- 표 권한은 STUBS의 default privileges가 이미 줬다.
    grant usage on schema public, auth to authenticated;
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

    -- 0029. 회장이 뉴욕을 손으로 골라 뒀고, 마지막 접속 기기는 런던이었다.
    -- 두 칸을 다르게 두는 것이 요점이다 — 같으면 keyhole이 어느 칸을 주는지 알 수 없다.
    insert into user_settings (user_id, brief_tz, current_tz)
    values ('${UID.chairman}', 'America/New_York', 'Europe/London');

    -- 0027. 팀장 하나 · 그 밑 직원 하나. 프로젝트는 팀장 것이고 업무는 직원 것이다 —
    -- 직원에게 프로젝트는 보이지 않고(0027 3절), 그래도 자기 업무는 보여야 한다(0027 2절).
    -- 회사 격리를 실제로 타게 하려고 직원은 Member다(전사 역할이면 has_business가 무조건
    -- true라 이 실험이 아무것도 재지 못한다).
    insert into auth.users values ('${OW.boss}', 'b1@x'), ('${OW.worker}', 'b2@x');
    insert into user_profiles (user_id, role, display_name, reports_to) values
      ('${OW.boss}',   'TeamLead', '팀장', null),
      ('${OW.worker}', 'Member',   '직원', '${OW.boss}');
    insert into user_business_access values ('${OW.worker}', 'biz_dy');
    insert into projects (project_id, business_id, name, owner_user_id)
    values ('prj_own', 'biz_dy', '팀장 프로젝트', '${OW.boss}');
    insert into tasks (task_id, project_id, title, owner_user_id)
    values ('tsk_own', 'prj_own', '직원 업무', '${OW.worker}');

    -- 0034. 회장 직속 둘: 그룹 CFO와, 결정을 기안하는 대표.
    -- 기안자가 **회장의 아래이면서 CFO의 아래가 아닌** 것이 이 실험의 전부다 —
    -- 0026의 다섯째 겹(in_my_subtree(created_by))이 그 차이에서만 갈린다.
    -- 소유자 칸이 비어 있으면 '회사 공통'으로 읽혀 누가 봐도 같은 값이 나오고,
    -- 그 시드로 재면 아래 단언은 아무것도 재지 못한 채 늘 초록이다.
    insert into auth.users values ('${OW.cfo}', 'b3@x'), ('${OW.drafter}', 'b4@x');
    insert into user_profiles (user_id, role, display_name, reports_to) values
      ('${OW.cfo}',     'GroupCFO',    '그룹 CFO', '${UID.chairman}'),
      ('${OW.drafter}', 'BusinessCEO', '기안 대표', '${UID.chairman}');
    insert into decisions (decision_id, business_id, title, status, decided_at, decided_by_kind, created_by) values
      ('d34_1', 'biz_dy', '회장이 정한 건', 'Approved', timestamptz '2026-08-10 12:00+09', 'chairman', '${OW.drafter}'),
      ('d34_2', 'biz_dy', 'CEO가 정한 건',  'Approved', timestamptz '2026-08-10 12:00+09', 'ceo',      '${OW.drafter}');
  `)

  async function rows(uid: string, sql: string): Promise<number> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      return (await db.query(sql)).rows.length
    } finally {
      await db.exec('rollback')
    }
  }
  /** 0027. 한 사람의 세션으로 첫 칸 값 하나를 받는다(건수가 아니라 '무엇을 받았나'를 잰다). */
  async function value<T>(uid: string, sql: string): Promise<T | null> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const r = await db.query<Record<string, T>>(sql)
      return r.rows.length ? (Object.values(r.rows[0])[0] ?? null) : null
    } finally {
      await db.exec('rollback')
    }
  }
  const forSend = 'select * from kakao_token_for_send()'
  const condition = 'select * from chairman_recent_condition()'
  const briefTz = 'select brief_tz from chairman_brief_timezone()'
  const deviceTz = 'select current_tz from chairman_brief_timezone()'
  const myTasks = `select count(*)::int from tasks where task_id = 'tsk_own'`
  const bizOf = `select project_business_id('prj_own')`
  const fdPct = `select dependency_pct from founder_dependency where business_id = 'biz_dy' and period = '2026-08'`

  // ① 지금 상태 — 07:00 cron이 실제로 밟는 경로다.
  assert.equal(await rows(UID.agent, forSend), 1,
    '0023: BYPASSRLS 없는 소유자에서 AIAgent가 kakao_token_for_send()로 토큰을 못 받는다 — 07:00 발송이 매일 조용히 skipped가 된다')
  assert.equal(await rows(UID.agent, condition), 1,
    '0023: BYPASSRLS 없는 소유자에서 AIAgent가 chairman_recent_condition()을 못 받는다 — 브리핑에서 컨디션 문장이 조용히 빠진다')
  // Chairman(테스트 발송)도 같은 조건에서 되는가. 이쪽만 되는 상태가 바로 숨은 실패 모드였다.
  assert.equal(await rows(UID.chairman, forSend), 1,
    '0023: BYPASSRLS 없는 소유자에서 Chairman의 테스트 발송이 토큰을 못 받는다')

  // ①-0029 아침 알림의 시간대. AIAgent가 회장의 두 칸을 받는가.
  //   못 받으면 예외가 아니라 null이고, 판정은 조용히 'Asia/Seoul'로 떨어진다 —
  //   회장이 뉴욕에 있어도 알림은 서울 06시(= 뉴욕 전날 17시)에 간다.
  assert.equal(await value<string>(UID.agent, briefTz), 'America/New_York',
    '0029: BYPASSRLS 없는 소유자에서 AIAgent가 chairman_brief_timezone()으로 ③ 수동 시간대를 못 받는다 — 매일 아침이 조용히 서울 시간으로 돌아간다(0029 3절)')
  assert.equal(await value<string>(UID.agent, deviceTz), 'Europe/London',
    '0029: AIAgent가 ① current_tz를 못 받는다 — 출장 일정을 안 넣은 날 시간대가 서울로 떨어진다')
  assert.equal(await value<string>(UID.chairman, briefTz), 'America/New_York',
    '0029: Chairman이 자기 설정을 keyhole로 못 받는다 — /settings/chairman의 "지금 판정" 한 줄이 빈다')

  // ①-0027 같은 조건에서 project_business_id()가 값을 주는가.
  //   0026 2-2절 ①이 "definer 헬퍼로 projects를 읽는 길은 안 된다"고 적은 근거가 이것이고,
  //   0027 1절이 force를 내려 그 근거를 없앴다고 주장한다. 주장을 여기서 실험으로 세운다.
  //   **호출자는 그 프로젝트를 볼 수 없는 직원이다** — definer가 호출자의 눈이 아니라
  //   소유자의 눈으로 회사 칸을 본다는 것이 요점이라, 볼 수 있는 사람으로 재면 아무 의미가 없다.
  assert.equal(await value<string>(OW.worker, bizOf), 'biz_dy',
    '0027: BYPASSRLS 없는 소유자에서 project_business_id()가 회사를 못 준다 — 0026 2-2절 ①의 함정 그대로다. projects의 force를 확인하라')
  assert.equal(await value<number>(OW.worker, myTasks), 1,
    '0027: BYPASSRLS 없는 소유자에서 직원이 자기 업무를 잃는다 — tasks_read의 회사 판정이 조용히 null을 받는다(production에서만 빈 화면이 된다)')
  // 겹이 실제로 걸려 있는 상태에서 잰 것인가. 프로젝트가 직원에게 보인다면 위 단언은
  // "겹이 없어서" 통과한 것일 수도 있다 — 그러면 아무것도 재지 못한 셈이다.
  assert.equal(await value<number>(OW.worker, `select count(*)::int from projects where project_id = 'prj_own'`), 0,
    '0027: 이 실험의 전제가 깨졌다 — 팀장의 프로젝트가 직원에게 보인다면 projects에 subtree 겹이 없는 것이고, 위 두 단언은 아무것도 재지 않는다')

  // ①-0034 **회사의 의존도가 보는 사람에 따라 달라지지 않는가.**
  //   0033 9절이 "definer로 우회하는 길은 만들지 않았다"며 감수한 대가가 정확히 이것이고,
  //   0034 2절이 decisions의 force를 내려 그 대가를 없앴다고 주장한다. 주장을 실험으로 세운다.
  //   **재는 사람은 그룹 CFO다** — 회장으로 재면 in_my_subtree(기안자)가 통과해서
  //   0026의 겹이 애초에 안 걸리고, 이 단언은 아무것도 재지 못한다.
  assert.equal(await value<string>(UID.chairman, fdPct), '50.0',
    '0034: 회장이 §7 지표를 못 받는다 — founder_dependency_rows()가 BYPASSRLS 없는 소유자에서 0행이다')
  assert.equal(await value<string>(OW.cfo, fdPct), '50.0',
    '0034: BYPASSRLS 없는 소유자에서 그룹 CFO가 회장과 다른 %를 본다 — 0026의 다섯째 겹이 집계에 끼어들었다. 회사의 의존도가 계정마다 달라지고, 회장은 둘 다 안 믿게 된다(0034 2·3절)')
  // 겹이 실제로 걸려 있는 상태에서 잰 것인가. 그 결정이 CFO에게 그냥 보인다면 위 단언은
  // "겹이 없어서" 통과한 것이고, 그러면 아무것도 재지 못한 셈이다.
  assert.equal(await value<number>(OW.cfo, `select count(*)::int from decisions where decision_id = 'd34_1'`), 0,
    '0034: 이 실험의 전제가 깨졌다 — 기안자가 붙은 결정이 그룹 CFO에게 직접 보인다면 decisions에 0026의 겹이 없는 것이고, 위 단언은 아무것도 재지 않는다')

  // ② 대조군 — force를 되살리면 정말 0행이 되는가. ①이 FORCE의 유무 때문임을 증명한다.
  await db.exec(`
    alter table public.chairman_kakao_token force row level security;
    alter table public.chairman_checkins    force row level security;
    alter table public.projects             force row level security;
    alter table public.user_settings        force row level security;
    alter table public.decisions            force row level security;
  `)
  assert.equal(await rows(UID.agent, forSend), 0,
    '대조군이 성립하지 않는다 — force를 걸어도 AIAgent가 토큰을 받는다면 ①은 FORCE를 재고 있지 않다')
  assert.equal(await rows(UID.agent, condition), 0,
    '대조군이 성립하지 않는다 — force를 걸어도 AIAgent가 컨디션을 받는다면 ①은 FORCE를 재고 있지 않다')
  assert.equal(await value<string>(OW.worker, bizOf), null,
    '대조군이 성립하지 않는다 — projects에 force를 걸어도 project_business_id()가 회사를 준다면 ①-0027은 FORCE를 재고 있지 않다')
  assert.equal(await value<number>(OW.worker, myTasks), 0,
    '대조군이 성립하지 않는다 — projects에 force를 걸어도 직원이 자기 업무를 본다면 ①-0027은 0026 2-2절 ①의 함정을 재고 있지 않다')
  assert.equal(await value<string>(UID.agent, briefTz), null,
    '대조군이 성립하지 않는다 — user_settings에 force를 걸어도 AIAgent가 시간대를 받는다면 ①-0029는 0029 3절이 내린 FORCE를 재고 있지 않다')
  // 0034. force를 되살리면 집계 문이 decisions_read 아래로 내려가, CFO에게는 그 달의
  // 행 자체가 사라진다(기안자가 붙은 두 건이 전부 안 보인다). 회장은 그대로 50.0%다 —
  // **같은 회사·같은 달이 계정마다 다른 값이 되는** 그 상태가 0033이 감수한 대가였다.
  assert.equal(await value<string>(OW.cfo, fdPct), null,
    '대조군이 성립하지 않는다 — decisions에 force를 걸어도 그룹 CFO가 같은 %를 본다면 ①-0034는 0034 2절이 내린 FORCE를 재고 있지 않다')
  assert.equal(await value<string>(UID.chairman, fdPct), '50.0',
    '대조군이 성립하지 않는다 — force를 건 뒤 회장까지 값을 잃으면 위 단언이 "계정마다 다르다"가 아니라 "아무도 못 본다"를 재게 된다')

  await db.close()
}

/**
 * Phase 5-E (0030) — 알림함·프로필·사이드바 주머니.
 *
 * **DB를 따로 세운다.** 위의 공용 db는 rls()가 authenticated에게 모든 표의
 * select/insert/update/delete를 한 번에 줘 버린 뒤라, 0030의 자물쇠(insert를 아무에게도
 * 주지 않고 update는 read_at 한 칸만)를 그 위에서는 잴 수 없다.
 * definerUnderNonBypassOwner()·subtreeBackfill()이 자기 DB를 세우는 것과 같은 이유다.
 *
 * 그리고 이 검사는 **0030이 적용되는 순간의 DB 상태**가 입력이다 — 0029까지 올린 뒤
 * 회장 행을 '홍성호'로 심고, 그 다음에 0030을 올려야 3절의 이름 교정이 재어진다.
 *
 * 재는 것 다섯.
 *   ① 알림함은 개인 우편함이다. 남의 것은 Chairman도 못 읽고, 아무도 만들지 못한다.
 *   ② 표가 kind와 link의 모양을 지킨다(바깥 주소는 알림을 피싱 통로로 만든다).
 *   ③ 본인이 자기 프로필 네 칸을 고칠 수 있고, **role은 그 문으로 지나가지 못한다.**
 *   ④ 0030이 회장 행의 이름을 고쳤고, 사람이 이미 고쳐 둔 이름은 덮지 않았다.
 *   ⑤ sidebar_prefs는 객체만 받는다(항목 이름은 DB가 모른다 — Phase 7이 갈아 끼워도 무관하게).
 */
const N30 = {
  chair: '00000000-0000-0000-0000-0000000030c0',
  member: '00000000-0000-0000-0000-0000000030d0',
  /** 이미 제 손으로 이름을 고쳐 둔 회장. 0030의 update가 이 값을 덮으면 안 된다. */
  chair2: '00000000-0000-0000-0000-0000000030c2',
}

/**
 * 0030 3절의 백필 update 세 줄만 **파일에서 잘라** 다시 돌린다.
 *
 * 손으로 베껴 쓰지 않는 것이 요점이다. 베껴 쓰면 마이그레이션의 where 조건을 고쳐도
 * 이 검사는 옛 문장을 돌려 계속 통과한다 — 음성 대조가 초록으로 나오는 전형적인 자리다.
 */
async function applyProfileBackfill(db: Db) {
  const sql = readFileSync(join(MIGRATIONS, '0030_notifications_profile.sql'), 'utf8')
  const updates = sql.match(/^update user_profiles[\s\S]*?;$/gm) ?? []
  assert.ok(updates.length >= 2,
    `0030 3절: 마이그레이션에서 user_profiles 백필 update를 못 찾았다 (${updates.length}개) — 검사가 파일을 못 따라가고 있다`)
  for (const one of updates) await db.exec(one)
}

async function notificationsAndProfile() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db, '0029_chairman_local_time.sql')

  // 0003_seed / bootstrap이 넣어 둔 상태를 흉내 낸다 — 회장 이름이 '홍성호'이고
  // display_name_en과 birth_date는 아직 없다.
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    insert into auth.users values
      ('${N30.chair}', 'ch30@x'), ('${N30.member}', 'm30@x'), ('${N30.chair2}', 'ch31@x');
    insert into user_profiles (user_id, role, display_name, title_ko) values
      ('${N30.chair}',  'Chairman', '홍성호', '회장'),
      ('${N30.member}', 'Member',   '영업 직원', '사원'),
      -- 이미 제 손으로 이름을 고쳐 둔 회장. **0030이 적용되기 전에** 있어야 한다 —
      -- 적용 뒤에 심으면 3절의 update가 이 행을 볼 기회조차 없어서, where 조건을 무엇으로
      -- 바꿔도 아래 단언이 통과해 버린다(음성 대조가 그것을 잡아냈다).
      ('${N30.chair2}', 'Chairman', '직접 고친 이름', '회장');
    update user_profiles set display_name_en = null where user_id = '${N30.chair}';
    insert into user_settings (user_id) values ('${N30.chair}'), ('${N30.member}');
  `)

  await applyOne(db, '0030_notifications_profile.sql')

  // ④ 이름 교정. 0003_seed.sql은 손대지 않았고(적용된 파일이다) DB 값만 앞으로 나아가며 고쳤다.
  const ch = await db.query<{ n: string; en: string | null; b: string | null }>(
    `select display_name as n, display_name_en as en, birth_date::text as b
       from user_profiles where user_id = '${N30.chair}'`,
  )
  assert.equal(ch.rows[0].n, '홍석현',
    "0030 3절: 회장 행의 이름이 '홍성호' 그대로다 — 헤더와 대시보드 인사말이 계속 옛 이름을 부른다")
  assert.equal(ch.rows[0].en, 'Edison S. Hong', '0030 3절: 회장 행의 영문 이름이 비어 있다')
  assert.equal(ch.rows[0].b, '1988-01-01', '0030 3절: 회장 행의 생년월일이 비어 있다')

  /**
   * ④ 사람이 이미 고쳐 둔 이름은 덮지 않는다.
   *
   * chair2는 0030이 적용되기 **전에** '직접 고친 이름'으로 서 있었다. 3절의 update가
   * `display_name = '홍성호'`를 where에 달고 있으므로 이 행에는 닿지 않아야 한다 —
   * 마이그레이션이 사람이 넣은 값을 되돌리는 것은 이 저장소에서 가장 되돌리기 어려운 사고다.
   */
  const ch2 = await db.query<{ n: string }>(
    `select display_name as n from user_profiles where user_id = '${N30.chair2}'`,
  )
  assert.equal(ch2.rows[0].n, '직접 고친 이름',
    '0030 3절: 사람이 손으로 고쳐 둔 회장 이름을 마이그레이션이 덮었다 — where의 display_name 조건이 그것을 막는 유일한 줄이다')

  /**
   * 생년월일 쪽도 같은 모양이어야 한다. 그런데 birth_date 칸 자체를 0030이 만들기 때문에
   * '적용 전에 값이 있는 회장'을 심을 수가 없다 — 그래서 3절의 update를 **한 번 더** 돌려
   * 재적용을 흉내 낸다. 이때 chair2는 이미 사람이 넣은 날짜를 갖고 있고, `birth_date is null`
   * 조건이 그 값을 지켜야 한다.
   */
  await db.exec(
    `update user_profiles set birth_date = date '1970-02-03' where user_id = '${N30.chair2}'`,
  )
  await applyProfileBackfill(db)
  const ch2b = await db.query<{ b: string }>(
    `select birth_date::text as b from user_profiles where user_id = '${N30.chair2}'`,
  )
  assert.equal(ch2b.rows[0].b, '1970-02-03',
    '0030 3절: 마이그레이션을 다시 적용하면 사람이 넣어 둔 생년월일을 덮는다 — where의 birth_date is null이 그것을 막는 유일한 줄이다')

  // 칸이 실제로 생겼는가. 아래 단언들이 이름을 조용히 놓치지 않게 먼저 본다.
  const cols = await db.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where (table_name = 'user_profiles' and column_name = 'birth_date')
         or (table_name = 'user_settings' and column_name in ('sidebar_prefs', 'app_prefs'))
         or (table_name = 'notifications' and column_name in
             ('notification_id','user_id','kind','title','body','link','read_at','created_at'))`,
  )
  assert.equal(cols.rows[0].n, 11,
    '0030: user_profiles.birth_date · user_settings.sidebar_prefs/app_prefs · notifications 여덟 칸 중 빠진 것이 있다')

  /**
   * force row level security를 새로 걸지 않았는가.
   *
   * 지금 이 표에는 definer 함수가 없어서 force가 걸려도 당장 깨지는 것은 없다. 그래도
   * 재는 이유는, 알림을 **만드는** 문(definer 함수)이 곧 여기 생기기 때문이다 —
   * 그때 force가 남아 있으면 그 함수가 소유자 권한으로 돌면서도 정책 아래로 내려가
   * 조용히 0행을 준다. 이 저장소가 0023·0027·0029에서 세 번 만난 함정이고, 세 번 다
   * production에서만 드러났다. 걸리기 전에 막는 것이 이 한 줄이다.
   */
  const forced = await db.query<{ f: boolean }>(
    `select relforcerowsecurity as f from pg_class where relname = 'notifications'`,
  )
  assert.equal(forced.rows.length, 1, '0030: notifications 표를 카탈로그에서 못 찾는다')
  assert.equal(forced.rows[0].f, false,
    '0030: notifications에 force row level security가 걸려 있다 — 이 저장소의 자물쇠는 revoke다(0023·0027·0029에서 세 번 만난 함정)')

  // 원문이 지목한 인덱스 그대로인가. 종이 매 화면 묻는 질문이 (내 것, 안 읽음, 최신순)이라
  // 세 칸이 이 순서여야 인덱스만으로 답한다.
  const idx = await db.query<{ d: string }>(
    `select indexdef as d from pg_indexes where indexname = 'notifications_by_user_unread'`,
  )
  assert.ok(idx.rows.length === 1 && /\(user_id, read_at, created_at DESC\)/i.test(idx.rows[0].d),
    `0030: notifications의 (user_id, read_at, created_at desc) 인덱스가 없거나 칸 순서가 다르다 — ${idx.rows[0]?.d ?? '인덱스 없음'}`)

  /** 표가 거절해야 하는 문장. 예외를 삼키고 '거절했나'만 돌려준다. */
  const rejects = async (sql: string) => {
    try {
      await db.exec(sql)
      return false
    } catch {
      return true
    }
  }
  const noti = (uid: string, kind: string, title: string, link: string) =>
    `insert into notifications (user_id, kind, title, link) values ('${uid}', '${kind}', '${title}', ${link});`

  // ② 표가 모양을 지킨다. 알림을 만드는 코드가 생기는 날 이 넷이 먼저 서 있어야 한다.
  assert.equal(await rejects(noti(N30.member, 'gossip', '제목', 'null')), true,
    '0030 1절: notifications.kind가 아무 문자열이나 받는다 — 화면이 모르는 종류를 그릴 방법이 없다')
  assert.equal(await rejects(noti(N30.member, 'system', '   ', 'null')), true,
    '0030 1절: 제목이 빈 알림이 들어간다 — 화면에 그릴 것이 없는 행이다')
  assert.equal(await rejects(noti(N30.member, 'system', '제목', `'https://evil.example/x'`)), true,
    '0030 1절: notifications.link가 바깥 주소를 받는다 — 알림을 만드는 것이 언젠가 서버가 되는데, 그때 알림이 피싱 통로가 된다')
  assert.equal(await rejects(noti(N30.member, 'system', '제목', `'//evil.example/x'`)), true,
    "0030 1절: notifications.link가 '//'로 시작하는 프로토콜 상대 주소를 받는다 — 브라우저는 그것도 바깥으로 읽는다")

  // 소유자 권한으로 두 사람에게 한 줄씩 심는다. 이 표에는 insert 문이 없으므로
  // (그것이 요구다) 세션으로는 넣을 수 없다 — 아래 ①이 그것을 잰다.
  await db.exec(noti(N30.member, 'system', '내 알림', `'/tasks'`) + noti(N30.chair, 'system', '회장 알림', 'null'))

  async function asUser<T>(uid: string, sql: string): Promise<T[]> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      return (await db.query<T>(sql)).rows
    } finally {
      await db.exec('rollback')
    }
  }

  // ① 개인 우편함. 남의 알림은 **Chairman도** 못 읽는다. 0002가 user_settings에 건 것과 같은 선이다 —
  //    '이 사람의 화면'에 속한 것은 권한 위계를 타지 않는다.
  const mine = await asUser<{ t: string }>(N30.member, `select title as t from notifications`)
  assert.equal(mine.length, 1, '0030 2절: 본인이 자기 알림을 못 읽거나 남의 알림까지 읽는다')
  assert.equal(mine[0].t, '내 알림', '0030 2절: 본인에게 남의 알림이 보인다 — 알림함은 개인 우편함이다')
  assert.equal((await asUser(N30.chair, `select 1 from notifications where user_id = '${N30.member}'`)).length, 0,
    '0030 2절: Chairman이 남의 알림함을 읽는다 — 알림은 업무 데이터가 아니라 그 사람의 화면이다(user_settings와 같은 선)')

  // ① 아무도 만들지 못한다. 만드는 쪽이 생기는 날 definer 함수 하나가 문이 된다.
  let inserted = true
  try {
    await asUser(N30.member, noti(N30.member, 'system', '내가 만든 알림', 'null'))
  } catch {
    inserted = false
  }
  assert.equal(inserted, false,
    '0030 2절: 본인이 자기 알림을 만들 수 있다 — 지금 알림을 만드는 것은 아무도 아니고, 문을 열어 두면 "실제 건수"가 아무 뜻도 없는 숫자가 된다')

  // ① 읽음 표시는 된다. 이것까지 막히면 뱃지가 영영 안 줄어든다.
  await db.exec(`begin; select set_config('request.jwt.claim.sub', '${N30.member}', true); set local role authenticated;`)
  const marked = (await db.query(`update notifications set read_at = now() where user_id = '${N30.member}' returning 1`)).rows.length
  await db.exec('rollback')
  assert.equal(marked, 1, '0030 2절: 본인이 자기 알림을 읽음 표시하지 못한다')

  // ③ 프로필 문. Member가 **자기** 네 칸을 고친다 — 0002의 user_profiles_admin_write는
  //    Chairman만 통과시키므로 이 문이 없으면 전 사용자 공통 프로필 설정이 성립하지 않는다.
  await db.exec(`begin; select set_config('request.jwt.claim.sub', '${N30.member}', true); set local role authenticated;`)
  const okName = (await db.query<{ ok: boolean }>(
    `select update_own_profile('새 이름', 'New Name', '대리', date '1991-05-06', 'en') as ok`,
  )).rows[0].ok
  await db.exec('commit')
  assert.equal(okName, true, '0030 4절: Member가 자기 프로필을 못 고친다 — 전 사용자 공통 프로필 설정이 성립하지 않는다')

  const m = await db.query<{ n: string; en: string; t: string; b: string; l: string; r: string }>(
    `select display_name as n, display_name_en as en, title_ko as t, birth_date::text as b,
            language as l, role::text as r
       from user_profiles where user_id = '${N30.member}'`,
  )
  assert.deepEqual(
    [m.rows[0].n, m.rows[0].en, m.rows[0].t, m.rows[0].b, m.rows[0].l, m.rows[0].r],
    ['새 이름', 'New Name', '대리', '1991-05-06', 'en', 'Member'],
    '0030 4절: update_own_profile()이 다섯 칸을 제대로 넣지 못했거나 role을 건드렸다',
  )

  // 모르는 표기 언어는 지금 값을 그대로 둔다. 0028의 check가 ko/en만 받으므로 여기서
  // 거르지 않으면 폼의 오타 하나가 23514로 올라와 저장 전체가 실패한다.
  await db.exec(`begin; select set_config('request.jwt.claim.sub', '${N30.member}', true); set local role authenticated;`)
  await db.query(`select update_own_profile('새 이름', 'New Name', '대리', date '1991-05-06', 'kr')`)
  await db.exec('commit')
  assert.equal(
    (await db.query<{ l: string }>(`select language as l from user_profiles where user_id = '${N30.member}'`)).rows[0].l,
    'en',
    '0030 4절: 모르는 표기 언어가 통과했다 — 0028의 check가 ko/en만 받으므로 폼의 오타 하나가 저장 전체를 실패시킨다')

  // ③ 이름 없는 프로필은 만들지 않는다. 예외가 아니라 false다(0023 save와 같은 절제).
  await db.exec(`begin; select set_config('request.jwt.claim.sub', '${N30.member}', true); set local role authenticated;`)
  const blank = (await db.query<{ ok: boolean }>(
    `select update_own_profile('   ', null, null, null, 'ko') as ok`,
  )).rows[0].ok
  await db.exec('rollback')
  assert.equal(blank, false,
    '0030 4절: 빈 이름을 받아들였다 — 화면 곳곳이 display_name의 첫 글자를 아바타로 쓴다. 빈 문자열이면 그 자리가 통째로 빈다')

  // ③ 직접 쓰기는 여전히 막혀 있다. 문이 생겼다고 표가 열린 것은 아니다.
  //    grant를 일부러 다 열어 둔 뒤에 잰다 — 막는 것이 grant가 아니라 정책임을 보이기 위해서다.
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
  `)
  assert.equal(
    (await asUser(N30.member, `update user_profiles set role = 'Chairman' where user_id = '${N30.member}' returning 1`)).length,
    0,
    '0030 4절: Member가 user_profiles를 직접 고쳐 자기 역할을 올릴 수 있다 — 0002 user_profiles_admin_write가 뚫렸다')

  // 생년월일의 최소선. 사람이 손으로 넣는 칸이라 1800년과 3000년은 오타다.
  assert.equal(await rejects(`update user_profiles set birth_date = date '1800-01-01' where user_id = '${N30.member}'`), true,
    '0030 3절: 1900년 이전의 생년월일이 들어간다')

  // ⑤ sidebar_prefs — 객체만. 배열이나 스칼라가 들어오면 읽는 쪽이 키를 찾다가 조용히 빈 설정이 된다.
  const pref = await db.query<{ p: string }>(
    `select sidebar_prefs::text as p from user_settings where user_id = '${N30.member}'`,
  )
  assert.equal(pref.rows[0].p, '{}', '0030 5절: sidebar_prefs의 기본값이 빈 객체가 아니다')

  const app = await db.query<{ p: string }>(
    `select app_prefs::text as p from user_settings where user_id = '${N30.member}'`,
  )
  assert.equal(app.rows[0].p, '{}', '0030 5절: app_prefs의 기본값이 빈 객체가 아니다')
  assert.equal(await rejects(`update user_settings set app_prefs = '"dark"'::jsonb where user_id = '${N30.member}'`), true,
    '0030 5절: app_prefs가 객체가 아닌 값을 받는다 — 읽는 쪽이 theme 키를 찾다가 조용히 라이트로 떨어진다')
  assert.equal(await rejects(`update user_settings set sidebar_prefs = '[]'::jsonb where user_id = '${N30.member}'`), true,
    '0030 5절: sidebar_prefs가 배열을 받는다 — 읽는 쪽이 키를 찾다가 조용히 빈 설정이 된다')

  // 모르는 키는 **DB가 거절하지 않는다.** 그것이 이 설계의 요점이다 — Phase 7이 사이드바 항목을
  // 통째로 갈아 끼워도 남아 있던 키가 마이그레이션을 부르지 않고, 화면이 조용히 무시한다.
  await db.exec(
    `update user_settings set sidebar_prefs = '{"hidden_items":["nav_crm","nav_gone"],"collapsed_groups":["grp_systems"]}'::jsonb
      where user_id = '${N30.member}'`,
  )
  const kept = await db.query<{ n: number }>(
    `select jsonb_array_length(sidebar_prefs -> 'hidden_items')::int as n
       from user_settings where user_id = '${N30.member}'`,
  )
  assert.equal(kept.rows[0].n, 2,
    '0030 5절: DB가 사이드바 항목 이름을 검사하기 시작했다 — 그러면 Phase 7이 목록을 갈아 끼울 때 마이그레이션이 따라와야 하고, 그것이 이 칸을 jsonb 주머니로 둔 이유를 무르는 일이다')

  await db.close()
}

/**
 * 화면이 말하는 마이그레이션 번호가 실제 마지막 파일과 같은가 (Phase 5-E 4절).
 *
 * `/settings`의 '이 웹에 대해' 절이 `src/lib/version.ts`의 LATEST_MIGRATION을 그대로 보여 준다.
 * 그 상수는 사람이 손으로 고치는 값이라 새 마이그레이션을 더하면서 빼먹기 쉽고, 빼먹으면
 * 화면이 조용히 한 번호 뒤처진 말을 한다 — '버전'이라고 적힌 칸에서 그것은 거짓말이다.
 *
 * version.ts를 import 하지 않고 **글자로 읽는다.** 그 파일은 'server-only'를 달고 있어서
 * RSC 바깥에서 import 하면 던진다.
 */
function latestMigrationConstant(files: string[]) {
  const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'version.ts'), 'utf8')
  const found = src.match(/LATEST_MIGRATION\s*=\s*'([^']+)'/)
  assert.ok(found, 'src/lib/version.ts에서 LATEST_MIGRATION을 못 찾았다')
  const last = (files.at(-1) ?? '').replace(/\.sql$/, '')
  assert.equal(found[1], last,
    `Phase 5-E: src/lib/version.ts의 LATEST_MIGRATION('${found[1]}')이 마지막 마이그레이션('${last}')과 다르다 — /settings의 '이 웹에 대해'가 조용히 틀린 번호를 말한다`)
}

async function main() {
  const db = new PGlite({ extensions: { pg_trgm } })
  const files = await applyAll(db)
  latestMigrationConstant(files)
  // rls()의 일괄 grant보다 **먼저**. 이유는 함수 주석에 있다.
  await kakaoRevokeSurvives(db)
  await standardChartSeed(db)
  await sheetOnlyView(db)
  await ledgerView(db)
  await rls(db)
  await hierarchy(db)
  await subtreeRls(db)
  await orgScreen(db)
  await briefLedger(db)
  await db.close()
  await notificationsAndProfile()
  await definerUnderNonBypassOwner()
  await subtreeBackfill()
  console.log(
    `PASS: ${files.length} migrations (${files[0]} → ${files.at(-1)}), standard chart seed, sheet-only view, SQL view = TS ledger, RLS by role, books, kakao revoke + definer under non-bypassrls owner, hierarchy (class_rank/cycle/subtree/shares), subtree RLS (a~f + 회사 격리 회귀) + 0026 backfill, 0027 projects subtree (직원 자기 업무 회귀 + project_business_id keyhole), 0028 org screen (company_progress/company_people keyhole + 초대 칸 + Integration 이름), 0029 아침 알림 현지 시간(시간대 keyhole + 현지 날짜 장부 + user_settings force 해제), 0030 알림함·프로필·사이드바 주머니(revoke + 칸 단위 update + 개인 우편함 + update_own_profile + 이름 교정), 0032 프로필 사진(비공개 버킷 + 본인만 쓰기 — 회장도 남의 얼굴은 못 바꾼다 + 이름 가시성과 같은 읽기 범위 + 어긋난 이름 차단 + update_own_photo)`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
