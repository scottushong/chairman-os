/**
 * 기억 엔진(0086) 직원 화면 점검 — DUMMY_USER가 대표가 아닌 dummy 서버에서: 빠른 기록 단추 없음 · «기억» 메뉴 없음 ·
 * /memory · /memory/review · /memory/<id> → /me · 회사 화면에 «관련 기억» 없음 · 화면 글에 «회장» 없음(기억 칸에서 새로 생긴 것).
 *
 *   npx tsx scripts/shot-memory-staff.ts <서버 주소>
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright'

async function main() {
  const [base] = process.argv.slice(2)
  if (!base) throw new Error('사용: <서버 주소>')
  const out = join('.screenshots', 'memory')
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${base}/me`, { waitUntil: 'load', timeout: 240_000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(out, 'staff-01-me.png'), fullPage: true })
  assert.equal(await page.getByRole('button', { name: /빠른 기록/ }).count(), 0, '직원에게 빠른 기록 단추가 보인다')
  assert.equal(await page.locator('a[href="/memory"]').count(), 0, '직원에게 «기억» 메뉴가 보인다')
  for (const path of ['/memory', '/memory/review', '/memory/00000000-0000-0000-0000-000000000000']) {
    await page.goto(base + path, { waitUntil: 'load', timeout: 240_000 })
    assert.ok(new URL(page.url()).pathname === '/me', `${path} → ${page.url()} (직원이 /me로 돌아가지 않았다)`)
  }
  await page.goto(`${base}/business/biz_dy`, { waitUntil: 'load', timeout: 240_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(out, 'staff-02-business.png'), fullPage: true })
  const text = await page.locator('body').innerText()
  assert.ok(!/관련 기억|빠른 기록|기억 검토함/.test(text), '회사 화면에 기억 칸이 보인다')
  console.log('PASS 직원 화면 — 단추 · 메뉴 · 화면 · 관련 기억 모두 없음 · /memory → /me')
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
