/**
 * 0094 Investment Intelligence — DB 권한(PGlite). check-migrations.ts가 부른다.
 *   직원 · anon: 0행(또는 거부) · 쓰기 거부 / 지정자(«/investment» 줄): 읽기만 / 수집(Integration): 원천 insert · update, 기관 · 설정 못 고침 /
 *   AI 분석(AIAgent): 원천 읽기만(restrictive) / 대표: 손 입력 · 설정 / 누구도 delete 없음 / 감사 줄은 본인 이름이 박힌다 / 스위치 기본 줄.
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

export const U = {
  chair: '00000000-0000-0000-0000-0000000094a1',
  member: '00000000-0000-0000-0000-0000000094a2',
  designee: '00000000-0000-0000-0000-0000000094a3',
  integ: '00000000-0000-0000-0000-0000000094a4',
  agent: '00000000-0000-0000-0000-0000000094a5',
  cfo: '00000000-0000-0000-0000-0000000094a6',
}

export const SOURCE_TABLES = [
  'investment_sources', 'investment_collect_runs', 'securities', 'security_prices', 'security_corporate_actions',
  'etf_holdings', 'company_financials', 'company_metrics', 'investment_disclosures', 'investment_positions',
  'investment_position_changes', 'investment_settings', 'investment_managers', 'investment_audit_logs',
]

export async function investmentDbSetup(upTo?: string) {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db, upTo)
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ${Object.values(U).map((id, i) => `('${id}', 'inv${i}@x')`).join(', ')};
    insert into user_profiles (user_id, role, display_name, max_security_class) values
      ('${U.chair}', 'Chairman', '대표', 'Vault'), ('${U.member}', 'Member', '직원', 'Normal'), ('${U.designee}', 'TeamLead', '지정자', 'Normal'),
      ('${U.integ}', 'Integration', 'sync', 'Restricted'), ('${U.agent}', 'AIAgent', 'ai', 'Restricted'), ('${U.cfo}', 'GroupCFO', 'cfo', 'Restricted');
    insert into user_module_access (user_id, module, can_write) values ('${U.designee}', '/investment', false);
  `)
  /** uid 세션으로 sql — 거부되면 오류 문장을 돌려준다(던지지 않음). anon은 uid=null. */
  const as = async <T = Record<string, unknown>>(uid: string | null, sql: string): Promise<{ rows: T[]; error: string | null; affected: number }> => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true); set local role ${uid ? 'authenticated' : 'anon'};`)
    try {
      const r = await db.query<T>(sql)
      await db.exec('commit')
      return { rows: r.rows, error: null, affected: r.affectedRows ?? 0 }
    } catch (e) {
      await db.exec('rollback')
      return { rows: [], error: (e as Error).message, affected: 0 }
    }
  }
  return { db, as }
}

export async function investmentDb(): Promise<string> {
  const { db, as } = await investmentDbSetup()
  const must = async (uid: string | null, sql: string) => {
    const r = await as(uid, sql)
    assert.equal(r.error, null, `거부되면 안 됨: ${sql.slice(0, 120)} — ${r.error}`)
    return r
  }
  const deny = async (uid: string | null, sql: string, what: string) => {
    const r = await as(uid, sql)
    assert.ok(r.error !== null || r.affected === 0, `${what}: 막혀야 함 — ${sql.slice(0, 120)}`)
  }

  // 수집 계정이 원천을 쓴다
  const sec = (await must(U.integ, `insert into securities (kind, name, ticker, cusip, source) values ('stock', 'APPLE INC', 'AAPL', '037833100', 'sec13f') returning security_id`)).rows[0] as { security_id: string }
  const dis = (await must(U.integ, `insert into investment_disclosures (manager_id, source_id, source_type, doc_key, data_as_of, source_published_at, source_url, coverage) values ('berkshire', 'sec13f:berkshire', 'sec_13f', '0000000001-26-000001', '2026-06-30', '2026-08-14', 'https://www.sec.gov/x', '13F') returning disclosure_id`)).rows[0] as { disclosure_id: string }
  await must(U.integ, `insert into investment_positions (disclosure_id, line_no, holding_key, issuer_name, cusip, security_id, shares, value) values ('${dis.disclosure_id}', 1, '037833100', 'APPLE INC', '037833100', '${sec.security_id}', 10, 100)`)
  await must(U.integ, `insert into investment_position_changes (manager_id, source_id, to_disclosure, holding_key, issuer_name, status, basis, calculation_version) values ('berkshire', 'sec13f:berkshire', '${dis.disclosure_id}', '037833100', 'APPLE INC', 'NEW', 'shares', 'chg-1.0')`)
  await must(U.integ, `insert into security_prices (security_id, d, close, source) values ('${sec.security_id}', '2026-06-30', 10, 'sec13f_implied')`)
  await must(U.integ, `insert into company_financials (security_id, cik, taxonomy, concept, unit, period_end, period_key, accession, value, source_url) values ('${sec.security_id}', '0000320193', 'us-gaap', 'Revenues', 'USD', '2025-12-31', '|2025-12-31', 'a', 1, 'https://x')`)
  await must(U.integ, `update investment_sources set status = 'LIVE', last_success_at = now() where source_id = 'sec13f:berkshire'`)
  await must(U.integ, `insert into investment_collect_runs (trigger) values ('cron')`)
  await must(U.integ, `insert into investment_audit_logs (action, entity) values ('collect.run', 'investment_collect_runs')`)
  const stamp = (await db.query<{ actor: string; actor_role: string }>(`select actor::text, actor_role from investment_audit_logs order by log_id desc limit 1`)).rows[0]
  assert.equal(stamp.actor, U.integ, '감사 줄 행위자는 세션 본인')
  assert.equal(stamp.actor_role, 'Integration')

  // 수집 계정 — 기관 · 설정은 못 고친다, 지우기 없음
  await deny(U.integ, `update investment_settings set collect_daily_limit = 5000`, '수집 계정 설정 고치기')
  await deny(U.integ, `update investment_managers set signal_weight = 1 where manager_id = 'nbim'`, '수집 계정 기관 고치기')
  await deny(U.integ, `insert into investment_managers (manager_id, name, operator, official_url, style, coverage_note) values ('x', 'x', 'x', 'https://x', 'index', 'x')`, '수집 계정 기관 더하기')
  for (const t of ['investment_positions', 'investment_disclosures', 'securities', 'investment_position_changes', 'security_prices', 'investment_audit_logs']) {
    await deny(U.integ, `delete from ${t}`, `수집 계정 ${t} 지우기`)
    await deny(U.chair, `delete from ${t}`, `대표 ${t} 지우기`)
  }

  // AI 분석 계정 — 읽기만
  assert.equal((await must(U.agent, `select * from investment_positions`)).rows.length, 1)
  await deny(U.agent, `insert into securities (kind, name, source) values ('stock', 'X', 'ai')`, 'AI 계정 원천 쓰기')
  await deny(U.agent, `update security_prices set close = 999`, 'AI 계정 가격 고치기')
  await deny(U.agent, `update investment_position_changes set status = 'ADD'`, 'AI 계정 판정 고치기')
  await deny(U.agent, `insert into investment_disclosures (manager_id, source_id, source_type, doc_key, data_as_of, source_url, coverage) values ('nbim', 'manual', 'manual', 'ai-1', '2026-06-30', 'https://x', 'x')`, 'AI 계정 공시 만들기')

  // 직원 · 임원 · anon: 0행 · 쓰기 거부
  for (const t of SOURCE_TABLES) {
    for (const uid of [U.member, U.cfo]) {
      const r = await as(uid, `select count(*)::int as n from ${t}`)
      assert.ok(r.error !== null || (r.rows[0] as { n: number }).n === 0, `직원 ${t} 0행`)
    }
    const a = await as(null, `select count(*)::int as n from ${t}`)
    assert.ok(a.error !== null || (a.rows[0] as { n: number }).n === 0, `anon ${t} 0행`)
  }
  await deny(U.member, `insert into securities (kind, name, source) values ('stock', 'X', 'x')`, '직원 쓰기')
  await deny(U.member, `update investment_settings set data_quality_min = 0`, '직원 설정')
  await deny(null, `insert into securities (kind, name, source) values ('stock', 'X', 'x')`, 'anon 쓰기')
  await deny(U.member, `insert into investment_audit_logs (action, entity) values ('x.y', 'x')`, '직원 감사 줄')
  assert.equal(((await as(U.member, `select inv_reader() as r`)).rows[0] as { r: boolean } | undefined)?.r ?? false, false)

  // 지정자: 읽기만
  assert.equal((await must(U.designee, `select * from investment_positions`)).rows.length, 1)
  await deny(U.designee, `insert into securities (kind, name, source) values ('stock', 'X', 'x')`, '지정자 쓰기')
  await deny(U.designee, `update investment_settings set data_quality_min = 0`, '지정자 설정')

  // 대표: 손 입력 · 설정
  await must(U.chair, `update investment_settings set data_quality_min = 75`)
  assert.equal((await db.query<{ q: number }>(`select data_quality_min as q from investment_settings`)).rows[0].q, 75)
  await must(U.chair, `insert into security_corporate_actions (security_id, ex_date, kind, ratio, source, source_url) values ('${sec.security_id}', '2026-07-01', 'split', 4, 'manual', 'https://x')`)
  await deny(U.chair, `insert into investment_settings (id) values (2)`, '설정은 한 줄')
  await deny(U.chair, `update investment_settings set alloc_equity_pct = 70`, '배분 합 100 아님')

  // 스위치 기본 줄
  assert.equal((await db.query<{ a: string }>(`select audience as a from feature_switches where feature_key = 'investment' and business_id is null`)).rows[0]?.a, 'chairman')
  await db.close()
  return '0094 투자 원천(직원 · 임원 · anon 0행 · 쓰기 거부 · 지정자 읽기만 · 수집 계정 원천만 · 기관/설정 못 고침 · AI 계정 읽기만(restrictive) · 대표 손 입력 · 설정 한 줄 · 배분 합 · delete 없음 · 감사 본인 도장 · 스위치 기본 대표만)'
}

/** 0095 분석 표 — AI · 대표 INSERT만 · UPDATE/DELETE 없음(grant + 트리거) · 수집 계정 0행 · BUY는 system 줄 + 조건 전부 · CONFIRMED 규칙. */
export async function investmentDb95(): Promise<string> {
  const { db, as } = await investmentDbSetup()
  const must = async (uid: string | null, sql: string) => {
    const r = await as(uid, sql)
    assert.equal(r.error, null, `거부되면 안 됨: ${sql.slice(0, 140)} — ${r.error}`)
    return r
  }
  const deny = async (uid: string | null, sql: string, what: string, re?: RegExp) => {
    const r = await as(uid, sql)
    assert.ok(r.error !== null || r.affected === 0, `${what}: 막혀야 함 — ${sql.slice(0, 120)}`)
    if (re) assert.match(r.error ?? '', re, what)
  }
  const sec = (await db.query<{ id: string }>(`insert into securities (kind, name, ticker, cusip, source) values ('stock', 'APPLE', 'AAPL', '037833100', 'sec13f') returning security_id as id`)).rows[0].id
  const pass = `'[{"key":"price","label":"p","pass":true,"detail":"","required":true}]'::jsonb`
  const fail = `'[{"key":"price","label":"p","pass":false,"detail":"","required":true}]'::jsonb`
  const rec = (status: string, kind: string, checks: string, v: number) =>
    `insert into investment_recommendations (security_id, version, status, checks, inputs, calculation_version, created_kind) values ('${sec}', ${v}, '${status}', ${checks}, '{}'::jsonb, 'x', '${kind}') returning rec_id`

  // AI 분석 계정: INSERT만
  const r1 = (await must(U.agent, rec('WATCH', 'system', fail, 1))).rows[0] as { rec_id: string }
  await must(U.agent, `insert into investment_scores (subject_type, subject_id, factor, score, method, evidence, created_kind) values ('company', '${sec}', 'moat', 70, 'ai_estimate', 'AI 추정 근거', 'ai')`)
  await must(U.agent, `insert into investment_theses (security_id, kind, statement, classification, created_kind) values ('${sec}', 'manager_reason', '추론 문장', 'INFERRED', 'ai')`)
  await deny(U.agent, `update investment_recommendations set status = 'BUY ZONE' where rec_id = '${r1.rec_id}'`, 'AI 추천 UPDATE')
  await deny(U.agent, `delete from investment_recommendations where rec_id = '${r1.rec_id}'`, 'AI 추천 DELETE')
  await deny(U.agent, `update investment_scores set score = 100`, 'AI 점수 UPDATE')
  await deny(U.chair, `update investment_recommendations set status = 'WATCH'`, '대표도 추천 UPDATE 없음')
  await deny(U.chair, `delete from investment_theses`, '대표도 가설 DELETE 없음')
  // 소유자(마이그레이션 권한)도 트리거로 막힌다
  await assert.rejects(db.query(`update investment_recommendations set status = 'WATCH' where rec_id = '${r1.rec_id}'`), /investment_append_only/)
  await assert.rejects(db.query(`delete from investment_recommendations`), /investment_append_only/)
  // BUY ZONE — system 줄 + 조건 전부만
  await deny(U.agent, rec('BUY ZONE', 'ai', pass, 2), 'AI 작성 줄은 BUY 불가', /investment_buy_only_system/)
  await deny(U.agent, rec('BUY ZONE', 'system', fail, 2), '조건 실패 BUY 불가', /investment_buy_checks_failed/)
  await deny(U.chair, rec('BUY ZONE', 'human', pass, 2), '사람이 붙인 BUY 불가', /investment_buy_only_system/)
  await must(U.agent, rec('BUY ZONE', 'system', pass, 2))
  // CONFIRMED는 공식 문서 + 사람만
  await deny(U.agent, `insert into investment_theses (security_id, kind, statement, classification, source_url, document_date, created_kind) values ('${sec}', 'manager_reason', 'x 문장', 'CONFIRMED', 'https://x', '2026-01-01', 'ai')`, 'AI는 CONFIRMED 불가', /investment_theses_confirmed/)
  await deny(U.chair, `insert into investment_theses (security_id, kind, statement, classification, created_kind) values ('${sec}', 'company', 'x 문장', 'CONFIRMED', 'human')`, '출처 없는 CONFIRMED', /investment_theses_confirmed/)
  await must(U.chair, `insert into investment_theses (security_id, kind, statement, classification, source_url, document_date, created_kind) values ('${sec}', 'company', '주주서한 문장', 'CONFIRMED', 'https://www.berkshirehathaway.com/letters/2025ltr.pdf', '2026-02-28', 'human')`)
  // 실측 · 전망은 출처 필수
  await deny(U.chair, `insert into market_forecasts (market_id, metric, label, value, kind) values ('ai_infra', 'market_size', 'x', 1, 'forecast')`, '출처 없는 전망', /market_forecasts_source/)
  await must(U.chair, `insert into market_forecasts (market_id, metric, label, value, kind) values ('ai_infra', 'other', 'AI 가정', 1, 'ai_assumption')`)
  // 수집 계정 — 분석 · 산업 표 0행 · 쓰기 거부
  for (const t of ['investment_recommendations', 'investment_scores', 'investment_theses', 'future_markets', 'market_forecasts', 'investment_alerts', 'investment_briefs']) {
    const r = await as<{ n: number }>(U.integ, `select count(*)::int as n from ${t}`)
    assert.ok(r.error !== null || r.rows[0].n === 0, `수집 계정 ${t} 0행`)
  }
  await deny(U.integ, rec('WATCH', 'system', fail, 3), '수집 계정 추천 쓰기')
  await deny(U.integ, `insert into investment_alerts (kind, title) values ('x.y', 'x')`, '수집 계정 알림 쓰기')
  // 직원 · anon 0행 · 지정자 읽기만
  for (const uid of [U.member, U.cfo, null]) {
    const r = await as<{ n: number }>(uid, `select count(*)::int as n from investment_recommendations`)
    assert.ok(r.error !== null || r.rows[0].n === 0, '직원 · anon 추천 0행')
  }
  assert.equal((await must(U.designee, `select * from investment_recommendations`)).rows.length, 2)
  await deny(U.designee, rec('WATCH', 'system', fail, 3), '지정자 추천 쓰기')
  // 알림 «읽음»만 대표가
  const al = (await must(U.agent, `insert into investment_alerts (kind, title, dedupe_key) values ('rec.status', 't', 'k1') returning alert_id`)).rows[0] as { alert_id: number }
  await must(U.chair, `update investment_alerts set read_at = now() where alert_id = ${al.alert_id}`)
  await deny(U.chair, `update investment_alerts set title = 'x' where alert_id = ${al.alert_id}`, '알림 제목 고치기')
  await deny(U.agent, `update investment_alerts set read_at = now()`, 'AI 읽음 표시')
  // 시드 — 산업 다섯 · 출처 있는 전망 · 점수 입력
  const n = async (q: string) => (await db.query<{ n: number }>(q)).rows[0].n
  assert.equal(await n(`select count(*)::int n from future_markets`), 5)
  assert.equal(await n(`select count(*)::int n from market_forecasts where kind <> 'ai_assumption' and source_id is null`), 0)
  assert.equal(await n(`select count(distinct market_id)::int n from market_forecasts`), 5)
  assert.equal(await n(`select count(distinct subject_id || factor)::int n from investment_scores where subject_type = 'market'`), 25)
  await db.close()
  return '0095 분석 이력(AI · 대표 INSERT만 · UPDATE/DELETE grant 없음 + 소유자도 트리거로 거부 · BUY는 system 줄 + 조건 전부 · AI/사람 BUY 거부 · CONFIRMED는 공식 문서 + 사람 · 출처 없는 전망 거부 · 수집 계정 0행 · 쓰기 거부 · 직원/anon 0행 · 지정자 읽기만 · 알림 읽음만 · 시드 5산업 25요소)'
}
