/**
 * 자료 받는 입구 검사 — 모델을 부르지 않는다(네트워크 없음): npm run check:intake
 *
 *   1) 배합비 감지(설계서 A5) — ⓑ 퍼센트 열 합 99~101 · «부(parts)» 열 합 100 · 1000 · ⓐ+ⓒ 낱말 + 원료명/비율 열.
 *      ⓐ 하나만으로는 걸지 않는다(«배합 사료 단가표»). 알려진 한계(놓치는 것 · 잘못 거는 것)는 **한계로 잰다** —
 *      나중에 누가 규칙을 고쳐 한계가 바뀌면 이 검사가 알려 주고, 화면 문장(MIX_RATIO_LIMITS)도 같이 고친다.
 *   2) 분류 출력 해석 — mix_ratio는 제안을 버림 · 모르는 종류 → other · 문서 칸은 문서 종류에서만 · dummy 제안.
 *   3) 화면 규칙 — 거르기 · 확인 권한(0048 문서 쓰기) · 고치기(올린 사람 · 확인 권한자 · 회장) · 차단 풀기 · 되돌리기 · 같은 파일 알림.
 *   4) 실패 문장 모양(limits.ts unreadableMessage — 26e0563과 같은 문장).
 */
import assert from 'node:assert/strict'

import { unreadableMessage } from '../src/lib/attachments/limits'
import { MIX_RATIO_LIMITS, MIX_RATIO_MESSAGE, detectMixRatio, findTables } from '../src/lib/intake/mix-ratio'
import { INTAKE_SCHEMA, dummyIntakeProposal, parseIntakeProposal } from '../src/lib/intake/proposal'
import { canConfirmIntake, canEditIntake, canLiftBlock, canUndoLoad, isWaiting, matchesFilter, sameFileNotice } from '../src/lib/intake/rules'
import type { SessionUser } from '../src/types'

let passed = 0
const ok = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const sheet = (...rows: string[][]) => rows.map((r) => r.join('\t')).join('\n')

console.log('배합비 감지')
ok('ⓑ 퍼센트 열의 합이 100 → 건다', () => {
  const v = detectMixRatio([sheet(['원료', '비율(%)'], ['옥수수', '62.5'], ['대두박', '25'], ['밀기울', '10'], ['소금', '2.5'])])
  assert.equal(v.hit, true)
  assert.equal(v.rule, 'percent_sum')
})
ok('ⓑ 머리 없이 값에 %를 붙인 열의 합 99.9(반올림) → 건다', () => {
  const v = detectMixRatio([sheet(['재료', '양'], ['A-12', '33.3%'], ['B-07', '33.3%'], ['C-01', '33.3%'])])
  assert.equal(v.rule, 'percent_sum')
})
ok('ⓑ 합계 줄은 더하지 않는다(100 + 합계 100 = 200이 아니다)', () => {
  const v = detectMixRatio([sheet(['성분', '함량 %'], ['물', '70'], ['당', '30'], ['합계', '100'])])
  assert.equal(v.rule, 'percent_sum')
})
ok('ⓑ «부(parts)» 열의 합 100 → 건다', () => {
  const v = detectMixRatio([sheet(['Material', 'Parts'], ['Resin', '60'], ['Filler', '30'], ['Pigment', '10'])])
  assert.equal(v.rule, 'parts_sum')
})
ok('ⓑ «중량부» 열의 합 1000 → 건다', () => {
  const v = detectMixRatio([sheet(['품목', '중량부'], ['베이스', '700'], ['첨가제', '250'], ['안정제', '50'])])
  assert.equal(v.rule, 'parts_sum')
})
ok('ⓑ «부» 열이라도 합이 100 · 1000이 아니면 걸지 않는다', () => {
  assert.equal(detectMixRatio([sheet(['품목', '부'], ['A', '12'], ['B', '7'], ['C', '3'])]).hit, false)
})
ok('ⓐ+ⓒ 배합 낱말 + 원료명 · 비율 열 → 건다(합이 100이 아니어도)', () => {
  const v = detectMixRatio(['## 시트: 배합표 v3', sheet(['원료명', '투입비'], ['원료 A', '3.2'], ['원료 B', '1.1'], ['원료 C', '0.4'])])
  assert.equal(v.rule, 'keyword_and_ratio_table')
})
ok('ⓐ+ⓒ 영어(formulation · ingredient · w/w) → 건다', () => {
  const v = detectMixRatio(['Formulation sheet', 'Ingredient | w/w | Note\nGlycerin | 4.0 | \nWater | 80.5 | \nExtract | 2.0 | x'])
  assert.equal(v.rule, 'keyword_and_ratio_table')
})
ok('ⓐ 낱말 하나만으로는 걸지 않는다 — «배합 사료 단가표»', () => {
  const v = detectMixRatio([sheet(['배합 사료 단가표', ''], ['품명', '단가(원/kg)'], ['육계 배합 사료', '650'], ['산란계 배합 사료', '620'], ['양돈 배합 사료', '700'])])
  assert.equal(v.hit, false)
  assert.ok(v.keywords.includes('배합'), '낱말은 찾았지만(ⓐ) 비율 열이 없어 걸지 않는다')
})
ok('ⓒ 원료명 · 비율 열만(낱말 없음 · 합 ≠ 100) → 걸지 않는다', () => {
  assert.equal(detectMixRatio([sheet(['원료명', '비율'], ['A', '3'], ['B', '2'], ['C', '1'])]).hit, false)
})
ok('원료 단가표(원료명 · 규격 · 단가 · 구입처) → 걸지 않는다', () => {
  assert.equal(detectMixRatio([sheet(['원료명', '규격', '단가', '구입처'], ['옥수수', '25kg', '18,500', '㈜가'], ['대두박', '25kg', '21,000', '㈜나'], ['밀기울', '20kg', '9,800', '㈜다'])]).hit, false)
})
ok('할인율 열(합 ≠ 100) · 수율 열은 걸지 않는다', () => {
  assert.equal(detectMixRatio([sheet(['품목', '할인율', '수율'], ['A', '5%', '92'], ['B', '10%', '88'], ['C', '3%', '95'])]).hit, false)
})
ok('글로 된 계약서(표 없음) → 걸지 않는다', () => {
  assert.equal(detectMixRatio(['제1조(목적) 본 계약은 갑과 을 사이의 원료 공급에 관한 사항을 정한다.\n제2조(대금) 대금은 매월 말일 지급한다.']).hit, false)
})
ok('표 찾기 — 탭 · 세로줄 · 두 칸 공백, 머리 줄은 숫자 아닌 칸이 많은 줄', () => {
  assert.equal(findTables('a\tb\n1\t2\n3\t4').length, 1)
  assert.equal(findTables('이름 | 값\nx | 1\ny | 2').length, 1)
  assert.equal(findTables('항목   금액\n가   10\n나   20')[0].header.join(','), '항목,금액')
})

console.log('배합비 감지 — 알려진 한계(설계서 A5 · 화면 문장 MIX_RATIO_LIMITS)')
ok('놓침: 비율을 무게(kg/배치)로 적은 표', () => {
  assert.equal(detectMixRatio([sheet(['원료', 'kg/배치'], ['A', '312.5'], ['B', '125'], ['C', '62.5'])]).hit, false)
})
ok('놓침: 낱말 없이 코드 이름 + 비율 열(합 ≠ 100 — 소수 둘째 자리 단위)', () => {
  assert.equal(detectMixRatio([sheet(['코드', '비'], ['X1', '0.62'], ['X2', '0.25'], ['X3', '0.13'])]).hit, false)
})
ok('놓침: 원료명 시트와 비율 시트를 나눈 파일', () => {
  assert.equal(detectMixRatio([sheet(['원료명', '코드'], ['옥수수', 'A'], ['대두박', 'B'], ['밀기울', 'C']), sheet(['코드', '값'], ['A', '6'], ['B', '3'], ['C', '1'])]).hit, false)
})
ok('잘못 걸음: 지분표(퍼센트 합 100) — 대표가 «배합비 아님»으로 푼다', () => {
  assert.equal(detectMixRatio([sheet(['주주', '지분율'], ['홍길동', '60%'], ['㈜가', '30%'], ['기타', '10%'])]).rule, 'percent_sum')
})
ok('잘못 걸음: 영양성분표의 비율(%) 합 100', () => {
  assert.equal(detectMixRatio([sheet(['성분', '비율(%)'], ['탄수화물', '55'], ['단백질', '25'], ['지방', '20'])]).rule, 'percent_sum')
})
ok('안내 문장 — 배합비 안내 · 한계 문장', () => {
  assert.match(MIX_RATIO_MESSAGE, /AI에 보내지 않았습니다.*Vault/)
  assert.match(MIX_RATIO_LIMITS, /안전망이지 보증이 아닙니다/)
})

console.log('분류 출력 해석')
const AT = '2026-10-07T00:00:00.000Z'
ok('mix_ratio → 제안을 버린다', () => {
  assert.deepEqual(parseIntakeProposal({ kind: 'mix_ratio', confidence: 'high', reason: 'x', title: '배합표' }, 'm', AT), { mix: true })
})
ok('계약서 — 문서 칸이 남는다', () => {
  const r = parseIntakeProposal(
    { kind: 'contract', confidence: 'high', reason: '표지에 «공급계약서»', title: '원료 공급계약서', counterparty: '㈜가', date: '2026-09-01', period: '1년', expiry: '2027-08-31', amount: '금 일억 원정', doc_type: 'Contract' },
    'claude-x',
    AT,
  )
  assert.equal(r.mix, false)
  if (r.mix) return
  assert.equal(r.proposal.kind, 'contract')
  assert.equal(r.proposal.fields.amount, '금 일억 원정')
  assert.equal(r.proposal.fields.doc_type, 'Contract')
  assert.equal(r.proposal.model, 'claude-x')
})
ok('재무제표 — 종류만(금액 · 상대방 칸은 버린다)', () => {
  const r = parseIntakeProposal({ kind: 'statement', confidence: 'medium', reason: '재무상태표', title: '2025 결산', counterparty: '세무법인', amount: '12억', doc_type: 'Other' }, 'm', AT)
  assert.ok(!r.mix && r.proposal.fields.amount === null && r.proposal.fields.counterparty === null && r.proposal.fields.doc_type === null)
})
ok('모르는 종류 → other · 모르는 확신 → low · 빈 이유 → 안내', () => {
  const r = parseIntakeProposal({ kind: 'invoice', confidence: 'sure', reason: '' }, 'm', AT)
  assert.ok(!r.mix && r.proposal.kind === 'other' && r.proposal.confidence === 'low' && r.proposal.reason === '이유를 받지 못했습니다')
})
ok('스키마 — 종류에 mix_ratio가 있고 칸은 전부 필수(구조 출력)', () => {
  assert.ok((INTAKE_SCHEMA.properties.kind.enum as readonly string[]).includes('mix_ratio'))
  assert.equal(INTAKE_SCHEMA.required.length, Object.keys(INTAKE_SCHEMA.properties).length)
})
ok('dummy 제안 — 파일 이름으로 · DUMMY 표시', () => {
  assert.equal(dummyIntakeProposal('원료공급계약서.pdf', AT).kind, 'contract')
  assert.equal(dummyIntakeProposal('2025 결산 재무제표.pdf', AT).kind, 'statement')
  assert.equal(dummyIntakeProposal('photo.jpg', AT).kind, 'other')
  assert.equal(dummyIntakeProposal('x.pdf', AT).dummy, true)
})

console.log('화면 규칙')
const user = (role: SessionUser['role'], extra: Partial<SessionUser> = {}): SessionUser =>
  ({ user_id: `u-${role}`, role, name: role, business_ids: ['biz_dy'], documents: {}, ...extra }) as unknown as SessionUser
const chair = user('Chairman')
const writer = user('TeamLead', { documents: { biz_dy: { write: true } } } as Partial<SessionUser>)
const staff = user('Member')
const item = { created_by: staff.user_id, business_id: 'biz_dy', status: 'proposed' as const, ai_blocked_reason: null, loaded_by: null }
ok('거르기 — 확인 기다림 · 내가 올린 것 · 적재됨', () => {
  assert.ok(isWaiting({ status: 'proposed' }) && isWaiting({ status: 'failed' }) && isWaiting({ status: 'no_ai' }))
  assert.ok(!isWaiting({ status: 'loaded' }) && !isWaiting({ status: 'kept' }))
  assert.ok(matchesFilter(item, 'mine', staff.user_id) && !matchesFilter(item, 'mine', writer.user_id))
  assert.ok(matchesFilter({ ...item, status: 'loaded' }, 'loaded', 'x') && !matchesFilter(item, 'loaded', 'x'))
})
ok('확인 권한 = 그 회사 문서 쓰기(0048) · 회장', () => {
  assert.ok(canConfirmIntake(chair, 'biz_dy') && canConfirmIntake(writer, 'biz_dy'))
  assert.ok(!canConfirmIntake(staff, 'biz_dy') && !canConfirmIntake(writer, 'biz_vana'))
  assert.ok(!canConfirmIntake(user('AIAgent', { documents: { biz_dy: { write: true } } } as Partial<SessionUser>), 'biz_dy'))
})
ok('고치기 = 올린 사람 · 확인 권한자 · 회장', () => {
  assert.ok(canEditIntake(staff, item) && canEditIntake(writer, item) && canEditIntake(chair, item))
  assert.ok(!canEditIntake(user('Member', { user_id: 'other' } as Partial<SessionUser>), item))
})
ok('차단 풀기 — 대표는 어느 이유든 · not_attested는 올린 사람의 확인 · 그 밖은 없음', () => {
  assert.equal(canLiftBlock(chair, { ...item, ai_blocked_reason: 'mix_ratio' }), 'chairman')
  assert.equal(canLiftBlock(staff, { ...item, ai_blocked_reason: 'not_attested' }), 'attest')
  assert.equal(canLiftBlock(staff, { ...item, ai_blocked_reason: 'mix_ratio' }), null)
  assert.equal(canLiftBlock(writer, { ...item, ai_blocked_reason: 'not_attested' }), null)
})
ok('되돌리기 = 적재한 사람 · 회장', () => {
  const loaded = { ...item, status: 'loaded' as const, loaded_by: writer.user_id }
  assert.ok(canUndoLoad(writer, loaded) && canUndoLoad(chair, loaded) && !canUndoLoad(staff, loaded))
})
ok('같은 파일 알림', () => {
  assert.equal(sameFileNotice([]), null)
  assert.equal(
    sameFileNotice([{ status: 'loaded', loaded_table: 'documents', loaded_at: '2026-10-01T03:00:00Z', created_at: '2026-09-30T00:00:00Z' }]),
    '이미 2026-10-01에 문서로 넣은 파일입니다.',
  )
  assert.match(sameFileNotice([{ status: 'proposed', loaded_table: null, loaded_at: null, created_at: '2026-09-30T00:00:00Z' }])!, /이미 입구에 있습니다/)
})
ok('실패 문장 — «이 파일은 아직 읽을 수 없습니다 — ‹이유›. 파일은 올라갔습니다.»', () => {
  assert.equal(unreadableMessage('글자를 찾지 못했습니다.'), '이 파일은 아직 읽을 수 없습니다 — 글자를 찾지 못했습니다. 파일은 올라갔습니다.')
})


/**
 * 5) dummy 흐름 — 화면이 부르는 저장소 메서드 + 서버 읽기(read.ts)를 키 없이 끝까지. DUMMY_USER는 호출마다 읽으므로 한 프로세스에서
 *    사람을 바꿔 가며 잰다. DB의 0058 규칙(check-migrations가 PGlite로 잰다)과 같은 답을 내는가가 요점이다.
 */
async function dummyFlow() {
  delete process.env.ANTHROPIC_API_KEY
  const as = (key: string) => (process.env.DUMMY_USER = key)
  const { dummyRepository: repo } = await import('../src/lib/repository/dummy')
  const { readIntake } = await import('../src/lib/intake/read')
  const { DUMMY_UID } = await import('../src/lib/repository/dummy-org')
  const ExcelJS = (await import('exceljs')).default
  const staff = { user_id: DUMMY_UID.salesStaff, role: 'Member' as const }
  const lead = { user_id: DUMMY_UID.supportLead, role: 'TeamLead' as const }
  const chair = { user_id: DUMMY_UID.chair, role: 'Chairman' as const }
  const step = (name: string) => {
    passed++
    console.log(`  ✓ ${name}`)
  }

  async function upload(name: string, mime: string, bytes: ArrayBuffer, sha: string | null = null) {
    const b = await repo.beginIntake({ business_id: 'biz_dy', security_class: 'Normal', file_name: name, mime, size_bytes: bytes.byteLength, file_sha256: sha, mix_attested: false }, staff)
    await repo.putAttachmentObject(b.storage_path, bytes, mime)
    return b
  }
  async function xlsx(rows: (string | number)[][]): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('시트1')
    rows.forEach((r) => ws.addRow(r))
    const buf = await wb.xlsx.writeBuffer()
    return new Uint8Array(buf as ArrayBuffer).slice().buffer
  }
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer

  console.log('dummy 흐름')
  as('sales_staff')
  assert.ok((await repo.listIntakeItems('biz_dy')).filter((i) => i.item_id.startsWith('itk_seed_')).length === 4, '시드 넷이 일반 직원에게 보여야 한다(제한 등급 재무제표 하나는 안 보인다)')
  step('시드 — DY 입구에 상태가 다른 줄(일반 직원에게 넷 · 제한 등급은 안 보임)')

  const mix = await upload('사료 배합.xlsx', XLSX, await xlsx([['원료', '비율(%)'], ['옥수수', 62.5], ['대두박', 25], ['밀기울', 12.5]]))
  assert.equal((await readIntake(repo, mix.item_id, staff)).status, 'no_ai')
  const mixRow = (await repo.getIntakeItem(mix.item_id))!
  assert.deepEqual([mixRow.status, mixRow.no_ai_reason, mixRow.ai_blocked_reason], ['no_ai', 'mix_ratio', 'mix_ratio'])
  await assert.rejects(repo.recordAttachmentAiSend(mix.attachment_id, 'm'), /ai_excluded/, '배합비 원본이 AI 전송 문을 지난다')
  await assert.rejects(repo.updateIntakeItem(mix.item_id, { status: 'proposed' }, staff), /intake_ai_unblock_forbidden/)
  step('글자 파일 — 배합비 감지가 AI 전에 건다(no_ai · mix_ratio · 차단 · AI 전송 거부 · 직원이 못 풂)')

  const price = await upload('원료 단가표.xlsx', XLSX, await xlsx([['원료명', '규격', '단가', '구입처'], ['옥수수', '25kg', 18500, '가'], ['대두박', '25kg', 21000, '나'], ['밀기울', '20kg', 9800, '다']]))
  assert.equal((await readIntake(repo, price.item_id, staff)).status, 'proposed')
  assert.equal((await repo.getIntakeItem(price.item_id))!.proposal?.kind, 'price_list')
  step('단가표 — 감지를 지나 dummy 제안(키 없음)')

  const photo = await upload('명함.jpg', 'image/jpeg', JPG)
  assert.equal((await readIntake(repo, photo.item_id, staff)).status, 'no_ai')
  as('support_lead')
  await assert.rejects(repo.updateIntakeItem(photo.item_id, { mix_attested: true }, lead), /intake_mix_attest_uploader_only/)
  as('sales_staff')
  await repo.updateIntakeItem(photo.item_id, { mix_attested: true }, staff)
  assert.equal((await repo.getIntakeItem(photo.item_id))!.status, 'reading')
  assert.equal((await readIntake(repo, photo.item_id, staff)).status, 'proposed')
  step('사진 — 확인 없으면 no_ai · not_attested · 팀장은 확인 못 함 · 올린 사람의 확인이 풀고(reading) 읽는다')

  const photo2 = await upload('영수증.jpg', 'image/jpeg', JPG)
  await readIntake(repo, photo2.item_id, staff)
  as('support_lead')
  await repo.updateIntakeItem(photo2.item_id, { status: 'no_ai', no_ai_reason: 'mix_ratio' }, lead)
  as('sales_staff')
  await repo.updateIntakeItem(photo2.item_id, { mix_attested: true }, staff)
  const p2 = (await repo.getIntakeItem(photo2.item_id))!
  assert.deepEqual([p2.status, p2.ai_blocked_reason], ['no_ai', 'mix_ratio'])
  step('N1 — 팀장이 not_attested를 mix_ratio로 조이면 올린 사람의 확인이 풀지 못한다')

  await assert.rejects(repo.updateIntakeItem(price.item_id, { status: 'uploaded' }, staff), /intake_status_back_to_uploaded/)
  step('M1 — uploaded로 되돌아가지 못한다')

  await assert.rejects(repo.moveIntakeToDocument('itk_seed_contract', { title: '원료 공급계약서', doc_type: 'Contract' }, staff), /intake_kind_missing|intake_document_write_forbidden/)
  as('support_lead')
  await repo.updateIntakeItem('itk_seed_contract', { kind: 'contract' }, lead)
  as('sales_staff')
  await assert.rejects(repo.moveIntakeToDocument('itk_seed_contract', { title: '원료 공급계약서', doc_type: 'Contract' }, staff), /intake_document_write_forbidden/)
  as('support_lead')
  const docId = await repo.moveIntakeToDocument('itk_seed_contract', { title: '원료 공급계약서', doc_type: 'Contract' }, lead)
  const doc = (await repo.listDocuments()).find((d) => d.document_id === docId)!
  assert.equal(doc.storage_url, `/documents/${docId}`)
  const loaded = (await repo.getIntakeItem('itk_seed_contract'))!
  assert.equal(loaded.status, 'loaded')
  assert.equal((await repo.listAttachments('documents', docId)).length, 1)
  await assert.rejects(repo.moveIntakeToDocument('itk_seed_contract', { title: 'x', doc_type: 'Contract' }, lead), /intake_already_loaded/)
  as('chairman')
  await assert.rejects(repo.deleteAttachment(loaded.attachment_id, chair), /row-level security/, '적재된 원본을 지운다')
  as('support_lead')
  await assert.rejects(repo.moveIntakeToDocument(mix.item_id, { title: 'x', doc_type: 'Other' }, lead), /intake_ai_blocked/)
  step('적재 — 문서 줄 없는 직원 거부 · 경영지원팀장 → 문서(/documents/<id> 링크 · 원본은 문서 첨부) · 두 번 거부 · 적재 원본 삭제 거부 · 차단 줄 거부')

  as('sales_staff')
  await assert.rejects(repo.deleteDocument(docId, staff), /row-level security/)
  as('support_lead')
  await repo.deleteDocument(docId, lead)
  const back = (await repo.getIntakeItem('itk_seed_contract'))!
  assert.deepEqual([back.status, back.loaded_id], ['proposed', null])
  assert.equal((await repo.listAttachments('intake_items', 'itk_seed_contract')).length, 1)
  assert.ok(!(await repo.listDocuments()).some((d) => d.document_id === docId))
  step('되돌리기 — 적재하지 않은 직원은 못 함 · 적재한 사람 → 문서 지움 · 줄은 proposed · 원본은 입구로')

  as('sales_staff')
  const sha = 'd'.repeat(64)
  const pdf = new TextEncoder().encode('x').buffer as ArrayBuffer
  const a1 = await upload('a.pdf', 'application/pdf', pdf, sha)
  const a2 = await upload('b.pdf', 'application/pdf', pdf, sha)
  assert.deepEqual((await repo.intakeSameFile(a2.item_id)).map((x) => x.item_id), [a1.item_id])
  step('같은 파일 알림 — 같은 sha256')
  delete process.env.DUMMY_USER
}

dummyFlow()
  .then(() => console.log(`PASS: ${passed} intake checks (배합비 감지 ⓑ/ⓐ+ⓒ · 알려진 한계 · 분류 해석 · 화면 규칙 · 실패 문장 · dummy 흐름: 감지 · 확인 · N1 조이기 · M1 · 적재 · 되돌리기 · 같은 파일)`))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
