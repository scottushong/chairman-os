/**
 * 기억 엔진(0088) 화면 스크린숏 — dummy 서버 전용(로그인 없음 · 세션 = DUMMY_USER로 띄운 서버의 사람).
 *
 *   npx tsx scripts/shot-memory.ts <서버 주소> <이름 접두>
 *
 * 순서: 대시보드(빠른 기록 단추) → 빠른 기록 열고 저장 → /memory(남은 예시 처리) → 기록 하나 → 검토함 → 주의 → 회사 화면 · 폰 크기.
 * 결과: .screenshots/memory/<접두>-*.png
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from 'playwright'

async function main() {
  const [base, prefix] = process.argv.slice(2)
  if (!base || !prefix) throw new Error('사용: <서버 주소> <이름 접두>')
  const out = join('.screenshots', 'memory')
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  const shot = async (page: Page, name: string) => {
    await page.screenshot({ path: join(out, `${prefix}-${name}.png`), fullPage: true })
    console.log(`찍음 ${prefix}-${name}.png`)
  }
  const pc = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const go = async (page: Page, path: string, wait = 2500) => {
    const res = await page.goto(base + path, { waitUntil: 'load', timeout: 240_000 })
    await page.waitForTimeout(wait)
    return res?.status() ?? 0
  }
  console.log('/ ', await go(pc, '/'))
  const btn = pc.getByRole('button', { name: /빠른 기록 열기/ })
  console.log('빠른 기록 단추:', await btn.count())
  await shot(pc, '01-dashboard')
  if (await btn.count()) {
    await btn.click()
    await pc.getByLabel('기록 내용').fill('오늘 VANA AI 김 대표와 미팅했다. 다음 주 금요일까지 투자 조건안을 보내기로 했다. 밸류는 300억원으로 제안받았다.')
    await shot(pc, '02-capture-open')
    await pc.getByRole('button', { name: '저장', exact: true }).click()
    await pc.waitForTimeout(6000)
    await shot(pc, '03-capture-saved')
    await pc.keyboard.press('Escape')
  }
  console.log('/memory ', await go(pc, '/memory', 8000))
  await pc.reload({ waitUntil: 'load' })
  await pc.waitForTimeout(2500)
  await shot(pc, '04-memory')
  const first = pc.locator('a[href^="/memory/"]').filter({ hasNotText: '검토함' }).first()
  const href = await first.getAttribute('href').catch(() => null)
  if (href && href !== '/memory/review') {
    console.log(href, await go(pc, href))
    await shot(pc, '05-capture-detail')
  }
  console.log('/memory/review ', await go(pc, '/memory/review'))
  await shot(pc, '06-review')
  console.log('/memory?q=A회사 ', await go(pc, '/memory?q=' + encodeURIComponent('A회사')))
  await shot(pc, '07-search')
  console.log('/attention ', await go(pc, '/attention'))
  await shot(pc, '08-attention')
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  console.log('phone /memory ', await go(phone, '/memory'))
  await shot(phone, '09-phone-memory')
  const pbtn = phone.getByRole('button', { name: /빠른 기록 열기/ })
  if (await pbtn.count()) {
    await pbtn.click()
    await phone.waitForTimeout(500)
    await shot(phone, '10-phone-capture')
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
