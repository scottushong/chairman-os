/**
 * Phase 2-A 재무 원장 검증 (오프라인, DB 없음): npm run check:finance
 *
 * 무엇을 재나
 *   1) 시트가 이긴다 — mock 원장을 lib/ledger 공식으로 접으면 06_Dummy_Data 480칸이 원 단위까지 같다.
 *      VANA 2026-08 EBITDA = 2.8억, 꼬리표는 잠정(마감 전).
 *   2) 재무제표가 닫힌다 — 모든 회사·그룹·달에서 자산 = 부채 + 자본, 기초 현금 + 현금 증감 = 기말 현금.
 *   3) 꼬리표 규칙 — (source, closed) → 확정/잠정/수기/추정, 합은 가장 약한 쪽.
 *   4) 경계 — ECOUNT 표기 변환, 분류 없는 계정은 멈춤, 키가 없으면 mock, 키 형식이 틀리면 mock으로 떨어지지 않음.
 *   5) 잠정-확정 차이가 결산조정 계정에서 나온다.
 *
 * 0015의 SQL 뷰(finance_kpis)가 같은 공식을 쓰는지는 이 스크립트가 못 잰다(DB가 없다).
 * 그건 OPERATIONS의 D-17 로컬 검증 또는 PGlite로 0001~0015를 올려 같은 480칸을 비교한다.
 */
import assert from 'node:assert/strict'

import { sheetFinanceKpis } from '../src/data'
import { ecountSetup } from '../src/lib/ecount/config'
import { MOCK_CHART } from '../src/lib/ecount/account-map'
import { mapAccounts, mapSlipLines, UnmappedAccountError } from '../src/lib/ecount/map'
import { loadMockLedger } from '../src/lib/ecount/mock-ledger'
import { closingDiff, kpiCards, runway } from '../src/lib/ledger/analysis'
import { basisOf, ledgerBasisOf, sumFigures, weakest } from '../src/lib/ledger/basis'
import { kpisFromLedger } from '../src/lib/ledger/cells'
import { ledgerScope } from '../src/lib/ledger/scope'
import { STANDARD_CHART } from '../src/lib/ledger/standard-chart'
import { SECTION_CATEGORIES } from '../src/lib/ledger/accounts'
import { balanceSheet, cashFlowStatement } from '../src/lib/ledger/statements'
import { dummyRepository } from '../src/lib/repository/dummy'

const BUSINESSES = ['biz_dy', 'biz_vana', 'biz_sticky', 'biz_hof', 'biz_boram']

async function sheetWins() {
  const ledger = await loadMockLedger()
  const kpis = kpisFromLedger(ledger, BUSINESSES)
  const key = (k: { period: string; business_id: string; metric: string }) => `${k.period}|${k.business_id}|${k.metric}`
  const got = new Map(kpis.map((k) => [key(k), k]))
  const bad = sheetFinanceKpis.filter((s) => got.get(key(s))?.value !== s.value)
  assert.equal(bad.length, 0, `시트와 다른 칸: ${bad.slice(0, 3).map(key).join(', ')}`)
  assert.equal(sheetFinanceKpis.length, 480)

  const vana = got.get('2026-08|biz_vana|EBITDA')!
  assert.equal(vana.value, 280_000_000, 'VANA EBITDA는 시트값 2.8억')
  assert.equal(vana.basis, 'provisional', '2026-08은 마감 전 — 잠정')
  assert.equal(got.get('2026-07|biz_vana|EBITDA')!.basis, 'confirmed', '2026-07은 마감 — 확정')
}

async function statementsClose() {
  const ledger = await loadMockLedger()
  for (const ids of [...BUSINESSES.map((b) => [b]), BUSINESSES]) {
    const scope = ledgerScope(ledger, ids)
    for (const period of scope.periods) {
      const bs = balanceSheet(scope, period)
      const assets = bs.find((r) => r.key === 'total-assets')!.current!.value
      const le = bs.find((r) => r.key === 'total-le')!.current!.value
      assert.ok(Math.abs(assets - le) < 1, `${ids.join('+')} ${period} 자산 ≠ 부채+자본`)

      const cf = cashFlowStatement(scope, period)
      if (cf[0].key === 'cf-unavailable') continue
      assert.ok(!cf.some((r) => r.key === 'cf-check'), `${ids.join('+')} ${period} 현금흐름 검산 불일치`)
    }
  }

  const group = ledgerScope(ledger, BUSINESSES)
  const cards = kpiCards(group, '2026-08')
  const revenue = cards.find((c) => c.metric === 'Revenue')!
  assert.equal(Math.round(revenue.month!.value / 1e7) / 10, 66.3, '그룹 매출 66.3억(DEFERRED D-01 표)')
  assert.equal(revenue.ytd!.basis, 'provisional', 'YTD에 잠정 달이 섞이면 잠정')
  assert.ok(revenue.ttm && revenue.yoyPct, 'TTM·전년비는 24개월 원장에서 선다')
  assert.equal(runway(group, '2026-08').status, 'burning')
}

function basisRules() {
  assert.equal(basisOf({ source: 'ecount', closed: true }), 'confirmed')
  assert.equal(basisOf({ source: 'ecount', closed: false }), 'provisional')
  assert.equal(basisOf({ source: 'manual', closed: true }), 'manual', '수기는 마감돼도 수기')
  assert.equal(basisOf({ source: 'estimate', closed: true }), 'estimate')
  // 0016 — 원장 표에서는 자체 장부(manual)도 마감이 꼬리표를 정한다
  assert.equal(ledgerBasisOf({ source: 'manual', closed: false }), 'provisional', '자체 장부 전표는 마감 전 잠정')
  assert.equal(ledgerBasisOf({ source: 'manual', closed: true }), 'confirmed', '자체 장부 결산은 확정')
  assert.equal(ledgerBasisOf({ source: 'ecount', closed: true }), 'confirmed')
  assert.equal(ledgerBasisOf({ source: 'estimate', closed: true }), 'estimate')
  assert.equal(weakest(['confirmed', 'estimate', 'provisional']), 'estimate')
  assert.equal(sumFigures([]), null, '원천이 없으면 0이 아니라 null')
}

async function boundaries() {
  const ctx = { chart: MOCK_CHART, business_id: 'biz_dy', fetched_at: '2026-09-16T00:00:00Z', last_closed_period: '2026-07' }
  const lines = mapSlipLines(
    [
      { IO_DATE: '20260731', SLIP_NO: 'A', SER_NO: '1', ACCT_CODE: '1010', DR_AMT: '1,000', CR_AMT: '0', REMARKS: '' },
      { IO_DATE: '20260801', SLIP_NO: 'B', SER_NO: '1', ACCT_CODE: '1010', DR_AMT: '-50', CR_AMT: '', REMARKS: '' },
    ],
    ctx,
  )
  assert.deepEqual(
    lines.map((l) => [l.entry_date, l.amount, l.side, l.closed]),
    [['2026-07-31', 1000, 'debit', true], ['2026-08-01', 50, 'credit', false]],
    '쉼표 금액, 역분개, 마감 달 판정',
  )
  assert.throws(
    () => mapSlipLines([{ IO_DATE: '20260801', SLIP_NO: 'C', SER_NO: '1', ACCT_CODE: '1010', DR_AMT: '1', CR_AMT: '1', REMARKS: '' }], ctx),
    /차변과 대변이 같이/,
  )
  assert.throws(() => mapAccounts([{ ACCT_CODE: '7777', ACCT_NAME: '모르는 계정' }], ctx), UnmappedAccountError)
  assert.throws(
    () => mapAccounts([{ ACCT_CODE: '1010', ACCT_NAME: '현금' }], { ...ctx, chart: {} }),
    UnmappedAccountError,
    '회사 계정과목표(DB)에 없는 계정이면 멈춘다',
  )

  assert.equal(ecountSetup({} as NodeJS.ProcessEnv).source.mode, 'mock')
  assert.throws(() => ecountSetup({ ECOUNT_COMPANIES: '{oops' } as unknown as NodeJS.ProcessEnv), /JSON이 아니다/)
  assert.throws(
    () => ecountSetup({ ECOUNT_COMPANIES: '[{"business_id":"biz_dy"}]' } as unknown as NodeJS.ProcessEnv),
    /com_code/,
  )
  assert.equal(
    ecountSetup({
      ECOUNT_COMPANIES: '[{"business_id":"biz_dy","com_code":"1","user_id":"u","api_cert_key":"k"}]',
    } as unknown as NodeJS.ProcessEnv).source.mode,
    'real',
  )
}

/** 표준 계정과목표(블록 1). mock 전표가 표준표 위에서 그대로 읽혀야 하고, 표 자체가 DB check를 통과해야 한다. */
function standardChart() {
  const codes = new Set<string>()
  for (const s of STANDARD_CHART) {
    assert.ok(!codes.has(s.code), `표준표 코드 중복: ${s.code}`)
    codes.add(s.code)
    assert.ok(SECTION_CATEGORIES[s.section].includes(s.category), `${s.code} 구분·대분류 불일치`)
  }
  const std = new Map(STANDARD_CHART.map((s) => [s.code, s]))
  // 8990 / 8299는 D-01 시트 모순을 드러내는 mock 전용 계정이다. 실제 장부에는 없다.
  for (const [code, m] of Object.entries(MOCK_CHART).filter(([c]) => c !== '8990' && c !== '8299')) {
    const s = std.get(code)
    assert.ok(s, `MOCK_CHART ${code}가 표준표에 없다`)
    assert.deepEqual(
      [s.name, s.category, s.section, s.cash_flow],
      [m.name, m.category, m.section, m.cash_flow],
      `MOCK_CHART ${code}와 표준표가 다르다`,
    )
  }
}

async function provisionalGap() {
  const ledger = await loadMockLedger()
  const diff = closingDiff(ledger, ledgerScope(ledger, ['biz_dy']))!
  assert.equal(diff.period, '2026-07')
  assert.deepEqual(diff.accounts.map((a) => a.account_code).sort(), ['2010', '4530', '8010'])
  assert.equal(diff.metrics.find((m) => m.metric === 'Revenue')!.diff.value, 0, '결산조정은 매출에 손대지 않았다')
  assert.ok(diff.metrics.find((m) => m.metric === 'EBITDA')!.diff.value < 0, '비용 계상 → EBITDA 감소')
}

/**
 * 자체 장부 흐름(Phase 2-B) — dummy 어댑터가 0016과 같은 규칙으로 도는가.
 * DB 쪽 같은 규칙은 check:migrations가 PGlite에서 잰다. 여기는 화면이 실제로 부르는 dummy 경로다.
 */
async function books() {
  const repo = dummyRepository
  const actor = { user_id: 'check', role: 'Chairman' }
  const vanaAug = async () => (await repo.listFinanceKpis()).find((k) => k.business_id === 'biz_vana' && k.period === '2026-08' && k.metric === 'Revenue')!
  const before = await vanaAug()
  assert.equal(before.basis, 'provisional')
  assert.equal(before.source, 'ecount', 'mock 전표만 있으면 source=ecount')

  const sale = (entry_date: string, amounts: [number, number]) => ({
    business_id: 'biz_vana',
    entry_date,
    memo: '검증 매출',
    evidence_url: null,
    lines: [
      { account_code: '1030', side: 'debit' as const, amount: amounts[0] },
      { account_code: '4010', side: 'credit' as const, amount: amounts[1] },
    ],
  })
  const slip = await repo.postJournalEntry(sale('2026-08-20', [1_000_000, 1_000_000]), actor)
  assert.match(slip, /^M2608-\d{6}$/)
  const after = await vanaAug()
  assert.equal(after.value - before.value, 1_000_000, '자체 장부 매출이 VANA 8월 매출에 더해진다')
  assert.equal(after.basis, 'provisional', '마감 전 — 잠정')
  assert.equal(after.source, 'manual', '자체 장부가 섞였다')
  const ledger = await repo.loadFinanceLedger()
  assert.equal(ledger.entries.filter((e) => e.slip_no === slip).length, 1, '헤더가 남는다')
  assert.equal(ledger.journal.filter((j) => j.slip_no === slip && j.source === 'manual').length, 2, '라인 두 줄')

  await assert.rejects(repo.postJournalEntry(sale('2026-07-15', [1000, 1000]), actor), /closed_period/, '마감된 달은 거부')
  await assert.rejects(repo.postJournalEntry(sale('2026-08-20', [1000, 999]), actor), /차변 합/, '차대 불일치는 거부')
  await repo.updateAccount('biz_vana', '4010', { active: false }, actor)
  await assert.rejects(repo.postJournalEntry(sale('2026-08-21', [1000, 1000]), actor), /비활성/, '비활성 계정은 거부')
  await repo.updateAccount('biz_vana', '4010', { active: true }, actor)

  // 블록 3 — 월 마감
  const kpisBefore = (await repo.listFinanceKpis()).filter((k) => k.business_id === 'biz_vana' && k.period === '2026-08')
  assert.ok(Number(await repo.closePeriod('biz_vana', '2026-08', actor)) > 0)
  const kpisAfter = (await repo.listFinanceKpis()).filter((k) => k.business_id === 'biz_vana' && k.period === '2026-08')
  assert.equal(kpisAfter.length, kpisBefore.length)
  assert.ok(kpisAfter.every((k) => k.basis === 'confirmed' && k.closed), '마감 뒤 확정')
  for (const k of kpisAfter) {
    assert.equal(k.value, kpisBefore.find((b) => b.metric === k.metric)!.value, `마감은 ${k.metric} 숫자를 바꾸지 않는다`)
  }
  await assert.rejects(repo.closePeriod('biz_vana', '2026-08', actor), /already_closed/)
  await assert.rejects(repo.closePeriod('biz_vana', '2999-01', actor), /period_not_ended/)
  await assert.rejects(repo.postJournalEntry(sale('2026-08-25', [1000, 1000]), actor), /closed_period/, '마감 뒤 그 달 입력은 거부')
  const closedLedger = await repo.loadFinanceLedger()
  assert.ok(
    closedLedger.journal.filter((j) => j.business_id === 'biz_vana' && j.entry_date.startsWith('2026-08')).every((j) => j.closed),
    '그 달 전표 라인이 전부 closed',
  )
}

async function main() {
  await sheetWins()
  await statementsClose()
  basisRules()
  await boundaries()
  standardChart()
  await provisionalGap()
  await books()
  console.log('PASS: sheet 480 cells = ledger, statements close, basis rules, ECOUNT mapping/config boundaries, standard chart, provisional→confirmed gap, dummy books')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
