/**
 * 2026-10-16 «자료 올리기 실패 경우 전부 고침»(운영 5b3922a 점검) 검사 — 가짜 파일 · 가짜 AI만, 진짜 AI 호출 0회.
 * check-finance-upload.ts 끝에서 부른다(같은 dummy repo).
 *
 *   A 원장(ECOUNT 모양): 계정 머리(괄호 겹침 · 제목 줄의 기간 · 쪽) · 전기이월 · 거래 · 세로 병합 날짜 · 일계 · «[월계]» · «월 계» · 누계 → 2배 없음 · 섞임 없음 · 자동
 *   B 요약 줄 칸 밀림 → 끝 숫자 셋 · 대변 음수 경고 · C 머리글 앞 제목 없음 → 섞지 않음 · D 쪽 넘김(잔액 이어짐)은 같은 계정
 *   E AI 400 대조군(옛 스키마) · 구조 강제 400 → 강제 없이 한 번 더 · JSON 아님 → AI 실패(던짐) · 다른 400은 그대로
 *   F 수신함(0082 흉내) 5MB · 15MG 왕복 · 남의 폴더 거부 · 1시간 넘은 것 치우기 · 경로 모양 · 여러 파일 중 하나 실패해도 나머지
 *   G PDF 25쪽 열림 · 31쪽 거부 · 결산서 쪽 순서 · 긴 답 쪽 나눔(가짜) · 스위치 꺼짐 문구 · 서버 설정 없음 문구 · 보류 상태
 *   H 같은 파일 다시 올리기 → «다시 해석할까요?»(AI 0번) · CSV 1만 줄 초과 오류 · 날짜 변형 · 연간 제목 · 숨긴 시트 · HTML-xls · 옛 xls · HEIC
 *   I 원장 계정 코드 칸 없음 → 높은 믿음 · 건너뛴 줄 수 · 기능 스위치 근거
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

import Anthropic from '@anthropic-ai/sdk'
import ExcelJS from 'exceljs'

import { AiShapeError, callJson, CREDIT_MSG, parseJsonObject } from '../src/lib/finance-upload/ai-call'
import { STRUCTURE_SCHEMA } from '../src/lib/finance-upload/ai'
import { fitPages, orderPages, readSplitting } from '../src/lib/finance-upload/ai-doc'
import { DOC_MAX_PAGES, openDocument } from '../src/lib/finance-upload/doc-open'
import type { DocTable } from '../src/lib/finance-upload/doc-read'
import { inboxPath, inboxPathOk } from '../src/lib/finance-upload/inbox'
import { cellDate, readLedgerWith, ledgerLayoutByCode } from '../src/lib/finance-upload/ledger'
import { MSG, oleKind, openUpload, parseHtmlTables, TEXT_SHEET_MAX_ROWS } from '../src/lib/finance-upload/open'
import { classifyByCode, detectMonth } from '../src/lib/finance-upload/pipeline'
import { fromGrid, HOLD_PREFIX, processUpload, type FileCard } from '../src/lib/finance-upload/process'
import { sendEach } from '../src/lib/finance-upload/send-each'
import { defaultFeatureRows, featureWhyFor } from '../src/lib/features'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { DUMMY_UID } from '../src/lib/repository/dummy-org'
import { schemaProblems } from './check-ai-schemas'
import { textPdf } from './fixtures/finance-pdf'

type Cell = string | number | null
const BIZ = 'biz_dy'

async function xlsx(sheets: { name: string; rows: Cell[][]; hidden?: boolean }[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, s.hidden ? { state: 'hidden' } : undefined)
    for (const r of s.rows) ws.addRow(r)
  }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

const HEAD = ['일자', '적요', '거래처', '차변', '대변', '잔액']

/** A — ECOUNT 원장(가짜 값). 1월 원장이라 월계 = 누계(둘 다 더하면 정확히 2배). */
function ledgerA(ym: string): Cell[][] {
  const yy = ym.slice(2, 4)
  const mm = ym.slice(5, 7)
  const d = (n: number) => `${yy}/${mm}/${String(n).padStart(2, '0')}`
  const range = `${ym.slice(0, 4)}/${mm}/01 ~ ${ym.slice(0, 4)}/${mm}/28`
  return [
    ['계정별원장'],
    ['회사명 : (주)가짜산업', range],
    ['1509(제품)', range, null, null, null, '1쪽'],
    HEAD,
    [null, '[전기이월]', null, null, null, 1_000_000],
    [d(5), '가짜 제품 입고', '가짜 거래처 갑', 300_000, null, 1_300_000],
    [null, '가짜 제품 입고 둘', '가짜 거래처 갑', 100_000, null, 1_400_000], // 세로 병합 날짜(첫 칸만 값)
    [d(5), '[일 계]', null, 400_000, 0, 1_400_000],
    [d(20), '가짜 제품 출고', '가짜 거래처 을', null, 200_000, 1_200_000],
    [d(20), '[일    계]', null, 0, 200_000, 1_200_000],
    [null, '[월계]', null, 400_000, 200_000, 1_200_000],
    [null, '[누 계]', null, 400_000, 200_000, 1_200_000],
    ['2519(미지급금(카드))', range, null, null, null, '2쪽'],
    HEAD,
    [null, '전월이월', null, null, null, -5_000_000],
    [d(3), '가짜 카드 사용', '가짜 카드사', null, 700_000, -5_700_000],
    [d(25), '가짜 대금 지급', '가짜 카드사', 400_000, null, -5_300_000],
    [null, '월 계', null, 400_000, 700_000, -5_300_000],
    [null, '누계', null, 400_000, 700_000, -5_300_000],
  ]
}

const sheetOf = (rows: Cell[][], name = '계정별원장') => fromGrid(name, rows.map((r) => r.map((v) => v)))

export async function runHardeningChecks(): Promise<string> {
  const done: string[] = []
  process.env.DUMMY_USER = 'support_lead'

  // ── A. 원장 — 2배 없음 · 섞임 없음 · 괄호 겹침 · 병합 날짜 · 변형 요약 낱말 ──
  {
    const sheet = sheetOf(ledgerA('2099-01'))
    const layout = ledgerLayoutByCode(sheet)!
    assert.ok(layout, 'A: 원장 머리글을 못 찾았다')
    const read = readLedgerWith(sheet, layout)
    const by = Object.fromEntries(read.rows.map((r) => [r.account_code, r]))
    assert.deepEqual(Object.keys(by).sort(), ['1509', '2519'], `A: 계정 머리를 못 읽었다(${Object.keys(by)})`)
    assert.equal(by['2519'].account_name, '미지급금(카드)', 'A: 괄호가 겹친 계정 이름을 바깥 괄호까지 읽지 못했다')
    assert.equal(by['1509'].debit, 400_000, 'A: 1509 차변(2배 · 병합 날짜 줄 빠짐?)')
    assert.equal(by['1509'].credit, 200_000, 'A: 1509 대변')
    assert.equal(by['2519'].debit, 400_000, 'A: 2519 차변')
    assert.equal(by['2519'].credit, 700_000, 'A: 2519 대변(2배?)')
    assert.deepEqual(read.mismatches, [], `A: 요약 줄과 안 맞는다 ${JSON.stringify(read.mismatches)}`)
    assert.equal(read.compared, 2, 'A: 두 계정 모두 월계와 대조되지 않았다')
    assert.deepEqual(read.unknownRows, [], `A: 모르는 줄이 생겼다(병합 날짜 줄?) ${read.unknownRows}`)
    assert.deepEqual(read.warnings, [], `A: 경고 ${read.warnings}`)
    assert.ok(read.dates.every((x) => x.startsWith('2099-01')), `A: 26/01/05 꼴 날짜를 못 읽었다 ${read.dates}`)
    // 옛 규칙(요약 줄을 정확 일치로만) 대조군: «[월계]»를 거래로 읽으면 1509 차변이 2배가 된다 — 지금은 아니다.
    assert.notEqual(by['1509'].debit, 800_000, 'A: 2배')
    // 파일로 — 자동 넣기(높은 믿음 · 검증 0) · AI 0번.
    const calls: number[] = []
    const cards = await processUpload({ repo, businessId: BIZ, fileName: '가짜 1월 계정별 원장.xlsx', bytes: await xlsx([{ name: '계정별원장', rows: ledgerA('2099-01') }]), classify: async () => (calls.push(1), Promise.reject(new Error('부르면 안 됨'))), aiBudget: 3, today: new Date('2099-02-01') })
    assert.equal(cards[0].status, 'applied', `A: 자동으로 넣지 않았다 — ${cards[0].message} ${cards[0].why.join(' / ')}`)
    assert.equal(calls.length, 0, 'A: 코드로 맞는 원장에 AI를 불렀다')
    done.push('A 원장(괄호 겹침 · 병합 날짜 · [월계] · 월 계 · 2배 없음 · 자동 · AI 0)')
  }

  // ── B. 요약 줄 칸 밀림 · 대변 음수 ──
  {
    const rows: Cell[][] = [
      HEAD,
      ['1509(제품)'],
      ['2099/03/05', '가짜 입고', '가짜 갑', 300_000, null, 300_000],
      ['2099/03/06', '가짜 출고', '가짜 을', null, 100_000, 200_000],
      [null, '[월    계]', null, null, null, null, 300_000, 100_000, 200_000], // 머리글 칸이 비고 숫자가 오른쪽으로 밀림
      ['2519(외상매입금)'],
      ['2099/03/07', '가짜 반품', '가짜 병', null, -50_000, 50_000],
      [null, '[월계]', null, 0, -50_000, 50_000],
    ]
    const sheet = sheetOf(rows)
    const read = readLedgerWith(sheet, ledgerLayoutByCode(sheet)!)
    assert.equal(read.mismatches.filter((m) => m.code === '1509').length, 0, `B: 밀린 요약 줄을 끝 숫자 셋으로 읽지 못했다 ${JSON.stringify(read.mismatches)}`)
    assert.ok(read.warnings.some((w) => /칸 밀림/.test(w)), 'B: 밀린 요약 줄 경고가 없다')
    assert.ok(read.warnings.some((w) => /2519.*대변이 음수/.test(w)), 'B: 대변 합계 음수 경고가 없다')
    done.push('B 칸 밀림(끝 숫자 셋) · 대변 음수 경고')
  }

  // ── C. 머리글이 다시 나왔는데 계정 제목이 없음 → 앞 계정에 섞지 않는다 ──
  {
    const rows: Cell[][] = [
      ['1509(제품)'],
      HEAD,
      ['2099/03/05', '가짜 입고', '가짜 갑', 300_000, null, 300_000],
      [null, '[월계]', null, 300_000, 0, 300_000],
      HEAD, // 제목 없이 머리글
      ['2099/03/09', '가짜 다른 계정 거래', '가짜 정', 70_000, null, 9_999_999],
      [null, '[월계]', null, 70_000, 0, 9_999_999],
    ]
    const sheet = sheetOf(rows)
    const read = readLedgerWith(sheet, ledgerLayoutByCode(sheet)!)
    assert.equal(read.rows.find((r) => r.account_code === '1509')?.debit, 300_000, 'C: 제목 없는 구간의 거래를 앞 계정에 섞었다')
    assert.ok(read.problems.some((p) => /머리글 앞에 계정 제목이 없습니다/.test(p)), 'C: 제목 없음을 문제로 적지 않았다')
    assert.ok(read.unknownRows.length >= 1, 'C: 제목 없는 구간의 거래가 «모르는 줄»이 아니다')
    // D — 쪽 넘김(머리글만 다시 · 잔액이 이어짐)은 같은 계정이다.
    const page: Cell[][] = [
      ['1509(제품)'],
      HEAD,
      ['2099/03/05', '가짜 입고', '가짜 갑', 300_000, null, 300_000],
      HEAD,
      ['2099/03/09', '가짜 입고 둘', '가짜 갑', 70_000, null, 370_000],
      [null, '[월계]', null, 370_000, 0, 370_000],
    ]
    const s2 = sheetOf(page)
    const r2 = readLedgerWith(s2, ledgerLayoutByCode(s2)!)
    assert.equal(r2.rows[0]?.debit, 370_000, 'D: 쪽 넘김(잔액 이어짐)을 다른 계정으로 끊었다')
    assert.deepEqual(r2.problems, [], `D: 쪽 넘김에 문제를 적었다 ${r2.problems}`)
    // 리뷰 1: 앞 계정이 잔액 0으로 끝나면 «잔액이 이어짐»으로 보지 않는다(새 계정의 첫 줄 잔액 = 그 줄 금액이라 우연히 맞는다).
    const zero: Cell[][] = [
      ['1350(가지급금)'],
      HEAD,
      ['2099/03/02', '가짜 가지급', '가짜 갑', 50_000, null, 50_000],
      ['2099/03/03', '가짜 정산', '가짜 갑', null, 50_000, 0],
      [null, '[월계]', null, 50_000, 50_000, 0],
      HEAD,
      ['2099/03/09', '가짜 다른 계정', '가짜 을', 80_000, null, 80_000],
      [null, '[월계]', null, 80_000, 0, 80_000],
    ]
    const s3 = sheetOf(zero)
    const r3 = readLedgerWith(s3, ledgerLayoutByCode(s3)!)
    assert.equal(r3.rows[0]?.debit, 50_000, '리뷰 1: 잔액 0으로 끝난 계정에 다음 계정을 이어 붙였다')
    assert.ok(r3.problems.some((p) => /계정 제목이 없습니다/.test(p)), '리뷰 1: 제목 없음 문제가 없다')
    // 리뷰 4: 낱말 규칙이 모르는 요약 줄(«당월 합산누적» 등 — 적요가 «…누적»으로 끝남)은 병합 날짜를 잇지 않는다(거래로 더하지 않음).
    const sumish: Cell[][] = [
      ['1509(제품)'],
      HEAD,
      ['2099/03/05', '가짜 입고', '가짜 갑', 300_000, null, 300_000],
      [null, '[당월합산누적]', null, 300_000, 0, 300_000],
      [null, '[월계]', null, 300_000, 0, 300_000],
    ]
    const s4 = sheetOf(sumish)
    const r4 = readLedgerWith(s4, ledgerLayoutByCode(s4)!)
    assert.equal(r4.rows[0]?.debit, 300_000, '리뷰 4: 모르는 요약 줄을 병합 날짜로 이어 거래로 더했다')
    done.push('C 제목 없는 머리글 → 섞지 않음 · D 쪽 넘김 = 같은 계정 · 잔액 0 뒤는 잇지 않음 · 모르는 요약 줄은 날짜를 잇지 않음')
  }

  // ── E. AI 400 · BadRequest 물러서기 · JSON 아님 ──
  {
    assert.equal(schemaProblems({ type: 'object', properties: { columns: { type: 'object', additionalProperties: { type: 'integer' } } }, additionalProperties: false }).length, 1, 'E: 옛 400 스키마를 잡지 못한다(대조군)')
    assert.deepEqual(schemaProblems(STRUCTURE_SCHEMA), [], 'E: 새 분류 스키마가 규칙을 어긴다')
    const sent: { output_config?: unknown; system?: unknown }[] = []
    const okText = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } })
    const fake = (replies: (() => unknown)[]) => ({ messages: { create: async (p: { output_config?: unknown; system?: unknown }) => (sent.push(p), replies.shift()!()) } }) as unknown as Anthropic
    const bad400 = () => {
      throw new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'output_config.format.schema: additionalProperties object is not supported' } }, 'output_config.format.schema: additionalProperties object is not supported', new Headers())
    }
    let usage = 0
    const call = { model: 'x', maxTokens: 100, timeout: 1000, system: [{ type: 'text' as const, text: 'sys' }], content: 'c', schema: { type: 'object', properties: {}, additionalProperties: false } }
    const r = await callJson(fake([bad400, () => okText('```json\n{"a":1}\n```')]), call, () => void (usage += 1))
    assert.deepEqual(r.json, { a: 1 }, 'E: 물러선 답을 읽지 못했다')
    assert.equal(r.fallback, true, 'E: 물러섬 표시가 없다')
    assert.ok(sent[0].output_config && !sent[1].output_config, 'E: 두 번째 호출에 구조 강제가 남았다')
    assert.ok(JSON.stringify(sent[1].system).includes('JSON 스키마'), 'E: 물러선 호출에 스키마 글이 없다')
    assert.equal(usage, 1, 'E: 쓴 토큰 기록(성공 호출)이 없다')
    await assert.rejects(callJson(fake([() => okText('죄송합니다, 표를 읽을 수 없습니다')]), call, () => undefined), AiShapeError, 'E: JSON 아닌 답을 «AI 실패»로 던지지 않았다')
    const other400 = () => {
      throw new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long' } }, 'prompt is too long', new Headers())
    }
    await assert.rejects(callJson(fake([other400]), call, () => undefined), Anthropic.BadRequestError, 'E: 구조 강제와 무관한 400을 삼켰다')
    assert.throws(() => parseJsonObject('없음'), AiShapeError)
    // 크레딧 부족(운영 · 이번 블록의 진짜 호출에서 본 400) — 물러서지 않고 사람이 알아볼 말로.
    const credit = () => {
      throw new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, 'Your credit balance is too low to access the Anthropic API.', new Headers())
    }
    const before = sent.length
    await assert.rejects(callJson(fake([credit]), call, () => undefined), (e: unknown) => e instanceof AiShapeError && e.message === CREDIT_MSG, 'E: 크레딧 부족을 사람 말로 바꾸지 않았다')
    assert.equal(sent.length - before, 1, 'E: 크레딧 부족에 한 번 더 불렀다')
    // AI 실패(JSON 아님) → 원장은 코드 해석으로 «확인 필요»(숫자를 지어내지 않음) — 학습 · 대조 규칙 그대로.
    const odd = ledgerA('2099-04').map((r) => r.map((v) => (v === '[월계]' ? '[당월합산]' : v === '월 계' ? '[당월합산]' : v)))
    const cards = await processUpload({ repo, businessId: BIZ, fileName: '가짜 4월 원장.xlsx', bytes: await xlsx([{ name: '계정별원장', rows: odd }]), classify: async () => Promise.reject(new AiShapeError('AI 실패 — 답이 JSON이 아닙니다(…)')), aiBudget: 3, today: new Date('2099-05-01') })
    // 0085: AI가 실패해도 코드 해석으로 저장하고(숫자를 지어내지 않음) 맞지 않는 곳은 경고 꼬리표로.
    assert.equal(cards[0].status, 'applied', `E: AI 실패인데 ${cards[0].status}`)
    done.push('E AI 400 대조군 · 구조 강제 400 → 강제 없이 1번 더 · JSON 아님 → AI 실패 → 코드 해석으로 저장 + 경고 · 다른 400 그대로')
  }

  // ── F. 수신함(0082 흉내) · 여러 파일 중 하나 실패 ──
  {
    const me = DUMMY_UID.supportLead
    const big5 = new Uint8Array(5 * 1024 * 1024).map((_, i) => (i * 31) % 251)
    const big15 = new Uint8Array(15 * 1024 * 1024).map((_, i) => (i * 17) % 253)
    const p5 = inboxPath(BIZ, me, '가짜 5MB.xlsx', 'a5')
    const p15 = inboxPath(BIZ, me, '가짜 15MB.pdf', 'a15')
    assert.equal(p5, `${BIZ}/${me}/a5.xlsx`, 'F: 경로 모양')
    assert.ok(inboxPathOk(p5, BIZ, me) && !inboxPathOk(`${BIZ}/someone/a.xlsx`, BIZ, me) && !inboxPathOk(`biz_vana/${me}/a.xlsx`, BIZ, me) && !inboxPathOk(`${BIZ}/${me}/x/y`, BIZ, me), 'F: 경로 확인')
    await repo.finInboxPut!(p5, big5)
    await repo.finInboxPut!(p15, big15)
    assert.equal((await repo.finInboxRead(p5)).length, big5.length, 'F: 5MB 왕복')
    assert.equal((await repo.finInboxRead(p15)).length, big15.length, 'F: 15MB 왕복')
    await assert.rejects(repo.finInboxPut!(`${BIZ}/${DUMMY_UID.chair}/x.xlsx`, big5), /fin_inbox_denied/, 'F: 남의 폴더에 올렸다')
    // 15MB 깨진 파일도 처리(엑셀 · PDF 아님) — 터지지 않고 실패 카드.
    const c15 = await processUpload({ repo, businessId: BIZ, fileName: '가짜 15MB.bin', bytes: await repo.finInboxRead(p15), classify: null, aiBudget: 0 })
    assert.equal(c15[0].status, 'failed', 'F: 15MB 모르는 파일이 실패 카드가 아니다')
    await repo.finInboxRemove([p5, p15])
    await assert.rejects(repo.finInboxRead(p5), /fin_inbox_missing/, 'F: 처리 뒤 지우지 않았다')
    // 5MB 엑셀(Storage 길 — 요청 몸통 4.5MB를 넘는 크기)도 그대로 처리된다.
    const many: Cell[][] = [['판매현황'], ['회사명 : (주)가짜산업 / 2099/06/01 ~ 2099/06/30'], ['일자', '거래처명', '품목명', '수량', '단가', '공급가액', '메모']]
    let total = 0
    for (let i = 0; i < 9000; i += 1) {
      many.push([`2099/06/${String((i % 28) + 1).padStart(2, '0')}`, `가짜 거래처 ${i % 37}`, `가짜 제품 ${i % 11}`, 1, 1000, 1000 + i, `가짜 메모 ${randomBytes(660).toString('base64')}`])
      total += 1000 + i
    }
    many.push([null, '합계', null, 9000, null, total])
    const bytes5 = await xlsx([{ name: '판매현황', rows: many }])
    assert.ok(bytes5.length > 4.5 * 1024 * 1024, `F: 시험 엑셀이 4.5MB보다 작다(${bytes5.length})`)
    const pp = inboxPath(BIZ, me, '가짜 큰 판매.xlsx', 'big')
    await repo.finInboxPut!(pp, bytes5)
    const cBig = await processUpload({ repo, businessId: BIZ, fileName: '가짜 큰 판매.xlsx', bytes: await repo.finInboxRead(pp), classify: null, aiBudget: 0 })
    assert.ok(['applied', 'needs_review'].includes(cBig[0].status), `F: 5MB 엑셀을 처리하지 못했다 — ${cBig[0].status} ${cBig[0].message}`)
    assert.equal(cBig[0].rows, 9000, 'F: 5MB 엑셀 줄 수')
    await repo.finInboxRemove([pp])
    // 1시간 넘게 남은 파일 치우기.
    const old = inboxPath(BIZ, me, 'x.csv', 'old')
    await repo.finInboxPut!(old, new Uint8Array([1]))
    const realNow = Date.now
    Date.now = () => realNow() + 2 * 3_600_000
    try {
      assert.equal(await repo.finInboxSweep(`${BIZ}/${me}`), 1, 'F: 1시간 넘은 파일을 치우지 않았다')
    } finally {
      Date.now = realNow
    }
    // 여러 파일 중 하나가 던져도(연결 끊김) 나머지는 그대로 · 실패 카드 하나.
    const fail = (file_name: string, message: string): FileCard => ({ file_name, sheet: null, kind: 'unknown', period: null, status: 'failed', upload_id: null, rows: 0, message, why: [], ai_used: 0, confidence: 'none' })
    const seen: string[] = []
    const out = await sendEach(
      [{ name: '가.xlsx' }, { name: '나.xlsx' }, { name: '다.xlsx' }],
      async (f) => {
        seen.push(f.name)
        if (f.name === '나.xlsx') throw new Error('Failed to fetch')
        return [{ ...fail(f.name, ''), status: 'applied', message: '넣음' }]
      },
      fail,
    )
    assert.deepEqual(seen, ['가.xlsx', '나.xlsx', '다.xlsx'], 'F: 실패 뒤 다음 파일을 보내지 않았다')
    assert.deepEqual(out.map((c) => c.status), ['applied', 'failed', 'applied'], 'F: 한 파일 실패가 번졌다')
    assert.match(out[1].message, /이 파일만 다시/, 'F: 실패 문구')
    done.push('F 수신함 5MB · 15MB 왕복 · 남의 폴더 거부 · 처리 뒤 지움 · 1시간 치우기 · 5MB 엑셀 처리 · 한 파일 실패가 번지지 않음')
  }

  // ── G. PDF 30쪽 · 결산서 쪽 순서 · 쪽 나눔 · 스위치 · 서버 설정 · 보류 ──
  {
    assert.equal(DOC_MAX_PAGES, 30, 'G: PDF 쪽 한도')
    const page = (i: number) => [[`가짜 부속 명세서 ${i}쪽`], ['계정', '금액'], ['가짜 항목', 1000 + i]]
    const p25 = textPdf(Array.from({ length: 25 }, (_, i) => page(i + 1)))
    const d25 = await openDocument(p25, 'pdf')
    assert.equal(d25.pages, 25, 'G: 25쪽 PDF를 열지 못했다')
    await assert.rejects(openDocument(textPdf(Array.from({ length: 31 }, (_, i) => page(i + 1))), 'pdf'), /31쪽입니다 — 30쪽까지/, 'G: 31쪽을 받았다')
    const text = ['표지', '부속 명세서 1', '재 무 상 태 표 자산 …', '부속 명세서 2', '손익계산서 매출 …'].join('\n\f\n')
    const ordered = orderPages(text, 'official')
    assert.ok(/재 무 상 태 표/.test(ordered[0]) && /손익계산서/.test(ordered[1]), `G: 결산서 쪽을 앞에 두지 않았다 ${ordered.map((x) => x.slice(0, 6))}`)
    assert.deepEqual(orderPages(text, 'table'), text.split('\n\f\n'), 'G: 표 자료의 쪽 순서를 바꿨다')
    assert.equal(fitPages(['a'.repeat(40_000), 'b'.repeat(40_000)], 60_000).dropped, 1, 'G: 글자 한도')
    // 긴 답 — 8쪽 넘게 한 번에 보내면 잘린다(가짜). 쪽을 반으로 나눠 다 읽는다 · 호출 한도 넘으면 AI 실패.
    const table = (part: string[]): DocTable => ({ doc_kind: 'official_statement', company: null, period: '2098', title: null, columns: ['계정', '금액'], rows: part.map((p) => [p, 1]), totals: [], confidence: 'high', reason: 'x', cost_usd: 0, calls: 1 })
    const pages = Array.from({ length: 25 }, (_, i) => `p${i}`)
    let n = 0
    const t = await readSplitting(pages, 10, async (part) => (n += 1, part.length > 8 ? 'cut' : table(part)))
    assert.equal(t.rows.length, 25, 'G: 쪽 나눔 뒤 줄이 빠졌다')
    assert.deepEqual(t.rows.map((r) => r[0]), pages, 'G: 쪽 나눔 순서')
    assert.ok(n <= 10, `G: 호출 한도를 넘었다(${n})`)
    // 리뷰 5: 기다리는 오른쪽 형제까지 세어 한도를 넘지 않는다(한도 4 · 두 번 잘림).
    let n4 = 0
    await assert.rejects(readSplitting(pages, 4, async (part) => (n4 += 1, part.length > 8 ? 'cut' : table(part))), /AI 실패/)
    assert.ok(n4 <= 4, `리뷰 5: 쪽 나눔이 한도 4를 넘었다(${n4})`)
    await assert.rejects(readSplitting(pages, 2, async (part) => (part.length > 8 ? 'cut' : table(part))), /AI 실패 — 답이 길어 잘렸습니다/, 'G: 한도 안에서 못 나누는데 멈추지 않았다')
    // 스위치 꺼짐 · 서버 설정 없음 — 다른 문구 · «보류».
    const pdf = textPdf([[['가짜 판매현황 2099년 7월'], ['거래처명', '품목명', '공급가액'], ['가짜 거래처', '가짜 제품', 1000], ['합계', null, 1000]]])
    const off = await processUpload({ repo, businessId: BIZ, fileName: '가짜 7월 판매.pdf', bytes: pdf, classify: null, aiBudget: 0, docs: { allowed: false, read: null, closed: { why: 'switch', audience: '대표만' } } })
    assert.equal(off[0].status, 'later', 'G: 스위치 꺼짐이 «보류»가 아니다')
    assert.match(off[0].message, /지금 «대표만» 쓸 수 있습니다/, `G: 스위치 문구 ${off[0].message}`)
    const scan = await processUpload({ repo, businessId: BIZ, fileName: '가짜 스캔.pdf', bytes: (await import('./fixtures/finance-pdf')).scanPdf(new Uint8Array(await (await import('sharp')).default({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).jpeg().toBuffer()), 40, 40), classify: null, aiBudget: 0, docs: { allowed: true, read: null, closed: { why: 'env' } } })
    assert.equal(scan[0].status, 'later', `G: 서버 설정 없음(스캔)이 «보류»가 아니다 — ${scan[0].status} ${scan[0].message}`)
    assert.ok(scan[0].message.includes(MSG.docNoAi), `G: 서버 설정 문구 ${scan[0].message}`)
    assert.notEqual(MSG.docNoAi, MSG.docSwitchOff('대표만'), 'G: 두 문구가 같다')
    const rec = (await repo.listFinUploads(BIZ)).find((u) => u.upload_id === scan[0].upload_id)
    assert.ok(rec?.error?.startsWith(HOLD_PREFIX), `G: 보류 기록 앞머리가 없다(${rec?.error})`)
    done.push('G PDF 25쪽 열림 · 31쪽 거부 · 결산서 쪽 먼저 · 긴 답 쪽 나눔 · 한도 넘으면 AI 실패 · 스위치 문구 · 서버 설정 문구 · 보류 기록')
  }

  // ── H. 같은 파일 · CSV · 날짜 · 연간 · 숨긴 시트 · 웹 표 · 옛 xls · HEIC ──
  {
    // 같은 파일 다시 — «확인 필요»에 있으면 다시 해석할 올리기를 싣고, AI를 부르지 않는다.
    const odd = ledgerA('2099-08').map((r) => r.map((v) => (v === '[월계]' || v === '월 계' ? '[당월합산]' : v)))
    const bytes = await xlsx([{ name: '계정별원장', rows: odd }])
    const first = await processUpload({ repo, businessId: BIZ, fileName: '가짜 8월 원장.xlsx', bytes, classify: null, aiBudget: 0, today: new Date('2099-09-01') })
    assert.equal(first[0].status, 'applied', `H: 첫 올리기 ${first[0].status}`)
    let aiAgain = 0
    const again = await processUpload({ repo, businessId: BIZ, fileName: '가짜 8월 원장.xlsx', bytes, classify: async () => (aiAgain += 1, Promise.reject(new Error('x'))), aiBudget: 3, today: new Date('2099-09-01') })
    assert.equal(again[0].status, 'duplicate', 'H: 같은 파일이 늘었다')
    assert.match(again[0].message, /이미 넣은 파일/, 'H: 문구')
    assert.equal(aiAgain, 0, 'H: 같은 파일에 AI를 다시 불렀다')
    // CSV 1만 줄 초과 → 자르지 않고 오류.
    const csv = ['일자,거래처명,품목명,공급가액', ...Array.from({ length: TEXT_SHEET_MAX_ROWS + 5 }, (_, i) => `2099-10-01,가짜,가짜,${i}`)].join('\n')
    const big = await openUpload(new TextEncoder().encode(csv), '가짜.csv')
    assert.ok(!big.ok && /1만 줄까지/.test(big.message), 'H: CSV 1만 줄 초과를 잘라 넣었다')
    const fine = await openUpload(new TextEncoder().encode(csv.split('\n').slice(0, 9_000).join('\n') + '\n\n\n'), '가짜.csv')
    assert.ok(fine.ok && fine.sheets[0].rows.length === 9_000, 'H: 끝 빈 줄까지 세거나 9천 줄을 거부했다')
    // 날짜 변형.
    const dt = (v: string) => cellDate({ t: 'text', v })
    assert.equal(dt('26/01/05'), '2026-01-05')
    assert.equal(dt('01/05-3'), '0000-01-05')
    assert.equal(dt('1월 5일'), '0000-01-05')
    assert.equal(dt('2026년 1월 5일'), '2026-01-05')
    assert.equal(dt('2026/01/05 -1'), '2026-01-05')
    assert.equal(dt('2026/13/05'), 'bad')
    assert.equal(dt('01-05-3'), '0000-01-05', '리뷰 3: «01-05-3»을 두 자리 해로 읽었다')
    assert.equal(dt('12-31-1'), '0000-12-31', '리뷰 3: «12-31-1»이 bad')
    assert.equal(dt('26.01.05'), '2026-01-05')
    // 연간 제목 → 달은 날짜 칸.
    const annual = fromGrid('원장', [['회사명 : 가짜 / 2099/01/01 ~ 2099/12/31'], HEAD])
    assert.equal(detectMonth(annual, ['2099-03-02', '2099-03-09', '2099-03-20'], 'x.xlsx').period, '2099-03', 'H: 연간 제목에서 끝 달(12월)을 골랐다')
    assert.match(detectMonth(annual, ['2099-03-02', '2099-04-09'], 'x.xlsx').how, /섞임/, 'H: 여러 달 섞임을 적지 않았다')
    // 숨긴 시트 — 건너뛰고 카드에 수.
    const sales = (ym: string): Cell[][] => [['판매현황'], [`회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28`], ['일자', '거래처명', '품목명', '수량', '단가', '공급가액'], [`${ym.replace('-', '/')}/03`, '가짜 갑', '가짜 1', 1, 100, 100], [null, '합계', null, 1, null, 100]]
    const hid = await processUpload({ repo, businessId: BIZ, fileName: '가짜 숨김.xlsx', bytes: await xlsx([{ name: '판매현황', rows: sales('2099-11') }, { name: '계산용', rows: sales('2099-10'), hidden: true }]), classify: null, aiBudget: 0 })
    assert.equal(hid.length, 1, `H: 숨긴 시트를 읽었다(${hid.map((c) => c.sheet)})`)
    assert.ok(hid[0].notes?.includes('숨긴 시트 1개 건너뜀'), `H: 숨긴 시트 안내가 없다 ${hid[0].notes}`)
    // 웹 표(.xls 이름의 HTML) → 칸 격자.
    const html = `<html><head><meta charset="utf-8"><style>td{}</style></head><body><table><tr><td colspan="2">판매현황</td></tr><tr><th>일자</th><th>거래처명</th><th>품목명</th><th>공급가액</th></tr><tr><td>2099-12-01</td><td>가짜 &amp; 갑</td><td>가짜 1</td><td>1,000</td></tr></table></body></html>`
    const web = await openUpload(new TextEncoder().encode(html), '가짜 웹표.xls')
    assert.ok(web.ok, 'H: 웹 표를 열지 못했다')
    if (web.ok) {
      assert.equal(web.sheets[0].rows[2][1].t === 'text' && web.sheets[0].rows[2][1].v, '가짜 & 갑', 'H: 웹 표 글')
      assert.deepEqual(web.sheets[0].rows[2][3], { t: 'number', v: 1000 }, 'H: 웹 표 숫자')
    }
    assert.equal(parseHtmlTables('<p>표 없음</p>').length, 0)
    // 옛 xls · 암호 엑셀 · DRM — 문구가 다르다.
    const ole = (name: string) => {
      const b = new Uint8Array(2048)
      ;[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((x, i) => (b[i] = x))
      for (let i = 0; i < name.length; i += 1) b[1024 + i * 2] = name.charCodeAt(i)
      return b
    }
    assert.equal(oleKind(ole('Workbook')), 'xls')
    assert.equal(oleKind(ole('EncryptedPackage')), 'encrypted')
    assert.equal(oleKind(ole('DRMContent')), 'other')
    const xlsOpen = await openUpload(ole('Workbook'), '가짜 옛.xls')
    assert.ok(!xlsOpen.ok && xlsOpen.message === MSG.oldXls, 'H: 옛 xls 문구')
    // HEIC · WEBP.
    const heic = new Uint8Array(32)
    new TextEncoder().encode('\0\0\0\x18ftypheic').forEach((x, i) => (heic[i] = x))
    const h = await openUpload(heic, 'IMG_0001.HEIC')
    assert.ok(!h.ok && h.message === MSG.photoFormat, 'H: HEIC 문구')
    done.push('H 같은 파일 → 다시 해석 안내(AI 0) · CSV 1만 줄 초과 오류 · 날짜 변형 · 연간 제목 · 숨긴 시트 · 웹 표 · 옛 xls · 암호 · HEIC')
  }

  // ── I. 원장 계정 코드 칸 없음 → 높은 믿음 · 건너뛴 줄 수 · 스위치 근거 ──
  {
    const cls = classifyByCode(sheetOf(ledgerA('2099-07')))
    assert.equal(cls.kind, 'ledger', 'I: 원장으로 보지 않았다')
    assert.equal(cls.confidence, 'high', `I: 계정 코드 칸이 없다고 믿음이 낮다(${cls.confidence} · ${cls.reason})`)
    const rows: Cell[][] = [['판매현황'], ['회사명 : (주)가짜산업 / 2099/09/01 ~ 2099/09/28'], ['일자', '거래처명', '품목명', '수량', '단가', '공급가액'], ['2099/09/03', '가짜 갑', '가짜 1', 1, 100, 100], ['2099/09/04', null, null, 2, 100, 200], ['2099/09/05', '가짜 을', '가짜 2', 'x', 100, 300], [null, '합계', null, 1, null, 100]]
    const c = await processUpload({ repo, businessId: BIZ, fileName: '가짜 9월 판매.xlsx', bytes: await xlsx([{ name: '판매현황', rows }]), classify: null, aiBudget: 0 })
    assert.ok(c[0].notes?.some((x) => /읽지 않은 줄 2개/.test(x)), `I: 건너뛴 줄 수가 카드에 없다 ${c[0].notes}`)
    const rowsF = defaultFeatureRows()
    const w = featureWhyFor(rowsF, 'finance_docs', 'Member', BIZ)
    assert.deepEqual([w.on, w.where, w.audience], [false, 'group', 'chairman'], 'I: 기본 줄 근거')
    const w2 = featureWhyFor([...rowsF, { ...rowsF.find((r) => r.feature_key === 'finance_docs')!, business_id: BIZ, audience: 'all' }], 'finance_docs', 'Member', BIZ)
    assert.deepEqual([w2.on, w2.where], [true, 'company'], 'I: 회사 줄 근거')
    assert.deepEqual(featureWhyFor(null, 'finance_docs', 'Member', BIZ).where, 'default', 'I: 0073 전 DB는 기본값')
    done.push('I 원장 코드 칸 없음 → 높음 · 건너뛴 줄 수 · 스위치 근거(회사 → 그룹 → 기본)')
  }

  return `업로드 단단히 ${done.length}묶음(${done.join(' / ')})`
}
