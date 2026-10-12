/**
 * «회계 · 재무 자료 올리기» v2 검사 — 진짜 회사 파일 · 진짜 AI 호출 0회. dummy repo + 가짜 AI(코드 판단을 그대로 «AI 같은 판단»).
 *
 *   npx tsx --conditions=react-server scripts/check-finance-upload.ts
 *
 * 14가지 가짜 엑셀(한 파일 여러 시트 · 시트명 다름 · 합계 틀림 포함) → 분류 · 자동 넣기 네 조건 · 되돌리기 · 겹침 · 마감 달 ·
 * 급여 개인 줄 권한 · ④ 원료 줄이 DB · AI 요청 어디에도 없음 · 카드번호 마스킹 · DRM 문구 · 두 번 올리기 · 0070 칸 = kinds.ts 칸.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import ExcelJS from 'exceljs'

import { KIND_SPECS, PAYROLL_PEOPLE_FIELDS, type UploadKind } from '../src/lib/finance-upload/kinds'
import { MSG } from '../src/lib/finance-upload/open'
import { autoDecision, scrubSheet } from '../src/lib/finance-upload/pipeline'
import { processUpload, type AiClassify } from '../src/lib/finance-upload/process'
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
  }
}

async function main() {
  process.env.DUMMY_USER = 'support_lead' // DY 재무 입력 · TeamLead
  const sent: { sheet: string; rows: string[][] }[] = []
  const mockAi: AiClassify = async (sampleIn, code) => {
    sent.push(sampleIn)
    return { kind: code.kind, header_row: Math.max(0, code.headerRow - Math.max(0, code.headerRow - 3)), columns: code.columns, confidence: 'high', reason: '가짜 AI', cost_usd: 0 }
  }
  const run = (fileName: string, bytes: Uint8Array) => processUpload({ repo, businessId: BIZ, fileName, bytes, classify: mockAi, aiBudget: 2, today: new Date('2099-06-15') })

  // ── 0. 0070 칸 = kinds.ts 칸 ──
  const sql = readFileSync('supabase/migrations/0070_finance_upload.sql', 'utf8')
  for (const k of KIND_SPECS) {
    const block = new RegExp(`create table ${k.table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? ''
    for (const f of k.fields) assert.ok(new RegExp(`\\n\\s+${f.key}\\s`).test(block), `0070 ${k.table}에 ${f.key} 칸이 없다`)
    assert.ok(sql.includes(`p_kind = '${k.kind}'`), `0070 넣기에 ${k.kind} 분기가 없다`)
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
  const lines = dummyFinLines()
  const prod = lines.filter((l) => l.kind === 'production').map((l) => JSON.stringify(l.row))
  assert.equal(prod.length, 2, `생산 줄이 제품 둘이 아니다: ${prod}`)
  assert.ok(!prod.some((r) => /원료|투입|원재료/.test(r)), '생산 표에 원료 줄이 들어갔다')
  const pay = JSON.stringify(lines.filter((l) => l.kind === 'payroll'))
  assert.ok(!/가짜이름|900101|110-123/.test(pay), '급여 줄에 이름 · 주민 · 계좌가 남았다')
  assert.ok(lines.some((l) => l.kind === 'payroll' && l.people && l.row.person_ref === 'E001'), '급여 개인 줄(사번)이 없다')
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

  // ── 4. 합계 틀림 → 확인 필요(자동 아님) ──
  const wrong = await run('가짜 카드 합계틀림.xlsx', await xlsx([sample('card', '2099-11', { wrongTotal: true })]))
  assert.equal(wrong[0].status, 'needs_review')
  assert.ok(wrong[0].why.some((w) => w.startsWith('검증')), `합계 틀림이 자동 막힘 이유가 아니다: ${wrong[0].why}`)
  const pend = await repo.finUploadPending(wrong[0].upload_id!)
  assert.ok(pend?.meta?.errors?.some((e) => e.startsWith('합계가 맞지 않습니다')), '합계 틀림 문구가 없다')

  // ── 5. 겹침 → 확인 필요 · replace로 넣기 · 되돌리기 → 옛 줄 되살림 ──
  const over = await run('가짜 판매 2.xlsx', await xlsx([{ ...sample('sales', '2099-01'), rows: [...sample('sales', '2099-01').rows.slice(0, 3), ['가짜 거래처 C', '가짜 제품 3', 1, 500, 500], ['합계', null, 1, null, 500]] }]))
  assert.equal(over[0].status, 'needs_review')
  assert.ok(over[0].why.some((w) => w.includes('겹침')), `겹침이 이유가 아니다: ${over[0].why}`)
  const op = (await repo.finUploadPending(over[0].upload_id!))!
  await assert.rejects(repo.finUploadApply({ business_id: BIZ, kind: 'sales', period: '2099-01', file_name: 'x', file_sha256: 'x', sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: false, rows: op.rows, people: null, overlap: 'none', reason: null, upload_id: over[0].upload_id }), /fin_upload_overlap/)
  const newId = await repo.finUploadApply({ business_id: BIZ, kind: 'sales', period: '2099-01', file_name: 'x', file_sha256: 'x', sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: false, rows: op.rows, people: null, overlap: 'replace', reason: '새 파일', upload_id: over[0].upload_id })
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
    assert.equal(cm[0].status, 'needs_review', `마감 달이 자동으로 들어갔다: ${cm[0].message}`)
    assert.ok(cm[0].why.some((w) => w.includes('마감')))
    const cp = (await repo.finUploadPending(cm[0].upload_id!))!
    await assert.rejects(repo.finUploadApply({ business_id: BIZ, kind: 'card', period: closed.period, file_name: 'x', file_sha256: 'y', sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: false, rows: cp.rows, people: null, overlap: 'none', reason: '이유', upload_id: cm[0].upload_id }), /fin_upload_closed/)
    process.env.DUMMY_USER = 'chairman'
    await assert.rejects(repo.finUploadApply({ business_id: BIZ, kind: 'card', period: closed.period, file_name: 'x', file_sha256: 'y', sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: false, rows: cp.rows, people: null, overlap: 'none', reason: null, upload_id: cm[0].upload_id }), /fin_upload_closed/)
    await repo.finUploadApply({ business_id: BIZ, kind: 'card', period: closed.period, file_name: 'x', file_sha256: 'y', sheet_name: null, ai_confidence: 'high', ai_used: 0, auto: false, rows: cp.rows, people: null, overlap: 'none', reason: '세무사 수정분', upload_id: cm[0].upload_id })
  }

  // ── 7. 급여 개인 줄 — 대기 줄은 대표 · CFO에게만 people · grid ──
  process.env.DUMMY_USER = 'support_lead'
  const pw = await run('가짜 급여 합계틀림.xlsx', await xlsx([sample('payroll', '2099-12', { wrongTotal: true })]))
  assert.equal(pw[0].status, 'needs_review')
  const staffView = (await repo.finUploadPending(pw[0].upload_id!))!
  assert.ok(!staffView.people && !staffView.grid, '재무 입력 직원에게 급여 개인 줄 · 칸 격자가 보인다')
  process.env.DUMMY_USER = 'chairman'
  const chairView = (await repo.finUploadPending(pw[0].upload_id!))!
  assert.ok(chairView.people?.length === 3 && chairView.grid, '대표에게 급여 개인 줄 · 칸 격자가 안 보인다')
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
  const ok = { confidence: 'high' as const, check: { errors: [], warnings: [] }, overlap: false, closed: false }
  assert.equal(autoDecision(ok).auto, true)
  assert.equal(autoDecision({ ...ok, confidence: 'medium' }).auto, false)
  assert.equal(autoDecision({ ...ok, check: { errors: ['x'], warnings: [] } }).auto, false)
  assert.equal(autoDecision({ ...ok, overlap: true }).auto, false)
  assert.equal(autoDecision({ ...ok, closed: true }).auto, false)

  console.log(
    `PASS: 0070 칸 = kinds.ts · 14가지 자동 넣기(분류 · 기간 · 상태) · 시트명 달라도 내용으로 · ④ 원료 줄 DB 0 · AI 요청 0 · 급여 이름 · 주민 · 계좌 0 · 개인 줄 사번 · ` +
      `카드 뒤 4자리 · 두 번 올리기 늘지 않음 · 합계 틀림 → 확인 필요 · 겹침 → 선택 필수 · replace → 되돌리기 옛 줄 되살림 · 마감 달${closed ? '' : '(dummy에 마감 달 없음 — 건너뜀)'} · ` +
      `급여 대기 줄 대표만 · 권한 없음 거부 · DRM · 웹 표 · PDF 문구 · 자동 네 조건. 진짜 AI 호출 0회(가짜 AI ${sent.length}회).`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
