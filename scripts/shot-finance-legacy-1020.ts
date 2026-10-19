/**
 * 2026-10-20 A2 · A5 스크린숏 — dummy 서버 하나에 대고 돈다(진짜 AI 0회 · 가짜 값만).
 *   대표: SHOT_BASE=http://localhost:3202 SHOT_KIND=chair npx tsx scripts/shot-finance-legacy-1020.ts   (서버 DUMMY_USER=chairman)
 *   직원: SHOT_BASE=http://localhost:3202 SHOT_KIND=staff npx tsx scripts/shot-finance-legacy-1020.ts   (서버 DUMMY_USER=teamless_staff)
 * 결과: docs/onboarding/finance-shots-1020/ — 1280px · 390px. 앱 본문 칸이 스크롤이라 뷰포트를 키워 찍는다.
 * 검사도 겸한다: 대표 — «원본 보기 ›» 메뉴 · 손익계산서 탭 아래 마감 · 조정 · 설정 · «예전 자료 가져오기» 두 번(두 번째 0) · 옛 주소 → 탭.
 *                직원 — «원본 보기» · «예전 자료 가져오기» 없음 · «회장/Chairman» 0 · 폰 가로 넘침 없음.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3202'
const OUT = process.env.SHOT_OUT ?? 'docs/onboarding/finance-shots-1020'
const KIND = process.env.SHOT_KIND ?? 'chair'
const BIZ = 'biz_dy'
const M = '2026-09'

async function open(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 300_000 })
  await page.waitForTimeout(800)
}
async function noOverflow(page: Page, what: string) {
  const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('main, [data-app-main]')].map((e) => e.scrollWidth)))
  if (w > 391) throw new Error(`${what}: 폰 가로 넘침 ${w}px`)
}
async function noBoss(page: Page, what: string) {
  const t = await page.locator('body').innerText()
  if (/회장|Chairman|CHAIRMAN/.test(t)) throw new Error(`${what}: 직원 화면에 «회장/Chairman»: ${t.match(/.{0,30}(회장|Chairman|CHAIRMAN).{0,30}/)?.[0]}`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const shots: string[] = []
  const shoot = async (page: Page, name: string) => {
    const path = join(OUT, name)
    await page.screenshot({ path, fullPage: false })
    shots.push(path)
  }
  try {
    const pc = await browser.newPage({ viewport: { width: 1280, height: 1500 } })
    const phone = await browser.newPage({ viewport: { width: 390, height: 2200 }, isMobile: true, hasTouch: true })

    if (KIND === 'chair') {
      // 1. 재무 현황 — 오른쪽 위 «원본 보기 ›»(펼침)
      await open(pc, `/finance?biz=${BIZ}&month=${M}`)
      await pc.getByTestId('originals-menu').locator('summary').click()
      await pc.getByRole('link', { name: '전표' }).first().waitFor()
      await shoot(pc, 'chair-finance-originals-pc.png')
      // 2. 손익계산서 탭 아래 마감 · 조정 · 설정
      await open(pc, `/finance?biz=${BIZ}&tab=pl&month=${M}`)
      const close = pc.getByTestId('pl-close')
      await close.waitFor({ timeout: 120_000 })
      await close.locator('summary').first().click().catch(() => undefined)
      await close.scrollIntoViewIfNeeded()
      await close.screenshot({ path: join(OUT, 'chair-pl-close-pc.png') })
      shots.push(join(OUT, 'chair-pl-close-pc.png'))
      const closeText = await close.innerText()
      for (const w of ['내부 마감', '조정 제안', '설정']) if (!closeText.includes(w)) throw new Error(`손익계산서 탭 아래에 «${w}»가 없다`)
      // 3. 옛 주소 → 손익계산서 탭
      await open(pc, `/finance/${BIZ}/monthly?year=2026&pl=${M}`)
      if (!/\/finance\?biz=biz_dy&tab=pl&month=2026-09/.test(pc.url())) throw new Error(`옛 월별 주소가 손익계산서 탭으로 가지 않았다: ${pc.url()}`)
      // 4. 자료 올리기 — «예전 자료 가져오기» 한 번 · 두 번
      await open(pc, `/finance/${BIZ}/upload?month=${M}`)
      const box = pc.getByTestId('legacy-import')
      await box.getByRole('button', { name: '예전 자료 가져오기' }).click()
      await box.getByRole('status').waitFor({ timeout: 280_000 })
      await box.getByRole('button', { name: '예전 자료 가져오기' }).waitFor({ timeout: 120_000 })
      await pc.waitForTimeout(1000)
      await shoot(pc, 'chair-upload-legacy-1st-pc.png')
      await box.getByRole('button', { name: '예전 자료 가져오기' }).click()
      await pc.waitForFunction(() => /새로 옮길 것이 없습니다/.test(document.querySelector('[data-testid="legacy-import"] [role="status"]')?.textContent ?? ''), null, { timeout: 280_000 })
      await box.getByRole('button', { name: '예전 자료 가져오기' }).waitFor({ timeout: 120_000 })
      await pc.waitForTimeout(1000)
      await shoot(pc, 'chair-upload-legacy-2nd-pc.png')
      // 폰
      await open(phone, `/finance?biz=${BIZ}&month=${M}`)
      await phone.getByTestId('originals-menu').locator('summary').click()
      await noOverflow(phone, '대표 재무 현황(폰)')
      await shoot(phone, 'chair-finance-originals-phone.png')
      await open(phone, `/finance?biz=${BIZ}&tab=pl&month=${M}`)
      await phone.getByTestId('pl-close').scrollIntoViewIfNeeded()
      await noOverflow(phone, '대표 손익계산서(폰)')
      await phone.getByTestId('pl-close').screenshot({ path: join(OUT, 'chair-pl-close-phone.png') })
      shots.push(join(OUT, 'chair-pl-close-phone.png'))
      await open(phone, `/finance/${BIZ}/upload?month=${M}`)
      await noOverflow(phone, '대표 자료 올리기(폰)')
      await shoot(phone, 'chair-upload-legacy-phone.png')
    } else {
      for (const [page, dev] of [[pc, 'pc'], [phone, 'phone']] as const) {
        await open(page, `/finance?biz=${BIZ}&month=${M}`)
        if (await page.getByTestId('originals-menu').count()) throw new Error('직원에게 «원본 보기»가 보인다')
        await noBoss(page, `직원 재무 현황(${dev})`)
        if (dev === 'phone') await noOverflow(page, '직원 재무 현황(폰)')
        await shoot(page, `staff-finance-${dev}.png`)
        await open(page, `/finance?biz=${BIZ}&tab=pl&month=${M}`)
        await noBoss(page, `직원 손익계산서(${dev})`)
        await shoot(page, `staff-pl-${dev}.png`)
        await open(page, `/finance/${BIZ}/upload?month=${M}`)
        if (await page.getByTestId('legacy-import').count()) throw new Error('직원에게 «예전 자료 가져오기»가 보인다')
        await noBoss(page, `직원 자료 올리기(${dev})`)
        if (dev === 'phone') await noOverflow(page, '직원 자료 올리기(폰)')
        await shoot(page, `staff-upload-${dev}.png`)
      }
      await open(pc, `/finance/${BIZ}/monthly`)
      if (!/\/finance\?biz=biz_dy&tab=pl/.test(pc.url())) throw new Error(`직원 — 옛 월별 주소가 손익계산서 탭으로 가지 않았다: ${pc.url()}`)
    }
    console.log(`PASS ${KIND}: ${shots.join(' · ')}`)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
