/**
 * 0089 «이 열은 무엇입니까?» 스크린숏 — dummy 서버(DUMMY_USER=support_lead · 진짜 AI 0회)에 가짜 판매현황(우리 낱말에 없는 열 «판가» · «규격»)을 올린다.
 *   SHOT_BASE=http://localhost:3201 SHOT_OUT=docs/onboarding/finance-shots-1020 npx tsx scripts/shot-finance-mapping.ts
 * 파일 값은 전부 지어낸 것이다. PC 1280 · 폰 390(가로 넘침 검사).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import ExcelJS from 'exceljs'
import { chromium, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3201'
const OUT = process.env.SHOT_OUT ?? 'docs/onboarding/finance-shots-1020'

async function file(path: string, ym: string) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('판매현황')
  ws.addRow([`회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28 / 판매현황`])
  ws.addRow([null, null, '(단위 : 원)'])
  ws.addRow(['전표일자', '매출처명', '상품명', '판매량', '판가', '매출액', '규격'])
  ws.addRow([`${ym}-03`, '가짜 거래처 A', '가짜 제품 1', 10, 1000, 10000, '25kg'])
  ws.addRow([`${ym}-09`, '가짜 거래처 B', '가짜 제품 2', 5, 2000, 10000, '20kg'])
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()))
}

async function shoot(page: Page, name: string, width: number, save: boolean) {
  await page.goto(`${BASE}/finance/biz_dy/upload`, { waitUntil: 'networkidle', timeout: 240_000 })
  const p = join(tmpdir(), `fake-sales-${width}.xlsx`)
  await file(p, width > 500 ? '2088-01' : '2088-02')
  await page.locator('input[type=file]').setInputFiles(p)
  await page.getByTestId('ask-columns').waitFor({ timeout: 120_000 })
  await page.getByLabel('판가 열').selectOption('unit_price')
  await page.getByLabel('규격 열').selectOption('-')
  await page.getByTestId('just-uploaded').scrollIntoViewIfNeeded()
  if (width < 500) {
    const w = await page.evaluate(() => document.documentElement.scrollWidth)
    if (w > 391) throw new Error(`폰 가로 넘침 ${w}px`)
  }
  await page.getByTestId('just-uploaded').screenshot({ path: join(OUT, name) })
  if (!save) return
  // 저장 단추까지 — 저장 뒤 문구(PC는 저장하지 않는다 — 폰이 같은 열을 다시 물어야 한다).
  await page.getByRole('button', { name: '열 맞춤 저장' }).click()
  await page.getByText(/저장했습니다 — 열 2개/).waitFor({ timeout: 60_000 })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    const pc = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    await shoot(pc, 'ask-columns-1280.png', 1280, false)
    const phone = await browser.newPage({ viewport: { width: 390, height: 1400 }, isMobile: true, hasTouch: true })
    await shoot(phone, 'ask-columns-390.png', 390, true)
    console.log(`PASS: ${OUT}/ask-columns-1280.png · ask-columns-390.png (폰 가로 넘침 없음 · 저장 문구 확인)`)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
