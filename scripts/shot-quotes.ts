/**
 * 0066 견적 화면 스크린숏(dummy). 서버 하나(DUMMY_USER 하나)에 대고 돈다 — 새 견적(Green) 저장 → 확정, Red 저장 → «대표 승인 요청».
 *   SHOT_BASE=http://localhost:3101 SHOT_OUT=<폴더> SHOT_WHO=sales|chair npx tsx scripts/shot-quotes.ts
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3101'
const OUT = process.env.SHOT_OUT ?? '.screenshots/quotes'
const WHO = process.env.SHOT_WHO ?? 'sales'

async function fill(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: false }).first().fill(value)
}

async function newQuote(page: Page, price: string) {
  await page.goto(`${BASE}/sales/biz_dy/quotes`, { waitUntil: 'networkidle', timeout: 180_000 })
  await fill(page, '고객 이름', '김구매')
  await fill(page, '고객 회사', '(주)가짜식품')
  await fill(page, '수량', '1000')
  await fill(page, '제시가', price)
  await page.waitForTimeout(1500) // 등급 미리보기
  return page
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  // 제품 X 총원가를 영업 화면에서 읽어 Green(×2) · Red(÷0.9) 제시가를 만든다.
  await pc.goto(`${BASE}/sales/biz_dy`, { waitUntil: 'networkidle', timeout: 180_000 })
  const totalText = await pc.locator('tr', { hasText: '제품 X(가짜)' }).first().locator('td').nth(WHO === 'sales' ? 5 : 5).innerText()
  const total = Number(totalText.replace(/[^0-9]/g, ''))
  if (!total) throw new Error(`총원가를 못 읽었다: ${totalText}`)
  const green = String(total * 2)
  const red = String(Math.ceil(total / 0.9))

  await newQuote(pc, green)
  await pc.screenshot({ path: join(OUT, `${WHO}-pc-new-green.png`), fullPage: true })
  await pc.getByRole('button', { name: '견적 저장' }).click()
  await pc.waitForURL(/\/quotes\/qt_/, { timeout: 120_000 })
  await pc.getByRole('button', { name: '확정' }).click()
  await pc.waitForTimeout(2000)
  await pc.screenshot({ path: join(OUT, `${WHO}-pc-green-confirmed.png`), fullPage: true })

  await newQuote(pc, red)
  await pc.screenshot({ path: join(OUT, `${WHO}-pc-new-red.png`), fullPage: true })
  await pc.getByRole('button', { name: '견적 저장' }).click()
  await pc.waitForURL(/\/quotes\/qt_/, { timeout: 120_000 })
  const redUrl = pc.url()
  await pc.screenshot({ path: join(OUT, `${WHO}-pc-red-draft.png`), fullPage: true })
  if (WHO === 'sales') {
    await pc.getByRole('button', { name: '대표 승인 요청' }).click()
    await pc.waitForTimeout(2500)
    await pc.screenshot({ path: join(OUT, `${WHO}-pc-red-pending.png`), fullPage: true })
  }
  await pc.goto(`${BASE}/sales/biz_dy/quotes`, { waitUntil: 'networkidle' })
  await pc.screenshot({ path: join(OUT, `${WHO}-pc-list.png`), fullPage: true })

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await phone.goto(`${BASE}/sales/biz_dy/quotes`, { waitUntil: 'networkidle', timeout: 180_000 })
  await phone.screenshot({ path: join(OUT, `${WHO}-phone-list.png`), fullPage: true })
  await phone.goto(redUrl, { waitUntil: 'networkidle', timeout: 180_000 })
  await phone.screenshot({ path: join(OUT, `${WHO}-phone-red.png`), fullPage: true })
  await browser.close()
  console.log(`OK ${WHO}: total ${total} green ${green} red ${red} → ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
