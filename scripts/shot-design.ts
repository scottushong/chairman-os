/**
 * 0098 디자인 전면 교체 — 전 · 후 스크린숏(주요 12화면 × PC · 폰 × 새/예전 모양). dummy 서버(진짜 DB · AI 0회).
 *   서버: NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= NEXT_PUBLIC_DATA_MODE=dummy CHAIRMAN_ENV=local next dev --webpack
 *         직원 화면은 DUMMY_USER=sales_staff 로 다시 띄운다.
 *   SHOT_TAG=before   바꾸기 전 코드(master)
 *   SHOT_TAG=new      새 모양(기본)
 *   SHOT_TAG=classic  예전 모양 — /settings «화면 모양»에서 «예전 모양»을 눌러 저장한 뒤 찍는다(dummy 메모리에 남음)
 *   SHOT_ROLE=chair | staff
 *   SHOT_BASE=http://localhost:3198 SHOT_OUT=docs/onboarding/design-shots SHOT_TAG=new SHOT_ROLE=chair npx tsx scripts/shot-design.ts
 * 파일 이름: <화면>-<pc|phone>-<tag>.jpg
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3198'
const OUT = process.env.SHOT_OUT ?? 'docs/onboarding/design-shots'
const TAG = process.env.SHOT_TAG ?? 'new'
const ROLE = process.env.SHOT_ROLE ?? 'chair'
const ONLY = (process.env.SHOT_ONLY ?? '').split(',').filter(Boolean)

/** 주요 12화면 — 대표 10 · 직원 2(내 홈 · 전자결재). 로그인은 대표 서버에서 찍는다(역할을 모르는 화면). */
const SCREENS: Record<string, { key: string; path: string }[]> = {
  chair: [
    { key: '01-dashboard', path: '/' },
    { key: '02-home', path: '/home' },
    { key: '03-e-approval', path: '/e-approval' },
    { key: '04-finance', path: '/finance' },
    { key: '05-finance-pl', path: '/finance?biz=biz_vana&tab=pl' },
    { key: '06-investment', path: '/investment' },
    { key: '07-memory', path: '/memory' },
    { key: '08-settings', path: '/settings' },
    { key: '09-users', path: '/settings/users' },
    { key: '12-login', path: '/login' },
  ],
  staff: [
    { key: '10-staff-me', path: '/me' },
    { key: '11-staff-e-approval', path: '/e-approval' },
  ],
}

const VIEWPORTS = [
  { key: 'pc', width: 1440, height: 900, mobile: false },
  { key: 'phone', width: 390, height: 844, mobile: true },
] as const

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 300_000 }).catch(() => undefined)
  await page
    .waitForFunction(() => document.querySelectorAll('[data-state="loading"]').length === 0, null, { timeout: 120_000 })
    .catch(() => undefined)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(600)
}

/** 예전 모양으로 저장한다(설정 → 화면 모양). 새 모양 시험이면 새 모양으로 되돌린다. */
async function chooseTheme(page: Page, theme: 'new' | 'classic') {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle', timeout: 300_000 })
  const pick = page.getByTestId(`ui-theme-${theme}`)
  await pick.waitFor({ timeout: 120_000 })
  if ((await pick.getAttribute('aria-checked')) !== 'true') {
    await pick.click()
    await page.waitForFunction((t) => document.getElementById('app-shell')?.getAttribute('data-ui') === t, theme, { timeout: 120_000 })
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    if (TAG === 'new' || TAG === 'classic') {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await chooseTheme(page, TAG)
      await page.close()
    }
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
      })
      const page = await ctx.newPage()
      for (const s of SCREENS[ROLE] ?? []) {
        if (ONLY.length && !ONLY.includes(s.key)) continue
        await page.goto(`${BASE}${s.path}`, { waitUntil: 'domcontentloaded', timeout: 300_000 })
        await settle(page)
        // 본문(main)이 스크롤하는 셸이라 전체 높이로 늘려 찍는다(최대 4000px).
        const h = await page.evaluate(() => (document.querySelector('main')?.scrollHeight ?? document.body.scrollHeight) + 120)
        await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 4000) })
        await page.waitForTimeout(500)
        const file = join(OUT, `${s.key}-${vp.key}-${TAG}.jpg`)
        await page.screenshot({ path: file, type: 'jpeg', quality: 72 })
        await page.setViewportSize({ width: vp.width, height: vp.height })
        console.log(`  ✓ ${file}`)
      }
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
