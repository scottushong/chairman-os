/**
 * 0086 «내 홈» 실제 동작 확인 + 스크린숏(지시문 9절) — dummy 서버를 차례로 띄워 단계마다 돌린다(진짜 AI 0회 · DB 없음).
 *   서버 공통: NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= NEXT_PUBLIC_DATA_MODE=dummy CHAIRMAN_ENV=local
 *              DUMMY_HOME_STATE=<파일>(A · B 서버가 같은 저장 파일 — A 저장이 B에 새는지 본다)
 *   SHOT_PHASE=A    DUMMY_USER=sales_staff DUMMY_HOME_OPEN=biz_dy DUMMY_EA_OPEN=biz_dy
 *   SHOT_PHASE=B    DUMMY_USER=buy_staff   DUMMY_HOME_OPEN=biz_dy DUMMY_EA_OPEN=biz_dy DUMMY_HOME_FAIL=1 DUMMY_HOME_WIDGET_FAIL=notices
 *   SHOT_PHASE=OFF  DUMMY_USER=sales_staff (스위치 기본 = 대표만 · 전자결재도 기본)
 *   SHOT_BASE=http://localhost:3203 SHOT_OUT=docs/onboarding/home-shots SHOT_PHASE=A npx tsx scripts/shot-home-widgets.ts
 * 폰 390 · PC 1280. 실패하면 던진다(어느 확인인지 문장으로).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Browser, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3203'
const OUT = process.env.SHOT_OUT ?? 'docs/onboarding/home-shots'
const PHASE = process.env.SHOT_PHASE ?? 'A'
const FORBIDDEN = /급여|원가|BOM|단가|EBITDA|영업이익|회장/

const log = (s: string) => console.log(`  ✓ ${s}`)
function must(cond: unknown, why: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${why}`)
}

async function phone(browser: Browser): Promise<Page> {
  return browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
}

async function openHome(page: Page) {
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle', timeout: 240_000 })
  await page.getByTestId('widget-grid').waitFor({ timeout: 120_000 })
  await settle(page)
}

/** 위젯이 전부 불러와질 때까지(불러오는 중 칸이 없어질 때까지). */
async function settle(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll('[data-state="loading"]').length === 0, null, { timeout: 120_000 })
}

const order = (page: Page) => page.$$eval('[data-testid^="widget-"][data-size]', (els) => els.map((e) => `${e.getAttribute('data-testid')!.slice(7)}:${e.getAttribute('data-size')}`))

async function noHScroll(page: Page, why: string) {
  const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('main')?.scrollWidth ?? 0))
  must(w <= (page.viewportSize()?.width ?? 390) + 1, `${why}: 가로 넘침 ${w}px`)
}

/** 본문(스크롤 칸) 전체를 찍는다 — 셸이 본문만 스크롤해서 fullPage가 잘린다. 뷰포트를 본문 높이만큼 늘렸다 되돌린다. */
async function shot(page: Page, name: string) {
  const vp = page.viewportSize()!
  const h = await page.evaluate(() => (document.querySelector('main')?.scrollHeight ?? 1000) + 140)
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 4000) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, name) })
  await page.setViewportSize(vp)
}

async function textCheck(page: Page, why: string) {
  const text = await page.locator('main').innerText()
  const bad = FORBIDDEN.exec(text)
  must(!bad, `${why}: 화면에 금지 낱말 «${bad?.[0]}»`)
}

async function phaseA(browser: Browser) {
  const page = await phone(browser)
  await openHome(page)
  const first = await order(page)
  must(first.join(',') === 'my_tasks:m,approvals:s,schedule:s,requested:s,attendance:s,favorites:s', `A 기본 배치 ${first}`)
  must((await page.getByTestId('widget-attendance').innerText()).includes('연동 준비 중'), '근태 위젯이 «연동 준비 중»이 아니다')
  must(await page.getByTestId('required-notices').isVisible(), '필수 공지 영역이 없다')
  await noHScroll(page, 'A 기본')
  await textCheck(page, 'A 기본')
  // 항목을 누르면 상세로 — 내 업무 첫 줄의 주소.
  const href = await page.getByTestId('widget-my_tasks').locator('a[href^="/tasks/"]').first().getAttribute('href')
  must(href && /^\/tasks\/.+/.test(href), `내 업무 항목 링크 ${href}`)
  await shot(page, 'A-1-default-390.png')
  log(`A 기본 배치(${first.length}개) · 근태 «연동 준비 중» · 필수 공지 · 가로 넘침 없음 · 금지 낱말 없음 · 항목 → ${href}`)

  // ── 필터를 바꾸면 내용 · 건수가 같이 바뀐다(편집 밖 — 바로 저장) ──
  const tasks = page.getByTestId('widget-my_tasks')
  const cOpen = await tasks.getByTestId('widget-count').innerText()
  await tasks.getByTestId('filter').selectOption('overdue')
  await settle(page)
  await page.waitForFunction(() => !document.querySelector('[data-testid="home-edit"]')?.hasAttribute('disabled'))
  const cOver = await tasks.getByTestId('widget-count').innerText()
  must(cOpen !== cOver, `필터를 바꿔도 건수가 같다(${cOpen} → ${cOver})`)
  await tasks.getByTestId('filter').selectOption('open')
  await settle(page)
  await page.waitForFunction(() => !document.querySelector('[data-testid="home-edit"]')?.hasAttribute('disabled'))
  log(`필터: 내 업무 진행 중 ${cOpen}건 → 기한 지남 ${cOver}건 → 진행 중`)

  // ── 편집 → 취소 = 정확히 복원 ──
  const beforeEdit = await order(page)
  await page.getByTestId('home-edit').click()
  must(await page.getByTestId('required-notices').locator('button').count() === 0, '필수 공지에 편집 도구(제거)가 있다')
  await page.getByTestId('widget-schedule').getByTestId('move-prev').click()
  await page.getByTestId('widget-requested').getByTestId('size').selectOption('l')
  await page.getByTestId('widget-favorites').getByTestId('remove').click()
  must((await order(page)).join(',') !== beforeEdit.join(','), '편집이 반영되지 않았다')
  await page.getByTestId('home-cancel').click()
  must((await order(page)).join(',') === beforeEdit.join(','), `취소 뒤 복원이 다르다 ${await order(page)}`)
  log('편집 취소 → 순서 · 크기 · 위젯 그대로 복원 · 필수 공지에 편집 도구 없음')

  // ── 편집: 추가 · 제거 · 재추가 · 앞/뒤 · 크기 · 필터 · 즐겨찾기 ──
  await page.getByTestId('home-edit').click()
  await page.getByTestId('home-add').click()
  must((await page.getByTestId('add-my_tasks').innerText()).includes('추가됨'), '이미 있는 위젯이 «추가됨»이 아니다')
  await page.getByTestId('add-notices').click()
  await page.getByTestId('widget-attendance').getByTestId('remove').click()
  must(!(await order(page)).some((x) => x.startsWith('attendance')), '제거가 안 됐다')
  must((await page.getByTestId('add-attendance').innerText()).includes('추가'), '제거한 위젯을 다시 넣을 수 없다')
  await page.getByTestId('add-attendance').click()
  await page.getByTestId('home-add').click()
  await page.getByTestId('widget-schedule').getByTestId('move-prev').click()
  await page.getByTestId('widget-schedule').getByTestId('move-prev').click()
  await page.getByTestId('widget-requested').getByTestId('size').selectOption('l')
  await page.getByTestId('widget-approvals').getByTestId('filter').selectOption('mine')
  await page.getByTestId('widget-favorites').getByLabel('즐겨찾기 더하기').selectOption('form:vacation')
  await settle(page)
  await noHScroll(page, 'A 편집 중')
  const editing = await order(page)
  await shot(page, 'A-2-editing-390.png')
  log(`편집: 공지 추가 · 근태 제거 → 재추가 · 일정 앞으로 두 칸 · 요청한 업무 전체 폭 · 전자결재 «내가 올린 문서» · 즐겨찾기 휴가신청 → ${editing.join(',')}`)

  await page.getByTestId('home-save').click()
  await page.getByText('배치를 저장했습니다.').waitFor({ timeout: 60_000 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('widget-grid').waitFor()
  await settle(page)
  const after = await order(page)
  must(after.join(',') === editing.join(','), `새로고침 뒤 배치가 다르다 ${after} ≠ ${editing}`)
  must((await page.getByTestId('widget-approvals').getByTestId('filter').inputValue()) === 'mine', '새로고침 뒤 전자결재 필터가 돌아갔다')
  must((await page.getByTestId('widget-favorites').innerText()).includes('휴가신청'), '새로고침 뒤 즐겨찾기가 없다')
  await textCheck(page, 'A 저장 뒤')
  await shot(page, 'A-3-saved-reload-390.png')
  log(`저장 → 새로고침: 순서 · 크기 · 필터 · 즐겨찾기 유지 (${after.join(',')})`)

  // ── 다른 탭 충돌 ──
  const t1 = await phone(browser)
  const t2 = await phone(browser)
  await openHome(t1)
  await openHome(t2)
  await t1.getByTestId('home-edit').click()
  await t1.getByTestId('widget-notices').getByTestId('move-prev').click()
  await t1.getByTestId('home-save').click()
  await t1.getByText('배치를 저장했습니다.').waitFor({ timeout: 60_000 })
  const t1Order = await order(t1)
  await t2.getByTestId('home-edit').click()
  await t2.getByTestId('widget-my_tasks').getByTestId('size').selectOption('s')
  await t2.getByTestId('home-save').click()
  await t2.getByTestId('home-error').waitFor({ timeout: 60_000 })
  must((await t2.getByTestId('home-error').innerText()).includes('다른 탭'), '충돌 문구가 없다')
  must(await t2.getByTestId('edit-bar').isVisible(), '충돌 뒤 편집 내용(편집 상태)이 사라졌다')
  await shot(t2, 'A-4-conflict-390.png')
  await t2.getByRole('button', { name: '최신 배치 불러오기' }).click()
  await t2.getByText('최신 배치를 불러왔습니다').waitFor()
  must((await order(t2)).join(',') === t1Order.join(','), '최신 배치 불러오기가 다른 탭 저장을 안 가져왔다')
  await t2.getByTestId('home-cancel').click()
  await t1.close()
  await t2.close()
  log('두 탭: 먼저 저장한 탭이 이기고, 늦은 탭은 덮어쓰지 않고 «다른 탭» 안내 · 편집 유지 · 최신 배치 불러오기')

  // ── 폰 하단 탭 «결재» → /e-approval ──
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' })
  const tab = page.locator('nav[aria-label="하단 탭"] a', { hasText: '결재' })
  must((await tab.getAttribute('href')) === '/e-approval', `하단 탭 결재 주소 ${await tab.getAttribute('href')}`)
  await page.locator('nav[aria-label="하단 탭"]').screenshot({ path: join(OUT, 'A-5-tab-eapproval-390.png') })
  await tab.click()
  await page.waitForURL(/\/e-approval/, { timeout: 120_000 })
  log('폰 하단 탭 «결재» → /e-approval')

  // ── 메뉴: «내 홈»(/home) + 예전 /me는 «내 업무함» ──
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '더보기' }).click()
  const drawer = page.locator('a[href="/home"]:visible').filter({ hasText: '내 홈' })
  await drawer.first().waitFor({ timeout: 30_000 })
  must((await page.locator('a[href="/me"]:visible').filter({ hasText: '내 업무함' }).count()) > 0, '예전 /me 메뉴 이름이 «내 업무함»이 아니다')
  await page.screenshot({ path: join(OUT, 'A-6-menu-on-390.png') })
  log('메뉴: «내 홈»(/home) 있음 · 예전 /me = «내 업무함»')

  // ── PC 1280 ──
  const pc = await browser.newPage({ viewport: { width: 1280, height: 2200 } }) // 끌어 놓기 중 스크롤이 생기면 시작점이 어긋난다 — 한 화면에 다 들어오게
  await openHome(pc)
  await shot(pc, 'A-7-desktop-1280.png')
  await pc.getByTestId('home-edit').click()
  // 끌어 놓기(데스크톱): 공지를 맨 앞으로.
  const from = pc.getByTestId('widget-notices')
  const to = pc.locator('[data-testid^="widget-"][data-size]').first()
  await from.dragTo(to)
  const dragged = await order(pc)
  must(dragged[0].startsWith('notices'), `끌어 놓기가 안 됐다 ${dragged}`)
  await shot(pc, 'A-8-desktop-edit-1280.png')
  await pc.getByTestId('home-cancel').click()
  await textCheck(pc, 'A PC')
  log(`PC 1280 3열 · 끌어 놓기(공지 → 맨 앞) 후 취소`)
}

async function phaseB(browser: Browser) {
  const page = await phone(browser)
  await openHome(page)
  const b = await order(page)
  must(b.join(',') === 'my_tasks:m,approvals:s,schedule:s,requested:s,attendance:s,favorites:s', `B가 A의 배치를 본다 ${b}`)
  must((await page.getByTestId('widget-approvals').getByTestId('filter').inputValue()) === 'todo', 'B 전자결재 필터가 A 것이다')
  await textCheck(page, 'B')
  await shot(page, 'B-1-unaffected-390.png')
  log(`B(구매 직원): 기본 배치 그대로 — A 저장 영향 없음 (${b.join(',')})`)

  // ── 한 위젯 실패(공지 — DUMMY_HOME_WIDGET_FAIL) · 다른 위젯은 정상 · 다시 시도 ──
  await page.getByTestId('home-edit').click()
  await page.getByTestId('home-add').click()
  await page.getByTestId('add-notices').click()
  await page.getByTestId('home-add').click()
  await settle(page)
  const notices = page.getByTestId('widget-notices')
  must((await notices.locator('[data-state="error"]').count()) === 1, '공지 위젯이 실패 상태가 아니다')
  must((await page.getByTestId('widget-my_tasks').locator('[data-state="ok"]').count()) === 1, '한 위젯 실패가 다른 위젯을 막았다')
  await notices.getByRole('button', { name: '다시 시도' }).click()
  await settle(page)
  must((await notices.locator('[data-state="error"]').count()) === 1, '다시 시도 뒤 상태가 이상하다')

  // ── 저장 실패(DUMMY_HOME_FAIL) — 편집 유지 · 다시 저장 단추 ──
  const editing = await order(page)
  await page.getByTestId('home-save').click()
  await page.getByTestId('home-error').waitFor({ timeout: 60_000 })
  must(await page.getByTestId('edit-bar').isVisible(), '저장 실패 뒤 편집이 닫혔다')
  must((await order(page)).join(',') === editing.join(','), '저장 실패 뒤 편집 내용이 사라졌다')
  must((await page.getByRole('button', { name: '다시 저장' }).count()) === 1, '다시 저장 단추가 없다')
  await shot(page, 'B-2-widget-error-save-fail-390.png')
  // 나가려 하면 묻는다(앱 안 링크) — 취소를 고르면 남는다.
  page.once('dialog', (d) => void d.dismiss())
  await page.locator('nav[aria-label="하단 탭"] a', { hasText: '채팅' }).click()
  await page.waitForTimeout(800)
  must(page.url().endsWith('/home'), `나갈 때 확인 없이 나갔다 ${page.url()}`)
  await page.getByTestId('home-cancel').click()
  log('B: 공지 위젯만 실패(다시 시도) · 다른 위젯 정상 · 저장 실패 → 편집 유지 + 다시 저장 · 나갈 때 확인')
}

async function phaseOff(browser: Browser) {
  const page = await phone(browser)
  await page.goto(`${BASE}/me`, { waitUntil: 'networkidle', timeout: 240_000 })
  await page.getByRole('button', { name: '더보기' }).click()
  await page.waitForTimeout(600)
  must((await page.locator('a[href="/home"]:visible').count()) === 0, '스위치가 꺼졌는데 «내 홈»(/home) 메뉴가 있다')
  must((await page.locator('a[href="/me"]:visible').filter({ hasText: '내 홈' }).count()) > 0, '스위치 꺼짐: 예전 «내 홈»(/me) 이름이 바뀌었다')
  await page.screenshot({ path: join(OUT, 'OFF-1-menu-390.png') })
  const tab = page.locator('nav[aria-label="하단 탭"] a', { hasText: '결재' })
  must((await tab.getAttribute('href')) === '/approvals', `전자결재 꺼진 직원의 하단 탭 결재 주소 ${await tab.getAttribute('href')}`)
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' })
  must((await page.locator('main').innerText()).includes('지금은 쓸 수 없는 기능'), '스위치 꺼짐: /home이 안내를 보이지 않는다')
  must((await page.locator('[data-testid="widget-grid"]').count()) === 0, '스위치 꺼짐: 위젯이 보인다')
  await shot(page, 'OFF-2-home-closed-390.png')
  log('스위치 끔: «내 홈»(/home) 메뉴 없음 · 예전 «내 홈»(/me) 그대로 · /home 안내만 · 하단 탭 결재 = /approvals(전자결재도 꺼짐)')
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    console.log(`단계 ${PHASE} (${BASE})`)
    if (PHASE === 'A') await phaseA(browser)
    else if (PHASE === 'B') await phaseB(browser)
    else await phaseOff(browser)
    console.log(`PASS: shot-home-widgets ${PHASE}`)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
