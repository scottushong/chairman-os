/**
 * 0086 «내 홈» 검사 — DB · 네트워크 · AI 없음: npm run check:home-widgets
 *
 *   1) 카탈로그 · 기본 배치(지시문 3절) · 위젯 이름에 «회장» 없음.
 *   2) 정규화: 모르는 위젯은 건너뛰고 저장 때 그대로 돌려준다 · 같은 위젯 두 번째 · 모양 틀린 줄 버림 · 모르는 판 = 기본 배치 · 빈 배치 = 빈 홈.
 *   3) 저장 규칙(dummy = 0086 home_layout_save 거울): 처음 0 · 판 하나씩 · 옛 판 = 충돌 · A 저장이 B에 영향 없음 · 모양 검사 = DB와 같은 일곱.
 *   4) 편집 도구: 앞 · 뒤 · 끌어 놓기 · 같은지 판정 · 새 id.
 *   5) 고르기: 내 업무 필터(진행 중 · 이번 주 · 기한 지남)와 정렬 · 요청한 업무 · 이번 주 끝.
 *   6) 금지 숫자: 홈 코드(lib/home · components/home · /home 화면 · 서버 액션)에 급여 · 원가 · BOM · 단가 · 재무 숫자 · 결재 금액이 없다(주석 빼고) · 재무/원가 모듈을 import하지 않는다.
 *   7) 실제 dummy 조회: 직원 A(영업 직원) · B(영업 직원)로 위젯 아홉을 불러 — 금액 칸 없음 · 건수 = 같은 조건 목록 · 필터를 바꾸면 건수가 바뀐다 ·
 *      배치 저장(dummy 저장소)이 A · B 따로 · 충돌 · 스위치 꺼진 직원은 «내 홈» 없음 · 폰 하단 탭 «결재» → /e-approval(전자결재 켜진 사람만).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

process.env.NEXT_PUBLIC_DATA_MODE = 'dummy'
process.env.NEXT_PUBLIC_SUPABASE_URL = ''
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ''
delete process.env.DUMMY_HOME_STATE
delete process.env.DUMMY_HOME_FAIL

let passed = 0
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const ROOT = join(__dirname, '..')

async function main() {
  // DUMMY_HOME_OPEN · DUMMY_EA_OPEN은 dummy-features가 import 때 읽는다 — 그 전에 둔다(A · B = biz_dy 직원).
  process.env.DUMMY_HOME_OPEN = 'biz_dy'
  process.env.DUMMY_EA_OPEN = 'biz_dy'
  const H = await import('../src/lib/home/widgets')
  const { WIDGETS, defaultLayout, normalizeLayout, layoutForSave, layoutValid, saveLayoutIn, moveWidget, dropWidget, sameLayout, newWidgetId, pickMyTasks, pickRequested, weekEnd } = H

  console.log('카탈로그 · 기본 배치')
  await ok('위젯 아홉 · 종류 겹침 없음 · 이름 · 설명에 «회장» 없음 · 급여/원가/BOM/재무 위젯 없음', () => {
    assert.equal(new Set(WIDGETS.map((w) => w.kind)).size, WIDGETS.length)
    assert.deepEqual(WIDGETS.map((w) => w.kind), ['my_tasks', 'approvals', 'schedule', 'requested', 'attendance', 'favorites', 'notices', 'recent_docs', 'facility'])
    for (const w of WIDGETS) {
      assert.doesNotMatch(`${w.label} ${w.description}`, /회장|Chairman/, w.kind)
      assert.doesNotMatch(`${w.kind} ${w.label} ${w.description}`, /급여|원가|BOM|bom|단가|매출|손익|재무|payroll|cost|price/i, w.kind)
    }
    assert.equal(WIDGETS.find((w) => w.kind === 'attendance')!.link, 'pending', '근태는 연동 준비 중')
  })
  await ok('기본 배치 = 지시문 3절(내 업무 넓게 · 전자결재 / 일정 · 요청한 업무 · 근태 / 즐겨찾기)', () => {
    assert.deepEqual(defaultLayout().map((w) => `${w.kind}:${w.size}`), ['my_tasks:m', 'approvals:s', 'schedule:s', 'requested:s', 'attendance:s', 'favorites:s'])
    assert.ok(layoutValid(layoutForSave(defaultLayout())))
  })

  console.log('정규화')
  await ok('모르는 위젯은 건너뛰고 저장 때 그대로 · 같은 종류 두 번째 버림 · 모양 틀린 줄 버림 · 틀린 필터 = 첫 값', () => {
    const raw = [
      { id: 'a', kind: 'my_tasks', size: 'l', settings: { filter: 'week' } },
      { id: 'b', kind: 'retired_widget', size: 'm', settings: {} },
      { id: 'c', kind: 'my_tasks', size: 's' },
      { id: 'd', kind: 'approvals', size: 'huge' },
      { id: 'a', kind: 'schedule', size: 's' },
      { id: 'e', kind: 'schedule', size: 's', settings: { filter: 'nope' } },
      'junk',
    ]
    const n = normalizeLayout(raw, 1)
    assert.deepEqual(n.widgets.map((w) => `${w.id}:${w.kind}:${w.size}:${w.settings.filter ?? ''}`), ['a:my_tasks:l:week', 'e:schedule:s:today'])
    assert.deepEqual(n.unknown.map((w) => w.kind), ['retired_widget'])
    assert.equal(n.usedDefault, false)
    const out = layoutForSave(n.widgets, n.unknown)
    assert.deepEqual(out.map((w) => w.kind), ['my_tasks', 'schedule', 'retired_widget'], '모르는 위젯이 저장에서 빠졌다(배치를 지우면 안 된다)')
    assert.ok(layoutValid(out))
  })
  await ok('줄 없음 · 모르는 판 = 기본 배치 · 빈 배열 = 빈 홈(전부 지운 사람)', () => {
    assert.equal(normalizeLayout(null, null).usedDefault, true)
    assert.equal(normalizeLayout([{ id: 'a', kind: 'my_tasks', size: 's' }], 2).usedDefault, true)
    const empty = normalizeLayout([], 1)
    assert.deepEqual([empty.widgets.length, empty.usedDefault], [0, false])
  })
  await ok('모양 검사 = DB home_widgets_valid(배열 · 30개 · id 겹침 · 크기 · settings 객체 · id 모양)', () => {
    const w = (o: object) => [{ id: 'x', kind: 'my_tasks', size: 's', ...o }]
    assert.equal(layoutValid({}), false)
    assert.equal(layoutValid(Array.from({ length: 31 }, (_, i) => ({ id: `w${i}`, kind: 'my_tasks', size: 's' }))), false)
    assert.equal(layoutValid([...w({}), ...w({ kind: 'approvals' })]), false)
    assert.equal(layoutValid(w({ size: 'xl' })), false)
    assert.equal(layoutValid(w({ settings: [] })), false)
    assert.equal(layoutValid(w({ id: 'X Y' })), false)
    assert.equal(layoutValid(w({ kind: 'retired_widget' })), true, '모르는 kind는 모양만 본다')
    assert.equal(layoutValid([]), true)
  })

  console.log('저장 규칙(0086 거울)')
  await ok('처음 0 · 판 하나씩 · 옛 판 = 충돌 · A 저장이 B에 영향 없음 · 모양 틀림 = invalid', () => {
    const rows = new Map()
    const A = 'user-a'
    const B = 'user-b'
    const base = layoutForSave(defaultLayout())
    assert.equal(saveLayoutIn(rows, A, 0, 1, base), 1)
    assert.throws(() => saveLayoutIn(rows, A, 0, 1, base), /home_conflict/, '줄이 있는데 0으로 덮어썼다')
    const two = layoutForSave(moveWidget(defaultLayout(), 0, 1))
    assert.equal(saveLayoutIn(rows, A, 1, 1, two), 2)
    assert.throws(() => saveLayoutIn(rows, A, 1, 1, base), /home_conflict/, '다른 탭(옛 판 1)이 덮어썼다')
    assert.equal(rows.get(A).widgets[0].kind, 'approvals', '충돌 거부 뒤 배치가 바뀌었다')
    assert.equal(rows.has(B), false, 'A 저장이 B 줄을 만들었다')
    assert.equal(saveLayoutIn(rows, B, 0, 1, []), 1)
    assert.equal(rows.get(A).revision, 2, 'B 저장이 A 판을 바꿨다')
    assert.throws(() => saveLayoutIn(rows, A, 2, 2, base), /home_invalid/)
    assert.throws(() => saveLayoutIn(rows, A, -1, 1, base), /home_invalid/)
    assert.throws(() => saveLayoutIn(rows, A, 2, 1, [{ id: 'x', kind: 'my_tasks', size: 'xl' }]), /home_invalid/)
  })

  console.log('편집 도구')
  await ok('앞 · 뒤(끝에서는 그대로) · 끌어 놓기 · 같은지 · 새 id(지웠다 다시 넣어도 겹치지 않음)', () => {
    const d = defaultLayout()
    assert.deepEqual(moveWidget(d, 0, -1).map((w) => w.kind), d.map((w) => w.kind))
    assert.deepEqual(moveWidget(d, 5, 1).map((w) => w.kind), d.map((w) => w.kind))
    assert.deepEqual(moveWidget(d, 1, -1).slice(0, 2).map((w) => w.kind), ['approvals', 'my_tasks'])
    assert.deepEqual(dropWidget(d, 5, 0).map((w) => w.kind), ['favorites', 'my_tasks', 'approvals', 'schedule', 'requested', 'attendance'])
    assert.equal(sameLayout(d, defaultLayout()), true)
    assert.equal(sameLayout(d, d.map((w) => (w.kind === 'schedule' ? { ...w, size: 'l' as const } : w))), false)
    assert.equal(sameLayout(d, d.map((w) => (w.kind === 'schedule' ? { ...w, settings: { filter: 'week' } } : w))), false)
    assert.equal(newWidgetId('notices', ['my_tasks']), 'notices')
    assert.equal(newWidgetId('notices', ['notices']), 'notices-2')
  })

  console.log('고르기')
  await ok('내 업무 — 내 것 · 열린 것 · 필터 셋 · 기한 지남 → 마감 임박 → 마감 없음', () => {
    // owner는 이름표 · owner_user_id가 사람 — 이름이 id와 같아도 이름으로는 고르지 않는다.
    const t = (id: string, owner: string, deadline: string | null, status = 'Doing') => ({ task_id: id, owner: 'a', owner_user_id: owner, deadline, status, title: id })
    const tasks = [t('later', 'a', '2026-10-30'), t('none', 'a', null), t('over', 'a', '2026-10-01'), t('today', 'a', '2026-10-20'), t('done', 'a', '2026-10-01', 'Done'), t('other', 'b', '2026-10-01')]
    assert.equal(weekEnd('2026-10-20'), '2026-10-25', '2026-10-20(화) 주의 끝은 일요일')
    assert.equal(weekEnd('2026-10-25'), '2026-10-25')
    assert.deepEqual(pickMyTasks(tasks, 'a', '2026-10-20', 'open').map((x) => x.task_id), ['over', 'today', 'later', 'none'])
    assert.deepEqual(pickMyTasks(tasks, 'a', '2026-10-20', 'week').map((x) => x.task_id), ['over', 'today'])
    assert.deepEqual(pickMyTasks(tasks, 'a', '2026-10-20', 'overdue').map((x) => x.task_id), ['over'])
  })
  await ok('요청한 업무 — 내가 올린 양식 결재만 · 처리 중 = Open', () => {
    const d = (id: string, by: string, status: string, tpl = 'expense') => ({ decision_id: id, created_by: by, status, template_key: tpl, created_at: `2026-10-${id}` })
    const rows = [d('10', 'a', 'Open'), d('11', 'a', 'Approved'), d('12', 'b', 'Open'), { ...d('13', 'a', 'Open'), template_key: undefined }]
    assert.deepEqual(pickRequested(rows, 'a', 'open').map((x) => x.decision_id), ['10'])
    assert.deepEqual(pickRequested(rows, 'a', 'all').map((x) => x.decision_id), ['11', '10'])
  })

  console.log('금지 숫자 · 직원 화면 용어(코드)')
  const files = [
    ...walk(join(ROOT, 'src', 'lib', 'home')),
    ...walk(join(ROOT, 'src', 'components', 'home')),
    ...walk(join(ROOT, 'src', 'app', '(dashboard)', 'home')),
    join(ROOT, 'src', 'app', 'actions', 'home.ts'),
  ]
  await ok(`홈 코드 ${files.length}개 — 급여 · 원가 · BOM · 단가 · 재무 숫자 · 결재 금액 · «회장» 없음(주석 빼고) · 재무/원가 모듈 import 없음`, () => {
    assert.ok(files.length >= 6)
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const code = stripComments(src)
      assert.doesNotMatch(code, /급여|원가|BOM|단가|매출|손익|EBITDA|영업이익|payroll|salary/i, `${f}: 금지 낱말`)
      assert.doesNotMatch(code, /\.amount\b|amount:|total_amount|unit_price|\bprice\b/, `${f}: 금액 칸`)
      assert.doesNotMatch(code, /회장|Chairman OS/, `${f}: «회장»`)
      for (const m of src.matchAll(/from '(@\/[^']+)'/g)) assert.doesNotMatch(m[1], /finance|costs|cost-|bom|price|purchasing|sales|ledger|monthly-pl|production/, `${f}: ${m[1]} import`)
    }
  })
  await ok('사용자 id를 요청 본문에서 받지 않는다(서버 액션 · 저장소)', () => {
    const action = readFileSync(join(ROOT, 'src', 'app', 'actions', 'home.ts'), 'utf8')
    assert.match(action, /export async function saveHomeLayout\(expected: number, widgets: HomeWidget\[\], unknown: HomeWidget\[\] = \[\]\)/)
    assert.doesNotMatch(action, /user_id|userId/, '서버 액션이 사용자 id를 받는다')
    const store = readFileSync(join(ROOT, 'src', 'lib', 'home', 'store.ts'), 'utf8')
    assert.match(store, /sb\.rpc\('home_layout_save', \{ p_expected: expected, p_schema: HOME_SCHEMA_VERSION, p_widgets: widgets \}\)/, 'live 저장은 RPC(auth.uid())만')
  })

  console.log('dummy 실제 조회(직원 A · B)')
  // currentUser()는 요청 밖에서 못 부른다(connection) — 같은 dummy 사람으로 세션 모양만 만든다(lib/auth/session.ts dummyUser와 같은 칸).
  const { dummyViewer } = await import('../src/lib/repository/dummy-org')
  const { homeAccess, widgetData, favoriteOptions } = await import('../src/lib/home/data')
  const { homeStore } = await import('../src/lib/home/store')
  const as = async (key: string) => {
    process.env.DUMMY_USER = key
    const p = dummyViewer()
    const user = { user_id: p.user_id, name: p.display_name, role: p.role, title_ko: p.title_ko, display_name_en: p.display_name_en, language: 'ko' as const, finance: {}, ledger: [] }
    return { user, access: await homeAccess(user) }
  }
  const A = await as('sales_staff')
  const B = await as('buy_staff')
  await ok('스위치: 회사 줄(biz_dy) 켬 = A · B 둘 다 «내 홈» · 전자결재 · 대표가 아닌 다른 회사 사람 없음', async () => {
    assert.deepEqual(A.access, { home: true, approvals: true })
    assert.deepEqual(B.access, { home: true, approvals: true })
  })
  await ok('위젯 아홉 — 금액 칸 · 금지 낱말 없음 · 건수 ≥ 목록 · 목록 ≤ 5 · 연동 준비 중은 예시 없이', async () => {
    for (const who of [A, B]) {
      process.env.DUMMY_USER = who === A ? 'sales_staff' : 'buy_staff'
      for (const w of WIDGETS) {
        for (const f of w.filters.length ? w.filters.map((x) => x.key) : [undefined]) {
          const d = await widgetData(who.user, who.access, w.kind, f)
          const json = JSON.stringify(d)
          assert.doesNotMatch(json, /"amount"|급여|원가|BOM|단가|EBITDA/, `${w.kind}/${f}: ${json.slice(0, 200)}`)
          assert.notEqual(d.state, 'error', `${w.kind}/${f}: ${json.slice(0, 200)}`)
          if (d.state === 'ok') {
            assert.ok(d.items.length <= 5 && d.count >= d.items.length, `${w.kind}/${f}: 건수 ${d.count} · 목록 ${d.items.length}`)
            for (const it of d.items) assert.ok(it.href.startsWith('/'), `${w.kind}: 상세 링크 ${it.href}`)
          }
          if (w.kind === 'attendance') assert.equal(d.state, 'pending')
        }
      }
    }
  })
  await ok('필터를 바꾸면 건수가 같이 바뀐다(A 내 업무 진행 중 vs 기한 지남 · 전자결재 대기 vs 올린 문서는 각자 같은 조건)', async () => {
    process.env.DUMMY_USER = 'sales_staff'
    const open = await widgetData(A.user, A.access, 'my_tasks', 'open')
    const over = await widgetData(A.user, A.access, 'my_tasks', 'overdue')
    assert.ok(open.state === 'ok' && over.state === 'ok')
    assert.ok(open.state === 'ok' && open.count > 0, 'A(영업 직원)에게 열린 업무가 없다 — 시드를 확인')
    if (open.state === 'ok' && over.state === 'ok') {
      assert.ok(over.count < open.count, `필터를 바꿔도 건수가 같다(진행 중 ${open.count} · 기한 지남 ${over.count})`)
      assert.equal(over.items.length, Math.min(5, over.count), '목록과 건수가 다른 조건')
    }
    const { myApprovalPendingCount } = await import('../src/lib/approvals/widget')
    const todo = await widgetData(A.user, A.access, 'approvals', 'todo')
    assert.ok(todo.state === 'ok' && todo.count === (await myApprovalPendingCount()), '전자결재 위젯 건수 ≠ «결재할 문서» 건수')
  })
  await ok('즐겨찾기 후보 — 그 사람 메뉴 · 결재 양식만(«내 홈» 자신 · 회장 전용 메뉴 없음)', async () => {
    process.env.DUMMY_USER = 'sales_staff'
    const opts = await favoriteOptions(A.user, A.access)
    assert.ok(opts.some((o) => o.key === 'form:vacation'), '휴가신청 양식이 없다')
    assert.ok(!opts.some((o) => o.key === 'nav:nav_home' || /회장|의존|주의|아침 루틴/.test(o.label)), JSON.stringify(opts.map((o) => o.label)))
  })
  await ok('배치 저장(dummy 저장소) — A 저장 · B 영향 없음 · 다른 탭 충돌 · 새로 읽으면 순서 · 크기 · 필터 그대로', async () => {
    process.env.DUMMY_USER = 'sales_staff'
    const sA = await homeStore()
    const before = await sA.read()
    const mine = layoutForSave(moveWidget(defaultLayout(), 0, 1).map((w) => (w.kind === 'schedule' ? { ...w, size: 'l' as const, settings: { filter: 'week' } } : w)))
    const rev = await sA.save(before.revision, mine)
    assert.equal(rev, before.revision + 1)
    await assert.rejects(() => sA.save(before.revision, layoutForSave(defaultLayout())), /home_conflict/)
    const again = normalizeLayout((await (await homeStore()).read()).widgets, 1).widgets
    assert.deepEqual(again.map((w) => `${w.kind}:${w.size}:${w.settings.filter ?? ''}`).slice(0, 3), ['approvals:s:todo', 'my_tasks:m:open', 'schedule:l:week'])
    process.env.DUMMY_USER = 'buy_staff'
    const bRead = await (await homeStore()).read()
    assert.equal(bRead.widgets, null, 'A 저장이 B에게 보인다')
  })
  await ok('스위치 꺼진 직원(다른 회사 · 기본 대표만) — «내 홈» 메뉴 없음 · 서버 액션 거부', async () => {
    const { hiddenNavKeys, defaultFeatureRows } = await import('../src/lib/features')
    assert.ok(hiddenNavKeys(defaultFeatureRows(), 'Member', ['biz_dy']).includes('nav_home'))
    const src = readFileSync(join(ROOT, 'src', 'app', 'actions', 'home.ts'), 'utf8')
    assert.equal((src.match(/\(await homeAccess\(user\)\)\.home|access\.home/g) ?? []).length >= 3, true, '서버 액션 셋이 스위치를 보지 않는다')
    const page = readFileSync(join(ROOT, 'src', 'app', '(dashboard)', 'home', 'page.tsx'), 'utf8')
    assert.match(page, /if \(!access\.home\)/, '/home 화면이 스위치를 보지 않는다')
  })
  await ok('폰 하단 탭 «결재» — 전자결재 켜진 직원만 /e-approval · 대표 · 꺼진 사람은 /approvals 그대로', () => {
    const tabs = readFileSync(join(ROOT, 'src', 'components', 'layout', 'mobile-tabs.tsx'), 'utf8')
    assert.match(tabs, /t\.href === '\/approvals' && role !== 'Chairman'\s*\?\s*\{ \.\.\.t, label: '결재', href: eapproval \? '\/e-approval' : t\.href \}/)
    const layout = readFileSync(join(ROOT, 'src', 'app', '(dashboard)', 'layout.tsx'), 'utf8')
    assert.match(layout, /<MobileTabs role=\{user\?\.role\} eapproval=\{!sections\.hiddenNav\.includes\('nav_eapproval'\)\} \/>/)
  })

  console.log(`PASS: ${passed} home-widget checks (카탈로그 · 기본 배치 · 정규화(모르는 위젯 보존) · 모양 = DB · 저장 충돌 · A/B 분리 · 편집 도구 · 고르기 · 금지 숫자 · 사용자 id 없음 · dummy 실제 조회 · 스위치 · 하단 탭)`)
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}

/** 주석(//, /* *\/, {/* *\/})을 걷는다 — 설명 문장의 «원가 없음» 같은 말은 검사하지 않는다. 문자열 안의 //(주소)는 남긴다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
