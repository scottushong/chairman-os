/**
 * 프로세스 차트 동기화(0071) 스크린숏 — dummy 서버 하나(가짜 시트 응답, 진짜 구글 호출 없음)에 대고 돈다.
 *   SHOT_BASE=http://localhost:3103 SHOT_OUT=.screenshots/process-charts SHOT_KIND=staff|exec|chair npx tsx scripts/shot-process-charts.ts
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3103'
const OUT = process.env.SHOT_OUT ?? '.screenshots/process-charts'
const KIND = process.env.SHOT_KIND ?? 'staff'

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    const pc = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    await pc.goto(`${BASE}/process-charts`, { waitUntil: 'networkidle', timeout: 240_000 })
    await pc.waitForTimeout(2500)
    const tabs = await pc.getByRole('tab').allInnerTexts().catch(() => [])
    console.log('tabs', JSON.stringify(tabs))
    await pc.screenshot({ path: join(OUT, `${KIND}-1-pc.png`), fullPage: true })
    if (KIND === 'exec') {
      const rnd = pc.getByText('연구소').first()
      if (await rnd.count()) {
        await rnd.click()
        await pc.waitForTimeout(1500)
        await pc.screenshot({ path: join(OUT, `${KIND}-2-pc-rnd-before-connect.png`), fullPage: true })
      }
    }
    if (KIND === 'chair') {
      const btn = pc.getByRole('button', { name: /지금 동기화/ }).first()
      if (await btn.isEnabled().catch(() => false)) {
        await btn.click()
        await pc.waitForTimeout(3000)
        await btn.click().catch(() => {})
        await pc.waitForTimeout(2000)
      }
      for (const d of await pc.locator('details').all()) await d.evaluate((el) => ((el as HTMLDetailsElement).open = true)).catch(() => {})
      await pc.screenshot({ path: join(OUT, `${KIND}-2-pc-sync-log.png`), fullPage: true })
    }
    if (KIND === 'staff') {
      await pc.goto(`${BASE}/tasks`, { waitUntil: 'networkidle', timeout: 240_000 })
      await pc.waitForTimeout(1500)
      await pc.screenshot({ path: join(OUT, `${KIND}-3-pc-tasks.png`), fullPage: true })
    }
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await phone.goto(`${BASE}/process-charts`, { waitUntil: 'networkidle', timeout: 240_000 })
    await phone.waitForTimeout(1500)
    await phone.screenshot({ path: join(OUT, `${KIND}-9-phone.png`), fullPage: true })
    if (KIND !== 'chair' && /회장|chairman/i.test(await phone.locator('body').innerText())) throw new Error('직원 화면에 «회장»')
    console.log('ok')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
