/**
 * 0066 견적 화면 스크린숏(dummy). 서버 하나(DUMMY_USER 하나)에 대고 돈다 — 새 견적(Green) 저장 → 확정, Red 저장 → «대표 승인 요청».
 *   SHOT_BASE=http://localhost:3101 SHOT_OUT=<폴더> SHOT_WHO=sales|chair npx tsx scripts/shot-quotes.ts
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import ExcelJS from 'exceljs'
import { chromium, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3101'
const OUT = process.env.SHOT_OUT ?? '.screenshots/quotes'
const WHO = process.env.SHOT_WHO ?? 'sales'

// 직원 화면에 나오면 안 되는 말(«회장» · 원료 이름 · 공급처). 대표(SHOT_WHO=chair)는 원료 검사만 건너뛴다.
const BANNED = ['회장', '원료 A(가짜)', '원료 B(가짜)', '부원료 C(가짜)', '포장재 D(가짜)', '가짜상사', 'Fake Supply']
const seen: string[] = []
async function scan(page: Page, where: string) {
  const text = await page.locator('main').innerText().catch(() => page.locator('body').innerText())
  for (const bad of BANNED) if (text.includes(bad)) seen.push(`${where}: «${bad}»`)
}

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
  await scan(pc, 'Green 확정 상세')
  // 고객용 견적서(xlsx) — 내려받아 칸을 그대로 표로 그려 찍는다(원가 · 마진 · 등급이 없어야 한다).
  const xres = await pc.request.get(`${pc.url().replace(/[?#].*$/, '')}/download`)
  if (!xres.ok()) throw new Error(`견적서 내려받기 ${xres.status()}`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await xres.body()) as unknown as ArrayBuffer)
  const rows: string[][] = []
  wb.worksheets[0].eachRow((r) => rows.push((r.values as unknown[]).slice(1).map((v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)))))
  const flat = rows.flat().join(' ')
  for (const bad of ['원가', '마진', '등급', 'Green', 'green', ...BANNED]) if (flat.includes(bad)) seen.push(`고객용 견적서: «${bad}»`)
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const html = `<meta charset="utf-8"><body style="font-family:sans-serif;padding:16px"><h3>고객용 견적서(xlsx 칸 그대로)</h3><table border="1" cellpadding="6" style="border-collapse:collapse">${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></body>`
  const sheetPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await sheetPage.setContent(html)
  await sheetPage.screenshot({ path: join(OUT, `${WHO}-pc-customer-quote.png`), fullPage: true })
  await sheetPage.setViewportSize({ width: 390, height: 844 })
  await sheetPage.screenshot({ path: join(OUT, `${WHO}-phone-customer-quote.png`), fullPage: true })
  await sheetPage.close()

  await newQuote(pc, red)
  await pc.screenshot({ path: join(OUT, `${WHO}-pc-new-red.png`), fullPage: true })
  await pc.getByRole('button', { name: '견적 저장' }).click()
  await pc.waitForURL(/\/quotes\/qt_/, { timeout: 120_000 })
  const redUrl = pc.url()
  let approvalUrl = ''
  await pc.screenshot({ path: join(OUT, `${WHO}-pc-red-draft.png`), fullPage: true })
  if (WHO === 'sales') {
    await pc.getByRole('button', { name: '대표 승인 요청' }).click()
    await pc.waitForTimeout(2500)
    await pc.screenshot({ path: join(OUT, `${WHO}-pc-red-pending.png`), fullPage: true })
    await scan(pc, 'Red 승인 대기 상세')
    // 결재 상세 «가격 예외» — 양식 칸에 마진 %가 없어야 한다(리뷰 I1).
    const href = await pc.getByRole('link', { name: '결재 진행 중' }).first().getAttribute('href')
    await pc.goto(`${BASE}${href}`, { waitUntil: 'networkidle', timeout: 180_000 })
    await pc.getByText('가격 예외').first().waitFor({ timeout: 120_000 })
    await pc.waitForTimeout(1500)
    await pc.screenshot({ path: join(OUT, `${WHO}-pc-approval-price-exception.png`), fullPage: true })
    approvalUrl = pc.url()
    const atext = await pc.locator('body').innerText()
    if (!atext.includes('가격 예외')) seen.push('결재 상세: «가격 예외» 양식이 안 보인다')
    if (/마진\s*%|margin_pct/.test(atext)) seen.push('결재 상세: 마진 % 칸')
    await scan(pc, '결재 상세')
  }
  await pc.goto(`${BASE}/sales/biz_dy/quotes`, { waitUntil: 'networkidle' })
  await pc.screenshot({ path: join(OUT, `${WHO}-pc-list.png`), fullPage: true })
  await scan(pc, '견적 목록')

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await phone.goto(`${BASE}/sales/biz_dy/quotes`, { waitUntil: 'networkidle', timeout: 180_000 })
  await phone.screenshot({ path: join(OUT, `${WHO}-phone-list.png`), fullPage: true })
  await phone.goto(redUrl, { waitUntil: 'networkidle', timeout: 180_000 })
  await phone.screenshot({ path: join(OUT, `${WHO}-phone-red.png`), fullPage: true })
  await phone.goto(`${BASE}/sales/biz_dy/quotes`, { waitUntil: 'networkidle', timeout: 180_000 })
  await fill(phone, '제시가', green)
  await phone.waitForTimeout(1500)
  await phone.screenshot({ path: join(OUT, `${WHO}-phone-new-green.png`), fullPage: true })
  if (approvalUrl) {
    await phone.goto(approvalUrl, { waitUntil: 'networkidle', timeout: 180_000 })
    await phone.waitForTimeout(1500)
    await phone.screenshot({ path: join(OUT, `${WHO}-phone-approval-price-exception.png`), fullPage: true })
  }
  await browser.close()
  const bad = WHO === 'chair' ? seen.filter((x) => !x.includes('회장') && !x.includes('고객용')) : seen
  console.log(bad.length ? `금지어 ${bad.length}건:\n  ${bad.join('\n  ')}` :'금지어 0건(«회장» · 원료 이름 · 공급처 · 견적서 원가/마진/등급)')
  console.log(`OK ${WHO}: total ${total} green ${green} red ${red} → ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
