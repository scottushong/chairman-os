/**
 * DY 구매팀 가격 리포트(0084) 검사 — npm run check:price-report. 진짜 AI · GitHub · Supabase 호출 0회.
 *
 *   ① PGlite 0001~0084 — 적재(가격 87 · 메모 1) · 읽기(대표 · 구매 · 임원 / 영업 · 생산 · 원가 관리 · 다른 회사 · anon 0) · 스위치 끄면 0 ·
 *      버튼(권한 없는 사람 거부 · 구매 읽기만 거부 · 수집 중 잠김 · 10분 · 하루 n번 · 천장 12 · 30분 넘은 실행 풀림 · 감사) ·
 *      AI Agent 외 쓰기 거부 · 범위 검사(884 원화 값 거부) · 정산은 장중이 안 덮음 · 사건 같은 제목 · 링크 한 번 · 새로 수 · 스크립트 든 html 거부 ·
 *      dispatch_failed는 자기 «대기»만 · 자동 회차 같은 날 바꿈
 *   ② 버튼 흐름(dummy + 가짜 GitHub) — 토큰 없음 문구 · 204 → «대기» · 500 → «실패» + 직전 리포트 그대로 · 완료 → 새 리포트 · 새 사건 수
 *   ③ 화면 규칙 — 잠김 이유 · 다음 자동 시각 · 안내 문 = DB 문
 *   ④ 엔진(python) — 메모 정화 · 범위 검사 · 스크립트 없는 html · 요약 카드 · 1회 비용(test_cost.py — 가짜 클라이언트 · low 최악 < $1)
 *   ⑤ 정적 — 워크플로(커밋 · push 없음 · schedule 없음(10-20) · preset 입력 · concurrency · dispatch 입력 · 비밀값 없음) · 되살릴 cron 두 줄은 반영 문서에 ·
 *      대표 홈 iframe 없음 · «회장» 없음
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

import { applyOne, MIGRATIONS, SUPABASE_STUBS } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000082a1',
  buy: '00000000-0000-0000-0000-0000000082a2', // 구매 입력(쓰기)
  buyRead: '00000000-0000-0000-0000-0000000082a3', // 구매 줄(읽기만)
  sales: '00000000-0000-0000-0000-0000000082a4',
  prod: '00000000-0000-0000-0000-0000000082a5',
  cost: '00000000-0000-0000-0000-0000000082a6', // 원가 관리 줄만
  exec: '00000000-0000-0000-0000-0000000082a7', // DY 임원
  other: '00000000-0000-0000-0000-0000000082a8', // 다른 회사 대표
  agent: '00000000-0000-0000-0000-0000000082a9', // AI Agent
}

let passed = 0
let failed = 0
async function group(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    passed++
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : String(e)}`)
  }
}

const HTML = '<!DOCTYPE html><html lang="ko"><body><h1>가짜 가격 리포트</h1><svg viewBox="0 0 10 10"></svg>' + '.'.repeat(120) + '</body></html>'

async function pglite() {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } })
  await db.exec(SUPABASE_STUBS + '\n alter default privileges in schema public grant all on functions to anon, authenticated;')
  await db.exec(`create extension if not exists pgcrypto with schema extensions; create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text not null, created_at timestamptz not null default now());
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, created_at from vault.secrets;
    insert into vault.secrets (name, secret) values ('cost_bom_key', encode(extensions.gen_random_bytes(32), 'base64'));`)
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) await applyOne(db, f)
  const owner = async <T,>(sql: string) => (await db.query<T>(sql)).rows
  const other = (await owner<{ b: string }>(`select business_id as b from businesses where business_id <> 'biz_dy' order by 1 limit 1`))[0].b
  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    insert into auth.users (id, email) values ${Object.values(U).map((u) => `('${u}', '${u.slice(-4)}@x')`).join(', ')};
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${U.chair}', 'Chairman', '대표', 'Vault'), ('${U.buy}', 'Member', '구매', 'Normal'), ('${U.buyRead}', 'Member', '구매 읽기', 'Normal'),
      ('${U.sales}', 'Member', '영업', 'Normal'), ('${U.prod}', 'Member', '생산', 'Normal'), ('${U.cost}', 'Member', '경영지원', 'Normal'),
      ('${U.exec}', 'Executive', '임원', 'Restricted'), ('${U.other}', 'BusinessCEO', '다른 회사 대표', 'Restricted'), ('${U.agent}', 'AIAgent', 'ai', 'Restricted');
    insert into user_business_access values ('${U.buy}', 'biz_dy'), ('${U.buyRead}', 'biz_dy'), ('${U.sales}', 'biz_dy'), ('${U.prod}', 'biz_dy'),
      ('${U.cost}', 'biz_dy'), ('${U.exec}', 'biz_dy'), ('${U.other}', '${other}');
    insert into user_module_access (user_id, module, can_write, can_approve) values
      ('${U.buy}', '/purchasing/biz_dy', true, false), ('${U.buyRead}', '/purchasing/biz_dy', false, false), ('${U.sales}', '/sales/biz_dy', true, false),
      ('${U.prod}', '/production/biz_dy', true, false), ('${U.cost}', '/costing/biz_dy', true, false), ('${U.other}', '/purchasing/${other}', true, false);
  `)
  const as = async <T,>(uid: string | null, sql: string) => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true); set local role ${uid ? 'authenticated' : 'anon'};`)
    try {
      const rows = (await db.query<T>(sql)).rows
      await db.exec('commit')
      return rows
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  const one = async <T,>(uid: string, sql: string) => (await as<T>(uid, sql))[0]
  const count = async (uid: string | null, table: string) => Number((await as<{ n: number }>(uid, `select count(*)::int as n from ${table}`))[0].n)
  const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)
  const age = (minutes: number) => owner(`update purchase_price_runs set created_at = created_at - interval '${minutes} minutes'`)

  await group('① 적재 — 1월~10/14 가격 87점 · 메모 1(seed_v2) · 두 번 돌려도 그대로', async () => {
    assert.equal(Number((await owner<{ n: number }>(`select count(*)::int as n from purchase_price_points`))[0].n), 87)
    assert.equal(Number((await owner<{ n: number }>(`select count(*)::int as n from purchase_price_events where kind = 'memo'`))[0].n), 1)
    const seedSql = readFileSync(join(MIGRATIONS, '0084_purchase_price_report.sql'), 'utf8')
    const load = seedSql.slice(seedSql.indexOf('insert into purchase_price_points (business_id'), seedSql.lastIndexOf('commit;'))
    await db.exec(load)
    assert.equal(Number((await owner<{ n: number }>(`select count(*)::int as n from purchase_price_points`))[0].n), 87, '적재를 두 번 돌리니 늘었다')
  })

  await group('① 읽기 — 대표 · 구매(쓰기 · 읽기) · 임원 = 보임 / 영업 · 생산 · 원가 관리 · 다른 회사 · AI 아닌 anon = 0', async () => {
    for (const u of [U.chair, U.buy, U.buyRead, U.exec, U.agent]) assert.equal(await count(u, 'purchase_price_points'), 87, `${u} 가격을 못 본다`)
    for (const u of [U.sales, U.prod, U.cost, U.other]) {
      assert.equal(await count(u, 'purchase_price_points'), 0, `${u}가 가격을 본다`)
      assert.equal(await count(u, 'purchase_price_events'), 0, `${u}가 사건을 본다`)
      assert.equal(await count(u, 'purchase_price_reports'), 0, `${u}가 리포트를 본다`)
    }
    await refuses(as(null, `select count(*) from purchase_price_points`), /permission denied/, 'anon이 가격 표를 읽었다')
    const anonGrants = await owner<{ n: number }>(`select count(*)::int as n from information_schema.role_table_grants where grantee = 'anon' and table_name like 'purchase_price_%'`)
    assert.equal(Number(anonGrants[0].n), 0, 'anon 표 grant가 있다')
    const fnAnon = await owner<{ f: string }>(`select p.proname as f from pg_proc p where p.proname like 'price_report%' and has_function_privilege('anon', p.oid, 'execute')`)
    assert.deepEqual(fnAnon, [], `anon이 부를 수 있는 함수: ${JSON.stringify(fnAnon)}`)
    const pol = await owner<{ r: string }>(`select array_to_string(roles, ',') as r from pg_policies where tablename like 'purchase_price_%'`)
    assert.ok(pol.length === 4 && pol.every((p) => p.r === 'authenticated'), `정책은 to authenticated 넷: ${JSON.stringify(pol)}`)
    for (const t of ['purchase_price_runs', 'purchase_price_reports', 'purchase_price_points', 'purchase_price_events']) {
      await refuses(as(U.chair, `insert into ${t} (business_id) values ('biz_dy')`), /permission denied/, `대표가 ${t}에 직접 썼다`)
    }
  })

  await group('① AI Agent만 쓴다 — 리포트 · 가격 · 사건 · 시작 · 실패 모두 사람 거부', async () => {
    for (const u of [U.chair, U.buy]) {
      await refuses(as(u, `select price_report_agent_begin('biz_dy', null, 'AM')`), /price_report_agent_only/, '사람이 수집 시작')
      await refuses(as(u, `select price_report_agent_points('biz_dy', '[]'::jsonb)`), /price_report_agent_only/, '사람이 가격을 넣었다')
      await refuses(as(u, `select price_report_agent_events('biz_dy', null, 'AM', '[]'::jsonb)`), /price_report_agent_only/, '사람이 사건을 넣었다')
      await refuses(as(u, `select price_report_agent_fail(gen_random_uuid(), 'x')`), /price_report_agent_only/, '사람이 실패 처리')
    }
  })

  await group('① 범위 검사 · 정산 우선 · 사건 한 번 · 새로 수 · 스크립트 html 거부 · 자동 회차 같은 날 바꿈', async () => {
    // 오피넷 원화표 혼동(884 같은 값) — 통째로 거부
    await refuses(as(U.agent, `select price_report_agent_points('biz_dy', '[{"series":"opinet_naphtha_bbl","date":"2026-10-15","value":884,"kind":"settle"}]'::jsonb)`), /purchase_price_points_range/, '884 원화 값이 들어갔다')
    await refuses(as(U.agent, `select price_report_agent_points('biz_dy', '[{"series":"naphtha_cfd","date":"2026-10-15","value":95,"kind":"settle"}]'::jsonb)`), /purchase_price_points_range/, '$/bbl 값이 나프타 CFD($/톤)로 들어갔다')
    // 10/13 brent 정산을 장중이 덮지 않는다
    const before = (await owner<{ v: string; k: string }>(`select value::text as v, kind as k from purchase_price_points where series = 'brent' and point_date = '2026-10-13'`))[0]
    assert.equal(before?.k, 'settle', '시험 전제: 10/13 Brent 정산')
    const n = (await one<{ n: number }>(U.agent, `select price_report_agent_points('biz_dy', '[{"series":"brent","date":"2026-10-13","value":111,"kind":"intraday"},{"series":"brent","date":"2026-10-15","value":104.5,"kind":"intraday"}]'::jsonb) as n`)).n
    assert.equal(Number(n), 1, '바뀐 줄 수가 1(새 날짜)이 아니다')
    const after = (await owner<{ v: string; k: string }>(`select value::text as v, kind as k from purchase_price_points where series = 'brent' and point_date = '2026-10-13'`))[0]
    assert.deepEqual(after, before, '장중값이 정산을 덮었다')
    // 자동 회차 — 시작 · 사건 · 저장
    const run = (await one<{ id: string }>(U.agent, `select price_report_agent_begin('biz_dy', null, 'AM') as id`)).id
    await refuses(as(U.agent, `select price_report_agent_begin('biz_dy', null, 'PM')`), /price_report_busy/, '수집 중인데 두 번째 자동 실행')
    const ev = (t: string, u: string | null) => ({ kind: 'event', date: '2026-10-15', title: t, url: u })
    const e1 = (await one<{ n: number }>(U.agent, `select price_report_agent_events('biz_dy', '${run}', 'AM', '${JSON.stringify([ev('가짜 사건 하나', 'https://example.invalid/a'), ev('가짜  사건 하나 ', 'https://EXAMPLE.invalid/a'), ev('가짜 사건 둘', null), { kind: 'memo', date: '2026-10-15', title: '2026-10-15 AM', html: '<b>메모</b>' }])}'::jsonb) as n`)).n
    assert.equal(Number(e1), 2, '같은 제목 · 링크가 두 번 들어갔다(또는 새로 수가 틀림)')
    const e2 = (await one<{ n: number }>(U.agent, `select price_report_agent_events('biz_dy', '${run}', 'AM', '${JSON.stringify([ev('가짜 사건 하나', 'https://example.invalid/a'), { kind: 'memo', date: '2026-10-15', title: '2026-10-15 AM', html: '<b>메모 고침</b>' }])}'::jsonb) as n`)).n
    assert.equal(Number(e2), 0, '이미 있는 사건이 «새로»로 셌다')
    assert.equal(Number((await owner<{ n: number }>(`select count(*)::int as n from purchase_price_events where kind = 'memo'`))[0].n), 2, '같은 회차 메모가 두 줄')
    await refuses(as(U.agent, `select price_report_agent_save('${run}', '2026-10-15', 'ok', '${HTML.replace('<svg', '<script>alert(1)</script><svg')}', null, '{}', '[]', '[]', 2, 1)`), /check constraint/, '스크립트 든 html이 들어갔다')
    const rep = (await one<{ id: string }>(U.agent, `select price_report_agent_save('${run}', '2026-10-15', 'ok', '${HTML}', '요약', '{"cards":{}}', '[]', '[]', 2, 1) as id`)).id
    const runRow = (await owner<{ s: string; r: string; e: number }>(`select status as s, report_id::text as r, new_events as e from purchase_price_runs where run_id = '${run}'`))[0]
    assert.deepEqual(runRow, { s: 'done', r: rep, e: 2 })
    // 같은 날 AM 다시 → 바뀐다(하나)
    await age(20)
    const run2 = (await one<{ id: string }>(U.agent, `select price_report_agent_begin('biz_dy', null, 'AM') as id`)).id
    await as(U.agent, `select price_report_agent_save('${run2}', '2026-10-15', 'unconfirmed', '${HTML}', null, '{}', '[]', '["오피넷 미게시"]', 0, 0)`)
    assert.equal(Number((await owner<{ n: number }>(`select count(*)::int as n from purchase_price_reports where report_date = '2026-10-15' and slot = 'AM'`))[0].n), 1, '같은 날 AM이 두 개')
    assert.equal(await count(U.buy, 'purchase_price_reports'), 1)
  })

  await group('① 버튼 — 권한 · 수집 중 잠김 · 10분 · 하루 n번 · 천장 12 · 30분 풀림 · 감사 · dispatch_failed는 자기 것만', async () => {
    await age(20)
    for (const u of [U.sales, U.prod, U.cost, U.buyRead, U.exec, U.other, U.agent]) {
      await refuses(as(u, `select price_report_request('biz_dy', 6)`), /price_report_denied/, `${u}가 버튼을 눌렀다`)
    }
    await refuses(as(null, `select price_report_request('biz_dy', 6)`), /permission denied/, 'anon이 버튼 함수를 불렀다')
    const r1 = (await one<{ id: string }>(U.buy, `select price_report_request('biz_dy', 2) as id`)).id
    await refuses(as(U.chair, `select price_report_request('biz_dy', 2)`), /price_report_busy/, '대기 중인데 또 눌렀다')
    assert.equal(Number((await one<{ ok: boolean }>(U.chair, `select price_report_dispatch_failed('${r1}', 'x')::int as ok`)).ok), 0, '남의 대기를 실패로 바꿨다')
    assert.equal((await one<{ ok: boolean }>(U.buy, `select price_report_dispatch_failed('${r1}', 'GitHub 실행 요청 실패(HTTP 500)') as ok`)).ok, true)
    await refuses(as(U.buy, `select price_report_request('biz_dy', 2)`), /price_report_too_soon/, '10분 안에 다시 눌렀다')
    await age(11)
    const r2 = (await one<{ id: string }>(U.buy, `select price_report_request('biz_dy', 2) as id`)).id
    await as(U.agent, `select price_report_agent_begin('biz_dy', '${r2}', 'manual')`)
    await refuses(as(U.agent, `select price_report_agent_begin('biz_dy', '${r2}', 'manual')`), /price_report_run_state/, '같은 버튼 실행을 두 번 시작')
    await as(U.agent, `select price_report_agent_save('${r2}', '2026-10-15', 'ok', '${HTML}', null, '{}', '[]', '[]', 0, 0)`)
    await age(11)
    await refuses(as(U.buy, `select price_report_request('biz_dy', 2)`), /price_report_daily_limit/, '하루 2번을 넘었다')
    const r3 = (await one<{ id: string }>(U.chair, `select price_report_request('biz_dy', 99) as id`)).id // 앱 env가 99여도 천장 12
    assert.ok(r3)
    // 30분 넘은 «대기»는 실패로 풀린다
    await age(31)
    const r4 = (await one<{ id: string }>(U.chair, `select price_report_request('biz_dy', 99) as id`)).id
    const stale = (await owner<{ s: string }>(`select status as s from purchase_price_runs where run_id = '${r3}'`))[0].s
    assert.equal(stale, 'failed', '30분 넘은 대기가 풀리지 않았다')
    for (let i = 0; i < 12; i++) {
      await owner(`update purchase_price_runs set status = 'failed', created_at = created_at - interval '11 minutes'`)
      try {
        await as(U.chair, `select price_report_request('biz_dy', 99)`)
      } catch (e) {
        assert.match(String(e), /price_report_daily_limit/)
        break
      }
    }
    const manual = Number((await owner<{ n: number }>(`select count(*)::int as n from purchase_price_runs where trigger = 'manual' and (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date`))[0].n)
    assert.ok(manual <= 12, `천장 12를 넘었다(${manual})`)
    const audit = await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'purchase_price_runs' and note like '%지금 업데이트%' and actor_user_id in ('${U.buy}', '${U.chair}')`)
    assert.ok(Number(audit[0].n) >= 4, '누가 눌렀는지 감사가 없다')
    void r4
  })

  await group('① 스위치 끄면 — 대표도 0행 · 버튼 거부(AI Agent는 계속 쓴다)', async () => {
    await as(U.chair, `select feature_switch_set('purchase_price_report', null, false, 'all', '시험')`)
    for (const u of [U.chair, U.buy, U.exec]) assert.equal(await count(u, 'purchase_price_points'), 0, `${u}: 끈 뒤에도 보인다`)
    await owner(`update purchase_price_runs set status = 'failed', created_at = created_at - interval '2 days'`)
    await refuses(as(U.chair, `select price_report_request('biz_dy', 6)`), /price_report_denied/, '끈 뒤에 버튼')
    assert.equal(await count(U.agent, 'purchase_price_points'), 88)
    await as(U.chair, `select feature_switch_set('purchase_price_report', null, true, 'all', '시험 끝')`)
  })
}

async function buttonFlow() {
  process.env.NEXT_PUBLIC_DATA_MODE = 'dummy'
  const { dummyRepository: repo } = await import('../src/lib/repository/dummy')
  const { dummyPriceAgent, resetDummyPriceReport } = await import('../src/lib/repository/dummy-price-report')
  const { requestPriceReport, pollPriceReport } = await import('../src/lib/price-report/request')
  const calls: { url: string; body: string }[] = []
  const gh = (status: number) => (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') })
    return new Response(null, { status })
  }) as typeof fetch

  await group('② 버튼(dummy · 가짜 GitHub) — 토큰 없음 · 204 · 500 · 완료 · 실패 · 권한', async () => {
    resetDummyPriceReport()
    process.env.DUMMY_USER = 'chairman'
    delete process.env.GITHUB_DISPATCH_TOKEN
    delete process.env.PRICE_REPORT_AUTO
    assert.match((await requestPriceReport(repo, 'biz_dy', 6, gh(204))).error ?? '', /설정 전 — 업데이트 버튼/, '자동이 꺼졌는데 «자동 업데이트만 됩니다»')
    process.env.PRICE_REPORT_AUTO = '1'
    assert.match((await requestPriceReport(repo, 'biz_dy', 6, gh(204))).error ?? '', /설정 전 — 자동 업데이트/)
    delete process.env.PRICE_REPORT_AUTO
    assert.equal(calls.length, 0, '토큰 없이 GitHub를 불렀다')
    process.env.GITHUB_DISPATCH_TOKEN = 'test-token-not-real'
    const before = await repo.getPriceReport('biz_dy')
    // 500 → 실행 «실패» + 직전 리포트 그대로
    const bad = await requestPriceReport(repo, 'biz_dy', 6, gh(500))
    assert.match(bad.error ?? '', /HTTP 500/)
    const failed = (await repo.listPriceRuns('biz_dy')).find((r) => r.run_id === bad.runId)
    assert.equal(failed?.status, 'failed')
    assert.equal((await repo.getPriceReport('biz_dy'))?.report_id, before?.report_id, '실패했는데 리포트가 바뀌었다')
    // 10분 안 → 거부
    assert.match((await requestPriceReport(repo, 'biz_dy', 6, gh(204))).error ?? '', /10분/)
    dummyPriceAgent().age(bad.runId!, 11)
    const ok = await requestPriceReport(repo, 'biz_dy', 6, gh(204))
    assert.ok(ok.runId && !ok.error, `204인데 실패: ${ok.error}`)
    const sent = calls[calls.length - 1]
    assert.match(sent.url, /\/actions\/workflows\/macro-briefing\.yml\/dispatches$/)
    assert.deepEqual(JSON.parse(sent.body).inputs, { run_id: ok.runId, slot: 'manual' })
    assert.match((await requestPriceReport(repo, 'biz_dy', 6, gh(204))).error ?? '', /수집 중/, '수집 중인데 잠기지 않았다')
    // 완료 → 새 리포트 · 새 사건 수 · «새로»
    dummyPriceAgent().begin(ok.runId!)
    const done = dummyPriceAgent().complete(ok.runId!, { events: [{ title: '가짜 새 사건', url: 'https://example.invalid/n' }, { title: '아람코 다란 «제한적 화재» — 생산 영향 미보고', url: 'https://example.invalid/aramco' }] })
    const poll = await pollPriceReport(repo, 'biz_dy', ok.runId!)
    assert.deepEqual([poll.status, poll.reportId, poll.newEvents], ['done', done.report_id, 1], '완료 상태 · 새 사건 수(중복 빼고 1)')
    assert.equal((await repo.getPriceReport('biz_dy'))?.report_id, done.report_id, '완료 뒤 최신이 새 리포트가 아니다')
    assert.equal((await repo.listPriceEvents('biz_dy')).filter((e) => e.first_run === ok.runId).length, 1, '«새로» 표시 수')
    // 권한 — 영업 · 원가 관리 자리
    for (const who of ['sales_staff']) {
      process.env.DUMMY_USER = who
      assert.equal((await repo.listPriceReports('biz_dy')).length, 0, `${who}가 리포트를 본다`)
      dummyPriceAgent().age(ok.runId!, 11)
      assert.match((await requestPriceReport(repo, 'biz_dy', 6, gh(204))).error ?? '', /권한/, `${who}가 버튼을 눌렀다`)
    }
    process.env.DUMMY_USER = 'chairman'
  })
}

async function rules() {
  const { autoScheduleOn, buttonLock, canReadPriceReport, canRequestPriceReport, nextAutoKst } = await import('../src/lib/price-report/rules')
  await group('③ 화면 규칙 — 잠김 이유 · 다음 자동 · 안내 문(DB 문과 같은 사람)', () => {
    const t = Date.parse('2026-10-15T01:00:00Z') // KST 10:00
    const run = (o: Partial<{ status: string; trigger: string; created_at: string }>) => ({ run_id: 'x', trigger: 'manual', slot: 'manual', requested_by: null, status: 'done', created_at: '2026-10-14T00:00:00Z', started_at: null, finished_at: null, error: null, report_id: null, new_events: null, points: null, ...o }) as never
    assert.match(buttonLock([run({ status: 'collecting', created_at: '2026-10-15T00:55:00Z' })], 6, t) ?? '', /수집 중/)
    assert.match(buttonLock([run({ created_at: '2026-10-15T00:55:00Z' })], 6, t) ?? '', /5분 뒤/)
    assert.match(buttonLock(Array.from({ length: 6 }, () => run({ created_at: '2026-10-15T00:20:00Z' })), 6, t) ?? '', /6번을 다 썼습니다/)
    // 10-20 schedule 뺌 — 자동 꺼짐이 기본, 꺼져 있으면 «다음 자동 회차»를 말하지 않는다
    delete process.env.PRICE_REPORT_AUTO
    assert.equal(autoScheduleOn(), false, '자동 회차 기본이 켜짐')
    assert.match(buttonLock(Array.from({ length: 6 }, () => run({ created_at: '2026-10-15T00:20:00Z' })), 6, t, false) ?? '', /내일 다시/)
    assert.match(buttonLock(Array.from({ length: 6 }, () => run({ created_at: '2026-10-15T00:20:00Z' })), 6, t, true) ?? '', /다음 자동 회차/)
    assert.equal(buttonLock([run({ status: 'collecting', created_at: '2026-10-15T00:10:00Z' }), run({ created_at: '2026-10-15T00:10:00Z' })], 6, t), null, '30분 넘은 수집 중이 잠근다')
    assert.equal(nextAutoKst(t).label, '10/15 18:00')
    assert.equal(nextAutoKst(Date.parse('2026-10-15T10:00:00Z')).label, '10/16 08:00')
    const u = (role: string, purchasing?: { write: boolean }) => ({ role, cost: { purchasing: purchasing ? { biz_dy: purchasing } : {}, costing: {}, sales: {}, production: {} } }) as never
    assert.equal(canReadPriceReport(u('Member', { write: false }), 'biz_dy'), true)
    assert.equal(canReadPriceReport(u('Member'), 'biz_dy'), false)
    assert.equal(canReadPriceReport(u('Executive'), 'biz_dy'), true)
    assert.equal(canReadPriceReport(u('AIAgent'), 'biz_dy'), false)
    assert.equal(canRequestPriceReport(u('Member', { write: false }), 'biz_dy'), false)
    assert.equal(canRequestPriceReport(u('Member', { write: true }), 'biz_dy'), true)
    assert.equal(canRequestPriceReport(u('Executive'), 'biz_dy'), false)
  })
}

async function engine() {
  await group('④ 엔진(python) — 메모 정화 · 범위 검사(884) · html에 스크립트 없음 · 요약 카드', () => {
    const code = `
import json, sys
sys.path.insert(0, 'macro/engine')
from briefing import render, collect
assert render.clean_note('<b>a</b><script>x</script><br><b onclick=1>c') == '<b>a</b>&lt;script&gt;x&lt;/script&gt;<br>&lt;b onclick=1&gt;c', render.clean_note('<b>a</b><script>x</script><br><b onclick=1>c')
try:
    collect.validate({'opinet_naphtha_bbl': [{'date': '2026-10-14', 'value': 884}]})
    raise SystemExit('884가 통과했다')
except ValueError:
    pass
svg = render.chart_svg([{'c': '#fff', 'd': [[1, 60, 'x<y'], [2, 70]]}], 55, 135, '$', True, 3, 2)
assert '<script' not in svg and 'x&lt;y' in svg
html = open('src/lib/repository/fixtures/price-report-sample.html', encoding='utf-8').read()
assert '<script' not in html.lower() and 'javascript:' not in html.lower() and '<svg' in html
print('ok')
`
    const r = spawnSync('python', ['-I', '-c', code], { encoding: 'utf8' })
    if (r.error) throw new Error(`python 없음: ${r.error.message}`)
    assert.equal(r.status, 0, `python 검사 실패: ${r.stderr || r.stdout}`)
    // supa.py — 가짜 PostgREST로 읽기 · 쓰기 순서 · 메모 정화 · javascript: 주소 버림 · «미확인»은 가격 수집 실패일 때만
    const t = spawnSync('python', ['-I', 'macro/engine/tests/test_supa.py'], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    assert.equal(t.status, 0, `supa.py 시험 실패: ${t.stderr || t.stdout}`)
    // 1회 비용 — 가짜 Anthropic 클라이언트(진짜 호출 0): low 요청 수 · 도구 천장 · 캐싱 · 요청 크기 · 상한값 최악 < $1
    const c = spawnSync('python', ['-I', 'macro/engine/tests/test_cost.py'], { encoding: 'utf8' })
    assert.equal(c.status, 0, `비용 시험 실패: ${c.stderr || c.stdout}`)
    console.log(`  ${c.stdout.trim().split('\n').pop()}`)
  })
}

async function statics() {
  await group('⑤ 정적 — 워크플로 · 대표 홈 · 문구 · 원가 경로 분리', () => {
    const wf = readFileSync('.github/workflows/macro-briefing.yml', 'utf8')
    assert.ok(!/git (push|commit)|contents: write|public\/macro/.test(wf), '워크플로가 저장소에 쓴다')
    // 10-20 — 자동 일정 없음(손으로만) · 비용 프리셋 입력 · 엔진에 넘김
    assert.ok(!/^\s*schedule:|^\s*- cron:/m.test(wf), '워크플로에 schedule(cron)이 살아 있다')
    assert.match(wf, /preset:[\s\S]*options: \[low, normal\][\s\S]*default: low/)
    assert.match(wf, /BRIEFING_PRESET: \$\{\{ github\.event\.inputs\.preset \|\| vars\.BRIEFING_PRESET \|\| 'low' \}\}/)
    const doc = readFileSync('docs/onboarding/release-price-report.md', 'utf8')
    assert.match(doc, /- cron: "0 23 \* \* \*"/, '반영 문서에 되살릴 cron(08시)이 없다')
    assert.match(doc, /- cron: "0 9 \* \* \*"/, '반영 문서에 되살릴 cron(18시)이 없다')
    assert.match(wf, /concurrency:\s*\n\s*group: macro-briefing/)
    assert.match(wf, /workflow_dispatch:[\s\S]*run_id:[\s\S]*slot:/)
    assert.match(wf, /python run\.py "\$\{args\[@\]\}"/)
    assert.ok(!/sk-ant-|eyJhbGci/.test(wf), '워크플로에 비밀값')
    const home = readFileSync('src/app/(dashboard)/page.tsx', 'utf8')
    assert.ok(!/price-report|macro\/latest/.test(home), '대표 홈에 가격 리포트가 들어갔다')
    const files = ['src/app/(dashboard)/purchasing/[business_id]/price-report/page.tsx', 'src/components/purchasing/price-report-bar.tsx', 'src/components/purchasing/price-report-summary.tsx', 'src/lib/price-report/rules.ts', 'src/lib/price-report/request.ts']
    for (const f of files) assert.ok(!/회장|Chairman OS/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), `${f}에 «회장»`)
    const frame = readFileSync('src/components/purchasing/price-report-frame.tsx', 'utf8')
    assert.match(frame, /sandbox="allow-same-origin"/)
    assert.ok(!/allow-scripts/.test(frame.replace(/\/\*[\s\S]*?\*\//g, '')), 'iframe이 스크립트를 연다')
    const sql = readFileSync(join(MIGRATIONS, '0084_purchase_price_report.sql'), 'utf8').replace(/--.*$/gm, '')
    assert.ok(!/cost_market_prices|insert into cost_/.test(sql), '0084가 원가 엔진 표에 쓴다')
    assert.ok(!/raise notice/i.test(sql))
    assert.ok(!/SERVICE_ROLE|service_role_key/i.test(readFileSync('macro/engine/briefing/supa.py', 'utf8').replace(/"""[\s\S]*?"""/g, '')), '엔진이 service_role 키를 읽는다')
  })
}

async function main() {
  await pglite()
  await buttonFlow()
  await rules()
  await engine()
  await statics()
  console.log(failed ? `FAIL: ${failed}개 실패 · ${passed}개 통과` : `PASS: check:price-report ${passed}묶음 — 진짜 AI · GitHub · Supabase 호출 0회`)
  if (failed) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
