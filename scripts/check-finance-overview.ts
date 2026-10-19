/**
 * 0085 «넣으면 쌓이고 · 알아서 계산하고 · 한 화면에» — dummy 저장소에서 처음부터 끝까지(진짜 AI 0회 · 진짜 회사 파일 없음).
 *   npm run check:finance-overview
 *
 *   1. 가짜 18가지 + 덧붙임(scripts/fixtures/finance-18.ts)을 순서를 섞어 김병훈 자리(사원 · DY 재무 입력)로 놓는다 → 전부 저장(보류는 급여 개인 줄 하나뿐) ·
 *      계정과목표가 뒤에 와도 «자동 생성» 계정이 덮어써진다 · 체크표 18/18 · 다시 계산 큐 → 저장본.
 *   2. 재무 현황(요약 · 일별 · 달력 · 손익 · 12가지 지표)이 그 자료로 계산된다 — 매출 · 재고 반영 원가 · 차입 · 현금 · 매출 상위 kg.
 *   3. 같은 달 다시 놓기 → 새 값 · 이력(replaced) · 되돌리기 → 옛 값.
 *   4. 일부 빠진 달(10월) → «잠정(무엇이 빠짐)» · 0으로 채우지 않음.
 *   5. 급여 개인 줄 — 사원은 보류(줄 내용 못 봄) · 대표만 저장. 마감 달(7월) — 사원은 보류 · 대표가 이유와 함께 저장.
 *   6. 원료별 숫자 노출 0 — 재무 현황 계산 결과 · 저장본 어디에도 원료 이름 · 단가 · kg 칸이 없다.
 */
import assert from 'node:assert/strict'

process.env.DUMMY_FIN_DEMO = 'off'
process.env.DUMMY_USER = 'teamless_staff'

import { computeCalendar, computeDaily } from '../src/lib/finance-overview/cash-days'
import { computeBs, computeCash, computeDebt, computePl, computeSales } from '../src/lib/finance-overview/engine'
import { computeKpis } from '../src/lib/finance-overview/kpis'
import { loadOverview } from '../src/lib/finance-overview/load'
import { processRecalc } from '../src/lib/finance-overview/recalc'
import { processUpload, type FileCard } from '../src/lib/finance-upload/process'
import { costByBusiness, documentsByBusiness, financeByBusiness } from '../src/lib/module-grants'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyFinOverviewStore } from '../src/lib/repository/dummy-finance-upload'
import { dummyModuleGrants, dummyViewer } from '../src/lib/repository/dummy-org'
import type { SessionUser } from '../src/types'

import { buildFinanceFixtures, EXPECT, shuffle } from './fixtures/finance-18'

const BIZ = 'biz_dy'
const TODAY = '2026-10-19'

function session(): SessionUser {
  const p = dummyViewer()
  const g = dummyModuleGrants(p.user_id)
  return { user_id: p.user_id, name: p.display_name, role: p.role, title_ko: p.title_ko, display_name_en: p.display_name_en, language: 'ko', finance: financeByBusiness(g), documents: documentsByBusiness(g), cost: costByBusiness(g) }
}
const as = (key: string) => {
  process.env.DUMMY_USER = key
  return session()
}

async function upload(user: SessionUser, name: string, bytes: Uint8Array): Promise<FileCard[]> {
  return processUpload({ repo, businessId: BIZ, fileName: name, bytes, classify: null, aiBudget: 0, today: new Date(`${TODAY}T03:00:00Z`), boss: user.role === 'Chairman' || user.role === 'GroupCFO', user })
}

async function main() {
  const fixtures = await buildFinanceFixtures()
  const staff = as('teamless_staff')
  assert.equal(staff.finance[BIZ]?.write, true, '김병훈 자리에 DY 재무 입력이 없다')

  // ── 1. 순서 섞어 한 번에 ──
  const order = shuffle(fixtures)
  // 계정과목표가 계정별 원장보다 뒤에 오게(자동 생성 → 덮어쓰기를 본다).
  const iChart = order.findIndex((f) => f.expect === 'accounts')
  const iLedger = order.findIndex((f) => f.expect === 'ledger')
  if (iChart < iLedger) [order[iChart], order[iLedger]] = [order[iLedger], order[iChart]]
  const results: { name: string; expect: string; cards: FileCard[] }[] = []
  for (const f of order) results.push({ name: f.name, expect: f.expect, cards: await upload(staff, f.name, f.bytes) })
  const table: string[] = []
  for (const r of results) {
    const c = r.cards[0]
    const got = c.legacy ?? c.kind
    table.push(`${r.name} → ${got} · ${c.status} · ${c.message.slice(0, 60)}`)
    assert.equal(got, r.expect, `${r.name}: 종류를 ${got}(으)로 알아봤다 — ${r.expect}이어야 한다(${c.message})`)
    assert.equal(c.status, 'applied', `${r.name}: 저장되지 않았다 — ${c.status} · ${c.message}`)
  }
  console.log(table.join('\n'))
  const payroll = results.find((r) => r.expect === 'payroll')!.cards[0]
  assert.match(payroll.message, /개인 줄 18개는 대표 · CFO 확인 뒤 저장/, '급여 개인 줄이 보류되지 않았다')
  // 계정과목표 덮어쓰기 — 원장이 먼저 만든 «자동 생성» 1530 · 8130이 계정과목표 값으로.
  const auto = await repo.listAutoAccounts(BIZ)
  assert.ok(!auto.includes('1530') && !auto.includes('8130'), `계정과목표가 자동 생성 계정을 덮어쓰지 않았다: ${auto.join(',')}`)
  const ledger = await repo.loadFinanceLedger()
  assert.ok(ledger.accounts.some((a) => a.business_id === BIZ && a.account_code === '1530' && a.name === '원재료'), '원재료(1530) 계정이 없다')

  // ── 다시 계산 큐 → 저장본 ──
  const out = await processRecalc(repo, { businessId: BIZ, limit: 5, today: TODAY })
  assert.ok(out.jobs >= 1 && out.failed === 0, `다시 계산이 돌지 않았다: ${JSON.stringify(out)}`)
  const snap = (await repo.listFinOverviewMonths(BIZ, ['2026-09']))[0]
  assert.ok(snap, '2026-09 저장본이 없다')
  assert.equal((snap.totals.pl as { revenue: number }).revenue, EXPECT.revenue, '저장본 매출이 다르다')
  const snapText = JSON.stringify(snap)
  assert.ok(!/가짜 원료|unit_price|qty_kg|materials?/.test(snapText), '저장본에 원료별 숫자 · 이름이 실렸다')

  // ── 2. 재무 현황 계산 ──
  const loaded = await loadOverview(repo, BIZ, '2026-09', TODAY)
  const ctx = loaded.ctx
  ctx.usdKrw = 1398.5
  const pl = computePl(ctx, '2026-09')
  assert.equal(pl.revenue, EXPECT.revenue, `매출이 다르다: ${pl.revenue}`)
  assert.equal(pl.cogsBasis.method, 'inventory', `재고 반영 원가가 아니다(${pl.cogsBasis.method} · ${pl.notes.join(' ')})`)
  const opening = EXPECT.rawOpen + 1_000_000_000 * 0 + EXPECT.wip08 + EXPECT.fin08
  assert.equal(pl.cogsBasis.opening, 1_640_000_000 + EXPECT.wip08 + EXPECT.fin08, `기초 재고가 다르다: ${pl.cogsBasis.opening} (${opening})`)
  assert.equal(pl.cogsBasis.closing, EXPECT.rawClose + EXPECT.wip09 + EXPECT.fin09, `기말 재고가 다르다: ${pl.cogsBasis.closing}`)
  assert.equal(pl.cogsBasis.purchases, EXPECT.purchases, `원재료 매입이 다르다: ${pl.cogsBasis.purchases}`)
  assert.ok(pl.op !== null && pl.op > 0, '영업이익을 못 냈다')
  assert.ok(pl.taxEstimated, '장부에 법인세가 없는데 추정이 아니다')
  const bs = computeBs(ctx, '2026-09')
  assert.ok(bs.totalAssets !== null, `재무상태를 못 냈다: ${bs.note}`)
  assert.equal(bs.inventory.raw, EXPECT.rawClose, '원재료(재고금액명세서 합계)가 다르다')
  const debt = computeDebt(ctx, '2026-09')
  assert.equal(debt.total, EXPECT.loans + EXPECT.borrowing, `차입 잔액이 다르다: ${debt.total}`)
  assert.equal(debt.rows.length, 4, '대출 셋 + 대표 차입 하나가 아니다')
  const cash = computeCash(ctx, '2026-09', bs)
  assert.ok(cash.hasFlows && cash.investing! < 0 && cash.materialPaid! < 0, '현금흐름 구분(투자 · 원료대금)이 안 됐다')
  const sales = computeSales(ctx, '2026-09')
  assert.equal(sales.rows[0].customer, 'A사')
  assert.equal(sales.rows[0].kg, 148_200, '매출 상위 kg가 출하집계표 값이 아니다')
  const kpis = computeKpis(ctx, '2026-09')
  assert.equal(kpis.length, 12)
  const lacking = kpis.filter((k) => k.need).map((k) => k.title)
  assert.deepEqual(lacking, ['제품 수익성', '거래처 수익성'], `자료 부족 지표가 예상과 다르다: ${lacking.join(' · ')}`)
  for (const k of kpis) assert.ok(k.answer && k.question, `${k.title} 판단 한 줄이 없다`)
  const daily = computeDaily(ctx)
  assert.equal(daily.balanceFrom, 'cashflow', '일별 자금보고가 자금흐름표 잔액을 못 읽었다')
  assert.ok(daily.totalUsd !== null && daily.totalUsd > 0, '달러 계좌 잔액이 없다')
  assert.ok(daily.today.length >= 3, `오늘(10/19) 입출금이 없다: ${daily.today.length}`)
  assert.equal(daily.sales.revenue, 1_186_400_000, '이달 매출(세금계산서)이 다르다')
  assert.ok(daily.sales.overdue && daily.sales.overdue.customers >= 2, '60일 넘은 미수(G사 · K사)를 못 셌다')
  const cal = computeCalendar(ctx, '2026-10')
  assert.ok(cal.days.some((d) => d.items.some((x) => x.planned)), '달력에 예정 줄이 없다')
  assert.ok(cal.days.some((d) => d.items.some((x) => x.source === 'loan')), '달력에 대출 일정이 없다')
  assert.equal(cal.forecast.length, 3)
  assert.ok(cal.forecast.every((f) => f.closing !== null), '3개월 전망 월말 잔액이 비었다')
  const checklist = loaded.checklist
  assert.equal(checklist.filter((c) => c.state === 'missing').length, 0, `체크표에 빠진 것이 있다: ${checklist.filter((c) => c.state === 'missing').map((c) => c.label).join(' · ')}`)
  const all = JSON.stringify({ pl, bs, kpis, daily, cal, sales, checklist })
  assert.ok(!/가짜 원료/.test(all), '재무 현황 계산 결과에 원료 이름이 나왔다')

  // ── 3. 같은 달 다시 놓기 → 새 값 · 이력 · 되돌리기 ──
  const salesFx = fixtures.find((f) => f.expect === 'sales')!
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(salesFx.bytes.buffer.slice(salesFx.bytes.byteOffset, salesFx.bytes.byteOffset + salesFx.bytes.byteLength) as ArrayBuffer)
  const ws = wb.worksheets[0]
  ws.getCell(`F3`).value = Number(ws.getCell('F3').value) + 1_000_000
  ws.getCell(`F${ws.rowCount}`).value = EXPECT.revenue + 1_000_000
  const again = await upload(staff, '2026_09_판매현황_수정.xlsx', new Uint8Array(await wb.xlsx.writeBuffer()))
  assert.equal(again[0].status, 'applied', `다시 놓기가 저장되지 않았다: ${again[0].message}`)
  const ups = (await repo.listFinUploads(BIZ)).filter((u) => u.kind === 'sales' && u.period === '2026-09')
  assert.deepEqual(ups.map((u) => u.status).sort(), ['applied', 'replaced'], '옛 값이 이력(replaced)으로 남지 않았다')
  const sumNow = async () => (await repo.listFinLines('sales', BIZ, ['2026-09'])).reduce((s, r) => s + Number(r.amount ?? 0), 0)
  assert.equal(await sumNow(), EXPECT.revenue + 1_000_000, '새 값으로 바뀌지 않았다')
  assert.equal(await repo.finUploadRevert(again[0].upload_id!, '시험 되돌리기'), true)
  assert.equal(await sumNow(), EXPECT.revenue, '되돌리기가 옛 값을 되살리지 않았다')

  // ── 4. 일부 빠진 달(10월) ──
  const oct = computePl(ctx, '2026-10')
  assert.equal(oct.op, null, '10월은 원장이 없는데 이익을 0으로 채웠다')
  assert.ok(oct.notes.some((n) => /계정별 원장/.test(n)), '10월 «잠정(빠진 것)» 문구가 없다')
  const octLoaded = await loadOverview(repo, BIZ, '2026-10', TODAY)
  assert.ok(octLoaded.checklist.filter((c) => c.state === 'missing').length >= 10, '10월 체크표가 빠진 것을 말하지 않는다')

  // ── 5. 급여 개인 줄 · 마감 달 ──
  const heldStaff = await repo.listFinPayrollHeld(BIZ)
  assert.equal(heldStaff.length, 1)
  assert.equal(heldStaff[0].rows, null, '사원에게 급여 개인 줄 내용이 갔다')
  const card7 = await (async () => {
    const wb7 = new ExcelJS.Workbook()
    const s7 = wb7.addWorksheet('법인카드')
    s7.addRow(['회사명 : (주)디와이 / 2026/07/01 ~ 2026/07/31 / 법인카드 사용내역'])
    s7.addRow(['이용일', '가맹점', '사용부서', '카드번호', '이용금액'])
    s7.addRow(['2026-07-03', '가짜 식당', '영업', '1234-5678-9012-3456', 33_000])
    s7.addRow(['합계', null, null, null, 33_000])
    return new Uint8Array(await wb7.xlsx.writeBuffer())
  })()
  const closedCard = await upload(staff, '법인카드_7월.xlsx', card7)
  assert.equal(closedCard[0].status, 'held', `마감 달(7월)이 보류되지 않았다: ${closedCard[0].message}`)
  assert.equal(closedCard[0].hold, 'closed')
  const chair = as('chairman')
  const heldChair = await repo.listFinPayrollHeld(BIZ)
  assert.equal(heldChair[0].rows?.length, 18, '대표가 급여 개인 줄을 못 본다')
  assert.equal(await repo.finPayrollRelease(heldChair[0].hold_id, true), true)
  as('teamless_staff')
  await assert.rejects(repo.finPayrollRelease(heldChair[0].hold_id, true), /denied/, '사원이 급여 개인 줄을 풀었다')
  as('chairman')
  const pending = await repo.finUploadPending(closedCard[0].upload_id!)
  const saved = await repo.finUploadSave({ business_id: BIZ, kind: 'card', period: '2026-07', file_name: '법인카드_7월.xlsx', file_sha256: (await repo.listFinUploads(BIZ)).find((u) => u.upload_id === closedCard[0].upload_id)!.file_sha256, sheet_name: null, ai_confidence: 'high', ai_used: 0, rows: pending!.rows, people: null, reason: '세무사 수정분 반영', upload_id: closedCard[0].upload_id!, warnings: [] })
  assert.ok(saved, '대표가 이유와 함께 마감 달에 저장하지 못했다')
  void chair

  // ── 6. 원료 숫자 노출 0 ──
  as('teamless_staff')
  const lines = await Promise.all((['sales', 'ledger', 'payroll', 'cashflow', 'loans', 'shipment'] as const).map((k) => repo.listFinLines(k, BIZ, ['2026-09'])))
  assert.ok(!JSON.stringify(lines).includes('가짜 원료'), '재무 현황이 읽는 줄에 원료가 섞였다')
  await assert.rejects(Promise.resolve().then(() => repo.listFinLines('purchase_in' as never, BIZ, ['2026-09']).then((r) => { if (r.length) throw new Error('입고 줄이 나왔다') ; throw new Error('blocked') })), /blocked/, '입고(원료) 줄을 재무 현황 경로로 읽었다')
  const store = dummyFinOverviewStore()
  assert.ok(store.jobs.every((j) => j.status !== 'failed'), '다시 계산 큐에 실패가 남았다')

  console.log(`PASS: 0085 재무 현황 — ${results.length}개 파일 순서 섞어 전부 저장(급여 개인 줄만 보류) · 계정과목표 뒤에 와도 자동 생성 덮어씀 · 큐 → 저장본 · 매출 ${pl.revenue?.toLocaleString('ko-KR')} · 재고 반영 원가 · 차입 · 현금 · 매출 상위 kg · 12지표(자료 부족 2) · 일별 · 달력(예정 · 대출 일정 · 3개월) · 다시 놓기 = 바꾸기 · 되돌리기 · 빠진 달 잠정 · 급여 개인 줄 대표만 · 마감 달 보류 → 대표 이유 저장 · 원료 노출 0`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
