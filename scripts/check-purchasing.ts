/**
 * 구매 화면(원가 엔진 1차) 순수 함수 검사 — npm run check:purchasing
 *
 *   ① Landed 미리보기 = 0061 cost_lot_calc와 같은 식 · 반올림
 *   ② 주 = ISO 월요일(연도 경계 포함) · 월 = 1일
 *   ③ 주 · 월 묶기 — 구매가는 수량 가중, 시장가는 날 평균
 *   ④ 개요 — 최신 시장가(같은 날 출처 평균) · 최근 LOT vs 그 날 시장가 · 30일 가중 · 공급처별 · 무효 제외
 *   ⑤ 첨부 — 형식 · 4MB · 저장 이름(ASCII · '..' 없음) · CSV 배합비 감지(mix-ratio.ts, AI 없음)
 *   ⑥ 오류 문구 — DB 이유 코드 → 한국어, «회장» 없음
 *   ⑦ mix-ratio.ts가 feat/intake 사본과 같은가(있으면)
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { detectMixRatio } from '../src/lib/intake/mix-ratio'
import { aggregate, isoMonday, landedPreview, materialOverview, vsMarketPct, bucketOf } from '../src/lib/purchasing/calc'
import { checkPurchaseDocFile, csvToTabbed, PURCHASE_DOC_MAX_BYTES, purchaseDocMime, storageDocName } from '../src/lib/purchasing/doc-rules'
import { purchasingError } from '../src/lib/purchasing/errors'
import type { MarketPrice, PurchaseLot } from '../src/types'

// ① Landed
const p = landedPreview({ qty_kg: 5000, unit_price: 1.62, fx_rate: 1380.5, freight_krw: 1_450_000, duty_krw: 690_000, other_krw: 210_000 })!
assert.equal(p.goods_krw, 11_182_050)
assert.equal(p.landed_krw_per_kg, Math.round(((11_182_050 + 2_350_000) / 5000) * 10_000) / 10_000)
assert.equal(landedPreview({ qty_kg: 0, unit_price: 1, fx_rate: 1, freight_krw: 0, duty_krw: 0, other_krw: 0 }), null)
assert.equal(landedPreview({ qty_kg: 10, unit_price: 1, fx_rate: null, freight_krw: 0, duty_krw: 0, other_krw: 0 }), null, '환율 없으면 미리보기 없음')

// ② ISO 주
assert.equal(isoMonday('2026-10-09'), '2026-10-05') // 금 → 월
assert.equal(isoMonday('2026-10-05'), '2026-10-05')
assert.equal(isoMonday('2026-10-11'), '2026-10-05') // 일 → 그 주 월
assert.equal(isoMonday('2027-01-01'), '2026-12-28') // 연도 경계
assert.equal(bucketOf('2026-10-09', 'month'), '2026-10-01')

// ③ 묶기
const wk = aggregate(
  [
    { date: '2026-10-05', value: 1000, kg: 100 },
    { date: '2026-10-07', value: 2000, kg: 300 },
    { date: '2026-10-12', value: 1500, kg: 10 },
  ],
  'week',
)
assert.deepEqual(wk.map((x) => [x.bucket, x.value, x.weight]), [
  ['2026-10-05', 1750, 400],
  ['2026-10-12', 1500, 10],
])
const mk = aggregate([{ date: '2026-10-05', value: 1000 }, { date: '2026-10-06', value: 2000 }], 'week')
assert.equal(mk[0].value, 1500, '시장가 주 = 날 평균')

// ④ 개요
const price = (material_id: string, observed_on: string, v: number, src = 'a', voided = false): MarketPrice => ({
  price_id: Math.random(),
  business_id: 'biz_dy',
  material_id,
  observed_on,
  price: v,
  currency: 'KRW',
  fx_rate: 1,
  price_krw_per_kg: v,
  source_name: src,
  source_url: null,
  note: '',
  created_at: `${observed_on}T00:00:00Z`,
  voided_at: voided ? 'x' : null,
  void_reason: voided ? 'x' : null,
})
const lot = (received_on: string, landed: number, qty: number, supplier_id: string, voided = false): PurchaseLot => ({
  lot_id: `PL-${received_on.replace(/-/g, '')}-AAAAAA`,
  business_id: 'biz_dy',
  material_id: 'm',
  supplier_id,
  received_on,
  ordered_on: null,
  supplier_lot_no: '',
  qty_kg: qty,
  unit_price: landed,
  currency: 'KRW',
  fx_rate: 1,
  freight_krw: 0,
  duty_krw: 0,
  other_krw: 0,
  goods_krw: landed * qty,
  landed_krw_per_kg: landed,
  source: 'manual',
  source_ref: null,
  note: '',
  created_at: `${received_on}T00:00:00Z`,
  voided_at: voided ? 'x' : null,
  void_reason: voided ? 'x' : null,
})
const prices = [price('m', '2026-10-01', 1000), price('m', '2026-10-05', 1100), price('m', '2026-10-05', 1300, 'b'), price('m', '2026-10-08', 9999, 'a', true)]
const lots = [lot('2026-09-01', 900, 100, 's1'), lot('2026-10-03', 1100, 300, 's1'), lot('2026-10-06', 1320, 100, 's2'), lot('2026-10-07', 99999, 1, 's2', true)]
const o = materialOverview('m', prices, lots, '2026-10-09')
assert.deepEqual(o.latestMarket, { date: '2026-10-05', value: 1200 }, '같은 날 출처 평균 · 무효 제외')
assert.equal(o.latestLot?.landed, 1320, '무효 LOT 제외')
assert.equal(o.latestLotVsMarketPct, vsMarketPct(1320, 1200))
assert.equal(o.latestLotVsMarketPct, 10)
assert.equal(o.avg30?.value, (1100 * 300 + 1320 * 100) / 400, '30일 수량 가중 — 9/1은 밖')
assert.deepEqual(o.bySupplier.map((s) => [s.supplier_id, s.value]), [
  ['s1', (900 * 100 + 1100 * 300) / 400],
  ['s2', 1320],
])

// ⑤ 첨부
assert.equal(purchaseDocMime('단가표.CSV', ''), 'text/csv')
assert.equal(purchaseDocMime('x.pptx', ''), null)
assert.equal(checkPurchaseDocFile({ name: 'a.pdf', type: 'application/pdf', size: PURCHASE_DOC_MAX_BYTES + 1 })?.includes('4MB'), true)
assert.equal(checkPurchaseDocFile({ name: 'a.pdf', type: 'application/pdf', size: 100 }), null)
assert.equal(storageDocName('견적서 10월.pdf'), '10.pdf')
assert.equal(storageDocName('../../etc/passwd'), 'etc_passwd')
assert.equal(storageDocName('가격.xlsx'), 'doc.xlsx')
assert.ok(!storageDocName('a..b..pdf').includes('..'))
const mixCsv = '원료,비율(%)\n원료 A,62.5\n원료 B,30\n첨가제 C,7.5\n'
assert.equal(detectMixRatio([csvToTabbed(mixCsv)]).hit, true, 'CSV 배합비(퍼센트 합 100)를 놓쳤다')
const priceCsv = '품목,단가(원/kg),최소 주문(kg)\n원료 A,2450,1000\n원료 B,"2,600",500\n원료 C,5100,200\n'
assert.equal(detectMixRatio([csvToTabbed(priceCsv)]).hit, false, '평범한 단가표를 배합비로 걸었다')

// ⑥ 오류 문구
assert.equal(purchasingError(new Error('cost_fx_missing')), '그 날짜의 환율이 없습니다 — 환율을 직접 넣으세요.')
assert.equal(purchasingError(new Error('cost_not_found')), '찾을 수 없거나 권한이 없습니다.')
assert.equal(
  purchasingError(new Error('Supabase cost_purchase_lots 23505: duplicate key value violates unique constraint "cost_purchase_lots_one_per_approval"')),
  '이 결재는 이미 LOT로 들어갔습니다.',
)
assert.match(purchasingError(new Error('cost_price_outlier')), /90일/)
assert.equal(purchasingError(new Error('cost_date_future')), '내일보다 먼 날짜는 넣을 수 없습니다.')
assert.equal(purchasingError(new Error('cost_price_too_many')), '같은 원료 같은 날 시세는 출처 셋까지입니다.')
for (const code of ['cost_not_found', 'cost_fx_missing', 'cost_void_reason', 'cost_already_voided', 'cost_candidate_invalid', 'cost_price_outlier', 'cost_date_future', 'cost_price_too_many', '42501']) {
  assert.ok(!/회장|Chairman/i.test(purchasingError(new Error(code))), `${code} 문구에 회장`)
}

// ⑦ feat/intake와 같은 파일
const here = readFileSync(join(__dirname, '..', 'src', 'lib', 'intake', 'mix-ratio.ts'))
const intake = join(__dirname, '..', '..', 'chairman-os-intake', 'src', 'lib', 'intake', 'mix-ratio.ts')
// 줄끝(CRLF · LF)은 checkout마다 다르다 — git은 같은 blob으로 본다. 줄끝만 맞춰 비교한다.
const lf = (b: Buffer) => b.toString('utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
if (existsSync(intake)) assert.equal(lf(here), lf(readFileSync(intake)), 'mix-ratio.ts가 feat/intake 사본과 다르다')

console.log('PASS: 구매 — Landed 미리보기 · ISO 주 · 수량 가중 묶기 · 개요(출처 평균 · 무효 제외 · 30일 · 공급처별) · 첨부 형식/4MB/저장 이름 · CSV 배합비 감지 · 오류 문구(회장 없음) · mix-ratio 사본')
