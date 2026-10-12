/**
 * 0071 프로세스 차트 동기화 (오프라인 — 진짜 구글 · DB 없음): npm run check:process-sync
 *
 * 무엇을 재나 — 가짜 시트 응답 + dummy 흉내 writer(lib/repository/dummy-process-sync.ts, 0071 SQL을 옮겨 적은 것):
 *   1) 제목 줄을 이름으로 찾는다(순서가 달라도) · 제목 줄이 없으면 시트 전체 거부(실패 기록)
 *   2) ID 없음 → 건너뜀 + 경고 · 날짜 틀림 → 건너뜀 + 경고 · 상태 낱말 틀림 → «예정» + 경고 · 같은 ID 두 번 → 두 번째 건너뜀
 *   3) 새 줄 · 담당자 못 찾음(«담당 미정» + 경고) · 출처 «프로세스 차트 · <팀>»
 *   4) 두 번 동기화해도 안 늘어남(새로 0 · 바뀜 0)
 *   5) 바뀐 줄 · 사라진 줄(지우지 않고 «시트에서 사라짐») · 다시 나타나면 되살림
 *   6) 같은 팀 1분에 1번 · 못 보는 탭 거부 · 연결 전 거부
 *   7) 시트 ID 입력(편집 주소 → ID, 게시 주소 거부) · 탭 이름
 * SQL 쪽 같은 시나리오는 docs/onboarding/staging-tests/0071_staging_test.sql(PGlite: check:staging-sql-cost)이 잰다.
 */
import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'

import { parseSheetId, parseSheetTab } from '../src/lib/process-chart'
import { parseProcessSheet, parseSheetDate } from '../src/lib/process-sync/parse'
import { fakeSheetsReader } from '../src/lib/process-sync/fake'
import { sheetRange, signServiceAccountJwt } from '../src/lib/process-sync/google'
import { runProcessSync, type ProcessSyncTarget } from '../src/lib/process-sync/run'
import { DUMMY_UID } from '../src/lib/repository/dummy-org'
import {
  dummyListProcessChartItems,
  dummyListProcessChartSyncs,
  dummyProcessStore,
  dummyProcessSyncWriter,
  dummyProcessTasks,
  resetDummyProcessStore,
} from '../src/lib/repository/dummy-process-sync'
import { DUMMY_PEOPLE } from '../src/lib/repository/dummy-org'

const H = ['비고', '상태', '마감일', '시작일', '담당자 이메일', '업무명', '단계', 'ID'] // 일부러 거꾸로
const row = (o: { id: string; stage?: string; title?: string; email?: string; start?: string; due?: string; status?: string; note?: string }) =>
  [o.note ?? '', o.status ?? '', o.due ?? '', o.start ?? '', o.email ?? '', o.title ?? '', o.stage ?? '', o.id]

function parsing() {
  assert.equal(parseSheetDate(''), null)
  assert.equal(parseSheetDate('2026-10-12'), '2026-10-12')
  assert.equal(parseSheetDate('2026. 10. 2'), '2026-10-02')
  assert.equal(parseSheetDate('2026/1/5'), '2026-01-05')
  assert.equal(parseSheetDate('2026-02-30'), undefined, '없는 날짜')
  assert.equal(parseSheetDate('10월 둘째 주'), undefined)

  const p = parseProcessSheet([
    ['제목 줄 위의 설명'],
    H,
    row({ id: 'A-1', title: '첫 업무', email: 'sales.staff@dy.example', start: '2026-10-12', due: '2026-10-15', status: '진행' }),
    row({ id: '', title: 'ID 없음' }),
    row({ id: 'A-3', title: '날짜 틀림', start: '내일' }),
    row({ id: 'A-4', title: '상태 틀림', status: '대기' }),
    row({ id: 'A-1', title: '같은 ID' }),
    row({ id: 'A-6', title: '' }),
    ['', '', ''],
  ])
  assert.equal(p.headerProblem, null)
  assert.equal(p.read, 6, '빈 줄은 세지 않는다')
  assert.equal(p.skipped, 4, 'ID 없음 · 날짜 틀림 · 같은 ID · 업무명 없음')
  assert.deepEqual(p.rows.map((r) => r.id), ['A-1', 'A-4'])
  assert.equal(p.rows[1].status, '예정', '상태 낱말 틀림 → 예정')
  assert.equal(p.warnings.length, 5, '건너뜀 4 + 상태 경고 1')
  assert.ok(p.warnings.some((w) => /ID가 없어/.test(w.message)))
  assert.ok(p.warnings.some((w) => /날짜 형식/.test(w.message) && w.id === 'A-3'))
  assert.ok(p.warnings.some((w) => /«대기»/.test(w.message)))
  assert.deepEqual(p.rows[0], { id: 'A-1', stage: '', title: '첫 업무', email: 'sales.staff@dy.example', start: '2026-10-12', due: '2026-10-15', status: '진행', note: '' })

  assert.match(parseProcessSheet([['단계', '업무명'], ['x', 'y']]).headerProblem ?? '', /제목 줄/)
  assert.match(parseProcessSheet([['ID', '단계'], ['1', 'x']]).headerProblem ?? '', /업무명/)
}

async function syncing() {
  resetDummyProcessStore()
  let clock = Date.parse('2026-10-12T00:00:00Z')
  const tick = () => (clock += 61_000)
  const chart = { id: 3, business_id: 'biz_dy', team_name: '영업', sheet_id: 'fake-sheet-for-check-0001' }
  const writer = dummyProcessSyncWriter({ chartById: (id) => (id === 3 ? chart : undefined), now: () => clock })
  const target: ProcessSyncTarget = { chart_id: 3, business_id: 'biz_dy', team_name: '영업', sheet_id: chart.sheet_id, sheet_tab: null }
  let sheet: string[][] = [
    H,
    row({ id: 'S-1', title: '업무 1', email: 'sales.staff@dy.example', start: '2026-10-12', due: '2026-10-15', status: '진행' }),
    row({ id: 'S-2', title: '업무 2', email: 'nobody@dy.example', due: '2026-10-20' }),
    row({ id: 'S-3', title: '업무 3' }),
    row({ id: '', title: 'ID 없음' }),
    row({ id: 'S-5', title: '날짜 틀림', due: '13월 1일' }),
  ]
  const reader = { readValues: async () => sheet.map((r) => [...r]) }
  const lead = DUMMY_UID.salesLead
  const run = (trigger: 'button' | 'cron' = 'button') =>
    runProcessSync({ target, trigger, requestedBy: trigger === 'cron' ? null : lead, reader, writer })

  // 새 줄 3 · 건너뜀 2 · 담당 미정 경고 2(못 찾음 · 비어 있음)
  const r1 = await run()
  assert.ok(r1.ok, JSON.stringify(r1))
  if (!r1.ok) return
  assert.deepEqual(r1.result, { read: 5, new: 3, changed: 0, gone: 0, skipped: 2, warnings: 4 })
  const store = dummyProcessStore()
  assert.equal(store.items.length, 3)
  const s2 = store.items.find((i) => i.sheet_row_id === 'S-2')!
  assert.equal(s2.owner_user_id, null, '못 찾은 담당자 → 담당 미정')
  const t1 = dummyProcessTasks().find((t) => t.task.title === '업무 1')!
  assert.equal(t1.owner_user_id, DUMMY_UID.salesStaff)
  assert.equal(t1.task.status, 'Doing')
  assert.equal(t1.task.deadline, '2026-10-15')
  assert.equal(t1.task.source_label, '프로세스 차트 · 영업')
  assert.equal(dummyProcessTasks().length, 3)

  // 1분 안에 다시 → 거부(기록도 안 늘어난다)
  const tooSoon = await run()
  assert.ok(!tooSoon.ok && /1분에 한 번/.test(tooSoon.error))
  assert.equal(store.syncs.length, 1)

  // 두 번 동기화해도 안 늘어남
  tick()
  const r2 = await run('cron')
  assert.ok(r2.ok)
  if (!r2.ok) return
  assert.deepEqual([r2.result.new, r2.result.changed, r2.result.gone], [0, 0, 0])
  assert.equal(store.items.length, 3)
  assert.equal(dummyProcessTasks().length, 3)
  assert.equal(store.syncs[0].actor_user_id, null, '자동 = 누른 사람 없음')

  // 바뀐 줄(S-1 완료) · 사라진 줄(S-2)
  sheet = [H, row({ id: 'S-1', title: '업무 1', email: 'sales.staff@dy.example', start: '2026-10-12', due: '2026-10-15', status: '완료' }), row({ id: 'S-3', title: '업무 3' })]
  tick()
  const r3 = await run()
  assert.ok(r3.ok)
  if (!r3.ok) return
  assert.deepEqual([r3.result.new, r3.result.changed, r3.result.gone], [0, 1, 1])
  assert.equal(store.items.length, 3, '사라진 줄을 지우지 않는다')
  assert.ok(store.items.find((i) => i.sheet_row_id === 'S-2')!.gone_at)
  assert.ok(dummyProcessTasks().find((t) => t.task.title === '업무 2')!.task.source_gone_at, '업무에 «시트에서 사라짐»')
  assert.equal(dummyProcessTasks().find((t) => t.task.title === '업무 1')!.task.status, 'Done')

  // 다시 나타나면 되살린다(바뀜 1)
  sheet = [...sheet, row({ id: 'S-2', title: '업무 2', email: 'nobody@dy.example', due: '2026-10-20' })]
  tick()
  const r4 = await run()
  assert.ok(r4.ok && r4.result.changed === 1 && r4.result.gone === 0)
  assert.equal(store.items.find((i) => i.sheet_row_id === 'S-2')!.gone_at, null)

  // 제목 줄 없는 시트 → 실패 기록
  sheet = [['아무 제목'], ['x']]
  tick()
  const bad = await run()
  assert.ok(!bad.ok && /제목 줄/.test(bad.error))
  assert.equal(store.syncs[0].ok, false)

  // 못 보는 탭: 구매 직원이 영업 탭을 누름 → 거부
  sheet = [H, row({ id: 'S-1', title: '업무 1' })]
  tick()
  const other = await runProcessSync({ target, trigger: 'button', requestedBy: DUMMY_UID.buyStaff, reader, writer })
  assert.ok(!other.ok && /볼 수 없습니다/.test(other.error))

  // 연결 전(시트 ID 없음)
  const notConnected = await runProcessSync({ target: { ...target, sheet_id: null }, trigger: 'button', requestedBy: lead, reader, writer })
  assert.ok(!notConnected.ok && /연결 전/.test(notConnected.error))

  // 보기: 영업 직원은 영업 줄을 본다 · 구매 직원은 0 · 임원은 본다
  const person = (id: string) => DUMMY_PEOPLE.find((p) => p.user_id === id)!
  assert.equal(dummyListProcessChartItems(person(DUMMY_UID.salesStaff)).length, 3)
  assert.equal(dummyListProcessChartItems(person(DUMMY_UID.buyStaff)).length, 0)
  assert.equal(dummyListProcessChartItems(person(DUMMY_UID.exec)).length, 3)
  assert.equal(dummyListProcessChartSyncs(person(DUMMY_UID.buyStaff)).length, 0)

  // 가짜 시트(dummy 화면용)도 그대로 돈다
  resetDummyProcessStore()
  const fake = await runProcessSync({
    target: { chart_id: 3, business_id: 'biz_dy', team_name: '영업', sheet_id: 'dummy-sales-sheet-00000000001', sheet_tab: null },
    trigger: 'button',
    requestedBy: lead,
    reader: fakeSheetsReader(),
    writer: dummyProcessSyncWriter({ chartById: () => ({ ...chart, sheet_id: 'dummy-sales-sheet-00000000001' }) }),
  })
  assert.ok(fake.ok && fake.result.new === 5 && fake.result.skipped === 2, JSON.stringify(fake))
}

function sheetIdInput() {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'
  assert.equal(parseSheetId(''), null)
  assert.equal(parseSheetId(id), id)
  assert.equal(parseSheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id)
  assert.equal(parseSheetId('https://docs.google.com/spreadsheets/d/e/2PACX-1vTEST/pubhtml'), undefined, '게시 주소는 파일 ID가 아니다')
  assert.equal(parseSheetId('짧음'), undefined)
  assert.equal(parseSheetTab(''), null)
  assert.equal(parseSheetTab('업무'), '업무')
  assert.equal(parseSheetTab("a'b"), undefined)
}

/** 서비스 계정 JWT — 네트워크 없이 모양 · 범위(읽기 전용) · 서명만 잰다. */
function jwt() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const token = signServiceAccountJwt({ client_email: 'sync@example.iam.gserviceaccount.com', private_key: pem }, 1_000)
  const [h, b, sig] = token.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' })
  const body = JSON.parse(Buffer.from(b, 'base64url').toString())
  assert.equal(body.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly', '읽기 전용 범위만')
  assert.equal(body.aud, 'https://oauth2.googleapis.com/token')
  assert.equal(body.exp - body.iat, 3600)
  const v = createVerify('RSA-SHA256')
  v.update(`${h}.${b}`)
  assert.ok(v.verify(publicKey, Buffer.from(sig, 'base64url')), '서명이 맞지 않는다')
  assert.equal(sheetRange(null), 'A1:Z2001')
  assert.equal(sheetRange('업무'), "'업무'!A1:Z2001")
}

async function main() {
  parsing()
  jwt()
  await syncing()
  sheetIdInput()
  console.log('check:process-sync PASS — 제목 줄 · ID 없음 · 날짜 틀림 · 상태 · 새 줄 · 담당 미정 · 두 번 안 늘어남 · 바뀜 · 사라짐 · 1분 · 팀 보기 · 시트 ID')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
