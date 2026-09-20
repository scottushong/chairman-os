/**
 * Phase 2-C 공식 재무제표 · 월별 간이 손익 검증 (오프라인, DB 없음): npm run check:statements
 *
 * 무엇을 재나
 *   1) 재무상태표가 닫히는가 — 1원 차이도 잡는다. 이 검사가 저장 버튼을 막는다.
 *   2) 손익 소계가 **finance_kpis 뷰와 같은 공식**인가. 화면과 뷰가 다른 값을 말하면
 *      회장이 같은 회사의 영업이익을 두 자리에서 다르게 읽는다.
 *   3) 붙여넣기 파서 — 엑셀에서 온 열 하나를 12개월로 푼다. 실패한 칸은 0이 아니라 빈칸이다.
 *   4) 공식 재무제표가 덮은 달의 잠금 판정.
 *
 * **부호 규약이 이 파일의 핵심이다.** 0015의 원장은 amount = 차변 − 대변이라
 * 매출·부채·자본이 음수로 들어온다. 화면은 양수로 읽어야 하므로 뒤집는 자리가 생기고,
 * 그 뒤집기를 한 군데라도 빠뜨리면 자산과 부채가 더해져 재무상태표가 '닫힌 것처럼' 보인다.
 */
import assert from 'node:assert/strict'

import {
  balanceCheck,
  incomeSubtotals,
  type StatementLine,
} from '../src/lib/statements/balance'
import { parsePastedColumn } from '../src/lib/statements/paste'
import { isLocked, monthsCovered } from '../src/lib/statements/period'

const line = (section: StatementLine['section'], amount: number, code = 'x'): StatementLine => ({
  account_code: code,
  section,
  amount,
})

/** 억 단위로 쓰면 읽기 쉽다. 검사는 원 단위로 돈다. */
const eok = (n: number) => n * 100_000_000

function balanceSheetCloses() {
  // 자산 100억 = 부채 40억 + 자본 60억. 부채·자본은 대변이라 원장에 음수로 앉는다.
  const closed: StatementLine[] = [
    line('cash', eok(30)),
    line('receivable', eok(20)),
    line('other_asset', eok(50)),
    line('payable', eok(-15)),
    line('other_liability', eok(-25)),
    line('equity', eok(-60)),
  ]
  const ok = balanceCheck(closed)
  assert.equal(ok.assets, eok(100))
  assert.equal(ok.liabilities, eok(40), '부채는 양수로 읽힌다')
  assert.equal(ok.equity, eok(60), '자본은 양수로 읽힌다')
  assert.equal(ok.difference, 0)
  assert.equal(ok.balanced, true)

  // 1원이 어긋나도 닫히지 않는다. 확정으로 저장되면 그 뒤 모든 화면이 틀린 값을 확정으로 말한다.
  const off = balanceCheck([...closed, line('cash', 1)])
  assert.equal(off.difference, 1)
  assert.equal(off.balanced, false)

  // 빈 재무제표는 0 = 0이지만 '닫혔다'고 하면 안 된다 — 아무것도 안 넣고 저장되는 길이 열린다.
  assert.equal(balanceCheck([]).balanced, false, '줄이 하나도 없으면 닫힌 것이 아니다')
}

/**
 * 손익 소계. 공식은 0015의 finance_kpis 뷰에서 그대로 가져왔다.
 *   ebitda = -(revenue + cogs + sga)
 *   op     = -(revenue + cogs + sga + d_and_a)
 *   ni     = -(revenue + cogs + sga + d_and_a + non_operating + tax)
 */
function incomeMatchesTheView() {
  const lines: StatementLine[] = [
    line('revenue', eok(-100)), // 매출 100억 (대변)
    line('cogs', eok(60)),
    line('sga', eok(20)),
    line('d_and_a', eok(5)),
    line('non_operating', eok(3)), // 영업외 '비용' 3억
    line('tax', eok(2)),
  ]
  const s = incomeSubtotals(lines)

  assert.equal(s.revenue, eok(100), '매출은 양수로 읽힌다')
  assert.equal(s.cogs, eok(60))
  assert.equal(s.grossProfit, eok(40))
  assert.equal(s.sga, eok(20))
  assert.equal(s.ebitda, eok(20))
  assert.equal(s.operatingProfit, eok(15))
  assert.equal(s.nonOperating, eok(-3), '영업외는 이익이 양수 — 비용이면 음수다')
  assert.equal(s.tax, eok(2))
  assert.equal(s.netIncome, eok(10))

  // 뷰의 공식과 한 번 더 대조한다. 여기가 틀리면 화면과 DB가 다른 값을 말한다.
  const sum = (secs: StatementLine['section'][]) =>
    lines.filter((l) => secs.includes(l.section)).reduce((a, l) => a + l.amount, 0)
  assert.equal(s.ebitda, -sum(['revenue', 'cogs', 'sga']))
  assert.equal(s.operatingProfit, -sum(['revenue', 'cogs', 'sga', 'd_and_a']))
  assert.equal(
    s.netIncome,
    -sum(['revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax']),
  )

  // 영업외 '이익'(대변)이면 당기순이익이 올라간다.
  const withGain = incomeSubtotals([...lines.slice(0, 4), line('non_operating', eok(-3)), line('tax', eok(2))])
  assert.equal(withGain.nonOperating, eok(3))
  assert.equal(withGain.netIncome, eok(16))
}

function pasteParser() {
  // 엑셀에서 열 하나를 복사하면 줄바꿈으로 온다. 천 단위 쉼표와 통화 기호가 붙는다.
  const plain = parsePastedColumn('1,200\n₩3,400\n5600', 12)
  assert.deepEqual(plain.values.slice(0, 3), [1200, 3400, 5600])
  assert.equal(plain.values.length, 12, '모자란 칸은 null로 채워 12칸을 맞춘다')
  assert.equal(plain.values[3], null)
  assert.equal(plain.failed, 0)

  // 한 줄로 복사하면 탭으로 온다.
  assert.deepEqual(parsePastedColumn('10\t20\t30', 3).values, [10, 20, 30])

  // 괄호는 음수다. 회계 표기를 그대로 받는다.
  assert.deepEqual(parsePastedColumn('(1,200)\n-300\n+45', 3).values, [-1200, -300, 45])

  // 빈 칸은 실패가 아니다. 그 달은 값이 없는 것이다.
  const withBlank = parsePastedColumn('100\n\n300', 3)
  assert.deepEqual(withBlank.values, [100, null, 300])
  assert.equal(withBlank.failed, 0)

  // 못 읽은 칸은 **0이 아니라 null**이다. 조용히 0을 넣으면 그 0이 장부로 간다.
  const bad = parsePastedColumn('100\n미정\n300', 3)
  assert.deepEqual(bad.values, [100, null, 300])
  assert.equal(bad.failed, 1, '몇 칸이 실패했는지 화면이 말해야 한다')

  // 12칸보다 많이 붙이면 넘치는 만큼 알린다. 잘라서 조용히 넣지 않는다.
  const over = parsePastedColumn('1\n2\n3\n4', 3)
  assert.deepEqual(over.values, [1, 2, 3])
  assert.equal(over.overflow, 1)

  // 소수점은 원 단위 반올림이다. 장부에 전 단위는 없다.
  assert.deepEqual(parsePastedColumn('1200.4\n1200.6', 2).values, [1200, 1201])
}

function officialPeriodLocking() {
  assert.equal(monthsCovered({ kind: 'year', key: '2025' }).length, 12)
  assert.equal(monthsCovered({ kind: 'year', key: '2025' })[0], '2025-01')
  assert.equal(monthsCovered({ kind: 'year', key: '2025' })[11], '2025-12')

  assert.deepEqual(monthsCovered({ kind: 'quarter', key: '2026-Q1' }), [
    '2026-01',
    '2026-02',
    '2026-03',
  ])
  assert.deepEqual(monthsCovered({ kind: 'quarter', key: '2026-Q4' }), [
    '2026-10',
    '2026-11',
    '2026-12',
  ])

  const officials = [
    { kind: 'year' as const, key: '2025' },
    { kind: 'quarter' as const, key: '2026-Q1' },
  ]
  assert.equal(isLocked('2025-06', officials), true, '2025년은 연간 결산이 덮는다')
  assert.equal(isLocked('2026-02', officials), true, '2026 1분기는 분기 결산이 덮는다')
  assert.equal(isLocked('2026-08', officials), false, '아직 결산이 없는 달은 열려 있다')
  assert.equal(isLocked('2026-08', []), false)
}

balanceSheetCloses()
incomeMatchesTheView()
pasteParser()
officialPeriodLocking()

console.log(
  'PASS: 재무상태표 1원 차이 검출, 손익 소계 = finance_kpis 공식, 붙여넣기 파서(실패는 null), 공식 기간 잠금',
)
