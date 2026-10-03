/**
 * ECOUNT 엑셀 업로드 검증 (오프라인, DB 없음): npm run check:ecount-import
 *
 * 합성 xlsx를 exceljs로 **메모리에서 만들어서** 다시 읽는다. ECOUNT 열 구성 캡처가 없으므로 가짜 견본은
 * «흔한 ECOUNT 모양»(제목 행 · 단위 줄 · 구분 열 · 로마숫자 머리 · 합계 행 · 1월~12월)을 흉내 낸다.
 *   공통부   셀 정규화 · 머리글 · 기간 · 단위 · 행 종류 · 받는 파일 · 감사 문구
 *   열 지정  머리글 짐작 · 지난 지정 다시 쓰기(머리글이 같을 때만) · 판정 · 믿지 않는 값 거르기
 *   계정과목 분류 제안 · 차단/경고 · 병합 계획(분류는 안 바꿈 · 이름은 체크한 것만 · 안 지움) · dummy 끝까지
 *   연간     계정 맞추기 · 단위 · 로마숫자 머리 · 묶음 줄 · 합계 행 대조 · 불균형 · 세무사 확정 해(등록은 0051 이후)
 *
 * ECOUNT_SAMPLE_DIR=<폴더>를 주면 견본 xlsx를 그 폴더에 써 둔다(화면에서 올려 볼 수 있게).
 *
 * 핵심 규칙 하나: **못 읽은 칸은 0이 아니라 오류다.** 0으로 읽히면 «그 달 매출 0원»이 장부에 확정된다.
 */
import assert from 'node:assert/strict'

import ExcelJS from 'exceljs'

import { cellAmount, cellText, normalizeCell, type EcountCell } from '../src/lib/ecount/excel/cells'
import {
  classifyRowLabel,
  detectPeriod,
  detectUnit,
  findHeaderRow,
  findPeriod,
  findUnit,
  fullYearOf,
} from '../src/lib/ecount/excel/detect'
import { ecountAuditNote, ecountBytesProblem, ecountFileProblem } from '../src/lib/ecount/excel/file-rules'
import { EcountExcelError, outlineWorkbook, readEcountWorkbook, sha256Hex, type EcountSheet } from '../src/lib/ecount/excel/workbook'
import {
  codeBand,
  parseAccountChoices,
  parseUse,
  planAccounts,
  readAccountRows,
  suggestAccountClass,
  type ExistingAccount,
} from '../src/lib/ecount/excel/accounts-import'
import {
  guessColumnsAt,
  guessMapping,
  mappingProblems,
  monthOfLabel,
  parseMapping,
  reuseMapping,
  sameMapping,
  sheetGrids,
  sheetLikeFromGrid,
} from '../src/lib/ecount/excel/mapping'
import { planAnnual } from '../src/lib/ecount/excel/annual-import'
import { matchAccount } from '../src/lib/ecount/excel/statement-lines'
import { parseCell } from '../src/lib/statements/paste'

async function syntheticXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('재무상태표')
  ws.getCell('A1').value = '재무상태표'
  ws.mergeCells('A1:C1')
  ws.getCell('A2').value = '2025/01/01 ~ 2025/12/31'
  ws.getCell('C3').value = '(단위 : 천원)'
  ws.getRow(4).values = ['과 목', '당기', '전기']
  ws.getCell('A5').value = 'Ⅰ. 유동자산'
  ws.getCell('B5').value = { formula: 'B6+B7', result: 1500 } as ExcelJS.CellFormulaValue
  ws.getCell('C5').value = 1000
  ws.getCell('A6').value = '  1. 현금및현금성자산'
  ws.getCell('B6').value = '1,000'
  ws.getCell('C6').value = '₩800'
  ws.getCell('A7').value = '(2) 매출채권'
  ws.getCell('B7').value = 500
  ws.getCell('C7').value = '(200)'
  ws.getCell('A8').value = '자산총계'
  ws.getCell('B8').value = { formula: 'B5' } as ExcelJS.CellFormulaValue // 결과 없는 수식
  ws.getCell('A9').value = '소계'
  ws.getCell('B9').value = 'abc'
  ws.getCell('A10').value = '영업이익(손실)'
  ws.getCell('B10').value = { formula: '1/0', result: { error: '#DIV/0!' } } as ExcelJS.CellFormulaValue
  ws.getCell('A11').value = '유형자산처분이익'
  ws.getCell('B11').value = 1234.5
  ws.getCell('A12').value = 'II. 비유동자산'
  ws.getCell('B12').value = new Date(Date.UTC(2025, 11, 31))
  ws.getCell('A13').value = { richText: [{ text: '외상' }, { text: '매입금' }] }
  ws.getCell('B13').value = '-300'
  ws.getCell('A14').value = '병합 금액'
  ws.getCell('B14').value = 777
  ws.mergeCells('B14:C14')
  wb.addWorksheet('빈 시트')
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

const amount = (c: EcountCell | undefined, unit: 'won' | 'thousand' = 'thousand') => {
  const r = cellAmount(c, unit)
  return r.ok ? r.value : `ERR:${r.reason}`
}

async function workbook() {
  const bytes = await syntheticXlsx()
  assert.equal(ecountBytesProblem(bytes), null)
  const sheets = await readEcountWorkbook(bytes)
  assert.deepEqual(sheets.map((s) => s.name), ['재무상태표', '빈 시트'])
  const rows = sheets[0].rows
  assert.ok(rows.every((r) => r.length === sheets[0].colCount), '모든 행이 같은 길이')

  // 병합: 주인 칸만 값, 나머지는 빈 칸(금액이 두 번 서지 않게)
  assert.equal(cellText(rows[0][0]), '재무상태표')
  assert.equal(rows[0][1].t, 'empty')
  assert.equal(amount(rows[13][1]), 777_000)
  assert.equal(rows[13][2].t, 'empty')

  // 기간 · 단위 · 머리글
  const period = findPeriod(rows)
  assert.deepEqual(period, { value: { from: '2025-01-01', to: '2025-12-31' }, row: 1, col: 0 })
  assert.equal(fullYearOf(period!.value), '2025')
  assert.equal(findUnit(rows)?.value, 'thousand')
  const header = findHeaderRow(rows, [
    { key: 'name', names: ['과목', '계정과목'], required: true },
    { key: 'amount', names: ['당기', '금액'], required: true },
    { key: 'prev', names: ['전기'] },
  ])
  assert.deepEqual(header, { row: 3, columns: { name: [0], amount: [1], prev: [2] } })
  assert.equal(findHeaderRow(rows, [{ key: 'code', names: ['계정코드'], required: true }]), null, '없는 필수 열이면 null')

  // 금액 — 수식은 result, 쉼표 · ₩ · 괄호 음수 · 마이너스, 단위(천원)를 곱한 뒤 반올림
  assert.equal(amount(rows[4][1]), 1_500_000, '수식 결과')
  assert.equal(amount(rows[4][2]), 1_000_000)
  assert.equal(amount(rows[5][1]), 1_000_000, '쉼표')
  assert.equal(amount(rows[5][2]), 800_000, '₩')
  assert.equal(amount(rows[6][2]), -200_000, '괄호 음수')
  assert.equal(amount(rows[10][1]), 1_234_500, '천원 × 소수 — 곱한 뒤 반올림')
  assert.equal(amount(rows[12][1]), -300_000, '마이너스')
  assert.equal(amount(rows[4][1], 'won'), 1500)

  // 못 읽은 칸은 0이 아니라 오류
  assert.match(String(amount(rows[7][1])), /^ERR:수식 결과가 저장되지 않은/)
  assert.match(String(amount(rows[8][1])), /^ERR:숫자로 읽지 못함: «abc»/)
  assert.match(String(amount(rows[9][1])), /^ERR:셀 오류 #DIV\/0!/)
  assert.match(String(amount(rows[11][1])), /^ERR:금액 자리에 날짜\(2025-12-31\)/)
  assert.equal(amount(rows[2][0]), null, '빈 칸은 null(0 아님)')
  assert.equal(amount(undefined), null)

  // 서식 있는 글(richText)
  assert.equal(cellText(rows[12][0]), '외상매입금')

  // 개요 — 금액 없이 행 수 · 기간 · 단위 · 오류 칸 수
  const outline = outlineWorkbook(sheets)
  assert.equal(outline[0].period?.from, '2025-01-01')
  assert.equal(outline[0].unit, 'thousand')
  assert.equal(outline[0].errorCells, 2, '결과 없는 수식 + #DIV/0!')
  assert.equal(outline[0].rows, 14 - 0, '빈 행 없이 14행')
  assert.equal(outline[1].rows, 0)
  assert.ok(!JSON.stringify(outline).includes('1500'), '개요에 금액 원문 없음')

  // sha256 — 같은 바이트면 같은 값, 표준 벡터
  assert.equal(sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex(bytes), sha256Hex(bytes.slice()))
}

async function rejects() {
  const text = (s: string) => new TextEncoder().encode(s)
  assert.match(ecountBytesProblem(text('계정코드,계정명\n101,현금'))!, /CSV/)
  assert.match(ecountBytesProblem(text('﻿  <html><table>'))!, /웹 표\(HTML\)/)
  assert.match(ecountBytesProblem(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))!, /\.xls/)
  await assert.rejects(readEcountWorkbook(text('a,b,c')), EcountExcelError)
  await assert.rejects(readEcountWorkbook(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5])), EcountExcelError, '깨진 zip')

  assert.equal(ecountFileProblem('DY 2025 재무상태표.xlsx'), null)
  assert.equal(ecountFileProblem('DY.XLSX'), null)
  assert.match(ecountFileProblem('DY.xls')!, /xlsx/)
  assert.match(ecountFileProblem('DY.csv')!, /CSV/)
  assert.ok(ecountFileProblem('DY.pdf'))
  assert.ok(ecountFileProblem('DY'))
}

function cells() {
  assert.deepEqual(normalizeCell(null), { t: 'empty' })
  assert.deepEqual(normalizeCell('  '), { t: 'empty' })
  assert.deepEqual(normalizeCell({ formula: 'A1', result: '  ' }), { t: 'error', v: '수식 결과가 비어 있음' })
  assert.deepEqual(normalizeCell({ sharedFormula: 'A1', result: 12 }), { t: 'number', v: 12 })
  assert.deepEqual(normalizeCell({ text: '링크', hyperlink: 'https://x' }), { t: 'text', v: '링크' })
  assert.equal(normalizeCell(Number.NaN).t, 'error')
  assert.equal(normalizeCell(Symbol('x')).t, 'error')
  // 회계 표기의 다른 꼴 — 아직 열 구성 확인 전이라 받지 않는다(△ · - 단독은 오류)
  assert.equal(cellAmount({ t: 'text', v: '△1,000' }).ok, false)
  assert.equal(cellAmount({ t: 'text', v: '-' }).ok, false)
  assert.deepEqual(cellAmount({ t: 'number', v: -0.4 }), { ok: true, value: 0 })
  assert.equal(cellAmount({ t: 'number', v: 1e300 }).ok, false)
  // paste.ts parseCell 규칙은 그대로(반올림만 parseCell에 남았다)
  assert.equal(parseCell('(1,200)'), -1200)
  assert.equal(parseCell('1.5'), 2)
  assert.equal(parseCell(' '), null)
  assert.equal(parseCell('1,2,3원'), undefined)
}

function detect() {
  assert.deepEqual(detectPeriod('2025-01-01~2025-12-31'), { from: '2025-01-01', to: '2025-12-31' })
  assert.deepEqual(detectPeriod('회계기간 : 2025년 1월 1일 ~ 2025년 12월 31일'), { from: '2025-01-01', to: '2025-12-31' })
  const july = detectPeriod('기간 2025.07.01 ~ 2025.07.31')
  assert.deepEqual(july, { from: '2025-07-01', to: '2025-07-31' })
  assert.equal(fullYearOf(july!), null)
  assert.equal(detectPeriod('2025/02/30 ~ 2025/12/31'), null, '없는 날')
  assert.equal(detectPeriod('2025/12/31 ~ 2025/01/01'), null, '거꾸로')
  assert.equal(detectPeriod('2025/01/01'), null)

  assert.equal(detectUnit('(단위 : 원)'), 'won')
  assert.equal(detectUnit('[단위:백만원]'), 'million')
  assert.equal(detectUnit('단위: 천 원'), 'thousand')
  assert.equal(detectUnit('외상매출원'), null, '«단위» 없는 «원»은 단위가 아니다')

  const k = (s: string) => classifyRowLabel(s)
  assert.deepEqual(k('Ⅰ. 유동자산'), { kind: 'heading', name: '유동자산' })
  assert.deepEqual(k('Ⅳ.영업외수익'), { kind: 'heading', name: '영업외수익' })
  assert.deepEqual(k('II. 비유동자산'), { kind: 'heading', name: '비유동자산' })
  assert.deepEqual(k('V.영업외수익'), { kind: 'heading', name: '영업외수익' })
  assert.deepEqual(k('  1. 현금및현금성자산'), { kind: 'line', name: '현금및현금성자산' })
  assert.deepEqual(k('(2) 매출채권'), { kind: 'line', name: '매출채권' })
  assert.deepEqual(k('가. 원재료'), { kind: 'line', name: '원재료' })
  assert.deepEqual(k('IT비용'), { kind: 'line', name: 'IT비용' }, '로마숫자처럼 시작해도 구두점이 없으면 줄')
  assert.equal(k('자산총계').kind, 'total')
  assert.equal(k('부채와 자본 총계').kind, 'total')
  assert.equal(k('합 계').kind, 'total')
  assert.equal(k('계').kind, 'total')
  assert.equal(k('소계').kind, 'subtotal')
  assert.equal(k('판매비와관리비 소계').kind, 'subtotal')
  assert.deepEqual(k('영업이익(손실)'), { kind: 'profit', name: '영업이익' })
  assert.equal(k('당기순이익').kind, 'profit')
  assert.equal(k('법인세비용차감전순이익').kind, 'profit')
  assert.equal(k('유형자산처분이익').kind, 'line', '계정명 «…이익»은 이익 줄이 아니다')
  assert.equal(k('이익잉여금').kind, 'line')
  assert.equal(k('   ').kind, 'blank')
}

function auditNote() {
  assert.equal(
    ecountAuditNote({ kind: 'annual', period: '2025', fileName: 'DY\n2025 재무제표.xlsx', importId: 'abc' }),
    'ECOUNT 엑셀 업로드 — 연간 재무제표 2025 · 파일 DY 2025 재무제표.xlsx · import abc',
  )
  assert.equal(
    ecountAuditNote({ kind: 'accounts', period: null, fileName: '계정.xlsx', importId: 'x' }),
    'ECOUNT 엑셀 업로드 — 계정과목 · 파일 계정.xlsx · import x',
  )
  assert.equal(
    ecountAuditNote({ kind: 'monthly', period: '2025-03', fileName: 'a'.repeat(300), importId: 'y' }).length,
    'ECOUNT 엑셀 업로드 — 월별 손익 2025-03 · 파일 '.length + 120 + ' · import y'.length,
  )
}

// ---------------------------------------------------------------- 가짜 견본 (메모리)

const SAMPLES: Record<string, Uint8Array> = {}

/** 계정과목 견본 — 제목 행 · 회사 줄 · 단위 줄 · 구분 열 · 사용여부 · 중복 코드 · 소계/합계 · 모순 · 미분류 · 코드 빈 줄. */
async function accountsXlsx(header = ['코드', '계정명', '구분', '사용여부'], sheetName = '계정과목'): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  ws.getCell('A1').value = '계정과목 목록'
  ws.mergeCells('A1:D1')
  ws.getCell('A2').value = '회사 : DY'
  ws.getCell('D3').value = '(단위 : 원)'
  ws.getRow(4).values = header
  const rows: (string | number)[][] = [
    [1010, '현금', '자산', '사용'], //            5 장부 «현금및현금성자산» — 이름 다름
    [1030, '보통예금', '자산', 'Y'], //            6 새 · 현금
    ['1080', '외상매출금', '자산', ''], //          7 같음(글 칸 코드)
    [2510, '미지급금', '부채', '사용'], //          8 새 · 기타부채 · 영업
    [2600, '차입금', '부채', '사용'], //            9 같음
    [3310, '자본금', '자본', '사용'], //            10 같음
    [4010, '제품매출', '수익', '사용'], //          11 같음
    [4040, '임대료수익', '수익', '사용'], //        12 새 · 영업외(이름)
    [8110, '복리후생비', '비용', '사용'], //        13 새 · 판관비 · 인건비
    [8210, '감가상각비', '비용', '사용'], //        14 장부에 없음(이 견본의 기존 목록 기준) · 상각
    [9310, '이자비용', '비용', '사용'], //          15 새 · 영업외
    [9980, '법인세비용', '법인세', '사용'], //      16 새 · 법인세
    [1030, '보통예금(2)', '자산', '사용'], //       17 중복 코드 → 6 · 17 둘 다 막힘
    ['', '소계', '', ''], //                       18 무시(합계 행)
    [5110, '원재료비', '자산', '사용'], //          19 모순 — 구분 자산 · 코드 511 비용
    ['ABC', '기타계정', '', ''], //                20 분류 미정
    ['', '미분류계정', '비용', ''], //              21 코드 빈 줄 → 막힘
    [1360, '가지급금', '자산', '미사용'], //        22 새 · 사용안함 → active=false
    [1370, '선급비용', '자산', '보류'], //          23 새 · 사용여부 못 읽음 → 경고
    [3750, '이월이익잉여금', '자본', '사용'], //    24 새 · 자본
    [8020, '급여', '판매비와관리비', '사용'], //    25 새 · 판관비 · 인건비
    [9020, '이자수익', '영업외수익', '사용'], //    26 새 · 영업외
    ['', '합 계', '', ''], //                      27 무시
  ]
  rows.forEach((r, i) => (ws.getRow(5 + i).values = r))
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

const EXISTING: ExistingAccount[] = [
  { account_code: '1010', name: '현금및현금성자산', section: 'cash', category: 'asset', cash_flow: null, active: true },
  { account_code: '1080', name: '외상매출금', section: 'receivable', category: 'asset', cash_flow: 'operating', active: true },
  { account_code: '2600', name: '차입금', section: 'other_liability', category: 'liability', cash_flow: 'financing', active: true },
  { account_code: '3310', name: '자본금', section: 'equity', category: 'equity', cash_flow: 'financing', active: true },
  // 파일은 «수익»이라는데 장부는 영업외 — 있는 계정의 분류는 바꾸지 않는다(경고만)
  { account_code: '4010', name: '제품매출', section: 'non_operating', category: 'other', cash_flow: null, active: true },
  { account_code: '9999', name: '옛 계정', section: 'sga', category: 'other', cash_flow: null, active: false },
]

function mappingChecks() {
  // 월 머리글 표기
  assert.deepEqual(monthOfLabel('1월'), { month: 1, year: null, ytd: false })
  assert.deepEqual(monthOfLabel('01월'), { month: 1, year: null, ytd: false })
  assert.deepEqual(monthOfLabel('2025-01'), { month: 1, year: '2025', ytd: false })
  assert.deepEqual(monthOfLabel('2025.12'), { month: 12, year: '2025', ytd: false })
  assert.deepEqual(monthOfLabel('202503'), { month: 3, year: '2025', ytd: false })
  assert.deepEqual(monthOfLabel('2025년 7월'), { month: 7, year: '2025', ytd: false })
  assert.deepEqual(monthOfLabel('2025-02-01'), { month: 2, year: '2025', ytd: false }, '날짜 칸')
  assert.deepEqual(monthOfLabel('3월 누계'), { month: 3, year: null, ytd: true })
  assert.equal(monthOfLabel('13월'), null)
  assert.equal(monthOfLabel('202513'), null)
  assert.equal(monthOfLabel('합계'), null)
  assert.equal(monthOfLabel('1,000'), null)
}

async function accountsChecks(): Promise<void> {
  const bytes = await accountsXlsx()
  SAMPLES['ecount-sample-accounts.xlsx'] = bytes
  const sheets = await readEcountWorkbook(bytes)

  // 짐작 — 제목 · 회사 · 단위 줄을 건너 4행(0부터 3)이 머리글, 열 넷
  const guess = guessMapping(sheets, 'accounts')
  assert.equal(guess.found, true)
  assert.deepEqual(guess.mapping.parts, [{ sheet: '계정과목', headerRow: 3, columns: { code: 0, name: 1, group: 2, use: 3 } }])
  assert.equal(guess.detectedUnit, 'won')
  assert.deepEqual(guess.mapping.labels, [{ code: '코드', name: '계정명', group: '구분', use: '사용여부' }])
  assert.deepEqual(mappingProblems(guess.mapping, sheets), [])
  // 화면 격자(글만)로도 같은 짐작이 선다 — 화면이 머리글 행을 바꿀 때 쓴다
  const grid = sheetGrids(sheets)[0]
  assert.deepEqual(guessColumnsAt(sheetLikeFromGrid(grid), 'accounts', 3), { code: 0, name: 1, group: 2, use: 3 })
  assert.deepEqual(mappingProblems(guess.mapping, [sheetLikeFromGrid(grid)]), [], '격자로 판정해도 서버와 같다')

  // 판정 — 필수 열 빠짐 · 같은 열 두 번 · 시트 없음
  const m = guess.mapping
  assert.match(mappingProblems({ ...m, parts: [{ ...m.parts[0], columns: { name: 1 } }] }, sheets)[0], /«계정코드» 열을 지정하세요/)
  assert.match(mappingProblems({ ...m, parts: [{ ...m.parts[0], columns: { code: 1, name: 1 } }] }, sheets)[0], /같은 열/)
  assert.match(mappingProblems({ ...m, parts: [{ ...m.parts[0], sheet: '없는 시트' }] }, sheets)[0], /파일에 없습니다/)
  assert.match(mappingProblems({ ...m, parts: [] }, sheets)[0], /시트를 고르세요/)

  // 믿지 않는 값 — JSON을 한 바퀴 돌아도 같고, 모르는 열 이름 · 음수 열 · 다른 종류는 거른다
  const round = parseMapping(JSON.parse(JSON.stringify(m)), 'accounts')
  assert.ok(round && sameMapping(round, m))
  assert.equal(parseMapping({ ...m, parts: [{ ...m.parts[0], columns: { evil: 1 } }] }, 'accounts'), null)
  assert.equal(parseMapping({ ...m, parts: [{ ...m.parts[0], columns: { code: -1 } }] }, 'accounts'), null)
  assert.equal(parseMapping(m, 'annual'), null, '종류가 다르면 거른다')
  assert.equal(parseMapping({ ...m, basis: 'ytd' }, 'accounts'), null, '계정과목에는 당월/누계가 없다')
  assert.ok(!sameMapping(m, { ...m, unit: 'thousand' }))

  // 다시 쓰기 — 머리글이 같으면 그대로, 시트가 하나면 이름이 달라도, 머리글 글이 바뀌면 안 쓴다
  const again = await readEcountWorkbook(await accountsXlsx(undefined, '계정과목_20251003'))
  const reused = reuseMapping(m, again)
  assert.ok(reused, '같은 머리글이면 지난 지정을 다시 쓴다')
  assert.equal(reused!.parts[0].sheet, '계정과목_20251003')
  assert.deepEqual(reused!.parts[0].columns, m.parts[0].columns)
  const changed = await readEcountWorkbook(await accountsXlsx(['코드', '계정 이름(한글)', '구분', '사용여부']))
  assert.equal(reuseMapping(m, changed), null, '머리글이 바뀌면 다시 쓰지 않는다(사람이 다시 지정)')

  // 분류 제안
  assert.deepEqual(codeBand('101')?.broad, 'asset')
  assert.deepEqual(codeBand('2510')?.broad, 'liability')
  assert.equal(codeBand('9980')?.section, 'tax')
  assert.equal(codeBand('AB'), null)
  assert.deepEqual(suggestAccountClass('1030', '보통예금', '자산').suggestion, { section: 'cash', category: 'asset', cash_flow: null })
  assert.deepEqual(suggestAccountClass('108', '외상매출금', '').suggestion, { section: 'receivable', category: 'asset', cash_flow: 'operating' })
  assert.deepEqual(suggestAccountClass('2930', '장기차입금', '부채').suggestion, { section: 'other_liability', category: 'liability', cash_flow: 'financing' })
  assert.deepEqual(suggestAccountClass('8110', '복리후생비', '비용').suggestion, { section: 'sga', category: 'labor', cash_flow: null })
  assert.deepEqual(suggestAccountClass('8210', '감가상각비', '판매비와관리비').suggestion, { section: 'd_and_a', category: 'other', cash_flow: null })
  assert.deepEqual(suggestAccountClass('4510', '원재료비', '').suggestion, { section: 'cogs', category: 'raw_material', cash_flow: null })
  assert.deepEqual(suggestAccountClass('', '전력비', '매출원가').suggestion, { section: 'cogs', category: 'electricity', cash_flow: null })
  assert.deepEqual(suggestAccountClass('9310', '이자비용', '비용').suggestion?.section, 'non_operating', '영업외 대역은 수익 · 비용 어느 쪽과도 맞다')
  assert.deepEqual(suggestAccountClass('4040', '임대료수익', '수익').suggestion?.section, 'non_operating')
  assert.deepEqual(suggestAccountClass('1410', '감가상각누계액', '자산').suggestion, { section: 'other_asset', category: 'asset', cash_flow: null })
  assert.match(suggestAccountClass('5110', '원재료비', '자산').contradiction!, /구분 열\(자산\)과 코드 대역\(비용\)/)
  assert.equal(suggestAccountClass('ABC', '기타계정', '').suggestion, null)
  assert.equal(parseUse('미사용'), false)
  assert.equal(parseUse('사용 안함'), false)
  assert.equal(parseUse(''), true)
  assert.equal(parseUse('보류'), null)

  // 파일 행 — 머리글 아래만, 합계 · 소계는 무시(경고), 코드 빈 보통 줄은 행으로 남아 막힌다
  const { rows, ignored } = readAccountRows(sheets[0], m.parts[0])
  assert.deepEqual(ignored.map((r) => [r.rowNo, r.why]), [[18, '합계 행'], [27, '합계 행']])
  assert.equal(rows.length, 21)
  assert.equal(rows.find((r) => r.rowNo === 7)!.code, '1080', '글 칸 코드')

  // 계획 — 사람이 아무것도 안 고른 상태
  const plan = planAccounts({ rows, ignored, existing: EXISTING })
  const at = (rowNo: number) => plan.lines.find((l) => l.rowNo === rowNo)!
  assert.equal(at(5).status, 'name_differs')
  assert.match(at(5).warnings[0], /이름이 다릅니다 — 장부 «현금및현금성자산» · 파일 «현금»/)
  assert.equal(at(5).final, null, '있는 계정은 분류를 정하지 않는다')
  assert.equal(at(6).status, 'blocked')
  assert.match(at(6).blocks[0], /같은 코드 1030가 2번/)
  assert.equal(at(17).status, 'blocked')
  assert.equal(at(7).status, 'same')
  assert.equal(at(11).status, 'same')
  assert.match(at(11).warnings[0], /있는 계정의 분류는 바꾸지 않습니다/)
  assert.equal(at(8).status, 'new')
  assert.deepEqual(at(8).final, { section: 'other_liability', category: 'liability', cash_flow: 'operating' })
  assert.match(at(19).blocks[0], /구분 열\(자산\)과 코드 대역\(비용\)이 다릅니다 — 분류를 직접 고르세요/)
  assert.match(at(20).blocks[0], /분류를 정하지 못했습니다/)
  assert.match(at(21).blocks[0], /계정코드가 비어 있습니다/)
  assert.equal(at(22).active, false)
  assert.match(at(23).warnings[0], /사용여부 «보류»를 읽지 못해/)
  assert.deepEqual(plan.missing, [{ code: '9999', name: '옛 계정' }], '파일에 없는 기존 계정 — 목록만')
  assert.equal(plan.blockCount, 5, '중복 둘 · 모순 · 미분류 · 코드 빈 줄')

  // 사람의 선택 — 모순 · 미분류 줄을 고르고, 1010 이름 바꾸기를 체크. 있는 코드(1010)에 보낸 분류 고침은 무시된다
  const picked = parseAccountChoices(
    {
      '5110': { section: 'cogs', category: 'raw_material', cash_flow: null },
      ABC: { section: 'sga', category: 'other', cash_flow: null },
      '1010': { section: 'sga', category: 'other', cash_flow: null },
      '8110': { section: 'revenue', category: 'labor', cash_flow: null }, // 구분↔대분류 모순 — 걸러진다
      'bad code!': { section: 'sga', category: 'other', cash_flow: null },
    },
    ['1010', 1234, 'bad code!', '1010'],
  )
  assert.deepEqual(Object.keys(picked.overrides).sort(), ['1010', '5110', 'ABC'])
  assert.deepEqual(picked.renames, ['1010'])
  // 중복 줄(17)과 코드 빈 줄(21)은 사람이 파일을 고쳐야 한다 — 여기서는 그 두 줄을 뺀 파일로 본다
  const fixedRows = rows.filter((r) => r.rowNo !== 17 && r.rowNo !== 21)
  const fixed = planAccounts({ rows: fixedRows, ignored, existing: EXISTING, ...picked })
  assert.equal(fixed.blockCount, 0)
  assert.deepEqual(
    fixed.creates.map((c) => [c.account_code, c.section, c.category, c.cash_flow, c.active]),
    [
      ['1030', 'cash', 'asset', null, true],
      ['2510', 'other_liability', 'liability', 'operating', true],
      ['4040', 'non_operating', 'other', null, true],
      ['8110', 'sga', 'labor', null, true],
      ['8210', 'd_and_a', 'other', null, true],
      ['9310', 'non_operating', 'other', null, true],
      ['9980', 'tax', 'other', null, true],
      ['5110', 'cogs', 'raw_material', null, true],
      ['ABC', 'sga', 'other', null, true],
      ['1360', 'other_asset', 'asset', 'operating', false],
      ['1370', 'other_asset', 'asset', 'operating', true],
      ['3750', 'equity', 'equity', 'financing', true],
      ['8020', 'sga', 'labor', null, true],
      ['9020', 'non_operating', 'other', null, true],
    ],
  )
  assert.ok(!fixed.creates.some((c) => EXISTING.some((e) => e.account_code === c.account_code)), '있는 코드는 새로 넣지 않는다')
  assert.deepEqual(fixed.renames, [{ account_code: '1010', from: '현금및현금성자산', to: '현금' }])
  assert.equal(fixed.lines.find((l) => l.code === '1010')!.final, null, '이름을 바꿔도 분류는 그대로')
  // 체크하지 않으면 이름은 그대로
  assert.deepEqual(planAccounts({ rows: fixedRows, ignored, existing: EXISTING, overrides: picked.overrides }).renames, [])

  await dummyAccountsEndToEnd(sheets, m, fixedRows, ignored, picked)
}

/** dummy 어댑터 끝까지 — 업로드 · 확정 지정 기록 · 다시 쓰기 조회 · 병합(source='ecount') · committed. */
async function dummyAccountsEndToEnd(
  sheets: EcountSheet[],
  m: NonNullable<ReturnType<typeof parseMapping>>,
  rows: ReturnType<typeof readAccountRows>['rows'],
  ignored: ReturnType<typeof readAccountRows>['ignored'],
  picked: ReturnType<typeof parseAccountChoices>,
) {
  const { dummyRepository: repo } = await import('../src/lib/repository/dummy')
  const actor = { user_id: 'dummy', role: 'Chairman' as const }
  const imp = await repo.createFinanceImport({ business_id: 'biz_dy', kind: 'accounts', file_name: '계정.xlsx' }, actor)
  assert.equal(await repo.findLatestFinanceImportMapping('biz_dy', 'accounts', imp.import_id), null, '처음에는 다시 쓸 지정이 없다')
  const sha = 'a'.repeat(64)
  await repo.recordFinanceImportPreview(imp.import_id, { file_sha256: sha, summary: { stage: 'preview', mapping: m } }, actor)

  const ledger = await repo.loadFinanceLedger()
  const existing = ledger.accounts.filter((a) => a.business_id === 'biz_dy')
  const plan = planAccounts({ rows, ignored, existing, ...picked })
  assert.equal(plan.blockCount, 0)
  const result = await repo.mergeEcountAccounts(
    'biz_dy',
    { creates: plan.creates.map((c) => ({ ...c, business_id: 'biz_dy' })), renames: plan.renames },
    actor,
    'ECOUNT 엑셀 업로드 — 계정과목 · 파일 계정.xlsx · import x',
  )
  assert.equal(result.added, plan.creates.length)
  await repo.commitFinanceImport(imp.import_id, { stage: 'committed', mapping: m, result }, actor)
  assert.equal((await repo.getFinanceImport(imp.import_id))!.status, 'committed')

  const after = (await repo.loadFinanceLedger()).accounts.filter((a) => a.business_id === 'biz_dy')
  const before1010 = existing.find((a) => a.account_code === '1010')!
  const now1010 = after.find((a) => a.account_code === '1010')!
  assert.equal(now1010.name, '현금', '체크한 이름은 바뀐다')
  assert.deepEqual([now1010.section, now1010.category, now1010.cash_flow, now1010.source], [before1010.section, before1010.category, before1010.cash_flow, before1010.source], '분류 · 출처는 그대로')
  const added = after.find((a) => a.account_code === '1360')!
  assert.deepEqual([added.source, added.active], ['ecount', false])
  assert.equal(after.length, existing.length + plan.creates.length, '아무것도 지우지 않았다')

  // 다음 업로드 — 확정 지정을 다시 쓴다(취소 · 지금 업로드는 빼고)
  const next = await repo.createFinanceImport({ business_id: 'biz_dy', kind: 'accounts', file_name: '계정2.xlsx' }, actor)
  const found = await repo.findLatestFinanceImportMapping('biz_dy', 'accounts', next.import_id)
  assert.equal(found?.import_id, imp.import_id)
  const savedMapping = parseMapping(found!.summary?.mapping, 'accounts')
  assert.ok(savedMapping && reuseMapping(savedMapping, sheets), '지난 업로드의 열 지정을 불러온다')
  assert.equal(await repo.findLatestFinanceImportMapping('biz_dy', 'annual', next.import_id), null, '종류가 다르면 없다')
  // 같은 계획을 한 번 더 넣으면 중복으로 막힌다(이미 있다) — 다시 미리보기하면 «같음»이 된다
  await assert.rejects(
    repo.mergeEcountAccounts('biz_dy', { creates: plan.creates.slice(0, 1).map((c) => ({ ...c, business_id: 'biz_dy' })), renames: [] }, actor, 'x'),
    /DUPLICATE_ACCOUNT_CODE/,
  )
  const replan = planAccounts({ rows, ignored, existing: after, ...picked })
  assert.equal(replan.creates.length, 0)
  assert.equal(replan.renames.length, 0)
  await repo.cancelFinanceImport(next.import_id, actor)
}

// ---------------------------------------------------------------- ② 연간

/** 연간 견본 — 재무상태표 · 손익계산서 두 시트, 제목 · 기간 · 단위(천원) · 로마숫자 머리 · 묶음 줄 · 합계 · 이익 줄. */
async function annualXlsx(netIncome = 500): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const bs = wb.addWorksheet('재무상태표')
  bs.getCell('A1').value = '재 무 상 태 표'
  bs.getCell('A2').value = '제 10 기  2025년 1월 1일 ~ 2025년 12월 31일'
  bs.getCell('A3').value = '회사명 : DY'
  bs.getCell('C3').value = '(단위 : 천원)'
  bs.getRow(4).values = ['과 목', '당기', '전기']
  const bsRows: (string | number)[][] = [
    ['Ⅰ. 유동자산', 1500, 1200], //    5 머리
    ['(1) 당좌자산', 1500, 1200], //   6 묶음 → 소계
    ['현금', 1000, 900], //            7
    ['외상매출금', 500, 300], //       8
    ['Ⅱ. 비유동자산', 800, 700], //   9 머리
    ['유형자산', 1000, 900], //        10 계정과 같은 이름 → 계정 줄
    ['감가상각누계액', '(200)', '(100)'], // 11 차감 — 괄호 음수
    ['자산총계', 2300, 1900], //       12
    ['Ⅰ. 유동부채', 1000, 900], //    13
    ['외상매입금', 400, 300], //       14
    ['차입금', 600, 600], //           15
    ['부채총계', 1000, 900], //        16
    ['Ⅰ. 자본금', 1000, 1000], //     17 혼자 선 머리 → 계정 줄(자본금)
    ['Ⅱ. 이익잉여금', 300, 0], //     18 머리
    ['이월이익잉여금', 300, 0], //     19
    ['자본총계', 1300, 1000], //       20
    ['부채와 자본 총계', 2300, 1900], // 21
  ]
  bsRows.forEach((r, i) => (bs.getRow(5 + i).values = r))

  const pl = wb.addWorksheet('손익계산서')
  pl.getCell('A1').value = '손 익 계 산 서'
  pl.getCell('A2').value = '2025/01/01 ~ 2025/12/31'
  pl.getCell('B3').value = '(단위 : 천원)'
  pl.getRow(4).values = ['과목', '당기금액']
  const plRows: (string | number)[][] = [
    ['Ⅰ. 매출액', 5000], //                 5
    ['제품매출', 5000], //                   6
    ['Ⅱ. 매출원가', 3000], //               7
    ['원재료비', 3000], //                   8
    ['Ⅲ. 매출총이익', 2000], //             9 이익(로마숫자가 붙어도)
    ['Ⅳ. 판매비와관리비', 1200], //         10
    ['급여', 1000], //                       11
    ['감가상각비', 200], //                  12
    ['Ⅴ. 영업이익', 800], //                13
    ['Ⅵ. 영업외수익', 100], //              14
    ['이자수익', 100], //                    15
    ['Ⅶ. 영업외비용', 300], //              16
    ['이자비용', 300], //                    17
    ['Ⅷ. 법인세비용차감전순이익', 600], //  18
    ['Ⅸ. 법인세비용', 100], //              19 혼자 선 머리 → 계정 줄
    ['Ⅹ. 당기순이익', netIncome], //        20
    ['잡손실', 0], //                        21 0원 줄 — 싣지 않음(계정 없어도 막지 않음)
  ]
  plRows.forEach((r, i) => (pl.getRow(5 + i).values = r))
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** ① 계정과목 업로드가 끝난 뒤의 장부라고 본다. */
const BOOK: ExistingAccount[] = [
  ['1010', '현금', 'cash', 'asset'],
  ['1080', '외상매출금', 'receivable', 'asset'],
  ['1400', '유형자산', 'other_asset', 'asset'],
  ['1410', '감가상각누계액', 'other_asset', 'asset'],
  ['2010', '외상매입금', 'payable', 'liability'],
  ['2600', '차입금', 'other_liability', 'liability'],
  ['3310', '자본금', 'equity', 'equity'],
  ['3750', '이월이익잉여금', 'equity', 'equity'],
  ['4010', '제품매출', 'revenue', 'revenue'],
  ['4510', '원재료비', 'cogs', 'raw_material'],
  ['8010', '급여', 'sga', 'labor'],
  ['8210', '감가상각비', 'd_and_a', 'other'],
  ['9020', '이자수익', 'non_operating', 'other'],
  ['9310', '이자비용', 'non_operating', 'other'],
  ['9980', '법인세비용', 'tax', 'other'],
].map(([account_code, name, section, category]) => ({
  account_code,
  name,
  section: section as ExistingAccount['section'],
  category: category as ExistingAccount['category'],
  cash_flow: null,
  active: true,
}))

async function annualChecks() {
  const bytes = await annualXlsx()
  SAMPLES['ecount-sample-annual.xlsx'] = bytes
  const sheets = await readEcountWorkbook(bytes)

  // 짐작 — 두 시트 다(연간), 4행 머리글, 단위 천원, 해 2025
  const guess = guessMapping(sheets, 'annual')
  assert.deepEqual(guess.mapping.parts, [
    { sheet: '재무상태표', headerRow: 3, columns: { name: 0, amount: 1 } },
    { sheet: '손익계산서', headerRow: 3, columns: { name: 0, amount: 1 } },
  ])
  assert.equal(guess.mapping.unit, 'thousand')
  assert.equal(guess.detectedUnit, 'thousand')
  assert.equal(guess.mapping.year, '2025')
  assert.equal(guess.mapping.basis, null)
  assert.deepEqual(mappingProblems(guess.mapping, sheets), [])
  assert.match(mappingProblems({ ...guess.mapping, year: null }, sheets)[0], /몇 년도/)
  const m = guess.mapping

  // 계정 맞추기
  assert.equal(matchAccount({ code: '', name: '현 금' }, BOOK).account?.code, '1010', '이름은 공백을 걷고 정확히')
  assert.equal(matchAccount({ code: '1080', name: '아무 이름' }, BOOK).how, 'code', '코드가 먼저')
  assert.match(matchAccount({ code: '', name: '잡손실' }, BOOK).problem!, /장부에 «잡손실» 계정이 없습니다/)
  assert.match(matchAccount({ code: '7777', name: '없는코드' }, BOOK).problem!, /계정코드 7777/)
  const twin = [...BOOK, { ...BOOK[0], account_code: '1011' }]
  assert.match(matchAccount({ code: '', name: '현금' }, twin).problem!, /계정 2개\(1010 · 1011\)/)

  const plan = planAnnual(sheets, m, { accounts: BOOK, officialKeys: [] })
  assert.deepEqual(plan.blocks, [])
  assert.equal(plan.blockCount, 0)
  const amt = (name: string) => plan.lines.find((l) => l.name === name)?.amounts[0]
  assert.equal(amt('현금'), 1_000_000, '천원 → 원')
  assert.equal(amt('감가상각누계액'), -200_000, '괄호 음수 차감')
  assert.equal(amt('자본금'), 1_000_000, '혼자 선 머리 «Ⅰ. 자본금»은 계정 줄')
  assert.equal(amt('법인세비용'), 100_000, '혼자 선 머리 «Ⅸ. 법인세비용»은 계정 줄')
  assert.equal(amt('유형자산'), 1_000_000, '계정과 같은 이름이면 묶음이 아니다')
  assert.equal(amt('잡손실'), undefined, '0원 줄은 싣지 않는다')
  assert.equal(plan.lines.length, 15)
  assert.ok(plan.others.some((o) => o.name === '당좌자산' && o.kind === 'subtotal'), '«(1) 당좌자산»은 소계')
  assert.ok(plan.warnings.some((w) => /당좌자산.*묶음/.test(w)))
  assert.ok(plan.others.some((o) => o.name === '매출총이익' && o.kind === 'profit'), '«Ⅲ. 매출총이익»은 이익 줄')
  // 합계 대조 — 다 맞음
  const labels = plan.checks.map((c) => c.label)
  for (const l of ['자산총계', '부채총계', '자본총계', '부채와자본총계', '매출액', '매출원가', '매출총이익', '판매비와관리비', '영업이익', '영업외수익', '영업외비용', '법인세비용차감전순이익', '당기순이익']) {
    assert.ok(labels.includes(l), `${l} 대조`)
  }
  assert.ok(plan.checks.every((c) => c.diff === 0), JSON.stringify(plan.checks.filter((c) => c.diff)))

  // 파일 합계와 계산이 다르면 차액을 말하며 막는다
  const off = planAnnual(await readEcountWorkbook(await annualXlsx(550)), m, { accounts: BOOK, officialKeys: [] })
  assert.equal(off.blockCount, 1)
  assert.match(off.blocks[0], /손익계산서 20행 당기순이익: 파일 550,000원 · 계산 500,000원 \(차액 50,000원\)/)

  // 단위를 원으로 잘못 고르면 금액이 1/1000 — 대조는 여전히 맞으므로 사람 눈에 보이게 금액을 그대로 보여 준다
  assert.equal(planAnnual(sheets, { ...m, unit: 'won' }, { accounts: BOOK, officialKeys: [] }).lines[0].amounts[0], 1000)

  // 계정을 못 맞추면 그 줄이 막히고 합계 대조는 미룬다
  const missing = planAnnual(sheets, m, { accounts: BOOK.filter((a) => a.name !== '외상매출금'), officialKeys: [] })
  assert.ok(missing.lines.find((l) => l.name === '외상매출금')!.blocks[0].includes('계정이 없습니다'))
  assert.equal(missing.checks.length, 0)
  assert.ok(missing.warnings.includes('계정을 다 맞춘 뒤에 합계 행과 대조합니다'))

  // 세무사 확정이 있는 해는 받지 않는다
  assert.match(planAnnual(sheets, m, { accounts: BOOK, officialKeys: ['2025'] }).blocks[0], /세무사 확정 결산이 이미 있습니다/)
  // 지정한 해와 파일 기간이 다르면 경고
  assert.ok(planAnnual(sheets, { ...m, year: '2024' }, { accounts: BOOK, officialKeys: [] }).warnings.some((w) => /2025년인데 2024년/.test(w)))

  // 재무상태표 불균형 — 자본금을 빼면 합계 대조(부채와자본총계)와 균형 둘 다 막는다
  const unbalanced = planAnnual(sheets, { ...m, parts: [m.parts[0]] }, { accounts: BOOK.map((a) => (a.name === '자본금' ? { ...a, section: 'other_liability' as const } : a)), officialKeys: [] })
  assert.ok(unbalanced.blocks.some((b) => /부채총계: 파일 1,000,000원 · 계산 2,000,000원/.test(b)))
  assert.ok(!unbalanced.blocks.some((b) => /재무상태표가 맞지 않습니다/.test(b)), '자산 = 부채 + 자본은 여전히 맞다(구분만 옮겼다)')
  const lopsided = planAnnual(sheets, { ...m, parts: [m.parts[0]] }, { accounts: BOOK.map((a) => (a.name === '자본금' ? { ...a, section: 'other_asset' as const } : a)), officialKeys: [] })
  assert.ok(lopsided.blocks.some((b) => /재무상태표가 맞지 않습니다: 자산 3,300,000원 · 부채\+자본 1,300,000원/.test(b)))
}

/** ECOUNT_SAMPLE_DIR가 있으면 견본을 써 둔다 — 화면에서 직접 올려 볼 수 있게(저장소 밖 폴더를 준다). */
async function writeSamples() {
  const dir = process.env.ECOUNT_SAMPLE_DIR
  if (!dir) return
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  mkdirSync(dir, { recursive: true })
  for (const [name, bytes] of Object.entries(SAMPLES)) writeFileSync(join(dir, name), bytes)
  console.log(`견본 ${Object.keys(SAMPLES).length}개 → ${dir}`)
}

async function main() {
  cells()
  detect()
  auditNote()
  await rejects()
  await workbook()
  mappingChecks()
  await accountsChecks()
  await annualChecks()
  await writeSamples()
  console.log('PASS: 셀 정규화(수식 result · 쉼표 · 괄호 음수 · ₩ · 못 읽은 칸은 오류) · 병합 칸 한 번만 · 기간 · 단위 · 머리글 · 행 종류(합계 · 소계 · 로마숫자 · 이익) · .xls · csv · HTML 거절 · sha256 · 감사 문구')
  console.log('PASS: 열 지정 — 머리글 짐작(제목 · 단위 줄 건너뜀) · 월 머리글 표기 · 지난 지정 다시 쓰기(머리글 같을 때만) · 판정 · 믿지 않는 값 거르기')
  console.log('PASS: 계정과목 — 분류 제안(구분 열 · 코드 대역 · 이름) · 차단(코드 공백 · 중복 · 미분류 · 모순) · 경고(이름 다름 · 사용여부 · 합계 행 · 파일에 없는 계정) · 병합(분류 안 바꿈 · 체크한 이름만 · 안 지움) · dummy 끝까지')
  console.log('PASS: 연간 — 두 시트 짐작 · 천원 → 원 · 로마숫자 머리(혼자 선 머리 = 계정 줄 · 로마숫자 이익 줄) · 묶음 줄 = 소계 · 0원 줄 제외 · 계정 맞추기(코드 · 이름 · 모호) · 합계 행 대조(차액) · 불균형 · 세무사 확정 해 거부')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
