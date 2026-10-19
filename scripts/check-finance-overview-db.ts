/**
 * 0085 재무 현황 · 저장 한 번 — check-migrations.ts가 부른다(PGlite · 전부 적용한 DB).
 *   저장: 장부 쓰기만 · 같은 달은 바꾸기(옛 줄 무효 · 이력) · 되돌리기는 옛 값을 되살림 · 자동 표시 · 경고 칸 · 큐에 들어감.
 *   출하집계표: 저장 · 바꾸기 · 되돌리기에 줄이 따라간다. 마감 달: 장부 쓰기는 보류(거부) · 대표는 이유와 함께.
 *   급여 개인 줄: 부서 합계 저장 뒤 개인 줄은 보류 · 줄 내용은 대표 · CFO에게만 · 결정도 대표 · CFO만.
 *   큐: 사람 세션은 그 회사만 · AI Agent는 전체 · 끝내기 · 다섯 번 실패하면 멈춤.
 *   저장본: 장부 쓰기 · AI Agent만 쓰고 · 원료별 칸 이름은 거부 · 장부 못 읽는 직원은 0줄.
 *   공식 결산 되돌리기: 앞 결산이 되살아난다(고치지 않고 새 줄) · 7일 · 남이 올린 것은 마감 권한자만.
 *   anon은 함수 하나도 못 부른다 · 스위치 finance_overview 기본 전원.
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000085a1',
  ceo: '00000000-0000-0000-0000-0000000085a2', // DY 회사 대표 — can_keep_books(biz_dy) · 마감 권한 없음
  member: '00000000-0000-0000-0000-0000000085a3', // DY 직원 — 재무 줄 없음
  agent: '00000000-0000-0000-0000-0000000085a4',
  keeper: '00000000-0000-0000-0000-0000000085a5', // DY 사원 — 재무 입력 줄(김병훈 자리)
}
const sha = (c: string) => c.repeat(64)

export async function financeOverviewDb(): Promise<string> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ('${U.chair}', 'v1@x'), ('${U.ceo}', 'v2@x'), ('${U.member}', 'v3@x'), ('${U.agent}', 'v4@x'), ('${U.keeper}', 'v5@x');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${U.chair}', 'Chairman', 'ch', 'Vault', null), ('${U.ceo}', 'BusinessCEO', 'dy대표', 'Restricted', null),
      ('${U.member}', 'Member', '직원', 'Normal', 'team_dy_production'), ('${U.agent}', 'AIAgent', 'agent', 'Restricted', null),
      ('${U.keeper}', 'Member', '장부 사원', 'Normal', null);
    insert into user_business_access values ('${U.ceo}', 'biz_dy'), ('${U.member}', 'biz_dy'), ('${U.keeper}', 'biz_dy'), ('${U.agent}', 'biz_dy');
    insert into user_module_access (user_id, module, can_write, can_approve) values ('${U.keeper}', '/finance/biz_dy', true, false);
    insert into accounts (business_id, account_code, name, category, section, cash_flow, source, fetched_at) values
      ('biz_dy', '1030', '보통예금', 'asset', 'cash', null, 'ecount', now()),
      ('biz_dy', '2510', '외상매입금', 'liability', 'payable', 'operating', 'ecount', now()),
      ('biz_dy', '3310', '자본금', 'equity', 'equity', 'financing', 'ecount', now()),
      ('biz_dy', '4040', '제품매출', 'revenue', 'revenue', 'operating', 'ecount', now())
    on conflict do nothing;
  `)

  const as = async <T>(uid: string | null, sql: string, role: 'authenticated' | 'anon' = 'authenticated'): Promise<T[] | string> => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true); set local role ${role};`)
    try {
      const r = await db.query<T>(sql)
      await db.exec('commit')
      return r.rows
    } catch (e) {
      await db.exec('rollback')
      return String((e as Error).message)
    }
  }
  const one = async <T>(uid: string | null, sql: string): Promise<T> => {
    const r = await as<T>(uid, sql)
    assert.ok(Array.isArray(r), `0085: 거부되면 안 되는 호출이 거부됐다 — ${String(r).slice(0, 160)} · ${sql.slice(0, 120)}`)
    return (r as T[])[0]
  }
  const su = async <T>(sql: string) => (await db.query<T>(sql)).rows
  const save = (uid: string, kind: string, period: string, s: string, rows: string, o: { people?: string; reason?: string; upload?: string; warn?: string } = {}) =>
    `select fin_upload_save('biz_dy', '${kind}', '${period}', '${kind}.xlsx', '${s}', 'Sheet1', 'high', 0, '${rows}'::jsonb,
       ${o.people ? `'${o.people}'::jsonb` : 'null'}, ${o.reason ? `'${o.reason}'` : 'null'}, ${o.upload ? `'${o.upload}'` : 'null'}, '${o.warn ?? '[]'}'::jsonb) as id`
  const sales = (amt: number) => `[{"row_no":3,"customer":"가","product":"P","qty":10,"unit_price":1,"amount":${amt},"vat_state":"missing"}]`

  // ── 저장 · 바꾸기 · 되돌리기 ──
  const a = await one<{ id: string }>(U.keeper, save(U.keeper, 'sales', '2099-01', sha('a'), sales(100), { warn: '["합계가 맞지 않습니다"]' }))
  let up = (await su<{ status: string; auto: boolean; warnings: string[] }>(`select status, auto, warnings from fin_uploads where upload_id = '${a.id}'`))[0]
  assert.equal(up.status, 'applied', '0085: 첫 저장이 applied가 아니다')
  assert.equal(up.auto, true, '0085: 저장 한 번이 자동 표시를 안 남긴다')
  assert.deepEqual(up.warnings, ['합계가 맞지 않습니다'], '0085: 경고가 저장되지 않았다')
  const job0 = await su<{ from_period: string; status: string }>(`select from_period, status from fin_recalc_jobs where business_id = 'biz_dy'`)
  assert.deepEqual(job0, [{ from_period: '2099-01', status: 'pending' }], '0085: 저장 뒤 다시 계산 큐가 서지 않았다')
  const b = await one<{ id: string }>(U.keeper, save(U.keeper, 'sales', '2099-01', sha('b'), sales(250)))
  const statuses = await su<{ upload_id: string; status: string }>(`select upload_id, status from fin_uploads where kind = 'sales' order by created_at`)
  assert.deepEqual(statuses.map((s) => s.status), ['replaced', 'applied'], '0085: 같은 달 두 번째 저장이 바꾸기가 아니다')
  const live = await su<{ amount: string }>(`select amount::text from fin_sales_lines where voided_at is null and period = '2099-01'`)
  assert.deepEqual(live.map((l) => Number(l.amount)), [250], '0085: 바꾸기 뒤 살아 있는 줄이 새 값이 아니다')
  assert.equal(typeof (await as(U.keeper, save(U.keeper, 'sales', '2099-01', sha('b'), sales(250)))), 'string', '0085: 같은 파일을 두 번 받았다')
  assert.deepEqual(await one(U.keeper, `select fin_upload_revert('${b.id}', '잘못 올림') as ok`), { ok: true }, '0085: 되돌리기가 안 된다')
  const back = await su<{ amount: string }>(`select amount::text from fin_sales_lines where voided_at is null and period = '2099-01'`)
  assert.deepEqual(back.map((l) => Number(l.amount)), [100], '0085: 되돌리기가 옛 값을 되살리지 않았다')
  assert.equal(typeof (await as(U.member, save(U.member, 'sales', '2099-02', sha('c'), sales(1)))), 'string', '0085: 장부 권한 없는 직원이 저장했다')
  assert.equal(typeof (await as(U.agent, save(U.agent, 'sales', '2099-02', sha('c'), sales(1)))), 'string', '0085: AI Agent가 저장했다')

  // ── 출하집계표 ──
  const ship = (kg: number) => `[{"row_no":2,"ship_date":"2099-01-05","customer":"가","product":"P","qty":${kg},"amount":1000}]`
  const s1 = await one<{ id: string }>(U.keeper, save(U.keeper, 'shipment', '2099-01', sha('d'), ship(10)))
  const s2 = await one<{ id: string }>(U.keeper, save(U.keeper, 'shipment', '2099-01', sha('e'), ship(20)))
  const shipLive = async () => (await su<{ qty: string }>(`select qty::text from fin_shipment_lines where voided_at is null`)).map((r) => Number(r.qty))
  assert.deepEqual(await shipLive(), [20], '0085: 출하 바꾸기 뒤 옛 줄이 살아 있다')
  await one(U.keeper, `select fin_upload_revert('${s2.id}', null) as ok`)
  assert.deepEqual(await shipLive(), [10], '0085: 출하 되돌리기가 옛 줄을 되살리지 않았다')
  assert.equal((await su<{ status: string }>(`select status from fin_uploads where upload_id = '${s1.id}'`))[0].status, 'applied')
  assert.equal(((await as(U.member, `select 1 from fin_shipment_lines`)) as unknown[]).length, 0, '0085: 장부 못 읽는 직원이 출하 줄을 본다')

  // ── 마감 달 — 장부 쓰기는 거부(앱이 보류로 남긴다) · 대표는 이유와 함께 ──
  await db.exec(`insert into closings (business_id, period, account_code, amount, closed_on, source, fetched_at, closed) values ('biz_dy', '2099-03', '4040', 0, '2099-04-01', 'manual', now(), true)`)
  const closedTry = await as(U.keeper, save(U.keeper, 'card', '2099-03', sha('f'), `[{"row_no":1,"merchant":"m","amount":5}]`))
  assert.ok(typeof closedTry === 'string' && /fin_upload_closed/.test(closedTry), '0085: 마감 달 저장이 막히지 않았다')
  assert.equal(typeof (await as(U.chair, save(U.chair, 'card', '2099-03', sha('f'), `[{"row_no":1,"merchant":"m","amount":5}]`))), 'string', '0085: 대표가 이유 없이 마감 달에 저장했다')
  await one(U.chair, save(U.chair, 'card', '2099-03', sha('f'), `[{"row_no":1,"merchant":"m","amount":5}]`, { reason: '세무사 수정분' }))
  const shipClosed = await as(U.keeper, save(U.keeper, 'shipment', '2099-03', sha('1'), ship(1)))
  assert.ok(typeof shipClosed === 'string' && /fin_upload_closed/.test(shipClosed), '0085: 출하집계표가 마감 달 문을 지나갔다')

  // ── 급여 개인 줄 보류 ──
  const pay = await one<{ id: string }>(U.keeper, save(U.keeper, 'payroll', '2099-01', sha('2'), `[{"row_no":1,"dept":"생산","salary":300}]`))
  const people = `[{"row_no":4,"dept":"생산","person_ref":"E01","salary":150},{"row_no":5,"dept":"생산","person_ref":"E02","salary":150}]`
  assert.equal(typeof (await as(U.ceo, `select fin_payroll_hold('${pay.id}', '${people}'::jsonb)`)), 'string', '0085: 올린 사람이 아닌 사람이 보류를 넣었다')
  const hold = await one<{ id: string }>(U.keeper, `select fin_payroll_hold('${pay.id}', '${people}'::jsonb) as id`)
  const keeperList = await one<{ people: number; rows: unknown }>(U.keeper, `select people, rows from fin_payroll_held_list('biz_dy')`)
  assert.deepEqual(keeperList, { people: 2, rows: null }, '0085: 장부 사원에게 개인 줄 내용이 갔다')
  const chairList = await one<{ rows: unknown[] }>(U.chair, `select rows from fin_payroll_held_list('biz_dy')`)
  assert.equal(chairList.rows.length, 2, '0085: 대표가 보류 줄을 못 본다')
  assert.equal(typeof (await as(U.ceo, `select fin_payroll_release('${hold.id}', true)`)), 'string', '0085: 회사 대표(BusinessCEO)가 개인 줄을 풀었다')
  assert.equal(typeof (await as(U.keeper, `select * from fin_payroll_held`)), 'string', '0085: 보류 표를 직접 읽었다')
  await one(U.chair, `select fin_payroll_release('${hold.id}', true) as ok`)
  const saved = await su<{ n: number }>(`select count(*)::int n from fin_payroll_people where upload_id = '${pay.id}' and voided_at is null`)
  assert.equal(saved[0].n, 2, '0085: 대표가 저장한 개인 줄이 들어가지 않았다')
  assert.equal(((await as(U.ceo, `select 1 from fin_payroll_people`)) as unknown[]).length, 0, '0085: 회사 대표가 개인 줄을 읽는다')

  // ── 큐 ──
  assert.equal(typeof (await as(U.member, `select * from fin_recalc_claim('biz_dy', 5)`)), 'string', '0085: 장부 없는 직원이 계산 일을 가져갔다')
  assert.equal(typeof (await as(U.keeper, `select * from fin_recalc_claim(null, 5)`)), 'string', '0085: 사람이 모든 회사 일을 가져갔다')
  const claimed = await as<{ job_id: string; from_period: string; status: string }>(U.keeper, `select job_id, from_period, status from fin_recalc_claim('biz_dy', 5)`)
  assert.ok(Array.isArray(claimed) && claimed.length === 1 && claimed[0].status === 'running', '0085: 장부 사원이 자기 회사 일을 못 가져간다')
  const job = (claimed as { job_id: string; from_period: string }[])[0]
  assert.equal(job.from_period, '2099-01', '0085: 큐의 시작 달이 가장 앞 달이 아니다')
  await one(U.keeper, save(U.keeper, 'card', '2099-02', sha('3'), `[{"row_no":1,"merchant":"m","amount":5}]`))
  const again = await as<unknown>(U.keeper, `select * from fin_recalc_claim('biz_dy', 5)`)
  assert.deepEqual(again, [], '0085: 도는 일이 있는데 같은 회사 다음 일을 내줬다')
  await one(U.keeper, `select fin_recalc_finish('${job.job_id}', true, null)`)
  const agentJobs = await as<{ business_id: string }>(U.agent, `select business_id from fin_recalc_claim(null, 5)`)
  assert.ok(Array.isArray(agentJobs) && agentJobs.length === 1, `0085: AI Agent가 큐를 못 가져간다 — ${String(agentJobs).slice(0, 120)}`)
  const aj = (await su<{ job_id: string }>(`select job_id from fin_recalc_jobs where status = 'running'`))[0]
  for (let i = 0; i < 5; i += 1) {
    await one(U.agent, `select fin_recalc_finish('${aj.job_id}', false, '읽기 실패')`)
    await as(U.agent, `select * from fin_recalc_claim(null, 5)`)
  }
  const failed = await su<{ status: string }>(`select status from fin_recalc_jobs where job_id = '${aj.job_id}'`)
  assert.equal(failed[0].status, 'failed', '0085: 다섯 번 실패한 일이 멈추지 않았다')

  // ── 저장본 ──
  await one(U.keeper, `select fin_overview_save('biz_dy', '2099-01', '{"pl":{"revenue":100}}'::jsonb, '["대출현황"]'::jsonb, true)`)
  await one(U.agent, `select fin_overview_save('biz_dy', '2099-02', '{"pl":{"revenue":5}}'::jsonb, '[]'::jsonb, true)`)
  assert.equal(typeof (await as(U.member, `select fin_overview_save('biz_dy', '2099-01', '{}'::jsonb, '[]'::jsonb, true)`)), 'string', '0085: 직원이 저장본을 썼다')
  assert.equal(typeof (await as(U.keeper, `select fin_overview_save('biz_dy', '2099-01', '{"materials":[1]}'::jsonb, '[]'::jsonb, true)`)), 'string', '0085: 원료별 칸이 저장본에 실렸다')
  assert.equal(((await as(U.member, `select 1 from fin_overview_months`)) as unknown[]).length, 0, '0085: 장부 못 읽는 직원이 저장본을 본다')
  assert.equal(((await as(U.ceo, `select 1 from fin_overview_months`)) as unknown[]).length, 2, '0085: 회사 대표가 저장본을 못 본다')

  // ── 공식 결산 되돌리기 ──
  await db.exec(`insert into storage.objects (bucket_id, name, owner) values ('fin-official-evidence', 'biz_dy/${sha('9')}.pdf', '${U.keeper}')`)
  const off = (amt: number, replace: boolean) =>
    `select official_statement_save_v2('biz_dy', 'year', '2098', null, 'biz_dy/${sha('9')}.pdf', '세무사 2098',
       '[{"account_code":"1030","amount":${amt}},{"account_code":"2510","amount":-${amt}}]'::jsonb, null, ${replace}, '[]'::jsonb) as id`
  const o1 = await one<{ id: number }>(U.keeper, off(100, false))
  const o2 = await one<{ id: number }>(U.keeper, off(300, true))
  assert.equal(typeof (await as(U.member, `select official_statement_withdraw(${o2.id}, 'x')`)), 'string', '0085: 직원이 공식 결산을 되돌렸다')
  assert.equal(typeof (await as(U.ceo, `select official_statement_withdraw(${o2.id}, 'x')`)), 'string', '0085: 올리지 않은 회사 대표(마감 권한 없음)가 되돌렸다')
  const o3 = await one<{ id: number }>(U.keeper, `select official_statement_withdraw(${o2.id}, '잘못 올림') as id`)
  const restored = await su<{ amount: string }>(`select amount::text from official_statement_lines where statement_id = ${o3.id} and account_code = '1030'`)
  assert.equal(Number(restored[0]?.amount), 100, '0085: 되돌리기가 앞 결산 값을 되살리지 않았다')
  const activeYear = await su<{ id: number }>(`select id from official_statements where period_key = '2098' and superseded_at is null`)
  assert.deepEqual(activeYear.map((r) => Number(r.id)), [Number(o3.id)], '0085: 되돌린 뒤 활성 결산이 하나가 아니다')
  assert.notEqual(o1.id, o3.id)

  // ── 자금흐름표 · 대출 0085 칸(저장 직후 같은 거래에서 채움) ──
  await one(U.keeper, save(U.keeper, 'cashflow', '2099-01', sha('5'), `[{"row_no":7,"flow_date":"2099-01-03","category":"수금","inflow":10,"outflow":null,"account":"기업은행 외화","currency":"usd","balance":320,"planned":true}]`))
  const cf = (await su<{ account: string; currency: string; balance: string; planned: boolean }>(`select account, currency, balance::text, planned from fin_cash_flows where period = '2099-01' and voided_at is null`))[0]
  assert.deepEqual({ ...cf, balance: Number(cf.balance) }, { account: '기업은행 외화', currency: 'USD', balance: 320, planned: true }, '0085: 자금흐름표 계좌 · 통화 · 잔액 · 예정 칸이 안 찼다')
  await one(U.keeper, save(U.keeper, 'loans', '2099-01', sha('6'), `[{"row_no":2,"lender":"기업은행","principal":1000,"rate":4.1,"loan_type":"시설자금","loan_total":2000,"pay_day":25}]`))
  const ln = (await su<{ loan_type: string; loan_total: string; pay_day: number }>(`select loan_type, loan_total::text, pay_day from fin_loans where period = '2099-01'`))[0]
  assert.deepEqual({ ...ln, loan_total: Number(ln.loan_total) }, { loan_type: '시설자금', loan_total: 2000, pay_day: 25 }, '0085: 대출 종류 · 총액 · 내는 날 칸이 안 찼다')

  // ── 지표 기준값 — 대표 · CFO · 마감 권한만 ──
  assert.equal(typeof (await as(U.keeper, `select fin_kpi_settings_save('biz_dy', '{"safety_cash":1000000000}'::jsonb, '시험')`)), 'string', '0085: 마감 권한 없는 장부 사원이 기준값을 바꿨다')
  assert.equal(typeof (await as(U.ceo, `select fin_kpi_settings_save('biz_dy', '{"safety_cash":1000000000}'::jsonb, '시험')`)), 'string', '0085: 마감 권한 없는 회사 대표가 기준값을 바꿨다')
  await one(U.chair, `select fin_kpi_settings_save('biz_dy', '{"safety_cash":1000000000}'::jsonb, '안전선 10억')`)
  assert.equal(((await as(U.keeper, `select settings from fin_kpi_settings`)) as unknown[]).length, 1, '0085: 장부 사원이 기준값을 못 읽는다')
  assert.equal(((await as(U.member, `select settings from fin_kpi_settings`)) as unknown[]).length, 0, '0085: 장부 못 읽는 직원이 기준값을 본다')

  // ── anon · 스위치 · 자동 생성 칸 ──
  for (const fn of [
    `fin_upload_save('biz_dy','sales','2099-05','a','${sha('4')}',null,'high',0,'[]'::jsonb,null,null,null,'[]'::jsonb)`,
    `fin_recalc_claim(null, 1)`,
    `fin_overview_save('biz_dy','2099-05','{}'::jsonb,'[]'::jsonb,true)`,
    `fin_payroll_held_list('biz_dy')`,
    `official_statement_withdraw(1, 'x')`,
  ]) {
    const r = await as(null, `select ${fn}`, 'anon')
    assert.ok(typeof r === 'string' && /permission denied/.test(r), `0085: anon이 ${fn.slice(0, 30)}를 불렀다`)
  }
  assert.equal(((await as(null, `select 1 from fin_overview_months`, 'anon')) as unknown) instanceof Array ? 'rows' : 'denied', 'denied', '0085: anon이 저장본 표를 읽었다')
  const sw = await su<{ audience: string; enabled: boolean }>(`select audience, enabled from feature_switches where feature_key = 'finance_overview' and business_id is null`)
  assert.deepEqual(sw, [{ audience: 'all', enabled: true }], '0085: 기능 스위치 finance_overview 기본 전원이 아니다')
  await one(U.keeper, `insert into accounts (business_id, account_code, name, category, section, cash_flow, source, fetched_at, auto_created) values ('biz_dy', '8110', '급여', 'labor', 'sga', 'operating', 'ecount', now(), true) returning 1`)
  assert.equal((await su<{ auto_created: boolean }>(`select auto_created from accounts where business_id = 'biz_dy' and account_code = '8110'`))[0].auto_created, true)

  await db.close()
  return '0085 재무 현황: 저장 · 바꾸기 · 되돌리기 · 경고 · 큐 · 출하 줄 · 마감 보류 · 급여 개인 줄 보류(대표 · CFO만) · 큐 권한 · 다섯 번 실패 멈춤 · 저장본 원료 칸 거부 · 공식 결산 되돌리기 · anon 0 · 스위치 전원'
}
