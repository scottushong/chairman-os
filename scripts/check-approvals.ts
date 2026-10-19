/**
 * 0087 전자결재 — dummy 엔진(lib/approvals/engine.ts) 시험. `npm run check:approvals`.
 * DB 쪽 같은 규칙은 scripts/check-approvals-db.ts(PGlite · check:migrations)가 잰다. 여기는 dummy 화면이 쓰는 엔진이 같은 답을 내는지 + 화면 문구.
 *   A(생산 직원 · 기안) · B(생산팀장 · 검토) · 대표(승인) · 구매 직원(후속) — 처음부터 끝까지 · 반려 → 재상신 → 승인 → 후속 완료 · 두 탭 · 대결 · 회수.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { featureOnFor } from '../src/lib/features'
import { DUMMY_PEOPLE, DUMMY_TEAMS, DUMMY_UID } from '../src/lib/repository/dummy-org'
import { EaEngine, emptyState, type EaPersonRow } from '../src/lib/approvals/engine'
import type { EaDraftInput } from '../src/lib/approvals/types'

let n = 0
const ok = (name: string, fn: () => void) => {
  fn()
  n += 1
  console.log(`  ✓ ${name}`)
}
const throws = (fn: () => unknown, re: RegExp, why: string) => assert.throws(fn, (e: Error) => re.test(e.message), why)

const people: EaPersonRow[] = DUMMY_PEOPLE.map((p) => ({
  user_id: p.user_id, name: p.display_name, role: p.role, title: p.title_ko, dept: DUMMY_TEAMS.find((t) => t.team_id === p.team_id)?.name ?? null, business_ids: p.business_ids, active: !p.revoked_at,
}))
const state = emptyState()
const companyOn = [{ business_id: 'biz_dy', feature_key: 'approvals', enabled: true, audience: 'all' as const, reason: '시험', updated_by: null, updated_at: '' }]
let rows: Parameters<typeof featureOnFor>[0] = []
const as = (uid: string) => new EaEngine({ state, people, featureOn: (role, b) => featureOnFor(rows, 'approvals', role as never, b) }, { uid, role: people.find((p) => p.user_id === uid)!.role })
const A = DUMMY_UID.prodStaff
const B = DUMMY_UID.prodLead
const CH = DUMMY_UID.chair
const E = DUMMY_UID.buyStaff
const X = DUMMY_UID.salesStaff
const D = DUMMY_UID.supportStaff
const base = (o: Partial<EaDraftInput> = {}): EaDraftInput => ({
  doc_id: null, business_id: 'biz_dy', form_key: 'purchase', title: '포장기 소모품 구매품의', body: '포장기 정기 유지보수용 소모품 구매를 요청합니다.',
  fields: { item: '소모품', qty: '10', vendor: '가나상사', purpose: '유지보수', supply: '320000', vat: '32000', total: '352000' },
  line: [{ user_id: B, kind: 'approve' }, { role: 'Chairman', kind: 'approve' }], refs: [{ user_id: X, kind: 'cc' }], due_date: '2000-01-01', wish_date: '2026-10-23', followup_assignee: E, related: [], ...o,
})

console.log('스위치')
ok('기본(대표만)에서 직원은 작성 못 함 · 회사 줄을 켜면 됨', () => {
  throws(() => as(A).saveDraft(base()), /ea_denied/, '스위치 꺼진 회사')
  rows = companyOn
  assert.ok(as(A).saveDraft(base({ title: '초안' })))
})

console.log('처음부터 끝까지 — A 기안 · B 검토 · 대표 승인')
let d1 = ''
let v2 = ''
ok('상신 검증(합계 · 첨부 · 결재선 · 전결 규칙)', () => {
  d1 = as(A).saveDraft(base({ fields: { ...base().fields, total: '350000' } }))
  throws(() => as(A).submit(d1, 'r-sub-001'), /ea_total/, '합계')
  as(A).saveDraft(base({ doc_id: d1 }))
  throws(() => as(A).submit(d1, 'r-sub-002'), /ea_attachment/, '첨부')
  as(A).fileAdd(d1, `${d1}/q.pdf`, '견적서.pdf', 1000, 'application/pdf')
  as(A).saveDraft(base({ doc_id: d1, line: [{ user_id: B, kind: 'approve' }], fields: { ...base().fields, supply: '20000000', vat: '2000000', total: '22000000' } }))
  throws(() => as(A).submit(d1, 'r-sub-003'), /ea_line_rule/, '전결 규칙')
  as(A).saveDraft(base({ doc_id: d1, line: [{ user_id: A, kind: 'approve' }] }))
  throws(() => as(A).submit(d1, 'r-sub-004'), /ea_line/, '기안자가 결재선에')
  as(A).saveDraft(base({ doc_id: d1 }))
  assert.match(as(A).submit(d1, 'r-sub-005'), /^GW-\d{4}-\d{4}$/)
  throws(() => as(A).saveDraft(base({ doc_id: d1 })), /ea_not_draft/, '상신 뒤 덮어쓰기')
})
ok('결재할 문서 = 지금 내 차례만 · 예정 · 참조 · 남', () => {
  assert.deepEqual(as(B).list('todo').map((r) => r.doc_id), [d1])
  assert.equal(as(CH).list('todo').length, 0)
  assert.deepEqual(as(CH).list('planned').map((r) => r.doc_id), [d1])
  assert.deepEqual(as(X).list('refs').map((r) => r.doc_id), [d1])
  assert.equal(as(X).list('todo').length, 0)
  assert.equal(as(D).detail(d1), null, '관계없는 사람이 상세를 읽는다')
  assert.equal(as(B).list('todo')[0].overdue, true)
})
ok('참조자 · 예정 결재자 · 사유 없는 반려 막힘', () => {
  throws(() => as(X).act(d1, 1, 'approve', null, 'r-act-001'), /ea_not_your_turn/, '참조자')
  throws(() => as(CH).act(d1, 2, 'approve', null, 'r-act-002'), /ea_step_not_waiting/, '예정 결재자')
  throws(() => as(B).act(d1, 1, 'reject', ' ', 'r-act-003'), /ea_reason/, '사유')
})
ok('중간 승인 ≠ 승인 완료 · 같은 요청 재시도 = 한 번 · 두 번째 탭 거부', () => {
  assert.equal(as(B).act(d1, 1, 'approve', '확인', 'r-act-010'), 'in_progress')
  assert.equal(as(B).act(d1, 1, 'approve', '확인', 'r-act-010'), 'in_progress')
  throws(() => as(B).act(d1, 1, 'approve', null, 'r-act-011'), /ea_step_not_waiting/, '두 번째 탭')
  assert.equal(state.events.filter((e) => e.doc_id === d1 && e.action === 'approve').length, 1)
  assert.equal(state.notices.filter((x) => x.user_id === CH && x.link.includes(d1)).length, 1, '대표 알림 한 번')
  const h = as(B).list('history')[0]
  assert.equal(h.my_result, 'approved')
  assert.equal(h.status, 'in_progress')
  throws(() => as(A).withdraw(d1, 'r-wd-001'), /ea_withdraw_acted/, '처리 뒤 회수')
})
ok('반려 → 재상신(새 판 · 처음부터) → 승인 → 후속 한 번 → 완료(문서 상태 그대로)', () => {
  assert.equal(as(CH).act(d1, 2, 'reject', '견적 두 곳 비교 필요', 'r-act-020'), 'rejected')
  v2 = as(A).resubmit(d1)
  assert.equal(state.docs.find((d) => d.doc_id === d1)!.status, 'rejected')
  assert.equal(as(A).detail(v2)!.files.length, 1)
  as(A).submit(v2, 'r-sub-010')
  assert.deepEqual(state.steps.filter((s) => s.doc_id === v2).map((s) => s.status), ['waiting', 'planned'])
  assert.deepEqual(as(B).detail(v2)!.versions.map((v) => v.doc_id), [d1])
  as(B).act(v2, 1, 'approve', null, 'r-act-030')
  assert.equal(as(E).detail(v2), null, '후속 담당자가 승인 전에 읽는다')
  assert.equal(as(CH).act(v2, 2, 'approve', null, 'r-act-031'), 'approved')
  assert.equal(as(CH).act(v2, 2, 'approve', null, 'r-act-031'), 'approved')
  assert.equal(state.followups.filter((f) => f.doc_id === v2).length, 1)
  assert.ok(as(E).detail(v2))
  throws(() => as(B).followupUpdate(v2, 'done', '발주', null, 'r-fu-001'), /ea_denied/, '남이 후속 완료')
  as(E).followupUpdate(v2, 'done', '발주서 PO-77 발송', '20261019-1', 'r-fu-002')
  assert.equal(state.docs.find((d) => d.doc_id === v2)!.status, 'approved')
  throws(() => as(E).followupUpdate(v2, 'doing', null, null, 'r-fu-003'), /ea_followup_done/, '끝난 후속 되돌리기')
})
ok('첨부 읽기 = 문서 읽기', () => {
  assert.equal(as(D).objectReadOk(`${d1}/q.pdf`), false)
  assert.equal(as(X).objectReadOk(`${d1}/q.pdf`), true)
  assert.equal(as(E).objectReadOk(`${d1}/q.pdf`), true, '후속 담당자(새 판이 같은 객체)')
})
ok('대결 — 기록 둘 · 범위 밖은 안 보임', () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  as(B).proxySave(D, today, today, ['general'], null)
  const g = as(A).saveDraft(base({ form_key: 'general', title: '사무용품 정리', fields: {}, line: [{ user_id: B, kind: 'approve' }], refs: [], followup_assignee: null, due_date: null }))
  as(A).submit(g, 'r-sub-020')
  assert.deepEqual(as(D).list('todo').map((r) => [r.doc_id, r.as_proxy]), [[g, true]])
  as(D).act(g, 1, 'approve', '대결 승인', 'r-act-040')
  const s = state.steps.find((x) => x.doc_id === g)!
  assert.deepEqual([s.acted_by, s.acted_as_proxy, s.approver_user], [D, true, B])
})
ok('회수 — 처리 전 · 기안자만 · 기록 남음', () => {
  const w = as(A).saveDraft(base({ form_key: 'general', title: '회수 시험', fields: {}, line: [{ user_id: B, kind: 'approve' }], refs: [], followup_assignee: null }))
  as(A).submit(w, 'r-sub-030')
  throws(() => as(X).withdraw(w, 'r-wd-010'), /ea_denied/, '남이 회수')
  as(A).withdraw(w, 'r-wd-011')
  assert.equal(state.events.filter((e) => e.doc_id === w && (e.action === 'submit' || e.action === 'withdraw')).length, 2)
})
ok('건수 = 목록(위젯 · 메뉴 같은 함수) · 결재 예정은 결재 대기에 안 셈', () => {
  for (const u of [A, B, CH, E, X]) {
    const c = as(u).counts()
    assert.equal(c.todo, as(u).list('todo').length)
    assert.equal(c.planned, as(u).list('planned').length)
  }
})
ok('관리자 = 대표만 · 양식 판 · 상신 문서 판 그대로 · 관리자도 남의 문서는 못 봄', () => {
  throws(() => as(B).formSave({ ...state.forms[0] }), /ea_denied/, '직원 양식')
  assert.equal(as(CH).formSave({ ...state.forms[0] }), 2)
  assert.equal(state.docs.find((d) => d.doc_id === v2)!.form_snapshot!.version, 1)
  const w = state.docs.find((d) => d.title === '회수 시험')!.doc_id
  assert.equal(as(CH).detail(w), null)
})

console.log('화면 문구')
ok('직원 화면 파일에 «회장» · Chairman 문구가 없다(역할 키 제외)', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
  const files = [...walk('src/components/e-approval'), ...walk('src/app/(dashboard)/e-approval'), 'src/lib/approvals/types.ts', 'src/app/actions/e-approval.ts']
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/'Chairman'/g, '').replace(/role === 'Chairman'/g, '')
    const visible = text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*\*)/.test(l))
    assert.ok(!visible.some((l) => /회장/.test(l)), `${f}에 «회장»`)
  }
})

console.log(`PASS: ${n} approvals checks (dummy 엔진 = 0087 규칙 · A · B · 대표 · 후속 · 대결 · 회수 · 건수 = 목록 · 문구)`)
