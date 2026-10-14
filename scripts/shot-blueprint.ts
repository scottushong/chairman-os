/**
 * 0081 청사진 뼈대 화면 스크린숏(dummy). 서버 하나(DUMMY_USER 하나 · DUMMY_FEATURES_OPEN=1)에 대고 돈다.
 *   SHOT_BASE=http://localhost:3102 SHOT_OUT=<폴더> SHOT_WHO=chair|costing|sales|prod npx tsx scripts/shot-blueprint.ts
 * 직원 자리(chair 외)는 «회장» · 원료 이름이 화면에 보이면 실패로 센다.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3102'
const OUT = process.env.SHOT_OUT ?? '.screenshots/blueprint'
const WHO = process.env.SHOT_WHO ?? 'chair'

const BANNED_STAFF = ['회장', 'Chairman', '원료 A(가짜)', '원료 B(가짜)', '부원료 C(가짜)', '포장재 D(가짜)']
const notes: string[] = []

async function scan(page: Page, where: string) {
  if (WHO === 'chair') return
  const text = await page.locator('main').innerText().catch(() => page.locator('body').innerText())
  for (const bad of BANNED_STAFF) if (text.includes(bad)) notes.push(`BANNED ${where}: «${bad}»`)
}

async function shot(page: Page, path: string, name: string) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 240_000 })
  const status = res?.status() ?? 0
  notes.push(`${name} ${path} → ${status}`)
  await page.screenshot({ path: join(OUT, `${WHO}-${name}.png`), fullPage: true })
  await scan(page, name)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
  const routes: [string, string][] = {
    chair: [
      ['dashboard', '/'],
      ['costs', '/costs/biz_dy'],
      ['purchasing-perf', '/purchasing/biz_dy?tab=performance'],
      ['market', '/purchasing/biz_dy/market'],
      ['customers', '/finance/biz_dy/customers'],
      ['competitor', '/costs/biz_dy/competitor'],
      ['quotes', '/sales/biz_dy/quotes'],
      ['production', '/production/biz_dy'],
      ['bom-import', '/costs/biz_dy/bom/import'],
      ['product-x', '/costs/biz_dy/products/prd_fake_x'],
    ],
    costing: [
      ['costs', '/costs/biz_dy'],
      ['purchasing-perf', '/purchasing/biz_dy?tab=performance'],
      ['customers', '/finance/biz_dy/customers'],
      ['competitor', '/costs/biz_dy/competitor'],
      ['product-x', '/costs/biz_dy/products/prd_fake_x'],
      ['bom-import', '/costs/biz_dy/bom/import'],
    ],
    sales: [
      ['quotes', '/sales/biz_dy/quotes'],
      ['customers', '/finance/biz_dy/customers'],
      ['product-x', '/costs/biz_dy/products/prd_fake_x'],
      ['competitor', '/costs/biz_dy/competitor'],
      ['purchasing-perf', '/purchasing/biz_dy?tab=performance'],
      ['bom-import', '/costs/biz_dy/bom/import'],
    ],
    prod: [
      ['production', '/production/biz_dy'],
      ['product-x', '/costs/biz_dy/products/prd_fake_x'],
      ['bom-import', '/costs/biz_dy/bom/import'],
    ],
  }[WHO] as [string, string][]
  for (const [name, path] of routes) await shot(pc, path, `pc-${name}`)

  // 작업지시 한 장 — 생산 목록의 첫 «작업지시 보기».
  if (WHO === 'chair' || WHO === 'prod') {
    await pc.goto(`${BASE}/production/biz_dy`, { waitUntil: 'networkidle', timeout: 240_000 })
    const link = pc.getByRole('link', { name: /작업지시 보기/ }).first()
    const href = (await link.count()) > 0 ? await link.getAttribute('href') : null
    if (href) await shot(pc, href, 'pc-work-order')
    else notes.push('pc-work-order: 링크 없음')
  }
  // 제품 진단 폰
  await shot(phone, '/costs/biz_dy/products/prd_fake_x', 'phone-product-x')

  writeFileSync(join(OUT, `${WHO}-notes.txt`), notes.join('\n') + '\n')
  console.log(notes.join('\n'))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
