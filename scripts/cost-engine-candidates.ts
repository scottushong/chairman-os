import assert from 'node:assert/strict'

import type { PGlite } from '@electric-sql/pglite'

/**
 * ⑮ 0078 원가 후보 승인 — 자료 올리기(② 입고 · ⑦ OFFER · ① 판매) 후보 → «LOT로 넣기 · 무시 · 나중에».
 * 스위치(기본 대표만) · 문(대표 · 원가 관리 쓰기) · 이유 필수 · 넣기는 원래 입력 문(구매 쓰기 · 0067 sale_record)도 · 한 줄 한 번 · 감사 · 칸에 BOM 없음.
 */
export interface CandidatesCtx {
  db: PGlite
  as: <T>(uid: string | null, sql: string, commit?: boolean) => Promise<T[]>
  run: (uid: string, sql: string) => Promise<unknown[]>
  owner: <T>(sql: string) => Promise<T[]>
  p1: string
  U: Record<string, string>
}

export async function candidates({ as, run, owner, p1, U }: CandidatesCtx) {
  const refuses = (p: Promise<unknown>, re: RegExp, why: string) => assert.rejects(p, re, why)
  const T = (await owner<{ t: string }>(`select cost_today()::text as t`))[0].t
  const ym = T.slice(0, 7)
  const [lot] = await owner<{ material_id: string; supplier_id: string; unit_price: string }>(
    `select material_id, supplier_id, unit_price::text from cost_purchase_lots where business_id = 'biz_dy' and voided_at is null and currency = 'KRW' order by created_at limit 1`,
  )
  assert.ok(lot, '0078: 시험용 KRW LOT가 없다')
  const up = async (kind: string) =>
    (await owner<{ id: string }>(`insert into fin_uploads (business_id, kind, period, file_name, file_sha256, status, row_count, created_by)
      values ('biz_dy', '${kind}', '${ym}', '가짜 ${kind}.xlsx', '${kind.length.toString(16).padStart(64, 'c')}', 'applied', 1, '${U.chair}') returning upload_id as id`))[0].id
  const qty = 100
  const amount = Math.round(Number(lot.unit_price) * qty)
  const pin = (await owner<{ id: string }>(`insert into fin_purchase_in_lines (upload_id, business_id, period, row_no, material, supplier, qty, amount, tx_date)
      values ('${await up('purchase_in')}', 'biz_dy', '${ym}', 4, '가짜원료알파', '가짜 공급처', ${qty}, ${amount}, '${T}') returning line_id::text as id`))[0].id
  const pin2 = (await owner<{ id: string }>(`insert into fin_purchase_in_lines (upload_id, business_id, period, row_no, material, supplier, qty, amount)
      select upload_id, business_id, period, 5, '가짜원료베타', '가짜 공급처', 10, 1000 from fin_purchase_in_lines where line_id = ${pin} returning line_id::text as id`))[0].id
  const imp = (await owner<{ id: string }>(`insert into fin_import_lines (upload_id, business_id, period, row_no, ref_no, material, supplier, currency, amount, fx_rate, amount_krw, extra_cost)
      values ('${await up('import')}', 'biz_dy', '${ym}', 3, 'OFFER-가짜-1', '가짜원료알파', '가짜 공급처', 'USD', 1000, 1400, 1400000, 35000) returning line_id::text as id`))[0].id
  const sal = (await owner<{ id: string }>(`insert into fin_sales_lines (upload_id, business_id, period, row_no, customer, product, qty, unit_price, amount, tx_date, counterparty)
      values ('${await up('sales')}', 'biz_dy', '${ym}', 2, '(주)가짜상사', '가짜 제품', 50, 9000, 450000, '${T}', '김가짜') returning line_id::text as id`))[0].id

  const L = (uid: string | null, all = false) => as<Record<string, unknown>>(uid, `select * from cost_fin_candidates('biz_dy', ${all})`)
  const decide = (uid: string, src: string, line: string, action: string, reason: string | null, extra = '') =>
    run(uid, `select cost_fin_candidate_decide('biz_dy', '${src}', ${line}, '${action}', ${reason === null ? 'null' : `'${reason}'`}${extra}) as v`) as Promise<{ v: string }[]>
  const audits = async () => (await owner<{ n: number }>(`select count(*)::int as n from audit_log where entity_table = 'cost_fin_candidate_decisions'`))[0].n

  // 스위치 기본(대표만)
  await refuses(L(U.cost), /feature_off/, '0078: 스위치 기본(대표만)인데 원가 관리가 후보를 읽었다')
  const chairRows = await L(U.chair)
  assert.deepEqual([...new Set(chairRows.map((r) => r.kind))].sort(), ['landed', 'purchase_lot', 'sale'], '0078: 대표 후보에 세 종류가 없다')
  assert.deepEqual(Object.keys(chairRows[0]).sort(), ['amount_krw', 'counterparty', 'extra_krw', 'kind', 'last_action', 'last_at', 'last_reason', 'line_id', 'name', 'period', 'qty', 'ref_no', 'source_table', 'target_ref', 'tx_date', 'unit_krw_per_kg'], '0078: 후보 칸에 BOM · 투입이 섞였다')
  await run(U.chair, `select feature_switch_set('cost_candidates', 'biz_dy', true, 'all', '0078 시험')`)

  // 문 — 원가 관리 쓰기 · 대표만. 영업 · 구매만 · CFO · anon 거부.
  for (const uid of [U.sales, U.buy, U.cfo, U.exec, U.vana]) await refuses(L(uid), /cost_not_found/, `0078: ${uid.slice(-2)}가 후보를 읽었다`)
  await refuses(as(null, `select * from cost_fin_candidates('biz_dy', false)`), /permission denied/, '0078: anon이 후보를 읽었다')
  await refuses(as(U.cost, `select * from cost_fin_candidate_decisions`), /permission denied/, '0078: 결정 표를 직접 읽었다')
  assert.ok((await L(U.cost)).length >= 4, '0078: 원가 관리가 후보를 못 본다')

  // 이유 필수 · 나중에 · 무시
  const a0 = await audits()
  await refuses(decide(U.cost, 'fin_purchase_in_lines', pin, 'later', null), /cost_candidate_reason/, '0078: 이유 없이 결정됐다')
  await refuses(decide(U.cost, 'fin_purchase_in_lines', pin, 'later', '  '), /cost_candidate_reason/, '0078: 빈 이유로 결정됐다')
  await decide(U.cost, 'fin_purchase_in_lines', pin, 'later', '공급처 확인 뒤')
  const later = (await L(U.cost)).find((r) => String(r.line_id) === pin && r.source_table === 'fin_purchase_in_lines')
  assert.equal(later?.last_action, 'later', '0078: «나중에»가 후보에 남지 않는다')
  await decide(U.cost, 'fin_purchase_in_lines', pin2, 'ignore', '샘플 입고 — 원가에 안 씀')
  assert.ok(!(await L(U.cost)).some((r) => String(r.line_id) === pin2 && r.source_table === 'fin_purchase_in_lines'), '0078: «무시»한 줄이 후보에 남았다')
  assert.ok((await L(U.cost, true)).some((r) => String(r.line_id) === pin2 && r.last_action === 'ignore'), '0078: 끝난 것 보기에 «무시»가 없다')
  await refuses(decide(U.cost, 'fin_purchase_in_lines', pin2, 'later', '다시'), /cost_candidate_done/, '0078: 무시한 줄을 다시 결정했다')

  // 넣기 — 원래 입력 문도. 원가 관리만(구매 쓰기 없음)은 거부.
  const mat = `, '${lot.material_id}', '${lot.supplier_id}'`
  await refuses(decide(U.cost, 'fin_purchase_in_lines', pin, 'lot', '입고 확인', mat), /cost_not_found/, '0078: 구매 쓰기 없이 LOT를 넣었다')
  const [{ v: newLot }] = await decide(U.both, 'fin_purchase_in_lines', pin, 'lot', '입고 확인', mat)
  const [nl] = await owner<{ source: string; source_ref: string; qty: string; landed: string; by: string }>(
    `select source, source_ref, qty_kg::text as qty, round(landed_krw_per_kg)::text as landed, created_by::text as by from cost_purchase_lots where lot_id = '${newLot}'`)
  assert.deepEqual([nl.source, nl.source_ref, Number(nl.qty), nl.by], ['import', `fin_purchase_in_lines:${pin}`, qty, U.both], '0078: 입고 후보가 LOT로 들어가지 않았다(0061 길)')
  assert.equal(Number(nl.landed), Math.round(amount / qty), '0078: LOT Landed가 금액 ÷ 수량이 아니다')
  await refuses(decide(U.both, 'fin_purchase_in_lines', pin, 'lot', '두 번', mat), /cost_candidate_done/, '0078: 같은 입고 줄이 LOT로 두 번 들어갔다')
  const [{ n: nLater }] = await owner<{ n: number }>(`select count(*)::int as n from cost_fin_candidate_decisions where line_id = ${pin} and action = 'later' and superseded_at is null`)
  assert.equal(nLater, 0, '0078: 넣은 뒤에도 «나중에»가 살아 있다')

  // ⑦ Landed 부대비 — 고른 LOT 무효 + 부대비 더한 새 LOT
  const [{ v: lot2 }] = await decide(U.both, 'fin_import_lines', imp, 'lot', 'OFFER 부대비', `, null, null, null, '${newLot}'`)
  const [old] = await owner<{ v: string | null }>(`select voided_at::text as v from cost_purchase_lots where lot_id = '${newLot}'`)
  assert.ok(old.v, '0078: 부대비 반영 뒤 앞 LOT가 살아 있다')
  const [n2] = await owner<{ other: string; ref: string }>(`select other_krw::text as other, source_ref as ref from cost_purchase_lots where lot_id = '${lot2}'`)
  assert.deepEqual([Number(n2.other), n2.ref], [35000, `fin_import_lines:${imp}`], '0078: 부대비가 새 LOT 기타 부대비에 없다')

  // ① 판매 — 0067 sale_record. 원가 관리만(영업 쓰기 없음)은 거부 · 대표 됨.
  await refuses(decide(U.cost, 'fin_sales_lines', sal, 'lot', '판매 확인', `, null, null, null, null, '${p1}'`), /sale_not_found/, '0078: 영업 쓰기 없이 판매를 넣었다')
  await refuses(decide(U.chair, 'fin_sales_lines', sal, 'lot', '판매 확인', `, null, null, null, null, 'prd_fake_nope_0078'`), /cost_candidate_invalid/, '0078: 다른 회사 · 없는 제품으로 판매를 넣었다(I3)')
  const [{ v: sale }] = await decide(U.chair, 'fin_sales_lines', sal, 'lot', '판매 확인', `, null, null, null, null, '${p1}'`)
  const [s] = await owner<{ kg: string; price: string }>(`select kg::text, price_krw_per_kg::text as price from cost_sales where sale_id = '${sale}'`)
  assert.deepEqual([Number(s.kg), Number(s.price)], [50, 9000], '0078: 판매 후보가 0067 판매 실적으로 들어가지 않았다')

  // 리뷰 고침 I5 — LOT · 판매로 넣은 줄이 있는 올리기는 바꾸기 · 되돌리기 거부
  for (const [t, id] of [['fin_purchase_in_lines', pin], ['fin_sales_lines', sal]] as const) {
    await refuses(owner(`update fin_uploads set status = 'reverted' where upload_id = (select upload_id from ${t} where line_id = ${id})`), /cost_candidate_live/, `0078: 넣은 줄이 있는 올리기를 되돌렸다(${t})`)
  }
  // 감사 — 결정마다 한 줄(나중에 · 무시 · LOT · Landed · 판매 = 5)
  assert.equal(await audits(), a0 + 5, '0078: 결정마다 감사 한 줄이 아니다')
  // 다시 리뷰 I-B — 만든 판매를 무효로 하면 지킴이 풀린다(되돌리기 됨)
  await owner(`update cost_sales set voided_at = now(), voided_by = '${U.chair}', void_reason = '0078 시험 무효' where sale_id = '${sale}'`)
  await owner(`update fin_uploads set status = 'reverted' where upload_id = (select upload_id from fin_sales_lines where line_id = ${sal})`)

  // 끄면 대표도 꺼진다 · 되돌림
  await run(U.chair, `select feature_switch_set('cost_candidates', 'biz_dy', false, 'all', '0078 시험 끄기')`)
  await refuses(L(U.chair), /feature_off/, '0078: 스위치를 껐는데 대표가 후보를 읽었다')
  await run(U.chair, `select feature_switch_set('cost_candidates', 'biz_dy', true, 'chairman', '0078 시험 되돌림')`)
  await refuses(L(U.cost), /feature_off/, '0078: 대표만으로 되돌렸는데 원가 관리가 읽었다')
  console.log('⑮ 0078 원가 후보 승인(스위치 · 문 · 이유 · 나중에/무시/넣기 · 원래 입력 문 · 한 번 · Landed 무효+새 LOT · 판매 0067 · 감사 · 칸) OK')
}
