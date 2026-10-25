/**
 * 0097 대표 첫 화면 구역 · 위젯 검사 — DB · 네트워크 · AI 없음: npm run check:dashboard
 *   (화면 · HTTP 403 · 폰 390은 scripts/shot-dashboard.ts, DB 문은 check-dashboard-db.ts가 check:migrations 안에서 본다)
 *
 *   1) 카탈로그: 엔진 하나(0086 WIDGETS에 이어 붙음) · 대표 전용 종류 = DB home_kind_allowed 목록(SQL 파일과 대조) · «준비 중» 넷 · «회장» 없음.
 *   2) 기본 배치: 대표 = 오늘의 경영 · 재무 지표 · 투자 · 아침 브리핑(승인 대기 포함) · CFO · 직원 = 구역 하나(0086 기본 배치).
 *   3) 정규화: 판 1(0086) → 직원 구역 하나 / 대표 기본 + «내 홈» · 판 2 왕복 · 모르는 판 = 기본 · 모르는 종류 보존 · 구역 사이 id 겹침.
 *   4) 편집 도구: 구역 만들기 · 이름 · 앞뒤 · 숨김 · 지우기 · 위젯 추가(구역마다 한 번 · 준비 중 못 넣음) · 구역 사이 옮기기 · 같은 종류 있으면 거부 ·
 *      되돌리기에 쓰는 «같은가» · 저장 모양 = DB(열넷) · 저장 규칙(충돌 · 종류 문 · A/B 분리).
 *   5) 범위: 구역 범위 물려받기 · 위젯 덮어쓰기 · 범위와 무관한 위젯은 전체.
 *   6) 문: 대표 = 전부 · 직원 = 재무 · 투자 · 대표 전용이 목록에도 없음 · 넣을 수도 없음 · 데이터 함수도 거부.
 *   7) dummy 실제 조회(대표): 위젯 전부 오류 없음 · 회사 범위를 바꾸면 숫자 · 건수가 같이 바뀐다 · 한 위젯 실패해도 나머지 정상 ·
 *      직원(A) 위젯에 금액 · 재무 낱말 없음 · 구역 저장 A(대표) · B(직원) 분리.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

process.env.NEXT_PUBLIC_DATA_MODE = 'dummy'
process.env.NEXT_PUBLIC_SUPABASE_URL = ''
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ''
delete process.env.DUMMY_HOME_STATE
delete process.env.DUMMY_HOME_FAIL
delete process.env.DUMMY_HOME_WIDGET_FAIL

let passed = 0
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const ROOT = join(__dirname, '..')

async function main() {
  process.env.DUMMY_HOME_OPEN = 'biz_dy'
  process.env.DUMMY_EA_OPEN = 'biz_dy'
  const H = await import('../src/lib/home/widgets')
  const B = await import('../src/lib/home/board')
  const { BOARD_WIDGETS } = await import('../src/lib/dashboard/catalog')

  console.log('카탈로그')
  await ok('엔진 하나 — 0086 WIDGETS 뒤에 대표 위젯이 이어 붙고 종류 겹침 없음 · 이름에 «회장» 없음', () => {
    assert.equal(new Set(H.WIDGETS.map((w) => w.kind)).size, H.WIDGETS.length)
    for (const w of BOARD_WIDGETS) assert.ok(H.widgetDef(w.kind) === w, `${w.kind}가 엔진 카탈로그에 없다`)
    for (const w of H.WIDGETS) assert.doesNotMatch(`${w.label} ${w.description}`, /회장|Chairman/, w.kind)
    assert.deepEqual(H.STAFF_WIDGETS.map((w) => w.kind), ['my_tasks', 'approvals', 'schedule', 'requested', 'attendance', 'favorites', 'notices', 'recent_docs', 'facility', 'projects'])
  })
  await ok('대표 전용 종류 = DB home_kind_allowed(0097) 목록 — 재무(top) · 투자(invest) · 대표(chair)', () => {
    const sql = readFileSync(join(ROOT, 'supabase', 'migrations', '0097_home_sections.sql'), 'utf8')
    const list = (re: RegExp) => [...(re.exec(sql)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    const of = (a: string) => BOARD_WIDGETS.filter((w) => w.audience === a && !w.listOnly).map((w) => w.kind).sort()
    assert.deepEqual(list(/when p_kind in \(([^)]+)\)\s+then coalesce\(auth_role\(\)::text, ''\) in \('Chairman', 'GroupCFO'\)/), of('top'))
    assert.deepEqual(list(/when p_kind in \(([^)]+)\)\s+then coalesce\(inv_reader\(\), false\)/), of('invest'))
    assert.deepEqual(list(/when p_kind in \(([^)]+)\)\s+then coalesce\(auth_role\(\)::text, ''\) = 'Chairman'/), of('chair'))
  })
  await ok('«준비 중»(목록에만) 넷 — 환율 띠 · 관심종목 시세 · 주요 리스크 · 데이터룸 · 넣을 수 없음', () => {
    assert.deepEqual(H.WIDGETS.filter((w) => w.listOnly).map((w) => w.label), ['환율 띠', '관심종목 시세', '주요 리스크', '데이터룸'])
    const one = [{ ...B.defaultBoard('chair')[0] }]
    assert.ok(B.sameBoard(B.addWidget(one, 'today', 'fx_strip'), one), '준비 중 위젯이 들어갔다')
  })

  console.log('기본 배치')
  await ok('대표 = 오늘의 경영(판단 · 승인 대기) · 재무 지표 · 투자 · 아침 브리핑 — 저장 모양 = DB', () => {
    const d = B.defaultBoard('chair')
    assert.deepEqual(d.map((s) => s.title), ['오늘의 경영', '재무 지표', '투자', '아침 브리핑'])
    assert.deepEqual(d[0].widgets.map((w) => w.kind), ['ai_judgment', 'approvals'])
    assert.deepEqual(d[1].widgets.map((w) => w.kind), ['fin_kpis', 'cash_forecast', 'fin_checklist', 'companies'])
    assert.deepEqual(d[2].widgets.map((w) => w.kind), ['inv_kpis', 'inv_buy_zone', 'inv_monthly'])
    assert.deepEqual(d[3].widgets.map((w) => w.kind), ['inv_brief', 'inv_alerts'])
    for (const p of ['chair', 'cfo', 'staff'] as const) assert.ok(B.boardValid(B.boardForSave(B.defaultBoard(p))), p)
  })
  await ok('직원 = 구역 하나(0086 기본 배치 그대로) · CFO = 재무 지표 + 내 업무 · 역할 → 기본', () => {
    const s = B.defaultBoard('staff')
    assert.equal(s.length, 1)
    assert.deepEqual(s[0].widgets.map((w) => `${w.kind}:${w.size}`), H.defaultLayout().map((w) => `${w.kind}:${w.size}`))
    assert.deepEqual(B.defaultBoard('cfo').map((x) => x.id), ['finance', 'main'])
    assert.deepEqual(['Chairman', 'GroupCFO', 'Member', 'BusinessCEO', null].map(B.personaOf), ['chair', 'cfo', 'staff', 'staff', 'staff'])
  })

  console.log('정규화')
  const legacy = { revision: 3, schema_version: 1, widgets: [{ id: 'my_tasks', kind: 'my_tasks', size: 'l', settings: { filter: 'week' } }, { id: 'old', kind: 'retired', size: 's', settings: {} }] }
  await ok('판 1(0086) — 직원은 구역 하나로 · 모르는 종류 보존', () => {
    const n = B.normalizeBoard(legacy, 'staff')
    assert.equal(n.usedDefault, false)
    assert.deepEqual(n.sections.map((s) => [s.id, s.widgets.map((w) => `${w.kind}:${w.size}:${w.settings.filter}`), s.unknown.map((w) => w.kind)]), [['main', ['my_tasks:l:week'], ['retired']]])
    assert.deepEqual(B.boardForSave(n.sections)[0].widgets.map((w) => w.kind), ['my_tasks', 'retired'], '모르는 종류가 저장에서 빠졌다')
  })
  await ok('판 1(0086) — 대표는 기본 구역 넷 뒤에 «내 홈»(0086에서 고친 배치를 잃지 않음 · id 겹침 없음)', () => {
    const n = B.normalizeBoard(legacy, 'chair')
    assert.deepEqual(n.sections.map((s) => s.title), ['오늘의 경영', '재무 지표', '투자', '아침 브리핑', '내 홈'])
    assert.ok(B.boardValid(B.boardForSave(n.sections)))
  })
  await ok('판 2 왕복 · 줄 없음 · 모르는 판 = 기본 · 틀린 구역 버림 · 구역 사이 위젯 id 겹침은 뒤의 것 버림', () => {
    const saved = B.boardForSave(B.defaultBoard('chair'))
    const back = B.normalizeBoard({ revision: 1, schema_version: 2, widgets: [], sections: saved }, 'chair')
    assert.ok(B.sameBoard(back.sections, B.defaultBoard('chair')))
    assert.equal(B.normalizeBoard({ revision: 0, schema_version: null, widgets: null }, 'chair').usedDefault, true)
    assert.equal(B.normalizeBoard({ revision: 1, schema_version: 3, widgets: [], sections: saved }, 'staff').usedDefault, true)
    const odd = B.normalizeBoard({ revision: 1, schema_version: 2, widgets: [], sections: [{ id: 'a', title: '가', widgets: [{ id: 'x', kind: 'my_tasks', size: 's' }] }, { id: 'b', title: '나', widgets: [{ id: 'x', kind: 'schedule', size: 's' }] }, { id: 'c', title: '' }, 'junk'] }, 'staff')
    assert.deepEqual(odd.sections.map((s) => [s.id, s.widgets.map((w) => w.id)]), [['a', ['x']], ['b', []]])
    assert.deepEqual(B.normalizeBoard({ revision: 1, schema_version: 2, widgets: [], sections: [] }, 'chair').sections, [], '빈 배치(전부 지운 사람)는 빈 화면')
  })

  console.log('편집 도구')
  await ok('구역 만들기 · 이름 · 앞뒤 · 숨김 · 지우기 · 12개 한도', () => {
    let d = B.defaultBoard('chair')
    d = B.addSection(d, '계열사 상황실', 1)
    assert.deepEqual(d.map((s) => s.title), ['오늘의 경영', '계열사 상황실', '재무 지표', '투자', '아침 브리핑'])
    const id = d[1].id
    d = B.renameSection(d, id, '  상황실  ')
    assert.equal(d[1].title, '상황실')
    assert.equal(B.renameSection(d, id, '   ')[1].title, '상황실', '빈 이름으로 바뀌었다')
    d = B.moveSection(d, 1, 1)
    assert.equal(d[2].id, id)
    d = B.patchSection(d, id, (s) => ({ ...s, hidden: true }))
    assert.equal(d.find((s) => s.id === id)!.hidden, true)
    assert.equal(B.removeSection(d, id).length, 4)
    let many = B.defaultBoard('staff')
    for (let i = 0; i < 20; i++) many = B.addSection(many, `구역 ${i}`)
    assert.equal(many.length, B.MAX_SECTIONS)
  })
  await ok('위젯 추가(구역마다 한 번 · 다른 구역엔 같은 종류 가능 · id 배치 전체에서 하나) · 제거 · 구역 사이 옮기기', () => {
    let d = B.addSection(B.defaultBoard('chair'), '상황실', 1)
    const room = d[1].id
    d = B.addWidget(d, room, 'fin_kpis')
    d = B.addWidget(d, room, 'fin_kpis')
    assert.equal(d[1].widgets.length, 1, '같은 구역에 같은 위젯 두 번')
    assert.notEqual(d[1].widgets[0].id, 'fin_kpis', '다른 구역의 같은 종류와 id가 겹쳤다')
    assert.ok(B.boardValid(B.boardForSave(d)))
    const moved = B.transferWidget(d, { section: 'finance', index: 3 }, { section: room })
    assert.equal(moved.ok, true)
    assert.deepEqual(moved.sections[1].widgets.map((w) => w.kind), ['fin_kpis', 'companies'])
    assert.deepEqual(moved.sections[2].widgets.map((w) => w.kind), ['fin_kpis', 'cash_forecast', 'fin_checklist'])
    const dup = B.transferWidget(moved.sections, { section: 'finance', index: 0 }, { section: room })
    assert.equal(dup.ok, false, '받는 구역에 같은 종류가 있는데 옮겨졌다')
    const at0 = B.transferWidget(moved.sections, { section: 'today', index: 1 }, { section: room, index: 0 })
    assert.deepEqual(at0.sections[1].widgets.map((w) => w.kind), ['approvals', 'fin_kpis', 'companies'], '놓은 자리')
    const within = B.transferWidget(moved.sections, { section: 'finance', index: 0 }, { section: 'finance', index: 2 })
    assert.deepEqual(within.sections[2].widgets.map((w) => w.kind), ['cash_forecast', 'fin_checklist', 'fin_kpis'])
    assert.deepEqual(B.nudgeWidget(moved.sections, 'finance', 1, -1)[2].widgets.map((w) => w.kind), ['cash_forecast', 'fin_kpis', 'fin_checklist'])
    assert.equal(B.removeWidget(moved.sections, room, moved.sections[1].widgets[0].id)[1].widgets.length, 1)
  })
  await ok('저장 모양 = DB home_sections_valid(열넷과 같은 거부)', () => {
    const sec = (id: string, kinds: string[], extra: object = {}, prefix = id) => ({ id, title: `구역 ${id}`, hidden: false, collapsed: false, scope: { biz: 'all' }, widgets: kinds.map((k, i) => ({ id: `${prefix}-${k}-${i}`, kind: k, size: 's', settings: {} })), ...extra })
    const bad: unknown[] = [
      {},
      Array.from({ length: 13 }, (_, i) => sec(`s${i}`, [])),
      [sec('a', ['my_tasks'], {}, 'x'), sec('b', ['my_tasks'], {}, 'x')],
      [sec('a', []), sec('a', [])],
      [sec('a', [], { title: '  ' })],
      [sec('a', [], { title: 'ㄱ'.repeat(41) })],
      [sec('a', [], { hidden: 'yes' })],
      [sec('a', [], { scope: [] })],
      Array.from({ length: 3 }, (_, i) => ({ ...sec(`s${i}`, []), widgets: Array.from({ length: 21 }, (_, j) => ({ id: `w${i}-${j}`, kind: 'my_tasks', size: 's', settings: {} })) })),
      [{ id: 'a', title: '제목' }],
      [sec('A B', [])],
    ]
    for (const v of bad) assert.equal(B.boardValid(v), false, JSON.stringify(v).slice(0, 120))
    assert.equal(B.boardValid([]), true)
    // 범위 모양이 틀리면 저장 전에 버린다(DB는 거부) — boardForSave는 늘 DB가 받는 모양을 낸다.
    const fixed = B.boardForSave([{ ...B.defaultBoard('staff')[0], scope: { biz: 'Bad Biz' } as never }])
    assert.deepEqual(fixed[0].scope, { biz: 'all' })
  })
  await ok('저장 규칙(0097 거울) — 처음 0 · 충돌 · 종류 문 · A 저장이 B에 영향 없음 · 판 2', () => {
    const rows = new Map<string, import('../src/lib/home/board').BoardRow>()
    const chair = B.boardForSave(B.defaultBoard('chair'))
    const staff = B.boardForSave(B.defaultBoard('staff'))
    assert.equal(B.saveBoardIn(rows, 'A', 0, chair, () => true), 1)
    assert.throws(() => B.saveBoardIn(rows, 'A', 0, chair, () => true), /home_conflict/)
    assert.throws(() => B.saveBoardIn(rows, 'B', 0, chair, (k) => H.audienceOf(H.widgetDef(k)!) === 'all'), /home_kind_denied/)
    assert.equal(B.saveBoardIn(rows, 'B', 0, staff, () => true), 1)
    assert.equal(rows.get('A')!.sections!.length, 4, 'B 저장이 A를 바꿨다')
    assert.equal(rows.get('B')!.schema_version, 2)
    assert.equal(B.saveBoardIn(rows, 'A', 1, chair, () => true), 2)
  })

  console.log('범위')
  await ok('구역 범위 물려받기 · 위젯 덮어쓰기 · 회사를 바꾸면 그 구역 프로젝트는 따르지 않음 · 범위와 무관한 위젯은 전체', () => {
    const s = { scope: { biz: 'biz_dy', project: 'P-1' } }
    assert.deepEqual(B.effectiveScope(s, { kind: 'fin_kpis', settings: {} }), { biz: 'biz_dy', project: null, overridden: false })
    assert.deepEqual(B.effectiveScope(s, { kind: 'projects', settings: {} }), { biz: 'biz_dy', project: 'P-1', overridden: false })
    assert.deepEqual(B.effectiveScope(s, { kind: 'projects', settings: { scope: { biz: 'biz_vana' } } }), { biz: 'biz_vana', project: null, overridden: true })
    assert.deepEqual(B.effectiveScope(s, { kind: 'fin_kpis', settings: { scope: { biz: 'all' } } }), { biz: 'all', project: null, overridden: true })
    assert.deepEqual(B.effectiveScope(s, { kind: 'inv_kpis', settings: { scope: { biz: 'biz_vana' } } }), { biz: 'all', project: null, overridden: false })
    // 범위와 무관한 위젯에는 저장 때 범위를 싣지 않는다.
    assert.equal(H.layoutForSave([{ id: 'i', kind: 'inv_kpis', size: 'l', settings: { scope: { biz: 'biz_dy' } } }])[0].settings.scope, undefined)
    assert.deepEqual(H.layoutForSave([{ id: 'f', kind: 'fin_kpis', size: 'l', settings: { scope: { biz: 'biz_dy' } } }])[0].settings.scope, { biz: 'biz_dy' })
  })

  console.log('문 · dummy 실제 조회')
  const { dummyViewer } = await import('../src/lib/repository/dummy-org')
  const D = await import('../src/lib/home/data')
  const W = await import('../src/lib/dashboard/widgets')
  const { homeStore } = await import('../src/lib/home/store')
  const as = async (key: string) => {
    process.env.DUMMY_USER = key
    const p = dummyViewer()
    const user = { user_id: p.user_id, name: p.display_name, role: p.role, title_ko: p.title_ko, display_name_en: p.display_name_en, language: 'ko' as const, finance: {}, ledger: [], investment: p.role === 'Chairman' }
    return { key, user, access: await D.homeAccess(user) }
  }
  const chair = await as('chairman')
  const staff = await as('sales_staff')
  const boardKinds = BOARD_WIDGETS.filter((w) => !w.listOnly).map((w) => w.kind)

  await ok('대표 = 문 전부 열림 · 라이브러리에 대표 위젯 · 준비 중 넷', () => {
    assert.deepEqual(chair.access, { home: true, approvals: true, top: true, chair: true, investment: true, memory: true })
    const lib = D.libraryKinds(chair.access)
    for (const k of [...boardKinds, 'fx_strip', 'data_room']) assert.ok(lib.includes(k), k)
    for (const k of boardKinds) assert.ok(D.kindAllowed(chair.access, k), k)
  })
  await ok('직원 = 재무 · 투자 · 대표 전용 위젯이 목록에도 없고 넣을 수도 없다 · 데이터 함수도 거부', async () => {
    process.env.DUMMY_USER = staff.key
    const lib = D.libraryKinds(staff.access)
    for (const k of [...boardKinds, 'fx_strip', 'watch_quotes', 'key_risks', 'data_room']) {
      assert.ok(!lib.includes(k), `직원 목록에 ${k}`)
      assert.ok(!D.kindAllowed(staff.access, k), `직원이 ${k}를 넣는다`)
    }
    for (const k of boardKinds) {
      const d = await W.boardWidgetData(staff.user, staff.access, k, undefined, { biz: 'all', project: null })
      assert.equal(d.state, k === 'fx_strip' ? 'pending' : 'denied', `${k}: ${JSON.stringify(d).slice(0, 120)}`)
    }
    assert.ok(lib.includes('projects') && lib.includes('my_tasks'))
  })
  await ok('직원 위젯(범위 포함)에 금액 · 재무 낱말 없음 · 오류 없음', async () => {
    process.env.DUMMY_USER = staff.key
    for (const w of H.STAFF_WIDGETS) {
      for (const biz of ['all', 'biz_dy']) {
        const d = await W.boardWidgetData(staff.user, staff.access, w.kind, undefined, { biz, project: null })
        const json = JSON.stringify(d)
        assert.doesNotMatch(json, /"amount"|급여|원가|BOM|단가|EBITDA|매출|영업이익|회장/, `${w.kind}/${biz}: ${json.slice(0, 160)}`)
        assert.notEqual(d.state, 'error', `${w.kind}/${biz}`)
      }
    }
  })

  process.env.DUMMY_USER = chair.key
  const get = (k: string, biz = 'all') => W.boardWidgetData(chair.user, chair.access, k, H.widgetDef(k)!.filters[0]?.key, { biz, project: null })
  await ok('대표 위젯 전부 — 오류 없음 · 숫자 칸은 글자 · 지어낸 값 없음(없으면 «자료 부족» · NEED DATA)', async () => {
    for (const k of boardKinds) {
      const d = await get(k)
      assert.notEqual(d.state, 'error', `${k}: ${JSON.stringify(d).slice(0, 200)}`)
      assert.notEqual(d.state, 'denied', k)
      if (d.state === 'ok') for (const s of d.stats ?? []) assert.equal(typeof s.value, 'string')
    }
  })
  await ok('회사 범위를 바꾸면 숫자와 건수가 같이 바뀐다(계열사 현황 · 재무 지표 · 자료 체크표 · 오늘의 경영 판단)', async () => {
    const all = await get('companies')
    const dy = await get('companies', 'biz_dy')
    assert.ok(all.state === 'ok' && dy.state === 'ok')
    assert.ok(all.count > 1 && dy.count === 1, `계열사 현황 건수 ${all.count} → ${dy.count}`)
    assert.equal(dy.table!.rows.length, 1)
    const fa = await get('fin_kpis')
    const fd = await get('fin_kpis', 'biz_dy')
    assert.ok(fa.state === 'ok' && fd.state === 'ok')
    assert.match(fa.basis!, /전체 계열사 \d+곳 합계/)
    assert.doesNotMatch(fd.basis!, /전체 계열사/)
    assert.notEqual(fa.count, fd.count, '재무 지표 회사 수(건수)가 그대로')
    const ca = await get('fin_checklist')
    const cd = await get('fin_checklist', 'biz_dy')
    assert.ok(ca.state === 'ok' && cd.state === 'ok' && ca.count !== cd.count, `자료 체크표 건수 ${ca.state === 'ok' ? ca.count : '?'} → ${cd.state === 'ok' ? cd.count : '?'}`)
    const ja = await get('ai_judgment')
    const jd = await get('ai_judgment', 'biz_dy')
    assert.ok(ja.state === 'ok' && jd.state === 'ok' && jd.count < ja.count, '오늘의 경영 판단 건수가 회사 범위로 줄지 않았다')
  })
  await ok('위젯 하나 실패(DUMMY_HOME_WIDGET_FAIL=fin_kpis) — 그 위젯만 «실패», 나머지 정상', async () => {
    process.env.DUMMY_HOME_WIDGET_FAIL = 'fin_kpis'
    try {
      assert.equal((await get('fin_kpis')).state, 'error')
      for (const k of ['companies', 'inv_kpis', 'ai_judgment', 'approvals']) assert.equal((await get(k)).state, 'ok', k)
    } finally {
      delete process.env.DUMMY_HOME_WIDGET_FAIL
    }
  })
  await ok('구역 저장(dummy 저장소) — 대표 A · 직원 B 서로 안 섞임 · 다시 읽으면 그대로 · 직원 재무 위젯 저장 거부', async () => {
    process.env.DUMMY_USER = chair.key
    const sa = await homeStore()
    const ra = await sa.read()
    const mineA = B.addSection(B.defaultBoard('chair'), '계열사 상황실', 1)
    const revA = await sa.saveSections(ra.revision, B.boardForSave(mineA), (k) => D.kindAllowed(chair.access, k))
    process.env.DUMMY_USER = staff.key
    const sb = await homeStore()
    const rb = await sb.read()
    assert.notEqual(rb.schema_version === 2 && JSON.stringify(rb.sections).includes('계열사 상황실'), true, '직원이 대표 배치를 읽었다')
    await assert.rejects(sb.saveSections(rb.revision, B.boardForSave(B.defaultBoard('chair')), (k) => D.kindAllowed(staff.access, k)), /home_kind_denied/)
    await sb.saveSections(rb.revision, B.boardForSave(B.defaultBoard('staff')), (k) => D.kindAllowed(staff.access, k))
    process.env.DUMMY_USER = chair.key
    const again = await (await homeStore()).read()
    assert.equal(again.revision, revA)
    assert.deepEqual(B.normalizeBoard(again, 'chair').sections.map((s) => s.title), ['오늘의 경영', '계열사 상황실', '재무 지표', '투자', '아침 브리핑'])
  })

  console.log(`PASS: ${passed} dashboard checks (카탈로그 = DB 문 · 기본 배치 · 판 1/2 정규화 · 편집 도구 · 모양 = DB · 저장 규칙 · 범위 · 문(직원 목록 · 추가 · 데이터 거부) · dummy 실제 조회 · 범위 → 숫자 · 건수 · 한 위젯 실패 · A/B 분리)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
