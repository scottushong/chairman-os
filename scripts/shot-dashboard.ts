/**
 * 0097 대표 첫 화면 구역 · 위젯 — 실제 화면 시험 + 스크린숏. dummy 서버를 단계마다 다시 띄워 돌린다(진짜 AI 0회 · DB 없음).
 *   서버 공통: NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= NEXT_PUBLIC_DATA_MODE=dummy CHAIRMAN_ENV=local
 *              DUMMY_HOME_STATE=<파일>(단계 사이 같은 저장 파일 — 대표 배치가 직원에게 새는지 본다) · next dev --webpack(worktree)
 *   SHOT_PHASE=CHAIR  (DUMMY_USER 없음 = 대표)  배치 시험 전부 + PC · 폰 스크린숏
 *   SHOT_PHASE=STAFF  DUMMY_USER=sales_staff DUMMY_HOME_OPEN=biz_dy DUMMY_EA_OPEN=biz_dy  직원 홈 · 목록 · API 403
 *   SHOT_PHASE=FAIL   DUMMY_HOME_WIDGET_FAIL=fin_kpis(대표)  위젯 하나 실패해도 홈이 선다
 *   SHOT_BASE=http://localhost:3197 SHOT_OUT=docs/onboarding/dashboard-shots SHOT_PHASE=CHAIR npx tsx scripts/shot-dashboard.ts
 * 실패하면 던진다(어느 확인인지 문장으로).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Browser, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3197'
const OUT = process.env.SHOT_OUT ?? 'docs/onboarding/dashboard-shots'
const PHASE = process.env.SHOT_PHASE ?? 'CHAIR'

const log = (s: string) => console.log(`  ✓ ${s}`)
function must(cond: unknown, why: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${why}`)
}

async function open(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 300_000 })
  await page.getByTestId('board').waitFor({ timeout: 200_000 })
  await settle(page)
}
async function settle(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll('[data-state="loading"]').length === 0, null, { timeout: 200_000 })
}
const sections = (page: Page) => page.$$eval('[data-testid^="section-"][aria-label]', (els) => els.filter((e) => /^section-[a-z0-9_-]+$/.test(e.getAttribute('data-testid')!) && e.tagName === 'SECTION').map((e) => e.getAttribute('data-testid')!.slice(8)))
const kindsIn = (page: Page, id: string) => page.$$eval(`[data-testid="section-${id}"] article[data-testid^="widget-"]`, (els) => els.map((e) => e.getAttribute('data-testid')!.slice(7)))
const countOf = async (page: Page, sec: string, kind: string) => Number(await page.locator(`[data-testid="section-${sec}"] [data-testid="widget-${kind}"] [data-state="ok"]`).getAttribute('data-count'))
const basisOf = (page: Page, sec: string, kind: string) => page.locator(`[data-testid="section-${sec}"] [data-testid="widget-${kind}"] [data-testid="widget-basis"]`).innerText()

async function noHScroll(page: Page, why: string) {
  const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('main')?.scrollWidth ?? 0))
  must(w <= (page.viewportSize()?.width ?? 390) + 1, `${why}: 가로 넘침 ${w}px`)
}
async function shot(page: Page, name: string) {
  const vp = page.viewportSize()!
  const h = await page.evaluate(() => (document.querySelector('main')?.scrollHeight ?? 1000) + 140)
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 5000) })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, name) })
  await page.setViewportSize(vp)
}
async function saveNow(page: Page) {
  await page.getByTestId('home-save').click()
  await page.getByTestId('home-notice').filter({ hasText: '저장했습니다' }).waitFor({ timeout: 60_000 })
}

async function chair(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await open(page, '/')
  const first = await sections(page)
  must(JSON.stringify(first) === JSON.stringify(['today', 'finance', 'invest', 'brief']), `대표 기본 구역 ${first.join(',')}`)
  must((await page.locator('[data-testid="add-panel"], [data-testid="edit-bar"]').count()) === 0, '평소에 편집 도구 · 라이브러리가 보인다')
  must((await page.locator('[data-testid="section-today"] [title="끌어서 옮기기"]').count()) === 0, '평소에 손잡이가 보인다')
  log('대표 기본 배치 넷(오늘의 경영 · 재무 지표 · 투자 · 아침 브리핑) · 평소엔 손잡이 · 라이브러리 없음')
  await shot(page, 'pc-1-view.png')

  // 편집 모드 + 라이브러리(시안 모습)
  await page.getByTestId('home-edit').click()
  await page.getByTestId('home-add').click()
  await page.getByTestId('add-panel').waitFor()
  await shot(page, 'pc-2-edit-library.png')
  log('편집 모드 — 손잡이 · 점선 · 라이브러리 · «새 구역 만들기»')

  // 새 구역(오늘의 경영 뒤) → 이름 → 범위 DY → 재무 지표 · 계열사 현황 추가 → 재무 지표 구역의 자료 체크표를 새 구역으로 → 저장
  await page.getByTestId('add-section-0').click()
  const room = page.getByTestId('section-sec-1')
  await room.getByTestId('section-rename').click()
  await room.getByTestId('section-title').fill('계열사 상황실')
  await room.getByTestId('section-title').press('Enter')
  await room.getByTestId('scope-biz').first().selectOption('biz_dy')
  await room.getByTestId('section-library').click()
  await page.getByTestId('library-target').selectOption('sec-1')
  await page.getByTestId('add-fin_kpis').click()
  await page.getByTestId('add-companies').click()
  must(await page.getByTestId('add-companies').isDisabled(), '같은 구역에 같은 위젯을 또 넣을 수 있다')
  await page.locator('[data-testid="section-finance"] [data-testid="widget-fin_checklist"] [data-testid="move-section"]').selectOption('sec-1')
  must((await kindsIn(page, 'sec-1')).join(',') === 'fin_kpis,companies,fin_checklist', `구역 간 이동 ${(await kindsIn(page, 'sec-1')).join(',')}`)
  await saveNow(page)
  log('구역 만들기 · 이름 · 범위(대양산업) · 위젯 추가 · 구역 간 이동 · 저장')

  // 새로고침 복원 + 범위 → 숫자 · 건수
  await open(page, '/')
  must(JSON.stringify(await sections(page)) === JSON.stringify(['today', 'sec-1', 'finance', 'invest', 'brief']), `새로고침 뒤 구역 ${(await sections(page)).join(',')}`)
  must((await page.getByTestId('section-sec-1').getByRole('heading', { level: 2 }).innerText()).includes('계열사 상황실'), '구역 이름 복원')
  must((await kindsIn(page, 'sec-1')).join(',') === 'fin_kpis,companies,fin_checklist', '위젯 복원')
  const allCo = await countOf(page, 'finance', 'companies')
  const dyCo = await countOf(page, 'sec-1', 'companies')
  must(allCo > 1 && dyCo === 1, `계열사 현황 건수 전체 ${allCo} · 대양산업 ${dyCo}`)
  const allBasis = await basisOf(page, 'finance', 'fin_kpis')
  const dyBasis = await basisOf(page, 'sec-1', 'fin_kpis')
  must(/전체 계열사/.test(allBasis) && !/전체 계열사/.test(dyBasis), `재무 지표 기준 ${allBasis} / ${dyBasis}`)
  log(`새로고침 복원 · 회사 범위 → 건수(계열사 ${allCo} → ${dyCo}) · 숫자 기준(«${allBasis.slice(0, 22)}…» → «${dyBasis.slice(0, 22)}…»)`)
  await shot(page, 'pc-3-saved-sections.png')

  // 위젯 범위 덮어쓰기: 새 구역의 재무 지표를 «전체 계열사»로 → 저장 → 기준이 전체로
  await page.getByTestId('home-edit').click()
  await page.locator('[data-testid="section-sec-1"] [data-testid="widget-fin_kpis"] [data-testid="scope-biz"]').selectOption('all')
  await saveNow(page)
  await settle(page)
  must(/전체 계열사/.test(await basisOf(page, 'sec-1', 'fin_kpis')), '위젯 범위 덮어쓰기가 안 먹었다')
  log('위젯이 구역 범위를 덮어씀(대양산업 구역 안의 재무 지표 = 전체 계열사)')

  // 취소 복원
  await page.getByTestId('home-edit').click()
  await page.locator('[data-testid="section-today"] [data-testid="widget-approvals"] [data-testid="remove"]').click()
  must(!(await kindsIn(page, 'today')).includes('approvals'), '편집 중 제거가 안 보인다')
  await page.getByTestId('home-cancel').click()
  must((await kindsIn(page, 'today')).includes('approvals'), '취소 뒤 위젯이 돌아오지 않았다')
  await open(page, '/')
  must((await kindsIn(page, 'today')).includes('approvals'), '취소한 제거가 저장됐다')
  log('취소 = 편집 직전 그대로(새로고침해도)')

  // 되돌리기
  await page.getByTestId('home-edit').click()
  await page.getByTestId('section-today').getByTestId('section-down').click()
  must((await sections(page))[0] === 'sec-1', '구역 아래로')
  await page.getByTestId('board-undo').click()
  must((await sections(page))[0] === 'today', '되돌리기가 안 먹었다')
  log('되돌리기(한 걸음)')

  // 숨김 → 저장 → 평소 화면에 없음
  await page.getByTestId('section-brief').getByTestId('section-hide').click()
  await saveNow(page)
  must((await page.getByTestId('section-brief').count()) === 0, '숨긴 구역이 평소 화면에 보인다')
  log('구역 숨김(평소 화면에서 빠짐 · 편집 모드에선 흐리게)')

  // 평소 접기 → 새로고침 뒤에도 접힘 → 펼침
  await page.getByTestId('section-invest').getByTestId('section-collapse').click()
  await page.waitForTimeout(1500)
  await open(page, '/')
  must((await page.getByTestId('section-invest').getAttribute('data-collapsed')) === '1', '접기가 저장되지 않았다')
  await page.getByTestId('section-invest').getByTestId('section-collapse').click()
  await page.waitForTimeout(1500)
  log('구역 접기 · 펼치기(그 자리에서 저장 · 새로고침 복원)')

  // 폰 390 — 끌기 없이 버튼 · 접기
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await open(phone, '/')
  await noHScroll(phone, '폰 390 평소')
  await shot(phone, 'phone-1-view.png')
  await phone.getByTestId('home-edit').click()
  await noHScroll(phone, '폰 390 편집')
  must(await phone.getByTestId('section-today').getByTestId('section-down').isVisible(), '폰: 구역 아래로 버튼')
  must(await phone.locator('[data-testid="section-today"] [data-testid="move-next"]').first().isVisible(), '폰: 위젯 뒤로 버튼')
  await phone.getByTestId('section-today').getByTestId('section-down').click()
  must((await sections(phone))[0] === 'sec-1', '폰: 구역 순서 버튼')
  await phone.locator('[data-testid="section-sec-1"] [data-testid="move-next"]').first().click()
  must((await kindsIn(phone, 'sec-1'))[0] === 'companies', '폰: 위젯 순서 버튼')
  await shot(phone, 'phone-2-edit.png')
  await phone.getByTestId('home-cancel').click()
  await phone.getByTestId('section-finance').getByTestId('section-collapse').click()
  await phone.waitForTimeout(1500)
  await shot(phone, 'phone-3-collapsed.png')
  await phone.getByTestId('section-finance').getByTestId('section-collapse').click()
  await phone.waitForTimeout(1500)
  log('폰 390 — 가로 넘침 없음 · 앞뒤 · 위아래 버튼 · 접기/펼치기')
  await phone.close()

  // 기본 배치로 복원
  await open(page, '/')
  await page.getByTestId('home-edit').click()
  await page.getByTestId('board-default').click()
  await saveNow(page)
  must(JSON.stringify(await sections(page)) === JSON.stringify(['today', 'finance', 'invest', 'brief']), `기본 배치 복원 ${(await sections(page)).join(',')}`)
  log('기본 배치로 복원(저장 뒤 반영)')

  // 다음 단계(직원)가 볼 대표 표시 — 대표 배치에 표지 구역 하나를 남긴다.
  await page.getByTestId('home-edit').click()
  await page.getByTestId('add-section-3').click()
  await page.getByTestId('section-sec-1').getByTestId('section-rename').click()
  await page.getByTestId('section-sec-1').getByTestId('section-title').fill('대표 표지 구역')
  await page.getByTestId('section-sec-1').getByTestId('section-title').press('Enter')
  await saveNow(page)
  await page.close()
}

async function staff(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const r = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 300_000 })
  must(r && !page.url().endsWith(`${BASE}/`) , '직원이 대표 첫 화면(/)에 머문다')
  await open(page, '/home')
  const secs = await sections(page)
  must(secs.length === 1, `직원 기본 구역 하나 — ${secs.join(',')}`)
  must(!(await page.locator('main').innerText()).includes('대표 표지 구역'), '대표 배치가 직원 홈에 샜다')
  const text = await page.locator('main').innerText()
  must(!/회장|매출|영업이익|EBITDA|급여|원가|BOM|단가/.test(text), `직원 홈 금지 낱말: ${/회장|매출|영업이익|EBITDA|급여|원가|BOM|단가/.exec(text)?.[0]}`)
  await shot(page, 'staff-pc-1-view.png')
  await page.getByTestId('home-edit').click()
  await page.getByTestId('section-main').getByTestId('section-library').click()
  await page.getByTestId('add-panel').waitFor()
  for (const k of ['fin_kpis', 'companies', 'cash_forecast', 'fin_checklist', 'inv_kpis', 'inv_brief', 'inv_monthly', 'ai_judgment', 'memory_review', 'fx_strip', 'data_room']) {
    must((await page.getByTestId(`lib-${k}`).count()) === 0, `직원 라이브러리에 ${k}`)
  }
  must((await page.getByTestId('lib-projects').count()) === 1, '직원 라이브러리에 프로젝트 현황이 없다')
  await shot(page, 'staff-pc-2-library.png')
  log('직원 홈 — 구역 하나 · 대표 배치 안 섞임 · 재무 · 투자 · 대표 전용 위젯이 목록에 없음 · 금지 낱말 없음')
  await page.getByTestId('home-cancel').click()

  // tsx가 evaluate 안의 함수에 이름 도우미를 넣어 브라우저에서 깨진다 — 같은 맥락(page.request)으로 부른다.
  const code = async (q: string) => (await page.request.get(`${BASE}/api/home/widget?${q}`)).status()
  const st = {
    fin: await code('kind=fin_kpis&biz=all'),
    inv: await code('kind=inv_kpis'),
    ai: await code('kind=ai_judgment'),
    mem: await code('kind=memory_review'),
    mine: await code('kind=my_tasks'),
    foreign: await code('kind=my_tasks&biz=biz_zzz'),
    bad: await code('kind=nope'),
  }
  must(st.fin === 403 && st.inv === 403 && st.ai === 403 && st.mem === 403, `직원 API 403 아님 ${JSON.stringify(st)}`)
  must(st.mine === 200 && st.foreign === 403 && st.bad === 400, `직원 API ${JSON.stringify(st)}`)
  log(`직원 API — 재무 · 투자 · 아침 루틴 · 기억 403 · 내 업무 200 · 볼 수 없는 회사 범위 403 · 모르는 종류 400`)

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await open(phone, '/home')
  await noHScroll(phone, '직원 폰 390')
  await shot(phone, 'staff-phone-1-view.png')
  await phone.close()
  await page.close()
}

async function fail(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await open(page, '/')
  must((await page.locator('[data-testid="widget-fin_kpis"] [data-state="error"]').count()) >= 1, '실패 위젯이 «실패» 칸이 아니다')
  must((await page.locator('[data-testid="widget-companies"] [data-state="ok"]').count()) >= 1, '다른 위젯까지 실패했다')
  must((await page.locator('[data-testid="widget-inv_kpis"] [data-state="ok"]').count()) >= 1, '다른 위젯까지 실패했다(투자)')
  await shot(page, 'pc-4-one-widget-failed.png')
  log('위젯 하나(재무 지표) 실패 — 그 칸만 «다시 시도», 나머지 정상')
  await page.close()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    console.log(`0097 화면 시험 — ${PHASE}`)
    if (PHASE === 'CHAIR') await chair(browser)
    else if (PHASE === 'STAFF') await staff(browser)
    else if (PHASE === 'FAIL') await fail(browser)
    console.log(`PASS: ${PHASE}`)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
