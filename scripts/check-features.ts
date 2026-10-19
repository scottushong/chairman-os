/**
 * 기능 스위치(0073) 순수 검사 — DB · 네트워크 없음: npm run check:features
 *
 *   1) 목록: 키가 겹치지 않는다 · 0073 3절 기본 줄과 키 · 기본 범위가 같다(앱과 DB가 갈라지지 않게).
 *   2) 판정: 기본값(0073 전 DB = null) · 회사 줄 → 그룹 줄 · 끄면 대표도 꺼짐 · 범위 셋(대표만 · 임원 이상 · 전원).
 *   3) intakeOpenFor 껍데기 — 옛 동작 그대로(대표만).
 *   4) 메뉴: 꺼진 기능의 메뉴 키가 navFor에서 빠진다(대표에게도).
 *   5) 직원 화면 용어: 목록의 이름 · 설명에 «회장» · «ECOUNT 올리기»가 없다.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { closedFeatureRows, defaultFeatureRows, FEATURES, FEATURE_KEYS, featureOnFor, hiddenNavKeys, inAudience, type FeatureSwitchRow } from '../src/lib/features'
import { FOURTEEN, lastMonths, rollTrend } from '../src/lib/chair-dashboard'
import { intakeOpenFor } from '../src/lib/intake/switch'
import { navFor } from '../src/lib/nav'

let passed = 0
const ok = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const row = (key: string, business_id: string | null, enabled: boolean, audience: FeatureSwitchRow['audience']): FeatureSwitchRow => ({
  business_id, feature_key: key, enabled, audience, reason: '시험', updated_by: null, updated_at: '2026-10-12T00:00:00Z',
})

console.log('목록')
ok('키가 겹치지 않고 모양이 0073 check와 맞다', () => {
  assert.equal(new Set(FEATURE_KEYS).size, FEATURE_KEYS.length)
  for (const k of FEATURE_KEYS) assert.match(k, /^[a-z][a-z0-9_]{1,62}$/)
})
ok('0073 3절 · 0081 0절 기본 줄 = FEATURES(키 · 기본 범위)', () => {
  const sql = ['0073_feature_switches.sql', '0081_blueprint_skeleton.sql', '0084_purchase_price_report.sql', '0085_finance_overview.sql', '0086_home_widgets.sql', '0086_memory_engine.sql', '0087_approvals.sql', '0089_finance_mapping.sql'].map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
  const seeded = [...sql.matchAll(/\(null, '([a-z_]+)',\s*true, '(chairman|exec|all)',/g)].map((m) => `${m[1]}:${m[2]}`).sort()
  assert.deepEqual(seeded, FEATURES.map((f) => `${f.key}:${f.defaultAudience}`).sort())
})
ok('요청한 기본값 — 셋은 전원, 나머지는 대표만', () => {
  const all = FEATURES.filter((f) => f.defaultAudience === 'all').map((f) => f.key).sort()
  assert.deepEqual(all, ['ai_assist', 'finance_overview', 'finance_upload', 'finance_upload_ai', 'process_charts', 'purchase_price_report'])
  assert.equal(FEATURES.length, 24)
})

console.log('판정')
ok('범위 셋 — exec는 대표 · CFO · 회사 대표 · 임원', () => {
  assert.equal(inAudience('Chairman', 'chairman'), true)
  assert.equal(inAudience('GroupCFO', 'chairman'), false)
  for (const r of ['Chairman', 'GroupCFO', 'BusinessCEO', 'Executive'] as const) assert.equal(inAudience(r, 'exec'), true, r)
  for (const r of ['TeamLead', 'Member'] as const) assert.equal(inAudience(r, 'exec'), false, r)
  assert.equal(inAudience('Member', 'all'), true)
  assert.equal(inAudience(null, 'all'), false)
})
ok('0073 전 DB(null) = 기본값', () => {
  assert.equal(featureOnFor(null, 'intake', 'Chairman'), true)
  assert.equal(featureOnFor(null, 'intake', 'Member'), false)
  assert.equal(featureOnFor(null, 'ai_assist', 'Member'), true)
  assert.equal(featureOnFor(null, 'finance_docs', 'GroupCFO'), false)
})
ok('기본 줄(dummy 거울) = 기본값과 같은 판정', () => {
  const rows = defaultFeatureRows()
  for (const f of FEATURES) for (const r of ['Chairman', 'Executive', 'Member'] as const) assert.equal(featureOnFor(rows, f.key, r), featureOnFor(null, f.key, r), `${f.key}/${r}`)
})
ok('회사 줄이 그룹 줄을 덮는다 — 그 회사만', () => {
  const rows = [...defaultFeatureRows(), row('intake', 'biz_dy', true, 'all')]
  assert.equal(featureOnFor(rows, 'intake', 'Member', 'biz_dy'), true)
  assert.equal(featureOnFor(rows, 'intake', 'Member', 'biz_vana'), false)
  assert.equal(featureOnFor(rows, 'intake', 'Member'), false)
})
ok('끄면 대표도 꺼진다 · 회사 줄로 다시 켤 수 있다', () => {
  const rows = defaultFeatureRows().map((r) => (r.feature_key === 'process_charts' ? { ...r, enabled: false } : r))
  assert.equal(featureOnFor(rows, 'process_charts', 'Chairman'), false)
  const back = [...rows, row('process_charts', 'biz_dy', true, 'all')]
  assert.equal(featureOnFor(back, 'process_charts', 'Member', 'biz_dy'), true)
})
ok('그룹 줄이 없는 키(0073 뒤에 더한 키)는 기본값', () => {
  const rows = defaultFeatureRows().filter((r) => r.feature_key !== 'monthly_pl')
  assert.equal(featureOnFor(rows, 'monthly_pl', 'Chairman'), true)
  assert.equal(featureOnFor(rows, 'monthly_pl', 'Member'), false)
})
ok('스위치를 못 읽으면 전부 꺼짐(표 없음 null만 기본값 — 0073 리뷰 I4)', () => {
  for (const f of FEATURES) for (const r of ['Chairman', 'Member'] as const) assert.equal(featureOnFor(closedFeatureRows(), f.key, r, 'biz_dy'), false, `${f.key}/${r}`)
  assert.deepEqual(hiddenNavKeys(closedFeatureRows(), 'Chairman'), ['nav_process_charts', 'nav_eapproval', 'nav_home', 'nav_memory'])
})

console.log('옛 스위치 · 메뉴')
ok('intakeOpenFor — 옛 동작 그대로(대표만)', () => {
  assert.equal(intakeOpenFor({ role: 'Chairman' }), true)
  assert.equal(intakeOpenFor({ role: 'TeamLead' }), false)
  assert.equal(intakeOpenFor(null), false)
})
ok('프로세스 차트를 끄면 메뉴가 빠진다(대표 · 직원 모두)', () => {
  const has = (role: 'Chairman' | 'Member', hidden: string[]) => navFor(role, { hidden }).some((g) => g.items.some((i) => i.key === 'nav_process_charts'))
  // 0086 기억 엔진은 기본 «대표만» — 직원에게는 처음부터 «기억» 메뉴가 없다.
  assert.deepEqual(hiddenNavKeys(defaultFeatureRows(), 'Member'), ['nav_eapproval', 'nav_home', 'nav_memory'])
  assert.equal(has('Member', []), true)
  const off = defaultFeatureRows().map((r) => (r.feature_key === 'process_charts' ? { ...r, enabled: false } : r))
  for (const role of ['Chairman', 'Member'] as const) {
    const hidden = hiddenNavKeys(off, role)
    assert.deepEqual(hidden, role === 'Chairman' ? ['nav_process_charts'] : ['nav_process_charts', 'nav_eapproval', 'nav_home', 'nav_memory'])
    assert.equal(has(role, hidden), false, role)
  }
  // 대표만 범위면 직원에게서만 빠진다.
  const chairOnly = defaultFeatureRows().map((r) => (r.feature_key === 'process_charts' ? { ...r, audience: 'chairman' as const } : r))
  assert.equal(has('Chairman', hiddenNavKeys(chairOnly, 'Chairman')), true)
  assert.equal(has('Member', hiddenNavKeys(chairOnly, 'Member')), false)
})
ok('전자결재(0087) — 기본 대표만 · 회사 줄을 켜면 그 회사 사람에게 메뉴 · 예전 «전자결재»는 «결재 요청»으로', () => {
  const rows = defaultFeatureRows()
  const label = (hidden: string[]) => navFor('Member', { hidden }).flatMap((g) => g.items).filter((i) => i.key === 'nav_eapproval' || i.key === 'nav_decisions').map((i) => i.label)
  assert.deepEqual(hiddenNavKeys(rows, 'Chairman'), [])
  assert.deepEqual(label(hiddenNavKeys(rows, 'Member', ['biz_dy'])), ['전자결재'])
  const dy: FeatureSwitchRow = { ...row('approvals', 'biz_dy', true, 'all') }
  const hidden = hiddenNavKeys([...rows, dy], 'Member', ['biz_dy'])
  assert.deepEqual(hidden, ['nav_home'])
  assert.deepEqual(label(hidden), ['결재 요청', '전자결재'])
  assert.deepEqual(hiddenNavKeys([...rows, dy], 'Member', ['biz_vana']), ['nav_eapproval', 'nav_home'], '다른 회사 사람')
})
ok('내 홈(0086) — 기본 대표만 · 회사 줄을 켜면 그 회사 사람에게 «내 홈» · 예전 «내 홈»(/me)은 «내 업무함»으로', () => {
  const rows = defaultFeatureRows()
  const items = (hidden: string[]) => navFor('Member', { hidden }).flatMap((g) => g.items).filter((i) => i.key === 'nav_home' || i.key === 'nav_dashboard').map((i) => `${i.label}→${i.href}`)
  assert.deepEqual(items(hiddenNavKeys(rows, 'Member', ['biz_dy'])), ['내 홈→/me'], '스위치 꺼짐: 새 «내 홈»(/home) 없음 · 예전 그대로')
  const dy: FeatureSwitchRow = row('home_widgets', 'biz_dy', true, 'all')
  assert.deepEqual(items(hiddenNavKeys([...rows, dy], 'Member', ['biz_dy'])), ['내 업무함→/me', '내 홈→/home'])
  assert.deepEqual(hiddenNavKeys([...rows, dy], 'Member', ['biz_vana']).includes('nav_home'), true, '다른 회사 사람')
  const chair = navFor('Chairman', { hidden: hiddenNavKeys(rows, 'Chairman') }).flatMap((g) => g.items).filter((i) => i.key === 'nav_home').map((i) => i.href)
  assert.deepEqual(chair, ['/home'], '대표(기본 범위)는 «내 홈»이 보인다')
})
ok('목록 문구에 «회장» · «ECOUNT 올리기»가 없다', () => {
  for (const f of FEATURES) for (const t of [f.label, f.description]) assert.doesNotMatch(t, /회장|ECOUNT 올리기|Chairman/, f.key)
})

console.log('대표 대시보드(PHASE 8)')
ok('대표 대시보드 — 서버 스위치 · 월별 손익 값만 · 분기 · 년 합산 · 잠정/확정 · 14가지', () => {
  const comp = readFileSync('src/components/dashboard/chair-dashboard.tsx', 'utf8')
  assert.match(comp, /featureOn\(user, 'chairman_dashboard', biz\.business_id\)\)\) return null/, '스위치를 서버에서 보지 않는다')
  const lib = readFileSync('src/lib/chair-dashboard.ts', 'utf8')
  assert.doesNotMatch(lib, /salesMargins|listSaleDeals|cost_margins/, '대시보드 추이가 월별 손익 밖 값을 쓴다')
  assert.deepEqual(lastMonths('2026-02-15', 3), ['2025-12', '2026-01', '2026-02'])
  const m = (period: string, status: 'final' | 'provisional' | null, rev: number | null) => ({ period, status, revenue: rev, operating_income: rev === null ? null : rev / 10, cash_net: rev === null ? null : 1 })
  const q = rollTrend([m('2026-01', 'final', 100), m('2026-02', 'final', 200), m('2026-03', 'provisional', 300), m('2026-04', null, null)], 'quarter')
  assert.deepEqual(q.map((r) => [r.key, r.revenue, r.basis, r.missing]), [['2026-Q1', 600, 'provisional', 0], ['2026-Q2', null, 'provisional', 1]])
  const y = rollTrend([m('2026-01', 'final', 100), m('2026-02', 'final', 200)], 'year')
  assert.deepEqual(y.map((r) => [r.key, r.revenue, r.operating_income, r.basis]), [['2026', 300, 30, 'final']])
  assert.equal(FOURTEEN.length, 14)
  assert.equal(FOURTEEN[13].no, '⑭')
})

console.log(`PASS: ${passed} feature-switch checks (목록 = 0073 기본 줄 · 판정 기본값/회사 덮어쓰기/끄기/범위 셋 · intakeOpenFor 그대로 · 메뉴 빼기 · 문구)`)
