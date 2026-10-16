/**
 * 2026-10-17 운영 고침 검사 — 공식 결산(국세청 표준재무제표 PDF) 미리보기가 저장까지 가는가. 진짜 AI 0회 · 진짜 회사 파일 없음
 * (줄 이름 · 숫자는 전부 지어낸 것).
 *
 *   npx tsx --conditions=react-server scripts/check-official-pdf.ts
 *
 * 운영에서 본 것: 줄 이름이 «29.전기료» · «1.이자수익»(번호 붙음)이라 102줄이 하나도 안 맞음 · 해가 2025 하나 · 금액 칸 하나 ·
 * 저장 단추가 꺼진 까닭이 안 보임. 여기서 잰다:
 *   1. 번호 떼기(1. · Ⅳ. · (1) · ①) · 묶음 줄(로마 숫자 · (1) · 총계 · 이익 줄 · 매출원가 계산 줄)은 저장 줄이 아님
 *   2. 묶음 안에서만 맞추기 — 판관비 «전기료» → 수도광열비(전력비는 매출원가 계정) · 영업외 «외화환산이익» → 영업외수익 묶음 계정
 *   3. 세 해 칸 · 해마다 균형 · 문서의 당기순이익과 같음 · 제조원가명세서 줄은 처음부터 «넣지 않음»
 *   4. 같은 계정에 묶인 줄은 더한다(건물 + 기계장치 → 유형자산) — 0020 줄 키가 겹치지 않게 · 대손충당금은 어디에 묶어도 차감
 *   5. 글 PDF(AI 없이) — 해 머리글 줄 · 번호 붙은 줄
 *   6. 나눠 읽은 결산서 합치기 — 해 칸을 이름으로 맞춤
 *   7. 서버 저장(saveOfficialStatement)이 같은 계정 두 줄을 더해서 저장 — 23505 없이
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { mergeTables } from '../src/lib/finance-upload/ai-doc'
import { openDocument } from '../src/lib/finance-upload/doc-open'
import { buildOfficialDraft, layoutToStatement, type DocTable } from '../src/lib/finance-upload/doc-read'
import { cleanLabel, matchOfficial, officialLines } from '../src/lib/finance-upload/official-lines'
import { signedAmount } from '../src/lib/finance-upload/official-sign'
import { STANDARD_CHART } from '../src/lib/ledger/standard-chart'
import { balanceCheck, incomeSubtotals } from '../src/lib/statements/balance'
import { readStatementLines } from '../src/lib/statements/lines'
import { textPdf } from './fixtures/finance-pdf'

delete process.env.ANTHROPIC_API_KEY
let netCalls = 0
globalThis.fetch = (async () => {
  netCalls += 1
  throw new Error('검사 중 네트워크 금지')
}) as typeof fetch

const accounts = STANDARD_CHART.map((a) => ({ account_code: a.code, name: a.name, section: a.section }))
const acc = (code: string) => accounts.find((a) => a.account_code === code)!

async function main() {
  // ── 1. 번호 떼기 ──
  assert.deepEqual(cleanLabel('29.전기료'), { name: '전기료', mark: 'number' })
  assert.deepEqual(cleanLabel('Ⅳ.판매비와관리비'), { name: '판매비와관리비', mark: 'roman' })
  assert.deepEqual(cleanLabel('(1) 당좌자산'), { name: '당좌자산', mark: 'paren' })
  assert.equal(cleanLabel('①이자수익').name, '이자수익')
  assert.deepEqual(cleanLabel('가지급금'), { name: '가지급금', mark: 'none' })
  assert.equal(matchOfficial('1.이자수익', 'nonop_income', accounts)?.acc.account_code, '9020')
  assert.equal(matchOfficial('29.전기료', 'sga', accounts)?.acc.account_code, '8150', '판관비 전기료 → 수도광열비')
  assert.equal(matchOfficial('29.전기료', 'mfg', accounts)?.acc.account_code, '4530', '제조 전기료 → 전력비')
  assert.equal(matchOfficial('1.급여', 'sga', accounts)?.acc.account_code, '8010')
  assert.equal(matchOfficial('1.급여', 'mfg', accounts)?.acc.account_code, '4520', '제조 급여 → 제조인건비')
  assert.equal(matchOfficial('7.외화환산이익', 'nonop_income', accounts)?.how, 'group')
  assert.equal(matchOfficial('34.해외시장개척비', 'sga', accounts), null, '없는 계정을 지어 맞췄다')
  assert.equal(matchOfficial('퇴직급여충당부채', 'liability', accounts)?.acc.account_code, '2950')

  // ── 2 · 3. AI 모양 표(세 해 · 구분 · 줄) — 운영에서 본 모양 ──
  const Y = (a: number, b: number, c: number) => [a, b, c]
  const S = null
  const t: DocTable = {
    doc_kind: 'official_statement',
    company: '(주)가짜산업',
    period: '2025',
    title: '표준재무제표',
    columns: ['구분', '계정과목', '줄', '2023', '2024', '2025'],
    rows: [
      ['자산', 'Ⅰ.유동자산', '소계', 150, 260, 370],
      ['자산', '(1)당좌자산', '소계', 150, 260, 370],
      ['자산', '1.현금및현금성자산', '항목', ...Y(100, 200, 300)],
      ['자산', '2.매출채권', '항목', ...Y(50, 60, 70)],
      ['자산', 'Ⅱ.비유동자산', '소계', S, S, S],
      ['자산', '(2)유형자산', '소계', 1350, 1200, 1050],
      ['자산', '1.건물', '항목', ...Y(1000, 1000, 1000)],
      ['자산', '2.감가상각누계액', '항목', ...Y(100, 200, 300)],
      ['자산', '3.기계장치', '항목', ...Y(500, 500, 500)],
      ['자산', '4.감가상각누계액', '항목', ...Y(50, 100, 150)],
      ['자산', '자산총계', '소계', ...Y(1500, 1460, 1420)],
      ['부채', 'Ⅰ.유동부채', '소계', 500, 460, 420],
      ['부채', '1.매입채무', '항목', ...Y(300, 260, 220)],
      ['부채', '2.단기차입금', '항목', ...Y(200, 200, 200)],
      ['자본', 'Ⅰ.자본금', '소계', 500, 500, 500],
      ['자본', '1.보통주자본금', '항목', ...Y(500, 500, 500)],
      ['자본', 'Ⅳ.이익잉여금(결손금)', '소계', 500, 500, 500],
      ['자본', '1.미처분이익잉여금', '항목', ...Y(500, 500, 500)],
      ['매출', 'Ⅰ.매출액', '소계', 2000, 2100, 2200],
      ['매출', '1.제품매출', '항목', ...Y(2000, 2100, 2200)],
      ['매출원가', 'Ⅱ.매출원가', '소계', ...Y(1200, 1300, 1400)],
      ['매출원가', '(1)기초제품재고액', '소계', 10, 20, 30],
      ['매출원가', '(2)당기제품제조원가', '소계', 1210, 1310, 1410],
      ['매출원가', '(3)기말제품재고액', '소계', 20, 30, 40],
      ['매출', 'Ⅲ.매출총이익', '소계', 800, 800, 800],
      ['판관비', 'Ⅳ.판매비와관리비', '소계', 415, 465, 465],
      ['판관비', '1.급여', '항목', ...Y(300, 300, 300)],
      ['판관비', '7.감가상각비', '항목', ...Y(100, 150, 150)],
      ['판관비', '29.전기료', '항목', ...Y(10, 10, 10)],
      ['판관비', '34.해외시장개척비', '항목', ...Y(5, 5, 5)],
      ['판관비', 'Ⅴ.영업이익', '소계', 385, 335, 335],
      ['영업외수익', 'Ⅵ.영업외수익', '소계', 5, 7, 9],
      ['영업외수익', '1.이자수익', '항목', ...Y(1, 2, 3)],
      ['영업외수익', '7.외화환산이익', '항목', ...Y(4, 5, 6)],
      ['영업외비용', 'Ⅶ.영업외비용', '소계', 20, 20, 20],
      ['영업외비용', '1.이자비용', '항목', ...Y(20, 20, 20)],
      ['법인세', 'Ⅸ.법인세비용', '소계', ...Y(30, 30, 30)],
      ['법인세', 'Ⅹ.당기순이익', '소계', ...Y(340, 292, 294)],
      ['제조원가', 'Ⅲ.경비', '소계', 40, 40, 40],
      ['제조원가', '29.전기료', '항목', ...Y(40, 40, 40)],
    ],
    totals: [],
    confidence: 'high',
    reason: '가짜',
  }
  const d = buildOfficialDraft(t, accounts, '2023~5 표준재무제표.pdf')
  assert.deepEqual(d.years, ['2023', '2024', '2025'])
  assert.equal(d.period_key, '2025')
  assert.deepEqual(d.net_income, { '2023': 340, '2024': 292, '2025': 294 })
  const by = (label: string, group?: string) => d.lines.find((l) => l.label === label && (!group || l.group === group))
  assert.ok(!d.lines.some((l) => /유동자산|당좌자산|자산총계|매출총이익|영업이익|당기순이익|기초제품|판매비와관리비/.test(l.label)), `묶음 줄이 저장 줄에: ${d.lines.map((l) => l.label).join(', ')}`)
  assert.ok(by('Ⅱ.매출원가'), '낱 줄 없는 매출원가 묶음을 낱 줄로 쓰지 않았다')
  assert.equal(by('Ⅸ.법인세비용')?.account_code, '9980')
  assert.equal(by('29.전기료', 'sga')?.account_code, '8150')
  assert.equal(by('29.전기료', 'sga')?.how, 'alias')
  assert.equal(by('29.전기료', 'mfg')?.skip, true, '제조원가명세서 줄이 «넣지 않음»이 아니다')
  assert.equal(by('1.이자수익')?.how, 'exact')
  assert.equal(by('7.외화환산이익')?.account_code, '9010')
  assert.equal(by('1.건물')?.account_code, '1400')
  assert.equal(by('3.기계장치')?.account_code, '1400')
  assert.equal(d.lines.filter((l) => l.account_code === '1410').length, 2, '건물 · 기계장치의 감가상각누계액이 한 줄로 합쳐졌다(같은 해)')
  assert.deepEqual(by('1.현금및현금성자산')?.values, { '2023': 100, '2024': 200, '2025': 300 })
  assert.equal(d.unmatched, 2, `못 맞춘 줄: ${d.lines.filter((l) => !l.skip && !l.account_code).map((l) => l.label)}`)
  assert.ok(d.balance?.balanced, `2025 균형: ${JSON.stringify(d.balance)}`)

  // 사람이 두 줄을 고르면(매출원가 → 기타제조경비 · 해외시장개척비 → 광고선전비) 해마다 닫히고 당기순이익이 문서와 같다.
  const pick: Record<string, string> = { 'Ⅱ.매출원가': '4590', '34.해외시장개척비': '8330' }
  for (const y of d.years) {
    const picked = d.lines
      .filter((l) => !l.skip && typeof l.values[y] === 'number')
      .map((l) => ({ label: l.label, account: acc(pick[l.label] ?? l.account_code!), printed: l.values[y] }))
    const lines = officialLines(picked)
    assert.equal(new Set(lines.map((l) => l.account_code)).size, lines.length, '같은 계정 줄이 둘')
    const b = balanceCheck(lines)
    assert.ok(b.balanced, `${y} 재무상태표: ${JSON.stringify(b)}`)
    assert.equal(incomeSubtotals(lines).netIncome, (d.net_income as Record<string, number>)[y], `${y} 당기순이익`)
    if (y === '2025') {
      assert.equal(lines.find((l) => l.account_code === '1400')?.amount, 1500, '건물 + 기계장치')
      assert.equal(lines.find((l) => l.account_code === '1410')?.amount, -450, '감가상각누계액 둘 더함 · 차감')
      assert.equal(lines.find((l) => l.account_code === '9010')?.amount, -6, '외화환산이익은 대변')
    }
  }

  // ── 4. 부호 — 줄 이름이 이긴다 ──
  assert.equal(signedAmount('receivable', '외상매출금', 10, '대손충당금'), -10, '대손충당금을 외상매출금에 묶으면 차감')
  assert.equal(signedAmount('non_operating', '영업외수익', 10, '잡손실'), 10, '잡손실을 영업외수익 계정에 묶어도 비용')
  assert.equal(signedAmount('non_operating', '영업외수익', 10), -10, '줄 이름이 없으면 예전 그대로')
  assert.equal(signedAmount('other_asset', '감가상각누계액', 300), -300)

  // ── 5. 글 PDF(AI 없이) — 해 머리글 · 번호 붙은 줄 ──
  const pdf = textPdf([[
    ['표준재무제표'],
    ['계정과목', '2024', '2025'],
    ['재무상태표'],
    ['1.현금및현금성자산', 100, 200],
    ['1.외상매출금', 50, 50],
    ['자산총계', 150, 250],
    ['1.외상매입금', 50, 50],
    ['1.자본금', 100, 200],
    ['부채와자본총계', 150, 250],
  ]])
  const opened = await openDocument(pdf, 'pdf')
  const lt = layoutToStatement(opened.layout!)
  assert.deepEqual(lt.columns, ['계정과목', '2024', '2025'])
  const d5 = buildOfficialDraft(lt, accounts, 'x.pdf')
  assert.deepEqual(d5.years, ['2024', '2025'])
  assert.equal(d5.unmatched, 0, `글 PDF 못 맞춤: ${d5.lines.filter((l) => !l.account_code).map((l) => l.label)}`)
  assert.equal(d5.lines.length, 4)
  assert.ok(d5.balance?.balanced, JSON.stringify(d5.balance))

  // ── 6. 나눠 읽은 결산서 — 해 칸을 이름으로 맞춤 ──
  const a: DocTable = { ...t, columns: ['구분', '계정과목', '줄', '2023', '2024'], rows: [['자산', '1.현금및현금성자산', '항목', 100, 200]], period: '2024' }
  const b: DocTable = { ...t, columns: ['구분', '계정과목', '줄', '2025'], rows: [['자산', '1.현금및현금성자산', '항목', 300]], period: '2025' }
  const m = mergeTables(a, b)
  assert.deepEqual(m.columns, ['구분', '계정과목', '줄', '2023', '2024', '2025'])
  assert.deepEqual(m.rows[1], ['자산', '1.현금및현금성자산', '항목', null, null, 300])
  assert.equal(m.period, '2025')
  const dm = buildOfficialDraft(m, accounts, 'x.pdf')
  assert.equal(dm.lines.length, 1, '해마다 따로 읽힌 같은 계정이 한 줄로 안 모였다')
  assert.deepEqual(dm.lines[0].values, { '2023': 100, '2024': 200, '2025': 300 })
  // 결산서가 아닌 표는 예전처럼 자리로(머리글 · 기간은 앞 표)
  const plainMerge = mergeTables({ ...a, doc_kind: 'sales', period: '2099-03' }, { ...b, doc_kind: 'sales', period: '2099-04' })
  assert.equal(plainMerge.period, '2099-03')
  assert.equal(plainMerge.columns.length, 5)

  // ── 7. 서버 저장 줄 — 같은 계정 두 줄을 더해서(saveOfficialStatement가 부르는 함수) → dummy 0020 저장 ──
  const sectionOf = new Map(accounts.map((x) => [x.account_code, x.section]))
  const raw = [
    { account_code: '1010', amount: 100 },
    { account_code: '1400', amount: 1000 },
    { account_code: '1400', amount: 500 },
    { account_code: '2010', amount: -600 },
    { account_code: '3310', amount: -1000 },
    { account_code: '9020', amount: 0 },
  ]
  const parsed = readStatementLines(raw, sectionOf)
  assert.ok(parsed)
  assert.deepEqual(parsed.lines, [
    { account_code: '1010', amount: 100 },
    { account_code: '1400', amount: 1500 },
    { account_code: '2010', amount: -600 },
    { account_code: '3310', amount: -1000 },
  ])
  assert.ok(balanceCheck(parsed.typed).balanced)
  assert.equal(readStatementLines([{ account_code: '1010', amount: 'abc' }], sectionOf), null, '숫자 아닌 금액을 조용히 뺐다')
  assert.equal(readStatementLines([{ account_code: '0000', amount: 1 }], sectionOf), null, '없는 계정을 받았다')
  process.env.DUMMY_USER = 'chairman'
  const { dummyRepository: repo } = await import('../src/lib/repository/dummy')
  const biz = 'biz_vana'
  const id = await repo.saveOfficialStatement({ business_id: biz, period_kind: 'year', period_key: '2096', evidence_url: 'https://example.invalid/fake.pdf', memo: '가짜 결산(검사)', lines: parsed.lines }, { user_id: 'u_chairman', role: 'Chairman' })
  const { officialStatementLines } = await import('../src/lib/repository/dummy-books')
  assert.equal((await officialStatementLines(id)).find((l) => l.account_code === '1400')?.amount, 1500)
  const action = readFileSync('src/app/actions/statements.ts', 'utf8')
  assert.ok(/readStatementLines\(input\.lines, sectionOf\)/.test(action), '저장 서버 함수가 readStatementLines를 쓰지 않는다')

  assert.equal(netCalls, 0)
  console.log(
    'PASS: 번호 떼기(1. · Ⅳ. · (1) · ①) · 묶음 줄 빼기 · 낱 줄 없는 매출원가 묶음 살림 / 묶음 안 맞추기(판관비 전기료 → 수도광열비 · 제조 → 전력비 · 외화환산이익 → 영업외수익) / ' +
      '세 해 칸 · 해마다 균형 · 당기순이익 문서와 같음 · 제조원가명세서 «넣지 않음» / 같은 계정 더하기(유형자산 · 감가상각누계액) · 대손충당금 차감 / 글 PDF 해 머리글 / 나눠 읽은 해 칸 맞춤 / 서버 저장 같은 계정 더함 · 진짜 AI 0회.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
