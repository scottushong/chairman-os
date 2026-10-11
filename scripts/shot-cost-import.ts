/**
 * 엑셀 넣기(0068) 스크린숏 — dummy 서버 하나(대표 세션)에 대고 돈다. 파일은 전부 가짜 값이다.
 *   SHOT_BASE=http://localhost:3100 SHOT_OUT=<폴더> npx tsx scripts/shot-cost-import.ts
 * 시장가: 칸 맞추기 → 상태(새 줄 · 같은 줄 · 충돌 · 파일 안 충돌 · 오류) → 고치기(색) → 바꾸기 이유 없음 잠김 → 등록 → 같은 파일 두 번 잠김 · 폰.
 * BOM: 대표 화면 미리보기. 빈 양식: 내려받아 칸이 고정 문구뿐인지.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import ExcelJS from 'exceljs'
import { chromium, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3100'
const OUT = process.env.SHOT_OUT ?? '.screenshots/excel-import'

const kst = (n: number) => new Date(Date.now() + 9 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10)

async function xlsx(path: string, rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('자료')
  for (const r of rows) ws.addRow(r)
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()))
}

async function open(page: Page, url: string, file: string) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 240_000 })
  await page.locator('section[aria-label$="엑셀로 넣기"]').first().getByRole('button', { name: '엑셀로 넣기', exact: true }).click()
  await page.locator('input[type=file]').first().setInputFiles(file)
  await page.getByText('칸 맞추기').first().waitFor({ timeout: 120_000 })
  await page.waitForTimeout(800)
}

/** 패널만 찍는다 — 본문이 안쪽 스크롤 칸이라 fullPage는 잘린다. */
async function shot(page: Page, name: string) {
  const panel = page.locator('section[aria-label$="엑셀로 넣기"]').first()
  if (await panel.count()) await panel.screenshot({ path: join(OUT, name) })
  else await page.screenshot({ path: join(OUT, name), fullPage: true })
}

async function confirmMapping(page: Page) {
  await page.getByRole('button', { name: '이 칸 지정으로 미리보기' }).click()
  await page.waitForTimeout(2500)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const market = join(OUT, 'market-fake.xlsx')
  await xlsx(market, [
    ['원료', '날짜', '가격', '통화', '출처'],
    ['원료 A(가짜)', kst(0), 2450, 'KRW', '엑셀 시험(가짜)'], // 새 줄
    ['포장재 D(가짜)', kst(-7), 360, 'KRW', '구매팀 조사'], // 같은 줄
    ['부원료 C(가짜)', kst(-2), 5300, 'KRW', '구매팀 조사'], // 충돌(기존)
    ['없는 원료(가짜)', kst(0), 1000, 'KRW', '엑셀 시험(가짜)'], // 오류
    ['원료 B(가짜)', kst(-1), 1.9, 'USD', '엑셀 시험 B(가짜)'], // 파일 안 충돌
    ['원료 B(가짜)', kst(-1), 1.95, 'USD', '엑셀 시험 B(가짜)'], // 파일 안 충돌
  ])
  const browser = await chromium.launch()
  const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const url = `${BASE}/purchasing/biz_dy/market`
  await open(pc, url, market)
  await shot(pc, '01-pc-market-mapping.png')
  await confirmMapping(pc)
  await shot(pc, '02-pc-market-statuses.png')

  // 고치기: 오류 줄(5행)의 원료 칸
  await pc.getByRole('button', { name: /없는 원료\(가짜\)/ }).first().click()
  await pc.getByLabel('5행 원료 새 값').fill('부원료 C(가짜)')
  await pc.getByRole('button', { name: '저장', exact: true }).first().click()
  await pc.waitForTimeout(2500)
  // 바꾸기만 고르고 이유는 비움 → 잠김
  await pc.getByRole('radio', { name: '엑셀 값으로 바꾸기' }).first().check()
  // 파일 안 충돌: 7행은 기존 유지(버림)
  const keeps = pc.getByRole('radio', { name: '이 줄 버림' })
  await keeps.last().check()
  await pc.waitForTimeout(500)
  await shot(pc, '03-pc-market-edited-locked.png')
  await pc.getByLabel('4행 바꾸는 이유').fill('구매팀 재조사(가짜)')
  // 6행(파일 안 충돌의 짝)도 처리 — 남은 충돌 라디오에 «기존 유지»가 아니면 6행은 새 줄로 돌아온다
  await pc.waitForTimeout(500)
  await shot(pc, '04-pc-market-ready.png')
  const commit = pc.getByRole('button', { name: '등록', exact: true })
  if (await commit.isEnabled()) {
    await commit.click()
    await pc.waitForTimeout(4000)
  }
  await shot(pc, '05-pc-market-done.png')

  // 같은 파일 두 번 → 잠김
  await open(pc, url, market)
  await confirmMapping(pc)
  await shot(pc, '06-pc-market-same-file.png')

  // 폰
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await open(phone, url, market)
  await confirmMapping(phone)
  await shot(phone, '07-phone-market-preview.png')
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  console.log(`phone page horizontal overflow: ${overflow}px`)

  // 구매 LOT: 중복 의심
  const lots = join(OUT, 'lots-fake.xlsx')
  await xlsx(lots, [
    ['원료', '공급처', '입고일', 'kg', '단가', '통화', '운송', '공급처 LOT 번호'],
    ['원료 A(가짜)', '가짜상사(국내)', kst(-3), 1800, 2480, 'KRW', 110000, 'KR-2410-09'], // 중복 의심(값까지 같음)
    ['원료 A(가짜)', '가짜상사(국내)', kst(0), 500, 2500, 'KRW', 0, 'KR-NEW-01'], // 새 줄
  ])
  await open(pc, `${BASE}/purchasing/biz_dy/lots`, lots)
  await confirmMapping(pc)
  await shot(pc, '08-pc-lots-duplicate.png')

  // 비용 줄
  const oh = join(OUT, 'overheads-fake.xlsx')
  await xlsx(oh, [
    ['항목', '방식', '금액', '범위', '시작일'],
    ['전기', '월 금액', 1234567, '', kst(1)],
    ['없는항목', '월 금액', 1, '', kst(1)],
  ])
  await open(pc, `${BASE}/costs/biz_dy`, oh)
  await confirmMapping(pc)
  await shot(pc, '09-pc-overheads.png')

  // BOM(대표)
  const bom = join(OUT, 'bom-fake.xlsx')
  await xlsx(bom, [
    ['R2 내보내기(가짜)'],
    ['제품명', '적용일', '수율', '자재명', '소요량'],
    ['제품 X(가짜)', kst(5), 95, '원료 A(가짜)', 0.6],
    ['제품 X(가짜)', kst(5), 95, '부원료 C(가짜)', 0.45],
  ])
  await open(pc, `${BASE}/costs/biz_dy/bom`, bom)
  await confirmMapping(pc)
  await shot(pc, '10-pc-bom-preview.png')

  // 빈 양식 — 실제 자료 0
  const res = await pc.request.get(`${BASE}/cost-import/template/market_prices`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer)
  const cells: string[] = []
  wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => cells.push(String(c.value ?? '')))))
  const leaked = cells.filter((c) => /원료 A|Platts|거래처 시세|가짜상사/.test(c))
  console.log(`template status ${res.status()} · cells ${cells.length} · real data cells ${leaked.length}`)

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
