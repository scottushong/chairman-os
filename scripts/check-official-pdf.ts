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
 *   (0083 · 2026-10-17 2차)
 *   8. 국세청 양식 이름 30줄 × ECOUNT식 계정과목표(지어냄) — 코드 맞춤률 · 가짜 AI 2차 · 학습 뒤 100%
 *   9. 3년치 PDF(dummy) → 해 셋 · 올린 원본이 증빙으로 보관 · 링크 없이 해마다 저장(3벌) · 같은 해는 «바꾸기» 확인 · 다시 올리면 학습으로 전부 맞춤
 *  10. 계정과목표가 비면 «먼저 계정과목표를» · 해 짐작(파일 이름 · 표지) · AI 제안은 계정과목표 · 묶음 밖이면 버림
 *  11. 화면 문구(꺼진 이유 · 제안 전부 승인 · 증빙 · 이유 칸)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { mergeTables } from '../src/lib/finance-upload/ai-doc'
import { openDocument } from '../src/lib/finance-upload/doc-open'
import { createHash } from 'node:crypto'

import { applyOfficialSuggestions, buildOfficialDraft, guessYears, layoutToStatement, mockDocReader, NO_ACCOUNTS_MSG, type DocTable } from '../src/lib/finance-upload/doc-read'
import { cleanLabel, isSuggestion, matchOfficial, officialLines, stdKey } from '../src/lib/finance-upload/official-lines'
import { linesToAsk, mockOfficialSuggester } from '../src/lib/finance-upload/official-suggest'
import { processUpload } from '../src/lib/finance-upload/process'
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

  // ── 8. 국세청 양식 30줄 × ECOUNT식 계정과목표(지어냄 — 코드 · 이름은 흔한 K-GAAP 모양) ──
  type Sec = (typeof accounts)[number]['section']
  const EC: { account_code: string; name: string; section: Sec }[] = (
    [
      ['103', '보통예금', 'cash'], ['108', '외상매출금', 'receivable'], ['109', '대손충당금', 'receivable'], ['120', '미수금', 'other_asset'],
      ['131', '선급금', 'other_asset'], ['150', '제품', 'other_asset'], ['153', '원재료', 'other_asset'], ['202', '건물', 'other_asset'],
      ['203', '감가상각누계액', 'other_asset'], ['206', '기계장치', 'other_asset'], ['207', '감가상각누계액', 'other_asset'],
      ['251', '외상매입금', 'payable'], ['253', '미지급금', 'other_liability'], ['260', '단기차입금', 'other_liability'],
      ['293', '장기차입금', 'other_liability'], ['295', '퇴직급여충당부채', 'other_liability'], ['331', '자본금', 'equity'],
      ['375', '이월이익잉여금', 'equity'], ['404', '제품매출', 'revenue'], ['455', '제품매출원가', 'cogs'], ['801', '급여', 'sga'],
      ['806', '퇴직급여', 'sga'], ['811', '복리후생비', 'sga'], ['812', '여비교통비', 'sga'], ['813', '접대비', 'sga'],
      ['815', '수도광열비', 'sga'], ['817', '세금과공과', 'sga'], ['822', '차량유지비', 'sga'], ['833', '광고선전비', 'sga'],
      ['901', '이자수익', 'non_operating'], ['907', '외화환산이익', 'non_operating'], ['951', '이자비용', 'non_operating'], ['998', '법인세등', 'tax'],
    ] as const
  ).map(([account_code, name, section]) => ({ account_code, name, section }))
  const NTS: [string, string][] = [
    ['자산', '1.현금및현금성자산'], ['자산', '2.매출채권'], ['자산', '3.대손충당금'], ['자산', '4.미수금'], ['자산', '5.선급금'],
    ['자산', '6.제품'], ['자산', '7.원재료'], ['자산', '8.건물'], ['자산', '9.감가상각누계액'], ['자산', '10.기계장치'],
    ['부채', '1.매입채무'], ['부채', '2.미지급금'], ['부채', '3.단기차입금'], ['부채', '4.장기차입금'], ['부채', '5.퇴직급여충당부채'],
    ['자본', '1.자본금'], ['자본', '2.미처분이익잉여금'], ['매출', '1.제품매출'],
    ['판관비', '1.급여'], ['판관비', '2.퇴직급여'], ['판관비', '3.복리후생비'], ['판관비', '4.여비교통비'], ['판관비', '5.기업업무추진비'],
    ['판관비', '29.전기료(수도료 제외)'], ['판관비', '30.세금과공과금'], ['판관비', '34.해외시장개척비'], ['판관비', '12. 차량 유지비'],
    ['영업외수익', '1.이자수익'], ['영업외수익', '7.외화환산이익'], ['영업외비용', '1.이자비용'],
  ]
  assert.equal(NTS.length, 30)
  const t30: DocTable = { ...t, columns: ['구분', '계정과목', '줄', '2025'], rows: NTS.map(([g, l], i) => [g, l, '항목', 100 + i]), period: '2025' }
  const d30 = buildOfficialDraft(t30, EC, '2025 표준재무제표.pdf')
  assert.equal(d30.lines.length, 30)
  const codeRate = d30.lines.filter((l) => l.account_code).length
  const sure = d30.lines.filter((l) => l.account_code && !isSuggestion(l.how)).length
  assert.ok(codeRate >= 27, `코드 맞춤 ${codeRate}/30`)
  assert.equal(d30.lines.find((l) => l.label === '29.전기료(수도료 제외)')?.account_code, '815', '괄호 설명을 떼고 전기료 → 수도광열비')
  assert.equal(d30.lines.find((l) => l.label === '12. 차량 유지비')?.how, 'exact', '띄어쓰기를 걷고 이름 그대로')
  assert.equal(d30.lines.find((l) => l.label === '9.감가상각누계액')?.account_code, null, '같은 이름 계정 둘(203 · 207) 중 하나를 코드가 골랐다')
  // 2차 — 가짜 AI(두 글자 조각) · 계정과목표 · 묶음 밖 제안은 버린다
  const ask = linesToAsk(d30)
  assert.deepEqual(ask.map((a) => a.label).sort(), ['감가상각누계액', '해외시장개척비'], `AI에 묻는 줄: ${ask.map((a) => a.label)}`)
  assert.ok(ask.every((a) => !('values' in a) && !('printed' in a)), 'AI에 숫자를 보낸다')
  const fakeAi = await mockOfficialSuggester({ lines: ask, accounts: EC })
  const applied = applyOfficialSuggestions(d30, [...fakeAi.items, { line: ask[0].line, account_code: '404', confidence: 'high' }, { line: 0, account_code: 'ZZZ', confidence: 'high' }], EC)
  const aiRate = d30.lines.filter((l) => l.account_code).length
  assert.equal(d30.lines.find((l) => l.label === '9.감가상각누계액')?.how, 'ai', '가짜 AI 제안이 안 붙었다')
  assert.equal(d30.lines.find((l) => l.label === '9.감가상각누계액')?.confidence, 'low')
  assert.ok(!d30.lines.some((l) => l.account_code === '404' && l.group !== 'revenue'), '묶음 밖(매출) 제안을 받았다')
  assert.equal(d30.lines[0].how, 'alias', '이미 맞춘 줄을 AI가 덮었다')
  // 사람: 남은 줄(해외시장개척비 → 광고선전비) · 감가상각누계액은 건물 쪽(203) — 저장하면 학습
  const finalPick = d30.lines.map((l) => (l.label === '34.해외시장개척비' ? '833' : l.label === '9.감가상각누계액' ? '203' : l.account_code!))
  const learnedMap = new Map(d30.lines.map((l, i) => [l.std_key, finalPick[i]]))
  assert.ok([...learnedMap.keys()].every((k) => /^[a-z_]{1,20}:.{1,80}$/.test(k)), '학습 열쇠 모양이 DB 규칙(0083)과 다르다')
  assert.equal(stdKey('sga', '29.전기료(수도료 제외)'), 'sga:전기료')
  const again = buildOfficialDraft(t30, EC, '2026 표준재무제표.pdf', { learned: learnedMap })
  const learnedRate = again.lines.filter((l) => l.how === 'learned').length
  assert.equal(learnedRate, 30, `학습 뒤 ${learnedRate}/30`)
  assert.equal(again.lines.find((l) => l.label === '34.해외시장개척비')?.account_code, '833')
  assert.ok(!again.warnings.some((w) => /제안한 줄|못 맞춘 줄/.test(w)), '학습 뒤에도 제안 · 못 맞춤 경고')
  const rates = `코드 ${codeRate}/30(확정 ${sure}) → 가짜 AI 뒤 ${aiRate}/30(제안 ${applied}) → 학습 뒤 ${learnedRate}/30`

  // ── 9. 3년치 PDF(dummy) → 해 셋 · 증빙 보관 · 3벌 저장 · 바꾸기 확인 · 학습 ──
  const vana = (await repo.loadFinanceLedger()).accounts.filter((x) => x.business_id === biz && x.active).map((x) => ({ account_code: x.account_code, name: x.name, section: x.section }))
  const three = textPdf([[
    ['표준재무제표'],
    ['계정과목', '2091', '2092', '2093'],
    ['Ⅰ.자산'],
    ['1.현금및현금성자산', 100, 200, 300],
    ['Ⅱ.부채'],
    ['1.외상매입금', 40, 80, 120],
    ['Ⅲ.자본'],
    ['1.자본금', 60, 120, 180],
    ['Ⅳ.매출액'],
    ['1.제품매출', 1000, 1100, 1200],
    ['Ⅴ.판매비와관리비'],
    ['29.전기료', 10, 10, 10],
    ['34.해외시장개척비', 5, 5, 5],
  ]])
  const sha = createHash('sha256').update(three).digest('hex')
  const docs = { allowed: true, read: mockDocReader, businessName: '가짜산업', accounts: vana, learned: new Map(await repo.listOfficialAccountMap(biz).then((m) => m.map((x) => [x.std_key, x.account_code] as [string, string]))), suggest: mockOfficialSuggester }
  const cards = await processUpload({ repo, businessId: biz, fileName: '2091~3 표준재무제표.pdf', bytes: three, classify: null, aiBudget: 3, docs })
  assert.equal(cards[0].status, 'official', cards[0].message)
  const od = cards[0].official!
  assert.deepEqual(od.years, ['2091', '2092', '2093'], `해: ${od.years}`)
  assert.equal(od.evidence_file, `${biz}/${sha}.pdf`, `증빙 보관: ${od.evidence_file} · ${od.evidence_note}`)
  const { dummyHasOfficialEvidence } = await import('../src/lib/repository/dummy-books')
  assert.ok(dummyHasOfficialEvidence(od.evidence_file!), '증빙 보관함에 원본이 없다')
  assert.ok(cards[0].ai_used >= 2, `AI 사용 수(읽기 + 계정 제안): ${cards[0].ai_used}`)
  assert.equal(od.lines.find((l) => l.label === '29.전기료')?.how, 'alias')
  const pick9 = (l: (typeof od.lines)[number]) => (l.label === '34.해외시장개척비' ? '8330' : l.account_code!)
  const before9 = (await repo.listOfficialStatements(biz)).length
  for (const y of od.years) {
    const ls = officialLines(od.lines.filter((l) => typeof l.values[y] === 'number').map((l) => ({ label: l.label, account: vana.find((a) => a.account_code === pick9(l))!, printed: l.values[y] })))
    assert.ok(balanceCheck(ls).balanced, `${y} 균형`)
    await repo.saveOfficialStatement(
      { business_id: biz, period_kind: 'year', period_key: y, evidence_url: '', evidence_file: od.evidence_file, memo: `가짜 ${y}`, lines: ls.map((l) => ({ account_code: l.account_code, amount: l.amount })), learn: od.lines.map((l) => ({ std_key: l.std_key, account_code: pick9(l) })) },
      { user_id: 'u_chairman', role: 'Chairman' },
    )
  }
  const saved9 = (await repo.listOfficialStatements(biz)).filter((x) => ['2091', '2092', '2093'].includes(x.period_key))
  assert.equal(saved9.length, 3, '세 해가 세 벌로 저장되지 않았다')
  assert.equal((await repo.listOfficialStatements(biz)).length, before9 + 3)
  assert.ok(saved9.every((x) => x.evidence_url === null && x.evidence_file === od.evidence_file), '링크 없이 원본 증빙으로 저장되지 않았다')
  const again9 = { business_id: biz, period_kind: 'year' as const, period_key: '2093', evidence_url: '', evidence_file: od.evidence_file, memo: '가짜 다시', lines: [{ account_code: '1010', amount: 0.5 }, { account_code: '3310', amount: -0.5 }] }
  await assert.rejects(repo.saveOfficialStatement(again9, { user_id: 'u_chairman', role: 'Chairman' }), /official_exists/, '같은 해를 확인 없이 덮었다')
  await repo.saveOfficialStatement({ ...again9, replace: true }, { user_id: 'u_chairman', role: 'Chairman' })
  await assert.rejects(repo.saveOfficialStatement({ ...again9, period_key: '2094', evidence_file: `${biz}/${'0'.repeat(64)}.pdf` }, { user_id: 'u_chairman', role: 'Chairman' }), /official_evidence_file_missing/)
  await assert.rejects(repo.saveOfficialStatement({ ...again9, period_key: '2094', evidence_file: null }, { user_id: 'u_chairman', role: 'Chairman' }), /official_evidence_missing/)
  await assert.rejects(repo.saveOfficialStatement({ ...again9, period_key: '2094', lines: [{ account_code: '1010', amount: 10 }, { account_code: '3310', amount: -9 }] }, { user_id: 'u_chairman', role: 'Chairman' }), /official_unbalanced/, '안 닫힌 결산이 이유 없이 저장됐다')
  await repo.saveOfficialStatement({ ...again9, period_key: '2094', lines: [{ account_code: '1010', amount: 10 }, { account_code: '3310', amount: -9 }], unbalanced_reason: '세무사 반올림 1원' }, { user_id: 'u_chairman', role: 'Chairman' })
  assert.equal((await repo.listOfficialStatements(biz)).find((x) => x.period_key === '2094')?.unbalanced_reason, '세무사 반올림 1원')
  // 다음 파일 — 학습으로 전부 맞춤(AI 묻지 않음)
  const map9 = await repo.listOfficialAccountMap(biz)
  assert.ok(map9.length >= 6, `학습 표: ${JSON.stringify(map9)}`)
  let asked = 0
  const countSuggest: typeof mockOfficialSuggester = async (i) => {
    asked += i.lines.length
    return mockOfficialSuggester(i)
  }
  const next9 = await processUpload({ repo, businessId: biz, fileName: '2091~3 표준재무제표(사본).pdf', bytes: three, classify: null, aiBudget: 3, docs: { ...docs, learned: new Map(map9.map((x) => [x.std_key, x.account_code])), suggest: countSuggest } })
  const nd = next9[0].official!
  assert.ok(nd.lines.every((l) => l.how === 'learned'), `학습 뒤 못 맞춘 줄: ${nd.lines.filter((l) => l.how !== 'learned').map((l) => `${l.label}:${l.how}`)}`)
  assert.equal(asked, 0, '전부 맞췄는데 AI에 물었다')

  // ── 10. 계정과목표 없음 · 해 짐작 ──
  const empty = buildOfficialDraft(t30, [], '2025 표준재무제표.pdf')
  assert.equal(empty.no_accounts, true)
  assert.ok(empty.errors.includes(NO_ACCOUNTS_MSG) && /먼저 계정과목표\(ECOUNT 기초데이터 › 계정 내려받기\)를 올려 주세요/.test(NO_ACCOUNTS_MSG))
  assert.deepEqual(guessYears('2023~5 표준재무제표.pdf').years, ['2023', '2024', '2025'])
  assert.deepEqual(guessYears('2023-2025 결산.pdf').years, ['2023', '2024', '2025'])
  assert.deepEqual(guessYears('2025 결산.pdf'), { years: ['2025'], from: 'file_name' })
  assert.deepEqual(guessYears('결산서.pdf', '제 7기 2024년 12월 31일 현재'), { years: ['2024'], from: 'cover' })
  assert.equal(guessYears('결산서.pdf').from, 'unknown')
  const oneCol = buildOfficialDraft({ ...t30, columns: ['구분', '계정과목', '줄', '금액'], period: null }, EC, '2023~5 표준재무제표.pdf')
  assert.equal(oneCol.period_key, '2025', '해 칸이 없을 때 파일 이름의 마지막 해를 기본값으로')
  assert.equal(oneCol.year_from, 'file_name')

  // ── 11. 화면 문구(정적) ──
  const board = readFileSync('src/components/finance/finance-upload-board.tsx', 'utf8')
  for (const phrase of ['계정 못 맞춘 줄 ${missing.length}개', '제안 전부 승인', '먼저 계정과목표(ECOUNT 기초데이터 › 계정 내려받기)를 올려 주세요', '증빙 링크(선택 — 비워도 됩니다)', '맞지 않은 채 저장하는 이유', '바꿉니다(이전 결산은 지우지 않고', 'official-blockers-short']) {
    assert.ok(board.includes(phrase), `화면에 «${phrase}»가 없다`)
  }

  assert.equal(netCalls, 0)
  console.log(`8~11 PASS: ${rates} · 3년치 PDF → 해 셋 · 원본 증빙 보관 · 3벌 저장(링크 없이) · 같은 해 바꾸기 확인 · 안 닫힘 이유 · 다시 올리면 학습으로 전부(AI 0줄) · 계정표 없음 · 해 짐작 · 화면 문구`)
  console.log(
    'PASS: 번호 떼기(1. · Ⅳ. · (1) · ①) · 묶음 줄 빼기 · 낱 줄 없는 매출원가 묶음 살림 / 묶음 안 맞추기(판관비 전기료 → 수도광열비 · 제조 → 전력비 · 외화환산이익 → 영업외수익) / ' +
      '세 해 칸 · 해마다 균형 · 당기순이익 문서와 같음 · 제조원가명세서 «넣지 않음» / 같은 계정 더하기(유형자산 · 감가상각누계액) · 대손충당금 차감 / 글 PDF 해 머리글 / 나눠 읽은 해 칸 맞춤 / 서버 저장 같은 계정 더함 · 진짜 AI 0회.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
