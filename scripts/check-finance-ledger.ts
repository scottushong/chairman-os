/**
 * Phase 2-A 재무 원장 검증 (오프라인, DB 없음): npm run check:finance
 *
 * 무엇을 재나
 *   1) 시트가 이긴다 — mock 원장을 lib/ledger 공식으로 접으면 06_Dummy_Data 480칸이 원 단위까지 같다.
 *      VANA 2026-08 EBITDA = 2.8억, 꼬리표는 잠정(마감 전).
 *   2) 재무제표가 닫힌다 — 모든 회사·그룹·달에서 자산 = 부채 + 자본, 기초 현금 + 현금 증감 = 기말 현금.
 *   3) 꼬리표 규칙 — (source, closed) → 확정/잠정/수기/추정, 합은 가장 약한 쪽.
 *   4) 경계 — ECOUNT 표기 변환(업로드가 지날 길), 분류 없는 계정은 멈춤.
 *   5) 잠정-확정 차이가 결산조정 계정에서 나온다.
 *
 * 0015의 SQL 뷰(finance_kpis)가 같은 공식을 쓰는지는 이 스크립트가 못 잰다(DB가 없다).
 * 그건 OPERATIONS의 D-17 로컬 검증 또는 PGlite로 0001~0015를 올려 같은 480칸을 비교한다.
 */
import assert from 'node:assert/strict'

import { sheetFinanceKpis } from '../src/data'
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
import { DUMMY_UID, dummyCanWriteDocuments, dummyModuleGrants, dummyPerson, setDummyModuleGrant } from '../src/lib/repository/dummy-org'
import { canWriteAnyDocuments, canWriteDocuments } from '../src/lib/auth/roles'
import { documentsByBusiness, hasLegacyDocumentWrite } from '../src/lib/module-grants'
import { STAFF_ADMIN_ERROR, staffAdminMessage } from '../src/lib/staff-admin-errors'
import type { SessionUser } from '../src/types'

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

  // 블록 4 — 정정 전표. 마감된 8월 전표를 9월에 1,000,000 → 1,200,000으로 고친다.
  const fix = (entry_date: string, lines: ReturnType<typeof sale>['lines']) => ({
    business_id: 'biz_vana', corrects_id: slip, entry_date, memo: '[정정] 금액', evidence_url: null, lines,
  })
  await assert.rejects(repo.postCorrection(fix('2026-08-25', sale('x', [1, 1]).lines), actor), /closed_period/, '정정은 열린 달에')
  await assert.rejects(repo.postCorrection(fix('2026-08-19', sale('x', [1, 1]).lines), actor), /closed_period|correction_before_original/)
  const result = await repo.postCorrection(fix('2026-09-05', sale('x', [1_200_000, 1_200_000]).lines), actor)
  assert.ok(result.reversal && result.restatement)
  const corrected = await repo.loadFinanceLedger()
  const reversal = corrected.journal.filter((j) => j.slip_no === result.reversal)
  assert.deepEqual(reversal.map((j) => [j.account_code, j.side, j.amount]), [['1030', 'credit', 1_000_000], ['4010', 'debit', 1_000_000]], '역분개는 차대를 뒤집는다')
  const sep = (await repo.listFinanceKpis()).find((k) => k.business_id === 'biz_vana' && k.period === '2026-09' && k.metric === 'Revenue')!
  assert.equal(sep.value, 200_000, '9월 매출 = 정정분개 − 역분개')
  assert.equal(sep.basis, 'provisional')
  const augAfter = (await repo.listFinanceKpis()).filter((k) => k.business_id === 'biz_vana' && k.period === '2026-08')
  assert.deepEqual(augAfter.map((k) => [k.metric, k.value, k.basis]), kpisAfter.map((k) => [k.metric, k.value, k.basis]), '마감된 8월은 그대로')
  await assert.rejects(repo.postCorrection(fix('2026-09-06', sale('x', [1, 1]).lines), actor), /already_corrected/)
  await assert.rejects(
    repo.postCorrection({ ...fix('2026-09-06', []), corrects_id: result.reversal }, actor),
    /cannot_correct_reversal/,
  )
}

/**
 * 0047 — dummy가 재무 권한을 흉내 내는가. 첫 실사용자(DY 경영지원 팀장, DUMMY_USER=support_lead)의 화면이
 * dummy에서 live와 같게 보여야 한다: 회사는 DY 하나 · 원장도 DY만 · 전표/공식 재무제표는 DY만 · 마감은 안 된다.
 * 줄 없는 팀장(sales_lead)은 원장이 비고 전표가 거부된다.
 */
async function financeGrantsDummy() {
  const repo = dummyRepository
  const prev = process.env.DUMMY_USER
  try {
    process.env.DUMMY_USER = 'support_lead'
    const actor = { user_id: 'support', role: 'TeamLead' }
    assert.deepEqual((await repo.listBusinesses()).map((b) => b.business_id), ['biz_dy'], '0047 dummy: 경영지원 팀장에게 DY 말고 다른 회사가 보인다')
    const ledger = await repo.loadFinanceLedger()
    assert.ok(ledger.journal.length > 0, '0047 dummy: 경영지원 팀장이 DY 원장을 못 본다')
    assert.deepEqual([...new Set([...ledger.accounts, ...ledger.journal, ...ledger.closings].map((r) => r.business_id))], ['biz_dy'],
      '0047 dummy: 원장에 다른 회사 줄이 섞인다')
    const dySale = (business_id: string) => ({
      business_id, entry_date: '2026-09-10', memo: '0047 검증', evidence_url: null,
      lines: [
        { account_code: '1010', side: 'debit' as const, amount: 1000 },
        { account_code: '4010', side: 'credit' as const, amount: 1000 },
      ],
    })
    assert.match(await repo.postJournalEntry(dySale('biz_dy'), actor), /^M2609-\d{6}$/, '0047 dummy: 경영지원 팀장이 DY 전표를 못 넣는다')
    await assert.rejects(repo.postJournalEntry(dySale('biz_vana'), actor), /row-level security/, '0047 dummy: 다른 회사 전표가 들어간다')
    const id = await repo.saveOfficialStatement(
      { business_id: 'biz_dy', period_kind: 'year', period_key: '2025', evidence_url: 'https://drive.example/a', memo: '0047', lines: [{ account_code: '4010', amount: -5000 }] },
      actor,
    )
    assert.ok(id > 0, '0047 dummy: 경영지원 팀장이 공식 재무제표를 못 넣는다')
    assert.equal((await repo.listOfficialStatements('biz_dy')).length, 1)
    await assert.rejects(repo.closePeriod('biz_dy', '2026-08', actor), /close_forbidden/, '0047 dummy: 입력 권한만으로 마감한다')

    // I1 — 회사 접근(VANA)을 더해도 VANA 줄이 없으면 닫혀 있다. 회장이 VANA 줄을 켜면 그때 열린다.
    const me = dummyPerson(DUMMY_UID.supportLead)!
    me.business_ids.push('biz_vana')
    try {
      assert.ok((await repo.listBusinesses()).some((b) => b.business_id === 'biz_vana'), '0047 dummy 전제: VANA 접근이 붙었다')
      assert.equal((await repo.loadFinanceLedger()).journal.filter((j) => j.business_id === 'biz_vana').length, 0,
        '0047 dummy: VANA 접근만으로 VANA 원장이 열린다')
      await assert.rejects(repo.postJournalEntry(dySale('biz_vana'), actor), /row-level security/, '0047 dummy: VANA 접근만으로 VANA 전표가 들어간다')
      await assert.rejects(repo.setModuleGrant(DUMMY_UID.supportLead, { module: '/finance/biz_vana', can_write: true, can_approve: false }, actor),
        /row-level security/, '0047 dummy: 회장 아닌 사람이 모듈 권한을 준다')
      await repo.setModuleGrant(DUMMY_UID.supportLead, { module: '/finance/biz_vana', can_write: false, can_approve: false }, { user_id: 'chair', role: 'Chairman' })
      await repo.setModuleGrant(DUMMY_UID.supportLead, { module: '/finance/biz_vana', can_write: true, can_approve: false }, { user_id: 'chair', role: 'Chairman' })
      assert.ok((await repo.loadFinanceLedger()).journal.some((j) => j.business_id === 'biz_vana'), '0047 dummy: VANA 줄을 켰는데 VANA 원장이 안 열린다')
      await repo.setModuleGrant(DUMMY_UID.supportLead, { module: '/finance/biz_vana', can_write: false, can_approve: false }, { user_id: 'chair', role: 'Chairman' })
    } finally {
      me.business_ids.splice(me.business_ids.indexOf('biz_vana'), 1)
    }

    process.env.DUMMY_USER = 'sales_lead'
    assert.equal((await repo.loadFinanceLedger()).journal.length, 0, '0047 dummy: 줄 없는 팀장에게 원장이 보인다')
    assert.equal((await repo.listOfficialStatements('biz_dy')).length, 0, '0047 dummy: 줄 없는 팀장에게 공식 재무제표가 보인다')
    await assert.rejects(repo.postJournalEntry(dySale('biz_dy'), { user_id: 'sales', role: 'TeamLead' }), /row-level security/,
      '0047 dummy: 줄 없는 팀장이 전표를 넣는다')

    // C1 — 회장이 아닌 사람이 경영지원으로 옮기면 기본 권한이 안 붙고, 회장이 옮기면 붙는다. I2 — 떠나면 기본값 줄만 지운다.
    const finance = (uid: string) => dummyModuleGrants(uid).filter((m) => m.module === '/finance/biz_dy')
    await repo.updateUserProfile(DUMMY_UID.buyLead, { team_id: 'team_dy_support' }, { user_id: 'exec', role: 'Executive' })
    assert.equal(finance(DUMMY_UID.buyLead).length, 0, '0047 dummy: 회장 아닌 이동이 기본 재무 권한을 붙인다')
    await repo.updateUserProfile(DUMMY_UID.buyLead, { team_id: 'team_dy_purchasing' }, { user_id: 'chair', role: 'Chairman' })
    await repo.updateUserProfile(DUMMY_UID.buyLead, { team_id: 'team_dy_support' }, { user_id: 'chair', role: 'Chairman' })
    assert.equal(finance(DUMMY_UID.buyLead).length, 1, '0047 dummy: 회장이 경영지원으로 옮겼는데 기본 권한이 없다')
    await repo.updateUserProfile(DUMMY_UID.buyLead, { team_id: 'team_dy_purchasing' }, { user_id: 'chair', role: 'Chairman' })
    assert.equal(finance(DUMMY_UID.buyLead).length, 0, '0047 dummy: 경영지원을 떠났는데 기본 권한이 남는다')

    // I2 — 회수하면 줄이 전부 지워진다(재초대가 옛 권한을 살리지 못하게).
    await repo.revokeUser({ kind: 'account', user_id: DUMMY_UID.supportLead }, { user_id: 'chair', role: 'Chairman' })
    assert.equal(dummyModuleGrants(DUMMY_UID.supportLead).length, 0, '0047 dummy: 회수했는데 모듈 줄이 남는다')
  } finally {
    if (prev === undefined) delete process.env.DUMMY_USER
    else process.env.DUMMY_USER = prev
  }
}

/**
 * 0048 — dummy가 문서 등록 권한을 흉내 내는가(documents_insert · doc_folders_insert = can_write_documents + 등급).
 * 경영지원 팀장(DY 문서 줄): DY 문서 · 폴더 O, VANA · 그룹 공통 X, 등급 위(Restricted · Vault) X.
 * 줄 없는 팀장(sales_lead): 전부 X. 세션 안내(roles.ts canWriteDocuments)도 같은 답을 낸다.
 */
async function documentGrantsDummy() {
  const repo = dummyRepository
  const prev = process.env.DUMMY_USER
  const chair = { user_id: 'chair', role: 'Chairman' }
  const doc = (business_id: string, security_class: 'Normal' | 'Restricted' | 'Vault' = 'Normal') => ({
    title: '0048 검증', business_id, doc_type: 'Contract', security_class, storage_url: 'https://drive.example/48', folder_id: null, tags: [],
  })
  const session = (uid: string, role: SessionUser['role']): SessionUser => {
    const grants = dummyModuleGrants(uid)
    return { user_id: uid, name: '', role, title_ko: '', display_name_en: null, language: 'ko', finance: {},
      documents: documentsByBusiness(grants), documents_legacy_write: hasLegacyDocumentWrite(grants) }
  }
  try {
    process.env.DUMMY_USER = 'support_lead'
    const actor = { user_id: 'support', role: 'TeamLead' }
    const lead = session(DUMMY_UID.supportLead, 'TeamLead')
    assert.equal(canWriteDocuments(lead, 'biz_dy'), true, '0048 안내: 경영지원 팀장에게 DY 등록이 안 열린다')
    assert.equal(canWriteDocuments(lead, 'biz_vana'), false, '0048 안내: 경영지원 팀장에게 VANA 등록이 열린다')
    assert.equal(canWriteDocuments(lead, 'group'), false, '0048 안내: 경영지원 팀장에게 그룹 공통 등록이 열린다')
    assert.ok((await repo.createDocument(doc('biz_dy'), actor)).document_id, '0048 dummy: 경영지원 팀장이 DY 문서를 못 넣는다')
    await assert.rejects(repo.createDocument(doc('biz_dy', 'Vault'), actor), /row-level security/, '0048 dummy: Normal 팀장이 Vault 문서를 넣는다')
    await assert.rejects(repo.createDocument(doc('biz_dy', 'Restricted'), actor), /row-level security/, '0048 dummy: Normal 팀장이 Restricted 문서를 넣는다')
    await assert.rejects(repo.createDocument(doc('biz_vana'), actor), /row-level security/, '0048 dummy: DY 줄로 VANA 문서가 들어간다')
    await assert.rejects(repo.createDocument(doc('group'), actor), /row-level security/, '0048 dummy: 팀장이 그룹 공통 문서를 넣는다')
    assert.ok((await repo.saveDocFolder({ business_id: 'biz_dy', team_id: null, parent_id: null, name: '0048 폴더' }, actor)) > 0,
      '0048 dummy: 경영지원 팀장이 DY 폴더를 못 만든다')

    // 회사 접근(VANA)만 더해도 VANA 줄이 없으면 닫혀 있다. 회장이 켜면 열린다.
    const me = dummyPerson(DUMMY_UID.supportLead)!
    me.business_ids.push('biz_vana')
    try {
      await assert.rejects(repo.createDocument(doc('biz_vana'), actor), /row-level security/, '0048 dummy: VANA 접근만으로 VANA 문서가 들어간다')
      await repo.setModuleGrant(DUMMY_UID.supportLead, { module: '/documents/biz_vana', can_write: true, can_approve: false }, chair)
      assert.ok((await repo.createDocument(doc('biz_vana'), actor)).document_id, '0048 dummy: VANA 줄을 켰는데 VANA 문서가 안 들어간다')
      assert.equal(canWriteDocuments(session(DUMMY_UID.supportLead, 'TeamLead'), 'biz_vana'), true, '0048 안내: 켠 VANA 줄이 세션에 안 붙는다')
      await repo.setModuleGrant(DUMMY_UID.supportLead, { module: '/documents/biz_vana', can_write: false, can_approve: false }, chair)
      assert.equal(dummyModuleGrants(DUMMY_UID.supportLead).some((m) => m.module === '/documents/biz_vana'), false, '0048 dummy: 끈 문서 줄이 남는다')
    } finally {
      me.business_ids.splice(me.business_ids.indexOf('biz_vana'), 1)
    }

    process.env.DUMMY_USER = 'sales_lead'
    const sales = session(DUMMY_UID.salesLead, 'TeamLead')
    assert.equal(canWriteAnyDocuments(sales), false, '0048 안내: 줄 없는 팀장에게 «링크 등록»이 그려진다')
    await assert.rejects(repo.createDocument(doc('biz_dy'), { user_id: 'sales', role: 'TeamLead' }), /row-level security/, '0048 dummy: 줄 없는 팀장이 문서를 넣는다')
    await assert.rejects(repo.saveDocFolder({ business_id: 'biz_dy', team_id: null, parent_id: null, name: '0048 x' }, { user_id: 'sales', role: 'TeamLead' }),
      /row-level security/, '0048 dummy: 줄 없는 팀장이 폴더를 만든다')
    // 옛 전역 줄('/core/search')은 그대로 연다(회귀) — 회사 범위 안에서만.
    setDummyModuleGrant(DUMMY_UID.salesLead, { module: '/core/search', can_write: true, can_approve: false })
    try {
      assert.equal(canWriteDocuments(session(DUMMY_UID.salesLead, 'TeamLead'), 'biz_dy'), true, '0048 안내: 옛 /core/search 줄이 줄어들었다')
      assert.ok((await repo.createDocument(doc('biz_dy'), { user_id: 'sales', role: 'TeamLead' })).document_id, '0048 dummy: 옛 /core/search 줄로 문서가 안 들어간다')
      await assert.rejects(repo.createDocument(doc('biz_vana'), { user_id: 'sales', role: 'TeamLead' }), /row-level security/, '0048 dummy: 옛 줄이 회사 범위를 넘는다')
    } finally {
      setDummyModuleGrant(DUMMY_UID.salesLead, { module: '/core/search', can_write: false, can_approve: false })
    }

    // 시스템 계정은 줄이 있어도 안내도 dummy 판정도 false(리뷰 M1 — 옛 '/core/search' 줄이어도).
    assert.equal(canWriteDocuments({ ...lead, role: 'AIAgent' }, 'biz_dy'), false, '0048 안내: 문서 줄 있는 AIAgent에게 등록이 열린다')
    assert.equal(canWriteDocuments({ ...lead, role: 'AIAgent', documents_legacy_write: true }, 'biz_dy'), false, '0048 안내: 옛 줄 있는 AIAgent에게 등록이 열린다')
    const agent = dummyPerson(DUMMY_UID.aiAgent)!
    setDummyModuleGrant(agent.user_id, { module: '/core/search', can_write: true, can_approve: false })
    setDummyModuleGrant(agent.user_id, { module: '/documents/biz_dy', can_write: true, can_approve: false })
    try {
      assert.equal(dummyCanWriteDocuments(agent, 'biz_dy'), false, '0048 dummy: 옛 줄 · 문서 줄 있는 AIAgent가 문서를 쓴다')
    } finally {
      setDummyModuleGrant(agent.user_id, { module: '/core/search', can_write: false, can_approve: false })
      setDummyModuleGrant(agent.user_id, { module: '/documents/biz_dy', can_write: false, can_approve: false })
    }
    // 회장은 역할로.
    process.env.DUMMY_USER = 'chairman'
    assert.ok((await repo.createDocument(doc('group', 'Vault'), chair)).document_id, '0048 dummy: 회장이 그룹 공통 Vault 링크를 못 넣는다')
  } finally {
    if (prev === undefined) delete process.env.DUMMY_USER
    else process.env.DUMMY_USER = prev
  }
}

/**
 * 0055 — dummy가 «DY 사용자 관리자»(위임 초대)를 흉내 내는가. 시드의 경영지원 팀장(DUMMY_USER=support_lead)이 회장이 켠
 * '/users/biz_dy'를 가진 상태로 시작한다. DB(0055 staff_admin_invite)와 같은 오류 키 · 같은 범위여야 한다.
 */
async function staffAdminDummy() {
  const repo = dummyRepository
  const prev = process.env.DUMMY_USER
  const base = {
    business_id: 'biz_dy', display_name: '위임 신입', display_name_en: null, title_ko: null, role: 'Member' as const,
    team_id: 'team_dy_rnd', reports_to: DUMMY_UID.chair as string, max_security_class: 'Normal' as const, module_grants: [] as string[],
    joined_on: null, language: 'ko' as const,
  }
  try {
    process.env.DUMMY_USER = 'support_lead'
    assert.deepEqual(await repo.staffAdminBusinesses(), ['biz_dy'], '0055 dummy: 경영지원 팀장이 DY 사용자 관리자가 아니다')
    const o = await repo.staffAdminOptions('biz_dy')
    assert.deepEqual(o.grantable, ['/documents/biz_dy', '/finance/biz_dy'], '0055 dummy: 줄 수 있는 권한이 관리자 권한과 다르다')
    const ids = o.people.map((p) => p.user_id)
    assert.ok(ids.includes(DUMMY_UID.chair) && !ids.includes(DUMMY_UID.supportLead), '0055 dummy: 상사 후보에 대표가 없거나 관리자 본인이 있다')
    assert.ok(o.teams.every((t) => t.team_id.startsWith('team_dy_')), '0055 dummy: 팀 후보에 DY 밖 팀이 있다')

    // 경영지원 팀장은 자기 팀(경영지원)이 후보에 없다(리뷰 I2).
    assert.ok(!o.teams.some((t) => t.team_id === 'team_dy_support'), '0055 dummy: 팀장 관리자의 팀 후보에 자기 팀이 있다')
    // «결재 올리기»는 와도 버린다(리뷰 I4).
    const ok = await repo.staffAdminInvite({ ...base, email: 'dummy55@example.com', module_grants: ['/finance/biz_dy', '/chairman/decisions'] })
    assert.deepEqual(ok.module_grants, ['/finance/biz_dy'], '0055 dummy: 결재 올리기가 위임 권한으로 실렸다')
    assert.equal(ok.staff_admin_business, 'biz_dy', '0055 dummy: 위임 꼬리표가 없다')
    assert.deepEqual([ok.chairman_approval_required, ok.chairman_approved_at], [false, null], '0055 dummy: 사원 위임 초대가 결재 큐로 갔다')
    const refuse: [Partial<typeof base>, RegExp, string][] = [
      [{ role: 'Executive' as never }, /staff_admin_role/, 'Executive'],
      [{ team_id: 'team_dy_support' }, /staff_admin_team_self/, '자기가 팀장인 팀'],
      [{ email: 'dummy55@example.com' } as never, /staff_admin_email_taken/, '대기 초대 이메일'],
      [{ display_name: 'ㄱ'.repeat(61) }, /staff_admin_name/, '61자 이름'],
      [{ module_grants: ['/finance/biz_vana'] }, /staff_admin_grant/, '다른 회사 재무'],
      [{ reports_to: '' }, /staff_admin_boss_missing/, '상사 없음'],
      [{ reports_to: DUMMY_UID.supportLead }, /staff_admin_boss_self/, '본인 상사'],
      [{ team_id: '' }, /staff_admin_team/, '팀 없음'],
      [{ max_security_class: 'Restricted' as never }, /staff_admin_class/, '높은 등급'],
      [{ business_id: 'biz_vana' }, /staff_admin_denied/, '다른 회사'],
    ]
    for (const [patch, re, why] of refuse) {
      await assert.rejects(repo.staffAdminInvite({ ...base, email: `dummy55x${why.length}@example.com`, ...patch } as never), re, `0055 dummy: ${why}가 거부되지 않는다`)
      // 리뷰 I6 — 액션의 문장 바꾸기: 키마다 제 문장(긴 키가 짧은 키에 먹히지 않는다).
      const key = re.source
      assert.equal(staffAdminMessage(new Error(`Supabase staff_admin_invite 42501: ${key}`)), STAFF_ADMIN_ERROR[key], `0055: ${key}의 화면 문장이 다르다`)
    }
    assert.deepEqual((await repo.listNotifications(50)).items.filter((n) => n.title.includes('위임 신입')), [], '0055 dummy: 관리자에게 대표 알림이 보인다')
    process.env.DUMMY_USER = 'chairman'
    const notes = (await repo.listNotifications(50)).items.filter((n) => n.title.includes('위임 신입'))
    assert.equal(notes.length, 1, '0055 dummy: 대표 알림이 없다')
    assert.ok(!notes[0].title.includes('회장') && notes[0].link === '/settings/users', '0055 dummy: 알림 문구 · 링크가 다르다')
    await assert.rejects(repo.staffAdminInvite({ ...base, email: 'dummy55c@example.com' }), /staff_admin_denied/, '0055 dummy: 회장이 위임 길을 쓴다')
    // 리뷰 I3 — 회장 아닌 직접 초대(0026 위임 insert)는 닫혔다.
    process.env.DUMMY_USER = 'sales_lead'
    await assert.rejects(repo.inviteUser({ email: 'dummy26@example.com', role: 'Member', max_security_class: 'Normal', business_ids: ['biz_dy'],
      display_name: 'x', display_name_en: null, title_ko: '', reports_to: DUMMY_UID.salesLead, team_id: 'team_dy_sales', joined_on: null, language: 'ko' },
      { user_id: DUMMY_UID.salesLead, role: 'TeamLead' }), /row-level security/, '0055 dummy: 팀장이 0026 길로 직접 초대한다')
    process.env.DUMMY_USER = 'sales_staff'
    assert.deepEqual(await repo.staffAdminBusinesses(), [], '0055 dummy: 능력 없는 직원이 관리자다')
    await assert.rejects(repo.staffAdminRevoke(ok.invitation_id), /staff_admin_not_found/, '0055 dummy: 남의 위임 초대를 취소한다')
    process.env.DUMMY_USER = 'support_lead'
    await repo.staffAdminRevoke(ok.invitation_id)
    assert.ok((await repo.listUserInvitations()).find((i) => i.invitation_id === ok.invitation_id)?.revoked_at, '0055 dummy: 관리자 취소가 안 됐다')
    // 능력 회수(회장) → 더는 초대 못 함.
    const pend = await repo.staffAdminInvite({ ...base, email: 'dummy55p@example.com' })
    await repo.setModuleGrant(DUMMY_UID.supportLead, { module: '/users/biz_dy', can_write: false, can_approve: false }, { user_id: 'chair', role: 'Chairman' })
    await assert.rejects(repo.staffAdminInvite({ ...base, email: 'dummy55r@example.com' }), /staff_admin_denied/, '0055 dummy: 능력 회수 뒤에도 초대된다')
    assert.ok((await repo.listUserInvitations()).find((i) => i.invitation_id === pend.invitation_id)?.revoked_at,
      '0055 dummy: 능력 회수가 대기 위임 초대를 자동 취소하지 않는다(리뷰 I5)')
    await repo.setModuleGrant(DUMMY_UID.supportLead, { module: '/users/biz_dy', can_write: true, can_approve: false }, { user_id: 'chair', role: 'Chairman' })
    // I6 — 낱말 경계: 모르는 키 · 비슷한 이름은 일반 문장으로.
    assert.equal(staffAdminMessage(new Error('x staff_admin_team_selfish y')), '저장하지 못했습니다. 잠시 후 다시 시도하세요.', '0055: 키 경계가 무너졌다')
    assert.equal(staffAdminMessage(new Error('ERROR: staff_admin_team')), STAFF_ADMIN_ERROR.staff_admin_team, '0055: 짧은 키의 문장이 다르다')
    assert.ok(Object.values(STAFF_ADMIN_ERROR).every((m) => !m.includes('회장')), '0055: 관리자 오류 문장에 «회장»이 있다')
  } finally {
    if (prev === undefined) delete process.env.DUMMY_USER
    else process.env.DUMMY_USER = prev
  }
}

async function main() {
  await sheetWins()
  await statementsClose()
  basisRules()
  await boundaries()
  standardChart()
  await provisionalGap()
  await books()
  await staffAdminDummy()
  // 0048을 먼저 — financeGrantsDummy가 마지막에 경영지원 팀장을 회수해 모듈 줄을 전부 지운다.
  await documentGrantsDummy()
  await financeGrantsDummy()
  console.log('PASS: sheet 480 cells = ledger, statements close, basis rules, ECOUNT mapping boundaries, standard chart, provisional→confirmed gap, dummy books, 0047 dummy finance grants, 0048 dummy document grants, 0055 dummy staff admin')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
