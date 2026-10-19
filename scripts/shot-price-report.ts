/**
 * 가격 리포트 HTML 스크린숏(PC 1280 · 폰 390) — 기준 화면(엔진 dry-run)과 앱 화면을 같은 크기로 찍어 비교한다.
 *
 *   npx tsx scripts/shot-price-report.ts file <html 경로> <이름>
 *   npx tsx scripts/shot-price-report.ts url <주소> <이름> [DUMMY 쿠키 없음 — dummy 서버 전용]
 *
 * 결과: .screenshots/price-report/<이름>-pc.png · <이름>-phone.png
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

async function main() {
  const [mode, target, name] = process.argv.slice(2)
  if (!mode || !target || !name) throw new Error('사용: file|url <경로|주소> <이름>')
  const url = mode === 'file' ? pathToFileURL(resolve(target)).href : target
  const out = join('.screenshots', 'price-report')
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  for (const [tag, viewport] of [['pc', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'load', timeout: 180_000 })
    await page.waitForTimeout(mode === 'url' ? 3000 : 500)
    await page.screenshot({ path: join(out, `${name}-${tag}.png`), fullPage: true })
    await page.close()
  }
  await browser.close()
  console.log(`찍음: ${out}/${name}-pc.png · ${name}-phone.png`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
