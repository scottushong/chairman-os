/**
 * AI 어시스턴트 보강(0069) 스크린숏 — dummy 서버 하나에 대고 돈다(모델은 부르지 않는다 — 권한 답은 규칙 답이다).
 *   SHOT_BASE=http://localhost:3101 SHOT_OUT=<폴더> SHOT_KIND=chair npx tsx scripts/shot-ai-assist.ts
 *   chair: PC 도크 «팀 없는 사원 권한은?»(표 · 링크 · 이어서 셋 · 접힌 보완 칸 열기) · 보완함 PC · 보완함 폰 · 조직도 ?person=
 *   staff: 폰 도크 «내 권한은?»(원가 «대표에게 문의» · «회장» 없음) · 보완 의견 보내기
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Page } from 'playwright'

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3101'
const OUT = process.env.SHOT_OUT ?? '.screenshots/ai-assist'
const KIND = process.env.SHOT_KIND ?? 'chair'

async function askInDock(page: Page, q: string) {
  for (let i = 0; i < 5 && (await page.getByPlaceholder('AI에게 묻기…').count()) === 0; i += 1) {
    await page.getByRole('button', { name: 'AI 어시스턴트 열기' }).click().catch(() => {})
    await page.waitForTimeout(2500)
  }
  const box = page.getByPlaceholder('AI에게 묻기…')
  await box.fill(q)
  await box.press('Enter')
  await page.getByText('이어서 물어볼 만한 질문').last().waitFor({ timeout: 120_000 })
  await page.waitForTimeout(800)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    if (KIND === 'chair') {
      const pc = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      await pc.goto(`${BASE}/settings/users`, { waitUntil: 'networkidle', timeout: 240_000 })
      await askInDock(pc, '팀 없는 사원 권한은?')
      const dock = pc.getByRole('dialog', { name: 'AI 어시스턴트' })
      await dock.screenshot({ path: join(OUT, '1-pc-dock-chair-access.png') })
      await dock.getByText('이 답이 부족했나요? 보완 의견 남기기').last().click()
      await pc.waitForTimeout(500)
      await dock.screenshot({ path: join(OUT, '2-pc-dock-feedback-open.png') })

      await pc.goto(`${BASE}/settings/feedback`, { waitUntil: 'networkidle', timeout: 240_000 })
      await pc.getByText('③ Claude Code 지시문').first().click()
      await pc.waitForTimeout(600)
      await pc.screenshot({ path: join(OUT, '3-pc-feedback-inbox.png'), fullPage: true })
      const main = pc.locator('main').first()
      if (await main.count()) await main.screenshot({ path: join(OUT, '3b-pc-feedback-inbox-main.png') })

      await pc.goto(`${BASE}/settings/users?person=00000000-0000-0000-0000-0000000d0012`, { waitUntil: 'networkidle', timeout: 240_000 })
      await pc.waitForTimeout(800)
      await pc.screenshot({ path: join(OUT, '4-pc-orgchart-person-link.png') })

      const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      await phone.goto(`${BASE}/settings/feedback`, { waitUntil: 'networkidle', timeout: 240_000 })
      await phone.screenshot({ path: join(OUT, '5-phone-feedback-inbox.png'), fullPage: true })
    } else {
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      await phone.goto(`${BASE}/me`, { waitUntil: 'networkidle', timeout: 240_000 })
      await askInDock(phone, '내 권한은?')
      await phone.screenshot({ path: join(OUT, '6-phone-dock-staff-access.png') })
      const fb = phone.getByText('이 답이 부족했나요? 보완 의견 남기기').last()
      await fb.scrollIntoViewIfNeeded()
      await fb.click()
      await phone.getByPlaceholder(/무엇이 모자랐나요/).last().fill('원가 관련 권한이 무엇인지 이름이라도 알고 싶습니다.')
      await phone.screenshot({ path: join(OUT, '7-phone-dock-staff-feedback.png') })
      await phone.getByRole('button', { name: '보내기' }).click()
      await phone.getByText('보완 의견을 보냈습니다').waitFor({ timeout: 60_000 })
      await phone.screenshot({ path: join(OUT, '8-phone-dock-staff-feedback-sent.png') })
      const body = await phone.locator('body').innerText()
      if (/회장|chairman/i.test(body)) throw new Error('직원 화면에 «회장/Chairman»이 보인다')
      console.log('직원 화면 «회장» 0')
    }
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
