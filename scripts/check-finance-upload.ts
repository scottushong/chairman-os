/**
 * «회계 · 재무 자료 올리기» v2 검사 — 진짜 회사 파일 · 진짜 AI 호출 0회. dummy repo + 가짜 AI(코드 판단을 그대로 «AI 같은 판단»).
 *
 *   npx tsx --conditions=react-server scripts/check-finance-upload.ts
 *
 * 14가지 가짜 엑셀(한 파일 여러 시트 · 시트명 다름 · 합계 틀림 포함) → 분류 · 자동 넣기 네 조건 · 되돌리기 · 겹침 · 마감 달 ·
 * 급여 개인 줄 권한 · ④ 원료 줄이 DB · AI 요청 어디에도 없음 · 카드번호 마스킹 · DRM 문구 · 두 번 올리기 · 0070 칸 = kinds.ts 칸.
 * 0072(v2.1 차이분): 다섯 조건 · 평가금액 확정자 ≠ 입력자 · 범위 다름 경고 · 빈칸 = 미입력 · 기초 = 앞 달 확정 · 첫 달 출처 필수 ·
 * 출고 구분 칸 없음 = 확인 필요 · 출고 kg가 대기 읽기 · 요약 · AI에 없음 · 같은 거래(same) · 금액만(suspect) · 자동 넣기는 손익 · 마감 그대로 ·
 * 재마감 대상 · 직원 세션에 예시 없음.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import ExcelJS from 'exceljs'

import { crossMonthPairs, matchTx, nearMonthEdge, neighborPeriods } from '../src/lib/finance-upload/dedupe'
import { AI_KIND_SPECS, KIND_SPECS, PAYROLL_PEOPLE_FIELDS, type UploadKind } from '../src/lib/finance-upload/kinds'
import { MSG } from '../src/lib/finance-upload/open'
import { autoDecision, classifyByCode, classifyIssue, readRows, scrubSheet } from '../src/lib/finance-upload/pipeline'
import { fromGrid, processUpload, saveTxGroupsFor, type AiClassify } from '../src/lib/finance-upload/process'
import { parseValue } from '../src/lib/finance-upload/v21-text'
import { checkAiSchemas } from './check-ai-schemas'
import { runLedgerChecks } from './check-finance-upload-ledger'
import { runHardeningChecks } from './check-upload-hardening'
import { runMappingChecks } from './check-finance-mapping'
import type { FinTxLine } from '../src/types'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyFinLines } from '../src/lib/repository/dummy-finance-upload'

const BIZ = 'biz_dy'
type Cell = string | number | Date | null

async function xlsx(sheets: { name: string; rows: Cell[][] }[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    for (const r of s.rows) ws.addRow(r)
  }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

const title = (t: string, ym: string) => [`회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28 / ${t}`]
const stamp = ['2099/10/11 오전 10:12:21']

/** 종류마다 가짜 시트(제목 · 출력 시각 · 머리글 · 줄 · 합계). */
function sample(kind: UploadKind, ym: string, opts: { wrongTotal?: boolean; sheetName?: string } = {}): { name: string; rows: Cell[][] } {
  const d = (day: number) => `${ym}-${String(day).padStart(2, '0')}`
  const T = (n: number) => (opts.wrongTotal ? n + 999 : n)
  switch (kind) {
    case 'sales':
      return { name: opts.sheetName ?? '판매현황', rows: [title('판매현황', ym), stamp, ['거래처명', '품목명', '수량', '단가', '공급가액'], ['가짜 거래처 A', '가짜 제품 1', 10, 1000, 10000], ['가짜 거래처 B', '가짜 제품 2', 5, 2000, 10000], ['합계', null, 15, null, T(20000)]] }
    case 'purchase_in':
      return { name: opts.sheetName ?? '입고명세서', rows: [title('입고명세서', ym), ['자재명', '공급처', '자재구분', '입고수량', '입고금액'], ['가짜 원재료 1', '가짜 공급처', '원재료', 100, 50000], ['가짜 부재료 1', '가짜 공급처', '부재료', 10, 3000], ['합계', null, null, 110, T(53000)]] }
    case 'inventory':
      return { name: opts.sheetName ?? '재고금액명세서', rows: [title('재고금액명세서', ym), ['품목명', '사용수량', '기말재고수량', '재고금액'], ['가짜 원재료 1', 40, 60, 30000], ['가짜 원재료 2', 10, 5, 2500], ['합계', 50, 65, T(32500)]] }
    case 'production':
      return {
        name: opts.sheetName ?? '제조지시명세서',
        rows: [title('제조지시명세서', ym), ['생산품목', '생산수량', '비고'], ['가짜 제품 1', 500, ''], ['원료 투입 · 가짜 원재료 1', 250, '투입'], ['원료 투입 · 가짜 원재료 2', 250, '투입'], ['가짜 제품 2', 300, ''], ['합계', T(800), null]],
      }
    case 'ledger':
      return {
        name: opts.sheetName ?? '계정별원장',
        rows: [
          [`회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28 / 계정별원장 / 8110(복리후생비)`], stamp, ['일자-No.', '적요', '차변', '대변', '잔액'], ['이월잔액', null, null, null, 0], [d(3), '가짜 식대', 30000, 0, 30000], [d(9), '가짜 간식', 20000, 0, 50000], ['합계', null, T(50000), 0, null],
          [`회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28 / 계정별원장 / 9310(이자비용)`], stamp, ['일자-No.', '적요', '차변', '대변', '잔액'], ['이월잔액', null, null, null, 0], [d(25), '가짜 대출 이자', 12000, 0, 12000], ['합계', null, 12000, 0, null],
        ],
      }
    case 'payroll':
      return { name: opts.sheetName ?? '급여대장', rows: [title('급여대장', ym), ['사번', '성명', '주민번호', '부서', '기본급', '상여', '퇴직급여', '계좌번호'], ['E001', '가짜이름일', '900101-1234567', '경영지원', 3000000, 0, 0, '110-123-456789'], ['E002', '가짜이름이', '910202-2345678', '경영지원', 2800000, 100000, 0, '110-987-654321'], ['E003', '가짜이름삼', '920303-1456789', '영업', 3200000, 0, 0, '110-555-111111'], ['합계', null, null, null, T(9000000), 100000, 0, null]] }
    case 'import':
      return { name: opts.sheetName ?? 'OFFER SHEET', rows: [title('수입 거래목록 OFFER SHEET', ym), ['OFFER NO', 'ITEM', 'SHIPPER', '통화', 'AMOUNT', '환율', '원화금액', '부대비용'], ['OF-01', '가짜 원재료 9', '가짜 수출자', 'USD', 1000, 1350, 1350000, 50000], ['합계', null, null, null, T(1000), null, 1350000, 50000]] }
    case 'cashflow':
      return { name: opts.sheetName ?? '자금흐름표', rows: [title('월별 자금흐름표', ym), ['일자', '항목', '입금', '출금'], [d(5), '가짜 매출 입금', 5000000, 0], [d(10), '가짜 급여 지급', 0, 9000000]] }
    case 'card':
      return { name: opts.sheetName ?? '법인카드', rows: [title('법인카드 사용내역', ym), ['이용일', '가맹점', '사용부서', '카드번호', '이용금액'], [d(4), '가짜 식당', '경영지원', '1234-5678-9012-3456', 30000], [d(6), '가짜 문구', '영업', '1234-5678-9012-3456', 12000], ['합계', null, null, null, T(42000)]] }
    case 'overseas':
      return { name: opts.sheetName ?? '베트남 법인 운영비', rows: [title('베트남 법인 운영비', ym), ['법인명', '항목', '통화', '외화금액', '환율', '원화금액'], ['가짜 VN 법인', '가짜 임차료', 'VND', 10000000, 0.055, 550000], ['합계', null, null, T(10000000), null, 550000]] }
    case 'promo':
      return { name: opts.sheetName ?? '해외 판촉비', rows: [title('해외 판촉비', ym), ['담당자', '항목', '통화', '금액'], ['가짜 담당 Suresh', '가짜 전시회', 'USD', 2000], ['합계', null, null, T(2000)]] }
    case 'loans':
      return { name: opts.sheetName ?? '대출현황', rows: [title('대출현황', ym), ['금융기관', '대출금액', '금리', '만기일', '상환조건', '원금상환', '이자'], ['가짜 은행', 500000000, 4.5, '2030-12-31', '만기 일시', 0, 1875000], ['합계', T(500000000), null, null, null, 0, 1875000]] }
    case 'borrowings':
      return { name: opts.sheetName ?? '26년 차입금', rows: [title('연도별 차입금', ym), ['일자', '차입처', '구분', '금액', '입금방법'], [d(2), '가짜 대여자', '차입', 100000000, '직접 입금'], [d(20), '가짜 대여자', '상환', 20000000, '대납'], ['합계', null, null, T(120000000), null]] }
    case 'savings':
      return { name: opts.sheetName ?? '절감목표 및 진행현황', rows: [title('절감목표 및 진행현황', ym), ['항목', '기존인건비', '절감목표', '절감실적'], ['가짜 공정 자동화', 120000000, 30000000, 12000000], ['가짜 외주 정리', 40000000, 10000000, 2000000]] }
    // 0072 — 가짜 값만(진짜 회사 파일 · 진짜 구성표 아님).
    case 'valuation':
      return { name: opts.sheetName ?? '재공품 완제품 평가', rows: [title('재공품 · 완제품 평가', ym), ['재고구분', '평가금액', '평가기준일', '평가방법', '포함원가범위', '비고'], ['재공품', 3400000, d(28), '월 가중평균', '재료비+노무비+경비', '가짜'], ['완제품', 0, d(28), '월 가중평균', '재료비+노무비+경비', '가짜 — 재고 없음']] }
    case 'material_issue':
      return { name: opts.sheetName ?? '원료 출고명세', rows: [title('원료 출고명세서', ym), ['출고일자', '원료명', '출고량(kg)', '출고유형', '적요', '출고창고'], [d(3), '가짜 원료 가', 410, '생산출고', '', '1공장'], [d(4), '가짜 원료 나', 120, '', '샘플 출고', ''], [d(5), '가짜 원료 다', 60, '', '', '']] }
    case 'tax_invoice':
      return { name: opts.sheetName ?? '매입 세금계산서', rows: [title('전자세금계산서 매입', ym), ['작성일자', '상호', '품목명', '공급가액', '세액', '합계금액'], [d(7), '가짜 공급처 정', '가짜 원재료 7', 70000, 7000, 77000], ['합계', null, null, T(70000), 7000, 77000]] }
    case 'shipment':
      return { name: opts.sheetName ?? '출하집계표', rows: [title('출하집계표', ym), ['출하일자', '거래처명', '품목명', '출하량', '출하금액'], [d(4), '가짜 거래처 A', '가짜 제품 1', 1000, 2000000], ['합계', null, null, T(1000), 2000000]] }
    case 'ledger_lines':
      return { name: opts.sheetName ?? '전표내역', rows: [title('일반전표 전표내역', ym), ['전표일자', '계정코드', '계정과목', '거래처명', '적요', '차변', '대변'], [d(3), '8110', '복리후생비', '가짜 식당', '가짜 식대', 30000, null], [d(3), '1030', '보통예금', null, '가짜 식대', null, 30000]] }
  }
}

async function main() {
  process.env.DUMMY_USER = 'support_lead' // DY 재무 입력 · TeamLead
  const sent: { sheet: string; rows: string[][] }[] = []
  const mockAi: AiClassify = async (sampleIn, code) => {
    sent.push(sampleIn)
    return { kind: code.kind, header_row: code.headerRow, columns: code.columns, row_labels: [], account_head_col: null, company: null, period: null, confidence: 'high', reason: '가짜 AI', cost_usd: 0 }
  }
  const run = (fileName: string, bytes: Uint8Array) => processUpload({ repo, businessId: BIZ, fileName, bytes, classify: mockAi, aiBudget: 2, today: new Date('2099-06-15') })

  // ── 0. 0070 칸 = kinds.ts 칸 ──
  const sql70 = readFileSync('supabase/migrations/0070_finance_upload.sql', 'utf8').replace(/\r/g, '')
  const sql72 = readFileSync('supabase/migrations/0072_finance_v21.sql', 'utf8').replace(/\r/g, '')
  // 0085 — 출하집계표(새 표 · fin_upload_save가 넣는다) · 자금흐름표 · 대출 칸(저장 직후 같은 거래에서 채운다).
  const sql85 = readFileSync('supabase/migrations/0085_finance_overview.sql', 'utf8').replace(/\r/g, '')
  const sql = sql70 + sql72 + sql85
  for (const k of KIND_SPECS) {
    const block = new RegExp(`create table ${k.table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? ''
    const alter85 = new RegExp(`alter table ${k.table}\\n([\\s\\S]*?);`).exec(sql85)?.[1] ?? ''
    for (const f of k.fields) {
      const ok = new RegExp(`\\n\\s+${f.key}\\s`).test(block) || sql72.includes(`alter table ${k.table} add column ${f.key} `) || new RegExp(`add column ${f.key}\\s`).test(alter85)
      assert.ok(ok, `0070 · 0072 · 0085 ${k.table}에 ${f.key} 칸이 없다`)
      if (f.state) assert.ok(sql72.includes(`x.${f.state}`), `0072 넣기가 ${k.kind}.${f.state}(상태)를 받지 않는다`)
      if (new RegExp(`add column ${f.key}\\s`).test(alter85)) assert.ok(sql85.includes(`x.${f.key}`), `0085 저장이 ${k.kind}.${f.key}를 채우지 않는다`)
    }
    assert.ok(sql72.includes(`p_kind = '${k.kind}'`) || (k.kind === 'shipment' && sql85.includes('insert into fin_shipment_lines')), `넣기에 ${k.kind} 분기가 없다`)
  }
  const ppl = /create table fin_payroll_people \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? ''
  for (const c of PAYROLL_PEOPLE_FIELDS) assert.ok(ppl.includes(c), `급여 개인 줄 표에 ${c}가 없다`)
  assert.ok(!/(name|resident|account_no|bank)\s/.test(ppl), '급여 개인 줄 표에 이름 · 주민 · 계좌 칸이 있다')

  // ── 1. 14가지 — 각 파일 자동 넣기(믿음 높음 · 검증 통과 · 겹침 없음 · 마감 아님) ──
  const kinds = KIND_SPECS.map((k) => k.kind)
  let month = 1
  const applied: Record<string, string> = {}
  const bytesOf: Record<string, Uint8Array> = {}
  for (const kind of kinds) {
    const ym = `2099-${String(month).padStart(2, '0')}`
    month = (month % 12) + 1
    bytesOf[kind] = await xlsx([sample(kind, ym)])
    const cards = await run(`가짜 ${kind}.xlsx`, bytesOf[kind])
    assert.equal(cards.length, 1, `${kind}: 카드가 하나가 아니다 ${JSON.stringify(cards)}`)
    const c = cards[0]
    assert.equal(c.kind, kind, `${kind}가 «${c.kind}»로 분류됐다: ${c.message}`)
    assert.equal(c.period, ym, `${kind} 기간이 ${c.period}`)
    if (c.status !== 'applied' && c.upload_id) console.log(kind, JSON.stringify((await repo.finUploadPending(c.upload_id))?.meta))
    assert.equal(c.status, 'applied', `${kind}가 자동으로 안 들어갔다: ${c.message} ${c.why.join(' / ')}`)
    applied[kind] = c.upload_id!
  }

  // ── 2. ④ 원료 줄: DB · AI 요청 어디에도 없음 / ⑥ 이름 · 주민 · 계좌 없음 / ⑨ 카드번호 뒤 4자리 ──
  const lines = dummyFinLines().filter((l) => l.period.startsWith('2099')) // 화면 확인용 예시(2026-08 · 09)는 뺀다
  const prod = lines.filter((l) => l.kind === 'production').map((l) => JSON.stringify(l.row))
  assert.equal(prod.length, 2, `생산 줄이 제품 둘이 아니다: ${prod}`)
  assert.ok(!prod.some((r) => /원료|투입|원재료/.test(r)), '생산 표에 원료 줄이 들어갔다')
  const pay = JSON.stringify(lines.filter((l) => l.kind === 'payroll'))
  assert.ok(!/가짜이름|900101|110-123/.test(pay), '급여 줄에 이름 · 주민 · 계좌가 남았다')
  // 0085: 대표 · CFO가 아닌 사람이 올린 급여는 개인 줄이 보류(대표 · CFO가 «저장»)된다 — 줄 내용은 대표에게만.
  assert.ok(!lines.some((l) => l.kind === 'payroll' && l.people), '사원이 올린 급여의 개인 줄이 바로 저장됐다')
  process.env.DUMMY_USER = 'chairman'
  const heldPay = (await repo.listFinPayrollHeld(BIZ)).flatMap((h) => h.rows ?? [])
  assert.ok(heldPay.some((r) => r.person_ref === 'E001') && !/가짜이름|900101|110-123/.test(JSON.stringify(heldPay)), '보류된 급여 개인 줄(사번)이 없거나 이름 · 주민 · 계좌가 남았다')
  process.env.DUMMY_USER = 'support_lead'
  assert.ok(lines.filter((l) => l.kind === 'payroll' && !l.people).length === 2, '급여 부서 합계가 둘(경영지원 · 영업)이 아니다')
  const card = lines.filter((l) => l.kind === 'card').map((l) => l.row.card_last4)
  assert.deepEqual(card, ['3456', '3456'], '카드는 뒤 4자리만이어야 한다')
  assert.ok(!JSON.stringify(lines).includes('1234-5678-9012'), '카드번호 전체가 남았다')
  // AI 요청(가짜 AI가 받은 견본) — 이번 판에서는 믿음이 높아 AI를 안 불렀을 수 있다. 낮은 믿음 시트로 한 번 부른다.
  const odd = await run('가짜 시트명 다름.xlsx', await xlsx([sample('production', '2099-07', { sheetName: 'Sheet1' }), sample('payroll', '2099-07', { sheetName: 'Sheet2' })]))
  assert.ok(odd.every((c) => c.kind === 'production' || c.kind === 'payroll'), `시트명이 달라도 내용으로 알아봐야 한다: ${JSON.stringify(odd.map((c) => [c.sheet, c.kind]))}`)
  const aiText = JSON.stringify(sent)
  assert.ok(!/원료 투입|원재료 1|가짜이름|900101|110-123|1234-5678-9012/.test(aiText), `AI 요청에 원료 줄 · 이름 · 주민 · 계좌 · 카드번호가 갔다: ${aiText.slice(0, 300)}`)
  const scrubbed = scrubSheet({ name: '법인카드', colCount: 1, rows: [[{ t: 'text', v: '카드 1234 5678 9012 3456 사용' }]] })
  assert.equal(scrubbed.sheet.rows[0][0].t === 'text' && scrubbed.sheet.rows[0][0].v, '카드 ****-****-****-3456 사용')

  // ── 3. 두 번 올리기 → 늘지 않음 ──
  const before = dummyFinLines().length
  const again = await run('가짜 sales.xlsx', bytesOf.sales)
  assert.equal(again[0].status, 'duplicate', `같은 파일 두 번이 막히지 않았다: ${again[0].message}`)
  assert.equal(dummyFinLines().length, before, '두 번 올리기에 줄이 늘었다')

  // ── 4. 합계 틀림 → 0085: 저장하고 경고 꼬리표(막지 않는다) ──
  const wrong = await run('가짜 카드 합계틀림.xlsx', await xlsx([sample('card', '2099-11', { wrongTotal: true })]))
  assert.equal(wrong[0].status, 'applied', `합계 틀림이 저장되지 않았다: ${wrong[0].message}`)
  assert.ok(wrong[0].warnings?.some((e) => e.startsWith('합계가 맞지 않습니다')), '합계 틀림 경고가 없다')
  assert.ok((await repo.listFinUploads(BIZ)).find((u) => u.upload_id === wrong[0].upload_id)?.warnings?.some((e) => e.startsWith('합계가 맞지 않습니다')), '합계 틀림 경고가 올리기 기록에 남지 않았다')

  // ── 5. 겹침 → 0085: 새 값으로 바꾸기(옛 줄은 이력) · 되돌리기 → 옛 줄 되살림 ──
  const over = await run('가짜 판매 2.xlsx', await xlsx([{ ...sample('sales', '2099-01'), rows: [...sample('sales', '2099-01').rows.slice(0, 3), ['가짜 거래처 C', '가짜 제품 3', 1, 500, 500], ['합계', null, 1, null, 500]] }]))
  assert.equal(over[0].status, 'applied', `같은 달 두 번째가 바꾸기로 저장되지 않았다: ${over[0].message}`)
  const newId = over[0].upload_id!
  assert.equal((await repo.listFinUploads(BIZ)).find((u) => u.upload_id === applied.sales)?.status, 'replaced', '옛 올리기가 이력(replaced)이 아니다')
  const liveSales = () => dummyFinLines().filter((l) => l.kind === 'sales' && l.period === '2099-01' && !l.voided_at).length
  assert.equal(liveSales(), 1, 'replace 뒤 살아 있는 줄이 새 파일 1줄이 아니다')
  assert.equal(await repo.finUploadRevert(newId, '시험'), true)
  assert.equal(liveSales(), 2, '되돌리기 뒤 옛 줄 2가 되살아나지 않았다')

  // ── 6. 마감 달 — 직원 거부 · 대표 이유 있어야 ──
  process.env.DUMMY_USER = 'chairman'
  const closed = (await repo.loadFinanceLedger()).closings.find((c) => c.business_id === BIZ && c.closed)
  if (closed) {
    process.env.DUMMY_USER = 'support_lead'
    const cm = await run('가짜 카드 마감달.xlsx', await xlsx([sample('card', closed.period)]))
    assert.equal(cm[0].status, 'held', `마감 달이 보류되지 않았다: ${cm[0].message}`)
    assert.equal(cm[0].hold, 'closed')
    const cp = (await repo.finUploadPending(cm[0].upload_id!))!
    await assert.rejects(repo.finUploadApply({ business_id: BIZ, kind: 'card', period: closed.period, file_name: 'x', file_sha256: 'y', sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: false, rows: cp.rows, people: null, overlap: 'none', reason: '이유', upload_id: cm[0].upload_id }), /fin_upload_closed/)
    process.env.DUMMY_USER = 'chairman'
    await assert.rejects(repo.finUploadApply({ business_id: BIZ, kind: 'card', period: closed.period, file_name: 'x', file_sha256: 'y', sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: false, rows: cp.rows, people: null, overlap: 'none', reason: null, upload_id: cm[0].upload_id }), /fin_upload_closed/)
    await repo.finUploadApply({ business_id: BIZ, kind: 'card', period: closed.period, file_name: 'x', file_sha256: 'y', sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: false, rows: cp.rows, people: null, overlap: 'none', reason: '세무사 수정분', upload_id: cm[0].upload_id })
  }

  // ── 7. 급여 개인 줄 — 대기 줄은 대표 · CFO에게만 people · grid ──
  process.env.DUMMY_USER = 'support_lead'
  const pw = await run('가짜 급여 합계틀림.xlsx', await xlsx([sample('payroll', '2099-12', { wrongTotal: true })]))
  assert.equal(pw[0].status, 'applied', `급여(합계 틀림)가 부서 합계로 저장되지 않았다: ${pw[0].message}`)
  const staffHeld = (await repo.listFinPayrollHeld(BIZ)).find((h) => h.upload_id === pw[0].upload_id)
  assert.ok(staffHeld && staffHeld.rows === null && staffHeld.people === 3, '재무 입력 직원에게 급여 개인 줄 내용이 보이거나 보류가 없다')
  process.env.DUMMY_USER = 'chairman'
  const chairHeld = (await repo.listFinPayrollHeld(BIZ)).find((h) => h.upload_id === pw[0].upload_id)
  assert.ok(chairHeld?.rows?.length === 3, '대표에게 급여 개인 줄이 안 보인다')
  // 권한 없는 사원
  process.env.DUMMY_USER = 'sales_staff'
  const deny = await run('가짜 카드 권한없음.xlsx', await xlsx([sample('card', '2099-10')]))
  assert.ok(deny.every((c) => c.status === 'failed' && /권한/.test(c.message)), `권한 없는 사람이 넣었다: ${JSON.stringify(deny)}`)

  // ── 8. DRM · 옛 xls · 이름만 xlsx · PDF ──
  process.env.DUMMY_USER = 'support_lead'
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
  assert.equal((await run('암호 걸린.xlsx', ole))[0].message, MSG.drm)
  assert.equal((await run('가짜.xlsx', new TextEncoder().encode('<html><table></table></html>')))[0].message, MSG.fakeXlsx)
  assert.equal((await run('표준재무제표.pdf', new TextEncoder().encode('%PDF-1.4 가짜')))[0].message, MSG.pdfLater)

  // ── 9. 자동 넣기 네 조건(순수) ──
  const ok = { confidence: 'high' as const, check: { errors: [], warnings: [] }, overlap: false, closed: false, dupSuspects: 0 as number | null }
  assert.equal(autoDecision(ok).auto, true)
  assert.equal(autoDecision({ ...ok, confidence: 'medium' }).auto, false)
  assert.equal(autoDecision({ ...ok, check: { errors: ['x'], warnings: [] } }).auto, false)
  assert.equal(autoDecision({ ...ok, overlap: true }).auto, false)
  assert.equal(autoDecision({ ...ok, closed: true }).auto, false)

  // ══════════════════════ 0072(v2.1 차이분) ══════════════════════
  const V21 = '2099-08'
  const V21b = '2099-09'
  process.env.DUMMY_USER = 'support_lead'

  // ── 10. 다섯 조건(순수) — 다섯째 «자료 간 중복 의심 없음» ──
  assert.equal(autoDecision({ ...ok, dupSuspects: null }).auto, false, '중복 의심 수를 못 세면 자동이면 안 된다')
  const d1 = autoDecision({ ...ok, dupSuspects: 1 })
  assert.equal(d1.auto, false)
  assert.ok(d1.why.some((w) => w.startsWith('자료 간 중복 의심 1건')), `다섯째 조건 문구가 없다: ${d1.why}`)
  // DB 거울: 자동인데 중복 의심 수가 없거나 1 이상이면 거부.
  const one = [{ row_no: 1, customer: 'x', product: 'y', qty: 1, unit_price: 1, amount: 1 }]
  await assert.rejects(repo.finUploadApply({ business_id: BIZ, kind: 'sales', period: '2099-12', file_name: 'a', file_sha256: 'dup-null', sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: true, rows: one, people: null, overlap: 'none', reason: null, upload_id: null, dup_suspects: null }), /fin_upload_auto_blocked/)
  await assert.rejects(repo.finUploadApply({ business_id: BIZ, kind: 'sales', period: '2099-12', file_name: 'a', file_sha256: 'dup-one', sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: true, rows: one, people: null, overlap: 'none', reason: null, upload_id: null, dup_suspects: 1 }), /fin_upload_auto_blocked/)

  // ── 11. 평가금액 — 입력한 사람 확정 거부 · 다른 사람 확정 · 범위 다름 경고 ──
  const vin = { business_id: BIZ, category: 'wip' as const, valuation_date: null, method: '월 가중평균', source: 'manual' as const, upload_id: null, source_ref: null, note: null, status: 'provisional' as const, reason: null }
  const vid = await repo.finValuationSave({ ...vin, period: V21, amount: 3_000_000, state: 'value', cost_scope: 'material_only' })
  await assert.rejects(repo.finValuationConfirm(vid, null), /fin_valuation_self_confirm/, '입력한 사람이 확정했다')
  process.env.DUMMY_USER = 'chairman'
  assert.equal(await repo.finValuationConfirm(vid, null), true, '다른 사람이 확정하지 못했다')
  process.env.DUMMY_USER = 'support_lead'
  const missingId = await repo.finValuationSave({ ...vin, category: 'finished', period: V21, amount: null, state: 'missing', cost_scope: 'material_only' })
  process.env.DUMMY_USER = 'chairman'
  await assert.rejects(repo.finValuationConfirm(missingId, null), /fin_valuation_missing/, '미입력이 확정됐다')
  process.env.DUMMY_USER = 'support_lead'
  await assert.rejects(repo.finValuationSave({ ...vin, period: V21b, amount: 0, state: 'value', cost_scope: 'material_only' }), /fin_value_state/, '0을 «값»으로 받았다')
  await repo.finValuationSave({ ...vin, period: V21b, amount: 3_400_000, state: 'value', cost_scope: 'material_labor_overhead' })
  const warns = await repo.finValuationWarnings(BIZ, V21b)
  assert.ok(warns.some((w) => w.kind === 'scope_mismatch' && w.message === '기초 · 기말 포함 범위가 다름'), `범위 다름 경고가 없다: ${JSON.stringify(warns)}`)

  // ── 12. 빈칸 = 미입력 · 0 = 확인된 0 · 기초 연결(앞 달 확정) · 첫 달 출처 필수 ──
  const invSheet = fromGrid('재고금액명세서', [
    [`회사명 : (주)가짜산업 / 2099/10/01 ~ 2099/10/28 / 재고금액명세서`],
    ['품목명', '기말재고수량', '기초재고금액', '기말재고금액'],
    ['가짜 원재료 1', 10, 500, 0],
    ['가짜 원재료 2', 5, null, null],
  ])
  const invRead = readRows(invSheet, classifyByCode(invSheet))
  const [r0, r1] = invRead.rows
  assert.equal(r0.amount, 0)
  assert.equal(r0.amount_state, 'confirmed_zero', '0이 «확인된 0»이 아니다')
  assert.equal(r0.opening_amount, 500, '기초재고금액 칸을 기말이 가져갔다')
  assert.equal(r1.amount, null, '빈칸이 0이 됐다')
  assert.equal(r1.amount_state, 'missing', '빈칸이 «미입력»이 아니다')
  assert.equal(r1.opening_state, 'missing')
  assert.deepEqual([parseValue(''), parseValue('0'), parseValue('1,200')], [{ amount: null, state: 'missing' }, { amount: 0, state: 'confirmed_zero' }, { amount: 1200, state: 'value' }])
  const roll = await repo.finInventoryRoll(BIZ, V21b)
  const wipRoll = roll.find((r) => r.category === 'wip')!
  assert.equal(wipRoll.opening_source, 'prev_close', `재공품 기초가 앞 달 확정 기말에 붙지 않았다: ${JSON.stringify(wipRoll)}`)
  assert.equal(wipRoll.opening_amount, 3_000_000)
  const finRoll = roll.find((r) => r.category === 'finished')!
  assert.equal(finRoll.opening_source, 'unlinked', '앞 달 확정도 첫 달 입력도 없는데 «미연결»이 아니다')
  assert.equal(finRoll.opening_amount, null, '미연결 기초가 0이 됐다')
  await assert.rejects(repo.finOpeningSave({ business_id: BIZ, period: V21b, category: 'finished', amount: 1000, state: 'value', source: '' as 'manual', upload_id: null, note: '첫 달' }), /fin_opening_reason/, '출처 없이 첫 달 기초가 들어갔다')
  await assert.rejects(repo.finOpeningSave({ business_id: BIZ, period: V21b, category: 'finished', amount: 1000, state: 'value', source: 'manual', upload_id: null, note: '' }), /fin_opening_reason/, '이유 없이 첫 달 기초가 들어갔다')
  await repo.finOpeningSave({ business_id: BIZ, period: V21b, category: 'finished', amount: 1000, state: 'value', source: 'manual', upload_id: null, note: '첫 달 실사표' })
  assert.equal((await repo.finInventoryRoll(BIZ, V21b)).find((r) => r.category === 'finished')!.opening_source, 'manual')
  // 0076 — 첫 달 기초 «확인»: 입력한 사람은 거부 · 다른 장부 담당(대표)은 확인 · 두 번째는 false.
  {
    const op = (await repo.finInventoryRoll(BIZ, V21b)).find((r) => r.category === 'finished')!
    assert.ok(op.opening_id && op.opening_confirmed === false, `첫 달 기초가 미확인으로 오지 않는다: ${JSON.stringify(op)}`)
    await assert.rejects(repo.finOpeningConfirm(op.opening_id!, null), /fin_opening_self_confirm/, '입력한 사람이 첫 달 기초를 확인했다')
    process.env.DUMMY_USER = 'chairman'
    assert.equal(await repo.finOpeningConfirm(op.opening_id!, null), true, '다른 사람이 첫 달 기초를 확인하지 못했다')
    assert.equal(await repo.finOpeningConfirm(op.opening_id!, null), false, '이미 확인한 기초를 다시 확인했다')
    assert.equal((await repo.finInventoryRoll(BIZ, V21b)).find((r) => r.category === 'finished')!.opening_confirmed, true)
    process.env.DUMMY_USER = 'support_lead'
  }

  // ── 13. 원료 출고 — 구분 칸 없음 = 확인 필요 · 규칙 · 생산 투입이 기본값이 아님 · kg는 대기 읽기 · 요약 어디에도 없음 ──
  assert.equal(classifyIssue({}, false).class, 'needs_review')
  assert.equal(classifyIssue({ memo: '' }, true).class, 'needs_review', '낱말 없는 줄이 생산 투입이 됐다')
  assert.equal(classifyIssue({ issue_type: '생산출고' }, true).class, 'production')
  assert.equal(classifyIssue({ memo: '샘플 출고' }, true).non_production_kind, 'sample')
  assert.equal(classifyIssue({ issue_type: '생산출고', memo: '폐기' }, true).class, 'needs_review', '엇갈린 규칙이 확인 필요가 아니다')
  const noCols = fromGrid('원료 출고명세', [['원료 출고명세서 2099/04'], ['출고일자', '원료명', '출고량'], ['2099-04-02', '가짜 원료 가', 10], ['2099-04-03', '가짜 원료 나', 20]])
  const ncCls = classifyByCode(noCols)
  assert.equal(ncCls.kind, 'material_issue', `출고명세를 알아보지 못했다: ${ncCls.kind}`)
  assert.ok(readRows(noCols, ncCls).rows.every((r) => r.class === 'needs_review'), '구분 칸이 없는 출고 줄이 «확인 필요»가 아니다')
  const issueLines = dummyFinLines().filter((l) => l.kind === 'material_issue' && l.period === '2099-04' && !l.voided_at)
  assert.deepEqual(issueLines.map((l) => [l.row.material, l.row.class]), [['가짜 원료 가', 'production'], ['가짜 원료 나', 'non_production'], ['가짜 원료 다', 'needs_review']], '출고 규칙 구분이 다르다')
  // 같은 달 새 출고명세(겹침) → 미리보기 · 대기 읽기에 kg 없음 · 칸 격자 없음 · 넣으면 kg는 대기 줄에서 붙는다.
  const iss2 = await run('가짜 원료 출고명세 2.xlsx', await xlsx([{ ...sample('material_issue', '2099-04'), rows: [...sample('material_issue', '2099-04').rows.slice(0, 2), ['2099-04-09', '가짜 원료 마', 77, '', '', '']] }]))
  assert.equal(iss2[0].status, 'held', `겹친 출고명세(직원 — 바꾸기는 대표 · CFO)가 보류가 아니다: ${iss2[0].message}`)
  assert.equal(iss2[0].hold, 'restricted')
  for (const who of ['support_lead', 'chairman']) {
    process.env.DUMMY_USER = who
    const ip = (await repo.finUploadPending(iss2[0].upload_id!))!
    assert.ok(!ip.grid && !ip.people, `${who}: 출고 대기에 칸 격자가 실렸다`)
    assert.ok(ip.rows.every((r) => !('qty_kg' in r) && !('qty_state' in r)), `${who}: 출고 대기 줄에 kg가 실렸다`)
  }
  process.env.DUMMY_USER = 'support_lead'
  const ip2 = (await repo.finUploadPending(iss2[0].upload_id!))!
  const apply2 = { business_id: BIZ, kind: 'material_issue' as const, period: '2099-04', file_name: 'x', file_sha256: 'x', sheet_name: null, ai_confidence: 'high' as const, ai_used: 0, auto: false, rows: ip2.rows, people: null, overlap: 'replace' as const, reason: '새 출고명세', upload_id: iss2[0].upload_id, dup_suspects: null }
  // 0074: 원료 출고 바꾸기는 대표 · CFO만 — 직원은 거부되고 아무것도 바뀌지 않는다(대기 줄 그대로).
  await assert.rejects(repo.finUploadApply(apply2), /fin_replace_restricted/)
  assert.ok((await repo.finUploadPending(iss2[0].upload_id!))?.rows.length, '거부 뒤 대기 줄이 사라졌다')
  process.env.DUMMY_USER = 'chairman'
  await repo.finUploadApply(apply2)
  process.env.DUMMY_USER = 'support_lead'
  const merged = dummyFinLines().find((l) => l.kind === 'material_issue' && l.period === '2099-04' && !l.voided_at && l.row.material === '가짜 원료 마')
  assert.equal(merged?.row.qty_kg, 77, 'kg가 대기 줄에서 붙지 않았다')
  const sum = (await repo.finIssueSummary(BIZ, '2099-04'))!
  assert.equal(sum.production_input_kg, null)
  assert.equal(sum.input_withheld, 'needs_review_open', `확인 필요 줄이 있는데 합계가 보인다: ${JSON.stringify(sum)}`)
  assert.ok(sum.needs_review.every((m) => Object.keys(m).sort().join() === 'lines,material'), '원료별 요약에 kg가 실렸다')
  assert.ok(!/77|410|120/.test(JSON.stringify(sum.needs_review)), '원료별 요약에 kg 값이 보인다')
  await assert.rejects(repo.finIssueBulkDecide({ business_id: BIZ, period: '2099-04', material: '가짜 원료 마', class: 'production', non_production_kind: null, reason: '' }), /fin_issue_reason/)
  assert.equal(await repo.finIssueBulkDecide({ business_id: BIZ, period: '2099-04', material: '가짜 원료 마', class: 'production', non_production_kind: null, reason: '작업지시 확인' }), 1)
  // AI: 원료 출고명세(로 보이는 시트)는 AI에 가지 않는다 — 시트명 · 제목이 달라 믿음이 낮아도.
  const sentBefore = sent.length
  await run('가짜 시트9.xlsx', await xlsx([{ name: 'Sheet9', rows: [['자재 출고 내역'], ['출고일자', '원료명', '출고수량', '비고'], ['2099-05-02', '가짜 원료 바', 33, ''], ['2099-05-03', '가짜 원료 사', 44, '']] }]))
  assert.equal(sent.length, sentBefore, '출고명세로 보이는 시트가 AI에 갔다')
  assert.ok(!/가짜 원료/.test(JSON.stringify(sent)), 'AI 요청에 원료 출고 줄이 갔다')
  assert.ok(!AI_KIND_SPECS.some((k) => k.kind === 'material_issue'), 'AI 종류 목록에 원료 출고명세가 있다')
  // «모름» 시트의 kg 칸은 대기 기록 전에 비운다.
  const unk = await run('가짜 모름 kg.xlsx', await xlsx([{ name: 'Sheet1', rows: [['가짜 메모 시트'], ['가', '나', '중량(kg)'], [1, 2, 3]] }]))
  assert.ok(unk[0].status === 'held' && unk[0].hold === 'kind' && unk[0].kind === 'unknown', `모르는 시트가 «종류 모름» 보류가 아니다: ${JSON.stringify(unk)}`)
  {
    const ug = (await repo.finUploadPending(unk[0].upload_id!))!.grid!
    assert.equal(ug[2][2], null, `모르는 시트의 kg 칸이 남았다: ${JSON.stringify(ug)}`)
    assert.equal(ug[2][0], 1, '모르는 시트의 다른 칸까지 지웠다')
  }

  // ── 14. 같은 거래 — R2 입고 + 원장 같은 매입 = 묶음 하나(same) · 금액만 맞음 = 중복 의심(자동 아님) ──
  const L = (ref: string, o: Partial<FinTxLine>): FinTxLine => ({ ref, upload_id: null, source: 'other', direction: 'purchase', date: null, counterparty: null, item: null, account: null, amount: null, vat: null, total: null, qty: null, row_no: 1, group_id: null, ...o })
  const pure = matchTx([
    L('fin_purchase_in_lines:1', { source: 'r2', date: '2099-11-05', counterparty: '가짜 공급처 갑', item: '가짜 원재료 A', amount: 500_000, vat: 50_000, qty: 100 }),
    L('fin_ledger_lines:2', { source: 'ledger', date: '2099-11-06', counterparty: '가짜 공급처 갑', account: '원재료', amount: 550_000 }),
    L('fin_purchase_in_lines:3', { source: 'r2', date: '2099-11-12', counterparty: '가짜 공급처 을', item: '가짜 원재료 B', amount: 300_000, qty: 30 }),
    L('fin_ledger_lines:4', { source: 'ledger', date: '2099-11-12', counterparty: null, account: '원재료', amount: 300_000 }),
    L('fin_ledger_lines:5', { source: 'ledger', date: '2099-11-25', counterparty: '가짜 공급처 병', account: '원재료', amount: 300_000 }),
  ])
  assert.deepEqual(pure.map((g) => [g.status, g.refs.sort().join(' ')]), [['same', 'fin_ledger_lines:2 fin_purchase_in_lines:1'], ['suspect', 'fin_ledger_lines:4 fin_purchase_in_lines:3']], `맞추기 결과가 다르다: ${JSON.stringify(pure)}`)
  assert.equal(pure[0].amount_base_ref, 'fin_ledger_lines:2', '금액 기준(기본 원장)이 아니다')
  assert.equal(pure[0].qty_base_ref, 'fin_purchase_in_lines:1', '수량 기준(기본 R2 · ECOUNT)이 아니다')
  assert.equal(matchTx(pure.length ? [L('fin_purchase_in_lines:1', { source: 'r2', date: '2099-11-05', counterparty: '가짜 공급처 갑', amount: 500_000 }), L('fin_ledger_lines:2', { source: 'ledger', date: '2099-11-05', counterparty: '가짜 공급처 갑', amount: 500_000 })] : [], { amount_base: 'r2_ecount', qty_base: 'r2_ecount' })[0].amount_base_ref, 'fin_purchase_in_lines:1', '금액 기준 설정이 먹지 않는다')
  // PHASE 4 — 달 넘김(9/30 ↔ 10/2): 저장하지 않고 «달 넘김 의심»으로만. 경계 밖 · 같은 출처 · 4일 넘김은 짝이 아니다.
  assert.deepEqual(neighborPeriods('2099-01'), { prev: '2098-12', next: '2099-02' })
  assert.ok(nearMonthEdge('2099-09-30') && nearMonthEdge('2099-10-02') && nearMonthEdge('2099-02-27') && !nearMonthEdge('2099-10-04'), '달 경계 판정이 다르다')
  {
    const curM = [
      L('fin_purchase_in_lines:21', { source: 'r2', date: '2099-10-02', counterparty: '가짜 공급처 정', amount: 200_000 }),
      L('fin_purchase_in_lines:22', { source: 'r2', date: '2099-10-15', counterparty: '가짜 공급처 정', amount: 200_000 }),
    ]
    const prevM = [
      L('fin_ledger_lines:31', { source: 'ledger', date: '2099-09-30', counterparty: '가짜 공급처 정', account: '원재료', amount: 200_000 }),
      L('fin_purchase_in_lines:32', { source: 'r2', date: '2099-09-30', counterparty: '가짜 공급처 정', amount: 200_000 }),
      L('fin_ledger_lines:33', { source: 'ledger', date: '2099-09-27', counterparty: '가짜 공급처 정', account: '원재료', amount: 200_000 }),
    ]
    const cm = crossMonthPairs(curM, [{ period: '2099-09', lines: prevM }])
    assert.deepEqual(cm.map((c) => [c.ref, c.other, c.kind]), [['fin_purchase_in_lines:21', 'fin_ledger_lines:31', 'same']], `달 넘김 짝이 다르다: ${JSON.stringify(cm)}`)
    assert.equal(cm[0].evidence.month, '달 넘김')
  }
  // 통합: 원장 거래 줄(자동) → 입고 파일(같은 매입 하나 + 금액만 맞는 줄 하나) → 중복 의심 1 → 미리보기 → 넣으면 same 1 · suspect 1.
  const ledgerKpiBefore = JSON.stringify([(await repo.loadFinanceLedger()).closings, await repo.listFinanceKpis()])
  const led = await run('가짜 전표내역 11월.xlsx', await xlsx([{ name: '전표내역', rows: [title('일반전표 전표내역', '2099-11'), ['전표일자', '계정코드', '계정과목', '거래처명', '적요', '차변', '대변'], ['2099-11-05', '1530', '원재료', '가짜 공급처 갑', '가짜 매입', 500000, null], ['2099-11-12', '1530', '원재료', null, '가짜 매입', 300000, null]] }]))
  assert.equal(led[0].status, 'applied', `원장 거래 줄이 자동으로 안 들어갔다: ${led[0].message} ${led[0].why}`)
  assert.equal(JSON.stringify([(await repo.loadFinanceLedger()).closings, await repo.listFinanceKpis()]), ledgerKpiBefore, '자동 넣기가 마감 · 월별 손익을 바꿨다')
  const pur = await run('가짜 R2 입고 11월.xlsx', await xlsx([{ name: '입고명세서', rows: [title('R2 입고명세서', '2099-11'), ['입고일자', '자재명', '공급처', '자재구분', '입고수량', '입고금액'], ['2099-11-05', '가짜 원재료 A', '가짜 공급처 갑', '원재료', 100, 500000], ['2099-11-12', '가짜 원재료 B', '가짜 공급처 을', '원재료', 30, 300000], ['합계', null, null, null, 130, 800000]] }]))
  // 0085: 중복 의심은 막지 않고 경고 꼬리표 — 저장 직후 같은 거래 묶음(same · suspect)이 선다.
  assert.equal(pur[0].status, 'applied', `중복 의심이 있는 입고가 저장되지 않았다: ${pur[0].message}`)
  assert.ok(pur[0].warnings?.some((w) => w.startsWith('자료 간 중복 의심 1건')), `중복 의심 경고가 없다: ${pur[0].warnings}`)
  assert.equal(dummyFinLines().find((l) => l.upload_id === pur[0].upload_id)?.row.source_system, 'r2', '제목의 R2를 출처로 읽지 못했다')
  const groups = await repo.listFinTxGroups(BIZ, '2099-11')
  assert.deepEqual(groups.map((x) => x.status).sort(), ['same', 'suspect'], `묶음이 same · suspect 하나씩이 아니다: ${JSON.stringify(groups)}`)
  const sus = groups.find((x) => x.status === 'suspect')!
  await assert.rejects(repo.finTxGroupDecide(sus.group_id, 'same', ''), /fin_tx_reason/)
  assert.equal(await repo.finTxGroupDecide(sus.group_id, 'rejected', '다른 날 다른 매입'), true)
  assert.equal(await saveTxGroupsFor(repo, BIZ, 'purchase_in', '2099-11', pur[0].upload_id!, null), 0, '«다른 거래»로 푼 짝을 다시 «중복 의심»으로 묶었다')
  const lines11 = dummyFinLines().filter((l) => l.period === '2099-11' && l.kind === 'purchase_in')
  assert.ok(lines11.every((l) => l.row.amount === 500000 || l.row.amount === 300000), '원천 줄이 바뀌었다')
  await assert.rejects(repo.finDedupeSettingSave(BIZ, { amount_base: 'tax_invoice', qty_base: 'r2_ecount' }, ''), /fin_tx_reason/)
  await repo.finDedupeSettingSave(BIZ, { amount_base: 'tax_invoice', qty_base: 'r2_ecount' }, '세무사 기준')
  assert.equal((await repo.finDedupeSetting(BIZ)).amount_base, 'tax_invoice')

  // ── 15. 재마감 대상 — 마감 달에 넣으면 한 줄 · 마감 권한 없으면 못 푼다 ──
  if (closed) {
    const flags = await repo.listFinRecloseFlags(BIZ)
    const f = flags.find((x) => x.period === closed.period && x.cause === 'upload')
    assert.ok(f, `마감 달 넣기에 재마감 대상이 없다: ${JSON.stringify(flags)}`)
    process.env.DUMMY_USER = 'support_lead'
    await assert.rejects(repo.finRecloseClear(f!.flag_id, null), /fin_upload_denied/)
    process.env.DUMMY_USER = 'chairman'
    assert.equal(await repo.finRecloseClear(f!.flag_id, '다시 마감함'), true)
  }

  // ── 16. 시드 예시 — 직원 세션에는 없다 · 대표 세션에는 «예시» ──
  process.env.DUMMY_USER = 'support_lead'
  const staffSeen = [await repo.listProjects(), await repo.listTasks(), await repo.listDecisions(), await repo.listAlerts(), await repo.listTopGoals(), await repo.listMonthlyPriorities(), await repo.listCriticalRisks(), await repo.listNextMilestones(), await repo.listAiNightOutputs()].flat() as { is_example?: boolean }[]
  assert.ok(!staffSeen.some((r) => r.is_example), '직원 세션에 예시 줄이 보인다')
  assert.ok(!(await repo.listProjects()).some((p) => /^prj_00\d$/.test(p.project_id)), '직원 세션에 0003 시드 프로젝트가 보인다')
  process.env.DUMMY_USER = 'chairman'
  assert.ok((await repo.listProjects()).some((p) => p.is_example), '대표 세션에 예시 표시가 없다')
  assert.ok((await repo.listTopGoals()).every((g) => g.is_example), '대표 세션의 시드 목표에 예시 표시가 없다')

  // ── 17. 2026-10-14 운영 첫 사용 고침 — ⑤ 원장 구조 해석 ──
  const ledgerPass = `${await runLedgerChecks()} · ${checkAiSchemas()} · ${await runHardeningChecks()}`
  // ── 18. 0089 재무 보강 — ECOUNT 엑셀 그대로(열 맞추기 · 시트 찾기) · 공식 결산 다시 맞춤 ──
  const mappingPass = await runMappingChecks()

  console.log(
    `PASS: 0070 칸 = kinds.ts · 14가지 자동 넣기(분류 · 기간 · 상태) · 시트명 달라도 내용으로 · ④ 원료 줄 DB 0 · AI 요청 0 · 급여 이름 · 주민 · 계좌 0 · 개인 줄 사번 · ` +
      `카드 뒤 4자리 · 두 번 올리기 늘지 않음 · 0085 합계 틀림 → 저장 + 경고 · 겹침 → 바꾸기(이력) · 되돌리기 옛 줄 되살림 · 급여 개인 줄 보류 · 마감 달 보류${closed ? '' : '(dummy에 마감 달 없음 — 건너뜀)'} · ` +
      `급여 대기 줄 대표만 · 권한 없음 거부 · DRM · 웹 표 · PDF 문구 · 자동 다섯 조건. ` +
      `0072: 18가지 자동 넣기 · 평가금액 입력자 확정 거부 · 다른 사람 확정 · 미입력 확정 거부 · 범위 다름 경고 · 빈칸 = 미입력 · 0 = 확인된 0 · 기초 = 앞 달 확정 · 미연결 · 첫 달 출처 · 이유 필수 · ` +
      `출고 구분 칸 없음 = 확인 필요 · 규칙 엇갈림 = 확인 필요 · 출고 kg 대기 읽기 0(대표 포함) · 넣을 때 kg 붙음 · 요약 보류 · 원료별 kg 0 · 출고명세 AI 0 · 모름 시트 kg 칸 비움 · ` +
      `같은 매입 = same 하나 · 금액만 = suspect · 중복 의심 → 저장 + 경고 · 다른 거래로 풀기 · 기준 출처 · 자동 넣기 뒤 마감 · 월별 손익 그대로 · 재마감 대상${closed ? '' : '(마감 달 없음 — 건너뜀)'} · 직원 세션 예시 0. ` +
      `${ledgerPass}. ${mappingPass}. 진짜 AI 호출 0회(가짜 AI ${sent.length}회).`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
