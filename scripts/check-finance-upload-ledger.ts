/**
 * 2026-10-14 운영 첫 사용 고침 검사 — ⑤ 계정별 원장 구조 해석(가짜 파일 · 가짜 AI만, 진짜 AI 호출 0회).
 * check-finance-upload.ts 끝에서 부른다(같은 dummy repo · 같은 DUMMY_USER).
 *
 *   ① ECOUNT 모양(계정 머리 · 전기이월 · 거래 · 일계 · 월계 · 누계, 칸 7개) → 2배 없음 · 자동 넣기 · AI 0번
 *   ② 옛 규칙(앞 칸 «합계 · 월계»만 · 날짜 있으면 거래)이면 2배였다는 것 — 같은 파일로 재현
 *   ③ 잔액 칸을 대변으로 읽지 않음 — AI가 대변 = 잔액 열이라고 해도 잔액 흐름으로 바로잡음 · 머리글이 잘못 붙은 파일도
 *   ④ AI 실패(던짐) → 코드 규칙만으로 2배 없음
 *   ⑤ 재해석 — 처음 AI가 모르는 요약 낱말을 놓침 → 차이(숫자 없음)를 받고 두 번째에 맞춤 → 학습 저장 → 다음엔 AI 없이
 *   ⑥ 끝까지 안 맞으면 AI 3번에서 멈추고 «확인 필요» + 차이(억지로 맞추지 않음)
 *   ⑦ «AI로 다시 해석» — 대기의 칸 격자로 다시(파일 없이) · 옛 대기 취소 · 새 카드
 *   ⑧ AI 구조 스키마 — 자유 키 object 없음(400 원인)
 */
import assert from 'node:assert/strict'

import ExcelJS from 'exceljs'

import { STRUCTURE_SCHEMA } from '../src/lib/finance-upload/ai'
import { builtinRole, ledgerLayoutByCode, readLedgerWith } from '../src/lib/finance-upload/ledger'
import { aiSample, classifyByCode } from '../src/lib/finance-upload/pipeline'
import { fromGrid, processUpload, reinterpretPending, withStructure, type AiClassify, type AiStructure } from '../src/lib/finance-upload/process'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyFinLines } from '../src/lib/repository/dummy-finance-upload'

type Cell = string | number | null
const BIZ = 'biz_dy'

async function xlsx(name: string, rows: Cell[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(name)
  for (const r of rows) ws.addRow(r)
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** ECOUNT 계정별 원장 모양(가짜 값). summary로 요약 낱말을 바꿔 끼운다. 일계 줄에도 날짜가 있다(옛 규칙이 거래로 더한 줄). */
function ecountLedger(ym: string, o: { day?: string; month?: string; cum?: string; extraDay?: string } = {}): Cell[][] {
  const day = o.day ?? '[일    계]'
  const month = o.month ?? '[월    계]'
  const cum = o.cum ?? '[누    계]'
  const d = (n: number) => `${ym.replace('-', '/')}/${String(n).padStart(2, '0')}`
  const rows: Cell[][] = [
    ['계정별원장'],
    [`회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28`],
    ['일자-No.', '적요', '거래처코드', '거래처명', '차변', '대변', '잔액'],
    ['1509 (제품)'],
    [null, '[전기이월]', null, null, null, null, 1_000_000],
    [`${d(5)} -1`, '가짜 제품 입고', 'C01', '가짜 거래처 갑', 300_000, null, 1_300_000],
    [d(5), day, null, null, 300_000, 0, 1_300_000],
    [`${d(20)} -3`, '가짜 제품 출고', 'C02', '가짜 거래처 을', null, 200_000, 1_100_000],
    [d(20), day, null, null, 0, 200_000, 1_100_000],
    [null, month, null, null, 300_000, 200_000, 1_100_000],
    [null, cum, null, null, 300_000, 200_000, 1_100_000],
    ['2519 (외상매입금)'],
    [null, '[전기이월]', null, null, null, null, -5_000_000],
    [`${d(3)} -2`, '가짜 원재료 매입', 'S01', '가짜 공급처 병', null, 700_000, -5_700_000],
    [d(3), day, null, null, 0, 700_000, -5_700_000],
    [`${d(25)} -1`, '가짜 대금 지급', 'S01', '가짜 공급처 병', 400_000, null, -5_300_000],
    [d(25), day, null, null, 400_000, 0, -5_300_000],
  ]
  if (o.extraDay) rows.push([d(25), o.extraDay, null, null, 400_000, 700_000, -5_300_000])
  rows.push([null, month, null, null, 400_000, 700_000, -5_300_000], [null, cum, null, null, 400_000, 700_000, -5_300_000])
  return rows
}

const want = [
  { code: '1509', debit: 300_000, credit: 200_000 },
  { code: '2519', debit: 400_000, credit: 700_000 },
]

export async function runLedgerChecks(): Promise<string> {
  process.env.DUMMY_USER = 'support_lead'
  let aiCalls = 0
  const sent: string[] = []

  // ── ⑧ 스키마: 모든 object에 additionalProperties: false (운영 400 원인) ──
  const walk = (n: unknown, path: string) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    if (o.type === 'object') assert.equal(o.additionalProperties, false, `${path}: object에 additionalProperties: false가 아니다`)
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`)
  }
  walk(STRUCTURE_SCHEMA, 'STRUCTURE_SCHEMA')

  // ── 기본 규칙(낱말) ──
  for (const [t, r] of [['[월    계]', 'month'], ['< 누 계 >', 'cumulative'], ['1월 계', 'month'], ['** 합 계 **', 'total'], ['[전기이월]', 'carry'], ['전월이월', 'carry'], ['[일 계]', 'day'], ['소 계', 'subtotal'], ['가짜 제품 출고', null], ['합계상사', null]] as const) {
    assert.equal(builtinRole(t), r, `«${t}» 줄 종류가 ${r}가 아니다`)
  }

  // ── ① ECOUNT 모양 → 2배 없음 · 자동 · AI 0번 ──
  const mockAi: AiClassify = async (s, code) => {
    aiCalls += 1
    sent.push(JSON.stringify(s))
    return { kind: code.kind, header_row: code.headerRow, columns: code.columns, row_labels: [], account_head_col: null, company: null, period: null, confidence: 'high', reason: '가짜 AI' }
  }
  const cards1 = await processUpload({ repo, businessId: BIZ, fileName: '가짜 1월 계정별 원장.xlsx', bytes: await xlsx('계정별원장', ecountLedger('2098-01')), classify: mockAi, aiBudget: 3, today: new Date('2098-02-10') })
  assert.equal(cards1.length, 1)
  assert.equal(cards1[0].kind, 'ledger', `원장으로 알아보지 못했다: ${JSON.stringify(cards1[0])}`)
  assert.equal(cards1[0].status, 'applied', `ECOUNT 원장이 자동으로 안 들어갔다: ${cards1[0].message} ${cards1[0].why.join(' / ')}`)
  assert.equal(aiCalls, 0, '코드 규칙으로 맞는데 AI를 불렀다')
  const lines1 = dummyFinLines().filter((l) => l.kind === 'ledger' && l.period === '2098-01' && !l.voided_at)
  assert.deepEqual(lines1.map((l) => ({ code: l.row.account_code, debit: l.row.debit, credit: l.row.credit })), want, `계정 합이 다르다(2배?): ${JSON.stringify(lines1.map((l) => l.row))}`)

  // ── ② 옛 규칙이면 2배였다(재현) — 일계 줄(날짜 있음)을 거래로 더하면 거래 합 = 월계의 정확히 2배 ──
  {
    const sheet = fromGrid('계정별원장', ecountLedger('2098-01').map((r) => r.map((v) => v)))
    const layout = ledgerLayoutByCode(sheet)!
    const oldWay = readLedgerWith(sheet, { ...layout, labels: [{ text: '[일    계]', role: 'skip' }] })
    assert.equal(oldWay.mismatches.length, 0)
    // 일계 낱말을 모른다고 치면(옛 규칙): 날짜 있는 일계 줄이 거래로 더해져 2배.
    const blind = readLedgerWith(fromGrid('계정별원장', ecountLedger('2098-01', { day: '하루 마감' })), layout)
    assert.ok(blind.mismatches.some((m) => m.times === 2), `옛 규칙 재현이 2배가 아니다: ${JSON.stringify(blind.mismatches)}`)
    assert.ok(blind.problems.some((p) => p.includes('정확히 2배')), '2배 문구가 없다')
  }

  // ── ③ 잔액 칸을 대변으로 읽지 않음 ──
  {
    const sheet = fromGrid('계정별원장', ecountLedger('2098-01'))
    const code = classifyByCode(sheet)
    // AI가 대변 = 잔액 열(6)이라고 잘못 말해도 잔액 흐름이 맞지 않아 바로잡는다.
    const wrong: AiStructure = { kind: 'ledger', header_row: 2, columns: { date: 0, memo: 1, debit: 4, credit: 6, balance: 5 }, row_labels: [], account_head_col: null, company: null, period: null, confidence: 'high', reason: '가짜 — 칸 틀림' }
    const fixed = withStructure(code, wrong, sheet)
    assert.equal(fixed.ledger?.cols.credit, 5, `대변 칸을 바로잡지 못했다: ${JSON.stringify(fixed.ledger)}`)
    assert.equal(fixed.ledger?.cols.balance, 6)
    assert.ok(fixed.ledger?.note?.includes('바로잡'), '바로잡은 문구가 없다')
    const r = readLedgerWith(sheet, fixed.ledger!)
    assert.ok(r.rows.every((x) => Number(x.credit) >= 0), `대변이 음수로 읽혔다: ${JSON.stringify(r.rows)}`)
    assert.equal(r.mismatches.length, 0)
    // 머리글이 잘못 붙은 파일(대변 · 잔액 글이 뒤바뀜)도 코드만으로 바로잡는다.
    const swapped = ecountLedger('2098-01')
    swapped[2] = ['일자-No.', '적요', '거래처코드', '거래처명', '차변', '잔액', '대변']
    const l2 = ledgerLayoutByCode(fromGrid('계정별원장', swapped))!
    assert.equal(l2.cols.credit, 5, `머리글이 뒤바뀐 파일의 대변 칸: ${JSON.stringify(l2)}`)
  }

  // ── ④ AI 실패 → 코드 규칙만으로 2배 없음 (요약 줄이 일계뿐이라 대조할 줄이 없어 AI를 부르는 파일) ──
  {
    let thrown = 0
    const failing: AiClassify = async () => {
      thrown += 1
      throw new Error('400 {"type":"error","error":{"type":"invalid_request_error"}} (가짜)')
    }
    const onlyDays = ecountLedger('2098-02').filter((r) => !(typeof r[1] === 'string' && /월|누/.test(r[1]) && r[0] === null))
    const c = await processUpload({ repo, businessId: BIZ, fileName: '가짜 2월 원장.xlsx', bytes: await xlsx('계정별원장', onlyDays), classify: failing, aiBudget: 3, today: new Date('2098-03-10') })
    assert.equal(thrown, 1, 'AI 실패 뒤에도 계속 불렀다')
    assert.equal(c[0].status, 'needs_review')
    const p = (await repo.finUploadPending(c[0].upload_id!))!
    assert.ok(p.meta?.reason?.includes('AI 해석 실패'), `실패 이유가 없다: ${p.meta?.reason}`)
    assert.deepEqual(p.rows.map((r) => ({ code: r.account_code, debit: r.debit, credit: r.credit })), want, `AI 실패 때 코드 규칙 합이 다르다: ${JSON.stringify(p.rows)}`)
    await repo.finUploadCancel(c[0].upload_id!)
  }

  // ── ⑤ 재해석: 처음엔 모르는 요약 낱말(«[당일합산]», 날짜 있음)을 놓침 → 차이를 받고 두 번째에 맞춤 → 학습 → 다음엔 AI 없이 ──
  {
    const feedbacks: (string[] | undefined)[] = []
    const learner: AiClassify = async (s, code, feedback) => {
      aiCalls += 1
      feedbacks.push(feedback)
      sent.push(JSON.stringify(s))
      const labels = feedback?.length ? [{ text: '[당일합산]', role: 'day' as const }] : []
      return { kind: 'ledger', header_row: 2, columns: { date: 0, memo: 1, counterparty: 3, debit: 4, credit: 5, balance: 6 }, row_labels: labels, account_head_col: 0, company: '(주)가짜산업', period: null, confidence: 'high', reason: '가짜 AI' }
    }
    const rows = ecountLedger('2098-04', { day: '[당일합산]' })
    const before = aiCalls
    const c = await processUpload({ repo, businessId: BIZ, fileName: '가짜 4월 원장.xlsx', bytes: await xlsx('계정별원장', rows), classify: learner, aiBudget: 3, today: new Date('2098-05-10') })
    assert.equal(aiCalls - before, 2, `재해석 횟수가 2가 아니다: ${aiCalls - before}`)
    assert.equal(feedbacks[0], undefined)
    const fb = feedbacks[1]!.join('\n')
    assert.ok(/정확히 2배/.test(fb), `차이에 «2배»가 없다: ${fb}`)
    assert.ok(!/300000|300,000|700000|700,000|1,?300,?000/.test(fb), `재해석 차이에 금액이 실렸다: ${fb}`)
    assert.equal(c[0].status, 'applied', `재해석 뒤 자동으로 안 들어갔다: ${c[0].message} ${c[0].why}`)
    assert.equal(c[0].ai_used, 2)
    const shapes = await repo.listFinUploadShapes(BIZ)
    const s = shapes.find((x) => x.kind === 'ledger' && Object.keys(x.column_map).some((k) => k.startsWith('#day:')))
    assert.ok(s, `맞게 해석된 모양이 학습 표에 없다: ${JSON.stringify(shapes)}`)
    assert.ok(Object.values(s!.column_map).every((v) => Number.isInteger(v) && v >= 0 && v <= 200), '학습 표에 숫자 아닌 값 · 큰 값')
    // 같은 양식 다음 달 → AI 없이(던지는 AI를 줘도 부르지 않는다)
    const never: AiClassify = async () => {
      throw new Error('부르면 안 된다')
    }
    const c2 = await processUpload({ repo, businessId: BIZ, fileName: '가짜 5월 원장.xlsx', bytes: await xlsx('계정별원장', ecountLedger('2098-05', { day: '[당일합산]' })), classify: never, aiBudget: 3, today: new Date('2098-06-10') })
    assert.equal(c2[0].status, 'applied', `학습한 양식이 AI 없이 안 들어갔다: ${c2[0].message} ${c2[0].why}`)
    assert.equal(c2[0].ai_used, 0)
  }

  // ── ⑥ 끝까지 안 맞으면 AI 3번에서 멈춤 · 확인 필요 · 차이 표시 ──
  let stubbornId = ''
  {
    const stubborn: AiClassify = async () => {
      aiCalls += 1
      return { kind: 'ledger', header_row: 2, columns: { date: 0, memo: 1, debit: 4, credit: 5, balance: 6 }, row_labels: [], account_head_col: null, company: null, period: null, confidence: 'high', reason: '가짜 — 늘 놓침' }
    }
    const before = aiCalls
    const c = await processUpload({ repo, businessId: BIZ, fileName: '가짜 7월 원장.xlsx', bytes: await xlsx('계정별원장', ecountLedger('2098-07', { day: '[하루끝]' })), classify: stubborn, aiBudget: 9, today: new Date('2098-08-10') })
    assert.equal(aiCalls - before, 3, `AI를 3번(처음 + 다시 2번)보다 많이/적게 불렀다: ${aiCalls - before}`)
    assert.equal(c[0].status, 'needs_review')
    const p = (await repo.finUploadPending(c[0].upload_id!))!
    assert.ok(p.meta?.errors?.some((e) => /차이/.test(e) && /정확히 2배/.test(e)), `차이 표시가 없다: ${p.meta?.errors}`)
    assert.ok(p.meta?.reason?.includes('맞지 않음'), `끝까지 안 맞은 이유가 없다: ${p.meta?.reason}`)
    assert.ok(p.grid?.length, '다시 해석에 쓸 칸 격자가 없다')
    stubbornId = c[0].upload_id!
  }

  // ── ⑦ «AI로 다시 해석» — 파일 없이 대기의 칸 격자로 · 옛 대기 취소 · 새 카드 ──
  {
    const fixer: AiClassify = async () => {
      aiCalls += 1
      return { kind: 'ledger', header_row: 2, columns: { date: 0, memo: 1, debit: 4, credit: 5, balance: 6 }, row_labels: [{ text: '[하루끝]', role: 'day' }], account_head_col: null, company: null, period: null, confidence: 'high', reason: '가짜 — 이번엔 봄' }
    }
    const r = await reinterpretPending({ repo, businessId: BIZ, classify: fixer, aiBudget: 3, today: new Date('2098-08-10') }, stubbornId)
    assert.ok(!r.error, `다시 해석 오류: ${r.error}`)
    assert.equal(r.cards[0]?.status, 'applied', `다시 해석 뒤 자동으로 안 들어갔다: ${JSON.stringify(r.cards)}`)
    const old = (await repo.listFinUploads(BIZ)).find((u) => u.upload_id === stubbornId)
    assert.equal(old?.status, 'cancelled', '옛 대기가 취소되지 않았다')
    const l7 = dummyFinLines().filter((l) => l.kind === 'ledger' && l.period === '2098-07' && !l.voided_at)
    assert.deepEqual(l7.map((l) => ({ code: l.row.account_code, debit: l.row.debit, credit: l.row.credit })), want)
    // 이미 처리한 대기는 다시 못 한다
    assert.ok((await reinterpretPending({ repo, businessId: BIZ, classify: fixer, aiBudget: 3 }, stubbornId)).error)
  }

  // ── AI 견본: 숫자 가림 · 요약 줄 · 줄 번호 · 원료 금액 없음 ──
  const allSent = sent.join('\n')
  assert.ok(!/300000|700000|1300000|5000000/.test(allSent), 'AI 견본에 금액이 실렸다')
  assert.ok(/당일합산/.test(allSent) && /row_no/.test(allSent), 'AI 견본에 요약 줄 낱말 · 줄 번호가 없다')
  {
    const big = fromGrid('계정별원장', [...ecountLedger('2098-09'), ...Array.from({ length: 60 }, (_, i) => [`2098/09/${String((i % 27) + 1).padStart(2, '0')}`, '가짜', null, null, 1, null, 1] as Cell[]), [null, '[ 특 별 계 ]', null, null, 1, 1, 1]])
    const s = aiSample(big, 2)
    assert.ok(s.rows.some((r) => r.includes('[ 특 별 계 ]')), '창 밖의 «…계» 줄이 견본에 없다')
    assert.equal(s.rows.length, s.row_no.length)
  }
  return `원장 구조: ECOUNT 모양 2배 없음 · AI 0번 자동 · 옛 규칙 2배 재현 · 잔액 ≠ 대변(AI 틀림 · 머리글 뒤바뀜 바로잡음) · AI 실패 코드 규칙 · 재해석 2번째 맞춤(차이에 금액 없음) · 학습 → 다음 달 AI 없이 · 3번에서 멈춤 + 차이 · 다시 해석(파일 없이) · 스키마 additionalProperties false · 견본 숫자 가림. 가짜 AI ${aiCalls}회`
}
