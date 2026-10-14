/**
 * PHASE 6 원가 후보 승인(0078) — dummy 거울 · 정적 검사. DB 쪽(진짜 0078 함수)은 check:cost-engine ⑮ · check:staging-sql-cost.
 *   ① dummy: 스위치 기본(대표만) · 원가 관리 쓰기만 · 이유 필수 · 나중에 · 무시 · LOT로 넣기(구매 쓰기 문) · Landed(무효 + 새 LOT) · 판매(영업 쓰기 문) · 두 번 거부
 *   ② 정적: 화면 · 액션이 스위치를 본다 · 화면에 BOM · 비율 · 내려받기 · «회장» · «ECOUNT 올리기» 없음 · 0078 RPC 첫 줄 스위치
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dummyRepository as repo } from '../src/lib/repository/dummy'

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.DUMMY_USER
  process.env.DUMMY_USER = user
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.DUMMY_USER
    else process.env.DUMMY_USER = prev
  }
}

async function main() {
  const B = 'biz_dy'
  await assert.rejects(as('support_lead', () => repo.listCostCandidates(B, false)), /feature_off/, 'dummy: 스위치 기본(대표만)인데 원가 관리가 읽었다')
  const chair = await as('chairman', () => repo.listCostCandidates(B, false))
  assert.deepEqual([...new Set(chair.map((c) => c.kind))].sort(), ['landed', 'purchase_lot', 'sale'], 'dummy: 대표 후보 세 종류')
  for (const c of chair) for (const k of Object.keys(c)) assert.ok(!/bom|ratio|kg_per_kg|yield/i.test(k), `dummy: 후보 칸 ${k}`)
  await as('chairman', () => repo.setFeatureSwitch({ feature_key: 'cost_candidates', business_id: B, enabled: true, audience: 'all', reason: '시험' }))
  for (const u of ['sales_staff', 'buy_staff', 'exec']) await assert.rejects(as(u, () => repo.listCostCandidates(B, false)), /cost_not_found/, `dummy: ${u}가 후보를 읽었다`)

  const rows = await as('support_lead', () => repo.listCostCandidates(B, false))
  const pur = rows.filter((r) => r.kind === 'purchase_lot')
  assert.ok(pur.length >= 2, 'dummy: 입고 후보가 둘 이상이 아니다')
  const [p1, p2] = pur
  const landed = rows.find((r) => r.kind === 'landed')!
  const sale = rows.find((r) => r.kind === 'sale')!
  await assert.rejects(as('support_lead', () => repo.decideCostCandidate(B, { source: p1.source_table, line_id: p1.line_id, action: 'later', reason: ' ' })), /cost_candidate_reason/, 'dummy: 이유 없이')
  await as('support_lead', () => repo.decideCostCandidate(B, { source: p1.source_table, line_id: p1.line_id, action: 'later', reason: '공급처 확인 뒤' }))
  assert.equal((await as('support_lead', () => repo.listCostCandidates(B, false))).find((r) => r.line_id === p1.line_id && r.kind === 'purchase_lot')?.last_action, 'later', 'dummy: 나중에가 남지 않는다')
  await as('support_lead', () => repo.decideCostCandidate(B, { source: p2.source_table, line_id: p2.line_id, action: 'ignore', reason: '샘플' }))
  assert.ok(!(await as('support_lead', () => repo.listCostCandidates(B, false))).some((r) => r.line_id === p2.line_id && r.kind === 'purchase_lot'), 'dummy: 무시한 줄이 남았다')
  await assert.rejects(as('support_lead', () => repo.decideCostCandidate(B, { source: p2.source_table, line_id: p2.line_id, action: 'later', reason: '다시' })), /cost_candidate_done/, 'dummy: 무시한 줄 다시')

  const mats = await as('chairman', () => repo.listCostMaterials(B))
  const sups = await as('chairman', () => repo.listCostSuppliers(B))
  const d = { source: p1.source_table, line_id: p1.line_id, action: 'lot' as const, reason: '입고 확인', material_id: mats[0].material_id, supplier_id: sups[0].supplier_id }
  await assert.rejects(as('support_lead', () => repo.decideCostCandidate(B, d)), /cost_not_found/, 'dummy: 구매 쓰기 없이 LOT를 넣었다')
  const lot = await as('chairman', () => repo.decideCostCandidate(B, d))
  const lots = await as('chairman', () => repo.listPurchaseLots(B))
  assert.ok(lots.some((l) => l.lot_id === lot && !l.voided_at), 'dummy: 입고 후보가 LOT로 들어가지 않았다')
  await assert.rejects(as('chairman', () => repo.decideCostCandidate(B, d)), /cost_candidate_done/, 'dummy: 같은 줄 두 번')
  const lot2 = await as('chairman', () => repo.decideCostCandidate(B, { source: landed.source_table, line_id: landed.line_id, action: 'lot', reason: '부대비', lot_id: lot }))
  const after = await as('chairman', () => repo.listPurchaseLots(B))
  assert.ok(after.find((l) => l.lot_id === lot)?.voided_at, 'dummy: Landed 반영 뒤 앞 LOT가 살아 있다')
  assert.equal(after.find((l) => l.lot_id === lot2)?.other_krw, (landed.extra_krw ?? 0), 'dummy: 새 LOT 기타 부대비')
  await assert.rejects(as('support_lead', () => repo.decideCostCandidate(B, { source: sale.source_table, line_id: sale.line_id, action: 'lot', reason: '판매', product_id: 'prd_fake_x' })), /sale_not_found/, 'dummy: 영업 쓰기 없이 판매')
  assert.match(await as('chairman', () => repo.decideCostCandidate(B, { source: sale.source_table, line_id: sale.line_id, action: 'lot', reason: '판매', product_id: 'prd_fake_x' })), /^sl_/, 'dummy: 판매 넣기')
  await as('chairman', () => repo.setFeatureSwitch({ feature_key: 'cost_candidates', business_id: B, enabled: false, audience: 'all', reason: '시험 끄기' }))
  await assert.rejects(as('chairman', () => repo.listCostCandidates(B, false)), /feature_off/, 'dummy: 끄면 대표도 꺼짐')
  console.log('① dummy 거울(스위치 · 문 · 이유 · 나중에/무시/넣기 · 원래 입력 문 · 두 번 · Landed · 판매) OK')

  // ── ② 정적 ──
  const root = join(__dirname, '..')
  const page = readFileSync(join(root, 'src/app/(dashboard)/costs/[business_id]/candidates/page.tsx'), 'utf8')
  const act = readFileSync(join(root, 'src/app/actions/cost-candidates.ts'), 'utf8')
  const lib = readFileSync(join(root, 'src/lib/costs/candidates.ts'), 'utf8')
  const sql = readFileSync(join(root, 'supabase/migrations/0078_cost_candidates.sql'), 'utf8')
  assert.match(page, /featureOn\(user, 'cost_candidates', business_id\)\)\) notFound\(\)/, '화면이 스위치를 보지 않는다')
  assert.match(act, /featureOn\(user, 'cost_candidates', businessId\)/, '액션이 스위치를 보지 않는다')
  for (const t of [page, act, lib]) {
    assert.ok(!/회장|ECOUNT 올리기/.test(t), '직원 화면 문구에 «회장» · «ECOUNT 올리기»')
    assert.ok(!/bom|kg_per_kg|productBreakdown|download|xlsx/i.test(t.replace(/BOM · 원료 비율 · 제품별 투입은 없다|BOM · 비율/g, '')), '후보 화면이 BOM · 내려받기를 부른다')
  }
  for (const fn of ['cost_fin_candidates', 'cost_fin_candidate_decide']) {
    const body = sql.slice(sql.indexOf(`create or replace function ${fn}(`))
    const first = body.slice(body.indexOf('begin'), body.indexOf('begin') + 200)
    assert.match(first, /feature_on\('cost_candidates', p_business\)/, `${fn} 첫 줄이 스위치가 아니다`)
  }
  assert.ok(!/disable row level security|no force row level security/i.test(sql), '0078이 RLS를 끈다')
  console.log('② 정적(스위치 · 문구 · BOM 없음 · RPC 첫 줄) OK')
  console.log('PASS: check:cost-candidates')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
