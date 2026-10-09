/**
 * 0059 결재 대장의 순수 판정 검증 (브라우저 · DB 없음): npm run check:approval-ledger
 *
 * 무엇을 재나
 *   1) KST 날짜 — UTC 15:00 이후는 서울 다음 날. 일요일은 앞 월요일의 주.
 *   2) 기간 묶음 — 주 · 월 · 분기 · 연 합이 일 합을 위로 더한 값과 같다(어느 단위로 봐도 전체 합이 같다).
 *   3) 거르기 — 회사 · 양식 · 기간 · 상태(기록 완료 포함) · 사람 · 팀 · 구입처(store · 구입처 키 포함) · 금액 · 찾기.
 *      URL 값은 좁히기만 한다(모르는 값은 버려지고, 들어온 줄 밖의 줄이 생기지 않는다).
 *   4) 정렬 — 빈 값은 늘 뒤, 방향 뒤집기.
 *   5) 합계 — 건수 · 금액 · 양식 · 구입처 · 팀 묶음.
 *   6) 직원 화면 용어 — 단계 결재자 · 이유의 «회장»이 직원에게는 «대표».
 *   7) 엑셀 — 세 장 이름, 금액 숫자 칸('#,##0'), 날짜 칸(Date), 양식 항목 칸, 결재선 이력, 파일 이름 · Content-Disposition.
 */
import assert from 'node:assert/strict'

import ExcelJS from 'exceljs'

import {
  auditFilters,
  buildLedgerRows,
  canExportLedger,
  LEDGER_AUDIT_MAX,
  dayBuckets,
  filterLedger,
  isPeriodKey,
  kstDay,
  ledgerFileName,
  ledgerHistory,
  ledgerParams,
  ledgerTotals,
  parseLedgerFilters,
  periodKey,
  periodRange,
  rollUp,
  safeUrl,
  shiftPeriod,
  sortLedger,
  weekStart,
  type LedgerRow,
} from '../src/lib/approval-ledger'
import { buildLedgerWorkbook, contentDisposition, DATE_FMT, MONEY_FMT } from '../src/lib/approval-ledger-xlsx'
import type { ApprovalStepState, ApprovalTemplate, Decision } from '../src/types'

/* ------------------------------------------------------------------ 시드 */

const TEMPLATES: ApprovalTemplate[] = [
  {
    template_key: 'purchase', name_ko: '구매', name_en: 'Purchase', attachment_required: false,
    chairman_always: false, chairman_over: 5_000_000, sort_order: 20,
    fields: [
      { key: 'item', label_ko: '품목', label_en: 'Item', type: 'text', required: true },
      { key: 'vendor', label_ko: '구입처', label_en: 'Where bought', type: 'text', required: true },
      { key: 'amount', label_ko: '금액(원)', label_en: 'Amount', type: 'money', required: true },
      { key: 'link', label_ko: '링크', label_en: 'Link', type: 'url', required: false },
    ],
  },
  {
    template_key: 'expense', name_ko: '지출', name_en: 'Expense', attachment_required: false,
    chairman_always: false, chairman_over: 5_000_000, sort_order: 10,
    fields: [
      { key: 'amount', label_ko: '금액(원)', label_en: 'Amount', type: 'money', required: true },
      { key: 'purpose', label_ko: '지출 목적', label_en: 'Purpose', type: 'textarea', required: true },
      { key: 'link', label_ko: '링크', label_en: 'Link', type: 'url', required: false },
    ],
  },
  {
    template_key: 'leave', name_ko: '휴가', name_en: 'Leave', attachment_required: false,
    chairman_always: false, chairman_over: null, sort_order: 30,
    fields: [{ key: 'reason', label_ko: '사유', label_en: 'Reason', type: 'textarea', required: false }],
  },
]

const base = (id: string, over: Partial<Decision>): Decision => ({
  decision_id: id,
  business_id: 'biz_dy',
  title: `결재 ${id}`,
  options: [],
  ai_recommendation: '',
  impact: 'Medium',
  deadline: '2026-10-31',
  status: 'Open',
  ...over,
})

const DECISIONS: Decision[] = [
  // 2026-10-04(일) 23:30 KST = 14:30Z. 주는 2026-09-28(월) 시작.
  base('dec_001', {
    template_key: 'purchase', created_at: '2026-10-04T14:30:00Z', requester_name: '김구매', requester_team_name: '구매팀',
    form: { item: '노트북', vendor: '쿠팡', amount: '6,000,000', link: 'https://example.com/a' },
    status: 'Approved', decided_by_kind: 'chairman', decided_at: '2026-10-05T01:00:00Z',
  }),
  // 2026-09-30T15:10Z = 2026-10-01(목) 00:10 KST — 10월로 든다.
  base('dec_002', {
    template_key: 'expense', created_at: '2026-09-30T15:10:00Z', requester_name: '이지출', requester_team_name: '영업팀',
    form: { amount: '120000원', purpose: '회식', store: '한우집', link: 'javascript:alert(1)' },
    status: 'Approved', decided_by_kind: 'rule', decided_at: '2026-10-01T00:00:00Z',
  }),
  // 2026-09-30T14:59Z = 2026-09-30 23:59 KST — 9월.
  base('dec_003', {
    business_id: 'biz_vana', template_key: 'purchase', created_at: '2026-09-30T14:59:00Z', requester_name: '박바나', requester_team_name: '개발팀',
    form: { item: '모니터', 구입처: '다나와', amount: '450000' },
    status: 'Rejected', decided_at: '2026-10-02T03:00:00Z', step_chain: true,
  }),
  // 열린 단계 결재 — 지금 차례는 회장(직원에게는 대표).
  base('dec_004', {
    template_key: 'purchase', created_at: '2026-12-31T16:00:00Z', requester_name: '김구매', requester_team_name: '구매팀',
    form: { item: '서버', vendor: '쿠팡', amount: '9000000' }, step_chain: true,
  }),
  // 금액 없는 휴가 · 0059 전 결재(단계 줄 없음, approval_line만).
  base('dec_005', {
    template_key: 'leave', created_at: '2026-10-07T00:00:00Z', created_by: 'user_x', requester_name: null,
    form: { reason: '가족 행사' }, status: 'Approved', decided_by_kind: 'ceo', decided_at: '2026-10-07T05:00:00Z',
    approval_line: [{ step: 'lead', user_id: 'u1', name: '최팀장', why: '팀장' }, { step: 'chairman', user_id: 'u0', name: '회장', why: '회장 확인' }],
  }),
  // 양식 아닌 결재는 대장에 들지 않는다.
  base('dec_006', { created_at: '2026-10-05T00:00:00Z' }),
]

const STEPS: ApprovalStepState[] = [
  { decision_id: 'dec_003', seq: 1, approver_user_id: 'u1', approver_name: '최팀장', why: '직속 상사', is_chairman: false, status: 'rejected', decided_at: '2026-10-02T03:00:00Z', decided_by: 'u1', note: '견적 다시' },
  { decision_id: 'dec_003', seq: 2, approver_user_id: 'u0', approver_name: '회장', why: '회장 결재', is_chairman: true, status: 'cancelled', decided_at: null, decided_by: null, note: null },
  { decision_id: 'dec_004', seq: 1, approver_user_id: 'u1', approver_name: '최팀장', why: '직속 상사', is_chairman: false, status: 'approved', decided_at: '2027-01-01T01:00:00Z', decided_by: 'u1', note: null },
  { decision_id: 'dec_004', seq: 2, approver_user_id: 'u0', approver_name: '회장', why: '대표 결재', is_chairman: true, status: 'pending', decided_at: null, decided_by: null, note: null },
]

const staffRows = buildLedgerRows(DECISIONS, STEPS, TEMPLATES, 'Member')
const chairRows = buildLedgerRows(DECISIONS, STEPS, TEMPLATES, 'Chairman')
const row = (rows: LedgerRow[], id: string) => rows.find((r) => r.id === id)!
const ids = (rows: LedgerRow[]) => rows.map((r) => r.id).sort()
const f = (p: Record<string, string>) => parseLedgerFilters(p)

/* ------------------------------------------------------------------ 1) 날짜 */

function dates() {
  assert.equal(kstDay('2026-09-30T14:59:00Z'), '2026-09-30')
  assert.equal(kstDay('2026-09-30T15:00:00Z'), '2026-10-01')
  assert.equal(kstDay('2026-09-30T23:10:00+09:00'), '2026-09-30')
  assert.equal(kstDay(null), '')
  assert.equal(kstDay('엉터리'), '')
  // 2026-10-04는 일요일 → 그 주는 2026-09-28(월).
  assert.equal(weekStart('2026-10-04'), '2026-09-28')
  assert.equal(weekStart('2026-10-05'), '2026-10-05') // 월요일은 자기 자신
  assert.equal(weekStart('2026-10-11'), '2026-10-05')
  assert.equal(weekStart('2027-01-03'), '2026-12-28') // 연 경계
  assert.equal(periodKey('2026-11-15', 'quarter'), '2026-Q4')
  assert.equal(periodKey('2026-03-31', 'quarter'), '2026-Q1')
  assert.deepEqual(periodRange('2026-02', 'month'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(periodRange('2028-02', 'month'), { from: '2028-02-01', to: '2028-02-29' })
  assert.deepEqual(periodRange('2026-Q4', 'quarter'), { from: '2026-10-01', to: '2026-12-31' })
  assert.deepEqual(periodRange('2026-09-28', 'week'), { from: '2026-09-28', to: '2026-10-04' })
  assert.equal(shiftPeriod('2026-Q1', 'quarter', -1), '2025-Q4')
  assert.equal(shiftPeriod('2026-12', 'month', 1), '2027-01')
  assert.equal(shiftPeriod('2026-09-28', 'week', 1), '2026-10-05')
  assert.ok(isPeriodKey('2026-10-05', 'week'))
  assert.ok(!isPeriodKey('2026-10-06', 'week')) // 화요일은 주 키가 아니다
  assert.ok(!isPeriodKey('2026-13', 'month'))
  assert.ok(!isPeriodKey('2026-02-30', 'day'))
}

/* ------------------------------------------------------------------ 2) 기간 묶음 */

function rollups() {
  assert.equal(row(staffRows, 'dec_001').day, '2026-10-04')
  assert.equal(row(staffRows, 'dec_002').day, '2026-10-01')
  assert.equal(row(staffRows, 'dec_004').day, '2027-01-01')

  const days = dayBuckets(staffRows)
  const total = (m: Map<string, { count: number; sum: number }>) =>
    [...m.values()].reduce((a, b) => ({ count: a.count + b.count, sum: a.sum + b.sum }), { count: 0, sum: 0 })
  const all = total(days)
  for (const g of ['day', 'week', 'month', 'quarter', 'year'] as const) {
    assert.deepEqual(total(rollUp(days, g)), all, `${g} 합이 일 합과 다르다`)
  }
  // 분기 = 그 분기 월들의 합, 연 = 분기들의 합.
  const months = rollUp(days, 'month')
  const quarters = rollUp(days, 'quarter')
  const years = rollUp(days, 'year')
  const q4 = ['2026-10', '2026-11', '2026-12'].reduce((s, k) => s + (months.get(k)?.sum ?? 0), 0)
  assert.equal(quarters.get('2026-Q4')?.sum, q4)
  assert.equal(years.get('2026')?.sum, (quarters.get('2026-Q3')?.sum ?? 0) + q4)
  assert.equal(months.get('2026-09')?.sum, 450_000)
  assert.equal(months.get('2026-10')?.sum, 6_000_000 + 120_000)
  assert.equal(months.get('2026-10')?.count, 3) // 휴가(금액 없음)도 건수에 든다
  // 일요일 결재는 앞 월요일 주.
  const weeks = rollUp(days, 'week')
  assert.equal(weeks.get('2026-09-28')?.count, 3) // 09-30 · 10-01 · 10-04(일)
  assert.equal(weeks.get('2026-10-05')?.count, 1) // 10-07
  assert.equal(years.get('2027')?.sum, 9_000_000)
}

/* ------------------------------------------------------------------ 3) 거르기 */

function filters() {
  assert.deepEqual(ids(staffRows), ['dec_001', 'dec_002', 'dec_003', 'dec_004', 'dec_005'], '양식 아닌 결재가 대장에 들었다')
  assert.deepEqual(ids(filterLedger(staffRows, f({ company: 'biz_vana' }))), ['dec_003'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ template: 'purchase' }))), ['dec_001', 'dec_003', 'dec_004'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ period: '2026-10' }))), ['dec_001', 'dec_002', 'dec_005'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ grain: 'week', period: '2026-09-28' }))), ['dec_001', 'dec_002', 'dec_003'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ grain: 'quarter', period: '2026-Q3' }))), ['dec_003'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ grain: 'year', period: '2027' }))), ['dec_004'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ grain: 'day', period: '2026-10-01' }))), ['dec_002'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ from: '2026-10-02', to: '2026-10-31' }))), ['dec_001', 'dec_005'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ status: 'recorded' }))), ['dec_002'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ status: 'approved' }))), ['dec_001', 'dec_005'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ status: 'rejected' }))), ['dec_003'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ requester: '김구매' }))), ['dec_001', 'dec_004'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ requester: 'user_x' }))), ['dec_005']) // 이름이 없으면 기안자 id
  assert.deepEqual(ids(filterLedger(staffRows, f({ team: '영업' }))), ['dec_002'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ vendor: '한우' }))), ['dec_002']) // form.store
  assert.deepEqual(ids(filterLedger(staffRows, f({ vendor: '다나와' }))), ['dec_003']) // form.구입처
  assert.deepEqual(ids(filterLedger(staffRows, f({ min: '1,000,000' }))), ['dec_001', 'dec_004'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ max: '500000' }))), ['dec_002', 'dec_003'])
  assert.deepEqual(ids(filterLedger(staffRows, f({ q: '가족' }))), ['dec_005']) // 양식 값
  assert.deepEqual(ids(filterLedger(staffRows, f({ q: '노트북', company: 'biz_dy' }))), ['dec_001'])
  // 모양이 틀린 값은 버려진다 — 거르기가 꺼질 뿐 줄이 늘지 않는다.
  const junk = f({ grain: 'decade', period: '2026-10-06', status: 'everything', min: 'abc', from: '2026-02-30', sort: 'drop table' })
  assert.equal(junk.grain, 'month')
  assert.equal(junk.period, undefined)
  assert.equal(junk.status, undefined)
  assert.equal(junk.min, undefined)
  assert.equal(junk.from, undefined)
  assert.equal(junk.sort, 'date')
  // 어떤 값을 줘도 결과는 들어온 줄의 부분집합이다(범위는 RLS가 정한다).
  for (const p of [{}, { company: 'biz_other' }, { q: '' }, { status: 'open', company: 'biz_dy' }]) {
    const out = filterLedger(staffRows, f(p as Record<string, string>))
    assert.ok(out.every((r) => staffRows.includes(r)))
  }
  // URL 왕복 — 화면 링크 값을 다시 읽으면 같은 거르기.
  const round = f({ company: 'biz_dy', grain: 'week', period: '2026-09-28', min: '1000', q: '노트북', sort: 'amount', dir: 'asc' })
  assert.deepEqual(parseLedgerFilters(ledgerParams(round)), round)
  assert.deepEqual(ledgerParams(f({})), {}, '기본값은 URL에 싣지 않는다')
  // 링크 칸은 http(s)만.
  assert.equal(row(staffRows, 'dec_001').link, 'https://example.com/a')
  assert.equal(row(staffRows, 'dec_002').link, null)
  assert.equal(safeUrl('ftp://x'), null)
}

/* ------------------------------------------------------------------ 4) 정렬 */

function sorting() {
  assert.deepEqual(sortLedger(staffRows, 'amount', 'desc').map((r) => r.id), ['dec_004', 'dec_001', 'dec_003', 'dec_002', 'dec_005'])
  assert.deepEqual(sortLedger(staffRows, 'amount', 'asc').map((r) => r.id), ['dec_002', 'dec_003', 'dec_001', 'dec_004', 'dec_005']) // 빈 금액은 늘 뒤
  assert.deepEqual(sortLedger(staffRows, 'date', 'desc').map((r) => r.id), ['dec_004', 'dec_005', 'dec_001', 'dec_002', 'dec_003'])
  assert.deepEqual(sortLedger(staffRows, 'vendor', 'asc').map((r) => r.id).slice(0, 3), ['dec_003', 'dec_004', 'dec_001']) // 같은 구입처는 결재 번호 내림차순
  assert.equal(sortLedger(staffRows, 'decided', 'asc').at(-1)?.id, 'dec_004') // 처리일 없음은 뒤
}

/* ------------------------------------------------------------------ 5) 합계 · 6) 용어 */

function totals() {
  const t = ledgerTotals(staffRows, 'quarter')
  assert.equal(t.count, 5)
  assert.equal(t.sum, 6_000_000 + 120_000 + 450_000 + 9_000_000)
  assert.deepEqual(t.byMonth.map((g) => g.key), ['2026-09', '2026-10', '2027-01'])
  assert.deepEqual(t.byPeriod.map((g) => g.key), ['2026-Q3', '2026-Q4', '2027-Q1'])
  assert.equal(t.byTemplate.find((g) => g.key === 'purchase')?.sum, 6_000_000 + 450_000 + 9_000_000)
  assert.equal(t.byVendor.find((g) => g.key === '쿠팡')?.count, 2)
  assert.equal(t.byTeam.find((g) => g.key === '구매팀')?.sum, 15_000_000)
  assert.equal(t.byTeam.find((g) => g.key === '')?.label, '팀 없음')
}

function wording() {
  assert.equal(row(staffRows, 'dec_004').approver, '대표', '직원 화면에 «회장»이 보인다')
  assert.equal(row(chairRows, 'dec_004').approver, '회장')
  assert.equal(row(staffRows, 'dec_003').approver, null) // 끝난 단계 결재
  assert.equal(row(staffRows, 'dec_002').status_label, '기록 완료')
  const hist = ledgerHistory(staffRows, STEPS, DECISIONS, 'Member')
  assert.ok(hist.every((h) => !/회장|Chairman/.test(`${h.approver} ${h.why}`)), '직원 이력에 «회장»이 보인다')
  const h3 = hist.filter((h) => h.id === 'dec_003')
  assert.deepEqual(h3.map((h) => [h.seq, h.status]), [[1, '반려'], [2, '취소']])
  assert.equal(h3[0].note, '견적 다시')
  // 0059 전 결재 — 얼린 결재선 칸마다 한 줄, 마지막 칸에 최종 상태 · 처리 시각.
  const h5 = hist.filter((h) => h.id === 'dec_005')
  assert.equal(h5.length, 2)
  assert.equal(h5[1].approver, '대표')
  assert.equal(h5[1].decided_at, '2026-10-07T05:00:00Z')
  assert.match(h5[0].status, /단계 기록 없음/)
}

/* ------------------------------------------------------------------ 7) 엑셀 */

async function workbook() {
  const filtersOct = f({ company: 'biz_dy', period: '2026-10' })
  assert.equal(ledgerFileName(filtersOct), '결재대장_DY_2026-10.xlsx')
  assert.equal(ledgerFileName(f({})), '결재대장_전체_전체.xlsx')
  assert.equal(ledgerFileName(f({ grain: 'week', period: '2026-09-28' })), '결재대장_전체_2026-09-28주.xlsx')
  const cd = contentDisposition('결재대장_DY_2026-10.xlsx')
  assert.match(cd, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/)
  assert.ok(cd.includes(encodeURIComponent('결재대장')))

  const rows = sortLedger(staffRows, 'date', 'asc')
  const wb = buildLedgerWorkbook({
    rows,
    totals: ledgerTotals(rows, 'month'),
    history: ledgerHistory(rows, STEPS, DECISIONS, 'Member'),
    templates: TEMPLATES,
    filters: f({}),
    businessNames: { biz_dy: 'DY (주)', biz_vana: 'VANA AI' },
  })
  const buf = await wb.xlsx.writeBuffer()
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(buf as ArrayBuffer)
  assert.deepEqual(back.worksheets.map((w) => w.name), ['목록', '묶음 합계', '결재선 이력'])

  const list = back.getWorksheet('목록')!
  const header = (list.getRow(1).values as unknown[]).slice(1).map(String)
  const col = (name: string) => header.indexOf(name) + 1
  for (const h of ['결재 번호', '날짜', '양식', '제목', '올린 사람', '금액', '구입처', '링크', '상태', '현재 결재자', '최종 처리일']) {
    assert.ok(col(h) > 0, `목록에 «${h}» 칸이 없다`)
  }
  // 양식 항목 칸 — 지출(10) → 구매(20) → 휴가(30) 순서, 같은 key(amount · link)는 한 칸. 양식에 없는 store · 구입처도 남는다.
  const formHeaders = header.slice(col('최종 처리일'))
  assert.deepEqual(formHeaders.slice(0, 6), ['금액(원)', '지출 목적', '링크', '품목', '구입처', '사유'])
  assert.ok(formHeaders.includes('store') && formHeaders.includes('구입처 (이전 항목)'))

  // 2번 줄 = dec_003(가장 이른 날)
  const r2 = list.getRow(2)
  assert.equal(r2.getCell(col('결재 번호')).value, 'dec_003')
  const amount = r2.getCell(col('금액'))
  assert.equal(typeof amount.value, 'number')
  assert.equal(amount.value, 450_000)
  assert.equal(amount.numFmt, MONEY_FMT)
  const day = r2.getCell(col('날짜'))
  assert.ok(day.value instanceof Date, '날짜 칸이 Date가 아니다')
  assert.equal((day.value as Date).toISOString().slice(0, 10), '2026-09-30')
  assert.equal(day.numFmt, DATE_FMT)
  const formAmount = r2.getCell(col('금액(원)'))
  assert.equal(formAmount.value, 450_000)
  assert.equal(formAmount.numFmt, MONEY_FMT)
  assert.equal(r2.getCell(col('품목')).value, '모니터')
  // 링크 칸은 하이퍼링크.
  const linkRow = list.getRow(rows.findIndex((r) => r.id === 'dec_001') + 2)
  assert.equal((linkRow.getCell(col('링크')).value as { hyperlink?: string }).hyperlink, 'https://example.com/a')
  // 직원 파일에 «회장»이 없다.
  list.eachRow((r) => (r.values as unknown[]).forEach((v) => assert.ok(!/회장/.test(String(v ?? '')), `목록에 «회장»: ${String(v)}`)))

  const sums = back.getWorksheet('묶음 합계')!
  const total = sums.getRow(2)
  assert.equal(total.getCell(1).value, '전체')
  assert.equal(total.getCell(4).value, 15_570_000)
  assert.equal(total.getCell(4).numFmt, MONEY_FMT)
  const groups = new Set<string>()
  sums.eachRow((r, n) => n > 1 && groups.add(String(r.getCell(1).value)))
  assert.deepEqual([...groups], ['전체', '월', '양식', '구입처', '팀'])

  const hist = back.getWorksheet('결재선 이력')!
  const hHeader = (hist.getRow(1).values as unknown[]).slice(1)
  assert.deepEqual(hHeader, ['결재 번호', '제목', '단계', '결재자', '이유', '상태', '처리 시각', '의견'])
  assert.equal(hist.rowCount, 1 + 6) // 단계 4줄 + 0059 전 결재선 2칸
  const rejected = hist.getRow(2)
  assert.equal(rejected.getCell(1).value, 'dec_003')
  assert.equal(rejected.getCell(6).value, '반려')
  assert.ok(rejected.getCell(7).value instanceof Date)
  // 처리 시각은 서울 벽시계 — 03:00Z = 12:00 KST.
  assert.equal((rejected.getCell(7).value as Date).toISOString().slice(11, 16), '12:00')
  assert.equal(rejected.getCell(8).value, '견적 다시')
}

/* ------------------------------------------------------------------ 8) 내려받기 권한 · 감사 값 */

function exportGate() {
  // 0059 approval_ledger_log의 거울 — 회장은 전체 · 회사, 그 밖은 열람 줄이 있는 그 회사를 골랐을 때만.
  assert.ok(canExportLedger('Chairman', [], undefined))
  assert.ok(canExportLedger('Chairman', undefined, 'biz_dy'))
  assert.ok(canExportLedger('Member', ['biz_dy'], 'biz_dy'))
  assert.ok(!canExportLedger('Member', ['biz_dy'], undefined), '열람 줄이 있어도 전체 내려받기는 회장만')
  assert.ok(!canExportLedger('Member', ['biz_dy'], 'biz_vana'))
  assert.ok(!canExportLedger('GroupCFO', [], 'biz_dy'))
  assert.ok(!canExportLedger(null, undefined, 'biz_dy'))
  // p_filters ≤ 2000자.
  const long = 'ㄱ'.repeat(500)
  const big = f({ company: 'biz_dy', q: long, requester: long, team: long, vendor: long, template: long })
  assert.ok(JSON.stringify(auditFilters(big)).length <= LEDGER_AUDIT_MAX)
  assert.deepEqual(auditFilters(f({ company: 'biz_dy', period: '2026-10' })), { company: 'biz_dy', period: '2026-10' })
}

async function main() {
  exportGate()
  dates()
  rollups()
  filters()
  sorting()
  totals()
  wording()
  await workbook()
  console.log('check:approval-ledger 통과 — 날짜 · 기간 묶음 · 거르기 · 정렬 · 합계 · 용어 · 엑셀')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
