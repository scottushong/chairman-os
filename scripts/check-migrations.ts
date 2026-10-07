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
import { amountInvalid, approvalLine, pickApprovalLead, toChairman } from '../src/lib/approval-line'
import { bossChain, chainLine } from '../src/lib/approval-chain'
import type { ApprovalStep, ApprovalTemplate, Role } from '../src/types'
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
  const aiAgentBlockedTables = ['initiatives', 'initiative_keymen', 'initiative_docs', 'events', 'city_layout', 'notices', 'doc_folders']
  const integrationBlockedTables = ['initiatives', 'initiative_keymen', 'initiative_docs', 'events', 'initiative_notes', 'chairman_checkins', 'city_layout', 'notices', 'doc_folders']
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

  await cityLayout(db, as)
  await groupware(db, as)
  await googleToken(db, as)
  await eventVideo(db, as)
  await chat(db, as)
  await staffHome(db, as)

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
  // 체크인은 자연 키(날짜) 표라 0042 soft delete에서 빠졌다 — 지우기가 그대로다.
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

/**
 * 0037 city_layout — 그룹 시티 배치.
 *
 * 읽기는 그 줄의 주인을 볼 수 있는 사람(회사 줄 = has_business, 터 줄 = can_read_initiatives),
 * 쓰기는 Chairman만. 승격은 update 한 줄이고 감사에 «승격»으로 남는다. updated_by는
 * 화면이 무엇을 보내든 DB가 auth.uid()로 덮는다.
 *
 * **시드는 여기서 다시 돌린다.** applyAll 시점엔 Chairman이 없어 0037의 시드가 빠져나갔다 —
 * 0021이 production에서만 터졌던 길(0022)을 이 검사가 한 번 밟아 둔다.
 */
async function cityLayout(db: Db, as: As) {
  // 읽기용 줄을 소유자 권한으로 심는다. 회사 둘 + 이니셔티브 터 하나.
  await db.exec(`
    insert into initiatives (initiative_id, title, kind) values ('ini_city', '시티 터', 'NewBiz');
    insert into city_layout (business_id, initiative_id, x, y, w, h, updated_by) values
      ('biz_dy', null, 10, 10, 10, 10, '${UID.chairman}'),
      ('biz_vana', null, 30, 10, 10, 10, '${UID.chairman}'),
      (null, 'ini_city', 50, 50, 10, 10, '${UID.chairman}');
  `)
  const count = `select count(*)::int from city_layout`

  // 자물쇠는 revoke다(0035 규칙) — force를 걸지 않았고, anon은 표도 판정 함수도 못 쓴다.
  const lock = await db.query<{ forced: boolean; anon_select: boolean; anon_truncate: boolean; anon_fn: boolean }>(`
    select c.relforcerowsecurity as forced,
           has_table_privilege('anon', 'city_layout', 'select') as anon_select,
           has_table_privilege('anon', 'city_layout', 'truncate') as anon_truncate,
           has_function_privilege('anon', 'can_read_city_layout(text, text)', 'execute') as anon_fn
      from pg_class c where c.relname = 'city_layout'`)
  assert.deepEqual(
    lock.rows[0], { forced: false, anon_select: false, anon_truncate: false, anon_fn: false },
    '0037: city_layout에 force가 걸렸거나 anon에게 무엇인가 열려 있다 — 0035의 자물쇠 규칙(revoke)',
  )

  // 읽기 — 회사 격리와 이니셔티브 가림.
  assert.equal(await as(UID.chairman, count), 3, '0037: Chairman은 세 줄을 다 본다')
  assert.equal(await as(UID.cfo, count), 3, '0037: GroupCFO는 그룹 범위 + 이니셔티브 열람이라 셋')
  assert.equal(await as(UID.member, count), 1, '0037: Member(biz_dy)는 자기 회사 줄 하나만 — 남의 회사도 터도 안 보인다')
  assert.equal(await as(UID.ceo, count), 1, '0037: BusinessCEO(biz_vana)는 자기 회사 줄 하나만 — 터가 보이면 회장이 무엇을 준비하는지 샌다')
  assert.equal(
    await as(UID.ceo, `select count(*)::int from city_layout where initiative_id is not null`),
    0, '0037: BusinessCEO에게 이니셔티브 터가 보인다',
  )

  // 쓰기 — Chairman만.
  const insertHof = `insert into city_layout (business_id, x, y, w, h) values ('biz_hof', 1, 1, 5, 5)`
  assert.equal(await as(UID.chairman, insertHof), 1, '0037: Chairman이 배치를 못 만든다')
  for (const [who, uid] of [['GroupCFO', UID.cfo], ['BusinessCEO', UID.ceo], ['Member', UID.member], ['AIAgent', UID.agent], ['Integration', UID.integration]] as const) {
    assert.equal(await as(uid, insertHof), 'denied', `0037: ${who}가 도시 배치를 만든다`)
  }
  assert.equal(
    await as(UID.cfo, `update city_layout set x = 20 where business_id = 'biz_dy'`),
    0, '0037: GroupCFO가 도시를 옮긴다',
  )
  assert.equal(
    await as(UID.cfo, `delete from city_layout where business_id = 'biz_dy'`),
    0, '0037: GroupCFO가 도시에서 회사를 뺀다',
  )
  assert.equal(
    await as(UID.chairman, `update city_layout set x = 20, y = 30 where business_id = 'biz_dy'`),
    1, '0037: Chairman이 도시를 못 옮긴다',
  )

  // 모양 — DB가 막는다.
  await assert.rejects(
    as(UID.chairman, `insert into city_layout (x, y, w, h) values (1, 1, 5, 5)`),
    /city_layout_target_check/, '0037: 주인 없는 줄이 들어간다',
  )
  await assert.rejects(
    as(UID.chairman, `insert into city_layout (business_id, initiative_id, x, y, w, h) values ('biz_hof', 'ini_city', 1, 1, 5, 5)`),
    /city_layout_target_check/, '0037: 회사이면서 터인 줄이 들어간다',
  )
  await assert.rejects(
    as(UID.chairman, `insert into city_layout (business_id, x, y, w, h) values ('biz_hof', 95, 1, 10, 5)`),
    /city_layout_box_check/, '0037: 그림 밖으로 나간 상자가 들어간다',
  )
  await assert.rejects(
    as(UID.chairman, `insert into city_layout (business_id, x, y, w, h, stage_image) values ('biz_hof', 1, 1, 5, 5, 'rubble')`),
    /city_layout_stage_check/, '0037: 없는 단계가 들어간다',
  )
  await assert.rejects(
    as(UID.chairman, `insert into city_layout (business_id, x, y, w, h) values ('biz_dy', 1, 1, 5, 5)`),
    /city_layout_business_unique/, '0037: 한 회사가 도시에 두 번 선다',
  )

  // updated_by는 DB가 적는다 — 남의 id를 적어 보내도 Chairman 자신이 남는다.
  assert.equal(
    await as(
      UID.chairman,
      `select count(*)::int from city_layout where business_id = 'biz_hof' and updated_by = '${UID.chairman}'`,
      `insert into city_layout (business_id, x, y, w, h, updated_by) values ('biz_hof', 1, 1, 5, 5, '${UID.cfo}')`,
    ),
    1, '0037: updated_by를 남의 id로 적어 보내면 그대로 남는다 — 감사가 거짓말을 한다',
  )

  // 승격 — 같은 줄이 터에서 회사로. 감사에 «승격»이 남는다.
  assert.equal(
    await as(
      UID.chairman,
      `select count(*)::int from audit_log where entity_table = 'city_layout' and note like '그룹 시티 승격%'
         and after->>'business_id' = 'biz_hof' and after->>'stage_image' = 'foundation'`,
      `update city_layout set initiative_id = null, business_id = 'biz_hof', stage_image = 'foundation'
         where initiative_id = 'ini_city'`,
    ),
    1, '0037: 승격이 감사에 «승격»으로 남지 않는다',
  )

  // 이니셔티브가 지워지면 터도 사라진다(on delete cascade).
  await db.exec(`delete from initiatives where initiative_id = 'ini_city'`)
  const left = await db.query<{ n: number }>(`select count(*)::int as n from city_layout where initiative_id is not null`)
  assert.equal(left.rows[0].n, 0, '0037: 지워진 이니셔티브의 터가 남는다')

  // 시드 — Chairman이 있는 지금 0037의 시드 블록을 다시 돌린다. 이미 있는 두 회사는 그대로,
  // 나머지 셋이 들어와 다섯. 감사 트리거가 실제로 돈다(0022의 교훈).
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0037_city_layout.sql'), 'utf8')
  const seed = sql.slice(sql.indexOf('do $seed$'))
  await db.exec(seed)
  const seeded = await db.query<{ n: number }>(`select count(*)::int as n from city_layout where business_id is not null`)
  assert.equal(seeded.rows[0].n, 5, '0037: 시드가 다섯 회사를 다 세우지 않았다')
  const dy = await db.query<{ x: string }>(`select x::text from city_layout where business_id = 'biz_dy'`)
  assert.equal(Number(dy.rows[0].x), 10, '0037: 시드가 회장이 이미 둔 자리를 덮었다')

  // 0044 길목 — 모양은 DB가 막고, 점을 옮긴 update는 감사에 before/after로 남는다.
  const setAnchors = (json: string) => as(UID.chairman, `update city_layout set anchors = '${json}'::jsonb where business_id = 'biz_dy'`)
  assert.equal(await setAnchors('{}'), 1, '0044: 빈 길목(= 전부 상자에서)이 막힌다')
  assert.equal(await setAnchors('{"door":{"x":12.5,"y":80},"road":{"x":12,"y":99}}'), 1, '0044: 점 둘만 적은 길목이 막힌다')
  for (const [bad, why] of [
    ['{"gate":{"x":1,"y":1}}', '모르는 점 이름'],
    ['{"door":{"x":101,"y":1}}', '그림 밖 좌표'],
    ['{"door":{"x":"a","y":1}}', '문자열 좌표'],
    ['{"door":{"x":1}}', 'y가 빠진 점'],
    ['{"door":{"x":1,"y":1,"z":1}}', '키가 더 붙은 점'],
    ['[1,2]', '객체가 아닌 길목'],
  ] as const) {
    await assert.rejects(setAnchors(bad), /city_layout_anchors_check/, `0044: ${why}이(가) 들어간다`)
  }
  assert.equal(
    await as(UID.cfo, `update city_layout set anchors = '{}'::jsonb where business_id = 'biz_dy'`),
    0, '0044: GroupCFO가 길목을 옮긴다',
  )
  assert.equal(
    await as(
      UID.chairman,
      `select count(*)::int from audit_log where entity_table = 'city_layout'
         and before->'anchors'->'door'->>'x' = '12.5' and after->'anchors'->'desk'->>'y' = '40'`,
      // as()는 끝나면 되돌린다 — 앞 점과 옮긴 점을 한 트랜잭션에서 차례로 적는다.
      `update city_layout set anchors = '{"door":{"x":12.5,"y":80}}'::jsonb where business_id = 'biz_dy';
       update city_layout set anchors = '{"door":{"x":12.5,"y":80},"desk":{"x":14,"y":40}}'::jsonb where business_id = 'biz_dy';`,
    ),
    1, '0044: 길목을 옮긴 update가 감사 before/after에 안 보인다',
  )

  // 다음 검사가 빈 표를 전제할 수 있게 치운다.
  await db.exec(`delete from city_layout`)
}

/**
 * 0042 직원 홈 · 보안 — 원문 검증 «요청 → 팀장 승인 → 규칙 판정» · 원격 로그아웃 · 새 기기 알림 · 가입 확인.
 *
 * 팀장 L(TeamLead) 아래 기안자 R(Member). 팀장은 teams.lead_user_id로만 팀장이다(R이 L의 subtree가
 * 아니어도 결재선 첫 칸이면 읽고 정한다 — decisions_lead_read).
 */
async function staffHome(db: Db, as: As) {
  const S = { lead: '00000000-0000-0000-0000-0000000d6a01', req: '00000000-0000-0000-0000-0000000d6a02' }
  await db.exec(`
    insert into auth.users values ('${S.lead}', 'sl@x'), ('${S.req}', 'sr@x');
    insert into teams (team_id, business_id, name, name_en, lead_user_id) values ('team_6_2', 'biz_dy', '생산', 'Prod', '${S.lead}');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${S.lead}', 'TeamLead', '생산팀장', 'Normal', 'team_6_2'),
      ('${S.req}', 'Member', '생산직원', 'Normal', 'team_6_2');
    insert into user_business_access values ('${S.lead}', 'biz_dy'), ('${S.req}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write) values ('${S.req}', '/chairman/decisions', true)
      on conflict (user_id, module) do update set can_write = true; -- 0054: 새 프로필에는 트리거가 이미 붙였다
  `)
  const commitAs = async (uid: string, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const r = await db.query<{ v: string }>(sql)
      await db.exec('commit')
      return r.rows[0]?.v ?? null
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  const request = (id: string, tpl: string, form: string) =>
    `insert into decisions (decision_id, business_id, title, template_key, form, attachment_url, created_by)
       values ('${id}', 'biz_dy', '요청 ${id}', '${tpl}', '${form}'::jsonb, 'https://x/a', '${S.req}') returning decision_id as v`
  const small = '{"amount":"100000","purpose":"공구","spent_on":"2026-09-28"}'
  const big = '{"amount":"6000000","purpose":"설비","spent_on":"2026-09-28"}'
  // 0059부터 새 양식 결재는 단계 결재(상사 사슬)다. 이 검사는 **0059 전에 올라온 결재**(운영에 남은 «팀장 대기» ·
  // «대표 대기»)가 예전 길(lead_decide · 대표 처리)로 끝나는지를 잰다 — 0054가 만들던 모양 그대로 심는다(트리거를 잠시 끈다).
  const legacy = async (id: string, tpl: string, form: string, cr: boolean) => {
    const line = [{ step: 'lead', user_id: S.lead, name: '생산팀장', why: '팀장' }, { step: 'rule', user_id: null, name: '규칙 판정', why: 'x' },
      ...(cr ? [{ step: 'chairman', user_id: UID.chairman, name: '대표', why: '규칙이 대표까지 올린다' }] : [])]
    await db.exec(`alter table decisions disable trigger decisions_approval_line_trigger;
      insert into decisions (decision_id, business_id, title, template_key, form, attachment_url, created_by, status, lead_status, chairman_required, approval_line)
        values ('${id}', 'biz_dy', '요청 ${id}', '${tpl}', '${form}'::jsonb, 'https://x/a', '${S.req}', 'Open', 'pending', ${cr}, '${JSON.stringify(line)}'::jsonb);
      alter table decisions enable trigger decisions_approval_line_trigger;`)
  }
  void request
  await legacy('dec_62a', 'expense', small, false)
  await legacy('dec_62b', 'expense', big, true)
  await legacy('dec_62c', 'leave', '{"starts_on":"2026-10-01","ends_on":"2026-10-02"}', false)
  const row = async (id: string) =>
    (await db.query<{ status: string; lead_status: string; kind: string | null; cr: boolean }>(
      `select status::text, lead_status, decided_by_kind as kind, chairman_required as cr from decisions where decision_id = '${id}'`,
    )).rows[0]
  assert.deepEqual(await row('dec_62a'), { status: 'Open', lead_status: 'pending', kind: null, cr: false }, '0042: 요청이 팀장 대기로 서지 않는다')

  assert.equal(await as(S.lead, `select count(*)::int from decisions where decision_id in ('dec_62a', 'dec_62b', 'dec_62c')`), 3, '0042: 팀장이 자기 결재선의 요청을 못 읽는다')
  await assert.rejects(as(UID.member, `select lead_decide('dec_62a', true)`), /lead_forbidden|lead_not_found/, '0042: 팀장이 아닌 사람이 팀장 승인을 한다')

  assert.equal(await commitAs(S.lead, `select lead_decide('dec_62a', true) as v`), 'closed_by_rule', '0042: 10만 원 지출이 팀장 승인 뒤 규칙으로 종결되지 않는다')
  assert.deepEqual(await row('dec_62a'), { status: 'Approved', lead_status: 'approved', kind: 'rule', cr: false })
  assert.equal(await commitAs(S.lead, `select lead_decide('dec_62b', true) as v`), 'to_chairman', '0042: 600만 원 지출이 회장 큐로 가지 않는다')
  assert.deepEqual(await row('dec_62b'), { status: 'Open', lead_status: 'approved', kind: null, cr: true })
  assert.equal(await commitAs(S.lead, `select lead_decide('dec_62c', false) as v`), 'rejected', '0042: 팀장 반려가 닫히지 않는다')
  assert.deepEqual(await row('dec_62c'), { status: 'Rejected', lead_status: 'rejected', kind: 'ceo', cr: false })
  await assert.rejects(as(S.lead, `select lead_decide('dec_62a', true)`), /lead_not_pending/, '0042: 이미 정한 요청을 또 정한다')
  // 리뷰 C2 — 처음부터 «승인됨»으로 넣어도 Open으로 들어온다.
  await commitAs(S.req, `insert into decisions (decision_id, business_id, title, template_key, form, attachment_url, created_by, status, decided_by_kind)
    values ('dec_62e', 'biz_dy', '위조', 'expense', '${small}'::jsonb, 'https://x/a', '${S.req}', 'Approved', 'chairman') returning decision_id as v`)
  // 0059 — 새로 들어오는 결재는 단계 결재다(팀장 단계 없음). 생산직원은 상사가 없어 대표 한 칸.
  assert.deepEqual(await row('dec_62e'), { status: 'Open', lead_status: null, kind: null, cr: true }, '0042/0059: 기안자가 승인된 결재를 넣는다')
  await legacy('dec_62f', 'expense', small, false)
  // 리뷰 C1 — CEO(can_approve)는 팀장 대기 · 회장 큐를 건너뛰어 닫지 못한다. dy CEO를 잠시 만든다.
  await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-0000000d6a03', 'dc@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values ('00000000-0000-0000-0000-0000000d6a03', 'BusinessCEO', 'dyceo', 'Restricted');
    insert into user_business_access values ('00000000-0000-0000-0000-0000000d6a03', 'biz_dy');
    update decisions set created_by = '00000000-0000-0000-0000-0000000d6a03' where decision_id in ('dec_62f');`)
  await assert.rejects(
    as('00000000-0000-0000-0000-0000000d6a03', `update decisions set status = 'Approved' where decision_id = 'dec_62f'`),
    /lead_step_pending/, '0042: CEO가 팀장 대기 중인 요청을 건너뛰어 닫는다',
  )
  await assert.rejects(
    as(UID.chairman, `update decisions set status = 'Approved' where decision_id = 'dec_62e'`),
    /approval_use_steps/, '0059: 대표도 단계 결재를 approval_decide() 밖에서 닫는다',
  )
  await db.exec(`update decisions set created_by = '00000000-0000-0000-0000-0000000d6a03' where decision_id = 'dec_62b'`)
  await assert.rejects(
    as('00000000-0000-0000-0000-0000000d6a03', `update decisions set status = 'Approved' where decision_id = 'dec_62b'`),
    /chairman_required/, '0042: CEO가 회장 큐의 요청을 닫는다',
  )
  await db.exec(`update decisions set created_by = '${S.req}' where decision_id in ('dec_62b', 'dec_62f');
    update user_profiles set revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000d6a03';`)

  await assert.rejects(
    // 트리거를 잰다 — 역할과 상관없이(소유자 권한으로도) 설정 없이는 못 고친다.
    db.exec(`update decisions set lead_status = 'approved' where decision_id = 'dec_62c'`),
    /lead_step_frozen/, '0042: 팀장 단계 칸을 일반 update로 고친다',
  )

  // 회장 확인 요청(규칙과 상관없이 회장에게) + 취합.
  await legacy('dec_62d', 'expense', small, false)
  assert.equal(await commitAs(S.lead, `select lead_decide('dec_62d', true, true) as v`), 'to_chairman', '0042: 회장 확인 요청이 회장 큐로 가지 않는다')
  const bundle = await commitAs(S.lead, `select lead_bundle(array['dec_62b', 'dec_62d'], '생산팀 설비 · 공구 묶음') as v`)
  assert.ok(bundle, '0042: 회장 기안(취합)이 서지 않는다')
  await assert.rejects(as(S.req, `select lead_bundle(array['dec_62b', 'dec_62d'], 'x')`), /bundle_forbidden/, '0042: 팀장이 아닌 사람이 취합한다')
  await commitAs(UID.chairman, `update decisions set status = 'Approved', decided_at = now(), decided_by = '${UID.chairman}' where decision_id = '${bundle}' returning 'ok' as v`)
  const kids = await db.query<{ n: number }>(`select count(*)::int as n from decisions where bundle_id = '${bundle}' and status::text = 'Approved'`)
  assert.equal(kids.rows[0].n, 2, '0042: 회장이 묶음을 승인했는데 묶인 요청이 닫히지 않는다')

  // 가입 확인 — anon이 부를 수 있고, 초대된(열린) 이메일만 참.
  await db.exec(`insert into user_invitations (email, role, display_name, invited_by) values ('new.hire@dy.example', 'Member', '신입', '${UID.chairman}')`)
  const inv = await db.query<{ a: boolean; b: boolean; anon: boolean }>(`
    select invitation_open('New.Hire@dy.example') as a, invitation_open('stranger@x.com') as b,
           has_function_privilege('anon', 'invitation_open(text)', 'execute') as anon`)
  assert.deepEqual(inv.rows[0], { a: true, b: false, anon: true }, '0042: 가입 확인이 초대 이메일만 참이 아니다')
  // 0043 가입 Hook — 같은 판정을 Auth 서버 쪽에서. 초대면 {}, 아니면 403. Auth 서버만 부른다.
  const hook = (email: string) => `select before_user_created_hook('{"user":{"email":"${email}"}}'::jsonb)::text as v`
  const hookRows = await db.query<{ ok: string; no: string; blank: string; anon: boolean; authed: boolean; admin: boolean }>(`
    select before_user_created_hook('{"user":{"email":" New.Hire@DY.example "}}'::jsonb)::text as ok,
           before_user_created_hook('{"user":{"email":"stranger@x.com"}}'::jsonb) #>> '{error,http_code}' as no,
           before_user_created_hook('{"user":{"phone":"+8210"}}'::jsonb) #>> '{error,http_code}' as blank,
           has_function_privilege('anon', 'before_user_created_hook(jsonb)', 'execute') as anon,
           has_function_privilege('authenticated', 'before_user_created_hook(jsonb)', 'execute') as authed,
           has_function_privilege('supabase_auth_admin', 'before_user_created_hook(jsonb)', 'execute') as admin`)
  assert.deepEqual(hookRows.rows[0], { ok: '{}', no: '403', blank: '403', anon: false, authed: false, admin: true }, '0043: 가입 Hook이 초대 이메일만 통과시키지 않는다')
  // 리뷰 C3 — 초대를 지우면(soft_delete = 회수) 가입 확인도 거짓이 된다.
  const invId = (await db.query<{ id: string }>(`select invitation_id::text as id from user_invitations where email = 'new.hire@dy.example'`)).rows[0].id
  await commitAs(UID.chairman, `select soft_delete('user_invitations', '${invId}')::text as v`)
  const gone = await db.query<{ a: boolean }>(`select invitation_open('new.hire@dy.example') as a`)
  assert.equal(gone.rows[0].a, false, '0042: 지운 초대로 가입할 수 있다')
  const goneHook = await db.query<{ v: string }>(hook('new.hire@dy.example'))
  assert.match(goneHook.rows[0].v, /"http_code": 403/, '0043: 지운 초대로 가입 Hook을 통과한다')

  // 새 기기 — 이전 로그인 기기와 다르면 본인 알림 + 회장 큐. 같은 기기면 아무것도.
  await db.exec(`insert into audit_log (action, entity_table, entity_id, actor_user_id, actor_role, after)
    values ('login', 'auth.users', '${S.req}', '${S.req}', 'Member', '{"device":"Chrome · Windows","city":"Seoul"}')`)
  assert.equal(await commitAs(S.req, `select report_login_device('Chrome · Windows', 'Seoul')::text as v`), 'false', '0042: 같은 기기를 새 기기로 본다')
  assert.equal(await commitAs(S.req, `select report_login_device('Safari · iPhone', 'Busan')::text as v`), 'true', '0042: 새 기기를 못 알아본다')
  const alerts = `select count(*)::int from security_alerts where user_id = '${S.req}'`
  assert.equal(await as(UID.chairman, alerts), 1, '0042: 회장 큐에 새 기기 알림이 없다')
  assert.equal(await as(S.req, alerts), 0, '0042: 직원이 보안 알림 큐를 읽는다')
  const note = await db.query<{ n: number }>(`select count(*)::int as n from notifications where user_id = '${S.req}' and title like '새 기기%'`)
  assert.equal(note.rows[0].n, 1, '0042: 본인에게 새 기기 알림이 가지 않는다')
  assert.equal(await commitAs(S.req, `select report_login_device('Edge · Android', 'Daegu')::text as v`), 'false', '0042: 한 시간 안에 새 기기 알림이 또 쌓인다(회장 카톡 도배)')

  // 원격 로그아웃 — 회장만.
  assert.equal(await as(UID.cfo, `select force_logout('${S.req}')::int`), 0, '0042: CFO가 남을 원격 로그아웃시킨다')
  await commitAs(UID.chairman, `select force_logout('${S.req}')::text as v`)
  const sr = await db.query<{ n: number }>(`select count(*)::int as n from user_profiles where user_id = '${S.req}' and sessions_revoked_at is not null`)
  assert.equal(sr.rows[0].n, 1, '0042: 원격 로그아웃 시각이 적히지 않는다')
  const active = await as(S.req, `select is_active()::int`)
  assert.equal(active, 0, '0042: 원격 로그아웃 뒤에도(그 전 로그인의 토큰) is_active()가 참이다 — DB에서도 끊겨야 한다')


  await db.exec(`
    delete from user_module_access where user_id = '${S.req}';
    delete from user_business_access where user_id in ('${S.lead}', '${S.req}');
    update user_profiles set team_id = null, revoked_at = now(), status = 'left' where user_id in ('${S.lead}', '${S.req}');
    delete from teams where team_id = 'team_6_2';
    delete from user_invitations where email = 'new.hire@dy.example';
  `)
}

/**
 * 0041 메신저 · AI 대화 — 원문 검증 «직원 세션으로 팀 채널 메시지 → 다른 팀 안 보임».
 *
 * 한 회사(biz_dy)에 팀 둘(A · B). A: 팀장 leadA, 팀원 memA(→ leadA → execDy). B: 팀원 memB.
 * execDy는 A의 위(subtree)라 A 방이 보이고, B와는 줄이 없어 B 방은 안 보인다.
 */
async function chat(db: Db, as: As) {
  const C = {
    memA: '00000000-0000-0000-0000-0000000c0a01',
    memB: '00000000-0000-0000-0000-0000000c0b01',
    leadA: '00000000-0000-0000-0000-0000000c0a00',
    execDy: '00000000-0000-0000-0000-0000000c0e00',
  }
  await db.exec(`
    insert into auth.users values ('${C.memA}', 'ma@x'), ('${C.memB}', 'mb@x'), ('${C.leadA}', 'la@x'), ('${C.execDy}', 'ex@x');
    insert into teams (team_id, business_id, name, name_en, lead_user_id) values
      ('team_chat_a', 'biz_dy', '채팅A', 'ChatA', '${C.leadA}'),
      ('team_chat_b', 'biz_dy', '채팅B', 'ChatB', null);
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id, reports_to) values
      ('${C.execDy}', 'Executive', 'exec', 'Restricted', null, null),
      ('${C.leadA}', 'TeamLead', 'leadA', 'Normal', 'team_chat_a', '${C.execDy}'),
      ('${C.memA}', 'Member', 'memA', 'Normal', 'team_chat_a', '${C.leadA}'),
      ('${C.memB}', 'Member', 'memB', 'Normal', 'team_chat_b', null);
    insert into user_business_access values ('${C.execDy}', 'biz_dy'), ('${C.leadA}', 'biz_dy'), ('${C.memA}', 'biz_dy'), ('${C.memB}', 'biz_dy');
  `)
  // 채널을 연다(커밋해야 뒤의 as()가 본다) — 각자 자기 세션으로.
  const commitAs = async (uid: string, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const r = await db.query<{ v: string }>(sql)
      await db.exec('commit')
      return r.rows[0]?.v ?? null
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  await commitAs(C.memA, `select ensure_chat_channels()::text as v`)
  await commitAs(C.memB, `select ensure_chat_channels()::text as v`)
  const idOf = async (team: string) =>
    (await db.query<{ id: string }>(`select channel_id::text as id from chat_channels where team_id = '${team}'`)).rows[0]?.id
  const chA = await idOf('team_chat_a')
  const chB = await idOf('team_chat_b')
  assert.ok(chA && chB, '0041: 팀 채널이 열리지 않았다')

  const teamRooms = `select count(*)::int from chat_channels where kind = 'team' and team_id in ('team_chat_a', 'team_chat_b')`
  assert.equal(await as(C.memA, teamRooms), 1, '0041: 팀원 A에게 다른 팀(B) 방이 보인다')
  assert.equal(await as(C.memB, teamRooms), 1, '0041: 팀원 B에게 다른 팀(A) 방이 보인다')
  assert.equal(await as(C.leadA, teamRooms), 1, '0041: 팀장 A가 자기 팀 방만 보지 않는다')
  assert.equal(await as(C.execDy, teamRooms), 1, '0041: 상위(A의 위)가 A 방 하나만 보지 않는다 — B는 그의 subtree가 아니다')

  const send = (ch: string, body: string) => `insert into chat_messages (channel_id, body) values ('${ch}', '${body}')`
  assert.equal(await as(C.memA, send(chA, '안녕')), 1, '0041: 팀원이 자기 팀 방에 못 쓴다')
  assert.equal(await as(C.memA, send(chB, '침입')), 'denied', '0041: 팀원이 다른 팀 방에 쓴다')
  await commitAs(C.memA, `${send(chA, '팀 A 기밀')} returning 'ok' as v`)
  const inA = `select count(*)::int from chat_messages where channel_id = '${chA}'`
  assert.equal(await as(C.memB, inA), 0, '0041: 다른 팀 사람이 A 방 메시지를 읽는다')
  assert.equal(await as(C.execDy, inA), 1, '0041: 상위가 A 방 메시지를 못 읽는다')
  assert.equal(
    await as(C.memA, `update chat_messages set body = '고침' where channel_id = '${chA}'`),
    0, '0041: 보낸 메시지를 고친다 — 대화는 기록이다',
  )
  // 남의 이름 · 과거 시각을 적어 보내도 DB가 자기 이름 · 지금으로 덮는다.
  assert.equal(
    await as(
      C.memA,
      `select count(*)::int from chat_messages where body = '사칭' and sender_id = '${C.memA}' and created_at > now() - interval '1 minute'`,
      `insert into chat_messages (channel_id, body, sender_id, created_at) values ('${chA}', '사칭', '${C.memB}', '2020-01-01')`,
    ),
    1, '0041: 남의 이름이나 과거 시각으로 메시지가 저장된다',
  )
  await assert.rejects(
    as(C.memA, `insert into chat_messages (channel_id, link) values ('${chA}', '/\\evil.com')`),
    /chat_messages_link_check/, '0041: /\\ 로 시작하는 링크(브라우저가 //로 읽는다)가 들어간다',
  )
  await assert.rejects(as(C.memA, `insert into chat_messages (channel_id, body) values ('${chA}', '  ')`), /chat_message_empty/, '0041: 빈 메시지가 들어간다')
  assert.equal(await as(UID.agent, `select count(*)::int from chat_messages where channel_id = '${chA}'`), 0, '0041: 야간 AI 계정이 사내 대화를 읽는다')

  // 1:1 — 두 사람만. 상위도 회장도 못 본다. 다른 회사 사람과는 못 연다.
  const dm = await commitAs(C.memA, `select open_dm('${C.memB}')::text as v`)
  const dmSee = `select count(*)::int from chat_channels where channel_id = '${dm}'`
  assert.equal(await as(C.memB, dmSee), 1, '0041: 1:1 상대가 방을 못 본다')
  assert.equal(await as(C.execDy, dmSee), 0, '0041: 상위가 남의 1:1을 본다')
  assert.equal(await as(UID.chairman, dmSee), 0, '0041: 회장이 남의 1:1을 본다')
  await assert.rejects(as(C.memA, `select open_dm('${UID.ceo}')`), /dm_forbidden/, '0041: 다른 회사(VANA) 사람과 1:1이 열린다')
  assert.equal(await commitAs(C.memB, `select open_dm('${C.memA}')::text as v`), dm, '0041: 같은 두 사람에게 1:1 방이 둘 생긴다')

  // 못 보는 문서는 걸지 못한다.
  await db.exec(`insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by)
    values ('doc_chat_secret', 'biz_dy', '기밀', 'Plan', 'Restricted', 'https://x/s', '${UID.chairman}')`)
  assert.equal(
    await as(C.memA, `insert into chat_messages (channel_id, body, document_id) values ('${chA}', '첨부', 'doc_chat_secret')`),
    'denied', '0041: 못 보는(Restricted) 문서를 채널에 건다',
  )

  // AI 대화 — 본인만. 회장도 남의 것은 못 본다. 질문 요약은 감사에.
  const chat = await commitAs(C.memA, `insert into ai_chats (title) values ('재무 질문') returning chat_id::text as v`)
  await commitAs(C.memA, `insert into ai_chat_messages (chat_id, role, content) values ('${chat}', 'user', '이번 달 구매 요청 합계는 얼마인가요? 부서별로 나눠서 보여 주세요.') returning 'ok' as v`)
  const mine = `select count(*)::int from ai_chat_messages where chat_id = '${chat}'`
  assert.equal(await as(C.memA, mine), 1, '0041: 본인이 자기 AI 대화를 못 읽는다')
  assert.equal(await as(C.memB, mine), 0, '0041: 동료가 남의 AI 대화를 읽는다')
  assert.equal(await as(UID.chairman, mine), 0, '0041: 회장이 직원의 AI 대화를 읽는다 — 원문 «회장은 자기 것만»')
  assert.equal(
    await as(C.memB, `insert into ai_chat_messages (chat_id, role, content) values ('${chat}', 'user', '끼어들기')`),
    'denied', '0041: 남의 AI 대화에 끼어든다',
  )
  const audit = await db.query<{ q: string }>(`select after->>'question' as q from audit_log where entity_table = 'ai_chats' and entity_id = '${chat}'`)
  assert.equal(audit.rows.length, 1, '0041: 질문 요약이 감사에 남지 않았다')
  assert.ok(audit.rows[0].q.length <= 80, '0041: 감사에 질문 전문이 남는다 — 앞 80자까지만')
  const auditSee = `select count(*)::int from audit_log where entity_table = 'ai_chats' and entity_id = '${chat}'`
  assert.equal(await as(C.leadA, auditSee), 0, '0041: 팀장이 부하 직원의 AI 질문 요약을 읽는다')
  assert.equal(await as(C.execDy, auditSee), 0, '0041: 임원이 subtree 직원의 AI 질문 요약을 읽는다')
  assert.equal(await as(C.memA, auditSee), 1, '0041: 본인이 자기 질문 요약을 못 읽는다')
  assert.equal(await as(UID.chairman, auditSee), 1, '0041: 회장이 질문 요약을 못 읽는다(원문: audit_log에 질문 요약)')
  await assert.rejects(
    as(C.memA, `insert into ai_chat_messages (chat_id, role, content, sources) values ('${chat}', 'assistant', 'x', '[{"label":"x","href":"javascript:alert(1)"}]')`),
    /ai_source_href/, '0041: 앱 밖 근거 링크가 들어간다',
  )

  await db.exec(`
    delete from ai_chats where chat_id = '${chat}';
    delete from chat_channels where team_id in ('team_chat_a', 'team_chat_b') or channel_id = '${dm}';
    delete from chat_channels where kind = 'company';
    delete from documents where document_id = 'doc_chat_secret';
    delete from user_business_access where user_id in ('${C.memA}', '${C.memB}', '${C.leadA}', '${C.execDy}');
    update user_profiles set team_id = null, reports_to = null where user_id in ('${C.memA}', '${C.memB}', '${C.leadA}', '${C.execDy}');
    delete from teams where team_id in ('team_chat_a', 'team_chat_b');
  `)
  // 사람은 지우지 않는다 — audit_log가 그들을 가리키고(질문 요약), 감사는 지우는 길이 없다.
  // 대신 권한을 끊어 뒤의 검사가 세는 활성 사용자에 섞이지 않게 한다.
  await db.exec(`update user_profiles set revoked_at = now(), status = 'left' where user_id in ('${C.memA}', '${C.memB}', '${C.leadA}', '${C.execDy}')`)
}

/**
 * 0040 일정 화상 링크 — event_video_link()가 유일한 문. 방 이름 · 저장 · 참석자 알림 · 감사가 한 번에.
 */
async function eventVideo(db: Db, as: As) {
  await db.exec(`
    insert into events (event_id, title, starts_on, kind, business_id, attendee_ids) values
      ('00000000-0000-0000-0000-00000000e001', '주간 회의', '2026-09-30', 'Meeting', 'biz_dy', array['${UID.member}'::uuid, '${UID.ceo}'::uuid]),
      ('00000000-0000-0000-0000-00000000e002', '출장', '2026-10-01', 'Trip', null, '{}');
  `)
  const E1 = '00000000-0000-0000-0000-00000000e001'
  // 회장 세션으로 링크를 만들고 **커밋한다**(as()는 되돌린다). 알림 · 두 번째 호출을 소유자 권한으로 잰다.
  const asChairman = async (sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${UID.chairman}', true); set local role authenticated;`)
    try {
      const r = await db.query<{ u: string }>(sql)
      await db.exec('commit')
      return r.rows[0]?.u ?? ''
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  const link = await asChairman(`select event_video_link('${E1}') as u`)
  assert.match(link, /^https:\/\/meet\.jit\.si\/chairman-os-dy-20260930-[0-9a-f]{16}$/, `0040: 방 이름 모양이 틀렸다(${link})`)
  const notes = await db.query<{ n: number }>(`select count(*)::int as n from notifications where link = '/meet?room=${link.slice('https://meet.jit.si/'.length)}'`)
  assert.equal(notes.rows[0].n, 2, '0040: 참석자 둘에게 알림이 가지 않았다')

  const second = await asChairman(`select event_video_link('${E1}') as u`)
  const count = await db.query<{ n: number }>(`select count(*)::int as n from notifications where link like '/meet?room=%'`)
  assert.deepEqual([second, count.rows[0].n], [link, 2], '0040: 두 번 누르면 링크가 바뀌거나 알림이 또 간다')

  // 다시 만들기(p_rotate) — 새 방 이름, 지금 참석자 전원에게 새 링크로 다시 알림.
  const rotated = await asChairman(`select event_video_link('${E1}', true) as u`)
  const after = await db.query<{ n: number }>(`select count(*)::int as n from notifications where link = '/meet?room=${rotated.slice('https://meet.jit.si/'.length)}'`)
  assert.ok(rotated !== link && /chairman-os-dy-20260930-[0-9a-f]{16}$/.test(rotated), '0040: 다시 만들기가 새 방 이름을 내지 않는다')
  assert.equal(after.rows[0].n, 2, '0040: 다시 만든 링크가 참석자에게 다시 가지 않는다')

  await assert.rejects(as(UID.member, `select event_video_link('${E1}')`), /event_video_forbidden/, '0040: 직원이 화상 링크를 만든다')
  await assert.rejects(
    as(UID.chairman, `select event_video_link('00000000-0000-0000-0000-00000000e002')`),
    /event_not_meeting/, '0040: 회의가 아닌 일정에 화상 링크가 선다',
  )
  assert.equal(
    await as(
      UID.chairman,
      `select count(*)::int from events where event_id = '00000000-0000-0000-0000-00000000e002' and video_url is null`,
      `update events set video_url = 'https://meet.jit.si/chairman-os-x' where event_id = '00000000-0000-0000-0000-00000000e002'`,
    ),
    1, '0040: 일반 update로 화상 링크를 바꿀 수 있다 — 방 이름이 입장권이다',
  )
  await db.exec(`delete from notifications where link like '/meet?room=%'; delete from events where event_id in ('${E1}', '00000000-0000-0000-0000-00000000e002');`)
}

/**
 * 0039 회장 Gmail 토큰 — 0023 카카오와 같은 자물쇠. 표는 아무에게도 열지 않고 definer 함수만.
 * 읽기 토큰은 Chairman(자기 것)과 AIAgent(아침 브리핑). 보내기 범위가 섞이면 저장하지 않는다.
 */
async function googleToken(db: Db, as: As) {
  // authenticated의 표 권한은 rls() 첫머리의 일괄 grant가 다시 연다(Supabase 기본값 흉내) —
  // 그래서 여기서는 anon만 카탈로그로 재고, authenticated는 아래에서 행동(정책이 0행)으로 잰다.
  const priv = await db.query<{ b: boolean }>(`select has_table_privilege('anon', 'chairman_google_token', 'select') as b`)
  assert.equal(priv.rows[0].b, false, '0039: anon에게 토큰 표가 열려 있다')

  const save = (scopes: string) =>
    `select google_token_save('acc', 'ref', now() + interval '1 hour', '${scopes}', 'Chairman@X.com')::int`
  assert.equal(await as(UID.chairman, save('https://www.googleapis.com/auth/gmail.readonly')), 1, '0039: 회장이 연결을 못 저장한다')
  assert.equal(await as(UID.cfo, save('https://www.googleapis.com/auth/gmail.readonly')), 0, '0039: CFO가 회장 메일 토큰을 저장한다')
  assert.equal(
    await as(UID.chairman, save('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send')),
    0, '0039: 보내기 범위가 섞인 토큰이 저장된다 — «앱에서 보내지 않음»',
  )
  assert.equal(
    await as(UID.chairman, save('https://www.googleapis.com/auth/gmail.settings.sharing')),
    0, '0039: 전달 주소 · 위임 범위(settings.sharing)가 저장된다 — 허용 목록이어야 한다',
  )
  assert.equal(
    await as(UID.chairman, `select google_token_save('acc', '', now() + interval '1 hour', 'https://www.googleapis.com/auth/gmail.readonly', 'x@x.com')::int`),
    0, '0039: 처음 연결에 refresh token이 비어도 저장된다 — 한 시간 뒤 조용히 끊긴다',
  )
  assert.equal(await as(UID.chairman, `select count(*)::int from google_token_status()`, save('https://www.googleapis.com/auth/gmail.readonly')), 1, '0039: 회장이 자기 연결 상태를 못 본다')

  // 소유자 권한으로 한 줄 심고 역할별로 토큰을 읽어 본다.
  await db.exec(`insert into chairman_google_token (user_id, email, access_token, refresh_token, expires_at, scopes)
    values ('${UID.chairman}', 'ch@x.com', 'acc', 'ref', now() + interval '1 hour', 'https://www.googleapis.com/auth/gmail.readonly')`)
  const read = `select count(*)::int from google_token_for_read()`
  assert.equal(await as(UID.chairman, read), 1, '0039: 회장이 자기 토큰을 못 읽는다')
  assert.equal(await as(UID.agent, read), 1, '0039: 아침 브리핑(AIAgent)이 토큰을 못 읽는다')
  assert.equal(await as(UID.cfo, read), 0, '0039: CFO가 회장 메일 토큰을 읽는다')
  assert.equal(await as(UID.member, read), 0, '0039: 직원이 회장 메일 토큰을 읽는다')
  assert.equal(await as(UID.chairman2, read), 0, '0039: 다른 회장이 이 회장의 토큰을 읽는다')
  assert.equal(await as(UID.cfo, `select count(*)::int from google_token_status()`), 0, '0039: CFO가 회장 연결 상태를 본다')
  assert.equal(await as(UID.cfo, `select count(*)::int from chairman_google_token`), 0, '0039: CFO가 토큰 표를 직접 읽는다')
  assert.equal(await as(UID.chairman, `select count(*)::int from chairman_google_token where user_id <> '${UID.chairman}'`), 0, '0039: 회장이 남의 토큰 줄을 본다')
  assert.equal(
    await as(UID.agent, `select google_token_refreshed('${UID.chairman}', 'acc2', now() + interval '1 hour')::int`),
    1, '0039: 브리핑이 access token을 갱신하지 못한다',
  )
  assert.equal(
    await as(UID.cfo, `select google_token_refreshed('${UID.chairman}', 'x', now())::int`),
    0, '0039: CFO가 회장 토큰을 덮어쓴다',
  )
  // 회장이 둘이면 AIAgent는 for_read가 주는 줄(가장 최근)만 갱신한다.
  await db.exec(`insert into chairman_google_token (user_id, email, access_token, refresh_token, expires_at, scopes, updated_at)
    values ('${UID.chairman2}', 'ch2@x.com', 'acc', 'ref', now() + interval '1 hour', 'https://www.googleapis.com/auth/gmail.readonly', now() - interval '1 day')`)
  assert.equal(
    await as(UID.agent, `select google_token_refreshed('${UID.chairman2}', 'swap', now() + interval '1 hour')::int`),
    0, '0039: AIAgent가 브리핑이 읽지 않는 줄의 토큰을 바꿔 끼운다',
  )
  await db.exec(`delete from chairman_google_token`)

  // 키맨 email — 소문자로, 모양이 틀리면 거부.
  await db.exec(`insert into business_keymen (business_id, name, email) values ('biz_dy', '메일 키맨', '  Kim.Lee@Partner.CO.kr ')`)
  const kr = await db.query<{ email: string }>(`select email from business_keymen where name = '메일 키맨'`)
  assert.equal(kr.rows[0].email, 'kim.lee@partner.co.kr', '0039: 키맨 email이 소문자로 정리되지 않는다')
  await assert.rejects(
    db.exec(`insert into business_keymen (business_id, name, email) values ('biz_dy', '틀린 메일', 'not-an-email')`),
    /business_keymen_email_check/, '0039: 모양이 틀린 email이 들어간다',
  )
  await db.exec(`delete from business_keymen where name = '메일 키맨'`)
}

/**
 * 0038 그룹웨어 — 공지 · 결재 양식 · 결재선 첫 칸 · 문서 폴더/버전.
 *
 * 공지는 회사 단위 공개(그 회사 사람 전원), 그룹 공지는 활성 사용자 전원. 쓰기는 Executive 이상,
 * 그룹 공지는 그룹 범위만. 읽음 줄은 본인 · 작성자 · 회장만 본다.
 */
async function groupware(db: Db, as: As) {
  const lock = await db.query<{ t: string; forced: boolean; anon: boolean }>(`
    select c.relname as t, c.relforcerowsecurity as forced, has_table_privilege('anon', c.oid, 'select') as anon
      from pg_class c where c.relname in ('notices', 'notice_reads', 'approval_templates', 'doc_folders') order by 1`)
  for (const r of lock.rows) {
    assert.deepEqual([r.forced, r.anon], [false, false], `0038: ${r.t}에 force가 걸렸거나 anon에게 열려 있다(0035 자물쇠 규칙)`)
  }

  // ── 공지 ──
  await db.exec(`
    insert into notices (notice_id, business_id, title, created_by) overriding system value values
      (9001, 'biz_dy', 'DY 공지', '${UID.chairman}'),
      (9002, 'biz_vana', 'VANA 공지', '${UID.ceo}'),
      (9003, null, '그룹 공지', '${UID.chairman}');
    insert into notice_reads (notice_id, user_id) values (9001, '${UID.member}');
  `)
  const notices = `select count(*)::int from notices where notice_id between 9001 and 9003`
  assert.equal(await as(UID.member, notices), 2, '0038: Member(biz_dy)는 DY 공지 + 그룹 공지 둘')
  assert.equal(await as(UID.ceo, notices), 2, '0038: CEO(biz_vana)는 VANA 공지 + 그룹 공지 둘 — 다른 회사 공지가 보인다')
  assert.equal(await as(UID.chairman, notices), 3, '0038: 회장은 셋')

  assert.equal(await as(UID.ceo, `insert into notices (business_id, title) values ('biz_vana', 'x')`), 1, '0038: CEO가 자기 회사 공지를 못 쓴다')
  assert.equal(await as(UID.ceo, `insert into notices (business_id, title) values ('biz_dy', 'x')`), 'denied', '0038: CEO가 남의 회사 공지를 쓴다')
  assert.equal(await as(UID.ceo, `insert into notices (business_id, title) values (null, 'x')`), 'denied', '0038: 한 회사 CEO가 그룹 전체 공지를 쓴다')
  assert.equal(await as(UID.member, `insert into notices (business_id, title) values ('biz_dy', 'x')`), 'denied', '0038: Member가 공지를 쓴다(Executive 이상만)')
  assert.equal(await as(UID.cfo, `insert into notices (business_id, title) values (null, 'x')`), 1, '0038: GroupCFO가 그룹 공지를 못 쓴다')
  assert.equal(await as(UID.agent, `insert into notices (business_id, title) values (null, 'x')`), 'denied', '0038: AIAgent가 공지를 쓴다')
  assert.equal(await as(UID.ceo, `update notices set title = 'y' where notice_id = 9001`), 0, '0038: CEO가 남의 회사 공지를 고친다')

  // 읽음 — 자기 줄만, 읽을 수 있는 공지에만.
  assert.equal(await as(UID.member, `insert into notice_reads (notice_id) values (9003)`), 1, '0038: 그룹 공지에 읽음을 못 찍는다')
  assert.equal(await as(UID.member, `insert into notice_reads (notice_id) values (9002)`), 'denied', '0038: 못 보는 공지에 읽음을 찍는다')
  assert.equal(
    await as(UID.member, `insert into notice_reads (notice_id, user_id) values (9003, '${UID.ceo}')`),
    'denied', '0038: 남의 이름으로 읽음을 찍는다',
  )
  const reads9001 = `select count(*)::int from notice_reads where notice_id = 9001`
  assert.equal(await as(UID.member, reads9001), 1, '0038: 본인이 자기 읽음 줄을 못 본다')
  assert.equal(await as(UID.chairman, reads9001), 1, '0038: 회장(작성자)이 읽음 줄을 못 본다')
  assert.equal(await as(UID.cfo, reads9001), 0, '0038: 작성자도 회장도 아닌 CFO가 남의 읽음 줄을 본다 — 공지가 출석부가 된다')
  assert.equal(await as(UID.member, `delete from notice_reads where notice_id = 9001`), 0, '0038: 읽음을 지운다')

  // ── 결재 양식 ──
  assert.equal(await as(UID.member, `select count(*)::int from approval_templates`), 5, '0038: 양식 다섯이 안 보인다')
  assert.equal(await as(UID.member, `update approval_templates set chairman_over = 1 where template_key = 'expense'`), 0, '0038: Member가 회장 규칙을 고친다')
  assert.equal(await as(UID.chairman, `update approval_templates set chairman_over = 1 where template_key = 'expense'`), 1, '0038: 회장이 규칙을 못 고친다')
  assert.equal(
    await as(UID.chairman, `insert into approval_templates (template_key, name_ko, name_en, fields) values ('gift', 'x', 'x', '[]')`),
    'denied', '0038: 양식이 여섯이 된다',
  )

  // ── 결재선 첫 칸 — 팀장, 공석·본인이면 reports_to ──
  await db.exec(`
    insert into teams (team_id, business_id, name, name_en, lead_user_id) values ('team_gw', 'biz_dy', '결재', 'Approval', '${UID.ceo}');
    update user_profiles set team_id = 'team_gw', reports_to = '${UID.cfo}' where user_id = '${UID.member}';
  `)
  assert.equal(
    await as(UID.member, `select count(*)::int from my_approval_lead() where user_id = '${UID.ceo}' and via = 'team_lead'`),
    1, '0038: 결재선 첫 칸이 팀장이 아니다',
  )
  await db.exec(`update teams set lead_user_id = '${UID.member}' where team_id = 'team_gw'`)
  assert.equal(
    await as(UID.member, `select count(*)::int from my_approval_lead() where user_id = '${UID.cfo}' and via = 'reports_to'`),
    1, '0038: 본인이 팀장이면 직속 상위(reports_to)로 가야 한다',
  )
  // 팀장이 떠났는데 팀장 칸이 그 사람을 가리킨 채면 — 고르기 전에 빼서 reports_to로 간다(리뷰 지적 3).
  await db.exec(`
    update teams set lead_user_id = '${UID.ceo}' where team_id = 'team_gw';
    update user_profiles set status = 'left' where user_id = '${UID.ceo}';
  `)
  assert.equal(
    await as(UID.member, `select count(*)::int from my_approval_lead() where user_id = '${UID.cfo}' and via = 'reports_to'`),
    1, '0038: 떠난 팀장이 팀장 칸에 남아 있으면 결재선이 빈다 — reports_to로 넘어가야 한다',
  )
  await db.exec(`
    update user_profiles set status = 'active' where user_id = '${UID.ceo}';
    update teams set lead_user_id = '${UID.ceo}' where team_id = 'team_gw';
  `)

  // ── 결재선은 DB가 만든다(리뷰 지적 4) ──
  // 기안자(member)에게 결재 모듈 쓰기를 연다. 팀장은 ceo, 직속 상위는 cfo.
  await db.exec(`insert into user_module_access (user_id, module, can_write) values ('${UID.member}', '/chairman/decisions', true)
    on conflict (user_id, module) do update set can_write = true`) // 0054: 새 프로필에는 트리거가 이미 붙였다
  // 화면이 보낸 결재선(«위조» 한 칸)은 트리거가 버리고 새로 적어야 한다.
  // 0059부터 결재선은 조직도 상사 사슬이다 — member의 직속 상사는 cfo(teams.lead_user_id = ceo는 보지 않는다).
  const draft = (tpl: string, form: string) =>
    `insert into decisions (decision_id, business_id, title, template_key, form, attachment_url, approval_line)
       values ('dec_gw', 'biz_dy', '결재', '${tpl}', '${form}'::jsonb, 'https://x/att',
               '[{"step":"lead","user_id":null,"name":"위조","why":"x"}]'::jsonb)`
  assert.equal(
    await as(UID.member,
      `select count(*)::int from decisions where decision_id = 'dec_gw'
         and approval_line->0->>'user_id' = '${UID.cfo}' and approval_line @> '[{"step":"chairman"}]'
         and not approval_line @> '[{"name":"위조"}]'`,
      draft('expense', '{"amount":"6,000,000","purpose":"장비","spent_on":"2026-09-28"}')),
    1, '0038/0059: 600만 원 지출이 상사 → 대표로 서지 않는다(또는 위조한 결재선이 남았다)',
  )
  assert.equal(
    await as(UID.member,
      `select count(*)::int from decisions where decision_id = 'dec_gw' and jsonb_array_length(approval_line) = 2
         and not approval_line @> '[{"step":"chairman"}]'`,
      draft('expense', '{"amount":"100000","purpose":"다과","spent_on":"2026-09-28"}')),
    1, '0038/0059: 10만 원 지출이 대표까지 간다(기준 500만 원 · 직속 상사 종결)',
  )
  assert.equal(
    await as(UID.member,
      `select count(*)::int from decisions where decision_id = 'dec_gw' and approval_line @> '[{"step":"chairman"}]'`,
      draft('contract', '{"counterparty":"A사","amount":"1","term":"1년","summary":"x"}')),
    1, '0038/0059: 계약이 금액과 상관없이 대표까지 가지 않는다',
  )
  await assert.rejects(
    as(UID.member, `select 1`, draft('expense', '{"amount":"1000"}')),
    /approval_form_missing:purpose/, '0038: 필수 항목이 빈 지출이 들어간다',
  )
  // 화면 미리보기(lib/approval-chain.ts)가 트리거와 **같은 결재선**을 그리는가 — 문장(why)까지.
  const tplRows = await db.query<ApprovalTemplate>(`select * from approval_templates`)
  const templatesByKey = new Map(tplRows.rows.map((t) => [t.template_key, { ...t, chairman_over: t.chairman_over === null ? null : Number(t.chairman_over) }]))
  const cfoReportsToChair = (await db.query<{ r: string | null }>(`select reports_to::text as r from user_profiles where user_id = '${UID.cfo}'`)).rows[0].r
  for (const [tpl, form] of [
    ['expense', { amount: '6,000,000', purpose: '장비', spent_on: '2026-09-28' }],
    ['expense', { amount: '100000', purpose: '다과', spent_on: '2026-09-28' }],
    ['leave', { starts_on: '2026-10-01', ends_on: '2026-10-02' }],
    ['hiring', { position: '엔지니어', team: '연구소', amount: '60000000', reason: '증원' }],
  ] as const) {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${UID.member}', true); set local role authenticated;`)
    let dbLine: { step: string; name: string; why: string }[]
    try {
      await db.exec(draft(tpl, JSON.stringify(form)))
      const r = await db.query<{ line: { step: string; name: string; why: string }[] }>(`select approval_line as line from decisions where decision_id = 'dec_gw'`)
      dbLine = r.rows[0].line
    } finally {
      await db.exec('rollback')
    }
    // cfo(GroupCFO)의 상사가 대표이거나 없으면 사슬은 cfo 한 사람이다.
    assert.ok(cfoReportsToChair === null || cfoReportsToChair === UID.chairman, '0059 전제: cfo의 상사가 대표 · 없음이 아니다')
    const preview = chainLine(templatesByKey.get(tpl)!, { ...form }, [{ seq: 1, user_id: UID.cfo, display_name: 'cfo' }])
    assert.deepEqual(
      preview.map((s) => [s.step, s.why]),
      dbLine.map((s) => [s.step, s.why]),
      `0038/0059: 결재선 미리보기와 트리거가 갈라졌다(${tpl} ${JSON.stringify(form)})`,
    )
  }

  // 0059 — 기안자 member의 결재(단계 결재)는 approval_decide()만 상태를 바꾼다. 결재선은 그대로 얼어 있다.
  await db.exec(`
    insert into decisions (decision_id, business_id, title, template_key, form, attachment_url, created_by)
      values ('dec_gw2', 'biz_dy', '결재', 'leave', '{"starts_on":"2026-10-01","ends_on":"2026-10-02"}', null, '${UID.member}');
  `)
  await assert.rejects(
    as(UID.chairman, `update decisions set approval_line = '[]' where decision_id = 'dec_gw2'`),
    /approval_line_frozen/, '0038: 결재선이 나중에 고쳐진다',
  )
  await assert.rejects(
    as(UID.chairman, `update decisions set status = 'Approved' where decision_id = 'dec_gw2'`),
    /approval_use_steps/, '0059: 단계 결재가 approval_decide() 밖에서 닫힌다',
  )
  await db.exec(`
    delete from approval_steps where decision_id = 'dec_gw2';
    delete from notifications where link = '/approvals?id=dec_gw2';
    delete from decisions where decision_id = 'dec_gw2';
    delete from user_module_access where user_id = '${UID.member}' and module = '/chairman/decisions';
    update user_profiles set team_id = null, reports_to = null where user_id = '${UID.member}';
    delete from teams where team_id = 'team_gw';
  `)

  // ── 문서 폴더 · 버전 ──
  assert.equal(await as(UID.chairman, `insert into doc_folders (business_id, name) values ('biz_dy', '계약')`), 1, '0038: 회장이 폴더를 못 만든다')
  assert.equal(await as(UID.ceo, `insert into doc_folders (business_id, name) values ('biz_dy', '계약')`), 'denied', '0038: 남의 회사에 폴더를 만든다')
  await assert.rejects(
    as(UID.chairman, `insert into doc_folders (business_id, team_id, name) select 'biz_vana', team_id, 'x' from teams where business_id = 'biz_dy' limit 1`),
    /doc_folder_team_business_mismatch/, '0038: 다른 회사 팀 밑에 폴더가 선다',
  )
  assert.equal(
    await as(
      UID.chairman,
      `select count(*)::int from documents d join documents p on p.document_id = d.supersedes
        where d.document_id = 'doc_v2' and d.version = p.version + 1 and d.tags = '{q3,계약}'`,
      `insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by)
         values ('doc_v1', 'biz_vana', '사업 계획', 'Plan', 'Normal', 'https://x/v1', '${UID.chairman}');
       insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by, tags)
         values ('doc_v2', 'biz_vana', ' 사업 계획 ', 'Plan', 'Normal', 'https://x/v2', '${UID.chairman}', '{" Q3","계약","q3",""}');`,
    ),
    1, '0038: 같은 제목 재등록이 v2가 되지 않거나 태그가 정리되지 않는다',
  )
  // 제목이 같아도 유형이 다르면 판으로 잇지 않는다(리뷰 지적 1).
  assert.equal(
    await as(
      UID.chairman,
      `select count(*)::int from documents where document_id = 'doc_m2' and version = 1 and supersedes is null`,
      `insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by)
         values ('doc_m1', 'biz_vana', '회의록', 'Minutes', 'Normal', 'https://x/m1', '${UID.chairman}');
       insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by)
         values ('doc_m2', 'biz_vana', '회의록', 'Report', 'Normal', 'https://x/m2', '${UID.chairman}');`,
    ),
    1, '0038: 유형이 다른 같은 제목 문서가 판으로 이어진다',
  )
  // 직전 판 · 폴더를 호출자가 적어 보내면 같은 회사인지 본다(리뷰 지적 2).
  await assert.rejects(
    as(UID.chairman, `select 1`,
      `insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by)
         values ('doc_x1', 'biz_dy', 'x', 'Plan', 'Normal', 'https://x/x1', '${UID.chairman}');
       insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by, supersedes)
         values ('doc_x2', 'biz_vana', 'y', 'Plan', 'Normal', 'https://x/x2', '${UID.chairman}', 'doc_x1');`),
    /document_supersedes_mismatch/, '0038: 다른 회사 문서 위에 판이 붙는다',
  )
  await assert.rejects(
    as(UID.chairman, `select 1`,
      `insert into doc_folders (folder_id, business_id, name) overriding system value values (9101, 'biz_dy', 'DY 폴더');
       insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by, folder_id)
         values ('doc_f1', 'biz_vana', 'z', 'Plan', 'Normal', 'https://x/f1', '${UID.chairman}', 9101);`),
    /document_folder_mismatch/, '0038: VANA 문서가 DY 폴더에 들어간다',
  )

  await db.exec(`delete from notice_reads; delete from notices; update approval_templates set chairman_over = 5000000 where template_key = 'expense';`)
}

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

  // 0039 — 같은 자물쇠. 일괄 grant 전에 재야 revoke가 살아 있는지 알 수 있다.
  const gg = await db.query<{ ok: boolean }>(
    `select not (has_table_privilege('authenticated','chairman_google_token','select')
              or has_table_privilege('authenticated','chairman_google_token','insert')
              or has_table_privilege('authenticated','chairman_google_token','update')
              or has_table_privilege('authenticated','chairman_google_token','delete')
              or has_table_privilege('anon','chairman_google_token','select')) as ok`,
  )
  assert.ok(gg.rows[0].ok, '0039: chairman_google_token에 authenticated/anon 권한이 남아 있다')

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

  // 0055 리뷰 I3 — 0026 위임 insert는 닫혔다(초대는 회장(0011) 또는 사용자 관리자 RPC만). 팀장의 직접 insert는 거부.
  assert.equal(await rows(H.lead, invite('m1@x', 'Member', H.lead)), 'denied',
    '0055: 0026 위임 insert(팀장이 자기 밑으로 직접 초대)가 아직 열려 있다')
  // Executive → 결재. 클라이언트가 false를 보내도 서버가 덮어쓴다(0026 set_approval — 세션 없는 insert로 잰다).
  await db.exec(`insert into user_invitations (email, role, display_name, invited_by, reports_to, max_security_class, business_ids, chairman_approval_required)
       values ('e1@x', 'Executive', 'e1', '${H.lead}', '${H.lead}', 'Normal', '{biz_dy}', false)`)
  assert.deepEqual(
    (await db.query<{ req: boolean }>(`select chairman_approval_required as req from user_invitations where email = 'e1@x'`)).rows,
    [{ req: true }],
    '0026: Executive 초대에 회장 결재가 안 붙는다 (d) — 클라이언트가 false로 보내면 통과한다면 그것은 결재가 아니다',
  )
  await db.exec(`delete from user_invitations where email = 'e1@x'`)
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
  // 0047: 회수는 모듈 줄을 줄마다 감사하며 지운다. 0054부터 새 직원에게는 «결재 올리기» 줄이 붙어 있다 — 그만큼 더한다.
  const moduleRows = (await db.query<{ n: number }>(
    `select count(*)::int as n from user_module_access where user_id = '${H.lead}'`,
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
    [{ staff_boss: H.exec, peer_boss: H.exec, team_lead: H.exec, audits: auditBase + 1 + moduleRows }],
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
 * 0045 첨부 + AI 요약 — 새 PGlite 한 벌(rls()의 일괄 grant가 칸 단위 grant를 덮지 않게).
 *
 * 읽기 = 대상이 보이고 AND 등급(Vault는 회장 + 지정자). 쓰기는 올린 사람 · 회장, 칸은 요약 다섯만.
 * 감사는 트리거(올림 · 요약 · 삭제)와 문 둘(내려받기 · 외부 AI 전송). 버킷은 비공개, anon은 전부 닫힌다.
 */
const AT = {
  chair: '00000000-0000-0000-0000-0000000045c0',
  cfo: '00000000-0000-0000-0000-0000000045c1',
  ceo: '00000000-0000-0000-0000-0000000045c2', // biz_vana
  member: '00000000-0000-0000-0000-0000000045c3', // biz_dy, Normal
  exec: '00000000-0000-0000-0000-0000000045c4', // biz_dy, Restricted — 올린 사람
  exec2: '00000000-0000-0000-0000-0000000045c5', // biz_dy, Restricted — Vault 지정자
  agent: '00000000-0000-0000-0000-0000000045c6',
  integration: '00000000-0000-0000-0000-0000000045c7',
}
const AF = {
  ini: '00000000-0000-0000-0000-00000045a001', // initiatives · Restricted · 회장
  dyN: '00000000-0000-0000-0000-00000045a002', // biz_dy · Normal · exec
  dyR: '00000000-0000-0000-0000-00000045a003', // biz_dy · Restricted · exec
  dyV: '00000000-0000-0000-0000-00000045a004', // biz_dy · Vault · 회장
  doc: '00000000-0000-0000-0000-00000045a005', // documents · Normal
  dec: '00000000-0000-0000-0000-00000045a006', // decisions · Restricted
  vana: '00000000-0000-0000-0000-00000045a007', // biz_vana · Normal
}
const PDF = 'application/pdf'
const SUMMARY = `{"summary":["첫 줄","둘째 줄","셋째 줄"],"key_numbers":["매출 12억 원"],"decisions_needed":["가격 승인"],"next_actions":["계약 초안 검토"],"confidence":"high"}`

async function attachments() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    -- 실제 Supabase는 anon에게도 storage.objects를 연다(판정은 정책이 한다). 흉내 스텁은 authenticated만 연다.
    grant select, insert, update, delete on storage.objects to anon;
    insert into auth.users values
      ('${AT.chair}', 'a1@x'), ('${AT.cfo}', 'a2@x'), ('${AT.ceo}', 'a3@x'), ('${AT.member}', 'a4@x'),
      ('${AT.exec}', 'a5@x'), ('${AT.exec2}', 'a6@x'), ('${AT.agent}', 'a7@x'), ('${AT.integration}', 'a8@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${AT.chair}', 'Chairman', 'ch', 'Vault'),
      ('${AT.cfo}', 'GroupCFO', 'cfo', 'Restricted'),
      ('${AT.ceo}', 'BusinessCEO', 'ceo', 'Restricted'),
      ('${AT.member}', 'Member', 'm', 'Normal'),
      ('${AT.exec}', 'Executive', 'ex', 'Restricted'),
      ('${AT.exec2}', 'Executive', 'ex2', 'Restricted'),
      ('${AT.agent}', 'AIAgent', 'ai', 'Restricted'),
      ('${AT.integration}', 'Integration', 'sync', 'Restricted');
    insert into user_business_access values
      ('${AT.ceo}', 'biz_vana'), ('${AT.member}', 'biz_dy'), ('${AT.exec}', 'biz_dy'), ('${AT.exec2}', 'biz_dy');
    insert into user_business_access select '${AT.agent}', business_id from businesses;
    insert into user_business_access select '${AT.integration}', business_id from businesses;
    insert into initiatives (initiative_id, title, kind) values ('ini_att', '첨부 딜', 'Deal');
    insert into documents (document_id, business_id, title, doc_type, security_class, storage_url)
      values ('doc_att', 'biz_dy', '첨부 문서', 'Report', 'Normal', 'https://example.invalid/d');
    insert into decisions (decision_id, business_id, title) values ('dec_att', 'biz_dy', '첨부 결재');
    insert into attachments (attachment_id, entity_table, entity_id, file_name, mime, size_bytes, security_class, uploaded_by) values
      ('${AF.ini}', 'initiatives', 'ini_att', 'term-sheet.pdf', '${PDF}', 100, 'Restricted', '${AT.chair}'),
      ('${AF.dyN}', 'businesses', 'biz_dy', 'brochure.pdf', '${PDF}', 100, 'Normal', '${AT.exec}'),
      ('${AF.dyR}', 'businesses', 'biz_dy', 'cost.pdf', '${PDF}', 100, 'Restricted', '${AT.exec}'),
      ('${AF.dyV}', 'businesses', 'biz_dy', 'formula.pdf', '${PDF}', 100, 'Vault', '${AT.chair}'),
      ('${AF.doc}', 'documents', 'doc_att', 'doc.pdf', '${PDF}', 100, 'Normal', '${AT.exec}'),
      ('${AF.dec}', 'decisions', 'dec_att', 'quote.pdf', '${PDF}', 100, 'Restricted', '${AT.exec}'),
      ('${AF.vana}', 'businesses', 'biz_vana', 'vana.pdf', '${PDF}', 100, 'Normal', '${AT.ceo}');
    insert into storage.objects (bucket_id, name) select 'attachments', storage_path from attachments;
  `)

  async function as(role: 'authenticated' | 'anon', uid: string | null, sql: string, setup = ''): Promise<'denied' | number> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true); set local role ${role};`)
    try {
      if (setup) await db.exec(setup)
      const res = await db.query<Record<string, number>>(sql)
      return res.rows.length ? Number(Object.values(res.rows[0])[0]) : (res.affectedRows ?? 0)
    } catch (e) {
      if (/row-level security/.test(e instanceof Error ? e.message : '')) return 'denied'
      throw e
    } finally {
      await db.exec('rollback')
    }
  }
  const u = (uid: string, sql: string, setup = '') => as('authenticated', uid, sql, setup)
  const count = `select count(*)::int from attachments`

  // ── 자물쇠: force 없음(0035), anon은 표 · 판정 함수 · 문 전부 없음, 버킷은 비공개 ──
  const lock = await db.query<{ t: string; forced: boolean; anon: boolean }>(`
    select c.relname as t, c.relforcerowsecurity as forced,
           has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
             or has_table_privilege('anon', c.oid, 'truncate') as anon
      from pg_class c where c.relname in ('attachments', 'attachment_vault_viewers', 'ai_usage_log') order by 1`)
  assert.equal(lock.rows.length, 3, '0045: 표 셋이 다 있어야 한다')
  for (const r of lock.rows) assert.deepEqual([r.forced, r.anon], [false, false], `0045: ${r.t}에 force가 걸렸거나 anon에게 열려 있다`)
  for (const fn of ['attachment_entity_visible(text, text)', 'attachment_class_ok(uuid, security_class)',
    'attachment_is_mine_or_chairman(uuid)', 'record_attachment_download(uuid)', 'record_attachment_ai_send(uuid, text)']) {
    const r = await db.query<{ ok: boolean }>(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)
    assert.equal(r.rows[0].ok, false, `0045: anon이 ${fn}을 부를 수 있다`)
  }
  const bucket = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'attachments'`)
  assert.deepEqual(bucket.rows, [{ public: false }], '0045: attachments 버킷이 없거나 공개다')
  await assert.rejects(as('anon', null, count), /permission denied/, '0045: anon이 attachments를 읽는다')
  // anon의 storage 질의는 0032 정책(user_profiles → in_my_subtree)이 먼저 권한 오류로 끊을 수 있다.
  // 끊겨도 닫힌 것이다 — 0행이거나 거부이거나 권한 오류면 통과, 한 줄이라도 보이면 실패.
  const closed = <T,>(p: Promise<T>, shut: T) =>
    p.catch((e: unknown) => { if (/permission denied/.test(e instanceof Error ? e.message : '')) return shut; throw e })
  assert.equal(await closed(as('anon', null, `select count(*)::int from storage.objects where bucket_id = 'attachments'`), 0), 0,
    '0045: anon에게 첨부 객체가 보인다')
  assert.equal(await closed(as('anon', null, `insert into storage.objects (bucket_id, name) values ('attachments', 'businesses/biz_dy/x')`), 'denied' as const),
    'denied', '0045: anon이 첨부 버킷에 올린다')
  // 판정 함수 자체는 anon에게 false다(정책이 anon 질의를 죽이지 않게 plpgsql 첫 줄에서 나간다).
  assert.equal(await as('anon', null, `select count(*)::int from attachments_probe where public.attachment_object_visible(name)`,
    `create temp table attachments_probe as select 'businesses/biz_dy/${AF.dyN}'::text as name;`), 0,
    '0045: anon에게 attachment_object_visible이 참이다')

  // ── 읽기: 대상 규칙 AND 등급 ──
  assert.equal(await u(AT.chair, count), 7, '0045: 회장은 일곱 다 본다(Vault 포함)')
  assert.equal(await u(AT.cfo, count), 6, '0045: GroupCFO는 Vault만 빼고 여섯')
  assert.equal(await u(AT.member, count), 2, '0045: Member(biz_dy · 일반)는 DY 일반 둘(회사 · 문서)만 — 제한 · 이니셔티브 · 남의 회사가 보인다')
  assert.equal(await u(AT.exec, count), 4, '0045: Executive(biz_dy · 제한)는 DY 일반 · 제한 넷')
  assert.equal(await u(AT.ceo, count), 1, '0045: BusinessCEO(biz_vana)는 VANA 하나 — 다른 회사 첨부가 보인다')
  assert.equal(await u(AT.agent, count), 6, '0045: AIAgent는 브리핑 집계를 위해 Vault 밖 여섯을 읽는다')
  assert.equal(await u(AT.integration, count), 0, '0045: Integration에게 첨부가 보인다')
  assert.equal(await u(AT.cfo, `select count(*)::int from attachments where entity_table = 'initiatives'`), 1,
    '0045: GroupCFO가 이니셔티브 첨부를 못 본다')
  // 대상이 soft delete되면 첨부도 숨는다(대상 규칙을 옮겨 적지 않고 따라간다).
  assert.equal(await u(AT.chair, `select count(*)::int from attachments where entity_table = 'documents'`,
    `select soft_delete('documents', 'doc_att')`), 0, '0045: 지운 문서의 첨부가 남아 보인다')

  // ── Vault: 회장 + 지정자만 ──
  const vault = `select count(*)::int from attachments where attachment_id = '${AF.dyV}'`
  assert.equal(await u(AT.exec2, vault), 0, '0045: 지정 전 Executive에게 Vault가 보인다')
  assert.equal(await u(AT.cfo, `insert into attachment_vault_viewers (attachment_id, user_id) values ('${AF.dyV}', '${AT.exec2}')`),
    'denied', '0045: 회장이 아닌 사람이 Vault 지정자를 넣는다')
  assert.equal(await u(AT.exec2, `insert into attachment_vault_viewers (attachment_id, user_id) values ('${AF.dyV}', '${AT.exec2}')`),
    'denied', '0045: 본인이 자기를 Vault 지정자로 넣는다')
  assert.equal(await u(AT.chair, `select count(*)::int from audit_log where entity_table = 'attachments' and action::text = 'permission_change'`,
    `insert into attachment_vault_viewers (attachment_id, user_id) values ('${AF.dyV}', '${AT.exec2}');
     delete from attachment_vault_viewers where attachment_id = '${AF.dyV}';`),
  2, '0045: Vault 지정 추가 · 해제가 감사에 안 남는다')
  await db.exec(`insert into attachment_vault_viewers (attachment_id, user_id, granted_by) values ('${AF.dyV}', '${AT.exec2}', '${AT.chair}')`)
  assert.equal(await u(AT.exec2, vault), 1, '0045: 지정된 사람에게 Vault가 안 보인다')
  assert.equal(await u(AT.exec, vault), 0, '0045: 지정 안 된 같은 회사 Executive에게 Vault가 보인다')
  assert.equal(await u(AT.cfo, vault), 0, '0045: GroupCFO에게 Vault가 보인다')
  assert.equal(await u(AT.exec2, `select count(*)::int from attachment_vault_viewers`), 1, '0045: 지정자가 자기 줄을 못 본다')
  assert.equal(await u(AT.exec, `select count(*)::int from attachment_vault_viewers`), 0, '0045: 남의 지정 줄이 보인다')

  // ── 올리기 ──
  const add = (table: string, id: string, cls: string) =>
    `insert into attachments (entity_table, entity_id, file_name, mime, size_bytes, security_class)
     values ('${table}', '${id}', 'x.pdf', '${PDF}', 10, '${cls}')`
  assert.equal(await u(AT.member, add('businesses', 'biz_dy', 'Normal')), 1, '0045: Member가 자기 회사에 일반 첨부를 못 올린다')
  assert.equal(await u(AT.member, add('businesses', 'biz_dy', 'Restricted')), 'denied', '0045: Member가 제한 등급을 올린다(볼 수도 없는 등급)')
  assert.equal(await u(AT.member, add('businesses', 'biz_vana', 'Normal')), 'denied', '0045: Member가 남의 회사에 올린다')
  assert.equal(await u(AT.member, add('initiatives', 'ini_att', 'Normal')), 'denied', '0045: Member가 안 보이는 이니셔티브에 올린다')
  assert.equal(await u(AT.member, add('decisions', 'dec_missing', 'Normal')), 'denied', '0045: 없는 대상에 올린다')
  assert.equal(await u(AT.cfo, add('businesses', 'biz_dy', 'Vault')), 'denied', '0045: 회장 아닌 사람이 Vault를 올린다')
  assert.equal(await u(AT.exec2, add('businesses', 'biz_dy', 'Vault')), 'denied', '0045: Vault 지정자가 새 Vault를 올린다')
  assert.equal(await u(AT.agent, add('businesses', 'biz_dy', 'Normal')), 'denied', '0045: AIAgent가 첨부를 올린다')
  assert.equal(await u(AT.integration, add('businesses', 'biz_dy', 'Normal')), 'denied', '0045: Integration이 첨부를 올린다')
  // 0047: 회장도 새 Vault 줄을 못 넣는다(restrictive insert — 앱 레벨 암호화 전까지 링크로만). 0045의
  // skipped_vault 트리거는 0047 이전에 들어온 줄(여기서는 소유자가 심은 시드)로 잰다.
  assert.equal(await u(AT.chair, add('businesses', 'biz_dy', 'Vault')), 'denied', '0047: 회장이 새 Vault 첨부를 올린다')
  assert.equal(await u(AT.chair, add('businesses', 'biz_dy', 'Restricted')), 1, '0047: Vault 차단이 회장의 제한 등급 올리기까지 막는다')
  assert.equal(await u(AT.chair, `select count(*)::int from attachments where status = 'skipped_vault' and attachment_id = '${AF.dyV}'`),
    1, '0045: Vault 첨부가 skipped_vault로 서지 않는다')
  // 처음부터 «요약됨» · 남의 이름으로 넣어도 DB가 덮는다.
  assert.equal(await u(AT.exec,
    `select count(*)::int from attachments where file_name = 'y.pdf' and status = 'uploaded' and ai_summary is null
        and uploaded_by = '${AT.exec}' and business_id = 'biz_dy'`,
    `insert into attachments (entity_table, entity_id, file_name, mime, size_bytes, status, ai_summary, uploaded_by, business_id)
     values ('businesses', 'biz_dy', 'y.pdf', '${PDF}', 10, 'summarized', '${SUMMARY}'::jsonb, '${AT.chair}', 'biz_vana')`), 1,
  '0045: 올릴 때 요약 · 상태 · 올린 사람 · 회사를 화면 값 그대로 받는다')
  assert.equal(await u(AT.exec,
    `select count(*)::int from audit_log where entity_table = 'attachments' and action::text = 'upload' and actor_user_id = '${AT.exec}'`,
    add('decisions', 'dec_att', 'Restricted')), 1, '0045: 올림이 감사에 upload로 안 남는다')

  // 모양 — DB가 막는다.
  // 소유자 권한으로 넣는다 — RLS의 with check가 제약보다 먼저 막으면 어느 줄이 막았는지 못 가린다.
  const raw = async (table: string, id: string, mime: string, size: number, cls = 'Normal') => {
    await db.exec('begin')
    try {
      await db.exec(`insert into attachments (entity_table, entity_id, file_name, mime, size_bytes, security_class, uploaded_by) values ('${table}', '${id}', 'x', '${mime}', ${size}, '${cls}', '${AT.chair}')`)
    } finally {
      await db.exec('rollback')
    }
  }
  await assert.rejects(raw('tasks', 't1', PDF, 10), /attachments_entity_check/, '0045: 모르는 대상 표')
  await assert.rejects(raw('businesses', '../biz_dy', PDF, 10), /attachments_entity_id_check/, '0045: 경로를 벗어나는 대상 id')
  await assert.rejects(raw('businesses', 'biz_dy', 'application/x-msdownload', 10), /attachments_mime_check/, '0045: 받지 않는 형식')
  await assert.rejects(raw('businesses', 'biz_dy', PDF, 20971521), /attachments_size_check/, '0045: 20MB 초과')
  await assert.rejects(raw('businesses', 'biz_dy', PDF, 10, 'Public'), /attachments_class_check/, '0045: 첨부에 공개 등급')
  await assert.rejects(u(AT.chair, `update attachments set status = 'done' where attachment_id = '${AF.dyN}'`), /attachments_status_check/, '0045: 없는 상태')

  // ── 요약 칸 쓰기 ──
  const summarize = (id: string, json = SUMMARY) =>
    `update attachments set status = 'summarized', ai_summary = '${json}'::jsonb, ai_model = 'm' where attachment_id = '${id}'`
  assert.equal(await u(AT.exec, summarize(AF.dyN)), 1, '0045: 올린 사람이 요약을 못 적는다')
  assert.equal(await u(AT.chair, summarize(AF.dyN)), 1, '0045: 회장이 요약을 못 적는다')
  assert.equal(await u(AT.member, summarize(AF.dyN)), 0, '0045: 올린 사람도 회장도 아닌 Member가 요약을 고친다')
  assert.equal(await u(AT.agent, summarize(AF.dyN)), 0, '0045: AIAgent가 요약 칸을 쓴다')
  assert.equal(await u(AT.exec,
    `select count(*)::int from attachments where attachment_id = '${AF.dyN}' and summarized_at is not null and search_text like '%계약 초안%'`,
    summarize(AF.dyN)), 1, '0045: 요약 시각 · 검색 문장이 안 채워진다')
  assert.equal(await u(AT.exec,
    `select count(*)::int from audit_log where entity_table = 'attachments' and entity_id = '${AF.dyN}' and action::text = 'ai_summarize' and note = 'AI 요약'`,
    summarize(AF.dyN)), 1, '0045: 요약이 감사에 ai_summarize로 안 남는다')
  await assert.rejects(u(AT.exec, `update attachments set security_class = 'Normal' where attachment_id = '${AF.dyR}'`), /permission denied/,
    '0045: 등급을 update로 내린다 — 칸 단위 grant가 빠졌다')
  await assert.rejects(u(AT.exec, `update attachments set entity_id = 'biz_vana' where attachment_id = '${AF.dyR}'`), /permission denied/,
    '0045: 첨부를 다른 대상으로 옮긴다')
  await assert.rejects(u(AT.chair, summarize(AF.dyV)), /attachments_vault_check/, '0045: Vault 첨부에 요약이 적힌다')
  for (const [bad, why] of [
    ['{"summary":["a","b","c","d"],"key_numbers":[],"decisions_needed":[],"next_actions":[],"confidence":"high"}', '넷째 줄'],
    ['{"summary":["a"],"key_numbers":[],"decisions_needed":[],"next_actions":[],"confidence":"sure"}', '모르는 확신도'],
    ['{"summary":["a"],"key_numbers":[1],"decisions_needed":[],"next_actions":[],"confidence":"low"}', '숫자 항목'],
    ['{"summary":["a"],"key_numbers":[],"decisions_needed":[],"next_actions":[],"confidence":"low","text":"본문"}', '추출 본문 칸'],
    ['{"summary":"a","key_numbers":[],"decisions_needed":[],"next_actions":[],"confidence":"low"}', '배열 아닌 요약'],
  ] as const) {
    await assert.rejects(u(AT.exec, summarize(AF.dyR, bad)), /attachments_summary_check/, `0045: ${why}이(가) 요약에 들어간다`)
  }
  await assert.rejects(u(AT.exec, `update attachments set status = 'summarized' where attachment_id = '${AF.dyR}'`), /attachments_summarized_check/,
    '0045: 요약 없이 «요약됨»')

  // ── 문 둘: 내려받기 · 외부 AI 전송 ──
  const dl = await db.query<{ p: string }>(`select storage_path as p from attachments where attachment_id = '${AF.dyR}'`)
  assert.equal(dl.rows[0].p, `businesses/biz_dy/${AF.dyR}`, '0045: storage_path 모양')
  assert.equal(await u(AT.exec, `select count(*)::int from audit_log where action::text = 'download' and entity_id = '${AF.dyR}'`,
    `select record_attachment_download('${AF.dyR}')`), 1, '0045: 내려받기가 감사에 안 남는다')
  assert.equal(await u(AT.member, `select count(*)::int from (select record_attachment_download('${AF.dyR}') as p) x where p is not null`), 0,
    '0045: 못 보는 첨부의 경로를 내려받기 문이 준다')
  assert.equal(await u(AT.exec, `select count(*)::int from audit_log where action::text = 'ai_external_send' and note = '외부 AI 전송 (제한 등급)'`,
    `select record_attachment_ai_send('${AF.dyR}', 'm')`), 1, '0045: 제한 등급 외부 AI 전송이 감사에 안 남는다')
  await assert.rejects(u(AT.chair, `select record_attachment_ai_send('${AF.dyV}', 'm')`), /attachment_vault_no_ai/, '0045: Vault가 외부 AI 전송 문을 지난다')

  // ── 지우기 ──
  assert.equal(await u(AT.member, `delete from attachments where attachment_id = '${AF.dyN}'`), 0, '0045: Member가 남의 첨부를 지운다')
  assert.equal(await u(AT.agent, `delete from attachments where attachment_id = '${AF.dyN}'`), 0, '0045: AIAgent가 첨부를 지운다')
  assert.equal(await u(AT.exec,
    `select count(*)::int from audit_log where entity_id = '${AF.dyN}' and action::text = 'delete_request' and note = '첨부 삭제'`,
    `delete from attachments where attachment_id = '${AF.dyN}'`), 1, '0045: 올린 사람의 삭제가 감사에 안 남는다')
  assert.equal(await u(AT.chair, `delete from attachments where attachment_id = '${AF.dyN}'`), 1, '0045: 회장이 첨부를 못 지운다')

  // ── 버킷 객체 — 줄이 보이는 사람만, 파일은 AIAgent에게 닫힌다, 덮어쓰기 없음 ──
  const objects = `select count(*)::int from storage.objects where bucket_id = 'attachments'`
  const openAfter0 = (id: string) => `select count(*)::int from storage.objects where bucket_id = 'attachments' and name like '%${id}'`
  // 읽기 통행증 — 올린 본인 · 회장이 아니면 감사 줄(내려받기 · 외부 AI 전송) 없이는 못 연다(리뷰 Important 1).
  assert.equal(await u(AT.chair, objects), 7, '0045: 회장이 첨부 객체 일곱을 못 본다')
  assert.equal(await u(AT.exec2, openAfter0(AF.dyV)), 0, '0045: Vault 지정자가 감사 없이 Vault 파일을 연다(브라우저가 Storage를 바로 부르는 길)')
  assert.equal(await u(AT.cfo, openAfter0(AF.dyR)), 0, '0045: 남이 올린 파일이 감사 없이 열린다')
  const openAfter = (id: string) => `select count(*)::int from storage.objects where bucket_id = 'attachments' and name like '%${id}'`
  assert.equal(await u(AT.cfo, openAfter(AF.dyR), `select record_attachment_download('${AF.dyR}')`), 1, '0045: 내려받기 감사 뒤에도 GroupCFO가 파일을 못 연다')
  assert.equal(await u(AT.exec, openAfter(AF.dyR), `select record_attachment_ai_send('${AF.dyR}', 'm')`), 1, '0045: 외부 AI 전송 감사 뒤에도 요약용으로 파일을 못 연다')
  assert.equal(await u(AT.cfo, openAfter(AF.dyN), `select record_attachment_download('${AF.dyR}')`), 0, '0045: 다른 첨부의 통행증으로 파일이 열린다')
  assert.equal(await u(AT.member, openAfter(AF.dyR), `select record_attachment_download('${AF.dyR}')`), 0, '0045: 줄이 안 보이는 Member가 통행증으로 파일을 연다')
  // AIAgent는 감사 줄조차 못 적는다(denied) — 어느 쪽이든 파일은 안 열린다.
  assert.notEqual(await u(AT.agent, openAfter(AF.dyR), `select record_attachment_download('${AF.dyR}')`), 1, '0045: AIAgent가 첨부 파일을 연다')
  assert.equal(await u(AT.exec2, openAfter(AF.dyV), `select record_attachment_download('${AF.dyV}')`), 1, '0045: Vault 지정자가 내려받기 감사 뒤에 Vault 파일을 못 연다')
  // 첨부 감사 줄(파일 이름 · 등급)은 본인과 회장만 — subtree 읽기로 새지 않는다(리뷰 Important 3).
  const dlRows = `select count(*)::int from audit_log where entity_table = 'attachments' and action::text = 'download' and actor_user_id = '${AT.exec2}'`
  for (const [who, uid] of [['GroupCFO', AT.cfo], ['Member', AT.member]] as const) {
    assert.equal(await u(uid, dlRows, `select set_config('request.jwt.claim.sub', '${AT.exec2}', true); select record_attachment_download('${AF.dyV}'); select set_config('request.jwt.claim.sub', '${uid}', true);`), 0,
      `0045: ${who}가 남의 첨부 감사 줄(Vault 파일 이름)을 읽는다`)
  }
  assert.equal(await u(AT.chair, dlRows, `select set_config('request.jwt.claim.sub', '${AT.exec2}', true); select record_attachment_download('${AF.dyV}'); select set_config('request.jwt.claim.sub', '${AT.chair}', true);`), 1,
    '0045: 회장이 첨부 감사 줄을 못 읽는다')
  assert.equal(await u(AT.exec, `insert into storage.objects (bucket_id, name) values ('attachments', 'businesses/biz_dy/${AF.dyR}-copy')`), 'denied',
    '0045: 줄 없는 경로에 올린다')
  assert.equal(await u(AT.exec,
    `insert into storage.objects (bucket_id, name) select 'attachments', storage_path from attachments where file_name = 'new.pdf'`,
    `insert into attachments (entity_table, entity_id, file_name, mime, size_bytes) values ('businesses', 'biz_dy', 'new.pdf', '${PDF}', 10)`),
  1, '0045: 올린 사람이 자기 줄 경로에 객체를 못 올린다')
  assert.equal(await u(AT.member,
    `insert into storage.objects (bucket_id, name) select 'attachments', storage_path from attachments where file_name = 'new.pdf'`,
    `select set_config('request.jwt.claim.sub', '${AT.exec}', true);
     insert into attachments (entity_table, entity_id, file_name, mime, size_bytes, security_class) values ('businesses', 'biz_dy', 'new.pdf', '${PDF}', 10, 'Normal');
     select set_config('request.jwt.claim.sub', '${AT.member}', true);`),
  'denied', '0045: 남이 만든 줄의 경로에 객체를 올린다')
  // 올리는 창은 요약 전뿐 — 요약이 선 줄의 경로에 새 바이트를 넣지 못한다(리뷰 Important 2).
  assert.equal(await u(AT.exec,
    `insert into storage.objects (bucket_id, name) select 'attachments', storage_path from attachments where file_name = 'new.pdf'`,
    `insert into attachments (entity_table, entity_id, file_name, mime, size_bytes) values ('businesses', 'biz_dy', 'new.pdf', '${PDF}', 10);
     update attachments set status = 'summarized', ai_summary = '${SUMMARY}'::jsonb, ai_model = 'm', summarized_at = now() where file_name = 'new.pdf';`),
  'denied', '0045: 요약이 선 뒤에 같은 경로로 파일을 바꿔 올린다')
  assert.equal(await u(AT.chair, `update storage.objects set name = name || '-v2' where bucket_id = 'attachments'`), 0,
    '0045: 첨부 원본을 덮어쓴다(update 정책이 없어야 한다)')
  assert.equal(await u(AT.member, `delete from storage.objects where bucket_id = 'attachments' and name = 'businesses/biz_dy/${AF.dyN}'`), 0,
    '0045: Member가 남의 첨부 파일을 지운다')
  assert.equal(await u(AT.exec, `delete from storage.objects where bucket_id = 'attachments' and name = 'businesses/biz_dy/${AF.dyR}'`), 1,
    '0045: 올린 사람이 자기 파일을 못 지운다')

  // ── ai_usage_log — 회장만 읽고, 자기 이름으로만 쓰고, 고치지 못한다 ──
  const usage = (uid: string) =>
    `insert into ai_usage_log (feature, model, input_tokens, output_tokens, estimated_cost_usd, user_id) values ('attachment_summary', 'm', 10, 5, 0.0001, '${uid}')`
  assert.equal(await u(AT.member, `select count(*)::int from ai_usage_log`, usage(AT.member)), 0, '0045: Member가 사용량 표를 읽는다')
  assert.equal(await u(AT.chair, `select count(*)::int from ai_usage_log where user_id = '${AT.chair}'`, usage(AT.cfo)), 1,
    '0045: 남의 이름으로 적은 사용량이 그대로 남는다(또는 회장이 못 읽는다)')
  assert.equal(await u(AT.agent, usage(AT.agent)), 1, '0045: AIAgent가 사용량을 못 적는다(Phase 11 야간 비용)')
  assert.equal(await u(AT.integration, usage(AT.integration)), 'denied', '0045: Integration이 사용량을 적는다')
  await assert.rejects(u(AT.chair, `update ai_usage_log set estimated_cost_usd = 0`), /permission denied/, '0045: 사용량을 고친다')
  await assert.rejects(u(AT.chair, `delete from ai_usage_log`), /permission denied/, '0045: 사용량을 지운다')
  await assert.rejects(as('anon', null, `select count(*)::int from ai_usage_log`), /permission denied/, '0045: anon이 사용량을 읽는다')
  await assert.rejects(u(AT.chair, `insert into ai_usage_log (feature, model) values ('Bad Feature!', 'm')`), /ai_usage_log_feature_check/, '0045: 기능 이름 모양')

  // ── restrictive 방어선 — 카탈로그에서 잰다(permissive가 느슨해진 날 남는 줄) ──
  const { rows: pol } = await db.query<{ k: string; p: string }>(
    `select tablename || '.' || policyname as k, permissive as p from pg_policies
      where tablename in ('attachments', 'attachment_vault_viewers') and (policyname like 'ai_agent_no_%' or policyname like 'integration_no_%')`)
  const kinds = new Map(pol.map((r) => [r.k, r.p]))
  for (const t of ['attachments', 'attachment_vault_viewers']) {
    for (const who of ['ai_agent', 'integration']) {
      for (const op of ['insert', 'update', 'delete']) {
        assert.equal(kinds.get(`${t}.${who}_no_${op}`), 'RESTRICTIVE', `0045: ${t}에 ${who}_no_${op}가 restrictive로 있어야 한다`)
      }
    }
  }
  await db.close()
}

/**
 * 0046 AI 어시스턴트 — 새 PGlite 한 벌. 제안(ai_actions)은 넣으면 늘 pending · 15분이고,
 * 확인은 ai_action_decide() 하나로 주인만 · 한 번만 · 만료 전만 넘어간다. 확인은 감사에 남는다.
 */
const AA = {
  chair: '00000000-0000-0000-0000-0000000046c0',
  member: '00000000-0000-0000-0000-0000000046c1',
  other: '00000000-0000-0000-0000-0000000046c2',
  agent: '00000000-0000-0000-0000-0000000046c3',
  integration: '00000000-0000-0000-0000-0000000046c4',
  lead: '00000000-0000-0000-0000-0000000046c5', // member의 상사(subtree로 감사를 읽는 자리)
  cfo: '00000000-0000-0000-0000-0000000046c6',
}
/** 주인이 넣는 제안의 고정 id — 남이 «그 줄»을 지목해 확인하게 하려면 RLS 밖에서 id를 알아야 한다. */
const AA_ACTION = '00000000-0000-0000-0000-0000000046e0'

async function aiAssistant() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values
      ('${AA.chair}', 'b1@x'), ('${AA.member}', 'b2@x'), ('${AA.other}', 'b3@x'), ('${AA.agent}', 'b4@x'), ('${AA.integration}', 'b5@x'),
      ('${AA.lead}', 'b6@x'), ('${AA.cfo}', 'b7@x');
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${AA.chair}', 'Chairman', 'ch', 'Vault'),
      ('${AA.member}', 'Member', 'm', 'Normal'),
      ('${AA.other}', 'Member', 'o', 'Normal'),
      ('${AA.agent}', 'AIAgent', 'ai', 'Restricted'),
      ('${AA.integration}', 'Integration', 'sync', 'Restricted'),
      ('${AA.lead}', 'TeamLead', 'lead', 'Normal'),
      ('${AA.cfo}', 'GroupCFO', 'cfo', 'Restricted');
    update user_profiles set reports_to = '${AA.lead}' where user_id = '${AA.member}';
    insert into user_business_access values ('${AA.member}', 'biz_dy'), ('${AA.other}', 'biz_dy'), ('${AA.lead}', 'biz_dy');
    insert into initiatives (initiative_id, title, kind) values ('ini_ai', 'VLING24', 'Deal');
  `)

  // 한 트랜잭션 안에서 여러 문장을 순서대로 돌리고 마지막 결과를 돌려준다(끝나면 되돌린다).
  async function as(uid: string | null, steps: string[], role: 'authenticated' | 'anon' = 'authenticated'): Promise<unknown[] | 'denied'> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true); set local role ${role};`)
    try {
      let last: unknown[] = []
      for (const s of steps) {
        if (s.startsWith('@')) {
          // '@<uid>' — 같은 트랜잭션 안에서 다른 사람으로 바꾼다(남이 넣은 줄을 두고 재기 위해).
          await db.exec(`select set_config('request.jwt.claim.sub', '${s.slice(1)}', true)`)
          continue
        }
        if (s.startsWith('!')) {
          // '!<sql>' — 역할 밖(소유자)으로 잠깐 나가 시각을 옮긴다. 만료를 흉내 내는 자리뿐이다.
          await db.exec(`reset role; ${s.slice(1)}; set local role ${role};`)
          continue
        }
        last = (await db.query(s)).rows as unknown[]
      }
      return last
    } catch (e) {
      if (/row-level security/.test(e instanceof Error ? e.message : '')) return 'denied'
      throw e
    } finally {
      await db.exec('rollback')
    }
  }
  const insert = (extra = '') =>
    `insert into ai_actions (kind, payload, preview, target_table, target_id, business_id${extra ? ', status, expires_at' : ''})
     values ('initiative_update', '{"initiative_id":"ini_ai","changes":{"next_action":"계약서 초안"}}', '{"title":"VLING24 다음 행동"}', 'initiatives', 'ini_ai', 'biz_nope'${extra})`
  const decide = (confirm: boolean) =>
    `select ai_action_decide((select action_id from ai_actions order by created_at desc limit 1), ${confirm}) as r`
  // 결과 첫 줄. RLS 거부면 그 자체가 실패다(거부를 재는 곳은 as()의 'denied'를 직접 본다).
  const one = (rows: unknown[] | 'denied'): Record<string, unknown> => {
    assert.notEqual(rows, 'denied', '0046: 기대하지 않은 RLS 거부')
    return (rows as unknown[])[0] as Record<string, unknown>
  }

  // ── 자물쇠: force 없음, anon은 표 · 함수 전부 없음 ──
  const lock = await db.query<{ forced: boolean; anon: boolean; upd: boolean }>(`
    select c.relforcerowsecurity as forced,
           has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') as anon,
           has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete') as upd
      from pg_class c where c.relname = 'ai_actions'`)
  assert.deepEqual(lock.rows, [{ forced: false, anon: false, upd: false }], '0046: ai_actions에 force가 걸렸거나 anon에게 열렸거나 update/delete grant가 있다')
  for (const fn of ['ai_action_decide(uuid, boolean)', 'ai_action_finish(uuid, boolean, text)']) {
    const r = await db.query<{ ok: boolean }>(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)
    assert.equal(r.rows[0].ok, false, `0046: anon이 ${fn}을 부를 수 있다`)
  }
  await assert.rejects(as(null, [`select count(*) from ai_actions`], 'anon'), /permission denied/, '0046: anon이 ai_actions를 읽는다')

  // ── 넣으면 늘 pending · 15분 · 내 이름 — 'confirmed' · 먼 만료를 보내도 덮인다 ──
  const stamped = one(await as(AA.member, [
    insert(`, 'confirmed', now() + interval '10 years'`),
    `select status, user_id::text as uid, extract(epoch from (expires_at - created_at))::int as ttl from ai_actions`,
  ]))
  assert.deepEqual(stamped, { status: 'pending', uid: AA.member, ttl: 900 }, '0046: 넣을 때 상태 · 만료 · 주인을 DB가 정하지 않는다')

  // ── 고치고 지우는 길이 없다(상태를 표에서 직접 못 옮긴다) ──
  await assert.rejects(as(AA.member, [insert(), `update ai_actions set status = 'confirmed'`]), /permission denied/, '0046: 제안을 직접 confirmed로 고친다')
  await assert.rejects(as(AA.chair, [insert(), `delete from ai_actions`]), /permission denied/, '0046: 제안을 지운다')

  // ── 확인: 주인만 · 한 번만 · 감사 «AI 제안, 직원 확인» ──
  const confirmed = one(await as(AA.member, [insert(), decide(true)]))
  assert.equal((confirmed as { r: { status: string } }).r.status, 'confirmed', '0046: 주인이 확인해도 confirmed가 안 된다')
  assert.equal(one(await as(AA.member, [insert(), decide(true), decide(true)])).r, null, '0046: 같은 제안을 두 번 확인한다')
  assert.equal(one(await as(AA.member, [insert(), decide(false), decide(true)])).r, null, '0046: 취소한 제안을 뒤에 확인한다')
  // 남이 확인: **주인의 id를 글자로** 지목한다(하위 질의로 찾으면 남의 RLS가 null을 줘서 늘 통과한다 — 리뷰 Important 1).
  // 확인을 시도한 뒤 주인으로 돌아와 줄이 그대로 pending이고 감사가 없는지까지 본다.
  const fixed = `insert into ai_actions (action_id, kind, payload, preview, target_table, target_id)
     values ('${AA_ACTION}', 'initiative_update', '{}', '{"title":"t"}', 'initiatives', 'ini_ai')`
  const untouched = `select status, (select count(*)::int from audit_log where note like 'AI 제안%') as audits from ai_actions where action_id = '${AA_ACTION}'`
  for (const [who, why] of [[AA.other, '남(같은 회사 직원)'], [AA.chair, '회장(확인은 제안받은 본인의 일이다)'], [AA.lead, '상사']] as const) {
    const rows = await as(AA.member, [fixed, `@${who}`, `select ai_action_decide('${AA_ACTION}', true) as r`, `@${AA.member}`, untouched])
    assert.deepEqual(one(rows), { status: 'pending', audits: 0 }, `0046: ${why}이(가) 남의 제안을 확인한다`)
  }
  for (const who of [AA.agent, AA.integration]) {
    await assert.rejects(as(AA.member, [fixed, `@${who}`, `select ai_action_decide('${AA_ACTION}', true)`]), /ai_action_denied/,
      '0046: 시스템 계정이 제안을 확인한다')
  }
  // 대조군: 같은 고정 id를 주인이 확인하면 넘어간다(위 검사들이 id를 잘못 지목해 통과한 것이 아님을 보인다).
  assert.equal(one(await as(AA.member, [fixed, `select ai_action_decide('${AA_ACTION}', true)->>'status' as s`])).s, 'confirmed',
    '0046: 주인이 고정 id로 확인하지 못한다')
  assert.equal(one(await as(AA.member, [insert(), `@${AA.other}`, `select count(*)::int as n from ai_actions`])).n, 0, '0046: 남의 제안이 보인다')
  assert.equal(one(await as(AA.member, [insert(), `!update ai_actions set expires_at = now() - interval '1 second'`, decide(true)])).r, null,
    '0046: 만료된 제안을 확인한다')

  const audit = one(await as(AA.member, [insert(), decide(true),
    `select entity_table, entity_id, business_id, note, actor_role, after->>'kind' as kind from audit_log where note like 'AI 제안%'`]))
  assert.deepEqual(audit, { entity_table: 'initiatives', entity_id: 'ini_ai', business_id: null, note: 'AI 제안, 직원 확인', actor_role: 'Member', kind: 'initiative_update' },
    '0046: 확인이 대상 줄의 감사에 «AI 제안, 직원 확인»으로 남지 않는다(없는 회사는 null이어야 한다)')
  const chairAudit = one(await as(AA.chair, [insert(), decide(true), `select note from audit_log where note like 'AI 제안%'`]))
  assert.equal(chairAudit.note, 'AI 제안, 회장 확인', '0046: 회장 확인 문구')
  assert.equal(one(await as(AA.chair, [insert(), decide(false), `select count(*)::int as n from audit_log where note like 'AI 제안%'`])).n, 0,
    '0046: 취소가 «확인»으로 감사에 남는다')

  // AI 확인 감사 줄은 본인과 회장만 읽는다 — 상사(subtree)도 CFO도 0줄(리뷰 Important 2).
  const auditCount = `select count(*)::int as n from audit_log where note like 'AI 제안%'`
  for (const [who, why] of [[AA.lead, '상사(TeamLead)'], [AA.cfo, 'GroupCFO'], [AA.other, '다른 직원']] as const) {
    assert.equal(one(await as(AA.member, [insert(), decide(true), `@${who}`, auditCount])).n, 0, `0046: ${why}가 남의 AI 확인 감사를 읽는다`)
  }
  assert.equal(one(await as(AA.member, [insert(), decide(true), `@${AA.chair}`, auditCount])).n, 1, '0046: 회장이 AI 확인 감사를 못 읽는다')
  assert.equal(one(await as(AA.member, [insert(), decide(true), auditCount])).n, 1, '0046: 본인이 자기 AI 확인 감사를 못 읽는다')
  // 대조군: 같은 상사가 부하 직원의 **보통** 감사 줄은 읽는다(정책이 AI 줄만 좁혔는지).
  assert.equal(one(await as(AA.member, [`insert into audit_log (action, entity_table, entity_id, actor_user_id, actor_role) values ('update', 'initiatives', 'ini_ai', '${AA.member}', 'Member')`,
    `@${AA.lead}`, `select count(*)::int as n from audit_log where entity_id = 'ini_ai'`])).n, 1, '0046: 새 정책이 AI 아닌 감사까지 막는다')

  // ── 실행 결과: confirmed에서만 done/failed ──
  const id = `(select action_id from ai_actions order by created_at desc limit 1)`
  assert.equal(one(await as(AA.member, [insert(), `select ai_action_finish(${id}, true, '저장') as ok`])).ok, false, '0046: 확인 전 제안을 done으로 적는다')
  assert.deepEqual(one(await as(AA.member, [insert(), decide(true), `select ai_action_finish(${id}, true, '저장')`, `select status, result from ai_actions`])),
    { status: 'done', result: '저장' }, '0046: 확인 뒤 실행 결과가 안 적힌다')

  // ── 시스템 계정은 제안을 못 만든다 · 남의 대화에 못 건다 ──
  assert.equal(await as(AA.agent, [insert()]), 'denied', '0046: AIAgent가 제안을 만든다')
  assert.equal(await as(AA.integration, [insert()]), 'denied', '0046: Integration이 제안을 만든다')
  assert.equal(await as(AA.member, [`insert into ai_chats (chat_id, title) values ('00000000-0000-0000-0000-0000000046d0', '남의 대화')`, `@${AA.other}`,
    `insert into ai_actions (chat_id, kind, payload, preview) values ('00000000-0000-0000-0000-0000000046d0', 'checkin', '{}', '{}')`]), 'denied',
  '0046: 남의 대화에 제안을 건다')
  await assert.rejects(as(AA.member, [`insert into ai_actions (kind, payload, preview) values ('drop_table', '{}', '{}')`]), /ai_actions_kind_check/, '0046: 모르는 쓰기 종류')

  // ── 대화 표의 새 칸 ──
  await assert.rejects(as(AA.member, [`insert into ai_chats (title, context_path) values ('x', '//evil.example')`]), /ai_chats_context_path_check/, '0046: 바깥 경로를 대화 화면으로 적는다')
  assert.deepEqual(one(await as(AA.member, [`insert into ai_chats (title, context_path) values ('x', '/initiatives/ini_ai')`,
    `insert into ai_chat_messages (chat_id, role, content, tokens, actions) select chat_id, 'assistant', '답', 1200, '["a"]' from ai_chats`,
    `select sum(tokens)::int as t from ai_chat_messages`])), { t: 1200 }, '0046: 답의 토큰이 안 남는다')

  // ── restrictive 방어선 — 카탈로그에서 잰다 ──
  const { rows: pol } = await db.query<{ k: string; p: string }>(
    `select policyname as k, permissive as p from pg_policies where tablename = 'ai_actions' and policyname like '%_no_insert'`)
  assert.deepEqual(Object.fromEntries(pol.map((r) => [r.k, r.p])), { ai_agent_no_insert: 'RESTRICTIVE', integration_no_insert: 'RESTRICTIVE' },
    '0046: ai_actions의 시스템 계정 방어선이 restrictive가 아니다')
  await db.close()
}

/**
 * 0047 재무 모듈 권한 — 사람 × 회사 단위('/finance/<business_id>' user_module_access).
 *
 * 첫 실사용자(DY 경영지원 TeamLead)가 biz_dy 장부를 읽고 · 전표를 넣고 · 공식 재무제표를 넣는다.
 * 다른 회사는 0행 · 거부 — **그 회사 접근(user_business_access)을 더해도** 그 회사 줄이 없으면 그대로다(리뷰 I1).
 * 마감은 그 회사의 can_approve가 있어야만. 같은 TeamLead라도 줄이 없으면(영업팀장) 0행이다.
 * AIAgent · Integration은 줄이 있어도 넓어지지 않는다.
 * 기본 권한은 회장이 넣거나 승인한 초대의 가입 · 회장의 조직도 이동에만 붙는다 — 위임 초대에는 안 붙는다(리뷰 C1).
 * 회수하면 줄이 전부 지워지고, 회장이 경영지원 자리에서 옮기면 기본값 모양의 줄만 지워진다(리뷰 I2).
 */
const FG = {
  chair: '00000000-0000-0000-0000-0000000047a1',
  cfo: '00000000-0000-0000-0000-0000000047a2',
  lead: '00000000-0000-0000-0000-0000000047a3', // DY 경영지원 팀장 — 회장 초대로 가입(기본 권한 대상)
  sales: '00000000-0000-0000-0000-0000000047a4', // DY 영업팀장 — 줄 없음
  agent: '00000000-0000-0000-0000-0000000047a5',
  integration: '00000000-0000-0000-0000-0000000047a6',
  exec: '00000000-0000-0000-0000-0000000047a7', // DY Executive — can_read_restricted로 읽기만(회귀)
  member: '00000000-0000-0000-0000-0000000047a8', // DY 직원 — 위임 초대를 넣는 사람
  delegated: '00000000-0000-0000-0000-0000000047a9', // 직원이 위임 초대한 경영지원 팀장
}

async function financeGrants() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  // 0054의 새 직원 «결재 올리기» 트리거는 여기서 끈다 — 이 검사는 재무 · 문서 줄의 개수를 그대로 잰다. 0054는 approvalStaff()가 잰다.
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  const ledger = await loadMockLedger()
  await db.exec(`delete from accounts where source = 'manual'`)
  await bulk(db, 'accounts', ledger.accounts, ['business_id', 'account_code', 'name', 'category', 'section', 'cash_flow', 'source', 'fetched_at', 'closed'])
  await bulk(db, 'journal_lines', ledger.journal, ['business_id', 'entry_date', 'account_code', 'amount', 'side', 'slip_no', 'line_no', 'memo', 'source', 'fetched_at', 'closed'])
  await bulk(db, 'closings', ledger.closings, ['business_id', 'period', 'account_code', 'amount', 'closed_on', 'provisional_amount', 'source', 'fetched_at', 'closed'])
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    insert into auth.users values
      ('${FG.chair}', 'f1@x'), ('${FG.cfo}', 'f2@x'), ('${FG.sales}', 'f4@x'),
      ('${FG.agent}', 'f5@x'), ('${FG.integration}', 'f6@x'), ('${FG.exec}', 'f7@x'), ('${FG.member}', 'f8@x');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${FG.chair}', 'Chairman', 'ch', 'Vault', null),
      ('${FG.cfo}', 'GroupCFO', 'cfo', 'Restricted', null),
      ('${FG.sales}', 'TeamLead', '영업팀장', 'Normal', 'team_dy_sales'),
      ('${FG.agent}', 'AIAgent', 'ai', 'Restricted', null),
      ('${FG.integration}', 'Integration', 'sync', 'Restricted', null),
      ('${FG.exec}', 'Executive', 'ex', 'Restricted', 'team_dy_sales'),
      ('${FG.member}', 'Member', '직원', 'Normal', 'team_dy_production');
    insert into user_business_access values
      ('${FG.sales}', 'biz_dy'), ('${FG.exec}', 'biz_dy'), ('${FG.member}', 'biz_dy');
    insert into user_business_access select '${FG.agent}', business_id from businesses;
    insert into user_business_access select '${FG.integration}', business_id from businesses;
    -- 누가 실수로 시스템 계정에 재무 줄을 넣었다 — 그래도 범위가 넓어지면 안 된다.
    insert into user_module_access (user_id, module, can_write, can_approve) values
      ('${FG.agent}', '/finance/biz_dy', true, true), ('${FG.integration}', '/finance/biz_dy', true, true);
  `)

  // ── 가입 두 갈래: 회장 초대(C1 허용) · 직원의 위임 초대(C1 차단) ──
  //   초대는 그 사람의 세션으로 넣는다(0026 set_approval이 auth_role()로 chairman_approved_at을 정한다 — 위임은 RLS까지 지난다).
  //   가입은 세션 없이 auth.users insert → 0011 on_auth_user_created → apply_user_invitation.
  const inviteAs = async (who: string, email: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${who}', true); set local role authenticated;
      insert into user_invitations (email, role, display_name, invited_by, reports_to, max_security_class, business_ids, team_id)
      values ('${email}', 'TeamLead', '${email}', '${who}', '${who}', 'Normal', '{biz_dy}', 'team_dy_support');
      commit;`)
  }
  await inviteAs(FG.chair, 'lead@x')
  // 0055가 0026 위임 insert를 닫았다 — 직원이 넣은 옛 위임 초대(승인 칸 빈 행)는 세션 없이 심는다.
  await db.exec(`insert into user_invitations (email, role, display_name, invited_by, reports_to, max_security_class, business_ids, team_id)
      values ('delegated@x', 'TeamLead', 'delegated@x', '${FG.member}', '${FG.member}', 'Normal', '{biz_dy}', 'team_dy_support')`)
  await db.exec(`select set_config('request.jwt.claim.sub', '', false);
    insert into auth.users values ('${FG.lead}', 'lead@x'), ('${FG.delegated}', 'delegated@x');`)

  // 한 트랜잭션 안에서 여러 문장. '@<uid>' 사람 바꾸기 · '!<sql>' 소유자로 잠깐 나가기. 끝나면 되돌린다.
  async function as(uid: string, steps: string[]): Promise<'denied' | number> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      let last: Record<string, unknown>[] = []
      let affected = 0
      for (const s of steps) {
        if (s.startsWith('@')) { await db.exec(`select set_config('request.jwt.claim.sub', '${s.slice(1)}', true)`); continue }
        if (s.startsWith('!')) { await db.exec(`reset role; ${s.slice(1)}; set local role authenticated;`); continue }
        const res = await db.query<Record<string, unknown>>(s)
        last = res.rows
        affected = res.affectedRows ?? 0
      }
      await db.exec('set constraints all immediate')
      return last.length ? Number(Object.values(last[0])[0]) : affected
    } catch (e) {
      if (/row-level security/.test(e instanceof Error ? e.message : '')) return 'denied'
      throw e
    } finally {
      await db.exec('rollback')
    }
  }
  const owner = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows
  const grants = (uid: string) => `select count(*)::int from user_module_access where user_id = '${uid}'`

  // ── C1: 회장 초대로 가입한 경영지원 팀장만 기본 권한(입력 O · 마감 X), 위임 초대는 없음 ──
  assert.deepEqual(await owner(`select user_id::text as u, module, can_write, can_approve from user_module_access
      where user_id in ('${FG.lead}', '${FG.delegated}', '${FG.sales}', '${FG.exec}', '${FG.member}') order by 1`),
  [{ u: FG.lead, module: '/finance/biz_dy', can_write: true, can_approve: false }],
  '0047: 회장 초대 경영지원 팀장만 DY 기본 재무 권한을 받아야 한다(위임 초대 · 다른 사람은 없음)')
  assert.deepEqual(await owner(`select role::text as r, team_id as t from user_profiles where user_id = '${FG.delegated}'`),
    [{ r: 'TeamLead', t: 'team_dy_support' }], '0047 검사 전제: 위임 초대가 실제로 경영지원 팀장 계정을 만들었다')
  // 세션 없는 수정(회장 아님)으로 자리를 옮겼다 되돌려도 붙지 않는다.
  await owner(`update user_profiles set team_id = 'team_dy_sales' where user_id = '${FG.delegated}'`)
  await owner(`update user_profiles set team_id = 'team_dy_support' where user_id = '${FG.delegated}'`)
  assert.equal(Number((await owner(grants(FG.delegated)))[0].count), 0, '0047: 회장이 아닌 수정이 경영지원 기본 권한을 붙인다')

  // ── 읽기: 그 회사만 ──
  const lines = (biz: string) => `select count(*)::int from journal_lines where business_id = '${biz}'`
  assert.ok(Number(await as(FG.lead, [lines('biz_dy')])) > 0, '0047: 경영지원 팀장이 DY 전표를 못 읽는다')
  for (const t of ['journal_lines', 'accounts', 'closings', 'journal_entries', 'official_statements', 'finance_kpis_sheet']) {
    assert.equal(await as(FG.lead, [`select count(*)::int from ${t} where business_id <> 'biz_dy'`]), 0, `0047: 경영지원 팀장에게 다른 회사 ${t}가 보인다`)
  }
  assert.equal(await as(FG.lead, [`select count(distinct business_id)::int from finance_kpis`]), 1, '0047: 재무 지표가 DY 하나가 아니다')
  assert.equal(await as(FG.lead, [`select count(*)::int from finance_kpis_masked where value is null and business_id = 'biz_dy'`]), 0,
    '0047: 권한 있는 사람에게 마스킹 뷰가 값을 가린다')
  assert.equal(await as(FG.sales, [lines('biz_dy')]), 0, '0047: 줄 없는 TeamLead(영업팀장)에게 전표가 보인다')
  assert.equal(await as(FG.delegated, [lines('biz_dy')]), 0, '0047: 위임 초대 경영지원 팀장에게 전표가 보인다')
  assert.ok(Number(await as(FG.exec, [lines('biz_dy')])) > 0, '0047: Executive의 기존 읽기가 막혔다')
  assert.equal(await as(FG.exec, [lines('biz_vana')]), 0, '0047: Executive에게 다른 회사가 보인다')

  // ── I1: 회사 접근을 더해도 그 회사 줄이 없으면 닫혀 있다 ──
  const vanaAccess = `!insert into user_business_access values ('${FG.lead}', 'biz_vana')`
  assert.equal(await as(FG.lead, [vanaAccess, lines('biz_vana')]), 0, '0047: VANA 접근만 더했는데 VANA 장부가 열린다')
  assert.ok(Number(await as(FG.lead, [vanaAccess, `!insert into user_module_access (user_id, module) values ('${FG.lead}', '/finance/biz_vana')`, lines('biz_vana')])) > 0,
    '0047: VANA 줄을 줬는데 VANA 장부가 안 열린다')
  assert.equal(await as(FG.lead, [`!insert into user_module_access (user_id, module) values ('${FG.lead}', '/finance/biz_vana')`, lines('biz_vana')]), 0,
    '0047: 회사 접근 없이 모듈 줄만으로 VANA가 열린다')

  // ── 쓰기: 전표 · 공식 재무제표 · 계정과목 — 그 회사만 ──
  const post = (biz: string) =>
    `select count(*)::int from (select post_journal_entry('${biz}', '2026-08-20', '0047 전표', 'https://drive.example/x',
       '[{"account_code":"1010","side":"debit","amount":1000},{"account_code":"4010","side":"credit","amount":1000}]'::jsonb)) x`
  assert.equal(await as(FG.lead, [post('biz_dy')]), 1, '0047: 경영지원 팀장이 DY 전표를 못 넣는다')
  assert.equal(await as(FG.lead, [post('biz_dy'), `select count(*)::int from audit_log where entity_table = 'journal_entries' and actor_user_id = '${FG.lead}'`]), 1,
    '0047: 팀장 전표가 감사에 안 남는다')
  assert.equal(await as(FG.lead, [post('biz_vana')]), 'denied', '0047: 경영지원 팀장이 다른 회사 전표를 넣는다')
  assert.equal(await as(FG.lead, [vanaAccess, post('biz_vana')]), 'denied', '0047: VANA 접근만으로 VANA 전표가 들어간다')
  assert.equal(await as(FG.sales, [post('biz_dy')]), 'denied', '0047: 줄 없는 TeamLead가 전표를 넣는다')
  assert.equal(await as(FG.lead, [`!update user_module_access set can_write = false where user_id = '${FG.lead}'`, post('biz_dy')]), 'denied',
    '0047: 읽기만 가진 사람이 전표를 넣는다')
  const official = (biz: string) =>
    `select count(*)::int from (select official_statement_save('${biz}', 'year', '2025', 'https://drive.example/audit', '0047 결산',
       '[{"account_code":"4010","amount":-5000}]'::jsonb)) x`
  assert.equal(await as(FG.lead, [official('biz_dy')]), 1, '0047: 경영지원 팀장이 DY 공식 재무제표를 못 넣는다')
  assert.equal(await as(FG.lead, [official('biz_dy'), official('biz_dy')]), 1, '0047: 경영지원 팀장이 공식 재무제표를 정정(supersede)하지 못한다')
  assert.equal(await as(FG.lead, [official('biz_vana')]), 'denied', '0047: 경영지원 팀장이 다른 회사 공식 재무제표를 넣는다')
  assert.equal(await as(FG.lead, [`insert into accounts (business_id, account_code, name, category, section, source, fetched_at) values ('biz_dy', '9471', 'x', 'other', 'sga', 'manual', now())`]),
    1, '0047: 경영지원 팀장이 DY 계정과목을 못 만든다')

  // ── 마감: 기본은 없다 · 그 회사의 can_approve를 주면 그 회사만 ──
  const close = (biz: string) => `select close_period('${biz}', '2026-08')`
  await assert.rejects(as(FG.lead, [close('biz_dy')]), /close_forbidden/, '0047: 입력 권한만으로 마감한다')
  const approve = `!update user_module_access set can_approve = true where user_id = '${FG.lead}' and module = '/finance/biz_dy'`
  assert.ok(Number(await as(FG.lead, [approve, close('biz_dy')])) > 0, '0047: DY can_approve를 받은 팀장이 DY를 마감하지 못한다')
  await assert.rejects(as(FG.lead, [approve, vanaAccess, `!insert into user_module_access (user_id, module, can_write) values ('${FG.lead}', '/finance/biz_vana', true)`, close('biz_vana')]),
    /close_forbidden/, '0047: DY 마감 권한이 VANA(입력만 받은 회사)까지 간다')
  assert.ok(Number(await as(FG.cfo, [close('biz_dy')])) > 0, '0047: GroupCFO 마감이 막혔다(회귀)')
  // 인자 없는 0016 can_close_books()는 역할만 그대로다(부르는 곳은 전부 옮겼다).
  assert.equal(await as(FG.lead, [approve, `select can_close_books()::int`]), 0, '0047: 0016의 인자 없는 can_close_books()가 넓어졌다')

  // ── 권한 줄 자체: 본인은 읽기만, 쓰기는 회장만 ──
  assert.equal(await as(FG.lead, [`select count(*)::int from user_module_access`]), 1, '0047: 본인이 자기 모듈 줄을 못 읽는다(세션 안내가 안 선다)')
  assert.equal(await as(FG.lead, [`update user_module_access set can_approve = true where user_id = '${FG.lead}'`]), 0, '0047: 본인이 자기 마감 권한을 켠다')
  assert.equal(await as(FG.lead, [`insert into user_module_access (user_id, module, can_write) values ('${FG.sales}', '/finance/biz_dy', true)`]), 'denied',
    '0047: 팀장이 남에게 재무 권한을 준다')
  assert.equal(await as(FG.cfo, [`insert into user_module_access (user_id, module, can_write) values ('${FG.sales}', '/finance/biz_dy', true)`]), 'denied',
    '0047: GroupCFO가 재무 권한을 준다(회장만)')
  assert.ok(Number(await as(FG.chair, [`insert into user_module_access (user_id, module, can_write) values ('${FG.sales}', '/finance/biz_dy', true)`, `@${FG.sales}`, lines('biz_dy')])) > 0,
    '0047: 회장이 준 권한으로 영업팀장이 읽지 못한다')

  // ── 시스템 계정: 줄이 있어도 그대로 ──
  assert.equal(await as(FG.agent, [post('biz_dy')]), 'denied', '0047: 재무 줄 있는 AIAgent가 전표를 넣는다')
  assert.equal(await as(FG.integration, [post('biz_dy')]), 'denied', '0047: 재무 줄 있는 Integration이 수기 전표를 넣는다')
  assert.equal(await as(FG.integration, [official('biz_dy')]), 'denied', '0047: 재무 줄 있는 Integration이 공식 재무제표를 넣는다')
  await assert.rejects(as(FG.agent, [close('biz_dy')]), /close_forbidden/, '0047: 재무 줄 있는 AIAgent가 마감한다')
  assert.equal(await as(FG.agent, [`select finance_grant('biz_dy', false, false)::int`]), 0, '0047: AIAgent에게 finance_grant가 참이다')
  assert.ok(Number(await as(FG.agent, [lines('biz_vana')])) > 0, '0047: AIAgent의 기존 읽기([제한] 등급)가 막혔다')

  // ── 회장의 조직도 이동: 들어오면 기본 권한 + 회장 이름의 감사, 떠나면 기본값 줄만 삭제 ──
  const moved = await as(FG.chair, [
    `update user_profiles set team_id = 'team_dy_support' where user_id = '${FG.sales}'`,
    `select (select count(*)::int from user_module_access where user_id = '${FG.sales}' and module = '/finance/biz_dy' and can_write and not can_approve)
          + (select count(*)::int from audit_log where entity_table = 'user_module_access' and entity_id = '${FG.sales}'
               and business_id = 'biz_dy' and action = 'permission_change' and actor_user_id = '${FG.chair}') * 10`,
  ])
  assert.equal(moved, 11, '0047: 회장이 경영지원으로 옮긴 팀장에게 기본 권한 · 감사가 안 선다')
  assert.equal(await as(FG.chair, [
    `update user_profiles set team_id = 'team_dy_sales' where user_id = '${FG.lead}'`,
    `select (select count(*)::int from user_module_access where user_id = '${FG.lead}')
          + (select count(*)::int from audit_log where entity_table = 'user_module_access' and entity_id = '${FG.lead}' and before is not null) * 10`,
  ]), 10, '0047: 경영지원 자리를 떠난 팀장의 기본 권한이 안 지워진다(또는 감사가 없다)')
  assert.equal(await as(FG.chair, [approve, `update user_profiles set team_id = 'team_dy_sales' where user_id = '${FG.lead}'`, grants(FG.lead)]), 1,
    '0047: 회장이 마감까지 준 줄을 자리 이동이 지운다')
  assert.equal(await as(FG.chair, [
    `!update user_module_access set can_approve = true where user_id = '${FG.lead}'`,
    `update user_profiles set role = 'Member' where user_id = '${FG.lead}'`,
    `update user_profiles set role = 'TeamLead' where user_id = '${FG.lead}'`,
    `select count(*)::int from user_module_access where user_id = '${FG.lead}' and can_approve`,
  ]), 1, '0047: 기본 권한 트리거가 회장이 준 마감 권한을 덮는다')
  assert.equal(await as(FG.chair, [
    `!delete from user_module_access where user_id = '${FG.lead}'`,
    `update user_profiles set display_name = '경영지원팀장2' where user_id = '${FG.lead}'`,
    grants(FG.lead),
  ]), 0, '0047: 역할 · 팀과 무관한 프로필 수정이 회수한 권한을 되살린다')

  // ── I2: 회수하면 줄 전부 삭제(감사 포함) · 되살려도(재초대 · revoked_at null) 옛 줄은 없다 ──
  const extra = `!insert into user_module_access (user_id, module, can_write, can_approve) values ('${FG.lead}', '/finance/biz_vana', true, true)`
  const revoke = `update user_profiles set revoked_at = now() where user_id = '${FG.lead}'`
  assert.equal(await as(FG.chair, [extra, revoke, grants(FG.lead)]), 0, '0047: 회수했는데 모듈 줄이 남는다')
  assert.equal(await as(FG.chair, [extra, revoke,
    `select count(*)::int from audit_log where entity_table = 'user_module_access' and entity_id = '${FG.lead}' and note like '계정 회수%'`]),
  2, '0047: 회수로 지운 모듈 줄이 감사에 안 남는다')
  assert.equal(await as(FG.chair, [extra, revoke, `!update user_profiles set revoked_at = null where user_id = '${FG.lead}'`, grants(FG.lead)]), 0,
    '0047: 회수 뒤 되살린 계정에 옛 모듈 줄이 돌아온다')
  assert.equal(await as(FG.lead, [`!update user_profiles set revoked_at = now() where user_id = '${FG.lead}'`, lines('biz_dy')]), 0,
    '0047: 회수된 사람이 재무를 읽는다')

  // ── 카탈로그: force 새로 없음 · 트리거 · 도우미 함수는 아무도 못 부른다 ──
  for (const fn of ['finance_profile_grants()', 'finance_default_apply(uuid)', 'module_grant_audit(uuid, text, jsonb, jsonb, text)']) {
    const r = await owner(`select has_function_privilege('authenticated', '${fn}', 'execute') as ok`)
    assert.deepEqual(r, [{ ok: false }], `0047: ${fn}을 authenticated가 부를 수 있다`)
  }
  const forced = await owner(`select relforcerowsecurity as f from pg_class where relname = 'user_module_access'`)
  assert.deepEqual(forced, [{ f: false }], '0047: user_module_access에 force가 걸렸다(0035 함정)')
  await db.close()
}

/**
 * 0048 문서 모듈 권한 — 사람 × 회사 ('/documents/<business_id>').
 *
 * DY 경영지원 팀장(Normal)이 '/documents/biz_dy' 쓰기 줄로 DY 문서 · 폴더를 등록 · 고친다. 줄 없는 팀장은 거부.
 * 다른 회사는 줄만으로도, 회사 접근만으로도 안 열린다(둘 다 있어야). Vault · Restricted 등급은 열람 등급이 모자라면
 * 넣지도 올리지도 못한다. 시스템 계정은 줄이 있어도 그대로. 옛 '/core/search' 줄은 줄어들지 않는다(회귀).
 * 회수하면 문서 줄도 지워지고 감사가 그 회사로 걸린다. documents의 hard delete는 0042대로 닫혀 있다.
 */
const DG = {
  chair: '00000000-0000-0000-0000-0000000048a1',
  lead: '00000000-0000-0000-0000-0000000048a2', // DY 경영지원 팀장 — '/documents/biz_dy' 쓰기
  sales: '00000000-0000-0000-0000-0000000048a3', // DY 영업팀장 — 줄 없음
  agent: '00000000-0000-0000-0000-0000000048a4',
  integration: '00000000-0000-0000-0000-0000000048a5',
  legacy: '00000000-0000-0000-0000-0000000048a6', // 옛 '/core/search' 쓰기 줄을 가진 DY 직원
  cfo: '00000000-0000-0000-0000-0000000048a7',
}

async function documentGrants() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  // 0054의 새 직원 «결재 올리기» 트리거는 여기서 끈다 — 이 검사는 재무 · 문서 줄의 개수를 그대로 잰다. 0054는 approvalStaff()가 잰다.
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    insert into auth.users values
      ('${DG.chair}', 'd1@x'), ('${DG.lead}', 'd2@x'), ('${DG.sales}', 'd3@x'), ('${DG.agent}', 'd4@x'),
      ('${DG.integration}', 'd5@x'), ('${DG.legacy}', 'd6@x'), ('${DG.cfo}', 'd7@x');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${DG.chair}', 'Chairman', 'ch', 'Vault', null),
      ('${DG.lead}', 'TeamLead', '경영지원팀장', 'Normal', 'team_dy_support'),
      ('${DG.sales}', 'TeamLead', '영업팀장', 'Normal', 'team_dy_sales'),
      ('${DG.agent}', 'AIAgent', 'ai', 'Restricted', null),
      ('${DG.integration}', 'Integration', 'sync', 'Restricted', null),
      ('${DG.legacy}', 'Member', '옛 줄', 'Normal', 'team_dy_sales'),
      ('${DG.cfo}', 'GroupCFO', 'cfo', 'Restricted', null);
    -- 팀장 둘은 회장 아래다 — 회장이 그 문서를 보는 길(0026 subtree)이 실제와 같게.
    update user_profiles set reports_to = '${DG.chair}' where user_id in ('${DG.lead}', '${DG.sales}');
    insert into user_business_access values
      ('${DG.lead}', 'biz_dy'), ('${DG.sales}', 'biz_dy'), ('${DG.legacy}', 'biz_dy');
    insert into user_business_access select '${DG.agent}', business_id from businesses;
    insert into user_business_access select '${DG.integration}', business_id from businesses;
    insert into user_module_access (user_id, module, can_write, can_approve) values
      ('${DG.lead}', '/documents/biz_dy', true, false),
      ('${DG.legacy}', '/core/search', true, false),
      -- 누가 실수로 시스템 계정에 문서 줄을 넣었다 — 그래도 쓰기가 열리면 안 된다.
      ('${DG.agent}', '/documents/biz_dy', true, false), ('${DG.integration}', '/documents/biz_dy', true, false);
  `)

  async function as(uid: string, steps: string[]): Promise<'denied' | number> {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      let last: Record<string, unknown>[] = []
      let affected = 0
      for (const s of steps) {
        if (s.startsWith('@')) { await db.exec(`select set_config('request.jwt.claim.sub', '${s.slice(1)}', true)`); continue }
        if (s.startsWith('!')) { await db.exec(`reset role; ${s.slice(1)}; set local role authenticated;`); continue }
        const res = await db.query<Record<string, unknown>>(s)
        last = res.rows
        affected = res.affectedRows ?? 0
      }
      return last.length ? Number(Object.values(last[0])[0]) : affected
    } catch (e) {
      if (/row-level security/.test(e instanceof Error ? e.message : '')) return 'denied'
      throw e
    } finally {
      await db.exec('rollback')
    }
  }
  const owner = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows

  const doc = (biz: string | null, cls = 'Normal', id = 'doc_g48', by = DG.lead) =>
    `insert into documents (document_id, business_id, title, doc_type, security_class, storage_url, uploaded_by)
       values ('${id}', ${biz ? `'${biz}'` : 'null'}, '0048 문서', 'Contract', '${cls}', 'https://drive.example/48', '${by}')`
  const folder = (biz: string) => `insert into doc_folders (business_id, name) values ('${biz}', '0048 폴더')`
  const vanaAccess = `!insert into user_business_access values ('${DG.lead}', 'biz_vana')`
  const vanaRow = `!insert into user_module_access (user_id, module, can_write) values ('${DG.lead}', '/documents/biz_vana', true)`

  // ── documents insert: 그 회사만 · 줄 있는 사람만 ──
  assert.equal(await as(DG.lead, [doc('biz_dy')]), 1, '0048: 문서 줄 있는 경영지원 팀장이 DY 문서를 못 넣는다')
  assert.equal(await as(DG.sales, [doc('biz_dy', 'Normal', 'doc_g48', DG.sales)]), 'denied', '0048: 줄 없는 TeamLead가 DY 문서를 넣는다')
  assert.equal(await as(DG.lead, [`!update user_module_access set can_write = false where user_id = '${DG.lead}'`, doc('biz_dy')]), 'denied',
    '0048: can_write=false 줄로 문서가 들어간다')
  assert.equal(await as(DG.lead, [doc('biz_vana')]), 'denied', '0048: DY 줄로 VANA 문서가 들어간다')
  assert.equal(await as(DG.lead, [vanaRow, doc('biz_vana')]), 'denied', '0048: 회사 접근 없이 VANA 줄만으로 VANA 문서가 들어간다')
  assert.equal(await as(DG.lead, [vanaAccess, doc('biz_vana')]), 'denied', '0048: VANA 접근만 더했는데 VANA 문서가 들어간다')
  assert.equal(await as(DG.lead, [vanaAccess, vanaRow, doc('biz_vana')]), 1, '0048: VANA 접근 + VANA 줄인데 VANA 문서가 안 들어간다')
  assert.equal(await as(DG.lead, [doc(null)]), 'denied', '0048: 팀장이 그룹 공통 문서를 넣는다')

  // ── 등급: 열람 등급 위로는 넣지도 올리지도 못한다 ──
  assert.equal(await as(DG.lead, [doc('biz_dy', 'Vault')]), 'denied', '0048: Normal 직원이 Vault 문서를 넣는다')
  assert.equal(await as(DG.lead, [doc('biz_dy', 'Restricted')]), 'denied', '0048: Normal 직원이 Restricted 문서를 넣는다')
  assert.equal(await as(DG.chair, [doc('biz_dy', 'Vault', 'doc_g48', DG.chair)]), 1, '0048: 회장이 Vault 링크를 못 넣는다(회귀)')
  assert.equal(await as(DG.lead, [doc('biz_dy'), `update documents set security_class = 'Vault' where document_id = 'doc_g48'`]), 'denied',
    '0048: Normal 직원이 문서 등급을 Vault로 올린다')

  // ── update · soft delete · hard delete ──
  assert.equal(await as(DG.lead, [doc('biz_dy'), `update documents set title = '0048 고침' where document_id = 'doc_g48'`]), 1,
    '0048: 경영지원 팀장이 DY 문서를 못 고친다')
  assert.equal(await as(DG.lead, [doc('biz_dy'), `@${DG.sales}`, `update documents set title = 'x' where document_id = 'doc_g48'`]), 0,
    '0048: 줄 없는 팀장이 DY 문서를 고친다')
  assert.equal(await as(DG.lead, [doc('biz_dy'), `select soft_delete('documents', 'doc_g48')::int`]), 1, '0048: 경영지원 팀장이 DY 문서를 못 지운다(soft delete)')
  assert.equal(await as(DG.lead, [doc('biz_dy'), `delete from documents where document_id = 'doc_g48'`]), 0,
    '0048: documents hard delete가 열렸다(0042 soft delete 회귀)')
  assert.deepEqual(await owner(`select policyname from pg_policies where tablename = 'documents' and cmd = 'DELETE' and permissive = 'PERMISSIVE'`), [],
    '0048: documents에 permissive DELETE 정책이 되살아났다')

  // ── 리뷰 I1 · I2: 등록자는 본인 · 고치기는 자기 것만(회장은 전부) · 주인 칸은 회장만 ──
  assert.equal(await as(DG.lead, [doc('biz_dy', 'Normal', 'doc_g48', DG.sales)]), 'denied', '0048: 남의 이름(uploaded_by)으로 문서가 들어간다')
  assert.equal(await as(DG.lead, [doc('biz_dy', 'Normal', 'doc_g48', DG.chair)]), 'denied', '0048: 회장 이름(uploaded_by)으로 문서가 들어간다')
  assert.equal(await as(DG.chair, [doc('biz_dy', 'Normal', 'doc_g48', DG.lead)]), 'denied', '0048: 회장도 남의 이름으로 등록한다(uploaded_by는 본인)')
  // 동료(같은 DY 문서 줄)가 볼 수 있는 공개 문서 — 보이지만 고치지도 지우지도 못한다.
  const salesRow = `!insert into user_module_access (user_id, module, can_write) values ('${DG.sales}', '/documents/biz_dy', true)`
  const colleague = (step: string) => as(DG.lead, [salesRow, doc('biz_dy', 'Public'), `@${DG.sales}`, step])
  assert.equal(await colleague(`select count(*)::int from documents where document_id = 'doc_g48'`), 1, '0048 검사 전제: 동료에게 공개 문서가 보인다')
  assert.equal(await colleague(`update documents set storage_url = 'https://evil.example' where document_id = 'doc_g48'`), 0, '0048: 동료가 남의 문서 링크를 바꾼다')
  assert.equal(await colleague(`update documents set security_class = 'Normal' where document_id = 'doc_g48'`), 0, '0048: 동료가 남의 문서 등급을 바꾼다')
  assert.equal(await colleague(`select soft_delete('documents', 'doc_g48')::int`), 0, '0048: 동료가 남의 문서를 지운다(soft delete)')
  // 자기 문서는 고치지만 주인 · 등록자 칸은 못 바꾼다.
  await assert.rejects(as(DG.lead, [doc('biz_dy'), `update documents set owner_user_id = '${DG.sales}' where document_id = 'doc_g48'`]),
    /document_owner_change_forbidden/, '0048: 직원이 자기 문서의 주인을 바꾼다')
  await assert.rejects(as(DG.lead, [doc('biz_dy'), `update documents set uploaded_by = '${DG.sales}' where document_id = 'doc_g48'`]),
    /document_owner_change_forbidden/, '0048: 직원이 자기 문서의 등록자를 바꾼다')
  assert.equal(await as(DG.lead, [doc('biz_dy'), `update documents set owner_user_id = owner_user_id, title = 'x' where document_id = 'doc_g48'`]), 1,
    '0048: 주인 칸을 그대로 둔 수정이 막힌다')
  // 회장은 남의 문서를 고치고 주인을 다시 정한다.
  assert.equal(await as(DG.lead, [doc('biz_dy'), `@${DG.chair}`,
    `update documents set title = '회장 고침', owner_user_id = '${DG.chair}', uploaded_by = '${DG.chair}' where document_id = 'doc_g48'`]), 1,
  '0048: 회장이 남의 문서를 고치거나 주인을 다시 정하지 못한다')
  assert.equal(await as(DG.lead, [doc('biz_dy'), `@${DG.chair}`, `select soft_delete('documents', 'doc_g48')::int`]), 1, '0048: 회장이 남의 문서를 못 지운다')
  // 세션 없는 수정(마이그레이션 · SQL 편집기 백필)은 트리거가 막지 않는다.
  await owner(`insert into documents (document_id, business_id, title, doc_type, storage_url) values ('doc_o48', 'biz_dy', 'o', 'x', 'https://x/o')`)
  await owner(`update documents set owner_user_id = '${DG.lead}' where document_id = 'doc_o48'`)
  await owner(`delete from documents where document_id = 'doc_o48'`)

  // ── 시스템 계정 · 옛 줄 · GroupCFO ──
  assert.equal(await as(DG.agent, [doc('biz_dy', 'Normal', 'doc_g48', DG.agent)]), 'denied', '0048: 문서 줄 있는 AIAgent가 문서를 넣는다')
  assert.equal(await as(DG.agent, [`select document_grant('biz_dy', true)::int`]), 0, '0048: AIAgent에게 document_grant가 참이다')
  assert.equal(await as(DG.integration, [doc('biz_dy', 'Normal', 'doc_g48', DG.integration)]), 'denied', '0048: 문서 줄 있는 Integration이 문서를 넣는다')
  assert.equal(await as(DG.legacy, [doc('biz_dy', 'Normal', 'doc_g48', DG.legacy)]), 1, '0048: 옛 /core/search 쓰기 줄이 줄어들었다(회귀)')
  assert.equal(await as(DG.legacy, [doc('biz_vana', 'Normal', 'doc_g48', DG.legacy)]), 'denied', '0048: 옛 /core/search 줄이 회사 범위를 넘는다')
  assert.equal(await as(DG.cfo, [doc('biz_dy', 'Normal', 'doc_g48', DG.cfo)]), 'denied', '0048: 줄 없는 GroupCFO가 문서를 넣는다(역할로 넓히지 않았다)')
  assert.equal(await as(DG.cfo, [`!insert into user_module_access (user_id, module, can_write) values ('${DG.cfo}', '/documents/biz_vana', true)`,
    doc('biz_vana', 'Normal', 'doc_g48', DG.cfo)]), 1, '0048: VANA 줄 받은 GroupCFO가 VANA 문서를 못 넣는다')

  // ── doc_folders: 같은 판정 ──
  assert.equal(await as(DG.lead, [folder('biz_dy')]), 1, '0048: 경영지원 팀장이 DY 폴더를 못 만든다')
  assert.equal(await as(DG.sales, [folder('biz_dy')]), 'denied', '0048: 줄 없는 팀장이 DY 폴더를 만든다')
  assert.equal(await as(DG.lead, [folder('biz_vana')]), 'denied', '0048: 경영지원 팀장이 VANA 폴더를 만든다')
  assert.equal(await as(DG.lead, [vanaAccess, folder('biz_vana')]), 'denied', '0048: VANA 접근만으로 VANA 폴더가 선다')
  assert.equal(await as(DG.lead, [`insert into doc_folders (business_id, name, created_by) values ('biz_dy', 'x', '${DG.sales}')`]), 'denied',
    '0048: 남의 이름(created_by)으로 폴더가 선다')
  assert.equal(await as(DG.lead, [folder('biz_dy'), `update doc_folders set name = '0048 고침' where name = '0048 폴더'`]), 1, '0048: 경영지원 팀장이 DY 폴더를 못 고친다')
  assert.equal(await as(DG.lead, [folder('biz_dy'), `delete from doc_folders where name = '0048 폴더'`]), 1, '0048: 경영지원 팀장이 DY 폴더를 못 지운다')
  assert.equal(await as(DG.lead, [folder('biz_dy'), `@${DG.sales}`, `delete from doc_folders where name = '0048 폴더'`]), 0, '0048: 줄 없는 팀장이 DY 폴더를 지운다')
  // 리뷰 M4: 폴더 고치기 · 지우기는 만든 사람 또는 회장.
  const colleagueFolder = (step: string) => as(DG.lead, [salesRow, folder('biz_dy'), `@${DG.sales}`, step])
  assert.equal(await colleagueFolder(`update doc_folders set name = 'x' where name = '0048 폴더'`), 0, '0048: 동료가 남의 폴더 이름을 바꾼다')
  assert.equal(await colleagueFolder(`delete from doc_folders where name = '0048 폴더'`), 0, '0048: 동료가 남의 폴더를 지운다')
  assert.equal(await as(DG.lead, [folder('biz_dy'), `@${DG.chair}`, `update doc_folders set name = '회장 고침' where name = '0048 폴더'`]), 1, '0048: 회장이 남의 폴더를 못 고친다')
  assert.equal(await as(DG.lead, [folder('biz_dy'), `@${DG.chair}`, `delete from doc_folders where name = '0048 폴더'`]), 1, '0048: 회장이 남의 폴더를 못 지운다')
  assert.equal(await as(DG.agent, [folder('biz_dy')]), 'denied', '0048: 문서 줄 있는 AIAgent가 폴더를 만든다')
  assert.equal(await as(DG.legacy, [folder('biz_dy')]), 1, '0048: 옛 /core/search 줄로 폴더가 안 선다(회귀)')

  // ── 거두기: 회수하면 문서 줄도 지워지고 감사가 그 회사로 ──
  assert.equal(await as(DG.chair, [`update user_profiles set revoked_at = now() where user_id = '${DG.lead}'`,
    `select (select count(*)::int from user_module_access where user_id = '${DG.lead}')
          + (select count(*)::int from audit_log where entity_table = 'user_module_access' and entity_id = '${DG.lead}'
               and business_id = 'biz_dy' and note like '계정 회수%') * 10`]), 10,
  '0048: 회수했는데 문서 줄이 남거나 감사가 DY로 안 걸린다')
  assert.equal(await as(DG.lead, [`!update user_profiles set revoked_at = now() where user_id = '${DG.lead}'`, doc('biz_dy')]), 'denied',
    '0048: 회수된 사람이 문서를 넣는다')

  // ── 카탈로그: force 새로 없음 · 판정 함수는 anon에게서 걷지 않았다(0047 머리 주석) ──
  assert.deepEqual(await owner(`select relname, relforcerowsecurity as f from pg_class where relname in ('doc_folders', 'user_module_access') order by 1`),
    [{ relname: 'doc_folders', f: false }, { relname: 'user_module_access', f: false }], '0048: force가 새로 걸렸다(0035 함정)')
  for (const fn of ['can_write_documents(text)', 'document_grant(text, boolean)']) {
    assert.deepEqual(await owner(`select has_function_privilege('authenticated', '${fn}', 'execute') as ok`), [{ ok: true }], `0048: ${fn}을 authenticated가 못 부른다`)
  }
  assert.deepEqual(await owner(`select has_function_privilege('authenticated', 'module_grant_audit(uuid, text, jsonb, jsonb, text)', 'execute') as ok`),
    [{ ok: false }], '0048: module_grant_audit을 authenticated가 부를 수 있다')
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

/**
 * 0049 직원 화면 용어 — DB가 적는 «회장»을 «대표»로.
 *
 * **적용 순간의 DB 상태가 입력이다**(0026 백필과 같다). 0048까지 올린 DB에 옛 문구(«회장»)로 결재선 · 취합을 심고,
 * 0049를 올린 뒤에 잰다: 문구는 «대표»가 되고 · 사람 · 단계 · 순서 · updated_at은 그대로 · 얼림 트리거는 다시 켜져 있고 ·
 * 그 뒤의 새 결재선과 감사 메모는 처음부터 «대표»다.
 */
async function staffTerms() {
  const T = { chair: '00000000-0000-0000-0000-0000000d4901', lead: '00000000-0000-0000-0000-0000000d4902', req: '00000000-0000-0000-0000-0000000d4903' }
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db, '0048_document_module_grants.sql')
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    insert into auth.users values ('${T.chair}', 't1@x'), ('${T.lead}', 't2@x'), ('${T.req}', 't3@x');
    insert into teams (team_id, business_id, name, name_en, lead_user_id) values ('team_49', 'biz_dy', '생산', 'Prod', '${T.lead}');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${T.chair}', 'Chairman', 'ch', 'Vault', null),
      ('${T.lead}', 'TeamLead', '생산팀장', 'Normal', 'team_49'),
      ('${T.req}', 'Member', '생산직원', 'Normal', 'team_49');
    update user_profiles set reports_to = '${T.chair}' where user_id in ('${T.lead}', '${T.req}');
    insert into user_business_access values ('${T.lead}', 'biz_dy'), ('${T.req}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write) values ('${T.req}', '/chairman/decisions', true);
  `)
  const commitAs = async (uid: string, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const r = await db.query<{ v: string }>(sql)
      await db.exec('commit')
      return r.rows[0]?.v ?? null
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  const request = (id: string, amount: string) =>
    `insert into decisions (decision_id, business_id, title, template_key, form, attachment_url, created_by)
       values ('${id}', 'biz_dy', '요청 ${id}', 'expense', '{"amount":"${amount}","purpose":"설비","spent_on":"2026-10-01"}'::jsonb, 'https://x/a', '${T.req}') returning decision_id as v`
  // 0048까지의 함수로 옛 문구를 심는다 — 큰 금액 둘(회장 칸 있음) + 작은 금액 하나(회장 칸 없음).
  await commitAs(T.req, request('dec_49a', '6000000'))
  await commitAs(T.req, request('dec_49b', '7000000'))
  await commitAs(T.req, request('dec_49c', '100000'))
  await commitAs(T.lead, `select lead_decide('dec_49a', true) as v`)
  await commitAs(T.lead, `select lead_decide('dec_49b', true) as v`)
  const bundle = await commitAs(T.lead, `select lead_bundle(array['dec_49a', 'dec_49b'], '회장 기안 — 설비 둘') as v`)
  const snap = async () => (await db.query<{ id: string; line: string; title: string; upd: string }>(
    `select decision_id as id, approval_line::text as line, title, updated_at::text as upd from decisions where decision_id like 'dec_49%' or decision_id = '${bundle}' order by decision_id`,
  )).rows
  const before = await snap()
  assert.ok(before.find((r) => r.id === 'dec_49a')?.line.includes('회장'), '전제가 깨졌다 — 0048의 결재선에 «회장»이 없다')

  await applyOne(db, '0049_staff_terms.sql')
  const after = await snap()
  for (const r of after) {
    assert.ok(!r.line?.includes('회장'), `0049: ${r.id}의 결재선에 «회장»이 남았다 — ${r.line}`)
    assert.ok(!r.title.includes('회장'), `0049: ${r.id}의 제목에 «회장»이 남았다 — ${r.title}`)
    const b = before.find((x) => x.id === r.id)!
    assert.equal(r.upd, b.upd, `0049: ${r.id}의 updated_at이 바뀌었다 — 문구 교체가 «최근 갱신»으로 보인다`)
    // 문구 말고는 한 글자도 바뀌지 않는다: «회장»을 «대표»로 바꾼 옛 줄이 새 줄과 같아야 한다.
    assert.equal(r.line, b.line?.replaceAll('회장', '대표') ?? null, `0049: ${r.id}의 결재선이 문구 말고도 바뀌었다`)
  }
  const a = JSON.parse(after.find((r) => r.id === 'dec_49a')!.line) as { step: string; name: string; why: string; user_id: string | null }[]
  assert.deepEqual(a.map((s) => s.step), ['lead', 'rule', 'chairman'], '0049: 결재선의 단계가 바뀌었다')
  assert.equal(a[2].name, '대표', '0049: 마지막 칸 이름이 «대표»가 아니다')
  assert.equal(a[2].user_id, T.chair, '0049: 마지막 칸의 사람이 바뀌었다')
  assert.equal(after.find((r) => r.id === bundle)?.title, '대표 기안 — 설비 둘', '0049: 취합 묶음 제목이 «대표 기안»이 아니다')
  assert.equal(after.find((r) => r.id === 'dec_49c')?.title, '요청 dec_49c', '0049: 묶음이 아닌 결재의 제목을 건드렸다')

  // 얼림은 다시 켜져 있다.
  await assert.rejects(
    db.exec(`update decisions set approval_line = '[]'::jsonb where decision_id = 'dec_49a'`),
    /approval_line_frozen/, '0049: 백필 뒤 결재선 얼림 트리거가 꺼진 채다',
  )
  await db.exec(`update decisions set title = title || ' ' where decision_id = 'dec_49c'`)
  const touched = await db.query<{ upd: string }>(`select updated_at::text as upd from decisions where decision_id = 'dec_49c'`)
  assert.notEqual(touched.rows[0].upd, before.find((r) => r.id === 'dec_49c')!.upd, '0049: 백필 뒤 updated_at 트리거가 꺼진 채다')
  // 새 결재선 · 감사 메모는 처음부터 «대표»다.
  await commitAs(T.req, request('dec_49d', '6000000'))
  await commitAs(T.lead, `select lead_decide('dec_49d', true, true) as v`)
  const fresh = await db.query<{ line: string }>(`select approval_line::text as line from decisions where decision_id = 'dec_49d'`)
  assert.ok(fresh.rows[0].line.includes('규칙이 대표까지 올린다') && !fresh.rows[0].line.includes('회장'), '0049: 새 결재선에 «회장»이 적힌다')
  const notes = await db.query<{ note: string }>(`select note from audit_log where entity_table = 'decisions' and entity_id = 'dec_49d' and note like '팀장 승인%'`)
  assert.equal(notes.rows[0]?.note, '팀장 승인 · 대표 확인 요청', '0049: 팀장 단계 감사 메모에 «회장»이 적힌다')
  await db.close()
}

/**
 * 0054 첫 직원 결재 — 대표는 팀장 칸에 서지 않는다 · 비승인권자 insert는 늘 Open · 대표는 «기록 완료»를 읽는다 ·
 * 새 직원(가입 · 재초대)에게 «결재 올리기» 한 줄. dummy 거울(lib/approval-line.ts pickApprovalLead · approvalLine)이
 * DB와 같은 답을 내는지도 같이 잰다.
 */
const AS = {
  chair: '00000000-0000-0000-0000-0000000054a1',
  ceo: '00000000-0000-0000-0000-0000000054a2', // DY BusinessCEO — 승인권자
  lead: '00000000-0000-0000-0000-0000000054a3', // DY TeamLead — 팀장이 대표인 팀의 직원이 reports_to로 고른다
  req: '00000000-0000-0000-0000-0000000054a4', // 김병훈 자리 — Member · 경영지원 · 상사 = 대표 · 팀장 공석
  orphan: '00000000-0000-0000-0000-0000000054a5', // 상사 없음(조직도에 안 매달림)
  sub: '00000000-0000-0000-0000-0000000054a6', // 팀장 = 대표, 상사 = lead
  agent: '00000000-0000-0000-0000-0000000054a7',
  hire: '00000000-0000-0000-0000-0000000054a8', // 초대로 가입하는 새 직원
  cfo: '00000000-0000-0000-0000-0000000054a9', // GroupCFO — 3절이 넓히지 않는지 본다
  vendor: '00000000-0000-0000-0000-0000000054aa', // 초대로 가입하는 거래처(Vendor) — «결재 올리기» 없음(리뷰 I1)
  expert: '00000000-0000-0000-0000-0000000054ab', // ExternalExpert — 직접 넣은 프로필도 없음
  sub2: '00000000-0000-0000-0000-0000000054ac', // 팀장 = 대표, 상사 없음
  sub3: '00000000-0000-0000-0000-0000000054ad', // 팀장 = 대표, 상사 = 대표
}

async function approvalStaff() {
  const db = new PGlite({ extensions: { pg_trgm } })
  // 0054의 규칙(팀장 한 칸 · «기록 완료»)은 0059가 단계 결재로 바꿨다 — 이 검사는 0055까지의 DB에서 그때의 약속을 잰다.
  // 0059 뒤의 같은 약속(비승인권자 insert Open · 처리자 위조 금지 · 금액 모양)은 approvalChain()이 다시 잰다.
  await applyAll(db, '0055_staff_admin.sql')
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    insert into auth.users values ('${AS.chair}', 'a1@x'), ('${AS.ceo}', 'a2@x'), ('${AS.lead}', 'a3@x'), ('${AS.req}', 'a4@x'),
      ('${AS.orphan}', 'a5@x'), ('${AS.sub}', 'a6@x'), ('${AS.agent}', 'a7@x'), ('${AS.cfo}', 'a9@x'),
      ('${AS.expert}', 'ab@x'), ('${AS.sub2}', 'ac@x'), ('${AS.sub3}', 'ad@x');
    insert into teams (team_id, business_id, name, name_en, lead_user_id) values ('team_54', 'biz_dy', '대표 직할', 'Direct', null);
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${AS.chair}', 'Chairman', 'ch', 'Vault', null),
      ('${AS.ceo}', 'BusinessCEO', 'DY 대표이사', 'Restricted', null),
      ('${AS.lead}', 'TeamLead', '팀장', 'Normal', null),
      ('${AS.req}', 'Member', '김병훈', 'Normal', 'team_dy_support'),
      ('${AS.orphan}', 'Member', '떠돌이', 'Normal', null),
      ('${AS.sub}', 'Member', '직할 직원', 'Normal', 'team_54'),
      ('${AS.agent}', 'AIAgent', 'ai', 'Restricted', null),
      ('${AS.cfo}', 'GroupCFO', 'cfo', 'Restricted', null),
      ('${AS.expert}', 'ExternalExpert', '자문', 'Normal', null),
      ('${AS.sub2}', 'Member', '직할 직원 2', 'Normal', 'team_54'),
      ('${AS.sub3}', 'Member', '직할 직원 3', 'Normal', 'team_54');
    update teams set lead_user_id = '${AS.chair}' where team_id = 'team_54';
    update teams set lead_user_id = null where team_id = 'team_dy_support';
    update user_profiles set reports_to = '${AS.chair}' where user_id in ('${AS.ceo}', '${AS.lead}', '${AS.req}', '${AS.cfo}', '${AS.sub3}');
    update user_profiles set reports_to = '${AS.lead}' where user_id = '${AS.sub}';
    insert into user_business_access values ('${AS.ceo}', 'biz_dy'), ('${AS.lead}', 'biz_dy'), ('${AS.req}', 'biz_dy'),
      ('${AS.orphan}', 'biz_dy'), ('${AS.sub}', 'biz_dy'), ('${AS.sub2}', 'biz_dy'), ('${AS.sub3}', 'biz_dy');
  `)
  const owner = async <T,>(sql: string) => (await db.query<T>(sql)).rows
  const as = async <T,>(uid: string, sql: string, setup = '') => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      if (setup) await db.exec(setup)
      return (await db.query<T>(sql)).rows
    } finally {
      await db.exec('rollback')
    }
  }
  const commitAs = async (uid: string, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      await db.exec(sql)
      await db.exec('commit')
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }

  // ── 4절: 새 프로필에 «결재 올리기» — 허용 목록(GroupCFO · BusinessCEO · Executive · TeamLead · Member)만 ──
  const drafts = await owner<{ u: string }>(`select user_id::text as u from user_module_access
     where module = '/chairman/decisions' and can_write and not can_approve order by 1`)
  assert.deepEqual(drafts.map((r) => r.u), [AS.ceo, AS.lead, AS.req, AS.orphan, AS.sub, AS.cfo, AS.sub2, AS.sub3].sort(),
    '0054: «결재 올리기»가 허용 목록 사람에게만 붙지 않았다(회장 · AIAgent · ExternalExpert는 없어야)')
  const draftOf = async (uid: string) =>
    (await owner(`select 1 from user_module_access where user_id = '${uid}' and module = '/chairman/decisions'`)).length
  // 초대 한 장을 넣고(세션 없이 — 0026 set_approval이 위임 초대처럼 승인 칸을 비운다, 또는 회장 세션으로) 그 초대를 이행한다.
  const invite = async (email: string, role: string, byChair: boolean) => {
    const sql = `insert into user_invitations (email, role, display_name, invited_by, reports_to, max_security_class, business_ids)
      values ('${email}', '${role}', '${email}', '${byChair ? AS.chair : AS.lead}', '${byChair ? AS.chair : AS.lead}', 'Normal', '{biz_dy}')`
    if (byChair) await commitAs(AS.chair, sql)
    else await owner(sql)
    return (await owner<{ id: string }>(`select invitation_id::text as id from user_invitations where email = '${email}' and accepted_at is null`))[0].id
  }

  // M1 — 회장이 끈 줄(토글 = 삭제)은 ① 프로필 수정 ② 활동 중인 사람의 재초대(apply_user_invitation · on conflict update)
  // ③ 위임 재초대로 되살림(회수 → revoked_at null, 회장 관여 없음)으로 되살아나지 않는다(리뷰 I4).
  await owner(`delete from user_module_access where user_id = '${AS.orphan}' and module = '/chairman/decisions'`)
  await owner(`update user_profiles set display_name = '떠돌이2', role = 'TeamLead' where user_id = '${AS.orphan}'`)
  await owner(`update user_profiles set role = 'Member' where user_id = '${AS.orphan}'`)
  assert.equal(await draftOf(AS.orphan), 0, '0054: 회장이 끈 «결재 올리기»가 프로필 수정으로 되살아난다')
  await owner(`select apply_user_invitation('${await invite('a5@x', 'Member', true)}', '${AS.orphan}')`)
  assert.equal(await draftOf(AS.orphan), 0, '0054: 활동 중인 사람의 재초대가 회장이 끈 «결재 올리기»를 되살린다')
  await owner(`update user_profiles set revoked_at = now(), status = 'left' where user_id = '${AS.orphan}'`)
  await owner(`select apply_user_invitation('${await invite('a5@x', 'Member', false)}', '${AS.orphan}')`)
  assert.equal((await owner(`select 1 from user_profiles where user_id = '${AS.orphan}' and revoked_at is null`)).length, 1,
    '0054 전제: 위임 재초대가 사람을 되살리지 않았다')
  assert.equal(await draftOf(AS.orphan), 0, '0054: 위임 재초대(회장 관여 없음)의 되살림이 «결재 올리기»를 다시 붙인다')
  // 회장 세션의 되살림 · 회장이 넣은 초대로의 되살림은 다시 붙인다.
  await owner(`update user_profiles set revoked_at = now(), status = 'left' where user_id = '${AS.orphan}'`)
  await commitAs(AS.chair, `update user_profiles set revoked_at = null, status = 'active' where user_id = '${AS.orphan}'`)
  assert.equal(await draftOf(AS.orphan), 1, '0054: 회장이 되살린 직원에게 «결재 올리기»가 다시 안 붙는다')

  // 초대 → 가입(auth.users insert → 0011 → apply_user_invitation → user_profiles insert) 경로에서도 붙는다.
  await invite('hire@x', 'Member', true)
  await owner(`insert into auth.users values ('${AS.hire}', 'hire@x')`)
  assert.deepEqual(await owner(`select module, can_write, can_approve from user_module_access where user_id = '${AS.hire}'`),
    [{ module: '/chairman/decisions', can_write: true, can_approve: false }], '0054: 초대로 가입한 직원에게 «결재 올리기»가 안 붙는다')
  // I1 — Vendor 초대(위임 · 회장 결재 없음)로 가입한 사람에게는 없다.
  await invite('vendor@x', 'Vendor', false)
  await owner(`insert into auth.users values ('${AS.vendor}', 'vendor@x')`)
  assert.equal((await owner(`select 1 from user_profiles where user_id = '${AS.vendor}' and role::text = 'Vendor'`)).length, 1,
    '0054 전제: Vendor 초대가 프로필을 만들지 않았다')
  assert.equal(await draftOf(AS.vendor), 0, '0054: Vendor에게 «결재 올리기»가 붙는다(리뷰 I1)')
  // 회수(0047이 줄 전부 삭제) → 회장이 넣은 초대로 되살림(세션 없는 이행)이면 다시 붙는다.
  // **PGlite 전용**(재리뷰 N4): 이 harness는 superuser라 초대 조회가 된다. production · staging에서는 user_invitations가
  // force RLS이고 함수 소유자가 bypassrls가 아니라 이 길은 0행 → 안 붙는다(닫힌 쪽). 실제 재부여 길은 위의 회장 세션이다.
  await owner(`update user_profiles set revoked_at = now(), status = 'left' where user_id = '${AS.hire}'`)
  assert.equal(await draftOf(AS.hire), 0, '0054 전제: 회수가 모듈 줄을 지우지 않았다(0047)')
  await owner(`select apply_user_invitation('${await invite('hire@x', 'Member', true)}', '${AS.hire}')`)
  assert.equal(await draftOf(AS.hire), 1, '0054(PGlite 전용 — production에서는 회장 세션만): 회장이 넣은 재초대로 되살아난 직원에게 «결재 올리기»가 다시 안 붙는다')
  // 붙인 줄로 실제로 결재가 올라간다(회사 범위 = has_business).
  const leave = (biz: string) => `insert into decisions (decision_id, business_id, title, template_key, form, created_by)
     values ('dec_54h', '${biz}', '휴가', 'leave', '{"starts_on":"2026-10-07","ends_on":"2026-10-08"}', '${AS.hire}');`
  assert.equal((await as(AS.hire, `select 1 from decisions where decision_id = 'dec_54h'`, leave('biz_dy'))).length, 1,
    '0054: 자동으로 붙은 «결재 올리기»로 결재가 안 올라간다')
  await assert.rejects(as(AS.hire, 'select 1', leave('biz_vana')), /row-level security/,
    '0054: «결재 올리기»가 회사 범위 밖(VANA) 결재까지 연다')

  // ── 1절: 대표는 팀장 칸에 서지 않는다 · dummy 거울과 같은 답 ──
  const people = await owner<{ user_id: string; display_name: string; role: Role; team_id: string | null; reports_to: string | null; revoked_at: string | null; status: string }>(
    `select user_id::text, display_name, role::text as role, team_id, reports_to::text, revoked_at::text, status from user_profiles`)
  const teams = await owner<{ team_id: string; lead_user_id: string | null }>(`select team_id, lead_user_id::text from teams`)
  const cases: [string, { user_id: string; via: string } | null][] = [
    [AS.req, null], [AS.orphan, null], [AS.sub, { user_id: AS.lead, via: 'reports_to' }], [AS.lead, null],
    [AS.sub2, null], [AS.sub3, null], // M3 — 팀장 = 대표 · 상사 없음 / 상사 = 대표
  ]
  for (const [who, want] of cases) {
    const got = await as<{ user_id: string; via: string }>(who, `select user_id::text, via from my_approval_lead()`)
    assert.deepEqual(got.map((r) => ({ user_id: r.user_id, via: r.via })), want ? [want] : [],
      `0054: my_approval_lead()가 대표를 팀장 칸에 세우거나 다른 사람을 고른다(${who})`)
    const mirror = pickApprovalLead(who, people, teams)
    assert.deepEqual(mirror ? { user_id: mirror.user_id, via: mirror.via } : null, want,
      `0054: dummy 거울(pickApprovalLead)이 DB와 다른 팀장을 고른다(${who})`)
  }

  // ── 400만 / 600만 — 팀장 건너뜀, 기준 미만은 «기록 완료», 이상은 대표 칸 Open ──
  const expense = (id: string, by: string, amount: string, extra = '') =>
    `insert into decisions (decision_id, business_id, title, template_key, form, attachment_url, created_by${extra ? ', status, decided_at, decided_by, decided_by_kind' : ''})
       values ('${id}', 'biz_dy', '지출 ${id}', 'expense', '{"amount":"${amount}","purpose":"장비","spent_on":"2026-10-06"}'::jsonb, 'https://x/a', '${by}'${extra});`
  await commitAs(AS.req, expense('dec_54a', AS.req, '4,000,000'))
  await commitAs(AS.req, expense('dec_54b', AS.req, '6000000'))
  await commitAs(AS.orphan, expense('dec_54c', AS.orphan, '4000000'))
  type Step = { step: string; user_id: string | null; name: string; why: string }
  type Row = { status: string; kind: string | null; lead: string; req: boolean; line: Step[] }
  const read = `select status::text as status, decided_by_kind as kind, lead_status as lead, chairman_required as req, approval_line as line from decisions where decision_id = `
  const [a] = await owner<Row>(`${read}'dec_54a'`)
  assert.deepEqual([a.status, a.kind, a.lead, a.req], ['Approved', 'rule', 'skipped', false], '0054: 상사가 대표인 직원의 400만 지출이 «기록 완료»가 아니다')
  assert.deepEqual(a.line[0], { step: 'lead', user_id: null, name: '—', why: '팀장 결재 단계 없음' }, '0054: 대표가 팀장 칸에 섰다(또는 빈 칸 문장이 다르다)')
  assert.ok(!JSON.stringify(a.line).includes('회장'), '0054: 결재선에 «회장»이 적혔다')
  const [b] = await owner<Row>(`${read}'dec_54b'`)
  assert.deepEqual([b.status, b.kind, b.lead, b.req], ['Open', null, 'skipped', true], '0054: 600만 지출이 대표 칸 Open(«대기»)이 아니다')
  assert.deepEqual(b.line.map((s) => s.step), ['lead', 'rule', 'chairman'], '0054: 600만 지출의 결재선 단계가 다르다')
  assert.equal(b.line[2].user_id, AS.chair, '0054: 대표 칸의 사람이 대표가 아니다')
  // 미리보기(lib/approval-line.ts)가 트리거와 같은 결재선 — 빈 팀장 칸 문장까지.
  const [tpl] = await owner<ApprovalTemplate>(`select * from approval_templates where template_key = 'expense'`)
  const tplN = { ...tpl, chairman_over: tpl.chairman_over === null ? null : Number(tpl.chairman_over) }
  const previews: [Row, string][] = [[a, '4,000,000'], [b, '6000000']]
  for (const [row, amount] of previews) {
    assert.deepEqual(approvalLine(tplN, { amount, purpose: '장비', spent_on: '2026-10-06' }, null).map((s) => [s.step, s.why]),
      row.line.map((s) => [s.step, s.why]), `0054: 빈 팀장 칸 미리보기와 트리거가 갈라졌다(${amount})`)
  }
  // 대표가 읽는다 — subtree(상사 = 대표)로도, 조직도 밖 사람의 규칙 종결(3절)도.
  const chairSees = await as<{ id: string }>(AS.chair, `select decision_id as id from decisions where decision_id in ('dec_54a', 'dec_54b', 'dec_54c') order by 1`)
  assert.deepEqual(chairSees.map((r) => r.id), ['dec_54a', 'dec_54b', 'dec_54c'], '0054: 대표가 팀장 단계를 건너뛴 결재(«기록 완료» 포함)를 못 본다')
  // 3절이 넓히지 않는다: 같은 회사 동료는 여전히 남의 결재를 못 본다(0026 subtree).
  assert.deepEqual(await as(AS.sub, `select 1 from decisions where decision_id in ('dec_54a', 'dec_54b', 'dec_54c')`), [], '0054: 동료가 남의 결재를 본다')
  // M2 — 3절은 회장만이다. 조직도 밖 사람의 규칙 종결(dec_54c)을 BusinessCEO · GroupCFO는 못 본다.
  assert.deepEqual(await as(AS.ceo, `select 1 from decisions where decision_id = 'dec_54c'`), [], '0054: BusinessCEO가 3절로 남의 규칙 종결을 본다')
  assert.deepEqual(await as(AS.cfo, `select 1 from decisions where decision_id = 'dec_54c'`), [], '0054: GroupCFO가 3절로 남의 규칙 종결을 본다')

  // ── C1: 금액 모양 — 대표 기준이 있는 양식은 숫자 모양만(닫힌 쪽 실패) · 미리보기 판정도 같다 ──
  for (const bad of ['600만', '10억', '1.000.000', '', '6,00,000', '약 600만원']) {
    await assert.rejects(as(AS.req, 'select 1', expense('dec_54z', AS.req, bad)), bad ? /approval_amount_invalid/ : /approval_form_missing:amount/,
      `0054: 금액 «${bad}»이 거부되지 않고 들어간다(기준 미만 «기록 완료»로 닫힌다)`)
    assert.ok(amountInvalid(tplN, { amount: bad }), `0054: 미리보기가 금액 «${bad}»을 받는다(트리거는 거부)`)
  }
  for (const [good, toChair] of [['6,000,000원', true], [' 6000000 ', true], ['4,000,000.5', false], ['4000000원', false]] as const) {
    const [g] = await as<Row>(AS.req, `${read}'dec_54z'`, expense('dec_54z', AS.req, good))
    assert.deepEqual([g.status, g.req, g.line.at(-1)?.step], toChair ? ['Open', true, 'chairman'] : ['Approved', false, 'rule'],
      `0054: 금액 «${good}»의 결재선이 다르다`)
    assert.ok(!amountInvalid(tplN, { amount: good }), `0054: 미리보기가 금액 «${good}»을 거부한다`)
    assert.equal(toChairman(tplN, { amount: good }), toChair, `0054: 미리보기의 대표 판정이 금액 «${good}»에서 트리거와 다르다`)
  }
  // 대표 기준이 없는 양식(휴가 · 계약 늘 대표)은 금액 모양을 보지 않는다.
  assert.equal((await as(AS.req, `select 1 from decisions where decision_id = 'dec_54y'`,
    `insert into decisions (decision_id, business_id, title, template_key, form, attachment_url, created_by)
       values ('dec_54y', 'biz_dy', '계약', 'contract', '{"counterparty":"A사","amount":"1억","term":"1년","summary":"x"}', 'https://x/c', '${AS.req}');`)).length, 1,
    '0054: 대표 기준이 없는 계약 양식이 금액 모양으로 막혔다')

  // ── 2절: 비승인권자의 insert는 늘 Open · decided_* null(양식 없음도) ──
  const forged = (id: string, by: string) =>
    `insert into decisions (decision_id, business_id, title, created_by, status, decided_at, decided_by, decided_by_kind)
       values ('${id}', 'biz_dy', '몰래 승인', '${by}', 'Approved', now(), '${AS.chair}', 'chairman');`
  type Closed = { status: string; at: string | null; by: string | null; kind: string | null }
  const closedOf = (id: string) => `select status::text as status, decided_at::text as at, decided_by::text as by, decided_by_kind as kind from decisions where decision_id = '${id}'`
  assert.deepEqual(await as<Closed>(AS.req, closedOf('dec_54f'), forged('dec_54f', AS.req)),
    [{ status: 'Open', at: null, by: null, kind: null }], '0054: 직원이 양식 없는 결재를 «승인»으로 넣는다')
  assert.deepEqual((await as<Closed>(AS.req, closedOf('dec_54g'), expense('dec_54g', AS.req, '100', `, 'Rejected', now(), '${AS.chair}', 'chairman'`))).map((x) => [x.status, x.by, x.kind]),
    [['Approved', null, 'rule']], '0054: 양식 결재의 규칙 종결이 화면이 보낸 status · decided_*에 밀렸다')
  // 승인권자(CEO · 대표)와 세션 없는 insert(시드 · 이관)는 예전 그대로다.
  // I2 — 승인권자의 닫힌 insert는 «그 세션이 정했다»로 덮인다. CEO가 대표 이름 · 'chairman'으로 꾸미지 못한다.
  assert.deepEqual((await as<Closed>(AS.ceo, closedOf('dec_54k'), forged('dec_54k', AS.ceo))).map((r) => [r.status, r.by, r.kind, r.at !== null]),
    [['Approved', AS.ceo, 'ceo', true]], '0054: CEO가 넣은 닫힌 결정이 대표 결정으로 꾸며진다(또는 Open으로 바뀌었다)')
  assert.deepEqual((await as<Closed>(AS.chair, closedOf('dec_54m'), forged('dec_54m', AS.chair))).map((r) => [r.status, r.by, r.kind]),
    [['Approved', AS.chair, 'chairman']], '0054: 대표가 넣는 결정이 Open으로 바뀌었거나 처리자가 다르다(회귀)')
  // N3 — 승인권자가 Open으로 넣으면서 decided_*를 꾸며 보내도 비운다.
  assert.deepEqual(await as<Closed>(AS.ceo, closedOf('dec_54n'),
    `insert into decisions (decision_id, business_id, title, created_by, status, decided_at, decided_by, decided_by_kind)
       values ('dec_54n', 'biz_dy', 'Open인데 처리자', '${AS.ceo}', 'Open', now(), '${AS.chair}', 'chairman');`),
    [{ status: 'Open', at: null, by: null, kind: null }], '0054: 승인권자의 Open insert에 꾸민 decided_*가 남는다(재리뷰 N3)')
  // N1 — CEO가 Open 결정을 닫으며(0002 decisions_decide) 대표 이름 · 'chairman'을 보내도 처리자는 CEO다.
  await owner(`insert into decisions (decision_id, business_id, title, created_by) values ('dec_54u', 'biz_dy', '양식 없는 결정', '${AS.ceo}')`)
  assert.deepEqual(await as<Closed>(AS.ceo, closedOf('dec_54u'),
    `update decisions set status = 'Approved', decided_at = timestamptz '2020-01-01', decided_by = '${AS.chair}', decided_by_kind = 'chairman' where decision_id = 'dec_54u';`)
    .then((r) => r.map((x) => [x.status, x.by, x.kind, x.at !== null && !x.at.startsWith('2020')])),
    [['Approved', AS.ceo, 'ceo', true]], '0054: CEO가 update로 대표 결정을 꾸민다(재리뷰 N1)')
  assert.deepEqual(await as<Closed>(AS.chair, closedOf('dec_54u'),
    `update decisions set status = 'Rejected', decided_by = '${AS.ceo}', decided_by_kind = 'ceo' where decision_id = 'dec_54u';`)
    .then((r) => r.map((x) => [x.status, x.by, x.kind])),
    [['Rejected', AS.chair, 'chairman']], '0054: 대표가 닫은 결정의 처리자가 대표가 아니다(재리뷰 N1)')
  // 세션 없는 update(마이그레이션 · 이관)는 예전 그대로.
  await owner(`update decisions set status = 'Approved', decided_by = '${AS.chair}', decided_by_kind = 'chairman' where decision_id = 'dec_54u'`)
  assert.deepEqual((await owner<Closed>(closedOf('dec_54u'))).map((x) => [x.by, x.kind]), [[AS.chair, 'chairman']],
    '0054: 세션 없는 update의 처리자가 바뀌었다(회귀)')
  await owner(forged('dec_54s', AS.req))
  assert.deepEqual((await owner<Closed>(closedOf('dec_54s'))).map((r) => r.status), ['Approved'], '0054: 세션 없는 insert(시드 · 이관)가 Open으로 바뀌었다(회귀)')

  // ── 카탈로그: force 새로 없음 · 트리거 함수는 아무도 못 부른다 ──
  assert.deepEqual(await owner(`select relname, relforcerowsecurity as f from pg_class where relname in ('decisions', 'user_module_access', 'user_profiles') order by 1`),
    [{ relname: 'decisions', f: false }, { relname: 'user_module_access', f: false }, { relname: 'user_profiles', f: false }], '0054: force가 새로 걸렸다(0035 함정)')
  assert.deepEqual(await owner(`select has_function_privilege('authenticated', 'user_profiles_draft_grant()', 'execute') as a,
      has_function_privilege('anon', 'user_profiles_draft_grant()', 'execute') as b`), [{ a: false, b: false }], '0054: 트리거 함수가 RPC로 열렸다')
  await db.close()
}

const SA = {
  chair: '00000000-0000-0000-0000-0000000055a1',
  admin: '00000000-0000-0000-0000-0000000055a2', // 김병훈 자리 — Member · DY 경영지원 · 상사 = 대표 · «DY 사용자 관리자»
  peer: '00000000-0000-0000-0000-0000000055a3', // DY Member · 상사 = 대표 — 능력 없음 · 남의 결재 주인
  lead: '00000000-0000-0000-0000-0000000055a4', // DY 영업 팀장 · 상사 = 대표
  under: '00000000-0000-0000-0000-0000000055a5', // 관리자 아래 사람(상사 = admin) — 상사로 고르면 거부
  vana: '00000000-0000-0000-0000-0000000055a6', // VANA 직원
  agent: '00000000-0000-0000-0000-0000000055a7',
  hire: '00000000-0000-0000-0000-0000000055a8', // 관리자가 초대해 가입하는 새 직원
  late: '00000000-0000-0000-0000-0000000055a9', // 능력 회수 전에 초대된 사람
  cut: '00000000-0000-0000-0000-0000000055aa', // 초대 뒤 관리자가 재무 권한을 잃은 경우
}

/**
 * 0055 온보딩 위임 — «DY 사용자 관리자»(회장 결정 B). 0050~0052(ECOUNT)에 기대지 않는다(이 브랜치에 없다).
 * 끝에서 같은 DB의 표 · 함수 소유자를 BYPASSRLS 없는 역할로 넘겨 force RLS(user_invitations · audit_log · teams) 아래에서도
 * RPC가 도는지 잰다 — staging의 postgres는 bypassrls지만 production이 같다고 기대지 않는다(0047과 같은 가정).
 */
async function staffAdmin() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    insert into auth.users values ('${SA.chair}', 'c@x.co'), ('${SA.admin}', 'admin@x.co'), ('${SA.peer}', 'peer@x.co'), ('${SA.lead}', 'lead@x.co'),
      ('${SA.under}', 'under@x.co'), ('${SA.vana}', 'vana@x.co'), ('${SA.agent}', 'agent@x.co');
    insert into teams (team_id, business_id, name, name_en) values ('team_vana_55', 'biz_vana', 'VANA 팀', 'VANA');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${SA.chair}', 'Chairman', '홍대표', 'Vault', null),
      ('${SA.admin}', 'Member', '김병훈', 'Normal', 'team_dy_support'),
      ('${SA.peer}', 'Member', '동료', 'Normal', 'team_dy_support'),
      ('${SA.lead}', 'TeamLead', '영업팀장', 'Normal', 'team_dy_sales'),
      ('${SA.under}', 'Member', '관리자 아래', 'Normal', 'team_dy_support'),
      ('${SA.vana}', 'Member', 'VANA 직원', 'Normal', 'team_vana_55'),
      ('${SA.agent}', 'AIAgent', 'ai', 'Restricted', null);
    update user_profiles set reports_to = '${SA.chair}' where user_id in ('${SA.admin}', '${SA.peer}', '${SA.lead}', '${SA.vana}');
    update user_profiles set reports_to = '${SA.admin}' where user_id = '${SA.under}';
    update teams set lead_user_id = null where team_id = 'team_dy_support';
    update teams set lead_user_id = '${SA.lead}' where team_id = 'team_dy_sales';
    insert into user_business_access values ('${SA.admin}', 'biz_dy'), ('${SA.peer}', 'biz_dy'), ('${SA.lead}', 'biz_dy'),
      ('${SA.under}', 'biz_dy'), ('${SA.vana}', 'biz_vana');
    insert into user_module_access (user_id, module, can_write, can_approve) values
      ('${SA.admin}', '/users/biz_dy', true, false), ('${SA.admin}', '/finance/biz_dy', true, false),
      ('${SA.admin}', '/documents/biz_dy', true, false)
    on conflict (user_id, module) do update set can_write = excluded.can_write, can_approve = excluded.can_approve;
  `)
  const owner = async <T,>(sql: string) => (await db.query<T>(sql)).rows
  const as = async <T,>(uid: string, sql: string, setup = '') => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      if (setup) await db.exec(setup)
      return (await db.query<T>(sql)).rows
    } finally {
      await db.exec('rollback')
    }
  }
  const commitAs = async <T,>(uid: string, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const rows = (await db.query<T>(sql)).rows
      await db.exec('commit')
      return rows
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  type Inv = { business?: string; email: string; name?: string; role?: string; team?: string | null; boss?: string | null; cls?: string; grants?: string[] }
  const q = (v: string | null | undefined) => (v === null || v === undefined ? 'null' : `'${v}'`)
  const inviteSql = (o: Inv) =>
    `select staff_admin_invite(p_business => ${q(o.business ?? 'biz_dy')}, p_email => ${q(o.email)}, p_display_name => ${q(o.name ?? o.email)},
       p_role => ${q(o.role ?? 'Member')}, p_team_id => ${o.team === null ? 'null' : q(o.team ?? 'team_dy_support')},
       p_reports_to => ${o.boss === null ? 'null' : q(o.boss ?? SA.chair)}::uuid, p_security_class => ${q(o.cls ?? 'Normal')},
       p_module_grants => array[${(o.grants ?? []).map((g) => `'${g}'`).join(', ')}]::text[])::text as id`
  const invite = async (uid: string, o: Inv) => (await commitAs<{ id: string }>(uid, inviteSql(o)))[0].id
  const refuses = (uid: string, o: Inv, re: RegExp, why: string) => assert.rejects(as(uid, inviteSql(o)), re, `0055: ${why}`)
  // 리뷰 I4 — 위임으로 싣는 권한은 둘(재무 입력 · 문서 등록). «결재 올리기»는 새 직원 기본(0054)이라 와도 버린다.
  const ALL = ['/chairman/decisions', '/documents/biz_dy', '/finance/biz_dy']
  const GR = ['/documents/biz_dy', '/finance/biz_dy']

  // ── 능력 판정 ──
  const can = async (uid: string, biz: string) => (await as<{ v: boolean }>(uid, `select can_manage_users('${biz}') as v`))[0].v
  assert.equal(await can(SA.admin, 'biz_dy'), true, '0055: «DY 사용자 관리자» 줄이 있는데 can_manage_users가 거짓')
  assert.equal(await can(SA.admin, 'biz_vana'), false, '0055: DY 관리자가 VANA 관리자로 판정된다')
  assert.equal(await can(SA.peer, 'biz_dy'), false, '0055: 줄 없는 직원이 사용자 관리자로 판정된다')
  assert.equal(await can(SA.chair, 'biz_dy'), false, '0055: 회장이 위임 길(can_manage_users)에 들어온다 — 회장은 0011 폼이다')
  // 능력 줄은 회장만 쓴다(0002 module_access_admin_write).
  await assert.rejects(as(SA.admin, `insert into user_module_access (user_id, module, can_write) values ('${SA.peer}', '/users/biz_dy', true)`),
    /row-level security/, '0055: 관리자가 남에게 «사용자 관리자»를 준다')
  assert.deepEqual(await as(SA.admin, `update user_module_access set can_approve = true where user_id = '${SA.admin}' and module = '/finance/biz_dy' returning 1`), [],
    '0055: 관리자가 자기 권한(마감)을 올린다')

  // ── 되는 것: 팀장 · 사원 초대 ──
  const tlId = await invite(SA.admin, { email: 'tl@x.co', name: '새 팀장', role: 'TeamLead', team: 'team_dy_sales', boss: SA.lead })
  const hireId = await invite(SA.admin, { email: 'hire@x.co', name: '새 사원', grants: [...ALL].reverse() })
  type Row = { role: string; biz: string[]; mg: string[]; sab: string | null; req: boolean; appr: string | null; by: string; boss: string; team: string }
  const rowOf = async (id: string) => (await owner<Row>(`select role::text as role, business_ids as biz, module_grants as mg, staff_admin_business as sab,
      chairman_approval_required as req, chairman_approved_at::text as appr, invited_by::text as by, reports_to::text as boss, team_id as team
      from user_invitations where invitation_id = '${id}'`))[0]
  assert.deepEqual(await rowOf(tlId), { role: 'TeamLead', biz: ['biz_dy'], mg: [], sab: 'biz_dy', req: false, appr: null, by: SA.admin, boss: SA.lead, team: 'team_dy_sales' },
    '0055: 팀장 위임 초대 행이 다르다')
  assert.deepEqual((await rowOf(hireId)).mg, GR, '0055: 사원 위임 초대의 권한 목록이 다르다(결재 올리기는 버려야)')
  // 관리자는 자기 초대를 읽는다(0026 subtree_read) — 동료는 못 읽는다.
  assert.equal((await as(SA.admin, `select 1 from user_invitations where invitation_id in ('${tlId}', '${hireId}')`)).length, 2, '0055: 관리자가 자기 초대를 못 읽는다')
  assert.deepEqual(await as(SA.peer, `select 1 from user_invitations where invitation_id = '${hireId}'`), [], '0055: 동료가 위임 초대를 읽는다')

  // ── 거부 ──
  await refuses(SA.admin, { email: 'ex@x.co', role: 'Executive' }, /staff_admin_role/, 'Executive 초대가 거부되지 않는다(큐에 넣지 말고 거부)')
  await refuses(SA.admin, { email: 'ceo@x.co', role: 'BusinessCEO' }, /staff_admin_role/, 'BusinessCEO 초대가 거부되지 않는다')
  await refuses(SA.admin, { email: 'v@x.co', role: 'Vendor' }, /staff_admin_role/, 'Vendor 초대가 거부되지 않는다')
  await refuses(SA.admin, { email: 'g1@x.co', grants: ['/finance/biz_vana'] }, /staff_admin_grant/, '다른 회사 재무 권한을 싣는다')
  await refuses(SA.admin, { email: 'g2@x.co', grants: ['/finance/biz_dy:approve'] }, /staff_admin_grant/, '모르는 키(마감 흉내)를 싣는다')
  await refuses(SA.admin, { email: 'g3@x.co', grants: ['/users/biz_dy'] }, /staff_admin_grant/, '«사용자 관리자» 능력을 위임으로 나눠 준다')
  await owner(`delete from user_module_access where user_id = '${SA.admin}' and module = '/documents/biz_dy'`)
  await refuses(SA.admin, { email: 'g4@x.co', grants: ['/documents/biz_dy'] }, /staff_admin_grant/, '관리자가 갖지 않은 문서 등록 권한을 준다')
  await owner(`insert into user_module_access (user_id, module, can_write) values ('${SA.admin}', '/documents/biz_dy', true)`)
  await refuses(SA.admin, { email: 'b1@x.co', boss: null }, /staff_admin_boss_missing/, '상사 없이 저장된다')
  await refuses(SA.admin, { email: 'b2@x.co', boss: SA.admin }, /staff_admin_boss_self/, '관리자 본인이 상사가 된다(피초대자 결재가 관리자에게 보인다)')
  await refuses(SA.admin, { email: 'b3@x.co', boss: SA.under }, /staff_admin_boss_self/, '관리자 아래 사람이 상사가 된다(subtree 누수)')
  await refuses(SA.admin, { email: 'b4@x.co', boss: SA.vana }, /staff_admin_boss_invalid/, '다른 회사 사람이 상사가 된다')
  await refuses(SA.admin, { email: 'b5@x.co', boss: SA.agent }, /staff_admin_boss_invalid/, '시스템 계정이 상사가 된다')
  await refuses(SA.admin, { email: 't1@x.co', team: null }, /staff_admin_team/, '팀 없이 저장된다')
  await refuses(SA.admin, { email: 't2@x.co', team: 'team_vana_55' }, /staff_admin_team/, '다른 회사 팀으로 저장된다')
  await refuses(SA.admin, { email: 'c1@x.co', cls: 'Restricted' }, /staff_admin_class/, '자기(Normal)보다 높은 등급을 준다')
  await refuses(SA.admin, { email: 'c2@x.co', cls: 'Public' }, /staff_admin_class/, '«공개»를 사람 등급으로 준다')
  await refuses(SA.admin, { email: 'o1@x.co', business: 'biz_vana', team: 'team_vana_55', boss: SA.vana }, /staff_admin_denied/, 'DY 관리자가 VANA로 초대한다')
  await refuses(SA.peer, { email: 'n1@x.co' }, /staff_admin_denied/, '능력 없는 직원이 초대한다')
  await refuses(SA.chair, { email: 'n2@x.co' }, /staff_admin_denied/, '회장이 위임 RPC를 쓴다')
  await refuses(SA.admin, { email: 'hire@x.co' }, /staff_admin_email_taken/, '같은 이메일의 대기 초대가 둘이 된다')
  await refuses(SA.admin, { email: 'peer@x.co' }, /staff_admin_email_taken/, '이미 계정이 있는 이메일을 초대한다')
  // 남(회장)이 넣은 대기 초대 — force RLS 아래에서 확인에 안 보여도 부분 유니크가 같은 키로 잡는다.
  await owner(`insert into user_invitations (email, role, display_name, invited_by, business_ids) values ('taken@x.co', 'Member', 't', '${SA.chair}', '{biz_dy}')`)
  await refuses(SA.admin, { email: 'taken@x.co' }, /staff_admin_email_taken/, '남이 넣은 대기 초대와 같은 이메일을 초대한다')
  await refuses(SA.admin, { email: 'long@x.co', name: 'ㄱ'.repeat(61) }, /staff_admin_name/, '61자 이름이 저장된다(M5)')
  // 리뷰 M5 — 관리자당 24시간 20건.
  await db.exec(`begin;
    insert into user_invitations (email, role, display_name, invited_by, business_ids, staff_admin_business)
    select 'rate' || g || '@x.co', 'Member', 'r', '${SA.admin}', '{biz_dy}', 'biz_dy' from generate_series(1, 18) g;
    select set_config('request.jwt.claim.sub', '${SA.admin}', true); set local role authenticated;`)
  const rate = await db.query(inviteSql({ email: 'rate99@x.co' })).then(() => 'ok', (e: Error) => e.message)
  await db.exec('rollback')
  assert.equal(rate, 'staff_admin_rate', '0055: 24시간 20건을 넘는 위임 초대가 된다(M5)')
  await refuses(SA.admin, { email: 'bad-email' }, /staff_admin_email/, '이메일 모양이 아닌데 저장된다')

  // 가드 — 두 칸은 RPC 안에서만. 0026 위임 insert · 회장 insert · update로 권한을 싣지 못한다.
  await assert.rejects(as(SA.lead, `insert into user_invitations (email, role, display_name, invited_by, reports_to, business_ids, module_grants)
      values ('sneak@x.co', 'Member', 's', '${SA.lead}', '${SA.lead}', '{biz_dy}', '["/finance/biz_dy"]')`), /staff_admin_columns/,
    '0055: 0026 위임 insert로 module_grants를 싣는다')
  await assert.rejects(as(SA.chair, `insert into user_invitations (email, role, display_name, invited_by, business_ids, staff_admin_business)
      values ('sneak2@x.co', 'Member', 's', '${SA.chair}', '{biz_dy}', 'biz_dy')`), /staff_admin_columns/, '0055: 회장 insert가 위임 꼬리표를 꾸민다')
  await assert.rejects(as(SA.chair, `update user_invitations set module_grants = '["/finance/biz_dy"]' where invitation_id = '${tlId}'`),
    /staff_admin_columns/, '0055: 초대의 권한 목록을 나중에 고친다')

  // 리뷰 I1 — 설정(GUC)을 직접 켜도 정책의 불변식이 막는다.
  const gucInsert = (by: string, role = 'Member', boss = SA.chair, grants = '[]') =>
    `select set_config('chairman.staff_admin', 'invite', true);
     insert into user_invitations (email, role, display_name, invited_by, reports_to, business_ids, team_id, staff_admin_business, module_grants)
     values ('guc@x.co', '${role}', 'g', '${by}', '${boss}', '{biz_dy}', 'team_dy_support', 'biz_dy', '${grants}');`
  await assert.rejects(as(SA.peer, 'select 1', gucInsert(SA.peer)), /row-level security/, '0055: 설정을 직접 켠 일반 직원이 위임 초대를 넣는다(I1)')
  await assert.rejects(as(SA.admin, 'select 1', gucInsert(SA.admin, 'Executive')), /row-level security/, '0055: 설정을 직접 켠 관리자가 Executive를 넣는다(I1)')
  await assert.rejects(as(SA.admin, 'select 1', gucInsert(SA.admin, 'Member', SA.under)), /row-level security/, '0055: 설정을 직접 켠 관리자가 자기 아래를 상사로 넣는다(I1)')
  await assert.rejects(as(SA.admin, 'select 1', gucInsert(SA.admin, 'Member', SA.chair, '["/finance/biz_vana"]')), /row-level security/,
    '0055: 설정을 직접 켠 관리자가 갖지 않은 권한을 싣는다(I1)')
  await assert.rejects(as(SA.admin, 'select 1', gucInsert(SA.admin, 'Member', SA.vana)), /row-level security/,
    '0055: 설정을 직접 켠 관리자가 다른 회사 사람을 상사로 넣는다(재리뷰 3)')
  await assert.rejects(as(SA.admin, 'select 1', gucInsert(SA.admin, 'Member', SA.chair, '["/chairman/decisions"]')), /row-level security/,
    '0055: 설정을 직접 켠 관리자가 결재 올리기를 위임 권한으로 싣는다(I1 · I4)')
  // 취소 설정 아래에서도 revoked_at 말고는 못 바꾼다.
  await assert.rejects(as(SA.admin, 'select 1', `select set_config('chairman.staff_admin', 'revoke', true);
      update user_invitations set role = 'Executive', revoked_at = now() where invitation_id = '${hireId}';`), /staff_admin_columns/,
    '0055: 취소 설정 아래에서 관리자가 초대의 역할을 바꾼다(I1)')
  assert.deepEqual(await as(SA.peer, `update user_invitations set revoked_at = now() where invitation_id = '${hireId}' returning 1`,
    `select set_config('chairman.staff_admin', 'revoke', true);`), [], '0055: 설정을 켠 동료가 관리자의 초대를 취소한다(I1)')

  // ── 회장 알림 · 감사 ──
  const notes = await owner<{ title: string; body: string; link: string; kind: string }>(
    `select title, body, link, kind from notifications where user_id = '${SA.chair}' order by created_at, title`)
  assert.equal(notes.length, 2, '0055: 위임 초대 둘에 회장 알림이 둘이 아니다')
  assert.ok(notes.some((n) => n.title === '김병훈님이 DY (주)에 새 사원님(사원)을 초대했습니다'), `0055: 알림 제목이 다르다 (${notes.map((n) => n.title).join(' / ')})`)
  assert.ok(notes.every((n) => n.kind === 'system' && n.link === '/settings/users'), '0055: 알림 종류 · 링크가 다르다')
  assert.ok(notes.some((n) => n.body.includes('권한 문서 등록 · 재무 입력 · 결재 올리기(기본)') && n.body.includes('상사 대표')), `0055: 알림 본문이 다르다 (${notes.map((n) => n.body).join(' / ')})`)
  assert.ok(!JSON.stringify(notes).includes('회장'), '0055: DB 알림 문구에 «회장»이 적혔다(0049)')
  assert.deepEqual(await owner(`select 1 from notifications where user_id <> '${SA.chair}'`), [], '0055: 회장 아닌 사람에게 알림이 갔다')
  const audits = await owner<{ n: number }>(`select count(*)::int as n from audit_log where action::text = 'permission_change'
     and entity_table = 'user_invitations' and actor_user_id = '${SA.admin}' and business_id = 'biz_dy' and note like '위임 초대(0055%'`)
  assert.equal(audits[0].n, 2, '0055: 위임 초대 감사가 둘이 아니다(거부된 시도는 남지 않아야)')

  // ── 고르기 칸 · 아침 숫자 ──
  type Opt = { people: { user_id: string; role: string }[]; teams: { team_id: string }[]; grantable: string[]; max_class: string }
  const [{ o }] = await as<{ o: Opt }>(SA.admin, `select staff_admin_options('biz_dy') as o`)
  const ids = o.people.map((p) => p.user_id)
  assert.ok(ids.includes(SA.chair) && ids.includes(SA.peer) && ids.includes(SA.lead), '0055: 상사 후보에 대표 · 동료 · 팀장이 없다')
  assert.ok(!ids.includes(SA.admin) && !ids.includes(SA.under) && !ids.includes(SA.vana) && !ids.includes(SA.agent),
    '0055: 상사 후보에 관리자 본인 · 그 아래 · 다른 회사 · 시스템 계정이 섞였다')
  assert.ok(o.teams.length >= 5 && o.teams.every((t) => t.team_id.startsWith('team_dy_')), '0055: 팀 후보가 DY 팀이 아니다')
  assert.deepEqual(o.grantable, GR, '0055: 줄 수 있는 권한이 관리자 권한과 다르다(결재 올리기는 목록에 없어야)')
  assert.equal(o.max_class, 'Normal', '0055: 관리자 등급이 다르다')
  assert.deepEqual(Object.keys(o.people[0]).sort(), ['display_name', 'role', 'team_id', 'user_id'], '0055: 고르기 칸이 이름 · 팀 · 역할 밖의 칸을 낸다')
  await assert.rejects(as(SA.peer, `select staff_admin_options('biz_dy')`), /staff_admin_denied/, '0055: 능력 없는 직원이 사람 목록을 받는다')
  assert.deepEqual(await as(SA.agent, `select delegated_invite_count(now() - interval '1 day') as n`), [{ n: 2 }], '0055: 아침 숫자(AIAgent)가 2가 아니다')
  assert.deepEqual(await as(SA.chair, `select delegated_invite_count(now() - interval '1 day') as n`), [{ n: 2 }], '0055: 아침 숫자(회장)가 2가 아니다')
  await assert.rejects(as(SA.admin, `select delegated_invite_count(now() - interval '1 day')`), /staff_admin_denied/, '0055: 관리자가 전체 숫자를 센다')
  // AIAgent는 여전히 초대 줄을 직접 못 읽는다(숫자 함수만).
  assert.deepEqual(await as(SA.agent, `select 1 from user_invitations`), [], '0055: AIAgent가 초대 줄을 읽는다')

  // ── 가입 → 프로필 · 권한(0054 결재 올리기 포함) → 결재 올리기 ──
  await owner(`insert into auth.users values ('${SA.hire}', 'hire@x.co')`)
  assert.deepEqual(await owner(`select role::text as role, team_id, reports_to::text as boss from user_profiles where user_id = '${SA.hire}'`),
    [{ role: 'Member', team_id: 'team_dy_support', boss: SA.chair }], '0055: 위임 초대 가입의 프로필이 다르다')
  assert.deepEqual(await owner(`select business_id from user_business_access where user_id = '${SA.hire}'`), [{ business_id: 'biz_dy' }],
    '0055: 위임 초대 가입의 회사 범위가 DY 하나가 아니다')
  assert.deepEqual(await owner(`select module, can_write, can_approve from user_module_access where user_id = '${SA.hire}' order by module`),
    ALL.map((module) => ({ module, can_write: true, can_approve: false })), '0055: 가입한 직원의 권한이 다르다(마감 없음 · 셋)')
  assert.equal((await owner(`select 1 from user_invitations where invitation_id = '${hireId}' and accepted_at is not null`)).length, 1, '0055: 초대가 수락으로 안 바뀌었다')
  const leave = (id: string, by: string) => `insert into decisions (decision_id, business_id, title, template_key, form, created_by)
     values ('${id}', 'biz_dy', '휴가', 'leave', '{"starts_on":"2026-10-07","ends_on":"2026-10-08"}', '${by}')`
  await commitAs(SA.hire, leave('dec_55h', SA.hire))
  await commitAs(SA.peer, leave('dec_55p', SA.peer))
  assert.equal((await as(SA.hire, `select 1 from decisions where decision_id = 'dec_55h'`)).length, 1, '0055: 가입한 직원이 결재를 못 올린다')
  // 관리자는 남의 결재를 못 본다 — 자기가 초대한 사람 것도.
  assert.deepEqual(await as(SA.admin, `select decision_id from decisions where decision_id in ('dec_55h', 'dec_55p')`), [],
    '0055: 관리자가 동료 · 자기 초대자의 결재를 본다')
  assert.deepEqual(await as(SA.admin, `select 1 from user_profiles where user_id = '${SA.hire}'`), [], '0055: 관리자가 자기 초대자의 프로필 행을 직접 읽는다(subtree 누수)')
  assert.equal((await as(SA.chair, `select 1 from decisions where decision_id in ('dec_55h', 'dec_55p')`)).length, 2, '0055: 대표가 직원 결재를 못 본다(회귀)')

  // ── 초대 뒤 관리자 권한이 줄면 그 권한은 붙지 않는다(닫힌 쪽) ──
  await invite(SA.admin, { email: 'cut@x.co', name: '권한 줄어든 사원', grants: ['/finance/biz_dy', '/documents/biz_dy'] })
  await owner(`delete from user_module_access where user_id = '${SA.admin}' and module = '/finance/biz_dy'`)
  await owner(`insert into auth.users values ('${SA.cut}', 'cut@x.co')`)
  assert.deepEqual(await owner(`select module from user_module_access where user_id = '${SA.cut}' order by module`),
    [{ module: '/chairman/decisions' }, { module: '/documents/biz_dy' }], '0055: 관리자가 잃은 재무 권한이 가입 때 붙는다')
  // 관리자가 마감(can_approve)까지 가져도 위임으로 붙는 것은 입력뿐이다.
  await owner(`insert into user_module_access (user_id, module, can_write, can_approve) values ('${SA.admin}', '/finance/biz_dy', true, true)`)
  const apprId = await invite(SA.admin, { email: 'appr@x.co', grants: ['/finance/biz_dy'] })
  assert.deepEqual((await rowOf(apprId)).mg, ['/finance/biz_dy'], '0055 전제: 마감 검사용 초대')

  // ── 취소 ──
  await assert.rejects(as(SA.peer, `select staff_admin_revoke_invitation('${apprId}')`), /staff_admin_not_found/, '0055: 동료가 관리자의 초대를 취소한다')
  const chairInv = (await commitAs<{ id: string }>(SA.chair, `insert into user_invitations (email, role, display_name, invited_by, reports_to, business_ids)
      values ('byc@x.co', 'Member', 'c', '${SA.chair}', '${SA.chair}', '{biz_dy}') returning invitation_id::text as id`))[0].id
  await assert.rejects(as(SA.admin, `select staff_admin_revoke_invitation('${chairInv}')`), /staff_admin_not_found/, '0055: 관리자가 대표의 초대를 취소한다')
  await assert.rejects(as(SA.admin, `select staff_admin_revoke_invitation('${hireId}')`), /staff_admin_not_found/, '0055: 이미 수락된 초대를 취소한다')
  // M8 — 관리자 이름으로 된 옛(0026 · 위임 꼬리표 없는) 초대는 이 RPC로 취소하지 못한다.
  const oldInv = (await owner<{ id: string }>(`insert into user_invitations (email, role, display_name, invited_by, reports_to, business_ids)
      values ('old26@x.co', 'Member', 'o', '${SA.admin}', '${SA.admin}', '{biz_dy}') returning invitation_id::text as id`))[0].id
  await assert.rejects(as(SA.admin, `select staff_admin_revoke_invitation('${oldInv}')`), /staff_admin_not_found/, '0055: 위임 꼬리표 없는 초대를 위임 RPC로 취소한다')
  // 마감 검사 — 취소 전에 가입시켜 본다(롤백): 붙는 줄은 can_approve=false.
  await db.exec(`begin; insert into auth.users values ('00000000-0000-0000-0000-0000000055ab', 'appr@x.co');`)
  const apprRows = await owner(`select can_write, can_approve from user_module_access where user_id = '00000000-0000-0000-0000-0000000055ab' and module = '/finance/biz_dy'`)
  await db.exec('rollback')
  assert.deepEqual(apprRows, [{ can_write: true, can_approve: false }], '0055: 관리자가 마감을 가지면 위임 가입에 마감이 붙는다')
  await owner(`update user_module_access set can_approve = false where user_id = '${SA.admin}' and module = '/finance/biz_dy'`)
  await commitAs(SA.admin, `select staff_admin_revoke_invitation('${apprId}')`)
  assert.equal((await owner(`select 1 from user_invitations where invitation_id = '${apprId}' and revoked_at is not null`)).length, 1, '0055: 관리자 취소가 안 됐다')
  assert.equal((await owner(`select 1 from audit_log where entity_table = 'user_invitations' and entity_id = '${apprId}' and note like '위임 초대 취소%'`)).length, 1,
    '0055: 취소 감사가 없다')
  // 관리자도 초대 줄을 직접 update하지는 못한다(설정 없이) — 0행.
  assert.deepEqual(await as(SA.admin, `update user_invitations set revoked_at = now() where invitation_id = '${tlId}' returning 1`), [],
    '0055: 관리자가 RPC 없이 초대 줄을 고친다')
  // 회장은 위임 초대도 그대로 취소한다(0042).
  assert.equal((await as(SA.chair, `update user_invitations set revoked_at = now() where invitation_id = '${tlId}' returning 1`)).length, 1,
    '0055: 회장이 위임 초대를 취소하지 못한다')

  // ── 능력 회수 → 더는 초대 못 함 · 회수 전 초대는 가입해도 권한이 안 붙는다 ──
  // 재리뷰 1 — 회장이 관리자의 회사 범위(DY)를 지우면 그 회사의 대기 위임 초대가 자동 취소된다.
  const scopeInv = await invite(SA.admin, { email: 'scope@x.co' })
  await commitAs(SA.chair, `delete from user_business_access where user_id = '${SA.admin}' and business_id = 'biz_dy'`)
  assert.equal((await owner(`select 1 from user_invitations where invitation_id = '${scopeInv}' and revoked_at is not null`)).length, 1,
    '0055: 관리자의 회사 범위를 지웠는데 그 회사 대기 위임 초대가 열려 있다(재리뷰 1)')
  await owner(`insert into user_business_access values ('${SA.admin}', 'biz_dy')`)
  const lateId = await invite(SA.admin, { email: 'late@x.co', name: '늦은 가입', grants: ['/documents/biz_dy'] })
  await commitAs(SA.chair, `delete from user_module_access where user_id = '${SA.admin}' and module = '/users/biz_dy'`)
  await refuses(SA.admin, { email: 'after@x.co' }, /staff_admin_denied/, '능력을 회수했는데 초대가 된다')
  // 리뷰 I5 — 능력 회수가 그 관리자의 대기 위임 초대를 자동 취소한다(감사 먼저).
  assert.equal((await owner(`select 1 from user_invitations where invitation_id = '${lateId}' and revoked_at is not null`)).length, 1,
    '0055: 능력 회수 뒤에도 관리자의 대기 위임 초대가 열려 있다(I5)')
  assert.equal((await owner(`select 1 from audit_log where entity_id = '${lateId}' and note like '위임 초대 자동 취소%' and actor_user_id = '${SA.chair}'`)).length, 1,
    '0055: 자동 취소 감사가 없다(I5)')
  // 가입 때 닫힌 쪽 — 누가 취소를 되돌려도(세션 없는 수정) 초대자가 관리자가 아니면 프로필이 생기지 않는다.
  await owner(`update user_invitations set revoked_at = null where invitation_id = '${lateId}'`)
  await owner(`insert into auth.users values ('${SA.late}', 'late@x.co')`)
  assert.deepEqual(await owner(`select 1 from user_profiles where user_id = '${SA.late}'`), [],
    '0055: 능력이 회수된 관리자의 초대로 계정에 권한이 생긴다(I5 — 닫힌 쪽)')
  assert.equal((await owner(`select 1 from user_invitations where invitation_id = '${lateId}' and revoked_at is not null and accepted_at is null`)).length, 1,
    '0055: 가입 때 멈춘 위임 초대가 대기로 남는다(재리뷰 1 — 그 이메일의 다음 초대를 막는다)')

  // 리뷰 I2 — 팀장인 관리자: 자기가 팀장인 팀으로는 못 부른다 · 고르기 칸에서도 빠진다.
  await owner(`insert into user_module_access (user_id, module, can_write) values ('${SA.lead}', '/users/biz_dy', true)`)
  await refuses(SA.lead, { email: 'ts@x.co', team: 'team_dy_sales', boss: SA.chair }, /staff_admin_team_self/, '팀장 관리자가 자기 팀으로 부른다(결재선 첫 칸이 관리자)')
  await assert.rejects(as(SA.lead, 'select 1', `select set_config('chairman.staff_admin', 'invite', true);
     insert into user_invitations (email, role, display_name, invited_by, reports_to, business_ids, team_id, staff_admin_business)
     values ('ts2@x.co', 'Member', 'g', '${SA.lead}', '${SA.chair}', '{biz_dy}', 'team_dy_sales', 'biz_dy');`), /row-level security/,
    '0055: 설정을 켠 팀장 관리자가 자기 팀으로 직접 넣는다(I1 · I2)')
  const [{ o: oLead }] = await as<{ o: Opt }>(SA.lead, `select staff_admin_options('biz_dy') as o`)
  assert.ok(!oLead.teams.some((t) => t.team_id === 'team_dy_sales') && oLead.teams.some((t) => t.team_id === 'team_dy_rnd'),
    '0055: 팀장 관리자의 팀 후보에 자기 팀이 있다(또는 다른 팀이 없다)')
  // 재리뷰 1 — 관리자의 역할이 사람 역할 밖으로 바뀌면 대기 위임 초대 자동 취소.
  const roleInv = await invite(SA.lead, { email: 'role@x.co', team: 'team_dy_rnd', boss: SA.chair })
  await commitAs(SA.chair, `update user_profiles set role = 'Vendor' where user_id = '${SA.lead}'`)
  assert.equal((await owner(`select 1 from user_invitations where invitation_id = '${roleInv}' and revoked_at is not null`)).length, 1,
    '0055: 관리자 역할이 사람 역할 밖으로 바뀌었는데 대기 위임 초대가 열려 있다(재리뷰 1)')
  await owner(`update user_profiles set role = 'TeamLead' where user_id = '${SA.lead}'`)
  // 관리자 회수(퇴사) → 대기 위임 초대 자동 취소.
  const leadInv = await invite(SA.lead, { email: 'byl@x.co', team: 'team_dy_rnd', boss: SA.chair })
  await commitAs(SA.chair, `update user_profiles set revoked_at = now() where user_id = '${SA.lead}'`)
  assert.equal((await owner(`select 1 from user_invitations where invitation_id = '${leadInv}' and revoked_at is not null`)).length, 1,
    '0055: 관리자가 회수됐는데 그 사람의 대기 위임 초대가 열려 있다(I5)')

  // ── 카탈로그 ──
  assert.deepEqual(await owner(`select relname, relforcerowsecurity as f from pg_class where relname in ('notifications', 'user_module_access', 'user_profiles') order by 1`),
    [{ relname: 'notifications', f: false }, { relname: 'user_module_access', f: false }, { relname: 'user_profiles', f: false }], '0055: force가 새로 걸렸다(0035 함정)')
  for (const fn of ['staff_admin_holds(uuid, text)', 'staff_admin_apply_grants(user_invitations, uuid)', 'staff_admin_invitation_guard()', 'apply_user_invitation(uuid, uuid)',
    'module_grant_audit(uuid, text, jsonb, jsonb, text)', 'staff_admin_revoke_pending(uuid, text, text)', 'staff_admin_capability_revoked()', 'staff_admin_profile_revoked()',
    'staff_admin_scope_revoked()']) {
    assert.deepEqual(await owner(`select has_function_privilege('authenticated', '${fn}', 'execute') as a, has_function_privilege('anon', '${fn}', 'execute') as b`),
      [{ a: false, b: false }], `0055: 내부 함수 ${fn}가 RPC로 열렸다`)
  }
  for (const fn of ['can_manage_users(text)', 'staff_admin_options(text)', 'staff_admin_revoke_invitation(uuid)', 'delegated_invite_count(timestamptz)']) {
    assert.deepEqual(await owner(`select has_function_privilege('anon', '${fn}', 'execute') as b`), [{ b: false }], `0055: ${fn}가 anon에게 열렸다`)
  }
  const defs = await owner<{ proname: string; cfg: string[] | null; sec: boolean }>(`select proname, proconfig as cfg, prosecdef as sec from pg_proc
     where proname in ('can_manage_users', 'staff_admin_holds', 'staff_admin_invite', 'staff_admin_apply_grants', 'staff_admin_revoke_invitation', 'staff_admin_options', 'delegated_invite_count',
       'staff_admin_revoke_pending', 'staff_admin_capability_revoked', 'staff_admin_profile_revoked', 'staff_admin_scope_revoked', 'staff_admin_boss_ok')`)
  assert.equal(defs.length, 12, '0055: 함수 열둘을 다 못 찾는다')
  // staff_admin_boss_ok는 정책 식이라 authenticated에게 열려 있다 — 호출자 회사 밖이면 늘 false(남의 회사 사람을 캐지 못한다).
  assert.deepEqual(await as(SA.vana, `select staff_admin_boss_ok('${SA.peer}', 'biz_dy') as v`), [{ v: false }], '0055: 다른 회사 직원이 DY 사람의 활성 여부를 캔다')
  assert.deepEqual(await as(SA.peer, `select staff_admin_boss_ok('${SA.chair}', 'biz_dy') as v`), [{ v: true }], '0055 전제: 같은 회사 안에서는 답한다')
  assert.deepEqual(await owner(`select policyname from pg_policies where tablename = 'user_invitations' and policyname = 'user_invitations_delegated_insert'`), [],
    '0055: 0026 위임 insert 정책이 남아 있다(I3)')
  for (const d of defs) assert.ok(d.sec && (d.cfg ?? []).includes('search_path=public, pg_temp'), `0055: ${d.proname}가 definer · search_path=public, pg_temp가 아니다`)

  // ── BYPASSRLS 없는 소유자 — force RLS(user_invitations · audit_log · teams · businesses) 아래에서도 RPC가 돈다 ──
  await db.exec(`
    create role app_owner55 nosuperuser nobypassrls nologin;
    grant usage on schema auth to app_owner55;
    grant select on auth.users to app_owner55;
    grant execute on all functions in schema public to app_owner55;
    grant execute on all functions in schema auth to app_owner55;
    do $o$ declare r record; begin
      for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r', 'v', 'p') loop
        execute format('alter table public.%I owner to app_owner55', r.relname);
      end loop;
      for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prokind = 'f' loop
        execute format('alter function %s owner to app_owner55', r.f);
      end loop;
    end $o$;
    insert into user_module_access (user_id, module, can_write) values ('${SA.admin}', '/users/biz_dy', true);
  `)
  const forcedNow = await owner<{ relname: string }>(`select relname from pg_class where relname in ('user_invitations', 'audit_log', 'teams', 'businesses') and relforcerowsecurity order by 1`)
  assert.equal(forcedNow.length, 4, '0055 전제: force RLS 표 넷이 아니다')
  const nbId = await invite(SA.admin, { email: 'nb@x.co', name: '소유자 검사', grants: ['/documents/biz_dy'] })
  assert.equal((await owner(`select 1 from user_invitations where invitation_id = '${nbId}' and staff_admin_business = 'biz_dy'`)).length, 1,
    '0055: BYPASSRLS 없는 소유자에서 위임 초대가 안 생긴다')
  assert.equal((await owner(`select 1 from audit_log where entity_id = 'nb@x.co' and note like '위임 초대(0055%'`)).length, 1, '0055: BYPASSRLS 없는 소유자에서 초대 감사가 없다')
  assert.equal((await owner(`select 1 from notifications where user_id = '${SA.chair}' and title like '%소유자 검사%'`)).length, 1, '0055: BYPASSRLS 없는 소유자에서 회장 알림이 없다')
  const [{ o: o2 }] = await as<{ o: Opt }>(SA.admin, `select staff_admin_options('biz_dy') as o`)
  assert.ok(o2.teams.length >= 5 && o2.people.length >= 3, '0055: BYPASSRLS 없는 소유자에서 고르기 칸이 빈다(teams force)')
  const [{ n: nCount }] = await as<{ n: number }>(SA.agent, `select delegated_invite_count(now() - interval '1 day') as n`)
  assert.equal(nCount, (await owner<{ n: number }>(`select count(*)::int as n from user_invitations where staff_admin_business is not null`))[0].n,
    '0055: BYPASSRLS 없는 소유자에서 아침 숫자가 실제 위임 초대 수와 다르다')
  await commitAs(SA.admin, `select staff_admin_revoke_invitation('${nbId}')`)
  assert.equal((await owner(`select 1 from user_invitations where invitation_id = '${nbId}' and revoked_at is not null`)).length, 1,
    '0055: BYPASSRLS 없는 소유자에서 관리자 취소가 안 된다')
  await refuses(SA.peer, { email: 'nb2@x.co' }, /staff_admin_denied/, 'BYPASSRLS 없는 소유자에서 능력 없는 직원이 초대한다')
  const nb3 = await invite(SA.admin, { email: 'nb3@x.co' })
  await commitAs(SA.chair, `delete from user_module_access where user_id = '${SA.admin}' and module = '/users/biz_dy'`)
  assert.equal((await owner(`select 1 from user_invitations where invitation_id = '${nb3}' and revoked_at is not null`)).length, 1,
    '0055: BYPASSRLS 없는 소유자에서 능력 회수의 자동 취소가 안 된다')
  await db.close()
}

/**
 * 0059 단계 결재 — 조직도 상사 사슬 · 차례대로 · 반려 사유 · 재상신 · 끝난 결재 얼림 · 대표 한 번에 승인 · 결재 대장 열람.
 * 회장 지시의 다섯 거부(차례 건너뛰기 · 남의 차례 · 끝난 결재 수정 · 결재선 위조 · 다른 회사 결재)를 잰다.
 * dummy 거울(lib/approval-chain.ts bossChain · chainLine)이 DB와 같은 결재선을 내는지도 같이 잰다.
 */
const AC = {
  chair: '00000000-0000-0000-0000-0000000059a1',
  ceo: '00000000-0000-0000-0000-0000000059a2', // DY BusinessCEO, 상사 = 대표
  lead: '00000000-0000-0000-0000-0000000059a3', // DY TeamLead, 상사 = 대표
  emp1: '00000000-0000-0000-0000-0000000059a4', // 김병훈 자리 — 상사 = 대표
  emp2: '00000000-0000-0000-0000-0000000059a5', // 상사 = lead
  mid: '00000000-0000-0000-0000-0000000059a6', // Executive, 상사 = lead
  emp3: '00000000-0000-0000-0000-0000000059a7', // 상사 = mid → lead → 대표
  gone: '00000000-0000-0000-0000-0000000059a8', // 떠난 사람, 상사 = lead
  emp4: '00000000-0000-0000-0000-0000000059a9', // 상사 = gone(떠남) → lead
  vboss: '00000000-0000-0000-0000-0000000059aa', // VANA만 보는 TeamLead, 상사 = lead
  emp5: '00000000-0000-0000-0000-0000000059ab', // 상사 = vboss(DY 접근 없음) → lead
  vana: '00000000-0000-0000-0000-0000000059ac', // VANA 직원
  clerk: '00000000-0000-0000-0000-0000000059ad', // DY 경영지원 — «DY 결재 대장 열람»
  nobody: '00000000-0000-0000-0000-0000000059ae', // DY 직원, 권한 없음
  cyc1: '00000000-0000-0000-0000-0000000059af', // cyc1 → cyc2 → 대표 (순환 reports_to는 0025 트리거가 막는다)
  cyc2: '00000000-0000-0000-0000-0000000059b0',
  agent: '00000000-0000-0000-0000-0000000059b1',
}

async function approvalChain() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    revoke all on table approval_steps from authenticated;
    grant select on table approval_steps to authenticated;
    insert into auth.users select id::uuid, id || '@x' from unnest(array[${Object.values(AC).map((u) => `'${u}'`).join(', ')}]) id;
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${AC.chair}', 'Chairman', '회장님', 'Vault', null),
      ('${AC.ceo}', 'BusinessCEO', 'DY 대표이사', 'Restricted', null),
      ('${AC.lead}', 'TeamLead', '팀장', 'Normal', 'team_dy_support'),
      ('${AC.emp1}', 'Member', '김병훈', 'Normal', 'team_dy_support'),
      ('${AC.emp2}', 'Member', '사원2', 'Normal', 'team_dy_support'),
      ('${AC.mid}', 'Executive', '임원', 'Normal', null),
      ('${AC.emp3}', 'Member', '사원3', 'Normal', null),
      ('${AC.gone}', 'Member', '떠난 상사', 'Normal', null),
      ('${AC.emp4}', 'Member', '사원4', 'Normal', null),
      ('${AC.vboss}', 'TeamLead', 'VANA 팀장', 'Normal', null),
      ('${AC.emp5}', 'Member', '사원5', 'Normal', null),
      ('${AC.vana}', 'Member', 'VANA 직원', 'Normal', null),
      ('${AC.clerk}', 'Member', '경영지원', 'Normal', 'team_dy_support'),
      ('${AC.nobody}', 'Member', '권한 없음', 'Normal', null),
      ('${AC.cyc1}', 'Member', '순환1', 'Normal', null),
      ('${AC.cyc2}', 'Member', '순환2', 'Normal', null),
      ('${AC.agent}', 'AIAgent', 'ai', 'Restricted', null);
    update user_profiles set reports_to = '${AC.chair}' where user_id in ('${AC.ceo}', '${AC.lead}', '${AC.emp1}');
    update user_profiles set reports_to = '${AC.lead}' where user_id in ('${AC.emp2}', '${AC.mid}', '${AC.gone}', '${AC.vboss}');
    update user_profiles set reports_to = '${AC.mid}' where user_id = '${AC.emp3}';
    update user_profiles set reports_to = '${AC.gone}' where user_id = '${AC.emp4}';
    update user_profiles set reports_to = '${AC.vboss}' where user_id = '${AC.emp5}';
    update user_profiles set reports_to = '${AC.cyc2}' where user_id = '${AC.cyc1}';
    update user_profiles set reports_to = '${AC.chair}' where user_id = '${AC.cyc2}'; -- 순환은 0025 트리거가 막는다
    update user_profiles set revoked_at = now(), status = 'left' where user_id = '${AC.gone}';
    insert into user_business_access
      select u::uuid, 'biz_dy' from unnest(array['${AC.ceo}', '${AC.lead}', '${AC.emp1}', '${AC.emp2}', '${AC.mid}', '${AC.emp3}', '${AC.gone}',
        '${AC.emp4}', '${AC.emp5}', '${AC.clerk}', '${AC.nobody}', '${AC.cyc1}', '${AC.cyc2}']) u;
    insert into user_business_access values ('${AC.vboss}', 'biz_vana'), ('${AC.vana}', 'biz_vana');
    insert into user_module_access (user_id, module, can_write, can_approve) values ('${AC.clerk}', '/approvals/ledger/biz_dy', false, false);
    -- 운영 양식은 첨부 칸이 없다(10-06 회장이 저장 — attachment_required false).
    update approval_templates set attachment_required = false;
  `)
  const owner = async <T,>(sql: string) => (await db.query<T>(sql)).rows
  const as = async <T,>(uid: string, sql: string, setup = '') => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      if (setup) await db.exec(setup)
      return (await db.query<T>(sql)).rows
    } finally {
      await db.exec('rollback')
    }
  }
  const commitAs = async <T,>(uid: string, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const r = (await db.query<T>(sql)).rows
      await db.exec('commit')
      return r
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  const submit = (id: string, by: string, tpl: 'expense' | 'leave' | 'contract', amount = '300000', resubmitOf = '') => {
    const form = tpl === 'expense' ? `{"amount":"${amount}","purpose":"비품","spent_on":"2026-10-07"}`
      : tpl === 'leave' ? '{"starts_on":"2026-10-08","ends_on":"2026-10-09"}'
      : `{"counterparty":"A사","amount":"${amount}","term":"1년","summary":"x"}`
    const biz = by === AC.vana ? 'biz_vana' : 'biz_dy'
    return commitAs(by, `insert into decisions (decision_id, business_id, title, template_key, form, created_by${resubmitOf ? ', resubmit_of' : ''})
      values ('${id}', '${biz}', '${tpl} ${id}', '${tpl}', '${form}'::jsonb, '${by}'${resubmitOf ? `, '${resubmitOf}'` : ''})`)
  }
  const decide = (uid: string, id: string, approve: boolean, note: string | null = null) =>
    commitAs<{ v: string }>(uid, `select approval_decide('${id}', ${approve}, ${note === null ? 'null' : `'${note}'`}) as v`).then((r) => r[0].v)
  type St = { seq: number; who: string; status: string; chair: boolean }
  const steps = (id: string) => owner<St>(`select seq, approver_user_id::text as who, status, is_chairman as chair from approval_steps where decision_id = '${id}' order by seq`)
  type Dec = { status: string; by: string | null; kind: string | null; cr: boolean; chain: boolean; lead: string | null }
  const dec = async (id: string) => (await owner<Dec>(`select status::text as status, decided_by::text as by, decided_by_kind as kind,
     chairman_required as cr, step_chain as chain, lead_status as lead from decisions where decision_id = '${id}'`))[0]

  // ── 시나리오 1: 사원(상사 = 대표) 30만 → 대표 승인 대기(«기록 완료» 폐지) ──
  await submit('dec_59a', AC.emp1, 'expense', '300000')
  assert.deepEqual(await dec('dec_59a'), { status: 'Open', by: null, kind: null, cr: true, chain: true, lead: null }, '0059: 상사가 대표인 직원의 30만 지출이 대표 대기가 아니다(«기록 완료»가 남았다)')
  assert.deepEqual(await steps('dec_59a'), [{ seq: 1, who: AC.chair, status: 'pending', chair: true }], '0059: 30만 지출의 단계가 대표 한 칸이 아니다')
  const [la] = await owner<{ line: ApprovalStep[] }>(`select approval_line as line from decisions where decision_id = 'dec_59a'`)
  assert.deepEqual(la.line.map((s) => [s.step, s.why]), [['chairman', '직속 상사(대표)'], ['rule', '금액 300000원 < 기준 5000000원 → 직속 상사 승인으로 종결']], '0059: 결재선 문장이 다르다')
  assert.ok(!JSON.stringify(la.line).includes('회장'), '0059: 결재선에 «회장»이 적혔다')
  // 대표에게는 건마다 알림을 보내지 않는다(아침 요약 · 승인함).
  assert.deepEqual(await owner(`select 1 from notifications where user_id = '${AC.chair}' and link like '%dec_59a'`), [], '0059: 대표에게 건마다 알림이 간다')
  const [snap] = await owner<{ n: string; t: string; tn: string }>(`select requester_name as n, requester_team_id as t, requester_team_name as tn from decisions where decision_id = 'dec_59a'`)
  assert.deepEqual(snap, { n: '김병훈', t: 'team_dy_support', tn: '경영지원' }, '0059: 올린 사람 스냅숏이 비었다')

  // ── 시나리오 2: 사원(상사 = 팀장) 30만 → 팀장 승인으로 종결 ──
  await submit('dec_59b', AC.emp2, 'expense', '300000')
  assert.deepEqual(await steps('dec_59b'), [{ seq: 1, who: AC.lead, status: 'pending', chair: false }], '0059: 30만 지출이 직속 상사 한 칸이 아니다')
  assert.equal((await owner(`select 1 from notifications where user_id = '${AC.lead}' and link = '/approvals?id=dec_59b' and title like '결재 차례%'`)).length, 1, '0059: 첫 결재자에게 차례 알림이 없다')
  await assert.rejects(decide(AC.chair, 'dec_59b', true), /approval_not_your_turn/, '0059: 대표가 살아 있는 팀장의 차례를 처리한다(남의 차례)')
  await assert.rejects(decide(AC.emp1, 'dec_59b', true), /approval_not_found|approval_not_your_turn/, '0059: 결재선 밖 사람이 처리한다')
  assert.equal(await decide(AC.lead, 'dec_59b', true, '확인'), 'approved', '0059: 팀장 승인으로 종결되지 않는다')
  assert.deepEqual(await dec('dec_59b'), { status: 'Approved', by: AC.lead, kind: 'ceo', cr: false, chain: true, lead: null }, '0059: 팀장 종결의 처리자 · 종류가 다르다')
  assert.equal((await owner(`select 1 from notifications where user_id = '${AC.emp2}' and title like '결재 최종 승인%'`)).length, 1, '0059: 올린 사람에게 최종 승인 알림이 없다')
  await assert.rejects(decide(AC.lead, 'dec_59b', true), /approval_not_pending/, '0059: 끝난 결재를 또 처리한다')

  // ── 시나리오 3: 600만 → 팀장 → 대표 (차례 건너뛰기 거부) ──
  await submit('dec_59c', AC.emp2, 'expense', '6,000,000')
  assert.deepEqual((await steps('dec_59c')).map((s) => [s.who, s.status]), [[AC.lead, 'pending'], [AC.chair, 'waiting']], '0059: 600만 지출의 단계가 팀장 → 대표가 아니다')
  await assert.rejects(decide(AC.chair, 'dec_59c', true), /approval_not_your_turn/, '0059: 대표가 앞 단계(팀장) 전에 승인한다(차례 건너뛰기)')
  assert.equal(await decide(AC.lead, 'dec_59c', true), 'next', '0059: 팀장 승인 뒤 대표 차례로 넘어가지 않는다')
  assert.deepEqual((await steps('dec_59c')).map((s) => s.status), ['approved', 'pending'])
  assert.equal(await decide(AC.chair, 'dec_59c', true), 'approved', '0059: 대표 최종 승인이 안 된다')
  assert.deepEqual(await dec('dec_59c'), { status: 'Approved', by: AC.chair, kind: 'chairman', cr: true, chain: true, lead: null })

  // ── 사슬: 여러 단계 · 떠난 상사 건너뜀 · 회사 접근 없는 상사 건너뜀 · 순환 · 계약은 금액 무관 ──
  await submit('dec_59d', AC.emp3, 'expense', '7000000')
  assert.deepEqual((await steps('dec_59d')).map((s) => s.who), [AC.mid, AC.lead, AC.chair], '0059: 사슬이 임원 → 팀장 → 대표가 아니다')
  await assert.rejects(decide(AC.lead, 'dec_59d', true), /approval_not_your_turn/, '0059: 2단계 결재자가 1단계보다 먼저 처리한다')
  await submit('dec_59e', AC.emp4, 'expense', '300000')
  assert.deepEqual((await steps('dec_59e')).map((s) => s.who), [AC.lead], '0059: 떠난 상사를 건너뛰지 않는다')
  await submit('dec_59f', AC.emp5, 'contract', '1')
  assert.deepEqual((await steps('dec_59f')).map((s) => s.who), [AC.lead, AC.chair], '0059: DY 접근이 없는 상사를 건너뛰지 않는다(또는 계약이 대표까지 안 간다)')
  await submit('dec_59g', AC.cyc1, 'contract', '1')
  assert.deepEqual((await steps('dec_59g')).map((s) => s.who), [AC.cyc2, AC.chair], '0059: 상사 → 대표 사슬이 아니다')
  await submit('dec_59h', AC.ceo, 'leave')
  assert.deepEqual((await steps('dec_59h')).map((s) => s.who), [AC.chair], '0059: CEO의 휴가가 대표 한 칸이 아니다')
  // 대표 본인이 올린 양식 결재는 대표 결정으로 바로 닫힌다.
  await submit('dec_59i', AC.chair, 'leave')
  assert.deepEqual(await dec('dec_59i'), { status: 'Approved', by: AC.chair, kind: 'chairman', cr: false, chain: true, lead: null }, '0059: 대표 본인 결재가 바로 닫히지 않는다')
  assert.deepEqual(await steps('dec_59i'), [])

  // dummy 거울 — bossChain · chainLine이 트리거와 같은 결재선(문장까지).
  const people = await owner<{ user_id: string; display_name: string; role: Role; reports_to: string | null; revoked_at: string | null; status: string }>(
    `select user_id::text, display_name, role::text as role, reports_to::text, revoked_at::text, status from user_profiles`)
  const access = await owner<{ u: string; b: string }>(`select user_id::text as u, business_id as b from user_business_access`)
  const hasBiz = (biz: string) => (uid: string) => {
    const p = people.find((x) => x.user_id === uid)
    return !!p && (p.role === 'Chairman' || p.role === 'GroupCFO' || access.some((a) => a.u === uid && a.b === biz))
  }
  const tpls = new Map((await owner<ApprovalTemplate>(`select * from approval_templates`)).map((t) => [t.template_key, { ...t, chairman_over: t.chairman_over === null ? null : Number(t.chairman_over) }]))
  const mirrorCases: [string, string, ApprovalTemplate['template_key'], Record<string, string>][] = [
    ['dec_59a', AC.emp1, 'expense', { amount: '300000', purpose: '비품', spent_on: '2026-10-07' }],
    ['dec_59c', AC.emp2, 'expense', { amount: '6,000,000', purpose: '비품', spent_on: '2026-10-07' }],
    ['dec_59d', AC.emp3, 'expense', { amount: '7000000', purpose: '비품', spent_on: '2026-10-07' }],
    ['dec_59e', AC.emp4, 'expense', { amount: '300000', purpose: '비품', spent_on: '2026-10-07' }],
    ['dec_59f', AC.emp5, 'contract', { counterparty: 'A사', amount: '1', term: '1년', summary: 'x' }],
    ['dec_59g', AC.cyc1, 'contract', { counterparty: 'A사', amount: '1', term: '1년', summary: 'x' }],
    ['dec_59h', AC.ceo, 'leave', { starts_on: '2026-10-08', ends_on: '2026-10-09' }],
  ]
  for (const [id, who, tpl, form] of mirrorCases) {
    const [row] = await owner<{ line: ApprovalStep[] }>(`select approval_line as line from decisions where decision_id = '${id}'`)
    const me = people.find((p) => p.user_id === who)!
    const mirror = chainLine(tpls.get(tpl)!, form, bossChain(who, people, hasBiz('biz_dy')), { user_id: AC.chair, name: '대표' }, me.reports_to === AC.chair)
    assert.deepEqual(mirror.map((s) => [s.step, s.user_id, s.why]), row.line.map((s) => [s.step, s.user_id, s.why]), `0059: dummy 거울이 트리거와 다른 결재선을 낸다(${id})`)
  }
  // 미리보기 RPC는 세션 본인의 사슬만.
  assert.deepEqual((await as<{ u: string }>(AC.emp3, `select user_id::text as u from my_approval_chain('biz_dy') order by seq`)).map((r) => r.u), [AC.mid, AC.lead], '0059: 미리보기 사슬이 다르다')
  assert.deepEqual(await as(AC.vana, `select 1 from my_approval_chain('biz_dy')`), [], '0059: 다른 회사 미리보기가 사슬을 낸다')

  // ── 반려: 사유 필수 · 즉시 종결 · 남은 칸 취소 · 알림 · 재상신 ──
  await assert.rejects(decide(AC.mid, 'dec_59d', false), /approval_reason_required/, '0059: 사유 없는 반려가 된다')
  await assert.rejects(decide(AC.mid, 'dec_59d', false, '   '), /approval_reason_required/, '0059: 빈칸 사유 반려가 된다')
  assert.equal(await decide(AC.mid, 'dec_59d', false, '견적 두 곳 더'), 'rejected')
  assert.deepEqual((await steps('dec_59d')).map((s) => s.status), ['rejected', 'cancelled', 'cancelled'], '0059: 반려 뒤 남은 칸이 취소되지 않는다')
  assert.deepEqual((await dec('dec_59d')).status, 'Rejected')
  assert.equal((await owner(`select 1 from notifications where user_id = '${AC.emp3}' and title like '결재 반려%' and body like '%견적 두 곳 더%'`)).length, 1, '0059: 반려 알림(사유 포함)이 없다')
  await assert.rejects(submit('dec_59x', AC.emp2, 'expense', '100', 'dec_59d'), /approval_resubmit_invalid/, '0059: 남의 반려 결재를 재상신한다')
  await assert.rejects(submit('dec_59x', AC.emp2, 'expense', '100', 'dec_59b'), /approval_resubmit_invalid/, '0059: 승인된 결재를 재상신한다')
  await assert.rejects(submit('dec_59x', AC.emp3, 'leave', '', 'dec_59d'), /approval_resubmit_invalid/, '0059: 다른 양식으로 재상신한다')
  await submit('dec_59d2', AC.emp3, 'expense', '7000000', 'dec_59d')
  assert.deepEqual((await steps('dec_59d2')).map((s) => [s.who, s.status]), [[AC.mid, 'pending'], [AC.lead, 'waiting'], [AC.chair, 'waiting']], '0059: 재상신이 새 결재로 서지 않는다')
  await assert.rejects(submit('dec_59d3', AC.emp3, 'expense', '7000000', 'dec_59d'), /decisions_resubmit_once|duplicate key/, '0059: 같은 원본을 두 번 재상신한다')

  // ── 끝난 결재 수정 · 결재선 위조 ──
  await assert.rejects(as(AC.chair, `update decisions set title = '고침' where decision_id = 'dec_59b'`), /approval_use_steps/, '0059: 끝난 단계 결재의 제목을 고친다')
  await assert.rejects(as(AC.chair, `update decisions set status = 'Rejected' where decision_id = 'dec_59c'`), /approval_use_steps/, '0059: 끝난 단계 결재의 상태를 바꾼다')
  await assert.rejects(as(AC.chair, `update decisions set form = '{"amount":"1"}' where decision_id = 'dec_59c'`), /approval_line_frozen/, '0059: 끝난 결재의 양식 값을 고친다')
  await assert.rejects(as(AC.chair, `update decisions set title = '고침' where decision_id = 'dec_59a'`), /approval_use_steps/, '0059: 열린 단계 결재의 제목을 고친다')
  // 0059 전에 끝난 양식 결재(«기록 완료»)도 세션은 못 고친다.
  await db.exec(`alter table decisions disable trigger decisions_approval_line_trigger;
    insert into decisions (decision_id, business_id, title, template_key, form, created_by, status, decided_by_kind, lead_status, chairman_required, approval_line)
      values ('dec_59old', 'biz_dy', '옛 기록 완료', 'expense', '{"amount":"400000","purpose":"x","spent_on":"2026-10-06"}', '${AC.emp1}', 'Approved', 'rule', 'skipped', false, '[]');
    alter table decisions enable trigger decisions_approval_line_trigger;`)
  // (CEO는 이 결재를 읽지 못해 update가 0행이다 — 읽는 대표로 잰다.)
  await assert.rejects(as(AC.chair, `update decisions set title = '고침' where decision_id = 'dec_59old'`), /approval_closed_frozen/, '0059: 0059 전에 끝난 결재의 제목을 고친다')
  await assert.rejects(as(AC.chair, `update decisions set status = 'Rejected' where decision_id = 'dec_59old'`), /approval_closed_frozen/, '0059: 0059 전에 끝난 결재를 대표가 뒤집는다')
  // 결재선 위조 — 화면이 보낸 approval_line · created_by · step_chain은 버린다. approval_steps는 아무도 못 쓴다.
  await commitAs(AC.emp2, `insert into decisions (decision_id, business_id, title, template_key, form, created_by, approval_line, step_chain)
    values ('dec_59j', 'biz_dy', '위조', 'expense', '{"amount":"6000000","purpose":"x","spent_on":"2026-10-07"}', '${AC.emp1}',
            '[{"step":"boss","user_id":"${AC.emp2}","name":"나","why":"x"}]', false)`)
  const [j] = await owner<{ by: string; chain: boolean; line: ApprovalStep[] }>(`select created_by::text as by, step_chain as chain, approval_line as line from decisions where decision_id = 'dec_59j'`)
  assert.deepEqual([j.by, j.chain, j.line.filter((s) => s.step !== 'rule').map((s) => s.user_id)], [AC.emp2, true, [AC.lead, AC.chair]], '0059: 위조한 결재선 · 올린 사람이 남았다')
  for (const sql of [
    `insert into approval_steps (decision_id, seq, approver_user_id, approver_name, why, status) values ('dec_59j', 9, '${AC.emp2}', '나', 'x', 'pending')`,
    `update approval_steps set status = 'approved', decided_at = now() where decision_id = 'dec_59j' and seq = 1`,
    `update approval_steps set approver_user_id = '${AC.emp2}' where decision_id = 'dec_59j'`,
    `delete from approval_steps where decision_id = 'dec_59j'`,
  ]) {
    for (const who of [AC.emp2, AC.lead, AC.chair]) {
      await assert.rejects(as(who, sql), /permission denied/, `0059: 결재 단계를 직접 쓴다(${who}: ${sql.slice(0, 40)})`)
    }
  }
  // 기안자는 decisions update 권한이 없다(0002 decisions_decide = 승인권자) — 0행이거나 거부.
  // 0002 decisions_decide는 승인권자만 update를 연다 — 기안자의 update는 0행이어야 한다(다른 이유의 오류면 실패).
  const selfClose = await as<{ n: number }>(AC.emp2, `with u as (update decisions set status = 'Approved' where decision_id = 'dec_59j' returning 1) select count(*)::int as n from u`)
  assert.deepEqual(selfClose, [{ n: 0 }], '0059: 기안자가 자기 결재를 닫는다')
  // 0054 약속 재확인 — 비승인권자의 양식 없는 insert는 Open.
  assert.deepEqual(await as<{ s: string }>(AC.emp2, `select status::text as s from decisions where decision_id = 'dec_59k'`,
    `insert into decisions (decision_id, business_id, title, created_by, status, decided_by_kind) values ('dec_59k', 'biz_dy', '몰래', '${AC.emp2}', 'Approved', 'chairman')`),
    [{ s: 'Open' }], '0059: 직원이 양식 없는 결재를 «승인»으로 넣는다(0054 회귀)')

  // ── 다른 회사 ──
  await submit('dec_59v', AC.vana, 'leave')
  await assert.rejects(decide(AC.lead, 'dec_59v', true), /approval_not_found/, '0059: DY 팀장이 VANA 결재를 처리한다')
  await assert.rejects(decide(AC.vana, 'dec_59a', true), /approval_not_found/, '0059: VANA 직원이 DY 결재를 처리한다')
  await assert.rejects(decide(AC.ceo, 'dec_59v', true), /approval_not_found/, '0059: DY CEO가 VANA 결재를 처리한다')

  // ── 대표 «한 번에 승인» — 한 트랜잭션 · 건마다 감사 ──
  await submit('dec_59m', AC.emp1, 'expense', '200000')
  await submit('dec_59n', AC.emp1, 'leave')
  await assert.rejects(commitAs(AC.chair, `select approval_decide_many(array['dec_59m', 'dec_59n', 'dec_59j'], null)`), /approval_not_your_turn:dec_59j/,
    '0059: 한 번에 승인이 내 차례 아닌 건을 섞어도 된다(또는 어느 건인지 말하지 않는다)')
  assert.deepEqual([(await dec('dec_59m')).status, (await dec('dec_59n')).status], ['Open', 'Open'], '0059: 한 번에 승인이 일부만 반영됐다(한 트랜잭션이 아니다)')
  assert.deepEqual(await commitAs(AC.chair, `select approval_decide_many(array['dec_59m', 'dec_59n', 'dec_59a'], null) as n`), [{ n: 3 }])
  assert.deepEqual([(await dec('dec_59m')).status, (await dec('dec_59n')).status, (await dec('dec_59a')).status], ['Approved', 'Approved', 'Approved'])
  assert.equal((await owner(`select 1 from audit_log where entity_table = 'decisions' and entity_id in ('dec_59m', 'dec_59n', 'dec_59a') and action::text = 'approve' and actor_user_id = '${AC.chair}'`)).length, 3,
    '0059: 한 번에 승인의 감사가 건마다 남지 않는다')
  await assert.rejects(commitAs(AC.emp1, `select approval_decide_many(array['dec_59m'], null)`), /approval_not_found/, '0059: 결재선 밖 사람이 남의 결재를 한 번에 승인에 섞는다')

  // ── 결재 대장 열람 ──
  const seen = async (uid: string) => (await as<{ id: string }>(uid, `select decision_id as id from decisions where template_key is not null and decision_id like 'dec_59%' order by 1`)).map((r) => r.id)
  const dyAll = (await owner<{ id: string }>(`select decision_id as id from decisions where template_key is not null and business_id = 'biz_dy' and decision_id like 'dec_59%' order by 1`)).map((r) => r.id)
  const all = (await owner<{ id: string }>(`select decision_id as id from decisions where template_key is not null and decision_id like 'dec_59%' order by 1`)).map((r) => r.id)
  assert.deepEqual(await seen(AC.chair), all, '0059: 대표가 양식 결재 전부를 못 본다')
  assert.deepEqual(await seen(AC.clerk), dyAll, '0059: «DY 결재 대장 열람»이 DY 양식 결재 전부를 못 본다')
  assert.ok(!(await seen(AC.clerk)).includes('dec_59v'), '0059: DY 대장 권한이 VANA 결재를 연다')
  assert.deepEqual(await seen(AC.nobody), [], '0059: 권한 없는 사람의 대장이 0건이 아니다')
  assert.deepEqual(await seen(AC.vana), ['dec_59v'], '0059: VANA 직원이 남의 결재를 본다')
  const leadSees = await seen(AC.lead)
  assert.ok(leadSees.includes('dec_59b') && leadSees.includes('dec_59d') && !leadSees.includes('dec_59a'), `0059: 결재선에 든 팀장의 열람 범위가 다르다(${leadSees})`)
  // emp3은 자기 것만 — 같은 회사 동료(emp2)의 결재는 못 본다.
  const emp3Sees = await seen(AC.emp3)
  assert.ok(emp3Sees.every((id) => ['dec_59d', 'dec_59d2', 'dec_59p'].includes(id)), `0059: 직원이 동료의 결재를 본다(${emp3Sees})`)
  // 단계도 결재가 보이는 만큼만.
  assert.deepEqual(await as(AC.nobody, `select 1 from approval_steps where decision_id like 'dec_59%'`), [], '0059: 권한 없는 사람이 결재 단계를 본다')
  assert.equal((await as(AC.clerk, `select 1 from approval_steps where decision_id = 'dec_59c'`)).length, 2, '0059: 대장 권한자가 결재 단계를 못 본다')
  // 시스템 계정은 줄이 있어도 못 쓴다. 대장 권한은 회장만 준다(0002 module_access_admin_write).
  await owner(`insert into user_module_access (user_id, module, can_write) values ('${AC.agent}', '/approvals/ledger/biz_dy', false)`)
  assert.deepEqual(await as(AC.agent, `select approval_ledger_grant('biz_dy') as g`), [{ g: false }], '0059: 시스템 계정이 대장 권한을 쓴다')
  await assert.rejects(as(AC.clerk, `select 1`, `insert into user_module_access (user_id, module, can_write) values ('${AC.nobody}', '/approvals/ledger/biz_dy', false)`),
    /row-level security/, '0059: 회장이 아닌 사람이 대장 권한을 준다')
  await commitAs(AC.chair, `insert into user_module_access (user_id, module, can_write) values ('${AC.nobody}', '/approvals/ledger/biz_dy', false)`)
  await owner(`select module_grant_audit('${AC.nobody}', '/approvals/ledger/biz_dy', null, '{"can_write":false}', 'x')`)
  assert.deepEqual(await owner(`select business_id from audit_log where entity_table = 'user_module_access' and entity_id = '${AC.nobody}' order by occurred_at desc limit 1`), [{ business_id: 'biz_dy' }],
    '0059: 대장 권한 감사 줄에 회사가 없다')
  assert.deepEqual(await seen(AC.nobody), dyAll, '0059: 대표가 준 대장 권한이 바로 열리지 않는다')
  // 대장 내려받기 감사.
  await commitAs(AC.clerk, `select approval_ledger_log('biz_dy', 12, '{"period":"month"}')`)
  assert.equal((await owner(`select 1 from audit_log where action::text = 'download' and entity_id = 'ledger' and actor_user_id = '${AC.clerk}' and business_id = 'biz_dy'`)).length, 1, '0059: 대장 내려받기 감사가 없다')
  await assert.rejects(commitAs(AC.clerk, `select approval_ledger_log('biz_vana', 1, null)`), /approval_not_found/, '0059: 다른 회사 대장 내려받기를 기록한다')

  // ── 리뷰 M2 — 결재선 밖 사람에게는 있는지 · 열렸는지 말하지 않는다 ──
  await assert.rejects(decide(AC.nobody, 'dec_59d2', true), /approval_not_found/, '0059: 결재선 밖 같은 회사 사람에게 결재의 상태를 말한다(M2)')
  await assert.rejects(decide(AC.nobody, 'dec_59b', true), /approval_not_found/, '0059: 결재선 밖 사람에게 끝난 결재를 말한다(M2)')
  // ── 리뷰 M3 — 내려받기 감사는 대표 · 대장 권한자만 ──
  await assert.rejects(commitAs(AC.emp2, `select approval_ledger_log('biz_dy', 1, null)`), /approval_not_found/, '0059: 대장 권한 없는 사람이 내려받기 감사를 적는다(M3)')
  await assert.rejects(commitAs(AC.clerk, `select approval_ledger_log(null, 1, null)`), /approval_not_found/, '0059: 대장 권한자가 회사 없이 내려받기 감사를 적는다(M3)')
  await commitAs(AC.chair, `select approval_ledger_log(null, 3, '{}')`)

  // ── 리뷰 I1 — 양식 결재의 첨부: 열린 결재에 올린 사람 · 지금 차례만, 끝난 결재는 아무도 ──
  const attach = (id: string) => `insert into attachments (entity_table, entity_id, file_name, mime, size_bytes, security_class)
     values ('decisions', '${id}', 'r.pdf', 'application/pdf', 10, 'Normal')`
  await assert.rejects(as(AC.emp2, 'select 1', attach('dec_59b')), /row-level security/, '0059: 끝난 결재에 기안자가 증빙을 붙인다(I1)')
  await assert.rejects(as(AC.chair, 'select 1', attach('dec_59b')), /row-level security/, '0059: 끝난 결재에 대표가 증빙을 붙인다(I1)')
  await assert.rejects(as(AC.clerk, 'select 1', attach('dec_59d2')), /row-level security/, '0059: 대장 열람자가 남의 결재에 파일을 붙인다(I1)')
  await assert.rejects(as(AC.lead, 'select 1', attach('dec_59d2')), /row-level security/, '0059: 아직 차례가 아닌 결재자가 파일을 붙인다(I1)')
  assert.deepEqual(await as(AC.emp3, `select count(*)::int as n from attachments where entity_id = 'dec_59d2'`, attach('dec_59d2')), [{ n: 1 }], '0059: 기안자가 열린 결재에 파일을 못 붙인다(I1)')
  assert.deepEqual(await as(AC.mid, `select count(*)::int as n from attachments where entity_id = 'dec_59d2'`, attach('dec_59d2')), [{ n: 1 }], '0059: 지금 차례 결재자가 파일을 못 붙인다(I1)')
  await owner(`insert into attachments (entity_table, entity_id, file_name, mime, size_bytes, security_class, uploaded_by)
     values ('decisions', 'dec_59b', 'old.pdf', 'application/pdf', 10, 'Normal', '${AC.emp2}')`)
  assert.deepEqual(await as(AC.emp2, `with x as (delete from attachments where entity_id = 'dec_59b' returning 1) select count(*)::int as n from x`), [{ n: 0 }],
    '0059: 끝난 결재의 증빙을 기안자가 지운다(I1)')

  // ── 리뷰 I2 — 회사 접근을 잃은 첫 칸 상사는 더 못 읽는다(0042 decisions_lead_read에 회사 격리) ──
  assert.equal((await as(AC.mid, `select 1 from decisions where decision_id = 'dec_59d2'`)).length, 1, '0059 전제: 첫 칸 상사가 결재를 못 읽는다')
  await owner(`delete from user_business_access where user_id = '${AC.mid}' and business_id = 'biz_dy'`)
  assert.deepEqual(await as(AC.mid, `select 1 from decisions where decision_id = 'dec_59d2'`), [], '0059: 회사 접근을 잃은 상사가 결재를 읽는다(I2)')
  assert.deepEqual(await as(AC.mid, `select 1 from approval_steps where decision_id = 'dec_59d2'`), [], '0059: 회사 접근을 잃은 상사가 결재 단계를 읽는다(I2)')
  await owner(`insert into user_business_access values ('${AC.mid}', 'biz_dy')`)

  // ── 리뷰 M1 — «떠남»으로만 표시된(회수 전) 결재자는 처리하지 못하고, 그 칸은 대표가 대리한다 ──
  await submit('dec_59q', AC.emp2, 'expense', '100000')
  await owner(`alter table user_profiles disable trigger user`)
  await owner(`update user_profiles set status = 'left' where user_id = '${AC.lead}'`)
  await owner(`alter table user_profiles enable trigger user`)
  await assert.rejects(decide(AC.lead, 'dec_59q', true), /approval_not_your_turn/, '0059: 떠남으로 표시된 결재자가 처리한다(M1)')
  assert.equal(await decide(AC.chair, 'dec_59q', true), 'approved', '0059: 떠남으로 표시된 결재자의 칸을 대표가 대리하지 못한다')
  await owner(`alter table user_profiles disable trigger user`)
  await owner(`update user_profiles set status = 'active' where user_id = '${AC.lead}'`)
  await owner(`alter table user_profiles enable trigger user`)

  // ── 대표 대리 — 결재자가 떠나면 대표만 그 칸을 처리한다 ──
  await submit('dec_59p', AC.emp3, 'expense', '100000')
  await assert.rejects(decide(AC.chair, 'dec_59p', true), /approval_not_your_turn/, '0059 전제: 살아 있는 결재자의 칸을 대표가 처리한다')
  await owner(`update user_profiles set revoked_at = now(), status = 'left' where user_id = '${AC.mid}'`)
  await assert.rejects(decide(AC.lead, 'dec_59p', true), /approval_not_found|approval_not_your_turn/, '0059: 떠난 결재자의 칸을 다른 상사가 처리한다')
  assert.equal(await decide(AC.chair, 'dec_59p', true), 'approved', '0059: 떠난 결재자의 칸을 대표가 대신 처리하지 못한다')
  assert.equal((await owner(`select 1 from audit_log where entity_id = 'dec_59p' and note like '%대표 대리%'`)).length, 1, '0059: 대표 대리가 감사에 남지 않는다')
  await owner(`update user_profiles set revoked_at = null, status = 'active' where user_id = '${AC.mid}'`)

  // ── 카탈로그: force 없음 · 내부 함수 잠금 ──
  assert.deepEqual(await owner(`select relname, relforcerowsecurity as f from pg_class where relname in ('decisions', 'approval_steps') order by 1`),
    [{ relname: 'approval_steps', f: false }, { relname: 'decisions', f: false }], '0059: force가 새로 걸렸다(0035 함정)')
  for (const fn of ['user_has_business(uuid, text)', 'approval_boss_chain(uuid, text)', 'approval_chairman()', 'decisions_steps_create()']) {
    assert.deepEqual(await owner(`select has_function_privilege('authenticated', '${fn}', 'execute') as a, has_function_privilege('anon', '${fn}', 'execute') as b`),
      [{ a: false, b: false }], `0059: 내부 함수 ${fn}가 RPC로 열렸다`)
  }
  for (const fn of ['approval_decide(text, boolean, text)', 'approval_decide_many(text[], text)', 'my_approval_chain(text)', 'approval_ledger_log(text, integer, jsonb)']) {
    assert.deepEqual(await owner(`select has_function_privilege('anon', '${fn}', 'execute') as b`), [{ b: false }], `0059: ${fn}가 anon에게 열렸다`)
  }
  await db.close()
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
  await attachments()
  await aiAssistant()
  await financeGrants()
  await documentGrants()
  await staffTerms()
  await approvalStaff()
  await staffAdmin()
  await approvalChain()
  console.log(
    `PASS: ${files.length} migrations (${files[0]} → ${files.at(-1)}), standard chart seed, sheet-only view, SQL view = TS ledger, RLS by role, books, kakao revoke + definer under non-bypassrls owner, hierarchy (class_rank/cycle/subtree/shares), subtree RLS (a~f + 회사 격리 회귀) + 0026 backfill, 0027 projects subtree (직원 자기 업무 회귀 + project_business_id keyhole), 0028 org screen (company_progress/company_people keyhole + 초대 칸 + Integration 이름), 0029 아침 알림 현지 시간(시간대 keyhole + 현지 날짜 장부 + user_settings force 해제), 0030 알림함·프로필·사이드바 주머니(revoke + 칸 단위 update + 개인 우편함 + update_own_profile + 이름 교정), 0032 프로필 사진(비공개 버킷 + 본인만 쓰기 — 회장도 남의 얼굴은 못 바꾼다 + 이름 가시성과 같은 읽기 범위 + 어긋난 이름 차단 + update_own_photo), 0045 첨부(대상 규칙 AND 등급 · Vault 회장+지정자 · anon 표/버킷/함수 잠금 · AIAgent/Integration restrictive · 올림/요약/삭제/내려받기/외부 AI 전송 감사 · 칸 단위 update · 모양 제약 · 버킷 정책 · ai_usage_log), 0046 AI 어시스턴트(제안은 늘 pending · 15분 · 확인은 주인만 한 번 만료 전 — 남 · 회장 · 상사 · 시스템 계정이 고정 id로 확인해도 그대로 · 감사 «AI 제안, <역할> 확인»은 본인+회장만 · update/delete grant 없음 · 시스템 계정 restrictive · anon 잠금), 0047 재무 모듈 권한(경영지원 팀장 기본 입력 · 자기 회사만 읽기/전표/공식 재무제표 · 마감은 can_approve만 · 줄 없는 TeamLead 0행 · 시스템 계정 불변 · 쓰기는 회장만 · 트리거 감사 · Vault 첨부 insert 차단), 0048 문서 모듈 권한(사람 × 회사 · 문서 · 폴더 쓰기 · 줄 없는 팀장 거부 · 회사 접근과 줄 둘 다 · 열람 등급 위 insert/update 차단 · 등록자는 본인 · 고치기 · 지우기는 자기 것만(회장 전부) · 주인 칸은 회장만 · 폴더는 만든 사람만 · 시스템 계정 불변 · 옛 /core/search 회귀 · 회수 감사 · hard delete 닫힘), 0049 직원 화면 용어(결재선 · 취합 제목 «회장»→«대표» 백필 — 사람 · 단계 · updated_at 그대로 · 얼림 재가동 · 새 결재선 · 감사 메모도 «대표»), 0054 첫 직원 결재(대표는 팀장 칸에 서지 않음 · 400만 «기록 완료» · 600만 대표 칸 Open · 대표 열람 · 비승인권자 insert는 Open · 새 직원/회장 되살림 «결재 올리기»(초대 이행 재부여는 PGlite 전용) · 금액 모양 · insert/update 처리자 고정 · dummy 거울), 0055 온보딩 위임(«DY 사용자 관리자» 줄 · 사원 · 팀장만 · Executive 거부 · 권한 ⊆ 관리자 · 마감 없음 · 상사 필수 · subtree 밖 상사 · 등급 · 다른 회사 · 가드 · 회장 알림 · 감사 · 가입 권한 재확인 · 남의 결재 못 봄 · 취소 · 능력 회수 · 아침 숫자 · BYPASSRLS 없는 소유자)`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
