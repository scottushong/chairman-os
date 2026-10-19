/**
 * 0085 재무 현황 · 자료 올리기 스크린숏 — dummy 서버 하나(DUMMY_FIN_DEMO=off · 진짜 AI 0회)에 가짜 18+ 자료를 한 번에 놓고 찍는다.
 *   SHOT_BASE=http://localhost:3105 SHOT_OUT=.screenshots/finance-overview SHOT_WHO=staff npx tsx scripts/shot-finance-overview.ts
 *   staff = 김병훈 자리(DUMMY_USER=teamless_staff 서버) · chair = 대표 자리(DUMMY_USER=chairman 서버). 시안도 같은 폭으로 찍어 나란히 둔다(SHOT_MOCK=1).
 *   PC 1440 · 폰 390(가로 넘침 검사). 화면에 «회장»이 보이면 실패(직원 자리).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { chromium, type Page } from 'playwright'

import { buildFinanceFixtures, shuffle } from './fixtures/finance-18'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3105'
const OUT = process.env.SHOT_OUT ?? '.screenshots/finance-overview'
const WHO = process.env.SHOT_WHO ?? 'staff'
const MOCK = process.env.SHOT_MOCK === '1'

async function noOverflow(page: Page, what: string) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 392) throw new Error(`${what}: 폰 가로 넘침 ${w}px`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const dir = resolve(OUT, 'files')
  mkdirSync(dir, { recursive: true })
  const files = shuffle(await buildFinanceFixtures(), 19).map((f) => {
    const p = join(dir, f.name)
    writeFileSync(p, f.bytes)
    return p
  })
  const browser = await chromium.launch()
  const shots: string[] = []
  // 앱 틀은 본문 칸이 따로 스크롤한다 — 전체를 찍으려면 창 높이를 내용 높이로 늘렸다가 되돌린다.
  const shoot = async (page: Page, name: string) => {
    const p = join(OUT, `${WHO}-${name}`)
    const vp = page.viewportSize()!
    const h = await page.evaluate(() => {
      let m = document.documentElement.scrollHeight
      document.querySelectorAll('*').forEach((e) => {
        const s = getComputedStyle(e)
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 4) m = Math.max(m, e.scrollHeight + (window.innerHeight - e.clientHeight))
      })
      return m
    })
    await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 14000) })
    await page.waitForTimeout(400)
    await page.screenshot({ path: p, fullPage: true })
    await page.setViewportSize(vp)
    shots.push(p)
  }
  try {
    const pc = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const open = async (page: Page, url: string) => {
      await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 300_000 })
      await page.waitForTimeout(800)
    }
    // 1. 자료 올리기 — 파일 전부 한 번에(순서 섞임)
    await open(pc, '/finance/biz_dy/upload?month=2026-09')
    await pc.locator('input[type=file]').setInputFiles(files)
    await pc.getByText(`방금 올린 파일 ${files.length}개`).waitFor({ timeout: 600_000 })
    await pc.getByRole('button', { name: '파일 고르기' }).waitFor({ timeout: 600_000 })
    await pc.waitForTimeout(1500)
    await shoot(pc, 'upload-pc.png')
    const text = await pc.locator('body').innerText()
    if (WHO === 'staff' && /회장/.test(text)) throw new Error('직원 화면에 «회장»')
    await open(phone, '/finance/biz_dy/upload?month=2026-09')
    await noOverflow(phone, '올리기')
    await shoot(phone, 'upload-phone.png')

    // 2. 재무 현황 탭 다섯
    const tabs: [string, string][] = [
      ['summary', '/finance?biz=biz_dy&month=2026-09'],
      ['daily', '/finance?biz=biz_dy&tab=daily'],
      ['calendar', '/finance?biz=biz_dy&tab=calendar'],
      ['pl', '/finance?biz=biz_dy&month=2026-09&tab=pl'],
      ['kpi', '/finance?biz=biz_dy&month=2026-09&tab=kpi'],
    ]
    for (const [name, url] of tabs) {
      await open(pc, url)
      const t = await pc.locator('body').innerText()
      if (WHO === 'staff' && /회장/.test(t)) throw new Error(`직원 화면(${name})에 «회장»`)
      await shoot(pc, `${name}-pc.png`)
      await open(phone, url)
      await noOverflow(phone, name)
      await shoot(phone, `${name}-phone.png`)
    }
    // 손익계산서 줄 누르기 → 계정별 원장
    await open(pc, '/finance?biz=biz_dy&month=2026-09&tab=pl')
    await pc.getByRole('link', { name: /판매비와 관리비/ }).first().click()
    await pc.getByTestId('ledger-lines').waitFor({ timeout: 60_000 })
    await shoot(pc, 'pl-drill-pc.png')

    if (WHO === 'chair') {
      // 대표 홈 — 재무 현황 저장본(자동 계산 · 잠정)을 쓰는 추이 칸.
      await open(pc, '/?dbiz=biz_dy')
      await pc.waitForTimeout(1500)
      await shoot(pc, 'home-pc.png')
      await open(phone, '/?dbiz=biz_dy')
      await noOverflow(phone, '대표 홈')
      await shoot(phone, 'home-phone.png')
    }
    if (MOCK) {
      const mocks = ['finance-overview-mock', 'finance-daily-mock', 'finance-calendar-mock', 'finance-pl-mock', 'finance-upload-mock']
      for (const m of mocks) {
        const url = `file:///${resolve('docs/specs/2026-10-19-finance-overview-mock', `${m}.html`).replace(/\\/g, '/')}`
        await pc.goto(url, { waitUntil: 'load' })
        await pc.waitForTimeout(500)
        const p = join(OUT, `mock-${m}-pc.png`)
        await pc.screenshot({ path: p, fullPage: true })
        shots.push(p)
        await phone.goto(url, { waitUntil: 'load' })
        const p2 = join(OUT, `mock-${m}-phone.png`)
        await phone.screenshot({ path: p2, fullPage: true })
        shots.push(p2)
      }
    }
  } finally {
    await browser.close()
  }
  console.log(`PASS: ${shots.length}장 — ${shots.join(' · ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
