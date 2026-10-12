/**
 * C단계 «회계 · 재무 자료 올리기 2차 — PDF · 사진» 검사. 진짜 AI 호출 0회(가짜 읽기 도구 · fetch 막음) · 진짜 회사 파일 없음 ·
 * 가짜 파일은 전부 코드로 만든다(scripts/fixtures/finance-pdf.ts).
 *
 *   npx tsx --conditions=react-server scripts/check-finance-pdf.ts
 *
 * 글 PDF(자동 넣기) · 스캔 PDF(document 블록 · 처음 3개월 미리보기) · 기운 사진(EXIF · 기울기 펴기) · 합계 틀림 → 확인 필요 ·
 * 소계 대조 · 급여대장 PDF · 사진 거부(AI 0) · 제조지시 사진 거부 · 배합비 파일 거부(기록 0 · AI 0, 엑셀 포함) · 세무사 결산 PDF →
 * 공식 결산 미리보기(자료 표 0줄 · 자동 없음 · 사람이 0020으로 저장) · 직원(입구 스위치 꺼짐) → «준비 중», 엑셀은 그대로 ·
 * AI 한도 넘음 · 꺼짐 → 미리보기 · 카드번호는 AI에 뒤 4자리만 · 진짜 AI 0회.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import ExcelJS from 'exceljs'
import sharp from 'sharp'

import { realDocReader } from '../src/lib/finance-upload/ai-doc'
import { FORMULA_MSG, refuseDoc } from '../src/lib/finance-upload/doc-guard'
import { measureSkew, normalizePhoto, openDocument } from '../src/lib/finance-upload/doc-open'
import { checkDocTotals, companyMismatch, docReviewUntil, forcedDocReview, mockDocReader, type AiDocReader, type DocReadInput, type DocTable } from '../src/lib/finance-upload/doc-read'
import { MSG } from '../src/lib/finance-upload/open'
import { OFFICIAL_RECORD_NOTE, processUpload, type DocOptions } from '../src/lib/finance-upload/process'
import { intakeOpenFor } from '../src/lib/intake/switch'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyFinLines } from '../src/lib/repository/dummy-finance-upload'
import { scanPdfOfTable, tablePhoto, textPdf } from './fixtures/finance-pdf'

const BIZ = 'biz_dy'
type Cell = string | number | null
const title = (t: string, ym: string) => [`회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28 / ${t}`]

// ── 진짜 AI 0회: 키 없음 · 네트워크 막음 ──
delete process.env.ANTHROPIC_API_KEY
delete process.env.FINANCE_UPLOAD_AI_MOCK
delete process.env.FINANCE_UPLOAD_DOC_REVIEW_UNTIL
let netCalls = 0
globalThis.fetch = (async () => {
  netCalls += 1
  throw new Error('검사 중 네트워크 금지')
}) as typeof fetch

/** 가짜 읽기 도구 — 글 PDF는 mockDocReader(칸 위치), 그림(스캔 · 사진)은 파일 이름별로 정해 둔 표(«AI가 읽었다» 흉내). */
const calls: DocReadInput[] = []
const canned: Record<string, DocTable> = {}
const reader: AiDocReader = async (input) => {
  calls.push(input)
  const c = canned[input.fileName]
  if (c) return c
  return mockDocReader(input)
}

async function xlsx(name: string, rows: Cell[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(name)
  for (const r of rows) ws.addRow(r)
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

async function main() {
  process.env.DUMMY_USER = 'chairman'
  const ledger = await repo.loadFinanceLedger()
  const accounts = ledger.accounts.filter((a) => a.business_id === BIZ && a.active).map((a) => ({ account_code: a.account_code, name: a.name, section: a.section }))
  const docsChair: DocOptions = { allowed: true, read: reader, businessName: '가짜산업', accounts }
  const run = (fileName: string, bytes: Uint8Array, opts: { docs?: DocOptions; budget?: number; today?: Date } = {}) =>
    processUpload({ repo, businessId: BIZ, fileName, bytes, classify: null, aiBudget: opts.budget ?? 1, today: opts.today ?? new Date('2026-11-01T03:00:00Z'), docs: opts.docs ?? docsChair })
  const uploadsCount = async () => (await repo.listFinUploads(BIZ)).length
  const liveLines = () => dummyFinLines().length

  // ── 1. 글 PDF — 칸 위치로 읽고(가짜 AI) 0070 길로 자동 넣기(글 PDF는 3개월 규칙 밖) ──
  const salesPdf = textPdf([[title('판매현황', '2099-03'), ['거래처명', '품목명', '수량', '단가', '공급가액'], ['가짜 거래처 A', '가짜 제품 1', 10, 1000, 10000], ['가짜 거래처 B', '가짜 제품 2', 5, 2000, 10000], ['합계', null, 15, null, 20000]]])
  const opened = await openDocument(salesPdf, 'pdf')
  assert.equal(opened.format, 'pdf_text')
  assert.ok(opened.text.includes('거래처명\t품목명'), `글 PDF 칸이 탭으로 갈리지 않았다: ${opened.text}`)
  const s1 = await run('가짜 판매현황.pdf', salesPdf)
  assert.equal(s1.length, 1)
  assert.equal(s1[0].format, 'pdf_text')
  assert.equal(s1[0].kind, 'sales', `글 PDF 종류: ${JSON.stringify(s1[0])}`)
  assert.equal(s1[0].period, '2099-03')
  assert.equal(s1[0].status, 'applied', `글 PDF가 자동으로 안 들어갔다: ${s1[0].message} ${s1[0].why.join(' / ')}`)
  assert.equal(calls[calls.length - 1].media.kind, 'text', '글 PDF는 글만 보내야 한다')
  assert.equal(s1[0].ai_used, 1)

  // ── 2. 스캔 PDF — 글 층 없음 → PDF 그대로(document 블록) · 믿음 높음이어도 처음 3개월은 미리보기 ──
  const scan = await scanPdfOfTable()
  const so = await openDocument(scan, 'pdf')
  assert.equal(so.format, 'pdf_scan')
  assert.equal(so.text, '')
  canned['가짜 스캔 입고.pdf'] = {
    doc_kind: 'purchase_in', company: null, period: '2099-04', title: '입고명세서', columns: ['자재명', '공급처', '자재구분', '입고수량', '입고금액'],
    rows: [['가짜 원재료 1', '가짜 공급처', '원재료', 100, 50000], ['가짜 부재료 1', '가짜 공급처', '부재료', 10, 3000]],
    totals: [{ label: '합계', level: 'total', after_row: 1, values: [null, null, null, 110, 53000] }], confidence: 'high', reason: '가짜 AI — 스캔 입고명세서',
  }
  const s2 = await run('가짜 스캔 입고.pdf', scan)
  assert.equal(s2[0].format, 'pdf_scan')
  assert.equal(calls[calls.length - 1].media.kind, 'pdf', '스캔 PDF는 PDF 그대로(document 블록) 보내야 한다')
  assert.equal(s2[0].kind, 'purchase_in', JSON.stringify(s2[0]))
  assert.equal(s2[0].confidence, 'high')
  assert.equal(s2[0].status, 'needs_review', `스캔이 처음 3개월에 자동으로 들어갔다: ${s2[0].message}`)
  assert.ok(s2[0].why.some((w) => w.includes('처음 3개월')), `3개월 이유가 없다: ${s2[0].why}`)
  const p2 = (await repo.finUploadPending(s2[0].upload_id!))!
  assert.equal(p2.meta?.source_format, 'pdf_scan')
  assert.equal(p2.rows.length, 2)

  // ── 3. 기운 사진(EXIF 6 + 4°) — 바로 세우고 펴서 JPEG로 · 미리보기 ──
  const photo = await tablePhoto({ angle: 4, exif: 6 })
  const np = await normalizePhoto(photo)
  assert.ok(np.fixes.some((f) => f.startsWith('EXIF 방향 6')), `EXIF 방향을 안 고쳤다: ${np.fixes}`)
  assert.ok(Math.abs(np.skew - 4) <= 0.5, `기울기를 ${np.skew}°로 쟀다(4° 기대)`)
  const meta = await sharp(np.data).metadata()
  assert.ok(meta.format === 'jpeg' && meta.width! > meta.height!, `바로 선 사진이 가로가 아니다: ${meta.width}x${meta.height}`)
  const small = await sharp(np.data).greyscale().resize({ width: 600 }).raw().toBuffer({ resolveWithObject: true })
  const after = measureSkew(small.data, small.info.width, small.info.height)
  assert.ok(Math.abs(after) < 0.5, `편 뒤에도 ${after}° 기울어 있다`)
  canned['가짜 카드 영수증 사진.jpg'] = {
    doc_kind: 'card', company: null, period: '2099-05', title: '법인카드 사용내역', columns: ['이용일', '가맹점', '사용부서', '카드번호', '이용금액'],
    rows: [['2099-05-04', '가짜 식당', '경영지원', '****-****-****-3456', 30000], ['2099-05-06', '가짜 문구', '영업', '****-****-****-3456', 12000]],
    totals: [{ label: '합계', level: 'total', after_row: 1, values: [null, null, null, null, 42000] }], confidence: 'high', reason: '가짜 AI — 카드 사진',
  }
  const s3 = await run('가짜 카드 영수증 사진.jpg', photo)
  assert.equal(s3[0].format, 'image')
  const imgCall = calls[calls.length - 1]
  assert.ok(imgCall.media.kind === 'image' && imgCall.media.mediaType === 'image/jpeg', '사진은 JPEG image 블록으로 보내야 한다')
  assert.equal(s3[0].kind, 'card')
  assert.equal(s3[0].status, 'needs_review')
  assert.ok(s3[0].why.some((w) => w.includes('사진은')) && s3[0].fixes?.some((f) => f.includes('기울기')), `사진 이유 · 고친 것: ${s3[0].why} ${s3[0].fixes}`)

  // ── 4. 합계 틀림 → 확인 필요 · 카드번호는 AI에 뒤 4자리만 ──
  const wrongPdf = textPdf([[title('법인카드 사용내역', '2099-06'), ['이용일', '가맹점', '사용부서', '카드번호', '이용금액'], ['2099-06-04', '가짜 식당', '경영지원', '1234-5678-9012-3456', 30000], ['2099-06-06', '가짜 문구', '영업', '1234-5678-9012-3456', 12000], ['합계', null, null, null, 45000]]], 200)
  const s4 = await run('가짜 법인카드 6월.pdf', wrongPdf)
  assert.equal(s4[0].status, 'needs_review', `합계 틀림이 자동으로 들어갔다: ${s4[0].message}`)
  assert.ok(s4[0].why.some((w) => w.startsWith('검증')), `검증이 이유가 아니다: ${s4[0].why}`)
  const p4 = (await repo.finUploadPending(s4[0].upload_id!))!
  assert.ok(p4.meta?.errors?.some((e) => e.startsWith('합계가 맞지 않습니다') && e.includes('줄의 합 42,000')), `합계 문구가 없다: ${p4.meta?.errors}`)
  const sentText = JSON.stringify(calls[calls.length - 1])
  assert.ok(!sentText.includes('1234-5678-9012') && sentText.includes('****-****-****-3456'), 'AI에 카드번호 전체가 갔다')
  assert.ok(!JSON.stringify(p4).includes('1234-5678-9012'), '대기 줄에 카드번호 전체가 남았다')
  // 소계(순수): 소계가 덮는 줄만 더한다
  const sub = checkDocTotals({ doc_kind: 'card', company: null, period: null, title: null, columns: ['항목', '금액'], rows: [['a', 10], ['b', 20], ['c', 5]], totals: [{ label: '소계', level: 'subtotal', after_row: 1, values: [null, 33] }, { label: '소계', level: 'subtotal', after_row: 2, values: [null, 5] }, { label: '합계', level: 'total', after_row: 2, values: [null, 35] }], confidence: 'high', reason: '' })
  assert.equal(sub.length, 1, `소계 대조: ${sub}`)
  assert.ok(sub[0].includes('소계') && sub[0].includes('30') && sub[0].includes('33'))
  assert.ok(companyMismatch('(주)다른회사', '가짜산업') && !companyMismatch('(주)가짜산업', '가짜산업') && !companyMismatch(null, '가짜산업'))

  // ── 5. 급여대장 PDF · 사진 — AI에 보내지 않고 «엑셀로» ──
  let n = calls.length
  const payPdf = textPdf([[['급여대장 2099년 7월'], ['사번', '성명', '주민번호', '부서', '기본급'], ['E001', '가짜이름일', '900101-1234567', '경영지원', 3000000]]])
  const s5 = await run('가짜 7월 자료.pdf', payPdf)
  assert.equal(s5[0].status, 'refused')
  assert.equal(s5[0].message, MSG.payrollDoc)
  assert.ok(MSG.payrollDoc.startsWith('급여대장은 엑셀로 올려 주세요'))
  const s5b = await run('급여대장_7월.jpg', await tablePhoto())
  assert.equal(s5b[0].message, MSG.payrollDoc)
  assert.equal(calls.length, n, '급여대장이 AI에 갔다')
  assert.ok(!JSON.stringify(await repo.listFinUploads(BIZ)).includes('가짜이름일'), '급여대장 내용이 기록에 남았다')
  // 이름이 평범한 스캔을 AI가 «급여»로 읽으면 결과를 버린다(저장 전)
  canned['가짜 스캔 7월.pdf'] = { doc_kind: 'payroll', company: null, period: null, title: null, columns: [], rows: [], totals: [], confidence: 'high', reason: '급여대장' }
  const s5c = await run('가짜 스캔 7월.pdf', scan)
  assert.equal(s5c[0].status, 'refused')
  assert.equal(s5c[0].message, MSG.payrollDoc)

  // ── 6. 제조지시명세서 사진 — 같은 모양 문구 · AI 0 ──
  n = calls.length
  const s6 = await run('제조지시명세서 사진.png', new Uint8Array(await sharp(await tablePhoto()).png().toBuffer()))
  assert.equal(s6[0].status, 'refused')
  assert.equal(s6[0].message, MSG.productionDoc)
  assert.ok(MSG.productionDoc.startsWith('제조지시명세서는 엑셀로 올려 주세요'))
  assert.equal(refuseDoc('3월.pdf', '제조지시명세서 2099/03')?.code, 'production')
  assert.equal(calls.length, n, '제조지시가 AI에 갔다')

  // ── 7. 배합비 · 구성표 파일 — 저장(기록 줄)도 AI도 없다(PDF · 사진 · 엑셀) ──
  n = calls.length
  const before = await uploadsCount()
  const linesBefore = liveLines()
  for (const [name, bytes] of [
    ['가짜 배합비.pdf', textPdf([[['가짜 제품 배합'], ['원료', '비율'], ['가짜 원료 가', 50]]])],
    ['가짜 3월 표.pdf', textPdf([[['가짜 배합비 표'], ['원료', '비율'], ['가짜 원료 가', 50]]])],
    ['가짜 4월 표.pdf', textPdf([[['가짜 표 4월'], ['원료명', '함량(%)'], ['가짜 원료 가', 60], ['가짜 원료 나', 40]]])],
    ['가짜 bom 사진.jpg', await tablePhoto()],
    ['가짜 레시피.xlsx', await xlsx('Sheet1', [['가짜'], ['원료', '비율'], ['가짜 원료 가', 50]])],
    ['가짜 3월.xlsx', await xlsx('배합표', [['가짜'], ['원료', '비율'], ['가짜 원료 가', 50]])],
  ] as const) {
    const r = await run(name, bytes)
    assert.equal(r[0].status, 'refused', `${name}: ${r[0].message}`)
    assert.equal(r[0].message, FORMULA_MSG)
    assert.ok(FORMULA_MSG.startsWith('이 파일은 받을 수 없습니다'))
    assert.equal(r[0].upload_id, null, `${name}: 기록이 남았다`)
  }
  assert.equal(await uploadsCount(), before, '배합비 파일이 fin_uploads에 남았다')
  assert.equal(liveLines(), linesBefore)
  assert.equal(calls.length, n, '배합비 파일이 AI에 갔다')

  // ── 8. 세무사 확정 결산 PDF → 공식 결산 미리보기(자료 표 0줄 · 자동 없음) ──
  const stmt = textPdf([[
    ['표준재무제표'], ['제 5기 2025년 01월 01일 ~ 2025년 12월 31일'], ['재무상태표'],
    ['현금및현금성자산', 1000000], ['외상매출금', 500000], ['유형자산', 2000000], ['감가상각누계액', '(300,000)'], ['자산총계', 3200000],
    ['외상매입금', 400000], ['차입금', 1000000], ['부채총계', 1400000], ['자본금', 1800000], ['자본총계', 1800000],
    ['손익계산서'], ['제품매출', 5000000], ['원재료비', 3000000], ['급여(판관)', 800000], ['영업이익', 1200000],
  ]])
  const linesBefore8 = liveLines()
  const s8 = await run('2025 표준재무제표.pdf', stmt)
  assert.equal(s8[0].status, 'official', `결산서가 공식 결산 길로 안 갔다: ${JSON.stringify(s8[0]).slice(0, 300)}`)
  assert.equal(calls[calls.length - 1].expect, 'official')
  const d = s8[0].official!
  assert.equal(d.period_key, '2025')
  assert.equal(d.unmatched, 0, `계정을 못 맞춘 줄: ${JSON.stringify(d.lines.filter((l) => !l.account_code))}`)
  assert.equal(d.lines.length, 10)
  assert.ok(d.balance?.balanced, `재무상태표가 안 닫힌다: ${JSON.stringify(d.balance)}`)
  assert.equal(d.lines.find((l) => l.label === '감가상각누계액')?.amount, -300000)
  assert.equal(d.lines.find((l) => l.label === '제품매출')?.amount, -5000000)
  assert.equal(liveLines(), linesBefore8, '결산서가 자료 표(fin_*)에 들어갔다')
  const rec = (await repo.listFinUploads(BIZ)).find((u) => u.upload_id === s8[0].upload_id)
  assert.ok(rec && rec.status === 'failed' && rec.error === OFFICIAL_RECORD_NOTE && rec.ai_used === 1, `공식 결산 기록 줄: ${JSON.stringify(rec)}`)
  // 사람이 확인하고 0020 저장(대표 세션 — dummy). 자동 저장은 없다(위 카드는 저장 전).
  const officialBefore = (await repo.listOfficialStatements(BIZ)).length
  await repo.saveOfficialStatement({ business_id: BIZ, period_kind: 'year', period_key: '2097', evidence_url: 'https://example.invalid/fake.pdf', memo: '가짜 결산', lines: d.lines.map((l) => ({ account_code: l.account_code!, amount: l.amount! })) }, { user_id: 'u_chairman', role: 'Chairman' })
  assert.equal((await repo.listOfficialStatements(BIZ)).length, officialBefore + 1)

  // ── 9. 직원(입구 스위치 꺼짐) — PDF · 사진은 «준비 중», 엑셀은 그대로 ──
  process.env.DUMMY_USER = 'support_lead'
  assert.equal(intakeOpenFor({ role: 'TeamLead' }), false, '입구 스위치가 켜져 있다 — 직원 «준비 중» 시험 전제가 깨짐')
  assert.equal(intakeOpenFor({ role: 'Chairman' }), true)
  n = calls.length
  const staffDocs: DocOptions = { allowed: intakeOpenFor({ role: 'TeamLead' }), read: reader }
  const s9 = await run('가짜 판매현황 직원.pdf', textPdf([[title('판매현황', '2099-08'), ['거래처명', '공급가액'], ['가짜 거래처 C', 7000]]]), { docs: staffDocs })
  assert.ok(s9[0].message.includes('PDF · 사진은 준비 중') && s9[0].status === 'later', s9[0].message)
  const s9b = await run('가짜 사진.png', new Uint8Array(await sharp(await tablePhoto()).png().toBuffer()), { docs: staffDocs })
  assert.ok(s9b[0].message.includes('PDF · 사진은 준비 중'))
  const s9x = await run('가짜 판매현황 직원.xlsx', await xlsx('판매현황', [title('판매현황', '2099-08'), ['거래처명', '품목명', '수량', '단가', '공급가액'], ['가짜 거래처 C', '가짜 제품 3', 7, 1000, 7000], ['합계', null, 7, null, 7000]]), { docs: staffDocs })
  assert.equal(s9x[0].status, 'applied', `직원 엑셀이 안 들어갔다: ${s9x[0].message} ${s9x[0].why}`)
  assert.equal(calls.length, n, '직원 PDF가 AI에 갔다')
  process.env.DUMMY_USER = 'chairman'

  // ── 10. AI 한도 넘음 · 꺼짐 → 미리보기(글 PDF) / 사진 · 스캔은 못 읽음(저장 없음) ──
  n = calls.length
  const lim = await run('가짜 판매현황 한도.pdf', textPdf([[title('판매현황', '2099-09'), ['거래처명', '품목명', '수량', '단가', '공급가액'], ['가짜 거래처 D', '가짜 제품 4', 1, 500, 500], ['합계', null, 1, null, 500]]]), { budget: 0 })
  assert.equal(lim[0].status, 'needs_review', `한도 넘음이 미리보기가 아니다: ${lim[0].message}`)
  assert.ok(lim[0].why.some((w) => w.includes('AI 한도')), `한도 이유: ${lim[0].why}`)
  assert.equal(lim[0].ai_used, 0)
  const off = await run('가짜 판매현황 꺼짐.pdf', textPdf([[title('판매현황', '2099-10'), ['거래처명', '품목명', '수량', '단가', '공급가액'], ['가짜 거래처 E', '가짜 제품 5', 1, 600, 600], ['합계', null, 1, null, 600]]]), { docs: { ...docsChair, read: null } })
  assert.equal(off[0].status, 'needs_review')
  assert.ok(off[0].why.some((w) => w.includes('AI가 꺼져')))
  const limScan = await run('가짜 스캔 한도.pdf', scan, { budget: 0 })
  assert.equal(limScan[0].status, 'failed')
  assert.ok(limScan[0].message.includes('AI 한도') && limScan[0].message.includes('저장하지 않았습니다'), limScan[0].message)
  assert.equal(calls.length, n, '한도 0인데 AI를 불렀다')

  // ── 11. 처음 3개월 규칙(순수) · env로 바꿈 ──
  assert.equal(docReviewUntil(), '2027-01-12')
  assert.ok(forcedDocReview('image', new Date('2027-01-11T00:00:00Z')))
  assert.equal(forcedDocReview('image', new Date('2027-01-12T00:00:00Z')), null)
  assert.equal(forcedDocReview('pdf_text', new Date('2026-11-01T00:00:00Z')), null)
  process.env.FINANCE_UPLOAD_DOC_REVIEW_UNTIL = '2026-10-20'
  assert.equal(forcedDocReview('pdf_scan', new Date('2026-11-01T00:00:00Z')), null)
  delete process.env.FINANCE_UPLOAD_DOC_REVIEW_UNTIL

  // ── 12. 진짜 AI 0회 · 막는 목록은 AI 경로 밖 ──
  assert.equal(realDocReader(repo, BIZ), null, '키가 없는데 진짜 읽기 도구가 생겼다')
  process.env.FINANCE_UPLOAD_AI_MOCK = '1'
  assert.equal(realDocReader(repo, BIZ), mockDocReader)
  delete process.env.FINANCE_UPLOAD_AI_MOCK
  assert.equal(netCalls, 0, `네트워크 호출 ${netCalls}번`)
  assert.ok(calls.length >= 6, `가짜 AI 호출이 ${calls.length}번뿐`)
  const prompt = readFileSync('src/lib/ai/prompts/finance-upload-read.md', 'utf8')
  assert.ok(!/bom/i.test(prompt), '읽기 프롬프트에 금지 낱말')
  for (const c of [s1, s2, s3, s4, s5, s6, s8, s9, lim].flat()) assert.ok(!/회장/.test(c.message + c.why.join('')), `직원에게 보일 문구에 «회장»: ${c.message}`)

  console.log(
    'PASS: 글 PDF 칸 읽기 · 자동 넣기 · 글만 보냄 / 스캔 PDF document 블록 · 처음 3개월 미리보기 / 사진 EXIF 6 · 기울기 4° 폄(편 뒤 <0.5°) · JPEG image 블록 / ' +
      '합계 틀림 → 확인 필요 · 소계 대조 · 카드번호 AI 뒤 4자리 / 급여대장 PDF · 사진 거부(AI 0) · AI가 급여로 읽으면 버림 / 제조지시 사진 거부(AI 0) / ' +
      '배합비 · 구성표(이름 · 글 · 표 모양 · 사진 · 엑셀) 거부 — 기록 0 · AI 0 / 세무사 결산 → 공식 결산 미리보기(계정 10줄 · 균형 · 부호 · 자료 표 0줄 · 자동 없음) · 사람이 0020 저장 / ' +
      `직원 «PDF · 사진은 준비 중» · 엑셀 그대로 / AI 한도 넘음 · 꺼짐 → 미리보기 · 스캔은 저장 없음 / 3개월 규칙 · env / 진짜 AI 0회(가짜 ${calls.length}회 · 네트워크 0).`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
