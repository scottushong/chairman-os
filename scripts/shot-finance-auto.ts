/**
 * 0091 «자동으로 정한 것» 스크린숏 — dummy 서버 하나에 대고 돈다(진짜 AI 0회 · 가짜 값만).
 *   SHOT_BASE=http://localhost:3191 npx tsx scripts/shot-finance-auto.ts   (서버 DUMMY_USER=teamless_staff · NEXT_PUBLIC_DATA_MODE=dummy)
 * 결과: docs/onboarding/finance-auto-shots/ — 1280px · 390px.
 * 검사도 겸한다: 한 줄 «자동으로 정한 것 N건 ›» → 펼침 → 규칙 · 근거 · 고치기 · 체크표 «빼기» · 손익계산서 재고 평가 칸(출처) ·
 *   «회장/Chairman» 0(직원 화면) · 폰 가로 넘침 없음.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3191'
const OUT = process.env.SHOT_OUT ?? 'docs/onboarding/finance-auto-shots'
const BIZ = 'biz_dy'
const M = process.env.SHOT_MONTH ?? '2026-09'

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
  try {
    const pc = await browser.newPage({ viewport: { width: 1280, height: 1800 } })
    const phone = await browser.newPage({ viewport: { width: 390, height: 2600 }, isMobile: true, hasTouch: true })

    await open(pc, `/finance?biz=${BIZ}&month=${M}`)
    const list = pc.getByTestId('auto-list')
    const count = await list.count()
    console.log(`자동으로 정한 것 줄: ${count ? await list.locator('summary').innerText() : '없음(0건)'}`)
    await pc.screenshot({ path: join(OUT, 'summary-closed-pc.png') })
    shots.push('summary-closed-pc.png')
    if (count) {
      await list.locator('summary').click()
      await list.locator('li').first().waitFor()
      await list.screenshot({ path: join(OUT, 'auto-list-open-pc.png') })
      shots.push('auto-list-open-pc.png')
    }
    const checklist = pc.getByTestId('checklist')
    await checklist.scrollIntoViewIfNeeded()
    await checklist.screenshot({ path: join(OUT, 'checklist-withdraw-pc.png') })
    shots.push('checklist-withdraw-pc.png')
    console.log(`체크표 «빼기» 단추: ${await checklist.getByRole('button', { name: '빼기' }).count()}개`)
    await noBoss(pc, '요약')

    await open(pc, `/finance?biz=${BIZ}&tab=pl&month=${M}`)
    const val = pc.getByTestId('valuation-edit')
    if (await val.count()) {
      await val.scrollIntoViewIfNeeded()
      await val.getByRole('button', { name: '고치기' }).first().click()
      await val.screenshot({ path: join(OUT, 'pl-valuation-edit-pc.png') })
      shots.push('pl-valuation-edit-pc.png')
      console.log(`손익계산서 재고 평가: ${(await val.innerText()).replace(/\s+/g, ' ').slice(0, 160)}`)
    } else console.log('손익계산서 재고 평가 칸 없음')
    await noBoss(pc, '손익계산서')

    // 눌러 보기(SHOT_FLOW=on — dummy 저장소에 남는다: 서버를 다시 켜면 처음으로) — 고치기 → «고침» → 자동으로 돌리기 → «빼기» → 다시 계산.
    if (process.env.SHOT_FLOW === 'on' && (await val.count())) {
      await val.getByLabel('재공품 금액').fill('2000000')
      await val.getByRole('button', { name: '저장' }).click()
      await pc.waitForFunction(() => /2,000,000원\s*고침/.test(document.querySelector('[data-testid="valuation-edit"]')?.textContent ?? ''), null, { timeout: 120_000 })
      await open(pc, `/finance?biz=${BIZ}&tab=pl&month=${M}`)
      const l = pc.getByTestId('auto-list')
      await l.locator('summary').click()
      const row = l.locator('li', { hasText: '재공품' })
      const t = await row.innerText()
      if (!/고침 — .+ · \d\d-\d\d \d\d:\d\d · 전값 1,700,000/.test(t.replace(/\s+/g, ' '))) throw new Error(`고친 줄에 누가 · 언제 · 전값이 없다: ${t}`)
      await row.screenshot({ path: join(OUT, 'flow-fixed-row-pc.png') })
      shots.push('flow-fixed-row-pc.png')
      await row.getByRole('button', { name: '자동으로 돌리기' }).click()
      await pc.waitForFunction(() => /1,700,000원\s*추정/.test(document.querySelector('[data-testid="valuation-edit"]')?.textContent ?? ''), null, { timeout: 120_000 })
      console.log('흐름: 고치기 → 고침(누가 · 언제 · 전값) → 자동으로 돌리기 → 추정 1,700,000 PASS')
      // «빼기» — 출하집계표를 빼면 완제품 추정이 (1,000 − 0) × 7,000 + 5,000,000으로 바뀐다.
      await open(pc, `/finance?biz=${BIZ}&month=${M}`)
      const cl = pc.getByTestId('checklist')
      await cl.locator('div', { hasText: '출하집계표' }).getByRole('button', { name: '빼기' }).click()
      await pc.waitForFunction(() => /출하집계표\s*올리기/.test(document.querySelector('[data-testid="checklist"]')?.textContent ?? ''), null, { timeout: 120_000 })
      await open(pc, `/finance?biz=${BIZ}&tab=pl&month=${M}`)
      const after = (await pc.getByTestId('valuation-edit').innerText()).replace(/\s+/g, ' ')
      console.log(`흐름: 출하집계표 빼기 → ${after}`)
      if (/완제품 5,700,000원/.test(after)) throw new Error('빼기 뒤에도 완제품이 그대로다')
    }

    await open(phone, `/finance?biz=${BIZ}&month=${M}`)
    if (await phone.getByTestId('auto-list').count()) await phone.getByTestId('auto-list').locator('summary').click()
    await phone.waitForTimeout(300)
    await noOverflow(phone, '폰 요약')
    await phone.screenshot({ path: join(OUT, 'summary-phone.png') })
    shots.push('summary-phone.png')
  } finally {
    await browser.close()
  }
  console.log(`PASS 스크린숏 ${shots.length}장 → ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
