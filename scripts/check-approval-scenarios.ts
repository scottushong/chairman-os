/**
 * 0059 결재 블록의 dummy 시나리오 — 회장 지시 7단계 목록 그대로, 사람을 바꿔 가며(DUMMY_USER) dummy 저장소로 돈다.
 *
 *   ① 사원(상사 = 대표) 30만 → 대표 승인 대기 → 대표 «한 번에 승인»
 *   ② 사원(상사 = 팀장, 팀장 상사 = 대표) 30만 → 팀장 승인으로 종결
 *   ③ 600만 → 팀장 → 대표
 *   ④ 반려(사유) → 재상신
 *   ⑤ 결재 대장 거르기 · 합계 · 엑셀
 *   ⑥ 권한 없는 사람의 대장 0건
 *
 * DB 판정은 scripts/check-migrations.ts approvalChain()이 잰다. 이 파일은 dummy 거울 · 화면이 쓰는 함수들이 같은 이야기를 하는지 본다.
 * 실행: npx tsx --conditions=react-server scripts/check-approval-scenarios.ts
 */
import assert from 'node:assert/strict'

import ExcelJS from 'exceljs'

import { loadLedger } from '../src/lib/approval-ledger-load'
import { buildLedgerWorkbook } from '../src/lib/approval-ledger-xlsx'
import { canExportLedger, ledgerHistory, ledgerTotals, parseLedgerFilters } from '../src/lib/approval-ledger'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { DUMMY_UID, setDummyModuleGrant } from '../src/lib/repository/dummy-org'

const as = (key: string) => {
  process.env.DUMMY_USER = key
}
const actor = (uid: string, role: 'Member' | 'TeamLead' | 'Chairman') => ({ user_id: uid, role })
const today = new Date().toISOString().slice(0, 10)
const expense = (amount: string) => ({
  business_id: 'biz_dy',
  title: `지출 ${amount}`,
  options: ['승인', '반려'],
  impact: 'Low' as const,
  deadline: today,
  template_key: 'expense' as const,
  form: { amount, purpose: '비품', spent_on: today, vendor: amount === '300000' ? '오피스디포' : '한빛기계' },
})
const steps = async (id: string) => (await repo.listApprovalSteps([id])).map((s) => `${s.approver_name}:${s.status}`)
const status = async (id: string) => (await repo.listDecisions()).find((d) => d.decision_id === id)?.status

async function main() {
  // ① 경영지원 사원(상사 = 대표) 30만 — «기록 완료»가 아니라 대표 대기.
  as('support_staff')
  const a1 = await repo.createDecision(expense('300000'), actor(DUMMY_UID.supportStaff, 'Member'))
  const a2 = await repo.createDecision({ ...expense('300000'), title: '두 번째 소액' }, actor(DUMMY_UID.supportStaff, 'Member'))
  assert.equal(a1.status, 'Open', '① 30만이 대표 대기가 아니다(«기록 완료»?)')
  assert.deepEqual(await steps(a1.decision_id), ['대표:pending'], '① 단계가 대표 한 칸이 아니다')
  await assert.rejects(repo.approvalDecide(a1.decision_id, true, null, actor(DUMMY_UID.supportStaff, 'Member')), /approval_not_found/, '① 기안자가 자기 결재를 처리한다')

  // ② 생산 직원(상사 = 생산팀장, 팀장 상사 = 대표) 30만 — 팀장 승인으로 종결.
  as('prod_staff')
  const b1 = await repo.createDecision(expense('300000'), actor(DUMMY_UID.prodStaff, 'Member'))
  assert.deepEqual(await steps(b1.decision_id), ['생산팀장:pending'], '② 30만이 직속 상사 한 칸이 아니다')
  // ③ 600만 — 팀장 → 대표.
  const b2 = await repo.createDecision(expense('6,000,000'), actor(DUMMY_UID.prodStaff, 'Member'))
  assert.deepEqual(await steps(b2.decision_id), ['생산팀장:pending', '대표:waiting'], '③ 600만이 팀장 → 대표가 아니다')
  // ④ 반려할 것.
  const b3 = await repo.createDecision(expense('1,200,000'), actor(DUMMY_UID.prodStaff, 'Member'))

  as('chairman')
  await assert.rejects(repo.approvalDecide(b2.decision_id, true, null, actor(DUMMY_UID.chair, 'Chairman')), /approval_not_your_turn/, '③ 대표가 팀장 차례를 건너뛴다')

  as('prod_lead')
  assert.equal(await repo.approvalDecide(b1.decision_id, true, '확인', actor(DUMMY_UID.prodLead, 'TeamLead')), 'approved', '② 팀장 승인으로 종결되지 않는다')
  assert.equal(await status(b1.decision_id), 'Approved')
  assert.equal(await repo.approvalDecide(b2.decision_id, true, null, actor(DUMMY_UID.prodLead, 'TeamLead')), 'next', '③ 팀장 승인 뒤 대표 차례가 아니다')
  await assert.rejects(repo.approvalDecide(b3.decision_id, false, '  ', actor(DUMMY_UID.prodLead, 'TeamLead')), /approval_reason_required/, '④ 사유 없는 반려')
  assert.equal(await repo.approvalDecide(b3.decision_id, false, '견적서 두 곳 더', actor(DUMMY_UID.prodLead, 'TeamLead')), 'rejected')

  // ④ 재상신 — 생산 직원이 고쳐 다시 올린다. 두 번은 안 된다. 알림이 갔다.
  as('prod_staff')
  const inbox = await repo.listNotifications(20)
  assert.ok(inbox.items.some((n) => n.title.startsWith('결재 반려') && (n.body ?? '').includes('견적서 두 곳 더')), '④ 반려 알림이 없다')
  assert.ok(inbox.items.some((n) => n.title.startsWith('결재 최종 승인')), '② 최종 승인 알림이 없다')
  const b4 = await repo.createDecision({ ...expense('1,200,000'), resubmit_of: b3.decision_id }, actor(DUMMY_UID.prodStaff, 'Member'))
  assert.equal(b4.resubmit_of, b3.decision_id)
  assert.deepEqual(await steps(b4.decision_id), ['생산팀장:pending'], '④ 재상신이 새 결재로 서지 않는다')
  await assert.rejects(repo.createDecision({ ...expense('1,200,000'), resubmit_of: b3.decision_id }, actor(DUMMY_UID.prodStaff, 'Member')), /resubmit_once/, '④ 같은 원본을 두 번 재상신한다')

  // ① 대표 «한 번에 승인» — 하나라도 남의 차례면 아무것도 안 바뀐다.
  as('chairman')
  await assert.rejects(repo.approvalDecideMany([a1.decision_id, a2.decision_id, b4.decision_id], null, actor(DUMMY_UID.chair, 'Chairman')), /approval_not_your_turn/, '① 남의 차례가 섞인 한 번에 승인')
  assert.equal(await status(a1.decision_id), 'Open', '① 실패한 한 번에 승인이 일부를 닫았다')
  assert.equal(await repo.approvalDecideMany([a1.decision_id, a2.decision_id, b2.decision_id], null, actor(DUMMY_UID.chair, 'Chairman')), 3, '① 한 번에 승인 건수')
  assert.deepEqual([await status(a1.decision_id), await status(a2.decision_id), await status(b2.decision_id)], ['Approved', 'Approved', 'Approved'])

  // ⑤ 결재 대장 — 대표: 전부 · 거르기 · 합계 · 엑셀.
  const all = await loadLedger(repo, 'Chairman', parseLedgerFilters({ company: 'biz_dy' }))
  assert.equal(all.rows.length, 6, `⑤ 대표의 DY 대장이 6건이 아니다(${all.rows.length})`)
  const big = await loadLedger(repo, 'Chairman', parseLedgerFilters({ company: 'biz_dy', min: '1000000' }))
  assert.equal(big.rows.length, 3, '⑤ 금액 100만 이상 거르기')
  const vendor = await loadLedger(repo, 'Chairman', parseLedgerFilters({ company: 'biz_dy', vendor: '오피스' }))
  assert.equal(vendor.rows.length, 3, '⑤ 구입처 거르기')
  const totals = ledgerTotals(all.rows, 'month')
  assert.equal(totals.count, 6)
  assert.equal(totals.sum, 300000 * 3 + 6000000 + 1200000 * 2, '⑤ 합계 금액')
  const wb = buildLedgerWorkbook({
    rows: all.rows, totals, history: ledgerHistory(all.rows, all.steps, all.decisions, 'Chairman'), templates: all.templates,
    filters: parseLedgerFilters({ company: 'biz_dy' }), businessNames: Object.fromEntries(all.businesses.map((b) => [b.business_id, b.name])),
  })
  const back = new ExcelJS.Workbook()
  await back.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer)
  assert.deepEqual(back.worksheets.map((w) => w.name), ['목록', '묶음 합계', '결재선 이력'], '⑤ 엑셀 시트')
  assert.equal(back.getWorksheet('목록')!.rowCount, 7, '⑤ 엑셀 목록 줄 수(머리 + 6)')

  // ⑥ 권한 없는 사람의 대장 0건 · 대장 권한을 켜면 DY 전부.
  as('sales_staff')
  const none = await loadLedger(repo, 'Member', parseLedgerFilters({}))
  assert.equal(none.rows.length, 0, `⑥ 권한 없는 사람의 대장이 0건이 아니다(${none.rows.length})`)
  assert.equal(canExportLedger('Member', [], 'biz_dy'), false, '⑥ 권한 없는 사람이 엑셀을 내려받는다')
  setDummyModuleGrant(DUMMY_UID.salesStaff, { module: '/approvals/ledger/biz_dy', can_write: true, can_approve: false })
  const granted = await loadLedger(repo, 'Member', parseLedgerFilters({ company: 'biz_dy' }))
  assert.equal(granted.rows.length, 6, '⑥ «DY 결재 대장 열람»을 켠 사람이 DY 전부를 못 본다')
  assert.equal(canExportLedger('Member', ['biz_dy'], 'biz_dy'), true)
  // 직원 용어 — 직원이 보는 대장 줄에 «회장»이 없다.
  assert.ok(!JSON.stringify(granted.rows).includes('회장'), '직원 대장에 «회장»')

  console.log('check:approval-scenarios 통과 — ① 대표 대기 · 한 번에 승인 ② 팀장 종결 ③ 팀장 → 대표 ④ 반려 → 재상신 ⑤ 대장 거르기 · 합계 · 엑셀 ⑥ 권한 없음 0건')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
