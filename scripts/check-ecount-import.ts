/**
 * ECOUNT 엑셀 업로드 — 파서 공통부 검증 (오프라인, DB 없음): npm run check:ecount-import
 *
 * 합성 xlsx를 exceljs로 **만들어서** 다시 읽는다. 대상별(계정과목 · 연간 · 월별) 열 매핑은 열 구성 확인 뒤라
 * 여기 없다 — 어느 대상이든 같은 일(셀 정규화 · 머리글 · 기간 · 단위 · 행 종류 · 받는 파일 · 감사 문구)만 잰다.
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
import { EcountExcelError, outlineWorkbook, readEcountWorkbook, sha256Hex } from '../src/lib/ecount/excel/workbook'
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

async function main() {
  cells()
  detect()
  auditNote()
  await rejects()
  await workbook()
  console.log('PASS: 셀 정규화(수식 result · 쉼표 · 괄호 음수 · ₩ · 못 읽은 칸은 오류) · 병합 칸 한 번만 · 기간 · 단위 · 머리글 · 행 종류(합계 · 소계 · 로마숫자 · 이익) · .xls · csv · HTML 거절 · sha256 · 감사 문구')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
