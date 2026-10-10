/**
 * check:cost-engine ⑭ — 0067 판매 실적 · 실제 원가 · 견적 마진 vs 실제 마진. BYPASSRLS 없는 소유자(⑥ 이후) 아래에서 돈다.
 *   확정 견적 → 출고 기록(영업 스냅숏 = 0시 기준 영업 화면 값) · 생산 LOT 연결(Actual) / 없음(출고일 Current) ·
 *   위조(표 쓰기 · 소유자 경로 얼림 · delete) · 모양(1원 단위 · 미래 출고일 · 미확정 견적 · 다른 제품 LOT) · 대체(무효 + 새 줄) · 무효 ·
 *   읽기(본인 · subtree 팀장 · 대표 / 다른 영업 · 구매 · 생산 · 원가 관리 · 줄 없는 임원/CFO/회사 대표 · 다른 회사 · AIAgent 0행 · anon 거부) ·
 *   마진(대표 원래 값 · 원가 관리 1원 · 영업 · 구매 · 생산 거부 · 겸직 거부 · 하루 20번 · 호출마다 감사) ·
 *   정밀도(합산은 원래 값끼리 더한 뒤 1원 — 1원 끝자리 · 주 = 월요일) · 하한(too_low) · 영업 칸에 실제 원가 없음 · 엑셀 감사.
 */
import assert from 'node:assert/strict'

import type { PGlite } from '@electric-sql/pglite'

export interface SalesCtx {
  db: PGlite
  as: <T>(uid: string | null, sql: string, commit?: boolean) => Promise<T[]>
  run: (uid: string, sql: string) => Promise<unknown[]>
  owner: <T>(sql: string) => Promise<T[]>
  p1: string
  U: Record<string, string>
}

const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)

export async function sales({ db, as, run, owner, p1, U }: SalesCtx) {
  const lead = '00000000-0000-0000-0000-0000000066a1' // ⑬이 만든 DY 영업 팀장(U.sales의 상사)
  const other = '00000000-0000-0000-0000-0000000066a2' // ⑬이 만든 다른 영업(subtree 밖)
  await db.exec(`delete from cost_secret.cost_reads;`)
  const T = (await owner<{ t: string }>(`select cost_today()::text as t`))[0].t
  const total = Number((await as<{ t: string }>(U.sales, `select total_krw_per_kg::text as t from cost_sales_view('${p1}')`))[0].t)
  assert.ok(total > 0, '0067 전제: 영업 총원가가 없다')

  // 확정 견적 하나(Green) — ⑬과 따로.
  const qid = (await as<{ id: string }>(U.sales, `select quote_create('${p1}', '김출고', '(주)가짜출고', 1000, ${total * 2}, 'KRW', '${T}'::date + 30) as id`, true))[0].id
  await run(U.sales, `select quote_confirm('${qid}')`)
  const draftQ = (await as<{ id: string }>(U.sales, `select quote_create('${p1}', '김출고', '(주)가짜출고', 1000, ${total * 2}, 'KRW', '${T}'::date + 30) as id`, true))[0].id
  // 투입이 있는 p1 생산 LOT(⑤ 생산이 만든 것).
  const lots = await owner<{ p: string; d: string }>(`select pl.prod_lot_id as p, pl.produced_on::text as d from cost_prod_lots pl
     where pl.product_id = '${p1}' and pl.voided_at is null and exists (select 1 from cost_prod_inputs i where i.prod_lot_id = pl.prod_lot_id and i.voided_at is null)
     order by pl.produced_on desc limit 1`)
  assert.equal(lots.length, 1, '0067 전제: 투입이 있는 p1 생산 LOT가 없다')
  const lot = lots[0].p
  const otherLot = await owner<{ p: string }>(`select prod_lot_id as p from cost_prod_lots where product_id <> '${p1}' and business_id = 'biz_dy' limit 1`)

  const rec = (uid: string, args: string) => as<{ id: string }>(uid, `select sale_record(${args}) as id`, true).then((r) => r[0].id)
  const kgOdd = '333.333' // kg × 원/kg가 소수가 되게 — 1원 끝자리 시험
  // ── 출고 기록: 견적 연결 · LOT 없음(출고일 Current) / LOT 연결(Actual) ──
  const s1 = await rec(U.sales, `'${p1}', '${T}', '김출고', '(주)가짜출고', ${kgOdd}, ${total * 2}, 'KRW', '${qid}'`)
  const s2 = await rec(U.sales, `'${p1}', '${T}', '박출고', '(주)가짜출고2', 1000, ${total * 2 + 7}, 'KRW', null, '${lot}'`)
  // 이틀 전 출고 — 그 날 배부 창(직전 7일 생산)이 비어 비용을 못 나눈다 → 실제 원가 «계산 안 됨»(원료비만으로 마진을 내지 않는다, 0065 I1).
  const s3 = await rec(U.sales, `'${p1}', '${T}'::date - 2, '최출고', '(주)가짜출고3', 10, ${total * 2}, 'KRW'`)
  type S = { snap_grade: string; snap_total_krw_per_kg: string | null; snap_margin_pct: string | null; snap_basis: string; voided_at: string | null; replaces_id: string | null }
  const sr = async (id: string) => (await owner<S>(`select snap_grade, snap_total_krw_per_kg::text, snap_margin_pct::text, snap_basis, voided_at::text, replaces_id from cost_sales where sale_id = '${id}'`))[0]
  const a1 = await sr(s1)
  assert.deepEqual([a1.snap_grade, a1.snap_total_krw_per_kg, a1.snap_basis], ['green', String(total), 'midnight'], '0067: 출고 스냅숏이 영업 화면 값(0시 기준 · 1원)이 아니다')

  // ── 모양 · 위조 ──
  await refuses(as(U.sales, `select sale_record('${p1}', '${T}', 'a', 'b', 1, 1234.5, 'KRW')`), /sale_invalid/, '0067: 1원 단위가 아닌 판매가')
  await refuses(as(U.sales, `select sale_record('${p1}', '${T}'::date + 1, 'a', 'b', 1, 1000, 'KRW')`), /sale_invalid/, '0067: 미래 출고일')
  await refuses(as(U.sales, `select sale_record('${p1}', '${T}', 'a', 'b', 1, 1000, 'KRW', '${draftQ}')`), /sale_quote_invalid/, '0067: 확정 안 된 견적에 출고')
  if (otherLot.length) {
    await refuses(as(U.sales, `select sale_record('${p1}', '${T}', 'a', 'b', 1, 1000, 'KRW', null, '${otherLot[0].p}')`), /sale_lot_invalid/, '0067: 다른 제품 생산 LOT')
  }
  await refuses(as(U.sales, `select sale_record('${p1}', '${lots[0].d}'::date - 1, 'a', 'b', 1, 1000, 'KRW', null, '${lot}')`), /sale_lot_invalid/, '0067: 생산 전 출고에 LOT')
  await refuses(run(U.sales, `insert into cost_sales (business_id, shipped_on, customer_name, customer_company, product_id, product_name, kg, price_krw_per_kg, snap_as_of, snap_basis, snap_grade, created_by)
     values ('biz_dy', '${T}', 'a', 'b', '${p1}', 'x', 1, 1, '${T}', 'now', 'unknown', '${U.sales}')`), /permission denied/, '0067: 영업이 판매 표에 직접 쓴다')
  await refuses(run(U.sales, `update cost_sales set price_krw_per_kg = 1 where sale_id = '${s1}'`), /permission denied/, '0067: 영업이 판매를 고친다')
  await refuses(owner(`update cost_sales set price_krw_per_kg = 1 where sale_id = '${s1}'`), /sale_frozen/, '0067: 소유자 경로가 판매가를 고친다(얼림)')
  await refuses(owner(`delete from cost_sales where sale_id = '${s1}'`), /sale_frozen/, '0067: 판매 줄을 지운다')
  await refuses(as(U.vana, `select sale_record('${p1}', '${T}', 'a', 'b', 1, 100000, 'KRW')`), /sale_not_found/, '0067: 다른 회사 사람이 DY 판매를 기록한다')
  for (const uid of [U.buy, U.prod, U.cost, U.exec, U.agent]) {
    await refuses(as(uid, `select sale_record('${p1}', '${T}', 'a', 'b', 1, 100000, 'KRW')`), /sale_not_found/, `0067: ${uid.slice(-2)}가 판매를 기록한다`)
  }
  await refuses(as(U.sp, `select sale_record('${p1}', '${T}', 'a', 'b', 1, 100000, 'KRW')`), /cost_role_conflict/, '0067: 영업 + 생산 겸직이 판매(원가 문)를 기록한다')
  await refuses(as(null, `select sale_record('${p1}', '${T}', 'a', 'b', 1, 100000, 'KRW')`), /permission denied/, '0067: anon이 판매 함수를 부른다')

  // ── 생산 LOT 고르기 ──
  const opts = await as<{ prod_lot_id: string }>(U.sales, `select * from sale_lot_options('${p1}')`)
  assert.ok(opts.some((o) => o.prod_lot_id === lot), '0067: 영업 LOT 고르기에 생산 LOT가 없다')
  assert.deepEqual(Object.keys(opts[0]).sort(), ['prod_lot_id', 'produced_on'], '0067: LOT 고르기 칸에 kg · 원가가 섞였다')
  await refuses(as(U.buy, `select * from sale_lot_options('${p1}')`), /sale_not_found/, '0067: 구매가 판매 LOT 고르기를 부른다')

  // ── 하한(0066 I3 같은 문) — 기록은 남고 마진은 없다 ──
  const low = await rec(U.sales, `'${p1}', '${T}', '김싸게', '(주)가짜싸게', 1, 1, 'KRW'`)
  const lr = await sr(low)
  assert.deepEqual([lr.snap_grade, lr.snap_total_krw_per_kg, lr.snap_margin_pct], ['too_low', null, null], '0067: 총원가 절반 미만 판매에 마진이 나간다')

  // ── 대체 · 무효 ──
  await refuses(as(U.sales, `select sale_record('${p1}', '${T}', 'a', 'b', 1, 100000, 'KRW', null, null, '${low}', '')`), /sale_invalid/, '0067: 이유 없는 대체')
  await refuses(as(other, `select sale_record('${p1}', '${T}', 'a', 'b', 1, 100000, 'KRW', null, null, '${low}', '잘못')`), /sale_not_found/, '0067: 남의 판매를 대체한다')
  const low2 = await rec(U.sales, `'${p1}', '${T}', '김싸게', '(주)가짜싸게', 1, ${total * 2}, 'KRW', null, null, '${low}', '단가 잘못 입력'`)
  assert.ok((await sr(low)).voided_at, '0067: 대체한 앞 줄이 무효가 아니다')
  assert.equal((await sr(low2)).replaces_id, low, '0067: 새 줄이 앞 줄을 가리키지 않는다')
  await refuses(as(U.sales, `select sale_record('${p1}', '${T}', 'a', 'b', 1, 100000, 'KRW', null, null, '${low}', '또')`), /sale_not_found/, '0067: 무효 줄을 또 대체한다')
  await refuses(run(lead, `select sale_void('${low2}', '팀장')`), /sale_not_found/, '0067: 팀장이 팀원 판매를 무효로 한다(읽기만)')
  await run(U.sales, `select sale_void('${low2}', '중복')`)
  await refuses(run(U.sales, `select sale_void('${low2}', '또')`), /sale_frozen/, '0067: 무효를 두 번')

  // ── 읽기 ──
  const n = async (uid: string | null) => Number((await as<{ n: number }>(uid, `select count(*)::int as n from cost_sales`))[0].n)
  const mine = await n(U.sales)
  assert.equal(mine, 5, '0067: 영업이 자기 판매를 다 못 본다(무효 줄 포함 다섯)')
  assert.equal(await n(lead), mine, '0067: 영업 팀장이 subtree 팀원 판매를 못 본다')
  assert.equal(await n(other), 0, '0067: 다른 영업이 남의 판매를 본다')
  for (const uid of [U.buy, U.prod, U.cost, U.exec, U.ceo, U.cfo, U.vana, U.agent, U.sp, U.sr]) assert.equal(await n(uid), 0, `0067: ${uid.slice(-2)}가 판매 표를 본다`)
  assert.equal(await n(U.chair), mine, '0067: 대표가 판매를 다 못 본다')
  await refuses(as(null, `select 1 from cost_sales`), /permission denied/, '0067: anon에게 판매 표가 열렸다')
  const cols = Object.keys((await as<Record<string, unknown>>(U.sales, `select * from cost_sales limit 1`))[0])
  for (const c of cols) assert.ok(!/actual|cogs|lot_cost|landed/.test(c), `0067: 영업이 읽는 판매 칸에 실제 원가(${c})`)

  // ── 마진: 영업 · 구매 · 생산 · 줄 없는 사람 거부 ──
  const M = (by: string, grain = 'month') => `select * from cost_margins('biz_dy', '${T}'::date - 30, '${T}', '${grain}', '${by}')`
  for (const uid of [U.sales, U.buy, U.prod, U.exec, U.cfo, U.vana, U.agent, lead]) {
    await refuses(as(uid, M('deal')), /cost_not_found/, `0067: ${uid.slice(-2)}가 실제 마진을 본다`)
  }
  await refuses(as(U.both, M('deal')), /cost_role_conflict/, '0067: 구매 입력 + 원가 관리 겸직이 실제 마진을 본다')
  await refuses(as(U.cost, `select * from cost_margins('biz_dy', '${T}'::date - 2000, '${T}', 'month', 'deal')`), /cost_invalid/, '0067: 3년 넘는 기간')

  // ── 마진 값: 기대값은 소유자가 같은 내부 함수로(원래 값) ──
  type E = { src: string; raw: string }
  const exp = async (sale: string) => (await owner<E>(`select a.source as src, a.total_raw::text as raw from cost_sales x,
      cost_secret.sale_actual(x.business_id, x.product_id, x.shipped_on, x.prod_lot_id, true) a where x.sale_id = '${sale}'`))[0]
  const e1 = await exp(s1)
  const e2 = await exp(s2)
  assert.equal(e1.src, 'current', '0067: LOT 없는 판매가 Current가 아니다')
  assert.equal((await exp(s3)).raw, null, '0067: 배부 못 하는 날 판매에 실제 원가가 나온다(원료비만)')
  assert.equal(e2.src, 'actual', '0067: LOT 연결 판매가 Actual이 아니다')
  assert.ok(e1.raw !== null && e2.raw !== null, '0067: 실제 원가가 계산되지 않았다')
  const actMat = (await owner<{ v: string }>(`select (sum(i.qty_kg * l.landed_krw_per_kg) / max(pl.output_kg))::text as v from cost_prod_lots pl
      join cost_prod_inputs i on i.prod_lot_id = pl.prod_lot_id and i.voided_at is null join cost_purchase_lots l on l.lot_id = i.lot_id where pl.prod_lot_id = '${lot}'`))[0].v
  assert.ok(Number(e2.raw) >= Number(actMat) - 1e-9, '0067: Actual 총원가가 투입 원료비보다 작다(비용 빠짐 · 부호)')

  type R = { sale_id: string; cost_source: string; cost_krw_per_kg: string; quote_cost_krw_per_kg: string | null; quote_id: string | null; cost_krw: string; revenue_krw: string; margin_krw: string; margin_pct: string; period_start: string }
  const cRows = await as<R>(U.cost, `select sale_id, cost_source, cost_krw_per_kg::text, quote_cost_krw_per_kg::text, quote_id, cost_krw::text, revenue_krw::text, margin_krw::text, margin_pct::text, period_start::text from (${M('deal')}) z`, true)
  const hRows = await as<R>(U.chair, `select sale_id, cost_source, cost_krw_per_kg::text, quote_cost_krw_per_kg::text, quote_id, cost_krw::text, revenue_krw::text, margin_krw::text, margin_pct::text, period_start::text from (${M('deal')}) z`, true)
  assert.equal(cRows.length, 3, '0067: 원가 관리 마진 줄 수(무효 둘 제외 셋)')
  assert.equal(cRows.find((r) => r.sale_id === s3)?.cost_krw_per_kg ?? null, null, '0067: 계산 안 된 판매에 원가 칸')
  const c1 = cRows.find((r) => r.sale_id === s1)!
  const c2 = cRows.find((r) => r.sale_id === s2)!
  const h2 = hRows.find((r) => r.sale_id === s2)!
  assert.equal(c2.cost_source, 'actual')
  assert.equal(c2.cost_krw_per_kg, String(Math.round(Number(e2.raw))), '0067: 원가 관리 Actual 총원가가 원래 값의 1원이 아니다')
  assert.equal(Number(h2.cost_krw_per_kg), Number(e2.raw), '0067: 대표 Actual 총원가가 원래 값이 아니다')
  assert.equal(c1.cost_source, 'current')
  assert.equal(c1.cost_krw_per_kg, String(Math.round(Number(e1.raw))), '0067: 원가 관리 Current 총원가가 원래 값의 1원이 아니다')
  assert.equal(c1.quote_id, qid)
  const qraw = (await owner<{ b: string }>(`select total_raw_basis::text as b from cost_secret.quote_raw where quote_id = '${qid}'`))[0].b
  assert.equal(c1.quote_cost_krw_per_kg, String(Math.round(Number(qraw))), '0067: 견적 순간 총원가가 견적 원래 값의 1원이 아니다')

  // ── 정밀도: 합산 = 원래 값끼리 곱하고 더한 뒤 1원(1원 끝자리) ──
  const expTotal = (await owner<{ c: string; m: string; r: string }>(`select round(sum(x.kg * a.total_raw), 0)::text as c,
      round(sum(x.kg * (x.price_krw_per_kg - a.total_raw)), 0)::text as m, sum(x.kg * x.price_krw_per_kg)::text as r
      from cost_sales x, cost_secret.sale_actual(x.business_id, x.product_id, x.shipped_on, x.prod_lot_id, true) a
     where x.business_id = 'biz_dy' and x.voided_at is null and x.shipped_on between '${T}'::date - 30 and '${T}'`))[0]
  const tot = (await as<R & { n_uncomputed: number }>(U.cost, `select cost_krw::text, margin_krw::text, revenue_krw::text, n_uncomputed from (${M('total', 'year')}) z`, true))
  assert.equal(tot.reduce((x, r) => x + r.n_uncomputed, 0), 1, '0067: 원가 없는 판매 수(n_uncomputed)')
  const sumC = tot.reduce((s, r) => s + Number(r.cost_krw), 0)
  const sumR = tot.reduce((s, r) => s + Number(r.revenue_krw), 0)
  if (tot.length === 1) {
    assert.equal(tot[0].cost_krw, expTotal.c, '0067: 합산 원가가 «원래 값끼리 더한 뒤 1원»이 아니다')
    assert.equal(tot[0].margin_krw, expTotal.m, '0067: 합산 마진이 «원래 값끼리 더한 뒤 1원»이 아니다')
  } else {
    assert.ok(Math.abs(sumC - Number(expTotal.c)) <= tot.length, '0067: 해를 넘는 합산 원가')
  }
  assert.equal(sumR, Number(expTotal.r), '0067: 매출 합(kg × 판매가)이 다르다')
  // 주 = ISO 주 월요일.
  const wk = await as<{ d: number }>(U.cost, `select extract(isodow from period_start)::int as d from (${M('product', 'week')}) z`, true)
  assert.ok(wk.length > 0 && wk.every((r) => r.d === 1), '0067: 주 묶음 시작이 월요일이 아니다')
  for (const g of ['day', 'quarter']) assert.ok((await as(U.cost, M('customer', g), true)).length > 0, `0067: ${g} 묶음`)

  // ── 감사 · 하루 20번 · 엑셀 ──
  const aud = await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'cost_products' and entity_id = 'margins:biz_dy' and actor_user_id = '${U.cost}'`)
  assert.ok(aud[0].n >= 5, `0067: 원가 관리 마진 조회가 호출마다 감사되지 않는다(${aud[0].n})`)
  await db.exec(`update cost_secret.cost_reads set calls = 20 where user_id = '${U.cost}' and product_id = 'margins:biz_dy'`)
  await refuses(as(U.cost, M('deal')), /cost_rate_limited/, '0067: 원가 관리 마진 조회 하루 20번 한도가 없다')
  await refuses(as(U.sales, `select cost_margins_download_log('biz_dy', '${T}', '${T}', 'month', 'product')`), /cost_not_found/, '0067: 영업이 마진 엑셀을 받는다')
  await run(U.cost, `select cost_margins_download_log('biz_dy', '${T}'::date - 30, '${T}', 'month', 'product')`)
  assert.equal((await owner(`select 1 from audit_log where entity_table = 'cost_sales' and action = 'export' and actor_user_id = '${U.cost}'`)).length, 1, '0067: 마진 엑셀 감사가 없다')
  const sAud = await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'cost_sales'`)
  assert.ok(sAud[0].n >= 7, '0067: 판매 쓰기 감사가 모자라다')
}
